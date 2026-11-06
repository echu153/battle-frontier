// ============================================================
// 「レベルキャップあり」版（v2cap）— 修練場の案山子の絵（立ち絵・入口の顔のアップ・背景）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「案山子のイラストも用意したい」→ 選んだ「訓練場の藁人形」「立ち絵と背景の2枚」（どれも推奨）：
//   元の絵（ユーザーが ChatGPT で描いて置く・git に入れない）：public/エネミー/修練場/案山子/立ち絵.png（正方形・透明か真緑）・背景.png（横3：縦2・1536×1024）
//   → node tools/v2cap-scarecrow-art.mjs → public/v2cap-art/training/scarecrow.webp・scarecrow-face.webp・scarecrow-bg.webp と一覧 scarecrowArtList.js
//   絵が届くまでは仮の絵（SCARECROW_TEMP_SRC・簡単な影絵）で動く。背景は四凶と同じ部品（V2capAtbStage の BossBackground）に敷く
//   ★こっちから見て左向き（相手のプレイヤーは左にいる）。殴られたときの揺れは立ち絵を傾けて作る（wobble・lib/atbFx.js の wobbleOf）
// ============================================================
import { SCARECROW_ART } from './scarecrowArtList.js'
import { SCARECROW_NAME } from './scarecrowRules.js'

export const SCARECROW_SRC_DIR = '修練場/案山子'          // public/エネミー の下
export const SCARECROW_ART_DIR = '/v2cap-art/training'
export const SCARECROW_STAND_SIZE = 512                  // 立ち絵（正方形・足元を下のはしにそろえる）
export const SCARECROW_FACE_SIZE = 120                   // 入口の顔のアップ
// 顔のアップの切り取り（立ち絵の中の正方形＝[真ん中の x, 真ん中の y, 一辺]・どれも立ち絵の幅に対する割合）。null なら体の上のはしから決める（道具）
//   ★絵が届いたら見て決める
export const SCARECROW_FACE_BOX = null
export const SCARECROW_TEMP_SRC = `${SCARECROW_ART_DIR}/scarecrow-temp.svg`

// 背景（四凶と同じ形・lib/bossBg.js の BOSS_BG_DEFS）。crop＝下を切る割合・dark＝暗さ・under＝HPの行の色。
//   動くもの（木漏れ日のちり）は絵の px。★絵が届いたら、光の筋の場所に合わせて置き直す
const BG_DEF = {
  under: '#060c08', dark: 0.04, crop: 0.2,
  fx: {
    motes: { n: 14, x: [380, 900], y: [380, 760], rise: 90, life: [6000, 10000], r: [2, 4.5], color: '255,236,180' },
    glows: [
      { x: 620, y: 520, r: 280, op: 0.12, amp: 0.05, periodMs: 6400, color: '255,226,150' },
    ],
  },
}

const srcOf = (name, v) => `${SCARECROW_ART_DIR}/${name}.webp?v=${v}`
export const scarecrowStandOf = () => (SCARECROW_ART.stand ? srcOf('scarecrow', SCARECROW_ART.stand) : SCARECROW_TEMP_SRC)
export const scarecrowFaceOf = () => (SCARECROW_ART.face ? srcOf('scarecrow-face', SCARECROW_ART.face) : SCARECROW_TEMP_SRC)
export const scarecrowBgOf = () => (SCARECROW_ART.bg ? { ...BG_DEF, w: SCARECROW_ART.bg.w, h: SCARECROW_ART.bg.h, src: srcOf('scarecrow-bg', SCARECROW_ART.bg.v) } : null)
export const scarecrowArtReady = () => !!SCARECROW_ART.stand

// 戦闘の舞台に渡す形（V2capAtbFight の bossArt・lib/bossArt.js の bossArtOf と同じ形の小さい版）。動きの絵は無い＝立ち絵を揺らすだけ
let memo = null
export const scarecrowArtOf = () => {
  if (memo) return memo
  const src = scarecrowStandOf(), bg = scarecrowBgOf()
  memo = { kind: 'pixel', key: 'scarecrow', name: SCARECROW_NAME, base: SCARECROW_STAND_SIZE, idle: { src }, motions: {}, bg, wobble: true, timeupKind: 'train',
    srcs: [src, ...(bg ? [bg.src] : [])] }
  return memo
}
