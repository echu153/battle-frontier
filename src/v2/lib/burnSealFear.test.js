// 2026-10-10 追加の状態異常（火傷・封印・恐怖）と、麻痺・封印の「受けるたび0.8倍」の回帰テスト（node --test）
// ★どれも「レベルキャップあり」版（src/v2cap）のユーザー指定。今のⅡには撒く技が無く、0.8倍は ailDiminish の印があるときだけ
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction, tickAil, runBattle } from './battle.js'
import {
  inflict, hasAilment, healMultOf, tickAilments, diminishedChance, procCutOf, isSealed, usesMp,
  AIL_KEYS, AIL_LABEL, BURN_TURNS, BURN_RATE, BURN_HEAL_PCT, BURN_CAP_RATE, SEAL_TURNS, FEAR_TURNS, FEAR_PROC,
  SILENCE_PROC, AIL_DIMINISH_MULT, AIL_DIMINISH_KEYS,
} from './ailments.js'
import { buildBattleLog } from './battleLog.js'
import { createAtb, step, chosenOf, needFor, AIL_SEC, TICK_SEC } from './atb.js'
import { AIL_PRICE } from './skills.js'

const stats = (over = {}) => ({ hp:100000, mp:1000, str:100, dex:100, agi:100, int_stat:100, vit:100, luk:100, ...over })
const sk = (name, over = {}) => ({ name, kind:'phys', mult:1, proc:100, mp:0, sureHit:true, desc:'', ...over })
const fighter = (name, slots = [], over = {}) => ({ name, cls:'戦士', kind:'phys', stats: stats(over.stats), slots, ...over.extra })
const fixed = (v) => () => v   // いつも同じ値を返す rng（roll(pct) は v*100 < pct）

test('3種は名簿・表示名・ATBの秒・値段の表にそろって載っている', () => {
  for (const k of ['burn', 'seal', 'fear']) {
    assert.ok(AIL_KEYS.includes(k), k)
    assert.ok(AIL_SEC[k] > 0, `${k} の ATB の秒`)
    assert.ok(AIL_PRICE[k] > 0, `${k} の値段`)
  }
  assert.deepEqual([AIL_LABEL.burn, AIL_LABEL.seal, AIL_LABEL.fear], ['火傷', '封印', '恐怖'])
  // ATB の秒は「1ターン＝TICK_SEC」で読み替えた長さ
  assert.equal(AIL_SEC.burn, BURN_TURNS * TICK_SEC)
  assert.equal(AIL_SEC.seal, SEAL_TURNS * TICK_SEC)
  assert.equal(AIL_SEC.fear, FEAR_TURNS * TICK_SEC)
})

test('火傷：ターン終わりに最大HPの2%を3回刻んで消える・回復量-20%・かかり直すと残りが3へ戻る', () => {
  assert.equal(BURN_RATE, 0.02); assert.equal(BURN_TURNS, 3); assert.equal(BURN_HEAL_PCT, 20)
  const ail = {}
  assert.equal(inflict(ail, 'burn'), true)
  assert.equal(healMultOf(ail), 0.8)
  const t1 = tickAilments(ail, { maxHp: 5000 })
  assert.deepEqual(t1, [{ key:'burn', damage: 100 }])
  tickAilments(ail, { maxHp: 5000 })
  assert.equal(ail.burn.turns, 1)
  inflict(ail, 'burn')                       // 毒と違って、かかっていても入り直す
  assert.equal(ail.burn.turns, BURN_TURNS)
  for (let i = 0; i < BURN_TURNS; i++) tickAilments(ail, { maxHp: 5000 })
  assert.equal(hasAilment(ail, 'burn'), false)
  assert.equal(healMultOf(ail), 1)
})

test('火傷と毒は重なって両方刻む・回復阻害とは掛け合わせる', () => {
  const ail = {}
  inflict(ail, 'poison'); inflict(ail, 'burn'); inflict(ail, 'healCut', { pct: 50 })
  const t = tickAilments(ail, { maxHp: 10000 })
  assert.deepEqual(t.map(x => x.key), ['poison', 'burn'])
  assert.equal(healMultOf(ail), 0.5 * 0.8)
})

test('火傷の1刻みは付けた側の攻撃力×0.4で頭を打つ（HPが桁違いの相手）', () => {
  const me = createSide(fighter('自分', [{ skill: sk('火の粉', { ail:{ key:'burn', chance:100 } }), uses:9 }], { stats:{ str:50, int_stat:10 } }))
  const foe = createSide(fighter('大物', [], { stats:{ hp:10000000, agi:1 } }))
  takeAction(me, foe, fixed(0), [])
  assert.ok(hasAilment(foe.ail, 'burn'))
  const log = []
  tickAil(foe, log, me)
  const tick = log.find(l => l.type === 'ailTick')
  assert.equal(tick.ail, '火傷')
  assert.equal(tick.damage, Math.floor(50 * BURN_CAP_RATE), '2%（20万）ではなく攻撃力50×0.4')
})

test('封印：MPを使う技は出ず通常攻撃になる（MP・使用回数・ポインタは動かない）・MP0の技は出る・2ターンで解ける', () => {
  const mpSkill = sk('強撃', { mult:2, mp:5 })
  const me = createSide(fighter('自分', [{ skill: mpSkill, uses:9 }]))
  const foe = createSide(fighter('敵'))
  inflict(me.ail, 'seal')
  assert.ok(isSealed(me.ail)); assert.equal(SEAL_TURNS, 2)
  const log = []
  takeAction(me, foe, fixed(0), log)
  assert.deepEqual(log.slice(0, 2).map(l => l.type), ['sealed', 'normal'])
  assert.equal(me.mp, 1000); assert.equal(me.slots[0].uses, 9); assert.equal(me.ptr, 0)
  // 画面の文面
  const lines = buildBattleLog({ log }, '自分', '敵').map(l => l.text)
  assert.ok(lines[0].includes('封印されて技が出せない'), lines[0])

  // MP0の技（敵の「たいあたり」など）は封印中も出る
  const free = createSide(fighter('敵2', [{ skill: sk('たいあたり', { mp:0 }), uses:9 }]))
  inflict(free.ail, 'seal')
  const log2 = []
  takeAction(free, foe, fixed(0), log2)
  assert.equal(log2[0].type, 'skill'); assert.equal(log2[0].skill, 'たいあたり')
  assert.equal(usesMp({ mp:0 }), false); assert.equal(usesMp({ mp:5 }), true); assert.equal(usesMp({ mp:0, mpPct:0.2 }), true)

  // 外から枠を指定されても（ATB の opt.idx）封印中は通常攻撃
  const log3 = []
  takeAction(me, foe, fixed(0), log3, { idx: 0 })
  assert.ok(log3.some(l => l.type === 'normal')); assert.ok(!log3.some(l => l.type === 'skill'))

  // 2ターンで解ける
  tickAilments(me.ail, { maxHp: 1 }); tickAilments(me.ail, { maxHp: 1 })
  assert.equal(isSealed(me.ail), false)
  const log4 = []
  takeAction(me, foe, fixed(0), log4)
  assert.equal(log4[0].skill, '強撃')
})

test('封印：MPが尽きただけのときは「封印されて」の行を出さない', () => {
  const me = createSide(fighter('自分', [{ skill: sk('強撃', { mp:5000 }), uses:9 }]))
  inflict(me.ail, 'seal')
  const log = []
  takeAction(me, createSide(fighter('敵')), fixed(0), log)
  assert.ok(!log.some(l => l.type === 'sealed'))
  assert.ok(log.some(l => l.type === 'normal'))
})

test('恐怖：スキルの発動率-20%（サイレンスと同じ・両方なら-40%）', () => {
  assert.equal(FEAR_PROC, 20); assert.equal(FEAR_TURNS, 3)
  const ail = {}
  assert.equal(procCutOf(ail), 0)
  inflict(ail, 'fear')
  assert.equal(procCutOf(ail), FEAR_PROC)
  inflict(ail, 'silence')
  assert.equal(procCutOf(ail), FEAR_PROC + SILENCE_PROC)
  // 発動率100%の技が、rng 0.85（＝85%を引いた）で不発になる
  const me = createSide(fighter('自分', [{ skill: sk('強撃'), uses:9 }]))
  const foe = createSide(fighter('敵'))
  const ok = []
  takeAction(me, foe, fixed(0.85), ok)
  assert.equal(ok[0].type, 'skill', '恐怖なし＝出る')
  inflict(me.ail, 'fear')
  const ng = []
  takeAction(me, foe, fixed(0.85), ng)
  assert.equal(ng[0].type, 'misfire', '恐怖あり＝発動率80%で不発')
  for (let i = 0; i < FEAR_TURNS; i++) tickAilments(me.ail, { maxHp: 1 })
  assert.equal(hasAilment(me.ail, 'fear'), false)
})

test('状態異常だけの補助技は、外れても使った行が出る', () => {
  const roar = sk('咆哮', { kind:'buff', proc:100, mp:0, ail:{ key:'fear', chance:50 } })
  const me = createSide(fighter('ボス', [{ skill: roar, uses:9 }]))
  const foe = createSide(fighter('自分'))
  const miss = []
  takeAction(me, foe, fixed(0.6), miss)        // 60を引く＝50%は外れ
  assert.deepEqual(miss.map(l => l.type), ['buff'])
  const hit = []
  takeAction(me, foe, fixed(0.1), hit)
  assert.deepEqual(hit.map(l => l.type), ['buff', 'ailment'])
  assert.ok(hasAilment(foe.ail, 'fear'))
})

test('麻痺・封印は受けるたび0.8倍（100→80→64%）。外れは数えない・キーは別々・ailDiminish が無ければ変わらない', () => {
  assert.equal(AIL_DIMINISH_MULT, 0.8)
  assert.deepEqual(AIL_DIMINISH_KEYS, ['paralyze', 'seal'])
  assert.ok(Math.abs(diminishedChance(100, 'paralyze', { paralyze: 2 }) - 64) < 1e-9)
  assert.ok(Math.abs(diminishedChance(100, 'seal', { seal: 1 }) - 80) < 1e-9)
  assert.equal(diminishedChance(40, 'poison', { poison: 5 }), 40, '毒などは下がらない')

  const para = sk('しびれ', { kind:'buff', ail:{ key:'paralyze', chance:100 } })
  const seal = sk('封じ', { kind:'buff', ail:{ key:'seal', chance:100 } })
  const me = createSide(fighter('敵', [{ skill: para, uses:99 }, { skill: seal, uses:99 }]))
  const foe = createSide(fighter('自分', [], { extra:{ ailDiminish: true } }))
  assert.equal(foe.ailDiminish, true)
  const hitPara = (r) => { delete foe.ail.paralyze; me.ptr = 0; takeAction(me, foe, fixed(r), []); return hasAilment(foe.ail, 'paralyze') }
  assert.equal(hitPara(0.79), true,  '1回目 100%')
  assert.equal(hitPara(0.79), true,  '2回目 80%（79を引けば入る）')
  assert.equal(hitPara(0.79), false, '3回目 64%（79では入らない）')
  assert.equal(foe.ailTimes.paralyze, 2, '外れたぶんは数えない')
  assert.equal(hitPara(0.63), true,  '3回目のまま 64%（63なら入る）')
  assert.equal(foe.ailTimes.paralyze, 3)
  // 封印は麻痺と別に数える＝まだ100%
  me.ptr = 1
  takeAction(me, foe, fixed(0.99), [])
  assert.ok(isSealed(foe.ail), '封印は1回目なので100%')
  assert.equal(foe.ailTimes.seal, 1)

  // 印が無い（今のⅡ）なら何回受けても100%のまま
  const plain = createSide(fighter('自分'))
  assert.equal(plain.ailDiminish, false)
  for (let i = 0; i < 5; i++) {
    delete plain.ail.paralyze; me.ptr = 0
    takeAction(me, plain, fixed(0.99), [])
    assert.ok(hasAilment(plain.ail, 'paralyze'), `${i + 1}回目`)
  }
})

test('0.8倍の数は戦闘ごとに0から（runBattle は毎回新しく数える）', () => {
  const para = sk('しびれ', { kind:'buff', ail:{ key:'paralyze', chance:100 } })
  const a = fighter('敵', [{ skill: para, uses:99 }], { stats:{ agi:500 } })
  const b = fighter('自分', [], { extra:{ ailDiminish: true } })
  const r1 = runBattle(a, b, { rng: fixed(0.5), maxTurns: 3 })
  const r2 = runBattle(a, b, { rng: fixed(0.5), maxTurns: 3 })
  assert.equal(r1.b.ailTimes.paralyze, r2.b.ailTimes.paralyze)
  assert.ok(r1.b.ailTimes.paralyze >= 1)
})

test('ATB：火傷は5秒ごとに刻む・封印中はMPを使う技を選べない・恐怖は必要ゲージが伸びる', () => {
  const slots = [{ skill: sk('強撃', { mp:5 }), uses:9 }]
  const st = createAtb(fighter('自分', slots), fighter('敵'), { maxSec: 600 })
  inflict(st.a.ail, 'burn')
  st.a.ailUntil.burn = st.t + AIL_SEC.burn
  for (let i = 0; i < Math.round((TICK_SEC + 0.1) / 0.1); i++) step(st, 0.1)
  const ticks = st.log.filter(l => l.type === 'ailTick' && l.ail === '火傷')
  assert.equal(ticks.length, 1)
  assert.equal(ticks[0].damage, Math.floor(st.a.base.hp * BURN_RATE))

  st.a.def = { idx: 0 }
  assert.equal(chosenOf(st.a).skill?.name, '強撃')
  inflict(st.a.ail, 'seal')
  assert.equal(chosenOf(st.a).skill, null, '封印中は通常攻撃へ落ちる')
  delete st.a.ail.seal

  const before = needFor(st.a, slots[0].skill)
  inflict(st.a.ail, 'fear')
  assert.ok(needFor(st.a, slots[0].skill) > before)
})
