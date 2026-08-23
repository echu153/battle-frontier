// バトルフロンティアⅡ スキルデータの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS, SKILL_BY_NAME, skillsOf, SKILL_CLASSES, BASIC_CLASSES, isBasicClass, isPassive,
  powerText, expectedDamage, expectedHeal, PASSIVE_EFFECT_KEYS,
  skillValue, multTotal, effectPrice, targetValue, passiveOf,
} from './skills.js'
import { CLASS_BONUS, classBonusText } from './classBonus.js'
import { STAT_KEYS, STAT_DEFS } from './stats.js'
import { AIL_KEYS } from './ailments.js'
import { damageOf, healOf } from './combat.js'

// 全27職ぶん実装済み（開始時＋初期職6＋上位職12＋複合上位職6＋特殊職2）
// ★2026-08-19にブリーダーを職ごと廃止（v2にペットが無く、効果を作り直す当てが無かった）
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}

// ★2026-08-19に各職+5（5→10）。ATBで「選ぶ」戦闘を入れたら、5枠しか選べないのに
//   候補も5個しかなく**編成の選択が発生しなかった**ため（docs/v2-atb-design.md）
test('初期職は5個・上位職は10個ずつスキルを持つ（全27職）', () => {
  assert.equal(SKILL_CLASSES.length, 27)
  // ★2026-08-19：足すのは上位職だけ（初期職は通過点なので5個のまま）
  for (const c of SKILL_CLASSES) assert.equal(skillsOf(c).length, isBasicClass(c) ? 5 : 10, `${c}のスキル数`)
  assert.equal(SKILLS.length, 7 * 5 + 20 * 11)   // 上位職は枠10個＋枠外のパッシブ1個
  assert.deepEqual(BASIC_CLASSES, ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー'])
})

test('上位職はそれぞれパッシブを1つだけ持つ（枠の外・その職限定）', () => {
  // ★2026-08-23：パッシブは**枠を使わない**。その職業なら最初から効いていて、
  //   LVアップの抽選にも出ず、他職へ持ち出せない（ユーザー指定）
  for (const c of SKILL_CLASSES) {
    assert.equal(skillsOf(c).filter(isPassive).length, 0, `${c}：パッシブが枠に混ざっている`)
    const pas = SKILLS.filter(s => s.cls === c && isPassive(s))
    assert.equal(pas.length, isBasicClass(c) ? 0 : 1, `${c}のパッシブ数`)
    if (pas.length) assert.equal(passiveOf(c), pas[0], `${c}：passiveOf が引けない`)
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

// ★5枠しか組めないので、候補が枠より多いこと自体が「編成の選択」になる
test('上位職は候補（10個）がスキル枠（5枠）より多い', () => {
  for (const c of SKILL_CLASSES) {
    if (isBasicClass(c)) continue
    assert.ok(skillsOf(c).length > 5, c)
  }
})

// ★2026-08-19：主参照（物理STR／魔法INT）だけの技ばかりだと、どの職も同じステを積むだけになる。
//   上位職は**職業補正の main/sub に合った別のステも威力に乗る**技を持たせる
test('上位職は主参照以外のステータスも威力に使う技を持つ', () => {
  for (const c of SKILL_CLASSES) {
    if (isBasicClass(c)) continue
    const withAdd = skillsOf(c).filter(s => (s.kind === 'phys' || s.kind === 'mag') && (s.add || []).length)
    assert.ok(withAdd.length >= 3, `${c}: 副参照のある攻撃スキルが${withAdd.length}個`)
  }
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
      // ★上限は「倍率」ではなく**実質価値**（倍率＋効果）で見る（2026-08-19）。
      //   自分に不利を背負う技（すてみのVIT-20）はそのぶん倍率を上げてよい
      const cap = isBasicClass(s.cls) ? (s.kind === 'mag' ? 2.4 : 2.0) : (s.kind === 'mag' ? 2.7 : 2.4)
      assert.ok(s.mult > 0 && skillValue(s) <= cap + 1e-9, `${s.name} の実質価値 ${skillValue(s)}（上限${cap}）`)
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
test('上位職の実質価値があるけみすとの水準を超えない（物理2.4・魔法2.7）', () => {
  for (const s of SKILLS.filter(s => (s.kind === 'phys' || s.kind === 'mag') && !isBasicClass(s.cls))) {
    const cap = s.kind === 'mag' ? 2.7 : 2.4
    assert.ok(skillValue(s) <= cap + 1e-9, `${s.name}: 実質価値${skillValue(s).toFixed(2)}（上限${cap}）`)
  }
})

// ★2026-08-19：**効果はタダではない**（ユーザー指摘）。
//   「フレイムバースト INT×2.7」と「幽世ノ門 INT×2.7＋吸収30%」が同じ発動率で並んでいて、
//   効果つきのほうが一方的に得だった。効果を倍率へ換算し（effectPrice）、
//   **同じ発動率の帯なら、どの職のどの技も実質価値が同じ**になるように揃える。
test('同じ発動率の帯なら、どの職でも実質価値が揃っている', () => {
  const bad = []
  // ★whileStance（納刀中だけ効く追加効果）を持つ技は対象外。
  //   その効果は「納刀に1行動を払う」ことで買っているので、素の価値は帯より少し低くてよい
  for (const s of SKILLS.filter(s => (s.kind === 'phys' || s.kind === 'mag') && !s.whileStance)) {
    const t = targetValue(s.cls, s.kind, s.proc)
    if (Math.abs(skillValue(s) - t) > 0.06) {
      bad.push(`${s.cls} ${s.name}: 価値${skillValue(s).toFixed(2)}（帯の目標${t}／倍率${multTotal(s)}＋効果${effectPrice(s).toFixed(2)}）`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

test('発動率が低い技ほど実質価値が高い（同じ職・同じ種別で）', () => {
  for (const c of SKILL_CLASSES) {
    for (const kind of ['phys', 'mag']) {
      const list = skillsOf(c).filter(s => s.kind === kind).sort((a, b) => b.proc - a.proc)
      for (let i = 1; i < list.length; i++) {
        if (list[i].proc === list[i - 1].proc) continue
        assert.ok(skillValue(list[i]) >= skillValue(list[i - 1]) - 1e-9,
          `${c}: ${list[i].name}(${list[i].proc}%)の価値が ${list[i - 1].name}(${list[i - 1].proc}%)より低い`)
      }
    }
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

test('補助は優先度1・回復と攻撃は先制なし', () => {
  // v2の規則：補助と回復は既定で優先度1（攻撃より先に動くが、2以上には後攻になる）。
  // ★優先度は順番だけを変える。行動回数は増えない（増えるのはAGIの追加行動だけ）
  for (const s of SKILLS) {
    // ★2026-08-23：**回復は先制を付けない**（ユーザー指定）。補助（バフ・デバフ）だけ優先度1
    if (s.kind === 'buff') assert.equal(s.priority, 1, `${s.name}（補助）は優先度1にすること`)
    else assert.ok(!s.priority, `${s.name}（${s.kind}）は先制を付けない`)
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

// ★2026-08-19：職業の中に「完全下位互換」を作らない（ユーザー指摘）。
//   例）抜刀 STR×1.5＋DEX×0.3・発動90%・MP12 は、居合斬 STR×1.5＋DEX×0.4・発動90%・MP12・出血つき
//       に全部の軸で負けていて、持っていく理由が無かった。
//   ★判定は「同じ土俵（種別・多段数・クリ有無）で、威力・副参照・発動率・消費MP・
//     防御無視・吸収・必中・確定クリ・状態異常・バフ・回復のすべてで A ≥ B、かつどこかで A > B」。
//     ＝Bを選ぶ理由が1つも無い状態。逆に**どこか1つでも勝っていれば通る**（役割が違えばよい）
const addRates = (s) => Object.fromEntries((s.add || []).map(a => [a.stat, a.rate]))
// バフ・デバフは「大きいほど得」に揃えて比べる（相手に掛けるものは符号を反転）
const buffVal = (side, v) => (side === 'self' ? v : -v)
const dominates = (A, B) => {
  if (A === B || A.kind !== B.kind) return false
  // ★特別な仕組みを持つ技（納刀・見切り・納刀中だけの効果）は、持っていない技とは比べない
  for (const k of ['stance', 'foresight', 'whileStance', 'frenzy', 'hpCostPct', 'ailPerHit', 'drainIfAil', 'lowHpBonus', 'highHpBonus', 'vsBuff', 'dispel', 'repeat', 'switchKind', 'variance',
    'combo', 'airUp', 'whileAir', 'src', 'ritual', 'useRitual', 'chargeUp', 'useCharge',
    'form', 'formBuff', 'whileStack', 'whileForm', 'vsAil', 'cure',
    'bigGuard', 'keepAir', 'whileGround', 'rampHit']) if (!!A[k] !== !!B[k]) return false
  if ((A.hits || 1) !== (B.hits || 1)) return false        // 多段と単発は別の土俵
  if (!!A.noCrit !== !!B.noCrit) return false
  if (!!A.mpPct !== !!B.mpPct) return false                // 割合消費も別の土俵
  const better = []
  const cmp = (a, b, label, lowerIsBetter = false) => {
    const [x, y] = lowerIsBetter ? [b, a] : [a, b]
    if (x < y) return false
    if (x > y) better.push(label)
    return true
  }
  if (!cmp(A.mult || 0, B.mult || 0, 'mult')) return false
  const ra = addRates(A), rb = addRates(B)
  for (const [k, v] of Object.entries(rb)) if ((ra[k] || 0) < v) return false
  for (const [k, v] of Object.entries(ra)) if (v > (rb[k] || 0)) better.push('add:' + k)
  if (!cmp(A.proc, B.proc, 'proc')) return false
  if (!cmp(A.mp || 0, B.mp || 0, 'mp', true)) return false
  for (const k of ['defPen', 'drain', 'hitBonus']) if (!cmp(A[k] || 0, B[k] || 0, k)) return false
  // 新しい軸（片方だけ持っていれば上で弾かれている＝ここは両方持っているときの大小）
  const NUM = [['lowHpBonus', 'max'], ['highHpBonus', 'max'], ['vsBuff', 'per'], ['dispel', 'chance'],
    ['repeat', 'per'], ['variance', 'lo'], ['variance', 'hi'],
    ['combo', 'mult'], ['whileAir', 'mult'], ['useRitual', 'per'], ['useCharge', 'per'],
    ['whileStack', 'mult'], ['whileForm', 'mult'], ['vsAil', 'per'],
    ['whileGround', 'mult'], ['bigGuard', 'cut']]
  for (const [k, f] of NUM) if (!cmp(A[k]?.[f] || 0, B[k]?.[f] || 0, k + '.' + f)) return false
  if (!cmp(A.switchKind || 0, B.switchKind || 0, 'switchKind')) return false
  const stack = (x) => (x.chargeUp === true ? 1 : x.chargeUp || 0) + (x.ritual || 0)
  if (!cmp(stack(A), stack(B), 'stack')) return false
  if (!cmp(A.rampHit || 0, B.rampHit || 0, 'rampHit')) return false
  // 起爆（急所突きの「出血を全部消費して威力+」）も軸に入れる
  const burst = (x) => (x.consumeAil ? x.consumeAil.perStack : 0)
  if (!cmp(burst(A), burst(B), 'consumeAil')) return false
  if (A.consumeAil && B.consumeAil && A.consumeAil.key !== B.consumeAil.key) return false
  for (const k of ['sureHit', 'sureCrit']) {
    if (!A[k] && B[k]) return false
    if (A[k] && !B[k]) better.push(k)
  }
  if (B.ail) {
    if (!A.ail || A.ail.key !== B.ail.key || A.ail.chance < B.ail.chance) return false
    if (A.ail.chance > B.ail.chance) better.push('ail')
  } else if (A.ail) better.push('ail')
  for (const side of ['self', 'enemy']) {
    const ba = A.buff?.[side] || {}
    const bb = B.buff?.[side] || {}
    for (const k of new Set([...Object.keys(ba), ...Object.keys(bb)])) {
      const av = buffVal(side, ba[k] || 0)
      const bv = buffVal(side, bb[k] || 0)
      if (av < bv) return false                              // Bの効果に届いていない／Aだけが不利を背負う
      if (av > bv) better.push(`buff:${side}:${k}`)
    }
  }
  for (const k of ['heal', 'regen', 'mpRegen']) {
    const va = (A[k]?.rate || 0) * (A[k]?.turns || 1)
    const vb = (B[k]?.rate || 0) * (B[k]?.turns || 1)
    if (!cmp(va, vb, k)) return false
  }
  return better.length > 0
}

test('職業の中に完全下位互換のスキルが無い', () => {
  const bad = []
  for (const c of SKILL_CLASSES) {
    const list = skillsOf(c).filter(s => !isPassive(s))
    for (const A of list) for (const B of list) {
      if (dominates(A, B)) bad.push(`${c}: 「${B.name}」は「${A.name}」の完全下位互換`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

// ★2026-08-19：**職業をまたいでも**完全下位互換を作らない（ユーザー指摘）。
//   v2は習得済みスキルが転職後も残る＝他職の技も編成できるので、
//   「同じ発動率・同じMPで、片方だけ効果つき」があると職業を選ぶ意味が消える
test('職業をまたいでも完全下位互換のスキルが無い', () => {
  const bad = []
  const all = SKILLS.filter(s => !isPassive(s))
  for (const A of all) for (const B of all) {
    if (A.cls === B.cls) continue
    if (isBasicClass(A.cls) !== isBasicClass(B.cls)) continue   // 初期職と上位職は帯が違う
    if (dominates(A, B)) bad.push(`「${B.cls}/${B.name}」は「${A.cls}/${A.name}」の完全下位互換`)
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length}件: ` + bad.slice(0, 12).join(' / '))
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
  assert.equal(powerText(SKILL_BY_NAME['体当たり']), `STR×${SKILL_BY_NAME['体当たり'].mult}`)
  assert.equal(powerText(SKILL_BY_NAME['狙撃']), `STR×${SKILL_BY_NAME['狙撃'].mult} ＋ AGI×0.6`)
  assert.equal(powerText(SKILL_BY_NAME['連打']), `STR×${SKILL_BY_NAME['連打'].mult} ×3回`)
  // 回復は「何が」「どれだけ」戻るかを威力欄だけで分かるようにする（説明文には数字を書かない）
  assert.equal(powerText(SKILL_BY_NAME['ヒール']), `HPを INT×${SKILL_BY_NAME['ヒール'].heal.rate} 回復`)
  assert.equal(powerText(SKILL_BY_NAME['祈祷']), `毎ターン HPを INT×${SKILL_BY_NAME['祈祷'].regen.rate} 回復 ×4T`)
  assert.equal(powerText(SKILL_BY_NAME['魔力供給']), `毎ターン MPを INT×${SKILL_BY_NAME['魔力供給'].mpRegen.rate} 回復 ×4T`)
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
  assert.equal(CLASS_BONUS['ギャンブラー'].stats.luk, 5)
})

test('割合消費のスキルは想定利用MPに数えない', () => {
  // マナボルトは「そのときの残りMPの20%」を払うので、事前に総額を出せない。
  // 撃つほど1回の消費が減るので撃ち切れず、編成の枠としては消費0として扱う
  const s = SKILL_BY_NAME['マナボルト']
  assert.equal(s.mpPct, 0.2)
  assert.equal(s.mp, 0)
})

// ★2026-08-23：打ち間違いは実戦だと「静かに何も起きない」だけで気づけない。
//   （例：add に stat:'int' と書くと liveStats が 0 を返し、副参照がまるごと消える）
//   書いてよいキー・ステ名・状態異常名を突き合わせて、混入した時点で落とす。
test('スキルに知らないキー・知らないステ名・知らない状態異常が混ざっていない', () => {
  const SKILL_KEYS = new Set([
    'name', 'cls', 'kind', 'mult', 'add', 'hits', 'proc', 'mp', 'mpPct', 'desc', 'acc',
    'priority', 'reqJobs', 'src', 'noCrit', 'sureHit', 'sureCrit', 'hitBonus', 'defPen',
    'drain', 'drainIfAil', 'ail', 'ailPerHit', 'consumeAil', 'buff', 'buffTurns', 'heal',
    'regen', 'mpRegen', 'passive', 'stance', 'whileStance', 'foresight', 'frenzy', 'hpCostPct',
    'lowHpBonus', 'highHpBonus', 'vsBuff', 'vsAil', 'dispel', 'repeat', 'switchKind', 'variance',
    'combo', 'airUp', 'whileAir', 'whileGround', 'keepAir', 'rampHit', 'ritual', 'useRitual',
    'chargeUp', 'useCharge', 'whileStack', 'whileForm', 'form', 'formBuff', 'cure', 'bigGuard',
  ])
  const FORMS = ['hawk', 'bear', 'snake']
  const bad = []
  for (const s of SKILLS) {
    for (const k of Object.keys(s)) if (!SKILL_KEYS.has(k)) bad.push(`${s.name}: 知らないキー ${k}`)
    for (const a of s.add || []) if (!STAT_KEYS.includes(a.stat)) bad.push(`${s.name}: 知らないステ ${a.stat}`)
    if (s.src && !STAT_KEYS.includes(s.src)) bad.push(`${s.name}: src が ${s.src}`)
    for (const side of ['self', 'enemy']) {
      for (const k of Object.keys(s.buff?.[side] || {})) if (!STAT_KEYS.includes(k)) bad.push(`${s.name}: バフのステ ${k}`)
    }
    for (const k of ['ail', 'consumeAil', 'drainIfAil']) {
      if (s[k] && !AIL_KEYS.includes(s[k].key)) bad.push(`${s.name}: 知らない状態異常 ${s[k].key}`)
    }
    if (s.whileStack && !['ritual', 'charge'].includes(s.whileStack.key)) bad.push(`${s.name}: whileStack.key が ${s.whileStack.key}`)
    if (s.form && !FORMS.includes(s.form)) bad.push(`${s.name}: form が ${s.form}`)
    for (const k of Object.keys(s.formBuff || {})) {
      if (k !== 'none' && !FORMS.includes(k)) bad.push(`${s.name}: formBuff のキー ${k}`)
      for (const st of Object.keys(s.formBuff[k])) if (!STAT_KEYS.includes(st)) bad.push(`${s.name}: formBuff のステ ${st}`)
    }
    for (const n of s.combo?.after || []) if (!SKILL_BY_NAME[n]) bad.push(`${s.name}: combo の相手「${n}」が無い`)
    for (const k of Object.keys(s.passive || {})) if (!PASSIVE_EFFECT_KEYS.includes(k)) bad.push(`${s.name}: パッシブの知らないキー ${k}`)
    if ((s.kind === 'phys' || s.kind === 'mag') && !(s.mult > 0)) bad.push(`${s.name}: 倍率が ${s.mult}`)
    for (const k of ['heal', 'regen', 'mpRegen']) if (s[k] && !(s[k].rate > 0)) bad.push(`${s.name}: ${k} の量が0`)
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

// ★2026-08-23 実機で発覚：副参照のステを寄せ替えたのに説明文が「DEXも威力になる」のまま残っていた。
//   威力の欄（powerText）と説明文が食い違うと、どちらを信じてよいか分からなくなる。
test('説明文の「○○も威力になる」が実際の副参照と合っている', () => {
  const L = { str:'STR', dex:'DEX', agi:'AGI', int_stat:'INT', vit:'VIT', luk:'LUK' }
  const RE = /(STR|DEX|AGI|INT|VIT|LUK)(・(STR|DEX|AGI|INT|VIT|LUK))*(も|が大きく)威力になる/
  const bad = []
  for (const s of SKILLS) {
    const adds = [...new Set((s.add || []).map(a => L[a.stat]))]
    const m = RE.exec(s.desc || '')
    if (adds.length && !m) { bad.push(`${s.name}: 副参照 ${adds.join('・')} が説明文に無い`); continue }
    if (!adds.length && m) { bad.push(`${s.name}: 副参照が無いのに「${m[0]}」と書いてある`); continue }
    if (!m) continue
    const said = m[0].replace(/(も|が大きく)威力になる/, '').split('・')
    if (JSON.stringify(said) !== JSON.stringify(adds)) {
      bad.push(`${s.name}: 説明「${said.join('・')}」／実体「${adds.join('・')}」`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

// ★2026-08-23 実機で発覚：聖騎士のホーリーエッジが「STR×1.36 ＋ STR×0.5」になっていた。
//   主参照と同じステを副参照に置くと、副参照の意味（別のステも育てる理由）が消える。
test('副参照が主参照と重ならない（同じステを二重に数えない）', () => {
  const bad = []
  for (const s of SKILLS) {
    if (s.kind !== 'phys' && s.kind !== 'mag') continue
    const main = s.src || (s.kind === 'mag' ? 'int_stat' : 'str')
    const seen = new Set()
    for (const a of s.add || []) {
      if (a.stat === main) bad.push(`${s.name}: 副参照が主参照(${main})と同じ`)
      if (seen.has(a.stat)) bad.push(`${s.name}: 副参照に ${a.stat} が2回`)
      seen.add(a.stat)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

// ★2026-08-23 実機で見つかった不具合はどれも「画面の表示」だった（説明文のステ違い・
//   枠に置けてしまうパッシブ・出ないログ・二重の副参照）。そこで
//   **持っている効果が画面のどこかに出ているか**を全スキルで突き合わせる。
//   出ていない効果は、プレイヤーには存在しないのと同じ。
test('スキルが持つ効果は、威力欄か説明文のどこかに必ず出ている', () => {
  const CLUE = {
    drain:['吸収'], drainIfAil:['吸収'], defPen:['無視', '軽減'], sureHit:['必中'], sureCrit:['確定クリ'],
    hitBonus:['命中'], ail:['%で'], ailPerHit:['1発ごと'], consumeAil:['消費', '弾け'],
    mpPct:['MP'], hpCostPct:['HP'], lowHpBonus:['低いほど'], highHpBonus:['高いほど'], vsBuff:['バフ'],
    vsAil:['状態異常'], dispel:['消す'], repeat:['続け'], switchKind:['直前'], variance:['振れる'],
    combo:['直前'], airUp:['空中'], whileAir:['空中'], whileGround:['地上'], keepAir:['位置', '留まる'],
    rampHit:['1発ごと', 'ほど'], ritual:['呪力'], useRitual:['呪力'], chargeUp:['竜気'], useCharge:['竜気'],
    whileStack:['呪力', '竜気'], whileForm:['獣'], form:['鷹', '熊', '蛇'], formBuff:['獣'],
    cure:['払う'], bigGuard:['軽減', 'ダメージ-'], stance:['納刀'], whileStance:['納刀'],
    foresight:['回避率', '見切り'], frenzy:['狂乱'],
  }
  const bad = []
  for (const s of SKILLS) {
    // ★画面は「必中／クリ無／先制」をチップで出すので、そのぶんも見えている扱いにする
    const chips = [s.sureHit ? '必中' : '', s.noCrit ? 'クリ無' : '', s.priority ? '先制' : ''].join(' ')
    const shown = chips + ' ／ ' + powerText(s) + ' ／ ' + (s.desc || '')
    for (const [k, list] of Object.entries(CLUE)) {
      const v = s[k]
      if (v === undefined || v === null || v === false) continue
      if (!list.some(c => shown.includes(c))) bad.push(`${s.name}: ${k} が画面に出ていない`)
    }
    if (s.buff && !/[+-]\d+%/.test(shown)) bad.push(`${s.name}: バフの数値が出ていない`)
    for (const k of ['heal', 'regen', 'mpRegen']) {
      if (s[k] && !/回復/.test(shown)) bad.push(`${s.name}: ${k} が出ていない`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})

// ============================================================
// ★説明文に書いた数字が、実データとズレていないこと（2026-08-23 実機で発覚）
//   値段を揃える rebalance で**実データだけ**が動き、説明文が置き去りになっていた。
//   例：気孔術は INT×1.2 に上がったのに説明は「INT×1.0を回復」のままだった。
//   回復量は威力欄（powerText）が実データから作るので、**説明文には書かない**。
// ============================================================
test('説明文の数字は実データと合っている（置き去り検出）', () => {
  const label = {}
  for (const [k, v] of Object.entries(STAT_DEFS)) label[v.label] = k
  const near = (a, b) => Math.abs(a - b) < 0.005
  const bad = []
  const NG = (s, msg) => bad.push(`${s.cls}／${s.name}：${msg}`)

  for (const s of SKILLS) {
    const d = s.desc || ''
    // ① 回復量は威力欄が出す。説明文に書くと二重になり、片方だけ古くなる
    for (const m of d.matchAll(/([A-Z]{3})×([\d.]+)を回復/g)) {
      NG(s, `回復量は威力欄が出すので説明文に書かない（「${m[0]}」）`)
    }
    // ② 防御無視（納刀中だけのものは whileStance に入る）
    for (const m of d.matchAll(/防御を(\d+)%無視/g)) {
      const n = Number(m[1]) / 100
      const got = s.defPen ?? s.whileStance?.defPen
      if (got === undefined) NG(s, `説明に「${m[0]}」とあるが防御無視の設定が無い`)
      else if (!near(got, n)) NG(s, `防御無視が説明と違う（説明${m[1]}% / 実データ${Math.round(got * 100)}%）`)
    }
    // ③ 吸収（drain は0〜1の割合・drainIfAil は%）
    for (const m of d.matchAll(/ダメージの(\d+)%[をだけ]*(?:吸収|HPが回復)/g)) {
      const n = Number(m[1])
      const got = s.drain !== undefined ? s.drain * 100 : s.drainIfAil?.pct
      if (got === undefined) NG(s, '説明に吸収とあるが吸収の設定が無い')
      else if (!near(got, n)) NG(s, `吸収が説明と違う（説明${n}% / 実データ${got}%）`)
    }
    // ④ 状態異常の確率
    for (const m of d.matchAll(/(\d+)%で(毒|出血|麻痺|鈍足|回復低下|サイレンス)/g)) {
      const n = Number(m[1])
      const ch = s.ail?.chance ?? s.ailPerHit?.chance
      if (ch === undefined) NG(s, `説明に「${m[0]}」とあるが状態異常の設定が無い`)
      else if (!near(ch, n)) NG(s, `状態異常の確率が説明と違う（説明${n}% / 実データ${ch}%）`)
    }
    // ⑤ 空中・地上の威力／命中
    for (const m of d.matchAll(/空中なら威力\+(\d+)%/g)) {
      if (!near(s.whileAir?.mult ?? -1, Number(m[1]))) NG(s, `空中の威力が説明と違う（説明${m[1]}% / 実データ${s.whileAir?.mult ?? 'なし'}）`)
    }
    for (const m of d.matchAll(/地上なら威力\+(\d+)%/g)) {
      if (!near(s.whileGround?.mult ?? -1, Number(m[1]))) NG(s, `地上の威力が説明と違う（説明${m[1]}% / 実データ${s.whileGround?.mult ?? 'なし'}）`)
    }
    for (const m of d.matchAll(/空中なら命中\+(\d+)%/g)) {
      if (!near(s.whileAir?.hitBonus ?? -1, Number(m[1]))) NG(s, `空中の命中が説明と違う（説明${m[1]}% / 実データ${s.whileAir?.hitBonus ?? 'なし'}）`)
    }
    // ⑥ 相手へのバフ（説明文が唯一の情報源なので、ここが狂うと嘘になる）
    for (const m of d.matchAll(/相手の([A-Z]{3}|HP|MP)([-+])(\d+)%/g)) {
      const k = label[m[1]] || m[1].toLowerCase()
      const want = (m[2] === '-' ? -1 : 1) * Number(m[3])
      const got = s.buff?.enemy?.[k]
      if (got === undefined) NG(s, `説明に「${m[0]}」とあるが相手へのバフが無い`)
      else if (!near(got, want)) NG(s, `相手への${m[1]}が説明と違う（説明${want}% / 実データ${got}%）`)
    }
    // ⑦ 連撃数
    for (const m of d.matchAll(/(\d+)連撃/g)) {
      if ((s.hits || 1) !== Number(m[1])) NG(s, `連撃数が説明と違う（説明${m[1]}回 / 実データ${s.hits || 1}回）`)
    }
  }
  assert.deepEqual(bad, [], '説明文と実データの食い違い:\n' + bad.join('\n'))
})

// ★職業補正に書いた効果は、全部プレイヤーの見えるところに出す（2026-08-23 賢者で発覚）
test('職業補正の効果は、ひとつ残らず表示テキストに出る', () => {
  const SHOWN = {
    stats:       (b, t) => Object.entries(b.stats || {}).every(([k, v]) =>
                   !v || t.includes(`${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${v}%`)),
    healMult:    (b, t) => b.healMult === 1 || t.includes('回復量'),
    offClassCut: (b, t) => t.includes('他職'),
  }
  // 表示に関係しない内部の項目（どのステを伸ばすかの設計メモ）
  const INTERNAL = ['main', 'sub']
  const bad = []
  for (const [cls, b] of Object.entries(CLASS_BONUS)) {
    const t = classBonusText(cls, 0)
    for (const k of Object.keys(b)) {
      if (INTERNAL.includes(k)) continue
      const check = SHOWN[k]
      if (!check) { bad.push(`${cls}: 知らない職業補正 \`${k}\`（表示の作り方を決めていない）`); continue }
      if (!check(b, t)) bad.push(`${cls}: ${k} が表示に出ていない（「${t}」）`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})
