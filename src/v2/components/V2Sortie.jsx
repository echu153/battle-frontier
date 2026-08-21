import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from './V2LogLine.jsx'
import { AREAS, toFighter as enemyFighter } from '../lib/enemies.js'
import {
  pickEncounter, expOf, isAreaUnlocked, nextBossRate, clearedAreasOf, isAreaCleared,
  cooldownOf, rollHasDrop, rollDrop, rollMaterial, COOLDOWNS,
} from '../lib/sortie.js'
import { runBattle } from '../lib/battle.js'
import { buildBattleLog } from '../lib/battleLog.js'
import { toFighter as playerFighter, equippedRunes, runeAbilities } from '../lib/loadout.js'
import { dropRateMultOf } from '../lib/enchant.js'
import { guardDropMultOf, GUARD_DROP_MULT } from '../lib/arena.js'
import { RARITY_COLOR } from '../lib/material.js'
import { RANK_COLOR, dropLine, LOG_PLAIN } from './v2ui.js'
import V2Evolve from './V2Evolve.jsx'
import { pushWeaponRecord } from './weaponRecord.js'

// ★旧版（無印）の街とまったく同じ作り。
//   街のブロックが**ホームにそのまま載っている**（別画面へ移動しない）。
//   「次の行動まで」バー → エリアのプルダウン（解放済みだけ）→「◯◯へ出撃！」
//   出撃すると戦闘ログの画面に切り替わり、「🏰 街に戻る」で戻る。
//   戦闘ログの表示は旧版の BattleLogLine をそのまま使っている（ArenaPanel などと同じ）。
export default function V2Sortie({ prof, inventory, runes, fishDex, guard, onProfile, onScene }) {
  const [scene, setScene] = useState('town')
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('v2SelectedArea')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [cd, setCd] = useState(cooldownOf(prof?.sortie_cd))
  // 武器の進化：節目に達した武器（ポップアップで受け取る）
  const [evolving, setEvolving] = useState(null)
  const lastAt = useRef(0)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  useEffect(() => { onScene?.(scene) }, [scene, onScene])

  const unlocked = prof?.unlocked_areas || [1]
  // ★解放されていないエリアはプルダウンに出さない（旧版と同じ）
  const availableAreas = AREAS.filter(a => isAreaUnlocked(unlocked, a.id))
  const area = availableAreas.find(a => a.id === selectedArea) || availableAreas[0]
  // ★エリアボスを倒したエリアはプルダウンで「踏破済み」と分かるようにする
  const cleared = clearedAreasOf(prof)
  // アリーナで階層守護者でいるあいだのドロップ率ボーナス（arena.js）
  const guardMult = guardDropMultOf(guard)
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

    const me = playerFighter(prof, inventory, runes, fishDex)
    // 「素材ドロップ率up」の特殊能力ぶん。★重複せず、一番高いものだけが効く
    // ★アリーナで階層守護者でいるあいだは、素材も装備も落ちやすくなる（×1.1・掛け算で乗る）
    const matMult = dropRateMultOf(runeAbilities(equippedRunes(prof, inventory, runes))) * guardMult
    const enc = pickEncounter(area.id, bossRate, new Date())
    // ★ボスかどうかは戦闘（「大敵斬り」）と戦績（ボス討伐数）の両方が見る
    const r = runBattle(me, { ...enemyFighter(enc.enemy, 8), boss: enc.isBoss })
    const win = r.winner === 'a'
    const exp = win ? expOf(enc.isBoss) : 0
    const drop = win && rollHasDrop(cd, Math.random, guardMult) ? rollDrop(area.id, new Date()) : null
    const mat = win ? rollMaterial(enc.enemy.name, matMult) : null
    setBossRate(nextBossRate(bossRate, enc.isBoss))

    // 旧版の文体に合わせる（BattleLogLine が スキル名・ダメージ・回復 を拾って色を付ける）
    const out = []
    out.push(enc.isBoss
      ? { text:`⚠ ボス出現！ ${enc.enemy.name}が現れた！`, color:'#ff4444' }
      : { text:`${enc.enemy.name}が現れた！`, color:'#88ccff' })
    const foe = enc.enemy.name
    const you = me.name   // ★ログはプレイヤー名で出す（「あなた」とは書かない）
    // ★文面は battleLog.js が正（出撃とアリーナで同じものを使う）
    out.push(...buildBattleLog(r, you, foe))

    out.push(win
      ? { text:`${foe}を倒した！（${r.turns}ターン）`, color:'#ffcc00' }
      : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
    if (win) {
      // ★敵はGoldを落とさない（docs/v2-gold-design.md）。Goldは素材を売って稼ぐ
      out.push({ text:`EXP +${exp}`, color:'#ffcc00' })
      // ★色を付けるのは**ランクと装備名だけ**。行全体は塗らない（V2LogLine）
      if (drop) out.push(dropLine(drop, RANK_COLOR[drop.rank]))
      if (mat) out.push({ color: LOG_PLAIN, parts:[
        { text:'⚗ ルーン素材「' },
        { text: mat.name, color: RARITY_COLOR[mat.rarity] },
        { text:'」を入手！' },
      ] })
      if (enc.isBoss && area.id < 8) out.push({ text:`🔓 エリア${area.id + 1}が解放された！`, color:'#44ff88' })
    }
    setLogs(out)

    // ★1戦ごとにその場で反映する（旧版と同じ。まとめて清算はしない）
    const { data, error } = await supabase.rpc('v2_sortie_settle', {
      p_area: area.id, p_normals: enc.isBoss ? 0 : 1,
      p_boss_wins: enc.isBoss && win ? 1 : 0, p_boss_seen: enc.isBoss ? 1 : 0,
      // p_gold は**サーバー側が無視する**（敵はGoldを落とさない）。引数だけ互換で残している
      p_exp: exp, p_gold: 0, p_drops: drop ? [drop.id] : [],
      p_materials: mat ? [mat.id] : [],
    })
    setLoading(false)
    if (error || !data?.ok) {
      setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
      return
    }
    if (data.level?.ups > 0) setLogs(l => [...l, { text:`🆙 レベルアップ！ LV${data.level.lv}`, color:'#44ff88' }])
    // ★武器の進化（戦闘記憶）。装備している武器へ1戦ぶんの戦績を積む
    const ready = await pushWeaponRecord(prof, inventory, r, you, foe, { isBoss: enc.isBoss })
    if (ready.length) setEvolving(ready[0])
    onProfile(null)
  }

  // 節目に達した武器のポップアップ（出撃・アリーナで同じものを使う）
  const evolveModal = evolving
    ? <V2Evolve pending={evolving} inventory={inventory} onDone={() => { setEvolving(null); onProfile(null) }} />
    : null

  if (scene === 'battle') {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
        {evolveModal}
        <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
        {loading && <div style={{ color:'#7fa6d0', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
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
      {evolveModal}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
        <span style={{ color:'#7fa6d0' }}>次の行動まで</span>
        <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
      </div>
      <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
        <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
      </div>
      {/* ★守っているあいだは出撃のドロップ率が上がる（アリーナには挑戦できない代わり） */}
      {guard && (
        <div style={{ border:'1px solid #ff88cc', background:'#1a0a20', padding:'5px 8px',
          marginBottom:'8px', fontSize:'11px', color:'#ff88cc' }}>
          👑 {guard.floor}階の階層守護者
          <span style={{ color:'#44ff88' }}>
            {'　'}ルーン素材と装備のドロップ率 ×{GUARD_DROP_MULT}
          </span>
        </div>
      )}
      <select value={area?.id || 1}
        onChange={e => { const v = Number(e.target.value); setSelectedArea(v); localStorage.setItem('v2SelectedArea', v) }}
        style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
        {availableAreas.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{isAreaCleared(cleared, a.id) ? '　✔踏破済み' : ''}
          </option>
        ))}
      </select>
      <button onClick={doBattle} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'10px' }}>
        {canAct ? `⚔ ${area?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:'4px' }}>
        <span style={{ color:'#7fa6d0', fontSize:'10px', alignSelf:'center' }}>出撃間隔</span>
        {COOLDOWNS.map(sec => (
          <button key={sec} onClick={() => setCooldown(sec)}
            style={{ background: cd === sec ? '#002850' : '#000818', border:`1px solid ${cd === sec ? '#00aaff' : '#7fa6d0'}`,
              color: cd === sec ? '#00aaff' : '#7fa6d0', padding:'3px 8px', cursor:'pointer',
              fontFamily:'monospace', fontSize:'10px' }}>
            {sec}秒
          </button>
        ))}
      </div>
    </div>
  )
}
