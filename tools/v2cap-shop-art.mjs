// ============================================================
// v2cap の商店の商人ソルドの絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2商店/<名前>.png（ChatGPT で描いた PNG・1024×1536）
//   名前は src/v2cap/lib/merchant.js の MERCHANT_FACES の src（どれか1つあればよい）
// 作るもの：public/v2cap-art/shop/<キー>.webp
//   ・表情（腰から上・普通・にんまり・薄目の3枚）… 全部の見えている範囲を合わせた1つの箱で切る＝どの表情も同じ大きさ・同じ位置
//     （ゲームで表情を切り替えても体が動かない）。高さは merchant.js の MERCHANT_FACE_SIZE.h
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★ChatGPT の透明つきの絵は、体の不透明さが 253 くらい（255 ではない）＝ほんの少し透ける。ALPHA_SNAP 以上は 255 にそろえる（親方の絵と同じ）
// ★透明にならなかった絵は、縁の色から背景を見立てて抜く（tools/v2cap-art-lib.mjs の keyBackground）。頼んでいるのは真緑の背景。
//   白っぽい背景とチェック模様は、腰から上の絵の下の縁に届く前かけまで抜けることがあるので、抜いたうえで知らせる（絵を見て確かめる）。
//   抜いたあとも縁に体が多く残っていたら知らせて、終わりのコードを1にする
//   node tools/v2cap-shop-art.mjs                         … public/V2商店 → public/v2cap-art/shop
//   node tools/v2cap-shop-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, keyBackground, bgModelOf, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { MERCHANT_FACES, MERCHANT_ART_DIR, MERCHANT_FACE_SIZE } = await import(new URL('../src/v2cap/lib/merchant.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2商店'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', MERCHANT_ART_DIR.replace(/^\//, '')))
const QUALITY = 82
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」（腰から上は下の縁が体で切れるので全部は透明にならない）
const EDGE_LEFT_MAX = 0.45 // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」（下の縁＝体は縁の約2割）
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）
const WHITE_MIN = 200      // 背景の RGB がどれもこれ以上なら白っぽい＝前かけまで抜けることがある

const srcOf = (names) => names.map(n => path.join(SRC, `${n}.png`)).find(existsSync) || null
const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 緑の背景を抜いたあと、線のふちに残った緑を消す。★青緑のコートの色が変わらないように、半分透けているふちの画素だけ（神官の道具と違うところ）
const removeGreenEdge = ({ data, W, H }) => {
  for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] < 255) data[p * 4 + 1] = Math.min(data[p * 4 + 1], Math.max(data[p * 4], data[p * 4 + 2]))
}
const isGreen = (bg) => bg[1] > bg[0] + 80 && bg[1] > bg[2] + 80
const warned = []
const load = (file) => {
  const { w, h } = probe(file)
  const side = Math.max(w, h)
  const rgba = decode(file, side, 'rgba')
  let img = rgba, mode = '透明つき'
  if (transparentBorderRatio(rgba) < ALPHA_MIN) {
    const rgb = decode(file, side, 'rgb24')
    const model = bgModelOf(rgb)
    const r = keyBackground(rgb)
    if (r.edgeLeft > EDGE_LEFT_MAX) throw new Error(`${path.basename(file)}：背景が抜けていない（縁の${Math.round(r.edgeLeft * 100)}%が体のまま）`)
    img = r.img
    if (model.mode === 'checker') { mode = 'チェック模様の背景を抜いた'; warned.push(`${path.basename(file)}：チェック模様の背景＝前かけまで抜けていないか絵を見る`) }
    else if (model.bg.every(v => v >= WHITE_MIN)) { mode = '白っぽい背景を抜いた'; warned.push(`${path.basename(file)}：白っぽい背景＝前かけまで抜けていないか絵を見る`) }
    else {
      mode = `一色の背景（RGB ${model.bg.join(',')}）を抜いた`
      if (isGreen(model.bg)) removeGreenEdge(img)
    }
  }
  snapAlpha(img)
  bleed(img)
  return { img, mode }
}

mkdirSync(OUT, { recursive: true })
const missing = [], failed = [], done = []

// ===== 表情：同じ箱で切る =====
const faces = []
for (const f of MERCHANT_FACES) {
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
      size = encodeRect(img, box, path.join(OUT, `${f.key}.webp`), { height: MERCHANT_FACE_SIZE.h, margin: 0.01, quality: QUALITY })
      const border = borderOf(img.W, img.H)
      const edge = border.filter(p => img.data[p * 4 + 3] > 128).length / border.length
      done.push(`${f.label} → ${f.key}.webp（${mode}・縁の体 ${Math.round(edge * 100)}%）`)
    }
    console.log(`表情 ${faces.length}枚：${size.w}×${size.h}（切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
    if (size.w !== MERCHANT_FACE_SIZE.w) console.log(`⚠ merchant.js の MERCHANT_FACE_SIZE.w を ${size.w} にする（いまは ${MERCHANT_FACE_SIZE.w}）`)
  }
}

for (const d of done) console.log(`✔ ${d}`)
for (const w of warned) console.log(`⚠ ${w}`)
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
