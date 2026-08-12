// バトルフロンティアⅡ 戦闘ループの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBattle, createSide, peekSkill, attackKindOf, NORMAL_ATTACK_MULT, MAX_TURNS } from './battle.js'
import { INITIAL_STATS, applyExp } from './stats.js'
import { skillsOf } from './skills.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}
// 検証しやすいように、当たる・当たらないが確定するダミースキルを作る
const sk = (name, over = {}) => ({ name, cls:'テスト', kind:'phys', mult:1, proc:100, mp:0, desc:'', ...over })
const fighter = (name, slots, stats = evenStats(534)) => ({ name, cls:'戦士', kind:'phys', stats, slots })

test('職業の通常攻撃はSTR参照かINT参照かが決まる', () => {
  for (const c of ['戦士', '弓使い', '格闘家', 'ノーブル']) assert.equal(attackKindOf(c), 'phys', c)
  for (const c of ['魔法使い', '僧侶', 'サモナー'])         assert.equal(attackKindOf(c), 'mag', c)
  assert.equal(NORMAL_ATTACK_MULT, 1.0)
})

test('スキルはセットした順に1巡する（ABC→ABC）', () => {
  const slots = ['A', 'B', 'C'].map(n => ({ skill: sk(n, { proc:100 }), uses: 2 }))
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(1), maxTurns: 6 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used.slice(0, 6), ['A', 'B', 'C', 'A', 'B', 'C'])
})

test('使用回数を使い切った枠は飛ばす', () => {
  const slots = [
    { skill: sk('A', { proc:100 }), uses: 1 },
    { skill: sk('B', { proc:100 }), uses: 3 },
  ]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(2), maxTurns: 4 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used.slice(0, 4), ['A', 'B', 'B', 'B'])  // Aは1回だけ、あとはBが回る
})

test('不発ならMPも使用回数も減らず、ポインタも進まない', () => {
  // 先頭を必ず不発（proc:0）にする。後ろのBには永久に進まない
  const slots = [
    { skill: sk('詰まる技', { proc:0, mp:5 }), uses: 3 },
    { skill: sk('B', { proc:100, mp:5 }), uses: 3 },
  ]
  const me = fighter('me', slots)
  const r = runBattle(me, fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(3), maxTurns: 8 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.ok(mine.every(l => l.type !== 'skill'), 'Bには一度も進まない')
  assert.equal(mine.filter(l => l.type === 'misfire').length, 8)
  assert.equal(r.a.slots[0].uses, 3, '使用回数が減っていない')
  assert.equal(r.a.mp, me.stats.mp, 'MPが減っていない')
})

test('不発のターンは通常攻撃をする', () => {
  const slots = [{ skill: sk('不発', { proc:0 }), uses: 5 }]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(4), maxTurns: 5 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.equal(mine.filter(l => l.type === 'misfire').length, 5)
  assert.equal(mine.filter(l => l.type === 'normal').length, 5)
})

test('MPが足りない枠は飛ばす（使用回数は減らない）', () => {
  const slots = [
    { skill: sk('高い技', { proc:100, mp: 10 ** 6 }), uses: 3 },
    { skill: sk('安い技', { proc:100, mp: 0 }), uses: 3 },
  ]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(5), maxTurns: 3 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used, ['安い技', '安い技', '安い技'])
  assert.equal(r.a.slots[0].uses, 3)
})

test('撃てる枠が無くなったら通常攻撃だけになる', () => {
  const slots = [{ skill: sk('A', { proc:100 }), uses: 1 }]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(6), maxTurns: 4 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.equal(mine.filter(l => l.type === 'skill').length, 1)
  assert.equal(mine.filter(l => l.type === 'normal').length, 3)
})

test('先制スキルは行動順を取る（AGIで負けていても先に動く）', () => {
  const slow = { ...evenStats(534), agi: 1 }
  const fast = { ...evenStats(534), agi: 10 ** 5 }
  const pri = [{ skill: sk('先制', { proc:100, priority:1 }), uses: 99 }]
  const norm = [{ skill: sk('通常', { proc:100 }), uses: 99 }]
  const r = runBattle(
    { name:'おそい', cls:'戦士', kind:'phys', stats: slow, slots: pri },
    { name:'はやい', cls:'戦士', kind:'phys', stats: fast, slots: norm },
    { rng: makeRng(7), maxTurns: 1 })
  assert.equal(r.log[0].side, 'おそい')
  // 優先度が同じならAGIの速いほうが先
  const r2 = runBattle(
    { name:'おそい', cls:'戦士', kind:'phys', stats: slow, slots: norm },
    { name:'はやい', cls:'戦士', kind:'phys', stats: fast, slots: norm },
    { rng: makeRng(7), maxTurns: 1 })
  assert.equal(r2.log[0].side, 'はやい')
})

test('AGIが上なら追加行動が出る', () => {
  const slow = { ...evenStats(534), agi: 10 }
  const fast = { ...evenStats(534), agi: 200 }   // 20倍＝上限50%
  const slots = [{ skill: sk('A', { proc:100 }), uses: 99 }]
  const r = runBattle(
    { name:'はやい', cls:'戦士', kind:'phys', stats: { ...fast, hp: 10 ** 7 }, slots },
    { name:'おそい', cls:'戦士', kind:'phys', stats: { ...slow, hp: 10 ** 7 }, slots },
    { rng: makeRng(8), maxTurns: 60 })
  const extras = r.log.filter(l => l.type === 'extra')
  assert.ok(extras.length > 0, '追加行動が一度も出ていない')
  assert.ok(extras.every(l => l.side === 'はやい'), '遅いほうに追加行動が出ている')
})

test('回復は最大HPを超えない', () => {
  const heal = [{ skill: sk('回復', { kind:'heal', proc:100, heal:{ rate:10 ** 4 } }), uses: 99 }]
  const r = runBattle(
    { name:'me', cls:'僧侶', kind:'mag', stats: evenStats(534), slots: heal },
    { name:'foe', cls:'戦士', kind:'phys', stats: evenStats(534), slots: [] },
    { rng: makeRng(9), maxTurns: 5 })
  assert.ok(r.a.hp <= r.a.base.hp, `HP${r.a.hp} / 最大${r.a.base.hp}`)
})

test('バフはステータスに乗り、ターンが切れると消える', () => {
  const buff = [
    { skill: sk('強化', { kind:'buff', proc:100, buff:{ self:{ str:100 }, turns:2 } }), uses: 1 },
    // クリと回避のブレを消して、バフの有無だけを比べる
    { skill: sk('殴る', { proc:100, sureHit:true, noCrit:true }), uses: 99 },
  ]
  const r = runBattle(
    fighter('me', buff), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }),
    { rng: makeRng(10), maxTurns: 8 })
  const hits = r.log.filter(l => l.side === 'me' && l.type === 'skill' && l.skill === '殴る')
  assert.ok(hits.length >= 4)
  // バフ中の一撃はバフ切れ後より大きい
  assert.ok(hits[0].damage > hits[hits.length - 1].damage,
    `バフ中${hits[0].damage} / 切れた後${hits[hits.length - 1].damage}`)
  assert.deepEqual(r.a.buffs, {}, 'バフが残っている')
})

test('実際の職業どうしで決着する', () => {
  const rng = makeRng(2026)
  const stats = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, 60 * 500, rng).stats
  for (const [ca, cb] of [['戦士', '魔法使い'], ['弓使い', '僧侶'], ['格闘家', 'サモナー']]) {
    const r = runBattle(
      { name:ca, cls:ca, stats, slots: skillsOf(ca).map(s => ({ skill:s, uses:5 })) },
      { name:cb, cls:cb, stats, slots: skillsOf(cb).map(s => ({ skill:s, uses:5 })) },
      { rng })
    assert.ok(['a', 'b'].includes(r.winner), `${ca} vs ${cb} が引き分け（${r.turns}ターン）`)
    assert.ok(r.turns < MAX_TURNS, `${ca} vs ${cb} が長すぎる（${r.turns}ターン）`)
  }
})

test('peekSkill は次に撃つ枠を返す（行動順の判定に使う）', () => {
  const side = createSide(fighter('me', [
    { skill: sk('A', { proc:100 }), uses: 0 },   // 使い切り
    { skill: sk('B', { proc:100 }), uses: 1 },
  ]))
  assert.equal(peekSkill(side).name, 'B')
  side.slots[1].uses = 0
  assert.equal(peekSkill(side), null)  // 撃てる枠が無い＝通常攻撃
})
