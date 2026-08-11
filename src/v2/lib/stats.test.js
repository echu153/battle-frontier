// バトルフロンティアⅡ ステータス成長の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAT_KEYS, STAT_DEFS, MAX_LV, EXP_PER_LV, ROLLS_PER_LV, INITIAL_STATS,
  expToNext, calcPower, rollLevelUp, applyExp, emptyGains,
} from './stats.js'

// 決定的な擬似乱数（同じseedなら同じ並び）。実装の分岐を全部踏ませるために使う
const makeRng = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

test('ステータスは8種で、抽選の並びがSQLと一致する', () => {
  // ★この並びは supabase_v2_core.sql の v_gain/v_unit 配列の順序と一致させること。
  //   並べ替えるとサーバーの抽選結果と表示がズレるため、変更時はSQLも同時に直す。
  assert.deepEqual(STAT_KEYS, ['hp', 'mp', 'str', 'dex', 'agi', 'int_stat', 'vit', 'luk'])
  for (const k of STAT_KEYS) assert.ok(STAT_DEFS[k], `${k} の定義がある`)
  assert.equal(Object.keys(STAT_DEFS).length, STAT_KEYS.length)
})

test('unitはHP=8・MP=3・他=1（戦闘力換算の分母）', () => {
  assert.equal(STAT_DEFS.hp.unit, 8)
  assert.equal(STAT_DEFS.mp.unit, 3)
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) assert.equal(STAT_DEFS[k].unit, 1)
})

test('戦闘力はHP/8＋MP/3＋他6ステの合計', () => {
  assert.equal(calcPower({ hp:80, mp:30, str:0, dex:0, agi:0, int_stat:0, vit:0, luk:0 }), 20) // 10+10
  assert.equal(calcPower(INITIAL_STATS), 39) // 5(HP40)+4(MP12)+5×6
  assert.equal(calcPower(emptyGains()), 0)
})

test('抽選はどのステに当たっても戦闘力換算で+5', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const gains = rollLevelUp(makeRng(seed))
    assert.equal(calcPower(gains), ROLLS_PER_LV, `seed=${seed}`)
    for (const k of STAT_KEYS) {
      assert.equal(gains[k] % STAT_DEFS[k].unit, 0, `${k} は unit の倍数`)
    }
  }
})

test('抽選は8種すべてに当たりうる（均等・手相なし）', () => {
  const hit = new Set()
  const rng = makeRng(20260812)
  for (let i = 0; i < 500; i++) {
    const gains = rollLevelUp(rng)
    for (const k of STAT_KEYS) if (gains[k] > 0) hit.add(k)
  }
  assert.equal(hit.size, STAT_KEYS.length)
})

test('EXP60で1LV上がり、余りは持ち越す', () => {
  const r = applyExp({ lv:1, exp:0, ...INITIAL_STATS }, EXP_PER_LV + 10, makeRng(7))
  assert.equal(r.lv, 2)
  assert.equal(r.exp, 10)
  assert.equal(r.levelUps.length, 1)
  assert.equal(calcPower(r.stats), calcPower(INITIAL_STATS) + ROLLS_PER_LV)
})

test('まとめてEXPを入れても1LVごとに抽選する', () => {
  const r = applyExp({ lv:1, exp:0, ...INITIAL_STATS }, EXP_PER_LV * 10, makeRng(99))
  assert.equal(r.lv, 11)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, 10)
  assert.equal(calcPower(r.stats), calcPower(INITIAL_STATS) + ROLLS_PER_LV * 10)
})

test('LV上限で止まり、あふれたEXPは捨てられる', () => {
  const r = applyExp({ lv:1, exp:0, ...INITIAL_STATS }, EXP_PER_LV * 500, makeRng(3))
  assert.equal(r.lv, MAX_LV)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, MAX_LV - 1)
  assert.equal(expToNext(MAX_LV), 0)
  // LV100の戦闘力＝初期39＋99LV×5＝534
  assert.equal(calcPower(r.stats), calcPower(INITIAL_STATS) + (MAX_LV - 1) * ROLLS_PER_LV)
})

test('LV上限に到達済みならEXPは一切入らない', () => {
  const before = { lv:MAX_LV, exp:0, ...INITIAL_STATS }
  const r = applyExp(before, 99999, makeRng(5))
  assert.equal(r.lv, MAX_LV)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, 0)
  assert.deepEqual(r.stats, { ...INITIAL_STATS })
})

test('applyExpは渡した状態を書き換えない', () => {
  const before = { lv:1, exp:0, ...INITIAL_STATS }
  const snapshot = JSON.stringify(before)
  applyExp(before, EXP_PER_LV * 3, makeRng(11))
  assert.equal(JSON.stringify(before), snapshot)
})
