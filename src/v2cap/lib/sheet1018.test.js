// 2026-10-18 ユーザーがスキル一覧のシート（https://claude.ai/artifact/AaoayDDrPVAk2oXbyhBAHW）で直した115件（node --test）
//   ・技の元の値と説明（シートの power・desc・name）／アセンションの特別なマス（ASC_CUSTOM・採用した案と書き直した案）
//   ・答え：エリクサー100%回復（マスは薬効+3→+5）・薬効の上限20・薬効解放は薬効を減らさない・五連殺は説明だけ短く・
//     ホーリーエッジはただの攻撃・鉄身薬のマスは薬効+1→+2
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSide, takeAction, liveStats } from '../../v2/lib/battle.js'
import { ichijiSkillPrep } from '../../v2/lib/battleIchiji.js'
import { SKILL_BY_NAME, SKILL_RENAMED, passiveOf, capPowerText } from './skills.js'
import { attackKindOf } from './jobs.js'
import { ASC_CUSTOM, ascendSkill, ascTypeOf, ascSkillDetail } from './ascension.js'
import { fromSnapshot } from './tower.js'

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
const cast = (cls, skill, setup = () => {}, rng = mid, foe = dummy()) => {
  const me = side('私', cls, [skill])
  setup(me, foe)
  const log = []
  takeAction(me, foe, rng, log)
  const name = typeof skill === 'string' ? skill : skill.name
  return { me, foe, log, e: log.find(l => l.type === 'skill' && l.skill === name) }
}

test('【確定】2026-10-18 シートで直した技の元の値と説明', () => {
  // 聖騎士：ホーリーエッジはただの攻撃（ユーザー選択）・ディバインスマイト STR−20→−10%
  assert.equal(S('ホーリーエッジ').buff, undefined)
  assert.equal(S('ホーリーエッジ').desc, '聖なる刃で斬りつける')
  assert.deepEqual(S('ディバインスマイト').buff.enemy, { str: -10 })
  // 体術師：破衝掌の空中の防御無視（計50%）はマスへ・巴投げ AGI−15→−10%・受け流しはずっと続く（ほかの補助技と同じ）・
  //   五連殺は説明だけ短く（中身は今のまま＝ユーザー選択）
  assert.deepEqual([S('破衝掌').defPen, S('破衝掌').inAir], [0.3, { mult: 40 }])
  assert.deepEqual(S('巴投げ').buff.enemy, { agi: -10 })
  assert.equal(S('受け流し').buffTurns, undefined)
  assert.equal(S('受け流し').desc, '自分のAGI+30%')
  assert.equal(S('五連殺').desc, '5連撃。')
  assert.deepEqual([S('五連殺').hits, S('五連殺').noCrit, S('五連殺').inAir], [5, true, { hits: 1, keepAir: true }])
  // 暗殺者・狩人・アークアーチャー
  assert.deepEqual(S('絶命').foeLowHp, { at: 20, mult: 3 })
  assert.equal(passiveOf('暗殺者').passive.perFoeBleed, 5)
  assert.equal(S('毒矢').ail.chance, 50)
  assert.equal(S('ロックオン').lockOn.critDmg, 15)
  // デストロイヤー：装填の上限 3→5（装填を増やす技ぜんぶ・カーペットボムの連撃も最大+5）
  for (const n of ['装填', '速射', '弾薬補給', '弾帯換装']) assert.equal(S(n).gain.max, 5, n)
  assert.equal(S('カーペットボム').hitsPerStackUse.max, 5)
  assert.equal(S('装填').desc, '装填+1（最大5）')
  // 元素使い：メテオ→メテオストライク（3〜5連撃・1ヒットごとに10%で火傷・クリティカルなし）
  assert.equal(SKILL_BY_NAME['メテオ'], undefined)
  const m = S('メテオストライク')
  assert.deepEqual([m.mult, m.hitsRange, m.noCrit, m.ail, m.ailPerHit, m.mp, m.elem], [0.6, [3, 5], true, { key: 'burn', chance: 10 }, true, 22, 'fire'])
  assert.equal(capPowerText(m), 'INT×0.6 ×3〜5回', 'スキル画面の威力の行')
  // 式神使い・アルケミスト
  assert.equal(passiveOf('式神使い').passive.whileSummonOrGuard, 10)
  assert.deepEqual(S('メガボム').consumeAllAil, { per: 25, max: 90 })
  // 霊薬師：薬効の上限 5→20（ユーザー選択）・仙丹 全能力+5%・エリクサー100%・浸透薬 最大60%・薬効解放は減らさない
  for (const n of ['剛力薬', '叡智の薬', '鉄身薬', '仙丹', 'エリクサー']) assert.equal(S(n).gain.max, 20, n)
  assert.deepEqual(S('仙丹').buff.self, { str: 5, dex: 5, agi: 5, int_stat: 5, vit: 5, luk: 5 })
  assert.equal(S('エリクサー').healMax, 100)
  assert.deepEqual(S('浸透薬').defPenPerStack, { key: 'potion', per: 0.03, max: 0.6 })
  assert.equal(S('薬効解放').useAll, undefined, '薬効を減らさない（ユーザー選択）')
  assert.deepEqual([S('薬効解放').mult, S('薬効解放').perStack], [1.1, { key: 'potion', pct: 5, max: 100 }])
  // 調合の極意は薬効5つぶん（最大+25%）で止める（ユーザー選択＝上限を20にしても今と同じ）
  assert.deepEqual(passiveOf('霊薬師').passive.perStackDmg, { key: 'potion', pct: 5, max: 25 })
  assert.equal(passiveOf('霊薬師').desc, '薬効1つにつき与ダメージ+5%（最大+25%）')
})

test('【確定】2026-10-18 シートで採用・書き直したアセンションの特別なマス（ほかの20職）', () => {
  const up = (n) => ascendSkill(S(n))
  // ユーザーが書いたもの
  assert.equal(up('エレメンタルエッジ').imbueMult, 3)
  assert.equal(up('グランドクロス').useHoly.mult, 1.4)
  assert.equal(up('ジャッジメントブロウ').useHoly.mult, 1.3)
  assert.deepEqual(up('ディバインスマイト').buff.enemy, { str: -15 }, '下げ幅+5（ふつうのマス）')
  assert.equal(up('神聖覚醒').buff.self.vit, 10)
  assert.equal(up('シールドバッシュ').add.find(a => a.stat === 'vit').rate, Math.round((S('シールドバッシュ').add[0].rate + 0.8) * 1000) / 1000)
  assert.deepEqual(up('オースシールド').guard, { cut: 5, turns: 3 })
  assert.equal(up('連突き').comboStep2, 50)
  assert.ok(Math.abs(up('破衝掌').inAir.defPen - 0.2) < 1e-9)
  assert.equal(up('旋風脚').inAir.mult, 45)
  assert.equal(up('受け流し').evaUp, 3)
  assert.equal(up('絶命').foeLowHp.mult, 4)
  assert.equal(up('毒矢').ail.chance, 65, 'ふつうのマス（毒+15）')
  assert.equal(up('エーテルバレット').mpRatioPower.max, 60)
  assert.equal(up('カーペットボム').noCrit, false)
  assert.equal(up('メテオストライク').proc, 90)
  assert.equal(up('火刑').proc, 85)
  assert.equal(up('メガボム').consumeAllAil.per, 35)
  assert.deepEqual(up('仙丹').regenMax, { pct: 4, turns: 3 })
  assert.equal(up('エリクサー').gain.n, 5, 'ユーザー選択：100%回復にしたので薬効+3→+5')
  assert.equal(up('鉄身薬').gain.n, 2, 'ユーザー選択：薬効+1→+2')
  assert.ok(Math.abs(up('浸透薬').defPenPerStack.per - 0.06) < 1e-9)
  assert.equal(up('薬効解放').perStack.pct, 10)
  // 採用した案（いくつか）
  assert.equal(up('双極斬').whileImbue.mult, 1.45)
  assert.equal(up('天竜落とし').jump.defPen, 0.5)
  assert.deepEqual(up('流星突き').comboHits, { at: 10, hits: 8 })
  assert.deepEqual(up('ワイルドハント').hitsByAil, [{ at: 2, n: 2 }, { at: 4, n: 3 }])
  assert.deepEqual(up('手裏剣').hitsPerStack, { key: 'clone', n: 1 })
  assert.equal(up('隠形').nextCrit, true)
  assert.equal(up('聖水').dispel.n, 2)
  assert.deepEqual([up('レイズデッド').summon.max, up('レイズデッド').summon.setMax], [5, 5])
  assert.equal(up('骸骨召喚').summon.n, 2)
  assert.equal(ascSkillDetail('絶命'), '相手のHPが20%以下なら威力3倍→4倍')
  assert.equal(ascSkillDetail('メテオストライク'), '発動率 75%→90%')
  assert.equal(ascSkillDetail('グランドクロス'), '使った聖光の追加ダメージ ×1→×1.4')
  // どのマスも技が変わり、説明がある（「効かないマス」を作らない）
  for (const [n, c] of Object.entries(ASC_CUSTOM)) {
    assert.notDeepEqual(c.apply(S(n)), S(n), `${n}のマスで技が変わる`)
    assert.ok(c.short && c.detail(S(n)) && !/undefined|NaN/.test(c.detail(S(n))), `${n}の文`)
  }
  assert.equal(Object.keys(ASC_CUSTOM).length, 114, '前からの7つ（侍・狂戦士）＋シートで直した107（ディバインスマイト・毒矢はふつうのマスのまま）')
  assert.equal(ascTypeOf(S('聖水')), 'custom')
})

test('聖光：グランドクロスのマスは使った聖光の追加ダメージ×1.4／ホーリーケアのマスは回復した量の20%を聖光に', () => {
  const holy = (me) => { me.holy = 1000 }
  const base = cast('聖騎士', 'グランドクロス', holy), asc = cast('聖騎士', ascendSkill(S('グランドクロス')), holy)
  const used = base.log.find(l => l.type === 'holyUse').n
  assert.ok(used > 0)
  assert.equal(asc.e.damage - base.e.damage, Math.floor(used * 1.4) - used, `${asc.e.damage} − ${base.e.damage}`)
  const low = (me) => { me.hp = 1000; me.holy = 0 }
  const b = cast('聖騎士', 'ホーリーケア', low), a = cast('聖騎士', ascendSkill(S('ホーリーケア')), low)
  assert.equal(b.me.holy, 0)
  const healed = a.me.hp - 1000
  assert.ok(healed > 0)
  assert.equal(a.me.holy, Math.min(Math.floor(a.me.base.hp * passiveOf('聖騎士').passive.holy.cap / 100), Math.floor(healed * 0.2)))
})

test('雷光斬のマスは雷が4ターン宿る／連突きのマスは50%で1ヒットのコンボ+2', () => {
  const b = cast('魔法剣士', '雷光斬'), a = cast('魔法剣士', ascendSkill(S('雷光斬')))
  assert.equal(a.me.imbue.turns, b.me.imbue.turns + 1)
  assert.equal(b.me.imbue.turns, passiveOf('魔法剣士').passive.imbue.turns)
  // 乱数0.3：50%の判定に入る＝1ヒットごとに+2
  const cb = cast('ストームランサー', '連突き', () => {}, fixed(0.3)), ca = cast('ストームランサー', ascendSkill(S('連突き')), () => {}, fixed(0.3))
  assert.ok(cb.me.combo > 0)
  assert.equal(ca.me.combo, cb.me.combo * 2)
  // 乱数0.7：50%の判定に入らない＝ふつう
  const cn = cast('ストームランサー', ascendSkill(S('連突き')), () => {}, fixed(0.7))
  assert.equal(cn.me.combo, cast('ストームランサー', '連突き', () => {}, fixed(0.7)).me.combo)
})

test('影討ちのマスは2ターン目まで／隠形のマスは次の攻撃の技が必ずクリティカル（クリティカルしない技では残す）', () => {
  const t1 = (me) => { me.turn = 1 }
  const b = cast('暗殺者', '影討ち', t1), a = cast('暗殺者', ascendSkill(S('影討ち')), t1)
  assert.ok(Math.abs(a.e.damage / b.e.damage - S('影討ち').firstTurn.mult) < 0.03, `${a.e.damage}／${b.e.damage}`)
  const t2 = (me) => { me.turn = 2 }
  assert.equal(cast('暗殺者', ascendSkill(S('影討ち')), t2).e.damage, cast('暗殺者', '影討ち', t2).e.damage, '3ターン目からは効かない')
  // 隠形→裂傷：乱数0.5ではふつうクリティカルしない
  const me = side('暗', '暗殺者', [ascendSkill(S('隠形')), '裂傷'])
  const foe = dummy()
  takeAction(me, foe, mid, [])
  assert.equal(me.nextCrit, true)
  const log = []
  takeAction(me, foe, mid, log)
  assert.equal(log.find(l => l.type === 'skill' && l.skill === '裂傷').crit, true)
  assert.equal(me.nextCrit, false, '使ったら消える')
  assert.equal(cast('暗殺者', '裂傷').e.crit, false, 'マスが無ければクリティカルしない')
  // クリティカルしない技（noCrit）では使わない
  const me2 = side('暗', '暗殺者', [ascendSkill(S('隠形'))])
  me2.nextCrit = true
  const p = ichijiSkillPrep(me2, foe, { ...S('裂傷'), noCrit: true }, liveStats(me2, true), liveStats(foe), [])
  assert.equal(p.sureCrit, false)
  assert.equal(me2.nextCrit, true)
})

test('ウィンドカッターのマスは共鳴が+1多く／聖水のマスは強化を2つ解除／受け流しのマスは回避+3%（重ならない）', () => {
  const fire = (me) => { me.lastElem = 'fire' }
  assert.equal(cast('元素使い', 'ウィンドカッター', fire).me.reso, 1)
  assert.equal(cast('元素使い', ascendSkill(S('ウィンドカッター')), fire).me.reso, 2)
  const buffed = (me, foe) => { foe.buffs = { str: 20, vit: 20, agi: 20 } }
  const left = (r) => Object.values(r.foe.buffs).filter(v => v > 0).length
  assert.equal(left(cast('異端審問官', '聖水', buffed)), 2)
  assert.equal(left(cast('異端審問官', ascendSkill(S('聖水')), buffed)), 1)
  const me = side('体', '体術師', [ascendSkill(S('受け流し'))])
  takeAction(me, dummy(), mid, [])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.evaUp, 3, '2回使っても+3%のまま')
})

test('メテオストライク：3〜5連撃を毎回ランダムに・1ヒットごとに10%で火傷', () => {
  const sure = { ...S('メテオストライク'), proc: 100 }
  assert.deepEqual([0.2, 0.5, 0.9].map(r => cast('元素使い', sure, () => {}, fixed(r)).e.of), [3, 4, 5])
  // 乱数0.05：どのヒットでも10%の判定に入る＝火傷
  const r = cast('元素使い', sure, () => {}, fixed(0.05))
  assert.ok(r.foe.ail.burn, '火傷')
})

test('仙丹のマス：補助技でも毎ターン最大HPの4%を回復（3ターン）', () => {
  const r = cast('霊薬師', ascendSkill(S('仙丹')))
  assert.deepEqual(r.me.regenMax, { pct: 4, turns: 3 })
  assert.ok(!cast('霊薬師', '仙丹').me.regenMax, 'マスが無ければ回復しない')
})

test('薬効の上限20／薬効解放は薬効を減らさず、1つにつき+5%（マスで+10%）・最大+100%（与ダメージ200%）', () => {
  const me = side('霊', '霊薬師', ['剛力薬'])
  me.stk.potion = 19
  takeAction(me, dummy(), mid, [])
  takeAction(me, dummy(), mid, [])
  assert.equal(me.stk.potion, 20, '20で止まる')
  const foe = dummy()
  const multAt = (skill, n) => {
    const x = side('霊', '霊薬師', [skill])
    x.stk.potion = n
    return ichijiSkillPrep(x, foe, skill, liveStats(x, true), liveStats(foe), []).mult
  }
  assert.ok(Math.abs(multAt(S('薬効解放'), 10) - 1.5) < 1e-9)
  assert.ok(Math.abs(multAt(S('薬効解放'), 20) - 2) < 1e-9)
  const asc = ascendSkill(S('薬効解放'))
  assert.ok(Math.abs(multAt(asc, 10) - 2) < 1e-9, 'マスがあると10個で上限')
  assert.ok(Math.abs(multAt(asc, 20) - 2) < 1e-9, '上限は+100%のまま')
  const r = cast('霊薬師', '薬効解放', (m) => { m.stk.potion = 8 })
  assert.equal(r.me.stk.potion, 8, '撃っても減らない')
  // 調合の極意は5つ（+25%）で止まる（ユーザー選択）：薬効で伸びない技（霊薬瓶）は5つと10個で同じ
  const bottle = (n) => cast('霊薬師', '霊薬瓶', (m) => { m.stk.potion = n }).e.damage
  assert.equal(bottle(10), bottle(5))
  assert.ok(bottle(5) > bottle(0) * 1.2, `${bottle(5)}／${bottle(0)}`)
})

test('名前を変えた技：塔の姿（前の名前）は今の名前で読む／SQL は名簿の名前と、覚えた技・編成の付け替えを一度だけ', () => {
  assert.deepEqual(SKILL_RENAMED, { 間合い取り: '嵐の構え', メテオ: 'メテオストライク' })
  for (const now of Object.values(SKILL_RENAMED)) assert.ok(SKILL_BY_NAME[now], now)
  const f = fromSnapshot({ v: 2, name: '守', cls: '元素使い', lv: 60, stats: stats(), set: [{ name: 'メテオ', uses: 2 }, { name: 'ファイアボール', uses: 1 }], ups: { メテオ: 1 } })
  assert.deepEqual(f.slots.map(s => s.skill.name), ['メテオストライク', 'ファイアボール'])
  assert.equal(f.slots[0].skill.proc, 90, 'アセンションのマスも今の名前で付く')
  const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  assert.ok(SQL.includes("('メテオストライク', '元素使い', 22, 8, false, null),"))
  assert.ok(!SQL.includes("('メテオ', '元素使い'"))
  assert.ok(SQL.includes(`v_ren     jsonb := '{"メテオ":"メテオストライク"}'::jsonb;`))
  assert.ok(SQL.includes("key = 'meteor_rename_20261018'") && SQL.includes("values ('meteor_rename_20261018')"))
})
