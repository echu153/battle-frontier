// レイドボスのテスト。数値の正は docs/v2-raid-design.md。
// ★SQL（supabase_v2_raid_20260906.sql）にも同じ数字の写しがあるので、
//   **片方だけ直したら落ちる**ように突き合わせている（v2sql.test.js と同じ考え方）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RAID_BOSSES, RAID_BOSS_BY_KEY, raidBossOf, RAID_RATE, rollRaid,
  RAID_MINUTES, RAID_COOLDOWN_HOURS, RAID_MAX_MEMBERS, RAID_TURNS, RAMP_ATK, RAMP_DEF, rampAt,
  RAID_POWER_MULT, RAID_ATK_MULT, RAID_HP, raidPowerOfTier, raidAtkPowerOfTier, raidHpOfTier,
  bossPowerOfTier, raidPowerOfArea, raidHpOfArea, toRaidFighter, bossBaseStats, atkStatsOf,
  shareOf, tierOfShare, rewardTierOf, mvpIdOf, REWARD_TIERS, TIER_SHARE,
  matCountOf, TIER_MAT_COUNT, tierCountBonus, rarityTableOf, rollRarity, TIER_RARITY,
  fusionChanceOf, TIER_FUSION_PCT, FUSION_TIER_BONUS,
  CALL_KINDS, CALL_MAX, ONLINE_MINUTES, pickRaidBoss, TIERS,
  secondsLeft, isOver, timeText,
} from './raid.js'
import { FUSIONS, FUSION_BY_ID, fusedName, canFuseItem, checkFuse, fusedAbilitiesOf } from './fusion.js'
import { FUSION_ABILITIES, ABILITY_OF, ENCHANTS, collectEnchants, abilityText } from './enchant.js'
import { allEnemies, TIER_MAX } from './enemies.js'
import { ITEM_BY_ID, CATALOG } from './equipment.js'
import { runBattle, createSide, liveStats } from './battle.js'
import { AIL_LABEL } from './ailments.js'
import { SORTIE_CD } from './sortie.js'

const SQL = readFileSync(new URL('../../../supabase_v2_raid_20260906.sql', import.meta.url), 'utf8')
const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ===== 5体 =====
test('レイドボスは5体で、無印からの4体を含んでいる', () => {
  assert.equal(RAID_BOSSES.length, 5)
  for (const n of ['黒龍ヴァルゼノク', '雨摩座', '雷鋼機神ゼルギアス', '閻魔']) {
    assert.ok(RAID_BOSSES.some(b => b.name === n), `${n} がいない`)
  }
})

test('key・名前・冠名はどれも重複しない', () => {
  for (const k of ['key', 'name', 'crown']) {
    const v = RAID_BOSSES.map(b => b[k])
    assert.equal(new Set(v).size, v.length, `${k} が重複している`)
  }
})

test('dist は合計100で、技も画像の枠もそろっている', () => {
  for (const b of RAID_BOSSES) {
    const sum = Object.values(b.dist).reduce((a, c) => a + c, 0)
    assert.equal(sum, 100, `${b.name} の dist が100でない（${sum}）`)
    assert.ok(b.skills.length >= 3, `${b.name} の技が少ない`)
    assert.ok(b.skills.every(Boolean), `${b.name} に undefined の技がある`)
    assert.ok(['phys', 'mag'].includes(b.kind), `${b.name} の kind`)
    assert.ok(Object.prototype.hasOwnProperty.call(b, 'img'), `${b.name} に img の枠が無い`)
  }
})

test('レイドボスの名前は出撃の敵と重複しない（素材の引き当てが名前なので）', () => {
  const enemies = new Set(allEnemies().map(e => e.name))
  for (const b of RAID_BOSSES) assert.ok(!enemies.has(b.name), `${b.name} が出撃の敵と同じ名前`)
})

test('raidBossOf は key で引ける／出るボスは5体から均等', () => {
  assert.equal(raidBossOf('enma')?.name, '閻魔')
  assert.equal(raidBossOf('ない'), null)
  assert.equal(Object.keys(RAID_BOSS_BY_KEY).length, 5)
  const seen = new Set()
  for (let i = 0; i < 5; i++) seen.add(pickRaidBoss(() => i / 5).key)
  assert.equal(seen.size, 5)
})

// ===== 出現 =====
test('遭遇率は0.4%（ピティは無い＝いつでも同じ確率）', () => {
  assert.equal(RAID_RATE, 0.4)
  assert.equal(rollRaid(() => 0.003), true)
  assert.equal(rollRaid(() => 0.005), false)
})

// ===== 強さ（エリアの難易度帯で決まる） =====
test('強さは帯だけで決まる（挑む人の戦闘力では変わらない）', () => {
  assert.deepEqual(TIERS, [1, 2, 3, 4, 5, 6, 7, 8])
  for (const t of TIERS) {
    assert.equal(raidPowerOfTier(t), Math.round(bossPowerOfTier(t) * RAID_POWER_MULT), `帯${t}の戦闘力`)
    assert.ok(raidHpOfTier(t) > 0, `帯${t}のHPが無い`)
  }
  // 帯が上がるほど必ず強くなる
  for (let t = 2; t <= TIER_MAX; t++) {
    assert.ok(raidPowerOfTier(t) > raidPowerOfTier(t - 1), `帯${t}が帯${t - 1}より弱い`)
    assert.ok(raidHpOfTier(t) > raidHpOfTier(t - 1), `帯${t}のHPが帯${t - 1}以下`)
  }
})

test('HPの表は8帯ぶんそろっている（帯ごとに測った値）', () => {
  assert.deepEqual(Object.keys(RAID_HP).map(Number).sort((a, b) => a - b), TIERS)
})

test('エリアIDからも帯なりの強さが引ける', () => {
  // ⑧の帯にあるエリア（id は難易度順ではない）
  assert.equal(raidPowerOfArea(8), raidPowerOfTier(8))
  assert.equal(raidHpOfArea(14), raidHpOfTier(8))
  assert.equal(raidPowerOfArea(1), raidPowerOfTier(1))
})

test('★攻撃ステだけ低い戦闘力で作る（守りと同じにすると30ターンもたない）', () => {
  assert.ok(RAID_ATK_MULT < RAID_POWER_MULT / 10, '攻撃の倍率が守りに近すぎる')
  for (const t of TIERS) {
    assert.equal(raidAtkPowerOfTier(t), Math.max(1, Math.round(bossPowerOfTier(t) * RAID_ATK_MULT)))
  }
  const b = RAID_BOSSES[0]
  const atk = atkStatsOf(b, 5)
  const full = bossBaseStats(b, 5)
  assert.equal(full.str, atk.str, '表示用のステに攻撃ぶんが反映されていない')
  assert.equal(full.hp, raidHpOfTier(5), '表示用のHPがレイドのものになっていない')
  // 守りのステ（VIT）は攻撃ステよりずっと大きい
  assert.ok(full.vit > full.str * 3, '守りより攻めが高い＝壁になっていない')
})

// ===== 1回の挑戦（30ターン・たかぶり） =====
test('1回の挑戦は30ターンで、たかぶりが乗っている', () => {
  assert.equal(RAID_TURNS, 30)
  const f = toRaidFighter(RAID_BOSSES[0], 5, 1234)
  assert.equal(f.stats.hp, 1234)
  assert.deepEqual(f.ramp, { atk: RAMP_ATK, def: RAMP_DEF })
  assert.equal(toRaidFighter(RAID_BOSSES[0], 5).stats.hp, raidHpOfTier(5))
  assert.deepEqual(rampAt(1), { atk: 0, def: 0 })
  assert.deepEqual(rampAt(11), { atk: RAMP_ATK * 10, def: RAMP_DEF * 10 })
})

test('★たかぶりはターンが進むほど火力と耐久を上げる（ふつうの戦闘には効かない）', () => {
  const boss = toRaidFighter(RAID_BOSSES[0], 5, 9e9)
  const side = createSide(boss)
  const t1 = liveStats(side)
  side.ramp.turn = 10
  const t11 = liveStats(side)
  assert.ok(t11.str > t1.str, '10ターン後にSTRが上がっていない')
  assert.ok(t11.vit > t1.vit, '10ターン後にVITが上がっていない')
  // ramp を渡していない相手はまったく変わらない（既存の戦闘に影響しない）
  const plain = createSide({ name:'ふつうの敵', stats:{ hp:100, mp:10, str:10, dex:10, agi:10, int_stat:10, vit:10, luk:10 }, slots:[] })
  assert.equal(plain.ramp, null)
})

test('★たかぶりがあると、同じ30ターンでも与ダメが落ちる（後半が通らなくなる）', () => {
  const me = {
    name: 'テスト', cls: '侍', stats: { hp: 4000, mp: 600, str: 1400, dex: 800, agi: 800, int_stat: 200, vit: 700, luk: 300 },
    slots: [],
  }
  const dmgOf = (ramp) => {
    let d = 0
    for (let i = 0; i < 30; i++) {
      const foe = toRaidFighter(RAID_BOSSES[0], 5, 9e9)
      if (!ramp) foe.ramp = undefined
      const r = runBattle(me, foe, { rng: rngOf(i * 7919), maxTurns: RAID_TURNS })
      d += r.b.base.hp - r.b.hp
    }
    return d
  }
  assert.ok(dmgOf(true) < dmgOf(false), 'たかぶりが与ダメを抑えていない')
})

test('1発でHPの1/100より多く削れない（サーバーの上限に収まっている）', () => {
  const me = {
    name: 'テスト', cls: '侍', stats: { hp: 4000, mp: 600, str: 1400, dex: 800, agi: 800, int_stat: 200, vit: 700, luk: 300 },
    slots: [],
  }
  const max = raidHpOfTier(5)
  const r = runBattle(me, toRaidFighter(RAID_BOSSES[0], 5), { rng: rngOf(1), maxTurns: RAID_TURNS })
  const dmg = r.b.base.hp - r.b.hp
  assert.ok(dmg > 0, '1ターンも通っていない')
  assert.ok(dmg < max / 100, `1発が上限（最大HPの1/100）を超えている：${dmg}`)
})

// ===== 報酬のティア =====
test('share は 0〜1 に丸められる', () => {
  assert.equal(shareOf(50, 100), 0.5)
  assert.equal(shareOf(500, 100), 1)
  assert.equal(shareOf(-5, 100), 0)
  assert.equal(shareOf(10, 0), 0)
})

test('貢献度でティアが上がる（A:25% / B:10% / C:3% / それ未満はD）', () => {
  assert.deepEqual(REWARD_TIERS, ['A', 'B', 'C', 'D'])
  assert.equal(tierOfShare(0.30), 'A')
  assert.equal(tierOfShare(TIER_SHARE.A), 'A')
  assert.equal(tierOfShare(0.24), 'B')
  assert.equal(tierOfShare(0.10), 'B')
  assert.equal(tierOfShare(0.09), 'C')
  assert.equal(tierOfShare(0.03), 'C')
  assert.equal(tierOfShare(0.02), 'D')
  assert.equal(tierOfShare(0), 'D')
})

test('★主催者とMVPはティアA確定（1発も殴っていなくても）', () => {
  assert.equal(rewardTierOf({ share: 0, isHost: true }), 'A')
  assert.equal(rewardTierOf({ share: 0, isMvp: true }), 'A')
  assert.equal(rewardTierOf({ share: 0 }), 'D')
  assert.equal(rewardTierOf({ share: 0.12 }), 'B')
})

test('MVPはいちばん削った人。誰も削っていなければ MVP なし', () => {
  assert.equal(mvpIdOf([{ player_id:'a', damage:10 }, { player_id:'b', damage:99 }]), 'b')
  assert.equal(mvpIdOf([{ player_id:'a', damage:0 }, { player_id:'b', damage:0 }]), null)
  assert.equal(mvpIdOf([]), null)
})

// ===== ティアと帯で豪華になる =====
test('ルーン素材の個数はティア＋帯で増える', () => {
  assert.deepEqual(TIER_MAT_COUNT, { A: 6, B: 4, C: 2, D: 1 })
  assert.equal(tierCountBonus(1), 0)
  assert.equal(tierCountBonus(3), 1)
  assert.equal(tierCountBonus(8), 2)
  assert.equal(matCountOf('A', 1), 6)
  assert.equal(matCountOf('A', 8), 8)
  assert.equal(matCountOf('D', 1), 1)
  // 帯が上がって減ることはない
  for (const rt of REWARD_TIERS) {
    for (let t = 2; t <= TIER_MAX; t++) {
      assert.ok(matCountOf(rt, t) >= matCountOf(rt, t - 1), `${rt} 帯${t}で個数が減った`)
    }
  }
})

test('レア度の表は合計100で、ティアも帯も上がるほど良くなる', () => {
  for (const rt of REWARD_TIERS) {
    for (const t of TIERS) {
      const x = rarityTableOf(rt, t)
      assert.ok(Math.abs(x.normal + x.rare + x.ultra - 100) < 1e-9, `${rt}／帯${t} の合計が100でない`)
      assert.ok(x.normal >= 0, `${rt}／帯${t} の通常が負`)
    }
  }
  assert.ok(rarityTableOf('A', 1).ultra > rarityTableOf('B', 1).ultra, 'ティアで良くならない')
  assert.ok(rarityTableOf('A', 8).ultra > rarityTableOf('A', 1).ultra, '帯で良くならない')
  assert.equal(rollRarity('A', 1, () => 0), 'ultra')
  assert.equal(rollRarity('D', 1, () => 0.99), 'normal')
})

test('合成素材の確率はティア＋帯×2%', () => {
  assert.deepEqual(TIER_FUSION_PCT, { A: 60, B: 35, C: 15, D: 5 })
  assert.equal(FUSION_TIER_BONUS, 2)
  assert.equal(fusionChanceOf('A', 1), 62)
  assert.equal(fusionChanceOf('A', 8), 76)
  assert.equal(fusionChanceOf('D', 1), 7)
  assert.ok(fusionChanceOf('A', 8) <= 100)
})

// ===== 残り時間 =====
test('残り時間は開始から60分', () => {
  const t0 = new Date('2026-09-06T10:00:00Z')
  assert.equal(secondsLeft(t0, t0.getTime()), RAID_MINUTES * 60)
  assert.equal(secondsLeft(t0, t0.getTime() + 61 * 60000), 0)
  assert.equal(timeText(125), '2分05秒')
})

test('討伐済み・時間切れはどちらも「終わっている」', () => {
  const t0 = new Date('2026-09-06T10:00:00Z')
  assert.equal(isOver({ hp_left: 100, started_at: t0 }, t0.getTime()), false)
  assert.equal(isOver({ hp_left: 0, started_at: t0 }, t0.getTime()), true)
  assert.equal(isOver({ hp_left: 100, started_at: t0 }, t0.getTime() + 61 * 60000), true)
})

// ===== 合成 =====
test('合成素材は5体ぶんあり、それぞれ特殊能力を1つ持っている', () => {
  assert.equal(FUSIONS.length, RAID_BOSSES.length)
  for (const f of FUSIONS) {
    assert.equal(f.id, `fu:${RAID_BOSSES.find(b => b.name === f.boss).key}`)
    assert.ok(FUSION_ABILITIES[f.ability], `${f.name} の特殊能力が無い`)
    assert.ok(f.name && f.crown, `${f.id} に名前か冠名が無い`)
  }
  assert.equal(new Set(FUSIONS.map(f => f.name)).size, FUSIONS.length, '素材名が重複')
})

test('合成すると名前が「◯◯の××」になる（素の名前は保存しない）', () => {
  const sword = CATALOG.find(i => i.part === '武器')
  assert.equal(fusedName(sword, null), sword.name)
  assert.equal(fusedName(sword, '黒龍ヴァルゼノク'), `黒龍の${sword.name}`)
  // 知らない名前が入っていても素の名前に戻る（データが壊れても表示は死なない）
  assert.equal(fusedName(sword, 'いないボス'), sword.name)
  assert.equal(ITEM_BY_ID[sword.id].name, sword.name)
})

test('合成できるのは武器だけ／組み合わせのチェック', () => {
  const w = CATALOG.find(i => i.part === '武器')
  const armor = CATALOG.find(i => i.part === '鎧')
  assert.equal(canFuseItem(w), true)
  assert.equal(canFuseItem(armor), false)
  assert.match(checkFuse({ inv: { id: 1 }, item: armor, matId: 'fu:enma', have: 1 }), /武器だけ/)
  assert.match(checkFuse({ inv: null, item: null }), /武器を選んで/)
  assert.match(checkFuse({ inv: { id: 1 }, item: w, matId: null }), /素材を選んで/)
  assert.match(checkFuse({ inv: { id: 1 }, item: w, matId: 'fu:ない', have: 1 }), /ありません/)
  assert.match(checkFuse({ inv: { id: 1 }, item: w, matId: 'fu:enma', have: 0 }), /持っていません/)
  assert.equal(checkFuse({ inv: { id: 1 }, item: w, matId: 'fu:enma', have: 1 }), '')
})

test('合成の特殊能力は刻印と同じ枠で戦闘に乗る（重ねて足せる）', () => {
  // ★ENCHANTS（敵270体）には入っていないが、ABILITY_OF からは引ける
  for (const name of Object.keys(FUSION_ABILITIES)) {
    assert.equal(ENCHANTS[name], undefined, `${name} が敵の刻印に混ざっている`)
    assert.ok(ABILITY_OF[name], `${name} が ABILITY_OF に無い`)
    assert.notEqual(abilityText(name), name, `${name} の文が出ていない`)
  }
  const en = collectEnchants(['黒龍ヴァルゼノク', 'ひなたトカゲ'])
  assert.equal(en.physDmgPct, 15 + 2, '合成ぶんと刻印ぶんが足されていない')
})

test('付与する状態異常は実在するものだけ', () => {
  for (const [name, a] of Object.entries(FUSION_ABILITIES)) {
    const key = a.effect?.onHitAil?.key
    if (key) assert.ok(AIL_LABEL[key], `${name} の状態異常 ${key} が無い`)
  }
})

test('fusedAbilitiesOf は fused の入った装備だけを拾う', () => {
  assert.deepEqual(fusedAbilitiesOf([{ fused: '閻魔' }, { fused: null }, { fused: 'いないボス' }, {}]), ['閻魔'])
})

// ===== SQLとの突き合わせ =====
test('SQL の v2_raid_const が raid.js と同じ数字になっている', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_const'))
  const num = (k) => {
    const m = body.match(new RegExp(`'${k}',\\s*([0-9.]+)`))
    assert.ok(m, `${k} がSQLに無い`)
    return Number(m[1])
  }
  assert.equal(num('rate'), RAID_RATE)
  assert.equal(num('minutes'), RAID_MINUTES)
  assert.equal(num('cooldown_hours'), RAID_COOLDOWN_HOURS)
  assert.equal(num('max_members'), RAID_MAX_MEMBERS)
  assert.equal(num('turns'), RAID_TURNS)
  assert.equal(num('ramp_atk'), RAMP_ATK)
  assert.equal(num('ramp_def'), RAMP_DEF)
  assert.equal(num('power_mult'), RAID_POWER_MULT)
  assert.equal(num('atk_mult'), RAID_ATK_MULT)
  assert.equal(num('call_max'), CALL_MAX)
  assert.equal(num('online_minutes'), ONLINE_MINUTES)
  assert.equal(num('tier_share_a'), TIER_SHARE.A)
  assert.equal(num('tier_share_b'), TIER_SHARE.B)
  assert.equal(num('tier_share_c'), TIER_SHARE.C)
  assert.equal(num('fusion_tier_bonus'), FUSION_TIER_BONUS)
})

test('★SQL の v2_raid_tiers が raid.js の強さの表と一致している', () => {
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_raid_tiers'))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(/\(\s*(\d+),\s*(\d+),\s*(\d+)\)/g)]
  assert.equal(rows.length, TIER_MAX, '行数が帯の数と違う')
  for (const [, tier, power, hp] of rows) {
    assert.equal(Number(power), raidPowerOfTier(Number(tier)), `帯${tier}の戦闘力がSQLと違う`)
    assert.equal(Number(hp), raidHpOfTier(Number(tier)), `帯${tier}のHPがSQLと違う`)
  }
})

test('★SQL の報酬ティアの判定が raid.js と一致している', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_reward_tier'))
  assert.ok(body.includes('p_is_host, false) or coalesce(p_is_mvp, false) then \'A\''), '主催者とMVPのA確定が無い')
  assert.ok(body.includes(`p_share >= ${TIER_SHARE.A} then 'A'`), 'Aのしきい値が違う')
  assert.ok(body.includes(`p_share >= ${TIER_SHARE.B.toFixed(2)} then 'B'`), 'Bのしきい値が違う')
  assert.ok(body.includes(`p_share >= ${TIER_SHARE.C.toFixed(2)} then 'C'`), 'Cのしきい値が違う')
})

test('★SQL の報酬の中身が raid.js と一致している', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_claim'))
  // 個数
  const cnt = `when 'A' then ${TIER_MAT_COUNT.A} when 'B' then ${TIER_MAT_COUNT.B} when 'C' then ${TIER_MAT_COUNT.C} else ${TIER_MAT_COUNT.D} end`
  assert.ok(body.includes(cnt), `素材の個数がSQLと違う（${cnt}）`)
  assert.ok(body.includes('floor(v_r.tier / 3.0)::int'), '帯ぶんの個数ボーナスが無い')
  // レア度（ティアごとの基礎＋帯ぶん）
  const ult = `when 'A' then ${TIER_RARITY.A.ultra} when 'B' then ${TIER_RARITY.B.ultra}`
    + ` when 'C' then ${TIER_RARITY.C.ultra} else ${TIER_RARITY.D.ultra} end) + v_r.tier`
  assert.ok(body.includes(ult), `激レアの表がSQLと違う（${ult}）`)
  const rare = `when 'A' then ${TIER_RARITY.A.rare} when 'B' then ${TIER_RARITY.B.rare}`
    + ` when 'C' then ${TIER_RARITY.C.rare} else ${TIER_RARITY.D.rare} end)`
  assert.ok(body.includes(rare), `レアの表がSQLと違う（${rare}）`)
  // 帯が1つ上がるごとに激レアが1%ずつ増える（SQLの「+ v_r.tier」と同じ動き）
  for (const rt of REWARD_TIERS) {
    assert.equal(rarityTableOf(rt, 2).ultra, rarityTableOf(rt, 1).ultra + 1, `${rt} の帯ボーナスが1%になっていない`)
    assert.equal(rarityTableOf(rt, 1).ultra, TIER_RARITY[rt].ultra + 1, `${rt} の基礎が違う`)
  }
  // 合成素材
  const fus = `when 'A' then ${TIER_FUSION_PCT.A} when 'B' then ${TIER_FUSION_PCT.B} when 'C' then ${TIER_FUSION_PCT.C} else ${TIER_FUSION_PCT.D} end`
  assert.ok(body.includes(fus), '合成素材の確率がSQLと違う')
  // 1発の上限
  assert.ok(SQL.includes('v_r.hp_max / 100'), '1発の上限がSQLに無い')
})

test('SQL の合成素材の名簿が fusion.js と一致している', () => {
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_fusion_materials'))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(
    /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)]
  assert.equal(rows.length, FUSIONS.length, '行数が違う')
  for (const [, id, name, source, boss, crown] of rows) {
    const f = FUSION_BY_ID[id]
    assert.ok(f, `${id} が fusion.js に無い`)
    assert.equal(name, f.name)
    assert.equal(source, f.source)
    assert.equal(boss, f.boss)
    assert.equal(crown, f.crown)
  }
})

test('★強さも報酬もサーバーが決める（クライアントは戦闘力を送らない）', () => {
  assert.ok(SQL.includes('create or replace function public.v2_raid_spawn(p_boss_key text, p_area int)'),
    'v2_raid_spawn が戦闘力を受け取る形のまま')
  assert.ok(!SQL.includes('p_power'), 'クライアントから戦闘力を受け取る引数が残っている')
  const src = readFileSync(new URL('../components/V2Sortie.jsx', import.meta.url), 'utf8')
  assert.ok(!src.includes('p_power'), '出撃の画面が戦闘力を送っている')
})

test('救援の宛先の種別は online と friend の2つ（国はまだ無い）', () => {
  assert.deepEqual(CALL_KINDS, ['online', 'friend'])
  assert.ok(!SQL.includes("'country'"), '国はまだ作っていないはず')
})

test('1時間の枠で殴れる回数と、HPの決め方の前提が合っている', () => {
  // ★HPは「360回で削り切れる量」。クールタイムか挑戦時間を変えたらHPも測り直す
  assert.equal(Math.floor((RAID_MINUTES * 60) / SORTIE_CD), 360)
})
