// バトルフロンティアⅡ 職業補正の伸び（その職業への転職回数）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLASS_BONUS, classBonusOf, classBonusText, growthOf, jobCountOf,
  GROWTH_FROM, MAIN_STEP, SUB_EVERY, SUB_STEP, HALVE_AFTER, HALVE_RATE,
} from './classBonus.js'
import { STAT_KEYS } from './stats.js'
import { createSide } from './battle.js'
import { skillsOf } from './skills.js'

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

// ============================================================
// ★2026-08-18 ユーザー指摘：**職業のスキルは、その職業の main / sub を両方使うこと**。
//   侍は明鏡止水でDEX+20%を配るのに、どのスキルもDEXを見ていなかった＝バフが噛み合っていなかった。
//   「使う」＝威力の参照（主参照・副参照）／自己バフ／パッシブの対象、のどれかに出てくること。
//   ⚠main/sub はマスクデータなので画面には出さない。ここはコードの整合だけを見る。
//
//   TODO_REBUILD に載っている職業は**まだ無印ベースの作り直しをしていない**ので免除。
//   1職ずつ作り直すたびにこの配列から消すこと（空になったら免除ごと消す）。
// ============================================================
const TODO_REBUILD = [
  '狂戦士', '元素使い', '死霊使い', '異端審問官', 'サイキッカー', '式神使い',
  '賢者', '魔銃士', 'ビーストレンジャー', 'ギャンブラー', '竜騎士',
]

const statsUsedBy = (s) => {
  const out = new Set()
  if (s.kind === 'phys') out.add('str')
  if (s.kind === 'mag' || s.kind === 'heal') out.add('int_stat')
  for (const a of s.add || []) out.add(a.stat)
  for (const k of Object.keys(s.buff?.self || {})) out.add(k)
  const p = s.passive || {}
  for (const k of Object.keys(p.statPct || {})) out.add(k)
  if (p.convert) { out.add(p.convert.from); out.add(p.convert.to) }
  if (p.rage) out.add(p.rage.stat)
  if (p.lowHp) out.add(p.lowHp.stat)
  if (p.switchStat) out.add(p.switchStat.stat)
  return out
}

test('作り直し済みの職業は、スキルが職業補正のメイン・サブを両方使う', () => {
  for (const [cls, b] of Object.entries(CLASS_BONUS)) {
    if (TODO_REBUILD.includes(cls)) continue
    const all = new Set()
    for (const s of skillsOf(cls)) for (const k of statsUsedBy(s)) all.add(k)
    for (const key of [b.main, b.sub]) {
      assert.ok(all.has(key), `${cls}: 職業補正が伸ばす ${key} をどのスキルも使っていない（使うステ: ${[...all].join(',')}）`)
    }
  }
})

test('作り直しの残りが分かるようになっている', () => {
  // ★消し忘れ防止。ここに残っている職業＝まだ無印ベースで作り直していない
  for (const cls of TODO_REBUILD) assert.ok(CLASS_BONUS[cls], `${cls} は職業として存在しない`)
  assert.ok(!TODO_REBUILD.includes('侍'), '侍は作り直し済み（2026-08-18）')
})
