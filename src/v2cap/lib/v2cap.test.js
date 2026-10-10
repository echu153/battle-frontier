// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）の決まりを固定するテスト（node --test）
// 設計は docs/v2cap-design.md。ユーザーが決めたことは【確定】と書いてある
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower, INITIAL_STATS } from '../../v2/lib/stats.js'
import { skillValue, VALUE_TABLE, MP_TABLE, BUFF_PER_MP, HEAL_PER_MP, MPREGEN_PER_MP, SKILLS as V2_SKILLS, offClassMult } from '../../v2/lib/skills.js'
import { createSide, mpCostOf, runBattle } from '../../v2/lib/battle.js'
import {
  MAX_LV, needExp, totalExpTo, applyExp, bodyPowerAt, staminaMaxOf, NEED_PERMIL, STAMINA_RECOVER_MS, rollStamina, msToNextStamina,
  pointsForLv, totalPointsTo, POINT_UNIT, validateAllocation, applyAllocation,
} from './level.js'
import {
  CLASSES, START_CLASSES, STAGES, JOB_MAX, JOB_BONUS, JOB_LV_HPMP, jobLevelsGained, mainStatsOf, jobNeed, jobTotalTo, bonusSeqOf,
  ICHIJI_CLASSES, ICHIJI_INFO, ICHIJI_REQ_JLV, jobMaxOf, nextClassesOf, CLASS_INFO,
  bonusPointsAt, jobBonusStats, learnOrderOf, learnAtOf, skillsLearnedBy, applyJobExp,
  canBecome, weaponsOf, canEquipType, attackKindOf, lineageOf, usableSkillNames, classDescOf,
} from './jobs.js'
import { SKILLS, NEW_SKILLS, SKILL_BY_NAME, setMpCost, validateSkillSet, defaultSetOf, DEFAULT_USES_MAX, passiveOf } from './skills.js'
import { ICHIJI_SKILLS, ICHIJI_BUILDS } from './skillsIchiji.js'
import {
  ITEMS, ITEM_BY_ID, KINDS, WEAPON_TYPES, ARMOR_LINES, ARMOR_PARTS, ACCESSORY_TYPES, PART_MULT, SLOTS, ARMOR_EFFECT,
  RARITIES, RARITY_LABEL, RARITY_BASE, AREA_COUNT, itemOf, itemLabel, slotsFor, SLOT_LABEL, PARTS, partLabel, kindLabel, reqLvOf,
} from './equipment.js'
import { GEAR_NAMES } from './gearNames.js'
import { powerAt, effectPct, statsAt, armorEffects, GEAR_RATIO, SET_PART_SUM } from './gear.js'
import {
  AREA_LIST, SPOTS, SPOT_COUNT, spotOf, spotLvOf, spotLabel, expRangeOf, goldRangeOf,
  ROLE_TENTHS, scaleByRole, enemyLevels, enemyLvOf, enemyRoleOf,
  stdPowerAt, AREA_BOSS, SUB_BOSS, bossRatioOf, STD_RATIO, NORMAL_RATIO, enemyPowerOf, toFighter as enemyFighter,
} from './areas.js'
import { AREA_ROSTERS, AREA_LEVELS, ENEMY_LV } from './monsters.js'
import { toFighter, statBreakdown, equippedItems, slotsOf, currentSetOf } from './loadout.js'
import {
  rollDropKind, rollEquipDrop, pickEncounter, rollRewards, rewardRangeOf,
  openUntilOf, isSpotUnlocked, unlockedSpotsOf, clearSpot,
  DROP_CHANCE, DROP_RARITY, SUB_RARE_MULT, dropRarityOf, rollDropRarity, canDropRarity,
} from './sortie.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ===== LVとEXP =====
test('【確定】LV上限は100。必要EXPは上がるほど重くなる（MMORPG式）', () => {
  assert.equal(MAX_LV, 100)
  assert.equal(needExp(100), 0)
  for (let l = 2; l < 99; l++) assert.ok(needExp(l + 1) > needExp(l), `LV${l}→${l + 1} より LV${l + 1}→${l + 2} が重い`)
  // 必要EXP ＝ 係数 × LV³（千分率の整数で掛けてから割る＝SQLと同じ）
  for (const l of [1, 5, 10, 20, 50, 99]) assert.equal(needExp(l), Math.max(1, Math.round(NEED_PERMIL * l * l * l / 1000)))
  // 設計書§2の表（係数0.135＝tools/v2cap-progress.mjs --tune で「最後のボスの目安（365時間目）にLV100」になるよう決めた。
  //   2026-10-09 ステータスポイントにしたあとの測り直し）
  assert.deepEqual([1, 5, 10, 20, 30, 50, 70, 90, 99].map(needExp), [1, 17, 135, 1080, 3645, 16875, 46305, 98415, 130990])
})

test('【確定】LV100で止まり、あふれたEXPは捨てる。周回（LV1に戻る）は無い', () => {
  const s = applyExp({ lv: 99, exp: 0 }, needExp(99) * 3)
  assert.equal(s.lv, 100)
  assert.equal(s.exp, 0)
  assert.equal(s.points, pointsForLv(100), 'LV100に上がったぶんのポイントだけ入る')
  const again = applyExp(s, 1000000)
  assert.equal(again.lv, 100)
  assert.equal(again.levelUps.length, 0)
  assert.equal(again.points, 0, 'LV100ではもうポイントは入らない')
})

test('【確定】LVアップでステは上がらず、ステータスポイントが3（5の倍数のLVは5）入る', () => {
  // ユーザー指示「通常のレベル上がるときはステータス一切上げないで、ステータスポイント3振れるようにしよう、5の倍数は3じゃなくて5ポイントで」
  assert.deepEqual([2, 3, 4, 5, 6, 9, 10, 15, 99, 100].map(pointsForLv), [3, 3, 3, 5, 3, 3, 5, 5, 3, 5])
  assert.deepEqual([1, 2, 5, 10, 32, 100].map(totalPointsTo), [0, 3, 14, 31, 105, 337])
  const s = applyExp({ lv: 1, exp: 0, ...INITIAL_STATS }, totalExpTo(31))
  assert.equal(s.lv, 31)
  assert.equal(s.points, totalPointsTo(31), 'LV31までのポイントが入る')
  assert.deepEqual(s.levelUps.slice(0, 4).map(u => [u.lv, u.points]), [[2, 3], [3, 3], [4, 3], [5, 5]])
  assert.ok(!('stats' in s), 'ステはLVアップで変わらない（返さない）')
  // 本体の戦闘力の物差し＝初期値＋そのLVまでのポイントを全部振ったもの
  assert.equal(bodyPowerAt(1), calcPower(INITIAL_STATS))
  assert.equal(bodyPowerAt(100), calcPower(INITIAL_STATS) + 337)
})

test('【確定】ステータスポイントは8種すべてに振れる（1ポイントで HP+8・MP+3・ほか+1）。足りない・おかしい振り方は通さない', () => {
  assert.deepEqual(POINT_UNIT, { hp: 8, mp: 3, str: 1, dex: 1, agi: 1, int_stat: 1, vit: 1, luk: 1 })
  for (const k of STAT_KEYS) assert.equal(validateAllocation({ [k]: 1 }, 1), null, `${k}に振れる`)
  const after = applyAllocation(INITIAL_STATS, { hp: 2, mp: 1, str: 3 })
  assert.deepEqual([after.hp, after.mp, after.str, after.dex], [56, 15, 8, 5])
  assert.equal(calcPower(after) - calcPower(INITIAL_STATS), 6, 'どれに振っても1ポイント＝戦闘力+1')
  assert.equal(validateAllocation({ str: 4 }, 3), 'ポイントが足りません')
  assert.equal(validateAllocation({}, 3), 'ポイントを1以上振ってください')
  assert.equal(validateAllocation({ str: 0 }, 3), 'ポイントを1以上振ってください')
  assert.equal(validateAllocation({ str: -1 }, 3), '振る数は0以上の整数で指定してください')
  assert.equal(validateAllocation({ str: 1.5 }, 3), '振る数は0以上の整数で指定してください')
  assert.equal(validateAllocation({ power: 1 }, 3), 'powerには振れません')
  assert.equal(validateAllocation(null, 3), '振り方の形式が不正です')
})

// ===== エリアと場所 =====
test('【確定】15エリア×①②③の名前はユーザーの表のとおり。1本道で、ボスを倒すと次の場所が開く', () => {
  assert.equal(AREA_LIST.length, 15)
  assert.equal(SPOT_COUNT, 45)
  assert.deepEqual(AREA_LIST[0], { name:'始まりの森', spots:['木漏れ日の小径', '苔むした獣道', '森主の古樹'] })
  assert.deepEqual(AREA_LIST[14], { name:'深淵の海溝', spots:['燐光の海棚', '沈みし古都', '原初の深淵'] })
  assert.deepEqual(AREA_LIST.map(a => a.name), ['始まりの森', '荒廃した草原', '古代の洞窟', '蒼海の入り江', '灼砂の遺丘',
    '巨峰山脈', '常闇の樹海', '白銀の霊峰', '雷鳴の断崖', '煉獄火山', '腐海の沼獄', '奈落の坑道', '蒼天の浮遊城', '星霜の遺跡', '深淵の海溝'])
  assert.equal(new Set(SPOTS.map(s => s.name)).size, 45, '場所の名前は重ならない')
  assert.equal(spotLabel(2), '始まりの森② 苔むした獣道')
  // 1本道：最初は①だけ。ボスを倒した一番先の場所の次まで開く
  assert.deepEqual(unlockedSpotsOf([]), [1])
  assert.equal(isSpotUnlocked([], 2), false)
  assert.deepEqual(unlockedSpotsOf(clearSpot([], 1)), [1, 2])
  assert.equal(openUntilOf([1, 2, 3]), 4, '③のボスで次のエリアの①が開く')
  assert.equal(spotOf(4).areaName, '荒廃した草原')
  assert.equal(openUntilOf(Array.from({ length: 45 }, (_, i) => i + 1)), 45, '最後の場所より先は無い')
  assert.deepEqual(clearSpot([1, 2], 2), [1, 2], '2回倒しても増えない')
})

test('【確定】経験値とGoldは場所の表の値（始まりの森・荒廃した草原はユーザーの表・先は同じ伸び方）', () => {
  // ユーザーの表そのまま
  assert.deepEqual([1, 2, 3].map(s => expRangeOf(1, s)), [[2, 3], [2, 4], [3, 5]])
  assert.deepEqual([1, 2, 3].map(s => goldRangeOf(1, s)), [[10, 15], [10, 17], [10, 20]])
  assert.deepEqual([1, 2, 3].map(s => expRangeOf(2, s)), [[4, 5], [4, 6], [5, 7]])
  assert.deepEqual([1, 2, 3].map(s => goldRangeOf(2, s)), [[15, 20], [15, 22], [15, 25]])
  // 古代の洞窟から先は1エリアごとに 経験値+2・Gold+5（ユーザー承認）。最後は深淵の海溝
  assert.deepEqual([1, 2, 3].map(s => expRangeOf(15, s)), [[30, 31], [30, 32], [31, 33]])
  assert.deepEqual([1, 2, 3].map(s => goldRangeOf(15, s)), [[80, 85], [80, 87], [80, 90]])
  for (let i = 1; i < SPOT_COUNT; i++) {
    assert.ok(SPOTS[i].exp[0] + SPOTS[i].exp[1] >= SPOTS[i - 1].exp[0] + SPOTS[i - 1].exp[1], `${SPOTS[i].name}の経験値は前より少なくない`)
    assert.ok(SPOTS[i].gold[0] + SPOTS[i].gold[1] >= SPOTS[i - 1].gold[0] + SPOTS[i - 1].gold[1], `${SPOTS[i].name}のGoldは前より少なくない`)
  }
})

test('【確定】朝昼晩の限定の敵1.5倍・レア3倍・ボス5倍（四捨五入）', () => {
  assert.deepEqual(ROLE_TENTHS, { normal: 10, timed: 15, rare: 30, boss: 50 })
  assert.equal(scaleByRole(3, 'timed'), 5, '3×1.5＝4.5→5')
  assert.equal(scaleByRole(2, 'timed'), 3)
  assert.equal(scaleByRole(3, 'rare'), 9)
  assert.equal(scaleByRole(3, 'boss'), 15)
  assert.equal(scaleByRole(17, 'normal'), 17)
  assert.deepEqual(rewardRangeOf(spotOf(1), 'boss'), { exp: [10, 15], gold: [50, 75] })
  const rng = rngOf(4)
  for (let i = 0; i < 3000; i++) {
    const spot = SPOTS[i % SPOT_COUNT]
    const role = ['normal', 'timed', 'rare', 'boss'][i % 4]
    const r = rollRewards({ spot, role }, rng)
    const range = rewardRangeOf(spot, role)
    assert.ok(r.exp >= range.exp[0] && r.exp <= range.exp[1], `${spot.name} ${role} EXP ${r.exp}`)
    assert.ok(r.gold >= range.gold[0] && r.gold <= range.gold[1], `${spot.name} ${role} Gold ${r.gold}`)
  }
})

test('【確定】負けても経験値はその場所の最低値（朝昼晩・レア・ボスの倍率は入れない）。Goldは入らない', () => {
  for (const spot of SPOTS) {
    for (const role of ['normal', 'timed', 'rare', 'boss']) {
      assert.deepEqual(rollRewards({ spot, role }, Math.random, false), { exp: spot.exp[0], gold: 0 }, `${spotLabel(spot)} ${role}に負けた`)
    }
  }
  assert.deepEqual(rollRewards({ spot: spotOf(1), role: 'boss' }, Math.random, false), { exp: 2, gold: 0 }, '始まりの森①はボスに負けても2')
})

test('【確定】落ちる装備のレア度：エピックはレアとボスから・レジェンダリーはボスからだけ。①②③でレア以上が出やすくなる', () => {
  // 勝ったときに落ちる確率（%）と、落ちたときのレア度の内訳（2026-10-09 ユーザー承認の案）
  assert.deepEqual(DROP_CHANCE, { normal: 3, timed: 3, rare: 10, boss: 10 })
  assert.deepEqual(DROP_RARITY.normal, { N:85, R:15 })
  assert.deepEqual(DROP_RARITY.timed, { N:85, R:15 })
  assert.deepEqual(DROP_RARITY.rare, { N:50, R:35, E:15 })
  assert.deepEqual(DROP_RARITY.boss, { N:40, R:35, E:20, L:5 })
  assert.deepEqual(SUB_RARE_MULT, [1.0, 1.2, 1.4])
  for (const role of ['normal', 'timed', 'rare', 'boss']) {
    for (const sub of [1, 2, 3]) {
      const d = dropRarityOf(role, sub)
      assert.ok(Math.abs(Object.values(d).reduce((a, b) => a + b, 0) - 100) < 1e-6, `${role}の${sub}：合計100`)
      assert.ok(d.N > 0, `${role}の${sub}：ノーマルも落ちる`)
      assert.equal(!!d.E, role === 'rare' || role === 'boss', `${role}からエピック`)
      assert.equal(!!d.L, role === 'boss', `${role}からレジェンダリー`)
      if (sub > 1) assert.ok(d.N < dropRarityOf(role, sub - 1).N, `${role}：${sub}は前の場所よりノーマルが減る`)
    }
    assert.equal(canDropRarity(role, 'E'), role === 'rare' || role === 'boss')
    assert.equal(canDropRarity(role, 'L'), role === 'boss')
    assert.ok(canDropRarity(role, 'N') && canDropRarity(role, 'R'))
  }
  assert.deepEqual(dropRarityOf('boss', 3), { N: 16, R: 49, E: 28, L: 7 }, '③のボスはレア以上が1.4倍')
  assert.deepEqual(dropRarityOf('normal', 2), { N: 82, R: 18 })
  // 実際に引いても、ふつうの敵からエピック・レジェンダリーは出ない
  const rng = rngOf(7)
  for (let i = 0; i < 3000; i++) {
    assert.ok(['N', 'R'].includes(rollDropRarity('timed', 3, rng)))
    assert.notEqual(rollDropRarity('rare', 3, rng), 'L')
  }
})

test('【確定】装備の必要LV（アイテムLV）はエリアとレア度の表。必要LVが高いほど強く、同じLVならレア度が高いほど強い', () => {
  // ユーザーの表：ノーマル＝5×エリア、レア＋5・エピック＋10・レジェンダリー＋15
  assert.deepEqual(RARITIES.map(r => reqLvOf(1, r)), [5, 10, 15, 20], '始まりの森')
  assert.deepEqual(RARITIES.map(r => reqLvOf(2, r)), [10, 15, 20, 25], '荒廃した草原')
  assert.deepEqual(RARITIES.map(r => reqLvOf(15, r)), [75, 80, 85, 90], '深淵の海溝')
  for (const i of ITEMS) assert.equal(i.lv, 5 * i.area + 5 * RARITIES.indexOf(i.rarity), i.name)
  // 必要LVが高いほど強い（同じ種類・同じレア度でエリアが進むと強くなる）
  for (const r of RARITIES) {
    for (let a = 1; a < AREA_COUNT; a++) assert.ok(powerAt(itemOf(a + 1, r, '片手剣'), reqLvOf(a + 1, r)) > powerAt(itemOf(a, r, '片手剣'), reqLvOf(a, r)), `${r} エリア${a + 1}`)
  }
  // 例：ノーマルのLV20（蒼海の入り江）より、レジェンダリーのLV20（始まりの森）が強い（ユーザーの例）
  const n20 = itemOf(4, 'N', '片手剣'), l20 = itemOf(1, 'L', '片手剣')
  assert.deepEqual([n20.lv, l20.lv], [20, 20])
  assert.ok(powerAt(l20, l20.lv) > powerAt(n20, n20.lv), 'LV20どうしならレジェンダリーのほうが強い')
  assert.ok(Math.abs(powerAt(l20, 20) / powerAt(n20, 20) - 1.75) < 0.05, 'レジェンダリーはノーマルの1.75倍')
})

test('【確定】スタミナは3分に1回復・最大値はLVが1上がるごとに+1（LV1で10）', () => {
  assert.equal(staminaMaxOf(1), 10)
  assert.equal(staminaMaxOf(2), 11)
  assert.equal(staminaMaxOf(5), 14)
  assert.equal(staminaMaxOf(100), 109)
  for (let l = 1; l < 100; l++) assert.equal(staminaMaxOf(l + 1) - staminaMaxOf(l), 1)
  assert.equal(STAMINA_RECOVER_MS, 3 * 60 * 1000)
  const t0 = Date.UTC(2026, 0, 1)
  assert.equal(rollStamina(0, t0, 10, t0 + 2 * 60 * 1000 + 59 * 1000).n, 0, '2分59秒ではまだ')
  assert.equal(rollStamina(0, t0, 10, t0 + 3 * 60 * 1000).n, 1, '3分で1')
  assert.equal(rollStamina(0, t0, 10, t0 + 30 * 60 * 1000).n, 10, '30分で10（上限まで）')
  assert.equal(msToNextStamina(0, t0, 10, t0 + 60 * 1000), 2 * 60 * 1000, '次まで2分')
})

// ===== 職業 =====
test('【確定】初期職は11職（剣士を足した）。装備できる武器は職業ごとに3〜4種（ユーザーの表のとおり）', () => {
  // 並びは剣士が先頭（2026-10-11 ユーザー指示「剣士の位置は一番上にして」）＝キャラ作成と神殿の並び
  assert.deepEqual(START_CLASSES, ['剣士', '戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師'])
  // 2026-10-09 ユーザー決定：刀は戦士・盗賊・剣士、宝珠は魔法使い・呪術師・僧侶。剣士は刀・片手剣・両手剣
  const table = {
    戦士: ['両手剣', '斧', '鈍器', '刀'], 槍使い: ['槍', '片手剣', '投擲'], 格闘家: ['拳', '鈍器', '杖'],
    盗賊: ['短剣', '片手剣', '投擲', '刀'], 弓使い: ['弓', '短剣', '片手剣'], 銃士: ['銃', '片手剣', '投擲'],
    剣士: ['刀', '片手剣', '両手剣'],
    魔法使い: ['杖', '書', '短剣', '宝珠'], 呪術師: ['杖', '短剣', '投擲', '宝珠'], 僧侶: ['鈍器', '杖', '書', '宝珠'], 薬師: ['短剣', '投擲', '書'],
  }
  assert.deepEqual(Object.keys(table).sort(), [...START_CLASSES].sort())
  for (const [cls, list] of Object.entries(table)) assert.deepEqual(weaponsOf(cls), list, `${cls}の武器`)
  for (const list of Object.values(table)) for (const w of list) assert.ok(WEAPON_TYPES.includes(w), `${w}は14種にある`)
  // どの武器も、装備できる職業が1つ以上いる（拾っても誰も使えない武器が無い）
  for (const w of WEAPON_TYPES) assert.ok(Object.values(table).some(list => list.includes(w)), `${w}を装備できる職業がいる`)
})

test('【確定】ノーブル・サモナーはなくした。初期職11職は条件なし', () => {
  for (const id of ['ノーブル', 'サモナー', '侍', '聖職者', '賢者']) assert.ok(!CLASSES.some(c => c.id === id), `${id}は無い`)
  const shoki = CLASSES.filter(c => c.stage === 'shoki')
  assert.deepEqual(shoki.map(c => c.id), START_CLASSES)
  for (const c of shoki) { assert.equal(c.req, null); assert.equal(canBecome(c.id, {}), true, `${c.id}は条件なし`) }
})

test('【確定】一次職は20職（ユーザーの表「一次職スキル一覧」）：系統の初期職のClassLV30で就ける・上限50・必要ClassEXP3倍・ステ6点・武器は系統の初期職と同じ', () => {
  // 2026-10-10 ユーザー決定（転職の条件・ClassLV上限50・必要ClassEXP3倍・クラスのステはClassLV30で初期職の1.2倍・武器）
  assert.deepEqual(Object.keys(STAGES), ['shoki', 'ichiji'])
  assert.deepEqual([STAGES.shoki.max, STAGES.ichiji.max], [30, 50])
  assert.deepEqual([STAGES.ichiji.mult, STAGES.ichiji.perLv], [3, 6])
  assert.equal(STAGES.ichiji.perLv * 29, Math.round(STAGES.shoki.perLv * 29 * 1.2), 'ClassLV30で初期職の1.2倍')
  assert.deepEqual(STAGES.ichiji.learnAt, [1, 5, 10, 15, 20, 25, 30, 40])
  assert.equal(CLASSES.length, 31)
  assert.deepEqual(ICHIJI_CLASSES, ['狂戦士', '重戦士', '竜騎士', '槍術士', '体術師', '気功師', '暗殺者', '忍者', '狩人', '狙撃手',
    '魔銃士', '砲撃士', '魔導士', '時魔導士', '死霊術師', '陰陽師', '司祭', '祓魔師', '錬金術師', '霊薬師'])
  // 系統（初期職10系統に2職ずつ・剣士系はあとでユーザーが足す）
  const bases = ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師']
  for (const b of bases) assert.equal(nextClassesOf(b).length, 2, `${b}から就ける一次職は2つ`)
  assert.deepEqual(nextClassesOf('剣士'), [], '剣士系はまだ無い')
  for (const id of ICHIJI_CLASSES) {
    const c = CLASSES.find(x => x.id === id)
    const base = ICHIJI_INFO[id].base
    assert.equal(c.stage, 'ichiji')
    assert.deepEqual(c.req, { cls: base, jlv: ICHIJI_REQ_JLV })
    assert.deepEqual(c.weapons, CLASS_INFO[base].weapons, `${id}の武器は${base}と同じ`)
    assert.equal(c.kind, CLASS_INFO[base].kind)
    assert.equal(jobMaxOf(id), 50)
    assert.deepEqual(lineageOf(id), [id, base], `${id}は${base}の技も使える`)
    assert.equal(canBecome(id, {}), false)
    assert.equal(canBecome(id, { [base]: { lv: 29 } }), false)
    assert.equal(canBecome(id, { [base]: { lv: 30 } }), true)
  }
  // 必要ClassEXP：初期職の3倍・ClassLV50で0
  assert.equal(jobNeed('ichiji', 10), 3 * jobNeed('shoki', 10))
  assert.equal(jobNeed('ichiji', 49) > 0 && jobNeed('ichiji', 50), 0)
  assert.equal(jobNeed('shoki', 30), 0)
  assert.equal(jobTotalTo('ichiji', 50), 533610)
  // ClassEXPを入れると50で止まる
  const r = applyJobExp({}, '狂戦士', jobTotalTo('ichiji', 50) + 99999, [])
  assert.deepEqual([r.lv, r.exp], [50, 0])
  assert.equal(r.learned.length, 8, 'ClassLV50で8つ全部')
})

test('通常攻撃は 槍使い・盗賊・銃士・戦士・格闘家・弓使い・剣士＝物理／魔法使い・呪術師・僧侶・薬師＝魔法', () => {
  for (const c of ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '剣士']) assert.equal(attackKindOf(c), 'phys', c)
  for (const c of ['魔法使い', '呪術師', '僧侶', '薬師']) assert.equal(attackKindOf(c), 'mag', c)
})

test('【確定】ClassLVは最大30。初期職のClassLV30まで＝LV33のころに入っているEXP（目安は14時間）', () => {
  assert.equal(JOB_MAX, 30)
  assert.equal(jobNeed('shoki', 30), 0)
  const total = jobTotalTo('shoki', 30)
  // 係数4.4（tools/v2cap-progress.mjs --tune の後半4回の平均・2026-10-09 ステータスポイントにしたあと）
  assert.equal(total, 37642)
  assert.ok(total >= totalExpTo(33) && total < totalExpTo(34), `初期職の合計 ${total} はLV33〜34のあいだ`)
})

test('【確定】クラスのステはClassLVが1上がるごとに初期職5点（ClassLV30で145点）・一次職6点（ClassLV50で294点）。職業ごとに2〜3種が高く、ほかは低め', () => {
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    assert.ok(w, `${c.id}の配分がある`)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    const total = c.stage === 'ichiji' ? 294 : 145
    assert.equal(sum, total, `${c.id}の合計（上限のClassLVで${total}点）`)
    // 2〜3種が高い（初期職30点以上・一次職61点以上＝同じ割合）・ほかはそれより低い・尖りすぎない（1種で半分を超えない）
    const vals = Object.values(w).sort((a, b) => b - a)
    const high = vals.filter(v => v >= (c.stage === 'ichiji' ? 61 : 30)).length
    assert.ok(high >= 2 && high <= 3, `${c.id}：高いのは${high}種`)
    assert.ok(vals[0] <= total / 2, `${c.id}：1種に寄りすぎない`)
    const seq = bonusSeqOf(c.id)
    assert.equal(seq.length, sum)
    for (const [k, v] of Object.entries(w)) assert.equal(seq.filter(x => x === k).length, v, `${c.id}の${k}`)
    // 上限のClassLVでのステ＝配分の点数 ＋ 毎回のHP・MP（JOB_LV_HPMP）× 上がった回数
    const full = jobBonusStats(c.id, jobMaxOf(c.id))
    const ups = jobMaxOf(c.id) - 1
    const extra = { hp: JOB_LV_HPMP[c.id].hp * ups, mp: JOB_LV_HPMP[c.id].mp * ups }
    for (const k of STAT_KEYS) assert.equal(full[k], (w[k] || 0) * STAT_DEFS[k].unit + (extra[k] || 0), `${c.id}の${k}`)
    assert.equal(calcPower(jobBonusStats(c.id, 1)), 0, 'ClassLV1ではまだ何も上がっていない')
    assert.equal(bonusPointsAt(c.id, jobMaxOf(c.id)), sum)
    assert.equal(bonusPointsAt(c.id, 99), sum, '上限より上は増えない')
    // どこで止めても配分どおりに近い（1つのステへ偏らない）
    for (let n = 1; n <= sum; n++) {
      for (const [k, v] of Object.entries(w)) {
        const got = seq.slice(0, n).filter(x => x === k).length
        assert.ok(Math.abs(got - v * n / sum) <= 1.0001, `${c.id} ${n}点目の${k}`)
      }
    }
  }
})

test('【確定】ClassLVが上がるたびに、どの職業でも必ずHPとMPが上がる（点数とは別・職業ごとの量＝ユーザー承認の表）', () => {
  // 2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいいから」
  assert.deepEqual(Object.keys(JOB_LV_HPMP).sort(), CLASSES.map(c => c.id).sort(), '全職業ぶんある')
  const want = {
    戦士: [8, 1], 槍使い: [6, 1], 格闘家: [8, 1], 盗賊: [4, 1], 弓使い: [4, 1], 銃士: [4, 1], 剣士: [6, 1],
    魔法使い: [6, 3], 呪術師: [4, 3], 僧侶: [8, 3], 薬師: [8, 3],
    狂戦士: [10, 2], 重戦士: [10, 2], 竜騎士: [8, 2], 槍術士: [6, 2], 体術師: [8, 2], 気功師: [8, 3],
    暗殺者: [6, 2], 忍者: [6, 2], 狩人: [6, 2], 狙撃手: [6, 2], 魔銃士: [6, 3], 砲撃士: [8, 3],
    魔導士: [6, 4], 時魔導士: [6, 4], 死霊術師: [8, 4], 陰陽師: [6, 4], 司祭: [10, 4], 祓魔師: [8, 4], 錬金術師: [8, 4], 霊薬師: [10, 4],
  }
  for (const [cls, [hp, mp]] of Object.entries(want)) assert.deepEqual(JOB_LV_HPMP[cls], { hp, mp }, cls)
  for (const c of CLASSES) {
    // 1回ずつ見て、HPとMPが必ず上がっている（点数の配りでHP・MPに当たった回はそのぶんも上乗せ）
    for (let j = 2; j <= jobMaxOf(c.id); j++) {
      const a = jobBonusStats(c.id, j - 1), b = jobBonusStats(c.id, j)
      assert.ok(b.hp - a.hp >= JOB_LV_HPMP[c.id].hp, `${c.id} ClassLV${j}でHPが上がる`)
      assert.ok(b.mp - a.mp >= JOB_LV_HPMP[c.id].mp, `${c.id} ClassLV${j}でMPが上がる`)
    }
    // 点数（5点・6点）はそのまま（毎回のHP・MPは別に足す）
    assert.equal(bonusPointsAt(c.id, jobMaxOf(c.id)), STAGES[c.stage].perLv * (jobMaxOf(c.id) - 1))
    assert.equal(jobLevelsGained(c.id, 1), 0)
    assert.equal(jobLevelsGained(c.id, 99), jobMaxOf(c.id) - 1, '上限より上は増えない')
  }
  // ユーザーに見せた例（上限のClassLVでの合計）
  assert.deepEqual([jobBonusStats('戦士', 30).hp, jobBonusStats('戦士', 30).mp], [456, 59])
  assert.deepEqual([jobBonusStats('魔法使い', 30).hp, jobBonusStats('魔法使い', 30).mp], [294, 177])
  assert.deepEqual([jobBonusStats('司祭', 50).hp, jobBonusStats('司祭', 50).mp], [1050, 331])
})

test('神殿の「上がりやすいステータス」は配分の高い2〜3種（多い順）。例：戦士＝STR・VIT', () => {
  for (const c of CLASSES) {
    const m = mainStatsOf(c.id)
    assert.ok(m.length >= 2 && m.length <= 3, `${c.id}：${m.join('・')}`)
    const w = JOB_BONUS[c.id]
    for (let i = 1; i < m.length; i++) assert.ok(w[m[i - 1]] >= w[m[i]], `${c.id}は多い順`)
  }
  assert.deepEqual(mainStatsOf('戦士'), ['str', 'vit'])
  assert.deepEqual(mainStatsOf('銃士'), ['dex', 'agi'])
  assert.deepEqual(mainStatsOf('魔法使い'), ['int_stat', 'mp'])
  assert.deepEqual(mainStatsOf('ない職業'), [])
})

test('【確定】キャラ作成と神殿に出す特徴の説明が全職ぶんある（カードに収まる長さ）。スキル名・ステータス名は書かない', () => {
  // 2026-10-11 ユーザー指示「説明文は具体的なスキル名やステータス名を記載しないで、どういった特徴があるのかだけを簡単にまとめて」
  const skillNames = [...new Set(SKILLS.map(s => s.name))]
  const statWords = STAT_KEYS.flatMap(k => [STAT_DEFS[k].label, STAT_DEFS[k].jp]).filter(Boolean)
  for (const c of CLASSES) {
    const d = classDescOf(c.id)
    assert.ok(d, `${c.id}の説明がある`)
    assert.ok(d.length <= 40, `${c.id}の説明は40字まで（${d.length}字）`)
    for (const n of skillNames) assert.ok(!d.includes(n), `${c.id}の説明にスキル名「${n}」が入っている`)
    for (const w of statWords) assert.ok(!d.includes(w), `${c.id}の説明にステータス名「${w}」が入っている`)
  }
})

// ===== スキル =====
test('スキルは初期職ClassLV 1／5／10／15／20 で5個・一次職ClassLV 1／5／10／15／20／25／30／40 で8個', () => {
  assert.deepEqual(STAGES.shoki.learnAt, [1, 5, 10, 15, 20])
  for (const c of CLASSES) {
    const n = c.stage === 'ichiji' ? 8 : 5
    assert.equal(learnOrderOf(c.id).length, learnAtOf(c.id).length, `${c.id}のスキル数`)
    assert.equal(learnOrderOf(c.id).length, n)
    assert.equal(skillsLearnedBy(c.id, 1).length, 1, `${c.id}はClassLV1で1つ`)
    assert.equal(skillsLearnedBy(c.id, jobMaxOf(c.id)).length, n, `${c.id}は上限のClassLVで全部`)
  }
  assert.equal(skillsLearnedBy('狂戦士', 39).length, 7, 'ClassLV40の技は40で覚える')
  const r = applyJobExp({}, '戦士', jobTotalTo('shoki', 30) + 999999, ['体当たり'])
  assert.equal(r.lv, 30)
  assert.equal(r.exp, 0)
  assert.deepEqual(r.learned, ['強撃', '防御崩し', '防御態勢', 'シールドアタック'])
})

test('【確定】戦士・弓使い・魔法使い・僧侶・格闘家のスキルは今のⅡのまま（中身も並びも同じ）', () => {
  for (const cls of ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']) {
    const v2 = V2_SKILLS.filter(s => s.cls === cls)
    // ★魔法の属性（elem）だけはこの版の写しに付けている（魔導士の元素共鳴が見る・2026-10-10）。それ以外は同じ
    const noElem = (s) => { const { elem: _e, ...rest } = s; return rest }
    assert.deepEqual(learnOrderOf(cls).map(noElem), v2, `${cls}`)
  }
  assert.deepEqual(['ファイア', 'サンダー', 'アイスランス'].map(n => SKILL_BY_NAME[n].elem), ['fire', 'thunder', 'ice'])
  assert.ok(V2_SKILLS.every(s => !('elem' in s)), '今のⅡの名簿は書き換えていない')
})

test('【確定】一次職の技はユーザーの表「一次職スキル一覧」のとおり（各職8技＋パッシブ1つ・組み方の例2つ）', () => {
  assert.equal(ICHIJI_SKILLS.length, 180)
  for (const id of ICHIJI_CLASSES) {
    const mine = ICHIJI_SKILLS.filter(x => x.cls === id)
    assert.equal(mine.filter(x => x.kind === 'passive').length, 1, `${id}のパッシブは1つ`)
    assert.equal(mine.filter(x => x.kind !== 'passive').length, 8, `${id}の技は8つ`)
    assert.equal(passiveOf(id)?.cls, id)
    for (const x of mine) {
      assert.ok(x.desc, `${x.name}の説明`)
      if (x.kind !== 'passive') assert.ok(x.mp > 0 && x.proc >= 70 && x.proc <= 100, `${x.name}の消費MP・発動率`)
    }
    assert.equal(ICHIJI_BUILDS[id].length, 2, `${id}の組み方の例は2つ`)
    for (const b of ICHIJI_BUILDS[id]) {
      assert.equal(b.length, 5)
      for (const n of b) assert.equal(SKILL_BY_NAME[n]?.cls, id, `${id}の組み方の${n}は${id}の技`)
    }
  }
  // 表の値（抜き出して固定）。並び＝覚える順（ClassLV1／5／10／15／20／25／30／40）
  assert.deepEqual(learnOrderOf('狂戦士').map(x => [x.name, x.mp, x.proc]), [
    ['マッドラッシュ', 6, 95], ['血風斬', 12, 85], ['狂乱の咆哮', 10, 100], ['ブラッドスプラッシュ', 11, 88],
    ['狂撃', 14, 85], ['ブラッディロア', 14, 100], ['血の誓い', 10, 100], ['フルブレイカー', 22, 80]])
  assert.deepEqual(learnOrderOf('霊薬師').map(x => x.name), ['霊薬瓶', '剛力薬', '叡智の薬', '鉄身薬', '再生薬', '霊薬', '薬効解放', '仙丹'])
  assert.deepEqual([SKILL_BY_NAME['カタストロフ'].mult, SKILL_BY_NAME['カタストロフ'].mp, SKILL_BY_NAME['カタストロフ'].proc], [2.6, 28, 70])
  assert.deepEqual(SKILL_BY_NAME['マナショット'].hybrid, { phys:1.2, mag:1.2 })
  assert.equal(passiveOf('狂戦士').name, 'バーサク')
  assert.equal(passiveOf('戦士'), null, '初期職にパッシブは無い')
  // 今のⅡと同じ名前の技がある（表の「過去作の名前も引き継ぐ」）。この版の名簿の中では重ならない
  assert.equal(new Set(SKILLS.map(x => x.name)).size, SKILLS.length)
  assert.equal(SKILL_BY_NAME['マッドラッシュ'].cls, '狂戦士')
  assert.equal(SKILL_BY_NAME['マッドラッシュ'].mult, 1.45, 'この版の中身（表の値）')
})

test('【確定】新しい6職（槍使い・盗賊・銃士・剣士・呪術師・薬師）の30技は、今のⅡの初期職と同じ帯（価値・消費MP）', () => {
  assert.equal(NEW_SKILLS.length, 30)
  const band = (t, proc) => { const ks = Object.keys(t).map(Number).sort((a, b) => b - a); return t[ks.find(k => proc >= k) ?? ks[ks.length - 1]] }
  for (const s of NEW_SKILLS) {
    assert.ok(['槍使い', '盗賊', '銃士', '剣士', '呪術師', '薬師'].includes(s.cls), s.name)
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
  for (const c of CLASSES) assert.deepEqual(lineageOf(c.id), c.req ? [c.id, c.req.cls] : [c.id], `${c.id}：自分（一次職は系統の初期職も）`)
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
  // ClassLV1の技1つ。回数は最大MPに収まるだけ（1枠最大5回）
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
test('【確定】装備はエリアごとに26点（武器14種・重鎧4部位・軽装4部位・装飾品4種）× レア度4段階。名前はユーザーの表', () => {
  // 刀・宝珠は 2026-10-09 に足した（後ろに足したので前からある装備のIDは変わらない）
  assert.deepEqual(WEAPON_TYPES, ['片手剣', '両手剣', '斧', '槍', '鈍器', '短剣', '拳', '弓', '銃', '杖', '書', '投擲', '刀', '宝珠'])
  assert.deepEqual(ARMOR_LINES, ['重鎧', '軽装'])
  assert.deepEqual(ACCESSORY_TYPES, ['リング', 'イヤリング', 'ベルト', 'ネックレス'])
  assert.deepEqual(RARITIES, ['N', 'R', 'E', 'L'])
  assert.deepEqual(RARITY_LABEL, { N:'ノーマル', R:'レア', E:'エピック', L:'レジェンダリー' })
  assert.equal(KINDS.length, 26)
  assert.equal(AREA_COUNT, AREA_LIST.length)
  assert.equal(ITEMS.length, AREA_LIST.length * 4 * 26)
  assert.equal(new Set(ITEMS.map(i => i.id)).size, ITEMS.length, 'IDは重複しない')
  assert.equal(new Set(ITEMS.map(i => i.name)).size, ITEMS.length, '名前も重複しない')
  assert.ok(!ITEMS.some(i => i.name.includes('盾') || i.type === '盾'), '盾は無い')
  for (let area = 1; area <= AREA_COUNT; area++) {
    for (const r of RARITIES) {
      const list = ITEMS.filter(i => i.area === area && i.rarity === r)
      assert.equal(list.length, 26, `エリア${area}の${RARITY_LABEL[r]}は26点`)
      assert.equal(list.filter(i => i.part === '武器').length, 14)
      for (const line of ARMOR_LINES) assert.equal(list.filter(i => i.line === line).length, 4, `${line}は4部位`)
      assert.equal(list.filter(i => i.part === 'アクセ').length, 4)
    }
  }
  for (const r of RARITIES) for (const k of KINDS) assert.equal(GEAR_NAMES[r][k.key].length, AREA_COUNT, `${r}の${k.key}は15エリアぶん`)
  // 名前はユーザーの表のとおり（いくつか抜き出して固定）
  assert.equal(itemOf(1, 'N', '片手剣').name, 'ブロンズソード')
  assert.equal(itemOf(1, 'R', '片手剣').name, '若葉の剣')
  assert.equal(itemOf(1, 'E', '片手剣').name, '翠玉剣ジェイド')
  assert.equal(itemOf(1, 'L', '片手剣').name, '原初剣アルファ')
  assert.equal(itemOf(15, 'L', '片手剣').name, '終焉剣オメガ')
  assert.equal(itemOf(15, 'L', '書').name, '終わりの物語')
  assert.equal(itemOf(1, 'N', '銃').name, 'マッチロック')
  assert.equal(itemOf(8, 'N', '弓').name, 'ミスリルボウ')
  assert.equal(itemOf(15, 'N', '書').name, '創世記')
  assert.equal(itemOf(2, 'R', '軽装頭').name, 'ウルフハイドフード')
  assert.equal(itemOf(1, 'E', '斧').name, '女王蟻の大顎')
  // 刀・宝珠（ユーザーの表「追加武器種（刀・宝珠）」）。始まりの森の初太刀と深淵の海溝の終の太刀が対
  assert.equal(itemOf(1, 'N', '刀').name, 'ブロンズカタナ')
  assert.equal(itemOf(1, 'R', '刀').name, '苔むした古刀')
  assert.equal(itemOf(1, 'L', '刀').name, '初太刀')
  assert.equal(itemOf(15, 'L', '刀').name, '終の太刀')
  assert.equal(itemOf(1, 'N', '宝珠').name, 'グラスオーブ')
  assert.equal(itemOf(8, 'N', '宝珠').name, 'ムーンストーンオーブ')
  assert.equal(itemOf(10, 'L', '宝珠').name, '賢者の石')
  assert.equal(itemOf(15, 'E', '宝珠').name, 'クラーケンの墨珠')
  // 宝珠のノーマルは装飾品と同じ宝石（始まりの森だけグラス）・刀のノーマルは片手剣と同じ金属
  for (let a = 2; a <= AREA_COUNT; a++) assert.equal(itemOf(a, 'N', '宝珠').name.replace('オーブ', ''), itemOf(a, 'N', 'リング').name.replace('リング', ''), `エリア${a}の宝珠の宝石`)
  for (let a = 1; a <= AREA_COUNT; a++) assert.equal(itemOf(a, 'N', '刀').name.replace('カタナ', ''), itemOf(a, 'N', '片手剣').name.replace('ソード', ''), `エリア${a}の刀の金属`)
  // 画面の名前：ノーマルは名前だけ、ほかはレア度を頭に付ける
  assert.equal(itemLabel(itemOf(1, 'N', '片手剣')), 'ブロンズソード')
  assert.equal(itemLabel(itemOf(1, 'R', '片手剣')), '【レア】若葉の剣')
  assert.equal(itemLabel(itemOf(1, 'L', '片手剣')), '【レジェンダリー】原初剣アルファ')
})

test('【確定】配分は種類ごとに1つ（エリアとレア度では変わらない）。物理と魔法の両方が使う種類は間の配分', () => {
  for (const i of ITEMS) {
    assert.equal(Object.values(i.dist).reduce((a, b) => a + b, 0), 100, `${i.name}の配分の合計`)
    assert.ok(!('hp' in i.dist) && !('mp' in i.dist) && !('luk' in i.dist), `${i.name}：HP・MP・LUKは載せない`)
    assert.equal(i.dist, itemOf(1, 'N', i.kind).dist, `${i.name}はエリア1のノーマルと同じ配分`)
  }
  // 物理職だけが使う種類にINTは載せない・魔法職だけの種類にSTRは載せない・両方が使う種類はSTRとINTの両方を持つ
  for (const t of WEAPON_TYPES) {
    const users = CLASSES.filter(c => c.weapons.includes(t))
    assert.ok(users.length > 0, `${t}を使う職業がいる`)
    const phys = users.some(c => c.kind === 'phys'), mag = users.some(c => c.kind === 'mag')
    const d = itemOf(1, 'N', t).dist
    if (phys && mag) assert.ok(d.str > 0 && d.int_stat > 0, `${t}は物理と魔法の両方`)
    else if (phys) assert.ok(!d.int_stat, `${t}は物理だけ`)
    else assert.ok(!d.str, `${t}は魔法だけ`)
  }
  // 防具はどの職業も着けるので、STRとINTを同じだけ
  for (const line of ARMOR_LINES) for (const p of ARMOR_PARTS) {
    const d = itemOf(1, 'N', `${line}${p}`).dist
    assert.ok(d.str > 0 && d.str === d.int_stat, `${line}・${p}はSTRとINTを同じだけ`)
  }
})

test('【確定】刀＝STR60・AGI25・DEX15、宝珠＝INT40・AGI30・VIT30（2026-10-09 ユーザー決定・特別な効果は付けない）', () => {
  assert.deepEqual(itemOf(1, 'N', '刀').dist, { str:60, agi:25, dex:15 })
  assert.deepEqual(itemOf(1, 'N', '宝珠').dist, { int_stat:40, agi:30, vit:30 })
  // 強さ（戦闘力）はほかの武器と同じ物差し（部位の倍率は武器2.0・レア度と必要LVで決まる）
  for (const r of RARITIES) assert.equal(powerAt(itemOf(5, r, '刀'), 50), powerAt(itemOf(5, r, '片手剣'), 50), `${r}の刀と片手剣は同じ戦闘力`)
  for (const r of RARITIES) assert.equal(powerAt(itemOf(5, r, '宝珠'), 50), powerAt(itemOf(5, r, '杖'), 50), `${r}の宝珠と杖は同じ戦闘力`)
  // 宝珠のINTは杖より控えめ（ドキュメントの「杖より威力は控えめ」）
  assert.ok(itemOf(1, 'N', '宝珠').dist.int_stat < itemOf(1, 'N', '杖').dist.int_stat)
})

test('【確定】剣士（2026-10-09 ユーザー承認）：物理・刀／片手剣／両手剣・STR40 DEX32 AGI30・技5つ', () => {
  assert.equal(attackKindOf('剣士'), 'phys')
  assert.deepEqual(weaponsOf('剣士'), ['刀', '片手剣', '両手剣'])
  assert.deepEqual(JOB_BONUS.剣士, { str:40, dex:32, agi:30, vit:15, hp:13, mp:10, luk:5 })
  // 説明文は 2026-10-11 ユーザー指示「具体的なスキル名やステータス名を記載しないで」で書き直した（前は承認済みの「STR・DEX・AGIがそろって…燕返しと兜割りで斬り崩す」）
  assert.equal(classDescOf('剣士'), '鋭い剣さばきで、攻めと身のこなしを両立する')
  assert.deepEqual(learnOrderOf('剣士').map(s => s.name), ['袈裟斬り', '燕返し', '兜割り', '一閃', '剣の構え'])
  const by = Object.fromEntries(learnOrderOf('剣士').map(s => [s.name, s]))
  assert.equal(by.燕返し.hits, 2)
  assert.equal(by.兜割り.defPen, 0.3)
  assert.deepEqual(by.一閃.ail, { key:'bleed', chance:40 })
  assert.deepEqual(by.剣の構え.buff, { self:{ str:10, dex:9, agi:8 } })
})

test('【確定】武器は1本だけ。枠は7つ（武器・頭・鎧・腕・足・装飾品2）', () => {
  assert.deepEqual(SLOTS, ['weapon', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2'])
  for (const i of ITEMS) assert.ok(slotsFor(i).length >= 1, i.name)
  assert.deepEqual(slotsFor(itemOf(1, 'N', '両手剣')), ['weapon'], '両手剣も武器の枠1つ')
  assert.deepEqual(slotsFor(itemOf(1, 'N', 'リング')), ['acc1', 'acc2'])
  assert.deepEqual(slotsFor(itemOf(1, 'N', '軽装足')), ['foot'])
  assert.equal(PART_MULT.武器, 2.0)
  const sum = PART_MULT.武器 + PART_MULT.頭 + PART_MULT.鎧 + PART_MULT.腕 + PART_MULT.足 + PART_MULT.アクセ * 2
  assert.ok(Math.abs(sum - SET_PART_SUM) < 1e-9, `7枠の倍率の合計 ${sum}`)
})

test('【確定】強さはレア度で決まる（ノーマル1.0／レア1.25／エピック1.5／レジェンダリー1.75）。ノーマルを全部そろえると本体と同じくらい', () => {
  assert.equal(GEAR_RATIO, 1)
  assert.deepEqual(RARITY_BASE, { N:40, R:50, E:60, L:70 })
  const set = (r) => ['片手剣', '重鎧頭', '重鎧鎧', '重鎧腕', '重鎧足', 'リング', 'リング'].map(k => itemOf(3, r, k))
  for (const lv of [20, 50, 100]) {
    const sum = (r) => set(r).reduce((t, it) => t + powerAt(it, lv), 0)
    assert.ok(Math.abs(sum('N') - bodyPowerAt(lv)) / bodyPowerAt(lv) < 0.03, `LV${lv}：ノーマル${sum('N')} ≒ 本体${bodyPowerAt(lv)}`)
    for (const [r, m] of [['R', 1.25], ['E', 1.5], ['L', 1.75]]) {
      // 1つずつ整数に丸めるので、LVが低いほど少しずれる（LV20で±3%）
      assert.ok(Math.abs(sum(r) / sum('N') - m) < 0.04, `LV${lv}：${RARITY_LABEL[r]}はノーマルの${m}倍（${sum(r)}）`)
    }
  }
})

test('【確定】必要LVに足りないと、不足1LVごとに効果-5%・下げ幅は最大90%', () => {
  assert.equal(effectPct(10, 10), 100)
  assert.equal(effectPct(5, 10), 100, '足りていれば100%')
  assert.equal(effectPct(11, 10), 95)
  assert.equal(effectPct(20, 10), 50)
  assert.equal(effectPct(28, 10), 10)
  assert.equal(effectPct(100, 1), 10, 'どれだけ足りなくても10%は残る')
  for (const item of ITEMS.filter(i => i.area === 1 || i.rarity === 'L')) {
    for (const [ilv, pct] of [[1, 100], [37, 100], [80, 55], [100, 10]]) {
      const s = statsAt(item, ilv, pct)
      assert.equal(Object.values(s).reduce((a, b) => a + b, 0), Math.round(powerAt(item, ilv) * pct / 100), `${item.name} LV${ilv}`)
    }
  }
})

test('【確定】画面では「アクセ」ではなく「装飾品」と出す（内部の部位名はアクセのまま）', () => {
  assert.equal(SLOT_LABEL.acc1, '装飾品①')
  assert.equal(SLOT_LABEL.acc2, '装飾品②')
  assert.equal(partLabel('アクセ'), '装飾品')
  for (const i of ITEMS.filter(x => x.part === 'アクセ')) assert.equal(kindLabel(i), '装飾品', i.name)
  for (const part of PARTS) assert.ok(!partLabel(part).includes('アクセ'), `${part}の表示`)
  assert.ok(!Object.values(SLOT_LABEL).some(l => l.includes('アクセ')), '枠の名前にアクセが残っていない')
})

test('【確定】防具のメリットは 重鎧＝受けるダメージ−3%／軽装＝AGI+5%（1部位ごと・デメリットなし）', () => {
  assert.equal(ARMOR_EFFECT.重鎧.takenPct, -3)
  assert.equal(ARMOR_EFFECT.軽装.agiPct, 5)
  assert.ok(!ARMOR_EFFECT.重鎧.agiPct && !ARMOR_EFFECT.軽装.takenPct, 'デメリットは付けない')
  const heavy = itemOf(1, 'N', '重鎧頭'), light = itemOf(1, 'N', '軽装頭')
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

test('戦闘のステ＝本体＋いまの職業のクラスのステ＋装備（必要LV不足ぶんを引く）＋軽装のAGI', () => {
  const inv = [
    { id: 1, base_id: '3N:両手剣', ilv: 40 },
    { id: 2, base_id: '3R:軽装足', ilv: 30 },
  ]
  const prof = baseProf({ equipped: { weapon: 1, foot: 2 } })
  const bd = statBreakdown(prof, inv)
  assert.deepEqual(bd.job, jobBonusStats('戦士', 30))
  const gearW = Math.round(powerAt(ITEM_BY_ID['3N:両手剣'], 40) * 50 / 100)
  const gearF = powerAt(ITEM_BY_ID['3R:軽装足'], 30)
  assert.equal(calcPower(bd.gear), gearW + gearF, 'LV30でLV40の装備＝効果50%')
  assert.equal(bd.armor.agiPct, 5)
  assert.equal(bd.armorAgi, Math.round((bd.body.agi + bd.job.agi + bd.gear.agi) * 0.05))
  assert.equal(bd.total.agi, bd.body.agi + bd.job.agi + bd.gear.agi + bd.armorAgi)
})

test('【確定】いまの職業で装備できない武器は効かない（数えない）', () => {
  const inv = [{ id: 1, base_id: '2N:杖', ilv: 30 }]
  assert.equal(Object.keys(equippedItems(baseProf({ equipped: { weapon: 1 } }), inv)).length, 0, '戦士は杖を装備できない')
  assert.equal(Object.keys(equippedItems(baseProf({ class:'魔法使い', equipped: { weapon: 1 } }), inv)).length, 1, '魔法使いはできる')
  assert.equal(canEquipType('戦士', '杖'), false)
})

test('【確定】職業補正は一旦なし（noClassBonus）。重鎧の軽減は taken、通常攻撃の種類は kind で渡す', () => {
  const inv = [1, 2, 3, 4].map(id => ({ id, base_id: ['3N:重鎧頭', '3N:重鎧鎧', '3N:重鎧腕', '3N:重鎧足'][id - 1], ilv: 30 }))
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
test('【確定】落ちるのはそのエリアの装備。武器はいまの職業が装備できる種類（3〜4種）から・防具は重鎧と軽装の両方', () => {
  const rng = rngOf(7)
  for (const cls of START_CLASSES) {
    for (let i = 0; i < 300; i++) assert.ok(canEquipType(cls, rollDropKind('武器', cls, rng)), `${cls}に落ちた武器`)
    // 4種の職業（刀・宝珠を足した職業）でも、装備できる武器が全部落ちる
    const got = new Set(Array.from({ length: 400 }, () => rollDropKind('武器', cls, rng)))
    assert.deepEqual([...got].sort(), [...weaponsOf(cls)].sort(), `${cls}には装備できる武器が全部落ちる`)
  }
  const lines = new Set(Array.from({ length: 200 }, () => rollDropKind('鎧', '戦士', rng)))
  assert.deepEqual([...lines].sort(), ['軽装鎧', '重鎧鎧'])
  for (let i = 0; i < 50; i++) assert.ok(ACCESSORY_TYPES.includes(rollDropKind('アクセ', '戦士', rng)))
  // 実際に出撃して拾う：エリア・アイテムLV・レア度の出どころ（荒廃した草原の②③。3回に1回はボスに会う）
  const seen = { normal: new Set(), timed: new Set(), rare: new Set(), boss: new Set() }
  let got = 0
  for (let i = 0; i < 200000 && got < 400; i++) {
    const enc = pickEncounter(5 + (i % 2), i % 3 === 0 ? 100 : 0, new Date(Date.UTC(2026, 0, 1, i % 24)), rng)
    const d = rollEquipDrop(enc, '盗賊', new Date(), rng)
    if (!d) continue
    got++
    assert.equal(d.item.area, enc.spot.area, 'そのエリアの装備')
    assert.equal(d.ilv, d.item.lv, 'アイテムLV＝その装備の必要LV')
    assert.ok(canDropRarity(enc.role, d.item.rarity), `${enc.role}から${RARITY_LABEL[d.item.rarity]}`)
    seen[enc.role].add(d.item.rarity)
    if (d.item.part === '武器') assert.ok(canEquipType('盗賊', d.item.type), d.item.type)
  }
  assert.ok(got >= 400, 'ドロップを拾えている')
  assert.ok(seen.boss.has('E') && seen.boss.has('L'), 'ボスからエピックとレジェンダリーも落ちる')
  assert.ok(!seen.normal.has('E') && !seen.timed.has('E'), 'ふつうの敵からエピックは落ちない')
})

// ===== 敵 =====
test('【確定】モンスターはユーザーの一覧のとおり（1エリア20体＝通常6・時間帯6・レア5・ボス3）', () => {
  assert.equal(AREA_ROSTERS.length, 15)
  for (const a of AREA_ROSTERS) {
    assert.deepEqual([a.normals.length, a.timed.length, a.rares.length, a.bosses.length], [6, 6, 5, 3])
    assert.deepEqual(a.timed.map(e => e.band).sort(), ['昼', '昼', '晩', '晩', '朝', '朝'], `${a.bosses[2].name}のエリア：時間帯は朝昼晩2体ずつ`)
    assert.deepEqual(a.rares.map(e => e.band || '-').sort(), ['-', '-', '昼', '晩', '朝'], 'レアは一日中2体・朝昼晩1体ずつ')
    for (const e of [...a.normals, ...a.timed, ...a.rares, ...a.bosses]) {
      assert.ok(['phys', 'mag'].includes(e.kind) && e.skills.length >= 1 && e.skills.every(Boolean), `${e.name}の中身`)
      assert.equal(Object.values(e.dist).reduce((x, y) => x + y, 0), 100, `${e.name}の配分の合計`)
    }
  }
  const all = AREA_ROSTERS.flatMap(a => [...a.normals, ...a.timed, ...a.rares, ...a.bosses])
  assert.equal(new Set(all.map(e => e.name)).size, 300, '名前は全部のエリアで重ならない')
  // 一覧の名前（最初と最後のエリア・ボス）
  assert.deepEqual(AREA_ROSTERS[0].normals.map(e => e.name), ['スライム', 'コウモリ', '毒キノコ', '森ネズミ', 'オオアリ', 'つるヘビ'])
  assert.deepEqual(AREA_ROSTERS[0].bosses.map(e => e.name), ['オヤブンネズミ', 'クイーンアント', 'ビッグスライム'])
  assert.deepEqual(AREA_ROSTERS[14].bosses.map(e => e.name), ['大海月ルミナ', '深海魔女キルケ', '深海覇王リヴァイアサン'])
  assert.deepEqual(AREA_ROSTERS[9].rares.map(e => [e.name, e.band || '-']),
    [['マグマゴーレム', '-'], ['ケルベロス', '-'], ['ブレイズバット', '朝'], ['イフリートロード', '昼'], ['アークデーモン', '晩']])
})

test('【確定】通常は表の上から2体ずつ①②③。②には①の敵・③には②の敵も出る。時間帯とレアは①②③すべて', () => {
  const [s1, s2, s3] = [1, 2, 3].map(id => spotOf(id).roster)
  assert.deepEqual(s1.enemies.map(e => e.name), ['スライム', 'コウモリ'])
  assert.deepEqual(s2.enemies.map(e => e.name), ['スライム', 'コウモリ', '毒キノコ', '森ネズミ'], '②には①の敵も出る')
  assert.deepEqual(s3.enemies.map(e => e.name), ['毒キノコ', '森ネズミ', 'オオアリ', 'つるヘビ'], '③には②の敵が出る（①の敵は出ない）')
  for (const s of SPOTS) {
    const a = AREA_ROSTERS[s.area - 1]
    assert.deepEqual(s.roster.timed.map(e => e.name), a.timed.map(e => e.name), `${spotLabel(s)}：時間帯の6体`)
    assert.deepEqual(s.roster.rares.map(e => e.name), a.rares.map(e => e.name), `${spotLabel(s)}：レア5体`)
    assert.equal(s.roster.boss.name, a.bosses[s.sub - 1].name, `${spotLabel(s)}のボス`)
  }
  const rows = enemyLevels()
  assert.equal(new Set(rows.map(e => `${e.spot}|${e.name}`)).size, rows.length, '「名前＋場所」は重ならない（サーバーの主キー）')
  for (const r of rows) assert.equal(spotOf(r.spot).area, SPOTS.find(s => s.roster.boss.name === r.name || [...s.roster.enemies, ...s.roster.timed, ...s.roster.rares].some(e => e.name === r.name)).area, `${r.name}は1つのエリアにだけいる`)
})

test('【確定】敵のLVは敵ごとに一定（プレイヤーのLVに合わせない）。最後のボスはLV80・始まりの森①は装備なしで勝てる低さ', () => {
  // どの場所に出ても同じLV（前は場所のLV帯から決めていて、②のスライムは①より高かった）
  for (const s of SPOTS) {
    for (const e of [...s.roster.enemies, ...s.roster.timed, ...s.roster.rares, s.roster.boss]) {
      assert.equal(enemyLvOf(e.name, s.id), ENEMY_LV[e.name], `${spotLabel(s)}の${e.name}`)
    }
    assert.equal(enemyRoleOf(s.roster.boss.name, s.id), 'boss')
    const [lo, hi] = spotLvOf(s.id)
    assert.equal(hi, enemyLvOf(s.roster.boss.name, s.id), `${spotLabel(s)}：いちばん高いのはボス`)
    assert.ok(lo >= 1 && lo <= hi)
  }
  assert.equal(enemyLvOf('スライム', 1), enemyLvOf('スライム', 2), 'スライムは①でも②でも同じLV')
  // 表の形：1エリア＝ふつう6・朝昼晩1つ・レア1つ・ボス3
  assert.equal(AREA_LEVELS.length, AREA_LIST.length)
  for (const L of AREA_LEVELS) assert.deepEqual([L.normals.length, L.bosses.length], [6, 3])
  // 【確定】ボスは後の場所ほど高く、最後（深淵の海溝③）がLV80（ユーザー指示）
  const bosses = SPOTS.map(s => enemyLvOf(s.roster.boss.name, s.id))
  for (let i = 1; i < bosses.length; i++) assert.ok(bosses[i] > bosses[i - 1], `${spotLabel(i + 1)}のボスは前の場所より高い`)
  assert.equal(bosses[SPOT_COUNT - 1], 80, '最後のボスはLV80')
  assert.ok(Object.values(ENEMY_LV).every(lv => lv >= 1 && lv <= 80), 'どの敵もLV80まで')
  // ふつうの敵は、出てくる場所のボスを超えない
  for (const s of SPOTS) for (const e of s.roster.enemies) assert.ok(ENEMY_LV[e.name] <= ENEMY_LV[s.roster.boss.name], `${spotLabel(s)}の${e.name}`)
  // 【確定】始まりの森①：スライムLV1・コウモリLV2・朝昼晩の敵LV2（ユーザー指示「未装備でも倒せるように」）
  assert.deepEqual(spotOf(1).roster.enemies.map(e => [e.name, ENEMY_LV[e.name]]), [['スライム', 1], ['コウモリ', 2]])
  for (const e of spotOf(1).roster.timed) assert.equal(ENEMY_LV[e.name], 2, e.name)
})

test('【確定】始まりの森①のふつうの敵には、LV1・装備なし・最初の編成で、どの職業も勝てる', () => {
  for (const cls of START_CLASSES) {
    const learned = skillsLearnedBy(cls, 1)
    const prof = { username:'t', class: cls, lv: 1, ...INITIAL_STATS, jobs: { [cls]: { lv: 1, exp: 0 } }, learned,
      skill_sets: { [cls]: defaultSetOf(cls, learned, INITIAL_STATS.mp) }, equipped: {} }
    const me = toFighter(prof, [])
    for (const e of spotOf(1).roster.enemies) {
      let w = 0
      for (let i = 0; i < 100; i++) if (runBattle(me, { ...enemyFighter(e) }, { rng: rngOf(1 + i * 7919) }).winner === 'a') w++
      assert.ok(w >= 95, `${cls}が${e.name}に ${w}/100`)
    }
  }
})

test('敵の出方：レアが先（0.5%）→ボス（遭遇率）→ふつう。朝昼晩の敵はその時間帯だけ', () => {
  const rng = rngOf(9)
  const spot = spotOf(3)
  const at = (h) => new Date(Date.UTC(2026, 0, 1, (h + 24 - 9) % 24))   // JSTの h 時
  // 遭遇率100%ならボス（レアに当たらなければ）
  let boss = 0
  for (let i = 0; i < 500; i++) if (pickEncounter(3, 100, at(10), rng).role === 'boss') boss++
  assert.ok(boss > 480, `ボス ${boss}/500`)
  // 遭遇率0ならボスは出ない。時間帯の敵はその時間帯の分だけ
  const seen = new Map()
  for (let i = 0; i < 5000; i++) {
    const h = [8, 15, 23][i % 3]
    const e = pickEncounter(3, 0, at(h), rng)
    assert.notEqual(e.role, 'boss')
    if (e.role === 'timed') seen.set(e.enemy.name, (seen.get(e.enemy.name) || new Set()).add(h))
    if (e.role === 'normal') assert.ok(spot.roster.enemies.includes(e.enemy))
  }
  for (const [name, hours] of seen) {
    const band = spot.roster.timed.find(x => x.name === name).band
    const want = { 朝: 8, 昼: 15, 晩: 23 }[band]
    assert.deepEqual([...hours], [want], `${name}は${band}だけ`)
  }
})

test('敵の強さ：標準の戦闘力は右肩上がり・ボスの倍率はエリアごと（15）×①②③・ふつうの敵は0.6倍', () => {
  for (let l = 1; l < 100; l++) assert.ok(stdPowerAt(l + 1) >= stdPowerAt(l))
  assert.equal(AREA_BOSS.length, AREA_LIST.length)
  for (const r of AREA_BOSS) assert.ok(r > 0)
  assert.equal(STD_RATIO[0][0], 1)
  assert.equal(STD_RATIO[STD_RATIO.length - 1][0], 100)
  const first = spotOf(1).roster.enemies[0]
  assert.equal(enemyPowerOf(first), Math.round(stdPowerAt(enemyLvOf(first.name, 1)) * NORMAL_RATIO))
})

test('【確定】③のボスは特に強い：どのエリアでも ③のボス＞②のボス＞①のボス（戦闘力）', () => {
  assert.deepEqual(SUB_BOSS, [1.0, 1.0, 1.25])
  for (let k = 0; k < AREA_LIST.length; k++) {
    const [b1, b2, b3] = [1, 2, 3].map(sub => spotOf(k * 3 + sub).roster.boss)
    const [p1, p2, p3] = [b1, b2, b3].map(enemyPowerOf)
    assert.ok(p3 > p2 && p2 >= p1, `${AREA_LIST[k].name}：①${p1}・②${p2}・③${p3}`)
    assert.ok(bossRatioOf(k * 3 + 3) > bossRatioOf(k * 3 + 2), `${AREA_LIST[k].name}：③の倍率が①②より高い`)
  }
})
