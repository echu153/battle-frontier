import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { ITEM_BY_ID, SLOTS, SLOT_LABEL, ARMOR_EFFECT, slotsFor, kindLabel } from '../lib/equipment.js'
import { canEquipType, weaponsOf } from '../lib/jobs.js'
import { equippedItems, wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectPct } from '../lib/gear.js'
import { PLUS_MAX, plusOf } from '../lib/smith.js'
import { statLine, nameColor, useGearRows } from './v2capGearView.js'
import { RarityTag, PlusTag, GearFilterBar } from './v2capGear.jsx'

// ============================================================
// 「レベルキャップあり」版 — 装備（着ける・外すと持ち物）
//   ・枠は7つ（武器1・頭・鎧・腕・足・アクセ2）。盾なし・武器は1本（2026-10-09 ユーザー決定）
//   ・武器は**いまの職業が装備できる種類だけ**着けられる（職業ごとに3種）
//   ・防具は重鎧（受けるダメージ−3%）／軽装（AGI+5%）。どの職業でも着けられる
//   ・装備は**アイテムLV**を持つ（＝必要LV）。足りなくても着けられるが、不足1LVごとに効果-5%（最低10%）
//   ・装備はエリアごとの一覧で、レア度（ノーマル・レア・エピック・レジェンダリー）を持つ。
//     ノーマルは名前だけ、ほかは【レア】のように頭に付けてレア度の色で出す
//   ・【確定】2026-10-10 強化・分解・作成は**鍛冶屋だけ**（V2capSmith.jsx）。ここは着ける・外すだけ（ユーザー決定）
// ============================================================
export default function V2capEquip({ prof, inventory, onProfile, onGo }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const worn = equippedItems(prof, inventory)
  const wornIds = wornIdsOf(prof, inventory)
  const all = useMemo(() => (inventory || [])
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.base_id] }))
    .filter(r => r.item), [inventory])
  const g = useGearRows(all, prof.lv)
  const rows = g.rows

  const call = async (fn, args) => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e || !data?.ok) { setBusy(false); setError(e?.message || data?.error || '失敗しました'); return }
    await onProfile(null)
    setBusy(false)
  }
  const equip = (slot, inv) => call('v2cap_equip', { p_slot: slot, p_inventory_id: inv.id })
  const unequip = (slot) => call('v2cap_unequip', { p_slot: slot })

  return (
    <div style={{ fontFamily:'monospace' }}>
      {/* 着けているもの */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🛡 装備中</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
          {prof.class}が装備できる武器は <span style={{ color:'#cfe2ff' }}>{weaponsOf(prof.class).join('・')}</span> です。
          防具は重鎧（{ARMOR_EFFECT.重鎧.label}）か軽装（{ARMOR_EFFECT.軽装.label}）を部位ごとに選べます（1部位ごと）。
          装備のLV（アイテムLV）が必要LVで、足りないと1LVごとに効果が5%下がります（最低10%）。
          強化（+{PLUS_MAX}まで・+1ごとに強さ+10%）・分解・作成は鍛冶屋で行います。
        </div>
        <div style={{ display:'grid', gap:'3px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', flexWrap:'wrap' }}>
                <span style={{ color: TEXT.label, width:'52px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
                {w ? (
                  <>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <RarityTag item={w.item} />
                      <span style={{ color: nameColor(w.item) }}>{w.item.name}</span>
                      <PlusTag inv={w.inv} />
                      <span style={{ color: w.inv.ilv > prof.lv ? '#ff8844' : TEXT.sub }}> LV{w.inv.ilv}</span>
                      {pct < 100 && <span style={{ color:'#ff8844' }}> 効果{pct}%</span>}
                    </span>
                    <span style={{ color: TEXT.sub, fontSize:'10px' }}>{statLine(statsAt(w.item, w.inv.ilv, pct, plusOf(w.inv)))}</span>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#aa5566')}>外す</button>
                  </>
                ) : <span style={{ color: TEXT.empty }}>—</span>}
              </div>
            )
          })}
        </div>
        {onGo && (
          <button onClick={() => onGo('smith')} style={{ ...miniBtn('#ffaa44'), marginTop:'8px' }}>🔨 鍛冶屋へ（強化・分解・作成）</button>
        )}
      </div>

      {/* 持ち物 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎒 持っている装備（{all.length}）</div>
        <GearFilterBar g={g} />
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        <div style={{ display:'grid', gap:'4px', maxHeight:'520px', overflowY:'auto' }}>
          {rows.length === 0 && (
            <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>
              {all.length === 0 ? '装備がありません（出撃で勝つと落ちることがあります。ふつうの敵は3%・レアとボスは10%。鍛冶屋で作ることもできます）' : 'この絞り込みに当てはまる装備はありません'}
            </div>
          )}
          {rows.map(({ inv, item }) => {
            const pct = effectPct(inv.ilv, prof.lv)
            const plus = plusOf(inv)
            const isWorn = wornIds.has(String(inv.id))
            const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
            const effect = item.line ? ARMOR_EFFECT[item.line]?.label : null
            const power = powerAt(item, inv.ilv, plus)
            return (
              <div key={inv.id} style={{ background:'#000818', border:`1px solid ${isWorn ? '#0055aa' : '#002244'}`, padding:'6px 8px', opacity: usable ? 1 : 0.6 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                  <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                    <RarityTag item={item} />{item.name}<PlusTag inv={inv} />
                    <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                    {effect && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{effect}</span>}
                    {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
                  </span>
                  <span style={{ color: inv.ilv > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px' }}>LV{inv.ilv}</span>
                </div>
                <div style={{ fontSize:'10px', color: TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <span>戦闘力 {power}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(power * pct / 100)}（効果{pct}%・必要LVまであと{inv.ilv - prof.lv}）</span>}</span>
                  <span>{statLine(statsAt(item, inv.ilv, pct, plus))}</span>
                </div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center' }}>
                  {usable
                    ? slotsFor(item).map(slot => (
                      <button key={slot} onClick={() => equip(slot, inv)} disabled={busy || String(prof.equipped?.[slot]) === String(inv.id)}
                        style={miniBtn('#44aaff')}>{SLOT_LABEL[slot]}に着ける</button>
                    ))
                    : <span style={{ color:'#c69a5c', fontSize:'10px' }}>{prof.class}は{item.type}を装備できない</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
