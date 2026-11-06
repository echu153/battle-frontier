// ============================================================
// v2cap 修練場の案山子の絵（立ち絵・入口の顔のアップ・背景）を、画面で使う形にする（決まりは src/v2cap/lib/scarecrowArt.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/修練場/案山子/立ち絵.png（透明か真緑の背景）・背景.png（横3：縦2・透明なし）
// 作るもの：
//   public/v2cap-art/training/scarecrow.webp       … 立ち絵（SCARECROW_STAND_SIZE の正方形・透明つき・足元を下のはしにそろえる＝床に立つ）
//   public/v2cap-art/training/scarecrow-face.webp  … 修練場の入口の顔のアップ（SCARECROW_FACE_SIZE の正方形）
//   public/v2cap-art/training/scarecrow-bg.webp    … 背景（幅 1280 まで縮める）
//   src/v2cap/lib/scarecrowArtList.js              … 一覧（中身の印・背景の元の大きさ）
// 使い方：node tools/v2cap-scarecrow-art.mjs [--src <元の絵のフォルダ>]（worktree では本体の public/エネミー/修練場/案山子 を渡す）
// ★元の絵が無いもの（別のPCなど）は、作ってある絵と一覧を消さない
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, bleed, alphaBox, encodeSquare, probe, transparentBorderRatio, versionOf } from './v2cap-art-lib.mjs'
import { keyGreen } from './v2cap-motion.mjs'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { SCARECROW_SRC_DIR, SCARECROW_ART_DIR, SCARECROW_STAND_SIZE, SCARECROW_FACE_SIZE, SCARECROW_FACE_BOX } from '../src/v2cap/lib/scarecrowArt.js'
import { SCARECROW_ART } from '../src/v2cap/lib/scarecrowArtList.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, SCARECROW_SRC_DIR))
const OUT = path.join(ROOT, 'public', SCARECROW_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'scarecrowArtList.js')
const BG_WIDTH = 1280   // 四凶の背景と同じ（tools/v2cap-boss-bg.mjs）
const BG_QUALITY = 74
mkdirSync(OUT, { recursive: true })
const art = { ...SCARECROW_ART }

// ===== 立ち絵・顔のアップ =====
const stand = path.join(SRC, '立ち絵.png')
if (existsSync(stand)) {
  const img = decode(stand, 1254, 'rgba')
  // 縁がほとんど透明でなければ真緑の背景（透明にできなかった絵）として抜く
  const keyed = transparentBorderRatio(img) < 0.5
  if (keyed) keyGreen(img)
  bleed(img)
  const box = alphaBox(img)
  if (!box) throw new Error('立ち絵が透明です')
  // 足元を下のはしにそろえた正方形（左右はまん中・上は余白）。余白は長いほうの辺の4%
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1
  const S = Math.round(Math.max(bw, bh) * 1.08)
  const cx = (box.x0 + box.x1 + 1) / 2, bottom = box.y1 + Math.round(Math.max(bw, bh) * 0.02)
  const sq = { x0: Math.round(cx - S / 2), y0: bottom - S + 1, x1: Math.round(cx - S / 2) + S - 1, y1: bottom }
  const out = path.join(OUT, 'scarecrow.webp')
  encodeSquare(img, sq, out, { size: SCARECROW_STAND_SIZE, margin: 0, quality: 84 })
  art.stand = versionOf(out)
  // 顔のアップ：決めた正方形（SCARECROW_FACE_BOX）か、体の上のはしから体の高さの36%の正方形
  const fb = SCARECROW_FACE_BOX
  const side = fb ? Math.round(fb[2] * img.W) : Math.round(bh * 0.36)
  const fx0 = fb ? Math.round(fb[0] * img.W - side / 2) : Math.round(cx - side / 2)
  const fy0 = fb ? Math.round(fb[1] * img.W - side / 2) : box.y0
  const outFace = path.join(OUT, 'scarecrow-face.webp')
  encodeSquare(img, { x0: fx0, y0: fy0, x1: fx0 + side - 1, y1: fy0 + side - 1 }, outFace, { size: SCARECROW_FACE_SIZE, margin: 0, quality: 85 })
  art.face = versionOf(outFace)
  console.log(`  立ち絵：${Math.round(statSync(out).size / 1024)}KB${keyed ? '（真緑を抜いた）' : '（透明つき）'}・顔 ${Math.round(statSync(outFace).size / 1024)}KB`)
} else {
  console.log(`  立ち絵：元の絵がない（${stand}）`)
}

// ===== 背景 =====
const bgFile = path.join(SRC, '背景.png')
if (existsSync(bgFile)) {
  const { w, h } = probe(bgFile)
  const out = path.join(OUT, 'scarecrow-bg.webp')
  const W = Math.min(BG_WIDTH, w)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', bgFile, '-vf', `scale=${W}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(BG_QUALITY), '-frames:v', '1', out])
  art.bg = { w, h, v: versionOf(out) }
  console.log(`  背景：${Math.round(statSync(out).size / 1024)}KB（元 ${w}×${h}）`)
} else {
  console.log(`  背景：元の絵がない（${bgFile}）`)
}

const lines = ['// tools/v2cap-scarecrow-art.mjs が書くファイル（手で直さない）。案山子の絵の中身の印（画面のアドレスの ?v=）・背景は元の絵の大きさも', 'export const SCARECROW_ART = {']
if (art.stand) lines.push(`  stand: '${art.stand}',`)
if (art.face) lines.push(`  face: '${art.face}',`)
if (art.bg) lines.push(`  bg: { w: ${art.bg.w}, h: ${art.bg.h}, v: '${art.bg.v}' },`)
lines.push('}', '')
writeFileSync(LIST, lines.join('\n'))
console.log('一覧を書いた：', path.relative(ROOT, LIST))
