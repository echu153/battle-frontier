import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcFishBonus, toFishingColumns } from '../src/lib/fishing.js'

test('calcFishBonus 通常ランクは該当ステータス＋規定量', () => {
  // f ランクの statIdx=0 → 'atk' / 量3
  assert.deepEqual(calcFishBonus({ statIdx: 0 }, 'f'), { atk: 3 })
  // f ランクの statIdx=1 → 'def' / 量3
  assert.deepEqual(calcFishBonus({ statIdx: 1 }, 'f'), { def: 3 })
  // s ランクの statIdx=0 → 'def' / 量9
  assert.deepEqual(calcFishBonus({ statIdx: 0 }, 's'), { def: 9 })
})

test('calcFishBonus a/sss は固定ボーナス', () => {
  assert.deepEqual(calcFishBonus({ statIdx: 0 }, 'a'), { hp_max: 30, mp_max: 15 })
  assert.deepEqual(calcFishBonus({ statIdx: 0 }, 'sss'), { hp_max: 300 })
})

test('calcFishBonus 範囲外の statIdx は null', () => {
  assert.equal(calcFishBonus({ statIdx: 9 }, 'f'), null)
  assert.equal(calcFishBonus({ statIdx: 0 }, 'unknownrank'), null)
})

test('toFishingColumns ボーナスキー→永続列名へ変換', () => {
  assert.deepEqual(toFishingColumns({ atk: 1, hp_max: 10 }), { fishing_atk: 1, fishing_hp: 10 })
  assert.deepEqual(toFishingColumns({ mp_max: 5, spd: 2 }), { fishing_mp: 5, fishing_spd: 2 })
  assert.deepEqual(toFishingColumns({ bogus: 5 }), {}) // 未知キーは無視
})
