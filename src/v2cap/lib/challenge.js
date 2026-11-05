// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 挑戦（四凶）の報酬：特別な素材の数・専用装備の作成・落としたものの表示
// ------------------------------------------------------------
// 表と経緯は challengeDefs.js（【確定】2026-11-06 ユーザーが案に全部「推奨」を選んだ）。
// ★抽選はサーバー（v2cap_dungeon_pay_reward）・作成もサーバー（v2cap_craft_challenge）。ここは画面と、テスト・シミュのための写し
// ============================================================
import {
  CHALLENGE_MATS, CHALLENGE_TIER_AREA, CHALLENGE_DIFFS,
  CH_GEAR_RARITY, CH_MAT_PCT, CH_MAT_RANGE, CH_MAT_SOLO_MULT, CH_OWN_PCT, CH_CRAFT_MATS, CH_CRAFT_GOLD_PER_LV,
} from './challengeDefs.js'
import { CHALLENGE_ITEMS, ITEM_BY_ID, isChallenge } from './equipment.js'

export { CHALLENGE_DIFFS, CH_CRAFT_MATS }

// ===== 特別な素材 =====
// 持ち物の鍵（サーバーの v2cap_profiles.challenge_mats のキー）＝「ボスのキー:難易度」
export const matKeyOf = (bossKey, diff) => `${bossKey}:${diff}`
export const matNameOf = (bossKey, diff) => CHALLENGE_MATS[bossKey]?.[diff] || '素材'
// 鍵から名前（報酬の画面）。知らない鍵なら '素材'
export const matNameOfKey = (key) => {
  const [b, d] = String(key || '').split(':')
  return matNameOf(b, d)
}
// 持っている数。mats＝プロフィールの challenge_mats（SQLを流す前の行には無い＝0）
export const chMatsOf = (mats, bossKey, diff) => Math.max(0, Math.floor(Number(mats?.[matKeyOf(bossKey, diff)]) || 0))

// 倒したときに入る数（サーバーと同じ式）。n＝1〜5 の抽選・pct＝報酬の割合（呼んだ人100・救援の人は貢献度で最低30）・solo＝ひとりで倒されずに倒した
export const chMatGainOf = (n, pct = 100, solo = false) => Math.max(1, Math.round(n * pct / 100)) * (solo ? CH_MAT_SOLO_MULT : 1)
// 1回倒したときに入る素材の平均（説明とテスト）
export const chMatMeanOf = (pct = 100, solo = false) => {
  const [lo, hi] = CH_MAT_RANGE
  let t = 0
  for (let n = lo; n <= hi; n++) t += chMatGainOf(n, pct, solo)
  return (CH_MAT_PCT / 100) * t / (hi - lo + 1)
}

// ===== 専用装備 =====
// そのボスのその難易度の段階の専用装備（3つ）。難易度がまだ無い段階なら空
export const challengeItemsOf = (bossKey, diff) =>
  CHALLENGE_ITEMS.filter(i => i.bossKey === bossKey && i.diff === diff)
// 作るのにかかるもの（素材50個＋Gold 必要LV×200）。専用装備でなければ null
export const chCraftCostOf = (item) => (isChallenge(item)
  ? { key: matKeyOf(item.bossKey, item.diff), name: matNameOf(item.bossKey, item.diff), mats: CH_CRAFT_MATS,
      gold: Math.max(1, item.lv || 1) * CH_CRAFT_GOLD_PER_LV }
  : null)
// 作れないわけ（作れるなら null）。見る順はサーバー（v2cap_craft_challenge）と同じ。画面では素材の名前まで出す
export const chCraftErrorOf = (item, prof) => {
  const c = chCraftCostOf(item)
  if (!c) return 'その装備はありません'
  if (chMatsOf(prof?.challenge_mats, item.bossKey, item.diff) < c.mats) return `${c.name}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}
// いま作れる数（素材とGoldの少ないほう）
export const chCraftTimesOf = (item, prof) => {
  const c = chCraftCostOf(item)
  if (!c) return 0
  return Math.min(Math.floor(chMatsOf(prof?.challenge_mats, item.bossKey, item.diff) / c.mats), Math.floor((Number(prof?.gold) || 0) / c.gold))
}

// ===== 報酬の画面 =====
// サーバーの報酬（v2cap_dungeon_pay_reward の gear・mat・own）から、画面に出す行を作る。
//   [{ kind:'gear'|'own', item, ilv } | { kind:'mat', name, n }]。何も落ちていなければ空
export const chDropsOf = (reward) => {
  const out = []
  const g = reward?.gear && ITEM_BY_ID[reward.gear.base_id]
  if (g) out.push({ kind: 'gear', item: g, ilv: reward.gear.ilv })
  if (reward?.mat?.n > 0) out.push({ kind: 'mat', name: matNameOfKey(reward.mat.key), n: reward.mat.n })
  const o = reward?.own && ITEM_BY_ID[reward.own.base_id]
  if (o) out.push({ kind: 'own', item: o, ilv: reward.own.ilv })
  return out
}

// ===== シミュとテスト：サーバーと同じ抽選 =====
// pct＝報酬の割合・solo・cls の武器（weapons）。rng は [0,1)。返すのは { gear: { area, rarity, kind } | null, mat: n | 0, own: true | false }
export const CH_PARTS = ['武器', '頭', '鎧', '腕', '足', 'アクセ']
export const rollChallengeDrops = ({ diff, pct = 100, solo = false, weapons = [] }, rng = Math.random) => {
  const area = CHALLENGE_TIER_AREA[diff]
  if (!area) return { gear: null, mat: 0, own: false }
  let gear = null
  if (rng() * 100 < pct) {
    let part = CH_PARTS[Math.floor(rng() * CH_PARTS.length)]
    let kind = null
    if (part === '武器') {
      if (!weapons.length) part = 'アクセ'
      else kind = weapons[Math.floor(rng() * weapons.length)]
    }
    if (part === 'アクセ') kind = ['リング', 'イヤリング', 'ベルト', 'ネックレス'][Math.floor(rng() * 4)]
    else if (part !== '武器') kind = `${['重鎧', '軽装'][Math.floor(rng() * 2)]}${part}`
    const x = rng() * 100
    const rarity = x < CH_GEAR_RARITY.R ? 'R' : x < CH_GEAR_RARITY.R + CH_GEAR_RARITY.E ? 'E' : 'L'
    gear = { area, rarity, kind }
  }
  let mat = 0
  if (rng() * 100 < CH_MAT_PCT) mat = chMatGainOf(CH_MAT_RANGE[0] + Math.floor(rng() * (CH_MAT_RANGE[1] - CH_MAT_RANGE[0] + 1)), pct, solo)
  const own = rng() * 100 < CH_OWN_PCT * pct / 100
  return { gear, mat, own }
}
