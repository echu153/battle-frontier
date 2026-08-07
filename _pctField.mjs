// 5層以降のエリアボス・強敵に「毎ターン最大HPの割合ダメージ」を持たせる
// ============================================================
//  持久型（聖騎士・聖職者）が5層を100%で抜けるのを止めるため。
//  ターン経過を条件にした回復阻害は届かないことが実測で分かった
//  （タワーの戦闘は2〜15ターンで終わり、20ターンに一度も到達しない）。
//  割合ダメージは防御で止まらないので、硬さで無効化する型に直接刺さる。
//
//  ⚠1〜4層は一般公開中なので触らない。
//  ⚠割合ダメージが被ダメージ全体の主役にならないこと（過去に毒沼12%で
//    「毒が本体・ボスの攻撃はおまけ」になった）。2割程度に収める。
//
//  E(...) は敵によって末尾のオプション {} を持ったり持たなかったりするので、
//  括弧の対応を数えて確実に差し込む。
//
//  使い方: node _pctField.mjs <5層の割合> <1層あたりの増分> [--apply]
import fs from 'node:fs'

const P = 'src/lib/tower.js'
const APPLY = process.argv.includes('--apply')
// --heal を付けると「毎ターンの割合ダメージ」ではなく「回復量低下(playerHealMult)」を入れる。
// 持久型に効くのはどちらか、実測で比べるため両方を出せるようにしてある。
const HEAL = process.argv.includes('--heal')
const nums = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number)
const BASE = nums[0] ?? 0.03
const STEP = nums[1] ?? 0.005
const MID_RATIO = 0.5

const NAME = {
  5:  ['暴風', '💨', '#88ccff'],
  6:  ['呪詛', '💀', '#aa77ff'],
  7:  ['光刃', '✨', '#ffdd66'],
  8:  ['熱波', '🔥', '#ff7744'],
  9:  ['瘴気', '🟣', '#cc66ff'],
  10: ['混沌', '🌀', '#ffaa33'],
}

// 開き括弧の位置から、対応する閉じ括弧の位置を返す（文字列リテラルは飛ばす）
function matchEnd(s, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const stack = [pairs[s[open]]]
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {          // 文字列は中身を無視
      const q = c
      i++
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ }
      continue
    }
    if (c === '(' || c === '[' || c === '{') stack.push(pairs[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (stack[stack.length - 1] !== c) throw new Error(`括弧が合わない @${i}`)
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  throw new Error('閉じ括弧が見つからない')
}

let s = fs.readFileSync(P, 'utf8')
console.log(`5層 ${(BASE * 100).toFixed(1)}% から1層ごとに +${(STEP * 100).toFixed(1)}pt（強敵はその${MID_RATIO * 100}%）`)

// 層番号 → その層のブロックの範囲を先に取っておく（後ろから処理して位置ずれを避ける）
const floors = []
const reF = /floor: (\d+), boss:/g
let m
while ((m = reF.exec(s))) floors.push({ floor: Number(m[1]), at: m.index })

for (let fi = floors.length - 1; fi >= 0; fi--) {
  const f = floors[fi].floor
  if (f < 5) continue
  const blockEnd = floors[fi + 1] ? floors[fi + 1].at : s.length
  const rate = BASE + STEP * (f - 5)
  const [nm, icon, color] = NAME[f]

  for (const [key, r] of [['floorBoss', rate], ['midBoss', rate * MID_RATIO]]) {
    const anchor = s.indexOf(`${key}: E(`, floors[fi].at)
    if (anchor < 0 || anchor > blockEnd) { console.log(`  ⚠ ${f}層 ${key} が見つからない`); continue }
    const open = s.indexOf('(', anchor)
    const close = matchEnd(s, open)

    // E(...) の中で、深さ1にある最後の { … } ＝ オプション。無ければ足す
    let optOpen = -1
    { let depth = 0
      for (let i = open + 1; i < close; i++) {
        const c = s[i]
        if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < close && s[i] !== q) { if (s[i] === '\\') i++; i++ } continue }
        if (c === '(' || c === '[' || c === '{') { if (depth === 0 && c === '{') optOpen = i; depth++ }
        else if (c === ')' || c === ']' || c === '}') depth--
      } }

    const add = HEAL ? `playerHealMult: ${+r.toFixed(4)}`
      : `poisonField: ${+r.toFixed(4)}, fieldName: '${nm}', fieldIcon: '${icon}', fieldColor: '${color}'`
    if (optOpen < 0) {
      // オプションごと新設
      s = s.slice(0, close) + `, { mods: { ${add} } }` + s.slice(close)
      console.log(`  ${String(f).padStart(2)}層 ${key.padEnd(9)} ${(r * 100).toFixed(2)}%/ターン  （オプションを新設）`)
      continue
    }
    const optClose = matchEnd(s, optOpen)
    const optBody = s.slice(optOpen + 1, optClose)
    const modsRel = optBody.indexOf('mods:')
    if (modsRel < 0) {
      // オプションはあるが mods が無い
      const trimmed = optBody.trimEnd()
      const sep = trimmed.endsWith(',') || trimmed === '' ? '' : ','
      s = s.slice(0, optOpen + 1) + `${optBody.replace(/\s*$/, '')}${sep} mods: { ${add} }\n    ` + s.slice(optClose)
      console.log(`  ${String(f).padStart(2)}層 ${key.padEnd(9)} ${(r * 100).toFixed(2)}%/ターン  （modsを新設）`)
      continue
    }
    // 既存の mods に足す（9層のように既に poisonField があれば値を差し替える）
    const modsOpen = s.indexOf('{', optOpen + 1 + modsRel)
    const modsClose = matchEnd(s, modsOpen)
    let inner = s.slice(modsOpen + 1, modsClose).trim()
    const KEY = HEAL ? 'playerHealMult' : 'poisonField'
    const reKey = new RegExp(KEY + ':\\s*[0-9.]+')
    if (reKey.test(inner)) {
      inner = inner.replace(reKey, `${KEY}: ${+r.toFixed(4)}`)
      if (!HEAL && !/fieldName:/.test(inner)) inner += `, fieldName: '${nm}', fieldIcon: '${icon}', fieldColor: '${color}'`
      console.log(`  ${String(f).padStart(2)}層 ${key.padEnd(9)} ${(r * 100).toFixed(2)}%/ターン  （既存の割合を差し替え）`)
    } else {
      inner = inner ? `${inner.replace(/,\s*$/, '')}, ${add}` : add
      console.log(`  ${String(f).padStart(2)}層 ${key.padEnd(9)} ${(r * 100).toFixed(2)}%/ターン`)
    }
    s = s.slice(0, modsOpen + 1) + ` ${inner} ` + s.slice(modsClose)
  }
}

if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else console.log('下見のみ（--apply で適用）')
