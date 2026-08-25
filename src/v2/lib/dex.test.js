// バトルフロンティアⅡ モンスター図鑑のテスト（node --test）
import test from 'node:test'
import assert from 'node:assert/strict'
import { UNKNOWN, KILL_TIERS, killBonusPct, nextKillTier, dexProgress, killMapOf, foundSetOf } from './dex.js'

test('まだ倒していないものは ??? で出す', () => {
  assert.equal(UNKNOWN, '???')
})

// ★討伐数によるステータス上昇は**まだ値を決めていない**（2026-08-26 ユーザー「※後で設定」）。
//   ここは「段を足したときに正しく効くか」を先に固定しておく枠。
test('討伐数のごほうびは、いまは何も乗らない', () => {
  assert.deepEqual(KILL_TIERS, [], '段を足したらこのテストも直すこと')
  assert.equal(killBonusPct(0), 0)
  assert.equal(killBonusPct(99999), 0)
  assert.equal(nextKillTier(0), null)
})

test('段を足すと、越えた段の割合に置き換わる（積み上げではない）', () => {
  const tiers = [{ n:10, pct:1 }, { n:50, pct:2 }, { n:100, pct:3 }]
  const pctOf = (n) => { let p = 0; for (const t of tiers) if (n >= t.n) p = t.pct; return p }
  assert.equal(pctOf(0), 0)
  assert.equal(pctOf(10), 1)
  assert.equal(pctOf(49), 1)
  assert.equal(pctOf(50), 2)
  assert.equal(pctOf(1000), 3)
  // KILL_TIERS は討伐数の小さい順に並んでいること（並びが崩れると置き換えがおかしくなる）
  for (let i = 1; i < KILL_TIERS.length; i++) {
    assert.ok(KILL_TIERS[i].n > KILL_TIERS[i - 1].n, '段が討伐数の順に並んでいない')
    assert.ok(KILL_TIERS[i].pct > KILL_TIERS[i - 1].pct, '段が進んでも割合が増えていない')
  }
})

test('図鑑の埋まり具合は「1体でも倒した敵」の数', () => {
  const kills = { スライム: 3, コウモリ: 1 }
  assert.deepEqual(dexProgress(['スライム', 'コウモリ', '毒キノコ', 'ビッグスライム'], kills),
    { done: 2, total: 4, pct: 50 })
  assert.deepEqual(dexProgress([], {}), { done: 0, total: 0, pct: 0 })
  // 0体は「見つけていない」扱い
  assert.equal(dexProgress(['スライム'], { スライム: 0 }).done, 0)
})

test('サーバーの行を画面が使う形に直す', () => {
  assert.deepEqual(killMapOf([{ enemy:'スライム', n:5 }, { enemy:'コウモリ', n:1 }]),
    { スライム: 5, コウモリ: 1 })
  assert.deepEqual(killMapOf(null), {})
  const set = foundSetOf([{ material_id:'m:1:0:n' }, { material_id:'m:1:0:r' }])
  assert.ok(set.has('m:1:0:n'))
  assert.ok(!set.has('m:1:0:u'))
  assert.equal(foundSetOf(undefined).size, 0)
})

// ★画面が「倒すまで名前を出さない」ことを縛る。ここが緩むと図鑑の意味が消える
test('★図鑑の画面は、倒していない敵の名前も素材の名前も出さない', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../components/V2Dex.jsx', import.meta.url), 'utf8')
  assert.match(src, /seen \? e\.name : UNKNOWN/, '敵の名前を出しっぱなしにしている')
  assert.match(src, /got \? m\.name : UNKNOWN/, '素材の名前を出しっぱなしにしている')
  // しぼり込みでも漏らさない（未討伐の敵が検索で出てこないこと）
  assert.match(src, /if \(!\(kills\[e\.name\] > 0\)\) return false/, 'しぼり込みから未討伐が漏れる')
})
