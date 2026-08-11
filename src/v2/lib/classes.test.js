// バトルフロンティアⅡ 職業の条件判定テスト（node --test）
// ※職業マスタの正はDBの v2_classes。ここでは同じ形のデータを作って判定だけを検証する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  START_CLASS, TIER_LABEL, TIER_ORDER, proofOf, proofCount, hasProof,
  missingReqs, canBecome, reqText, totalJobChanges,
} from './classes.js'

const noble   = { id:START_CLASS, tier:'start',    req_jobs:{}, req_proof:null }
const warrior = { id:'戦士',      tier:'basic',    req_jobs:{}, req_proof:null }
const samurai = { id:'侍',        tier:'advanced', req_jobs:{ 戦士:3 }, req_proof:'侍の証' }
const magicSword = { id:'魔法剣士', tier:'hybrid', req_jobs:{ 戦士:3, 魔法使い:3 }, req_proof:'魔法剣士の証' }
const gambler = { id:'ギャンブラー', tier:'special', req_jobs:{}, req_proof:'ギャンブラーの証' }

test('証の名前は職業名から導出できる', () => {
  assert.equal(proofOf('侍'), '侍の証')
  assert.equal(proofOf('精霊召喚士'), '精霊召喚士の証')
  assert.equal(proofOf('ビーストレンジャー'), 'ビーストレンジャーの証')
})

test('初期職は条件なしで転職できる', () => {
  assert.deepEqual(missingReqs(warrior, {}), [])
  assert.equal(canBecome(warrior, {}), true)
  assert.equal(reqText(warrior), '条件なし')
})

test('開始時の職業(ノーブル)には転職できない', () => {
  assert.equal(canBecome(noble, { jobCounts:{}, proofs:{} }), false)
})

test('証の所持は個数で持つ（転職で1個消費するため）', () => {
  assert.equal(proofCount({ 侍の証:2 }, '侍の証'), 2)
  assert.equal(proofCount({}, '侍の証'), 0)
  assert.equal(proofCount(null, '侍の証'), 0)
  assert.equal(hasProof({ 侍の証:1 }, '侍の証'), true)
  assert.equal(hasProof({ 侍の証:0 }, '侍の証'), false)  // 使い切ったら条件を満たさない
})

test('上位職は転職回数と証の両方が要る', () => {
  const none = { jobCounts:{}, proofs:{} }
  assert.equal(canBecome(samurai, none), false)
  assert.deepEqual(missingReqs(samurai, none), ['戦士で転職3回（あと3回）', '侍の証'])

  // 回数だけ足りている
  assert.deepEqual(missingReqs(samurai, { jobCounts:{ 戦士:3 }, proofs:{} }), ['侍の証'])
  // 証だけある
  assert.deepEqual(missingReqs(samurai, { jobCounts:{ 戦士:2 }, proofs:{ 侍の証:1 } }), ['戦士で転職3回（あと1回）'])
  // 両方そろった
  assert.equal(canBecome(samurai, { jobCounts:{ 戦士:3 }, proofs:{ 侍の証:1 } }), true)
  // 使い切った証では転職できない
  assert.equal(canBecome(samurai, { jobCounts:{ 戦士:9 }, proofs:{ 侍の証:0 } }), false)
})

test('複合上位職は2つの初期職の回数がどちらも要る', () => {
  const half = { jobCounts:{ 戦士:5, 魔法使い:1 }, proofs:{ 魔法剣士の証:1 } }
  assert.deepEqual(missingReqs(magicSword, half), ['魔法使いで転職3回（あと2回）'])
  assert.equal(canBecome(magicSword, half), false)
  assert.equal(canBecome(magicSword, { jobCounts:{ 戦士:3, 魔法使い:3 }, proofs:{ 魔法剣士の証:1 } }), true)
  assert.equal(reqText(magicSword), '戦士で転職3回 ／ 魔法使いで転職3回 ／ 魔法剣士の証（転職時に1個消費）')
})

test('特殊職は証だけで転職できる', () => {
  assert.equal(canBecome(gambler, { jobCounts:{}, proofs:{} }), false)
  assert.equal(canBecome(gambler, { jobCounts:{}, proofs:{ ギャンブラーの証:1 } }), true)
  assert.equal(reqText(gambler), 'ギャンブラーの証（転職時に1個消費）')
})

test('区分のラベルが揃っている', () => {
  for (const t of TIER_ORDER) assert.ok(TIER_LABEL[t], `${t} のラベルがある`)
  assert.ok(TIER_LABEL.start)
})

test('転職回数の合計が出せる', () => {
  assert.equal(totalJobChanges({ 戦士:3, 魔法使い:2 }), 5)
  assert.equal(totalJobChanges({}), 0)
  assert.equal(totalJobChanges(), 0)
})
