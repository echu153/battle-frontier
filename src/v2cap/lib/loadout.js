// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 編成から戦闘用のキャラを作る
// ------------------------------------------------------------
// 戦闘力の内訳は3つ：
//   本体（LVアップの抽選で上がったステ）＋ ジョブのステ（いまの職業・そのJBLVぶん）
//   ＋ 装備（アイテムLVで強さが決まり、必要LVに足りないぶん効果が下がる）
// さらに防具のメリット（重鎧＝受けるダメージ−3%／軽装＝AGI+5%・1部位ごと）が乗る。
// ★職業補正は**一旦なし**（2026-10-09 ユーザー決定）＝ runBattle に noClassBonus を渡す。
// ★武器は職業ごとに装備できる種類が決まっている。いまの職業で装備できない武器は
//   （サーバーが外すはずだが）念のためここでも数えない
// ============================================================
import { STAT_KEYS, calcPower } from '../../v2/lib/stats.js'
import { ITEM_BY_ID, SLOTS } from './equipment.js'
import { SKILL_BY_NAME } from './skills.js'
import { statsAt, effectPct, powerAt, armorEffects } from './gear.js'
import { jobBonusStats, jobOf, canEquipType, attackKindOf } from './jobs.js'

const zero = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]))

// 装着中の装備を { slot: { inv, item } } の形で引く（inv は { id, base_id, rank, ilv }）
export const equippedItems = (profile, inventory) => {
  const byId = Object.fromEntries((inventory || []).map(i => [String(i.id), i]))
  const out = {}
  for (const slot of SLOTS) {
    const invId = profile?.equipped?.[slot]
    if (invId === undefined || invId === null) continue
    const inv = byId[String(invId)]
    const item = inv && ITEM_BY_ID[inv.base_id]
    if (!inv || !item) continue
    if (item.part === '武器' && !canEquipType(profile?.class, item.type)) continue
    out[slot] = { inv, item }
  }
  return out
}
export const wornIdsOf = (profile, inventory) =>
  new Set(Object.values(equippedItems(profile, inventory)).map(w => String(w.inv.id)))

// 装備ぶんのステ（必要LV不足ぶんを引いたもの）
export const gearStats = (profile, inventory) => {
  const total = zero()
  for (const { inv, item } of Object.values(equippedItems(profile, inventory))) {
    const s = statsAt(item, inv.rank, inv.ilv, effectPct(inv.ilv, profile?.lv))
    for (const k of STAT_KEYS) total[k] += s[k] || 0
  }
  return total
}
// 装備ぶんの戦闘力（効果%込み）
export const gearPower = (profile, inventory) =>
  Object.values(equippedItems(profile, inventory)).reduce((t, { inv, item }) =>
    t + Math.round(powerAt(item, inv.rank, inv.ilv) * effectPct(inv.ilv, profile?.lv) / 100), 0)

// 防具のメリット（受けるダメージの倍率・AGIの上がり幅）
export const armorOf = (profile, inventory) => armorEffects(
  Object.values(equippedItems(profile, inventory))
    .filter(w => w.item.line)
    .map(w => ({ item: w.item, pct: effectPct(w.inv.ilv, profile?.lv) })))

// 本体のステ
export const bodyStats = (profile) => Object.fromEntries(STAT_KEYS.map(k => [k, profile?.[k] || 0]))
// いまの職業のジョブのステ
export const jobStats = (profile) => jobBonusStats(profile?.class, jobOf(profile?.jobs, profile?.class).lv)

// 合計。内訳も返す（ステータス画面で「本体＋ジョブ＋装備」を出すため）。
// ★軽装のAGI+%は「本体＋ジョブ＋装備」のAGIに掛ける（上がったぶんは armorAgi に出す）
export const statBreakdown = (profile, inventory) => {
  const body = bodyStats(profile)
  const job = jobStats(profile)
  const gear = gearStats(profile, inventory)
  const armor = armorOf(profile, inventory)
  const total = Object.fromEntries(STAT_KEYS.map(k => [k, body[k] + job[k] + gear[k]]))
  const armorAgi = Math.round(total.agi * armor.agiPct / 100)
  total.agi += armorAgi
  return { body, job, gear, armor, armorAgi, total, power: calcPower(total) }
}
export const totalStats = (profile, inventory) => statBreakdown(profile, inventory).total

// runBattle に渡す形。重鎧の「受けるダメージ−%」は taken（物理・魔法とも）で渡す
export const toFighter = (profile, inventory) => {
  const bd = statBreakdown(profile, inventory)
  return {
    name: profile?.username || 'あなた',
    cls: profile?.class,
    kind: attackKindOf(profile?.class),   // 通常攻撃が物理か魔法か（今のⅡの名簿に無い職業があるので明示する）
    noClassBonus: true,                   // ★職業補正は一旦なし（battle.js の createSide が見る）
    stats: bd.total,
    taken: bd.armor.takenMult !== 1 ? { phys: bd.armor.takenMult, mag: bd.armor.takenMult } : null,
    enchants: [],
    evolutions: [],
    slots: (profile?.skill_set || [])
      .map(e => ({ skill: SKILL_BY_NAME[e?.name], uses: e?.uses || 1 }))
      .filter(e => e.skill),
  }
}
