// ============================================================
// v2cap タカラモチ（日替わりクエストの宝箱の魔物）の待機の動き用に、立ち絵を部品へ切り分ける
//   決まり（切る位置・ぼかし・埋め方）は src/v2cap/lib/cofferArt.js の COFFER_CUTS。動きは src/v2cap/lib/cofferMotion.js
//   tools/v2cap-scarecrow-art.mjs が立ち絵を作ったあとに呼ぶ（同じ元の絵・同じ切り取り sq＝重ねると立ち絵と同じ）
// 作るもの（public/v2cap-art/training/coffer-<name>.webp）：
//   base  … 動かない所（箱・金貨の山・影の体）。動く部品の下は fill（まわりの色で埋める）か clear（透明）
//   lid   … ふた＋ふたを押し上げる右手／larm … 左腕（金貨は抜く）／coin … 金貨／glint … 金貨のきらめき
//   glow  … 目と笑い口の明るい所（明るくして光をにじませた写し・画面で脈打たせる）
//   lids  … まばたきのまぶた（両目を、まわりの暗がりの色で埋めた絵。目の所だけ）
// ============================================================
import path from 'node:path'
import { statSync } from 'node:fs'
import { bleed, encodeSquare, versionOf } from './v2cap-art-lib.mjs'

// 点 (x, y) が多角形の中か
const inPoly = (poly, x, y) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
  }
  return c
}
// 多角形の中（0/1）
const polyMask = (poly, W, H) => {
  const m = new Uint8Array(W * H)
  const ys = poly.map(p => p[1]), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)))
  const xs = poly.map(p => p[0]), x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPoly(poly, x + 0.5, y + 0.5)) m[y * W + x] = 1
  return m
}
// 中の点からふちまでの近さ（chamfer 3-4 を px にした値・外は 0）
const insideDist = (m, W, H) => {
  const BIG = 1e9, d = new Float64Array(W * H)
  for (let p = 0; p < d.length; p++) d[p] = m[p] ? BIG : 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (!d[p]) continue
    let v = d[p]
    if (x > 0) v = Math.min(v, d[p - 1] + 3); else v = Math.min(v, 3)
    if (y > 0) { v = Math.min(v, d[p - W] + 3); if (x > 0) v = Math.min(v, d[p - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[p - W + 1] + 4) } else v = Math.min(v, 3)
    d[p] = v
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x
    if (!d[p]) continue
    let v = d[p]
    if (x < W - 1) v = Math.min(v, d[p + 1] + 3); else v = Math.min(v, 3)
    if (y < H - 1) { v = Math.min(v, d[p + W] + 3); if (x < W - 1) v = Math.min(v, d[p + W + 1] + 4); if (x > 0) v = Math.min(v, d[p + W - 1] + 4) } else v = Math.min(v, 3)
    d[p] = v
  }
  for (let p = 0; p < d.length; p++) d[p] /= 3
  return d
}
// 楕円の中か（rot は度）。scale>1 で大きく
const inEllipse = (e, x, y, grow = 0) => {
  const a = (e.rot || 0) * Math.PI / 180, dx = x - e.at[0], dy = y - e.at[1]
  const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a)
  return (u / (e.rx + grow)) ** 2 + (v / (e.ry + grow)) ** 2
}
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lumOf = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b

// 色の入った値を掛けた形（premultiplied）の Float32 4ch
const toPre = ({ data, W, H }) => {
  const f = new Float32Array(W * H * 4)
  for (let p = 0; p < W * H; p++) { const a = data[p * 4 + 3] / 255; f[p * 4] = data[p * 4] * a; f[p * 4 + 1] = data[p * 4 + 1] * a; f[p * 4 + 2] = data[p * 4 + 2] * a; f[p * 4 + 3] = a }
  return f
}
const fromPre = (f, W, H) => {
  const data = Buffer.alloc(W * H * 4)
  for (let p = 0; p < W * H; p++) {
    const a = f[p * 4 + 3]
    if (a > 1e-4) for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.max(0, Math.min(255, Math.round(f[p * 4 + c] / a)))
    data[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)))
  }
  return { data, W, H }
}
// 穴（hole=1）を、まわりの見えている値で埋める（押して引くピラミッド＋なじませ）。premultiplied なので、まわりが透明なら透明に近くなる
const fillHoles = (f, hole, W, H, smooth = 40) => {
  const levels = [{ v: f, w: Float32Array.from(hole, h => (h ? 0 : 1)), W, H }]
  while (levels.at(-1).W > 4 && levels.at(-1).H > 4) {
    const L = levels.at(-1), w2 = Math.ceil(L.W / 2), h2 = Math.ceil(L.H / 2)
    const v = new Float32Array(w2 * h2 * 4), w = new Float32Array(w2 * h2)
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      const p = y * L.W + x, q = (y >> 1) * w2 + (x >> 1), k = L.w[p]
      if (!k) continue
      w[q] += k
      for (let c = 0; c < 4; c++) v[q * 4 + c] += L.v[p * 4 + c] * k
    }
    for (let q = 0; q < w2 * h2; q++) if (w[q] > 0) { for (let c = 0; c < 4; c++) v[q * 4 + c] /= w[q]; w[q] = Math.min(1, w[q]) }
    levels.push({ v, w, W: w2, H: h2 })
  }
  for (let i = levels.length - 2; i >= 0; i--) {
    const L = levels[i], C = levels[i + 1]
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      const p = y * L.W + x
      if (L.w[p] >= 1) continue
      const q = (y >> 1) * C.W + (x >> 1), k = L.w[p]
      for (let c = 0; c < 4; c++) L.v[p * 4 + c] = L.v[p * 4 + c] * k + C.v[q * 4 + c] * (1 - k)
      L.w[p] = 1
    }
  }
  // なじませ（穴の中だけ・4近傍の平均）
  const idx = []
  for (let p = 0; p < W * H; p++) if (hole[p]) idx.push(p)
  for (let it = 0; it < smooth; it++) for (const p of idx) {
    const x = p % W, y = (p / W) | 0
    const ns = [x > 0 && p - 1, x < W - 1 && p + 1, y > 0 && p - W, y < H - 1 && p + W].filter(n => n !== false)
    for (let c = 0; c < 4; c++) { let s = 0; for (const n of ns) s += f[n * 4 + c]; f[p * 4 + c] = s / ns.length }
  }
}
// 箱ぼかし（1ch・半径 r・3回で丸い）
const blur1 = (a, W, H, r, passes = 3) => {
  let src = Float32Array.from(a), tmp = new Float32Array(a.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * W + Math.max(0, Math.min(W - 1, x))]
      for (let x = 0; x < W; x++) { tmp[y * W + x] = s / (2 * r + 1); s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)] } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(H - 1, y)) * W + x]
      for (let y = 0; y < H; y++) { src[y * W + x] = s / (2 * r + 1); s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x] } }
  }
  return src
}

// img＝立ち絵の元の絵（rgba・真緑は抜いてある）・sq＝立ち絵の正方形の切り取り・size＝書き出す大きさ
export const buildCofferParts = (img, sq, { cuts, outDir, size, quality = 84 }) => {
  const { W, H } = img, N = W * H
  const P = toPre(img)
  const pix = (p) => { const a = P[p * 4 + 3]; return a > 1e-4 ? [P[p * 4] / a, P[p * 4 + 1] / a, P[p * 4 + 2] / a, a] : [0, 0, 0, 0] }

  // ===== どの部品か（先に決めたものが勝つ：きらめき＞金貨＞左腕＞右手＞ふた）=====
  const glint = new Float32Array(N), coin = new Float32Array(N)
  const g = cuts.glint, c = cuts.coin
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, [r, gg, b, a] = pix(p)
    if (a < 0.04) continue
    const lum = lumOf(r, gg, b)
    const dG = Math.hypot(x - g.at[0], y - g.at[1])
    const inCoin = inEllipse({ at: c.at, rx: c.rx, ry: c.ry }, x, y) <= 1
    const whitish = Math.max(r, gg, b) - Math.min(r, gg, b) < 115
    // きらめき：金貨の外の光（うすいにじみまで・紫の指は入れない）。金貨の上は、まん中の近くの白っぽい所だけ（金色のふちは金貨に残す）
    if (dG <= g.r && ((!inCoin && r >= b) || (inCoin && whitish && lum > 200 && dG < 30))) { glint[p] = 1; continue }
    // 金貨：楕円の中の、紫でない所（ふちの暗い茶色も入れる・紫の指は入れない）。金貨のすぐ内側は色を問わず金貨（金貨の裏に隠れた指先のかけらが、
    //   金貨を飛ばすと宙に浮いた短い線に見えた＝金貨といっしょに飛ばす）
    if ((inCoin && r >= b + 4) || inEllipse({ at: c.at, rx: c.rx - 5, ry: c.ry - 4 }, x, y) <= 1) coin[p] = 1
  }
  const soft = (name) => {
    const cut = cuts[name], m = polyMask(cut.poly, W, H), d = insideDist(m, W, H)
    const ramp = new Float32Array(N)
    for (let p = 0; p < N; p++) ramp[p] = m[p] ? clamp01(d[p] / cut.feather) : 0
    return ramp
  }
  const take = (ramp, ...higher) => { for (let p = 0; p < N; p++) { let used = 0; for (const h of higher) used += h[p]; ramp[p] = Math.min(ramp[p], Math.max(0, 1 - used)) } return ramp }
  const larm = take(soft('larm'), glint, coin)
  const rarm = take(soft('rarm'), glint, coin, larm)
  const lid = take(soft('lid'), glint, coin, larm, rarm)

  const layerOf = (m) => { const f = new Float32Array(N * 4); for (let p = 0; p < N; p++) for (let k = 0; k < 4; k++) f[p * 4 + k] = P[p * 4 + k] * m[p]; return f }
  // ぼかしの所（0〜1 の途中）は下の絵にも元の絵を残す＝止まっているときに切れ目が見えない。芯（ほぼ1）だけ下の絵から抜く
  const coreOf = (m) => Float32Array.from(m, v => clamp01((v - 0.9) / 0.1))

  // ===== 動かない所 =====
  const base = Float32Array.from(P)
  const clear = (w) => { for (let p = 0; p < N; p++) if (w[p] > 0) for (let k = 0; k < 4; k++) base[p * 4 + k] *= 1 - w[p] }
  clear(glint); clear(coin); clear(coreOf(lid))
  // 左腕と右手の下：まわりの色で埋める（ふたの芯の所は透明のまま）
  const lidCore = coreOf(lid)
  const fillW = new Float32Array(N), hole = new Uint8Array(N)
  for (const m of [coreOf(larm), coreOf(rarm)]) for (let p = 0; p < N; p++) if (m[p] > fillW[p] && lidCore[p] < 0.5) fillW[p] = m[p]
  for (let p = 0; p < N; p++) if (fillW[p] > 0) hole[p] = 1
  const filled = Float32Array.from(base)
  fillHoles(filled, hole, W, H)
  for (let p = 0; p < N; p++) if (fillW[p] > 0) for (let k = 0; k < 4; k++) base[p * 4 + k] = base[p * 4 + k] * (1 - fillW[p]) + filled[p * 4 + k] * fillW[p]

  // ===== 目と口の光：明るい所を明るくして、まわりに光をにじませる =====
  const [fx0, fy0, fx1, fy1] = cuts.face.box
  const bright = new Float32Array(N)
  for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) {
    const p = y * W + x, [r, gg, b, a] = pix(p)
    bright[p] = clamp01((lumOf(r, gg, b) - 150) / 70) * a
  }
  const bloom = blur1(bright, W, H, 5)
  const glow = new Float32Array(N * 4)
  for (let p = 0; p < N; p++) {
    const k = bright[p], h = Math.min(1, bloom[p] * 0.75)
    if (k < 0.004 && h < 0.004) continue
    const [r, gg, b] = pix(p)
    const lc = [Math.min(255, r * 1.08 + 34), Math.min(255, gg * 1.1 + 22), Math.min(255, b * 1.05)]   // 明るく少し黄色に
    const hc = [255, 176, 64]                                                                         // にじんだ光の色
    const a = k + h * (1 - k)
    for (let ch = 0; ch < 3; ch++) glow[p * 4 + ch] = lc[ch] * k + hc[ch] * h * (1 - k)
    glow[p * 4 + 3] = a
  }

  // ===== まぶた：目をまわりの暗がりで埋めた絵（目の所だけ・ふちはぼかす）=====
  const eyeHole = new Uint8Array(N)
  for (const e of cuts.eyes) for (let y = Math.max(0, e.at[1] - 90); y < Math.min(H, e.at[1] + 90); y++) for (let x = Math.max(0, e.at[0] - 90); x < Math.min(W, e.at[0] + 90); x++) {
    if (inEllipse(e, x, y, 4) <= 1) eyeHole[y * W + x] = 1
  }
  const lidsFill = Float32Array.from(P)
  fillHoles(lidsFill, eyeHole, W, H, 60)
  const lids = new Float32Array(N * 4)
  for (const e of cuts.eyes) for (let y = Math.max(0, e.at[1] - 90); y < Math.min(H, e.at[1] + 90); y++) for (let x = Math.max(0, e.at[0] - 90); x < Math.min(W, e.at[0] + 90); x++) {
    const p = y * W + x, q = inEllipse(e, x, y, 7)
    if (q > 1) continue
    const k = clamp01((1 - Math.sqrt(q)) / 0.18)   // ふちの 18% をぼかす
    // まわりの光の色のままだと茶色く見えた＝暗くする（閉じた目は暗く・まわりのにじんだ光は下の絵と glow に残る）
    for (let ch = 0; ch < 4; ch++) lids[p * 4 + ch] = Math.max(lids[p * 4 + ch], lidsFill[p * 4 + ch] * k * (ch < 3 ? 0.45 : 1))
  }

  // ===== 書き出す（どれも立ち絵と同じ正方形・同じ大きさ）=====
  const out = {}, sizes = {}
  const write = (name, f) => {
    const rgba = fromPre(f, W, H)
    bleed(rgba, 6)
    const file = path.join(outDir, `coffer-${name}.webp`)
    encodeSquare(rgba, sq, file, { size, margin: 0, quality })
    out[name] = versionOf(file)
    sizes[name] = Math.round(statSync(file).size / 1024)
  }
  write('base', base)
  write('lid', layerOf(Float32Array.from(lid, (v, p) => Math.min(1, v + rarm[p]))))
  write('larm', layerOf(larm))
  write('coin', layerOf(coin))
  write('glint', layerOf(glint))
  write('glow', glow)
  write('lids', lids)
  return { versions: out, sizes }
}
