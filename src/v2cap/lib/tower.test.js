// v2cap：塔（あるけみすと型の対人）の決まりを固定するテスト（node --test）
// 【確定】2026-10-14 ユーザー指示「普通にあるケミ風のPVPも用意しておく・○○の塔みたいな感じで1層～100層くらいまで」
//   「該当者は画像みたいに現在の職業のアイコンが表示されるように」「仕様はあるケミと一緒、階層守護者になっている間はドロップ率1%増加」
//   ＋選択式：負けたら2つ下／空き層にNPC＋席を降りられる／報酬は出撃と同じ旨み
// サーバー（v2cap_tower_fight・v2cap_tower_retire）との突き合わせは v2capsql.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TOWER_NAME, FLOORS, LOSE_DROP, STREAK_PCT, LOW_FLOOR, GUARD_DROP_BONUS, NPC_MIN_RATIO, NPC_ICHIJI_FROM,
  clampFloor, floorAfterLose, floorAfterDefended, canChallenge, guardDropBonusOf,
  streakBonusPct, applyStreakBonus, iconClassOf, towerIconSrc,
  floorPowerOf, npcPowerFor, npcClassOf, npcNameOf, npcFighterOf, npcFighterAt,
  snapshotOf, fromSnapshot, champOf, floorInfoOf, towerBattleOf, hpPmOf, clampPm, rewardSpotOf, rollTowerDrop,
  SNAPSHOT_V, snapClassOf,
} from './tower.js'
import { STAT_KEYS, calcPower } from './level.js'
import { CLASS_BY_ID, START_CLASSES, ICHIJI_CLASSES, ICHIJI_RENAMED, stageOf, lineageOf, weaponsOf } from './jobs.js'
import { SKILL_BY_NAME, setMpCost, skillsOf, passiveOf } from './skills.js'
import { ascendSkill } from './ascension.js'
import { stdPowerAt, spotOf } from './areas.js'
import { rollEquipDrop, DROP_CHANCE, openUntilOf } from './sortie.js'
import { ART_BASE } from './classArt.js'
import { pvpHpMultFor } from './pvp.js'
import { toFighter } from './loadout.js'
import { runBattle } from '../../v2/lib/battle.js'
import { buildCapBattleView } from './battleView.js'

// 決まった並びの乱数
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length] }

test('【確定】1〜100層・負けたら2つ下（1層より下には行かない）・破られた／降りたら1つ上（最上層はそのまま）', () => {
  assert.equal(FLOORS, 100)
  assert.equal(LOSE_DROP, 2)
  assert.equal(floorAfterLose(10), 8)
  assert.equal(floorAfterLose(2), 1)
  assert.equal(floorAfterLose(1), 1)
  assert.equal(floorAfterDefended(10), 11)
  assert.equal(floorAfterDefended(100), 100)
  assert.equal(clampFloor(0), 1)
  assert.equal(clampFloor(101), 100)
  assert.equal(clampFloor('7'), 7)
})

test('【確定】守っているあいだは挑戦できない（あるけみと同じ）', () => {
  assert.equal(canChallenge({ guarding: false }), '')
  assert.ok(canChallenge({ guarding: true }).length > 0)
})

test('【確定】守護者でいるあいだ、出撃の装備のドロップ率+1%（ふつうの敵8→9%）', () => {
  assert.equal(GUARD_DROP_BONUS, 1)
  assert.equal(guardDropBonusOf({ tower_guard: 12 }), 1)
  assert.equal(guardDropBonusOf({ tower_guard: null }), 0)
  assert.equal(guardDropBonusOf(null), 0)
  const enc = { role: 'normal', spot: spotOf(1) }
  // 1回目の乱数＝落ちるか。8.5% は守っていなければ落ちない・守っていれば落ちる
  const x = (DROP_CHANCE.normal + 0.5) / 100
  assert.equal(rollEquipDrop(enc, '戦士', new Date(), seq(x, 0, 0, 0), 1, 0), null)
  assert.ok(rollEquipDrop(enc, '戦士', new Date(), seq(x, 0, 0, 0), 1, guardDropBonusOf({ tower_guard: 3 })))
  // 9% ちょうどは守っていても落ちない（+1%まで）
  assert.equal(rollEquipDrop(enc, '戦士', new Date(), seq((DROP_CHANCE.normal + 1) / 100, 0, 0, 0), 1, 1), null)
  // 出撃の画面は守っている印（tower_guard）から上乗せを渡している
  const src = readFileSync(new URL('../components/V2capSortie.jsx', import.meta.url), 'utf8')
  assert.match(src, /rollEquipDrop\(enc, prof\.class, new Date\(\), Math\.random, me\.setFx\?\.rareDropMult \|\| 1, guardDropBonusOf\(prof\)\)/)
})

test('【確定】連勝補正：n連勝中の守護者に挑むと +5n%（HP/MPには乗せない）。30層以下で相手が強いときだけ2倍', () => {
  assert.equal(STREAK_PCT, 5)
  assert.equal(LOW_FLOOR, 30)
  assert.equal(streakBonusPct(0, 50, 100, 200), 0)
  assert.equal(streakBonusPct(3, 50, 100, 200), 15)
  assert.equal(streakBonusPct(3, 30, 100, 200), 30, '30層以下で相手が強い')
  assert.equal(streakBonusPct(3, 30, 200, 100), 15, '30層以下でも相手が弱ければふつう')
  const s = applyStreakBonus({ hp: 100, mp: 50, str: 100, dex: 10, agi: 10, int_stat: 10, vit: 10, luk: 10 }, 20)
  assert.equal(s.hp, 100)
  assert.equal(s.mp, 50)
  assert.equal(s.str, 120)
})

test('アイコン：初期職はその職業のデフォルメの絵・上位職は系統の初期職の絵（男女）', () => {
  for (const c of START_CLASSES) assert.equal(iconClassOf(c), c)
  for (const c of ICHIJI_CLASSES) assert.equal(iconClassOf(c), CLASS_BY_ID[c].req.cls, c)
  for (const c of Object.keys(CLASS_BY_ID)) assert.ok(ART_BASE[iconClassOf(c)], `${c} の絵がある`)
  assert.match(towerIconSrc({ cls: '盗賊', g: 'f' }), /touzoku-f\.webp$/)
  assert.match(towerIconSrc({ cls: '盗賊', g: 'x' }), /touzoku-m\.webp$/, '男女が読めなければ男性')
  assert.equal(towerIconSrc(null), null)
})

test('空いている層のNPC：n層はLVn・強さはLVnの標準の強さ以上かつ挑戦する人×0.8以上', () => {
  assert.equal(NPC_MIN_RATIO, 0.8)
  for (const f of [1, 10, 24, 25, 50, 77, 100]) {
    assert.equal(floorPowerOf(f), stdPowerAt(f))
    const n = npcFighterOf(f, 0)
    assert.equal(n.lv, f)
    assert.ok(Math.abs(calcPower(n.stats) - floorPowerOf(f)) <= 3, `${f}層の強さ（${calcPower(n.stats)}／${floorPowerOf(f)}）`)
    // 自分が強いときは自分×0.8まで底上げ
    const big = npcFighterOf(f, 10000)
    assert.ok(Math.abs(calcPower(big.stats) - 8000) <= 8, `${f}層・自分10000 → ${calcPower(big.stats)}`)
    assert.equal(npcPowerFor(f, 10000), 8000)
  }
  assert.ok(floorPowerOf(100) > floorPowerOf(1), '上の層ほど強い')
})

test('空いている層のNPC：職業は層で決まる（25層から上位職）・名前も同じ・技はその職業で使える覚えた技だけ・MPに収まる', () => {
  assert.equal(NPC_ICHIJI_FROM, 25)
  for (let f = 1; f <= FLOORS; f++) {
    const cls = npcClassOf(f)
    assert.ok(CLASS_BY_ID[cls], `${f}層 ${cls}`)
    assert.equal(stageOf(cls), f < NPC_ICHIJI_FROM ? 'shoki' : 'ichiji', `${f}層`)
    assert.equal(npcClassOf(f), cls, '同じ層なら同じ職業')
    assert.ok(npcNameOf(f).endsWith(cls))
    const n = npcFighterOf(f, 0)
    assert.equal(n.npc, true)
    assert.ok(n.slots.length >= 1 && n.slots.length <= 5, `${f}層の技の数 ${n.slots.length}`)
    const lineage = lineageOf(cls)
    for (const s of n.slots) {
      const base = SKILL_BY_NAME[s.skill.name]
      assert.ok(base && lineage.includes(base.cls), `${f}層 ${cls} の技 ${s.skill.name}`)
    }
    assert.ok(setMpCost(n.slots.map(s => ({ name: s.skill.name, uses: s.uses }))) <= n.stats.mp, `${f}層の技がMPに収まる`)
    for (const k of STAT_KEYS) assert.ok(Number.isFinite(n.stats[k]) && n.stats[k] >= 1, `${f}層の${k}`)
  }
})

test('守護者の姿：保存して戻しても、戦闘に使う中身（ステ・技・耐性・セット能力・アイコン）が同じ', () => {
  const prof = {
    username: 'てすと', class: '狂戦士', lv: 40, hp: 200, mp: 60, str: 30, dex: 10, agi: 12, int_stat: 5, vit: 15, luk: 5,
    jobs: { 戦士: { lv: 30, exp: 0 }, 狂戦士: { lv: 20, exp: 0 } },
    learned: ['体当たり', '強撃'], skill_sets: { 狂戦士: [{ name: '体当たり', uses: 2 }, { name: '強撃', uses: 1 }] }, equipped: {},
  }
  const me = toFighter(prof, [])
  const snap = JSON.parse(JSON.stringify(snapshotOf(me, { lv: 40, gender: 'f' })))
  const back = fromSnapshot(snap)
  assert.deepEqual(back.stats, me.stats)
  assert.deepEqual(back.slots, me.slots)
  assert.deepEqual(back.passives, me.passives)
  assert.equal(back.kind, me.kind)
  assert.equal(back.defRule, me.defRule)
  assert.equal(back.lv, 40)
  assert.deepEqual(back.icon, { cls: '戦士', g: 'f' }, '上位職のアイコンは系統の初期職の絵・男女はそのとき選んでいた方')
  // 同じ乱数なら、元のキャラと戻した姿で同じ戦いになる
  const foe = npcFighterOf(30, 0)
  const r1 = runBattle(me, foe, { rng: seq(0.3, 0.7, 0.1, 0.9, 0.5) })
  const r2 = runBattle(back, foe, { rng: seq(0.3, 0.7, 0.1, 0.9, 0.5) })
  assert.equal(r1.winner, r2.winner)
  assert.equal(r1.turns, r2.turns)
})

test('守護者のいる層と空いている層：残りHPは千分率・一覧の1行はNPCなら層のLV', () => {
  const me = npcFighterOf(40, 0)
  const row = { floor: 40, player_id: 'u1', snapshot: snapshotOf(me, { lv: 45, gender: 'm' }), hp_pm: 400, mp: 7, streak: 2, since: 'x' }
  const c = champOf(40, row, 0)
  assert.equal(c.playerId, 'u1')
  assert.equal(c.hpPm, 400)
  assert.equal(c.mpNow, 7)
  assert.equal(c.streak, 2)
  assert.equal(c.lv, 45)
  const info = floorInfoOf(40, row)
  assert.equal(info.npc, false)
  assert.equal(info.lv, 45)
  const empty = floorInfoOf(63, undefined)
  assert.equal(empty.npc, true)
  assert.equal(empty.lv, 63)
  assert.equal(empty.name, npcNameOf(63))
  const n = champOf(63, undefined, 0)
  assert.equal(n.playerId, null)
  assert.equal(n.hpPm, 1000)
  assert.equal(clampPm(0), 1)
  assert.equal(clampPm(1500), 1000)
})

test('戦う形：挑戦する側は満タン・守護者は残りHP（千分率）とMPのまま・対人のHP倍率は2人とも同じ', () => {
  const me = npcFighterOf(60, 0)
  const guard = npcFighterOf(50, 0)
  const row = { floor: 50, player_id: 'u2', snapshot: snapshotOf(guard, { lv: 50 }), hp_pm: 250, mp: 3, streak: 0 }
  const champ = champOf(50, row, calcPower(me.stats))
  const { a, b, mult } = towerBattleOf({ me, myLv: 60, champ, floor: 50 })
  assert.equal(mult, pvpHpMultFor(60, 50))
  assert.equal(a.stats.hp, Math.round(me.stats.hp * mult))
  assert.equal(a.startHp, undefined, '挑戦する側は満タン')
  assert.equal(b.stats.hp, Math.round(guard.stats.hp * mult))
  assert.equal(b.startHp, Math.round(b.stats.hp * 0.25))
  assert.equal(b.startMp, 3)
  const r = runBattle(a, b, { rng: seq(0.4, 0.6, 0.2, 0.8) })
  assert.ok(r.b.hp <= b.stats.hp * 0.25 + 1, '守護者は減ったHPから始まる')
  assert.equal(hpPmOf({ hp: 50, base: { hp: 200 } }), 250)
  assert.equal(hpPmOf({ hp: -5, base: { hp: 200 } }), 1)
})

test('【確定】報酬は出撃と同じ：開いている一番先の場所の「ふつうの敵」と同じ装備（エリア・ノーマルかレア・武器はいまの職業の種類）', () => {
  const cleared = [1, 2, 3, 4]
  assert.equal(rewardSpotOf(cleared).id, openUntilOf(cleared))
  assert.equal(rewardSpotOf([]).id, 1)
  let n = 0
  for (let i = 0; i < 4000; i++) {
    const d = rollTowerDrop(cleared, '弓使い', new Date(Date.UTC(2026, 9, 14, i % 24)), Math.random)
    if (!d) continue
    n++
    assert.equal(d.item.area, rewardSpotOf(cleared).area)
    assert.ok(['N', 'R'].includes(d.item.rarity), d.item.rarity)
    if (d.item.part === '武器') assert.ok(weaponsOf('弓使い').includes(d.item.type), d.item.type)
  }
  assert.ok(n > 4000 * 0.05 && n < 4000 * 0.11, `落ちる割合は出撃のふつうの敵と同じ8%前後（${n}）`)
})

test('戦闘ログの1ターン目の表も、守護者の減ったHPから（画面が startHp を渡している）', () => {
  const me = npcFighterOf(30, 0)
  const guard = npcFighterOf(20, 0)
  const row = { floor: 20, player_id: 'u3', snapshot: snapshotOf(guard, { lv: 20 }), hp_pm: 500, mp: 10, streak: 0 }
  const { a, b } = towerBattleOf({ me, myLv: 30, champ: champOf(20, row, 0), floor: 20 })
  const r = runBattle(a, b, { rng: seq(0.21, 0.67, 0.45, 0.9, 0.05) })
  const v = buildCapBattleView(r, a.name, b.name, { b: b.startHp })
  assert.equal(v[0].kind, 'turn')
  assert.equal(v[0].foe.hp, b.startHp, '1ターン目の表は減ったHP')
  assert.equal(v[0].foe.max, b.stats.hp)
  const src = readFileSync(new URL('../components/V2capTower.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('buildCapBattleView(r, me.name, champ.name, { b: b.startHp })'), '画面が渡している')
})

test('NPCの強さを測る道具と同じ作り方（npcFighterAt）で、強さを指定して作れる', () => {
  const n = npcFighterAt(70, 900)
  assert.ok(Math.abs(calcPower(n.stats) - 900) <= 3)
  assert.equal(n.lv, 70)
})

test('【確定】名前はユーザーが決めた「ジークヴァルトの覇天塔」。画面は TOWER_NAME だけを使う（名前を直書きしない）', () => {
  assert.equal(TOWER_NAME, 'ジークヴァルトの覇天塔')
  for (const f of ['../components/V2capTower.jsx', '../components/V2capSortie.jsx', '../pages/V2capHome.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.ok(src.includes('TOWER_NAME'), `${f} は TOWER_NAME を使う`)
    assert.ok(!src.includes('天空の塔') && !src.includes(TOWER_NAME), `${f} に名前を直書きしていない`)
  }
})

// ===== 守護者の姿（2026-10-15 直した：技は名前・回数・アセンションの上がり幅で持ち、戦うときに今の名簿から引き直す）=====
const SNAP_STATS = { hp: 300, mp: 60, str: 40, dex: 10, agi: 10, int_stat: 5, vit: 20, luk: 5 }

test('姿には技の名前・回数と、編成にある技のぶんだけのアセンションの上がり幅を入れる（技の中身は持たない）', () => {
  const me = npcFighterOf(40, 0)
  const names = me.slots.map(x => x.skill.name)
  const snap = snapshotOf(me, { lv: 40, ups: { [names[0]]: 10, 編成に無い技: 5 } })
  assert.equal(snap.v, SNAPSHOT_V)
  assert.equal(SNAPSHOT_V, 2)
  assert.deepEqual(snap.set, me.slots.map(x => ({ name: x.skill.name, uses: x.uses })))
  assert.deepEqual(snap.ups, { [names[0]]: 10 })
  assert.ok(!('slots' in snap), '技の中身は持たない')
  const src = readFileSync(new URL('../components/V2capTower.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('snapshotOf(me, { lv: prof.lv, gender, ups: ascEffectsOf(prof).ups })'), '画面はアセンションの上がり幅を渡している')
})

test('守護者の技は今の名簿から引き直す：名簿に無い技は外れる・アセンションの上がり幅は付け直す', () => {
  const real = skillsOf('戦士')[0].name
  const f = fromSnapshot(JSON.parse(JSON.stringify({
    v: 2, name: 'x', cls: '戦士', kind: 'phys', lv: 20, stats: SNAP_STATS,
    set: [{ name: 'もう無い技', uses: 3 }, { name: real, uses: 2 }], ups: { [real]: 20 },
  })))
  assert.deepEqual(f.slots.map(x => x.skill.name), [real], '名簿に無い技は外れる')
  assert.deepEqual(f.slots[0].skill, ascendSkill(SKILL_BY_NAME[real], 20), 'アセンションの上がり幅を付け直す')
  assert.equal(f.slots[0].uses, 2)
})

test('最初の版（v:1・技の中身ごと）の姿も読める：中身は今の名簿の数字で戦う', () => {
  const real = skillsOf('戦士')[0].name
  const old = {
    v: 1, name: 'x', cls: '戦士', kind: 'phys', lv: 20, stats: SNAP_STATS,
    slots: [{ skill: { ...SKILL_BY_NAME[real], mult: 99 }, uses: 2 }, { skill: { name: 'もう無い技', cls: '戦士', kind: 'phys', mult: 5 }, uses: 1 }],
  }
  const f = fromSnapshot(JSON.parse(JSON.stringify(old)))
  assert.deepEqual(f.slots, [{ skill: SKILL_BY_NAME[real], uses: 2 }])
})

test('上位職の守護者：系統の初期職の技も自分の職業の技として使える（姿に入れて戻しても同じ）', () => {
  const cls = ICHIJI_CLASSES[0]
  const base = CLASS_BY_ID[cls].req.cls
  const set = [{ name: skillsOf(cls)[0].name, uses: 2 }, { name: skillsOf(base)[0].name, uses: 1 }]
  const f = fromSnapshot({ v: 2, name: 'x', cls, lv: 40, stats: SNAP_STATS, set })
  assert.deepEqual(f.slots.map(x => x.skill.name), set.map(e => e.name))
  for (const x of f.slots) assert.equal(x.skill.cls, cls, '戦闘エンジンが他職扱いにしない')
})

test('前の名前の職業（上位クラスの並び替え）は今の名前で読む（パッシブ・一覧の職業も）', () => {
  for (const [oldName, newName] of Object.entries(ICHIJI_RENAMED)) {
    assert.equal(snapClassOf(oldName), newName)
    const f = fromSnapshot({ v: 2, name: 'x', cls: oldName, lv: 40, stats: SNAP_STATS, set: [] })
    assert.equal(f.cls, newName)
    assert.deepEqual(f.passives, passiveOf(newName) ? [passiveOf(newName)] : [])
    assert.equal(floorInfoOf(5, { floor: 5, player_id: 'p', snapshot: { name: 'x', cls: oldName, lv: 40 }, hp_pm: 500, streak: 0 }).cls, newName)
  }
  assert.equal(snapClassOf('戦士'), '戦士')
  // 名簿から消えた職業でも、名簿にある技は使える（技の職業で絞らない）
  const real = skillsOf('戦士')[0].name
  const g = fromSnapshot({ v: 2, name: 'x', cls: '消えた職業', lv: 40, stats: SNAP_STATS, set: [{ name: real, uses: 1 }] })
  assert.deepEqual(g.slots.map(x => x.skill.name), [real])
})
