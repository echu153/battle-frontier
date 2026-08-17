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
// ★エリアの解放（旧版と同じ）
//   そのエリアのボスを倒すと次のエリアが解放される。①は最初から解放。
//   旧版は⑦のボス撃破で⑧が開くところまで（⑧の先が無い）。v2も同じ。
// ============================================================
import { AREAS, areaOf, rollDropRank, timedEnemyOf } from './enemies.js'
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

// ===== エリアの解放 =====
export const FIRST_AREA = 1
export const LAST_AREA = 8
export const isAreaUnlocked = (unlocked, id) => id === FIRST_AREA || (unlocked || []).includes(id)
// ボスを倒したときに解放されるエリアを足して返す（旧版と同じ：撃破したエリアの次が開く）
export const unlockNext = (unlocked, areaId, win, wasBoss) => {
  const list = [...(unlocked || [FIRST_AREA])]
  if (!list.includes(FIRST_AREA)) list.unshift(FIRST_AREA)
  if (win && wasBoss && areaId < LAST_AREA && !list.includes(areaId + 1)) list.push(areaId + 1)
  return list.sort((a, b) => a - b)
}

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
// 通常敵の抽選には**その時間帯の限定敵も加わる**（朝なら朝の敵が4体目として並ぶ）
export const enemyPoolAt = (area, at = new Date()) => {
  const timed = timedEnemyOf(area, bandAt(at))
  return timed ? [...area.enemies, timed] : [...area.enemies]
}
export const pickEncounter = (areaId, bossRate, at = new Date(), rng = Math.random) => {
  const area = areaOf(areaId)
  if (!area) return null
  const wasBoss = rollBoss(bossRate, rng)
  const pool = enemyPoolAt(area, at)
  const enemy = wasBoss ? area.boss : pool[Math.floor(rng() * pool.length)]
  return { area, enemy, isBoss: wasBoss, band: bandAt(at) }
}

// 勝ったあとの取り分。装備のドロップは別（rollDrop を呼ぶ。落ちる確率はまだ決めていない）
export const rewardsOf = ({ area, isBoss, win }, rng = Math.random) => ({
  exp: win ? expOf(isBoss, rng) : 0,
  unlockArea: win && isBoss && area.id < LAST_AREA ? area.id + 1 : null,
})

export const AREA_LIST = AREAS.map(a => ({ id: a.id, name: a.name }))

// ===== 出撃のクールタイム =====
// 10秒と20秒から選べる。⚠**もらえるEXPとGoldはどちらも同じ**（2026-08-14 ユーザー決定）。
//   旧版は10秒モードだけEXPとGoldを半分にしていたが、v2は揃える。
//   ＝10秒を選ぶほうが時間あたりの効率は2倍になる。「速く回したい人が回せる」だけの選択肢
export const COOLDOWNS = [10, 20]
// 装備が落ちる確率(%)。**20秒のほうが1回あたりは高い**（10秒の効率2倍をいくらか相殺する）
//   時間あたりで見ると 10秒=0.30%/秒・20秒=0.20%/秒 で、まだ10秒が1.5倍有利
export const DROP_RATE = { 10: 3, 20: 4 }
export const dropRateOf = (sec) => DROP_RATE[cooldownOf(sec)]
export const rollHasDrop = (sec, rng = Math.random) => rng() * 100 < dropRateOf(sec)
export const DEFAULT_COOLDOWN = 20
export const isValidCooldown = (sec) => COOLDOWNS.includes(sec)
export const cooldownOf = (sec) => (isValidCooldown(sec) ? sec : DEFAULT_COOLDOWN)

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
export const rollMaterial = (enemyName, mult = 1, rng = Math.random) => {
  const r = rng() * 100
  let acc = 0
  for (const rarity of ['ultra', 'rare', 'normal']) {
    acc += MATERIAL_RATE[rarity] * mult
    if (r < acc) return materialOf(enemyName, rarity)
  }
  return null
}
