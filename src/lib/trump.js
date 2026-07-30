// ============================================================
// トランプゲームエンジン(大富豪/スピード/7ならべ/ババ抜き)
// UI非依存・シリアライズ可能・ホスト権威型(オセロ/麻雀と同方式)
// カード: { id, s(0♠ 1♥ 2♦ 3♣), r(1=A..13=K) } / ジョーカー: { id, joker: true }
// ============================================================

export const SUIT_LABEL = ['♠', '♥', '♦', '♣']
export const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
export const cardLabel = (c) => (c.joker ? 'JOKER' : `${SUIT_LABEL[c.s]}${RANK_LABEL[c.r - 1]}`)
export const isRed = (c) => !c.joker && (c.s === 1 || c.s === 2)
export const isNpcId = (id) => typeof id === 'string' && id.startsWith('npc-')

export const GAME_DEFS = {
  daifugo: { name: '大富豪', min: 4, max: 4 },
  speed: { name: 'スピード', min: 2, max: 2 },
  sevens: { name: '7ならべ', min: 4, max: 4 },
  oldmaid: { name: 'ババ抜き', min: 2, max: 5 },
}
// 人数表示("4人" / "2〜5人")
export const playersLabel = (d) => (d.min === d.max ? `${d.min}人` : `${d.min}〜${d.max}人`)

// 対局中に確認できるルール説明
export const GAME_HELP = {
  daifugo: {
    name: '大富豪',
    basic: [
      '場に出ているより強い札を、同じ枚数で出す。出せないときはパス。',
      '強さは 3→4→…→K→A→2 の順に強い。JOKERは最強。',
      '同じ数字は2〜4枚まとめて出せる（場が2枚なら2枚で返す）。',
      'JOKERは1枚でも出せて、同じ数字の組に混ぜても使える。',
      '手札を先に無くした順に1位・2位…最後まで残った人が最下位。',
    ],
    special: {
      kakumei: ['革命', '4枚以上を同時に出すと強さが逆転する（3が最強・2が最弱）。もう一度4枚出すと元に戻る。'],
      spade3: ['スペ3返し', '場がJOKER1枚だけのとき、♠3の1枚で返せる。場が流れて自分がもう一度出せる。'],
      kaidan: ['階段', '同じマークの3枚以上の連番を出せる（例: ♠3♠4♠5）。JOKERは穴埋めに使える。4枚以上の階段は革命。'],
      shibari: ['しばり', '前の人と同じマークの組で返すとロックが発生。場が流れるまでそのマークしか出せない（JOKERは自由）。'],
      miyako: ['都落ち', '前の対局の1位が今回1位を取れなかった瞬間、その場で最下位が確定する（2戦目以降）。'],
    },
    always: ['8切り', '8を含めて出すと場が流れ、出した人がもう一度好きな札を出せる。'],
    alwaysMore: [
      ['反則上がり', '最後の1手が「その時いちばん強い数字（通常は2・革命中は3）」「JOKER」「8切り」だと反則負けで最下位になる。'],
      ['カード交換', '2戦目以降は開始前に交換。最下位→1位に強い札2枚・3位→2位に強い札1枚（自動）、1位→最下位に好きな2枚・2位→3位に好きな1枚（選択）。'],
    ],
    match: 'マッチ戦: 各局の順位でポイントを獲得（1位4pt・2位2pt・3位1pt・4位0pt）。合計ptで最終順位が決まります。',
  },
  speed: {
    name: 'スピード',
    basic: [
      '2人同時進行の早出し。ターンはなく、早い者勝ちで出せる。',
      '自分の4枚の場札から、中央の台札と数字が1つ違い（±1）の札を出せる。AとKもつながる。',
      '出したい札をタップ→置きたい台札をタップ。置ける台札は光ります。',
      '場札は出すと山札から自動で補充される。手持ちを先に全部無くした人が勝ち。',
      '両者とも出せなくなったら自動で台札をめくり直します。山札も尽きたら残り枚数が少ない方の勝ち。',
    ],
    special: {},
    always: null,
    match: null,
  },
  sevens: {
    name: '7ならべ',
    basic: [
      '4つのマークごとに7から数字をつないで並べていく（例: ♦7の隣に♦6や♦8）。',
      '自分の番に置ける札があれば置く。置けないときはパス。',
      'パスは3回まで。4回目はバーストとなり、手札を全部場に出して脱落（最下位側）。',
      '手札を先に無くした順に上位。♦7を持っている人が先手です。',
    ],
    special: {},
    always: null,
    match: null,
  },
  oldmaid: {
    name: 'ババ抜き',
    basic: [
      '自分の番に、次の人の手札（裏向き）から1枚引く。',
      '同じ数字が2枚そろうと自動で捨てられる。',
      '手札を先に無くした順に上位。最後にJOKERを持っていた人が最下位。',
      '自分の札をタップして ← → で並べ替えできる（いつでも・何回でも）。',
      '並べ替えると他の人には「どの位置が動いたか」だけが光って見える。中身は見えない。',
    ],
    special: {},
    always: null,
    match: null,
  },
}
export const TURN_SEC_TRUMP = 60 // 1人の持ち時間(秒)

function makeDeck(withJoker) {
  const d = []
  let id = 0
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ id: id++, s, r })
  if (withJoker) d.push({ id: id++, joker: true })
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}
const clone = (o) => JSON.parse(JSON.stringify(o))
const nextActive = (players, from) => {
  const n = players.length
  for (let i = 1; i <= n; i++) {
    const c = (from + i) % n
    if (!players[c].out) return c
  }
  return -1
}
const activeCount = (players) => players.filter((p) => !p.out).length

// ============================================================
// 大富豪
// 強さ: 3<4<..<K<A<2<JOKER。革命(4枚以上・4枚以上の階段も)で反転(JOKERは常に最強)
// 8切り(場が流れて同じ人が出し直し)
// 選択ルール: 階段(同スート3枚以上の連番) / しばり(スート一致で以後同スート限定) /
//             都落ち(前回1位が今回1位を取れなかった時点で最下位確定)
// ============================================================
const dfStrength = (r) => (r >= 3 ? r : r + 13) // 3..13 / A=14 / 2=15
const DF_JOKER_STRENGTH = 16

// prevRanking: 前の局の順位順プレイヤーid配列(2戦目以降のカード交換に使う)
export function createDaifugo(playersIn, rules = {}, championId = null, prevRanking = null) {
  const deck = makeDeck(true)
  const players = playersIn.map((p) => ({ id: p.id, name: p.name, hand: [], out: false, rank: 0 }))
  let i = 0
  while (deck.length > 0) { players[i % players.length].hand.push(deck.pop()); i++ }
  for (const p of players) sortDf(p.hand)
  const st = {
    mode: 'daifugo', players,
    rules: {
      kaidan: !!rules.kaidan, shibari: !!rules.shibari, miyako: !!rules.miyako,
      kakumei: rules.kakumei !== false, spade3: rules.spade3 !== false,
    },
    champion: rules.miyako && championId && players.some((p) => p.id === championId) ? championId : null,
    turn: 0, field: null, // { cards, count, strength, type, suits, lock, by }
    lastPlayer: null, passed: players.map(() => false),
    revolution: false, rankNext: 1, rankBottom: players.length,
    phase: 'playing', result: null, exchange: null,
  }
  // ---- カード交換(2戦目以降・4人以上) ----
  // 最下位→1位に最強2枚 / 3位→2位に最強1枚(自動)
  // 1位→最下位に好きな2枚 / 2位→3位に好きな1枚(選択)。すべて同時に成立する
  if (prevRanking && players.length >= 4) {
    const seatOf = (id) => players.findIndex((p) => p.id === id)
    const n = players.length
    const pairs = [] // { from, to, count, auto }
    const top = seatOf(prevRanking[0]), bottom = seatOf(prevRanking[n - 1])
    const second = seatOf(prevRanking[1]), third = seatOf(prevRanking[n - 2])
    if (top >= 0 && bottom >= 0 && top !== bottom) {
      pairs.push({ from: bottom, to: top, count: 2, auto: true })
      pairs.push({ from: top, to: bottom, count: 2, auto: false })
    }
    if (second >= 0 && third >= 0 && second !== third && second !== bottom && third !== top) {
      pairs.push({ from: third, to: second, count: 1, auto: true })
      pairs.push({ from: second, to: third, count: 1, auto: false })
    }
    if (pairs.length > 0) {
      st.phase = 'exchange'
      st.exchange = {
        pairs,
        picks: {},   // seat -> cardIds(選択側の提出内容)
        pending: pairs.filter((p) => !p.auto).map((p) => p.from),
      }
    }
  }
  return st
}

// 交換で自動的に渡す札(最強からcount枚)。革命は考慮しない(局開始時は常に通常の強さ)
function dfStrongest(hand, count) {
  return [...hand]
    .sort((a, b) => (b.joker ? 99 : dfStrength(b.r)) - (a.joker ? 99 : dfStrength(a.r)))
    .slice(0, count)
}

// 交換の提出(選択側)。全員揃ったら一斉に交換して対局開始
function doDfExchange(st, seat, action, ev) {
  const ex = st.exchange
  if (!ex) return { error: '交換フェーズではありません' }
  if (!ex.pending.includes(seat)) return { error: '提出済みです' }
  const pair = ex.pairs.find((p) => !p.auto && p.from === seat)
  if (!pair) return { error: '交換の対象ではありません' }
  if (!Array.isArray(action.cardIds) || action.cardIds.length !== pair.count) {
    return { error: `${pair.count}枚選んでください` }
  }
  const hand = st.players[seat].hand
  const uniq = [...new Set(action.cardIds)]
  if (uniq.length !== pair.count || uniq.some((id) => !hand.find((c) => c.id === id))) {
    return { error: 'その札は持っていません' }
  }
  ex.picks[seat] = uniq
  ex.pending = ex.pending.filter((s) => s !== seat)
  ev.push({ t: 'exchangeSubmit', seat })
  if (ex.pending.length > 0) return { state: st, events: ev }

  // ---- 全員提出 → 一斉交換 ----
  const moves = [] // { from, to, cards }
  for (const p of ex.pairs) {
    const cards = p.auto
      ? dfStrongest(st.players[p.from].hand, p.count)
      : ex.picks[p.from].map((id) => st.players[p.from].hand.find((c) => c.id === id))
    moves.push({ from: p.from, to: p.to, cards })
  }
  for (const m of moves) {
    const ids = new Set(m.cards.map((c) => c.id))
    st.players[m.from].hand = st.players[m.from].hand.filter((c) => !ids.has(c.id))
  }
  for (const m of moves) {
    st.players[m.to].hand.push(...m.cards)
  }
  for (const p of st.players) sortDf(p.hand)
  ev.push({
    t: 'exchangeDone',
    moves: moves.map((m) => ({
      from: m.from, to: m.to,
      fromName: st.players[m.from].name, toName: st.players[m.to].name,
      cards: m.cards.map(cardLabel), cardObjs: m.cards,
      auto: !!ex.pairs.find((p) => p.from === m.from)?.auto,
    })),
  })
  st.exchange = null
  st.phase = 'playing'
  // 前局の最下位から開始(伝統的な進行)
  return { state: st, events: ev }
}

// 交換フェーズでの自動提出(NPC/時間切れ): 最も弱い札を出す
export function dfExchangeAuto(st, seat) {
  const pair = st.exchange?.pairs.find((p) => !p.auto && p.from === seat)
  if (!pair) return null
  const weakest = [...st.players[seat].hand]
    .sort((a, b) => (a.joker ? 99 : dfStrength(a.r)) - (b.joker ? 99 : dfStrength(b.r)))
    .slice(0, pair.count)
  return { type: 'exchange', cardIds: weakest.map((c) => c.id) }
}
function sortDf(hand) {
  hand.sort((a, b) => (a.joker ? 99 : dfStrength(a.r)) - (b.joker ? 99 : dfStrength(b.r)))
}

// 出せる組み合わせか検証。OK: { strength, type:'set'|'seq', suits } / NG: null
export function dfSetStrength(cards, field, revolution, rules = {}) {
  if (cards.length === 0) return null
  const nonJ = cards.filter((c) => !c.joker)
  let type = 'set', strength
  if (nonJ.length > 0 && !nonJ.every((c) => c.r === nonJ[0].r)) {
    // 階段: 同スート3枚以上の連番(ジョーカーは穴埋め可)
    if (!rules.kaidan || cards.length < 3 || cards.length > 13) return null
    if (!nonJ.every((c) => c.s === nonJ[0].s)) return null
    const ds = [...new Set(nonJ.map((c) => dfStrength(c.r)))].sort((a, b) => a - b)
    if (ds.length !== nonJ.length) return null // 同ランク重複は階段にならない
    const span = ds[ds.length - 1] - ds[0] + 1
    if (span !== cards.length) return null // ジョーカーで穴がちょうど埋まる形のみ
    type = 'seq'
    strength = ds[0]
  } else {
    if (cards.length > 4) return null
    strength = nonJ.length > 0 ? dfStrength(nonJ[0].r) : DF_JOKER_STRENGTH
  }
  const suits = nonJ.map((c) => c.s).sort((a, b) => a - b)
  // スペ3返し: ジョーカー単騎には♠3単騎で返せる(革命の有無を問わず・既定ON)
  const isSpade3 = cards.length === 1 && !cards[0].joker && cards[0].s === 0 && cards[0].r === 3
  const fieldIsLoneJoker = !!field && field.count === 1 && field.strength === DF_JOKER_STRENGTH
  // しばり中でもスペ3返しは通す(ジョーカーを流す特例なのでロックの制限を受けない)
  if (field && isSpade3 && fieldIsLoneJoker && rules.spade3 !== false) {
    return { strength, type, suits, spade3: true }
  }
  if (field) {
    if (cards.length !== field.count) return null
    if ((field.type || 'set') !== type) return null
    const beats = revolution && strength !== DF_JOKER_STRENGTH && field.strength !== DF_JOKER_STRENGTH
      ? strength < field.strength
      : strength > field.strength
    if (!beats) return null
    // しばり: ロック中はスート構成が一致しないと出せない(ジョーカーは自由)
    if (rules.shibari && field.lock) {
      const lock = [...field.lock]
      for (const s of suits) {
        const i = lock.indexOf(s)
        if (i === -1) return null
        lock.splice(i, 1)
      }
    }
  }
  return { strength, type, suits }
}

export function applyDaifugo(state, playerId, action) {
  const st = clone(state)
  const seat = st.players.findIndex((p) => p.id === playerId)
  if (seat === -1) return { error: '対局者ではありません' }
  const ev = []
  // カード交換フェーズ(2戦目以降)
  if (st.phase === 'exchange') {
    if (action.type !== 'exchange') return { error: 'カード交換中です' }
    return doDfExchange(st, seat, action, ev)
  }
  if (st.phase !== 'playing') return { error: 'ゲームは終了しています' }
  if (st.turn !== seat) return { error: 'あなたの番ではありません' }
  const me = st.players[seat]

  if (action.type === 'pass') {
    if (!st.field) return { error: '場が空の時はパスできません' }
    st.passed[seat] = true
    ev.push({ t: 'pass', seat })
    return afterDfAction(st, seat, ev)
  }
  if (action.type !== 'play') return { error: '不明な操作です' }
  if (!Array.isArray(action.cardIds)) return { error: '不正な操作です' }
  const cards = action.cardIds.map((id) => me.hand.find((c) => c.id === id)).filter(Boolean)
  if (cards.length !== action.cardIds.length) return { error: 'その札は持っていません' }
  const res = dfSetStrength(cards, st.field, st.revolution, st.rules)
  if (res === null) return { error: 'その出し方はできません' }

  // しばり: 直前の場とスート構成が一致したらロック発生(以後そのスートのみ)
  let lock = null
  if (st.rules.shibari && st.field) {
    lock = st.field.lock || null
    if (!lock && st.field.suits?.length > 0 && res.suits.length > 0 &&
        st.field.suits.join(',') === res.suits.join(',')) {
      lock = res.suits
      ev.push({ t: 'shibari', suits: res.suits })
    }
  }

  me.hand = me.hand.filter((c) => !cards.some((x) => x.id === c.id))
  const isKiri = cards.some((c) => !c.joker && c.r === 8) // 8切り
  const isRev = cards.length >= 4 && st.rules.kakumei !== false // 革命(ルールでOFF可)
  if (isRev) { st.revolution = !st.revolution; ev.push({ t: 'revolution', on: st.revolution }) }
  st.field = { cards, count: cards.length, strength: res.strength, type: res.type, suits: res.suits, lock, by: seat }
  st.lastPlayer = seat
  st.passed = st.players.map(() => false)
  ev.push({ t: 'play', seat, cards: cards.map(cardLabel), cardObjs: cards, seq: res.type === 'seq' })

  if (me.hand.length === 0) {
    // ---- 反則上がり: 最後の一手が「その時点で最強の札」「JOKER」「8切り」なら反則負け(最下位) ----
    const topRank = st.revolution ? 3 : 2 // 革命中は3が最強
    const foulReasons = []
    if (cards.some((c) => c.joker)) foulReasons.push('JOKER')
    if (cards.some((c) => !c.joker && c.r === topRank)) foulReasons.push(topRank === 2 ? '2' : '3')
    if (isKiri) foulReasons.push('8切り')
    if (foulReasons.length > 0) {
      me.out = true
      me.foul = foulReasons.join('・')
      me.rank = st.rankBottom--
      ev.push({ t: 'foul', seat, name: me.name, reasons: foulReasons, rank: me.rank })
      // 反則上がりでも場は流れる(8切りなら次はこの人の下家から)
      if (isKiri) { st.field = null; ev.push({ t: 'clear', kiri: true }) }
      st.turn = nextActive(st.players, seat)
      return finishDfIfOver(st, ev)
    }
    me.out = true
    me.rank = st.rankNext++
    ev.push({ t: 'out', seat, rank: me.rank })
    // 都落ち: 前回1位が今回1位を取れなかった時点で最下位確定
    if (me.rank === 1 && st.rules.miyako && st.champion && st.champion !== me.id) {
      const chSeat = st.players.findIndex((p) => p.id === st.champion && !p.out)
      if (chSeat >= 0) {
        st.players[chSeat].out = true
        st.players[chSeat].rank = st.rankBottom--
        ev.push({ t: 'miyako', seat: chSeat })
      }
    }
  }
  // スペ3返し: ジョーカーを流して同じ人が出し直し(8切りと同じ扱い)
  if (res.spade3) {
    st.field = null
    ev.push({ t: 'clear', spade3: true })
    st.turn = me.out ? nextActive(st.players, seat) : seat
    return finishDfIfOver(st, ev)
  }
  if (isKiri) {
    st.field = null
    ev.push({ t: 'clear', kiri: true })
    st.turn = me.out ? nextActive(st.players, seat) : seat
    return finishDfIfOver(st, ev)
  }
  st.turn = nextActive(st.players, seat)
  return finishDfIfOver(st, ev)
}

function afterDfAction(st, seat, ev) {
  // パス後: lastPlayer以外の全アクティブがパス済みなら場が流れる
  const others = st.players
    .map((p, i) => i)
    .filter((i) => !st.players[i].out && i !== st.lastPlayer)
  const allPassed = others.every((i) => st.passed[i])
  if (allPassed) {
    // 流れる直前の場と「誰がパスしていたか」を演出用に残す(UIが一瞬見せてから流す)
    const shownCards = st.field?.cards || null
    const passedSeats = st.passed.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
    st.field = null
    st.passed = st.players.map(() => false)
    st.turn = st.lastPlayer !== null && !st.players[st.lastPlayer].out
      ? st.lastPlayer
      : nextActive(st.players, st.lastPlayer ?? seat)
    ev.push({ t: 'clear', cards: shownCards, passedSeats })
  } else {
    // 次のパスしていないアクティブへ
    let c = seat
    for (let i = 1; i <= st.players.length; i++) {
      c = (seat + i) % st.players.length
      if (!st.players[c].out && !st.passed[c]) break
    }
    st.turn = c
  }
  return finishDfIfOver(st, ev)
}

function finishDfIfOver(st, ev) {
  if (activeCount(st.players) <= 1) {
    const last = st.players.find((p) => !p.out)
    if (last) { last.out = true; last.rank = st.rankNext++ }
    st.phase = 'ended'
    st.result = {
      ranking: st.players
        .map((p, i) => ({ seat: i, name: p.name, rank: p.rank, foul: p.foul || null }))
        .sort((a, b) => a.rank - b.rank),
    }
    ev.push({ t: 'end' })
  }
  return { state: st, events: ev }
}

// その手を出すと反則上がりになるか(手札を出し切る場合のみ判定)
export function dfIsFoulFinish(state, seat, cards) {
  if (state.players[seat].hand.length !== cards.length) return false
  const topRank = state.revolution ? 3 : 2
  return cards.some((c) => c.joker) || cards.some((c) => !c.joker && c.r === topRank)
    || cards.some((c) => !c.joker && c.r === 8)
}

export function npcDaifugo(state, seat) {
  const me = state.players[seat]
  const groups = {}
  for (const c of me.hand) {
    if (c.joker) continue
    ;(groups[c.r] = groups[c.r] || []).push(c)
  }
  const jokers = me.hand.filter((c) => c.joker)
  const sorted = Object.values(groups).sort((a, b) => dfStrength(a[0].r) - dfStrength(b[0].r))
  const ordered = state.revolution ? [...sorted].reverse() : sorted
  // 反則上がりになる手は避ける(他に手があるうちは選ばない)
  const okFinish = (cards) => !dfIsFoulFinish(state, seat, cards)
  if (!state.field) {
    // リード: いちばん弱いグループを全部出す(革命は狙わない=最大3枚)
    for (const g of ordered) {
      const cards = g.slice(0, 3)
      if (okFinish(cards)) return { type: 'play', cardIds: cards.map((c) => c.id) }
      if (g.length > 1 && okFinish(g.slice(0, 1))) return { type: 'play', cardIds: [g[0].id] }
    }
    if (jokers.length && okFinish([jokers[0]])) return { type: 'play', cardIds: [jokers[0].id] }
    // 反則しかない場合は仕方なく最弱を出す
    const g = ordered[0]
    if (g) return { type: 'play', cardIds: g.slice(0, 3).map((c) => c.id) }
    if (jokers.length) return { type: 'play', cardIds: [jokers[0].id] }
    return { type: 'pass' }
  }
  // スペ3返し: ジョーカー単騎が場にあれば♠3で返す
  const spade3 = me.hand.find((c) => !c.joker && c.s === 0 && c.r === 3)
  if (spade3 && dfSetStrength([spade3], state.field, state.revolution, state.rules)?.spade3
      && okFinish([spade3])) {
    return { type: 'play', cardIds: [spade3.id] }
  }
  const fallbacks = []
  for (const g of ordered) {
    if (g.length >= state.field.count) {
      const cards = g.slice(0, state.field.count)
      if (dfSetStrength(cards, state.field, state.revolution, state.rules) !== null) {
        if (okFinish(cards)) return { type: 'play', cardIds: cards.map((c) => c.id) }
        fallbacks.push(cards)
      }
    }
  }
  if (jokers.length && state.field.count === 1 &&
      dfSetStrength([jokers[0]], state.field, state.revolution, state.rules) !== null) {
    if (okFinish([jokers[0]])) return { type: 'play', cardIds: [jokers[0].id] }
    fallbacks.push([jokers[0]])
  }
  // 出せる手が反則上がりだけなら、パスできる場面ではパスを選ぶ
  if (fallbacks.length > 0 && !state.field) return { type: 'play', cardIds: fallbacks[0].map((c) => c.id) }
  return { type: 'pass' }
}

// ============================================================
// 7ならべ (ジョーカーなし・パス3回まで/4回目でバースト=手札全公開配置)
// ============================================================
export function createSevens(playersIn) {
  const deck = makeDeck(false)
  const players = playersIn.map((p) => ({ id: p.id, name: p.name, hand: [], out: false, rank: 0, passes: 0 }))
  let i = 0
  while (deck.length > 0) { players[i % players.length].hand.push(deck.pop()); i++ }
  const placed = [0, 1, 2, 3].map(() => new Array(14).fill(false)) // 1..13
  let starter = 0
  players.forEach((p, idx) => {
    if (p.hand.some((c) => c.s === 2 && c.r === 7)) starter = idx // ♦7の持ち主が先手
    p.hand = p.hand.filter((c) => {
      if (c.r === 7) { placed[c.s][7] = true; return false }
      return true
    })
    p.hand.sort((a, b) => a.s - b.s || a.r - b.r)
  })
  const st = {
    mode: 'sevens', players, placed, turn: starter,
    finished: [], bursted: [], phase: 'playing', result: null,
  }
  // 7を4枚持っていた等で初手から手札0の場合
  players.forEach((p, idx) => { if (p.hand.length === 0) { p.out = true; st.finished.push(idx) } })
  if (players[starter].out) st.turn = nextActive(players, starter)
  return finishSevensIfOver(st, []).state
}

export const sevensPlayable = (st, card) =>
  (card.r < 7 && st.placed[card.s][card.r + 1]) || (card.r > 7 && st.placed[card.s][card.r - 1])

export function applySevens(state, playerId, action) {
  const st = clone(state)
  const seat = st.players.findIndex((p) => p.id === playerId)
  if (seat === -1) return { error: '対局者ではありません' }
  if (st.phase !== 'playing') return { error: 'ゲームは終了しています' }
  if (st.turn !== seat) return { error: 'あなたの番ではありません' }
  const me = st.players[seat]
  const ev = []

  if (action.type === 'pass') {
    me.passes++
    if (me.passes > 3) {
      // バースト: 手札を全部場に置いて脱落
      for (const c of me.hand) st.placed[c.s][c.r] = true
      me.hand = []
      me.out = true
      st.bursted.push(seat)
      ev.push({ t: 'burst', seat })
    } else {
      ev.push({ t: 'pass', seat, left: 3 - me.passes })
    }
  } else if (action.type === 'play') {
    const card = me.hand.find((c) => c.id === action.cardId)
    if (!card) return { error: 'その札は持っていません' }
    if (!sevensPlayable(st, card)) return { error: 'そこには置けません' }
    st.placed[card.s][card.r] = true
    me.hand = me.hand.filter((c) => c.id !== card.id)
    ev.push({ t: 'play', seat, card: cardLabel(card) })
    if (me.hand.length === 0) {
      me.out = true
      st.finished.push(seat)
      ev.push({ t: 'out', seat })
    }
  } else return { error: '不明な操作です' }

  st.turn = nextActive(st.players, seat)
  return finishSevensIfOver(st, ev)
}

function finishSevensIfOver(st, ev) {
  if (activeCount(st.players) <= 1) {
    const lastIdx = st.players.findIndex((p) => !p.out)
    if (lastIdx >= 0) { st.players[lastIdx].out = true; st.finished.push(lastIdx) }
    // 順位: あがり順 → バーストの逆順(先にバーストした人が最下位)
    const order = [...st.finished, ...[...st.bursted].reverse()]
    order.forEach((seat, i) => { st.players[seat].rank = i + 1 })
    st.phase = 'ended'
    st.result = { ranking: order.map((seat, i) => ({ seat, name: st.players[seat].name, rank: i + 1, burst: st.bursted.includes(seat) })) }
    if (ev) ev.push({ t: 'end' })
  }
  return { state: st, events: ev || [] }
}

export function npcSevens(state, seat) {
  const me = state.players[seat]
  const playable = me.hand.filter((c) => sevensPlayable(state, c))
  if (playable.length === 0) return { type: 'pass' }
  // 端(A/K)に近い列は後回しにしたいので、7に近い札から出す
  playable.sort((a, b) => Math.abs(a.r - 7) - Math.abs(b.r - 7))
  return { type: 'play', cardId: playable[0].id }
}

// ============================================================
// ババ抜き (53枚・ペアは自動で捨てる・最後にJOKERを持っていた人が最下位)
// ============================================================
function omDiscardPairs(hand) {
  const byRank = {}
  for (const c of hand) {
    if (c.joker) continue
    ;(byRank[c.r] = byRank[c.r] || []).push(c)
  }
  const removeIds = new Set()
  for (const g of Object.values(byRank)) {
    const pairs = Math.floor(g.length / 2) * 2
    for (let i = 0; i < pairs; i++) removeIds.add(g[i].id)
  }
  return hand.filter((c) => !removeIds.has(c.id))
}

export function createOldMaid(playersIn) {
  const deck = makeDeck(true)
  const players = playersIn.map((p) => ({ id: p.id, name: p.name, hand: [], out: false, rank: 0 }))
  let i = 0
  while (deck.length > 0) { players[i % players.length].hand.push(deck.pop()); i++ }
  const st = { mode: 'oldmaid', players, turn: 0, rankNext: 1, phase: 'playing', result: null, lastDraw: null }
  for (const p of players) p.hand = omDiscardPairs(p.hand)
  // 初手で手札が空になった人は即あがり
  players.forEach((p) => { if (p.hand.length === 0) { p.out = true; p.rank = st.rankNext++ } })
  if (players[st.turn].out) st.turn = nextActive(players, st.turn)
  return finishOldMaidIfOver(st, []).state
}

export function applyOldMaid(state, playerId, action) {
  const st = clone(state)
  const seat = st.players.findIndex((p) => p.id === playerId)
  if (seat === -1) return { error: '対局者ではありません' }
  if (st.phase !== 'playing') return { error: 'ゲームは終了しています' }
  // ---- 手札の並べ替え(心理戦用・自分の番でなくても随時できる) ----
  // 他プレイヤーには「どの位置が動いたか」だけが伝わる(中身は見えない)
  if (action.type === 'shuffleMove') {
    const me = st.players[seat]
    if (me.out) return { error: 'すでに上がっています' }
    const from = action.index | 0
    const dir = action.dir === 'right' ? 1 : -1
    const to = from + dir
    if (from < 0 || from >= me.hand.length) return { error: 'その位置に札はありません' }
    if (to < 0 || to >= me.hand.length) return { error: 'これ以上動かせません' }
    const [card] = me.hand.splice(from, 1)
    me.hand.splice(to, 0, card)
    return { state: st, events: [{ t: 'shuffleMove', seat, from, to }] }
  }
  if (st.turn !== seat) return { error: 'あなたの番ではありません' }
  if (action.type !== 'draw') return { error: '不明な操作です' }
  const target = nextActive(st.players, seat)
  if (target === -1) return { error: '引く相手がいません' }
  const tHand = st.players[target].hand
  const idx = Math.max(0, Math.min(tHand.length - 1, action.index | 0))
  const drawn = tHand.splice(idx, 1)[0]
  const me = st.players[seat]
  const ev = [{ t: 'draw', seat, from: target }]
  const pair = !drawn.joker && me.hand.find((c) => !c.joker && c.r === drawn.r)
  if (pair) {
    me.hand = me.hand.filter((c) => c.id !== pair.id)
    ev.push({ t: 'discard', seat, cards: [cardLabel(drawn), cardLabel(pair)] })
  } else {
    me.hand.push(drawn)
  }
  st.lastDraw = { seat, pair: !!pair }
  // あがり判定(引かれた側→引いた側の順)
  if (st.players[target].hand.length === 0 && !st.players[target].out) {
    st.players[target].out = true
    st.players[target].rank = st.rankNext++
    ev.push({ t: 'out', seat: target, rank: st.players[target].rank })
  }
  if (me.hand.length === 0 && !me.out) {
    me.out = true
    me.rank = st.rankNext++
    ev.push({ t: 'out', seat, rank: me.rank })
  }
  // 手番は引かれた人へ(あがっていれば次のアクティブ)
  st.turn = !st.players[target].out ? target : nextActive(st.players, target)
  return finishOldMaidIfOver(st, ev)
}

function finishOldMaidIfOver(st, ev) {
  if (activeCount(st.players) <= 1) {
    const last = st.players.find((p) => !p.out)
    if (last) { last.out = true; last.rank = st.rankNext++ }
    st.phase = 'ended'
    st.result = { ranking: st.players.map((p, i) => ({ seat: i, name: p.name, rank: p.rank })).sort((a, b) => a.rank - b.rank) }
    if (ev) ev.push({ t: 'end' })
  }
  return { state: st, events: ev || [] }
}

export const npcOldMaid = (state, seat) => {
  const target = nextActive(state.players, seat)
  const len = state.players[target]?.hand.length || 1
  return { type: 'draw', index: Math.floor(Math.random() * len) }
}

// ============================================================
// スピード (2人・リアルタイム。台札の±1(A-K循環)に出す。両者出せなければ山からめくる)
// ============================================================
export function createSpeed(playersIn) {
  const deck = makeDeck(false)
  const black = deck.filter((c) => c.s === 0 || c.s === 3)
  const red = deck.filter((c) => c.s === 1 || c.s === 2)
  const players = playersIn.map((p, i) => {
    const stock = i === 0 ? black : red
    const slots = [stock.pop(), stock.pop(), stock.pop(), stock.pop()]
    return { id: p.id, name: p.name, slots, stock }
  })
  const piles = [players[0].stock.pop(), players[1].stock.pop()]
  return { mode: 'speed', players, piles, phase: 'playing', result: null, flipSeq: 0 }
}

const speedAdj = (a, b) => {
  const d = Math.abs(a - b)
  return d === 1 || d === 12
}
export function speedCanAnyPlay(st) {
  for (const p of st.players) {
    for (const c of p.slots) {
      if (c && st.piles.some((t) => t && speedAdj(c.r, t.r))) return true
    }
  }
  return false
}
const speedCardsLeft = (p) => p.slots.filter(Boolean).length + p.stock.length

export function applySpeed(state, playerId, action) {
  const st = clone(state)
  const seat = st.players.findIndex((p) => p.id === playerId)
  if (st.phase !== 'playing') return { error: 'ゲームは終了しています' }
  const ev = []

  if (action.type === 'flip') {
    // 手詰まり時に山からめくる(ホストが呼ぶ。観戦者の乱用防止に手詰まりを必須条件にする)
    if (speedCanAnyPlay(st)) return { error: 'まだ出せる札があります' }
    let flipped = false
    st.players.forEach((p, i) => {
      if (p.stock.length > 0) { st.piles[i] = p.stock.pop(); flipped = true }
    })
    st.flipSeq++
    if (!flipped) {
      // 両者めくれない → 残り枚数勝負
      const a = speedCardsLeft(st.players[0]), b = speedCardsLeft(st.players[1])
      st.phase = 'ended'
      st.result = { winner: a === b ? null : (a < b ? 0 : 1), reason: 'stuck', left: [a, b] }
      ev.push({ t: 'end' })
    } else ev.push({ t: 'flip' })
    return { state: st, events: ev }
  }

  if (seat === -1) return { error: '対局者ではありません' }
  if (action.type !== 'play') return { error: '不明な操作です' }
  const me = st.players[seat]
  const card = me.slots[action.slot]
  if (!card) return { error: 'その場所に札がありません' }
  const pile = st.piles[action.pile]
  if (!pile || !speedAdj(card.r, pile.r)) return { error: 'そこには出せません' }
  st.piles[action.pile] = card
  me.slots[action.slot] = me.stock.length > 0 ? me.stock.pop() : null
  ev.push({ t: 'play', seat })
  if (speedCardsLeft(me) === 0) {
    st.phase = 'ended'
    st.result = { winner: seat, reason: 'out', left: [speedCardsLeft(st.players[0]), speedCardsLeft(st.players[1])] }
    ev.push({ t: 'end' })
  }
  return { state: st, events: ev }
}

export function npcSpeed(state, seat) {
  const me = state.players[seat]
  for (let s = 0; s < 4; s++) {
    const c = me.slots[s]
    if (!c) continue
    for (let p = 0; p < 2; p++) {
      if (state.piles[p] && speedAdj(c.r, state.piles[p].r)) return { type: 'play', slot: s, pile: p }
    }
  }
  return null
}

// ============================================================
// 共通ディスパッチ
// ============================================================
export function createTrumpGame(gameType, players, opts = {}) {
  if (gameType === 'daifugo') return createDaifugo(players, opts.rules || {}, opts.champion || null, opts.prevRanking || null)
  if (gameType === 'speed') return createSpeed(players)
  if (gameType === 'sevens') return createSevens(players)
  if (gameType === 'oldmaid') return createOldMaid(players)
  throw new Error('unknown game')
}
export function applyTrump(state, playerId, action) {
  // 不正なactionでホストの進行が止まらないよう例外は必ず{error}に変換する
  try {
    if (!action || typeof action !== 'object') return { error: '不正な操作です' }
    if (state.mode === 'daifugo') return applyDaifugo(state, playerId, action)
    if (state.mode === 'speed') return applySpeed(state, playerId, action)
    if (state.mode === 'sevens') return applySevens(state, playerId, action)
    if (state.mode === 'oldmaid') return applyOldMaid(state, playerId, action)
    return { error: 'unknown game' }
  } catch (e) {
    return { error: `エンジンエラー: ${e.message}` }
  }
}
export function npcTrump(state, seat) {
  if (state.mode === 'daifugo' && state.phase === 'exchange') return dfExchangeAuto(state, seat)
  if (state.mode === 'daifugo') return npcDaifugo(state, seat)
  if (state.mode === 'speed') return npcSpeed(state, seat)
  if (state.mode === 'sevens') return npcSevens(state, seat)
  if (state.mode === 'oldmaid') return npcOldMaid(state, seat)
  return null
}
// ターンタイムアウト時の自動行動(スピードは対象外)
export function autoTrump(state, seat) {
  if (state.mode === 'daifugo' && state.phase === 'exchange') return dfExchangeAuto(state, seat)
  if (state.mode === 'oldmaid') return npcOldMaid(state, seat)
  if (state.mode === 'sevens') return npcSevens(state, seat) // 出せなければpass(バーストあり得る)
  if (state.mode === 'daifugo') {
    if (!state.field) return npcDaifugo(state, seat) // リードは必ず出す
    return { type: 'pass' }
  }
  return null
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// 持ち時間切れの手: 出せる手の中からランダムに選ぶ(出せなければパス/自動処理)
export function randomTrump(state, seat) {
  if (state.mode === 'daifugo' && state.phase === 'exchange') return dfExchangeAuto(state, seat)
  if (state.mode === 'oldmaid') return npcOldMaid(state, seat) // 引く位置はもともとランダム
  if (state.mode === 'sevens') {
    const playable = state.players[seat].hand.filter((c) => sevensPlayable(state, c))
    if (playable.length === 0) return { type: 'pass' }
    return { type: 'play', cardId: pick(playable).id }
  }
  if (state.mode === 'speed') {
    const me = state.players[seat]
    const cand = []
    me.slots.forEach((c, s) => {
      if (!c) return
      state.piles.forEach((t, p) => {
        if (t && (Math.abs(c.r - t.r) === 1 || Math.abs(c.r - t.r) === 12)) cand.push({ type: 'play', slot: s, pile: p })
      })
    })
    return cand.length > 0 ? pick(cand) : null
  }
  if (state.mode === 'daifugo') {
    const me = state.players[seat]
    const cands = []
    // 同じ数字の組(1〜4枚)とジョーカー、階段(有効時)から出せる手を集める
    const byRank = {}
    for (const c of me.hand) {
      if (c.joker) continue
      ;(byRank[c.r] = byRank[c.r] || []).push(c)
    }
    const jokers = me.hand.filter((c) => c.joker)
    const tryAdd = (cards) => {
      if (cards.length === 0) return
      if (dfSetStrength(cards, state.field, state.revolution, state.rules) !== null) cands.push(cards)
    }
    for (const g of Object.values(byRank)) {
      for (let n = 1; n <= g.length; n++) tryAdd(g.slice(0, n))
      for (const j of jokers) tryAdd([...g.slice(0, 1), j]) // ジョーカー混ぜの2枚
    }
    for (const j of jokers) tryAdd([j])
    if (state.rules?.kaidan) {
      const bySuit = {}
      for (const c of me.hand) {
        if (c.joker) continue
        ;(bySuit[c.s] = bySuit[c.s] || []).push(c)
      }
      for (const list of Object.values(bySuit)) {
        const sorted = [...list].sort((a, b) => a.r - b.r)
        for (let i = 0; i < sorted.length; i++) {
          for (let len = 3; i + len <= sorted.length; len++) tryAdd(sorted.slice(i, i + len))
        }
      }
    }
    // 反則上がりになる手は最後の手段にする
    const safe = cands.filter((cs) => !dfIsFoulFinish(state, seat, cs))
    if (safe.length > 0) return { type: 'play', cardIds: pick(safe).map((c) => c.id) }
    if (state.field) return { type: 'pass' } // 反則しかないならパス
    if (cands.length > 0) return { type: 'play', cardIds: pick(cands).map((c) => c.id) }
    return { type: 'pass' }
  }
  return null
}
// 勝者(1位)のid。スピードは winner seat。引き分けはnull
// 大富豪マッチの最終順位。合計pt降順 → 同点は最終戦の順位が上の人 → それも同じならid順(決定的)。
// ※表示(最終結果画面)と賭けの分配で必ず同じ順序を使うこと。別々にソートすると
//   「画面の1位」と「払い出しの1位」がズレる。opts.idsで対象を絞れる(NPC/離脱者の除外用)。
export function dfMatchStandings(match, { ids = null } = {}) {
  if (!match || !match.points) return []
  const src = ids || Object.keys(match.points)
  return src.slice()
    .sort((a, b) => ((match.points[b] || 0) - (match.points[a] || 0))
      || ((match.lastRanks?.[a] || 9) - (match.lastRanks?.[b] || 9))
      || String(a).localeCompare(String(b)))
    .map((id, i) => ({ id, rank: i + 1, name: match.names?.[id] || '?', pt: match.points[id] || 0 }))
}

export function trumpWinnerId(state) {
  if (state.phase !== 'ended') return null
  if (state.mode === 'speed') {
    return state.result.winner === null ? null : state.players[state.result.winner].id
  }
  const top = state.result?.ranking?.find((r) => r.rank === 1)
  return top ? state.players[top.seat].id : null
}
