import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import { makeEvolution, evolutionText, STAGES, TRAIT_BY_KEY } from '../lib/evolve.js'
import { recordOf } from '../lib/loadout.js'
import { ITEM_BY_ID } from '../lib/equipment.js'
import { RANK_COLOR, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— 武器の進化（戦闘記憶）
// ------------------------------------------------------------
// 戦闘が終わるたびに、装備している武器へ1戦ぶんの戦績を積む。
// 節目（100 / 500 / 2000戦）に達したら、その武器の**戦い方の偏り**から能力が1つ決まる。
//
// ★何が付くかを決める規則は src/v2/lib/evolve.js が正。
//   戦績を積むのは weaponRecord.js（出撃とアリーナで同じ関数を通す）。

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
    const { data, error } = await supabase.rpc('v2_weapon_evolve', {
      p_id: Number(pending.id), p_key: ev.key, p_value: ev.value, p_foe: ev.foe || null,
    })
    setBusy(false)
    if (error || !data?.ok) { setErr(error?.message || data?.error || '進化できませんでした'); return }
    setGot(data.evolution)
  }

  const name = item ? `${item.rank}級「${item.name}${inv?.plus ? ` +${inv.plus}` : ''}」` : 'この武器'
  const color = item ? RANK_COLOR[item.rank] : '#ffcc00'

  // ---- 受け取ったあと ----
  if (got) {
    const t = TRAIT_BY_KEY[got.key]
    return (
      <V2Modal title="⚡ 武器が進化した！" color="#ffcc00" onClose={() => onDone?.()}>
        <div style={{ color, marginBottom:'8px' }}>{name}</div>
        <div style={{ color:'#ffcc00', fontSize:'14px', marginBottom:'4px' }}>{t?.name}</div>
        <div style={{ color:'#cfe2ff' }}>{evolutionText(got)}</div>
        <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'10px' }}>
          この能力はこの1本だけのもの。装備しているあいだ、すべての戦闘で効く。
        </div>
      </V2Modal>
    )
  }

  // ---- まだ受け取っていない ----
  return (
    <V2Modal
      title="⚡ 武器が節目に達した"
      color="#ffcc00"
      confirmLabel="受け取る"
      cancelLabel="あとで"
      busy={busy}
      onConfirm={take}
      onClose={() => onDone?.()}
    >
      <div style={{ color, marginBottom:'8px' }}>{name}</div>
      <div style={{ color:'#cfe2ff' }}>
        {STAGES[stage - 1]}戦を共にした。これまでの戦い方が刃に刻まれる。
      </div>
      {ev ? (
        <div style={{ marginTop:'10px', border:'1px solid #003a70', padding:'8px' }}>
          <div style={{ color:'#ffcc00', marginBottom:'2px' }}>{TRAIT_BY_KEY[ev.key]?.name}</div>
          <div style={{ color:'#cfe2ff' }}>{evolutionText(ev)}</div>
        </div>
      ) : (
        <div style={{ color:'#ff8844', marginTop:'10px' }}>
          まだ戦い方の癖が出ていない。もう少し戦ってからにしよう。
        </div>
      )}
      {err && <div style={{ color:'#ff8844', marginTop:'8px' }}>⚠ {err}</div>}
    </V2Modal>
  )
}
