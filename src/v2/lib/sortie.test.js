// バトルフロンティアⅡ 出撃の進行まわりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOSS_RATE_STEP, rollBoss, nextBossRate, isAreaUnlocked, unlockNext,
  expOf, goldOf, pickEncounter, EXP_BOSS, EXP_ZAKO_MIN, EXP_ZAKO_MAX, LAST_AREA,
} from './sortie.js'
import { allEnemies, areaOf } from './enemies.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('ボスは旧版と同じピティ方式（戦うたび積み上がり、当たると0へ戻る）', () => {
  assert.equal(nextBossRate(0, false), BOSS_RATE_STEP)
  assert.equal(nextBossRate(5, false), 5 + BOSS_RATE_STEP)
  assert.equal(nextBossRate(50, true), 0, 'ボスに当たったら0へ戻す')
  // 遭遇率0なら絶対に出ない・100なら必ず出る
  const rng = mkRng(3)
  for (let i = 0; i < 200; i++) assert.equal(rollBoss(0, rng), false)
  for (let i = 0; i < 200; i++) assert.equal(rollBoss(100, rng), true)
})

test('ボスは旧版より出にくい（平均23回前後）', () => {
  // ★旧版は +0.5%/回 で平均18.4回。v2は「もう少し出にくく」して +0.3%/回
  assert.equal(BOSS_RATE_STEP, 0.3)
  const rng = mkRng(99)
  let total = 0
  const trials = 3000
  for (let i = 0; i < trials; i++) {
    let rate = 0, count = 0
    for (;;) { count++; if (rollBoss(rate, rng)) break; rate = nextBossRate(rate, false) }
    total += count
  }
  const avg = total / trials
  assert.ok(avg > 20 && avg < 28, `平均${avg.toFixed(1)}回`)
})

test('エリアはボス撃破で次が開く（旧版と同じ）', () => {
  assert.ok(isAreaUnlocked([], 1), '①は最初から')
  assert.ok(!isAreaUnlocked([1], 2))
  // ①のボスに勝つと②が開く
  assert.deepEqual(unlockNext([1], 1, true, true), [1, 2])
  // 通常敵に勝っても開かない／ボスに負けても開かない
  assert.deepEqual(unlockNext([1], 1, true, false), [1])
  assert.deepEqual(unlockNext([1], 1, false, true), [1])
  // 二重に足さない
  assert.deepEqual(unlockNext([1, 2], 1, true, true), [1, 2])
  // ⑧の先は無い（旧版と同じ）
  assert.deepEqual(unlockNext([1, 2, 3, 4, 5, 6, 7, 8], LAST_AREA, true, true), [1, 2, 3, 4, 5, 6, 7, 8])
  // ⑦を倒すと⑧が開く
  assert.ok(unlockNext([1, 2, 3, 4, 5, 6, 7], 7, true, true).includes(8))
})

test('EXPは旧版と同じ（通常8〜11・ボス13）', () => {
  const rng = mkRng(11)
  assert.equal(expOf(true, rng), EXP_BOSS)
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const e = expOf(false, rng)
    assert.ok(e >= EXP_ZAKO_MIN && e <= EXP_ZAKO_MAX, `EXP=${e}`)
    seen.add(e)
  }
  assert.equal(seen.size, EXP_ZAKO_MAX - EXP_ZAKO_MIN + 1, '8〜11が全部出る')
})

test('Goldは旧版の値をそのまま持っている', () => {
  for (const e of allEnemies()) assert.ok(goldOf(e) > 0, `${e.name} のGold`)
  assert.equal(goldOf(areaOf(1).enemies[0]), 20)      // スライム
  assert.equal(goldOf(areaOf(1).boss), 100)           // ビッグスライム
  assert.equal(goldOf(areaOf(8).boss), 60000)         // 天空覇龍ウラノス
  // エリアが進むほど増える
  let prev = 0
  for (let id = 1; id <= 8; id++) {
    const g = goldOf(areaOf(id).boss)
    assert.ok(g > prev, `エリア${id}のボスGold`)
    prev = g
  }
})

test('遭遇はそのエリアの敵から選ばれる', () => {
  const rng = mkRng(21)
  const area = areaOf(3)
  const names = new Set()
  for (let i = 0; i < 300; i++) {
    const enc = pickEncounter(3, 0, rng)   // 遭遇率0なので必ず通常敵
    assert.equal(enc.isBoss, false)
    names.add(enc.enemy.name)
  }
  assert.deepEqual([...names].sort(), area.enemies.map(e => e.name).sort())
  // 遭遇率100なら必ずボス
  assert.equal(pickEncounter(3, 100, rng).enemy.name, area.boss.name)
  assert.equal(pickEncounter(99, 0, rng), null, '無いエリア')
})
