// バトルフロンティアⅡ アリーナ（対人）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLOORS, EXP_MIN, EXP_MAX, STREAK_PCT, LOSE_DROP, LOW_FLOOR, LOW_FLOOR_MULT,
  powerOfFloor, floorAfterLose, floorAfterDefended,
  streakBonusPct, applyStreakBonus,
  npcClassOf, npcNameOf, npcStatsOf, npcSlotsOf, npcChampOf, champOf,
  snapshotOf, fromSnapshot, expOf, canChallenge,
  GUARD_DROP_MULT, guardDropMultOf, DROP_RANKS,
} from './arena.js'
import { equipDropRateOf, rollHasEquipDrop, EQUIP_DROP_RATE } from './sortie.js'
import { RANKS } from './equipment.js'
import { rollDropRank } from './enemies.js'
import { STAT_KEYS, calcPower } from './stats.js'
import { SKILL_BY_NAME, isPassive } from './skills.js'

test('50階建て（ユーザー決定）', () => {
  assert.equal(FLOORS, 50)
})

test('階が上がるほど戦闘力の目安が上がる', async () => {
  for (let f = 2; f <= FLOORS; f++) assert.ok(powerOfFloor(f) > powerOfFloor(f - 1), `${f}階`)
  // ★1階は動かさない。はじめたての戦闘力がこのくらいで、ここを上げると新規が入れない
  assert.equal(powerOfFloor(1), 150)
  // ★最上階は**この作品でいちばん強い相手**であること。
  //   数字を書かずにエリア⑧のボスと比べる＝ボスを調整したときに逆転へ気づける
  //   （実際 2026-09-06 にボスを上げて 50階(29,749) < ⑧ボス(45,247) の逆転が起きていた）
  const { AREAS_SORTED } = await import('./enemies.js')
  const last = AREAS_SORTED.filter(a => a.tier === Math.max(...AREAS_SORTED.map(x => x.tier)))
  const bossMax = Math.max(...last.map(a => a.boss.power))
  assert.ok(powerOfFloor(FLOORS) > bossMax,
    `50階=${powerOfFloor(FLOORS)} が⑧のボス${bossMax}より弱い`)
  // 範囲の外を渡しても端に丸める
  assert.equal(powerOfFloor(0), powerOfFloor(1))
  assert.equal(powerOfFloor(999), powerOfFloor(FLOORS))
})

test('負けたら戦闘力に関係なく必ず1つ下へ', () => {
  // ★ユーザー決定（wikiの記載は2つ下）。「上がった次で失敗したら元の階に戻る」形
  // ★2026-08-17：「戦闘力が足りていれば落ちない」下限は廃止した。
  //   サーバー（v2_arena_fight）は最初からその下限を持っておらず、
  //   画面の「次は◯階から」だけが落ちない予告を出していた＝表示と実際がズレていた
  assert.equal(LOSE_DROP, 1)
  assert.equal(floorAfterLose(10), 9)
  assert.equal(floorAfterLose(2), 1)
  assert.equal(floorAfterLose(1), 1)   // 1階より下は無い
  // 上がった次で失敗すると、上がる前の階に戻る
  assert.equal(floorAfterLose(11), 10)
  // ★戦闘力を渡しても結果は変わらない（下限が復活していないことの検出）
  assert.equal(floorAfterLose(10, powerOfFloor(50)), 9)
  assert.equal(floorAfterLose(FLOORS, powerOfFloor(FLOORS) * 100), FLOORS - 1)
})

test('階層守護者を破られたら1つ上へ（最上階なら据え置き）', () => {
  assert.equal(floorAfterDefended(10), 11)
  assert.equal(floorAfterDefended(FLOORS), FLOORS)
})

test('守っているあいだは挑戦できない', () => {
  assert.equal(canChallenge({ defending: null }), '')
  assert.match(canChallenge({ defending: { floor: 3 } }), /守っている/)
})

test('n連勝中の相手に挑むと 5n%（HP/MPには乗らない）', () => {
  assert.equal(STREAK_PCT, 5)
  assert.equal(streakBonusPct(0), 0)
  assert.equal(streakBonusPct(3), 15)
  assert.equal(streakBonusPct(10), 50)

  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, 100]))
  const up = applyStreakBonus(stats, 20)
  assert.equal(up.hp, 100, 'HPには乗らない')
  assert.equal(up.mp, 100, 'MPには乗らない')
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) assert.equal(up[k], 120, k)
  // 0%なら素通し
  assert.deepEqual(applyStreakBonus(stats, 0), stats)
})

test('30階以下で相手のほうが強いときだけ連勝補正が強くなる', () => {
  assert.equal(LOW_FLOOR, 30)
  assert.equal(LOW_FLOOR_MULT, 2)
  // 30階以下＋相手が格上 → 倍
  assert.equal(streakBonusPct(3, 20, 1000, 2000), 30)
  // 30階以下でも相手が格下なら普通
  assert.equal(streakBonusPct(3, 20, 2000, 1000), 15)
  // 31階以上は格上でも普通
  assert.equal(streakBonusPct(3, 31, 1000, 2000), 15)
})

test('NPC階層守護者は階ごとに決まっていて、見るたびに変わらない', () => {
  for (const f of [1, 7, 23, 50]) {
    assert.deepEqual(npcChampOf(f), npcChampOf(f), `${f}階が呼ぶたびに変わる`)
    assert.equal(npcClassOf(f), npcClassOf(f))
    assert.ok(npcNameOf(f).includes(npcClassOf(f)), `${f}階の名前に職業が入っていない`)
  }
  // 階が違えば別人
  assert.notEqual(npcNameOf(1), npcNameOf(2))
})

test('NPCの戦闘力はその階の目安どおり', () => {
  for (const f of [1, 10, 30, 50]) {
    const p = calcPower(npcStatsOf(f))
    const want = powerOfFloor(f)
    assert.ok(Math.abs(p - want) / want < 0.05, `${f}階: ${p} と目安 ${want} がズレている`)
  }
})

test('NPCはパッシブでないスキルだけを持つ（4つまで）', () => {
  for (const f of [1, 13, 50]) {
    const slots = npcSlotsOf(f)
    assert.ok(slots.length > 0 && slots.length <= 4, `${f}階のスキル数 ${slots.length}`)
    for (const s of slots) {
      assert.ok(s.skill, `${f}階にスキルの実体がない`)
      assert.ok(!isPassive(s.skill), `${f}階にパッシブが入っている（発動順に回れない）`)
    }
  }
})

test('スナップショットは名前と回数だけ持ち、戻すとスキルの実体が付く', () => {
  const fighter = {
    name:'おれおれお', cls:'侍', jobCount: 7,
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, 50])),
    enchants: ['スライム'],
    slots: [{ skill: SKILL_BY_NAME['はたく'], uses: 3 }],
  }
  const snap = snapshotOf(fighter)
  assert.deepEqual(snap.slots, [{ name:'はたく', uses:3 }])
  assert.equal(snap.jobCount, 7)
  assert.equal(snap.npc, false)
  // JSONで往復しても壊れない（DBに入れて戻すため）
  const back = fromSnapshot(JSON.parse(JSON.stringify(snap)), SKILL_BY_NAME)
  assert.equal(back.slots[0].skill.name, 'はたく')
  assert.equal(back.slots[0].uses, 3)
  // 知らないスキル名は落とす（名簿が変わっても落ちない）
  const broken = fromSnapshot({ slots: [{ name:'存在しない技', uses:1 }] }, SKILL_BY_NAME)
  assert.equal(broken.slots.length, 0)
})

test('champOf は空き階ならNPC、埋まっていればその人を返す', () => {
  const npc = champOf(5, null, SKILL_BY_NAME)
  assert.equal(npc.npc, true)
  assert.equal(npc.hp, npc.stats.hp, 'NPCは満タンで座っている')
  assert.equal(npc.streak, 0)

  // ★階層守護者はHP/MPが回復しない＝保存された値がそのまま出る
  const row = { snapshot: snapshotOf({ name:'誰か', cls:'侍', stats:{ hp:1000, mp:100 }, slots:[] }), hp: 120, mp: 8, streak: 4 }
  const p = champOf(5, row, SKILL_BY_NAME)
  assert.equal(p.npc, false)
  assert.equal(p.hp, 120)
  assert.equal(p.mp, 8)
  assert.equal(p.streak, 4)
})

test('EXPは勝敗によらず9〜13', () => {
  assert.equal(EXP_MIN, 9)
  assert.equal(EXP_MAX, 13)
  assert.equal(expOf(() => 0), 9)
  assert.equal(expOf(() => 0.999), 13)
  for (let i = 0; i < 50; i++) {
    const e = expOf()
    assert.ok(e >= EXP_MIN && e <= EXP_MAX, `EXP ${e}`)
  }
})

test('★装備のドロップ率は出撃とまったく同じ（アリーナ独自の数字を持たない）', async () => {
  // 2026-08-17まで arena.js が独自に25%を持っていて、出撃(3〜4%)の6〜8倍こぼれていた。
  // クールタイムを共有する以上、1行動あたりの旨みは揃っていないといけない。
  const arena = await import('./arena.js')
  assert.equal(arena.DROP_RATE, undefined, 'arena.js に独自のドロップ率が戻っている')
  assert.equal(arena.rollDrop, undefined, 'arena.js に独自の抽選が戻っている')
  // 出撃側が唯一の正
  // ★2026-08-29：出撃の抽選には守りの護符も入ったので、全体は4%・**装備は3%のまま**。
  //   アリーナは装備だけを引く（護符は出撃でしか出ない）
  assert.equal(EQUIP_DROP_RATE, 3)
  assert.equal(equipDropRateOf(), 3)
  // 同じ乱数なら出撃とアリーナで結果が一致する
  for (const n of [0.001, 0.029, 0.031, 0.039, 0.041, 0.5]) {
    assert.equal(rollHasEquipDrop(() => n), n * 100 < equipDropRateOf(), `rng=${n}`)
  }
})

// ===== 階層守護者でいるあいだの恩恵（2026-08-17 ユーザー決定）=====
test('階層守護者の間だけ、出撃のドロップ率が×1.1になる', () => {
  // ★ルーンの特殊能力（素材ドロップ率×1.2〜1.5）より控えめ＝「わずかに」
  assert.equal(GUARD_DROP_MULT, 1.1)
  assert.equal(guardDropMultOf(null), 1, '守っていなければ倍率なし')
  assert.equal(guardDropMultOf(undefined), 1)
  // 何階を守っていても同じ（階では変えない）
  assert.equal(guardDropMultOf({ floor: 1 }), GUARD_DROP_MULT)
  assert.equal(guardDropMultOf({ floor: FLOORS }), GUARD_DROP_MULT)
})

test('守護者ぶんの倍率は出撃の装備ドロップ率に乗る', () => {
  // 3% → 守護中は3.3%
  assert.equal(equipDropRateOf(), 3)
  assert.equal(Math.round(equipDropRateOf(GUARD_DROP_MULT) * 100) / 100, 3.3)
  // 3%と3.3%のあいだ（rng=0.032）では、守護中だけ落ちる
  assert.equal(rollHasEquipDrop(() => 0.032), false)
  assert.equal(rollHasEquipDrop(() => 0.032, GUARD_DROP_MULT), true)
})

// ===== 落ちるランク（2026-08-17 ユーザー決定）=====
test('★ランクの表はどの階でも同じで、F〜Sまで全部出る', () => {
  // 出撃はエリアごとに表が違う（エリア①はF〜Dだけ）。アリーナは階で変えない
  assert.deepEqual(Object.keys(DROP_RANKS).sort(), [...RANKS].sort())
  for (const r of RANKS) assert.ok(DROP_RANKS[r] > 0, `${r} が出ない`)
  // 合計100＝そのまま「落ちたうちの何%か」として読める
  assert.equal(Object.values(DROP_RANKS).reduce((a, b) => a + b, 0), 100)
})

test('★ランクが高いほど出にくい', () => {
  // RANKS は F→S の順（弱い順）。重みは単調に減っていく
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(DROP_RANKS[RANKS[i]] < DROP_RANKS[RANKS[i - 1]],
      `${RANKS[i]} が ${RANKS[i - 1]} 以上の重みを持っている`)
  }
  assert.equal(DROP_RANKS.F, 40)
  assert.equal(DROP_RANKS.S, 1)
})

test('抽選はその表どおりに出る', () => {
  const pick = (n) => rollDropRank({ dropRanks: DROP_RANKS }, () => n)
  assert.equal(pick(0), 'F')          // 0〜40
  assert.equal(pick(0.39), 'F')
  assert.equal(pick(0.41), 'E')       // 40〜65
  assert.equal(pick(0.999), 'S')      // 99〜100
  // 一様乱数で回したときの実測が表に近いこと
  // ★ここは mulberry32。単純なLCGだと掛け算が2^53を超えて精度が落ち、偏る
  let a = 987654321
  const rng = () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const count = {}
  const n = 200_000
  for (let i = 0; i < n; i++) { const r = pick(rng()); count[r] = (count[r] || 0) + 1 }
  for (const r of RANKS) {
    const pct = ((count[r] || 0) / n) * 100
    assert.ok(Math.abs(pct - DROP_RANKS[r]) < 0.5, `${r} は約${DROP_RANKS[r]}% だが ${pct.toFixed(2)}%`)
  }
})

// ===== 空き階のNPCは挑戦者より格上（2026-09-06 ユーザー指示）=====
// 前は階だけで強さが決まっていて、戦闘力6,438の人が8階（319＝自分の5%）で
// 足踏みし、釣り合う35階まで**無意味な戦いが27回続く**状態だった。
test('★空き階のNPCは「その階の値」と「自分×0.8」の高いほう', async () => {
  const { NPC_MIN_RATIO, npcPowerFor } = await import('./arena.js')
  assert.equal(NPC_MIN_RATIO, 0.8)
  const me = 6438
  // 下の階 … 自分の1.3倍まで底上げされる
  assert.equal(npcPowerFor(1, me), Math.round(me * 0.8))
  assert.equal(npcPowerFor(8, me), Math.round(me * 0.8))
  assert.ok(npcPowerFor(8, me) > powerOfFloor(8), '底上げされていない')
  // 上の階 … 階の値のほうが高いのでそのまま＝**階の意味が残っている**
  assert.equal(npcPowerFor(50, me), powerOfFloor(50))
  assert.ok(npcPowerFor(50, me) > npcPowerFor(8, me), '上の階のほうが強くない')
  // 戦闘力を渡さなければ前と同じ（階の値だけ）
  assert.equal(npcPowerFor(8), powerOfFloor(8))
  assert.equal(npcPowerFor(8, 0), powerOfFloor(8))
})

test('★底上げは空き階のNPCだけ。人が座っている階は本人の実力のまま', async () => {
  const { champOf, npcStatsOf, snapshotOf } = await import('./arena.js')
  const { calcPower } = await import('./stats.js')
  const me = 6438
  // 空き階（row が無い）… 底上げされる
  const npc = champOf(8, null, {}, me)
  assert.ok(calcPower(npc.stats) > powerOfFloor(8) * 2, `空き階が底上げされていない（${calcPower(npc.stats)}）`)
  // 人が座っている階 … スナップショットの実力そのまま
  const weak = { name:'よわい人', cls:'ノーブル', jobCount:0, stats: npcStatsOf(3), enchants:[], slots:[] }
  const row = { snapshot: snapshotOf(weak), hp: weak.stats.hp, mp: weak.stats.mp, streak: 0 }
  const sat = champOf(8, row, {}, me)
  assert.equal(calcPower(sat.stats), calcPower(weak.stats), '座っている人まで底上げしてしまっている')
})

// ★画面と自動成長NPCの両方が自分の戦闘力を渡していること。
//   片方だけ渡すと、渡していない側だけが空き階を素通りできてしまう。
test('★画面もNPCの自動処理も、champOf へ自分の戦闘力を渡している', async () => {
  const { readFileSync } = await import('node:fs')
  const ui = readFileSync(new URL('../components/V2Arena.jsx', import.meta.url), 'utf8')
  const calls = [...ui.matchAll(/champOf\(([^)]*)\)/g)].map(m => m[1])
  assert.ok(calls.length >= 3, `champOf の呼び出しを拾えている（${calls.length}件）`)
  for (const c of calls) assert.match(c, /myPower/, `戦闘力を渡していない呼び出しがある: champOf(${c})`)
  const fn = readFileSync(new URL('../../../supabase/functions/v2-npc-tick/index.ts', import.meta.url), 'utf8')
  assert.match(fn, /champOf\(floor, byFloor\.get\(floor\), SKILL_BY_NAME, myPower\)/,
    '自動成長NPC側が戦闘力を渡していない')
})
