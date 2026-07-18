// ============================================================
// オセロ(リバーシ) 純粋ロジック — UI非依存
// 盤面: 8x8 の一次元配列(長さ64)。0=空 / 1=黒 / 2=白
// ============================================================

export const SIZE = 8
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

const DIRS = [-9, -8, -7, -1, 1, 7, 8, 9]

export function createBoard() {
  const b = new Array(SIZE * SIZE).fill(EMPTY)
  b[27] = WHITE; b[28] = BLACK
  b[35] = BLACK; b[36] = WHITE
  return b
}

export const opponent = (color) => (color === BLACK ? WHITE : BLACK)

// idxにcolorを置いたときに裏返る石のindex一覧(置けないなら空配列)
// 盤外/端の折り返しは「1歩ごとにx座標の差が1以内」かで検出する
export function flipsFor(board, idx, color) {
  if (board[idx] !== EMPTY) return []
  const opp = opponent(color)
  const flips = []
  for (const dir of DIRS) {
    const line = []
    let prev = idx
    let cur = idx + dir
    while (true) {
      // 折り返し判定: prevから見てdir方向に正しく隣接しているか
      const px = prev % SIZE, cx = cur % SIZE
      if (cur < 0 || cur >= SIZE * SIZE || Math.abs(cx - px) > 1) break
      if (board[cur] === opp) { line.push(cur); prev = cur; cur += dir; continue }
      if (board[cur] === color && line.length > 0) flips.push(...line)
      break
    }
  }
  return flips
}

export function validMoves(board, color) {
  const moves = []
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (board[i] === EMPTY && flipsFor(board, i, color).length > 0) moves.push(i)
  }
  return moves
}

// 着手を適用した新しい盤面を返す(不正手はnull)
export function applyMove(board, idx, color) {
  const flips = flipsFor(board, idx, color)
  if (flips.length === 0) return null
  const next = board.slice()
  next[idx] = color
  for (const f of flips) next[f] = color
  return next
}

export function countStones(board) {
  let black = 0, white = 0
  for (const c of board) {
    if (c === BLACK) black++
    else if (c === WHITE) white++
  }
  return { black, white }
}

// 両者打てなければ終局
export function isGameOver(board) {
  return validMoves(board, BLACK).length === 0 && validMoves(board, WHITE).length === 0
}

// ---- CPU思考(シンプル) ----
// 角>辺>通常の位置重み + 裏返し数。角の隣(X/C打点)は減点
const WEIGHTS = (() => {
  const w = new Array(64).fill(1)
  const set = (x, y, v) => { w[y * SIZE + x] = v }
  // 角
  for (const [x, y] of [[0, 0], [7, 0], [0, 7], [7, 7]]) set(x, y, 30)
  // 角の斜め隣(X)
  for (const [x, y] of [[1, 1], [6, 1], [1, 6], [6, 6]]) set(x, y, -12)
  // 角の縦横隣(C)
  for (const [x, y] of [[1, 0], [0, 1], [6, 0], [7, 1], [0, 6], [1, 7], [7, 6], [6, 7]]) set(x, y, -6)
  // 辺
  for (let i = 2; i <= 5; i++) { set(i, 0, 4); set(i, 7, 4); set(0, i, 4); set(7, i, 4) }
  return w
})()

// ============================================================
// 対戦用ゲームステート(シリアライズ可能・ホスト権威型で配信する)
// players: { [BLACK]: {id,name}, [WHITE]: {id,name} }
// ============================================================

export const isNpcId = (id) => typeof id === 'string' && id.startsWith('npc-')

export function createGame({ black, white }) {
  return {
    board: createBoard(),
    turn: BLACK,
    players: { [BLACK]: black, [WHITE]: white },
    lastMove: null,
    phase: 'playing', // playing | ended
    result: null,     // { black, white, winner(BLACK|WHITE|null), forfeit? }
  }
}

export function colorOf(state, playerId) {
  if (state.players[BLACK]?.id === playerId) return BLACK
  if (state.players[WHITE]?.id === playerId) return WHITE
  return null
}

// 着手を検証して適用。成功: { state, events } / 失敗: { error }
export function applyGameMove(state, playerId, idx) {
  if (state.phase !== 'playing') return { error: 'ゲームは終了しています' }
  const color = colorOf(state, playerId)
  if (!color) return { error: '対局者ではありません' }
  if (color !== state.turn) return { error: 'あなたの番ではありません' }
  const board = applyMove(state.board, idx, color)
  if (!board) return { error: 'そこには置けません' }

  const events = []
  const next = { ...state, board, lastMove: idx }
  const opp = opponent(color)
  if (isGameOver(board)) {
    const { black, white } = countStones(board)
    next.phase = 'ended'
    next.result = { black, white, winner: black > white ? BLACK : white > black ? WHITE : null }
  } else if (validMoves(board, opp).length > 0) {
    next.turn = opp
  } else {
    next.turn = color
    events.push({ t: 'pass', name: state.players[opp]?.name || '?' })
  }
  return { state: next, events }
}

// 切断/降参: 相手の勝ち(対局者でない・終局済みならnull)
export function forfeitGame(state, playerId) {
  if (state.phase !== 'playing') return null
  const color = colorOf(state, playerId)
  if (!color) return null
  const { black, white } = countStones(state.board)
  return { ...state, phase: 'ended', result: { black, white, winner: opponent(color), forfeit: true } }
}

// ============================================================
// 多人数オセロ(3〜5人): 人数が1人増えるごとに盤が縦横+1マス
// 3人=9x9 / 4人=10x10 / 5人=11x11。石の色は 1..人数
// ルール(Rolit式): 挟める手があればそこにしか置けない。
// 挟める手が1つもない場合のみ、既存の石に隣接する空きマスへ置ける。
// これにより盤が埋まるまで全員が必ず打てる(パスなし)。終局=盤面が埋まる or 全員手詰まり
// ============================================================

export const MAX_MULTI_PLAYERS = 5
export const multiBoardSize = (playerCount) => 8 + Math.max(0, playerCount - 2)

// 任意サイズの位置重み(角/X/C/辺)
const weightsCache = {}
export function weightsFor(size) {
  if (weightsCache[size]) return weightsCache[size]
  const w = new Array(size * size).fill(1)
  const set = (x, y, v) => { w[y * size + x] = v }
  const e = size - 1
  for (const [x, y] of [[0, 0], [e, 0], [0, e], [e, e]]) set(x, y, 30)
  for (const [x, y] of [[1, 1], [e - 1, 1], [1, e - 1], [e - 1, e - 1]]) set(x, y, -12)
  for (const [x, y] of [[1, 0], [0, 1], [e - 1, 0], [e, 1], [0, e - 1], [1, e], [e, e - 1], [e - 1, e]]) set(x, y, -6)
  for (let i = 2; i <= e - 2; i++) { set(i, 0, 4); set(i, e, 4); set(0, i, 4); set(e, i, 4) }
  weightsCache[size] = w
  return w
}

// 自分以外の色(混色可)の列を自分の石で挟んだら裏返る
export function flipsForMulti(board, size, idx, color) {
  if (board[idx] !== EMPTY) return []
  const dirs = [-size - 1, -size, -size + 1, -1, 1, size - 1, size, size + 1]
  const flips = []
  for (const dir of dirs) {
    const line = []
    let prev = idx
    let cur = idx + dir
    while (true) {
      const px = prev % size, cx = cur % size
      if (cur < 0 || cur >= size * size || Math.abs(cx - px) > 1) break
      const v = board[cur]
      if (v === EMPTY) break
      if (v !== color) { line.push(cur); prev = cur; cur += dir; continue }
      if (line.length > 0) flips.push(...line)
      break
    }
  }
  return flips
}

// 合法手: 挟める手があればそれのみ。なければ石に隣接する空きマス
// protectColors(生存プレイヤーの色一覧)を渡すと「他プレイヤーの石を0個にする手」を除外する。
// 全滅させる手しか無い場合のみ許可(手詰まり防止)。全滅からの復帰石も同ルールで自動的に守られる。
export function legalMovesMulti(board, size, color, protectColors = null) {
  const caps = []
  for (let i = 0; i < size * size; i++) {
    if (board[i] === EMPTY && flipsForMulti(board, size, i, color).length > 0) caps.push(i)
  }
  if (caps.length > 0) {
    if (protectColors && protectColors.length > 0) {
      const counts = countsByColor(board)
      // 既に0個のプレイヤーは保護対象から外す(全手が「0個のまま」判定になり保護が壊れるため)
      const alive = protectColors.filter((c) => c !== color && (counts[c] || 0) > 0)
      if (alive.length > 0) {
        const safe = caps.filter((m) => {
          const flipped = {}
          for (const f of flipsForMulti(board, size, m, color)) {
            flipped[board[f]] = (flipped[board[f]] || 0) + 1
          }
          return !alive.some((c) => (counts[c] || 0) - (flipped[c] || 0) <= 0)
        })
        if (safe.length > 0) return { moves: safe, capture: true }
      }
    }
    return { moves: caps, capture: true }
  }
  const dirs = [-size - 1, -size, -size + 1, -1, 1, size - 1, size, size + 1]
  const adj = []
  for (let i = 0; i < size * size; i++) {
    if (board[i] !== EMPTY) continue
    const ix = i % size
    for (const dir of dirs) {
      const j = i + dir
      const jx = j % size
      if (j < 0 || j >= size * size || Math.abs(jx - ix) > 1) continue
      if (board[j] !== EMPTY) { adj.push(i); break }
    }
  }
  return { moves: adj, capture: false }
}

export function countsByColor(board) {
  const counts = {}
  for (const v of board) { if (v !== EMPTY) counts[v] = (counts[v] || 0) + 1 }
  return counts
}

// playersList: [{id,name}] 3〜5人・並び順=手番順。色は 1..n を順に割り当て
export function createMultiGame(playersList) {
  const n = playersList.length
  const size = multiBoardSize(n)
  const board = new Array(size * size).fill(EMPTY)
  const c = Math.floor(size / 2)
  // 初期配置は1人2個の2段ブロック(上段=手番順/下段=逆順)。
  // 旧配置(1人1個)は開始直後に単独石が挟まれて即全滅する欠陥があった
  const x0 = c - Math.floor(n / 2)
  const players = playersList.map((p, i) => ({ id: p.id, name: p.name, color: i + 1, left: false }))
  players.forEach((p, i) => {
    board[(c - 1) * size + (x0 + i)] = p.color
    board[c * size + (x0 + (n - 1 - i))] = p.color
  })
  return {
    mode: 'multi', size, board, players,
    turnIdx: 0, lastMove: null, phase: 'playing', result: null,
  }
}

// 現手番の「次」に打てるプレイヤーのindex(いなければ-1=終局)
function nextTurnIdxMulti(state, board) {
  const n = state.players.length
  for (let step = 1; step <= n; step++) {
    const cand = (state.turnIdx + step) % n
    const p = state.players[cand]
    if (p.left) continue
    if (legalMovesMulti(board, state.size, p.color).moves.length > 0) return cand
  }
  return -1
}

function endMulti(state) {
  const counts = countsByColor(state.board)
  const standings = state.players
    .map((p) => ({ name: p.name, color: p.color, count: counts[p.color] || 0, left: p.left }))
    .sort((a, b) => (a.left !== b.left) ? (a.left ? 1 : -1) : b.count - a.count)
  const activeTop = standings.filter((s) => !s.left)
  const top = activeTop.length > 0 ? activeTop[0].count : -1
  const winners = activeTop.filter((s) => s.count === top).map((s) => s.color)
  return { ...state, phase: 'ended', result: { standings, winners } }
}

export function applyMultiMove(state, playerId, idx) {
  if (state.phase !== 'playing') return { error: 'ゲームは終了しています' }
  const cur = state.players[state.turnIdx]
  if (!cur || cur.id !== playerId) {
    if (!state.players.some((p) => p.id === playerId)) return { error: '対局者ではありません' }
    return { error: 'あなたの番ではありません' }
  }
  const protect = state.players.filter((p) => !p.left).map((p) => p.color)
  const { moves, capture } = legalMovesMulti(state.board, state.size, cur.color, protect)
  if (!moves.includes(idx)) return { error: 'そこには置けません' }
  const board = state.board.slice()
  board[idx] = cur.color
  if (capture) { for (const f of flipsForMulti(state.board, state.size, idx, cur.color)) board[f] = cur.color }
  let next = { ...state, board, lastMove: idx }
  const ni = nextTurnIdxMulti(next, board)
  if (ni === -1) next = endMulti(next)
  else next.turnIdx = ni
  return { state: next, events: [] }
}

// 切断: 以後の手番をスキップ(石は盤に残る)。残り1人になったら終局
export function multiPlayerLeft(state, playerId) {
  if (state.phase !== 'playing') return null
  const leaving = state.players.find((p) => p.id === playerId && !p.left)
  if (!leaving) return null
  const players = state.players.map((p) => (p.id === playerId ? { ...p, left: true } : p))
  let next = { ...state, players }
  if (players.filter((p) => !p.left).length <= 1) return endMulti(next)
  if (state.players[state.turnIdx].id === playerId) {
    const ni = nextTurnIdxMulti(next, next.board)
    if (ni === -1) return endMulti(next)
    next.turnIdx = ni
  }
  return next
}

// 多人数用CPU: 1=ランダム / 2=裏返し最大 / 3以上=位置重み＋裏返し数の欲張り
export function cpuChooseMoveMulti(state, level = 3) {
  const cur = state.players[state.turnIdx]
  if (!cur) return null
  const protect = state.players.filter((p) => !p.left).map((p) => p.color)
  const { moves, capture } = legalMovesMulti(state.board, state.size, cur.color, protect)
  if (moves.length === 0) return null
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)]
  const w = weightsFor(state.size)
  let best = [], bestScore = -Infinity
  for (const m of moves) {
    const flips = capture ? flipsForMulti(state.board, state.size, m, cur.color).length : 0
    const score = level === 2 ? flips : w[m] + flips * 0.5
    if (score > bestScore) { bestScore = score; best = [m] }
    else if (score === bestScore) best.push(m)
  }
  return best[Math.floor(Math.random() * best.length)]
}

// 位置重みだけの1手読み(LV3相当)
function chooseByWeights(board, color) {
  const moves = validMoves(board, color)
  if (moves.length === 0) return null
  let best = []
  let bestScore = -Infinity
  for (const m of moves) {
    const score = WEIGHTS[m] + flipsFor(board, m, color).length * 0.5
    if (score > bestScore) { bestScore = score; best = [m] }
    else if (score === bestScore) best.push(m)
  }
  return best[Math.floor(Math.random() * best.length)]
}

// ---- 評価関数(探索用・colorから見たスコア) ----
// 位置重み + 着手可能数(機動力) + 終盤は石数差
function evaluate(board, color) {
  const opp = opponent(color)
  let pos = 0, empties = 0
  for (let i = 0; i < 64; i++) {
    if (board[i] === color) pos += WEIGHTS[i]
    else if (board[i] === opp) pos -= WEIGHTS[i]
    else empties++
  }
  const mob = validMoves(board, color).length - validMoves(board, opp).length
  let disc = 0
  if (empties < 16) {
    const { black, white } = countStones(board)
    disc = color === BLACK ? black - white : white - black
  }
  return pos * 2 + mob * 6 + disc * 4
}

// 終局時の確定スコア(勝敗が評価値を必ず支配する大きさ)
function terminalScore(board, color) {
  const { black, white } = countStones(board)
  const diff = color === BLACK ? black - white : white - black
  return diff * 10000
}

class SearchTimeout extends Error {}

// negamax + αβ枝刈り。深さが残り空きマス以上なら自動的に完全読みになる
function negamax(board, color, depth, alpha, beta, ctx) {
  if ((++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) throw new SearchTimeout()
  const moves = validMoves(board, color)
  if (moves.length === 0) {
    if (validMoves(board, opponent(color)).length === 0) return terminalScore(board, color)
    return -negamax(board, opponent(color), depth, -beta, -alpha, ctx) // パス(深さ据置)
  }
  if (depth <= 0) return evaluate(board, color)
  moves.sort((a, b) => WEIGHTS[b] - WEIGHTS[a]) // 枝刈り効率のため良さそうな手から
  let best = -Infinity
  for (const m of moves) {
    const score = -negamax(applyMove(board, m, color), opponent(color), depth - 1, -beta, -alpha, ctx)
    if (score > best) best = score
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

// 反復深化: 時間内に読み切れた最深の結果を返す
function searchBestMove(board, color, maxDepth, timeMs) {
  const moves = validMoves(board, color)
  if (moves.length === 0) return null
  if (moves.length === 1) return moves[0]
  moves.sort((a, b) => WEIGHTS[b] - WEIGHTS[a])
  const ctx = { nodes: 0, deadline: Date.now() + timeMs }
  const empties = board.filter((c) => c === EMPTY).length
  let best = moves[0]
  try {
    for (let depth = 1; depth <= Math.min(maxDepth, empties); depth++) {
      let depthBest = null, depthScore = -Infinity
      for (const m of moves) {
        const score = -negamax(applyMove(board, m, color), opponent(color), depth - 1, -Infinity, -depthScore, ctx)
        if (score > depthScore) { depthScore = score; depthBest = m }
      }
      best = depthBest
      // 次の反復で先頭から読むよう最善手を並べ替え
      moves.splice(moves.indexOf(depthBest), 1)
      moves.unshift(depthBest)
    }
  } catch (e) {
    if (!(e instanceof SearchTimeout)) throw e
  }
  return best
}

// ---- CPU着手(強さ1〜9) ----
// 1=ランダム / 2=裏返し最大の欲張り / 3=位置重み1手読み
// 4〜8=αβ探索(深さ2/3/4/5/6) / 9=反復深化で時間いっぱい読む＋終盤は完全読み
const LEVEL_SEARCH = {
  4: { depth: 2, ms: 300 },
  5: { depth: 3, ms: 400 },
  6: { depth: 4, ms: 500 },
  7: { depth: 5, ms: 700 },
  8: { depth: 6, ms: 900 },
  9: { depth: 64, ms: 1400 },
}

export function cpuChooseMove(board, color, level = 3) {
  const moves = validMoves(board, color)
  if (moves.length === 0) return null
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)]
  if (level === 2) {
    let best = [], bestFlips = -1
    for (const m of moves) {
      const n = flipsFor(board, m, color).length
      if (n > bestFlips) { bestFlips = n; best = [m] }
      else if (n === bestFlips) best.push(m)
    }
    return best[Math.floor(Math.random() * best.length)]
  }
  if (level === 3) return chooseByWeights(board, color)
  const cfg = LEVEL_SEARCH[Math.min(level, 9)]
  return searchBestMove(board, color, cfg.depth, cfg.ms)
}
