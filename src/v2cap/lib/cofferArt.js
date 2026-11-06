// ============================================================
// 「レベルキャップあり」版（v2cap）— 日替わりクエスト（土日）の宝箱の魔物の絵（立ち絵・入口の顔のアップ・背景）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「ミミックみたいな宝箱系＋Gold系のモンスターにしたい、ポケモンのこれクレーみたいな（あくまで参考）」
//   → 選んだ「宝箱に住む金貨の魔物」（宝箱の口から小さな魔物が顔と手を出し、体は金貨。参考の形はまねない＝雰囲気だけ）
//   元の絵（ユーザーが ChatGPT で描いて置く・git に入れない）：public/エネミー/IDダンジョン/デイリー/タカラモチ.png（正方形・透明か真緑）・ゴールドダンジョン背景.png（横3：縦2・1536×1024）
//   11-07 絵がそろった：1枚目（金貨のうろこの体）にユーザー「デザインが微妙」→選んだ「いたずら好きの小鬼」＝宝箱の暗がりの影の体・光る目と笑い口・細い影の腕で金貨を見せびらかす／背景は宝物庫
//   → node tools/v2cap-scarecrow-art.mjs（案山子と同じ道具）→ public/v2cap-art/training/coffer.webp・coffer-face.webp・coffer-bg.webp と一覧 cofferArtList.js
//   絵が届くまでは仮の絵（COFFER_TEMP_SRC・簡単な宝箱）で動く。背景は四凶と同じ部品（V2capAtbStage の BossBackground）に敷く
//   ★こっちから見て左向き（相手のプレイヤーは左にいる）。殴られたときの揺れは案山子と同じく立ち絵を傾けて作る（wobble）
// ============================================================
import { COFFER_ART } from './cofferArtList.js'
import { COFFER_NAME } from './dayQuestRules.js'
import { SCARECROW_ART_DIR, SCARECROW_SRC_DIR, SCARECROW_STAND_SIZE, SCARECROW_FACE_SIZE } from './scarecrowArt.js'

export const COFFER_SRC_DIR = SCARECROW_SRC_DIR   // public/エネミー の下（案山子と同じ場所）
export const COFFER_SRC_STAND = 'タカラモチ.png'              // 11-07 ユーザーが置いた名前
export const COFFER_SRC_BG = 'ゴールドダンジョン背景.png'
export const COFFER_ART_DIR = SCARECROW_ART_DIR
export const COFFER_STAND_SIZE = SCARECROW_STAND_SIZE
export const COFFER_FACE_SIZE = SCARECROW_FACE_SIZE
// 顔のアップの切り取り（[真ん中の x, 真ん中の y, 一辺]・元の立ち絵の幅に対する割合）。null なら体の上のはしから決める（道具）
//   11-07 届いた絵（宝箱の暗がりの影の小鬼・光る目と笑い口）に合わせた：両目と笑い口・ふたのふちとふたを押し上げる指まで
export const COFFER_FACE_BOX = [0.458, 0.375, 0.35]
export const COFFER_TEMP_SRC = `${COFFER_ART_DIR}/coffer-temp.svg`

// 背景（四凶と同じ形・lib/bossBg.js）。動くものは絵の px（元の絵 1536×1024）
//   11-07 届いた絵（石の柱と円天井の宝物庫・左に金貨の山と王冠・壁の松明3つと燭台）に合わせた：
//   松明と燭台の火が揺れる（glows）・金貨の山からきらめきが昇る（motes）
const BG_DEF = {
  under: '#0c0904', dark: 0.06, crop: 0.2,
  fx: {
    motes: { n: 14, x: [80, 940], y: [420, 720], rise: 70, life: [5000, 9000], r: [1.5, 3.5], color: '255,214,120' },
    glows: [
      { x: 555, y: 335, r: 90, op: 0.22, amp: 0.14, periodMs: 1000, color: '255,170,80' },    // 松明（絵の場所）
      { x: 928, y: 360, r: 90, op: 0.22, amp: 0.14, periodMs: 1150, color: '255,170,80' },
      { x: 1290, y: 445, r: 54, op: 0.18, amp: 0.12, periodMs: 900, color: '255,170,80' },
      { x: 172, y: 295, r: 110, op: 0.18, amp: 0.1, periodMs: 1300, color: '255,190,100' },  // 燭台
      { x: 300, y: 590, r: 300, op: 0.1, amp: 0.05, periodMs: 5200, color: '255,200,90' },   // 金貨の山の照り返し
    ],
  },
}

const srcOf = (name, v) => `${COFFER_ART_DIR}/${name}.webp?v=${v}`
export const cofferStandOf = () => (COFFER_ART.stand ? srcOf('coffer', COFFER_ART.stand) : COFFER_TEMP_SRC)
export const cofferFaceOf = () => (COFFER_ART.face ? srcOf('coffer-face', COFFER_ART.face) : COFFER_TEMP_SRC)
export const cofferBgOf = () => (COFFER_ART.bg ? { ...BG_DEF, w: COFFER_ART.bg.w, h: COFFER_ART.bg.h, src: srcOf('coffer-bg', COFFER_ART.bg.v) } : null)

// 戦闘の舞台に渡す形（lib/scarecrowArt.js の scarecrowArtOf と同じ形）。60秒なぐりきったら「クエスト終了」
let memo = null
export const cofferArtOf = () => {
  if (memo) return memo
  const src = cofferStandOf(), bg = cofferBgOf()
  memo = { kind: 'pixel', key: 'coffer', name: COFFER_NAME, base: COFFER_STAND_SIZE, idle: { src }, motions: {}, bg, wobble: true, timeupKind: 'quest',
    srcs: [src, ...(bg ? [bg.src] : [])] }
  return memo
}
