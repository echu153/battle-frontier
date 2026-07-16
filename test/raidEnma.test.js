import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { calcEffectiveStats } from '../src/lib/stats.js'
import { evoOnHit, evoTakenMult } from '../src/lib/evoCombat.js'
import { raidBossForSlot, bossImage, bossColor } from '../src/lib/raidSchedule.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// calcEffectiveStats に渡す最小プロフィール（ボーナス源を全て0にして装備の寄与だけを見る）
const baseProfile = () => ({
  hp_max: 1000, mp_max: 100, atk: 1000, def: 100, matk: 100, mdef: 100, spd: 100,
  lv: 1, class: '戦士',
})
const equip = (name, weaponType, slot, bonusEffect, stats = {}) => ({
  id: name, equipped: true, slot, bonus_effect: bonusEffect, enhance_plus: 0, evolve_stage: 0,
  weapons: {
    name, weapon_type: weaponType, slot,
    atk_bonus: 0, def_bonus: 0, matk_bonus: 0, mdef_bonus: 0, spd_bonus: 0, ...stats,
  },
})

test('六道輪廻の数珠: 攻撃力の2%が特殊攻撃に加算される', () => {
  const p = baseProfile()
  const withOut = calcEffectiveStats(p, [], [])
  const withIt = calcEffectiveStats(p, [equip('六道輪廻の数珠', 'accessory', 'accessory', 'atk_to_matk_2', { atk_bonus: 30, matk_bonus: 70 })], [])
  // 基礎攻撃1000の2% = +20。装備の matk_bonus 70 と合わせて +90
  assert.equal(withIt.matk - withOut.matk, 90)
})

test('冥獄宝珠・断罪: eff.hitPoisonChance が立ち、攻撃ヒットで毒が付く', () => {
  const eff = calcEffectiveStats(baseProfile(), [equip('冥獄宝珠・断罪', 'orb', 'weapon', 'hit_poison_20', { matk_bonus: 60, spd_bonus: 40 })], [])
  assert.equal(eff.hitPoisonChance, 20)

  // 確率100%相当に固定して付与を確認（Math.randomを差し替え）
  const realRandom = Math.random
  try {
    Math.random = () => 0            // 0*100=0 < 20 → 必ず付与
    const enemyBuffs = {}
    evoOnHit({ hitPoisonChance: 20 }, 100, enemyBuffs, '敵', [])
    assert.deepEqual(enemyBuffs.poison, { turns: 4, dmgRate: 0.03 })

    Math.random = () => 0.99         // 99 >= 20 → 付与されない
    const noBuffs = {}
    evoOnHit({ hitPoisonChance: 20 }, 100, noBuffs, '敵', [])
    assert.equal(noBuffs.poison, undefined)
  } finally { Math.random = realRandom }
})

test('冥獄宝珠・断罪: ダメージ0（回避/バフ技）では毒が付かない', () => {
  const realRandom = Math.random
  try {
    Math.random = () => 0
    const enemyBuffs = {}
    evoOnHit({ hitPoisonChance: 20 }, 0, enemyBuffs, '敵', [])
    assert.equal(enemyBuffs.poison, undefined)
  } finally { Math.random = realRandom }
})

test('冥府王の獄衣: 被ダメ-5%、HP半分以下で-10%（境界はちょうど半分から）', () => {
  const eff = calcEffectiveStats(baseProfile(), [equip('冥府王の獄衣', 'armor', 'armor', 'dmg_taken_down_5_hp50_x2', { def_bonus: 35, mdef_bonus: 35, matk_bonus: 30 })], [])
  assert.equal(eff.gokuiTakenPct, 5)

  assert.equal(evoTakenMult(eff, true, 1.0), 0.95)   // 全快
  assert.equal(evoTakenMult(eff, false, 0.51), 0.95) // 半分より上
  assert.equal(evoTakenMult(eff, true, 0.5), 0.9)    // ちょうど半分＝2倍側
  assert.equal(evoTakenMult(eff, false, 0.1), 0.9)   // 瀕死
  // 未装備なら等倍のまま（hpRatio に関わらず）
  const bare = calcEffectiveStats(baseProfile(), [], [])
  assert.equal(evoTakenMult(bare, true, 0.1), 1)
})

test('冥府王の獄衣: hpRatio を渡し忘れても全快扱いで軽減は効く（呼び出し漏れで無効化されない）', () => {
  const eff = { gokuiTakenPct: 5 }
  assert.equal(evoTakenMult(eff, true), 0.95)
})

// ── SQL とクライアントの出現ローテ一致（ズレると予告と実出現が食い違う） ──
// SQL: 21時枠は d が偶数なら閻魔 / それ以外の枠は旧3体を3日周期
const sqlBossForSlot = (d, slot) => {
  const enmaAt21 = (((d % 2) + 2) % 2) === 0
  if ((slot === 21) === enmaAt21) return '閻魔'
  return ['黒龍ヴァルゼノク', '雨摩座', '雷鋼機神ゼルギアス'][(((d % 3) + 3) % 3)]
}

test('出現ローテ: 毎日2枠のうち必ず1枠が閻魔（＝全出現の1/2）', () => {
  for (let d = 0; d < 60; d++) {
    const pair = [sqlBossForSlot(d, 21), sqlBossForSlot(d, 22)]
    assert.equal(pair.filter(n => n === '閻魔').length, 1, `d=${d} の枠: ${pair.join(' / ')}`)
  }
})

test('出現ローテ: 閻魔の時間帯は日替わり・旧3体は6日で各2回', () => {
  assert.equal(sqlBossForSlot(0, 21), '閻魔')   // 偶数日は21時
  assert.equal(sqlBossForSlot(1, 22), '閻魔')   // 奇数日は22時
  const counts = {}
  for (let d = 0; d < 6; d++) for (const slot of [21, 22]) {
    const n = sqlBossForSlot(d, slot)
    counts[n] = (counts[n] || 0) + 1
  }
  assert.equal(counts['閻魔'], 6)
  assert.equal(counts['黒龍ヴァルゼノク'], 2)
  assert.equal(counts['雨摩座'], 2)
  assert.equal(counts['雷鋼機神ゼルギアス'], 2)
})

test('クライアントの raidBossForSlot が SQL と同じ結果を返す', () => {
  for (let d = 0; d < 40; d++) for (const slot of [21, 22]) {
    assert.equal(raidBossForSlot(d, 0, slot), sqlBossForSlot(d, slot), `d=${d} slot=${slot} でSQLと不一致`)
  }
})

test('bossImage / bossColor が閻魔を含む全ボスを解決する', () => {
  assert.ok(bossImage('閻魔').startsWith('/enma.png'))
  assert.ok(bossImage('雨摩座').startsWith('/amaza.png'))
  assert.ok(bossImage('雷鋼機神ゼルギアス').startsWith('/zerugiasu.png'))
  assert.ok(bossImage('黒龍ヴァルゼノク').startsWith('/varuzenoku.png'))
  assert.equal(bossColor('閻魔'), '#cc66ff')
})

// ── 配線の再発防止 ──
// 各戦闘エンジンは pvp.js → Game.jsx(React) 依存で node から実行できないため、
// 「効果が実戦で消える」既知の壊れ方をソース検査で塞ぐ。
const ENGINES = ['src/pages/Game.jsx', 'src/pages/Abyss.jsx', 'src/pages/Tenkyuu.jsx', 'src/pages/Hachigoku.jsx', 'src/lib/pvp.js']

test('全戦闘エンジンが evoOnHit を経由して攻撃ヒット時効果を適用している', () => {
  for (const f of ENGINES) {
    const src = readFileSync(join(repoRoot, f), 'utf8')
    assert.ok(/import \{[^}]*evoOnHit/.test(src), `${f} が evoOnHit を import していない（毒/出血/スタンが発動しない）`)
    assert.ok(/evoOnHit\(/.test(src), `${f} が evoOnHit を呼んでいない`)
  }
})

test('スキル後の enemyBuffs は置換ではなくマージ（置換すると直前に付与した毒/出血が消える）', () => {
  for (const f of ['src/pages/Game.jsx', 'src/pages/Abyss.jsx', 'src/pages/Tenkyuu.jsx', 'src/pages/Hachigoku.jsx']) {
    const src = readFileSync(join(repoRoot, f), 'utf8')
    assert.ok(!/enemyBuffs = res\.newEnemyBuffs(?!\s*\})/.test(src),
      `${f}: enemyBuffs = res.newEnemyBuffs で置換している。executeSkill 前のコピーで上書きされ、` +
      '装備の攻撃ヒット時効果（毒/出血/素早さダウン）が黙って消える。{ ...enemyBuffs, ...res.newEnemyBuffs } とすること')
  }
})

test('置換で消える壊れ方の再現：マージなら毒が残り、置換だと消える', () => {
  // executeSkill は呼び出し時点の enemyBuffs を浅くコピーして newEnemyBuffs に持つ
  const enemyBuffs = {}
  const resNewEnemyBuffs = { ...enemyBuffs }   // ← スキル実行時のコピー（毒より前）
  const realRandom = Math.random
  try {
    Math.random = () => 0
    evoOnHit({ hitPoisonChance: 20 }, 100, enemyBuffs, '敵', [])   // ← コピーの後に毒を付与
  } finally { Math.random = realRandom }
  assert.ok(enemyBuffs.poison, '前提: evoOnHit は enemyBuffs 側に毒を書く')
  assert.equal({ ...resNewEnemyBuffs }.poison, undefined, '前提: 置換すると毒は消える')
  assert.ok({ ...enemyBuffs, ...resNewEnemyBuffs }.poison, 'マージなら毒は残る')
})

test('被ダメ軽減は全エンジンが共通ヘルパー evoTakenMult を使い、HP割合を渡している', () => {
  for (const f of ENGINES) {
    const src = readFileSync(join(repoRoot, f), 'utf8')
    for (const m of src.matchAll(/evoTakenMult\(([^)]*)\)/g)) {
      if (m[1].startsWith('eff, isPhysical, hpRatio')) continue // 定義本体
      const args = m[1].split(',').length
      assert.ok(args >= 3, `${f}: evoTakenMult(${m[1]}) にHP割合が渡されていない（冥府王の獄衣の瀕死強化が効かない）`)
    }
  }
})

test('SQL: 閻魔の素材・装備・交換所エントリーが揃っている', () => {
  const sql = readFileSync(join(repoRoot, 'supabase_raid_enma_20260717.sql'), 'utf8')
  for (const s of ['獄王の断罪片', '閻魔の審判核', '冥獄宝珠・断罪', '冥府王の獄衣', '六道輪廻の数珠',
                   'hit_poison_20', 'dmg_taken_down_5_hp50_x2', 'atk_to_matk_2', 'raid_boss_mats']) {
    assert.ok(sql.includes(s), `supabase_raid_enma_20260717.sql に ${s} が無い`)
  }
})

test('SQL: raid_boss_mats に全レイドボスの素材が登録されている', () => {
  const sql = readFileSync(join(repoRoot, 'supabase_raid_enma_20260717.sql'), 'utf8')
  const fn = sql.match(/CREATE OR REPLACE FUNCTION raid_boss_mats[\s\S]*?\$\$;/)[0]
  for (const boss of ['雨摩座', '雷鋼機神ゼルギアス', '閻魔', '黒龍ヴァルゼノク']) {
    assert.ok(fn.includes(`'${boss}'`), `raid_boss_mats に ${boss} の分岐が無い（黙って黒龍素材が配られる）`)
  }
})
