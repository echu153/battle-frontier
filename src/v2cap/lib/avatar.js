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
//   正方形に切り取る表示では頭から腰までしか入らなかった）→「全身・全部のモーションはいるようにしてほしい」
//   →「やっぱ女暗殺者と同じ大きさにしたい、これだとちっちゃすぎる」（全部のコマを正方形に入れると、斧を頭の上まで振り上げる
//   戦士男は構えの姿が枠の高さの6割まで小さくなった）：
//   ・大きさは「ふだんの姿」（8割のコマが入る範囲＝AVATAR_MAIN_SHARE）が正方形の枠いっぱいに入るように決める＝暗殺者女と同じ大きさ
//   ・ふだんの姿からはみ出す動き（振り上げた斧）は、そのぶん枠を縦に伸ばして入れる（伸ばせるのは maxH まで。ホームは横の文字の列の高さまで）
//     伸ばせないところ（プロフィールの一覧の正方形など）ははみ出したところが切れる
//   ・透明なところが無い画像（写真など）は今までどおり正方形に切り取る
//   ・見える部分が分からない（読めない）ときは画像全体を入れる
//   画像を読んで見える部分を調べるのは components/V2capAvatar.jsx。ここは数えるところだけ
// ------------------------------------------------------------
export const AVATAR_ALPHA_MIN = 24   // これより薄い点は見えないものとして扱う（ふちのにじみ）
export const AVATAR_PAD = 0.04       // ふだんの姿のまわりの余白（長い辺に対して・片側）
export const AVATAR_MAIN_SHARE = 0.8 // ふだんの姿＝このわりあいのコマが入る範囲

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

// コマごとの結果（[{ w, h, box, opaque }]）をまとめる → { w, h, box＝全部のコマを合わせた範囲, main＝ふだんの姿, opaque }
//   ふだんの姿は上下左右の辺ごとに「8割のコマがその内側に入る」ところ（振り上げた斧のような一瞬の動きは入れない）
export const lookOfFrames = (frames) => {
  if (!frames.length) return null
  const { w, h } = frames[0]
  const opaque = frames.every(f => f.opaque)
  const boxes = frames.map(f => f.box).filter(Boolean)
  if (!boxes.length) return { w, h, box: null, main: null, opaque }
  const k = Math.floor(boxes.length * (1 - AVATAR_MAIN_SHARE))
  const edge = (vals, outward) => [...vals].sort((a, b) => outward(a, b))[k]  // 外側から k 個めの値
  const lows = (get) => edge(boxes.map(get), (a, b) => a - b)   // 上・左の辺（小さいほど外側）
  const highs = (get) => edge(boxes.map(get), (a, b) => b - a)  // 下・右の辺（大きいほど外側）
  const span = (x0, y0, x1, y1) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  const box = span(Math.min(...boxes.map(b => b.x)), Math.min(...boxes.map(b => b.y)),
    Math.max(...boxes.map(b => b.x + b.w)), Math.max(...boxes.map(b => b.y + b.h)))
  const main = span(lows(b => b.x), lows(b => b.y), highs(b => b.x + b.w), highs(b => b.y + b.h))
  return { w, h, box, main, opaque }
}

// 枠の中に置く画像の大きさと位置（px）。look＝{ w, h, box, main, opaque }（main が無ければ box をふだんの姿にする）
//   枠の幅は size。高さ boxH は size から、ふだんの姿からはみ出す動きのぶんだけ maxH まで伸びる
//   pixel＝2倍以上に広げるとき（小さいドット絵）。にじませずに点のまま広げる
export const avatarFitOf = (look, size, maxH = size) => {
  const { w, h, box, opaque } = look
  const main = look.main || box
  const square = (scale, cx, cy) => ({ width: w * scale, height: h * scale, left: size / 2 - cx * scale, top: size / 2 - cy * scale, boxH: size, pixel: scale >= 2 })
  if (opaque) return square(size / Math.min(w, h), w / 2, h / 2)
  if (!main) return square(size / Math.max(w, h), w / 2, h / 2)
  const side = Math.max(main.w, main.h) * (1 + AVATAR_PAD * 2)
  const scale = size / side
  const cx = main.x + main.w / 2, cy = main.y + main.h / 2
  // ふだんの姿の正方形（画像の中の位置）から、全部のコマの範囲が上・下にはみ出すぶん（px）。はみ出すときは余白も足す
  const sqTop = cy - side / 2, sqBottom = cy + side / 2
  const room = Math.max(0, maxH - size)
  const over = (px) => (px > 0 ? px + size * AVATAR_PAD : 0)
  const up = Math.min(room, over((sqTop - (box ? box.y : sqTop)) * scale))
  const down = Math.min(room - up, over(((box ? box.y + box.h : sqBottom) - sqBottom) * scale))
  return { width: w * scale, height: h * scale, left: size / 2 - cx * scale, top: up - sqTop * scale, boxH: size + up + down, pixel: scale >= 2 }
}
