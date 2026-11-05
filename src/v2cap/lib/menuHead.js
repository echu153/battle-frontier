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
// 【確定】2026-11-06 ユーザー「四凶のところ、ちょっとアイコン？バナーみたいなの差し込みたい」「イラストはチャットＧＰＴに作ってもらう」→選んだ「見出しの帯」「厚塗り」：
//   挑戦の入口のカテゴリ（lib/dungeon.js の CHALLENGE_CATS の head）にも、ホームと同じ帯を敷く。元の絵のフォルダは dir（public の下）。
//   絵：ユーザーは「4体の色の文様が1番、一応不吉な背景もつくってみたい」→ 置いたのは不吉な風景の1枚（public/エネミー/IDダンジョン/四凶バナー.png・
//   赤黒い雲・裂けた大地と遺跡・地平線から立つ赤・青・黄・紫の光の柱＝ボスのカードの色）。絵が無いあいだは文字だけ（menuHeadReady）
export const CAT_HEAD_DEFS = {
  rival: { source:'四凶バナー.png', dir:'エネミー/IDダンジョン', color:'#ff8866' },
}
export const headDefOf = (key) => MENU_HEAD_DEFS[key] || CAT_HEAD_DEFS[key] || null
export const menuHeadReady = (key) => !!headDefOf(key) && !!MENU_HEAD[key]
export const menuHeadFileOf = (key) => `menu-${key}.webp`
export const menuHeadSrcOf = (key) => `${MENU_HEAD_DIR}/${menuHeadFileOf(key)}?v=${MENU_HEAD[key]?.v || ''}`
