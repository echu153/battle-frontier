// 一次職の仕組み（battle.js ＋ battleIchiji.js）の回帰テスト（node --test）
// ★2026-10-10 ユーザーの表「一次職スキル一覧」の効果が、戦闘で実際にそのとおり動くか
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction, runBattle } from '../../v2/lib/battle.js'
import { tickIchiji } from '../../v2/lib/battleIchiji.js'
import { inflict, hasAilment } from '../../v2/lib/ailments.js'
import { buildBattleLog } from '../../v2/lib/battleLog.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { ICHIJI_BUILDS } from './skillsIchiji.js'
import { ICHIJI_CLASSES, attackKindOf } from './jobs.js'
import { toFighter } from './loadout.js'

const S = (n) => {
  const s = SKILL_BY_NAME[n]
  assert.ok(s, `${n}がある`)
  return s
}
const stats = (over = {}) => ({ hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30, ...over })
const side = (name, cls, skills = [], over = {}) => createSide({
  name, cls, kind: attackKindOf(cls), stats: stats(over.stats), noClassBonus: true,
  slots: skills.map(n => ({ skill: S(n), uses: 9 })),
  passives: passiveOf(cls) ? [passiveOf(cls)] : [],
})
// 的：殴ってくるだけの相手（技なし）
const dummy = (over = {}) => createSide({ name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, ...over }), slots: [], passives: [], noClassBonus: true })
const fixed = (v) => () => v          // いつも同じ値（roll(pct) は v*100 < pct）
const mid = fixed(0.5)                // 命中する・クリティカルしない・発動率50%超の技は出る
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('パッシブはこの版の名簿から渡る（狂戦士に今のⅡのバーサクが付かない・初期職は無し）', () => {
  const prof = (cls) => ({ username: 'x', class: cls, lv: 50, hp: 400, mp: 100, str: 50, dex: 30, agi: 30, int_stat: 10, vit: 30, luk: 10,
    jobs: { [cls]: { lv: 10, exp: 0 } }, skill_sets: {}, equipped: {} })
  const f = toFighter(prof('狂戦士'), [])
  assert.deepEqual(f.passives.map(p => p.name), ['バーサク'])
  const sd = createSide(f)
  assert.deepEqual(sd.pa.ex.lowHpDmg, [{ at: 50, pct: 15 }, { at: 25, pct: 30 }])
  assert.equal(sd.pa.hpSteps.length, 0, '今のⅡのバーサク（HPの段でステが上がる）は付いていない')
  assert.deepEqual(toFighter(prof('戦士'), []).passives, [])
  // 竜騎士・体術師・暗殺者・狩人・魔銃士も今のⅡと同じ名前の職業。この版のパッシブだけが付く
  for (const cls of ['竜騎士', '体術師', '暗殺者', '狩人', '魔銃士']) {
    assert.equal(createSide(toFighter(prof(cls), [])).passives[0].cls, cls)
    assert.equal(createSide(toFighter(prof(cls), [])).passives[0], passiveOf(cls))
  }
})

test('バーサク：HP50%以下で与ダメージ+15%・25%以下で+30%', () => {
  const dmgAt = (hpPct) => {
    const me = side('狂', '狂戦士', [])
    me.hp = Math.floor(me.base.hp * hpPct / 100)
    const foe = dummy()
    const log = []
    takeAction(me, foe, mid, log)
    return log.find(l => l.type === 'normal').damage
  }
  const full = dmgAt(100)
  assert.ok(Math.abs(dmgAt(50) / full - 1.15) < 0.01)
  assert.ok(Math.abs(dmgAt(20) / full - 1.30) < 0.01)
})

test('跳躍：ジャンプは1ターン敵の攻撃を受けず、次の行動で着地して物理×2.0（竜の血で+15%）', () => {
  const me = side('竜', '竜騎士', ['ジャンプ'])
  const foe = dummy()
  const log = []
  takeAction(me, foe, mid, log)
  assert.ok(me.jumping)
  assert.equal(log.at(-1).type, 'jump')
  const hp0 = me.hp
  takeAction(foe, me, mid, log)
  assert.equal(me.hp, hp0, '跳んでいるあいだは当たらない')
  assert.ok(log.some(l => l.type === 'airEvade'))
  const fhp = foe.hp
  takeAction(me, foe, mid, log)
  assert.equal(me.jumping, null)
  const land = log.find(l => l.type === 'strike' && l.label === 'ジャンプ（着地）')
  assert.ok(land && land.damage > 0 && foe.hp < fhp)
  // 通常攻撃（×1.0）と比べて ×2.0×1.15
  const me2 = side('竜2', '竜騎士', [])
  const l2 = []
  takeAction(me2, dummy(), mid, l2)
  const normal = l2.find(l => l.type === 'normal').damage
  assert.ok(Math.abs(land.damage / normal - 2.0 * 1.15) < 0.05, `着地 ${land.damage} ／ 通常 ${normal}`)
})

test('跳躍：ハイジャンプは2ターン敵の攻撃を受けず、その次の行動で着地', () => {
  const me = side('竜', '竜騎士', ['ハイジャンプ'])
  const foe = dummy()
  const log = []
  takeAction(me, foe, mid, log)            // 跳ぶ
  takeAction(foe, me, mid, log)
  takeAction(me, foe, mid, log)            // 空中で待つ
  assert.ok(me.jumping)
  assert.ok(log.some(l => l.type === 'airborne'))
  takeAction(foe, me, mid, log)
  assert.equal(me.hp, me.base.hp, '2ターンとも当たらない')
  takeAction(me, foe, mid, log)            // 着地
  assert.equal(me.jumping, null)
  assert.ok(log.some(l => l.type === 'strike' && l.label === 'ハイジャンプ（着地）'))
})

test('分身：分身の術で1体 → 相手の攻撃を1回肩代わりして消える（影の連携：分身1体につき追撃）', () => {
  const me = side('忍', '忍者', ['分身の術'])
  const foe = dummy()
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(me.stk.clone, 1)
  takeAction(foe, me, mid, log)
  assert.equal(me.hp, me.base.hp)
  assert.equal(me.stk.clone, 0)
  assert.ok(log.some(l => l.type === 'cloneTaken'))
  // 分身がいると、自分の攻撃のあとに分身の追撃
  const me2 = side('忍2', '忍者', ['影斬り'])
  me2.stk.clone = 2
  const l2 = []
  takeAction(me2, dummy(), mid, l2)
  assert.ok(l2.some(l => l.type === 'strike' && l.label === '分身の追撃（2体）'))
})

test('受け止め：3ターンのあいだ受けるダメージ-20%（ターンが過ぎると切れる）', () => {
  const hit = (useGuard) => {
    const me = side('重', '重戦士', ['受け止め'], { stats: { vit: 50 } })
    const foe = dummy({ str: 400 })
    if (useGuard) takeAction(me, foe, mid, [])
    const hp = me.hp
    takeAction(foe, me, mid, [])
    return { me, taken: hp - me.hp }
  }
  const plain = hit(false).taken
  const { me, taken } = hit(true)
  assert.ok(Math.abs(taken / plain - 0.8) < 0.02, `${taken} ／ ${plain}`)
  for (let i = 0; i < 3; i++) tickIchiji(me)
  assert.equal(me.guardsT.length, 0, '3ターンで切れる')
})

test('気：気弾で+1・練気で+2（最大5）・天衝は全部使って倍率+0.25ずつ', () => {
  const me = side('気', '気功師', ['気弾', '練気', '練気', '練気', '天衝'])
  const foe = dummy()
  takeAction(me, foe, mid, [])
  assert.equal(me.stk.ki, 1)
  takeAction(me, foe, mid, [])
  takeAction(me, foe, mid, [])
  assert.equal(me.stk.ki, 5)
  takeAction(me, foe, mid, [])
  assert.equal(me.stk.ki, 5, '最大5')
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(me.stk.ki, 0)
  const withKi = log.find(l => l.type === 'skill' && l.skill === '天衝').damage
  const me2 = side('気2', '気功師', ['天衝'])
  me2.buffs = { ...me.buffs }            // 練気のSTR+をそろえる
  const l2 = []
  takeAction(me2, dummy(), mid, l2)
  const noKi = l2.find(l => l.type === 'skill' && l.skill === '天衝').damage
  // 気5：(1.2＋0.25×5)÷1.2 ＝ 約2.04倍（丹田の+4%×5は撃つ前に乗るので、さらに1.2倍）
  assert.ok(withKi / noKi > 2.0, `${withKi} ／ ${noKi}`)
})

test('魔銃士：物理と魔法の両方で殴る（同じ倍率の物理だけの技より強い・INTも効く）', () => {
  const me = side('魔銃', '魔銃士', ['マナショット'])
  const l1 = []
  takeAction(me, dummy(), mid, l1)
  const hybrid = l1.find(l => l.type === 'skill').damage
  const phys = createSide({ name: '物', cls: '銃士', kind: 'phys', stats: stats(), noClassBonus: true, passives: [],
    slots: [{ skill: { name: '物理だけ', cls: '銃士', kind: 'phys', mult: 1.2, proc: 100, mp: 1 }, uses: 9 }] })
  const l2 = []
  takeAction(phys, dummy(), mid, l2)
  assert.ok(hybrid > l2.find(l => l.type === 'skill').damage * 1.5)
  // INTを0にすると魔法のぶんが落ちる
  const low = side('魔銃2', '魔銃士', ['マナショット'], { stats: { int_stat: 1 } })
  const l3 = []
  takeAction(low, dummy(), mid, l3)
  assert.ok(l3.find(l => l.type === 'skill').damage < hybrid)
})

test('リザレクション：戦闘中1回だけ、HPが0になったらHP50%で立ち上がる', () => {
  const me = side('司', '司祭', ['リザレクション'])
  const foe = dummy({ str: 100000 })
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(me.reviveReady, 50)
  takeAction(foe, me, mid, log)
  assert.equal(me.hp, Math.floor(me.base.hp * 0.5))
  assert.ok(log.some(l => l.type === 'revive'))
  takeAction(foe, me, mid, log)
  assert.ok(me.hp <= 0, '2回目は立ち上がらない')
  // 使ったあとは、もう一度は撃たない（飛ばす）
  const me2 = side('司2', '司祭', ['リザレクション', '聖光'])
  takeAction(me2, dummy(), mid, [])
  const l2 = []
  takeAction(me2, dummy(), mid, l2)
  assert.ok(l2.some(l => l.type === 'skill' && l.skill === '聖光'))
})

test('召喚：骸骨召喚で死霊が増え（最大3体）、毎ターン死霊の数だけ魔法で攻撃する', () => {
  const r = runBattle(
    { name: '死', cls: '死霊術師', kind: 'mag', stats: stats(), noClassBonus: true, passives: [passiveOf('死霊術師')],
      slots: [{ skill: S('骸骨召喚'), uses: 9 }] },
    { name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, str: 1 }), slots: [], passives: [], noClassBonus: true },
    { rng: lcg(1), maxTurns: 5 })
  const labels = r.log.filter(l => l.type === 'strike').map(l => l.label)
  assert.ok(labels.includes('死霊の攻撃'))
  assert.ok(labels.includes('死霊3体の攻撃'))
  assert.equal(r.a.stk.undead, 3, '最大3体')
})

test('クイック：このターンもう一度行動する（戦闘中2回まで）', () => {
  const me = side('時', '時魔導士', ['クイック', 'クロノバレット'])
  const foe = dummy()
  const log = []
  takeAction(me, foe, mid, log)
  assert.ok(log.some(l => l.type === 'quick'))
  assert.ok(log.some(l => l.type === 'skill' && l.skill === 'クロノバレット'), '同じ行動の中でもう1回動く')
  takeAction(me, foe, mid, log)
  takeAction(me, foe, mid, log)
  assert.equal(me.quickUsed, 2)
  const l2 = []
  takeAction(me, foe, mid, l2)
  assert.ok(!l2.some(l => l.type === 'quick'), '3回目は出ない（飛ばす）')
})

test('フルバースト：装填を全部使って撃ち、そのあと1回は動けない', () => {
  const me = side('砲', '砲撃士', ['装填', '装填', 'フルバースト', '散弾'])
  const foe = dummy()
  takeAction(me, foe, mid, [])
  takeAction(me, foe, mid, [])
  assert.equal(me.stk.load, 2)
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(me.stk.load, 0)
  assert.equal(me.stunned, 1)
  const l2 = []
  takeAction(me, foe, mid, l2)
  assert.deepEqual(l2.map(l => l.type), ['stunned'])
})

test('不動：麻痺・鈍足にかからない／狂信：その間は能力低下を受けない', () => {
  const tank = side('重', '重戦士', [])
  const foe = createSide({ name: '敵', cls: null, kind: 'phys', stats: stats(), noClassBonus: true, passives: [],
    slots: [{ skill: { name: '電撃', cls: null, kind: 'phys', mult: 1, proc: 100, mp: 0, sureHit: true, ail: { key: 'paralyze', chance: 100 } }, uses: 9 }] })
  const log = []
  takeAction(foe, tank, mid, log)
  assert.equal(hasAilment(tank.ail, 'paralyze'), false)
  assert.ok(log.some(l => l.type === 'immune'))
  const ex = side('祓', '祓魔師', ['狂信'])
  takeAction(ex, dummy(), mid, [])
  const debuffer = createSide({ name: '敵2', cls: null, kind: 'phys', stats: stats(), noClassBonus: true, passives: [],
    slots: [{ skill: { name: '威圧', cls: null, kind: 'buff', proc: 100, mp: 0, buff: { enemy: { str: -20 } } }, uses: 9 }] })
  const l2 = []
  takeAction(debuffer, ex, mid, l2)
  assert.equal(ex.buffs.str || 0, 0)
  assert.ok(l2.some(l => l.type === 'debuffImmune'))
})

test('忍耐：4ターンのあいだに受けたダメージの40%を、終わったときに返す', () => {
  const me = side('重', '重戦士', ['忍耐'])
  takeAction(me, dummy(), mid, [])
  assert.ok(me.endure)
  me.endure.acc = 1000
  for (let i = 0; i < 3; i++) assert.equal(tickIchiji(me), 0)
  assert.equal(tickIchiji(me), 400)
  assert.equal(me.endure, null)
})

test('リワインド：直前2ターンで受けたダメージの50%を回復', () => {
  const me = side('時', '時魔導士', ['リワインド'])
  me.hp -= 3000
  me.takenLog = [{ turn: 0, dmg: 1000 }, { turn: 1, dmg: 1000 }, { turn: 2, dmg: 1000 }]
  me.turn = 2
  const log = []
  takeAction(me, dummy(), mid, log)
  assert.equal(log.find(l => l.type === 'heal').heal, 1000, '直前2ターン（1・2）の2000の半分')
})

test('メガボム：相手の状態異常をすべて解除し、1つにつき威力+30%（最大+120%）', () => {
  const me = side('錬', '錬金術師', ['メガボム'])
  const foe = dummy()
  for (const k of ['poison', 'burn', 'slow']) inflict(foe.ail, k)
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(['poison', 'burn', 'slow'].some(k => hasAilment(foe.ail, k)), false)
  const b = log.find(l => l.type === 'ailBurst')
  assert.deepEqual([b.n, b.pct], [3, 90])
})

test('続けて使えない技・溜めが無いと出ない技は飛ばして次の技を撃つ', () => {
  const on = side('陰', '陰陽師', ['禁術・神降ろし', '式打ち'])
  const foe = dummy()
  takeAction(on, foe, mid, [])
  on.ptr = 0                          // 次も禁術の枠から探す
  const log = []
  takeAction(on, foe, mid, log)
  assert.ok(log.some(l => l.type === 'skill' && l.skill === '式打ち'), '禁術は続けて使えない')
  const ki = side('気', '気功師', ['内功', '気弾'])
  const l2 = []
  takeAction(ki, dummy(), mid, l2)
  assert.ok(l2.some(l => l.type === 'skill' && l.skill === '気弾'), '気が無いので内功は飛ばす')
})

test('照準：溜めた数だけ次の射撃が+15%ずつ（使うとリセット）', () => {
  const shot = (aims) => {
    const me = side('狙', '狙撃手', [...Array(aims).fill('照準'), '強弓'])
    for (let i = 0; i < aims; i++) takeAction(me, dummy(), mid, [])
    const log = []
    takeAction(me, dummy(), mid, log)
    assert.equal(me.stk.aim, 0)
    return log.find(l => l.type === 'skill' && l.skill === '強弓').damage
  }
  const d0 = shot(0)
  assert.ok(Math.abs(shot(2) / d0 - 1.3) < 0.02)
})

test('槍の型：当てるたびにコンボ+1（コンボ1につき与ダメージ+1%）', () => {
  const me = side('槍', '槍術士', ['連突き'])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.combo, 3)
})

test('全20職×組み方の例2つで戦っても止まらず、ダメージも数になり、ログが全部文章になる', () => {
  for (const cls of ICHIJI_CLASSES) {
    for (const build of ICHIJI_BUILDS[cls]) {
      const r = runBattle(
        { name: cls, cls, kind: attackKindOf(cls), stats: stats(), noClassBonus: true, passives: [passiveOf(cls)],
          slots: build.map(n => ({ skill: S(n), uses: 3 })) },
        { name: '敵', cls: null, kind: 'phys', stats: stats({ hp: 60000 }), slots: [], passives: [], noClassBonus: true },
        { rng: lcg(7), maxTurns: 30 })
      for (const l of r.log) {
        if ('damage' in l) assert.ok(Number.isFinite(l.damage), `${cls}：${l.type} のダメージが数`)
        if ('heal' in l) assert.ok(Number.isFinite(l.heal), `${cls}：${l.type} の回復が数`)
      }
      const lines = buildBattleLog(r, cls, '敵')
      for (const ln of lines) if (ln.text) assert.ok(!/undefined|NaN/.test(ln.text), `${cls}：${ln.text}`)
      assert.ok(Number.isFinite(r.a.hp) && Number.isFinite(r.b.hp))
    }
  }
})
