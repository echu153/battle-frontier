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
  matCountOf, matRangeOf, matRangeText, TIER_MAT_RANGE, rarityTableOf, rollRarity,
  TIER_ULTRA, TIER_RARE, ultraPctOf, rarePctOf,
  RAID_PARTY, HIT_CAP_DIV, hitCapOf,
  fusionChanceOf, FUSION_PCT,
  BOX_KINDS, BOX_MAT_COUNT, BOX_RARITY, BOX_FUSION_PCT, boxRarityTable,
  RAID_EXP_MIN, RAID_EXP_MAX, raidExpOf,
  CALL_KINDS, CALL_MAX, ONLINE_MINUTES, pickRaidBoss, TIERS,
  secondsLeft, isOver, timeText,
} from './raid.js'
import {
  FUSIONS, FUSION_BY_ID, fusedName, canFuseItem, checkFuse, fusedAbilitiesOf,
  fusionsOfSource, fusionOfBoss, fusionOfEnemy, FUSE_COST, ENEMY_FUSION_RATE,
} from './fusion.js'
import { FUSION_ABILITIES, ABILITY_OF, ENCHANTS, collectEnchants, abilityText } from './enchant.js'
import { allEnemies, TIER_MAX } from './enemies.js'
import { ITEM_BY_ID, CATALOG } from './equipment.js'
import { runBattle, createSide, liveStats } from './battle.js'
import { AIL_LABEL, createAilments, inflict, healMultOf, HEAL_CUT_TURNS } from './ailments.js'
import { SORTIE_CD, EXP_ZAKO_MIN, EXP_ZAKO_MAX, FUSION_DROP_RATE, rollFusionDrop } from './sortie.js'

const SQL = readFileSync(new URL('../../../supabase_v2_raid_20260906.sql', import.meta.url), 'utf8')
// v2_raid_tiers の1行 (tier, power, hp, ultra_pct) を拾う
const ROW_RE = /\(\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g
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

test('★まっとうな1発はサーバーの上限（HPの1/10）にまったく届かない', () => {
  const me = {
    name: 'テスト', cls: '侍', stats: { hp: 4000, mp: 600, str: 1400, dex: 800, agi: 800, int_stat: 200, vit: 700, luk: 300 },
    slots: [],
  }
  const max = raidHpOfTier(5)
  const r = runBattle(me, toRaidFighter(RAID_BOSSES[0], 5), { rng: rngOf(1), maxTurns: RAID_TURNS })
  const dmg = r.b.base.hp - r.b.hp
  assert.ok(dmg > 0, '1ターンも通っていない')
  assert.ok(dmg < hitCapOf(max), `1発が上限（最大HPの1/${HIT_CAP_DIV}）を超えている：${dmg}`)
  assert.equal(hitCapOf(1000), 100)
})

test('★HPは想定人数ぶんある（ソロでは1時間で削り切れない）', () => {
  assert.equal(RAID_PARTY, 5)
  // 1時間ぶん（360回）× 想定人数 でちょうど。tools/v2-raid-tune.mjs の実測を焼いてある
  const perHour = Math.floor((RAID_MINUTES * 60) / SORTIE_CD)
  for (const t of TIERS) {
    // 帯ごとの「1回の与ダメ」の見積り＝HP ÷（360回 × 人数）。桁が合っていることだけ見る
    const per = raidHpOfTier(t) / (perHour * RAID_PARTY)
    assert.ok(per > 0, `帯${t}`)
    assert.ok(hitCapOf(raidHpOfTier(t)) > per * 5, `帯${t} の1発上限が実測に近すぎる`)
  }
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

// ★2026-09-06 ユーザー指示：報酬は**3枠**（貢献度／主催の箱／MVPの箱）で重ねてもらえる。
//   別枠になったので、**貢献度のティアは share だけ**で決まる（A確定は無くした）
test('★貢献度のティアは share だけで決まる（主催・MVPでも優遇しない）', () => {
  assert.equal(rewardTierOf(0), 'D')
  assert.equal(rewardTierOf(0.12), 'B')
  assert.equal(rewardTierOf(0.30), 'A')
  // 主催かどうか・MVPかどうかは受け取らない（渡しても効かない）
  assert.equal(rewardTierOf.length, 1, 'ティアの判定が share 以外を見ている')
})

test('MVPはいちばん削った人。誰も削っていなければ MVP なし', () => {
  assert.equal(mvpIdOf([{ player_id:'a', damage:10 }, { player_id:'b', damage:99 }]), 'b')
  assert.equal(mvpIdOf([{ player_id:'a', damage:0 }, { player_id:'b', damage:0 }]), null)
  assert.equal(mvpIdOf([]), null)
})

// ===== ティアと帯で豪華になる =====
test('素材の数はティアごとの範囲から引く（帯ボーナスは無し）', () => {
  assert.deepEqual(TIER_MAT_RANGE, { A: [5, 7], B: [3, 5], C: [2, 3], D: [1, 2] })
  assert.deepEqual(matRangeOf('A'), [5, 7])
  assert.deepEqual(matRangeOf('ない'), TIER_MAT_RANGE.D)
  assert.equal(matRangeText('B'), '3〜5個')
  // 範囲の下と上がちゃんと出る
  assert.equal(matCountOf('A', () => 0), 5)
  assert.equal(matCountOf('A', () => 0.99), 7)
  assert.equal(matCountOf('D', () => 0), 1)
  assert.equal(matCountOf('D', () => 0.99), 2)
  // ティアが上がると必ず増える（範囲が重ならない）
  for (let i = 1; i < REWARD_TIERS.length; i++) {
    const hi = matRangeOf(REWARD_TIERS[i])[1]
    const lo = matRangeOf(REWARD_TIERS[i - 1])[0]
    assert.ok(lo >= hi, `${REWARD_TIERS[i - 1]} と ${REWARD_TIERS[i]} の範囲が逆転している`)
  }
})

// ===== 主催の箱／MVPの箱 =====
test('★主催の箱とMVPの箱は中身が同じ（素材3個・激レア10%・合成素材3%）', () => {
  assert.deepEqual(BOX_KINDS, ['host', 'mvp'])
  assert.equal(BOX_MAT_COUNT, 3)
  assert.equal(BOX_FUSION_PCT, 3)
  const t = boxRarityTable()
  assert.deepEqual(t, BOX_RARITY)
  assert.equal(t.normal + t.rare + t.ultra, 100)
  assert.equal(t.ultra, 10)
  // 箱も 通常＞レア＞激レア を守る
  assert.ok(t.normal > t.rare && t.rare > t.ultra, '箱の並びが崩れている')
  // 箱のほうが貢献度ぶんより激レアも合成素材も出やすい（ご褒美として成立している）
  assert.ok(t.ultra > ultraPctOf(8), '箱の激レアが帯⑧より出にくい')
  assert.ok(BOX_FUSION_PCT > FUSION_PCT, '箱の合成素材が貢献度ぶんより出にくい')
})

// ===== EXP =====
test('★レイドへの挑戦でもEXPが入る（出撃の通常敵と同じ 8〜11）', () => {
  assert.equal(RAID_EXP_MIN, 8)
  assert.equal(RAID_EXP_MAX, 11)
  assert.equal(raidExpOf(() => 0), 8)
  assert.equal(raidExpOf(() => 0.99), 11)
  // 出撃の通常敵とそろえてある（片方だけ動かしたら気づく）
  assert.equal(RAID_EXP_MIN, EXP_ZAKO_MIN)
  assert.equal(RAID_EXP_MAX, EXP_ZAKO_MAX)
})

test('★どのティア・どの帯でも 通常＞レア＞激レア', () => {
  for (const rt of REWARD_TIERS) {
    for (const t of TIERS) {
      const x = rarityTableOf(rt, t)
      assert.ok(Math.abs(x.normal + x.rare + x.ultra - 100) < 1e-9, `${rt}／帯${t} の合計が100でない`)
      assert.ok(x.normal > x.rare, `${rt}／帯${t} で通常がレアより少ない`)
      assert.ok(x.rare > x.ultra, `${rt}／帯${t} でレアが激レアより少ない`)
    }
  }
  assert.equal(rollRarity('A', 1, () => 0), 'ultra')
  assert.equal(rollRarity('D', 1, () => 0.99), 'normal')
})

test('激レアは帯だけで決まる（①3% 〜 最高7%）', () => {
  assert.equal(ultraPctOf(1), 3)
  assert.equal(Math.max(...Object.values(TIER_ULTRA)), 7, '激レアの上限が7%を超えている')
  assert.equal(Math.min(...Object.values(TIER_ULTRA)), 3, '激レアの下限が3%でない')
  for (const rt of REWARD_TIERS) {
    assert.equal(rarityTableOf(rt, 1).ultra, 3, `${rt} の帯①が3%でない`)
    assert.equal(rarityTableOf(rt, 8).ultra, 7, `${rt} の帯⑧が7%でない`)
  }
  // 帯が上がって下がることはない
  for (let t = 2; t <= TIER_MAX; t++) assert.ok(ultraPctOf(t) >= ultraPctOf(t - 1), `帯${t}`)
})

test('レアはティアだけで決まる（A30 〜 D12・激レアの上限より必ず多い）', () => {
  assert.deepEqual(TIER_RARE, { A: 30, B: 24, C: 18, D: 12 })
  assert.equal(rarePctOf('A'), 30)
  assert.equal(rarePctOf('ない'), TIER_RARE.D)
  assert.ok(Math.min(...Object.values(TIER_RARE)) > Math.max(...Object.values(TIER_ULTRA)),
    'いちばん低いレアが激レアの上限より少ない')
  for (const t of TIERS) assert.equal(rarityTableOf('A', t).rare, 30, `帯${t}`)
})

test('★合成素材は固定1%（ティアでも帯でも変わらない）', () => {
  assert.equal(FUSION_PCT, 1)
  assert.equal(fusionChanceOf(), 1)
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
// ★2026-09-06 ユーザー指示：**特殊能力の入手経路を合成素材へ一本化**した。
//   敵270体ぶん（出撃で一律1%）＋レイドボス5体ぶん＝275種
test('★合成素材は 敵270 ＋ レイド5 ＝ 275種で、全部に特殊能力がある', () => {
  const enemyFus = fusionsOfSource('enemy')
  const raidFus = fusionsOfSource('raid')
  assert.equal(enemyFus.length, allEnemies().length, '敵の数と合っていない')
  assert.equal(enemyFus.length, 270)
  assert.equal(raidFus.length, RAID_BOSSES.length)
  assert.equal(FUSIONS.length, 275)
  for (const f of FUSIONS) {
    assert.ok(ABILITY_OF[f.ability], `${f.name} の特殊能力が無い`)
    assert.ok(f.name && f.crown, `${f.id} に名前か冠名が無い`)
    assert.ok(f.id.startsWith('fu:'), `${f.id} のidの形が違う`)
  }
  assert.equal(new Set(FUSIONS.map(f => f.id)).size, FUSIONS.length, 'idが重複')
  assert.equal(new Set(FUSIONS.map(f => f.name)).size, FUSIONS.length, '素材名が重複')
  // レイドぶんは冠名（黒龍…）、敵ぶんは敵の名前がそのまま頭に付く
  for (const b of RAID_BOSSES) assert.equal(fusionOfBoss(b.name).crown, b.crown)
  assert.equal(fusionOfEnemy('スライム').crown, 'スライム')
  assert.equal(fusionOfEnemy('スライム').name, 'スライムの因子')
})

test('★敵270体ぜんぶに合成素材がある（敵を足したら自動でつく）', () => {
  const byBoss = new Set(fusionsOfSource('enemy').map(f => f.boss))
  const missing = allEnemies().map(e => e.name).filter(n => !byBoss.has(n))
  assert.deepEqual(missing, [], '合成素材が無い敵がいる')
})

test('★合成に使う素材は1個', () => {
  assert.equal(FUSE_COST, 1)
  assert.equal(checkFuse({ inv: { id: 1 }, item: CATALOG.find(i => i.part === '武器'), matId: 'fu:enma', have: 1 }), '')
})

test('★敵の合成素材は一律1%で落ちる（レア度による差は無い）', () => {
  assert.equal(FUSION_DROP_RATE, ENEMY_FUSION_RATE)
  assert.equal(FUSION_DROP_RATE, 1)
  assert.equal(rollFusionDrop(() => 0.009), true)
  assert.equal(rollFusionDrop(() => 0.011), false)
})

// ★ルーンからは特殊能力が付かなくなった（移し忘れ・戻し忘れをここで止める）
test('★ルーンの特殊能力は廃止され、戦闘には合成ぶんだけが乗る', () => {
  const src = readFileSync(new URL('./loadout.js', import.meta.url), 'utf8')
  assert.ok(!/enchants:[^,]*runeAbilities/.test(src), 'ルーンの特殊能力が戦闘に戻っている')
  assert.ok(src.includes('enchants: equippedFusions('), '合成ぶんが戦闘に渡っていない')
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

// ★2026-09-06 ユーザー指定の5体ぶん。**効果が実際に戦闘で動くところまで**を1つずつ固定する
//   （文だけ直して効果を入れ忘れる／キーを打ち間違える事故を止める）
test('★合成の特殊能力5つが、指定どおりの効果になっている', () => {
  const en = (name) => collectEnchants([name])
  const v = en('黒龍ヴァルゼノク')
  assert.equal(v.physDmgPct, 15)
  assert.deepEqual(v.onHitAils[0], { key:'healCut', chance:100, kind:'any', pct:20, turns:2 })

  const a = en('雨摩座')
  assert.equal(a.magDmgPct, 15)
  assert.equal(a.onHitAils[0].key, 'slow')
  assert.equal(a.onHitAils[0].chance, 30)

  const z = en('雷鋼機神ゼルギアス')
  assert.equal(z.statPct.agi, 10)
  assert.equal(z.statPct.dex, 10)
  assert.equal(z.procBonus, 5)

  const e = en('閻魔')
  assert.equal(e.onHitAils[0].key, 'curse')
  assert.equal(e.onHitAils[0].chance, 25)
  assert.equal(e.drainPct, 5)
  assert.equal(e.drainPhysPct, 0, '閻魔は物理限定の吸収を持たない（種別を問わない）')

  const g = en('炎獄王グラウディオス')
  assert.equal(g.statPct.vit, 10)
  assert.deepEqual(g.perTurnStats[0], { stat:'vit', pct:0.5, max:20 })
})

test('★黒龍：回復阻害は2ターンで切れる（既定の3ターンではない）', () => {
  const ail = createAilments()
  inflict(ail, 'healCut', { pct: 20, turns: 2 })
  assert.equal(ail.healCut.turns, 2)
  assert.equal(healMultOf(ail), 0.8, '回復量が-20%になっていない')
  // 既定（turns を渡さない）は今までどおり
  const d = createAilments()
  inflict(d, 'healCut', { pct: 20 })
  assert.equal(d.healCut.turns, HEAL_CUT_TURNS)
})

test('★閻魔：物理でも魔法でも与ダメージの5%を回復する', () => {
  const foe = { name:'まと', stats:{ hp:900000, mp:10, str:1, dex:1, agi:1, int_stat:1, vit:1, luk:1 }, slots:[] }
  const hpAfter = (kind, enchants) => {
    const me = { name:'私', cls:'侍', kind, enchants,
      stats:{ hp:5000, mp:400, str:900, dex:400, agi:400, int_stat:900, vit:400, luk:200 }, slots:[] }
    const r = runBattle({ ...me, startHp: 2500 }, foe, { rng: rngOf(3), maxTurns: 5 })
    return r.a.hp
  }
  for (const kind of ['phys', 'mag']) {
    assert.ok(hpAfter(kind, ['閻魔']) > hpAfter(kind, []), `${kind} で吸収していない`)
  }
})

test('★グラウディオス：ターンが経つごとにVITが上がる（重複20で頭打ち）', () => {
  const side = createSide({ name:'私', cls:'侍', enchants:['炎獄王グラウディオス'],
    stats:{ hp:1000, mp:100, str:100, dex:100, agi:100, int_stat:100, vit:1000, luk:100 }, slots:[] })
  side.turn = 0
  const t0 = liveStats(side).vit
  side.turn = 10
  const t10 = liveStats(side).vit
  side.turn = 20
  const t20 = liveStats(side).vit
  side.turn = 40
  const t40 = liveStats(side).vit
  assert.ok(t10 > t0, '10ターン後に上がっていない')
  assert.ok(t20 > t10, '20ターン後に上がっていない')
  assert.equal(t40, t20, '重複20で頭打ちになっていない')
  // 素の1000に対して +10%（常時）＋ 0.5%×20（ターン）＝ +20%
  assert.equal(t0, 1100)
  assert.equal(t20, 1200)
})

test('ターン数はふつうの戦闘でも数えている（perTurnStat が無ければ何も起きない）', () => {
  const plain = createSide({ name:'敵', stats:{ hp:100, mp:10, str:10, dex:10, agi:10, int_stat:10, vit:10, luk:10 }, slots:[] })
  assert.equal(plain.turn, 0)
  const before = liveStats(plain).vit
  plain.turn = 30
  assert.equal(liveStats(plain).vit, before, '能力が無いのにターンで変わっている')
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
  assert.equal(num('fusion_pct'), FUSION_PCT)
})

test('★SQL の v2_raid_tiers が raid.js の強さ・激レアの表と一致している', () => {
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_raid_tiers'))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(ROW_RE)]
  assert.equal(rows.length, TIER_MAX, '行数が帯の数と違う')
  for (const [, tier, power, hp, ultra] of rows) {
    assert.equal(Number(power), raidPowerOfTier(Number(tier)), `帯${tier}の戦闘力がSQLと違う`)
    assert.equal(Number(hp), raidHpOfTier(Number(tier)), `帯${tier}のHPがSQLと違う`)
    assert.equal(Number(ultra), ultraPctOf(Number(tier)), `帯${tier}の激レアの確率がSQLと違う`)
  }
})

test('★SQL の貢献度ティアの判定が raid.js と一致している（主催・MVPの優遇は無い）', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_reward_tier'))
  assert.ok(body.includes('v2_raid_reward_tier(p_share numeric)'), '引数が share だけになっていない')
  assert.ok(!body.includes('p_is_host'), '主催者の優遇がSQLに残っている')
  assert.ok(body.includes("p_share >= " + TIER_SHARE.A + " then 'A'"), 'Aのしきい値が違う')
  assert.ok(body.includes("p_share >= " + TIER_SHARE.B.toFixed(2) + " then 'B'"), 'Bのしきい値が違う')
  assert.ok(body.includes("p_share >= " + TIER_SHARE.C.toFixed(2) + " then 'C'"), 'Cのしきい値が違う')
})

test('★SQL の報酬の中身が raid.js と一致している', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_claim'))
  // 素材の数の範囲（ティアごと）
  const lo = "when 'A' then " + TIER_MAT_RANGE.A[0] + " when 'B' then " + TIER_MAT_RANGE.B[0]
    + " when 'C' then " + TIER_MAT_RANGE.C[0] + " else " + TIER_MAT_RANGE.D[0] + " end"
  const hi = "when 'A' then " + TIER_MAT_RANGE.A[1] + " when 'B' then " + TIER_MAT_RANGE.B[1]
    + " when 'C' then " + TIER_MAT_RANGE.C[1] + " else " + TIER_MAT_RANGE.D[1] + " end"
  assert.ok(body.includes(lo), '素材の数の下限がSQLと違う')
  assert.ok(body.includes(hi), '素材の数の上限がSQLと違う')
  assert.ok(!body.includes('floor(v_r.tier / 3.0)'), '帯ボーナスがSQLに残っている')
  // 激レアは v2_raid_tiers.ultra_pct（帯だけ）から引いている
  assert.ok(body.includes('select ultra_pct into v_ultra from public.v2_raid_tiers'),
    '激レアを帯の表から引いていない')
  // レアはティアだけ
  const rare = "when 'A' then " + TIER_RARE.A + " when 'B' then " + TIER_RARE.B
    + " when 'C' then " + TIER_RARE.C + " else " + TIER_RARE.D + " end)"
  assert.ok(body.includes(rare), 'レアの表がSQLと違う')
  // 3枠（貢献度・主催の箱・MVPの箱）
  assert.ok(body.includes("'kind', 'share'"), '貢献度の枠がSQLに無い')
  for (const k of BOX_KINDS) assert.ok(body.includes("'kind', '" + k + "'"), k + ' の箱がSQLに無い')
  assert.ok(body.includes("(v_c->>'box_mat')::int"), '箱の素材の数が定数から来ていない')
  // 1発の上限
  assert.ok(SQL.includes('v_r.hp_max / ' + HIT_CAP_DIV), '1発の上限がSQLと違う')
})

test('★SQL の定数が箱とEXPの値と一致している', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_const'))
  const num = (k) => {
    const m = body.match(new RegExp("'" + k + "'," + String.raw`\s*([0-9.]+)`))
    assert.ok(m, k + ' がSQLに無い')
    return Number(m[1])
  }
  assert.equal(num('box_mat'), BOX_MAT_COUNT)
  assert.equal(num('box_ultra'), BOX_RARITY.ultra)
  assert.equal(num('box_rare'), BOX_RARITY.rare)
  assert.equal(num('box_fusion_pct'), BOX_FUSION_PCT)
  assert.equal(num('exp_min'), RAID_EXP_MIN)
  assert.equal(num('exp_max'), RAID_EXP_MAX)
})

test('★SQL の v2_raid_attack がEXPをサーバーで抽選して配っている', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.v2_raid_attack'))
  assert.ok(body.includes("(v_c->>'exp_min')::int"), 'EXPの抽選がSQLに無い')
  assert.ok(body.includes('public.v2_apply_exp(v_me, v_exp)'), 'EXPを配っていない')
  // ★言い値では入らない（引数でEXPを受け取っていない）
  assert.ok(body.includes('v2_raid_attack(p_raid_id bigint, p_damage bigint)'), '引数が増えている')
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
