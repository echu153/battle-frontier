// バトルフロンティアⅡ スタミナ（オート出撃の燃料）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAMINA_BASE, STAMINA_RECOVER_MS, staminaMax, rollStamina, msToNextStamina, mmss,
} from './stamina.js'

test('転職0回の最大スタミナは10', () => {
  assert.equal(STAMINA_BASE, 10)
  assert.equal(staminaMax(0), 10)
  assert.equal(staminaMax(undefined), 10)
  assert.equal(staminaMax(-5), 10, '負の回数でも下限は初期値')
})

test('29回までは転職1回ごとに1増える', () => {
  assert.equal(staminaMax(1), 11)
  assert.equal(staminaMax(10), 20)
  assert.equal(staminaMax(29), 39)
})

test('30〜49回は3回ごとに1増える', () => {
  assert.equal(staminaMax(30), 39, '30回目そのものでは増えない')
  assert.equal(staminaMax(31), 39)
  assert.equal(staminaMax(32), 40, '30・31・32の3回で1')
  assert.equal(staminaMax(35), 41)
  assert.equal(staminaMax(49), 45)
})

test('50〜99回は5回ごとに1増える', () => {
  assert.equal(staminaMax(50), 45)
  assert.equal(staminaMax(54), 46, '50〜54の5回で1')
  assert.equal(staminaMax(99), 55)
})

test('100〜299回は10回ごとに1増える', () => {
  assert.equal(staminaMax(100), 55)
  assert.equal(staminaMax(109), 56)
  assert.equal(staminaMax(299), 75)
})

test('300回以降は30回ごとに1増える', () => {
  assert.equal(staminaMax(300), 75)
  assert.equal(staminaMax(328), 75)
  assert.equal(staminaMax(329), 76, '300〜329の30回で1')
  assert.equal(staminaMax(599), 85)
})

test('最大値は転職を重ねるほど必ず増える（減る段がない）', () => {
  let prev = staminaMax(0)
  for (let n = 1; n <= 700; n++) {
    const cur = staminaMax(n)
    assert.ok(cur >= prev, `転職${n}回で最大値が減っている（${prev} → ${cur}）`)
    prev = cur
  }
})

// ===== 回復（5分に1・上限まで）=====
const T0 = new Date('2026-08-22T12:00:00+09:00').getTime()

test('回復は5分に1', () => {
  assert.equal(STAMINA_RECOVER_MS, 5 * 60 * 1000)
  const at = new Date(T0).toISOString()
  assert.equal(rollStamina(3, at, 10, T0).n, 3, '経っていなければ増えない')
  assert.equal(rollStamina(3, at, 10, T0 + 4 * 60 * 1000).n, 3, '4分では増えない')
  assert.equal(rollStamina(3, at, 10, T0 + 5 * 60 * 1000).n, 4)
  assert.equal(rollStamina(3, at, 10, T0 + 17 * 60 * 1000).n, 6, '3回ぶん')
})

test('端数は繰り越す（毎回4分59秒が消えたりしない）', () => {
  const at = new Date(T0).toISOString()
  // 7分後：1回ぶん入って、残り2分は次へ持ち越す
  const r = rollStamina(3, at, 10, T0 + 7 * 60 * 1000)
  assert.equal(r.n, 4)
  assert.equal(r.at, T0 + 5 * 60 * 1000, '消化したぶんだけ進める')
  // その状態から3分後（＝合計10分）でちょうど次の1
  assert.equal(rollStamina(r.n, r.at, 10, T0 + 10 * 60 * 1000).n, 5)
})

test('上限を超えて溜まらない／満タンなら時計は「いま」へ', () => {
  const at = new Date(T0).toISOString()
  const far = T0 + 100 * 60 * 60 * 1000
  assert.equal(rollStamina(3, at, 10, far).n, 10, '上限で止まる')
  const full = rollStamina(10, at, 10, far)
  assert.equal(full.n, 10)
  assert.equal(full.at, far, '満タンのあいだに溜め込まない')
  // ★満タンで放置 → 1消費 → その瞬間から5分で1戻る（放置ぶんが一気に返ってこない）
  const after = rollStamina(full.n - 1, new Date(far).toISOString(), 10, far + 60 * 1000)
  assert.equal(after.n, 9)
  assert.equal(rollStamina(9, new Date(far).toISOString(), 10, far + 5 * 60 * 1000).n, 10)
})

test('次の回復までの残り時間', () => {
  const at = new Date(T0).toISOString()
  assert.equal(msToNextStamina(3, at, 10, T0), 5 * 60 * 1000)
  assert.equal(msToNextStamina(3, at, 10, T0 + 2 * 60 * 1000), 3 * 60 * 1000)
  assert.equal(msToNextStamina(3, at, 10, T0 + 7 * 60 * 1000), 3 * 60 * 1000, '端数ぶんは進んでいる')
  assert.equal(msToNextStamina(10, at, 10, T0), 0, '満タンなら0')
})

test('mmss は分:秒（秒は2桁）', () => {
  assert.equal(mmss(0), '0:00')
  assert.equal(mmss(1000), '0:01')
  assert.equal(mmss(61 * 1000), '1:01')
  assert.equal(mmss(5 * 60 * 1000), '5:00')
})
