// バトルフロンティアⅡ アリーナ（対人）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLOORS, EXP_MIN, EXP_MAX, STREAK_PCT, LOSE_DROP, LOW_FLOOR, LOW_FLOOR_MULT,
  powerOfFloor, floorLimitOf, floorAfterLose, floorAfterDefended,
  streakBonusPct, applyStreakBonus,
  npcClassOf, npcNameOf, npcStatsOf, npcSlotsOf, npcChampOf, champOf,
  snapshotOf, fromSnapshot, expOf, rollDrop, canChallenge,
} from './arena.js'
import { STAT_KEYS, calcPower } from './stats.js'
import { SKILL_BY_NAME, isPassive } from './skills.js'

test('50階建て（ユーザー決定）', () => {
  assert.equal(FLOORS, 50)
})

test('階が上がるほど戦闘力の目安が上がる', () => {
  for (let f = 2; f <= FLOORS; f++) assert.ok(powerOfFloor(f) > powerOfFloor(f - 1), `${f}階`)
  assert.equal(powerOfFloor(1), 150)
  // 最上階はエリア⑧のボス級（28,000前後）
  assert.ok(powerOfFloor(FLOORS) > 25000 && powerOfFloor(FLOORS) < 35000, `50階=${powerOfFloor(FLOORS)}`)
  // 範囲の外を渡しても端に丸める
  assert.equal(powerOfFloor(0), powerOfFloor(1))
  assert.equal(powerOfFloor(999), powerOfFloor(FLOORS))
})

test('負けると2つ下。ただし戦闘力が足りていれば落ちない', () => {
  assert.equal(LOSE_DROP, 2)
  // 戦闘力が低ければ素直に2つ落ちる
  assert.equal(floorAfterLose(10, 0), 8)
  assert.equal(floorAfterLose(2, 0), 1)
  assert.equal(floorAfterLose(1, 0), 1)   // 1階より下は無い
  // ★その階に見合う戦闘力があるなら落ちない
  const p10 = powerOfFloor(10)
  assert.equal(floorLimitOf(p10), 10)
  assert.equal(floorAfterLose(10, p10), 10)
  // 中途半端なとき＝落ちる先が「見合う階」で止まる
  assert.equal(floorAfterLose(10, powerOfFloor(9)), 9)
  // 上の階に見合う戦闘力でも、いまいる階より上には行かない
  assert.equal(floorAfterLose(10, powerOfFloor(40)), 10)
})

test('チャンプを破られたら1つ上へ（最上階なら据え置き）', () => {
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

test('NPCチャンプは階ごとに決まっていて、見るたびに変わらない', () => {
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

  // ★チャンプはHP/MPが回復しない＝保存された値がそのまま出る
  const row = { snapshot: snapshotOf({ name:'誰か', cls:'侍', stats:{ hp:1000, mp:100 }, slots:[] }), hp: 120, mp: 8, streak: 4 }
  const p = champOf(5, row, SKILL_BY_NAME)
  assert.equal(p.npc, false)
  assert.equal(p.hp, 120)
  assert.equal(p.mp, 8)
  assert.equal(p.streak, 4)
})

test('EXPは勝敗によらず9〜13、ドロップは確率', () => {
  assert.equal(EXP_MIN, 9)
  assert.equal(EXP_MAX, 13)
  assert.equal(expOf(() => 0), 9)
  assert.equal(expOf(() => 0.999), 13)
  for (let i = 0; i < 50; i++) {
    const e = expOf()
    assert.ok(e >= EXP_MIN && e <= EXP_MAX, `EXP ${e}`)
  }
  assert.equal(rollDrop(() => 0), true)
  assert.equal(rollDrop(() => 0.99), false)
})
