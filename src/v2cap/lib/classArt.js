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
// 【確定】2026-10-17 ユーザー「上位職のイラスト用意した」→ 上位クラス22職×男女の44枚を足した（全クラスに絵がある）
//   ・元の絵は public/V2newjob/上位職/<クラス名><男|女>.png（ユーザーが置く・1枚約3MB×44枚）。⚠git に入れない（.gitignore）
//   ・名前どおりに読めないファイルは ART_SRC_ALIAS（男女の字が無い「体術師.png」＝男性・顔を見て確かめた）。「霊薬師otoko.png」は otoko で読む
//   ・5枚は背景が白いまま（透明が無い）→ ツールが背景を抜く（ART_KEYED・抜いた絵はマゼンタと暗い色の上で確かめた）
// ★絵が無いクラスは「イラスト準備中」。絵を足したら ART_BASE と ART_FACE（顔の目印）に足して `node tools/v2cap-art.mjs` を回す
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
  // 上位クラス（2026-10-17）。ローマ字は初期クラスと同じ書き方（じ＝zi・つ＝tu・し＝si・ちゃ＝tya）
  侍: 'samurai',
  魔法剣士: 'mahoukensi',
  狂戦士: 'kyousensi',
  聖騎士: 'seikisi',
  竜騎士: 'ryuukisi',
  ストームランサー: 'sutoomuransaa',
  体術師: 'taizyutusi',
  サイキッカー: 'saikikkaa',
  暗殺者: 'ansatusya',
  忍者: 'ninzya',
  狩人: 'kariudo',
  アークアーチャー: 'aakuaatyaa',
  魔銃士: 'mazyuusi',
  デストロイヤー: 'desutoroiyaa',
  元素使い: 'gensotukai',
  クロノマンサー: 'kuronomansaa',
  死霊使い: 'sireitukai',
  式神使い: 'sikigamitukai',
  聖職者: 'seisyokusya',
  異端審問官: 'itansinmonkan',
  アルケミスト: 'arukemisuto',
  霊薬師: 'reiyakusi',
}
// 上位クラスの元の絵のフォルダ（public/V2newjob の下）。ファイル名はクラス名そのまま：<クラス名><男|女>.png
export const ART_UPPER_DIR = '上位職'
// 名前どおりに読めない元の絵 → 'クラス:m|f' ごとの候補（public/V2newjob からの道）。絵を見て確かめたものだけ
export const ART_SRC_ALIAS = {
  '体術師:m': ['上位職/体術師.png'],   // 男女の字が無い。絵は男性（顔を見て確かめた）
}
// 背景が白いまま届いた元の絵（透明が無い）。ツールが背景を抜いて使う（tools/v2cap-art-lib.mjs の keyBackground）。
// ⚠抜いた絵をマゼンタと暗い色の上で確かめてから足す（白い服・白い布まで抜けていないか）。ここに無い透明なしの絵はツールが止める
export const ART_KEYED = ['侍:f', '狂戦士:m', '狂戦士:f', '魔法剣士:m', '魔法剣士:f']
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
  // 上位クラス（2026-10-17・目盛りつきの拡大図で測り、目とあごに点を打った図で確かめた）
  samurai:       { m:[0.631, 0.091, 0.624, 0.133], f:[0.555, 0.120, 0.570, 0.158] },
  mahoukensi:    { m:[0.515, 0.087, 0.530, 0.131], f:[0.458, 0.107, 0.466, 0.147] },
  kyousensi:     { m:[0.534, 0.101, 0.523, 0.146], f:[0.680, 0.144, 0.683, 0.199] },
  seikisi:       { m:[0.472, 0.229, 0.474, 0.271], f:[0.529, 0.379, 0.535, 0.408] },
  ryuukisi:      { m:[0.514, 0.241, 0.512, 0.279], f:[0.351, 0.197, 0.354, 0.232] },
  sutoomuransaa: { m:[0.605, 0.294, 0.608, 0.341], f:[0.500, 0.227, 0.514, 0.266] },
  taizyutusi:    { m:[0.314, 0.302, 0.316, 0.338], f:[0.588, 0.329, 0.613, 0.366] },
  saikikkaa:     { m:[0.621, 0.106, 0.610, 0.152], f:[0.573, 0.151, 0.598, 0.189] },
  ansatusya:     { m:[0.614, 0.255, 0.615, 0.300], f:[0.593, 0.086, 0.585, 0.131] },
  ninzya:        { m:[0.441, 0.278, 0.452, 0.322], f:[0.568, 0.290, 0.570, 0.333] },
  kariudo:       { m:[0.537, 0.252, 0.540, 0.296], f:[0.794, 0.205, 0.805, 0.253] },
  aakuaatyaa:    { m:[0.414, 0.237, 0.416, 0.272], f:[0.463, 0.224, 0.455, 0.261] },
  mazyuusi:      { m:[0.640, 0.093, 0.648, 0.131], f:[0.489, 0.158, 0.498, 0.195] },
  desutoroiyaa:  { m:[0.576, 0.070, 0.569, 0.116], f:[0.381, 0.154, 0.378, 0.201] },
  gensotukai:    { m:[0.486, 0.263, 0.496, 0.296], f:[0.557, 0.219, 0.561, 0.254] },
  kuronomansaa:  { m:[0.512, 0.144, 0.516, 0.177], f:[0.518, 0.156, 0.524, 0.196] },
  sireitukai:    { m:[0.481, 0.118, 0.500, 0.154], f:[0.485, 0.145, 0.510, 0.177] },
  sikigamitukai: { m:[0.615, 0.197, 0.604, 0.239], f:[0.533, 0.141, 0.550, 0.175] },
  seisyokusya:   { m:[0.605, 0.252, 0.604, 0.286], f:[0.532, 0.215, 0.554, 0.255] },
  itansinmonkan: { m:[0.618, 0.186, 0.632, 0.221], f:[0.594, 0.125, 0.589, 0.170] },
  arukemisuto:   { m:[0.512, 0.109, 0.520, 0.151], f:[0.527, 0.170, 0.572, 0.220] },
  reiyakusi:     { m:[0.568, 0.143, 0.560, 0.180], f:[0.469, 0.091, 0.497, 0.138] },
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
  { key:'m', label:'男性', mark:'♂', color:'#66aaff', src:['otoko'], kanji:'男' },
  { key:'f', label:'女性', mark:'♀', color:'#ff88bb', src:['onna', 'onnna'], kanji:'女' },   // ユーザーのファイル名に onna と onnna の両方がある
]
// 元の絵の候補（public/V2newjob からの道・先にあるものを使う。tools/v2cap-art.mjs だけが使う）：
//   初期クラス <ローマ字><otoko|onna|onnna>.png ／ 上位クラス 上位職/<クラス名><男|女>.png（otoko・onna でも可）／ ART_SRC_ALIAS
export const artSrcFilesOf = (cls, gender) => {
  const base = ART_BASE[cls], g = ART_GENDERS.find(x => x.key === gender)
  if (!base || !g) return []
  return [
    ...g.src.map(s => `${base}${s}.png`),
    ...[g.kanji, ...g.src].map(s => `${ART_UPPER_DIR}/${cls}${s}.png`),
    ...(ART_SRC_ALIAS[`${cls}:${gender}`] || []),
  ]
}
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
// 2026-10-12 初期11職の男女22枚（どれも全身の絵と見比べた）。上位職はまだ（＝戦闘ログは顔のアップ・塔は系統の初期職のSD＝tower.js の iconClassOf）
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

// ===== 待機の動く絵（GIF）＝ ホームの自分のアイコン =====
// 【確定】2026-10-22 ユーザー指示「初期クラスのギフ画像全員分作った、ホーム画面の画像はすべて対応するgif画像になるようにして、
//   自分の画像は一旦廃止」（自分でアップロードする画像は lib/avatar.js の AVATAR_CUSTOM_ON で止めた）：
//   ・元の絵：public/V2newjob/ギフ/<クラス名><男|女>待機.gif（ユーザーが置く・224×224・透明な背景）。⚠git に入れない（.gitignore）
//     体の大きさはユーザーが画像の作り方でそろえる（2026-10-21「体の大きさは画像1に統一」。画面は横幅を決めて縦長なら縦に伸ばすだけ＝avatarImgStyle）
//   ・画面で使う版：public/V2newjob/gif/<ローマ字>-<m|f>.gif（元のまま写す＝コマも透明もそのまま。作るのは tools/v2cap-art.mjs）
//   ・作れたものを ART_GIF に足す（ツールが「足りない」と知らせる。classArt.test.js が突き合わせる）
//   ・GIF が無いクラスは系統の初期クラスの GIF（塔のアイコンの iconClassOf と同じ考え方）。それも無ければ戦闘ログのアイコン（2026-10-26 から全クラスにある）
// 2026-10-22 初期11職の男女22枚＋暗殺者の女性1枚（1コマ目を並べて、ファイル名どおりの職業・男女か見た）
// 【確定】2026-10-26 ユーザー指示「上位職の待機ギフもすべて作った置き換えて、おれおれおの暗殺者だけ今のままでいいかも」
//   → 上位クラス22職×男女（元の絵は public/V2newjob/上位職/上位ギフ/<クラス名><男|女>.gif）。暗殺者の女性だけは前の絵のまま
//   （新しい「暗殺女.gif」は使わない＝GIF_ALIAS で null。前の「暗殺者女待機.gif」も同じフォルダに移っている）
export const ART_GIF = Object.fromEntries(Object.keys(ART_BASE).map(cls => [cls, ['m', 'f']]))
export const GIF_DIR = 'ギフ'       // public/V2newjob の下・元の絵（初期クラス）
export const GIF_UPPER_DIR = `${ART_UPPER_DIR}/上位ギフ`  // public/V2newjob の下・元の絵（上位クラス・2026-10-26）
export const GIF_OUT = 'gif'        // public/V2newjob の下・画面で使う版
// ユーザーのファイル名での職業の呼び方 → ゲームの職業名
export const GIF_CLASS_ALIAS = {
  銃使い: '銃士',
  あるけみすと: 'アルケミスト',
  クロノマスター: 'クロノマンサー',  // 「クロノマスター男.gif」（女性は「クロノマンサー女.gif」）
  暗殺: '暗殺者',
  死霊術師: '死霊使い',
}
// 名前どおりに読まないファイル名（拡張子なし）→ [クラス, 'm'|'f']（絵を見て確かめたものだけ）。null は使わない
export const GIF_ALIAS = {
  '戦士待機': ['戦士', 'm'],     // 斧の男性（女性は「戦士女待機」）
  '槍使い待機': ['槍使い', 'm'], // 槍の男性（女性は「槍使い女待機」）
  '暗殺女': null,               // 暗殺者の女性は前の「暗殺者女待機.gif」のまま（2026-10-26 ユーザー「おれおれおの暗殺者だけ今のままでいい」）
}
// GIF のファイル名（拡張子なし）→ { cls, g }。g は男女が書いていなければ null。クラスが読めなければ null。使わないものは { hold: true }
//   「待機」は付いていてもいなくてもよい（ユーザーのファイル名に両方ある：呪術師男.gif・魔法使い女.gif）
export const gifTargetOf = (stem) => {
  if (stem in GIF_ALIAS) return GIF_ALIAS[stem] ? { cls: GIF_ALIAS[stem][0], g: GIF_ALIAS[stem][1] } : { hold: true }
  const m = String(stem ?? '').normalize('NFKC').replace(/待機$/, '').match(/^(.+?)(男|女)?$/)
  const cls = m && (GIF_CLASS_ALIAS[m[1]] || m[1])
  if (!cls || !ART_BASE[cls]) return null
  return { cls, g: m[2] === '男' ? 'm' : m[2] === '女' ? 'f' : null }
}
export const gifSrcOf = (cls, gender = 'm') => (ART_GIF[cls]?.includes(gender) ? `${ART_DIR}/${GIF_OUT}/${ART_BASE[cls]}-${gender}.gif` : null)
// ホームの自分のアイコン：そのクラスの GIF → 系統の初期クラス（baseCls＝jobs.js の CLASS_BY_ID[cls].req.cls）の GIF → 戦闘ログのアイコン
export const homeIconOf = (cls, gender = 'm', baseCls = null) => {
  const g = ART_GENDERS.some(x => x.key === gender) ? gender : 'm'
  return gifSrcOf(cls, g) || (baseCls && gifSrcOf(baseCls, g)) || battleIconOf(cls, g)
}
