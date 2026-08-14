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
import { AREAS, areaOf } from './enemies.js'

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
// 敵ごとの設定値（enemies.js の gold）。旧版の値をそのまま使っている
export const goldOf = (enemy) => enemy?.gold || 0

// ===== 1回の出撃 =====
// 戦闘そのものは runBattle が担当する。ここは「誰と当たるか・何がもらえるか」だけ
export const pickEncounter = (areaId, bossRate, rng = Math.random) => {
  const area = areaOf(areaId)
  if (!area) return null
  const wasBoss = rollBoss(bossRate, rng)
  const enemy = wasBoss ? area.boss : area.enemies[Math.floor(rng() * area.enemies.length)]
  return { area, enemy, isBoss: wasBoss }
}

// 勝ったあとの取り分をまとめる
export const rewardsOf = ({ area, enemy, isBoss, win }, rng = Math.random) => ({
  exp: win ? expOf(isBoss, rng) : 0,
  gold: win ? goldOf(enemy) : 0,
  dropRank: win ? null : null,   // ドロップの抽選は rollDropRank（enemies.js）を呼び出し側で使う
  unlockArea: win && isBoss && area.id < LAST_AREA ? area.id + 1 : null,
})

export const AREA_LIST = AREAS.map(a => ({ id: a.id, name: a.name }))
