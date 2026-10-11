// ============================================================
// v2cap のモンスターのイラストを、画面で使う軽い版（背景を抜いた正方形の WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/エネミー/エリア<番号>/<モンスターの名前>.png（灰色の背景つき・1254×1254）
// 作るもの：
//   public/enemy-art/<id>.webp     … 192×192。灰色の背景を抜き、体がちょうど収まるように切り取る
//   src/v2cap/lib/enemyArtList.js  … 絵があるモンスターの一覧（画面はこれを見て、無いものは代わりの枠を出す）
// 名前の読み方・別名・<id> の決め方は src/v2cap/lib/enemyArt.js
//   node tools/v2cap-enemy-art.mjs          … 元の絵が新しくなったものだけ作る
//   node tools/v2cap-enemy-art.mjs --force  … 全部作り直す（抜き方・切り取り方を変えたとき）
// 背景の抜き方：
//   ・縁の色のまんなか（中央値）を背景の色とし、縁からつながっていて背景の色に近いところを透明にする
//   ・体に囲まれたすき間（ヘビのとぐろの内側・脚のあいだ）も、かたまりが大きく色がほぼ背景のままなら透明にする
//     （毛並みの灰色はまだらで小さいかたまりにしかならないので残る）
//   ・透明にしたところの3pxまわりは、背景の色との近さで半透明にして灰色を差し引く（縁に灰色のにじみを残さない）
// ★元の絵が無くても（別のPCなど）、作ってある WebP は消さない。一覧は「WebP があるもの」で作る
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { each4 as each4WH, decode, bleed, alphaBox, encodeSquare } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const lib = (f) => import(new URL(`../src/v2cap/lib/${f}`, import.meta.url).href)
const { ENEMY_ART_SRC_DIR, ENEMY_ART_DIR, ENEMY_ART_SIZE, ENEMY_NAMES_BY_AREA, ENEMY_NAMES, enemyNameOfFile, enemyArtId } = await lib('enemyArt.js')
const { AREA_LIST } = await lib('areas.js')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', ENEMY_ART_DIR.replace(/^\//, ''))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'enemyArtList.js')
const FORCE = process.argv.includes('--force')
mkdirSync(OUT, { recursive: true })

// ===== 抜き方の決まり（作業は長いほうの辺627px＝元の半分で行う）=====
const WORK = 627
const T_IN = 14      // 背景の色からこれ以内（RGBのいちばん大きい差）なら背景
const T_OUT = 40     // 縁の近くでこれ以上離れていれば体（あいだは半透明）
const BAND = 3       // 半透明にする幅（px）
const POCKET_MIN = 25, POCKET_MEAN = 6   // 囲まれたすき間を抜く条件：25px以上で、背景の色との差の平均が6以下
const MARGIN = 0.04  // 切り取りの余白（体の大きいほうの辺に対する割合）
const QUALITY = 82

const keyOut = ({ data: rgb, W, H }) => {
  const N = W * H
  const border = []
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x)
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1)
  const bg = [0, 1, 2].map(c => { const v = border.map(p => rgb[p * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1] })
  const dist = new Float32Array(N)
  for (let p = 0; p < N; p++) {
    dist[p] = Math.max(Math.abs(rgb[p * 3] - bg[0]), Math.abs(rgb[p * 3 + 1] - bg[1]), Math.abs(rgb[p * 3 + 2] - bg[2]))
  }
  const each4 = (p, fn) => each4WH(W, H, p, fn)
  // 縁からつながる背景（lay 0）
  const lay = new Int16Array(N).fill(-1)
  const core = []
  for (const p of border) if (lay[p] < 0 && dist[p] <= T_IN) { lay[p] = 0; core.push(p) }
  for (let h = 0; h < core.length; h++) each4(core[h], r => { if (lay[r] < 0 && dist[r] <= T_IN) { lay[r] = 0; core.push(r) } })
  // 囲まれたすき間
  const seen = new Uint8Array(N)
  for (let s = 0; s < N; s++) {
    if (seen[s] || lay[s] >= 0 || dist[s] > T_IN) continue
    const blob = [s]; seen[s] = 1; let sum = 0
    for (let h = 0; h < blob.length; h++) { sum += dist[blob[h]]; each4(blob[h], r => { if (!seen[r] && lay[r] < 0 && dist[r] <= T_IN) { seen[r] = 1; blob.push(r) } }) }
    if (blob.length >= POCKET_MIN && sum / blob.length <= POCKET_MEAN) for (const p of blob) { lay[p] = 0; core.push(p) }
  }
  // 背景のまわり BAND px（lay 1..BAND）
  let front = core
  for (let b = 1; b <= BAND; b++) { const next = []; for (const p of front) each4(p, r => { if (lay[r] < 0) { lay[r] = b; next.push(r) } }); front = next }
  const rgba = Buffer.alloc(N * 4)
  for (let p = 0; p < N; p++) {
    const a = lay[p] === 0 ? 0 : lay[p] > 0 ? Math.min(1, Math.max(0, (dist[p] - T_IN) / (T_OUT - T_IN))) : 1
    for (let c = 0; c < 3; c++) {
      let v = rgb[p * 3 + c]
      if (a > 0 && a < 1) v = bg[c] + (v - bg[c]) / a   // 混ざった灰色を差し引く
      rgba[p * 4 + c] = Math.max(0, Math.min(255, Math.round(v)))
    }
    rgba[p * 4 + 3] = Math.round(a * 255)
  }
  // 透明なところの色を近くの体の色で埋める（縮めるときに灰色が縁へ混ざらないように）
  const img = { data: rgba, W, H }
  bleed(img)
  return { img, box: alphaBox(img), clear: core.length / N }
}

const makeOne = (src, out) => {
  const { img, box, clear } = keyOut(decode(src, WORK, 'rgb24'))
  if (!box) throw new Error('体が見つからない（全部が背景の色）')
  encodeSquare(img, box, out, { size: ENEMY_ART_SIZE, margin: MARGIN, quality: QUALITY })
  return clear
}

// ===== 元の絵を集める =====
const files = []
const walk = (dir) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(png|jpe?g|webp)$/i.test(e.name)) files.push(p)
  }
}
walk(SRC)
const areaNoOfDir = (file) => {
  const m = path.relative(SRC, path.dirname(file)).normalize('NFKC').match(/(\d+)/)
  return m ? Number(m[1]) : null
}
const areaNoOfName = new Map(ENEMY_NAMES_BY_AREA.flatMap((names, k) => names.map(n => [n, k + 1])))

const unmatched = [], wrongArea = [], dup = [], failed = [], light = []
const pick = new Map()   // 名前 → 元の絵（同じ名前に2枚あれば新しいほう）
for (const f of files) {
  const name = enemyNameOfFile(path.basename(f, path.extname(f)))
  const rel = path.relative(SRC, f)
  if (!name) { unmatched.push(rel); continue }
  const dirNo = areaNoOfDir(f)
  if (dirNo && dirNo !== areaNoOfName.get(name)) wrongArea.push(`${rel} → ${name}（エリア${areaNoOfName.get(name)}のモンスター）`)
  const prev = pick.get(name)
  if (prev) { dup.push(`${name}：${path.relative(SRC, prev)} と ${rel}`); if (statSync(prev).mtimeMs >= statSync(f).mtimeMs) continue }
  pick.set(name, f)
}

let made = 0
for (const [name, src] of pick) {
  const out = path.join(OUT, `${enemyArtId(name)}.webp`)
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
  try {
    const clear = makeOne(src, out)
    made++
    // 背景がほとんど抜けなかった絵（背景の色が違う・体が縁いっぱい）は知らせる
    if (clear < 0.15) light.push(`${name}（${path.relative(SRC, src)}）：透明にできたのは${Math.round(clear * 100)}%だけ`)
    console.log(`${name} ← ${path.relative(SRC, src)}`)
  } catch (e) {
    failed.push(`${name}（${path.relative(SRC, src)}）：${e.message}`)
  }
}

// ===== 一覧を書く（WebP があるものだけ）=====
const have = new Set(ENEMY_NAMES.filter(n => existsSync(path.join(OUT, `${enemyArtId(n)}.webp`))))
const body = ENEMY_NAMES_BY_AREA.map((names, k) => {
  const rows = names.filter(n => have.has(n)).map(n => `  '${n}': '${enemyArtId(n)}',`)
  return rows.length ? [`  // ${AREA_LIST[k].name}`, ...rows].join('\n') : null
}).filter(Boolean).join('\n')
writeFileSync(LIST, `// tools/v2cap-enemy-art.mjs が書くファイル（手で直さない）。絵があるモンスターの名前 → public/enemy-art/<id>.webp
export const ENEMY_ART_IDS = {
${body ? `${body}\n` : ''}}
`)

// ===== 知らせ =====
const known = new Set(ENEMY_NAMES.map(n => `${enemyArtId(n)}.webp`))
const orphans = readdirSync(OUT).filter(f => f.endsWith('.webp') && !known.has(f))
console.log(`作った：${made}枚／絵があるモンスター：${have.size} / ${ENEMY_NAMES.length}体`)
ENEMY_NAMES_BY_AREA.forEach((names, k) => {
  const lack = names.filter(n => !have.has(n))
  if (lack.length === names.length) return
  console.log(`  エリア${k + 1} ${AREA_LIST[k].name}：${names.length - lack.length} / ${names.length}${lack.length ? `（まだ：${lack.join('・')}）` : ''}`)
})
const warnList = (title, list) => { if (list.length) { console.log(title); for (const m of list) console.log(`  ${m}`) } }
warnList('⚠ どのモンスターにも当てはまらない絵（enemyArt.js の ENEMY_ART_ALIAS に足す）：', unmatched)
warnList('⚠ 置いたフォルダと違うエリアのモンスターに当てはまった絵：', wrongArea)
warnList('⚠ 同じモンスターに2枚ある（新しいほうを使った）：', dup)
warnList('⚠ 背景があまり抜けなかった絵（目で確かめる）：', light)
warnList('⚠ 作れなかった絵：', failed)
warnList('⚠ どのモンスターのものでもない WebP（名前を変えた？）：', orphans)
if (unmatched.length || failed.length) process.exitCode = 1
