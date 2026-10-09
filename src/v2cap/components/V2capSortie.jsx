import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from '../../v2/components/V2LogLine.jsx'
import { runBattle } from '../../v2/lib/battle.js'
import { buildBattleLog } from '../../v2/lib/battleLog.js'
import { rollStamina } from '../../v2/lib/stamina.js'
import { biasLabelOf, BIAS_MULT } from '../../v2/lib/enemies.js'
import { RANK_COLOR, LOG_PLAIN } from '../../v2/components/v2ui.js'
import { AREAS_SORTED, areaOf, markOf, tierLvText, toFighter as enemyFighter } from '../lib/areas.js'
import {
  pickEncounter, rollEquipDrop, nextBossRate, isAreaUnlocked, clearedAreasOf, isAreaCleared,
  clearNext, unlockNext, restToOpenNext, LAST_TIER, SORTIE_CD,
} from '../lib/sortie.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { staminaMaxOf, MAX_LV } from '../lib/level.js'
import { jobOf, JOB_MAX } from '../lib/jobs.js'
import { effectPct } from '../lib/gear.js'

// ============================================================
// 「レベルキャップあり」版 — 出撃（ホームの右）
//   作りは今のⅡの出撃（V2Sortie.jsx）と同じ：10秒に1回・オートはスタミナ1／回・手動は無消費。
//   違うのは：
//   ・敵が**LV**を持つ（エリアのLV帯の中で、敵ごとに決まっている）
//   ・**EXPはサーバーが敵のLVから決める**＝ログのEXPは清算の返事を出す
//   ・JBLVアップ／スキル習得もサーバーの返事から出す
//   ・落ちる装備は「基本装備＋ランク」。武器はいまの職業が装備できる3種から（sortie.js）
//   ・落ちた装備には**アイテムLV**（＝倒した敵のLV）が付く
// ============================================================
export default function V2capSortie({ prof, inventory, onProfile, onScene }) {
  const [scene, setScene] = useState('town')
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('v2capSelectedArea')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false)   // ★覚えておかない（リロードで勝手に走らないように）
  const [stam, setStam] = useState(() => ({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }))
  const lastAt = useRef(0)
  const busy = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  useEffect(() => { onScene?.(scene) }, [scene, onScene])
  useEffect(() => { setStam({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }) }, [prof?.stamina, prof?.stamina_at])
  useEffect(() => { setBossRate(prof?.boss_rate || 0) }, [prof?.boss_rate])

  const unlocked = prof?.unlocked_areas || [1]
  const availableAreas = AREAS_SORTED.filter(a => isAreaUnlocked(unlocked, a.id))
  const area = availableAreas.find(a => a.id === selectedArea) || availableAreas[0]
  const cleared = clearedAreasOf(prof)
  const elapsed = (now - lastAt.current) / 1000
  const remaining = Math.max(0, SORTIE_CD - elapsed)
  const canAct = remaining <= 0 && !loading
  const timerPct = Math.min(100, (elapsed / SORTIE_CD) * 100)
  const stamMax = staminaMaxOf(prof?.lv)
  const stamNow = rollStamina(stam.n, stam.at, stamMax, now).n

  const doBattle = async (isAuto = false) => {
    if (busy.current || !area) return
    if (Date.now() - lastAt.current < SORTIE_CD * 1000) return
    busy.current = true
    lastAt.current = Date.now()
    setLoading(true); setScene('battle'); setLogs([])
    try {
      const me = playerFighter(prof, inventory)
      const enc = pickEncounter(area.id, bossRate, new Date())
      const r = runBattle(me, { ...enemyFighter(enc.enemy, 8), boss: enc.isBoss })
      const win = r.winner === 'a'
      const drop = win ? rollEquipDrop(enc, prof.class, new Date()) : null
      setBossRate(nextBossRate(bossRate, enc.isBoss))

      const foe = enc.enemy.name
      const you = me.name
      const out = []
      out.push(enc.isBoss
        ? { text:`⚠ ボス出現！ ${foe}（LV${enc.lv}）が現れた！`, color:'#ff4444' }
        : { text:`${foe}（LV${enc.lv}）が現れた！`, color:'#88ccff' })
      out.push(...buildBattleLog(r, you, foe))
      out.push(win
        ? { text:`${foe}を倒した！（${r.turns}ターン）`, color:'#ffcc00' }
        : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
      setLogs(out)

      // ★1戦ごとにその場で反映する。EXP・アイテムLVはサーバーが敵のLVから決める
      const { data, error } = await supabase.rpc('v2cap_sortie_settle', {
        p_area: area.id, p_enemy: foe, p_win: win, p_drop: drop ? drop.item.id : null, p_rank: drop ? drop.rank : null, p_auto: !!isAuto,
      })
      if (data && data.stamina != null) setStam({ n: data.stamina, at: data.stamina_at || new Date().toISOString() })
      if (error || !data?.ok) {
        setAuto(false)
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        return
      }
      const lv = data.level || {}
      const after = []
      if (win) {
        // ★LV100・JBLV30（上限）のぶんは入らないので、そう出す
        const lvMax = prof.lv >= MAX_LV
        const jobMax = jobOf(prof.jobs, prof.class).lv >= JOB_MAX
        after.push({ text:`EXP +${data.exp}${lvMax ? '（LV上限のため入らない）' : ''}${jobMax ? '' : `（JBEXP +${data.exp}）`}`, color:'#ffcc00' })
        if (lv.level_ups > 0) after.push({ text:`🆙 レベルアップ！ LV${lv.lv}`, color:'#44ff88' })
        if (lv.job_ups > 0) after.push({ text:`⭐ JBLVアップ！ ${prof.class} JBLV${lv.jlv}`, color:'#ffcc00' })
        for (const name of lv.learned || []) after.push({ text:`📖 スキル「${name}」を覚えた！（スキルセットで編成できる）`, color:'#44ddff' })
        if (data.drop && drop) {
          const ilv = data.drop.ilv
          const pct = effectPct(ilv, lv.lv || prof.lv)
          // ★色を付けるのはランクと装備名だけ（今のⅡと同じ）
          const color = RANK_COLOR[drop.rank]
          const line = { color: LOG_PLAIN, parts: [
            { text:'🎁 ' }, { text:`${drop.rank}級`, color }, { text:'「' }, { text: drop.item.name, color },
            { text:`」を入手！（LV${ilv}）` },
          ] }
          if (pct < 100) line.parts.push({ text:` 必要LVに足りない＝効果${pct}%`, color:'#ff8844' })
          after.push(line)
        }
        if (enc.isBoss) {
          const nextCleared = clearNext(cleared, area.id, true, true)
          const opened = unlockNext(unlocked, nextCleared).filter(id => !unlocked.includes(id))
          if (opened.length) {
            after.push({ text:`🔓 ${opened.map(id => areaOf(id)?.name).join('・')}が解放された！`, color:'#44ff88' })
          } else {
            const rest = restToOpenNext(nextCleared, area.tier)
            if (rest > 0 && area.tier < LAST_TIER) {
              after.push({ text:`あと${rest}エリア踏破で難易度${markOf(area.tier + 1)}が解放される`, color: LOG_PLAIN })
            }
          }
        }
      }
      if (after.length) setLogs(l => [...l, ...after])
      onProfile(null)
    } finally {
      // ★10秒は「精算が返ってきた時点」から数え直す。サーバーも前回の精算から8秒空いているかを見るので、
      //   出撃を押した時点から数えると、通信が遅かった回の次で弾かれることがある
      lastAt.current = Date.now()
      busy.current = false
      setLoading(false)
    }
  }

  // オート出撃。クールタイムが明けるたびに、スタミナを1使って勝手に出撃する
  useEffect(() => {
    if (!auto || loading || !area || remaining > 0) return
    if (stamNow < 1) {
      setAuto(false)
      setLogs(l => [...l, { text:'⚡ スタミナ切れ。ここからは自分で出撃する', color:'#ffcc00' }])
      return
    }
    doBattle(true)
  }, [auto, now, loading, area, remaining, stamNow])   // eslint-disable-line react-hooks/exhaustive-deps

  const timerRow = (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
        <span style={{ color:'#7fa6d0' }}>次の行動まで</span>
        <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
      </div>
      <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
        <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
      </div>
    </>
  )

  if (scene === 'battle') {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'10px' }}>
          <span style={{ color:'#ff6644', fontSize:'13px' }}>⚔ バトル！</span>
          {auto && <span style={{ color:'#44ff88', fontSize:'11px' }}>▶ オート出撃中（⚡{stamNow}）</span>}
        </div>
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
        </div>
        {timerRow}
        {auto && (
          <button onClick={() => setAuto(false)}
            style={{ width:'100%', padding:'10px', background:'#1a0a20', border:'1px solid #ff88cc',
              color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            ■ オートを止める
          </button>
        )}
        {!auto && (
          <button onClick={() => doBattle(false)} disabled={!canAct}
            style={{ width:'100%', padding:'10px', background:'#001840',
              border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
              color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
              fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            {canAct ? `⚔ ${area?.name}へ再出撃！` : '⏳ 待機中...'}
          </button>
        )}
        <button onClick={() => { setAuto(false); setScene('town') }} disabled={loading}
          style={{ width:'100%', padding:'10px', background: loading ? '#000a18' : '#001840',
            border:`1px solid ${loading ? '#13405f' : '#0088ff'}`, color: loading ? '#2a4a66' : '#0088ff',
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'13px' }}>
          🏰 街に戻る
        </button>
      </div>
    )
  }

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
      {timerRow}
      <select value={area?.id || 1}
        onChange={e => { const v = Number(e.target.value); setSelectedArea(v); localStorage.setItem('v2capSelectedArea', v) }}
        style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
        {/* ★この版はエリアのLV帯を出す（敵のLVがその範囲に並んでいる） */}
        {availableAreas.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}　{tierLvText(a.tier)}{isAreaCleared(cleared, a.id) ? '　✔踏破済み' : ''}
          </option>
        ))}
      </select>
      <div style={{ fontSize:'10px', color:'#7fa6d0', marginBottom:'8px', display:'flex', justifyContent:'space-between' }}>
        <span>敵は{area ? tierLvText(area.tier) : ''}（ボスは上限のLV）</span>
        <span style={{ color: area?.bias ? '#88ccff' : '#7fa6d0' }}>
          {biasLabelOf(area?.bias)}{area?.bias ? `（与ダメージ+${Math.round((BIAS_MULT - 1) * 100)}%）` : ''}
        </span>
      </div>
      <button onClick={() => doBattle(false)} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
        {canAct ? `⚔ ${area?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
      <button onClick={() => setAuto(true)} disabled={stamNow < 1}
        style={{ width:'100%', padding:'8px', background: stamNow > 0 ? '#00281a' : '#000818',
          border:`1px solid ${stamNow > 0 ? '#44ff88' : '#2a4a66'}`, color: stamNow > 0 ? '#44ff88' : '#2a4a66',
          cursor: stamNow > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
        {stamNow > 0 ? `▶ オート出撃（あと${stamNow}回）` : '⚡ スタミナ切れ'}
      </button>
      <div style={{ color:'#4d6f92', fontSize:'10px', marginTop:'5px', textAlign:'center' }}>
        {stamNow > 0 ? 'スタミナ1につき1回、10秒ごとに自動で出撃します' : '自分でクリックする出撃はスタミナを使いません'}
      </div>
    </div>
  )
}
