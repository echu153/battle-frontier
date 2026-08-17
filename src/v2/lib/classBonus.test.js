// バトルフロンティアⅡ 職業補正の伸び（その職業への転職回数）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLASS_BONUS, classBonusOf, classBonusText, growthOf, jobCountOf,
  GROWTH_FROM, MAIN_STEP, SUB_EVERY, SUB_STEP, HALVE_AFTER, HALVE_RATE,
} from './classBonus.js'
import { STAT_KEYS } from './stats.js'
import { createSide } from './battle.js'

test('全職にメインとサブが割り振ってある（マスクデータ）', () => {
  for (const [cls, b] of Object.entries(CLASS_BONUS)) {
    assert.ok(STAT_KEYS.includes(b.main), `${cls} のメイン`)
    assert.ok(STAT_KEYS.includes(b.sub), `${cls} のサブ`)
    assert.notEqual(b.main, b.sub, `${cls} はメインとサブが同じ`)
    // メインは「もともとの補正が付いているステ」であること（辻褄が合わなくなるため）
    if (Object.keys(b.stats).length === 1) {
      assert.equal(b.main, Object.keys(b.stats)[0], `${cls} のメインが元の補正とズレている`)
    }
  }
})

test('伸びるのは2回目の転職から', () => {
  assert.equal(GROWTH_FROM, 2)
  assert.deepEqual(growthOf(0), { main:0, sub:0 })
  assert.deepEqual(growthOf(1), { main:0, sub:0 })   // 1回目はもともとの補正値のまま
  assert.deepEqual(growthOf(2), { main:0.1, sub:0 })
  // 元の補正値がそのまま出る
  assert.equal(classBonusText('侍', 1), 'STR+5%')
  assert.equal(classBonusText('侍', 0), 'STR+5%')
})

test('メインは1回ごとに+0.1%、サブは5回ごとに+0.1%', () => {
  assert.equal(MAIN_STEP, 0.1)
  assert.equal(SUB_EVERY, 5)
  assert.equal(SUB_STEP, 0.1)
  assert.deepEqual(growthOf(6),  { main:0.5, sub:0.1 })   // 5回ぶん → サブ1段
  assert.deepEqual(growthOf(11), { main:1,   sub:0.2 })   // 10回ぶん → サブ2段
  assert.deepEqual(growthOf(51), { main:5,   sub:1 })     // 50回ぶん → サブ10段
  // サブは5回そろうまで増えない
  assert.equal(growthOf(5).sub, 0)
  assert.equal(growthOf(6).sub, 0.1)
})

test('★100回を超えたぶんは上がり幅が半分になる', () => {
  assert.equal(HALVE_AFTER, 100)
  assert.equal(HALVE_RATE, 0.5)
  assert.deepEqual(growthOf(101), { main:10, sub:2 })          // ちょうど100回ぶん＝満額
  assert.deepEqual(growthOf(102), { main:10.05, sub:2 })       // 101回目から半分
  assert.deepEqual(growthOf(201), { main:15, sub:3 })          // 200回ぶん＝100満額+100半額
  // 半減後の伸びは半減前のちょうど半分
  const a = growthOf(151).main - growthOf(101).main   // 101〜150（半減後の50回）
  const b = growthOf(51).main  - growthOf(1).main     // 1〜50（満額の50回）
  assert.equal(a, b / 2)
})

test('もともとの補正値に足される（メインとサブの両方）', () => {
  // 侍 STR+5 / main:str, sub:dex
  assert.deepEqual(classBonusOf('侍', 11).stats, { str:6, dex:0.2 })
  assert.equal(classBonusText('侍', 11), 'STR+6%・DEX+0.2%')
  // 狂戦士 STR+10/VIT-5 は、マイナス側はそのまま残る
  assert.deepEqual(classBonusOf('狂戦士', 11).stats, { str:11, vit:-5, agi:0.2 })
  // 異端審問官の回復量倍率は伸びても変わらない
  assert.equal(classBonusOf('異端審問官', 101).healMult, 0.8)
})

test('職業補正を持たない職は、転職回数がいくつでも補正なしのまま', () => {
  for (const c of ['戦士', '魔法使い', 'ノーブル']) {
    assert.equal(classBonusOf(c, 999), null, `${c}に補正が付いた`)
    assert.equal(classBonusText(c, 999), '')
  }
})

test('jobCountOf はその職業の転職回数を引く', () => {
  const prof = { class:'侍', job_counts: { 侍: 7, 狩人: 3 } }
  assert.equal(jobCountOf(prof), 7)
  assert.equal(jobCountOf(prof, '狩人'), 3)
  assert.equal(jobCountOf(prof, '賢者'), 0)     // 就いたことがない
  assert.equal(jobCountOf(null), 0)
  assert.equal(jobCountOf({ class:'侍' }), 0)   // job_counts が無い（作りたて）
})

test('戦闘にも効く（fighter.jobCount ぶん強くなる）', () => {
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, 100]))
  const a = createSide({ cls:'侍', stats, slots: [], jobCount: 1 })
  const b = createSide({ cls:'侍', stats, slots: [], jobCount: 51 })
  // 侍のメインはSTR。転職を重ねたほうがSTRのバフが大きい
  assert.ok((b.buffs.str || 0) > (a.buffs.str || 0), '転職回数でSTRのバフが増えていない')
  assert.equal(a.buffs.str, 5)
  assert.equal(b.buffs.str, 10)   // 5 + 50回ぶん(5.0)
})
