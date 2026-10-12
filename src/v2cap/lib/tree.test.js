// v2cap：ユグレシアの宝樹の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示・承認の表（docs/v2cap-design.md「ユグレシアの宝樹」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needExp, MAX_LV } from './level.js'
import { FORTUNES, FORTUNE_BY_NAME, PRAY_PERMIL, prayPermilOf, prayPctText, multTenthsOf, prayExpOf, canPray, DAY_RESET_HOUR } from './tree.js'

test('【確定】運勢は今のⅡと同じ7つ（出やすさ・倍率＝ユーザー承認の表。大吉で3倍）', () => {
  assert.deepEqual(FORTUNES.map(f => f.name), ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'])
  assert.deepEqual(FORTUNES.map(f => f.weight), [5, 10, 15, 25, 20, 15, 10])
  assert.equal(FORTUNES.reduce((t, f) => t + f.weight, 0), 100)
  assert.deepEqual(FORTUNES.map(f => f.mult), [3, 2, 1.5, 1, 0.7, 0.4, 0.2])
  assert.deepEqual(FORTUNES.map(multTenthsOf), [30, 20, 15, 10, 7, 4, 2])
})

test('【確定】経験値＝祈った時点のLVの必要EXP×（〜30は2%・〜50は1%・〜80は0.5%・81〜は0.1%）×運勢の倍率・切り上げ', () => {
  assert.deepEqual(PRAY_PERMIL, [[30, 20], [50, 10], [80, 5], [Infinity, 1]])
  for (const [lv, txt] of [[1, '2%'], [30, '2%'], [31, '1%'], [50, '1%'], [51, '0.5%'], [80, '0.5%'], [81, '0.1%'], [100, '0.1%']]) {
    assert.equal(prayPctText(lv), txt, `LV${lv}`)
  }
  for (let lv = 1; lv <= MAX_LV; lv++) {
    for (const f of FORTUNES) {
      const want = Math.ceil(needExp(lv) * prayPermilOf(lv) * multTenthsOf(f) / 10000)
      assert.equal(prayExpOf(lv, f), want, `LV${lv} ${f.name}`)
    }
  }
  // ユーザーに見せて承認された表（大吉・中吉・小吉・吉・末吉・凶・大凶）
  // ★2026-10-12 必要EXPを「20＋0.162×LV³」にした（ユーザー指示「通常のレベルはもう少しレベル上げにくく」）ので、同じ%のまま約1.2倍になった
  //   （前の表：LV30 219/146/110/73/52/30/15・LV50 507/…・LV80 1037/…・LV99 393/…）
  const shown = {
    1: [2, 1, 1, 1, 1, 1, 1],
    30: [264, 176, 132, 88, 62, 36, 18],
    50: [609, 406, 305, 203, 142, 82, 41],
    80: [1245, 830, 623, 415, 291, 166, 83],
    99: [472, 315, 236, 158, 111, 63, 32],
    100: [0, 0, 0, 0, 0, 0, 0],
  }
  for (const [lv, row] of Object.entries(shown)) {
    assert.deepEqual(FORTUNES.map(f => prayExpOf(Number(lv), f)), row, `LV${lv}`)
  }
  assert.equal(prayExpOf(40, FORTUNE_BY_NAME['吉']), 104)
})

test('1日1回・日付が変わるのは日本時間の5時（今のⅡと同じ）', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  const prayed = new Date('2026-10-11T10:00:00+09:00')
  assert.equal(canPray(null), true)
  assert.equal(canPray(prayed, new Date('2026-10-12T04:59:00+09:00')), false, '翌朝5時までは祈れない')
  assert.equal(canPray(prayed, new Date('2026-10-12T05:00:00+09:00')), true)
})
