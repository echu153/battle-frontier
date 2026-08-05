// 1〜4層に残っている逆転を「弱いほうを上げる」だけで直す
// ============================================================
//  一般公開中の層なので、下げる方向の変更は一切しない。
//  エリアボスの攻撃・特殊攻撃だけを上げる。
//  HP・防御・特防・素早さ・雑魚・強敵は触らない。
//
//  直す逆転:
//    ① その層の雑魚の攻撃がエリアボスの攻撃を上回っている（3層1.23倍・4層1.12倍）
//    ② 前の層のボスより攻撃が低い（3層3,900＜2層5,850）
//  どちらも「ボスは戦闘力に乗らない強さ（会心・貫通・装備の特殊能力・スキル）を
//  持たないプレイヤー相手を想定した数字」になっていたのが原因なので、
//  5〜10層と同じ考え方でボス側を上げる。
//
//  使い方: node _buff14.mjs <雑魚がボスの何割まで> <前層からの最低の伸び> [--apply]
//    例: node _buff14.mjs 0.75 1.15 --apply   （5〜10層と同じ基準）
//        node _buff14.mjs 1.00 1.05           （逆転を消すだけの控えめな基準）
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
const nums = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number)
const MOB_CAP = nums[0] ?? 0.75
const STEP = nums[1] ?? 1.15

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

const RE_E = /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g
const totalOf = (e) => Math.floor(e.hp / 10 + e.atk + e.def + e.matk + e.mdef + e.spd)
const towerTarget = (f) => Math.round(20000 * Math.pow(1.2, f - 1))

console.log(`基準: 雑魚の攻撃はボスの${MOB_CAP}倍まで／前の層のボスより${STEP}倍以上\n`)
console.log('層  ボス名                 攻撃(前→後)        特攻(前→後)       総合力(前→後)      推奨力比')

const out = []
let cursor = 0
let prevOff = 0
for (let i = 0; i < starts.length; i++) {
  const f = starts[i].floor
  const bs = starts[i].at, be = starts[i + 1] ? starts[i + 1].at : body.length
  out.push(body.slice(cursor, bs))
  let block = body.slice(bs, be)
  cursor = be

  const midAt = block.indexOf('midBoss:')
  const ents = []
  RE_E.lastIndex = 0
  let mm
  while ((mm = RE_E.exec(block))) ents.push({
    whole: mm[0], at: mm.index, name: mm[1],
    hp: +mm[2], atk: +mm[3], def: +mm[4], matk: +mm[5], mdef: +mm[6], spd: +mm[7],
  })
  const after = ents.filter(e => e.at >= midAt)
  const boss = after[1]
  const mobs = ents.filter(e => e.at < midAt)
  const mobMax = Math.max(...mobs.map(e => Math.max(e.atk, e.matk)))
  const off = Math.max(boss.atk, boss.matk)

  if (f > 4) { out.push(block); prevOff = off; continue }   // 5層以降は組み直し済み

  // ①雑魚を上回る ②前の層のボスを上回る。上げるだけで、下げはしない
  const wantOff = Math.max(off, Math.ceil(mobMax / MOB_CAP), Math.ceil(prevOff * STEP))
  const k = wantOff / off
  const nb = { ...boss, atk: Math.round(boss.atk * k), matk: Math.round(boss.matk * k) }
  prevOff = Math.max(nb.atk, nb.matk)

  console.log(
    String(f).padStart(2), boss.name.padEnd(22),
    `${String(boss.atk).padStart(6)}→${String(nb.atk).padStart(6)}`.padEnd(18),
    `${String(boss.matk).padStart(6)}→${String(nb.matk).padStart(6)}`.padEnd(17),
    `${String(totalOf(boss)).padStart(6)}→${String(totalOf(nb)).padStart(6)}`.padEnd(18),
    `${(totalOf(boss) / towerTarget(f)).toFixed(2)}→${(totalOf(nb) / towerTarget(f)).toFixed(2)}`)

  block = block.replace(boss.whole,
    `E('${nb.name}', ${nb.hp}, ${nb.atk}, ${nb.def}, ${nb.matk}, ${nb.mdef}, ${nb.spd},`)
  out.push(block)
}
out.push(body.slice(cursor))
s = s.slice(0, head) + out.join('') + s.slice(end + 1)

if (APPLY) { fs.writeFileSync(P, s); console.log('\n適用した') }
else console.log('\n下見のみ（--apply で適用）')
