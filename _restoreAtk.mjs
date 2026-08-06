// 「与えるダメージ10%戻して、耐久はそのまま」
// ============================================================
//  a495870 で 攻撃/特攻 ×0.9・HP/防御/特防 ×1.1 を掛けた。
//  このうち攻撃側だけを元に戻す（耐久は上げたまま）。
//  丸め誤差を残さないよう、a495870 の1つ前のコミットから実際の値を読んで書き戻す。
//
//  使い方: node _restoreAtk.mjs [--apply]
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')

const before = execSync(`git show a495870~1:${P}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const RE = /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g

// 攻撃を下げる前の値を名前で引けるようにする
const old = new Map()
let m
while ((m = RE.exec(before))) old.set(m[1], { atk: +m[3], matk: +m[5] })
console.log(`a495870 の1つ前から敵 ${old.size} 体を読んだ`)

let s = fs.readFileSync(P, 'utf8')
let n = 0, miss = 0
RE.lastIndex = 0
s = s.replace(RE, (whole, name, hp, atk, def, matk, mdef, spd) => {
  const o = old.get(name)
  if (!o) { console.log(`⚠ 元の値が無い: ${name}`); miss++; return whole }
  if (+atk !== o.atk || +matk !== o.matk) n++
  return `E('${name}', ${hp}, ${o.atk}, ${def}, ${o.matk}, ${mdef}, ${spd},`
})

console.log(`攻撃力／特殊攻撃力を戻した敵: ${n} 体${miss ? `（見つからず ${miss} 体）` : ''}`)
if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else console.log('下見のみ（--apply で適用）')
