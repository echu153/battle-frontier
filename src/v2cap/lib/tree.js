// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ユグレシアの宝樹
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「ユグレシアの宝樹は祈ったら大凶～大吉が出る、出た結果によって経験値もらえる」＋決めたこと：
//   ・ごほうびは**経験値だけ**（今のⅡのGoldは出さない・ユーザー決定）。EXPは戦闘と同じ扱い（ClassEXPにも同じ量）
//   ・基準＝【確定】2026-10-12「デイリーミッションと同じにする」を選んだ：**祈った時点のLVの推奨の場所で10回出撃したくらい**
//     （areas.js の tenSortieExpOf）。前は「必要EXP × 2%（LV〜30）・1%（31〜50）・0.5%（51〜80）・0.1%（81〜）」で、序盤は吉でEXP+1だった
//   ・そこに運勢の倍率（大吉で3倍＝ユーザー「MAX3倍の振れ幅」）。端数は切り上げ
//   ・運勢の種類・出やすさ・倍率・色・ひとことは**今のⅡと同じ**（src/v2cap/core/tree.js の FORTUNES をそのまま使う）
//       大吉5%×3／中吉10%×2／小吉15%×1.5／吉25%×1／末吉20%×0.7／凶15%×0.4／大凶10%×0.2（数はユーザー承認の表）
//   ・1日1回・日付が変わるのは日本時間の5時（今のⅡと同じ）。この版は管理者しか入れないので、
//     今のⅡの「管理者は何回でも祈れる」は入れない（入れると全員が何回でも祈れてしまう）
// ★抽選と経験値はサーバー（v2cap_pray）。ここは表示とテストの写し（v2capsql.test.js が表を突き合わせる）
// ============================================================
import { tenSortieExpOf } from './areas.js'
import { FORTUNES, FORTUNE_BY_NAME, canPray, remainUntilPray, prayDayOf, DAY_RESET_HOUR } from '../core/tree.js'

export { FORTUNES, FORTUNE_BY_NAME, canPray, remainUntilPray, prayDayOf, DAY_RESET_HOUR }

// 運勢の倍率（10分率の整数。サーバーも整数で持つ）
export const multTenthsOf = (f) => Math.round((f?.mult ?? 1) * 10)

// ===== 毎日祈ったときのボーナス（連続日数）=====
// 【確定】2026-10-14 ユーザー指示「毎日祈ってたらもらえる経験値が少しだけ増えるようにして。2日目で1.1倍、10日目で2倍になるように。
//   途切れたらやり直し、更新タイミングはAM5時」＋ユーザーが選んだ：
//   ・毎日+0.1倍・10日目だけ+0.2倍（1日目1.0 → 2日目1.1 → … → 9日目1.8 → 10日目2.0）
//   ・11日目からは2倍のまま（途切れるまで）
//   ・日付の区切りは祈りと同じ日本時間の5時。1日でも祈らない日があると1日目に戻る
//   ・数えるのは「日」。管理者が同じ日に何回祈っても日数は増えない
//   ・【確定】同じ日にユーザー指示「説明以外に信仰心の文言いらない、連続ボーナスの詳細な記載もいらない」＝画面には日数も倍率も出さない
//     （説明文の「毎日祈ることで信仰心が上がっていきます。」だけ）。ここはサーバーの写しとテストのため
// ★サーバー（v2cap_pray の c_streak・pray_streak）と同じ。v2capsql.test.js が突き合わせる
export const STREAK_PCT = [100, 110, 120, 130, 140, 150, 160, 170, 180, 200]   // 1〜10日目の倍率（百分率）
export const STREAK_MAX_DAY = STREAK_PCT.length
export const streakPctOf = (day) => STREAK_PCT[Math.min(STREAK_MAX_DAY, Math.max(1, Math.floor(Number(day)) || 1)) - 1]
const DAY_MS = 24 * 60 * 60 * 1000
const asDate = (at) => (at instanceof Date ? at : new Date(at))
// 祈ったあとの連続日数。前に祈った日（日本時間5時区切り）が 今日＝そのまま／昨日＝+1／それより前・はじめて＝1
//   streak は前の連続日数（0＝まだ数えていない＝前の日を1日目とみなす）
export const nextStreakOf = (lastPrayAt, streak, at = new Date()) => {
  const last = lastPrayAt ? prayDayOf(lastPrayAt) : ''
  if (!last) return 1
  const now = asDate(at)
  const s = Math.max(1, Math.floor(Number(streak)) || 0)
  if (last === prayDayOf(now)) return s
  if (last === prayDayOf(new Date(now.getTime() - DAY_MS))) return s + 1
  return 1
}

// その運勢でもらえるEXP＝推奨の場所で10回出撃したくらい × 運勢の倍率 × 連続日数の倍率。
//   切り上げは整数で：(基準 × 倍率10分率 × 連続の百分率 + 999) ÷ 1000（サーバーと同じ）。1日目は前と同じ値
export const prayExpOf = (lv, f, day = 1) => Math.floor((tenSortieExpOf(Math.max(1, lv || 1)) * multTenthsOf(f) * streakPctOf(day) + 999) / 1000)
