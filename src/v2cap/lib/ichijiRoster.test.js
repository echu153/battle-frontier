// 2026-10-14 上位職の並び替え（ユーザー承認）・2026-10-15 上位クラスの作り直し（チャット版の設計＋測って合わせた数字）の見張り（node --test）
//   ・V1の職業を続投（侍・魔法剣士・聖騎士・サイキッカーを足した・10職は名前だけ変えた）
//   ・新しい4職の技は今のⅡの同じ職業から8つ。強さは上位職の帯（初期職の帯×1.3）
//   ・ユーザー指示：サイキッカー（と魔銃士）は STRとINTを半分ずつ／聖騎士は VITも火力に直結（STRとVITを半分ずつ）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { ICHIJI_SKILLS, ICHIJI_TUNE } from './skillsIchiji.js'
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

test('【確定】2026-10-14 上位職の並び替え：22職・V1の職業を続投・前の名前の移し先がある', () => {
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

test('2026-10-15 測って合わせた（チャットの設計の値×ICHIJI_TUNE）：職業の倍率は極端にしない（0.8〜1.25倍）・連撃はクリティカルなし・4職の覚える順・LUKを少し持つ', () => {
  // ユーザーの決まり（2026-10-15）「どのクラスも技倍率は極端に上げたり下げたりしないで」
  for (const [cls, k] of Object.entries(ICHIJI_TUNE)) {
    assert.ok(ICHIJI_INFO[cls], `${cls}は上位クラス`)
    assert.ok(k >= 0.8 && k <= 1.25, `${cls}の倍率 ${k} は 0.8〜1.25`)
  }
  // 連撃はクリティカルしない（初期職と同じ）。「回避したら全段クリティカル」の飛天三角蹴りだけは例外
  for (const s of ICHIJI_SKILLS) if ((s.kind === 'phys' || s.kind === 'mag') && ((s.hits || 1) >= 2 || s.hitMults)) {
    assert.equal(!!s.noCrit, !s.critIfDodged, `${s.name}`)
  }
  for (const cls of ['侍', '魔法剣士', '聖騎士', 'サイキッカー']) {
    assert.equal(ICHIJI_SKILLS.filter(s => s.cls === cls && s.kind !== 'passive').length, 10, `${cls}の技は10個`)
    assert.ok(JOB_BONUS[cls].luk > 0, `${cls}はLUKを持つ（0だと相手のクリティカルが上限になる）`)
  }
  assert.deepEqual(learnOrderOf('侍').map(s => s.name), ['居合斬', '納刀', '抜刀術', '断空', '明鏡止水', '二段斬り', '桜花一閃', '二の太刀', '月影', '秘剣・叢雲'])
  assert.deepEqual(learnOrderOf('魔法剣士').map(s => s.name), ['マナエッジ', '雷光斬', '魔剣開放', 'フロストエッジ', 'マナバースト', '双極斬', 'ソードオーラ', 'フレイムエッジ', 'エレメンタルエッジ', 'トリニティブレイド'])
  assert.deepEqual(learnOrderOf('聖騎士').map(s => s.name), ['ホーリーエッジ', 'オースシールド', 'シールドバッシュ', 'ディバインスマイト', 'ホーリーケア', '大防御', 'ジャッジメントブロウ', '不動の誓い', '神聖覚醒', 'グランドクロス'])
  assert.deepEqual(learnOrderOf('サイキッカー').map(s => s.name), ['サイコショット', '精神集中', 'テレキネシス', 'マインドブレイク', 'マインドスパイク', 'マインドアクセル', 'サイキックチェイン', 'マインドジャック', 'サイコブラスト', 'メンタルクラッシュ'])
  // パッシブは設計で名前が変わったもの（魔導剣術→エンチャント・第六感→精神感応・魔力循環→魔弾）
  assert.deepEqual(['侍', '魔法剣士', '聖騎士', 'サイキッカー', '魔銃士'].map(c => passiveOf(c)?.name), ['居合の構え', 'エンチャント', '聖騎士の心得', '精神感応', '魔弾'])
})

test('2026-10-15 測って直した仕組みの数字（強さの元を先に直した・理由は skillsIchiji.js の②）', () => {
  const v = (n) => SKILL_BY_NAME[n]
  // 狂戦士：HPを払う技と狂撃の「+15%」をやめた・バーサク +10/+20%（★狂鬼化は設計のまま＝ユーザーと相談）
  assert.deepEqual(['マッドラッシュ', 'ブラッドスプラッシュ', 'ブラッドサクリファイス', 'フルブレイカー', '狂撃'].map(n => v(n).mult), [1.63, 1.71, 1.76, 1.74, 2.02])
  assert.deepEqual(passiveOf('狂戦士').passive.lowHpDmg, [{ at: 50, pct: 10 }, { at: 25, pct: 20 }])
  assert.deepEqual(v('狂鬼化').lastStand, { costCut: 50 }, '狂鬼化の「払うHPが半分」は設計どおり')
  assert.equal(v('隠形').buff.self.agi, 10)
  assert.equal(v('影斬り').mult, 1.35)
  assert.deepEqual(passiveOf('忍者').passive, { cloneFollow: 0.1, noCloneAgi: 10, cloneGuard: 15 })
  assert.deepEqual([v('骸骨召喚').summon.mult, v('レイズデッド').summon.mult, v('ソウルハーヴェスト').perStackAdd.addMult], [0.35, 0.35, 0.2])
  assert.equal(passiveOf('死霊使い').passive.guardPerStack.cut, 4)
  assert.equal(v('仙丹').buff.self.str, 10)
  assert.equal(v('リザレクション').revive.pct, 35)
  assert.deepEqual(['ジャンプ', 'ハイジャンプ', '天竜落とし'].map(n => v(n).jump.evade), [40, 40, 40])
  assert.equal(v('秘剣・叢雲').stanceMult, 1.7)
  // 跳躍の技の倍率（説明用の mult）と着地の倍率は同じ
  for (const n of ['ジャンプ', 'ハイジャンプ', '天竜落とし']) assert.equal(v(n).mult, v(n).jump.mult, n)
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
