// ⚔ 簡易出撃パネル（カジノと同じ仕様を共通化）。プロフィール/装備/クールダウン/BOT検知/清算を内包。
// 洞窟(ダンジョン)など、どの画面でも <SortiePanel /> を置くだけで自キャラの簡易出撃ができる。
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'
import { AREAS, JOB_GROWTH, JOB_LEVEL3_BONUS, calcExpNext, getEffectiveCap, generateDropBonus, ARTIFACT_BASE_NAMES } from '../pages/Game'

const SORTIE_WAIT = 30 // 出撃クールダウン秒（街/カジノの出撃と共通の last_action_at で管理）
const AUTOCLICK_SAMPLES = 12
const AUTOCLICK_SPREAD_MS = 1200
const SORTIE_STREAK_LIMIT = 20
const AREA_PASS_EFFECT = { 2:'casino_area_2', 3:'casino_area_3', 4:'casino_area_4', 5:'casino_area_5', 6:'casino_area_6', 7:'casino_area_7' }
const DEV_ACCOUNTS = []
const expIsFrozen = (p) => !!(p && (p.exp_frozen || (p.exp_frozen_until && new Date(p.exp_frozen_until) > new Date())))

export default function SortiePanel() {
  const [profile, setProfile] = useState(null)
  const [playerItems, setPlayerItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [sortieArea, setSortieArea] = useState(1)
  const [sortiePending, setSortiePending] = useState({ count:0, exp:0, gold:0, drops:[] })
  const [sortieMsg, setSortieMsg] = useState('')
  const [showSettle, setShowSettle] = useState(false)
  const [toast, setToast] = useState(null) // { msg, color }
  const [botCheck, setBotCheck] = useState(null)
  const sortieTimesRef = useRef([])
  const botCheckTimerRef = useRef(null)
  const botCheckActiveRef = useRef(false)

  const showMessage = (msg, color = '#44ff88') => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p) return
    setProfile(p)
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
    setPlayerItems(pi || [])
    try {
      const saved = localStorage.getItem('bf_sortie_' + p.id)
      if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.count > 0) setSortiePending(parsed) }
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchProfile() }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => () => { if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current) }, [])

  const savePending = (pend) => {
    try {
      if (!profile) return
      if (pend.count > 0) localStorage.setItem('bf_sortie_' + profile.id, JSON.stringify(pend))
      else localStorage.removeItem('bf_sortie_' + profile.id)
    } catch { /* ignore */ }
  }

  const suspendAccount = async (reason) => {
    if (!profile || DEV_ACCOUNTS.includes(profile.username)) return
    await supabase.from('profiles').update({ is_suspended: true, suspension_reason: reason }).eq('id', profile.id)
    showMessage('⛔ 不正行為が検出されました。アカウントを停止します。', '#ff4444')
    setTimeout(async () => { await supabase.auth.signOut() }, 3000)
  }

  const triggerBotCheck = () => {
    const top = Math.floor(15 + Math.random()*65)
    const left = Math.floor(5 + Math.random()*65)
    botCheckActiveRef.current = true
    setBotCheck({ top, left })
    if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current)
    botCheckTimerRef.current = setTimeout(async () => {
      botCheckTimerRef.current = null
      if (!botCheckActiveRef.current) return
      botCheckActiveRef.current = false
      setBotCheck(null)
      await suspendAccount('BOT確認ボタンを1分以内に押せなかった')
    }, 60000)
  }
  const passBotCheck = () => {
    botCheckActiveRef.current = false
    if (botCheckTimerRef.current) { clearTimeout(botCheckTimerRef.current); botCheckTimerRef.current = null }
    setBotCheck(null)
    sortieTimesRef.current = []
  }

  const isAreaUnlocked = (areaId) => {
    if (areaId === 1) return true
    const eff = AREA_PASS_EFFECT[areaId]
    return playerItems.some(pi => pi.items?.effect === eff && (pi.quantity||0) > 0)
  }
  const sortieRemain = () => {
    if (!profile?.last_action_at) return 0
    const elapsed = (now - new Date(profile.last_action_at).getTime()) / 1000
    return Math.max(0, Math.ceil(SORTIE_WAIT - elapsed))
  }

  const doSortie = async (e) => {
    if (loading || !profile) return
    if (botCheck) return
    if (e && !e.isTrusted) { await suspendAccount('自動操作が検出されました'); return }
    if (profile.is_fishing) { setSortieMsg('🎣 釣り中は出撃できません'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()) { setSortieMsg('⛔ 異常な行動を検出。出撃禁止中です'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (!isAreaUnlocked(sortieArea)) { setSortieMsg('このエリアの出撃許可証を持っていません'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (sortieRemain() > 0) { setSortieMsg(`次の出撃まで ${sortieRemain()}秒`); setTimeout(()=>setSortieMsg(''),1500); return }
    setLoading(true)
    try {
      const lockTime = new Date(Date.now() - SORTIE_WAIT * 1000).toISOString()
      const { data: locked } = await supabase.from('profiles')
        .update({ last_action_at: new Date().toISOString() })
        .eq('id', profile.id).lt('last_action_at', lockTime).eq('is_fishing', false).select('id')
      if (!locked || locked.length === 0) {
        await fetchProfile()
        setSortieMsg('⏳ クールダウン中です（街の出撃と共通）'); setTimeout(()=>setSortieMsg(''),2500)
        return
      }

      if (!DEV_ACCOUNTS.includes(profile.username)) {
        const times = sortieTimesRef.current
        times.push(Date.now())
        if (times.length > AUTOCLICK_SAMPLES) times.shift()
        if (times.length >= AUTOCLICK_SAMPLES) {
          const intervals = times.slice(1).map((t,i) => t - times[i])
          const spread = Math.max(...intervals) - Math.min(...intervals)
          if (spread < AUTOCLICK_SPREAD_MS) { triggerBotCheck(); return }
        }
      }

      const newStreak = (profile.sortie_streak || 0) + 1
      if (newStreak >= SORTIE_STREAK_LIMIT) {
        await supabase.from('profiles').update({ sortie_streak: 0 }).eq('id', profile.id)
        setProfile(p => ({ ...p, sortie_streak: 0 }))
        triggerBotCheck(); return
      } else {
        await supabase.from('profiles').update({ sortie_streak: newStreak }).eq('id', profile.id)
        setProfile(p => ({ ...p, sortie_streak: newStreak }))
      }

      const area = AREAS.find(a => a.id === sortieArea) || AREAS[0]
      const enemies = area.enemies || []
      const cap = getEffectiveCap(profile.class, profile.retraining)
      const isAtCap = profile.lv >= cap
      const frozen = expIsFrozen(profile)
      const expGain = (isAtCap || frozen) ? 0 : Math.floor(Math.random()*4) + 8
      const zako = enemies.length > 0 ? enemies[Math.floor(Math.random()*enemies.length)] : null
      const goldGain = zako?.gold || 0
      if (goldGain >= 5000 && (profile.gambling_gold_max_single || 0) < goldGain) {
        await supabase.from('profiles').update({ gambling_gold_max_single: goldGain }).eq('id', profile.id)
      }

      const drops = []
      const commonDrops = area.commonDrops || []
      const rareDrops = area.rareDrops || []
      if (commonDrops.length > 0 && Math.random()*100 < 3) {
        if (rareDrops.length > 0 && Math.random()*100 < 10) drops.push(rareDrops[Math.floor(Math.random()*rareDrops.length)])
        else drops.push(commonDrops[Math.floor(Math.random()*commonDrops.length)])
      }
      if (Math.random()*100 < 0.1) drops.push(ARTIFACT_BASE_NAMES[Math.floor(Math.random()*ARTIFACT_BASE_NAMES.length)])

      setSortiePending(prev => {
        const next = { count: prev.count + 1, exp: prev.exp + expGain, gold: prev.gold + goldGain, drops: [...prev.drops, ...drops] }
        savePending(next)
        return next
      })
      setProfile(p => ({ ...p, last_action_at: new Date().toISOString() }))
    } catch (err) {
      console.error('簡易出撃エラー:', err)
      setSortieMsg('⚠ 出撃処理でエラーが発生しました。もう一度お試しください')
      setTimeout(()=>setSortieMsg(''),2500)
    } finally {
      setLoading(false)
    }
  }

  const settleSortie = async () => {
    if (loading || !profile) return
    const pend = sortiePending
    if (pend.count === 0) { setShowSettle(false); return }
    setLoading(true)
    const cap = getEffectiveCap(profile.class, profile.retraining)
    const isAtCap = profile.lv >= cap
    const frozen = expIsFrozen(profile)
    const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
    const bonusSlots = JOB_LEVEL3_BONUS[profile.class] || []

    let newExp = profile.exp + (frozen ? 0 : pend.exp)
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPending = profile.pending_stat_points || 0
    let newCharLv = profile.char_lv || 1
    let stat = { hp_max:profile.hp_max, mp_max:profile.mp_max, atk:profile.atk, def:profile.def, matk:profile.matk, mdef:profile.mdef, spd:profile.spd }
    const learnedSkillNames = []

    if (!isAtCap && !frozen) {
      while (newExp >= newExpNext && newLv < cap) {
        newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv); newPending++; newCharLv++
        stat = { hp_max:stat.hp_max+growth.hp, mp_max:stat.mp_max+growth.mp, atk:stat.atk+growth.atk, def:stat.def+growth.def, matk:stat.matk+growth.matk, mdef:stat.mdef+growth.mdef, spd:stat.spd+growth.spd }
        if (bonusSlots.length > 0 && newLv%3===0) { const bi = Math.floor(newLv/3-1)%bonusSlots.length; stat[bonusSlots[bi]] = (stat[bonusSlots[bi]]||0)+1 }
        const { data: lvupSkills } = await supabase.from('skills').select('*').eq('class_name', profile.class).eq('required_lv', newLv)
        const { data: learned } = await supabase.from('player_skills').select('skill_id').eq('player_id', profile.id)
        const learnedIds = (learned||[]).map(s => s.skill_id)
        for (const sk of (lvupSkills||[])) {
          if (!learnedIds.includes(sk.id)) { await supabase.from('player_skills').insert({ player_id:profile.id, skill_id:sk.id }); learnedSkillNames.push(sk.name) }
        }
      }
      if (newLv >= cap) { newExp = 0; newExpNext = calcExpNext(cap) }
    }

    await supabase.from('profiles').update({
      exp:newExp, exp_next:newExpNext, lv:newLv, gold: profile.gold + pend.gold,
      pending_stat_points:newPending, char_lv:newCharLv, ...stat,
    }).eq('id', profile.id)
    const { data: cl } = await supabase.from('class_levels').select('id').eq('player_id', profile.id).eq('class_name', profile.class).maybeSingle()
    if (cl && !isAtCap && !frozen) await supabase.from('class_levels').update({ lv:newLv, exp:newExp }).eq('id', cl.id)

    for (const name of pend.drops) {
      const { data: weapon } = await supabase.from('weapons').select('*').eq('name', name).single()
      if (weapon) {
        const isArti = ARTIFACT_BASE_NAMES.includes(weapon.name)
        const bonusData = isArti ? {} : generateDropBonus(weapon)
        await supabase.from('player_equipment').insert({ player_id:profile.id, weapon_id:weapon.id, slot:weapon.slot, equipped:false, ...bonusData })
      }
    }

    setSortiePending({ count:0, exp:0, gold:0, drops:[] })
    savePending({ count:0 })
    setShowSettle(false)
    await fetchProfile()
    setLoading(false)
    showMessage(`清算完了！ EXP+${pend.exp} Gold+${pend.gold}${pend.drops.length?` ドロップ${pend.drops.length}個`:''}${learnedSkillNames.length?` スキル習得:${learnedSkillNames.join('・')}`:''}`, '#44ff88')
  }

  if (!profile) return null
  const remain = sortieRemain()
  const unlocked = isAreaUnlocked(sortieArea)

  return (
    <div style={{ fontFamily:'monospace' }}>
      {/* BOT確認チャレンジ */}
      {botCheck && (
        <div style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.88)' }}>
          <div style={{ position:'absolute', top:'24px', left:0, right:0, textAlign:'center', color:'#ffcc00', fontSize:'13px', padding:'0 16px' }}>
            ⚠ 自動操作の疑いがあります。<br/>1分以内に下のボタンを押してください（未操作の場合アカウントを停止します）
          </div>
          <button onClick={passBotCheck}
            style={{ position:'absolute', top:`${botCheck.top}vh`, left:`${botCheck.left}vw`, padding:'14px 22px', background:'#1a0000', border:'2px solid #ff4444', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', whiteSpace:'nowrap' }}>
            🤖 私はBOTではありません
          </button>
        </div>
      )}

      {/* 出撃パネル */}
      <div style={{ border:'1px solid #335577', background:'#001020', padding:'14px', marginTop:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
          <div style={{ color:'#66aaff', fontSize:'13px' }}>⚔ 簡易出撃（自キャラ）</div>
          {sortiePending.count > 0 && (
            <button onClick={()=>setShowSettle(true)} style={{ background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', padding:'3px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
              📋 戦果({sortiePending.count})
            </button>
          )}
        </div>
        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'10px', lineHeight:'1.6' }}>
          ボス・パピアなし／必ず勝利。{SORTIE_WAIT}秒に1回出撃でき、戦果は貯まります。離れる前に清算してください。
        </div>

        <div style={{ marginBottom:'8px' }}>
          <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>出撃エリア</div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {AREAS.map(a => {
              const ok = isAreaUnlocked(a.id)
              const sel = sortieArea === a.id
              return (
                <button key={a.id} onClick={()=> ok && setSortieArea(a.id)} disabled={!ok}
                  style={{ padding:'4px 8px', background: sel?'#001840':'#000818', border:`1px solid ${sel?'#66aaff':(ok?'#335577':'#222')}`, color: sel?'#66aaff':(ok?'#88aacc':'#445'), cursor: ok?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                  {ok ? `${a.id}.${a.name}` : `🔒${a.id}`}
                </button>
              )
            })}
          </div>
        </div>

        {sortieMsg && <div style={{ color:'#ff8844', fontSize:'11px', textAlign:'center', marginBottom:'6px' }}>{sortieMsg}</div>}
        {toast && <div style={{ color:toast.color, fontSize:'11px', textAlign:'center', marginBottom:'6px' }}>{toast.msg}</div>}

        <button onClick={doSortie} disabled={loading || !unlocked || remain>0 || profile.is_fishing}
          style={{ width:'100%', padding:'12px', background: (remain>0||!unlocked)?'#001':'#001830', border:`1px solid ${(remain>0||!unlocked)?'#223':'#0088cc'}`, color: (remain>0||!unlocked)?'#445':'#00aaff', cursor:(loading||remain>0||!unlocked)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'14px', letterSpacing:'1px' }}>
          {!unlocked ? '🔒 出撃許可証が必要' : remain>0 ? `⏳ 次の出撃まで ${remain}秒` : `⚔ 出撃する（エリア${sortieArea}）`}
        </button>
      </div>

      {/* 清算モーダル */}
      {showSettle && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
          <div style={{ background:'#001020', border:'1px solid #ffcc00', padding:'20px', maxWidth:'420px', width:'100%' }}>
            <div style={{ color:'#ffcc00', fontSize:'15px', marginBottom:'12px', textAlign:'center' }}>📋 出撃の戦果（清算）</div>
            {sortiePending.count === 0 ? (
              <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'12px' }}>戦果はありません</div>
            ) : (
              <div style={{ fontSize:'12px', color:'#88ccff', lineHeight:'2', marginBottom:'12px' }}>
                <div>出撃回数: <span style={{color:'#ffcc00'}}>{sortiePending.count}回</span></div>
                <div>獲得EXP: <span style={{color:'#44ff88'}}>{sortiePending.exp.toLocaleString()}</span></div>
                <div>獲得Gold: <span style={{color:'#ffcc00'}}>{sortiePending.gold.toLocaleString()}</span></div>
                <div>ドロップ: <span style={{color:'#44ff88'}}>{sortiePending.drops.length}個</span></div>
                {sortiePending.drops.length > 0 && (
                  <div style={{ fontSize:'10px', color:'#88aacc', lineHeight:'1.6' }}>
                    {Object.entries(sortiePending.drops.reduce((m,n)=>{m[n]=(m[n]||0)+1;return m},{})).map(([n,c])=>`${n}${c>1?`×${c}`:''}`).join('、')}
                  </div>
                )}
              </div>
            )}
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={()=>setShowSettle(false)} disabled={loading}
                style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>戻る</button>
              {sortiePending.count > 0 && (
                <button onClick={settleSortie} disabled={loading}
                  style={{ flex:2, padding:'10px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>清算して受け取る</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
