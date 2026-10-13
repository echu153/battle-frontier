// v2cap：安息の祠の決まりを固定するテスト（node --test）
// 【確定】2026-10-13 ユーザー指示「安息の祠を追加・出撃してるとまれに出現（0.1％）・敵はハピネスフェアリーのみ
//   経験値は出現したエリアのベース経験値×５・3～8回戦闘が行われ、最深部に行くと泉の効果でスタミナが全回復する」
//   ＋選択式で決めたこと：フェアリーは弱い／Goldはふつう・装備なし／負けても奥へ進む／スタミナはふつうと同じく使う
// サーバーとの突き合わせは v2capsql.test.js
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import {
  SHRINE_PCT, SHRINE_FIGHTS, SHRINE_EXP_TENTHS, SHRINE_GOLD_TENTHS, SHRINE_FAIRY_RATIO, SHRINE_FAIRY_NAME,
  fairyLvOf, fairyPowerOf, shrineEncounterOf, rollShrineRewards, shrineRewardRangeOf, rollShrineFights, shrineOf,
} from './shrine.js'
import { SPOTS, enemyLvOf, enemyPowerOf, toFighter } from './areas.js'
import { ENEMY_NAMES } from './enemyArt.js'

test('【確定】ユーザーが決めた数：0.1%・3〜8回・経験値×5・Goldはふつう（×1）・フェアリーはふつうの敵の半分', () => {
  assert.equal(SHRINE_PCT, 0.1)
  assert.deepEqual(SHRINE_FIGHTS, [3, 8])
  assert.equal(SHRINE_EXP_TENTHS, 50)
  assert.equal(SHRINE_GOLD_TENTHS, 10)
  assert.equal(SHRINE_FAIRY_RATIO, 0.5)
  assert.equal(SHRINE_FAIRY_NAME, 'ハピネスフェアリー')
  assert.ok(!ENEMY_NAMES.includes(SHRINE_FAIRY_NAME), 'エリアの顔ぶれにはいない（祠の中だけ）')
})

test('ハピネスフェアリーは どの場所でも、LV＝ふつうの敵でいちばん高いLV・強さ＝ふつうの敵の平均の半分（＝弱い）', () => {
  for (const s of SPOTS) {
    const lv = Math.max(...s.roster.enemies.map(e => enemyLvOf(e.name, s.id)))
    assert.equal(fairyLvOf(s.id), lv, s.name)
    const ps = s.roster.enemies.map(enemyPowerOf)
    const avg = ps.reduce((a, b) => a + b, 0) / ps.length
    assert.equal(fairyPowerOf(s.id), Math.max(1, Math.round(avg * SHRINE_FAIRY_RATIO)), s.name)
    assert.ok(fairyPowerOf(s.id) < avg, `${s.name}：ふつうの敵より弱い`)
    const enc = shrineEncounterOf(s.id)
    assert.deepEqual([enc.role, enc.isBoss, enc.enemy.name, enc.enemy.spot, enc.lv, enc.power], ['shrine', false, SHRINE_FAIRY_NAME, s.id, lv, fairyPowerOf(s.id)])
    // 戦闘用のキャラにできる（技は魔法1つ）
    const f = toFighter(enc.enemy, 8, enc.power)
    assert.equal(f.name, SHRINE_FAIRY_NAME)
    assert.equal(f.slots.length, 1)
  }
  assert.equal(shrineEncounterOf(0), null)
  assert.equal(shrineEncounterOf(46), null)
})

test('経験値は場所の表の値×5・Goldはふつうの敵と同じ（四捨五入はサーバーと同じ）。負けたら最低EXPだけ', () => {
  for (const s of SPOTS) {
    assert.deepEqual(rollShrineRewards(s, () => 0), { exp: s.exp[0] * 5, gold: s.gold[0] })
    assert.deepEqual(rollShrineRewards(s, () => 0.99999), { exp: s.exp[1] * 5, gold: s.gold[1] })
    assert.deepEqual(rollShrineRewards(s, () => 0.5, false), { exp: s.exp[0], gold: 0 })
    assert.deepEqual(shrineRewardRangeOf(s), { exp: [s.exp[0] * 5, s.exp[1] * 5], gold: s.gold })
  }
})

test('祠の中の戦闘の数は 3〜8 を均等に（サーバーと同じ引き方）', () => {
  const got = new Set()
  for (let i = 0; i < 600; i++) got.add(rollShrineFights(() => i / 600))
  assert.deepEqual([...got].sort((a, b) => a - b), [3, 4, 5, 6, 7, 8])
  assert.equal(rollShrineFights(() => 0), 3)
  assert.equal(rollShrineFights(() => 0.99999), 8)
})

test('【確定】2026-10-14 画面には最深部まであと何回かを出さない（ユーザー指示「最深部まであといくつかは記載しなくていい」）', () => {
  for (const f of ['../components/V2capSortie.jsx', '../components/V2capShrineFx.jsx', '../pages/V2capHome.jsx']) {
    // コメント（// の行末まで・/* */）は見ない
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    assert.ok(!/最深部まで|\.left\}|\.total\}|回の戦闘/.test(src), `${f}：最深部までの残り・戦闘の数を出していない`)
  }
})

test('いまの祠：プロフィールの列か精算の返事から。残りが0なら祠にいない', () => {
  assert.equal(shrineOf(null), null)
  assert.equal(shrineOf({ shrine_spot: null, shrine_left: 0, shrine_total: 0 }), null)
  assert.equal(shrineOf({ shrine_spot: 99, shrine_left: 2, shrine_total: 3 }), null, '無い場所')
  const p = shrineOf({ shrine_spot: 5, shrine_left: 3, shrine_total: 5 })
  assert.deepEqual(p, { spot: 5, left: 3, total: 5, done: 2, next: 3 })
  assert.deepEqual(shrineOf({ found: true, deepest: false, spot: 7, left: 4, total: 4 }), { spot: 7, left: 4, total: 4, done: 0, next: 1 })
  assert.equal(shrineOf({ found: false, deepest: true, spot: 7, left: 0, total: 4 }), null, '最深部のあとは祠にいない')
})
