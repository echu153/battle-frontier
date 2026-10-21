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
// 【確定】2026-10-21 ユーザー指示「暗殺者女みたいに全身反映されるようにしたい」（戦士男の待機GIF＝256×480 の縦長で上半分が空白。
//   正方形に切り取る表示では頭から腰までしか入らなかった）：
//   ・透明なところがある画像は、見える部分（動く画像は全部のコマを合わせた範囲）が枠いっぱいに入るように縮めて真ん中に置く
//     全部のコマ＝ユーザー指示「全身・全部のモーションはいるようにしてほしい」（戦士男は斧を頭の上まで振り上げるコマがある。
//     構えの姿が大きく出る「8割のコマが入る範囲」の案もあったが、振り上げた斧が切れるので選ばれなかった）
//   ・透明なところが無い画像（写真など）は今までどおり正方形に切り取る
//   ・見える部分が分からない（読めない）ときは画像全体を入れる
//   画像を読んで見える部分を調べるのは components/V2capAvatar.jsx。ここは数えるところだけ
// ------------------------------------------------------------
export const AVATAR_ALPHA_MIN = 24  // これより薄い点は見えないものとして扱う（ふちのにじみ）
export const AVATAR_PAD = 0.04      // 見える部分のまわりの余白（長い辺に対して・片側）

// 1コマの見える部分（RGBA の並び）。box は全部透明なら null。opaque＝透明なところが無い
export const visibleBoxOf = (data, w, h) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, opaque = true
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]
      if (a < 250) opaque = false
      if (a < AVATAR_ALPHA_MIN) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, opaque }
}

// 2つのコマの結果を合わせる（{ w, h, box, opaque }。片方が null ならもう片方）
export const mergeLook = (a, b) => {
  if (!a) return b
  if (!b) return a
  const box = !a.box ? b.box : !b.box ? a.box : (() => {
    const x = Math.min(a.box.x, b.box.x), y = Math.min(a.box.y, b.box.y)
    return { x, y, w: Math.max(a.box.x + a.box.w, b.box.x + b.box.w) - x, h: Math.max(a.box.y + a.box.h, b.box.y + b.box.h) - y }
  })()
  return { w: a.w, h: a.h, box, opaque: a.opaque && b.opaque }
}

// 枠（size×size）の中に置く画像の大きさと位置（px）。look＝{ w, h, box, opaque }（画像の大きさと見える部分）
//   pixel＝2倍以上に広げるとき（小さいドット絵）。にじませずに点のまま広げる
export const avatarFitOf = (look, size) => {
  const { w, h, box, opaque } = look
  const place = (scale, cx, cy) => ({ width: w * scale, height: h * scale, left: size / 2 - cx * scale, top: size / 2 - cy * scale, pixel: scale >= 2 })
  if (opaque) return place(size / Math.min(w, h), w / 2, h / 2)
  if (!box) return place(size / Math.max(w, h), w / 2, h / 2)
  const side = Math.max(box.w, box.h) * (1 + AVATAR_PAD * 2)
  return place(size / side, box.x + box.w / 2, box.y + box.h / 2)
}
