// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の数値
// ------------------------------------------------------------
// 装備の一覧は equipment.js（エリア×レア度×種類）。ユーザー決定（2026-10-09）：
//   ・装備は**アイテムLV**を持つ。**エリアとレア度で決まる**（equipment.js の reqLvOf・ユーザーの表）。
//     【確定】2026-10-13 必要LVはアイテムLVと別：エピック・レジェンダリーは アイテムLV − 5（equipment.js の needLvOf・強さはアイテムLVのまま）
//   ・強さはレア度（ノーマル1.0／レア1.25／エピック1.5／レジェンダリー1.75）とアイテムLVで決まる
//     （必要LVが高いほど強い：同じLVの本体の戦闘力に合わせて伸びる＝LVが5上がるごとに同じだけ上がる）。
//     **同じLVのノーマルを全部の枠にそろえると、本体（LVぶんの戦闘力）と同じくらい**
//   ・必要LVに足りなくても装備はできる。**不足1LVごとに効果-5%・下げ幅は最大90%**
//   ・防具のメリット：重鎧＝受けるダメージ−1%／軽装＝AGI+1%（1部位ごと・2026-10-12 ユーザー指示で −3%／+5% から下げた）。
//     ★必要LVに足りないときは、ステと同じ割合でメリットも弱まる
//
//   ・【確定】2026-10-10 強化値（+1〜+10）：+1 ごとに元の強さの0.1倍ずつ足す（足し算・+10で2倍。smith.js）。
//     2026-10-12 から**最低でも+1ずつ**（下の powerAt）。
//     強くなるのはステだけ（防具のメリットは変わらない）。必要LV不足の弱まり方は強化したあとの強さに掛ける
//
// ★ルーン・合成・進化は作らない（決まったら足す）。
// ============================================================
import { STAT_KEYS } from '../../v2/lib/stats.js'
import { RARITY_BASE, PART_MULT, ARMOR_EFFECT, needLvOf } from './equipment.js'
import { bodyPowerAt } from './level.js'
import { plusMultOf, PLUS_MAX } from './smith.js'

// 「同じLVのノーマルを全部の枠にそろえたとき、本体の何倍か」（2026-10-09 ユーザー決定＝1倍。前のCランクと同じ）
export const GEAR_RATIO = 1
// 7枠の部位倍率の合計（武器2.0・頭1.0・鎧1.3・腕1.0・足1.0・アクセ0.8×2）
export const SET_PART_SUM = 7.9
export const N_SET_BASE = RARITY_BASE.N * SET_PART_SUM   // 316

// 装備の戦闘力（レア度の基礎×部位倍率を、アイテムLVの本体の戦闘力で伸ばす）。レア度は装備そのものが持つ。
// plus＝強化値（+1ごとに0.1倍ずつ足す）。丸めは強化の倍率を掛けたあとに1回だけ。
// 【確定】2026-10-12 ユーザーが選んだ「最低でも+1にする」：強化値ぶんは**最低でも+1ずつ**
//   （元の強さが10未満の装備は0.1倍が1に届かず、+1しても数字が動かない回があった＝古びた耳飾り 4→4→5→5…）。
//   元の強さが10以上なら0.1倍が1以上なので今までと同じ
const basePowerOf = (item, ilv) =>
  (RARITY_BASE[item?.rarity] || 0) * (PART_MULT[item?.part] || 1) * bodyPowerAt(ilv) * GEAR_RATIO / N_SET_BASE
export const powerAt = (item, ilv, plus = 0) => {
  const base = basePowerOf(item, ilv)
  const n = plus > 0 ? Math.min(PLUS_MAX, plus) : 0
  return Math.max(1, Math.round(base * plusMultOf(n)), Math.round(base) + n)
}

// ===== 必要LV =====
export const PENALTY_PER_LV = 5    // 不足1LVごとに -5%
export const PENALTY_MIN_PCT = 10  // どれだけ足りなくても10%は残る（下げ幅は最大90%）
// need＝必要LV・lv＝いまのLV。★装備から出すときは下の reqPctOf を使う（アイテムLVをそのまま渡さない）
export const effectPct = (need, lv) =>
  Math.max(PENALTY_MIN_PCT, 100 - PENALTY_PER_LV * Math.max(0, (need || 1) - (lv || 1)))
// 装備（item と アイテムLV ilv）を、いまのLVで着けたときの効果(%)。必要LVは equipment.js の needLvOf（2026-10-13）
export const reqPctOf = (item, ilv, lv) => effectPct(needLvOf(item, ilv), lv)

// 必要LVに足りないときの戦闘力：効果%を掛けて丸め、**最低でも1下げる**（下は0まで）。効果100%ならそのまま
// 【確定】2026-10-12 ユーザー指示「最低でも1下げるようにして」（前は「戦闘力 7 → 7（効果95%）」のように、丸めで下がらないことがあった）
export const underLvPowerOf = (power, pct = 100) =>
  (pct >= 100 ? power : Math.max(0, Math.min(Math.round(power * pct / 100), power - 1)))

// 戦闘力を配分どおりにステへ散らす（今のⅡの statsOf と同じ散らし方）。
// pct は必要LV不足の効果(%)。散らす前の戦闘力（強化値ぶん込み）に掛ける（最低でも1下げる＝underLvPowerOf）
export const statsAt = (item, ilv, pct = 100, plus = 0) => {
  const p = underLvPowerOf(powerAt(item, ilv, plus), pct)
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  if (p <= 0 || !item) return out
  for (const [k, v] of Object.entries(item.dist)) out[k] = Math.round(p * v / 100)
  const top = Object.entries(item.dist).sort((a, b) => b[1] - a[1])[0][0]
  out[top] += p - Object.values(out).reduce((a, b) => a + b, 0)
  return out
}
// いまのLVで着けたときの戦闘力（必要LV不足ぶんを引いたもの）
export const effectivePowerAt = (item, ilv, lv, plus = 0) => underLvPowerOf(powerAt(item, ilv, plus), reqPctOf(item, ilv, lv))

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
  // ★倍率は小数4桁まで（1部位1%にしたので、2桁だと必要LV不足で弱まった0.5%などが丸めで消える）
  return { takenPct: r(takenPct), agiPct: r(agiPct), takenMult: Math.round((1 + takenPct / 100) * 10000) / 10000 }
}
// 1つの防具の効果の文（重鎧＝「受けるダメージ−1%」・軽装＝「AGI+1%」）。必要LVに足りないときは上と同じ割合で弱まる。防具でなければ ''
export const armorEffectText = (item, pct = 100) => {
  const e = ARMOR_EFFECT[item?.line]
  if (!e) return ''
  const r = (v) => Math.round(v * (pct ?? 100)) / 100
  return e.takenPct ? `受けるダメージ−${r(-e.takenPct)}%` : `AGI+${r(e.agiPct)}%`
}
