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
// ★絵が無いクラス（一次クラス）は「イラスト準備中」。絵を足したら ART_BASE と ART_FACE に足して `node tools/v2cap-art.mjs` を回す
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
// 一覧の顔のアップの切り取り（tools/v2cap-art.mjs だけが使う）。
// [顔の中心の横位置, 縦位置, 切り取る正方形の一辺]。どれも元の絵の幅・高さに対する割合（一辺は幅に対する割合）
export const ART_FACE = {
  kensi:      { m:[0.535, 0.108, 0.24], f:[0.659, 0.123, 0.24] },
  sensi:      { m:[0.494, 0.094, 0.24], f:[0.720, 0.170, 0.24] },
  yaritukai:  { m:[0.548, 0.124, 0.24], f:[0.445, 0.158, 0.24] },
  kakutouka:  { m:[0.675, 0.140, 0.24], f:[0.586, 0.168, 0.24] },
  touzoku:    { m:[0.290, 0.162, 0.24], f:[0.373, 0.138, 0.24] },
  yumitukai:  { m:[0.426, 0.120, 0.24], f:[0.586, 0.117, 0.24] },
  zyuusi:     { m:[0.655, 0.118, 0.24], f:[0.634, 0.101, 0.24] },
  mahoutukai: { m:[0.428, 0.110, 0.24], f:[0.537, 0.100, 0.24] },
  zyuzyutusi: { m:[0.450, 0.096, 0.24], f:[0.552, 0.111, 0.24] },
  sisai:      { m:[0.49,  0.128, 0.24], f:[0.497, 0.124, 0.24] },
  yakusi:     { m:[0.474, 0.108, 0.24], f:[0.481, 0.139, 0.24] },
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
