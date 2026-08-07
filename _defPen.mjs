// 5層以降のエリアボス・強敵の技に「防御無視」を持たせる
// ============================================================
//  持久型（聖騎士・聖職者）が5層を100%で抜けるのを止めるための3つ目の案。
//  1つ目（ターン経過での回復阻害）と2つ目（割合ダメージ・回復量低下）は
//  どちらも「持久型より先に他の職が死ぬ」で失敗した。実測ずみ。
//
//  狙い: 持久型の勝因は回復ではなく「防御が高くて元々ほとんど削られない」こと。
//        防御を無視すれば持久型にだけ刺さり、元から防御の薄い職には効きが小さいはず。
//
//  使い方: node _defPen.mjs <ボスの防御無視率> [--apply]
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
const PEN = Number(process.argv.slice(2).filter(a => !a.startsWith('--'))[0] ?? 0.4)
const MID_RATIO = 0.5

function matchEnd(s, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const stack = [pairs[s[open]]]
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ }; continue }
    if (c === '(' || c === '[' || c === '{') stack.push(pairs[c])
    else if (c === ')' || c === ']' || c === '}') { stack.pop(); if (stack.length === 0) return i }
  }
  throw new Error('閉じ括弧が見つからない')
}

let s = fs.readFileSync(P, 'utf8')
const floors = []
const reF = /floor: (\d+), boss:/g
let m
while ((m = reF.exec(s))) floors.push({ floor: Number(m[1]), at: m.index })

console.log(`ボス 防御無視${(PEN * 100).toFixed(0)}%／強敵 ${(PEN * MID_RATIO * 100).toFixed(0)}%（5層以降）`)
for (let fi = floors.length - 1; fi >= 0; fi--) {
  const f = floors[fi].floor
  if (f < 5) continue
  for (const [key, pen] of [['floorBoss', PEN], ['midBoss', PEN * MID_RATIO]]) {
    const anchor = s.indexOf(`${key}: E(`, floors[fi].at)
    const open = s.indexOf('(', anchor)
    const close = matchEnd(s, open)
    const span = s.slice(open, close)
    let n = 0
    // 技・大技・噴火の mult に defPen を足す。buff/debuff は mult を持たないので当たらない
    const next = span.replace(/\bmult: ([0-9.]+)/g, (w, v) => {
      n++
      return `mult: ${v}, defPen: ${pen}`
    })
    s = s.slice(0, open) + next + s.slice(close)
    console.log(`  ${String(f).padStart(2)}層 ${key.padEnd(9)} 技${n}個に defPen ${pen}`)
  }
}

if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else console.log('下見のみ（--apply で適用）')
