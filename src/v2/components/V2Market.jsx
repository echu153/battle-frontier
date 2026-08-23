import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import V2ItemTip from './V2ItemTip.jsx'
import V2Modal from './V2Modal.jsx'
import { ITEM_BY_ID, powerOf, statsOf } from '../lib/equipment.js'
import { STAT_DEFS, STAT_KEYS } from '../lib/stats.js'
import {
  FEE_PCT, feeOf, payoutOf, LISTING_DAYS, MAX_LISTINGS, PRICE_MAX,
  equipFloorOf, listingLeftOf, SORTS, sortListings,
} from '../lib/market.js'
import {
  defaultFilter, filterRows, pageOf, pageCount, clampPage, PAGE_SIZE,
  RANK_OPTIONS, TYPE_OPTIONS,
} from '../lib/browse.js'
import { box, btn, miniBtn, RANK_COLOR, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— 取引所
// ------------------------------------------------------------
// 設計は docs/v2-market-design.md、値段と規則は src/v2/lib/market.js が正。
//
// ★**Goldはここでしか消えない**（手数料25%）。素材のNPC売却で湧いたぶんを吸う唯一の穴。
// ★出品できるかの判定はサーバーの v2_can_list() が正。画面は理由を出すだけで、独自に弾かない。
const gold = (n) => `${Number(n || 0).toLocaleString()}G`

export default function V2Market({ prof, onProfile, onBack }) {
  const [tab, setTab] = useState('buy')
  const [rows, setRows] = useState([])        // 並んでいる出品
  const [sellable, setSellable] = useState([])// 自分の持ち物（出せるかの理由つき）
  const [sold, setSold] = useState({})        // 直近の成約価格
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sort, setSort] = useState('cheap')
  const [filter, setFilter] = useState({ ...defaultFilter })
  const [page, setPage] = useState(1)
  const [listing, setListing] = useState(null) // 出品しようとしている持ち物
  const [price, setPrice] = useState('')
  const [buying, setBuying] = useState(null)   // 買おうとしている出品

  const call = async (fn, args) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc(fn, args || {})
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '失敗しました'); return null }
    return data
  }
  const load = async () => {
    const [a, b] = await Promise.all([
      supabase.rpc('v2_market_browse'),
      supabase.rpc('v2_market_sellable'),
    ])
    if (a.data?.ok) { setRows(a.data.rows || []); setSold(a.data.sold || {}) }
    if (b.data?.ok) setSellable(b.data.rows || [])
    if (a.error || b.error) setMsg((a.error || b.error).message)
  }
  useEffect(() => { load() }, [])

  // ---- 買う ----
  // 一覧は browse.js の絞り込みをそのまま使う（倉庫・鍛冶屋と同じ操作感）
  const cards = useMemo(() => rows
    .map(r => ({ ...r, item: ITEM_BY_ID[r.equip_id] }))
    .filter(r => r.item)
    .map(r => ({ ...r, power: powerOf(r.item, r.plus) })), [rows])
  const shown = useMemo(() => {
    const f = filterRows(cards.map(c => ({ item:c.item, plus:c.plus, row:c })), filter)
    return sortListings(f.map(x => x.row), sort)
  }, [cards, filter, sort])
  const pages = pageCount(shown.length)
  const view = pageOf(shown, clampPage(page, pages))
  useEffect(() => { setPage(1) }, [filter, sort, tab])

  const doBuy = async () => {
    const d = await call('v2_market_buy', { p_id: buying.id })
    setBuying(null)
    if (!d) return
    setMsg(`買いました（${gold(d.price)}・手数料${gold(d.fee)}は売り手に渡らず消えます）`)
    await load(); onProfile(null)
  }
  const doList = async () => {
    const d = await call('v2_market_list', { p_inv: listing.id, p_price: Math.floor(Number(price) || 0) })
    if (!d) return
    setListing(null); setPrice('')
    setMsg(`出品しました（${gold(d.price)}・${LISTING_DAYS}日で戻ります）`)
    await load()
  }
  const doCancel = async (id) => {
    if (!await call('v2_market_cancel', { p_id: id })) return
    setMsg('出品を取り消しました')
    await load()
  }

  const mine = rows.filter(r => r.mine)
  const held = Number(prof?.gold || 0)

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'6px' }}>
          <span style={{ color:'#ffcc00', fontSize:'13px' }}>🏪 取引所</span>
          <span style={{ color:'#ffcc00', fontSize:'12px' }}>所持 {gold(held)}</span>
        </div>
        <div style={{ color: TEXT.label, fontSize:'10px', lineHeight:1.8 }}>
          プレイヤー同士で装備を売買します。売り手が受け取るのは
          <b style={{ color:'#ff8866' }}>手数料{FEE_PCT}%を引いたぶん</b>で、引かれたGoldは誰にも渡らず消えます。<br />
          出品できるのは<b style={{ color:'#88ccff' }}>ルーンを刻んでいない・装備していない</b>もの。
          出品は{LISTING_DAYS}日で手元に戻り、同時に{MAX_LISTINGS}件まで出せます。<br />
          買った装備は<b style={{ color:'#ffcc00' }}>{LISTING_DAYS}日たつと再出品できます</b>（強化も刻印もすぐ自由）。
        </div>
      </div>

      <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
        {[['buy', `買う（${rows.length}）`], ['sell', '売る'], ['mine', `自分の出品（${mine.length}）`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ ...btn(tab === k ? '#ffcc00' : '#5a7fa0'), background: tab === k ? '#332a00' : '#001840' }}>
            {label}
          </button>
        ))}
      </div>

      {msg && <div style={{ ...box, padding:'8px 10px', marginBottom:'10px', color:'#ffcc44', fontSize:'11px' }}>{msg}</div>}

      {/* ===== 買う ===== */}
      {tab === 'buy' && (
        <div style={{ ...box, padding:'12px' }}>
          <MarketFilter filter={filter} setFilter={setFilter} sort={sort} setSort={setSort}
            shown={shown.length} total={cards.length} />
          {!view.length && <div style={{ color: TEXT.empty, fontSize:'11px', padding:'20px 0', textAlign:'center' }}>
            出品がありません。
          </div>}
          {view.map(r => (
            <Row key={r.id} r={r} sold={sold[`${r.equip_id}#${r.plus}`]}
              right={r.mine
                ? <span style={{ color: TEXT.empty, fontSize:'10px' }}>自分の出品</span>
                : <button disabled={busy || held < r.price} onClick={() => setBuying(r)}
                    style={miniBtn(held >= r.price ? '#44ff88' : '#62789a')}>
                    {held >= r.price ? '買う' : 'Gold不足'}
                  </button>} />
          ))}
          {pages > 1 && <Pager page={clampPage(page, pages)} pages={pages} onPage={setPage} />}
        </div>
      )}

      {/* ===== 売る ===== */}
      {tab === 'sell' && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'8px' }}>
            出せないものには理由を出しています（無言では弾きません）。
          </div>
          {sellable.filter(s => ITEM_BY_ID[s.equip_id]).slice(0, 200).map(s => {
            const item = ITEM_BY_ID[s.equip_id]
            const floor = equipFloorOf(item.rank, s.plus)
            return (
              <div key={s.id} style={line}>
                <V2ItemTip item={item} inv={s} runes={[]}>
                  <span style={{ color: RANK_COLOR[item.rank] }}>{item.rank}</span>{' '}
                  <span style={{ color:'#88ccff' }}>{item.name}</span>
                  {s.plus ? <span style={{ color:'#ffcc00' }}>+{s.plus}</span> : ''}
                </V2ItemTip>
                <span style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center' }}>
                  {s.reason
                    ? <span style={{ color:'#ff8866', fontSize:'10px' }}>{s.reason}</span>
                    : <>
                        <span style={{ color: TEXT.label, fontSize:'10px' }}>下限 {gold(floor)}</span>
                        <button disabled={busy} onClick={() => { setListing({ ...s, item, floor }); setPrice(String(floor)) }}
                          style={miniBtn('#ffcc00')}>出品</button>
                      </>}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== 自分の出品 ===== */}
      {tab === 'mine' && (
        <div style={{ ...box, padding:'12px' }}>
          {!mine.length && <div style={{ color: TEXT.empty, fontSize:'11px', padding:'20px 0', textAlign:'center' }}>
            出品していません。
          </div>}
          {mine.map(r => (
            <Row key={r.id} r={{ ...r, item: ITEM_BY_ID[r.equip_id] }} sold={sold[`${r.equip_id}#${r.plus}`]}
              right={<>
                <span style={{ color: TEXT.label, fontSize:'10px' }}>
                  手取り {gold(payoutOf(r.price))}／あと{listingLeftOf(r.listed_at)}日
                </span>
                <button disabled={busy} onClick={() => doCancel(r.id)} style={miniBtn('#ff8888')}>取り消す</button>
              </>} />
          ))}
        </div>
      )}

      {/* 出品の確認 */}
      {listing && (
        <V2Modal title="🏪 出品する" color="#ffcc00" confirmLabel="出品する" busy={busy}
          onConfirm={doList} onClose={() => { setListing(null); setPrice('') }}>
          <div style={{ color: RANK_COLOR[listing.item.rank] }}>
            {listing.item.rank}級「{listing.item.name}{listing.plus ? ` +${listing.plus}` : ''}」
          </div>
          <div style={{ color: TEXT.sub, fontSize:'11px', margin:'6px 0' }}>
            下限 {gold(listing.floor)}　／　上限 {gold(PRICE_MAX)}
          </div>
          <input type="number" value={price} min={listing.floor} max={PRICE_MAX}
            onChange={e => setPrice(e.target.value)}
            style={{ width:'100%', background:'#000818', color:'#ffcc00', border:'1px solid #0044aa',
              padding:'8px', fontFamily:'monospace', fontSize:'14px' }} />
          <div style={{ color:'#cfe2ff', marginTop:'8px', fontSize:'12px' }}>
            売れたときの手取り <b style={{ color:'#44ff88' }}>{gold(payoutOf(Number(price) || 0))}</b>
            <span style={{ color:'#ff8866' }}>（手数料 {gold(feeOf(Number(price) || 0))} は消えます）</span>
          </div>
        </V2Modal>
      )}

      {/* 購入の確認 */}
      {buying && (
        <V2Modal title="🏪 買う" color="#44ff88" confirmLabel="買う" busy={busy}
          onConfirm={doBuy} onClose={() => setBuying(null)}>
          <div style={{ color: RANK_COLOR[ITEM_BY_ID[buying.equip_id]?.rank] }}>
            {ITEM_BY_ID[buying.equip_id]?.rank}級「{ITEM_BY_ID[buying.equip_id]?.name}
            {buying.plus ? ` +${buying.plus}` : ''}」
          </div>
          <div style={{ color:'#cfe2ff', marginTop:'6px' }}>
            {gold(buying.price)} を支払います（残り {gold(held - buying.price)}）
          </div>
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'8px' }}>
            買ったあと{LISTING_DAYS}日は再出品できません。強化・刻印はすぐにできます。
          </div>
        </V2Modal>
      )}
    </div>
  )
}

const line = { display:'flex', gap:'8px', alignItems:'center', fontSize:'11px',
  padding:'6px 0', borderBottom:'1px solid #002244', flexWrap:'wrap' }

// 出品1件の行
function Row({ r, sold, right }) {
  const item = r.item || ITEM_BY_ID[r.equip_id]
  if (!item) return null
  const st = statsOf(item, r.plus)
  return (
    <div style={{ ...line, alignItems:'flex-start' }}>
      <div style={{ flex:'1 1 200px', minWidth:0 }}>
        <V2ItemTip item={item} inv={r} runes={[]}>
          <span style={{ color: RANK_COLOR[item.rank] }}>{item.rank}</span>{' '}
          <span style={{ color:'#88ccff' }}>{item.name}</span>
          {r.plus ? <span style={{ color:'#ffcc00' }}>+{r.plus}</span> : ''}
          <span style={{ color: TEXT.label }}>　戦闘力{powerOf(item, r.plus)}</span>
        </V2ItemTip>
        <div style={{ color:'#93a9be', fontSize:'10px' }}>
          {STAT_KEYS.filter(k => st[k]).map(k => `${STAT_DEFS[k].label}+${st[k]}`).join(' / ')}
        </div>
        <div style={{ color: TEXT.empty, fontSize:'9px' }}>
          出品者 {r.seller || '？'}
          {sold ? `　直近の成約 ${gold(sold)}` : ''}
        </div>
      </div>
      <div style={{ display:'flex', gap:'8px', alignItems:'center', flexShrink:0 }}>
        <span style={{ color:'#ffcc00', fontSize:'13px' }}>{gold(r.price)}</span>
        {right}
      </div>
    </div>
  )
}

// 絞り込み（倉庫・鍛冶屋と同じ browse.js を使う）
function MarketFilter({ filter, setFilter, sort, setSort, shown, total }) {
  const set = (k, v) => setFilter(f => ({ ...f, [k]: v }))
  const sel = { background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontSize:'10px', padding:'2px 4px' }
  return (
    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', marginBottom:'8px', fontSize:'10px' }}>
      <span style={{ color: TEXT.label }}>ランク</span>
      <select value={filter.rank} onChange={e => set('rank', e.target.value)} style={sel}>
        {RANK_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <span style={{ color: TEXT.label }}>種類</span>
      <select value={filter.type} onChange={e => set('type', e.target.value)} style={sel}>
        {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={() => setFilter(defaultFilter)} style={miniBtn('#88aaff')}>絞り込み解除</button>
      <span style={{ color: TEXT.label }}>並べ替え</span>
      <select value={sort} onChange={e => setSort(e.target.value)} style={sel}>
        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <span style={{ marginLeft:'auto', color: TEXT.empty }}>{shown}件 / 全{total}件</span>
    </div>
  )
}

function Pager({ page, pages, onPage }) {
  return (
    <div style={{ display:'flex', gap:'6px', justifyContent:'center', alignItems:'center', marginTop:'8px' }}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} style={miniBtn(page > 1 ? '#88ccff' : '#62789a')}>◀</button>
      <span style={{ color: TEXT.label, fontSize:'10px' }}>{page} / {pages}（{PAGE_SIZE}件ずつ）</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} style={miniBtn(page < pages ? '#88ccff' : '#62789a')}>▶</button>
    </div>
  )
}
