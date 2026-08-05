// 5〜10層の敵を「総合力＝内部推奨力×K」で組み直す
// ============================================================
//  ・1〜4層は一般公開中なので一切触らない
//  ・HPも含めて6ステータスを一律に伸縮させる（敵ごとの「形」を変えない）
//    HPだけ据え置くと伸びが5ステに全部寄って、10層ボスの攻撃が2.7倍に跳ねるなど
//    敵の性格が変わってしまう。ターン上限（ボス戦100・道中60）を超えると負け扱いなので、
//    HPを伸ばしても持久型が勝ち逃げできる構造にはならない。
//  ・エリアボスがその層で一番強いこと（雑魚の攻撃がボスを超えない）を保証する
//  ・技の倍率は触らない（焼き込み済みで、そのまま実戦値）
//
//  使い方: node _rescale.mjs <5層K> <6層K> ... <10層K> [--apply]
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
const Ks = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number)
if (Ks.length !== 6) { console.error('5〜10層ぶんのKを6つ渡してください'); process.exit(1) }
const K = {}; for (let i = 0; i < 6; i++) K[5 + i] = Ks[i]

const MID_RATIO = 0.70     // 強敵の総合力＝ボスの何割か
const MOB_RATIO = 0.45     // 雑魚1体の総合力＝ボスの何割か
const MOB_ATK_CAP = 0.75   // 雑魚の攻撃はボスの攻撃の何割までか（ボスが一番強い、を守る）

const towerTarget = (f) => Math.round(20000 * Math.pow(1.2, f - 1))

let s = fs.readFileSync(P, 'utf8')
const head = s.indexOf('export const TOWER_FLOORS = [')
let depth = 0, end = -1
for (let i = s.indexOf('[', head); i < s.length; i++) {
  if (s[i] === '[') depth++
  else if (s[i] === ']') { depth--; if (depth === 0) { end = i; break } }
}
const body = s.slice(head, end + 1)

// 層ブロックに切る
const starts = []
const re = /floor: (\d+), boss:/g
let m
while ((m = re.exec(body))) starts.push({ floor: Number(m[1]), at: m.index })

// E(...) を1件ずつ拾う（名前・6ステ・種別）
const RE_E = /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g
const totalOf = (e) => Math.floor(e.hp / 10 + e.atk + e.def + e.matk + e.mdef + e.spd)
const nonHp = (e) => e.atk + e.def + e.matk + e.mdef + e.spd

console.log('層  役割     名前                     総合力            攻撃              特攻')
const out = []
let cursor = 0
for (let i = 0; i < starts.length; i++) {
  const f = starts[i].floor
  const bs = starts[i].at, be = starts[i + 1] ? starts[i + 1].at : body.length
  out.push(body.slice(cursor, bs))
  let block = body.slice(bs, be)
  cursor = be
  if (!K[f]) { out.push(block); continue }   // 1〜4層は素通し

  const midAt = block.indexOf('midBoss:')
  // まず現状を読む
  const ents = []
  let mm
  RE_E.lastIndex = 0
  while ((mm = RE_E.exec(block))) {
    ents.push({
      whole: mm[0], at: mm.index, name: mm[1],
      hp: +mm[2], atk: +mm[3], def: +mm[4], matk: +mm[5], mdef: +mm[6], spd: +mm[7],
      role: mm.index >= midAt ? (mm.index === ents.filter(x => x.at >= midAt).length && false ? 'mid' : null) : 'mob',
    })
  }
  // 役割を確定（midBoss より後の1体目=強敵、2体目=エリアボス）
  const after = ents.filter(e => e.at >= midAt)
  after[0].role = 'mid'; after[1].role = 'boss'
  for (const e of ents) if (!e.role) e.role = 'mob'

  const boss = ents.find(e => e.role === 'boss')
  const bossTarget = Math.round(towerTarget(f) * K[f])

  // 6ステータスを一律に伸縮させて総合力を合わせる
  const fit = (e, target) => {
    const k = Math.max(0.2, target / totalOf(e))
    return {
      ...e, hp: Math.round(e.hp * k / 100) * 100,
      atk: Math.round(e.atk * k), def: Math.round(e.def * k),
      matk: Math.round(e.matk * k), mdef: Math.round(e.mdef * k), spd: Math.round(e.spd * k),
    }
  }
  const nb = fit(boss, bossTarget)
  const bossOff = Math.max(nb.atk, nb.matk)

  const next = ents.map(e => {
    if (e.role === 'boss') return nb
    const t = bossTarget * (e.role === 'mid' ? MID_RATIO : MOB_RATIO)
    let n = fit(e, t)
    // エリアボスがその層で一番強いこと。超えたぶんは防御へ回して総合力は保つ
    const cap = Math.round(bossOff * MOB_ATK_CAP)
    for (const key of ['atk', 'matk']) {
      if (n[key] > cap) { const over = n[key] - cap; n[key] = cap; n.def += Math.round(over / 2); n.mdef += over - Math.round(over / 2) }
    }
    return n
  })

  for (const e of next) {
    const o = ents.find(x => x.at === e.at)
    console.log(
      String(f).padStart(2), e.role.padEnd(8), e.name.padEnd(24),
      `${String(totalOf(o)).padStart(7)}→${String(totalOf(e)).padStart(7)}`,
      `${String(o.atk).padStart(7)}→${String(e.atk).padStart(7)}`,
      `${String(o.matk).padStart(7)}→${String(e.matk).padStart(7)}`)
    block = block.replace(o.whole,
      `E('${e.name}', ${e.hp}, ${e.atk}, ${e.def}, ${e.matk}, ${e.mdef}, ${e.spd},`)
  }
  out.push(block)
}
out.push(body.slice(cursor))
s = s.slice(0, head) + out.join('') + s.slice(end + 1)

if (APPLY) { fs.writeFileSync(P, s); console.log('\n適用した') }
else console.log('\n下見のみ（--apply で適用）')
