// ============================================================
// ステータス計算の整合テスト（node --test）
// calcStatsBreakdown（ステータス詳細ページ用の内訳）が
// calcEffectiveStats（実戦で使う実効ステ）と完全に一致することを保証する。
// ※ 片方にだけ効果を足すと詳細ページの表示がズレる
//    （例: フェイトコアの特殊能力が回避/攻撃%に乗らない不具合）ので、
//    新しい効果を calcEffectiveStats に足したら必ずここが落ちるようにしておく。
// ============================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import { calcEffectiveStats, calcStatsBreakdown, EQUIP_PCT_STAT_KEY } from './stats.js'

const baseProfile = () => ({
  atk: 400, def: 350, matk: 300, mdef: 320, spd: 280, hp_max: 5000, mp_max: 1200,
  museum_atk: 10, museum_hp: 100,
  fishing_matk: 20, fishing_spd: 5,
})

// player_equipment 相当（weapons はネストされた武器マスタ）
const equip = (over = {}) => ({
  id: over.id || 'e1', equipped: true, slot: over.slot || 'weapon',
  enhance_plus: 0, evolve_stage: 0,
  bonus_atk: 0, bonus_def: 0, bonus_matk: 0, bonus_mdef: 0, bonus_spd: 0, bonus_hp: 0, bonus_mp: 0,
  bonus_hit: 0, bonus_crit: 0, bonus_evasion: 0, bonus_effect: null,
  ...over,
  weapons: {
    name: over.name || 'テスト剣', weapon_type: over.weapon_type || 'sword',
    atk_bonus: 100, def_bonus: 0, matk_bonus: 0, mdef_bonus: 0, spd_bonus: 0, hp_bonus: 0, mp_bonus: 0,
    hit_bonus: 0, crit_bonus: 0, crit_resist: 0, crit_dmg: 0,
    ...(over.weapons || {}),
  },
})

// チャーム特殊能力（charmPlayerBonus が返す sp と同じ形）
const sp = (over) => ({
  atkPct: 0, matkPct: 0, defPct: 0, mdefPct: 0,
  hit: 0, evade: 0, crit: 0, critres: 0, ailRes: 0, ...over,
})

const CASES = {
  '装備なし': [baseProfile(), []],
  '武器のみ': [baseProfile(), [equip()]],
  '強化＋宝石': [baseProfile(), [equip({ enhance_plus: 3, gem_type: 'evasion', gem_rank: 'A' })]],
  '真化(MP→特攻)': [baseProfile(), [equip({ slot: 'accessory', evolve_stage: 5, bonus_effect: 'evo_mp_to_matk_5', name: '古代魔導コア' })]],
  '水禍の蒼珠(特防貫通+5%)': [baseProfile(), [equip({ slot: 'accessory', bonus_effect: 'mdef_pen_5', name: '水禍の蒼珠' })]],
  '六道輪廻の数珠(攻撃→特攻2%)': [baseProfile(), [equip({ slot: 'accessory', bonus_effect: 'atk_to_matk_2', name: '六道輪廻の数珠' })]],
  'ペット(チャーム+守り)': [
    { ...baseProfile(), petStat: { atk: 50, def: 40, matk: 30, mdef: 20, hp: 200 }, petCharm: { atk: 100, def: 80, matk: 60, mdef: 40, hp: 300, guard: true } },
    [equip()],
  ],
  // ★ 本件: フェイトコア抽選の特殊能力（回避+6% など）
  'フェイトコア(回避6%)': [
    { ...baseProfile(), petCharm: { atk: 0, def: 0, matk: 0, mdef: 0, hp: 0, sp: sp({ evade: 6 }) } },
    [equip()],
  ],
  'フェイトコア(全部盛り)': [
    {
      ...baseProfile(),
      petStat: { atk: 50, def: 40, matk: 30, mdef: 20, hp: 200 },
      petCharm: { atk: 100, def: 80, matk: 60, mdef: 40, hp: 300, guard: true, sp: sp({ atkPct: 7, matkPct: 5, defPct: 4, mdefPct: 3, hit: 2, evade: 3, crit: 6, critres: 4 }) },
    },
    [equip({ enhance_plus: 2, weapon_type: 'dagger' }), equip({ id: 'e2', slot: 'armor', name: '鎧', weapons: { atk_bonus: 0, def_bonus: 120 } })],
  ],
}

const COMBAT_KEYS = ['hitBonus', 'evasionBonus', 'critBonus', 'critResist', 'defPen', 'mdefPen', 'critDmg']
const STAT_KEYS = [['atk','atk'], ['def','def'], ['matk','matk'], ['mdef','mdef'], ['spd','spd'], ['hp','hp_max'], ['mp','mp_max']]

for (const [label, [profile, equipment]] of Object.entries(CASES)) {
  test(`内訳＝実効ステ: ${label}`, () => {
    const eff = calcEffectiveStats(profile, equipment, [], null)
    const bd = calcStatsBreakdown(profile, equipment, [], null)
    for (const [bk, ek] of STAT_KEYS) {
      assert.equal(bd.effective[bk], eff[ek], `${label} / ${bk}`)
    }
    for (const k of COMBAT_KEYS) {
      assert.equal(bd.combat[k], eff[k], `${label} / ${k}`)
    }
  })
}

// 回避+6% のチャームを着けたら詳細ページの回避補正が実際に +6% 増える
test('フェイトコアの回避%が戦闘補正に乗る', () => {
  const plain = calcStatsBreakdown(baseProfile(), [equip()], [], null)
  const withSp = calcStatsBreakdown(
    { ...baseProfile(), petCharm: { sp: sp({ evade: 6 }) } }, [equip()], [], null,
  )
  assert.equal(withSp.combat.evasionBonus, plain.combat.evasionBonus + 6)
})

// 銃の固有能力（攻撃/特殊攻撃+3%）が攻撃・特攻の両方に乗る
test('銃の固有能力が攻撃%・特攻%の両方に乗る', () => {
  const gun = equip({ weapon_type: 'gun', name: 'テスト銃', weapons: { atk_bonus: 100, matk_bonus: 100 } })
  const bd = calcStatsBreakdown(baseProfile(), [gun], [], null)
  assert.equal(bd.atkPct, 3)
  assert.equal(bd.matkPct, 3)
})

// ステータス詳細の「装備%補正」表示漏れ検知:
// calcStatsBreakdown が返す *Pct は必ず EQUIP_PCT_STAT_KEY に載っていること
// （銃の攻撃+3%が詳細ページに出ていなかった不具合の再発防止）
test('装備%補正はすべて表示対象になっている', () => {
  const bd = calcStatsBreakdown(baseProfile(), [equip()], [], null)
  const shown = new Set(Object.values(EQUIP_PCT_STAT_KEY))
  const pctKeys = Object.keys(bd).filter(k => k.endsWith('Pct'))
  assert.ok(pctKeys.length > 0)
  for (const k of pctKeys) {
    assert.ok(shown.has(k), `${k} が EQUIP_PCT_STAT_KEY に無い＝ステータス詳細で表示されない`)
  }
})

// 攻撃+10% のチャームは最終攻撃力へ乗算される
test('フェイトコアの攻撃%が実効攻撃に乗る', () => {
  const plain = calcStatsBreakdown(baseProfile(), [equip()], [], null)
  const withSp = calcStatsBreakdown(
    { ...baseProfile(), petCharm: { sp: sp({ atkPct: 10 }) } }, [equip()], [], null,
  )
  assert.equal(withSp.effective.atk, Math.round(plain.effective.atk * 1.10))
})
