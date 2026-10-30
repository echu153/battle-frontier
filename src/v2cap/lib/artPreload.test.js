// v2cap のボス戦の絵の先読み（lib/artPreload.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ART_WAIT_MS, artIsLoaded, artLoadedCount, preloadArt } from './artPreload.js'
import { bossIllustOf } from './bossIllust.js'
import { bossArtOf } from './bossArt.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('【確定】2026-10-31 絵の先読み：そろったら解決・途中の数が分かる・1枚は1回だけ読む・読めない絵は待たない', async () => {
  const calls = [], waiting = {}
  const load = (src, done) => { calls.push(src); waiting[src] = done }
  const srcs = ['t1/a.webp', 't1/b.webp', 't1/c.webp']
  const seen = []
  let finished = false
  const p = preloadArt(srcs, { load, onProgress: (n) => seen.push(n) }).then(() => { finished = true })
  assert.equal(artLoadedCount(srcs), 0)
  waiting['t1/a.webp']()
  waiting['t1/b.webp']()   // 読めなかった絵も done を呼ぶ（画面の読み方は onerror でも呼ぶ）
  await new Promise(r => setTimeout(r, 0))
  assert.equal(artLoadedCount(srcs), 2)
  assert.ok(artIsLoaded('t1/a.webp') && !artIsLoaded('t1/c.webp'))
  assert.equal(finished, false, 'まだそろっていない')
  waiting['t1/c.webp']()
  await p
  assert.equal(finished, true)
  assert.equal(seen.at(-1), 3, '読み終わった数を知らせる')
  assert.deepEqual(seen, [...seen].sort(), '減らない')
  // もう一度頼んでも読み直さない（入口の画面で読み始めたぶんを戦闘の画面で使い回す）
  await preloadArt(srcs, { load })
  assert.equal(calls.length, 3)
})

test('【確定】2026-10-31 絵の先読み：届かない絵があっても決まった時間で始める（回線のせいで戦えなくならない）', async () => {
  assert.ok(ART_WAIT_MS >= 3000 && ART_WAIT_MS <= 10000)
  const t0 = Date.now()
  await preloadArt(['t2/never.webp'], { timeoutMs: 40, load: () => {} })
  assert.ok(Date.now() - t0 < 1000, '待ち続けない')
  assert.equal(artLoadedCount(['t2/never.webp']), 0)
})

test('【確定】2026-10-31 ボス戦は絵がそろうまで戦闘の時計を進めない（ユーザー「実機でしっかり見てよ」・真っ黒な舞台に光の粒だけが出ていた）：入口でも読み始める・背景と流れ図も待つ', () => {
  const fight = read('../components/V2capAtbFight.jsx')
  assert.match(fight, /if \(paused \|\| !artReady\) return/, '絵がそろうまで時計を止める')
  assert.match(fight, /if \(!artReady\) return/, '絵がそろうまで舞台を出さない')
  assert.match(fight, /preloadArt\(artSrcs/)
  // 入口の画面でも同じ仕組みで読み始める（new Image で別に読むと、戦闘の画面で待ち直す）
  for (const f of ['../components/V2capDungeon.jsx', '../components/V2capAtb.jsx']) {
    const src = read(f)
    assert.match(src, /preloadArt\(bossArt\.srcs\)/, f)
    assert.doesNotMatch(src, /of bossArt[^\n]*new Image\(\)/, f)
  }
  // 背景の絵と流れ図も先に読む一覧に入っている
  for (const art of [bossIllustOf('varuzenoku'), bossIllustOf('amaza'), bossArtOf('varuzenoku')]) {
    assert.ok(art.srcs.includes(art.bg.src) && art.srcs.includes(art.bg.flowSrc), art.key)
  }
})
