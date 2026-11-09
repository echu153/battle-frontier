// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 鍛冶屋（装備の強化・分解・作成）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「鍛冶屋を追加、ここで装備の強化・分解・作成が可能」：
//   強化と分解は鍛冶屋だけで行う（装備画面は着ける・外すだけ）。作成は下の「作成」
// 【確定】2026-10-10 ユーザー決定：
//   ・強化に使うのは **Gold と、その装備が落ちるエリアの「残骸」だけ**（強化石は使わない）
//   ・残骸は**装備を分解すると手に入る**（その装備のエリアの残骸）。数はレア度で決まる
//     ＝ ノーマル1・レア5・エピック10・レジェンダリー25
//   ・強化値は **+10 まで**。+1 ごとに元の強さの0.1倍ずつ足す（**足し算**：+5で1.5倍・+10で2.0倍）。
//     ただし1回の強化で戦闘力は**最低でも+1**（2026-10-12・下の注）
//   ・1回の強化（+n にする回）にかかる量と成功率は下の表。Gold＝**必要LV × 20 × n**
//   ・**失敗すると残骸とGoldはなくなり、強化値はそのまま**（下がらない・壊れない）
//   ・今の「捨てる」は分解に置き換えた。まとめて分解できる（レア度で選ぶ・1つずつ選ぶ・表示中を全部選ぶ）
// 強くなるのはステータスだけ（重鎧・軽装の効果はそのまま）。必要LVが足りないときの弱まり方も今のまま。
// 【確定】2026-10-12 ユーザー指示「初期装備は残骸不要、Goldだけで強化できるように」→ 同じ日に
//   「全装備のノーマル装備の強化で残骸の消費は不要に、※Goldのみで」：**ノーマルの装備（初期装備もノーマル）は残骸を使わない**
//   （Gold・成功率・失敗したときはほかの装備と同じ）
// 【確定】2026-10-12 ユーザーが選んだ「最低でも+1にする」：1回の強化で戦闘力は最低でも+1（gear.js の powerAt）。
//   +1ごとに元の強さの10%だと、弱い装備（元の強さが10未満）は数字が動かない回があった
// 【確定】2026-11-08 **強化石**（ユーザー指示「強化石を使って強化するシステムにする、＋6以降は残骸が必要に、挑戦装備産は固有の素材を必要に」）：
//   上の「強化石は使わない」「ノーマルはGoldだけ」と、強化の残骸の表は下の「強化」の【確定】で置きかえた
// ★抽選と強化石・残骸・Goldの出し入れはサーバー（v2cap_enhance・v2cap_dismantle）。ここは表示とテストのための写し
//   （v2capsql.test.js が表の数を突き合わせる）
// ============================================================

import { CHALLENGE_MATS } from './challengeDefs.js'

// ===== 強化値 =====
// PLUS_MAX＝鍛冶屋のふつうの強化で上げられる上限
export const PLUS_MAX = 10
// PLUS_CAP＝持ち物の強化値の上限。【確定】2026-10-23 V1からの引き継ぎの強化券（v1carry.js）は V1 の強化値（最大+16）まで上げられる
//   （ユーザー「+10以降も反映させていい（通常プレイでも後日追加させるからいい）」）。+11からも +1ごとに元の強さの0.1倍を足す（+16で2.6倍）。
//   ★ふつうの強化（+11から先の成功率など）はユーザーがあとで足す。それまで +11 より上になるのは強化券だけ
export const PLUS_CAP = 16
// 持ち物の行の強化値（SQLを流す前の行には plus が無いので0として扱う）
export const plusOf = (inv) => Math.max(0, Math.min(PLUS_CAP, Math.floor(Number(inv?.plus) || 0)))
// 強さの倍率（足し算）。+0 はちょうど1（強化していない装備の強さは前と変わらない）。
// ★戦闘力は「元の強さ×この倍率」と「元の強さ＋強化値」の大きいほう（gear.js の powerAt＝最低でも+1ずつ）
export const plusMultOf = (plus) => (plus > 0 ? 1 + Math.min(PLUS_CAP, plus) / 10 : 1)
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
// その装備の分解で手に入る（強化で使う）残骸のエリア。初期装備（エリア0・2026-10-12）は分解すると始まりの森（1）の残骸になる
// （ノーマルの強化は残骸を使わない＝下の enhanceScrapOf）。★サーバー（v2cap_dismantle・v2cap_enhance）も greatest(1, エリア) で同じにしている
export const scrapAreaOf = (item) => Math.max(1, Number(item?.area) || 1)
// 持っている数。サーバーは v2cap_profiles.materials に {"エリアの番号": 個数} で持つ
export const scrapOf = (materials, area) => Math.max(0, Math.floor(Number(materials?.[String(area)]) || 0))

// ===== 分解 =====
// ★ユニーク（U）は50（2026-10-18 の案のシート「分解で残骸50」・2026-10-21 実装）。残骸はそのボスのエリアのもの
export const SCRAP_YIELD = { N:1, R:5, E:10, L:25, U:50 }
export const scrapYieldOf = (item) => SCRAP_YIELD[item?.rarity] || 0
// 分解したら手に入る残骸（エリアごと）。rows = [{ item }]
export const dismantleGainOf = (rows) => {
  const out = {}
  for (const { item } of rows || []) {
    if (!item) continue
    const area = scrapAreaOf(item)
    out[area] = (out[area] || 0) + scrapYieldOf(item)
  }
  return out
}
// まとめて選ぶときの対象：着けているものと、強化したもの（+1以上）と、ユニークは選ばない（1つずつなら選べる）
//   ★ユニークは0.5%のボス固有なので、まとめての分解でうっかり消さないようにした（2026-10-21）
//   ★お気に入り（inv.fav）は1つずつでも分解できない（2026-10-26 ユーザー指示・サーバーの v2cap_dismantle も飛ばす）
// ★真化した武器（2026-10-26・shinka.js）もまとめての分解に入れない（1つずつなら分解できる・確認に「能力も消える」と出す）
// ★挑戦（四凶）の専用装備（2026-11-06・item.bossKey）もユニークと同じく、まとめての分解に入れない（1つずつなら分解できる）
export const bulkPickable = ({ inv, item }, wornIds) => !wornIds.has(String(inv.id)) && plusOf(inv) === 0 && item?.rarity !== 'U' && !item?.bossKey && !inv?.fav && !inv?.shinka

// ===== 強化 =====
// +n にする回（n＝1〜10）の 強化石・残骸・ボスの素材の数と成功率(%)。
// 【確定】2026-11-08 ユーザー指示「強化石を使って強化するシステムにする、＋6以降は残骸が必要に、挑戦装備産は固有の素材を必要に」
//   「強化石は出撃で確率で手に入る」→ 案を見て4つとも「推奨」を選んだ：
//   ・強化石は**どの段も1回1個**（ノーマルも使う）。Gold・成功率は今までどおり
//   ・**+6からは、その装備のエリアの残骸も使う**（数は前の表の+6〜+10のまま＝7・8・9・10・11）。ノーマルは今までどおり残骸を使わない
//   ・**挑戦の装備**（専用装備と四凶のユニーク＝bossKey がある）は、+6から残骸の代わりに**そのボスの素材を1個**（challengeDefs.js の CHALLENGE_MATS）
//   ・強化石は出撃で勝った戦闘ごとに2%で1個（sortie.js の STONE_PCT）。挑戦や日替わりクエストで手に入るようにするのは、あとで（ユーザー「予定」）
//   ⚠前（2026-10-10〜11-07）は「強化石なし・Goldと残骸（+1から1・2・3・4・5・7・8・9・10・11個）・ノーマルはGoldだけ」
//   成功率は+1が100%、そこから10%ずつ下がって+10で10%（2026-10-10 ユーザーの表）
// 【確定】2026-11-09 **強化石は強化値の段ごとに種類が変わる**（ユーザー指示「強化石は種類を増やす予定」＋表
//   「ノーマル 強化石・レア 良質な強化石・エピック 希少な強化石・レジェンド 至高の強化石・ユニーク 神域の強化石」→
//   「強化値の段ごと」と「+6から良質」を選んだ）：
//   ・+1〜+5にする回＝強化石・+6〜+10にする回＝**良質な強化石**（どちらも1回1個）。残骸を使い始める+6と同じ段
//   ・希少・至高・神域は、+11から先の強化を足すときに使う（STONE_LATER・まだ手に入らない）
//   ・良質な強化石は、出撃で勝つと低い確率で出る（sortie.js の STONE2_PCT）・鍛冶屋で強化石10個から1個作れる（STONE_CRAFT）
//     ・賭博場の景品の交換所にも並べる（メダル500枚・casino.js の PRIZES）（3つともユーザー選択）
//   ★サーバーは v2cap_enhance（良質は v2cap_profiles.enh_stone2）・作るのは v2cap_stone_craft
export const STONE_TIERS = [
  { name: '強化石', from: 1, col: 'enh_stone' },
  { name: '良質な強化石', from: 6, col: 'enh_stone2' },
]
export const STONE_LATER = ['希少な強化石', '至高の強化石', '神域の強化石']
export const STONE_NAME = STONE_TIERS[0].name
export const STONE2_NAME = STONE_TIERS[1].name
export const STONE2_FROM = STONE_TIERS[1].from
// +n にする回に使う強化石の段（0＝強化石・1＝良質な強化石）
export const stoneTierOf = (next) => STONE_TIERS.reduce((t, s, i) => (next >= s.from ? i : t), 0)
export const ENHANCE_STONE = 1
export const ENHANCE_SCRAP = [0, 0, 0, 0, 0, 7, 8, 9, 10, 11]
export const ENHANCE_BOSS_MAT = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
// 残骸（挑戦の装備はボスの素材）を使い始める回（+6）。説明の文に出す
export const ENHANCE_SCRAP_FROM = ENHANCE_SCRAP.findIndex(n => n > 0) + 1
export const ENHANCE_RATE = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]
export const ENHANCE_GOLD_PER_LV = 20
export const enhanceGoldOf = (ilv, next) => Math.max(1, ilv || 1) * ENHANCE_GOLD_PER_LV * next
// 持っている強化石の数（tier＝段・サーバーは v2cap_profiles.enh_stone と enh_stone2。SQLを流す前の行は0）
export const stoneHaveOf = (prof, tier = 0) => Math.max(0, Math.floor(Number(prof?.[STONE_TIERS[tier]?.col]) || 0))
export const stoneOf = (prof) => stoneHaveOf(prof, 0)
export const stone2Of = (prof) => stoneHaveOf(prof, 1)
// 良質な強化石を作る（鍛冶屋・サーバーは v2cap_stone_craft）：強化石10個で1個・1回で9999個まで（必ずできる）
export const STONE_CRAFT = 10
export const STONE_CRAFT_MAX = 9999
export const stoneCraftMaxOf = (prof) => Math.min(STONE_CRAFT_MAX, Math.floor(stoneOf(prof) / STONE_CRAFT))
// 挑戦の装備（専用装備・四凶のユニーク＝equipment.js の isChallenge と isChallengeUnique の両方）か。強化でボスの素材を使う
export const usesBossMat = (item) => !!item?.bossKey
// +n にする回の残骸の数。ノーマル（初期装備もノーマル）と挑戦の装備は0。★サーバーも rarity = 'N' かボスの装備なら0
export const ENHANCE_NO_SCRAP_RARITY = 'N'
export const enhanceScrapOf = (item, next) =>
  (item?.rarity === ENHANCE_NO_SCRAP_RARITY || usesBossMat(item) ? 0 : ENHANCE_SCRAP[next - 1] || 0)
// +n にする回のボスの素材の数（挑戦の装備だけ）
export const enhanceBossMatOf = (item, next) => (usesBossMat(item) ? ENHANCE_BOSS_MAT[next - 1] || 0 : 0)
// 持っているボスの素材の数（サーバーは v2cap_profiles.challenge_mats＝{ ボス: 個数 }・challenge.js の chMatsOf と同じ）
const bossMatHaveOf = (prof, key) => Math.max(0, Math.floor(Number(prof?.challenge_mats?.[String(key || '')]) || 0))
// 次の強化にかかるもの。上限なら null（scrap・mat が0ならそれは使わない。matKey・matName は挑戦の装備だけ。
// stoneTier・stoneName＝使う強化石の段と名前）
export const enhanceCostOf = (item, inv) => {
  const plus = plusOf(inv)
  if (!item || plus >= PLUS_MAX) return null
  const next = plus + 1
  const boss = usesBossMat(item) ? String(item.bossKey) : null
  const tier = stoneTierOf(next)
  return {
    next, area: scrapAreaOf(item),
    stone: ENHANCE_STONE, stoneTier: tier, stoneName: STONE_TIERS[tier].name,
    scrap: enhanceScrapOf(item, next),
    mat: enhanceBossMatOf(item, next), matKey: boss, matName: boss ? CHALLENGE_MATS[boss] || '素材' : null,
    gold: enhanceGoldOf(inv?.ilv, next),
    rate: ENHANCE_RATE[next - 1],
  }
}
// 強化できないわけ（できるなら null）。見る順はサーバー（v2cap_enhance）と同じ（上限→強化石→残骸→ボスの素材→Gold）。
// 画面では残骸と素材の名前まで出す
export const enhanceErrorOf = (item, inv, prof) => {
  if (!item || !inv) return 'その装備を持っていません'
  const c = enhanceCostOf(item, inv)
  if (!c) return `強化値は+${PLUS_MAX}が上限です`
  if (stoneHaveOf(prof, c.stoneTier) < c.stone) return `${c.stoneName}が足りません`
  if (c.scrap > 0 && scrapOf(prof?.materials, c.area) < c.scrap) return `${scrapNameOf(c.area)}が足りません`
  if (c.mat > 0 && bossMatHaveOf(prof, c.matKey) < c.mat) return `${c.matName}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}
// 1回の強化で使ったもの（「〜を失いました」の文）。res＝サーバーの返事（stone・stone_tier・scrap・area・mat・mat_key・gold）
export const enhanceSpentText = (res) => [
  res?.stone > 0 ? `${STONE_TIERS[Number(res.stone_tier) || 0]?.name || STONE_NAME} ${res.stone}個` : null,
  res?.scrap > 0 ? `${scrapNameOf(res.area)} ${res.scrap}個` : null,
  res?.mat > 0 ? `${CHALLENGE_MATS[res.mat_key] || '素材'} ${res.mat}個` : null,
  `Gold ${(Number(res?.gold) || 0).toLocaleString()}`,
].filter(Boolean).join('・')
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
// ★挑戦（四凶）の専用装備（2026-11-06・item.bossKey）は残骸では作れない＝鍛冶屋の「挑戦装備」で素材から作る（challenge.js）
export const canCraft = (item) => !!item && !item.bossKey && (CRAFT_SCRAP[item.rarity] || 0) > 0
// 作るのにかかるもの（エリアとレア度が同じなら、どの種類でも同じ）。ノーマルは null
export const craftCostOf = (item) => (canCraft(item)
  ? { area: item.area, scrap: CRAFT_SCRAP[item.rarity], gold: Math.max(1, item.lv || 1) * CRAFT_GOLD_PER_LV[item.rarity] }
  : null)
// 作れないわけ（作れるなら null）。見る順はサーバーと同じ
export const craftErrorOf = (item, prof) => {
  if (!item) return 'その装備はありません'
  const c = craftCostOf(item)
  if (item.bossKey && item.rarity !== 'U') return 'この装備は「挑戦装備」で作ります'   // 四凶のユニーク（bossKey がある）は下の「作れません」
  if (!c) return item.rarity === 'U' ? 'ユニークの装備は作れません' : 'ノーマルの装備は作れません'
  if (scrapOf(prof?.materials, c.area) < c.scrap) return `${scrapNameOf(c.area)}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}

// +from から +to まで上げるのに、平均でかかる量（説明とテスト用）。
// scrap＝レア・エピック・レジェンダリー・ユニークのとき／mat＝挑戦の装備のとき（どちらか一方を使う）。
// stone＝強化石と良質な強化石の合計・stone2＝そのうちの良質な強化石
export const expectedEnhanceCost = (ilv, from = 0, to = PLUS_MAX) => {
  let stone = 0, stone2 = 0, scrap = 0, mat = 0, gold = 0, tries = 0
  for (let n = from + 1; n <= to; n++) {
    const p = ENHANCE_RATE[n - 1] / 100
    tries += 1 / p
    stone += ENHANCE_STONE / p
    if (stoneTierOf(n) === 1) stone2 += ENHANCE_STONE / p
    scrap += ENHANCE_SCRAP[n - 1] / p
    mat += ENHANCE_BOSS_MAT[n - 1] / p
    gold += enhanceGoldOf(ilv, n) / p
  }
  return { tries, stone, stone2, scrap, mat, gold }
}
