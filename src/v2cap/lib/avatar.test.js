// v2cap：アイコン（2026-10-11 ユーザー指示「自分で設定できるように」）の決まりを固定するテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_PRESETS, AVATAR_MAX_BYTES, AVATAR_FILE_RE, AVATAR_PAD, isAllowedAvatar, uploadPathOf, visibleBoxOf, lookOfFrames, avatarFitOf } from './avatar.js'

const UID = '11111111-2222-3333-4444-555555555555'

test('用意されたアイコンは今のⅡ・旧版と同じ8枚（avatars バケットの同じ名前）', () => {
  assert.deepEqual(AVATAR_PRESETS.map(p => p.file),
    ['warrior1.png', 'knight1.png', 'samurai.png', 'hunter1.png', 'hunter2.png', 'wizard1.png', 'wizard2.png', 'priest.png'])
  assert.equal(AVATAR_MAX_BYTES, 2 * 1024 * 1024, '2MBまで（今のⅡと同じ）')
})

test('選べるのは「用意された8枚」と「自分のフォルダの画像」だけ。他人の画像・外のURL・おかしな名前は通さない（サーバーと同じ判定）', () => {
  assert.equal(isAllowedAvatar(null, UID), true, '外す')
  assert.equal(isAllowedAvatar('warrior1.png', UID), true)
  assert.equal(isAllowedAvatar(`${UID}/v2cap-1700000000.png`, UID), true)
  assert.equal(isAllowedAvatar(`${UID}/1699999999999.jpg`, UID), true, '旧版・今のⅡで上げた画像も選べる')
  assert.equal(isAllowedAvatar('99999999-2222-3333-4444-555555555555/a.png', UID), false, '他人のフォルダ')
  assert.equal(isAllowedAvatar('https://example.com/a.png', UID), false, '外のURL')
  assert.equal(isAllowedAvatar(`${UID}/../warrior1.png`, UID), false, 'フォルダをさかのぼる')
  assert.equal(isAllowedAvatar(`${UID}/..`, UID), false)
  assert.equal(isAllowedAvatar(`${UID}/.hidden.png`, UID), false, '先頭が記号')
  assert.equal(isAllowedAvatar(`${UID}/a/b.png`, UID), false, 'フォルダの中のフォルダ')
  assert.equal(isAllowedAvatar(`${UID}/${'a'.repeat(101)}`, UID), false, '長すぎる名前')
  assert.equal(isAllowedAvatar('other.png', UID), false, '8枚以外の共通の画像')
  assert.equal(isAllowedAvatar(`${UID}/a.png`, ''), false, 'ログインしていない')
  assert.ok(AVATAR_FILE_RE.test('v2cap-1700000000.png'))
})

test('アップロードの場所は自分のフォルダ・拡張子は英数字だけ（サーバーの判定を通る形）', () => {
  assert.equal(uploadPathOf(UID, 'My Photo.PNG', 1700000000000), `${UID}/v2cap-1700000000000.png`)
  assert.equal(uploadPathOf(UID, 'x.jp<e>g', 1), `${UID}/v2cap-1.jpeg`)
  assert.equal(uploadPathOf(UID, 'noext', 1), `${UID}/v2cap-1.noext`)
  assert.equal(uploadPathOf(UID, '', 1), `${UID}/v2cap-1.png`)
  for (const name of ['a.png', 'b.JPEG', 'c.webp', 'weird.???']) {
    assert.equal(isAllowedAvatar(uploadPathOf(UID, name, 5), UID), true, name)
  }
})

// 2026-10-21 ユーザー指示「暗殺者女みたいに全身反映されるようにしたい」（戦士男の待機GIF＝256×480 の縦長で上半分が空白）
const rgba = (w, h, dots, base = 0) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 3; i < d.length; i += 4) d[i] = base
  for (const [x, y, a] of dots) d[(y * w + x) * 4 + 3] = a
  return d
}

test('見える部分＝透明でない点を囲む範囲（ふちの薄い点は数えない）・透明なところが無い画像は opaque', () => {
  assert.deepEqual(visibleBoxOf(rgba(6, 5, [[1, 2, 255], [4, 3, 200], [5, 0, 10]]), 6, 5), { box: { x: 1, y: 2, w: 4, h: 2 }, opaque: false })
  assert.deepEqual(visibleBoxOf(rgba(3, 3, []), 3, 3), { box: null, opaque: false }, '全部透明')
  assert.deepEqual(visibleBoxOf(rgba(3, 2, [], 255), 3, 2), { box: { x: 0, y: 0, w: 3, h: 2 }, opaque: true }, '写真など')
})

// 戦士男待機.gif の51コマ（ffmpeg で数えた見える範囲）。構えは y192/196〜475・6コマ（42〜47）は斧を頭の上まで振り上げて y24 から
const WARRIOR = Array.from({ length: 51 }, (_, i) => {
  const [x0, y0, x1] = i >= 44 && i <= 47 ? [32, 24, 223] : i >= 42 && i <= 43 ? [16, 24, 227] : i >= 40 && i <= 41 ? [16, 220, 227]
    : i >= 48 && i <= 49 ? [24, 164, 235] : [16, i % 8 < 4 ? 192 : 196, 235]
  return { w: 256, h: 480, box: { x: x0, y: y0, w: x1 - x0 + 1, h: 476 - y0 }, opaque: false }
})
// 暗殺者女待機.gif（224×224・45コマ）。動きが小さいのでふだんの姿と全部のコマの範囲はほぼ同じ
const ASSASSIN = { w: 224, h: 224, box: { x: 28, y: 16, w: 148, h: 204 }, main: { x: 30, y: 18, w: 144, h: 202 }, opaque: false }

test('コマをまとめる：全部のコマを合わせた範囲と、ふだんの姿（8割のコマが入る範囲＝一瞬の振り上げは入れない）', () => {
  const look = lookOfFrames(WARRIOR)
  assert.deepEqual(look.box, { x: 16, y: 24, w: 220, h: 452 }, '全部のコマ')
  assert.deepEqual(look.main, { x: 16, y: 192, w: 220, h: 284 }, 'ふだんの姿（構え）')
  const one = lookOfFrames([WARRIOR[0]])
  assert.deepEqual(one.main, one.box, '1コマだけなら同じ')
  assert.deepEqual(lookOfFrames([{ w: 3, h: 3, box: null, opaque: false }]), { w: 3, h: 3, box: null, main: null, opaque: false }, '全部透明')
  assert.equal(lookOfFrames([{ ...WARRIOR[0], opaque: true }, WARRIOR[1]]).opaque, false, '透明なコマが1つでもあれば opaque ではない')
})

test('戦士男（256×480・斧を振り上げる）は暗殺者女と同じ大きさ。ホームは振り上げた斧のぶん縦に伸ばして全部のコマが入る', () => {
  // ユーザー指示「やっぱ女暗殺者と同じ大きさにしたい、これだとちっちゃすぎる」＋「全身・全部のモーションはいるようにしてほしい」
  const look = lookOfFrames(WARRIOR)
  const fit = avatarFitOf(look, 76, 136)
  const s = fit.width / 256
  const mainPx = 284 * s, assassinPx = 202 * (avatarFitOf(ASSASSIN, 76, 136).width / 224)
  assert.ok(Math.abs(mainPx - assassinPx) < 0.01, `構えの姿の高さ ${mainPx.toFixed(1)}px＝暗殺者女 ${assassinPx.toFixed(1)}px`)
  assert.ok(Math.abs(mainPx - 76 / (1 + AVATAR_PAD * 2)) < 0.01, '正方形の枠いっぱい')
  const top = fit.top + 24 * s, bottom = fit.top + 476 * s, left = fit.left + 16 * s, right = fit.left + 236 * s
  assert.ok(top >= 0 && bottom <= fit.boxH && left >= 0 && right <= 76, '頭から足まで・振り上げた斧まで枠の中')
  assert.ok(fit.boxH > 76 && fit.boxH <= 136, `縦に伸びる（${fit.boxH.toFixed(1)}px）・横の文字の列より高くしない`)
  assert.equal(avatarFitOf(ASSASSIN, 76, 136).boxH, 76, '暗殺者女は伸ばさない（ふだんの姿からはみ出す動きがほぼ無い）')
  // 伸ばせない正方形（プロフィールの一覧）は同じ大きさで、振り上げた斧が上で切れる
  const sq = avatarFitOf(look, 76)
  assert.equal(sq.boxH, 76)
  assert.equal(sq.width, fit.width)
  assert.ok(sq.top + 24 * s < 0, '斧は枠の上で切れる')
  assert.equal(fit.pixel, false)
})

test('透明なところが無い画像は今までどおり正方形に切り取る・分からないときは全体を入れる・小さいドット絵は点のまま広げる', () => {
  assert.deepEqual(avatarFitOf({ w: 200, h: 100, box: { x: 0, y: 0, w: 200, h: 100 }, opaque: true }, 76),
    { width: 152, height: 76, left: -38, top: 0, boxH: 76, pixel: false })
  assert.deepEqual(avatarFitOf({ w: 200, h: 100, box: null, opaque: false }, 76),
    { width: 76, height: 38, left: 0, top: 19, boxH: 76, pixel: false })
  assert.equal(avatarFitOf({ w: 56, h: 56, box: { x: 14, y: 10, w: 28, h: 30 }, opaque: false }, 76).pixel, true)
})
