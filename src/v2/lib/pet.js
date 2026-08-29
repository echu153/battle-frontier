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

import { kanjiWordsOf } from './kanjiData.js'

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
  // ★漢字は**1セット＝1回**（2026-08-29 ユーザー指示）。
  //   前は1問＝1回にしていたので、実質「20問ノンストップ」になって終わりが見えなかった。
  //   ほかの遊びと同じ「1回やったら終わる」形にそろえる。合計の出題数とptは変えていない。
  { key:'kanji',  label:'漢字',         icon:'✍',  main:['int_stat'], plays:4,
    limitText:'4セット/日（1セット5問）', note:'漢字検定3級〜1級。正解でpt・上の級ほど1問が高い' },
  { key:'stack',  label:'積み上げ耐久',  icon:'🧱', main:['vit'], plays:5,
    limitText:'5回/日',      note:'崩れるまでに乗せた個数がそのままpt。上限なし' },
  { key:'memory', label:'神経衰弱',      icon:'🃏', main:['dex','agi'], plays:1,
    limitText:'1日1回',      note:'めくった手数でDEX・かかった時間でAGI' },
  { key:'coin',   label:'コイントス',    icon:'🪙', main:['luk'], plays:1,
    limitText:'1日1回',      note:'裏が出るまで投げ続ける。3回のうち一番良かった表の回数ぶん' },
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

// 「回数」では区切れない、その日の積み上げ量（いまは歩数だけ）。日付が変われば0から
export const countsOf = (state, day) =>
  (state?.day === day ? (state.counts || {}) : {})

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
// ★遊び方：**裏が出るまで投げ続け、出た表の回数がその回の成績**。
//   これを COIN_TRIES 回やって、**いちばん良かった回だけ**が採用される。
//   （表が出るたびに「まだ伸びる」と分かるので、引きの良い回を引き当てる遊び）
export const COIN_TRIES   = 3        // 1プレイで投げられる回数
export const COIN_HEAD_PT = 40       // 表1回ぶんのpt
export const COIN_RUN_CAP = 60       // 万一 rng が偏っても止まるための保険
export const COIN_SIDES = ['表', '裏']

export const coinFlip = (rng = Math.random) => COIN_SIDES[rng() < 0.5 ? 0 : 1]

// 1回ぶん。裏が出るまで投げ続けて、出た表の並びを返す
export const coinRun = (rng = Math.random) => {
  const heads = []
  while (heads.length < COIN_RUN_CAP && rng() < 0.5) heads.push('表')
  return heads.length
}

// 表の回数ぶん。0回なら0pt
// ★実測（40万回）：3回のうち最良の表の回数は平均2.15回。
//   40pt/回で1日およそ86pt＝他ステの80ptとほぼ同じ。ただし12.5%で0pt、
//   まれに表5回以上（200pt超）も出る＝LUKらしいブレの大きさ
export const coinPt = (heads) => Math.max(0, Math.floor(heads || 0)) * COIN_HEAD_PT

// ============================================================
// 運動量 — STR（実装は端末の歩数センサー。https必須・画面を開いている間だけ）
// ============================================================
export const WALK_STEP_UNIT = 1000
export const WALK_PT_PER_UNIT = 10
export const WALK_MAX_STEPS = 8000
export const walkPt = (steps) =>
  Math.floor(Math.min(WALK_MAX_STEPS, Math.max(0, steps || 0)) / WALK_STEP_UNIT) * WALK_PT_PER_UNIT

// 今日の歩数を記録して、まだ渡していないぶんのptを入れる。
// ★歩数は減らない（画面を開き直しても、その日の最大値を持つ）。
//   1,000歩ごとの区切りを跨いだときだけptが入るので、何度呼んでも二重には入らない
export const addWalk = (state, steps, day) => {
  const cur = state || emptyPetState()
  const counts = { ...countsOf(cur, day) }
  const total = Math.max(counts.walkSteps || 0, Math.max(0, Math.floor(steps || 0)))
  const already = counts.walkPt || 0
  const pt = Math.max(0, walkPt(total) - already)
  counts.walkSteps = total
  counts.walkPt = already + pt
  const base = { ...cur, day, plays: playsOf(cur, day), counts }
  if (!pt) return { pt: 0, gains: emptyPetGains(), state: base }
  const scored = scorePlay(base, { str: pt })
  return { pt, gains: scored.gains, state: scored.state }
}

// ============================================================
// 漢字 — INT（配当漢字から問題を組み立てる。データは後で足す）
// ============================================================
// ★倍率は**1問ぶんを切り捨てても差が残る**ように刻むこと。
//   1.1 にしていたとき、4×1.1＝4.4→切り捨て4で3級とまったく同じptになっていた
//   （上の級を選ぶ意味が消える）。1問あたり 4/5/6/8/10pt。
export const KANJI_GRADES = [
  { key:'g3',  label:'3級',   mult:1 },
  { key:'g25', label:'準2級', mult:1.25 },
  { key:'g2',  label:'2級',   mult:1.5 },
  { key:'g15', label:'準1級', mult:2 },
  { key:'g1',  label:'1級',   mult:2.5 },
]
export const KANJI_BASE_PT = 4
// ★1セット5問 × 4セット＝1日20問（2026-08-29 ユーザー決定）。
//   合計は前と同じ。区切りを入れて「1セットやったら終わる」形にしただけ
export const KANJI_SET_SIZE = 5        // 1セットの問題数
export const KANJI_SETS_PER_DAY = 4    // 1日にできるセット数（CONTENTS の plays と同じ）
export const KANJI_QUIZ_MAX = KANJI_SET_SIZE * KANJI_SETS_PER_DAY   // 1日の出題数（20問）
export const KANJI_CHOICES = 4         // 選択肢の数
export const kanjiPt = (gradeKey, correct) => {
  const g = KANJI_GRADES.find(x => x.key === gradeKey)
  if (!g) return 0
  return Math.floor(Math.max(0, correct || 0) * KANJI_BASE_PT * g.mult)
}

// ============================================================
// 覚え具合と、出題の重みづけ
// ------------------------------------------------------------
// ★ここが「毎日やれば実力がつく」の中身。ただの抽選だと、覚えた語も
//   知らない語も同じ確率で出てしまい、いつまでも苦手が苦手のまま残る。
//   **間違えた語ほど濃く、正解を重ねた語ほど薄く**出す。
//
//   log … { [熟語]: { ok, ng } }。正解数と不正解数だけ持つ
// ============================================================
export const KANJI_MASTER_OK = 3      // 正解がこの数に届いたら「覚えた」

// その語の覚え具合。ok - ng。マイナスなら苦手
export const kanjiScoreOf = (log, word) => {
  const e = log?.[word]
  if (!e) return null                 // まだ一度も出していない
  return (e.ok || 0) - (e.ng || 0)
}

// 出やすさ。数字が大きいほど出る
export const kanjiWeightOf = (log, word) => {
  const s = kanjiScoreOf(log, word)
  if (s === null) return 6            // 初めての語。ひととおり出したい
  if (s < 0) return 12                // 間違えたほうが多い＝苦手。いちばん濃く
  if (s === 0) return 6
  if (s === 1) return 3
  if (s === 2) return 2
  return 1                            // 覚えた語も忘れないよう、たまには出す
}

// 覚えた語の数（正解が KANJI_MASTER_OK 以上・不正解を差し引いて）
export const kanjiMasteredCount = (log, words) =>
  words.filter(e => (kanjiScoreOf(log, e.w) ?? -99) >= KANJI_MASTER_OK).length

// 重みつきで1語選ぶ。recent に入っている語は避ける（続けて同じ語を出さない）
export const pickKanjiWord = (words, log, rng = Math.random, recent = []) => {
  if (!words.length) return null
  const avail = words.filter(e => !recent.includes(e.w))
  const pool = avail.length ? avail : words
  const weights = pool.map(e => kanjiWeightOf(log, e.w))
  const total = weights.reduce((t, v) => t + v, 0)
  let r = rng() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r < 0) return pool[i]
  }
  return pool[pool.length - 1]
}

// 1問ぶんの結果を記録する
export const recordKanji = (log, word, right) => {
  const cur = { ...(log || {}) }
  const e = { ok: 0, ng: 0, ...(cur[word] || {}) }
  if (right) e.ok += 1
  else e.ng += 1
  cur[word] = e
  return cur
}

// 出題を1問組み立てる。
//   kind 'read'  … 熟語を出して読みを当てる
//   kind 'write' … 読みを出して熟語を当てる
// ★まちがいの選択肢は**同じ級の別の語**から取る。
//   読み問題では「読みの長さが近いもの」を優先＝字数で答えが割れないようにする
// log と recent を渡すと、苦手な語が優先して出る（渡さなければただの抽選）
export const makeKanjiQuiz = (gradeKey, rng = Math.random, kind = null, log = null, recent = []) => {
  const words = kanjiWordsOf(gradeKey)
  if (words.length < KANJI_CHOICES) return null
  const pick = pickKanjiWord(words, log, rng, recent)
  if (!pick) return null
  const type = kind || (rng() < 0.5 ? 'read' : 'write')
  const answer = type === 'read' ? pick.y : pick.w

  // 答え以外の候補。読みが近い長さのものを前に寄せてから選ぶ
  const others = words.filter(e => e.w !== pick.w && e.y !== pick.y)
  others.sort((a, b) =>
    Math.abs(a.y.length - pick.y.length) - Math.abs(b.y.length - pick.y.length))
  const pool = others.slice(0, Math.max(KANJI_CHOICES * 3, 12))
  const wrong = []
  while (wrong.length < KANJI_CHOICES - 1 && pool.length) {
    const e = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    const v = type === 'read' ? e.y : e.w
    if (v !== answer && !wrong.includes(v)) wrong.push(v)
  }
  if (wrong.length < KANJI_CHOICES - 1) return null

  const choices = [answer, ...wrong]
  for (let i = choices.length - 1; i > 0; i--) {   // 並べ替え
    const j = Math.floor(rng() * (i + 1))
    const tmp = choices[i]
    choices[i] = choices[j]
    choices[j] = tmp
  }
  return {
    type,
    grade: gradeKey,
    ask: type === 'read' ? pick.w : pick.y,   // 画面に出す側
    answer,
    choices,
    word: pick.w,
    yomi: pick.y,
  }
}
