// バトルフロンティアⅡ ステータスを伸ばす価値の回帰テスト（node --test）
// ------------------------------------------------------------
// ★装備（武器2・防具4・アクセ2の計8枠）でステータスを狙って伸ばせる設計なので、
//   「どのステを伸ばしても意味がある」状態を壊さないように数字を固定しておく。
//   とくにDEXは2026-08-13まで**伸ばす意味がほぼ無かった**（命中しか仕事が無く、
//   命中には100%の天井があるため最大+11%の保険にしかならなかった）。
//   ここが崩れたら実装を疑うこと。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hitRate, damageFloor, DMG_SPREAD, DMG_COMP, extraActionRate, evasionRate } from './combat.js'

// 8種へ均等に配った戦闘力534（LV100・0転職の平均像）
const even = () => { const u = 534 / 8; return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u } }
// 「相手に通るダメージの期待値」＝ 命中率 × ダメージ倍率の平均
const through = (me, foe, kind = 'phys') => {
  const lo = damageFloor(me, kind)
  return (hitRate(me, foe) / 100) * ((lo + 1) / 2) * DMG_COMP
}

test('DEXを伸ばすと通るダメージが増える（命中と安定度の両方で）', () => {
  const foe = even()
  let prev = 0
  for (const m of [0.25, 0.5, 1, 2, 3, 5, 10]) {
    const me = { ...even(), dex: even().dex * m }
    const v = through(me, foe)
    assert.ok(v > prev, `DEX${m}倍で増えていない（${prev.toFixed(3)} → ${v.toFixed(3)}）`)
    prev = v
  }
})

test('DEXの上限は「通るダメージ×1.25前後」に収まる（伸ばしすぎても壊れない）', () => {
  // ★DEXの仕事は2つとも上限がある：命中は100%まで／安定度は下限1.00まで。
  //   だから装備でいくらDEXを盛っても、この倍率より上には行かない。
  //   ＝DEX特化だけで勝てる型にはならない（意図した設計）
  const foe = even()
  const par = through(even(), foe)
  const maxed = through({ ...even(), dex: 10 ** 7 }, foe)
  const ratio = maxed / par
  assert.ok(ratio > 1.18 && ratio < 1.32, `DEXの上限が想定から外れている: ×${ratio.toFixed(3)}`)
})

test('DEXは相手が誰でも効く（鈍い相手でも無価値にならない）', () => {
  // ★2026-08-13まではここが0だった。命中しか仕事が無いと、
  //   回避の低い相手に対してDEXは文字どおり意味を持たない
  const slow = { ...even(), agi: 1 }
  const par = through(even(), slow)
  const dex3 = through({ ...even(), dex: even().dex * 3 }, slow)
  // 命中はどちらも100%なので、伸びるぶんは全部ダメージの下限ぶん（DEX3倍で+9.7%）
  assert.ok(dex3 / par > 1.08, `鈍い相手にDEXが効いていない: ×${(dex3 / par).toFixed(3)}`)
})

test('同格の命中は95%・差がつくと急に落ちる', () => {
  // ★装備でAGI型・DEX型を作る意味を出すための曲線。ここを緩めると型の意味が消える
  const me = even()
  const foeAt = (m) => ({ ...even(), agi: even().agi * m })
  assert.equal(hitRate(me, foeAt(1)), 95)
  const expected = { 2: 84.1, 3: 73.4, 5: 57, 10: 35.1 }
  for (const [m, v] of Object.entries(expected)) {
    assert.ok(Math.abs(hitRate(me, foeAt(Number(m))) - v) < 0.5,
      `相手AGI${m}倍の命中が ${hitRate(me, foeAt(Number(m)))}%（想定${v}%）`)
  }
  // DEXを3倍積めば大きく取り返せる（AGI型への答えがDEX型であること）
  const dex3 = { ...even(), dex: even().dex * 3 }
  assert.ok(hitRate(dex3, foeAt(10)) - hitRate(me, foeAt(10)) > 30, 'DEXで取り返せていない')
})

test('AGIの強さは回避が本体で、追加行動はつまみにならない', () => {
  // ★追加行動の上限(EXTRA_ACTION_MAX_PCT)を下げてもAGIは弱くならない、という事実の記録。
  //   AGIを抑えたくなったら触るのは回避側（EVA_COEF / EVA_CURVE）
  const u = even().agi
  for (const m of [1.5, 2, 3, 5]) {
    const ea = extraActionRate(u * m, u)
    const ev = evasionRate(even(), { ...even(), agi: u * m })
    assert.ok(ev > ea * 1.5, `AGI${m}倍：回避${ev}% / 追加行動${ea}% — 追加行動のほうが効いてしまっている`)
  }
})

test('ダメージの振れ幅は設計値のまま', () => {
  // 同格 0.68〜1.00倍。DMG_COMP は平均を元に戻す係数なので、平均ダメージは幅を入れる前と同じ
  assert.equal(DMG_SPREAD, 0.65)
  assert.ok(Math.abs(damageFloor(even(), 'phys') - 0.675) < 1e-9)
  assert.ok(Math.abs(((damageFloor(even(), 'phys') + 1) / 2) * DMG_COMP - 1) < 1e-9, '平均が1.00からずれている')
})
