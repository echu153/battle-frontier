import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { AREAS, toFighter as enemyFighter } from '../lib/enemies.js'
import {
  pickEncounter, expOf, goldOf, isAreaUnlocked, nextBossRate,
  cooldownOf, rollHasDrop, rollDrop, COOLDOWNS,
} from '../lib/sortie.js'
import { runBattle } from '../lib/battle.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { box, miniBtn, RANK_COLOR } from './v2ui.js'

// ★旧版（無印）の出撃とまったく同じ作りにしてある：
//   街 … 「次の行動まで」バー → エリアのプルダウン（解放済みだけ）→「◯◯へ出撃！」
//   戦闘 … バトルログが出て「街に戻る」で戻る
//   ⚠まとめて清算するやり方はやめて、**1戦ごとにその場で反映する**（旧版と同じ）
export default function V2Sortie({ prof, inventory, onProfile, onBack }) {
  const [scene, setScene] = useState('town')
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('v2SelectedArea')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [cd, setCd] = useState(cooldownOf(prof?.sortie_cd))
  const lastAt = useRef(0)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])

  const unlocked = prof?.unlocked_areas || [1]
  // ★解放されていないエリアはプルダウンに出さない（旧版と同じ）
  const availableAreas = AREAS.filter(a => isAreaUnlocked(unlocked, a.id))
  const area = availableAreas.find(a => a.id === selectedArea) || availableAreas[0]
  const elapsed = (now - lastAt.current) / 1000
  const remaining = Math.max(0, cd - elapsed)
  const canAct = remaining <= 0 && !loading
  const timerPct = Math.min(100, (elapsed / cd) * 100)

  const setCooldown = async (sec) => {
    setCd(sec)
    const { data } = await supabase.rpc('v2_set_cooldown', { p_sec: sec })
    if (data?.ok) onProfile(p => ({ ...p, sortie_cd: sec }))
  }

  const doBattle = async () => {
    if (!canAct || !area) return
    lastAt.current = Date.now()
    setLoading(true); setScene('battle'); setLogs([])

    const me = playerFighter(prof, inventory)
    const enc = pickEncounter(area.id, bossRate, new Date())
    const r = runBattle(me, enemyFighter(enc.enemy, 8))
    const win = r.winner === 'a'
    const exp = win ? expOf(enc.isBoss) : 0
    const gold = win ? goldOf(enc.enemy) : 0
    const drop = win && rollHasDrop(cd) ? rollDrop(area.id, new Date()) : null
    setBossRate(nextBossRate(bossRate, enc.isBoss))

    const out = []
    out.push({ t: `${enc.isBoss ? '👑ボス ' : ''}${enc.enemy.name} が現れた！`, c: enc.isBoss ? '#ffcc00' : '#ff8844' })
    for (const l of r.log) {
      const mine = l.side === me.name
      const c = mine ? '#88ccff' : '#ff8888'
      if (l.type === 'skill') {
        out.push({ t: `${l.side}の${l.skill}！ ${l.hits === 0 ? 'かわされた' : `${l.damage.toLocaleString()}のダメージ`}${l.crit ? '（会心）' : ''}${l.drain ? `（${l.drain.toLocaleString()}回復）` : ''}`, c })
      } else if (l.type === 'normal') {
        out.push({ t: `${l.side}の攻撃！ ${l.hit ? `${l.damage.toLocaleString()}のダメージ${l.crit ? '（会心）' : ''}` : 'はずれた'}`, c })
      } else if (l.type === 'misfire') {
        out.push({ t: `${l.side}は${l.skill}を出そうとしたが不発`, c:'#667788' })
      } else if (l.type === 'heal') {
        out.push({ t: `${l.side}の${l.skill}！ HPが${l.heal.toLocaleString()}回復`, c:'#44ff88' })
      } else if (l.type === 'buff') {
        out.push({ t: `${l.side}の${l.skill}！`, c:'#44aaff' })
      } else if (l.type === 'regenTick') {
        out.push({ t: `${l.side}のHPが${l.heal.toLocaleString()}回復`, c:'#44ff88' })
      } else if (l.type === 'extra') {
        out.push({ t: `${l.side}は素早く動いた！`, c:'#ffcc44' })
      }
    }
    out.push({ t: win ? `${enc.enemy.name}を倒した！（${r.turns}ターン）` : `${enc.enemy.name}に敗北…（${r.turns}ターン）`, c: win ? '#ffcc00' : '#ff4444' })
    if (win) {
      out.push({ t: `EXP + ${exp}　Gold + ${gold.toLocaleString()}`, c:'#ffcc00' })
      if (drop) out.push({ t: `🎁 ${drop.rank}級「${drop.name}」を手に入れた！`, c: RANK_COLOR[drop.rank] })
      if (enc.isBoss && area.id < 8) out.push({ t: `エリア${area.id + 1}が解放された！`, c:'#44ff88' })
    }
    setLogs(out)

    // その場で反映する（旧版と同じ。まとめて清算はしない）
    const { data, error } = await supabase.rpc('v2_sortie_settle', {
      p_area: area.id, p_normals: enc.isBoss ? 0 : 1,
      p_boss_wins: enc.isBoss && win ? 1 : 0, p_boss_seen: enc.isBoss ? 1 : 0,
      p_exp: exp, p_gold: gold, p_drops: drop ? [drop.id] : [],
    })
    setLoading(false)
    if (error || !data?.ok) {
      setLogs(l => [...l, { t: `⚠ 反映に失敗しました（${error?.message || data?.error}）`, c:'#ff4444' }])
      return
    }
    if (data.level?.ups > 0) setLogs(l => [...l, { t: `レベルアップ！ LV${data.level.lv}`, c:'#44ff88' }])
    onProfile(null)
  }

  if (scene === 'battle') {
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
        {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color:l.c, fontSize:'12px', lineHeight:'1.7' }}>{l.t}</div>
          ))}
        </div>
        <button onClick={() => setScene('town')} disabled={loading}
          style={{ width:'100%', padding:'10px', background: loading ? '#000a18' : '#001840',
            border:`1px solid ${loading ? '#13405f' : '#0088ff'}`, color: loading ? '#2a4a66' : '#0088ff',
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'13px' }}>
          🏰 街に戻る
        </button>
      </div>
    )
  }

  return (
    <div style={{ ...box, padding:'12px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
        <span style={{ display:'flex', gap:'4px' }}>
          {COOLDOWNS.map(sec => (
            <button key={sec} onClick={() => setCooldown(sec)}
              style={{ ...miniBtn(cd === sec ? '#00aaff' : '#446688'), background: cd === sec ? '#002850' : '#000818' }}>
              {sec}秒
            </button>
          ))}
        </span>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
        <span style={{ color:'#446688' }}>次の行動まで</span>
        <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
      </div>
      <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
        <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
      </div>

      <select value={area?.id || 1}
        onChange={e => { const v = Number(e.target.value); setSelectedArea(v); localStorage.setItem('v2SelectedArea', v) }}
        style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
        {availableAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      <button onClick={doBattle} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#446688', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
        {canAct ? `⚔ ${area?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
    </div>
  )
}
