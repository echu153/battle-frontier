// ============================================================
// v2cap のダンジョンのボス戦の背景を、画面で使う形にする（決まりは src/v2cap/lib/bossBg.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/背景.png（横3：縦2・透明なし）
// 作るもの：
//   public/v2cap-art/boss/<key>-bg.webp … 幅 WIDTH まで縮めた WebP
//   src/v2cap/lib/bossBgList.js         … 一覧（元の絵の大きさ・中身の印）
// 使い方：node tools/v2cap-boss-bg.mjs [--force]
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ============================================================
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionOf } from './v2cap-art-lib.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, bossFileOf } from '../src/v2cap/lib/bossArt.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { BOSS_BG } from '../src/v2cap/lib/bossBgList.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossBgList.js')
const FORCE = process.argv.includes('--force')
const WIDTH = 1280     // PC の舞台の幅（980px まで）の少し上。スマホでは縮めて出す
const QUALITY = 74     // 描きこみが多いので少し下げる（1枚 250KB ほど）

const sizeOf = (f) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' })
  const [w, h] = out.trim().split(',').map(Number)
  return { w, h }
}

const all = JSON.parse(JSON.stringify(BOSS_BG))
for (const [key, def] of Object.entries(BOSS_DEFS)) {
  const src = path.join(SRC, def.dir, '背景.png'), out = path.join(OUT, bossFileOf(key, 'bg'))
  if (!existsSync(src)) { console.log(`  - ${def.name}：背景.png が無い`); continue }
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && all[key]) continue
  mkdirSync(OUT, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${WIDTH}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6', out])
  all[key] = sizeOf(src)
  console.log(`  ✓ ${def.name}：${Math.round(statSync(out).size / 1024)}KB`)
}
const lines = ['// tools/v2cap-boss-bg.mjs が書くファイル（手で直さない）。ボス → 背景の元の絵の大きさ（w・h）と中身の印（v＝画面のアドレスの ?v=）', 'export const BOSS_BG = {']
for (const [key, e] of Object.entries(all)) {
  const f = path.join(OUT, bossFileOf(key, 'bg'))
  lines.push(`  ${key}: { w: ${e.w}, h: ${e.h}, v: '${existsSync(f) ? versionOf(f) : e.v}' },`)
}
lines.push('}', '')
writeFileSync(LIST, lines.join('\n'))
console.log('→ src/v2cap/lib/bossBgList.js')
