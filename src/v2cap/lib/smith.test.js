// v2cap：装備の強化と分解の決まりを固定するテスト（node --test）
// 【確定】は 2026-10-10 ユーザー決定（docs/v2cap-design.md §5「強化と分解」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, INITIAL_STATS, calcPower } from '../core/stats.js'
import { ITEMS, ITEM_BY_ID, STARTER_ITEMS, AREA_COUNT, itemOf } from './equipment.js'
import { AREA_LIST } from './areas.js'
import { powerAt, statsAt, spreadStats, effectivePowerAt } from './gear.js'
import { statBreakdown } from './loadout.js'
import {
  PLUS_MAX, PLUS_CAP, plusOf, plusMultOf, plusLabel, SCRAP_NAMES, scrapNameOf, scrapOf, SCRAP_YIELD, scrapYieldOf,
  dismantleGainOf, bulkPickable, ENHANCE_SCRAP, ENHANCE_RATE, ENHANCE_GOLD_PER_LV, enhanceGoldOf,
  enhanceScrapOf, enhanceCostOf, enhanceErrorOf, rollEnhance, expectedEnhanceCost,
  CRAFT_RARITIES, CRAFT_SCRAP, CRAFT_GOLD_PER_LV, canCraft, craftCostOf, craftErrorOf,
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

test('【確定】分解で入る残骸はレア度で決まる：ノーマル1・レア5・エピック10・レジェンダリー25・ユニーク50（その装備のエリアの残骸）', () => {
  // ユニークの50は 2026-10-18 の案のシート（2026-10-21 ユーザー「一旦今のままで実装して」）
  assert.deepEqual(SCRAP_YIELD, { N:1, R:5, E:10, L:25, U:50 })
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
  // 【確定】2026-10-26 ユーザー指示「お気に入りされた武器は分解できないように」
  assert.equal(bulkPickable({ inv: { id: 5, plus: 0, fav: true } }, worn), false, 'お気に入り')
  assert.equal(bulkPickable({ inv: { id: 6, plus: 0, fav: false } }, worn), true)
})

test('【確定】強化値は+10まで。+1ごとに元の強さの0.1倍ずつ足す（足し算：+5で1.5倍・+10で2倍）', () => {
  assert.equal(PLUS_MAX, 10)
  assert.equal(plusMultOf(0), 1)
  assert.equal(plusMultOf(1), 1.1)
  assert.equal(plusMultOf(5), 1.5)
  assert.equal(plusMultOf(10), 2)
  // 【確定】2026-10-23 V1からの引き継ぎの強化券で +16 まで入る（PLUS_CAP）。ふつうの強化は +10 まで（PLUS_MAX）
  assert.equal(PLUS_CAP, 16)
  assert.equal(plusOf({ plus: 12 }), 12, '強化券で入った+11より上はそのまま')
  assert.equal(plusOf({ plus: 20 }), 16, 'PLUS_CAP より上は PLUS_CAP')
  assert.equal(plusMultOf(16), 2.6)
  assert.equal(enhanceCostOf(ITEMS[0], { plus: 12 }), null, '+10より上はふつうの強化では上がらない')
  assert.equal(plusOf({}), 0)
  assert.equal(plusLabel(0), '')
  assert.equal(plusLabel(3), '+3')
  for (const item of ITEMS.filter(i => i.area === 1 || i.area === 15)) {
    // 丸めは倍率を掛けたあとに1回だけ＝元の強さが10以上なら+10は+0のほぼ2倍（丸めの差は1まで）
    if (powerAt(item, item.lv) >= 10) assert.ok(Math.abs(powerAt(item, item.lv, 10) - 2 * powerAt(item, item.lv)) <= 1, `${item.id} +10 ≒ 2倍`)
    assert.equal(powerAt(item, item.lv, 0), powerAt(item, item.lv), '+0は前と同じ強さ')
  }
})

test('【確定】2026-10-12 強化は1回ごとに戦闘力が最低でも+1（どの装備・どのアイテムLVでも）。元の強さが10未満なら「元＋強化値」', () => {
  // ユーザー「装備強化するとき、1.1倍だから数値が上がらない場合がある、初期の装備とかは上り幅わかりづらい」→「最低でも+1にする」を選んだ
  for (const item of [...ITEMS, ...STARTER_ITEMS]) {
    for (const ilv of [item.lv, item.lv + 7]) {
      for (let p = 0; p < PLUS_CAP; p++) {   // 強化券で入る +16 まで（2026-10-23）
        assert.ok(powerAt(item, ilv, p + 1) >= powerAt(item, ilv, p) + 1, `${item.id} LV${ilv} +${p}→+${p + 1}`)
      }
    }
  }
  // 古びた耳飾り（元の強さ4）：前は 4/4/5/5/6/…/8 → いまは 4/5/6/7/…/14
  const ear = ITEM_BY_ID['0N:イヤリング']
  assert.deepEqual([0, 1, 2, 3, 5, 10].map(p => powerAt(ear, 1, p)), [4, 5, 6, 7, 9, 14])
  // 強い装備は今までどおり（元の強さの10%ずつ）
  const big = itemOf(15, 'L', '両手剣')
  assert.equal(powerAt(big, big.lv, 10), 2 * powerAt(big, big.lv) - 1, '丸めの差は1まで')
  assert.equal(powerAt(big, big.lv, 1), Math.round(powerAt(big, big.lv) * 1.1))
  // +11からも同じ足し方（強化券・2026-10-23）。PLUS_CAP（+16）より上は+16と同じ
  assert.equal(powerAt(ear, 1, 12), 16)
  assert.equal(powerAt(ear, 1, 20), powerAt(ear, 1, PLUS_CAP))
})

test('強化値は必要LVに足りないときも掛ける（2026-10-18〜 LV相当の強さに強化値を掛ける＝ステの合計はその戦闘力）', () => {
  for (const item of ITEMS.filter(i => i.area === 2 || i.rarity === 'L')) {
    for (const plus of [0, 4, 10]) {
      for (const lv of [item.lv, item.lv - 10]) {
        const s = statsAt(item, item.lv, lv, plus)
        assert.equal(Object.values(s).reduce((a, b) => a + b, 0), effectivePowerAt(item, item.lv, lv, plus), `${item.id} +${plus} LV${lv}`)
      }
      assert.equal(effectivePowerAt(item, item.lv, item.lv - 10, plus),
        Math.min(powerAt(item, item.lv - 10, plus), powerAt(item, item.lv, plus) - 1), `${item.id} +${plus} 10LV足りない＝LV相当`)
    }
  }
})

test('【2026-10-13】強化して戦闘力が上がっても、ステは1つも下がらない（必要LVが足りていても、足りなくても）', () => {
  // 全装備（初期装備も）・アイテムLV＝必要LV で、+0→+1 … +9→+10 の段を、足りないLV 0〜18 で全部見る（2026-10-18 から LV相当）
  // ⚠前の散らし方（四捨五入して、合計のずれをいちばん重いステへ）は、効果100%の15,790段のうち524段で下がっていた
  //   （ユーザー指摘：蟻帝の聖鎧 +3→+4・効果60% で VIT 15→14）
  // ★最大剰余だけだと、軽装頭の戦闘力9→10 で STR が2→1に下がる段が残った（アラバマのパラドックス）。
  //   端数が同じときに「戦闘力が1少ないときに端数の1点をもらっていたステ」を先にして0にした（gear.js の spreadStats）
  const down = []
  for (const item of [...ITEMS, ...STARTER_ITEMS]) {
    for (let short = 0; short <= 18; short++) {
      const lv = item.lv - short
      if (lv < 1) continue
      let a = statsAt(item, item.lv, lv, 0)
      for (let plus = 1; plus <= PLUS_MAX; plus++) {
        const b = statsAt(item, item.lv, lv, plus)
        for (const k of STAT_KEYS) if (b[k] < a[k]) down.push(`${item.id} LV${lv} +${plus - 1}→+${plus} ${k} ${a[k]}→${b[k]}`)
        a = b
      }
    }
  }
  assert.deepEqual(down, [])
  // ユーザーが見つけた例：蟻帝の聖鎧（始まりの森のレジェンダリーの重鎧の鎧・VIT60 STR15 INT15 AGI10。2026-10-18 から名前は森主の鎧）
  //   +3→+4・効果60%（戦闘力23→25）。前は STR3 AGI2 INT3 VIT15 → STR4 AGI3 INT4 VIT14 で VIT が下がっていた
  //   （効果%は 2026-10-18 になくなったので、そのときの戦闘力23→25 の散らし方で見る）
  const armor = ITEM_BY_ID['1L:重鎧鎧']
  const zero = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  assert.deepEqual(spreadStats(23, armor.dist), { ...zero, str:4, agi:2, int_stat:3, vit:14 })
  assert.deepEqual(spreadStats(25, armor.dist), { ...zero, str:4, agi:2, int_stat:4, vit:15 })
  // 前に見つかった例：見習いの短剣 +2→+3（戦闘力12→13）。前は STR2 DEX2 AGI6 INT2 → STR3 DEX3 AGI4 INT3 で AGI が下がっていた
  const dagger = ITEM_BY_ID['0N:短剣']
  assert.deepEqual(statsAt(dagger, 1, null, 2), { ...zero, str:2, dex:3, agi:5, int_stat:2 })
  assert.deepEqual(statsAt(dagger, 1, null, 3), { ...zero, str:3, dex:3, agi:5, int_stat:2 })
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
  const item = itemOf(2, 'R', '斧')   // 荒野の残骸・必要LV15（ノーマルは残骸を使わないのでレアで見る）
  const inv = { id: 7, base_id: item.id, ilv: 15, plus: 2 }   // 次は+3：残骸3・Gold900
  const prof = (materials, gold) => ({ materials, gold })
  assert.equal(enhanceErrorOf(item, { ...inv, plus: 10 }, prof({ 2: 99 }, 99999)), '強化値は+10が上限です')
  assert.equal(enhanceErrorOf(item, inv, prof({ 1: 99, 2: 2 }, 99999)), '荒野の残骸が足りません', 'ほかのエリアの残骸では強化できない')
  assert.equal(enhanceErrorOf(item, inv, prof({ 2: 3 }, 899)), 'Goldが足りません')
  assert.equal(enhanceErrorOf(item, inv, prof({ 2: 3 }, 900)), null)
})

test('【確定】2026-10-12 ノーマル（初期装備も）はGoldだけで強化できる（残骸0）。Gold・成功率はほかの装備と同じ', () => {
  // ユーザー指示「初期装備は残骸不要、Goldだけで強化できるように」→「全装備のノーマル装備の強化で残骸の消費は不要に、※Goldのみで」
  const item = ITEM_BY_ID['0N:短剣']   // 見習いの短剣（エリア0・必要LV1）
  assert.equal(item.name, '見習いの短剣')
  for (let n = 1; n <= PLUS_MAX; n++) {
    assert.equal(enhanceScrapOf(item, n), 0, `+${n}は残骸なし`)
    for (const it of ITEMS.filter(i => i.rarity === 'N' && i.part === '武器' && i.type === '短剣')) assert.equal(enhanceScrapOf(it, n), 0, `${it.id}（落ちたノーマル）も残骸なし`)
    for (const r of ['R', 'E', 'L']) assert.equal(enhanceScrapOf(itemOf(1, r, '短剣'), n), ENHANCE_SCRAP[n - 1], `${r}は今までどおり残骸を使う`)
  }
  assert.deepEqual(enhanceCostOf(item, { ilv: 1, plus: 0 }), { next: 1, area: 1, scrap: 0, gold: 20, rate: 100 })
  assert.deepEqual(enhanceCostOf(item, { ilv: 1, plus: 9 }), { next: 10, area: 1, scrap: 0, gold: 200, rate: 10 })
  assert.deepEqual(enhanceCostOf(itemOf(15, 'N', '両手剣'), { ilv: 75, plus: 4 }), { next: 5, area: 15, scrap: 0, gold: 7500, rate: 60 }, 'エリア15のノーマルもGoldだけ')
  // 残骸を1つも持っていなくても、Goldがあれば強化できる
  assert.equal(enhanceErrorOf(item, { id: 1, ilv: 1, plus: 4 }, { materials: {}, gold: 100 }), null)
  assert.equal(enhanceErrorOf(item, { id: 1, ilv: 1, plus: 4 }, { gold: 99 }), 'Goldが足りません')
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

test('【確定】作成（鍛冶屋）：レア30・エピック100・レジェンダリー300個のその装備のエリアの残骸と、Gold＝必要LV×50／100／200。ノーマルは作れない', () => {
  assert.deepEqual(CRAFT_RARITIES, ['R', 'E', 'L'])
  assert.deepEqual(CRAFT_SCRAP, { R:30, E:100, L:300 })
  assert.deepEqual(CRAFT_GOLD_PER_LV, { R:50, E:100, L:200 })
  assert.equal(canCraft(itemOf(1, 'N', '片手剣')), false)
  assert.equal(craftCostOf(itemOf(1, 'N', '片手剣')), null)
  assert.deepEqual(craftCostOf(itemOf(1, 'R', '片手剣')), { area: 1, scrap: 30, gold: 10 * 50 }, 'エリア1のレア＝必要LV10')
  assert.deepEqual(craftCostOf(itemOf(1, 'E', 'リング')), { area: 1, scrap: 100, gold: 15 * 100 })
  assert.deepEqual(craftCostOf(itemOf(15, 'L', '刀')), { area: 15, scrap: 300, gold: 90 * 200 }, 'エリア15のレジェンダリー＝必要LV90で18000')
  // エリアとレア度が同じなら、どの種類でも同じ（画面では1回だけ出す）
  for (const area of [1, 8, 15]) {
    for (const r of CRAFT_RARITIES) {
      const costs = ITEMS.filter(i => i.area === area && i.rarity === r).map(i => JSON.stringify(craftCostOf(i)))
      assert.equal(new Set(costs).size, 1, `エリア${area}の${r}`)
    }
  }
  // 作れないわけ（見る順はサーバーと同じ：ノーマル → 残骸 → Gold）
  const item = itemOf(3, 'E', '軽装鎧')   // 洞窟の残骸100・必要LV25でGold2500
  assert.equal(craftErrorOf(itemOf(3, 'N', '軽装鎧'), { materials: { 3: 999 }, gold: 1e9 }), 'ノーマルの装備は作れません')
  assert.equal(craftErrorOf(item, { materials: { 2: 999, 3: 99 }, gold: 1e9 }), '洞窟の残骸が足りません', 'ほかのエリアの残骸では作れない')
  assert.equal(craftErrorOf(item, { materials: { 3: 100 }, gold: 2499 }), 'Goldが足りません')
  assert.equal(craftErrorOf(item, { materials: { 3: 100 }, gold: 2500 }), null)
  assert.equal(craftErrorOf(null, {}), 'その装備はありません')
})

test('作成は分解より重い（作って分解して増える抜け道が無い）', () => {
  for (const r of CRAFT_RARITIES) assert.ok(CRAFT_SCRAP[r] > SCRAP_YIELD[r], `${r}：作る${CRAFT_SCRAP[r]} ＞ 分解${SCRAP_YIELD[r]}`)
})
