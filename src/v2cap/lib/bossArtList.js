// tools/v2cap-boss-art.mjs が書くファイル（手で直さない）。ボス → 待機の枠・待機・技ごとのコマ
//   base … 待機の枠の大きさ（正方形・px）／idle … 待機のコマの数と1コマずつの長さ（ミリ秒）／illust … 遭遇のイラストがあるか
//   motions … 技のキー → コマの数・1コマの大きさ（w・h）・待機の枠の左上が1コマの中のどこにあるか（ox・oy）・1コマの長さ・当たるコマ（0から）
//             front … 当たるコマの竜のいちばん前（待機の枠の左上から・飛ぶエフェクトが出るところ）
//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクト：コマの数・1コマの大きさ（待機の枠と同じpx）・合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）
export const BOSS_ART = {
  varuzenoku: {
    base: 229, illust: true,
    idle: { frames: 8, ms: [200, 70, 70, 80, 170, 110, 110, 110] },
    motions: {
      claw: { frames: 6, w: 229, h: 230, ox: 0, oy: 0, ms: [100, 100, 60, 160, 120, 100], hit: 3, front: [8, 145] },
      breath: { frames: 6, w: 235, h: 230, ox: 6, oy: 0, ms: [150, 200, 90, 200, 200, 120], hit: 3, front: [7, 84] },
      gale: { frames: 6, w: 229, h: 231, ox: 0, oy: 0, ms: [140, 200, 70, 180, 160, 120], hit: 3, front: [7, 102] },
      doom: { frames: 6, w: 229, h: 231, ox: 0, oy: 0, ms: [200, 240, 320, 120, 240, 160], hit: 3, front: [7, 102] },
    },
    fx: {
      claw: { hit: { frames: 6, w: 148, h: 142, ax: 74, ay: 71 } },
      breath: { fly: { frames: 6, w: 106, h: 54, ax: 1, ay: 30 }, hit: { frames: 6, w: 163, h: 174, ax: 82, ay: 87 } },
      gale: { fly: { frames: 6, w: 118, h: 113, ax: 0, ay: 57 }, hit: { frames: 6, w: 181, h: 178, ax: 91, ay: 89 } },
      doom: { fly: { frames: 6, w: 151, h: 132, ax: 0, ay: 69 }, hit: { frames: 6, w: 224, h: 231, ax: 112, ay: 116 } },
    },
  },
}
