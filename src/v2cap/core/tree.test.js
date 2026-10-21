// バトルフロンティアⅡ「ユグレシアの宝樹」の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORTUNES, TOTAL_WEIGHT, chanceOf, rollFortune,
  PRAY_GOLD, PRAY_EXP, rewardOf, rewardText,
  prayDayOf, canPray, nextPrayAt, remainUntilPray, DAY_RESET_HOUR,
} from './tree.js'

test('大吉〜大凶の並びと重みはサーバー（v2_pray）と同じ', () => {
  // ★ここを変えたら supabase_v2_core.sql の v2_pray の c_names / c_weight も直すこと。
  //   片方だけ直すと「画面に出ている確率」と「実際に引かれる確率」がズレる。
  assert.deepEqual(FORTUNES.map(f => f.name), ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'])
  assert.deepEqual(FORTUNES.map(f => f.weight), [5, 10, 15, 25, 20, 15, 10])
  assert.equal(TOTAL_WEIGHT, 100)
  assert.equal(chanceOf(FORTUNES[0]), 5)
  for (const f of FORTUNES) assert.ok(f.id && f.color && f.text, `${f.name} の中身がそろっている`)
})

test('抽選は重みどおりに出る', () => {
  // 端を直接指定して、どの帯に入るかを確かめる
  assert.equal(rollFortune(() => 0).name, '大吉')            // 0〜5
  assert.equal(rollFortune(() => 0.049).name, '大吉')
  assert.equal(rollFortune(() => 0.05).name, '中吉')         // 5〜15
  assert.equal(rollFortune(() => 0.30).name, '吉')           // 30〜55
  assert.equal(rollFortune(() => 0.9999).name, '大凶')       // 90〜100

  // 一様乱数を回したときの実測が重みに近いこと
  const count = {}
  const n = 100_000
  let seed = 12345
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < n; i++) { const f = rollFortune(rng); count[f.name] = (count[f.name] || 0) + 1 }
  for (const f of FORTUNES) {
    const pct = (count[f.name] / n) * 100
    assert.ok(Math.abs(pct - f.weight) < 1, `${f.name} は約${f.weight}% だが ${pct.toFixed(2)}%`)
  }
})

test('日付が変わるのは日本時間の5時', () => {
  assert.equal(DAY_RESET_HOUR, 5)
  // JST 8/17 04:59 → まだ 8/16 ぶん
  assert.equal(prayDayOf(new Date('2026-08-16T19:59:00Z')), '2026-08-16')
  // JST 8/17 05:00 → 8/17 ぶんに変わる
  assert.equal(prayDayOf(new Date('2026-08-16T20:00:00Z')), '2026-08-17')
  // JST の昼はその日ぶん
  assert.equal(prayDayOf(new Date('2026-08-16T03:00:00Z')), '2026-08-16')  // JST 12:00
})

test('祈れるかどうかは「同じ日ぶんを祈ったか」で決まる', () => {
  const jst = (s) => new Date(s)
  assert.equal(canPray(null, jst('2026-08-16T03:00:00Z')), true)              // 一度も祈っていない
  // JST 8/16 12:00 に祈った → 同じ日の 8/17 04:59（JST）はまだ祈れない
  assert.equal(canPray(jst('2026-08-16T03:00:00Z'), jst('2026-08-16T19:59:00Z')), false)
  // JST 8/17 05:00 を回れば祈れる
  assert.equal(canPray(jst('2026-08-16T03:00:00Z'), jst('2026-08-16T20:00:00Z')), true)
})

test('次に祈れる時刻は日本時間の5時ちょうど', () => {
  // JST 8/16 19:00 に見ている → 次は JST 8/17 05:00 ＝ UTC 8/16 20:00
  assert.equal(nextPrayAt(new Date('2026-08-16T10:00:00Z')).toISOString(), '2026-08-16T20:00:00.000Z')
  // 残り時間もそこから引いた値になる
  const r = remainUntilPray(new Date('2026-08-16T03:00:00Z'), new Date('2026-08-16T10:00:00Z'))
  assert.equal(r.total, 10 * 3600)
  assert.deepEqual([r.h, r.m, r.s], [10, 0, 0])
  // 祈れる状態なら0
  assert.equal(remainUntilPray(null, new Date('2026-08-16T10:00:00Z')).total, 0)
})

test('報酬はベース300G・EXP30に結果の倍率を掛ける', () => {
  assert.equal(PRAY_GOLD, 300)
  assert.equal(PRAY_EXP, 30)
  const kichi = FORTUNES.find(f => f.name === '吉')
  assert.deepEqual(rewardOf(kichi), { gold: 300, exp: 30 }, '「吉」がちょうどベース')
  assert.deepEqual(rewardOf(FORTUNES.find(f => f.name === '大吉')), { gold: 900, exp: 90 })
  assert.deepEqual(rewardOf(FORTUNES.find(f => f.name === '大凶')), { gold: 60, exp: 6 })
  assert.equal(rewardText(kichi), '300G・EXP+30')
})

test('良い結果ほど多くもらえる（並びと逆転しない）', () => {
  for (let i = 1; i < FORTUNES.length; i++) {
    assert.ok(FORTUNES[i - 1].mult > FORTUNES[i].mult,
      `${FORTUNES[i - 1].name} > ${FORTUNES[i].name} でない`)
  }
})

test('ならすとベースとほぼ同じになる（期待値が偏っていない）', () => {
  // ★ここが大きくズレると「毎日祈るとGoldが湧く／枯れる」になる
  const exp = FORTUNES.reduce((t, f) => t + (f.weight / TOTAL_WEIGHT) * f.mult, 0)
  assert.ok(Math.abs(exp - 1) < 0.1, `期待値の倍率 ${exp.toFixed(3)}（1.0から離れすぎ）`)
})
