// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）の決まりを固定するテスト（node --test）
// 設計は docs/v2cap-design.md。ユーザーが決めたことは【確定】と書いてある
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower, INITIAL_STATS } from '../../v2/lib/stats.js'
import { CATALOG, ITEM_BY_ID } from '../../v2/lib/equipment.js'
import { SKILLS, isPassive } from '../../v2/lib/skills.js'
import { createSide } from '../../v2/lib/battle.js'
import { AREAS } from '../../v2/lib/enemies.js'
import {
  MAX_LV, needExp, totalExpTo, applyExp, rollExp, expMinOf, expMaxOf, baseExpOf,
  bodyPowerAt, staminaMaxOf,
} from './level.js'
import {
  CLASSES, START_CLASSES, STAGES, JOB_MAX, JOB_BONUS, jobNeed, jobTotalTo, bonusSeqOf,
  bonusPointsAt, jobBonusStats, learnOrderOf, learnAtOf, skillsLearnedBy, applyJobExp,
  canBecome, missingReqOf,
} from './jobs.js'
import { powerAt, effectPct, statsAt, GEAR_RATIO } from './gear.js'
import { TIER_LV, ENEMY_LEVELS, enemyLvOf, stdPowerAt, BOSS_RATIO, STD_RATIO, enemyPowerOf } from './areas.js'
import { toFighter, statBreakdown } from './loadout.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ===== LVとEXP =====
test('【確定】LV上限は100。必要EXPは上がるほど重くなる（MMORPG式）', () => {
  assert.equal(MAX_LV, 100)
  assert.equal(needExp(100), 0)
  for (let l = 1; l < 99; l++) assert.ok(needExp(l + 1) > needExp(l), `LV${l}→${l + 1} より LV${l + 1}→${l + 2} が重い`)
  // そのLVで要る勝ち数（必要EXP ÷ 1勝のEXP）も上がり続ける
  for (let l = 1; l < 99; l++) assert.ok(needExp(l + 1) / baseExpOf(l + 1) > needExp(l) / baseExpOf(l))
  // 設計書§2の表（係数0.335＝tools/v2cap-progress.mjs で1年でLV100前後になるよう決めた）
  assert.deepEqual([1, 5, 10, 20, 30, 50, 70, 90, 99].map(needExp), [3, 117, 637, 3886, 11759, 49413, 129679, 268637, 354600])
})

test('【確定】LV100で止まり、あふれたEXPは捨てる。周回（LV1に戻る）は無い', () => {
  const s = applyExp({ lv: 99, exp: 0, ...INITIAL_STATS }, needExp(99) * 3, rngOf(1))
  assert.equal(s.lv, 100)
  assert.equal(s.exp, 0)
  const again = applyExp({ ...s, ...s.stats }, 1000000, rngOf(2))
  assert.equal(again.lv, 100)
  assert.equal(again.levelUps.length, 0)
})

test('LVアップごとに5回抽選＝戦闘力+5（ステータスは今のⅡと同じ）', () => {
  const s = applyExp({ lv: 1, exp: 0, ...INITIAL_STATS }, totalExpTo(31), rngOf(3))
  assert.equal(s.lv, 31)
  assert.equal(calcPower(s.stats), calcPower(INITIAL_STATS) + 5 * 30)
  assert.equal(bodyPowerAt(31), calcPower(s.stats))
})

test('1勝のEXPは敵のLV＋9（雑魚±15%・ボス1.4倍）。先のエリアほど多い', () => {
  assert.equal(baseExpOf(1), 10)
  assert.equal(expMaxOf(20, true), Math.round(29 * 1.4))
  const rng = rngOf(4)
  for (let i = 0; i < 2000; i++) {
    const lv = 1 + (i % 100)
    const e = rollExp(lv, false, rng)
    assert.ok(e >= expMinOf(lv) && e <= expMaxOf(lv), `LV${lv}の雑魚 ${e}`)
  }
  for (let t = 1; t < 8; t++) assert.ok(TIER_LV[t + 1][0] >= TIER_LV[t][0], '帯の下限は右肩上がり')
})

test('【確定】スタミナの最大値はLVで伸びる（10＋LV÷5）', () => {
  assert.equal(staminaMaxOf(1), 10)
  assert.equal(staminaMaxOf(5), 11)
  assert.equal(staminaMaxOf(100), 30)
})

// ===== ジョブLV =====
test('【確定】職業の段階：初期＝ノーブル＋6職／一次＝12職（元の初期職のJLV30で就ける）', () => {
  assert.deepEqual(START_CLASSES, ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー'])
  const shoki = CLASSES.filter(c => c.stage === 'shoki')
  const ichiji = CLASSES.filter(c => c.stage === 'ichiji')
  assert.equal(shoki.length, 7)
  assert.equal(ichiji.length, 12)
  for (const c of ichiji) {
    assert.ok(START_CLASSES.includes(c.req.cls), `${c.id}の元は初期職`)
    assert.equal(c.req.jlv, JOB_MAX)
  }
  // ★複合上位職・特殊職はまだ置き場が決まっていない（二次・三次を作るときに決める）
  for (const id of ['賢者', '聖騎士', '魔法剣士', 'ギャンブラー', '竜騎士']) assert.ok(!CLASSES.some(c => c.id === id), `${id}はまだ無い`)
})

test('【確定】ジョブLVは最大30・上の段階ほど上がりにくい', () => {
  assert.equal(JOB_MAX, 30)
  assert.equal(jobNeed('shoki', 30), 0)
  for (let j = 1; j < 30; j++) assert.ok(jobNeed('ichiji', j) > jobNeed('shoki', j))
  // 初期職のJLV30まで＝LV31のころに入っているEXP（1日1時間で約2週間＝実測の中央値13日目）
  const total = jobTotalTo('shoki', 30)
  assert.equal(total, 105228)
  assert.ok(total >= totalExpTo(31) && total < totalExpTo(32), `初期職の合計 ${total} はLV31〜32のあいだ`)
  assert.equal(STAGES.ichiji.mult, 3)
})

test('【確定】ジョブのステは職業ごとに決まった配分で、その職業の間だけ（JLV30で初期29点・一次58点）', () => {
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    assert.ok(w, `${c.id}の配分がある`)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    assert.equal(sum, (JOB_MAX - 1) * STAGES[c.stage].perLv, `${c.id}の合計`)
    const seq = bonusSeqOf(c.id)
    assert.equal(seq.length, sum)
    for (const [k, v] of Object.entries(w)) assert.equal(seq.filter(x => x === k).length, v, `${c.id}の${k}`)
    const full = jobBonusStats(c.id, JOB_MAX)
    for (const k of STAT_KEYS) assert.equal(full[k], (w[k] || 0) * STAT_DEFS[k].unit)
    assert.equal(calcPower(jobBonusStats(c.id, 1)), 0, 'JLV1ではまだ何も上がっていない')
    assert.equal(bonusPointsAt(c.id, JOB_MAX), sum)
  }
})

test('ジョブのステの並びは「どこで止めても配分どおりに近い」（1つのステへ偏らない）', () => {
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    const seq = bonusSeqOf(c.id)
    for (let n = 1; n <= total; n++) {
      for (const [k, v] of Object.entries(w)) {
        const got = seq.slice(0, n).filter(x => x === k).length
        assert.ok(Math.abs(got - v * n / total) <= 1.0001, `${c.id} ${n}点目の${k}: ${got}（目安${(v * n / total).toFixed(2)}）`)
      }
    }
  }
})

test('スキルはジョブLVで覚える（初期 1/5/10/15/20・一次 1/4/…/28）。転職5回が要った技は後ろ', () => {
  assert.deepEqual(STAGES.shoki.learnAt, [1, 5, 10, 15, 20])
  assert.deepEqual(STAGES.ichiji.learnAt, [1, 4, 7, 10, 13, 16, 19, 22, 25, 28])
  for (const c of CLASSES) {
    const order = learnOrderOf(c.id)
    // ⚠今のⅡのスキル数が変わったら、覚えるジョブLVの表も直すこと（覚えられない技が出る）
    assert.equal(order.length, learnAtOf(c.id).length, `${c.id}のスキル数と覚えるジョブLVの数`)
    assert.ok(order.every(s => !isPassive(s)), 'パッシブは覚える技に入れない')
    const firstReq = order.findIndex(s => s.reqJobs)
    if (firstReq >= 0) assert.ok(order.slice(firstReq).every(s => s.reqJobs), `${c.id}：転職5回が要った技は後ろにまとまる`)
    assert.equal(skillsLearnedBy(c.id, JOB_MAX).length, order.length, `${c.id}はJLV30で全部覚えている`)
    assert.equal(skillsLearnedBy(c.id, 1).length, 1, `${c.id}はJLV1で1つ覚えている`)
  }
})

test('ジョブEXPを入れると、JLV30で止まり、覚えた技が返る', () => {
  const r = applyJobExp({}, '戦士', jobTotalTo('shoki', 30) + 999999, ['体当たり'])
  assert.equal(r.lv, 30)
  assert.equal(r.exp, 0)
  assert.deepEqual(r.learned, ['強撃', '防御崩し', '防御態勢', 'シールドアタック'])
  assert.equal(r.ups.length, 29)
})

test('一次職は元の初期職のJLV30が要る', () => {
  assert.equal(canBecome('侍', {}), false)
  assert.ok(missingReqOf('侍', { 戦士: { lv: 29, exp: 0 } }))
  assert.equal(canBecome('侍', { 戦士: { lv: 30, exp: 0 } }), true)
  assert.equal(canBecome('戦士', {}), true)
})

// ===== 装備 =====
test('【確定】必要LVに足りないと、不足1LVごとに効果-5%・下げ幅は最大90%', () => {
  assert.equal(effectPct(10, 10), 100)
  assert.equal(effectPct(5, 10), 100, '足りていれば100%')
  assert.equal(effectPct(11, 10), 95)
  assert.equal(effectPct(20, 10), 50)
  assert.equal(effectPct(28, 10), 10)
  assert.equal(effectPct(100, 1), 10, 'どれだけ足りなくても10%は残る')
})

test('【確定】同じLVのCランクを8枠そろえると、本体（LVぶん）と同じくらい', () => {
  assert.equal(GEAR_RATIO, 1)
  const C = (id) => ITEM_BY_ID[id]
  const set = [C('w:剣:C'), C('w:剣:C'), C('a:重装:頭:C'), C('a:重装:鎧:C'), C('a:重装:腕:C'), C('a:重装:足:C'), C('c:リング:C'), C('c:リング:C')]
  for (const lv of [20, 50, 100]) {
    const sum = set.reduce((t, it) => t + powerAt(it, lv), 0)
    assert.ok(Math.abs(sum - bodyPowerAt(lv)) / bodyPowerAt(lv) < 0.03, `LV${lv}：装備${sum} ≒ 本体${bodyPowerAt(lv)}`)
  }
})

test('装備のステは配分どおりで、合計は効果%を掛けた戦闘力', () => {
  for (const item of CATALOG) {
    for (const [ilv, pct] of [[1, 100], [37, 100], [80, 55], [100, 10]]) {
      const s = statsAt(item, ilv, pct)
      assert.equal(Object.values(s).reduce((a, b) => a + b, 0), Math.round(powerAt(item, ilv) * pct / 100), `${item.name} LV${ilv}`)
      assert.equal(s.hp + s.mp + s.luk, 0, 'HP・MP・LUKは装備に載らない（今のⅡと同じ）')
    }
  }
})

// ===== 敵のLV =====
test('【確定】敵は敵ごとに決まったLVを持つ（帯の中）。ボスは帯の上限', () => {
  for (const a of AREAS) {
    const [lo, hi] = TIER_LV[a.tier]
    for (const e of [...a.enemies, ...(a.timed || [])]) {
      const lv = enemyLvOf(e.name)
      assert.ok(lv >= lo && lv <= hi, `${e.name} LV${lv} は ${lo}〜${hi}`)
      assert.ok(lv < hi, `${e.name}はボスより下`)
    }
    assert.equal(enemyLvOf(a.boss.name), hi, `${a.boss.name}は帯の上限`)
  }
  assert.equal(new Set(ENEMY_LEVELS.map(e => e.name)).size, ENEMY_LEVELS.length, '名前は重複しない')
})

test('敵の強さの基準（標準の戦闘力）は右肩上がり・ボスの倍率は8帯ぶんある', () => {
  for (let l = 1; l < 100; l++) assert.ok(stdPowerAt(l + 1) >= stdPowerAt(l))
  for (let t = 1; t <= 8; t++) assert.ok(BOSS_RATIO[t] > 0, `帯${t}のボスの倍率`)
  assert.equal(STD_RATIO[0][0], 1)
  assert.equal(STD_RATIO[STD_RATIO.length - 1][0], 100)
  // 同じLVなら雑魚はプレイヤーの0.6倍
  const slime = AREAS[0].enemies.find(e => e.name === 'スライム')
  assert.equal(enemyPowerOf(slime), Math.round(stdPowerAt(enemyLvOf('スライム')) * 0.6))
})

// ===== 戦闘 =====
test('【確定】職業補正は一旦なし（runBattle に noClassBonus を渡す）。パッシブは効く', () => {
  const prof = { username:'t', class:'狂戦士', lv: 30, ...INITIAL_STATS, jobs: { 狂戦士: { lv: 10, exp: 0 } }, skill_set: [], equipped: {} }
  const f = toFighter(prof, [])
  assert.equal(f.noClassBonus, true)
  const side = createSide(f)
  assert.equal(side.buffs.str || 0, 0, '狂戦士のSTR+10%が乗っていない')
  assert.ok(side.passives.length > 0, '狂戦士のパッシブ（バーサク）は効く')
  // 今のⅡ（noClassBonus なし）は従来どおり職業補正が乗る
  const v2 = createSide({ ...f, noClassBonus: undefined })
  assert.ok((v2.buffs.str || 0) > 0)
})

test('戦闘のステ＝本体＋いまの職業のジョブのステ＋装備（必要LV不足ぶんを引く）', () => {
  const inv = [{ id: 1, equip_id: 'w:剣:C', ilv: 40 }]
  const prof = { username:'t', class:'戦士', lv: 30, ...INITIAL_STATS, jobs: { 戦士: { lv: 30, exp: 0 }, 侍: { lv: 5, exp: 0 } }, equipped: { right: 1 } }
  const bd = statBreakdown(prof, inv)
  assert.deepEqual(bd.job, jobBonusStats('戦士', 30))
  assert.equal(calcPower(bd.gear), Math.round(powerAt(ITEM_BY_ID['w:剣:C'], 40) * 50 / 100), 'LV30でLV40の装備＝効果50%')
  // 転職するとジョブのステは入れ替わる（侍のJLV5ぶん）
  const asSamurai = statBreakdown({ ...prof, class:'侍' }, inv)
  assert.deepEqual(asSamurai.job, jobBonusStats('侍', 5))
})

test('今のⅡのスキル一覧に、この版の職業のスキルがそろっている', () => {
  for (const c of CLASSES) assert.ok(SKILLS.some(s => s.cls === c.id), `${c.id}のスキルがある`)
})
