import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { ITEM_BY_ID, SLOT_LABEL, SLOTS, PARTS, slotsFor, handsLabel, handsColor, handsNote } from '../../v2/lib/equipment.js'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, RANK_COLOR, TEXT } from '../../v2/components/v2ui.js'
import { equippedItems, wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectPct } from '../lib/gear.js'

// ============================================================
// 「レベルキャップあり」版 — 装備（着脱と倉庫）
//   ・装備は**アイテムLV**を持つ（＝必要LV。倒した敵のLV）
//   ・必要LVに足りなくても着けられる。**不足1LVごとに効果-5%・最低10%**（gear.js）
//   ・強化・ルーン・合成・進化は土台では無い
// ============================================================
const statLine = (s) => STAT_KEYS.filter(k => s[k] > 0).map(k => `${STAT_DEFS[k].label}+${s[k]}`).join(' ')

export default function V2capEquip({ prof, inventory, onProfile }) {
  const [part, setPart] = useState('all')
  const [sort, setSort] = useState('power')   // power / ilv / new
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)   // 捨てる確認 { inv, item }

  const worn = equippedItems(prof, inventory)
  const wornIds = wornIdsOf(prof, inventory)
  const rows = useMemo(() => {
    const list = (inventory || [])
      .map(inv => ({ inv, item: ITEM_BY_ID[inv.equip_id] }))
      .filter(r => r.item && (part === 'all' || r.item.part === part))
    const pw = (r) => Math.round(powerAt(r.item, r.inv.ilv) * effectPct(r.inv.ilv, prof.lv) / 100)
    if (sort === 'power') list.sort((a, b) => pw(b) - pw(a) || b.inv.ilv - a.inv.ilv)
    else if (sort === 'ilv') list.sort((a, b) => b.inv.ilv - a.inv.ilv || pw(b) - pw(a))
    else list.sort((a, b) => b.inv.id - a.inv.id)
    return list
  }, [inventory, part, sort, prof.lv])

  const call = async (fn, args) => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc(fn, args)
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || '失敗しました'); return false }
    onProfile(null)
    return true
  }
  const equip = (slot, inv) => call('v2cap_equip', { p_slot: slot, p_inventory_id: inv.id })
  const unequip = (slot) => call('v2cap_unequip', { p_slot: slot })
  const discard = async () => {
    const ok = await call('v2cap_discard', { p_ids: [confirm.inv.id] })
    if (ok) setConfirm(null)
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && (
        <V2Modal title="装備を捨てる" color="#ff8844" danger busy={busy}
          confirmLabel="捨てる" onConfirm={discard} onClose={() => setConfirm(null)}>
          <span style={{ color: RANK_COLOR[confirm.item.rank] }}>[{confirm.item.rank}] {confirm.item.name}</span>（LV{confirm.inv.ilv}）を捨てます。元には戻せません。
        </V2Modal>
      )}

      {/* 着けているもの */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🛡 装備中</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
          装備のLV（アイテムLV）が必要LVです。足りなくても着けられますが、1LV足りないごとに効果が5%下がります（最低10%）。
        </div>
        <div style={{ display:'grid', gap:'3px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'6px', fontSize:'11px' }}>
                <span style={{ color: TEXT.label, width:'52px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
                {w ? (
                  <>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
                      <span style={{ color:'#88ccff' }}>{w.item.name}</span>
                      <span style={{ color: w.inv.ilv > prof.lv ? '#ff8844' : TEXT.sub }}> LV{w.inv.ilv}</span>
                      {pct < 100 && <span style={{ color:'#ff8844' }}> 効果{pct}%</span>}
                    </span>
                    <span style={{ color: TEXT.sub, fontSize:'10px' }}>{statLine(statsAt(w.item, w.inv.ilv, pct))}</span>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#aa5566')}>外す</button>
                  </>
                ) : <span style={{ color: TEXT.empty }}>—</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* 倉庫 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎒 持っている装備（{(inventory || []).length}）</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
          {['all', ...PARTS].map(p => (
            <button key={p} onClick={() => setPart(p)}
              style={{ ...miniBtn(part === p ? '#44aaff' : '#62789a'), color: part === p ? '#88ccff' : '#93a9be' }}>
              {p === 'all' ? 'すべて' : p}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'8px', fontSize:'10px', color: TEXT.label }}>
          <span>並べ替え</span>
          {[['power', '強い順'], ['ilv', 'LVの高い順'], ['new', '新しい順']].map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)}
              style={{ ...miniBtn(sort === k ? '#44aaff' : '#62789a'), color: sort === k ? '#88ccff' : '#93a9be' }}>{label}</button>
          ))}
        </div>
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        <div style={{ display:'grid', gap:'4px', maxHeight:'520px', overflowY:'auto' }}>
          {rows.length === 0 && <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>装備がありません（出撃で勝つと3%で落ちます）</div>}
          {rows.map(({ inv, item }) => {
            const pct = effectPct(inv.ilv, prof.lv)
            const isWorn = wornIds.has(String(inv.id))
            const hands = handsLabel(item)
            return (
              <div key={inv.id} style={{ background:'#000818', border:`1px solid ${isWorn ? '#0055aa' : '#002244'}`, padding:'6px 8px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                  <span style={{ color: RANK_COLOR[item.rank] }}>[{item.rank}]</span>
                  <span style={{ color:'#88ccff', flex:1, minWidth:0 }}>
                    {item.name}
                    <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{item.part}・{item.type}</span>
                    {hands && <span style={{ color: handsColor(item), fontSize:'10px', marginLeft:'5px' }}>{hands}</span>}
                    {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
                  </span>
                  <span style={{ color: inv.ilv > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px' }}>LV{inv.ilv}</span>
                </div>
                <div style={{ fontSize:'10px', color: TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <span>戦闘力 {powerAt(item, inv.ilv)}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(powerAt(item, inv.ilv) * pct / 100)}（効果{pct}%・必要LVまであと{inv.ilv - prof.lv}）</span>}</span>
                  <span>{statLine(statsAt(item, inv.ilv, pct))}</span>
                  {handsNote(item) && <span style={{ color:'#ffaa44' }}>{handsNote(item)}</span>}
                </div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                  {slotsFor(item).map(slot => (
                    <button key={slot} onClick={() => equip(slot, inv)} disabled={busy || prof.equipped?.[slot] === inv.id}
                      style={miniBtn('#44aaff')}>{SLOT_LABEL[slot]}に着ける</button>
                  ))}
                  {!isWorn && <button onClick={() => setConfirm({ inv, item })} disabled={busy} style={miniBtn('#aa5566')}>捨てる</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
