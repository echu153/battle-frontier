// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 鍛冶屋（装備の強化・分解・作成）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「鍛冶屋を追加、ここで装備の強化・分解・作成が可能」：
//   強化と分解は鍛冶屋だけで行う（装備画面は着ける・外すだけ）。作成は下の「作成」
// 【確定】2026-10-10 ユーザー決定：
//   ・強化に使うのは **Gold と、その装備が落ちるエリアの「残骸」だけ**（強化石は使わない）
//   ・残骸は**装備を分解すると手に入る**（その装備のエリアの残骸）。数はレア度で決まる
//     ＝ ノーマル1・レア5・エピック10・レジェンダリー25
//   ・強化値は **+10 まで**。+1 ごとに元の強さの0.1倍ずつ足す（**足し算**：+5で1.5倍・+10で2.0倍）
//   ・1回の強化（+n にする回）にかかる量と成功率は下の表。Gold＝**必要LV × 20 × n**
//   ・**失敗すると残骸とGoldはなくなり、強化値はそのまま**（下がらない・壊れない）
//   ・今の「捨てる」は分解に置き換えた。まとめて分解できる（レア度で選ぶ・1つずつ選ぶ・表示中を全部選ぶ）
// 強くなるのはステータスだけ（重鎧・軽装の効果はそのまま）。必要LVが足りないときの弱まり方も今のまま。
// ★抽選と残骸・Goldの出し入れはサーバー（v2cap_enhance・v2cap_dismantle）。ここは表示とテストのための写し
//   （v2capsql.test.js が表の数を突き合わせる）
// ============================================================

// ===== 強化値 =====
export const PLUS_MAX = 10
// 持ち物の行の強化値（SQLを流す前の行には plus が無いので0として扱う）
export const plusOf = (inv) => Math.max(0, Math.min(PLUS_MAX, Math.floor(Number(inv?.plus) || 0)))
// 強さの倍率（足し算）。+0 はちょうど1（強化していない装備の強さは前と変わらない）
export const plusMultOf = (plus) => (plus > 0 ? 1 + Math.min(PLUS_MAX, plus) / 10 : 1)
export const plusLabel = (plus) => (plus > 0 ? `+${plus}` : '')

// ===== 残骸（エリアごとに1種）=====
// 並びはエリアの番号（areas.js の AREA_LIST）と同じ。名前はユーザーの表
// （「星霧の残骸」はエリア名「星霜の遺跡」に合わせて星霜にした・2026-10-10 ユーザー決定）
export const SCRAP_NAMES = [
  '新緑の残骸', '荒野の残骸', '洞窟の残骸', '近海の残骸', '灼砂の残骸',
  '山脈の残骸', '樹海の残骸', '霊峰の残骸', '雷崖の残骸', '煉獄の残骸',
  '腐海の残骸', '奈落の残骸', '蒼天の残骸', '星霜の残骸', '深海の残骸',
]
export const scrapNameOf = (area) => SCRAP_NAMES[area - 1] || '残骸'
// 持っている数。サーバーは v2cap_profiles.materials に {"エリアの番号": 個数} で持つ
export const scrapOf = (materials, area) => Math.max(0, Math.floor(Number(materials?.[String(area)]) || 0))

// ===== 分解 =====
export const SCRAP_YIELD = { N:1, R:5, E:10, L:25 }
export const scrapYieldOf = (item) => SCRAP_YIELD[item?.rarity] || 0
// 分解したら手に入る残骸（エリアごと）。rows = [{ item }]
export const dismantleGainOf = (rows) => {
  const out = {}
  for (const { item } of rows || []) {
    if (!item) continue
    out[item.area] = (out[item.area] || 0) + scrapYieldOf(item)
  }
  return out
}
// まとめて選ぶときの対象：着けているものと、強化したもの（+1以上）は選ばない（1つずつなら選べる）
export const bulkPickable = ({ inv }, wornIds) => !wornIds.has(String(inv.id)) && plusOf(inv) === 0

// ===== 強化 =====
// +n にする回（n＝1〜10）の 残骸の数・成功率(%)。【確定】2026-10-10 ユーザーの表
//   残骸は+5まで n 個、+6からは1個多い（+6で7・+7で8 … +10で11）
//   成功率は+1が100%、そこから10%ずつ下がって+10で10%
export const ENHANCE_SCRAP = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
export const ENHANCE_RATE = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]
export const ENHANCE_GOLD_PER_LV = 20
export const enhanceGoldOf = (ilv, next) => Math.max(1, ilv || 1) * ENHANCE_GOLD_PER_LV * next
// 次の強化にかかるもの。上限なら null
export const enhanceCostOf = (item, inv) => {
  const plus = plusOf(inv)
  if (!item || plus >= PLUS_MAX) return null
  const next = plus + 1
  return {
    next, area: item.area,
    scrap: ENHANCE_SCRAP[next - 1],
    gold: enhanceGoldOf(inv?.ilv, next),
    rate: ENHANCE_RATE[next - 1],
  }
}
// 強化できないわけ（できるなら null）。見る順はサーバー（v2cap_enhance）と同じ。画面では残骸の名前まで出す
export const enhanceErrorOf = (item, inv, prof) => {
  if (!item || !inv) return 'その装備を持っていません'
  const c = enhanceCostOf(item, inv)
  if (!c) return `強化値は+${PLUS_MAX}が上限です`
  if (scrapOf(prof?.materials, c.area) < c.scrap) return `${scrapNameOf(c.area)}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}
// 1回の抽選（サーバーの random() * 100 < 成功率 と同じ。シミュレーションとテスト用）
export const rollEnhance = (rate, rng = Math.random) => rng() * 100 < rate
// ===== 作成 =====
// 【確定】2026-10-10 ユーザーの表：レア・エピック・レジェンダリーを、Goldと**その装備のエリアの残骸**で作れる（ノーマルは作れない）
//   残骸 … レア30・エピック100・レジェンダリー300
//   Gold … 必要LV × レア50・エピック100・レジェンダリー200
//   武器は14種どれでも作れる（いまの職業で装備できなくてよい＝転職の前に作っておける・ユーザー決定）
//   必ずできる（失敗なし）・+0で手に入る・アイテムLV＝その装備の必要LV（落ちたものと同じ）
// ★サーバーは v2cap_craft（表の写しは v2capsql.test.js が突き合わせる）
export const CRAFT_RARITIES = ['R', 'E', 'L']
export const CRAFT_SCRAP = { R:30, E:100, L:300 }
export const CRAFT_GOLD_PER_LV = { R:50, E:100, L:200 }
export const canCraft = (item) => !!item && (CRAFT_SCRAP[item.rarity] || 0) > 0
// 作るのにかかるもの（エリアとレア度が同じなら、どの種類でも同じ）。ノーマルは null
export const craftCostOf = (item) => (canCraft(item)
  ? { area: item.area, scrap: CRAFT_SCRAP[item.rarity], gold: Math.max(1, item.lv || 1) * CRAFT_GOLD_PER_LV[item.rarity] }
  : null)
// 作れないわけ（作れるなら null）。見る順はサーバーと同じ
export const craftErrorOf = (item, prof) => {
  if (!item) return 'その装備はありません'
  const c = craftCostOf(item)
  if (!c) return 'ノーマルの装備は作れません'
  if (scrapOf(prof?.materials, c.area) < c.scrap) return `${scrapNameOf(c.area)}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}

// +from から +to まで上げるのに、平均でかかる量（説明とテスト用）
export const expectedEnhanceCost = (ilv, from = 0, to = PLUS_MAX) => {
  let scrap = 0, gold = 0, tries = 0
  for (let n = from + 1; n <= to; n++) {
    const p = ENHANCE_RATE[n - 1] / 100
    tries += 1 / p
    scrap += ENHANCE_SCRAP[n - 1] / p
    gold += enhanceGoldOf(ilv, n) / p
  }
  return { tries, scrap, gold }
}
