// ============================================================
// v2cap のニャーガーキングの看板娘の絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2バーガー/<名前>.png（ChatGPT で描いた透明つきの PNG・1024×1536）
//   名前は src/v2cap/lib/clerk.js の CLERK_FACES・CLERK_WELCOME・CLERK_MARK の src（どれか1つあればよい）
// 作るもの：public/v2cap-art/clerk/<キー>.webp
//   ・表情9枚（腰から上）… 9枚の見えている範囲を合わせた1つの箱で切る＝どの表情も同じ大きさ・同じ位置
//     （ゲームで表情を切り替えても体が動かない）。高さは clerk.js の CLERK_FACE_SIZE.h
//   ・welcome（全身の「いらっしゃいませー」）… 体がちょうど収まる長方形（余白2%）。高さ CLERK_WELCOME_H
//   ・mark（ワッペン＝メニューのアイコン）… 正方形 CLERK_MARK_SIZE
// ★ChatGPT の絵は、透明なところに元の背景（暗いオーラ）の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★元の絵の縁が透明でなければ（背景が抜けていない）知らせて、終わりのコードを1にする
//   node tools/v2cap-burger-art.mjs
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, encodeSquare, transparentBorderRatio } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { CLERK_FACES, CLERK_WELCOME, CLERK_MARK, CLERK_ART_DIR, CLERK_FACE_SIZE, CLERK_WELCOME_H, CLERK_MARK_SIZE } =
  await import(new URL('../src/v2cap/lib/clerk.js', import.meta.url).href)

const SRC = path.join(ROOT, 'public', 'V2バーガー')
const OUT = path.join(ROOT, 'public', CLERK_ART_DIR.replace(/^\//, ''))
const QUALITY = 82
const ALPHA_MIN = 0.5   // 縁のこれ以上が透明なら「背景が抜けている」（腰から上は下の縁が体で切れるので全部は透明にならない）

const srcOf = (names) => names.map(n => path.join(SRC, `${n}.png`)).find(existsSync) || null
const load = (file) => {
  const { w, h } = probe(file)
  const img = decode(file, Math.max(w, h), 'rgba')
  if (transparentBorderRatio(img) < ALPHA_MIN) throw new Error(`${path.basename(file)}：背景が透明になっていない`)
  bleed(img)
  return img
}

mkdirSync(OUT, { recursive: true })
const missing = [], failed = []
const done = []

// ===== 表情9枚：同じ箱で切る =====
const faces = []
for (const f of CLERK_FACES) {
  const file = srcOf(f.src)
  if (!file) { missing.push(`${f.label}（${f.src.join('・')}.png）`); continue }
  try { faces.push({ f, file, img: load(file) }) } catch (e) { failed.push(e.message) }
}
if (faces.length) {
  const { W, H } = faces[0].img
  if (faces.some(x => x.img.W !== W || x.img.H !== H)) failed.push(`表情の絵の大きさがそろっていない（${faces.map(x => `${x.f.label} ${x.img.W}×${x.img.H}`).join('・')}）`)
  const boxes = faces.map(x => alphaBox(x.img)).filter(Boolean)
  const box = boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
  let size = null
  for (const { f, img } of faces) {
    size = encodeRect(img, box, path.join(OUT, `${f.key}.webp`), { height: CLERK_FACE_SIZE.h, margin: 0.01, quality: QUALITY })
    done.push(`${f.label} → ${f.key}.webp`)
  }
  console.log(`表情 ${faces.length}枚：${size.w}×${size.h}（切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
  if (size.w !== CLERK_FACE_SIZE.w) console.log(`⚠ clerk.js の CLERK_FACE_SIZE.w を ${size.w} にする（いまは ${CLERK_FACE_SIZE.w}）`)
}

// ===== 全身の「いらっしゃいませー」 =====
{
  const file = srcOf(CLERK_WELCOME.src)
  if (!file) missing.push(`いらっしゃいませ（${CLERK_WELCOME.src.join('・')}.png）`)
  else {
    try {
      const img = load(file)
      const s = encodeRect(img, alphaBox(img), path.join(OUT, `${CLERK_WELCOME.key}.webp`), { height: CLERK_WELCOME_H, margin: 0.02, quality: QUALITY })
      done.push(`いらっしゃいませ → ${CLERK_WELCOME.key}.webp（${s.w}×${s.h}）`)
    } catch (e) { failed.push(e.message) }
  }
}

// ===== ワッペン（メニューのアイコン） =====
{
  const file = srcOf(CLERK_MARK.src)
  if (!file) missing.push(`ワッペン（${CLERK_MARK.src.join('・')}.png）`)
  else {
    try {
      const img = load(file)
      encodeSquare(img, alphaBox(img), path.join(OUT, `${CLERK_MARK.key}.webp`), { size: CLERK_MARK_SIZE, margin: 0.02, quality: 90 })
      done.push(`ワッペン → ${CLERK_MARK.key}.webp（${CLERK_MARK_SIZE}×${CLERK_MARK_SIZE}）`)
    } catch (e) { failed.push(e.message) }
  }
}

for (const d of done) console.log(`✔ ${d}`)
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
