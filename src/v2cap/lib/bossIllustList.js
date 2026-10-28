// tools/v2cap-boss-illust.mjs が書くファイル（手で直さない）。ボス → イラスト版のパーツ・エフェクト
//   parts … 立ち絵（640px）の上の位置（x・y・w・h）・回す中心（px・py）・長さの向き（ax°）・親（parent）。並びは ILLUST_PARTS
//   pivot … 全体を回す中心（体の真ん中）／mouth … 頭のいちばん左（飛ぶエフェクトが出る口）
//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクトの大きさ（px）と合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）
//   fit … パーツを立ち絵に重ねた倍率・角度・位置（元の絵の px・確かめ用）／v … 絵ごとの中身の印（画面のアドレスの ?v=）
export const BOSS_ILLUST = {
  varuzenoku: {
    parts: {
      wingF: { x: 14, y: 27, w: 342, h: 242, px: 292, py: 240, ax: -142 },
      wingN: { x: 309, y: 0, w: 322, h: 437, px: 341, py: 292, ax: -41 },
      body: { x: 159, y: 195, w: 428, h: 426, px: 341, py: 426, ax: 7 },
      neck: { x: 161, y: 285, w: 158, h: 124, px: 255, py: 385, ax: -113 },
      head: { x: 21, y: 137, w: 273, h: 188, px: 232, py: 316, ax: -132, parent: 'neck' },
      arm: { x: 54, y: 302, w: 144, h: 93, px: 182, py: 343, ax: 174, parent: 'body' },
      jaw: { x: 40, y: 270, w: 84, h: 40, px: 114, py: 272, ax: 153, parent: 'head' },
    },
    pivot: [341, 426], mouth: [22, 282],
    fx: {
      claw: { hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      breath: { fly: { w: 384, h: 252, ax: 2, ay: 162 }, hit: { w: 377, h: 384, ax: 189, ay: 192 } },
      gale: { fly: { w: 384, h: 345, ax: 4, ay: 166 }, hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      doom: { fly: { w: 384, h: 290, ax: 3, ay: 159 }, hit: { w: 384, h: 384, ax: 192, ay: 192 } },
    },
    fit: {
      wingN: { s: 0.76, deg: -1, tx: 276, ty: 0, score: 0.381 },
      body: { s: 0.89, deg: -3, tx: 14, ty: 164, score: 0.155 },
      head: { s: 0.53, deg: -4, tx: -32, ty: 228, score: 0.043 },
    },
    v: { 'il-wingF': '35734617', 'il-wingN': 'bb79a513', 'il-body': '92a93b62', 'il-neck': '400e9020', 'il-head': 'f5a5c6fb', 'il-arm': 'd5374a58', 'il-jaw': '0b450b58', 'il-fx-claw-hit': '9e27da08', 'il-fx-breath-fly': 'c7e563ee', 'il-fx-breath-hit': '7bcfb438', 'il-fx-gale-fly': '5dc69c3e', 'il-fx-gale-hit': '709c7f83', 'il-fx-doom-fly': '34511ca5', 'il-fx-doom-hit': '4255edc9' },
  },
}
