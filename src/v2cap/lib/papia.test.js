// v2cap のパピア（2026-10-30）
// 【確定】ユーザー指示「V1にいたパピアを実装したい、エリアによって出るパピアが異なる、ちびパピア パピア キングパピア で、イラストも一新する」
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAPIA_TIERS, PAPIA_PCT, PAPIA_EVA, PAPIA_TURNS, papiaTierOf, papiaEnemyOf, papiaLinesOf, forcePapiaNext, isPapiaForced } from './papia.js'
import { pickEncounter, rollRewards, rollEquipDrop, DROP_CHANCE } from './sortie.js'
import { SPOTS, spotOf, toFighter } from './areas.js'
import { runBattle } from '../core/battle.js'
import { buildCapBattleView } from './battleView.js'
import { DEX_ALL } from './dex.js'
import { raceOf } from './monsterRace.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const me = (over = {}) => ({ name: 'テスト', kind: 'phys', defRule: 'cap', stats: { hp: 1000, mp: 500, str: 100, dex: 100, agi: 100, int_stat: 50, vit: 50, luk: 10 }, slots: [], ...over })
const papiaFighter = (hp = 3, eva = PAPIA_EVA) => toFighter({ name: 'パピア', papia: { hp, eva } })

test('【確定】出るパピアはエリアで決まる（1〜5 ちび・6〜10 パピア・11〜15 キング）。HP 2/3/5・EXP ×10/×15/×40・1%', () => {
  assert.deepEqual(PAPIA_TIERS.map(t => [t.name, t.areas, t.hp, t.tenths]), [
    ['ちびパピア', [1, 5], 2, 100],
    ['パピア', [6, 10], 3, 150],
    ['キングパピア', [11, 15], 5, 400],
  ])
  assert.equal(PAPIA_PCT, 1)
  for (const s of SPOTS) {
    const want = s.area <= 5 ? 'ちびパピア' : s.area <= 10 ? 'パピア' : 'キングパピア'
    assert.equal(papiaTierOf(s.area).name, want, `エリア${s.area}`)
    assert.equal(papiaEnemyOf(s).name, want)
    assert.equal(papiaEnemyOf(s).spot, s.id)
  }
})

test('【確定】図鑑の15×20体には入らない・絵とサーバーの判定が名前で決まるので、どの敵とも名前が重ならない・種族は獣', () => {
  const names = new Set(DEX_ALL.map(e => e.name))
  for (const t of PAPIA_TIERS) {
    assert.ok(!names.has(t.name), t.name)
    assert.equal(raceOf(t.name), 'beast')
  }
  assert.equal(DEX_ALL.length, 300)
})

test('【確定】ボスの抽選のあとに1%・どの場所でもそのエリアのパピア・残りは今までの顔ぶれ', () => {
  const N = 200000
  const rng = rngOf(5)
  const at = new Date(Date.UTC(2026, 0, 1, 3))
  let n = 0
  for (let i = 0; i < N; i++) if (pickEncounter(16, 0, at, rng).role === 'papia') n++
  assert.ok(Math.abs(n * 100 / N - 1) < 0.1, `${(n * 100 / N).toFixed(2)}%`)
  // 遭遇率100%なら必ずボス（パピアより先）
  for (let i = 0; i < 2000; i++) assert.equal(pickEncounter(16, 100, at, rng).role, 'boss')
  // 1%を引いたときの中身
  const hit = pickEncounter(16, 0, at, () => 0.001)
  assert.equal(hit.role, 'papia')
  assert.equal(hit.isBoss, false)
  assert.equal(hit.enemy.name, 'パピア')
})

test('開発用「次の出撃でパピア」：次の1回だけ必ず出会う（ボスより先）', () => {
  forcePapiaNext()
  assert.equal(isPapiaForced(), true)
  assert.equal(pickEncounter(1, 100, new Date(), () => 0.5).enemy.name, 'ちびパピア')
  assert.equal(isPapiaForced(), false)
  assert.equal(pickEncounter(1, 100, new Date(), () => 0.5).role, 'boss')
})

test('【確定】どんな攻撃も1発につき1ダメージ・連撃は当たった数だけ・HPを超えては減らない', () => {
  const multi = { name: '三連撃', kind: 'phys', mult: 5, proc: 100, mp: 0, hits: 3, sureHit: true }
  const r = runBattle(me({ slots: [{ skill: multi, uses: 9 }] }), papiaFighter(5), { rng: rngOf(1) })
  const first = r.log.find(l => l.type === 'skill')
  assert.equal(first.hits, 3)
  assert.equal(first.damage, 3)
  assert.equal(r.winner, 'a')
  assert.equal(r.turns, 2, '3発＋2発（2ターン目はHPのぶんだけ）')
  assert.equal(r.log.filter(l => l.type === 'skill')[1].damage, 2)
  // 必中の一発がどれだけ強くても1ダメージ
  const big = { name: '大技', kind: 'phys', mult: 99, proc: 100, mp: 0, sureHit: true }
  assert.equal(runBattle(me({ slots: [{ skill: big, uses: 9 }] }), papiaFighter(3), { rng: rngOf(2) }).log.find(l => l.type === 'skill').damage, 1)
})

test('【確定】回避50%（V1と同じ）・こちらの追加行動は出ない・命中の補正で当てやすくなる', () => {
  const N = 4000
  let hit = 0, atk = 0
  for (let i = 0; i < N; i++) {
    const r = runBattle(me({ stats: { hp: 1000, mp: 500, str: 100, dex: 100, agi: 9999, int_stat: 50, vit: 50, luk: 10 } }), papiaFighter(99), { rng: rngOf(i + 1) })
    assert.ok(!r.log.some(l => l.type === 'extra'))
    for (const l of r.log) if (l.type === 'normal') { atk++; if (l.hit) hit++ }
  }
  assert.equal(atk, N * PAPIA_TURNS, '1ターンに1回ずつ')
  assert.ok(Math.abs(hit * 100 / atk - PAPIA_EVA) < 1.5, `命中 ${(hit * 100 / atk).toFixed(1)}%`)
})

test('【確定】状態異常と能力低下は効かない', () => {
  const poison = { name: 'どく', kind: 'phys', mult: 1, proc: 100, mp: 0, sureHit: true, ail: { key: 'poison', chance: 100 } }
  const r = runBattle(me({ slots: [{ skill: poison, uses: 9 }] }), papiaFighter(99), { rng: rngOf(3) })
  assert.ok(r.log.some(l => l.type === 'immune'), '効かなかった行が出る')
  assert.ok(!r.log.some(l => l.type === 'ailTick'), '毒のダメージは入らない')
  assert.deepEqual(r.b.ail.poison, undefined)
})

test('【確定】こちらを攻撃せず、6ターン目にこちらが動いたあと逃げる（引き分け＝勝ちではない）。V1の言葉の行が出る', () => {
  const r = runBattle(me({ stats: { hp: 1000, mp: 500, str: 100, dex: 100, agi: 100, int_stat: 50, vit: 50, luk: 10 } }), papiaFighter(99), { rng: rngOf(4) })
  assert.equal(r.fled, true)
  assert.equal(r.winner, 'draw')
  assert.equal(r.turns, PAPIA_TURNS)
  assert.equal(r.a.hp, 1000, 'こちらのHPは減らない')
  const acts = r.log.filter(l => l.type === 'papiaAct')
  assert.deepEqual(acts.map(l => l.text), papiaLinesOf('パピア'))
  assert.deepEqual(acts.map(l => l.text), ['パピアは驚いている', 'パピアはあたふたしている', '逃走準備', '次のターン逃げられそうだ', 'ああ、逃げられる！', '逃走！ パピアは逃げた！'])
  // いつもこちらが先に動く（6ターン目も攻撃してから逃げる）
  const lastAct = r.log.findLastIndex(l => l.type === 'papiaAct')
  assert.equal(r.log[lastAct - 1].type, 'normal')
  assert.equal(r.log.filter(l => l.type === 'normal').length, PAPIA_TURNS)
  // 戦闘ログの並び：パピアの行はパピアのまとまりに入る
  const view = buildCapBattleView(r, 'テスト', 'パピア')
  assert.ok(view.some(v => v.kind === 'act' && v.who === 'foe' && v.lines.some(x => x.text === 'パピアは驚いている')))
})

test('【確定】倒したときはEXPだけ（場所の表×倍率）・Goldなし・装備なし（塔の守護者のボーナスがあっても）。逃げられたらその場所の最低EXP', () => {
  for (const id of [1, 18, 45]) {
    const spot = spotOf(id)
    const enc = pickEncounter(id, 0, new Date(), () => 0.001)
    const t = papiaTierOf(spot.area)
    const rng = rngOf(id)
    for (let i = 0; i < 200; i++) {
      const w = rollRewards(enc, rng, true)
      assert.equal(w.gold, 0)
      assert.ok(w.exp >= Math.floor((spot.exp[0] * t.tenths + 5) / 10) && w.exp <= Math.floor((spot.exp[1] * t.tenths + 5) / 10), `${spot.name} ${w.exp}`)
    }
    assert.deepEqual(rollRewards(enc, rng, false), { exp: spot.exp[0], gold: 0 })
    for (let i = 0; i < 200; i++) assert.equal(rollEquipDrop(enc, '剣士', new Date(), rng, 1, 100), null)
  }
  assert.equal(DROP_CHANCE.papia, undefined)
})
