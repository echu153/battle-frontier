// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 出撃
// ------------------------------------------------------------
// 進み方（2026-10-09 エリアの作り替え・docs/v2cap-design.md §3）：
//   ・場所（15エリア×①②③＝45か所）を1本道で進む。**その場所のボスを倒すと次の場所が開く**
//   ・10秒に1回。ボスは1戦ごとに+0.3%ずつ出やすくなり、出会うと0へ戻る（今のⅡと同じ）
//   ・レアは0.5%（今のⅡと同じ。その時間帯に出るレアから1体）
//   ・ふつうの敵には、その時間帯（朝・昼・晩）の限定の敵も混ざる
//   ・経験値とGoldは場所の表の値 × 役割の倍率（朝昼晩1.5倍・レア3倍・ボス5倍）。決めるのはサーバー
//   ・装備は勝ったとき3%で落ちる。部位は1時間ごとに「落ちやすい部位」が入れ替わる（今のⅡと同じ）
//   ・ランクは場所ごとの分布（後の場所ほど高いランクが出やすい）。アイテムLVはエリアごとに1つ
//   ・**武器はいまの職業が装備できる3種から**落ちる。防具は重鎧／軽装を半々。アクセは4つから均等
// ============================================================
import { spotOf, enemyLvOf, scaleByRole, LAST_SPOT } from './areas.js'
import { rollDropRank } from '../../v2/lib/enemies.js'
import { weaponsOfType, armorsOf, accessories, ARMOR_LINES } from './equipment.js'
import { weaponsOf } from './jobs.js'
import {
  rollBoss, nextBossRate, bandAt, rollHasEquipDrop, rollDropPart, rollRare,
  SORTIE_CD, EQUIP_DROP_RATE, BOSS_RATE_STEP, RARE_RATE,
} from '../../v2/lib/sortie.js'

export { nextBossRate, bandAt, SORTIE_CD, EQUIP_DROP_RATE, BOSS_RATE_STEP, RARE_RATE }

const pick = (list, rng) => list[Math.floor(rng() * list.length)]

// ===== 次に出会う敵 =====
// レアの抽選が先（今のⅡと同じ）→ ボス → ふつうの敵（その時間帯の限定の敵を含む）から均等に1体
// role … normal／timed／rare／boss（経験値とGoldの倍率に使う）
export const pickEncounter = (spotId, bossRate, at = new Date(), rng = Math.random) => {
  const spot = spotOf(spotId)
  if (!spot) return null
  const band = bandAt(at)
  const r = spot.roster
  const rares = r.rares.filter(e => !e.band || e.band === band)
  const make = (enemy, role) => ({ spot, enemy, role, isBoss: role === 'boss', lv: enemyLvOf(enemy.name, spot.id), band })
  if (rares.length && rollRare(rng)) return make(pick(rares, rng), 'rare')
  if (rollBoss(bossRate, rng)) return make(r.boss, 'boss')
  const timed = r.timed.filter(e => e.band === band)
  const enemy = pick([...r.enemies, ...timed], rng)
  return make(enemy, timed.includes(enemy) ? 'timed' : 'normal')
}

// ===== 経験値とGold =====
// 勝ったとき … 範囲の中の整数を均等に1つ → 役割の倍率を掛けて四捨五入
// 負けたとき … 【確定】経験値は**その場所の最低値**（朝昼晩・レア・ボスの倍率は掛けない）。Goldは入らない
//              （2026-10-09 ユーザー指示「敗北しても経験値は最低値を獲得できるように」）
// ★サーバーの v2cap_sortie_settle と同じ規則。これはシミュレーションと表示のための写しで、実際に入る値はサーバーが返す
export const randIn = ([lo, hi], rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1))
export const lossExpOf = (spot) => spot.exp[0]
export const rollRewards = (enc, rng = Math.random, win = true) => (win
  ? { exp: scaleByRole(randIn(enc.spot.exp, rng), enc.role), gold: scaleByRole(randIn(enc.spot.gold, rng), enc.role) }
  : { exp: lossExpOf(enc.spot), gold: 0 })
// 画面に出す「この役割ならいくつ〜いくつ」
export const rewardRangeOf = (spot, role = 'normal') => ({
  exp: spot.exp.map(v => scaleByRole(v, role)),
  gold: spot.gold.map(v => scaleByRole(v, role)),
})

// ===== 場所の解放（1本道）=====
// 倒したボスの場所（cleared）の一番先の次までが開いている。最初は①（id 1）だけ
export const lastClearedOf = (cleared) => Math.max(0, ...(cleared || []).filter(Number.isInteger))
export const openUntilOf = (cleared) => Math.min(LAST_SPOT, lastClearedOf(cleared) + 1)
export const isSpotUnlocked = (cleared, id) => Number.isInteger(id) && id >= 1 && id <= openUntilOf(cleared)
export const unlockedSpotsOf = (cleared) => Array.from({ length: openUntilOf(cleared) }, (_, i) => i + 1)
export const isSpotCleared = (cleared, id) => (cleared || []).includes(id)
// ボスに勝ったあとの cleared（すでに入っていればそのまま）
export const clearSpot = (cleared, id) =>
  (cleared || []).includes(id) ? [...(cleared || [])] : [...(cleared || []), id].sort((a, b) => a - b)

// ===== 落ちる装備 =====
// 落ちる基本装備を1つ選ぶ（部位は呼び出し側）
export const rollBaseItem = (part, cls, rng = Math.random) => {
  if (part === '武器') {
    const types = weaponsOf(cls)
    return types.length ? pick(weaponsOfType(pick(types, rng)), rng) : null
  }
  if (part === 'アクセ') return pick(accessories(), rng)
  return pick(armorsOf(part, pick(ARMOR_LINES, rng)), rng)
}

// 勝ったときの装備。落ちたら { item, rank, ilv }。**アイテムLV＝エリアごとに1つ**（areas.js の itemLvOfArea）
export const rollEquipDrop = (enc, cls, at = new Date(), rng = Math.random) => {
  if (!enc || !rollHasEquipDrop(rng)) return null
  const item = rollBaseItem(rollDropPart(at, rng), cls, rng)
  return item ? { item, rank: rollDropRank(enc.spot, rng), ilv: enc.spot.itemLv } : null
}
