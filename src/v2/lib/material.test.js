// 素材とルーン抽出のテスト。数値の正は docs/v2-enchant-design.md。
// ⚠**同じ計算が supabase_v2_core.sql の v2_extract_essence にもある**。
//   ここが通っても向こうが直っていなければ、表示と実値がズレる。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MATERIALS, MATERIAL_BY_ID, materialOf, materialsOfEnemy, RARITIES,
  rangeOf, ratioOf, valueTable, meanOf, rollValue, rollStats, colorOf,
  canExtract, extract, EXTRACT_COST, TIER_RATE_MAX, TOP_WEIGHT, runePower,
  gradeOf, runeName, runeFullName, RUNE_NAMES, GRADE_MIN, COLOR_LABEL,
  SELL_BASE_TIER, SELL_RARITY_MULT, sellPriceOf, sellTotalOf,
} from './material.js'
import { allEnemies } from './enemies.js'
import { ENCHANTS } from './enchant.js'
import { rollMaterial, MATERIAL_RATE } from './sortie.js'
import { CATALOG, socketCountOf, rollSockets } from './equipment.js'
import { STAT_KEYS } from './stats.js'

// ===== 網羅 =====
test('素材は敵105体 × 3レア度 ＝ 315種', () => {
  assert.equal(MATERIALS.length, 315)
  assert.equal(new Set(MATERIALS.map(m => m.id)).size, 315, 'IDが重複している')
  assert.equal(new Set(MATERIALS.map(m => m.name)).size, 315, '名前が重複している')
  // ★素材は自分の**難易度帯**を持つ（レンジも売値も帯で決まる）
  for (const m of MATERIALS) assert.ok(m.tier >= 1 && m.tier <= 8, `${m.name} の帯`)
})

// ★再発検出テスト：敵を足したら素材も足す、を強制する
test('素材の敵名は enemies.js と enchant.js の両方に一致する', () => {
  const names = allEnemies().map(e => e.name)
  const mats = [...new Set(MATERIALS.map(m => m.enemy))]
  assert.deepEqual(names.filter(n => !mats.includes(n)), [], '敵にあって素材が無い')
  assert.deepEqual(mats.filter(n => !names.includes(n)), [], '素材にあって敵が無い')
  assert.deepEqual(mats.filter(n => !ENCHANTS[n]), [], '素材にあって特殊能力が無い')
})

test('各敵は通常・レア・激レアを1つずつ持つ', () => {
  for (const e of allEnemies()) {
    const list = materialsOfEnemy(e.name)
    assert.equal(list.length, 3, e.name)
    assert.deepEqual(list.map(m => m.rarity), RARITIES, e.name)
  }
})

test('ボス素材だけが2ステータス持ち', () => {
  for (const m of MATERIALS) {
    assert.equal(m.stats.length, m.isBoss ? 2 : 1, m.name)
    for (const k of m.stats) assert.ok(STAT_KEYS.includes(k), `${m.name} の ${k}`)
  }
})

test('どのエリア帯でも8ステータスすべてが揃う', () => {
  for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
    const got = new Set(MATERIALS.filter(m => m.area === a || m.area === b).flatMap(m => m.stats))
    assert.deepEqual(STAT_KEYS.filter(k => !got.has(k)), [], `帯 ${a}${b} に足りないステ`)
  }
})

// ===== レンジ =====
test('レンジの最大は2.0%。上限はエリア帯・下限はレア度で決まる', () => {
  assert.equal(Math.max(...Object.values(TIER_RATE_MAX)), 2.0)
  assert.deepEqual(rangeOf(1, 'normal', false), { lo:0.1, hi:1.0 })
  assert.deepEqual(rangeOf(1, 'rare', false),   { lo:0.3, hi:1.0 })
  assert.deepEqual(rangeOf(1, 'ultra', false),  { lo:0.5, hi:1.0 })
  assert.deepEqual(rangeOf(8, 'normal', false), { lo:0.1, hi:2.0 })
  assert.deepEqual(rangeOf(8, 'ultra', false),  { lo:1.0, hi:2.0 })
  // ★ボス素材もレンジは雑魚と同じ（2ステ持ちなので合計はちょうど2倍になる）
  assert.deepEqual(rangeOf(1, 'normal', true), rangeOf(1, 'normal', false))
  assert.deepEqual(rangeOf(8, 'ultra', true),  rangeOf(8, 'ultra', false))
  // ★同じ帯のエリアはレンジも同じ（⑧の帯＝エリア8・14・15）
  assert.deepEqual(rangeOf(14, 'normal', false), rangeOf(8, 'normal', false))
  assert.deepEqual(rangeOf(15, 'ultra', false),  rangeOf(8, 'ultra', false))
  const boss = materialOf('ビッグスライム', 'normal')
  assert.deepEqual([boss.lo, boss.hi], [0.1, 1.0])
})

test('重みはレンジごとに変わり、最大値の出やすさが先頭の7.5%に揃う', () => {
  for (const [lo, hi] of [[0.1, 1.0], [0.1, 1.3], [0.1, 1.6], [0.1, 2.0], [1.0, 2.0]]) {
    const t = valueTable(lo, hi)
    const rel = t[t.length - 1].p / t[0].p
    assert.ok(Math.abs(rel - TOP_WEIGHT) < 1e-9, `${lo}〜${hi} の相対重み ${rel}`)
    assert.ok(Math.abs(t.reduce((a, e) => a + e.p, 0) - 1) < 1e-9, '確率の合計が1でない')
  }
  // 帯1の通常は ×0.750（提示された例と同じ体感）
  assert.equal(ratioOf(0.1, 1.0).toFixed(3), '0.750')
})

test('平均はエリアが進むほど素直に伸びる', () => {
  const means = [1, 3, 5, 7].map(a => Number(meanOf(...Object.values(rangeOf(a, 'normal', false))).toFixed(2)))
  assert.deepEqual(means, [0.34, 0.43, 0.52, 0.64])
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1], '平均が伸びていない')
})

test('値はレンジの中に収まり、0.1刻みになる', () => {
  const m = materialOf('スライム', 'normal')
  for (let i = 0; i < 300; i++) {
    const v = rollValue(m.lo, m.hi, Math.random)
    assert.ok(v >= m.lo && v <= m.hi, String(v))
    assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, String(v))
  }
})

// ===== 型の抽選 =====
test('激レアとボス素材はステータスの型が固定', () => {
  const ultra = materialOf('スライム', 'ultra')
  const boss = materialOf('ビッグスライム', 'normal')
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(rollStats(ultra, Math.random), ['vit'])
    assert.deepEqual(rollStats(boss, Math.random), ['hp', 'vit'])
  }
})

test('雑魚の通常・レアは70%で割り当てステ・30%でそれ以外', () => {
  const m = materialOf('スライム', 'normal')
  assert.deepEqual(rollStats(m, () => 0), ['vit'])            // 70%側
  const other = rollStats(m, () => 0.99)                       // 30%側
  assert.equal(other.length, 1)
  assert.notEqual(other[0], 'vit')
  // 実測でおおよそ7割
  let hit = 0
  for (let i = 0; i < 4000; i++) if (rollStats(m, Math.random)[0] === 'vit') hit++
  assert.ok(Math.abs(hit / 4000 - 0.7) < 0.03, `割り当てステが出た率 ${hit / 4000}`)
})

// ===== 色 =====
test('色は合計値の一番大きいグループで決まる', () => {
  assert.equal(colorOf({ str:1.0 }), 'red')
  assert.equal(colorOf({ vit:1.0 }), 'blue')
  assert.equal(colorOf({ agi:1.0 }), 'green')
  // 設計メモの例：青0.6（VIT）／緑1.1（AGI1.0＋DEX0.1）→ 緑
  assert.equal(colorOf({ vit:0.6, agi:1.0, dex:0.1 }), 'green')
})

// ===== 抽出 =====
const five = (id) => Array.from({ length: EXTRACT_COST }, () => id)

test('抽出は素材5個ちょうど。ボス素材は1個まで', () => {
  assert.equal(canExtract(five('m:1:0:n')), null)
  assert.ok(canExtract(['m:1:0:n']))
  assert.ok(canExtract([...five('m:1:0:n'), 'm:1:0:n']))
  assert.ok(canExtract(five('m:1:6:n')), 'ボス素材5個が通ってしまう')
  assert.equal(canExtract(['m:1:6:n', ...Array(4).fill('m:1:0:n')]), null, 'ボス素材1個は通るべき')
})

test('抽出はステータス合計・色・特殊能力の候補を返す', () => {
  const r = extract(five('m:1:0:u'), Math.random)   // スライムの激レア＝VIT固定
  assert.equal(Object.keys(r.stats).join(''), 'vit')
  assert.equal(r.color, 'blue')
  assert.ok(r.stats.vit >= 0.5 * 5 && r.stats.vit <= 1.0 * 5)
  assert.ok(Array.isArray(r.abilityChoices))
})

test('特殊能力は 通常0% / レア1% / 激レア3%', () => {
  // 通常だけで組むと絶対に付かない
  for (let i = 0; i < 200; i++) assert.equal(extract(five('m:1:0:n'), Math.random).abilityChoices.length, 0)
  // 激レア5個なら 1-0.97^5 = 14.1% くらい
  let hit = 0
  for (let i = 0; i < 4000; i++) if (extract(five('m:1:0:u'), Math.random).abilityChoices.length > 0) hit++
  assert.ok(Math.abs(hit / 4000 - 0.141) < 0.025, `付いた率 ${hit / 4000}`)
})

test('ルーンの合計は帯4の激レアで6%前後になる', () => {
  let total = 0
  const n = 3000
  for (let i = 0; i < n; i++) total += runePower(extract(five('m:8:0:u'), Math.random).stats)
  assert.ok(Math.abs(total / n - 6.35) < 0.3, `平均 ${total / n}`)
})

// ===== ドロップ =====
test('素材は1戦闘に1個まで。激レア1%・レア5%・通常20%', () => {
  assert.deepEqual(MATERIAL_RATE, { ultra:1, rare:5, normal:20 })
  assert.equal(rollMaterial('スライム', 1, () => 0.005).rarity, 'ultra')
  assert.equal(rollMaterial('スライム', 1, () => 0.03).rarity, 'rare')
  assert.equal(rollMaterial('スライム', 1, () => 0.15).rarity, 'normal')
  assert.equal(rollMaterial('スライム', 1, () => 0.5), null)
  // ドロップ率upの倍率ぶん広がる
  assert.equal(rollMaterial('スライム', 1.5, () => 0.35).rarity, 'normal')
  assert.equal(rollMaterial('スライム', 1, () => 0.35), null)
})

// ===== ソケット =====
test('ソケットは武器だけ。片手2枠・両手3枠', () => {
  for (const item of CATALOG) {
    const want = item.part !== '武器' ? 0 : item.hands === 2 ? 3 : 2
    assert.equal(socketCountOf(item), want, item.name)
  }
})

test('ソケットの色は1枠ずつ赤青緑を1/3で引く', () => {
  const twoHand = CATALOG.find(i => i.part === '武器' && i.hands === 2)
  assert.equal(rollSockets(twoHand, () => 0).length, 3)
  assert.deepEqual(rollSockets(twoHand, () => 0), ['red', 'red', 'red'])
  assert.deepEqual(rollSockets(twoHand, () => 0.99), ['green', 'green', 'green'])
  // 3枠とも同じ色になるのは 1/9
  let same = 0
  const n = 20000
  for (let i = 0; i < n; i++) {
    const s = rollSockets(twoHand, Math.random)
    if (s[0] === s[1] && s[1] === s[2]) same++
  }
  assert.ok(Math.abs(same / n - 1 / 9) < 0.012, `単色率 ${same / n}`)
})

test('素材IDはSQLに入れている形（m:エリア:並び:レア度）', () => {
  assert.equal(MATERIAL_BY_ID['m:1:0:n'].name, 'スライムのゼリー')
  assert.equal(MATERIAL_BY_ID['m:8:6:u'].name, '天空覇龍の龍核')
})

// ===== ルーンがステータスに乗るか =====
// ★2026-08-16 の実機確認で「戦闘には乗るがステータス画面に出ない」バグが出た箇所。
//   totalStats に runes を渡し忘れると再発する
test('装着中の武器に刺さったルーンだけがステータスに乗る', async () => {
  const { totalStats, runeAbilities, equippedRunes } = await import('./loadout.js')
  const prof = { agi: 100, str: 100, equipped: { right: 5 } }
  const inv = [{ id: 5, equip_id: 'w:弓:S', plus: 0 }, { id: 6, equip_id: 'w:槍:S', plus: 0 }]
  const ess = [
    { id: 1, color:'green', stats:{ agi: 10 }, ability:'コウモリ', inv_id: 5, socket_idx: 0 },
    { id: 2, color:'red',   stats:{ str: 50 }, ability:'ゴブリン', inv_id: 6, socket_idx: 0 }, // 倉庫の槍＝効かない
    { id: 3, color:'blue',  stats:{ str: 50 }, ability:null, inv_id: null },                    // 未使用＝効かない
  ]
  const base = totalStats(prof, inv, [])
  const withEss = totalStats(prof, inv, ess)
  assert.equal(withEss.agi, Math.round(base.agi * 1.1), '装着中のルーンが乗っていない')
  assert.equal(withEss.str, base.str, '装着していない武器・未使用のルーンが乗ってしまっている')
  // 特殊能力も装着中のぶんだけ
  assert.deepEqual(runeAbilities(equippedRunes(prof, inv, ess)), ['コウモリ'])
})

// ===== ルーンの名前 =====
test('ルーンの名前は色×合計値の6段で決まる', () => {
  // 段の境目は 2 / 4 / 6 / 8 / 10
  assert.deepEqual([0, 1.9, 2, 3.9, 4, 5.9, 6, 7.9, 8, 9.9, 10, 30].map(gradeOf),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  assert.equal(runeName('red',   { str: 1.0 }), '鋭牙')
  assert.equal(runeName('red',   { str: 12 }),  '修羅')
  assert.equal(runeName('blue',  { vit: 5 }),   '鉄壁')
  assert.equal(runeName('green', { agi: 8.5 }), '神速')
  assert.equal(runeFullName('green', { agi: 8.5 }), '神速ルーン')
})

test('名前はどの色も6段ぶんあり、すべて漢字2文字', () => {
  for (const [color, names] of Object.entries(RUNE_NAMES)) {
    assert.equal(names.length, GRADE_MIN.length, color)
    for (const n of names) assert.equal([...n].length, 2, `${color} の ${n}`)
    assert.equal(new Set(names).size, names.length, `${color} に重複がある`)
  }
  // 色をまたいでも重複しない
  const all = Object.values(RUNE_NAMES).flat()
  assert.equal(new Set(all).size, all.length)
})

test('色の表記は緋・蒼・翠', () => {
  assert.deepEqual(COLOR_LABEL, { red:'緋', blue:'蒼', green:'翠' })
})

// ★ボス素材は2ステ持ち。**どちらも独立に抽選される**ことを固定しておく
//   （片方だけになっていないか・値が同じ乱数を使い回していないかの検出）
test('ボス素材は2つのステータスが両方とも、それぞれ別に抽選される', () => {
  const boss = materialOf('ビッグスライム', 'ultra')       // HP＋VIT
  const filler = materialOf('毒キノコ', 'ultra')           // INT固定（混ざっても見分けられる）
  const set = [boss.id, ...Array(EXTRACT_COST - 1).fill(filler.id)]
  let both = 0, differ = 0
  const n = 500
  for (let i = 0; i < n; i++) {
    const r = extract(set, Math.random)
    if (r.stats.hp > 0 && r.stats.vit > 0) both++
    if (r.stats.hp !== r.stats.vit) differ++
    // それぞれがボス素材のレンジに収まっている
    assert.ok(r.stats.hp >= boss.lo && r.stats.hp <= boss.hi, `hp ${r.stats.hp}`)
    assert.ok(r.stats.vit >= boss.lo && r.stats.vit <= boss.hi, `vit ${r.stats.vit}`)
  }
  assert.equal(both, n, '片方しか付いていない回がある')
  assert.ok(differ > n * 0.4, `2つが常に同じ値になっている（別々に引けていない）: ${differ}/${n}`)
})

// ===== 売却（v2で唯一Goldが湧く場所）=====
// ★数値の正は docs/v2-gold-design.md。**同じ表が supabase_v2_core.sql にもある**（v2sql.test.js が突き合わせる）
test('素材の売値は全種類に付いていて、レア度で 1 / 4 / 20 倍', () => {
  for (const m of MATERIALS) {
    assert.ok(sellPriceOf(m) > 0, `${m.name} の売値`)
    assert.equal(sellPriceOf(m), SELL_BASE_TIER[m.tier] * SELL_RARITY_MULT[m.rarity], m.name)
  }
  assert.deepEqual(SELL_RARITY_MULT, { normal:1, rare:8, ultra:40 })
  // ★基準はデイリー「かんたん」の100G（2026-08-22 ユーザー決定）。
  //   ①の激レア1個がちょうどデイリー1回ぶん＝ここが動いたら気付けるように固定する
  assert.equal(sellPriceOf({ tier:1, rarity:'ultra' }), 120)
  assert.equal(sellPriceOf({ tier:1, rarity:'normal' }), 3)
  assert.equal(sellPriceOf({ tier:8, rarity:'ultra' }), 2160)
  // エリアが進むほど高い
  let prev = 0
  for (let a = 1; a <= 8; a++) {
    assert.ok(SELL_BASE_TIER[a] > prev, `難易度${a}の基準額`)
    prev = SELL_BASE_TIER[a]
  }
})

test('1戦闘あたりの期待Goldは、素材のドロップ率ぶんだけ薄まる', () => {
  // ドロップは 通常20% / レア5% / 激レア1%。B / 8B / 40B なので期待値は**B そのもの**
  for (let a = 1; a <= 8; a++) {
    const m = (rarity) => ({ tier:a, rarity })
    const exp = (MATERIAL_RATE.normal * sellPriceOf(m('normal'))
      + MATERIAL_RATE.rare * sellPriceOf(m('rare'))
      + MATERIAL_RATE.ultra * sellPriceOf(m('ultra'))) / 100
    assert.equal(Math.round(exp), SELL_BASE_TIER[a], `難易度${a}の期待Gold`)
  }
})

test('売却の合計は個数ぶん足される（持っていない素材は0円）', () => {
  const n = materialOf('スライム', 'normal')
  const u = materialOf('スライム', 'ultra')
  assert.equal(sellTotalOf([{ id:n.id, qty:3 }]), sellPriceOf(n) * 3)
  assert.equal(sellTotalOf([{ id:n.id, qty:3 }, { id:u.id, qty:1 }]),
    sellPriceOf(n) * 3 + sellPriceOf(u))
  assert.equal(sellTotalOf([{ id:'m:9:9:n', qty:5 }]), 0, '存在しないIDは0')
  assert.equal(sellTotalOf([{ id:n.id, qty:-5 }]), 0, 'マイナスは0扱い')
  assert.equal(sellTotalOf([]), 0)
})
