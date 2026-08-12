// バトルフロンティアⅡ スキルの習得中・習得済み・編成のテスト（node --test）
// ※サーバー側の規則は supabase_v2_core.sql の v2_apply_exp / v2_change_job / v2_set_skills。
//   ここで固定しているのは同じ規則のクライアント側実装。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS, skillsOf, usableSkills, usableSkillNames, unlearnedSkills, keepableSkillNames,
  validateSkillSet, buildSlots, setMpCost, forcedLearnCount, rollLearnCount,
  KIND_TABS, filterSkills, sortSkills, SKILL_BY_NAME,
  SKILL_SET_SLOTS, SKILL_USE_MAX, LEARN_BY_LV, LEARN_PCT,
} from './skills.js'
import { runBattle } from './battle.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}

// ===== 習得中と習得済み =====
test('使えるスキル＝習得中 ∪ 習得済み（職業に就いただけでは使えない）', () => {
  // 習得中はLVアップで増え、転職で失われる。習得済みはずっと残る
  assert.deepEqual(usableSkillNames([], []), [])
  const names = usableSkillNames(['体当たり', '強撃'], ['ヒール'])
  assert.deepEqual(names.sort(), ['ヒール', '体当たり', '強撃'].sort())
  // 職業のスキルでも、覚えていなければ使えない
  assert.ok(!usableSkillNames([], []).includes('体当たり'))
  // 重複は1つに畳む
  assert.deepEqual(usableSkillNames(['体当たり'], ['体当たり']), ['体当たり'])
})

test('usableSkills はスキルの実体を返す', () => {
  const list = usableSkills(['サンダー'], ['はたく'])
  assert.equal(list.length, 2)
  assert.ok(list.every(s => SKILLS.includes(s)))
})

test('まだ覚えていない、いまの職業のスキルが分かる', () => {
  assert.equal(unlearnedSkills('戦士', [], []).length, 5)
  assert.deepEqual(unlearnedSkills('戦士', ['体当たり'], []).map(s => s.name).includes('体当たり'), false)
  assert.deepEqual(unlearnedSkills('戦士', [], ['強撃']).map(s => s.name).includes('強撃'), false)
  assert.equal(unlearnedSkills('戦士', skillsOf('戦士').map(s => s.name), []).length, 0)
})

test('習得済みにできるのは「いまの職業の習得中でまだ習得済みでない」スキルだけ', () => {
  // ★転職時にここから1つ選ばれる。全部習得済み／習得中が無いなら何も残らない
  assert.deepEqual(keepableSkillNames('戦士', [], []), [])
  assert.deepEqual(keepableSkillNames('戦士', ['体当たり', '強撃'], []), ['体当たり', '強撃'])
  assert.deepEqual(keepableSkillNames('戦士', ['体当たり', '強撃'], ['体当たり']), ['強撃'])
  assert.deepEqual(keepableSkillNames('戦士', ['体当たり'], ['体当たり']), [])
  // 他職のスキルを習得中でも、いまの職業のものしか習得済みにできない
  assert.deepEqual(keepableSkillNames('戦士', ['サンダー'], []), [])
})

// ===== LVアップでの習得 =====
test('LVアップの習得はLV50までに必ず全部そろう', () => {
  // 確定ぶんの計算：残りLV数が足りなくなったぶんだけ確定で覚える
  assert.equal(forcedLearnCount(1, 5), 0)         // まだ余裕がある
  assert.equal(forcedLearnCount(LEARN_BY_LV - 5, 5), 0)
  assert.equal(forcedLearnCount(LEARN_BY_LV - 4, 5), 1)
  assert.equal(forcedLearnCount(LEARN_BY_LV, 5), 5)      // LV50で全部
  assert.equal(forcedLearnCount(LEARN_BY_LV + 10, 3), 3) // 過ぎていたら全部
  assert.equal(forcedLearnCount(1, 0), 0)
})

test('LV1→50を何度回してもLV50までに5個そろう', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mkRng(seed)
    let unlearned = 5
    for (let lv = 2; lv <= LEARN_BY_LV; lv++) {
      unlearned -= rollLearnCount(lv, unlearned, rng)
      assert.ok(unlearned >= 0)
    }
    assert.equal(unlearned, 0, `seed=${seed} でLV${LEARN_BY_LV}までにそろわなかった`)
  }
})

test('習得しつくしたら何も覚えない', () => {
  assert.equal(rollLearnCount(10, 0, () => 0), 0)
  assert.equal(rollLearnCount(LEARN_BY_LV, 0, () => 0), 0)
})

test('基礎確率でも覚える（確定ぶんが0でも当たれば1つ）', () => {
  assert.equal(rollLearnCount(2, 5, () => 0), 1)              // 抽選に当たった
  assert.equal(rollLearnCount(2, 5, () => 0.999), 0)          // 外れた
  assert.ok(LEARN_PCT > 0 && LEARN_PCT < 100)
})

// ===== 編成 =====
test('編成は枠数・重複・使用回数・使えるスキルかを検証する', () => {
  const usable = ['体当たり', '強撃']
  assert.equal(validateSkillSet([{ name:'体当たり', uses:5 }, { name:'強撃', uses:5 }], usable, 9999), null)
  assert.equal(validateSkillSet([], usable, 9999), null)  // 空でもよい

  assert.match(validateSkillSet([{ name:'爆裂拳', uses:1 }], usable, 9999), /まだ使えません/)
  assert.match(validateSkillSet([{ name:'強撃', uses:1 }, { name:'強撃', uses:1 }], usable, 9999), /重複/)
  const many = skillsOf('戦士').map(s => ({ name:s.name, uses:1 }))
  const all = skillsOf('戦士').map(s => s.name)
  assert.equal(validateSkillSet(many, all, 9999), null)
  assert.match(validateSkillSet([...many, { name:'体当たり', uses:1 }], all, 9999), /枠は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:0 }], usable, 9999), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:SKILL_USE_MAX + 1 }], usable, 9999), /使用回数は/)
  assert.match(validateSkillSet([{ name:'強撃', uses:1.5 }], usable, 9999), /使用回数は/)
})

test('使用回数の上限は「想定利用MPが最大MPを超えないこと」で決まる', () => {
  // ★あるけみすとの「あなたの最大MPは◯MPです／想定利用MPは◯MPです」と同じ考え方。
  //   MPを伸ばすほど強い技を多く積める＝MPがステータスとして効く
  const mp = SKILL_BY_NAME['強撃'].mp   // 12
  assert.equal(setMpCost([{ name:'強撃', uses:5 }]), mp * 5)
  assert.equal(setMpCost([{ name:'強撃', uses:2 }, { name:'体当たり', uses:3 }]), mp * 2 + 5 * 3)
  assert.equal(setMpCost([]), 0)
  assert.equal(setMpCost([{ name:'知らない技', uses:3 }]), 0)

  assert.equal(validateSkillSet([{ name:'強撃', uses:5 }], ['強撃'], mp * 5), null)
  assert.match(validateSkillSet([{ name:'強撃', uses:5 }], ['強撃'], mp * 5 - 1), /想定利用MP/)
  // 消費MP0の技はいくら積んでも通る
  assert.equal(validateSkillSet([{ name:'はたく', uses:99 }], ['はたく'], 0), null)
})

test('編成の上限が定数と一致している（サーバー側の v2_set_skills と揃える）', () => {
  assert.equal(SKILL_SET_SLOTS, 5)
  assert.equal(SKILL_USE_MAX, 99)
  assert.equal(LEARN_BY_LV, 50)
})

// ===== 一覧の絞り込み =====
test('一覧を検索・種別・お気に入りで絞り込める', () => {
  const list = usableSkills(skillsOf('戦士').map(s => s.name), ['ヒール', 'サンダー'])
  assert.equal(filterSkills(list, { tab:'all' }).length, list.length)
  assert.ok(filterSkills(list, { tab:'heal' }).every(s => s.kind === 'heal'))
  assert.deepEqual(filterSkills(list, { tab:'mag' }).map(s => s.name), ['サンダー'])
  assert.deepEqual(filterSkills(list, { query:'強撃' }).map(s => s.name), ['強撃'])
  assert.ok(filterSkills(list, { query:'僧侶' }).some(s => s.name === 'ヒール'))
  assert.equal(filterSkills(list, { query:'存在しない語' }).length, 0)
  assert.deepEqual(filterSkills(list, { tab:'fav', favorites:['強撃'] }).map(s => s.name), ['強撃'])
  assert.equal(filterSkills(list, { tab:'fav', favorites:[] }).length, 0)
  assert.deepEqual(KIND_TABS.map(t => t.key), ['all', 'phys', 'mag', 'buff', 'heal', 'fav'])
})

test('一覧をMP・発動率・名前で並べ替えられる', () => {
  const list = usableSkills(skillsOf('戦士').map(s => s.name), [])
  const byMp = sortSkills(list, 'mp', true).map(s => s.mp)
  assert.deepEqual(byMp, [...byMp].sort((a, b) => a - b))
  const byMpDesc = sortSkills(list, 'mp', false).map(s => s.mp)
  assert.deepEqual(byMpDesc, [...byMpDesc].sort((a, b) => b - a))
  const byProc = sortSkills(list, 'proc', true).map(s => s.proc)
  assert.deepEqual(byProc, [...byProc].sort((a, b) => a - b))
  const before = list.map(s => s.name)
  sortSkills(list, 'mp', true)
  assert.deepEqual(list.map(s => s.name), before)
})

// ===== 戦闘への受け渡し =====
test('保存された編成を戦闘用の枠に変換できる（知らない名前は捨てる）', () => {
  const slots = buildSlots([{ name:'強撃', uses:3 }, { name:'存在しない技', uses:2 }, { name:'体当たり', uses:1 }])
  assert.deepEqual(slots.map(s => s.skill.name), ['強撃', '体当たり'])
  assert.deepEqual(slots.map(s => s.uses), [3, 1])
  assert.deepEqual(buildSlots(null), [])
})

test('編成どおりの順番と回数で戦闘が回る', () => {
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
