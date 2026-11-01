// v2cap の挑戦：結果をサーバーで確かめる（回し直し）のテスト（node --test）
//   ★ふつうに遊んだ人の結果がサーバーと一致する／書き換えた申告では増えない、を見張る。
//   SQL まで通した確かめは v2cap-tools/dungeon-1029/verify-check.mjs（PGlite・本物の DB の形で最初から最後まで）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  STEP_SEC, advance, ailChips, buffChips, chosenOf, clearQueue, drinkItem, hpBuffChips, needNow, needShownOf, replayInputs, reserve, seedRng, startMacro, stateChips, stopMacro, toggleGuard, unreserveAt,
} from '../core/atb.js'
import { atbPlayerOf } from './atbPlayer.js'
import { CLASSES, canEquipType } from './jobs.js'
import { ITEMS, itemIdOf } from './equipment.js'
import { SKILLS } from './skills.js'
import { DUNGEON_TRY_SEC, diffOf } from './dungeon.js'
import { INPUTS_MAX, TIME_SLACK_SEC, TRY_STEPS, allowedSteps, cleanTryOf, damageOf, startTryAtb, validInputs, verifyTry } from './dungeonVerify.js'
import { SUPABASE_KEY, SUPABASE_URL, verifyRequest } from './dungeonVerifyApi.js'
import { PROD_ORIGIN, callVerify, isStaleBuild, verifyUrlOf } from './dungeonVerifyCall.js'
import handler from '../../../api/v2cap-dungeon-verify.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const AT = Date.UTC(2026, 9, 31, 3, 0, 0)
const LEARNED = SKILLS.map(s => s.name)
const BOSSES = ['varuzenoku', 'amaza', 'zerugiasu', 'enma']
const RARE = (cls) => ITEMS.find(i => i.part === '武器' && i.area === 5 && i.rarity === 'R' && canEquipType(cls, i.type))
// サーバーの写しと同じ形（JSON を通した { prof, inv, at }）。7枠を着けた LV45 のキャラ
const snapOf = (cls, over = {}) => {
  const ids = {
    weapon: RARE(cls).id, head: itemIdOf(5, 'R', '重鎧頭'), body: itemIdOf(5, 'R', '重鎧鎧'), arm: itemIdOf(5, 'R', '軽装腕'), foot: itemIdOf(5, 'R', '軽装足'),
    acc1: itemIdOf(5, 'R', 'リング'), acc2: itemIdOf(5, 'R', 'イヤリング'),
  }
  const slots = Object.keys(ids)
  return JSON.parse(JSON.stringify({
    prof: {
      id: '11111111-1111-1111-1111-111111111111', username: 'てすと', class: cls, lv: 45,
      hp: 500, mp: 90, str: 130, dex: 110, agi: 110, int_stat: 130, vit: 110, luk: 60,
      jobs: { [cls]: { lv: 30, exp: 0 } }, learned: LEARNED, skill_sets: {}, ascension: {}, gender: 'm',
      equipped: Object.fromEntries(slots.map((s, i) => [s, i + 1])), meal_burger: null, meal_major: null, meal_minor: null, meal_until: null,
      ...over,
    },
    inv: slots.map((s, i) => ({ id: i + 1, base_id: ids[s], ilv: 40, plus: 3, shinka: null })),
    at: AT,
  }))
}
const tryOf = (cls, boss, seed, hp = 15000) => ({ boss, diff: 'hard', hp, seed, snap: snapOf(cls) })

// 画面と同じ遊び方：実時間の差分（ばらばら）で進め、そのあいだにボタンを押す。press＝押し方の種。stopAt＝そこで「やめる」
const playLikeScreen = (t, press, stopAt = Infinity) => {
  const st = startTryAtb(t)
  const r = seedRng(press)
  startMacro(st, 1, st.a.slots.slice(0, 8).map((_, i) => ({ idx: i })), true)
  while (!st.over && st.steps < stopAt) {
    advance(st, 0.006 + r() * 0.03)
    const p = r()
    if (p < 0.01) reserve(st, Math.floor(r() * st.a.slots.length))
    else if (p < 0.012) reserve(st, null)
    else if (p < 0.015) toggleGuard(st)
    else if (p < 0.016) unreserveAt(st, 0)
    else if (p < 0.017) clearQueue(st)
    else if (p < 0.018) stopMacro(st)
    else if (p < 0.022) startMacro(st, 2, [{ idx: 0 }, { idx: null }, { guard: true }], true)
  }
  return st
}
const wire = (v) => JSON.parse(JSON.stringify(v))   // サーバーへ送って戻した形
const stateOf = (st) => JSON.stringify({ steps: st.steps, t: st.t, turn: st.turn, over: st.over, winner: st.winner, a: st.a, b: st.b, log: st.log })

test('★ふつうに遊んだ人の結果とサーバーの計算が一致する：全職×ボス2体（勝ち・負け・時間切れ・やめる）', () => {
  const seen = { a: 0, b: 0, draw: 0, stop: 0 }
  CLASSES.forEach((c, i) => {
    BOSSES.forEach((boss, j) => {
      for (const [hp, stopAt, weak] of [[15000, Infinity, false], [1500, Infinity, false], [15000, 900, false], [15000, Infinity, true]]) {
        const t = tryOf(c.id, boss, 1000 + i * 37 + j, hp)
        if (weak) Object.assign(t.snap.prof, { hp: 40, vit: 1, agi: 1 })   // すぐ負ける
        const st = playLikeScreen(t, 7 + i + j * 53, stopAt)
        const v = verifyTry({ ...wire(t), inputs: wire(st.inputs), endStep: st.steps, elapsedSec: st.t + 0.1 })
        assert.deepEqual(v, { damage: damageOf(st), steps: st.steps, winner: st.winner, reason: null }, `${c.id} ${boss} hp${hp}`)
        // 途中の状態まで同じ（ダメージがたまたま同じ、ではない）
        const again = replayInputs(startTryAtb(wire(t)), wire(st.inputs), st.steps)
        assert.equal(stateOf(again), stateOf(st), `${c.id} ${boss} hp${hp} の状態`)
        if (!st.over) seen.stop++
        else seen[st.winner]++
      }
    })
  })
  assert.ok(seen.a > 0 && seen.b > 0 && seen.stop > 0, `いろいろな終わり方を通っている ${JSON.stringify(seen)}`)
})

test('負けなかった挑戦か（ひとりで倒されずに倒したときの報酬の条件）：倒した・時間切れまで立っていた＝負けではない', () => {
  assert.equal(cleanTryOf({ winner: 'a', steps: 700, reason: null }), true)
  assert.equal(cleanTryOf({ winner: 'draw', steps: TRY_STEPS, reason: null }), true, '時間切れは負けではない')
  assert.equal(cleanTryOf({ winner: 'b', steps: 900, reason: null }), false, '倒された')
  assert.equal(cleanTryOf({ winner: 'draw', steps: 900, reason: null }), false, '相打ち')
  assert.equal(cleanTryOf({ winner: null, steps: 900, reason: null }), false, '途中でやめた')
  assert.equal(cleanTryOf({ winner: 'a', steps: 700, reason: 'too_fast' }), false, '記録がおかしい')
})

// 画面が戦闘のたびに読むものを全部読む（舞台の Fighter と戦闘の画面）
const readLikeScreen = (st, need = needShownOf) => {
  for (const s of [st.a, st.b]) { need(s, st.t); buffChips(s, st.t); hpBuffChips(s); ailChips(st, s); stateChips(s) }
  chosenOf(st.a, st.t)
}
const playWithScreen = (t, press, need) => {
  const st = startTryAtb(t)
  const r = seedRng(press)
  startMacro(st, 1, st.a.slots.slice(0, 8).map((_, i) => ({ idx: i })), true)
  while (!st.over) {
    advance(st, 0.006 + r() * 0.03)
    readLikeScreen(st, need)
    if (r() < 0.01) reserve(st, Math.floor(r() * st.a.slots.length))
  }
  return st
}

test('★画面が読むだけでは戦闘が変わらない：ボスの節目と乱数を画面で進めない（2026-11-01 本番で、倒したのにサーバーではHP 57 残った）', () => {
  for (const boss of BOSSES) {
    for (const seed of [11, 12, 13]) {
      const t = tryOf('暗殺者', boss, seed)
      const st = playWithScreen(t, seed)
      const again = replayInputs(startTryAtb(t), wire(st.inputs), st.steps)
      assert.equal(stateOf(again), stateOf(st), `${boss} 種${seed}`)
    }
  }
  // 読み方を前の形（次の行動を決める needNow）に戻すと、ずれる＝このテストが不具合を見つけられる
  const broken = BOSSES.flatMap(boss => [11, 12, 13].map(seed => {
    const t = tryOf('暗殺者', boss, seed)
    const st = playWithScreen(t, seed, needNow)
    return stateOf(replayInputs(startTryAtb(t), wire(st.inputs), st.steps)) !== stateOf(st)
  }))
  assert.ok(broken.some(Boolean), '前の形ならずれる')
  // 舞台と戦闘の画面は、次の行動を決める関数をボスに使わない
  assert.doesNotMatch(read('../components/V2capAtbStage.jsx'), /needNow|chosenOf/)
  assert.match(read('../components/V2capAtbFight.jsx'), /const me = s\.a[\s\S]*chosenOf\(me, now\)/, '戦闘の画面が読むのは自分だけ')
})

test('★180秒の時間切れでも一致する（いちばん長い戦闘）', () => {
  const t = tryOf('聖騎士', 'varuzenoku', 42, 15000)
  // 倒れない・倒しきれない（装備なし・技なし）
  Object.assign(t.snap.prof, { hp: 1000000, vit: 5000, str: 1, int_stat: 1, equipped: {}, learned: [] })
  t.snap.inv = []
  const st = playLikeScreen(t, 3)
  assert.equal(st.steps, TRY_STEPS)
  assert.equal(st.winner, 'draw')
  const v = verifyTry({ ...wire(t), inputs: wire(st.inputs), endStep: st.steps, elapsedSec: DUNGEON_TRY_SEC })
  assert.deepEqual(v, { damage: damageOf(st), steps: TRY_STEPS, winner: 'draw', reason: null })
})

test('★戦闘のあいだ、いまの時刻も Math.random も使わない（使うと画面とサーバーでずれる）', () => {
  const RealDate = Date
  const realRandom = Math.random
  Math.random = () => { throw new Error('Math.random を呼んだ') }
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (!a.length) throw new Error('new Date() を呼んだ'); super(...a) }
    static now() { throw new Error('Date.now を呼んだ') }
  }
  try {
    for (const c of CLASSES.slice(0, 11)) {
      const st = playLikeScreen(tryOf(c.id, 'amaza', 5, 3000), 11)
      assert.ok(st.steps > 0)
    }
  } finally {
    Math.random = realRandom
    globalThis.Date = RealDate
  }
})

test('★前の戦闘の影響が残らない（同じ入れ物で何度も回す＝Vercel の関数は起動したまま次を受ける）', () => {
  const list = CLASSES.slice(0, 12).flatMap((c, i) => BOSSES.map(boss => tryOf(c.id, boss, 500 + i, 4000)))
  const runAll = (ts) => ts.map(t => stateOf(playLikeScreen(t, t.seed)))
  const forward = runAll(list)
  const backward = runAll([...list].reverse()).reverse()
  assert.deepEqual(backward, forward)
})

test('種から作る乱数：同じ種なら同じ列・0以上1未満・種が違えば違う列', () => {
  const a = seedRng(123456789), b = seedRng(123456789), c = seedRng(123456790)
  const xs = Array.from({ length: 2000 }, () => a())
  assert.deepEqual(Array.from({ length: 2000 }, () => b()), xs)
  assert.notDeepEqual(Array.from({ length: 2000 }, () => c()), xs)
  assert.ok(xs.every(x => x >= 0 && x < 1))
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  assert.ok(mean > 0.47 && mean < 0.53, `かたよっていない ${mean}`)
  // 整数の計算だけなので、この値はどの機種でも同じ（式を変えると前の挑戦が回し直せなくなる）
  assert.equal(seedRng(4294967295)(), seedRng(-1)(), '4294967295 と -1 は同じ種')
  assert.equal(seedRng(1)(), 0.6270739405881613)
})

test('食事の残りは、いまの時計でなく挑戦を始めた時刻で決まる', () => {
  const base = { meal_burger: 'str' }
  const on = snapOf('戦士', { ...base, meal_until: AT + 1000 })
  const off = snapOf('戦士', { ...base, meal_until: AT - 1000 })
  const statsOf = (snap) => startTryAtb({ boss: 'amaza', diff: 'normal', hp: 100, seed: 1, snap }).a.base.str
  assert.ok(statsOf(on) > statsOf(off), '始めた時刻に効いていれば、いまが何時でも効く')
})

test('写しに入れない列を戦闘は読まない（読むと SQL の v2cap_dungeon_try_start を直すまでずれる）', () => {
  const sql = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  const dropped = sql.match(/to_jsonb\(p_row\) - array\[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''))
  assert.ok(dropped.includes('materials') && dropped.length >= 5, dropped.join(' '))
  assert.ok(!dropped.some(k => ['class', 'lv', 'jobs', 'learned', 'equipped', 'ascension', 'gender', 'meal_until'].includes(k)), '戦闘に要る列は落とさない')
  const snap = snapOf('戦士')
  const guarded = new Proxy(snap.prof, { get: (o, k) => { if (dropped.includes(k)) throw new Error(`戦闘が ${String(k)} を読んだ`); return o[k] } })
  assert.ok(atbPlayerOf(guarded, snap.inv, { meal: null, at: new Date(AT) }).stats.str > 0)
})

test('★記録の形を見る：おかしな記録ではダメージが入らない', () => {
  const t = tryOf('戦士', 'amaza', 9)
  const ok = { step: 3, k: 'q', idx: 0 }
  const huge = Array.from({ length: INPUTS_MAX + 1 }, () => ({ step: 0, k: 'clr' }))
  for (const [name, inputs] of [
    ['null', null], ['配列でない', { 0: ok }], ['文字', 'x'], ['多すぎる', huge],
    ['知らない種類', [{ step: 0, k: 'win' }]], ['刻みが無い', [{ k: 'q', idx: 0 }]], ['刻みが小数', [{ step: 1.5, k: 'clr' }]],
    ['刻みが負', [{ step: -1, k: 'clr' }]], ['刻みが長すぎる', [{ step: TRY_STEPS + 1, k: 'clr' }]], ['刻みが戻る', [{ step: 5, k: 'clr' }, { step: 4, k: 'clr' }]],
    ['技の番号が文字', [{ step: 0, k: 'q', idx: '__proto__' }]], ['技の番号が負', [{ step: 0, k: 'q', idx: -1 }]], ['外す位置が null', [{ step: 0, k: 'unq', pos: null }]],
    ['マクロが長すぎる', [{ step: 0, k: 'macro', no: 1, steps: Array(9).fill({ idx: 0 }), loop: true }]],
    ['マクロの手がおかしい', [{ step: 0, k: 'macro', no: 1, steps: [{ idx: 'x' }], loop: true }]], ['要素が null', [null]],
    ['知らない薬', [{ step: 0, k: 'item', item: 'elixir' }]], ['薬の名前が __proto__', [{ step: 0, k: 'item', item: '__proto__' }]], ['薬の名前が無い', [{ step: 0, k: 'item' }]],
  ]) {
    assert.equal(validInputs(inputs), false, name)
    assert.deepEqual(verifyTry({ ...t, inputs, endStep: 100, elapsedSec: 100 }), { damage: 0, steps: 0, winner: null, reason: 'inputs' }, name)
  }
  assert.ok(validInputs([ok, { step: 3, k: 'guard', on: true }, { step: 9, k: 'macro', no: 2, steps: [{ guard: true }, { idx: null }, { idx: 1 }], loop: true }, { step: 9, k: 'stop' }]))
  assert.ok(validInputs([]), '押さなくてもよい（通常攻撃だけ）')
})

test('★押した記録の種類を増やしたら、回し直しと形の見張りにも足す（足さないと、ふつうの人の挑戦のダメージが0になる）', () => {
  const atb = read('../core/atb.js')
  const kinds = [...atb.matchAll(/input\(st, \{ k: '(\w+)'/g)].map(m => m[1])
  assert.deepEqual(kinds, ['q', 'unq', 'clr', 'macro', 'stop', 'guard', 'item'])
  const samples = { q: { idx: 0 }, unq: { pos: 0 }, clr: {}, macro: { no: 1, steps: [], loop: true }, stop: {}, guard: { on: true }, item: { item: 'hp' } }
  for (const k of kinds) {
    assert.ok(atb.includes(`e.k === '${k}'`), `applyInput が ${k} を入れ直す`)
    assert.ok(validInputs([{ step: 0, k, ...samples[k] }]), `validInputs が ${k} を通す`)
  }
})

test('★実時間より先へは進まない：すぐ送ってきても、そのぶんの時間しか回さない', () => {
  assert.equal(allowedSteps(0), Math.floor(TIME_SLACK_SEC / STEP_SEC))
  assert.equal(allowedSteps(10), Math.floor((10 + TIME_SLACK_SEC) / STEP_SEC))
  assert.equal(allowedSteps(100000), TRY_STEPS, '180秒より先はない')
  assert.equal(allowedSteps(null), Math.floor(TIME_SLACK_SEC / STEP_SEC))
  const t = tryOf('戦士', 'amaza', 77, 15000)
  const st = playLikeScreen(t, 12)
  assert.ok(st.steps > 400, `十分長い戦闘（${st.steps}刻み）`)
  const fast = verifyTry({ ...wire(t), inputs: wire(st.inputs), endStep: st.steps, elapsedSec: 1 })
  assert.equal(fast.reason, 'too_fast')
  assert.equal(fast.steps, allowedSteps(1))
  assert.ok(fast.damage < damageOf(st), `短い時間のぶんだけ：${fast.damage} < ${damageOf(st)}`)
  // 終わりの刻みがおかしければ、はじめの形のまま
  for (const endStep of [null, -5, 1.5, 'x']) assert.equal(verifyTry({ ...t, inputs: [], endStep, elapsedSec: 100 }).steps, 0, String(endStep))
})

// ===== 関数の中身（DB の代わりをつなぐ）=====
const fakeDb = (loaded) => {
  const calls = []
  const fetchFn = async (url, init) => {
    const fn = url.split('/rpc/')[1]
    const args = JSON.parse(init.body)
    calls.push({ fn, args, headers: init.headers, url })
    const out = fn === 'v2cap_dungeon_verify_load' ? loaded : { ok: true, damage: args.p_damage, reward: null, corrected: false }
    return new Response(JSON.stringify(out), { status: 200 })
  }
  return { calls, fetchFn }
}
const PLAYER = '11111111-1111-1111-1111-111111111111'
const req = (over = {}) => ({ body: { run: 12, player: PLAYER }, secret: 'あいことば', sha: 'abc', ...over })
const loadedOf = (t, st, over = {}) => wire({ ok: true, boss: t.boss, diff: t.diff, hp: t.hp, seed: t.seed, snap: t.snap, try: 2, inputs: st.inputs, end_step: st.steps, elapsed_sec: st.t + 1, ...over })

test('★書き換えた申告では増えない：入れるのはサーバーの計算だけ（画面から何を送っても）', async () => {
  const t = tryOf('戦士', 'amaza', 21, 15000)
  const st = playLikeScreen(t, 5, 600)   // 倒していない（600刻みでやめた）
  assert.ok(st.b.hp > 0 && !st.over)
  const db = fakeDb(loadedOf(t, st))
  // 画面が頼みに何を混ぜても見ない
  const r = await verifyRequest(req({ fetchFn: db.fetchFn, body: { run: 12, player: PLAYER, damage: 999999, p_damage: 999999, claim: 999999, won: true, hp: 1 } }))
  assert.equal(r.status, 200)
  const settle = db.calls.find(c => c.fn === 'v2cap_dungeon_verify_settle')
  assert.deepEqual(settle.args, { p_secret: 'あいことば', p_run: 12, p_player: PLAYER, p_try: 2, p_damage: damageOf(st), p_clean: false, p_reason: null })
  assert.ok(settle.args.p_damage < 15000, 'ボスは倒れない')
})

// ===== 薬（2026-11-01 ユーザー「挑戦とかで使用できるアイテムもここで販売してほしい」）=====
const itemTryOf = (seed, items, loadout = { hp: 2, mp: 1, cure: 1 }) => { const t = tryOf('戦士', 'amaza', seed, 15000); t.snap.prof.items = items; t.snap.prof.item_loadout = loadout; return t }
// 画面と同じように進めて、HPが減ったら飲む
const playDrinking = (t, press, stopAt = 1200) => {
  const st = startTryAtb(t)
  const r = seedRng(press)
  startMacro(st, 1, st.a.slots.slice(0, 8).map((_, i) => ({ idx: i })), true)
  while (!st.over && st.steps < stopAt) {
    advance(st, 0.006 + r() * 0.03)
    if (st.a.hp < st.a.base.hp * 0.7) drinkItem(st, 'hp')
    if (st.a.mp < st.a.base.mp * 0.7) drinkItem(st, 'mp')
    if (Object.keys(st.a.ail).length) drinkItem(st, 'cure')
  }
  return st
}

test('★薬を飲んだ挑戦もサーバーの回し直しと同じになる・飲んだ数はサーバーが数える', () => {
  const seen = { hp: 0, mp: 0, cure: 0 }
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const t = itemTryOf(seed, { hp: 5, mp: 5, cure: 5 })
    const st = playDrinking(t, seed)
    for (const k of Object.keys(seen)) seen[k] += st.a.itemsUsed[k] || 0
    const v = verifyTry({ ...wire(t), inputs: wire(st.inputs), endStep: st.steps, elapsedSec: st.t + 0.1 })
    assert.deepEqual(v.items, st.a.itemsUsed, `種${seed}`)
    assert.equal(v.damage, damageOf(st), `種${seed}`)
    assert.equal(stateOf(replayInputs(startTryAtb(wire(t)), wire(st.inputs), st.steps)), stateOf(st), `種${seed} の状態`)
  }
  assert.ok(seen.hp > 0 && seen.mp > 0, `飲んでいる ${JSON.stringify(seen)}`)
})

test('★持っていない薬は記録を書き換えても飲めない（飲んだ数にも入らない）', () => {
  const inputs = [100, 800, 1500, 2200].map(step => ({ step, k: 'item', item: 'hp' }))
  // 飲む前にHPが減るように、守りを下げて戦う
  const low = (items, loadout) => { const t = itemTryOf(51, items, loadout); Object.assign(t.snap.prof, { hp: 800, vit: 1, agi: 1 }); return t }
  const none = verifyTry({ ...wire(low({})), inputs, endStep: 2400, elapsedSec: 200 })
  assert.equal(none.items, undefined, '1つも持っていない')
  const two = verifyTry({ ...wire(low({ hp: 2 })), inputs, endStep: 2400, elapsedSec: 200 })
  assert.ok((two.items?.hp || 0) <= 2, JSON.stringify(two.items))
  // 持ち込んだ数を超えて飲めない（持ち物にはたくさんあっても）・選んでいなければ飲めない
  const one = verifyTry({ ...wire(low({ hp: 9 }, { hp: 1 })), inputs, endStep: 2400, elapsedSec: 200 })
  assert.ok((one.items?.hp || 0) <= 1, JSON.stringify(one.items))
  const zero = verifyTry({ ...wire(low({ hp: 9 }, {})), inputs, endStep: 2400, elapsedSec: 200 })
  assert.equal(zero.items, undefined, '選んでいない')
  // 写しに items が無い（SQL を流す前に始めた挑戦）
  const old = tryOf('戦士', 'amaza', 51, 15000)
  assert.equal(startTryAtb(old).a.items, null, '薬のボタンを出さない')
  assert.equal(verifyTry({ ...wire(old), inputs, endStep: 600, elapsedSec: 60 }).items, undefined)
})

test('★関数：飲んだ薬は回し直しの結果を送る・飲まなければ送らない（薬の SQL を流す前のサーバーでも通る）', async () => {
  const t = itemTryOf(61, { hp: 5, mp: 5, cure: 5 })
  const st = playDrinking(t, 61)
  assert.ok(Object.keys(st.a.itemsUsed).length > 0, '飲んでいる')
  const db = fakeDb(loadedOf(t, st))
  await verifyRequest(req({ fetchFn: db.fetchFn, body: { run: 12, player: PLAYER, p_items: { hp: 0 }, items: { hp: 0 } } }))
  assert.deepEqual(db.calls.find(c => c.fn === 'v2cap_dungeon_verify_settle').args.p_items, st.a.itemsUsed, '画面が混ぜたものは見ない')
  const none = tryOf('戦士', 'amaza', 62, 15000)
  const db2 = fakeDb(loadedOf(none, playLikeScreen(none, 62, 300)))
  await verifyRequest(req({ fetchFn: db2.fetchFn }))
  assert.ok(!('p_items' in db2.calls.find(c => c.fn === 'v2cap_dungeon_verify_settle').args))
})

test('★記録を書き換えても、できるのは本当に押せることだけ（技を連打しても行動の回数は増えない）', () => {
  const t = tryOf('戦士', 'amaza', 31, 15000)
  const st = playLikeScreen(t, 6, 600)
  // 毎刻み技を押した形に書き換える。ゲージが溜まるまで行動できないので、桁は変わらない
  const spam = Array.from({ length: 600 }, (_, i) => ({ step: i, k: 'q', idx: 0 }))
  const v = verifyTry({ ...wire(t), inputs: spam, endStep: 600, elapsedSec: 60 })
  assert.equal(v.reason, null)
  assert.ok(v.damage < damageOf(st) * 3 && v.damage < 15000, `連打：${v.damage}・ふつう：${damageOf(st)}`)
})

test('関数：もう入れた挑戦は入れ直さない・合い言葉が違えば何もしない・頼みの形がおかしければ DB を呼ばない', async () => {
  const done = fakeDb({ ok: true, done: true, damage: 5, reward: null, corrected: false, run: { id: 12 } })
  const r1 = await verifyRequest(req({ fetchFn: done.fetchFn }))
  assert.deepEqual(r1, { status: 200, body: { ok: true, done: true, damage: 5, reward: null, corrected: false, run: { id: 12 } } })
  assert.deepEqual(done.calls.map(c => c.fn), ['v2cap_dungeon_verify_load'], '回し直さない')

  const wrong = fakeDb({ ok: false, error: '合い言葉が違います' })
  const r2 = await verifyRequest(req({ fetchFn: wrong.fetchFn }))
  assert.equal(r2.body.ok, false)
  assert.deepEqual(wrong.calls.map(c => c.fn), ['v2cap_dungeon_verify_load'], '入れない')

  const none = fakeDb({})
  for (const body of [{}, null, { run: 'x', player: PLAYER }, { run: 1.5, player: PLAYER }, { run: 1 }, { run: 1, player: "1' or 1=1" }]) {
    assert.equal((await verifyRequest(req({ fetchFn: none.fetchFn, body }))).status, 400, JSON.stringify(body))
  }
  assert.equal((await verifyRequest(req({ fetchFn: none.fetchFn, secret: '' }))).status, 500, '合い言葉の設定が無い')
  assert.equal(none.calls.length, 0)

  // 公開の鍵で呼ぶ（強い鍵は Vercel に置かない）
  assert.equal(wrong.calls[0].headers.apikey, SUPABASE_KEY)
  assert.ok(wrong.calls[0].url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`))

  // DB がエラーなら 500＝画面が聞き直す（記録はサーバーに残っている）
  const errLog = console.error
  console.error = () => {}
  try {
    const broke = await verifyRequest(req({ fetchFn: async () => new Response('x', { status: 503 }) }))
    assert.equal(broke.status, 500)
    assert.equal(broke.body.ok, false)
  } finally {
    console.error = errLog
  }
})

test('関数：ping は版を答える（画面が古くないかを見る）', async () => {
  assert.deepEqual(await verifyRequest(req({ body: { ping: true }, fetchFn: () => { throw new Error('DB を呼ばない') } })), { status: 200, body: { ok: true, sha: 'abc' } })
})

test('関数の入口（api/v2cap-dungeon-verify.js）：POST だけ・OPTIONS に答える・形の悪い JSON で落ちない', async () => {
  const call = async (r) => {
    const out = { headers: {} }
    const res = {
      setHeader: (k, v) => { out.headers[k] = v },
      status: (s) => { out.status = s; return res },
      json: (b) => { out.body = b; return res },
      end: () => res,
    }
    await handler(r, res)
    return out
  }
  assert.equal((await call({ method: 'OPTIONS' })).status, 204)
  assert.equal((await call({ method: 'GET' })).status, 405)
  const ping = await call({ method: 'POST', body: { ping: true } })
  assert.equal(ping.status, 200)
  assert.equal(ping.body.ok, true)
  assert.equal(ping.headers['Cache-Control'], 'no-store')
  assert.equal((await call({ method: 'POST', get body() { throw new Error('形の悪い JSON') } })).status, 400)
})

test('画面から呼ぶ：通信が切れたら聞き直す・本番の関数がエラーなら聞き直す・返事が来たらそれを返す', async () => {
  const noWait = async () => {}
  let n = 0
  const flaky = async () => {
    n++
    if (n === 1) throw new Error('切れた')
    if (n === 2) return new Response('{}', { status: 502 })
    return new Response(JSON.stringify({ ok: true, damage: 3 }), { status: 200 })
  }
  assert.deepEqual(await callVerify({ run: 1, player: 'p' }, { fetchFn: flaky, wait: noWait }), { ok: true, damage: 3 })
  assert.equal(n, 3)
  // 届かなければ null（入口でもう一度）
  n = 0
  const down = async () => { n++; throw new Error('切れた') }
  assert.equal(await callVerify({ run: 1, player: 'p' }, { fetchFn: down, wait: noWait, retryMs: [1, 1] }), null)
  assert.equal(n, 3)
  // 4xx は聞き直さない
  n = 0
  const bad = async () => { n++; return new Response(JSON.stringify({ ok: false, error: 'x' }), { status: 400 }) }
  assert.deepEqual(await callVerify({ run: 1, player: 'p' }, { fetchFn: bad, wait: noWait }), { ok: false, error: 'x' })
  assert.equal(n, 1)
  // 本番は同じサイト・手元の開発は本番の関数
  assert.equal(verifyUrlOf('battle-frontier-six.vercel.app'), '/api/v2cap-dungeon-verify')
  assert.equal(verifyUrlOf('localhost'), `${PROD_ORIGIN}/api/v2cap-dungeon-verify`)
})

test('画面が古いか：違うコミットなら読み直してもらう・同じなら通す・分からなければ止めない', async () => {
  const reply = (sha) => async () => new Response(JSON.stringify({ ok: true, sha }), { status: 200 })
  assert.equal(await isStaleBuild({ sha: 'aaa', fetchFn: reply('bbb') }), true)
  assert.equal(await isStaleBuild({ sha: 'aaa', fetchFn: reply('aaa') }), false)
  assert.equal(await isStaleBuild({ sha: 'aaa', fetchFn: reply('') }), false, '関数の版が分からない')
  assert.equal(await isStaleBuild({ sha: '', fetchFn: reply('bbb') }), false, '手元の開発')
  assert.equal(await isStaleBuild({ sha: 'aaa', fetchFn: async () => { throw new Error('切れた') } }), false, '届かなければ止めない')
})

test('置き場所の決まり：/api を画面へ回さない・api/ にテストを置かない・公開の鍵は src/supabase.js と同じ・POST はサービスワーカーが触らない', () => {
  const root = new URL('../../../', import.meta.url)
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'))
  const source = vercel.rewrites[0].source
  assert.ok(!new RegExp(`^${source}$`).test('/api/v2cap-dungeon-verify'), '/api は index.html へ回さない')
  assert.ok(new RegExp(`^${source}$`).test('/v2cap'), '画面の道はそのまま')
  assert.deepEqual(readdirSync(new URL('api/', root)).sort(), ['v2cap-dungeon-verify.js', 'v2cap-sortie.js'], 'api/ の下は全部 Vercel の関数になる')
  const client = readFileSync(new URL('src/supabase.js', root), 'utf8')
  assert.ok(client.includes(`'${SUPABASE_URL}'`) && client.includes(`'${SUPABASE_KEY}'`))
  assert.match(readFileSync(new URL('public/sw.js', root), 'utf8'), /if \(req\.method !== 'GET'\) return/)
  assert.match(readFileSync(new URL('vite.config.js', root), 'utf8'), /__BUILD_SHA__: JSON\.stringify\(process\.env\.VERCEL_GIT_COMMIT_SHA \|\| ''\)/)
})

test('★回し直しが読むコード：画面の部品を読まない（Vercel で動く）・機種で結果が変わる計算を増やさない', () => {
  const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const seen = new Set()
  const walk = (f) => {
    if (seen.has(f)) return
    seen.add(f)
    const src = readFileSync(path.join(ROOT, f), 'utf8')
    for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])))
  }
  walk('api/v2cap-dungeon-verify.js')
  walk('api/v2cap-sortie.js')
  const files = [...seen]
  assert.ok(files.includes('src/v2cap/core/atb.js') && files.includes('src/v2cap/core/battle.js'))
  assert.ok(files.every(f => f.endsWith('.js')), `画面の部品を読んでいない：${files.filter(f => !f.endsWith('.js'))}`)
  // 小数の累乗や三角関数は機種で最後の桁が変わることがある（足し算・掛け算・平方根・四捨五入は変わらない）
  const FLOAT = /Math\.(pow|exp|log|log2|log10|sin|cos|tan|atan|atan2|asin|acos|cbrt|hypot|expm1|log1p|sinh|cosh|tanh)\b|[^*/]\*\*[^*/]/
  const BROWSER = /import\.meta\.env|\bdocument\.|\bwindow\.|\blocalStorage\b/
  // いまあるもの。戦闘で通るのは上の2つで、どちらも結果に効かない（回避率は0.1%単位に丸める・0.8の累乗は乱数と比べるだけ＝最後の桁が変わっても当たり外れはまず変わらない。変わってもサーバーの計算が入る）
  const KNOWN = {
    'src/v2cap/core/combat.js': 1, 'src/v2cap/core/ailments.js': 1,
    'src/v2cap/core/equipment.js': 1, 'src/v2cap/core/material.js': 2, 'src/v2cap/lib/classArt.js': 1,   // 戦闘では通らない
  }
  const found = {}
  for (const f of files) {
    for (const line of readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
      const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'|`[^`]*`/g, "''")
      if (FLOAT.test(code)) found[f] = (found[f] || 0) + 1
      assert.ok(!BROWSER.test(code), `${f}：${line.trim().slice(0, 80)}`)
    }
  }
  assert.deepEqual(found, KNOWN, '戦闘で通るなら、丸めるか掛け算で書く')
  assert.equal(diffOf('varuzenoku', 'hard').hp, 30000)
})
