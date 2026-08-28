// ============================================================
// バトルフロンティアⅡ（リメイク版）— ペット
// ------------------------------------------------------------
// ゲーム内の遊びと現実の行動でペットを育て、育ったステータスを主人公に足す。
// 設計の全体像は docs/v2-pet-design.md。このファイルは**数え方の正**。
//
// 決まっていること（ユーザー承認済み）
//   ・ステは6種。本編8種から HP・MP を除いたものと同じキーを使う
//   ・稼いだ pt は主ステに100%、他の5ステに10%ずつ入る（＝そのステが上がりやすい）
//   ・1日の上限は**回数**で区切る（上手いほど同じ回数で多く取れる）
//   ・累計 pt からステ値が決まる。**抽選はしない**
//     （運動したのにINTが上がる、を起こさない。本編の rollLevelUp とは別物）
//   ・主人公へは**実数で加算**する
//
// 数値はまだ案。とくに statValueOf の係数と主人公への加算係数は
// tools で逆算してから確定させる（勘で置かない）。
// ============================================================

// 本編の STAT_KEYS から HP・MP を除いた6種。並びは本編と揃える
export const PET_STAT_KEYS = ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']

// 主ステ以外にこぼれる割合。0 にすると「やらないステは永久に0」になるので必ず残す
export const SPILL = 0.1

// ===== コンテンツ =====
// main   … そのコンテンツで主に伸びるステ（神経衰弱だけ2つ）
// plays  … 1日にできる回数。walk と kanji は回数ではなく量で頭打ちになる
// 1日ぶんを使い切るとどのステも 80pt 前後になるよう、1回あたりの上限を決めてある
export const CONTENTS = [
  { key:'walk',   label:'運動',         icon:'👟', main:['str'],
    limitText:'8,000歩/日',  note:'歩数を数える。1,000歩ごとに10pt' },
  { key:'kanji',  label:'漢字',         icon:'✍',  main:['int_stat'],
    limitText:'20問/日',     note:'漢字検定3級〜1級。正解した数でpt' },
  { key:'stack',  label:'積み上げ耐久',  icon:'🧱', main:['vit'], plays:5,
    limitText:'5回/日',      note:'崩れるまでに乗せた個数がそのままpt。上限なし' },
  { key:'memory', label:'神経衰弱',      icon:'🃏', main:['dex','agi'], plays:1,
    limitText:'1日1回',      note:'めくった手数でDEX・かかった時間でAGI' },
  { key:'coin',   label:'コイントス',    icon:'🪙', main:['luk'], plays:2,
    limitText:'2回/日',      note:'1回につき5投げ。当てるとpt・3連続からは上乗せ' },
]
export const CONTENT_BY_KEY = Object.fromEntries(CONTENTS.map(c => [c.key, c]))

// ===== ptの配り方 =====
export const emptyPetGains = () => Object.fromEntries(PET_STAT_KEYS.map(k => [k, 0]))

// pts … { str: 20 } のように「主ステごとのpt」。主ステに全部、他の5ステに SPILL ぶん。
// ★神経衰弱のように主ステが2つあるときは { dex, agi } を一度に渡す
//   （DEXぶんの10%がAGIにも入る＝速いだけ・正確なだけでも少しは伸びる）
//
// ★こぼれる10%は**端数を繰り越す**。1プレイごとに切り捨てると、
//   コイントス（1回8pt）は 8×10%＝0.8 が毎回0になり、**他ステが永久に0のまま**になる
//   （実際そうなっていた。10回投げてLUK+40・他は全部0）。
//   carry … 前回までの端数。返り値の carry をそのまま次に渡すこと
export const spread = (pts, carry = null) => {
  const out = emptyPetGains()
  const rest = { ...emptyPetGains(), ...(carry || {}) }
  for (const [main, raw] of Object.entries(pts)) {
    const pt = Math.max(0, Math.floor(raw || 0))
    if (!pt || !(main in out)) continue
    out[main] += pt
    for (const k of PET_STAT_KEYS) if (k !== main) rest[k] += pt * SPILL
  }
  for (const k of PET_STAT_KEYS) {
    const whole = Math.floor(rest[k])
    if (whole > 0) { out[k] += whole; rest[k] -= whole }
    rest[k] = Math.round(rest[k] * 1000) / 1000   // 端数の桁を丸めて保存を汚さない
  }
  return { gains: out, carry: rest }
}

// ===== 累計pt → ステ値 =====
// そのまま足すと1年で数万になって主人公を食うので逓減させる。
// 1日満額80pt＝12 ／ 1か月2,400pt＝69 ／ 1年29,200pt＝241
export const statValueOf = (cumPt) => Math.floor(Math.sqrt(2 * Math.max(0, cumPt || 0)))

export const statsOf = (cum) =>
  Object.fromEntries(PET_STAT_KEYS.map(k => [k, statValueOf(cum?.[k] || 0)]))

// ===== ペットのLV =====
// 全ステの累計ptの合計から決まる、育て具合の目安。ステの内訳とは別に持つ
export const PET_LV_STEP = 100                              // LV2に必要な累計pt
export const petLvOf = (totalPt) =>                          // 累計 STEP*n(n+1)/2 でLV n+1
  Math.floor((Math.sqrt(1 + 8 * Math.max(0, totalPt || 0) / PET_LV_STEP) - 1) / 2) + 1
export const petLvNeed = (lv) => Math.floor(PET_LV_STEP * lv * (lv - 1) / 2)  // そのLVに要る累計pt

// ============================================================
// 育ち具合の持ち方
// ------------------------------------------------------------
// ★いまは端末（localStorage）に置いている。**仮**。
//   ステが主人公に効く以上、最後は必ずサーバーが数える（旧版のGoldと同じ穴になる）。
//   移すときは、この形をそのまま v2_pets のカラムにできるようにしてある。
//     day   … 数え始めた日（JST 5:00 区切り。daily.js の dayOf と同じ）
//     plays … 今日そのコンテンツを何回やったか
//     cum   … ステごとの累計pt
//     carry … こぼれる10%の端数（1pt未満の持ち越し）
// ============================================================
export const emptyPetState = () => ({ day: '', plays: {}, cum: emptyPetGains(), carry: emptyPetGains() })

// 日付が変わっていれば回数を0として読む（累計ptは持ち越す）
export const playsOf = (state, day) =>
  (state?.day === day ? (state.plays || {}) : {})

// あと何回できるか。回数の上限がないコンテンツ（運動・漢字）は null
export const playsLeft = (state, key, day) => {
  const c = CONTENT_BY_KEY[key]
  if (!c?.plays) return null
  return Math.max(0, c.plays - (playsOf(state, day)[key] || 0))
}

// 回数を1つ使う。**遊び始めた時点で呼ぶ**。
// ★終わったときに数えると、出だしが悪ければ抜けて引き直せてしまい、
//   回数で区切った意味が消える（神経衰弱で顕著。実際に引き直せた）。
//   途中でやめたら、その1回は戻らない。
export const beginPlay = (state, key, day) => {
  const cur = state || emptyPetState()
  if (playsLeft(cur, key, day) === 0) return { ok: false, state: cur }
  const plays = { ...playsOf(cur, day) }
  plays[key] = (plays[key] || 0) + 1
  return { ok: true, state: { ...cur, day, plays } }
}

// 成績ぶんのptを足す。**回数はここでは減らさない**（もう beginPlay で使っている）。
// pts は { dex:16, agi:12 } のような主ステごとのpt
export const scorePlay = (state, pts) => {
  const cur = state || emptyPetState()
  const { gains, carry } = spread(pts, cur.carry)
  const cum = { ...emptyPetGains(), ...cur.cum }
  for (const k of PET_STAT_KEYS) cum[k] = (cum[k] || 0) + gains[k]
  return { gains, state: { ...cur, cum, carry } }
}

// 始めて終わるまでが一瞬のもの（コイントス）用。beginPlay と scorePlay をまとめて行う
export const applyPlay = (state, key, pts, day) => {
  const begun = beginPlay(state, key, day)
  if (!begun.ok) return { ok: false, state: begun.state, gains: emptyPetGains() }
  const scored = scorePlay(begun.state, pts)
  return { ok: true, gains: scored.gains, state: scored.state }
}

// 累計ptの合計（＝ペットのLVのもと）
export const totalPtOf = (state) =>
  PET_STAT_KEYS.reduce((t, k) => t + (state?.cum?.[k] || 0), 0)

// スコアを 0〜max の pt に直す。best で満点、worst で0
const scale = (v, best, worst, max) => {
  if (worst === best) return 0
  const r = (worst - v) / (worst - best)
  return Math.max(0, Math.min(max, Math.round(r * max)))
}

// ============================================================
// 神経衰弱 — DEX（手数）とAGI（時間）
// ============================================================
export const MEMORY_PAIRS = 8              // 8ペア＝16枚（4×4）
// ★1日1回なので、1プレイで1日ぶん（80pt）を取り切る形。
//   DEX・AGIそれぞれ最大80pt＝この1回の出来がそのままその日の成績になる
export const MEMORY_MAX_PT = 80
export const MEMORY_MOVE_BEST  = MEMORY_PAIRS      // 最小手数＝ペア数。一度も外さなければ満点
export const MEMORY_MOVE_WORST = MEMORY_PAIRS * 3  // これ以上かかると0pt
export const MEMORY_SEC_BEST  = 25
export const MEMORY_SEC_WORST = 90

export const memoryPt = ({ moves = 0, seconds = 0 } = {}) => ({
  dex: scale(moves,   MEMORY_MOVE_BEST, MEMORY_MOVE_WORST, MEMORY_MAX_PT),
  agi: scale(seconds, MEMORY_SEC_BEST,  MEMORY_SEC_WORST,  MEMORY_MAX_PT),
})

// 札の並び。★絵文字は環境によって豆腐になるので数字で出す（v2ui.js の注意と同じ理由）
export const memoryDeck = (rng = Math.random) => {
  const cards = []
  for (let i = 1; i <= MEMORY_PAIRS; i++) cards.push(i, i)
  for (let i = cards.length - 1; i > 0; i--) {   // Fisher-Yates
    const j = Math.floor(rng() * (i + 1))
    const tmp = cards[i]
    cards[i] = cards[j]
    cards[j] = tmp
  }
  return cards
}

// ============================================================
// 積み上げ耐久 — VIT
// ------------------------------------------------------------
// 1個ごとの操作はやさしく、**乗せた数が増えるほど揺れを大きく**する。
// 操作の精度を競わせるとDEXと被るので、測るのは「どこまで持ちこたえたか」だけ。
// ============================================================
// ★上限なし（青天井）。積めるだけ積む＝そのままpt。
//   そのぶん、乗せるほど「重く・速く・揺れる」の3つが同時にきつくなる
export const STACK_LIMIT    = 1      // |傾き| がこれを超えたら崩れる
export const STACK_CORRECT  = 1.6    // 左右キーで戻す速さ（毎秒）
export const STACK_DAMP     = 0.25   // 1秒あたりに残る勢い（＝減衰）
export const STACK_KICK     = 0.25   // 1個乗るたびに入る衝撃

// 次の1個が乗るまでの間隔。積むほど短くなる＝どんどん忙しくなる
export const STACK_PLACE_SEC = 1.6   // 1個目までの間隔
export const STACK_PLACE_MIN = 0.5   // これ以上は速くしない
export const stackPlaceSec = (blocks) =>
  Math.max(STACK_PLACE_MIN, STACK_PLACE_SEC - Math.max(0, blocks) * 0.03)

// ★倒立振子。**傾くほど倒れが速くなる**＝手を離した時点で終わる。
//   これが無いとただのランダムウォークになり、放置していたほうが成績が良くなる
//   （実際そうなっていた。放置で平均25個）。
//   上限を置かない代わりに、ここの伸びが実質の天井を作る。
//   0.3のとき：放置2.5個／人(反応0.3秒)15.6個／上手い人42.7個
export const stackGravity = (blocks) => 2.2 + Math.max(0, blocks) * 0.3

// 乗っている数に応じた揺れの強さ。序盤はほとんど揺れない
export const stackDrift = (blocks) => 0.5 + Math.max(0, blocks) * 0.16

export const stackStart = () => ({ blocks: 0, tilt: 0, vel: 0, t: 0, over: false })

// dt秒ぶん進める。input は -1（←）／0／+1（→）
// ★dtは負にしない。負のまま Math.pow(STACK_DAMP, dt) を通すと減衰が増幅に反転して、
//   たった1フレームで傾きが発散する（rAFのタイムスタンプが last より手前に来ると起きる）
export const stackStep = (s, rawDt, input = 0, rng = Math.random) => {
  if (s.over) return s
  const dt = Math.max(0, rawDt || 0)
  const noise = (rng() * 2 - 1) * stackDrift(s.blocks)
  const fall = stackGravity(s.blocks) * s.tilt      // 傾いている側へ倒れていく力
  let vel = (s.vel + (fall + noise + input * STACK_CORRECT) * dt) * Math.pow(STACK_DAMP, dt)
  const tilt = s.tilt + vel * dt
  let blocks = s.blocks
  let t = s.t + dt
  const wait = stackPlaceSec(s.blocks)
  if (t >= wait) {                     // 1個乗る＝衝撃が入る
    t -= wait
    blocks += 1
    vel += (rng() * 2 - 1) * STACK_KICK
  }
  return { blocks, tilt, vel, t, over: Math.abs(tilt) >= STACK_LIMIT }
}

// 乗せた個数がそのままpt。★上限なし＝積んだだけ入る
export const stackPt = (blocks) => Math.max(0, Math.floor(blocks || 0))

// ============================================================
// コイントス — LUK
// ============================================================
export const COIN_HIT_PT    = 8      // 当てたときのpt
export const COIN_CHAIN_PT  = 4      // 連続的中の上乗せ
export const COIN_CHAIN_FROM = 3     // 何連続目から上乗せするか
export const COIN_TOSSES    = 5      // 1回のプレイで投げる回数。投げ切ったら終わり
export const COIN_SIDES = ['表', '裏']

export const coinFlip = (rng = Math.random) => COIN_SIDES[rng() < 0.5 ? 0 : 1]

// streak … この的中を含めた連続的中数。外したときは 0 を渡す＝0pt
export const coinPt = (streak) =>
  (streak > 0 ? COIN_HIT_PT + (streak >= COIN_CHAIN_FROM ? COIN_CHAIN_PT : 0) : 0)

// ============================================================
// 運動量 — STR（実装は端末の歩数センサー。https必須・画面を開いている間だけ）
// ============================================================
export const WALK_STEP_UNIT = 1000
export const WALK_PT_PER_UNIT = 10
export const WALK_MAX_STEPS = 8000
export const walkPt = (steps) =>
  Math.floor(Math.min(WALK_MAX_STEPS, Math.max(0, steps || 0)) / WALK_STEP_UNIT) * WALK_PT_PER_UNIT

// ============================================================
// 漢字 — INT（配当漢字から問題を組み立てる。データは後で足す）
// ============================================================
export const KANJI_GRADES = [
  { key:'g3',  label:'3級',   mult:1 },
  { key:'g25', label:'準2級', mult:1.1 },
  { key:'g2',  label:'2級',   mult:1.25 },
  { key:'g15', label:'準1級', mult:1.5 },
  { key:'g1',  label:'1級',   mult:2 },
]
export const KANJI_BASE_PT = 4
export const KANJI_QUIZ_MAX = 20       // 1日の出題数
export const kanjiPt = (gradeKey, correct) => {
  const g = KANJI_GRADES.find(x => x.key === gradeKey)
  if (!g) return 0
  return Math.floor(Math.max(0, correct || 0) * KANJI_BASE_PT * g.mult)
}
