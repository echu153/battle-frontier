// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— クラスのイラスト（男女）
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「イラスト入れちゃった、名前で判断して。男女それぞれのイラストを用意してるから、良い感じに見えるようにして」
//   ・元の絵は public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png（ユーザーが置く。どれも透明な背景）
//   ・画面では軽くした版を使う（tools/v2cap-art.mjs が作る）：
//       public/V2newjob/web/<名前>-m.webp・-f.webp（詳細の大きい絵・全身・幅720）
//       public/V2newjob/face/<名前>-m.webp・-f.webp（一覧の小さい絵・顔のまわりだけ・192×192）
//     【確定】2026-10-11 ユーザー指示「職業選択するときは顔の周りだけアップするだけでいい」→ 一覧は全身をやめて顔のアップ
//   ・男女どちらを見せるかは画面で切り替え、端末で覚えておく
// 名前の読み（ユーザーのファイル名から判断・確かめ済み）：
//   sisai＝僧侶（ユーザー「sisaiは僧侶でOK」）
//   kensi＝剣士（ユーザー「戦士男とsennsionnnaは剣士用」→ ほかに合わせて kensiotoko.png・kensionna.png に改名した）
//   ⚠剣士の2枚も透明な背景（透明なところに隠れた色が残っているだけ）。透明を無視する見方だと背景つきに見えるので、
//     背景の有無はマゼンタの上に重ねて確かめる。透明が消えた版を作ると classArt.test.js が落ちる
// ★絵が無いクラス（一次クラス）は「イラスト準備中」。絵を足したら ART_BASE と ART_FACE（顔の目印）に足して `node tools/v2cap-art.mjs` を回す
// ============================================================
export const ART_BASE = {
  剣士: 'kensi',
  戦士: 'sensi',
  槍使い: 'yaritukai',
  格闘家: 'kakutouka',
  盗賊: 'touzoku',
  弓使い: 'yumitukai',
  銃士: 'zyuusi',
  魔法使い: 'mahoutukai',
  呪術師: 'zyuzyutusi',
  僧侶: 'sisai',
  薬師: 'yakusi',
}
// 一覧の顔のアップ（tools/v2cap-art.mjs だけが使う）。
// 【確定】2026-10-11 ユーザー指示「男のイラストの顔アップの大きさが統一されてなくて空白が気になる。もっと全体統一して」
//   → 切り取りを絵の幅で決めるのをやめ、顔そのものの大きさに合わせる。顔の目印を1枚ずつ測って置き、
//     どの顔も「目の高さ」と「目〜あごの長さ」が同じになるように切り取る（FACE_FIT）
// ART_FACE … [両目のまんなかの横, 縦, あごの横, 縦]。どれも元の絵の幅・高さに対する割合（拡大図で測った）
export const ART_FACE = {
  kensi:      { m:[0.549, 0.102, 0.533, 0.141], f:[0.673, 0.117, 0.656, 0.159] },
  sensi:      { m:[0.507, 0.081, 0.507, 0.130], f:[0.721, 0.167, 0.714, 0.213] },
  yaritukai:  { m:[0.555, 0.125, 0.548, 0.168], f:[0.434, 0.148, 0.424, 0.190] },
  kakutouka:  { m:[0.675, 0.130, 0.670, 0.176], f:[0.585, 0.163, 0.561, 0.204] },
  touzoku:    { m:[0.273, 0.160, 0.288, 0.212], f:[0.365, 0.126, 0.379, 0.170] },
  yumitukai:  { m:[0.425, 0.126, 0.413, 0.171], f:[0.598, 0.103, 0.595, 0.147] },
  zyuusi:     { m:[0.645, 0.110, 0.637, 0.162], f:[0.634, 0.093, 0.616, 0.138] },
  mahoutukai: { m:[0.427, 0.101, 0.442, 0.140], f:[0.528, 0.098, 0.519, 0.141] },
  zyuzyutusi: { m:[0.454, 0.096, 0.475, 0.137], f:[0.549, 0.095, 0.543, 0.143] },
  sisai:      { m:[0.483, 0.125, 0.501, 0.168], f:[0.487, 0.118, 0.506, 0.166] },
  yakusi:     { m:[0.465, 0.098, 0.486, 0.149], f:[0.477, 0.132, 0.472, 0.176] },
}
// 顔のアップの写し方（切り取る正方形に対する割合）：目の高さ eyeAt・目〜あごの長さ eyeToChin。
// 左右は「両目のまんなか」と「あご」の中間を真ん中に。顔をもっと大きく見せたいときは eyeToChin を上げる
export const FACE_FIT = { eyeAt: 0.40, eyeToChin: 0.38 }
// 顔の目印から切り取る正方形（元の絵のピクセル）を出す：{ x, y, size }（x・y は左上）
export const faceCropOf = ([ex, ey, cx, cy], w, h, fit = FACE_FIT) => {
  const len = Math.hypot((cx - ex) * w, (cy - ey) * h)
  const size = len / fit.eyeToChin
  const midX = (ex + cx) / 2 * w
  return { x: midX - size / 2, y: ey * h - fit.eyeAt * size, size }
}
export const ART_GENDERS = [
  { key:'m', label:'男性', mark:'♂', color:'#66aaff', src:['otoko'] },
  { key:'f', label:'女性', mark:'♀', color:'#ff88bb', src:['onna', 'onnna'] },   // ユーザーのファイル名に onna と onnna の両方がある
]
export const ART_DIR = '/V2newjob'
export const ART_SIZES = ['web', 'face']
export const hasArt = (cls) => !!ART_BASE[cls]
// 表示に使う絵の場所（無いクラスは null）。size は 'web'（詳細の全身）か 'face'（一覧の顔のアップ）
export const artSrcOf = (cls, gender = 'm', size = 'web') => {
  const base = ART_BASE[cls]
  if (!base) return null
  const g = ART_GENDERS.some(x => x.key === gender) ? gender : 'm'
  return `${ART_DIR}/${ART_SIZES.includes(size) ? size : 'web'}/${base}-${g}.webp`
}
