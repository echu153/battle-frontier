// ============================================================
// v2cap のクラスのイラストを、画面で使う軽い版（WebP・透明な背景のまま）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png（透明な背景）
//   上位クラスは public/V2newjob/上位職/<クラス名><男|女>.png（2026-10-17・探し方は classArt.js の artSrcFilesOf）
// 作るもの：
//   public/V2newjob/web/<名前>-m.webp・-f.webp   … 詳細の全身（幅720）
//   public/V2newjob/face/<名前>-m.webp・-f.webp  … 一覧の顔のアップ（192×192。顔の目印 ART_FACE と写し方 FACE_FIT で切り取る）
//   public/V2newjob/icon/<名前>-m.webp・-f.webp  … 戦闘ログの自分のアイコン（192×192）。元は public/V2newjob/SD/SD<クラス名><男|女>.png
//                                                  （デフォルメの絵・体がちょうど収まる正方形に切り取る。作れたら classArt.js の ART_SD に足す）
//   public/V2newjob/gif/<名前>-m.gif・-f.gif    … ホームの自分のアイコン（待機の動く絵・2026-10-22）。元は public/V2newjob/ギフ/<クラス名><男|女>待機.gif
//                                                  （元のまま写す。作れたら classArt.js の ART_GIF に足す）
// 対応表は src/v2cap/lib/classArt.js の ART_BASE・ART_FACE。絵を足したらそこに足してから回す：
//   node tools/v2cap-art.mjs           … 全身は元の絵が新しくなったものだけ・顔のアップは毎回作り直す（切り取りを直しても効くように）
//   node tools/v2cap-art.mjs --force   … 全部作り直す（作り方を変えたとき）
// ★ffmpeg（libwebp）を使う。元の絵に透明が無いときは知らせる（背景つきの絵がまぎれ込んだ印）
//   ただし classArt.js の ART_KEYED に載せた絵（背景が白いまま届き、抜いた絵を確かめたもの）は、背景を抜いてから使う
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { decode, bleed, alphaBox, encodeSquare, keyBackground, KEY } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { ART_BASE, ART_FACE, ART_GENDERS, faceCropOf, artSrcFilesOf, ART_KEYED, ART_SD, SD_DIR, SD_OUT, sdTargetOf, ART_GIF, GIF_DIR, GIF_OUT, gifTargetOf } = await import(new URL('../src/v2cap/lib/classArt.js', import.meta.url).href)
const SRC = path.join(ROOT, 'public', 'V2newjob')
const WEB = { dir: path.join(SRC, 'web'), width: 720, quality: 82 }
const FACE = { dir: path.join(SRC, 'face'), size: 192, quality: 82 }
const ICON = { src: path.join(SRC, SD_DIR), dir: path.join(SRC, SD_OUT), size: 192, quality: 82, margin: 0.03 }
const GIF = { src: path.join(SRC, GIF_DIR), dir: path.join(SRC, GIF_OUT) }
const FORCE = process.argv.includes('--force')
for (const o of [WEB, FACE, ICON, GIF]) mkdirSync(o.dir, { recursive: true })

const probe = (file) => {
  const [w, h, fmt] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]).toString().trim().split(',')
  return { w: Number(w), h: Number(h), alpha: /^(rgba|bgra|argb|abgr|ya8|ya16|gbrap|yuva|pal8)/.test(fmt), fmt }
}
const webp = (o) => ['-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(o.quality)]
// クラスの絵の背景の抜き方（モンスターの絵の KEY から変える所だけ）。
// 体に囲まれた白いすき間は「大きくて（300px以上）ほぼ真っ白（背景の色との差の平均3以下）」なものだけ抜く。
// モンスターの絵と同じ（25px以上・平均6以下）だと、白い服・白い鎧の照り・鼻の光まで穴になった（2026-10-17 侍女・魔法剣士女で確かめた）
const ART_KEY = { ...KEY, POCKET_MIN: 300, POCKET_MEAN: 3 }
// 元の絵を ffmpeg に渡す引数。背景を抜いた絵は生の画素（rgba）を標準入力から渡す
const inputOf = (src, keyed) => {
  if (!keyed) return { args: ['-i', src] }
  const { img } = keyBackground(decode(src, 1 << 14, 'rgb24'), ART_KEY)
  return { args: ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.W}x${img.H}`, '-i', '-'], input: img.data }
}

const missing = [], warn = []
let made = 0
for (const [cls, base] of Object.entries(ART_BASE)) {
  for (const g of ART_GENDERS) {
    const cands = artSrcFilesOf(cls, g.key)
    const src = cands.map(p => path.join(SRC, p)).find(existsSync)
    if (!src) { missing.push(`${cls}（${g.label}）：${cands.join(' か ')}`); continue }
    const info = probe(src)
    const keyed = !info.alpha && ART_KEYED.includes(`${cls}:${g.key}`)
    if (!info.alpha && !keyed) warn.push(`${cls}（${g.label}）：${path.basename(src)} に透明が無い（${info.fmt}）。背景を抜いた版に差し替える（抜いて使うなら、抜いた絵を確かめてから classArt.js の ART_KEYED に足す）`)
    let input = null
    const inp = () => (input ||= inputOf(src, keyed))

    // 詳細の全身：幅だけ合わせて縮める（透明はそのまま）
    const outWeb = path.join(WEB.dir, `${base}-${g.key}.webp`)
    if (FORCE || !existsSync(outWeb) || statSync(outWeb).mtimeMs < statSync(src).mtimeMs) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inp().args,
        '-vf', `scale=${WEB.width}:-1:flags=lanczos`, ...webp(WEB), '-frames:v', '1', outWeb], { input: inp().input })
      made++
      console.log(`${cls}（${g.label}・全身${keyed ? '・背景を抜いた' : ''}）→ ${path.relative(ROOT, outWeb)}`)
    }

    // 一覧の顔のアップ：顔の目印から、どの顔も同じ大きさ・同じ位置になる正方形を切り取る（classArt.js の faceCropOf）。
    // 端に近いときは透明で足して、顔の位置を変えない
    const face = ART_FACE[base]?.[g.key]
    if (!face) { missing.push(`${cls}（${g.label}）：classArt.js の ART_FACE.${base}.${g.key}`); continue }
    const crop = faceCropOf(face, info.w, info.h)
    const S = Math.round(crop.size), P = S
    const X = Math.round(crop.x + P), Y = Math.round(crop.y + P)
    const outFace = path.join(FACE.dir, `${base}-${g.key}.webp`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inp().args,
      '-vf', `format=rgba,pad=iw+${2 * P}:ih+${2 * P}:${P}:${P}:color=0x00000000,crop=${S}:${S}:${X}:${Y},scale=${FACE.size}:${FACE.size}:flags=lanczos`,
      ...webp(FACE), '-frames:v', '1', outFace], { input: inp().input })
    made++
  }
}
// ===== デフォルメ（SD）の絵 → 戦闘ログの自分のアイコン =====
// 透明なところに隠れた色を近くの色で埋めてから（bleed）、体がちょうど収まる正方形に縮める
const sdMade = new Set(), sdSkip = []
for (const name of existsSync(ICON.src) ? readdirSync(ICON.src) : []) {
  if (!/.png$/i.test(name)) continue
  const src = path.join(ICON.src, name)
  const t = sdTargetOf(path.basename(name, path.extname(name)))
  if (t?.hold) { sdSkip.push(`${name}：確かめ中なので使わない（classArt.js の SD_ALIAS）`); continue }
  if (!t) { sdSkip.push(`${name}：どのクラスか読めない（SD<クラス名><男|女>.png にするか、classArt.js の SD_ALIAS に足す）`); continue }
  if (!t.g) { sdSkip.push(`${name}：男女が書いていない（${t.cls}・SD${t.cls}男.png のようにするか、classArt.js の SD_ALIAS に足す）`); continue }
  const out = path.join(ICON.dir, `${ART_BASE[t.cls]}-${t.g}.webp`)
  sdMade.add(`${t.cls}:${t.g}`)
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
  const info = probe(src)
  if (!info.alpha) warn.push(`${t.cls}（SD）：${name} に透明が無い（${info.fmt}）。背景を抜いた版に差し替える`)
  const img = decode(src, 627, 'rgba')
  bleed(img)
  const box = alphaBox(img)
  if (!box) { sdSkip.push(`${name}：全部透明`); continue }
  encodeSquare(img, box, out, ICON)
  made++
  console.log(`${t.cls}（${t.g === 'm' ? '男性' : '女性'}・SD）→ ${path.relative(ROOT, out)}`)
}
const sdListed = new Set(Object.entries(ART_SD).flatMap(([cls, gs]) => gs.map(g => `${cls}:${g}`)))
const sdNotListed = [...sdMade].filter(k => !sdListed.has(k))
const sdNoFile = [...sdListed].filter(k => { const [cls, g] = k.split(':'); return !existsSync(path.join(ICON.dir, `${ART_BASE[cls]}-${g}.webp`)) })

// ===== 待機の動く絵（GIF）→ ホームの自分のアイコン =====
// 元のまま写す（コマ・透明・大きさはユーザーが作ったまま。体の大きさは画像の作り方でそろえる＝classArt.js の ART_GIF の説明）
const gifMade = new Set(), gifSkip = []
for (const name of existsSync(GIF.src) ? readdirSync(GIF.src) : []) {
  if (!/.gif$/i.test(name)) continue
  const src = path.join(GIF.src, name)
  const t = gifTargetOf(path.basename(name, path.extname(name)))
  if (!t) { gifSkip.push(`${name}：どのクラスか読めない（<クラス名><男|女>待機.gif にするか、classArt.js の GIF_CLASS_ALIAS・GIF_ALIAS に足す）`); continue }
  if (!t.g) { gifSkip.push(`${name}：男女が書いていない（${t.cls}・${t.cls}男待機.gif のようにするか、classArt.js の GIF_ALIAS に足す）`); continue }
  const key = `${t.cls}:${t.g}`
  if (gifMade.has(key)) { gifSkip.push(`${name}：${t.cls}（${t.g === 'm' ? '男性' : '女性'}）がほかのファイルと重なっている`); continue }
  gifMade.add(key)
  const out = path.join(GIF.dir, `${ART_BASE[t.cls]}-${t.g}.gif`)
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
  const info = probe(src)
  if (!info.alpha) warn.push(`${t.cls}（GIF）：${name} に透明が無い（${info.fmt}）`)
  copyFileSync(src, out)
  made++
  console.log(`${t.cls}（${t.g === 'm' ? '男性' : '女性'}・GIF）→ ${path.relative(ROOT, out)}`)
}
const gifListed = new Set(Object.entries(ART_GIF).flatMap(([cls, gs]) => gs.map(g => `${cls}:${g}`)))
const gifNotListed = [...gifMade].filter(k => !gifListed.has(k))
const gifNoFile = [...gifListed].filter(k => { const [cls, g] = k.split(':'); return !existsSync(path.join(GIF.dir, `${ART_BASE[cls]}-${g}.gif`)) })

console.log(`作った：${made}枚（顔のアップは毎回作り直す）`)
if (sdSkip.length) { console.log('⚠ 使えなかったSDの絵：'); for (const m of sdSkip) console.log(`  ${m}`) }
if (sdNotListed.length) console.log(`⚠ SDのアイコンを作ったが classArt.js の ART_SD に無い：${sdNotListed.join('・')}`)
if (sdNoFile.length) { console.log(`⚠ ART_SD にあるのにアイコンが無い：${sdNoFile.join('・')}`); process.exitCode = 1 }
if (gifSkip.length) { console.log('⚠ 使えなかったGIF：'); for (const m of gifSkip) console.log(`  ${m}`) }
if (gifNotListed.length) console.log(`⚠ GIFを写したが classArt.js の ART_GIF に無い：${gifNotListed.join('・')}`)
if (gifNoFile.length) { console.log(`⚠ ART_GIF にあるのにGIFが無い：${gifNoFile.join('・')}`); process.exitCode = 1 }
if (missing.length) { console.log('足りないもの：'); for (const m of missing) console.log(`  ${m}`) }
if (warn.length) { console.log('⚠ 透明な背景になっていない元の絵：'); for (const m of warn) console.log(`  ${m}`); process.exitCode = 1 }
