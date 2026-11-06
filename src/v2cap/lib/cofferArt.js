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

// ===== 待機の動き（11-07 ユーザー「タカラモチの待機モーション欲しい」→選んだ「ふたの開け閉め」「金貨の腕とコイントス」「目と口の光・まばたき」）=====
//   立ち絵を部品に切り分けて重ね、画面で動かす（動きは lib/cofferMotion.js・描くのは components/V2capCofferParts.jsx）。
//   切るのは道具 tools/v2cap-coffer-parts.mjs（tools/v2cap-scarecrow-art.mjs から呼ぶ）。位置はどれも元の絵（1254px）の px。
//   部品はどれも立ち絵と同じ正方形（同じ切り取り sq）＝重ねると立ち絵と同じ。止まっているときは立ち絵そのもの
//   lid  … ふた（＋ふたを押し上げる右手 rarm）。ちょうつがいの高さ（pivotY）へ縦に縮めて閉じる＝閉じる向きだけ（開いた所は背景）
//   larm … 金貨をつまむ左腕。付け根（pivot）で回す。coin＝金貨（色で切る）・glint＝金貨のきらめき
//   eyes … まばたきで目にかぶせるまぶた（まわりの暗がりで目を埋めた絵）・face＝目と笑い口の光を脈打たせる範囲
//   feather＝切れ目をぼかす幅（その内側だけが部品・ぼかしの所は下の絵にも元の絵を残す）・fill＝部品が動いて見える下の絵の埋め方（clear＝透明／fill＝まわりの色）
export const COFFER_CUTS = {
  lid: { feather: 14, fill: 'clear', pivotY: 606,
    poly: [[215, 180], [235, 110], [290, 25], [380, 5], [500, 0], [640, 25], [800, 60], [900, 90], [1000, 140], [1100, 160], [1180, 185], [1240, 260],
      [1252, 380], [1250, 470], [1225, 560], [1200, 615], [1160, 622], [1146, 612], [1118, 563], [1050, 517], [1000, 467], [960, 430], [920, 392],
      [880, 352], [840, 322], [800, 305], [720, 290], [650, 292], [600, 300], [580, 310], [540, 325], [480, 335], [430, 345], [408, 380], [392, 404],
      [330, 374], [288, 320], [260, 272], [232, 224], [205, 192]] },
  rarm: { feather: 16, fill: 'fill',
    poly: [[630, 285], [650, 262], [700, 258], [760, 262], [805, 275], [840, 300], [868, 340], [885, 385], [905, 430], [922, 480], [935, 530], [930, 552],
      [880, 556], [842, 552], [830, 510], [815, 460], [795, 418], [770, 400], [720, 392], [680, 375], [645, 345], [628, 318]] },
  larm: { feather: 12, fill: 'fill', pivot: [415, 585],
    poly: [[0, 310], [70, 305], [130, 300], [200, 300], [245, 330], [258, 360], [262, 400], [262, 440], [270, 480], [300, 515], [345, 530], [385, 535],
      [418, 545], [432, 575], [427, 614], [380, 616], [320, 616], [262, 606], [210, 585], [165, 562], [110, 560], [60, 545], [25, 520], [0, 480]] },
  coin: { at: [189, 337], rx: 60, ry: 66 },
  glint: { at: [222, 280], r: 56 },
  eyes: [{ at: [481, 426], rx: 33, ry: 45, rot: 10 }, { at: [626, 466], rx: 54, ry: 34, rot: -8 }],
  face: { box: [425, 372, 745, 560] },
}
//   drop … 殴られたときにこぼれる金貨（立ち絵の金貨だけを切った小さい絵・ほかと違って正方形の切り取りではない）
export const COFFER_PART_NAMES = ['base', 'lid', 'larm', 'coin', 'glint', 'glow', 'lids', 'drop']
export const COFFER_DROP_BOX = 140   // こぼれる金貨の絵の切り取り（金貨のまん中の正方形の一辺・元の絵の px）

const srcOf = (name, v) => `${COFFER_ART_DIR}/${name}.webp?v=${v}`
export const cofferStandOf = () => (COFFER_ART.stand ? srcOf('coffer', COFFER_ART.stand) : COFFER_TEMP_SRC)
export const cofferFaceOf = () => (COFFER_ART.face ? srcOf('coffer-face', COFFER_ART.face) : COFFER_TEMP_SRC)
export const cofferBgOf = () => (COFFER_ART.bg ? { ...BG_DEF, w: COFFER_ART.bg.w, h: COFFER_ART.bg.h, src: srcOf('coffer-bg', COFFER_ART.bg.v) } : null)
// 部品（道具が書いた一覧に全部そろっているときだけ）。sq＝立ち絵の切り取り（元の絵の px）＝部品の位置を枠の割合にする
export const cofferPartsOf = () => {
  const p = COFFER_ART.parts
  if (!p || !COFFER_ART.sq || COFFER_PART_NAMES.some(n => !p[n])) return null
  return { sq: COFFER_ART.sq, cuts: COFFER_CUTS, src: Object.fromEntries(COFFER_PART_NAMES.map(n => [n, srcOf(`coffer-${n}`, p[n])])) }
}

// 戦闘の舞台に渡す形（lib/scarecrowArt.js の scarecrowArtOf と同じ形）。60秒なぐりきったら「クエスト終了」。parts があれば部品を重ねて待機で動かす
let memo = null
export const cofferArtOf = () => {
  if (memo) return memo
  const src = cofferStandOf(), bg = cofferBgOf(), parts = cofferPartsOf()
  memo = { kind: 'pixel', key: 'coffer', name: COFFER_NAME, base: COFFER_STAND_SIZE, idle: { src }, motions: {}, bg, wobble: true, timeupKind: 'quest', parts,
    srcs: [...(parts ? Object.values(parts.src) : [src]), ...(bg ? [bg.src] : [])] }
  return memo
}
