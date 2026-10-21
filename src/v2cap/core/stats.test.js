// バトルフロンティアⅡ ステータス成長の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAT_KEYS, STAT_DEFS, MAX_LV, ROLLS_PER_LV, INITIAL_STATS,
  EXP_PER_LV_BASE, EXP_PER_LV_MAX, EXP_STEP_PER_JOBS, JOB_CHANGE_POWER,
  expPerLv, expToNext, calcPower, rollAllocate, rollLevelUp, applyExp,
  canJobChange, applyJobChange, emptyGains,
} from './stats.js'

// 決定的な擬似乱数（同じseedなら同じ並び）。実装の分岐を全部踏ませるために使う
const makeRng = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const START_POWER = calcPower(INITIAL_STATS)

test('ステータスは8種で、抽選の並びがSQLと一致する', () => {
  // ★この並びは supabase_v2_core.sql の v_gain/v_unit/v_stat 配列の順序と一致させること。
  //   並べ替えるとサーバーの抽選結果と表示がズレるため、変更時はSQLも同時に直す。
  assert.deepEqual(STAT_KEYS, ['hp', 'mp', 'str', 'dex', 'agi', 'int_stat', 'vit', 'luk'])
  for (const k of STAT_KEYS) assert.ok(STAT_DEFS[k], `${k} の定義がある`)
  assert.equal(Object.keys(STAT_DEFS).length, STAT_KEYS.length)
})

test('全ステに短い説明と詳しい説明がある（升目とカーソル表示で使う）', () => {
  for (const k of STAT_KEYS) {
    const d = STAT_DEFS[k]
    assert.ok(d.desc && d.desc.length > 0, `${k} の短い説明`)
    // 升目の名前と値のあいだに入るので、長いと値が押し出される
    assert.ok(d.desc.length <= 10, `${k} の短い説明が長すぎる（${d.desc.length}文字）`)
    assert.ok(d.detail && d.detail.length > 0, `${k} の詳しい説明`)
    assert.ok(d.jp && d.jp.length > 0, `${k} の和名`)
  }
})

test('unitはHP=8・MP=3・他=1（戦闘力換算の分母）', () => {
  assert.equal(STAT_DEFS.hp.unit, 8)
  assert.equal(STAT_DEFS.mp.unit, 3)
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) assert.equal(STAT_DEFS[k].unit, 1)
})

test('戦闘力はHP/8＋MP/3＋他6ステの合計', () => {
  assert.equal(calcPower({ hp:80, mp:30, str:0, dex:0, agi:0, int_stat:0, vit:0, luk:0 }), 20) // 10+10
  assert.equal(START_POWER, 39) // 5(HP40)+4(MP12)+5×6
  assert.equal(calcPower(emptyGains()), 0)
})

test('抽選はどのステに当たっても戦闘力換算で+1', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const gains = rollLevelUp(makeRng(seed))
    assert.equal(calcPower(gains), ROLLS_PER_LV, `seed=${seed}`)
    for (const k of STAT_KEYS) {
      assert.equal(gains[k] % STAT_DEFS[k].unit, 0, `${k} は unit の倍数`)
    }
  }
  assert.equal(calcPower(rollAllocate(0, makeRng(1))), 0)
  assert.equal(calcPower(rollAllocate(777, makeRng(1))), 777)
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

// ===== 必要EXP（転職回数で段階的に重くなる） =====
test('必要EXPは転職100回ごとに+10、100で打ち止め', () => {
  assert.equal(expPerLv(0), EXP_PER_LV_BASE)
  assert.equal(expPerLv(99), 60)
  assert.equal(expPerLv(100), 70)
  assert.equal(expPerLv(199), 70)
  assert.equal(expPerLv(200), 80)
  assert.equal(expPerLv(300), 90)
  assert.equal(expPerLv(400), EXP_PER_LV_MAX)
  assert.equal(expPerLv(9999), EXP_PER_LV_MAX) // 打ち止め
  assert.equal(expPerLv(EXP_STEP_PER_JOBS), 70)
  assert.equal(expToNext(MAX_LV, 0), 0)        // 上限に達したら溜まらない
  assert.equal(expToNext(1, 200), 80)
})

// ===== LVアップ =====
test('必要EXPで1LV上がり、余りは持ち越す', () => {
  const r = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, expPerLv(0) + 10, makeRng(7))
  assert.equal(r.lv, 2)
  assert.equal(r.exp, 10)
  assert.equal(r.levelUps.length, 1)
  assert.equal(calcPower(r.stats), START_POWER + ROLLS_PER_LV)
})

test('転職済みは必要EXPが重い（同じEXP量でも上がるLVが少ない）', () => {
  const amount = 700
  const fresh = applyExp({ lv:1, exp:0, job_changes:0,   ...INITIAL_STATS }, amount, makeRng(7))
  const aged  = applyExp({ lv:1, exp:0, job_changes:400, ...INITIAL_STATS }, amount, makeRng(7))
  assert.equal(fresh.lv, 1 + Math.floor(amount / 60))   // 60×11=660
  assert.equal(aged.lv,  1 + Math.floor(amount / 100))  // 100×7=700
  assert.ok(aged.lv < fresh.lv)
})

test('まとめてEXPを入れても1LVごとに抽選する', () => {
  const r = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, expPerLv(0) * 10, makeRng(99))
  assert.equal(r.lv, 11)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, 10)
  assert.equal(calcPower(r.stats), START_POWER + ROLLS_PER_LV * 10)
})

test('LV上限で止まり、あふれたEXPは捨てられる', () => {
  const r = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, expPerLv(0) * 500, makeRng(3))
  assert.equal(r.lv, MAX_LV)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, MAX_LV - 1)
  // LV100の戦闘力＝初期39＋99LV×5＝534
  assert.equal(calcPower(r.stats), START_POWER + (MAX_LV - 1) * ROLLS_PER_LV)
})

test('LV上限に到達済みならEXPは一切入らない', () => {
  const before = { lv:MAX_LV, exp:0, job_changes:0, ...INITIAL_STATS }
  const r = applyExp(before, 99999, makeRng(5))
  assert.equal(r.lv, MAX_LV)
  assert.equal(r.exp, 0)
  assert.equal(r.levelUps.length, 0)
  assert.deepEqual(r.stats, { ...INITIAL_STATS })
})

test('applyExpは渡した状態を書き換えない', () => {
  const before = { lv:1, exp:0, job_changes:0, ...INITIAL_STATS }
  const snapshot = JSON.stringify(before)
  applyExp(before, 180, makeRng(11))
  assert.equal(JSON.stringify(before), snapshot)
})

// ===== 転職（あるけみすとの転生に相当） =====
test('転職できるのはLV上限に達してから', () => {
  assert.equal(canJobChange(MAX_LV - 1), false)
  assert.equal(canJobChange(MAX_LV), true)
})

test('転職でLV1・ステは初期値に戻り、転職回数×100の戦闘力が配られる', () => {
  // LV100まで育てた状態から転職する
  const grown = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, 60 * 500, makeRng(21))
  assert.equal(calcPower(grown.stats), START_POWER + 495)

  const r1 = applyJobChange({ ...grown.stats, lv:grown.lv, exp:grown.exp, job_changes:0 }, makeRng(31))
  assert.equal(r1.lv, 1)
  assert.equal(r1.exp, 0)
  assert.equal(r1.job_changes, 1)
  // 育てた分は消え、初期値＋100戦闘力（＝20LV分）になる
  assert.equal(calcPower(r1.alloc), JOB_CHANGE_POWER)
  assert.equal(r1.power, START_POWER + JOB_CHANGE_POWER)
  assert.equal(r1.power, 139)

  // 2回目は毎回引き直し＝初期値＋200戦闘力（積み上がらない）
  const r2 = applyJobChange({ ...r1.stats, lv:MAX_LV, exp:0, job_changes:r1.job_changes }, makeRng(32))
  assert.equal(r2.job_changes, 2)
  assert.equal(r2.power, START_POWER + JOB_CHANGE_POWER * 2)
})

test('転職を重ねるとLV100時の到達点が100ずつ上がる', () => {
  const rng = makeRng(1234)
  let state = { lv:1, exp:0, job_changes:0, ...INITIAL_STATS }
  for (let jobs = 1; jobs <= 3; jobs++) {
    const jc = applyJobChange(state, rng)
    const capped = applyExp({ ...jc.stats, lv:jc.lv, exp:jc.exp, job_changes:jc.job_changes }, 100 * 500, rng)
    assert.equal(capped.lv, MAX_LV)
    // 到達点 ＝ 初期39 ＋ 転職回数×100 ＋ 99LV×5
    assert.equal(calcPower(capped.stats), START_POWER + jobs * JOB_CHANGE_POWER + 495)
    state = { ...capped.stats, lv:capped.lv, exp:capped.exp, job_changes:jc.job_changes }
  }
})

test('applyJobChangeは渡した状態を書き換えない', () => {
  const before = { lv:MAX_LV, exp:0, job_changes:2, ...INITIAL_STATS }
  const snapshot = JSON.stringify(before)
  applyJobChange(before, makeRng(13))
  assert.equal(JSON.stringify(before), snapshot)
})
