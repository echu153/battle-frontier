// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の数値
// ------------------------------------------------------------
// 装備の一覧は equipment.js（エリア×レア度×種類）。ユーザー決定（2026-10-09）：
//   ・装備は**アイテムLV**を持つ。**エリアとレア度で決まる**（equipment.js の reqLvOf・ユーザーの表）。
//     必要LVは equipment.js の needLvOf（いまはアイテムLVと同じ。2026-10-13 に一度エピック・レジェンダリーを −5 にして、同じ日に戻した）
//   ・強さはレア度（ノーマル1.0／レア1.25／エピック1.5／レジェンダリー1.75）とアイテムLVで決まる
//     （必要LVが高いほど強い：同じLVの本体の戦闘力に合わせて伸びる＝LVが5上がるごとに同じだけ上がる）。
//     **同じLVのノーマルを全部の枠にそろえると、本体（LVぶんの戦闘力）と同じくらい**
//   ・必要LVに足りなくても装備はできる。【確定】2026-10-18 **いまのLV相当の強さ**（下の「必要LV」）
//   ・防具のメリット：重鎧＝受けるダメージ−1%／軽装＝AGI+1%（1部位ごと・2026-10-12 ユーザー指示で −3%／+5% から下げた）。
//     ★必要LVに足りなくても弱めない（2026-10-18〜。LV相当の防具と同じ＝そのまま）
//
//   ・【確定】2026-10-10 強化値（+1〜+10）：+1 ごとに元の強さの0.1倍ずつ足す（足し算・+10で2倍。smith.js）。
//     2026-10-12 から**最低でも+1ずつ**（下の powerAt）。
//     強くなるのはステだけ（防具のメリットは変わらない）。必要LVに足りないときも強化値はそのまま掛ける
//
// ★ルーン・合成・進化は作らない（決まったら足す）。
// ============================================================
import { STAT_KEYS } from '../core/stats.js'
import { RARITY_BASE, PART_MULT, ARMOR_EFFECT, needLvOf, UNIQUE_LV, isUnique } from './equipment.js'
import { bodyPowerAt } from './level.js'
import { plusMultOf, PLUS_CAP } from './smith.js'

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
// ★ユニーク（2026-10-21）：ステはユーザーが1つずつ決めた値（LV80・+0）＝その合計がLV80の戦闘力。
//   ほかのLVでは本体の戦闘力の比で増える・減る（LV80より低いLVで着けると、同じ割合のままそのLV相当まで小さくなる＝案のシートの決まり）
const distSum = (dist) => Object.values(dist || {}).reduce((t, v) => t + v, 0)
const basePowerOf = (item, ilv) => (isUnique(item)
  ? distSum(item.dist) * bodyPowerAt(ilv) / bodyPowerAt(UNIQUE_LV)
  : (RARITY_BASE[item?.rarity] || 0) * (PART_MULT[item?.part] || 1) * bodyPowerAt(ilv) * GEAR_RATIO / N_SET_BASE)
export const powerAt = (item, ilv, plus = 0) => {
  const base = basePowerOf(item, ilv)
  const n = plus > 0 ? Math.min(PLUS_CAP, plus) : 0
  return Math.max(1, Math.round(base * plusMultOf(n)), Math.round(base) + n)
}

// ===== 必要LV =====
// 【確定】2026-10-18 ユーザー選択「そのLV相当にする」（ユーザー「必要レベル90の装備を20くらいで装備したら、20レベル相当の能力になってる？」）：
//   必要LVに足りない装備は、**いまのLVで着けられる同じレア度・同じ種類の装備と同じ強さ**
//   ＝アイテムLVを足りないぶんだけ下げて強さを出し直す（必要LV90のレジェンダリーの剣をLV20で着けると、必要LV20のレジェンダリーの剣と同じ）。
//   強化値はそのまま掛ける。前の決まり「足りないときは**最低でも1下げる**」（2026-10-12 ユーザー指示）は残す。
//   防具のメリット（重鎧・軽装）は弱めない。必要LVは equipment.js の needLvOf（2026-10-13）
//   ⚠前（2026-10-09〜10-17）は「不足1LVごとに効果−5%・最低10%」＝LV20でLV90の剣は15（LV20のノーマル26より弱い）。
//     その形に戻さない（効果%を掛ける書き方は reqlv.test.js が見張る）
//   ★サーバーは必要LVを使っていない＝SQLは変わらない
// lv＝いまのLV。null／undefined なら「足りている」扱い（育ったときの見込みを出すとき）
export const isUnderLv = (item, ilv, lv) => lv != null && lv < needLvOf(item, ilv)
// 強さを出すアイテムLV（足りなければ足りないぶん下げる＝いまのLVで着けられる同じレア度の装備のアイテムLV）
export const syncIlvOf = (item, ilv, lv) =>
  (isUnderLv(item, ilv, lv) ? Math.max(1, ilv - (needLvOf(item, ilv) - lv)) : ilv)
// いまのLVで着けたときの戦闘力（強化値込み）。足りなければLV相当にして、最低でも1下げる（下は0まで）
export const effectivePowerAt = (item, ilv, lv, plus = 0) => {
  const full = powerAt(item, ilv, plus)
  if (!isUnderLv(item, ilv, lv)) return full
  return Math.max(0, Math.min(powerAt(item, syncIlvOf(item, ilv, lv), plus), full - 1))
}
// 画面の書き添え（足りないときだけ「要求LV不足」。足りていれば ''）
// 【確定】2026-10-23 ユーザー指示「装備の○○相当ってところ、要求Lv不足にして」（前は「LV20相当」）。強さはいまのLV相当のまま（上の effectivePowerAt）
export const syncLabelOf = (item, ilv, lv) => (isUnderLv(item, ilv, lv) ? '要求LV不足' : '')

// ===== 戦闘力をステへ散らす =====
// 【2026-10-13】端数は最大剰余：ステごとに切り捨ててから、残りの点を端数の大きいステから1点ずつ配る（合計はいつも戦闘力と同じ）。
//   端数が同じときは ①戦闘力が1少ないときに端数の1点をもらっていたステ ②配分の重いステ ③dist に書いた順
//   ★①が無いと、軽装頭（AGI45・DEX25・STR15・INT15）は戦闘力9→10・29→30…（20ごと）で STR が1下がった
//     （戦闘力10で端数が4つとも .5 にそろい、重い AGI・DEX が先にもらう＝アラバマのパラドックス）。
//     ①を足して、どの配分でも戦闘力が上がってステが下がる所は0（v2cap.test.js が配分ごとに見張る）
//   ⚠前は今のⅡの statsOf と同じく四捨五入して、合計のずれ（マイナスもある）をいちばん重いステへ足していた＝
//     強化して戦闘力が上がったのにステが下がることがあった（ユーザー指摘：蟻帝の聖鎧 +3→+4・効果60% で VIT 15→14。
//     全装備の +0→+10 の15,790段のうち524段・必要LV不足では18,482段）。
//     直し方は 2026-10-12 の別の作業（ユーザーが「残りも0にする」を選んだもの）と同じ。そのときは入らずに残っていた
// 配分の合計は100（v2cap.test.js が見張る）＝残りの点はステの数より少ない。
// ★ユニークの配分はユーザーが決めたステそのもの（合計＝LV80の戦闘力・160 など）なので、合計 w で割る形にした（合計100なら前と同じ）。
//   戦闘力がちょうど合計のとき（LV80・+0）は決めたステのまま・+10（2倍）でちょうど2倍になる
const largestRemainder = (p, dist, tie) => {
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  if (!(p > 0) || !dist) return out
  const w = distSum(dist) || 100
  const rows = Object.entries(dist).map(([k, v], i) => ({ k, v, i, rem: (p * v) % w }))
  for (const r of rows) out[r.k] = Math.floor(p * r.v / w)
  const left = p - rows.reduce((t, r) => t + out[r.k], 0)
  rows.sort((a, b) => b.rem - a.rem || tie(a, b))
  for (let j = 0; j < left; j++) out[rows[j].k]++
  return out
}
const byWeight = (a, b) => b.v - a.v || a.i - b.i
// 戦闘力 p を配分 dist どおりにステへ散らす
export const spreadStats = (p, dist) => {
  const w = distSum(dist) || 100
  const prev = largestRemainder(p - 1, dist, byWeight)
  const had = (r) => (prev[r.k] > Math.floor((p - 1) * r.v / w) ? 1 : 0)   // ①
  return largestRemainder(p, dist, (a, b) => had(b) - had(a) || byWeight(a, b))
}
// 装備のステ。lv＝いまのLV（必要LVに足りなければLV相当＝effectivePowerAt。null なら足りている扱い）・plus＝強化値
export const statsAt = (item, ilv, lv = null, plus = 0) =>
  spreadStats(item ? effectivePowerAt(item, ilv, lv, plus) : 0, item?.dist)

// ===== 防具のメリット =====
// worn = [{ item }]（着けている防具）。必要LVに足りなくても弱めない（2026-10-18〜）。
// 返すのは 受けるダメージの倍率（1未満で軽くなる）と AGI の上がり幅(%)
export const armorEffects = (worn) => {
  let takenPct = 0
  let agiPct = 0
  for (const { item } of worn || []) {
    const e = ARMOR_EFFECT[item?.line]
    if (!e) continue
    if (e.takenPct) takenPct += e.takenPct
    if (e.agiPct) agiPct += e.agiPct
  }
  const r = (v) => Math.round(v * 100) / 100
  // ★倍率は小数4桁まで（1部位1%にしたので、2桁だと必要LV不足で弱まった0.5%などが丸めで消える）
  return { takenPct: r(takenPct), agiPct: r(agiPct), takenMult: Math.round((1 + takenPct / 100) * 10000) / 10000 }
}
// 1つの防具の効果の文（重鎧＝「受けるダメージ−1%」・軽装＝「AGI+1%」）。防具でなければ ''
export const armorEffectText = (item) => {
  const e = ARMOR_EFFECT[item?.line]
  if (!e) return ''
  return e.takenPct ? `受けるダメージ−${-e.takenPct}%` : `AGI+${e.agiPct}%`
}
