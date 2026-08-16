import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { AREAS } from '../lib/enemies.js'
import { equippedItems } from '../lib/loadout.js'
import {
  MATERIAL_BY_ID, RARITY_LABEL, RARITY_COLOR, COLOR_LABEL, COLOR_HEX,
  EXTRACT_COST, canExtract, essencePower, materialsOfArea,
} from '../lib/material.js'
import { enchantOf } from '../lib/enchant.js'
import { STAT_DEFS } from '../lib/stats.js'
import { box, miniBtn } from './v2ui.js'

// エンチャント：素材を見る → 5個選んで抽出 → できたエッセンスを武器のソケットへ。
// ★抽選の権威はサーバー（v2_extract_essence）。ここは選んで送るだけ。
const TABS = [
  { key:'mats',    label:'素材' },
  { key:'extract', label:'抽出' },
  { key:'socket',  label:'ソケット' },
]

const statLine = (stats) =>
  Object.entries(stats || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${STAT_DEFS[k]?.label || k}+${v}%`)
    .join(' / ')

// エッセンス1個の見出し
function EssenceTag({ e }) {
  return (
    <span style={{ color: COLOR_HEX[e.color], fontSize:'11px' }}>
      ●{COLOR_LABEL[e.color]} <span style={{ color:'#88ccff' }}>{statLine(e.stats)}</span>
      {e.ability && <span style={{ color:'#ffcc44' }}>　★{e.ability}</span>}
    </span>
  )
}

export default function V2Enchant({ prof, inventory, materials, essences, onRefresh, onBack }) {
  const [tab, setTab] = useState('mats')
  const [area, setArea] = useState(1)
  const [picked, setPicked] = useState([])      // 抽出に使う素材ID（同じIDを重ねてよい）
  const [result, setResult] = useState(null)    // 直前の抽出結果
  const [target, setTarget] = useState(null)    // ソケットにはめる対象 { invId, slot, color }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const held = useMemo(() => {
    const m = {}
    for (const r of materials || []) m[r.material_id] = r.qty
    return m
  }, [materials])
  // 選んだぶんを引いた残り
  const left = (id) => (held[id] || 0) - picked.filter(p => p === id).length

  const call = async (fn, args) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setMsg(error.message); return null }
    if (!data?.ok) { setMsg(data?.error || '失敗しました'); return null }
    await onRefresh()
    return data
  }

  const doExtract = async () => {
    const err = canExtract(picked)
    if (err) { setMsg(err); return }
    const data = await call('v2_extract_essence', { p_materials: picked })
    if (!data) return
    setPicked([])
    setResult(data.essence)
  }

  const pick = (id) => {
    if (picked.length >= EXTRACT_COST || left(id) <= 0) return
    setPicked(p => [...p, id])
    setMsg('')
  }
  const unpick = (i) => setPicked(p => p.filter((_, j) => j !== i))

  // 装着中の武器だけを対象にする（倉庫で寝ている武器のエンチャントは効かないので、はめる意味が薄い）
  const worn = equippedItems(prof, inventory)
  const weapons = Object.entries(worn)
    .filter(([, w]) => w.item.part === '武器')
    .map(([slot, w]) => ({ slot, inv: w.inv, item: w.item, sockets: w.inv.sockets || [] }))
  const socketed = useMemo(() => {
    const m = {}
    for (const e of essences || []) if (e.inv_id != null) m[`${e.inv_id}:${e.socket_idx}`] = e
    return m
  }, [essences])
  const spare = (essences || []).filter(e => e.inv_id == null)

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      <div style={{ display:'flex', gap:'4px', marginBottom:'10px' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMsg('') }}
            style={{ ...miniBtn(tab === t.key ? '#00aaff' : '#446688'), padding:'6px 12px', fontSize:'11px',
              background: tab === t.key ? '#002850' : '#000818' }}>
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft:'auto', alignSelf:'center', color:'#446688', fontSize:'10px' }}>
          エッセンス {spare.length}個（未使用）
        </span>
      </div>

      {/* ===== 素材 ===== */}
      {tab === 'mats' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {AREAS.map(a => (
              <button key={a.id} onClick={() => setArea(a.id)}
                style={{ ...miniBtn(area === a.id ? '#00aaff' : '#446688'), background: area === a.id ? '#002850' : '#000818' }}>
                {a.id}
              </button>
            ))}
            <span style={{ color:'#88ccff', fontSize:'11px', alignSelf:'center', marginLeft:'6px' }}>
              {AREAS.find(a => a.id === area)?.name}
            </span>
          </div>
          {materialsOfArea(area).filter(m => held[m.id]).length === 0 && (
            <div style={{ color:'#446688', fontSize:'11px' }}>このエリアの素材はまだ持っていません（出撃で手に入ります）</div>
          )}
          {materialsOfArea(area).map(m => held[m.id] ? (
            <div key={m.id} style={{ borderTop:'1px solid #002244', padding:'5px 0', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ color: RARITY_COLOR[m.rarity], fontSize:'10px', minWidth:'34px' }}>{RARITY_LABEL[m.rarity]}</span>
              <span style={{ color:'#88ccff', fontSize:'12px' }}>{m.name}</span>
              <span style={{ color:'#ffffff', fontSize:'11px' }}>×{held[m.id]}</span>
              <span style={{ color:'#556677', fontSize:'10px' }}>
                {m.enemy}　{m.stats.map(k => STAT_DEFS[k].label).join('・')} {m.lo}〜{m.hi}%
                {m.isBoss && <span style={{ color:'#ffcc44' }}>　ボス素材</span>}
              </span>
            </div>
          ) : null)}
        </div>
      )}

      {/* ===== 抽出 ===== */}
      {tab === 'extract' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>
            素材を{EXTRACT_COST}個選んで抽出する。ステータスの型も値も抽出したときに決まる（ボス素材は1個まで）
          </div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {Array.from({ length: EXTRACT_COST }, (_, i) => {
              const m = picked[i] ? MATERIAL_BY_ID[picked[i]] : null
              return (
                <button key={i} onClick={() => m && unpick(i)} disabled={!m}
                  style={{ flex:'1 1 110px', background:'#000818', border:`1px solid ${m ? RARITY_COLOR[m.rarity] : '#223344'}`,
                    color: m ? '#88ccff' : '#334455', padding:'8px 4px', fontFamily:'monospace', fontSize:'10px',
                    cursor: m ? 'pointer' : 'default' }}>
                  {m ? m.name : '—'}
                </button>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
            <button onClick={doExtract} disabled={busy || picked.length !== EXTRACT_COST}
              style={{ ...miniBtn(picked.length === EXTRACT_COST ? '#ffcc00' : '#334455'), padding:'8px 16px', fontSize:'12px' }}>
              ⚗ 抽出する
            </button>
            {picked.length > 0 && (
              <button onClick={() => setPicked([])} style={miniBtn('#ff8888')}>選び直す</button>
            )}
          </div>

          {result && (
            <div style={{ border:'1px solid #0066cc', background:'#001028', padding:'8px', marginBottom:'10px' }}>
              <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'4px' }}>
                ⚗ エッセンスができた！（合計 {essencePower(result.stats)}%）
              </div>
              <EssenceTag e={result} />
              {/* 特殊能力が当たっていたら、候補から1つ選ぶ */}
              {!result.ability && (result.ability_choices || []).length > 0 && (
                <div style={{ marginTop:'6px' }}>
                  <div style={{ color:'#ffcc44', fontSize:'10px', marginBottom:'4px' }}>★特殊能力が付いた！ 1つ選ぶ</div>
                  {result.ability_choices.map(name => (
                    <button key={name} disabled={busy}
                      onClick={async () => {
                        const d = await call('v2_choose_ability', { p_essence_id: result.id, p_ability: name })
                        if (d) setResult(d.essence)
                      }}
                      style={{ ...miniBtn('#ffcc44'), display:'block', width:'100%', textAlign:'left', marginBottom:'3px' }}>
                      {name}：{enchantOf(name)?.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 選べる素材 */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {AREAS.map(a => (
              <button key={a.id} onClick={() => setArea(a.id)}
                style={{ ...miniBtn(area === a.id ? '#00aaff' : '#446688'), background: area === a.id ? '#002850' : '#000818' }}>
                {a.id}
              </button>
            ))}
          </div>
          {materialsOfArea(area).map(m => held[m.id] ? (
            <button key={m.id} onClick={() => pick(m.id)} disabled={left(m.id) <= 0 || picked.length >= EXTRACT_COST}
              style={{ display:'block', width:'100%', textAlign:'left', background:'#000818',
                border:'1px solid #002244', borderLeft:`3px solid ${RARITY_COLOR[m.rarity]}`,
                color: left(m.id) > 0 ? '#88ccff' : '#334455', padding:'5px 8px', marginBottom:'2px',
                fontFamily:'monospace', fontSize:'11px', cursor: left(m.id) > 0 ? 'pointer' : 'default' }}>
              {m.name} <span style={{ color:'#ffffff' }}>×{left(m.id)}</span>
              <span style={{ color:'#556677' }}>　{m.stats.map(k => STAT_DEFS[k].label).join('・')} {m.lo}〜{m.hi}%</span>
            </button>
          ) : null)}
        </div>
      )}

      {/* ===== ソケット ===== */}
      {tab === 'socket' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>
            ソケットがあるのは武器だけ（片手2枠・両手3枠）。色はドロップしたときに決まっていて、
            <span style={{ color:'#88ccff' }}>色の合うエッセンスしか入らない</span>。
            外すには専用アイテムが要る（残り{prof?.unsocket_tickets || 0}個）
          </div>

          {weapons.length === 0 && <div style={{ color:'#446688', fontSize:'11px' }}>武器を装着してください</div>}
          {weapons.map(w => (
            <div key={w.slot} style={{ borderTop:'1px solid #002244', padding:'8px 0' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'4px' }}>
                {w.item.name}{w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
              </div>
              {w.sockets.length === 0 && (
                <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                  <span style={{ color:'#886644', fontSize:'10px' }}>
                    ソケットがありません（この機能より前に拾った武器）
                  </span>
                  <button disabled={busy} onClick={() => call('v2_backfill_sockets', {})} style={miniBtn('#cc88ff')}>
                    ソケットを開ける
                  </button>
                </div>
              )}
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {w.sockets.map((c, i) => {
                  const e = socketed[`${w.inv.id}:${i}`]
                  const isTarget = target && target.invId === w.inv.id && target.slot === i
                  return (
                    <div key={i} style={{ flex:'1 1 200px', border:`1px solid ${isTarget ? '#ffcc00' : COLOR_HEX[c]}`,
                      background:'#000818', padding:'6px' }}>
                      <div style={{ color: COLOR_HEX[c], fontSize:'10px' }}>●{COLOR_LABEL[c]}の枠</div>
                      {e ? (
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'4px' }}>
                          <EssenceTag e={e} />
                          <button disabled={busy || !(prof?.unsocket_tickets > 0)}
                            onClick={() => call('v2_unsocket_essence', { p_essence_id: e.id })}
                            style={miniBtn(prof?.unsocket_tickets > 0 ? '#ff8888' : '#334455')}>外す</button>
                        </div>
                      ) : (
                        <button onClick={() => setTarget(isTarget ? null : { invId: w.inv.id, slot: i, color: c })}
                          style={{ ...miniBtn(isTarget ? '#ffcc00' : '#00aaff'), marginTop:'3px' }}>
                          {isTarget ? 'やめる' : 'ここに入れる'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* はめる先を選んだら、色の合うエッセンスを並べる */}
          {target && (
            <div style={{ borderTop:'1px solid #0066cc', marginTop:'8px', paddingTop:'8px' }}>
              <div style={{ color: COLOR_HEX[target.color], fontSize:'11px', marginBottom:'4px' }}>
                ●{COLOR_LABEL[target.color]}の枠に入れるエッセンスを選ぶ
              </div>
              {spare.filter(e => e.color === target.color).length === 0 && (
                <div style={{ color:'#446688', fontSize:'11px' }}>この色の未使用エッセンスがありません</div>
              )}
              {spare.filter(e => e.color === target.color).map(e => (
                <button key={e.id} disabled={busy}
                  onClick={async () => {
                    const ok = await call('v2_socket_essence', { p_essence_id: e.id, p_inventory_id: target.invId, p_slot: target.slot })
                    if (ok) setTarget(null)
                  }}
                  style={{ display:'block', width:'100%', textAlign:'left', background:'#000818',
                    border:'1px solid #002244', padding:'5px 8px', marginBottom:'2px',
                    fontFamily:'monospace', cursor:'pointer' }}>
                  <EssenceTag e={e} />
                </button>
              ))}
            </div>
          )}

          {/* まだどこにも入れていないエッセンス */}
          {!target && spare.length > 0 && (
            <div style={{ borderTop:'1px solid #002244', marginTop:'8px', paddingTop:'8px' }}>
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>未使用のエッセンス</div>
              {spare.map(e => (
                <div key={e.id} style={{ padding:'3px 0' }}>
                  <EssenceTag e={e} />
                  {(e.ability_choices || []).length > 0 && !e.ability && (
                    <span style={{ color:'#ffcc44', fontSize:'10px' }}>　★特殊能力を選べます（抽出タブ）</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}
    </div>
  )
}
