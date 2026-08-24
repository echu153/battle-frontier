// ============================================================
// バトルフロンティアⅡ（リメイク版）— 出撃の進行まわり
// ------------------------------------------------------------
// エリアの解放条件・ボスの出し方・EXP・Gold は**旧版と同じ仕組み**（2026-08-14 ユーザー決定）。
// 数値で変えたのは**ボスの出やすさ**だけ（+0.5%/回 → +0.3%/回）。
//
// ★ボスの出し方（旧版と同じピティ方式）
//   通常敵と戦うたびに遭遇率が BOSS_RATE_STEP ずつ積み上がり、**ボスに当たると0へ戻る**。
//   ・旧版 +0.5%/回 → 平均18.4回でボス
//   ・v2   +0.3%/回 → 平均23.6回でボス（「もう少し出にくく」）
//   確率がじわじわ上がるので「何十回引いても出ない」事故が起きない＝ピティとして機能する。
//
// ★エリアの解放（v2は「難易度帯」で進む・2026-08-22 ユーザー決定）
//   ①②③は1エリアずつだが、**④⑤⑥は2エリア・⑦⑧は3エリア**あり、
//   **その帯を全部踏破すると次の帯がまとめて開く**。①は最初から解放。
//   （旧版は「倒したエリアの次が開く」の1本道だった）
// ============================================================
import { AREAS, areaOf, rollDropRank, timedEnemiesOf, tierOf, TIER_MAX, rarePoolAt } from './enemies.js'
import { PARTS, itemsOf, typesOf, CATALOG } from './equipment.js'
import { materialOf } from './material.js'

// ===== ボスの出やすさ =====
export const BOSS_RATE_STEP = 0.3   // 通常敵と戦うたびに遭遇率へ足す(%)
export const BOSS_RATE_MAX = 100

// 次の戦闘でボスに当たるか。当たったら呼び出し側で rate を0へ戻すこと
export const rollBoss = (bossRate, rng = Math.random) => rng() * 100 < Math.min(BOSS_RATE_MAX, bossRate || 0)
// 戦闘後の遭遇率。ボスに当たった戦闘なら0、そうでなければ積み上げ
export const nextBossRate = (bossRate, wasBoss) =>
  wasBoss ? 0 : Math.min(BOSS_RATE_MAX, (bossRate || 0) + BOSS_RATE_STEP)

// ===== エリアの解放（難易度帯ごと）=====
// ★2026-08-22 ユーザー決定：**同じ難易度帯を全部踏破すると、次の帯が開く**。
//   ①②③は1エリアずつ／④⑤⑥は2エリア／⑦⑧は3エリア（enemies.js の tier）。
//   ＝④に来たら2エリアのボスを両方倒さないと⑤へ行けない。
export const FIRST_AREA = 1
export const LAST_TIER = TIER_MAX
// その帯を**いくつ踏破したら次の帯が開くか**。用意してあるエリア数と同じ（＝全部倒す）
export const TIER_REQ = { 1:1, 2:1, 3:1, 4:2, 5:2, 6:2, 7:3, 8:3 }
export const reqOfTier = (tier) => TIER_REQ[tier] || 0
export const isAreaUnlocked = (unlocked, id) => tierOf(id) === 1 || (unlocked || []).includes(id)
// その帯をいくつ踏破したか／次の帯まであといくつか
export const clearedInTier = (cleared, tier) => (cleared || []).filter(id => tierOf(id) === tier).length
export const restToOpenNext = (cleared, tier) => Math.max(0, reqOfTier(tier) - clearedInTier(cleared, tier))
// 開いている帯。★**一度開いた帯は閉じない**（2026-08-22 ユーザー決定）＝
//   新ルールの前から開いていたエリアはそのまま遊べる（その帯のエリアは全部開く）
export const openTiersOf = (cleared, unlocked) => {
  const set = new Set([1])
  for (const id of (unlocked || [])) { const t = tierOf(id); if (t) set.add(t) }
  for (let t = 1; t < TIER_MAX; t++) if (restToOpenNext(cleared, t) === 0) set.add(t + 1)
  return set
}
// 踏破と今の解放から、解放しておくエリアを作り直す（サーバーの v2_sortie_settle と同じ規則）
export const unlockNext = (unlocked, cleared) => {
  const open = openTiersOf(cleared, unlocked)
  return AREAS.filter(a => open.has(a.tier)).map(a => a.id).sort((a, b) => a - b)
}

// ===== エリアの踏破（ボスを倒したか） =====
// ボスを倒したエリアは cleared_areas に積む。**帯が開いたかどうかはここから数える**
export const clearNext = (cleared, areaId, win, wasBoss) => {
  const list = [...(cleared || [])]
  if (win && wasBoss && !list.includes(areaId)) list.push(areaId)
  return list.sort((a, b) => a - b)
}
// 表示用。cleared_areas がまだ無い（列を足す前の）プロフィールでも、
// 「次のエリアが開いている＝そのエリアのボスは倒している」と読み替えて出す
export const clearedAreasOf = (prof) => {
  const set = new Set(prof?.cleared_areas || [])
  // 列を足す前のプロフィール救済。1本道だった頃は「次のエリアが開いている＝そのエリアのボスを倒した」
  for (const id of (prof?.unlocked_areas || [FIRST_AREA])) if (id > FIRST_AREA && id <= TIER_MAX) set.add(id - 1)
  return [...set].sort((a, b) => a - b)
}
export const isAreaCleared = (cleared, id) => (cleared || []).includes(id)

// ===== EXP =====
// 旧版と同じ。通常敵は8〜11のランダム、ボスは13
// ⚠旧版にあった「キャラクターLV100まで1.5倍」はv2に char_lv が無いので入れていない
export const EXP_ZAKO_MIN = 8
export const EXP_ZAKO_MAX = 11
export const EXP_BOSS = 13
export const expOf = (wasBoss, rng = Math.random) =>
  wasBoss ? EXP_BOSS : EXP_ZAKO_MIN + Math.floor(rng() * (EXP_ZAKO_MAX - EXP_ZAKO_MIN + 1))

// ===== Gold =====
// ★**敵はGoldを落とさない**（2026-08-17 ユーザー決定・docs/v2-gold-design.md）。
//   Goldはルーン素材をNPCへ売って稼ぐ（material.js の sellPriceOf）。
//   ⚠ goldOf は消した。サーバー側（v2_sortie_settle）もGoldを足さない

// ===== 1回の出撃 =====
// 戦闘そのものは runBattle が担当する。ここは「誰と当たるか・何がもらえるか」だけ
// 通常敵の抽選には**その時間帯の限定敵も加わる**（朝なら朝の敵2体が7・8体目として並ぶ）
export const enemyPoolAt = (area, at = new Date()) =>
  [...area.enemies, ...timedEnemiesOf(area, bandAt(at))]
// ===== レアモンスター =====
// ★出現率は**合計0.5%で固定**（2026-08-25 ユーザー決定）。1体ごとではなく、
//   「レアモンスターに会う確率」が0.5%。出たら、その時間帯に出うる3体から1体を引く。
//   ボスのようなピティ（積み上げ）は無く、常に同じ確率。
export const RARE_RATE = 0.5
export const rollRare = (rng = Math.random) => rng() * 100 < RARE_RATE

export const pickEncounter = (areaId, bossRate, at = new Date(), rng = Math.random) => {
  const area = areaOf(areaId)
  if (!area) return null
  const band = bandAt(at)
  // ★レアモンスターの抽選が先。ボスより優先する（0.5%しか出ないため）
  const rares = rarePoolAt(area, band)
  if (rares.length && rollRare(rng)) {
    return { area, enemy: rares[Math.floor(rng() * rares.length)], isBoss: false, isRare: true, band }
  }
  const wasBoss = rollBoss(bossRate, rng)
  const pool = enemyPoolAt(area, at)
  const enemy = wasBoss ? area.boss : pool[Math.floor(rng() * pool.length)]
  return { area, enemy, isBoss: wasBoss, isRare: false, band }
}

// 勝ったあとの取り分。装備のドロップは別（rollDrop を呼ぶ）。
// ★解放は「帯を全部踏破したか」で決まるので、ここでは返さない（unlockNext を使うこと）
export const rewardsOf = ({ isBoss, win }, rng = Math.random) => ({
  exp: win ? expOf(isBoss, rng) : 0,
})

export const AREA_LIST = AREAS.map(a => ({ id: a.id, tier: a.tier, name: a.name }))

// ===== 出撃のクールタイム =====
// ★**10秒固定**（2026-08-22 ユーザー決定）。10秒／20秒から選ぶ仕組みは廃止した。
//   もともと「20秒は1回あたりのドロップ率が高い代わりに遅い」という選択肢だったが、
//   スタミナ（オート出撃）を入れるにあたって**間隔は全員そろえる**ことにした。
//   ＝オートも手動も10秒。アリーナもこのクールタイムを共有する。
export const SORTIE_CD = 10
// 装備が落ちる確率(%)。旧・10秒モードの値をそのまま使う
export const DROP_RATE = 3
// mult は**アリーナの階層守護者ぶんの倍率**（arena.js の guardDropMultOf）。
//   素材側（rollMaterial）と同じ形にそろえてある
export const dropRateOf = (mult = 1) => DROP_RATE * mult
export const rollHasDrop = (rng = Math.random, mult = 1) => rng() * 100 < dropRateOf(mult)

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// ===== 時間帯（朝・昼・晩）=====
// **その時間帯だけ出る敵**が各エリアに1体ずついる（enemies.js の timed）。
//   朝 5:00〜12:59 ／ 昼 13:00〜20:59 ／ 晩 21:00〜4:59（JST・各8時間）
export const BANDS = ['朝', '昼', '晩']
export const bandAt = (at = new Date()) => {
  const h = Math.floor(((at.getTime() + JST_OFFSET_MS) / 3600000) % 24)
  if (h >= 5 && h < 13) return '朝'
  if (h >= 13 && h < 21) return '昼'
  return '晩'
}

// ===== 装備ドロップの部位 =====
// **部位は完全ランダム**。ただし**1時間ごとに「落ちやすい部位」が入れ替わる**。
//   その時間の部位だけ重みが FEATURED_WEIGHT 倍（＝2倍出やすい）。
//   時刻から決まるので全員に共通で、先の予定も計算できる（画面に出せる）。
export const FEATURED_WEIGHT = 2
// 1970年からのJSTでの通算時間。これを部位の数で割った余りが「いまの部位」
export const jstHourIndex = (at = new Date()) => Math.floor((at.getTime() + JST_OFFSET_MS) / 3600000)
export const featuredPartAt = (at = new Date()) => PARTS[jstHourIndex(at) % PARTS.length]
// 次に切り替わる時刻（ちょうど毎時0分）
export const nextSwitchAt = (at = new Date()) => new Date((jstHourIndex(at) + 1) * 3600000 - JST_OFFSET_MS)
// これから n 時間ぶんの予定
export const featuredSchedule = (at = new Date(), n = 6) =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(at.getTime() + i * 3600000)
    return { at: new Date(jstHourIndex(t) * 3600000 - JST_OFFSET_MS), part: featuredPartAt(t) }
  })

export const partWeightsAt = (at = new Date()) => {
  const hot = featuredPartAt(at)
  return Object.fromEntries(PARTS.map(p => [p, p === hot ? FEATURED_WEIGHT : 1]))
}
export const rollDropPart = (at = new Date(), rng = Math.random) => {
  const w = partWeightsAt(at)
  let r = rng() * Object.values(w).reduce((a, b) => a + b, 0)
  for (const p of PARTS) { r -= w[p]; if (r <= 0) return p }
  return PARTS[PARTS.length - 1]
}

// 装備を1つ抽選する。部位＝時間帯つきランダム／種類＝完全ランダム／ランク＝エリアの分布
export const rollDrop = (areaId, at = new Date(), rng = Math.random) => {
  const area = areaOf(areaId)
  if (!area) return null
  const part = rollDropPart(at, rng)
  const types = typesOf(part)
  const type = types[Math.floor(rng() * types.length)]
  const rank = rollDropRank(area, rng)
  return CATALOG.find(i => i.part === part && i.type === type && i.rank === rank) || null
}
export const dropPoolOf = (part) => itemsOf(part)

// ===== エンチャントの素材ドロップ =====
// 1戦闘につき**1回だけ**抽選する。激レア → レア → 通常 の順に判定し、
// どれにも当たらなければ何も落ちない（**重複しない＝1戦闘で最大1個**）。
// 雑魚・時間帯限定敵・ボスとも同じ率。mult は「素材ドロップ率up」の特殊能力ぶん
//   ⚠サーバー側は「1戦闘あたり1個まで」しか検証できない（mult はクライアント側の確率）
export const MATERIAL_RATE = { ultra:1, rare:5, normal:20 }
// ★レアモンスターは**確定で落とす**。内訳は 通常55% / レア35% / 激レア10%（ユーザー決定）
//   ドロップ率upの特殊能力は「落ちるかどうか」に効くもので、確定のここには掛けない
export const RARE_MATERIAL_RATE = { normal:55, rare:35, ultra:10 }

export const rollMaterial = (enemyName, mult = 1, rng = Math.random, { sure = false } = {}) => {
  const table = sure ? RARE_MATERIAL_RATE : MATERIAL_RATE
  const r = rng() * 100
  let acc = 0
  for (const rarity of ['ultra', 'rare', 'normal']) {
    acc += table[rarity] * (sure ? 1 : mult)
    if (r < acc) return materialOf(enemyName, rarity)
  }
  // 確定のときは取りこぼさない（丸めで漏れても通常を返す）
  return sure ? materialOf(enemyName, 'normal') : null
}
