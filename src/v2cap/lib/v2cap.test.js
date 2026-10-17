// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）の決まりを固定するテスト（node --test）
// 設計は docs/v2cap-design.md。ユーザーが決めたことは【確定】と書いてある
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS, STAT_DEFS, calcPower, INITIAL_STATS } from '../../v2/lib/stats.js'
import { skillValue, VALUE_TABLE, MP_TABLE, BUFF_PER_MP, HEAL_PER_MP, MPREGEN_PER_MP, SKILLS as V2_SKILLS, offClassMult } from '../../v2/lib/skills.js'
import { createSide, mpCostOf, runBattle } from '../../v2/lib/battle.js'
import {
  MAX_LV, needExp, totalExpTo, applyExp, bodyPowerAt, staminaMaxOf, NEED_BASE, NEED_PERMIL, STAMINA_RECOVER_MS, rollStamina, msToNextStamina,
  pointsForLv, totalPointsTo, POINT_UNIT, validateAllocation, applyAllocation,
} from './level.js'
import {
  CLASSES, START_CLASSES, STAGES, JOB_MAX, JOB_BONUS, JOB_LV_HPMP, jobLevelsGained, mainStatsOf, jobNeed, jobTotalTo, bonusSeqOf,
  ICHIJI_CLASSES, ICHIJI_INFO, ICHIJI_REQ_JLV, jobMaxOf, nextClassesOf, CLASS_INFO, JOB_NEED_BASE_PERMIL, JOB_NEED_PCT,
  bonusPointsAt, jobBonusStats, learnOrderOf, learnAtOf, skillsLearnedBy, applyJobExp,
  canBecome, weaponsOf, canEquipType, attackKindOf, lineageOf, usableSkillNames, classDescOf,
  jobBonusGain, jobGainText, jobUpHead, jobUpNote, CLASS_BY_ID, ICHIJI_RENAMED,
} from './jobs.js'
import { SKILLS, NEW_SKILLS, LATE_SKILLS, SKILL_BY_NAME, setMpCost, validateSkillSet, defaultSetOf, fillSetOf, SKILL_SET_SLOTS, DEFAULT_USES_MAX, passiveOf, withoutPowerWords, ruledBuffOf, BUFF_RULE, BUFF_RULE_EXEMPT } from './skills.js'
import { ICHIJI_SKILLS, ICHIJI_BUILDS } from './skillsIchiji.js'
import {
  ITEMS, ITEM_BY_ID, KINDS, WEAPON_TYPES, ARMOR_LINES, ARMOR_PARTS, ACCESSORY_TYPES, PART_MULT, SLOTS, ARMOR_EFFECT,
  RARITIES, RARITY_LABEL, RARITY_BASE, AREA_COUNT, itemOf, slotsFor, SLOT_LABEL, PARTS, partLabel, kindLabel, reqLvOf,
  starterIdsOf, STARTER_ITEMS,
} from './equipment.js'
import { GEAR_NAMES } from './gearNames.js'
import { powerAt, effectPct, statsAt, spreadStats, armorEffects, armorEffectText, underLvPowerOf, GEAR_RATIO, SET_PART_SUM } from './gear.js'
import {
  AREA_LIST, SPOTS, SPOT_COUNT, spotOf, spotLvOf, spotLabel, expRangeOf, goldRangeOf,
  ROLE_TENTHS, scaleByRole, enemyLevels, enemyLvOf, enemyRoleOf,
  stdPowerAt, stdRatioAt, AREA_BOSS, SUB_BOSS, bossRatioOf, STD_RATIO, NORMAL_RATIO, enemyPowerOf, enemyBasePowerOf, toFighter as enemyFighter,
  BOSS_SPOT_POWER, SPOT_REC_LV, recLvOf, recRangeOf, recLvText, recSpotOfLv,
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
  // 必要EXP ＝ 20 ＋ 係数 × LV³（千分率の整数で掛けてから割る＝SQLと同じ）
  for (const l of [1, 5, 10, 20, 50, 99]) assert.equal(needExp(l), Math.max(1, Math.round((NEED_BASE * 1000 + NEED_PERMIL * l * l * l) / 1000)))
  // 【確定】2026-10-12 ユーザー指示「通常のレベルはもう少しレベル上げにくくていい／レベル1時点で必要経験値20」→「+20・全体1.2倍」
  //   （前は係数0.135だけ＝LV1→2が1。0.135 は tools/v2cap-progress.mjs --tune で「365時間目にLV100」に合わせた値）
  assert.equal(needExp(1), 20, 'LV1→2は20（ユーザー指示）')
  assert.deepEqual([NEED_BASE, NEED_PERMIL], [20, 162])
  assert.deepEqual([1, 5, 10, 20, 30, 50, 70, 90, 99].map(needExp), [20, 40, 182, 1316, 4394, 20270, 55586, 118118, 157208])
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
  // 勝ったときに落ちる確率（%）と、落ちたときのレア度の内訳（2026-10-09 ユーザー承認の案）。
  // ふつう・朝昼晩は 2026-10-12 ユーザー指示「装備のドロップ率渋すぎるから8％にして」で 3→8
  assert.deepEqual(DROP_CHANCE, { normal: 8, timed: 8, rare: 10, boss: 10 })
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
test('【確定】初期職は11職（剣士を足した）。装備できる武器は職業ごとに3種まで（ユーザーの表のとおり）', () => {
  // 並びは剣士が先頭（2026-10-11 ユーザー指示「剣士の位置は一番上にして」）＝キャラ作成と神殿の並び
  assert.deepEqual(START_CLASSES, ['剣士', '戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師'])
  // 2026-10-09 ユーザー決定：剣士は刀・片手剣・両手剣。
  // 2026-10-11 ユーザー指示「やっぱクラスごとに装備できる武器種は3つまでに」：
  //   戦士から刀・盗賊から片手剣・魔法使いから短剣・呪術師から投擲・僧侶から宝珠を外した（刀は剣士・盗賊、宝珠は魔法使い・呪術師）
  const table = {
    戦士: ['両手剣', '斧', '鈍器'], 槍使い: ['槍', '片手剣', '投擲'], 格闘家: ['拳', '鈍器', '杖'],
    盗賊: ['短剣', '投擲', '刀'], 弓使い: ['弓', '短剣', '片手剣'], 銃士: ['銃', '片手剣', '投擲'],
    剣士: ['刀', '片手剣', '両手剣'],
    魔法使い: ['杖', '書', '宝珠'], 呪術師: ['杖', '短剣', '宝珠'], 僧侶: ['鈍器', '杖', '書'], 薬師: ['短剣', '投擲', '書'],
  }
  for (const c of CLASSES) assert.ok(c.weapons.length >= 1 && c.weapons.length <= 3, `${c.id}の武器は3種まで（いま${c.weapons.length}）`)
  assert.deepEqual(Object.keys(table).sort(), [...START_CLASSES].sort())
  for (const [cls, list] of Object.entries(table)) assert.deepEqual(weaponsOf(cls), list, `${cls}の武器`)
  for (const list of Object.values(table)) for (const w of list) assert.ok(WEAPON_TYPES.includes(w), `${w}は14種にある`)
  // どの武器も、装備できる職業が1つ以上いる（拾っても誰も使えない武器が無い）
  for (const w of WEAPON_TYPES) assert.ok(Object.values(table).some(list => list.includes(w)), `${w}を装備できる職業がいる`)
})

test('【確定】ノーブル・サモナーはなくした。初期職11職は条件なし', () => {
  for (const id of ['ノーブル', 'サモナー', '賢者', 'ギャンブラー', '精霊召喚士', 'ブリーダー']) assert.ok(!CLASSES.some(c => c.id === id), `${id}は無い`)
  // 2026-10-14：侍・聖職者などV1の職業は上位職として続投した（初期職ではない）
  for (const id of ['侍', '聖職者']) assert.equal(CLASSES.find(c => c.id === id)?.stage, 'ichiji', `${id}は上位職`)
  const shoki = CLASSES.filter(c => c.stage === 'shoki')
  assert.deepEqual(shoki.map(c => c.id), START_CLASSES)
  for (const c of shoki) { assert.equal(c.req, null); assert.equal(canBecome(c.id, {}), true, `${c.id}は条件なし`) }
})

test('【確定】2026-10-15 画面の名前は「上位クラス」（前の名前「一次」は使わない）', async () => {
  // ユーザー指示「一次クラス→上位クラスに文言全修正して」。コードの中の名前（ichiji）はそのまま
  assert.deepEqual([STAGES.shoki.label, STAGES.ichiji.label], ['初期', '上位'])
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const temple = readFileSync(join(root, 'components/V2capTemple.jsx'), 'utf8')
  assert.ok(temple.includes("ichiji:'上位クラス'"), '神殿の見出しは「上位クラス」')
  // v2cap のファイルに「一次」が残っていない。残すのは、かぎかっこで引いたものだけ
  //   （ユーザーの表の題・共有の戦闘エンジンの節の名前・今回の指示の文・前の名前として書いた「一次」）
  const KEEP = ['「一次職スキル一覧」', '「一次職の仕組み」', '「一次クラス→上位クラスに文言全修正して」', '「一次」']
  const OLD = '一' + '次'
  const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
  const left = walk(root).filter(p => /\.(js|jsx|mjs)$/.test(p)).flatMap(p => {
    let s = readFileSync(p, 'utf8')
    for (const k of KEEP) s = s.split(k).join('')
    return s.split('\n').map((l, i) => l.includes(OLD) ? `${p.slice(root.length)}:${i + 1}` : null).filter(Boolean)
  })
  assert.deepEqual(left, [], '「一次」は「上位」に（2026-10-15 ユーザー指示）')
})

test('【確定】上位職は22職（ユーザーの表「一次職スキル一覧」＋2026-10-14 の並び替え）：系統の初期職のClassLV30で就ける・上限50・必要ClassEXP3倍・ステは初期職の1.2倍（10点）・武器は系統の初期職と同じ', () => {
  // 2026-10-10 ユーザー決定（転職の条件・ClassLV上限50・必要ClassEXP3倍・クラスのステは初期職の1.2倍・武器）
  assert.deepEqual(Object.keys(STAGES), ['shoki', 'ichiji'])
  assert.deepEqual([STAGES.shoki.max, STAGES.ichiji.max], [30, 50])
  // ClassLVごとの点数：2026-10-12 ユーザー指示で 初期職5→8・上位職6→10（上位職は初期職の1.2倍のまま＝ユーザーが選んだ）
  assert.deepEqual([STAGES.ichiji.mult, STAGES.ichiji.perLv], [3, 10])
  assert.equal(STAGES.ichiji.perLv, Math.round(STAGES.shoki.perLv * 1.2), 'ClassLVごとの点数は初期職の1.2倍')
  // 【確定】2026-10-15 チャット版の設計で CLASS LV35・45 を足して10個
  assert.deepEqual(STAGES.ichiji.learnAt, [1, 5, 10, 15, 20, 25, 30, 35, 40, 45])
  assert.equal(CLASSES.length, 33)
  // 2026-10-14 ユーザー承認の並び替え：V1の職業を続投・横文字の名前も入れた・剣士系（侍・魔法剣士）を足した
  assert.deepEqual(ICHIJI_CLASSES, ['侍', '魔法剣士', '狂戦士', '聖騎士', '竜騎士', 'ストームランサー', '体術師', 'サイキッカー', '暗殺者', '忍者',
    '狩人', 'アークアーチャー', '魔銃士', 'デストロイヤー', '元素使い', 'クロノマンサー', '死霊使い', '式神使い', '聖職者', '異端審問官', 'アルケミスト', '霊薬師'])
  for (const old of ['重戦士', '気功師', '槍術士', '狙撃手', '砲撃士', '魔導士', '時魔導士', '死霊術師', '陰陽師', '司祭', '祓魔師', '錬金術師']) {
    assert.ok(!CLASS_BY_ID[old], `${old}は無い（前の名前）`)
    assert.ok(CLASS_BY_ID[ICHIJI_RENAMED[old]], `${old}の移し先 ${ICHIJI_RENAMED[old]}がある`)
  }
  // 系統（初期職11系統に2職ずつ）
  for (const b of START_CLASSES) assert.equal(nextClassesOf(b).length, 2, `${b}から就ける上位職は2つ`)
  assert.deepEqual(nextClassesOf('剣士'), ['侍', '魔法剣士'])
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
  // 必要ClassEXP：毎回足す量（初期15・上位30）を除いたぶんが初期職の3倍（丸めの差は1まで）・ClassLV50で0
  for (let j = 5; j < 30; j++) assert.ok(Math.abs((jobNeed('ichiji', j) - 30) - 3 * (jobNeed('shoki', j) - 15)) <= 1, `ClassLV${j}`)
  assert.equal(jobNeed('ichiji', 49) > 0 && jobNeed('ichiji', 50), 0)
  assert.equal(jobNeed('shoki', 30), 0)
  assert.equal(jobTotalTo('ichiji', 50), 305349, '2026-10-12「LVの5割」×3＋毎回30')
  // ClassEXPを入れると50で止まる
  const r = applyJobExp({}, '狂戦士', jobTotalTo('ichiji', 50) + 99999, [])
  assert.deepEqual([r.lv, r.exp], [50, 0])
  assert.equal(r.learned.length, 10, 'ClassLV50で10個全部（45で最後の技）')
})

test('通常攻撃は 槍使い・盗賊・銃士・戦士・格闘家・弓使い・剣士＝物理／魔法使い・呪術師・僧侶・薬師＝魔法', () => {
  for (const c of ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '剣士']) assert.equal(attackKindOf(c), 'phys', c)
  for (const c of ['魔法使い', '呪術師', '僧侶', '薬師']) assert.equal(attackKindOf(c), 'mag', c)
})

test('【確定】ClassLVは最大30。初期職のClassLV30まで＝LV24のころに入っているEXP（2026-10-12「LVの5割」＋毎回15・LVは 20＋0.162×LV³・前はLV33）', () => {
  assert.equal(JOB_MAX, 30)
  assert.equal(jobNeed('shoki', 30), 0)
  const total = jobTotalTo('shoki', 30)
  assert.equal(total, 13209)
  assert.ok(total >= totalExpTo(24) && total < totalExpTo(25), `初期職の合計 ${total} はLV24〜25のあいだ`)
})

test('【確定】2026-10-12 必要ClassEXP＝段階ごとの量（初期15・上位30）＋係数0.135×ClassLV³の5割×段階の倍率。最初の職業ならClassLV≧LV', () => {
  // ユーザー指示「通常のレベルよりもクラスレベルのほうが上がりやすくして」→案から「LVの5割」を選んだ。
  //   同じ日に「通常のレベルはもう少しレベル上げにくくていい」でLVだけ 20＋0.162×LV³ にした＝ClassLVの係数は135のまま（切り離した）。
  //   さらに「クラスレベルも最初の必要量少なすぎ、初期クラスは必要経験値15にして、上位職は30で」＝毎回 needBase を足す
  assert.deepEqual([JOB_NEED_BASE_PERMIL, JOB_NEED_PCT], [135, 50])
  assert.deepEqual([STAGES.shoki.needBase, STAGES.ichiji.needBase], [15, 30])
  assert.deepEqual([jobNeed('shoki', 1), jobNeed('ichiji', 1)], [15, 30], 'ClassLV1→2は初期職15・上位職30（ユーザー指示）')
  for (const stage of ['shoki', 'ichiji']) {
    for (let j = 1; j < jobMaxOf(stage === 'shoki' ? '戦士' : '狂戦士'); j++) {
      const want = STAGES[stage].needBase + 0.135 * j * j * j / 2 * STAGES[stage].mult
      assert.ok(Math.abs(jobNeed(stage, j) - want) <= 0.5, `${stage} ClassLV${j}：${jobNeed(stage, j)}（${want}）`)
    }
  }
  for (let j = 1; j < JOB_MAX; j++) assert.ok(jobNeed('shoki', j) < needExp(j), `ClassLV${j}はLV${j}より少ない`)
  // LV1から同じEXPを入れていくと、LV24まではどの時点でもClassLVのほうが高いか同じ
  const jlvAt = (exp) => { let j = 1; while (j < JOB_MAX && jobTotalTo('shoki', j + 1) <= exp) j++; return j }
  for (let lv = 2; lv <= 24; lv++) assert.ok(jlvAt(totalExpTo(lv)) >= lv, `LV${lv}のときClassLV${jlvAt(totalExpTo(lv))}`)
  // いまの数（LV10でClassLV12・LV20で24）
  assert.equal(jlvAt(totalExpTo(10)), 12)
  assert.equal(jlvAt(totalExpTo(20)), 24)
})

test('【確定】クラスのステはClassLVが1上がるごとに初期職8点（ClassLV30で232点）・上位職10点（ClassLV50で490点）。職業ごとに2〜3種が高く、ほかは低め', () => {
  // 2026-10-12 ユーザー指示「くらすれべるあがるとき、もっと上昇量伸ばしていい」で 5点→8点・6点→10点（配分の割合はそのまま）
  assert.deepEqual([STAGES.shoki.perLv, STAGES.ichiji.perLv], [8, 10])
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    assert.ok(w, `${c.id}の配分がある`)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    const total = c.stage === 'ichiji' ? 490 : 232
    assert.equal(sum, total, `${c.id}の合計（上限のClassLVで${total}点）`)
    // 2〜3種が高い（初期職48点以上・上位職102点以上＝同じ割合・神殿の MAIN_STAT_MIN）・ほかはそれより低い・尖りすぎない（1種で半分を超えない）
    const vals = Object.values(w).sort((a, b) => b - a)
    const high = vals.filter(v => v >= (c.stage === 'ichiji' ? 102 : 48)).length
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

test('【確定】2026-10-12 CLASS LEVEL UP の行に、上がったクラスのステを書く（jobGainText・jobUpNote。2つ以上なら合計）', () => {
  // ユーザー指示「クラスレベルアップしたときはステータスの上昇値も記載すること」
  for (const c of CLASSES) {
    const max = jobMaxOf(c.id)
    const hpmp = JOB_LV_HPMP[c.id]
    for (let j = 1; j < max; j++) {
      const g = jobBonusGain(c.id, j, j + 1)
      assert.ok(g.hp >= hpmp.hp && g.mp >= hpmp.mp, `${c.id} ${j}→${j + 1}：HP・MPは必ず上がる`)
      // 1回で入るのは「点数（HP8・MP3・ほか1が1点）」＋毎回のHP・MP
      const pts = STAT_KEYS.reduce((t, k) => t + (g[k] - (k === 'hp' ? hpmp.hp : k === 'mp' ? hpmp.mp : 0)) / STAT_DEFS[k].unit, 0)
      assert.equal(pts, STAGES[c.stage].perLv, `${c.id} ${j}→${j + 1}：${pts}点`)
    }
    assert.equal(jobGainText(c.id, max, max + 1), '', `${c.id}：上限より上は何も増えない`)
  }
  assert.equal(jobGainText('盗賊', 1, 2), 'HP+14・MP+5・STR+2・DEX+1・AGI+2・LUK+1', 'ステの並び順・増えたものだけ')
  // 最後の「AP+◯」は 2026-10-13 のアセンション（ユーザーが選んだ「2行目の最後に足す」）
  assert.equal(jobUpNote('盗賊', { jlv: 2, job_ups: 1 }), '（HP+14・MP+5・STR+2・DEX+1・AGI+2・LUK+1・AP+1）')
  assert.equal(jobUpNote('盗賊', { jlv: 8, job_ups: 3 }), `（${jobGainText('盗賊', 5, 8)}・AP+3）`, '2つ以上上がったら合計')
  assert.equal(jobUpNote('盗賊', { jlv: 3, job_ups: 0 }), '')
  assert.equal(jobUpNote('盗賊', null), '')
  // 1行目（2026-10-12 ユーザー指示「クラスレベル上がるときはこの表記で」＝「⭐ CLASS LEVEL UP！盗賊　LV3 → 4」。Lv は表記ルールで LV）
  assert.equal(jobUpHead('盗賊', { jlv: 4, job_ups: 1 }), '⭐ CLASS LEVEL UP！盗賊　LV3 → 4')
  assert.equal(jobUpHead('狂戦士', { jlv: 8, job_ups: 3 }), '⭐ CLASS LEVEL UP！狂戦士　LV5 → 8', '2つ以上は「上がる前 → 上がったあと」')
  assert.equal(jobUpHead('盗賊', { jlv: 4, job_ups: 0 }), '')
  assert.ok(!/Lv/.test(jobUpHead('盗賊', { jlv: 4, job_ups: 1 })), '表記ルール：Lv は使わない')
})

test('【確定】ClassLVが上がるたびに、どの職業でも必ずHPとMPが上がる（点数とは別・職業ごとの量＝ユーザー承認の表）', () => {
  // 2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいいから」
  // 2026-10-12 点数と一緒に1.6倍（ユーザー指示「くらすれべるあがるとき、もっと上昇量伸ばしていい」＋案「8点（HP・MPも同じ倍率）」）
  // 2026-10-14 ユーザー承認：剣士・槍使いのHP 10→13
  assert.deepEqual(Object.keys(JOB_LV_HPMP).sort(), CLASSES.map(c => c.id).sort(), '全職業ぶんある')
  const want = {
    戦士: [13, 2], 槍使い: [13, 2], 格闘家: [13, 2], 盗賊: [6, 2], 弓使い: [6, 2], 銃士: [6, 2], 剣士: [13, 2],
    魔法使い: [10, 5], 呪術師: [6, 5], 僧侶: [13, 5], 薬師: [13, 5],
    // 2026-10-14 上位職の並び替え：侍・魔法剣士・聖騎士・サイキッカーを足した・魔銃士 10→13（HPが一番低かった）
    侍: [13, 3], 魔法剣士: [13, 5], 狂戦士: [16, 3], 聖騎士: [16, 5], 竜騎士: [13, 3], ストームランサー: [10, 3], 体術師: [13, 3], サイキッカー: [13, 5],
    暗殺者: [10, 3], 忍者: [10, 3], 狩人: [10, 3], アークアーチャー: [10, 3], 魔銃士: [13, 5], デストロイヤー: [13, 5],
    元素使い: [10, 6], クロノマンサー: [10, 6], 死霊使い: [13, 6], 式神使い: [10, 6], 聖職者: [16, 6], 異端審問官: [13, 6], アルケミスト: [13, 6], 霊薬師: [16, 6],
  }
  for (const [cls, [hp, mp]] of Object.entries(want)) assert.deepEqual(JOB_LV_HPMP[cls], { hp, mp }, cls)
  for (const c of CLASSES) {
    // 1回ずつ見て、HPとMPが必ず上がっている（点数の配りでHP・MPに当たった回はそのぶんも上乗せ）
    for (let j = 2; j <= jobMaxOf(c.id); j++) {
      const a = jobBonusStats(c.id, j - 1), b = jobBonusStats(c.id, j)
      assert.ok(b.hp - a.hp >= JOB_LV_HPMP[c.id].hp, `${c.id} ClassLV${j}でHPが上がる`)
      assert.ok(b.mp - a.mp >= JOB_LV_HPMP[c.id].mp, `${c.id} ClassLV${j}でMPが上がる`)
    }
    // 点数（8点・10点）はそのまま（毎回のHP・MPは別に足す）
    assert.equal(bonusPointsAt(c.id, jobMaxOf(c.id)), STAGES[c.stage].perLv * (jobMaxOf(c.id) - 1))
    assert.equal(jobLevelsGained(c.id, 1), 0)
    assert.equal(jobLevelsGained(c.id, 99), jobMaxOf(c.id) - 1, '上限より上は増えない')
  }
  // ユーザーに見せた例（上限のClassLVでの合計）
  assert.deepEqual([jobBonusStats('戦士', 30).hp, jobBonusStats('戦士', 30).mp], [737, 106])
  assert.deepEqual([jobBonusStats('魔法使い', 30).hp, jobBonusStats('魔法使い', 30).mp], [482, 289])
  assert.deepEqual([jobBonusStats('聖職者', 50).hp, jobBonusStats('聖職者', 50).mp], [1720, 519], '司祭から改名（2026-10-14）')
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
// 【確定】2026-10-14 ユーザー承認：初期職も CLASS LV25・30 で1つずつ（技7つ・5枠から選ぶ）
test('スキルは初期職ClassLV 1／5／10／15／20／25／30 で7個・上位職ClassLV 1／5／10／15／20／25／30／35／40／45 で10個', () => {
  assert.deepEqual(STAGES.shoki.learnAt, [1, 5, 10, 15, 20, 25, 30])
  for (const c of CLASSES) {
    const n = c.stage === 'ichiji' ? 10 : 7
    assert.equal(learnOrderOf(c.id).length, learnAtOf(c.id).length, `${c.id}のスキル数`)
    assert.equal(learnOrderOf(c.id).length, n)
    assert.equal(skillsLearnedBy(c.id, 1).length, 1, `${c.id}はClassLV1で1つ`)
    assert.equal(skillsLearnedBy(c.id, jobMaxOf(c.id)).length, n, `${c.id}は上限のClassLVで全部`)
  }
  assert.equal(skillsLearnedBy('狂戦士', 34).length, 7, 'ClassLV35の技は35で覚える')
  assert.equal(skillsLearnedBy('狂戦士', 39).length, 8, 'ClassLV40の技は40で覚える')
  assert.equal(skillsLearnedBy('狂戦士', 44).length, 9, 'ClassLV45の技は45で覚える')
  const r = applyJobExp({}, '戦士', jobTotalTo('shoki', 30) + 999999, ['体当たり'])
  assert.equal(r.lv, 30)
  assert.equal(r.exp, 0)
  assert.deepEqual(r.learned, ['強撃', '防御崩し', '防御態勢', 'シールドアタック', '叩きつけ', '雄叫び'])
  // CLASS LV25・30 の技は、そのCLASS LVで覚える
  assert.deepEqual(skillsLearnedBy('剣士', 24).slice(5), [])
  assert.deepEqual(skillsLearnedBy('剣士', 25).slice(5), ['霞斬り'])
  assert.deepEqual(skillsLearnedBy('剣士', 30).slice(5), ['霞斬り', '乱れ斬り'])
})

test('【確定】戦士・弓使い・魔法使い・僧侶・格闘家のCLASS LV1〜20の5技は今のⅡのまま（中身も並びも同じ・説明の威力のステを消す・補助技の上げ幅は全職業の決まり）', () => {
  for (const cls of ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']) {
    const v2 = V2_SKILLS.filter(s => s.cls === cls)
    // ★魔法の属性（elem）だけはこの版の写しに付けている（魔導士の元素共鳴が見る・2026-10-10）。それ以外は同じ
    //   （2026-10-15〜16 の弓使いの倍率×1.08＝SHOKI_TUNE はやめた＝ユーザー「倍率かけないで×1」）
    // ★説明（desc）は「AGIが大きく威力になる」などを消した写し（2026-10-16 ユーザー「21個とも消す」・今のⅡの名簿は書き換えない）
    // ★補助技（防御態勢・駆け足・精神統一・プロテク・残心）の上げ幅は全職業の決まり（2026-10-17 ユーザー「全クラス基本統一してよ」「初期職もそろえる」）
    const noElem = (s) => { const { elem: _e, desc: _d, buff: _b, ...rest } = s; return rest }
    const mine = learnOrderOf(cls).slice(0, 5)
    assert.deepEqual(mine.map(noElem), v2.map(noElem), `${cls}`)
    assert.deepEqual(mine.map(s => s.buff), v2.map(s => (ruledBuffOf(s) ? { ...s.buff, ...ruledBuffOf(s) } : s.buff)), `${cls}の補助技`)
    for (const [i, s] of mine.entries()) if (s.kind !== 'buff') assert.equal(s.desc, withoutPowerWords(v2[i].desc), `${s.name}の説明`)
    // 6つ目・7つ目は CLASS LV25・30 の技（2026-10-14・LATE_SKILLS）
    assert.deepEqual(learnOrderOf(cls).slice(5).map(s => s.name), LATE_SKILLS.filter(s => s.cls === cls).map(s => s.name), `${cls}の後の2技`)
  }
  assert.deepEqual(['ファイア', 'サンダー', 'アイスランス'].map(n => SKILL_BY_NAME[n].elem), ['fire', 'thunder', 'ice'])
  assert.ok(V2_SKILLS.every(s => !('elem' in s)), '今のⅡの名簿は書き換えていない')
  // 説明を変えたのは威力のステを書いていた3つだけ。今のⅡの説明はそのまま
  const copies = ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家'].flatMap(c => learnOrderOf(c).slice(0, 5))
  assert.deepEqual(copies.filter(s => V2_SKILLS.find(v => v.cls === s.cls && v.name === s.name).desc !== s.desc).map(s => `${s.name}：${s.desc}`),
    ['防御態勢：VIT+30%（重ねがけ可）', 'シールドアタック：盾で殴る', '狙撃：必中', '駆け足：AGI+30%（重ねがけ可）', '疾風矢：速射',
      '精神統一：INT+30%（重ねがけ可）', 'プロテク：VIT+20%・INT+20%（重ねがけ可）', '残心：DEX+20%・AGI+20%（重ねがけ可）'].sort((a, b) => copies.findIndex(s => a.startsWith(s.name + '：')) - copies.findIndex(s => b.startsWith(s.name + '：'))))
  assert.equal(V2_SKILLS.find(s => s.name === '狙撃').desc, '必中。AGIが大きく威力になる', '今のⅡの名簿は書き換えていない')
})

test('【確定】上位職の技はチャット版の設計（2026-10-15）のとおり（各職10技＋パッシブ1つ・組み方の例2つ）', () => {
  assert.equal(ICHIJI_SKILLS.length, 242, '22職×11（2026-10-15 CLASS LV35・45 の技を足した）')
  for (const id of ICHIJI_CLASSES) {
    const mine = ICHIJI_SKILLS.filter(x => x.cls === id)
    assert.equal(mine.filter(x => x.kind === 'passive').length, 1, `${id}のパッシブは1つ`)
    assert.equal(mine.filter(x => x.kind !== 'passive').length, 10, `${id}の技は10個`)
    assert.equal(passiveOf(id)?.cls, id)
    for (const x of mine) {
      assert.ok(x.desc, `${x.name}の説明`)
      // 消費MPは決まった量か、そのときの残りMPの割合（オーバーロードショット＝30%）
      if (x.kind !== 'passive') assert.ok((x.mp > 0 || x.mpPct > 0) && x.proc >= 70 && x.proc <= 100, `${x.name}の消費MP・発動率`)
    }
    assert.equal(ICHIJI_BUILDS[id].length, 2, `${id}の組み方の例は2つ`)
    for (const b of ICHIJI_BUILDS[id]) {
      assert.equal(b.length, 5)
      for (const n of b) assert.equal(SKILL_BY_NAME[n]?.cls, id, `${id}の組み方の${n}は${id}の技`)
    }
  }
  // 設計の値（抜き出して固定）。並び＝覚える順（ClassLV1／5／10／15／20／25／30／35／40／45）。
  //   狂戦士の攻撃の技は最大HPを払うぶん消費MPが半分（2026-10-15 チャット版の設計）
  assert.deepEqual(learnOrderOf('狂戦士').map(x => [x.name, x.mp, x.proc]), [
    ['マッドラッシュ', 3, 95], ['血風斬', 12, 85], ['狂乱の咆哮', 10, 100], ['ブラッドスプラッシュ', 6, 88],
    ['狂撃', 14, 85], ['ブラッディロア', 14, 100], ['血の誓い', 10, 100], ['ブラッドサクリファイス', 6, 85],
    ['フルブレイカー', 11, 80], ['狂鬼化', 10, 100]])
  assert.deepEqual(learnOrderOf('霊薬師').map(x => x.name), ['霊薬瓶', '剛力薬', '叡智の薬', '鉄身薬', '再生薬', '霊薬', '薬効解放', '浸透薬', '仙丹', 'エリクサー'])
  // 消費MP・発動率は表のまま。倍率は 2026-10-14 にユーザー指示「どのクラスも平均的な強さになるように揃えて」で変えた（ichijiRoster.test.js が見張る）
  assert.deepEqual([SKILL_BY_NAME['カタストロフ'].mp, SKILL_BY_NAME['カタストロフ'].proc], [28, 70])
  assert.equal(SKILL_BY_NAME['マナショット'].hybrid.phys, SKILL_BY_NAME['マナショット'].hybrid.mag, '物理と魔法が同じ（STRとINTが半分ずつ）')
  assert.equal(passiveOf('狂戦士').name, 'バーサク')
  assert.equal(passiveOf('戦士'), null, '初期職にパッシブは無い')
  // 今のⅡと同じ名前の技がある（表の「過去作の名前も引き継ぐ」）。この版の名簿の中では重ならない
  assert.equal(new Set(SKILLS.map(x => x.name)).size, SKILLS.length)
  assert.equal(SKILL_BY_NAME['マッドラッシュ'].cls, '狂戦士')
  assert.equal(SKILL_BY_NAME['マッドラッシュ'].hits, undefined, 'この版の中身（1発の技。今のⅡのマッドラッシュは3連撃）')
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
      // ★2026-10-17 から補助技の上げ幅は全職業の決まり（MP×3.4までの帯はやめた・ユーザー「全クラス基本統一してよ」）
      assert.deepEqual(s.buff, ruledBuffOf(s), `${s.name}：補助技の上げ幅は決まりどおり`)
    } else if (s.heal) {
      assert.ok(s.heal.rate <= s.mp * HEAL_PER_MP.basic + 1e-9, `${s.name}の回復量`)
    } else if (s.mpRegen) {
      assert.ok(s.mpRegen.rate * s.mpRegen.turns <= s.mp * MPREGEN_PER_MP.basic + 1e-9, `${s.name}のMP回復`)
    }
  }
  assert.equal(new Set(SKILLS.map(s => s.name)).size, SKILLS.length, 'スキル名は重複しない')
  assert.ok(!NEW_SKILLS.some(s => V2_SKILLS.some(v => v.name === s.name)), '今のⅡの技と名前がぶつからない')
})

test('【確定】2026-10-14 初期11職の CLASS LV25・30 の22技は、初期職の帯（価値・消費MP）どおり・名前が重ならない', () => {
  assert.equal(LATE_SKILLS.length, 22)
  assert.deepEqual([...new Set(LATE_SKILLS.map(s => s.cls))].sort(), [...START_CLASSES].sort())
  for (const cls of START_CLASSES) assert.equal(LATE_SKILLS.filter(s => s.cls === cls).length, 2, `${cls}は2つ`)
  const band = (t, proc) => { const ks = Object.keys(t).map(Number).sort((a, b) => b - a); return t[ks.find(k => proc >= k) ?? ks[ks.length - 1]] }
  for (const s of LATE_SKILLS) {
    if (s.kind === 'phys' || s.kind === 'mag') {
      assert.ok(Math.abs(skillValue(s) - band(VALUE_TABLE.basic[s.kind], s.proc)) <= 0.03, `${s.name}の価値 ${skillValue(s)}`)
      assert.equal(s.mp, band(MP_TABLE.basic[s.kind], s.proc), `${s.name}の消費MP`)
      assert.ok(s.proc >= 85, `${s.name}：初期職は発動率85%以上`)
    } else if (s.kind === 'buff') {
      // ★2026-10-17 から補助技の上げ幅は全職業の決まり（MP×3.4までの帯はやめた）
      assert.deepEqual(s.buff, ruledBuffOf(s), `${s.name}：補助技の上げ幅は決まりどおり`)
    } else {
      assert.equal(s.kind, 'heal', s.name)
      assert.ok(s.heal.rate <= s.mp * HEAL_PER_MP.basic + 1e-9, `${s.name}の回復量`)
    }
  }
  // 今のⅡの技・武器の進化の名前とも重ならない（同じ名前だと戦闘ログで見分けにくい）
  assert.ok(!LATE_SKILLS.some(s => V2_SKILLS.some(v => v.name === s.name)), '今のⅡの技と名前がぶつからない')
  // 中身（ユーザーが承認した案）
  const by = SKILL_BY_NAME
  assert.equal(by.叩きつけ.sureHit, true)
  assert.deepEqual(by.雄叫び.buff, { self:{ str:20 }, enemy:{ agi:-15 } }, '2026-10-17 補助技の上げ幅をそろえた（前は STR+12%・相手のAGI−5%）')
  assert.equal(by.鎧通し.defPen, 0.5)
  assert.deepEqual(by.盗み取る.dispel, { chance:40 })
  assert.equal(by.生命吸収.drain, 0.25)
  assert.equal(by.万能薬.cure, 2)
})

test('編成の想定利用MPは、この版の名簿で数える（新しい技の消費MPが0に見えない）', () => {
  assert.equal(setMpCost([{ name:'災いの呪い', uses: 2 }]), 26)
  assert.equal(validateSkillSet([{ name:'災いの呪い', uses: 1 }], { lineage: ['呪術師'], learned: ['災いの呪い'], maxMp: 12 }), '想定利用MPが最大MPを超えています（13 / 12）')
  assert.equal(validateSkillSet([{ name:'呪弾', uses: 2 }], { lineage: ['呪術師'], learned: ['呪弾'], maxMp: 12 }), null)
  assert.ok(SKILL_BY_NAME['気付け薬'])
})

test('【確定】スキルはその職業でだけ使える。他の職業の技は、覚えていても置けない（0.8倍・MP2倍で使う形はやめた）', () => {
  for (const c of CLASSES) assert.deepEqual(lineageOf(c.id), c.req ? [c.id, c.req.cls] : [c.id], `${c.id}：自分（上位職は系統の初期職も）`)
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

test('【確定】2026-10-12 覚えた技は編成の空き枠へ入れる：1回ずつ入れてから、残りのMPで前から1回ずつ足す（fillSetOf）', () => {
  // ユーザー指示「スキルスロット余ってる場合はうめるようにして」。サーバーの v2cap_fill_set と同じ規則（PGlite で突き合わせた）
  const berserk = { lineage: lineageOf('狂戦士') }
  const learned = [...skillsLearnedBy('戦士', JOB_MAX), ...skillsLearnedBy('狂戦士', 10)]
  // ⚠最初の形（入れた技に残りのMPで使えるだけ回数を付ける）だと、体当たり×5・強撃×3 でMPを使い切って2枠しか埋まらなかった
  assert.deepEqual(fillSetOf([], learned, { ...berserk, maxMp: 54 }), [
    { name:'体当たり', uses: 2 }, { name:'強撃', uses: 2 }, { name:'防御崩し', uses: 1 }, { name:'防御態勢', uses: 1 }, { name:'シールドアタック', uses: 1 },
  ], '5枠とも埋まる（4＋11＋8＋8＋8＝39・残り15で 体当たり+1・強撃+1）')
  // 前から入っている技にはさわらない（回数も）。空き枠に入るだけ
  const mine = [{ name:'マッドラッシュ', uses: 4 }]
  const s = fillSetOf(mine, learned, { ...berserk, maxMp: 60 })
  assert.deepEqual(s[0], { name:'マッドラッシュ', uses: 4 })
  assert.equal(s.length, SKILL_SET_SLOTS)
  assert.deepEqual(mine, [{ name:'マッドラッシュ', uses: 4 }], '渡した編成は書き換えない')
  // 収まらない技はとばして次の技へ（強撃11は入らず、防御崩し8は入る）
  assert.deepEqual(fillSetOf([{ name:'体当たり', uses: 1 }], ['強撃', '防御崩し'], { lineage: ['戦士'], maxMp: 12 }), [{ name:'体当たり', uses: 1 }, { name:'防御崩し', uses: 1 }])
  // 入れないもの：ほかの職業の技・パッシブ・名簿に無い名前・もう入っている技・1回ぶんもMPが無い・枠がいっぱい
  assert.deepEqual(fillSetOf([], ['呪弾', '体当たり'], { lineage: ['戦士'], maxMp: 4 }), [{ name:'体当たり', uses: 1 }])
  const passive = SKILLS.find(k => k.cls === '戦士' && k.passive)
  if (passive) assert.deepEqual(fillSetOf([], [passive.name], { lineage: ['戦士'], maxMp: 999 }), [])
  assert.deepEqual(fillSetOf([], ['ないスキル'], { lineage: ['戦士'], maxMp: 999 }), [])
  assert.deepEqual(fillSetOf([{ name:'体当たり', uses: 1 }], ['体当たり'], { lineage: ['戦士'], maxMp: 999 }), [{ name:'体当たり', uses: 1 }])
  assert.deepEqual(fillSetOf([], ['体当たり'], { lineage: ['戦士'], maxMp: 3 }), [])
  const full = skillsLearnedBy('戦士', JOB_MAX).map(name => ({ name, uses: 1 }))
  assert.deepEqual(fillSetOf(full, ['マッドラッシュ'], { ...berserk, maxMp: 999 }), full)
  // 空から入れるときは、収まる限り「初めて就いた職業の編成」（defaultSetOf）と同じ
  for (const cls of START_CLASSES) {
    for (let j = 1; j <= JOB_MAX; j++) {
      const L = skillsLearnedBy(cls, j)
      const maxMp = INITIAL_STATS.mp + jobBonusStats(cls, j).mp
      const filled = fillSetOf([], L, { lineage: [cls], maxMp })
      assert.equal(validateSkillSet(filled, { lineage: [cls], learned: L, maxMp }), null, `${cls} CLASS LV${j}`)
      if (setMpCost(L.slice(0, SKILL_SET_SLOTS).map(name => ({ name, uses: 1 }))) <= maxMp) assert.deepEqual(filled, defaultSetOf(cls, L, maxMp), `${cls} CLASS LV${j}`)
    }
  }
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

test('【確定】剣士（2026-10-09 ユーザー承認・2026-10-14 直し）：物理・刀／片手剣／両手剣・STR・DEXが高い・技7つ', () => {
  assert.equal(attackKindOf('剣士'), 'phys')
  assert.deepEqual(weaponsOf('剣士'), ['刀', '片手剣', '両手剣'])
  // 承認は STR40 DEX32 AGI30 VIT15 HP13 MP10 LUK5（合計145）。2026-10-12 ClassLVごとの点数を5→8にしたので同じ割合で232点へ
  // 2026-10-14 ユーザー承認：HPが低くボス戦で平均の約9割だった＝DEX・AGIからVIT・HPへ（案の DEX45・AGI42 は「高い2〜3種」を守るため DEX48・AGI39）
  assert.deepEqual(JOB_BONUS.剣士, { str:64, dex:48, agi:39, vit:30, hp:27, mp:16, luk:8 })
  assert.deepEqual(mainStatsOf('剣士'), ['str', 'dex'])
  // 説明文は 2026-10-11 ユーザー指示「具体的なスキル名やステータス名を記載しないで」で書き直した（前は承認済みの「STR・DEX・AGIがそろって…燕返しと兜割りで斬り崩す」）
  assert.equal(classDescOf('剣士'), '鋭い剣さばきで、攻めと身のこなしを両立する')
  assert.deepEqual(learnOrderOf('剣士').map(s => s.name), ['袈裟斬り', '燕返し', '兜割り', '一閃', '剣の構え', '霞斬り', '乱れ斬り'])
  const by = Object.fromEntries(learnOrderOf('剣士').map(s => [s.name, s]))
  assert.equal(by.燕返し.hits, 2)
  assert.equal(by.兜割り.defPen, 0.3)
  assert.deepEqual(by.一閃.ail, { key:'bleed', chance:40 })
  // 2026-10-14 ユーザー承認：威力をSTR寄りに（価値は同じ）・剣の構えは STR+15%・AGI+12% → 2026-10-17 補助技の上げ幅をそろえて STR+20%・AGI+20%
  assert.deepEqual([by.袈裟斬り.mult, by.燕返し.mult, by.兜割り.mult, by.一閃.mult], [1.15, 0.65, 1.17, 1.3])
  assert.deepEqual(by.剣の構え.buff, { self:{ str:20, agi:20 } })
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

test('【確定】2026-10-12 必要LVに足りないときの戦闘力は、最低でも1下がる（丸めで下がらないことをなくした）', () => {
  // ユーザー指示「最低でも1下げるようにして」（前は「戦闘力 7 → 7（効果95%）」のように、95%でも丸めで7のままだった）
  assert.equal(underLvPowerOf(7, 95), 6)
  assert.equal(underLvPowerOf(7, 100), 7, '足りていればそのまま')
  assert.equal(underLvPowerOf(100, 50), 50, '丸めで十分に下がるときはそのまま')
  for (const item of ITEMS) {
    const p = powerAt(item, item.lv)
    for (const pct of [95, 90, 50, 10]) {
      const u = underLvPowerOf(p, pct)
      assert.ok(u <= p - 1, `${item.id} 効果${pct}%：${p}→${u}`)
      assert.equal(u, Math.max(0, Math.min(Math.round(p * pct / 100), p - 1)))
      assert.equal(Object.values(statsAt(item, item.lv, pct)).reduce((a, b) => a + b, 0), u, 'ステの合計も同じ')
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
      assert.equal(Object.values(s).reduce((a, b) => a + b, 0), underLvPowerOf(powerAt(item, ilv), pct), `${item.name} LV${ilv}`)
    }
  }
})

test('【2026-10-13】装備のステの端数は最大剰余：どの配分でも、どのステも配分どおりの値の切り捨てか切り上げ・戦闘力が1上がって下がるステは無い', () => {
  // 戦闘力の式（powerAt）が変わっても見られるように、配分ごとに戦闘力を0から1000まで1ずつ上げて見る
  // ⚠前は四捨五入して、合計のずれをいちばん重いステへ足していた＝重いステが配分どおりの値から1以上ずれ、強化で下がることもあった
  //   （蟻帝の聖鎧 +3・効果60%＝戦闘力23：配分どおりなら VIT 13.8 のところが 15、戦闘力25 で 14 に下がった）
  const dists = [...new Map([...ITEMS, ...STARTER_ITEMS].map(i => [JSON.stringify(i.dist), i.dist])).values()]
  const bad = []
  for (const dist of dists) {
    const key = JSON.stringify(dist)
    let prev = spreadStats(0, dist)
    for (let p = 1; p <= 1000; p++) {
      const cur = spreadStats(p, dist)
      if (Object.values(cur).reduce((a, b) => a + b, 0) !== p) bad.push(`${key} 戦闘力${p}：合計`)
      for (const k of STAT_KEYS) {
        const q = p * (dist[k] || 0) / 100
        if (cur[k] !== Math.floor(q) && cur[k] !== Math.ceil(q)) bad.push(`${key} 戦闘力${p}：${k} ${cur[k]}（配分どおりなら ${q}）`)
        if (cur[k] < prev[k]) bad.push(`${key} 戦闘力${p - 1}→${p}：${k} ${prev[k]}→${cur[k]}`)
      }
      prev = cur
    }
  }
  assert.deepEqual(bad, [])
  // 端数が同じときの決め方（軽装頭＝AGI45・DEX25・STR15・INT15）
  //   戦闘力9：AGI4.05・DEX2.25・STR1.35・INT1.35 → 残り1点は STR と INT が並ぶので、dist に書いた順で STR
  //   戦闘力10：4つとも .5 で並ぶ → 残り2点は、戦闘力9で端数の1点をもらっていた STR と、配分の重い AGI
  //     （配分の重さだけで決めると AGI・DEX になり、STR が2→1に下がっていた＝アラバマのパラドックス）
  const light = itemOf(1, 'N', '軽装頭').dist
  const zero = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  assert.deepEqual(spreadStats(9, light), { ...zero, agi:4, dex:2, str:2, int_stat:1 })
  assert.deepEqual(spreadStats(10, light), { ...zero, agi:5, dex:2, str:2, int_stat:1 })
  assert.deepEqual(spreadStats(11, light), { ...zero, agi:5, dex:3, str:2, int_stat:1 })
  assert.deepEqual(spreadStats(0, light), zero)
  assert.deepEqual(statsAt(null, 1), zero, '装備が無ければ0')
})

test('【確定】画面では「アクセ」ではなく「装飾品」と出す（内部の部位名はアクセのまま）', () => {
  assert.equal(SLOT_LABEL.acc1, '装飾品①')
  assert.equal(SLOT_LABEL.acc2, '装飾品②')
  assert.equal(partLabel('アクセ'), '装飾品')
  for (const i of ITEMS.filter(x => x.part === 'アクセ')) assert.equal(kindLabel(i), '装飾品', i.name)
  for (const part of PARTS) assert.ok(!partLabel(part).includes('アクセ'), `${part}の表示`)
  assert.ok(!Object.values(SLOT_LABEL).some(l => l.includes('アクセ')), '枠の名前にアクセが残っていない')
})

test('【確定】防具のメリットは 重鎧＝受けるダメージ−1%／軽装＝AGI+1%（1部位ごと・デメリットなし・2026-10-12 に −3%／+5% から下げた）', () => {
  // 2026-10-12 ユーザー指示「防具の軽装重鎧で％で上がるパッシブは1％でいい」
  assert.equal(ARMOR_EFFECT.重鎧.takenPct, -1)
  assert.equal(ARMOR_EFFECT.軽装.agiPct, 1)
  assert.equal(ARMOR_EFFECT.重鎧.label, '受けるダメージ−1%')
  assert.equal(ARMOR_EFFECT.軽装.label, 'AGI+1%')
  assert.ok(!ARMOR_EFFECT.重鎧.agiPct && !ARMOR_EFFECT.軽装.takenPct, 'デメリットは付けない')
  const heavy = itemOf(1, 'N', '重鎧頭'), light = itemOf(1, 'N', '軽装頭')
  assert.deepEqual(armorEffects([{ item: heavy, pct: 100 }, { item: heavy, pct: 100 }]), { takenPct: -2, agiPct: 0, takenMult: 0.98 })
  assert.deepEqual(armorEffects([{ item: light, pct: 100 }]), { takenPct: 0, agiPct: 1, takenMult: 1 })
  // 必要LVに足りないときは、メリットも同じ割合で弱まる
  assert.deepEqual(armorEffects([{ item: heavy, pct: 50 }]), { takenPct: -0.5, agiPct: 0, takenMult: 0.995 }, '倍率は小数4桁（0.5%も消えない）')
  // 1部位の文（ホームの装備にカーソルを合わせたとき・プロフィールの内訳）。効果100%なら表の文と同じ
  assert.equal(armorEffectText(heavy), ARMOR_EFFECT.重鎧.label)
  assert.equal(armorEffectText(light, 100), ARMOR_EFFECT.軽装.label)
  assert.equal(armorEffectText(heavy, 50), '受けるダメージ−0.5%')
  assert.equal(armorEffectText(light, 45), 'AGI+0.45%')
  assert.equal(armorEffectText(itemOf(1, 'N', '片手剣')), '', '武器・装飾品は防具の効果なし')
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
  const gearW = underLvPowerOf(powerAt(ITEM_BY_ID['3N:両手剣'], 40), 50)
  const gearF = powerAt(ITEM_BY_ID['3R:軽装足'], 30)
  assert.equal(calcPower(bd.gear), gearW + gearF, 'LV30でLV40の装備＝効果50%')
  assert.equal(bd.armor.agiPct, 1)
  assert.equal(bd.armorAgi, Math.round((bd.body.agi + bd.job.agi + bd.gear.agi) * 0.01))
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
  assert.deepEqual(f.taken, { phys: 0.96, mag: 0.96 }, '重鎧4部位＝受けるダメージ−4%')
  // 今のⅡの戦闘エンジンは noClassBonus を見て職業補正を掛けない（渡さなければ従来どおり）
  const berserk = createSide({ name:'b', cls:'狂戦士', stats:{ ...INITIAL_STATS }, slots:[], noClassBonus: true })
  assert.equal(berserk.buffs.str || 0, 0)
  assert.ok((createSide({ name:'b', cls:'狂戦士', stats:{ ...INITIAL_STATS }, slots:[] }).buffs.str || 0) > 0)
})

// ===== ドロップ =====
test('【確定】落ちるのはそのエリアの装備。武器はいまの職業が装備できる種類（3種）から・防具は重鎧と軽装の両方', () => {
  const rng = rngOf(7)
  for (const cls of START_CLASSES) {
    for (let i = 0; i < 300; i++) assert.ok(canEquipType(cls, rollDropKind('武器', cls, rng)), `${cls}に落ちた武器`)
    // どの職業でも、装備できる武器が全部落ちる（装備できない武器は落ちない）
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
  // ★2026-10-13 ユーザー指示「時間限定の敵はエリアごとに強くなるように」：**朝昼晩の敵だけ**は場所ごとに
  //   「その場所のいちばん高いふつうの敵」と同じLV（①はいままでどおり表の2体目と同じ）
  for (const s of SPOTS) {
    for (const e of [...s.roster.enemies, ...s.roster.rares, s.roster.boss]) {
      assert.equal(enemyLvOf(e.name, s.id), ENEMY_LV[e.name], `${spotLabel(s)}の${e.name}`)
    }
    const top = Math.max(...s.roster.enemies.map(e => ENEMY_LV[e.name]))
    for (const e of s.roster.timed) assert.equal(enemyLvOf(e.name, s.id), top, `${spotLabel(s)}の${e.name}（朝昼晩）`)
    if (s.sub === 1) for (const e of s.roster.timed) assert.equal(enemyLvOf(e.name, s.id), ENEMY_LV[e.name], `${spotLabel(s)}の${e.name}は①ではいままでのLV`)
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

test('【確定】始まりの森①のふつう・朝昼晩の敵には、LV1・装備なし・ポイントなし・最初の編成で、どの職業も勝てる', () => {
  // 2026-10-12 ユーザー指示「少なくとも、エリア①の①の通常の敵は装備とかなくても倒せるくらいの強さでいい」。
  // ⚠前は ふつうの敵（スライム・コウモリ）だけを見ていて、朝昼晩の魔法型（ひなたアゲハ・モヤガエル）に
  //   魔法職が63%・84%しか勝てないのを見逃していた（朝昼晩の時間帯は出会う敵の半分が朝昼晩の敵）
  for (const cls of START_CLASSES) {
    const learned = skillsLearnedBy(cls, 1)
    const prof = { username:'t', class: cls, lv: 1, ...INITIAL_STATS, jobs: { [cls]: { lv: 1, exp: 0 } }, learned,
      skill_sets: { [cls]: defaultSetOf(cls, learned, INITIAL_STATS.mp) }, equipped: {} }
    const me = toFighter(prof, [])
    for (const e of [...spotOf(1).roster.enemies, ...spotOf(1).roster.timed]) {
      let w = 0
      for (let i = 0; i < 100; i++) if (runBattle(me, { ...enemyFighter(e) }, { rng: rngOf(1 + i * 7919) }).winner === 'a') w++
      assert.ok(w >= 95, `${cls}が${e.name}に ${w}/100`)
    }
  }
})

test('【確定】2026-10-12 序盤の敵：①-①（LV1〜2）は前のまま・LV5〜20の行は 1.6／1.6／1.3／1.15倍より弱くしない', () => {
  // ユーザー指示「序盤の敵が弱すぎる、技全部交わせちゃうからもう少し強くてもいい」→「1.6倍」・「１－１は弱くていい」
  // ★2026-10-13 標準の戦闘力を測り直した（鍛冶屋つき・ユーザー承認）。LV1・LV2の行は固定、LV5〜20の行は10-12の値より下げない（--stdkeepmin 20）
  assert.deepEqual(STD_RATIO.slice(0, 2), [[1, 0.75], [2, 0.83]])
  const was = { 5: 1.71, 10: 2.7, 15: 2.94, 20: 3.05 }
  for (const [lv, r] of STD_RATIO.slice(2, 6)) assert.ok(r >= was[lv], `LV${lv}の行 ${r} は10-12の ${was[lv]} 以上`)
  // ①-①の敵の強さは前の線（LV1 0.75〜LV5 1.07）の上と同じ
  for (const e of [...spotOf(1).roster.enemies, ...spotOf(1).roster.timed]) {
    const lv = ENEMY_LV[e.name]
    assert.ok(Math.abs(stdRatioAt(lv) - (0.75 + (1.07 - 0.75) * (lv - 1) / 4)) < 0.005, `${e.name}（LV${lv}）は前のまま`)
  }
  // エリア1に LV3〜9 の敵はいない＝LV5の行が効くのは①-②から先の敵（LV10〜）だけ
  const forest = AREA_ROSTERS[0]
  for (const e of [...forest.normals, ...forest.timed, ...forest.rares, ...forest.bosses]) {
    assert.ok(ENEMY_LV[e.name] <= 2 || ENEMY_LV[e.name] >= 10, `${e.name}（LV${ENEMY_LV[e.name]}）`)
  }
  // ①-②の始まりの森の敵（LV10）は前の1.6倍以上
  assert.ok(stdRatioAt(10) / 1.69 >= 1.6 - 0.01)
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

test('【確定】ボスは45か所で必ず前の場所より強い（どのエリアでも ③＞②＞①・次のエリアの①は前の③より強い）', () => {
  // ③の強さは AREA_BOSS×SUB_BOSS（目安の時間で測る）。①②は 2026-10-13 から「前の③×1.05・①と③の間」（エリアの境目・enemyStrength.test.js）
  assert.deepEqual(SUB_BOSS, [1.0, 1.0, 1.25])
  for (let k = 0; k < AREA_LIST.length; k++) {
    const [b1, b2, b3] = [1, 2, 3].map(sub => spotOf(k * 3 + sub).roster.boss)
    const [p1, p2, p3] = [b1, b2, b3].map(enemyPowerOf)
    assert.ok(p3 > p2 && p2 > p1, `${AREA_LIST[k].name}：①${p1}・②${p2}・③${p3}`)
    assert.ok(bossRatioOf(k * 3 + 3) > bossRatioOf(k * 3 + 2), `${AREA_LIST[k].name}：③の倍率が①②より高い`)
  }
  const all = SPOTS.map(s => enemyPowerOf(s.roster.boss))
  for (let i = 1; i < all.length; i++) assert.ok(all[i] > all[i - 1], `${spotLabel(i + 1)}のボス ${all[i]} は前の場所 ${all[i - 1]} より強い`)
})

test('【確定】2026-10-12 ①-①のボスは LV5 くらいで倒せる（戦闘力135→10-14 から122）：LV4ではまず勝てない・LV6ならほぼ勝てる', () => {
  // ユーザー指示「ボスをそんなすぐに倒されても困る、レベル5ぐらいで倒せるようになればいい※目安」
  // ⚠序盤の敵を1.6倍にしたとき、①-①のボス（LV10）も一緒に1.6倍になっていた（実機テストで見つけた）
  // ★2026-10-13 標準の戦闘力の測り直しで LV10 の行が動いても変わらないように、倍率（0.6倍）ではなく戦闘力135で止めた
  // ★2026-10-14 ユーザー「中ボスの強さ1割下げて」（序盤の手直し・areas.js の EARLY_MID_BOSS_CUT）で 135→122
  assert.deepEqual(BOSS_SPOT_POWER, { 1: 135 })
  const boss = spotOf(1).roster.boss
  assert.equal(enemyBasePowerOf(boss), 135)
  assert.equal(enemyPowerOf(boss), 122)
  assert.equal(bossRatioOf(2), AREA_BOSS[0] * SUB_BOSS[1], '①-②から先は手直しなし')
  // 初期装備・ポイントは職業の並びで振る・CLASS LV はそのLVのころ（初期職の必要EXP）・最初の編成。11職×200戦の勝率（%）
  const jlvAt = (lv) => { let j = 1; while (j < JOB_MAX && jobTotalTo('shoki', j + 1) <= totalExpTo(lv)) j++; return j }
  const meOf = (cls, lv) => {
    const jlv = jlvAt(lv)
    const inventory = starterIdsOf(cls).map((base_id, i) => ({ id: i + 1, base_id, ilv: 1, plus: 0 }))
    const equipped = Object.fromEntries(SLOTS.map((s, i) => [s, i + 1]))
    const st = { ...INITIAL_STATS }
    const seq = bonusSeqOf(cls)
    for (let i = 0; i < totalPointsTo(lv); i++) { const k = seq[i % seq.length]; st[k] += STAT_DEFS[k].unit }
    const learned = skillsLearnedBy(cls, jlv)
    const maxMp = st.mp + jobBonusStats(cls, jlv).mp
    return toFighter({ username:'t', class: cls, lv, ...st, jobs: { [cls]: { lv: jlv, exp: 0 } }, learned,
      skill_sets: { [cls]: defaultSetOf(cls, learned, maxMp) }, equipped }, inventory)
  }
  const foe = { ...enemyFighter(boss), boss: true }
  const ratesAt = (lv) => START_CLASSES.map(cls => {
    const me = meOf(cls, lv)
    let w = 0
    for (let i = 0; i < 200; i++) if (runBattle(me, { ...foe }, { rng: rngOf(1 + i * 7919) }).winner === 'a') w++
    return w / 2
  })
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const [r4, r5, r6] = [4, 5, 6].map(ratesAt)
  // 測ったとき（10-14・戦闘力122）：LV4 中央値15%・LV5 中央値89%（いちばん低い職業79.5%）・LV6 中央値99.5%
  //   （135のときは LV4 2%・LV5 67%（46%）・LV6 99%）
  assert.ok(med(r4) <= 30, `LV4 中央値${med(r4)}%（測ったときは15%）`)
  assert.ok(med(r5) >= 75, `LV5 中央値${med(r5)}%（測ったときは89%）`)
  assert.ok(Math.min(...r5) >= 60, `LV5 いちばん低い職業${Math.min(...r5)}%（測ったときは79.5%）`)
  assert.ok(med(r6) >= 90, `LV6 中央値${med(r6)}%（測ったときは99.5%）`)
})

test('【確定】2026-10-12 推奨LV：上限はボスを倒せる目安のLV（測った値）・最後は80・場所の選択肢は「推奨LV（前の場所の目安）〜（この場所の目安）」', () => {
  // ユーザー指示「推奨レベル　って表記の仕方にして上限のレベルはボスを倒せる目安のレベルで　最後のボスは80になるようにして」
  assert.equal(SPOT_REC_LV.length, SPOT_COUNT)
  assert.equal(recLvOf(1), 5, '①-①は LV5（ボスを戦闘力135にして合わせた）')
  assert.equal(recLvOf(SPOT_COUNT), 80, '最後は80（2026-10-13 に測ると90＝ユーザー「80、…戦闘力しっかり高かったら勝てるぐらいでいい」）')
  for (let id = 2; id <= SPOT_COUNT; id++) assert.ok(recLvOf(id) >= recLvOf(id - 1), `${spotLabel(id)}は前の場所より下がらない`)
  // 各エリアの③＝目安の時間に真ん中の人が何LVか（2026-10-13・初期職11職×2人・落ちた装備＋鍛冶屋）。エリア8から先は最後が80になるよう縮めた
  assert.deepEqual(AREA_LIST.map((_, k) => recLvOf(k * 3 + 3)), [18, 25, 31, 37, 41, 52, 59, 64, 68, 71, 73, 75, 77, 79, 80])
  // 画面の文言（表記ルールで「レベル」は数の前では LV）。前の場所と同じ数なら1つだけ
  assert.deepEqual(recRangeOf(1), [1, 5])
  assert.equal(recLvText(1), '推奨LV1〜5')
  assert.equal(recLvText(2), '推奨LV5〜15')
  assert.equal(recLvText(31), '推奨LV71')
  assert.equal(recLvText(SPOT_COUNT), '推奨LV79〜80')
  // そのLVの推奨の場所（デイリーミッションと宝樹のEXPの基準）＝推奨LVの上限がそのLV以上の、いちばん手前の場所
  assert.deepEqual([1, 5, 6, 15, 16, 77, 78, 80, 100].map(lv => recSpotOfLv(lv).id), [1, 1, 2, 2, 3, 39, 42, 45, 45])
})

test('【確定】2026-10-15「クラス間の格差が出すぎないように」：盗賊の配分 LUK19・STR61（合計232）', () => {
  assert.deepEqual(JOB_BONUS.盗賊, { agi: 67, str: 61, dex: 40, luk: 19, hp: 19, vit: 13, mp: 13 })
  assert.equal(Object.values(JOB_BONUS.盗賊).reduce((a, b) => a + b, 0), 232)
})

test('【確定】2026-10-16 ユーザー「17の案とりあえず入れてほしい」：職業ごとの倍率をやめて×1・能力で直した（配分は「高い2〜3種」を守る形）', async () => {
  const { ICHIJI_TUNE } = await import('./skillsIchiji.js')
  assert.deepEqual(ICHIJI_TUNE, {}, '上位クラスの倍率はやめた')
  // 弓使いの狙撃は今のⅡの技そのもの（初期職の倍率もやめた）・槍使いの技はこの版の名簿の値のまま
  { const { desc: _a, ...mine } = SKILL_BY_NAME['狙撃']; const { desc: _b, ...v2 } = V2_SKILLS.find(s => s.name === '狙撃'); assert.deepEqual(mine, v2) }  // 説明だけ写し（2026-10-16）
  assert.equal(SKILL_BY_NAME['突き'], NEW_SKILLS.find(s => s.name === '突き'))
  // 配分（9職）
  assert.deepEqual(JOB_BONUS.弓使い, { agi: 64, str: 48, dex: 41, hp: 34, luk: 19, vit: 13, mp: 13 })
  assert.deepEqual(JOB_BONUS.槍使い, { str: 79, dex: 50, agi: 30, hp: 26, vit: 23, mp: 16, luk: 8 })
  assert.deepEqual(JOB_BONUS.狂戦士, { str: 168, hp: 102, agi: 83, dex: 50, vit: 45, mp: 25, luk: 17 })
  assert.deepEqual(JOB_BONUS.魔銃士, { str: 108, int_stat: 108, dex: 75, agi: 58, hp: 46, mp: 45, luk: 33, vit: 17 })
  assert.deepEqual(JOB_BONUS.アークアーチャー, { dex: 142, luk: 103, agi: 92, hp: 55, str: 52, vit: 23, mp: 23 })
  assert.deepEqual(JOB_BONUS.元素使い, { int_stat: 158, mp: 102, hp: 75, agi: 67, dex: 40, vit: 32, luk: 16 })
  assert.deepEqual(JOB_BONUS.ストームランサー, { str: 125, dex: 103, agi: 85, hp: 75, vit: 57, mp: 28, luk: 17 })
  assert.deepEqual(JOB_BONUS.異端審問官, { int_stat: 142, mp: 102, hp: 78, vit: 67, agi: 56, dex: 28, luk: 17 })
  assert.deepEqual(JOB_BONUS.魔法剣士, { str: 133, int_stat: 125, hp: 70, agi: 67, vit: 40, mp: 38, luk: 17 })
  // 技とパッシブ
  const p = (c) => passiveOf(c).passive
  assert.equal(SKILL_BY_NAME['エリクサー'].healMax, 15)
  assert.equal(SKILL_BY_NAME['霊薬'].heal.rate, 1)
  assert.equal(SKILL_BY_NAME['ハイヒール'].heal.rate, 1.3)
  assert.equal(SKILL_BY_NAME['傷薬'].heal.rate, 0.8)
  assert.equal(p('聖職者').healBonus, undefined)
  assert.equal(p('式神使い').whileSummonOrGuard, 8)
  assert.deepEqual(p('死霊使い').guardPerStack, { key: 'undead', cut: 2 })
  assert.equal(p('クロノマンサー').extraIfFaster, 35)
  // 説明文も数字に合わせた
  assert.ok(SKILL_BY_NAME['エリクサー'].desc.startsWith('最大HPの15%を回復'))
  assert.ok(passiveOf('式神使い').desc.includes('+8%') && passiveOf('死霊使い').desc.includes('-2%') && passiveOf('クロノマンサー').desc.includes('35%'))
  assert.ok(!passiveOf('聖職者').desc.includes('回復量+20%'))
})

test('【確定】2026-10-17 ユーザー「なんで暗殺者の補助技上昇値低いの？全クラス基本統一してよ」：補助技の上げ幅は全職業で同じ決まり', () => {
  // 自分のステを上げる＝1つ+30%・2つ+20%ずつ／相手のステを下げる＝1つ−20%・2つ−15%ずつ（自分1つ＋相手1つ＝2つ）。仙丹（全能力）は別
  assert.deepEqual(BUFF_RULE, { up: { 1: 30, 2: 20 }, down: { 1: -20, 2: -15 } })
  assert.deepEqual(BUFF_RULE_EXEMPT, ['仙丹'])
  const word = (k) => (k === 'int_stat' ? 'INT' : k.toUpperCase())
  let n = 0
  for (const s of SKILLS) {
    const r = ruledBuffOf(s)
    if (!r) continue
    n++
    assert.deepEqual({ ...(s.buff.self ? { self: s.buff.self } : {}), ...(s.buff.enemy ? { enemy: s.buff.enemy } : {}) }, r, `${s.cls}・${s.name}`)
    // 説明文の数字も同じ（「AGI+30%」「相手のAGI-15%」）
    for (const [k, v] of Object.entries(r.self || {})) assert.ok(s.desc.includes(`${word(k)}+${v}%`), `${s.name}：${s.desc}`)
    for (const [k, v] of Object.entries(r.enemy || {})) assert.ok(s.desc.includes(`${word(k)}-${-v}%`) || s.desc.includes(`${word(k)}−${-v}%`), `${s.name}：${s.desc}`)
  }
  assert.ok(n >= 40, `決まりで見る補助技 ${n}個`)
  // 暗殺者の隠形（10-15 に+30→+10 にしていた）・魔法剣士の魔剣開放（+30ずつ）もほかと同じ
  assert.deepEqual(SKILL_BY_NAME['隠形'].buff.self, { agi: 30 })
  assert.deepEqual(SKILL_BY_NAME['魔剣開放'].buff.self, { str: 20, int_stat: 20 })
  assert.deepEqual(SKILL_BY_NAME['雄叫び'].buff, { self: { str: 20 }, enemy: { agi: -15 } })
  // 今のⅡの名簿は書き換えていない
  assert.deepEqual(V2_SKILLS.find(s => s.name === '駆け足').buff.self, { agi: 20 })
})
