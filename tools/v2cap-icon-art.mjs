// ============================================================
// v2cap のメニューと画面の題のアイコンの絵を、画面で使う軽い版（透明つきの正方形の WebP）にする（決まりは src/v2cap/lib/menuIcon.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2アイコン/<source>（ChatGPT で描いた 1024×1024 の PNG）
// 作るもの：public/v2cap-art/icon/<key>.webp（MENU_ICON_SIZE の正方形）・src/v2cap/lib/menuIconList.js（中身の印）
// ★透明つきでなければ、背景が一色（真緑など）かチェック模様なら抜く（tools/v2cap-art-lib.mjs の keyBackground）。抜けなければ止める
// ★透明なところに元の背景の色が隠れているので、縮める前に近くの色で埋める（bleed）＝縁ににじまない
// ★ChatGPT の透明つきの絵は不透明さが 253 くらい（ほんの少し透ける）＝ ALPHA_SNAP 以上は 255 にそろえる（神官の絵と同じ）
// 使い方：node tools/v2cap-icon-art.mjs [--force] [--src <元の絵のフォルダ>] [--out <書き出す場所>]
//   worktree では元の絵が本体のフォルダにあるので --src で渡す（例 --src ../../../public/V2アイコン）
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ============================================================
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe, decode, bleed, alphaBox, encodeSquare, keyBackground, bgModelOf, transparentBorderRatio, versionOf } from './v2cap-art-lib.mjs'
import { MENU_ICON } from '../src/v2cap/lib/menuIconList.js'
import { MENU_ICON_DEFS, MENU_ICON_DIR, MENU_ICON_SRC_DIR, MENU_ICON_SIZE, menuIconFileOf } from '../src/v2cap/lib/menuIcon.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', MENU_ICON_SRC_DIR))
// --out … 道具を試すとき（絵も一覧もそこへ書く＝ゲームのファイルを変えない）
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', MENU_ICON_DIR.slice(1)))
const LIST = argOf('--out') ? path.join(OUT, 'menuIconList.js') : path.join(ROOT, 'src', 'v2cap', 'lib', 'menuIconList.js')
const FORCE = process.argv.includes('--force')
const QUALITY = 90
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」
const EDGE_LEFT_MAX = 0.2  // 背景を抜いたあと、縁に残った絵の割合がこれを超えたら「背景が抜けていない」（アイコンは縁まで届かない）
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる

const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 緑の背景を抜いたあと、線のふちに残った緑を消す（緑が赤と青より強い画素だけ下げる＝緑を使わないアイコンだけ）
const removeGreen = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) data[p * 4 + 1] = Math.min(data[p * 4 + 1], Math.max(data[p * 4], data[p * 4 + 2])) }
const isGreen = (bg) => !!bg && bg[1] > bg[0] + 80 && bg[1] > bg[2] + 80
const load = (file) => {
  const { w, h } = probe(file)
  const side = Math.max(w, h)
  const rgba = decode(file, side, 'rgba')
  let img = rgba, mode = '透明つき'
  if (transparentBorderRatio(rgba) < ALPHA_MIN) {
    const rgb = decode(file, side, 'rgb24')
    const model = bgModelOf(rgb)
    const r = keyBackground(rgb)
    if (r.edgeLeft > EDGE_LEFT_MAX) throw new Error(`${path.basename(file)}：背景が抜けていない（縁の${Math.round(r.edgeLeft * 100)}%が絵のまま）`)
    img = r.img
    if (isGreen(model.bg)) removeGreen(img)
    mode = model.mode === 'checker' ? 'チェック模様の背景を抜いた' : `一色の背景（RGB ${model.bg.join(',')}）を抜いた`
  }
  snapAlpha(img)
  bleed(img)
  return { img, mode }
}

const all = JSON.parse(JSON.stringify(MENU_ICON))
const failed = []
for (const [key, def] of Object.entries(MENU_ICON_DEFS)) {
  const src = path.join(SRC, def.source), out = path.join(OUT, menuIconFileOf(key))
  if (!existsSync(src)) { console.log(`  - ${def.source} が無い（${key} は絵文字 ${def.fallback} のまま）`); continue }
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && all[key]) continue
  try {
    mkdirSync(OUT, { recursive: true })
    const { img, mode } = load(src)
    const box = alphaBox(img)
    if (!box) throw new Error(`${def.source}：絵が全部透明`)
    encodeSquare(img, box, out, { size: MENU_ICON_SIZE, margin: 0.02, quality: QUALITY })
    all[key] = { v: versionOf(out) }
    console.log(`✔ ${def.source} → ${menuIconFileOf(key)}（${MENU_ICON_SIZE}×${MENU_ICON_SIZE}・${mode}・切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
  } catch (e) { failed.push(e.message) }
}
const body = Object.entries(all).map(([k, v]) => `  ${k}: { v: '${v.v}' },\n`).join('')
writeFileSync(LIST, `// tools/v2cap-icon-art.mjs が書くファイル（手で直さない）。アイコン → 中身の印（v＝画面のアドレスの ?v=）\nexport const MENU_ICON = {\n${body}}\n`)
if (failed.length) { console.log(`✖ ${failed.join('\n✖ ')}`); process.exitCode = 1 }
