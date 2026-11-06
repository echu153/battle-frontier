// v2cap 修練場の案山子のテスト（node --test）
//   ★案山子は動かない・60秒で終わる／ふつうに遊んだ結果がサーバーの回し直しと同じ／書き換えた申告や先走りでは増えない／
//     EXPの式と数がSQLと同じ／目安の表が全部の職にある／メニュー・テロップ・画面の決まり、を見張る。
//   SQL まで通した確かめは v2cap-tools/scarecrow-1106/pg-check.mjs（PGlite・1日1回・EXP・権限・遅れた記録）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advance, createAtb, reserve, seedRng, startMacro, toggleGuard } from '../core/atb.js'
import { AIL_KEYS, hasAilment } from '../core/ailments.js'
import { atbPlayerOf } from './atbPlayer.js'
import { CLASSES, canEquipType } from './jobs.js'
import { ITEMS, itemIdOf } from './equipment.js'
import { SKILLS } from './skills.js'
import { tenSortieExpOf } from './areas.js'
import { allowedSteps } from './dungeonVerify.js'
import { verifyRequest } from './dungeonVerifyApi.js'
import { endTelopOf } from './atbTelop.js'
import { wobbleOf, WOBBLE_SEC } from './atbFx.js'
import {
  SCARECROW_SEC, SCARECROW_STEPS, SCARECROW_UNLOCK_SPOT, SCARECROW_EXP_SORTIES, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX, SCARECROW_HP,
  isScarecrowOpen, scarecrowFighter, startScarecrowAtb, scarecrowDamageOf, stdDamageOf, scarecrowPctOf, scarecrowExpOf, verifyScarecrow,
  scarecrowPowerOf, SCARECROW_MAX_LV,
} from './scarecrow.js'
import { SCARECROW_STD } from './scarecrowStd.js'
import { scarecrowArtOf, SCARECROW_TEMP_SRC } from './scarecrowArt.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const sec29 = SQL.slice(SQL.indexOf('===== 29. 修練場の案山子'))
const fnOf = (name) => { const i = sec29.indexOf(`function public.${name}(`); assert.ok(i >= 0, `${name} が無い`); return sec29.slice(i, sec29.indexOf('\n$$;', i)) }
const AT = Date.UTC(2026, 10, 6, 3, 0, 0)
const LEARNED = SKILLS.map(s => s.name)
const RARE = (cls) => ITEMS.find(i => i.part === '武器' && i.area === 2 && i.rarity === 'R' && canEquipType(cls, i.type))
// サーバーの写しと同じ形（JSON を通した { prof, inv, at }）。7枠を着けた LV25 のキャラ
const snapOf = (cls, over = {}) => {
  const ids = {
    weapon: RARE(cls).id, head: itemIdOf(2, 'R', '重鎧頭'), body: itemIdOf(2, 'R', '重鎧鎧'), arm: itemIdOf(2, 'R', '軽装腕'), foot: itemIdOf(2, 'R', '軽装足'),
    acc1: itemIdOf(2, 'R', 'リング'), acc2: itemIdOf(2, 'R', 'イヤリング'),
  }
  const slots = Object.keys(ids)
  return JSON.parse(JSON.stringify({
    prof: {
      id: '11111111-1111-1111-1111-111111111111', username: 'てすと', class: cls, lv: 25,
      hp: 300, mp: 60, str: 70, dex: 60, agi: 60, int_stat: 70, vit: 60, luk: 30,
      jobs: { [cls]: { lv: 30, exp: 0 } }, learned: LEARNED, skill_sets: {}, ascension: {}, gender: 'm', cleared_spots: [1, 2, 3],
      equipped: Object.fromEntries(slots.map((s, i) => [s, i + 1])), meal_burger: null, meal_major: null, meal_minor: null, meal_until: null,
      ...over,
    },
    inv: slots.map((s, i) => ({ id: i + 1, base_id: ids[s], ilv: 20, plus: 3, shinka: null })),
    at: AT,
  }))
}
// 画面と同じ遊び方：実時間の差分（ばらばら）で進め、そのあいだにボタンを押す
const playLikeScreen = (t, press) => {
  const st = startScarecrowAtb(t)
  const r = seedRng(press)
  startMacro(st, 1, st.a.slots.slice(0, 8).map((_, i) => ({ idx: i })), true)
  while (!st.over) {
    advance(st, 0.006 + r() * 0.03)
    const p = r()
    if (p < 0.01) reserve(st, Math.floor(r() * st.a.slots.length))
    else if (p < 0.012) reserve(st, null)
    else if (p < 0.013) toggleGuard(st)
  }
  return st
}

test('【確定】2026-11-06 案山子は動かない（反撃しない）・60秒で「どちらも立ったまま」終わる・倒れない', () => {
  for (const cls of ['戦士', '魔法使い', '僧侶', '侍', '元素使い']) {
    const t = { seed: 7, snap: snapOf(cls) }
    const st = playLikeScreen(t, 3)
    assert.ok(st.over && st.winner === 'draw', `${cls}：60秒で終わる`)
    assert.equal(st.steps, SCARECROW_STEPS)
    assert.ok(Math.abs(st.t - SCARECROW_SEC) < 1e-9)
    const acts = st.log.filter(l => l.side === st.b.name && ['attack', 'skill', 'cast', 'guard'].includes(l.type))
    assert.equal(acts.length, 0, `${cls}：案山子は一度も動かない`)
    assert.equal(st.a.hp, st.a.base.hp, `${cls}：自分は一度も削られない`)
    assert.ok(st.b.hp > 0 && scarecrowDamageOf(st) > 0 && scarecrowDamageOf(st) < SCARECROW_HP, `${cls}：削れるが倒れない`)
  }
})

test('案山子の強さは写したときのLVで決まる（LVが上がるほど硬い）・攻めのステは使わない', () => {
  const a = scarecrowFighter(18), b = scarecrowFighter(60)
  assert.ok(b.stats.vit > a.stats.vit && b.stats.int_stat > a.stats.int_stat)
  assert.equal(a.stats.hp, SCARECROW_HP)
  assert.equal(a.idle, true)
  assert.deepEqual(a.slots, [])
  assert.ok(a.stats.agi < a.stats.vit, '避けにくい（AGI は小さく）')
})

test('【確定】2026-11-06 案山子は状態異常にかからない（ユーザー「案山子は状態異常かからないように」）・ログは種類ごとに1回だけ', () => {
  assert.equal(scarecrowFighter(25).noAil, true)
  let blocked = 0
  for (const cls of ['盗賊', '呪術師', '薬師', '暗殺者', '霊薬師', '忍者']) {
    const snap = snapOf(cls)
    const play = (noAil) => {
      const me = atbPlayerOf(snap.prof, snap.inv, { at: new Date(AT) })
      const st = createAtb(me, { ...scarecrowFighter(25), noAil }, { maxSec: SCARECROW_SEC, rng: seedRng(11) })
      startMacro(st, 1, st.a.slots.map((_, i) => ({ idx: i })), true)
      let got = false
      while (!st.over) { advance(st, 0.05); if (AIL_KEYS.some(k => hasAilment(st.b.ail, k))) got = true }
      return { st, got }
    }
    const on = play(true)
    assert.equal(on.got, false, `${cls}：案山子に状態異常が一度も入らない`)
    assert.equal(on.st.log.filter(l => l.side === on.st.b.name && l.type === 'ailTick').length, 0, `${cls}：持続ダメージも刻まない`)
    const im = on.st.log.filter(l => l.side === on.st.b.name && l.type === 'immune').map(l => l.ail)
    assert.equal(new Set(im).size, im.length, `${cls}：「〜にならない」は種類ごとに1回だけ`)
    // 確かめが空振りしていない：印が無ければ同じ遊び方で状態異常が入る職がある
    if (play(false).got) blocked++
  }
  assert.ok(blocked >= 3, `状態異常を使う職で、印が無ければ入る（${blocked}職）`)
})

test('ふつうに遊んだ結果は、サーバーの回し直しと同じ（与えたダメージ・割合）', () => {
  for (const [i, cls] of ['戦士', '弓使い', '呪術師', '狂戦士', '霊薬師'].entries()) {
    const t = { seed: 100 + i, snap: snapOf(cls) }
    const st = playLikeScreen(t, 11 + i)
    const v = verifyScarecrow({ ...t, inputs: st.inputs, endStep: st.steps, elapsedSec: SCARECROW_SEC + 3 })
    assert.equal(v.reason, null, cls)
    assert.equal(v.damage, scarecrowDamageOf(st), `${cls}：回し直しても同じダメージ`)
    assert.equal(v.pct, scarecrowPctOf(scarecrowDamageOf(st), cls, 25))
  }
})

test('書き換えた記録では増えない：実時間より先の刻み・60秒より先・おかしな形', () => {
  const t = { seed: 9, snap: snapOf('戦士') }
  const st = playLikeScreen(t, 5)
  const fast = verifyScarecrow({ ...t, inputs: st.inputs, endStep: st.steps, elapsedSec: 10 })
  assert.equal(fast.reason, 'too_fast')
  assert.ok(fast.steps <= allowedSteps(10) && fast.damage < scarecrowDamageOf(st), '実時間のぶんしか回さない')
  const long = verifyScarecrow({ ...t, inputs: st.inputs, endStep: SCARECROW_STEPS * 5, elapsedSec: 9999 })
  assert.equal(long.steps, SCARECROW_STEPS, '60秒より先へは進まない')
  assert.equal(long.damage, scarecrowDamageOf(st))
  const bad = verifyScarecrow({ ...t, inputs: [{ step: 5, k: 'hack' }], endStep: st.steps, elapsedSec: 99 })
  assert.equal(bad.reason, 'inputs')
  assert.equal(bad.damage, 0)
  assert.equal(bad.pct, SCARECROW_PCT_MIN)
})

test('【確定】EXP＝推奨の場所で30回出撃したくらい × 与えたダメージの割合（目安どおり100%・50〜150%）', () => {
  for (const lv of [1, 14, 18, 25, 45, 80, 100]) {
    assert.equal(scarecrowExpOf(lv, 100), tenSortieExpOf(lv) * 3, `LV${lv}：目安どおりで出撃30回ぶん`)
    assert.ok(scarecrowExpOf(lv, 150) <= Math.ceil(tenSortieExpOf(lv) * 4.5))
    assert.ok(scarecrowExpOf(lv, 50) >= Math.floor(tenSortieExpOf(lv) * 1.5))
  }
  assert.equal(SCARECROW_EXP_SORTIES, 30)
  for (const cls of ['戦士', '侍', '聖職者']) {
    const d = stdDamageOf(cls, 30)
    assert.equal(scarecrowPctOf(d, cls, 30), 100, `${cls}：目安と同じで100%`)
    assert.equal(scarecrowPctOf(d * 10, cls, 30), SCARECROW_PCT_MAX)
    assert.equal(scarecrowPctOf(0, cls, 30), SCARECROW_PCT_MIN)
    assert.equal(scarecrowPctOf(Math.round(d * 1.2), cls, 30), 120)
  }
})

test('目安の表：全部の職にあり・LVが上がるほど目安のダメージも増える', () => {
  for (const c of CLASSES) assert.ok(SCARECROW_STD.cls[c.id] > 0, `${c.id} の係数が無い（v2cap-tools/scarecrow-1106/measure.mjs で測る）`)
  assert.ok(SCARECROW_STD.a > 0 && SCARECROW_STD.b > 0, '曲線（a×案山子の守りの戦闘力^b）')
  // LVごとの整数の表は曲線と同じ（案山子の強さ＝敵の強さの決まりを直したら、表が古くなる＝fit.mjs --write で貼り直す）
  assert.equal(SCARECROW_STD.std.length, SCARECROW_MAX_LV)
  for (let lv = 1; lv <= SCARECROW_MAX_LV; lv++) {
    assert.equal(SCARECROW_STD.std[lv - 1], Math.round(SCARECROW_STD.a * scarecrowPowerOf(lv) ** SCARECROW_STD.b), `LV${lv} の表が曲線と違う（v2cap-tools/scarecrow-1106/fit.mjs --write）`)
  }
  assert.equal(stdDamageOf('ないしょく', 30), SCARECROW_STD.std[29], '表に無い職は係数1')
  assert.equal(stdDamageOf('戦士', 999), stdDamageOf('戦士', SCARECROW_MAX_LV), 'LV100より上は100')
  // 職の係数は全職のまんなかが1のあたり（極端な数にしない＝測り直したときに崩れていたら気づく）
  const ks = Object.values(SCARECROW_STD.cls).sort((x, y) => x - y)
  assert.ok(ks[0] > 0.3 && ks.at(-1) < 2 && Math.abs(ks[Math.floor(ks.length / 2)] - 1) < 0.15, `係数 ${ks[0]}〜${ks.at(-1)}`)
  for (const cls of ['戦士', '侍', '元素使い', '聖騎士']) {
    let prev = 0
    for (let lv = 10; lv <= 100; lv += 5) { const d = stdDamageOf(cls, lv); assert.ok(d > prev, `${cls} LV${lv}`); prev = d }
  }
})

test('【確定】エリア①をクリア（①-③のボスを倒した）すると開く', () => {
  assert.equal(SCARECROW_UNLOCK_SPOT, 3)
  assert.equal(isScarecrowOpen([]), false)
  assert.equal(isScarecrowOpen([1, 2]), false)
  assert.equal(isScarecrowOpen([1, 2, 3]), true)
  assert.equal(isScarecrowOpen(null), false)
})

test('SQL §29 の数は JS と同じ（解禁の場所・60秒・EXPの式・割合・記録の上限）', () => {
  assert.ok(fnOf('v2cap_scarecrow_state').includes(`c_unlock constant int := ${SCARECROW_UNLOCK_SPOT};`))
  assert.ok(fnOf('v2cap_scarecrow_start').includes(`c_unlock constant int := ${SCARECROW_UNLOCK_SPOT};`))
  assert.ok(fnOf('v2cap_scarecrow_end').includes(`c_steps        constant int := ${SCARECROW_STEPS};`))
  assert.ok(fnOf('v2cap_scarecrow_end').includes('c_inputs_max   constant int := 5000;'))
  assert.ok(fnOf('v2cap_scarecrow_exp').includes(`* ${SCARECROW_EXP_SORTIES / 10} * greatest(${SCARECROW_PCT_MIN}, least(${SCARECROW_PCT_MAX},`))
  assert.ok(fnOf('v2cap_scarecrow_verify_settle').includes(`v_pct := greatest(${SCARECROW_PCT_MIN}, least(${SCARECROW_PCT_MAX}, coalesce(p_pct, ${SCARECROW_PCT_MIN})));`))
  // 1日1回（挑戦と同じ朝5時）・ログインした人は結果を入れられない
  assert.ok(sec29.includes('unique (player_id, day)'))
  assert.ok(fnOf('v2cap_scarecrow_start').includes('day = public.v2cap_dungeon_today()'))
  assert.ok(sec29.includes('revoke all on function public.v2cap_scarecrow_verify_settle(text, bigint, uuid, int, int, text) from public, authenticated;'))
  assert.ok(sec29.includes('revoke all on function public.v2cap_scarecrow_verify_load(text, bigint, uuid) from public, authenticated;'))
  // 遅れた記録の長さは画面と同じ（画面はこれを過ぎた「修練中」を確かめ直す）
  const late = Number(fnOf('v2cap_scarecrow_end').match(/c_late_min\s+constant int := (\d+);/)[1])
  assert.ok(read('../components/V2capTraining.jsx').includes(`const LATE_MS = ${late} * 60 * 1000`))
  // 差分のファイル（ユーザーが流す）があれば中身は全文の §29 と同じ
  let delta = null
  try { delta = read('../../../v2cap_scarecrow_20261106.sql') } catch { /* git に入れないファイル＝別の作業場所には無い */ }
  if (delta) assert.ok(delta.includes(sec29.slice(0, sec29.length - 1)), '差分のファイルと全文の §29 が同じ')
})

test('Vercel の関数：kind:scarecrow は案山子を読んで回し直して入れる（挑戦の関数を増やさない）', async () => {
  const snap = snapOf('戦士')
  const st = playLikeScreen({ seed: 42, snap }, 7)
  const calls = []
  const fetchFn = async (url, init) => {
    const fn = url.split('/rpc/')[1], body = JSON.parse(init.body)
    calls.push({ fn, body })
    if (fn === 'v2cap_scarecrow_verify_load') return { ok: true, json: async () => ({ ok: true, seed: 42, snap, inputs: st.inputs, end_step: st.steps, elapsed_sec: 65 }) }
    if (fn === 'v2cap_scarecrow_verify_settle') return { ok: true, json: async () => ({ ok: true, damage: body.p_damage, pct: body.p_pct }) }
    throw new Error('知らない関数 ' + fn)
  }
  const player = '11111111-1111-1111-1111-111111111111'
  const r = await verifyRequest({ body: { kind: 'scarecrow', id: 5, player }, secret: 's', fetchFn })
  assert.equal(r.status, 200)
  assert.deepEqual(calls.map(c => c.fn), ['v2cap_scarecrow_verify_load', 'v2cap_scarecrow_verify_settle'])
  assert.equal(calls[1].body.p_damage, scarecrowDamageOf(st))
  assert.equal(calls[1].body.p_pct, scarecrowPctOf(scarecrowDamageOf(st), '戦士', 25))
  assert.equal(calls[1].body.p_reason, null)
  assert.equal((await verifyRequest({ body: { kind: 'scarecrow', id: 'x', player }, secret: 's', fetchFn })).status, 400)
  assert.equal((await verifyRequest({ body: { kind: 'scarecrow', id: 5, player }, secret: '', fetchFn })).status, 500)
})

test('60秒なぐりきったら「修練終了」のテロップ（四凶の「時間切れ」は変えない）・揺れは傾いて戻る', () => {
  const st = playLikeScreen({ seed: 1, snap: snapOf('戦士') }, 1)
  assert.equal(endTelopOf(st, [], 1000, scarecrowArtOf()).kind, 'train')
  assert.equal(endTelopOf(st, [], 1000, null).kind, 'timeup')
  assert.equal(wobbleOf(0), 0)
  assert.ok(wobbleOf(0.07) > 4 && wobbleOf(0.07, true) > wobbleOf(0.07), '当たってすぐ傾く（クリティカルは大きく）')
  assert.equal(wobbleOf(WOBBLE_SEC), 0)
  assert.ok(read('../components/V2capAtbTelop.jsx').includes("train: { color:'#e8ffd8', glow:'#5fd07a', line:'#a8e8a0', word: '修練終了' }"))
  // 絵が届くまでは仮の絵（ある）
  assert.ok(readFileSync(new URL(`../../../public${SCARECROW_TEMP_SRC}`, import.meta.url)).length > 100)
})
