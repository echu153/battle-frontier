// バトルフロンティアⅡ 武器の進化（戦闘記憶）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGES, MAX_STAGE, STAGE_CAP, FOES_KEEP,
  LOW_HP_PCT, PINCH_PCT, OVERKILL_PCT, FAST_TURNS, LONG_TURNS, MP_EMPTY_PCT,
  stageOf, nextStageAt, emptyRecord, recordOfBattle, mergeRecord,
  axisScore, traitScore, pickTrait, makeEvolution, pendingStage,
  atomValue, buildEffect, evolutionText, evolutionLines, evolutionName,
  collectEvolutions, emptyEffects, evoDmgPct, evoCutPct,
  EVO_FIRST_MOVES, EVO_LATE_MOVES, EVO_COMBO_MAX, EVO_HIGH_HP_PCT, EVO_STACK_MAX,
  ATOM_AXIS, FOE_LOW_PCT, FINISH_CAP,
} from './evolve.js'
import { AXES, AXIS_BY_KEY, TRAITS, TRAIT_BY_KEY } from './evolveTraits.js'
import { ATOMS, ATOM_KEYS, atomText, atomWeight } from './evolveAtoms.js'
import { runBattle } from './battle.js'

const rec = (over = {}) => ({ ...emptyRecord(), ...over })

// ============================================================
// 名簿そのもの
// ============================================================
test('★能力は100〜200種ある（ユーザー指示の範囲に収まっている）', () => {
  assert.ok(TRAITS.length >= 100 && TRAITS.length <= 200, `能力は${TRAITS.length}種`)
  assert.ok(AXES.length >= 20, `戦い方の軸は${AXES.length}本`)
})

test('能力のキーと名前が重複していない', () => {
  const keys = TRAITS.map(t => t.key)
  const names = TRAITS.map(t => t.name)
  assert.equal(new Set(keys).size, keys.length, 'キーが重複している')
  assert.equal(new Set(names).size, names.length, '名前が重複している')
})

test('能力はすべて、実在する軸と実在する部品でできている', () => {
  for (const t of TRAITS) {
    assert.ok(AXIS_BY_KEY[t.axis], `${t.key} の軸 ${t.axis} が無い`)
    assert.ok((t.gain || []).length >= 1, `${t.key} に得が無い`)
    for (const [a, w] of [...(t.gain || []), ...(t.cost || [])]) {
      assert.ok(ATOMS[a], `${t.key} の部品 ${a} が無い`)
      assert.ok(w > 0, `${t.key} の倍率が0以下`)
    }
    // 代償にできない部品を代償に置いていないか（文が作れなくなる）
    for (const [a] of t.cost || []) {
      assert.ok(ATOMS[a].down, `${t.key}：${a} は代償にできない部品`)
    }
    for (const [a] of t.gain || []) {
      assert.ok(ATOMS[a].up, `${t.key}：${a} は得にできない部品`)
    }
  }
})

test('どの軸にも能力がぶら下がっている（選ばれない軸を作らない）', () => {
  for (const ax of AXES) {
    const n = TRAITS.filter(t => t.axis === ax.key).length
    assert.ok(n >= 4, `軸 ${ax.key} の能力が${n}個しかない`)
  }
})

test('★代償つきの能力は、そのぶん得が大きい（背負う意味がある）', () => {
  // ★倍率(w)そのままでは比べられない（毎ターン回復の0.3と与ダメージ+の0.3は重さが違う）。
  //   部品ごとの換算値を掛けた「重さ」で比べる
  for (const t of TRAITS) {
    if (!t.cost.length) continue
    const gain = t.gain.reduce((s, [a, w]) => s + atomWeight(a, w), 0)
    const cost = t.cost.reduce((s, [a, w]) => s + atomWeight(a, w), 0)
    assert.ok(gain > cost, `${t.key}（${t.name}）は代償のほうが重い（得${gain.toFixed(2)} / 代償${cost.toFixed(2)}）`)
  }
})

test('全部の部品が、どこかの能力で使われている（死に部品を作らない）', () => {
  const used = new Set(TRAITS.flatMap(t => [...t.gain, ...t.cost].map(([a]) => a)))
  const dead = ATOM_KEYS.filter(k => !used.has(k))
  assert.deepEqual(dead, [], `どの能力にも入っていない部品: ${dead.join(', ')}`)
})

// ============================================================
// 熟練度と段階
// ============================================================
test('段階は3つ。節目を越えるたびに1つ増える', () => {
  assert.deepEqual(STAGES, [100, 500, 2000])
  assert.equal(MAX_STAGE, 3)
  assert.deepEqual(STAGE_CAP, [6, 10, 15])
  assert.equal(stageOf(99), 0)
  assert.equal(stageOf(100), 1)
  assert.equal(stageOf(500), 2)
  assert.equal(stageOf(2000), 3)
  assert.equal(stageOf(99999), 3, '最後まで行ったら増えない')
  assert.equal(nextStageAt(100), 500)
  assert.equal(nextStageAt(2000), null)
})

test('付けられる段階が分かる', () => {
  assert.equal(pendingStage(rec({ battles: 99 }), []), 0)
  assert.equal(pendingStage(rec({ battles: 100 }), []), 1)
  assert.equal(pendingStage(rec({ battles: 100 }), [{ stage:1 }]), 0)
  assert.equal(pendingStage(rec({ battles: 500 }), [{ stage:1 }]), 2)
  assert.equal(pendingStage(rec({ battles: 99999 }), [{}, {}, {}]), 0, '3つで打ち止め')
})

// ============================================================
// ★1戦ぶんの戦績（バトルログをどれだけ細かく読んでいるか）
// ============================================================
const YOU = 'おれおれお'
const FOE = '盗賊'
const logBattle = (log, over = {}) => ({
  winner: 'a', turns: 8, log,
  a: { hp: 500, mp: 100, base: { hp: 1000, mp: 100 } },
  b: { hp: -50, base: { hp: 1000 } },
  ...over,
})

test('★攻撃のしかたを1発ずつ数えている（物理／魔法・スキル／通常・多段・吸収）', () => {
  const r = logBattle([
    { side: YOU, type:'skill',  kind:'phys', hits:1, of:1, crit:true },
    { side: YOU, type:'skill',  kind:'mag',  hits:2, of:3, drain:40 },
    { side: YOU, type:'skill',  kind:'phys', hits:0, of:1 },        // 外した
    { side: YOU, type:'normal', kind:'phys', hit:true },
    { side: FOE, type:'normal', kind:'phys', hit:true },
    { side: FOE, type:'skill',  kind:'mag',  hits:0, of:1 },        // かわした
  ])
  const out = recordOfBattle(r, YOU, FOE)
  assert.equal(out.hits, 3)
  assert.equal(out.crit, 1)
  assert.equal(out.physHits, 2)
  assert.equal(out.magHits, 1)
  assert.equal(out.skillHits, 2)
  assert.equal(out.normalHits, 1)
  assert.equal(out.multiHits, 1, '多段（of>1）で当てたのは1回')
  assert.equal(out.drains, 1)
  assert.equal(out.taken, 2)
  assert.equal(out.dodged, 1)
  assert.equal(out.firsts, 1, '先に動いたのは自分')
})

test('★相手を瀕死にしてから決着までのターン数を数えている（詰めの速さ）', () => {
  assert.equal(FOE_LOW_PCT, 30)
  const turns = (bs) => recordOfBattle(
    logBattle(bs.map((b, i) => ({ type:'hp', turn:i + 1, a:900, aMax:1000, b, bMax:1000 }))), YOU, FOE).finishTurns
  // 相手が30%以下で「まだ生きている」ターンだけ数える
  assert.equal(turns([900, 500, 300, 200, 0]), 2, '300と200の2ターン')
  assert.equal(turns([900, 500, 301, 0]), 0, '31%では数えない')
  assert.equal(turns([900, 300, 0]), 1)
  assert.equal(turns([900, 500, 100]), 1, '倒しきれず終わったターンも数える')
  // 詰めが速いほど軸の点数が高い（ほかの軸と違って「少ないほど強い」）
  assert.equal(FINISH_CAP, 4)
  const score = (t) => axisScore(rec({ wins: 100, finishTurns: t * 100 }), AXIS_BY_KEY.finish)
  assert.ok(score(0.5) > score(2) && score(2) > score(3), '詰めが速いほど高くなっていない')
  assert.equal(score(4), 0, '4ターンかかったら0点')
  assert.equal(score(9), 0)
})

test('★支援と状態異常も数えている（回復・バフ・不発・追加行動・継続ダメージ）', () => {
  const r = logBattle([
    { side: YOU, type:'heal' }, { side: YOU, type:'regen' },
    { side: YOU, type:'buff' }, { side: YOU, type:'misfire' }, { side: YOU, type:'extra' },
    { side: FOE, type:'ailment', ail:'毒' },   // 相手にかかった＝こちらが入れた
    { side: YOU, type:'ailment', ail:'出血' }, // こちらがかかった
    { side: FOE, type:'ailTick', ail:'毒' },   // 相手に刻まれた
    { side: YOU, type:'ailTick', ail:'出血' },
    { side: FOE, type:'heal' },                // 相手の回復は数えない
  ])
  const out = recordOfBattle(r, YOU, FOE)
  assert.equal(out.heals, 2)
  assert.equal(out.buffs, 1)
  assert.equal(out.misfires, 1)
  assert.equal(out.extras, 1)
  assert.equal(out.ail, 1)
  assert.equal(out.ailed, 1)
  assert.equal(out.ailTicks, 1)
})

test('★決着のしかたを数えている（速攻・長期戦・無傷・逆転・過剰火力・ボス）', () => {
  const base = (over) => recordOfBattle(logBattle([], over), YOU, FOE, over.opt || {})
  assert.equal(base({ turns: FAST_TURNS }).fastWin, 1)
  assert.equal(base({ turns: FAST_TURNS + 1 }).fastWin, 0)
  assert.equal(base({ turns: LONG_TURNS }).longWin, 1)
  assert.equal(base({ turns: LONG_TURNS - 1 }).longWin, 0)
  // 無傷
  assert.equal(base({ a: { hp:1000, mp:100, base:{ hp:1000, mp:100 } } }).perfect, 1)
  assert.equal(base({ a: { hp:999,  mp:100, base:{ hp:1000, mp:100 } } }).perfect, 0)
  // 薄氷
  assert.equal(base({ a: { hp:300, mp:100, base:{ hp:1000, mp:100 } } }).lowWin, 1)
  assert.equal(base({ a: { hp:301, mp:100, base:{ hp:1000, mp:100 } } }).lowWin, 0)
  assert.equal(LOW_HP_PCT, 30)
  // 過剰火力（相手の最大HPの25%以上を超過）
  assert.equal(OVERKILL_PCT, 25)
  assert.equal(base({ b: { hp:-250, base:{ hp:1000 } } }).overkill, 1)
  assert.equal(base({ b: { hp:-249, base:{ hp:1000 } } }).overkill, 0)
  // 逆転（途中で25%以下まで落ちた）
  assert.equal(PINCH_PCT, 25)
  const dip = logBattle([{ type:'hp', turn:1, a:200, aMax:1000, b:900, bMax:1000 }])
  assert.equal(recordOfBattle(dip, YOU, FOE).comeback, 1)
  const safe = logBattle([{ type:'hp', turn:1, a:800, aMax:1000, b:900, bMax:1000 }])
  assert.equal(recordOfBattle(safe, YOU, FOE).comeback, 0)
  // ボス
  assert.equal(recordOfBattle(logBattle([]), YOU, FOE, { isBoss: true }).bossWin, 1)
  assert.equal(recordOfBattle(logBattle([]), YOU, FOE).bossWin, 0)
  // MPを使い切った
  assert.equal(MP_EMPTY_PCT, 5)
  assert.equal(base({ a: { hp:500, mp:5,  base:{ hp:1000, mp:100 } } }).mpEmpty, 1)
  assert.equal(base({ a: { hp:500, mp:6,  base:{ hp:1000, mp:100 } } }).mpEmpty, 0)
})

test('負けた戦いは勝ち数にも敵の記録にも入らない', () => {
  const out = recordOfBattle(logBattle([], { winner:'b', a:{ hp:0, mp:0, base:{ hp:1000, mp:100 } } }), YOU, FOE)
  assert.equal(out.battles, 1, '戦った回数は増える')
  assert.equal(out.wins, 0)
  assert.equal(out.lowWin, 0)
  assert.equal(out.perfect, 0)
  assert.deepEqual(out.foes, {})
  assert.equal(out.hurtPct, 1, '全部削られた')
})

test('戦績は足し合わせられる。敵の記録は上位だけ残す', () => {
  const m = mergeRecord(rec({ battles:2, crit:3, foes:{ A:2, B:1 } }), rec({ battles:1, crit:1, foes:{ B:4 } }))
  assert.equal(m.battles, 3)
  assert.equal(m.crit, 4)
  assert.deepEqual(m.foes, { B:5, A:2 })
  const many = {}
  for (let i = 0; i < 40; i++) many['敵' + i] = i
  const big = mergeRecord(emptyRecord(), rec({ foes: many }))
  assert.equal(Object.keys(big.foes).length, FOES_KEEP)
  assert.equal(big.foes['敵39'], 39)
  assert.equal(big.foes['敵0'], undefined)
  assert.equal(mergeRecord(null, rec({ battles:1 })).battles, 1)
  assert.equal(mergeRecord(rec({ battles:1 }), null).battles, 1)
})

// ============================================================
// 何が付くか
// ============================================================
test('戦った数が少ないうちは軸が立たない（まぐれで決まらない）', () => {
  for (const ax of AXES) assert.equal(axisScore(rec({ battles:5, hits:5, wins:2, taken:5 }), ax), 0, ax.key)
  assert.equal(pickTrait(rec({ battles:5, hits:5 })), null)
  assert.equal(makeEvolution(rec({ battles:5 }), 1, []), null)
})

// 「クリティカルばかり取ってきた人」の戦績
const critRec = () => rec({
  battles:300, turns:2400, wins:250, hits:1200, crit:1000,
  physHits:1200, skillHits:1000, normalHits:200, taken:1000, dodged:100,
  finishTurns:800,   // ふつうの詰め（1勝あたり3.2ターン）
})

test('★偏りがそのまま能力の系統になる', () => {
  // ★finishTurns は「ふつうの詰め（1勝3.2ターン）」を入れておく。
  //   書かないと 0ターン＝詰めが完璧 になって、どの戦績でも仕留め際が勝ってしまう
  const usual = { finishTurns: 800 }
  assert.equal(pickTrait({ ...critRec(), ...usual }).trait.axis, 'crit')
  const evaRec = rec({ battles:300, wins:250, hits:600, taken:1200, dodged:900, ...usual })
  assert.equal(pickTrait(evaRec).trait.axis, 'eva')
  const ailRec = rec({ battles:300, wins:250, hits:1000, ail:600, taken:600, ...usual })
  assert.equal(pickTrait(ailRec).trait.axis, 'ail')
  const bossRec = rec({ battles:300, wins:250, bossWin:200, hits:600, taken:600, ...usual })
  assert.equal(pickTrait(bossRec).trait.axis, 'boss')
  // 瀕死にしてからすぐ終わらせてきた人
  const finRec = rec({ battles:300, wins:250, hits:600, taken:600, finishTurns: 100 })
  assert.equal(pickTrait(finRec).trait.axis, 'finish')
})

// ★物理／魔法は職業でほぼ決まる＝誰でも常に振り切る。重みを付けないと、
//   物理職は何度進化させても物理系ばかりになる（2026-08-21 の実測で判明）
test('職業でほぼ決まる軸は、同じ振り切りでも点数が低い', () => {
  const full = rec({ battles:300, wins:250, hits:600, physHits:600, taken:600, dodged:600, finishTurns:800 })
  const phys = axisScore(full, AXIS_BY_KEY.phys)
  const eva  = axisScore(full, AXIS_BY_KEY.eva)
  assert.equal(eva, 1, '回避は振り切れば1.0')
  assert.ok(phys < eva, `物理が下がっていない（${phys}）`)
  assert.equal(AXIS_BY_KEY.phys.w, 0.7)
  assert.equal(AXIS_BY_KEY.mag.w, 0.7)
  // 物理100%でも、回避まで振り切っている人には回避系が付く
  assert.notEqual(pickTrait(full).trait.axis, 'phys')
})

test('★同じ系統でも、2つめの偏りで別の能力が付く', () => {
  // どちらもクリティカル型。片方は瀕死で勝ちがち、もう片方は被弾が多い
  const low  = { ...critRec(), lowWin: 200 }
  const hurt = { ...critRec(), hurtPct: 250 }
  const a = pickTrait(low).trait
  const b = pickTrait(hurt).trait
  assert.notEqual(a.key, b.key, `同じ能力になった（${a.name}）`)
})

test('★同じ能力は2回付かない。2つめ以降は系統も散る', () => {
  const r = { ...critRec(), lowWin: 180, hurtPct: 200 }
  const e1 = makeEvolution(r, 1, [])
  const e2 = makeEvolution(r, 2, [e1.key])
  const e3 = makeEvolution(r, 3, [e1.key, e2.key])
  const keys = [e1.key, e2.key, e3.key]
  assert.equal(new Set(keys).size, 3, '同じ能力が2回付いた')
  for (const e of [e1, e2, e3]) assert.ok(TRAIT_BY_KEY[e.key], '名簿に無い能力が出た')
})

test('★偏りが強いほど大きい値が付く。段階ごとの予算は超えない', () => {
  const strong = critRec()
  const weak = rec({ battles:300, turns:2400, wins:250, hits:1200, crit:70, taken:1000, physHits:1200, finishTurns:800 })
  // 同じ能力で比べる（別々の能力どうしでは倍率が違って比べられない）
  const t = TRAIT_BY_KEY.crit_eye
  const sS = traitScore(strong, t)
  const sW = traitScore(weak, t)
  assert.ok(sS > sW, `偏りの強さが逆（${sS} <= ${sW}）`)
  assert.ok(buildEffect(t, 6, sS).critRate > buildEffect(t, 6, sW).critRate)
  // どの値も「段階の予算 × 部品の倍率」を超えない
  for (const [stage, cap] of STAGE_CAP.entries()) {
    const ev = makeEvolution(strong, stage + 1, [])
    const t = TRAIT_BY_KEY[ev.key]
    for (const [atom, w] of [...t.gain, ...t.cost]) {
      assert.ok(ev.eff[atom] <= cap * w + 0.05, `${ev.key}.${atom} が予算超え`)
    }
  }
  assert.equal(atomValue(6, 1, 0.9), 5.4)
  assert.equal(atomValue(6, 0, 0.9), 0.1, '偏りが0でも最低0.1%は乗る')
})

// ★「同じ相手を狩り続けてきた（宿敵狩り）」は廃止した（2026-08-21 ユーザー判断）。
//   レベル上げは雑魚周回になるので、記憶が「たまたま周回した雑魚」に固定されて意味が無かった。
test('倒した相手の名前で決まる能力はもう無い（宿敵狩りは廃止）', () => {
  for (const t of TRAITS) {
    for (const [a] of [...t.gain, ...t.cost]) {
      assert.notEqual(a, 'dmgFoe', `${t.key} に宿敵狩りの部品が残っている`)
    }
  }
  assert.equal(ATOMS.dmgFoe, undefined, '部品が残っている')
  assert.equal(AXIS_BY_KEY.slayer, undefined, '軸が残っている')
  // 進化に相手の名前は入らない
  const r = rec({ battles:300, wins:250, hits:600, physHits:600, taken:600, finishTurns:800, foes:{ 盗賊: 240 } })
  assert.equal(makeEvolution(r, 1, []).foe, undefined)
})

test('表示用の文が全部の能力で作れる', () => {
  for (const t of TRAITS) {
    const ev = { stage:1, key:t.key, s:0.5, eff: buildEffect(t, 6, 0.5) }
    const lines = evolutionLines(ev)
    assert.equal(lines.length, t.gain.length + t.cost.length, `${t.key} の行数`)
    assert.equal(lines.filter(l => l.cost).length, t.cost.length, `${t.key} の代償の数`)
    for (const l of lines) assert.ok(l.text.length > 0, `${t.key} に空の行`)
    assert.ok(evolutionText(ev).startsWith(t.name), `${t.key} の見出し`)
    assert.equal(evolutionName(ev), t.name)
  }
  assert.equal(evolutionText({ key:'知らないキー' }), '')
  assert.equal(evolutionText(null), '')
  assert.equal(atomText('知らない部品', 1), '')
})

// ============================================================
// 戦闘へ畳み込む
// ============================================================
test('複数の武器に付いた進化は足し算になる', () => {
  const evo = collectEvolutions([
    { key:'crit_eye', eff:{ critRate: 3 } },
    { key:'crit_eye', eff:{ critRate: 4 } },
    { key:'fn_reap',  eff:{ dmgFinish: 5 } },
    { key:'fn_reap',  eff:{ dmgFinish: 6 } },
    { key:'知らないキー', eff:{ critRate: 99 } },  // 名簿に無いものは無視する
  ])
  assert.equal(evo.critRate, 7)
  assert.equal(evo.dmg.finish, 11)
  assert.equal(collectEvolutions(null).critRate, 0)
  assert.deepEqual(collectEvolutions([]), emptyEffects())
})

test('★代償として付いた部品はマイナスで畳まれる', () => {
  // eva_paper … 回避率+（得）／VIT-（代償）
  const evo = collectEvolutions([{ key:'eva_paper', eff:{ eva: 8, st_vit: 5 } }])
  assert.equal(evo.eva, 8)
  assert.equal(evo.stat.vit, -5, 'VITがマイナスで入っていない')
  // crit_focus … クリティカル率+（得）／命中率-（代償）
  const f = collectEvolutions([{ key:'crit_focus', eff:{ critRate: 9, hit: 5 } }])
  assert.equal(f.critRate, 9)
  assert.equal(f.hit, -5)
  // ov_wild … 与ダメージ+（得）／被ダメージ+（代償）※こちらは「+のまま」使う
  const w = collectEvolutions([{ key:'ov_wild', eff:{ dmg: 9, taken: 6 } }])
  assert.equal(w.dmg.always, 9)
  assert.equal(w.taken, 6)
  assert.equal(evoCutPct(w), -6, '被ダメージ+%が軽減のマイナスになっていない')
})

test('条件つきの与ダメージは、条件を満たしたときだけ乗る', () => {
  const evo = emptyEffects()
  Object.assign(evo.dmg, { low:20, high:5, full:7, first:10, late:11, big:12, small:13,
    boss:14, phys:1, mag:2, skill:3, normal:4, multi:6, ail:8, afterDodge:9, afterHurt:15,
    combo:2, finish:16 })
  const at = (ctx) => evoDmgPct(evo, ctx)
  assert.equal(EVO_FIRST_MOVES, 3)
  assert.equal(EVO_LATE_MOVES, 6)
  assert.equal(EVO_HIGH_HP_PCT, 70)
  // 素の状態（HP満タン・1手目・物理・通常攻撃）
  assert.equal(at({ hpPct:100, moves:1 }), 5 + 7 + 10 + 1 + 4)
  assert.equal(at({ hpPct:100, moves:4 }), 5 + 7 + 1 + 4, '4手目からは疾き刃が乗らない')
  assert.equal(at({ hpPct:100, moves:6 }), 5 + 7 + 11 + 1 + 4, '6手目からは遅咲き')
  assert.equal(at({ hpPct:30, moves:4 }), 20 + 1 + 4)
  assert.equal(at({ hpPct:31, moves:4 }), 1 + 4, 'HP31%では薄氷が乗らない')
  assert.equal(at({ hpPct:50, moves:4, kind:'mag', skill:true, multi:true }), 2 + 3 + 6)
  assert.equal(at({ hpPct:50, moves:4, foeBigger:true }), 12 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, foeSmaller:true }), 13 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, foeBoss:true }), 14 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, foeAiled:true }), 8 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, justDodged:true }), 9 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, justHurt:true }), 15 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, foeHpPct:30 }), 16 + 1 + 4, '相手が瀕死のとき')
  assert.equal(at({ hpPct:50, moves:4, foeHpPct:31 }), 1 + 4, '相手が31%では乗らない')
  // 積み重ねは上限で止まる
  assert.equal(EVO_COMBO_MAX, 10)
  assert.equal(at({ hpPct:50, moves:4, combo:3 }), 2 * 3 + 1 + 4)
  assert.equal(at({ hpPct:50, moves:4, combo:99 }), 2 * 10 + 1 + 4)
  assert.equal(evoDmgPct(null, {}), 0)
})

test('部品はぜんぶ、どこかの軸に紐づいているか中立と決まっている', () => {
  for (const k of ATOM_KEYS) {
    const ax = ATOM_AXIS[k]
    if (ax) assert.ok(AXIS_BY_KEY[ax], `${k} の軸 ${ax} が無い`)
  }
})

// ============================================================
// ★ここから下は「全部の部品が本当に戦闘へ効いているか」の総当たり。
//   部品だけ足して battle.js への配線を忘れる事故を止めるためのテスト。
// ============================================================
const makeRng = (seed) => {
  let s = seed >>> 0
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
const stats = (power, over = {}) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u, ...over }
}
const sk = (name, over = {}) => ({ name, kind:'phys', mult:1, proc:100, mp:0, desc:'', ...over })
// 何でも起きる編成：物理・魔法・多段・回復・状態異常つき・不発しうる技
const kitchenSlots = () => [
  { skill: sk('突き',   { mult:0.8, mp:5 }), uses: 99 },
  { skill: sk('術',     { kind:'mag', mult:0.8, mp:5, proc:70 }), uses: 99 },
  { skill: sk('連撃',   { mult:0.3, hits:3, mp:5 }), uses: 99 },
  { skill: sk('毒牙',   { mult:0.5, mp:5, ail:{ key:'poison', chance:60, turns:3 } }), uses: 99 },
  { skill: sk('手当て', { kind:'heal', mp:5, heal:{ rate:0.5 } }), uses: 99 },
]
const me = (evolutions, over = {}) => ({
  name:'私', cls:'戦士', kind:'phys', stats: stats(534), slots: kitchenSlots(), evolutions, ...over,
})
const foeOf = (over = {}) => ({
  name:'盗賊', cls:'戦士', kind:'phys', stats: stats(534), boss: true,
  slots: kitchenSlots(), ...over,
})

// 1戦ぶんの「起きたこと」を1本の文字列にする（どこが変わっても違いが出る）
const fingerprint = (r) => {
  const c = {}
  let mine = 0, theirs = 0
  for (const l of r.log) {
    c[l.type] = (c[l.type] || 0) + 1
    if (l.damage) { if (l.side === '私') mine += l.damage; else theirs += l.damage }
  }
  return [r.winner, r.turns, r.a.hp, r.a.mp, r.b.hp, mine, theirs,
    ...Object.entries(c).sort().map(([k, v]) => `${k}:${v}`)].join('|')
}
// 相手の当たり方を変えた4つの状況。どれか1つでも変われば「効いている」
const SCENES = [
  { label:'互角',   mine:{}, foe:{} },
  { label:'圧勝',   mine:{ stats: stats(1600) }, foe:{} },
  { label:'劣勢',   mine:{}, foe:{ stats: stats(1600) } },
  { label:'回避戦', mine:{ stats: stats(534, { agi: 900 }) },
                    foe:{ slots:[{ skill: sk('大振り', { mult:0.4, acc:1 }), uses:99 }] } },
]
const runScenes = (evolutions) => SCENES.map(sc => {
  const out = []
  for (let seed = 1; seed <= 6; seed++) {
    out.push(fingerprint(runBattle(me(evolutions, sc.mine), foeOf(sc.foe), { rng: makeRng(seed), maxTurns: 40 })))
  }
  return out.join('#')
})

test('★全部の部品が戦闘に効いている（配線の忘れを総当たりで検出）', () => {
  const base = runScenes(undefined)
  const dead = []
  for (const atom of ATOM_KEYS) {
    // その部品を含む能力を1つ借りて、値を大きめに入れる
    const t = TRAITS.find(tr => [...tr.gain, ...tr.cost].some(([a]) => a === atom))
    assert.ok(t, `${atom} を含む能力が無い`)
    const eff = {}
    for (const [a] of [...t.gain, ...t.cost]) eff[a] = a === atom ? 60 : 0
    const ev = [{ key: t.key, eff }]
    if (runScenes(ev).join('@') === base.join('@')) dead.push(atom)
  }
  assert.deepEqual(dead, [], `戦闘に効いていない部品: ${dead.join(', ')}`)
})

test('★進化を持たない戦闘は、これまでとまったく同じ結果になる', () => {
  const a = runBattle(me(undefined), foeOf(), { rng: makeRng(7), maxTurns: 40 })
  const b = runBattle(me([]),        foeOf(), { rng: makeRng(7), maxTurns: 40 })
  assert.equal(fingerprint(a), fingerprint(b))
})

test('不屈は1戦に1回だけ働く', () => {
  const ev = [{ key:'tank_guts', eff:{ guts: 100 } }]
  const r = runBattle(me(ev), foeOf({ stats: stats(4000) }), { rng: makeRng(3), maxTurns: 40 })
  assert.equal(r.log.filter(l => l.type === 'guts' && l.side === '私').length, 1)
})

test('かわすたび・被弾するたびの積み上げには上限がある', () => {
  assert.equal(EVO_STACK_MAX, 5)
  const ev = [{ key:'eva_accel', eff:{ onDodgeAgi: 4 } }]
  const r = runBattle(me(ev, { stats: stats(534, { agi: 900 }) }),
    foeOf({ slots:[{ skill: sk('大振り', { mult:0.4, acc:1 }), uses:99 }] }),
    { rng: makeRng(5), maxTurns: 40 })
  assert.ok(r.a.evoStacks.dodge > EVO_STACK_MAX, 'かわした回数そのものは増え続ける')
})
