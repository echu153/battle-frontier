// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 編成から戦闘用のキャラを作る
// ------------------------------------------------------------
// 戦闘力の内訳は3つだけ：
//   本体（LVアップの抽選で上がったステ）＋ ジョブのステ（いまの職業・そのジョブLVぶん）
//   ＋ 装備（アイテムLVで強さが決まり、必要LVに足りないぶん効果が下がる）
// ★職業補正は**一旦なし**（2026-10-09 ユーザー決定）＝ runBattle に noClassBonus を渡す。
//   職業のパッシブは今のⅡと同じく、その職業に就いていれば最初から効く。
// ============================================================
import { STAT_KEYS, calcPower } from '../../v2/lib/stats.js'
import { ITEM_BY_ID, SLOTS } from '../../v2/lib/equipment.js'
import { SKILL_BY_NAME } from '../../v2/lib/skills.js'
import { statsAt, effectPct, powerAt } from './gear.js'
import { jobBonusStats, jobOf } from './jobs.js'

const zero = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]))

// 装着中の装備を { slot: { inv, item } } の形で引く（inv.ilv がアイテムLV）
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
export const wornIdsOf = (profile, inventory) =>
  new Set(Object.values(equippedItems(profile, inventory)).map(w => String(w.inv.id)))

// ⚠両手武器は右手と左手の両方に同じ所持品IDが入ることは無い（左手は空ける）が、
//   念のため所持品IDで重複を落としてから足す
const uniqueWorn = (profile, inventory) => {
  const seen = new Set()
  return Object.values(equippedItems(profile, inventory)).filter(w => {
    const k = String(w.inv.id)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// 装備ぶんのステ（必要LV不足ぶんを引いたもの）
export const gearStats = (profile, inventory) => {
  const total = zero()
  for (const { inv, item } of uniqueWorn(profile, inventory)) {
    const s = statsAt(item, inv.ilv, effectPct(inv.ilv, profile?.lv))
    for (const k of STAT_KEYS) total[k] += s[k] || 0
  }
  return total
}
// 装備ぶんの戦闘力（効果%込み）と、足りていればの戦闘力
export const gearPower = (profile, inventory) =>
  uniqueWorn(profile, inventory).reduce((t, { inv, item }) =>
    t + Math.round(powerAt(item, inv.ilv) * effectPct(inv.ilv, profile?.lv) / 100), 0)

// 本体のステ
export const bodyStats = (profile) => Object.fromEntries(STAT_KEYS.map(k => [k, profile?.[k] || 0]))
// いまの職業のジョブのステ
export const jobStats = (profile) => jobBonusStats(profile?.class, jobOf(profile?.jobs, profile?.class).lv)

// 合計。内訳も返す（ステータス画面で「本体＋ジョブ＋装備」を出すため）
export const statBreakdown = (profile, inventory) => {
  const body = bodyStats(profile)
  const job = jobStats(profile)
  const gear = gearStats(profile, inventory)
  const total = Object.fromEntries(STAT_KEYS.map(k => [k, body[k] + job[k] + gear[k]]))
  return { body, job, gear, total, power: calcPower(total) }
}
export const totalStats = (profile, inventory) => statBreakdown(profile, inventory).total

// runBattle に渡す形
export const toFighter = (profile, inventory) => ({
  name: profile?.username || 'あなた',
  cls: profile?.class,
  noClassBonus: true,   // ★職業補正は一旦なし（battle.js の createSide が見る）
  stats: totalStats(profile, inventory),
  enchants: [],
  evolutions: [],
  slots: (profile?.skill_set || [])
    .map(e => ({ skill: SKILL_BY_NAME[e?.name], uses: e?.uses || 1 }))
    .filter(e => e.skill),
})
