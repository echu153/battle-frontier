// v2cap：アセンション（スキルツリー・2026-10-13 ユーザー指示）の回帰テスト（node --test）
// ★盤面の形・中身・効果・APの数え方がユーザーの決めたとおりか。サーバー（SQL §12）との突き合わせは v2capsql.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower } from '../../v2/lib/stats.js'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { SKILLS, SKILL_BY_NAME, skillsOf, isPassive } from './skills.js'
import { CLASSES, JOB_BONUS, stageOf, jobMaxOf, attackKindOf, jobUpNote, jobGainText } from './jobs.js'
import { statBreakdown, toFighter } from './loadout.js'
import { ASC_LAYOUT } from './ascLayout.js'
import {
  ASC_DIRS, ASC_SHAPE, ASC_UP_DEFAULT, ASC_SKILL_UP, ASC_COUNT_UP, ASC_CLASSES, ASC_RESET_GOLD_PER_LV,
  treeOf, treeSizeOf, areaStatsOf, statCountsOf, ascKindOf, ascUpOf, ascendSkill, splitUp, ascStateOf, apTotalOf, apSpentOf, apLeftOf,
  ascEffectsOf, ascPctGain, ascendError, ascResetGoldOf, nodeLines, ascSkillDetail, routeTo, mpNodesOf,
} from './ascension.js'

const prof = (cls, jlv, asc = {}, over = {}) => ({
  username: 'x', class: cls, lv: 30, hp: 400, mp: 60, str: 50, dex: 30, agi: 30, int_stat: 30, vit: 30, luk: 10,
  jobs: { [cls]: { lv: jlv, exp: 0 } }, skill_sets: {}, equipped: {}, ascension: asc, gold: 0, ...over,
})
// 90度回す（盤の形は1方向ぶんを回して4つ置いてある）
const rot = ([x, y]) => [0 - y, x]   // 0 - y（-y だと 0 が -0 になって比べられない）

test('【確定】盤面の形（段階ごとに1つ）：起点から4方向に枝分かれした木・つながりは両向き・全部つながっている・4方向とも同じ形', () => {
  for (const [stage, L] of Object.entries(ASC_LAYOUT)) {
    const byId = new Map(L.nodes.map(n => [n.id, n]))
    assert.equal(L.nodes.length, 1 + ASC_DIRS * L.perQuad, stage)
    assert.deepEqual(byId.get(0), { ...byId.get(0), q: -1, x: 0, y: 0, role: 'start' })
    for (const n of L.nodes) {
      for (const l of n.links) assert.ok(byId.get(l).links.includes(n.id), `${stage} ${n.id}-${l} は両向き`)
      for (const l of n.links) assert.equal(Math.abs(byId.get(l).x - n.x) + Math.abs(byId.get(l).y - n.y), 1, '隣り合うマスだけつなぐ')
    }
    // 起点から全部たどれる・d はつながりの数
    const seen = new Map([[0, 0]])
    const queue = [0]
    while (queue.length) { const id = queue.shift(); for (const l of byId.get(id).links) if (!seen.has(l)) { seen.set(l, seen.get(id) + 1); queue.push(l) } }
    assert.equal(seen.size, L.nodes.length, `${stage} は全部つながっている`)
    for (const n of L.nodes) assert.equal(n.d, seen.get(n.id))
    // 4方向とも同じ形（方向 q の i 番目を90度回すと方向 q+1 の i 番目）・役も同じ
    for (const n of L.nodes.filter(m => m.q >= 0 && m.q < 3)) {
      const m = byId.get(n.id + L.perQuad)
      assert.deepEqual([m.x, m.y], rot([n.x, n.y]))
      assert.equal(m.role, n.role)
    }
    // 方向ごとに 大マス1・スキルの置き場2。となりの方向へ渡るつながりがある（決まった道にしない）
    for (let q = 0; q < ASC_DIRS; q++) {
      const ns = L.nodes.filter(n => n.q === q)
      assert.equal(ns.filter(n => n.role === 'big').length, 1)
      assert.equal(ns.filter(n => n.role.startsWith('skill')).length, 2)
      assert.ok(ns.some(n => n.links.some(l => byId.get(l).q >= 0 && byId.get(l).q !== q)), `${stage} 方向${q} はとなりの方向へ渡れる`)
    }
    // 大マス・スキルマスは「行き着く先」（枝の先・ほかの特別なマスと隣り合わない）
    const special = L.nodes.filter(n => n.role === 'big' || n.role.startsWith('skill'))
    for (const n of special) {
      assert.equal(n.links.length, 1, `${stage} ${n.id}（${n.role}）は枝の先`)
      for (const m of special) if (m !== n) assert.ok(Math.abs(m.x - n.x) + Math.abs(m.y - n.y) > 1)
    }
    // 大マスはその方向でいちばん遠い
    for (let q = 0; q < ASC_DIRS; q++) {
      const ns = L.nodes.filter(n => n.q === q)
      assert.equal(ns.find(n => n.role === 'big').d, Math.max(...ns.map(n => n.d)))
    }
    // 小マスの段は起点から遠いほど上（近いマスより下の段にならない）
    const st = L.nodes.filter(n => n.role !== 'start')
    for (const a of st) for (const b of st) if (a.d < b.d) assert.ok(a.tier <= b.tier, `${stage} d${a.d}→d${b.d}`)
  }
})

test('【確定】どの職業にも盤面がある。初期職56マス・一次職96マス＝全部は埋まらず半分くらい', () => {
  assert.equal(ASC_CLASSES.length, CLASSES.length, '31職すべて')
  for (const cls of ASC_CLASSES) {
    const size = treeSizeOf(cls)
    assert.equal(size, stageOf(cls) === 'shoki' ? 56 : 96, cls)
    const ap = apTotalOf(cls, jobMaxOf(cls))
    assert.ok(ap / size > 0.45 && ap / size < 0.55, `${cls}：${ap}/${size}`)
  }
  assert.equal(apTotalOf('剣士', 30), 29)
  assert.equal(apTotalOf('狂戦士', 50), 49)
})

test('【確定】大マス（4方向の枝の先）は伸びるステの上位4つの+5%・スキルマスは技1つにつき1マス（パッシブには無い）', () => {
  for (const cls of ASC_CLASSES) {
    const t = treeOf(cls)
    const bigs = t.nodes.filter(n => n.type === 'big').sort((a, b) => a.q - b.q)
    assert.deepEqual(bigs.map(n => n.stat), areaStatsOf(cls), cls)
    for (const b of bigs) assert.equal(b.pct, 5)
    const onBoard = t.nodes.filter(n => n.type === 'skill').map(n => n.skill)
    assert.deepEqual([...onBoard].sort(), skillsOf(cls).map(s => s.name).sort(), cls)
    for (const n of onBoard) assert.ok(!isPassive(SKILL_BY_NAME[n]))
  }
  assert.deepEqual(areaStatsOf('剣士'), ['str', 'dex', 'agi', 'vit'])
  assert.deepEqual(areaStatsOf('魔法使い'), ['int_stat', 'mp', 'agi', 'hp'])
})

test('【確定】小マスのステは盤面全体に混ぜる（数はクラスのステの配分の割合・どの方向にもいろいろなステ）', () => {
  for (const cls of ASC_CLASSES) {
    const t = treeOf(cls)
    const smalls = t.nodes.filter(n => n.type === 'stat')
    const got = {}
    for (const n of smalls) got[n.stat] = (got[n.stat] || 0) + 1
    assert.deepEqual(got, statCountsOf(cls, smalls.length), `${cls} の数は配分の割合`)
    for (const k of Object.keys(got)) assert.ok(JOB_BONUS[cls][k] > 0, `${cls} に要らない ${k} は出ない`)
    // 配分の多いステほど多い
    const top = areaStatsOf(cls)[0]
    assert.equal(Math.max(...Object.values(got)), got[top], `${cls} は ${top} がいちばん多い`)
    // どの方向にも3種以上のステ（方向ごとにまとめない）
    for (let q = 0; q < ASC_DIRS; q++) {
      const kinds = new Set(smalls.filter(n => n.q === q).map(n => n.stat))
      assert.ok(kinds.size >= 3, `${cls} 方向${q}：${[...kinds].join(',')}`)
    }
    // 小マスの値は起点から遠いほど上（初期職 +2→+3→+4・一次職 +3→+4→+5）・HPは×8・MPは×3
    for (const n of smalls) {
      assert.ok(ASC_SHAPE[stageOf(cls)].tiers.includes(n.pts))
      assert.equal(n.amount, n.pts * STAT_DEFS[n.stat].unit)
    }
  }
  assert.deepEqual(ASC_SHAPE.shoki.tiers, [2, 3, 4])
  assert.deepEqual(ASC_SHAPE.ichiji.tiers, [3, 4, 5])
  // 決まった並び（職業の名前から作る＝いつ開いても同じ盤面）。変えると開いたマスのステが変わる
  const t = treeOf('剣士')
  assert.deepEqual([1, 2, 3, 4, 5].map(id => nodeLines(t.byId[id])[0]), [1, 2, 3, 4, 5].map(id => nodeLines(treeOf('剣士').byId[id])[0]))
  assert.notDeepEqual(treeOf('剣士').nodes.map(n => n.stat), treeOf('槍使い').nodes.map(n => n.stat), '職業ごとに混ぜ方が違う')
})

test('【確定】スキルマスの上がり幅：攻撃＝威力+20%・回復＝回復量+10%・バフ＝上がり幅を合計+10・%の無いバフ＝回数・ターン+1', () => {
  assert.deepEqual(ASC_UP_DEFAULT, { attack: 20, heal: 10, buff: 10, count: 1 })
  assert.equal(ascendSkill(SKILL_BY_NAME['袈裟斬り']).ascDmg, 20)
  assert.equal(ascendSkill(SKILL_BY_NAME['ヒール']).ascHeal, 10)
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['剣の構え']).buff.self, { str: 14, dex: 12, agi: 11 })
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['精神統一']).buff.self, { int_stat: 35 })
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['衰弱の呪詛']).buff.enemy, { str: -20, int_stat: -20 }, '相手を下げる技は下げ幅が+10')
  assert.deepEqual(ascendSkill(SKILL_BY_NAME['仙丹']).buff.self, { str: 17, dex: 17, agi: 17, int_stat: 17, vit: 16, luk: 16 })
  assert.equal(ascendSkill(SKILL_BY_NAME['受け止め']).guard.cut, 30)
  assert.equal(ascendSkill(SKILL_BY_NAME['ブラッディロア']).lifeSteal.pct, 20)
  assert.equal(ascendSkill(SKILL_BY_NAME['骸骨召喚']).summon.mult, 0.35, '魔法×0.25→×0.35')
  assert.equal(ascendSkill(SKILL_BY_NAME['リザレクション']).revive.pct, 60)
  assert.equal(ascendSkill(SKILL_BY_NAME['詠唱']).nextBoost.per, 25)
  assert.equal(ascendSkill(SKILL_BY_NAME['クイック']).extraTurn.max, 3)
  assert.equal(ascendSkill(SKILL_BY_NAME['分身の術']).gain.n, 2)
  assert.equal(ascendSkill(SKILL_BY_NAME['装填']).gain.n, 2)
  assert.equal(ascendSkill(SKILL_BY_NAME['鬼神降ろし']).summonHits.turns, 5)
  assert.equal(ascendSkill(SKILL_BY_NAME['狂信']).debuffImmune.turns, 5)
  assert.deepEqual(SKILL_BY_NAME['剣の構え'].buff.self, { str: 10, dex: 9, agi: 8 }, '元の技は書き換えない')
  assert.equal(SKILL_BY_NAME['クイック'].extraTurn.max, 2)
  assert.equal(ascSkillDetail('剣の構え'), 'STR+10%→+14%・DEX+9%→+12%・AGI+8%→+11%')
  assert.equal(ascSkillDetail('受け止め'), '受けるダメージ −20%→−30%')
  assert.equal(ascSkillDetail('クイック'), '戦闘中に使える回数 2回→3回')
})

test('★スキルマスのある技は、どれも何かが変わる（効かない技を作らない）', () => {
  for (const cls of ASC_CLASSES) {
    for (const n of treeOf(cls).nodes.filter(x => x.type === 'skill')) {
      const s = SKILL_BY_NAME[n.skill]
      assert.notDeepEqual(ascendSkill(s, n.up), s, `${cls}の${n.skill}（${ascKindOf(s)}）が変わる`)
      assert.ok(ascSkillDetail(n.skill), `${n.skill} の説明がある`)
    }
  }
  assert.deepEqual(Object.keys(ASC_COUNT_UP).sort(), ['クイック', '分身の術', '狂信', '装填', '鬼神降ろし'].sort())
})

test('技ごとの上がり幅は ASC_SKILL_UP で差し替えられる（ユーザーがあとで決める）', () => {
  assert.equal(ascUpOf('袈裟斬り'), 20)
  ASC_SKILL_UP['袈裟斬り'] = 25
  try {
    assert.equal(ascendSkill(SKILL_BY_NAME['袈裟斬り']).ascDmg, 25)
  } finally {
    delete ASC_SKILL_UP['袈裟斬り']
  }
  assert.equal(ascUpOf('バーサク'), 0, 'パッシブは0')
})

test('splitUp：合計を値の大きさで分ける（整数・符号は元のまま）', () => {
  assert.deepEqual(splitUp({ a: 10, b: 9, c: 8 }, 10), { a: 4, b: 3, c: 3 })
  assert.deepEqual(splitUp({ a: -15, b: -15 }, 10), { a: -5, b: -5 })
  assert.deepEqual(splitUp({}, 10), {})
  for (const t of [{ a: 1, b: 2, c: 3 }, { a: 7, b: 7, c: 7 }, { a: 20, b: 15 }]) {
    assert.equal(Object.values(splitUp(t, 10)).reduce((x, y) => x + y, 0), 10)
  }
})

test('【確定】AP＝CLASS LVが上がった回数×1。開いたマスの数だけ使う（どのマスも1AP）', () => {
  const p = prof('剣士', 12, { 剣士: [1, 2, 3, 15] })
  assert.deepEqual(ascStateOf(p), [1, 2, 3, 15])
  assert.equal(apTotalOf('剣士', 12), 11)
  assert.equal(apSpentOf(ascStateOf(p)), 4)
  assert.equal(apLeftOf(p), 7)
  // 盤面に無い番号・数でないもの・重なり・起点は捨てる（サーバーの v2cap_asc_state と同じ）
  assert.deepEqual(ascStateOf(prof('剣士', 30, { 剣士: [3, 3, 0, -1, 999, '4', 2.5, null, 1] })), [1, 3])
  assert.deepEqual(ascStateOf(prof('剣士', 30, { 剣士: { a: 1 } })), [])
  assert.equal(apTotalOf('剣士', 99), 29, '上限より上は増えない')
})

test('開けるか：起点か開いたマスにつながったマスだけ・順に（サーバーの v2cap_ascend と同じ順・同じ文言）', () => {
  const t = treeOf('剣士')
  const root = t.byId[0].links[0]
  const next = t.byId[root].links.find(l => l !== 0)
  const p = prof('剣士', 3)   // AP 2
  assert.equal(ascendError(p, '剣士', [root]), null)
  assert.equal(ascendError(p, '剣士', [root, next]), null, '先に開くマスにつながっていればよい')
  assert.equal(ascendError(p, '剣士', [next]), 'つながっていないマスは開けません')
  assert.equal(ascendError(p, '剣士', [root, root]), 'もう開いています')
  assert.equal(ascendError(p, '剣士', [0]), 'そのマスはありません')
  assert.equal(ascendError(p, '剣士', [999]), 'そのマスはありません')
  assert.equal(ascendError(p, '剣士', []), 'マスを選んでください')
  assert.equal(ascendError(p, 'なし', [1]), 'その職業にはアセンションがありません')
  const far = routeTo('剣士', [], t.nodes.find(n => n.type === 'big').id)
  assert.equal(ascendError(p, '剣士', far), 'APが足りません')
  assert.equal(ascResetGoldOf(30), 30 * ASC_RESET_GOLD_PER_LV)
  assert.equal(ASC_RESET_GOLD_PER_LV, 100)
})

test('いちばん近いルート：開いた所から、まだ開いていないマスだけを通る最短の並び（そのまま開ける）', () => {
  for (const cls of ['剣士', '魔法使い', '狂戦士']) {
    const t = treeOf(cls)
    for (const target of t.nodes.filter(n => n.id > 0)) {
      const r = routeTo(cls, [], target.id)
      assert.equal(r.length, target.d, `${cls} ${target.id} は起点からの近さと同じ長さ`)
      assert.equal(r[r.length - 1], target.id)
      assert.equal(ascendError(prof(cls, 60), cls, r), null, '光ったルートはそのまま開ける')
    }
    // 開いた所の先からなら短くなる
    const big = t.nodes.find(n => n.type === 'big')
    const path = routeTo(cls, [], big.id)
    const half = path.slice(0, Math.floor(path.length / 2))
    assert.deepEqual(routeTo(cls, half, big.id), path.slice(half.length))
    assert.deepEqual(routeTo(cls, path, big.id), [], '開いていれば空')
    assert.equal(routeTo(cls, [], 0), null)
    assert.equal(routeTo(cls, [], 9999), null)
  }
})

test('【確定】効くのはいまの職業の盤面だけ。小マスのステ・大マスの+%が内訳と合計に入る', () => {
  const t = treeOf('剣士')
  const big = t.nodes.find(n => n.type === 'big' && n.stat === 'str')
  const route = routeTo('剣士', [], big.id)
  const none = statBreakdown(prof('剣士', 30), [])
  const p = prof('剣士', 30, { 剣士: route, 戦士: [1, 2, 3] })
  const bd = statBreakdown(p, [])
  const flat = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  for (const id of route) { const n = t.byId[id]; if (n.type === 'stat') flat[n.stat] += n.amount }
  for (const k of STAT_KEYS) {
    const base = none.total[k] + flat[k]
    const big5 = k === 'str' ? Math.round(base * 5 / 100) : 0
    assert.equal(bd.asc[k], flat[k] + big5, k)
    assert.equal(bd.total[k], none.total[k] + flat[k] + big5, k)
  }
  assert.ok(bd.power > none.power)
  assert.deepEqual(Object.keys(ascEffectsOf(p).pct), ['str'])
  // 開いていなければ前と同じ（今いるキャラは何も変わらない）
  const p0 = prof('剣士', 30)
  delete p0.ascension
  assert.deepEqual(statBreakdown(p0, []).total, none.total)
  assert.equal(calcPower(statBreakdown(p0, []).total), none.power)
})

test('大マスの+%は四捨五入（サーバーの v2cap_asc_mp と同じ）・MPのマスの一覧は盤面と同じ', () => {
  assert.equal(ascPctGain({ mp: 250 }, { mp: 5 }).mp, 13)
  assert.equal(ascPctGain({ mp: 249 }, { mp: 5 }).mp, 12)
  for (const cls of ASC_CLASSES) {
    const t = treeOf(cls)
    for (const m of mpNodesOf(cls)) {
      const n = t.byId[m.id]
      assert.equal(n.stat, 'mp')
      assert.equal(m.mp, n.type === 'stat' ? n.amount : 0)
      assert.equal(m.pct, n.type === 'big' ? n.pct : 0)
    }
    assert.equal(mpNodesOf(cls).length, t.nodes.filter(n => n.stat === 'mp').length)
  }
})

test('【確定】戦闘：攻撃の技は威力+20%（ダメージ全体）・回復の技は回復量+10%・バフは上がり幅+10', () => {
  const st = { hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30 }
  const side = (cls, skill, ascend) => createSide({ name: '自分', cls, kind: attackKindOf(cls), stats: st, noClassBonus: true,
    slots: [{ skill: ascend ? ascendSkill(SKILL_BY_NAME[skill]) : SKILL_BY_NAME[skill], uses: 9 }], passives: [] })
  const foe = () => createSide({ name: '的', cls: null, kind: 'phys', stats: { ...st, hp: 10000000 }, slots: [], passives: [], noClassBonus: true })
  const mid = () => 0.5
  const act = (me) => { const log = []; takeAction(me, foe(), mid, log); return log }
  const dmg = (asc) => act(side('剣士', '袈裟斬り', asc)).find(l => l.type === 'skill').damage
  assert.ok(Math.abs(dmg(true) / dmg(false) - 1.2) < 0.01, `${dmg(true)} / ${dmg(false)}`)
  const healed = (asc) => { const me = side('僧侶', 'ヒール', asc); me.hp = 100; return act(me).find(l => l.type === 'heal').heal }
  assert.ok(Math.abs(healed(true) / healed(false) - 1.1) < 0.01, `${healed(true)} / ${healed(false)}`)
  const me = side('剣士', '剣の構え', true)
  act(me)
  assert.deepEqual({ str: me.buffs.str, dex: me.buffs.dex, agi: me.buffs.agi }, { str: 14, dex: 12, agi: 11 })
  const j = side('竜騎士', 'ジャンプ', true)
  act(j)
  assert.ok(Math.abs(j.jumping.mult - SKILL_BY_NAME['ジャンプ'].jump.mult * 1.2) < 1e-9, '着地で斬る技も威力+20%')
})

test('toFighter：いまの職業のスキルマスだけを技に乗せる（下位職の技・ほかの職業の盤面は乗らない）', () => {
  const t = treeOf('狂戦士')
  const node = t.nodes.find(n => n.type === 'skill' && n.skill === 'マッドラッシュ')
  const route = routeTo('狂戦士', [], node.id)
  const p = prof('狂戦士', 40, { 狂戦士: route, 戦士: treeOf('戦士').nodes.filter(n => n.id > 0).map(n => n.id) }, {
    skill_sets: { 狂戦士: [{ name: 'マッドラッシュ', uses: 1 }, { name: '体当たり', uses: 1 }] },
    jobs: { 狂戦士: { lv: 40, exp: 0 }, 戦士: { lv: 30, exp: 0 } },
    learned: ['マッドラッシュ', '体当たり'],
  })
  const by = Object.fromEntries(toFighter(p, []).slots.map(s => [s.skill.name, s.skill]))
  assert.equal(by['マッドラッシュ'].ascDmg, 20)
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
})
