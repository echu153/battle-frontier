// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 安息の祠
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「安息の祠を追加
//   ・出撃してるとまれに出現（0.1％）
//   ・敵はハピネスフェアリーのみ　経験値は出現したエリアのベース経験値×５
//   ・3～8回戦闘が行われ、最深部に行くと泉の効果でスタミナが全回復する」
//   ＋「最深部に到達した！　スタミナが全回復した！　って表示される演出が欲しい ※暗転後に泉が見えるような演出」
//   （絵はユーザーが用意：祠の入口・最深部の泉・ハピネスフェアリー）
// ユーザーが選んだこと（2026-10-13・選択式で）：
//   ・ハピネスフェアリーは**弱い（ほぼ必ず勝てる）**＝その場所のふつうの敵の半分の強さ（SHRINE_FAIRY_RATIO）
//   ・Goldは**その場所のふつうの敵と同じ**・**装備は落とさない**
//   ・負けても**そのまま奥へ進む**（負けた回はふつうの負けと同じ＝その場所の最低EXPだけ・Goldなし）
//   ・スタミナは**ふつうと同じく使う**（オートは1戦ごとに1・手動は使わない）
// こちらで決めた細部：
//   ・見つけるのは出撃の精算のとき（サーバーが0.1%で引く・勝ち負けもボスも問わない）。見つけた戦闘の次から祠の中の戦闘になる
//   ・「ベース経験値」＝その場所の表の経験値（範囲の中でランダムに1つ）。×5はボスと同じ倍率
//   ・祠の中ではボスの出やすさは変わらない（外へ出たら続きから）。祠にいる間は次の祠は見つからない
//   ・祠にいる間は場所を選べない（見つけた場所で戦う）。祠のことはサーバーが持つ＝リロードしても続きから
//   ・最深部のスタミナは、そのとき（最後の1戦のEXPが入ったあと）のLVの最大値まで（最大より多ければそのまま）
//   ・倒したハピネスフェアリーはデイリーミッションの「出撃に勝つ」と図鑑の討伐数にも数える（ふつうの勝ちと同じ）
// ★決めるのはサーバー（supabase_v2cap_core.sql の v2cap_sortie_settle）。ここは画面とテストのための写し
//   ⚠数を変えたら SQL の c_shrine_… も直す（v2capsql.test.js が突き合わせる）
// ============================================================
import { spotOf, enemyLvOf, enemyPowerOf } from './areas.js'
import { SHRINE_FAIRY } from './monsters.js'
import { randIn } from './sortie.js'

export const SHRINE_NAME = '安息の祠'
export const SHRINE_FAIRY_NAME = SHRINE_FAIRY.name
export const SHRINE_PCT = 0.1              // 1戦ごとに見つかる確率（%）
export const SHRINE_FIGHTS = [3, 8]        // 祠の中の戦闘の数（この範囲の整数を均等に1つ）
export const SHRINE_EXP_TENTHS = 50        // 経験値の倍率（10分率）＝場所の表の値×5
export const SHRINE_GOLD_TENTHS = 10       // Goldの倍率（10分率）＝ふつうの敵と同じ
export const SHRINE_FAIRY_RATIO = 0.5      // ハピネスフェアリーの強さ＝その場所のふつうの敵の平均の何倍か

// ===== ハピネスフェアリー =====
// LV＝その場所のふつうの敵でいちばん高いLV（朝昼晩の敵と同じ決め方）
export const fairyLvOf = (spotId) => {
  const s = spotOf(spotId)
  return s ? Math.max(...s.roster.enemies.map(e => enemyLvOf(e.name, s.id))) : 1
}
// 戦闘力＝その場所のふつうの敵の戦闘力の平均×SHRINE_FAIRY_RATIO（四捨五入・最低1）
export const fairyPowerOf = (spotId) => {
  const s = spotOf(spotId)
  if (!s) return 1
  const ps = s.roster.enemies.map(enemyPowerOf)
  return Math.max(1, Math.round(ps.reduce((a, b) => a + b, 0) / ps.length * SHRINE_FAIRY_RATIO))
}
// 祠の中で出会う敵（出撃の pickEncounter と同じ形。role は 'shrine'）
export const shrineEncounterOf = (spotId) => {
  const spot = spotOf(spotId)
  if (!spot) return null
  return { spot, enemy: { ...SHRINE_FAIRY, spot: spot.id }, role: 'shrine', isBoss: false, lv: fairyLvOf(spot.id), power: fairyPowerOf(spot.id) }
}

// ===== 経験値とGold =====
// 勝ったとき … 場所の表の値（範囲の中の整数を均等に1つ）× 倍率（10分率）を四捨五入（サーバーと同じ計算）
// 負けたとき … その場所の最低値（倍率なし）・Goldなし（ふつうの負けと同じ）
const byTenths = (v, tenths) => Math.floor((v * tenths + 5) / 10)
export const rollShrineRewards = (spot, rng = Math.random, win = true) => (win
  ? { exp: byTenths(randIn(spot.exp, rng), SHRINE_EXP_TENTHS), gold: byTenths(randIn(spot.gold, rng), SHRINE_GOLD_TENTHS) }
  : { exp: spot.exp[0], gold: 0 })
export const shrineRewardRangeOf = (spot) => ({
  exp: spot.exp.map(v => byTenths(v, SHRINE_EXP_TENTHS)),
  gold: spot.gold.map(v => byTenths(v, SHRINE_GOLD_TENTHS)),
})
// 祠の中の戦闘の数を引く（サーバーと同じ：3＋0〜5）
export const rollShrineFights = (rng = Math.random) => SHRINE_FIGHTS[0] + Math.floor(rng() * (SHRINE_FIGHTS[1] - SHRINE_FIGHTS[0] + 1))

// ===== いまの祠 =====
// プロフィール（v2cap_profiles の shrine_spot・shrine_left・shrine_total）か、精算の返事の shrine から。
// 祠にいなければ null。done＝もう終えた戦闘の数・next＝次が何戦目か
export const shrineOf = (src) => {
  const spot = Number(src?.shrine_spot ?? src?.spot)
  const left = Number(src?.shrine_left ?? src?.left) || 0
  const total = Number(src?.shrine_total ?? src?.total) || 0
  if (left <= 0 || !spotOf(spot)) return null
  const t = Math.max(total, left)
  return { spot, left, total: t, done: t - left, next: t - left + 1 }
}
// 「2/5」＝何戦目か／全部の数
export const shrineStepText = (sh) => (sh ? `${sh.next}/${sh.total}` : '')
