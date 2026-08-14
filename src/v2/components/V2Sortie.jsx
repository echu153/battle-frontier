import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { BattleLogLine } from '../../pages/Game'
import { AREAS, toFighter as enemyFighter } from '../lib/enemies.js'
import {
  pickEncounter, expOf, goldOf, isAreaUnlocked, nextBossRate,
  cooldownOf, rollHasDrop, rollDrop, COOLDOWNS,
} from '../lib/sortie.js'
import { runBattle } from '../lib/battle.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { RANK_COLOR } from './v2ui.js'

// ★旧版（無印）の街とまったく同じ作り。
//   街のブロックが**ホームにそのまま載っている**（別画面へ移動しない）。
//   「次の行動まで」バー → エリアのプルダウン（解放済みだけ）→「◯◯へ出撃！」
//   出撃すると戦闘ログの画面に切り替わり、「🏰 街に戻る」で戻る。
//   戦闘ログの表示は旧版の BattleLogLine をそのまま使っている（ArenaPanel などと同じ）。
export default function V2Sortie({ prof, inventory, onProfile, onScene }) {
  const [scene, setScene] = useState('town')
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('v2SelectedArea')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [cd, setCd] = useState(cooldownOf(prof?.sortie_cd))
  const lastAt = useRef(0)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  useEffect(() => { onScene?.(scene) }, [scene, onScene])

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

    // 旧版の文体に合わせる（BattleLogLine が スキル名・ダメージ・回復 を拾って色を付ける）
    const out = []
    out.push(enc.isBoss
      ? { text:`⚠ ボス出現！ ${enc.enemy.name}が現れた！`, color:'#ff4444' }
      : { text:`${enc.enemy.name}が現れた！`, color:'#88ccff' })
    const foe = enc.enemy.name
    for (const l of r.log) {
      const mine = l.side === me.name
      if (l.type === 'hp') {
        out.push({ type:'hp', turn:l.turn, playerHp:l.a, playerMax:l.aMax, playerName:me.name,
          enemyHp:l.b, enemyMax:l.bMax, enemyName:foe })
      } else if (l.type === 'skill') {
        if (l.hits === 0) out.push({ text: mine ? `⚔ ${l.skill}！ しかし${foe}にかわされた` : `⚔ ${foe}の「${l.skill}」！ しかしかわした`, color:'#667788' })
        else out.push(mine
          ? { text:`⚔ ${l.skill}！ ${foe}に${l.damage.toLocaleString()}ダメージ！${l.crit ? ' 💥クリティカル！' : ''}${l.drain ? ` HPが${l.drain.toLocaleString()}回復した！` : ''}`, color:'#ffcc00' }
          : { text:`⚔ ${foe}の「${l.skill}」！ あなたに${l.damage.toLocaleString()}ダメージ！${l.crit ? ' 💥クリティカル！' : ''}`, color:'#ff4444' })
      } else if (l.type === 'normal') {
        if (!l.hit) out.push({ text: mine ? `攻撃！ しかし${foe}にかわされた` : `${foe}の攻撃！ しかしかわした`, color:'#667788' })
        else out.push(mine
          ? { text:`攻撃！ ${foe}に${l.damage.toLocaleString()}ダメージ！${l.crit ? ' 💥クリティカル！' : ''}`, color:'#ffcc00' }
          : { text:`${foe}の攻撃！ あなたに${l.damage.toLocaleString()}ダメージ！${l.crit ? ' 💥クリティカル！' : ''}`, color:'#ff4444' })
      } else if (l.type === 'misfire') {
        out.push({ text: mine ? `${l.skill}を出そうとしたが不発！` : `${foe}は${l.skill}を出そうとしたが不発！`, color:'#667788' })
      } else if (l.type === 'heal') {
        out.push({ text:`💚 ${mine ? '' : `${foe}の`}${l.skill}！ HPが${l.heal.toLocaleString()}回復した！`, color:'#44ff88' })
      } else if (l.type === 'regenTick') {
        out.push({ text:`💚 ${mine ? 'あなた' : foe}のHPが${l.heal.toLocaleString()}回復した！`, color:'#44ff88' })
      } else if (l.type === 'buff') {
        out.push({ text:`✨ ${mine ? '' : `${foe}の`}${l.skill}！`, color:'#44aaff' })
      } else if (l.type === 'extra') {
        out.push({ text:`⚡ ${mine ? 'あなた' : foe}は素早く動いた！`, color:'#ffcc44' })
      } else if (l.type === 'wall') {
        out.push({ text:`💀 骸の壁が攻撃を和らげた！`, color:'#cc44ff' })
      } else if (l.type === 'debuffGuard') {
        out.push({ text:`🛡 心身一如！ 弱体化を打ち消した！`, color:'#44ffaa' })
      }
    }
    out.push(win
      ? { text:`🎉 ${foe}を倒した！（${r.turns}ターン）`, color:'#ffcc00' }
      : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
    if (win) {
      out.push({ text:`EXP +${exp}　Gold +${gold.toLocaleString()}`, color:'#ffcc00' })
      if (drop) out.push({ text:`🎁 ${drop.rank}級「${drop.name}」を入手！`, color: RANK_COLOR[drop.rank] })
      if (enc.isBoss && area.id < 8) out.push({ text:`🔓 エリア${area.id + 1}が解放された！`, color:'#44ff88' })
    }
    setLogs(out)

    // ★1戦ごとにその場で反映する（旧版と同じ。まとめて清算はしない）
    const { data, error } = await supabase.rpc('v2_sortie_settle', {
      p_area: area.id, p_normals: enc.isBoss ? 0 : 1,
      p_boss_wins: enc.isBoss && win ? 1 : 0, p_boss_seen: enc.isBoss ? 1 : 0,
      p_exp: exp, p_gold: gold, p_drops: drop ? [drop.id] : [],
    })
    setLoading(false)
    if (error || !data?.ok) {
      setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
      return
    }
    if (data.level?.ups > 0) setLogs(l => [...l, { text:`🆙 レベルアップ！ LV${data.level.lv}`, color:'#44ff88' }])
    onProfile(null)
  }

  if (scene === 'battle') {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
        <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
        {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
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

  // ===== 街（ホームにそのまま載る） =====
  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
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
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'10px' }}>
        {canAct ? `⚔ ${area?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:'4px' }}>
        <span style={{ color:'#446688', fontSize:'10px', alignSelf:'center' }}>出撃間隔</span>
        {COOLDOWNS.map(sec => (
          <button key={sec} onClick={() => setCooldown(sec)}
            style={{ background: cd === sec ? '#002850' : '#000818', border:`1px solid ${cd === sec ? '#00aaff' : '#446688'}`,
              color: cd === sec ? '#00aaff' : '#446688', padding:'3px 8px', cursor:'pointer',
              fontFamily:'monospace', fontSize:'10px' }}>
            {sec}秒
          </button>
        ))}
      </div>
    </div>
  )
}
