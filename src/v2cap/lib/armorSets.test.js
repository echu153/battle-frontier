// v2cap：防具のセット能力の決まりを固定するテスト（node --test）
// 【確定】2026-10-14 ユーザーの表（2部位・3部位・4部位）＋ユーザーの選択（armorSets.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_STATS } from '../../v2/lib/stats.js'
import { AIL_KEYS } from '../../v2/lib/ailments.js'
import { ITEM_BY_ID, ITEMS } from './equipment.js'
import { AREA_LIST } from './areas.js'
import {
  ARMOR_SETS, SET_RESIST_PCT, SET_RESIST_ALL_PCT, isSetPiece, armorSetsOf, setFxOf, setStatPctOf, setTierText, setLabel,
} from './armorSets.js'
import { statBreakdown, toFighter, setsOf } from './loadout.js'
import { dropRarityOf, DROP_RARITY } from './sortie.js'
import { REACTION_TYPES } from './battleView.js'

const I = (id) => ITEM_BY_ID[id]

test('【確定】表のとおり：2部位の状態異常・3部位の能力値・4部位の名前（エリア1〜15）', () => {
  assert.equal(ARMOR_SETS.length, AREA_LIST.length)
  assert.deepEqual(ARMOR_SETS.map(s => s.two), [
    ['poison'], ['bleed'], ['curse'], ['blind'], ['slow'], ['fear'], ['poison', 'blind'], ['slow', 'seal'],
    ['paralyze'], ['burn'], ['poison', 'curse'], ['blind', 'fear'], ['paralyze', 'seal'], ['slow', 'curse'], 'all',
  ])
  for (const s of ARMOR_SETS) if (s.two !== 'all') for (const k of s.two) assert.ok(AIL_KEYS.includes(k), k)
  // 3部位は重鎧・軽装で共通＝表の「3部位（軽装）」の列（ユーザー選択）。深淵の海溝は STR〜LUK の6種+3%（ユーザー選択）
  assert.deepEqual(ARMOR_SETS.map(s => s.three), [
    { agi: 5 }, { str: 5 }, { int_stat: 5 }, { dex: 5 }, { int_stat: 5 }, { str: 5 }, { int_stat: 5 }, { int_stat: 5 },
    { agi: 5 }, { str: 5 }, { int_stat: 5 }, { dex: 5 }, { agi: 5 }, { int_stat: 5 },
    { str: 3, dex: 3, agi: 3, int_stat: 3, vit: 3, luk: 3 },
  ])
  assert.deepEqual(ARMOR_SETS.map(s => [s.four.重鎧.name, s.four.軽装.name]), [
    ['森の恵み', '若葉の息吹'], ['古兵の意地', '群狼の牙'], ['番人の守り', '遺物の加護'], ['珊瑚の甲殻', '海賊の嗅覚'],
    ['砂嵐の帳', '蜃気楼'], ['巨人の剛力', '峰風'], ['根を張る', '夜霧'], ['氷河の守り', '霊峰の加護'],
    ['帯電装甲', '迅雷'], ['炎獄の鎧', '業火'], ['毒龍の鱗', '瘴気'], ['大地の守り', '蜘蛛の糸'],
    ['天騎士の誓い', '天翼'], ['悠久の守り', '星詠み'], ['深淵の加護', '深淵の力'],
  ])
  // 海賊の嗅覚は「ドロップ率+10%」をやめて、レア以上が落ちる確率1.2倍（ユーザー指示・ユーザー選択）
  assert.deepEqual(ARMOR_SETS[3].four.軽装.fx, { rareDropMult: 1.2 })
  // 文
  assert.equal(setTierText(ARMOR_SETS[0], 2, '重鎧'), `毒にかかる確率-${SET_RESIST_PCT}%`)
  assert.equal(setTierText(ARMOR_SETS[6], 2, '軽装'), '毒・暗闇にかかる確率-30%')
  assert.equal(setTierText(ARMOR_SETS[14], 2, '重鎧'), `すべての状態異常にかかる確率-${SET_RESIST_ALL_PCT}%`)
  assert.equal(setTierText(ARMOR_SETS[0], 3, '軽装'), 'AGI+5%')
  assert.ok(setTierText(ARMOR_SETS[14], 3, '重鎧').startsWith('全能力+3%'))
  assert.equal(setTierText(ARMOR_SETS[2], 4, '重鎧'), '番人の守り：戦闘中1回、倒れるダメージを受けてもHP1で耐える')
  assert.equal(setLabel(1, '重鎧'), '始まりの森・重鎧')
})

test('【確定】数えるのはレア以上の防具（頭・鎧・腕・足）だけ。ノーマル・武器・装飾品・初期装備は数えない', () => {
  assert.equal(isSetPiece(I('1R:重鎧頭')), true)
  assert.equal(isSetPiece(I('1E:軽装鎧')), true)
  assert.equal(isSetPiece(I('15L:軽装足')), true)
  assert.equal(isSetPiece(I('1N:重鎧頭')), false, 'ノーマル')
  assert.equal(isSetPiece(I('1L:片手剣')), false, '武器')
  assert.equal(isSetPiece(I('1L:リング')), false, '装飾品')
  const starter = Object.values(ITEM_BY_ID).find(it => it.area === 0 && it.line)
  assert.ok(starter && isSetPiece(starter) === false, '初期装備（見習いの◯◯）')
  // 全部の防具（レア以上）がどこかのセットに入る
  for (const it of ITEMS.filter(x => x.line && x.rarity !== 'N')) assert.equal(isSetPiece(it), true, it.id)
})

test('【確定】同じエリア・同じ系統でそろえたときだけ発動（レア度は混ぜてよい）。2つの組が同時に発動することもある', () => {
  const sets = (...ids) => armorSetsOf(ids.map(I)).map(s => ({ area: s.area, line: s.line, count: s.count, tiers: s.tiers }))
  assert.deepEqual(sets('1R:重鎧頭', '1L:重鎧鎧'), [{ area: 1, line: '重鎧', count: 2, tiers: [2] }])
  assert.deepEqual(sets('1R:重鎧頭', '1L:軽装鎧'), [], '重鎧と軽装は混ぜない（ユーザー「すべて重鎧軽装揃えないと発動しない」）')
  assert.deepEqual(sets('1R:重鎧頭', '2R:重鎧鎧'), [], '違うエリアは混ぜない')
  assert.deepEqual(sets('1N:重鎧頭', '1R:重鎧鎧'), [], 'ノーマルは数えない')
  assert.deepEqual(sets('1R:重鎧頭', '1E:重鎧鎧', '1L:重鎧腕'), [{ area: 1, line: '重鎧', count: 3, tiers: [2, 3] }])
  assert.deepEqual(sets('3R:軽装頭', '3E:軽装鎧', '3L:軽装腕', '3R:軽装足'), [{ area: 3, line: '軽装', count: 4, tiers: [2, 3, 4] }])
  assert.deepEqual(sets('2R:軽装頭', '2R:軽装鎧', '1L:重鎧腕', '1L:重鎧足'), [
    { area: 1, line: '重鎧', count: 2, tiers: [2] }, { area: 2, line: '軽装', count: 2, tiers: [2] },
  ])
})

test('戦闘で使う形：2部位＝確率×0.7（同じ状態異常が2つなら掛け合わせ）・深淵の海溝×0.8・4部位は表の効果と名前', () => {
  const fx = (...ids) => setFxOf(armorSetsOf(ids.map(I)))
  assert.equal(fx('1R:重鎧頭'), null, '1部位だけなら何も無い')
  assert.deepEqual(fx('1R:重鎧頭', '1R:重鎧鎧'), { resist: { poison: 0.7 }, names: {} })
  const two = fx('1R:重鎧頭', '1R:重鎧鎧', '7R:軽装腕', '7R:軽装足')
  assert.ok(Math.abs(two.resist.poison - 0.49) < 1e-12)
  assert.ok(Math.abs(two.resist.blind - 0.7) < 1e-12)
  assert.ok(Math.abs(fx('15R:重鎧頭', '15R:重鎧鎧').resistAll - 0.8) < 1e-12)
  const four = fx('9R:重鎧頭', '9R:重鎧鎧', '9R:重鎧腕', '9R:重鎧足')
  assert.deepEqual(four.counterAil, [{ key: 'paralyze', chance: 15 }])
  assert.equal(four.names.counterAil, '帯電装甲')
  const fog = fx('11L:軽装頭', '11L:軽装鎧', '11L:軽装腕', '11L:軽装足')
  assert.ok(Math.abs(fog.inflictUp.poison - 1.15) < 1e-12, '付与確率+15%＝×1.15（ユーザー選択「確率を1割増やす」）')
  assert.equal(fog.poisonDmgPct, 20)
  assert.ok(Math.abs(fx('15L:軽装頭', '15L:軽装鎧', '15L:軽装腕', '15L:軽装足').inflictUpAll - 1.1) < 1e-12)
  assert.equal(fx('4R:軽装頭', '4R:軽装鎧', '4R:軽装腕', '4R:軽装足').rareDropMult, 1.2)
  // 3部位では4部位の効果は付かない
  assert.equal(fx('9R:重鎧頭', '9R:重鎧鎧', '9R:重鎧腕').counterAil, undefined)
  assert.deepEqual(setStatPctOf(armorSetsOf(['9R:重鎧頭', '9R:重鎧鎧', '9R:重鎧腕'].map(I))), { agi: 5 })
})

test('【確定】ステの合計に3部位の能力値+%が乗り、戦闘には setFx が渡る。必要LVに足りない防具も数える', () => {
  const prof = { username: 't', class: '盗賊', lv: 1, ...INITIAL_STATS, jobs: { 盗賊: { lv: 1, exp: 0 } }, learned: [], skill_sets: {},
    equipped: { head: 1, body: 2, arm: 3 } }
  const inv = [
    { id: 1, base_id: '1R:軽装頭', ilv: 10, plus: 0 },
    { id: 2, base_id: '1L:軽装鎧', ilv: 20, plus: 0 },   // 必要LV20（LV1なので効果は弱まるが、セットには数える）
    { id: 3, base_id: '1E:軽装腕', ilv: 15, plus: 0 },
  ]
  assert.deepEqual(setsOf(prof, inv).map(s => [s.area, s.line, s.count]), [[1, '軽装', 3]])
  const bd = statBreakdown(prof, inv)
  const before = bd.total.agi - bd.set.agi
  assert.equal(bd.set.agi, Math.round(before * 5 / 100))
  assert.ok(bd.set.agi > 0)
  for (const k of ['hp', 'mp', 'str', 'dex', 'int_stat', 'vit', 'luk']) assert.equal(bd.set[k], 0, k)
  const f = toFighter(prof, inv)
  assert.equal(f.stats.agi, bd.total.agi)
  assert.deepEqual(f.setFx, { resist: { poison: 0.7 }, names: {} })
  // 1部位はずすと発動しない
  const off = { ...prof, equipped: { head: 1 } }
  assert.deepEqual(setsOf(off, inv), [])
  assert.equal(toFighter(off, inv).setFx, null)
  assert.equal(statBreakdown(off, inv).set.agi, 0)
})

test('海賊の嗅覚：レア以上の割合だけ1.2倍（落ちる確率そのものは変えない）。100%を超えたらノーマルを0にして割り戻す', () => {
  // 掛けないときは前のまま
  assert.deepEqual(dropRarityOf('boss', 1), { N: 40, R: 35, E: 20, L: 5 })
  assert.deepEqual(dropRarityOf('boss', 3), { N: 16, R: 49, E: 28, L: 7 })
  assert.deepEqual(dropRarityOf('normal', 1, 1.2), { N: 82, R: 18 })
  assert.deepEqual(dropRarityOf('boss', 1, 1.2), { N: 28, R: 42, E: 24, L: 6 })
  const top = dropRarityOf('boss', 3, 1.2)
  const sum = Object.values(top).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 100) < 0.21, `${sum}`)
  assert.ok(top.N >= 0 && top.N < 0.5)
  assert.ok(top.L > DROP_RARITY.boss.L * 1.4)
  for (const role of Object.keys(DROP_RARITY)) for (const sub of [1, 2, 3]) {
    const d = dropRarityOf(role, sub, 1.2)
    assert.ok(Object.values(d).every(v => v >= 0), `${role}${sub}`)
    assert.deepEqual(Object.keys(d).sort(), Object.keys(DROP_RARITY[role]).sort(), '出るレア度の種類は変わらない（サーバーの判定と同じ）')
  }
})

test('戦闘ログ：セット能力の行（蜃気楼・番人の守りなど）は相手の行動のまとまりに入る', () => {
  assert.ok(REACTION_TYPES.has('setFx'))
})
