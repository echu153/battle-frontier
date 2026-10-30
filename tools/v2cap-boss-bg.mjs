// ============================================================
// v2cap のダンジョンのボス戦の背景を、画面で使う形にする（決まりは src/v2cap/lib/bossBg.js）
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/背景.png（横3：縦2・透明なし）
// 作るもの：
//   public/v2cap-art/boss/<key>-bg.webp      … 幅 WIDTH まで縮めた WebP
//   public/v2cap-art/boss/<key>-bg-flow.webp … 流れ図（lib/bossBg.js の flow があるボス）。R・G＝流れる向き（0.5 が止まる）・B＝動かす強さ（絵の色から溶岩を選ぶ）
//   src/v2cap/lib/bossBgList.js              … 一覧（元の絵の大きさ・中身の印）
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
import { BOSS_BG_DEFS, flowAt, lavaOf } from '../src/v2cap/lib/bossBg.js'
import { readRgba } from './v2cap-motion.mjs'

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

// 流れ図を作る：元の絵の1画素ごとに溶岩らしさを見て、流れ図の1マスへ集める（平均と最大の半々＝細い筋が消えない）→ 1回ぼかす（ふちを柔らかく）
const flowMapOf = (P, flow) => {
  const [FW, FH] = flow.size, sum = new Float32Array(FW * FH), max = new Float32Array(FW * FH), cnt = new Uint32Array(FW * FH)
  for (let y = 0; y < P.H; y++) for (let x = 0; x < P.W; x++) {
    const a = flowAt(flow.regions, x, y)
    const q = Math.floor((y / P.H) * FH) * FW + Math.floor((x / P.W) * FW)
    cnt[q] += 1
    if (!a) continue
    const i = (y * P.W + x) * 4, v = lavaOf(a.pick, P.data[i], P.data[i + 1], P.data[i + 2]) * a.gain
    sum[q] += v
    if (v > max[q]) max[q] = v
  }
  const raw = new Float32Array(FW * FH)
  for (let q = 0; q < FW * FH; q++) raw[q] = Math.min(1, ((sum[q] / Math.max(1, cnt[q])) + max[q]) / 2 * 1.5)
  const out = Buffer.alloc(FW * FH * 4)
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    let s = 0, n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx
      if (yy < 0 || xx < 0 || yy >= FH || xx >= FW) continue
      const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
      s += raw[yy * FW + xx] * w; n += w
    }
    const a = flowAt(flow.regions, ((x + 0.5) / FW) * P.W, ((y + 0.5) / FH) * P.H), o = (y * FW + x) * 4
    out[o] = Math.round(128 + 127 * Math.max(-1, Math.min(1, a?.dx || 0)))
    out[o + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, a?.dy || 0)))
    out[o + 2] = Math.round(255 * (s / n))
    out[o + 3] = 255
  }
  return { W: FW, H: FH, data: out }
}

const all = JSON.parse(JSON.stringify(BOSS_BG))
for (const [key, def] of Object.entries(BOSS_DEFS)) {
  const src = path.join(SRC, def.dir, '背景.png'), out = path.join(OUT, bossFileOf(key, 'bg'))
  if (!existsSync(src)) { console.log(`  - ${def.name}：背景.png が無い`); continue }
  const bgDef = BOSS_BG_DEFS[key], flowOut = path.join(OUT, bossFileOf(key, 'bg-flow'))
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && all[key] && (!bgDef?.flow || existsSync(flowOut))) continue
  mkdirSync(OUT, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${WIDTH}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6', out])
  all[key] = sizeOf(src)
  if (bgDef?.flow) {
    const m = flowMapOf(readRgba(src), bgDef.flow)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${m.W}x${m.H}`, '-i', '-', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', flowOut], { input: m.data, maxBuffer: 1 << 28 })
    console.log(`  ✓ ${def.name}の流れ図：${Math.round(statSync(flowOut).size / 1024)}KB`)
  }
  console.log(`  ✓ ${def.name}：${Math.round(statSync(out).size / 1024)}KB`)
}
const lines = ['// tools/v2cap-boss-bg.mjs が書くファイル（手で直さない）。ボス → 背景の元の絵の大きさ（w・h）と中身の印（v＝画面のアドレスの ?v=・flow＝流れ図の印）', 'export const BOSS_BG = {']
for (const [key, e] of Object.entries(all)) {
  const f = path.join(OUT, bossFileOf(key, 'bg'))
  const ff = path.join(OUT, bossFileOf(key, 'bg-flow'))
  lines.push(`  ${key}: { w: ${e.w}, h: ${e.h}, v: '${existsSync(f) ? versionOf(f) : e.v}'${existsSync(ff) ? `, flow: '${versionOf(ff)}'` : ''} },`)
}
lines.push('}', '')
writeFileSync(LIST, lines.join('\n'))
console.log('→ src/v2cap/lib/bossBgList.js')
