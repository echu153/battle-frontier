// tools/v2cap-boss-art.mjs が書くファイル（手で直さない）。ボス → 待機の枠・待機・技ごとのコマ
//   base … 待機の枠の大きさ（正方形・px）／idle … 待機のコマの数と1コマずつの長さ（ミリ秒）／illust … 遭遇のイラストがあるか
//   motions … 技のキー → コマの数・1コマの大きさ（w・h）・待機の枠の左上が1コマの中のどこにあるか（ox・oy）・1コマの長さ・当たるコマ（0から）
export const BOSS_ART = {
  varuzenoku: {
    base: 229, illust: true,
    idle: { frames: 8, ms: [200, 70, 70, 80, 170, 110, 110, 110] },
    motions: {
      claw: { frames: 6, w: 229, h: 230, ox: 0, oy: 0, ms: [100, 100, 60, 160, 120, 100], hit: 3 },
      breath: { frames: 6, w: 235, h: 230, ox: 6, oy: 0, ms: [150, 200, 90, 200, 200, 120], hit: 3 },
      gale: { frames: 4, w: 252, h: 232, ox: 0, oy: 2, ms: [150, 180, 300, 220], hit: 2 },
      doom: { frames: 4, w: 261, h: 235, ox: 0, oy: 0, ms: [220, 320, 420, 320], hit: 2 },
    },
  },
}
