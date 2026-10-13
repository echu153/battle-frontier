// 防具のセット能力（battleSet.js・v2cap の armorSets.js の setFxOf が作る fighter.setFx）を戦闘エンジンで確かめる（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction, runBattle, liveStats, tickRegen, tickForesight, tickAil } from './battle.js'
import { hasAilment, inflict, POISON_RATE, POISON_TURNS } from './ailments.js'
import { buildBattleLog } from './battleLog.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const F = (over = {}) => ({
  name: 'A', cls: 'テスト', kind: 'phys', noClassBonus: true, passives: [], enchants: [], evolutions: [], slots: [],
  ...over,
  stats: { hp: 1000, mp: 100, str: 100, dex: 100, agi: 100, int_stat: 100, vit: 100, luk: 100, ...(over.stats || {}) },
})
const HIT = { name: '斬り', kind: 'phys', mult: 1, proc: 100, mp: 0, sureHit: true, noCrit: true }
const slot = (skill) => [{ skill, uses: 999 }]
// a が b を1回殴ったときのダメージ（同じ乱数の種）。prep で殴る前の b をいじれる
const hitOnce = ({ aFx, bFx, skill = HIT, seed = 3, prep, aStats, bStats } = {}) => {
  const a = createSide(F({ name: 'A', setFx: aFx, slots: slot(skill), stats: aStats }))
  const b = createSide(F({ name: 'B', setFx: bFx, stats: { agi: 1, ...(bStats || {}) } }))
  if (prep) prep(a, b)
  const log = []
  takeAction(a, b, rngOf(seed), log)
  return { a, b, log, dmg: log.find(l => l.type === 'skill')?.damage ?? 0 }
}

test('setFx が無ければ何もしない。中身の無い setFx でも戦闘の流れ（乱数・ログ）は同じ', () => {
  assert.equal(createSide(F()).setFx, null)
  for (const seed of [1, 2, 3, 4, 5]) {
    const foe = F({ name: 'B', stats: { hp: 3000, str: 120 }, slots: slot({ ...HIT, name: '毒噛み', mult: 0.8, ail: { key: 'poison', chance: 50 } }) })
    const plain = runBattle(F({ slots: slot({ ...HIT, ail: { key: 'bleed', chance: 40 } }) }), foe, { rng: rngOf(seed) })
    const empty = runBattle(F({ slots: slot({ ...HIT, ail: { key: 'bleed', chance: 40 } }), setFx: {} }), foe, { rng: rngOf(seed) })
    assert.deepEqual(empty.log, plain.log, `seed ${seed}`)
  }
})

// ===== 状態異常 =====
const ailRate = (aFx, bFx, key, chance, n = 4000) => {
  const rng = rngOf(11)
  let got = 0
  for (let i = 0; i < n; i++) {
    const a = createSide(F({ name: 'A', setFx: aFx, slots: slot({ ...HIT, mult: 0.01, ail: { key, chance } }) }))
    const b = createSide(F({ name: 'B', setFx: bFx }))
    takeAction(a, b, rng, [])
    if (hasAilment(b.ail, key)) got++
  }
  return (got / n) * 100
}
test('2部位：かかる確率を3割減らす（×0.7・深淵の海溝×0.8）。4部位の付与確率+10%は×1.1。どちらも確率に掛ける', () => {
  const near = (v, want, tol = 2.8) => assert.ok(Math.abs(v - want) <= tol, `${v.toFixed(1)}% のはず ${want}%`)
  near(ailRate(null, null, 'poison', 60), 60)
  near(ailRate(null, { resist: { poison: 0.7 } }, 'poison', 60), 42)
  near(ailRate(null, { resistAll: 0.8 }, 'poison', 60), 48)
  near(ailRate(null, { resist: { poison: 0.7 } }, 'bleed', 60), 60)   // 別の状態異常には効かない
  near(ailRate({ inflictUp: { poison: 1.1 } }, null, 'poison', 60), 66)
  near(ailRate({ inflictUpAll: 1.1 }, { resist: { poison: 0.7 } }, 'poison', 60), 46.2)
})

test('瘴気：自分が付けた毒の1刻み+20%（上限も同じだけ）。遺物の加護：受けた状態異常の持続−1（麻痺の1ターンはそのまま）', () => {
  const poison = { ...HIT, mult: 0.01, ail: { key: 'poison', chance: 100 } }
  const plain = hitOnce({ skill: poison }).b.ail.poison
  const up = hitOnce({ skill: poison, aFx: { poisonDmgPct: 20 } }).b.ail.poison
  assert.equal(plain.rate, POISON_RATE)
  assert.ok(Math.abs(up.rate - POISON_RATE * 1.2) < 1e-12)
  assert.ok(Math.abs(up.cap - plain.cap * 1.2) < 1e-9)
  assert.equal(plain.turns, POISON_TURNS)
  assert.equal(hitOnce({ skill: poison, bFx: { ailTurnsCut: 1 } }).b.ail.poison.turns, POISON_TURNS - 1)
  const para = hitOnce({ skill: { ...poison, ail: { key: 'paralyze', chance: 100 } }, bFx: { ailTurnsCut: 1 } }).b.ail.paralyze
  assert.equal(para.turns, 1, '麻痺（1ターン）は縮めない')
  const bleed = hitOnce({ skill: { ...poison, ail: { key: 'bleed', chance: 100 } }, bFx: { ailTurnsCut: 1 } }).b.ail.bleed
  assert.equal(bleed.age, 1, '出血は3回→2回で消える')
})

// ===== ダメージ =====
test('受けるダメージ：深淵の加護−8%・古兵の意地（HP30%以下）−15%・氷河の守り（鈍足の相手から）−10%・珊瑚の甲殻（物理）−8%', () => {
  const base = hitOnce().dmg
  assert.ok(base > 50)
  assert.equal(hitOnce({ bFx: { takenCut: 8 } }).dmg, Math.floor(base * 0.92))
  assert.equal(hitOnce({ bFx: { physCut: 8 } }).dmg, Math.floor(base * 0.92))
  const low = (hp, fx) => hitOnce({ bFx: fx, prep: (a, b) => { b.hp = hp } }).dmg
  assert.equal(low(300, { lowHpCut: { at: 30, cut: 15 } }), Math.floor(low(300, null) * 0.85), 'HP30%ちょうど')
  assert.equal(low(310, { lowHpCut: { at: 30, cut: 15 } }), low(310, null), 'HP31%は軽くならない')
  const slowed = (fx) => hitOnce({ bFx: fx, prep: (a) => { inflict(a.ail, 'slow') } }).dmg
  assert.equal(slowed({ vsSlowCut: 10 }), Math.floor(slowed(null) * 0.9))
  assert.equal(hitOnce({ bFx: { vsSlowCut: 10 } }).dmg, base, '相手が鈍足でなければ軽くならない')
})

test('大地の守り：クリティカルだけ−20%。与ダメージ：深淵の力+8%・群狼の牙（出血の相手）+10%・峰風（AGIが上）+8%', () => {
  const crit = { ...HIT, noCrit: false, sureCrit: true }
  const c0 = hitOnce({ skill: crit }).dmg
  const c1 = hitOnce({ skill: crit, bFx: { critTakenCut: 20 } }).dmg
  assert.ok(Math.abs(c1 - c0 * 0.8) <= 1, `${c0} → ${c1}`)
  assert.equal(hitOnce({ bFx: { critTakenCut: 20 } }).dmg, hitOnce().dmg, 'クリティカルでなければ変わらない')
  const base = hitOnce().dmg
  assert.ok(Math.abs(hitOnce({ aFx: { dealPct: 8 } }).dmg - base * 1.08) <= 1)
  const bled = (fx) => hitOnce({ aFx: fx, prep: (a, b) => { inflict(b.ail, 'bleed') } }).dmg
  assert.ok(Math.abs(bled({ vsAilDmg: [{ key: 'bleed', pct: 10 }] }) - bled(null) * 1.1) <= 1)
  assert.equal(hitOnce({ aFx: { vsAilDmg: [{ key: 'bleed', pct: 10 }] } }).dmg, base, '出血していなければ変わらない')
  const fast = hitOnce({ aFx: { fasterDmg: 8 }, aStats: { agi: 150 }, bStats: { agi: 100 } }).dmg
  const fast0 = hitOnce({ aStats: { agi: 150 }, bStats: { agi: 100 } }).dmg
  assert.ok(Math.abs(fast - fast0 * 1.08) <= 1)
  assert.equal(hitOnce({ aFx: { fasterDmg: 8 }, aStats: { agi: 100 }, bStats: { agi: 100 } }).dmg,
    hitOnce({ aStats: { agi: 100 }, bStats: { agi: 100 } }).dmg, 'AGIが同じなら乗らない')
})

// ===== 1回だけのもの =====
test('番人の守り：戦闘中1回、倒れるダメージをHP1で耐える（2回目は倒れる）', () => {
  const big = { ...HIT, mult: 50 }
  const fx = { gutsOnce: true, names: { gutsOnce: '番人の守り' } }
  const a = createSide(F({ name: 'A', slots: slot(big) }))
  const b = createSide(F({ name: 'B', setFx: fx, stats: { agi: 1 } }))
  const log = []
  takeAction(a, b, rngOf(1), log)
  assert.equal(b.hp, 1)
  assert.ok(log.some(l => l.type === 'setFx' && l.name === '番人の守り'))
  takeAction(a, b, rngOf(2), log)
  assert.ok(b.hp <= 0)
  // 毒で倒れるときも耐える
  const c = createSide(F({ name: 'C', setFx: fx }))
  inflict(c.ail, 'poison')
  c.hp = 5
  tickAil(c, [], null)
  assert.equal(c.hp, 1)
})

test('天騎士の誓い：戦闘中1回、HP30%以下になったら最大HPの20%を回復', () => {
  const fx = { lowHpHealOnce: { at: 30, pct: 20 }, names: { lowHpHealOnce: '天騎士の誓い' } }
  const r = hitOnce({ bFx: fx, prep: (a, b) => { b.hp = 380 } })
  assert.ok(r.dmg >= 81, `${r.dmg}（HP30%を切るだけ殴れていること）`)
  assert.equal(r.b.hp, 380 - r.dmg + 200)
  assert.ok(r.log.some(l => l.type === 'setFx' && l.name === '天騎士の誓い'))
  // もう1回30%を切っても回復しない
  const before = r.b.hp
  r.b.hp = 290
  const log = []
  takeAction(r.a, r.b, rngOf(9), log)
  assert.ok(r.b.hp < 290 && !log.some(l => l.type === 'setFx'), `${before}`)
})

test('蜃気楼：最初に受ける攻撃（スキル・通常攻撃）を完全にかわす。2回目からはふつう', () => {
  const fx = { dodgeOnce: true, names: { dodgeOnce: '蜃気楼' } }
  const r = hitOnce({ bFx: fx })
  assert.equal(r.dmg, 0)
  assert.equal(r.b.hp, 1000)
  assert.equal(r.log.find(l => l.type === 'skill').hits, 0)
  assert.ok(r.log.some(l => l.type === 'setFx' && l.name === '蜃気楼'))
  const log = []
  takeAction(r.a, r.b, rngOf(3), log)
  assert.ok(r.b.hp < 1000)
  // 通常攻撃（スキルなし）も同じ
  const a = createSide(F({ name: 'A' }))
  const b = createSide(F({ name: 'B', setFx: fx, stats: { agi: 1 } }))
  const l2 = []
  takeAction(a, b, rngOf(4), l2)
  assert.equal(b.hp, 1000)
  assert.equal(l2.find(l => l.type === 'normal').hit, false)
})

test('帯電装甲・炎獄の鎧：攻撃を受けると確率で相手に状態異常（1回の攻撃につき1回・連撃でも1回）', () => {
  const sure = { counterAil: [{ key: 'paralyze', chance: 100 }], names: { counterAil: '帯電装甲' } }
  const r = hitOnce({ bFx: sure, skill: { ...HIT, hits: 3 } })
  assert.ok(hasAilment(r.a.ail, 'paralyze'))
  assert.equal(r.log.filter(l => l.type === 'setFx' && l.name === '帯電装甲').length, 1)
  // 15%のほう（敵の麻痺は受けるたび0.8倍＝毎回作り直して1回目だけ見る）
  const rng = rngOf(21)
  let got = 0
  const n = 4000
  for (let i = 0; i < n; i++) {
    const a = createSide(F({ name: 'A', slots: slot({ ...HIT, mult: 0.01 }) }))
    const b = createSide(F({ name: 'B', setFx: { counterAil: [{ key: 'burn', chance: 20 }] }, stats: { agi: 1 } }))
    takeAction(a, b, rng, [])
    if (hasAilment(a.ail, 'burn')) got++
  }
  assert.ok(Math.abs(got / n * 100 - 20) <= 2.5, `${got / n * 100}%`)
  // 当たらなければ返さない（蜃気楼でかわしたときも）
  const miss = hitOnce({ bFx: { ...sure, dodgeOnce: true } })
  assert.equal(hasAilment(miss.a.ail, 'paralyze'), false)
})

// ===== ステ・パッシブの枠 =====
test('迅雷（3ターンAGI+20%）・毒龍の鱗（状態異常の間VIT+10%）・巨人の剛力（VITの10%をSTRへ）・若葉の息吹（MP+10%）', () => {
  const s = createSide(F({ setFx: { earlyBuff: { turns: 3, table: { agi: 20 } } } }))
  assert.equal(liveStats(s).agi, 120)
  tickForesight(s); tickForesight(s)
  assert.equal(liveStats(s).agi, 120, '3ターン目まで')
  tickForesight(s)
  assert.equal(liveStats(s).agi, 100, '4ターン目から元に戻る')
  const v = createSide(F({ setFx: { whileAilStat: { vit: 10 } } }))
  assert.equal(liveStats(v).vit, 100)
  inflict(v.ail, 'poison')
  assert.equal(liveStats(v).vit, 110)
  const g = createSide(F({ setFx: { convertAdds: [{ from: 'vit', to: 'str', pct: 10 }] } }))
  assert.equal(liveStats(g).str, 110)
  assert.equal(liveStats(g).vit, 100, '元は減らない')
  assert.equal(createSide(F({ setFx: { mpStartPct: 10 } })).mp, 110, '最大MPを超えて始まる')
})

test('砂嵐の帳・天翼（回避+8）・星詠み（クリティカル率+8）・霊峰の加護（消費MP−10%）は今の枠に足す', () => {
  const s = createSide(F({ setFx: { evaBonus: 8, critBonus: 8, mpCut: 10 } }))
  assert.equal(s.pa.evaBonus, 8)
  assert.equal(s.pa.critBonus, 8)
  assert.equal(s.pa.mpCut, 10)
  const a = createSide(F({ setFx: { mpCut: 10 }, slots: slot({ ...HIT, mp: 20 }) }))
  const b = createSide(F({ name: 'B', stats: { agi: 1 } }))
  takeAction(a, b, rngOf(1), [])
  assert.equal(a.mp, 100 - 18)
})

test('森の恵み（毎ターン最大HPの2%）・根を張る（そのターンに受けたダメージの5%をターンの終わりに）', () => {
  const s = createSide(F({ setFx: { regenPct: 2, names: { regenPct: '森の恵み' } } }))
  s.hp = 500
  const log = []
  tickRegen(s, log, null)
  assert.equal(s.hp, 520)
  assert.equal(log[0].name, '森の恵み')
  assert.ok(buildBattleLog({ log }, 'A', 'B')[0].text.includes('森の恵み'))
  const r = hitOnce({ bFx: { rootHealPct: 5, names: { rootHealPct: '根を張る' } } })
  const hp = r.b.hp
  tickRegen(r.b, [], r.a)
  assert.equal(r.b.hp, hp + Math.max(1, Math.floor(r.dmg * 0.05)))
  assert.equal(r.b.rootAcc, 0, 'ターンの終わりに数え直す')
})

test('悠久の守り：自分にかける期限つきの効果の持続+1（期限つきバフ・受け止め）', () => {
  const buff = { name: '受け流し', kind: 'buff', proc: 100, mp: 0, buff: { self: { agi: 25 } }, buffTurns: 3 }
  const guard = { name: '受け止め', kind: 'buff', proc: 100, mp: 0, guard: { cut: 20, turns: 3 } }
  const use = (skill, fx) => { const a = createSide(F({ setFx: fx, slots: slot(skill) })); takeAction(a, createSide(F({ name: 'B' })), rngOf(1), []); return a }
  assert.equal(use(buff, null).timedBuffs[0].turns, 3)
  assert.equal(use(buff, { buffTurnsUp: 1 }).timedBuffs[0].turns, 4)
  assert.equal(use(guard, null).guardsT[0].turns, 3)
  assert.equal(use(guard, { buffTurnsUp: 1 }).guardsT[0].turns, 4)
})

test('ログ：セット能力の行（setFx）は「◯◯の能力名！ 中身」', () => {
  const lines = buildBattleLog({ log: [{ side: 'A', type: 'setFx', name: '蜃気楼', text: '攻撃を完全にかわした！' }] }, 'A', 'B')
  assert.equal(lines[0].text, '🛡 Aの蜃気楼！ 攻撃を完全にかわした！')
})
