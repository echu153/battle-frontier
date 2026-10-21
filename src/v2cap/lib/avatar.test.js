// v2cap：アイコン（2026-10-11 ユーザー指示「自分で設定できるように」）の決まりを固定するテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_PRESETS, AVATAR_MAX_BYTES, AVATAR_FILE_RE, AVATAR_MAX_TALL, isAllowedAvatar, uploadPathOf, avatarImgStyle } from './avatar.js'

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

test('アイコンは横幅を決めて、縦長の画像は切らずに縦に伸ばす（2026-10-21「モーション次第でその分上下が大きくなるように」）', () => {
  const st = avatarImgStyle(76)
  assert.equal(st.width, '76px', '横幅は決まった大きさ＝同じ横幅で作った画像は体の大きさがそろう')
  assert.equal(st.height, 'auto', '縦は画像の縦横の比のまま（戦士男の待機 256×480 なら 76×142.5）')
  assert.equal(st.minHeight, '76px', '横長の画像は今までどおり正方形')
  assert.equal(st.maxHeight, `${76 * AVATAR_MAX_TALL}px`)
  assert.equal(st.objectFit, 'cover')
  assert.equal(st.objectPosition, 'center bottom', '縦の上限を越えたら上を切る（足元は残す）')
})
