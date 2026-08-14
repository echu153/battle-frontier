import { useState } from 'react'
import { supabase } from '../../supabase'
import { ITEM_BY_ID, SLOTS, SLOT_LABEL, PARTS, powerOf, statsOf, slotsFor } from '../lib/equipment.js'
import { equippedItems, gearPower } from '../lib/loadout.js'
import { STAT_DEFS, STAT_KEYS } from '../lib/stats.js'
import { box, miniBtn, RANK_COLOR, PART_ICON } from './v2ui.js'

// 倉庫：持っている装備を見て、着け外しする。
// 枠の種類チェックはサーバー（v2_equip）が行う。ここは押せる枠だけ出す。
export default function V2Storage({ prof, inventory, onProfile, onBack }) {
  const [part, setPart] = useState('すべて')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const worn = equippedItems(prof, inventory)
  const wornIds = new Set(Object.values(worn).map(w => String(w.inv.id)))
  const rows = (inventory || [])
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.equip_id] }))
    .filter(r => r.item && (part === 'すべて' || r.item.part === part))
    .sort((a, b) => powerOf(b.item, b.inv.plus) - powerOf(a.item, a.inv.plus))

  const call = async (fn, args) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setMsg(error.message); return false }
    if (!data?.ok) { setMsg(data?.error || '失敗しました'); return false }
    onProfile(null)
    return true
  }
  const equip = (slot, invId) => call('v2_equip', { p_slot: slot, p_inventory_id: invId })
  const unequip = (slot) => call('v2_unequip', { p_slot: slot })

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      {/* 装着中 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
          <span style={{ color:'#446688', fontSize:'10px' }}>装着中（8枠）</span>
          <span style={{ color:'#ffcc00', fontSize:'11px' }}>装備の戦闘力 +{gearPower(prof, inventory).toLocaleString()}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:'4px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'6px 8px', fontSize:'11px' }}>
                <div style={{ color:'#446688', fontSize:'9px' }}>{SLOT_LABEL[slot]}</div>
                {w ? (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'4px' }}>
                    <span style={{ color: RANK_COLOR[w.item.rank] }}>
                      {w.item.name}{w.inv.plus ? `+${w.inv.plus}` : ''}
                    </span>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#ff8888')}>外す</button>
                  </div>
                ) : <span style={{ color:'#334455' }}>—</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* 所持一覧 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
          {['すべて', ...PARTS].map(p => (
            <button key={p} onClick={() => setPart(p)}
              style={{ ...miniBtn(part === p ? '#00aaff' : '#446688'), background: part === p ? '#002850' : '#000818' }}>
              {PART_ICON[p] || ''}{p}
            </button>
          ))}
          <span style={{ color:'#446688', fontSize:'10px', marginLeft:'auto', alignSelf:'center' }}>
            {rows.length}個 / 全{(inventory || []).length}個
          </span>
        </div>

        {rows.length === 0 && <div style={{ color:'#446688', fontSize:'11px' }}>まだ持っていません（出撃で手に入ります）</div>}
        {rows.map(({ inv, item }) => {
          const isWorn = wornIds.has(String(inv.id))
          const st = statsOf(item, inv.plus)
          return (
            <div key={inv.id} style={{ borderTop:'1px solid #002244', padding:'6px 0' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
                <span style={{ color: RANK_COLOR[item.rank], fontSize:'10px', minWidth:'22px' }}>{item.rank}</span>
                <span style={{ color:'#88ccff', fontSize:'12px' }}>
                  {PART_ICON[item.part]}{item.name}{inv.plus ? <span style={{ color:'#ffcc00' }}>+{inv.plus}</span> : ''}
                </span>
                <span style={{ color:'#446688', fontSize:'10px' }}>{item.type} / 戦闘力{powerOf(item, inv.plus)}</span>
                {isWorn && <span style={{ color:'#44ff88', fontSize:'9px' }}>装着中</span>}
                <span style={{ marginLeft:'auto', display:'flex', gap:'4px' }}>
                  {!isWorn && slotsFor(item).map(slot => (
                    <button key={slot} onClick={() => equip(slot, inv.id)} disabled={busy} style={miniBtn('#00aaff')}>
                      {SLOT_LABEL[slot]}へ
                    </button>
                  ))}
                </span>
              </div>
              <div style={{ color:'#556677', fontSize:'10px', paddingLeft:'28px' }}>
                {STAT_KEYS.filter(k => st[k]).map(k => `${STAT_DEFS[k].label}+${st[k]}`).join(' / ')}
              </div>
            </div>
          )
        })}
        {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}
      </div>
    </div>
  )
}
