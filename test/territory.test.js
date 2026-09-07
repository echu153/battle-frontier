import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rankOrder,
  rankProgress,
  expandGain,
  dropBonusPP,
  computeAreaControl,
  fmtRemain,
} from '../src/lib/territory.js'

test('rankOrder 序列（高いほど大きい・不明は0）', () => {
  assert.equal(rankOrder('二等兵'), 0)
  assert.equal(rankOrder('大将'), 15)
  assert.equal(rankOrder('元帥'), 18)
  assert.equal(rankOrder('存在しない階級'), 0)
})

test('rankProgress 貢献度→現在/次の階級と残り', () => {
  const r0 = rankProgress(0)
  assert.equal(r0.current, '二等兵')
  assert.equal(r0.next, '一等兵')
  assert.equal(r0.nextAt, 500)
  assert.equal(r0.remain, 500)

  const r500 = rankProgress(500)
  assert.equal(r500.current, '一等兵')
  assert.equal(r500.remain, 1000) // 1500 - 500

  const rMax = rankProgress(500000)
  assert.equal(rMax.current, '大将')
  assert.equal(rMax.next, null) // 自動昇格の最高位
  assert.equal(rMax.remain, 0)

  // 不正入力は0扱い
  assert.equal(rankProgress(-1).current, '二等兵')
})

test('expandGain 領地拡大量（下限10・上限クランプ）', () => {
  assert.equal(expandGain(0), 10) // floor(10 + 0/20)
  assert.equal(expandGain(2000), 110) // floor(10 + 100)
  assert.equal(expandGain(200000), 5010) // power は 100000 でクランプ → floor(10 + 5000)
  assert.equal(expandGain(-50), 10) // 負値は0扱い
})

test('dropBonusPP シェア→ドロップ率加算(%)（0〜2でクランプ）', () => {
  assert.equal(dropBonusPP(0), 0)
  assert.equal(dropBonusPP(0.5), 1)
  assert.equal(dropBonusPP(1), 2) // 上限 +2%
  assert.equal(dropBonusPP(5), 2) // 1超はクランプ
  assert.equal(dropBonusPP(-1), 0)
})

test('computeAreaControl エリア支配国・シェア・合計', () => {
  const rows = [
    { area_id: 1, country_id: 'A', amount: 30 },
    { area_id: 1, country_id: 'B', amount: 10 },
    { area_id: 2, country_id: 'B', amount: 5 },
  ]
  const out = computeAreaControl(rows)
  assert.equal(out['1'].topCountryId, 'A')
  assert.equal(out['1'].total, 40)
  assert.ok(Math.abs(out['1'].share - 0.75) < 1e-9)
  assert.equal(out['2'].topCountryId, 'B')
  assert.equal(out['2'].share, 1)
  assert.deepEqual(computeAreaControl([]), {})
})

test('fmtRemain 残り時間の表記', () => {
  assert.equal(fmtRemain(0), '0:00')
  assert.equal(fmtRemain(-1000), '0:00')
  assert.equal(fmtRemain(65 * 1000), '1:05') // 65秒 → m:ss
  assert.equal(fmtRemain(2 * 3600 * 1000), '2時間0分') // 時間表記
  assert.equal(fmtRemain(2 * 86400 * 1000), '2日0時間') // 日表記
})
