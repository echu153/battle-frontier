// ============================================================
// v2cap のダンジョンのボスの絵（ChatGPT で作った「3列×2段に6コマ・真緑の背景」と遭遇のイラスト）を、画面で使う形にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/（決まりは src/v2cap/lib/bossArt.js の BOSS_DEFS）
//   待機.png・<技の名前>.png・イラスト.png
// 作るもの：
//   public/v2cap-art/boss/<key>-idle.webp   … 待機の6コマをくり返す動くWebP（base×base）
//   public/v2cap-art/boss/<key>-<技>.webp    … ②〜⑤のコマを横に並べた1枚（透明つき）
//   public/v2cap-art/boss/<key>-illust.webp … 遭遇のイラスト（768×768）
//   src/v2cap/lib/bossArtList.js           … 一覧（コマの数・1コマの大きさ・ずらし・速さ）
// 手順：
//   ① 真緑を抜く（tools/v2cap-motion.mjs の keyGreen）
//   ② ひとつながりの絵（まとまり）を拾い、まとまりの真ん中があるマス（512×512）のコマに入れる
//      ＝隣のマスまで伸びた体や炎も切れない。マスの左上からの位置のまま使う（羽ばたきの上下の揺れも残る）
//   ③ 待機の6コマがぜんぶ収まる正方形を「待機の枠」にする。技のコマは、待機の枠とそのコマがぜんぶ収まる大きさにして、
//      待機の枠がどこにあるか（ox・oy）を一覧に書く
//   ④ 半分に縮める（K）。クラスの攻撃の絵とドットの細かさがそろう
// 使い方：
//   node tools/v2cap-boss-art.mjs          … 元の絵が新しくなったボスだけ作り直す
//   node tools/v2cap-boss-art.mjs --force  … 全部作り直す
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, bleed, alphaBox, encodeSquare } from './v2cap-art-lib.mjs'
import { keyGreen, componentsOf, readRgba, scaleRgba } from './v2cap-motion.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, BOSS_SHEET_COLS, BOSS_SHEET_ROWS, BOSS_ILLUST_SIZE, BOSS_HIT_FRAME, bossFileOf } from '../src/v2cap/lib/bossArt.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { BOSS_ART } from '../src/v2cap/lib/bossArtList.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossArtList.js')
const FORCE = process.argv.includes('--force')
const K = 0.5              // 縮める倍率（元の絵の1マス512px → 256px）
const PAD = 4              // 待機の枠のまわりの余白（元の絵のpx）
const QUALITY = 90         // 劣化ありで書き出す。ChatGPT のドット絵は色がざらついていて、劣化なしだと1枚250〜320KBと重い（劣化ありは約3分の1・2026-10-28 見比べて差が見えなかった）

// ② マスごとのコマ → [{ comps:[ids], box:{x0,y0,x1,y1}（マスの左上から） }]（6つ・左上から右へ、下の段へ）
export const cellsOf = (img, cols = BOSS_SHEET_COLS, rows = BOSS_SHEET_ROWS) => {
  const { labels, comps } = componentsOf(img)
  const cw = img.W / cols, ch = img.H / rows
  const cells = Array.from({ length: cols * rows }, (_, k) => ({ k, ox: (k % cols) * cw, oy: Math.floor(k / cols) * ch, ids: new Set(), box: null }))
  comps.forEach((c, id) => {
    const col = Math.min(cols - 1, Math.floor((c.x0 + c.x1) / 2 / cw)), row = Math.min(rows - 1, Math.floor((c.y0 + c.y1) / 2 / ch))
    const cell = cells[row * cols + col]
    cell.ids.add(id)
    const b = { x0: c.x0 - cell.ox, y0: c.y0 - cell.oy, x1: c.x1 - cell.ox, y1: c.y1 - cell.oy }
    cell.box = cell.box ? { x0: Math.min(cell.box.x0, b.x0), y0: Math.min(cell.box.y0, b.y0), x1: Math.max(cell.box.x1, b.x1), y1: Math.max(cell.box.y1, b.y1) } : b
  })
  return { labels, cells }
}

// 範囲を広げる・偶数にそろえる（半分に縮めたとき、待機の枠の位置がちょうど整数になる）
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
const even = (b) => {
  const x0 = Math.floor(b.x0 / 2) * 2, y0 = Math.floor(b.y0 / 2) * 2
  const x1 = x0 + Math.ceil((b.x1 - x0 + 1) / 2) * 2 - 1, y1 = y0 + Math.ceil((b.y1 - y0 + 1) / 2) * 2 - 1
  return { x0, y0, x1, y1 }
}

// 1コマを、マスの左上からの範囲 box で切り出す（そのコマのまとまりだけ）
const frameOf = (img, labels, cell, box) => {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = Math.round(cell.ox) + box.x0 + x, Y = Math.round(cell.oy) + box.y0 + y
    if (X < 0 || Y < 0 || X >= img.W || Y >= img.H) continue
    const p = Y * img.W + X
    if (labels[p] < 0 || !cell.ids.has(labels[p])) continue
    img.data.copy(data, (y * w + x) * 4, p * 4, p * 4 + 4)
  }
  const f = { W: w, H: h, data }
  bleed(f)
  return scaleRgba(f, K)
}

// noGreen … 緑を使わないボス（黒龍）。真緑の背景が映り込んで緑がかった煙・風（黒翼烈風・終焉の黒焔）を、緑の無い色にする
//   【確定】2026-10-28 終焉の黒焔⑤の煙を測った：緑がかった色は色相55〜106°・明るさ70〜140（炎の黄色は明るさ200より上）
//   ＝色相52〜170°で暗いものは灰色（少し暖かい）に、明るいものは黄色に寄せる
export const dropGreen = (img) => {
  const d = img.data
  for (let p = 0; p < img.W * img.H; p++) {
    const i = p * 4
    if (!d[i + 3]) continue
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn < 8) continue
    let h = mx === r ? 60 * (((g - b) / (mx - mn)) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4)
    if (h < 0) h += 360
    if (h >= 52 && h <= 170) {
      if (mx < 170) { const L = 0.3 * r + 0.59 * g + 0.11 * b; d[i] = Math.round(L); d[i + 1] = Math.round(L * 0.94); d[i + 2] = Math.round(L * 0.88) }
      else d[i + 1] = Math.min(g, r)
    } else d[i + 1] = Math.min(g, Math.max(r, b))
  }
  return img
}
const sheetOf = (file, { noGreen = false } = {}) => {
  const img = keyGreen(readRgba(file))
  if (noGreen) dropGreen(img)
  return { img, ...cellsOf(img) }
}

const writeWebp = (args, out, input) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-pix_fmt', 'yuva420p', '-quality', String(QUALITY), '-compression_level', '6', out], { input })
  return statSync(out).size
}

const build = (key, def, dir) => {
  const need = (name) => {
    const f = path.join(dir, `${name}.png`)
    if (!existsSync(f)) throw new Error(`元の絵が無い：${path.relative(ROOT, f)}`)
    return f
  }
  mkdirSync(OUT, { recursive: true })
  const sizes = []
  // 待機
  const idle = sheetOf(need('待機'), def)
  if (idle.cells.some(c => !c.box)) throw new Error('待機の6コマのどれかが空（3列×2段になっていない）')
  const ib = idle.cells.reduce((b, c) => union(b, c.box), idle.cells[0].box)
  const side = Math.max(ib.x1 - ib.x0, ib.y1 - ib.y0) + 1 + PAD * 2
  const cx = (ib.x0 + ib.x1 + 1) / 2
  const base = even({ x0: Math.round(cx - side / 2), y0: ib.y1 + PAD + 1 - side, x1: Math.round(cx - side / 2) + side - 1, y1: ib.y1 + PAD })
  const frames = idle.cells.map(c => frameOf(idle.img, idle.labels, c, base))
  const B = frames[0].W
  const idleOut = path.join(OUT, bossFileOf(key, 'idle'))
  sizes.push(['idle', writeWebp(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${B}x${frames[0].H}`, '-framerate', `1000/${def.idleMs}`, '-i', '-',
    '-c:v', 'libwebp_anim', '-loop', '0'], idleOut, Buffer.concat(frames.map(f => f.data)))])
  const entry = { base: B, idle: { frames: frames.length, ms: def.idleMs }, illust: false, motions: {} }
  // 技
  for (const m of def.motions) {
    const sh = sheetOf(need(m.file), def)
    const used = sh.cells.slice(1, -1)
    if (used.some(c => !c.box)) throw new Error(`${m.file}：②〜⑤のどれかが空`)
    const box = even(used.reduce((b, c) => union(b, c.box), base))
    const fs = used.map(c => frameOf(sh.img, sh.labels, c, box))
    const w = fs[0].W, h = fs[0].H, n = fs.length
    const strip = Buffer.alloc(w * n * h * 4)
    fs.forEach((f, i) => { for (let y = 0; y < h; y++) f.data.copy(strip, (y * w * n + i * w) * 4, y * w * 4, (y + 1) * w * 4) })
    const out = path.join(OUT, bossFileOf(key, m.key))
    sizes.push([m.key, writeWebp(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w * n}x${h}`, '-i', '-', '-c:v', 'libwebp'], out, strip)])
    entry.motions[m.key] = { frames: n, w, h, ox: (base.x0 - box.x0) * K, oy: (base.y0 - box.y0) * K, ms: m.ms, hit: BOSS_HIT_FRAME }
  }
  // 遭遇のイラスト（透明な背景のまま・体がちょうど収まる正方形）
  const illustFile = path.join(dir, 'イラスト.png')
  if (existsSync(illustFile)) {
    const img = decode(illustFile, 1600, 'rgba')
    bleed(img)
    const box = alphaBox(img)
    if (box) {
      const out = path.join(OUT, bossFileOf(key, 'illust'))
      encodeSquare(img, box, out, { size: BOSS_ILLUST_SIZE, margin: 0.02, quality: 84 })
      entry.illust = true
      sizes.push(['illust', statSync(out).size])
    }
  }
  return { entry, sizes }
}

const writeList = (art) => {
  const lines = ['// tools/v2cap-boss-art.mjs が書くファイル（手で直さない）。ボス → 待機の枠・待機・技ごとのコマ',
    '//   base … 待機の枠の大きさ（正方形・px）／idle … 待機のコマの数と1コマの長さ（ミリ秒）／illust … 遭遇のイラストがあるか',
    '//   motions … 技のキー → コマの数・1コマの大きさ（w・h）・待機の枠の左上が1コマの中のどこにあるか（ox・oy）・1コマの長さ・当たるコマ（0から）',
    'export const BOSS_ART = {']
  for (const [key, e] of Object.entries(art)) {
    lines.push(`  ${key}: {`, `    base: ${e.base}, illust: ${e.illust},`, `    idle: { frames: ${e.idle.frames}, ms: ${e.idle.ms} },`, '    motions: {')
    for (const [k, m] of Object.entries(e.motions)) {
      lines.push(`      ${k}: { frames: ${m.frames}, w: ${m.w}, h: ${m.h}, ox: ${m.ox}, oy: ${m.oy}, ms: [${m.ms.join(', ')}], hit: ${m.hit} },`)
    }
    lines.push('    },', '  },')
  }
  lines.push('}', '')
  writeFileSync(LIST, lines.join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const art = JSON.parse(JSON.stringify(BOSS_ART))
  let made = 0
  for (const [key, def] of Object.entries(BOSS_DEFS)) {
    const dir = path.join(SRC, def.dir)
    if (!existsSync(dir)) { console.log(`  - ${def.name}：元の絵のフォルダが無い（${path.relative(ROOT, dir)}）`); continue }
    const known = new Set(['待機', 'イラスト', ...def.motions.map(m => m.file)])
    for (const f of readdirSync(dir)) if (!known.has(path.basename(f, path.extname(f)))) console.log(`  ? ${def.name}：使わない絵（名前が決まりと違う）：${f}`)
    const srcs = readdirSync(dir).map(f => statSync(path.join(dir, f)).mtimeMs)
    const outs = ['idle', ...def.motions.map(m => m.key)].map(k => path.join(OUT, bossFileOf(key, k)))
    const fresh = !FORCE && art[key] && outs.every(o => existsSync(o) && statSync(o).mtimeMs >= Math.max(...srcs))
    if (fresh) continue
    try {
      const r = build(key, def, dir)
      art[key] = r.entry
      made++
      console.log(`  ✓ ${def.name}：待機の枠 ${r.entry.base}px・${r.sizes.map(([k, s]) => `${k} ${Math.round(s / 1024)}KB`).join('・')}`)
    } catch (e) {
      console.log(`  ✗ ${def.name}：${e.message}`)
      process.exitCode = 1
    }
  }
  writeList(art)
  console.log(`作った ${made} → src/v2cap/lib/bossArtList.js`)
}
