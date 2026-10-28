// ============================================================
// v2cap のダンジョンのボスのイラスト版（立ち絵＋パーツ・塗りのエフェクト）を、画面で使う形にする（決まりは src/v2cap/lib/bossIllust.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/イラスト版/
//   立ち絵.png・体.png・頭.png・翼_手前.png（・翼_奥.png）・<技の名前>_飛ぶ.png・<技の名前>_当たる.png（どれも透明な背景）
// 作るもの：
//   public/v2cap-art/boss/<key>-il-<wingF|wingN|body|head>.webp … 立ち絵（640px）に重ねた位置で切り抜いたパーツ
//   public/v2cap-art/boss/<key>-il-fx-<技>-<fly|hit>.webp       … エフェクト（長いほうの辺 FX_SIDE まで縮める）
//   src/v2cap/lib/bossIllustList.js                             … 一覧（パーツの位置・回す中心・口・エフェクトの大きさ・中身の印）
// 手順：
//   ① パーツを立ち絵に重ねる：ChatGPT はパーツを立ち絵と同じ大きさ・場所に描かない（2026-10-28 頭は約半分・体は0.92倍・翼は0.77倍だった）
//      ＝形（立ち絵からはみ出さない）と明るさ（溶岩の筋・目）で、倍率・角度・位置を探す（1/8 → 1/4 → 1/2 の細かさで3回）。
//      よさ＝重なった画素がどれだけ似ているか×面積（小さく縮めて逃げない）−はみ出し
//   ② 翼_奥.png が無ければ、立ち絵からほかのパーツ（少し太らせた形）を除いた残りのうち、左上のいちばん大きいまとまりを奥の翼にする。
//      頭の後ろに隠れていた穴（翼の形を閉じた所と頭の重なり）はまわりの色で埋める（頭を動かしても黒い穴が見えない）
//   ③ 回す中心：翼・頭＝体（頭は体、奥の翼は頭と体）と重なった所の真ん中／全体＝体の真ん中。口＝頭のいちばん左
//   ④ 640px の立ち絵の大きさで、パーツを重ねた位置に描いて切り抜く（WebP・透明つき）
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
import { BOSS_ILLUST_DEFS, BOSS_ILLUST_SRC, BOSS_ILLUST_SIZE, ILLUST_PARTS, ILLUST_PART_FILES, illustKindOf, illustFxKindOf } from '../src/v2cap/lib/bossIllust.js'
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
  const layers = {}, fits = {}
  // ① 体・頭・翼_手前（・翼_奥）
  for (const part of ILLUST_PARTS) {
    const f = path.join(dir, `${ILLUST_PART_FILES[part]}.png`)
    if (!existsSync(f)) { if (part === 'wingF') continue; throw new Error(`元の絵が無い：${path.relative(ROOT, f)}`) }
    const P = readRgba(f)
    bleed(P)
    const fit = fitPart(T0, P)
    fits[part] = fit
    layers[part] = warpPart(P, fit, S, S, k)
    notes.push(`${ILLUST_PART_FILES[part]}：倍率${fit.s.toFixed(3)}・角度${fit.deg}°・位置 ${fit.tx},${fit.ty}（よさ ${fit.score}）`)
  }
  // ② 奥の翼を立ち絵から切り出す
  const T = resizeRgba(T0, S, S)
  const mk = (part) => maskOf(layers[part])
  const body = mk('body'), head = mk('head'), wingN = mk('wingN')
  if (!layers.wingF) {
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
    // 頭の後ろの穴：翼の形を閉じた所（太らせて細らせる）と頭（少し太らせる）の重なり
    const closed = erode(dilate(wf, S, S, 14), S, S, 14)
    const headD = dilate(head, S, S, 2)
    const img = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
    for (let p = 0; p < S * S; p++) if (wf[p]) T.data.copy(img.data, p * 4, p * 4, p * 4 + 4)
    bleed(img, 40)
    let holes = 0
    for (let p = 0; p < S * S; p++) if (!wf[p] && closed[p] && headD[p]) { img.data[p * 4 + 3] = 255; holes++ }
    layers.wingF = img
    notes.push(`翼_奥：立ち絵から切り出した（${comps[pick].n}px・頭の後ろの穴 ${holes}px を埋めた）`)
  }
  // ③ 回す中心・口
  const wfm = mk('wingF')
  const ov = (a, b) => centroidOf(a.map((v, p) => v & b[p]), S)
  const bodyC = centroidOf(body, S)
  const pivotOf = {
    wingN: ov(dilate(wingN, S, S, 1), body) || bodyC,
    head: ov(head, body) || bodyC,
    wingF: ov(dilate(wfm, S, S, 6), head.map((v, p) => v | body[p])) || bodyC,
    body: bodyC,
  }
  const parts = {}
  for (const part of ILLUST_PARTS) {
    const t = trim(layers[part])
    if (!t) throw new Error(`${part}：何も描かれていない`)
    sizes.push([part, writeWebp(t.img, path.join(OUT, bossFileOf(key, illustKindOf(part))))])
    const [px, py] = pivotOf[part]
    parts[part] = { x: t.x, y: t.y, w: t.img.W, h: t.img.H, px: Math.round(px), py: Math.round(py) }
  }
  const tip = leftTipOf(layers.head)
  // ④ エフェクト
  const fx = {}
  for (const e of def.effects) {
    const f = path.join(dir, `${e.file}.png`)
    if (!existsSync(f)) { notes.push(`${e.file}：まだ無い`); continue }
    const img = readRgba(f)
    bleed(img)
    const t = trim(img)
    const kk = Math.min(1, FX_SIDE / Math.max(t.img.W, t.img.H))
    const small = kk < 1 ? resizeRgba(t.img, Math.round(t.img.W * kk), Math.round(t.img.H * kk)) : t.img
    sizes.push([e.file, writeWebp(small, path.join(OUT, bossFileOf(key, illustFxKindOf(e.motion, e.kind))), FX_QUALITY)])
    const a = e.kind === 'fly' ? leftTipOf(small) : { x: Math.round(small.W / 2), y: Math.round(small.H / 2) }
    fx[e.motion] = { ...fx[e.motion], [e.kind]: { w: small.W, h: small.H, ax: a.x, ay: a.y } }
  }
  return { entry: { parts, pivot: pivotOf.body.map(Math.round), mouth: [tip.x, tip.y], fx, fit: fits }, notes, sizes }
}

const writeList = (all) => {
  const lines = ['// tools/v2cap-boss-illust.mjs が書くファイル（手で直さない）。ボス → イラスト版のパーツ・エフェクト',
    `//   parts … 立ち絵（${BOSS_ILLUST_SIZE}px）の上の位置（x・y・w・h）と回す中心（px・py）。重ねる順は奥の翼・手前の翼・体・頭`,
    '//   pivot … 全体を回す中心（体の真ん中）／mouth … 頭のいちばん左（飛ぶエフェクトが出る口）',
    '//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクトの大きさ（px）と合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）',
    '//   fit … パーツを立ち絵に重ねた倍率・角度・位置（元の絵の px・確かめ用）／v … 絵ごとの中身の印（画面のアドレスの ?v=）',
    'export const BOSS_ILLUST = {']
  for (const [key, e] of Object.entries(all)) {
    const kinds = [...ILLUST_PARTS.filter(p => e.parts[p]).map(illustKindOf),
      ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => illustFxKindOf(mk, kind)))]
    const v = kinds.map(kd => [kd, path.join(OUT, bossFileOf(key, kd))]).filter(([, f]) => existsSync(f)).map(([kd, f]) => `'${kd}': '${versionOf(f)}'`)
    lines.push(`  ${key}: {`, '    parts: {')
    for (const p of ILLUST_PARTS) if (e.parts[p]) { const a = e.parts[p]; lines.push(`      ${p}: { x: ${a.x}, y: ${a.y}, w: ${a.w}, h: ${a.h}, px: ${a.px}, py: ${a.py} },`) }
    lines.push('    },', `    pivot: [${e.pivot.join(', ')}], mouth: [${e.mouth.join(', ')}],`, '    fx: {')
    for (const [mk, f] of Object.entries(e.fx || {})) {
      lines.push(`      ${mk}: { ${Object.entries(f).map(([kind, a]) => `${kind}: { w: ${a.w}, h: ${a.h}, ax: ${a.ax}, ay: ${a.ay} }`).join(', ')} },`)
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
    const known = new Set(['立ち絵', ...Object.values(ILLUST_PART_FILES), ...def.effects.map(e => e.file)])
    const files = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    for (const f of files) if (!f.startsWith('見本') && !known.has(path.basename(f, path.extname(f)))) console.log(`  ? ${name}：使わない絵（名前が決まりと違う）：${f}`)
    const srcs = files.filter(f => !f.startsWith('見本')).map(f => statSync(path.join(dir, f)).mtimeMs)
    const outs = ILLUST_PARTS.map(p => path.join(OUT, bossFileOf(key, illustKindOf(p))))
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
