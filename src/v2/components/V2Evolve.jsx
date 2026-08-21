import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import { makeEvolution, evolutionLines, LEVELS, TRAIT_BY_KEY } from '../lib/evolve.js'
import { AXIS_BY_KEY } from '../lib/evolveTraits.js'
import { recordOf } from '../lib/loadout.js'
import { ITEM_BY_ID } from '../lib/equipment.js'
import { RANK_COLOR, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— 武器の進化（戦闘記憶）
// ------------------------------------------------------------
// 戦闘が終わるたびに、装備している武器へ1戦ぶんの戦績を積む。
// 熟練度がLV300 / 1000 / 2000に達したら、その武器の**戦い方の偏り**から能力が1つ決まる。
//
// ★何が付くかを決める規則は src/v2/lib/evolve.js が正。
//   戦績を積むのは weaponRecord.js（出撃とアリーナで同じ関数を通す）。
// ★サーバーへ送るのは「どの能力か」と「偏りの強さ」だけ。
//   **効果の値はサーバーが名簿から計算し直す**ので、ここで作った値は表示にしか使わない。

// 能力1つぶんの中身（名前＋得＋代償）。ポップアップと結果で使い回す
export function EvoCard({ ev, dim = false }) {
  const t = TRAITS_OF(ev)
  if (!t) return null
  const lines = evolutionLines(ev)
  return (
    <div style={{ border:`1px solid ${dim ? '#003a70' : '#665500'}`, padding:'8px', marginTop:'8px' }}>
      <div style={{ color:'#ffcc00', fontSize:'13px' }}>{t.name}</div>
      <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'4px' }}>
        {AXIS_BY_KEY[t.axis]?.label}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.cost ? '#ff8866' : '#cfe2ff', fontSize:'12px' }}>
          {l.cost ? '▼ ' : '▲ '}{l.text}
        </div>
      ))}
    </div>
  )
}
const TRAITS_OF = (ev) => TRAIT_BY_KEY[ev?.key]

// 進化のポップアップ。pending … pushWeaponRecord の戻り値の1件
export default function V2Evolve({ pending, inventory, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [got, setGot] = useState(null)

  const inv = (inventory || []).find(i => String(i.id) === String(pending?.id))
  const item = inv && ITEM_BY_ID[inv.equip_id]
  const rec = pending?.record || recordOf(inv)
  const already = (inv?.evolutions || []).map(e => e.key)
  const stage = (inv?.evolutions || []).length + 1
  const ev = makeEvolution(rec, stage, already)

  const take = async () => {
    if (!ev) { onDone?.(); return }
    setBusy(true); setErr('')
    // ★値は送らない（サーバーが名簿の倍率から作る）
    const { data, error } = await supabase.rpc('v2_weapon_evolve', {
      p_id: Number(pending.id), p_key: ev.key, p_s: ev.s,
    })
    setBusy(false)
    if (error || !data?.ok) { setErr(error?.message || data?.error || '進化できませんでした'); return }
    setGot(data.evolution)
  }

  const name = item ? `${item.rank}級「${item.name}${inv?.plus ? ` +${inv.plus}` : ''}」` : 'この武器'
  const color = item ? RANK_COLOR[item.rank] : '#ffcc00'

  // ---- 受け取ったあと ----
  if (got) {
    return (
      <V2Modal title="⚡ 武器が覚醒した！" color="#ffcc00" onClose={() => onDone?.()}>
        <div style={{ color, marginBottom:'4px' }}>{name}</div>
        <EvoCard ev={got} />
        <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'10px' }}>
          この能力はこの1本だけのもの。装備しているあいだ、すべての戦闘で効く。
        </div>
      </V2Modal>
    )
  }

  // ---- まだ受け取っていない ----
  return (
    <V2Modal
      title="⚡ 武器が覚醒できる"
      color="#ffcc00"
      confirmLabel="受け取る"
      cancelLabel="あとで"
      busy={busy}
      onConfirm={take}
      onClose={() => onDone?.()}
    >
      <div style={{ color, marginBottom:'4px' }}>{name}</div>
      <div style={{ color:'#cfe2ff' }}>
        熟練度がLV{LEVELS[stage - 1]}に達した。これまでの戦い方が刃に刻まれる。
      </div>
      {ev ? <EvoCard ev={ev} /> : (
        <div style={{ color:'#ff8844', marginTop:'10px' }}>
          まだ戦い方の癖が出ていない。もう少し戦ってからにしよう。
        </div>
      )}
      {err && <div style={{ color:'#ff8844', marginTop:'8px' }}>⚠ {err}</div>}
    </V2Modal>
  )
}
