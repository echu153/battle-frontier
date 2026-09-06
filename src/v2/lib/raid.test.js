// レイドボスのテスト。数値の正は docs/v2-raid-design.md。
// ★SQL（supabase_v2_raid_20260906.sql）にも同じ数字の写しがあるので、
//   **片方だけ直したら落ちる**ように突き合わせている（v2sql.test.js と同じ考え方）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RAID_BOSSES, RAID_BOSS_BY_KEY, raidBossOf, RAID_RATE, rollRaid,
  RAID_MINUTES, RAID_COOLDOWN_HOURS, RAID_MAX_MEMBERS, RAID_MIN_POWER, RAID_HP_K, RAID_TURNS,
  raidPowerOf, raidHpOf, toRaidFighter, shareOf, matCountOf, MAT_COUNT_MAX,
  rarityTableOf, rollRarity, fusionChanceOf, FUSION_HOST_BONUS,
  CALL_KINDS, CALL_MAX, ONLINE_MINUTES, pickRaidBoss,
  secondsLeft, isOver, timeText,
} from './raid.js'
import { FUSIONS, FUSION_BY_ID, fusedName, canFuseItem, checkFuse, fusedAbilitiesOf } from './fusion.js'
import { FUSION_ABILITIES, ABILITY_OF, ENCHANTS, collectEnchants, abilityText } from './enchant.js'
import { allEnemies } from './enemies.js'
import { ITEM_BY_ID, CATALOG } from './equipment.js'
import { runBattle } from './battle.js'
import { AIL_LABEL } from './ailments.js'

const SQL = readFileSync(new URL('../../../supabase_v2_raid_20260906.sql', import.meta.url), 'utf8')

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

test('raidBossOf は key で引ける', () => {
  assert.equal(raidBossOf('enma')?.name, '閻魔')
  assert.equal(raidBossOf('ない'), null)
  assert.equal(Object.keys(RAID_BOSS_BY_KEY).length, 5)
})

test('出るボスは5体から均等に引ける', () => {
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

// ===== 強さ =====
test('ボスの強さは主催者の戦闘力だが、6,000を下回らない', () => {
  assert.equal(raidPowerOf(100), RAID_MIN_POWER)
  assert.equal(raidPowerOf(6000), 6000)
  assert.equal(raidPowerOf(40000), 40000)
})

test('HP = 2,000 × 強さ', () => {
  assert.equal(raidHpOf(0), RAID_HP_K * RAID_MIN_POWER)
  assert.equal(raidHpOf(20000), RAID_HP_K * 20000)
})

test('toRaidFighter は削れた残りHPを持ったまま runBattle に渡せる', () => {
  const f = toRaidFighter(RAID_BOSSES[0], 6000, 1234)
  assert.equal(f.name, '黒龍ヴァルゼノク')
  assert.equal(f.stats.hp, 1234)
  assert.ok(f.slots.length >= 3)
  // 残りHPを渡さなければ最大HP
  assert.equal(toRaidFighter(RAID_BOSSES[0], 6000).stats.hp, raidHpOf(6000))
})

// ★狙い：攻撃寄りの編成なら「1時間ぶん（360回）」の前後で削り切れる。
//   数字そのものは tools/v2-raid-tune.mjs が正。ここは**桁が変わったら気づく**ための網
test('1回の挑戦で入るダメージは、最大HPの1/1000〜1/100 におさまる', () => {
  const rng = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } })()
  const P = 6000
  const me = {
    name: 'テスト', cls: '侍', stats: { hp: 2000, mp: 400, str: 900, dex: 500, agi: 500, int_stat: 100, vit: 400, luk: 200 },
    slots: [],
  }
  const boss = toRaidFighter(RAID_BOSSES[0], P)
  const r = runBattle(me, boss, { rng, maxTurns: RAID_TURNS })
  const dmg = r.b.base.hp - r.b.hp
  const max = raidHpOf(P)
  assert.ok(dmg > 0, '1ターンも通っていない')
  assert.ok(dmg < max / 100, `1発が上限（最大HPの1/100）を超えている：${dmg}`)
})

// ===== 報酬 =====
test('share は 0〜1 に丸められる', () => {
  assert.equal(shareOf(50, 100), 0.5)
  assert.equal(shareOf(500, 100), 1)
  assert.equal(shareOf(-5, 100), 0)
  assert.equal(shareOf(10, 0), 0)
})

test('ルーン素材の個数は 1 + floor(share×10)（最大6個）', () => {
  assert.equal(matCountOf(0), 1)
  assert.equal(matCountOf(0.25), 3)
  assert.equal(matCountOf(1), MAT_COUNT_MAX)
})

test('レア度の表は合計100で、share が上がるほど良くなる', () => {
  for (const s of [0, 0.5, 1]) {
    const t = rarityTableOf(s)
    assert.ok(Math.abs(t.normal + t.rare + t.ultra - 100) < 1e-9, `合計が100でない（share=${s}）`)
  }
  assert.ok(rarityTableOf(1).ultra > rarityTableOf(0).ultra)
  assert.equal(rollRarity(0, () => 0), 'ultra')
  assert.equal(rollRarity(0, () => 0.99), 'normal')
})

test('合成素材の確率は 20＋60×share、主催者は+10%', () => {
  assert.equal(fusionChanceOf(0), 20)
  assert.equal(fusionChanceOf(0.5), 50)
  assert.equal(fusionChanceOf(0.5, true), 50 + FUSION_HOST_BONUS)
  assert.equal(fusionChanceOf(1, true), 90)
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
})

test('合成できるのは武器だけ', () => {
  assert.equal(canFuseItem(CATALOG.find(i => i.part === '武器')), true)
  assert.equal(canFuseItem(CATALOG.find(i => i.part === '鎧')), false)
  const armor = CATALOG.find(i => i.part === '鎧')
  assert.match(checkFuse({ inv: { id: 1 }, item: armor, matId: 'fu:enma', have: 1 }), /武器だけ/)
})

test('合成の組み合わせのチェック', () => {
  const w = CATALOG.find(i => i.part === '武器')
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
  const list = fusedAbilitiesOf([{ fused: '閻魔' }, { fused: null }, { fused: 'いないボス' }, {}])
  assert.deepEqual(list, ['閻魔'])
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
  assert.equal(num('min_power'), RAID_MIN_POWER)
  assert.equal(num('hp_k'), RAID_HP_K)
  assert.equal(num('turns'), RAID_TURNS)
  assert.equal(num('call_max'), CALL_MAX)
  assert.equal(num('online_minutes'), ONLINE_MINUTES)
  assert.equal(num('mat_count_max'), MAT_COUNT_MAX)
  assert.equal(num('fusion_host_bonus'), FUSION_HOST_BONUS)
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

test('SQL のレア度と合成素材の式が raid.js と一致している', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_claim'))
  // 通常 70-50s / レア 25+30s / 激レア 5+20s
  const t0 = rarityTableOf(0)
  const t1 = rarityTableOf(1)
  assert.ok(body.includes('5 + 20 * v_share'), '激レアの式が違う')
  assert.ok(body.includes('25 + 30 * v_share'), 'レアの式が違う')
  assert.equal(t0.ultra, 5)
  assert.equal(t1.ultra, 25)
  assert.equal(t0.rare, 25)
  assert.equal(t1.rare, 55)
  // 1発の上限は最大HPの1/100（設計メモと attack の実装をそろえる）
  assert.ok(SQL.includes('v_r.hp_max / 100'), '1発の上限がSQLに無い')
})

test('救援の宛先の種別は online と friend の2つ（国はまだ無い）', () => {
  assert.deepEqual(CALL_KINDS, ['online', 'friend'])
  assert.ok(!SQL.includes("'country'"), '国はまだ作っていないはず')
})

test('ITEM_BY_ID から素の名前が引ける（合成しても元に戻せる）', () => {
  const w = CATALOG.find(i => i.part === '武器')
  assert.equal(ITEM_BY_ID[w.id].name, w.name)
})
