// ============================================================
// v2cap のホームのメニューの見出しの帯の絵を、画面で使う形にする（決まりは src/v2cap/lib/menuHead.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/V2ホーム画面/<名前>.png（ChatGPT で描いた 1536×1024。真ん中に細長い帯・上下は真っ黒の余白）
// 作るもの：
//   public/v2cap-art/home/menu-<key>.webp … 帯だけを切り抜き、左を透明へ溶かした WebP
//   src/v2cap/lib/menuHeadList.js         … 一覧（できた絵の大きさ・中身の印）
// ★帯の高さは絵ごとに違う（届いた3枚は 368・368・271）ので、上下の余白は行の明るさで見つける
// 使い方：node tools/v2cap-menu-art.mjs [--force]
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ============================================================
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encodeRect, probe, versionOf } from './v2cap-art-lib.mjs'
import { MENU_HEAD } from '../src/v2cap/lib/menuHeadList.js'
import { MENU_HEAD_DEFS, MENU_HEAD_DIR, MENU_HEAD_SRC_DIR, menuHeadFileOf } from '../src/v2cap/lib/menuHead.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'public', MENU_HEAD_SRC_DIR)
const OUT = path.join(ROOT, 'public', MENU_HEAD_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'menuHeadList.js')
const FORCE = process.argv.includes('--force')
const HEIGHT = 240       // 画面の帯（高さ80pxまで）の3倍
const QUALITY = 82
const BAND_MIN = 6       // 行の明るさの平均がこれより上なら帯（上下の余白は 0〜1）
const BAND_INSET = 3     // 帯の上下のはしは余白とにじんでいるので切る
const FADE = [380, 600]  // 元の絵の px。これより左は捨て、この範囲で透明→不透明（絵はもともと左へ暗く溶けている）

// 帯の上下（行の明るさで見つける）。余白が無い絵は帯として使えないので止める
const bandOf = ({ data, W, H }) => {
  const on = []
  for (let y = 0; y < H; y++) {
    let s = 0
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; s += data[i] + data[i + 1] + data[i + 2] }
    on.push(s / W / 3 > BAND_MIN)
  }
  const y0 = on.indexOf(true), y1 = on.lastIndexOf(true)
  if (y0 < 0 || y1 - y0 + 1 > H * 0.7) throw new Error('上下の真っ黒の余白が見つからない（帯になっていない）')
  return { y0: y0 + BAND_INSET, y1: y1 - BAND_INSET }
}

// 左を透明へ溶かす（なめらかに）
const fadeLeft = ({ data, W, H }) => {
  const [a, b] = FADE
  for (let y = 0; y < H; y++) for (let x = 0; x < Math.min(b, W); x++) {
    const t = Math.max(0, (x - a) / (b - a))
    data[(y * W + x) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t))
  }
}

const all = JSON.parse(JSON.stringify(MENU_HEAD))
const failed = []
for (const [key, def] of Object.entries(MENU_HEAD_DEFS)) {
  const src = path.join(SRC, def.source), out = path.join(OUT, menuHeadFileOf(key))
  if (!existsSync(src)) { console.log(`  - ${def.source} が無い`); continue }
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && all[key]) continue
  try {
    mkdirSync(OUT, { recursive: true })
    const img = decode(src, probe(src).w, 'rgba')
    const { y0, y1 } = bandOf(img)
    fadeLeft(img)
    const size = encodeRect(img, { x0: FADE[0], y0, x1: img.W - 1, y1 }, out, { height: HEIGHT, quality: QUALITY })
    all[key] = size
    console.log(`  ✓ ${def.source}：帯の高さ ${y1 - y0 + 1} → ${size.w}×${size.h}・${Math.round(statSync(out).size / 1024)}KB`)
  } catch (e) { failed.push(`${def.source}：${e.message}`) }
}
const lines = ['// tools/v2cap-menu-art.mjs が書くファイル（手で直さない）。見出しの帯 → できた絵の大きさ（w・h）と中身の印（v＝画面のアドレスの ?v=）', 'export const MENU_HEAD = {']
for (const [key, e] of Object.entries(all)) {
  const f = path.join(OUT, menuHeadFileOf(key))
  lines.push(`  ${key}: { w: ${e.w}, h: ${e.h}, v: '${existsSync(f) ? versionOf(f) : e.v}' },`)
}
lines.push('}', '')
writeFileSync(LIST, lines.join('\n'))
console.log('→ src/v2cap/lib/menuHeadList.js')
if (failed.length) { console.log(`✖ ${failed.join('\n✖ ')}`); process.exitCode = 1 }
