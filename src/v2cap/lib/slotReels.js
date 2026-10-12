// ============================================================
// v2cap 賭博場 — スロットのリールの見え方（画面だけ）
// ------------------------------------------------------------
// ★当たり外れはサーバーがレバーで決める（v2cap_slot_spin の「役」）。ここは「その役に見える止まり方」を選ぶだけ。
//   止めた時の押し方（目押し）で結果は変わらない＝押した所から少し滑って、選んだ位置に止まる
//   ・リール3本 × 21コマ。見えるのは上・中・下の3段。ラインは横3本＋斜め2本
//   ・21³通りの止まり方を、見え方（リプレイ・ベル・スイカ・弱/強チェリー・中段チェリー・チャンス目・ハズレ・777）に分けておく
//   ・押し順ベルは2つ目を止めた時点でベルが「テンパイ」し、3つ目で揃う（正解）か外れる（こぼし）
// ============================================================
export const SYMBOLS = ['7', 'BAR', 'bell', 'suika', 'cherry', 'replay']
export const REEL_LEN = 21
export const REELS = [
  ['7', 'replay', 'bell', 'suika', 'cherry', 'bell', 'replay', 'BAR', 'bell', 'replay', 'cherry', 'bell', 'suika', 'replay', '7', 'bell', 'replay', 'cherry', 'bell', 'replay', 'BAR'],
  ['7', 'bell', 'replay', 'suika', 'bell', 'replay', 'cherry', 'bell', 'BAR', 'replay', 'bell', 'suika', 'replay', 'bell', '7', 'replay', 'bell', 'cherry', 'replay', 'bell', 'suika'],
  ['7', 'bell', 'replay', 'BAR', 'bell', 'replay', 'suika', 'bell', 'replay', 'cherry', 'bell', 'replay', '7', 'bell', 'replay', 'suika', 'bell', 'BAR', 'replay', 'bell', 'replay'],
]
// ライン（リールごとの段：0上・1中・2下）
export const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]]
const mod = (n) => ((n % REEL_LEN) + REEL_LEN) % REEL_LEN
// p＝上の段に見えているコマの番号
export const symbolAt = (reel, p, row) => REELS[reel][mod(p + row)]
export const windowOf = (pos) => [0, 1, 2].map(row => [0, 1, 2].map(reel => symbolAt(reel, pos[reel], row)))

// 止まり方 → 見え方
//   'replay' 'bell' 'suika' … そのラインが1本だけ揃う（ほかに何もない）
//   'wcherry' … 左リールの上か下にチェリー／'scherry' … それに加えて同じラインの中リールにもチェリー
//   'premium' … 左リールの中段にチェリー／'chance' … 7・7・BAR のライン（リーチ目）
//   'seven' … 中段に7が揃う（ATが始まるときの演出用）／'miss' … 何もない／'mixed' … 使わない
export const classOf = (pos) => {
  const w = windowOf(pos)
  const wins = []
  let chance = false
  for (const line of LINES) {
    const s = line.map((row, reel) => w[row][reel])
    if (s[0] === s[1] && s[1] === s[2]) wins.push({ sym: s[0], line })
    if (s[0] === '7' && s[1] === '7' && s[2] === 'BAR') chance = true
  }
  const leftCherryRow = [0, 1, 2].filter(row => w[row][0] === 'cherry')
  const anyCherry = leftCherryRow.length > 0
  if (wins.length === 1 && !anyCherry && !chance) {
    const { sym, line } = wins[0]
    if (sym === 'replay' || sym === 'bell' || sym === 'suika') return sym
    if (sym === '7' && line.every(r => r === 1)) return 'seven'
    return 'mixed'
  }
  if (wins.length > 0) return 'mixed'
  if (anyCherry) {
    if (leftCherryRow.length !== 1) return 'mixed'
    const r = leftCherryRow[0]
    if (chance) return 'mixed'
    if (r === 1) return 'premium'
    // 角チェリーから伸びるライン（上段なら上・右下がり／下段なら下・右上がり）の中リールにもチェリー
    const strong = w[r][1] === 'cherry' || w[1][1] === 'cherry'
    return strong ? 'scherry' : 'wcherry'
  }
  return chance ? 'chance' : 'miss'
}

// 役（サーバーの key）→ 見え方
export const DISPLAY_OF_ROLE = {
  replay:'replay', obell:'bell', cbell:'bell', wcherry:'wcherry', scherry:'scherry',
  suika:'suika', chance:'chance', premium:'premium', miss:'miss',
}

let TABLE = null
// 21³通りを一度だけ分ける
export const displayTable = () => {
  if (TABLE) return TABLE
  const buckets = {}
  for (let a = 0; a < REEL_LEN; a++) for (let b = 0; b < REEL_LEN; b++) for (let c = 0; c < REEL_LEN; c++) {
    const pos = [a, b, c]
    const k = classOf(pos)
    ;(buckets[k] ||= []).push(pos)
  }
  // 押し順ベル用：どのリールを最後に止めても、そのリールだけ動かせば「何もない」にできるベルの止まり方
  const bellTenpai = (buckets.bell || []).filter(pos => [0, 1, 2].every(j => missCompletionsOf(pos, j).length > 0))
  TABLE = { buckets, bellTenpai }
  return TABLE
}
// pos のうちリール j だけ動かして「何もない（こぼし）」にできる位置の一覧
export const missCompletionsOf = (pos, j) => {
  const out = []
  for (let p = 0; p < REEL_LEN; p++) {
    if (p === pos[j]) continue
    const q = [...pos]; q[j] = p
    if (classOf(q) === 'miss') out.push(p)
  }
  return out
}
const pickOf = (list, rng) => list[Math.floor(rng() * list.length) % list.length]

// 見え方 → 止まり方を1つ選ぶ
export const pickStops = (display, rng = Math.random) => {
  const t = displayTable()
  const list = display === 'bell' ? t.bellTenpai : t.buckets[display]
  if (!list || !list.length) return pickOf(t.buckets.miss, rng)
  return [...pickOf(list, rng)]
}
// 押し順ベルを外したとき：最後に止めたリール j だけ「こぼし」の位置にする
export const missStopsOf = (pos, j, rng = Math.random) => {
  const c = missCompletionsOf(pos, j)
  if (!c.length) return [...pos]
  const q = [...pos]; q[j] = pickOf(c, rng)
  return q
}
// ===== 予告（レバーを引いたときの演出）=====
//   サーバーの返事（役・CZ/AT）から、色の段階を選ぶ。0なし・1青・2緑・3赤・4金・5虹
//   ★虹は「AT確定」のときだけ（ウソをつかない確定演出）。強いほど当たりやすい（期待度）
export const NOTICE_LEVELS = [
  null,
  { text:'チャンス', color:'#33a0ff' },
  { text:'チャンス!', color:'#33dd77' },
  { text:'激アツ!!', color:'#ff3355' },
  { text:'超激アツ!!!', color:'#ffcc00' },
  { text:'確定!!', color:'rainbow' },
]
const NOTICE_TABLE = {
  at:     [5, 5, 15, 35, 25, 15],   // AT直撃・CZ成功
  cz:     [15, 15, 30, 30, 10, 0],  // CZ突入
  strong: [20, 20, 30, 25, 5, 0],   // 強チェリー・チャンス目（外れ）・AT中の上乗せ
  weak:   [45, 30, 20, 5, 0, 0],    // 弱チェリー・スイカ（外れ）
  czmiss: [30, 30, 25, 15, 0, 0],   // CZ中の外れ（あおり）
  none:   [94, 5, 1, 0, 0, 0],
}
export const noticeKindOf = (res) => {
  if (!res) return 'none'
  if (res.at_in) return 'at'
  if (res.cz_in) return 'cz'
  if (res.mode_before === 'at' && (res.add > 0 || res.toku_in || res.toku_add >= 30)) return 'strong'
  if (res.role === 'scherry' || res.role === 'chance') return 'strong'
  if (res.role === 'wcherry' || res.role === 'suika') return 'weak'
  if (res.mode_before === 'cz') return 'czmiss'
  return 'none'
}
export const noticeLevelOf = (res, rng = Math.random) => {
  const t = NOTICE_TABLE[noticeKindOf(res)]
  const total = t.reduce((a, b) => a + b, 0)
  let x = rng() * total
  for (let i = 0; i < t.length; i++) { x -= t[i]; if (x < 0) return i }
  return 0
}
export const NOTICE_TABLE_FOR_TEST = NOTICE_TABLE

// 揃ったラインの位置（光らせる用）。[{ line, sym }]
export const winLinesOf = (pos) => {
  const w = windowOf(pos)
  return LINES.map(line => ({ line, sym: line.map((row, reel) => w[row][reel]) }))
    .filter(x => x.sym[0] === x.sym[1] && x.sym[1] === x.sym[2])
    .map(x => ({ line: x.line, sym: x.sym[0] }))
}
