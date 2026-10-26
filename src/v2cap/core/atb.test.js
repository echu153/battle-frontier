// v2cap の ATB戦闘のテスト（node --test）
// ★オート戦闘（runBattle）がターンの処理の切り出しで変わっていないことも一緒に見る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAtb, runFor, advance, reserve, clearQueue, startMacro, stopMacro, toggleGuard, canUse, cdLeft, chosenOf, needFor,
  fillRatio, cdOfProc, buffSecOf, buffChips,
  STEP_SEC, TURN_SEC, GAUGE_FULL, GUARD_CUT, GUARD_CD, CAST_SEC, MAX_DT,
} from './atb.js'
import { runBattle } from './battle.js'
import { buildBattleLog } from './battleLog.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
// 死なないように体力だけ極端に多くする（時間の動きを見たいので）
const stats = (over = {}) => ({ hp:1000000, mp:1000, str:100, dex:100, agi:100, int_stat:100, vit:100, luk:100, ...over })
const sk = (name, over = {}) => ({ name, cls:'戦士', kind:'phys', mult:1, proc:100, mp:0, sureHit:true, desc:'', ...over })
const fighter = (name, skills = [], over = {}) => ({
  name, cls:'戦士', kind:'phys', noClassBonus:true, passives:[], stats: stats(over.stats),
  slots: skills.map(skill => ({ skill, uses: 1 })), ...over.extra,
})
const acts = (st, name, type) => st.log.filter(l => l.side === name && (!type || l.type === type))
const skillTimes = (st, name, skill) => {
  // ログに時刻は無いので、1刻みずつ進めて「その技が出た時刻」を集める
  const out = []
  let seen = 0
  while (!st.over && st.t < st.maxSec - 1e-9) {
    runFor(st, STEP_SEC)
    for (const l of st.log.slice(seen)) if (l.side === name && l.skill === skill) out.push(Math.round(st.t * 100) / 100)
    seen = st.log.length
  }
  return out
}

test('【確定】ゲージはふだん1倍・AGIが相手を上回ったぶん速く・4倍で2倍速が上限（試し撃ちのあとユーザー指示）', () => {
  const r = (a, b) => Number(fillRatio(a, b).toFixed(3))
  assert.equal(r(100, 100), 1)
  assert.equal(r(150, 100), 1.167)
  assert.equal(r(200, 100), 1.333)
  assert.equal(r(300, 100), 1.667)
  assert.equal(r(400, 100), 2, '相手の4倍で2倍速')
  assert.equal(r(100000, 100), 2, 'どれだけ離れても2倍まで')
  assert.equal(r(50, 100), 1, '相手よりAGIが低くても遅くはならない')
  assert.equal(r(0, 100), 1)
  assert.equal(r(200, 100), r(200000, 100000), '比で見るのでインフレしても同じ')
})

test('【確定】クールダウンは発動率から（試し撃ちのあとユーザー選択「差を大きく」：100%→3秒・90%→9秒・80%→15秒・70%→21秒）・発動率+%で短くなる', () => {
  assert.equal(cdOfProc(100), 3)
  assert.equal(cdOfProc(90), 9)
  assert.equal(cdOfProc(80), 15)
  assert.equal(cdOfProc(70), 21)
  assert.equal(cdOfProc(80, 5), 12, '発動率+5%で3秒短い')
  assert.equal(cdOfProc(100, 20), 3, '3秒より短くはならない')
  assert.equal(cdOfProc(80, -20), 27, 'サイレンス（発動率−20%）で長くなる')
})

test('バフの長さは強さで決まる（+30%→100秒・+20%→150秒）・デバフは60秒まで', () => {
  assert.equal(buffSecOf(30), 100)
  assert.equal(buffSecOf(20), 150)
  assert.equal(buffSecOf(40), 75)
  assert.equal(buffSecOf(10), 150, '弱くても150秒まで')
  assert.equal(buffSecOf(200), 30, '強くても30秒より短くならない')
  assert.equal(buffSecOf(20, true), 60)
})

test('同じ速さなら4秒に1回ずつ行動する', () => {
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(1) })
  runFor(st, TURN_SEC - 0.1)
  assert.equal(acts(st, '自分', 'normal').length + acts(st, '敵', 'normal').length, 0, 'まだ動かない')
  runFor(st, 0.2)
  assert.equal(acts(st, '自分', 'normal').length, 1)
  assert.equal(acts(st, '敵', 'normal').length, 1)
  runFor(st, 40)
  assert.equal(acts(st, '自分', 'normal').length, 11)
})

test('AGIが4倍以上なら2倍速・遅い相手は1倍のまま＝行動の回数は2倍で頭打ち', () => {
  const st = createAtb(fighter('速い', [], { stats: { agi: 100000 } }), fighter('敵'), { rng: makeRng(2) })
  runFor(st, 80)
  const ratio = acts(st, '速い', 'normal').length / acts(st, '敵', 'normal').length
  assert.ok(ratio > 1.9 && ratio < 2.1, `約2倍（実測 ${ratio.toFixed(2)}）`)
})

test('追加行動率+%の上乗せは2倍速の上限を超えてよい（ユーザー選択）', () => {
  const st = createAtb(fighter('速い', [], { stats: { agi: 100000 } }), fighter('敵'), { rng: makeRng(31), maxSec: 200 })
  st.a.evo.extra = 50
  runFor(st, 119)
  const ratio = acts(st, '速い', 'normal').length / acts(st, '敵', 'normal').length
  assert.ok(ratio > 2.9 && ratio < 3.1, `2倍×1.5＝約3倍（実測 ${ratio.toFixed(2)}）`)
})

test('マクロの技はゲージが満タンの瞬間に出て、クールダウン中は使えるまで待つ', () => {
  const st = createAtb(fighter('自分', [sk('重い技', { proc: 80 })]), fighter('敵'), { rng: makeRng(3), maxSec: 40 })
  startMacro(st, 1, [{ idx: 0 }], true)
  const times = skillTimes(st, '自分', '重い技')
  // 4秒で1回目 → 15秒のクールダウン（19秒まで）→ 次の行動の20秒・36秒（そのあいだは通常攻撃でつなぐ＝使えるまで待つ）
  assert.deepEqual(times, [4, 20, 36])
  assert.ok(acts(st, '自分', 'normal').length >= 4, 'クールダウンのあいだは通常攻撃')
})

test('予約は順番に出る・くり返さないなら最後は通常攻撃・先頭が使えないときは待つ', () => {
  const A = sk('技A', { proc: 80 })   // 15秒
  const B = sk('技B', { proc: 100 })  // 3秒
  const st = createAtb(fighter('自分', [A, B]), fighter('敵'), { rng: makeRng(4), maxSec: 30 })
  reserve(st, 0); reserve(st, 1); reserve(st, 0)
  runFor(st, 4.05)
  assert.equal(acts(st, '自分', 'skill').at(-1)?.skill, '技A')
  runFor(st, 4)
  assert.equal(acts(st, '自分', 'skill').at(-1)?.skill, '技B')
  // 3つ目の技Aは19秒まで使えない → 12秒・16秒は通常攻撃でつなぎ、先頭（技A）は残る
  runFor(st, 8)
  assert.equal(st.a.queue.length, 1)
  assert.equal(acts(st, '自分', 'normal').length, 2)
  runFor(st, 4)
  assert.equal(acts(st, '自分', 'skill').at(-1)?.skill, '技A')
  assert.equal(st.a.queue.length, 0)
  clearQueue(st)
  assert.equal(chosenOf(st.a, st.t).idx, null, '予約が無ければ通常攻撃')
})

test('マクロ：くり返さないマクロは最後まで出たら止まる（あとは通常攻撃）', () => {
  const A = sk('技A')
  const B = sk('技B')
  const st = createAtb(fighter('自分', [A, B]), fighter('敵'), { rng: makeRng(21), maxSec: 30 })
  startMacro(st, 2, [{ idx: 0 }, { idx: 1 }], false)
  runFor(st, 8.05)
  assert.deepEqual(acts(st, '自分', 'skill').map(l => l.skill), ['技A', '技B'])
  assert.equal(st.a.macro, null)
  runFor(st, 8)
  assert.equal(acts(st, '自分', 'skill').length, 2)
  assert.equal(acts(st, '自分', 'normal').length, 2)
})

test('マクロ：手で押した技は次の1回だけ割り込み、そのあとマクロの続きに戻る（ユーザー選択）', () => {
  const A = sk('技A')
  const B = sk('技B')
  const X = sk('割り込み技')
  const st = createAtb(fighter('自分', [A, B, X]), fighter('敵'), { rng: makeRng(22), maxSec: 40 })
  startMacro(st, 1, [{ idx: 0 }, { idx: 1 }], true)
  runFor(st, 4.05)              // 技A
  reserve(st, 2)                // 割り込み
  runFor(st, 4)                 // 割り込み技
  runFor(st, 4)                 // マクロの続き＝技B（頭からではない）
  runFor(st, 4)                 // 技A
  assert.deepEqual(acts(st, '自分', 'skill').map(l => l.skill), ['技A', '割り込み技', '技B', '技A'])
  assert.equal(st.a.queue.length, 0)
})

test('マクロ：防御も入れられる（クールダウン中は使えるまで待つ）・別のマクロを押すと頭から・止められる', () => {
  const A = sk('技A')
  const st = createAtb(fighter('自分', [A]), fighter('敵'), { rng: makeRng(23), maxSec: 80 })
  startMacro(st, 1, [{ guard: true }, { idx: 0 }], true)
  runFor(st, 8.05)
  assert.deepEqual(acts(st, '自分').filter(l => l.type === 'guard' || l.type === 'skill').map(l => l.type), ['guard', 'skill'])
  // 2回目の防御は45秒のクールダウン（49秒まで）＝それまでは通常攻撃でつなぐ
  runFor(st, 36)
  assert.equal(acts(st, '自分', 'guard').length, 1)
  assert.equal(chosenOf(st.a, st.t).waiting, 'guard')
  runFor(st, 8)
  assert.equal(acts(st, '自分', 'guard').length, 2, '49秒のあとの行動（52秒）で2回目')
  startMacro(st, 3, [{ idx: 0 }], false)
  assert.equal(st.a.macro.no, 3)
  assert.equal(st.a.macro.pos, 0)
  stopMacro(st)
  assert.equal(st.a.macro, null)
  assert.equal(chosenOf(st.a, st.t).idx, null, 'マクロも割り込みも無ければ通常攻撃')
  assert.ok(st.inputs.some(i => i.k === 'macro' && i.no === 3), '押した記録に残る')
})

test('MPは回復しない：足りなくなった技は使えないまま（マクロは待ち続け、通常攻撃でつなぐ）', () => {
  const st = createAtb(fighter('自分', [sk('MP技', { mp: 10 })], { stats: { mp: 25 } }), fighter('敵'), { rng: makeRng(5), maxSec: 60 })
  startMacro(st, 1, [{ idx: 0 }], true)
  runFor(st, 60)
  assert.equal(acts(st, '自分', 'skill').length, 2, 'MP25で10の技は2回まで')
  assert.equal(st.a.mp, 5)
  assert.equal(canUse(st.a, 0, st.t), false)
})

test('バフは時間で切れる・同じステは重ならない（強いほうが残り、長さが戻る）', () => {
  const up30 = sk('強化30', { kind:'buff', mult:0, buff:{ self:{ str:30 } } })
  const up20 = sk('強化20', { kind:'buff', mult:0, buff:{ self:{ str:20 } } })
  const st = createAtb(fighter('自分', [up30, up20]), fighter('敵'), { rng: makeRng(6), maxSec: 170 })
  reserve(st, 0)
  runFor(st, 4.05)
  assert.equal(st.a.buffs.str, 30)
  assert.equal(buffChips(st.a, st.t)[0].sec, 100)
  reserve(st, 1)
  runFor(st, 4)
  assert.equal(st.a.buffs.str, 30, '弱いほうをかけても +30% のまま（重ならない）')
  assert.equal(st.a.timed.length, 1)
  assert.equal(buffChips(st.a, st.t)[0].sec, 100, '長さは+30%のぶんで戻る')
  runFor(st, 101)
  assert.equal(st.a.buffs.str || 0, 0, '時間で切れる')
})

test('デバフも時間で切れ、相手の枠に入る', () => {
  const down = sk('弱体', { kind:'buff', mult:0, buff:{ enemy:{ vit:-20 } } })
  const st = createAtb(fighter('自分', [down]), fighter('敵'), { rng: makeRng(7), maxSec: 120 })
  reserve(st, 0)
  runFor(st, 4.05)
  assert.equal(st.b.buffs.vit, -20)
  assert.equal(buffChips(st.b, st.t)[0].sec, 60, 'デバフは60秒まで')
  runFor(st, 61)
  assert.equal(st.b.buffs.vit || 0, 0)
})

test('防御：次の自分の行動まで被ダメージ−50%・30秒は使えない', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [], { stats: { hp: 1000000 } }), { rng: makeRng(8), maxSec: 60 })
  toggleGuard(st)
  runFor(st, 4.05)
  assert.equal(acts(st, '自分', 'guard').length, 1)
  assert.equal(st.a.guardCut, GUARD_CUT)
  assert.ok(Math.abs(st.a.guardReadyAt - (4 + GUARD_CD)) < 0.06)
  toggleGuard(st)   // クールダウン中に押しても、使えるまでは通常攻撃
  runFor(st, 4)
  assert.equal(st.a.guardCut, 0, '次の行動で切れる')
  assert.equal(acts(st, '自分', 'guard').length, 1)
  assert.equal(acts(st, '自分', 'normal').length, 1)
})

test('防御中は受けるダメージが半分', () => {
  // 自分は動かさず（乱数の並びを同じにする）、防御の軽減だけ違う2回を比べる
  const dmgTaken = (cut) => {
    const st = createAtb(fighter('自分'), fighter('敵', [], { stats: { str: 300 } }), { rng: makeRng(9), maxSec: 30 })
    st.a.gauge = -1e9
    st.a.guardCut = cut
    runFor(st, 25)
    return acts(st, '敵', 'normal').reduce((s, l) => s + (l.damage || 0), 0)
  }
  const plain = dmgTaken(0)
  const guarded = dmgTaken(GUARD_CUT)
  assert.ok(plain > 0)
  assert.ok(Math.abs(guarded / plain - 0.5) < 0.02, `半分（${guarded}／${plain}）`)
})

test('ボスの大技は詠唱のバーを出してから撃つ（そのあいだボスのゲージは止まる）', () => {
  const big = sk('大技', { mult: 3, proc: 60 })
  const st = createAtb(fighter('自分'), fighter('ボス', [big]), { rng: makeRng(10), maxSec: 20 })
  runFor(st, 4.05)
  assert.equal(acts(st, 'ボス', 'cast').length, 1)
  assert.ok(st.b.cast)
  assert.equal(acts(st, 'ボス', 'skill').length, 0)
  runFor(st, CAST_SEC - 0.2)
  assert.equal(acts(st, 'ボス', 'skill').length, 0, '詠唱のあいだは撃たない')
  runFor(st, 0.3)
  assert.equal(acts(st, 'ボス', 'skill').length, 1)
  assert.equal(st.b.cast, null)
  assert.ok(st.b.gauge < 5, '撃ったらゲージは空から')
  const lines = buildBattleLog({ log: st.log }, '自分', 'ボス').map(l => l.text).join('\n')
  assert.match(lines, /ボスは「大技」の構えに入った！（4秒後）/)
})

test('敵は枠の順に、使える技を出す（クールダウン中は飛ばして通常攻撃）', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [sk('牙', { proc: 80 }), sk('爪', { proc: 80 })]), { rng: makeRng(11), maxSec: 30 })
  runFor(st, 30)
  const seq = acts(st, '敵').filter(l => l.type === 'skill' || l.type === 'normal').map(l => l.skill || '通常')
  assert.deepEqual(seq.slice(0, 6), ['牙', '爪', '通常', '通常', '牙', '爪'])
})

test('麻痺：ターン数×4秒、ゲージが止まる', () => {
  const zap = sk('電撃', { ail:{ key:'paralyze', chance:100 } })
  const st = createAtb(fighter('自分', [zap], { stats: { agi: 400 } }), fighter('敵'), { rng: makeRng(12), maxSec: 30 })
  reserve(st, 0)
  runFor(st, 2.05)   // 2倍速なので2秒で撃つ
  assert.ok(st.b.ail.paralyze, '麻痺が入った')
  const g = st.b.gauge
  runFor(st, 2)
  assert.equal(st.b.gauge, g, '麻痺のあいだは溜まらない')
  runFor(st, (st.b.parUntil - st.t) + 0.1)
  assert.equal(st.b.ail.paralyze, undefined, '時間で治る')
  runFor(st, 0.5)
  assert.ok(st.b.gauge > g)
})

test('ターンで数える効果は1ターン＝4秒で切れる（期限つきバフ）', () => {
  const rage = sk('狂心もどき', { kind:'buff', mult:0, buff:{ self:{ str:50 } }, buffTurns: 3 })
  const st = createAtb(fighter('自分', [rage]), fighter('敵'), { rng: makeRng(13), maxSec: 40 })
  reserve(st, 0)
  runFor(st, 4.05)
  assert.equal(st.a.timedBuffs.length, 1)
  assert.equal(st.a.timed.length, 0, '期限つきバフは秒の枠ではなくターンの時計で減る')
  runFor(st, 3 * TURN_SEC)
  assert.equal(st.a.timedBuffs.length, 0, '3ターン＝12秒で切れる')
})

test('オート前提の効果の読み替え：追加行動→速さ／発動率+→クールダウン／先制→軽い', () => {
  const st = createAtb(fighter('自分', [sk('技', { proc: 80 })]), fighter('敵'), { rng: makeRng(14) })
  assert.equal(st.a.gauge, 0, '先手の能力が無ければゲージは空から')
  // 追加行動率+50% → 1.5倍速
  const fast = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(15), maxSec: 200 })
  fast.a.evo.extra = 50
  runFor(fast, 119)
  const r = acts(fast, '自分', 'normal').length / acts(fast, '敵', 'normal').length
  assert.ok(r > 1.4 && r < 1.6, `追加行動率+50%で約1.5倍（${r.toFixed(2)}）`)
  // 発動率+10% → クールダウン 15→9秒
  st.a.pa.procBonus = 10
  reserve(st, 0)
  runFor(st, 4.05)
  assert.ok(Math.abs(cdLeft(st.a, 0, st.t) - 9) < 0.1)
  // 先制（優先度1）→ 要るゲージ80
  assert.equal(needFor(st.a, sk('先制技', { priority: 1 })), 80)
  assert.equal(needFor(st.a, null), GAUGE_FULL)
})

test('クイック（もう一度行動）はゲージが満タンになる', () => {
  const quick = sk('クイック', { kind:'buff', mult:0, extraTurn:{ max: 1 } })
  const st = createAtb(fighter('自分', [quick]), fighter('敵'), { rng: makeRng(16), maxSec: 10 })
  reserve(st, 0)
  runFor(st, 4.05)
  assert.equal(acts(st, '自分', 'quick').length, 1)
  runFor(st, 0.1)
  assert.equal(acts(st, '自分', 'normal').length, 1, 'すぐ次の行動が出る')
})

test('同じ乱数と同じ入力なら同じ結果（あとでサーバーで回し直せる）', () => {
  const play = () => {
    const st = createAtb(fighter('自分', [sk('技', { proc: 85, mult: 1.6, sureHit: false })], { stats: { hp: 30000 } }),
      fighter('敵', [sk('牙', { proc: 80, mult: 1.5 })], { stats: { hp: 30000, str: 140 } }), { rng: makeRng(17), maxSec: 120 })
    startMacro(st, 1, [{ idx: 0 }], true)
    // 実時間はばらばら（裏のタブ・遅い端末）でも、刻みが固定なので結果は同じ
    const dts = [0.016, 0.033, 0.2, 0.9, 0.05, 0.001]
    for (let i = 0; !st.over && i < 100000; i++) advance(st, dts[i % dts.length])
    return { winner: st.winner, steps: st.steps, hpA: st.a.hp, hpB: st.b.hp, n: st.log.length }
  }
  assert.deepEqual(play(), play())
  assert.ok(MAX_DT <= 0.25)
})

test('オート戦闘はターンの処理を切り出しても前と同じ流れ（引き分け・決着のHPの行）', () => {
  const r = runBattle(fighter('自分', [sk('技', { proc: 90, mult: 1.5 })], { stats: { hp: 3000 } }),
    fighter('敵', [sk('牙', { proc: 85, mult: 1.4 })], { stats: { hp: 3000 } }), { rng: makeRng(18) })
  assert.ok(['a', 'b', 'draw'].includes(r.winner))
  assert.equal(r.log.at(-1).type, 'hp')
  assert.ok(r.log.filter(l => l.type === 'hp').length >= r.turns)
})
