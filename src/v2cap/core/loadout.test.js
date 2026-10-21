// バトルフロンティアⅡ 所持品のまとめ方（倉庫・鍛冶屋で共通）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stackInventory, wornIdsOf } from './loadout.js'
import { CATALOG, powerOf } from './equipment.js'

// カタログの実物から2本借りる（IDを決め打ちしないため）
const A = CATALOG[0]
const B = CATALOG.find(i => i.id !== A.id)
const inv = (id, equipId, plus) => ({ id, equip_id: equipId, plus })

test('同じ装備・同じ強化値はひとまとめになる', () => {
  const g = stackInventory([inv(1, A.id, 0), inv(2, A.id, 0), inv(3, A.id, 0)])
  assert.equal(g.length, 1)
  assert.equal(g[0].list.length, 3)
  assert.equal(g[0].item.id, A.id)
  assert.equal(g[0].plus, 0)
})

test('★強化値が違えば別のまとまりになる（混ぜると合成で溶ける）', () => {
  const g = stackInventory([inv(1, A.id, 0), inv(2, A.id, 1), inv(3, A.id, 0)])
  assert.equal(g.length, 2)
  const byPlus = Object.fromEntries(g.map(x => [x.plus, x.list.length]))
  assert.deepEqual(byPlus, { 0: 2, 1: 1 })
})

test('装備そのものが違えば別のまとまりになる', () => {
  const g = stackInventory([inv(1, A.id, 0), inv(2, B.id, 0)])
  assert.equal(g.length, 2)
})

test('装着中のぶんは worn、外れているぶんは free に分かれる', () => {
  const rows = [inv(1, A.id, 0), inv(2, A.id, 0), inv(3, A.id, 0)]
  const g = stackInventory(rows, new Set(['1']))[0]
  assert.equal(g.list.length, 3)
  assert.equal(g.worn.length, 1)
  assert.equal(g.free.length, 2)
  // 合成に使えるのは free だけ＝装着中のものを溶かさない
  assert.ok(g.free.every(i => i.id !== 1))
})

test('並びは戦闘力の高い順', () => {
  const g = stackInventory([inv(1, A.id, 0), inv(2, A.id, 3)])
  assert.ok(powerOf(g[0].item, g[0].plus) >= powerOf(g[1].item, g[1].plus))
  assert.equal(g[0].plus, 3)
})

test('カタログに無いIDや空の所持品は落ちずに無視される', () => {
  assert.deepEqual(stackInventory(null), [])
  assert.deepEqual(stackInventory([{ id:1, equip_id:'存在しない', plus:0 }]), [])
})

test('wornIdsOf は装着中の所持品IDを文字列で返す', () => {
  const inventory = [inv(7, A.id, 0), inv(8, A.id, 0)]
  const prof = { equipped: { right: 7 } }
  const ids = wornIdsOf(prof, inventory)
  assert.ok(ids.has('7'))
  assert.ok(!ids.has('8'))
})
