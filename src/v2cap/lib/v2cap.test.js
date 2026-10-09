// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）の決まりを固定するテスト（node --test）
// 設計は docs/v2cap-design.md。ユーザーが決めたことは【確定】と書いてある
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower, INITIAL_STATS } from '../../v2/lib/stats.js'
import { skillValue, VALUE_TABLE, MP_TABLE, BUFF_PER_MP, HEAL_PER_MP, MPREGEN_PER_MP, SKILLS as V2_SKILLS, offClassMult } from '../../v2/lib/skills.js'
import { createSide, mpCostOf } from '../../v2/lib/battle.js'
import { AREAS } from '../../v2/lib/enemies.js'
import {
  MAX_LV, needExp, totalExpTo, applyExp, rollExp, expMinOf, expMaxOf, baseExpOf,
  bodyPowerAt, staminaMaxOf,
} from './level.js'
import {
  CLASSES, START_CLASSES, STAGES, JOB_MAX, JOB_BONUS, jobNeed, jobTotalTo, bonusSeqOf,
  bonusPointsAt, jobBonusStats, learnOrderOf, learnAtOf, skillsLearnedBy, applyJobExp,
  canBecome, weaponsOf, canEquipType, attackKindOf, lineageOf, usableSkillNames,
} from './jobs.js'
import { SKILLS, NEW_SKILLS, SKILL_BY_NAME, setMpCost, validateSkillSet, defaultSetOf, DEFAULT_USES_MAX } from './skills.js'
import {
  BASE_ITEMS, ITEM_BY_ID, WEAPON_TYPES, ARMOR_LINES, ARMOR_PARTS, PART_MULT, SLOTS, ARMOR_EFFECT,
  weaponsOfType, armorsOf, slotsFor,
} from './equipment.js'
import { powerAt, effectPct, statsAt, armorEffects, GEAR_RATIO, SET_PART_SUM } from './gear.js'
import { TIER_LV, ENEMY_LEVELS, enemyLvOf, stdPowerAt, BOSS_RATIO, STD_RATIO, enemyPowerOf } from './areas.js'
import { toFighter, statBreakdown, equippedItems, slotsOf, currentSetOf } from './loadout.js'
import { rollBaseItem, rollEquipDrop, pickEncounter } from './sortie.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ===== LVとEXP =====
test('【確定】LV上限は100。必要EXPは上がるほど重くなる（MMORPG式）', () => {
  assert.equal(MAX_LV, 100)
  assert.equal(needExp(100), 0)
  for (let l = 1; l < 99; l++) assert.ok(needExp(l + 1) > needExp(l), `LV${l}→${l + 1} より LV${l + 1}→${l + 2} が重い`)
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

// ===== 職業 =====
test('【確定】初期職は10職。装備できる武器は職業ごとに3種（ユーザーの表のとおり）', () => {
  assert.deepEqual(START_CLASSES, ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師'])
  const table = {
    戦士: ['両手剣', '斧', '鈍器'], 槍使い: ['槍', '片手剣', '投擲'], 格闘家: ['拳', '鈍器', '杖'],
    盗賊: ['短剣', '片手剣', '投擲'], 弓使い: ['弓', '短剣', '片手剣'], 銃士: ['銃', '片手剣', '投擲'],
    魔法使い: ['杖', '書', '短剣'], 呪術師: ['杖', '短剣', '投擲'], 僧侶: ['鈍器', '杖', '書'], 薬師: ['短剣', '投擲', '書'],
  }
  for (const [cls, list] of Object.entries(table)) assert.deepEqual(weaponsOf(cls), list, `${cls}の武器`)
  for (const list of Object.values(table)) for (const w of list) assert.ok(WEAPON_TYPES.includes(w), `${w}は12種にある`)
})

test('【確定】ノーブル・サモナーはなくし、一次職も一旦なし（初期職だけ）', () => {
  assert.equal(CLASSES.length, 10)
  assert.ok(CLASSES.every(c => c.stage === 'shoki' && !c.req))
  for (const id of ['ノーブル', 'サモナー', '侍', '狂戦士', '聖職者', '賢者']) assert.ok(!CLASSES.some(c => c.id === id), `${id}は無い`)
  assert.deepEqual(Object.keys(STAGES), ['shoki'])
  for (const c of CLASSES) assert.equal(canBecome(c.id, {}), true, `${c.id}は条件なし`)
})

test('通常攻撃は 槍使い・盗賊・銃士・戦士・格闘家・弓使い＝物理／魔法使い・呪術師・僧侶・薬師＝魔法', () => {
  for (const c of ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士']) assert.equal(attackKindOf(c), 'phys', c)
  for (const c of ['魔法使い', '呪術師', '僧侶', '薬師']) assert.equal(attackKindOf(c), 'mag', c)
})

test('【確定】JBLVは最大30。初期職のJBLV30まで＝LV31のころに入っているEXP（実測で約2週間）', () => {
  assert.equal(JOB_MAX, 30)
  assert.equal(jobNeed('shoki', 30), 0)
  const total = jobTotalTo('shoki', 30)
  assert.equal(total, 105228)
  assert.ok(total >= totalExpTo(31) && total < totalExpTo(32), `初期職の合計 ${total} はLV31〜32のあいだ`)
})

test('【確定】ジョブのステは職業ごとに決まった配分で、その職業の間だけ（JBLV30で29点）', () => {
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    assert.ok(w, `${c.id}の配分がある`)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    assert.equal(sum, 29, `${c.id}の合計`)
    const seq = bonusSeqOf(c.id)
    assert.equal(seq.length, sum)
    for (const [k, v] of Object.entries(w)) assert.equal(seq.filter(x => x === k).length, v, `${c.id}の${k}`)
    const full = jobBonusStats(c.id, JOB_MAX)
    for (const k of STAT_KEYS) assert.equal(full[k], (w[k] || 0) * STAT_DEFS[k].unit)
    assert.equal(calcPower(jobBonusStats(c.id, 1)), 0, 'JBLV1ではまだ何も上がっていない')
    assert.equal(bonusPointsAt(c.id, JOB_MAX), sum)
    // どこで止めても配分どおりに近い（1つのステへ偏らない）
    for (let n = 1; n <= sum; n++) {
      for (const [k, v] of Object.entries(w)) {
        const got = seq.slice(0, n).filter(x => x === k).length
        assert.ok(Math.abs(got - v * n / sum) <= 1.0001, `${c.id} ${n}点目の${k}`)
      }
    }
  }
})

// ===== スキル =====
test('スキルはJBLV 1／5／10／15／20 で1つずつ覚える（どの職業も5個）', () => {
  assert.deepEqual(STAGES.shoki.learnAt, [1, 5, 10, 15, 20])
  for (const c of CLASSES) {
    assert.equal(learnOrderOf(c.id).length, learnAtOf(c.id).length, `${c.id}のスキル数`)
    assert.equal(skillsLearnedBy(c.id, 1).length, 1, `${c.id}はJBLV1で1つ`)
    assert.equal(skillsLearnedBy(c.id, JOB_MAX).length, 5, `${c.id}はJBLV30で全部`)
  }
  const r = applyJobExp({}, '戦士', jobTotalTo('shoki', 30) + 999999, ['体当たり'])
  assert.equal(r.lv, 30)
  assert.equal(r.exp, 0)
  assert.deepEqual(r.learned, ['強撃', '防御崩し', '防御態勢', 'シールドアタック'])
})

test('【確定】戦士・弓使い・魔法使い・僧侶・格闘家のスキルは今のⅡのまま（中身も並びも同じ）', () => {
  for (const cls of ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']) {
    const v2 = V2_SKILLS.filter(s => s.cls === cls)
    assert.deepEqual(learnOrderOf(cls), v2, `${cls}`)
  }
})

test('【確定】新しい5職（槍使い・盗賊・銃士・呪術師・薬師）の25技は、今のⅡの初期職と同じ帯（価値・消費MP）', () => {
  assert.equal(NEW_SKILLS.length, 25)
  const band = (t, proc) => { const ks = Object.keys(t).map(Number).sort((a, b) => b - a); return t[ks.find(k => proc >= k) ?? ks[ks.length - 1]] }
  for (const s of NEW_SKILLS) {
    assert.ok(['槍使い', '盗賊', '銃士', '呪術師', '薬師'].includes(s.cls), s.name)
    if (s.kind === 'phys' || s.kind === 'mag') {
      assert.ok(Math.abs(skillValue(s) - band(VALUE_TABLE.basic[s.kind], s.proc)) <= 0.03, `${s.name}の価値 ${skillValue(s)}`)
      assert.equal(s.mp, band(MP_TABLE.basic[s.kind], s.proc), `${s.name}の消費MP`)
      assert.ok(s.proc >= 85, `${s.name}：初期職は発動率85%以上`)
    } else if (s.kind === 'buff') {
      const tot = [...Object.values(s.buff.self || {}), ...Object.values(s.buff.enemy || {})].reduce((a, b) => a + Math.abs(b), 0)
      assert.ok(tot <= s.mp * BUFF_PER_MP.basic + 0.01, `${s.name}：バフの合計 ${tot}% は MP×3.4 まで`)
    } else if (s.heal) {
      assert.ok(s.heal.rate <= s.mp * HEAL_PER_MP.basic + 1e-9, `${s.name}の回復量`)
    } else if (s.mpRegen) {
      assert.ok(s.mpRegen.rate * s.mpRegen.turns <= s.mp * MPREGEN_PER_MP.basic + 1e-9, `${s.name}のMP回復`)
    }
  }
  assert.equal(new Set(SKILLS.map(s => s.name)).size, SKILLS.length, 'スキル名は重複しない')
  assert.ok(!NEW_SKILLS.some(s => V2_SKILLS.some(v => v.name === s.name)), '今のⅡの技と名前がぶつからない')
})

test('編成の想定利用MPは、この版の名簿で数える（新しい技の消費MPが0に見えない）', () => {
  assert.equal(setMpCost([{ name:'災いの呪い', uses: 2 }]), 26)
  assert.equal(validateSkillSet([{ name:'災いの呪い', uses: 1 }], { lineage: ['呪術師'], learned: ['災いの呪い'], maxMp: 12 }), '想定利用MPが最大MPを超えています（13 / 12）')
  assert.equal(validateSkillSet([{ name:'呪弾', uses: 2 }], { lineage: ['呪術師'], learned: ['呪弾'], maxMp: 12 }), null)
  assert.ok(SKILL_BY_NAME['気付け薬'])
})

test('【確定】スキルはその職業でだけ使える。他の職業の技は、覚えていても置けない（0.8倍・MP2倍で使う形はやめた）', () => {
  for (const c of CLASSES) assert.deepEqual(lineageOf(c.id), [c.id], `${c.id}：いまは上位職が無い＝自分だけ`)
  const lin = lineageOf('戦士')
  const learned = ['体当たり', '強撃', '呪弾']
  assert.equal(validateSkillSet([{ name:'呪弾', uses: 1 }], { lineage: lin, learned, maxMp: 99 }), '呪弾は戦士では使えません（呪術師のスキル）')
  assert.equal(validateSkillSet([{ name:'防御崩し', uses: 1 }], { lineage: lin, learned, maxMp: 99 }), '防御崩しはまだ覚えていません')
  assert.equal(validateSkillSet([{ name:'強撃', uses: 1 }], { lineage: lin, learned, maxMp: 99 }), null)
  assert.equal(validateSkillSet([{ name:'強撃', uses: 1 }], { learned, maxMp: 99 }), '強撃はいまの職業では使えません（戦士のスキル）', '職業を渡し忘れたら何も置けない（緩い側に倒れない）')
  assert.deepEqual(usableSkillNames('戦士', learned), ['体当たり', '強撃'], '置けるのはその職業の覚えた技だけ')
})

test('【確定】上位職は下位職のスキルをそのまま使える（効果も消費MPも同じ）', () => {
  // いまは上位職が無いので、就く条件（req）だけを持たせた試しの名簿で確かめる
  const byId = { 戦士: { req: null }, 騎士: { req: { cls:'戦士', jlv: 20 } }, 聖騎士: { req: { cls:'騎士', jlv: 30 } } }
  assert.deepEqual(lineageOf('聖騎士', byId), ['聖騎士', '騎士', '戦士'], '何段でもさかのぼる')
  assert.deepEqual(lineageOf('戦士', byId), ['戦士'], '下位職は上位職の技を使えない')
  assert.deepEqual(lineageOf('A', { A: { req: { cls:'B' } }, B: { req: { cls:'A' } } }), ['A', 'B'], '輪になっていても止まる')
  const lin = lineageOf('騎士', byId)
  assert.equal(validateSkillSet([{ name:'強撃', uses: 1 }], { lineage: lin, learned: ['強撃'], maxMp: 99 }), null)
  assert.equal(validateSkillSet([{ name:'呪弾', uses: 1 }], { lineage: lin, learned: ['呪弾'], maxMp: 99 }), '呪弾は騎士では使えません（呪術師のスキル）')
  assert.deepEqual(usableSkillNames('騎士', ['体当たり', '呪弾'], lin), ['体当たり'])
  // 戦闘：下位職の技は「自分の職業の技」として渡す＝今のⅡのエンジンが他職扱い（0.8倍・MP2倍）にしない
  const slots = slotsOf([{ name:'強撃', uses: 2 }, { name:'呪弾', uses: 1 }], '騎士', lin)
  assert.deepEqual(slots.map(s => [s.skill.name, s.uses]), [['強撃', 2]], '下位職でない職業の技は戦闘の枠にも入れない')
  const side = createSide({ name:'k', cls:'騎士', stats:{ ...INITIAL_STATS }, slots, noClassBonus: true })
  const sk = side.slots[0].skill
  assert.equal(offClassMult(side.cls, sk), 1, '効果はそのまま')
  assert.equal(mpCostOf(side, sk), SKILL_BY_NAME['強撃'].mp, '消費MPもそのまま')
  // 渡さなければ（今のⅡのまま）他職扱いになる＝ここで差し替えていることの確かめ
  assert.ok(offClassMult('騎士', SKILL_BY_NAME['強撃']) < 1)
})

test('【確定】スキルセットは職業ごと。初めて就いた職業は、覚えている技を入れた編成で始まる', () => {
  // JBLV1の技1つ。回数は最大MPに収まるだけ（1枠最大5回）
  assert.deepEqual(defaultSetOf('戦士', ['体当たり'], 12), [{ name:'体当たり', uses: 3 }])
  assert.deepEqual(defaultSetOf('魔法使い', ['マジックアロー'], 999), [{ name:'マジックアロー', uses: DEFAULT_USES_MAX }])
  assert.deepEqual(defaultSetOf('戦士', ['体当たり'], 3), [], '1回も撃てなければ空')
  assert.deepEqual(defaultSetOf('戦士', ['体当たり', '呪弾'], 12), [{ name:'体当たり', uses: 3 }], '他の職業の技は入れない')
  // 覚えた技が多いときは覚えた順に最大5枠。前の枠から1回ずつ足し、最大MPを超えない
  for (const max of [15, 30, 60, 200]) {
    const s = defaultSetOf('戦士', skillsLearnedBy('戦士', JOB_MAX), max)
    assert.deepEqual(s.map(e => e.name), learnOrderOf('戦士').slice(0, s.length).map(x => x.name), `MP${max}：覚えた順`)
    assert.ok(setMpCost(s) <= max, `MP${max}：収まる`)
    assert.ok(s.every(e => e.uses >= 1 && e.uses <= DEFAULT_USES_MAX))
  }
  // 画面・戦闘が見るのは、いまの職業の編成
  const p = { class:'魔法使い', skill_sets: { 戦士: [{ name:'体当たり', uses: 3 }], 魔法使い: [{ name:'マジックアロー', uses: 2 }] } }
  assert.deepEqual(currentSetOf(p), [{ name:'マジックアロー', uses: 2 }])
  assert.deepEqual(currentSetOf({ class:'銃士', skill_sets: {} }), [], 'まだ編成が無い職業は空')
  assert.deepEqual(currentSetOf({ class:'銃士' }), [])
})

// ===== 装備 =====
test('【確定】武器は12種・盾なし。基本装備ごとに配分が違う（武器36・防具16・アクセ4）', () => {
  assert.deepEqual(WEAPON_TYPES, ['片手剣', '両手剣', '斧', '槍', '鈍器', '短剣', '拳', '弓', '銃', '杖', '書', '投擲'])
  const weapons = BASE_ITEMS.filter(i => i.part === '武器')
  assert.equal(weapons.length, 36)
  for (const t of WEAPON_TYPES) assert.ok(weaponsOfType(t).length >= 2, `${t}は基本装備が2つ以上`)
  assert.ok(!BASE_ITEMS.some(i => i.name.includes('盾') || i.type === '盾'), '盾は無い')
  assert.deepEqual(ARMOR_LINES, ['重鎧', '軽装'])
  for (const part of ARMOR_PARTS) for (const line of ARMOR_LINES) assert.equal(armorsOf(part, line).length, 2, `${line}・${part}`)
  assert.equal(BASE_ITEMS.filter(i => i.part === 'アクセ').length, 4)
  for (const i of BASE_ITEMS) {
    assert.equal(Object.values(i.dist).reduce((a, b) => a + b, 0), 100, `${i.name}の配分の合計`)
    assert.ok(!('hp' in i.dist) && !('mp' in i.dist) && !('luk' in i.dist), `${i.name}：HP・MP・LUKは載せない`)
  }
  assert.equal(new Set(BASE_ITEMS.map(i => i.id)).size, BASE_ITEMS.length, 'IDは重複しない')
})

test('【確定】武器は1本だけ。枠は7つ（武器・頭・鎧・腕・足・アクセ2）', () => {
  assert.deepEqual(SLOTS, ['weapon', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2'])
  for (const i of BASE_ITEMS) assert.ok(slotsFor(i).length >= 1, i.name)
  assert.deepEqual(slotsFor(ITEM_BY_ID['w:大剣']), ['weapon'], '両手剣も武器の枠1つ')
  assert.equal(PART_MULT.武器, 2.0)
  const sum = PART_MULT.武器 + PART_MULT.頭 + PART_MULT.鎧 + PART_MULT.腕 + PART_MULT.足 + PART_MULT.アクセ * 2
  assert.ok(Math.abs(sum - SET_PART_SUM) < 1e-9, `7枠の倍率の合計 ${sum}`)
})

test('【確定】同じLVのCランクを全部の枠にそろえると、本体（LVぶん）と同じくらい', () => {
  assert.equal(GEAR_RATIO, 1)
  const set = ['w:ロングソード', 'a:鉄兜', 'a:プレートメイル', 'a:鉄の籠手', 'a:鉄靴', 'c:リング', 'c:リング'].map(id => ITEM_BY_ID[id])
  for (const lv of [20, 50, 100]) {
    const sum = set.reduce((t, it) => t + powerAt(it, 'C', lv), 0)
    assert.ok(Math.abs(sum - bodyPowerAt(lv)) / bodyPowerAt(lv) < 0.03, `LV${lv}：装備${sum} ≒ 本体${bodyPowerAt(lv)}`)
  }
})

test('【確定】必要LVに足りないと、不足1LVごとに効果-5%・下げ幅は最大90%', () => {
  assert.equal(effectPct(10, 10), 100)
  assert.equal(effectPct(5, 10), 100, '足りていれば100%')
  assert.equal(effectPct(11, 10), 95)
  assert.equal(effectPct(20, 10), 50)
  assert.equal(effectPct(28, 10), 10)
  assert.equal(effectPct(100, 1), 10, 'どれだけ足りなくても10%は残る')
  for (const item of BASE_ITEMS) {
    for (const [ilv, pct] of [[1, 100], [37, 100], [80, 55], [100, 10]]) {
      const s = statsAt(item, 'B', ilv, pct)
      assert.equal(Object.values(s).reduce((a, b) => a + b, 0), Math.round(powerAt(item, 'B', ilv) * pct / 100), `${item.name} LV${ilv}`)
    }
  }
})

test('【確定】防具のメリットは 重鎧＝受けるダメージ−3%／軽装＝AGI+5%（1部位ごと・デメリットなし）', () => {
  assert.equal(ARMOR_EFFECT.重鎧.takenPct, -3)
  assert.equal(ARMOR_EFFECT.軽装.agiPct, 5)
  assert.ok(!ARMOR_EFFECT.重鎧.agiPct && !ARMOR_EFFECT.軽装.takenPct, 'デメリットは付けない')
  const heavy = armorsOf('頭', '重鎧')[0], light = armorsOf('頭', '軽装')[0]
  assert.deepEqual(armorEffects([{ item: heavy, pct: 100 }, { item: heavy, pct: 100 }]), { takenPct: -6, agiPct: 0, takenMult: 0.94 })
  assert.deepEqual(armorEffects([{ item: light, pct: 100 }]), { takenPct: 0, agiPct: 5, takenMult: 1 })
  // 必要LVに足りないときは、メリットも同じ割合で弱まる
  assert.deepEqual(armorEffects([{ item: heavy, pct: 50 }]), { takenPct: -1.5, agiPct: 0, takenMult: 0.99 })
})

// ===== 戦闘用のキャラ =====
const baseProf = (over = {}) => ({ username:'t', class:'戦士', lv: 30, ...INITIAL_STATS, jobs: { 戦士: { lv: 30, exp: 0 } }, learned: [], skill_sets: {}, equipped: {}, ...over })

test('【確定】戦闘で使うのは、いまの職業の編成だけ。その職業で使えない技は入れない', () => {
  const p = baseProf({
    learned: ['体当たり', '強撃', '呪弾'],
    skill_sets: {
      戦士: [{ name:'体当たり', uses: 3 }, { name:'呪弾', uses: 2 }, { name:'強撃', uses: 1 }],   // 呪弾は前の形から紛れ込んだもの
      呪術師: [{ name:'呪弾', uses: 5 }],
    },
  })
  assert.deepEqual(toFighter(p, []).slots.map(s => [s.skill.name, s.uses]), [['体当たり', 3], ['強撃', 1]])
  const q = { ...p, class:'呪術師', jobs: { 呪術師: { lv: 1, exp: 0 } } }
  assert.deepEqual(toFighter(q, []).slots.map(s => [s.skill.name, s.uses]), [['呪弾', 5]], '転職すると、その職業の編成で戦う')
  assert.deepEqual(toFighter({ ...p, class:'銃士' }, []).slots, [], '編成の無い職業は空（他の職業の編成を使わない）')
})

test('戦闘のステ＝本体＋いまの職業のジョブのステ＋装備（必要LV不足ぶんを引く）＋軽装のAGI', () => {
  const inv = [
    { id: 1, base_id: 'w:大剣', rank: 'C', ilv: 40 },
    { id: 2, base_id: 'a:ブーツ', rank: 'C', ilv: 30 },
  ]
  const prof = baseProf({ equipped: { weapon: 1, foot: 2 } })
  const bd = statBreakdown(prof, inv)
  assert.deepEqual(bd.job, jobBonusStats('戦士', 30))
  const gearW = Math.round(powerAt(ITEM_BY_ID['w:大剣'], 'C', 40) * 50 / 100)
  const gearF = powerAt(ITEM_BY_ID['a:ブーツ'], 'C', 30)
  assert.equal(calcPower(bd.gear), gearW + gearF, 'LV30でLV40の装備＝効果50%')
  assert.equal(bd.armor.agiPct, 5)
  assert.equal(bd.armorAgi, Math.round((bd.body.agi + bd.job.agi + bd.gear.agi) * 0.05))
  assert.equal(bd.total.agi, bd.body.agi + bd.job.agi + bd.gear.agi + bd.armorAgi)
})

test('【確定】いまの職業で装備できない武器は効かない（数えない）', () => {
  const inv = [{ id: 1, base_id: 'w:長杖', rank: 'C', ilv: 30 }]
  assert.equal(Object.keys(equippedItems(baseProf({ equipped: { weapon: 1 } }), inv)).length, 0, '戦士は杖を装備できない')
  assert.equal(Object.keys(equippedItems(baseProf({ class:'魔法使い', equipped: { weapon: 1 } }), inv)).length, 1, '魔法使いはできる')
  assert.equal(canEquipType('戦士', '杖'), false)
})

test('【確定】職業補正は一旦なし（noClassBonus）。重鎧の軽減は taken、通常攻撃の種類は kind で渡す', () => {
  const inv = [1, 2, 3, 4].map(id => ({ id, base_id: ['a:鉄兜', 'a:プレートメイル', 'a:鉄の籠手', 'a:鉄靴'][id - 1], rank: 'C', ilv: 30 }))
  const f = toFighter(baseProf({ class:'薬師', jobs: { 薬師: { lv: 5, exp: 0 } }, equipped: { head: 1, body: 2, arm: 3, foot: 4 } }), inv)
  assert.equal(f.noClassBonus, true)
  assert.equal(f.kind, 'mag', '薬師の通常攻撃は魔法')
  assert.deepEqual(f.taken, { phys: 0.88, mag: 0.88 }, '重鎧4部位＝受けるダメージ−12%')
  // 今のⅡの戦闘エンジンは noClassBonus を見て職業補正を掛けない（渡さなければ従来どおり）
  const berserk = createSide({ name:'b', cls:'狂戦士', stats:{ ...INITIAL_STATS }, slots:[], noClassBonus: true })
  assert.equal(berserk.buffs.str || 0, 0)
  assert.ok((createSide({ name:'b', cls:'狂戦士', stats:{ ...INITIAL_STATS }, slots:[] }).buffs.str || 0) > 0)
})

// ===== ドロップ =====
test('【確定】武器はいまの職業が装備できる3種から落ちる。防具は重鎧と軽装の両方が落ちる', () => {
  const rng = rngOf(7)
  for (const cls of START_CLASSES) {
    for (let i = 0; i < 300; i++) {
      const w = rollBaseItem('武器', cls, rng)
      assert.ok(canEquipType(cls, w.type), `${cls}に${w.type}が落ちた`)
    }
  }
  const lines = new Set(Array.from({ length: 200 }, () => rollBaseItem('鎧', '戦士', rng).line))
  assert.deepEqual([...lines].sort(), ['軽装', '重鎧'])
  // 落ちたものはアイテムLV＝敵のLV・ランクはエリアの分布の中
  let got = 0
  for (let i = 0; i < 20000 && got < 50; i++) {
    const enc = pickEncounter(1, 0, new Date(Date.UTC(2026, 0, 1, i % 24)), rng)
    const d = rollEquipDrop(enc, '盗賊', new Date(), rng)
    if (!d) continue
    got++
    assert.equal(d.ilv, enc.lv)
    assert.ok(Object.keys(AREAS[0].dropRanks).includes(d.rank), d.rank)
  }
  assert.ok(got >= 50, 'ドロップを拾えている')
})

// ===== 敵のLV =====
test('【確定】敵は敵ごとに決まったLVを持つ（帯の中）。ボスは帯の上限', () => {
  for (const a of AREAS) {
    const [lo, hi] = TIER_LV[a.tier]
    for (const e of [...a.enemies, ...(a.timed || [])]) {
      const lv = enemyLvOf(e.name)
      assert.ok(lv >= lo && lv < hi, `${e.name} LV${lv} は ${lo}〜${hi}（ボスより下）`)
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
  const slime = AREAS[0].enemies.find(e => e.name === 'スライム')
  assert.equal(enemyPowerOf(slime), Math.round(stdPowerAt(enemyLvOf('スライム')) * 0.6))
})
