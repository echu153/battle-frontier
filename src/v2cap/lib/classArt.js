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
  kensi:      { m:[0.545, 0.101, 0.531, 0.142], f:[0.673, 0.117, 0.656, 0.159] },
  sensi:      { m:[0.497, 0.079, 0.502, 0.133], f:[0.721, 0.167, 0.714, 0.213] },
  yaritukai:  { m:[0.620, 0.129, 0.606, 0.171], f:[0.434, 0.148, 0.424, 0.190] },
  kakutouka:  { m:[0.672, 0.129, 0.671, 0.182], f:[0.585, 0.163, 0.561, 0.204] },
  touzoku:    { m:[0.273, 0.160, 0.288, 0.212], f:[0.365, 0.126, 0.379, 0.170] },
  yumitukai:  { m:[0.424, 0.124, 0.424, 0.164], f:[0.598, 0.103, 0.595, 0.147] },
  zyuusi:     { m:[0.670, 0.108, 0.662, 0.154], f:[0.634, 0.093, 0.616, 0.138] },
  mahoutukai: { m:[0.416, 0.100, 0.434, 0.142], f:[0.528, 0.098, 0.519, 0.141] },
  zyuzyutusi: { m:[0.463, 0.094, 0.482, 0.137], f:[0.549, 0.095, 0.543, 0.143] },
  sisai:      { m:[0.487, 0.124, 0.497, 0.163], f:[0.487, 0.118, 0.506, 0.166] },
  yakusi:     { m:[0.471, 0.099, 0.490, 0.148], f:[0.477, 0.132, 0.472, 0.176] },
}
// ★男性の絵は 2026-10-11 にユーザーが描き直した版へ差し替えた（盗賊だけ前のまま）。差し替えたら目印も測り直す
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

// ===== デフォルメ（SD）の絵 ＝ 戦闘ログの自分のアイコン =====
// 【確定】2026-10-12 ユーザー指示「自分のアイコンは職業イラストをデフォルメしたキャラを入れる予定」
//   ・元の絵：public/V2newjob/SD/SD<クラス名><男|女>.png（ユーザーが置く・透明な背景）。⚠git に入れない（.gitignore）
//   ・画面で使う版：public/V2newjob/icon/<ローマ字>-<m|f>.webp（体がちょうど収まる正方形・192×192）。作るのは tools/v2cap-art.mjs
//     ★フォルダ名を sd にしないこと（Windows は大文字小文字を区別しないので SD と同じフォルダになる）
//   ・作れたものを ART_SD に足す（ツールが「足りない」と知らせる。classArt.test.js が突き合わせる）
//   ・SDの絵がまだ無いクラスは、一覧の顔のアップ（face）で代わりに出す（battleIconOf）
// 2026-10-12 初期11職の男女22枚（どれも全身の絵と見比べた）。一次職はまだ
export const ART_SD = {
  剣士: ['m', 'f'],
  戦士: ['m', 'f'],
  槍使い: ['m', 'f'],
  格闘家: ['m', 'f'],
  盗賊: ['m', 'f'],
  弓使い: ['m', 'f'],
  銃士: ['m', 'f'],
  魔法使い: ['m', 'f'],
  呪術師: ['m', 'f'],
  僧侶: ['m', 'f'],
  薬師: ['m', 'f'],
}
export const SD_DIR = 'SD'          // public/V2newjob の下・元の絵
export const SD_OUT = 'icon'        // public/V2newjob の下・画面で使う版
// 名前どおりに読まないファイル名 → [クラス, 'm'|'f']（絵を見て確かめたものだけ）。null は「確かめ中なので使わない」
// ⚠ファイル名のクラスと絵が違うことがある。足したら必ず神殿の全身の絵（web）と見比べる
//   2026-10-12 剣士の2枚が最初「SD戦士.png」「SD戦士女.png」の名前で届き、のちにユーザーが「SD剣士」に直した
//   （「SD戦士女.png」はそのあと斧の戦士の絵に入れ替わった）
export const SD_ALIAS = {
  'SD剣士': ['剣士', 'm'],   // 男女の字が無い。絵は剣士の男性（全身の絵と見比べた）
}
// SDのファイル名（拡張子なし）→ { cls, g }。g は男女が書いていなければ null。クラスが読めなければ null。
// 確かめ中（SD_ALIAS が null）は { hold: true }
export const sdTargetOf = (stem) => {
  if (stem in SD_ALIAS) {
    const alias = SD_ALIAS[stem]
    return alias ? { cls: alias[0], g: alias[1] } : { hold: true }
  }
  const m = String(stem ?? '').normalize('NFKC').match(/^SD(.+?)(男|女)?$/i)
  if (!m || !ART_BASE[m[1]]) return null
  return { cls: m[1], g: m[2] === '男' ? 'm' : m[2] === '女' ? 'f' : null }
}
export const sdSrcOf = (cls, gender = 'm') => (ART_SD[cls]?.includes(gender) ? `${ART_DIR}/${SD_OUT}/${ART_BASE[cls]}-${gender}.webp` : null)
// 戦闘ログの自分のアイコン：SDの絵 → 無ければ顔のアップ → 絵の無いクラスは null（画面は名前の1文字目の枠）
// gender は神殿の「♂ 男性／♀ 女性」の切り替え（端末で覚えている capArtGender）
export const battleIconOf = (cls, gender = 'm') => {
  const g = ART_GENDERS.some(x => x.key === gender) ? gender : 'm'
  return sdSrcOf(cls, g) || artSrcOf(cls, g, 'face')
}
// 表示に使う絵の場所（無いクラスは null）。size は 'web'（詳細の全身）か 'face'（一覧の顔のアップ）
export const artSrcOf = (cls, gender = 'm', size = 'web') => {
  const base = ART_BASE[cls]
  if (!base) return null
  const g = ART_GENDERS.some(x => x.key === gender) ? gender : 'm'
  return `${ART_DIR}/${ART_SIZES.includes(size) ? size : 'web'}/${base}-${g}.webp`
}
