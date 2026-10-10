// v2cap：モンスター図鑑の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示「モンスター図鑑…を加えて」（まずは見るだけ）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AREA_LIST } from './areas.js'
import { DEX_ROLES, DEX_ALL, DEX_TOTAL, DEX_AREA_COUNT, dexAreaOf, dropInfoOf, killsOf, isFound, dexProgressOf } from './dex.js'

test('図鑑は15エリア×20体＝300体。どの敵も1回ずつ（名前がかぶらない）', () => {
  assert.equal(DEX_AREA_COUNT, AREA_LIST.length)
  assert.equal(DEX_TOTAL, 300)
  assert.equal(new Set(DEX_ALL.map(e => e.name)).size, 300)
  for (let a = 1; a <= DEX_AREA_COUNT; a++) assert.equal(dexAreaOf(a).length, 20, `エリア${a}`)
  assert.deepEqual(dexAreaOf(0), [])
  assert.deepEqual(dexAreaOf(16), [])
})

test('1エリアの並びは 通常6 → 時間帯6 → レア5 → ボス3（ボスは①②③の順）。どの敵も出る場所がある', () => {
  assert.deepEqual(DEX_ROLES.map(r => r.key), ['normal', 'timed', 'rare', 'boss'])
  for (let a = 1; a <= DEX_AREA_COUNT; a++) {
    const rows = dexAreaOf(a)
    assert.deepEqual(rows.map(e => e.role), [...Array(6).fill('normal'), ...Array(6).fill('timed'), ...Array(5).fill('rare'), ...Array(3).fill('boss')], `エリア${a}`)
    assert.deepEqual(rows.slice(-3).map(e => e.subs), [[1], [2], [3]], `エリア${a}のボス`)
    for (const e of rows) {
      assert.ok(e.spots.length > 0, `${e.name}の出る場所`)
      assert.ok(e.spots.every(s => Math.ceil(s / 3) === a), `${e.name}はエリア${a}の場所にだけ出る`)
      assert.ok(e.lv >= 1)
      assert.ok(['phys', 'mag'].includes(e.kind))
    }
    for (const e of rows.filter(x => x.role === 'timed')) assert.ok(['朝', '昼', '晩'].includes(e.band), `${e.name}の時間帯`)
  }
  // エリア1の例（始まりの森）
  const a1 = dexAreaOf(1)
  assert.equal(a1[0].name, 'スライム')
  assert.deepEqual(a1[0].subs, [1, 2])
  assert.equal(a1[19].name, 'ビッグスライム')
  assert.equal(dexAreaOf(15)[19].lv, 80, '最後のボスはLV80')
})

test('落とす装備は役割で決まる：ふつう・時間帯は3%でノーマル・レア／レアは10%でエピックまで／ボスは10%でレジェンダリーまで', () => {
  assert.deepEqual(dropInfoOf('normal'), { chance: 3, rarities: ['N', 'R'] })
  assert.deepEqual(dropInfoOf('timed'), { chance: 3, rarities: ['N', 'R'] })
  assert.deepEqual(dropInfoOf('rare'), { chance: 10, rarities: ['N', 'R', 'E'] })
  assert.deepEqual(dropInfoOf('boss'), { chance: 10, rarities: ['N', 'R', 'E', 'L'] })
})

test('倒すまでは見つけていない（???）。見つけた数と割合', () => {
  const kills = { スライム: 12, コウモリ: 0, ビッグスライム: 1 }
  assert.equal(isFound(kills, 'スライム'), true)
  assert.equal(isFound(kills, 'コウモリ'), false)
  assert.equal(isFound({}, 'スライム'), false)
  assert.equal(killsOf(kills, 'スライム'), 12)
  assert.equal(killsOf(null, 'スライム'), 0)
  assert.deepEqual(dexProgressOf(dexAreaOf(1), kills), { done: 2, total: 20, pct: 10 })
  assert.deepEqual(dexProgressOf([], kills), { done: 0, total: 0, pct: 0 })
})
