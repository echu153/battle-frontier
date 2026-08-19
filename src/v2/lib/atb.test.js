// バトルフロンティアⅡ ATB戦闘のテスト（node --test）
// ★オート戦闘（battle.js）を壊していないことも一緒に見る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAtb, step, needOf, fillRatio, buffSecOf, chosenOf, needNow, buffChips, ailChips,
  GAUGE_BASE, FILL_PER_SEC, TICK_SEC, AIL_SEC, MAX_DT, AGI_EFFECT,
} from './atb.js'
import { runBattle } from './battle.js'
import { inflict, POISON_RATE } from './ailments.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
// 死なないように体力だけ極端に多くする（時間の挙動を見たいので）
const stats = (over = {}) => ({ hp:1000000, mp:1000, str:100, dex:100, agi:100, int_stat:100, vit:100, luk:100, ...over })
const sk = (name, over = {}) => ({ name, kind:'phys', mult:1, proc:100, mp:0, sureHit:true, desc:'', ...over })
const fighter = (name, slots = [], over = {}) => ({ name, cls:'戦士', kind:'phys', stats: stats(over.stats), slots })

// 一定の刻みで進める（0.1秒 = 実際のフレームより粗いがテストには十分）
const run = (st, sec, dt = 0.1) => { for (let i = 0; i < Math.round(sec / dt); i++) step(st, dt) ; return st }

test('必要ゲージは発動率から出る（不発の代わりに溜めが長い）', () => {
  assert.equal(needOf(null), GAUGE_BASE)            // 通常攻撃
  assert.equal(needOf({ proc:100 }), 100)
  assert.equal(needOf({ proc:95 }), 110)
  assert.equal(needOf({ proc:85 }), 130)
  assert.equal(needOf({ proc:75 }), 150)
  assert.equal(needOf({ proc:60 }), 180)
})

test('AGI差の効きは AGI_EFFECT 乗＋クランプ（つまみ1つで弱められる）', () => {
  const r = (a, b) => Number(fillRatio(a, b).toFixed(3))
  assert.equal(AGI_EFFECT, 0.35)
  assert.equal(r(100, 100), 1)
  assert.equal(r(200, 100), 1.275)          // AGI2倍でも+27%しか速くならない
  assert.equal(r(300, 100), 1.469)
  assert.equal(r(1000, 100), 1.5)           // 3.2倍あたりで上限に当たる
  assert.equal(r(100000, 100), 1.5, 'インフレしても上限は超えない')
  assert.equal(r(50, 100), 0.785)
  assert.equal(r(10, 100), 0.75)            // 遅い側も下限で止まる
  assert.equal(r(0, 100), 0.75)
  // ★比で見ているので、両者が同じだけインフレしても効き方は変わらない
  assert.equal(r(200, 100), r(200000, 100000))
})

test('バフの持続は強さで決まる（強いほど短い・30〜120秒）', () => {
  assert.equal(buffSecOf(15), 120)   // 気合い STR+15% → 上限
  assert.equal(buffSecOf(30), 100)   // 駆け足 AGI+30%
  assert.equal(buffSecOf(50), 60)    // 防御態勢 VIT+50%
  assert.equal(buffSecOf(70), 43)    // 魔剣開放 STR・INT+35%
  assert.equal(buffSecOf(200), 30)   // どれだけ強くても下限30秒
  // デバフだけ上限が短い（攻撃技のおまけで積み上がるため）
  assert.equal(buffSecOf(15, true), 60)
  assert.equal(buffSecOf(50, true), 60)
  assert.equal(buffSecOf(70, true), 43)
})

test('等速なら4秒で1行動（ゲージ100）', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(1) })
  run(st, 3.5)
  assert.equal(st.log.length, 0, '3.5秒ではまだ動かない')
  run(st, 1.0)
  const acted = st.log.filter(l => l.type === 'normal')
  assert.equal(acted.length, 2, '4秒で両者1回ずつ通常攻撃する')
})

test('AGIが高いほど行動が増えるが、開く差は最大2倍まで', () => {
  const fast = fighter('速い', [], { stats: stats({ agi:100000 }) })   // 極端に速くても
  const st = createAtb(fast, fighter('敵'), { rng: makeRng(2) })
  run(st, 60)
  const mine = st.log.filter(l => l.side === '速い' && l.type === 'normal').length
  const foe  = st.log.filter(l => l.side === '敵'   && l.type === 'normal').length
  const ratio = mine / foe
  assert.ok(ratio > 1.9 && ratio < 2.1, `上限1.5倍速 vs 下限0.75倍速＝約2倍で頭打ち（実測 ${ratio.toFixed(2)}）`)
})

test('デフォルト行動が出る／予約が優先され、1回で消える', () => {
  const slots = [{ skill: sk('強撃', { mult:1.65, proc:85 }), uses:9 }, { skill: sk('体当たり', { proc:95 }), uses:9 }]
  const st = createAtb(fighter('自分', slots), fighter('敵'), { rng: makeRng(3) })
  st.a.def = { idx: 1 }            // デフォルト＝体当たり
  assert.equal(needNow(st.a), 110)
  run(st, 6)
  assert.equal(st.log.find(l => l.side === '自分' && l.type === 'skill').skill, '体当たり')

  st.a.pending = { idx: 0 }        // 強撃を予約
  assert.equal(needNow(st.a), 130, '予約した技の必要ゲージで待つ')
  run(st, 8)
  const mine = st.log.filter(l => l.side === '自分' && l.type === 'skill')
  assert.equal(mine[1].skill, '強撃')
  assert.equal(st.a.pending, undefined, '予約は1回で消える')
  run(st, 8)
  assert.equal(st.log.filter(l => l.side === '自分' && l.type === 'skill')[2].skill, '体当たり', '次はデフォルトへ戻る')
})

test('撃てない枠（使用回数切れ・MP不足）を選んでいたら通常攻撃へ落ちる', () => {
  const slots = [{ skill: sk('強撃', { mp:5000 }), uses:9 }, { skill: sk('体当たり'), uses:0 }]
  const st = createAtb(fighter('自分', slots), fighter('敵'), { rng: makeRng(4) })
  st.a.def = { idx: 0 }
  assert.equal(chosenOf(st.a).skill, null, 'MPが足りない')
  st.a.def = { idx: 1 }
  assert.equal(chosenOf(st.a).skill, null, '使用回数が無い')
  run(st, 6)
  assert.ok(st.log.some(l => l.side === '自分' && l.type === 'normal'))
})

test('バフは時間で消える（残り秒つきで持つ）', () => {
  const slots = [{ skill: { name:'防御態勢', kind:'buff', proc:100, mp:0, buff:{ self:{ vit:50 } }, desc:'' }, uses:99 }]
  const st = createAtb(fighter('自分', slots), fighter('敵'), { rng: makeRng(5), maxSec: 600 })
  st.a.def = { idx: 0 }
  run(st, 5.5)
  assert.equal(st.a.buffs.vit, 50, 'バフが乗る')
  assert.equal(st.a.timed[0].sec, 60, 'VIT+50% は60秒もつ')
  assert.ok(buffChips(st.a, st.t)[0].sec >= 58, '残り秒が減っていく')
  run(st, 30)
  assert.ok(st.a.buffs.vit > 50, '撃ち続けるぶんは積み上がる')
  const stacked = st.a.timed.length
  assert.ok(stacked > 1)
  // 60秒経つと古いものから順に切れる
  st.a.def = { idx: null }
  run(st, 40)
  assert.ok(st.a.timed.length < stacked, '古いバフから消えていく')
  run(st, 70)
  assert.equal(st.a.timed.length, 0, '撒き直さなければ全部消える')
  assert.equal(st.a.buffs.vit ?? 0, 0, '元に戻る')
})

test('職業補正・パッシブぶんのバフは時間で消えない', () => {
  const f = { name:'自分', cls:'狂戦士', jobCount:3, stats: stats(), slots: [] }  // 狂戦士は STR+10.2%・VIT-5%
  const st = createAtb(f, fighter('敵'), { rng: makeRng(6), maxSec: 600 })
  const base = { ...st.a.baseBuffs }
  assert.ok(Object.keys(base).length > 0, '職業補正が乗っている')
  run(st, 200)
  for (const [k, v] of Object.entries(base)) assert.equal(st.a.buffs[k], v, k)
})

test('麻痺のあいだはゲージが止まり、5秒で解ける', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(7) })
  run(st, 1)
  inflict(st.a.ail, 'paralyze')
  st.a.ailUntil.paralyze = st.t + AIL_SEC.paralyze
  const g = st.a.gauge
  run(st, 3)
  assert.equal(st.a.gauge, g, '止まっているあいだは1も溜まらない')
  assert.equal(ailChips(st.a, st.t)[0].label, '麻痺')
  run(st, 3)
  assert.ok(st.a.gauge > g, '5秒で解けて再び溜まりだす')
})

test('毒は5秒ごとに最大HPの3%を刻み、30秒で消える', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(8), maxSec: 600 })
  inflict(st.a.ail, 'poison')
  st.a.ailUntil.poison = st.t + AIL_SEC.poison
  const max = st.a.base.hp
  run(st, TICK_SEC + 0.1)
  const ticks = st.log.filter(l => l.type === 'ailTick' && l.ail === '毒')
  assert.equal(ticks.length, 1)
  assert.equal(ticks[0].damage, Math.floor(max * POISON_RATE))
  run(st, 26)
  assert.equal(st.log.filter(l => l.type === 'ailTick' && l.ail === '毒').length, 6, '30秒で6回')
  run(st, 10)
  assert.equal(st.log.filter(l => l.type === 'ailTick' && l.ail === '毒').length, 6, '期限が来たら止まる')
  assert.equal(st.a.ail.poison, undefined)
})

test('裏タブ対策：1回のstepで進むのは MAX_DT まで', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(9) })
  step(st, 60)
  assert.equal(st.t, MAX_DT)
  assert.equal(st.a.gauge, FILL_PER_SEC * MAX_DT)
})

test('決着すると勝敗が付き、以後は進まない', () => {
  const glass = fighter('紙', [], { stats: stats({ hp:1 }) })
  const st = createAtb(fighter('自分'), glass, { rng: makeRng(10) })
  run(st, 30)
  assert.equal(st.over, true)
  assert.equal(st.winner, 'a')
  const n = st.log.length
  run(st, 10)
  assert.equal(st.log.length, n, '終わったら何も起きない')
})

test('制限時間を超えると引き分け', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(11), maxSec: 20 })
  run(st, 25)
  assert.equal(st.over, true)
  assert.equal(st.winner, 'draw')
})

test('オート戦闘（runBattle）は takeAction の引数追加で変わっていない', () => {
  const slots = [{ skill: sk('強撃', { mult:1.65, proc:85 }), uses:3 }]
  const a = { name:'A', cls:'戦士', kind:'phys', stats: stats({ hp:5000 }), slots }
  const b = { name:'B', cls:'戦士', kind:'phys', stats: stats({ hp:5000 }), slots }
  const r1 = runBattle(a, b, { rng: makeRng(12) })
  const r2 = runBattle(a, b, { rng: makeRng(12) })
  assert.equal(r1.winner, r2.winner)
  assert.equal(r1.turns, r2.turns)
  assert.deepEqual(r1.log, r2.log)
  // 不発（proc85%）がちゃんと起きている＝オート側は発動率を使い続けている
  assert.ok(runBattle(a, b, { rng: makeRng(13) }).log.some(l => l.type === 'misfire'))
})
