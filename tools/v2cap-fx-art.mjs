// ============================================================
// v2cap の戦闘ログのアイコン（バフ・デバフ・状態異常）の絵を、画面で使う軽い版（背景を抜いた正方形の WebP）にする
// ------------------------------------------------------------
// 【確定】2026-10-24 ユーザー指示「アイコンはちゃっとGPTに作ってもらう予定」
// 元の絵（ユーザーが置く）：public/状態アイコン/<名前>.png（名前は src/v2cap/lib/battleFx.js の FX_DEFS の file：STR・毒・バリア など）
//   ・透明な背景の紋章だけの絵（文字なし）。枠・下地の色・「STR」「↑25%」の文字は画面で描く
// 作るもの：
//   public/fx-art/<id>.webp     … 96×96。背景を透明にして、紋章がちょうど収まるように切り取る
//   src/v2cap/lib/fxArtList.js  … 絵があるアイコンの一覧（画面はこれを見て、無いものは文字の枠で出す）
//   node tools/v2cap-fx-art.mjs          … 元の絵が新しくなったものだけ作る
//   node tools/v2cap-fx-art.mjs --force  … 全部作り直す
// 背景の扱いはモンスターの絵と同じ（tools/v2cap-enemy-art.mjs）：透明つきはその透明を使う／
//   背景つき（1色・AIが描き込んだチェック模様）は縁の色から見立てて抜く（tools/v2cap-art-lib.mjs の keyBackground）
// ★元の絵が無くても（別のPCなど）、作ってある WebP は消さない。一覧は「WebP があるもの」で作る
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeSquare, keyBackground, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { FX_ART_SRC_DIR, FX_ART_DIR, FX_ART_SIZE, FX_DEFS, fxIdOfFile } = await import(new URL('../src/v2cap/lib/battleFx.js', import.meta.url).href)
const SRC = path.join(ROOT, 'public', FX_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', FX_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'fxArtList.js')
const FORCE = process.argv.includes('--force')
mkdirSync(OUT, { recursive: true })

const WORK = 512          // 背景を抜く作業は長いほうの辺512pxで行う
const ALPHA_MIN = 0.5     // 縁のこれ以上が透明なら「透明つき」
const MARGIN = 0.06       // 切り取りの余白（紋章の大きいほうの辺に対する割合）
const QUALITY = 88
const EDGE_LEFT_MAX = 0.3 // 抜いたあと縁に残った絵の割合がこれを超えたら「背景が抜けていない」
const MODE_LABEL = { alpha:'透明つき', flat:'1色の背景', checker:'チェック模様の背景' }

const makeOne = (src, out) => {
  const info = probe(src)
  let r = null
  if (info.alpha) {
    const img = decode(src, Math.min(1024, Math.max(info.w, info.h)), 'rgba')
    if (transparentBorderRatio(img) >= ALPHA_MIN) {
      const border = borderOf(img.W, img.H)
      r = { img, mode: 'alpha', edgeLeft: border.filter(p => img.data[p * 4 + 3] > 128).length / border.length }
    }
  }
  if (!r) r = keyBackground(decode(src, WORK, 'rgb24'))
  bleed(r.img)
  const box = alphaBox(r.img)
  if (!box) throw new Error('紋章が見つからない（全部が背景の色）')
  encodeSquare(r.img, box, out, { size: FX_ART_SIZE, margin: MARGIN, quality: QUALITY })
  return r
}

const unmatched = [], dup = [], failed = [], notKeyed = []
const pick = new Map()   // id → 元の絵（同じものに2枚あれば新しいほう）
if (existsSync(SRC)) {
  for (const e of readdirSync(SRC, { withFileTypes: true })) {
    if (!e.isFile() || !/\.(png|jpe?g|webp)$/i.test(e.name)) continue
    const f = path.join(SRC, e.name)
    const id = fxIdOfFile(path.basename(e.name, path.extname(e.name)))
    if (!id) { unmatched.push(e.name); continue }
    const prev = pick.get(id)
    if (prev) { dup.push(`${id}：${path.basename(prev)} と ${e.name}`); if (statSync(prev).mtimeMs >= statSync(f).mtimeMs) continue }
    pick.set(id, f)
  }
}

let made = 0
for (const [id, src] of pick) {
  const out = path.join(OUT, `${id}.webp`)
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
  try {
    const { mode, edgeLeft } = makeOne(src, out)
    made++
    if (edgeLeft > EDGE_LEFT_MAX) notKeyed.push(`${path.basename(src)}（${MODE_LABEL[mode]}）：縁の${Math.round(edgeLeft * 100)}%が透明になっていない`)
    console.log(`${id} ← ${path.basename(src)}（${MODE_LABEL[mode]}）`)
  } catch (e) {
    failed.push(`${path.basename(src)}：${e.message}`)
  }
}

// ===== 一覧を書く（WebP があるものだけ・並びは FX_DEFS）=====
const have = FX_DEFS.filter(d => existsSync(path.join(OUT, `${d.id}.webp`)))
writeFileSync(LIST, `// tools/v2cap-fx-art.mjs が書くファイル（手で直さない）。絵があるアイコンの id → public/fx-art/<id>.webp
export const FX_ART_IDS = [
${have.map(d => `  '${d.id}',   // ${d.file}`).join('\n')}${have.length ? '\n' : ''}]
`)

console.log(`作った：${made}枚／絵があるアイコン：${have.length} / ${FX_DEFS.length}`)
const lack = FX_DEFS.filter(d => !have.includes(d))
if (lack.length) console.log(`  まだ：${lack.map(d => d.file).join('・')}`)
const warnList = (title, list) => { if (list.length) { console.log(title); for (const m of list) console.log(`  ${m}`) } }
warnList(`⚠ どのアイコンにも当てはまらない絵（ファイル名を ${FX_DEFS.map(d => d.file).slice(0, 3).join('・')}… のどれかにする）：`, unmatched)
warnList('⚠ 同じアイコンに2枚ある（新しいほうを使った）：', dup)
warnList('⚠ 背景が抜けていない絵（目で確かめる）：', notKeyed)
warnList('⚠ 作れなかった絵：', failed)
if (unmatched.length || failed.length || notKeyed.length) process.exitCode = 1
