// ============================================================
// 「レベルキャップあり」版（v2cap）— 修練場の案山子の数と開く条件だけ（ホームのメニューが読む＝戦闘の部品を読まない軽いファイル）
// ------------------------------------------------------------
// 決まりと経緯は lib/scarecrow.js。⚠数は SQL と同じ（scarecrow.test.js が突き合わせる）
// ============================================================
import { isSpotCleared } from './sortie.js'

export const SCARECROW_NAME = '案山子'
export const SCARECROW_SEC = 60          // 1回の長さ（秒）
export const SCARECROW_UNLOCK_SPOT = 3   // ここのボスを倒すと開く（①-③＝エリア①のクリア）
export const SCARECROW_EXP_SORTIES = 30  // 基準の量＝推奨の場所で何回出撃したくらいか
export const SCARECROW_PCT_MIN = 50      // EXPの割合の下限（%）
export const SCARECROW_PCT_MAX = 150     // 上限（%）

// 開いているか（cleared＝プロフィールの cleared_spots）
export const isScarecrowOpen = (cleared) => isSpotCleared(cleared, SCARECROW_UNLOCK_SPOT)
