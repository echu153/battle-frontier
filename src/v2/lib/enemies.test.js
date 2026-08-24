// バトルフロンティアⅡ 出撃の敵のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AREAS, AREAS_SORTED, statsOf, toFighter, areaOf, allEnemies, allRares, rarePoolAt, rollDropRank,
  TIER_MAX, tierOf, areasOfTier, areaLabel, areaFullName,
  BIAS_MULT, biasLabelOf, takenMultOf, areaOfEnemy,
} from './enemies.js'
import { calcPower } from './stats.js'
import { runBattle } from './battle.js'
import { STAT_KEYS } from './stats.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('エリアは15。①〜③の名前と敵は旧版から流用、④以降は帯に複数ある', () => {
  assert.equal(AREAS.length, 15)
  assert.deepEqual(AREAS_SORTED.map(a => a.name), [
    '始まりの森', '荒廃した草原', '古代の洞窟',
    '蒼海の入り江', '灼砂の遺丘',
    '巨峰山脈', '常闇の樹海',
    '白銀の霊峰', '雷鳴の断崖',
    '煉獄火山', '腐海の沼獄', '奈落の坑道',
    '蒼天の浮遊城', '星霜の遺跡', '深淵の海溝'])
  assert.deepEqual(AREAS_SORTED.map(a => a.boss.name), [
    'ビッグスライム', '盗賊団のリーダー', '古代の番人',
    'シーサーペント', '砂皇スカラベウス',
    '雷鷲サンダーロック', '森王エルダートレント',
    '氷霊フロストバーン', '雷帝ケラウノス',
    '深紅のサラマンダー', '毒龍ヴェノムヒュドラ', '巌喰いガイアモール',
    '天空覇龍ウラノス', '時星龍アイオーン', '深海覇王リヴァイアサン'])
  for (const a of AREAS) assert.equal(a.enemies.length, 3, `エリア${a.id}の通常敵`)
  // 通常3体＋時間帯限定3体＋ボス1体＋レアモンスター5体 × 15エリア
  assert.equal(allEnemies().length, 15 * 12)
  assert.equal(areaOf(3).name, '古代の洞窟')
  assert.equal(areaOf(99), null)
})

// ★2026-08-22 ユーザー決定：④⑤⑥は2エリア・⑦⑧は3エリア。帯を全部踏破すると次が開く
test('難易度帯ごとのエリア数は ①②③=1 / ④⑤⑥=2 / ⑦⑧=3', () => {
  assert.deepEqual(
    Array.from({ length: TIER_MAX }, (_, i) => areasOfTier(i + 1).length),
    [1, 1, 1, 2, 2, 2, 3, 3])
  // 同じ帯に居ないエリアが紛れていないこと（idは続き番号なので tier でしか分からない）
  for (const a of AREAS) assert.equal(tierOf(a.id), a.tier, `エリア${a.id}の帯`)
  // 表示用のラベル。帯に1つしか無ければ枝番を付けない
  assert.equal(areaLabel(1), '①')
  assert.equal(areaLabel(4), '④-1')
  assert.equal(areaLabel(9), '④-2')
  assert.equal(areaFullName(13), '⑦-3 奈落の坑道')
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

test('帯が上がるほど敵が強くなり、同じ帯のエリアは同格', () => {
  let prev = 0
  for (let t = 1; t <= TIER_MAX; t++) {
    const list = areasOfTier(t)
    // ★同じ帯は**同格**（どちらから挑んでもいい・2026-08-22 ユーザー決定）
    for (const a of list) assert.equal(a.boss.power, list[0].boss.power, `エリア${a.id}のボスが帯の中でズレている`)
    assert.ok(list[0].boss.power > prev, `難易度${t}のボスが前の帯より弱い`)
    prev = list[0].boss.power
  }
  for (const a of AREAS) {
    for (const e of a.enemies) {
      assert.ok(e.power < a.boss.power, `${e.name} がボスより強い`)
      assert.ok(e.power > a.boss.power * 0.2, `${e.name} が弱すぎる`)
    }
  }
})

test('ドロップするランクの合計は100%で、エリアごとの範囲どおり', () => {
  // ★キーは**難易度帯**。同じ帯のエリアはドロップ範囲もそろえる
  const EXPECT = {
    1:['F', 'D'], 2:['F', 'C'], 3:['F', 'B'], 4:['F', 'B'],
    5:['E', 'A'], 6:['E', 'A'], 7:['D', 'A'], 8:['D', 'A'],
  }
  for (const a of AREAS) {
    const ks = Object.keys(a.dropRanks)
    assert.equal(Object.values(a.dropRanks).reduce((x, y) => x + y, 0), 100, `エリア${a.id}のドロップ率`)
    assert.deepEqual([ks[0], ks[ks.length - 1]], EXPECT[a.tier], `エリア${a.id}の範囲`)
    assert.deepEqual(a.dropRanks, areasOfTier(a.tier)[0].dropRanks, `エリア${a.id}のドロップ表が帯の中でズレている`)
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

// ★2026-08-22 ユーザー決定：同じ帯の中で片方は物理・片方は特殊が通りやすい／3つ目はバランス
test('帯に複数エリアあるとき、物理型と特殊型が1つずつ（3つ目はバランス型）', () => {
  for (let t = 1; t <= TIER_MAX; t++) {
    const list = areasOfTier(t)
    const kinds = list.map(a => a.bias)
    if (list.length === 1) {
      assert.deepEqual(kinds, [null], `難易度${t}は1エリアなのでバランス型`)
      continue
    }
    assert.equal(kinds.filter(b => b === 'phys').length, 1, `難易度${t}の物理型`)
    assert.equal(kinds.filter(b => b === 'mag').length, 1, `難易度${t}の特殊型`)
    assert.equal(kinds.filter(b => b === null).length, list.length - 2, `難易度${t}のバランス型`)
  }
  assert.equal(biasLabelOf('phys'), '物理が通りやすい')
  assert.equal(biasLabelOf(null), 'バランス型')
  assert.deepEqual(takenMultOf(areaOf(4)), { phys: BIAS_MULT })
  assert.deepEqual(takenMultOf(areaOf(9)), { mag: BIAS_MULT })
  assert.equal(takenMultOf(areaOf(13)), null)
})

// ★ここが抜けると、エリアの相性が**戦闘に届かない**（データだけあって効かない）
test('敵をrunBattle用にすると、そのエリアの相性が付いてくる', () => {
  assert.equal(areaOfEnemy('砂喰いワーム').id, 9)
  assert.equal(areaOfEnemy('居ない敵'), null)
  assert.deepEqual(toFighter(areaOf(4).boss).taken, { phys: BIAS_MULT })
  assert.deepEqual(toFighter(areaOf(9).enemies[0]).taken, { mag: BIAS_MULT })
  assert.equal(toFighter(areaOf(1).boss).taken, null)
})

// ============================================================
// ★レアモンスター（2026-08-25 ユーザー指示）
//   ・エリアごとに5体（常時2体＋朝・昼・晩に1体ずつ）
//   ・強さは**そのエリアのボスと同じくらい**
//   ・出現率は 0.5% 固定（sortie.js 側で見る）
// ============================================================
test('レアモンスターはエリアごとに5体（常時2＋朝昼晩1体ずつ）', () => {
  for (const a of AREAS) {
    assert.equal(a.rares.length, 5, `エリア${a.id}のレアモンスター`)
    assert.equal(a.rares.filter(r => !r.band).length, 2, `エリア${a.id}の常時レア`)
    assert.deepEqual(a.rares.filter(r => r.band).map(r => r.band), ['朝', '昼', '晩'], `エリア${a.id}の時間帯レア`)
    for (const r of a.rares) assert.equal(r.isRare, true, `${r.name} に isRare が無い`)
  }
  assert.equal(allRares().length, 75)
  assert.equal(new Set(allRares().map(r => r.name)).size, 75, '名前が重複している')
})

test('レアモンスターの強さはそのエリアのボスと同じ', () => {
  for (const a of AREAS) {
    for (const r of a.rares) {
      assert.equal(r.power, a.boss.power, `${r.name} の戦闘力`)
      // 配分どおりのステータスになっていること（3%以内）
      const p = calcPower(statsOf(r))
      assert.ok(Math.abs(p - r.power) / r.power < 0.03, `${r.name}: 想定${r.power} 実際${p}`)
    }
  }
})

test('レアモンスターも runBattle にそのまま渡せる', () => {
  const rare = AREAS[0].rares[0]
  const me = { name:'me', cls:'戦士', stats:{ hp:1200, mp:400, str:150, dex:150, agi:150, int_stat:150, vit:150, luk:150 } }
  const r = runBattle(me, toFighter(rare), { rng: mkRng(7) })
  assert.ok(['a', 'b', 'draw'].includes(r.winner))
  assert.ok(r.turns >= 1, '戦闘が成立していない')
  assert.ok(r.log.some(l => l.side === rare.name), 'レアモンスターが動いていない')
})

test('その時間帯に出るレアだけが並ぶ', () => {
  const a = AREAS[0]
  const morning = rarePoolAt(a, '朝').map(r => r.name)
  assert.equal(morning.length, 3, '常時2体＋朝の1体')
  assert.deepEqual(rarePoolAt(a, '朝').filter(r => r.band).map(r => r.band), ['朝'])
  assert.equal(rarePoolAt(a, '昼').length, 3)
  assert.equal(rarePoolAt(a, '晩').length, 3)
})
