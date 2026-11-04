// ============================================================
// v2cap の案内役ナハトの絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2ナビ/<名前>.png（.webp でもよい・ChatGPT で描いた正方形）
//   名前は src/v2cap/lib/navi.js の NAVI_FACES の src（普通・得意・怒り・しょんぼり）
// 作るもの：public/v2cap-art/navi/<キー>.webp（NAVI_FACE_SIZE の正方形）
// 【確定】2026-11-05 ユーザー指示「いらすとがずれる」→選択「普通を土台に目と口だけ差し替え」：
//   ChatGPT に表情ちがいを頼むと、王冠の形・体の大きさ・位置まで描き変わる（「得意」は体がひと回り小さく、王冠も別物だった）。
//   → 「普通」の絵を土台にして、ほかの表情は**目と口のまわりだけ**を切り取って重ねる＝王冠・体・マント・腕・位置は4枚とも同じ
//   ・重ねる前に、表情の絵を「普通」の大きさと位置に合わせる（体の形が重なるように、大きさと位置を少しずつ動かして探す）
//   ・切り取るのは目と口を囲む楕円と、体の輪郭から内側へ BODY_INSET 入ったところの重なり。縁はぼかし、色味の差は楕円のふちで合わせる
//   ・体の形が「普通」と大きく違う絵（重なり SHAPE_MIN 未満）は止める＝「目と口だけ描きかえる」で頼み直してもらう
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★透明にならなかった絵は、背景が一色なら抜く（tools/v2cap-art-lib.mjs の keyBackground）。チェック模様は止める（「背景だけ直す」で直してもらう）
//   node tools/v2cap-navi-art.mjs                         … public/V2ナビ → public/v2cap-art/navi
//   node tools/v2cap-navi-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeSquare, keyBackground, bgModelOf, transparentBorderRatio } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { NAVI_FACES, NAVI_ART_DIR, NAVI_FACE_SIZE, NAVI_ART_FACES } = await import(new URL('../src/v2cap/lib/navi.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2ナビ'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', NAVI_ART_DIR.replace(/^\//, '')))
const QUALITY = 86
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」
const EDGE_LEFT_MAX = 0.2  // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」（精霊は縁に届かない）
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）
const SHAPE_MIN = 0.93     // 合わせたあとの体の形の重なり（共通部分÷和）。これ未満は体ごと描き変わっている
const BODY_INSET = 0.07    // 切り取る所は体の輪郭からこれだけ内側（両目の間の長さに対する割合）＝輪郭の線にさわらない
const FEATHER = 0.06       // 切り取る所の縁のぼかし（同じく両目の間の長さに対する割合）

const srcOf = (names) => names.flatMap(n => ['png', 'webp'].map(e => path.join(SRC, `${n}.${e}`))).find(existsSync) || null
const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 緑の背景を抜いたあと、線のふちに残った緑を消す（精霊の絵に緑はないので、緑が赤と青より強い画素だけ下げる）
const removeGreen = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) data[p * 4 + 1] = Math.min(data[p * 4 + 1], Math.max(data[p * 4], data[p * 4 + 2])) }
const isGreen = (bg) => bg[1] > bg[0] + 80 && bg[1] > bg[2] + 80
const load = (file, side) => {
  const rgba = decode(file, side, 'rgba')
  let img = rgba, mode = '透明つき'
  if (transparentBorderRatio(rgba) < ALPHA_MIN) {
    const rgb = decode(file, side, 'rgb24')
    const model = bgModelOf(rgb)
    if (model.mode === 'checker') throw new Error(`${path.basename(file)}：背景がチェック模様（「背景だけ直す」で描き直してもらう）`)
    const r = keyBackground(rgb)
    if (r.edgeLeft > EDGE_LEFT_MAX) throw new Error(`${path.basename(file)}：背景が抜けていない（縁の${Math.round(r.edgeLeft * 100)}%が体のまま）`)
    img = r.img
    if (isGreen(model.bg)) removeGreen(img)
    mode = `一色の背景（RGB ${model.bg.join(',')}）を抜いた`
  }
  snapAlpha(img)
  bleed(img)
  return { img, mode }
}

// 目（明るい金色）の左右の重心。目と口を囲む楕円の位置と大きさはここから決める
const eyesOf = ({ data, W, H }) => {
  const L = { n: 0, x: 0, y: 0 }, R = { n: 0, x: 0, y: 0 }
  for (let y = Math.round(H * 0.25); y < Math.round(H * 0.75); y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4
    if (data[p + 3] > 200 && data[p] > 200 && data[p + 1] > 150 && data[p + 2] < 90) { const s = x < W / 2 ? L : R; s.n++; s.x += x; s.y += y }
  }
  if (L.n < 200 || R.n < 200) throw new Error('「普通」の絵で金色の目が見つからない')
  return { l: [L.x / L.n, L.y / L.n], r: [R.x / R.n, R.y / R.n] }
}

// 体の輪郭からの距離（透明なところからの近さ・8方向のざっくりした距離）
const insideDistance = ({ data, W, H }) => {
  const d = new Float32Array(W * H)
  const BIG = 1e6
  for (let p = 0; p < W * H; p++) d[p] = data[p * 4 + 3] > 128 ? BIG : 0
  const D2 = Math.SQRT2
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (!d[p]) continue
    let v = d[p]
    if (x > 0) v = Math.min(v, d[p - 1] + 1)
    if (y > 0) { v = Math.min(v, d[p - W] + 1); if (x > 0) v = Math.min(v, d[p - W - 1] + D2); if (x < W - 1) v = Math.min(v, d[p - W + 1] + D2) }
    d[p] = v
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x
    if (!d[p]) continue
    let v = d[p]
    if (x < W - 1) v = Math.min(v, d[p + 1] + 1)
    if (y < H - 1) { v = Math.min(v, d[p + W] + 1); if (x < W - 1) v = Math.min(v, d[p + W + 1] + D2); if (x > 0) v = Math.min(v, d[p + W - 1] + D2) }
    d[p] = v
  }
  return d
}

// 表情の絵 e の上の位置：土台の (X, Y) → e の (X*k + ox, Y*k + oy)
const alphaAt = (e, x, y) => {
  const xi = Math.round(x), yi = Math.round(y)
  return xi < 0 || yi < 0 || xi >= e.W || yi >= e.H ? 0 : e.data[(yi * e.W + xi) * 4 + 3]
}
const shapeCost = (base, e, k, ox, oy, step) => {
  let c = 0
  for (let Y = 0; Y < base.H; Y += step) for (let X = 0; X < base.W; X += step) {
    const a = base.data[(Y * base.W + X) * 4 + 3] > 128, b = alphaAt(e, X * k + ox, Y * k + oy) > 128
    if (a !== b) c++
  }
  return c
}
const overlap = (base, e, { k, ox, oy }) => {
  let and = 0, or = 0
  for (let Y = 0; Y < base.H; Y += 2) for (let X = 0; X < base.W; X += 2) {
    const a = base.data[(Y * base.W + X) * 4 + 3] > 128, b = alphaAt(e, X * k + ox, Y * k + oy) > 128
    if (a && b) and++
    if (a || b) or++
  }
  return or ? and / or : 0
}
// 体の形が重なるように、大きさ（k）と位置（ox・oy）を探す。はじめは箱どうしを合わせ、粗く → 細かく
const align = (base, e) => {
  const bb = alphaBox(base), eb = alphaBox(e)
  const k0 = ((eb.x1 - eb.x0) / (bb.x1 - bb.x0) + (eb.y1 - eb.y0) / (bb.y1 - bb.y0)) / 2
  let best = { k: k0, ox: (eb.x0 + eb.x1) / 2 - (bb.x0 + bb.x1) / 2 * k0, oy: (eb.y0 + eb.y1) / 2 - (bb.y0 + bb.y1) / 2 * k0 }
  for (const [ks, ps, n, step] of [[0.01, 8, 4, 6], [0.003, 2, 3, 3], [0.001, 1, 2, 2]]) {
    const from = best
    let bestCost = shapeCost(base, e, from.k, from.ox, from.oy, step)
    for (let i = -n; i <= n; i++) for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
      const t = { k: from.k * (1 + i * ks), ox: from.ox + dx * ps, oy: from.oy + dy * ps }
      const c = shapeCost(base, e, t.k, t.ox, t.oy, step)
      if (c < bestCost) { bestCost = c; best = t }
    }
  }
  return best
}
const sample = (e, x, y) => {
  const x0 = Math.max(0, Math.min(e.W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(e.H - 2, Math.floor(y)))
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0))
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const v = (xx, yy) => e.data[(yy * e.W + xx) * 4 + c]
    out[c] = (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy
  }
  return out
}

// 目と口のまわりだけを、合わせた表情の絵から土台へ重ねる
const faceMaskOf = (base) => {
  const { l, r } = eyesOf(base)
  const d = Math.hypot(r[0] - l[0], r[1] - l[1])
  const ell = { cx: (l[0] + r[0]) / 2, cy: (l[1] + r[1]) / 2 + 0.03 * d, rx: 0.95 * d, ry: 0.42 * d }
  const inside = insideDistance(base)
  const inset = BODY_INSET * d, feather = FEATHER * d
  const w = new Float32Array(base.W * base.H)
  for (let Y = Math.floor(ell.cy - ell.ry); Y <= Math.ceil(ell.cy + ell.ry); Y++) for (let X = Math.floor(ell.cx - ell.rx); X <= Math.ceil(ell.cx + ell.rx); X++) {
    if (X < 0 || Y < 0 || X >= base.W || Y >= base.H) continue
    const p = Y * base.W + X
    const n = Math.hypot((X - ell.cx) / ell.rx, (Y - ell.cy) / ell.ry)
    const inEll = (1 - n) * Math.min(ell.rx, ell.ry)
    const v = Math.min(inEll, inside[p] - inset) / feather
    if (v > 0) w[p] = Math.min(1, v)
  }
  return { w, ell, d }
}
const composeFace = (base, e, fit, mask) => {
  const out = { W: base.W, H: base.H, data: Buffer.from(base.data) }
  // 色味の差（描き直しで体の色が少し変わる）を、楕円のふち（重ねる所のぼかしの中）で測って引く
  const shift = [0, 0, 0]
  let n = 0
  for (let p = 0; p < base.W * base.H; p++) {
    if (!(mask.w[p] > 0 && mask.w[p] < 0.5)) continue
    const X = p % base.W, Y = (p - X) / base.W
    const s = sample(e, X * fit.k + fit.ox, Y * fit.k + fit.oy)
    for (let c = 0; c < 3; c++) shift[c] += base.data[p * 4 + c] - s[c]
    n++
  }
  for (let c = 0; c < 3; c++) shift[c] = n ? shift[c] / n : 0
  for (let p = 0; p < base.W * base.H; p++) {
    const a = mask.w[p]
    if (!(a > 0)) continue
    const X = p % base.W, Y = (p - X) / base.W
    const s = sample(e, X * fit.k + fit.ox, Y * fit.k + fit.oy)
    for (let c = 0; c < 3; c++) out.data[p * 4 + c] = Math.round(base.data[p * 4 + c] * (1 - a) + Math.max(0, Math.min(255, s[c] + shift[c])) * a)
  }
  return { img: out, shift: shift.map(v => Math.round(v)) }
}

mkdirSync(OUT, { recursive: true })
const missing = [], failed = [], made = []
const baseFace = NAVI_FACES.find(f => f.key === 'normal')
const baseFile = srcOf(baseFace.src)
if (!baseFile) {
  console.log(`✖ 土台の「普通」の絵が無い（${baseFace.src.join('・')}.png）`)
  process.exit(1)
}
const SIDE = Math.max(probe(baseFile).w, probe(baseFile).h)
const base = load(baseFile, SIDE)
const bb = alphaBox(base.img)
const mask = faceMaskOf(base.img)
const write = (key, img) => {
  encodeSquare(img, bb, path.join(OUT, `${key}.webp`), { size: NAVI_FACE_SIZE.w, margin: 0.02, quality: QUALITY })
  made.push(key)
}
write('normal', base.img)
console.log(`✔ 普通 → normal.webp（${base.mode}・土台・両目の間 ${Math.round(mask.d)}px）`)
for (const f of NAVI_FACES.filter(x => x.key !== 'normal')) {
  const file = srcOf(f.src)
  if (!file) { missing.push(`${f.label}（${f.src.join('・')}.png）`); continue }
  try {
    const e = load(file, Math.max(probe(file).w, probe(file).h))
    const fit = align(base.img, e.img)
    const iou = overlap(base.img, e.img, fit)
    if (iou < SHAPE_MIN) throw new Error(`${path.basename(file)}：体の形が「普通」と重ならない（${Math.round(iou * 100)}%）＝「目と口だけ描きかえる」で頼み直してもらう`)
    const { img, shift } = composeFace(base.img, e.img, fit, mask)
    write(f.key, img)
    console.log(`✔ ${f.label} → ${f.key}.webp（${e.mode}・大きさ×${fit.k.toFixed(3)}・ずれ ${Math.round(fit.ox)},${Math.round(fit.oy)}px・体の重なり ${Math.round(iou * 100)}%・色味の差 ${shift.join(',')}）`)
  } catch (err) { failed.push(err.message) }
}
// 一覧に無くなった絵は消す（名前を変えて残った絵が画面に出ないように）
for (const name of readdirSync(OUT)) if (!made.includes(name.replace(/\.webp$/, ''))) { rmSync(path.join(OUT, name)); console.log(`🗑 ${name}（いまは作っていない）`) }
const want = NAVI_FACES.map(f => f.key).filter(k => made.includes(k))
if (want.join(',') !== NAVI_ART_FACES.join(',')) console.log(`⚠ navi.js の NAVI_ART_FACES を [${want.map(k => `'${k}'`).join(', ')}] にする（いまは [${NAVI_ART_FACES.map(k => `'${k}'`).join(', ')}]）`)
if (missing.length) console.log(`⚠ 元の絵が無い（届くまでは「普通」で出す）：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (failed.length) process.exitCode = 1
