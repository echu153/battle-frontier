import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { AREAS } from '../lib/enemies.js'
import { equippedItems } from '../lib/loadout.js'
import {
  MATERIAL_BY_ID, RARITY_LABEL, RARITY_COLOR, COLOR_LABEL, COLOR_HEX,
  EXTRACT_COST, BOSS_LIMIT, canExtract, runePower, runeName, runeFullName, materialsOfArea,
  RARITIES, sellPriceOf, sellTotalOf,
} from '../lib/material.js'
import { enchantOf } from '../lib/enchant.js'
import { STAT_DEFS } from '../lib/stats.js'
import { useStored } from '../lib/prefs.js'
import { box, miniBtn } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import { V2RuneFilter, V2Pager } from './V2Browse.jsx'
import {
  defaultRuneFilter, filterRunes, sortRunes, pageOf, clampPage,
} from '../lib/browse.js'

// エンチャント：素材を見る → 5個選んで抽出 → できたルーンを武器のソケットへ。
// ★抽選の権威はサーバー（v2_extract_essence）。ここは選んで送るだけ。
// 「注入」だと素っ気ないので**刻印**にした（2026-08-16 ユーザー指示「もっとかっこよく」）
const TABS = [
  { key:'extract', label:'⚗ ルーン作成' },
  { key:'socket',  label:'◈ ルーン刻印' },
  // ★素材の売却＝**v2で唯一Goldが湧く場所**（docs/v2-gold-design.md）。敵はGoldを落とさない
  { key:'sell',    label:'💰 素材売却' },
]

const statLine = (stats) =>
  Object.entries(stats || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${STAT_DEFS[k]?.label || k}+${v}%`)
    .join(' / ')

// 付与された特殊能力の1行。★敵の名前ではなく**実際の効果**を出す
//   （名前だけだと何が起きるのか分からない。出どころは後ろに小さく添える）
function AbilityLine({ ability }) {
  if (!ability) return null
  return (
    <div style={{ color:'#ffcc44', fontSize:'12px', marginTop:'4px' }}>
      【特殊能力】{enchantOf(ability)?.text || ability}
      <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'6px' }}>（{ability}）</span>
    </div>
  )
}

// ルーン1個の見出し。showAbility=false にすると★の部分を出さない
//（結果のポップアップは AbilityLine で別行に出すので、二重にならないようにする）
function RuneTag({ e, size = '11px', showAbility = true }) {
  return (
    <span style={{ color: COLOR_HEX[e.color], fontSize: size }}>
      ●{COLOR_LABEL[e.color]}
      {' '}<b>{runeName(e.color, e.stats)}</b>
      {' '}<span style={{ color:'#88ccff' }}>{statLine(e.stats)}</span>
      {showAbility && e.ability && <span style={{ color:'#ffcc44' }}>　★{e.ability}</span>}
    </span>
  )
}

// embedded … 鍛冶屋の中に置くとき。自前の「← ホームへ」は出さない（外側が持っている）
export default function V2Enchant({ prof, inventory, materials, runes, onRefresh, onBack, embedded = false }) {
  // ★見ていたタブと絞り込みは覚えておく（倉庫・鍛冶屋と同じ）
  const [tab, setTab] = useStored('enchantTab', 'extract')
  const [area, setArea] = useState(1)
  const [picked, setPicked] = useState([])      // 抽出に使う素材ID（同じIDを重ねてよい）
  const [confirm, setConfirm] = useState(false) // 抽出前の確認ポップアップ
  const [result, setResult] = useState(null)    // 抽出後の結果ポップアップ
  const [overwrite, setOverwrite] = useState(null) // 上書き前の確認 { rune, target }
  const [seal, setSeal] = useState(null)           // 刻印前の確認 { rune, target }
  const [sealed, setSealed] = useState(null)       // 刻印後の結果 { rune, target, overwrote }
  const [target, setTarget] = useState(null)    // ソケットにはめる対象 { invId, slot, color }
  const [runeFilter, setEssFilter] = useStored('runeFilter', defaultRuneFilter, true)  // ルーン一覧の絞り込み
  const [rawRunePage, setRawEssPage] = useState(0)
  const [sell, setSell] = useState({})          // 売却タブで選んだ数 { 素材ID: 個数 }
  const [sellConfirm, setSellConfirm] = useState(false)
  const [sold, setSold] = useState(null)        // 売却の結果 { gained, gold }
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

  // ソケットへ入れる。ふさがっている枠は**上書き＝元のルーンが消える**ので確認を1段挟む
  const doSocket = async (rune, t) => {
    const ok = await call('v2_socket_essence', { p_essence_id: rune.id, p_inventory_id: t.invId, p_slot: t.slot })
    setOverwrite(null); setSeal(null)
    if (!ok) return
    setTarget(null)
    setSealed({ rune, target: t, overwrote: !!t.over })   // 結果はポップアップで出す
  }

  // ===== 素材の売却 =====
  // ★売値の権威はサーバー（v2_materials.sell）。ここは選んで送るだけで、金額は表示のためだけ
  const sellItems = Object.entries(sell)
    .map(([id, qty]) => ({ id, qty: Math.min(qty, held[id] || 0) }))
    .filter(it => it.qty > 0)
  const sellTotal = sellTotalOf(sellItems)
  const setSellQty = (id, qty) =>
    setSell(s => {
      const n = Math.max(0, Math.min(qty, held[id] || 0))
      const next = { ...s }
      if (n === 0) delete next[id]; else next[id] = n
      return next
    })
  // 表示中のエリアの、そのレア度を持っているぶん全部
  const sellAllOf = (rarity) =>
    setSell(s => {
      const next = { ...s }
      for (const m of materialsOfArea(area)) {
        if (m.rarity !== rarity) continue
        if (held[m.id] > 0) next[m.id] = held[m.id]
      }
      return next
    })
  const doSell = async () => {
    const data = await call('v2_sell_materials', { p_items: sellItems })
    setSellConfirm(false)
    if (!data) return
    setSell({})
    setSold(data)   // 結果はポップアップで出す
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
    for (const e of runes || []) if (e.inv_id != null) m[`${e.inv_id}:${e.socket_idx}`] = e
    return m
  }, [runes])
  const spare = (runes || []).filter(e => e.inv_id == null)
  // ★一覧が長くなるので、倉庫・鍛冶屋と同じ絞り込みとページ送りを付ける（browse.js が共通）
  //   枠を選んでいるあいだは、その枠の色だけに固定する
  const runeRows = sortRunes(
    filterRunes(spare, { ...runeFilter, color: target ? target.color : runeFilter.color }),
    runeFilter.sort, runeFilter.asc)
  const runePage = clampPage(rawRunePage, runeRows.length)
  const runeShown = pageOf(runeRows, runePage)

  return (
    <div>
      {!embedded && <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>}

      <div style={{ display:'flex', gap:'4px', marginBottom:'10px' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMsg('') }}
            style={{ ...miniBtn(tab === t.key ? '#00aaff' : '#7fa6d0'), padding:'6px 12px', fontSize:'11px',
              background: tab === t.key ? '#002850' : '#000818' }}>
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft:'auto', alignSelf:'center', color:'#7fa6d0', fontSize:'10px' }}>
          ルーン {spare.length}個（未使用）
        </span>
      </div>

      {/* ===== 抽出 ===== */}
      {tab === 'extract' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'6px' }}>
            素材を{EXTRACT_COST}個選んでルーンを作る。ステータスの型も値も、作った瞬間に決まる（ボス素材は1個まで）
          </div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {Array.from({ length: EXTRACT_COST }, (_, i) => {
              const m = picked[i] ? MATERIAL_BY_ID[picked[i]] : null
              return (
                <button key={i} onClick={() => m && unpick(i)} disabled={!m}
                  style={{ flex:'1 1 110px', background:'#000818', border:`1px solid ${m ? RARITY_COLOR[m.rarity] : '#223344'}`,
                    color: m ? '#88ccff' : '#62789a', padding:'8px 4px', fontFamily:'monospace', fontSize:'10px',
                    cursor: m ? 'pointer' : 'default' }}>
                  {m ? m.name : '—'}
                </button>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
            <button onClick={() => setConfirm(true)} disabled={busy || picked.length !== EXTRACT_COST}
              style={{ ...miniBtn(picked.length === EXTRACT_COST ? '#ffcc00' : '#62789a'), padding:'8px 16px', fontSize:'12px' }}>
              ⚗ ルーン作成
            </button>
            {picked.length > 0 && (
              <button onClick={() => setPicked([])} style={miniBtn('#ff8888')}>選び直す</button>
            )}
          </div>

          {/* 選べる素材 */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {AREAS.map(a => (
              <button key={a.id} onClick={() => setArea(a.id)}
                style={{ ...miniBtn(area === a.id ? '#00aaff' : '#7fa6d0'), background: area === a.id ? '#002850' : '#000818' }}>
                {a.id}
              </button>
            ))}
          </div>
          {materialsOfArea(area).map(m => held[m.id] ? (
            <button key={m.id} onClick={() => pick(m.id)} disabled={!canPick(m)}
              style={{ display:'block', width:'100%', textAlign:'left', background:'#000818',
                border:'1px solid #002244', borderLeft:`3px solid ${RARITY_COLOR[m.rarity]}`,
                color: canPick(m) ? '#88ccff' : '#62789a', opacity: canPick(m) ? 1 : 0.45,
                padding:'5px 8px', marginBottom:'2px',
                fontFamily:'monospace', fontSize:'11px', cursor: canPick(m) ? 'pointer' : 'default' }}>
              <span style={{ color: RARITY_COLOR[m.rarity] }}>{m.name}</span>
              {' '}<span style={{ color:'#ffffff' }}>×{left(m.id)}</span>
              <span style={{ color:'#93a9be' }}>{'　'}{m.enemy}{'　'}{m.stats.map(k => STAT_DEFS[k].label).join('・')}</span>
              {m.isBoss && <span style={{ color:'#ffcc44' }}>　ボス素材</span>}
            </button>
          ) : null)}
        </div>
      )}

      {/* ===== 素材売却 ===== */}
      {tab === 'sell' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'8px' }}>
            素材を売ってGoldにする。<span style={{ color:'#ffcc44' }}>敵はGoldを落とさない</span>ので、
            ここがGoldの入口。<span style={{ color:'#ff8844' }}>売った素材は戻らない</span>
            （同じ素材はルーン作成にも使う）
          </div>

          {/* エリア */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'6px' }}>
            {AREAS.map(a => (
              <button key={a.id} onClick={() => setArea(a.id)}
                style={{ ...miniBtn(area === a.id ? '#00aaff' : '#7fa6d0'), background: area === a.id ? '#002850' : '#000818' }}>
                {a.id}
              </button>
            ))}
          </div>
          {/* まとめて選ぶ（表示中のエリアぶん） */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {RARITIES.map(r => (
              <button key={r} onClick={() => sellAllOf(r)} style={miniBtn(RARITY_COLOR[r])}>
                {RARITY_LABEL[r]}を全部
              </button>
            ))}
            {sellItems.length > 0 && (
              <button onClick={() => setSell({})} style={miniBtn('#ff8888')}>選び直す</button>
            )}
          </div>

          {materialsOfArea(area).map(m => held[m.id] ? (
            <div key={m.id}
              style={{ display:'flex', alignItems:'center', gap:'4px', background:'#000818',
                border:'1px solid #002244', borderLeft:`3px solid ${RARITY_COLOR[m.rarity]}`,
                padding:'4px 6px', marginBottom:'2px', fontFamily:'monospace', fontSize:'11px' }}>
              <span style={{ color: RARITY_COLOR[m.rarity], flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {m.name}
                <span style={{ color:'#ffffff' }}>{' '}×{held[m.id]}</span>
                <span style={{ color:'#93a9be' }}>{'　'}1個 {sellPriceOf(m).toLocaleString()} G</span>
              </span>
              <button onClick={() => setSellQty(m.id, (sell[m.id] || 0) - 1)} disabled={!sell[m.id]}
                style={{ ...miniBtn(sell[m.id] ? '#88aaff' : '#3a4a60'), padding:'2px 7px' }}>−</button>
              <span style={{ color: sell[m.id] ? '#ffcc00' : '#62789a', minWidth:'26px', textAlign:'center' }}>
                {sell[m.id] || 0}
              </span>
              <button onClick={() => setSellQty(m.id, (sell[m.id] || 0) + 1)} disabled={(sell[m.id] || 0) >= held[m.id]}
                style={{ ...miniBtn((sell[m.id] || 0) < held[m.id] ? '#88aaff' : '#3a4a60'), padding:'2px 7px' }}>＋</button>
              <button onClick={() => setSellQty(m.id, held[m.id])} style={{ ...miniBtn('#7fa6d0'), padding:'2px 6px' }}>全部</button>
            </div>
          ) : null)}
          {materialsOfArea(area).every(m => !held[m.id]) && (
            <div style={{ color:'#62789a', fontSize:'11px', padding:'6px 0' }}>このエリアの素材は持っていない</div>
          )}

          {/* 合計 */}
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'10px',
            borderTop:'1px solid #002244', paddingTop:'10px' }}>
            <span style={{ color:'#7fa6d0', fontSize:'11px' }}>
              {sellItems.reduce((t, it) => t + it.qty, 0)}個
            </span>
            <span style={{ color:'#ffcc00', fontSize:'13px' }}>{sellTotal.toLocaleString()} G</span>
            <button onClick={() => setSellConfirm(true)} disabled={busy || sellItems.length === 0}
              style={{ ...miniBtn(sellItems.length ? '#ffcc00' : '#62789a'), marginLeft:'auto', padding:'8px 16px', fontSize:'12px' }}>
              💰 売る
            </button>
          </div>
        </div>
      )}

      {/* ===== ソケット ===== */}
      {tab === 'socket' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'8px' }}>
            ルーンを刻めるのは武器だけ（片手2枠・両手3枠）。枠の色はドロップしたときに決まっていて、
            <span style={{ color:'#88ccff' }}>色の合うルーンしか刻めない</span>。
            <span style={{ color:'#88ccff' }}>外す</span>には専用アイテムが要る（残り{prof?.unsocket_tickets || 0}個）。
            アイテムが無くても<span style={{ color:'#cc88ff' }}>上書き</span>はできるが、
            そのとき<span style={{ color:'#ff8844' }}>元のルーンは消える</span>
          </div>

          {weapons.length === 0 && <div style={{ color:'#7fa6d0', fontSize:'11px' }}>武器を装着してください</div>}
          {weapons.map(w => (
            <div key={w.slot} style={{ borderTop:'1px solid #002244', padding:'8px 0' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'4px' }}>
                {w.item.name}{w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
              </div>
              {w.sockets.length === 0 && (
                <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                  <span style={{ color:'#c69a5c', fontSize:'10px' }}>
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
                      {/* ★枠の色は「まだ空いているとき」だけ出す。刻んだあとはルーンが主役 */}
                      {!e && <div style={{ color: COLOR_HEX[c], fontSize:'10px' }}>●{COLOR_LABEL[c]}の枠</div>}
                      {e ? (
                        <>
                          <RuneTag e={e} />
                          <div style={{ display:'flex', gap:'4px', marginTop:'3px' }}>
                            {/* 外す＝ルーンが無傷で戻る。専用アイテムが要る */}
                            <button disabled={busy || !(prof?.unsocket_tickets > 0)}
                              onClick={() => call('v2_unsocket_essence', { p_essence_id: e.id })}
                              style={miniBtn(prof?.unsocket_tickets > 0 ? '#ff8888' : '#62789a')}>外す</button>
                            {/* 上書き＝アイテムは要らないが、**いま入っているルーンは消える** */}
                            <button onClick={() => setTarget(isTarget ? null : { invId: w.inv.id, slot: i, color: c, over: e, name: w.item.name + (w.inv.plus ? '+' + w.inv.plus : '') })}
                              style={miniBtn(isTarget ? '#ffcc00' : '#cc88ff')}>
                              {isTarget ? 'やめる' : '上書き'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <button onClick={() => setTarget(isTarget ? null : { invId: w.inv.id, slot: i, color: c, name: w.item.name + (w.inv.plus ? '+' + w.inv.plus : '') })}
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

          {/* ルーンの一覧。枠を選んでいるときは「その色だけ」に固定して、押すと刻める */}
          <div style={{ borderTop:`1px solid ${target ? '#0066cc' : '#002244'}`, marginTop:'8px', paddingTop:'8px' }}>
            <div style={{ color: target ? COLOR_HEX[target.color] : '#7fa6d0', fontSize:'11px', marginBottom:'4px' }}>
              {target
                ? `●${COLOR_LABEL[target.color]}の枠に刻むルーンを選ぶ`
                : '未使用のルーン'}
            </div>
            {target?.over && (
              <div style={{ color:'#ff8844', fontSize:'10px', marginBottom:'4px' }}>
                ⚠上書きすると、いま入っている「{statLine(target.over.stats)}」は消えます
                （残したいなら「外す」で取り出してください）
              </div>
            )}
            <V2RuneFilter value={runeFilter} lockColor={target?.color || null}
              onChange={f => { setEssFilter(f); setRawEssPage(0) }} />
            {runeRows.length === 0 && (
              <div style={{ color:'#7fa6d0', fontSize:'11px' }}>
                {spare.length === 0 ? 'まだルーンがありません（抽出でできます）' : '絞り込みに合うルーンがありません'}
              </div>
            )}
            {runeShown.map(e => (
              <button key={e.id} disabled={busy || !target}
                onClick={() => target && (target.over ? setOverwrite({ rune: e, target }) : setSeal({ rune: e, target }))}
                style={{ display:'flex', alignItems:'center', gap:'6px', width:'100%', textAlign:'left',
                  background:'#000818', border:`1px solid ${target ? '#004488' : '#002244'}`,
                  padding:'5px 8px', marginBottom:'2px',
                  fontFamily:'monospace', cursor: target ? 'pointer' : 'default' }}>
                <RuneTag e={e} />
                {(e.ability_choices || []).length > 0 && !e.ability && (
                  <span onClick={ev => { ev.stopPropagation(); setResult(e) }}
                    style={{ ...miniBtn('#ffcc44'), marginLeft:'auto' }}>★特殊能力を選ぶ</span>
                )}
              </button>
            ))}
            <V2Pager page={runePage} total={runeRows.length} onPage={setRawEssPage} unit="個" />
          </div>
        </div>
      )}

      {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}

      {/* ===== 抽出前の確認 ===== */}
      {confirm && (
        <V2Modal title="⚗ ルーン作成の確認" color="#ffcc00" danger busy={busy}
          confirmLabel="作成する" onConfirm={doExtract} onClose={() => !busy && setConfirm(false)}>
          <div style={{ color:'#88ccff' }}>次の{EXTRACT_COST}個を使います（<b style={{ color:'#ff8844' }}>素材は戻りません</b>）</div>
          <div style={{ margin:'6px 0' }}>
            {picked.map((id, i) => {
              const m = MATERIAL_BY_ID[id]
              return (
                <div key={i} style={{ fontSize:'11px' }}>
                  <span style={{ color: RARITY_COLOR[m.rarity] }}>{RARITY_LABEL[m.rarity]}</span>
                  {' '}<span style={{ color:'#88ccff' }}>{m.name}</span>
                  <span style={{ color:'#93a9be' }}>　{m.stats.map(k => STAT_DEFS[k].label).join('・')}</span>
                </div>
              )
            })}
          </div>
          <div style={{ color:'#93a9be', fontSize:'11px' }}>
            ステータスの型も値も、いま抽選されます。色は5個の合計で決まります。
          </div>
        </V2Modal>
      )}

      {/* ===== 売却前の確認 ===== */}
      {sellConfirm && (
        <V2Modal title="💰 売却の確認" color="#ffcc00" danger busy={busy}
          confirmLabel="売る" onConfirm={doSell} onClose={() => !busy && setSellConfirm(false)}>
          <div style={{ color:'#88ccff' }}>
            次の素材を売ります（<b style={{ color:'#ff8844' }}>素材は戻りません</b>）
          </div>
          <div style={{ margin:'6px 0', maxHeight:'40vh', overflowY:'auto' }}>
            {sellItems.map(it => {
              const m = MATERIAL_BY_ID[it.id]
              return (
                <div key={it.id} style={{ fontSize:'11px', display:'flex', gap:'6px' }}>
                  <span style={{ color: RARITY_COLOR[m.rarity] }}>{m.name}</span>
                  <span style={{ color:'#ffffff' }}>×{it.qty}</span>
                  <span style={{ marginLeft:'auto', color:'#93a9be' }}>
                    {(sellPriceOf(m) * it.qty).toLocaleString()} G
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ color:'#ffcc00', fontSize:'13px', borderTop:'1px solid #002a55', paddingTop:'6px' }}>
            合計 {sellTotal.toLocaleString()} G
          </div>
        </V2Modal>
      )}

      {/* ===== 売却の結果 ===== */}
      {sold && (
        <V2Modal title="💰 売った！" color="#ffcc00" onClose={() => setSold(null)}>
          <div style={{ color:'#ffcc00', fontSize:'15px' }}>+{(sold.gained || 0).toLocaleString()} G</div>
          <div style={{ color:'#93a9be', fontSize:'11px', marginTop:'4px' }}>
            所持金：{(sold.gold || 0).toLocaleString()} G
          </div>
        </V2Modal>
      )}

      {/* ===== 抽出の結果 ===== */}
      {result && (
        <V2Modal title={`⚗ ${runeFullName(result.color, result.stats)}ができた！`} color={COLOR_HEX[result.color]}
          onClose={() => setResult(null)}
          closeLabel={!result.ability && (result.ability_choices || []).length > 0 ? 'あとで選ぶ' : '受け取る'}>
          {/* ルーン本体は左、合計値は右端。長いと折り返すので flexWrap を付けておく */}
          <div style={{ display:'flex', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
            <RuneTag e={result} size="15px" showAbility={false} />
            <span style={{ marginLeft:'auto', color:'#44ff88', fontSize:'12px', whiteSpace:'nowrap' }}>
              （合計値：{runePower(result.stats)}%）
            </span>
          </div>
          <AbilityLine ability={result.ability} />
          {/* 特殊能力が当たっていたら、候補から1つ選ぶ */}
          {!result.ability && (result.ability_choices || []).length > 0 && (
            <div style={{ marginTop:'10px' }}>
              <div style={{ color:'#ffcc44', fontSize:'11px', marginBottom:'4px' }}>ルーンに付与する特殊能力を1つ選んでください</div>
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

      {/* ===== 刻印の結果 ===== */}
      {sealed && (
        <V2Modal title="◈ 刻印した！" color={COLOR_HEX[sealed.rune.color]} onClose={() => setSealed(null)}>
          <div style={{ display:'flex', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
            <RuneTag e={sealed.rune} size="15px" showAbility={false} />
            <span style={{ marginLeft:'auto', color:'#44ff88', fontSize:'12px', whiteSpace:'nowrap' }}>
              （合計値：{runePower(sealed.rune.stats)}%）
            </span>
          </div>
          <AbilityLine ability={sealed.rune.ability} />
          <div style={{ color:'#88ccff', marginTop:'6px' }}>
            <b>{sealed.target.name}</b> の ●{COLOR_LABEL[sealed.target.color]}の枠 に刻印した！
          </div>
          {sealed.overwrote && (
            <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'4px' }}>
              上書きしたので、前に刻んでいたルーンは消えた
            </div>
          )}
        </V2Modal>
      )}

      {/* ===== 刻印の確認（外すのが難しいので1段挟む）===== */}
      {seal && (
        <V2Modal title="◈ 刻印の確認" color={COLOR_HEX[seal.target.color]} busy={busy}
          confirmLabel="刻印する" onConfirm={() => doSocket(seal.rune, seal.target)}
          onClose={() => !busy && setSeal(null)}>
          <div style={{ color:'#88ccff' }}>
            <b>{seal.target.name}</b> の ●{COLOR_LABEL[seal.target.color]}の枠 に刻みます
          </div>
          <div style={{ marginTop:'6px' }}><RuneTag e={seal.rune} size="13px" /></div>
          <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'10px', lineHeight:1.8 }}>
            ⚠ 一度刻むと<b>外すのが大変です</b>。<br />
            外して手元に戻すには専用アイテムが1個要ります（残り{prof?.unsocket_tickets || 0}個）。<br />
            アイテムが無いときは<b>上書きするしかなく、いま刻むルーンは消えます</b>。
          </div>
        </V2Modal>
      )}

      {/* ===== 上書きの確認（元のルーンが消える）===== */}
      {overwrite && (
        <V2Modal title="⚠ 上書きの確認" color="#ff8844" danger busy={busy}
          confirmLabel="上書きする" onConfirm={() => doSocket(overwrite.rune, overwrite.target)}
          onClose={() => !busy && setOverwrite(null)}>
          <div style={{ color:'#ff8844' }}>いま入っているルーンは<b>消えます</b>。</div>
          <div style={{ marginTop:'6px', fontSize:'11px', color:'#93a9be' }}>消えるもの</div>
          <RuneTag e={overwrite.target.over} />
          <div style={{ marginTop:'6px', fontSize:'11px', color:'#93a9be' }}>入れるもの</div>
          <RuneTag e={overwrite.rune} />
          <div style={{ color:'#93a9be', fontSize:'11px', marginTop:'8px' }}>
            残したいなら「やめる」→「外す」で取り出してください（専用アイテムが1個要ります）。
          </div>
        </V2Modal>
      )}
    </div>
  )
}
