// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— アイコン（ステータスの左上の画像）
// ------------------------------------------------------------
// 【確定】2026-10-11 ユーザー指示「自分で設定できるように」（今のⅡのような見た目にするときに）：
//   ・画像は avatars バケット（旧版・今のⅡと同じ置き場）。用意された8枚から選ぶか、自分の画像をアップロードする
//   ・アップロードは**無料**（今のⅡは100Gold。こちらで決めた既定）・2MBまで・画像ファイルだけ
//   ・持つのはバケットの中の場所（例 warrior1.png・<ユーザーID>/v2cap-1700000000.png）。画面がURLに直す
// ★サーバー（v2cap_set_avatar）は「用意された8枚」か「自分のフォルダの画像」だけを通す（他人の画像や外のURLは入れられない）。
//   判定はここと同じ（v2capsql.test.js が8枚の名前を突き合わせる）
// ============================================================
export const AVATAR_PRESETS = [
  { file:'warrior1.png', label:'戦士①' },
  { file:'knight1.png',  label:'騎士' },
  { file:'samurai.png',  label:'侍' },
  { file:'hunter1.png',  label:'狩人①' },
  { file:'hunter2.png',  label:'狩人②' },
  { file:'wizard1.png',  label:'魔法使い①' },
  { file:'wizard2.png',  label:'魔法使い②' },
  { file:'priest.png',   label:'僧侶' },
]
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
// 自分のフォルダの中の名前（先頭は英数字・使える字は英数字と . _ -・100字まで）
export const AVATAR_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

// 選べる画像か（null は「外す」）
export const isAllowedAvatar = (path, uid) => {
  if (path === null) return true
  if (typeof path !== 'string') return false
  if (AVATAR_PRESETS.some(p => p.file === path)) return true
  const head = `${uid}/`
  return !!uid && path.startsWith(head) && AVATAR_FILE_RE.test(path.slice(head.length))
}

// アップロードするときの場所（自分のフォルダ・拡張子は英数字だけ）
export const uploadPathOf = (uid, fileName, now = Date.now()) => {
  const ext = (String(fileName || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png'
  return `${uid}/v2cap-${now}.${ext}`
}

// ------------------------------------------------------------
// 【確定】2026-10-21 ユーザー指示「体の大きさは画像1に統一して、モーション次第でその分上下が大きくなるようにできない？
//   上下の幅だけ増やしてもらえばできると思う」（画像1＝暗殺者女の待機GIF 224×224）：
//   ・アイコンの横幅は決まった大きさ（ホーム76px）のまま、画像の横幅をそこに合わせて縮める。縦長の画像は切らずに枠を縦に伸ばす
//     → 体の大きさは画像の作り方（横幅と体の描き方の大きさ）でそろえる。こちらで体の範囲を調べて合わせることはしない
//     （調べて合わせる仕組みは一度作ったが、ユーザーが「枠内に画像収めるように作るから前の状態に戻して」で戻した）
//   ・横長の画像は今までどおり正方形に切り取る（真ん中）
//   ・縦は横幅の AVATAR_MAX_TALL 倍まで（とても縦長の写真で並びが崩れないように）。越えたぶんは上を切る（足元は残す）
// ------------------------------------------------------------
export const AVATAR_MAX_TALL = 2

// アイコンの <img> の大きさ（size＝横幅 px）
export const avatarImgStyle = (size) => ({
  width: `${size}px`, height: 'auto', minHeight: `${size}px`, maxHeight: `${size * AVATAR_MAX_TALL}px`,
  objectFit: 'cover', objectPosition: 'center bottom', display: 'block', flexShrink: 0,
})
