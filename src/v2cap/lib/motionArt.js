// ============================================================
// 「レベルキャップあり」版（v2cap）— クラスのモーションのドット絵（ATB戦闘の攻撃など）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「攻撃モーションもドット絵で作ろうと思ってる」→ ChatGPT で作る（ユーザー）。
//   元の絵（ユーザーが置く）：public/V2newjob/モーション/<クラス名><男|女><動き>.png（.webp も可）
//     ＝横一列に6コマ（①待機 → ②構え → ③振りかぶり → ④攻撃 → ⑤振り抜き → ⑥待機）・背景は真緑（#00FF00）
//   画面で使う版（tools/v2cap-motion.mjs が作る）：public/V2newjob/motion/<ローマ字>-<m|f>-<動きのキー>.webp
//     ＝②〜⑤のコマを横に並べた1枚（透明つき）。どのコマも待機GIFと同じ大きさ・同じ足の位置にそろえてある
//     （①⑥は待機GIFと少し違う絵なので使わない＝切り替わるとき絵が変わって見えるため。大きさをそろえる目安にだけ使う）
//   一覧（コマの数・大きさ・速さ）は motionArtList.js（道具が書く・手で直さない）
// ★待機GIF（classArt.js の gifSrcOf）と組で使う。上位クラスで待機GIFが系統の初期クラスのものなら、モーションもそのクラスのもの
// ============================================================
import { MOTION_ART } from './motionArtList.js'
import { ART_BASE, ART_DIR, gifSrcOf } from './classArt.js'

export const MOTION_SRC_DIR = 'モーション'   // public/V2newjob の下・元の絵（git に入れない）
export const MOTION_OUT = 'motion'           // public/V2newjob の下・画面で使う版
// ファイル名の動き → キー。いまは「攻撃」だけ使う（技・被弾・倒れるは置ければ作れるが、画面ではまだ流さない）
export const MOTION_KEYS = { 攻撃: 'attack', 技: 'skill', 被弾: 'hurt', 倒れる: 'down' }
export const SHEET_FRAMES = 6                // ChatGPT の1枚に並ぶコマの数
export const IDLE_SIZE = 224                 // 待機GIFの大きさ（正方形）

// 1コマの長さ（ミリ秒）と、ダメージが入るコマ（0から数える）。②〜⑤の4コマ＝構え・振りかぶり・攻撃（長め）・振り抜き
export const motionMsOf = (n) => (n === 4 ? [100, 100, 180, 120] : Array.from({ length: n }, () => 100))
export const motionHitOf = (n) => (n === 4 ? 2 : Math.floor(n * 0.6))

export const motionFileOf = (cls, g, key) => `${ART_BASE[cls]}-${g}-${key}.webp`

// 画面で使う形（無ければ null）。baseCls＝系統の初期クラス（そのクラスの待機GIFが無いとき、待機と同じくそちらを使う）
export const motionOf = (cls, gender = 'm', key = 'attack', baseCls = null) => {
  const owner = gifSrcOf(cls, gender) ? cls : (baseCls && gifSrcOf(baseCls, gender) ? baseCls : null)
  const m = owner ? MOTION_ART[owner]?.[gender]?.[key] : null
  if (!m) return null
  const totalMs = m.ms.reduce((s, v) => s + v, 0)
  const hitMs = m.ms.slice(0, m.hit).reduce((s, v) => s + v, 0)
  return { ...m, src: `${ART_DIR}/${MOTION_OUT}/${motionFileOf(owner, gender, key)}`, totalMs, hitMs }
}

// 流しはじめてから elapsedMs のときのコマ（0から）。流し終わったら -1
export const motionFrameAt = (m, elapsedMs) => {
  if (!m || elapsedMs < 0) return -1
  let t = 0
  for (let i = 0; i < m.ms.length; i++) {
    t += m.ms[i]
    if (elapsedMs < t) return i
  }
  return -1
}
