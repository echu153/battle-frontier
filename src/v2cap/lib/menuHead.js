import { MENU_HEAD } from './menuHeadList.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ホームのメニューの見出しの帯
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「大項目（きゃらくたーとか）のところ寂しいから何か背景を追加したい、チャットGPTで作ってもらう」
//   絵はユーザーが作る（元の絵 public/V2ホーム画面 → node tools/v2cap-menu-art.mjs で帯に切り抜く）。
//   帯の幅は PC とスマホで倍ほど違う。横幅に合わせて敷くと端末で絵の切れ方が変わるので、高さに合わせて右へ寄せる。
//   絵の左は透明へ溶かしてあり（FADE）、見出しの文字はその左に置く。PC の左半分は帯の色だけになる
//   color＝帯の色・文字の横の印。絵の色に合わせる
// ============================================================
export const MENU_HEAD_DIR = '/v2cap-art/home'
export const MENU_HEAD_SRC_DIR = 'V2ホーム画面'
export const MENU_HEAD_DEFS = {
  chara:     { source:'きゃら.png', color:'#88aaff' },
  adventure: { source:'冒険.png',   color:'#ff7755' },
  facility:  { source:'施設.png',   color:'#ffbb55' },
}
export const menuHeadFileOf = (key) => `menu-${key}.webp`
export const menuHeadSrcOf = (key) => `${MENU_HEAD_DIR}/${menuHeadFileOf(key)}?v=${MENU_HEAD[key]?.v || ''}`
