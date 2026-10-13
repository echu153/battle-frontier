// v2cap：ユグレシアの宝樹の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示・承認の表（docs/v2cap-design.md「ユグレシアの宝樹」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LV } from './level.js'
import { tenSortieExpOf } from './areas.js'
import { FORTUNES, FORTUNE_BY_NAME, multTenthsOf, prayExpOf, canPray, DAY_RESET_HOUR, STREAK_PCT, streakPctOf, nextStreakOf, streakStateOf } from './tree.js'

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

// 【確定】2026-10-14 ユーザー指示「毎日祈ってたらもらえる経験値が少しだけ増えるようにして。2日目で1.1倍、10日目で2倍になるように。
//   途切れたらやり直し、更新タイミングはAM5時」＋ユーザーが選んだ「毎日+0.1・10日目だけ+0.2」「11日目からは2倍のまま」
test('【確定】毎日祈ったときのボーナス：1日目1倍・2日目1.1倍…9日目1.8倍・10日目2倍・11日目からも2倍', () => {
  assert.deepEqual(STREAK_PCT, [100, 110, 120, 130, 140, 150, 160, 170, 180, 200])
  assert.equal(streakPctOf(1), 100)
  assert.equal(streakPctOf(2), 110)
  assert.equal(streakPctOf(10), 200)
  for (const d of [11, 15, 100, 365]) assert.equal(streakPctOf(d), 200, `${d}日目`)
  // 1日目は前と同じEXP・10日目はちょうど2倍（倍率に端数が無い運勢）
  for (const lv of [1, 10, 30, 80]) {
    assert.equal(prayExpOf(lv, FORTUNE_BY_NAME['吉'], 1), prayExpOf(lv, FORTUNE_BY_NAME['吉']))
    assert.equal(prayExpOf(lv, FORTUNE_BY_NAME['吉'], 10), prayExpOf(lv, FORTUNE_BY_NAME['吉']) * 2)
    assert.equal(prayExpOf(lv, FORTUNE_BY_NAME['大吉'], 10), prayExpOf(lv, FORTUNE_BY_NAME['大吉']) * 2)
  }
  // LV10の吉：30 → 33 → 36 … → 54 → 60
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => prayExpOf(10, FORTUNE_BY_NAME['吉'], d)), [30, 33, 36, 39, 42, 45, 48, 51, 54, 60])
  // 切り上げは整数で：(基準 × 運勢10分率 × 連続の百分率 + 999) ÷ 1000（サーバーと同じ）
  for (let lv = 1; lv <= MAX_LV; lv += 7) for (const f of FORTUNES) for (let d = 1; d <= 12; d++) {
    assert.equal(prayExpOf(lv, f, d), Math.ceil(tenSortieExpOf(lv) * multTenthsOf(f) * streakPctOf(d) / 1000), `LV${lv} ${f.name} ${d}日目`)
  }
})

test('【確定】連続日数：前に祈った日が昨日なら+1・今日ならそのまま・空いたら1日目（区切りは日本時間の5時）', () => {
  const at = (s) => new Date(`${s}+09:00`)
  const now = at('2026-10-14T12:00:00')
  assert.equal(nextStreakOf(null, 0, now), 1, 'はじめて')
  assert.equal(nextStreakOf(at('2026-10-13T21:00:00'), 3, now), 4, '昨日祈った')
  assert.equal(nextStreakOf(at('2026-10-14T04:59:00'), 3, now), 4, '今日の4:59は昨日のぶん（5時区切り）')
  assert.equal(nextStreakOf(at('2026-10-14T05:00:00'), 3, now), 3, '今日もう祈った（管理者がもう一度）＝増えない')
  assert.equal(nextStreakOf(at('2026-10-13T04:59:00'), 9, now), 1, '1日空いた＝1日目から')
  assert.equal(nextStreakOf(at('2026-10-13T21:00:00'), 0, now), 2, '数える前のキャラ（0）は前の日を1日目とみなす')
  assert.equal(nextStreakOf(at('2026-10-14T23:00:00'), 5, at('2026-10-15T05:00:00')), 6, '翌朝5時で次の日')

  // 画面の様子
  assert.deepEqual(streakStateOf(at('2026-10-13T21:00:00'), 3, now), { prayedToday: false, day: 4, pct: 130, nextPct: 140, broken: false })
  assert.deepEqual(streakStateOf(at('2026-10-14T08:00:00'), 4, now), { prayedToday: true, day: 4, pct: 130, nextPct: 140, broken: false })
  assert.deepEqual(streakStateOf(at('2026-10-12T08:00:00'), 5, now), { prayedToday: false, day: 1, pct: 100, nextPct: 110, broken: true })
  assert.equal(streakStateOf(null, 0, now).broken, false)
  assert.equal(streakStateOf(at('2026-10-14T08:00:00'), 12, now).nextPct, 200)
})
