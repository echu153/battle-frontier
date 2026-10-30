// ============================================================
// v2cap の神殿の神官の絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2神殿/<名前>.png（ChatGPT で描いた PNG・1024×1536）
//   名前は src/v2cap/lib/priest.js の PRIEST_FACES の src（どれか1つあればよい）
// 作るもの：public/v2cap-art/temple/<キー>.webp
//   ・腰から上の1枚 … 見えている範囲で切る。高さは priest.js の PRIEST_FACE_SIZE.h
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★ChatGPT の透明つきの絵は、体の不透明さが 253 くらい（255 ではない）＝ほんの少し透ける。ALPHA_SNAP 以上は 255 にそろえる（親方の絵と同じ）
// ★透明にならなかった絵は、背景が真緑などの色のついた一色なら抜く（tools/v2cap-art-lib.mjs の keyBackground）。
//   ほかの人物と違い、白っぽい背景とチェック模様は抜かずに止める：腰から上の絵は白い法衣が絵の下の縁に届くので、
//   縁からつながる白を背景と見て、法衣の中まで抜けてしまう（プロンプトのページの「背景だけ直す」で直してもらう）
//   node tools/v2cap-temple-art.mjs                         … public/V2神殿 → public/v2cap-art/temple
//   node tools/v2cap-temple-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, keyBackground, bgModelOf, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { PRIEST_FACES, PRIEST_ART_DIR, PRIEST_FACE_SIZE } = await import(new URL('../src/v2cap/lib/priest.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2神殿'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', PRIEST_ART_DIR.replace(/^\//, '')))
const QUALITY = 82
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」（腰から上の絵は、下の縁のほかはほぼ全部透明になる）
const EDGE_LEFT_MAX = 0.45 // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）
const WHITE_MIN = 200      // 背景の RGB がどれもこれ以上なら白っぽい＝法衣まで抜けるので止める

const srcOf = (names) => names.map(n => path.join(SRC, `${n}.png`)).find(existsSync) || null
const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// 緑の背景を抜いたあと、線のふちに残った緑を消す（神官の絵に緑はないので、緑が赤と青より強い画素だけ下げる）
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
    if (model.mode === 'checker') throw new Error(`${path.basename(file)}：背景がチェック模様（白い法衣まで抜けるので「背景だけ直す」で描き直してもらう）`)
    if (model.bg.every(v => v >= WHITE_MIN)) throw new Error(`${path.basename(file)}：背景が白っぽい（RGB ${model.bg.join(',')}・白い法衣まで抜けるので「背景だけ直す」で描き直してもらう）`)
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
const missing = [], failed = [], done = []

// ===== 絵：見えている範囲で切る =====
const faces = []
for (const f of PRIEST_FACES) {
  const file = srcOf(f.src)
  if (!file) { missing.push(`${f.label}（${f.src.join('・')}.png）`); continue }
  try { faces.push({ f, file, ...load(file) }) } catch (e) { failed.push(e.message) }
}
if (faces.length) {
  const boxes = faces.map(x => alphaBox(x.img)).filter(Boolean)
  const box = boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
  let size = null
  for (const { f, img, mode } of faces) {
    size = encodeRect(img, box, path.join(OUT, `${f.key}.webp`), { height: PRIEST_FACE_SIZE.h, margin: 0.01, quality: QUALITY })
    const border = borderOf(img.W, img.H)
    const edge = border.filter(p => img.data[p * 4 + 3] > 128).length / border.length
    done.push(`${f.label} → ${f.key}.webp（${mode}・縁の体 ${Math.round(edge * 100)}%）`)
  }
  console.log(`絵 ${faces.length}枚：${size.w}×${size.h}（切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
  if (size.w !== PRIEST_FACE_SIZE.w) console.log(`⚠ priest.js の PRIEST_FACE_SIZE.w を ${size.w} にする（いまは ${PRIEST_FACE_SIZE.w}）`)
}

for (const d of done) console.log(`✔ ${d}`)
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
