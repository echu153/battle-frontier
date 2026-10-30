import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { TOWER_NAME } from './tower.js'
import { MENU_HEAD } from './menuHeadList.js'
import { MENU_HEAD_DEFS, MENU_HEAD_DIR, menuHeadFileOf, menuHeadSrcOf } from './menuHead.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'

// 【確定】2026-10-31 ユーザー指示「メニューがバラバラになってるからそれぞれの役割ごとにまとめたい」
//   キャラクター（ユーザーの「プレイヤー関連」）・冒険・施設の3つ。中の並びもユーザーの指定どおり
const SRC = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // 手元は CRLF のことがある
const MENU_SRC = SRC.slice(SRC.indexOf('const MENU = ['), SRC.indexOf('const SCREEN_TITLE'))
const groups = MENU_SRC.split("{ title:'").slice(1).map(s => ({
  title: s.slice(0, s.indexOf("'")),
  head: s.match(/head:'(\w+)'/)?.[1],
  keys: [...s.matchAll(/\{ key:'(\w+)'/g)].map(m => m[1]),
}))

test('メニューは役割ごとの3つ：キャラクター・冒険・施設（並びもユーザーの指定どおり）', () => {
  assert.deepEqual(groups, [
    { title:'キャラクター', head:'chara', keys:['profile', 'skills', 'equip', 'asc', 'dex'] },
    { title:'冒険', head:'adventure', keys:['dungeon', 'tower'] },
    { title:'施設', head:'facility', keys:['temple', 'smith', 'museum', 'burger', 'casino', 'tree'] },
  ])
})

test('【確定】見出しの帯：3つとも絵があり、アドレスに絵の中身の印が付く（描き直しても古いキャッシュが出ない）', () => {
  assert.deepEqual(Object.keys(MENU_HEAD_DEFS), groups.map(g => g.head))
  for (const key of Object.keys(MENU_HEAD_DEFS)) {
    const file = new URL(`../../../public${MENU_HEAD_DIR}/${menuHeadFileOf(key)}`, import.meta.url)
    assert.ok(existsSync(file), `${key} の絵が無い（node tools/v2cap-menu-art.mjs）`)
    assert.equal(MENU_HEAD[key].v, versionOf(file), `${key}：絵と一覧の印が違う（node tools/v2cap-menu-art.mjs）`)
    assert.ok(menuHeadSrcOf(key).endsWith(`?v=${MENU_HEAD[key].v}`))
  }
})

test('見出しの帯は横幅いっぱいのまま高さだけ変わる（幅を固定しないと max-height に引かれて帯の幅が縮む・はみ出す）', () => {
  const status = readFileSync(new URL('../components/V2Status.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(status.includes("width:'100%', aspectRatio:'6 / 1', minHeight:'56px', maxHeight:'80px'"))
  assert.ok(status.includes('url(${menuHeadSrcOf(head)}) right center / auto 100% no-repeat'), '絵は高さに合わせて右へ寄せる（どの幅でも絵が切れない）')
  assert.ok(status.includes('<MenuHead head={group.head} title={group.title} />'))
})

test('メニューのどれを押しても、題と中身のある画面へ行ける', () => {
  const titles = SRC.slice(SRC.indexOf('const SCREEN_TITLE'), SRC.indexOf('// ATBの試し撃ち'))
  for (const key of groups.flatMap(g => g.keys)) {
    assert.ok(titles.includes(`${key}:`), `${key} の題が無い`)
    assert.ok(SRC.includes(`{screen === '${key}' && `), `${key} の画面が無い`)
  }
})

test('【確定】どのボタンも同じ大きさ：その行に1つしかなくても横いっぱいに伸ばさない', () => {
  const status = readFileSync(new URL('../components/V2Status.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const menu = status.slice(status.indexOf('export function V2Menu'))
  assert.ok(menu.includes("gridTemplateColumns:'1fr 1fr'"), '2列に流す')
  assert.ok(!menu.includes('gridColumn:'), '1つだけ伸ばすと大きさがそろわない')
  assert.ok(menu.includes('{group.title}'), 'まとまりの見出しを出す')
})

test('塔の名前は「の」のあとだけで折り返す（最後の1字だけが次の行へ落ちない）', () => {
  assert.equal(TOWER_NAME.split('の').length, 2, '名前を変えて「の」が1つでなくなったら TowerLabel を見直す')
  assert.ok(SRC.includes("<span style={{ wordBreak:'keep-all' }}>{head}の<wbr />{tail}</span>"))
  assert.ok(SRC.includes("{ key:'tower', label: <TowerLabel />,"))
})
