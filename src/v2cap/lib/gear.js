// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の数値
// ------------------------------------------------------------
// 装備の一覧は equipment.js（この版の基本装備）。ユーザー決定（2026-10-09）：
//   ・装備は**アイテムLV**を持つ。アイテムLV＝**落としたときの敵のLV**＝**必要LV**
//   ・強さはランク（F〜S）とアイテムLVで決まる。
//     **同じLVのCランクを全部の枠にそろえると、本体（LVぶんの戦闘力）と同じくらい**
//   ・必要LVに足りなくても装備はできる。**不足1LVごとに効果-5%・下げ幅は最大90%**
//   ・防具のメリット：重鎧＝受けるダメージ−3%／軽装＝AGI+5%（1部位ごと）。
//     ★必要LVに足りないときは、ステと同じ割合でメリットも弱まる
//
// ★強化（＋値）・ルーン・合成・進化は土台では作らない（鍛冶屋を作るときに決める）。
// ============================================================
import { STAT_KEYS } from '../../v2/lib/stats.js'
import { RANK_BASE, PART_MULT, ARMOR_EFFECT } from './equipment.js'
import { bodyPowerAt } from './level.js'

// 「同じLVのCランクを全部の枠にそろえたとき、本体の何倍か」（2026-10-09 ユーザー決定＝1倍）
export const GEAR_RATIO = 1
// 7枠の部位倍率の合計（武器2.0・頭1.0・鎧1.3・腕1.0・足1.0・アクセ0.8×2）
export const SET_PART_SUM = 7.9
export const C_SET_BASE = RANK_BASE.C * SET_PART_SUM   // 316

// 装備の戦闘力（ランクの基礎×部位倍率を、アイテムLVの本体の戦闘力で伸ばす）
export const powerAt = (item, rank, ilv) =>
  Math.max(1, Math.round((RANK_BASE[rank] || 0) * (PART_MULT[item?.part] || 1) * bodyPowerAt(ilv) * GEAR_RATIO / C_SET_BASE))

// ===== 必要LV =====
export const PENALTY_PER_LV = 5    // 不足1LVごとに -5%
export const PENALTY_MIN_PCT = 10  // どれだけ足りなくても10%は残る（下げ幅は最大90%）
export const effectPct = (ilv, lv) =>
  Math.max(PENALTY_MIN_PCT, 100 - PENALTY_PER_LV * Math.max(0, (ilv || 1) - (lv || 1)))

// 戦闘力を配分どおりにステへ散らす（今のⅡの statsOf と同じ散らし方）。
// pct は必要LV不足の効果(%)。散らす前の戦闘力に掛ける
export const statsAt = (item, rank, ilv, pct = 100) => {
  const p = Math.round(powerAt(item, rank, ilv) * pct / 100)
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  if (p <= 0 || !item) return out
  for (const [k, v] of Object.entries(item.dist)) out[k] = Math.round(p * v / 100)
  const top = Object.entries(item.dist).sort((a, b) => b[1] - a[1])[0][0]
  out[top] += p - Object.values(out).reduce((a, b) => a + b, 0)
  return out
}
// いまのLVで着けたときの戦闘力（必要LV不足ぶんを引いたもの）
export const effectivePowerAt = (item, rank, ilv, lv) => Math.round(powerAt(item, rank, ilv) * effectPct(ilv, lv) / 100)

// ===== 防具のメリット =====
// worn = [{ item, pct }]（着けている防具と、その効果%）。
// 返すのは 受けるダメージの倍率（1未満で軽くなる）と AGI の上がり幅(%)
export const armorEffects = (worn) => {
  let takenPct = 0
  let agiPct = 0
  for (const { item, pct } of worn || []) {
    const e = ARMOR_EFFECT[item?.line]
    if (!e) continue
    const k = (pct ?? 100) / 100
    if (e.takenPct) takenPct += e.takenPct * k
    if (e.agiPct) agiPct += e.agiPct * k
  }
  const r = (v) => Math.round(v * 100) / 100
  return { takenPct: r(takenPct), agiPct: r(agiPct), takenMult: r(1 + takenPct / 100) }
}
