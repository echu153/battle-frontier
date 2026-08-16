// バトルフロンティアⅡ 一覧の絞り込み・並べ替え・ページ送りの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_SIZE, ALL, TYPES, RANK_OPTIONS, TYPE_OPTIONS, plusOptions,
  SORTS, filterRows, sortRows, pageOf, pageCount, clampPage,
} from './browse.js'
import { CATALOG, RANKS, powerOf } from './equipment.js'

const row = (item, plus = 0, count = 1) => ({ item, plus, count, power: powerOf(item, plus) })
const rows = CATALOG.slice(0, 40).map((i, n) => row(i, n % 3))

test('1ページは15個', () => {
  assert.equal(PAGE_SIZE, 15)
  assert.equal(pageOf(rows, 0).length, 15)
  assert.equal(pageOf(rows, 1).length, 15)
  assert.equal(pageOf(rows, 2).length, 10)   // 40個なら3ページ目は10個
  assert.equal(pageCount(40), 3)
  assert.equal(pageCount(0), 1)              // 0件でも1ページ扱い（空ページを見せる）
  assert.equal(pageCount(15), 1)
  assert.equal(pageCount(16), 2)
})

test('ページ番号が範囲の外なら端に丸める（絞り込みで件数が減ったとき用）', () => {
  assert.deepEqual(pageOf(rows, 99), pageOf(rows, 2))
  assert.deepEqual(pageOf(rows, -5), pageOf(rows, 0))
  assert.equal(clampPage(9, 40), 2)
  assert.equal(clampPage(2, 3), 0)           // 3件しかなければ1ページ目へ戻す
})

test('絞り込みはランク・種類・部位・強化値で効く', () => {
  const all = filterRows(rows, {})
  assert.equal(all.length, rows.length)

  const s = filterRows(rows, { rank:'F' })
  assert.ok(s.length > 0)
  assert.ok(s.every(r => r.item.rank === 'F'))

  const t = TYPES[0]
  assert.ok(filterRows(rows, { type: t }).every(r => r.item.type === t))
  assert.ok(filterRows(rows, { part:'武器' }).every(r => r.item.part === '武器'))
  assert.ok(filterRows(rows, { plus: 1 }).every(r => r.plus === 1))

  // 重ねがけできる
  const both = filterRows(rows, { rank:'F', plus: 0 })
  assert.ok(both.every(r => r.item.rank === 'F' && r.plus === 0))
})

test('選べる値の一覧', () => {
  assert.equal(RANK_OPTIONS[0], ALL)
  assert.deepEqual(RANK_OPTIONS.slice(1), [...RANKS].reverse())  // 強い順
  assert.equal(TYPE_OPTIONS[0], ALL)
  assert.ok(TYPE_OPTIONS.includes('剣') && TYPE_OPTIONS.includes('盾') && TYPE_OPTIONS.includes('リング'))
  // 強化値は「実際に持っているぶん」だけ出す（+12まで全部並べても意味がない）
  assert.deepEqual(plusOptions([{ plus:0 }, { plus:3 }, { plus:0 }]), [ALL, 0, 3])
})

test('並べ替えは5通り、既定は戦闘力の高い順', () => {
  assert.deepEqual(SORTS.map(s => s.key), ['power', 'rank', 'plus', 'count', 'name'])
  const byPower = sortRows(rows, 'power', false)
  for (let i = 1; i < byPower.length; i++) assert.ok(byPower[i - 1].power >= byPower[i].power)
  const asc = sortRows(rows, 'power', true)
  for (let i = 1; i < asc.length; i++) assert.ok(asc[i - 1].power <= asc[i].power)

  const byRank = sortRows(rows, 'rank', false)
  for (let i = 1; i < byRank.length; i++) {
    assert.ok(RANKS.indexOf(byRank[i - 1].item.rank) >= RANKS.indexOf(byRank[i].item.rank))
  }
  const byPlus = sortRows(rows, 'plus', false)
  for (let i = 1; i < byPlus.length; i++) assert.ok(byPlus[i - 1].plus >= byPlus[i].plus)
})

test('並べ替えは元の配列を書き換えない', () => {
  const src = rows.slice(0, 5)
  const before = src.map(r => r.item.id)
  sortRows(src, 'name', true)
  assert.deepEqual(src.map(r => r.item.id), before)
})
