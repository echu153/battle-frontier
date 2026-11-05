// v2cap ボスの一覧の小さい絵（挑戦の入口・試し撃ち）と、挑戦を押した瞬間に出す大きな絵（遭遇のイラスト）を作る
//   元の絵：public/エネミー/IDダンジョン/<ボス>/イラスト.png（gitignore・透明な背景）
//   → public/v2cap-art/boss/<key>-thumb.webp・<key>-encounter.webp（透明な背景のまま・体が収まる正方形・どちらも同じ切り抜き）
//   → public/v2cap-art/boss/<key>-face.webp（挑戦の入口の顔のアップ・lib/bossArt.js の BOSS_FACE_BOX で切り取る・2026-11-06〜）
//   → src/v2cap/lib/bossThumbList.js（中身の印＝画面のアドレスの ?v=）
//   【確定】2026-10-31 雨摩座には遭遇のイラストが無かった（ドット絵版の道具が作るので、イラスト版だけのボスには出ない）。
//     一覧で大きな絵（1枚230KB）を読まなくていいように、全部のボスで小さい絵を作る
// 使い方：node tools/v2cap-boss-thumb.mjs [--src <元の絵の IDダンジョン のフォルダ>]（worktree では本体の public/エネミー/IDダンジョン を渡す）
import { existsSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, bleed, alphaBox, encodeSquare, versionOf } from './v2cap-art-lib.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, BOSS_THUMB_SIZE, BOSS_ENCOUNTER_SIZE, BOSS_FACE_SIZE, BOSS_FACE_BOX, bossFileOf } from '../src/v2cap/lib/bossArt.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { BOSS_THUMB, BOSS_ENCOUNTER, BOSS_FACE } from '../src/v2cap/lib/bossThumbList.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const SRC = path.resolve(argOf('--src') || path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR))
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossThumbList.js')

const lines = ['// tools/v2cap-boss-thumb.mjs が書くファイル（手で直さない）。ボス → 一覧の小さい絵の中身の印（画面のアドレスの ?v=）', 'export const BOSS_THUMB = {']
const big = ['// 挑戦を押した瞬間に出す大きな絵（遭遇のイラスト）の中身の印', 'export const BOSS_ENCOUNTER = {']
const face = ['// 挑戦の入口の顔のアップ（lib/bossArt.js の BOSS_FACE_BOX で切り取る）の中身の印', 'export const BOSS_FACE = {']
for (const [key, def] of Object.entries(BOSS_DEFS)) {
  const file = path.join(SRC, def.dir, 'イラスト.png')
  // 元の絵が無いボス（別の作業場所など）は、作ってある絵と一覧を消さない
  if (!existsSync(file)) {
    console.log(`  ${key}：元の絵がない（${file}）`)
    if (BOSS_THUMB[key]) lines.push(`  ${key}: '${BOSS_THUMB[key]}',`)
    if (BOSS_ENCOUNTER[key]) big.push(`  ${key}: '${BOSS_ENCOUNTER[key]}',`)
    if (BOSS_FACE?.[key]) face.push(`  ${key}: '${BOSS_FACE[key]}',`)
    continue
  }
  const img = decode(file, 1254, 'rgba')
  bleed(img)
  const box = alphaBox(img)
  if (!box) { console.log(`  ${key}：絵が透明`); continue }
  const out = path.join(OUT, bossFileOf(key, 'thumb'))
  encodeSquare(img, box, out, { size: BOSS_THUMB_SIZE, margin: 0.02, quality: 82 })
  lines.push(`  ${key}: '${versionOf(out)}',`)
  const outBig = path.join(OUT, bossFileOf(key, 'encounter'))
  encodeSquare(img, box, outBig, { size: BOSS_ENCOUNTER_SIZE, margin: 0.02, quality: 78 })
  big.push(`  ${key}: '${versionOf(outBig)}',`)
  // 顔のアップ：決めた正方形をそのまま切り取る（はみ出すぶんは透明）
  const fb = BOSS_FACE_BOX[key]
  if (fb) {
    const [cx, cy, s] = fb, side = Math.round(s * img.W), x0 = Math.round(cx * img.W - side / 2), y0 = Math.round(cy * img.H - side / 2)
    const outFace = path.join(OUT, bossFileOf(key, 'face'))
    encodeSquare(img, { x0, y0, x1: x0 + side - 1, y1: y0 + side - 1 }, outFace, { size: BOSS_FACE_SIZE, margin: 0, quality: 85 })
    face.push(`  ${key}: '${versionOf(outFace)}',`)
  }
  console.log(`  ${key}：${Math.round(statSync(out).size / 1024)}KB・大きな絵 ${Math.round(statSync(outBig).size / 1024)}KB`)
}
lines.push('}', ...big, '}', ...face, '}', '')
writeFileSync(LIST, lines.join('\n'))
