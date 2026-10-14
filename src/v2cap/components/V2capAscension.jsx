import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { CLASSES, jobOf, jobMaxOf, stageColorOf, stageLabelOf } from '../lib/jobs.js'
import {
  treeOf, treeSizeOf, ascStateOf, apTotalOf, apSpentOf, ascEffectsOf, ascSkillDetail, ascendError, ascResetGoldOf, routeTo, ASC_STAT_COLOR,
} from '../lib/ascension.js'
import { ASC_ART } from '../lib/ascArtList.js'

// ============================================================
// 「レベルキャップあり」版 — アセンション（スキルツリー）
//   【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2）：
//   ・CLASS LVが1上がるごとにAPを1。APでマスを開くと、ステや技が強くなる（どのマスも1AP）
//   ・職業ごとの盤面で、効くのはその職業でいる間だけ
//   ・「もっとツリーっぽく」「アイオン2みたいにまばらに配置（決まった道がなく、欲しい能力までどのルートで届かせるか）」：
//     起点から4方向に枝分かれした木を線でつないで描く。起点か開いたマスにつながったマスだけ開ける。
//     マスを押すと、いま開いている所からのいちばん近いルートが光り、「このルートで開く（◯AP）」で間のマスもまとめて開く
//     （別のルートを通りたいときは、通りたいマスを1つずつ押して開く）
//   ・【確定】2026-10-14 ユーザー指示「文字が枠からはみ出ちゃってる、クリックしたらどの能力が上がるかわかるようにして、
//     どのステータス上がるかは色で判断できるようにしたい」「取得したマスは発光する感じ」「選択した後マスが光る演出も欲しい、そこまで凝らなくていい」：
//     マスの中に文字は出さない（ステは色・スキルは水色の丸・大マスはひし形）。押すと下の欄に「STR+3（腕力）」のように出す。
//     開いたマスは光る。開いたときは、開いたマスが順に光る短い演出（選んだマスはゆっくり明滅）
//   ・【確定】2026-10-14 ユーザー「見た目AION２みたいにしたいからしっかり画像作ろうと思う」→「画像作った」：
//     盤面の背景・起点・ステ8種のマス・スキルの丸枠・大マスのひし形の枠をユーザーの絵で描く（public/asc-art＝tools/v2cap-asc-art.mjs）。
//     開いていないマスは暗く、開いたマスはそのステの色の光を後ろに置く。大マスは枠の中にそのステの絵を小さく入れる。
//     スキルの丸枠は中が暗い石なので、開いたら中を水色に光らせる。絵が無いもの（ascArtList.js に無い key）は図形で描く
//   ・振り直しは LV×100 Gold（v2cap_ascend_reset）。開くのはサーバー（v2cap_ascend）
//   数え方は src/v2cap/lib/ascension.js（戦闘・ステの内訳と同じもの）
// ============================================================

const SKILL_C = '#5ce1e6'   // スキルマス（水色）
const GOLD = '#ffcc00'
const LINK_ON = '#ffe7a3'   // 開いたマスどうしの線（光る）
const ROUTE = '#ffffff'     // 選んだルート（白の点線）
const colorOf = (node) => (node.type === 'skill' ? SKILL_C : node.type === 'start' ? GOLD : ASC_STAT_COLOR[node.stat] || '#88ccff')
// 盤の座標 → 画面の座標（1方向目＝上・時計回りに 右・下・左）
const sx = (n) => n.y
const sy = (n) => -n.x
// 「大きく」のときの1マスの幅の最小（これより狭い画面では盤を横にスクロール）。「全体」は画面の幅に収める
const CELL_MIN_PX = 40
const FLASH_STEP_MS = 90    // 開いたときの演出：1マスごとの遅れ
// 絵（public/asc-art/<key>.webp）。無ければ null＝図形で描く。?v= は中身の印（絵を替えたら読み直させる）
const artUrl = (key) => (ASC_ART[key] ? `/asc-art/${key}.webp?v=${ASC_ART[key]}` : null)
const artKeyOf = (node) => (node.type === 'stat' ? node.stat : node.type)   // ステ・skill・big・start
// 絵の大きさ（マス目＝1）。起点のとなりのマスと重ならない大きさ
const ART_SIZE = { stat: 0.84, skill: 0.84, big: 1.14, start: 1.12 }

// 押したマスの文（下の欄）。ステは「STR+3（腕力）」
const statText = (stat, v, pct = false) => `${STAT_DEFS[stat]?.label || stat}+${v}${pct ? '%' : ''}（${STAT_DEFS[stat]?.jp || ''}）`
const nodeInfo = (node) => {
  if (!node) return ''
  if (node.type === 'start') return '起点'
  if (node.type === 'stat') return statText(node.stat, node.amount)
  if (node.type === 'big') return `大マス：${statText(node.stat, node.pct, true)}`
  return `スキル：${node.skill}　${ascSkillDetail(node.skill)}`
}

// 演出（CSS）。動きを減らす設定の端末では止める
const CSS = `
.asc-node { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .asc-sel { transform-box: fill-box; transform-origin: center; animation: ascSel 1.4s ease-in-out infinite; }
  .asc-pop { animation: ascPop 0.7s ease-out both; }
  .asc-ring { transform-box: fill-box; transform-origin: center; animation: ascRing 0.9s ease-out both; }
}
@keyframes ascSel { 0%, 100% { opacity: 0.95; transform: scale(1); } 50% { opacity: 0.35; transform: scale(1.18); } }
@keyframes ascPop { 0% { transform: scale(1); filter: brightness(1); } 35% { transform: scale(1.45); filter: brightness(2.4); } 100% { transform: scale(1); filter: brightness(1); } }
@keyframes ascRing { 0% { transform: scale(0.4); opacity: 0; } 12% { opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }
`

// 4つの角の星（スキルマスの中・起点）
const sparkle = (x, y, r) => `M ${x} ${y - r} L ${x + r * 0.28} ${y - r * 0.28} L ${x + r} ${y} L ${x + r * 0.28} ${y + r * 0.28} L ${x} ${y + r} L ${x - r * 0.28} ${y + r * 0.28} L ${x - r} ${y} L ${x - r * 0.28} ${y - r * 0.28} Z`
const star8 = (x, y, r1, r2) => Array.from({ length: 16 }, (_, i) => {
  const a = (Math.PI * i) / 8 - Math.PI / 2
  const r = i % 2 === 0 ? r1 : r2
  return `${(x + Math.cos(a) * r).toFixed(3)},${(y + Math.sin(a) * r).toFixed(3)}`
}).join(' ')

// 絵で描くマス。開いていないマスは暗く（透けさせる）・開いたマスはそのステの色の光を後ろに置く
function ArtShape({ node, owned, x, y }) {
  const S = ART_SIZE[node.type] || 0.84
  const img = (key, size) => <image href={artUrl(key)} x={x - size / 2} y={y - size / 2} width={size} height={size} />
  if (node.type === 'start') {
    return <><circle cx={x} cy={y} r={0.8} fill="url(#ascHalo-start)" />{img('start', S)}</>
  }
  const halo = owned ? <circle cx={x} cy={y} r={node.type === 'big' ? 0.86 : 0.64} fill={`url(#ascHalo-${node.type === 'skill' ? 'skill' : node.stat})`} /> : null
  if (node.type === 'skill') {
    // 丸枠の中（暗い石）を、開いたら水色に光らせる。開いていなくても水色の星でスキルと分かる
    return (
      <>
        {halo}
        <g opacity={owned ? 1 : 0.62}>{img('skill', S)}</g>
        {owned && <circle cx={x} cy={y} r={0.26} fill="url(#ascHalo-skillIn)" />}
        <path d={sparkle(x, y, 0.17)} fill={owned ? '#ffffff' : SKILL_C} opacity={owned ? 0.95 : 0.6} />
      </>
    )
  }
  if (node.type === 'big') {
    // 枠の中にそのステの絵（小さく）。絵が無いステはそのステの色のひし形
    return (
      <>
        {halo}
        <g opacity={owned ? 1 : 0.6}>
          {artUrl(node.stat)
            ? img(node.stat, 0.5)
            : <polygon points={`${x},${y - 0.24} ${x + 0.24},${y} ${x},${y + 0.24} ${x - 0.24},${y}`} fill={colorOf(node)} />}
          {img('big', S)}
        </g>
      </>
    )
  }
  return <>{halo}<g opacity={owned ? 1 : 0.62}>{img(node.stat, S)}</g></>
}

// マス1つ（SVG・文字は出さない）。owned＝開いた／onRoute＝選んだルートに入っている／reach＝起点か開いたマスのとなり
function NodeShape({ node, owned, onRoute, reach, selected, flash, onPick }) {
  const c = colorOf(node)
  const x = sx(node), y = sy(node)
  const dim = !owned && !reach && !onRoute   // 遠いマス（まだ届かない）は少し暗く
  const fill = owned ? c : `${c}2e`
  const stroke = owned ? '#ffffff' : c
  const glow = owned ? (node.type === 'big' ? 'url(#ascGlowBig)' : 'url(#ascGlow)') : undefined
  const art = !!artUrl(artKeyOf(node))
  let shape
  if (art) {
    shape = <ArtShape node={node} owned={owned} x={x} y={y} />
  } else if (node.type === 'start') {
    shape = <polygon points={star8(x, y, 0.42, 0.2)} fill={GOLD} stroke="#fff6cc" strokeWidth={0.03} filter="url(#ascGlowBig)" />
  } else if (node.type === 'skill') {
    shape = (
      <g filter={glow}>
        <circle cx={x} cy={y} r={0.33} fill={fill} stroke={stroke} strokeWidth={owned ? 0.04 : 0.05} strokeOpacity={owned ? 0.9 : 0.85} />
        <path d={sparkle(x, y, 0.2)} fill={owned ? '#ffffff' : c} opacity={owned ? 0.95 : 0.8} />
      </g>
    )
  } else if (node.type === 'big') {
    const s = 0.46
    const t = 0.2
    shape = (
      <g filter={glow}>
        <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill={fill} stroke={stroke} strokeWidth={owned ? 0.05 : 0.06} />
        <polygon points={`${x},${y - t} ${x + t},${y} ${x},${y + t} ${x - t},${y}`} fill={owned ? '#ffffff' : c} opacity={owned ? 0.9 : 0.75} />
      </g>
    )
  } else {
    shape = <rect x={x - 0.27} y={y - 0.27} width={0.54} height={0.54} rx={0.1} fill={fill} stroke={stroke}
      strokeWidth={owned ? 0.04 : 0.05} strokeOpacity={owned ? 0.85 : 0.85} filter={glow} />
  }
  const ring = node.type === 'big' ? (art ? 0.68 : 0.62) : art ? 0.5 : node.type === 'skill' ? 0.48 : 0.44
  return (
    <g onClick={() => onPick(node.id)} style={{ cursor: node.type === 'start' ? 'default' : 'pointer' }} opacity={dim ? (art ? 0.72 : 0.55) : 1} data-node={node.id}>
      {/* PCはマウスを乗せると中身が出る（マスの中に文字は出さないため） */}
      <title>{nodeInfo(node)}{owned ? '（開いています）' : ''}</title>
      {/* 押せる広さはマス目いっぱい（小さいマスでも押しやすく） */}
      <rect x={x - 0.5} y={y - 0.5} width={1} height={1} fill="transparent" />
      {onRoute && !owned && <circle cx={x} cy={y} r={ring} fill="none" stroke={ROUTE} strokeWidth={0.035} strokeDasharray="0.1 0.07" />}
      {selected && <circle className="asc-sel" cx={x} cy={y} r={ring + 0.06} fill="none" stroke="#ffffff" strokeWidth={0.045} />}
      <g className={flash != null ? 'asc-node asc-pop' : 'asc-node'} style={flash != null ? { animationDelay: `${flash}ms` } : undefined}>{shape}</g>
      {flash != null && <circle className="asc-ring" cx={x} cy={y} r={0.36} fill="none" stroke={c} strokeWidth={0.06}
        style={{ animationDelay: `${flash}ms` }} />}
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
  // true＝大きく（狭い画面は横にスクロール）／false＝全体（画面の幅に収める）。スマホは全体から
  const [zoom, setZoom] = useState(() => typeof window === 'undefined' || window.innerWidth >= 600)
  // 開いたときの演出：{ マスの番号: 遅れ(ms) }
  const [flash, setFlash] = useState({})
  const flashTimer = useRef(null)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

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
  const skillNodes = tree.nodes.filter(n => n.type === 'skill' && open.has(n.id))
  const allSkillNodes = tree.nodes.filter(n => n.type === 'skill')
  // 凡例に出すステ＝この盤面にあるステ（ステの並び）
  const boardStats = STAT_KEYS.filter(k => tree.nodes.some(n => n.stat === k))

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
    const ids = [...route]
    if (await call('v2cap_ascend', { p_class: cls, p_nodes: ids })) {
      setMsg(`${ids.length}マスを開きました（${ids.length}AP）`)
      // 起点に近い順に、少しずつ遅らせて光らせる
      setFlash(Object.fromEntries(ids.map((id, i) => [id, i * FLASH_STEP_MS])))
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash({}), ids.length * FLASH_STEP_MS + 1000)
    }
  }
  const reset = async () => {
    if (await call('v2cap_ascend_reset', { p_class: cls })) {
      setConfirmReset(false); setSel(null); setFlash({})
      setMsg(`${cls}の盤面を振り直しました（${resetGold.toLocaleString()} Gold）`)
    }
  }
  const pick = (id) => { if (id === 0) return; setSel(id === sel ? null : id); setError(''); setMsg('') }

  // 線（同じ線を2回描かない）
  const edges = []
  for (const n of tree.nodes) for (const l of n.links) if (l > n.id) edges.push([n, tree.byId[l]])
  const R = tree.R
  const pad = 0.75

  // いま効いているもの（ステはその色で）
  const effParts = [
    ...STAT_KEYS.filter(k => eff.flat[k] > 0).map(k => ({ k, t: `${STAT_DEFS[k].label}+${eff.flat[k]}` })),
    ...Object.entries(eff.pct).map(([k, v]) => ({ k, t: `${STAT_DEFS[k]?.label || k}+${v}%` })),
  ]

  return (
    <div style={{ maxWidth:'820px', margin:'0 auto' }}>
      <style>{CSS}</style>
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
                <button key={id} onClick={() => { setCls(id); setSel(null); setMsg(''); setError(''); setFlash({}) }} aria-pressed={on}
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
          マスを押すと中身が下に出て、いちばん近いルートが光ります（別のルートを通りたいときは、1マスずつ押して開く）。
          {isCur ? '' : <span style={{ color:'#ff8844' }}>　いまの職業ではないので、この盤面は{cls}に転職するまで効きません。</span>}
        </div>
        {/* 色の見方（マスの中には文字を出さない） */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px', alignItems:'center', marginTop:'6px', fontSize:'10px' }}>
          {boardStats.map(k => (
            <span key={k} style={{ display:'inline-flex', alignItems:'center', gap:'3px', color: ASC_STAT_COLOR[k] }}>
              {artUrl(k)
                ? <img src={artUrl(k)} alt="" width={16} height={16} style={{ display:'block' }} />
                : <span style={{ width:'9px', height:'9px', borderRadius:'2px', background: ASC_STAT_COLOR[k], boxShadow:`0 0 4px ${ASC_STAT_COLOR[k]}` }} />}
              {STAT_DEFS[k].label}
            </span>
          ))}
          <span style={{ color: SKILL_C }}>● スキル</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:'3px', color: TEXT.sub }}>
            {artUrl('big') ? <img src={artUrl('big')} alt="" width={16} height={16} style={{ display:'block' }} /> : '◆'} 大マス（+%）
          </span>
          <button onClick={() => setZoom(z => !z)} style={{ ...miniBtn('#88aaff'), padding:'1px 6px', marginLeft:'auto' }}>{zoom ? '全体を見る' : '大きく見る'}</button>
        </div>
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'4px' }}>{msg}</div>}
      </div>

      {/* ===== 盤面 ===== */}
      <div style={{ ...box, padding:'6px', marginBottom:'0', overflowX:'auto' }}>
        <svg viewBox={`${-R - pad} ${-R - pad} ${2 * R + 2 * pad} ${2 * R + 2 * pad}`}
          style={{ display:'block', width:'100%', minWidth: zoom ? `${(2 * R + 2) * CELL_MIN_PX}px` : 0, background:'radial-gradient(circle at 50% 50%, #0b2a5c 0%, #04122e 45%, #000818 80%)' }}>
          <defs>
            {/* 開いたマスの光（マスの色のままぼかして重ねる） */}
            <filter id="ascGlow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="0.08" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* 絵のマスの後ろに置く光（そのステの色・スキル＝水色・起点＝金） */}
            {[...Object.entries(ASC_STAT_COLOR), ['skill', SKILL_C], ['start', GOLD]].map(([k, col]) => (
              <radialGradient key={k} id={`ascHalo-${k}`}>
                <stop offset="0%" stopColor={col} stopOpacity={0.9} />
                <stop offset="45%" stopColor={col} stopOpacity={0.4} />
                <stop offset="100%" stopColor={col} stopOpacity={0} />
              </radialGradient>
            ))}
            <radialGradient id="ascHalo-skillIn">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
              <stop offset="55%" stopColor={SKILL_C} stopOpacity={0.85} />
              <stop offset="100%" stopColor={SKILL_C} stopOpacity={0.15} />
            </radialGradient>
            <filter id="ascGlowBig" x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="0.16" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {artUrl('bg') && (
            <>
              <image href={artUrl('bg')} x={-R - pad} y={-R - pad} width={2 * R + 2 * pad} height={2 * R + 2 * pad} preserveAspectRatio="xMidYMid slice" />
              {/* マスが見やすいように少しだけ暗く */}
              <rect x={-R - pad} y={-R - pad} width={2 * R + 2 * pad} height={2 * R + 2 * pad} fill="#000818" opacity={0.18} />
            </>
          )}
          {/* ★線にぼかし（filter）は掛けない：真横・真上の線は大きさ0とみなされて消える。開いた線は「太く薄い線」＋「細く明るい線」で光らせる */}
          {edges.map(([a, b]) => {
            const both = open.has(a.id) && open.has(b.id)
            const rt = !both && (onRoute.has(a.id) || open.has(a.id)) && (onRoute.has(b.id) || open.has(b.id))
            const pos = { x1: sx(a), y1: sy(a), x2: sx(b), y2: sy(b) }
            if (both) {
              return (
                <g key={`${a.id}-${b.id}`}>
                  <line {...pos} stroke={LINK_ON} strokeWidth={0.22} strokeLinecap="round" opacity={0.22} />
                  <line {...pos} stroke={LINK_ON} strokeWidth={0.08} strokeLinecap="round" opacity={1} />
                </g>
              )
            }
            return (
              <line key={`${a.id}-${b.id}`} {...pos} stroke={rt ? ROUTE : '#2a4a7c'} strokeWidth={rt ? 0.06 : 0.05}
                strokeDasharray={rt ? '0.14 0.1' : undefined} opacity={rt ? 0.9 : 0.8} />
            )
          })}
          {tree.nodes.map(n => (
            <NodeShape key={n.id} node={n} owned={open.has(n.id) && n.type !== 'start'} onRoute={onRoute.has(n.id)}
              reach={reachable(n)} selected={n.id === sel} flash={flash[n.id]} onPick={pick} />
          ))}
        </svg>
      </div>

      {/* ===== 選んだマス（画面の下に貼り付く） ===== */}
      <div style={{ position:'sticky', bottom:0, zIndex:5, ...box, borderColor: selNode ? colorOf(selNode) : '#0044aa', padding:'8px 12px', marginBottom:'8px', minHeight:'40px' }}>
        {!selNode ? (
          <div style={{ color: TEXT.label, fontSize:'11px' }}>マスを押すと、どの能力が上がるかと、開くためのルートが出ます</div>
        ) : (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
            <div style={{ fontSize:'12px', minWidth:0 }}>
              <div style={{ color: colorOf(selNode), display:'flex', alignItems:'center', gap:'6px' }}>
                {(selNode.type === 'stat' || selNode.type === 'big') && artUrl(selNode.stat)
                  ? <img src={artUrl(selNode.stat)} alt="" width={20} height={20} style={{ display:'block', flexShrink:0 }} />
                  : <span style={{ width:'12px', height:'12px', flexShrink:0, background: colorOf(selNode), boxShadow:`0 0 6px ${colorOf(selNode)}`,
                    borderRadius: selNode.type === 'skill' ? '50%' : '2px', transform: selNode.type === 'big' ? 'rotate(45deg) scale(0.85)' : 'none' }} />}
                <span>{nodeInfo(selNode)}</span>
              </div>
              {open.has(selNode.id) ? (
                <div style={{ color:'#44ff88', fontSize:'10px' }}>開いています</div>
              ) : (
                <div style={{ color: TEXT.sub, fontSize:'10px' }}>
                  {route.length > 1 ? `いちばん近いルートは${route.length}マス（白く光っている所）` : 'となりのマスなので1マスで開けます'}・残り {left}AP
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
            {effParts.length > 0 && (
              <div>{effParts.map((p, i) => <span key={i} style={{ color: ASC_STAT_COLOR[p.k], marginRight:'8px', whiteSpace:'nowrap' }}>{p.t}</span>)}</div>
            )}
            {skillNodes.map(n => <div key={n.id} style={{ color: SKILL_C }}>{n.skill}：{ascSkillDetail(n.skill)}</div>)}
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
