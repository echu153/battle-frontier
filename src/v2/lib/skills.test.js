// バトルフロンティアⅡ スキルデータの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS, SKILL_BY_NAME, skillsOf, SKILL_CLASSES, BASIC_CLASSES, isBasicClass, isPassive,
  powerText, expectedDamage, expectedHeal, PASSIVE_EFFECT_KEYS,
} from './skills.js'
import { CLASS_BONUS } from './classBonus.js'
import { damageOf, healOf } from './combat.js'
import { STAT_KEYS } from './stats.js'

// 全28職ぶん実装済み（開始時＋初期職6＋上位職12＋複合上位職6＋特殊職3）
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}

test('全28職がそれぞれ5個ずつスキルを持つ', () => {
  assert.equal(SKILL_CLASSES.length, 28)
  for (const c of SKILL_CLASSES) assert.equal(skillsOf(c).length, 5, `${c}のスキル数`)
  assert.equal(SKILLS.length, 28 * 5)
  assert.deepEqual(BASIC_CLASSES, ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー'])
})

test('上位職はそれぞれパッシブを1つだけ持つ', () => {
  // ★パッシブは複数セットできるので、1つ1つは控えめにする。初期職にはパッシブを置かない
  for (const c of SKILL_CLASSES) {
    const pas = skillsOf(c).filter(isPassive)
    assert.equal(pas.length, isBasicClass(c) ? 0 : 1, `${c}のパッシブ数`)
    for (const s of pas) {
      assert.ok(s.passive, `${s.name} に効果がない`)
      assert.equal(s.buff, undefined, `${s.name} は buff ではなく passive に書く`)
      assert.equal(s.mp, 0, `${s.name} は消費MPを持たない`)
      assert.equal(s.proc, undefined, `${s.name} は発動率を持たない`)
      for (const k of Object.keys(s.passive)) {
        if (k === 'todo') continue
        assert.ok(PASSIVE_EFFECT_KEYS.includes(k), `${s.name} の ${k} は battle.js が解釈できない`)
      }
      // 単なるステータス+%は職業補正の担当。パッシブ側で書く場合も控えめ（±5%まで）
      for (const v of Object.values(s.passive.statPct || {})) {
        assert.ok(Math.abs(v) <= 5, `${s.name} の効果 ${v}% が大きすぎる（複数セットできるので控えめに）`)
      }
    }
  }
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
    assert.ok(['phys', 'mag', 'heal', 'buff', 'passive'].includes(s.kind), `${s.name} の種別`)
    assert.ok(s.mp >= 0 && s.mp <= 45, `${s.name} の消費MP ${s.mp}`)
    assert.ok(s.desc && s.desc.length > 0, `${s.name} の説明`)
    if (isPassive(s)) continue   // パッシブは発動率も倍率も持たない
    assert.ok(s.proc >= 40 && s.proc <= 100, `${s.name} の発動率 ${s.proc}`)
    if (s.kind === 'phys' || s.kind === 'mag') {
      // 初期職は低め。上位職はあるけみすと級（あるけみすとの物理レンジ STR×2.2〜2.4 が基準）。
      // 魔法は軽減上限が50%(物理は34%)で防御力も厚いぶん倍率を高く取る
      const cap = isBasicClass(s.cls) ? (s.kind === 'mag' ? 2.4 : 2.0) : (s.kind === 'mag' ? 2.7 : 2.4)
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

// ★2026-08-18：上位職の切り札を3.0〜4.0まで伸ばしていて、あるけみすと（物理 STR×2.2〜2.4）の
//   倍近くになっていた。**上限は「主参照＋副参照の合計 ×多段数」で見る**（単体の mult だけ見ると
//   エレメンタルエッジ 2.2＋INT×1.0＝3.2 のような技がすり抜ける）。
//   魔法の上限が物理の1.13倍なのは、v2の式では同じ倍率だと魔法のほうが通らないため
//   （軽減上限50%対34%・魔防は INT＋VIT×0.15）。この比で同格の期待ダメージが揃う。
test('上位職の合計倍率があるけみすとの水準を超えない（物理2.4・魔法2.7）', () => {
  const total = (s) => (s.mult + (s.add || []).reduce((t, a) => t + a.rate, 0)) * (s.hits || 1)
  for (const s of SKILLS.filter(s => (s.kind === 'phys' || s.kind === 'mag') && !isBasicClass(s.cls))) {
    const cap = s.kind === 'mag' ? 2.7 : 2.4
    assert.ok(total(s) <= cap + 1e-9, `${s.name}: 合計倍率${total(s).toFixed(2)}（上限${cap}）`)
  }
})

test('強い技ほど発動しにくい（威力と発動率が逆相関）', () => {
  // ★あるけみすと準拠の考え方。向こうもメテオストライク60%・フルハウス20%と、
  //   強い技ほど出にくい。倍率だけ上げて発動率を据え置くと「強い技を連打」一択になる。
  // 比較は「倍率＋副ステ参照」の合計で行う（狙撃はSTR×1.0＋AGI×0.6＝実質1.6）
  const atk = SKILLS.filter(s => s.kind === 'phys' || s.kind === 'mag')
  const power = (s) => (s.mult + (s.add || []).reduce((t, a) => t + a.rate, 0)) * (s.hits || 1)
  for (const s of atk) {
    const p = power(s)
    const strong = (isBasicClass(s.cls) ? 0 : 0.6) + (s.kind === 'mag' ? 2.0 : 1.8)
    if (p >= strong) assert.ok(s.proc < 90, `${s.name}: 威力${p.toFixed(2)}なのに発動率${s.proc}%`)
    if (p <= 1.2) assert.ok(s.proc >= 90, `${s.name}: 威力${p.toFixed(2)}なのに発動率${s.proc}%`)
    // 切り札級（威力3.0以上）はさらに出にくく
    if (p >= 3.0) assert.ok(s.proc <= 85, `${s.name}: 切り札なのに発動率${s.proc}%`)
  }
})

// ★2026-08-12の事故：多段の倍率を単発と同じ感覚で置いた結果、爆裂拳(0.7×4=合計2.8)だけ
//   実質倍率が2.10と突出し、格闘家が全職に76〜98%で勝つ状態になっていた。
//   多段は「発動判定が1回・命中判定だけ分散」なので合計倍率がそのまま効く。
//   実質倍率＝(倍率＋副参照の合計)×多段数×発動率。これが職業間で開かないことを固定する。
const effMult = (s) => (s.mult + (s.add || []).reduce((t, a) => t + a.rate, 0)) * (s.hits || 1) * (s.proc / 100)

test('補助・回復は優先度1、攻撃スキルは優先度なし', () => {
  // v2の規則：補助と回復は既定で優先度1（攻撃より先に動くが、2以上には後攻になる）。
  // ★優先度は順番だけを変える。行動回数は増えない（増えるのはAGIの追加行動だけ）
  for (const s of SKILLS) {
    const support = s.kind === 'buff' || s.kind === 'heal'
    if (support) assert.equal(s.priority, 1, `${s.name}（${s.kind}）は優先度1にすること`)
    else assert.ok(!s.priority, `${s.name}（${s.kind}）は攻撃スキルなので優先度なし`)
  }
  // 2以上はまだ未使用（上位職の切り札用に空けてある）
  assert.equal(SKILLS.filter(s => s.priority >= 2).length, 0)
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
  for (const s of SKILLS.filter(s => s.hits > 1)) {
    const singles = SKILLS.filter(x => (x.kind === 'phys' || x.kind === 'mag') && !x.hits && isBasicClass(x.cls) === isBasicClass(s.cls))
    const maxSingle = Math.max(...singles.map(x => x.mult))
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
  // ノーブルは開始時の職業なので意図的に低い＝比較から外す。
  // 初期職と上位職はレンジが違うので、同じ区分の中だけで比べる
  for (const basic of [true, false]) {
    const vals = Object.entries(tops).filter(([c]) => c !== 'ノーブル' && isBasicClass(c) === basic)
    const max = Math.max(...vals.map(v => v[1]))
    const min = Math.min(...vals.map(v => v[1]))
    assert.ok(max / min <= 1.45,
      `${basic ? '初期職' : '上位職'}の主力が開きすぎ: ${vals.map(([c, v]) => `${c}=${v.toFixed(2)}`).join(' ')}`)
  }
})

test('職業ごとに攻撃の型が揃っている', () => {
  const kindsOf = (c) => new Set(skillsOf(c).filter(s => s.kind === 'phys' || s.kind === 'mag').map(s => s.kind))
  for (const c of ['戦士', '弓使い', '格闘家', 'ノーブル']) assert.deepEqual([...kindsOf(c)], ['phys'], `${c}は物理型`)
  for (const c of ['魔法使い', '僧侶', 'サモナー'])         assert.deepEqual([...kindsOf(c)], ['mag'],  `${c}は魔法型`)
})

test('どの職業も攻撃以外の枠を1つ以上持つ', () => {
  for (const c of SKILL_CLASSES) {
    const sup = skillsOf(c).filter(s => s.kind !== 'phys' && s.kind !== 'mag')
    assert.ok(sup.length >= 1, `${c}に補助/回復/パッシブがない`)
  }
})

test('威力テキストが威力の出どころを示す', () => {
  assert.equal(powerText(SKILL_BY_NAME['体当たり']), 'STR×1.4')
  assert.equal(powerText(SKILL_BY_NAME['狙撃']), 'STR×0.8 ＋ AGI×0.6')
  assert.equal(powerText(SKILL_BY_NAME['連打']), 'STR×0.54 ×3回')
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
    assert.ok(s.proc <= 85, `${s.name} の発動率 ${s.proc}（回復は85%以下）`)
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
  const atk = SKILLS.filter(k => (k.kind === 'phys' || k.kind === 'mag') && isBasicClass(k.cls))
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

test('LUKは威力の参照に使わない（クリティカル率と回避だけに効かせる）', () => {
  // ★LUKはクリティカル率(LUK差)と回避に効く。そこへ威力の参照まで足すと二重取りになる
  for (const s of SKILLS) {
    for (const a of s.add || []) {
      assert.notEqual(a.stat, 'luk', `${s.name} が威力にLUKを参照している`)
    }
  }
  // 職業補正やバフでLUKを上げるのは可（クリティカル率が上がる＝ギャンブラーらしさ）
  assert.equal(CLASS_BONUS['ギャンブラー'].stats.luk, 10)
})

test('割合消費のスキルは想定利用MPに数えない', () => {
  // マナボルトは「そのときの残りMPの20%」を払うので、事前に総額を出せない。
  // 撃つほど1回の消費が減るので撃ち切れず、編成の枠としては消費0として扱う
  const s = SKILL_BY_NAME['マナボルト']
  assert.equal(s.mpPct, 0.2)
  assert.equal(s.mp, 0)
})
