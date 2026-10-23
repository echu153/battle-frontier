// 出撃と塔の待ち時間（cooldown.js）：画面の時計・早すぎたときの送り直し・精算ごとの印（node --test）
// 【確定】2026-10-23 ユーザー報告「⚠ 反映に失敗しました（出撃の間隔が短すぎます）」の直し。サーバーとの突き合わせは v2capsql.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createSortieClock, sendWithCooldownRetry, newSettleKey, settleKeyArgOf,
  SORTIE_CD, SORTIE_CD_SLACK, RESEND_TRIES, RESEND_MARGIN_MS,
} from './cooldown.js'

const T0 = 1_800_000_000_000
const iso = (ms) => new Date(ms).toISOString()

test('時計：精算を送った・返ってきたときから10秒。サーバーに言われた残りはそのぶん待つ（10秒より長くは待たない）', () => {
  assert.equal(SORTIE_CD, 10)
  const c = createSortieClock()
  assert.equal(c.leftMs(T0), 0, '最初は待たない')
  c.start(T0)
  assert.equal(c.leftMs(T0), 10000)
  assert.equal(c.leftMs(T0 + 9999), 1)
  assert.equal(c.leftMs(T0 + 10000), 0)
  c.start(T0)
  c.wait(3000, T0 + 9000)   // 画面ではあと1秒のところで、サーバーが「あと3秒」
  assert.equal(c.leftMs(T0 + 9000), 3000)
  c.wait(500, T0 + 9000)
  assert.equal(c.leftMs(T0 + 9000), 3000, '短くはしない')
  c.wait(60000, T0 + 9000)
  assert.equal(c.leftMs(T0 + 9000), 10000, '10秒より長くは待たない')
  c.clear()
  assert.equal(c.leftMs(T0 + 9000), 0, '塔で守護者が入れ替わっていた（待ち時間を使っていない）')
})

test('★再現：PCの時計が進んでいると、前は施設の画面から戻ってすぐの出撃がサーバーの8秒より早く届いた。いまは届かない', () => {
  const SKEW = 3000                         // PCの時計 − サーバーの時計（PCが3秒進んでいる）
  const serverOf = (pc) => pc - SKEW
  const c = createSortieClock()
  c.fromServer(null, T0)                    // ページを開いた（まだ出撃していない）
  c.start(T0)                               // 出撃を押した
  const lastSortieAt = serverOf(T0 + 100)   // サーバーが書いた last_sortie_at（サーバーの時計）
  c.start(T0 + 200)                         // 精算が返ってきた
  // 前：施設の画面から戻ると、出撃の画面が last_sortie_at をPCの時計とそのまま比べて「＋10秒で出撃可能」にしていた
  const oldReady = lastSortieAt + SORTIE_CD * 1000
  assert.ok(serverOf(oldReady) - lastSortieAt < (SORTIE_CD - SORTIE_CD_SLACK) * 1000, '前のやり方はサーバーの8秒より早く送っていた（弾かれていた）')
  // いま：戻ってもサーバーの時刻を読み直さない（時計は画面を切り替えても残る）
  c.fromServer(iso(lastSortieAt), T0 + 4000)
  const ready = T0 + 4000 + c.leftMs(T0 + 4000)
  assert.ok(serverOf(ready) - lastSortieAt >= (SORTIE_CD - SORTIE_CD_SLACK) * 1000, 'いまはサーバーの8秒より前には送らない')
})

test('★サーバーの時刻はページを開いて最初の1回だけ・いまから10秒より先には置かない（PCの時計が遅れていても待ちすぎない）', () => {
  const a = createSortieClock()
  a.fromServer(iso(T0 + 30000), T0)         // PCの時計が30秒遅れている：そのまま数えると40秒待つ
  assert.equal(a.leftMs(T0), 10000)
  const b = createSortieClock()
  b.fromServer(iso(T0 - 4000), T0)          // 4秒前に出撃していた（ほかのタブ・読み込み直す前）
  assert.equal(b.leftMs(T0), 6000, '最初の1回は読む')
  b.start(T0 + 6000)
  b.fromServer(iso(T0 + 30000), T0 + 6100)  // 精算のあとにプロフィールを読み直した
  assert.equal(b.leftMs(T0 + 6100), 9900, '2回目からは読まない（画面の時計のまま）')
  const c = createSortieClock()
  c.fromServer(null, T0)                    // まだ出撃したことが無い
  c.fromServer(iso(T0), T0)
  assert.equal(c.leftMs(T0), 0, '最初に読んだのが空なら、そのあとも読まない')
  const d = createSortieClock()
  d.fromServer('おかしな値', T0)
  assert.equal(d.leftMs(T0), 0, '読めない時刻は何もしない')
})

test('★送り直し：早すぎると言われたら、サーバーが数えた残り＋余裕を待って同じ中身で送り直す', async () => {
  const replies = [
    { data: { ok: false, error: '出撃の間隔が短すぎます', wait_ms: 1200 } },
    { data: { ok: true, exp: 5 } },
  ]
  let calls = 0
  const slept = [], waited = []
  const res = await sendWithCooldownRetry(async () => { calls++; return replies.shift() },
    { sleep: async (ms) => { slept.push(ms) }, onWait: (ms) => waited.push(ms) })
  assert.deepEqual(res, { data: { ok: true, exp: 5 } })
  assert.equal(calls, 2)
  assert.deepEqual(waited, [1200], '時計にサーバーの残りを入れる')
  assert.deepEqual(slept, [1200 + RESEND_MARGIN_MS])
  // 10秒より長くは待たない
  const long = [{ data: { ok: false, wait_ms: 99999 } }, { data: { ok: true } }]
  const slept2 = []
  await sendWithCooldownRetry(async () => long.shift(), { sleep: async (ms) => { slept2.push(ms) } })
  assert.deepEqual(slept2, [SORTIE_CD * 1000 + RESEND_MARGIN_MS])
})

test('送り直さない：ほかの断り・通信の失敗・サーバーが前の版（wait_ms が無い）。取り合いが続いても回数で止まる', async () => {
  for (const reply of [
    { data: { ok: false, error: 'スタミナが足りません', stamina: 0 } },
    { data: { ok: false, error: '出撃の間隔が短すぎます' } },   // 前の版（wait_ms を返さない）
    { data: null, error: { message: 'Failed to fetch' } },
    { data: { ok: true, replay: true } },
  ]) {
    let n = 0
    const res = await sendWithCooldownRetry(async () => { n++; return reply }, { sleep: async () => {} })
    assert.equal(n, 1, JSON.stringify(reply))
    assert.equal(res, reply)
  }
  let n = 0
  const busy = { data: { ok: false, error: '出撃の間隔が短すぎます', wait_ms: 500 } }
  const res = await sendWithCooldownRetry(async () => { n++; return busy }, { sleep: async () => {} })
  assert.equal(n, 1 + RESEND_TRIES, 'ほかのタブと取り合っても止まる')
  assert.equal(res, busy, 'あきらめたら最後の断りを返す（画面は前と同じく失敗を出す）')
})

test('印：戦闘ごとに別の値。サーバーが受け取れる版（プロフィールに last_sortie_key の列がある）のときだけ送る', () => {
  const a = newSettleKey(), b = newSettleKey()
  assert.ok(typeof a === 'string' && a.length >= 8 && a !== b)
  assert.deepEqual(settleKeyArgOf({ id: 'x', last_sortie_key: null }, 'k'), { p_key: 'k' })
  assert.deepEqual(settleKeyArgOf({ id: 'x', last_sortie_at: null }, 'k'), {}, '前の版に送ると関数が見つからず、出撃がすべて失敗する')
  assert.deepEqual(settleKeyArgOf(null, 'k'), {})
})

// コメント（// の行末まで・/* */）は見ない。改行は LF にそろえる（Windowsの作業コピーは CRLF）
const codeOf = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('★出撃と塔の画面は1つの時計で数える：サーバーの時刻をPCの時計と直接比べない・送り直しと印を通す', () => {
  for (const [f, rpc] of [['../components/V2capSortie.jsx', 'v2cap_sortie_settle'], ['../components/V2capTower.jsx', 'v2cap_tower_fight']]) {
    const src = codeOf(f)
    assert.ok(src.includes("from '../lib/cooldown.js'"), `${f}：cooldown.js の時計を使う`)
    assert.ok(src.includes('useEffect(() => { sortieClock.fromServer(prof?.last_sortie_at) }, [prof?.last_sortie_at])'), `${f}：サーバーの時刻は時計に渡すだけ`)
    assert.equal((src.match(/last_sortie_at/g) || []).length, 2, `${f}：last_sortie_at をほかで使わない（PCの時計と比べない）`)
    assert.ok(!/lastAt|getTime\(\)/.test(src), `${f}：自分で時刻を持たない・比べない`)
    assert.ok(src.includes('sortieClock.leftMs() > 0) return'), `${f}：押した時点の時計でも見る（2回続けて押しても1回）`)
    assert.ok(src.includes(`sendWithCooldownRetry(() => supabase.rpc('${rpc}', args),`), `${f}：早すぎたら待って送り直す`)
    assert.ok(src.includes('{ onWait: (ms) => sortieClock.wait(ms) })'), `${f}：サーバーの残りを時計に入れる`)
    assert.ok(src.includes('...settleKeyArgOf(prof, newSettleKey()),'), `${f}：精算ごとの印を付ける`)
    assert.equal((src.match(/supabase\.rpc\('v2cap_(sortie_settle|tower_fight)'/g) || []).length, 1, `${f}：精算を送るのはこの1か所だけ`)
  }
  const sortie = codeOf('../components/V2capSortie.jsx')
  assert.equal((sortie.match(/sortieClock\.start\(\)/g) || []).length, 2, '出撃：押したとき・返ってきたとき（finally）')
  const tower = codeOf('../components/V2capTower.jsx')
  assert.ok(tower.includes('if (freeCd) sortieClock.clear()\n      else sortieClock.start()'), '塔：入れ替わっていたら待ち時間を使わない')
})
