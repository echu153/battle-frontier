// 外側のつまみを敵データへ焼き込む（実効値は一切変えない）
// ============================================================
//  これまで「データの攻撃9,300 → 実戦18,135」のように、データを読んでも強さが
//  分からない状態だった。つまみの分をデータへ掛け込み、つまみを1.0にすることで
//  「データに書いてある数字＝実戦値」に戻す。
//
//  焼き込む対象:
//    敵の攻撃力・特殊攻撃力 … ×(ボス1.3 / 雑魚2.0) ×層ごとの係数
//    技の倍率 mult          … ×技の威力つまみ 1.5（通常技・大技・噴火）
//  焼き込まないもの:
//    ENEMY_DMG_TAKEN / MOB_DMG_TAKEN … プレイヤーの与ダメージ側の倍率なので
//                                       敵のステータスでは表現できない。つまみのまま残す
//
//  使い方: node _bake.mjs [--apply]
import fs from 'node:fs'

const APPLY = process.argv.includes('--apply')
const P = 'src/lib/tower.js'
let s = fs.readFileSync(P, 'utf8')

const num = (name) => {
  const m = s.match(new RegExp('export const ' + name + '\\s*=\\s*([0-9.]+)'))
  if (!m) throw new Error('読めない: ' + name)
  return Number(m[1])
}
const ENEMY_ATK_POWER = num('ENEMY_ATK_POWER')
const MOB_ATK_POWER = num('MOB_ATK_POWER')
const ENEMY_SKILL_POWER = num('ENEMY_SKILL_POWER')
const FP = JSON.parse(s.match(/export const FLOOR_POWER = (\[[^\]]*\])/)[1])
const fpOf = (f) => FP[f - 1] ?? FP[FP.length - 1]

console.log(`つまみ: ボス攻撃×${ENEMY_ATK_POWER} 雑魚攻撃×${MOB_ATK_POWER} 技×${ENEMY_SKILL_POWER} 層=${JSON.stringify(FP)}`)

// ── TOWER_FLOORS の範囲を取る ─────────────────────────────
const head = s.indexOf('export const TOWER_FLOORS = [')
if (head < 0) throw new Error('TOWER_FLOORS が見つからない')
// 対応する ] を括弧の数を数えて探す
let depth = 0, end = -1
for (let i = s.indexOf('[', head); i < s.length; i++) {
  if (s[i] === '[') depth++
  else if (s[i] === ']') { depth--; if (depth === 0) { end = i; break } }
}
if (end < 0) throw new Error('TOWER_FLOORS の終端が見つからない')
let body = s.slice(head, end + 1)

// ── 層ごとに区切り、さらに 雑魚 / 強敵 / エリアボス に分ける ──
const floorStarts = []
const reFloor = /floor: (\d+), boss:/g
let m
while ((m = reFloor.exec(body))) floorStarts.push({ floor: Number(m[1]), at: m.index })

let changedE = 0, changedMult = 0
const pieces = []
let cursor = 0
for (let i = 0; i < floorStarts.length; i++) {
  const fs0 = floorStarts[i]
  const fs1 = floorStarts[i + 1]
  const blockStart = fs0.at
  const blockEnd = fs1 ? fs1.at : body.length
  pieces.push(body.slice(cursor, blockStart))
  let block = body.slice(blockStart, blockEnd)
  const fp = fpOf(fs0.floor)

  // 役割の境目。midBoss: より前が雑魚、それ以降がボス扱い
  const midAt = block.indexOf('midBoss:')
  if (midAt < 0) throw new Error(`${fs0.floor}層に midBoss が無い`)

  // E('名前', hp, atk, def, matk, mdef, spd, ... の atk と matk を書き換える
  block = block.replace(
    /E\('([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g,
    (whole, name, hp, atk, def, matk, mdef, spd, offset) => {
      const isBoss = offset >= midAt
      const p = (isBoss ? ENEMY_ATK_POWER : MOB_ATK_POWER) * fp
      const na = Math.floor(Number(atk) * p)
      const nm = Math.floor(Number(matk) * p)
      changedE++
      return `E('${name}', ${hp}, ${na}, ${def}, ${nm}, ${mdef}, ${spd},`
    })

  // 技の倍率。atkMult / spdMult / allStatMult は大文字始まりなので当たらない
  block = block.replace(/\bmult: ([0-9.]+)/g, (whole, v) => {
    changedMult++
    return `mult: ${+(Number(v) * ENEMY_SKILL_POWER).toFixed(4)}`
  })

  pieces.push(block)
  cursor = blockEnd
}
pieces.push(body.slice(cursor))
const newBody = pieces.join('')

s = s.slice(0, head) + newBody + s.slice(end + 1)

// ── つまみを1.0へ ────────────────────────────────────────
const setConst = (name, v) => {
  s = s.replace(new RegExp('(export const ' + name + '\\s*=\\s*)[0-9.]+'), `$1${v}`)
}
setConst('ENEMY_ATK_POWER', '1.0')
setConst('MOB_ATK_POWER', '1.0')
setConst('ENEMY_SKILL_POWER', '1.0')
s = s.replace(/export const FLOOR_POWER = \[[^\]]*\]/, 'export const FLOOR_POWER = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]')

console.log(`敵 ${changedE} 体の攻撃力／特殊攻撃力と、技 ${changedMult} 個の倍率を書き換えた`)
if (APPLY) { fs.writeFileSync(P, s); console.log('適用した') }
else { fs.writeFileSync('_bake_preview.js', s); console.log('下見のみ。結果は _bake_preview.js') }
