// ============================================================
// v2cap のクラスのモーション（ChatGPT で作った「横一列に6コマ・真緑の背景」の1枚）を、画面で使う形にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2newjob/攻撃モーション/<クラス名><男|女><動き>.png（.webp・.jpg も可）
//   例：暗殺者女攻撃.png。動きは 攻撃・技・被弾・倒れる（src/v2cap/lib/motionArt.js の MOTION_KEYS）
// 作るもの：
//   public/V2newjob/motion/<ローマ字>-<m|f>-<キー>.webp … ②〜⑤のコマを横に並べた1枚（透明つき・劣化なし）
//   src/v2cap/lib/motionArtList.js                       … 一覧（コマの数・1コマの大きさ・ずらし・速さ）
// 手順：
//   ① 真緑を抜く（緑が赤・青より大きく上回る色）。縁に映り込んだ緑も消す
//   ② コマに分ける：ひとつながりの絵（まとまり）を拾い、大きい6つを体として、ほかのまとまり（武器の先・効果の光）は
//      いちばん近い体のコマへまるごと入れる＝列で切らないので、隣のコマの上まで伸びた槍の先も切れない（2026-10-27）。
//      体が6つに分かれていない（武器が隣の体に触れている）ときだけ、前のやり方＝何も無い列・6等分の境目のまわりで切る
//   ③ ①のコマ（立ちポーズ）の高さを、待機GIF（public/V2newjob/gif/<ローマ字>-<m|f>.gif の1コマ目）の体の高さに合わせる。
//      差が8%以内なら縮めない（ドット絵をぼかさない）
//   ④ 各コマの足（いちばん下の8%の重心）を、待機GIFの足と同じ点に置く。はみ出すぶん（斬撃など）は1コマを広げる（ox・oy）
//   ⑤ ②〜⑤（最初と最後を除く）を並べて書き出す。①⑥は待機GIFと少し違う絵なので使わない
// 使い方：
//   node tools/v2cap-motion.mjs          … 元の絵が新しくなったものだけ作り直す
//   node tools/v2cap-motion.mjs --force  … 全部作り直す
// ★ffmpeg（libwebp）を使う。クラス名は classArt.js の ART_BASE（GIF と同じ読み替え GIF_CLASS_ALIAS も効く）
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe, bleed } from './v2cap-art-lib.mjs'
import { ART_BASE, ART_GENDERS, GIF_CLASS_ALIAS, GIF_OUT } from '../src/v2cap/lib/classArt.js'
import { MOTION_SRC_DIR, MOTION_OUT, MOTION_KEYS, SHEET_FRAMES, IDLE_SIZE, motionMsOf, motionHitOf, motionFileOf } from '../src/v2cap/lib/motionArt.js'
import { MOTION_ART } from '../src/v2cap/lib/motionArtList.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const PUB = path.join(ROOT, 'public', 'V2newjob')
const SRC = path.join(PUB, MOTION_SRC_DIR)
const OUT = path.join(PUB, MOTION_OUT)
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'motionArtList.js')
const FORCE = process.argv.includes('--force')

// 1コマ目だけ・透明つきで読む
const readRgba = (file) => {
  const { w, h } = probe(file)
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  return { W: w, H: h, data: Buffer.from(data.subarray(0, w * h * 4)) }
}
const scaleRgba = (img, k) => {
  const W = Math.max(1, Math.round(img.W * k)), H = Math.max(1, Math.round(img.H * k))
  const data = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.W}x${img.H}`, '-i', '-',
    '-vf', `scale=${W}:${H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: img.data, maxBuffer: 1 << 28 })
  // 縮めて半透明になった縁は、はっきりさせる（ドット絵なので）
  for (let p = 0; p < W * H; p++) data[p * 4 + 3] = data[p * 4 + 3] >= 128 ? 255 : 0
  return { W, H, data: Buffer.from(data) }
}

// ① 真緑を抜く
export const keyGreen = (img) => {
  const { W, H, data } = img
  for (let p = 0; p < W * H; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2]
    const spill = g - Math.max(r, b)
    if (g > 140 && spill > 70) data[i + 3] = 0
    else if (spill > 20) data[i + 1] = Math.max(r, b)
  }
  return img
}

// ② まとまり（8方向でつながった、見えている画素）に分ける → { labels, comps:[{ n, x0, x1, y0, y1 }] }
export const componentsOf = ({ W, H, data }) => {
  const labels = new Int32Array(W * H).fill(-1)
  const comps = []
  const st = []
  for (let p = 0; p < W * H; p++) {
    if (!data[p * 4 + 3] || labels[p] >= 0) continue
    const id = comps.length
    const c = { n: 0, x0: W, x1: -1, y0: H, y1: -1 }
    labels[p] = id; st.push(p)
    while (st.length) {
      const q = st.pop()
      const x = q % W, y = (q / W) | 0
      c.n++
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const r = yy * W + xx
        if (data[r * 4 + 3] && labels[r] < 0) { labels[r] = id; st.push(r) }
      }
    }
    comps.push(c)
  }
  return { labels, comps }
}

// ② コマに分ける（まとまりで）。体（大きい n 個）が見つからなければ null（＝列で切るやり方へ）
//   ほかのまとまり（体とつながっていない矢・玉・瓶・光）は、**足もとがそれより左にある、いちばん近い体**のもの
//     ＝攻撃はいつも右へ飛ぶので、浮いているものは撃った側（左）の体から出たもの
//     （2026-10-27 弓使い・呪術師・薬師で、④で放った矢・玉・瓶が⑤の体のすぐそばまで飛んでいて、距離で決めると⑤に入っていた）
//     どの体の足もとより左にあるものは、いちばん左の体のもの
export const framesByComponents = (img, n = SHEET_FRAMES) => {
  const { W, H, data } = img
  const { labels, comps } = componentsOf(img)
  const total = comps.reduce((s, c) => s + c.n, 0)
  const big = comps.map((c, id) => ({ ...c, id })).filter(c => c.n >= total * 0.02).sort((a, b) => b.n - a.n)
  if (big.length < n) return null
  const bodies = big.slice(0, n).map(b => {
    let sx = 0, cnt = 0
    for (let y = Math.round(b.y1 - (b.y1 - b.y0) * 0.08); y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      if (labels[y * W + x] === b.id) { sx += x; cnt++ }
    }
    return { ...b, footX: cnt ? sx / cnt : (b.x0 + b.x1) / 2 }
  }).sort((a, b) => a.footX - b.footX)
  const owner = comps.map((c, id) => {
    const self = bodies.findIndex(b => b.id === id)
    if (self >= 0) return self
    const cx = (c.x0 + c.x1) / 2
    let best = 0
    bodies.forEach((b, k) => { if (b.footX <= cx) best = k })
    return best
  })
  return bodies.map((b, k) => {
    const mine = comps.filter((_, id) => owner[id] === k)
    const x0 = Math.min(...mine.map(c => c.x0)), x1 = Math.max(...mine.map(c => c.x1))
    const cw = x1 - x0 + 1
    const crop = Buffer.alloc(cw * H * 4)
    for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x
      if (labels[p] < 0 || owner[labels[p]] !== k) continue
      data.copy(crop, ((y * cw) + (x - x0)) * 4, p * 4, p * 4 + 4)
    }
    return { W: cw, H, data: crop, x0 }
  })
}

// ② コマに分ける（列で・まとまりで分けられないとき）→ [[x0, x1], …]
export const splitFrames = (img, n = SHEET_FRAMES) => {
  const { W, H, data } = img
  const col = new Array(W).fill(0)
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3]) col[x]++
  const segs = []
  let s = -1
  for (let x = 0; x <= W; x++) {
    const on = x < W && col[x] > 2
    if (on && s < 0) s = x
    if (!on && s >= 0) { segs.push([s, x - 1]); s = -1 }
  }
  const merged = []
  for (const g of segs) { const l = merged.at(-1); if (l && g[0] - l[1] < 6) l[1] = g[1]; else merged.push([...g]) }
  if (merged.length === n) return { cuts: merged, joined: false }
  const bounds = [0]
  for (let i = 1; i < n; i++) {
    const c = Math.round(i * W / n), r = Math.round(W / n * 0.12)
    let best = c
    for (let x = c - r; x <= c + r; x++) if (col[x] < col[best]) best = x
    bounds.push(best)
  }
  bounds.push(W - 1)
  const cuts = bounds.slice(0, -1).map((b, i) => {
    let a0 = b, a1 = bounds[i + 1]
    while (a0 < a1 && col[a0] === 0) a0++
    while (a1 > a0 && col[a1] === 0) a1--
    return [a0, a1]
  })
  return { cuts, joined: true }
}

// コマを切り出す（端に引っかかった隣のかけらを消す）
const cropFrame = (img, [x0, x1]) => {
  const { W, H, data } = img
  const cw = x1 - x0 + 1
  const crop = Buffer.alloc(cw * H * 4)
  for (let y = 0; y < H; y++) data.copy(crop, y * cw * 4, (y * W + x0) * 4, (y * W + x1 + 1) * 4)
  const seen = new Int32Array(cw * H).fill(-1)
  const comps = []
  for (let p = 0; p < cw * H; p++) {
    if (!crop[p * 4 + 3] || seen[p] >= 0) continue
    const id = comps.length, st = [p], px = []
    seen[p] = id
    let edge = false
    while (st.length) {
      const q = st.pop(); px.push(q)
      const x = q % cw, y = (q / cw) | 0
      if (x === 0 || x === cw - 1) edge = true
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= cw || yy >= H) continue
        const r = yy * cw + xx
        if (crop[r * 4 + 3] && seen[r] < 0) { seen[r] = id; st.push(r) }
      }
    }
    comps.push({ px, edge })
  }
  const total = comps.reduce((s, c) => s + c.px.length, 0)
  for (const c of comps) if (c.edge && c.px.length < total * 0.05) for (const q of c.px) crop[q * 4 + 3] = 0
  return { W: cw, H, data: crop, x0 }
}

// 体の上下と足の位置（いちばん下の8%の重心）
export const bodyOf = ({ W, H, data }) => {
  let top = H, bot = -1, left = W, right = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 8) {
    if (y < top) top = y; if (y > bot) bot = y; if (x < left) left = x; if (x > right) right = x
  }
  if (bot < 0) return null
  let sx = 0, n = 0
  for (let y = Math.round(bot - (bot - top) * 0.08); y <= bot; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 8) { sx += x; n++ }
  return { top, bot, left, right, footX: n ? sx / n : (left + right) / 2 }
}

// ファイル名 → { cls, g, key }
const ART_GENDER_OF_KANJI = Object.fromEntries(ART_GENDERS.map(g => [g.kanji, g.key]))
export const motionTargetOf = (file) => {
  const m = path.basename(file).match(/^(.+?)(男|女)(攻撃|技|被弾|倒れる)\.(png|webp|jpe?g)$/i)
  if (!m) return null
  const cls = GIF_CLASS_ALIAS[m[1]] || m[1]
  if (!ART_BASE[cls]) return null
  return { cls, g: ART_GENDER_OF_KANJI[m[2]], key: MOTION_KEYS[m[3]] }
}

const build = (file, { cls, g, key }) => {
  const idleFile = path.join(PUB, GIF_OUT, `${ART_BASE[cls]}-${g}.gif`)
  if (!existsSync(idleFile)) throw new Error(`待機GIFが無い：${path.relative(ROOT, idleFile)}`)
  const idle = bodyOf(readRgba(idleFile))
  let sheet = keyGreen(readRgba(file))
  const splitOf = (img) => {
    const byComp = framesByComponents(img)
    if (byComp) return { frames: byComp, how: 'まとまり' }
    const { cuts, joined } = splitFrames(img)
    return { frames: cuts.map(c => cropFrame(img, c)), how: joined ? '境目で切った' : '列' }
  }
  let { frames, how } = splitOf(sheet)
  const first = bodyOf(frames[0])
  // ③ 大きさ：①（立ちポーズ）の高さを待機の体の高さへ。8%以内なら縮めない
  let k = (idle.bot - idle.top + 1) / (first.bot - first.top + 1)
  if (Math.abs(k - 1) <= 0.08) k = 1
  else {
    bleed(sheet)
    sheet = scaleRgba(sheet, k)
    ;({ frames, how } = splitOf(sheet))
  }
  const used = frames.length >= 3 ? frames.slice(1, -1) : frames
  // ④ 足をそろえる。はみ出すぶんは1コマを広げる
  const placed = used.map(f => {
    const b = bodyOf(f)
    return { f, b, dx: Math.round(idle.footX - b.footX), dy: Math.round(idle.bot - b.bot) }
  })
  const minX = Math.min(0, ...placed.map(p => p.b.left + p.dx))
  const maxX = Math.max(IDLE_SIZE - 1, ...placed.map(p => p.b.right + p.dx))
  const minY = Math.min(0, ...placed.map(p => p.b.top + p.dy))
  const ox = -minX, oy = -minY
  const w = (maxX - minX + 1) + ((maxX - minX + 1) % 2), h = IDLE_SIZE + oy
  // ⑤ 並べて書き出す
  const n = placed.length
  const strip = Buffer.alloc(w * n * h * 4)
  placed.forEach(({ f, dx, dy }, i) => {
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const s = (y * f.W + x) * 4
      if (!f.data[s + 3]) continue
      const X = x + dx + ox, Y = y + dy + oy
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue
      f.data.copy(strip, ((Y * w * n) + i * w + X) * 4, s, s + 4)
    }
  })
  mkdirSync(OUT, { recursive: true })
  const out = path.join(OUT, motionFileOf(cls, g, key))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w * n}x${h}`, '-i', '-',
    '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', out], { input: strip })
  return { out, entry: { frames: n, w, h, ox, oy, ms: motionMsOf(n), hit: motionHitOf(n) }, k, how }
}

const writeList = (art) => {
  const lines = ['// tools/v2cap-motion.mjs が書くファイル（手で直さない）。クラス → 男女 → 動き → コマの数・1コマの大きさ・ずらし・速さ',
    '//   frames … コマの数／w・h … 1コマの大きさ（px）／ox・oy … 待機GIF（224×224）の左上が1コマの中のどこにあるか',
    '//   ms … 1コマの長さ（ミリ秒）／hit … ダメージが入るコマ（0から）',
    'export const MOTION_ART = {']
  for (const cls of Object.keys(ART_BASE)) {
    if (!art[cls]) continue
    lines.push(`  '${cls}': {`)
    for (const g of ['m', 'f']) {
      if (!art[cls][g]) continue
      const ks = Object.entries(art[cls][g]).map(([k, e]) =>
        `${k}: { frames: ${e.frames}, w: ${e.w}, h: ${e.h}, ox: ${e.ox}, oy: ${e.oy}, ms: [${e.ms.join(', ')}], hit: ${e.hit} }`)
      lines.push(`    ${g}: { ${ks.join(', ')} },`)
    }
    lines.push('  },')
  }
  lines.push('}', '')
  writeFileSync(LIST, lines.join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (!existsSync(SRC)) { console.log(`元の絵の場所がありません：${path.relative(ROOT, SRC)}`); process.exit(0) }
  const art = JSON.parse(JSON.stringify(MOTION_ART))
  let made = 0, skipped = 0
  for (const name of readdirSync(SRC).sort()) {
    const file = path.join(SRC, name)
    const t = motionTargetOf(file)
    if (!t) { console.log(`  ? 名前が読めない（<クラス名><男|女><攻撃|技|被弾|倒れる>.png）：${name}`); continue }
    const out = path.join(OUT, motionFileOf(t.cls, t.g, t.key))
    if (!FORCE && art[t.cls]?.[t.g]?.[t.key] && existsSync(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) { skipped++; continue }
    try {
      const r = build(file, t)
      ;((art[t.cls] ||= {})[t.g] ||= {})[t.key] = r.entry
      made++
      console.log(`  ✓ ${name} → ${path.relative(ROOT, r.out)}（${r.entry.frames}コマ・1コマ${r.entry.w}×${r.entry.h}・倍率${r.k.toFixed(2)}${r.how === '境目で切った' ? '・⚠体どうしがつながっていたので境目で切った（隣の絵が入っていないか見る）' : ''}）`)
    } catch (e) {
      console.log(`  ✗ ${name}：${e.message}`)
    }
  }
  writeList(art)
  console.log(`作った ${made}・そのまま ${skipped} → src/v2cap/lib/motionArtList.js`)
}
