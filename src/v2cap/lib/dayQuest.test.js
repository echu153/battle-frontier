// v2cap 日替わりクエスト（旧 修練場）の曜日のクエストのテスト（node --test）
//   ★曜日は日本時間の朝5時で切り替わる／土日は宝箱の魔物・月〜金は無い／Gold の式と曜日の割り当てが SQL と同じ／
//     戦い方は案山子と同じ（同じ守り＝同じ目安の表・反撃しない・状態異常にならない）／ふつうに遊んだ結果がサーバーの回し直しと同じ／
//     どのクエストかはサーバーが預かった quest で回し直す／メニューの名前、を見張る
//   SQL まで通した確かめは v2cap-tools/dayquest-1106/pg-check.mjs（PGlite・曜日・1日1回・Gold・権限・開発者だけの曜日の上書き）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advance, reserve, seedRng, startMacro } from '../core/atb.js'
import { AIL_KEYS, hasAilment } from '../core/ailments.js'
import { ITEMS, itemIdOf } from './equipment.js'
import { canEquipType } from './jobs.js'
import { SKILLS } from './skills.js'
import { verifyRequest } from './dungeonVerifyApi.js'
import { endTelopOf } from './atbTelop.js'
import { DAILY_GOLD_PER_LV } from './daily.js'
import { SCARECROW_SEC, SCARECROW_STEPS, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX, scarecrowFighter, scarecrowDamageOf, scarecrowPctOf } from './scarecrow.js'
import {
  DAY_QUEST_TITLE, DAY_QUEST_RESET_HOUR, DAY_QUESTS, DAY_QUEST_BY_DOW, DAY_QUEST_UNLOCK_SPOT, COFFER_KEY, COFFER_GOLD_PER_LV,
  playDowOf, dayQuestOn, dowsOfQuest, cofferGoldOf, isDayQuestOpen, dayQuestFighter, startDayQuestAtb, verifyDayQuest,
} from './dayQuest.js'
import { cofferArtOf, COFFER_TEMP_SRC } from './cofferArt.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const sec30 = SQL.slice(SQL.indexOf('===== 30. 日替わりクエスト'))
const fnOf = (name) => { const i = sec30.indexOf(`function public.${name}(`); assert.ok(i >= 0, `${name} が無い`); return sec30.slice(i, sec30.indexOf('\n$$;', i)) }
// 日本時間の y年m月d日 h時 → ミリ秒
const jst = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h - 9, min)
const AT = jst(2026, 11, 7, 12)   // 土曜
const LEARNED = SKILLS.map(s => s.name)
const RARE = (cls) => ITEMS.find(i => i.part === '武器' && i.area === 2 && i.rarity === 'R' && canEquipType(cls, i.type))
// サーバーの写しと同じ形（JSON を通した { prof, inv, at }）。7枠を着けた LV25 のキャラ（scarecrow.test.js と同じ）
const snapOf = (cls) => {
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
    },
    inv: slots.map((s, i) => ({ id: i + 1, base_id: ids[s], ilv: 20, plus: 3, shinka: null })),
    at: AT,
  }))
}
const playLikeScreen = (t, press) => {
  const st = startDayQuestAtb(t)
  const r = seedRng(press)
  startMacro(st, 1, st.a.slots.slice(0, 8).map((_, i) => ({ idx: i })), true)
  while (!st.over) {
    advance(st, 0.006 + r() * 0.03)
    if (r() < 0.01) reserve(st, Math.floor(r() * st.a.slots.length))
  }
  return st
}

test('【確定】2026-11-06 曜日は日本時間の朝5時で切り替わる（土曜の朝4時59分はまだ金曜）', () => {
  assert.equal(DAY_QUEST_RESET_HOUR, 5)
  assert.equal(playDowOf(jst(2026, 11, 6, 12)), 5, '11-06（金）の昼')
  assert.equal(playDowOf(jst(2026, 11, 7, 4, 59)), 5, '土曜の4時59分はまだ金曜')
  assert.equal(playDowOf(jst(2026, 11, 7, 5, 0)), 6, '土曜の5時から土曜')
  assert.equal(playDowOf(jst(2026, 11, 8, 23, 59)), 0, '日曜の夜')
  assert.equal(playDowOf(jst(2026, 11, 9, 4, 59)), 0, '月曜の4時59分はまだ日曜')
  assert.equal(playDowOf(jst(2026, 11, 9, 5, 0)), 1, '月曜の5時から月曜')
  // SQL も同じ日（v2cap_dungeon_today＝日本時間から5時間戻した日）の曜日で決める
  assert.ok(SQL.includes("select ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date"))
  assert.ok(fnOf('v2cap_dayquest_state').includes("'dow', extract(dow from v_day)::int"))
})

test('【確定】土日は宝箱の魔物・月〜金はまだ無い（あとで決める）', () => {
  assert.deepEqual(DAY_QUEST_BY_DOW, [COFFER_KEY, null, null, null, null, null, COFFER_KEY])
  assert.equal(dayQuestOn(jst(2026, 11, 7, 12))?.key, COFFER_KEY, '土曜')
  assert.equal(dayQuestOn(jst(2026, 11, 8, 12))?.key, COFFER_KEY, '日曜')
  for (const d of [9, 10, 11, 12, 13]) assert.equal(dayQuestOn(jst(2026, 11, d, 12)), null, `11-${d}（平日）`)
  assert.equal(dowsOfQuest(COFFER_KEY), '土・日')
  assert.equal(DAY_QUESTS[COFFER_KEY].reward, 'gold')
  // SQL の曜日の割り当て・あるクエストが JS と同じ
  const of = fnOf('v2cap_dayquest_of')
  const sqlMap = Object.fromEntries([...of.matchAll(/when (\d) then '(\w+)'/g)].map(m => [Number(m[1]), m[2]]))
  assert.deepEqual(DAY_QUEST_BY_DOW.map((k, d) => sqlMap[d] || null), DAY_QUEST_BY_DOW)
  assert.ok(of.includes('else null end'))
  const keys = fnOf('v2cap_dayquest_keys').match(/array\[([^\]]*)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''))
  assert.deepEqual(keys.sort(), Object.keys(DAY_QUESTS).sort())
})

test('【確定】Gold＝LV×500（目安どおりで・デイリーミッション5つぶん）× 割合50〜150%・SQL と同じ式', () => {
  assert.equal(COFFER_GOLD_PER_LV, DAILY_GOLD_PER_LV * 5)
  assert.equal(cofferGoldOf(80, 100), 40000)
  assert.equal(cofferGoldOf(80, 50), 20000)
  assert.equal(cofferGoldOf(80, 150), 60000)
  assert.equal(cofferGoldOf(80, 999), 60000, '150%で止まる')
  assert.equal(cofferGoldOf(80, 0), 20000, '50%より下にならない')
  assert.equal(cofferGoldOf(0, 100), 500, 'LVは1から')
  // SQL の式を JS で同じに計算して、いろいろなLVと割合で突き合わせる
  const g = fnOf('v2cap_dayquest_gold')
  assert.ok(g.includes(`* ${COFFER_GOLD_PER_LV} * greatest(${SCARECROW_PCT_MIN}, least(${SCARECROW_PCT_MAX}, coalesce(p_pct, ${SCARECROW_PCT_MIN}))) + 99) / 100`))
  const sqlGold = (lv, pct) => Math.floor((Math.max(1, lv) * COFFER_GOLD_PER_LV * Math.max(50, Math.min(150, pct)) + 99) / 100)
  for (const lv of [1, 7, 25, 63, 80, 100]) for (const pct of [50, 77, 100, 123, 150]) assert.equal(cofferGoldOf(lv, pct), sqlGold(lv, pct), `LV${lv} ${pct}%`)
  // 割合は案山子と同じ物差し・同じ幅
  assert.ok(fnOf('v2cap_dayquest_verify_settle').includes(`v_pct := greatest(${SCARECROW_PCT_MIN}, least(${SCARECROW_PCT_MAX}, coalesce(p_pct, ${SCARECROW_PCT_MIN})));`))
})

test('【確定】戦い方は案山子と同じ：同じ守り（同じ目安の表が使える）・反撃しない・状態異常にならない・60秒', () => {
  const a = dayQuestFighter(COFFER_KEY, 40), b = scarecrowFighter(40)
  assert.deepEqual({ ...a, name: null }, { ...b, name: null }, '名前のほかは案山子と同じ')
  assert.equal(a.name, DAY_QUESTS[COFFER_KEY].name)
  assert.equal(dayQuestFighter('ないもの', 40), null)
  for (const cls of ['盗賊', '呪術師', '戦士', '魔法使い']) {
    const st = playLikeScreen({ quest: COFFER_KEY, seed: 5, snap: snapOf(cls) }, 2)
    assert.ok(st.over && st.winner === 'draw', `${cls}：60秒で終わる`)
    assert.equal(st.steps, SCARECROW_STEPS)
    assert.ok(Math.abs(st.t - SCARECROW_SEC) < 1e-9)
    const acts = st.log.filter(l => l.side === st.b.name && ['attack', 'skill', 'cast', 'guard'].includes(l.type))
    assert.equal(acts.length, 0, `${cls}：宝箱の魔物は一度も動かない`)
    assert.ok(!AIL_KEYS.some(k => hasAilment(st.b, k)), `${cls}：状態異常にならない`)
    assert.ok(scarecrowDamageOf(st) > 0, `${cls}：削れる`)
  }
  // 終わりのテロップは「クエスト終了」（案山子の「修練終了」・四凶の「時間切れ」は変えない）
  const st = playLikeScreen({ quest: COFFER_KEY, seed: 1, snap: snapOf('戦士') }, 1)
  assert.equal(endTelopOf(st, [], 1000, cofferArtOf()).kind, 'quest')
  assert.ok(read('../components/V2capAtbTelop.jsx').includes("quest: { color:'#fff0c0', glow:'#ffb830', line:'#ffd27a', word: 'クエスト終了' }"))
  // 絵が届くまでは仮の絵（ある）
  assert.ok(readFileSync(new URL(`../../../public${COFFER_TEMP_SRC}`, import.meta.url)).length > 100)
})

test('ふつうに遊んだ結果は、サーバーの回し直しと同じ（知らないクエストは「おかしい」で下限）', () => {
  for (const cls of ['戦士', '魔法使い', '侍']) {
    const snap = snapOf(cls)
    const st = playLikeScreen({ quest: COFFER_KEY, seed: 99, snap }, 4)
    const v = verifyDayQuest({ quest: COFFER_KEY, seed: 99, snap, inputs: st.inputs, endStep: st.steps, elapsedSec: 66 })
    assert.equal(v.reason, null)
    assert.equal(v.damage, scarecrowDamageOf(st), `${cls}：回し直しても同じダメージ`)
    assert.equal(v.pct, scarecrowPctOf(scarecrowDamageOf(st), cls, 25))
  }
  const snap = snapOf('戦士')
  const st = playLikeScreen({ quest: COFFER_KEY, seed: 3, snap }, 4)
  assert.deepEqual(verifyDayQuest({ quest: 'ないもの', seed: 3, snap, inputs: st.inputs, endStep: st.steps, elapsedSec: 66 }),
    { damage: 0, pct: SCARECROW_PCT_MIN, steps: 0, reason: 'quest' })
  assert.equal(verifyDayQuest({ quest: COFFER_KEY, seed: 3, snap, inputs: 'x', endStep: st.steps, elapsedSec: 66 }).reason, 'inputs')
  assert.equal(verifyDayQuest({ quest: COFFER_KEY, seed: 3, snap, inputs: st.inputs, endStep: st.steps, elapsedSec: 10 }).reason, 'too_fast')
})

test('Vercel の関数：kind:dayquest はサーバーが預かった quest で回し直して入れる（画面の quest は受け取らない）', async () => {
  const snap = snapOf('戦士')
  const st = playLikeScreen({ quest: COFFER_KEY, seed: 42, snap }, 7)
  const calls = []
  const fetchFn = async (url, init) => {
    const fn = url.split('/rpc/')[1], body = JSON.parse(init.body)
    calls.push({ fn, body })
    if (fn === 'v2cap_dayquest_verify_load') return { ok: true, json: async () => ({ ok: true, quest: COFFER_KEY, seed: 42, snap, inputs: st.inputs, end_step: st.steps, elapsed_sec: 65 }) }
    if (fn === 'v2cap_dayquest_verify_settle') return { ok: true, json: async () => ({ ok: true, damage: body.p_damage, pct: body.p_pct }) }
    throw new Error('知らない関数 ' + fn)
  }
  const player = '11111111-1111-1111-1111-111111111111'
  const r = await verifyRequest({ body: { kind: 'dayquest', id: 5, player, quest: 'ないもの' }, secret: 's', fetchFn })
  assert.equal(r.status, 200)
  assert.deepEqual(calls.map(c => c.fn), ['v2cap_dayquest_verify_load', 'v2cap_dayquest_verify_settle'])
  assert.equal(calls[1].body.p_damage, scarecrowDamageOf(st))
  assert.equal(calls[1].body.p_pct, scarecrowPctOf(scarecrowDamageOf(st), '戦士', 25))
  assert.equal(calls[1].body.p_reason, null)
  assert.equal((await verifyRequest({ body: { kind: 'dayquest', id: 'x', player }, secret: 's', fetchFn })).status, 400)
  assert.equal((await verifyRequest({ body: { kind: 'dayquest', id: 5, player }, secret: '', fetchFn })).status, 500)
})

test('SQL §30 の数と決まりは JS と同じ（解禁の場所・60秒・記録の上限・1日1回・権限・開発者だけの曜日の上書き）', () => {
  assert.equal(DAY_QUEST_UNLOCK_SPOT, 3)
  assert.equal(isDayQuestOpen([1, 2]), false)
  assert.equal(isDayQuestOpen([1, 2, 3]), true)
  assert.ok(fnOf('v2cap_dayquest_state').includes(`c_unlock constant int := ${DAY_QUEST_UNLOCK_SPOT};`))
  assert.ok(fnOf('v2cap_dayquest_start').includes(`c_unlock constant int := ${DAY_QUEST_UNLOCK_SPOT};`))
  assert.ok(fnOf('v2cap_dayquest_end').includes(`c_steps        constant int := ${SCARECROW_STEPS};`))
  assert.ok(fnOf('v2cap_dayquest_end').includes('c_inputs_max   constant int := 5000;'))
  assert.ok(sec30.includes('unique (player_id, day)'))
  assert.ok(fnOf('v2cap_dayquest_start').includes('v_day   date := public.v2cap_dungeon_today();'))
  // その曜日でないクエストを選べるのは開発者だけ（公開したあとも、ほかの人が渡した p_quest は使わない）
  assert.ok(fnOf('v2cap_dayquest_start').includes('if p_quest is not null and public.v2cap_is_dev() then'))
  // どのクエストかは始めたときに預かり、入れるときはそれで決める（画面からは受け取らない）
  assert.ok(fnOf('v2cap_dayquest_verify_settle').includes("if v_try.quest = 'coffer' then"))
  assert.ok(!/p_quest/.test(fnOf('v2cap_dayquest_verify_settle')) && !/p_quest/.test(fnOf('v2cap_dayquest_verify_load')))
  assert.ok(sec30.includes('revoke all on function public.v2cap_dayquest_verify_settle(text, bigint, uuid, int, int, text) from public, authenticated;'))
  assert.ok(sec30.includes('revoke all on function public.v2cap_dayquest_verify_load(text, bigint, uuid) from public, authenticated;'))
  // 遅れた記録の長さは画面と同じ
  const late = Number(fnOf('v2cap_dayquest_end').match(/c_late_min\s+constant int := (\d+);/)[1])
  assert.ok(read('../components/V2capTraining.jsx').includes(`const LATE_MS = ${late} * 60 * 1000`))
  // 差分のファイル（ユーザーが流す）があれば中身は全文の §30 と同じ
  let delta = null
  try { delta = read('../../../v2cap_dayquest_20261106.sql') } catch { /* git に入れないファイル＝別の作業場所には無い */ }
  if (delta) assert.ok(delta.includes(sec30.slice(0, sec30.length - 1)), '差分のファイルと全文の §30 が同じ')
})

test('【確定】2026-11-06 メニューの名前は「日替わりクエスト」（旧 修練場・中の key は training のまま）', () => {
  assert.equal(DAY_QUEST_TITLE, '日替わりクエスト')
  const home = read('../pages/V2capHome.jsx')
  assert.ok(home.includes("{ key:'training', label: DAY_QUEST_TITLE,"))
  assert.ok(!home.includes("label:'修練場'"))
  assert.ok(!read('../components/V2capTraining.jsx').includes('修練場へ戻る'))
})
