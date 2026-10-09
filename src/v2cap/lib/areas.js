// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— エリアと敵のLV
// ------------------------------------------------------------
// エリア・敵の名前・技・配分は今のⅡと同じ＝ src/v2/lib/enemies.js。この版で足したのは：
//   ・難易度帯ごとの**LV帯**（docs/v2cap-design.md §3）
//   ・**敵ごとに決まったLV**（2026-10-09 ユーザー決定）。今のⅡでの強さの順に帯の中へ並べ、
//     時間帯の敵は帯の上のほう、ボスは**帯の上限**に置く
//   ・敵の強さ＝**そのLVのプレイヤーの標準の戦闘力 × 役割の倍率**（雑魚・時間帯／ボス）
//     標準の戦闘力（stdPowerAt）は tools/v2cap-progress.mjs で実際に回して決める
//
// ★レアモンスターは土台では出さない（素材が無いため）。
// ★敵のLVはサーバー（v2cap_enemies）にも持たせる＝EXPとアイテムLVはサーバーが敵のLVから決める。
//   ⚠ここを変えたら tools/v2cap-sql.mjs でSQLの種を作り直すこと（v2capsql.test.js が突き合わせる）
// ============================================================
import { AREAS, AREAS_SORTED, areaOf, tierOf, TIER_MAX, markOf, toFighter as v2ToFighter } from '../../v2/lib/enemies.js'
import { bodyPowerAt } from './level.js'

export { AREAS_SORTED, areaOf, tierOf, TIER_MAX, markOf }

// ===== 難易度帯ごとのLV帯 =====
// 1日1時間で「その帯を抜ける日」に着いているLV（§2の表）から作った
export const TIER_LV = {
  1: [1, 20], 2: [20, 27], 3: [27, 34], 4: [34, 44],
  5: [44, 63], 6: [63, 79], 7: [79, 90], 8: [90, 100],
}
export const tierLvOf = (tier) => TIER_LV[tier] || [1, 1]
export const tierLvText = (tier) => { const [a, b] = tierLvOf(tier); return `LV${a}〜${b}` }

// ===== 敵のLV =====
// 雑魚6体は今のⅡの戦闘力が低い順に、帯の中の位置 NORMAL_POS へ並べる（0＝下限・1＝上限）。
// 時間帯の敵（朝昼晩に2体ずつ）は TIMED_POS、ボスは帯の上限
export const NORMAL_POS = [0, 0.1, 0.2, 0.35, 0.5, 0.65]
export const TIMED_POS = 0.8
const lvAt = (tier, pos) => { const [a, b] = tierLvOf(tier); return Math.round(a + (b - a) * pos) }

const LEVELS = new Map()   // 敵の名前 → { lv, role }
for (const a of AREAS) {
  const sorted = [...a.enemies].sort((x, y) => x.power - y.power || x.name.localeCompare(y.name))
  sorted.forEach((e, i) => LEVELS.set(e.name, { lv: lvAt(a.tier, NORMAL_POS[Math.min(i, NORMAL_POS.length - 1)]), role:'normal', area: a.id }))
  for (const e of a.timed || []) LEVELS.set(e.name, { lv: lvAt(a.tier, TIMED_POS), role:'timed', area: a.id })
  LEVELS.set(a.boss.name, { lv: tierLvOf(a.tier)[1], role:'boss', area: a.id })
}
export const enemyLvOf = (name) => LEVELS.get(name)?.lv || 1
export const enemyRoleOf = (name) => LEVELS.get(name)?.role || 'normal'
// サーバーの種（v2cap_enemies）を作るための一覧
export const ENEMY_LEVELS = [...LEVELS.entries()].map(([name, v]) => ({ name, ...v }))

// ===== 敵の強さ =====
// そのLVのプレイヤーの「標準の戦闘力」。本体＋その時点で持っている装備＋ジョブのステ。
// 本体の戦闘力に対する倍率を、LVの折れ線で持つ（間は直線で補う）。
// ★値は `node tools/v2cap-progress.mjs --tune` の出力をそのまま貼る（勘で書き換えないこと）。
//   そのLVに着いたときの実際の戦闘力の平均（戦士・魔法使い×seed違いで回した平均）
export const STD_RATIO = [
  [1, 1.01], [5, 1.06], [10, 1.21], [15, 1.41], [20, 1.67], [27, 1.97], [34, 2.15],
  [44, 2.22], [54, 2.35], [63, 2.39], [71, 2.46], [79, 2.47], [90, 2.51], [100, 2.54],
]
export const stdRatioAt = (lv) => {
  const l = Math.max(1, Math.min(100, lv || 1))
  for (let i = 1; i < STD_RATIO.length; i++) {
    const [l1, r1] = STD_RATIO[i]
    if (l <= l1) {
      const [l0, r0] = STD_RATIO[i - 1]
      return r0 + (r1 - r0) * (l - l0) / (l1 - l0)
    }
  }
  return STD_RATIO[STD_RATIO.length - 1][1]
}
export const stdPowerAt = (lv) => Math.round(bodyPowerAt(lv) * stdRatioAt(lv))
// 役割の倍率。雑魚と時間帯は「同じLVのプレイヤーの0.6倍」＝同じLVならまず勝てる。
// ボスは「帯の上限LVのプレイヤーの何倍か」を帯ごとに持つ（1回で勝てなくてよい）。
// ★今のⅡの1.5倍／1.7倍をそのまま使うと、帯の中で上限LVより先へ育てられないぶん
//   ⑤で止まって抜けられなかった（2026-10-09 実測）。帯を抜ける日が目安
//   （3日／1週／2週／1か月／3か月／半年／9か月／1年）になるよう
//   `node tools/v2cap-progress.mjs --tune --boss` で逆算した値（勘で書き換えないこと）
export const NORMAL_RATIO = 0.6
export const BOSS_RATIO = { 1: 0.85, 2: 0.85, 3: 1.01, 4: 1.2, 5: 1.16, 6: 1.07, 7: 1.12, 8: 1.07 }
export const roleRatioOf = (role, tier) => (role === 'boss' ? (BOSS_RATIO[tier] || 1.5) : NORMAL_RATIO)
export const enemyPowerOf = (enemy) => {
  const info = LEVELS.get(enemy.name)
  const tier = tierOf(info?.area) || 1
  return Math.max(1, Math.round(stdPowerAt(info?.lv || 1) * roleRatioOf(info?.role, tier)))
}

// 戦闘用。名前・技・配分は今のⅡのまま、戦闘力だけこの版のものに差し替える
export const toFighter = (enemy, uses = 8) => v2ToFighter({ ...enemy, power: enemyPowerOf(enemy) }, uses)
