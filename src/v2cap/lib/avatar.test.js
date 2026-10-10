// v2cap：アイコン（2026-10-11 ユーザー指示「自分で設定できるように」）の決まりを固定するテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_PRESETS, AVATAR_MAX_BYTES, AVATAR_FILE_RE, isAllowedAvatar, uploadPathOf } from './avatar.js'

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
