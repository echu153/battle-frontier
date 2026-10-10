// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— モンスター図鑑
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「モンスター図鑑…を加えて」＋決めたこと：
//   ・**まずは見るだけ**（討伐数・どこに出るか・落とす装備）。倒すとステが上がる要素は**あとから足す**（ユーザー指示）
//   ・エリアごと（行ったことのあるエリアだけ）。1エリア20体＝通常6・時間帯6・レア5・ボス3（全部で300体）。倒すまでは「???」
//   ・討伐数は**サーバーが数える**（出撃の精算で勝ったとき・v2cap_kills）。
//     ⚠今のⅡは敵の表を入れ直すたびに討伐数が消える作り（外部キーの連鎖削除）なので、この版は敵の表につながない（名前で持つ）
// ★並びは monsters.js の AREA_ROSTERS（通常→時間帯→レア→ボス。ボスは①②③の順）。出る場所とLVは areas.js の enemyLevels
// ============================================================
import { AREA_ROSTERS, ENEMY_LV } from './monsters.js'
import { enemyLevels } from './areas.js'
import { RARITIES } from './equipment.js'
import { DROP_CHANCE, canDropRarity } from './sortie.js'

export const DEX_ROLES = [
  { key:'normal', label:'通常',   color:'#88ccff' },
  { key:'timed',  label:'時間帯', color:'#aaddff' },
  { key:'rare',   label:'レア',   color:'#ffcc00' },
  { key:'boss',   label:'ボス',   color:'#ff6655' },
]
export const DEX_ROLE = Object.fromEntries(DEX_ROLES.map(r => [r.key, r]))

// 敵ごとに「出る場所（①②③の番号）」をまとめる
const SPOTS_OF = (() => {
  const out = {}
  for (const p of enemyLevels()) (out[p.name] ||= new Set()).add(p.spot)
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]))
})()

// そのエリアの20体（図鑑の並び）。{ name, role, band, kind, lv, spots:[場所の番号], subs:[1,2,3] }
export const dexAreaOf = (areaNo) => {
  const r = AREA_ROSTERS[areaNo - 1]
  if (!r) return []
  const row = (e, role) => {
    const spots = SPOTS_OF[e.name] || []
    return { name: e.name, role, band: e.band || null, kind: e.kind, lv: ENEMY_LV[e.name] || 1, spots, subs: spots.map(s => ((s - 1) % 3) + 1) }
  }
  return [
    ...r.normals.map(e => row(e, 'normal')),
    ...r.timed.map(e => row(e, 'timed')),
    ...r.rares.map(e => row(e, 'rare')),
    ...r.bosses.map(e => row(e, 'boss')),
  ]
}
export const DEX_AREA_COUNT = AREA_ROSTERS.length
export const DEX_ALL = Array.from({ length: DEX_AREA_COUNT }, (_, i) => dexAreaOf(i + 1)).flat()
export const DEX_TOTAL = DEX_ALL.length

// 落とす装備（その敵の役割で決まる：勝ったときの確率と、出るレア度）。装備はそのエリアのもの
export const dropInfoOf = (role) => ({
  chance: DROP_CHANCE[role] ?? DROP_CHANCE.normal,
  rarities: RARITIES.filter(r => canDropRarity(role, r)),
})

// 討伐数の表 { 敵の名前: 数 } から、見つけた数を数える
export const killsOf = (kills, name) => Math.max(0, Math.floor(Number(kills?.[name]) || 0))
export const isFound = (kills, name) => killsOf(kills, name) > 0
export const dexProgressOf = (rows, kills) => {
  const done = rows.filter(e => isFound(kills, e.name)).length
  return { done, total: rows.length, pct: rows.length ? Math.floor(done * 100 / rows.length) : 0 }
}
