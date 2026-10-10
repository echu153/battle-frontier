// ============================================================
// v2cap のクラスのイラストを、画面で使う軽い版（WebP・透明な背景のまま）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png
// 作るもの：public/V2newjob/web/<名前>-m.webp・-f.webp（幅720）と thumb/<名前>-m.webp・-f.webp（幅240）
// 対応表は src/v2cap/lib/classArt.js の ART_BASE。絵を足したらそこに足してから回す：
//   node tools/v2cap-art.mjs
// ★ffmpeg（libwebp）を使う。元の絵が新しくなったときだけ作り直す（日時で見る）
// ============================================================
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { ART_BASE, ART_GENDERS } = await import(new URL('../src/v2cap/lib/classArt.js', import.meta.url).href)
const SRC = path.join(ROOT, 'public', 'V2newjob')
const OUT = { web: { dir: path.join(SRC, 'web'), width: 720, quality: 82 }, thumb: { dir: path.join(SRC, 'thumb'), width: 240, quality: 80 } }
for (const o of Object.values(OUT)) mkdirSync(o.dir, { recursive: true })

const missing = []
let made = 0
for (const [cls, base] of Object.entries(ART_BASE)) {
  for (const g of ART_GENDERS) {
    const src = g.src.map(s => path.join(SRC, `${base}${s}.png`)).find(existsSync)
    if (!src) { missing.push(`${cls}（${g.label}）：${base}${g.src[0]}.png`); continue }
    for (const [kind, o] of Object.entries(OUT)) {
      const out = path.join(o.dir, `${base}-${g.key}.webp`)
      if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-vf', `scale=${o.width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(o.quality), out])
      made++
      console.log(`${cls}（${g.label}・${kind}）→ ${path.relative(ROOT, out)}`)
    }
  }
}
console.log(`作った：${made}枚`)
if (missing.length) { console.log('元の絵が無い：'); for (const m of missing) console.log(`  ${m}`) }
