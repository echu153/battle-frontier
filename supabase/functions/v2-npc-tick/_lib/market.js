// ============================================================
// バトルフロンティアⅡ（リメイク版）— 取引所
// ------------------------------------------------------------
// 設計の正は docs/v2-market-design.md。ここはその実装（値段と規則の計算）。
//
// ★**取引所はGoldを減らさない**（設計の芯）。
//   プレイヤー同士の売買はGoldが人から人へ移るだけで、世界の総量は1Gも減らない。
//   減るのは**手数料**だけ。つまり
//       Goldが湧く場所 ＝ 素材のNPC売却
//       Goldが消える場所 ＝ 取引所の手数料 ＋ 鍛冶の強化費
//   この釣り合いがv2のインフレ対策そのもの。旧版がインフレで作り直しになった経緯があるので、
//   **手数料は旧版の20%より高め（25%）**に置いてある。あとから下げるのは簡単、上げるのは荒れる。
//
// ★出品できないもの（確定・2026-08-17 ユーザー決定）
//   ・装備中のもの
//   ・**ルーンを1つでも刻んでいるもの**（全部外してから出す。外すには刻印除去装置が要る）
//   ・取引が成立してから7日経っていないもの（traded_at）
//   ⚠**出品できるかの判定は canList() 1か所に固定する**。旧版は帰属の判定を見落とした
//     一括加工が購入装備を消す事故を起こしている（supabase_marketplace_compensation_20260720.sql で補填）。
//     同じ穴を作らないよう、画面もサーバーも同じ規則を通す。
// ============================================================
import { RANKS } from './equipment.js'
import { gradeOf, runePower } from './material.js'

// ===== 手数料 =====
// 売り手が受け取るのは price × (1 - FEE_PCT/100)。差額は**消える**（誰にも渡らない）
export const FEE_PCT = 25
export const feeOf = (price) => Math.floor(Math.max(0, price) * FEE_PCT / 100)
export const payoutOf = (price) => Math.max(0, price) - feeOf(price)

// ===== 出品の枠 =====
export const LISTING_DAYS = 7        // 出品期間。切れたら手元に戻る
export const MAX_LISTINGS = 10       // 同時に出せる件数
export const RETRADE_DAYS = 7        // 取引が成立してから再出品できるまで
export const PRICE_MAX = 10_000_000  // 1件の上限（RMTと誤操作の両方に効く）

// ===== 下限価格 =====
// ★下限は「捨て値でばら撒けないため」のもの。相場は成約価格の表示に任せる。
// 装備 … ランクの基礎価格 × 2^強化値（強化は1段ごとに基礎ステータスが1.5倍伸びるため）
export const EQUIP_BASE = { F:200, E:500, D:1200, C:3000, B:8000, A:20000, S:50000 }
export const equipFloorOf = (rank, plus = 0) =>
  Math.round((EQUIP_BASE[rank] ?? EQUIP_BASE.F) * Math.pow(2, Math.max(0, plus || 0)))

// ルーン … 名前の段（合計値で0〜5）で跳ね上げ、特殊能力つきはさらに3倍
export const RUNE_FLOOR = [500, 2000, 8000, 32000, 128000, 512000]
export const RUNE_ABILITY_MULT = 3
export const runeFloorOf = (stats, ability = null) =>
  RUNE_FLOOR[gradeOf(runePower(stats))] * (ability ? RUNE_ABILITY_MULT : 1)

// 出品するもの（装備 or ルーン）の下限。kind は 'equip' | 'rune'
export const floorOf = (kind, o) =>
  kind === 'rune' ? runeFloorOf(o?.stats, o?.ability) : equipFloorOf(o?.rank, o?.plus)

// 値段が通るか。理由つきで返す（無言で弾かない）
export const checkPrice = (kind, o, price) => {
  const p = Math.floor(Number(price) || 0)
  const floor = floorOf(kind, o)
  if (!Number.isFinite(p) || p <= 0) return { ok:false, floor, error:'値段を入れてください' }
  if (p < floor) return { ok:false, floor, error:`この品は${floor.toLocaleString()}G以上でないと出せません` }
  if (p > PRICE_MAX) return { ok:false, floor, error:`${PRICE_MAX.toLocaleString()}Gを超える値は付けられません` }
  return { ok:true, floor, price:p }
}

// ===== 出品できるか =====
const DAY_MS = 24 * 60 * 60 * 1000
// 再出品できるようになるまでの残り日数（0＝いま出せる）
export const retradeLeftOf = (tradedAt, now = Date.now()) => {
  if (!tradedAt) return 0
  const passed = now - new Date(tradedAt).getTime()
  if (!Number.isFinite(passed)) return 0
  return Math.max(0, Math.ceil((RETRADE_DAYS * DAY_MS - passed) / DAY_MS))
}

// ★出品できるかの判定はここ1か所。画面もサーバーも同じ規則を通す
//   inv … v2_inventory の行 ／ worn … 装着中の所持品IDの集合 ／ runes … その個体に刺さっているルーン
export const canList = (inv, { worn = new Set(), runes = [], listed = false, now = Date.now() } = {}) => {
  if (!inv) return { ok:false, error:'その装備がありません' }
  if (listed) return { ok:false, error:'すでに出品しています' }
  if (worn.has(String(inv.id))) return { ok:false, error:'装備中のものは出せません（外してから）' }
  if ((runes || []).length) return { ok:false, error:'ルーンを刻んだままでは出せません（刻印除去装置で外してから）' }
  const left = retradeLeftOf(inv.traded_at, now)
  if (left > 0) return { ok:false, error:`取引したばかりです（あと${left}日で出せます）` }
  return { ok:true }
}

// ===== 並び替え・絞り込み =====
export const SORTS = [
  { key:'cheap', label:'安い順' },
  { key:'rich',  label:'高い順' },
  { key:'new',   label:'新着順' },
  { key:'power', label:'戦闘力順' },
]
export const sortListings = (rows, key) => {
  const out = [...(rows || [])]
  if (key === 'rich')  return out.sort((a, b) => b.price - a.price)
  if (key === 'new')   return out.sort((a, b) => new Date(b.listed_at) - new Date(a.listed_at))
  if (key === 'power') return out.sort((a, b) => (b.power || 0) - (a.power || 0))
  return out.sort((a, b) => a.price - b.price)
}

// 残り日数（出品期間）。切れたものは一覧に出さない
export const listingLeftOf = (listedAt, now = Date.now()) => {
  const passed = now - new Date(listedAt).getTime()
  if (!Number.isFinite(passed)) return LISTING_DAYS
  return Math.max(0, Math.ceil((LISTING_DAYS * DAY_MS - passed) / DAY_MS))
}

export { RANKS }
