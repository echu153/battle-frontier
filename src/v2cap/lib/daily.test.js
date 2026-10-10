// v2cap：デイリーミッションの決まりを固定するテスト（node --test）
// 【確定】2026-10-10 ユーザー指示（docs/v2cap-design.md「デイリーミッション」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needExp, MAX_LV } from './level.js'
import { DAY_RESET_HOUR as V2_DAY_RESET_HOUR } from '../../v2/lib/daily.js'
import {
  DAILY_TASKS, DAILY_TASK_KEYS, DAILY_EXP_PCT, dailyPctOf, DAILY_GOLD_PER_LV, dailyRewardOf,
  dailyOf, taskProgressOf, doneCountOf, isDailyComplete, claimErrorOf, dayOf, DAY_RESET_HOUR,
} from './daily.js'

test('【確定】報酬は受注した時点のLVで決まる：EXP＝必要EXP×%（〜10は10%・〜30は5%・〜50は3%・51〜は1%・切り上げ）／Gold＝LV×100', () => {
  assert.deepEqual(DAILY_EXP_PCT, [[10, 10], [30, 5], [50, 3], [Infinity, 1]])
  for (const [lv, pct] of [[1, 10], [10, 10], [11, 5], [30, 5], [31, 3], [50, 3], [51, 1], [99, 1], [100, 1]]) {
    assert.equal(dailyPctOf(lv), pct, `LV${lv}は${pct}%`)
  }
  assert.equal(DAILY_GOLD_PER_LV, 100)
  for (let lv = 1; lv <= MAX_LV; lv++) {
    const r = dailyRewardOf(lv)
    assert.equal(r.exp, Math.ceil(needExp(lv) * dailyPctOf(lv) / 100), `LV${lv}のEXPは切り上げ`)
    assert.equal(r.gold, lv * 100)
  }
  // ユーザーに見せた表（切り上げ）。★最初に見せた表は LV30・40・50・51・90 を四捨五入で出していて1少なかった（2026-10-10 に訂正して伝えた）
  const shown = {
    1: [1, 100], 5: [2, 500], 10: [14, 1000], 11: [9, 1100], 20: [54, 2000], 30: [183, 3000], 31: [121, 3100],
    40: [260, 4000], 50: [507, 5000], 51: [180, 5100], 60: [292, 6000], 75: [570, 7500], 90: [985, 9000],
    99: [1310, 9900], 100: [0, 10000],
  }
  for (const [lv, [exp, gold]] of Object.entries(shown)) assert.deepEqual(dailyRewardOf(Number(lv)), { exp, gold }, `LV${lv}`)
})

test('【仮】ミッションは「出撃に10回勝つ」1つ（内容はあとで決める＝ユーザー指示）', () => {
  assert.deepEqual(DAILY_TASKS, [{ key:'win', label:'出撃に勝つ', goal:10, unit:'回' }])
  assert.deepEqual(DAILY_TASK_KEYS, ['win'])
})

test('日付が変わるのは日本時間の5時（今のⅡと同じ）。前の日の受注・進み・受け取りは持ち越さない', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  assert.equal(DAY_RESET_HOUR, V2_DAY_RESET_HOUR)
  const before = new Date('2026-10-11T04:59:00+09:00')
  const after = new Date('2026-10-11T05:00:00+09:00')
  assert.equal(dayOf(before), '2026-10-10')
  assert.equal(dayOf(after), '2026-10-11')
  const prof = { daily_day: '2026-10-10', daily_lv: 12, daily_counts: { win: 7 }, daily_claimed: false }
  assert.deepEqual(dailyOf(prof, before), { accepted: true, lv: 12, counts: { win: 7 }, claimed: false })
  assert.deepEqual(dailyOf(prof, after), { accepted: false, lv: null, counts: { win: 0 }, claimed: false }, '5時を過ぎたら空')
  // SQLを流す前の行（列が無い）・まだ受注していない日
  assert.deepEqual(dailyOf({}, after), { accepted: false, lv: null, counts: { win: 0 }, claimed: false })
  assert.equal(dailyOf({ daily_day: '2026-10-11', daily_lv: null, daily_counts: { win: 3 } }, after).accepted, false)
})

test('受け取れる条件：受注している・まだ受け取っていない・全部そろっている（文言と見る順はサーバーと同じ）', () => {
  const at = new Date('2026-10-11T12:00:00+09:00')
  const day = '2026-10-11'
  const d = (lv, win, claimed = false) => dailyOf({ daily_day: day, daily_lv: lv, daily_counts: { win }, daily_claimed: claimed }, at)
  assert.equal(claimErrorOf(d(null, 10)), 'まだ受注していません')
  assert.equal(claimErrorOf(d(20, 10, true)), '今日はもう受け取りました')
  assert.equal(claimErrorOf(d(20, 9)), 'まだ達成していない項目があります')
  assert.equal(claimErrorOf(d(20, 10)), null)
  assert.equal(claimErrorOf(d(20, 25)), null, '目標より多くても受け取れる')
  assert.deepEqual(taskProgressOf(d(20, 25), DAILY_TASKS[0]), { now: 10, goal: 10, done: true }, '表示は目標で止める')
  assert.equal(doneCountOf(d(20, 3)), 0)
  assert.equal(doneCountOf(d(20, 10)), 1)
  assert.equal(isDailyComplete(d(null, 10)), false, '受注していなければ達成ではない')
})
