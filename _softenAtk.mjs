// エンドレスタワーの敵を「火力-10%・耐久+10%」にする
// ============================================================
//  攻撃力・特殊攻撃力 ×0.9   （ダメージは atk × 技の倍率 なので、ここを下げれば全部下がる）
//  HP・防御・特防     ×1.1
//  素早さ             据え置き（火力でも耐久でもないので触らない）
//  技の倍率           据え置き（攻撃力を下げれば掛け算の結果も下がる）
//
//  使い方: node _softenAtk.mjs [--apply]
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
const ATK = 0.9, TOUGH = 1.1

let s = fs.readFileSync(P, 'utf8')
const head = s.indexOf('export const TOWER_FLOORS = [')
let depth = 0, end = -1
for (let i = s.indexOf('[', head); i < s.length; i++) {
  if (s[i] === '[') depth++
  else if (s[i] === ']') { depth--; if (depth === 0) { end = i; break } }
}
const body = s.slice(head, end + 1)

const total = (e) => Math.floor(e.hp / 10 + e.atk + e.def + e.matk + e.mdef + e.spd)
let n = 0
console.log('名前                     HP                 攻撃            防御          特攻            特防        総合力')
const next = body.replace(
  /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g,
  (whole, name, hp, atk, def, matk, mdef, spd) => {
    const o = { hp: +hp, atk: +atk, def: +def, matk: +matk, mdef: +mdef, spd: +spd }
    const v = {
      hp: Math.round(o.hp * TOUGH / 100) * 100,
      atk: Math.round(o.atk * ATK), def: Math.round(o.def * TOUGH),
      matk: Math.round(o.matk * ATK), mdef: Math.round(o.mdef * TOUGH), spd: o.spd,
    }
    n++
    const p = (a, b) => `${a.toLocaleString()}→${b.toLocaleString()}`
    console.log(name.padEnd(24), p(o.hp, v.hp).padEnd(18), p(o.atk, v.atk).padEnd(15),
      p(o.def, v.def).padEnd(13), p(o.matk, v.matk).padEnd(15), p(o.mdef, v.mdef).padEnd(11),
      p(total(o), total(v)))
    return `E('${name}', ${v.hp}, ${v.atk}, ${v.def}, ${v.matk}, ${v.mdef}, ${v.spd},`
  })

s = s.slice(0, head) + next + s.slice(end + 1)
console.log(`\n敵 ${n} 体`)
if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else console.log('下見のみ（--apply で適用）')
