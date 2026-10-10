// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— クラスのイラスト（男女）
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「イラスト入れちゃった、名前で判断して。男女それぞれのイラストを用意してるから、良い感じに見えるようにして」
//   ・元の絵は public/V2newjob/<ローマ字のクラス名><otoko|onna|onnna>.png（ユーザーが置く。透明な背景・1086×1448 など）
//   ・画面では軽くした版を使う（tools/v2cap-art.mjs が作る）：
//       public/V2newjob/web/<名前>-m.webp・-f.webp（詳細の大きい絵・幅720）
//       public/V2newjob/thumb/<名前>-m.webp・-f.webp（一覧の小さい絵・幅240）
//   ・男女どちらを見せるかは画面で切り替え、端末で覚えておく
// 名前の読み（ユーザーのファイル名から判断）：
//   sensi＝戦士（斧の絵。もう一組の「戦士男・sennsionnna」は背景つき・大剣で作りが違うので使っていない＝ユーザーに確認中）
//   sisai＝僧侶（白い法衣・杖と聖書の回復役。初期クラスで絵が無いのが僧侶だけなので僧侶に当てた＝ユーザーに確認中）
// ★絵が無いクラス（剣士・一次クラス）は「イラスト準備中」。絵を足したら ART_BASE に足して `node tools/v2cap-art.mjs` を回す
// ============================================================
export const ART_BASE = {
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
export const ART_GENDERS = [
  { key:'m', label:'男性', mark:'♂', color:'#66aaff', src:['otoko'] },
  { key:'f', label:'女性', mark:'♀', color:'#ff88bb', src:['onna', 'onnna'] },   // ユーザーのファイル名に onna と onnna の両方がある
]
export const ART_DIR = '/V2newjob'
export const hasArt = (cls) => !!ART_BASE[cls]
// 表示に使う絵の場所（無いクラスは null）。size は 'web'（詳細）か 'thumb'（一覧）
export const artSrcOf = (cls, gender = 'm', size = 'web') => {
  const base = ART_BASE[cls]
  if (!base) return null
  const g = ART_GENDERS.some(x => x.key === gender) ? gender : 'm'
  return `${ART_DIR}/${size === 'thumb' ? 'thumb' : 'web'}/${base}-${g}.webp`
}
