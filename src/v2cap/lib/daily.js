// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— デイリーミッション
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「V2と一緒でデイリーミッションを追加したい、報酬は自分のレベルによって変わる」＋決めたこと：
//   ・1日1組。**難易度はなし**（1種類）。「受注」してから進みを数える（受注する前にやったことは数えない）
//   ・報酬は**受注した時点のLV**で決まる：
//       EXP  … そのLVの必要EXP × %（LV1〜10は10%・11〜30は5%・31〜50は3%・51〜は1%）。端数は切り上げ（LV1でも1）。
//               LV100は必要EXPが0なので0。EXPは戦闘と同じ扱い（いまの職業のClassEXPにも同じ量が入る）
//       Gold … そのLV × 100
//   ・日付が変わるのは日本時間の5時（今のⅡと同じ＝ src/v2/lib/daily.js の dayOf をそのまま使う）
//   ・**ミッションの内容はあとで決める**（ユーザー指示）。それまでは仮の「出撃に10回勝つ」1つ（ユーザー決定）
// ★数える権威はサーバー（出撃の精算が v2cap_daily_bump を呼ぶ）。受注・受け取りもサーバー（v2cap_daily_accept／_claim）。
//   ここは表示と判定の写し。ミッションの一覧はSQLの種（v2cap_daily_tasks）を tools/v2cap-sql.mjs がここから作る
// ============================================================
import { needExp } from './level.js'
import { dayOf, isToday, nextResetAt, DAY_RESET_HOUR } from '../../v2/lib/daily.js'

export { dayOf, isToday, nextResetAt, DAY_RESET_HOUR }

// ===== ミッション =====
// key は v2cap_profiles.daily_counts のキー。goal を全部満たすと受け取れる
// 【仮】内容はあとで決める（ユーザー指示）。入れ替えたら、数える所（v2cap_daily_bump を呼ぶRPC）も足すこと
export const DAILY_TASKS = [
  { key:'win', label:'出撃に勝つ', goal:10, unit:'回' },
]
export const DAILY_TASK_KEYS = DAILY_TASKS.map(t => t.key)

// ===== 報酬 =====
// EXPの%（受注した時点のLVで決まる）。[このLVまで, %]
export const DAILY_EXP_PCT = [[10, 10], [30, 5], [50, 3], [Infinity, 1]]
export const dailyPctOf = (lv) => DAILY_EXP_PCT.find(([max]) => Math.max(1, lv || 1) <= max)[1]
export const DAILY_GOLD_PER_LV = 100
// 切り上げは整数で計算する（SQLの v2cap_daily_reward と同じ：(必要EXP×% + 99) ÷ 100）
export const dailyRewardOf = (lv) => {
  const l = Math.max(1, lv || 1)
  return { exp: Math.floor((needExp(l) * dailyPctOf(l) + 99) / 100), gold: l * DAILY_GOLD_PER_LV }
}

// ===== 今日の状態 =====
// prof … v2cap_profiles の行。日付が変わっていれば「まだ受注していない・0回・受け取っていない」として読む
export const dailyOf = (prof, at = new Date()) => {
  const today = isToday(prof?.daily_day, at)
  const lv = today && prof?.daily_lv != null ? Number(prof.daily_lv) : null
  const raw = (today && prof?.daily_counts) || {}
  return {
    accepted: lv !== null,
    lv,
    counts: Object.fromEntries(DAILY_TASK_KEYS.map(k => [k, Math.max(0, Math.floor(Number(raw[k]) || 0))])),
    claimed: today && !!prof?.daily_claimed,
  }
}
// 1つぶんの進み具合 { now, goal, done }
export const taskProgressOf = (d, task) => {
  const n = d?.counts?.[task.key] || 0
  return { now: Math.min(n, task.goal), goal: task.goal, done: n >= task.goal }
}
// 終わった数（畳んでいるときの「1/1」）
export const doneCountOf = (d) => DAILY_TASKS.filter(t => taskProgressOf(d, t).done).length
// 全部そろったか（受注していなければ false）
export const isDailyComplete = (d) => !!d?.accepted && DAILY_TASKS.every(t => taskProgressOf(d, t).done)
// 受け取れないわけ（受け取れるなら null）。文言と見る順はサーバー（v2cap_daily_claim）と同じ
export const claimErrorOf = (d) => {
  if (!d?.accepted) return 'まだ受注していません'
  if (d.claimed) return '今日はもう受け取りました'
  if (!isDailyComplete(d)) return 'まだ達成していない項目があります'
  return null
}
