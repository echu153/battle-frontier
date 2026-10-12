import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { CLASSES, jobOf, jobMaxOf, stageColorOf, stageLabelOf } from '../lib/jobs.js'
import {
  treeOf, treeSizeOf, ascStateOf, apTotalOf, apSpentOf, ascEffectsOf, nodeLines, nodeText, ascendError, ascResetGoldOf,
  routeTo,
} from '../lib/ascension.js'

// ============================================================
// 「レベルキャップあり」版 — アセンション（スキルツリー）
//   【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2）：
//   ・CLASS LVが1上がるごとにAPを1。APでマスを開くと、ステや技が強くなる（どのマスも1AP）
//   ・職業ごとの盤面で、効くのはその職業でいる間だけ
//   ・同じ日に「もっとツリーっぽく」「アイオン2みたいにまばらに配置（決まった道がなく、欲しい能力までどのルートで届かせるか）」：
//     起点から4方向に枝分かれした木を線でつないで描く。起点か開いたマスにつながったマスだけ開ける。
//     小マスのステは盤面全体に混ぜてある（ユーザーが選んだ）＝方向の名前は出さない
//     マスを押すと、いま開いている所からのいちばん近いルートが光り、「このルートで開く（◯AP）」で間のマスもまとめて開く
//     （別のルートを通りたいときは、通りたいマスを1つずつ押して開く）
//   ・振り直しは LV×100 Gold（v2cap_ascend_reset）。開くのはサーバー（v2cap_ascend）
//   数え方は src/v2cap/lib/ascension.js（戦闘・ステの内訳と同じもの）
// ============================================================
const SKILL_C = '#5ce1e6'
const BIG_C = '#ff88cc'
const GOLD = '#ffcc00'
// ★ルートは白の点線（腕力＝STRの黄色と見分けるため）
const ROUTE = '#ffffff'
const colorOf = (node) => (node.type === 'skill' ? SKILL_C : node.type === 'big' ? BIG_C : node.type === 'start' ? GOLD : STAT_DEFS[node.stat]?.color || '#88ccff')
// 盤の座標 → 画面の座標（1方向目＝上・時計回りに 右・下・左）
const sx = (n) => n.y
const sy = (n) => -n.x
// 「大きく」のときの1マスの幅の最小（これより狭い画面では盤を横にスクロール）。「全体」は画面の幅に収める
const CELL_MIN_PX = 42
const short = (s, n = 4) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s)

// マス1つ（SVG）。owned＝開いた／onRoute＝選んだルートに入っている／reach＝起点か開いたマスのとなり
function NodeShape({ node, owned, onRoute, reach, selected, onPick }) {
  const c = colorOf(node)
  const x = sx(node), y = sy(node)
  const stroke = owned ? c : onRoute ? ROUTE : reach ? `${c}aa` : '#2a3a55'
  const fill = owned ? `${c}33` : '#000818'
  const text = owned ? c : onRoute ? '#ffffff' : reach ? '#b8c8dc' : '#5a6a85'
  const sw = selected ? 0.07 : 0.04
  const dash = onRoute && !owned ? '0.12 0.08' : undefined
  const [l1] = nodeLines(node)
  let shape
  if (node.type === 'start') {
    shape = <circle cx={x} cy={y} r={0.4} fill="#1a1400" stroke={GOLD} strokeWidth={0.06} />
  } else if (node.type === 'skill') {
    shape = <circle cx={x} cy={y} r={0.43} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
  } else if (node.type === 'big') {
    const s = 0.5
    shape = <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill={fill} stroke={stroke} strokeWidth={sw + 0.02} strokeDasharray={dash} />
  } else {
    shape = <rect x={x - 0.42} y={y - 0.26} width={0.84} height={0.52} rx={0.08} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
  }
  const label = node.type === 'start' ? '★' : node.type === 'skill' ? short(node.skill) : l1
  const fs = node.type === 'start' ? 0.4 : node.type === 'skill' ? ([...label].length > 3 ? 0.17 : 0.21) : node.type === 'big' ? 0.19 : 0.21
  return (
    <g onClick={() => onPick(node.id)} style={{ cursor:'pointer' }}>
      {selected && <circle cx={x} cy={y} r={0.56} fill="none" stroke="#ffffff" strokeWidth={0.03} opacity={0.7} />}
      {shape}
      <text x={x} y={y} fill={node.type === 'start' ? GOLD : text} fontSize={fs} textAnchor="middle" dominantBaseline="central"
        style={{ fontFamily:'monospace', pointerEvents:'none', fontWeight: node.type === 'big' ? 'bold' : 'normal' }}>{label}</text>
    </g>
  )
}

export default function V2capAscension({ prof, onProfile }) {
  const [cls, setCls] = useState(prof.class)
  const [sel, setSel] = useState(null)          // 選んだマスの番号
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  // true＝大きく（文字が読める大きさ・狭い画面は横にスクロール）／false＝全体（画面の幅に収める）。スマホは全体から
  const [zoom, setZoom] = useState(() => typeof window === 'undefined' || window.innerWidth >= 600)

  const tree = treeOf(cls)
  // 見られる職業＝就いたことのある職業といまの職業（並びは神殿と同じ）
  const classes = CLASSES.map(c => c.id).filter(id => id === prof.class || prof.jobs?.[id])
  if (!tree) return <div style={{ ...box, padding:'12px', color: TEXT.sub, fontSize:'11px' }}>この職業にはアセンションがありません</div>

  const state = ascStateOf(prof, cls)
  const open = new Set([0, ...state])
  const jlv = jobOf(prof.jobs, cls).lv
  const total = apTotalOf(cls, jlv)
  const spent = apSpentOf(state)
  const left = total - spent
  const isCur = cls === prof.class
  const eff = ascEffectsOf(prof, cls)
  const resetGold = ascResetGoldOf(prof.lv)
  const flatText = STAT_KEYS.filter(k => eff.flat[k] > 0).map(k => `${STAT_DEFS[k].label}+${eff.flat[k]}`).join('・')
  const pctText = Object.entries(eff.pct).map(([k, v]) => `${STAT_DEFS[k]?.label || k}+${v}%`).join('・')
  const skillNodes = tree.nodes.filter(n => n.type === 'skill' && open.has(n.id))
  const allSkillNodes = tree.nodes.filter(n => n.type === 'skill')

  const selNode = sel != null ? tree.byId[sel] : null
  const route = selNode ? (routeTo(cls, state, sel) || []) : []
  const onRoute = new Set(route)
  const routeErr = route.length ? ascendError(prof, cls, route) : null
  const reachable = (n) => !open.has(n.id) && n.links.some(l => open.has(l))

  const call = async (fn, args) => {
    setBusy(true); setError(''); setMsg('')
    const { data, error: e } = await supabase.rpc(fn, args)
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || 'うまくいきませんでした'); return null }
    await onProfile?.()
    return data
  }
  const openRoute = async () => {
    const err = ascendError(prof, cls, route)
    if (err) { setError(err); return }
    if (await call('v2cap_ascend', { p_class: cls, p_nodes: route })) {
      setMsg(`${route.length}マスを開きました（${route.length}AP）`)
    }
  }
  const reset = async () => {
    if (await call('v2cap_ascend_reset', { p_class: cls })) {
      setConfirmReset(false); setSel(null)
      setMsg(`${cls}の盤面を振り直しました（${resetGold.toLocaleString()} Gold）`)
    }
  }
  const pick = (id) => { setSel(id === sel || id === 0 ? null : id); setError(''); setMsg('') }

  // 線（同じ線を2回描かない）
  const edges = []
  for (const n of tree.nodes) for (const l of n.links) if (l > n.id) edges.push([n, tree.byId[l]])
  const R = tree.R
  const pad = 0.75

  return (
    <div style={{ maxWidth:'820px', margin:'0 auto' }}>
      {confirmReset && (
        <V2Modal title="アセンションを振り直す" color="#ff8844" danger busy={busy}
          confirmLabel={`振り直す（${resetGold.toLocaleString()} Gold）`}
          onConfirm={reset} onClose={() => { if (!busy) { setConfirmReset(false); setError('') } }}>
          {cls}の盤面を全部戻して、使った{spent}APを返します。費用は LV×100＝{resetGold.toLocaleString()} Gold（いま {Number(prof.gold || 0).toLocaleString()} Gold）。
          {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'4px' }}>⚠ {error}</div>}
        </V2Modal>
      )}

      {/* ===== 職業とAP ===== */}
      <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
        {classes.length > 1 && (
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {classes.map(id => {
              const on = id === cls
              const l = apTotalOf(id, jobOf(prof.jobs, id).lv) - apSpentOf(ascStateOf(prof, id))
              return (
                <button key={id} onClick={() => { setCls(id); setSel(null); setMsg(''); setError('') }} aria-pressed={on}
                  style={{ ...miniBtn(on ? stageColorOf(id) : '#2a4466'), color: on ? stageColorOf(id) : TEXT.label, background: on ? '#00163a' : '#000818' }}>
                  {id}{id === prof.class ? '（いま）' : ''}{l > 0 && <span style={{ color: GOLD, marginLeft:'3px' }}>AP{l}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
          <div style={{ fontSize:'12px' }}>
            <span style={{ color: stageColorOf(cls) }}>{cls}</span>
            <span style={{ color: TEXT.label, fontSize:'10px', marginLeft:'6px' }}>{stageLabelOf(cls)}・CLASS LV{jlv}/{jobMaxOf(cls)}</span>
          </div>
          <div style={{ fontSize:'12px' }}>
            AP 残り <span style={{ color: left > 0 ? GOLD : TEXT.bright }}>{left}</span>
            <span style={{ color: TEXT.label, fontSize:'10px' }}> ／ もらった{total}（全部で{treeSizeOf(cls)}マス）</span>
          </div>
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginTop:'4px' }}>
          CLASS LVが1上がるごとにAP+1。起点か開いたマスにつながったマスを、1マス1APで開けます。
          マスを押すと、いちばん近いルートが光ります（別のルートを通りたいときは、1マスずつ押して開く）。
          {isCur ? '' : <span style={{ color:'#ff8844' }}>　いまの職業ではないので、この盤面は{cls}に転職するまで効きません。</span>}
        </div>
        <div style={{ color: TEXT.label, fontSize:'10px', marginTop:'2px' }}>
          □ ステ　<span style={{ color: SKILL_C }}>○ スキル</span>　<span style={{ color: BIG_C }}>◇ 大マス（+%）</span>
          <button onClick={() => setZoom(z => !z)} style={{ ...miniBtn('#88aaff'), marginLeft:'8px', padding:'1px 6px' }}>{zoom ? '全体を見る' : '大きく見る'}</button>
        </div>
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'4px' }}>{msg}</div>}
      </div>

      {/* ===== 盤面 ===== */}
      <div style={{ ...box, padding:'6px', marginBottom:'0', overflowX:'auto' }}>
        <svg viewBox={`${-R - pad} ${-R - pad} ${2 * R + 2 * pad} ${2 * R + 2 * pad}`}
          style={{ display:'block', width:'100%', minWidth: zoom ? `${(2 * R + 2) * CELL_MIN_PX}px` : 0, background:'radial-gradient(circle at 50% 50%, #06204a 0%, #000c26 70%)' }}>
          {edges.map(([a, b]) => {
            const both = open.has(a.id) && open.has(b.id)
            const rt = (onRoute.has(a.id) || open.has(a.id)) && (onRoute.has(b.id) || open.has(b.id)) && (onRoute.has(a.id) || onRoute.has(b.id))
            const c = both ? (a.type === 'start' ? colorOf(b) : colorOf(a)) : rt ? ROUTE : '#1f3358'
            return (
              <line key={`${a.id}-${b.id}`} x1={sx(a)} y1={sy(a)} x2={sx(b)} y2={sy(b)} stroke={c}
                strokeWidth={both ? 0.09 : rt ? 0.08 : 0.06} strokeDasharray={rt && !both ? '0.15 0.1' : undefined} opacity={both || rt ? 0.95 : 0.8} />
            )
          })}
          {tree.nodes.map(n => (
            <NodeShape key={n.id} node={n} owned={open.has(n.id) && n.type !== 'start'} onRoute={onRoute.has(n.id)}
              reach={reachable(n)} selected={n.id === sel} onPick={pick} />
          ))}
        </svg>
      </div>

      {/* ===== 選んだマス（画面の下に貼り付く） ===== */}
      <div style={{ position:'sticky', bottom:0, zIndex:5, ...box, borderColor: selNode ? colorOf(selNode) : '#0044aa', padding:'8px 12px', marginBottom:'8px', minHeight:'40px' }}>
        {!selNode ? (
          <div style={{ color: TEXT.label, fontSize:'11px' }}>マスを押すと、中身と開くためのルートが出ます</div>
        ) : (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
            <div style={{ fontSize:'11px', minWidth:0 }}>
              <div style={{ color: colorOf(selNode) }}>{nodeText(selNode)}</div>
              {open.has(selNode.id) ? (
                <div style={{ color:'#44ff88', fontSize:'10px' }}>開いています</div>
              ) : (
                <div style={{ color: TEXT.sub, fontSize:'10px' }}>
                  {route.length > 1 ? `いちばん近いルートは${route.length}マス（光っている所）` : 'となりのマスなので1マスで開けます'}・残り {left}AP
                  {routeErr && <span style={{ color:'#ff8844', marginLeft:'4px' }}>⚠ {routeErr}{routeErr === 'APが足りません' ? `（あと${route.length - left}AP）` : ''}</span>}
                  {!isCur && <span style={{ color:'#ff8844', marginLeft:'4px' }}>※{cls}に転職するまで効きません</span>}
                </div>
              )}
              {error && <div style={{ color:'#ff4444', fontSize:'10px' }}>⚠ {error}</div>}
            </div>
            {!open.has(selNode.id) && route.length > 0 && (
              <button onClick={openRoute} disabled={busy || !!routeErr}
                style={{ ...miniBtn(routeErr ? '#2a3a55' : GOLD), padding:'6px 10px', fontSize:'11px', cursor: routeErr ? 'not-allowed' : 'pointer', flexShrink:0 }}>
                {busy ? '開いています...' : `このルートで開く（${route.length}AP）`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== いま効いているもの・スキルマスの一覧・振り直し ===== */}
      <div style={{ ...box, padding:'10px 12px' }}>
        <div style={{ color:'#88aaff', fontSize:'11px', marginBottom:'4px' }}>この盤面で上がっているもの{isCur ? '' : '（転職すると効きます）'}</div>
        {spent === 0 ? (
          <div style={{ color: TEXT.empty, fontSize:'11px' }}>まだ開いたマスはありません</div>
        ) : (
          <div style={{ fontSize:'11px', lineHeight:1.8 }}>
            {flatText && <div style={{ color: TEXT.bright }}>{flatText}</div>}
            {pctText && <div style={{ color: BIG_C }}>{pctText}</div>}
            {skillNodes.map(n => <div key={n.id} style={{ color: SKILL_C }}>{nodeText(n)}</div>)}
          </div>
        )}
        <div style={{ color:'#88aaff', fontSize:'11px', margin:'8px 0 2px' }}>スキルマス（押すと盤面で光ります）</div>
        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
          {allSkillNodes.map(n => (
            <button key={n.id} onClick={() => pick(n.id)}
              style={{ ...miniBtn(open.has(n.id) ? SKILL_C : '#2a4466'), color: open.has(n.id) ? SKILL_C : TEXT.sub, borderRadius:'10px' }}>
              {n.skill}{open.has(n.id) ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'8px' }}>
          <button onClick={() => { setConfirmReset(true); setError('') }} disabled={busy || spent === 0}
            style={{ ...miniBtn(spent === 0 ? '#2a3a55' : '#ff8844'), cursor: spent === 0 ? 'not-allowed' : 'pointer' }}>
            振り直す（{resetGold.toLocaleString()} Gold）
          </button>
        </div>
      </div>
    </div>
  )
}
