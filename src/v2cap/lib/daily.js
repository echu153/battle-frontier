// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— デイリーミッション
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「V2と一緒でデイリーミッションを追加したい、報酬は自分のレベルによって変わる」＋決めたこと：
//   ・1日1組。**難易度はなし**（1種類）。「受注」してから進みを数える（受注する前にやったことは数えない）
//   ・報酬は**受注した時点のLV**で決まる：
//       EXP  … 【確定】2026-10-12 ユーザー指示「後半で大きくもらいすぎないように調整してた、そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」：
//               **そのLVの推奨の場所（areas.js の recSpotOfLv）で10回出撃したくらい**＝ふつうの敵の1体あたりのEXPのまんなか×10（tenSortieExpOf）。
//               前は「必要EXP × %（LV1〜10は10%・11〜30は5%・31〜50は3%・51〜は1%）」で、序盤はEXP+3など1戦ぶんしかなかった。
//               EXPは戦闘と同じ扱い（いまの職業のClassEXPにも同じ量が入る）
//       Gold … そのLV × 100
//   ・日付が変わるのは日本時間の5時（今のⅡと同じ＝ src/v2/lib/daily.js の dayOf をそのまま使う）
//   ・**ミッションの内容はあとで決める**（ユーザー指示）。それまでは仮の「出撃に10回勝つ」1つ（ユーザー決定）
// ★数える権威はサーバー（出撃の精算が v2cap_daily_bump を呼ぶ）。受注・受け取りもサーバー（v2cap_daily_accept／_claim）。
//   ここは表示と判定の写し。ミッションの一覧はSQLの種（v2cap_daily_tasks）を tools/v2cap-sql.mjs がここから作る
// ============================================================
import { tenSortieExpOf } from './areas.js'
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
// EXPはそのLVの推奨の場所で10回出撃したくらい（SQLの v2cap_daily_reward も v2cap_ten_sortie_exp で同じ）・Gold＝LV×100
export const DAILY_SORTIES = 10
export const DAILY_GOLD_PER_LV = 100
export const dailyRewardOf = (lv) => {
  const l = Math.max(1, lv || 1)
  return { exp: tenSortieExpOf(l), gold: l * DAILY_GOLD_PER_LV }
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
