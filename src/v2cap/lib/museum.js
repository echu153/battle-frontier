// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 博物館（装備の寄贈）
// ------------------------------------------------------------
// 【確定】2026-10-22 ユーザー指示「V1にあるような装備を寄贈する博物館を作成したい／
//   登録時に能力もらえるけど詳細はあとで作成する、とりあえず土台だけ作って」
// 土台の決まり（V1 の博物館 src/pages/Museum.jsx と同じ形）：
//   ・寄贈した装備は**なくなる**。着けている装備は寄贈できない
//   ・同じ装備（base_id）を3つの段階で、それぞれ1回ずつ寄贈できる（tierOfPlus）
//   ・登録でもらえる報酬は 2026-10-23 に入れた（下の「報酬」）。サーバーの記録（v2cap_museum：装備・段階・寄贈したときの強化値）
//     から数え直す形＝前に寄贈したぶんにも付く
// 【確定】2026-10-23 ユーザー指示（実機を見て）：
//   ・「未強化、＋５、＋9、これ以外の強化値は登録できないように」＝段階は **+0／+5／+9 ちょうど**（前は V1 と同じ「+0〜4／+5以上／+9以上」）。
//     名前も「未強化／+5／+9」
//   ・「初期装備は対象外」＝初期装備は寄贈もできない
//   ・（「ユニークは寄贈していないものは？？？で」は、下の「ユニークは寄贈できない」で取りやめ）
//   ・寄贈のあとに結果のポップアップ・一括寄贈（画面 V2capMuseum.jsx・サーバー v2cap_museum_donate_many）
// 【確定】2026-10-23 ユーザー指示「ユニーク装備は寄贈できないようにあることすら悟られないようにしたい」：
//   ユニークは寄贈できない（一覧・寄贈できる装備・タブ・説明のどこにも出さない＝ユニークの文字も書かない）。
//   並びは エリア1〜15 の15のまとまり（1560種×3段階）。サーバーもユニークを弾く（v2cap_museum_take）
// ★決めるのはサーバー（supabase_v2cap_core.sql §14 の v2cap_museum_take）。段階の決まりはここと同じ（museum.test.js が突き合わせる）
// ============================================================
import { ITEMS, ITEM_BY_ID, RARITIES, RARITY_LABEL } from './equipment.js'
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

// まとまり：エリア1〜15（中はレア度の順＝一覧の並びのまま）。初期装備・ユニークは入れない
export const MUSEUM_GROUPS = AREA_LIST.map((a, i) => ({ key: `area${i + 1}`, area: i + 1, label: a.name, items: ITEMS.filter(it => it.area === i + 1) }))
export const MUSEUM_ITEMS = MUSEUM_GROUPS.flatMap(g => g.items)
const MUSEUM_IDS = new Set(MUSEUM_ITEMS.map(i => i.id))
export const isMuseumItem = (item) => !!item && MUSEUM_IDS.has(item.id)
// まとまりの中のレア度の並び
export const raritiesOfGroup = (group) => RARITIES.filter(r => group.items.some(it => it.rarity === r))

// 登録の記録（v2cap_museum の行 { base_id, tier, plus }）→「装備|段階」の集まり
export const museumKey = (baseId, tier) => `${baseId}|${tier}`
export const registeredSetOf = (rows) => new Set((rows || []).map(r => museumKey(r.base_id, Number(r.tier))))
export const tiersOf = (registered, baseId) => MUSEUM_TIERS.filter(t => registered.has(museumKey(baseId, t.key))).map(t => t.key)

// 登録数（段階ごと・全体）。分母は装備の数（どの段階も同じ）
export const museumCountOf = (rows, items = MUSEUM_ITEMS) => {
  const reg = registeredSetOf(rows)
  const byTier = MUSEUM_TIERS.map(t => items.filter(i => reg.has(museumKey(i.id, t.key))).length)
  return { byTier, total: byTier.reduce((a, b) => a + b, 0), max: items.length * MUSEUM_TIERS.length, items: items.length }
}

// 着けている持ち物の id（サーバーと同じく、着けている枠の値そのもの＝いまの職業で使えない武器も「着けている」）
export const wornInvIdsOf = (profile) =>
  new Set(Object.values(profile?.equipped || {}).filter(v => v !== null && v !== undefined).map(String))

// 寄贈できる持ち物：博物館の装備（初期装備でない）・着けていない・お気に入り（★）でない・強化値が +0／+5／+9・その段階がまだ登録されていない。
//   お気に入りは 2026-10-26 ユーザー選択「寄贈もできないようにする」（分解と同じく守る・サーバーの v2cap_museum_take も断る）
// 同じ装備・同じ段階（＝同じ強化値）の持ち物が2つ以上あれば1つだけ出して、個数を添える。
// 返り値 [{ inv, item, tier, copies }]（まとまり→レア度→一覧の並び→段階）
export const donatablesOf = (profile, inventory, rows) => {
  const reg = registeredSetOf(rows)
  const worn = wornInvIdsOf(profile)
  const best = new Map()
  for (const inv of inventory || []) {
    const item = ITEM_BY_ID[inv?.base_id]
    // ★真化した武器（2026-10-26・shinka.js）も出さない（同じ装備の真化していない持ち物があればそちらを寄贈する）
    if (!isMuseumItem(item) || worn.has(String(inv.id)) || inv.fav || inv.shinka) continue
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
// 寄贈の結果の1行：「ブロンズダガー」を寄贈しました（未強化で登録）
// 【確定】2026-10-23 ユーザー指示「既存の装備と同じように色付けてほしい、装備名だけね」＝画面は装備名だけレア度の色
//   （「」の中＝RARITY_COLOR）で出し、後ろの文は donatedTail
export const donatedTail = (tier) => `を寄贈しました（${MUSEUM_TIERS[tier]?.label ?? ''}で登録）`
export const donatedText = (name, tier) => `「${name}」${donatedTail(tier)}`

// ===== 報酬（2026-10-23）=====
// 【確定】2026-10-23 ユーザー指示「エリアごとに統一／レアリティごとに全部そろえたら報酬獲得／強化値に限らず、それぞれの強化値ごとに該当の報酬獲得」
//   ＋「エリア全体でレアリティ全部寄贈してると…スタミナ回復時間1秒短縮／エリアコンプリート※ユニークを除く 1秒短縮」「どれも恒久的」：
//   ・エリア×レア度の装備（26種）を、ひとつの段階で全部寄贈 → ステータスポイント（MUSEUM_SET_SP・段階ごとにもらえる）
//   ・そのレア度を3段階ともそろえる → スタミナの回復 −1秒（ユーザー選択「3段階そろえて1回」）
//   ・エリアの4つのレア度×3段階をぜんぶ（エリアコンプリート）→ さらに −1秒
//   ・全部そろえると ステータスポイント +450・スタミナの回復 −75秒（3分→1分45秒）。ユニークは寄贈できない（上）
// ★決めて入れるのはサーバー（v2cap_museum_settle・報酬の表 v2cap_museum_rewards）。ここは表示の写し
export const MUSEUM_SET_SP = { N: 1, R: 2, E: 3, L: 4 }
export const MUSEUM_RARITY_STAM_SEC = 1
export const MUSEUM_AREA_STAM_SEC = 1
export const MUSEUM_REWARD_RARITIES = RARITIES
// エリア×レア度の装備（報酬の分母）
export const setItemsOf = (area, rarity) => ITEMS.filter(i => i.area === area && i.rarity === rarity)
// そのエリアの報酬の進み：レア度ごとに 段階ごとの登録数・そろったか・3段階そろったか、とエリアコンプリート
export const areaProgressOf = (registered, area) => {
  const rarities = MUSEUM_REWARD_RARITIES.map(rarity => {
    const items = setItemsOf(area, rarity)
    const tiers = MUSEUM_TIERS.map(t => {
      const have = items.filter(i => registered.has(museumKey(i.id, t.key))).length
      return { tier: t.key, have, need: items.length, done: items.length > 0 && have >= items.length }
    })
    return { rarity, tiers, allTiers: tiers.every(t => t.done) }
  })
  return { area, rarities, complete: rarities.every(r => r.allTiers) }
}
// もらった報酬の合計（登録から数える＝サーバーの報酬の表と同じになる）
export const museumRewardTotalsOf = (rows) => {
  const reg = registeredSetOf(rows)
  let sp = 0, stamSec = 0
  AREA_LIST.forEach((_, i) => {
    const p = areaProgressOf(reg, i + 1)
    for (const r of p.rarities) {
      sp += r.tiers.filter(t => t.done).length * MUSEUM_SET_SP[r.rarity]
      if (r.allTiers) stamSec += MUSEUM_RARITY_STAM_SEC
    }
    if (p.complete) stamSec += MUSEUM_AREA_STAM_SEC
  })
  return { sp, stamSec }
}
// サーバーが返す新しい報酬（{ key, kind, amount }）の1行：
//   set:1:N:0 → 「始まりの森 ノーマル（未強化）をそろえた！ステータスポイント+1」
//   rarity:1:N → 「始まりの森 ノーマルを3段階そろえた！スタミナの回復−1秒」／ area:1 → 「始まりの森をコンプリート！スタミナの回復−1秒」
export const rewardText = (w) => {
  const [type, a, r, t] = String(w?.key || '').split(':')
  const area = AREA_LIST[Number(a) - 1]?.name || ''
  const gain = w?.kind === 'sp' ? `ステータスポイント+${w.amount}` : `スタミナの回復−${w?.amount}秒`
  if (type === 'set') return `${area} ${RARITY_LABEL[r] || r}（${MUSEUM_TIERS[Number(t)]?.label ?? ''}）をそろえた！${gain}`
  if (type === 'rarity') return `${area} ${RARITY_LABEL[r] || r}を3段階そろえた！${gain}`
  if (type === 'area') return `${area}をコンプリート！${gain}`
  return gain
}
// 新しくもらった報酬の並び（画面に出す順）。サーバーは key の文字の順（エピック→レジェンダリー→ノーマル→レア）で返すので並べ直す。
// 【確定】2026-10-23 ユーザー指示「報酬の行をノーマル→レア→エピック→レジェンダリーの順に直して」：
//   エリアの順 → そのエリアの中は「段階ごとのステータスポイント（レア度の順→未強化・+5・+9）」→「3段階のスタミナ（レア度の順）」→「エリアコンプリート」
const REWARD_TYPE_ORDER = { set: 0, rarity: 1, area: 2 }
const rarityIndex = (r) => { const i = RARITIES.indexOf(r); return i < 0 ? RARITIES.length : i }
export const sortRewards = (list) => {
  const keyOf = (w) => {
    const [type, a, r, t] = String(w?.key || '').split(':')
    return [Number(a) || 0, REWARD_TYPE_ORDER[type] ?? 9, rarityIndex(r), Number(t) || 0]
  }
  return [...(list || [])].sort((x, y) => {
    const a = keyOf(x), b = keyOf(y)
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  })
}
