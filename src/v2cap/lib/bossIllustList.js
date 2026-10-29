// tools/v2cap-boss-illust.mjs が書くファイル（手で直さない）。ボス → イラスト版のパーツ・エフェクト
//   parts … 立ち絵（640px）の上の位置（x・y・w・h）・回す中心（px・py）・長さの向き（ax°）・親（parent）・曲げた絵（bend＝枚数 n・from°・step°・枠 x・y・w・h）。並びはボスごとの layers（無ければ ILLUST_PARTS）
//   pivot … 全体を回す中心（体の真ん中）／mouth … 頭のいちばん左（飛ぶエフェクトが出る口）
//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクトの大きさ（px）と合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）・flow（流れる水の絵・at＝当たる絵の上の場所）
//   fit … パーツを立ち絵に重ねた倍率・角度・位置（元の絵の px・確かめ用）／v … 絵ごとの中身の印（画面のアドレスの ?v=）
export const BOSS_ILLUST = {
  varuzenoku: {
    parts: {
      wingF: { x: 46, y: 57, w: 284, h: 313, px: 300, py: 262, ax: -156 },
      wingN: { x: 380, y: 64, w: 227, h: 417, px: 418, py: 280, ax: -13 },
      tail: { x: 58, y: 474, w: 185, h: 111, px: 214, py: 568, ax: -147 },
      tailT: { x: 44, y: 349, w: 181, h: 152, px: 75, py: 478, ax: -53, parent: 'tail', bend: { n: 33, from: -16, step: 2, x: 40, y: 339, w: 212, h: 216 } },
      body: { x: 196, y: 240, w: 379, h: 366, px: 358, py: 392, ax: 69 },
      neck: { x: 260, y: 181, w: 161, h: 131, px: 350, py: 300, ax: -93, parent: 'body' },
      head: { x: 238, y: 88, w: 172, h: 144, px: 320, py: 196, ax: -80, parent: 'neck' },
      arm: { x: 130, y: 277, w: 162, h: 97, px: 268, py: 318, ax: 177, parent: 'body' },
      jaw: { x: 253, y: 171, w: 49, h: 44, px: 292, py: 172, ax: 121, parent: 'head' },
    },
    pivot: [358, 392], mouth: [238, 154],
    fx: {
      claw: { hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      breath: { fly: { w: 384, h: 252, ax: 2, ay: 162 }, hit: { w: 377, h: 384, ax: 189, ay: 192 } },
      gale: { fly: { w: 384, h: 345, ax: 4, ay: 166 }, hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      doom: { fly: { w: 384, h: 290, ax: 3, ay: 159 }, hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      idle: { orb: { w: 384, h: 373, ax: 192, ay: 187 } },
    },
    fit: {
      body: { s: 0.765, deg: 0, tx: 160, ty: 154, score: 0.263 },
      back: { s: 0.975, deg: 0, tx: 14, ty: 22, score: 0.435 },
    },
    v: { 'il-wingF': '4363765e', 'il-wingN': 'c653e832', 'il-tail': 'b394f8e4', 'il-tailT': 'd8b44bdc', 'il-body': 'ac4bfbc9', 'il-neck': '5964abdc', 'il-head': '55344c91', 'il-arm': '181f74b9', 'il-jaw': 'c05e0043', 'il-tailT-bend': 'b468ba53', 'il-fx-claw-hit': '9e27da08', 'il-fx-breath-fly': 'c7e563ee', 'il-fx-breath-hit': '7bcfb438', 'il-fx-gale-fly': '5dc69c3e', 'il-fx-gale-hit': '709c7f83', 'il-fx-doom-fly': '34511ca5', 'il-fx-doom-hit': '4255edc9', 'il-fx-idle-orb': '46a23fc6' },
  },
  amaza: {
    parts: {
      water: { x: 0, y: 0, w: 640, h: 640, px: 337, py: 356, ax: 0 },
      body: { x: 0, y: 92, w: 640, h: 548, px: 342, py: 353, ax: 24 },
      armF: { x: 361, y: 100, w: 47, h: 55, px: 396, py: 154, ax: -112, parent: 'body' },
      armD: { x: 36, y: 139, w: 282, h: 406, px: 200, py: 185, ax: 96 },
      armN: { x: 50, y: 215, w: 77, h: 68, px: 124, py: 231, ax: 154, parent: 'armD' },
      head: { x: 148, y: 0, w: 171, h: 163, px: 230, py: 145, ax: -89, parent: 'body' },
      armC: { x: 26, y: 130, w: 302, h: 425, px: 200, py: 185, ax: 95 },
      armU: { x: 26, y: -18, w: 302, h: 573, px: 200, py: 140, ax: 96 },
    },
    pivot: [342, 353], mouth: [155, 87],
    fx: {
      shot: { fly: { w: 384, h: 318, ax: 3, ay: 273 }, hit: { w: 384, h: 381, ax: 192, ay: 191 } },
      sleet: { hit: { w: 384, h: 366, ax: 192, ay: 183 } },
      bind: { fly: { w: 384, h: 240, ax: 3, ay: 17 }, hit: { w: 384, h: 379, ax: 192, ay: 190 } },
      deluge: { hit: { w: 384, h: 384, ax: 192, ay: 192 }, flow: { w: 320, h: 224, ax: 0, ay: 0, at: [92, 0, 202, 202] }, charge: { w: 384, h: 283, ax: 192, ay: 142 } },
    },
    fit: {
      water: { s: 1.06, deg: 0, tx: -38, ty: -38, score: 0 },
      body: { s: 0.87, deg: -3, tx: 54, ty: 180, score: -0.292 },
      armC: { s: 1, deg: 0, tx: 0, ty: 0, score: 1.076 },
      armU: { s: 1.085, deg: -2, tx: -122, ty: -80, score: 0.46 },
    },
    v: { 'il-water': '56a7ccb4', 'il-body': '812a7e41', 'il-armF': '3263d5b5', 'il-armD': 'bdd766a3', 'il-armN': '7eaed282', 'il-head': 'b65aea3c', 'il-armC': 'b8484a39', 'il-armU': 'a1317398', 'il-fx-shot-fly': '89f4d4f3', 'il-fx-shot-hit': 'b458f544', 'il-fx-sleet-hit': '846c1942', 'il-fx-bind-fly': 'ee7ff9a4', 'il-fx-bind-hit': '6d7032af', 'il-fx-deluge-hit': 'd828eed6', 'il-fx-deluge-flow': '604c35d7', 'il-fx-deluge-charge': 'fdaabfa2' },
  },
}
