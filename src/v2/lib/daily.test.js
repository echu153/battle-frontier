// バトルフロンティアⅡ デイリーミッションの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TASKS, TASK_KEYS, LEVELS, LEVEL_KEYS, levelOf,
  DAY_RESET_HOUR, dayOf, isToday, countsOf, progressOf,
  isComplete, isClaimed, pickedLevelOf, canClaim, nextResetAt,
} from './daily.js'
import { DAY_RESET_HOUR as TREE_RESET } from './tree.js'

const AT = new Date('2026-08-17T03:00:00Z')   // JST 12:00
const prof = (over = {}) => ({ daily_day:'2026-08-17', daily_counts:{}, daily_claimed:false, daily_level:null, ...over })

test('項目は4つ、難易度は2つ', () => {
  assert.deepEqual(TASK_KEYS, ['sortie', 'arena', 'rune', 'pray'])
  assert.deepEqual(LEVEL_KEYS, ['easy', 'normal'])
  for (const t of TASKS) assert.ok(t.label && t.unit, `${t.key} の表示`)
})

test('目標と報酬は指示どおり', () => {
  assert.deepEqual(levelOf('easy').goals,   { sortie: 20,  arena: 1, rune: 1, pray: 1 })
  assert.deepEqual(levelOf('easy').reward,  { exp: 60,  gold: 100 })
  assert.deepEqual(levelOf('normal').goals, { sortie: 100, arena: 5, rune: 3, pray: 1 })
  assert.deepEqual(levelOf('normal').reward,{ exp: 180, gold: 300 })
  // どの難易度も全項目に目標がある（増やしたときの取りこぼし検出）
  for (const lv of LEVELS) for (const k of TASK_KEYS) assert.ok(lv.goals[k] > 0, `${lv.key} の ${k}`)
  // ふつうは全部かんたん以上
  for (const k of TASK_KEYS) assert.ok(levelOf('normal').goals[k] >= levelOf('easy').goals[k], k)
  assert.equal(levelOf('存在しない'), null)
})

test('日付が変わるのは日本時間の5時（宝樹と同じ区切り）', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  assert.equal(DAY_RESET_HOUR, TREE_RESET, '宝樹と区切りがズレている')
  assert.equal(dayOf(new Date('2026-08-16T19:59:00Z')), '2026-08-16')  // JST 8/17 04:59
  assert.equal(dayOf(new Date('2026-08-16T20:00:00Z')), '2026-08-17')  // JST 8/17 05:00
  assert.equal(nextResetAt(new Date('2026-08-16T10:00:00Z')).toISOString(), '2026-08-16T20:00:00.000Z')
})

test('★日付が変わったら、前の日の進み具合も難易度も受け取り済みも消える', () => {
  const old = prof({ daily_day:'2026-08-16', daily_counts:{ sortie: 99, pray: 1 }, daily_level:'normal', daily_claimed:true })
  assert.equal(isToday(old.daily_day, AT), false)
  assert.deepEqual(countsOf(old, AT), { sortie:0, arena:0, rune:0, pray:0 })
  assert.equal(pickedLevelOf(old, AT), null)
  assert.equal(isClaimed(old, AT), false)
  // 日付そのものが無いとき（作りたて）も同じ
  assert.deepEqual(countsOf({}, AT), { sortie:0, arena:0, rune:0, pray:0 })
})

test('進み具合は目標で頭打ちにする（20/20 より上を出さない）', () => {
  const p = prof({ daily_counts:{ sortie: 55 } })
  assert.deepEqual(progressOf(p, 'easy', 'sortie', AT), { now:20, goal:20, done:true })
  assert.deepEqual(progressOf(p, 'normal', 'sortie', AT), { now:55, goal:100, done:false })
  assert.deepEqual(progressOf(p, 'easy', 'pray', AT), { now:0, goal:1, done:false })
})

test('全部そろって初めて達成', () => {
  const full = { sortie: 20, arena: 1, rune: 1, pray: 1 }
  assert.equal(isComplete(prof({ daily_counts: full }), 'easy', AT), true)
  // 1つでも足りなければ未達成
  for (const k of TASK_KEYS) {
    const short = { ...full, [k]: full[k] - 1 }
    assert.equal(isComplete(prof({ daily_counts: short }), 'easy', AT), false, `${k} が足りないのに達成扱い`)
  }
  // かんたんを満たしていても、ふつうの目標には届かない
  assert.equal(isComplete(prof({ daily_counts: full }), 'normal', AT), false)
})

test('受け取れる条件', () => {
  const full = { sortie: 20, arena: 1, rune: 1, pray: 1 }
  assert.match(canClaim(prof({ daily_counts: full }), AT), /難易度/)              // 未選択
  assert.equal(canClaim(prof({ daily_level:'easy', daily_counts: full }), AT), '')
  assert.match(canClaim(prof({ daily_level:'easy', daily_counts:{} }), AT), /まだ達成/)
  assert.match(canClaim(prof({ daily_level:'easy', daily_counts: full, daily_claimed:true }), AT), /もう受け取り/)
  // ★日付が変わればまた受け取れる（前日の受け取り済みを引きずらない）
  const yesterday = { daily_day:'2026-08-16', daily_level:'easy', daily_counts: full, daily_claimed:true }
  assert.match(canClaim(yesterday, AT), /難易度/)
})

test('難易度を選ぶ前でも数える（進捗を捨てない）', () => {
  // 難易度未選択でも countsOf は0にしない＝あとから選んでも進捗が残る
  const p = prof({ daily_level:null, daily_counts:{ sortie: 30 } })
  assert.equal(countsOf(p, AT).sortie, 30)
  assert.deepEqual(progressOf(p, 'easy', 'sortie', AT), { now:20, goal:20, done:true })
})
