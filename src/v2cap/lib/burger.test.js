// v2cap：ハンバーガー屋「ニャーガーキング」の決まりを固定するテスト（node --test）
// 【確定】2026-10-25 ユーザー指示（値段・時間・効き目・組の中身・名前は burger.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIL_KEYS } from '../core/ailments.js'
import {
  SHOP_NAME, MEAL_MINUTES, MEAL_MS, BURGER_GOLD, TOPPING_GOLD, MEAL_STAT_PCT, TOPPING_RESIST_PCT,
  BURGERS, MEAL_STATS, TOPPINGS, TOPPING_GROUPS, toppingsOf, mealCostOf, activeMealOf, mealStatPctOf, mealFxOf, leftText, mealLineOf, mealPartsOf,
} from './burger.js'
import { statBreakdown, toFighter } from './loadout.js'

const NOW = Date.parse('2026-10-25T12:00:00+09:00')
const until = (min) => new Date(NOW + min * 60000).toISOString()

test('店の名前・60分・バーガー1,000G・トッピング500G・ステ+10%・確率−20%（ユーザーの数字）', () => {
  assert.equal(SHOP_NAME, 'ニャーガーキング')
  assert.equal(MEAL_MINUTES, 60)
  assert.equal(MEAL_MS, 3600000)
  assert.equal(BURGER_GOLD, 1000)
  assert.equal(TOPPING_GOLD, 500)
  assert.equal(MEAL_STAT_PCT, 10)
  assert.equal(TOPPING_RESIST_PCT, 20)
  assert.equal(mealCostOf(), 1000)
  assert.equal(mealCostOf({ major: true }), 1500)
  assert.equal(mealCostOf({ minor: true }), 1500)
  assert.equal(mealCostOf({ major: true, minor: true }), 2000)
})

test('バーガーはHP・MP以外の6種で、名前はユーザーの6つ', () => {
  assert.deepEqual(MEAL_STATS, ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'])
  assert.deepEqual(Object.fromEntries(BURGERS.map(b => [b.stat, b.name])), {
    str: 'スパイシーニャッパー', int_stat: 'マッシュルームニャッパー', dex: 'テリヤキニャッパー',
    agi: 'チキンニャッパー', vit: 'アボカドニャッパー', luk: 'チーズニャッパー',
  })
})

test('トッピングはメジャー5種・マイナー6種。回復阻害とサイレンスは入れない・状態異常は1つずつ', () => {
  assert.deepEqual(TOPPING_GROUPS.map(g => g.key), ['major', 'minor'])
  assert.deepEqual(toppingsOf('major').map(t => t.ail), ['bleed', 'poison', 'slow', 'paralyze', 'burn'])
  assert.deepEqual(toppingsOf('minor').map(t => t.ail), ['seal', 'fear', 'blind', 'curse', 'frenzy', 'weaken'])
  assert.equal(new Set(TOPPINGS.map(t => t.ail)).size, TOPPINGS.length)
  for (const t of TOPPINGS) assert.ok(AIL_KEYS.includes(t.ail), t.ail)
  assert.ok(!TOPPINGS.some(t => t.ail === 'healCut' || t.ail === 'silence'))
})

test('トッピングの名前はバーガーの名前とかぶらない（チーズ・アボカドはバーガーのほう）', () => {
  assert.equal(new Set(TOPPINGS.map(t => t.name)).size, TOPPINGS.length)
  for (const t of TOPPINGS) for (const b of BURGERS) assert.ok(!b.name.includes(t.name), `${t.name} と ${b.name}`)
  assert.equal(TOPPINGS.find(t => t.ail === 'seal').name, 'エッグ')
  assert.equal(TOPPINGS.find(t => t.ail === 'weaken').name, 'パイナップル')
})

test('効いている食事：期限の前だけ。組の違うトッピング・知らないバーガーは数えない', () => {
  const p = { meal_burger: 'str', meal_major: 'poison', meal_minor: 'curse', meal_until: until(30) }
  const m = activeMealOf(p, NOW)
  assert.equal(m.stat, 'str')
  assert.equal(m.major, 'poison')
  assert.equal(m.minor, 'curse')
  assert.equal(m.leftMs, 30 * 60000)
  assert.equal(activeMealOf({ ...p, meal_until: until(0) }, NOW), null)
  assert.equal(activeMealOf({ ...p, meal_until: until(-1) }, NOW), null)
  assert.equal(activeMealOf({ ...p, meal_until: null }, NOW), null)
  assert.equal(activeMealOf({ ...p, meal_burger: 'hp' }, NOW), null)
  assert.equal(activeMealOf({}, NOW), null)
  const swapped = activeMealOf({ ...p, meal_major: 'curse', meal_minor: 'poison' }, NOW)
  assert.equal(swapped.major, null)
  assert.equal(swapped.minor, null)
  assert.equal(mealLineOf(m), 'スパイシーニャッパー＋ピクルス・ガーリック')
  assert.equal(mealLineOf(activeMealOf({ meal_burger: 'luk', meal_until: until(5) }, NOW)), 'チーズニャッパー')
  // ホームは切れ目でだけ折り返す（名前の途中で折れない）
  assert.deepEqual(mealPartsOf(m), ['スパイシーニャッパー', '＋ピクルス', '・ガーリック'])
  assert.deepEqual(mealPartsOf(activeMealOf({ meal_burger: 'luk', meal_minor: 'fear', meal_until: until(5) }, NOW)), ['チーズニャッパー', '＋ベーコン'])
  assert.deepEqual(mealPartsOf(null), [])
  assert.equal(mealLineOf(null), '')
})

test('効き目：ステは1つだけ+10%・トッピングはその状態異常の確率に0.8を掛ける', () => {
  const m = activeMealOf({ meal_burger: 'agi', meal_major: 'bleed', meal_until: until(10) }, NOW)
  assert.deepEqual(mealStatPctOf(m), { agi: 10 })
  assert.deepEqual(mealFxOf(m), { resist: { bleed: 0.8 } })
  assert.deepEqual(mealStatPctOf(null), {})
  assert.equal(mealFxOf(null), null)
  assert.equal(mealFxOf(activeMealOf({ meal_burger: 'agi', meal_until: until(10) }, NOW)), null)
})

test('残り時間の文', () => {
  assert.equal(leftText(60 * 60000), '残り1時間')
  assert.equal(leftText(42 * 60000), '残り42分')
  assert.equal(leftText(30 * 1000), '残り1分')
  assert.equal(leftText(0), '残り0分')
})

// 戦闘のキャラ：食事はステの合計（セットのあと）に掛け、トッピングは setFx の resist に重ねる
const PROF = { username: 'テスト', class: '剣士', lv: 10, hp: 120, mp: 30, str: 40, dex: 20, agi: 20, int_stat: 10, vit: 30, luk: 10, jobs: {}, equipped: {} }

test('食事が効いていれば、そのステの合計が+10%（四捨五入）。meal:null なら食事なし', () => {
  const fed = { ...PROF, meal_burger: 'str', meal_major: 'poison', meal_until: new Date(Date.now() + 600000).toISOString() }
  const plain = statBreakdown(PROF, [])
  const bd = statBreakdown(fed, [])
  assert.equal(bd.food.str, Math.round(plain.total.str * 0.1))
  assert.equal(bd.total.str, plain.total.str + bd.food.str)
  for (const k of ['hp', 'mp', 'dex', 'agi', 'int_stat', 'vit', 'luk']) assert.equal(bd.total[k], plain.total[k], k)
  assert.ok(bd.power > plain.power)
  assert.deepEqual(statBreakdown(fed, [], { meal: null }).total, plain.total)

  const f = toFighter(fed, [])
  assert.equal(f.stats.str, bd.total.str)
  assert.equal(f.setFx.resist.poison, 0.8)
  assert.equal(f.setFx.names.resist, 'ニャーガーキング')
  const f0 = toFighter(fed, [], { meal: null })
  assert.equal(f0.stats.str, plain.total.str)
  assert.equal(f0.setFx?.resist?.poison, undefined)
})

test('期限が切れた食事は戦闘に入らない', () => {
  const old = { ...PROF, meal_burger: 'str', meal_major: 'poison', meal_until: new Date(Date.now() - 1000).toISOString() }
  assert.deepEqual(toFighter(old, []).stats, toFighter(PROF, []).stats)
  assert.equal(toFighter(old, []).setFx?.resist?.poison, undefined)
})
