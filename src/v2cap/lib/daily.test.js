// v2cap：デイリーミッションの決まりを固定するテスト（node --test）
// 【確定】2026-10-10 ユーザー指示（docs/v2cap-design.md「デイリーミッション」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LV } from './level.js'
import { SPOTS, recSpotOfLv, recLvOf, tenSortieExpOf } from './areas.js'
import { DAY_RESET_HOUR as V2_DAY_RESET_HOUR } from '../../v2/lib/daily.js'
import { TOWER_NAME } from './tower.js'
import {
  DAILY_TASKS, DAILY_TASK_KEYS, DAILY_SORTIES, DAILY_GOLD_PER_LV, dailyRewardOf,
  dailyOf, taskProgressOf, doneCountOf, isDailyComplete, claimErrorOf, dayOf, DAY_RESET_HOUR,
  GUARD_DONE_KEY, startCountsOf,
} from './daily.js'

// 4つとも 0回（日付が変わった・まだ受注していない日の読み方）
const ZERO = { win: 0, smith: 0, tower: 0, pray: 0 }

test('【確定】報酬は受注した時点のLVで決まる：EXP＝そのLVの推奨の場所で10回出撃したくらい（2026-10-12）／Gold＝LV×100', () => {
  // ユーザー指示「後半で大きくもらいすぎないように調整してた、そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」（前は必要EXPの10〜1%）
  assert.equal(DAILY_SORTIES, 10)
  assert.equal(DAILY_GOLD_PER_LV, 100)
  for (let lv = 1; lv <= MAX_LV; lv++) {
    const s = recSpotOfLv(lv)
    const r = dailyRewardOf(lv)
    assert.equal(r.exp, DAILY_SORTIES * (s.exp[0] + s.exp[1]) / 2, `LV${lv}：${s.name}の1体あたりのまんなか×10`)
    assert.equal(r.exp, tenSortieExpOf(lv))
    assert.equal(r.gold, lv * 100)
    assert.ok(recLvOf(s.id) >= lv || s.id === SPOTS.length, `LV${lv}の推奨の場所は、推奨LVの上限がLV${lv}以上`)
  }
  // 始まりの森①（1体 EXP3〜4）のLV1〜5：EXP+35（前はLV1でEXP+1・LV5で+2）／いちばん後ろ（深淵の海溝③・1体32〜34）：330
  // （2026-10-21 場所の経験値を最小・最大とも+1 → 25→35・320→330）
  for (const lv of [1, 5]) assert.equal(dailyRewardOf(lv).exp, 35)
  assert.equal(dailyRewardOf(MAX_LV).exp, 330)
  // 後ろほど大きくなる（下がらない）
  for (let lv = 2; lv <= MAX_LV; lv++) assert.ok(dailyRewardOf(lv).exp >= dailyRewardOf(lv - 1).exp, `LV${lv}`)
})

test('【確定】ミッションは4つ：出撃に10回勝つ（はじめの仮）＋2026-10-15 ユーザー指示の3つ（強化か分解・覇天塔に挑戦・宝樹に祈る＝どれも1回）', () => {
  assert.deepEqual(DAILY_TASKS, [
    { key:'win',   label:'出撃に勝つ', goal:10, unit:'回' },
    { key:'smith', label:'装備を強化または分解する', goal:1, unit:'回' },
    { key:'tower', label:'ジークヴァルトの覇天塔に挑戦する', goal:1, unit:'回' },
    { key:'pray',  label:'ユグレシアの宝樹に祈りをささげる', goal:1, unit:'回' },
  ])
  assert.deepEqual(DAILY_TASK_KEYS, ['win', 'smith', 'tower', 'pray'])
  assert.ok(DAILY_TASKS.find(t => t.key === 'tower').label.startsWith(TOWER_NAME), '塔の名前は tower.js の TOWER_NAME から（名前を変えたらついてくる）')
  assert.equal(new Set(DAILY_TASK_KEYS).size, DAILY_TASK_KEYS.length, 'キーは重ならない')
})

test('【確定】2026-10-15 ユーザーが選んだ「守っていれば達成」：受注したときに守護者なら、塔の項目だけ達成済みで始まる', () => {
  assert.equal(GUARD_DONE_KEY, 'tower')
  assert.ok(DAILY_TASK_KEYS.includes(GUARD_DONE_KEY))
  assert.deepEqual(startCountsOf({ tower_guard: 7 }), { tower: 1 })
  assert.deepEqual(startCountsOf({ tower_guard: 1 }), { tower: 1 }, '1層でも守護者')
  assert.deepEqual(startCountsOf({ tower_guard: null }), {})
  assert.deepEqual(startCountsOf({}), {}, '塔の列が無い前の行も')
  // 達成済みで始まっても、ほかの3つがそろうまでは受け取れない
  const at = new Date('2026-10-11T12:00:00+09:00')
  const d = dailyOf({ daily_day: '2026-10-11', daily_lv: 30, daily_counts: startCountsOf({ tower_guard: 7 }) }, at)
  assert.deepEqual(taskProgressOf(d, DAILY_TASKS[2]), { now: 1, goal: 1, done: true })
  assert.equal(doneCountOf(d), 1)
  assert.equal(claimErrorOf(d), 'まだ達成していない項目があります')
})

test('日付が変わるのは日本時間の5時（今のⅡと同じ）。前の日の受注・進み・受け取りは持ち越さない', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  assert.equal(DAY_RESET_HOUR, V2_DAY_RESET_HOUR)
  const before = new Date('2026-10-11T04:59:00+09:00')
  const after = new Date('2026-10-11T05:00:00+09:00')
  assert.equal(dayOf(before), '2026-10-10')
  assert.equal(dayOf(after), '2026-10-11')
  const prof = { daily_day: '2026-10-10', daily_lv: 12, daily_counts: { win: 7, pray: 1 }, daily_claimed: false }
  assert.deepEqual(dailyOf(prof, before), { accepted: true, lv: 12, counts: { ...ZERO, win: 7, pray: 1 }, claimed: false })
  assert.deepEqual(dailyOf(prof, after), { accepted: false, lv: null, counts: ZERO, claimed: false }, '5時を過ぎたら空（画面が自動で受注し直す）')
  // SQLを流す前の行（列が無い）・まだ受注していない日
  assert.deepEqual(dailyOf({}, after), { accepted: false, lv: null, counts: ZERO, claimed: false })
  assert.equal(dailyOf({ daily_day: '2026-10-11', daily_lv: null, daily_counts: { win: 3 } }, after).accepted, false)
})

test('受け取れる条件：受注している・まだ受け取っていない・4つ全部そろっている（文言と見る順はサーバーと同じ）', () => {
  const at = new Date('2026-10-11T12:00:00+09:00')
  const day = '2026-10-11'
  const all = { win: 10, smith: 1, tower: 1, pray: 1 }
  const d = (lv, counts, claimed = false) => dailyOf({ daily_day: day, daily_lv: lv, daily_counts: counts, daily_claimed: claimed }, at)
  assert.equal(claimErrorOf(d(null, all)), 'まだ受注していません')
  assert.equal(claimErrorOf(d(20, all, true)), '今日はもう受け取りました')
  assert.equal(claimErrorOf(d(20, { ...all, win: 9 })), 'まだ達成していない項目があります')
  for (const k of ['smith', 'tower', 'pray']) {
    assert.equal(claimErrorOf(d(20, { ...all, [k]: 0 })), 'まだ達成していない項目があります', `${k} が0回なら受け取れない`)
  }
  assert.equal(claimErrorOf(d(20, all)), null)
  assert.equal(claimErrorOf(d(20, { win: 25, smith: 3, tower: 2, pray: 5 })), null, '目標より多くても受け取れる')
  assert.deepEqual(taskProgressOf(d(20, { win: 25 }), DAILY_TASKS[0]), { now: 10, goal: 10, done: true }, '表示は目標で止める')
  assert.deepEqual(taskProgressOf(d(20, { smith: 3 }), DAILY_TASKS[1]), { now: 1, goal: 1, done: true })
  assert.equal(doneCountOf(d(20, { win: 3 })), 0)
  assert.equal(doneCountOf(d(20, { win: 10 })), 1)
  assert.equal(doneCountOf(d(20, all)), 4)
  assert.equal(isDailyComplete(d(null, all)), false, '受注していなければ達成ではない')
  assert.equal(isDailyComplete(d(20, all)), true)
})
