// 上位クラスの作り直し（2026-10-15 チャット版の設計）の仕組みが、戦闘で設計どおりに動くか（node --test）
// 設計：https://claude.ai/artifact/DvAQoMxY6sChec3wQhsFBE ・ docs/v2cap-design.md §4
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction, liveStats, tickForesight, tickAil, tickRegen } from '../../v2/lib/battle.js'
import { tickIchiji, gainHp } from '../../v2/lib/battleIchiji.js'
import { inflict, hasAilment } from '../../v2/lib/ailments.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { attackKindOf } from './jobs.js'
import { ascendSkill as ascUp } from './ascension.js'

const S = (n) => { const s = SKILL_BY_NAME[n]; assert.ok(s, `${n}がある`); return s }
const stats = (over = {}) => ({ hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30, ...over })
const side = (name, cls, skills = [], over = {}) => createSide({
  name, cls, kind: attackKindOf(cls), stats: stats(over.stats), noClassBonus: true,
  slots: skills.map(n => (typeof n === 'string' ? { skill: S(n), uses: 9 } : { skill: n, uses: 9 })),
  passives: passiveOf(cls) ? [passiveOf(cls)] : [],
})
const dummy = (over = {}) => createSide({ name: '的', cls: null, kind: 'phys', stats: stats({ hp: 10000000, ...over }), slots: [], passives: [], noClassBonus: true })
const fixed = (v) => () => v
const mid = fixed(0.5)
const STANCE = { proc: 20, mult: 1.5, priority: 1 }
// その技を1回撃ったときのダメージ（setup で撃つ前の状態を作る）
const hit = (cls, name, setup = () => {}, rng = mid, foe = dummy()) => {
  const me = side('私', cls, [name])
  setup(me, foe)
  const log = []
  takeAction(me, foe, rng, log)
  const e = log.find(l => l.type === 'skill' && l.skill === name)
  return { me, foe, log, dmg: e?.damage ?? 0, e }
}
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

test('技は CLASS LV 1／5／10／15／20／25／30／35／40／45 で10個（22職とも・35と45は新しい技）', async () => {
  const { STAGES, ICHIJI_CLASSES, learnOrderOf } = await import('./jobs.js')
  assert.deepEqual(STAGES.ichiji.learnAt, [1, 5, 10, 15, 20, 25, 30, 35, 40, 45])
  for (const c of ICHIJI_CLASSES) assert.equal(learnOrderOf(c).length, 10, `${c}は10個`)
})

test('回数の上限がある技（狂鬼化・ゴスペル・エリクサー＝1回・不動の誓い＝2回）は、編成に多く置いても戦闘ではそこまで', () => {
  for (const [n, max] of [['狂鬼化', 1], ['ゴスペル', 1], ['エリクサー', 1], ['不動の誓い', 2]]) {
    assert.equal(S(n).usesMax, max)
    const sd = createSide({ name: 'x', cls: S(n).cls, kind: 'phys', stats: stats(), noClassBonus: true, slots: [{ skill: S(n), uses: 5 }], passives: [] })
    assert.equal(sd.slots[0].uses, max)
  }
})

// ===== 侍【納刀】=====
test('秘剣・叢雲：納刀中は1.5倍ではなく大きい倍率（設計1.8倍→測って1.7倍）・納刀していないと0.8倍（納刀の倍率は STR×倍率 のぶんに掛かる）', () => {
  const on = hit('侍', '秘剣・叢雲', (me) => { me.stance = { ...STANCE } })
  const off = hit('侍', '秘剣・叢雲')
  const sk = S('秘剣・叢雲')
  assert.ok(sk.stanceMult > 1.5 && sk.noStanceMult === 0.8)
  const want = (300 * sk.mult * sk.stanceMult + 150 * sk.add[0].rate) / (300 * sk.mult * sk.noStanceMult + 150 * sk.add[0].rate)
  assert.ok(near(on.dmg / off.dmg, want), `${on.dmg} ／ ${off.dmg}（見込み×${want.toFixed(3)}）`)
})
test('居合の構え：スキルが不発したら通常攻撃（1.5倍）のあと納刀状態になる', () => {
  const me = side('侍', '侍', ['秘剣・叢雲'])
  const log = []
  takeAction(me, dummy(), fixed(0.9), log)   // 発動率75% → 90で不発
  assert.ok(log.some(l => l.type === 'misfire'))
  assert.equal(log.find(l => l.type === 'normal').mult, 1.5)
  assert.deepEqual(me.stance, STANCE)
})
test('二の太刀：直前の技を納刀中に撃っていれば威力+25%・当てたらもう一度納刀（直前が納刀なしなら何も起きない）', () => {
  const after = hit('侍', '二の太刀', (me) => { me.thisStanced = true })
  const plain = hit('侍', '二の太刀')
  assert.ok(near(after.dmg / plain.dmg, 1.25), `${after.dmg} ／ ${plain.dmg}`)
  assert.deepEqual(after.me.stance, STANCE)
  assert.equal(plain.me.stance, null)
})
test('明鏡止水：STRとDEXが上がり、納刀状態になる（2026-10-15 STR+30%・DEX+20%→STR+20%・DEX+15%＝名簿から読む）', () => {
  const me = side('侍', '侍', ['明鏡止水'])
  takeAction(me, dummy(), mid, [])
  assert.deepEqual(me.stance, STANCE)
  const up = SKILL_BY_NAME['明鏡止水'].buff.self
  assert.deepEqual([me.buffs.str, me.buffs.dex], [up.str, up.dex])
})

// ===== 魔法剣士【属性の宿り】=====
test('宿り：属性の剣技を当てると宿る（上書き）・宿っている間はINTの20%がSTRに上乗せ・3ターンで消える・魔剣開放で+2', () => {
  const me = side('魔', '魔法剣士', ['フロストエッジ', '雷光斬', '魔剣開放'])
  const foe = dummy()
  const str0 = liveStats(me).str
  takeAction(me, foe, mid, [])
  assert.deepEqual(me.imbue, { elem: 'ice', turns: 3 })
  assert.equal(liveStats(me).str, str0 + Math.round(liveStats(me).int_stat * 0.2))
  takeAction(me, foe, mid, [])
  assert.equal(me.imbue.elem, 'thunder', '別の属性で上書き')
  takeAction(me, foe, mid, [])
  assert.equal(me.imbue.turns, 5, '魔剣開放で残りターン+2')
  for (let i = 0; i < 5; i++) tickIchiji(me)
  assert.equal(me.imbue, null)
  assert.equal(liveStats(me).str, str0 + Math.round(str0 * 0.2), '宿りが消えたら上乗せも消える（魔剣開放のSTR+20%は残る・2026-10-17 に+30%から）')
})
test('宿りの追加効果：炎＝INT×0.2の追撃／氷＝相手のAGI−5%（宿りで下げるのは合計−20%まで）／エレメンタルエッジは2倍', () => {
  const fire = hit('魔法剣士', 'マナエッジ', (me) => { me.imbue = { elem: 'fire', turns: 3 } })
  assert.ok(fire.log.some(l => l.type === 'strike' && l.label === '炎の追撃' && l.damage > 0))
  const me = side('魔', '魔法剣士', ['エレメンタルエッジ'])
  me.imbue = { elem: 'ice', turns: 9 }
  const foe = dummy()
  takeAction(me, foe, mid, [])
  assert.equal(foe.buffs.agi, -10, '2倍で−10%')
  takeAction(me, foe, mid, [])
  takeAction(me, foe, mid, [])
  assert.equal(foe.buffs.agi, -20, '合計−20%で止まる')
})
test('マナバースト：宿りを消して威力+30%・その属性の状態異常を40%で（宿りが無いと上乗せなし）', () => {
  const on = hit('魔法剣士', 'マナバースト', (me) => { me.imbue = { elem: 'fire', turns: 3 } }, fixed(0.1))
  assert.equal(on.me.imbue, null)
  assert.ok(on.log.some(l => l.type === 'imbueUse'))
  assert.ok(hasAilment(on.foe.ail, 'burn'))
  const off = hit('魔法剣士', 'マナバースト', () => {}, fixed(0.1))
  assert.equal(off.log.some(l => l.type === 'imbueUse'), false)
})
test('トリニティブレイド：炎→氷→雷の順に各段の追加効果・最後に雷が宿る', () => {
  const r = hit('魔法剣士', 'トリニティブレイド')
  assert.ok(r.log.some(l => l.type === 'strike' && l.label === '炎の追撃'))
  assert.equal(r.foe.buffs.agi, -5)
  assert.deepEqual(r.me.imbue, { elem: 'thunder', turns: 3 })
})

// ===== 狂戦士【HPを払う】=====
test('HPを払う：マッドラッシュは最大HPの3%', () => {
  const me = side('狂', '狂戦士', ['マッドラッシュ'])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.base.hp - me.hp, 300)
})
test('【確定】2026-10-16 狂鬼化（ユーザーがシートで書き直した）：HPが1になる・3ターンHPが1より下がらない・回復を受けない・STR+50%（バトル中1回）・HP30%以下で使う（10-17）', () => {
  const me = side('狂', '狂戦士', ['狂鬼化', 'マッドラッシュ'])
  const str0 = liveStats(me).str
  // HPが30%より多いあいだは使わない（2026-10-17 ユーザー選択）＝次の技（マッドラッシュ）を撃つ
  const l0 = []
  takeAction(me, dummy(), mid, l0)
  assert.ok(!l0.some(l => l.type === 'berserkUp') && me.berserk === null, 'HP97%では使わない')
  assert.ok(l0.some(l => l.type === 'skill' && l.skill === 'マッドラッシュ'))
  me.hp = Math.floor(me.base.hp * 0.3)
  me.ptr = 0
  const log = []
  takeAction(me, dummy(), mid, log)
  assert.equal(me.hp, 1, 'HPが1になる')
  assert.deepEqual(me.berserk, { turns: 3 })
  assert.ok(log.some(l => l.type === 'berserkUp' && l.turns === 3 && l.str === 50))
  assert.ok(near(liveStats(me).str / str0, 1.5), 'STR+50%')
  // 倒れるダメージ・毒でもHP1のまま
  const big = side('巨', '戦士', [], { stats: { str: 100000 } })
  const l2 = []
  takeAction(big, me, mid, l2)
  assert.equal(me.hp, 1)
  assert.ok(l2.some(l => l.type === 'berserkHold'))
  me.ail.poison = { turns: 3, rate: 0.5 }
  tickAil(me, [], big)
  assert.equal(me.hp, 1, '毒でも倒れない')
  // 回復を受けない（技・ブラッディロアの吸収・毎ターンの回復も gainHp を通る）
  assert.equal(gainHp(me, 5000), 0)
  me.regenMax = { pct: 10, turns: 2 }
  tickRegen(me, [], big)
  assert.equal(me.hp, 1)
  // 続いているあいだは撃ち直さない（バトル中1回）
  takeAction(me, dummy(), mid, [])
  assert.deepEqual(me.berserk, { turns: 3 }, 'まだ3ターン（ターンの終わりで減る）')
  // 3ターンの終わりで切れる（STRも戻る）→ 回復を受ける・倒れる
  for (let i = 0; i < 3; i++) { tickForesight(me); tickIchiji(me) }
  assert.equal(me.berserk, null)
  assert.ok(near(liveStats(me).str / str0, 1), 'STRが戻る')
  delete me.ail.poison
  assert.ok(gainHp(me, 500) > 0, '切れたら回復を受ける')
  takeAction(big, me, mid, [])
  assert.ok(me.hp <= 0, '切れたら倒れる')
})
test('【確定】2026-10-16 アセンションの特別なマス：狂鬼化は4ターン・ブラッドサクリファイスは最大HPの15%を払って50%を追加ダメージ', async () => {
  const { ascendSkill } = await import('./ascension.js')
  const me = side('狂', '狂戦士', [ascendSkill(S('狂鬼化'))])
  me.hp = Math.floor(me.base.hp * 0.3)   // HP30%以下で使う
  takeAction(me, dummy(), mid, [])
  assert.deepEqual(me.berserk, { turns: 4 })
  const plainSkill = { ...S('ブラッドサクリファイス'), paidDmg: 0 }
  const asc = ascendSkill(S('ブラッドサクリファイス'))
  const dmgOf = (skill) => {
    const m = side('狂', '狂戦士', [skill])
    const log = []
    takeAction(m, dummy(), mid, log)
    return { dmg: log.find(l => l.type === 'skill').damage, paid: m.base.hp - m.hp }
  }
  const a = dmgOf(asc)
  assert.equal(a.paid, 1500, '最大HPの15%')
  assert.equal(a.dmg - dmgOf({ ...plainSkill, hpCostMax: { pct: 15 } }).dmg, Math.floor(1500 * 0.5))
})
test('【確定】2026-10-16 アセンションの特別なマス：桜花一閃は納刀中に威力+30%（納刀していなければ変わらない）', async () => {
  const { ascendSkill } = await import('./ascension.js')
  const asc = ascendSkill(S('桜花一閃'))
  const base = S('桜花一閃')
  const inStance = (skill) => hit('侍', skill.name === base.name ? base.name : base.name, (me) => { me.slots = [{ skill, uses: 9 }]; me.stance = { ...STANCE } }).dmg
  const noStance = (skill) => hit('侍', base.name, (me) => { me.slots = [{ skill, uses: 9 }] }).dmg
  assert.ok(near(inStance(asc) / inStance(base), 1.3), `納刀中 ${inStance(asc)}／${inStance(base)}`)
  assert.equal(noStance(asc), noStance(base), '納刀していなければ同じ')
})
test('ブラッドサクリファイス：払ったHP（最大HPの12%）の40%を防御無視の追加ダメージにする', () => {
  const r = hit('狂戦士', 'ブラッドサクリファイス')
  const plainSkill = { ...S('ブラッドサクリファイス'), paidDmg: 0 }
  const me = side('狂', '狂戦士', [plainSkill])
  const log = []
  takeAction(me, dummy(), mid, log)
  const plain = log.find(l => l.type === 'skill').damage
  assert.equal(r.dmg - plain, Math.floor(1200 * 0.4))
})

// ===== 聖騎士【聖光】=====
test('聖光：防御や軽減で減らしたダメージの20%を溜める（上限は最大HPの15%）・大防御のターンは2倍', () => {
  const me = side('聖', '聖騎士', [], { stats: { vit: 600 } })
  const foe = side('敵', '戦士', [], { stats: { str: 800 } })
  takeAction(foe, me, mid, [])
  assert.ok(me.holy > 0)
  const one = me.holy
  const me2 = side('聖2', '聖騎士', [], { stats: { vit: 600 } })
  me2.holyTurnMult = 2
  takeAction(side('敵2', '戦士', [], { stats: { str: 800 } }), me2, mid, [])
  assert.ok(Math.abs(me2.holy - one * 2) <= 1, `${me2.holy} ／ ${one}`)
  me.holy = 999999
  takeAction(foe, me, mid, [])
  assert.equal(me.holy, 1500, '上限は最大HPの15%')
})
test('ジャッジメントブロウは聖光の半分・グランドクロスは全部を使い、使った量を追加ダメージにする', () => {
  const half = hit('聖騎士', 'ジャッジメントブロウ', (me) => { me.holy = 1000 })
  const none = hit('聖騎士', 'ジャッジメントブロウ')
  assert.equal(half.me.holy, 500)
  assert.equal(half.dmg - none.dmg, 500)
  const all = hit('聖騎士', 'グランドクロス', (me) => { me.holy = 800 })
  assert.equal(all.me.holy, 0)
  assert.ok(all.log.some(l => l.type === 'holyUse' && l.n === 800))
})
test('不動の誓い：3ターンの間 受けるダメージ−15%・状態異常にかからない・溜まる聖光+50%', () => {
  const me = side('聖', '聖騎士', ['不動の誓い'])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.ailImmune, 3)
  assert.equal(me.holyUp.pct, 50)
  assert.ok(me.guardsT.some(g => g.cut === 15 && g.turns === 3))
  const foe = side('暗', '暗殺者', ['ヴァイパーストライク'])
  const log = []
  takeAction(foe, me, fixed(0.1), log)
  assert.equal(hasAilment(me.ail, 'poison'), false)
  assert.ok(log.some(l => l.type === 'immune'))
})

// ===== 竜騎士【跳躍】=====
test('竜翔：その間 跳躍の技の発動率+10%・着地+20%／天竜落としは着地で防御30%無視・30%で恐怖', () => {
  const plain = side('竜', '竜騎士', ['ジャンプ'])
  takeAction(plain, dummy(), fixed(0.9), [])     // 発動率85 → 90で不発
  assert.equal(plain.jumping, null)
  const soar = side('竜2', '竜騎士', ['ジャンプ'])
  soar.soar = { turns: 3, land: 20, proc: 10 }
  takeAction(soar, dummy(), fixed(0.9), [])      // 85+10 → 90で出る
  assert.ok(soar.jumping)
  const me = side('竜3', '竜騎士', ['天竜落とし'])
  const foe = dummy()
  takeAction(me, foe, mid, [])
  assert.deepEqual([me.jumping.defPen, me.jumping.evade], [0.3, S('天竜落とし').jump.evade])
  takeAction(me, foe, fixed(0.1), [])
  assert.ok(hasAilment(foe.ail, 'fear'))
})

// ===== ストームランサー【コンボ】=====
test('嵐の構え：1ヒットでコンボ+2／テンペストランス：コンボ1につき威力+3%（最大+60%）', () => {
  const me = side('嵐', 'ストームランサー', ['嵐の構え', '連突き'])
  takeAction(me, dummy(), mid, [])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.combo, 6)
  const full = hit('ストームランサー', 'テンペストランス', (m) => { m.combo = 20 })
  const zero = hit('ストームランサー', 'テンペストランス')
  // コンボ20＝技の+60%と、槍の型の与ダメージ（コンボ1につき+2%＝2026-10-15 に+1%から・名簿から読む）
  const pct = passiveOf('ストームランサー').passive.combo.pct
  assert.ok(near(full.dmg / zero.dmg, 1.6 * (1 + 20 * pct / 100)), `${full.dmg} ／ ${zero.dmg}`)
})

// ===== 体術師【回避と反撃】=====
test('流転掌：この戦闘で回避した回数1回につき+5%（最大+50%）・回避した回数を数える・後の先で反撃+60%', () => {
  const many = hit('体術師', '流転掌', (m) => { m.dodgeCount = 20 })
  const none = hit('体術師', '流転掌')
  assert.ok(near(many.dmg / none.dmg, 1.5), `${many.dmg} ／ ${none.dmg}`)
  const me = side('体', '体術師', [])
  const foe = side('敵', '戦士', [])
  takeAction(foe, me, fixed(0.995), [])   // 命中しない
  assert.equal(me.dodgeCount, 1)
  const me2 = side('体2', '体術師', ['後の先'])
  takeAction(me2, dummy(), mid, [])
  assert.deepEqual([me2.counterBoost.turns, me2.counterBoost.pct], [3, 60])
})

// ===== サイキッカー【動揺】=====
test('動揺：相手のスキル発動率−3%/つ（最大5つ）・相手が不発したら念動の追撃・メンタルクラッシュは動揺1つにつき+6%', () => {
  const ps = side('念', 'サイキッカー', ['マインドジャック', 'マインドジャック', 'マインドジャック'])
  const foe = side('敵', '暗殺者', ['刻み斬り'])
  for (let i = 0; i < 3; i++) takeAction(ps, foe, mid, [])
  assert.equal(foe.agit, 5, '動揺+2を3回 → 最大5')
  // 刻み斬り（発動率95）が動揺5で80に → 乱数0.85で不発 → 念動の追撃
  const log = []
  takeAction(foe, ps, fixed(0.85), log)
  assert.ok(log.some(l => l.type === 'misfire'))
  assert.ok(log.some(l => l.type === 'strike' && l.label === '念動の追撃'))
  const five = hit('サイキッカー', 'メンタルクラッシュ', (m, f) => { f.agit = 5 })
  const zero = hit('サイキッカー', 'メンタルクラッシュ')
  assert.ok(near(five.dmg / zero.dmg, 1.3), `${five.dmg} ／ ${zero.dmg}`)
})

// ===== 暗殺者【出血ととどめ】=====
test('首狩り：相手のHP50%以下で+40%／絶命：30%以下で3倍／死の刻印：出血を付ける確率+25%', () => {
  const low = hit('暗殺者', '首狩り', (m, f) => { f.hp = Math.floor(f.base.hp * 0.4) })
  const high = hit('暗殺者', '首狩り')
  assert.ok(near(low.dmg / high.dmg, 1.4), `${low.dmg} ／ ${high.dmg}`)
  const kill = hit('暗殺者', '絶命', (m, f) => { f.hp = Math.floor(f.base.hp * 0.2) })
  const k0 = hit('暗殺者', '絶命')
  assert.ok(near(kill.dmg / k0.dmg, 3), `${kill.dmg} ／ ${k0.dmg}`)
  // 刻み斬りの出血50% → 乱数0.6で入らない・死の刻印の間は75%で入る
  const no = hit('暗殺者', '刻み斬り', () => {}, fixed(0.6))
  assert.equal(hasAilment(no.foe.ail, 'bleed'), false)
  const yes = hit('暗殺者', '刻み斬り', (m) => { m.ailUps.push({ key: 'bleed', pct: 25, turns: 3 }) }, fixed(0.6))
  assert.ok(hasAilment(yes.foe.ail, 'bleed'))
})

// ===== 忍者【分身】=====
test('影斬りは当てると分身+1・微塵隠れの術は分身を全部爆発させて1体につき倍率+0.46', () => {
  const k = hit('忍者', '影斬り')
  assert.equal(k.me.stk.clone, 1)
  const three = hit('忍者', '微塵隠れの術', (m) => { m.stk.clone = 3 })
  const zero = hit('忍者', '微塵隠れの術')
  assert.equal(three.me.stk.clone, 0)
  const mj = S('微塵隠れの術')
  assert.ok(near(three.dmg / zero.dmg, (mj.mult + mj.useAll.addMult * 3) / mj.mult), `${three.dmg} ／ ${zero.dmg}`)
})

// ===== 狩人【罠】=====
test('罠：2つまで（3つ目で古い罠から消える）・相手が攻撃するとき古い罠から1つ発動（必ず当たる・状態異常と能力ダウン）', () => {
  const me = side('狩', '狩人', ['トラバサミ', 'くくり罠', 'くくり罠'])
  for (let i = 0; i < 3; i++) takeAction(me, dummy(), mid, [])
  assert.deepEqual(me.traps.map(t => t.name), ['くくり罠', 'くくり罠'])
  const me2 = side('狩2', '狩人', ['トラバサミ'])
  takeAction(me2, dummy(), mid, [])
  const foe = side('敵', '戦士', [])
  const log = []
  takeAction(foe, me2, fixed(0.1), log)
  assert.ok(log.some(l => l.type === 'trapFire'))
  assert.ok(log.some(l => l.type === 'strike' && l.label === 'トラバサミ' && l.damage > 0))
  assert.ok(hasAilment(foe.ail, 'bleed'))
  assert.equal(foe.buffs.agi, -15)
  assert.equal(me2.traps.length, 0)
})
test('ワイルドハント：相手の状態異常が2つ以上なら+1連射・4つ以上なら+2連射', () => {
  const two = hit('狩人', 'ワイルドハント', (m, f) => { inflict(f.ail, 'poison'); inflict(f.ail, 'slow') })
  const four = hit('狩人', 'ワイルドハント', (m, f) => { for (const k of ['poison', 'slow', 'burn', 'blind']) inflict(f.ail, k) })
  const zero = hit('狩人', 'ワイルドハント')
  assert.deepEqual([zero.e.of, two.e.of, four.e.of], [3, 4, 5])
})

// ===== アークアーチャー【クリティカル】=====
test('ロックオン：その間の射撃は必中／天穿の矢：必ずクリティカル', () => {
  const lock = hit('アークアーチャー', '強弓', (m) => { m.lockOn = { turns: 3, critDmg: 10 } }, fixed(0.79))
  assert.ok(lock.e.hits === 1)
  const r = hit('アークアーチャー', '天穿の矢')
  assert.equal(r.e.crit, true)
})

// ===== 魔銃士【MPを弾にこめる】=====
test('魔弾：使ったMP1につき+1%（最大+20%）／エーテルバレット：今のMPの割合で+（満タン+30%）／アルカナバレット：MP70%以上で+20%', () => {
  const full = hit('魔銃士', 'エーテルバレット')
  const half = hit('魔銃士', 'エーテルバレット', (m) => { m.mp = Math.floor(m.base.mp / 2) })
  assert.ok(near(full.dmg / half.dmg, 1.3 / (1 + 0.3 * 0.5)), `${full.dmg} ／ ${half.dmg}`)
  const hi = hit('魔銃士', 'アルカナバレット')
  const lo = hit('魔銃士', 'アルカナバレット', (m) => { m.mp = Math.floor(m.base.mp * 0.5) })
  assert.ok(near(hi.dmg / lo.dmg, 1.2), `${hi.dmg} ／ ${lo.dmg}`)
})
test('オーバーロードショット：今のMPの30%を使う・使ったMP10につき+3%（最大+30%）／魔力装填：最大MPの20%を戻す', () => {
  const r = hit('魔銃士', 'オーバーロードショット')
  assert.equal(r.me.mp, 2000 - 600)
  const me = side('銃', '魔銃士', ['魔力装填'])
  me.mp = 100
  takeAction(me, dummy(), mid, [])
  assert.equal(me.mp, 100 - 12 + 400)
})

// ===== デストロイヤー【装填と砲撃】=====
test('カーペットボム：撃つ前の装填1つにつき+1連撃（最大+3）・装填を1つ使う／弾帯換装：装填+2', () => {
  const r = hit('デストロイヤー', 'カーペットボム', (m) => { m.stk.load = 2 })
  assert.equal(r.e.of, 5)
  assert.equal(r.me.stk.load, 1)
  const me = side('砲', 'デストロイヤー', ['弾帯換装'])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.stk.load, 2)
})

// ===== 元素使い【属性の連鎖】=====
test('詠唱：共鳴+1・MP+5／プリズムバースト：共鳴を全部使って1つにつき+10%（共鳴4なら火傷・鈍足・麻痺を25%ずつ）', () => {
  const me = side('元', '元素使い', ['詠唱'])
  me.mp = 100
  takeAction(me, dummy(), mid, [])
  assert.equal(me.reso, 1)
  assert.equal(me.mp, 100 - 6 + 5)
  const four = hit('元素使い', 'プリズムバースト', (m) => { m.reso = 4 }, fixed(0.1))
  const zero = hit('元素使い', 'プリズムバースト', () => {}, fixed(0.1))
  // 技の+40%と、共鳴の与ダメージ+20%（撃ったあとで0になる）
  assert.ok(near(four.dmg / zero.dmg, 1.4 * 1.2), `${four.dmg} ／ ${zero.dmg}`)
  assert.equal(four.me.reso, 0)
  for (const k of ['burn', 'slow', 'paralyze']) assert.ok(hasAilment(four.foe.ail, k), k)
})

// ===== クロノマンサー【追加行動】=====
test('リピート：直前に撃った技をもう一度（MPはその技の半分）・切り札のあとは通常攻撃／パラドックス：追加行動1回につき+6%', () => {
  const me = side('時', 'クロノマンサー', ['クロノバレット', 'リピート'])
  const log = []
  takeAction(me, dummy(), mid, log)
  const mp = me.mp
  takeAction(me, dummy(), mid, log)
  assert.ok(log.some(l => l.type === 'repeat' && l.target === 'クロノバレット'))
  assert.equal(log.filter(l => l.type === 'skill' && l.skill === 'クロノバレット').length, 2)
  assert.equal(mp - me.mp, 3)
  const me2 = side('時2', 'クロノマンサー', ['クロノブレイク', 'リピート'])
  const l2 = []
  takeAction(me2, dummy(), mid, l2)
  takeAction(me2, dummy(), mid, l2)
  assert.ok(l2.some(l => l.type === 'repeatFail'))
  assert.ok(l2.some(l => l.type === 'normal'))
  const ten = hit('クロノマンサー', 'パラドックス', (m) => { m.extraActs = 10 })
  const zero = hit('クロノマンサー', 'パラドックス')
  assert.ok(near(ten.dmg / zero.dmg, 1.6), `${ten.dmg} ／ ${zero.dmg}`)
})

// ===== 死霊使い【死霊の数】=====
test('レイズデッド：死霊2体・この戦闘の間は最大4体／ソウルハーヴェスト：死霊1体につき倍率+（死霊は消えない）', () => {
  const me = side('死', '死霊使い', ['レイズデッド', '骸骨召喚', '骸骨召喚', '骸骨召喚'])
  for (let i = 0; i < 4; i++) takeAction(me, dummy(), mid, [])
  assert.equal(me.stk.undead, 4)
  const three = hit('死霊使い', 'ソウルハーヴェスト', (m) => { m.stk.undead = 3; m.summonMult.undead = 0.472 })
  const zero = hit('死霊使い', 'ソウルハーヴェスト')
  assert.equal(three.me.stk.undead, 3)
  const sh = S('ソウルハーヴェスト')
  assert.ok(near(three.dmg / zero.dmg, (sh.mult + sh.perStackAdd.addMult * 3) / sh.mult), `${three.dmg} ／ ${zero.dmg}`)
})

// ===== 式神使い【結界】=====
test('結界は1つだけ（張り直すと上書き）・封縛結界：相手のAGI−20%・状態異常が1ターン長い・急急如律令：式神も攻撃・結界で+20%', () => {
  const me = side('陰', '式神使い', ['陰陽結界', '封縛結界'])
  const foe = dummy()
  takeAction(me, foe, mid, [])
  assert.equal(me.guardsT.filter(g => g.barrier).length, 1)
  takeAction(me, foe, mid, [])
  assert.equal(me.guardsT.filter(g => g.barrier).length, 0, '陰陽結界は封縛結界で上書き')
  assert.equal(me.bind.turns, 3)
  assert.ok(foe.timedBuffs.some(t => t.table.agi === -20 && t.turns === 3))
  // 封の符の封印（40%）が1ターン長く続く
  const plain = hit('式神使い', '封の符', () => {}, fixed(0.1))
  const bound = hit('式神使い', '封の符', (m) => { m.bind = { turns: 3, ailExtend: 1 } }, fixed(0.1))
  assert.equal(bound.foe.ail.seal.turns, plain.foe.ail.seal.turns + 1)
  const kk = hit('式神使い', '急急如律令', (m) => { m.stk.shiki = 1; m.summonMult.shiki = 0.766; m.bind = { turns: 3 } })
  assert.ok(kk.log.some(l => l.type === 'strike' && /式神/.test(l.label)))
  const k0 = hit('式神使い', '急急如律令')
  // 結界の+20%と、陰陽の理（結界がある間+％＝2026-10-16 に+15%→+8%・名簿から読む）
  const yin = passiveOf('式神使い').passive.whileSummonOrGuard
  assert.ok(near(kk.dmg / k0.dmg, 1.2 * (1 + yin / 100)), `${kk.dmg} ／ ${k0.dmg}`)
})

// ===== 聖職者【バリア】=====
test('バリア：満タンからあふれた回復はバリアに（上限は最大HPの25%）・攻撃をHPより先に受ける／光の帳：12%のバリアとINT+15%／ゴスペル：回復1.5倍・上限35%', () => {
  const me = side('聖', '聖職者', ['ハイヒール'])
  const log = []
  takeAction(me, dummy(), mid, log)
  const amt = log.find(l => l.type === 'heal').heal
  assert.equal(me.shield, Math.min(2500, amt))
  const hp = me.hp
  const l2 = []
  takeAction(side('敵', '戦士', []), me, mid, l2)
  assert.ok(l2.some(l => l.type === 'shieldHit'))
  assert.ok(me.hp === hp || me.shield === 0)
  const me2 = side('聖2', '聖職者', ['光の帳'])
  const int0 = liveStats(me2).int_stat
  takeAction(me2, dummy(), mid, [])
  assert.equal(me2.shield, 1200)
  assert.equal(liveStats(me2).int_stat, Math.round(int0 * 1.15))
  const me3 = side('聖3', '聖職者', ['ゴスペル', 'ハイヒール'])
  const l3 = []
  takeAction(me3, dummy(), mid, l3)
  takeAction(me3, dummy(), mid, l3)
  const healed = l3.find(l => l.type === 'heal').heal
  assert.equal(healed, Math.floor(amt * 1.5) )
  assert.equal(me3.shield, Math.min(3500, healed))
})

// ===== 異端審問官【罪】=====
test('罪：相手が強化・回復を使うたび／相手に封印をかけるたびに+1（最大5）・異端の烙印で+2・断罪で全部使って1つにつき+6%', () => {
  const inq = side('審', '異端審問官', ['封魔の印'])
  const foe = side('敵', '剣士', ['剣の構え'])
  takeAction(foe, inq, mid, [])
  assert.equal(inq.sin, 1, '相手の強化で+1')
  takeAction(inq, foe, fixed(0.1), [])
  assert.equal(inq.sin, 2, '封印をかけて+1')
  const br = side('審2', '異端審問官', ['異端の烙印'])
  takeAction(br, dummy(), mid, [])
  assert.equal(br.sin, 2)
  const five = hit('異端審問官', '断罪', (m) => { m.sin = 5 })
  const zero = hit('異端審問官', '断罪')
  // 断罪の+30%と、罪の与ダメージ+20%（撃ったあとで0になる）
  assert.ok(near(five.dmg / zero.dmg, 1.3 * 1.2), `${five.dmg} ／ ${zero.dmg}`)
  assert.equal(five.me.sin, 0)
})

// ===== アルケミスト【化学反応】=====
test('爆炎毒：撃つ前に毒と火傷を付ける（両方付けばこの一撃から化学反応+20%）／賢者の石：上乗せが+30%に', () => {
  const pre = hit('アルケミスト', '爆炎毒', () => {}, fixed(0.1))
  const lateSkill = { ...S('爆炎毒'), preAil: false }
  const me = side('錬', 'アルケミスト', [lateSkill])
  const log = []
  takeAction(me, dummy(), fixed(0.1), log)
  const late = log.find(l => l.type === 'skill').damage
  assert.ok(near(pre.dmg / late, 1.2), `${pre.dmg} ／ ${late}`)
  const philo = hit('アルケミスト', '爆炎毒', (m) => { m.philo = { turns: 4, ailUp: 20, react: 10 } }, fixed(0.1))
  assert.ok(near(philo.dmg / late, 1.3), `${philo.dmg} ／ ${late}`)
})

// ===== 霊薬師【薬効】=====
test('浸透薬：薬効1つにつき防御3%無視／エリクサー：最大HPの一部を回復（2026-10-16 に30%→15%・10-18 ユーザーがシートで100%＝名簿から読む）・状態異常を全部治す・薬効+3', () => {
  const five = hit('霊薬師', '浸透薬', (m) => { m.stk.potion = 5 }, mid, dummy({ int_stat: 900, vit: 900 }))
  const zero = hit('霊薬師', '浸透薬', () => {}, mid, dummy({ int_stat: 900, vit: 900 }))
  assert.ok(five.dmg / zero.dmg > 1.25 + 0.01, '薬効5の与ダメージ+25%より伸びる（防御無視のぶん）')
  const me = side('霊', '霊薬師', ['エリクサー'])
  me.hp = 1000
  // 回復してから治す（初期職の万能薬と同じ順）＝回復量を下げる火傷・回復阻害は入れずに見る
  inflict(me.ail, 'poison'); inflict(me.ail, 'slow')
  takeAction(me, dummy(), mid, [])
  assert.equal(me.hp, Math.min(me.base.hp, 1000 + Math.floor(me.base.hp * SKILL_BY_NAME['エリクサー'].healMax / 100)))
  assert.equal(hasAilment(me.ail, 'poison') || hasAilment(me.ail, 'slow'), false)
  assert.equal(me.stk.potion, 3)
})

// ===== 体術師【地上と空中】（2026-10-17）=====
test('【確定】2026-10-17 ユーザー「スキルによって地上状態と空中状態が切り替わるようにして、同じスキルでも状態によって効果や威力代わるようにして、補助skillは統一でいい」：体術師', () => {
  const inAir = (me) => { me.air = true }
  // 戦闘は地上から。跳び上がる技（半月蹴り・旋風脚・飛天三角蹴り）を地上で撃つと空中へ
  for (const n of ['半月蹴り', '旋風脚', '飛天三角蹴り']) {
    const r = hit('体術師', n)
    assert.equal(r.me.air, true, `${n}：地上で撃つと空中へ`)
    assert.ok(r.log.some(l => l.type === 'air'), n)
  }
  // 空中で撃つと：半月蹴り・巴投げ・破衝掌は威力+して着地
  for (const n of ['半月蹴り', '巴投げ', '破衝掌']) {
    const g = hit('体術師', n), a = hit('体術師', n, inAir)
    assert.equal(a.me.air, false, `${n}：空中で撃つと着地`)
    assert.ok(a.log.some(l => l.type === 'land'), n)
    assert.ok(a.dmg > g.dmg * (1 + S(n).inAir.mult / 100) * 0.97, `${n}：空中なら威力+${S(n).inAir.mult}%（${a.dmg}／${g.dmg}）`)
  }
  // 旋風脚：空中なら威力+して空中に留まる
  {
    const g = hit('体術師', '旋風脚'), a = hit('体術師', '旋風脚', inAir)
    assert.equal(a.me.air, true, '旋風脚：空中なら留まる')
    assert.ok(near(a.dmg / g.dmg, 1 + S('旋風脚').inAir.mult / 100, 0.03), `${a.dmg}／${g.dmg}`)
  }
  // 五連殺：地上は5連撃でそのまま地上／空中は+1連撃して留まる
  {
    const g = hit('体術師', '五連殺'), a = hit('体術師', '五連殺', inAir)
    assert.deepEqual([g.e.hits, g.me.air], [5, false])
    assert.deepEqual([a.e.hits, a.me.air], [6, true])
  }
  // 破衝掌：2026-10-18 ユーザーがシートで「空中の防御無視 計50%」をアセンションのマスへ移した（元は空中でも30%）／
  //   飛天三角蹴り：空中ならクリティカル率+して留まる
  assert.equal(S('破衝掌').defPen, 0.3)
  assert.equal(S('破衝掌').inAir.defPen, undefined)
  assert.ok(Math.abs(ascUp(S('破衝掌')).inAir.defPen - 0.2) < 1e-9, 'マスで空中の防御無視 計30%→計50%')
  assert.ok(S('飛天三角蹴り').inAir.crit > 0)
  assert.equal(hit('体術師', '飛天三角蹴り', inAir).me.air, true)
  // 補助の技は地上でも空中でも同じ（ユーザー「補助skillは統一でいい」）。流転掌も同じ（空中で撃つと着地）
  for (const n of ['受け流し', '流水の構え', '後の先', '流転掌']) assert.ok(!S(n).onGround && !S(n).inAir, n)
  assert.equal(hit('体術師', '流転掌', inAir).me.air, false)
  // 撃ち始めの状態で決まる：地上→飛天三角蹴り（空中へ）→破衝掌（空中なので威力+して着地）→旋風脚（空中へ）→半月蹴り（着地）
  const me = side('体', '体術師', ['飛天三角蹴り', '破衝掌', '旋風脚', '半月蹴り'])
  const path = []
  for (let i = 0; i < 4; i++) { takeAction(me, dummy(), mid, []); path.push(me.air ? '空' : '地') }
  assert.deepEqual(path, ['空', '地', '空', '地'])
})

test('【確定】2026-10-17 体術師の心眼：地上＝回避したら物理×0.6で反撃／空中＝反撃しないが回避+10%（直接の回避は15%まで）', async () => {
  const { AIR_EVA } = await import('../../v2/lib/battle.js')
  assert.deepEqual(passiveOf('体術師').passive, { counterOnDodge: 0.6, counterAirMult: 0 })
  assert.equal(AIR_EVA, 10)
  // 相手の攻撃が必ず外れる乱数で：地上なら反撃が出る・空中なら出ない
  const counters = (air) => {
    const me = side('体', '体術師', [])
    me.air = air
    const foe = side('敵', '戦士', [], { stats: { dex: 1 } })
    const log = []
    takeAction(foe, me, fixed(0.999), log)
    return log.filter(l => l.label === '反撃' || l.type === 'counter' || (l.type === 'strike' && l.label === '反撃')).length
  }
  assert.ok(counters(false) > 0, '地上なら反撃')
  assert.equal(counters(true), 0, '空中では反撃しない')
})
