// ============================================================
// v2cap のダンジョンのボスのイラスト版（立ち絵＋パーツ・塗りのエフェクト）を、画面で使う形にする（決まりは src/v2cap/lib/bossIllust.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/イラスト版/
//   立ち絵.png・体.png・頭.png・翼_手前.png（・翼_奥.png）・<技の名前>_飛ぶ.png・<技の名前>_当たる.png（どれも透明な背景）
// 作るもの：
//   public/v2cap-art/boss/<key>-il-<wingF|wingN|body|head>.webp … 立ち絵（640px）に重ねた位置で切り抜いたパーツ
//   public/v2cap-art/boss/<key>-il-fx-<技>-<fly|hit>.webp       … エフェクト（長いほうの辺 FX_SIDE まで縮める）
//   public/v2cap-art/boss/<key>-il-fx-<技>-flow.webp            … 流れる水の絵（エフェクトの絵の crop の所を、上と下がつながるように混ぜた絵・縦に並べて流す）
//   src/v2cap/lib/bossIllustList.js                             … 一覧（パーツの位置・回す中心・口・エフェクトの大きさ・中身の印）
// 手順：
//   ① パーツを立ち絵に重ねる：ChatGPT はパーツを立ち絵と同じ大きさ・場所に描かない（2026-10-28 頭は約半分・体は0.92倍・翼は0.77倍だった）
//      ＝形（立ち絵からはみ出さない）と明るさ（溶岩の筋・目）で、倍率・角度・位置を探す（1/8 → 1/4 → 1/2 の細かさで3回）。
//      よさ＝重なった画素がどれだけ似ているか×面積（小さく縮めて逃げない）−はみ出し
//   ② 翼_奥.png が無ければ、立ち絵からほかのパーツ（少し太らせた形）を除いた残りのうち、左上のいちばん大きいまとまりを奥の翼にする。
//      頭の後ろに隠れていた穴（翼の形を閉じた所と頭の重なり）はまわりの色で埋める（頭を動かしても黒い穴が見えない）
//   ③ 回す中心：翼・頭＝体（頭は体、奥の翼は頭と体）と重なった所の真ん中／全体＝体の真ん中。口＝頭のいちばん左
//   ④ 640px の立ち絵の大きさで、パーツを重ねた位置に描いて切り抜く（WebP・透明つき）
//   ⑤ 決まりの cuts（前脚・下あご）を親のパーツから多角形で切り分ける（2026-10-28 ユーザー「もっとひっかく」「口をしっかり開けて吐く」）。
//      回す中心・口・奥の翼は切り分ける前の形で出す（切り分けで変わらない）
//   ★2026-10-29 人の形（雨摩座）：パーツの並びと元の絵の名前はボスごと（layers・files）。
//      base: 'stand' ＝立ち絵そのものを体にする（ChatGPT の体は形が違った）。切り分けで空いた所は ChatGPT の体（fill）を重ねて埋める。
//      fixed ＝立ち絵に無いもの（水の帯）は重ねる場所を探さず、描いた場所のまま置く
//   ★2026-10-29 黒龍の描き直し（split）：ChatGPT の翼・しっぽは立ち絵と形が違ったので、ChatGPT の体（翼としっぽの無い体）の形の外を
//      多角形で翼・しっぽに分ける（体の形の中は体のまま）。体の後ろに隠れていた付け根は近いパーツの模様を折り返して埋める
//   ★2026-10-29 曲げるパーツ（bend・黒龍のしっぽの巻いた先）：付け根からの距離に応じて回す（ひねり）で角度ごとに曲げた絵を作り、横に並べた1枚にする。
//      回すだけだと付け根で折れて見え、硬い部品をつなぐと大きく振ったときつなぎ目が割れた（ユーザー「しっぽ動かすの不自然って思わない？」）
//   ★2026-10-30 技のポーズの絵（poses）：技ごとのため・振り抜きの全身の絵（立ち絵と同じ大きさの正方形に描いてもらう）を、立ち絵と同じ割合で縮めて切り抜く。
//      ずれていたら def.poseFit（元の絵の名前 → { s, dx, dy }）で直す（fixedFitOf と同じ）。無い絵は作らない（その技は部品の動きのまま）
//   ★2026-10-29 後ろの絵（split.back）：立ち絵から頭・首・前脚を消して後ろの翼と胸を描き足した絵（後ろ.png）を重ね、頭・首・前脚が
//      止まっているとき覆っている所だけを埋める（翼の所は翼へ・ほかは体へ）。技で大きく動かすと、模様を折り返して埋めた所が切れ端や四角いかたまりに見えた
//   ★2026-10-29 腕の構え（swaps）：右腕だけを描き変えた立ち絵（立ち絵_胸元.png・立ち絵_掲げる.png）を重ね、腕のまわり（armZone）だけを切り取って
//      切り替えるパーツにする（体からはその所を抜く）。構えの絵のふちはぼかす・枠の上へはみ出す絵は top px だけ上へ広げて描く
// 使い方：node tools/v2cap-boss-illust.mjs [--force]
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bleed, versionOf } from './v2cap-art-lib.mjs'
import { readRgba, componentsOf } from './v2cap-motion.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, bossFileOf } from '../src/v2cap/lib/bossArt.js'
import { BOSS_ILLUST_DEFS, BOSS_ILLUST_SRC, BOSS_ILLUST_SIZE, illustPartsOf, illustFilesOf, illustKindOf, illustFxKindOf, illustBendKindOf, illustPoseKindOf, rotPoint } from '../src/v2cap/lib/bossIllust.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { BOSS_ILLUST } from '../src/v2cap/lib/bossIllustList.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossIllustList.js')
const FORCE = process.argv.includes('--force')
const QUALITY = 88
const FX_SIDE = 384     // エフェクトの長いほうの辺（px）。いちばん大きく出す終焉の黒焔（枠300pxの0.72倍＝216px）を2倍の細かさの画面で出してもほぼぼけない
const FX_QUALITY = 80   // エフェクトは塗りが細かく重いので少し下げる（1枚 50〜90KB）
const SEEN = 40         // 見えているとみなす透明度（0〜255）

// ---- 画素の道具 ----
export const resizeRgba = (img, W, H, blur = 0) => {
  const vf = `scale=${W}:${H}:flags=area${blur ? `,gblur=sigma=${blur}` : ''}`
  const data = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.W}x${img.H}`, '-i', '-',
    '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: img.data, maxBuffer: 1 << 28 })
  return { W, H, data: Buffer.from(data) }
}
const lumOf = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
const maskOf = (img, thr = SEEN) => { const m = new Uint8Array(img.W * img.H); for (let p = 0; p < m.length; p++) m[p] = img.data[p * 4 + 3] >= thr ? 1 : 0; return m }
// 3×3 で太らせる・細らせる（r 回）
export const dilate = (m, W, H, r) => {
  let a = m
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a.length)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0
      for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && a[yy * W + xx]) { v = 1; break }
      }
      b[y * W + x] = v
    }
    a = b
  }
  return a
}
export const erode = (m, W, H, r) => dilate(m.map(v => 1 - v), W, H, r).map(v => 1 - v)
// 点 (x, y) が多角形 poly（[[x, y], …]）の中か
export const inPoly = (poly, x, y) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
  }
  return c
}
const centroidOf = (m, W) => {
  let sx = 0, sy = 0, n = 0
  for (let p = 0; p < m.length; p++) if (m[p]) { sx += p % W; sy += (p / W) | 0; n++ }
  return n ? [sx / n, sy / n] : null
}

// ---- ① パーツを立ち絵に重ねる ----
const samplesOf = (P, n) => {
  const pts = []
  for (let y = 0; y < P.H; y++) for (let x = 0; x < P.W; x++) {
    const i = (y * P.W + x) * 4
    if (P.data[i + 3] > 160) pts.push([x, y, lumOf(P.data, i)])
  }
  const step = Math.max(1, Math.floor(pts.length / n))
  return pts.filter((_, i) => i % step === 0)
}
// よさ（大きいほど良い）：はみ出しは −1.5、重なりは明るさの近さ（どちらかが明るい＝溶岩の筋・目は3倍）。面積（s²）を掛ける
const scoreOf = (T, pts, s, deg, tx, ty) => {
  const th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th)
  let sum = 0
  for (const [x, y, l] of pts) {
    const X = Math.round(s * (c * x - sn * y) + tx), Y = Math.round(s * (sn * x + c * y) + ty)
    if (X < 0 || Y < 0 || X >= T.W || Y >= T.H || T.data[(Y * T.W + X) * 4 + 3] < 100) { sum -= 1.5; continue }
    const lt = lumOf(T.data, (Y * T.W + X) * 4)
    sum += ((l > 110 || lt > 110) ? 3 : 1) * (1 - Math.min(2, Math.abs(l - lt) / 40))
  }
  return sum * s * s / pts.length
}
// パーツの点 (x, y) → 立ち絵の点 = s・回転(deg)・(x, y) + (tx, ty)（どちらも元の絵の px）
export const fitPart = (T0, P0) => {
  const level = (K, blur, n) => {
    const W = Math.round(T0.W / K), H = Math.round(T0.H / K)
    const T = resizeRgba(T0, W, H, blur)
    const P = resizeRgba(P0, Math.round(P0.W / K), Math.round(P0.H / K), blur)
    return { K, T, pts: samplesOf(P, n) }
  }
  const search = (L, ss, degs, txs, tys) => {
    let best = { score: -Infinity }
    for (const deg of degs) for (const s of ss) for (const ty of tys) for (const tx of txs) {
      const score = scoreOf(L.T, L.pts, s, deg, tx, ty)
      if (score > best.score) best = { score, s, deg, tx, ty }
    }
    return best
  }
  const range = (a, b, st) => { const r = []; for (let v = a; v <= b + 1e-9; v += st) r.push(+v.toFixed(4)); return r }
  const L8 = level(8, 1.5, 350)
  let b = search(L8, range(0.2, 1.4, 0.02), [0], range(-L8.T.W, L8.T.W, 2), range(-L8.T.H, L8.T.H, 2))
  const L4 = level(4, 1, 1200)
  b = search(L4, range(b.s - 0.06, b.s + 0.06, 0.01), range(-12, 12, 2), range(b.tx * 2 - 12, b.tx * 2 + 12, 2), range(b.ty * 2 - 12, b.ty * 2 + 12, 2))
  const L2 = level(2, 0.8, 2500)
  b = search(L2, range(b.s - 0.015, b.s + 0.015, 0.005), range(b.deg - 2, b.deg + 2, 1), range(b.tx * 2 - 6, b.tx * 2 + 6, 1), range(b.ty * 2 - 6, b.ty * 2 + 6, 1))
  return { s: b.s, deg: b.deg, tx: b.tx * 2, ty: b.ty * 2, score: +b.score.toFixed(3) }
}

// 立ち絵に無いもの（雨摩座の水の帯）：重ねる場所を探さず、描いた場所のまま。立ち絵の大きさに合わせてから s 倍（真ん中を中心に）・dx・dy ずらす
export const fixedFitOf = (T0, P, { s = 1, dx = 0, dy = 0 } = {}) => {
  const ss = (T0.W / P.W) * s
  return { s: +ss.toFixed(4), deg: 0, tx: Math.round((T0.W - P.W * ss) / 2 + dx), ty: Math.round((T0.H - P.H * ss) / 2 + dy), score: 0 }
}

// パーツを立ち絵の大きさ（W×H・倍率 k＝出す大きさ/立ち絵）に、重ねた位置で描く（なめらかに読む）
export const warpPart = (P, fit, W, H, k) => {
  const th = fit.deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th)
  const out = Buffer.alloc(W * H * 4)
  const at = (x, y, ch) => (x < 0 || y < 0 || x >= P.W || y >= P.H) ? 0 : P.data[(y * P.W + x) * 4 + ch]
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const u = ((X + 0.5) / k - fit.tx) / fit.s, v = ((Y + 0.5) / k - fit.ty) / fit.s
    const x = c * u + sn * v - 0.5, y = -sn * u + c * v - 0.5
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
    if (x0 < -1 || y0 < -1 || x0 >= P.W || y0 >= P.H) continue
    const i = (Y * W + X) * 4
    for (let ch = 0; ch < 4; ch++) {
      const v00 = at(x0, y0, ch), v10 = at(x0 + 1, y0, ch), v01 = at(x0, y0 + 1, ch), v11 = at(x0 + 1, y0 + 1, ch)
      out[i + ch] = Math.round((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)
    }
  }
  return { W, H, data: out }
}

// 四角く切り抜く（x・y・w・h は元の絵の px）
const cropRgba = (img, x, y, w, h) => {
  const data = Buffer.alloc(w * h * 4)
  for (let r = 0; r < h; r++) img.data.copy(data, r * w * 4, ((y + r) * img.W + x) * 4, ((y + r) * img.W + x + w) * 4)
  return { W: w, H: h, data }
}
// 縦だけぼかす（sigma＝px）
const blurYRgba = (img, sigma) => {
  const data = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.W}x${img.H}`, '-i', '-',
    '-vf', `gblur=sigma=0.01:sigmaV=${sigma}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: img.data, maxBuffer: 1 << 28 })
  return { W: img.W, H: img.H, data: Buffer.from(data) }
}
// 上と下がつながる絵にする（縦に並べてもつなぎ目が見えない）：下のはしの band 行を、上のはしの band 行にだんだん混ぜて、その band 行を切り落とす
//   T[y] = 元[y]（y ≥ band）／ 元[y + H − band] と 元[y] を y / band の割合で混ぜる（y < band）→ 高さ H − band
export const seamlessY = (img, band) => {
  const H = img.H - band, W = img.W, data = Buffer.alloc(W * H * 4)
  img.data.copy(data, 0, 0, W * H * 4)
  for (let y = 0; y < band; y++) {
    const k = y / band
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = ((y + H) * W + x) * 4
      for (let ch = 0; ch < 4; ch++) data[i + ch] = Math.round(img.data[j + ch] * (1 - k) + img.data[i + ch] * k)
    }
  }
  return { W, H, data }
}
// 曲げる（def.bend の1つ・b）：付け根 base からの距離 r に応じて deg° 回す（r0 までは 0・r1 で deg・あいだはなめらか・＋で時計回り）。
//   回しても base からの距離は変わらない＝出す点を逆に回せば元の点（つなぎ目ができない）。色は透明度を掛けてから混ぜる（ふちが黒くにごらない）
export const bendWarp = (img, S, b, deg) => {
  const out = Buffer.alloc(S * S * 4), [cx, cy] = b.base, src = img.data
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy)
    const k = Math.min(1, Math.max(0, (r - b.r0) / (b.r1 - b.r0))), th = -deg * k * k * (3 - 2 * k) * Math.PI / 180
    const sx = cx + dx * Math.cos(th) - dy * Math.sin(th) - 0.5, sy = cy + dx * Math.sin(th) + dy * Math.cos(th) - 0.5
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
    let a = 0, rr = 0, gg = 0, bb = 0
    for (const [xx, yy, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
      if (xx < 0 || yy < 0 || xx >= S || yy >= S || !w) continue
      const i = (yy * S + xx) * 4, aw = src[i + 3] * w
      a += aw; rr += src[i] * aw; gg += src[i + 1] * aw; bb += src[i + 2] * aw
    }
    if (a < 0.5) continue
    const o = (y * S + x) * 4
    out[o] = Math.round(rr / a); out[o + 1] = Math.round(gg / a); out[o + 2] = Math.round(bb / a); out[o + 3] = Math.round(a)
  }
  return { W: S, H: S, data: out }
}

// 透明でない範囲で切り抜く → { img, x, y }
const trim = (img) => {
  let x0 = img.W, y0 = img.H, x1 = -1, y1 = -1
  for (let y = 0; y < img.H; y++) for (let x = 0; x < img.W; x++) if (img.data[(y * img.W + x) * 4 + 3] > 2) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1, h = y1 - y0 + 1, data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) img.data.copy(data, y * w * 4, ((y0 + y) * img.W + x0) * 4, ((y0 + y) * img.W + x1 + 1) * 4)
  return { img: { W: w, H: h, data }, x: x0, y: y0 }
}
const writeWebp = (img, out, q = QUALITY) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.W}x${img.H}`, '-i', '-',
    '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(q), '-compression_level', '6', out], { input: img.data, maxBuffer: 1 << 28 })
  return statSync(out).size
}
// いちばん左（相手の方）の先 → { x, y }：見えている画素が縦に4px以上ある列から。y はそこから右へ8列の見えている画素の高さの平均
export const leftTipOf = (img, thr = 128) => {
  const { W, H, data } = img
  const n = (x) => { let c = 0; for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] >= thr) c++; return c }
  let x0 = 0
  while (x0 < W - 1 && n(x0) < 4) x0++
  let sy = 0, c = 0
  for (let x = x0; x < Math.min(W, x0 + 8); x++) for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] >= thr) { sy += y; c++ }
  return { x: x0, y: c ? Math.round(sy / c) : Math.round(H / 2) }
}

const build = (key, def, dir) => {
  const need = (name) => {
    const f = path.join(dir, `${name}.png`)
    if (!existsSync(f)) throw new Error(`元の絵が無い：${path.relative(ROOT, f)}`)
    return f
  }
  mkdirSync(OUT, { recursive: true })
  const notes = [], sizes = []
  const T0 = readRgba(need('立ち絵'))
  const k = BOSS_ILLUST_SIZE / T0.W, S = BOSS_ILLUST_SIZE
  const PARTS = illustPartsOf(key), FILES = illustFilesOf(key)
  const layers = {}, fits = {}
  // ① 体・頭・翼_手前（・翼_奥）。fixed（水の帯）は描いた場所のまま
  for (const part of PARTS.filter(p => FILES[p])) {
    const f = path.join(dir, `${FILES[part]}.png`)
    if (!existsSync(f)) { if (part === 'wingF') continue; throw new Error(`元の絵が無い：${path.relative(ROOT, f)}`) }
    const P = readRgba(f)
    bleed(P)
    const fixed = def.fixed?.[part]
    const fit = fixed ? fixedFitOf(T0, P, fixed) : fitPart(T0, P)
    fits[part] = fit
    layers[part] = warpPart(P, fit, S, S, k)
    notes.push(`${FILES[part]}：倍率${fit.s.toFixed(3)}・角度${fit.deg}°・位置 ${fit.tx},${fit.ty}${fixed ? '（描いた場所のまま）' : `（よさ ${fit.score}）`}`)
  }
  // 立ち絵が体（base: 'stand'）。ChatGPT の体は、切り分けで空いた所を埋める絵（fill）にだけ使う
  let fill = null, back = null
  if (def.base === 'stand') {
    layers.body = resizeRgba(T0, S, S)
    if (def.fill) {
      const P = readRgba(need(def.fill))
      bleed(P)
      const fit = fitPart(T0, P)
      fits.body = fit
      fill = warpPart(P, fit, S, S, k)
      notes.push(`体：立ち絵そのもの。${def.fill}（すき間を埋める）は倍率${fit.s.toFixed(3)}・角度${fit.deg}°・位置 ${fit.tx},${fit.ty}（よさ ${fit.score}）`)
    }
  }
  // ⑦ 体の外を分ける（split・2026-10-29 黒龍の描き直し）：ChatGPT の体（split.by＝翼としっぽの無い体）を立ち絵に重ね、その形の外にある立ち絵の画素を
  //   多角形（take）で翼・しっぽに分ける（体の形の中は体のまま＝しっぽに乗った足の爪も体に残る）。体から消すのは drop（無ければ take）の中だけ
  //   ＝take を付け根の側へ広く取ると、付け根は体にも残り、回してもすき間が見えない。
  //   hide px：体の後ろに隠れていた所（体の形の中・パーツから hide px まで）を、近いパーツの模様を折り返して埋める（翼やしっぽを動かすと付け根が見える）
  if (def.split) {
    const P = readRgba(need(def.split.by))
    bleed(P)
    const fit = fitPart(T0, P)
    fits.body = fit
    const shape = dilate(maskOf(warpPart(P, fit, S, S, k), 100), S, S, def.split.grow ?? 1)
    const stand = resizeRgba(T0, S, S)
    // 後ろの絵（split.back・2026-10-29 技の見直し）：立ち絵から頭・首・前脚を消して、後ろに隠れていた翼と胸を描き足した絵。
    //   zones（切り分けるパーツ）の drop の中で、立ち絵ではそのパーツが覆っていた所だけに使う＝止まっているときは見えない。
    //   翼の多角形（parts の back）の中は、その翼の隠れていた所（翼といっしょに動く）・ほかは体（切り分けたあとに埋める）
    //   ＝模様を折り返して埋めた所が、頭を上げる技・前脚を振る技で四角いかたまりや切れ端に見えた
    const bk = def.split.back
    const backFile = bk && path.join(dir, `${bk.file}.png`)
    if (bk && existsSync(backFile)) {
      const B = readRgba(backFile)
      bleed(B)
      const bf = fitPart(T0, B)
      fits.back = bf
      back = { img: warpPart(B, bf, S, S, k), zone: new Uint8Array(S * S), wing: new Uint8Array(S * S) }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (stand.data[(y * S + x) * 4 + 3] >= 230 && bk.zones.some(c => inPoly(def.cuts[c].drop || def.cuts[c].take, x + 0.5, y + 0.5))) back.zone[y * S + x] = 1
      }
      notes.push(`後ろの絵：${bk.file}を倍率${bf.s.toFixed(3)}・角度${bf.deg}°・位置 ${bf.tx},${bf.ty}で重ねた（よさ ${bf.score}）`)
    } else if (bk) notes.push(`後ろの絵：${bk.file}.png がまだ無い（頭・首・前脚の後ろは模様を折り返して埋める）`)
    for (const [part, sp] of Object.entries(def.split.parts)) {
      const img = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
      const own = new Uint8Array(S * S)
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const p = y * S + x
        if (shape[p] || !stand.data[p * 4 + 3] || !inPoly(sp.take, x + 0.5, y + 0.5)) continue
        stand.data.copy(img.data, p * 4, p * 4, p * 4 + 4)
      }
      // 小さいまとまり（体のふちの細い線・とげの先＝体の形から少しはみ出した所）は体に残す
      //   ＝翼といっしょに動くと、頭の後ろのとげのふちが浮いて見えた（2026-10-29）
      const { labels, comps } = componentsOf(img)
      let n = 0, returned = 0
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const p = y * S + x
        if (labels[p] < 0) continue
        if (comps[labels[p]].n < (def.split.minPx ?? 300)) { img.data[p * 4 + 3] = 0; returned++; continue }
        if (img.data[p * 4 + 3] >= SEEN) { own[p] = 1; n++ }
        if (inPoly(sp.drop || sp.take, x + 0.5, y + 0.5)) layers.body.data[p * 4 + 3] = 0
      }
      let hidden = 0
      if (sp.hide) {
        // 隠れていた所＝立ち絵で体がしっかり覆っている所（止まっているときは見えない）。いちばん近いパーツの画素で折り返した色で埋める
        //   ＝模様がつながる（ぼかした色で埋めたら、翼を回したとき前脚や肩のまわりに赤いもやが見えた・2026-10-29）
        const solid = (p) => img.data[p * 4 + 3] >= 200
        const near = new Int32Array(S * S).fill(-1)
        let front = []
        for (let p = 0; p < S * S; p++) if (solid(p)) { near[p] = p; front.push(p) }
        for (let d = 0; d < sp.hide && front.length; d++) {
          const next = []
          for (const q of front) {
            const qx = q % S, qy = (q - qx) / S
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const x = qx + dx, y = qy + dy, p = y * S + x
              if (x < 0 || y < 0 || x >= S || y >= S || near[p] >= 0) continue
              near[p] = near[q]
              next.push(p)
            }
          }
          front = next
        }
        // 埋めるのは次の所だけ（パーツの外まで広く埋めると、回したとき前脚の横に模様のかたまりが浮いて見えた・2026-10-29）：
        //   付け根のまわり（回す中心から root px）・パーツの形を close px で閉じた中（細く隠れていた所）＝折り返した色／
        //   回す向きにたどって、体（立ち絵で体の形の中がしっかり塗られた所）を出たすぐ先がパーツ（sweep° まで）の所＝パーツが体の後ろへ続いていた所
        //     （前脚に隠れていた翼のふち＝翼を上げると前脚の上にすき間が見えた）。体を出た先が空なら埋めない（翼が届いていない所＝前脚の左上に模様が浮いた）
        //     色は、たどって着いたパーツの画素（模様が回る向きにのびる）
        const closed = sp.close ? erode(dilate(own, S, S, sp.close), S, S, sp.close) : own
        const piv = def.pivots?.[part], rr = sp.root || 0
        const src = Buffer.from(img.data), mine = (p) => own[p] && src[p * 4 + 3] >= 200
        const alongArc = (x, y) => {
          if (!piv || !sp.sweep) return -1
          for (const sg of [1, -1]) for (let a = 0.25; a <= sp.sweep; a += 0.25) {
            const [qx, qy] = rotPoint([x + 0.5, y + 0.5], piv, a * sg).map(Math.floor)
            if (qx < 0 || qy < 0 || qx >= S || qy >= S) break
            const q = qy * S + qx
            if (mine(q)) return q
            if (!shape[q] || stand.data[q * 4 + 3] < 230) break
          }
          return -1
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const p = y * S + x
          if (own[p] || near[p] < 0 || !shape[p] || stand.data[p * 4 + 3] < 230 || !inPoly(sp.take, x + 0.5, y + 0.5)) continue
          let from = -1
          if (closed[p] || (piv && Math.hypot(x + 0.5 - piv[0], y + 0.5 - piv[1]) < rr)) {
            const q = near[p], qx = q % S, qy = (q - qx) / S, rx = 2 * qx - x, ry = 2 * qy - y, r = ry * S + rx
            from = rx >= 0 && ry >= 0 && rx < S && ry < S && mine(r) ? r : q
          } else from = alongArc(x, y)
          if (from < 0) continue
          src.copy(img.data, p * 4, from * 4, from * 4 + 3)
          img.data[p * 4 + 3] = 255
          hidden++
        }
      }
      // 離れ小島を消す（2026-10-29 技の見直し）：見えている画素（SEEN 以上）でつながりを数え直し、いちばん大きいまとまりと island px 以上だけ残す
      //   ＝埋めた筋が、翼を大きく上げる技で前脚の爪のまわりに浮いて見えた。
      //   消すのは埋めた画素だけ（体の形の中＝体がもともと覆っている）。立ち絵から取った画素は小さくても翼のまま（体へ戻すと、翼が動いても止まって見えた）
      let isl = 0
      const inZone = (p) => bk && bk.zones.some(c => inPoly(def.cuts[c].drop || def.cuts[c].take, p % S + 0.5, Math.floor(p / S) + 0.5))
      if (sp.island) {
        const solid = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
        for (let p = 0; p < S * S; p++) if (img.data[p * 4 + 3] >= SEEN) solid.data[p * 4 + 3] = 255
        const cc = componentsOf(solid)
        const big = cc.comps.reduce((b, c, i) => c.n > cc.comps[b].n ? i : b, 0)
        const keep = new Uint8Array(S * S)
        for (let p = 0; p < S * S; p++) { const l = cc.labels[p]; if (l >= 0 && (l === big || cc.comps[l].n >= sp.island)) keep[p] = 1 }
        const near = dilate(keep, S, S, 2)
        // 頭・前脚の切り分ける所（後ろの絵の zones）にある立ち絵のごく小さいかけら（tiny px まで）は体へ戻す＝頭や前脚といっしょに動く
        //   （頭の左上のとげの先が体の形から少しはみ出して翼に入り、頭を上げても翼といっしょに残った・2026-10-29）
        const tiny = (p) => { const l = cc.labels[p]; return l >= 0 && cc.comps[l].n < (sp.tiny || 0) }
        for (let p = 0; p < S * S; p++) {
          if (!img.data[p * 4 + 3] || keep[p] || (near[p] && img.data[p * 4 + 3] < SEEN)) continue
          if (!shape[p]) {
            if (!tiny(p) || !inZone(p)) continue
            stand.data.copy(layers.body.data, p * 4, p * 4, p * 4 + 4)
          }
          img.data[p * 4 + 3] = 0
          isl++
        }
      }
      // 後ろの絵の翼の所（zones の中・翼の多角形 back の中）は後ろの絵で塗り直す（何も描かれていなければ空ける＝翼が届いていない）
      let fromBack = 0
      if (back && sp.back) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const p = y * S + x
          if (!back.zone[p] || !inPoly(sp.back, x + 0.5, y + 0.5)) continue
          back.wing[p] = 1   // 体には埋めない（立ち絵で見えていた翼の所も＝体に後ろの絵を埋めると、止まっているときの見た目が変わった）
          if (own[p]) continue
          if (back.img.data[p * 4 + 3] < SEEN) { img.data[p * 4 + 3] = 0; continue }
          back.img.data.copy(img.data, p * 4, p * 4, p * 4 + 4)
          fromBack++
        }
      }
      // 後ろの絵で塗ったあと、いちばん大きいまとまりにつながらない小さいまとまりを片付ける（後ろの絵で何も無い所を空けると、つながりが切れて残る）：
      //   後ろの絵の画素だけのまとまり（island px まで）は消す（後ろの絵の翼の先が少しずれて宙に浮いた）／
      //   頭・前脚の切り分ける所のごく小さいまとまり（tiny px まで）は体へ戻す（頭の左上のとげの先が、頭を突き出しても宙に残った）
      if (fromBack && sp.island) {
        const solid = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
        for (let p = 0; p < S * S; p++) if (img.data[p * 4 + 3] >= SEEN) solid.data[p * 4 + 3] = 255
        const cc = componentsOf(solid), tied = new Uint8Array(cc.comps.length)
        const big = cc.comps.reduce((m, c, i) => c.n > cc.comps[m].n ? i : m, 0)
        for (let p = 0; p < S * S; p++) if (cc.labels[p] >= 0 && !back.wing[p]) tied[cc.labels[p]] = 1
        for (let p = 0; p < S * S; p++) {
          const l = cc.labels[p]
          if (l < 0 || l === big) continue
          if (!tied[l] && cc.comps[l].n < sp.island) { img.data[p * 4 + 3] = 0; isl++; continue }
          if (cc.comps[l].n < (sp.tiny || 0) && inZone(p)) {
            if (!shape[p] && stand.data[p * 4 + 3]) stand.data.copy(layers.body.data, p * 4, p * 4, p * 4 + 4)
            img.data[p * 4 + 3] = 0
            isl++
          }
        }
      }
      layers[part] = img
      notes.push(`${part}：立ち絵の体の外から ${n}px（小さいまとまり ${returned}px は体に残した・隠れていた所 ${hidden}px を埋めた${fromBack ? `・後ろの絵から ${fromBack}px` : ''}${isl ? `・離れ小島 ${isl}px を消した` : ''}）`)
    }
    notes.push(`体の形：${def.split.by}を倍率${fit.s.toFixed(3)}・角度${fit.deg}°・位置 ${fit.tx},${fit.ty}で重ねた（よさ ${fit.score}）`)
  }
  // ⑥ 腕の構えの絵（swaps・2026-10-29 雨摩座の手振り）：右腕だけを描き変えた立ち絵を立ち絵に重ね、腕のまわり（armZone・頭は除く）だけを切り取る。
  //   体からその所を抜き、3つの絵（ふだん＝立ち絵・胸元・真上）のどれか1つで埋める。構えの絵のふちは swapFeather px でぼかす（下の体になじむ）。
  //   extra＝その絵だけが描く所（掲げた腕が冠の横を通る）・top＝枠の上へはみ出すぶん（掲げた指先）。fitOn＝そこだけで重ね直す（人物が描き変わった絵）
  const tops = {}
  let zone = null, bodyFull = null   // bodyFull＝腕のまわりを抜く前の体（全体を回す中心はこちらで決める＝抜いても動きが変わらない）
  if (def.swaps) {
    const headPoly = def.cuts?.head?.take
    const inZone = (x, y) => def.armZone.some(z => inPoly(z, x, y)) && !(headPoly && inPoly(headPoly, x, y))
    const stand = resizeRgba(T0, S, S)
    for (const [part, sw] of Object.entries(def.swaps)) {
      const top = sw.top || 0, H = S + top
      const core = new Uint8Array(S * H)
      for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
        const fx = x + 0.5, fy = y - top + 0.5
        if (inZone(fx, fy) || (sw.extra || []).some(z => inPoly(z, fx, fy))) core[y * S + x] = 1
      }
      const img = { W: S, H, data: Buffer.alloc(S * H * 4) }
      if (sw.base) {
        for (let p = 0; p < S * S; p++) if (core[p + top * S]) stand.data.copy(img.data, (p + top * S) * 4, p * 4, p * 4 + 4)
      } else {
        const P = readRgba(need(sw.file))
        bleed(P)
        let fit = fitPart(T0, P)
        if (sw.fitOn) {
          // 重ねた位置で fitOn の外を消して、もう一度重ねる
          const th = fit.deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th)
          const Q = { W: P.W, H: P.H, data: Buffer.from(P.data) }
          for (let y = 0; y < P.H; y++) for (let x = 0; x < P.W; x++) {
            const X = k * (fit.s * (c * x - sn * y) + fit.tx), Y = k * (fit.s * (sn * x + c * y) + fit.ty)
            if (!inPoly(sw.fitOn, X, Y)) Q.data[(y * P.W + x) * 4 + 3] = 0
          }
          fit = fitPart(T0, Q)
        }
        fits[part] = fit
        const V = warpPart(P, { ...fit, ty: fit.ty + top / k }, S, H, k)
        // ぼかし：core の外へ swapFeather px で 1→0（頭の所は extra の中だけ）
        const F = def.swapFeather || 0, soft = new Float32Array(S * H)
        let cur = core
        for (let p = 0; p < S * H; p++) if (core[p]) soft[p] = 1
        for (let i = 1; i <= F; i++) {
          const nx = dilate(cur, S, H, 1)
          for (let p = 0; p < S * H; p++) if (nx[p] && !cur[p]) soft[p] = 1 - i / (F + 1)
          cur = nx
        }
        for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
          const p = y * S + x
          if (!core[p] && soft[p] && headPoly && inPoly(headPoly, x + 0.5, y - top + 0.5)) soft[p] = 0
          V.data.copy(img.data, p * 4, p * 4, p * 4 + 3)
          img.data[p * 4 + 3] = Math.round(V.data[p * 4 + 3] * soft[p])
        }
        notes.push(`${sw.file}：倍率${fit.s.toFixed(3)}・角度${fit.deg}°・位置 ${fit.tx},${fit.ty}（よさ ${fit.score}${sw.fitOn ? '・胴のまわりで重ね直した' : ''}）`)
      }
      layers[part] = img
      tops[part] = top
    }
    bodyFull = maskOf(layers.body)
    zone = new Uint8Array(S * S)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inZone(x + 0.5, y + 0.5)) { zone[y * S + x] = 1; layers.body.data[(y * S + x) * 4 + 3] = 0 }
    notes.push(`右腕：腕のまわり ${zone.reduce((a, v) => a + v, 0)}px を体から抜いて、3つの絵で切り替える`)
  }
  // ② 奥の翼を立ち絵から切り出す
  const T = resizeRgba(T0, S, S)
  const mk = (part) => maskOf(layers[part])
  const body = mk('body')
  if (PARTS.includes('wingF') && !layers.wingF) {
    const head = mk('head'), wingN = mk('wingN')
    const used = dilate(body.map((v, p) => v | head[p] | wingN[p]), S, S, 2)
    const rest = { W: S, H: S, data: Buffer.from(T.data) }
    const tm = maskOf(T)
    for (let p = 0; p < S * S; p++) if (!tm[p] || used[p]) rest.data[p * 4 + 3] = 0
    const { labels, comps } = componentsOf(rest)
    let pick = -1
    comps.forEach((c, id) => {
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2
      if (cx < S * 0.6 && cy < S * 0.5 && (pick < 0 || c.n > comps[pick].n)) pick = id
    })
    if (pick < 0) throw new Error('立ち絵から奥の翼が見つからない（左上に残りが無い）')
    const wf = new Uint8Array(S * S)
    for (let p = 0; p < S * S; p++) if (labels[p] === pick) wf[p] = 1
    // 背中のとげ（決まりの wingFToBody の中）は体に入れる（翼といっしょに動くと外れて見えた・2026-10-28）
    let toBody = 0
    if (def.wingFToBody) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = y * S + x
      if (!wf[p] || !inPoly(def.wingFToBody, x + 0.5, y + 0.5)) continue
      wf[p] = 0; toBody++
      if (layers.body.data[p * 4 + 3] < T.data[p * 4 + 3]) T.data.copy(layers.body.data, p * 4, p * 4, p * 4 + 4)
    }
    // 隠れていた所（頭・体・手前の翼の後ろ）は、翼のふちから 32px まで埋める
    //   ＝翼や首を回して付け根のまわりが見えても、ちぎれたふちや空が見えない（2026-10-28 ユーザー「付け根が外れて見えてる」）
    //   しっかり覆われている所＝翼の色をぼかした色／覆いのふちやとげのすき間（止まっているときも見える）＝立ち絵の色（止まっているときは立ち絵と同じ）
    const cover = erode(['body', 'head', 'wingN'].map(k => maskOf(layers[k], 230)).reduce((a, m) => a.map((v, p) => v | m[p])), S, S, 1)
    const reach = dilate(wf, S, S, 32), closed = erode(dilate(wf, S, S, 14), S, S, 14)
    const img = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
    const pm = { W: S, H: S, data: Buffer.alloc(S * S * 4) }   // 色×透明度（ぼかしてから透明度で割る＝翼の色だけの平均）
    for (let p = 0; p < S * S; p++) if (wf[p]) {
      T.data.copy(img.data, p * 4, p * 4, p * 4 + 4)
      const a = T.data[p * 4 + 3] / 255
      for (let ch = 0; ch < 3; ch++) pm.data[p * 4 + ch] = Math.round(T.data[p * 4 + ch] * a)
      pm.data[p * 4 + 3] = T.data[p * 4 + 3]
    }
    bleed(img, 40)
    const blur = resizeRgba(pm, S, S, 12)
    let holes = 0
    for (let p = 0; p < S * S; p++) {
      if (wf[p] || !reach[p] || !used[p]) continue
      // 見える所は、翼に囲まれたすき間（翼の形を閉じた中）だけ。頭の外のふちは入れない（翼を回すと頭のふちの影が浮いて見えた）
      if (!cover[p]) { if (tm[p] && closed[p]) { T.data.copy(img.data, p * 4, p * 4, p * 4 + 3); img.data[p * 4 + 3] = 255; holes++ } continue }
      const a = blur.data[p * 4 + 3]
      for (let ch = 0; ch < 3; ch++) img.data[p * 4 + ch] = a > 6 ? Math.min(255, Math.round(blur.data[p * 4 + ch] * 255 / a * 0.85)) : [46, 12, 10][ch]
      img.data[p * 4 + 3] = 255; holes++
    }
    layers.wingF = img
    notes.push(`翼_奥：立ち絵から切り出した（${comps[pick].n}px・背中のとげ ${toBody}px は体へ・隠れていた所 ${holes}px を埋めた）`)
  }
  // ③ 回す中心・口：翼・頭＝体（奥の翼は頭と体）と重なった所の真ん中／描いた場所のまま置くもの＝自分の真ん中
  const ov = (a, b) => centroidOf(a.map((v, p) => v & b[p]), S)
  const bodyC = centroidOf(bodyFull || body, S)
  const pivotOf = { body: bodyC }
  for (const part of PARTS) {
    if (part === 'body' || !layers[part]) continue
    const m = mk(part)
    pivotOf[part] = def.fixed?.[part] ? centroidOf(m, S)
      : part === 'wingN' ? ov(dilate(m, S, S, 1), body) || bodyC
      : part === 'wingF' ? ov(dilate(m, S, S, 6), layers.head ? mk('head').map((v, p) => v | body[p]) : body) || bodyC
      : ov(m, body) || bodyC
  }
  // 口＝頭のいちばん左（切り分ける前の形）。頭も切り分けて作るボス（雨摩座）は切り分けたあと
  let tip = layers.head ? leftTipOf(layers.head) : null
  // ⑤ 切り分け（def.cuts）：前脚・下あごを親のパーツから多角形で切り出す（回す中心は決まりの pivot）
  for (const [part, c] of Object.entries(def.cuts || {})) {
    const from = layers[c.from]
    if (!from) throw new Error(`${part}：親のパーツ ${c.from} が無い`)
    const img = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
    const over = c.over && layers[c.over]
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inPoly(c.take, x + 0.5, y + 0.5)) continue
      const i = (y * S + x) * 4
      from.data.copy(img.data, i, i, i + 4)
      // 手前に出すパーツ（over）に覆われていた所は切り出さない（止まっているときは立ち絵と同じに見える）
      if (over) img.data[i + 3] = Math.round(img.data[i + 3] * (1 - over.data[i + 3] / 255))
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inPoly(c.drop || c.take, x + 0.5, y + 0.5)) from.data[(y * S + x) * 4 + 3] = 0
    layers[part] = img
    pivotOf[part] = c.pivot
    notes.push(`${part}：${def.base === 'stand' && c.from === 'body' ? '立ち絵' : FILES[c.from] || c.from}から切り分けた`)
  }
  tip ||= leftTipOf(layers.head || layers.body)
  // 立ち絵が体のとき：切り分けで空いた所を ChatGPT の体で埋める（止まっているときは切り分けたパーツが覆う・動くと見える）
  if (fill) {
    let n = 0
    for (let p = 0; p < S * S; p++) {
      // 腕の構えで切り替える所（zone）は3つの絵が埋めるので、埋めない
      if (zone?.[p] || layers.body.data[p * 4 + 3] >= T.data[p * 4 + 3] || fill.data[p * 4 + 3] < SEEN) continue
      fill.data.copy(layers.body.data, p * 4, p * 4, p * 4 + 4)
      n++
    }
    notes.push(`体：切り分けで空いた所 ${n}px を${def.fill}で埋めた`)
  }
  // 後ろの絵（split.back）：切り分けで空いた所のうち、翼に入れなかった所（胸・肩・首の付け根）を体に埋める（体のまま動かない）
  if (back) {
    let n = 0
    for (let p = 0; p < S * S; p++) {
      if (!back.zone[p] || back.wing[p] || layers.body.data[p * 4 + 3] >= T.data[p * 4 + 3] || back.img.data[p * 4 + 3] < SEEN) continue
      back.img.data.copy(layers.body.data, p * 4, p * 4, p * 4 + 4)
      n++
    }
    notes.push(`体：切り分けで空いた所 ${n}px を${def.split.back.file}で埋めた`)
  }
  // 親：切り分けたパーツは元のパーツの子。adopt なら逆（首が頭の親）
  const parent = {}
  for (const [p, c] of Object.entries(def.cuts || {})) {
    if (c.adopt) { if (parent[c.from]) parent[p] = parent[c.from]; parent[c.from] = p } else parent[p] = c.from
  }
  Object.assign(pivotOf, def.pivots || {})
  const parts = {}
  for (const part of PARTS) {
    if (!layers[part]) continue
    const t = trim(layers[part])
    if (!t) throw new Error(`${part}：何も描かれていない`)
    // 大きくて柔らかい絵（雨摩座の水の帯）は細かさを落として軽くする（shrink・画面では同じ大きさに引きのばす）
    const f = def.shrink?.[part]
    const img = f ? resizeRgba(t.img, Math.round(t.img.W * f), Math.round(t.img.H * f)) : t.img
    sizes.push([part, writeWebp(img, path.join(OUT, bossFileOf(key, illustKindOf(part))), def.quality || QUALITY)])
    const [px, py] = pivotOf[part]
    // 長さの向き（回す中心からパーツの真ん中へ・°）：翼を縮める向き。枠の上へはみ出す絵（tops）は上のぶんを引く
    const top = tops[part] || 0
    const c = centroidOf(maskOf(layers[part]), S)
    const ax = Math.round(Math.atan2(c[1] - top - py, c[0] - px) * 180 / Math.PI)
    parts[part] = { x: t.x, y: t.y - top, w: t.img.W, h: t.img.H, px: Math.round(px), py: Math.round(py), ax, ...(parent[part] ? { parent: parent[part] } : {}) }
  }
  // ⑧ 曲げるパーツ（def.bend）：from〜to° を step° ごとに曲げた絵を、ぜんぶが入る同じ枠で切り抜いて scale 倍にし、横に並べた1枚にする
  for (const [part, b] of Object.entries(def.bend || {})) {
    if (!layers[part] || !parts[part]) continue
    const degs = []
    for (let a = b.from; a <= b.to + 1e-9; a += b.step) degs.push(+a.toFixed(3))
    const frames = degs.map(a => bendWarp(layers[part], S, b, a))
    let x0 = S, y0 = S, x1 = -1, y1 = -1
    for (const fr of frames) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (fr.data[(y * S + x) * 4 + 3] > 2) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, fw = Math.round(w * b.scale), fh = Math.round(h * b.scale)
    const sheet = { W: fw * frames.length, H: fh, data: Buffer.alloc(fw * frames.length * fh * 4) }
    frames.forEach((fr, n) => {
      const crop = { W: w, H: h, data: Buffer.alloc(w * h * 4) }
      for (let y = 0; y < h; y++) fr.data.copy(crop.data, y * w * 4, ((y0 + y) * S + x0) * 4, ((y0 + y) * S + x1 + 1) * 4)
      const sm = resizeRgba(crop, fw, fh)
      for (let y = 0; y < fh; y++) sm.data.copy(sheet.data, (y * sheet.W + n * fw) * 4, y * fw * 4, (y + 1) * fw * 4)
    })
    sizes.push([`${part}-bend`, writeWebp(sheet, path.join(OUT, bossFileOf(key, illustBendKindOf(part))), def.quality || QUALITY)])
    parts[part].bend = { n: frames.length, from: b.from, step: b.step, x: x0, y: y0, w, h }
    notes.push(`${part}：${b.from}〜${b.to}° を ${b.step}° ごとに曲げた絵 ${frames.length} 枚（${fw}×${fh}px）`)
  }
  // ⑨ 技のポーズの絵（def.poses）
  const poses = {}
  for (const [mk, names] of Object.entries(def.poses || {})) for (const [name, file] of Object.entries(names)) {
    const f = path.join(dir, `${file}.png`)
    if (!existsSync(f)) { notes.push(`${file}：まだ無い（${mk} は部品の動きのまま）`); continue }
    const P = readRgba(f)
    bleed(P)
    const fit = fixedFitOf(T0, P, def.poseFit?.[file] || {})
    const t = trim(warpPart(P, fit, S, S, k))
    if (!t) throw new Error(`${file}：何も描かれていない`)
    sizes.push([file, writeWebp(t.img, path.join(OUT, bossFileOf(key, illustPoseKindOf(mk, name))), def.quality || QUALITY)])
    poses[mk] = { ...poses[mk], [name]: { x: t.x, y: t.y, w: t.img.W, h: t.img.H } }
  }
  // ④ エフェクト
  const fx = {}, trims = {}
  for (const e of def.effects) {
    const f = path.join(dir, `${e.file}.png`)
    if (!existsSync(f)) { notes.push(`${e.file}：まだ無い`); continue }
    const img = readRgba(f)
    bleed(img)
    if (e.crop) {
      // 流れる水の絵（kind 'flow'）：同じ絵の当たる絵（先に作る）の上の、crop の所の場所（at＝当たる絵の px の x・y・w・h）も書く
      const hit = trims[e.file]
      if (!hit) throw new Error(`${e.file}：流れる水の絵は、同じ絵の当たる絵のあとに並べる`)
      const [x0, y0, x1, y1] = e.crop
      // blurY＝縦だけぼかす強さ（落ちる水のぶれ＝輪の形が筋になり、くり返しが目立たない）
      const src = e.blurY ? blurYRgba(img, e.blurY) : img
      const tex = seamlessY(cropRgba(src, x0, y0, x1 - x0, y1 - y0), Math.round((y1 - y0) * (e.band ?? 0.3)))
      const k2 = Math.min(1, (e.side || 320) / tex.W)
      const small = k2 < 1 ? resizeRgba(tex, Math.round(tex.W * k2), Math.round(tex.H * k2)) : tex
      sizes.push([`${e.file}（流れ）`, writeWebp(small, path.join(OUT, bossFileOf(key, illustFxKindOf(e.motion, e.kind))), FX_QUALITY)])
      const at = [(x0 - hit.x) * hit.k, (y0 - hit.y) * hit.k, (x1 - x0) * hit.k, (y1 - y0) * hit.k].map(v => Math.round(v))
      fx[e.motion] = { ...fx[e.motion], [e.kind]: { w: small.W, h: small.H, ax: 0, ay: 0, at } }
      continue
    }
    const t = trim(img)
    const kk = Math.min(1, FX_SIDE / Math.max(t.img.W, t.img.H))
    const small = kk < 1 ? resizeRgba(t.img, Math.round(t.img.W * kk), Math.round(t.img.H * kk)) : t.img
    trims[e.file] = { x: t.x, y: t.y, k: small.W / t.img.W }
    sizes.push([e.file, writeWebp(small, path.join(OUT, bossFileOf(key, illustFxKindOf(e.motion, e.kind))), FX_QUALITY)])
    const a = e.kind === 'fly' ? leftTipOf(small) : { x: Math.round(small.W / 2), y: Math.round(small.H / 2) }
    fx[e.motion] = { ...fx[e.motion], [e.kind]: { w: small.W, h: small.H, ax: a.x, ay: a.y } }
  }
  return { entry: { parts, pivot: pivotOf.body.map(Math.round), mouth: [tip.x, tip.y], fx, ...(Object.keys(poses).length ? { poses } : {}), fit: fits }, notes, sizes }
}

const writeList = (all) => {
  const lines = ['// tools/v2cap-boss-illust.mjs が書くファイル（手で直さない）。ボス → イラスト版のパーツ・エフェクト',
    `//   parts … 立ち絵（${BOSS_ILLUST_SIZE}px）の上の位置（x・y・w・h）・回す中心（px・py）・長さの向き（ax°）・親（parent）・曲げた絵（bend＝枚数 n・from°・step°・枠 x・y・w・h）。並びはボスごとの layers（無ければ ILLUST_PARTS）`,
    '//   pivot … 全体を回す中心（体の真ん中）／mouth … 頭のいちばん左（飛ぶエフェクトが出る口）',
    '//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクトの大きさ（px）と合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）・flow（流れる水の絵・at＝当たる絵の上の場所）',
    '//   poses … 技 → ため（windup）・振り抜き（strike）の全身の絵の位置（立ち絵の px）',
    '//   fit … パーツを立ち絵に重ねた倍率・角度・位置（元の絵の px・確かめ用）／v … 絵ごとの中身の印（画面のアドレスの ?v=）',
    'export const BOSS_ILLUST = {']
  for (const [key, e] of Object.entries(all)) {
    const kinds = [...illustPartsOf(key).filter(p => e.parts[p]).map(illustKindOf), ...illustPartsOf(key).filter(p => e.parts[p]?.bend).map(illustBendKindOf),
      ...Object.entries(e.poses || {}).flatMap(([mk, ps]) => Object.keys(ps).map(n => illustPoseKindOf(mk, n))),
      ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => illustFxKindOf(mk, kind)))]
    const v = kinds.map(kd => [kd, path.join(OUT, bossFileOf(key, kd))]).filter(([, f]) => existsSync(f)).map(([kd, f]) => `'${kd}': '${versionOf(f)}'`)
    lines.push(`  ${key}: {`, '    parts: {')
    for (const p of illustPartsOf(key)) if (e.parts[p]) {
      const a = e.parts[p]
      const bd = a.bend ? `, bend: { n: ${a.bend.n}, from: ${a.bend.from}, step: ${a.bend.step}, x: ${a.bend.x}, y: ${a.bend.y}, w: ${a.bend.w}, h: ${a.bend.h} }` : ''
      lines.push(`      ${p}: { x: ${a.x}, y: ${a.y}, w: ${a.w}, h: ${a.h}, px: ${a.px}, py: ${a.py}, ax: ${a.ax ?? 0}${a.parent ? `, parent: '${a.parent}'` : ''}${bd} },`)
    }
    lines.push('    },', `    pivot: [${e.pivot.join(', ')}], mouth: [${e.mouth.join(', ')}],`, '    fx: {')
    for (const [mk, f] of Object.entries(e.fx || {})) {
      lines.push(`      ${mk}: { ${Object.entries(f).map(([kind, a]) => `${kind}: { w: ${a.w}, h: ${a.h}, ax: ${a.ax}, ay: ${a.ay}${a.at ? `, at: [${a.at.join(', ')}]` : ''} }`).join(', ')} },`)
    }
    if (e.poses) {
      lines.push('    },', '    poses: {')
      for (const [mk, ps] of Object.entries(e.poses)) lines.push(`      ${mk}: { ${Object.entries(ps).map(([n, a]) => `${n}: { x: ${a.x}, y: ${a.y}, w: ${a.w}, h: ${a.h} }`).join(', ')} },`)
    }
    lines.push('    },', '    fit: {')
    for (const [p, f] of Object.entries(e.fit || {})) lines.push(`      ${p}: { s: ${f.s}, deg: ${f.deg}, tx: ${f.tx}, ty: ${f.ty}, score: ${f.score} },`)
    lines.push('    },', `    v: { ${v.join(', ')} },`, '  },')
  }
  lines.push('}', '')
  writeFileSync(LIST, lines.join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const all = JSON.parse(JSON.stringify(BOSS_ILLUST))
  let made = 0
  for (const [key, def] of Object.entries(BOSS_ILLUST_DEFS)) {
    const name = BOSS_DEFS[key]?.name || key
    const dir = path.join(SRC, BOSS_DEFS[key].dir, BOSS_ILLUST_SRC)
    if (!existsSync(dir)) { console.log(`  - ${name}：イラスト版のフォルダが無い（${path.relative(ROOT, dir)}）`); continue }
    const known = new Set(['立ち絵', ...Object.values(illustFilesOf(key)), ...(def.fill ? [def.fill] : []), ...(def.split ? [def.split.by, ...(def.split.back ? [def.split.back.file] : [])] : []), ...(def.spare || []), ...def.effects.map(e => e.file), ...Object.values(def.poses || {}).flatMap(n => Object.values(n)),
      ...Object.values(def.swaps || {}).map(s => s.file).filter(Boolean)])
    const files = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    for (const f of files) if (!f.startsWith('見本') && !known.has(path.basename(f, path.extname(f)))) console.log(`  ? ${name}：使わない絵（名前が決まりと違う）：${f}`)
    const srcs = files.filter(f => !f.startsWith('見本')).map(f => statSync(path.join(dir, f)).mtimeMs)
    const outs = [...illustPartsOf(key).map(p => path.join(OUT, bossFileOf(key, illustKindOf(p)))), ...Object.keys(def.bend || {}).map(p => path.join(OUT, bossFileOf(key, illustBendKindOf(p))))]
    const fresh = !FORCE && all[key] && outs.every(o => existsSync(o) && statSync(o).mtimeMs >= Math.max(...srcs))
    if (fresh) continue
    try {
      const t0 = Date.now()
      const r = build(key, def, dir)
      all[key] = r.entry
      made++
      console.log(`  ✓ ${name}：${r.sizes.map(([kd, s]) => `${kd} ${Math.round(s / 1024)}KB`).join('・')}（${((Date.now() - t0) / 1000).toFixed(0)}秒）`)
      for (const t of r.notes) console.log(`    ${t}`)
    } catch (e) {
      console.log(`  ✗ ${name}：${e.message}`)
      process.exitCode = 1
    }
  }
  writeList(all)
  console.log(`作った ${made} → src/v2cap/lib/bossIllustList.js`)
}
