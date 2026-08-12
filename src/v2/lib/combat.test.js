// バトルフロンティアⅡ ダメージ・判定の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHYS_REDUCTION_CAP, MAG_REDUCTION_CAP, CRIT_MULT, CRIT_MULT_ADD, HIT_MAX_PCT, HIT_MIN_PCT,
  CRIT_MIN_PCT, CRIT_MAX_PCT, CRIT_BASE_PCT, CRIT_ACC_DEX, CRIT_ACC_LUK, critAccuracyStats,
  EXTRA_ACTION_MAX_PCT, EXTRA_ACTION_MAX_RATIO, extraActionRate, rollExtraAction, goesFirst,
  physDefOf, magDefOf, reductionRate, critRate, hitRate, roll, damageOf, resolveAttack,
} from './combat.js'
import { INITIAL_STATS, applyExp, calcPower } from './stats.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
// 戦闘力を8種へ均等に配った想定のステータス（LV100・0転職の平均像）
const evenStats = (power) => {
  const per = power / 8
  return { hp: per * 8, mp: per * 3, str: per, dex: per, agi: per, int_stat: per, vit: per, luk: per }
}

test('防御力は VIT / INT+VIT から出す（防御専用ステは持たない）', () => {
  // あるけみすと：物理=VIT×1.0〜0.5 / 魔法=INT×1.0〜0.5＋VIT×0.15
  // ★主ステの係数は物理も魔法も同じ「1.0〜0.5」。起点の1.0で揃えること。
  //   2026-08-12まで物理1.0・魔法0.5と取り違えていて魔法防御が半分になっていた
  const s = { vit:100, int_stat:200 }
  assert.equal(physDefOf(s), 100)
  assert.equal(magDefOf(s), 200 * 1.0 + 100 * 0.15)  // 215
  // 同じ値のステなら魔法防御のほうが厚い（VIT×0.15ぶん）＝魔法は倍率で補う
  const even = { vit:100, int_stat:100 }
  assert.ok(magDefOf(even) > physDefOf(even))
})

test('軽減率は上限を超えず、防御0なら0', () => {
  assert.equal(reductionRate(0, 100, PHYS_REDUCTION_CAP), 0)
  // 防御が攻撃と同値なら上限の半分
  assert.equal(reductionRate(100, 100, PHYS_REDUCTION_CAP), PHYS_REDUCTION_CAP / 2)
  // 防御をいくら積んでも上限は超えない
  assert.ok(reductionRate(10 ** 9, 100, PHYS_REDUCTION_CAP) < PHYS_REDUCTION_CAP)
  assert.ok(reductionRate(10 ** 9, 100, MAG_REDUCTION_CAP) < MAG_REDUCTION_CAP)
})

test('防御を積んでもダメージが0にならない（引き算式との違い）', () => {
  const atk = { str:100, int_stat:100 }
  const wall = { vit:10 ** 6, int_stat:10 ** 6 }
  const phys = damageOf({ attacker:atk, defender:wall, mult:1, kind:'phys' })
  const mag  = damageOf({ attacker:atk, defender:wall, mult:1, kind:'mag' })
  // 上限34%/50%軽減なので、最低でも素の66%/50%は通る
  assert.ok(phys >= Math.floor(100 * (1 - PHYS_REDUCTION_CAP)), `phys=${phys}`)
  assert.ok(mag  >= Math.floor(100 * (1 - MAG_REDUCTION_CAP)),  `mag=${mag}`)
})

test('無防備な相手には 素のステ×倍率 がそのまま通る', () => {
  const atk = { str:100, int_stat:80 }
  const naked = { vit:0, int_stat:0 }
  assert.equal(damageOf({ attacker:atk, defender:naked, mult:2.0, kind:'phys' }), 200)
  assert.equal(damageOf({ attacker:atk, defender:naked, mult:2.5, kind:'mag' }), 200)
})

test('クリティカルは倍率が上がり、防御も割り引かれる', () => {
  const atk = { str:100 }
  const def = { vit:300 }
  const normal = damageOf({ attacker:atk, defender:def, mult:2, kind:'phys' })
  const crit   = damageOf({ attacker:atk, defender:def, mult:2, kind:'phys', crit:true })
  assert.ok(crit > normal * CRIT_MULT, `crit=${crit} normal=${normal}（防御の割引ぶんだけ上乗せされる）`)
})

test('クリティカルの倍率は「倍率×1.5＋1.5」（あるけみすと準拠）', () => {
  const atk = { str:100 }
  const naked = { vit:0 }
  for (const m of [0.47, 1.0, 1.9, 2.0]) {
    const n = damageOf({ attacker:atk, defender:naked, mult:m })
    const c = damageOf({ attacker:atk, defender:naked, mult:m, crit:true })
    assert.equal(c, Math.floor(100 * (m * CRIT_MULT + CRIT_MULT_ADD)), `倍率${m}`)
    // 倍率が低いほどクリの伸び率が大きい＝多段スキルはクリに強く依存する
    assert.ok(c / n > CRIT_MULT, `倍率${m}: ×${(c / n).toFixed(2)}`)
  }
  // 低倍率ほど倍率比が大きいことを明示的に固定（多段の調整を誤らないため）
  const ratio = (m) => damageOf({ attacker:atk, defender:naked, mult:m, crit:true }) / damageOf({ attacker:atk, defender:naked, mult:m })
  assert.ok(ratio(0.47) > ratio(1.9))
})

test('クリティカルの命中判定はDEX×1.5＋LUK/3で行う（あるけみすと準拠）', () => {
  const s = { dex:100, luk:30 }
  assert.equal(critAccuracyStats(s).dex, 100 * CRIT_ACC_DEX + 30 * CRIT_ACC_LUK)
  // 補正ぶんクリティカルのほうが当たりやすい
  const def = { agi:200 }
  assert.ok(hitRate(critAccuracyStats(s), def) > hitRate(s, def))
})

test('noCrit のスキルは絶対にクリティカルしない', () => {
  const atk = { str:100, dex:10 ** 6, luk:10 ** 7 }  // クリ率が上限に張り付く相手
  const def = { vit:0, agi:0, luk:0 }
  const rng = makeRng(99)
  for (let i = 0; i < 5000; i++) {
    assert.equal(resolveAttack({ attacker:atk, defender:def, mult:1, noCrit:true }, rng).crit, false)
  }
  // noCrit を外せばクリティカルは出る（テストが機能していることの確認）
  let any = false
  for (let i = 0; i < 5000; i++) if (resolveAttack({ attacker:atk, defender:def, mult:1 }, rng).crit) { any = true; break }
  assert.ok(any)
})

test('判定の順番はクリティカルが先（クリなら命中補正がかかる）', () => {
  // 通常命中は絶対に外れる状況を作り、クリティカルなら当たることを見る
  const atk = { str:100, dex:1, luk:10 ** 7 }   // LUKが極端＝クリ率は上限
  const def = { vit:0, agi:10 ** 6, luk:0 }
  let critHit = 0, plainHit = 0
  const rng = makeRng(1234)
  for (let i = 0; i < 20000; i++) {
    const r = resolveAttack({ attacker:atk, defender:def, mult:1 }, rng)
    if (r.crit && r.hit) critHit++
    if (!r.crit && r.hit) plainHit++
  }
  assert.ok(critHit > 0, 'クリティカルが命中している')
  assert.ok(critHit / plainHit > 0.05, `クリ命中${critHit} / 通常命中${plainHit}`)
})

test('防御無視はダメージを増やし、無視100%で無防備と同じになる', () => {
  const atk = { str:100 }
  const def = { vit:300 }
  const plain = damageOf({ attacker:atk, defender:def, mult:1 })
  const pen50 = damageOf({ attacker:atk, defender:def, mult:1, defPen:0.5 })
  const pen100 = damageOf({ attacker:atk, defender:def, mult:1, defPen:1 })
  assert.ok(pen50 > plain)
  assert.equal(pen100, damageOf({ attacker:atk, defender:{ vit:0 }, mult:1 }))
})

test('ダメージは最低1', () => {
  assert.equal(damageOf({ attacker:{ str:0 }, defender:{ vit:10 ** 6 }, mult:0.1 }), 1)
})

test('命中率は上限と下限の中に収まる', () => {
  const a = { dex:100 }
  assert.equal(hitRate(a, { agi:0, vit:0, luk:0 }), HIT_MAX_PCT)        // 回避0なら上限
  assert.ok(hitRate({ dex:1 }, { agi:10 ** 6 }) >= HIT_MIN_PCT)          // どんなに素早くても下限は保つ
  for (const agi of [10, 50, 100, 500, 5000]) {
    const r = hitRate(a, { agi })
    assert.ok(r >= HIT_MIN_PCT && r <= HIT_MAX_PCT, `agi=${agi} r=${r}`)
  }
  // 素早い相手ほど当たりにくい
  assert.ok(hitRate(a, { agi:50 }) > hitRate(a, { agi:500 }))
})

test('クリティカル率はLUK差で動き、上限と下限の中に収まる', () => {
  assert.equal(critRate({ luk:100 }, { luk:100 }), CRIT_BASE_PCT)        // 同値なら基礎値
  assert.ok(critRate({ luk:1000 }, { luk:0 }) > CRIT_BASE_PCT)
  assert.ok(critRate({ luk:0 }, { luk:1000 }) < CRIT_BASE_PCT)
  assert.equal(critRate({ luk:10 ** 6 }, { luk:0 }), CRIT_MAX_PCT)
  assert.equal(critRate({ luk:0 }, { luk:10 ** 6 }), CRIT_MIN_PCT)
})

// ===== AGI（行動順・行動回数）=====
test('追加行動は相手よりAGIが高いときだけ出る', () => {
  assert.equal(extraActionRate(100, 100), 0)
  assert.equal(extraActionRate(50, 100), 0)
  assert.ok(extraActionRate(101, 100) > 0)
})

test('追加行動は10倍で50%に達し、そこで打ち止め', () => {
  assert.equal(extraActionRate(100 * EXTRA_ACTION_MAX_RATIO, 100), EXTRA_ACTION_MAX_PCT)
  assert.equal(extraActionRate(100 * 100, 100), EXTRA_ACTION_MAX_PCT)  // 100倍でも上限のまま
  // ★旧版は上限が無く 2倍差で50%・3倍差で75%…と伸び続けた（転職差で一方的になる元）。
  //   v2は 2倍差でも約5.6%に抑える。ここを緩めるとインフレ対策が崩れる。
  assert.ok(extraActionRate(200, 100) < 10, `2倍差=${extraActionRate(200, 100)}%`)
  // 単調増加
  let prev = -1
  for (const r of [1, 1.5, 2, 3, 5, 8, 10]) {
    const v = extraActionRate(100 * r, 100)
    assert.ok(v >= prev, `${r}倍で減っている`)
    prev = v
  }
})

test('追加行動の抽選が確率どおりに出る', () => {
  const rng = makeRng(31)
  const me = { agi:1000 }, foe = { agi:100 }   // 10倍＝50%
  let n = 0
  for (let i = 0; i < 20000; i++) if (rollExtraAction(me, foe, rng)) n++
  assert.ok(Math.abs(n / 20000 - 0.5) < 0.02, `実測=${n / 20000}`)
  // 遅いほうは絶対に出ない
  for (let i = 0; i < 1000; i++) assert.equal(rollExtraAction(foe, me, rng), false)
})

test('行動順は 優先度 → AGI → ランダム の順で決まる', () => {
  const fast = { agi:200 }, slow = { agi:100 }
  assert.equal(goesFirst(fast, slow), true)
  assert.equal(goesFirst(slow, fast), false)
  // 優先度はAGIより強い（遅くても先制スキルなら先）
  assert.equal(goesFirst(slow, fast, 1, 0), true)
  assert.equal(goesFirst(fast, slow, 0, 1), false)
  // 優先度もAGIも同じならランダム（五分に割れる）
  const rng = makeRng(5)
  let first = 0
  for (let i = 0; i < 10000; i++) if (goesFirst(slow, { agi:100 }, 0, 0, rng)) first++
  assert.ok(Math.abs(first / 10000 - 0.5) < 0.03, `実測=${first / 10000}`)
})

test('抽選は確率どおりに振れる', () => {
  assert.equal(roll(0, () => 0), false)     // 0%は絶対に出ない
  assert.equal(roll(100, () => 0.999), true) // 100%は必ず出る
  const rng = makeRng(42)
  let hit = 0
  for (let i = 0; i < 10000; i++) if (roll(30, rng)) hit++
  assert.ok(Math.abs(hit / 10000 - 0.30) < 0.02, `実測=${hit / 10000}`)
})

test('必中・確定クリティカルは判定を飛ばす', () => {
  const a = { str:100, dex:0, luk:0 }
  const d = { vit:0, agi:10 ** 6, luk:10 ** 6 }
  const r = resolveAttack({ attacker:a, defender:d, mult:1, sureHit:true, sureCrit:true }, () => 0.999)
  assert.equal(r.hit, true)
  assert.equal(r.crit, true)
})

test('LV100・0転職の同格対戦がだいたい数発の殴り合いになる', () => {
  // 戦闘力534（初期39＋99LV×5）を均等に振った想定
  const grown = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, 60 * 500, makeRng(9))
  assert.equal(calcPower(grown.stats), 534)
  const s = evenStats(534)
  const dmg = damageOf({ attacker:s, defender:s, mult:2.0, kind:'phys' })
  const turns = Math.ceil(s.hp / dmg)
  assert.ok(turns >= 3 && turns <= 12, `倍率2.0で${turns}発（HP${s.hp} / ダメージ${dmg}）`)
})

test('優先度は数値で比べる（+2は+1より先・順番だけで行動回数は増えない）', () => {
  const same = { agi: 100 }
  // 数字が大きいほうが先
  assert.equal(goesFirst(same, same, 2, 1), true)
  assert.equal(goesFirst(same, same, 1, 2), false)
  assert.equal(goesFirst(same, same, 1, 0), true)
  // 同値ならAGI勝負に落ちる
  assert.equal(goesFirst({ agi:200 }, { agi:100 }, 1, 1), true)
  assert.equal(goesFirst({ agi:100 }, { agi:200 }, 1, 1), false)
  // 優先度はAGIより強い（遅くても先）
  assert.equal(goesFirst({ agi:1 }, { agi:10 ** 6 }, 1, 0), true)
})
