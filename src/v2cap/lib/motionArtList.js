// tools/v2cap-motion.mjs が書くファイル（手で直さない）。クラス → 男女 → 動き → コマの数・1コマの大きさ・ずらし・速さ
//   frames … コマの数／w・h … 1コマの大きさ（px）／ox・oy … 待機GIF（224×224）の左上が1コマの中のどこにあるか
//   ms … 1コマの長さ（ミリ秒）／hit … ダメージが入るコマ（0から）
export const MOTION_ART = {
  '剣士': {
    m: { attack: { frames: 4, w: 278, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '戦士': {
    m: { attack: { frames: 4, w: 252, h: 258, ox: 11, oy: 34, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 306, h: 257, ox: 12, oy: 33, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '槍使い': {
    m: { attack: { frames: 4, w: 404, h: 224, ox: 12, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 330, h: 235, ox: 8, oy: 11, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '格闘家': {
    m: { attack: { frames: 4, w: 244, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 284, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '盗賊': {
    m: { attack: { frames: 4, w: 276, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 276, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '弓使い': {
    m: { attack: { frames: 4, w: 290, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 288, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '銃士': {
    m: { attack: { frames: 4, w: 268, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 292, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '魔法使い': {
    m: { attack: { frames: 4, w: 312, h: 256, ox: 0, oy: 32, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 286, h: 250, ox: 0, oy: 26, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '呪術師': {
    m: { attack: { frames: 4, w: 298, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 292, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '僧侶': {
    m: { attack: { frames: 4, w: 298, h: 252, ox: 0, oy: 28, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 272, h: 243, ox: 0, oy: 19, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '薬師': {
    m: { attack: { frames: 4, w: 300, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
    f: { attack: { frames: 4, w: 274, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '暗殺者': {
    f: { attack: { frames: 4, w: 244, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
}
