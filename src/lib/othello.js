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

export function cpuChooseMove(board, color) {
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
