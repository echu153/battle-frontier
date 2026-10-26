// tools/v2cap-motion.mjs が書くファイル（手で直さない）。クラス → 男女 → 動き → コマの数・1コマの大きさ・ずらし・速さ
//   frames … コマの数／w・h … 1コマの大きさ（px）／ox・oy … 待機GIF（224×224）の左上が1コマの中のどこにあるか
//   ms … 1コマの長さ（ミリ秒）／hit … ダメージが入るコマ（0から）
export const MOTION_ART = {
  '剣士': {
    m: { attack: { frames: 4, w: 278, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
  '暗殺者': {
    f: { attack: { frames: 4, w: 244, h: 224, ox: 0, oy: 0, ms: [100, 100, 180, 120], hit: 2 } },
  },
}
