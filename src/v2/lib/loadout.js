// ============================================================
// バトルフロンティアⅡ（リメイク版）— 編成（プロフィール＋装備＋スキル）から戦闘用のキャラを作る
// ------------------------------------------------------------
// runBattle に渡せる形（{ name, cls, stats, slots }）を組み立てるだけの純関数。
// 装備の数値は equipment.js が正なので、ここでは足し合わせるだけ。
// ============================================================
import { STAT_KEYS } from './stats.js'
import { ITEM_BY_ID, statsOf as equipStats, powerOf as equipPower, SLOTS } from './equipment.js'
import { SKILL_BY_NAME } from './skills.js'

// 装着中の装備を { slot: { inv, item } } の形で引く
export const equippedItems = (profile, inventory) => {
  const byId = Object.fromEntries((inventory || []).map(i => [String(i.id), i]))
  const out = {}
  for (const slot of SLOTS) {
    const invId = profile?.equipped?.[slot]
    if (invId === undefined || invId === null) continue
    const inv = byId[String(invId)]
    const item = inv && ITEM_BY_ID[inv.equip_id]
    if (inv && item) out[slot] = { inv, item }
  }
  return out
}

// 装備ぶんのステータス合計
export const gearStats = (profile, inventory) => {
  const total = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  for (const { inv, item } of Object.values(equippedItems(profile, inventory))) {
    const s = equipStats(item, inv.plus || 0)
    for (const k of STAT_KEYS) total[k] += s[k] || 0
  }
  return total
}
// 装備ぶんの戦闘力合計
export const gearPower = (profile, inventory) =>
  Object.values(equippedItems(profile, inventory)).reduce((t, { inv, item }) => t + equipPower(item, inv.plus || 0), 0)

// 本体＋装備の合計ステータス
export const totalStats = (profile, inventory) => {
  const gear = gearStats(profile, inventory)
  return Object.fromEntries(STAT_KEYS.map(k => [k, (profile?.[k] || 0) + gear[k]]))
}

// runBattle に渡す形。スキル編成が空なら通常攻撃だけで戦う
export const toFighter = (profile, inventory) => ({
  name: profile?.username || 'あなた',
  cls: profile?.class,
  stats: totalStats(profile, inventory),
  slots: (profile?.skill_set || [])
    .map(e => ({ skill: SKILL_BY_NAME[e?.name], uses: e?.uses || 1 }))
    .filter(e => e.skill),
})
