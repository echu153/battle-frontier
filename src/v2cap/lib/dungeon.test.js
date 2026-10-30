// v2cap の IDダンジョン（ボスを呼び、HPを持ち越して倒す・ATB）の決まりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DUNGEON_BOSSES, DIFF_KEYS, DUNGEON_MIN, DUNGEON_TRY_SEC, SUMMONS_PER_DAY, STAMINA_OWNER_FIRST, STAMINA_OWNER, STAMINA_HELPER, HELPERS_MAX,
  diffOf, isDiffReady, isDiffUnlocked, isSummonable, tryStaminaOf, dungeonFighter,
} from './dungeon.js'
import { createAtb, runFor, startMacro, fillPerSecOf, hpBuffChips, ATB_SLOW_CUT, FILL_PER_SEC } from '../core/atb.js'
import { liveStats } from '../core/battle.js'
import { statsOf } from '../core/enemies.js'
import { CAP_RULES } from './rules.js'

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
  assert.deepEqual(rows, ready, 'サーバーの難易度の表＝呼べる難易度（まだ数字の無い難易度・まだ呼べないボス＝雨摩座はサーバーにも無い）')
  assert.match(fnBody('v2cap_dungeon_summon'), new RegExp(`c_min\\s+constant int := ${DUNGEON_MIN};`))
  const start = fnBody('v2cap_dungeon_try_start')
  assert.match(start, new RegExp(`c_owner_first constant int := ${STAMINA_OWNER_FIRST};`))
  assert.match(start, new RegExp(`c_owner\\s+constant int := ${STAMINA_OWNER};`))
  assert.match(start, new RegExp(`c_helper\\s+constant int := ${STAMINA_HELPER};`))
  assert.match(start, new RegExp(`c_try_sec\\s+constant int := ${DUNGEON_TRY_SEC};`))
  for (const fn of ['v2cap_dungeon_join', 'v2cap_dungeon_state']) assert.match(fnBody(fn), new RegExp(`c_helpers_max constant int := ${HELPERS_MAX};`), `${fn} の救援の人数`)
  // 1日1回：きょう呼んだら（どの難易度でも）呼べない
  assert.equal(SUMMONS_PER_DAY, 1)
  assert.match(fnBody('v2cap_dungeon_summon'), /r\.owner_id = v_uid and r\.day = public\.v2cap_dungeon_today\(\)/)
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
  assert.deepEqual({ ...diffOf('varuzenoku', 'normal') }, { label: 'ノーマル', area: 2, recLv: 25, recPower: 500, power: 474, atk: 0.33, hp: 6500 })
  assert.deepEqual({ ...diffOf('varuzenoku', 'hard') }, { label: 'ハード', area: 5, recLv: 45, recPower: 1050, power: 1027, atk: 0.38, hp: 15000 })
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
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 6500 * 0.6), { rng: rngOf(7), maxSec: 999 })
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
  runFor(st, 6)
  assert.equal(bossActs(st)[n1], '構え:終焉の黒焔', '25%で黒焔の構え')
  runFor(st, 300)
  const low = bossActs(st).slice(n1)
  assert.ok(!low.includes('黒爪'), '25%以下も毎回技')
  assert.ok(low.includes('終焉の黒焔') && low.filter(a => a === '構え:終焉の黒焔').length >= 3, '黒焔はそのあとも出る（構えてから）')
})

test('【確定】2026-10-29 挑戦の始めにもう切っている節目は撃たない（前の挑戦で撃った）・同じ種なら同じ結果', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 6500 * 0.4), { rng: rngOf(11), maxSec: 999 })
  assert.equal(st.b.hp, 6500 * 0.4)
  assert.equal(st.b.startHp, 6500 * 0.4, '削った量はここから数える')
  assert.deepEqual([...st.b.patFired].sort(), [0.5, 0.75])
  runFor(st, 60)
  const acts = bossActs(st)
  assert.ok(acts.every(a => a === '焦熱の吐息' || a === '黒翼烈風'), '50%より下から始めた：吐息か烈風（必ず撃つ技はない）')
  const again = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 6500 * 0.4), { rng: rngOf(11), maxSec: 999 })
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

test('【確定】2026-10-30 HPの節目のバフ：60%で黒鱗の鎧（VIT+25%）・30%で逆鱗（STR・INT+25%）。切った瞬間に付き、時間では消えない', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(5), maxSec: 999 })
  runFor(st, 20)
  assert.deepEqual(buffLog(st), [], '60%より上は付かない')
  const s0 = liveStats(st.b)
  st.b.hp = Math.floor(st.b.base.hp * 0.59)
  runFor(st, 6)
  assert.deepEqual(buffLog(st), ['黒鱗の鎧'])
  assert.deepEqual(hpBuffChips(st.b), [{ name: '黒鱗の鎧', table: { vit: 25 } }])
  assert.ok(near(liveStats(st.b).vit, s0.vit * 1.25), `VIT+25%（${s0.vit}→${liveStats(st.b).vit}）`)
  assert.ok(near(liveStats(st.b).str, s0.str), 'STRはまだ')
  st.b.hp = Math.floor(st.b.base.hp * 0.29)
  runFor(st, 6)
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
  const st = createAtb(me, dungeonFighter('varuzenoku', 'normal', 6500 * 0.2), { rng: rngOf(9), maxSec: 999 })
  startMacro(st, 1, [{ idx: 0 }], true)
  const s0 = liveStats(st.b)
  runFor(st, 120)
  assert.ok(st.log.filter(l => l.side === 'じぶん' && l.type === 'skill' && l.skill === 'ためしの消し').length >= 10, 'バフ消しを何度も撃った')
  assert.equal(st.log.filter(l => l.type === 'dispel').length, 0, '消せるバフが無い')
  assert.ok(near(liveStats(st.b).vit, s0.vit) && near(liveStats(st.b).str, s0.str), '残っている')
  assert.deepEqual(hpBuffChips(st.b).map(c => c.name), ['黒鱗の鎧', '逆鱗'])
})

test('【確定】2026-10-30 持ち越しで節目をもう切っているなら、はじめから付いている（記録にも出る）', () => {
  const st = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 6500 * 0.5), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(st), ['黒鱗の鎧'], '始めた時点で')
  assert.equal(st.t, 0)
  const low = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal', 6500 * 0.1), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(low), ['黒鱗の鎧', '逆鱗'])
  const full = createAtb(dummy(), dungeonFighter('varuzenoku', 'normal'), { rng: rngOf(2), maxSec: 999 })
  assert.deepEqual(buffLog(full), [])
})

test('【確定】2026-10-30 雨摩座：黒龍の裏返し（魔法が主）・節目と割合と強さは黒龍と同じ・まだ呼べない（試し撃ちだけ）', () => {
  const A = DUNGEON_BOSSES.amaza, V = DUNGEON_BOSSES.varuzenoku
  assert.equal(isSummonable('amaza'), false)
  assert.equal(isSummonable('varuzenoku'), true)
  for (const k of DIFF_KEYS) assert.equal(isDiffUnlocked('amaza', k, 15), false, 'ダンジョンの入口では呼べない')
  assert.deepEqual(A.diffs, V.diffs, '強さは黒龍と同じ')
  assert.equal(A.kind, 'mag')
  assert.deepEqual(A.skills.map(s => [s.name, s.kind, s.mult, s.ail?.key ?? null, s.ail?.chance ?? null]), [
    ['氷雨', 'mag', 1.6, 'slow', 70], ['水縛の帯', 'phys', 1.8, 'paralyze', 30], ['水天葬', 'mag', 3.0, null, null],
  ])
  assert.deepEqual(A.pattern.steps.map(s => s.at), V.pattern.steps.map(s => s.at))
  const rename = { '焦熱の吐息': '氷雨', '黒翼烈風': '水縛の帯', '終焉の黒焔': '水天葬' }
  assert.deepEqual(A.pattern.bands, V.pattern.bands.map(b => ({ min: b.min, weights: Object.fromEntries(Object.entries(b.weights).map(([k, w]) => [rename[k], w])) })))
  assert.deepEqual(A.pattern.buffs, [
    { at: 0.6, name: '霧雨の帳', table: { vit: 25 } }, { at: 0.3, name: '篠突く雨', table: { str: 25, int_stat: 25 } },
  ])
  // 試し撃ちで戦える（75%を切ったら氷雨）
  const st = createAtb(dummy(), dungeonFighter('amaza', 'normal'), { rng: rngOf(4), maxSec: 999 })
  runFor(st, 20)
  const acts = () => st.log.filter(l => l.side === '雨摩座' && (l.type === 'skill' || l.type === 'normal')).map(l => l.skill || '雨礫')
  assert.ok(acts().length >= 3 && acts().every(a => a === '雨礫'))
  const n0 = acts().length
  st.b.hp = Math.floor(st.b.base.hp * 0.55)
  runFor(st, 6)
  assert.equal(acts()[n0], '氷雨')
  assert.deepEqual(buffLog(st, '雨摩座'), ['霧雨の帳'])
})
