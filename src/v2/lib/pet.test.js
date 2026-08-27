// バトルフロンティアⅡ ペット（育成とミニゲーム）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAT_KEYS } from './stats.js'
import {
  PET_STAT_KEYS, SPILL, CONTENTS, CONTENT_BY_KEY, spread, emptyPetGains,
  statValueOf, statsOf, petLvOf, petLvNeed, PET_LV_STEP,
  MEMORY_PAIRS, MEMORY_MAX_PT, memoryPt, memoryDeck,
  STACK_MAX_PT, STACK_LIMIT, stackDrift, stackGravity, stackStart, stackStep, stackPt, stackCleared,
  COIN_HIT_PT, COIN_CHAIN_PT, COIN_SIDES, coinFlip, coinPt,
  WALK_MAX_STEPS, walkPt,
  KANJI_GRADES, KANJI_BASE_PT, kanjiPt,
  emptyPetState, playsLeft, beginPlay, scorePlay, applyPlay, totalPtOf,
} from './pet.js'

// ===== ステの並び =====

test('ペットの6ステは本編のSTAT_KEYSからHP・MPを除いたものと一致する', () => {
  assert.deepEqual(PET_STAT_KEYS, STAT_KEYS.filter(k => k !== 'hp' && k !== 'mp'))
})

// ===== ptの配り方 =====

test('ptは主ステに100%、他の5ステに10%ずつ入る', () => {
  assert.equal(SPILL, 0.1)
  const { gains } = spread({ str: 100 })
  assert.equal(gains.str, 100)
  for (const k of PET_STAT_KEYS) if (k !== 'str') assert.equal(gains[k], 10, `${k}にも10%こぼれる`)
})

// ★実際に踏んだ穴。1プレイごとに切り捨てていたので、
//   コイントス（1回8pt）は 8×10%＝0.8 が毎回0になり、他ステが永久に0のままだった
//   （10回投げてLUK+40・他は全部0）。端数は次のプレイへ持ち越す
test('1pt未満の端数は捨てずに次へ持ち越す', () => {
  let carry = null
  let luk = 0
  let str = 0
  for (let i = 0; i < 10; i++) {                 // コイントスを10回当てた想定
    const r = spread({ luk: 8 }, carry)
    carry = r.carry
    luk += r.gains.luk
    str += r.gains.str
  }
  assert.equal(luk, 80)
  assert.equal(str, 8, `10回ぶんの端数(0.8×10)が入っていない（${str}）`)
})

test('持ち越しを渡さないと端数はその場で消える', () => {
  const { gains, carry } = spread({ luk: 8 })
  assert.equal(gains.str, 0, '8ptの10%は0.8＝まだ1ptに満たない')
  assert.equal(carry.str, 0.8, '端数が carry に残っていない')
})

test('神経衰弱のように主ステが2つあると、互いにもこぼれる', () => {
  const { gains } = spread({ dex: 16, agi: 10 })
  assert.equal(gains.dex, 16 + 1, 'AGIぶん10ptの10%＝1が乗る')
  assert.equal(gains.agi, 10 + 1, 'DEXぶん16ptの10%＝1が乗る')
  assert.equal(gains.vit, 2, '他ステは両方（1.6+1.0=2.6）からこぼれを受ける')
})

test('存在しないステや負のptは無視する', () => {
  assert.deepEqual(spread({ hp: 100 }).gains, emptyPetGains(), 'HPはペットのステではない')
  assert.deepEqual(spread({ str: -50 }).gains, emptyPetGains())
})

// ===== 累計pt → ステ値 =====

test('累計ptからステ値は逓減して決まる', () => {
  assert.equal(statValueOf(0), 0)
  assert.equal(statValueOf(80), 12, '1日満額')
  assert.equal(statValueOf(2400), 69, '1か月')
  assert.equal(statValueOf(29200), 241, '1年')
})

test('ステ値は抽選しない＝同じ累計ptなら必ず同じ値', () => {
  const cum = { str: 500, dex: 500, agi: 0, int_stat: 0, vit: 0, luk: 0 }
  assert.deepEqual(statsOf(cum), statsOf(cum))
  assert.equal(statsOf(cum).str, statsOf(cum).dex, '同じ累計なら同じ値')
  assert.equal(statsOf(cum).agi, 0, '稼いでいないステは0')
})

test('累計が2倍になってもステ値は2倍にならない（逓減している）', () => {
  assert.ok(statValueOf(2000) < statValueOf(1000) * 2)
})

// ===== ペットのLV =====

test('ペットのLVは全ptの合計から決まる', () => {
  assert.equal(petLvOf(0), 1)
  assert.equal(petLvOf(PET_LV_STEP - 1), 1)
  assert.equal(petLvOf(PET_LV_STEP), 2, '100ptでLV2')
  assert.equal(petLvOf(petLvNeed(5)), 5)
  assert.equal(petLvOf(petLvNeed(5) - 1), 4)
})

test('LVが上がるほど1LVぶんの必要ptが増える', () => {
  const need = [1, 2, 3, 4, 5, 6].map(petLvNeed)
  assert.equal(need[0], 0, 'LV1は0ptから')
  const step = need.slice(1).map((v, i) => v - need[i])
  for (let i = 1; i < step.length; i++) {
    assert.ok(step[i] > step[i - 1], `LV${i + 2}への必要ptが増えていない`)
  }
})

// ===== 育ち具合の持ち方 =====

test('1プレイぶんを足すと累計ptと回数が増える', () => {
  const r = applyPlay(emptyPetState(), 'coin', { luk: 8 }, '2026-08-27')
  assert.equal(r.ok, true)
  assert.equal(r.gains.luk, 8)
  assert.equal(r.state.cum.luk, 8)
  assert.equal(r.state.plays.coin, 1)
})

test('回数を使い切ると足せない', () => {
  let s = emptyPetState()
  for (let i = 0; i < CONTENT_BY_KEY.stack.plays; i++) {
    s = applyPlay(s, 'stack', { vit: 10 }, '2026-08-27').state
  }
  assert.equal(playsLeft(s, 'stack', '2026-08-27'), 0)
  const over = applyPlay(s, 'stack', { vit: 10 }, '2026-08-27')
  assert.equal(over.ok, false)
  assert.equal(over.state.cum.vit, s.cum.vit, '使い切ったあとは1ptも増えない')
})

test('日付が変われば回数は戻るが、累計ptは持ち越す', () => {
  let s = emptyPetState()
  for (let i = 0; i < CONTENT_BY_KEY.stack.plays; i++) {
    s = applyPlay(s, 'stack', { vit: 10 }, '2026-08-27').state
  }
  assert.equal(playsLeft(s, 'stack', '2026-08-28'), CONTENT_BY_KEY.stack.plays)
  const next = applyPlay(s, 'stack', { vit: 10 }, '2026-08-28')
  assert.equal(next.ok, true)
  assert.ok(next.state.cum.vit > s.cum.vit, '累計が引き継がれていない')
  assert.equal(next.state.plays.stack, 1, '回数は数え直し')
})

test('回数の上限がないコンテンツは何回でも足せる', () => {
  assert.equal(playsLeft(emptyPetState(), 'walk', '2026-08-27'), null)
  assert.equal(applyPlay(emptyPetState(), 'walk', { str: 10 }, '2026-08-27').ok, true)
})

// ★実際に踏んだ穴。終わったときに数えていたので、出だしが悪ければ抜けて引き直せた
//   （神経衰弱を1手めくって戻っても「あと5回」のままだった）＝回数で区切った意味が消える
test('回数は遊び始めた時点で減る。途中でやめても戻らない', () => {
  const begun = beginPlay(emptyPetState(), 'memory', '2026-08-27')
  assert.equal(begun.ok, true)
  assert.equal(playsLeft(begun.state, 'memory', '2026-08-27'),
    CONTENT_BY_KEY.memory.plays - 1, '始めた時点で減っていない')
  // ここで投げ出す＝ptは入らないが、回数は戻らない
  assert.equal(playsLeft(begun.state, 'memory', '2026-08-27'), CONTENT_BY_KEY.memory.plays - 1)
})

test('点を入れるほうは回数を減らさない', () => {
  const begun = beginPlay(emptyPetState(), 'memory', '2026-08-27')
  const scored = scorePlay(begun.state, { dex: 16, agi: 16 })
  assert.equal(playsLeft(scored.state, 'memory', '2026-08-27'),
    CONTENT_BY_KEY.memory.plays - 1, '始めたぶんと二重に減っている')
  assert.equal(scored.state.cum.dex, 16 + 1)
})

test('使い切っていたら始められない', () => {
  let s = emptyPetState()
  for (let i = 0; i < CONTENT_BY_KEY.memory.plays; i++) {
    s = beginPlay(s, 'memory', '2026-08-27').state
  }
  assert.equal(beginPlay(s, 'memory', '2026-08-27').ok, false)
})

test('累計ptの合計からペットのLVが決まる', () => {
  const s = applyPlay(emptyPetState(), 'coin', { luk: 100 }, '2026-08-27').state
  assert.equal(totalPtOf(s), 100 + 10 * 5, 'こぼれたぶんも合計に入る')
  assert.equal(petLvOf(totalPtOf(emptyPetState())), 1)
})

// ===== コンテンツの定義 =====

test('6ステすべてに、主ステとして受け持つコンテンツがある', () => {
  const covered = new Set(CONTENTS.flatMap(c => c.main))
  for (const k of PET_STAT_KEYS) assert.ok(covered.has(k), `${k}を伸ばすコンテンツがない`)
})

test('神経衰弱だけが1プレイで2ステに入る', () => {
  const two = CONTENTS.filter(c => c.main.length > 1)
  assert.equal(two.length, 1)
  assert.equal(two[0].key, 'memory')
  assert.deepEqual(two[0].main, ['dex', 'agi'])
})

test('1日ぶんを使い切るとどのステもおよそ80ptになる', () => {
  assert.equal(CONTENT_BY_KEY.stack.plays * STACK_MAX_PT, 80)
  assert.equal(CONTENT_BY_KEY.memory.plays * MEMORY_MAX_PT, 80)
  assert.equal(CONTENT_BY_KEY.coin.plays * COIN_HIT_PT, 80, 'コイントスは全部当てて80')
  assert.equal(walkPt(WALK_MAX_STEPS), 80)
})

// ===== 神経衰弱 =====

test('神経衰弱は手数でDEX・時間でAGIが決まる', () => {
  const best = memoryPt({ moves: MEMORY_PAIRS, seconds: 25 })
  assert.equal(best.dex, MEMORY_MAX_PT, '最小手数なら満点')
  assert.equal(best.agi, MEMORY_MAX_PT, '25秒なら満点')
})

test('速いだけ・正確なだけでは片方しか埋まらない', () => {
  const fastButSloppy = memoryPt({ moves: MEMORY_PAIRS * 3, seconds: 25 })
  assert.equal(fastButSloppy.dex, 0)
  assert.equal(fastButSloppy.agi, MEMORY_MAX_PT)
  const slowButSharp = memoryPt({ moves: MEMORY_PAIRS, seconds: 90 })
  assert.equal(slowButSharp.dex, MEMORY_MAX_PT)
  assert.equal(slowButSharp.agi, 0)
})

test('神経衰弱のptは0を下回らない', () => {
  const p = memoryPt({ moves: 999, seconds: 999 })
  assert.equal(p.dex, 0)
  assert.equal(p.agi, 0)
})

test('神経衰弱の札は8ペア16枚。どの数字もちょうど2枚', () => {
  const deck = memoryDeck(() => 0.5)
  assert.equal(deck.length, MEMORY_PAIRS * 2)
  for (let i = 1; i <= MEMORY_PAIRS; i++) {
    assert.equal(deck.filter(c => c === i).length, 2, `${i}が2枚ない`)
  }
})

test('神経衰弱の札は並べ替えられている', () => {
  let seed = 1
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const deck = memoryDeck(rng)
  const sorted = [...deck].sort((a, b) => a - b)
  assert.notDeepEqual(deck, sorted, '並びが揃ったまま＝混ぜていない')
})

// ===== 積み上げ耐久 =====

test('乗せた数が増えるほど揺れが大きくなる', () => {
  assert.ok(stackDrift(10) > stackDrift(0))
  assert.ok(stackDrift(20) > stackDrift(10))
})

test('操作しなければいつかは崩れる', () => {
  let seed = 7
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let s = stackStart()
  for (let i = 0; i < 6000 && !s.over; i++) s = stackStep(s, 1 / 60, 0, rng)
  assert.ok(s.over, '放置していても崩れない＝待つだけのゲームになっている')
})

test('傾いた側と逆に入力すると戻る', () => {
  const noNoise = () => 0.5           // ゆらぎなし＝入力の効きだけを見る
  let s = { ...stackStart(), tilt: 0.3 }
  for (let i = 0; i < 60; i++) s = stackStep(s, 1 / 60, -1, noNoise)
  assert.equal(s.over, false, '立て直せずに崩れている＝倒れる力が強すぎる')
  assert.ok(s.tilt < 0.3, `左を押しても戻らない（${s.tilt}）`)
})

// ★実際に踏んだ穴。dtが負のまま減衰（Math.pow）を通ると増幅に反転して、
//   1フレームで傾きが振り切れて即崩壊した
test('dtが負でも傾きが発散しない', () => {
  const noNoise = () => 0.5
  let s = { ...stackStart(), tilt: 0.2, vel: 0.3 }
  for (let i = 0; i < 120; i++) s = stackStep(s, -1 / 60, 0, noNoise)
  assert.equal(s.over, false, '負のdtで崩れている')
  assert.ok(Math.abs(s.tilt) <= 0.2, `傾きが増えている（${s.tilt}）`)
  assert.ok(Number.isFinite(s.vel))
})

test('崩れたあとは進まない', () => {
  const over = { ...stackStart(), over: true, blocks: 9 }
  assert.deepEqual(stackStep(over, 1, 1, () => 0.5), over)
})

// ★測ってみたら、ちゃんと操作する人の中央値は上限（16個）を超えていた。
//   切らないと、1ptにもならないまま延々と続けることになる
test('上限まで積んだら耐えきったで終わる', () => {
  assert.equal(stackCleared({ blocks: STACK_MAX_PT - 1 }), false)
  assert.equal(stackCleared({ blocks: STACK_MAX_PT }), true)
  assert.equal(stackCleared(stackStart()), false)
})

// ★倒立振子にする前は、傾きに戻す力も倒れる力も無いただのランダムウォークだった。
//   放置の平均が25個＝上限16個を素通りし、**何もしないほうが満点**になっていた
test('放置していると上限に届く前に崩れる', () => {
  let seed = 3
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let s = stackStart()
  for (let i = 0; i < 60 * 300 && !s.over; i++) s = stackStep(s, 1 / 60, 0, rng)
  assert.ok(s.over, '放置していても崩れない')
  assert.ok(s.blocks < STACK_MAX_PT, `放置で上限に届いている（${s.blocks}個）＝待つだけのゲーム`)
})

test('傾くほど倒れる力が強くなる', () => {
  assert.ok(stackGravity(20) > stackGravity(0), '乗せるほど立て直しにくくならない')
  const g = stackGravity(0)
  const noNoise = () => 0.5
  const lean = stackStep({ ...stackStart(), tilt: 0.5 }, 1 / 60, 0, noNoise)
  assert.ok(lean.vel > 0, '傾いている側へ倒れていかない')
  assert.ok(g > 0)
})

test('積み上げのptは乗せた個数そのまま。上限16', () => {
  assert.equal(stackPt(0), 0)
  assert.equal(stackPt(9), 9)
  assert.equal(stackPt(99), STACK_MAX_PT)
  assert.equal(STACK_LIMIT, 1)
})

// ===== コイントス =====

test('コイントスは表か裏しか出ない', () => {
  assert.deepEqual(COIN_SIDES, ['表', '裏'])
  assert.equal(coinFlip(() => 0.1), '表')
  assert.equal(coinFlip(() => 0.9), '裏')
})

test('当てるとpt。3連続からは上乗せがつく', () => {
  assert.equal(coinPt(0), 0, '外したら0')
  assert.equal(coinPt(1), COIN_HIT_PT)
  assert.equal(coinPt(2), COIN_HIT_PT)
  assert.equal(coinPt(3), COIN_HIT_PT + COIN_CHAIN_PT)
  assert.equal(coinPt(10), COIN_HIT_PT + COIN_CHAIN_PT)
})

// ===== 運動量 =====

test('歩数は1,000歩ごとに10pt、8,000歩で頭打ち', () => {
  assert.equal(walkPt(0), 0)
  assert.equal(walkPt(999), 0, '端数では入らない')
  assert.equal(walkPt(1000), 10)
  assert.equal(walkPt(8000), 80)
  assert.equal(walkPt(50000), 80, '上限を超えても増えない')
  assert.equal(walkPt(-100), 0)
})

// ===== 漢字 =====

test('上の級ほど1問のptが高い', () => {
  const pts = KANJI_GRADES.map(g => kanjiPt(g.key, 10))
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i] > pts[i - 1], `${KANJI_GRADES[i].label}が上がっていない`)
  assert.equal(kanjiPt('g3', 20), KANJI_BASE_PT * 20, '3級は20問全問正解で80pt')
})

test('知らない級は0pt', () => {
  assert.equal(kanjiPt('g0', 20), 0)
  assert.equal(kanjiPt('g3', 0), 0)
})
