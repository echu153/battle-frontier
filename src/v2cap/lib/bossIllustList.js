// tools/v2cap-boss-illust.mjs が書くファイル（手で直さない）。ボス → イラスト版のパーツ・エフェクト
//   parts … 立ち絵（640px）の上の位置（x・y・w・h）・回す中心（px・py）・長さの向き（ax°）・親（parent）・曲げた絵（bend＝枚数 n・from°・step°・枠 x・y・w・h）。並びはボスごとの layers（無ければ ILLUST_PARTS）
//   pivot … 全体を回す中心（体の真ん中）／mouth … 頭のいちばん左（飛ぶエフェクトが出る口）
//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクトの大きさ（px）と合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）・flow（流れる水の絵・at＝当たる絵の上の場所）
//   poses … 技 → ため（windup）・振り抜き（strike）の全身の絵の位置（立ち絵の px）
//   buffs … HPの節目のバフ → ポーズ（pose）・オーラ（aura）の絵の位置（立ち絵の px）
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
    poses: {
      claw: { windup: { x: 20, y: 40, w: 620, h: 575 }, strike: { x: 12, y: 72, w: 622, h: 501 } },
      breath: { windup: { x: 14, y: 28, w: 622, h: 590 }, strike: { x: 38, y: 47, w: 602, h: 561 } },
      gale: { windup: { x: 14, y: 13, w: 622, h: 617 }, strike: { x: 18, y: 47, w: 612, h: 570 } },
      doom: { windup: { x: 7, y: 14, w: 633, h: 609 }, strike: { x: 8, y: 40, w: 629, h: 575 } },
    },
    buffs: {
      armor: { pose: { x: 18, y: 54, w: 605, h: 552 }, aura: { x: 6, y: 15, w: 629, h: 610 } },
      wrath: { pose: { x: 14, y: 30, w: 614, h: 595 }, aura: { x: 25, y: 26, w: 601, h: 598 } },
    },
    fit: {
      body: { s: 0.765, deg: 0, tx: 160, ty: 154, score: 0.263 },
      back: { s: 0.975, deg: 0, tx: 14, ty: 22, score: 0.435 },
    },
    v: { 'il-wingF': '4363765e', 'il-wingN': 'c653e832', 'il-tail': 'b394f8e4', 'il-tailT': 'd8b44bdc', 'il-body': 'ac4bfbc9', 'il-neck': '5964abdc', 'il-head': '55344c91', 'il-arm': '181f74b9', 'il-jaw': 'c05e0043', 'il-tailT-bend': 'b468ba53', 'il-pose-claw-windup': '919a0b54', 'il-pose-claw-strike': 'ce18d684', 'il-pose-breath-windup': 'a5649cc8', 'il-pose-breath-strike': '942cb4d5', 'il-pose-gale-windup': '38e2637f', 'il-pose-gale-strike': '9677e5fb', 'il-pose-doom-windup': 'f935de88', 'il-pose-doom-strike': '8ad0ea30', 'il-buff-armor-pose': 'c0a80098', 'il-buff-armor-aura': '41cc0ec5', 'il-buff-wrath-pose': 'a945f209', 'il-buff-wrath-aura': 'd9bc8119', 'il-fx-claw-hit': '9e27da08', 'il-fx-breath-fly': 'c7e563ee', 'il-fx-breath-hit': '7bcfb438', 'il-fx-gale-fly': '5dc69c3e', 'il-fx-gale-hit': '709c7f83', 'il-fx-doom-fly': '34511ca5', 'il-fx-doom-hit': '4255edc9', 'il-fx-idle-orb': '46a23fc6' },
  },
  amaza: {
    parts: {
      water: { x: 0, y: 0, w: 640, h: 640, px: 337, py: 356, ax: 0 },
      body: { x: 0, y: 92, w: 640, h: 548, px: 342, py: 353, ax: 19 },
      armF: { x: 361, y: 100, w: 47, h: 55, px: 396, py: 154, ax: -112, parent: 'body' },
      armD: { x: 36, y: 139, w: 282, h: 406, px: 200, py: 185, ax: 96 },
      armN: { x: 50, y: 215, w: 77, h: 68, px: 124, py: 231, ax: 154, parent: 'armD' },
      head: { x: 148, y: 0, w: 171, h: 163, px: 230, py: 145, ax: -89, parent: 'body' },
      armC: { x: 26, y: 130, w: 302, h: 425, px: 200, py: 185, ax: 95 },
      armU: { x: 26, y: -18, w: 302, h: 573, px: 200, py: 140, ax: 96 },
      legs: { x: 296, y: 393, w: 130, h: 218, px: 370, py: 500, ax: 162, parent: 'body' },
    },
    pivot: [342, 353], mouth: [155, 87],
    fx: {
      shot: { fly: { w: 384, h: 318, ax: 3, ay: 273 }, hit: { w: 384, h: 381, ax: 192, ay: 191 } },
      sleet: { hit: { w: 384, h: 366, ax: 192, ay: 183 }, flow: { w: 320, h: 115, ax: 0, ay: 0, at: [27, 133, 325, 167] } },
      bind: { fly: { w: 384, h: 240, ax: 3, ay: 17 }, hit: { w: 384, h: 379, ax: 192, ay: 190 } },
      deluge: { hit: { w: 384, h: 384, ax: 192, ay: 192 }, flow: { w: 320, h: 224, ax: 0, ay: 0, at: [92, 0, 202, 202] }, charge: { w: 384, h: 283, ax: 192, ay: 142 } },
    },
    poses: {
      shot: { windup: { x: -13, y: 9, w: 636, h: 640 }, strike: { x: -12, y: -3, w: 631, h: 640 } },
      sleet: { windup: { x: -3, y: -47, w: 634, h: 637 }, strike: { x: -7, y: -78, w: 622, h: 636 } },
      bind: { windup: { x: -17, y: -3, w: 640, h: 640 }, strike: { x: 26, y: -30, w: 637, h: 632 } },
      deluge: { windup: { x: 21, y: -10, w: 641, h: 632 }, strike: { x: 28, y: -65, w: 637, h: 640 } },
    },
    buffs: {
      veil: { pose: { x: 79, y: -57, w: 534, h: 640 }, aura: { x: 59, y: 8, w: 557, h: 626 } },
      downpour: { pose: { x: 64, y: -14, w: 640, h: 640 }, aura: { x: 12, y: 0, w: 621, h: 640 } },
    },
    fit: {
      water: { s: 1.06, deg: 0, tx: -38, ty: -38, score: 0 },
      body: { s: 0.87, deg: -3, tx: 54, ty: 180, score: -0.292 },
      armC: { s: 1, deg: 0, tx: 0, ty: 0, score: 1.076 },
      armU: { s: 1.085, deg: -2, tx: -122, ty: -80, score: 0.46 },
    },
    v: { 'il-water': '56a7ccb4', 'il-body': '366e5e3d', 'il-armF': '3263d5b5', 'il-armD': 'bdd766a3', 'il-armN': '7eaed282', 'il-head': 'b65aea3c', 'il-armC': 'b8484a39', 'il-armU': 'a1317398', 'il-legs': '73fc2634', 'il-pose-shot-windup': 'e26463d9', 'il-pose-shot-strike': '84f98092', 'il-pose-sleet-windup': '9d83d96c', 'il-pose-sleet-strike': '5b01fc01', 'il-pose-bind-windup': 'f3710ed7', 'il-pose-bind-strike': '46e45994', 'il-pose-deluge-windup': 'b47d0548', 'il-pose-deluge-strike': '7ffde424', 'il-buff-veil-pose': 'c6a9c61e', 'il-buff-veil-aura': 'ff53ea44', 'il-buff-downpour-pose': '80b7c430', 'il-buff-downpour-aura': '7fc4ee35', 'il-fx-shot-fly': '89f4d4f3', 'il-fx-shot-hit': 'b458f544', 'il-fx-sleet-hit': '846c1942', 'il-fx-sleet-flow': '0cc0a8c1', 'il-fx-bind-fly': 'ee7ff9a4', 'il-fx-bind-hit': '6d7032af', 'il-fx-deluge-hit': 'd828eed6', 'il-fx-deluge-flow': '604c35d7', 'il-fx-deluge-charge': 'fdaabfa2' },
  },
  zerugiasu: {
    parts: {
      wL4: { x: 53, y: 238, w: 117, h: 134, px: 215, py: 155, ax: 124, parent: 'body' },
      wL3: { x: 13, y: 190, w: 177, h: 128, px: 215, py: 155, ax: 141, parent: 'body' },
      wL2: { x: 12, y: 152, w: 176, h: 61, px: 215, py: 155, ax: 164, parent: 'body' },
      wL1: { x: 31, y: 83, w: 165, h: 79, px: 215, py: 155, ax: -163, parent: 'body' },
      wR4: { x: 428, y: 200, w: 150, h: 172, px: 425, py: 170, ax: 55, parent: 'body' },
      wR3: { x: 442, y: 186, w: 183, h: 134, px: 425, py: 170, ax: 36, parent: 'body' },
      wR2: { x: 458, y: 164, w: 170, h: 49, px: 425, py: 170, ax: 9, parent: 'body' },
      wR1: { x: 456, y: 95, w: 157, h: 75, px: 425, py: 170, ax: -21, parent: 'body' },
      body: { x: 83, y: 28, w: 476, h: 576, px: 305, py: 322, ax: 55 },
      armF: { x: 393, y: 167, w: 227, h: 381, px: 432, py: 205, ax: 68, parent: 'body' },
      armN: { x: 25, y: 143, w: 262, h: 364, px: 222, py: 205, ax: 120, parent: 'body' },
    },
    pivot: [305, 322], mouth: [85, 588],
    fx: {
      shell: { fly: { w: 384, h: 148, ax: 3, ay: 94 }, hit: { w: 384, h: 354, ax: 192, ay: 177 } },
      volley: { fly: { w: 384, h: 85, ax: 15, ay: 49 }, hit: { w: 384, h: 336, ax: 192, ay: 168 } },
      smite: { hit: { w: 373, h: 384, ax: 187, ay: 192 } },
      ruin: { fly: { w: 384, h: 178, ax: 0, ay: 91 }, hit: { w: 384, h: 384, ax: 192, ay: 192 }, charge: { w: 384, h: 379, ax: 192, ay: 190 } },
      idle: { core: { w: 354, h: 384, ax: 177, ay: 192 } },
    },
    poses: {
      ruin: { windup: { x: -45, y: 7, w: 707, h: 598 }, strike: { x: 3, y: 75, w: 616, h: 529 } },
    },
    buffs: {
      armor: { pose: { x: 38, y: 54, w: 568, h: 550 }, aura: { x: 14, y: 0, w: 617, h: 640 } },
      overload: { pose: { x: -41, y: -47, w: 693, h: 652 }, aura: { x: 0, y: 0, w: 640, h: 640 } },
    },
    fit: {
      body: { s: 0.985, deg: 0, tx: 20, ty: 4, score: 0.123 },
    },
    v: { 'il-wL4': '911ef5ec', 'il-wL3': 'b6a8b6f6', 'il-wL2': 'd04fb600', 'il-wL1': '983d75cd', 'il-wR4': 'be3d79c2', 'il-wR3': 'b97148f2', 'il-wR2': 'e23292c0', 'il-wR1': '842831a0', 'il-body': '582b4530', 'il-armF': '18f2148a', 'il-armN': '3fe0ad48', 'il-pose-ruin-windup': '07c0ab4e', 'il-pose-ruin-strike': '443d357f', 'il-buff-armor-pose': 'a02dd575', 'il-buff-armor-aura': '6e26f1e8', 'il-buff-overload-pose': 'd6f2e631', 'il-buff-overload-aura': '3cfad7b0', 'il-fx-shell-fly': '066f39ec', 'il-fx-shell-hit': '8db55fc9', 'il-fx-volley-fly': 'c5750402', 'il-fx-volley-hit': '19c76907', 'il-fx-smite-hit': '1a0df76d', 'il-fx-ruin-fly': '9c645d5a', 'il-fx-ruin-hit': '7275a1d5', 'il-fx-ruin-charge': '9465a5be', 'il-fx-idle-core': '340711fc' },
  },
  enma: {
    parts: {
      soulA: { x: 102, y: 76, w: 108, h: 138, px: 505, py: 145, ax: 180 },
      soulB: { x: 15, y: 214, w: 125, h: 169, px: 420, py: 300, ax: -179 },
      soulC: { x: 41, y: 415, w: 127, h: 142, px: 440, py: 490, ax: 180 },
      soulD: { x: 532, y: 145, w: 96, h: 165, px: 230, py: 225, ax: 1 },
      soulE: { x: 460, y: 321, w: 162, h: 159, px: 200, py: 400, ax: -2 },
      body: { x: 27, y: 0, w: 580, h: 628, px: 303, py: 364, ax: 77 },
      head: { x: 190, y: 2, w: 165, h: 170, px: 295, py: 150, ax: -108, parent: 'body' },
      staff: { x: 111, y: 296, w: 80, h: 334, px: 150, py: 460, ax: -40, parent: 'body' },
      legL: { x: 68, y: 568, w: 98, h: 62, px: 120, py: 610, ax: -86, parent: 'body' },
      legR: { x: 388, y: 574, w: 110, h: 54, px: 440, py: 610, ax: -82, parent: 'body' },
      hand: { x: 472, y: 156, w: 79, h: 64, px: 500, py: 200, ax: -51, parent: 'body' },
    },
    pivot: [303, 364], mouth: [193, 119],
    fx: {
      soul: { fly: { w: 384, h: 212, ax: 8, ay: 151 }, hit: { w: 384, h: 370, ax: 192, ay: 185 }, charge: { w: 211, h: 384, ax: 106, ay: 192 } },
      pillar: { hit: { w: 384, h: 384, ax: 192, ay: 192 } },
      chains: { hit: { w: 384, h: 162, ax: 192, ay: 81 } },
      hell: { charge: { w: 384, h: 208, ax: 192, ay: 104 }, hit: { w: 480, h: 480, ax: 240, ay: 240 } },
      idle: { flame: { w: 211, h: 384, ax: 106, ay: 192 } },
    },
    poses: {
      soul: { windup: { x: 29, y: 5, w: 578, h: 625 }, strike: { x: 27, y: 4, w: 613, h: 625 } },
      pillar: { windup: { x: 58, y: -26, w: 616, h: 654 }, strike: { x: 10, y: 15, w: 620, h: 623 } },
      chains: { windup: { x: 44, y: 1, w: 608, h: 629 }, strike: { x: 41, y: 5, w: 617, h: 627 } },
      hell: { windup: { x: 11, y: -23, w: 639, h: 655 }, strike: { x: 9, y: 7, w: 592, h: 622 } },
    },
    buffs: {
      rinne: { pose: { x: 112, y: -2, w: 427, h: 634 }, aura: { x: 24, y: -66, w: 566, h: 623 } },
      wrath: { pose: { x: 1, y: -7, w: 636, h: 635 }, aura: { x: 5, y: 41, w: 632, h: 630 } },
    },
    fit: {
      soulA: { s: 1, deg: 0, tx: 0, ty: 0, score: 0 },
    },
    v: { 'il-soulA': '6a66b645', 'il-soulB': 'ac0e0178', 'il-soulC': 'a32c09b3', 'il-soulD': '3db991f7', 'il-soulE': 'f5851b38', 'il-body': '383f5d45', 'il-head': 'a82f81e1', 'il-staff': 'c9e4f1cf', 'il-legL': '28aa1f2c', 'il-legR': '5799da00', 'il-hand': 'fecbb06e', 'il-pose-soul-windup': 'c3c18f66', 'il-pose-soul-strike': '579deeb7', 'il-pose-pillar-windup': 'e29810dc', 'il-pose-pillar-strike': 'c9108f45', 'il-pose-chains-windup': '5e330a58', 'il-pose-chains-strike': 'fdd0273b', 'il-pose-hell-windup': '364f426f', 'il-pose-hell-strike': '87687079', 'il-buff-rinne-pose': 'f3389191', 'il-buff-rinne-aura': 'd6005436', 'il-buff-wrath-pose': 'e2438b6c', 'il-buff-wrath-aura': '1388c44a', 'il-fx-soul-fly': '060fa75b', 'il-fx-soul-hit': 'a5d5c3a4', 'il-fx-soul-charge': '64b6da9c', 'il-fx-pillar-hit': '434fb1f1', 'il-fx-chains-hit': '8ffd431a', 'il-fx-hell-charge': '59f63d34', 'il-fx-hell-hit': '821d40d8', 'il-fx-idle-flame': '64b6da9c' },
  },
}
