// ============================================================
// v2cap の博物館の鑑定士テオドール（片眼鏡のフクロウ）の絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2博物館/<名前>.png（ChatGPT で描いた PNG・1024×1536）
//   名前は src/v2cap/lib/appraiser.js の OWL_FACES の src（どれか1つあればよい）
// 作るもの：public/v2cap-art/museum/<キー>.webp
//   ・表情（床に座った全身・いまは普通の1枚だけ）… 見えている範囲（体と床に広がるローブ）で切る。高さは appraiser.js の OWL_FACE_SIZE.h。
//     表情を足したときは、全部の見えている範囲を合わせた1つの箱で切る＝どの表情も同じ大きさ・同じ位置（ゲームで切り替えても体が動かない）
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★ChatGPT の透明つきの絵は、体の不透明さが 253 くらい（255 ではない）＝ほんの少し透ける。ALPHA_SNAP 以上は 255 にそろえる（親方の絵と同じ）
// ★透明にならず真っ白（かチェック模様）の背景で届いたときは、縁の色から背景を見立てて抜く（tools/v2cap-art-lib.mjs の keyBackground）。
//   抜いたあとも縁に体が多く残っていたら知らせて、終わりのコードを1にする
//   node tools/v2cap-museum-art.mjs                         … public/V2博物館 → public/v2cap-art/museum
//   node tools/v2cap-museum-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, keyBackground, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { OWL_FACES, OWL_ART_DIR, OWL_FACE_SIZE } = await import(new URL('../src/v2cap/lib/appraiser.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2博物館'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', OWL_ART_DIR.replace(/^\//, '')))
const QUALITY = 82
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」（全身の絵は縁がほぼ全部透明になる）
const EDGE_LEFT_MAX = 0.45 // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）

const srcOf = (names) => names.map(n => path.join(SRC, `${n}.png`)).find(existsSync) || null
const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
const load = (file) => {
  const { w, h } = probe(file)
  const side = Math.max(w, h)
  const rgba = decode(file, side, 'rgba')
  let img = rgba, mode = '透明つき'
  if (transparentBorderRatio(rgba) < ALPHA_MIN) {
    const r = keyBackground(decode(file, side, 'rgb24'))
    if (r.edgeLeft > EDGE_LEFT_MAX) throw new Error(`${path.basename(file)}：背景が抜けていない（縁の${Math.round(r.edgeLeft * 100)}%が体のまま）`)
    img = r.img
    mode = r.mode === 'checker' ? 'チェック模様の背景を抜いた' : '一色の背景を抜いた'
  }
  snapAlpha(img)
  bleed(img)
  return { img, mode }
}

mkdirSync(OUT, { recursive: true })
const missing = [], failed = [], done = []

// ===== 表情：同じ箱で切る =====
const faces = []
for (const f of OWL_FACES) {
  const file = srcOf(f.src)
  if (!file) { missing.push(`${f.label}（${f.src.join('・')}.png）`); continue }
  try { faces.push({ f, file, ...load(file) }) } catch (e) { failed.push(e.message) }
}
if (faces.length) {
  const { W, H } = faces[0].img
  if (faces.some(x => x.img.W !== W || x.img.H !== H)) failed.push(`表情の絵の大きさがそろっていない（${faces.map(x => `${x.f.label} ${x.img.W}×${x.img.H}`).join('・')}）`)
  else {
    const boxes = faces.map(x => alphaBox(x.img)).filter(Boolean)
    const box = boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
    let size = null
    for (const { f, img, mode } of faces) {
      size = encodeRect(img, box, path.join(OUT, `${f.key}.webp`), { height: OWL_FACE_SIZE.h, margin: 0.01, quality: QUALITY })
      const border = borderOf(img.W, img.H)
      const edge = border.filter(p => img.data[p * 4 + 3] > 128).length / border.length
      done.push(`${f.label} → ${f.key}.webp（${mode}・縁の体 ${Math.round(edge * 100)}%）`)
    }
    console.log(`表情 ${faces.length}枚：${size.w}×${size.h}（切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
    if (size.w !== OWL_FACE_SIZE.w) console.log(`⚠ appraiser.js の OWL_FACE_SIZE.w を ${size.w} にする（いまは ${OWL_FACE_SIZE.w}）`)
  }
}

for (const d of done) console.log(`✔ ${d}`)
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
