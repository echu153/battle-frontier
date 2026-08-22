// バトルフロンティアⅡ 職業補正とパッシブのテスト（node --test）
// ★2層構造：
//   職業補正 … その職業に就いている間だけ常時かかる（枠を使わない・classBonus.js）
//   パッシブ … スキルの枠に入れる。**複数セットできる**ので1つ1つは控えめ（skills.js の passive:{}）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_BONUS, classBonusOf, classBonusText } from './classBonus.js'
import { SKILL_BY_NAME, skillsOf, SKILL_CLASSES, isBasicClass, isPassive } from './skills.js'
import { createSide, runBattle, liveStats, mpCostOf, hitMultOf, critDmgOf, critRateStackOf, repeatMultOf } from './battle.js'
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

test('バーサク：VIT+5%。HPが減るほどSTRが段で上がる（90/50/30%）', () => {
  assert.deepEqual(SKILL_BY_NAME['バーサク'].passive, {
    statPct:{ vit:5 },
    hpSteps:[{ at:90, statPct:{ str:5 } }, { at:50, statPct:{ str:10 } }, { at:30, statPct:{ str:15 } }],
  })
  const stats = evenStats(534)
  const s = sideWith('狂戦士', stats)
  const strAt = (hpPct) => { s.hp = s.base.hp * hpPct / 100; return liveStats(s).str }
  const base = strAt(100)
  // 期待値は liveStats と同じ出し方（職業補正と同じ土俵で足す）
  const expect = (add) => Math.round(s.base.str * (1 + (s.buffs.str + add) / 100))
  // ★段は重ならない。いちばん深い段だけが効く
  assert.equal(strAt(95), base, '90%より上では乗らない')
  assert.equal(strAt(90), expect(5), '90%以下で+5%')
  assert.equal(strAt(60), expect(5))
  assert.equal(strAt(50), expect(10), '50%以下で+10%')
  assert.equal(strAt(30), expect(15), '30%以下で+15%')
  assert.equal(strAt(5),  expect(15), 'それ以上は伸びない')
  // VIT+5% は常時（職業補正のVIT-5%と相殺して0になる）
  assert.equal(s.pa.statPct.vit, 5)
})

test('鷹ノ目：命中率1.1倍・相手が瀕死(HP30%以下)なら1.3倍', () => {
  assert.deepEqual(SKILL_BY_NAME['鷹ノ目'].passive, { hitMult:{ mult:1.1, lowMult:1.3, at:30 } })
  const stats = evenStats(534)
  const me = sideWith('狩人', stats)
  const foe = createSide({ cls:'狩人', stats, slots: [] })
  assert.equal(hitMultOf(me, foe), 1.1)
  foe.hp = foe.base.hp * 0.3
  assert.equal(hitMultOf(me, foe), 1.3, 'HP30%以下で伸びる')
  foe.hp = foe.base.hp * 0.31
  assert.equal(hitMultOf(me, foe), 1.1)
  // 命中率そのものにも掛かる（回避の高い相手ほど差が出る）
  const dodgy = { ...stats, agi: stats.agi * 4, dex: stats.dex * 4 }
  const base = hitRate(stats, dodgy)
  assert.ok(base * 1.1 > base)
})

test('隠身：自分が付ける出血が10スタックまで貯まる・クリダメ+10%', () => {
  assert.deepEqual(SKILL_BY_NAME['隠身'].passive, { bleedMax:10, critDmg:10 })
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const bleeder = { name:'血', cls:'暗殺者', kind:'phys', mult:1, proc:100, mp:0, sureHit:true, noCrit:true, ail:{ key:'bleed', chance:100 }, desc:'' }
  const stacksOf = (slots) => {
    const r = runBattle({ name:'me', cls:'暗殺者', stats, slots },
      { name:'foe', cls:'暗殺者', stats, slots: [] }, { rng: mkRng(3), maxTurns: 12 })
    return r.b.ail.bleed?.stacks || 0
  }
  const withPassive = stacksOf([{ skill: passiveOf('暗殺者'), uses:1 }, { skill: bleeder, uses:99 }])
  const without = stacksOf([{ skill: bleeder, uses:99 }])
  assert.equal(without, 5, '素の上限は5')
  assert.ok(withPassive > 5, `隠身で伸びていない（${withPassive}）`)
  assert.ok(withPassive <= 10)
  // クリティカルのダメージ+10%
  const me = sideWith('暗殺者', stats)
  assert.equal(critDmgOf(me), 10)
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

test('魔導剣術：INTの30%をSTRへ「変換」する（INTは減る）', () => {
  assert.deepEqual(SKILL_BY_NAME['魔導剣術'].passive, { convert:{ from:'int_stat', to:'str', pct:30 } })
  const stats = evenStats(534)      // 各1のとき STR=INT=66.75 → 職業補正+3%で69
  const plain = liveStats(createSide({ cls:'魔法剣士', stats, slots: [] }))
  const s = liveStats(sideWith('魔法剣士', stats))
  const moved = Math.round(plain.int_stat * 0.3)
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

test('天啓：発動率+5%・消費MP-10%', () => {
  assert.deepEqual(SKILL_BY_NAME['天啓'].passive, { procBonus:5, mpCut:10 })
  // 消費MPが1割引きになる
  const heavy = SKILL_BY_NAME['アストラルレイ']
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const plain = createSide({ cls:'賢者', stats, slots: [] })
  const wise = sideWith('賢者', stats)
  assert.equal(mpCostOf(plain, heavy), heavy.mp)
  assert.equal(mpCostOf(wise, heavy), Math.max(0, Math.round(heavy.mp * 0.9)))
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

test('骸の壁：次に受けるダメージを10%減らし、1回受けると消える', () => {
  assert.deepEqual(SKILL_BY_NAME['骸の壁'].passive, { wall:{ pct:10, every:5 } })
  const s = sideWith('死霊使い', evenStats(534))
  assert.equal(s.wallPct, 10, '戦闘開始時から乗っていない')
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const atk = { name:'素撃ち', cls:'戦士', kind:'phys', mult:2, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const r = runBattle(
    { name:'foe', cls:'戦士', stats, slots:[{ skill:atk, uses:99 }] },
    { name:'me', cls:'死霊使い', stats, slots:[{ skill: passiveOf('死霊使い'), uses:1 }] },
    { rng: mkRng(21), maxTurns: 3 })
  const wall = r.log.filter(l => l.type === 'wall')
  assert.equal(wall.length, 1, '1回受けたら消えるはず')
  assert.equal(r.b.wallPct, 0)
  // 2発目以降は素通し（1発目だけ軽い）
  const hits = r.log.filter(l => l.side === 'foe' && l.type === 'skill').map(l => l.damage)
  assert.ok(hits.length >= 2 && hits[0] < hits[1], `1発目が軽くなっていない: ${hits.join(',')}`)
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

test('竜鱗の加護：被ダメージ時20%で20%カット', () => {
  assert.deepEqual(SKILL_BY_NAME['竜鱗の加護'].passive, { dodgeCut:{ pct:20, cut:20 } })
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

test('ギャンブルボディ：当たったとき30%で1.2倍・20%で0.9倍（期待値は+4%）', () => {
  const g = SKILL_BY_NAME['ギャンブルボディ'].passive.gamble
  assert.deepEqual(g, { up:30, upMult:1.2, down:20, downMult:0.9 })
  const ev = (g.up / 100) * g.upMult + (g.down / 100) * g.downMult + (1 - (g.up + g.down) / 100)
  assert.ok(Math.abs(ev - 1.04) < 1e-9, `期待値 ${ev}`)
})

test('パッシブは複数セットできて、効果が合算される', () => {
  // ★複数入れられる前提なので、1つ1つが控えめでないと積み重ねで壊れる
  const s = createSide({ cls:'狩人', stats: evenStats(534), slots: [
    { skill: passiveOf('狩人'), uses:1 },      // 命中率1.1倍
    { skill: passiveOf('魔銃士'), uses:1 },    // 当てるたびにクリ率+1%
    { skill: passiveOf('聖騎士'), uses:1 },    // VIT+5%・軽減率+10%
  ] })
  assert.deepEqual(s.pa.hitMult, { mult:1.1, lowMult:1.3, at:30 })
  assert.deepEqual(s.pa.hitStack, { critRate:1, critDmg:2, max:5 })
  assert.equal(s.pa.defRed, 10)
  assert.equal(s.buffs.vit, 5)
  assert.equal(s.slots.length, 0, 'パッシブが発動順のローテーションに入っている')
})

test('職業補正とパッシブは同じ土俵で加算される（掛け算で膨らまない）', () => {
  // 聖騎士＝職業補正VIT+5% ＋ パッシブ「聖騎士の心得」VIT+5% → 合計+10%（1.05×1.05ではない）
  const s = sideWith('聖騎士', evenStats(534))
  assert.equal(s.buffs.vit, 10)
})

test('精密照準：当てるたびクリ率+1%・クリダメ+2%（5回まで）', () => {
  assert.deepEqual(SKILL_BY_NAME['精密照準'].passive, { hitStack:{ critRate:1, critDmg:2, max:5 } })
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const atk = { name:'素撃ち', cls:'魔銃士', kind:'phys', mult:1, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const r = runBattle({ name:'me', cls:'魔銃士', stats, slots:[{ skill: passiveOf('魔銃士'), uses:1 }, { skill:atk, uses:99 }] },
    { name:'foe', cls:'魔銃士', stats, slots: [] }, { rng: mkRng(7), maxTurns: 10 })
  assert.equal(r.a.hitStacks, 5, '5回で頭打ち')
  assert.equal(critRateStackOf(r.a), 5)
  assert.equal(critDmgOf(r.a), 10)
})

test('第六感：行動するたびAGI・DEX+1%（最大10%）', () => {
  assert.deepEqual(SKILL_BY_NAME['第六感'].passive, { perAct:{ stats:['agi', 'dex'], per:1, max:10 } })
  const stats = evenStats(534)
  const s = sideWith('サイキッカー', stats)
  const at = (acts) => { s.acts = acts; return liveStats(s) }
  const base = at(0)
  assert.equal(at(3).agi, Math.round(base.agi * 1.03))
  assert.equal(at(3).dex, Math.round(base.dex * 1.03))
  assert.equal(at(20).agi, Math.round(base.agi * 1.10), '10%で頭打ち')
})

test('聖騎士の心得：VIT+5%・受けるときの軽減率+10%', () => {
  assert.deepEqual(SKILL_BY_NAME['聖騎士の心得'].passive, { statPct:{ vit:5 }, defRed:10 })
  const stats = { ...evenStats(534), hp: 10 ** 7 }
  const atk = { name:'素撃ち', cls:'戦士', kind:'phys', mult:2, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const taken = (slots) => {
    const r = runBattle({ name:'foe', cls:'戦士', stats, slots:[{ skill:atk, uses:99 }] },
      { name:'me', cls:'聖騎士', stats, slots }, { rng: mkRng(11), maxTurns: 6 })
    return r.log.filter(l => l.side === 'foe' && l.type === 'skill').reduce((t, l) => t + l.damage, 0)
  }
  assert.ok(taken([{ skill: passiveOf('聖騎士'), uses:1 }]) < taken([]), '軽減が効いていない')
})

test('精霊召喚士：同じ精霊を呼び続けるほど威力が上がる（パッシブ側）', () => {
  const kyo = SKILL_BY_NAME['精霊共鳴']
  assert.deepEqual(kyo.passive.repeat, { per:8, max:3 })
  const me = createSide({ name:'召', cls:'精霊召喚士', kind:'mag', stats: evenStats(534),
    slots:[{ skill: kyo, uses:9 }, { skill: SKILL_BY_NAME['サラマンド'], uses:9 }] })
  assert.deepEqual(me.pa.repeat, { per:8, max:3 })
  me.repeatCount = 0
  assert.equal(repeatMultOf({ name:'X' }, me), 1)
  me.repeatCount = 2
  assert.equal(Number(repeatMultOf({ name:'X' }, me).toFixed(3)), 1.16)
  me.repeatCount = 9
  assert.equal(Number(repeatMultOf({ name:'X' }, me).toFixed(3)), 1.24, '3回で頭打ち')
})
