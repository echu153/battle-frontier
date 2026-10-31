import { useId } from 'react'
import { crackleAt, edgePointsOf } from '../lib/bossCrackle.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ボスの体を走る稲妻（lib/bossCrackle.js・2026-11-01 黒龍の逆鱗のあと）
// ------------------------------------------------------------
// ボスの絵の箱（rigWrap＝傾きや動きがそのまま乗る）の中に重ねる。線の太さは絵の大きさによらず同じ（スマホで細くなりすぎない）。
//   ふち＝ぼかした太い色の線＋細い明るい芯。軽い表示はぼかさない（LiteCtx）
// ふちの点は絵ごとに1回だけ測る（小さく描いて濃さを読む）。読めないあいだ・読めなかったときは稲妻を出さない
// ============================================================
const EDGE_SIZE = 160
const edgeCache = new Map()   // 絵のキー → ふちの点（読んでいるあいだは null）

const edgesOf = (key, items, base) => {
  if (edgeCache.has(key)) return edgeCache.get(key)
  edgeCache.set(key, null)
  Promise.all(items.map(it => new Promise((res) => {
    const im = new Image()
    im.onload = () => res({ it, im })
    im.onerror = () => res(null)
    im.src = it.src
  }))).then((list) => {
    try {
      const cv = document.createElement('canvas')
      cv.width = cv.height = EDGE_SIZE
      const g = cv.getContext('2d', { willReadFrequently: true }), k = EDGE_SIZE / base
      for (const r of list) if (r) g.drawImage(r.im, r.it.x * k, r.it.y * k, r.it.w * k, r.it.h * k)
      const d = g.getImageData(0, 0, EDGE_SIZE, EDGE_SIZE).data, alpha = new Uint8Array(EDGE_SIZE * EDGE_SIZE)
      for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3]
      edgeCache.set(key, edgePointsOf(alpha, EDGE_SIZE, EDGE_SIZE, base / EDGE_SIZE))
    } catch { /* 読めなければ稲妻なし（戦闘は止めない） */ }
  })
  return null
}

const pathOf = (pts) => `M${pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`

// base＝立ち絵の px・artKey と items＝いま出ている絵（立ち絵はパーツぜんぶ）・crackle＝{ c（決まり）, k（濃さ）, t（時計） }（lib/bossIllust.js の buffAfterAt）
export default function BossCrackle({ base, artKey, items, crackle, lite = false }) {
  const id = useId()
  const { c, k, t } = crackle
  const arcs = crackleAt(edgesOf(artKey, items, base), c, t, lite ? 0.8 : 1)
  const line = (a, i, pre, color, width, extra) => [a.pts, ...a.forks].map((pts, j) => (
    <path key={`${pre}${i}-${j}`} d={pathOf(pts)} fill="none" stroke={`rgb(${color})`} strokeWidth={width * a.w * (j ? 0.7 : 1)} strokeLinejoin="round" strokeLinecap="round"
      vectorEffect="non-scaling-stroke" opacity={a.op.toFixed(3)} {...extra} />
  ))
  return (
    <svg viewBox={`0 0 ${base} ${base}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible', pointerEvents:'none', mixBlendMode: lite ? undefined : 'screen', opacity: k < 1 ? k.toFixed(3) : undefined }}>
      <defs><filter id={id} filterUnits="userSpaceOnUse" x="-120" y="-120" width={base + 240} height={base + 240}><feGaussianBlur stdDeviation="5" /></filter></defs>
      <g filter={lite ? undefined : `url(#${id})`} opacity={lite ? 0.85 : undefined}>{arcs.map((a, i) => line(a, i, 'g', c.color, lite ? 3.4 : 6))}</g>
      <g>{arcs.map((a, i) => line(a, i, 'c', c.core, lite ? 1.1 : 1.8))}</g>
    </svg>
  )
}
