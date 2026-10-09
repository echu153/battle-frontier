// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— LVとEXP
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md。ステータスの種類と成長（LVアップごとに5回抽選）は
// 今のⅡと同じなので src/v2/lib/stats.js をそのまま使う。違うのは次の3つだけ：
//   ・**転職しても下がらない**。LV100で止まり、周回（LV1に戻る）は無い
//   ・必要EXPはMMORPGのように、上がるほど重くなる（下の needExp）
//   ・1勝で入るEXPは**敵のLV**で決まる（先のエリアほど敵のLVが高い＝EXPが多い）
//
// ★このファイルは表示とシミュレーション用の写し。**権威はサーバー**
//   （supabase_v2cap_core.sql の v2cap_need / v2cap_exp_of / v2cap_apply_exp）。
//   式を変えるときは必ず両方を直すこと（v2capsql.test.js が突き合わせる）。
// ============================================================
import { STAT_KEYS, ROLLS_PER_LV, INITIAL_STATS, calcPower, rollLevelUp, emptyGains } from '../../v2/lib/stats.js'

export { STAT_KEYS, ROLLS_PER_LV, INITIAL_STATS, calcPower }

export const MAX_LV = 100

// ===== 必要EXP =====
// 次のLVまでの必要EXP ＝ 0.335 × LV² × (LV＋9)。
//   「1勝で入るEXP（敵のLV＋9）」で割ると、そのLVで要る勝ち数が LV² に比例する。
//   1日1時間で LV100 まで約1年になるように、tools/v2cap-progress.mjs --report で回して決めた
//   （最初の机上の計算は0.368だったが、敵ごとにLVが決まっているぶん序盤のEXPが少なく、
//     1年でLV96前後にしか届かなかった＝2026-10-09 実測で0.335へ）。
//   ⚠小数（0.335）のまま掛けると、端数が .5 ちょうどになる所でSQLの round と食い違うことがある。
//   なので**千分率の整数（335）で掛けてから1000で割る**（SQLの v2cap_need も同じ形）
export const NEED_PERMIL = 335
export const needExp = (lv) => (lv >= MAX_LV ? 0 : Math.max(1, Math.round(NEED_PERMIL * lv * lv * (lv + 9) / 1000)))

// LV1からそのLVに着くまでの合計
export const totalExpTo = (lv) => {
  let t = 0
  for (let l = 1; l < Math.min(lv, MAX_LV); l++) t += needExp(l)
  return t
}

// ===== 1勝で入るEXP =====
// 基準は「敵のLV＋9」。雑魚と時間帯の敵は ±15% ばらつき、ボスは1.4倍（ばらつかない）。
// ★今のⅡ（雑魚8〜11・ボス13）と、LV1の敵ならほぼ同じ数字になる。
// ★EXPを決めるのは**サーバー**（v2cap_sortie_settle）。画面はサーバーが返した値を出すだけで、
//   ここはシミュレーションと「この敵ならいくつ」の表示に使う写し。
//   倍率は10分率の整数で持つ（小数のまま掛けるとSQLと端数が食い違うことがあるため）
export const EXP_OFFSET = 9
export const EXP_SPREAD_PCT = 15    // 雑魚と時間帯は ±15%
export const EXP_BOSS_TENTHS = 14   // ボスは1.4倍
export const baseExpOf = (enemyLv) => Math.max(1, Math.floor(enemyLv)) + EXP_OFFSET
export const expMinOf = (enemyLv) => Math.round(baseExpOf(enemyLv) * (100 - EXP_SPREAD_PCT) / 100)
export const expMaxOf = (enemyLv, isBoss = false) =>
  isBoss ? Math.round(baseExpOf(enemyLv) * EXP_BOSS_TENTHS / 10) : Math.round(baseExpOf(enemyLv) * (100 + EXP_SPREAD_PCT) / 100)
export const rollExp = (enemyLv, isBoss = false, rng = Math.random) =>
  isBoss
    ? Math.round(baseExpOf(enemyLv) * EXP_BOSS_TENTHS / 10)
    : Math.round(baseExpOf(enemyLv) * (100 - EXP_SPREAD_PCT + rng() * EXP_SPREAD_PCT * 2) / 100)

// ===== 本体の戦闘力の目安 =====
// LVアップ1回で戦闘力+5（5回抽選・どれに当たっても+1）。LV1の初期ステは戦闘力39
export const BODY_POWER_LV1 = calcPower(INITIAL_STATS)
export const bodyPowerAt = (lv) => BODY_POWER_LV1 + ROLLS_PER_LV * (Math.max(1, lv) - 1)

// ===== EXPを入れてLVアップまで処理する（純関数・表示とシミュレーション用）=====
// 実際の保存は必ずRPC経由。state は書き換えず新しいオブジェクトを返す。
export const applyExp = (state, amount, rng = Math.random) => {
  let lv = state.lv || 1
  let exp = state.exp || 0
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = state[k] ?? state.stats?.[k] ?? 0
  const levelUps = []
  const total = emptyGains()
  if (lv < MAX_LV && amount > 0) {
    exp += amount
    while (lv < MAX_LV && exp >= needExp(lv)) {
      exp -= needExp(lv)
      lv += 1
      const gains = rollLevelUp(rng)
      for (const k of STAT_KEYS) { stats[k] += gains[k]; total[k] += gains[k] }
      levelUps.push({ lv, gains })
    }
    if (lv >= MAX_LV) exp = 0   // 上限に着いたら、あふれたぶんは捨てる
  }
  return { lv, exp, stats, levelUps, gains: total, power: calcPower(stats) }
}

// ===== スタミナの最大値 =====
// ★今のⅡは転職回数で伸びていた。この版は**LVで伸ばす**（2026-10-09 ユーザー決定）。
//   10＋LV÷5（切り捨て）＝LV100で30。画面には「いま／最大」だけ出す
export const STAMINA_BASE = 10
export const STAMINA_PER_LV = 5
export const staminaMaxOf = (lv) => STAMINA_BASE + Math.floor(Math.max(1, lv || 1) / STAMINA_PER_LV)
