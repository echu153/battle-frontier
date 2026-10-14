// v2cap：対人戦の決まり（pvp.js）を固定するテスト（node --test）
// 【確定】2026-10-14 ユーザー決定：対人戦は8〜10ターンで決着・対人だけHPを増やす（LV25 ×3.5・LV50 ×5・LV80以上 ×6）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PVP_HP_POINTS, pvpHpMultOf, pvpHpMultFor, withPvpHp } from './pvp.js'

test('【確定】対人だけのHP倍率は LV25 ×3.5・LV50 ×5・LV80以上 ×6（間は線でつなぐ）', () => {
  assert.deepEqual(PVP_HP_POINTS, [[25, 3.5], [50, 5], [80, 6]])
  assert.equal(pvpHpMultOf(25), 3.5)
  assert.equal(pvpHpMultOf(50), 5)
  assert.equal(pvpHpMultOf(80), 6)
  assert.equal(pvpHpMultOf(1), 3.5, 'LV25より下は×3.5')
  assert.equal(pvpHpMultOf(100), 6, 'LV80より上は×6')
  assert.equal(pvpHpMultOf(65), 5.5, 'LV50とLV80のまんなか')
  // LVが上がっても下がらない
  for (let lv = 2; lv <= 100; lv++) assert.ok(pvpHpMultOf(lv) >= pvpHpMultOf(lv - 1), `LV${lv}`)
})

test('2人のLVが違うときは、高いほうのLVの倍率を2人ともに掛ける', () => {
  assert.equal(pvpHpMultFor(30, 80), 6)
  assert.equal(pvpHpMultFor(80, 30), 6)
  assert.equal(pvpHpMultFor(50, 50), 5)
})

test('倍率はHPだけに掛ける（ほかのステ・元のキャラは変えない）', () => {
  const f = { name: 'a', stats: { hp: 100, mp: 30, str: 10, dex: 5, agi: 5, int_stat: 5, vit: 5, luk: 5 } }
  const g = withPvpHp(f, 3.5)
  assert.equal(g.stats.hp, 350)
  assert.equal(g.stats.mp, 30)
  assert.equal(g.stats.str, 10)
  assert.equal(f.stats.hp, 100, '元のキャラはそのまま')
})
