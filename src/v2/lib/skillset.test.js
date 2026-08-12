// バトルフロンティアⅡ スキルの習得と編成のテスト（node --test）
// ※サーバー側の規則は supabase_v2_core.sql の v2_set_skills / v2_change_job。
//   ここで固定しているのは同じ規則のクライアント側実装。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS, skillsOf, usableSkills, usableSkillNames, validateSkillSet, buildSlots, setMpCost,
  KIND_TABS, filterSkills, sortSkills, SKILL_BY_NAME,
  SKILL_SET_SLOTS, SKILL_USE_MAX,
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
  assert.equal(validateSkillSet(ok, usable, 9999), null)
  assert.equal(validateSkillSet([], usable, 9999), null)  // 空でもよい

  // 使えないスキル
  assert.match(validateSkillSet([{ name:'爆裂拳', uses:1 }], usable, 9999), /まだ使えません/)
  // 重複
  assert.match(validateSkillSet([{ name:'強撃', uses:1 }, { name:'強撃', uses:1 }], usable, 9999), /重複/)
  // 枠数オーバー
  const many = skillsOf('戦士').map(s => ({ name:s.name, uses:1 }))
  assert.equal(validateSkillSet(many, usable, 9999), null)
  assert.match(validateSkillSet([...many, { name:'体当たり', uses:1 }], usable, 9999), /枠は/)
  // 使用回数の範囲
  assert.match(validateSkillSet([{ name:'強撃', uses:0 }], usable, 9999), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:SKILL_USE_MAX + 1 }], usable, 9999), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:1.5 }], usable, 9999), /使用回数は/)
})

test('使用回数の上限は「想定利用MPが最大MPを超えないこと」で決まる', () => {
  // ★あるけみすとの「あなたの最大MPは◯MPです／想定利用MPは◯MPです」と同じ考え方。
  //   MPを伸ばすほど強い技を多く積める＝MPがステータスとして効く
  const usable = usableSkillNames('戦士', [])
  const mp = SKILL_BY_NAME['強撃'].mp   // 12
  assert.equal(setMpCost([{ name:'強撃', uses:5 }]), mp * 5)
  assert.equal(setMpCost([{ name:'強撃', uses:2 }, { name:'体当たり', uses:3 }]), mp * 2 + 5 * 3)
  assert.equal(setMpCost([]), 0)
  assert.equal(setMpCost([{ name:'知らない技', uses:3 }]), 0)

  // 最大MPちょうどは通る／1超えると通らない
  assert.equal(validateSkillSet([{ name:'強撃', uses:5 }], usable, mp * 5), null)
  assert.match(validateSkillSet([{ name:'強撃', uses:5 }], usable, mp * 5 - 1), /想定利用MP/)
  // 消費MP0の技はいくら積んでも通る
  assert.equal(validateSkillSet([{ name:'はたく', uses:99 }], usableSkillNames('ノーブル', []), 0), null)
})

test('編成の上限が定数と一致している（サーバー側の v2_set_skills と揃える）', () => {
  assert.equal(SKILL_SET_SLOTS, 5)
  assert.equal(SKILL_USE_MAX, 99)
})

test('一覧を検索・種別・お気に入りで絞り込める', () => {
  const list = usableSkills('戦士', ['ヒール', 'サンダー'])
  assert.equal(filterSkills(list, { tab:'all' }).length, list.length)
  // 種別
  assert.ok(filterSkills(list, { tab:'heal' }).every(s => s.kind === 'heal'))
  assert.deepEqual(filterSkills(list, { tab:'mag' }).map(s => s.name), ['サンダー'])
  // 検索（名前・職業・説明のどれかに当たる）
  assert.deepEqual(filterSkills(list, { query:'強撃' }).map(s => s.name), ['強撃'])
  assert.ok(filterSkills(list, { query:'僧侶' }).some(s => s.name === 'ヒール'))
  assert.equal(filterSkills(list, { query:'存在しない語' }).length, 0)
  // お気に入り
  assert.deepEqual(filterSkills(list, { tab:'fav', favorites:['強撃'] }).map(s => s.name), ['強撃'])
  assert.equal(filterSkills(list, { tab:'fav', favorites:[] }).length, 0)
  // タブは全部そろっている
  assert.deepEqual(KIND_TABS.map(t => t.key), ['all', 'phys', 'mag', 'buff', 'heal', 'fav'])
})

test('一覧をMP・発動率・名前で並べ替えられる', () => {
  const list = usableSkills('戦士', [])
  const byMp = sortSkills(list, 'mp', true).map(s => s.mp)
  assert.deepEqual(byMp, [...byMp].sort((a, b) => a - b))
  const byMpDesc = sortSkills(list, 'mp', false).map(s => s.mp)
  assert.deepEqual(byMpDesc, [...byMpDesc].sort((a, b) => b - a))
  const byProc = sortSkills(list, 'proc', true).map(s => s.proc)
  assert.deepEqual(byProc, [...byProc].sort((a, b) => a - b))
  // 元の配列は壊さない
  const before = list.map(s => s.name)
  sortSkills(list, 'mp', true)
  assert.deepEqual(list.map(s => s.name), before)
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
