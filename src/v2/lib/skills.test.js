// バトルフロンティアⅡ スキルデータの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKILLS, SKILL_BY_NAME, skillsOf, SKILL_CLASSES, powerText, expectedDamage, expectedHeal } from './skills.js'
import { damageOf, healOf } from './combat.js'
import { STAT_KEYS } from './stats.js'

// いま実装済みの職業（開始時＋初期職6）。上位職を足したらここも増やす
const IMPLEMENTED = ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー']
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}

test('実装済みの職業はそれぞれ5個ずつスキルを持つ', () => {
  assert.deepEqual(SKILL_CLASSES, IMPLEMENTED)
  for (const c of IMPLEMENTED) assert.equal(skillsOf(c).length, 5, `${c}のスキル数`)
  assert.equal(SKILLS.length, IMPLEMENTED.length * 5)
})

test('スキル名は重複しない', () => {
  assert.equal(Object.keys(SKILL_BY_NAME).length, SKILLS.length)
})

test('ノーブルは指定された5つ', () => {
  assert.deepEqual(skillsOf('ノーブル').map(s => s.name),
    ['はたく', '狙い撃ち', '応急手当', '身構える', '気合い'])
})

test('全スキルの数値がレンジに収まっている', () => {
  for (const s of SKILLS) {
    assert.ok(['phys', 'mag', 'heal', 'buff'].includes(s.kind), `${s.name} の種別`)
    assert.ok(s.proc >= 60 && s.proc <= 100, `${s.name} の発動率 ${s.proc}`)
    assert.ok(s.mp >= 0 && s.mp <= 30, `${s.name} の消費MP ${s.mp}`)
    assert.ok(s.desc && s.desc.length > 0, `${s.name} の説明`)
    if (s.kind === 'phys' || s.kind === 'mag') {
      // 初期職は少し低めに置く。魔法は軽減上限が50%(物理は34%)で防御力も厚いぶん
      // 倍率を高く取る（あるけみすとも魔法はINT×2.6等と物理より高い）
      const cap = s.kind === 'mag' ? 2.4 : 2.0
      assert.ok(s.mult > 0 && s.mult <= cap, `${s.name} の倍率 ${s.mult}（上限${cap}）`)
      assert.ok((s.hits || 1) >= 1 && (s.hits || 1) <= 5, `${s.name} の多段数`)
    } else {
      assert.equal(s.mult, undefined, `${s.name} は倍率を持たない`)
    }
    for (const a of s.add || []) assert.ok(STAT_KEYS.includes(a.stat), `${s.name} の副参照 ${a.stat}`)
    for (const side of ['self', 'enemy']) {
      for (const k of Object.keys(s.buff?.[side] || {})) assert.ok(STAT_KEYS.includes(k), `${s.name} のバフ対象 ${k}`)
    }
  }
})

test('強い技ほど発動しにくい（倍率と発動率が逆相関）', () => {
  const atk = SKILLS.filter(s => s.kind === 'phys' || s.kind === 'mag')
  // 主力級の技は発動率90%未満に抑える。しきい値は魔法のほうが高い
  // （魔法は軽減上限50%＋防御も厚いので、同じ倍率でも実際の威力は物理より低い）
  for (const s of atk) {
    const strong = s.kind === 'mag' ? 2.0 : 1.8
    if (s.mult >= strong) assert.ok(s.proc < 90, `${s.name}: 倍率${s.mult}なのに発動率${s.proc}%`)
  }
  // 倍率1.2以下の軽い技は90%以上出る
  for (const s of atk) {
    if (s.mult <= 1.2 && !s.hits) assert.ok(s.proc >= 90, `${s.name}: 倍率${s.mult}なのに発動率${s.proc}%`)
  }
})

// ★2026-08-12の事故：多段の倍率を単発と同じ感覚で置いた結果、爆裂拳(0.7×4=合計2.8)だけ
//   実質倍率が2.10と突出し、格闘家が全職に76〜98%で勝つ状態になっていた。
//   多段は「発動判定が1回・命中判定だけ分散」なので合計倍率がそのまま効く。
//   実質倍率＝(倍率＋副参照の合計)×多段数×発動率。これが職業間で開かないことを固定する。
const effMult = (s) => (s.mult + (s.add || []).reduce((t, a) => t + a.rate, 0)) * (s.hits || 1) * (s.proc / 100)

test('先制(priority)が付くのは回復と防御バフだけ', () => {
  // v2の規則：自分を守る・立て直す技は先制。攻撃バフやMP回復は通常のAGI順
  const pri = SKILLS.filter(s => s.priority > 0).map(s => s.name)
  assert.deepEqual(pri, ['応急手当', '身構える', '防御態勢', 'ヒール', '祈祷', 'プロテク'])
  for (const s of SKILLS.filter(s => s.priority > 0)) {
    assert.ok(s.kind === 'heal' || s.kind === 'buff', `${s.name} は攻撃スキルなのに先制`)
    if (s.kind === 'buff') {
      const self = s.buff?.self || {}
      assert.ok(self.vit || self.int_stat, `${s.name} は防御バフではないのに先制`)
    }
    assert.equal(s.mpRegen, undefined, `${s.name} はMP回復なのに先制`)
  }
})

test('多段スキルはクリティカルしない', () => {
  // クリの固定加算(＋1.5)は元の係数によらないため、多段ほど恩恵が大きい。
  // あるけみすとにも「クリティカルするスキルとしないスキル」があるので、
  // v2では多段を noCrit にして素の倍率で調整する（そうしないと多段が壊れる）。
  for (const s of SKILLS.filter(s => s.hits > 1)) {
    assert.equal(s.noCrit, true, `${s.name} は多段なので noCrit にすること`)
  }
  // 逆に単発をむやみに noCrit にしない（いまは多段だけ）
  for (const s of SKILLS.filter(s => s.noCrit)) {
    assert.ok(s.hits > 1, `${s.name} は多段ではないのに noCrit`)
  }
})

test('多段スキルの合計倍率が単発の主力を超えない', () => {
  const singles = SKILLS.filter(s => (s.kind === 'phys' || s.kind === 'mag') && !s.hits)
  const maxSingle = Math.max(...singles.map(s => s.mult))
  for (const s of SKILLS.filter(s => s.hits > 1)) {
    const total = s.mult * s.hits
    assert.ok(total <= maxSingle * 1.15,
      `${s.name}: 合計倍率${total.toFixed(2)} が単発の最大${maxSingle} を超えている`)
  }
})

// ※この実質倍率にはクリティカルが入っていない。クリは「倍率×1.5＋1.5」なので
//   倍率が低いほど伸び率が大きく（0.47倍→約4.7倍・1.9倍→約2.4倍）、多段ほど有利になる。
//   多段の最終的な値決めは必ずシミュレーション（勝率）で行うこと。
test('職業ごとの主力の実質倍率が2割以上開かない', () => {
  const tops = {}
  for (const s of SKILLS.filter(s => s.kind === 'phys' || s.kind === 'mag')) {
    tops[s.cls] = Math.max(tops[s.cls] || 0, effMult(s))
  }
  // ノーブルは開始時の職業なので意図的に低い＝比較から外す
  const vals = Object.entries(tops).filter(([c]) => c !== 'ノーブル')
  const max = Math.max(...vals.map(v => v[1]))
  const min = Math.min(...vals.map(v => v[1]))
  assert.ok(max / min <= 1.2,
    `職業ごとの主力が開きすぎ: ${vals.map(([c, v]) => `${c}=${v.toFixed(2)}`).join(' ')}`)
})

test('職業ごとに攻撃の型が揃っている', () => {
  const kindsOf = (c) => new Set(skillsOf(c).filter(s => s.kind === 'phys' || s.kind === 'mag').map(s => s.kind))
  for (const c of ['戦士', '弓使い', '格闘家', 'ノーブル']) assert.deepEqual([...kindsOf(c)], ['phys'], `${c}は物理型`)
  for (const c of ['魔法使い', '僧侶', 'サモナー'])         assert.deepEqual([...kindsOf(c)], ['mag'],  `${c}は魔法型`)
})

test('どの職業も補助か回復を1つ以上持つ', () => {
  for (const c of SKILL_CLASSES) {
    const sup = skillsOf(c).filter(s => s.kind === 'buff' || s.kind === 'heal')
    assert.ok(sup.length >= 1, `${c}に補助/回復がない`)
  }
})

test('威力テキストが威力の出どころを示す', () => {
  assert.equal(powerText(SKILL_BY_NAME['体当たり']), 'STR×1.4')
  assert.equal(powerText(SKILL_BY_NAME['狙撃']), 'STR×1 ＋ AGI×0.6')
  assert.equal(powerText(SKILL_BY_NAME['連打']), 'STR×0.57 ×3回')
  assert.equal(powerText(SKILL_BY_NAME['ヒール']), 'INT×1.4')
  assert.equal(powerText(SKILL_BY_NAME['祈祷']), '毎ターン INT×0.5×4T')
  assert.equal(powerText(SKILL_BY_NAME['魔力供給']), '毎ターン MP INT×0.3×4T')
})

test('回復はすべてINT参照で、最大HP/MPの％は使わない', () => {
  const heals = SKILLS.filter(s => s.kind === 'heal')
  assert.ok(heals.length >= 4)
  for (const s of heals) {
    const spec = s.heal || s.regen || s.mpRegen
    assert.ok(spec, `${s.name} に回復量の定義がない`)
    assert.ok(spec.rate > 0 && spec.rate <= 1.5, `${s.name} の倍率 ${spec.rate}`)  // あるけみすと(INT×1.5)を超えない
    assert.equal(spec.hpPct, undefined, `${s.name} が最大HP%を参照している`)
    assert.equal(spec.mpPct, undefined, `${s.name} が最大MP%を参照している`)
    assert.ok(s.proc <= 80, `${s.name} の発動率 ${s.proc}（回復は80%以下）`)
  }
})

test('回復量はINTだけで決まり、HPを積んでも増えない', () => {
  const lowInt  = { int_stat:10,  hp:10000 }
  const highInt = { int_stat:100, hp:100 }
  assert.ok(healOf(highInt, 1.4) > healOf(lowInt, 1.4))
  assert.equal(healOf({ int_stat:100, hp:1 }, 1.4), healOf({ int_stat:100, hp:99999 }, 1.4))
  assert.equal(healOf({ int_stat:0 }, 1.4), 1)  // 最低1
})

test('回復の期待量が同格戦で常識的な範囲に収まる', () => {
  const s = evenStats(534)   // INT67 / HP534
  const heal = expectedHeal(SKILL_BY_NAME['ヒール'], s, healOf)
  const kito = expectedHeal(SKILL_BY_NAME['祈祷'], s, healOf)
  // 1回の回復が最大HPの半分を超えない＝回復だけで膠着しない
  assert.ok(heal > 0 && heal < s.hp * 0.5, `ヒール=${heal}（HP${s.hp}）`)
  assert.ok(kito > 0 && kito < s.hp * 0.5, `祈祷=${kito}`)
  // MP回復は最大MPを超えて配らない
  const mp = expectedHeal(SKILL_BY_NAME['魔力供給'], s, healOf)
  assert.ok(mp > 0 && mp < s.mp, `魔力供給=${mp}（MP${s.mp}）`)
})

test('初期職の期待ダメージが同格相手に対して常識的な範囲に収まる', () => {
  // 戦闘力534（LV100・0転職）どうし。HP534を数ターンで削り切れる程度
  const s = evenStats(534)
  const atk = SKILLS.filter(k => k.kind === 'phys' || k.kind === 'mag')
  for (const sk of atk) {
    const exp = expectedDamage(sk, s, s, damageOf)
    assert.ok(exp > 0, `${sk.name} のダメージが0`)
    // 1ターンで相手のHPの30%を超えない＝即殺されない
    assert.ok(exp < s.hp * 0.3, `${sk.name} の期待ダメージ ${exp} が高すぎる（HP${s.hp}）`)
  }
})

test('必中と防御無視のスキルはちゃんと効く', () => {
  const s = evenStats(534)
  const wall = { ...s, vit: s.vit * 10 }
  const plain = damageOf({ attacker:s, defender:wall, mult:1.5 })
  const pen = damageOf({ attacker:s, defender:wall, mult:1.5, defPen:SKILL_BY_NAME['貫通射撃'].defPen })
  assert.ok(pen > plain, '貫通射撃は硬い相手に強い')
  assert.equal(SKILL_BY_NAME['狙撃'].sureHit, true)
  assert.equal(SKILL_BY_NAME['狙い撃ち'].sureHit, true)
})
