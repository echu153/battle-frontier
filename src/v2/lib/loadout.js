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

// 装着中の装備の所持品ID。倉庫や鍛冶屋で「これは着けているぶん」を外すのに使う
export const wornIdsOf = (profile, inventory) =>
  new Set(Object.values(equippedItems(profile, inventory)).map(w => String(w.inv.id)))

// ★同じ装備・同じ強化値をひとまとめにする。**＋が違えば別のまとまり**。
//   倉庫の一覧と鍛冶屋の合成で「同じもの」の定義がズレないよう、ここ1か所で決める。
//   worn … そのまとまりのうち装着中のぶん ／ free … 外れているぶん（合成や装着に使えるぶん）
//   並びは戦闘力の高い順。
export const stackInventory = (inventory, wornIds = new Set()) => {
  const map = new Map()
  for (const inv of inventory || []) {
    const item = ITEM_BY_ID[inv.equip_id]
    if (!item) continue
    const plus = inv.plus || 0
    const key = `${inv.equip_id}#${plus}`
    let g = map.get(key)
    if (!g) { g = { key, item, plus, list:[], worn:[], free:[] }; map.set(key, g) }
    g.list.push(inv)
    ;(wornIds.has(String(inv.id)) ? g.worn : g.free).push(inv)
  }
  return [...map.values()].sort((a, b) => equipPower(b.item, b.plus) - equipPower(a.item, a.plus))
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
