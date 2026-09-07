import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getWeaponGroup,
  calcDefReduction,
  calcTotal,
  getTotalRank,
  gemEffectValue,
} from '../src/lib/stats.js'

test('getWeaponGroup 物理/魔法/不明の分類', () => {
  assert.equal(getWeaponGroup('sword'), 'physical')
  assert.equal(getWeaponGroup('katana'), 'physical')
  assert.equal(getWeaponGroup('staff'), 'magical')
  assert.equal(getWeaponGroup('orb'), 'magical')
  assert.equal(getWeaponGroup('unknown'), 'physical') // フォールバック
})

test('calcDefReduction 0以下は0・上限は0.30・境界は線形補間', () => {
  assert.equal(calcDefReduction(0), 0)
  assert.equal(calcDefReduction(-100), 0)
  assert.equal(calcDefReduction(3300), 0.3) // 最終閾値=最大軽減30%
  assert.equal(calcDefReduction(999999), 0.3) // 上限クランプ
  // defVal=55 は閾値[1]。progress=1 → rates[1]=4.6% → 0.046
  assert.ok(Math.abs(calcDefReduction(55) - 0.046) < 1e-9)
})

test('calcTotal 総合力の計算式', () => {
  const p = { hp_max: 100, mp_max: 50, atk: 10, def: 10, matk: 10, mdef: 10, spd: 10 }
  // floor(100/10 + 50/5 + 10+10+10+10+10) = floor(10 + 10 + 50) = 70
  assert.equal(calcTotal(p), 70)
})

test('getTotalRank 閾値ごとのランク', () => {
  assert.equal(getTotalRank(100).rank, 'F')
  assert.equal(getTotalRank(250).rank, 'F') // 境界は「以下」でF
  assert.equal(getTotalRank(600).rank, 'E')
  assert.equal(getTotalRank(20001).rank, 'SSS') // 全閾値超過
})

test('gemEffectValue ランク指数と無効入力', () => {
  assert.equal(gemEffectValue('ruby', 'F'), 10) // base 10 * 1.5^0
  assert.equal(gemEffectValue('ruby', 'E'), 15) // 10 * 1.5^1
  assert.equal(gemEffectValue('peridot', 'F'), 80)
  assert.equal(gemEffectValue('morganite', 'F'), 0.5) // pct=true は小数第1位で丸め
  assert.equal(gemEffectValue('unknown', 'F'), 0) // 無効な種類
  assert.equal(gemEffectValue('ruby', 'ZZ'), 0) // 無効なランク
})
