// ============================================================
// バトルフロンティアⅡ（リメイク版）— 拠点の釣り場
// ------------------------------------------------------------
// 設計は docs/v2-kyoten-design.md §7。
//
//   釣り場を拡張する → 釣り場エリアが1つ解放される（各6種・全54種）
//   どの魚にも4グレード（コモン／レア／エピック／レジェンド）がある＝図鑑216枠
//   初めて釣った1枠につき、その魚のステータスが %で恒久的に上がる
//   魚は釣りメダルに換え、メダルはルーン素材と保護札に換える
//
// ★**抽選と付与の権威はサーバー**（supabase_v2_core.sql の §12）。
//   このファイルは画面の表示とテスト用。**片方だけ直すと fishing.test.js が落ちる**。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from './stats.js'

// ===== グレード（レア度）=====
export const TIERS = ['common', 'rare', 'epic', 'legend']
export const TIER_SHORT = { common: 'c', rare: 'r', epic: 'e', legend: 'l' }
export const TIER_LABEL = { common: 'コモン', rare: 'レア', epic: 'エピック', legend: 'レジェンド' }
export const TIER_COLOR = { common: '#a8c4d6', rare: '#66ccff', epic: '#c07fff', legend: '#ffcc44' }
// 出やすさ(%)。合計100
export const TIER_RATE = { common: 70, rare: 22, epic: 7, legend: 1 }
// 図鑑に登録したときに上がる量(%)（2026-08-17 ユーザー決定）
export const TIER_PCT = { common: 0.1, rare: 0.2, epic: 0.3, legend: 0.4 }
// メダルの倍率。枚数 ＝ 釣り場エリア番号 × この倍率
export const TIER_MEDAL = { common: 1, rare: 3, epic: 10, legend: 40 }
export const medalOf = (spot, tier) => spot * (TIER_MEDAL[tier] || 0)

// ===== 釣り場エリア =====
// 釣り場のグレードNで「釣り場エリアN」が解放される。各エリアに6種
export const SPOT_MAX = 9
export const FISH_PER_SPOT = 6
const SPOT_DEF = [
  ['せせらぎの川',   ['ヤマメ', 'イワナ', 'カジカ', 'ハヤ', 'モロコ', 'ニジマス']],
  ['静寂の湖',       ['フナ', 'コイ', 'ワカサギ', 'ライギョ', 'ナマズ', 'テナガエビ']],
  ['大河の淀み',     ['アユ', 'ウナギ', 'ソウギョ', 'チョウザメ', 'カワカマス', 'スッポン']],
  ['潮騒の浅瀬',     ['アジ', 'キス', 'メバル', 'カサゴ', 'ハゼ', 'イサキ']],
  ['荒磯の岩礁',     ['イシダイ', 'クエ', 'ウツボ', 'イセエビ', 'タコ', 'アワビ']],
  ['凍てつく氷海',   ['タラ', 'ホッケ', 'ニシン', 'シシャモ', 'オヒョウ', 'タラバガニ']],
  ['火口の熱湖',     ['溶岩ナマズ', '熱鱗ドジョウ', '焔ビレウオ', '硫黄イワナ', 'マグマウナギ', '火喰いザリガニ']],
  ['深淵の海溝',     ['ラブカ', 'チョウチンアンコウ', 'ダイオウイカ', 'リュウグウノツカイ', 'オオグチボヤ', 'シーラカンス']],
  ['天空の泉',       ['雲喰いイワナ', '星屑メダカ', '天泳ぐマンタ', '虹鱗のドラゴンフィッシュ', '蒼天ウナギ', '神代のヌシ']],
]
export const SPOTS = SPOT_DEF.map(([name], i) => ({ spot: i + 1, name }))
export const spotName = (spot) => SPOTS[spot - 1]?.name || ''

// ===== 魚54種 =====
// ★図鑑ボーナスが乗るのは **HPとMPを除いた6種**（2026-08-17 ユーザー決定）。
//   54 ÷ 6 ＝ 9 なので**どのステータスもちょうど9種**ずつになり、
//   全部そろえると **1ステータスあたり +9.0%・合計 +54.0%** で完全に均等になる。
export const DEX_STATS = STAT_KEYS.filter(k => k !== 'hp' && k !== 'mp')

// ★通し番号を DEX_STATS で順に回して割り当てる。
//   いまは各エリア6種なので、結果として**どのエリアも同じ並び**（1番目がSTR…）になる。
//   1エリアの種類数を変えても均等さが保たれるよう、式は通し番号のままにしてある
const buildFish = () => {
  const out = []
  SPOT_DEF.forEach(([, names], si) => {
    names.forEach((name, idx) => {
      out.push({ spot: si + 1, idx, name, stat: DEX_STATS[out.length % DEX_STATS.length] })
    })
  })
  return out
}
export const FISH = buildFish()
export const fishOf = (spot, idx) => FISH.find(f => f.spot === spot && f.idx === idx) || null
export const fishOfSpot = (spot) => FISH.filter(f => f.spot === spot)

// ===== 図鑑の1枠（魚 × グレード）=====
export const entryId = (spot, idx, tier) => `f:${spot}:${idx}:${TIER_SHORT[tier]}`
const buildEntries = () => {
  const out = []
  for (const f of FISH) {
    for (const tier of TIERS) {
      out.push({
        id: entryId(f.spot, f.idx, tier),
        name: f.name, spot: f.spot, idx: f.idx, tier,
        stat: f.stat, pct: TIER_PCT[tier], medal: medalOf(f.spot, tier),
      })
    }
  }
  return out
}
export const ENTRIES = buildEntries()
export const ENTRY_BY_ID = Object.fromEntries(ENTRIES.map(e => [e.id, e]))
export const DEX_SLOTS = ENTRIES.length   // 216

// ===== 図鑑ボーナス =====
// 初めて釣った枠だけが対象。**同じ%の枠を何匹釣っても増えない**
const round1 = (v) => Math.round(v * 10) / 10
// 受け取る形は [{ fish_id, first_at }]（v2_player_fish の行）でも ['f:1:0:c'] でもよい
export const dexIdsOf = (rows) => (rows || [])
  .map(r => (typeof r === 'string' ? r : (r?.first_at ? r.fish_id : null)))
  .filter(id => id && ENTRY_BY_ID[id])
export const fishDexPct = (rows) => {
  const out = {}
  for (const id of dexIdsOf(rows)) {
    const e = ENTRY_BY_ID[id]
    out[e.stat] = round1((out[e.stat] || 0) + e.pct)
  }
  return out
}
// 「STR+1.2% / VIT+0.6%」の1行。図鑑の画面とステータス画面で使う
export const fishDexText = (rows) => {
  const pct = fishDexPct(rows)
  return STAT_KEYS.filter(k => pct[k]).map(k => `${STAT_DEFS[k].label}+${pct[k]}%`).join(' / ')
}
// 全部そろえたときの合計(%)。表示と、設計どおりかのテストに使う
export const DEX_FULL_TOTAL = round1(ENTRIES.reduce((t, e) => t + e.pct, 0))

// ===== 釣り場のレートと副産物 =====
// 匹/h。グレード1で2匹、以降0.5ずつ増えてグレード9で6匹
export const fishPerHour = (grade) => 2 + 0.5 * (Math.max(1, Math.min(SPOT_MAX, grade)) - 1)
// 副産物は**1匹釣るごとに別枠で抽選**する（魚の代わりではなく、追加でもらう）
export const MATERIAL_PCT = (grade) => 1 + Math.max(1, Math.min(SPOT_MAX, grade))        // 2〜10%
export const EQUIP_PCT = (grade) => 0.5 * Math.max(1, Math.min(SPOT_MAX, grade))         // 0.5〜4.5%
// 副産物のエリアは**釣り場グレードと同じ番号のエリアまで**（エリアの解放状況では縛らない）
export const dropAreaMax = (grade) => Math.max(1, Math.min(8, grade))

// ===== 釣りメダルの交換所 =====
// ⚠並べるのは「ルーン素材」と「保護札」の2つだけ（2026-08-17 ユーザー決定）
export const SHOP_MATERIAL_COST = { normal: 10, rare: 40, ultra: 200 }   // × エリア番号
export const materialShopCost = (area, rarity) => area * (SHOP_MATERIAL_COST[rarity] || 0)
export const PROTECT_COST = 150
