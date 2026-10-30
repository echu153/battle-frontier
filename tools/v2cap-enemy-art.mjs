// ============================================================
// v2cap のモンスターのイラストを、画面で使う軽い版（背景を抜いた正方形の WebP）にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く）：public/エネミー/エリア<番号>/<モンスターの名前>.png（1254×1254。灰色の背景つき／透明な背景）
//   エリア⑤から先は頭に番号つき「05-01_砂喰いワーム.png」（エリア-一覧の何体目・2026-10-26）。番号は外して名前で読み、
//   番号が指すモンスターと名前が違えば知らせる（終わりのコード1）
//   場所の顔ぶれにいない特別なモンスター（安息の祠のハピネスフェアリー）は public/エネミー/特別/<名前>.png（2026-10-13）
//   ★public/エネミー/IDダンジョン/ はダンジョンのボスのドット絵とイラスト＝tools/v2cap-boss-art.mjs が読む（ここでは読まない・2026-10-28）
// 作るもの：
//   public/enemy-art/<id>.webp     … 192×192。背景を透明にして（下の「背景の扱い」）、体がちょうど収まるように切り取る
//   public/enemy-art-big/<id>.webp … 512×512（同じ切り取り）。図鑑で絵をタップしたときの大きい版（2026-10-24）
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
const { ENEMY_ART_SRC_DIR, ENEMY_ART_DIR, ENEMY_ART_SIZE, ENEMY_ART_BIG_DIR, ENEMY_ART_BIG_SIZE, ENEMY_NAMES_BY_AREA, SPECIAL_ENEMY_NAMES, SPECIAL_ART_DIR, ART_NAMES, enemyNameOfFile, enemyNameOfFileNo, enemyArtId } = await lib('enemyArt.js')
const { AREA_LIST } = await lib('areas.js')
const { BOSS_ART_SRC_DIR } = await lib('bossArt.js')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', ENEMY_ART_DIR.replace(/^\//, ''))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'enemyArtList.js')
const FORCE = process.argv.includes('--force')
const OUT_BIG = path.join(ROOT, 'public', ENEMY_ART_BIG_DIR.slice(1))
mkdirSync(OUT, { recursive: true })
mkdirSync(OUT_BIG, { recursive: true })

// ===== 作り方の決まり =====
const WORK = 627          // 背景を抜く作業は長いほうの辺627px（元の半分）で行う
const ALPHA_MIN = 0.5     // 縁のこれ以上が透明なら「透明つき」
const MARGIN = 0.04       // 切り取りの余白（体の大きいほうの辺に対する割合）
const QUALITY = 82
const EDGE_LEFT_MAX = 0.3 // 抜いたあと縁に残った体の割合がこれを超えたら「背景が抜けていない」
const MODE_LABEL = { alpha:'透明つき', flat:'灰色の背景', checker:'チェック模様の背景' }
// 体に囲まれた背景を「ゆるい条件」でも抜く絵（tools/v2cap-art-lib.mjs の KEY.POCKET_LOOSE_*）
// 【確定】2026-10-26 煙・砂・炎の渦や半透明の残像に囲まれた背景の灰色が残っていた絵。新しく抜ける場所を赤く塗って、
//   どれも背景だけ（体は削らない）と目で確かめたものだけ。⚠確かめずに足さない（海賊砲手は灰色のズボンまで抜けるので入れない）。
//   足したら、その絵の WebP を消して作り直す（元の絵より新しい WebP は作り直されない）
const LOOSE_POCKETS = new Set([
  'カゲロウトカゲ', 'ミラージュリザード', 'フレイムアヌビス', 'ルナジャッカル', '砂地獄アントリオン', '砂皇スカラベウス',   // エリア⑤
  '払暁のワイバーン', 'ハヤテハヤブサ', '宵闇ヤマネコ', 'トオボエウルフ', 'ストームグリフォン', 'ドーンワイバーン',       // エリア⑥
  'ブレイズゴリラ', '岩砕きグリズリー',
])
// 【確定】2026-10-30 エリア⑦⑧：霧・鱗粉・渦に囲まれた背景の灰色が、上の条件でも残った絵（小さくて、霧のふちのむらが大きいすき間）。
//   条件を絵ごとに広げる（tools/v2cap-art-lib.mjs の opts.softPockets）。新しく抜ける場所を赤く塗って、どれも背景だけと目で確かめたものだけ。
//   ⚠確かめずに足さない：シャドウウルフは脇腹の灰色の毛、氷河ドレイクは灰色のウロコまで抜けるので入れない。
//   胞子マイコニドだけは、胞子の雲のふちのにじみ（灰色がかった所）も抜く（haze）
const SOFT = { min: 60, mean: 14, std: 9 }
const SOFT_POCKETS = new Map([
  ...['オオドクガ', 'シメコロシカズラ', '霧纏いトレント', 'コモレビピクシー', 'ヨロイカブト', 'ナゲキバンシー', 'チスイオオコウモリ', 'キラープラント',
    'クイーンマンドラゴラ', 'ミストトレント', 'サンライトピクシー', 'グリーフバンシー', '妖蛾ポイズンモス', '霧魔女ミルヴァ', '森王エルダートレント',   // エリア⑦
    '霜精', 'アイスゴーレム',   // エリア⑧
  ].map(n => [n, SOFT]),
  ['胞子マイコニド', { ...SOFT, haze: { sat: 18, lum: 24 } }],
])
for (const n of [...LOOSE_POCKETS, ...SOFT_POCKETS.keys()]) if (!ART_NAMES.includes(n)) throw new Error(`LOOSE_POCKETS・SOFT_POCKETS の ${n} はモンスターの一覧にいない`)

// outs = [{ out, size }]（小さい版・大きい版のうち作るもの）
const makeOne = (src, outs, name) => {
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
  if (!r) r = keyBackground(decode(src, WORK, 'rgb24'), undefined, { loosePockets: LOOSE_POCKETS.has(name), softPockets: SOFT_POCKETS.get(name) })
  // 透明なところの色を近くの体の色で埋める（縮めるときに背景の色が縁へ混ざらないように）
  bleed(r.img)
  const box = alphaBox(r.img)
  if (!box) throw new Error('体が見つからない（全部が背景の色）')
  for (const { out, size } of outs) encodeSquare(r.img, box, out, { size, margin: MARGIN, quality: QUALITY })
  return r
}

// ===== 元の絵を集める =====
const files = []
const walk = (dir) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (dir !== SRC || e.name !== BOSS_ART_SRC_DIR) walk(p) }
    else if (/\.(png|jpe?g|webp)$/i.test(e.name)) files.push(p)
  }
}
walk(SRC)
const areaNoOfDir = (file) => {
  const m = path.relative(SRC, path.dirname(file)).normalize('NFKC').match(/(\d+)/)
  return m ? Number(m[1]) : null
}
const areaNoOfName = new Map(ENEMY_NAMES_BY_AREA.flatMap((names, k) => names.map(n => [n, k + 1])))

const unmatched = [], wrongArea = [], wrongNo = [], dup = [], failed = [], light = [], notKeyed = []
const pick = new Map()   // 名前 → 元の絵（同じ名前に2枚あれば新しいほう）
for (const f of files) {
  const stem = path.basename(f, path.extname(f))
  const name = enemyNameOfFile(stem)
  const byNo = enemyNameOfFileNo(stem)   // 頭の番号「05-01_」が指すモンスター（2026-10-26〜）
  const rel = path.relative(SRC, f)
  // 名前が読めないときは、番号が指すモンスターを手がかりに出す（別名にする前に絵を見て確かめる）
  if (!name) { unmatched.push(byNo ? `${rel}（番号どおりなら ${byNo}）` : rel); continue }
  if (byNo && byNo !== name) wrongNo.push(`${rel} → 名前は ${name}・番号は ${byNo}`)
  const dirNo = areaNoOfDir(f)
  if (dirNo && dirNo !== areaNoOfName.get(name)) wrongArea.push(`${rel} → ${name}（エリア${areaNoOfName.get(name)}のモンスター）`)
  const prev = pick.get(name)
  if (prev) { dup.push(`${name}：${path.relative(SRC, prev)} と ${rel}`); if (statSync(prev).mtimeMs >= statSync(f).mtimeMs) continue }
  pick.set(name, f)
}

let made = 0
for (const [name, src] of pick) {
  const out = path.join(OUT, `${enemyArtId(name)}.webp`)
  const outBig = path.join(OUT_BIG, `${enemyArtId(name)}.webp`)
  const fresh = (f) => !FORCE && existsSync(f) && statSync(f).mtimeMs >= statSync(src).mtimeMs
  const outs = [!fresh(out) && { out, size: ENEMY_ART_SIZE }, !fresh(outBig) && { out: outBig, size: ENEMY_ART_BIG_SIZE }].filter(Boolean)
  if (!outs.length) continue
  try {
    const { clear, mode, edgeLeft } = makeOne(src, outs, name)
    made++
    // 背景がほとんど抜けなかった絵（背景の色が違う・体が縁いっぱい）は知らせる
    if (clear < 0.15) light.push(`${name}（${path.relative(SRC, src)}）：透明にできたのは${Math.round(clear * 100)}%だけ`)
    if (edgeLeft > EDGE_LEFT_MAX) notKeyed.push(`${name}（${path.relative(SRC, src)}・${MODE_LABEL[mode]}）：縁の${Math.round(edgeLeft * 100)}%が透明になっていない`)
    console.log(`${name} ← ${path.relative(SRC, src)}（${MODE_LABEL[mode]}${mode === 'flat' && (LOOSE_POCKETS.has(name) || SOFT_POCKETS.has(name)) ? '・ゆるいすき間' : ''}）`)
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
const orphans = [...readdirSync(OUT), ...readdirSync(OUT_BIG)].filter(f => f.endsWith('.webp') && !known.has(f))
// 小さい版はあるのに大きい版が無い（元の絵がこのPCに無い）＝図鑑のタップは小さい版を広げて出す
const noBig = [...have].filter(n => !existsSync(path.join(OUT_BIG, `${enemyArtId(n)}.webp`)))
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
warnList('⚠ 頭の番号と名前が別のモンスターを指している絵（名前のほうで作った。絵を見てどちらか確かめる）：', wrongNo)
warnList('⚠ 同じモンスターに2枚ある（新しいほうを使った）：', dup)
warnList('⚠ 背景があまり抜けなかった絵（目で確かめる）：', light)
warnList('⚠ 背景が抜けていない絵（縁に背景が残っている。目で確かめて、抜き方を直すか絵を差し替えてもらう）：', notKeyed)
warnList('⚠ 作れなかった絵：', failed)
warnList('⚠ どのモンスターのものでもない WebP（名前を変えた？）：', orphans)
warnList('⚠ 大きい版（enemy-art-big）が無い（元の絵を置いて作り直す）：', noBig)
if (unmatched.length || failed.length || notKeyed.length || wrongNo.length) process.exitCode = 1
