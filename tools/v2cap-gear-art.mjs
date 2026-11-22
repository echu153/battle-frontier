// ============================================================
// v2cap の装備の絵：16個を1枚（4×4）に並べたシートを切り分けて、画面で使う軽い版（透明つきの正方形の WebP）にする
// （決まり・シートの並び・頼み方は src/v2cap/lib/gearArt.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2装備/<シートの名前>.png（例 U01.png・L-armor01.png）
//   ChatGPT で描いた正方形の PNG・背景は真マゼンタの一色（透明つきでもよい）
// 作るもの：public/v2cap-art/gear/<絵の名前>.webp（GEAR_ART_SIZE の正方形）・src/v2cap/lib/gearArtList.js（中身の印）
// 使い方：
//   node tools/v2cap-gear-art.mjs                 … 置いてあるシートを切り分ける（新しくなったシートだけ）
//   node tools/v2cap-gear-art.mjs --force         … 全部やり直す
//   node tools/v2cap-gear-art.mjs --list          … シートの一覧と進み具合
//   node tools/v2cap-gear-art.mjs --prompt U01    … そのシートの頼み方（ChatGPT に貼る文）
//   --public <元の絵の public>・--out <書き出す場所>（道具を試すとき＝ゲームのファイルを変えない）
// ★マスは画像を4×4に等分する。マスの中の絵がちょうど収まる正方形に切り直すので、マスの中で少しずれていてもよい
// ★止める場合（そのシートは1つも書かない）：背景が抜けない・絵の無いマスがある・となりのマスへはみ出している（マスの境目に絵がある）
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ============================================================
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe, decode, bleed, alphaBox, encodeSquare, keyBackground, transparentBorderRatio, versionOf } from './v2cap-art-lib.mjs'
import { GEAR_ART } from '../src/v2cap/lib/gearArtList.js'
import {
  GEAR_SHEETS, GEAR_SHEET_BY_ID, GEAR_ART_DIR, GEAR_ART_SIZE, GEAR_SHEET_SOURCE, SHEET_COLS,
  gearArtKeyOf, gearArtFileOf, gearSheetFileOf, gearSheetPromptOf, gearArtProgress,
} from '../src/v2cap/lib/gearArt.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.join(path.resolve(argOf('--public') || path.join(ROOT, 'public')), GEAR_SHEET_SOURCE)
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', GEAR_ART_DIR.slice(1)))
const LIST = argOf('--out') ? path.join(OUT, 'gearArtList.js') : path.join(ROOT, 'src', 'v2cap', 'lib', 'gearArtList.js')
const FORCE = process.argv.includes('--force')
const QUALITY = 90
const MAX_SIDE = 2048
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」
const EDGE_LEFT_MAX = 0.05 // 背景を抜いたあと、縁に残った絵の割合がこれを超えたら「背景が抜けていない」（装備は縁まで届かない）
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（ChatGPT の透明つきの絵は 253 くらい）
const SEAM_MAX = 0.04      // マスの境目の線のうち、絵がのっている割合がこれを超えたら「はみ出している」
const CELL_MIN = 0.02      // マスの中の絵がマスの面積のこれ未満なら「絵が無い」

if (process.argv.includes('--prompt')) {
  const sheet = GEAR_SHEET_BY_ID[argOf('--prompt')]
  if (!sheet) { console.log(`シート ${argOf('--prompt')} は無い（--list で一覧）`); process.exit(1) }
  console.log(gearSheetPromptOf(sheet))
  process.exit(0)
}
if (process.argv.includes('--list')) {
  for (const s of GEAR_SHEETS) {
    const done = s.items.filter(i => GEAR_ART[gearArtKeyOf(i)]).length
    console.log(`${done === s.items.length ? '✔' : done ? '△' : '・'} ${s.id.padEnd(10)} ${s.label}（${done}/${s.items.length}）${existsSync(path.join(SRC, gearSheetFileOf(s))) ? '' : ' 元の絵なし'}`)
  }
  const p = gearArtProgress(GEAR_ART)
  console.log(`絵が入った装備 ${p.done} / ${p.total}`)
  process.exit(0)
}

const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 背景を抜いたあと、線のふちに残ったマゼンタを消す（赤と青がそろって緑より強い画素の、赤と青を下げる）
const removeMagenta = ({ data, W, H }) => {
  for (let p = 0; p < W * H; p++) {
    const a = data[p * 4 + 3]
    if (a === 0 || a === 255) continue   // 半透明のふちだけ
    const g = data[p * 4 + 1], m = Math.min(data[p * 4], data[p * 4 + 2])
    if (m > g) { const cut = m - g; data[p * 4] -= cut; data[p * 4 + 2] -= cut }
  }
}
const load = (file) => {
  const { w, h } = probe(file)
  if (Math.abs(w - h) > Math.max(w, h) * 0.02) throw new Error(`正方形でない（${w}×${h}）`)
  const side = Math.min(MAX_SIDE, Math.max(w, h))
  const rgba = decode(file, side, 'rgba')
  let img = rgba, mode = '透明つき'
  if (transparentBorderRatio(rgba) < ALPHA_MIN) {
    const r = keyBackground(decode(file, side, 'rgb24'))
    if (r.edgeLeft > EDGE_LEFT_MAX) throw new Error(`背景が抜けていない（縁の${Math.round(r.edgeLeft * 100)}%が絵のまま）`)
    img = r.img
    removeMagenta(img)
    mode = '背景を抜いた'
  }
  snapAlpha(img)
  return { img, mode }
}
// マス（r 段・c 列）を切り出した画素
const cellOf = ({ data, W, H }, r, c) => {
  const x0 = Math.round(c * W / SHEET_COLS), x1 = Math.round((c + 1) * W / SHEET_COLS)
  const y0 = Math.round(r * H / SHEET_COLS), y1 = Math.round((r + 1) * H / SHEET_COLS)
  const w = x1 - x0, h = y1 - y0
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) data.copy(out, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4)
  return { data: out, W: w, H: h }
}
// マスの境目（内側の縦横3本ずつ）に絵がのっている割合
const seamRatio = ({ data, W, H }) => {
  let on = 0, n = 0
  for (let k = 1; k < SHEET_COLS; k++) {
    const x = Math.round(k * W / SHEET_COLS), y = Math.round(k * H / SHEET_COLS)
    for (let i = 0; i < H; i++) { n++; if (data[(i * W + x) * 4 + 3] > 128) on++ }
    for (let i = 0; i < W; i++) { n++; if (data[(y * W + i) * 4 + 3] > 128) on++ }
  }
  return on / n
}
const solidCount = ({ data, W, H }) => { let n = 0; for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] > 128) n++; return n }

const all = JSON.parse(JSON.stringify(GEAR_ART))
const failed = []
let wrote = 0
for (const sheet of GEAR_SHEETS) {
  const src = path.join(SRC, gearSheetFileOf(sheet))
  if (!existsSync(src)) continue
  const outs = sheet.items.map(item => path.join(OUT, gearArtFileOf(item)))
  const fresh = outs.every((o, i) => existsSync(o) && statSync(o).mtimeMs >= statSync(src).mtimeMs && all[gearArtKeyOf(sheet.items[i])])
  if (!FORCE && fresh) continue
  try {
    const { img, mode } = load(src)
    const seam = seamRatio(img)
    if (seam > SEAM_MAX) throw new Error(`となりのマスへはみ出している（マスの境目の${Math.round(seam * 100)}%に絵がある）＝4×4に等分されていないか、絵が大きすぎる`)
    // 先に全部のマスを確かめる（1つでもだめならこのシートは書かない）
    const cells = sheet.items.map((item, i) => {
      const cell = cellOf(img, Math.floor(i / SHEET_COLS), i % SHEET_COLS)
      const box = alphaBox(cell)
      if (!box || solidCount(cell) < cell.W * cell.H * CELL_MIN) throw new Error(`${i + 1}番のマス（${item.name}）に絵が無い`)
      return { item, cell, box }
    })
    mkdirSync(OUT, { recursive: true })
    cells.forEach(({ item, cell, box }, i) => {
      bleed(cell)
      encodeSquare(cell, box, outs[i], { size: GEAR_ART_SIZE, margin: 0.04, quality: QUALITY })
      all[gearArtKeyOf(item)] = { v: versionOf(outs[i]) }
      wrote++
    })
    console.log(`✔ ${gearSheetFileOf(sheet)}（${sheet.label}・${mode}）→ ${cells.length}個`)
  } catch (e) { failed.push(`${gearSheetFileOf(sheet)}：${e.message}`) }
}
const body = Object.entries(all).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `  '${k}': { v: '${v.v}' },\n`).join('')
writeFileSync(LIST, `// tools/v2cap-gear-art.mjs が書くファイル（手で直さない）。絵の名前 → 中身の印（v＝画面のアドレスの ?v=）\nexport const GEAR_ART = {\n${body}}\n`)
const p = gearArtProgress(all)
console.log(`書いた絵 ${wrote}個・絵が入った装備 ${p.done} / ${p.total}`)
if (failed.length) { console.log(`✖ ${failed.join('\n✖ ')}`); process.exitCode = 1 }
