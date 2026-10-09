// v2cap：装備の強化と分解の決まりを固定するテスト（node --test）
// 【確定】は 2026-10-10 ユーザー決定（docs/v2cap-design.md §5「強化と分解」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_STATS, calcPower } from '../../v2/lib/stats.js'
import { ITEMS, ITEM_BY_ID, AREA_COUNT, itemOf } from './equipment.js'
import { AREA_LIST } from './areas.js'
import { powerAt, statsAt, effectPct } from './gear.js'
import { statBreakdown } from './loadout.js'
import {
  PLUS_MAX, plusOf, plusMultOf, plusLabel, SCRAP_NAMES, scrapNameOf, scrapOf, SCRAP_YIELD, scrapYieldOf,
  dismantleGainOf, bulkPickable, ENHANCE_SCRAP, ENHANCE_RATE, ENHANCE_GOLD_PER_LV, enhanceGoldOf,
  enhanceCostOf, enhanceErrorOf, rollEnhance, expectedEnhanceCost,
} from './smith.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('【確定】残骸はエリアごとに1種（ユーザーの表・星霧→星霜）。並びはエリアの番号と同じ', () => {
  assert.deepEqual(SCRAP_NAMES, [
    '新緑の残骸', '荒野の残骸', '洞窟の残骸', '近海の残骸', '灼砂の残骸',
    '山脈の残骸', '樹海の残骸', '霊峰の残骸', '雷崖の残骸', '煉獄の残骸',
    '腐海の残骸', '奈落の残骸', '蒼天の残骸', '星霜の残骸', '深海の残骸',
  ])
  assert.equal(SCRAP_NAMES.length, AREA_LIST.length)
  assert.equal(SCRAP_NAMES.length, AREA_COUNT)
  assert.equal(scrapNameOf(1), '新緑の残骸')
  assert.equal(scrapNameOf(14), '星霜の残骸', 'エリア名「星霜の遺跡」に合わせた')
  assert.equal(AREA_LIST[13].name, '星霜の遺跡')
  // 持っている数（サーバーは {"エリアの番号": 個数}）。SQLを流す前（materials が無い）は0
  assert.equal(scrapOf({ 1: 12, 3: 4 }, 1), 12)
  assert.equal(scrapOf({ 1: 12 }, 2), 0)
  assert.equal(scrapOf(undefined, 1), 0)
})

test('【確定】分解で入る残骸はレア度で決まる：ノーマル1・レア5・エピック10・レジェンダリー25（その装備のエリアの残骸）', () => {
  assert.deepEqual(SCRAP_YIELD, { N:1, R:5, E:10, L:25 })
  for (const item of ITEMS) assert.equal(scrapYieldOf(item), SCRAP_YIELD[item.rarity], item.id)
  const rows = ['1N:片手剣', '1N:リング', '1R:斧', '2L:重鎧鎧', '2E:杖'].map(id => ({ item: ITEM_BY_ID[id] }))
  assert.deepEqual(dismantleGainOf(rows), { 1: 1 + 1 + 5, 2: 25 + 10 })
})

test('【確定】まとめて選ぶときは、着けているものと強化したもの（+1以上）を入れない（1つずつなら選べる）', () => {
  const worn = new Set(['1'])
  assert.equal(bulkPickable({ inv: { id: 1, plus: 0 } }, worn), false, '着けているもの')
  assert.equal(bulkPickable({ inv: { id: 2, plus: 3 } }, worn), false, '強化したもの')
  assert.equal(bulkPickable({ inv: { id: 3, plus: 0 } }, worn), true)
  assert.equal(bulkPickable({ inv: { id: 4 } }, worn), true, 'SQLを流す前の行（plus が無い）は+0')
})

test('【確定】強化値は+10まで。+1ごとに元の強さの0.1倍ずつ足す（足し算：+5で1.5倍・+10で2倍）', () => {
  assert.equal(PLUS_MAX, 10)
  assert.equal(plusMultOf(0), 1)
  assert.equal(plusMultOf(1), 1.1)
  assert.equal(plusMultOf(5), 1.5)
  assert.equal(plusMultOf(10), 2)
  assert.equal(plusOf({ plus: 12 }), 10, '上限より上は上限')
  assert.equal(plusOf({}), 0)
  assert.equal(plusLabel(0), '')
  assert.equal(plusLabel(3), '+3')
  for (const item of ITEMS.filter(i => i.area === 1 || i.area === 15)) {
    let prev = 0
    for (let p = 0; p <= PLUS_MAX; p++) {
      const pw = powerAt(item, item.lv, p)
      assert.ok(pw >= prev, `${item.id} +${p} は弱くならない`)
      prev = pw
    }
    // 丸めは倍率を掛けたあとに1回だけ＝+10は+0のほぼ2倍（丸めの差は1まで）
    assert.ok(Math.abs(powerAt(item, item.lv, 10) - 2 * powerAt(item, item.lv)) <= 1, `${item.id} +10 ≒ 2倍`)
    assert.equal(powerAt(item, item.lv, 0), powerAt(item, item.lv), '+0は前と同じ強さ')
  }
})

test('強化した強さは必要LVの弱まり方の前に掛ける（ステの合計＝強化後の戦闘力×効果%）', () => {
  for (const item of ITEMS.filter(i => i.area === 2 || i.rarity === 'L')) {
    for (const plus of [0, 4, 10]) {
      for (const [lv, pct] of [[item.lv, 100], [item.lv - 10, effectPct(item.lv, item.lv - 10)]]) {
        const s = statsAt(item, item.lv, pct, plus)
        assert.equal(Object.values(s).reduce((a, b) => a + b, 0), Math.round(powerAt(item, item.lv, plus) * pct / 100), `${item.id} +${plus} LV${lv}`)
      }
    }
  }
})

test('戦闘のステは強化値ぶん上がる。防具のメリット（重鎧・軽装）は変わらない。SQLを流す前の持ち物（plus なし）は+0', () => {
  const prof = { username:'t', class:'戦士', lv: 40, ...INITIAL_STATS, jobs: { 戦士: { lv: 1, exp: 0 } }, learned: [], skill_sets: {}, equipped: { weapon: 1, foot: 2 } }
  const inv = (pw, pf) => [
    { id: 1, base_id: '3N:両手剣', ilv: 15, ...(pw === undefined ? {} : { plus: pw }) },
    { id: 2, base_id: '3R:軽装足', ilv: 20, ...(pf === undefined ? {} : { plus: pf }) },
  ]
  const a = statBreakdown(prof, inv())
  const b = statBreakdown(prof, inv(0, 0))
  assert.deepEqual(a.gear, b.gear, 'plus が無い＝+0')
  const c = statBreakdown(prof, inv(10, 5))
  assert.equal(calcPower(c.gear), powerAt(ITEM_BY_ID['3N:両手剣'], 15, 10) + powerAt(ITEM_BY_ID['3R:軽装足'], 20, 5))
  assert.ok(calcPower(c.gear) > calcPower(b.gear))
  assert.deepEqual(c.armor, b.armor, '防具のメリットは強化で変わらない')
})

test('【確定】1回の強化：残骸 1,2,3,4,5,7,8,9,10,11・Gold＝必要LV×20×n・成功率 100,90,…,10%', () => {
  assert.deepEqual(ENHANCE_SCRAP, [1, 2, 3, 4, 5, 7, 8, 9, 10, 11])
  assert.deepEqual(ENHANCE_RATE, [100, 90, 80, 70, 60, 50, 40, 30, 20, 10])
  assert.equal(ENHANCE_GOLD_PER_LV, 20)
  // ユーザーに見せた例
  assert.equal(enhanceGoldOf(5, 1), 100)
  assert.equal(enhanceGoldOf(5, 10), 1000)
  assert.equal(enhanceGoldOf(90, 1), 1800)
  assert.equal(enhanceGoldOf(90, 10), 18000)
  const item = itemOf(1, 'R', '片手剣')   // 必要LV10
  assert.deepEqual(enhanceCostOf(item, { ilv: 10, plus: 0 }), { next: 1, area: 1, scrap: 1, gold: 200, rate: 100 })
  assert.deepEqual(enhanceCostOf(item, { ilv: 10, plus: 5 }), { next: 6, area: 1, scrap: 7, gold: 1200, rate: 50 })
  assert.deepEqual(enhanceCostOf(item, { ilv: 10, plus: 9 }), { next: 10, area: 1, scrap: 11, gold: 2000, rate: 10 })
  assert.equal(enhanceCostOf(item, { ilv: 10, plus: 10 }), null, '+10より上は無い')
})

test('強化できないわけ：上限・その装備のエリアの残骸が足りない・Goldが足りない（見る順はサーバーと同じ）', () => {
  const item = itemOf(2, 'N', '斧')   // 荒野の残骸・必要LV10
  const inv = { id: 7, base_id: item.id, ilv: 10, plus: 2 }   // 次は+3：残骸3・Gold600
  const prof = (materials, gold) => ({ materials, gold })
  assert.equal(enhanceErrorOf(item, { ...inv, plus: 10 }, prof({ 2: 99 }, 99999)), '強化値は+10が上限です')
  assert.equal(enhanceErrorOf(item, inv, prof({ 1: 99, 2: 2 }, 99999)), '荒野の残骸が足りません', 'ほかのエリアの残骸では強化できない')
  assert.equal(enhanceErrorOf(item, inv, prof({ 2: 3 }, 599)), 'Goldが足りません')
  assert.equal(enhanceErrorOf(item, inv, prof({ 2: 3 }, 600)), null)
})

test('抽選は「乱数×100 < 成功率」（+1は必ず成功・+10は1割）', () => {
  const rng = rngOf(7)
  for (let i = 0; i < 1000; i++) assert.equal(rollEnhance(100, rng), true)
  let hit = 0
  const N = 20000
  for (let i = 0; i < N; i++) if (rollEnhance(10, rng)) hit++
  assert.ok(Math.abs(hit / N - 0.1) < 0.01, `+10の成功は約10%（${(hit / N * 100).toFixed(1)}%）`)
})

test('平均でかかる量（ユーザーに見せた数）：+10まで残骸約245個・LV90でGold約40万／+5まで残骸約21個・LV90でGold約3.8万', () => {
  const all = expectedEnhanceCost(90)
  assert.equal(Math.round(all.scrap), 245)
  assert.equal(Math.round(all.gold / 10000), 40)
  assert.equal(Math.round(all.tries * 10) / 10, 29.3)
  const five = expectedEnhanceCost(90, 0, 5)
  assert.equal(Math.round(five.scrap), 21)
  assert.equal(Math.round(five.gold / 1000), 38)
  // 最後の+10の回だけで残骸約110個（平均10回）
  const last = expectedEnhanceCost(90, 9, 10)
  assert.equal(Math.round(last.scrap), 110)
  assert.equal(Math.round(last.tries), 10)
})
