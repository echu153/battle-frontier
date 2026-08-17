import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { MATERIAL_BY_ID, RARITIES, RARITY_LABEL, RARITY_COLOR } from '../lib/material.js'
import {
  FACILITIES, FACILITY_BY_KEY, MATERIAL_KINDS, KIND_BY_KEY,
  GRADE_MAX, CAP_HOURS, materialName, gradeLabel,
  previewOf, fullInOf, exchangeGainOf, exchangeTotalOf, EXCHANGE_RATE,
  upgradeBlockOf, reqAreaOf,
} from '../lib/basecamp.js'
import {
  TIERS, TIER_LABEL, TIER_COLOR, TIER_RATE, TIER_PCT,
  SPOTS, spotName, FISH, fishOfSpot, entryId, ENTRY_BY_ID, DEX_SLOTS,
  fishDexPct, fishDexText, dexIdsOf, DEX_FULL_TOTAL,
  MATERIAL_PCT, EQUIP_PCT, dropAreaMax,
  SHOP_MATERIAL_COST, materialShopCost, PROTECT_COST,
} from '../lib/fishing.js'
import { STAT_DEFS } from '../lib/stats.js'
import { box, btn, miniBtn, TEXT } from './v2ui.js'

// ============================================================
// 施設「拠点」— 開発限定
//   放置で資材・EXP・魚が貯まり、施設を拡張すると中身が良くなる。
//   設計は docs/v2-kyoten-design.md。
//
// ★数字の権威はサーバー（v2_base_get が rate / cap / upkeep をそのまま返す）。
//   この画面はレートを組み立て直さない。1秒ごとのカウンタだけ basecamp.js の
//   previewOf で進めていて、これは v2_base_settle と同じ式にしてある。
// ============================================================

const AREA_MARK = '①②③④⑤⑥⑦⑧'
const n = (v) => Math.floor(Number(v) || 0).toLocaleString()
const gold = (v) => `${n(v)}G`

export default function V2Base({ prof, materials, fishDex, isAdmin, onProfile, onBack }) {
  const [base, setBase] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)          // 回収・拡張などの結果
  const [tab, setTab] = useState('facilities')  // facilities / exchange / dex / medal
  const [now, setNow] = useState(Date.now())
  const [moveFrom, setMoveFrom] = useState('')
  const [exKind, setExKind] = useState('wood')
  const [picked, setPicked] = useState({})      // 交換に出す素材 { 素材ID: 個数 }
  const [openSpot, setOpenSpot] = useState(1)   // 図鑑で開いている釣り場エリア

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // 開設していなければその場で作る（v2_base_init は冪等で、足りない施設だけ作る）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase.rpc('v2_base_get')
      if (!alive) return
      if (err || !data?.ok) { setError(err?.message || data?.error || '拠点を開けませんでした'); setLoading(false); return }
      // 施設が足りない（釣り場を足した等）ときも init を通す
      const missing = FACILITIES.some(f => !(data.facilities || []).some(x => x.key === f.key))
      if (!data.initialized || missing) {
        const { data: init, error: e2 } = await supabase.rpc('v2_base_init')
        if (!alive) return
        if (e2 || !init?.ok) { setError(e2?.message || init?.error || '拠点を作れませんでした'); setLoading(false); return }
        setBase(init)
      } else {
        setBase(data)
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // サーバーの時刻とのズレ。表示のカウンタはこれを差し引いて進める
  const skew = useMemo(() => (base?.server_now ? new Date(base.server_now).getTime() - Date.now() : 0), [base?.server_now])
  const at = new Date(now + skew)

  const facilities = base?.facilities || []
  const facOf = (key) => facilities.find(f => f.key === key) || null
  const heldGold = Number(base?.gold || 0)
  const medals = Number(base?.medals || 0)
  const unlocked = base?.unlocked_areas || []
  const fishRows = base?.fish || []
  const fishing = facOf('fishing')

  // 資材の所持 { 種類: { グレード: 個数 } }
  const stock = useMemo(() => {
    const out = {}
    for (const m of base?.materials || []) {
      out[m.kind] = out[m.kind] || {}
      out[m.kind][m.grade] = m.qty
    }
    return out
  }, [base?.materials])
  const stockOf = (kind, grade) => stock[kind]?.[grade] || 0

  // 図鑑（登録済みのID）と所持数
  const dexSet = useMemo(() => new Set(dexIdsOf(fishRows)), [fishRows])
  const fishQty = useMemo(() => Object.fromEntries(fishRows.map(r => [r.id, r.qty])), [fishRows])
  const dexPct = useMemo(() => fishDexPct(fishRows), [fishRows])

  const call = async (fn, args, label) => {
    if (busy) return null
    setBusy(label); setError(''); setMsg(null)
    const { data, error: err } = await supabase.rpc(fn, args)
    setBusy('')
    if (err || !data?.ok) { setError(err?.message || data?.error || 'うまくいきませんでした'); return null }
    if (data.base) setBase(data.base)
    else if (data.facilities) setBase(data)
    onProfile(null)   // Gold・LV・素材・図鑑を取り直す
    return data
  }

  // 回収の結果を1つの表示にまとめる（釣り場エリアの切り替えでも同じ形で使う）
  const haulLines = (d) => {
    const out = []
    const gains = (d.gains || []).map(g => `${materialName(g.kind, g.grade)} +${n(g.qty)}`)
    if (gains.length) out.push(`📦 ${gains.join(' / ')}`)
    if (d.exp > 0) out.push(`🎯 EXP +${n(d.exp)}${d.level?.level_ups ? `（LV${d.level.level_ups}アップ！）` : ''}`)
    const h = d.haul
    if (h?.count > 0) {
      const caught = Object.entries(h.caught || {})
        .map(([id, q]) => `${ENTRY_BY_ID[id]?.name || id}（${TIER_LABEL[ENTRY_BY_ID[id]?.tier] || ''}）×${q}`)
      out.push(`🎣 ${h.count}匹釣れました`)
      if (caught.length) out.push(`　${caught.join(' / ')}`)
      if (h.materials > 0) out.push(`　🔹 ルーン素材 ×${h.materials}`)
      if (h.equips > 0) out.push(`　🎁 装備 ×${h.equips}`)
      for (const e of h.new_dex || []) {
        out.push(`📖 図鑑に「${e.name}（${TIER_LABEL[e.tier]}）」を登録！ ${STAT_DEFS[e.stat]?.label}+${e.pct}%`)
      }
    }
    if (d.cost > 0) out.push(`💰 労働者の維持費 -${gold(d.cost)}`)
    if (d.auto_collected > 0) out.push(`📦 上限が下がったぶんを回収: +${n(d.auto_collected)}`)
    return out
  }
  const haulWarn = (d) => [
    d.gold_short ? '⚠ Goldが尽きたため、途中で生産が止まっていました' : null,
    d.lv_capped ? '⚠ LVが上限のため、かかしは回収していません（貯めたまま残しています）' : null,
  ].filter(Boolean)

  const collect = async (key) => {
    const d = await call('v2_base_collect', { p_key: key || null }, `collect:${key || 'all'}`)
    if (!d) return
    const lines = haulLines(d)
    setMsg({ lines: lines.length ? lines : ['回収できるものがありませんでした'], warn: haulWarn(d) })
  }

  const upgrade = async (key) => {
    const d = await call('v2_base_upgrade', { p_key: key }, `upgrade:${key}`)
    if (!d) return
    setMsg({ lines: [`🔧 ${FACILITY_BY_KEY[key]?.name} をグレード${gradeLabel(d.grade)}にしました`], warn: [] })
  }

  const hire = async (key) => {
    const d = await call('v2_base_hire', { p_key: key }, `hire:${key}`)
    if (!d) return
    setMsg({ lines: [`🧑 ${FACILITY_BY_KEY[key]?.name} に労働者を雇いました（-${gold(d.cost)}）`], warn: [] })
  }

  const move = async (to) => {
    const from = moveFrom
    setMoveFrom('')
    const d = await call('v2_base_move_worker', { p_from: from, p_to: to }, `move:${to}`)
    if (!d) return
    setMsg({ lines: [`🧑 ${FACILITY_BY_KEY[from]?.name} → ${FACILITY_BY_KEY[to]?.name} へ労働者を移しました`], warn: [] })
  }

  // ★切り替えの前にサーバーが必ず釣り上げる。その結果もそのまま出す
  const setSpot = async (spot) => {
    const d = await call('v2_base_set_spot', { p_spot: spot }, `spot:${spot}`)
    if (!d) return
    const lines = [`🎣 釣り場を「${spotName(spot)}」に変えました`]
    if (d.collected?.ok) lines.push(...haulLines(d.collected))
    setMsg({ lines, warn: d.collected ? haulWarn(d.collected) : [] })
  }

  // ===== 素材 → 資材 =====
  const owned = useMemo(() => (materials || [])
    .filter(m => m.qty > 0 && MATERIAL_BY_ID[m.material_id])
    .map(m => ({ ...MATERIAL_BY_ID[m.material_id], qty: m.qty }))
    .sort((a, b) => a.area - b.area || a.idx - b.idx || RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity)),
    [materials])

  const items = Object.entries(picked)
    .map(([id, qty]) => ({ id, qty: Math.max(0, Math.min(qty, owned.find(o => o.id === id)?.qty || 0)) }))
    .filter(it => it.qty > 0)
  const gainByGrade = exchangeGainOf(items)
  const gainTotal = exchangeTotalOf(items)

  const pickAll = (rarity) => setPicked(p => {
    const next = { ...p }
    for (const o of owned) if (!rarity || o.rarity === rarity) next[o.id] = o.qty
    return next
  })

  const exchange = async () => {
    if (!items.length) return
    const d = await call('v2_base_exchange', { p_items: items, p_kind: exKind }, 'exchange')
    if (!d) return
    setPicked({})
    setMsg({ lines: [`🔁 ${(d.gained || []).map(g => `${materialName(d.kind, g.grade)} +${n(g.qty)}`).join(' / ')}`], warn: [] })
  }

  // ===== 魚 → メダル =====
  const heldFish = fishRows.filter(r => r.qty > 0)
  const medalGain = heldFish.reduce((t, r) => t + (ENTRY_BY_ID[r.id]?.medal || 0) * r.qty, 0)
  const toMedal = async () => {
    if (!heldFish.length) return
    const d = await call('v2_fish_to_medal', { p_items: heldFish.map(r => ({ id: r.id, qty: r.qty })) }, 'medal')
    if (!d) return
    setMsg({ lines: [`🪙 釣りメダル +${n(d.gained)}（所持 ${n(d.medals)}枚）`], warn: [] })
  }

  const buy = async (id, label) => {
    const d = await call('v2_fish_shop_buy', { p_id: id, p_qty: 1 }, `buy:${id}`)
    if (!d) return
    const got = (d.got || []).map(g => g.name || g.label).join(' / ')
    setMsg({ lines: [`🪙 ${label} と交換しました：${got}（残り ${n(d.medals)}枚）`], warn: [] })
  }

  if (loading) {
    return <div style={{ ...box, padding:'14px', marginBottom:'8px', color:TEXT.label, fontSize:'12px' }}>拠点を開いています...</div>
  }

  const TABS = [
    { key:'facilities', label:'🏠 施設' },
    { key:'exchange',   label:'🔁 資材に交換' },
    { key:'dex',        label:'📖 釣り図鑑' },
    { key:'medal',      label:'🪙 釣りメダル' },
  ]

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <span style={{ color:'#8fcf6f', fontSize:'13px' }}>🏕 拠点</span>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>
      <div style={{ color:TEXT.sub, fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        画面を閉じていても資材・EXP・魚が貯まります（{CAP_HOURS}時間で満杯）。
        <br />労働者はGoldで雇い、<span style={{ color:'#ffaa66' }}>維持費が払えなくなったところで生産が止まります</span>。
      </div>

      {/* 所持 */}
      <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'6px' }}>
          <span style={{ color:TEXT.label }}>所持Gold</span>
          <span style={{ color:'#ffcc00' }}>{gold(heldGold)}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'6px' }}>
          <span style={{ color:TEXT.label }}>釣りメダル</span>
          <span style={{ color:'#66ccff' }}>{n(medals)}枚</span>
        </div>
        {MATERIAL_KINDS.map(k => {
          const rows = Object.entries(stock[k.key] || {}).filter(([, q]) => q > 0)
          return (
            <div key={k.key} style={{ display:'flex', gap:'6px', alignItems:'baseline', fontSize:'11px', marginTop:'3px' }}>
              <span style={{ color:k.color, width:'40px', flexShrink:0 }}>{k.name}</span>
              <span style={{ color:TEXT.body, flex:1, minWidth:0, wordBreak:'break-all' }}>
                {rows.length
                  ? rows.sort((a, b) => a[0] - b[0]).map(([g, q]) => `${gradeLabel(Number(g))} ${n(q)}`).join(' ／ ')
                  : <span style={{ color:TEXT.empty }}>—</span>}
              </span>
            </div>
          )
        })}
      </div>

      {/* タブ */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'8px', flexWrap:'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMsg(null); setError('') }}
            style={{ ...miniBtn(tab === t.key ? '#8fcf6f' : '#62789a'), padding:'6px 10px', fontSize:'11px',
              background: tab === t.key ? '#04240c' : '#000818' }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div style={{ color:'#ff6666', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
      {msg && (
        <div style={{ border:'1px solid #2a6f3a', background:'#02180a', padding:'8px', marginBottom:'8px', fontSize:'11px', lineHeight:'1.9' }}>
          {msg.lines.map((l, i) => <div key={i} style={{ color:'#9be7a8', whiteSpace:'pre-wrap' }}>{l}</div>)}
          {msg.warn.map((l, i) => <div key={`w${i}`} style={{ color:'#ffaa66' }}>{l}</div>)}
        </div>
      )}

      {/* ===== 施設 ===== */}
      {tab === 'facilities' && (<>
        <button onClick={() => collect(null)} disabled={!!busy}
          style={{ ...btn('#8fcf6f'), width:'100%', padding:'10px', marginBottom:'8px', opacity: busy ? 0.4 : 1 }}>
          {busy === 'collect:all' ? '回収しています...' : '📦 すべて回収する'}
        </button>

        <div style={{ display:'grid', gap:'6px' }}>
          {FACILITIES.map(def => {
            const f = facOf(def.key)
            if (!f) return null
            const p = previewOf(f, heldGold, at)
            const cap = Number(f.cap || 0)
            const pct = cap > 0 ? Math.min(100, (p.pending / cap) * 100) : 0
            const mins = fullInOf(f, heldGold, at)
            const cost = f.next_cost
            const block = upgradeBlockOf(f.grade, unlocked)
            const need = reqAreaOf(f.grade + 1)
            const canPay = cost && heldGold >= Number(cost.gold) &&
              MATERIAL_KINDS.every(k => stockOf(k.key, f.grade) >= cost.qty)
            const isProducer = def.hasWorkers
            const full = isProducer ? f.workers >= f.worker_limit : false
            const unit = def.key === 'scarecrow' ? 'EXP' : def.key === 'fishing' ? '匹' : '個'

            return (
              <div key={def.key} style={{ background:'#000818', border:`1px solid ${def.color}44`, padding:'8px' }}>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ color:def.color, fontSize:'12px' }}>
                    {def.icon} {def.name}
                    <span style={{ color:TEXT.label, fontSize:'10px', marginLeft:'6px' }}>グレード{gradeLabel(f.grade)}</span>
                  </span>
                  <span style={{ color:TEXT.label, fontSize:'10px' }}>
                    {def.key === 'scarecrow' ? `EXP ${f.rate}/h` : `${f.rate}${unit}/h`}
                  </span>
                </div>

                {/* 貯まっている量 */}
                <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'3px' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background: p.full ? '#ffaa44' : def.color, transition:'width .4s linear' }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', marginBottom:'6px' }}>
                  <span style={{ color: p.full ? '#ffaa44' : TEXT.body }}>{n(p.pending)} / {n(cap)}{unit}</span>
                  <span style={{ color: p.goldShort ? '#ff6666' : TEXT.label }}>
                    {p.goldShort ? 'Goldが尽きて停止中'
                      : p.full ? '満杯です'
                      : mins != null ? `満杯まで約${Math.max(1, Math.round(mins))}分`
                      : isProducer ? '労働者がいません' : ''}
                  </span>
                </div>

                {/* 釣り場：どこで釣るかを選ぶ */}
                {def.key === 'fishing' && (
                  <div style={{ marginBottom:'6px' }}>
                    <div style={{ color:TEXT.label, fontSize:'10px', marginBottom:'3px' }}>
                      いま釣っている場所：<span style={{ color:'#66ccff' }}>{spotName(f.spot)}</span>
                      <span style={{ marginLeft:'6px' }}>
                        副産物 ルーン素材{MATERIAL_PCT(f.grade)}% / 装備{EQUIP_PCT(f.grade)}%（エリア{AREA_MARK[dropAreaMax(f.grade) - 1]}まで）
                      </span>
                    </div>
                    <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
                      {SPOTS.slice(0, f.grade).map(s => (
                        <button key={s.spot} onClick={() => setSpot(s.spot)} disabled={!!busy || s.spot === f.spot}
                          style={{ ...miniBtn(s.spot === f.spot ? '#66ccff' : '#62789a'),
                            background: s.spot === f.spot ? '#001840' : '#000818', opacity: busy ? 0.4 : 1 }}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                    <div style={{ color:TEXT.sub, fontSize:'9px', marginTop:'3px' }}>
                      場所を変えると、いまの場所ぶんを先に釣り上げます。
                    </div>
                  </div>
                )}

                {/* 労働者 */}
                {isProducer && (
                  <div style={{ display:'flex', alignItems:'center', gap:'5px', flexWrap:'wrap', fontSize:'10px', marginBottom:'6px' }}>
                    <span style={{ color:TEXT.label }}>労働者 {f.workers}/{f.worker_limit}</span>
                    <span style={{ color: f.upkeep > 0 ? '#ffaa66' : TEXT.empty }}>維持費 {gold(f.upkeep)}/h</span>
                    <button onClick={() => hire(def.key)}
                      disabled={!!busy || full || base.hire_cost == null || heldGold < Number(base.hire_cost || 0)}
                      style={{ ...miniBtn(full || base.hire_cost == null ? '#62789a' : '#ffcc00'),
                        opacity: (busy || full || base.hire_cost == null || heldGold < Number(base.hire_cost || 0)) ? 0.4 : 1 }}>
                      {base.hire_cost == null ? '雇用は上限' : full ? '受け入れ上限' : `雇う ${gold(base.hire_cost)}`}
                    </button>
                    {moveFrom === '' && f.workers > 0 && (
                      <button onClick={() => setMoveFrom(def.key)} disabled={!!busy} style={miniBtn('#88aaff')}>移す</button>
                    )}
                    {moveFrom === def.key && (
                      <button onClick={() => setMoveFrom('')} style={miniBtn('#aa5566')}>やめる</button>
                    )}
                    {moveFrom !== '' && moveFrom !== def.key && !full && (
                      <button onClick={() => move(def.key)} disabled={!!busy} style={miniBtn('#44ffaa')}>ここへ移す</button>
                    )}
                  </div>
                )}

                {/* 回収と拡張 */}
                <div style={{ display:'flex', gap:'5px', flexWrap:'wrap' }}>
                  <button onClick={() => collect(def.key)} disabled={!!busy || p.pending < 1}
                    style={{ ...miniBtn('#8fcf6f'), opacity: (busy || p.pending < 1) ? 0.4 : 1 }}>回収</button>
                  {f.grade < GRADE_MAX && cost && (
                    <button onClick={() => upgrade(def.key)} disabled={!!busy || !!block || !canPay}
                      style={{ ...miniBtn(block || !canPay ? '#62789a' : '#ffcc00'), opacity: (busy || block || !canPay) ? 0.4 : 1 }}>
                      グレード{gradeLabel(f.grade + 1)}へ
                    </button>
                  )}
                  {f.grade >= GRADE_MAX && <span style={{ color:'#ffcc00', fontSize:'10px', alignSelf:'center' }}>最大グレードです</span>}
                </div>

                {/* 拡張に要るもの */}
                {f.grade < GRADE_MAX && cost && (
                  <div style={{ color:TEXT.label, fontSize:'9px', marginTop:'5px', lineHeight:'1.8' }}>
                    必要：
                    {MATERIAL_KINDS.map(k => {
                      const have = stockOf(k.key, f.grade)
                      return (
                        <span key={k.key} style={{ color: have >= cost.qty ? '#9be7a8' : '#ff6666', marginRight:'6px' }}>
                          {materialName(k.key, f.grade)} {n(have)}/{n(cost.qty)}
                        </span>
                      )
                    })}
                    <span style={{ color: heldGold >= Number(cost.gold) ? '#9be7a8' : '#ff6666' }}>{gold(cost.gold)}</span>
                    {need > 0 && (
                      <span style={{ color: unlocked.includes(need) ? '#9be7a8' : '#ff6666', marginLeft:'6px' }}>
                        エリア{AREA_MARK[need - 1]}の解放
                      </span>
                    )}
                    {def.key === 'fishing' && <span style={{ marginLeft:'6px' }}>→「{spotName(f.grade + 1)}」が解放</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ color:TEXT.sub, fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
          生産施設は<span style={{ color:'#ffaa66' }}>グレードを上げても個数は増えません</span>。増えるのは出る資材のグレードです。
          <br />グレードⅢ以降の拡張には、その手前のエリアのボス撃破（＝エリアの解放）が要ります。
        </div>

        {isAdmin && (
          <button onClick={async () => {
            if (busy) return
            setBusy('reset'); setError(''); setMsg(null)
            const { data, error: err } = await supabase.rpc('v2_base_dev_reset')
            setBusy('')
            if (err || !data?.ok) { setError(err?.message || data?.error || 'リセットできませんでした'); return }
            const { data: init } = await supabase.rpc('v2_base_init')
            if (init?.ok) setBase(init)
            onProfile(null)
            setMsg({ lines: ['🧹 拠点をリセットしました（開発）'], warn: [] })
          }} style={{ ...miniBtn('#aa5566'), marginTop:'8px' }}>
            拠点をリセット［開発］
          </button>
        )}
      </>)}

      {/* ===== 素材 → 資材 ===== */}
      {tab === 'exchange' && (<>
        <div style={{ color:TEXT.sub, fontSize:'10px', lineHeight:'1.8', marginBottom:'8px' }}>
          エリア{AREA_MARK[0]}〜{AREA_MARK[7]}のルーン素材が、<span style={{ color:'#8fcf6f' }}>同じ番号のグレードの資材</span>になります。
          <br />通常1個→{EXCHANGE_RATE.normal}個 ／ レア1個→{EXCHANGE_RATE.rare}個 ／ 激レア1個→{EXCHANGE_RATE.ultra}個
        </div>

        <div style={{ display:'flex', gap:'4px', marginBottom:'6px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ color:TEXT.label, fontSize:'10px' }}>もらう資材</span>
          {MATERIAL_KINDS.map(k => (
            <button key={k.key} onClick={() => setExKind(k.key)}
              style={{ ...miniBtn(exKind === k.key ? k.color : '#62789a'), background: exKind === k.key ? '#001840' : '#000818' }}>
              {k.name}
            </button>
          ))}
        </div>

        <div style={{ display:'flex', gap:'4px', marginBottom:'6px', flexWrap:'wrap' }}>
          <span style={{ color:TEXT.label, fontSize:'10px', alignSelf:'center' }}>まとめて選ぶ</span>
          {RARITIES.map(r => (
            <button key={r} onClick={() => pickAll(r)} style={miniBtn(RARITY_COLOR[r])}>{RARITY_LABEL[r]}</button>
          ))}
          <button onClick={() => pickAll(null)} style={miniBtn('#88ccff')}>全部</button>
          <button onClick={() => setPicked({})} style={miniBtn('#aa5566')}>解除</button>
        </div>

        {owned.length === 0 && (
          <div style={{ color:TEXT.empty, fontSize:'11px', padding:'10px 0' }}>交換できる素材を持っていません。</div>
        )}

        <div style={{ display:'grid', gap:'2px', maxHeight:'320px', overflowY:'auto', marginBottom:'8px' }}>
          {owned.map(o => {
            const v = Math.min(picked[o.id] || 0, o.qty)
            return (
              <div key={o.id} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 6px',
                display:'flex', alignItems:'center', gap:'5px', fontSize:'10px' }}>
                <span style={{ color:TEXT.label, width:'18px', flexShrink:0 }}>{AREA_MARK[o.area - 1]}</span>
                <span style={{ color:RARITY_COLOR[o.rarity], flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {o.name}
                </span>
                <span style={{ color:TEXT.label, width:'46px', textAlign:'right' }}>所持{n(o.qty)}</span>
                <input type="number" min={0} max={o.qty} value={v}
                  onChange={e => setPicked(p => ({ ...p, [o.id]: Math.max(0, Math.min(o.qty, Number(e.target.value) || 0)) }))}
                  style={{ width:'54px', background:'#001028', border:'1px solid #0044aa', color:'#88ccff',
                    fontFamily:'monospace', fontSize:'10px', padding:'2px', textAlign:'center' }} />
                <button onClick={() => setPicked(p => ({ ...p, [o.id]: o.qty }))} style={miniBtn('#7fa6d0')}>全</button>
              </div>
            )
          })}
        </div>

        {gainTotal > 0 && (
          <div style={{ background:'#000818', border:'1px solid #002244', padding:'6px 8px', marginBottom:'8px', fontSize:'11px', lineHeight:'1.9' }}>
            <span style={{ color:TEXT.label }}>もらえる資材：</span>
            {Object.entries(gainByGrade).sort((a, b) => a[0] - b[0]).map(([g, q]) => (
              <span key={g} style={{ color:KIND_BY_KEY[exKind].color, marginRight:'8px' }}>
                {materialName(exKind, Number(g))} +{n(q)}
              </span>
            ))}
          </div>
        )}

        <button onClick={exchange} disabled={!!busy || gainTotal === 0}
          style={{ ...btn('#8fcf6f'), width:'100%', padding:'10px', opacity: (busy || gainTotal === 0) ? 0.4 : 1 }}>
          {busy === 'exchange' ? '交換しています...' : `🔁 交換する（${n(gainTotal)}個）`}
        </button>
      </>)}

      {/* ===== 釣り図鑑 ===== */}
      {tab === 'dex' && (<>
        <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px', fontSize:'11px', lineHeight:'1.9' }}>
          <div style={{ color:TEXT.label }}>
            登録 <span style={{ color:'#66ccff' }}>{dexSet.size}</span> / {DEX_SLOTS}枠
            <span style={{ marginLeft:'8px', color:TEXT.sub, fontSize:'10px' }}>（全部そろえると合計+{DEX_FULL_TOTAL}%）</span>
          </div>
          <div style={{ color:'#9be7a8' }}>
            {dexSet.size ? fishDexText(fishRows) : <span style={{ color:TEXT.empty }}>まだ何も登録していません</span>}
          </div>
          <div style={{ color:TEXT.sub, fontSize:'9px' }}>
            初めて釣った1枠につき、その魚のステータスが上がります（
            {TIERS.map(t => `${TIER_LABEL[t]}+${TIER_PCT[t]}%`).join(' / ')}）。効果は出撃とアリーナの両方に乗ります。
          </div>
        </div>

        <div style={{ display:'flex', gap:'3px', flexWrap:'wrap', marginBottom:'6px' }}>
          {SPOTS.map(s => {
            const got = fishOfSpot(s.spot).reduce((t, f) =>
              t + TIERS.filter(tr => dexSet.has(entryId(f.spot, f.idx, tr))).length, 0)
            const locked = !fishing || s.spot > fishing.grade
            return (
              <button key={s.spot} onClick={() => setOpenSpot(s.spot)}
                style={{ ...miniBtn(openSpot === s.spot ? '#66ccff' : locked ? '#62789a' : '#7fa6d0'),
                  background: openSpot === s.spot ? '#001840' : '#000818' }}>
                {s.name} {got}/{fishOfSpot(s.spot).length * TIERS.length}{locked ? '（未解放）' : ''}
              </button>
            )
          })}
        </div>

        <div style={{ display:'grid', gap:'2px' }}>
          {fishOfSpot(openSpot).map(f => (
            <div key={`${f.spot}:${f.idx}`} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 6px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', fontSize:'11px' }}>
                <span style={{ color:TEXT.body }}>{f.name}</span>
                <span style={{ color:STAT_DEFS[f.stat]?.color || TEXT.label, fontSize:'10px' }}>
                  {STAT_DEFS[f.stat]?.label}
                </span>
              </div>
              <div style={{ display:'flex', gap:'3px', marginTop:'3px', flexWrap:'wrap' }}>
                {TIERS.map(t => {
                  const id = entryId(f.spot, f.idx, t)
                  const got = dexSet.has(id)
                  return (
                    <span key={t} style={{ fontSize:'9px', padding:'2px 5px',
                      border:`1px solid ${got ? TIER_COLOR[t] : '#233'}`,
                      color: got ? TIER_COLOR[t] : TEXT.empty, background: got ? '#001028' : 'transparent' }}>
                      {TIER_LABEL[t]} {got ? `+${TIER_PCT[t]}%` : '—'}
                      {fishQty[id] > 0 ? `（${n(fishQty[id])}）` : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{ color:TEXT.sub, fontSize:'9px', marginTop:'6px', lineHeight:'1.8' }}>
          出やすさ：{TIERS.map(t => `${TIER_LABEL[t]}${TIER_RATE[t]}%`).join(' / ')}
        </div>
      </>)}

      {/* ===== 釣りメダル ===== */}
      {tab === 'medal' && (<>
        <div style={{ color:TEXT.sub, fontSize:'10px', lineHeight:'1.8', marginBottom:'8px' }}>
          釣った魚をメダルに換えて、ルーン素材と保護札に交換できます。
          <br /><span style={{ color:'#9be7a8' }}>図鑑への登録は釣った時点で済んでいるので、全部メダルにして構いません。</span>
        </div>

        <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'6px' }}>
            <span style={{ color:TEXT.label }}>手持ちの魚</span>
            <span style={{ color:TEXT.body }}>{n(heldFish.reduce((t, r) => t + r.qty, 0))}匹 → {n(medalGain)}枚</span>
          </div>
          <button onClick={toMedal} disabled={!!busy || medalGain === 0}
            style={{ ...btn('#66ccff'), width:'100%', padding:'8px', opacity: (busy || medalGain === 0) ? 0.4 : 1 }}>
            {busy === 'medal' ? '交換しています...' : `🪙 すべてメダルにする（+${n(medalGain)}枚）`}
          </button>
          {heldFish.length > 0 && (
            <div style={{ display:'grid', gap:'2px', marginTop:'6px', maxHeight:'160px', overflowY:'auto' }}>
              {heldFish.map(r => {
                const e = ENTRY_BY_ID[r.id]
                if (!e) return null
                return (
                  <div key={r.id} style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', padding:'2px 4px' }}>
                    <span style={{ color:TIER_COLOR[e.tier] }}>{e.name}（{TIER_LABEL[e.tier]}）</span>
                    <span style={{ color:TEXT.label }}>×{n(r.qty)} → {n(e.medal * r.qty)}枚</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ color:TEXT.label, fontSize:'11px', marginBottom:'4px' }}>交換所（所持 {n(medals)}枚）</div>
        <div style={{ display:'grid', gap:'2px', marginBottom:'8px' }}>
          <div style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px',
            display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:'11px' }}>
            <span style={{ color:'#ffcc00' }}>保護札（強化の失敗を防ぐ）</span>
            <button onClick={() => buy('protect', '保護札')} disabled={!!busy || medals < PROTECT_COST}
              style={{ ...miniBtn(medals < PROTECT_COST ? '#62789a' : '#ffcc00'), opacity: (busy || medals < PROTECT_COST) ? 0.4 : 1 }}>
              {PROTECT_COST}枚
            </button>
          </div>
        </div>

        <div style={{ color:TEXT.label, fontSize:'11px', marginBottom:'4px' }}>
          ルーン素材
          <span style={{ color:TEXT.sub, fontSize:'9px', marginLeft:'6px' }}>そのエリアのそのレア度から1個（敵は選べません）</span>
        </div>
        <div style={{ display:'grid', gap:'2px' }}>
          {Array.from({ length: 8 }, (_, i) => i + 1).map(area => (
            <div key={area} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px',
              display:'flex', alignItems:'center', gap:'5px', fontSize:'11px' }}>
              <span style={{ color:TEXT.label, width:'44px' }}>エリア{AREA_MARK[area - 1]}</span>
              {RARITIES.map(r => {
                const cost = materialShopCost(area, r)
                return (
                  <button key={r} onClick={() => buy(`mat:${area}:${r}`, `エリア${AREA_MARK[area - 1]}の${RARITY_LABEL[r]}素材`)}
                    disabled={!!busy || medals < cost}
                    style={{ ...miniBtn(medals < cost ? '#62789a' : RARITY_COLOR[r]), flex:1,
                      opacity: (busy || medals < cost) ? 0.4 : 1 }}>
                    {RARITY_LABEL[r]} {n(cost)}枚
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div style={{ color:TEXT.sub, fontSize:'9px', marginTop:'6px' }}>
          値段の目安：エリア番号 × 通常{SHOP_MATERIAL_COST.normal} / レア{SHOP_MATERIAL_COST.rare} / 激レア{SHOP_MATERIAL_COST.ultra}枚
        </div>
      </>)}
    </div>
  )
}
