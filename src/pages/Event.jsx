import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const EVENT_KEY = 'sortie_2026_07'

// 選択券で交換できるS級レイド装備（redeem_raid_ticket の許可リストと一致）
const TICKET_ITEM = 'Sレアレイドボス装備選択券'
const TICKET_CHOICES = [
  { name: 'ヴァルブレイカー', desc: 'S級大剣。攻撃80 防御20。攻撃ヒット時、2ターン対象の回復力-30%。' },
  { name: 'マレディクシオン', desc: 'S級銃。攻撃60 特攻60 素早さ10。攻撃ヒット時、2ターン対象の回復力-30%。' },
  { name: '濡羽杖アマザネ',   desc: 'S級杖。特攻80 特防20。攻撃ヒット時、2ターンの間対象の素早さ-5%（最大4重複）。' },
  { name: '哭雨の羽衣',       desc: 'S級防具。特攻20 特防80。戦闘開始時と5ターンごとに、状態異常を1回無効化するバフを獲得。' },
  { name: '雷鋼の機神鎧',     desc: 'S級防具。防御60 特防40。被ダメージ時、2ターン素早さ+15%。' },
  { name: '蒼雷の短刃',       desc: 'S級短剣。攻撃40 素早さ60。追加行動の攻撃ヒット時、20%で相手を麻痺させる。' },
]

const fmt = (n) => Number(n).toLocaleString('ja-JP')

export default function Event() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState(null)
  const [points, setPoints] = useState(0)
  const [rewards, setRewards] = useState([])
  const [claimed, setClaimed] = useState(new Set())
  const [claimedReveal, setClaimedReveal] = useState({})  // 受取済みthreshold→正体ラベル
  const [tickets, setTickets] = useState(0)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [gotPopup, setGotPopup] = useState(null)  // 受取時の「○○を獲得した！」ポップアップ
  const [weaponMap, setWeaponMap] = useState({})  // ボス装備報酬のステータス（name→weapon行）

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }

    const cfgR = await supabase.from('event_config').select('*').eq('event_key', EVENT_KEY).maybeSingle()
    const ptsR = await supabase.from('event_points').select('points').eq('event_key', EVENT_KEY).eq('player_id', user.id).maybeSingle()
    const rwR  = await supabase.from('event_rewards').select('threshold, label, weapon_names').eq('event_key', EVENT_KEY).order('threshold')
    const clR  = await supabase.from('event_claims').select('threshold, reveal_label').eq('event_key', EVENT_KEY).eq('player_id', user.id)
    const tiR  = await supabase.from('player_items').select('quantity, items!inner(name)').eq('player_id', user.id).eq('items.name', TICKET_ITEM)

    // 1つでもDBエラー（テーブル未適用/RLS不備等）なら「空イベント」と誤認せずエラー表示する
    const failed = [cfgR, ptsR, rwR, clR, tiR].find(r => r.error)
    if (failed) {
      setLoadErr('イベント情報の取得に失敗しました。時間をおいて再読み込みしてください。')
      setLoading(false)
      return
    }

    setLoadErr(null)
    setConfig(cfgR.data || null)
    setPoints(ptsR.data?.points || 0)
    setRewards(rwR.data || [])
    setClaimed(new Set((clR.data || []).map(r => r.threshold)))
    setClaimedReveal(Object.fromEntries((clR.data || []).filter(r => r.reveal_label).map(r => [r.threshold, r.reveal_label])))
    setTickets((tiR.data || []).reduce((s, r) => s + (r.quantity || 0), 0))
    setNowMs(Date.now())
    setLoading(false)

    // ボス装備報酬のステータスを weapons から取得（装備名は公開列 weapon_names）
    const wNames = [...new Set((rwR.data || []).flatMap(r => r.weapon_names || []))]
    if (wNames.length > 0) {
      const { data: weapons } = await supabase.from('weapons').select('*').in('name', wNames)
      const wm = {}
      for (const w of (weapons || [])) wm[w.name] = w
      setWeaponMap(wm)
    }
  }, [nav])

  // 装備のステータスを簡潔に並べる（0より大きい項目のみ）
  const weaponStatParts = (w) => {
    if (!w) return []
    const parts = []
    const push = (v, label, color) => { if (v > 0) parts.push({ label: `${label}+${v}`, color }) }
    push(w.atk_bonus, '攻撃', '#ffcc00');   push(w.def_bonus, '防御', '#88aaff')
    push(w.matk_bonus, '特攻', '#cc44ff');  push(w.mdef_bonus, '特防', '#44ccff')
    push(w.spd_bonus, '素早さ', '#ff8844'); push(w.hp_bonus, 'HP', '#44ff88')
    push(w.mp_bonus, 'MP', '#4488ff')
    if (w.atk_bonus_pct > 0)  parts.push({ label: `攻撃+${w.atk_bonus_pct}%`, color: '#ffcc00' })
    if (w.matk_bonus_pct > 0) parts.push({ label: `特攻+${w.matk_bonus_pct}%`, color: '#cc44ff' })
    if (w.hp_bonus_pct > 0)   parts.push({ label: `HP+${w.hp_bonus_pct}%`, color: '#44ff88' })
    if (w.mp_bonus_pct > 0)   parts.push({ label: `MP+${w.mp_bonus_pct}%`, color: '#4488ff' })
    if (w.spd_bonus_pct > 0)  parts.push({ label: `素早さ+${w.spd_bonus_pct}%`, color: '#ff8844' })
    if (w.hit_bonus > 0)      parts.push({ label: `命中+${w.hit_bonus}%`, color: '#ffaa44' })
    if (w.crit_bonus > 0)     parts.push({ label: `クリ+${w.crit_bonus}%`, color: '#ff6688' })
    if (w.crit_resist > 0)    parts.push({ label: `クリ耐性+${w.crit_resist}%`, color: '#66ccff' })
    return parts
  }

  // 初回マウント時のデータ取得（awaitの後にstate更新する正当なfetch）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { init() }, [init])

  const claim = async (threshold) => {
    if (busy) return
    setBusy(threshold); setErr(null); setMsg(null)
    const { data, error } = await supabase.rpc('claim_event_reward', { p_event_key: EVENT_KEY, p_threshold: threshold })
    if (error || data?.error) {
      setErr(data?.error || 'エラーが発生しました')
    } else {
      setGotPopup({ name: data.label })  // ポップアップで「○○を獲得した！」
      await init()
    }
    setBusy(null)
  }

  const redeem = async (weaponName) => {
    if (busy) return
    setBusy('ticket:' + weaponName); setErr(null); setMsg(null)
    const { data, error } = await supabase.rpc('redeem_raid_ticket', { p_weapon_name: weaponName })
    if (error || data?.error) {
      setErr(data?.error || 'エラーが発生しました')
    } else {
      setGotPopup({ name: weaponName, note: '装備画面で確認できます。' })
      await init()
    }
    setBusy(null)
  }

  const base = { minHeight:'100vh', background:'#000820', color:'#aaccff', fontFamily:'monospace', padding:'16px', boxSizing:'border-box', textAlign:'left' }

  if (loading) return <div style={base}>読み込み中...</div>
  if (loadErr) return (
    <div style={base}>
      <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'12px' }}>{loadErr}</div>
      <button onClick={() => { setLoading(true); init() }} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'6px 14px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>再読み込み</button>
      <button onClick={() => nav('/game')} style={{ marginLeft:'8px', background:'none', border:'1px solid #446688', color:'#446688', padding:'6px 14px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>← 街に戻る</button>
    </div>
  )

  const now = nowMs
  const startMs = config ? new Date(config.starts_at).getTime() : 0
  const endMs   = config ? new Date(config.ends_at).getTime()   : 0
  const active  = config && now >= startMs && now < endMs
  const ended   = config && now >= endMs

  // 次の未達マイルストーン（プログレスバー用）
  const nextReward = rewards.find(r => r.threshold > points)
  const maxThreshold = rewards.length ? rewards[rewards.length - 1].threshold : 2000

  return (
    <div style={base}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
        <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
        <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
      </div>

      <div style={{ color:'#ffcc44', fontSize:'15px', marginBottom:'4px' }}>🎫 {config?.name || '出撃イベント'}</div>
      <div style={{ color:'#9fc1e0', fontSize:'12px', marginBottom:'12px', lineHeight:'1.9' }}>
        出撃でポイントを獲得し、累計ポイントで報酬を受け取れます。<br/>
        獲得ポイントは出撃時間モードで変化します。<br/>
        ・20秒モード … <span style={{ color:'#ffcc44' }}>1回で 1pt</span><br/>
        ・10秒モード … <span style={{ color:'#ffcc44' }}>2回で 1pt</span>
        {config && <><br/><span style={{ color:'#7799bb' }}>期間: {new Date(config.starts_at).toLocaleString('ja-JP')} 〜 {new Date(config.ends_at).toLocaleString('ja-JP')}</span></>}
      </div>

      <div style={{ maxWidth:'620px', margin:'0 auto' }}>
        {!active && (
          <div style={{ border:'1px solid #443300', background:'#1a1400', padding:'10px', marginBottom:'12px', color:'#ffcc44', fontSize:'12px' }}>
            {ended ? '⏰ イベントは終了しました。未受取の報酬は引き続き受け取れます。' : '⏳ イベントはまだ開催されていません。'}
          </div>
        )}

        {/* ポイント表示＋プログレス */}
        <div style={{ border:'1px solid #224488', background:'#001028', padding:'14px', marginBottom:'14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
            <span style={{ color:'#88ccff', fontSize:'12px' }}>現在のポイント</span>
            <span style={{ color:'#ffcc00', fontSize:'22px' }}>{fmt(points)}<span style={{ fontSize:'12px', color:'#557799' }}> pt</span></span>
          </div>
          <div style={{ height:'8px', background:'#001428', border:'1px solid #113355', marginTop:'8px' }}>
            <div style={{ height:'100%', width:`${Math.min(100, (points / maxThreshold) * 100)}%`, background:'#3388ff' }} />
          </div>
          <div style={{ color:'#557799', fontSize:'10px', marginTop:'6px' }}>
            {nextReward ? `次の報酬まで あと ${fmt(nextReward.threshold - points)}pt（${nextReward.threshold}pt: ${nextReward.label}）` : '全マイルストーン到達！'}
          </div>
        </div>

        {/* 選択券交換 */}
        {tickets > 0 && (
          <div style={{ border:'1px solid #886600', background:'#1a1200', padding:'12px', marginBottom:'14px' }}>
            <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'8px' }}>🎟 Sレアレイドボス装備選択券（所持: {tickets}枚）— 1枚で1つ交換</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {TICKET_CHOICES.map(c => (
                <div key={c.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', border:'1px solid #0055aa', background:'#001028', padding:'8px 10px' }}>
                  <div>
                    <div style={{ color:'#ffcc00', fontSize:'12px' }}>{c.name}</div>
                    <div style={{ color:'#778899', fontSize:'10px' }}>{c.desc}</div>
                  </div>
                  <button onClick={() => redeem(c.name)} disabled={!!busy}
                    style={{ padding:'8px 12px', background:'#001a00', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>
                    {busy === 'ticket:' + c.name ? '処理中...' : '交換'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && <div style={{ border:'1px solid #224422', background:'#001a00', padding:'10px', marginBottom:'12px', color:'#44ff88', fontSize:'12px' }}>{msg}</div>}
        {err && <div style={{ border:'1px solid #440000', background:'#1a0000', padding:'10px', marginBottom:'12px', color:'#ff4444', fontSize:'12px' }}>{err}</div>}

        {/* 報酬リスト */}
        <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
          {rewards.map(r => {
            const isClaimed = claimed.has(r.threshold)
            const reached = points >= r.threshold
            const canClaim = reached && !isClaimed
            // 受取済みは正体(claimedReveal)を、未受取は公開label（隠し報酬は？？？？）を表示
            const displayLabel = (isClaimed && claimedReveal[r.threshold]) ? claimedReveal[r.threshold] : r.label
            return (
              <div key={r.threshold} style={{
                display:'grid', gridTemplateColumns:'52px minmax(0,1fr) auto', columnGap:'10px', alignItems:'start',
                border:`1px solid ${isClaimed ? '#1a3344' : canClaim ? '#224433' : '#0a2030'}`,
                background: isClaimed ? '#060f0f' : canClaim ? '#00140a' : '#000a18',
                padding:'10px 12px',
              }}>
                {/* 列1: pt */}
                <span style={{ color: reached ? '#ffcc00' : '#446688', fontSize:'13px' }}>{r.threshold}pt</span>
                {/* 列2: 名前＋ステータス（同じ左端から開始） */}
                <div style={{ minWidth:0 }}>
                  <div style={{ color: reached ? '#cce0ff' : '#556677', fontSize:'12px' }}>{displayLabel}</div>
                  {(r.weapon_names || []).map(wn => {
                    const w = weaponMap[wn]
                    const parts = weaponStatParts(w)
                    if (!parts.length) return null
                    return (
                      <div key={wn} style={{ marginTop:'4px', fontSize:'10px', lineHeight:'1.6' }}>
                        {(r.weapon_names.length > 1) && <span style={{ color:'#778899' }}>{wn}: </span>}
                        {parts.map((p, i) => (
                          <span key={i} style={{ color:p.color, marginRight:'6px' }}>{p.label}</span>
                        ))}
                      </div>
                    )
                  })}
                </div>
                {/* 列3: ボタン/受取済 */}
                {isClaimed ? (
                  <span style={{ color:'#446655', fontSize:'11px', whiteSpace:'nowrap', paddingTop:'1px' }}>✓ 受取済</span>
                ) : (
                  <button onClick={() => claim(r.threshold)} disabled={!canClaim || !!busy}
                    style={{ padding:'6px 12px', background: canClaim ? '#001a00' : '#000e20', border:`1px solid ${canClaim ? '#44ff88' : '#13283a'}`, color: canClaim ? '#44ff88' : '#33495c', cursor: canClaim ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>
                    {busy === r.threshold ? '処理中...' : canClaim ? '受け取る' : '未達成'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {gotPopup && (
        <div onClick={() => setGotPopup(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#0a0c1a', border:'1px solid #ffcc44', padding:'24px', maxWidth:'340px', width:'92%', fontFamily:'monospace', textAlign:'center' }}>
            <div style={{ fontSize:'30px', marginBottom:'8px' }}>🎉</div>
            <div style={{ color:'#ffcc00', fontSize:'15px', marginBottom:'6px', lineHeight:'1.5' }}>「{gotPopup.name}」を獲得した！</div>
            {gotPopup.note && <div style={{ color:'#88ccaa', fontSize:'11px', marginBottom:'4px' }}>{gotPopup.note}</div>}
            <button onClick={() => setGotPopup(null)}
              style={{ width:'100%', marginTop:'14px', padding:'10px', background:'#001a00', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
