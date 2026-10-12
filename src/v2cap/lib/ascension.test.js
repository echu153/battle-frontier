// v2cap：アセンション（スキルツリー・2026-10-13 ユーザー指示）の回帰テスト（node --test）
// ★木の形・効果・APの数え方がユーザーの決めたとおりか。サーバー（SQL §12）との突き合わせは v2capsql.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower } from '../../v2/lib/stats.js'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { SKILLS, SKILL_BY_NAME, skillsOf, isPassive } from './skills.js'
import { CLASSES, JOB_BONUS, stageOf, jobMaxOf, attackKindOf, jobUpNote, jobGainText } from './jobs.js'
import { statBreakdown, toFighter } from './loadout.js'
import {
  ASC_ROADS, ASC_SHAPE, ASC_UP_DEFAULT, ASC_SKILL_UP, ASC_COUNT_UP, ASC_CLASSES, ASC_RESET_GOLD_PER_LV,
  treeOf, treeSizeOf, roadStatsOf, ascKindOf, ascUpOf, ascendSkill, splitUp, ascStateOf, apTotalOf, apSpentOf, apLeftOf,
  ascEffectsOf, ascPctGain, ascendError, ascResetGoldOf, nodeLines, ascSkillDetail, roadNameOf,
} from './ascension.js'

const prof = (cls, jlv, asc = {}, over = {}) => ({
  username: 'x', class: cls, lv: 30, hp: 400, mp: 60, str: 50, dex: 30, agi: 30, int_stat: 30, vit: 30, luk: 10,
  jobs: { [cls]: { lv: jlv, exp: 0 } }, skill_sets: {}, equipped: {}, ascension: asc, gold: 0, ...over,
})

test('【確定】どの職業にも4本の道の木がある。初期職は1本14マス（56マス）・一次職は1本24マス（96マス）＝全部は埋まらず半分くらい', () => {
  assert.equal(ASC_CLASSES.length, CLASSES.length, '31職すべて')
  for (const cls of ASC_CLASSES) {
    const t = treeOf(cls)
    const shape = ASC_SHAPE[stageOf(cls)]
    assert.equal(t.roads.length, ASC_ROADS, `${cls} は4本`)
    for (const r of t.roads) assert.equal(r.nodes.length, shape.len, `${cls}の${r.name}`)
    assert.equal(treeSizeOf(cls), ASC_ROADS * shape.len)
    // APの最大（CLASS LVの上限−1）は全部のマスの半分くらい（45〜55%）
    const ap = apTotalOf(cls, jobMaxOf(cls))
    assert.ok(ap / treeSizeOf(cls) > 0.45 && ap / treeSizeOf(cls) < 0.55, `${cls}：${ap}/${treeSizeOf(cls)}`)
  }
  assert.equal(apTotalOf('剣士', 30), 29)
  assert.equal(apTotalOf('狂戦士', 50), 49)
  assert.equal(treeSizeOf('剣士'), 56)
  assert.equal(treeSizeOf('狂戦士'), 96)
})

test('【確定】道のテーマはクラスのステの配分の多い順に4つ（同じ数ならステの並びの先）', () => {
  for (const cls of ASC_CLASSES) {
    const stats = roadStatsOf(cls)
    assert.equal(new Set(stats).size, 4, `${cls} の道は4つとも違うステ`)
    const w = JOB_BONUS[cls]
    const rest = Object.keys(w).filter(k => !stats.includes(k))
    for (const k of rest) assert.ok(w[k] <= Math.min(...stats.map(s => w[s])), `${cls}：${k} は選ばれた4つ以下`)
    assert.deepEqual(treeOf(cls).roads.map(r => r.stat), stats)
  }
  assert.deepEqual(roadStatsOf('剣士'), ['str', 'dex', 'agi', 'vit'])
  assert.deepEqual(roadStatsOf('魔法使い'), ['int_stat', 'mp', 'agi', 'hp'])
  assert.equal(roadNameOf('str'), '腕力の道')
  assert.equal(roadNameOf('hp'), '生命の道')
})

test('【確定】小マスは先へ行くほど強い（初期職 +2→+3→+4・一次職 +3→+4→+5、HPは×8・MPは×3）。道の終わりは道のステ+5%', () => {
  for (const cls of ASC_CLASSES) {
    const shape = ASC_SHAPE[stageOf(cls)]
    for (const r of treeOf(cls).roads) {
      const pts = r.nodes.filter(n => n.type === 'stat').map(n => n.pts)
      assert.deepEqual([...new Set(pts)], shape.tiers, `${cls}の${r.name}：${pts.join(',')}`)
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i] >= pts[i - 1], '前より小さくならない')
      for (const n of r.nodes.filter(x => x.type === 'stat')) assert.equal(n.amount, n.pts * STAT_DEFS[r.stat].unit)
      const last = r.nodes[r.nodes.length - 1]
      assert.deepEqual(last, { type: 'big', stat: r.stat, pct: 5 }, '道の終わりは大マス（+5%）')
      assert.equal(r.nodes.filter(n => n.type === 'big').length, 1)
    }
  }
  assert.deepEqual(ASC_SHAPE.shoki.tiers, [2, 3, 4])
  assert.deepEqual(ASC_SHAPE.ichiji.tiers, [3, 4, 5])
})

test('【確定】スキルマスは技1つにつき1マス（その職業の技だけ・パッシブには無い）', () => {
  for (const cls of ASC_CLASSES) {
    const onTree = treeOf(cls).roads.flatMap(r => r.nodes.filter(n => n.type === 'skill').map(n => n.skill))
    const own = skillsOf(cls).map(s => s.name)
    assert.deepEqual([...onTree].sort(), [...own].sort(), `${cls}：${onTree.join(',')}`)
    for (const n of onTree) assert.ok(!isPassive(SKILL_BY_NAME[n]))
  }
})

test('【確定】剣士の木はユーザーに見せた表のとおり（2026-10-13）', () => {
  const row = (r) => treeOf('剣士').roads[r].nodes.map(n => (n.type === 'skill' ? n.skill : nodeLines(n)[0]))
  assert.deepEqual(row(0), ['STR+2', 'STR+2', 'STR+2', 'STR+2', '袈裟斬り', 'STR+3', 'STR+3', 'STR+3', '燕返し', 'STR+4', 'STR+4', 'STR+4', 'STR+4', 'STR+5%'])
  assert.deepEqual(row(1), ['DEX+2', 'DEX+2', 'DEX+2', 'DEX+2', 'DEX+3', 'DEX+3', '兜割り', 'DEX+3', 'DEX+3', 'DEX+4', 'DEX+4', 'DEX+4', 'DEX+4', 'DEX+5%'])
  assert.deepEqual(row(2), ['AGI+2', 'AGI+2', 'AGI+2', 'AGI+2', 'AGI+3', 'AGI+3', '一閃', 'AGI+3', 'AGI+3', 'AGI+4', 'AGI+4', 'AGI+4', 'AGI+4', 'AGI+5%'])
  assert.deepEqual(row(3), ['VIT+2', 'VIT+2', 'VIT+2', 'VIT+2', 'VIT+3', 'VIT+3', '剣の構え', 'VIT+3', 'VIT+3', 'VIT+4', 'VIT+4', 'VIT+4', 'VIT+4', 'VIT+5%'])
  // 魔法使いのHPの道は HP+16（＝STR+2と同じ戦闘力）から
  assert.equal(nodeLines(treeOf('魔法使い').roads[3].nodes[0])[0], 'HP+16')
  assert.equal(nodeLines(treeOf('魔法使い').roads[1].nodes[0])[0], 'MP+6')
})

test('【確定】スキルマスの上がり幅：攻撃＝威力+20%・回復＝回復量+10%・バフ＝上がり幅を合計+10・%の無いバフ＝回数・ターン+1', () => {
  assert.deepEqual(ASC_UP_DEFAULT, { attack: 20, heal: 10, buff: 10, count: 1 })
  assert.equal(ascendSkill(SKILL_BY_NAME['袈裟斬り']).ascDmg, 20)
  assert.equal(ascendSkill(SKILL_BY_NAME['ヒール']).ascHeal, 10)
  // バフ：表の割合で+10を分ける（端数は余りの大きい順）
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['剣の構え']).buff.self, { str: 14, dex: 12, agi: 11 })
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['精神統一']).buff.self, { int_stat: 35 })
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['衰弱の呪詛']).buff.enemy, { str: -20, int_stat: -20 }, '相手を下げる技は下げ幅が+10')
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['仙丹']).buff.self, { str: 17, dex: 17, agi: 17, int_stat: 17, vit: 16, luk: 16 })
  // ステの表が無いバフは、その%に+10
  assert.equal(ascendSkill(SKILL_BY_NAME['受け止め']).guard.cut, 30)
  assert.equal(ascendSkill(SKILL_BY_NAME['ブラッディロア']).lifeSteal.pct, 20)
  assert.equal(ascendSkill(SKILL_BY_NAME['骸骨召喚']).summon.mult, 0.35, '魔法×0.25→×0.35')
  assert.equal(ascendSkill(SKILL_BY_NAME['リザレクション']).revive.pct, 60)
  assert.equal(ascendSkill(SKILL_BY_NAME['詠唱']).nextBoost.per, 25)
  // 回数・ターン
  assert.equal(ascendSkill(SKILL_BY_NAME['クイック']).extraTurn.max, 3)
  assert.equal(ascendSkill(SKILL_BY_NAME['分身の術']).gain.n, 2)
  assert.equal(ascendSkill(SKILL_BY_NAME['装填']).gain.n, 2)
  assert.equal(ascendSkill(SKILL_BY_NAME['鬼神降ろし']).summonHits.turns, 5)
  assert.equal(ascendSkill(SKILL_BY_NAME['狂信']).debuffImmune.turns, 5)
  // 元の技は書き換えない
  assert.deepEqual(SKILL_BY_NAME['剣の構え'].buff.self, { str: 10, dex: 9, agi: 8 })
  assert.equal(SKILL_BY_NAME['クイック'].extraTurn.max, 2)
  // 文
  assert.equal(ascSkillDetail('剣の構え'), 'STR+10%→+14%・DEX+9%→+12%・AGI+8%→+11%')
  assert.equal(ascSkillDetail('受け止め'), '受けるダメージ −20%→−30%')
  assert.equal(ascSkillDetail('クイック'), '戦闘中に使える回数 2回→3回')
})

test('★スキルマスのある技は、どれも何かが変わる（効かない技を作らない）', () => {
  for (const cls of ASC_CLASSES) {
    for (const n of treeOf(cls).roads.flatMap(r => r.nodes).filter(x => x.type === 'skill')) {
      const s = SKILL_BY_NAME[n.skill]
      const a = ascendSkill(s, n.up)
      assert.notDeepEqual(a, s, `${cls}の${n.skill}（${ascKindOf(s)}）が変わる`)
      assert.ok(ascSkillDetail(n.skill), `${n.skill} の説明がある`)
    }
  }
  // %の無いバフは、名前で決めた5つだけ（新しい技が来たら、ここで気づいて決める）
  assert.deepEqual(Object.keys(ASC_COUNT_UP).sort(), ['クイック', '分身の術', '狂信', '装填', '鬼神降ろし'].sort())
})

test('技ごとの上がり幅は ASC_SKILL_UP で差し替えられる（ユーザーがあとで決める）', () => {
  assert.equal(ascUpOf('袈裟斬り'), 20)
  ASC_SKILL_UP['袈裟斬り'] = 25
  try {
    assert.equal(ascUpOf('袈裟斬り'), 25)
    assert.equal(ascendSkill(SKILL_BY_NAME['袈裟斬り']).ascDmg, 25)
  } finally {
    delete ASC_SKILL_UP['袈裟斬り']
  }
  assert.equal(ascUpOf('バーサク'), 0, 'パッシブは0')
})

test('splitUp：合計を値の大きさで分ける（整数・符号は元のまま）', () => {
  assert.deepEqual(splitUp({ a: 10, b: 9, c: 8 }, 10), { a: 4, b: 3, c: 3 })
  assert.deepEqual(splitUp({ a: -15, b: -15 }, 10), { a: -5, b: -5 })
  assert.deepEqual(splitUp({ a: 25 }, 10), { a: 10 })
  assert.deepEqual(splitUp({}, 10), {})
  for (const t of [{ a: 1, b: 2, c: 3 }, { a: 7, b: 7, c: 7 }, { a: 20, b: 15 }]) {
    assert.equal(Object.values(splitUp(t, 10)).reduce((x, y) => x + y, 0), 10)
  }
})

test('【確定】AP＝CLASS LVが上がった回数×1。開いたマスの数だけ使う（どのマスも1AP）', () => {
  const p = prof('剣士', 12, { 剣士: [5, 3, 0, 0] })
  assert.deepEqual(ascStateOf(p), [5, 3, 0, 0])
  assert.equal(apTotalOf('剣士', 12), 11)
  assert.equal(apSpentOf(ascStateOf(p)), 8)
  assert.equal(apLeftOf(p), 3)
  // 形が違う・はみ出しは0〜マスの数に収める
  assert.deepEqual(ascStateOf(prof('剣士', 30, { 剣士: [99, -3, 'x'] })), [14, 0, 0, 0])
  assert.deepEqual(ascStateOf(prof('剣士', 30, { 剣士: { a: 1 } })), [0, 0, 0, 0])
  // 上限より上は増えない
  assert.equal(apTotalOf('剣士', 99), 29)
})

test('開けるか（サーバーの v2cap_ascend と同じ順・同じ文言）', () => {
  const p = prof('剣士', 6, { 剣士: [2, 0, 0, 0] })   // AP 5・使った2・残り3
  assert.equal(ascendError(p, '剣士', 0, 5), null, '3マス先までまとめて開ける')
  assert.equal(ascendError(p, '剣士', 0, 6), 'APが足りません')
  assert.equal(ascendError(p, '剣士', 0, 2), 'もう開いています')
  assert.equal(ascendError(p, '剣士', 0, 15), 'その道はそこまでありません')
  assert.equal(ascendError(p, '剣士', 4, 1), 'その道はありません')
  assert.equal(ascendError(p, 'なし', 0, 1), 'その職業にはアセンションがありません')
  assert.equal(ascResetGoldOf(30), 30 * ASC_RESET_GOLD_PER_LV)
  assert.equal(ASC_RESET_GOLD_PER_LV, 100)
})

test('【確定】効くのはいまの職業の盤面だけ。小マスのステ・大マスの+%が内訳と合計に入る', () => {
  const none = statBreakdown(prof('剣士', 30), [])
  // 腕力の道を全部（STR 2×4+3×3+4×4＝33・STR+5%）・器用の道を3マス（DEX+6）
  const p = prof('剣士', 30, { 剣士: [14, 3, 0, 0], 戦士: [14, 14, 0, 0] })
  const bd = statBreakdown(p, [])
  assert.equal(bd.asc.str - Math.round((none.total.str + 33) * 5 / 100), 33)
  assert.equal(bd.asc.dex, 6)
  assert.equal(bd.total.str, none.total.str + bd.asc.str)
  assert.equal(bd.total.dex, none.total.dex + 6)
  for (const k of ['hp', 'mp', 'agi', 'int_stat', 'vit', 'luk']) assert.equal(bd.total[k], none.total[k], `${k} は変わらない`)
  assert.ok(bd.power > none.power)
  // 戦士の盤面はいまの職業ではないので効かない
  assert.deepEqual(ascEffectsOf(p).ups, { 袈裟斬り: 20, 燕返し: 20 })
  assert.deepEqual(ascEffectsOf(p, '戦士').pct, { str: 5, vit: 5 })
  // 開いていなければ前と同じ（今いるキャラは何も変わらない）
  const p0 = prof('剣士', 30)
  delete p0.ascension
  assert.deepEqual(statBreakdown(p0, []).total, none.total)
  assert.equal(calcPower(statBreakdown(p0, []).total), none.power)
})

test('大マスの+%は四捨五入（サーバーの v2cap_asc_mp と同じ）', () => {
  assert.deepEqual(ascPctGain({ mp: 250 }, { mp: 5 }).mp, 13)
  assert.deepEqual(ascPctGain({ mp: 249 }, { mp: 5 }).mp, 12)
  assert.equal(ascPctGain({ str: 100 }, {}).str, 0)
})

test('【確定】戦闘：攻撃の技は威力+20%（ダメージ全体）・回復の技は回復量+10%・バフは上がり幅+10', () => {
  const st = { hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30 }
  const side = (cls, skill, ascend) => createSide({ name: '自分', cls, kind: attackKindOf(cls), stats: st, noClassBonus: true,
    slots: [{ skill: ascend ? ascendSkill(SKILL_BY_NAME[skill]) : SKILL_BY_NAME[skill], uses: 9 }], passives: [] })
  const foe = () => createSide({ name: '的', cls: null, kind: 'phys', stats: { ...st, hp: 10000000 }, slots: [], passives: [], noClassBonus: true })
  const mid = () => 0.5
  const act = (me) => { const log = []; takeAction(me, foe(), mid, log); return log }
  // 攻撃
  const dmg = (asc) => act(side('剣士', '袈裟斬り', asc)).find(l => l.type === 'skill').damage
  assert.ok(Math.abs(dmg(true) / dmg(false) - 1.2) < 0.01, `${dmg(true)} / ${dmg(false)}`)
  // 回復
  const healed = (asc) => {
    const me = side('僧侶', 'ヒール', asc)
    me.hp = 100
    return act(me).find(l => l.type === 'heal').heal
  }
  assert.ok(Math.abs(healed(true) / healed(false) - 1.1) < 0.01, `${healed(true)} / ${healed(false)}`)
  // バフ
  const me = side('剣士', '剣の構え', true)
  act(me)
  assert.deepEqual({ str: me.buffs.str, dex: me.buffs.dex, agi: me.buffs.agi }, { str: 14, dex: 12, agi: 11 })
  // 跳躍（着地で斬る技）も威力+20%
  const j = side('竜騎士', 'ジャンプ', true)
  act(j)
  assert.ok(Math.abs(j.jumping.mult - SKILL_BY_NAME['ジャンプ'].jump.mult * 1.2) < 1e-9)
})

test('toFighter：いまの職業のスキルマスだけを技に乗せる（下位職の技・ほかの職業の盤面は乗らない）', () => {
  const p = prof('狂戦士', 10, { 狂戦士: [8, 0, 0, 0], 戦士: [14, 14, 14, 14] }, {
    skill_sets: { 狂戦士: [{ name: 'マッドラッシュ', uses: 1 }, { name: '体当たり', uses: 1 }] },
    jobs: { 狂戦士: { lv: 10, exp: 0 }, 戦士: { lv: 30, exp: 0 } },
    learned: ['マッドラッシュ', '体当たり'],
  })
  const f = toFighter(p, [])
  const by = Object.fromEntries(f.slots.map(s => [s.skill.name, s.skill]))
  assert.equal(by['マッドラッシュ'].ascDmg, 20, '腕力の道の8マス目＝マッドラッシュ')
  assert.equal(by['体当たり']?.ascDmg, undefined, '下位職（戦士）の技には乗らない')
})

test('【確定】CLASS LEVEL UP の2行目の最後に AP+◯（2026-10-13 ユーザーが選んだ）', () => {
  assert.equal(jobUpNote('盗賊', { jlv: 2, job_ups: 1 }), '（HP+14・MP+5・STR+2・DEX+1・AGI+2・LUK+1・AP+1）')
  assert.equal(jobUpNote('盗賊', { jlv: 8, job_ups: 3 }), `（${jobGainText('盗賊', 5, 8)}・AP+3）`)
  assert.equal(jobUpNote('盗賊', { jlv: 3, job_ups: 0 }), '')
})

test('スキルの名簿のどの攻撃・回復・バフにも種類が決まる（パッシブは null）', () => {
  for (const s of SKILLS.filter(x => CLASSES.some(c => c.id === x.cls))) {
    const k = ascKindOf(s)
    if (isPassive(s)) assert.equal(k, null)
    else assert.ok(['attack', 'heal', 'buff', 'count'].includes(k), `${s.name}：${s.kind}`)
  }
  assert.ok(STAT_KEYS.length === 8)
})
