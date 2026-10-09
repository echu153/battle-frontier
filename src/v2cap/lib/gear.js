// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の数値
// ------------------------------------------------------------
// 装備の一覧は equipment.js（エリア×レア度×種類）。ユーザー決定（2026-10-09）：
//   ・装備は**アイテムLV**を持つ。アイテムLV＝**必要LV**＝**エリアとレア度で決まる**（equipment.js の reqLvOf・ユーザーの表）
//   ・強さはレア度（ノーマル1.0／レア1.25／エピック1.5／レジェンダリー1.75）とアイテムLVで決まる
//     （必要LVが高いほど強い：同じLVの本体の戦闘力に合わせて伸びる＝LVが5上がるごとに同じだけ上がる）。
//     **同じLVのノーマルを全部の枠にそろえると、本体（LVぶんの戦闘力）と同じくらい**
//   ・必要LVに足りなくても装備はできる。**不足1LVごとに効果-5%・下げ幅は最大90%**
//   ・防具のメリット：重鎧＝受けるダメージ−3%／軽装＝AGI+5%（1部位ごと）。
//     ★必要LVに足りないときは、ステと同じ割合でメリットも弱まる
//
//   ・【確定】2026-10-10 強化値（+1〜+10）：+1 ごとに元の強さの0.1倍ずつ足す（足し算・+10で2倍。smith.js）。
//     強くなるのはステだけ（防具のメリットは変わらない）。必要LV不足の弱まり方は強化したあとの強さに掛ける
//
// ★ルーン・合成・進化は作らない（決まったら足す）。
// ============================================================
import { STAT_KEYS } from '../../v2/lib/stats.js'
import { RARITY_BASE, PART_MULT, ARMOR_EFFECT } from './equipment.js'
import { bodyPowerAt } from './level.js'
import { plusMultOf } from './smith.js'

// 「同じLVのノーマルを全部の枠にそろえたとき、本体の何倍か」（2026-10-09 ユーザー決定＝1倍。前のCランクと同じ）
export const GEAR_RATIO = 1
// 7枠の部位倍率の合計（武器2.0・頭1.0・鎧1.3・腕1.0・足1.0・アクセ0.8×2）
export const SET_PART_SUM = 7.9
export const N_SET_BASE = RARITY_BASE.N * SET_PART_SUM   // 316

// 装備の戦闘力（レア度の基礎×部位倍率を、アイテムLVの本体の戦闘力で伸ばす）。レア度は装備そのものが持つ。
// plus＝強化値（+1ごとに0.1倍ずつ足す）。丸めは強化の倍率を掛けたあとに1回だけ
export const powerAt = (item, ilv, plus = 0) =>
  Math.max(1, Math.round((RARITY_BASE[item?.rarity] || 0) * (PART_MULT[item?.part] || 1) * bodyPowerAt(ilv) * GEAR_RATIO / N_SET_BASE * plusMultOf(plus)))

// ===== 必要LV =====
export const PENALTY_PER_LV = 5    // 不足1LVごとに -5%
export const PENALTY_MIN_PCT = 10  // どれだけ足りなくても10%は残る（下げ幅は最大90%）
export const effectPct = (ilv, lv) =>
  Math.max(PENALTY_MIN_PCT, 100 - PENALTY_PER_LV * Math.max(0, (ilv || 1) - (lv || 1)))

// 戦闘力を配分どおりにステへ散らす（今のⅡの statsOf と同じ散らし方）。
// pct は必要LV不足の効果(%)。散らす前の戦闘力（強化値ぶん込み）に掛ける
export const statsAt = (item, ilv, pct = 100, plus = 0) => {
  const p = Math.round(powerAt(item, ilv, plus) * pct / 100)
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  if (p <= 0 || !item) return out
  for (const [k, v] of Object.entries(item.dist)) out[k] = Math.round(p * v / 100)
  const top = Object.entries(item.dist).sort((a, b) => b[1] - a[1])[0][0]
  out[top] += p - Object.values(out).reduce((a, b) => a + b, 0)
  return out
}
// いまのLVで着けたときの戦闘力（必要LV不足ぶんを引いたもの）
export const effectivePowerAt = (item, ilv, lv, plus = 0) => Math.round(powerAt(item, ilv, plus) * effectPct(ilv, lv) / 100)

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
