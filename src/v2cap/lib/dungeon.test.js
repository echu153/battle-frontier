// v2cap の IDダンジョン（ボスを呼び、HPを持ち越して倒す・ATB）の決まりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CHALLENGE_CATS, DUNGEON_BOSSES, DIFF_KEYS, DUNGEON_MIN, DUNGEON_TRY_SEC, SUMMONS_PER_DAY, STAMINA_OWNER_FIRST, STAMINA_OWNER, STAMINA_HELPER, HELPERS_MAX, HELPER_REWARD_MIN_PCT, SOLO_REWARD_MULT,
  diffOf, isDiffReady, isDiffUnlocked, isSummonable, summonBlockOf, tryStaminaOf, dungeonFighter, stateWithRunOf, msLeftOf, bossEnrageOf,
} from './dungeon.js'
import { createAtb, runFor, enrageOf, stateChips, startMacro, fillPerSecOf, hpBuffChips, castMsOf, ATB_SLOW_CUT, FILL_PER_SEC, BUFF_GAUGE_SEC, BUFF_WAIT_AFTER_ACT_SEC, BUFF_SHOW_SEC, TURN_SEC, GAUGE_FULL, NOW_WAIT_AFTER_ACT_SEC, CAST_SEC } from '../core/atb.js'
import { inflict, healMultOf, hasAilment } from '../core/ailments.js'
import { bossIllustOf, buffArtMsOf } from './bossIllust.js'
import { bossThumbOf, bossTintOf, bossFaceOf, bossNamePartsOf, BOSS_FACE_BOX, BOSS_CARD, bossCardFitOf, bossCardCss, bossCardPxAt } from './bossArt.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'
import { liveStats, hpStepMultOf, healMaxAmount, createSide, takeAction } from '../core/battle.js'
import { splitHits } from './atbFx.js'
import { statsOf } from '../core/enemies.js'
import { CAP_RULES } from './rules.js'
import { tenSortieExpOf } from './areas.js'
import { DAILY_GOLD_PER_LV } from './daily.js'
import { INPUTS_MAX } from './dungeonVerify.js'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fnBody = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.ok(i >= 0, `${name} がある`)
  return SQL.slice(i, SQL.indexOf('\n$$;', i))
}
const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
// ボスを倒せない・倒れない自分（ボスの技の出し方だけを見る）
const dummy = () => ({ ...CAP_RULES, name: 'じぶん', kind: 'phys', stats: { hp: 10_000_000, mp: 10, str: 1, dex: 10, agi: 30, int_stat: 1, vit: 100, luk: 1 }, slots: [] })
const BOSS = '黒龍ヴァルゼノク'
const bossActs = (st) => st.log.filter(l => l.side === BOSS && (l.type === 'skill' || l.type === 'normal' || l.type === 'cast'))
  .map(l => (l.type === 'normal' ? '黒爪' : l.type === 'cast' ? `構え:${l.skill}` : l.skill))

test('【確定】2026-10-29 数字はサーバー（SQL §23）と同じ：HP・呼べるエリア・90分・180秒・スタミナ 0/3/5・救援5人・1日1回', () => {
  const conf = fnBody('v2cap_dungeon_conf')
  const rows = [...conf.matchAll(/\('(\w+)', '(\w+)', (\d+), (\d+)\)/g)].map(m => ({ boss: m[1], diff: m[2], hp: +m[3], area: +m[4] }))
  const ready = Object.entries(DUNGEON_BOSSES).filter(([boss]) => isSummonable(boss)).flatMap(([boss, b]) => DIFF_KEYS.filter(k => isDiffReady(boss, k)).map(diff => ({ boss, diff, hp: b.diffs[diff].hp, area: b.diffs[diff].area })))
  assert.deepEqual(rows, ready, 'サーバーの難易度の表＝呼べる難易度（まだ数字の無い難易度はサーバーにも無い）')
  assert.match(fnBody('v2cap_dungeon_summon'), new RegExp(`c_min\\s+constant int := ${DUNGEON_MIN};`))
  const start = fnBody('v2cap_dungeon_try_start')
  assert.match(start, new RegExp(`c_owner_first constant int := ${STAMINA_OWNER_FIRST};`))
  assert.match(start, new RegExp(`c_owner\\s+constant int := ${STAMINA_OWNER};`))
  assert.match(start, new RegExp(`c_helper\\s+constant int := ${STAMINA_HELPER};`))
  assert.match(start, new RegExp(`c_try_sec\\s+constant int := ${DUNGEON_TRY_SEC};`))
  for (const fn of ['v2cap_dungeon_join', 'v2cap_dungeon_state']) assert.match(fnBody(fn), new RegExp(`c_helpers_max constant int := ${HELPERS_MAX};`), `${fn} の救援の人数`)
  // ボスごとに1日1回：きょうそのボスを呼んだら（どの難易度でも）呼べない（2026-10-31 ユーザー選択「ボスごとに1日1回」）・同時に1体
  assert.equal(SUMMONS_PER_DAY, 1)
  assert.match(fnBody('v2cap_dungeon_summon'), /r\.owner_id = v_uid and r\.day = public\.v2cap_dungeon_today\(\) and r\.boss = p_boss/)
  assert.match(fnBody('v2cap_dungeon_summon'), /r\.owner_id = v_uid and r\.cleared_at is null and r\.ends_at > now\(\)/, '同時に1体')
  assert.match(fnBody('v2cap_dungeon_state'), /'summoned_bosses'/)
  assert.match(fnBody('v2cap_dungeon_today'), /at time zone 'Asia\/Tokyo'\) - interval '5 hours'/, '朝5時で切り替え')
})

test('【確定】2026-10-29 呼べる難易度：そのエリアに着いたら（②ノーマル・⑤ハード）。エキスパート・マスターは準備中', () => {
  assert.equal(isDiffUnlocked('varuzenoku', 'normal', 1), false)
  assert.equal(isDiffUnlocked('varuzenoku', 'normal', 2), true)
  assert.equal(isDiffUnlocked('varuzenoku', 'hard', 4), false)
  assert.equal(isDiffUnlocked('varuzenoku', 'hard', 5), true)
  for (const k of ['expert', 'master']) {
    assert.equal(isDiffReady('varuzenoku', k), false)
    assert.equal(isDiffUnlocked('varuzenoku', k, 15), false)
    assert.equal(dungeonFighter('varuzenoku', k), null)
  }
  assert.deepEqual(DIFF_KEYS.map(k => diffOf('varuzenoku', k).area), [2, 5, 8, 12])
  assert.deepEqual(DIFF_KEYS.map(k => diffOf('varuzenoku', k).recLv), [25, 45, 65, 80])
})

test('【確定】2026-10-29 スタミナ：呼んだ人は最初0・そのあと3／救援で入った人は毎回5', () => {
  assert.equal(tryStaminaOf(true, 0), 0)
  assert.equal(tryStaminaOf(true, 1), 3)
  assert.equal(tryStaminaOf(true, 5), 3)
  assert.equal(tryStaminaOf(false, 0), 5)
  assert.equal(tryStaminaOf(false, 3), 5)
})

test('【確定】2026-10-31 ボスの DEX と AGI（ユーザー「モンスターの能力ちょっと低いかも、AGIとDEXもう少し上げていい」）：配分は合計100のまま・HPは難易度の hp のまま', () => {
  for (const key of Object.keys(DUNGEON_BOSSES)) {
    const d = DUNGEON_BOSSES[key].dist
    assert.equal(Object.values(d).reduce((a, b) => a + b, 0), 100, `${key} の配分の合計`)
    assert.deepEqual([d.dex, d.agi], [12, 8], `${key} の DEX と AGI`)
    const n = dungeonFighter(key, 'normal').stats, h = dungeonFighter(key, 'hard').stats
    assert.deepEqual([n.dex, n.agi, n.hp], [57, 38, 13000], `${key} ノーマル`)
    assert.deepEqual([h.dex, h.agi, h.hp], [123, 82, 30000], `${key} ハード`)
  }
})

// ===== 2026-11-01 ユーザーの調整（技リストを見て）=====
// ボスの通常攻撃だけを見る（HPが満タンのあいだは技を出さない）
const normalsOf = (boss, diff, me = dummy(), sec = 900) => {
  const f = dungeonFighter(boss, diff)
  const st = createAtb(me, f, { rng: rngOf(11), maxSec: 9999 })
  runFor(st, sec)
  return { st, name: f.name, hits: st.log.filter(l => l.side === f.name && l.type === 'normal' && l.hit), ails: st.log.filter(l => l.side === 'じぶん' && l.type === 'ailment') }
}
test('【確定】2026-11-01 ハードから通常攻撃に状態異常：黒爪＝出血20%・雨礫＝鈍足20%。ノーマルは付かない・当たったときだけ', () => {
  assert.equal(dungeonFighter('varuzenoku', 'normal').normalAil, null)
  assert.equal(dungeonFighter('amaza', 'normal').normalAil, null)
  assert.deepEqual(dungeonFighter('varuzenoku', 'hard').normalAil, { key: 'bleed', chance: 20 })
  assert.deepEqual(dungeonFighter('amaza', 'hard').normalAil, { key: 'slow', chance: 20 })
  assert.equal(dungeonFighter('zerugiasu', 'normal').normalAil, null)
  assert.deepEqual(dungeonFighter('zerugiasu', 'hard').normalAil, { key: 'blind', chance: 20 })
  assert.equal(dungeonFighter('enma', 'normal').normalAil, null)
  assert.deepEqual(dungeonFighter('enma', 'hard').normalAil, { key: 'curse', chance: 20 })
  for (const boss of Object.keys(DUNGEON_BOSSES)) {
    const n = normalsOf(boss, 'normal')
    assert.ok(n.hits.length > 100)
    assert.equal(n.ails.length, 0, 'ノーマルは通常攻撃で状態異常にならない')
  }
  const v = normalsOf('varuzenoku', 'hard')
  assert.ok(v.hits.length > 100)
  assert.ok(v.ails.length >= v.hits.length * 0.12 && v.ails.length <= v.hits.length * 0.28, `黒爪の出血はだいたい20%（${v.ails.length}/${v.hits.length}）`)
  assert.ok(v.ails.every(l => l.ail === '出血'))
  // ★外れたら付かない：状態異常の直前のボスの行動は、当たった通常攻撃
  const nimble = { ...dummy(), stats: { ...dummy().stats, agi: 400 } }
  const dodged = normalsOf('varuzenoku', 'hard', nimble)
  const acts = dodged.st.log.filter(l => l.type === 'ailment' || (l.side === dodged.name && l.type === 'normal'))
  assert.ok(dodged.ails.length > 0 && acts.some(l => l.type === 'normal' && !l.hit), '当たりも外れもある戦闘で確かめている')
  acts.forEach((l, i) => { if (l.type === 'ailment') assert.equal(acts[i - 1].hit, true) })
  const a = normalsOf('amaza', 'hard')
  assert.ok(a.ails.length > 0 && a.ails.every(l => l.ail === '鈍足'), '雨礫は鈍足')
})

test('【確定】2026-11-01 黒翼烈風：鈍足をやめて2回の多段（合計1.8倍のまま）・1発ごとに出血50%', () => {
  const s = DUNGEON_BOSSES.varuzenoku.skills.find(x => x.name === '黒翼烈風')
  assert.equal(s.mult * s.hits, 1.8, '合計の倍率は前と同じ')
  assert.equal(s.hits, 2)
  assert.deepEqual(s.ail, { key: 'bleed', chance: 50 })
  assert.equal(s.ailPerHit, true)
  assert.ok(!s.noCrit, 'クリティカルは前と同じように出る')
  // 実際に撃たせて数える（HPが25〜50%のあいだは黒翼烈風が出やすい）
  const f = dungeonFighter('varuzenoku', 'hard')
  const st = createAtb(dummy(), f, { rng: rngOf(21), maxSec: 9999 })
  st.b.hp = Math.floor(st.b.base.hp * 0.4)
  runFor(st, 900)
  const counts = []
  st.log.forEach((l, i) => {
    if (l.side !== BOSS || l.skill !== '黒翼烈風' || l.type !== 'skill') return
    assert.equal(l.of, 2, '2回当たりにいく')
    let n = 0
    for (let j = i + 1; j < st.log.length; j++) {
      const x = st.log[j]
      if (x.side === BOSS && (x.type === 'skill' || x.type === 'normal')) break
      if (x.type === 'ailment') { assert.equal(x.ail, '出血', '鈍足は付かない'); n++ }
    }
    assert.ok(n <= l.hits, '当たった回数より多くは付かない')
    counts.push({ n, hits: l.hits })
  })
  assert.ok(counts.length > 20, `何度も撃った（${counts.length}回）`)
  const landed = counts.reduce((a, c) => a + c.hits, 0), inflicted = counts.reduce((a, c) => a + c.n, 0)
  assert.ok(inflicted >= landed * 0.35 && inflicted <= landed * 0.65, `1発ごとにだいたい50%（${inflicted}/${landed}）`)
  assert.ok(counts.some(c => c.n === 2), '1回で2つ付くこともある')
  // 重ねて2発当てたときのダメージは、前の1発（1.8倍）と変わらない
  const avg = (fighter) => {
    const t = createAtb(dummy(), fighter, { rng: rngOf(21), maxSec: 9999 })
    t.b.hp = Math.floor(t.b.base.hp * 0.4)
    runFor(t, 900)
    const xs = t.log.filter(l => l.side === BOSS && l.skill === '黒翼烈風' && l.type === 'skill' && l.hits === l.of && !l.crit).map(l => l.damage)
    return xs.reduce((a, x) => a + x, 0) / xs.length
  }
  const one = { ...f, slots: f.slots.map(x => (x.skill.name === '黒翼烈風' ? { ...x, skill: { ...x.skill, mult: 1.8, hits: 1, ail: null, ailPerHit: false } } : x)) }
  const ratio = avg(f) / avg(one)
  assert.ok(ratio > 0.9 && ratio < 1.1, `2発の合計÷前の1発＝${ratio}`)
})

test('【確定】2026-11-01 黒翼烈風の記録に1発ごとの当たりを足した（画面で2回に分ける）：計算には入らない・足すと合計・絵の風の刃と同じ数・オート戦闘の記録は増えない', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'hard'), { rng: rngOf(33), maxSec: 9999 })
  st.b.hp = Math.floor(st.b.base.hp * 0.4)
  runFor(st, 600)
  const list = st.log.filter(l => l.side === BOSS && l.skill === '黒翼烈風' && l.type === 'skill')
  assert.ok(list.length > 20)
  const kinds = new Set()
  for (const l of list) {
    assert.equal(l.perHit.length, l.of, '1発ごと')
    assert.equal(l.perHit.filter(Boolean).length, l.hits, '当たった数')
    assert.equal(l.perHit.some(h => h?.crit), l.crit, 'クリティカルも1発ごと')
    const each = splitHits(l.damage, l.perHit)
    assert.equal(each.reduce((s, h) => s + (h?.amount || 0), 0), l.damage, '足すと合計')
    kinds.add(l.perHit.map(h => (h ? 'o' : 'x')).join(''))
  }
  assert.ok(kinds.has('oo'), '2発とも当たることがある')
  // 1発だけの技には付けない（記録を増やさない）
  assert.ok(st.log.filter(l => l.type === 'skill' && l.of === 1).every(l => !('perHit' in l)))
  // 絵の1発ごとの数は技の回数と同じ（多段にしたら絵も2発に＝ここで止まる）
  for (const [key, b] of Object.entries(DUNGEON_BOSSES)) {
    const a = bossIllustOf(key)
    for (const s of b.skills) {
      const m = Object.values(a.motions).find(x => x.label === s.name)
      if (m) assert.equal(m.strikes?.length || 1, s.hits || 1, `${key} ${s.name}`)
    }
  }
  // オート戦闘（出撃・塔）の記録には付けない
  const log = [], f = dungeonFighter('varuzenoku', 'hard')
  takeAction(createSide(f), createSide(dummy()), rngOf(3), log, { idx: f.slots.findIndex(x => x.skill.name === '黒翼烈風'), noProc: true })
  const e = log.find(l => l.type === 'skill')
  assert.equal(e.of, 2)
  assert.ok(!('perHit' in e))
})

test('【確定】2026-11-01 終焉の黒焔：4倍・当たると回復阻害（回復量−30%）・薬の回復も下がる', () => {
  const s = DUNGEON_BOSSES.varuzenoku.skills.find(x => x.name === '終焉の黒焔')
  assert.equal(s.mult, 4)
  assert.equal(s.castSec, 3.5)
  assert.deepEqual(s.ail, { key: 'healCut', chance: 100, pct: 30 })
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(5), maxSec: 9999 })
  st.a.hp = Math.floor(st.a.base.hp / 2)
  const before = healMaxAmount(st.a, 30)
  st.b.hp = Math.floor(st.b.base.hp * 0.2)
  for (let i = 0; i < 2000 && !st.log.some(l => l.skill === '終焉の黒焔' && l.type === 'skill' && l.hits > 0); i++) runFor(st, 0.1)
  assert.ok(st.log.some(l => l.side === 'じぶん' && l.type === 'ailment' && l.ail === '回復阻害'), '画面の記録にも出る')
  assert.equal(st.a.ail.healCut.pct, 30)
  assert.equal(healMultOf(st.a.ail), 0.7)
  assert.ok(Math.abs(healMaxAmount(st.a, 30) / before - 0.7) < 0.001, 'HPポーションの回復も−30%')
})

test('【確定】2026-11-01 水天葬：4倍・相手のHPが40%未満で1.5倍・10%以下で3倍（いちばん大きい倍率だけ）', () => {
  const s = DUNGEON_BOSSES.amaza.skills.find(x => x.name === '水天葬')
  assert.equal(s.mult, 4)
  assert.equal(s.castSec, 3.5)
  const at = (pct) => hpStepMultOf(s, { hp: pct * 10, base: { hp: 1000 } })
  assert.deepEqual([100, 40, 39.9, 10.1, 10, 1, 0].map(at), [1, 1, 1.5, 1.5, 3, 3, 3], '40%ちょうどは上がらない・10%ちょうどは3倍')
  assert.equal(hpStepMultOf({ name: 'ほかの技', mult: 1 }, { hp: 1, base: { hp: 1000 } }), 1, '書いていない技は変わらない')
  // 実際のダメージ：撃つ瞬間の自分のHPで変わる
  const fired = (pct) => {
    const st = createAtb(dummy(), dungeonFighter('amaza', 'normal'), { rng: rngOf(9), maxSec: 9999 })
    st.b.hp = Math.floor(st.b.base.hp * 0.2)
    const xs = () => st.log.filter(l => l.side === '雨摩座' && l.skill === '水天葬' && l.type === 'skill' && l.hits > 0 && !l.crit)
    for (let i = 0; i < 20000 && xs().length < 8; i++) { st.a.hp = Math.floor(st.a.base.hp * pct / 100); runFor(st, 0.1) }
    assert.equal(xs().length, 8)
    return xs().reduce((a, l) => a + l.damage, 0) / 8
  }
  const full = fired(90)
  assert.ok(Math.abs(fired(40) / full - 1) < 0.1, '40%は上がらない')
  assert.ok(Math.abs(fired(30) / full - 1.5) < 0.15, '40%未満は1.5倍')
  assert.ok(Math.abs(fired(10) / full - 3) < 0.3, '10%以下は3倍（4.5倍にならない）')
})

test('【確定】2026-11-01 篠突く雨：INTだけ+35%（STRは上がらない）。逆鱗はそのまま', () => {
  const st = createAtb(dummy(), dungeonFighter('amaza', 'normal'), { rng: rngOf(4), maxSec: 9999 })
  const before = liveStats(st.b, true)
  st.b.hp = Math.floor(st.b.base.hp * 0.29)
  for (let i = 0; i < 400 && !hpBuffChips(st.b).some(c => c.name === '篠突く雨'); i++) runFor(st, 0.1)
  assert.ok(hpBuffChips(st.b).some(c => c.name === '篠突く雨'))
  const after = liveStats(st.b, true)
  assert.equal(after.str, before.str, 'STRは上がらない')
  assert.ok(Math.abs(after.int_stat / before.int_stat - 1.35) < 0.02, `INTは+35%（${after.int_stat}/${before.int_stat}）`)
  assert.deepEqual(DUNGEON_BOSSES.varuzenoku.pattern.buffs.find(b => b.name === '逆鱗').table, { str: 25, int_stat: 25 })
})

test('【確定】2026-10-29 ボスの強さ：守りと速さは power・攻撃（STR・INT）だけ atk 倍・HPは全体（持ち越し）', () => {
  for (const k of ['normal', 'hard']) {
    const d = diffOf('varuzenoku', k), f = dungeonFighter('varuzenoku', k)
    const base = statsOf({ power: d.power, dist: DUNGEON_BOSSES.varuzenoku.dist })
    assert.equal(f.stats.hp, d.hp)
    assert.equal(f.stats.vit, base.vit)
    assert.equal(f.stats.agi, base.agi)
    assert.equal(f.stats.str, Math.round(base.str * d.atk))
    assert.equal(f.stats.int_stat, Math.round(base.int_stat * d.atk))
    assert.ok(f.boss && f.pattern)
    assert.equal(dungeonFighter('varuzenoku', k, d.hp * 0.4).hpNow, d.hp * 0.4)
    assert.equal(dungeonFighter('varuzenoku', k, d.hp * 9).hpNow, d.hp, 'いまのHPは全体より多くならない')
  }
  assert.deepEqual({ ...diffOf('varuzenoku', 'normal') }, { label: 'ノーマル', area: 2, recLv: 25, recPower: 500, power: 474, atk: 0.36, hp: 13000, reward: { exp: 175, gold: 1250 } })
  assert.deepEqual({ ...diffOf('varuzenoku', 'hard') }, { label: 'ハード', area: 5, recLv: 45, recPower: 1050, power: 1027, atk: 0.4, hp: 30000, reward: { exp: 350, gold: 2250 } })
})

test('【確定】2026-10-29 ボスの技：HP75%より上は黒爪だけ・75%を切ったら次の行動で焦熱の吐息を必ず・そのあとは吐息30%', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(3), maxSec: 999 })
  runFor(st, 40)
  assert.ok(bossActs(st).length >= 6)
  assert.ok(bossActs(st).every(a => a === '黒爪'), `75%より上は黒爪だけ：${bossActs(st).join('・')}`)
  const n0 = bossActs(st).length
  st.b.hp = Math.floor(st.b.base.hp * 0.74)
  runFor(st, 6)
  assert.equal(bossActs(st)[n0], '焦熱の吐息', '切った次の行動で必ず')
  runFor(st, 400)
  const after = bossActs(st).slice(n0 + 1)
  const breath = after.filter(a => a === '焦熱の吐息').length / after.length
  assert.ok(after.every(a => a === '黒爪' || a === '焦熱の吐息'))
  assert.ok(breath > 0.18 && breath < 0.42, `吐息は3割ほど（${breath.toFixed(2)}）`)
})

test('【確定】2026-10-29 HP50%以下は毎回技（50%で黒翼烈風を必ず）・25%で終焉の黒焔を必ず（構えてから）', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.6), { rng: rngOf(7), maxSec: 999 })
  runFor(st, 1)
  const n0 = bossActs(st).length
  st.b.hp = Math.floor(st.b.base.hp * 0.49)
  runFor(st, 6)
  assert.equal(bossActs(st)[n0], '黒翼烈風')
  runFor(st, 200)
  const mid = bossActs(st).slice(n0)
  assert.ok(mid.every(a => a === '焦熱の吐息' || a === '黒翼烈風'), `毎回技：${[...new Set(mid)].join('・')}`)
  const n1 = bossActs(st).length
  st.b.hp = Math.floor(st.b.base.hp * 0.2)
  runFor(st, 16)   // 30%のバフの行動が先に入ることがある
  assert.equal(bossActs(st)[n1], '構え:終焉の黒焔', '25%で黒焔の構え')
  runFor(st, 300)
  const low = bossActs(st).slice(n1)
  assert.ok(!low.includes('黒爪'), '25%以下も毎回技')
  assert.ok(low.includes('終焉の黒焔') && low.filter(a => a === '構え:終焉の黒焔').length >= 3, '黒焔はそのあとも出る（構えてから）')
})

test('【確定】2026-10-29 挑戦の始めにもう切っている節目は撃たない（前の挑戦で撃った）・同じ種なら同じ結果', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.4), { rng: rngOf(11), maxSec: 999 })
  assert.equal(st.b.hp, 13000 * 0.4)
  assert.equal(st.b.startHp, 13000 * 0.4, '削った量はここから数える')
  assert.deepEqual([...st.b.patFired].sort(), [0.5, 0.75])
  runFor(st, 60)
  const acts = bossActs(st)
  assert.ok(acts.every(a => a === '焦熱の吐息' || a === '黒翼烈風'), '50%より下から始めた：吐息か烈風（必ず撃つ技はない）')
  const again = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.4), { rng: rngOf(11), maxSec: 999 })
  runFor(again, 60)
  assert.deepEqual(bossActs(again), acts, '同じ種なら同じ')
})

test('【確定】2026-10-29 鈍足はATBではゲージが20%遅くなる（AGIは下げない）・出撃の戦闘は今までどおりAGI−20%', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(1) })
  const a = st.a
  const before = liveStats(a)
  const fill0 = fillPerSecOf(a, before, liveStats(st.b))
  a.ail.slow = { turns: 4 }
  const after = liveStats(a)
  assert.equal(after.agi, before.agi, 'ATBでは鈍足でAGIは下がらない')
  assert.ok(Math.abs(fillPerSecOf(a, after, liveStats(st.b)) - fill0 * (1 - ATB_SLOW_CUT / 100)) < 1e-9, 'ゲージが20%遅い')
  assert.equal(ATB_SLOW_CUT, 20)
  assert.ok(fill0 >= FILL_PER_SEC)
  // 出撃の戦闘（atb ではない側）はAGI−20%のまま
  const auto = { ...a, atb: false }
  assert.ok(liveStats(auto).agi < before.agi)
})

// ===== 2026-10-30 HPの節目のバフ・雨摩座 =====
const buffLog = (st, name = BOSS) => st.log.filter(l => l.side === name && l.type === 'hpBuff').map(l => l.skill)
const near = (a, b) => Math.abs(a - b) <= 1

test('【確定】2026-10-30 HPの節目のバフ：60%で黒鱗の鎧（VIT+25%）・30%で逆鱗（STR・INT+25%）。切るとバフの行動に入って付き、時間では消えない', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(5), maxSec: 999 })
  runFor(st, 20)
  assert.deepEqual(buffLog(st), [], '60%より上は付かない')
  const s0 = liveStats(st.b)
  st.b.hp = Math.floor(st.b.base.hp * 0.59)
  runFor(st, 9)
  assert.deepEqual(buffLog(st), ['黒鱗の鎧'])
  assert.deepEqual(hpBuffChips(st.b), [{ name: '黒鱗の鎧', table: { vit: 25 } }])
  assert.ok(near(liveStats(st.b).vit, s0.vit * 1.25), `VIT+25%（${s0.vit}→${liveStats(st.b).vit}）`)
  assert.ok(near(liveStats(st.b).str, s0.str), 'STRはまだ')
  st.b.hp = Math.floor(st.b.base.hp * 0.29)
  runFor(st, 9)
  assert.deepEqual(buffLog(st), ['黒鱗の鎧', '逆鱗'])
  const s1 = liveStats(st.b)
  assert.ok(near(s1.str, s0.str * 1.25) && near(s1.int_stat, s0.int_stat * 1.25), 'STR・INT+25%')
  runFor(st, 400)
  assert.ok(near(liveStats(st.b).vit, s0.vit * 1.25) && near(liveStats(st.b).str, s0.str * 1.25), '時間がたっても消えない')
  assert.deepEqual(buffLog(st), ['黒鱗の鎧', '逆鱗'], '1回ずつ')
  assert.equal(st.b.timed.length, 0, '時間で切れる枠には入れない')
})

test('【確定】2026-10-30 節目のバフはバフ消しでも消えない（選ばれもしない＝「強化が消えた」と出ない）', () => {
  const me = { ...dummy(), slots: [{ skill: { name: 'ためしの消し', kind: 'phys', mult: 0.1, proc: 100, mp: 0, dispel: { chance: 100 } }, uses: 9999 }] }
  const st = createAtb(me, dungeonFighter('varuzenoku', 'normal', 13000 * 0.2), { rng: rngOf(9), maxSec: 999 })
  startMacro(st, 1, [{ idx: 0 }], true)
  const s0 = liveStats(st.b)
  runFor(st, 120)
  assert.ok(st.log.filter(l => l.side === 'じぶん' && l.type === 'skill' && l.skill === 'ためしの消し').length >= 10, 'バフ消しを何度も撃った')
  assert.equal(st.log.filter(l => l.type === 'dispel').length, 0, '消せるバフが無い')
  assert.ok(near(liveStats(st.b).vit, s0.vit) && near(liveStats(st.b).str, s0.str), '残っている')
  assert.deepEqual(hpBuffChips(st.b).map(c => c.name), ['黒鱗の鎧', '逆鱗'])
})

// ===== 2026-10-30 バフの行動（0.5秒のゲージ・技の動きと重ならない・出血などを受けない）=====
const newFight = (seed = 5) => createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(seed), maxSec: 999 })
const bossHits = (st) => st.log.filter(l => l.side === BOSS && (l.type === 'skill' || l.type === 'normal')).length
const bossCasts = (st) => st.log.filter(l => l.side === BOSS && l.type === 'cast').length
const untilTrue = (st, fn, max = 40) => { const end = st.t + max; while (!fn() && st.t < end) runFor(st, 0.05); assert.ok(fn(), '時間内に起きた') }

test('【確定】2026-10-30 バフの行動（ユーザー「バフの行動になるとき0.5秒のゲージ貯めるようにして」）：切ってもすぐ付かず、ゲージを空にして0.5秒で貯めてから付く・付いたあとゲージは空から', () => {
  assert.equal(BUFF_GAUGE_SEC, 0.5)
  const st = newFight()
  // 最後の技から十分たって、ふだんのゲージが貯まっているときに切る
  untilTrue(st, () => bossHits(st) >= 1)
  runFor(st, BUFF_WAIT_AFTER_ACT_SEC + 0.2)
  assert.ok(st.b.gauge > 0, 'ふだんのゲージが貯まっている')
  st.b.hp = Math.floor(st.b.base.hp * 0.59)
  untilTrue(st, () => st.b.buffAct)
  const hits = bossHits(st)
  assert.ok(st.b.gauge === 0 || st.b.gauge < 1, 'ゲージを空にして貯めはじめる')
  assert.ok(Math.abs(st.b.buffAct.until - st.b.buffAct.start - BUFF_GAUGE_SEC) < 1e-9)
  assert.deepEqual(hpBuffChips(st.b), [], 'まだ付いていない')
  const t0 = st.b.buffAct.start
  untilTrue(st, () => hpBuffChips(st.b).length)
  assert.ok(Math.abs(st.t - t0 - BUFF_GAUGE_SEC) < 0.051, `0.5秒で付く（${st.t - t0}）`)
  assert.equal(st.b.buffAct, null)
  assert.ok(st.b.gauge < GAUGE_FULL * 0.05, 'ゲージはまた空から（バフが1回の行動のぶん）')
  assert.equal(bossHits(st), hits, 'バフの行動は技の行動ではない')
  assert.deepEqual(buffLog(st), ['黒鱗の鎧'])
})

test('【確定】2026-10-30 バフと技の動きが重ならない（ユーザー「バフと攻撃モーションが被って変になるときある」）：技の動きが終わるのを待つ・構えのあいだも待つ・見せおわるまで技を出さない・同時に切ったら順に', () => {
  // どの時刻に切っても、ゲージを貯めはじめるのは最後の技の動きが終わってから・付いてから見せおわるまで技を出さない
  for (const offset of [0, 0.3, 1, 2, 3, 4.5]) {
    const st = newFight(7)
    untilTrue(st, () => bossHits(st) >= 1)
    runFor(st, offset)
    st.b.hp = Math.floor(st.b.base.hp * 0.59)
    let lastHit = st.t - offset, hits = bossHits(st)
    while (!st.b.buffAct) {
      runFor(st, 0.05)
      if (bossHits(st) > hits) { hits = bossHits(st); lastHit = st.t }
      assert.ok(st.t < 60)
    }
    assert.ok(st.b.buffAct.start + 1e-6 >= lastHit + BUFF_WAIT_AFTER_ACT_SEC, `${offset}秒：技（${lastHit}）の動きが終わってから貯める（${st.b.buffAct.start}）`)
    untilTrue(st, () => hpBuffChips(st.b).length)
    assert.equal(bossHits(st), hits, `${offset}秒：ゲージのあいだは技を出さない`)
    runFor(st, BUFF_SHOW_SEC - 0.1)
    assert.equal(bossHits(st), hits, `${offset}秒：見せているあいだは技を出さない`)
    runFor(st, 30)
    assert.ok(bossHits(st) > hits, '見せおわったら、また動く')
  }
  // 構えのあいだに切っても、撃って動きが終わるまで待つ
  const st = newFight(3)
  st.b.buffSeen.push('黒鱗の鎧', '逆鱗')       // まだ切っていないことにする
  st.b.patFired.push(0.75, 0.5)
  st.b.hp = Math.floor(st.b.base.hp * 0.24)   // 次の行動は大技
  untilTrue(st, () => st.b.cast)
  const until = st.b.cast.until
  st.b.buffSeen = []                          // 構えのあいだに切った
  untilTrue(st, () => st.b.buffAct)
  assert.ok(st.b.buffAct.start + 1e-6 >= until + BUFF_WAIT_AFTER_ACT_SEC, `構え（${until}）のあと動きが終わってから（${st.b.buffAct.start}）`)
  assert.ok(st.log.some(l => l.side === BOSS && l.type === 'skill' && l.skill === '終焉の黒焔'), '大技は撃った')
  // 同時に2つ切ったら、見せおわってから次
  const two = newFight(4)
  two.b.hp = Math.floor(two.b.base.hp * 0.2)
  const times = []
  for (let i = 0; i < 800 && times.length < 2; i++) { runFor(two, 0.05); while (times.length < two.b.hpBuffsOn.length) times.push(two.t) }
  assert.deepEqual(two.b.hpBuffsOn.map(c => c.name), ['黒鱗の鎧', '逆鱗'], '切った順')
  assert.ok(times[1] - times[0] + 1e-6 >= BUFF_SHOW_SEC + BUFF_GAUGE_SEC, `${times}`)
  // バフの行動を待っているあいだに大技の構えに入らない（バフが先）
  const first = newFight(8)
  first.b.buffQueue.push(first.b.pattern.buffs[0])
  first.b.buffSeen.push(first.b.pattern.buffs[0].name)
  first.b.motionUntil = 3
  first.b.gauge = GAUGE_FULL
  runFor(first, 1)
  assert.equal(bossHits(first) + bossCasts(first), 0, 'ゲージが満タンでもバフが先')
})

test('【確定】2026-10-30 バフの行動は出血などを受けない（ユーザー「バフの行動時は出血とかの影響は受けないように」）：出血が刻まない・麻痺でも止まらない・鈍足でも遅れない・区切りの毒も刻まない', () => {
  const start = (setup) => {
    const st = newFight(6)
    setup(st.b)
    st.b.buffSeen.push('黒鱗の鎧')
    st.b.buffQueue.push(st.b.pattern.buffs[0])
    return st
  }
  const ticks = (st) => st.log.filter(l => l.side === BOSS && l.type === 'ailTick')
  const on = (st) => hpBuffChips(st.b).map(c => c.name)
  // 出血：行動の直後に刻むが、バフの行動では刻まない（スタックも減らない）
  const b = start((s) => { inflict(s.ail, 'bleed', { stacks: 5 }) })
  const hp0 = b.b.hp, age0 = b.b.ail.bleed.age
  runFor(b, BUFF_GAUGE_SEC + 0.2)
  assert.deepEqual(on(b), ['黒鱗の鎧'])
  assert.equal(ticks(b).length, 0, '出血が刻まない')
  assert.equal(b.b.hp, hp0, 'HPが減らない')
  assert.equal(b.b.ail.bleed.age, age0, '出血の数えも進まない')
  // 麻痺：ふだんのゲージは止まるが、バフのゲージは止まらない
  const p = start((s) => { s.ail.paralyze = { turns: 99 } })
  runFor(p, BUFF_GAUGE_SEC + 0.2)
  assert.deepEqual(on(p), ['黒鱗の鎧'], '麻痺でも止まらない')
  // 鈍足：ふだんのゲージは遅くなるが、バフのゲージは0.5秒のまま
  const s = start((x) => { inflict(x.ail, 'slow') })
  runFor(s, BUFF_GAUGE_SEC + 0.2)
  assert.deepEqual(on(s), ['黒鱗の鎧'], '鈍足でも遅れない')
  // 区切りの毒：ゲージを貯めてから見せおわるまでの区切りでは刻まない（1つ目の区切りのあとに毒を入れ、2つ目の区切りの1秒前に切る）
  const t = newFight(6)
  runFor(t, 2 * TURN_SEC - 1)
  inflict(t.b.ail, 'poison')
  t.b.motionUntil = 0
  t.b.buffSeen.push('黒鱗の鎧')
  t.b.buffQueue.push(t.b.pattern.buffs[0])
  runFor(t, BUFF_GAUGE_SEC + BUFF_SHOW_SEC)     // 2つ目の区切りはこの中
  assert.ok(t.t > 2 * TURN_SEC)
  assert.deepEqual(on(t), ['黒鱗の鎧'])
  assert.equal(ticks(t).length, 0, 'バフの行動のあいだは毒が刻まない')
  runFor(t, TURN_SEC + 0.2)
  assert.ok(ticks(t).length > 0, '終わったらまた刻む')
})

test('【確定】2026-10-30 大技の節目（ユーザー「大技に入るとき、ATBリセットしてるでしょ？そのHPを切ったらすぐモーションに移行していいよ」）：25%を切ったらゲージを待たずに構えに入る・ゲージは空に', () => {
  // 最後の技から十分たって切る＝次の刻みで構えに入る
  const st = newFight(11)
  st.b.buffSeen.push('黒鱗の鎧', '逆鱗')   // 大技だけを見る
  st.b.patFired.push(0.75, 0.5)
  untilTrue(st, () => bossHits(st) >= 1)
  runFor(st, NOW_WAIT_AFTER_ACT_SEC + 0.2)
  assert.ok(st.b.gauge > 0 && st.b.gauge < GAUGE_FULL, 'ふだんのゲージは途中')
  const tCut = st.t
  st.b.hp = Math.floor(st.b.base.hp * 0.24)
  runFor(st, 0.05)
  assert.ok(st.b.cast, 'すぐ構えに入る')
  assert.equal(st.b.cast.name, '終焉の黒焔')
  assert.ok(st.t - tCut <= 0.051)
  assert.equal(st.b.gauge, 0, 'ゲージは空に')
  const hits = bossHits(st)
  // 撃ったらゲージは空から・節目は1回だけ（次からはふだんの確率）
  untilTrue(st, () => !st.b.cast)
  assert.equal(bossHits(st), hits + 1)
  assert.ok(st.b.gauge < 2, '撃ったあともゲージは空から')
  assert.ok(st.b.patFired.includes(0.25))
  runFor(st, 0.2)
  assert.equal(st.b.cast, null, 'もう一度すぐ構えない')
  // 【確定】2026-10-31 ユーザー「HP25％以下になったらゲージ状況がどうなっても大技のゲージに移行して、空振りが多すぎる」：
  //   技の動きのあいだに切っても、ゲージはすぐ赤くなる。構えの見せ方は動きが終わってから（長さは同じ＝赤いゲージがそのぶん長い）
  const m = newFight(12)
  m.b.buffSeen.push('黒鱗の鎧', '逆鱗')
  m.b.patFired.push(0.75, 0.5)
  untilTrue(m, () => bossHits(m) >= 1)
  const tHit = m.t, n = bossHits(m)
  m.b.hp = Math.floor(m.b.base.hp * 0.24)
  runFor(m, 0.05)
  assert.ok(m.b.cast, 'すぐ大技のゲージへ')
  assert.equal(m.b.gauge, 0, 'ふつうのゲージは空に')
  assert.ok(Math.abs(m.b.cast.showAt - (tHit + NOW_WAIT_AFTER_ACT_SEC)) < 1e-6, '構えの見せ方は動きが終わってから')
  assert.ok(Math.abs(m.b.cast.until - m.b.cast.showAt - 3.5) < 1e-6, '構えの見せ方の長さは変わらない')
  assert.equal(castMsOf(m.b.cast, m.t), null, '動きのあいだは構えを見せない')
  runFor(m, NOW_WAIT_AFTER_ACT_SEC)
  assert.ok(castMsOf(m.b.cast, m.t) >= 0, '動きが終わったら構えを見せる')
  assert.equal(bossHits(m), n, 'そのあいだほかの技は出さない')
  // ふつうのゲージが満タンでも、攻撃せずに大技のゲージへ（ゲージの状況によらない）
  const full = newFight(15)
  full.b.buffSeen.push('黒鱗の鎧', '逆鱗')
  full.b.patFired.push(0.75, 0.5)
  untilTrue(full, () => bossHits(full) >= 1)
  runFor(full, NOW_WAIT_AFTER_ACT_SEC + 0.2)
  full.b.gauge = GAUGE_FULL - 0.01
  const nFull = bossHits(full)
  full.b.hp = Math.floor(full.b.base.hp * 0.24)
  runFor(full, 0.05)
  assert.ok(full.b.cast && full.b.gauge === 0)
  assert.equal(bossHits(full), nFull, '空振り（ふつうの行動）が出ない')
  // 25%以下のふだんの確率で大技を引いたときも、ふつうのゲージを貯めずに大技のゲージへ。大技の直後は大技を引かない
  const later = newFight(16)
  later.b.buffSeen.push('黒鱗の鎧', '逆鱗')
  later.b.patFired.push(0.75, 0.5, 0.25)
  later.b.hp = Math.floor(later.b.base.hp * 0.2)
  later.a.hp = later.a.base.hp = 1e9
  let bigs = 0, peak = 0, last = null, twice = 0, wasBig = false
  while (later.t < 170 && !later.over) {
    runFor(later, 0.05)
    if (later.b.cast && later.b.cast !== last) {
      if (later.b.justBig) twice += 1
      bigs += 1; last = later.b.cast
      assert.ok(peak < GAUGE_FULL, `大技の前にふつうのゲージが満タンにならない（${peak}）`)
    }
    peak = later.b.cast ? 0 : Math.max(later.b.gauge, later.b.justBig !== wasBig ? 0 : peak)
    if (later.b.justBig !== wasBig) { wasBig = later.b.justBig; peak = 0 }
    later.b.hp = Math.floor(later.b.base.hp * 0.2)
  }
  assert.ok(bigs >= 3, `大技が何度か出る（${bigs}回）`)
  assert.equal(twice, 0, '大技の直後は大技を引かない')
  // バフの行動が先：30%と25%を一度に切ったら、バフが付いてから赤いゲージ。構えの見せ方はバフを見せおわってから
  const b = newFight(13)
  b.b.buffSeen.push('黒鱗の鎧')
  b.b.patFired.push(0.75, 0.5)
  b.b.hp = Math.floor(b.b.base.hp * 0.24)
  runFor(b, 0.05)
  assert.equal(b.b.cast, null, 'バフが先')
  untilTrue(b, () => hpBuffChips(b.b).length)
  const tBuff = b.t
  assert.ok(b.b.cast, 'バフが付いたらすぐ赤いゲージ')
  assert.equal(b.b.gauge, 0)
  assert.ok(Math.abs(b.b.cast.showAt - (tBuff + BUFF_SHOW_SEC)) < 1e-6, `構えの見せ方は見せおわってから（${tBuff}→${b.b.cast.showAt}）`)
  assert.equal(castMsOf(b.b.cast, b.t), null, 'バフを見せているあいだは構えの絵を出さない')
  // 麻痺のあいだは構えない
  const p = newFight(14)
  p.b.buffSeen.push('黒鱗の鎧', '逆鱗')
  p.b.patFired.push(0.75, 0.5)
  p.b.ail.paralyze = { turns: 1 }
  p.b.parUntil = 1
  p.b.hp = Math.floor(p.b.base.hp * 0.24)
  runFor(p, 0.5)
  assert.equal(p.b.cast, null, '麻痺のあいだは待つ')
  runFor(p, 0.7)
  assert.ok(p.b.cast, '解けたら構える')
  // 持ち越しで25%をもう切っているなら撃たない（前の挑戦で撃った）
  const c = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.2), { rng: rngOf(15), maxSec: 999 })
  runFor(c, 1)
  assert.equal(c.b.cast, null)
})

test('【確定】2026-11-01 ユーザー「大技するとき、ゲージ貯まってから大技に行ってない？該当のHP切った瞬間に大技に移行してほしいんだけど」：どの時刻に切っても、ふつうのゲージは増えず、ほかの技も出ない', () => {
  for (const key of Object.keys(DUNGEON_BOSSES)) {
    const boss = DUNGEON_BOSSES[key], [first, last] = boss.pattern.buffs
    const name = boss.name
    // 30%のバフの行動の前・金のゲージ・見せているあいだ・そのあとを 0.1秒きざみで全部切ってみる
    for (let off = 0.1; off <= 9; off += 0.1) {
      const st = createAtb(dummy(), dungeonFighter(key, 'normal'), { rng: rngOf(40 + Math.round(off * 10)), maxSec: 999 })
      st.b.buffSeen.push(first.name)
      st.b.patFired.push(0.75, 0.5)
      st.b.hp = Math.floor(st.b.base.hp * 0.29)
      runFor(st, off)
      assert.equal(st.b.cast, null, '切る前は構えていない')
      const acts = () => st.log.filter(l => l.side === name && (l.type === 'skill' || l.type === 'normal')).length
      const g0 = st.b.gauge, n0 = acts()
      st.b.hp = Math.floor(st.b.base.hp * 0.24)
      runFor(st, 0.05)
      for (let i = 0; !st.b.cast; i++) {
        assert.ok(i < 80, `${key} ${off.toFixed(1)}秒：赤いゲージにならない`)
        // 待ってよいのはバフのゲージを貯めおわるまで（前はバフを見せているあいだも待ち、そのあいだふつうのゲージが上がった）
        assert.ok(st.b.buffQueue.length || st.b.buffAct, `${key} ${off.toFixed(1)}秒：バフの行動でもないのに待っている（ゲージ${st.b.gauge}）`)
        assert.ok(st.b.gauge <= g0, `${key} ${off.toFixed(1)}秒：切ったあとにふつうのゲージが増えた`)
        runFor(st, 0.05)
      }
      assert.equal(st.b.gauge, 0, 'ふつうのゲージは空に')
      assert.equal(acts(), n0, 'ほかの技を出さない')
      assert.equal(st.b.cast.name, boss.pattern.steps.find(s => s.now).skill)
      assert.ok(st.b.buffSeen.includes(last.name))
    }
  }
  // バフを見せているあいだに切る：すぐ赤いゲージ・構えの見せ方と撃つ時刻は、見せおわってから（＝撃つ時刻は前と同じ）
  const st = newFight(21)
  st.b.buffSeen.push('黒鱗の鎧')
  st.b.patFired.push(0.75, 0.5)
  st.b.hp = Math.floor(st.b.base.hp * 0.29)
  untilTrue(st, () => hpBuffChips(st.b).length)
  const tBuff = st.t
  runFor(st, 1)
  assert.ok(st.b.gauge > 0 && !st.b.cast, 'まだ切っていないのでふつうのゲージ')
  st.b.hp = Math.floor(st.b.base.hp * 0.24)
  runFor(st, 0.05)
  assert.ok(st.b.cast, 'すぐ赤いゲージ')
  assert.equal(st.b.gauge, 0)
  assert.ok(Math.abs(st.b.cast.showAt - (tBuff + BUFF_SHOW_SEC)) < 1e-6)
  assert.equal(castMsOf(st.b.cast, st.t), null, 'バフのポーズが先')
  assert.ok(Math.abs(st.b.cast.until - st.b.cast.showAt - 3.5) < 1e-6)
  runFor(st, tBuff + BUFF_SHOW_SEC - st.t + 0.05)
  assert.ok(castMsOf(st.b.cast, st.t) >= 0, '見せおわったら構えの絵')
})

test('【確定】2026-11-01 ユーザー「HP25％以下の大技使用率もう少し上げてほしい、3回に1回くらいうつ感じで」：25%以下は行動3回に1回・続けては出ない', () => {
  for (const key of Object.keys(DUNGEON_BOSSES)) {
    const boss = DUNGEON_BOSSES[key], big = boss.pattern.steps.find(s => s.now).skill
    assert.equal(boss.pattern.bands.at(-1).weights[big], 50, `${key}：引ける番の50%（直後は引かないので3回に1回）`)
    let acts = 0, bigs = 0
    for (let seed = 1; seed <= 6; seed++) {
      const st = createAtb(dummy(), dungeonFighter(key, 'normal', 13000 * 0.2), { rng: rngOf(seed), maxSec: 999 })
      runFor(st, 600)
      const names = st.log.filter(l => l.side === boss.name && (l.type === 'skill' || l.type === 'normal')).map(l => l.skill || '通常')
      names.forEach((n, i) => assert.ok(!(n === big && names[i - 1] === big), `${key}：大技が続けて出た`))
      acts += names.length
      bigs += names.filter(n => n === big).length
    }
    assert.ok(acts > 400, `${key}：${acts}行動`)
    assert.ok(Math.abs(bigs / acts - 1 / 3) < 0.04, `${key}：大技は行動の3分の1（${bigs}/${acts}）`)
  }
})

test('【確定】2026-10-30 溜めは4秒（ユーザー「溜めモーションは4秒でいい」・雨摩座も「同じにする」）：構えはじめから吐くまで4秒＝構え3.5秒＋直前の0.5秒・「動きを見る」も同じ長さ', () => {
  for (const [key, big] of [['varuzenoku', 'doom'], ['amaza', 'deluge'], ['zerugiasu', 'ruin'], ['enma', 'hell']]) {
    const d = bossIllustOf(key).motions[big]
    const sk = DUNGEON_BOSSES[key].skills.find(s => s.name === d.label)
    assert.equal(sk.castSec * 1000, d.castSkipMs, `${key}：構えの長さ＝技の途中から流す時刻（つなぎ目が合う）`)
    assert.equal(d.hitMs, 4000, `${key}：吐くまで4秒`)
    assert.ok(d.hitMs - d.castSkipMs <= 500, `${key}：構えのあとすぐ`)
    assert.ok(d.big, `${key}：大技の帯`)
    assert.ok(DUNGEON_BOSSES[key].pattern.steps.find(s => s.at === 0.25 && s.skill === d.label).now, `${key}：25%を切ったらすぐ構える`)
  }
  // 構えの長さはエンジンでも3.5秒
  const st = newFight(16)
  st.b.buffSeen.push('黒鱗の鎧', '逆鱗')
  st.b.patFired.push(0.75, 0.5)
  st.b.hp = Math.floor(st.b.base.hp * 0.24)
  untilTrue(st, () => st.b.cast)
  assert.ok(Math.abs(st.b.cast.until - st.b.cast.start - 3.5) < 1e-9)
  const t0 = st.t
  untilTrue(st, () => !st.b.cast)
  assert.ok(Math.abs(st.t - t0 - 3.5) < 0.051, '3.5秒で撃つ')
  // 雨摩座も切ったらすぐ構える
  const am = createAtb(dummy(), dungeonFighter('amaza', 'normal'), { rng: rngOf(17), maxSec: 999 })
  am.b.buffSeen.push('霧雨の帳', '篠突く雨')
  am.b.patFired.push(0.75, 0.5)
  am.b.hp = Math.floor(am.b.base.hp * 0.24)
  runFor(am, 0.05)
  assert.equal(am.b.cast?.name, '水天葬')
  assert.ok(Math.abs(am.b.cast.until - am.b.cast.start - 3.5) < 1e-9)
  // ほかのボスの大技の構えは今までどおり（1ターンと同じ長さ）
  assert.equal(CAST_SEC, TURN_SEC)
})

test('【確定】2026-10-30 待つ長さは絵に合っている：どの技の動きも BUFF_WAIT_AFTER_ACT_SEC までに終わる・どのバフの見せ方も BUFF_SHOW_SEC までに終わる（動きを伸ばしたらここで止まる）', () => {
  for (const k of Object.keys(DUNGEON_BOSSES)) {
    const a = bossIllustOf(k)
    for (const m of Object.values(a.motions)) {
      assert.ok(m.totalMs - (m.castSkipMs || 0) <= BUFF_WAIT_AFTER_ACT_SEC * 1000, `${k} ${m.label}`)
      // 構えのない技の動きは、大技の節目の待ちより短い（構えのある技のあとに節目で構えることはない＝節目は1回だけ・撃ったあとは次の節目が無い）
      if (!m.castSkipMs && m !== Object.values(a.motions).at(-1)) assert.ok(m.totalMs <= NOW_WAIT_AFTER_ACT_SEC * 1000, `${k} ${m.label}`)
    }
    for (const [n, b] of Object.entries(a.buffs)) assert.ok(buffArtMsOf(b) <= BUFF_SHOW_SEC * 1000, `${k} ${n}`)
  }
})

test('【確定】2026-10-30 持ち越しで節目をもう切っているなら、はじめから付いている（記録にも出る・ゲージは貯めない）', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.5), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(st), ['黒鱗の鎧'], '始めた時点で')
  assert.equal(st.t, 0)
  const low = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 13000 * 0.1), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(low), ['黒鱗の鎧', '逆鱗'])
  const full = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(full), [])
})

test('【確定】2026-10-31 メニューは「挑戦」・中は「強敵」に黒龍と雨摩座（ユーザー「これは『挑戦』にして」「ここに『強敵』ってカテゴリを作って、ここにヴァルゼノクとあまざ入れて」）・八獄と天穹十二宮はまだ入れない・画面に「IDダンジョン」と出さない', () => {
  // 2026-11-01 グループの名前は「強敵」→「四凶」（ユーザー選択）
  assert.deepEqual(CHALLENGE_CATS.map(c => c.label), ['四凶'], '「八獄」「てんきゅう12宮」はまだ入れない')
  assert.deepEqual(CHALLENGE_CATS[0].bosses, ['varuzenoku', 'amaza', 'zerugiasu', 'enma'], '2026-11-01 ユーザー「進めて」でゼルギアス・「最後まで全部つくって」で閻魔も＝四凶の4体')
  for (const c of CHALLENGE_CATS) for (const k of c.bosses) {
    assert.ok(isSummonable(k), k)
    // 一覧の小さい絵（ボスの種類を足したら node tools/v2cap-boss-thumb.mjs）
    const src = bossThumbOf(k)
    assert.ok(src, `${k} の一覧の絵`)
    const file = new URL(`../../../public${src.split('?')[0]}`, import.meta.url)
    assert.ok(existsSync(file) && statSync(file).size < 60 * 1024, `${k} の絵は軽い`)
    assert.equal(src.split('?v=')[1], versionOf(fileURLToPath(file)), `${k} の印（node tools/v2cap-boss-thumb.mjs をやり直す）`)
  }
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const home = read('../pages/V2capHome.jsx')
  assert.match(home, /key:'dungeon', label:'挑戦', icon: <MenuIcon k="challenge" \/>/)
  assert.ok(home.includes('dungeon: <><MenuIcon k="challenge" size={18} /> 挑戦</>'), '画面の題も同じ絵のアイコン（2026-11-06 ユーザー「挑戦のアイコンも作りたい」）')
  // 画面に出る文字（コメントの外）に古い名前が残っていない
  for (const f of ['../pages/V2capHome.jsx', '../components/V2capDungeon.jsx', '../components/V2capBossPick.jsx', '../components/V2capAtb.jsx']) {
    for (const line of read(f).split(/\r?\n/)) assert.ok(/^\s*\/\//.test(line) || !line.includes('IDダンジョン'), `${f}: ${line.trim().slice(0, 60)}`)
  }
})

test('【確定】2026-10-31 入口のボスの行の言葉と「挑戦する」のボタンは同じ決まり（本番で、雨摩座を呼んでいるあいだ黒龍の行が「呼べます」のままボタンだけ暗かった）', () => {
  const at = (summoned, ownActive, reached = 15) => summonBlockOf('varuzenoku', { summoned, ownActive, reached })
  assert.equal(at(false, false), null, '挑戦できる')
  assert.equal(at(true, false), '挑戦済み', 'ユーザー「挑戦済み に変更して」')
  assert.equal(at(false, true), 'いま挑戦中のボスがいます')
  assert.equal(at(true, true), '挑戦済み', '挑戦中のボス自身の行')
  assert.equal(at(false, false, 1), 'エリア②に着くと挑戦できます', 'どの難易度もまだのエリア')
  assert.equal(at(false, false, 2), null, 'ノーマルだけでも挑戦できれば挑戦できる')
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.match(src, /block=\{state \? blockOf\(pick\.boss\) : '読み込み中\.\.\.'\}/, 'ボタンも同じ決まり')
  assert.match(src, /\{state && \(blockOf\(key\) \|\| '挑戦可能'\)\}/, '行の言葉も同じ決まり（読み込み中は出さない）・ユーザー「挑戦可能 に変更して」')
})

test('【確定】2026-11-06 入口は顔のアップの枠を2列・全部同じ高さ（ユーザー「一旦1列に戻して、ここの部分は顔付近だけ表示されるようにして※クラスの顔アイコンみたいな感じ」→「ここ同じ高さで2列にして」）', () => {
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  // 2列の格子・全部の行を同じ高さ（名前や言葉が折れて高くなる枠があっても、ほかの行の枠もそろう）
  assert.match(src, /\{CHALLENGE_CATS\.map\(cat => \([\s\S]*?<div style=\{\{ display:'grid', gridTemplateColumns:'repeat\(2, minmax\(0, 1fr\)\)', gridAutoRows:'1fr', gap:'6px' \}\}>\n\s*\{cat\.bosses\.map\(key => \{/, 'カテゴリの中は2列・同じ高さ')
  // 1つの枠は横並び（左に顔のアップ・名前と挑戦できるか）で、細い幅でもはみ出さない（minWidth:0）
  assert.match(src, /style=\{\{ display:'flex', alignItems:'center', gap:'6px', width:'100%', minWidth:0, boxSizing:'border-box', padding:'6px', \.\.\.bossCardBg\(bossTintOf\(key\)\)/)
  assert.match(src, /<BossFace bossKey=\{key\} \/>/, '枠の左に顔のアップ')
  // 名前を折るときは漢字からカタカナに変わる所でだけ（スマホの幅で「黒龍ヴァル｜ゼノク」「雷鋼機神ゼルギア｜ス」と折れた）。
  //   スマホの幅でも名前は1行に入る大きさにした（下のテスト）＝折れるのは約350px より細い画面だけ
  assert.ok(src.includes("<b style={{ color:'#ff8866', fontSize: NAME_SIZE, wordBreak:'keep-all', overflowWrap:'anywhere' }}>"))
  assert.ok(src.includes('{bossNamePartsOf(boss.name).map((p, i) => <span key={i}>{i > 0 && <wbr />}{p}</span>)}'))
  assert.deepEqual(bossNamePartsOf('黒龍ヴァルゼノク'), ['黒龍', 'ヴァルゼノク'])
  assert.deepEqual(bossNamePartsOf('雷鋼機神ゼルギアス'), ['雷鋼機神', 'ゼルギアス'])
  assert.deepEqual(bossNamePartsOf('雨摩座'), ['雨摩座'])
  assert.deepEqual(bossNamePartsOf('閻魔'), ['閻魔'])
  // 1列のときの右の › は外した（2列では名前の幅が足りない）
  const list = src.slice(src.indexOf('{CHALLENGE_CATS.map(cat => ('), src.indexOf('{/* 救援の一覧 */}'))
  assert.ok(list.length > 0 && !list.includes('>›<'), '2列の枠に › を出さない')
  // 顔のアップは神殿のクラスの顔アイコンと同じ形（60pxの正方形・顔を全面に）。スマホの幅では名前と同じ割合で小さく（下のテスト）
  assert.ok(src.includes('const FACE_SIZE = bossCardCss(CARD_FIT.face)'))
  assert.ok(src.includes("<div style={{ width: FACE_SIZE, height: FACE_SIZE, flexShrink:0, overflow:'hidden', background: tint ? `${tint}30` : '#0b1a2e', border:'1px solid #002244'"))
  assert.ok(src.includes("objectFit: face ? 'cover' : 'contain'"))
  // 挑戦のカテゴリの全部のボスに顔のアップがある（ボスを足すときは BOSS_FACE_BOX にも足して node tools/v2cap-boss-thumb.mjs）
  for (const cat of CHALLENGE_CATS) for (const k of cat.bosses) {
    assert.ok(BOSS_FACE_BOX[k], `${k} の顔の切り取り`)
    const url = bossFaceOf(k)
    assert.ok(url, `${k} の顔のアップ`)
    const file = new URL(`../../../public${url.split('?')[0]}`, import.meta.url)
    assert.ok(existsSync(file) && statSync(file).size < 40 * 1024, `${k} の顔のアップは軽い`)
    assert.equal(url.split('?v=')[1], versionOf(fileURLToPath(file)), `${k} の印（node tools/v2cap-boss-thumb.mjs をやり直す）`)
  }
})

test('【確定】2026-11-06 スマホの幅では名前が1行に入るまで、名前の文字・顔・下の言葉を同じ割合で小さくする（ユーザー「スマホ版でボスの名前1行に収まるぐらいの文字の大きさに調整して、イラストもそれに合わせて小さくして」）', () => {
  const { namePx, facePx, notePx, nameMinPx, noteMinPx, outsidePx, insidePx } = BOSS_CARD
  // いちばん長い名前は挑戦のカテゴリの全部のボスから数える（いまは雷鋼機神ゼルギアスの9文字）
  const longest = Math.max(...CHALLENGE_CATS.flatMap(c => c.bosses.map(k => [...DUNGEON_BOSSES[k].name].length)))
  const fit = bossCardFitOf(longest)
  // よくあるスマホの幅（351px〜）：いちばん長い名前が1行に入る。枠の幅＝(画面の幅 − 54) ÷ 2・名前の欄＝枠 − 22 − 顔（本番で 320〜478px を測った）
  //   ★名前の長いボスを足してここが落ちたら、本番のスマホの幅で見直す（9px より小さくはしない）
  for (const vw of [351, 360, 375, 390, 393, 412, 414, 428, 430, 440, 459]) {
    const card = (vw - outsidePx) / 2, name = bossCardPxAt(fit.name, vw), face = bossCardPxAt(fit.face, vw)
    assert.ok(longest * name <= card - insidePx - face, `${vw}px で名前が1行に入る`)
    assert.ok(Math.abs(face / name - facePx / namePx) < 1e-9, `${vw}px で顔は名前と同じ割合`)
    assert.ok(name >= nameMinPx && bossCardPxAt(fit.note, vw) >= noteMinPx, `${vw}px でも文字は 9px より小さくしない`)
  }
  // 460px より広い画面と PC は前のまま（名前 13px・顔 60px・下の言葉 10px）
  for (const vw of [460, 478, 768, 1024, 1920]) {
    assert.deepEqual([fit.name, fit.face, fit.note].map(f => bossCardPxAt(f, vw)), [namePx, facePx, notePx], `${vw}px`)
  }
  // とても細い画面（320px）は 9px と 41.5px で止め、名前は言葉の切れ目で2行（上のテスト）
  assert.equal(bossCardPxAt(fit.name, 320), nameMinPx)
  assert.ok(Math.abs(bossCardPxAt(fit.face, 320) - facePx * nameMinPx / namePx) < 1e-9)
  // 9文字のときの画面の式（本番で 351〜460px を測った値）
  const nine = bossCardFitOf(9)
  assert.equal(bossCardCss(nine.name), 'clamp(9px, calc(3.6723vw - 3.893px), 13px)')
  assert.equal(bossCardCss(nine.face), 'clamp(41.54px, calc(16.9492vw - 17.966px), 60px)')
  assert.equal(bossCardCss(nine.note), 'clamp(9px, calc(2.8249vw - 2.994px), 10px)')
  // 画面はこの大きさを使う
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('const CARD_FIT = bossCardFitOf(Math.max(...CHALLENGE_CATS.flatMap(c => c.bosses.map(k => [...DUNGEON_BOSSES[k].name].length))))'))
  for (const s of ['const NAME_SIZE = bossCardCss(CARD_FIT.name)', 'const NOTE_SIZE = bossCardCss(CARD_FIT.note)', "fontSize: NAME_SIZE, wordBreak:'keep-all'", "<span style={{ color: TEXT.label, fontSize: NOTE_SIZE }}>{state && (blockOf(key) || '挑戦可能')}</span>"]) {
    assert.ok(src.includes(s), s)
  }
})

test('【確定】2026-11-05 ボスのHPは数字も割合も出さない＝バーだけ（ユーザー「あと敵のHPの数値は見れないようにして」）', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  // 戦闘の舞台：相手（右）は「HP」の文字とバーだけ・自分の HP と MP は数字のまま
  assert.ok(read('../components/V2capAtbStage.jsx').includes("<span>{right ? 'HP' : `HP ${Math.max(0, me.hp).toLocaleString()} / ${me.base.hp.toLocaleString()}`}</span>"))
  // 削った割合も出さない（相手のHPが分かる）。ダメージ/秒は自分の数字なので出す
  const fight = read('../components/V2capAtbFight.jsx')
  assert.doesNotMatch(fight, /dealtPct|削り \{|%削った/)
  assert.match(fight, /\{Math\.round\(dps\)\.toLocaleString\(\)\}ダメージ\/秒/)
  // 挑戦の画面（戦闘の見出し・入っているボスの行・救援の一覧・ポップアップ・結果の画面）にHPの数字と割合を出さない
  const leak = /\.hp\)?\.toLocaleString\(\)|hp_max\.toLocaleString|hpMax\.toLocaleString|\.hp \/ (run\.hp_max|hpMax)\) \* 100\)\.toFixed/
  for (const f of ['../components/V2capDungeon.jsx', '../components/V2capBossPick.jsx', '../components/V2capBossReward.jsx']) assert.doesNotMatch(read(f), leak, f)
  // 救援の一覧は文の中の小さいバー。「HP」の文字と別の行に分かれない（本番のスマホの幅で分かれた）
  assert.ok(read('../components/V2capDungeon.jsx').includes("<span style={{ whiteSpace:'nowrap' }}>HP <MiniBar pct={(run.hp / run.hp_max) * 100} /></span>"))
  // 貢献度（与えたダメージの割合）は残す（2026-11-01 ユーザー「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」）
  assert.match(read('../components/V2capBossReward.jsx'), /contributionPctOf\(m\?\.damage \|\| 0, hpMax\)\.toFixed\(1\)/)
  assert.match(read('../components/V2capDungeon.jsx'), /貢献度\{contributionPctOf\(m\.damage, run\.hp_max\)\.toFixed\(1\)\}%/)
})

test('【確定】2026-11-06 入口のボスの枠にボスの色を薄く敷く（ユーザー「黒龍 あか・あまざ あお・ゼルギアス 黄色・閻魔 紫 の薄い背景にしてほしい」）', () => {
  // 色の向き（色相・度）で見る
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return (h * 60 + 360) % 360
  }
  const hue = (key) => hueOf(bossTintOf(key))
  assert.ok(hue('varuzenoku') < 15 || hue('varuzenoku') > 345, '黒龍は赤')
  assert.ok(hue('amaza') >= 200 && hue('amaza') <= 240, '雨摩座は青')
  assert.ok(hue('zerugiasu') >= 40 && hue('zerugiasu') <= 60, 'ゼルギアスは黄色')
  assert.ok(hue('enma') >= 255 && hue('enma') <= 290, '閻魔は紫')
  // 挑戦のカテゴリの全部のボスに色がある（ユーザー「今後4強以外にもいろいろ出す予定」＝ボスを足すときは色も決める）
  for (const cat of CHALLENGE_CATS) for (const key of cat.bosses) {
    assert.match(bossTintOf(key) || '', /^#[0-9a-f]{6}$/, `${key} の色が無い（ユーザーに聞いて lib/bossArt.js の BOSS_TINT に足す）`)
  }
  // 入口の枠はこの色を薄く敷く（文字と絵が見づらくならない濃さ＝本番で見比べた値）
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.match(src, /\.\.\.bossCardBg\(bossTintOf\(key\)\)/)
  assert.ok(src.includes('radial-gradient(ellipse 45% 120% at 10% 50%, ${tint}47, transparent 75%), linear-gradient(${tint}1a, ${tint}1a), #0b0c14'))
})

test('【確定】2026-11-06 四凶は時間で強くなる：30秒ごとに与えるダメージ+5%（足し算）・3分から命中率+10%・挑戦ごとの戦闘の時間で決める（ユーザー「四強のやつらは30秒ごとに与えるダメージ＋5％、3分以上ならさらに命中率＋１０％」）', () => {
  const enrage = { everySec: 30, dealPct: 5, hitAtSec: 180, hitPct: 10 }
  for (const key of CHALLENGE_CATS.find(c => c.key === 'rival').bosses) {
    assert.deepEqual(bossEnrageOf(key), enrage, key)
    assert.deepEqual(dungeonFighter(key, 'normal').enrage, enrage, `${key} の戦闘に乗る`)
  }
  const at = (t) => enrageOf(enrage, t)
  assert.deepEqual(at(0), { deal: 0, hit: 0 })
  assert.deepEqual(at(29.9), { deal: 0, hit: 0 })
  assert.deepEqual(at(30), { deal: 5, hit: 0 })
  assert.deepEqual(at(60), { deal: 10, hit: 0 })
  assert.deepEqual(at(179.9), { deal: 25, hit: 0 })
  assert.deepEqual(at(180), { deal: 30, hit: 10 })
  assert.deepEqual(at(600), { deal: 100, hit: 10 }, '上限なし')
  assert.deepEqual(enrageOf(null, 600), { deal: 0, hit: 0 }, '四凶でない敵は強くならない')

  // 戦闘の中：刻みごとに入れ直す・命中はもとの命中補正に足す・札に出す・自分は強くならない
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(7), maxSec: 9999 })
  const base = st.b.pa.hitBonus
  runFor(st, 29.8)
  assert.equal(st.b.enrageDeal, 0)
  runFor(st, 0.4)
  assert.equal(st.b.enrageDeal, 5)
  assert.ok(stateChips(st.b).some(c => c.label === '🔥 与ダメ+5%'))
  runFor(st, 150)
  assert.equal(st.b.enrageDeal, 30)
  assert.equal(st.b.enrageHit, 10)
  assert.equal(st.b.pa.hitBonus, base + 10, '命中率+10')
  assert.ok(stateChips(st.b).some(c => c.label === '🎯 命中+10%'))
  assert.equal(st.a.enrageDeal, 0, '自分は強くならない')
  // ⚠ side.rage はバーサク・執行本能の高ぶりの数（battle.js が通常攻撃で0に戻す）＝同じ名前にすると効かない（はじめはそうなっていた）
  assert.equal(typeof st.b.rage, 'number')

  // 与えるダメージ：同じ乱数で強くならない戦闘と並べる（自分は倒れない・削らない＝ボスの行動の順は同じ）。30〜60秒の1発は1.05倍・30秒までは同じ
  const soft = () => ({ ...dummy(), stats: { ...dummy().stats, vit: 1 } })   // 1発が大きいほうが切り捨てで割合が消えない
  const pair = () => [enrage, null].map(r => createAtb(soft(), { ...dungeonFighter('varuzenoku', 'normal'), enrage: r }, { rng: rngOf(9), maxSec: 9999 }))
  const [up, flat] = pair()
  const hitsOf = (s) => s.log.filter(l => l.side === BOSS && (l.type === 'skill' || l.type === 'normal') && l.damage > 0)
  for (const s of [up, flat]) runFor(s, 29.9)
  const n30 = hitsOf(flat).length
  assert.deepEqual(hitsOf(up).map(l => l.damage), hitsOf(flat).map(l => l.damage), '30秒までは同じ')
  for (const s of [up, flat]) runFor(s, 30)
  const u = hitsOf(up), f = hitsOf(flat)
  assert.equal(u.length, f.length)
  assert.ok(f.length - n30 >= 3, '30〜60秒にボスの攻撃が当たっている')
  for (let i = n30; i < f.length; i++) {
    const ratio = u[i].damage / f[i].damage
    assert.ok(ratio > 1.03 && ratio < 1.07, `${i}発目 ${u[i].damage}÷${f[i].damage}`)
  }

  // 挑戦ごとに0から：ボスを呼んでからの時間・救援に入った時間は使わない（ユーザー「発行から20分たって救援参加したら与ダメとか増えてるとかにはならない」）
  const fresh = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 100), { rng: rngOf(7), maxSec: 9999 })
  assert.equal(fresh.t, 0)
  assert.equal(fresh.b.enrageDeal, 0)
  runFor(fresh, 10)
  assert.equal(fresh.b.enrageDeal, 0)
})

test('【確定】2026-11-06 挑戦1回の時間制限は無し（ユーザー「1回ずつの時間制限なくす」）：念のための上限10分は画面に出さない・サーバーの受付もそれに合わせる', () => {
  assert.equal(DUNGEON_TRY_SEC, 600, '念のための上限＝10分（測って、いちばん長い戦闘は約6分）')
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  // 戦闘の時計は「/ ◯秒」を出さない（時間制限のある試し撃ちの敵だけ出す）
  assert.ok(read('../components/V2capAtbFight.jsx').includes('<span>{now.toFixed(1)}秒{s.maxSec < DUNGEON_TRY_SEC ? ` / ${s.maxSec}秒` : \'\'}</span>'))
  // 試し撃ちの挑戦のボスも同じ（ほかの敵は MAX_SEC のまま）
  assert.match(read('../components/V2capAtb.jsx'), /maxSec: dun \? DUNGEON_TRY_SEC : MAX_SEC/)
  // サーバー：挑戦中とみなす長さ（c_try_sec）は上限と同じ・終わりを受け付ける長さ（c_late_min）は4つの関数で同じ25分
  const sql = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  for (const fn of ['v2cap_dungeon_state', 'v2cap_dungeon_try_start', 'v2cap_dungeon_try_end', 'v2cap_dungeon_claim']) {
    const body = new RegExp(`function public\\.${fn}\\([\\s\\S]*?\\$\\$;`).exec(sql)[0]
    assert.equal(Number(/c_late_min\s+constant int := (\d+);/.exec(body)[1]), 25, `${fn} の c_late_min`)
    const trySec = /c_try_sec\s+constant int := (\d+);/.exec(body)
    if (trySec) assert.equal(Number(trySec[1]), DUNGEON_TRY_SEC, `${fn} の c_try_sec`)
  }
})

test('【確定】2026-11-06 結果の画面の見出しは「討伐時間」「与えたダメージ」「貢献度」（ユーザー「討伐時間 与えたダメージ 貢献度 にして」）', () => {
  const src = readFileSync(new URL('../components/V2capBossReward.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\{\/\*)/.test(l)).join('\n')   // コメントの外
  // 倒せなかったとき（敗北・時間切れ）は「討伐」と言えないので「戦闘時間」
  assert.ok(code.includes("<Row label={cleared ? '討伐時間' : '戦闘時間'} value={`${st.t.toFixed(1)}秒`} />"))
  assert.ok(code.includes('<Row label="与えたダメージ" value={r.damage.toLocaleString()} />'))
  assert.doesNotMatch(code, /この挑戦の時間|この挑戦のダメージ|与えたダメージの割合/)
  // 【確定】同じ日 ユーザー「無駄改行入れないで」：見出しだけの行を作らない。貢献度（自分の分）・ボスの残りHP・討伐の残り時間もほかの行と同じ1行
  assert.ok(code.includes('<Row label="貢献度" value={`${pctOf(mine)}%`} />'))
  assert.match(code, /\{others\.map\(m => \(\n\s*<div key=\{m\.name\}[^\n]*>\n\s*<span style=\{\{ width: LABEL_W,[^\n]*>\{m\.owner \? '👑' : '🤝'\}\{m\.name\}<\/span>\n\s*<b style=\{\{ width: VALUE_W, flexShrink: 0, textAlign:'right' \}\}>\{pctOf\(m\)\}%<\/b>\n\s*<\/div>/, '救援の人は1人1行')
  assert.ok(code.includes("<span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>ボスの残りHP</span>"), '残りHPは見出しの横にバー')
  assert.ok(code.includes('{leftText && <Row label="討伐の残り時間" value={leftText} />}'))
  assert.doesNotMatch(code, />(貢献度|ボスの残りHP)<\/div>/, '見出しだけの行')
  // 【確定】同じ日 ユーザー「討伐時間 ○○秒みたいに右揃えにして」「今の感じで先頭のスタートは同じ所で」：
  //   見出しは左から（書き出しをそろえる）・値は見出しのすぐ右の決まった幅の欄で右揃え（枠の右はしへ離さない）。残りHPのバーと救援の人の%も同じ欄
  const row = code.slice(code.indexOf('const Row = '), code.indexOf('export default function'))
  assert.ok(row.includes('<span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>{label}</span>'))
  assert.match(row, /<span style=\{\{ color: TEXT\.bright, fontWeight:'bold', width: VALUE_W, flexShrink: 0, textAlign:'right'[^\n]*>\{value\}<\/span>/)
  assert.doesNotMatch(code, /space-between/, '値を枠の右はしへ離さない')
  assert.match(code, /<div style=\{\{ width: VALUE_W, flexShrink: 0, boxSizing:'border-box', height:'8px'/, '残りHPのバーも値の欄')
})

test('【確定】2026-10-31 入口：履歴と説明を出さない・「挑戦する」でそのまま戦闘へ（ユーザー「この履歴いらない」「ここら辺の説明いらない」「呼ぶじゃなくて挑戦する にして」）', () => {
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\{\/\*)/.test(l)).join('\n')   // コメントの外
  // 倒した・時間切れのボスは出さない（サーバーも返さない）
  assert.match(src, /\{active\.map\(run => \{/)
  assert.doesNotMatch(src, /\{runs\.map\(/)
  assert.doesNotMatch(code, /討伐済み|時間切れ/)
  assert.match(fnBody('v2cap_dungeon_state'), /'runs',[\s\S]*?where r\.cleared_at is null and r\.ends_at > now\(\)\), '\[\]'::jsonb\),\n\s*-- 受け取っていない報酬/)
  // 説明を出さない
  assert.doesNotMatch(code, /残ったHPから|あなたの戦闘力|staminaMaxOfProfile/)
  // 押したらボスを出して、そのまま挑戦を始める
  const pick = readFileSync(new URL('../components/V2capBossPick.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(pick, /⚔ 挑戦する\{cost > 0 \? `（スタミナ\$\{cost\}）` : ''\}<\/button>/)
  assert.match(src, /const challenge = async \(bossKey, diff\) => \{\n\s*enc\.begin\(bossKey, diff\)\n\s*const data = await call\('v2cap_dungeon_summon', \{ p_boss: bossKey, p_diff: diff \}\)\n\s*if \(!data\) \{ enc\.cancel\(\); return \}\n\s*if \(await start\(data\.run\)\) enc\.finish\(\)/)
  // 画面に出す文字とサーバーの返事に「呼ぶ」を残さない（コメントの外）
  const noCall = (name, text) => {
    for (const line of text.split(/\r?\n/)) assert.ok(/^\s*(\/\/|--|\{\/\*)/.test(line) || !line.includes('呼'), `${name}: ${line.trim().slice(0, 60)}`)
  }
  noCall('V2capDungeon.jsx', src)
  noCall('V2capBossPick.jsx', pick)
  for (const fn of ['v2cap_dungeon_summon', 'v2cap_dungeon_try_start', 'v2cap_dungeon_try_end', 'v2cap_dungeon_rescue', 'v2cap_dungeon_join']) noCall(fn, fnBody(fn))
})

test('【確定】2026-11-01 報酬（ユーザー選択「EXPとGoldを渡す」→「今の報酬が少し大きすぎるから半分にして」）：数字はサーバーと同じ・EXP＝推奨の場所のボス5体ぶん・Gold＝推奨LV×50', () => {
  const conf = fnBody('v2cap_dungeon_reward_conf')
  const rows = [...conf.matchAll(/\('(\w+)', '(\w+)', (\d+), (\d+)\)/g)].map(m => ({ boss: m[1], diff: m[2], exp: +m[3], gold: +m[4] }))
  const ready = Object.keys(DUNGEON_BOSSES).filter(isSummonable).flatMap(boss => DIFF_KEYS.filter(k => isDiffReady(boss, k)).map(diff => ({ boss, diff, ...diffOf(boss, diff).reward })))
  assert.deepEqual(rows, ready, 'サーバーの報酬の表＝呼べる難易度の reward')
  for (const { boss, diff, exp, gold } of ready) {
    const { recLv } = diffOf(boss, diff)
    assert.equal(exp, tenSortieExpOf(recLv) * 5 / 2, `${boss} ${diff} EXP＝ふつうの敵5回ぶん×ボスの5倍`)
    assert.equal(gold, recLv * DAILY_GOLD_PER_LV / 2, `${boss} ${diff} Gold＝デイリー半分`)
  }
  assert.deepEqual([diffOf('varuzenoku', 'normal').reward, diffOf('varuzenoku', 'hard').reward], [{ exp: 175, gold: 1250 }, { exp: 350, gold: 2250 }], 'ユーザーが選んだ数字')
})

test('【確定】2026-11-01 ひとりで倒されずに倒したら報酬3倍（ユーザー「1人で倒されずにソロ攻略したら報酬豪華に」→選択「3倍」）・救援信号は1回挑戦してから（選択「信号を出す人の条件」）', () => {
  assert.equal(SOLO_REWARD_MULT, 3)
  const pay = fnBody('v2cap_dungeon_pay_reward')
  assert.match(pay, new RegExp(`c_solo_mult  constant int := ${SOLO_REWARD_MULT};`))
  assert.match(pay, /v_solo := v_mem\.is_owner and not v_mem\.flawed\s+and not exists \(select 1 from public\.v2cap_dungeon_members m where m\.run_id = p_run and m\.player_id <> p_player and m\.tries > 0\);/)
  assert.match(pay, /'solo', v_solo/)
  // 負け・途中でやめた・戻らなかった挑戦を覚える
  assert.match(fnBody('v2cap_dungeon_verify_settle'), /flawed = flawed or coalesce\(not p_clean, false\)/)
  assert.match(fnBody('v2cap_dungeon_try_start'), /flawed = flawed or v_mem\.try_open_at is not null/)
  assert.match(fnBody('v2cap_dungeon_try_end'), /set try_open_at = null, flawed = true/)
  // 救援信号
  assert.match(fnBody('v2cap_dungeon_rescue'), /m\.tries > 0\) then\s+return jsonb_build_object\('ok', false, 'error', '1回挑戦すると救援信号を出せます'\)/)
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.match(src, /run\.mine && !run\.rescue_open && \(run\.my_tries > 0/)
  assert.match(readFileSync(new URL('../components/V2capBossReward.jsx', import.meta.url), 'utf8'), /reward\.solo && /)
})

test('【確定】2026-10-31 報酬の渡し方：呼んだ人は全部・救援の人は削った割合（最低3割）・ダメージ0は無し・1回だけ・直接は呼べない', () => {
  const pay = fnBody('v2cap_dungeon_pay_reward')
  assert.match(pay, new RegExp(`c_helper_min constant int := ${HELPER_REWARD_MIN_PCT};`))
  assert.match(pay, /v_pct := case when v_mem\.is_owner then 100\s+else greatest\(c_helper_min, least\(100, \(v_mem\.damage \* 100 \/ greatest\(1, v_run\.hp_max\)\)::int\)\) end;/)
  assert.match(pay, /if not found or v_run\.cleared_at is null then return null; end if;/, '倒れていなければ渡さない')
  assert.match(pay, /where run_id = p_run and player_id = p_player for update;\s+if not found or v_mem\.reward_at is not null or v_mem\.damage <= 0 then return null; end if;/, '行をつかんでから1回だけ・ダメージ0は無し')
  assert.match(pay, /public\.v2cap_apply_exp\(p_player, v_exp\)/, 'EXP はいつもの入口を通す（V1からの引き継ぎの倍率も）')
  assert.match(SQL, /revoke all on function public\.v2cap_dungeon_pay_reward\(bigint, uuid\) from public, anon, authenticated;/, '渡す関数は直接呼べない')
  assert.match(SQL, /revoke all on function public\.v2cap_dungeon_reward_conf\(text, text\) from public, anon, authenticated;/)
  // 列を足すときに、これまでに倒したボスの分は渡したことにする（さかのぼって配らない）・列があれば何もしない（2回流しても消さない）
  assert.match(SQL, /column_name = 'reward_at'\) then\s+alter table public\.v2cap_dungeon_members add column reward_at timestamptz;\s+update public\.v2cap_dungeon_members m set reward_at = now\(\) from public\.v2cap_dungeon_runs r where r\.id = m\.run_id and r\.cleared_at is not null;/)
  // 結果を入れるとき：ボスのHPが減るのは残りまで・自分の量は先に倒されていても数える・倒れていたらその場で渡す
  const end = fnBody('v2cap_dungeon_verify_settle')
  assert.match(end, /v_d := greatest\(0, least\(coalesce\(p_damage, 0\), coalesce\(v_mem\.try_hp, 0\), v_run\.hp\)\);/)
  assert.match(end, /v_mine := greatest\(0, least\(coalesce\(p_damage, 0\), coalesce\(v_mem\.try_hp, 0\)\)\);/)
  assert.match(end, /set hp = hp - v_d,/)
  assert.match(end, /set damage = damage \+ v_mine,/)
  assert.match(end, /v_reward := public\.v2cap_dungeon_pay_reward\(p_run, p_player\);/)
  // その場にいなかった人：入口に出す・挑戦の途中は待つ（捨てられた挑戦は別）
  const claim = fnBody('v2cap_dungeon_claim')
  assert.match(claim, /if not public\.v2cap_is_dev\(\) then return jsonb_build_object\('ok', false, 'error', '開発限定です'\)/, 'サーバーも開発者だけ')
  assert.match(claim, new RegExp(`c_try_sec constant int := ${DUNGEON_TRY_SEC};`))
  assert.match(claim, /v_mem\.try_open_at > now\(\) - make_interval\(secs => c_try_sec \+ 60\)/)
  const state = fnBody('v2cap_dungeon_state')
  assert.match(state, new RegExp(`c_try_sec\\s+constant int := ${DUNGEON_TRY_SEC};`))
  assert.match(state, /'rewards', coalesce\(.*\n.*\n.*\n\s+where r\.cleared_at is not null and m\.reward_at is null and m\.damage > 0\n\s+and \(m\.try_open_at is null or m\.try_open_at <= now\(\) - make_interval\(secs => c_try_sec \+ 60\)\)/)
})

test('【確定】2026-10-31 結果はサーバーが決める（ユーザー選択「サーバーの計算で入れる」）：画面からは削った量を受け取らない・入れるのは合い言葉のある関数だけ', () => {
  // 前の形（画面が削った量を送る）は消す
  assert.match(SQL, /drop function if exists public\.v2cap_dungeon_try_end\(bigint, int\);/)
  assert.doesNotMatch(SQL, /grant execute on function public\.v2cap_dungeon_try_end\(bigint, int\)/)
  const end = fnBody('v2cap_dungeon_try_end')
  assert.match(end, /^create or replace function public\.v2cap_dungeon_try_end\(p_run bigint, p_inputs jsonb, p_end_step int, p_claim int default null\)/)
  assert.doesNotMatch(end, /update public\.v2cap_dungeon_runs|pay_reward|damage = /, '預けるだけ：ボスのHPもダメージも報酬も、ここでは動かさない')
  assert.match(end, new RegExp(`c_inputs_max\\s+constant int := ${INPUTS_MAX};`), '記録の数の上限は dungeonVerify.js と同じ')
  for (const fn of ['v2cap_dungeon_try_start', 'v2cap_dungeon_try_end']) {
    assert.match(fnBody(fn), /if not public\.v2cap_is_dev\(\) then return jsonb_build_object\('ok', false, 'error', '開発限定です'\)/, `${fn} はサーバーも開発者だけ`)
  }
  // 種と写しはサーバーが決める
  const start = fnBody('v2cap_dungeon_try_start')
  assert.match(start, /v_seed := floor\(random\(\) \* 4294967296\)::bigint;/)
  assert.match(start, /try_seed = v_seed, try_snap = v_snap/)
  assert.match(start, /'seed', v_seed, 'snap', v_snap/)
  // 入れる関数：合い言葉がないと通らない・ログインした人には開けない
  assert.match(fnBody('v2cap_dungeon_verify_ok'), /encode\(sha256\(convert_to\(coalesce\(p_secret, ''\), 'UTF8'\)\), 'hex'\) = '[0-9a-f]{64}'/, 'SQL には SHA-256 だけ')
  for (const [fn, args] of [['v2cap_dungeon_verify_load', 'text, bigint, uuid'], ['v2cap_dungeon_verify_settle', 'text, bigint, uuid, int, int, text, boolean, jsonb']]) {
    assert.match(fnBody(fn), /if not public\.v2cap_dungeon_verify_ok\(p_secret\) then return jsonb_build_object\('ok', false, 'error', '合い言葉が違います'\); end if;/, fn)
    assert.ok(SQL.includes(`revoke all on function public.${fn}(${args}) from public, authenticated;`), `${fn} はログインした人の権限では呼べない`)
    assert.ok(SQL.includes(`grant execute on function public.${fn}(${args}) to anon;`), `${fn} は公開の鍵と合い言葉で呼ぶ`)
  }
  assert.match(SQL, /revoke all on function public\.v2cap_dungeon_verify_ok\(text\) from public, anon, authenticated;/)
  // 同時に2回確かめても入るのは1回・あとの挑戦の記録に入れない
  assert.match(fnBody('v2cap_dungeon_verify_settle'), /if v_mem\.try_sub is null or v_mem\.tries <> p_try then/)
  // 飲んだ薬を引く（2026-11-01）：回し直しの結果だけ・2回は引かない（try_sub を消したあと）・0より下にしない
  const settle = fnBody('v2cap_dungeon_verify_settle')
  assert.match(settle, /p_items jsonb default null\)/)
  assert.match(settle, /greatest\(0, coalesce\(\(p\.items->>e\.key\)::int, 0\) - e\.value::int\)/)
  assert.ok(settle.indexOf('if v_mem.try_sub is null or v_mem.tries <> p_try then') < settle.indexOf('if p_items is not null then'), '入れた挑戦の聞き直しでは引かない')
  assert.match(SQL, /drop function if exists public\.v2cap_dungeon_verify_settle\(text, bigint, uuid, int, int, text, boolean\);/, '前の形を残すと呼び分けられない')
  // ずれた挑戦を残す
  assert.match(fnBody('v2cap_dungeon_verify_settle'), /insert into public\.v2cap_dungeon_mismatch/)
  assert.match(SQL, /alter table public\.v2cap_dungeon_mismatch enable row level security;/)
  // 記録を預けたまま確かめていないあいだは、受け取りと次の挑戦を待たせる
  assert.match(fnBody('v2cap_dungeon_state'), /'pending', coalesce\(/)
  assert.match(fnBody('v2cap_dungeon_state'), /and \(m\.try_sub is null or m\.try_sub_at <= now\(\) - make_interval\(mins => c_late_min\)\)\), '\[\]'::jsonb\),/)
  assert.match(fnBody('v2cap_dungeon_claim'), /v_mem\.try_sub is not null and v_mem\.try_sub_at > now\(\) - make_interval\(mins => c_late_min\)/)
  assert.match(fnBody('v2cap_dungeon_try_start'), /v_mem\.try_sub is not null and v_mem\.try_sub_at > now\(\) - make_interval\(mins => c_late_min\)/)
  // 画面：サーバーの種と写しで戦い、押した記録を送る。削った量を自分で決めて送らない
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.match(src, /const st = startTryAtb\(data\)/)
  assert.match(src, /p_inputs: p\.st\.inputs, p_end_step: p\.st\.steps, p_claim: damageOf\(p\.st\)/)
  assert.doesNotMatch(src, /p_damage|atbPlayerOf|createAtb/, '画面の持っている値では戦わない')
})

test('【確定】2026-10-31 開発用の挑戦回数リセット（ユーザー「開発用に挑戦回数resetできるように」）：開発者だけ・行は消さない', () => {
  const fn = fnBody('v2cap_dev_dungeon_reset')
  assert.match(fn, /if not public\.v2cap_is_dev\(\) then return jsonb_build_object\('ok', false, 'error', '開発限定です'\)/, 'サーバーも開発者だけ')
  assert.match(fn, /where owner_id = v_uid and \(day = public\.v2cap_dungeon_today\(\) or \(cleared_at is null and ends_at > now\(\)\)\)/, '自分のきょうのボスと、終わっていないボス')
  assert.doesNotMatch(fn, /delete from/, '行は消さない')
  assert.match(SQL, /revoke all on function public\.v2cap_dev_dungeon_reset\(\) from public, anon;\ngrant execute on function public\.v2cap_dev_dungeon_reset\(\) to authenticated;/)
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  assert.match(src, /\{dev && \(\s*<button onClick=\{resetTries\}/, '画面も開発者だけ')
  const home = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8')
  assert.match(home, /<V2capDungeon [^>]*dev=\{isAdmin\}/)
})

test('【確定】2026-10-31 戦いが終わったら構えも終わる（本番で、構えのあいだに雨摩座を倒すと「水天葬」の札と渦と赤いゲージが出たまま止まっていた）', () => {
  const casting = (key, buffs, seed) => {
    const st = createAtb(dummy(), dungeonFighter(key, 'normal'), { rng: rngOf(seed), maxSec: 999 })
    st.b.buffSeen.push(...buffs)
    st.b.patFired.push(0.75, 0.5)
    st.b.hp = Math.floor(st.b.base.hp * 0.24)
    untilTrue(st, () => st.b.cast)
    return st
  }
  for (const [key, buffs] of [['varuzenoku', ['黒鱗の鎧', '逆鱗']], ['amaza', ['霧雨の帳', '篠突く雨']], ['zerugiasu', ['雷鋼装甲', '炉心臨界']], ['enma', ['六道輪廻の理', '忿怒相']]]) {
    const win = casting(key, buffs, 31)
    win.b.hp = 0
    win.a.gauge = GAUGE_FULL
    runFor(win, 0.05)
    assert.equal(win.winner, 'a', key)
    assert.equal(win.b.cast, null, `${key}：倒したら構えも終わる`)
    const lose = casting(key, buffs, 32)
    lose.a.hp = 0
    lose.a.gauge = GAUGE_FULL
    runFor(lose, 0.05)
    assert.equal(lose.winner, 'b', key)
    assert.equal(lose.b.cast, null, `${key}：負けても構えは終わる`)
    const draw = casting(key, buffs, 33)
    draw.maxSec = draw.t
    runFor(draw, 0.05)
    assert.equal(draw.winner, 'draw', key)
    assert.equal(draw.b.cast, null, `${key}：時間切れでも構えは終わる`)
  }
})

test('【確定】2026-10-30 雨摩座：黒龍の裏返し（魔法が主）・節目と割合と強さは黒龍と同じ・2026-10-31 強敵として呼べる', () => {
  const A = DUNGEON_BOSSES.amaza, V = DUNGEON_BOSSES.varuzenoku
  assert.equal(isSummonable('amaza'), true)
  assert.equal(isSummonable('varuzenoku'), true)
  assert.equal(isDiffUnlocked('amaza', 'normal', 2), true)
  assert.equal(isDiffUnlocked('amaza', 'hard', 4), false, 'エリア⑤に着くまで呼べない')
  assert.equal(isDiffUnlocked('amaza', 'expert', 15), false, 'まだ数字が無い')
  assert.deepEqual(A.diffs, V.diffs, '強さは黒龍と同じ')
  assert.equal(A.kind, 'mag')
  assert.deepEqual(A.skills.map(s => [s.name, s.kind, s.mult, s.ail?.key ?? null, s.ail?.chance ?? null]), [
    ['氷雨', 'mag', 1.6, 'slow', 70], ['水縛の帯', 'mag', 1.8, 'paralyze', 30], ['水天葬', 'mag', 4.0, null, null],
  ])
  assert.deepEqual(A.pattern.steps.map(s => s.at), V.pattern.steps.map(s => s.at))
  const rename = { '焦熱の吐息': '氷雨', '黒翼烈風': '水縛の帯', '終焉の黒焔': '水天葬' }
  assert.deepEqual(A.pattern.bands, V.pattern.bands.map(b => ({ min: b.min, weights: Object.fromEntries(Object.entries(b.weights).map(([k, w]) => [rename[k], w])) })))
  assert.deepEqual(A.pattern.buffs, [
    { at: 0.6, name: '霧雨の帳', table: { vit: 25 } }, { at: 0.3, name: '篠突く雨', table: { int_stat: 35 } },
  ])
  // 試し撃ちで戦える（75%を切ったら氷雨）
  const st = createAtb(dummy(), dungeonFighter('amaza', 'normal'), { rng: rngOf(4), maxSec: 999 })
  runFor(st, 20)
  const acts = () => st.log.filter(l => l.side === '雨摩座' && (l.type === 'skill' || l.type === 'normal')).map(l => l.skill || '雨礫')
  assert.ok(acts().length >= 3 && acts().every(a => a === '雨礫'))
  const n0 = acts().length
  st.b.hp = Math.floor(st.b.base.hp * 0.55)
  runFor(st, 9)
  assert.equal(acts()[n0], '氷雨')
  assert.deepEqual(buffLog(st, '雨摩座'), ['霧雨の帳'])
})

test('【確定】2026-11-01 ゼルギアス（ユーザー「ゼルギアスと閻魔も一緒に作りたい」→技の案に「これでいい」→「進めて」）：ぜんぶ物理・節目と割合と強さは黒龍と同じ・技とバフの名前は絵と同じ', () => {
  const Z = DUNGEON_BOSSES.zerugiasu, V = DUNGEON_BOSSES.varuzenoku
  assert.equal(isSummonable('zerugiasu'), true)
  assert.equal(isDiffUnlocked('zerugiasu', 'normal', 1), false, 'エリア②に着くまで呼べない')
  assert.equal(isDiffUnlocked('zerugiasu', 'normal', 2), true)
  assert.equal(isDiffUnlocked('zerugiasu', 'hard', 4), false, 'エリア⑤に着くまで呼べない')
  assert.equal(isDiffUnlocked('zerugiasu', 'expert', 15), false, 'まだ数字が無い')
  assert.deepEqual(Z.diffs, V.diffs, '強さは黒龍と同じ')
  assert.deepEqual(Z.dist, V.dist, '配分も黒龍と同じ')
  assert.equal(Z.kind, 'phys')
  assert.deepEqual(Z.skills.map(s => [s.name, s.kind, s.mult, s.hits ?? 1, s.ail?.key ?? null, s.ail?.chance ?? null]), [
    ['雷霆掃射', 'phys', 0.55, 3, 'silence', 70], ['神雷崩撃', 'phys', 1.8, 1, 'paralyze', 40], ['神雷終焉', 'phys', 4.0, 1, null, null],
  ])
  assert.deepEqual(Z.pattern.steps.map(s => s.at), V.pattern.steps.map(s => s.at))
  const rename = { '焦熱の吐息': '雷霆掃射', '黒翼烈風': '神雷崩撃', '終焉の黒焔': '神雷終焉' }
  assert.deepEqual(Z.pattern.bands, V.pattern.bands.map(b => ({ min: b.min, weights: Object.fromEntries(Object.entries(b.weights).map(([k, w]) => [rename[k], w])) })))
  assert.deepEqual(Z.pattern.buffs, [
    { at: 0.6, name: '雷鋼装甲', table: { vit: 25 } }, { at: 0.3, name: '炉心臨界', table: { str: 25, agi: 25 } },
  ])
  // 絵と同じ名前（違うと動きが出ない）：技＝動きの label（1つめが通常攻撃の雷鋼弾）・バフ＝絵の buffs
  const a = bossIllustOf('zerugiasu')
  assert.deepEqual(Object.values(a.motions).map(m => m.label), ['雷鋼弾', ...Z.skills.map(s => s.name)])
  assert.deepEqual(Object.keys(a.buffs), Z.pattern.buffs.map(b => b.name))
  // 試し撃ちで戦える（満タンのあいだは雷鋼弾だけ・75%を切ったら雷霆掃射）
  const st = createAtb(dummy(), dungeonFighter('zerugiasu', 'normal'), { rng: rngOf(4), maxSec: 999 })
  runFor(st, 20)
  const acts = () => st.log.filter(l => l.side === Z.name && (l.type === 'skill' || l.type === 'normal')).map(l => l.skill || '雷鋼弾')
  assert.ok(acts().length >= 3 && acts().every(x => x === '雷鋼弾'))
  const n0 = acts().length
  st.b.hp = Math.floor(st.b.base.hp * 0.55)
  runFor(st, 9)
  assert.equal(acts()[n0], '雷霆掃射')
  assert.deepEqual(buffLog(st, Z.name), ['雷鋼装甲'])
})

test('【確定】2026-11-01 神雷終焉：必ず当たる・相手が麻痺していると1.5倍・当てると麻痺は消える', () => {
  const shoot = (name, seed, { eva = 0, par = false } = {}) => {
    const f = dungeonFighter('zerugiasu', 'normal'), me = createSide(f), foe = createSide(dummy()), log = []
    if (eva) foe.pa.evaBonus = eva
    if (par) inflict(foe.ail, 'paralyze')
    takeAction(me, foe, rngOf(seed), log, { idx: f.slots.findIndex(x => x.skill.name === name), noProc: true })
    return { e: log.find(l => l.type === 'skill' && l.skill === name), foe }
  }
  const SEEDS = Array.from({ length: 300 }, (_, i) => (i + 1) * 7919)
  const hitsOf = (name) => SEEDS.filter(s => shoot(name, s, { eva: 60 }).e?.hits > 0).length
  assert.equal(hitsOf('神雷終焉'), SEEDS.length, '避けやすい相手でも全部当たる')
  assert.ok(hitsOf('神雷崩撃') < SEEDS.length * 0.9, 'ふつうの技は外れる')
  const avg = (par) => {
    const xs = SEEDS.map(s => shoot('神雷終焉', s, { par }).e).filter(e => !e.crit)
    return xs.reduce((a, e) => a + e.damage, 0) / xs.length
  }
  assert.ok(Math.abs(avg(true) / avg(false) - 1.5) < 0.05, `麻痺で1.5倍（${avg(true)}/${avg(false)}）`)
  assert.ok(SEEDS.every(s => !shoot('神雷終焉', s, { par: true }).foe.ail.paralyze), '当てると麻痺は消える')
})

test('【確定】2026-11-01 閻魔（ユーザー「ゼルギアスと閻魔も一緒に作りたい」→技の案に「これでいい」→「閻魔も作ったから最後まで全部つくって」）：ぜんぶ魔法・節目と割合と強さは黒龍と同じ・技とバフの名前は案のとおり', () => {
  const E = DUNGEON_BOSSES.enma, V = DUNGEON_BOSSES.varuzenoku
  assert.equal(isSummonable('enma'), true)
  assert.equal(isDiffUnlocked('enma', 'normal', 1), false, 'エリア②に着くまで呼べない')
  assert.equal(isDiffUnlocked('enma', 'normal', 2), true)
  assert.equal(isDiffUnlocked('enma', 'hard', 4), false, 'エリア⑤に着くまで呼べない')
  assert.equal(isDiffUnlocked('enma', 'expert', 15), false, 'まだ数字が無い')
  assert.deepEqual(E.diffs, V.diffs, '強さは黒龍と同じ')
  assert.deepEqual(E.dist, DUNGEON_BOSSES.amaza.dist, '配分は魔法の雨摩座と同じ')
  assert.equal(E.kind, 'mag')
  assert.equal(E.race, '悪魔')
  assert.deepEqual(E.skills.map(s => [s.name, s.kind, s.mult, s.ail?.key ?? null, s.ail?.chance ?? null]), [
    ['業火断罪', 'mag', 1.6, 'curse', 70], ['業縛の鎖', 'mag', 1.8, 'seal', 50], ['無間地獄', 'mag', 4.0, null, null],
  ])
  assert.deepEqual(E.pattern.steps.map(s => s.at), V.pattern.steps.map(s => s.at))
  const rename = { '焦熱の吐息': '業火断罪', '黒翼烈風': '業縛の鎖', '終焉の黒焔': '無間地獄' }
  assert.deepEqual(E.pattern.bands, V.pattern.bands.map(b => ({ min: b.min, weights: Object.fromEntries(Object.entries(b.weights).map(([k, w]) => [rename[k], w])) })))
  assert.deepEqual(E.pattern.buffs, [
    { at: 0.6, name: '六道輪廻の理', table: { vit: 25 } }, { at: 0.3, name: '忿怒相', table: { int_stat: 35 } },
  ])
  // 絵と同じ名前（違うと動きが出ない）：技＝動きの label（1つめが通常攻撃の魂火）・バフ＝絵の buffs
  const a = bossIllustOf('enma')
  assert.deepEqual(Object.values(a.motions).map(m => m.label), ['魂火', ...E.skills.map(s => s.name)])
  assert.deepEqual(Object.keys(a.buffs), E.pattern.buffs.map(b => b.name))
  // 試し撃ちで戦える（満タンのあいだは魂火だけ・75%を切ったら業火断罪）
  const st = createAtb(dummy(), dungeonFighter('enma', 'normal'), { rng: rngOf(4), maxSec: 999 })
  runFor(st, 20)
  const acts = () => st.log.filter(l => l.side === E.name && (l.type === 'skill' || l.type === 'normal')).map(l => l.skill || '魂火')
  assert.ok(acts().length >= 3 && acts().every(x => x === '魂火'))
  const n0 = acts().length
  st.b.hp = Math.floor(st.b.base.hp * 0.55)
  runFor(st, 9)
  assert.equal(acts()[n0], '業火断罪')
  assert.deepEqual(buffLog(st, E.name), ['六道輪廻の理'])
})

test('【確定】2026-11-01 無間地獄：相手の状態異常1つにつき+25%（+75%＝7倍まで）・当てると全部消える＝構えのあいだに清めの雫で消すと4倍で済む', () => {
  const shoot = (seed, ails = []) => {
    const f = dungeonFighter('enma', 'normal'), me = createSide(f), foe = createSide(dummy()), log = []
    for (const k of ails) inflict(foe.ail, k)
    takeAction(me, foe, rngOf(seed), log, { idx: f.slots.findIndex(x => x.skill.name === '無間地獄'), noProc: true })
    return { e: log.find(l => l.type === 'skill' && l.skill === '無間地獄'), foe }
  }
  const SEEDS = Array.from({ length: 300 }, (_, i) => (i + 1) * 7919)
  const avg = (ails) => {
    const xs = SEEDS.map(s => shoot(s, ails).e).filter(e => e && e.hits > 0 && !e.crit)
    return xs.reduce((a, e) => a + e.damage, 0) / xs.length
  }
  const none = avg([])
  assert.ok(Math.abs(avg(['curse']) / none - 1.25) < 0.05, '呪い1つで+25%（先に消えるので、呪いの受けるダメージ+15%は重ならない）')
  assert.ok(Math.abs(avg(['seal']) / none - 1.25) < 0.05, '封印1つで+25%')
  assert.ok(Math.abs(avg(['seal', 'slow']) / none - 1.5) < 0.05, '2つで+50%')
  assert.ok(Math.abs(avg(['seal', 'slow', 'blind']) / none - 1.75) < 0.05, '3つで+75%')
  assert.ok(Math.abs(avg(['seal', 'slow', 'blind', 'weaken']) / none - 1.75) < 0.05, '4つでも+75%まで')
  // 当てると全部消える（外れたときは消えない）
  for (const s of SEEDS) {
    const { e, foe } = shoot(s, ['seal', 'slow'])
    if (e?.hits > 0) { assert.equal(hasAilment(foe.ail, 'seal'), false); assert.equal(hasAilment(foe.ail, 'slow'), false) }
  }
})

test('【確定】2026-11-01 炉心臨界：STRとAGIが+25%（INTは上がらない）・ボスのゲージも速くなる', () => {
  const st = createAtb(dummy(), dungeonFighter('zerugiasu', 'normal'), { rng: rngOf(4), maxSec: 9999 })
  const before = liveStats(st.b, true)
  st.b.hp = Math.floor(st.b.base.hp * 0.29)
  for (let i = 0; i < 400 && !hpBuffChips(st.b).some(c => c.name === '炉心臨界'); i++) runFor(st, 0.1)
  assert.ok(hpBuffChips(st.b).some(c => c.name === '炉心臨界'))
  const after = liveStats(st.b, true)
  assert.equal(after.int_stat, before.int_stat, 'INTは上がらない')
  assert.ok(Math.abs(after.str / before.str - 1.25) < 0.03, `STRは+25%（${after.str}/${before.str}）`)
  assert.ok(Math.abs(after.agi / before.agi - 1.25) < 0.03, `AGIは+25%（${after.agi}/${before.agi}）`)
  const foe = { agi: before.agi }
  assert.ok(fillPerSecOf(st.b, after, foe) > fillPerSecOf(st.b, before, foe), 'AGIが相手を上回るぶんゲージが速い')
})

test('【確定】2026-11-06 挑戦の結果が届いたら入口のそのボスの行を直す（ユーザー「挑戦して討伐完了してこの画面に戻るとき、一瞬上のほうに挑戦途中のバーみたいなのが表示されるから、表示されないようにして」「討伐しても出るのはおかしい、途中だったら出ててもいいけど」）', () => {
  const run = (id, more = {}) => ({ id, boss: 'zerugiasu', diff: 'normal', owner: 'a', mine: true, hp: 5000, hp_max: 13000, ends_at: '2026-11-06T12:00:00Z', cleared: false, rescue_open: false, members: [], my_tries: 1, ...more })
  const s = { ok: true, runs: [run(1), run(2, { boss: 'enma' })], rescues: [run(3, { mine: false }), run(1)], rewards: [] }
  // 入口の「入っているボス」は、倒れていない・時間の残っている行（V2capDungeon.jsx の active と同じ）
  const now = Date.parse('2026-11-06T11:00:00Z'), active = (st) => st.runs.filter(r => !r.cleared && msLeftOf(r.ends_at, now) > 0).map(r => r.id)
  assert.deepEqual(active(s), [1, 2])
  // 倒したボスは、入っているボスからも救援の一覧からも外れる（ほかの行はそのまま）
  const won = stateWithRunOf(s, run(1, { hp: 0, cleared: true }))
  assert.deepEqual(active(won), [2])
  assert.deepEqual(won.rescues.map(r => r.id), [3])
  // 途中（負け・時間切れ）なら行は残る（ユーザー「途中だったら出ててもいい」）。HPと回数は届いた値
  const lost = stateWithRunOf(s, run(1, { hp: 3200, my_tries: 2 }))
  assert.deepEqual(lost.runs.map(r => [r.id, r.hp, r.my_tries]), [[1, 3200, 2], [2, 5000, 1]])
  // 届いていない・前の状態が無ければそのまま。一覧に無い行は足さない（読み直しに任せる）・元の状態は書き換えない
  assert.equal(stateWithRunOf(s, null), s)
  assert.equal(stateWithRunOf(s, {}), s)
  assert.equal(stateWithRunOf(null, run(1)), null)
  assert.deepEqual(stateWithRunOf(s, run(9)).runs.map(r => r.id), [1, 2])
  assert.deepEqual(s.runs.map(r => r.id), [1, 2])
  assert.equal(s.runs[0].hp, 5000)
  // 画面：決着（onOver）とやめる（giveUp）で結果が届いたら、入口へ戻る前に直す（前は戦闘の前に読んだ状態のまま戻り、読み直しが届くまで倒したボスが出ていた）
  const src = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8')
  for (const [from, to] of [['const onOver = async', 'const onEnded ='], ['const giveUp = async', '// 戦っている途中で画面を離れたら']]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to))
    assert.ok(body.length > 0 && body.includes('if (r?.ok) setState(s => stateWithRunOf(s, r.run))'), from)
  }
})
