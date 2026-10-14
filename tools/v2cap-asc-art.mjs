// ============================================================
// v2cap アセンションの盤面の絵を、画面で使う軽い版（WebP）にする
// ------------------------------------------------------------
// 【確定】2026-10-14 ユーザー「見た目AION２みたいにしたいからしっかり画像作ろうと思う」→ こちらから出したリストで作ってもらった（設計 §4-2）
// 元の絵（ユーザーが置く・git に入れない＝.gitignore）：public/アセンション/<名前>.png（1254×1254）
//   ステ8枚 HP・MP・STR・DEX・AGI・INT・VIT・LUK（STR は「SRT」でも読む）／スキル（丸い枠）／大枠（大マスのひし形の枠）／起点／背景
//   ★背景は、名前に「背景」が入った絵のうち**いちばん新しいもの**（2026-10-14 ユーザーが暗い石板の「アセンション背景２.png」を足した。
//     前の星図の「背景.png」は置いたまま＝描き直したら新しい名前で置けばよい。前のに戻すときは、新しい方を消すか名前を変える）
// 作るもの：
//   public/asc-art/<key>.webp   … ステ・スキル 256px／大枠・起点 384px（透明つき・見えている所がちょうど収まる正方形）／背景 1600px まで（透明なし・元の絵より大きくはしない）
//     ★2026-10-14 盤面を拡大できるようにしたので大きめに（前は 160／256／1280。いちばん大きくすると1マスが200px台になる）
//   src/v2cap/lib/ascArtList.js … 絵がある key と中身の印（画面はこれを見て、無いものは図形で描く・印は URL の ?v= ＝絵を替えたら読み直させる）
//   node tools/v2cap-asc-art.mjs          … 元の絵が新しくなったものだけ作る
//   node tools/v2cap-asc-art.mjs --force  … 全部作り直す
// ★ステ8枚は同じ切り取り（8枚の見えている範囲を合わせた枠）にする＝どのステも同じ大きさに見える
// ★元の絵が無くても（別のPCなど）、作ってある WebP は消さない。一覧は「WebP があるもの」で作る
// ★ffmpeg（libwebp）を使う（tools/v2cap-art-lib.mjs）
// ============================================================
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { probe, decode, bleed, alphaBox, encodeSquare } from './v2cap-art-lib.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = path.join(ROOT, 'public', 'アセンション')
const OUT = path.join(ROOT, 'public', 'asc-art')
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'ascArtList.js')
const FORCE = process.argv.includes('--force')
mkdirSync(OUT, { recursive: true })

// key → 元の絵の名前（拡張子なし・どれか1つ）・大きさ
export const STAT_KEYS_ART = ['hp', 'mp', 'str', 'dex', 'agi', 'int_stat', 'vit', 'luk']
const PARTS = {
  hp: { names: ['HP'], size: 256 },
  mp: { names: ['MP'], size: 256 },
  str: { names: ['STR', 'SRT'], size: 256 },   // ★ユーザーの絵は「SRT.png」（2026-10-14）
  dex: { names: ['DEX'], size: 256 },
  agi: { names: ['AGI'], size: 256 },
  int_stat: { names: ['INT'], size: 256 },
  vit: { names: ['VIT'], size: 256 },
  luk: { names: ['LUK'], size: 256 },
  skill: { names: ['スキル'], size: 256 },
  big: { names: ['大枠', '大マス'], size: 384 },
  start: { names: ['起点'], size: 384 },
  bg: { names: ['背景'], size: 1600, opaque: true, newest: true },   // newest＝名前に入っていればよい・いちばん新しいもの
}
const MARGIN = 0.02
const QUALITY = 84
const BG_QUALITY = 78

// 元の絵を探す（大文字・小文字、全角・半角の違いは気にしない）
const norm = (s) => s.normalize('NFKC').toUpperCase()
const files = existsSync(SRC) ? readdirSync(SRC).filter(f => /\.(png|webp|jpe?g)$/i.test(f)) : []
const has = (f, n) => norm(path.parse(f).name).includes(norm(n))
const srcOf = (key) => {
  if (PARTS[key].newest) {
    const list = files.filter(f => PARTS[key].names.some(n => has(f, n)))
      .sort((a, b) => statSync(path.join(SRC, b)).mtimeMs - statSync(path.join(SRC, a)).mtimeMs)
    return list.length ? path.join(SRC, list[0]) : null
  }
  for (const n of PARTS[key].names) {
    const f = files.find(x => norm(path.parse(x).name) === norm(n))
    if (f) return path.join(SRC, f)
  }
  return null
}
const outOf = (key) => path.join(OUT, `${key}.webp`)
const stale = (src, out) => FORCE || !existsSync(out) || statSync(src).mtimeMs > statSync(out).mtimeMs

// 透明つきの絵を読む（元の大きさ・透明なところの色を埋めてから縮める＝縁ににじまない）
const readRgba = (src) => {
  const info = probe(src)
  if (!info.alpha) throw new Error(`${path.basename(src)} に透明がありません（背景以外は透明つきの PNG）`)
  const img = decode(src, Math.max(info.w, info.h), 'rgba')
  bleed(img)
  return img
}

let made = 0
const unknown = files.filter(f => !Object.keys(PARTS).some(k => PARTS[k].names.some(n => (PARTS[k].newest ? has(f, n) : norm(n) === norm(path.parse(f).name)))))
for (const f of unknown) console.log(`⚠ 当てはまらない絵：${f}（名前を PARTS に足すか、ファイルの名前を直す）`)

// ステ8枚：同じ切り取り
const statSrc = STAT_KEYS_ART.map(k => [k, srcOf(k)]).filter(([, s]) => s)
if (statSrc.some(([k, s]) => stale(s, outOf(k)))) {
  const imgs = statSrc.map(([k, s]) => [k, readRgba(s)])
  const boxes = imgs.map(([, img]) => alphaBox(img, 16)).filter(Boolean)
  const box = { x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)), x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)) }
  for (const [k, img] of imgs) {
    encodeSquare(img, box, outOf(k), { size: PARTS[k].size, margin: MARGIN, quality: QUALITY })
    console.log(`${k}：${path.basename(srcOf(k))} → asc-art/${k}.webp`)
    made++
  }
}
// ほか
for (const key of ['skill', 'big', 'start', 'bg']) {
  const s = srcOf(key)
  if (!s || !stale(s, outOf(key))) continue
  if (PARTS[key].opaque) {
    const side = Math.min(PARTS[key].size, probe(s).w)   // 元の絵より大きくはしない
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', s, '-vf', `scale=${side}:${side}:flags=lanczos`,
      '-c:v', 'libwebp', '-quality', String(BG_QUALITY), '-frames:v', '1', outOf(key)])
  } else {
    const img = readRgba(s)
    encodeSquare(img, alphaBox(img, 16), outOf(key), { size: PARTS[key].size, margin: MARGIN, quality: QUALITY })
  }
  console.log(`${key}：${path.basename(s)} → asc-art/${key}.webp`)
  made++
}
for (const k of Object.keys(PARTS)) if (!srcOf(k) && !existsSync(outOf(k))) console.log(`（${PARTS[k].names[0]} の絵はまだありません＝図形で描く）`)

// 一覧（WebP があるもの）。印＝中身の sha1 の先頭8文字
const list = Object.fromEntries(Object.keys(PARTS).filter(k => existsSync(outOf(k)))
  .map(k => [k, createHash('sha1').update(readFileSync(outOf(k))).digest('hex').slice(0, 8)]))
const text = [
  '// ★tools/v2cap-asc-art.mjs が作ったファイル（手で書き換えない）。アセンションの盤面の絵がある key と中身の印（URL の ?v=）',
  '// 絵は public/asc-art/<key>.webp。ここに無い key は、画面（V2capAscension.jsx）が図形で描く',
  `export const ASC_ART = ${JSON.stringify(list, null, 2).replace(/"([a-z_]+)":/g, '$1:').replace(/"/g, "'")}`,
  '',
].join('\n')
const prev = existsSync(LIST) ? readFileSync(LIST, 'utf8').replace(/\r\n/g, '\n') : ''
if (prev !== text) writeFileSync(LIST, text)
console.log(`作った絵 ${made} 枚・一覧 ${Object.keys(list).length} 種（${prev === text ? '変わらず' : '書き直した'}）`)
