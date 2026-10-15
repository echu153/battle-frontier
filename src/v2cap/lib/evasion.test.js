// 回避の決まり（この版だけ）と「命中しやすい」（2026-10-15 ユーザー決定）（node --test）
//   ユーザー「回避の決まりを緩めるのと、スキル自体に命中補正があるスキル入れることで調整して、
//   「命中しやすい」みたいな感じでまとめて、10%くらい命中補正はいってるみたいな」／付ける技は「外しやすい職に1〜2個」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evasionRate, capEvaOf, CAP_EVA, EVA_COEF, EVA_CURVE, evasionScoreOf } from '../../v2/lib/combat.js'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { CAP_RULES } from './rules.js'
import { ICHIJI_SKILLS, EASY_HIT } from './skillsIchiji.js'
import { SKILLS } from './skills.js'

const st = (over = {}) => ({ hp: 10000, mp: 500, str: 300, dex: 100, agi: 100, int_stat: 300, vit: 0, luk: 0, ...over })
const round1 = (v) => Math.round(v * 10) / 10
// 今のⅡの式（AGIの比の5乗）
const rawEva = (a, d) => EVA_COEF * Math.pow(evasionScoreOf(d) / (evasionScoreOf(d) + a.dex), EVA_CURVE)

test('【確定】この版の回避：ステから出した回避が20%を超えたぶんは半分しか伸びない（今のⅡは今のまま）', () => {
  assert.deepEqual(CAP_EVA, { knee: 20, rate: 0.5 })
  assert.deepEqual([capEvaOf(12), capEvaOf(20), capEvaOf(40)], [12, 20, 30])
  const a = st({ dex: 100 })
  const d = st({ agi: 400 })   // 相手のAGIが4倍＝今の式で34%
  const r = rawEva(a, d)
  assert.ok(r > 30 && r < 40, `${r}`)
  assert.equal(evasionRate(a, d), round1(r), '印が無ければ今のⅡの式')
  assert.equal(evasionRate(a, d, 0, 0, null), round1(r))
  assert.equal(evasionRate(a, d, 0, 0, 'cap'), round1(20 + (r - 20) / 2))
  // 「回避+n%」「命中+n%」は、ゆるめたあとに素直に足し引きする
  assert.equal(evasionRate(a, d, 0, 8, 'cap'), round1(20 + (r - 20) / 2 + 8))
  assert.equal(evasionRate(a, d, EASY_HIT, 0, 'cap'), round1(20 + (r - 20) / 2 - EASY_HIT))
  // 20%より下（AGIとDEXが近い）は変わらない
  const e = st({ agi: 120 })
  assert.equal(evasionRate(a, e, 0, 0, 'cap'), evasionRate(a, e))
  assert.equal(CAP_RULES.defRule, 'cap', 'この版は味方も敵もこの印を持つ（出撃・塔・対人）')
})

// 撃つ側（DEX100）と、よける側（AGI400）。乱数を固定して「当たる／外れる」を見る（roll(pct) は 乱数×100 < pct）
const BALL = { name: '弾', cls: null, kind: 'phys', mult: 1, proc: 100, mp: 0, noCrit: true }
const shooter = (skill, rule) => createSide({ name: '撃', cls: null, kind: 'phys', stats: st({ dex: 100 }), noClassBonus: true, passives: [], ...rule, slots: [{ skill, uses: 9 }] })
const dodger = (rule) => createSide({ name: '避', cls: null, kind: 'phys', stats: st({ agi: 400 }), noClassBonus: true, passives: [], slots: [], ...rule })
const hitWith = (skill, rule, r) => {
  const me = shooter(skill, rule)
  const foe = dodger(rule)
  const log = []
  takeAction(me, foe, () => r, log)
  if (skill.jump) takeAction(me, foe, () => r, log)   // 跳躍の技は次の行動で着地して斬る
  const e = log.find(l => l.type === 'skill' || l.type === 'strike')
  return skill.jump ? e.hit : e.hits > 0
}
const hitPct = (rule, hitBonus = 0) => 100 - evasionRate(st({ dex: 100 }), st({ agi: 400 }), hitBonus, 0, rule.defRule || null)

test('戦闘：受ける側の印で回避がゆるむ（印の無い今のⅡの戦闘は今のまま）', () => {
  const now = hitPct({})
  const cap = hitPct(CAP_RULES)
  assert.ok(cap > now)
  const r = (now + cap) / 2 / 100   // 今のⅡでは外れ、この版では当たる乱数
  assert.equal(hitWith(BALL, {}, r), false)
  assert.equal(hitWith(BALL, CAP_RULES, r), true)
})

test('戦闘：命中しやすい技は、その技だけ相手の回避が10%下がる（跳躍の技の着地にも乗る）', () => {
  const plain = hitPct(CAP_RULES)
  const easy = hitPct(CAP_RULES, EASY_HIT)
  assert.ok(Math.abs(easy - plain - EASY_HIT) < 0.15)
  const r = (plain + easy) / 2 / 100   // ふつうの技は外れ、命中しやすい技は当たる乱数
  assert.equal(hitWith(BALL, CAP_RULES, r), false)
  assert.equal(hitWith({ ...BALL, hitBonus: EASY_HIT }, CAP_RULES, r), true)
  const JUMP = { ...BALL, name: '跳', jump: { turns: 1, mult: 1 } }
  assert.equal(hitWith(JUMP, CAP_RULES, r), false)
  assert.equal(hitWith({ ...JUMP, hitBonus: EASY_HIT }, CAP_RULES, r), true)
})

test('【確定】命中しやすい（相手の回避−10%）は、対人で外しやすい職（DEXが低い）の技に1〜2個', () => {
  assert.equal(EASY_HIT, 10)
  const easy = ICHIJI_SKILLS.filter(s => s.hitBonus)
  assert.deepEqual(easy.map(s => s.name).sort(), [
    '雷光斬', 'マナバースト', 'シールドバッシュ', 'サイコショット', 'マインドスパイク', 'ライトニングボルト', '聖光', 'ホーリーチェイン',
  ].sort())
  const per = {}
  for (const s of easy) {
    assert.equal(s.hitBonus, EASY_HIT, s.name)
    assert.ok(s.desc.includes('命中しやすい'), `${s.name}の説明に「命中しやすい」`)
    assert.ok(!s.sureHit, `${s.name}は必ず当たる技ではない`)
    per[s.cls] = (per[s.cls] || 0) + 1
  }
  assert.ok(Object.values(per).every(n => n <= 2), '1職に2つまで')
  for (const c of ['侍', '死霊使い', '式神使い', '霊薬師', '魔銃士']) assert.ok(!per[c], `${c}（対人で強い）には付けない`)
  // 説明に「命中しやすい」と書いた技は、全部 hitBonus を持つ（書き忘れ・付け忘れを見つける）
  for (const s of SKILLS) if (s.desc?.includes('命中しやすい')) assert.equal(s.hitBonus, EASY_HIT, s.name)
})
