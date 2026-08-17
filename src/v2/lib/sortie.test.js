// バトルフロンティアⅡ 出撃の進行まわりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOSS_RATE_STEP, rollBoss, nextBossRate, isAreaUnlocked, unlockNext,
  expOf, rewardsOf, pickEncounter, EXP_BOSS, EXP_ZAKO_MIN, EXP_ZAKO_MAX, LAST_AREA,
  COOLDOWNS, DEFAULT_COOLDOWN, cooldownOf,
  featuredPartAt, nextSwitchAt, featuredSchedule, rollDropPart, rollDrop,
  BANDS, bandAt, enemyPoolAt, DROP_RATE, dropRateOf, rollHasDrop,
} from './sortie.js'
import { PARTS, ITEM_BY_ID } from './equipment.js'
import { allEnemies, areaOf } from './enemies.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('ボスは旧版と同じピティ方式（戦うたび積み上がり、当たると0へ戻る）', () => {
  assert.equal(nextBossRate(0, false), BOSS_RATE_STEP)
  assert.equal(nextBossRate(5, false), 5 + BOSS_RATE_STEP)
  assert.equal(nextBossRate(50, true), 0, 'ボスに当たったら0へ戻す')
  // 遭遇率0なら絶対に出ない・100なら必ず出る
  const rng = mkRng(3)
  for (let i = 0; i < 200; i++) assert.equal(rollBoss(0, rng), false)
  for (let i = 0; i < 200; i++) assert.equal(rollBoss(100, rng), true)
})

test('ボスは旧版より出にくい（平均23回前後）', () => {
  // ★旧版は +0.5%/回 で平均18.4回。v2は「もう少し出にくく」して +0.3%/回
  assert.equal(BOSS_RATE_STEP, 0.3)
  const rng = mkRng(99)
  let total = 0
  const trials = 3000
  for (let i = 0; i < trials; i++) {
    let rate = 0, count = 0
    for (;;) { count++; if (rollBoss(rate, rng)) break; rate = nextBossRate(rate, false) }
    total += count
  }
  const avg = total / trials
  assert.ok(avg > 20 && avg < 28, `平均${avg.toFixed(1)}回`)
})

test('エリアはボス撃破で次が開く（旧版と同じ）', () => {
  assert.ok(isAreaUnlocked([], 1), '①は最初から')
  assert.ok(!isAreaUnlocked([1], 2))
  // ①のボスに勝つと②が開く
  assert.deepEqual(unlockNext([1], 1, true, true), [1, 2])
  // 通常敵に勝っても開かない／ボスに負けても開かない
  assert.deepEqual(unlockNext([1], 1, true, false), [1])
  assert.deepEqual(unlockNext([1], 1, false, true), [1])
  // 二重に足さない
  assert.deepEqual(unlockNext([1, 2], 1, true, true), [1, 2])
  // ⑧の先は無い（旧版と同じ）
  assert.deepEqual(unlockNext([1, 2, 3, 4, 5, 6, 7, 8], LAST_AREA, true, true), [1, 2, 3, 4, 5, 6, 7, 8])
  // ⑦を倒すと⑧が開く
  assert.ok(unlockNext([1, 2, 3, 4, 5, 6, 7], 7, true, true).includes(8))
})

test('EXPは旧版と同じ（通常8〜11・ボス13）', () => {
  const rng = mkRng(11)
  assert.equal(expOf(true, rng), EXP_BOSS)
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const e = expOf(false, rng)
    assert.ok(e >= EXP_ZAKO_MIN && e <= EXP_ZAKO_MAX, `EXP=${e}`)
    seen.add(e)
  }
  assert.equal(seen.size, EXP_ZAKO_MAX - EXP_ZAKO_MIN + 1, '8〜11が全部出る')
})

test('敵はGoldを落とさない（Goldは素材の売却で稼ぐ）', () => {
  // ★2026-08-17 ユーザー決定（docs/v2-gold-design.md）。
  //   ここが緩むと「敵からもGold・素材売却でもGold」の二重の湧き口になる
  for (const e of allEnemies()) {
    assert.equal(e.gold, undefined, `${e.name} にGoldが残っている`)
  }
  const r = rewardsOf({ area: areaOf(1), enemy: areaOf(1).boss, isBoss: true, win: true }, mkRng(1))
  assert.equal(r.gold, undefined, '報酬にGoldが入っている')
  assert.ok(r.exp > 0, 'EXPは入る')
})

test('遭遇はそのエリアの敵から選ばれる', () => {
  const rng = mkRng(21)
  const area = areaOf(3)
  const names = new Set()
  for (let i = 0; i < 300; i++) {
    const enc = pickEncounter(3, 0, new Date(), rng)   // 遭遇率0なので必ず通常敵
    assert.equal(enc.isBoss, false)
    names.add(enc.enemy.name)
  }
  // ★その時間帯の限定敵も4体目として並ぶ
  assert.deepEqual([...names].sort(), enemyPoolAt(area, new Date()).map(e => e.name).sort())
  // 遭遇率100なら必ずボス
  assert.equal(pickEncounter(3, 100, new Date(), rng).enemy.name, area.boss.name)
  assert.equal(pickEncounter(99, 0, new Date(), rng), null, '無いエリア')
})

test('出撃のクールタイムは10秒と20秒から選べる', () => {
  assert.deepEqual(COOLDOWNS, [10, 20])
  assert.equal(cooldownOf(10), 10)
  assert.equal(cooldownOf(20), 20)
  assert.equal(cooldownOf(1), DEFAULT_COOLDOWN, '知らない値は既定へ落とす')
  assert.equal(cooldownOf(undefined), DEFAULT_COOLDOWN)
  // ⚠EXPとGoldはどちらのモードでも同じ（旧版は10秒だけ半分だった）
  const rng = mkRng(4)
  assert.equal(expOf(true, rng), EXP_BOSS, 'CDによってEXPは変わらない')
})

test('落ちやすい部位は1時間ごとに入れ替わる（時刻から決まる＝全員共通）', () => {
  const at = new Date('2026-08-15T00:30:00+09:00')
  const p0 = featuredPartAt(at)
  // 同じ時間の中では変わらない
  assert.equal(featuredPartAt(new Date('2026-08-15T00:59:59+09:00')), p0)
  // 次の時間には変わる
  const p1 = featuredPartAt(new Date('2026-08-15T01:00:00+09:00'))
  assert.notEqual(p1, p0)
  // 6部位あるので6時間で一周する
  assert.equal(featuredPartAt(new Date('2026-08-15T06:30:00+09:00')), p0)
  // 切替はちょうど毎時0分
  assert.equal(nextSwitchAt(at).toISOString(), new Date('2026-08-15T01:00:00+09:00').toISOString())
  // 予定は連続していて、全部位が出てくる
  const sch = featuredSchedule(at, 6)
  assert.equal(new Set(sch.map(x => x.part)).size, PARTS.length, '6時間で全部位が回る')
})

test('部位は完全ランダムだが、その時間の部位だけ2倍出やすい', () => {
  const at = new Date('2026-08-15T00:30:00+09:00')
  const hot = featuredPartAt(at)
  const rng = mkRng(88)
  const count = Object.fromEntries(PARTS.map(p => [p, 0]))
  const N = 20000
  for (let i = 0; i < N; i++) count[rollDropPart(at, rng)]++
  // 重み 2 : 1×5 なので 2/7 と 1/7
  assert.ok(Math.abs(count[hot] / N - 2 / 7) < 0.02, `${hot}=${(count[hot] / N * 100).toFixed(1)}%`)
  for (const p of PARTS) {
    if (p === hot) continue
    assert.ok(Math.abs(count[p] / N - 1 / 7) < 0.02, `${p}=${(count[p] / N * 100).toFixed(1)}%`)
    assert.ok(count[hot] > count[p] * 1.5, `${hot} が ${p} より出やすくない`)
  }
})

test('ドロップはそのエリアのランク範囲に収まり、実在する装備を返す', () => {
  const rng = mkRng(31)
  for (const id of [1, 4, 8]) {
    const allowed = Object.keys(areaOf(id).dropRanks)
    for (let i = 0; i < 400; i++) {
      const d = rollDrop(id, new Date(), rng)
      assert.ok(d, `エリア${id}のドロップ`)
      assert.ok(allowed.includes(d.rank), `エリア${id}で${d.rank}級が落ちた`)
      assert.ok(ITEM_BY_ID[d.id], `${d.name} がカタログに無い`)
    }
  }
  assert.equal(rollDrop(99, new Date(), rng), null)
})

test('時間帯は朝5〜12・昼13〜20・晩21〜4（JST・各8時間）', () => {
  const at = (h) => new Date(`2026-08-15T${String(h).padStart(2, '0')}:30:00+09:00`)
  assert.deepEqual(BANDS, ['朝', '昼', '晩'])
  for (const h of [5, 8, 12]) assert.equal(bandAt(at(h)), '朝', `${h}時`)
  for (const h of [13, 17, 20]) assert.equal(bandAt(at(h)), '昼', `${h}時`)
  for (const h of [21, 23, 0, 4]) assert.equal(bandAt(at(h)), '晩', `${h}時`)
})

test('時間帯限定の敵が各エリアに1体ずつ、その時間だけ抽選に加わる', () => {
  for (const id of [1, 4, 8]) {
    const area = areaOf(id)
    assert.equal(area.timed.length, 3, `エリア${id}の限定敵`)
    assert.deepEqual(area.timed.map(e => e.band), BANDS)
    for (const band of BANDS) {
      const at = new Date(band === '朝' ? '2026-08-15T06:00:00+09:00'
        : band === '昼' ? '2026-08-15T15:00:00+09:00' : '2026-08-15T23:00:00+09:00')
      const pool = enemyPoolAt(area, at)
      assert.equal(pool.length, 4, '通常3体＋限定1体')
      const timed = pool[3]
      assert.equal(timed.band, band)
      // 限定敵は通常敵の最上位より強い
      const maxNormal = Math.max(...area.enemies.map(e => e.power))
      assert.ok(timed.power > maxNormal, `${timed.name} の戦闘力`)
      // ボスより弱い
      assert.ok(timed.power < area.boss.power, `${timed.name} がボスより強い`)
    }
  }
  // 24体の名前が全部ちがう
  const names = [1, 2, 3, 4, 5, 6, 7, 8].flatMap(id => areaOf(id).timed.map(e => e.name))
  assert.equal(names.length, 24)
  assert.equal(new Set(names).size, 24)
})

test('装備が落ちる確率は10秒3%・20秒4%', () => {
  // ★20秒のほうが1回あたりは高い（10秒の効率2倍をいくらか相殺する）。
  //   時間あたりでは 10秒=0.30%/秒・20秒=0.20%/秒 でまだ10秒が1.5倍有利
  assert.deepEqual(DROP_RATE, { 10:3, 20:4 })
  assert.equal(dropRateOf(10), 3)
  assert.equal(dropRateOf(20), 4)
  assert.equal(dropRateOf(999), 4, '知らない値は既定(20秒)へ')
  const rng = mkRng(55)
  let n10 = 0, n20 = 0
  const N = 40000
  for (let i = 0; i < N; i++) if (rollHasDrop(10, rng)) n10++
  for (let i = 0; i < N; i++) if (rollHasDrop(20, rng)) n20++
  assert.ok(Math.abs(n10 / N - 0.03) < 0.004, `10秒 ${(n10 / N * 100).toFixed(2)}%`)
  assert.ok(Math.abs(n20 / N - 0.04) < 0.004, `20秒 ${(n20 / N * 100).toFixed(2)}%`)
  assert.ok(n20 > n10)
})
