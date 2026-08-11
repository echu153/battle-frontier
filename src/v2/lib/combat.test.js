// バトルフロンティアⅡ ダメージ・判定の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHYS_REDUCTION_CAP, MAG_REDUCTION_CAP, CRIT_MULT, HIT_MAX_PCT, HIT_MIN_PCT,
  CRIT_MIN_PCT, CRIT_MAX_PCT, CRIT_BASE_PCT,
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
  const s = { vit:100, int_stat:200 }
  assert.equal(physDefOf(s), 100)
  assert.equal(magDefOf(s), 200 * 0.5 + 100 * 0.15)  // 115
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
