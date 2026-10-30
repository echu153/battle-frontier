import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOWER_NAME } from './tower.js'

// 【確定】2026-10-31 ユーザー指示「メニューがバラバラになってるからそれぞれの役割ごとにまとめたい」
//   キャラクター（ユーザーの「プレイヤー関連」）・冒険・施設の3つ。中の並びもユーザーの指定どおり
const SRC = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // 手元は CRLF のことがある
const MENU_SRC = SRC.slice(SRC.indexOf('const MENU = ['), SRC.indexOf('const SCREEN_TITLE'))
const groups = MENU_SRC.split("{ title:'").slice(1).map(s => ({
  title: s.slice(0, s.indexOf("'")),
  keys: [...s.matchAll(/\{ key:'(\w+)'/g)].map(m => m[1]),
}))

test('メニューは役割ごとの3つ：キャラクター・冒険・施設（並びもユーザーの指定どおり）', () => {
  assert.deepEqual(groups, [
    { title:'キャラクター', keys:['profile', 'skills', 'equip', 'asc', 'dex'] },
    { title:'冒険', keys:['dungeon', 'tower'] },
    { title:'施設', keys:['temple', 'smith', 'museum', 'burger', 'casino', 'tree'] },
  ])
})

test('メニューのどれを押しても、題と中身のある画面へ行ける', () => {
  const titles = SRC.slice(SRC.indexOf('const SCREEN_TITLE'), SRC.indexOf('// ATBの試し撃ち'))
  for (const key of groups.flatMap(g => g.keys)) {
    assert.ok(titles.includes(`${key}:`), `${key} の題が無い`)
    assert.ok(SRC.includes(`{screen === '${key}' && `), `${key} の画面が無い`)
  }
})

test('まとまりの中身は2列に流れ、奇数の最後だけ横いっぱい（右を空けない）', () => {
  const status = readFileSync(new URL('../components/V2Status.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(status.includes("gridColumn: i === group.items.length - 1 && i % 2 === 0 ? '1 / -1' : undefined"))
  assert.ok(status.includes('{group.title}'), 'まとまりの見出しを出す')
})

test('塔の名前は「の」のあとだけで折り返す（最後の1字だけが次の行へ落ちない）', () => {
  assert.equal(TOWER_NAME.split('の').length, 2, '名前を変えて「の」が1つでなくなったら TowerLabel を見直す')
  assert.ok(SRC.includes("<span style={{ wordBreak:'keep-all' }}>{head}の<wbr />{tail}</span>"))
  assert.ok(SRC.includes("{ key:'tower', label: <TowerLabel />,"))
})
