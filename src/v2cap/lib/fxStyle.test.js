// v2cap 演出の段階と色（強化・宝樹のおみくじ）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enhanceTierOf, enhanceChargeMsOf, enhanceTitleOf, OMIKUJI_STYLE, OMIKUJI_FORTUNE_NAMES, omikujiStyleOf, kanjiNumberOf } from './fxStyle.js'
import { PLUS_MAX } from './smith.js'

test('【確定】強化の演出：+1〜+10 のどれにも段階がある・高いほど派手（+10は虹）', () => {
  const order = ['blue', 'purple', 'gold', 'max']
  let prev = 0
  for (let p = 1; p <= PLUS_MAX; p++) {
    const t = enhanceTierOf(p)
    assert.ok(t && t.colors.length > 0, `+${p}`)
    const i = order.indexOf(t.key)
    assert.ok(i >= prev, `+${p} は前より控えめにならない`)
    prev = i
  }
  assert.equal(enhanceTierOf(PLUS_MAX).key, 'max')
  assert.equal(enhanceTierOf(1).key, 'blue')
})

test('【確定】強化のためる時間は成功率が低いほど長い（90%で1.6秒・10%で2.4秒）', () => {
  assert.equal(enhanceChargeMsOf(90), 1600)
  assert.equal(enhanceChargeMsOf(10), 2400)
  assert.ok(enhanceChargeMsOf(100) <= enhanceChargeMsOf(50))
})

test('【確定】強化の結果のポップアップは「○○の強化に成功！／失敗…」（ユーザーの書き方）', () => {
  assert.equal(enhanceTitleOf('見習いの短剣', true), '見習いの短剣の強化に成功！')
  assert.equal(enhanceTitleOf('見習いの短剣', false), '見習いの短剣の強化に失敗…')
})

test('【確定】おみくじ：どの運勢にも見た目があり、大吉がいちばん派手・凶と大凶は暗いもや', () => {
  for (const name of OMIKUJI_FORTUNE_NAMES) assert.ok(OMIKUJI_STYLE[name], `${name} の見た目`)
  const lv = (n) => omikujiStyleOf(n).level
  assert.ok(lv('大吉') > lv('中吉') && lv('中吉') > lv('小吉') && lv('小吉') > lv('吉') && lv('吉') > lv('末吉') && lv('末吉') > lv('凶') && lv('凶') > lv('大凶'))
  assert.ok(omikujiStyleOf('凶').mist && omikujiStyleOf('大凶').mist)
  assert.ok(!omikujiStyleOf('大吉').mist && omikujiStyleOf('大吉').fall)
})

test('みくじ棒の番号は漢数字（1〜100）', () => {
  assert.equal(kanjiNumberOf(1), '一')
  assert.equal(kanjiNumberOf(10), '十')
  assert.equal(kanjiNumberOf(13), '十三')
  assert.equal(kanjiNumberOf(40), '四十')
  assert.equal(kanjiNumberOf(99), '九十九')
  assert.equal(kanjiNumberOf(100), '百')
})
