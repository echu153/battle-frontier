// エンチャント（特殊能力）と状態異常のテスト。
// 数値の正は docs/v2-enchant-design.md。ここは「その通りに動くか」を1つずつ固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENCHANTS, collectEnchants, inflictChance, dropRateMultOf, enchantChanceOf } from './enchant.js'
import { allEnemies } from './enemies.js'
import {
  createAilments, inflict, tickAilments, healMultOf, consumeParalyze, hasAilment,
  BLEED_MAX_STACKS, POISON_TURNS, tickBleed,
} from './ailments.js'
import { runBattle, createSide, liveStats } from './battle.js'

// 一定の乱数（確率判定が必ず成功する側）
const always = () => 0

// ===== 定義の網羅 =====
// ★再発検出テスト：敵を足したら特殊能力も足す、を強制する
test('特殊能力は敵180体すべてに1つずつ定義されている', () => {
  const names = allEnemies().map(e => e.name)
  assert.equal(names.length, 180, '15エリア × (通常3＋時間帯3＋ボス1＋レア5)')
  assert.deepEqual(names.filter(n => !ENCHANTS[n]), [], '敵にあって特殊能力が無い')
  assert.deepEqual(Object.keys(ENCHANTS).filter(k => !names.includes(k)), [], '特殊能力にあって敵が無い')
})

test('特殊能力が付く確率は 通常0% / レア1% / 激レア3%', () => {
  assert.equal(enchantChanceOf('normal'), 0)
  assert.equal(enchantChanceOf('rare'), 1)
  assert.equal(enchantChanceOf('ultra'), 3)
})

// ===== まとめ方 =====
test('同じ特殊能力を複数つけると重複して足される', () => {
  const one = collectEnchants(['スライム'])
  const two = collectEnchants(['スライム', 'スライム'])
  assert.equal(one.physCutPct, 2)
  assert.equal(two.physCutPct, 4)
})

test('素材ドロップ率upだけは重複せず、一番高いものが効く', () => {
  // ×1.2・×1.3・×1.4・×1.5 を全部つけても ×1.5
  const all = ['盗賊', '海賊', '宵闇の山猫', '星降りのヴァルキリー']
  assert.equal(dropRateMultOf(all), 1.5)
  assert.equal(dropRateMultOf(['盗賊', '盗賊']), 1.2)
})

test('時間帯つきの能力はその時間帯でだけ乗る', () => {
  assert.equal(collectEnchants(['月夜のフクロウ'], '晩').statPct.int_stat, 5)
  assert.equal(collectEnchants(['月夜のフクロウ'], '朝').statPct.int_stat, undefined)
  // 「朝〜昼」は2つの時間帯にまたがる
  assert.equal(collectEnchants(['陽炎のイフリート'], '朝').statPct.int_stat, 10)
  assert.equal(collectEnchants(['陽炎のイフリート'], '昼').statPct.int_stat, 10)
  assert.equal(collectEnchants(['陽炎のイフリート'], '晩').statPct.int_stat, undefined)
})

test('時間帯つきの与ダメージupは物理／魔法の枠へ入る', () => {
  assert.equal(collectEnchants(['陽射しの大猿'], '昼').physDmgPct, 8)
  assert.equal(collectEnchants(['陽射しの大猿'], '晩').physDmgPct, 0)
})

test('band を渡さなければ時間帯つきの能力は常に有効（画面のプレビュー用）', () => {
  assert.equal(collectEnchants(['月夜のフクロウ']).statPct.int_stat, 5)
})

// ===== 状態異常 =====
test('出血：スタック上限5・現在HPの1%×スタック・3回刻んで消える（刻むのは行動した直後）', () => {
  const ail = createAilments()
  for (let i = 0; i < 8; i++) inflict(ail, 'bleed')
  assert.equal(ail.bleed.stacks, BLEED_MAX_STACKS)

  // 現在HP10000・5スタック → 10000×1%×5 = 500
  let hp = 10000
  const hits = []
  for (let t = 0; t < 4; t++) {
    const tick = tickBleed(ail, hp)
    if (!tick) break
    hp -= tick.damage
    hits.push(tick.damage)
  }
  assert.deepEqual(hits, [500, 475, 451])   // 3回で終わり。現在HP基準なので減衰する
  assert.equal(hasAilment(ail, 'bleed'), false)
})

test('出血を付け直すと消えるまでの数え直しになる', () => {
  const ail = createAilments()
  inflict(ail, 'bleed')
  tickBleed(ail, 1000)
  tickBleed(ail, 1000)
  assert.equal(ail.bleed.age, 2)
  inflict(ail, 'bleed')            // 付け直し
  assert.equal(ail.bleed.age, 0)
  assert.equal(ail.bleed.stacks, 2)
})

test('毒は旧版と同じ：最大HPの3%を4ターン・すでに毒なら重ねて入らない', () => {
  const ail = createAilments()
  assert.equal(inflict(ail, 'poison'), true)
  assert.equal(inflict(ail, 'poison'), false)   // 重ねて入らない
  assert.equal(ail.poison.turns, POISON_TURNS)

  const hits = []
  for (let t = 0; t < 6; t++) {
    const ticks = tickAilments(ail, { hp: 5000, maxHp: 10000 })
    const p = ticks.find(x => x.key === 'poison')
    if (!p) break
    hits.push(p.damage)
  }
  assert.deepEqual(hits, [300, 300, 300, 300])  // 最大HP基準なので減衰しない
})

test('鈍足はAGI-20%・4ターン', () => {
  const ail = createAilments()
  inflict(ail, 'slow')
  const side = { base: { agi: 100 }, buffs: {}, ail, enStacks: {}, en: collectEnchants([]), pa: { rages: [], lowHps: [], switches: [], converts: [] }, rage: 0, hp: 1, switchOn: false }
  assert.equal(liveStats(side).agi, 80)
  for (let t = 0; t < 4; t++) tickAilments(ail, { hp: 100, maxHp: 100 })
  assert.equal(hasAilment(ail, 'slow'), false)
})

test('麻痺は1ターンぶんで、見た時点で消える', () => {
  const ail = createAilments()
  inflict(ail, 'paralyze')
  assert.equal(consumeParalyze(ail), true)
  assert.equal(consumeParalyze(ail), false)
})

test('回復阻害は回復量を指定%だけ下げる。重ねがけは強いほうを採る', () => {
  const ail = createAilments()
  inflict(ail, 'healCut', { pct: 20 })
  assert.equal(healMultOf(ail), 0.8)
  inflict(ail, 'healCut', { pct: 50 })
  assert.equal(healMultOf(ail), 0.5)
  inflict(ail, 'healCut', { pct: 20 })   // 弱いほうでは上書きされない
  assert.equal(healMultOf(ail), 0.5)
})

test('状態異常の抵抗は付与確率から引かれる', () => {
  const wyvern = collectEnchants(['払暁のワイバーン'])   // 全状態異常抵抗+5%
  const shroom = collectEnchants(['毒キノコ'])           // 毒だけ-10%
  assert.equal(inflictChance(10, wyvern, 'bleed'), 5)
  assert.equal(inflictChance(10, shroom, 'poison'), 0)
  assert.equal(inflictChance(10, shroom, 'bleed'), 10)   // 毒以外には効かない
  assert.equal(inflictChance(3, wyvern, 'bleed'), 0)     // マイナスにはならない
})

// ===== 戦闘への反映 =====
const dummy = (over = {}) => ({
  name: 'A', kind: 'phys',
  stats: { hp: 4000, mp: 200, str: 200, dex: 100, agi: 100, int_stat: 50, vit: 100, luk: 50 },
  slots: [{ skill: { name: 'なぐる', kind: 'phys', mult: 1.0, proc: 100, mp: 0 }, uses: 99 }],
  ...over,
})

test('AGIの5%をSTRに加算する能力は、元のAGIを減らさない（魔導剣術との違い）', () => {
  const side = createSide(dummy({ enchants: ['雷鷲サンダーロック'] }))
  const eff = liveStats(side)
  assert.equal(eff.agi, 100)          // 元は減らない
  assert.equal(eff.str, 200 + 5)      // AGI100の5%が乗る
})

// Aが与えた最初のダメージ（ログの side は攻撃した側の名前）
const firstDamageByA = (r) => r.log.find(l => l.side === 'A' && l.damage > 0).damage

test('物理ダメージ軽減は受けるダメージを減らす', () => {
  const noCut = runBattle(dummy(), dummy({ name: 'B' }), { rng: always, maxTurns: 1 })
  const cut = runBattle(dummy(), dummy({ name: 'B', enchants: ['ビッグスライム'] }), { rng: always, maxTurns: 1 })
  assert.equal(firstDamageByA(cut), Math.floor(firstDamageByA(noCut) * 0.9), '軽減10%が効いていない')
})

test('物理ダメージupは与えるダメージを増やす', () => {
  const plain = runBattle(dummy(), dummy({ name: 'B' }), { rng: always, maxTurns: 1 })
  const up = runBattle(dummy({ enchants: ['陽炎リザード'] }), dummy({ name: 'B' }), { rng: always, maxTurns: 1 })
  assert.equal(firstDamageByA(up), Math.floor(firstDamageByA(plain) * 1.04), '与ダメージ+4%が効いていない')
})

test('出血を持つ相手を殴ると出血が入り、ターン終わりに刻まれる', () => {
  const r = runBattle(
    dummy({ enchants: ['盗賊団のリーダー'] }),   // 物理ヒット時30%で出血
    dummy({ name: 'B' }),
    { rng: always, maxTurns: 3 },
  )
  assert.ok(r.log.some(l => l.type === 'ailment' && l.ail === '出血'), '出血が入っていない')
  assert.ok(r.log.some(l => l.type === 'ailTick' && l.ail === '出血'), '出血が刻まれていない')
})

test('麻痺している側はそのターン行動しない', () => {
  const r = runBattle(
    dummy({ enchants: ['雷雲の精霊'] }),   // ヒット時5%で麻痺（rng=always なので必ず入る）
    dummy({ name: 'B' }),
    { rng: always, maxTurns: 3 },
  )
  assert.ok(r.log.some(l => l.type === 'paralyzed' && l.side === 'B'), 'Bが麻痺していない')
})

test('跳ね返しは最初の1回だけ・同じ種別のダメージにしか効かない', () => {
  const magAtk = dummy({
    kind: 'mag',
    slots: [{ skill: { name: 'まほう', kind: 'mag', mult: 1.0, proc: 100, mp: 0 }, uses: 99 }],
  })
  const r = runBattle(magAtk, dummy({ name: 'B', enchants: ['天空覇龍ウラノス'] }), { rng: always, maxTurns: 5 })
  assert.equal(r.log.filter(l => l.type === 'reflect').length, 1)
  // 物理には効かない
  const r2 = runBattle(dummy(), dummy({ name: 'B', enchants: ['天空覇龍ウラノス'] }), { rng: always, maxTurns: 5 })
  assert.equal(r2.log.filter(l => l.type === 'reflect').length, 0)
})

test('スケルトンの軽減バフは1回ダメージを受けると消える', () => {
  const r = runBattle(dummy(), dummy({ name: 'B', enchants: ['スケルトン'] }), { rng: always, maxTurns: 3 })
  assert.equal(r.log.filter(l => l.type === 'enCut').length, 1)
})

test('当てるたびに積むスタックは上限で止まる', () => {
  const r = runBattle(
    dummy({ enchants: ['氷河ドラゴン'] }),   // ヒット時 敵のSTR-2%（重複10）
    dummy({ name: 'B' }),
    { rng: always, maxTurns: 30 },
  )
  assert.equal(r.b.enStacks.str, -20)   // -2% × 10 で止まる
})

test('エンチャントを持たない戦闘はこれまでと同じ結果になる', () => {
  const seed = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 })()
  const a = runBattle(dummy(), dummy({ name: 'B' }), { rng: seed, maxTurns: 50 })
  assert.ok(a.log.every(l => l.type !== 'ailment' && l.type !== 'reflect' && l.type !== 'enCut'))
})

test('回避率・命中率・発動率への加算は combat.js のボーナス枠へ渡る', () => {
  assert.equal(createSide(dummy({ enchants: ['天翼のハーピー'] })).en.evaBonus, 3)
  assert.equal(createSide(dummy({ enchants: ['グリフォン'] })).en.hitBonus, 3)
  assert.equal(createSide(dummy({ enchants: ['白昼のペガサス'] })).en.procBonus, 5)
})
