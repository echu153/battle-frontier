// マネキンのシートの「データの表」。描く部分（mannequin.mjs）とは分けてある。
// 新しい技を足すときは、この中の WEAPONS（武器の形）と MOTIONS（6コマのポーズ）に書き足すだけ。
//
// ── 角度の決まり（全部「度」）──────────────────────────────
//  体は右（＋x）を向く。手前＝キャラの右半身（N=near・明るい色）／奥＝左半身（F=far・濃い色）。
//  角度は「横から見た面」での向き： 0=真下  90=前（右）  180=真上  -90=後ろ（左）
//
//  腕の書き方は3つ（armN / armF）
//   (1) 角度   { sh: 上腕の向き, el: ひじの曲げ（0=まっすぐ・＋で前腕が前／上へ・0未満は0に直す）,
//                out: わきの開き（体の外へ）, fout: 前腕だけの開き（省くと out・マイナスで体の内へ）,
//                w: 1 と書くと「胸のひねり（twist）に関係なく」画面の向きで決まる }
//   (2) 行き先 { to: [前, 上, 手前] }  肩の線のまん中から測った手の位置（px）。胸の前＝[35,-20,0]・頭のまん中＝[0,78,0]・腰＝[0,-86,0]
//   (3) つかむ { hold: u }  武器の u の所をつかむ（弓のつるは hold: [u, v]）。on: 'sheath' で鞘をつかむ
//       (2)(3) はひじの向きを pole: [前,上,手前] で変えられる（省くと下・少し後ろ・外）
//  脚  legN / legF { hip: ももの向き, knee: ひざの曲げ（＋ですねが後ろへ・0未満は0に直す）, out: 股の開き,
//                    foot: 足先の下げ（＋でかかとが浮く）, air: 1 で浮かせたまま（省くと浮いた足は自動で地面へ下ろす） }
//  lean: 上半身の前かがみ（−でのけぞる）  twist: 胸のひねり（＋で胸がこちらを向く＝手前の肩が後ろへ／−で手前の肩が前へ）
//  hipTwist: 腰のひねり  headTurn: 首のひねり  headNod: うつむき（＋で下・省くと lean の3割）
//
//  weapon { ang: 前腕の向きから何度ずらすか  ／  abs: 画面での向き（0=下 90=前 180=上）  どちらかで書く
//           grip: 握る所を u のどこにするか（槍・杖を持ちかえる）  out: 武器の開き
//           hide: 1 で描かない   fly: [前, 上] 手から離して描く（投げた瞬間）   back: 1 で体の後ろに描く
//           at: 'sheath' で鞘におさめる   pull: 弓のつるを引く量   arrow: 1 で矢を描く }
//
//  足もと：plant（'F' か 'N'）の足首を6コマとも列の同じ所に固定し、低いほうの足が基準線に付くように体の高さを決める。
//  横の位置は6コマぜんぶが列のまん中に収まるように自動で決まる（plantX: -80 のように書けば手で決められる）。

// ── 武器の形 ───────────────────────────────────────────
// 握る手を原点にして、u＝武器の向き（先のほうが＋）・v＝それに直角。poly（多角形）か circle [u, v, 半径]。
const G1 = '#5f5f5f', G2 = '#7d7d7d', G3 = '#c4c4c4', G4 = '#a4a4a4';
const rect = (u0, u1, h) => [[u0, -h], [u1, -h], [u1, h], [u0, h]];
// 弓の弧（握りが u=0・先が u=±len・＋v が引くがわ）
const bowArc = (len, bend, th) => {
  const a = [], b = [];
  for (let i = -8; i <= 8; i++) { const u = (len * i) / 8, v = bend * (i / 8) ** 2, t = th * (1 - 0.55 * Math.abs(i / 8)); a.push([u, v - t]); b.unshift([u, v + t]); }
  return [...a, ...b];
};

export const WEAPONS = {
  sword: {
    label: '片手剣',
    parts: [
      { name: '柄', color: G1, poly: rect(-17, 13, 4.5) },
      { name: 'つば', color: G2, poly: rect(13, 20, 18) },
      { name: '刃', color: G3, poly: [[20, -8.5], [88, -8.5], [103, 0], [88, 8.5], [20, 8.5]] },
    ],
  },
  katana: {
    label: '刀', guardU: 17,   // guardU＝鞘におさめたとき鞘の口に来る所
    parts: [
      { name: '柄', color: G1, hilt: 1, poly: rect(-16, 14, 4.5) },   // hilt: 1 ＝鞘におさめても見える所
      { name: 'つば', color: G2, hilt: 1, poly: rect(14, 19, 10) },
      { name: '刃', color: G3, poly: [[19, -5], [112, -5], [128, 3], [112, 5], [19, 5]] },
    ],
  },
  saya: { label: '鞘', parts: [{ name: '鞘', color: G1, poly: [[0, -7.5], [112, -7.5], [118, 0], [112, 7.5], [0, 7.5]] }] },
  heavy: {
    label: '両手の重い武器',
    parts: [
      { name: '柄', color: G1, poly: rect(-30, 112, 5) },
      { name: '頭', color: G3, poly: [[98, -30], [142, -30], [150, -18], [150, 18], [142, 30], [98, 30]] },
    ],
  },
  spear: {
    label: '槍',
    parts: [
      { name: '柄', color: G1, poly: rect(-112, 100, 4) },
      { name: '穂先', color: G3, poly: [[96, -10], [110, -10], [136, 0], [110, 10], [96, 10]] },
    ],
  },
  dagger: {
    label: '短剣',
    parts: [
      { name: '柄', color: G1, poly: rect(-13, 10, 4.5) },
      { name: 'つば', color: G2, poly: rect(10, 15, 9) },
      { name: '刃', color: G3, poly: [[15, -6], [44, -6], [56, 0], [44, 6], [15, 6]] },
    ],
  },
  bow: {
    label: '弓', flat3d: true,
    string: { tips: [[-88, 24], [88, 24]], rest: 24, arrow: 108 },
    parts: [
      { name: '弧', color: G2, poly: bowArc(88, 24, 6) },
      { name: '握り', color: G1, poly: rect(-13, 13, 7) },
    ],
  },
  gun: {
    label: '長い銃',   // ＋v が上
    parts: [
      { name: '銃身', color: G3, poly: [[40, -3], [138, -3], [138, 4], [40, 4]] },
      { name: '銃床', color: G1, poly: [[-50, -11], [-6, -7], [-6, 6], [-50, 7]] },
      { name: '機関部', color: G2, poly: [[-8, -8], [44, -8], [44, 7], [-8, 7]] },
    ],
  },
  ball: { label: '投げるもの', parts: [{ name: '丸', color: G3, circle: [15, 0, 10] }] },
  staff: {
    label: '杖',
    parts: [
      { name: '柄', color: G1, poly: rect(-100, 176, 4.5) },
      { name: '飾り', color: G3, circle: [190, 0, 16] },
    ],
  },
  potion: {
    label: '小瓶',
    parts: [
      { name: '口', color: G4, poly: rect(30, 43, 6) },
      { name: '瓶', color: G3, poly: [[4, -13], [24, -13], [32, -6], [32, 6], [24, 13], [4, 13], [-1, 8], [-1, -8]] },
    ],
  },
};

// ── よく使う形 ─────────────────────────────────────────
const ARM_N = { sh: -6, el: 16, out: 14 }, ARM_F = { sh: 4, el: 22, out: 12 };
// 脚：L_ は「手前の足が前」（剣など）／ O_ は「奥の足が前」（胸がこちらを向く構え＝弓・槍・銃）
const L_STAND = { legN: { hip: 5, knee: 6, out: 5 }, legF: { hip: -5, knee: 6, out: 5 } };
const L_READY = { legN: { hip: 30, knee: 34, out: 5 }, legF: { hip: -18, knee: 30, out: 6 } };
const L_LIGHT = { legN: { hip: 18, knee: 18, out: 5 }, legF: { hip: -12, knee: 18, out: 6 } };
const L_BACK = { legN: { hip: 30, knee: 12, out: 5 }, legF: { hip: 6, knee: 44, out: 8 } };
const L_LOW = { legN: { hip: 40, knee: 52, out: 5 }, legF: { hip: -22, knee: 38, out: 7 } };
const L_LUNGE = { legN: { hip: 56, knee: 62, out: 4 }, legF: { hip: -36, knee: 6, out: 6, foot: 14 } };
const L_DEEP = { legN: { hip: 52, knee: 66, out: 4 }, legF: { hip: -34, knee: 14, out: 6, foot: 18 } };
const L_STEP = { legN: { hip: 42, knee: 44, out: 4 }, legF: { hip: -26, knee: 10, out: 6, foot: 8 } };
const O_STAND = { legF: { hip: 12, knee: 8, out: 6 }, legN: { hip: -10, knee: 8, out: 6 } };
const O_READY = { legF: { hip: 28, knee: 30, out: 6 }, legN: { hip: -18, knee: 28, out: 6 } };
const O_BACK = { legF: { hip: 32, knee: 12, out: 6 }, legN: { hip: 4, knee: 44, out: 8 } };
const O_LUNGE = { legF: { hip: 56, knee: 62, out: 5 }, legN: { hip: -36, knee: 6, out: 6, foot: 14 } };
const WIDE = (k) => ({ legN: { hip: 14, knee: k, out: 16 }, legF: { hip: -14, knee: k, out: 16 } });

const STAND = { lean: 2, twist: 0, armN: ARM_N, armF: ARM_F, ...L_STAND };

// ── 技の動き（6コマ）─────────────────────────────────────
// frames に数字を書くと「そのコマ（0始まり）と同じ」。⑥は①と同じにする。
export const MOTIONS = {
  // ───────── 片手剣 ─────────
  slash1h: {
    label: '片手剣で前へ斬りつける',
    weapon: 'sword', hand: 'N',     // 武器を持つ手（N=手前 / F=奥）
    plant: 'F',                      // 軸足（F=奥の足 / N=手前の足）。6コマとも同じ所に固定される
    frames: [
      { ...STAND, weapon: { abs: 22 } },
      // ② 構え：腰を落とし、剣先を右上へ向けて前に構える
      { lean: 10, twist: 14, headNod: 4, armN: { to: [62, -30, 24] }, armF: { sh: 10, el: 50, out: 18 }, ...L_READY, weapon: { abs: 122 } },
      // ③ 振りかぶり：後ろ足に乗って胸を開き、剣を頭の上へ
      { lean: -5, twist: 42, headNod: 0, armN: { sh: 182, el: 34, out: 10 }, armF: { sh: 72, el: 12, out: 12 }, ...L_BACK, weapon: { ang: -10, out: 0 } },
      // ④ 攻撃の瞬間：大きく踏みこみ、腕を前へ伸ばしきる
      { lean: 22, twist: -34, headNod: 4, armN: { sh: 92, el: 4, out: 4 }, armF: { sh: -62, el: 18, out: 16 }, ...L_LUNGE, weapon: { ang: -48 } },
      // ⑤ 振り抜き：剣が下へ抜け、体はさらに沈む
      { lean: 32, twist: -48, headNod: 12, armN: { sh: 34, el: 10, out: 2, fout: -8 }, armF: { sh: -75, el: 30, out: 20 }, ...L_DEEP, weapon: { ang: -98 } },
      0,
    ],
  },

  // ───────── 刀の居合 ─────────
  katana: {
    label: '刀の居合',
    weapon: 'katana', hand: 'N', sheath: 'saya', plant: 'F',
    frames: [
      // ① 立ち：刀は鞘の中・奥の手は鞘に
      { ...STAND, armF: { hold: 14, on: 'sheath' }, weapon: { at: 'sheath' } },
      // ② 腰を落として柄に手をかける
      { lean: 16, twist: -22, headNod: 2, armN: { hold: 0 }, armF: { hold: 12, on: 'sheath' }, ...L_READY, weapon: { at: 'sheath' }, sheath: { abs: -66 } },
      // ③ さらに沈んで抜く寸前
      { lean: 28, twist: -36, headNod: 0, armN: { hold: 0 }, armF: { hold: 12, on: 'sheath' }, ...L_LOW, weapon: { at: 'sheath' }, sheath: { abs: -76 } },
      // ④ 抜き打ち：右へ横一文字（腕と刀がまっすぐ右）
      { lean: 20, twist: -22, headNod: 4, armN: { w: 1, sh: 91, el: 0, out: 0 }, armF: { hold: 10, on: 'sheath' }, ...L_LUNGE, weapon: { abs: 91 }, sheath: { abs: -80 } },
      // ⑤ 振り抜いた姿勢（刀は右上）
      { lean: 12, twist: 8, headNod: -2, armN: { w: 1, sh: 116, el: 0, out: 0 }, armF: { hold: 10, on: 'sheath' }, ...L_DEEP, weapon: { abs: 138 }, sheath: { abs: -74 } },
      0,
    ],
  },

  // ───────── 両手の重い武器 ─────────
  heavy: {
    label: '両手の重い武器で叩きつける',
    weapon: 'heavy', hand: 'N', plant: 'F',
    frames: [
      // ① 立ち：頭を前の地面へ下げて持つ
      { ...STAND, lean: 4, armN: { to: [16, -52, 12] }, armF: { hold: -22 }, weapon: { abs: 52 } },
      // ② 両手で構える
      { lean: 8, twist: 10, armN: { to: [48, -30, 10] }, armF: { hold: -22 }, ...L_READY, weapon: { abs: 134 } },
      // ③ 頭の上まで大きく振りかぶる（背中側へ反る）
      { lean: -16, twist: 22, headNod: -6, armN: { to: [-6, 80, 16] }, armF: { hold: -22 }, ...L_BACK, weapon: { abs: 197 } },
      // ④ 右前へ振り下ろして叩きつける
      { lean: 34, twist: -18, headNod: 14, armN: { to: [32, -56, 8] }, armF: { hold: -22 }, ...L_LUNGE, weapon: { abs: 60 } },
      // ⑤ 叩きつけたままの低い姿勢
      { lean: 40, twist: -22, headNod: 20, armN: { to: [24, -62, 8] }, armF: { hold: -22 }, ...L_DEEP, weapon: { abs: 68 } },
      0,
    ],
  },

  // ───────── 槍 ─────────
  spear: {
    label: '槍で突く',
    weapon: 'spear', hand: 'F', front: true, plant: 'N',
    frames: [
      // ① 立ち：槍を縦に持つ
      { ...STAND, ...O_STAND, twist: 10, armF: { w: 1, sh: 30, el: 60, out: 12 }, weapon: { abs: 180, grip: -30 } },
      // ② 両手で横に構える（穂先は右）
      { lean: 8, twist: 36, armF: { w: 1, sh: 62, el: 26, out: 4 }, armN: { hold: -72 }, ...O_READY, weapon: { abs: 93, grip: 0 } },
      // ③ 槍を後ろへ引いて体を沈める
      { lean: 4, twist: 56, armF: { to: [36, -30, -18] }, armN: { hold: -52 }, ...O_BACK, weapon: { abs: 95, grip: 14 } },
      // ④ 踏み込んで右へまっすぐ突く
      { lean: 16, twist: -14, headNod: 4, armF: { w: 1, sh: 90, el: 0, out: 0 }, armN: { hold: -74 }, ...O_LUNGE, weapon: { abs: 90, grip: -12 } },
      // ⑤ 突いた槍を少し戻す
      { lean: 14, twist: 10, armF: { w: 1, sh: 76, el: 34, out: 2 }, armN: { hold: -72 }, ...O_READY, weapon: { abs: 91, grip: 0 } },
      0,
    ],
  },

  // ───────── 短剣（逆手）─────────
  dagger: {
    label: '短剣（逆手）で斬り払う',
    weapon: 'dagger', hand: 'N', plant: 'F',
    frames: [
      { ...STAND, weapon: { abs: -62 } },
      // ② 逆手に持って身を低く
      { lean: 22, twist: -8, headNod: 2, armN: { w: 1, sh: 38, el: 88, out: 10 }, armF: { sh: 30, el: 70, out: 16 }, ...L_READY, weapon: { abs: 52 } },
      // ③ さらに沈み、短剣を反対の肩の前へ引く
      { lean: 30, twist: -38, headNod: 0, armN: { to: [26, -6, -24] }, armF: { w: 1, sh: -30, el: 40, out: 16 }, ...L_LOW, weapon: { abs: -100 } },
      // ④ 右へ飛び込むように斬り払う
      { lean: 40, twist: -12, headNod: 8, armN: { w: 1, sh: 96, el: 0, out: 0 }, armF: { w: 1, sh: -72, el: 12, out: 14 }, legN: { hip: 62, knee: 60, out: 4 }, legF: { hip: -44, knee: 4, out: 6, foot: 20 }, weapon: { abs: 96 } },
      // ⑤ 振り抜いた低い姿勢
      { lean: 38, twist: 26, headNod: 6, armN: { w: 1, sh: 104, el: 0, out: 0 }, armF: { w: 1, sh: -74, el: 28, out: 20 }, ...L_DEEP, weapon: { abs: 150 } },
      0,
    ],
  },

  // ───────── 拳 ─────────
  fist: {
    label: '拳で殴る',
    plant: 'F',
    frames: [
      STAND,
      // ② ファイティングポーズ
      { lean: 8, twist: 16, armN: { to: [30, -4, 22] }, armF: { to: [46, 2, -14] }, ...L_READY },
      // ③ 手前の拳を大きく引いて腰をひねる
      { lean: 2, twist: 56, hipTwist: 16, armN: { to: [-26, -30, 36], pole: [-1, 0.2, 0.3] }, armF: { to: [52, 6, -10] }, ...L_BACK },
      // ④ 踏み込んで右へ拳をまっすぐ突き出す
      { lean: 22, twist: -48, hipTwist: -14, headNod: 4, armN: { w: 1, sh: 92, el: 0, out: 0 }, armF: { to: [-8, -28, -36], pole: [-1, 0.2, -0.3] }, ...L_LUNGE },
      // ⑤ 突き出したあと・引き手
      { lean: 14, twist: -24, armN: { w: 1, sh: 72, el: 50, out: 6 }, armF: { to: [22, -10, -26] }, ...L_STEP },
      0,
    ],
  },

  // ───────── 弓 ─────────
  bow: {
    label: '弓を射る',
    weapon: 'bow', hand: 'F', front: true, plant: 'N',
    frames: [
      // ① 立ち：弓を下げて持つ
      { ...STAND, ...O_STAND, twist: 12, armF: { w: 1, sh: 24, el: 30, out: 14 }, weapon: { abs: 150 } },
      // ② 弓を右へ向けて矢をつがえる
      { lean: 4, twist: 26, armF: { w: 1, sh: 58, el: 46, out: 0 }, armN: { hold: [0, 42] }, ...O_STAND, weapon: { abs: 170, pull: 42, arrow: 1 } },
      // ③ 弦をいっぱいに引きしぼる
      { lean: -4, twist: 62, headTurn: -20, armF: { w: 1, sh: 90, el: 0, out: 0 }, armN: { hold: [0, 80], pole: [-1, 0.5, 0.5] }, ...O_READY, weapon: { abs: 180, pull: 80, arrow: 1 } },
      // ④ 放った瞬間：弦が戻り、引き手が後ろへ開く
      { lean: -8, twist: 72, headTurn: -24, armF: { w: 1, sh: 92, el: 0, out: 0 }, armN: { w: 1, sh: -100, el: 6, out: 18 }, ...O_READY, weapon: { abs: 186 } },
      // ⑤ 残心
      { lean: -4, twist: 62, headTurn: -20, armF: { w: 1, sh: 74, el: 4, out: 0 }, armN: { w: 1, sh: -72, el: 26, out: 18 }, ...O_STAND, weapon: { abs: 168 } },
      0,
    ],
  },

  // ───────── 長い銃 ─────────
  gun: {
    label: '長い銃を撃つ',
    weapon: 'gun', hand: 'N', plant: 'N',
    frames: [
      // ① 立ち：銃を下げる
      { ...STAND, ...O_STAND, twist: 10, armN: { w: 1, sh: 4, el: 46, out: 12 }, weapon: { abs: 56 } },
      // ② 銃を右へ構える（肩に付ける）
      { lean: 4, twist: 30, armN: { to: [22, -8, 24] }, armF: { hold: 52 }, ...O_STAND, weapon: { abs: 90 } },
      // ③ 狙いを定める（少し前かがみ）
      { lean: 14, twist: 34, headNod: 8, armN: { to: [24, -6, 24] }, armF: { hold: 54 }, ...O_READY, weapon: { abs: 90 } },
      // ④ 撃つ：反動で銃口が上がり、体が後ろへ
      { lean: -8, twist: 38, headNod: -4, armN: { to: [10, 0, 24] }, armF: { hold: 52 }, ...O_BACK, weapon: { abs: 108 } },
      // ⑤ 反動から戻りかけ
      { lean: 4, twist: 32, armN: { to: [20, -6, 24] }, armF: { hold: 52 }, ...O_READY, weapon: { abs: 96 } },
      0,
    ],
  },

  // ───────── 投げる ─────────
  throw: {
    label: '投げる（瓶・札・手裏剣）',
    weapon: 'ball', hand: 'N', plant: 'F',
    frames: [
      { ...STAND, weapon: { hide: 1 } },
      // ② 手もとに持って構える
      { lean: 4, twist: 12, armN: { w: 1, sh: 30, el: 96, out: 12 }, armF: { sh: 24, el: 50, out: 16 }, ...L_LIGHT, weapon: { ang: 0 } },
      // ③ 大きく振りかぶる（腕を後ろへ・体をひねる）
      { lean: -12, twist: 56, armN: { w: 1, sh: 222, el: 26, out: 16 }, armF: { w: 1, sh: 84, el: 8, out: 4 }, ...L_BACK, weapon: { ang: 0 } },
      // ④ 投げる瞬間：腕を前へ振り抜き、丸が手から少し離れる
      { lean: 26, twist: -46, headNod: 6, armN: { w: 1, sh: 98, el: 0, out: 4 }, armF: { w: 1, sh: -52, el: 30, out: 16 }, ...L_LUNGE, weapon: { abs: 96, fly: [24, 4] } },
      // ⑤ 投げ終わり：腕が前で下がる
      { lean: 34, twist: -60, headNod: 12, armN: { w: 1, sh: 36, el: 12, out: 0 }, armF: { w: 1, sh: -70, el: 34, out: 18 }, ...L_DEEP, weapon: { hide: 1 } },
      0,
    ],
  },

  // ───────── 素手で魔法 ─────────
  hand: {
    label: '素手で魔法を放つ',
    plant: 'F',
    frames: [
      STAND,
      // ② 両手を胸の前で合わせて力を集める
      { lean: 8, twist: 0, headNod: 10, armN: { to: [36, -22, 7] }, armF: { to: [36, -22, -7] }, ...L_LIGHT },
      // ③ 手前の手を後ろへ引いてため（奥の手は前）
      { lean: -2, twist: 50, armN: { to: [-34, -14, 34], pole: [-1, 0.3, 0.3] }, armF: { w: 1, sh: 88, el: 4, out: 0 }, ...L_BACK },
      // ④ 手前の手を右へ突き出して放つ
      { lean: 22, twist: -50, headNod: 2, armN: { w: 1, sh: 94, el: 0, out: 0 }, armF: { to: [-14, -20, -36], pole: [-1, 0.2, -0.3] }, ...L_LUNGE },
      // ⑤ 手を出したままの余韻
      { lean: 8, twist: -30, armN: { w: 1, sh: 80, el: 14, out: 0 }, armF: { to: [-6, -30, -34], pole: [-1, 0.2, -0.3] }, ...L_LIGHT },
      0,
    ],
  },

  // ───────── 杖 ─────────
  staff: {
    label: '杖をかかげて放つ',
    weapon: 'staff', hand: 'N', plant: 'F',
    frames: [
      // ① 立ち：杖を縦に持つ
      { ...STAND, armN: { to: [80, -40, 8] }, weapon: { abs: 179, grip: 40 } },
      // ② 杖を両手で胸の前へ
      { lean: 6, twist: 8, armN: { to: [32, -34, 12] }, armF: { hold: 84 }, ...L_LIGHT, weapon: { abs: 158, grip: 40 } },
      // ③ 杖を頭の上へ高くかかげる
      { lean: -10, twist: 20, headNod: -12, armN: { to: [14, 76, 22] }, armF: { hold: -10 }, ...L_STAND, weapon: { abs: 174, grip: 34 } },
      // ④ 杖の先を右へ振り下ろして向ける
      { lean: 18, twist: -20, headNod: 4, armN: { to: [56, -6, 18] }, armF: { hold: 6 }, ...L_STEP, weapon: { abs: 80, grip: 46 } },
      // ⑤ 杖を右へ向けたまま
      { lean: 14, twist: -16, armN: { to: [52, -10, 18] }, armF: { hold: 6 }, ...L_STEP, weapon: { abs: 86, grip: 46 } },
      0,
    ],
  },

  // ───────── 力をためる・補助 ─────────
  buff: {
    label: '力をためる（補助）',
    plant: 'F',
    frames: [
      STAND,
      // ② 足を開いて身構える
      { lean: 6, twist: 6, armN: { to: [24, -22, 38] }, armF: { to: [24, -22, -38] }, ...WIDE(20) },
      // ③ 体を丸めて力をためる（ひじを引き、こぶしを腰に）
      { lean: 26, twist: 6, headNod: 22, armN: { to: [10, -44, 34], pole: [-1, 0.3, 0.4] }, armF: { to: [10, -44, -34], pole: [-1, 0.3, -0.4] }, ...WIDE(44) },
      // ④ 胸を張って両腕を左右へ大きく開く
      { lean: -14, twist: 30, headNod: -16, armN: { sh: 0, el: 0, out: 112 }, armF: { sh: 0, el: 0, out: 112 }, ...WIDE(8) },
      // ⑤ 腕を下ろしかける
      { lean: -2, twist: 14, headNod: -4, armN: { sh: 0, el: 12, out: 56 }, armF: { sh: 0, el: 12, out: 56 }, ...WIDE(14) },
      0,
    ],
  },

  // ───────── 祈る・回復 ─────────
  pray: {
    label: '祈る（回復）',
    plant: 'F',
    frames: [
      STAND,
      // ② 両手を胸の前で組む
      { lean: 4, twist: 0, armN: { to: [34, -18, 5] }, armF: { to: [34, -18, -5] }, ...L_STAND },
      // ③ 頭を下げて祈る
      { lean: 20, twist: 0, headNod: 32, armN: { to: [36, -4, 5] }, armF: { to: [36, -4, -5] }, legN: { hip: 12, knee: 22, out: 5 }, legF: { hip: -8, knee: 22, out: 5 } },
      // ④ 顔を上げ、両手を頭の上へ広げて光を受ける
      { lean: -10, twist: 40, headNod: -24, armN: { sh: 176, el: 0, out: 36 }, armF: { sh: 176, el: 0, out: 36 }, ...L_STAND },
      // ⑤ 手を胸の前へ下ろしかける
      { lean: -2, twist: 10, headNod: -6, armN: { to: [36, 14, 20] }, armF: { to: [36, 14, -20] }, ...L_STAND },
      0,
    ],
  },

  // ───────── 小瓶を自分にかける ─────────
  potion: {
    label: '小瓶を自分にかける（回復）',
    weapon: 'potion', hand: 'N', plant: 'F',
    frames: [
      { ...STAND, weapon: { abs: 180 } },
      // ② 小瓶を胸の前に出す
      { lean: 2, twist: 6, headNod: 10, armN: { to: [40, -14, 16] }, armF: ARM_F, ...L_STAND, weapon: { abs: 180 } },
      // ③ 小瓶を頭の上へかかげる
      { lean: -6, twist: 10, headNod: -16, armN: { to: [34, 84, 16] }, armF: ARM_F, ...L_STAND, weapon: { abs: 178 } },
      // ④ 頭の上で傾けて自分にふりかける
      { lean: -8, twist: 10, headNod: -10, armN: { to: [30, 86, 16] }, armF: { sh: 10, el: 30, out: 22 }, ...L_STAND, weapon: { abs: 304 } },
      // ⑤ 小瓶を下ろしかける
      { lean: 0, twist: 8, headNod: 0, armN: { to: [42, 18, 20] }, armF: ARM_F, ...L_STAND, weapon: { abs: 200 } },
      0,
    ],
  },
};
