// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘のテロップの時間（戦闘開始・討伐完了）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   ・戦闘開始 … 舞台が出たらすぐ。出ているあいだは戦闘の時計を止める（ボスは待機のまま動く・技の予約はできる）
//   ・討伐完了 … 止めの一撃の数字が出てから、ボスの体がほとんど消えたころ（倒れる動きの無い敵はすぐ）。出おわったら報酬画面（挑戦だけ）
//   ・見た目は components/V2capAtbTelop.jsx（CSS の動きだけ＝スマホでも軽い）
// 【確定】2026-11-01 ユーザー「プレイヤーが敗北したときのテロップも欲しい、画面遷移も」：
//   ・敗北 … 止めの一撃の数字が出て自分が薄くなってから。時間切れも同じ形。出おわったら結果の画面（挑戦だけ）
// ============================================================
import { lastHitAtOf } from './atbFx.js'

export const START_TELOP_MS = 1500   // 戦闘開始：出ている長さ＝時計を止める長さ
export const CLEAR_TELOP_MS = 2300   // 討伐完了：出ている長さ
export const FAIL_TELOP_MS = 1900    // 敗北・時間切れ：出ている長さ
export const NO_DEATH_DELAY_MS = 700 // 倒れる動きの無い敵（ドット絵版・図鑑の絵）：薄くなるのを待つ長さ
export const LOSE_DELAY_MS = 500     // 敗北：止めの一撃の数字が出てから（自分が薄くなるのを待つ）
export const TIMEUP_DELAY_MS = 200   // 時間切れ：決着からすぐ
const BURN_SHOWN = 0.7               // 体が消える動きのうち、ここまで進んだら出す

// 【確定】2026-11-01 ユーザー「遭遇⇒戦闘開始の間に敵のモーション追加してほしい、これから戦闘するぞーって感じ」→選んだ「飛ばせない」：
//   遭遇の絵を押す → ボスの開戦の動き（lib/bossIllust.js の intro）→ 戦闘開始のテロップ → 時計が動く。動きのあいだも時計を止める（st を変えない＝サーバーの回し直しとずれない）
// 戦闘開始の前か（時計を止めるか）。t0＝動きを始めた時刻（ミリ秒・まだなら null＝絵を読んでいるあいだ）・introMs＝テロップを出すまでの長さ（intro.telopAt・動きが無ければ 0）
export const startTelopOn = (t0, nowMs, introMs = 0) => t0 === null || nowMs - t0 < introMs + START_TELOP_MS
// 戦闘開始のテロップを出しているか（開戦の動きのあいだは出さない）
export const startTelopShown = (t0, nowMs, introMs = 0) => t0 !== null && nowMs - t0 >= introMs && nowMs - t0 < introMs + START_TELOP_MS
// 討伐完了を出すまでの長さ（止めの一撃の数字が出てから・ミリ秒）。art＝ボスの絵（lib/bossIllust.js の death があれば倒れる動きを待つ）
export const clearTelopDelayOf = (art) => (art?.death ? Math.round(art.death.burnAt + art.death.burnMs * BURN_SHOWN) : NO_DEATH_DELAY_MS)
// 決着のテロップ（st＝決着した戦闘・fx＝起きた時刻つきの動き・nowMs＝いま・art＝ボスの絵）。返すのは { kind, at（出す時刻・ミリ秒）, ms（出ている長さ）}
//   ボスが倒れていれば討伐完了（相打ちも）／自分が倒れたら敗北／どちらも立っていれば時間切れ
export const endTelopOf = (st, fx, nowMs, art = null) => {
  const sec = nowMs / 1000
  if (st.b.hp <= 0) return { kind: 'clear', ms: CLEAR_TELOP_MS, at: lastHitAtOf(fx, 'b', sec) * 1000 + clearTelopDelayOf(art) }
  if (st.winner === 'b') return { kind: 'lose', ms: FAIL_TELOP_MS, at: lastHitAtOf(fx, 'a', sec) * 1000 + LOSE_DELAY_MS }
  return { kind: 'timeup', ms: FAIL_TELOP_MS, at: nowMs + TIMEUP_DELAY_MS }
}
