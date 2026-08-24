// バトルフロンティアⅡ 出撃の進行まわりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOSS_RATE_STEP, rollBoss, nextBossRate, isAreaUnlocked, unlockNext,
  clearNext, clearedAreasOf, isAreaCleared,
  TIER_REQ, reqOfTier, clearedInTier, restToOpenNext, openTiersOf, LAST_TIER,
  expOf, rewardsOf, pickEncounter, EXP_BOSS, EXP_ZAKO_MIN, EXP_ZAKO_MAX,
  SORTIE_CD,
  featuredPartAt, nextSwitchAt, featuredSchedule, rollDropPart, rollDrop,
  BANDS, bandAt, enemyPoolAt, DROP_RATE, dropRateOf, rollHasDrop,
  RARE_RATE, rollRare, RARE_MATERIAL_RATE, rollMaterial,
} from './sortie.js'
import { PARTS, ITEM_BY_ID } from './equipment.js'
import { allEnemies, areaOf, rarePoolAt } from './enemies.js'

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

// ★2026-08-22 ユーザー決定：**その難易度帯を全部踏破すると次の帯が開く**
test('①〜③は1エリア踏破で次が開く', () => {
  assert.ok(isAreaUnlocked([], 1), '①は最初から')
  assert.ok(!isAreaUnlocked([1], 2))
  assert.deepEqual(TIER_REQ, { 1:1, 2:1, 3:1, 4:2, 5:2, 6:2, 7:3, 8:3 })
  assert.equal(reqOfTier(4), 2)
  // ①のボスに勝つと②が開く
  assert.deepEqual(unlockNext([1], clearNext([], 1, true, true)), [1, 2])
  // 通常敵に勝っても開かない／ボスに負けても開かない
  assert.deepEqual(unlockNext([1], clearNext([], 1, true, false)), [1])
  assert.deepEqual(unlockNext([1], clearNext([], 1, false, true)), [1])
  // 二重に足さない
  assert.deepEqual(unlockNext([1, 2], clearNext([1], 1, true, true)), [1, 2])
})

test('④以降は帯を全部踏破しないと次の帯へ行けない（④⑤⑥は2・⑦⑧は3）', () => {
  // ③を倒すと④の帯が**まとめて**開く（4と9の2エリア）
  const afterThird = unlockNext([1, 2, 3], [1, 2, 3])
  assert.deepEqual(afterThird, [1, 2, 3, 4, 9])
  // ④のエリアを1つ倒しただけでは⑤は開かない
  const one = unlockNext(afterThird, [1, 2, 3, 4])
  assert.deepEqual(one, [1, 2, 3, 4, 9], '1つだけで次の帯が開いてしまっている')
  assert.equal(restToOpenNext([1, 2, 3, 4], 4), 1)
  // 両方倒すと⑤の帯（5と10）が開く
  const both = unlockNext(one, [1, 2, 3, 4, 9])
  assert.deepEqual(both, [1, 2, 3, 4, 9, 5, 10].sort((a, b) => a - b))
  assert.equal(restToOpenNext([1, 2, 3, 4, 9], 4), 0)
  assert.equal(clearedInTier([1, 2, 3, 4, 9], 4), 2)

  // ⑦の帯は3つ必要（7・12・13）。2つでは⑧が開かない
  const t7 = [1, 2, 3, 4, 9, 5, 10, 6, 11]
  const cleared2 = [...t7, 7, 12]
  assert.ok(!unlockNext(unlockNext(t7, t7), cleared2).includes(8), '2つで⑧が開いている')
  assert.equal(restToOpenNext(cleared2, 7), 1)
  const cleared3 = [...cleared2, 13]
  const opened = unlockNext(unlockNext(t7, t7), cleared3)
  for (const id of [8, 14, 15]) assert.ok(opened.includes(id), `⑧の帯の${id}が開いていない`)
  // ⑧の先は無い
  assert.equal(LAST_TIER, 8)
  assert.deepEqual(unlockNext(opened, [...cleared3, 8, 14, 15]), opened)
})

test('一度開いた帯は閉じない（新ルールより前の解放をそのまま残す）', () => {
  // 旧仕様で⑤まで開けていた人（④は1つしか踏破していない扱いになる）
  const old = [1, 2, 3, 4, 5]
  const now = unlockNext(old, [1, 2, 3, 4])
  for (const id of old) assert.ok(now.includes(id), `${id}が閉じた`)
  // 開いていた帯のエリアは新しいぶんも一緒に開く（⑤の帯なら10も）
  assert.ok(now.includes(9) && now.includes(10), '開いている帯の新エリアが出てこない')
  // ⑥はまだ（⑤の帯を2つ踏破していない）
  assert.ok(!now.includes(6), '踏破していないのに次の帯が開いている')
  assert.deepEqual([...openTiersOf([1, 2, 3, 4], old)].sort((a, b) => a - b), [1, 2, 3, 4, 5])
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
  const r = rewardsOf({ isBoss: true, win: true }, mkRng(1))
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
    if (!enc.isRare) names.add(enc.enemy.name)         // レアはごくまれに混ざる
  }
  // ★その時間帯の限定敵も4体目として並ぶ
  assert.deepEqual([...names].sort(), enemyPoolAt(area, new Date()).map(e => e.name).sort())
  // 遭遇率100なら必ずボス
  assert.equal(pickEncounter(3, 100, new Date(), rng).enemy.name, area.boss.name)
  assert.equal(pickEncounter(99, 0, new Date(), rng), null, '無いエリア')
})

test('出撃のクールタイムは10秒固定（10／20の選択は廃止・2026-08-22）', async () => {
  assert.equal(SORTIE_CD, 10)
  // ★選ぶ仕組みごと消したこと。片方だけ残ると「画面には無いのに値だけ生きている」になる
  const sortie = await import('./sortie.js')
  for (const gone of ['COOLDOWNS', 'DEFAULT_COOLDOWN', 'cooldownOf', 'isValidCooldown']) {
    assert.equal(sortie[gone], undefined, `${gone} が残っている`)
  }
  // ⚠EXPは前から間隔で変わらない（旧版は10秒だけ半分だった）
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

test('装備が落ちる確率は3%（10秒固定になったので1本）', () => {
  assert.equal(DROP_RATE, 3)
  assert.equal(dropRateOf(), 3)
  const rng = mkRng(55)
  let hit = 0
  const N = 40000
  for (let i = 0; i < N; i++) if (rollHasDrop(rng)) hit++
  assert.ok(Math.abs(hit / N - 0.03) < 0.004, `${(hit / N * 100).toFixed(2)}%`)
})

test('ボスを倒したエリアは踏破済みになる（⑧も残る）', () => {
  // ボスに勝ったときだけ積む
  assert.deepEqual(clearNext([], 1, true, true), [1])
  assert.deepEqual(clearNext([], 1, true, false), [])
  assert.deepEqual(clearNext([], 1, false, true), [])
  assert.deepEqual(clearNext([1], 1, true, true), [1], "二重に足さない")
  // ⑧はその先が無いので unlocked では残らない＝ここでしか残らない
  assert.deepEqual(clearNext([1, 2, 3, 4, 5, 6, 7], 8, true, true), [1, 2, 3, 4, 5, 6, 7, 8])

  // 表示用：列がまだ無い（古い）プロフィールは解放状況から読み替える
  assert.deepEqual(clearedAreasOf({ unlocked_areas: [1, 2, 3] }), [1, 2])
  assert.deepEqual(clearedAreasOf({ unlocked_areas: [1] }), [])
  // 列があるなら両方を合わせる（⑧の踏破は列にしか無い）
  assert.deepEqual(clearedAreasOf({ unlocked_areas: [1, 2], cleared_areas: [1, 8] }), [1, 8])
  assert.ok(isAreaCleared(clearedAreasOf({ unlocked_areas: [1, 2] }), 1))
  assert.ok(!isAreaCleared(clearedAreasOf({ unlocked_areas: [1, 2] }), 2))
})

// ============================================================
// ★レアモンスター（2026-08-25 ユーザー指示）
//   ・出現率は **0.5% 固定**（エリア・帯・運では変わらない）
//   ・素材は**確定ドロップ**で、通常55% / レア35% / 激レア10%
// ============================================================
test('レアモンスターの出現率は0.5%固定で、ボスより先に抽選される', () => {
  assert.equal(RARE_RATE, 0.5)
  assert.equal(rollRare(() => 0.004), true)     // 0.4% は当たり
  assert.equal(rollRare(() => 0.005), false)    // 0.5% ちょうどは外れ
  assert.equal(rollRare(() => 0.5), false)
  const rng = mkRng(2025)
  let rare = 0
  const N = 200000
  for (let i = 0; i < N; i++) if (pickEncounter(1, 0, new Date(), rng).isRare) rare++
  const pct = rare / N * 100
  assert.ok(Math.abs(pct - RARE_RATE) < 0.08, `レア出現率 ${pct.toFixed(3)}%`)
  // ★ボス遭遇率100%でもレアが割り込む（0.5%しか出ないので、そちらを優先する）
  assert.equal(pickEncounter(1, 100, new Date(), () => 0).isRare, true)
  assert.equal(pickEncounter(1, 100, new Date(), () => 0.99).isBoss, true)
})

test('レアモンスターはその時間帯に出る5体のうちから選ばれる', () => {
  const rng = mkRng(11)
  const at = new Date()
  const area = areaOf(1)
  const pool = new Set(rarePoolAt(area, bandAt(at)).map(r => r.name))
  let n = 0
  for (let i = 0; i < 50000; i++) {
    const enc = pickEncounter(1, 0, at, rng)
    if (!enc.isRare) continue
    n++
    assert.ok(pool.has(enc.enemy.name), `${enc.enemy.name} はこの時間帯に出ないはず`)
  }
  assert.ok(n > 100, `レアが${n}体しか出ていない`)
})

test('レアモンスターの素材は確定で、通常55／レア35／激レア10', () => {
  assert.deepEqual(RARE_MATERIAL_RATE, { normal: 55, rare: 35, ultra: 10 })
  const rng = mkRng(31)
  const count = { normal: 0, rare: 0, ultra: 0 }
  const N = 100000
  for (let i = 0; i < N; i++) {
    const m = rollMaterial('翠玉のスライムロード', 1, rng, { sure: true })
    assert.ok(m, '確定なのに落ちなかった')
    count[m.rarity]++
  }
  for (const k of ['normal', 'rare', 'ultra']) {
    const pct = count[k] / N * 100
    assert.ok(Math.abs(pct - RARE_MATERIAL_RATE[k]) < 1, `${k} が ${pct.toFixed(1)}%`)
  }
  // ★ドロップ率upの特殊能力は確定ドロップには効かない（乗せると100%を超える）
  const rng2 = mkRng(31)
  const withMult = Array.from({ length: 1000 }, () => rollMaterial('翠玉のスライムロード', 1.5, rng2, { sure: true }))
  assert.equal(withMult.filter(Boolean).length, 1000)
})
