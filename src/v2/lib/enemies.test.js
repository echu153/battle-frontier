// バトルフロンティアⅡ 出撃の敵のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AREAS, statsOf, toFighter, areaOf, allEnemies, rollDropRank } from './enemies.js'
import { calcPower } from './stats.js'
import { runBattle } from './battle.js'
import { STAT_KEYS } from './stats.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('エリアは①〜⑧、名前と敵は旧版から流用', () => {
  assert.equal(AREAS.length, 8)
  assert.deepEqual(AREAS.map(a => a.name), [
    '始まりの森', '荒廃した草原', '古代の洞窟', '蒼海の入り江',
    '巨峰山脈', '白銀の霊峰', '煉獄火山', '蒼天の浮遊城'])
  assert.deepEqual(AREAS.map(a => a.boss.name), [
    'ビッグスライム', '盗賊団のリーダー', '古代の番人', 'シーサーペント',
    '雷鷲サンダーロック', '氷霊フロストバーン', '深紅のサラマンダー', '天空覇龍ウラノス'])
  for (const a of AREAS) assert.equal(a.enemies.length, 3, `エリア${a.id}の通常敵`)
  // 通常3体＋時間帯限定3体＋ボス1体 × 8エリア
  assert.equal(allEnemies().length, 8 * 7)
  assert.equal(areaOf(3).name, '古代の洞窟')
  assert.equal(areaOf(99), null)
})

test('敵の配分は合計100%で、戦闘力どおりのステータスになる', () => {
  for (const e of allEnemies()) {
    const sum = Object.values(e.dist).reduce((a, b) => a + b, 0)
    assert.equal(sum, 100, `${e.name} の配分`)
    for (const k of Object.keys(e.dist)) assert.ok(STAT_KEYS.includes(k), `${e.name} の ${k}`)
    // 端数の丸めぶんだけずれる。3%以内に収まっていること
    const p = calcPower(statsOf(e))
    assert.ok(Math.abs(p - e.power) / e.power < 0.03, `${e.name}: 想定${e.power} 実際${p}`)
  }
})

test('ボスはHPへ寄せてある（同じ戦闘力でも長期戦になる）', () => {
  // ★v2は戦闘力の差がそのまま勝率に出るので、旧版のようにボスのステを盛る手は使えない。
  //   代わりに配分をHPへ寄せて「硬いが一撃では溶かされない」ボスにしている
  for (const a of AREAS) {
    assert.ok(a.boss.dist.hp >= 40, `${a.boss.name} のHP配分 ${a.boss.dist.hp}%`)
    const avgEnemyHp = a.enemies.reduce((t, e) => t + e.dist.hp, 0) / a.enemies.length
    assert.ok(a.boss.dist.hp > avgEnemyHp, `${a.boss.name} は通常敵よりHPへ寄せる`)
  }
})

test('エリアが進むほど敵が強くなる', () => {
  let prev = 0
  for (const a of AREAS) {
    assert.ok(a.boss.power > prev, `エリア${a.id}のボスが前より弱い`)
    prev = a.boss.power
    for (const e of a.enemies) {
      assert.ok(e.power < a.boss.power, `${e.name} がボスより強い`)
      assert.ok(e.power > a.boss.power * 0.2, `${e.name} が弱すぎる`)
    }
  }
})

test('ドロップするランクの合計は100%で、エリアごとの範囲どおり', () => {
  const EXPECT = {
    1:['F', 'D'], 2:['F', 'C'], 3:['F', 'B'], 4:['F', 'B'],
    5:['E', 'A'], 6:['E', 'A'], 7:['D', 'A'], 8:['D', 'A'],
  }
  for (const a of AREAS) {
    const ks = Object.keys(a.dropRanks)
    assert.equal(Object.values(a.dropRanks).reduce((x, y) => x + y, 0), 100, `エリア${a.id}のドロップ率`)
    assert.deepEqual([ks[0], ks[ks.length - 1]], EXPECT[a.id], `エリア${a.id}の範囲`)
    // ランクが高いほど落ちにくい（同率は可）
    const vs = Object.values(a.dropRanks)
    for (let i = 1; i < vs.length; i++) assert.ok(vs[i] <= vs[i - 1], `エリア${a.id}: 上位ランクのほうが出やすい`)
    // Sはエリア①〜⑧では落ちない
    assert.equal(a.dropRanks.S, undefined, `エリア${a.id}でSが落ちる`)
  }
})

test('ドロップランクの抽選が分布どおりに出る', () => {
  const a = areaOf(1)   // F40 E40 D20
  const rng = mkRng(42)
  const count = { F:0, E:0, D:0 }
  for (let i = 0; i < 4000; i++) count[rollDropRank(a, rng)]++
  assert.ok(Math.abs(count.F / 4000 - 0.40) < 0.03, `F=${count.F}`)
  assert.ok(Math.abs(count.E / 4000 - 0.40) < 0.03, `E=${count.E}`)
  assert.ok(Math.abs(count.D / 4000 - 0.20) < 0.03, `D=${count.D}`)
})

test('敵はそのまま runBattle に渡せて、戦闘が成立する', () => {
  const rng = mkRng(7)
  const a = areaOf(1)
  const foe = toFighter(a.enemies[0])
  const me = { name:'me', cls:'戦士', stats:{ hp:1200, mp:400, str:150, dex:150, agi:150, int_stat:150, vit:150, luk:150 } }
  const r = runBattle(me, foe, { rng })
  assert.ok(['a', 'b', 'draw'].includes(r.winner))
  assert.ok(r.turns >= 1)
  assert.ok(r.log.length > 0)
  // 敵もスキルを撃っている
  assert.ok(r.log.some(l => l.side === a.enemies[0].name && (l.type === 'skill' || l.type === 'normal')))
})

test('敵のスキルはプレイヤーと同じ形（runBattleが解釈できる）', () => {
  for (const e of allEnemies()) {
    assert.ok(e.skills.length >= 1, `${e.name} にスキルが無い`)
    assert.ok(e.skills.length <= 5, `${e.name} のスキルが5枠を超えている`)
    for (const s of e.skills) {
      assert.ok(s.name, 'スキル名')
      assert.ok(['phys', 'mag', 'heal', 'buff'].includes(s.kind), `${s.name} の種別 ${s.kind}`)
      assert.ok(s.proc >= 40 && s.proc <= 100, `${s.name} の発動率 ${s.proc}`)
      if (s.kind === 'phys' || s.kind === 'mag') assert.ok(s.mult > 0 && s.mult <= 4, `${s.name} の倍率 ${s.mult}`)
    }
    // ボスは4枠以上（長期戦なのでローテーションが回る）
  }
  for (const a of AREAS) assert.ok(a.boss.skills.length >= 4, `${a.boss.name} のスキル数`)
})

// ============================================================
// 状態異常（2026-08-17）
// ★ここが空に戻ると、敵は状態異常を一切撒かなくなり、エンチャントの抵抗系
//   （毒キノコ「毒10%軽減」・払暁のワイバーン「全状態異常抵抗+5%」）が
//   打ち消すものを失って**完全に無意味**になる。
// ============================================================

test('敵のスキルは名前どおりの状態異常を持つ', () => {
  const byName = {}
  for (const e of allEnemies()) for (const s of e.skills) byName[s.name] = s
  assert.equal(byName['どくのほうし']?.ail?.key, 'poison', 'どくのほうし＝毒')
  assert.equal(byName['電撃']?.ail?.key,         'paralyze', '電撃＝麻痺')
  assert.equal(byName['つらら']?.ail?.key,       'slow',   'つらら＝鈍足')
  assert.equal(byName['かみつく']?.ail?.key,     'bleed',  'かみつく＝出血')
  assert.equal(byName['ほねきり']?.ail?.key,     'bleed',  'ほねきり＝出血')
  // 麻痺は「1ターン行動できない」＝一番重いので確率を低く保つ
  assert.ok(byName['電撃'].ail.chance <= 15, '麻痺の確率は低いまま')
  // 状態異常を撒く敵が消えていないこと（0になったら抵抗エンチャントが死ぬ）
  const spreaders = allEnemies().filter(e => e.skills.some(s => s.ail))
  assert.ok(spreaders.length >= 10, `状態異常を撒く敵が居る（${spreaders.length}体）`)
})

test('敵の状態異常が実戦でこちらに入る（敵→プレイヤー方向が通っている）', () => {
  const kinoko = allEnemies().find(e => e.name === '毒キノコ')
  let poisoned = 0
  for (let seed = 1; seed <= 40; seed++) {
    // こちらは硬く・攻撃力を低くして、毒キノコが何度も撃てるようにする
    const me = { name:'me', cls:'戦士', stats:{ hp:60000, mp:400, str:1, dex:150, agi:1, int_stat:1, vit:150, luk:1 } }
    const r = runBattle(me, toFighter(kinoko, 30), { rng: mkRng(seed), maxTurns: 30 })
    if (r.log.some(l => l.type === 'ailment' && l.side === 'me' && l.ail === '毒')) poisoned++
  }
  assert.ok(poisoned > 0, `毒が入った戦闘がある（${poisoned}/40）`)
})

test('抵抗のエンチャントを着けると状態異常が入りにくくなる', () => {
  const kinoko = allEnemies().find(e => e.name === '毒キノコ')
  const count = (enchants) => {
    let n = 0
    for (let seed = 1; seed <= 120; seed++) {
      const me = {
        name:'me', cls:'戦士', enchants,
        stats:{ hp:60000, mp:400, str:1, dex:150, agi:1, int_stat:1, vit:150, luk:1 },
      }
      const r = runBattle(me, toFighter(kinoko, 30), { rng: mkRng(seed), maxTurns: 30 })
      n += r.log.filter(l => l.type === 'ailment' && l.side === 'me' && l.ail === '毒').length
    }
    return n
  }
  const bare = count([])
  // 毒キノコ＝毒10%軽減 ／ 払暁のワイバーン＝全状態異常抵抗+5%（合わせて-15%）
  const guarded = count(['毒キノコ', '払暁のワイバーン'])
  assert.ok(bare > 0, '素だと毒が入る')
  assert.ok(guarded < bare, `抵抗ありのほうが少ない（素${bare} → 抵抗${guarded}）`)
})
