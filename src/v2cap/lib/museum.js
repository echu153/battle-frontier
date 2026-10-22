// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 博物館（装備の寄贈）
// ------------------------------------------------------------
// 【確定】2026-10-22 ユーザー指示「V1にあるような装備を寄贈する博物館を作成したい／
//   登録時に能力もらえるけど詳細はあとで作成する、とりあえず土台だけ作って」
// 土台の決まり（V1 の博物館 src/pages/Museum.jsx と同じ形）：
//   ・寄贈した装備は**なくなる**。着けている装備は寄贈できない
//   ・同じ装備（base_id）を3つの段階で、それぞれ1回ずつ寄贈できる（tierOfPlus）
//   ・★**登録でもらえる能力はまだ無い**（あとでユーザーが決める）。サーバーの記録（v2cap_museum：装備・段階・寄贈したときの強化値）
//     から数え直せる形にしてある＝能力を決めたら、記録から足すだけで前に寄贈したぶんにも付く
// 【確定】2026-10-23 ユーザー指示（実機を見て）：
//   ・「未強化、＋５、＋9、これ以外の強化値は登録できないように」＝段階は **+0／+5／+9 ちょうど**（前は V1 と同じ「+0〜4／+5以上／+9以上」）。
//     名前も「未強化／+5／+9」
//   ・「初期装備は対象外」＝並びは エリア1〜15・ユニーク の16のまとまり（初期装備は寄贈もできない）
//   ・「ユニークは寄贈していないものは？？？で」＝登録の一覧で、どの段階も登録していないユニークは名前を出さない（uniqueHidden）
//   ・寄贈のあとに結果のポップアップ・一括寄贈（画面 V2capMuseum.jsx・サーバー v2cap_museum_donate_many）
// ★決めるのはサーバー（supabase_v2cap_core.sql §14 の v2cap_museum_take）。段階の決まりはここと同じ（museum.test.js が突き合わせる）
// ============================================================
import { ITEMS, UNIQUE_ITEMS, ITEM_BY_ID, RARITIES, UNIQUE_RARITY, isUnique } from './equipment.js'
import { AREA_LIST } from './areas.js'
import { plusOf } from './smith.js'

// 段階（色は V1 と同じ）。plus＝登録できる強化値（ちょうど）
export const MUSEUM_TIERS = [
  { key: 0, label: '未強化', plus: 0, color: '#88ccff' },
  { key: 1, label: '+5',     plus: 5, color: '#44ff88' },
  { key: 2, label: '+9',     plus: 9, color: '#ffcc00' },
]
// その強化値で登録できる段階（+0・+5・+9 以外は null＝寄贈できない）
export const tierOfPlus = (plus) => MUSEUM_TIERS.find(t => t.plus === plus)?.key ?? null

// まとまり：エリア1〜15・ユニーク（中はレア度の順＝一覧の並びのまま）。初期装備は入れない
export const MUSEUM_GROUPS = [
  ...AREA_LIST.map((a, i) => ({ key: `area${i + 1}`, label: a.name, items: ITEMS.filter(it => it.area === i + 1) })),
  { key: 'unique', label: 'ユニーク', items: UNIQUE_ITEMS },
]
export const MUSEUM_ITEMS = MUSEUM_GROUPS.flatMap(g => g.items)
const MUSEUM_IDS = new Set(MUSEUM_ITEMS.map(i => i.id))
export const isMuseumItem = (item) => !!item && MUSEUM_IDS.has(item.id)
// まとまりの中のレア度の並び（ユニークのまとまりは1つ）
export const raritiesOfGroup = (group) => [...RARITIES, UNIQUE_RARITY].filter(r => group.items.some(it => it.rarity === r))

// 登録の記録（v2cap_museum の行 { base_id, tier, plus }）→「装備|段階」の集まり
export const museumKey = (baseId, tier) => `${baseId}|${tier}`
export const registeredSetOf = (rows) => new Set((rows || []).map(r => museumKey(r.base_id, Number(r.tier))))
export const tiersOf = (registered, baseId) => MUSEUM_TIERS.filter(t => registered.has(museumKey(baseId, t.key))).map(t => t.key)
// 登録の一覧で名前を隠すか：どの段階も登録していないユニーク
export const uniqueHidden = (registered, item) => isUnique(item) && tiersOf(registered, item.id).length === 0

// 登録数（段階ごと・全体）。分母は装備の数（どの段階も同じ）
export const museumCountOf = (rows, items = MUSEUM_ITEMS) => {
  const reg = registeredSetOf(rows)
  const byTier = MUSEUM_TIERS.map(t => items.filter(i => reg.has(museumKey(i.id, t.key))).length)
  return { byTier, total: byTier.reduce((a, b) => a + b, 0), max: items.length * MUSEUM_TIERS.length, items: items.length }
}

// 着けている持ち物の id（サーバーと同じく、着けている枠の値そのもの＝いまの職業で使えない武器も「着けている」）
export const wornInvIdsOf = (profile) =>
  new Set(Object.values(profile?.equipped || {}).filter(v => v !== null && v !== undefined).map(String))

// 寄贈できる持ち物：博物館の装備（初期装備でない）・着けていない・強化値が +0／+5／+9・その段階がまだ登録されていない。
// 同じ装備・同じ段階（＝同じ強化値）の持ち物が2つ以上あれば1つだけ出して、個数を添える。
// 返り値 [{ inv, item, tier, copies }]（まとまり→レア度→一覧の並び→段階）
export const donatablesOf = (profile, inventory, rows) => {
  const reg = registeredSetOf(rows)
  const worn = wornInvIdsOf(profile)
  const best = new Map()
  for (const inv of inventory || []) {
    const item = ITEM_BY_ID[inv?.base_id]
    if (!isMuseumItem(item) || worn.has(String(inv.id))) continue
    const tier = tierOfPlus(plusOf(inv))
    if (tier === null) continue
    const key = museumKey(item.id, tier)
    if (reg.has(key)) continue
    const cur = best.get(key)
    best.set(key, cur ? { ...cur, copies: cur.copies + 1 } : { inv, item, tier, copies: 1 })
  }
  const order = new Map(MUSEUM_ITEMS.map((it, i) => [it.id, i]))
  return [...best.values()].sort((a, b) => (order.get(a.item.id) - order.get(b.item.id)) || (a.tier - b.tier))
}
// まとめて選ぶときに入れるか：ユニークは入れない（1つずつなら選べる＝鍛冶屋のまとめての分解と同じ）
export const bulkDonatable = (d) => !isUnique(d.item)
// 寄贈の結果の1行：「ブロンズダガー」を寄贈しました（未強化で登録）
export const donatedText = (name, tier) => `「${name}」を寄贈しました（${MUSEUM_TIERS[tier]?.label ?? ''}で登録）`
