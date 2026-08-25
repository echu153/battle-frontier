// ============================================================
// バトルフロンティアⅡ（リメイク版）— 編成（プロフィール＋装備＋スキル）から戦闘用のキャラを作る
// ------------------------------------------------------------
// runBattle に渡せる形（{ name, cls, stats, slots }）を組み立てるだけの純関数。
// 装備の数値は equipment.js が正なので、ここでは足し合わせるだけ。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from './stats.js'
import { ITEM_BY_ID, statsOf as equipStats, powerOf as equipPower, SLOTS } from './equipment.js'
import { SKILL_BY_NAME } from './skills.js'
import { jobCountOf } from './classBonus.js'
import { fishDexPct } from './fishing.js'
import { dexStats } from './dex.js'
import { pendingStage } from './evolve.js'

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

// ===== 武器の進化（戦闘記憶）=====
// 熟練度が貯まるのは**武器だけ**（右手・左手にそれぞれ独立して貯まる）。
// ★防具に貯めない理由：「この1本を使い込む」という話なので、対象を増やすと薄まる。
export const equippedWeapons = (profile, inventory) =>
  Object.values(equippedItems(profile, inventory)).filter(w => w.item.part === '武器')

// 装備している武器に付いている進化を全部並べる（右手と左手のぶんが足し算になる）
export const equippedEvolutions = (profile, inventory) =>
  equippedWeapons(profile, inventory).flatMap(w => w.inv.evolutions || [])

// いま戦績が貯まる武器の所持品ID。戦闘後にサーバーへ渡す
export const recordingWeaponIds = (profile, inventory) =>
  equippedWeapons(profile, inventory).map(w => Number(w.inv.id))

// その装備の戦績。★熟練度（exp）も record の中に入っている（列を分けると必ずズレる）
export const recordOf = (inv) => inv?.record || {}

// 進化を付けられる武器（節目に達したのに、まだ受け取っていないもの）
export const evolvableWeapons = (profile, inventory) =>
  equippedWeapons(profile, inventory)
    .map(w => ({ ...w, stage: pendingStage(recordOf(w.inv), w.inv.evolutions) }))
    .filter(w => w.stage > 0)

// ===== エンチャント =====
// ルーン（v2_essences）は装備の個体（v2_inventory.id）に刺さっている。
// **効いているのは「装着中の装備に刺さっているぶん」だけ**（倉庫で寝ている武器のぶんは効かない）
export const equippedRunes = (profile, inventory, runes) => {
  const wornInv = new Set(Object.values(equippedItems(profile, inventory)).map(w => String(w.inv.id)))
  return (runes || []).filter(e => e.inv_id != null && wornInv.has(String(e.inv_id)))
}
// ルーンぶんのステータス補正(%)。**固定値ではなく割合**なのでここだけ別枠
export const runeStatPct = (list) => {
  const out = {}
  for (const e of list || []) {
    for (const [k, v] of Object.entries(e.stats || {})) out[k] = (out[k] || 0) + Number(v || 0)
  }
  return out
}
// 刻印ぶんの効果を「STR+3.0% / VIT+1.2%」の1行にする（倉庫・ツールチップで使う）
export const runePctText = (list) => {
  const pct = runeStatPct(list)
  return STAT_KEYS.filter(k => pct[k])
    .map(k => `${STAT_DEFS[k].label}+${Math.round(pct[k] * 10) / 10}%`)
    .join(' / ')
}

// 付いている特殊能力の名前（＝敵の名前。enchant.js のキー）。**同じものが複数あればそのぶん並ぶ**
export const runeAbilities = (list) => (list || []).map(e => e.ability).filter(Boolean)

// ルーン＋釣り図鑑の補正(%)をひとまとめにする。
// ★どちらも「%」なので同じ枠で合算する。**図鑑ぶんだけ別の計算経路を作らない**
//   （別経路にすると、戦闘のどこか1つに入れ忘れたときに気付けない）
export const statPct = (profile, inventory, runes, fishDex) => {
  const out = { ...runeStatPct(equippedRunes(profile, inventory, runes)) }
  for (const [k, v] of Object.entries(fishDexPct(fishDex))) out[k] = (out[k] || 0) + v
  return out
}

// 本体＋装備＋モンスター図鑑の合計ステータス。ルーンと釣り図鑑の%はこの合計に対して掛かる
// ⚠ fishDex（v2_player_fish）と dex（討伐数・見つけた素材）を渡し忘れると
//   図鑑のぶんが黙って消える。渡し忘れを検出するテストが fishing.test.js にある
// ★モンスター図鑑のぶんは**固定値**（討伐数と素材の初回登録）。装備と同じく素の合計に足す
export const totalStats = (profile, inventory, runes, fishDex, dex) => {
  const gear = gearStats(profile, inventory)
  const pct = statPct(profile, inventory, runes, fishDex)
  const bonus = dexStats(dex?.kills, dex?.found)
  return Object.fromEntries(STAT_KEYS.map(k => {
    const base = (profile?.[k] || 0) + gear[k] + bonus[k]
    return [k, pct[k] ? Math.round(base * (1 + pct[k] / 100)) : base]
  }))
}

// runBattle に渡す形。スキル編成が空なら通常攻撃だけで戦う
export const toFighter = (profile, inventory, runes, fishDex, dex) => ({
  name: profile?.username || 'あなた',
  cls: profile?.class,
  // ★職業補正は「その職業に何回転職したか」で伸びる（classBonus.js）
  jobCount: jobCountOf(profile),
  stats: totalStats(profile, inventory, runes, fishDex, dex),
  enchants: runeAbilities(equippedRunes(profile, inventory, runes)),
  // ★武器の進化（戦闘記憶）。刻印とは別枠で、装備している武器のぶんが乗る
  evolutions: equippedEvolutions(profile, inventory),
  slots: (profile?.skill_set || [])
    .map(e => ({ skill: SKILL_BY_NAME[e?.name], uses: e?.uses || 1 }))
    .filter(e => e.skill),
})
