// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— LVとEXP
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md。ステータスの種類と成長（LVアップごとに5回抽選）は
// 今のⅡと同じなので src/v2/lib/stats.js をそのまま使う。違うのは次の3つだけ：
//   ・**転職しても下がらない**。LV100で止まり、周回（LV1に戻る）は無い
//   ・必要EXPはMMORPGのように、上がるほど重くなる（下の needExp）
//   ・1勝で入るEXPは**場所ごとの表の値**（areas.js。先の場所ほど多い・朝昼晩1.5倍・レア3倍・ボス5倍）
//
// ★このファイルは表示とシミュレーション用の写し。**権威はサーバー**
//   （supabase_v2cap_core.sql の v2cap_need / v2cap_sortie_settle / v2cap_apply_exp）。
//   式を変えるときは必ず両方を直すこと（v2capsql.test.js が突き合わせる）。
// ============================================================
import { STAT_KEYS, ROLLS_PER_LV, INITIAL_STATS, calcPower, rollLevelUp, emptyGains } from '../../v2/lib/stats.js'

export { STAT_KEYS, ROLLS_PER_LV, INITIAL_STATS, calcPower }

export const MAX_LV = 100

// ===== 必要EXP =====
// 次のLVまでの必要EXP ＝ 係数 × LV³（千分率の整数 NEED_PERMIL で持つ）。
//   1勝のEXPは場所が進むほど増え、だいたいLVに比例する（始まりの森で2〜3・深淵の海溝で30強）。
//   なのでLV³にすると、そのLVで要る勝ち数がLV²に比例する＝上がるほど重い（MMORPG式）。
//   係数は「1日1時間でLV100まで約1年」になるように tools/v2cap-progress.mjs --tune で回して決める。
//   （2026-10-09 エリアの作り替えで、1体のEXPが「敵のLV＋9」から場所ごとの表の値へ変わり、
//     約1/4になったので式ごと作り直した。前は 0.335×LV²×(LV＋9)）
//   ⚠小数のまま掛けると、端数が .5 ちょうどになる所でSQLの round と食い違うことがある。
//   なので**千分率の整数で掛けてから1000で割る**（SQLの v2cap_need も同じ形）
// ★let なのは tools/v2cap-progress.mjs --tune が回しながら差し替えるため（ゲームの中では変えない）
export let NEED_PERMIL = 131
export const setNeedPermilForTuning = (v) => { NEED_PERMIL = v }
export const needExp = (lv) => (lv >= MAX_LV ? 0 : Math.max(1, Math.round(NEED_PERMIL * lv * lv * lv / 1000)))

// LV1からそのLVに着くまでの合計
export const totalExpTo = (lv) => {
  let t = 0
  for (let l = 1; l < Math.min(lv, MAX_LV); l++) t += needExp(l)
  return t
}

// ★1勝で入るEXP・Goldは sortie.js の rollRewards（場所の表 × 役割の倍率）。決めるのはサーバー

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

// ===== スタミナ（オート出撃の燃料）=====
// 【確定】**回復は3分に1**・**最大値はLVが1上がるごとに+1**（2026-10-09 ユーザー指示）。
//   LV1で10＝「10＋(LV−1)」＝LV100で109。今のⅡ（5分に1・転職回数で伸びる）とは別に、この版で持つ。
// ★数える権威はサーバー（v2cap_stamina_max / v2cap_stamina_roll）。ここはその写し（v2capsql.test.js が突き合わせる）
export const STAMINA_BASE = 10
export const staminaMaxOf = (lv) => STAMINA_BASE + Math.max(1, Math.floor(lv || 1)) - 1
export const STAMINA_RECOVER_MS = 3 * 60 * 1000

// 経過時間ぶんを足して数え直す（今のⅡの rollStamina と同じ数え方で、間隔だけこの版の3分）。at＝最後に数え直した時刻
//   ・端数は捨てない＝消化したぶんだけ at を進める ／ 満タンになったら at は「いま」へ
export const rollStamina = (stamina, at, max, now = Date.now()) => {
  const cap = Math.max(0, Math.floor(Number(max) || 0))
  const cur = Math.max(0, Math.min(cap, Math.floor(Number(stamina) || 0)))
  const base = at ? new Date(at).getTime() : now
  if (cur >= cap) return { n: cap, at: now }
  const gained = Math.max(0, Math.floor((now - base) / STAMINA_RECOVER_MS))
  const n = Math.min(cap, cur + gained)
  return { n, at: n >= cap ? now : base + gained * STAMINA_RECOVER_MS }
}
// 次の1が溜まるまでの残りms。満タンなら0
export const msToNextStamina = (stamina, at, max, now = Date.now()) => {
  const r = rollStamina(stamina, at, max, now)
  if (r.n >= Math.max(0, Math.floor(Number(max) || 0))) return 0
  return Math.max(0, STAMINA_RECOVER_MS - (now - r.at))
}
