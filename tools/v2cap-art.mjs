// ============================================================
// v2cap のクラスのイラストを、画面で使う軽い版（WebP・透明な背景のまま）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png（透明な背景）
// 作るもの：
//   public/V2newjob/web/<名前>-m.webp・-f.webp   … 詳細の全身（幅720）
//   public/V2newjob/face/<名前>-m.webp・-f.webp  … 一覧の顔のアップ（192×192。顔の目印 ART_FACE と写し方 FACE_FIT で切り取る）
// 対応表は src/v2cap/lib/classArt.js の ART_BASE・ART_FACE。絵を足したらそこに足してから回す：
//   node tools/v2cap-art.mjs           … 全身は元の絵が新しくなったものだけ・顔のアップは毎回作り直す（切り取りを直しても効くように）
//   node tools/v2cap-art.mjs --force   … 全部作り直す（作り方を変えたとき）
// ★ffmpeg（libwebp）を使う。元の絵に透明が無いときは知らせる（背景つきの絵がまぎれ込んだ印）
// ============================================================
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { ART_BASE, ART_FACE, ART_GENDERS, faceCropOf } = await import(new URL('../src/v2cap/lib/classArt.js', import.meta.url).href)
const SRC = path.join(ROOT, 'public', 'V2newjob')
const WEB = { dir: path.join(SRC, 'web'), width: 720, quality: 82 }
const FACE = { dir: path.join(SRC, 'face'), size: 192, quality: 82 }
const FORCE = process.argv.includes('--force')
for (const o of [WEB, FACE]) mkdirSync(o.dir, { recursive: true })

const probe = (file) => {
  const [w, h, fmt] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]).toString().trim().split(',')
  return { w: Number(w), h: Number(h), alpha: /^(rgba|bgra|argb|abgr|ya8|ya16|gbrap|yuva|pal8)/.test(fmt), fmt }
}
const webp = (o) => ['-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(o.quality)]

const missing = [], warn = []
let made = 0
for (const [cls, base] of Object.entries(ART_BASE)) {
  for (const g of ART_GENDERS) {
    const src = g.src.map(s => path.join(SRC, `${base}${s}.png`)).find(existsSync)
    if (!src) { missing.push(`${cls}（${g.label}）：${base}${g.src[0]}.png`); continue }
    const info = probe(src)
    if (!info.alpha) warn.push(`${cls}（${g.label}）：${path.basename(src)} に透明が無い（${info.fmt}）。背景を抜いた版に差し替える`)

    // 詳細の全身：幅だけ合わせて縮める（透明はそのまま）
    const outWeb = path.join(WEB.dir, `${base}-${g.key}.webp`)
    if (FORCE || !existsSync(outWeb) || statSync(outWeb).mtimeMs < statSync(src).mtimeMs) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-vf', `scale=${WEB.width}:-1:flags=lanczos`, ...webp(WEB), outWeb])
      made++
      console.log(`${cls}（${g.label}・全身）→ ${path.relative(ROOT, outWeb)}`)
    }

    // 一覧の顔のアップ：顔の目印から、どの顔も同じ大きさ・同じ位置になる正方形を切り取る（classArt.js の faceCropOf）。
    // 端に近いときは透明で足して、顔の位置を変えない
    const face = ART_FACE[base]?.[g.key]
    if (!face) { missing.push(`${cls}（${g.label}）：classArt.js の ART_FACE.${base}.${g.key}`); continue }
    const crop = faceCropOf(face, info.w, info.h)
    const S = Math.round(crop.size), P = S
    const X = Math.round(crop.x + P), Y = Math.round(crop.y + P)
    const outFace = path.join(FACE.dir, `${base}-${g.key}.webp`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vf', `format=rgba,pad=iw+${2 * P}:ih+${2 * P}:${P}:${P}:color=0x00000000,crop=${S}:${S}:${X}:${Y},scale=${FACE.size}:${FACE.size}:flags=lanczos`,
      ...webp(FACE), outFace])
    made++
  }
}
console.log(`作った：${made}枚（顔のアップは毎回作り直す）`)
if (missing.length) { console.log('足りないもの：'); for (const m of missing) console.log(`  ${m}`) }
if (warn.length) { console.log('⚠ 透明な背景になっていない元の絵：'); for (const m of warn) console.log(`  ${m}`); process.exitCode = 1 }
