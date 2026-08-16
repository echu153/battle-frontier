import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { AREAS } from '../lib/enemies.js'
import { equippedItems } from '../lib/loadout.js'
import {
  MATERIAL_BY_ID, RARITY_LABEL, RARITY_COLOR, COLOR_LABEL, COLOR_HEX,
  EXTRACT_COST, BOSS_LIMIT, canExtract, essencePower, essenceName, essenceFullName, materialsOfArea,
} from '../lib/material.js'
import { enchantOf } from '../lib/enchant.js'
import { STAT_DEFS } from '../lib/stats.js'
import { box, miniBtn } from './v2ui.js'
import V2Modal from './V2Modal.jsx'

// エンチャント：素材を見る → 5個選んで抽出 → できたエッセンスを武器のソケットへ。
// ★抽選の権威はサーバー（v2_extract_essence）。ここは選んで送るだけ。
const TABS = [
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
      ●{COLOR_LABEL[e.color]}
      {' '}<b>{essenceName(e.color, e.stats)}</b>
      {' '}<span style={{ color:'#88ccff' }}>{statLine(e.stats)}</span>
      {e.ability && <span style={{ color:'#ffcc44' }}>　★{e.ability}</span>}
    </span>
  )
}

// embedded … 鍛冶屋の中に置くとき。自前の「← ホームへ」は出さない（外側が持っている）
export default function V2Enchant({ prof, inventory, materials, essences, onRefresh, onBack, embedded = false }) {
  const [tab, setTab] = useState('extract')
  const [area, setArea] = useState(1)
  const [picked, setPicked] = useState([])      // 抽出に使う素材ID（同じIDを重ねてよい）
  const [confirm, setConfirm] = useState(false) // 抽出前の確認ポップアップ
  const [result, setResult] = useState(null)    // 抽出後の結果ポップアップ
  const [overwrite, setOverwrite] = useState(null) // 上書き前の確認 { essence, target }
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
    if (err) { setMsg(err); setConfirm(false); return }
    const data = await call('v2_extract_essence', { p_materials: picked })
    setConfirm(false)
    if (!data) return
    setPicked([])
    setResult(data.essence)   // 結果はポップアップで出す
  }

  // ソケットへ入れる。ふさがっている枠は**上書き＝元のエッセンスが消える**ので確認を1段挟む
  const doSocket = async (essenceId, t) => {
    const ok = await call('v2_socket_essence', { p_essence_id: essenceId, p_inventory_id: t.invId, p_slot: t.slot })
    setOverwrite(null)
    if (ok) setTarget(null)
  }

  // ★ボス素材は5枠に1個まで。1個選んだ時点で**他のボス素材は選べなくする**
  //   （選べてしまってから抽出で弾かれるのは分かりにくい）
  const bossPicked = picked.filter(id => MATERIAL_BY_ID[id]?.isBoss).length >= BOSS_LIMIT
  const canPick = (m) => left(m.id) > 0 && picked.length < EXTRACT_COST && !(m.isBoss && bossPicked)

  const pick = (id) => {
    const m = MATERIAL_BY_ID[id]
    if (!m || !canPick(m)) return
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
      {!embedded && <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>}

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
            <button onClick={() => setConfirm(true)} disabled={busy || picked.length !== EXTRACT_COST}
              style={{ ...miniBtn(picked.length === EXTRACT_COST ? '#ffcc00' : '#334455'), padding:'8px 16px', fontSize:'12px' }}>
              ⚗ 抽出する
            </button>
            {picked.length > 0 && (
              <button onClick={() => setPicked([])} style={miniBtn('#ff8888')}>選び直す</button>
            )}
          </div>

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
            <button key={m.id} onClick={() => pick(m.id)} disabled={!canPick(m)}
              style={{ display:'block', width:'100%', textAlign:'left', background:'#000818',
                border:'1px solid #002244', borderLeft:`3px solid ${RARITY_COLOR[m.rarity]}`,
                color: canPick(m) ? '#88ccff' : '#334455', opacity: canPick(m) ? 1 : 0.45,
                padding:'5px 8px', marginBottom:'2px',
                fontFamily:'monospace', fontSize:'11px', cursor: canPick(m) ? 'pointer' : 'default' }}>
              {m.name} <span style={{ color:'#ffffff' }}>×{left(m.id)}</span>
              <span style={{ color:'#556677' }}>
                　{m.enemy}　{m.stats.map(k => STAT_DEFS[k].label).join('・')} {m.lo}〜{m.hi}%
              </span>
              {m.isBoss && <span style={{ color:'#ffcc44' }}>　ボス素材</span>}
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
            <span style={{ color:'#88ccff' }}>外す</span>には専用アイテムが要る（残り{prof?.unsocket_tickets || 0}個）。
            アイテムが無くても<span style={{ color:'#cc88ff' }}>上書き</span>はできるが、
            そのとき<span style={{ color:'#ff8844' }}>元のエッセンスは消える</span>
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
                        <>
                          <EssenceTag e={e} />
                          <div style={{ display:'flex', gap:'4px', marginTop:'3px' }}>
                            {/* 外す＝エッセンスが無傷で戻る。専用アイテムが要る */}
                            <button disabled={busy || !(prof?.unsocket_tickets > 0)}
                              onClick={() => call('v2_unsocket_essence', { p_essence_id: e.id })}
                              style={miniBtn(prof?.unsocket_tickets > 0 ? '#ff8888' : '#334455')}>外す</button>
                            {/* 上書き＝アイテムは要らないが、**いま入っているエッセンスは消える** */}
                            <button onClick={() => setTarget(isTarget ? null : { invId: w.inv.id, slot: i, color: c, over: e })}
                              style={miniBtn(isTarget ? '#ffcc00' : '#cc88ff')}>
                              {isTarget ? 'やめる' : '上書き'}
                            </button>
                          </div>
                        </>
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
              {target.over && (
                <div style={{ color:'#ff8844', fontSize:'10px', marginBottom:'4px' }}>
                  ⚠上書きすると、いま入っている「{statLine(target.over.stats)}」は消えます
                  （残したいなら「外す」で取り出してください）
                </div>
              )}
              {spare.filter(e => e.color === target.color).length === 0 && (
                <div style={{ color:'#446688', fontSize:'11px' }}>この色の未使用エッセンスがありません</div>
              )}
              {spare.filter(e => e.color === target.color).map(e => (
                <button key={e.id} disabled={busy}
                  onClick={() => (target.over ? setOverwrite({ essence: e, target }) : doSocket(e.id, target))}
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
                    <button onClick={() => setResult(e)} style={{ ...miniBtn('#ffcc44'), marginLeft:'6px' }}>
                      ★特殊能力を選ぶ
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}

      {/* ===== 抽出前の確認 ===== */}
      {confirm && (
        <V2Modal title="⚗ 抽出の確認" color="#ffcc00" danger busy={busy}
          confirmLabel="抽出する" onConfirm={doExtract} onClose={() => !busy && setConfirm(false)}>
          <div style={{ color:'#88ccff' }}>次の{EXTRACT_COST}個を使います（<b style={{ color:'#ff8844' }}>素材は戻りません</b>）</div>
          <div style={{ margin:'6px 0' }}>
            {picked.map((id, i) => {
              const m = MATERIAL_BY_ID[id]
              return (
                <div key={i} style={{ fontSize:'11px' }}>
                  <span style={{ color: RARITY_COLOR[m.rarity] }}>{RARITY_LABEL[m.rarity]}</span>
                  {' '}<span style={{ color:'#88ccff' }}>{m.name}</span>
                  <span style={{ color:'#556677' }}>　{m.stats.map(k => STAT_DEFS[k].label).join('・')} {m.lo}〜{m.hi}%</span>
                </div>
              )
            })}
          </div>
          <div style={{ color:'#556677', fontSize:'11px' }}>
            ステータスの型も値も、いま抽選されます。色は5個の合計で決まります。
          </div>
        </V2Modal>
      )}

      {/* ===== 抽出の結果 ===== */}
      {result && (
        <V2Modal title={`⚗ ${essenceFullName(result.color, result.stats)}ができた！`} color={COLOR_HEX[result.color]}
          onClose={() => setResult(null)}
          closeLabel={!result.ability && (result.ability_choices || []).length > 0 ? 'あとで選ぶ' : '受け取る'}>
          <div style={{ color:'#44ff88', fontSize:'13px' }}>合計 {essencePower(result.stats)}%</div>
          <div style={{ marginTop:'4px' }}><EssenceTag e={result} /></div>
          {/* 特殊能力が当たっていたら、候補から1つ選ぶ */}
          {!result.ability && (result.ability_choices || []).length > 0 && (
            <div style={{ marginTop:'10px' }}>
              <div style={{ color:'#ffcc44', fontSize:'11px', marginBottom:'4px' }}>★特殊能力が付いた！ 1つ選ぶ</div>
              {result.ability_choices.map(name => (
                <button key={name} disabled={busy}
                  onClick={async () => {
                    const d = await call('v2_choose_ability', { p_essence_id: result.id, p_ability: name })
                    if (d) setResult(d.essence)
                  }}
                  style={{ ...miniBtn('#ffcc44'), display:'block', width:'100%', textAlign:'left', marginBottom:'3px', padding:'6px' }}>
                  {name}：{enchantOf(name)?.text}
                </button>
              ))}
            </div>
          )}
        </V2Modal>
      )}

      {/* ===== 上書きの確認（元のエッセンスが消える）===== */}
      {overwrite && (
        <V2Modal title="⚠ 上書きの確認" color="#ff8844" danger busy={busy}
          confirmLabel="上書きする" onConfirm={() => doSocket(overwrite.essence.id, overwrite.target)}
          onClose={() => !busy && setOverwrite(null)}>
          <div style={{ color:'#ff8844' }}>いま入っているエッセンスは<b>消えます</b>。</div>
          <div style={{ marginTop:'6px', fontSize:'11px', color:'#556677' }}>消えるもの</div>
          <EssenceTag e={overwrite.target.over} />
          <div style={{ marginTop:'6px', fontSize:'11px', color:'#556677' }}>入れるもの</div>
          <EssenceTag e={overwrite.essence} />
          <div style={{ color:'#556677', fontSize:'11px', marginTop:'8px' }}>
            残したいなら「やめる」→「外す」で取り出してください（専用アイテムが1個要ります）。
          </div>
        </V2Modal>
      )}
    </div>
  )
}
