// バトルフロンティアⅡ スキルの習得と編成のテスト（node --test）
// ※サーバー側の規則は supabase_v2_core.sql の v2_set_skills / v2_change_job。
//   ここで固定しているのは同じ規則のクライアント側実装。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS, skillsOf, usableSkills, usableSkillNames, validateSkillSet, buildSlots,
  SKILL_SET_SLOTS, SKILL_USE_TOTAL, SKILL_USE_MAX,
} from './skills.js'
import { runBattle } from './battle.js'

const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}

test('使えるスキル＝いまの職業のスキル ∪ 習得済み', () => {
  const names = usableSkillNames('戦士', ['ヒール', 'サンダー'])
  for (const s of skillsOf('戦士')) assert.ok(names.includes(s.name), `${s.name} が使えない`)
  assert.ok(names.includes('ヒール'))
  assert.ok(names.includes('サンダー'))
  assert.equal(names.length, 7)
  // 覚えていない他職のスキルは使えない
  assert.ok(!names.includes('爆裂拳'))
})

test('習得済みが職業のスキルと重なっても二重に数えない', () => {
  const names = usableSkillNames('戦士', ['体当たり'])
  assert.equal(names.length, skillsOf('戦士').length)
})

test('usableSkills はスキルの実体を返す', () => {
  const list = usableSkills('ノーブル', ['サンダー'])
  assert.equal(list.length, 6)
  assert.ok(list.every(s => SKILLS.includes(s)))
})

test('編成は枠数・重複・使用回数・使えるスキルかを検証する', () => {
  const usable = usableSkillNames('戦士', [])
  const ok = [{ name:'体当たり', uses:5 }, { name:'強撃', uses:5 }]
  assert.equal(validateSkillSet(ok, usable), null)
  assert.equal(validateSkillSet([], usable), null)  // 空でもよい

  // 使えないスキル
  assert.match(validateSkillSet([{ name:'爆裂拳', uses:1 }], usable), /まだ使えません/)
  // 重複
  assert.match(validateSkillSet([{ name:'強撃', uses:1 }, { name:'強撃', uses:1 }], usable), /重複/)
  // 枠数オーバー
  const many = skillsOf('戦士').map(s => ({ name:s.name, uses:1 }))
  assert.equal(validateSkillSet(many, usable), null)
  assert.match(validateSkillSet([...many, { name:'体当たり', uses:1 }], usable), /枠は/)
  // 使用回数の範囲
  assert.match(validateSkillSet([{ name:'強撃', uses:0 }], usable), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:SKILL_USE_MAX + 1 }], usable), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:1.5 }], usable), /使用回数は/)
  // 合計の上限
  assert.match(validateSkillSet(
    [{ name:'強撃', uses:SKILL_USE_MAX }, { name:'体当たり', uses:1 }], usable), /合計/)
})

test('編成の上限が定数と一致している（サーバー側の v2_set_skills と揃える）', () => {
  assert.equal(SKILL_SET_SLOTS, 5)
  assert.equal(SKILL_USE_TOTAL, 10)
  assert.equal(SKILL_USE_MAX, 10)
})

test('保存された編成を戦闘用の枠に変換できる（知らない名前は捨てる）', () => {
  const slots = buildSlots([{ name:'強撃', uses:3 }, { name:'存在しない技', uses:2 }, { name:'体当たり', uses:1 }])
  assert.deepEqual(slots.map(s => s.skill.name), ['強撃', '体当たり'])
  assert.deepEqual(slots.map(s => s.uses), [3, 1])
  assert.deepEqual(buildSlots(null), [])
})

test('編成どおりの順番と回数で戦闘が回る', () => {
  const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const set = [{ name:'体当たり', uses:2 }, { name:'強撃', uses:1 }]
  const r = runBattle(
    { name:'me', cls:'戦士', stats, slots: buildSlots(set) },
    { name:'foe', cls:'戦士', stats, slots: [] },
    { rng: mkRng(7), maxTurns: 8 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  // ★1周ごとに次の枠へ回る（ABAB…）。使用回数は「その枠を何回使えるか」の総量。
  //   体当たり2回・強撃1回なら 体当たり→強撃→体当たり で打ち止め、あとは通常攻撃
  assert.deepEqual(used, ['体当たり', '強撃', '体当たり'])
  assert.ok(r.log.filter(l => l.side === 'me' && l.type === 'normal').length > 0)
})
