// 2026-10-14 一次職の並び替え（ユーザー承認）の見張り（node --test）
//   ・V1の職業を続投（侍・魔法剣士・聖騎士・サイキッカーを足した・10職は名前だけ変えた）
//   ・新しい4職の技は今のⅡの同じ職業から8つ。強さは一次職の帯（初期職の帯×1.3）
//   ・ユーザー指示：サイキッカー（と魔銃士）は STRとINTを半分ずつ／聖騎士は VITも火力に直結（STRとVITを半分ずつ）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { skillValue, effectPrice, VALUE_TABLE } from '../../v2/lib/skills.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { ICHIJI_SKILLS, ICHIJI_CLASS_POWER } from './skillsIchiji.js'
import { ICHIJI_INFO, ICHIJI_RENAMED, CLASS_BY_ID, attackKindOf, learnOrderOf, JOB_BONUS } from './jobs.js'

const stats = (over = {}) => ({ hp: 100000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30, ...over })
const side = (cls, names, over = {}) => createSide({
  name: '自分', cls, kind: attackKindOf(cls), stats: stats(over), noClassBonus: true,
  slots: names.map(n => ({ skill: SKILL_BY_NAME[n], uses: 9 })), passives: passiveOf(cls) ? [passiveOf(cls)] : [],
})
const dummy = (over = {}) => createSide({ name: '的', cls: null, kind: 'phys', stats: stats({ hp: 100000000, ...over }), slots: [], passives: [], noClassBonus: true })
const mid = () => 0.5   // 命中する・クリティカルしない・発動率50%超の技は出る
const hit = (cls, name, me = {}, foe = {}) => {
  const log = []
  takeAction(side(cls, [name], me), dummy(foe), mid, log)
  const l = log.find(x => x.type === 'skill' && x.skill === name)
  assert.ok(l, `${name}を撃った`)
  return l.damage
}

test('【確定】2026-10-14 一次職の並び替え：22職・V1の職業を続投・前の名前の移し先がある', () => {
  assert.equal(Object.keys(ICHIJI_INFO).length, 22)
  for (const id of ['侍', '魔法剣士', '狂戦士', '聖騎士', '竜騎士', '体術師', 'サイキッカー', '暗殺者', '狩人', '魔銃士', '元素使い', '死霊使い', '式神使い', '聖職者', '異端審問官']) {
    assert.equal(CLASS_BY_ID[id]?.stage, 'ichiji', `V1の${id}がいる`)
  }
  for (const [old, now] of Object.entries(ICHIJI_RENAMED)) {
    assert.ok(!CLASS_BY_ID[old], `${old}は無い`)
    assert.equal(CLASS_BY_ID[now]?.stage, 'ichiji', `${old}→${now}`)
    assert.equal(ICHIJI_INFO[now].base, { 重戦士:'戦士', 気功師:'格闘家' }[old] || ICHIJI_INFO[now].base, `${now}の系統`)
  }
  assert.equal(ICHIJI_INFO.聖騎士.base, '戦士', '重戦士と同じ系統')
  assert.equal(ICHIJI_INFO.サイキッカー.base, '格闘家', '気功師と同じ系統')
  assert.deepEqual([ICHIJI_INFO.侍.base, ICHIJI_INFO.魔法剣士.base], ['剣士', '剣士'])
})

test('【確定】2026-10-14 強さをそろえた：攻撃の技は「目標の強さ（初期職の帯×1.3）×職業の倍率」に近い・新しい4職の覚える順・LUKを少し持つ', () => {
  const pick = (t, p) => { const ks = Object.keys(t).map(Number).sort((a, b) => b - a); return t[ks.find(k => p >= k) ?? ks[ks.length - 1]] }
  // 初期職の帯（85%まで）×1.3。85%より低い発動率は今のⅡの上位職の帯の伸び方（85%との比）で延ばす
  const band = (s) => {
    const basic = VALUE_TABLE.basic[s.kind], adv = VALUE_TABLE.advanced[s.kind]
    return (s.proc >= 85 ? pick(basic, s.proc) : pick(basic, 85) * pick(adv, s.proc) / pick(adv, 85)) * 1.3
  }
  const PRICED = new Set(['name','cls','kind','mult','add','hits','noCrit','sureHit','defPen','buff','ail','proc','mp','desc','drain','elem','dispel','cure','src','priority','hitBonus','switchKind','vsAil','consumeAil'])
  assert.deepEqual(Object.keys(ICHIJI_CLASS_POWER).sort(), Object.keys(ICHIJI_INFO).sort(), '22職ぶんある')
  let checked = 0
  for (const s of ICHIJI_SKILLS) {
    if (!(s.kind === 'phys' || s.kind === 'mag') || !Object.keys(s).every(k => PRICED.has(k))) continue
    const power = ICHIJI_CLASS_POWER[s.cls]
    assert.ok(power > 0, `${s.cls}の倍率`)
    // 威力のぶん（効果の値段を除く）で比べる＝倍率を大きく下げた職業でも、効果の値段は変わらないので
    const eff = effectPrice(s)
    const r = (skillValue(s) - eff) / (band(s) - eff) / power
    assert.ok(Math.abs(r - 1) <= 0.05, `${s.name}（${s.cls}）：目標×${power}に対して ${r.toFixed(3)}`)
    checked++
  }
  assert.ok(checked >= 70, `見た技 ${checked}`)
  // 連撃はクリティカルしない（初期職と同じ）。「回避したら全段クリティカル」の飛天三角蹴りだけは例外
  for (const s of ICHIJI_SKILLS) if ((s.kind === 'phys' || s.kind === 'mag') && ((s.hits || 1) >= 2 || s.hitMults)) {
    assert.equal(!!s.noCrit, !s.critIfDodged, `${s.name}`)
  }
  for (const cls of ['侍', '魔法剣士', '聖騎士', 'サイキッカー']) {
    assert.equal(ICHIJI_SKILLS.filter(s => s.cls === cls && s.kind !== 'passive').length, 8, `${cls}の技は8つ`)
    assert.ok(JOB_BONUS[cls].luk > 0, `${cls}はLUKを持つ（0だと相手のクリティカルが上限になる）`)
  }
  assert.deepEqual(learnOrderOf('侍').map(s => s.name), ['居合斬', '納刀', '抜刀術', '断空', '明鏡止水', '二段斬り', '桜花一閃', '月影'])
  assert.deepEqual(learnOrderOf('魔法剣士').map(s => s.name), ['マナエッジ', '雷光斬', '魔剣開放', 'フロストエッジ', 'マナバースト', '双極斬', 'ソードオーラ', 'エレメンタルエッジ'])
  assert.deepEqual(learnOrderOf('聖騎士').map(s => s.name), ['ホーリーエッジ', 'オースシールド', 'シールドバッシュ', 'ディバインスマイト', 'ホーリーケア', '大防御', 'ジャッジメントブロウ', '神聖覚醒'])
  assert.deepEqual(learnOrderOf('サイキッカー').map(s => s.name), ['サイコショット', '精神集中', 'テレキネシス', 'マインドブレイク', 'マインドスパイク', 'マインドアクセル', 'サイキックチェイン', 'サイコブラスト'])
  assert.deepEqual(['侍', '魔法剣士', '聖騎士', 'サイキッカー'].map(c => passiveOf(c)?.name), ['居合の構え', '魔導剣術', '聖騎士の心得', '第六感'])
})

test('【確定】ユーザー指示：サイキッカーはSTRとINTが半分ずつ威力になる（念の技は相手の魔法防御で受ける）', () => {
  for (const s of ICHIJI_SKILLS.filter(x => x.cls === 'サイキッカー' && (x.kind === 'phys' || x.kind === 'mag'))) {
    assert.equal(s.src, 'str', `${s.name}の主はSTR`)
    assert.deepEqual(s.add, [{ stat: 'int_stat', rate: s.mult }], `${s.name}はSTRとINTが同じ倍率`)
  }
  const base = hit('サイキッカー', 'サイコショット')
  const moreStr = hit('サイキッカー', 'サイコショット', { str: 400 })
  const moreInt = hit('サイキッカー', 'サイコショット', { int_stat: 400 })
  assert.ok(moreStr > base && moreInt > base, 'STRでもINTでも伸びる')
  // 受けるのは魔法防御（INT×0.5＋VIT×0.5）：相手のINTを上げると減り、物理防御だけ（VITの半分）より効く
  const vsInt = hit('サイキッカー', 'サイコショット', {}, { int_stat: 3000 })
  assert.ok(vsInt < base, '相手のINTで減る＝魔法防御で受けている')
})

test('【確定】ユーザー指示：聖騎士はVITも火力に直結する（攻撃の技はSTRとVITが半分ずつ）', () => {
  for (const s of ICHIJI_SKILLS.filter(x => x.cls === '聖騎士' && (x.kind === 'phys' || x.kind === 'mag'))) {
    assert.deepEqual(s.add, [{ stat: 'vit', rate: s.mult }], `${s.name}はSTRとVITが同じ倍率`)
  }
  const base = hit('聖騎士', 'ジャッジメントブロウ')
  const moreVit = hit('聖騎士', 'ジャッジメントブロウ', { vit: 450 })
  const moreStr = hit('聖騎士', 'ジャッジメントブロウ', { str: 600 })
  // VIT+300 と STR+300 で、威力の伸びがほぼ同じ（STRは防御の軽減の計算にも入るので少しだけ違う）
  assert.ok(Math.abs((moreVit - base) / (moreStr - base) - 1) < 0.15, `VIT+300で+${moreVit - base}・STR+300で+${moreStr - base}`)
})

test('【確定】侍：納刀で次の技が威力1.5倍／聖騎士：大防御で1ターン受けるダメージ-60%', () => {
  // 納刀 → 居合斬
  const me = side('侍', ['納刀', '居合斬'])
  const foe = dummy()
  const log = []
  takeAction(me, foe, mid, log)
  takeAction(me, foe, mid, log)
  const withStance = log.find(l => l.type === 'skill' && l.skill === '居合斬').damage
  const plain = hit('侍', '居合斬')
  // ★今のⅡの戦闘エンジンの決まり：納刀の1.5倍は主のステ（STR×倍率）のぶんに掛かり、DEXの上乗せには掛からない
  const iai = SKILL_BY_NAME['居合斬']
  const strPart = 300 * iai.mult, dexPart = 150 * iai.add[0].rate
  const want = (strPart * 1.5 + dexPart) / (strPart + dexPart)
  assert.ok(Math.abs(withStance / plain - want) < 0.02, `納刀のあと ${withStance}／ふつう ${plain}（${want.toFixed(3)}倍のはず）`)
  // 大防御
  const tank = side('聖騎士', ['大防御'])
  const enemy = createSide({ name: '敵', cls: null, kind: 'phys', stats: stats(), slots: [], passives: [], noClassBonus: true })
  const l2 = []
  takeAction(tank, enemy, mid, l2)
  const before = tank.hp
  takeAction(enemy, tank, mid, l2)
  const guarded = before - tank.hp
  const t2 = side('聖騎士', [])
  const e2 = createSide({ name: '敵', cls: null, kind: 'phys', stats: stats(), slots: [], passives: [], noClassBonus: true })
  const b2 = t2.hp
  takeAction(e2, t2, mid, [])
  const open = b2 - t2.hp
  assert.ok(guarded < open * 0.5, `大防御 ${guarded}／なし ${open}`)
})

test('【確定】魔銃士：技は物理と魔法の両方（STRとINTが半分ずつ）のまま・クラスのステはSTRとINTが同じ・HPとLUKを足した', () => {
  for (const s of ICHIJI_SKILLS.filter(x => x.cls === '魔銃士' && x.hybrid)) assert.equal(s.hybrid.phys, s.hybrid.mag, s.name)
  assert.equal(JOB_BONUS.魔銃士.str, JOB_BONUS.魔銃士.int_stat)
  assert.ok(JOB_BONUS.魔銃士.luk >= 30 && JOB_BONUS.魔銃士.hp >= 60, '2026-10-14 HPとLUKを足した（前はLUK0・HP40）')
  assert.equal(attackKindOf('魔銃士'), 'phys', 'ユーザー決定：通常攻撃は物理（STR）のまま')
})
