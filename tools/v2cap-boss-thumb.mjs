// v2cap ボスの一覧の小さい絵（挑戦の入口・試し撃ち）を作る
//   元の絵：public/エネミー/IDダンジョン/<ボス>/イラスト.png（gitignore・透明な背景）
//   → public/v2cap-art/boss/<key>-thumb.webp（透明な背景のまま・体が収まる正方形）
//   → src/v2cap/lib/bossThumbList.js（中身の印＝画面のアドレスの ?v=）
//   【確定】2026-10-31 雨摩座には遭遇のイラストが無かった（ドット絵版の道具が作るので、イラスト版だけのボスには出ない）。
//     一覧で大きな絵（1枚230KB）を読まなくていいように、全部のボスで小さい絵を作る
// 使い方：node tools/v2cap-boss-thumb.mjs
import { existsSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, bleed, alphaBox, encodeSquare, versionOf } from './v2cap-art-lib.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, BOSS_THUMB_SIZE, bossFileOf } from '../src/v2cap/lib/bossArt.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossThumbList.js')

const lines = ['// tools/v2cap-boss-thumb.mjs が書くファイル（手で直さない）。ボス → 一覧の小さい絵の中身の印（画面のアドレスの ?v=）', 'export const BOSS_THUMB = {']
for (const [key, def] of Object.entries(BOSS_DEFS)) {
  const file = path.join(SRC, def.dir, 'イラスト.png')
  if (!existsSync(file)) { console.log(`  ${key}：元の絵がない（${file}）`); continue }
  const img = decode(file, 1024, 'rgba')
  bleed(img)
  const box = alphaBox(img)
  if (!box) { console.log(`  ${key}：絵が透明`); continue }
  const out = path.join(OUT, bossFileOf(key, 'thumb'))
  encodeSquare(img, box, out, { size: BOSS_THUMB_SIZE, margin: 0.02, quality: 82 })
  lines.push(`  ${key}: '${versionOf(out)}',`)
  console.log(`  ${key}：${Math.round(statSync(out).size / 1024)}KB`)
}
lines.push('}', '')
writeFileSync(LIST, lines.join('\n'))
