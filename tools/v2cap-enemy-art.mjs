// ============================================================
// v2cap のモンスターのイラストを、画面で使う軽い版（背景を抜いた正方形の WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/エネミー/エリア<番号>/<モンスターの名前>.png（1254×1254。灰色の背景つき／透明な背景）
//   場所の顔ぶれにいない特別なモンスター（安息の祠のハピネスフェアリー）は public/エネミー/特別/<名前>.png（2026-10-13）
// 作るもの：
//   public/enemy-art/<id>.webp     … 192×192。背景を透明にして（下の「背景の扱い」）、体がちょうど収まるように切り取る
//   src/v2cap/lib/enemyArtList.js  … 絵があるモンスターの一覧（画面はこれを見て、無いものは代わりの枠を出す）
// 名前の読み方・別名・<id> の決め方は src/v2cap/lib/enemyArt.js
//   node tools/v2cap-enemy-art.mjs          … 元の絵が新しくなったものだけ作る
//   node tools/v2cap-enemy-art.mjs --force  … 全部作り直す（抜き方・切り取り方を変えたとき）
// 背景の扱い（1枚ずつ見分ける）：
//   ・透明つき（縁の半分以上が透明な PNG）… 抜かずに、その透明をそのまま使う（半透明のもや・光もそのまま）
//     【確定】2026-10-14 エリア③は20枚中17枚が透明つきだった。前は透明を捨てて灰色を抜いていたので、
//     半透明のもやが白い塊になり、縁に透明の下に隠れた色（赤など）がにじんでいた
//   ・背景つき … 縁の色から背景を見立てて抜く（tools/v2cap-art-lib.mjs の keyBackground）
//     灰色1色（エリア①②）／2色の灰色のチェック模様（AIが「透明」を絵として描き込んだもの・エリア③のコボルト・スケルトン）
//     ・縁からつながっていて背景の色に近いところを透明にする
//     ・体に囲まれたすき間（ヘビのとぐろの内側・脚のあいだ）も、大きくて背景のままなら透明にする
//       （毛並みの灰色・骨の白など1色だけのかたまりは残る）
//     ・透明にしたところの3pxまわりは、背景の色との近さで半透明にして背景の色を差し引く（縁ににじみを残さない）
//   ★抜いたあとも縁に体（不透明）が多く残ったら「背景が抜けていない」と知らせて、終わりのコードを1にする
// ★元の絵が無くても（別のPCなど）、作ってある WebP は消さない。一覧は「WebP があるもの」で作る
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeSquare, keyBackground, transparentBorderRatio, borderOf } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const lib = (f) => import(new URL(`../src/v2cap/lib/${f}`, import.meta.url).href)
const { ENEMY_ART_SRC_DIR, ENEMY_ART_DIR, ENEMY_ART_SIZE, ENEMY_NAMES_BY_AREA, SPECIAL_ENEMY_NAMES, SPECIAL_ART_DIR, ART_NAMES, enemyNameOfFile, enemyArtId } = await lib('enemyArt.js')
const { AREA_LIST } = await lib('areas.js')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', ENEMY_ART_DIR.replace(/^\//, ''))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'enemyArtList.js')
const FORCE = process.argv.includes('--force')
mkdirSync(OUT, { recursive: true })

// ===== 作り方の決まり =====
const WORK = 627          // 背景を抜く作業は長いほうの辺627px（元の半分）で行う
const ALPHA_MIN = 0.5     // 縁のこれ以上が透明なら「透明つき」
const MARGIN = 0.04       // 切り取りの余白（体の大きいほうの辺に対する割合）
const QUALITY = 82
const EDGE_LEFT_MAX = 0.3 // 抜いたあと縁に残った体の割合がこれを超えたら「背景が抜けていない」
const MODE_LABEL = { alpha:'透明つき', flat:'灰色の背景', checker:'チェック模様の背景' }

const makeOne = (src, out) => {
  const info = probe(src)
  let r = null
  if (info.alpha) {
    // 透明つき：元の大きさのまま読む（縮める前に、透明なところに隠れた色を埋めるため）
    const img = decode(src, Math.max(info.w, info.h), 'rgba')
    if (transparentBorderRatio(img) >= ALPHA_MIN) {
      const N = img.W * img.H
      let clear = 0
      for (let p = 0; p < N; p++) if (img.data[p * 4 + 3] === 0) clear++
      const border = borderOf(img.W, img.H)
      r = { img, mode: 'alpha', clear: clear / N, edgeLeft: border.filter(p => img.data[p * 4 + 3] > 128).length / border.length }
    }
  }
  if (!r) r = keyBackground(decode(src, WORK, 'rgb24'))
  // 透明なところの色を近くの体の色で埋める（縮めるときに背景の色が縁へ混ざらないように）
  bleed(r.img)
  const box = alphaBox(r.img)
  if (!box) throw new Error('体が見つからない（全部が背景の色）')
  encodeSquare(r.img, box, out, { size: ENEMY_ART_SIZE, margin: MARGIN, quality: QUALITY })
  return r
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

const unmatched = [], wrongArea = [], dup = [], failed = [], light = [], notKeyed = []
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
    const { clear, mode, edgeLeft } = makeOne(src, out)
    made++
    // 背景がほとんど抜けなかった絵（背景の色が違う・体が縁いっぱい）は知らせる
    if (clear < 0.15) light.push(`${name}（${path.relative(SRC, src)}）：透明にできたのは${Math.round(clear * 100)}%だけ`)
    if (edgeLeft > EDGE_LEFT_MAX) notKeyed.push(`${name}（${path.relative(SRC, src)}・${MODE_LABEL[mode]}）：縁の${Math.round(edgeLeft * 100)}%が透明になっていない`)
    console.log(`${name} ← ${path.relative(SRC, src)}（${MODE_LABEL[mode]}）`)
  } catch (e) {
    failed.push(`${name}（${path.relative(SRC, src)}）：${e.message}`)
  }
}

// ===== 一覧を書く（WebP があるものだけ）=====
const have = new Set(ART_NAMES.filter(n => existsSync(path.join(OUT, `${enemyArtId(n)}.webp`))))
const body = [...ENEMY_NAMES_BY_AREA, SPECIAL_ENEMY_NAMES].map((names, k) => {
  const rows = names.filter(n => have.has(n)).map(n => `  '${n}': '${enemyArtId(n)}',`)
  return rows.length ? [`  // ${AREA_LIST[k]?.name || SPECIAL_ART_DIR}`, ...rows].join('\n') : null
}).filter(Boolean).join('\n')
writeFileSync(LIST, `// tools/v2cap-enemy-art.mjs が書くファイル（手で直さない）。絵があるモンスターの名前 → public/enemy-art/<id>.webp
export const ENEMY_ART_IDS = {
${body ? `${body}\n` : ''}}
`)

// ===== 知らせ =====
const known = new Set(ART_NAMES.map(n => `${enemyArtId(n)}.webp`))
const orphans = readdirSync(OUT).filter(f => f.endsWith('.webp') && !known.has(f))
console.log(`作った：${made}枚／絵があるモンスター：${have.size} / ${ART_NAMES.length}体`)
ENEMY_NAMES_BY_AREA.forEach((names, k) => {
  const lack = names.filter(n => !have.has(n))
  if (lack.length === names.length) return
  console.log(`  エリア${k + 1} ${AREA_LIST[k].name}：${names.length - lack.length} / ${names.length}${lack.length ? `（まだ：${lack.join('・')}）` : ''}`)
})
{
  const lack = SPECIAL_ENEMY_NAMES.filter(n => !have.has(n))
  console.log(`  ${SPECIAL_ART_DIR}：${SPECIAL_ENEMY_NAMES.length - lack.length} / ${SPECIAL_ENEMY_NAMES.length}${lack.length ? `（まだ：${lack.join('・')}）` : ''}`)
}
const warnList = (title, list) => { if (list.length) { console.log(title); for (const m of list) console.log(`  ${m}`) } }
warnList('⚠ どのモンスターにも当てはまらない絵（enemyArt.js の ENEMY_ART_ALIAS に足す）：', unmatched)
warnList('⚠ 置いたフォルダと違うエリアのモンスターに当てはまった絵：', wrongArea)
warnList('⚠ 同じモンスターに2枚ある（新しいほうを使った）：', dup)
warnList('⚠ 背景があまり抜けなかった絵（目で確かめる）：', light)
warnList('⚠ 背景が抜けていない絵（縁に背景が残っている。目で確かめて、抜き方を直すか絵を差し替えてもらう）：', notKeyed)
warnList('⚠ 作れなかった絵：', failed)
warnList('⚠ どのモンスターのものでもない WebP（名前を変えた？）：', orphans)
if (unmatched.length || failed.length || notKeyed.length) process.exitCode = 1
