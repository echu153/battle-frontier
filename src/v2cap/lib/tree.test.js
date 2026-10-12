// v2cap：ユグレシアの宝樹の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示・承認の表（docs/v2cap-design.md「ユグレシアの宝樹」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LV } from './level.js'
import { tenSortieExpOf } from './areas.js'
import { FORTUNES, FORTUNE_BY_NAME, multTenthsOf, prayExpOf, canPray, DAY_RESET_HOUR } from './tree.js'

test('【確定】運勢は今のⅡと同じ7つ（出やすさ・倍率＝ユーザー承認の表。大吉で3倍）', () => {
  assert.deepEqual(FORTUNES.map(f => f.name), ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'])
  assert.deepEqual(FORTUNES.map(f => f.weight), [5, 10, 15, 25, 20, 15, 10])
  assert.equal(FORTUNES.reduce((t, f) => t + f.weight, 0), 100)
  assert.deepEqual(FORTUNES.map(f => f.mult), [3, 2, 1.5, 1, 0.7, 0.4, 0.2])
  assert.deepEqual(FORTUNES.map(multTenthsOf), [30, 20, 15, 10, 7, 4, 2])
})

test('【確定】2026-10-12 経験値＝祈った時点のLVの推奨の場所で10回出撃したくらい（デイリーと同じ）×運勢の倍率・切り上げ', () => {
  // ユーザー指示「そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」→宝樹も「同じにする」を選んだ（前は必要EXPの2〜0.1%）
  for (let lv = 1; lv <= MAX_LV; lv++) {
    for (const f of FORTUNES) assert.equal(prayExpOf(lv, f), Math.ceil(tenSortieExpOf(lv) * multTenthsOf(f) / 10), `LV${lv} ${f.name}`)
  }
  // 吉＝10回ぶんそのまま・大吉＝30回ぶん・大凶＝2回ぶん
  for (const lv of [1, 5, 30, 80, 100]) {
    assert.equal(prayExpOf(lv, FORTUNE_BY_NAME['吉']), tenSortieExpOf(lv))
    assert.equal(prayExpOf(lv, FORTUNE_BY_NAME['大吉']), tenSortieExpOf(lv) * 3)
  }
  // 始まりの森①（1体 EXP2〜3）のLV：吉で25・大吉で75（前は吉でEXP+1）
  assert.deepEqual(FORTUNES.map(f => prayExpOf(1, f)), [75, 50, 38, 25, 18, 10, 5])
})

test('1日1回・日付が変わるのは日本時間の5時（今のⅡと同じ）', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  const prayed = new Date('2026-10-11T10:00:00+09:00')
  assert.equal(canPray(null), true)
  assert.equal(canPray(prayed, new Date('2026-10-12T04:59:00+09:00')), false, '翌朝5時までは祈れない')
  assert.equal(canPray(prayed, new Date('2026-10-12T05:00:00+09:00')), true)
})
