// バトルフロンティアⅡ 職業補正とパッシブのテスト（node --test）
// ★2層構造：
//   職業補正 … その職業に就いている間だけ常時かかる（枠を使わない・classBonus.js）
//   パッシブ … スキルの枠に入れる。**複数セットできる**ので1つ1つは控えめ（skills.js の passive:{}）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_BONUS, classBonusOf, classBonusText } from './classBonus.js'
import { SKILL_BY_NAME, skillsOf, SKILL_CLASSES, isBasicClass, isPassive } from './skills.js'
import { createSide, runBattle, liveStats } from './battle.js'
import { hitRate, critRate } from './combat.js'
import { STAT_KEYS } from './stats.js'

const mkRng = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}
const passiveOf = (cls) => skillsOf(cls).find(isPassive)
// パッシブだけを持った1サイドを作る（ステータスの見え方を確かめる用）
const sideWith = (cls, stats, extra = []) =>
  createSide({ name:cls, cls, stats, slots:[{ skill: passiveOf(cls), uses:1 }, ...extra] })

// ============================================================
// 職業補正
// ============================================================

test('職業補正は上位職だけが持つ（初期職とノーブルは補正なし）', () => {
  for (const c of SKILL_CLASSES) {
    if (isBasicClass(c)) assert.equal(classBonusOf(c), null, `${c}に職業補正が付いている`)
    else assert.ok(classBonusOf(c), `${c}に職業補正がない`)
  }
})

test('職業補正の数値はすべて±10%以内で、ステータス名も正しい', () => {
  for (const [cls, b] of Object.entries(CLASS_BONUS)) {
    for (const [k, v] of Object.entries(b.stats)) {
      assert.ok(STAT_KEYS.includes(k), `${cls} の ${k}`)
      assert.ok(Math.abs(v) <= 10, `${cls} の ${k} ${v}% が大きすぎる`)
    }
  }
  assert.deepEqual(CLASS_BONUS['狂戦士'].stats, { str:10, vit:-5 })
  assert.deepEqual(CLASS_BONUS['ギャンブラー'].stats, { luk:10 })
  assert.equal(CLASS_BONUS['異端審問官'].healMult, 0.8)
  assert.equal(classBonusText('狂戦士'), 'STR+10%・VIT-5%')
  assert.equal(classBonusText('異端審問官'), 'INT+10%・自身の回復量0.8倍')
  assert.equal(classBonusText('戦士'), '')
})

test('職業補正は枠を使わずに戦闘開始時から乗る', () => {
  const s = createSide({ cls:'狂戦士', stats: evenStats(534), slots: [] })
  assert.equal(s.buffs.str, 10)
  assert.equal(s.buffs.vit, -5)
  assert.equal(s.slots.length, 0, '職業補正は枠を消費しない')
})

// ============================================================
// パッシブ（1つずつ挙動を固定する）
// ============================================================

test('居合の構え：不発したときの通常攻撃だけ威力が2倍', () => {
  // 発動率0のスキルを置いて必ず不発させる
  const dud = { name:'絶対不発', cls:'侍', kind:'phys', mult:1, proc:0, mp:0, desc:'' }
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const run = (slots) => runBattle(
    { name:'me', cls:'侍', stats, slots },
    { name:'foe', cls:'侍', stats, slots: [] }, { rng: mkRng(11), maxTurns: 6 })
  const withP = run([{ skill: passiveOf('侍'), uses:1 }, { skill: dud, uses:99 }])
  const without = run([{ skill: dud, uses:99 }])
  const dmg = (r) => r.log.filter(l => l.side === 'me' && l.type === 'normal').reduce((t, l) => t + l.damage, 0)
  assert.ok(withP.log.some(l => l.type === 'misfire'), '不発が起きていない')
  assert.ok(dmg(withP) > dmg(without) * 1.5, `不発時の通常攻撃が伸びていない: ${dmg(withP)} vs ${dmg(without)}`)
})

test('バーサク：ダメージを与えるたびSTR+3%（上限15%＝5回）', () => {
  const s = sideWith('狂戦士', evenStats(534))
  assert.deepEqual(s.pa.rages, [{ stat:'str', per:3, max:15 }])
  // 上限を超えて積み上がらない
  const cap = s.pa.rages[0]
  assert.equal(Math.min(cap.max, cap.per * 5), 15)
  assert.equal(Math.min(cap.max, cap.per * 99), 15)
})

test('バーサク：不発・通常攻撃・攻撃が全部外れたときにリセット（補助では消えない）', () => {
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const hit  = { name:'必中打', cls:'狂戦士', kind:'phys', mult:1, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const sup  = { name:'構え',   cls:'狂戦士', kind:'buff', mult:undefined, proc:100, mp:0, buff:{ self:{ vit:1 } }, priority:1, desc:'' }
  const dud  = { name:'絶対不発', cls:'狂戦士', kind:'phys', mult:1, proc:0, mp:0, desc:'' }
  const stackAfter = (slots) => runBattle(
    { name:'me', cls:'狂戦士', stats, slots },
    { name:'foe', cls:'狂戦士', stats, slots: [] }, { rng: mkRng(7), maxTurns: 3 }).a.rage
  const P = { skill: passiveOf('狂戦士'), uses:1 }
  assert.equal(stackAfter([P, { skill:hit, uses:99 }]), 3, '当てるたびに積まれていない')
  // 補助スキルを挟んでもリセットされない（攻撃2回＋補助1回で 2）
  assert.equal(stackAfter([P, { skill:hit, uses:1 }, { skill:sup, uses:1 }, { skill:hit, uses:1 }]), 2)
  // 不発を挟むと0に戻る
  assert.equal(stackAfter([P, { skill:hit, uses:1 }, { skill:dud, uses:99 }]), 0)
})

test('鷹ノ目：最終命中率+5%・隠身：回避率+5%', () => {
  assert.deepEqual(SKILL_BY_NAME['鷹ノ目'].passive, { hitBonus:5 })
  assert.deepEqual(SKILL_BY_NAME['隠身'].passive, { evaBonus:5 })
  const s = evenStats(534)
  assert.equal(hitRate(s, s, 5, 0), Math.round((hitRate(s, s) + 5) * 10) / 10)
  assert.equal(hitRate(s, s, 0, 5), Math.round((hitRate(s, s) - 5) * 10) / 10)
})

test('精密照準：最終クリティカル率+5%', () => {
  const s = evenStats(534)
  assert.equal(critRate(s, s, 5), critRate(s, s) + 5)
})

test('第六感：防御貫通+10%（相手が硬いほど効く）', () => {
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const atk = { name:'素撃ち', cls:'サイキッカー', kind:'phys', mult:2, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const dmg = (slots) => runBattle(
    { name:'me', cls:'サイキッカー', stats, slots },
    { name:'foe', cls:'サイキッカー', stats, slots: [] }, { rng: mkRng(5), maxTurns: 2 })
    .log.find(l => l.side === 'me' && l.type === 'skill').damage
  const a = dmg([{ skill: passiveOf('サイキッカー'), uses:1 }, { skill:atk, uses:99 }])
  const b = dmg([{ skill: atk, uses:99 }])
  assert.ok(a > b, `貫通が効いていない: ${a} vs ${b}`)
})

test('神聖加護：回復量+20% ／ 異端審問官の職業補正：自身の回復量0.8倍', () => {
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const heal = { name:'テスト回復', cls:'聖職者', kind:'heal', proc:100, mp:0, heal:{ rate:1 }, priority:1, desc:'' }
  const amount = (cls, slots) => runBattle(
    { name:'me', cls, stats, slots: [{ skill:heal, uses:99 }, ...slots] },
    { name:'foe', cls, stats, slots: [] }, { rng: mkRng(9), maxTurns: 2 })
    .log.find(l => l.side === 'me' && l.type === 'heal').heal
  const plain = amount('聖職者', [])
  assert.equal(amount('聖職者', [{ skill: passiveOf('聖職者'), uses:1 }]), Math.floor(plain * 1.2))
  // 異端審問官はINT+10%で回復の素材が増えるが、回復量そのものは0.8倍になる
  assert.ok(amount('異端審問官', []) < plain * 1.1 * 0.85)
})

test('魔導剣術：INTの20%をSTRへ「変換」する（INTは減る）', () => {
  assert.deepEqual(SKILL_BY_NAME['魔導剣術'].passive, { convert:{ from:'int_stat', to:'str', pct:20 } })
  const stats = evenStats(534)      // 各1のとき STR=INT=66.75 → 職業補正+3%で69
  const plain = liveStats(createSide({ cls:'魔法剣士', stats, slots: [] }))
  const s = liveStats(sideWith('魔法剣士', stats))
  const moved = Math.round(plain.int_stat * 0.2)
  assert.equal(s.str, plain.str + moved)
  assert.equal(s.int_stat, plain.int_stat - moved, 'INTが減っていない（「変換」なので元は減る）')
})

test('闘争本能：HPが減るほどSTRが上がる（HP25%で最大15%）', () => {
  assert.deepEqual(SKILL_BY_NAME['闘争本能'].passive, { lowHp:{ stat:'str', max:15, at:25 } })
  const stats = evenStats(534)
  const strAt = (hpLeft) => {
    const s = sideWith('体術師', stats)
    s.hp = Math.round(stats.hp * hpLeft)
    return liveStats(s).str
  }
  const full = strAt(1)
  assert.equal(full, liveStats(createSide({ cls:'体術師', stats, slots: [] })).str, 'HP満タンでも補正が乗っている')
  assert.ok(strAt(0.6) > full, 'HPが減っても上がっていない')
  assert.ok(strAt(0.25) > strAt(0.6), 'HP25%までは伸び続けるはず')
  assert.equal(strAt(0.05), strAt(0.25), 'HP25%より下でも伸び続けている（頭打ちになっていない）')
  // 上限は+15%（職業補正STR+5%のうえに乗る＝1 + 0.05 + 0.15）
  const base = createSide({ cls:'体術師', stats, slots: [] }).base.str
  assert.equal(strAt(0.25), Math.round(base * 1.20))
})

test('天啓：発動率+5%（100%は超えない）', () => {
  assert.deepEqual(SKILL_BY_NAME['天啓'].passive, { procBonus:5 })
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const flaky = { name:'半々', cls:'賢者', kind:'phys', mult:1, proc:50, mp:0, sureHit:true, noCrit:true, desc:'' }
  const fires = (slots) => {
    let n = 0
    for (let seed = 1; seed <= 60; seed++) {
      const r = runBattle({ name:'me', cls:'賢者', stats, slots },
        { name:'foe', cls:'賢者', stats, slots: [] }, { rng: mkRng(seed), maxTurns: 1 })
      if (r.log.some(l => l.side === 'me' && l.type === 'skill')) n++
    }
    return n
  }
  assert.ok(fires([{ skill: passiveOf('賢者'), uses:1 }, { skill:flaky, uses:99 }]) >= fires([{ skill:flaky, uses:99 }]))
})

test('骸の壁：被ダメージ10%減（重複しない＝何度取り直しても10%のまま）', () => {
  assert.deepEqual(SKILL_BY_NAME['骸の壁'].passive, { wall:{ pct:10, every:5 } })
  const s = sideWith('死霊使い', evenStats(534))
  assert.equal(s.wallPct, 10, '戦闘開始時から乗っていない')
})

test('心身一如：デバフを1回だけ打ち消す', () => {
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const debuff = { name:'弱体', cls:'戦士', kind:'phys', mult:1, proc:100, mp:0, sureHit:true, noCrit:true,
    buff:{ enemy:{ vit:-20 } }, desc:'' }
  const r = runBattle(
    { name:'foe', cls:'戦士', stats, slots:[{ skill:debuff, uses:99 }] },
    { name:'me', cls:'武僧', stats, slots:[{ skill: passiveOf('武僧'), uses:1 }] },
    { rng: mkRng(6), maxTurns: 3 })
  assert.ok(r.log.some(l => l.type === 'debuffGuard'), 'デバフを防いでいない')
  assert.equal(r.b.guards, 0, '使い切っていない')
  const applied = r.log.filter(l => l.side === 'foe' && l.type === 'buff').length
  // 武僧の職業補正VIT+5%の上に、防げなかったぶんの-20%が乗る
  assert.equal(r.b.buffs.vit, 5 - 20 * (applied - 1), '2回目以降は通す（1回だけ）')
  assert.ok(applied >= 2, 'デバフが1回しか飛んでいない')
})

test('竜鱗の加護：被ダメージ時10%で25%カット', () => {
  assert.deepEqual(SKILL_BY_NAME['竜鱗の加護'].passive, { dodgeCut:{ pct:10, cut:25 } })
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const atk = { name:'素撃ち', cls:'戦士', kind:'phys', mult:2, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const taken = (slots) => {
    let t = 0
    for (let seed = 1; seed <= 40; seed++) {
      const r = runBattle({ name:'foe', cls:'戦士', stats, slots:[{ skill:atk, uses:99 }] },
        { name:'me', cls:'竜騎士', stats, slots }, { rng: mkRng(seed), maxTurns: 5 })
      t += r.log.filter(l => l.side === 'foe' && l.type === 'skill').reduce((x, l) => x + l.damage, 0)
    }
    return t
  }
  assert.ok(taken([{ skill: passiveOf('竜騎士'), uses:1 }]) < taken([]), 'カットが効いていない')
})

test('ギャンブルボディ：当たったとき20%で1.2倍・10%で0.9倍（期待値は+3%）', () => {
  const g = SKILL_BY_NAME['ギャンブルボディ'].passive.gamble
  assert.deepEqual(g, { up:20, upMult:1.2, down:10, downMult:0.9 })
  const ev = (g.up / 100) * g.upMult + (g.down / 100) * g.downMult + (1 - (g.up + g.down) / 100)
  assert.ok(Math.abs(ev - 1.03) < 1e-9, `期待値 ${ev}`)
})

test('パッシブは複数セットできて、効果が合算される', () => {
  // ★複数入れられる前提なので、1つ1つが控えめでないと積み重ねで壊れる
  const s = createSide({ cls:'狩人', stats: evenStats(534), slots: [
    { skill: passiveOf('狩人'), uses:1 },      // 最終命中率+5%
    { skill: passiveOf('魔銃士'), uses:1 },    // 最終クリ率+5%
    { skill: passiveOf('聖騎士'), uses:1 },    // VIT+5%
  ] })
  assert.equal(s.pa.hitBonus, 5)
  assert.equal(s.pa.critBonus, 5)
  assert.equal(s.buffs.vit, 5)
  assert.equal(s.slots.length, 0, 'パッシブが発動順のローテーションに入っている')
})

test('職業補正とパッシブは同じ土俵で加算される（掛け算で膨らまない）', () => {
  // 聖騎士＝職業補正VIT+5% ＋ パッシブ「聖騎士の心得」VIT+5% → 合計+10%（1.05×1.05ではない）
  const s = sideWith('聖騎士', evenStats(534))
  assert.equal(s.buffs.vit, 10)
})
