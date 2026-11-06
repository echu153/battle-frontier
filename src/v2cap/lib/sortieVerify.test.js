// v2cap の出撃と塔：結果をサーバーが決める仕組みのテスト（node --test）
//   ★ふつうに遊んだ人の結果がサーバーと一致する／画面から結果を受け取らない、を見張る。
//   SQL まで通した確かめは v2cap-tools/dungeon-1029/sortie-check.mjs（PGlite・本物の DB の形で最初から最後まで）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLASSES, canEquipType } from './jobs.js'
import { ITEMS, itemIdOf } from './equipment.js'
import { SKILLS } from './skills.js'
import { SPOTS } from './areas.js'
import { BURGERS } from './burger.js'
import { forcePapiaNext, takePapiaForce, PAPIA_ROLE } from './papia.js'
import { SHRINE_FAIRY_NAME } from './shrine.js'
import { nextBossRate } from './sortie.js'
import { npcFighterOf } from './tower.js'
import { SORTIE_BATCH, decideSortie, decideTower, fillSortie, randomSeed, towerResultOf } from './sortieVerify.js'
import { sortieRequest } from './sortieVerifyApi.js'
import { callSortie, verifyUrlOf, staleShaOf, askSortieStale, warmSortie, WARM_GAP_MS, SORTIE_STALE_REUSE_MS } from './dungeonVerifyCall.js'
import handler from '../../../api/v2cap-sortie.js'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fnBody = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.ok(i >= 0, `${name} がある`)
  return SQL.slice(i, SQL.indexOf('\n$$;', i))
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const AT = Date.UTC(2026, 9, 31, 3, 0, 0)
const LEARNED = SKILLS.map(s => s.name)
const wire = (v) => JSON.parse(JSON.stringify(v))
// サーバーの写しと同じ形（JSON を通した { prof, inv, at }）
const snapOf = (cls, over = {}) => {
  const weapon = ITEMS.find(i => i.part === '武器' && i.area === 5 && i.rarity === 'R' && canEquipType(cls, i.type))
  const ids = { weapon: weapon.id, head: itemIdOf(5, 'R', '重鎧頭'), body: itemIdOf(5, 'R', '重鎧鎧'), arm: itemIdOf(5, 'R', '軽装腕'), foot: itemIdOf(5, 'R', '軽装足'), acc1: itemIdOf(5, 'R', 'リング'), acc2: itemIdOf(5, 'R', 'イヤリング') }
  const slots = Object.keys(ids)
  return wire({
    prof: {
      id: '11111111-1111-1111-1111-111111111111', username: 'てすと', class: cls, lv: 45,
      hp: 500, mp: 90, str: 130, dex: 110, agi: 110, int_stat: 130, vit: 110, luk: 60,
      jobs: { [cls]: { lv: 30, exp: 0 } }, learned: LEARNED, skill_sets: { [cls]: LEARNED.slice(0, 5).map(name => ({ name, uses: 2 })) }, ascension: {}, gender: 'm',
      equipped: Object.fromEntries(slots.map((s, i) => [s, i + 1])), meal_burger: null, meal_major: null, meal_minor: null, meal_until: null, flip_until: null,
      cleared_spots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], tower_guard: null, boss_rate: 0,
      ...over,
    },
    inv: slots.map((s, i) => ({ id: i + 1, base_id: ids[s], ilv: 40, plus: 3, shinka: null })),
    at: AT,
  })
}
const stateOf = (d) => JSON.stringify({ win: d.win, drop: d.drop?.item.id ?? null, enemy: d.enc.enemy.name, role: d.enc.role, turns: d.r.turns, a: d.r.a, b: d.r.b, log: d.r.log })

test('★ふつうに遊んだ人の結果とサーバーの計算が一致する：全職で、サーバーが決めた30戦を画面の再生が同じ結果にする', () => {
  const seen = { win: 0, lose: 0, boss: 0, drop: 0 }
  for (const [i, c] of CLASSES.entries()) {
    const snap = snapOf(c.id)
    const spot = 13 + (i % 9)
    // サーバー：まとめて決める。ボスの出やすさは途中から
    const entries = fillSortie({ snap, spot, rate: i * 7 })
    assert.equal(entries.length, SORTIE_BATCH)
    for (const e of wire(entries)) {
      // 画面：精算のあとで届いた種と写しで再生する（JSON を通した値）
      const d = decideSortie({ snap: wire(snap), spot, rate: e.rate, seed: e.seed, forcePapia: !!e.force })
      assert.equal(d.enc.enemy.name, e.enemy, `${c.id} 敵`)
      assert.equal(d.win, e.win, `${c.id} 勝ち負け`)
      assert.equal(d.drop ? d.drop.item.id : null, e.drop, `${c.id} 装備`)
      // 途中の状態まで同じ（結果がたまたま同じ、ではない）
      assert.equal(stateOf(decideSortie({ snap: wire(snap), spot, rate: e.rate, seed: e.seed })), stateOf(d), `${c.id} 状態`)
      seen[e.win ? 'win' : 'lose']++
      if (d.enc.isBoss) seen.boss++
      if (e.drop) seen.drop++
    }
  }
  assert.ok(seen.win > 0 && seen.boss > 0 && seen.drop > 0, `いろいろな結果を通っている ${JSON.stringify(seen)}`)
})

test('負けも一致する（弱いキャラ）', () => {
  const snap = snapOf('戦士', { lv: 1, hp: 10, mp: 5, str: 1, dex: 1, agi: 1, int_stat: 1, vit: 1, luk: 1, jobs: { 戦士: { lv: 1, exp: 0 } }, equipped: {}, skill_sets: {}, learned: [] })
  snap.inv = []
  const entries = fillSortie({ snap, spot: 40, rate: 0 })
  assert.ok(entries.some(e => !e.win), '負けている')
  for (const e of entries) {
    const d = decideSortie({ snap: wire(snap), spot: 40, rate: e.rate, seed: e.seed })
    assert.equal(d.win, e.win)
    assert.equal(e.win ? true : e.drop, e.win ? true : null, '負けたら装備は落ちない')
  }
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
      const snap = snapOf(c.id)
      assert.equal(fillSortie({ snap, spot: 16, rate: 50 }).length, SORTIE_BATCH)
      assert.ok(towerResultOf({ snap, floor: 40, row: null, seed: 5 }).snapshot)
    }
  } finally {
    Math.random = realRandom
    globalThis.Date = RealDate
  }
})

test('★前の戦闘の影響が残らない（Vercel の関数は起動したまま次を受ける）', () => {
  const list = CLASSES.slice(0, 14).map((c, i) => ({ snap: snapOf(c.id), spot: 13 + (i % 9), rate: 10, seed: 1000 + i }))
  const runAll = (ts) => ts.map(t => stateOf(decideSortie(t)))
  assert.deepEqual(runAll([...list].reverse()).reverse(), runAll(list))
})

test('種は1つずつ別に引く（前の種から次の結果を当てられない＝悪い結果だけ捨てて引き直せない）', () => {
  const xs = Array.from({ length: 2000 }, randomSeed)
  assert.ok(xs.every(x => Number.isInteger(x) && x >= 0 && x < 4294967296))
  assert.ok(new Set(xs).size > 1990, 'ほとんど重ならない')
  const diffs = new Set(xs.slice(1).map((x, i) => x - xs[i]))
  assert.ok(diffs.size > 1990, '前の種に足すだけ、の形でない')
  assert.match(read('./sortieVerify.js'), /globalThis\.crypto\.getRandomValues/)
  const seeds = fillSortie({ snap: snapOf('戦士'), spot: 16 }).map(e => e.seed)
  assert.equal(new Set(seeds).size, SORTIE_BATCH)
})

test('ボスの出やすさはサーバーと同じ順に積み上がる（ボスに当たったら0・祠の中は変わらない）', () => {
  const entries = fillSortie({ snap: snapOf('戦士'), spot: 16, rate: 90, n: 30 })
  let rate = 90
  for (const e of entries) {
    assert.equal(e.rate, rate)
    const d = decideSortie({ snap: snapOf('戦士'), spot: 16, rate: e.rate, seed: e.seed })
    rate = nextBossRate(rate, d.enc.isBoss)
  }
  assert.ok(entries.some(e => e.rate === 0), '高い確率なのでボスに当たって0へ戻っている')
  // 祠の中：相手はハピネスフェアリーだけ・装備は落ちない・出やすさは変わらない
  const sh = fillSortie({ snap: snapOf('戦士'), spot: 16, shrineSpot: 16, rate: 12, n: 10 })
  for (const e of sh) {
    assert.equal(e.enemy, SHRINE_FAIRY_NAME)
    assert.equal(e.drop, null)
    assert.equal(e.rate, 12)
  }
})

test('開発用「次の出撃でパピア」：サーバーの印で1戦目だけ。画面の印を食べない', () => {
  const entries = fillSortie({ snap: snapOf('戦士'), spot: 16, forcePapia: true, n: 5 })
  assert.equal(entries[0].force, true)
  assert.ok(entries.slice(1).every(e => !e.force))
  const d = decideSortie({ snap: snapOf('戦士'), spot: 16, seed: entries[0].seed, forcePapia: true })
  assert.equal(d.enc.role, PAPIA_ROLE)
  assert.equal(d.enc.enemy.name, entries[0].enemy)
  assert.equal(d.drop, null, 'パピアは装備を落とさない')
  // シミュレーションの道具の印は、サーバーの計算に混ざらない
  forcePapiaNext()
  const n = decideSortie({ snap: snapOf('戦士'), spot: 16, rate: 100, seed: 3 })
  assert.equal(n.enc.role, 'boss', '印があっても、渡していなければ出ない')
  assert.equal(takePapiaForce(), true, '印は残っている')
})

test('写しの時刻で決まる：食事の残り・秘薬の時間帯・落ちやすい部位は、いまの時計を見ない', () => {
  const burger = BURGERS[0]
  const fed = (until) => decideSortie({ snap: snapOf('戦士', { meal_burger: burger.stat, meal_until: until }), spot: 16, seed: 7 })
  assert.ok(fed(AT + 1000).me.stats[burger.stat] > fed(AT - 1000).me.stats[burger.stat], '写しの時刻に効いていれば効く')
  // 秘薬：時間限定の敵が12時間ずれる（AT は昼＝12時 JST）
  const roleTimed = (over) => {
    const out = []
    for (let seed = 0; seed < 400 && out.length < 8; seed++) {
      const d = decideSortie({ snap: snapOf('戦士', over), spot: 16, seed })
      if (d.enc.role === 'timed') out.push(d.enc.enemy.name)
    }
    return new Set(out)
  }
  const plain = roleTimed({})
  const flipped = roleTimed({ flip_until: AT + 3600000 })
  assert.ok(![...plain].some(n => flipped.has(n)), `秘薬で時間限定の敵が変わる ${[...plain]} / ${[...flipped]}`)
  assert.deepEqual([...roleTimed({ flip_until: AT - 1000 })].sort(), [...plain].sort(), '切れていれば同じ')
})

test('塔の守護者のドロップ率+1%・防具のセット能力も、サーバーの計算に入る（写しの tower_guard）', () => {
  // 落ちたかどうかの乱数がちょうど境目の戦闘を探して比べる
  let differs = 0
  for (let seed = 0; seed < 3000; seed++) {
    const a = decideSortie({ snap: snapOf('戦士'), spot: 16, seed })
    if (a.enc.role !== 'normal' || !a.win) continue
    const b = decideSortie({ snap: snapOf('戦士', { tower_guard: 3 }), spot: 16, seed })
    if (!a.drop && b.drop) differs++
    assert.ok(!(a.drop && !b.drop), '守っていて減ることはない')
  }
  assert.ok(differs > 0, `守っていると落ちる戦闘がある（${differs}戦）`)
})

test('★塔：サーバーの結果と画面の再生が一致する（空きの層のNPC・人の守護者）', () => {
  for (const [i, c] of CLASSES.slice(0, 16).entries()) {
    const snap = snapOf(c.id)
    const floor = 30 + i
    for (const row of [null, wire({
      floor, player_id: '22222222-2222-2222-2222-222222222222', hp_pm: 700, mp: 12, streak: i % 4, since: '2026-10-30T00:00:00+00:00',
      snapshot: towerResultOf({ snap: snapOf('魔法使い'), floor: 1, row: null, seed: 9 }).snapshot,
    })]) {
      const seed = 1000 + i
      const res = wire(towerResultOf({ snap, floor, row, seed }))
      const d = decideTower({ snap: wire(snap), floor, row, seed: res.seed })
      assert.equal(d.win, res.win, `${c.id} 勝ち負け`)
      assert.equal(d.drop ? d.drop.item.id : null, res.drop, `${c.id} 装備`)
      assert.ok(res.my_hp_pm >= 1 && res.my_hp_pm <= 1000 && res.foe_hp_pm >= 1 && res.foe_hp_pm <= 1000)
      assert.equal(JSON.stringify(decideTower({ snap: wire(snap), floor, row, seed }).r.log), JSON.stringify(d.r.log), `${c.id} 状態`)
      if (row) assert.equal(d.champ.playerId, row.player_id)
    }
  }
})

test('塔：守護者の姿はサーバーの写しから作る（画面のステは入らない）・食事は入らない', () => {
  const snap = snapOf('戦士', { meal_burger: BURGERS[0].stat, meal_until: AT + 1000 })
  const res = towerResultOf({ snap, floor: 5, row: null, seed: 1 })
  const plain = towerResultOf({ snap: snapOf('戦士'), floor: 5, row: null, seed: 1 })
  assert.deepEqual(res.snapshot.stats, plain.snapshot.stats, '食事は守護者に残らない')
  assert.equal(res.snapshot.lv, 45)
  assert.equal(res.snapshot.cls, '戦士')
  assert.ok(!('slots' in res.snapshot), '技の中身は持たない')
  assert.ok(npcFighterOf(5, 100).stats.hp > 0)
})

test('★強さの印（SQL の v2cap_sortie_sig）は、戦闘が読むプロフィールの列を全部含む', () => {
  const body = fnBody('v2cap_sortie_sig')
  const cols = new Set([...body.matchAll(/p_row\.(\w+)/g)].map(m => m[1]))
  const reads = new Set()
  const watch = (o) => new Proxy(o, { get: (t, k) => { if (typeof k === 'string') reads.add(k); return t[k] }, has: (t, k) => { if (typeof k === 'string') reads.add(k); return k in t } })
  for (const over of [{}, { meal_burger: BURGERS[0].stat, meal_major: 'poison', meal_minor: 'burn', meal_until: AT + 1000, flip_until: AT + 1000, tower_guard: 3 }]) {
    const snap = snapOf('戦士', over)
    for (let seed = 0; seed < 40; seed++) decideSortie({ snap: { ...snap, prof: watch(snap.prof) }, spot: 16, rate: 50, seed })
  }
  assert.ok(reads.has('class') && reads.has('equipped') && reads.has('lv'), `読んだ列を拾えている ${[...reads]}`)
  const missing = [...reads].filter(k => !cols.has(k))
  assert.deepEqual(missing, [], '戦闘が読む列を v2cap_sortie_sig に足す')
  // 着けている装備の中身（強化値など）も印に入っている
  assert.match(body, /jsonb_build_array\(i\.id, i\.base_id, i\.ilv, i\.plus, i\.shinka\)/)
  assert.match(body, /floor\(extract\(epoch from now\(\)\) \/ 3600\)/, '1時間ごとに作り直す（時間帯・落ちやすい部位）')
  assert.match(body, /coalesce\(p_row\.meal_until > now\(\), false\)/, '食事が切れたら作り直す')
  assert.match(body, /coalesce\(p_row\.flip_until > now\(\), false\)/, '秘薬が切れたら作り直す')
})

// ===== 関数の中身（DB の代わりをつなぐ）=====
const fakeDb = (answers) => {
  const calls = []
  const fetchFn = async (url, init) => {
    const fn = url.split('/rpc/')[1]
    const args = JSON.parse(init.body)
    calls.push({ fn, args })
    const out = answers[fn]
    return new Response(JSON.stringify(typeof out === 'function' ? out(args) : out), { status: 200 })
  }
  return { calls, fetchFn }
}
const PLAYER = '11111111-1111-1111-1111-111111111111'
const req = (body, over = {}) => ({ body: { player: PLAYER, ...body }, secret: 'あいことば', ...over })

test('★関数：出撃の30戦を決めて表へ入れる。返事に結果を入れない・画面から何を送っても見ない', async () => {
  const snap = snapOf('戦士')
  const db = fakeDb({
    v2cap_sortie_fill_load: { ok: true, spot: 16, shrine_spot: null, rate: 5, force_papia: false, snap },
    v2cap_sortie_fill_save: { ok: true, saved: true },
  })
  const r = await sortieRequest(req({ kind: 'fill', win: true, enemy: 'ボス', drop: '15L:片手剣', entries: [{ win: true }], rate: 100, spot: 1 }, { fetchFn: db.fetchFn }))
  assert.deepEqual(r, { status: 200, body: { ok: true } }, '結果は返さない')
  assert.deepEqual(db.calls.map(c => c.fn), ['v2cap_sortie_fill_load', 'v2cap_sortie_fill_save'])
  assert.deepEqual(db.calls[0].args, { p_secret: 'あいことば', p_player: PLAYER })
  const save = db.calls[1].args
  assert.equal(save.p_secret, 'あいことば')
  assert.equal(save.p_at, snap.at, '読んだ写しの時刻を渡す')
  assert.equal(save.p_entries.length, SORTIE_BATCH)
  assert.equal(save.p_entries[0].rate, 5, 'サーバーの出やすさから（画面の 100 を見ない）')
  // 表に入った結果は、写しから決めた結果そのもの（場所もサーバーの値）
  for (const e of save.p_entries) {
    const d = decideSortie({ snap, spot: 16, rate: e.rate, seed: e.seed })
    assert.deepEqual([e.enemy, e.win, e.drop], [d.enc.enemy.name, d.win, d.drop ? d.drop.item.id : null])
  }
})

test('関数：塔の結果を決めて表へ入れる。返事に結果を入れない', async () => {
  const snap = snapOf('戦士')
  const db = fakeDb({
    v2cap_tower_try_load: { ok: true, floor: 7, row: null, snap },
    v2cap_tower_try_save: { ok: true, saved: true },
  })
  const r = await sortieRequest(req({ kind: 'tower', win: true, snapshot: { stats: { str: 999999 } } }, { fetchFn: db.fetchFn }))
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  const save = db.calls[1].args
  assert.equal(save.p_at, snap.at)
  const d = decideTower({ snap, floor: 7, row: null, seed: save.p_res.seed })
  assert.equal(save.p_res.win, d.win)
  assert.equal(save.p_res.drop, d.drop ? d.drop.item.id : null)
  assert.ok(save.p_res.snapshot.stats.str < 999999, '画面の姿は入らない')
})

test('関数：もう決めた頼みは決め直さない・合い言葉が違えば何もしない・頼みの形がおかしければ DB を呼ばない', async () => {
  for (const kind of ['fill', 'tower']) {
    const load = kind === 'fill' ? 'v2cap_sortie_fill_load' : 'v2cap_tower_try_load'
    const done = fakeDb({ [load]: { ok: true, done: true } })
    assert.deepEqual(await sortieRequest(req({ kind }, { fetchFn: done.fetchFn })), { status: 200, body: { ok: true } })
    assert.deepEqual(done.calls.map(c => c.fn), [load], '回さない')
    const wrong = fakeDb({ [load]: { ok: false, error: '合い言葉が違います' } })
    assert.deepEqual((await sortieRequest(req({ kind }, { fetchFn: wrong.fetchFn }))).body, { ok: false, error: '合い言葉が違います' })
    assert.deepEqual(wrong.calls.map(c => c.fn), [load], '入れない')
  }
  const none = fakeDb({})
  for (const body of [{ kind: 'win' }, { kind: 'constructor' }, { kind: '__proto__' }, { kind: 'toString' }, { kind: null }, { kind: 'fill', player: 'x' }, { kind: 'fill', player: "1' or 1=1" }, { player: PLAYER }]) {
    assert.equal((await sortieRequest({ body, secret: 's', fetchFn: none.fetchFn })).status, 400, JSON.stringify(body))
  }
  assert.equal((await sortieRequest({ body: null, secret: 's', fetchFn: none.fetchFn })).status, 400)
  assert.equal((await sortieRequest(req({ kind: 'fill' }, { secret: '', fetchFn: none.fetchFn }))).status, 500, '合い言葉の設定が無い')
  assert.equal(none.calls.length, 0)
  // DB がエラーなら 500＝画面が聞き直す
  const errLog = console.error
  console.error = () => {}
  try {
    const broke = await sortieRequest(req({ kind: 'fill' }, { fetchFn: async () => new Response('x', { status: 503 }) }))
    assert.equal(broke.status, 500)
    assert.equal(broke.body.ok, false)
  } finally {
    console.error = errLog
  }
})

test('関数の入口（api/v2cap-sortie.js）：POST だけ・OPTIONS に答える・形の悪い JSON で落ちない', async () => {
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
  const bad = await call({ method: 'POST', get body() { throw new Error('形の悪い JSON') } })
  assert.equal(bad.status, 400)
  assert.equal(bad.headers['Cache-Control'], 'no-store')
})

test('画面から呼ぶ：本番は同じサイト・手元の開発は本番の関数・通信が切れたら聞き直す', async () => {
  assert.equal(verifyUrlOf('battle-frontier-six.vercel.app', '/api/v2cap-sortie'), '/api/v2cap-sortie')
  assert.match(verifyUrlOf('localhost', '/api/v2cap-sortie'), /^https:\/\/.*\/api\/v2cap-sortie$/)
  let n = 0
  const flaky = async (url) => {
    n++
    assert.match(url, /\/api\/v2cap-sortie$/)
    if (n === 1) throw new Error('切れた')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  assert.deepEqual(await callSortie({ kind: 'fill', player: PLAYER }, { fetchFn: flaky, wait: async () => {} }), { ok: true })
  assert.equal(n, 2)
})

test('★SQL：画面から敵・勝ち負け・装備・残りHP・守護者の姿を受け取らない。先の結果を見せない', () => {
  const settle = fnBody('v2cap_sortie_settle')
  assert.match(settle, /^create or replace function public\.v2cap_sortie_settle\(p_spot int, p_auto boolean default false, p_key text default null, p_have bigint default null\)/)
  assert.doesNotMatch(settle.split(/\r?\n/)[0], /p_win|p_enemy|p_drop/)
  // 取り出すのは行をつかんだあと・同じ印の返事のあと・入れられたときだけ・種を渡すのはそのあと
  const at = (w) => { const i = settle.indexOf(w); assert.ok(i >= 0, w); return i }
  assert.ok(at('for update;') < at('last_sortie_key = p_key'))
  assert.ok(at('last_sortie_key = p_key') < at('need_prepare'))
  assert.ok(at('need_prepare') < at('public.v2cap_sortie_apply('))
  assert.ok(at('public.v2cap_sortie_apply(') < at('set pos = pos + 1'))
  assert.ok(at("if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;") < at('set pos = pos + 1'), '早すぎたら取り出さない')
  assert.ok(at('set pos = pos + 1') < at("jsonb_build_object('seed', v_e -> 'seed'"), '種を渡すのは使ったあと')
  assert.doesNotMatch(settle, /'entries'/, '先の結果を返さない')
  // 作り直す条件
  assert.match(settle, /v_q\.sig is distinct from public\.v2cap_sortie_sig\(v_row\)/)
  assert.match(settle, /v_q\.spot is distinct from p_spot/)
  assert.match(settle, /v_q\.pos >= jsonb_array_length\(v_q\.entries\)/)
  // 準備：先の結果も種も返さない
  const prepare = fnBody('v2cap_sortie_prepare')
  assert.match(prepare, /return jsonb_build_object\('ok', true, 'player', v_uid\);/)
  assert.match(prepare, /p_spot > public\.v2cap_open_until\(v_row\.cleared_spots\)/, '開いていない場所では決めない')
  // 塔：結果は表から・画面からは印だけ
  const fight = fnBody('v2cap_tower_fight')
  assert.match(fight, /^create or replace function public\.v2cap_tower_fight\(p_key text default null\)/)
  assert.match(fight, /public\.v2cap_tower_apply\(v_t\.floor, v_t\.foe, \(v_t\.res ->> 'win'\)::boolean,/)
  assert.match(fight, /v_t\.res -> 'snapshot'/, '守護者の姿もサーバーの結果から')
  assert.match(fnBody('v2cap_tower_start'), /return jsonb_build_object\('ok', true, 'player', v_uid\);/)
  // 画面から読めない
  for (const t of ['v2cap_sortie_queue', 'v2cap_tower_try']) {
    assert.ok(SQL.includes(`alter table public.${t} enable row level security;`), t)
    assert.ok(!new RegExp(`create policy \\w+ on public\\.${t}\\b`).test(SQL), `${t} にポリシーを足さない`)
  }
  // 開発者だけ
  for (const fn of ['v2cap_sortie_prepare', 'v2cap_sortie_settle', 'v2cap_tower_start', 'v2cap_tower_fight', 'v2cap_debug_papia_next']) {
    assert.match(fnBody(fn), /if not public\.v2cap_is_dev\(\) then return jsonb_build_object\('ok', false, 'error', '開発限定です'\)/, fn)
  }
  for (const fn of ['v2cap_sortie_fill_load', 'v2cap_sortie_fill_save', 'v2cap_tower_try_load', 'v2cap_tower_try_save']) {
    assert.match(fnBody(fn), /begin\n {2}if not public\.v2cap_dungeon_verify_ok\(p_secret\) then return/, `${fn} はまず合い言葉を見る`)
    assert.ok(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, authenticated;`).test(SQL), `${fn} はログインした人の権限では呼べない`)
  }
  for (const fn of ['v2cap_battle_snap', 'v2cap_sortie_sig']) {
    assert.ok(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`).test(SQL), `${fn} は内部ヘルパ`)
  }
})

test('★画面：戦闘の結果を自分で決めない・送らない（再生するだけ）', () => {
  const sortie = read('../components/V2capSortie.jsx')
  const tower = read('../components/V2capTower.jsx')
  for (const [name, src] of [['出撃', sortie], ['塔', tower]]) {
    for (const w of ['runBattle', 'rollEquipDrop', 'rollTowerDrop', 'pickEncounter', 'p_win', 'p_enemy', 'p_drop', 'p_snapshot', 'p_my_hp_pm', 'Math.random']) {
      assert.ok(!src.includes(w), `${name}の画面に ${w} が残っていない`)
    }
    // 2026-11-07 から出撃は30戦を決めた返事の版（staleShaOf）・塔は出撃と同じ関数に聞く（askSortieStale）
    assert.ok(src.includes(name === '出撃' ? 'staleShaOf(made.sha)' : 'askSortieStale()'), `${name}：古い画面のまま戦わない`)
    assert.ok(src.includes('<V2capReloadNote'), `${name}：読み直しの案内`)
    assert.ok(src.includes('CORRECTED_TEXT'), `${name}：ずれたら知らせる`)
  }
  assert.ok(sortie.includes("supabase.rpc('v2cap_sortie_prepare', { p_spot: spotId })"))
  assert.ok(sortie.includes("callSortie({ kind: 'fill', player: data.player })"))
  assert.ok(sortie.includes('p_have: snapRef.current?.at ?? null'))
  assert.ok(sortie.includes('decideSortie({ snap: snapRef.current, spot: spotId, shrineSpot: b.shrine_spot, rate: b.rate, seed: b.seed, forcePapia: b.force })'))
  assert.ok(tower.includes("supabase.rpc('v2cap_tower_start', { p_floor: floor, p_foe: champ.playerId || null })"))
  assert.ok(tower.includes("callSortie({ kind: 'tower', player: started.data.player })"))
  assert.ok(tower.includes('decideTower({ snap: data.battle.snap, floor: data.battle.floor, row: data.battle.row, seed: data.battle.seed })'))
  // 開発用のパピアはサーバーの印
  const home = read('../pages/V2capHome.jsx')
  assert.ok(home.includes("supabase.rpc('v2cap_debug_papia_next')"))
  assert.ok(!home.includes('forcePapiaNext'))
  assert.ok(SPOTS.length > 0)
})

// 【確定】2026-11-07 ユーザー「最初のオート出撃、戦闘ログが出るまで5秒くらいかかるんだけどなんで？」→「直して」
//   最初の出撃（30戦を決める準備が入る回）は、別の関数への版の確かめ＋眠っている関数を起こす待ちが乗っていた
test('【確定】2026-11-07 関数：ping は版を答える（DB を呼ばない）・決めた返事に版を付ける', async () => {
  const none = fakeDb({})
  assert.deepEqual(await sortieRequest({ body: { ping: true }, secret: '', sha: 'abc', fetchFn: none.fetchFn }), { status: 200, body: { ok: true, sha: 'abc' } })
  assert.equal(none.calls.length, 0, '起こすだけ＝DB を呼ばない')
  for (const kind of ['fill', 'tower']) {
    const load = kind === 'fill' ? 'v2cap_sortie_fill_load' : 'v2cap_tower_try_load'
    const done = fakeDb({ [load]: { ok: true, done: true } })
    assert.deepEqual(await sortieRequest(req({ kind }, { sha: 'abc', fetchFn: done.fetchFn })), { status: 200, body: { ok: true, sha: 'abc' } }, kind)
  }
  assert.ok(read('../../../api/v2cap-sortie.js').includes("sha: process.env.VERCEL_GIT_COMMIT_SHA || ''"), '入口が版を渡す')
})

test('【確定】2026-11-07 画面から呼ぶ：版の比べ方・起こすのは3分に1回まで・塔の版の確かめは1分以内なら聞き直さない', async () => {
  assert.equal(staleShaOf('bbb', 'aaa'), true)
  assert.equal(staleShaOf('aaa', 'aaa'), false)
  assert.equal(staleShaOf('', 'aaa'), false, '関数の版が分からない')
  assert.equal(staleShaOf('bbb', ''), false, '手元の開発')
  assert.equal(WARM_GAP_MS, 3 * 60 * 1000)
  assert.equal(SORTIE_STALE_REUSE_MS, 60 * 1000)
  let n = 0
  const ask = () => { n++; return Promise.resolve(false) }
  const t0 = 1e15   // ほかのテストの印と重ならない時刻
  await warmSortie({ now: t0, ask })
  await warmSortie({ now: t0 + WARM_GAP_MS - 1, ask })
  assert.equal(n, 1, '3分以内は起こし直さない')
  await askSortieStale({ now: t0 + SORTIE_STALE_REUSE_MS - 1, ask })
  assert.equal(n, 1, '塔は1分以内なら同じ答え')
  await askSortieStale({ now: t0 + SORTIE_STALE_REUSE_MS, ask })
  assert.equal(n, 2, '1分を過ぎたら聞き直す')
  await warmSortie({ now: t0 + SORTIE_STALE_REUSE_MS + WARM_GAP_MS, ask })
  assert.equal(n, 3)
  // 聞く先は出撃と塔の関数（挑戦の関数を起こさない）
  const call = readFileSync(new URL('./dungeonVerifyCall.js', import.meta.url), 'utf8')
  assert.ok(call.includes('ask = () => isStaleBuild({ path: SORTIE_PATH })'))
})

test('【確定】2026-11-07 出撃の画面：版は30戦を決めた返事で見る・開いたときと戻ってきたときに関数を起こす・準備のあいだ「探索中…」', () => {
  const src = read('../components/V2capSortie.jsx').replaceAll(String.fromCharCode(13), '')
  assert.ok(!src.includes('isStaleBuild'), '準備の前に別の関数へ版を聞かない（往復が1回多い）')
  assert.ok(src.includes("if (made?.ok && staleShaOf(made.sha)) { setStale(true); setAuto(false); return '新しい版が出ています' }"))
  assert.ok(src.includes('setLogs([{ text:`🔍 ${sh ? SHRINE_NAME : spot.name}を探索中…`'), '準備のあいだログの枠を空にしない')
  const tower = read('../components/V2capTower.jsx').replaceAll(String.fromCharCode(13), '')
  assert.ok(!tower.includes('isStaleBuild'), '塔も挑戦の関数へ聞かない')
  assert.ok(tower.includes('if (await askSortieStale()) {'))
  for (const [f, s] of [['出撃', src], ['塔', tower]]) {
    assert.ok(s.includes("const warm = () => { if (document.visibilityState !== 'hidden') void warmSortie() }"), f)
    assert.ok(s.includes("document.addEventListener('visibilitychange', warm)"), `${f}：画面に戻ってきたときも`)
  }
})
