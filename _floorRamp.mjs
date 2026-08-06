// 層が上がるごとに敵の与ダメージを緩やかに上げる（5層以降）
// ============================================================
//  エンドポイントは振り切ると 与ダメ+25% / 被ダメ-25% / 最大HP+50% になり、
//  敵の数値を層ごとに上げないと上の層が素通りになる。
//  被ダメージ側の傾斜は tower.js の FLOOR_DMG_TAKEN に置いた。
//  こちらは与ダメージ側＝敵の攻撃力・特殊攻撃力に、層ごとの傾斜を焼き込む。
//
//  ⚠1〜4層は一般公開中なので触らない。傾斜は5層から。
//  ⚠焼き込みなので「データに書いてある数字＝実戦値」は保たれる。
//
//  使い方: node _floorRamp.mjs <1層あたりの伸び> [--apply]
//    例: node _floorRamp.mjs 0.03   （5層×1.03 … 10層×1.19）
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
const STEP = Number(process.argv.slice(2).filter(a => !a.startsWith('--'))[0] ?? 0.03)
const FROM = 5   // ここから傾斜を掛ける

let s = fs.readFileSync(P, 'utf8')
const head = s.indexOf('export const TOWER_FLOORS = [')
let depth = 0, end = -1
for (let i = s.indexOf('[', head); i < s.length; i++) {
  if (s[i] === '[') depth++
  else if (s[i] === ']') { depth--; if (depth === 0) { end = i; break } }
}
const body = s.slice(head, end + 1)

const starts = []
const reF = /floor: (\d+), boss:/g
let m
while ((m = reF.exec(body))) starts.push({ floor: Number(m[1]), at: m.index })

console.log(`1層あたり +${(STEP * 100).toFixed(0)}%（${FROM}層から・複利）`)
const out = []
let cursor = 0
for (let i = 0; i < starts.length; i++) {
  const f = starts[i].floor
  const bs = starts[i].at, be = starts[i + 1] ? starts[i + 1].at : body.length
  out.push(body.slice(cursor, bs))
  let block = body.slice(bs, be)
  cursor = be

  if (f < FROM) { out.push(block); continue }
  const k = Math.pow(1 + STEP, f - (FROM - 1))
  let n = 0
  block = block.replace(
    /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g,
    (whole, name, hp, atk, def, matk, mdef, spd) => {
      n++
      return `E('${name}', ${hp}, ${Math.round(+atk * k)}, ${def}, ${Math.round(+matk * k)}, ${mdef}, ${spd},`
    })
  console.log(`  ${String(f).padStart(2)}層  攻撃×${k.toFixed(3)}  （敵${n}体）`)
  out.push(block)
}
out.push(body.slice(cursor))
s = s.slice(0, head) + out.join('') + s.slice(end + 1)

if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else console.log('下見のみ（--apply で適用）')
