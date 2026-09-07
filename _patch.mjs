// 敵の強さのつまみを一時的に書き換える（測定用の使い捨て。必ずバックアップから戻すこと）
//   node _patch.mjs <技> <ボス攻撃> <雑魚攻撃> <ボス被ダメ> <雑魚被ダメ> [層係数を1にするなら flat]
import fs from 'node:fs'
const [skill, atk, mob, taken, mobTaken, flat] = process.argv.slice(2)
const p = 'src/lib/tower.js'
let s = fs.readFileSync(p, 'utf8')

const set = (name, v) => {
  if (v == null || v === '-') return
  const head = 'export const ' + name
  const i = s.indexOf(head)
  if (i < 0) throw new Error('not found: ' + name)
  const eq = s.indexOf('=', i)
  let j = eq + 1
  while (j < s.length && s[j] === ' ') j++
  let k = j
  while (k < s.length && '0123456789.'.includes(s[k])) k++
  s = s.slice(0, j) + v + s.slice(k)
}
set('ENEMY_SKILL_POWER', skill)
set('ENEMY_ATK_POWER', atk)
set('MOB_ATK_POWER', mob)
set('ENEMY_DMG_TAKEN', taken)
set('MOB_DMG_TAKEN', mobTaken)
if (flat === 'flat') {
  const i = s.indexOf('export const FLOOR_POWER = [')
  const j = s.indexOf(']', i)
  s = s.slice(0, i) + 'export const FLOOR_POWER = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]' + s.slice(j + 1)
}
fs.writeFileSync(p, s)
