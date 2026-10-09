// 一次職の仕組みの回帰テスト（2つ目のまとまり：反動・結界・反撃・追撃・属性・連撃・召喚の強化・回復・溜め・軽減）（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction, runBattle } from '../../v2/lib/battle.js'
import { inflict, hasAilment } from '../../v2/lib/ailments.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { attackKindOf } from './jobs.js'

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
const dummy = (over = {}) => createSide({ name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, ...over }), slots: [], passives: [], noClassBonus: true })
const fixed = (v) => () => v
const mid = fixed(0.5)
const dmgOf = (log, name) => log.find(l => l.type === 'skill' && l.skill === name)?.damage
// pre の技を順に撃ってから name を撃つ。setup で撃つ前の状態を作れる
const castThen = (cls, pre, name, setup = () => {}) => {
  const me = side('私', cls, [...pre, name])
  const foe = dummy()
  setup(me, foe)
  for (let i = 0; i < pre.length; i++) takeAction(me, foe, mid, [])
  const log = []
  takeAction(me, foe, mid, log)
  return { me, foe, log, dmg: dmgOf(log, name) }
}

test('狂撃は与えたダメージの15%を自分も受ける（死なない）・ブラッディロアは攻撃のたびに回復', () => {
  const { me, log } = castThen('狂戦士', [], '狂撃')
  const rc = log.find(l => l.type === 'recoil')
  assert.equal(rc.damage, Math.floor(dmgOf(log, '狂撃') * 0.15))
  assert.equal(me.hp, me.base.hp - rc.damage)
  const low = castThen('狂戦士', [], '狂撃', (m) => { m.hp = 2 })
  assert.equal(low.me.hp, 1, '反動で倒れない')
  const b = castThen('狂戦士', ['ブラッディロア'], '狂撃', (m) => { m.hp = 100 })
  assert.ok(b.log.find(l => l.type === 'skill' && l.skill === '狂撃').drain > 0, '攻撃のたびに回復')
})

test('陰陽結界：受けるダメージ-20%・軽減したぶんの50%を回復', () => {
  const me = side('陰', '陰陽師', ['陰陽結界'])
  const foe = dummy({ str: 400 })
  takeAction(me, foe, mid, [])
  const log = []
  takeAction(foe, me, mid, log)
  assert.ok(log.some(l => l.type === 'guardHeal' && l.heal > 0))
})

test('心眼：かわすたびに物理×0.6で反撃／流水の構え：かわすたび次の攻撃+20%（3回分まで）', () => {
  const me = side('体', '体術師', ['流水の構え', '半月蹴り'])
  me.pa.evaBonus = 1000                    // 必ずかわす
  const foe = dummy()
  takeAction(me, foe, mid, [])
  const log = []
  takeAction(foe, me, mid, log)
  assert.ok(log.some(l => l.type === 'strike' && l.label === '反撃' && l.hit))
  takeAction(foe, me, mid, [])
  takeAction(foe, me, mid, [])
  takeAction(foe, me, mid, [])
  assert.equal(me.dodgeStacks, 3, '3回分まで')
  const l2 = []
  takeAction(me, foe, mid, l2)
  const boosted = dmgOf(l2, '半月蹴り')
  const plain = castThen('体術師', [], '半月蹴り').dmg
  assert.ok(Math.abs(boosted / plain - 1.6) < 0.02, `${boosted} ／ ${plain}`)
  assert.equal(me.dodgeStacks, 0)
})

test('飛天三角蹴り：直前に回避していれば全段クリティカル', () => {
  const me = side('体', '体術師', ['飛天三角蹴り'])
  me.justDodged = true
  const log = []
  takeAction(me, dummy(), mid, log)
  assert.equal(log.find(l => l.type === 'skill').crit, true)
})

test('狙撃手の勘：クリティカルしたら物理×0.5で追撃', () => {
  const me = side('狙', '狙撃手', ['急所射ち'])
  const log = []
  takeAction(me, dummy(), fixed(0), log)    // 必ずクリティカル
  assert.ok(log.some(l => l.type === 'strike' && l.label === '追撃'))
})

test('元素共鳴：直前と違う属性の魔法は+15%（同じ属性では乗らない）・今の魔法使いの技にも属性がある', () => {
  const a = castThen('魔導士', ['フロストノヴァ'], 'ファイアボール')
  const b = castThen('魔導士', ['メテオ'], 'ファイアボール')
  assert.ok(Math.abs(a.dmg / b.dmg - 1.15) < 0.02, `${a.dmg} ／ ${b.dmg}`)
  assert.deepEqual(['ファイア', 'サンダー', 'アイスランス'].map(n => S(n).elem), ['fire', 'thunder', 'ice'])
})

test('天墜竜閃：直前のターンに着地していれば×1.2／影討ち：1ターン目なら威力+50%', () => {
  const land = castThen('竜騎士', [], '天墜竜閃', (m) => { m.turn = 3; m.landedTurn = 2 })
  const no = castThen('竜騎士', [], '天墜竜閃', (m) => { m.turn = 3; m.landedTurn = 0 })
  assert.ok(Math.abs(land.dmg / no.dmg - 1.2) < 0.02)
  const t0 = castThen('暗殺者', [], '影討ち', (m) => { m.turn = 0 })
  const t1 = castThen('暗殺者', [], '影討ち', (m) => { m.turn = 1 })
  assert.ok(Math.abs(t0.dmg / t1.dmg - 1.5) < 0.02)
})

test('連撃の数：千本突き（コンボ10以上で10連撃）・千本手裏剣（分身1体につき+1）・旋風脚（3連撃）', () => {
  const a = castThen('槍術士', [], '千本突き', (m) => { m.combo = 10 })
  assert.equal(a.log.find(l => l.type === 'skill').of, 10)
  const b = castThen('忍者', [], '千本手裏剣', (m) => { m.stk.clone = 2 })
  assert.equal(b.log.find(l => l.type === 'skill').of, 8)
  const c = castThen('体術師', [], '旋風脚')
  assert.equal(c.log.find(l => l.type === 'skill').of, 3)
})

test('召喚の強化：死の行軍で死霊の攻撃+50%・鬼神降ろしで式神が2連撃', () => {
  const run = (cls, list) => runBattle(
    { name: '術', cls, kind: 'mag', stats: stats(), noClassBonus: true, passives: [],
      slots: list.map(n => ({ skill: S(n), uses: 9 })) },
    { name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, str: 1, agi: 1 }), slots: [], passives: [], noClassBonus: true },
    { rng: mid, maxTurns: 2 })
  const last = (r) => r.log.filter(l => l.type === 'strike').at(-1).damage
  const plain = last(run('死霊術師', ['骸骨召喚', '恐怖の囁き']))
  const boosted = last(run('死霊術師', ['骸骨召喚', '死の行軍']))
  assert.ok(Math.abs(boosted / plain - 1.5) < 0.05, `${boosted} ／ ${plain}`)
  const one = last(run('陰陽師', ['式神召喚', '式打ち']))
  const two = last(run('陰陽師', ['式神召喚', '鬼神降ろし']))
  assert.ok(Math.abs(two / one - 2) < 0.1, `${two} ／ ${one}`)
})

test('奇跡：4ターンのあいだ毎ターン最大HPの6%を回復（神聖加護で+30%）', () => {
  const r = runBattle(
    { name: '司', cls: '司祭', kind: 'mag', stats: stats(), noClassBonus: true, passives: [passiveOf('司祭')], startHp: 1000,
      slots: [{ skill: S('奇跡'), uses: 1 }] },
    { name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, str: 1 }), slots: [], passives: [], noClassBonus: true },
    { rng: mid, maxTurns: 6 })
  const ticks = r.log.filter(l => l.type === 'regenTick' && l.side === '司')
  assert.equal(ticks.length, 4)
  assert.equal(ticks[0].heal, Math.floor(10000 * 0.06 * 1.3))
})

test('溜めで伸びる技：ボーンスピア（死霊1体+10%）・掌底波（気1で×1.4）・ソウルドレイン（死霊1体で吸収+5%）', () => {
  const b0 = castThen('死霊術師', [], 'ボーンスピア').dmg
  const b2 = castThen('死霊術師', [], 'ボーンスピア', (m) => { m.stk.undead = 2 }).dmg
  assert.ok(Math.abs(b2 / b0 - 1.2) < 0.02, '死霊2体で+20%')
  const s0 = castThen('気功師', [], '掌底波').dmg
  const s1 = castThen('気功師', [], '掌底波', (m) => { m.stk.ki = 1 })
  assert.equal(s1.me.stk.ki, 0)
  // 丹田（気1つにつき+4%）は使ったあとの気で数える（ドキュメント：急所突きは2.25倍で血の匂いは消える、と同じ考え方）
  assert.ok(Math.abs(s1.dmg / s0 - 1.4) < 0.02, '気1を使って×1.4')
  const d = castThen('死霊術師', [], 'ソウルドレイン', (m) => { m.stk.undead = 3; m.hp = 100 })
  const e = d.log.find(l => l.type === 'skill')
  assert.equal(e.drain, Math.min(Math.floor(e.damage * 0.3), Math.floor(d.me.base.hp * 0.1)))
})

test('クロノブレイク（AGIの差1%につき+1%・最大+60%）・聖なる裁き（封印中×1.3）・毒霧の術（毒と暗闇を別々に判定）', () => {
  const even = castThen('時魔導士', [], 'クロノブレイク').dmg
  const fast = castThen('時魔導士', [], 'クロノブレイク', (m) => { m.base.agi = 1000 }).dmg
  assert.ok(Math.abs(fast / even - 1.6) < 0.03, `${fast} ／ ${even}`)
  const plain = castThen('祓魔師', [], '聖なる裁き').dmg
  const sealed = castThen('祓魔師', [], '聖なる裁き', (m, f) => { inflict(f.ail, 'seal') })
  assert.ok(sealed.dmg / plain > 1.3, '封印中×1.3（退魔の心得の+20%も乗る）')
  // 毒60%・暗闇40%を別々に判定する（乱数0.1なら両方入る・0.5なら毒だけ）
  const fog = side('忍', '忍者', ['毒霧の術'])
  const ff = dummy()
  takeAction(fog, ff, fixed(0.1), [])
  assert.ok(hasAilment(ff.ail, 'poison') && hasAilment(ff.ail, 'blind'))
  const fog2 = side('忍2', '忍者', ['毒霧の術'])
  const ff2 = dummy()
  takeAction(fog2, ff2, mid, [])
  assert.ok(hasAilment(ff2.ail, 'poison') && !hasAilment(ff2.ail, 'blind'))
})

test('魂喰らい：死霊を1体使い、最大HPの15%とMP10を戻す／霊薬：HPとMPを戻す', () => {
  const s = side('死', '死霊術師', ['魂喰らい'])
  s.stk.undead = 2
  s.hp = 100
  s.mp = 20
  const log = []
  takeAction(s, dummy(), mid, log)
  assert.equal(s.stk.undead, 1)
  assert.equal(s.hp, 100 + 1500)
  assert.ok(log.some(l => l.type === 'mpGain' && l.mp === 10))
  const r = side('霊', '霊薬師', ['霊薬'])
  r.hp = 100
  r.mp = 30
  takeAction(r, dummy(), mid, [])
  assert.ok(r.hp > 100 && r.mp > 10)
})

test('砲台の構え（装填がある間-15%）・死者の盾（死霊1体につき-5%）', () => {
  const taken = (cls, setup) => {
    const me = side('私', cls, [], { stats: { vit: 50 } })
    setup(me)
    const foe = dummy({ str: 400 })
    const hp = me.hp
    takeAction(foe, me, mid, [])
    return hp - me.hp
  }
  const base = taken('砲撃士', () => {})
  assert.ok(Math.abs(taken('砲撃士', (m) => { m.stk.load = 1 }) / base - 0.85) < 0.02)
  const nb = taken('死霊術師', () => {})
  assert.ok(Math.abs(taken('死霊術師', (m) => { m.stk.undead = 3 }) / nb - 0.85) < 0.02)
})

test('刻の加護：AGIが相手より高いと20%で追加行動（低いと出ない）', () => {
  const count = (agi) => {
    const r = runBattle(
      { name: '時', cls: '時魔導士', kind: 'mag', stats: stats({ agi }), noClassBonus: true, passives: [passiveOf('時魔導士')],
        // ★相手のAGIを下げない技で比べる（クロノバレットだと途中から自分が速くなる）
        slots: [{ skill: { name: '弾', cls: '時魔導士', kind: 'mag', mult: 1, proc: 100, mp: 0 }, uses: 99 }] },
      { name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, str: 1, agi: 100 }), slots: [], passives: [], noClassBonus: true },
      { rng: fixed(0.1), maxTurns: 10 })
    return r.log.filter(l => l.type === 'extra' && l.side === '時').length
  }
  assert.ok(count(101) > 0)
  assert.equal(count(50), 0)
})
