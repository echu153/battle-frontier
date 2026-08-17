import { useState } from 'react'
import { supabase } from '../../supabase'
import { SLOTS, SLOT_LABEL, PARTS, powerOf, statsOf, slotsFor, socketCountOf } from '../lib/equipment.js'
import { equippedItems, gearPower, wornIdsOf, stackInventory, runePctText } from '../lib/loadout.js'
import { STAT_DEFS, STAT_KEYS } from '../lib/stats.js'
import { COLOR_HEX } from '../lib/material.js'
import { filterRows, sortRows, pageOf, clampPage, defaultFilter } from '../lib/browse.js'
import { box, miniBtn, RANK_COLOR } from './v2ui.js'
import { V2Filter, V2Pager } from './V2Browse.jsx'
import V2ItemTip, { SealTags } from './V2ItemTip.jsx'

// 倉庫：持っている装備を見て、着け外しする。
// 枠の種類チェックはサーバー（v2_equip）が行う。ここは押せる枠だけ出す。
export default function V2Storage({ prof, inventory, runes, onProfile, onBack }) {
  const [part, setPart] = useState('すべて')
  const [filter, setFilter] = useState(defaultFilter)  // 絞り込みと並べ替え（鍛冶屋と共通）
  const [rawPage, setRawPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const worn = equippedItems(prof, inventory)
  // ★同じ装備・同じ強化値はひとまとめ。＋が違うものは別々に並ぶ（まとめ方は loadout.js が正）
  const stacks = stackInventory(inventory, wornIdsOf(prof, inventory))
    .map(g => ({ ...g, count: g.list.length, power: powerOf(g.item, g.plus) }))
    .filter(g => part === 'すべて' || g.item.part === part)
  // ★絞り込み・並べ替え・ページ送りは鍛冶屋と共通（browse.js）
  const filtered = sortRows(filterRows(stacks, filter), filter.sort, filter.asc)
  const page = clampPage(rawPage, filtered.length)
  const rows = pageOf(filtered, page)
  const shownCount = filtered.reduce((t, g) => t + g.list.length, 0)

  // その個体に刻印されているルーン
  const essOf = (invId) => (runes || []).filter(e => String(e.inv_id) === String(invId))

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
          <span style={{ color:'#7fa6d0', fontSize:'10px' }}>装着中（8枠）</span>
          <span style={{ color:'#ffcc00', fontSize:'11px' }}>装備の戦闘力 +{gearPower(prof, inventory).toLocaleString()}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:'4px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'6px 8px', fontSize:'11px' }}>
                <div style={{ color:'#7fa6d0', fontSize:'9px' }}>{SLOT_LABEL[slot]}</div>
                {w ? (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'4px' }}>
                    {/* ★合わせると能力値と刻印がまとめて見える */}
                    <V2ItemTip item={w.item} inv={w.inv} runes={essOf(w.inv.id)}>
                      <span style={{ color: RANK_COLOR[w.item.rank] }}>
                        {w.item.name}{w.inv.plus ? `+${w.inv.plus}` : ''}
                      </span>
                      <SealTags list={essOf(w.inv.id)} size="9px" />
                    </V2ItemTip>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#ff8888')}>外す</button>
                  </div>
                ) : <span style={{ color:'#62789a' }}>—</span>}
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
              style={{ ...miniBtn(part === p ? '#00aaff' : '#7fa6d0'), background: part === p ? '#002850' : '#000818' }}>
              {p}
            </button>
          ))}
          <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'auto', alignSelf:'center' }}>
            {shownCount}個 / 全{(inventory || []).length}個
          </span>
        </div>
        <V2Filter value={filter} rows={stacks} onChange={f => { setFilter(f); setRawPage(0) }} />

        {(inventory || []).length === 0 && <div style={{ color:'#7fa6d0', fontSize:'11px' }}>まだ持っていません（出撃で手に入ります）</div>}
        {(inventory || []).length > 0 && rows.length === 0 && (
          <div style={{ color:'#7fa6d0', fontSize:'11px' }}>絞り込みに合う装備がありません</div>
        )}
        {rows.map(g => {
          const { item, plus } = g
          const st = statsOf(item, plus)
          const spare = g.free[0]   // 装着に使うのは、まだ着けていないぶんの1個
          return (
            <div key={g.key} style={{ borderTop:'1px solid #002244', padding:'6px 0' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
                <span style={{ color: RANK_COLOR[item.rank], fontSize:'10px', minWidth:'22px' }}>{item.rank}</span>
                <span style={{ color:'#88ccff', fontSize:'12px' }}>
                  {item.name}{plus ? <span style={{ color:'#ffcc00' }}>+{plus}</span> : ''}
                </span>
                {/* ★同じ装備・同じ強化値はここでまとめて個数にする */}
                {g.list.length > 1 && <span style={{ color:'#ffffff', fontSize:'11px' }}>×{g.list.length}</span>}
                <span style={{ color:'#7fa6d0', fontSize:'10px' }}>{item.type} / 戦闘力{powerOf(item, plus)}</span>
                {g.worn.length > 0 && (
                  <span style={{ color:'#44ff88', fontSize:'9px' }}>
                    装着中{g.worn.length > 1 ? `×${g.worn.length}` : ''}
                  </span>
                )}
                <span style={{ marginLeft:'auto', display:'flex', gap:'4px' }}>
                  {spare && slotsFor(item).map(slot => (
                    <button key={slot} onClick={() => equip(slot, spare.id)} disabled={busy} style={miniBtn('#00aaff')}>
                      {SLOT_LABEL[slot]}へ
                    </button>
                  ))}
                </span>
              </div>
              <div style={{ color:'#93a9be', fontSize:'10px', paddingLeft:'28px' }}>
                {STAT_KEYS.filter(k => st[k]).map(k => `${STAT_DEFS[k].label}+${st[k]}`).join(' / ')}
              </div>
              {/* ★ソケットと刻印は**個体ごと**に違う。色の●だけだと空きと見分けが付かないので、
                  刻印しているものは【名前】と効果(%)まで出す */}
              {socketCountOf(item) > 0 && g.list.map(inv => {
                const es = essOf(inv.id)
                const pct = runePctText(es)
                return (
                  <div key={inv.id} style={{ fontSize:'10px', paddingLeft:'28px', display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
                    <V2ItemTip item={item} inv={inv} runes={es}>
                      <span style={{ color:'#62789a', fontSize:'9px' }}>#{inv.id}</span>{' '}
                      <span style={{ letterSpacing:'1px' }}>
                        {(inv.sockets || []).map((c, i) => <span key={i} style={{ color: COLOR_HEX[c] }}>●</span>)}
                      </span>{' '}
                      {es.length ? <SealTags list={es} /> : <span style={{ color:'#62789a' }}>刻印なし</span>}
                    </V2ItemTip>
                    {pct && <span style={{ color:'#88ddaa' }}>刻印効果：{pct}</span>}
                    {es.filter(e => e.ability).map(e => (
                      <span key={e.id} style={{ color:'#ffcc44' }}>★{e.ability}</span>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
        <V2Pager page={page} total={filtered.length} onPage={setRawPage} unit="種" />
        {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}
      </div>
    </div>
  )
}
