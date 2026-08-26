// 自動成長NPC（npc.js）のテスト（node --test）
// ------------------------------------------------------------
// ここで見張っているのは3つ：
//   ・成長の計算が stats.js の成長方式とズレていないこと（戦闘力の式・EXPの逆引き）
//   ・100体が「1階から最上階までまんべんなく・職業も散らばって」いること
//   ・NPC同士／NPCと階層守護者が**本物の runBattle で実際に戦えること**
//     （スキル編成が空だったり、スナップショットが復元できないと戦闘が成立しない）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NPC_COUNT, NPC_CLASSES, SPEED_MIN, SPEED_MAX, POWER_CAP, EXP_CAP,
  progressOf, expForProgress, basePowerOf, powerOfExp,
  statsOfNpc, slotsOfNpc, fighterOf, snapshotOfNpc, grownExp,
  arenaIntervalOf, arenaDelayOf, shouldRetire, seedListOf, mulberry32,
  ARENA_MIN_MINUTES, ARENA_MAX_MINUTES, RETIRE_STREAK, gearRatioOf,
} from './npc.js'
import { calcPower, MAX_LV, expPerLv, INITIAL_STATS, JOB_CHANGE_POWER, ROLLS_PER_LV } from './stats.js'
import { FLOORS, powerOfFloor, champOf, fromSnapshot, LOSE_DROP } from './arena.js'
import { SKILL_BY_NAME, skillsOf, SKILL_SET_SLOTS, mpOf } from './skills.js'
import { runBattle } from './battle.js'
import { CLASS_BONUS } from './classBonus.js'

// ===== 成長の計算 =====

test('戦闘力は乱数によらず 39＋転職×100＋(LV-1)×5 で決まる（stats.js の成長方式と同じ）', () => {
  assert.equal(calcPower(INITIAL_STATS), 39)
  assert.equal(basePowerOf(0, 1), 39)
  assert.equal(basePowerOf(0, MAX_LV), 39 + (MAX_LV - 1) * ROLLS_PER_LV)
  assert.equal(basePowerOf(3, 1), 39 + 3 * JOB_CHANGE_POWER)
})

test('通算EXP → LV/転職回数 の変換が逆引きと一致する', () => {
  for (const [jobs, lv] of [[0, 1], [0, 50], [1, 1], [7, 33], [120, 88], [250, 2]]) {
    const exp = expForProgress(jobs, lv)
    const p = progressOf(exp)
    assert.equal(p.jobs, jobs, `転職回数 (${jobs},${lv})`)
    assert.equal(p.lv, lv, `LV (${jobs},${lv})`)
    assert.equal(p.exp, 0)
  }
})

test('LV上限に届いたら転職して次の周に入る（EXPは持ち越さない扱い）', () => {
  const oneCycle = (MAX_LV - 1) * expPerLv(0)
  assert.deepEqual(progressOf(oneCycle - 1).jobs, 0)
  assert.deepEqual(progressOf(oneCycle).jobs, 1)
  assert.deepEqual(progressOf(oneCycle).lv, 1)
})

test('作ったステの戦闘力が、計算で出した戦闘力と一致する（散らし方の端数ぶんだけ許容）', () => {
  for (const totalExp of [0, 5000, 60000, 400000, EXP_CAP]) {
    for (const cls of ['侍', '元素使い', '竜騎士']) {
      const stats = statsOfNpc({ seed: 12345, cls, total_exp: totalExp })
      const diff = Math.abs(calcPower(stats) - powerOfExp(totalExp))
      assert.ok(diff <= 20, `${cls} exp=${totalExp} 差が大きい: ${diff}`)
    }
  }
})

test('同じ seed と通算EXPなら、何度作っても同じステになる（DBにステを持たなくてよい根拠）', () => {
  const a = statsOfNpc({ seed: 777, cls: '狩人', total_exp: 123456 })
  const b = statsOfNpc({ seed: 777, cls: '狩人', total_exp: 123456 })
  assert.deepEqual(a, b)
  const c = statsOfNpc({ seed: 778, cls: '狩人', total_exp: 123456 })
  assert.notDeepEqual(a, c, 'seedが違えば散らばり方も違う')
})

test('強さの上限で成長が止まる（③ 一旦50階＝約29,700で頭打ち）', () => {
  assert.equal(POWER_CAP, powerOfFloor(FLOORS))
  assert.ok(powerOfExp(EXP_CAP) >= POWER_CAP)
  assert.ok(powerOfExp(EXP_CAP * 10) === POWER_CAP, '上限を超えて伸びない')
  // 上限に届いたNPCはEXPが増えない
  assert.equal(grownExp({ speed: 600, total_exp: EXP_CAP }, 100), EXP_CAP)
  // 届いていないNPCは speed × 時間 だけ増える
  assert.equal(grownExp({ speed: 100, total_exp: 0 }, 3), 300)
})

test('装備の強さは転職回数で伸びて頭打ちになる', () => {
  assert.ok(gearRatioOf(0) < gearRatioOf(50))
  assert.equal(gearRatioOf(100000), gearRatioOf(1000000))
})

// ===== 100体の顔ぶれ =====

test('100体の名前が重複していない', () => {
  const list = seedListOf()
  assert.equal(list.length, NPC_COUNT)
  assert.equal(new Set(list.map(n => n.name)).size, NPC_COUNT)
})

test('職業が20職に均等（1職5体）', () => {
  const list = seedListOf()
  const count = {}
  for (const n of list) count[n.cls] = (count[n.cls] || 0) + 1
  assert.equal(Object.keys(count).length, NPC_CLASSES.length)
  for (const cls of NPC_CLASSES) assert.equal(count[cls], NPC_COUNT / NPC_CLASSES.length, cls)
  // 上位職だけ（初期職・ノーブルは職業補正が無いので使わない）
  for (const cls of NPC_CLASSES) assert.ok(CLASS_BONUS[cls], `${cls} に職業補正が無い`)
})

test('成長速度が「ゆっくり」から「かなり速い」まで広がっている', () => {
  const list = seedListOf()
  const speeds = list.map(n => n.speed)
  assert.equal(Math.min(...speeds), SPEED_MIN)
  assert.equal(Math.max(...speeds), SPEED_MAX)
  // 添字が増えるほど速い（速度そのものは log で等分＝遅い人が多い）
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] >= speeds[i - 1])
  const median = [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length / 2)]
  assert.ok(median < (SPEED_MIN + SPEED_MAX) / 2, '中央値が真ん中より下＝遅い人のほうが多い')
})

test('1階から最上階まで住人がいて、その階の目安どおりの強さになっている', () => {
  const list = seedListOf()
  for (let f = 1; f <= FLOORS; f++) {
    const here = list.filter(n => n.arena_floor === f)
    assert.equal(here.length, NPC_COUNT / FLOORS, `${f}階の人数`)
    for (const n of here) {
      const ratio = n.power / powerOfFloor(f)
      assert.ok(ratio > 0.7 && ratio < 1.3, `${f}階 ${n.name} の戦闘力が目安から離れすぎ (${ratio.toFixed(2)})`)
    }
  }
  // 半分が最初から席に座っている＝作った直後でも一覧が埋まって見える
  assert.equal(list.filter(n => n.defending).length, FLOORS)
})

// ===== 戦える形になっているか =====

test('スキル編成は5枠まで・自分の職業の技だけ・想定利用MPが最大MPを超えない', () => {
  for (const n of seedListOf()) {
    const npc = { ...n, id: n.idx + 1 }
    const stats = statsOfNpc(npc)
    const slots = slotsOfNpc(npc, stats)
    assert.ok(slots.length > 0, `${n.name} の編成が空`)
    assert.ok(slots.length <= SKILL_SET_SLOTS, `${n.name} の枠が多い`)
    const own = new Set(skillsOf(n.cls).map(s => s.name))
    let cost = 0
    for (const e of slots) {
      assert.ok(own.has(e.skill.name), `${n.name}: ${e.skill.name} は${n.cls}の技ではない`)
      assert.ok(e.uses >= 1)
      cost += mpOf(n.cls, e.skill) * e.uses
    }
    assert.ok(cost <= stats.mp, `${n.name} の想定利用MP ${cost} が最大MP ${stats.mp} を超えている`)
  }
})

test('スナップショットが arena.js で復元できる（＝画面もEdgeも同じ相手を作れる）', () => {
  const n = seedListOf()[60]
  const snap = snapshotOfNpc({ ...n, id: n.idx + 1 })
  assert.equal(snap.npc, true, 'NPCの印が付いている（④ 画面で見分けるための元）')
  assert.equal(snap.npc_id, n.idx + 1)
  const back = fromSnapshot(snap, SKILL_BY_NAME)
  assert.equal(back.slots.length, snap.slots.length, '技が引き直せていない')
  // v2_arena_floors の行として渡したときに階層守護者になる
  const champ = champOf(n.arena_floor, { snapshot: snap, hp: snap.stats.hp, mp: snap.stats.mp, streak: 0 }, SKILL_BY_NAME)
  assert.equal(champ.npc, true)
  assert.equal(champ.name, n.name)
})

test('NPC同士が本物の runBattle で決着する（引き分けで固まらない）', () => {
  const list = seedListOf().map(n => ({ ...n, id: n.idx + 1 }))
  let decided = 0
  for (let i = 0; i < list.length; i += 7) {
    const a = fighterOf(list[i])
    const b = fighterOf(list[(i + 3) % list.length])
    const r = runBattle(a, { ...b, startHp: b.stats.hp, startMp: b.stats.mp })
    assert.ok(['a', 'b', 'draw'].includes(r.winner))
    if (r.winner !== 'draw') decided++
  }
  assert.ok(decided > 0, 'どの組み合わせも決着しない')
})

test('強いNPCは自分より下の階の階層守護者にちゃんと勝てる', () => {
  const list = seedListOf().map(n => ({ ...n, id: n.idx + 1 }))
  // 40階あたりの住人が10階あたりの住人に挑む
  const strong = fighterOf(list.find(n => n.arena_floor === 40))
  const weak = fighterOf(list.find(n => n.arena_floor === 10))
  let wins = 0
  for (let i = 0; i < 5; i++) {
    const r = runBattle(strong, { ...weak, startHp: weak.stats.hp, startMp: weak.stats.mp })
    if (r.winner === 'a') wins++
  }
  assert.equal(wins, 5, '格上が格下に負けている＝ステの作り方がおかしい')
})

// ===== アリーナでの動き =====

test('挑戦の間隔は速い人ほど短い（20〜240分）', () => {
  assert.equal(arenaIntervalOf(SPEED_MIN), ARENA_MAX_MINUTES)
  assert.equal(arenaIntervalOf(SPEED_MAX), ARENA_MIN_MINUTES)
  for (let s = SPEED_MIN; s < SPEED_MAX; s = Math.ceil(s * 1.3)) {
    assert.ok(arenaIntervalOf(s) >= arenaIntervalOf(Math.ceil(s * 1.3)))
  }
  const rng = mulberry32(1)
  for (let i = 0; i < 50; i++) {
    const d = arenaDelayOf(100, rng)
    assert.ok(d >= 1 && d <= ARENA_MAX_MINUTES * 1.3)
  }
})

test('席を降りる条件（強すぎる階／守りすぎ）', () => {
  // 5階に居るのに7階の目安に届いている＝強すぎるので上へ行く
  assert.equal(shouldRetire(powerOfFloor(7), 5, 0), true)
  assert.equal(shouldRetire(powerOfFloor(5), 5, 0), false)
  // 守りすぎ（席が回らなくなる）
  assert.equal(shouldRetire(powerOfFloor(5), 5, RETIRE_STREAK), true)
  // 最上階からは降りない
  assert.equal(shouldRetire(POWER_CAP, FLOORS, 99), false)
})

// ===== SQL との突き合わせ =====
// v2は「1ファイルにまとめて全文を流し直す」運用なので、同じ数字がSQLとJSの2か所にある。
// 片方だけ直したときに気付けるようにここで固定する（v2sql.test.js と同じ考え方）。

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  return SQL.slice(i, end)
}

test('v2_npcs テーブルと3つのRPCがSQLにある', () => {
  assert.ok(SQL.includes('create table if not exists public.v2_npcs'), 'v2_npcs が無い')
  for (const fn of ['v2_npc_grow', 'v2_npc_arena_apply', 'v2_npc_retire']) {
    assert.ok(SQL.includes(`create or replace function public.${fn}(`), `${fn} が無い`)
  }
})

test('NPCのアリーナRPCが、プレイヤーと同じ階数・落ちる階数で書かれている', () => {
  const body = bodyOf('v2_npc_arena_apply')
  assert.match(body, new RegExp(`c_floors constant int := ${FLOORS};`), '階数がarena.jsとズレている')
  assert.match(body, new RegExp(`c_drop   constant int := ${LOSE_DROP};`), '落ちる階数がarena.jsとズレている')
})

test('NPCのRPCはプレイヤーから呼べない（service_role だけ）', () => {
  for (const sig of [
    'public.v2_npc_grow(jsonb)',
    'public.v2_npc_arena_apply(int, boolean, int, int, int, int, jsonb)',
    'public.v2_npc_retire(int)',
  ]) {
    assert.ok(SQL.includes(`revoke all on function ${sig} from authenticated;`), `${sig} の authenticated 剥奪が無い`)
    assert.ok(SQL.includes(`grant execute on function ${sig} to service_role;`), `${sig} の service_role 付与が無い`)
    assert.ok(!SQL.includes(`grant execute on function ${sig} to authenticated;`), `${sig} を authenticated に渡している`)
  }
})

test('プレイヤーがNPCの階層守護者を破ったとき、NPCを1つ上へ進めている', () => {
  const body = bodyOf('v2_arena_fight')
  assert.ok(body.includes('v_champ.npc_id is not null'), 'v2_arena_fight がNPCの席を見ていない')
  assert.ok(body.includes('npc_id = null'), '席を奪ったときに npc_id を消していない')
})

test('席は player_id と npc_id のどちらか片方（列がSQLにある）', () => {
  assert.ok(SQL.includes('alter table public.v2_arena_floors add column if not exists npc_id int'), 'npc_id 列が無い')
})

// ===== まとめて動かしてみる（ティックの再現）=====
// Edge Function（supabase/functions/v2-npc-tick）がやっていることを、そのままJSで回す。
// **人が誰も居なくてもアリーナが回り続けること**を、ここで確かめる。
test('1週間ぶん回すと、順位表が戦闘力の順に落ち着いていく', () => {
  const npcs = seedListOf().map(n => ({ ...n, id: n.idx + 1, next: 0 }))
  const floors = new Map()   // floor -> { npc, hp, mp, streak }
  for (const n of npcs) {
    if (n.defending && !floors.has(n.arena_floor)) {
      const s = statsOfNpc(n)
      floors.set(n.arena_floor, { npc: n, hp: s.hp, mp: s.mp, streak: 0 })
      n.seat = n.arena_floor
    }
  }
  const seatOf = (n) => n.seat || null

  let fights = 0
  const STEP_MIN = 5
  for (let t = 0; t <= 7 * 24 * 60; t += STEP_MIN) {   // 5分おきに1週間
    for (const n of npcs) {
      // 成長
      n.total_exp = grownExp(n, STEP_MIN / 60)
      if (n.next > t) continue
      const rng = mulberry32(n.seed + t)
      n.next = t + arenaDelayOf(n.speed, rng)
      const power = powerOfExp(n.total_exp)
      const seat = seatOf(n)
      if (seat) {
        const row = floors.get(seat)
        if (row && shouldRetire(power, seat, row.streak)) {
          floors.delete(seat); n.seat = null; n.arena_floor = Math.min(FLOORS, seat + 1)
        }
        continue
      }
      const floor = Math.min(FLOORS, Math.max(1, n.arena_floor))
      const row = floors.get(floor)
      const me = fighterOf(n)
      const foe = row
        ? { ...fighterOf(row.npc), startHp: row.hp, startMp: row.mp }
        : (() => { const c = champOf(floor, null, SKILL_BY_NAME); return { ...c, startHp: c.hp, startMp: c.mp } })()
      const r = runBattle(me, foe)
      fights++
      if (r.winner === 'a') {
        if (row) { row.npc.seat = null; row.npc.arena_floor = Math.min(FLOORS, floor + 1) }
        floors.set(floor, { npc: n, hp: Math.max(1, Math.round(r.a.hp)), mp: Math.max(0, Math.round(r.a.mp)), streak: 0 })
        n.seat = floor
      } else {
        if (row) { row.hp = Math.max(1, Math.round(r.b.hp)); row.mp = Math.max(0, Math.round(r.b.mp)); row.streak++ }
        n.arena_floor = Math.max(1, floor - 1)
      }
    }
  }

  assert.ok(fights > 200, `1週間で戦闘が少なすぎる (${fights})`)
  // 席が埋まっている（人が居なくても一覧がスカスカにならない）
  assert.ok(floors.size >= FLOORS * 0.6, `埋まっている席が少ない (${floors.size}/${FLOORS})`)
  // 上の階ほど強い、という並びになっているか（下位10階と上位10階の平均で比べる）
  const powerAt = (f) => (floors.get(f) ? powerOfExp(floors.get(f).npc.total_exp) : null)
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)
  const low = avg(Array.from({ length: 10 }, (_, i) => powerAt(i + 1)).filter(Boolean))
  const high = avg(Array.from({ length: 10 }, (_, i) => powerAt(FLOORS - i)).filter(Boolean))
  assert.ok(high > low * 5, `上の階のほうが強い、になっていない（下${Math.round(low)} 上${Math.round(high)}）`)
  // 全員がどこかの階に居る（詰まって消えない）
  for (const n of npcs) assert.ok(n.arena_floor >= 1 && n.arena_floor <= FLOORS, `${n.name} の階がおかしい`)
})
