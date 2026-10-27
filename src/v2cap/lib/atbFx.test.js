// v2cap の ATB戦闘の見た目の動き（記録 → 踏み込み・被弾・数字）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fxEventsOf, scheduleFx, lungeOf, shakeOf, LUNGE_SEC, HIT_SEC } from './atbFx.js'

test('殴った側が踏み込み、受けた側に数字（外れは MISS・クリティカルの印）', () => {
  const ev = fxEventsOf([
    { side: '自分', type: 'normal', hit: true, damage: 120 },
    { side: 'ボス', type: 'skill', skill: '大技', hits: 1, damage: 900, crit: true },
    { side: '自分', type: 'normal', hit: false, damage: 0 },
    { side: '自分', type: 'skill', skill: '吸収', hits: 2, damage: 300, drain: 40 },
  ], '自分', 'ボス')
  assert.deepEqual(ev, [
    { kind: 'act', side: 'a', skill: null },
    { kind: 'hit', side: 'b', amount: 120, crit: false },
    { kind: 'act', side: 'b', skill: '大技' },
    { kind: 'hit', side: 'a', amount: 900, crit: true },
    { kind: 'act', side: 'a', skill: null },
    { kind: 'miss', side: 'b' },
    { kind: 'act', side: 'a', skill: '吸収' },
    { kind: 'hit', side: 'b', amount: 300, crit: false },
    { kind: 'heal', side: 'a', amount: 40 },
  ])
})

test('回復は光って緑の数字・補助技と防御は光るだけ・毒などは揺れない数字・知らない名前は動かない', () => {
  const ev = fxEventsOf([
    { side: '自分', type: 'heal', skill: 'ヒール', heal: 200 },
    { side: 'ボス', type: 'ailTick', ail: '毒', damage: 55 },
    { side: '自分', type: 'buff', skill: '雄叫び' },
    { side: 'だれか', type: 'normal', hit: true, damage: 10 },
    { side: 'ボス', type: 'skill', skill: '補助', hits: 0, damage: 0 },
  ], '自分', 'ボス')
  assert.deepEqual(ev, [
    { kind: 'use', side: 'a', skill: 'ヒール' },
    { kind: 'heal', side: 'a', amount: 200 },
    { kind: 'tick', side: 'b', amount: 55 },
    { kind: 'use', side: 'a', skill: '雄叫び' },
    { kind: 'act', side: 'b', skill: '補助' },
    { kind: 'miss', side: 'a' },
  ])
})

test('踏み込みと揺れは時間がたつと0に戻る', () => {
  assert.equal(lungeOf(0), 0)
  assert.ok(lungeOf(LUNGE_SEC / 2) > 20)
  assert.equal(lungeOf(LUNGE_SEC), 0)
  assert.equal(shakeOf(HIT_SEC), 0)
  assert.equal(shakeOf(-1), 0)
})

test('攻撃の絵がある側は、数字と揺れを当たるコマまで遅らせる（補助技・相手の攻撃は遅らせない）', () => {
  const ev = scheduleFx([
    { kind: 'act', side: 'a' }, { kind: 'hit', side: 'b', amount: 10 }, { kind: 'heal', side: 'a', amount: 2 },
    { kind: 'act', side: 'b' }, { kind: 'miss', side: 'a' },
    { kind: 'use', side: 'a' }, { kind: 'heal', side: 'a', amount: 5 },
  ], 10, { a: 0.2 })
  assert.deepEqual(ev.map(e => e.t0), [10, 10.2, 10.2, 10, 10, 10, 10])
})

test('技ごとに絵が違う側（ボス）は、動きごとに当たるコマまで遅らせる（act の motion を見る）', () => {
  const ev = scheduleFx([
    { kind: 'act', side: 'b', motion: { hitMs: 220 } }, { kind: 'hit', side: 'a', amount: 10 },
    { kind: 'act', side: 'b', motion: { hitMs: 540 } }, { kind: 'hit', side: 'a', amount: 30 },
    { kind: 'act', side: 'b' }, { kind: 'miss', side: 'a' },
  ], 10, { b: (e) => (e.motion ? e.motion.hitMs / 1000 : 0) })
  assert.deepEqual(ev.map(e => +e.t0.toFixed(3)), [10, 10.22, 10, 10.54, 10, 10])
})
