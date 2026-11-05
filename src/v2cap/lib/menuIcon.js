import { MENU_ICON } from './menuIconList.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— メニューと画面の題に出す絵のアイコン（絵文字の代わり）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「挑戦のアイコンも作りたい」→選択「魔物の頭骨と交差した剣」「ボスの絵と同じ厚塗り」
//   絵はユーザーが ChatGPT で描く（元の絵 public/V2アイコン/<source>・git に入れない）
//   → node tools/v2cap-icon-art.mjs → public/v2cap-art/icon/<key>.webp と menuIconList.js（中身の印）
//   絵がまだ無いアイコンは絵文字（fallback）のまま。並べ方と大きさはニャーガーキングのマークと同じ（メニュー16px・画面の題18px・pages/V2capHome.jsx の MenuIcon）
// ============================================================
export const MENU_ICON_DIR = '/v2cap-art/icon'
export const MENU_ICON_SRC_DIR = 'V2アイコン'
export const MENU_ICON_SIZE = 96   // 書き出す絵の大きさ（画面では16〜18px＝3倍の画面でも足りる）
export const MENU_ICON_DEFS = {
  challenge: { source: '挑戦.png', fallback: '🐉' },
}
export const menuIconFileOf = (key) => `${key}.webp`
// 画面で使うアドレス（絵がまだ無ければ null）。後ろの ?v= は絵の中身の印＝描き直したらアドレスが変わる（古いキャッシュを出さない）
export const menuIconSrcOf = (key) => (MENU_ICON[key] ? `${MENU_ICON_DIR}/${menuIconFileOf(key)}?v=${MENU_ICON[key].v}` : null)
