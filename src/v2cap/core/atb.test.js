// v2cap の ATB戦闘のテスト（node --test）
// ★オート戦闘（runBattle）がターンの処理の切り出しで変わっていないことも一緒に見る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAtb, runFor, advance, reserve, unreserveAt, clearQueue, QUEUE_MAX, startMacro, stopMacro, toggleGuard, canUse, cdLeft, cdRatio, guardCdRatio, chosenOf, needFor,
  canDrink, drinkItem, itemCdLeft, itemCdRatio, itemLeftOf, itemsUsedOf, replayInputs, seedRng,
  fillRatio, cdOfProc, buffSecOf, buffChips,
  STEP_SEC, TURN_SEC, GAUGE_FULL, GUARD_CUT, GUARD_CD, CAST_SEC, MAX_DT,
} from './atb.js'
import { inflict } from './ailments.js'
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

test('【確定】同じ速さなら5秒に1回ずつ行動する（試し撃ちのあとユーザー選択「5秒に1回」・前は4秒）', () => {
  assert.equal(TURN_SEC, 5)
  const st = createAtb(fighter('自分'), fighter('敵'), { rng: makeRng(1) })
  runFor(st, TURN_SEC - 0.1)
  assert.equal(acts(st, '自分', 'normal').length + acts(st, '敵', 'normal').length, 0, 'まだ動かない')
  runFor(st, 0.2)
  assert.equal(acts(st, '自分', 'normal').length, 1)
  assert.equal(acts(st, '敵', 'normal').length, 1)
  runFor(st, 10 * TURN_SEC)
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
  // 5秒で1回目 → 15秒のクールダウン（20秒まで）→ 20秒・35秒（そのあいだは通常攻撃でつなぐ＝使えるまで待つ）
  assert.deepEqual(times, [5, 20, 35])
  assert.ok(acts(st, '自分', 'normal').length >= 4, 'クールダウンのあいだは通常攻撃')
})

test('予約は順番に出る・くり返さないなら最後は通常攻撃・先頭が使えないときは待つ', () => {
  const A = sk('技A', { proc: 80 })   // 15秒
  const B = sk('技B', { proc: 100 })  // 3秒
  const st = createAtb(fighter('自分', [A, B]), fighter('敵'), { rng: makeRng(4), maxSec: 30 })
  reserve(st, 0); reserve(st, 1); reserve(st, 0)
  runFor(st, 5.05)
  assert.equal(acts(st, '自分', 'skill').at(-1)?.skill, '技A')
  runFor(st, 5)
  assert.equal(acts(st, '自分', 'skill').at(-1)?.skill, '技B')
  // 3つ目の技Aは20秒まで使えない → 15秒は通常攻撃でつなぎ、先頭（技A）は残る
  runFor(st, 5)
  assert.equal(st.a.queue.length, 1)
  assert.equal(acts(st, '自分', 'normal').length, 1)
  runFor(st, 5)
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
  runFor(st, 10.05)
  assert.deepEqual(acts(st, '自分', 'skill').map(l => l.skill), ['技A', '技B'])
  assert.equal(st.a.macro, null)
  runFor(st, 10)
  assert.equal(acts(st, '自分', 'skill').length, 2)
  assert.equal(acts(st, '自分', 'normal').length, 2)
})

test('予約は8個まで（ユーザー「予約の上限は8個まで」）：9個目は入らず、押した記録にも残らない。外すと、また入る', () => {
  const st = createAtb(fighter('自分', [sk('技A')]), fighter('相手'), { rng: () => 0.5 })
  assert.equal(QUEUE_MAX, 8)
  for (let i = 0; i < QUEUE_MAX; i++) reserve(st, 0)
  assert.equal(st.a.queue.length, 8)
  assert.equal(st.inputs.length, 8)
  reserve(st, 0)
  assert.equal(st.a.queue.length, 8, '9個目は入らない')
  assert.equal(st.inputs.length, 8, 'サーバーの回し直しにも9個目は無い')
  unreserveAt(st, 3)
  assert.equal(st.a.queue.length, 7)
  reserve(st, null)
  assert.equal(st.a.queue.length, 8)
  assert.equal(st.a.queue[7].idx, null, '後ろに足す')
  clearQueue(st)
  assert.equal(st.a.queue.length, 0)
})

test('マクロ：手で押した技は次の1回だけ割り込み、そのあとマクロの続きに戻る（ユーザー選択）', () => {
  const A = sk('技A')
  const B = sk('技B')
  const X = sk('割り込み技')
  const st = createAtb(fighter('自分', [A, B, X]), fighter('敵'), { rng: makeRng(22), maxSec: 40 })
  startMacro(st, 1, [{ idx: 0 }, { idx: 1 }], true)
  runFor(st, 5.05)              // 技A
  reserve(st, 2)                // 割り込み
  runFor(st, 5)                 // 割り込み技
  runFor(st, 5)                 // マクロの続き＝技B（頭からではない）
  runFor(st, 5)                 // 技A
  assert.deepEqual(acts(st, '自分', 'skill').map(l => l.skill), ['技A', '割り込み技', '技B', '技A'])
  assert.equal(st.a.queue.length, 0)
})

test('出血は20秒付け直しがなければ1スタック減る（ユーザー「ATBバトルの場合は20秒に1減るようにして」）・付け直すと数え直し・行動で刻んでも減らない', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [], { stats: { hp: 1000000 } }), { rng: makeRng(31), maxSec: 120 })
  inflict(st.b.ail, 'bleed', { stacks: 3 })
  runFor(st, 19.5)
  assert.ok(acts(st, '敵', 'ailTick').length >= 2, '行動で刻んでいる')
  assert.equal(st.b.ail.bleed.stacks, 3, '20秒までは減らない')
  runFor(st, 1)
  assert.equal(st.b.ail.bleed.stacks, 2, '20秒で1つ減る')
  // 付け直すと数え直し
  runFor(st, 10)
  inflict(st.b.ail, 'bleed')
  assert.equal(st.b.ail.bleed.stacks, 3)
  runFor(st, 19.5)
  assert.equal(st.b.ail.bleed.stacks, 3, '付け直してから20秒までは減らない')
  runFor(st, 1)
  assert.equal(st.b.ail.bleed.stacks, 2)
  // 0で消える
  runFor(st, 41)
  assert.equal(st.b.ail.bleed, undefined)
})

test('出血の減り方：防具のセット能力（受けた状態異常を縮める）は1ターンぶん早く減る', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [], { stats: { hp: 1000000 } }), { rng: makeRng(32), maxSec: 60 })
  st.b.setFx = { ...(st.b.setFx || {}), ailTurnsCut: 1 }
  inflict(st.b.ail, 'bleed', { stacks: 2 })
  runFor(st, 20 - TURN_SEC + 0.5)
  assert.equal(st.b.ail.bleed.stacks, 1)
})

test('マクロ：防御も入れられる（クールダウン中は使えるまで待つ）・別のマクロを押すと頭から・止められる', () => {
  const A = sk('技A')
  const st = createAtb(fighter('自分', [A]), fighter('敵'), { rng: makeRng(23), maxSec: 80 })
  startMacro(st, 1, [{ guard: true }, { idx: 0 }], true)
  runFor(st, 10.05)
  assert.deepEqual(acts(st, '自分').filter(l => l.type === 'guard' || l.type === 'skill').map(l => l.type), ['guard', 'skill'])
  // 2回目の防御は45秒のクールダウン＝それまでは通常攻撃でつなぐ（防御はゲージを待たないので、1回目は始まってすぐ）
  runFor(st, 30)
  assert.equal(acts(st, '自分', 'guard').length, 1)
  assert.equal(chosenOf(st.a, st.t).waiting, 'guard')
  runFor(st, 6)
  assert.equal(acts(st, '自分', 'guard').length, 2, '45秒たったらゲージを待たずに2回目')
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
  runFor(st, 5.05)
  assert.equal(st.a.buffs.str, 30)
  assert.equal(buffChips(st.a, st.t)[0].sec, 100)
  reserve(st, 1)
  runFor(st, 5)
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
  runFor(st, 5.05)
  assert.equal(st.b.buffs.vit, -20)
  assert.equal(buffChips(st.b, st.t)[0].sec, 60, 'デバフは60秒まで')
  runFor(st, 61)
  assert.equal(st.b.buffs.vit || 0, 0)
})

test('防御：押したらゲージを待たずに出る（ユーザー「ゲージ無視して防御に移行していい」）・次の自分の行動まで被ダメージ−50%・45秒は使えない', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [], { stats: { hp: 1000000 } }), { rng: makeRng(8), maxSec: 60 })
  runFor(st, 2)
  assert.ok(st.a.gauge > 30 && st.a.gauge < 100, 'ゲージは溜まりかけ')
  toggleGuard(st)
  runFor(st, 0.05)
  assert.equal(acts(st, '自分', 'guard').length, 1, '次の刻みで出る')
  assert.equal(st.a.guardCut, GUARD_CUT)
  assert.equal(st.a.gauge, 0, 'ゲージは空になる＝1回の行動のぶん')
  assert.ok(Math.abs(st.a.guardReadyAt - (2.05 + GUARD_CD)) < 0.06)
  toggleGuard(st)   // クールダウン中に押しても何も起きない（予約にならない）
  assert.equal(st.a.guardNext, false)
  runFor(st, 5.05)
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
  runFor(st, 5.05)
  assert.equal(acts(st, 'ボス', 'cast').length, 1)
  assert.ok(st.b.cast)
  assert.equal(acts(st, 'ボス', 'skill').length, 0)
  runFor(st, CAST_SEC - 0.2)
  assert.equal(acts(st, 'ボス', 'skill').length, 0, '詠唱のあいだは撃たない')
  runFor(st, 0.3)
  assert.equal(acts(st, 'ボス', 'skill').length, 1)
  assert.equal(st.b.cast, null)
  assert.ok(st.b.gauge < 5, '撃ったらゲージは空から')
  // 【確定】2026-10-30 ユーザー「○○の構えとか表示させなくていい」：記録の行にも出さない（技の名前は名前の帯・構えはゲージの色で分かる）
  const lines = buildBattleLog({ log: st.log }, '自分', 'ボス').map(l => l.text).join('\n')
  assert.doesNotMatch(lines, /構え/)
})

test('敵は枠の順に、使える技を出す（クールダウン中は飛ばして通常攻撃）', () => {
  const st = createAtb(fighter('自分'), fighter('敵', [sk('牙', { proc: 80 }), sk('爪', { proc: 80 })]), { rng: makeRng(11), maxSec: 40 })
  runFor(st, 40)
  const seq = acts(st, '敵').filter(l => l.type === 'skill' || l.type === 'normal').map(l => l.skill || '通常')
  // 5秒 牙（20秒まで）・10秒 爪（25秒まで）・15秒 通常・20秒 牙・25秒 爪・30秒 通常
  assert.deepEqual(seq.slice(0, 6), ['牙', '爪', '通常', '牙', '爪', '通常'])
})

test('麻痺：ターン数×1ターンの秒、ゲージが止まる', () => {
  const zap = sk('電撃', { ail:{ key:'paralyze', chance:100 } })
  const st = createAtb(fighter('自分', [zap], { stats: { agi: 400 } }), fighter('敵'), { rng: makeRng(12), maxSec: 30 })
  reserve(st, 0)
  runFor(st, TURN_SEC / 2 + 0.05)   // 2倍速なので半分の時間で撃つ
  assert.ok(st.b.ail.paralyze, '麻痺が入った')
  const g = st.b.gauge
  runFor(st, 2)
  assert.equal(st.b.gauge, g, '麻痺のあいだは溜まらない')
  runFor(st, (st.b.parUntil - st.t) + 0.1)
  assert.equal(st.b.ail.paralyze, undefined, '時間で治る')
  runFor(st, 0.5)
  assert.ok(st.b.gauge > g)
})

test('ターンで数える効果は1ターン＝TURN_SEC 秒で切れる（期限つきバフ）', () => {
  const rage = sk('狂心もどき', { kind:'buff', mult:0, buff:{ self:{ str:50 } }, buffTurns: 3 })
  const st = createAtb(fighter('自分', [rage]), fighter('敵'), { rng: makeRng(13), maxSec: 40 })
  reserve(st, 0)
  runFor(st, 5.05)
  assert.equal(st.a.timedBuffs.length, 1)
  assert.equal(st.a.timed.length, 0, '期限つきバフは秒の枠ではなくターンの時計で減る')
  runFor(st, 3 * TURN_SEC)
  assert.equal(st.a.timedBuffs.length, 0, '3ターン＝15秒で切れる')
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
  runFor(st, 5.05)
  assert.ok(Math.abs(cdLeft(st.a, 0, st.t) - 9) < 0.1)
  // 先制（優先度1）→ 要るゲージ80
  assert.equal(needFor(st.a, sk('先制技', { priority: 1 })), 80)
  assert.equal(needFor(st.a, null), GAUGE_FULL)
})

test('クイック（もう一度行動）はゲージが満タンになる', () => {
  const quick = sk('クイック', { kind:'buff', mult:0, extraTurn:{ max: 1 } })
  const st = createAtb(fighter('自分', [quick]), fighter('敵'), { rng: makeRng(16), maxSec: 10 })
  reserve(st, 0)
  runFor(st, 5.05)
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

test('【確定】クールダウンの残りの割合（画面のグレー：使った直後1→時間で0へ＝下から色が戻る）・防御も同じ', () => {
  const st = createAtb(fighter('自分', [sk('重い技', { proc: 80 })]), fighter('敵'), { rng: makeRng(41), maxSec: 80 })
  assert.equal(cdRatio(st.a, 0, st.t), 0, 'まだ使っていない')
  startMacro(st, 1, [{ idx: 0 }])
  runFor(st, 5.05)
  assert.ok(cdRatio(st.a, 0, st.t) > 0.98, '使った直後はほぼ1')
  runFor(st, 7.5)
  assert.ok(Math.abs(cdRatio(st.a, 0, st.t) - 0.5) < 0.02, '15秒のうち7.5秒で半分')
  stopMacro(st)   // もう一度使わないように止めてから待つ
  runFor(st, 8)
  assert.equal(cdRatio(st.a, 0, st.t), 0)
  toggleGuard(st)
  runFor(st, 0.05)
  assert.ok(guardCdRatio(st.a, st.t) > 0.9)
})

test('【確定】マクロは選んだらループ（ユーザー指示「マクロは選択したらループするようにして」）＝startMacro の既定は loop', () => {
  const st = createAtb(fighter('自分', [sk('技A')]), fighter('敵'), { rng: makeRng(42), maxSec: 40 })
  startMacro(st, 1, [{ idx: 0 }])
  assert.equal(st.a.macro.loop, true)
  runFor(st, 30)
  assert.ok(st.a.macro, '最後まで出ても止まらない')
})

test('【確定】ボスの大技の構えは1ターンと同じ長さ（ユーザー指示「同じ速さなら1回は備えられるように」）＝動いた直後に構えが来ても防御が間に合う', () => {
  assert.equal(CAST_SEC, TURN_SEC)
  assert.equal(CAST_SEC, 5)
  // 自分が動いた瞬間にボスが構える：ボスを少しだけ遅らせて、自分の行動のすぐあとに構えが来るようにする
  const big = sk('大技', { mult: 3, proc: 60 })
  const st = createAtb(fighter('自分'), fighter('ボス', [big], { stats: { agi: 99 } }), { rng: makeRng(51), maxSec: 30 })
  runFor(st, TURN_SEC + 0.2)
  assert.equal(acts(st, '自分', 'normal').length, 1, '自分は動いた直後')
  assert.ok(st.b.cast, 'ボスが構えた')
  toggleGuard(st)   // 構えを見てから防御を押す
  runFor(st, CAST_SEC)
  const order = st.log.filter(l => (l.side === '自分' && l.type === 'guard') || (l.side === 'ボス' && l.type === 'skill')).map(l => l.type)
  assert.deepEqual(order, ['guard', 'skill'], '大技より先に防御が出る')
})

// ===== 薬（core/atbItems.js）=====
// 【確定】2026-11-01 ユーザー「挑戦とかで使用できるアイテムもここで販売してほしい」＋選択「最大の30%」「すぐ飲む・ゲージは空」「3種類で共通 30秒」
const drinker = (items = { hp: 3, mp: 3, cure: 3 }, seed = 1) => createAtb(fighter('我'), fighter('敵'), { rng: makeRng(seed), items })

test('【確定】HPポーション：最大HPの30%回復・ゲージは空になる・数が減る・押した記録が残る', () => {
  const st = drinker()
  st.a.hp = 100000
  st.a.gauge = 80
  runFor(st, STEP_SEC * 2)
  const hp = st.a.hp, gauge = st.a.gauge
  assert.ok(gauge > 80)
  drinkItem(st, 'hp')
  assert.equal(st.a.hp, hp + 300000, '押した瞬間に効く')
  assert.equal(st.a.gauge, 0, '防御と同じく1回の行動のぶん')
  assert.equal(itemLeftOf(st.a, 'hp'), 2)
  assert.deepEqual(itemsUsedOf(st), { hp: 1 })
  assert.deepEqual(st.inputs.at(-1), { step: st.steps, k: 'item', item: 'hp' })
  const l = st.log.at(-1)
  assert.equal(l.type, 'heal')
  assert.equal(l.skill, 'HPポーション')
  assert.equal(l.heal, 300000)
  // 満タンを超えない
  const st2 = drinker()
  st2.a.hp = st2.a.base.hp - 5
  drinkItem(st2, 'hp')
  assert.equal(st2.a.hp, st2.a.base.hp)
  assert.equal(st2.log.at(-1).heal, 5)
})

test('【確定】MPポーション：最大MPの30%回復（MPはふだん回復しない）', () => {
  const st = drinker()
  st.a.mp = 100
  drinkItem(st, 'mp')
  assert.equal(st.a.mp, 400)
  assert.equal(st.log.at(-1).type, 'mpGain')
  assert.equal(st.log.at(-1).mp, 300)
  const st2 = drinker()
  st2.a.mp = st2.a.base.mp - 7
  drinkItem(st2, 'mp')
  assert.equal(st2.a.mp, st2.a.base.mp, '満タンを超えない')
})

test('【確定】清めの雫：状態異常を全部治す・麻痺のあいだでも飲める・治ると動き出す', () => {
  const st = drinker()
  for (const k of ['poison', 'burn', 'seal', 'fear', 'blind', 'curse', 'weaken', 'silence', 'slow', 'healCut']) inflict(st.a.ail, k, { pct: 30 })
  inflict(st.a.ail, 'bleed', { stacks: 3 })
  inflict(st.a.ail, 'paralyze')
  st.a.parObj = st.a.ail.paralyze   // 技で入ったときは afterEngine が付ける期限
  st.a.parUntil = 5
  runFor(st, STEP_SEC)
  const before = st.a.acted
  const gauge = st.a.gauge
  runFor(st, 1)
  assert.equal(st.a.gauge, gauge, '麻痺のあいだはゲージが止まる')
  assert.equal(st.a.acted, before)
  assert.ok(canDrink(st.a, 'cure', st.t), '麻痺のあいだでも飲める')
  drinkItem(st, 'cure')
  assert.deepEqual(Object.keys(st.a.ail), [], '全部治った')
  const names = st.log.filter(l => l.type === 'cure').map(l => l.ail)
  assert.equal(names.length, 12)
  runFor(st, TURN_SEC + STEP_SEC)
  assert.ok(st.a.acted > before, '治ったら動き出す')
})

test('【確定】3種類で共通の待ち時間30秒：どれかを飲むと全部飲めない・押しても減らない・記録にも残らない', () => {
  const st = drinker()
  st.a.hp = 100000
  st.a.mp = 100
  inflict(st.a.ail, 'blind')
  drinkItem(st, 'hp')
  assert.equal(itemCdLeft(st.a, st.t), 30)
  assert.equal(itemCdRatio(st.a, st.t), 1)
  const inputs = st.inputs.length, hp = st.a.hp
  drinkItem(st, 'hp')
  drinkItem(st, 'mp')
  drinkItem(st, 'cure')
  assert.equal(st.a.hp, hp)
  assert.equal(st.a.mp, 100)
  assert.equal(st.inputs.length, inputs, '飲めなかった押し方は残らない')
  assert.deepEqual(itemsUsedOf(st), { hp: 1 })
  runFor(st, 15)
  assert.ok(Math.abs(itemCdRatio(st.a, st.t) - 0.5) < 1e-6)
  runFor(st, 14.9)
  st.a.mp = 100
  assert.equal(canDrink(st.a, 'mp', st.t), false, '30秒まではまだ')
  runFor(st, 0.15)
  assert.equal(canDrink(st.a, 'mp', st.t), true, '30秒で飲める')
})

test('飲めないとき：持っていない・満タン・状態異常が無い・倒れた・終わった・薬を持たない戦闘・知らない薬', () => {
  const st = drinker({ hp: 0, mp: 1, cure: 1 })
  st.a.hp = 100
  assert.equal(canDrink(st.a, 'hp', st.t), false, '持っていない')
  assert.equal(canDrink(st.a, 'mp', st.t), false, 'MPが満タン')
  assert.equal(canDrink(st.a, 'cure', st.t), false, '状態異常が無い')
  const inputs = st.inputs.length
  for (const k of ['hp', 'mp', 'cure', '__proto__', 'toString', 'elixir']) drinkItem(st, k)
  assert.equal(st.inputs.length, inputs)
  assert.equal(itemsUsedOf(st), null)
  const none = createAtb(fighter('我'), fighter('敵'), { rng: makeRng(1) })
  assert.equal(none.a.items, null, '薬のボタンを出さない')
  none.a.hp = 100
  drinkItem(none, 'hp')
  assert.equal(none.a.hp, 100)
  // 狂鬼化のあいだはHPが戻らない＝もったいないので飲めない
  const b = drinker()
  b.a.hp = 1
  b.a.berserk = { turns: 2 }
  assert.equal(canDrink(b.a, 'hp', b.t), false)
  b.a.berserk = null
  assert.equal(canDrink(b.a, 'hp', b.t), true)
  // 決着のあと
  const o = drinker()
  o.a.hp = 100
  o.over = true
  drinkItem(o, 'hp')
  assert.equal(o.a.hp, 100)
})

test('薬は行動を通らない：防御は切れない・出血は刻まない。回復阻害は技の回復と同じだけ効く', () => {
  const st = drinker()
  st.a.hp = 100000
  st.a.guardCut = 50
  inflict(st.a.ail, 'bleed', { stacks: 3 })
  const n = st.log.length
  drinkItem(st, 'hp')
  assert.equal(st.a.guardCut, 50)
  assert.deepEqual(st.log.slice(n).map(l => l.type), ['heal'], '出血の刻みが出ない')
  const cut = drinker()
  cut.a.hp = 100000
  inflict(cut.a.ail, 'healCut', { pct: 50 })
  drinkItem(cut, 'hp')
  assert.equal(cut.log.at(-1).heal, 150000)
})

test('★飲んだ戦闘も、同じ種と押した記録で回し直すと同じになる', () => {
  const start = () => {
    const st = createAtb(fighter('我', [sk('斬')]), fighter('敵', [sk('牙', { mult: 2 })], { stats: { str: 400 } }), { rng: seedRng(7), items: { hp: 2, mp: 2, cure: 2 } })
    st.a.hp = 500000
    st.a.mp = 500
    return st
  }
  const st = start()
  for (let i = 0; i < 60 && !st.over; i++) {
    runFor(st, 1)
    if (i % 7 === 3) drinkItem(st, 'hp')
    if (i % 7 === 5) reserve(st, 0)
    if (i % 11 === 9) drinkItem(st, 'mp')
  }
  assert.ok(st.inputs.some(e => e.k === 'item'))
  const again = replayInputs(start(), JSON.parse(JSON.stringify(st.inputs)), st.steps)
  assert.deepEqual([again.a.hp, again.a.mp, again.b.hp, again.a.items, again.a.itemsUsed], [st.a.hp, st.a.mp, st.b.hp, st.a.items, st.a.itemsUsed])
  assert.deepEqual(buildBattleLog({ log: again.log }, '我', '敵'), buildBattleLog({ log: st.log }, '我', '敵'))
})
