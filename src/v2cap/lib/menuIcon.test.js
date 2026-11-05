import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MENU_ICON } from './menuIconList.js'
import { MENU_ICON_DEFS, menuIconSrcOf } from './menuIcon.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'

test('【確定】2026-11-06 メニューの絵のアイコン：一覧の絵は public にあって印が中身と合う・絵がまだ無いものは絵文字のまま（ユーザー「挑戦のアイコンも作りたい」）', () => {
  assert.ok(MENU_ICON_DEFS.challenge, '挑戦のアイコン')
  for (const key of Object.keys(MENU_ICON)) assert.ok(MENU_ICON_DEFS[key], `${key} は MENU_ICON_DEFS に無い`)
  for (const [key, def] of Object.entries(MENU_ICON_DEFS)) {
    assert.ok(typeof def.fallback === 'string' && def.fallback.length > 0, `${key} の絵文字（絵が届くまで出す）`)
    const src = menuIconSrcOf(key)
    if (!MENU_ICON[key]) { assert.equal(src, null, `${key} は絵がまだ無い＝絵文字のまま`); continue }
    const file = new URL(`../../../public${src.split('?')[0]}`, import.meta.url)
    assert.ok(existsSync(file) && statSync(file).size < 30 * 1024, `${key} の絵は軽い`)
    assert.equal(src.split('?v=')[1], versionOf(fileURLToPath(file)), `${key} の印（node tools/v2cap-icon-art.mjs をやり直す）`)
  }
})
