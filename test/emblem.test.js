import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMBLEM_CRYSTALS,
  EMBLEM_CRYSTAL_KEYS,
  EMBLEM_ALLOC_MAX,
  getEmblemRank,
  emblemLevelCap,
  emblemLevelUpCost,
  emblemAllocTotal,
  calcEmblemBonus,
} from '../src/lib/emblem.js'
import { HACHIGOKU_HELLS, HACHIGOKU_DIFFICULTIES, HACHIGOKU_HP_MULT, makeHachigokuEnemy } from '../src/lib/hachigoku.js'
import { emblemDmgMult, emblemDrainAmount, emblemDotMult } from '../src/lib/emblemCombat.js'

test('getEmblemRank レベル→ランク境界', () => {
  assert.equal(getEmblemRank(1), 'F')
  assert.equal(getEmblemRank(20), 'F')
  assert.equal(getEmblemRank(21), 'E')
  assert.equal(getEmblemRank(100), 'B')
  assert.equal(getEmblemRank(101), 'A')
  assert.equal(getEmblemRank(126), 'S')
  assert.equal(getEmblemRank(151), 'SS')
  assert.equal(getEmblemRank(176), 'SSS')
  assert.equal(getEmblemRank(200), 'SSS')
})

test('emblemLevelCap 上限開放段階', () => {
  assert.equal(emblemLevelCap(0), 100)
  assert.equal(emblemLevelCap(1), 125)
  assert.equal(emblemLevelCap(2), 150)
  assert.equal(emblemLevelCap(3), 175)
  assert.equal(emblemLevelCap(4), 200)
  assert.equal(emblemLevelCap(99), 200) // クランプ
})

test('emblemLevelUpCost 欠片コスト（SQLのemblem_level_upと一致させること）', () => {
  assert.equal(emblemLevelUpCost(2), 1)
  assert.equal(emblemLevelUpCost(50), 1)
  assert.equal(emblemLevelUpCost(51), 2)
  assert.equal(emblemLevelUpCost(100), 2)
  assert.equal(emblemLevelUpCost(101), 3)
  assert.equal(emblemLevelUpCost(150), 3)
  assert.equal(emblemLevelUpCost(151), 4)
  assert.equal(emblemLevelUpCost(200), 4)
})

test('MAX50振りの合計値が仕様書のMAX値と一致する', () => {
  // 仕様: 力/知恵=1250, 守護/抗魔=1500, 物理/特殊/破甲/破魔/会耐=15,
  //  裂傷/火傷/猛毒/致命=50, 吸収=10, 回避=5, 改心/防絶=10, 防毒/防麻/防火/防血=20
  const expect = {
    chikara: 1250, chie: 1250, shugo: 1500, kouma: 1500,
    butsuri: 15, tokushu: 15, hakou: 15, hama: 15, kaitai: 15,
    resshou: 50, kashou: 50, moudoku: 50, chimei: 50,
    bkyuushuu: 10, tkyuushuu: 10, kaihi: 5, kaishin: 10, bouzetsu: 10,
    boudoku: 20, bouma: 20, bouka: 20, bouketsu: 20,
  }
  for (const key of EMBLEM_CRYSTAL_KEYS) {
    const c = EMBLEM_CRYSTALS[key]
    assert.ok(Math.abs(c.per * EMBLEM_ALLOC_MAX - expect[key]) < 1e-9, `${key}: ${c.per * EMBLEM_ALLOC_MAX} != ${expect[key]}`)
  }
})

test('calcEmblemBonus 集約とMAX超過クランプ', () => {
  const b = calcEmblemBonus({ chikara: 10, butsuri: 50, boudoku: 999, kaihi: 5 })
  assert.equal(b.flat.atk, 250)          // 力10振り=攻撃+250
  assert.equal(b.physDmg, 15)            // 物理50振り=+15%
  assert.equal(b.ailRes.poison, 20)      // 999振り指定でも50でクランプ=+20%
  assert.equal(b.evasion, 0.5)           // 回避5振り=+0.5%
  assert.equal(emblemAllocTotal({ chikara: 10, butsuri: 50 }), 60)
  // 空/未定義は無効果
  const z = calcEmblemBonus(null)
  assert.equal(z.flat.atk + z.physDmg + z.evasion, 0)
})

test('emblemCombat ヘルパー（eff.emblem 無しは素通し）', () => {
  assert.equal(emblemDmgMult({}, true), 1)
  assert.equal(emblemDrainAmount({}, 1000, true), 0)
  assert.equal(emblemDotMult({}, 'burn'), 1)
  const eff = { emblem: { physDmg: 15, specialDmg: 6, physDrain: 10, specialDrain: 4, dotUp: { burn: 50, bleed: 25, poison: 0 }, ailRes: {} } }
  assert.ok(Math.abs(emblemDmgMult(eff, true) - 1.15) < 1e-9)
  assert.ok(Math.abs(emblemDmgMult(eff, false) - 1.06) < 1e-9)
  assert.equal(emblemDrainAmount(eff, 1000, true), 100)
  assert.equal(emblemDrainAmount(eff, 1000, false), 40)
  assert.ok(Math.abs(emblemDotMult(eff, 'burn') - 1.5) < 1e-9)
  assert.equal(emblemDotMult(eff, 'poison'), 1)
})

test('makeHachigokuEnemy 総合力が推奨戦闘力に概ね一致', () => {
  for (const h of HACHIGOKU_HELLS) {
    for (const d of HACHIGOKU_DIFFICULTIES) {
      const e = makeHachigokuEnemy(h.key, d.key)
      assert.ok(e, `${h.key}/${d.key} 生成失敗`)
      // HPは演出上×HACHIGOKU_HP_MULTされているため、配分検証は増量前の値で行う
      // 両刀(dualWield)はA=Cなので攻撃はどちらか片方だけを実効値として数える
      // statMult(Hell=1.3)は全ステ一律の底上げなので割り戻して配分を検証する
      const atkPart = e.dualWield ? e.atk : e.atk + e.matk
      const total = Math.floor((e.hp / HACHIGOKU_HP_MULT / 10 + atkPart + e.def + e.mdef + e.spd) / (d.statMult || 1))
      const ratio = total / d.target
      assert.ok(ratio > 0.95 && ratio < 1.05, `${h.key}/${d.key}: 総合力${total} が目標${d.target}から乖離`)
      // タイプと攻撃ステの整合（両刀はA=C・magicalはmatk・physicalはatkに寄せる）
      if (e.dualWield) assert.equal(e.atk, e.matk)
      else if (e.type === 'magical') assert.equal(e.atk, 0)
      else assert.equal(e.matk, 0)
    }
  }
})

// SQL(emblem_level_up)のレベルアップ処理をそのまま再現するシミュレータ。
//   v_cap := ARRAY[100,125,150,175,200][cap_stage+1]
//   FOR 1..p_times: v_next=level+ups+1; EXIT WHEN v_next > v_cap; cost += costOf(v_next); ups++
//   ups=0 なら 'cap_reached'
const simLevelUp = (level, capStage, times) => {
  const cap = [100, 125, 150, 175, 200][Math.min(capStage, 4)]
  let cost = 0, ups = 0
  for (let i = 0; i < times; i++) {
    const next = level + ups + 1
    if (next > cap) break
    cost += next <= 50 ? 1 : next <= 100 ? 2 : next <= 150 ? 3 : 4
    ups++
  }
  if (ups === 0) return { error: 'cap_reached', cap }
  return { ok: true, level: level + ups, used_shards: cost, ups }
}

test('LV1から上げ続けるとcap_stage=0では必ずLV100で止まり、以降は cap_reached', () => {
  let level = 1
  let totalCost = 0
  let guard = 0
  // 実際に +10 ずつ上げ続ける（UIの「まとめて+10」と同じ）
  while (guard++ < 100) {
    const r = simLevelUp(level, 0, 10)
    if (r.error) break
    level = r.level
    totalCost += r.used_shards
  }
  assert.equal(level, 100, `LV100で止まるはずが LV${level}`)
  // 止まった後は何度呼んでも cap_reached（LV101以上にならない）
  const after = simLevelUp(level, 0, 10)
  assert.equal(after.error, 'cap_reached')
  assert.equal(after.cap, 100)
  assert.equal(simLevelUp(level, 0, 1).error, 'cap_reached')
  // LV1→100 の総コスト: LV2〜50=1×49 + LV51〜100=2×50 = 149個
  assert.equal(totalCost, 149)
  // クライアント側の上限判定も一致（LV100で上限到達＝開放ボタンが出る）
  assert.equal(emblemLevelCap(0), 100)
  assert.equal(level >= emblemLevelCap(0), true)
  assert.equal(getEmblemRank(100), 'B')
})

test('上限開放するとLV100を超えて上げられる（cap_stage=1で125まで）', () => {
  // 開放前はLV100で頭打ち
  assert.equal(simLevelUp(100, 0, 25).error, 'cap_reached')
  // 開放後(cap_stage=1)は125まで上がり、そこで再び止まる
  const r = simLevelUp(100, 1, 25)
  assert.equal(r.ok, true)
  assert.equal(r.level, 125)
  assert.equal(r.ups, 25)
  assert.equal(r.used_shards, 25 * 3)  // LV101〜125は1回3個
  assert.equal(simLevelUp(125, 1, 10).error, 'cap_reached')
  // 最終段階(cap_stage=4)は200で打ち止め
  const r2 = simLevelUp(199, 4, 10)
  assert.equal(r2.level, 200)
  assert.equal(simLevelUp(200, 4, 10).error, 'cap_reached')
  assert.equal(getEmblemRank(200), 'SSS')
})

test('emblemLevelUpCost（クライアント表示）がSQLのコスト計算と一致する', () => {
  for (let lv = 2; lv <= 200; lv++) {
    const sqlCost = lv <= 50 ? 1 : lv <= 100 ? 2 : lv <= 150 ? 3 : 4
    assert.equal(emblemLevelUpCost(lv), sqlCost, `LV${lv}のコスト不一致`)
  }
})

test('八獄の結晶キーはすべて emblem.js に存在する', () => {
  const covered = new Set()
  for (const h of HACHIGOKU_HELLS) {
    for (const c of h.crystals) {
      assert.ok(EMBLEM_CRYSTALS[c], `${h.key} の結晶キー ${c} が未定義`)
      covered.add(c)
    }
  }
  // 22種すべてがどこかの地獄でドロップする
  assert.equal(covered.size, EMBLEM_CRYSTAL_KEYS.length)
})
