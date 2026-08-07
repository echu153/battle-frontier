// 「自分にかけるだけのスキル（バフ・回復）は相手に回避されない」の回帰テスト。
//  ------------------------------------------------------------------
//  組み手で「相手のバフを回避して不発にできる」不具合が出た。原因は回避免除の判定を
//  DBの skills.type（'強化'/'回復'）だけで行っていたこと。登録が攻撃タイプになっている
//  バフ技はすり抜けて回避されていた。以後は Game.jsx の SELF_TARGET_SKILLS（実装から
//  作った名前リスト）でも拾う。
//
//  このテストは executeSkill の実装を読んで「敵に何もしないスキル」を洗い出し、
//  リストに載っていない技があれば落ちる（＝新しいバフ技を足したときの取りこぼし検出）。
//  戦闘エンジンは pages/Game.jsx を読むため node --test で import できない。よって
//  ソースを文字列として解析する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const GAME = readSrc('src/pages/Game.jsx')

// Game.jsx の SELF_TARGET_SKILLS リテラルから名前を取り出す
function selfTargetList() {
  const m = GAME.match(/export const SELF_TARGET_SKILLS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(m, 'SELF_TARGET_SKILLS が Game.jsx にある')
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

// executeSkill の switch を case ごとに切って「敵に何もしないスキル」を集める。
//  ダメージ（dmg/hitDmgs/followup）も敵バフ（newEnemyBuffs）も書かない case が該当。
function selfOnlySkillsFromExecuteSkill() {
  const start = GAME.indexOf('export const executeSkill')
  assert.ok(start > 0, 'executeSkill が Game.jsx にある')
  const rest = GAME.slice(start)
  const body = rest.slice(0, rest.indexOf('\n}\n'))
  const cases = [...body.matchAll(/case '([^']+)':/g)].map((m) => ({ name: m[1], at: m.index }))
  assert.ok(cases.length > 50, 'switch の case を取れている')
  const out = []
  for (let i = 0; i < cases.length; i++) {
    const seg = body.slice(cases[i].at, i + 1 < cases.length ? cases[i + 1].at : body.length)
    if (/result\.(dmg|hitDmgs|followup)\s*\+?=/.test(seg)) continue   // 敵にダメージ
    if (/result\.newEnemyBuffs/.test(seg)) continue                   // 敵にデバフ
    if (!/[ぁ-んァ-ヶ一-龠]/.test(cases[i].name)) continue             // 敵スキル種別(physical等)は対象外
    out.push(cases[i].name)
  }
  return out
}

test('敵に何もしないスキルは全て SELF_TARGET_SKILLS に載っている', () => {
  const listed = selfTargetList()
  const missing = selfOnlySkillsFromExecuteSkill().filter((n) => !listed.has(n))
  assert.deepEqual(missing, [], `回避免除の登録漏れ: ${missing.join('・')}（Game.jsx の SELF_TARGET_SKILLS に追加すること）`)
})

// 全戦闘エンジンで同じ判定を使う（出撃・奈落・八獄・天穹・タワー・対人/組み手/戦争）。
const ENGINES = [
  'src/pages/Game.jsx',
  'src/pages/Abyss.jsx',
  'src/pages/Hachigoku.jsx',
  'src/pages/Tenkyuu.jsx',
  'src/lib/towerBattle.js',
  'src/lib/pvp.js',
]

test('全エンジンが共通の判定(isSelfTargetSkill)で回避免除している', () => {
  for (const rel of ENGINES) {
    const s = readSrc(rel)
    assert.match(s, /isSelfSkill = !mpLack && isSelfTargetSkill\(nextSkill, \w+\)/, `${rel} が isSelfTargetSkill を使う`)
    assert.doesNotMatch(s, /nextSkill\.type === '強化'/, `${rel} に type だけの旧判定が残っていない`)
    assert.match(s, /isSelfSkill \|\|/, `${rel} で回避判定に isSelfSkill が効いている`)
  }
})
