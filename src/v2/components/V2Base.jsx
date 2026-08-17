import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { MATERIAL_BY_ID, RARITIES, RARITY_LABEL, RARITY_COLOR } from '../lib/material.js'
import {
  FACILITIES, FACILITY_BY_KEY, MATERIAL_KINDS, KIND_BY_KEY,
  GRADE_MAX, CAP_HOURS, materialName, gradeLabel,
  previewOf, fullInOf, exchangeGainOf, exchangeTotalOf, EXCHANGE_RATE,
  upgradeBlockOf, reqAreaOf,
} from '../lib/basecamp.js'
import { box, btn, miniBtn, TEXT } from './v2ui.js'

// ============================================================
// 施設「拠点」— 開発限定
//   放置で資材が貯まり、施設を拡張するとかかしのEXPが増える。
//   設計は docs/v2-kyoten-design.md。**釣り場は第2段階でここへ足す**。
//
// ★数字の権威はサーバー（v2_base_get が rate / cap / upkeep をそのまま返す）。
//   この画面はレートを組み立て直さない。1秒ごとのカウンタだけ basecamp.js の
//   previewOf で進めていて、これは v2_base_settle と同じ式にしてある。
// ============================================================

const AREA_MARK = '①②③④⑤⑥⑦⑧'
const n = (v) => Math.floor(Number(v) || 0).toLocaleString()
const gold = (v) => `${n(v)}G`

export default function V2Base({ prof, materials, isAdmin, onProfile, onBack }) {
  const [base, setBase] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)          // 回収・拡張などの結果
  const [tab, setTab] = useState('facilities')  // facilities / exchange
  const [now, setNow] = useState(Date.now())
  const [moveFrom, setMoveFrom] = useState('')
  const [exKind, setExKind] = useState('wood')
  const [picked, setPicked] = useState({})      // 交換に出す素材 { 素材ID: 個数 }

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // 開設していなければその場で作る（v2_base_init は冪等）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase.rpc('v2_base_get')
      if (!alive) return
      if (err || !data?.ok) { setError(err?.message || data?.error || '拠点を開けませんでした'); setLoading(false); return }
      if (!data.initialized) {
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
  const unlocked = base?.unlocked_areas || []

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

  const call = async (fn, args, label) => {
    if (busy) return null
    setBusy(label); setError(''); setMsg(null)
    const { data, error: err } = await supabase.rpc(fn, args)
    setBusy('')
    if (err || !data?.ok) { setError(err?.message || data?.error || 'うまくいきませんでした'); return null }
    if (data.base) setBase(data.base)
    else if (data.facilities) setBase(data)
    onProfile(null)   // Gold・LV・素材を取り直す
    return data
  }

  const collect = async (key) => {
    const d = await call('v2_base_collect', { p_key: key || null }, `collect:${key || 'all'}`)
    if (!d) return
    const gains = (d.gains || []).map(g => `${materialName(g.kind, g.grade)} +${n(g.qty)}`)
    setMsg({
      lines: [
        gains.length ? `📦 ${gains.join(' / ')}` : null,
        d.exp > 0 ? `🎯 EXP +${n(d.exp)}${d.level?.level_ups ? `（LV${d.level.level_ups}アップ！）` : ''}` : null,
        d.cost > 0 ? `💰 労働者の維持費 -${gold(d.cost)}` : null,
        d.auto_collected > 0 ? `📦 上限が下がったぶんを回収: +${n(d.auto_collected)}` : null,
        !gains.length && !d.exp ? '回収できるものがありませんでした' : null,
      ].filter(Boolean),
      warn: [
        d.gold_short ? '⚠ Goldが尽きたため、途中で生産が止まっていました' : null,
        d.lv_capped ? '⚠ LVが上限のため、かかしは回収していません（貯めたまま残しています）' : null,
      ].filter(Boolean),
    })
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
    setMsg({
      lines: [`🧑 ${FACILITY_BY_KEY[from]?.name} → ${FACILITY_BY_KEY[to]?.name} へ労働者を移しました`],
      warn: [],
    })
  }

  // ===== 交換 =====
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
    setMsg({
      lines: [`🔁 ${(d.gained || []).map(g => `${materialName(d.kind, g.grade)} +${n(g.qty)}`).join(' / ')}`],
      warn: [],
    })
  }

  if (loading) {
    return (
      <div style={{ ...box, padding:'14px', marginBottom:'8px', color:TEXT.label, fontSize:'12px' }}>拠点を開いています...</div>
    )
  }

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <span style={{ color:'#8fcf6f', fontSize:'13px' }}>🏕 拠点</span>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>
      <div style={{ color:TEXT.sub, fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        画面を閉じていても資材とEXPが貯まります（{CAP_HOURS}時間で満杯）。
        <br />労働者はGoldで雇い、<span style={{ color:'#ffaa66' }}>維持費が払えなくなったところで生産が止まります</span>。
      </div>

      {/* 所持 */}
      <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'6px' }}>
          <span style={{ color:TEXT.label }}>所持Gold</span>
          <span style={{ color:'#ffcc00' }}>{gold(heldGold)}</span>
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
      <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
        {[{ key:'facilities', label:'🏠 施設' }, { key:'exchange', label:'🔁 素材を資材に交換' }].map(t => (
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
          {msg.lines.map((l, i) => <div key={i} style={{ color:'#9be7a8' }}>{l}</div>)}
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

            return (
              <div key={def.key} style={{ background:'#000818', border:`1px solid ${def.color}44`, padding:'8px' }}>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ color:def.color, fontSize:'12px' }}>
                    {def.icon} {def.name}
                    <span style={{ color:TEXT.label, fontSize:'10px', marginLeft:'6px' }}>グレード{gradeLabel(f.grade)}</span>
                  </span>
                  <span style={{ color:TEXT.label, fontSize:'10px' }}>
                    {def.key === 'scarecrow' ? `EXP ${f.rate}/h` : `${f.rate}個/h`}
                  </span>
                </div>

                {/* 貯まっている量 */}
                <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'3px' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background: p.full ? '#ffaa44' : def.color, transition:'width .4s linear' }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', marginBottom:'6px' }}>
                  <span style={{ color: p.full ? '#ffaa44' : TEXT.body }}>
                    {n(p.pending)} / {n(cap)}
                    {def.key === 'scarecrow' ? ' EXP' : '個'}
                  </span>
                  <span style={{ color: p.goldShort ? '#ff6666' : TEXT.label }}>
                    {p.goldShort ? 'Goldが尽きて停止中'
                      : p.full ? '満杯です'
                      : mins != null ? `満杯まで約${Math.max(1, Math.round(mins))}分`
                      : isProducer ? '労働者がいません' : ''}
                  </span>
                </div>

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
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ color:TEXT.sub, fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
          生産施設は<span style={{ color:'#ffaa66' }}>グレードを上げても個数は増えません</span>。増えるのは出る資材のグレードです。
          <br />グレードⅢ以降の拡張には、その手前のエリアのボス撃破（＝エリアの解放）が要ります。
          <br />釣り場は準備中です。
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
            setMsg({ lines: ['🧹 拠点をリセットしました（開発）'], warn: [] })
          }} style={{ ...miniBtn('#aa5566'), marginTop:'8px' }}>
            拠点をリセット［開発］
          </button>
        )}
      </>)}

      {/* ===== 交換 ===== */}
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
    </div>
  )
}
