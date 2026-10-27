// ============================================================
// v2cap の賭博場のアレア（カクテルウェイトレス）の絵を、画面で使う軽い版（透明つきの WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2賭博場/<名前>.png（ChatGPT で描いた PNG・1024×1536）
//   名前は src/v2cap/lib/alea.js の ALEA_FACES・ALEA_WELCOME の src（どれか1つあればよい）。設定画.png は見本なので使わない
//   衣装ごと（ALEA_OUTFITS）：元の絵は public/V2賭博場/<衣装の dir>/（いまはディーラー服だけ＝dir '' でそのフォルダ）
// 作るもの：public/v2cap-art/casino/<衣装>/<キー>.webp
//   ・表情5枚（腰から上）… 全部の見えている範囲を合わせた1つの箱で切る＝どの表情も同じ大きさ・同じ位置
//     （ゲームで表情を切り替えても体が動かない）。高さは alea.js の ALEA_FACE_SIZE.h
//   ・welcome（全身の「いらっしゃい」）… 体がちょうど収まる長方形（余白2%）。高さ ALEA_WELCOME_H
// ★ChatGPT の絵は1pxだけ大きさがちがうことがある（2026-10-27 微笑みだけ 1024×1535）。差が SIZE_SLACK 以内なら、
//   いちばん大きい絵に合わせて右と下に透明を足す（体の位置はそのまま）
// ★透明つきの絵は、透明なところに元の背景の色が隠れて残っている。縮める前に近くの体の色で埋める（bleed）＝縁ににじまない
// ★体の不透明さが 253 くらい（255 ではない）のことがある＝ALPHA_SNAP 以上は 255 にそろえる（親方の絵と同じ）
// ★透明にならず真っ白（かチェック模様）の背景で届いたときは、縁の色から背景を見立てて抜く（tools/v2cap-art-lib.mjs の keyBackground）。
//   抜いたあとも縁に体が多く残っていたら知らせて、終わりのコードを1にする
//   node tools/v2cap-casino-art.mjs                         … public/V2賭博場 → public/v2cap-art/casino
//   node tools/v2cap-casino-art.mjs --src <dir> --out <dir> … 道具を試すとき（元の絵と書き出す場所を変える）
// ============================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeRect, keyBackground, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { ALEA_OUTFITS, ALEA_FACES, ALEA_WELCOME, ALEA_ART_DIR, ALEA_FACE_SIZE, ALEA_WELCOME_H } =
  await import(new URL('../src/v2cap/lib/alea.js', import.meta.url).href)

const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', 'V2賭博場'))
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'public', ALEA_ART_DIR.replace(/^\//, '')))
const QUALITY = 82
const ALPHA_MIN = 0.5      // 縁のこれ以上が透明なら「透明つき」（腰から上は下の縁が体で切れるので全部は透明にならない）
const EDGE_LEFT_MAX = 0.45 // 背景を抜いたあと、縁に残った体の割合がこれを超えたら「背景が抜けていない」
const ALPHA_SNAP = 240     // 不透明さがこれ以上なら 255 にそろえる（体の中がわずかに透けないように）
const SIZE_SLACK = 4       // 表情の絵の大きさの差がこれ以内（px）なら、透明を足してそろえる

const snapAlpha = ({ data, W, H }) => { for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] >= ALPHA_SNAP) data[p * 4 + 3] = 255 }
// rgba の絵を W×H に広げる（右と下に透明を足す）
const padTo = (img, W, H) => {
  if (img.W === W && img.H === H) return img
  const data = Buffer.alloc(W * H * 4)
  for (let y = 0; y < img.H; y++) img.data.copy(data, y * W * 4, y * img.W * 4, (y + 1) * img.W * 4)
  return { data, W, H }
}
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
  return { img, mode }
}
const edgeOf = (img) => {
  const border = borderOf(img.W, img.H)
  return border.filter(p => img.data[p * 4 + 3] > 128).length / border.length
}

const missing = [], failed = [], done = []
for (const outfit of ALEA_OUTFITS) {
  const srcDir = path.join(SRC, outfit.dir || '')
  const outDir = path.join(OUT, outfit.key)
  const srcOf = (names) => names.map(n => path.join(srcDir, `${n}.png`)).find(existsSync) || null
  mkdirSync(outDir, { recursive: true })

  // ===== 表情：同じ箱で切る =====
  const faces = []
  for (const f of ALEA_FACES) {
    const file = srcOf(f.src)
    if (!file) { missing.push(`${outfit.label}・${f.label}（${f.src.join('・')}.png）`); continue }
    try { faces.push({ f, file, ...load(file) }) } catch (e) { failed.push(e.message) }
  }
  if (faces.length) {
    const W = Math.max(...faces.map(x => x.img.W)), H = Math.max(...faces.map(x => x.img.H))
    const off = faces.filter(x => W - x.img.W > SIZE_SLACK || H - x.img.H > SIZE_SLACK)
    if (off.length) failed.push(`表情の絵の大きさがそろっていない（${faces.map(x => `${x.f.label} ${x.img.W}×${x.img.H}`).join('・')}）`)
    else {
      for (const x of faces) {
        if (x.img.W !== W || x.img.H !== H) { x.padded = `${x.img.W}×${x.img.H}→${W}×${H}`; x.img = padTo(x.img, W, H) }
        bleed(x.img)
      }
      const box = faces.map(x => alphaBox(x.img)).filter(Boolean)
        .reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
      let size = null
      for (const { f, img, mode, padded } of faces) {
        size = encodeRect(img, box, path.join(outDir, `${f.key}.webp`), { height: ALEA_FACE_SIZE.h, margin: 0.01, quality: QUALITY })
        done.push(`${outfit.label}・${f.label} → ${outfit.key}/${f.key}.webp（${mode}${padded ? `・透明を足した ${padded}` : ''}・縁の体 ${Math.round(edgeOf(img) * 100)}%）`)
      }
      console.log(`表情 ${faces.length}枚：${size.w}×${size.h}（切った箱 ${box.x0},${box.y0}〜${box.x1},${box.y1}）`)
      if (size.w !== ALEA_FACE_SIZE.w) console.log(`⚠ alea.js の ALEA_FACE_SIZE.w を ${size.w} にする（いまは ${ALEA_FACE_SIZE.w}）`)
    }
  }

  // ===== 全身の「いらっしゃい」 =====
  const file = srcOf(ALEA_WELCOME.src)
  if (!file) missing.push(`${outfit.label}・いらっしゃい（${ALEA_WELCOME.src.join('・')}.png）`)
  else {
    try {
      const { img, mode } = load(file)
      bleed(img)
      const s = encodeRect(img, alphaBox(img), path.join(outDir, `${ALEA_WELCOME.key}.webp`), { height: ALEA_WELCOME_H, margin: 0.02, quality: QUALITY })
      done.push(`${outfit.label}・いらっしゃい → ${outfit.key}/${ALEA_WELCOME.key}.webp（${s.w}×${s.h}・${mode}）`)
    } catch (e) { failed.push(e.message) }
  }
}

for (const d of done) console.log(`✔ ${d}`)
if (missing.length) console.log(`⚠ 元の絵が無い：${missing.join('／')}`)
if (failed.length) console.log(`✖ ${failed.join('\n✖ ')}`)
if (missing.length || failed.length) process.exitCode = 1
