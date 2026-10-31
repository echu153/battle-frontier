// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘のテロップの時間（戦闘開始・討伐完了）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   ・戦闘開始 … 舞台が出たらすぐ。出ているあいだは戦闘の時計を止める（ボスは待機のまま動く・技の予約はできる）
//   ・討伐完了 … 止めの一撃の数字が出てから、ボスの体がほとんど消えたころ（倒れる動きの無い敵はすぐ）。出おわったら報酬画面（挑戦だけ）
//   ・見た目は components/V2capAtbTelop.jsx（CSS の動きだけ＝スマホでも軽い）
// ============================================================

export const START_TELOP_MS = 1500   // 戦闘開始：出ている長さ＝時計を止める長さ
export const CLEAR_TELOP_MS = 2300   // 討伐完了：出ている長さ
export const NO_DEATH_DELAY_MS = 700 // 倒れる動きの無い敵（ドット絵版・図鑑の絵）：薄くなるのを待つ長さ
const BURN_SHOWN = 0.7               // 体が消える動きのうち、ここまで進んだら出す

// 戦闘開始のテロップのあいだか（時計を止めるか）。t0＝出し始めた時刻（ミリ秒・まだなら null＝絵を読んでいるあいだ）
export const startTelopOn = (t0, nowMs) => t0 === null || nowMs - t0 < START_TELOP_MS
// 討伐完了を出すまでの長さ（止めの一撃の数字が出てから・ミリ秒）。art＝ボスの絵（lib/bossIllust.js の death があれば倒れる動きを待つ）
export const clearTelopDelayOf = (art) => (art?.death ? Math.round(art.death.burnAt + art.death.burnMs * BURN_SHOWN) : NO_DEATH_DELAY_MS)
