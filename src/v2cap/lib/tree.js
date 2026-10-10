// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ユグレシアの宝樹
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「ユグレシアの宝樹は祈ったら大凶～大吉が出る、出た結果によって経験値もらえる」＋決めたこと：
//   ・ごほうびは**経験値だけ**（今のⅡのGoldは出さない・ユーザー決定）。EXPは戦闘と同じ扱い（ClassEXPにも同じ量）
//   ・基準＝**祈った時点のLVの必要EXP** × 2%（LV〜30）・1%（31〜50）・0.5%（51〜80）・0.1%（81〜）
//   ・そこに運勢の倍率（大吉で3倍＝ユーザー「MAX3倍の振れ幅」）。端数は切り上げ（LV1でも1）。LV100は0
//   ・運勢の種類・出やすさ・倍率・色・ひとことは**今のⅡと同じ**（src/v2/lib/tree.js の FORTUNES をそのまま使う）
//       大吉5%×3／中吉10%×2／小吉15%×1.5／吉25%×1／末吉20%×0.7／凶15%×0.4／大凶10%×0.2（数はユーザー承認の表）
//   ・1日1回・日付が変わるのは日本時間の5時（今のⅡと同じ）。この版は管理者しか入れないので、
//     今のⅡの「管理者は何回でも祈れる」は入れない（入れると全員が何回でも祈れてしまう）
// ★抽選と経験値はサーバー（v2cap_pray）。ここは表示とテストの写し（v2capsql.test.js が表を突き合わせる）
// ============================================================
import { needExp } from './level.js'
import { FORTUNES, FORTUNE_BY_NAME, canPray, remainUntilPray, prayDayOf, DAY_RESET_HOUR } from '../../v2/lib/tree.js'

export { FORTUNES, FORTUNE_BY_NAME, canPray, remainUntilPray, prayDayOf, DAY_RESET_HOUR }

// 基準の割合（千分率）。[このLVまで, 千分率]（2%＝20・1%＝10・0.5%＝5・0.1%＝1）
export const PRAY_PERMIL = [[30, 20], [50, 10], [80, 5], [Infinity, 1]]
export const prayPermilOf = (lv) => PRAY_PERMIL.find(([max]) => Math.max(1, lv || 1) <= max)[1]
export const prayPctText = (lv) => `${prayPermilOf(lv) / 10}%`
// 運勢の倍率（10分率の整数。サーバーも整数で持つ）
export const multTenthsOf = (f) => Math.round((f?.mult ?? 1) * 10)
// その運勢でもらえるEXP。切り上げは整数で：(必要EXP × 千分率 × 倍率10分率 + 9999) ÷ 10000（サーバーと同じ）
export const prayExpOf = (lv, f) => {
  const l = Math.max(1, lv || 1)
  return Math.floor((needExp(l) * prayPermilOf(l) * multTenthsOf(f) + 9999) / 10000)
}
