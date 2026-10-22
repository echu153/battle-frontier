// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 博物館（装備の寄贈）
// ------------------------------------------------------------
// 【確定】2026-10-22 ユーザー指示「V1にあるような装備を寄贈する博物館を作成したい／
//   登録時に能力もらえるけど詳細はあとで作成する、とりあえず土台だけ作って」
// 土台の決まり（V1 の博物館 src/pages/Museum.jsx と同じ形）：
//   ・寄贈した装備は**なくなる**。着けている装備は寄贈できない
//   ・同じ装備（base_id）を **未強化（+0〜4）／+5以上／+9以上** の3段階で、それぞれ1回ずつ寄贈できる（tierOfPlus）
//   ・並びは 初期装備・エリア1〜15・ユニーク の17のまとまり（MUSEUM_GROUPS）
//   ・★**登録でもらえる能力はまだ無い**（あとでユーザーが決める）。サーバーの記録（v2cap_museum：装備・段階・寄贈したときの強化値）
//     から数え直せる形にしてある＝能力を決めたら、記録から足すだけで前に寄贈したぶんにも付く
// ★決めるのはサーバー（supabase_v2cap_core.sql §14 の v2cap_museum_donate）。段階の決まりはここと同じ（v2capsql.test.js が突き合わせる）
// ============================================================
import { ITEMS, STARTER_ITEMS, UNIQUE_ITEMS, ITEM_BY_ID, RARITIES, UNIQUE_RARITY } from './equipment.js'
import { AREA_LIST } from './areas.js'
import { plusOf } from './smith.js'

// 段階（V1 と同じ区切り・名前・色）
export const MUSEUM_TIERS = [
  { key: 0, label: '未強化', min: 0, color: '#88ccff' },
  { key: 1, label: '+5以上', min: 5, color: '#44ff88' },
  { key: 2, label: '+9以上', min: 9, color: '#ffcc00' },
]
export const tierOfPlus = (plus) => (plus >= 9 ? 2 : plus >= 5 ? 1 : 0)

// まとまり：初期装備・エリア1〜15・ユニーク（中はレア度の順＝一覧の並びのまま）
export const MUSEUM_GROUPS = [
  { key: 'starter', label: '初期装備', items: STARTER_ITEMS },
  ...AREA_LIST.map((a, i) => ({ key: `area${i + 1}`, label: a.name, items: ITEMS.filter(it => it.area === i + 1) })),
  { key: 'unique', label: 'ユニーク', items: UNIQUE_ITEMS },
]
export const MUSEUM_ITEMS = MUSEUM_GROUPS.flatMap(g => g.items)
// まとまりの中のレア度の並び（ユニークのまとまりは1つ）
export const raritiesOfGroup = (group) => [...RARITIES, UNIQUE_RARITY].filter(r => group.items.some(it => it.rarity === r))

// 登録の記録（v2cap_museum の行 { base_id, tier, plus }）→「装備|段階」の集まり
export const museumKey = (baseId, tier) => `${baseId}|${tier}`
export const registeredSetOf = (rows) => new Set((rows || []).map(r => museumKey(r.base_id, Number(r.tier))))
export const tiersOf = (registered, baseId) => MUSEUM_TIERS.filter(t => registered.has(museumKey(baseId, t.key))).map(t => t.key)

// 登録数（段階ごと・全体）。分母は装備の数（どの段階も同じ）
export const museumCountOf = (rows, items = MUSEUM_ITEMS) => {
  const ids = new Set(items.map(i => i.id))
  const reg = registeredSetOf(rows)
  const byTier = MUSEUM_TIERS.map(t => items.filter(i => reg.has(museumKey(i.id, t.key))).length)
  return { byTier, total: byTier.reduce((a, b) => a + b, 0), max: ids.size * MUSEUM_TIERS.length, items: ids.size }
}

// 着けている持ち物の id（サーバーと同じく、着けている枠の値そのもの＝いまの職業で使えない武器も「着けている」）
export const wornInvIdsOf = (profile) =>
  new Set(Object.values(profile?.equipped || {}).filter(v => v !== null && v !== undefined).map(String))

// 寄贈できる持ち物：一覧にある装備・着けていない・その段階がまだ登録されていない。
// 同じ装備・同じ段階の持ち物が2つ以上あれば、強化値のいちばん低いもの1つだけ（同じ段階なら強化したものを残す）。
// 返り値 [{ inv, item, tier, copies }]（まとまり→レア度→一覧の並び）
export const donatablesOf = (profile, inventory, rows) => {
  const reg = registeredSetOf(rows)
  const worn = wornInvIdsOf(profile)
  const best = new Map()
  for (const inv of inventory || []) {
    const item = ITEM_BY_ID[inv?.base_id]
    if (!item || worn.has(String(inv.id))) continue
    const tier = tierOfPlus(plusOf(inv))
    const key = museumKey(item.id, tier)
    if (reg.has(key)) continue
    const cur = best.get(key)
    if (!cur) best.set(key, { inv, item, tier, copies: 1 })
    else best.set(key, { ...(plusOf(inv) < plusOf(cur.inv) ? { inv, item, tier } : cur), copies: cur.copies + 1 })
  }
  const order = new Map(MUSEUM_ITEMS.map((it, i) => [it.id, i]))
  return [...best.values()].sort((a, b) => (order.get(a.item.id) - order.get(b.item.id)) || (a.tier - b.tier))
}
