// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の数値
// ------------------------------------------------------------
// 装備の一覧（名前・部位・種類・ランク・配分）は今のⅡと同じ＝ src/v2/lib/equipment.js。
// この版で変えたのは「強さの決まり方」だけ（2026-10-09 ユーザー決定）：
//   ・装備は**アイテムLV**を持つ。アイテムLV＝**落としたときの敵のLV**＝**必要LV**
//     （先のエリアで出たものほど必要LVも効果も高い）
//   ・強さはランク（F〜S）とアイテムLVで決まる。
//     **同じLVのCランクを8枠そろえると、本体（LVぶんの戦闘力）と同じくらい**
//   ・必要LVに足りなくても装備はできる。**不足1LVごとに効果-5%・下げ幅は最大90%**
//
// ★強化（＋値）・ルーン・合成・進化は土台では作らない（鍛冶屋を作るときに決める）。
// ============================================================
import { STAT_KEYS } from '../../v2/lib/stats.js'
import { powerOf as basePowerOf, RANK_BASE } from '../../v2/lib/equipment.js'
import { bodyPowerAt } from './level.js'

// 「同じLVのCランクを8枠そろえたとき、本体の何倍か」（2026-10-09 ユーザー決定＝1倍）
export const GEAR_RATIO = 1
// 8枠ぶんの部位倍率の合計（片手2本・頭・腕・足が1.0／鎧1.3／アクセ0.8×2）。
// Cランクの基礎40にこれを掛けた値が、本体と同じになるように割る
export const SET_PART_SUM = 7.9
export const C_SET_BASE = RANK_BASE.C * SET_PART_SUM   // 316

// 装備の戦闘力。今のⅡの「ランクの基礎×部位倍率」（powerOf の＋0）を、アイテムLVの本体の戦闘力で伸ばす
export const powerAt = (item, ilv) =>
  Math.max(1, Math.round(basePowerOf(item, 0) * bodyPowerAt(ilv) * GEAR_RATIO / C_SET_BASE))

// ===== 必要LV =====
export const PENALTY_PER_LV = 5    // 不足1LVごとに -5%
export const PENALTY_MIN_PCT = 10  // どれだけ足りなくても10%は残る（下げ幅は最大90%）
export const effectPct = (ilv, lv) =>
  Math.max(PENALTY_MIN_PCT, 100 - PENALTY_PER_LV * Math.max(0, (ilv || 1) - (lv || 1)))

// 戦闘力を配分どおりにステへ散らす（今のⅡの statsOf と同じ散らし方）。
// pct は必要LV不足の効果(%)。散らす前の戦闘力に掛ける
export const statsAt = (item, ilv, pct = 100) => {
  const p = Math.round(powerAt(item, ilv) * pct / 100)
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  if (p <= 0) return out
  for (const [k, v] of Object.entries(item.dist)) out[k] = Math.round(p * v / 100)
  const top = Object.entries(item.dist).sort((a, b) => b[1] - a[1])[0][0]
  out[top] += p - Object.values(out).reduce((a, b) => a + b, 0)
  return out
}
// いまのLVで着けたときの戦闘力（必要LV不足ぶんを引いたもの）
export const effectivePowerAt = (item, ilv, lv) => Math.round(powerAt(item, ilv) * effectPct(ilv, lv) / 100)
