// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 挑戦（四凶）の報酬：特別な素材の数・専用装備の作成・落としたものの表示
// ------------------------------------------------------------
// 表と経緯は challengeDefs.js（【確定】2026-11-06 ユーザーが案に全部「推奨」を選んだ）。
// ★抽選はサーバー（v2cap_dungeon_pay_reward）・作成もサーバー（v2cap_craft_challenge）。ここは画面と、テスト・シミュのための写し
// ============================================================
import {
  CHALLENGE_MATS, CHALLENGE_TIER_AREA, CHALLENGE_DIFFS,
  CH_RATES, CH_MAT_HOST, CH_MAT_SOLO, CH_MAT_CHANCE_MIN, CH_MAT_CHANCE, CH_CRAFT_MATS, CH_CRAFT_GOLD_PER_LV, CH_STONE4_PCT,
} from './challengeDefs.js'
import { STONE4_NAME } from './smith.js'
import { CHALLENGE_ITEMS, CHALLENGE_UNIQUE_ITEMS, ITEM_BY_ID, isChallenge } from './equipment.js'

export { CHALLENGE_DIFFS, CH_CRAFT_MATS }

// 難易度ごとの落ちる確率（challengeDefs.js の CH_RATES）。まだ無い難易度は null
export const chRatesOf = (diff) => CH_RATES[diff] || null

// ===== 特別な素材（ボスごとに1つ・2026-11-06 ユーザー「なんで難易度ごとに素材わかれてるの？」）=====
// 持ち物の鍵（サーバーの v2cap_profiles.challenge_mats のキー）＝ボスのキー（前の「ボス:難易度」は SQL で足し合わせた）
export const matKeyOf = (bossKey) => String(bossKey || '')
export const matNameOf = (bossKey) => CHALLENGE_MATS[bossKey] || '素材'
// 鍵から名前（報酬の画面）。前の形の鍵（ボス:難易度）でもボスの素材の名前。知らない鍵なら '素材'
export const matNameOfKey = (key) => matNameOf(String(key || '').split(':')[0])
// 持っている数。mats＝プロフィールの challenge_mats（SQLを流す前の行には無い＝0）
export const chMatsOf = (mats, bossKey) => Math.max(0, Math.floor(Number(mats?.[matKeyOf(bossKey)]) || 0))

// 倒したときに必ず入る数（サーバーと同じ）：呼んだ人（owner）なら1・完全ソロ討伐（solo）ならさらに1
export const chMatBaseOf = ({ owner = true, solo = false } = {}) => (owner ? CH_MAT_HOST : 0) + (solo ? CH_MAT_SOLO : 0)
// さらに1個の確率（%）。貢献度（contrib＝与えたダメージ÷ボスの最大HP の%・dungeon.js の contributionPctOf）が10%未満なら0
export const chMatChanceOf = (diff, contrib = 100) => (contrib >= CH_MAT_CHANCE_MIN ? (CH_MAT_CHANCE[diff] || 0) : 0)
// 1回倒したときに入る素材の平均（説明とテスト）
export const chMatMeanOf = ({ diff, owner = true, solo = false, contrib = 100 }) =>
  chMatBaseOf({ owner, solo }) + chMatChanceOf(diff, contrib) / 100

// ===== 専用装備 =====
// そのボスの専用装備（3つ・必要LV70）。ノーマルでもハードでも同じ装備（2026-11-06 ユーザー「レジェンダリーは必要レベル70」）
export const challengeItemsOf = (bossKey) => CHALLENGE_ITEMS.filter(i => i.bossKey === bossKey)
// そのボスのユニーク（1つ・必要LV85）。無ければ null
export const challengeUniqueOf = (bossKey) => CHALLENGE_UNIQUE_ITEMS.find(u => u.bossKey === bossKey) || null
// 作るのにかかるもの（そのボスの素材50個＋Gold 必要LV×200）。専用装備でなければ null
export const chCraftCostOf = (item) => (isChallenge(item) && CHALLENGE_MATS[item.bossKey]
  ? { key: matKeyOf(item.bossKey), name: matNameOf(item.bossKey), mats: CH_CRAFT_MATS,
      gold: Math.max(1, item.lv || 1) * CH_CRAFT_GOLD_PER_LV }
  : null)
// 作れないわけ（作れるなら null）。見る順はサーバー（v2cap_craft_challenge）と同じ。画面では素材の名前まで出す
export const chCraftErrorOf = (item, prof) => {
  const c = chCraftCostOf(item)
  if (!c) return 'その装備はありません'
  if (chMatsOf(prof?.challenge_mats, item.bossKey) < c.mats) return `${c.name}が足りません`
  if ((Number(prof?.gold) || 0) < c.gold) return 'Goldが足りません'
  return null
}
// いま作れる数（素材とGoldの少ないほう）
export const chCraftTimesOf = (item, prof) => {
  const c = chCraftCostOf(item)
  if (!c) return 0
  return Math.min(Math.floor(chMatsOf(prof?.challenge_mats, item.bossKey) / c.mats), Math.floor((Number(prof?.gold) || 0) / c.gold))
}

// ===== 報酬の画面 =====
// サーバーの報酬（v2cap_dungeon_pay_reward の gear・mat・own・uq・stone4）から、画面に出す行を作る。
//   [{ kind:'gear'|'own'|'uq', item, ilv } | { kind:'mat', name, n }]。何も落ちていなければ空。
//   至高の強化石（2026-11-09）は素材の行（kind:'mat'）で出す
export const chDropsOf = (reward) => {
  const out = []
  const g = reward?.gear && ITEM_BY_ID[reward.gear.base_id]
  if (g) out.push({ kind: 'gear', item: g, ilv: reward.gear.ilv })
  if (reward?.mat?.n > 0) out.push({ kind: 'mat', name: matNameOfKey(reward.mat.key), n: reward.mat.n })
  const o = reward?.own && ITEM_BY_ID[reward.own.base_id]
  if (o) out.push({ kind: 'own', item: o, ilv: reward.own.ilv })
  const u = reward?.uq && ITEM_BY_ID[reward.uq.base_id]
  if (u) out.push({ kind: 'uq', item: u, ilv: reward.uq.ilv })
  if (reward?.stone4 > 0) out.push({ kind: 'mat', name: STONE4_NAME, n: reward.stone4 })
  return out
}

// ===== シミュとテスト：サーバーと同じ抽選 =====
// pct＝報酬の割合（呼んだ人100・救援の人は貢献度で最低30＝装備・専用装備・ユニークの確率に掛ける）・owner＝呼んだ人か・solo＝完全ソロ討伐・
//   contrib＝貢献度（%・素材の確率の10%の線）・cls の武器（weapons）。rng は [0,1)。
//   返すのは { gear: { area, rarity, kind } | null, mat: n | 0, own: true | false, uq: true | false, stone4: 0 | 1 }（引く順もサーバーと同じ）
export const CH_PARTS = ['武器', '頭', '鎧', '腕', '足', 'アクセ']
export const rollChallengeDrops = ({ diff, pct = 100, owner = true, solo = false, contrib = 100, weapons = [] }, rng = Math.random) => {
  const area = CHALLENGE_TIER_AREA[diff]
  const rates = chRatesOf(diff)
  if (!area || !rates) return { gear: null, mat: 0, own: false, uq: false, stone4: 0 }
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
    const rarity = x < rates.gear.R ? 'R' : x < rates.gear.R + rates.gear.E ? 'E' : 'L'
    gear = { area, rarity, kind }
  }
  let mat = chMatBaseOf({ owner, solo })
  if (contrib >= CH_MAT_CHANCE_MIN && rng() * 100 < chMatChanceOf(diff, contrib)) mat += 1
  const own = rng() * 100 < rates.own * pct / 100
  const uq = rng() * 100 < rates.unique * pct / 100
  // ⑤ 至高の強化石（2026-11-09・challengeDefs.js の CH_STONE4_PCT）
  const stone4 = rng() * 100 < (CH_STONE4_PCT[diff] || 0) * pct / 100 ? 1 : 0
  return { gear, mat, own, uq, stone4 }
}
