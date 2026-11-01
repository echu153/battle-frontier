// ============================================================
// v2cap の案内役ナハトの絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2ナビ/<名前>.png（ChatGPT で描いた PNG・1024×1024）
//   名前は src/v2cap/lib/navi.js の NAVI_FACES の src（普通・得意・怒り・しょんぼり）
// 作るもの：public/v2cap-art/navi/<キー>.webp（NAVI_FACE_SIZE の正方形）
// ★4枚を同じ箱で切る＝表情を変えても精霊の大きさと位置が動かない
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★透明にならなかった絵は、背景が一色なら抜く（tools/v2cap-art-lib.mjs の keyBackground）。チェック模様は止める（「背景だけ直す」で直してもらう）
//   node tools/v2cap-navi-art.mjs                         … public/V2ナビ → public/v2cap-art/navi
//   node tools/v2cap-navi-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, keyBackground, bgModelOf, transparentBorderRatio } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { NAVI_FACES, NAVI_ART_DIR, NAVI_FACE_SIZE } = await import(new URL('../src/v2cap/lib/navi.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2ナビ'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', NAVI_ART_DIR.replace(/^\//, '')))
const QUALITY = 86
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」
const EDGE_LEFT_MAX = 0.2  // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」（精霊は縁に届かない）
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）

const srcOf = (names) => names.map(n => path.join(SRC, `${n}.png`)).find(existsSync) || null
const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 緑の背景を抜いたあと、線のふちに残った緑を消す（精霊の絵に緑はないので、緑が赤と青より強い画素だけ下げる）
const removeGreen = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) data[p * 4 + 1] = Math.min(data[p * 4 + 1], Math.max(data[p * 4], data[p * 4 + 2])) }
const isGreen = (bg) => bg[1] > bg[0] + 80 && bg[1] > bg[2] + 80
const load = (file) => {
  const { w, h } = probe(file)
  const side = Math.max(w, h)
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

mkdirSync(OUT, { recursive: true })
const missing = [], failed = [], faces = []
for (const f of NAVI_FACES) {
  const file = srcOf(f.src)
  if (!file) { missing.push(`${f.label}（${f.src.join('・')}.png）`); continue }
  try { faces.push({ f, ...load(file) }) } catch (e) { failed.push(e.message) }
}
if (faces.length) {
  // 4枚を合わせた箱を正方形に広げて切る
  const boxes = faces.map(x => alphaBox(x.img)).filter(Boolean)
  const b = boxes.reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }))
  const side = Math.max(b.x1 - b.x0, b.y1 - b.y0)
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const box = { x0: Math.round(cx - side / 2), y0: Math.round(cy - side / 2), x1: Math.round(cx + side / 2), y1: Math.round(cy + side / 2) }
  for (const { f, img, mode } of faces) {
    const size = encodeRect(img, box, path.join(OUT, `${f.key}.webp`), { height: NAVI_FACE_SIZE.h, margin: 0.02, quality: QUALITY })
    console.log(`✔ ${f.label} → ${f.key}.webp（${size.w}×${size.h}・${mode}）`)
    if (size.w !== NAVI_FACE_SIZE.w) console.log(`⚠ navi.js の NAVI_FACE_SIZE.w を ${size.w} にする（いまは ${NAVI_FACE_SIZE.w}）`)
  }
}
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
