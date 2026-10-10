// ============================================================
// v2cap のクラスのイラストを、画面で使う軽い版（WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png
// 作るもの：public/V2newjob/web/<名前>-m.webp・-f.webp（幅720）と thumb/<名前>-m.webp・-f.webp（幅240）
//   ・透明な背景の絵は、透明なまま縮めるだけ
//   ・背景つきの絵（classArt.js の ART_FULL）は 3:4 の枠いっぱいにする。絵は切らずに縦を合わせ、足りない左右は同じ絵をぼかして埋める
// 対応表は src/v2cap/lib/classArt.js の ART_BASE。絵を足したらそこに足してから回す：
//   node tools/v2cap-art.mjs           … 元の絵が新しくなったものだけ作り直す（日時で見る）
//   node tools/v2cap-art.mjs --force   … 全部作り直す（作り方を変えたとき）
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { ART_BASE, ART_FULL, ART_GENDERS } = await import(new URL('../src/v2cap/lib/classArt.js', import.meta.url).href)
const SRC = path.join(ROOT, 'public', 'V2newjob')
const OUT = {
  web:   { dir: path.join(SRC, 'web'),   width: 720, quality: 82, blur: 28 },
  thumb: { dir: path.join(SRC, 'thumb'), width: 240, quality: 80, blur: 10 },
}
const FORCE = process.argv.includes('--force')
for (const o of Object.values(OUT)) mkdirSync(o.dir, { recursive: true })

// 透明な背景：幅だけ合わせて縮める（透明はそのまま）
const plainArgs = (o) => ['-vf', `scale=${o.width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p']
// 背景つき：3:4 の枠いっぱい。後ろ＝枠を覆うまで広げてぼかし少し暗く／前＝絵を切らずに枠の中へ
const fullArgs = (o) => {
  const W = o.width, H = Math.round(o.width * 4 / 3)
  return ['-filter_complex',
    `[0:v]split[a][b];` +
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},boxblur=${o.blur}:2,eq=brightness=-0.05[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,format=yuv420p`,
    '-c:v', 'libwebp']
}

const missing = []
let made = 0
for (const [cls, base] of Object.entries(ART_BASE)) {
  for (const g of ART_GENDERS) {
    const src = g.src.map(s => path.join(SRC, `${base}${s}.png`)).find(existsSync)
    if (!src) { missing.push(`${cls}（${g.label}）：${base}${g.src[0]}.png`); continue }
    for (const [kind, o] of Object.entries(OUT)) {
      const out = path.join(o.dir, `${base}-${g.key}.webp`)
      if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        ...(ART_FULL.has(cls) ? fullArgs(o) : plainArgs(o)), '-quality', String(o.quality), out])
      made++
      console.log(`${cls}（${g.label}・${kind}${ART_FULL.has(cls) ? '・背景つき' : ''}）→ ${path.relative(ROOT, out)}`)
    }
  }
}
console.log(`作った：${made}枚`)
if (missing.length) { console.log('元の絵が無い：'); for (const m of missing) console.log(`  ${m}`) }
