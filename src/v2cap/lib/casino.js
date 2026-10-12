// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 賭博場
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「V2capに無印の時みたいに賭博場を設置したい、新たにルーレットも追加したい。
//   交換所はあと設置するからまずは土台を。スロット・ハイローは昔作ったやつだから改善するところがあれば
//   バージョンアップして。中毒性高く、当たったらドーパミンが大量に出るような演出も」＋選んだこと：
//   ・通貨は**メダル**（この版だけ）。両替所で **100 Gold＝1枚**（前作と同じ）。メダルからGoldへは戻せない
//   ・景品の交換所はあとで作る
//   ・還元率は**どのゲームも約97%**（賭けたメダルが平均で97%戻る）
//   ・スロット＝**AT機で作り直す**（前作はCZ・ATがベットなし＋ナビがそのまま出るので実質160%だった）
//   ・ハイ&ロー＝**連勝はしご**（前作のダブルアップは「8〜A」と「2〜6」で枚数が違った）
//   ・ルーレット＝**ラッキーナンバー付き**（毎回1〜5個の数字に雷・そこへの1点賭けは50〜500倍）
// ★抽選と払い出しはサーバー（SQL §11）。ここは表示・演出・テストのための写し（v2capsql.test.js が表を突き合わせる）
// ============================================================

// ===== 両替所 =====
export const GOLD_PER_MEDAL = 100
export const EXCHANGE_MAX = 1000000   // 1回で替えられるメダルの上限
export const exchangeGoldOf = (medals) => Math.max(0, Math.floor(medals || 0)) * GOLD_PER_MEDAL
export const maxExchangeOf = (gold) => Math.min(EXCHANGE_MAX, Math.floor(Math.max(0, Number(gold) || 0) / GOLD_PER_MEDAL))

// 日付が変わるのは日本時間の5時（デイリー・宝樹と同じ）。当日の収支（day_net）はこの日ごと
export const CASINO_DAY_RESET_HOUR = 5

// ===== 当たりの大きさ（演出の段階）=====
// 払い出しが賭けたメダルの何倍か。WIN → BIG WIN → MEGA WIN → JACKPOT
export const WIN_TIERS = [
  { key:'jackpot', label:'JACKPOT',  min:100, color:'#ff66ff' },
  { key:'mega',    label:'MEGA WIN', min:30,  color:'#ff4466' },
  { key:'big',     label:'BIG WIN',  min:10,  color:'#ffcc00' },
  { key:'win',     label:'WIN',      min:0,   color:'#44ff88' },
]
export const winTierOf = (won, bet) => {
  if (!(won > 0) || !(bet > 0)) return null
  const x = won / bet
  return WIN_TIERS.find(t => x >= t.min) || null
}

// ============================================================
// スロット（AT機）
// ------------------------------------------------------------
//   ・1ゲーム＝3枚 × レート（×1・×10・×100）。CZ・ATの間は入ったときのレートのまま（途中で変えられない）
//   ・レバーで「役」を引く（65536分率）。押し順ベルだけは止めた順番で払い出しが決まる（正解9枚・こぼし1枚）
//   ・通常 → レア役でCZ（10G）かAT直撃。CZはレア役ほど成功しやすい
//   ・AT（40G）はナビどおりに押すと押し順ベルが全部9枚（1Gで約＋2枚）。レア役で上乗せ・特化ゾーン（5G・毎G上乗せ）
//   ・中段チェリー（1/8192）はフリーズ＝AT確定100G（AT中なら＋100G）
//   ・還元率は通常のベルを当てずっぽう（1/6）・ATはナビどおりに押す前提で 96.99%（slotRtp）
// ============================================================
export const SLOT_BET = 3
export const SLOT_RATES = [1, 10, 100]
export const SLOT_TOTAL = 65536
// 並びはサーバーの配列と同じ（1つ目＝SQLの1番）。pay は×1のときの払い出し（枚）
export const SLOT_ROLES = [
  { key:'replay',  name:'リプレイ',     weight:8978,  pay:3 },
  { key:'obell',   name:'押し順ベル',   weight:31457, pay:9 },
  { key:'cbell',   name:'共通ベル',     weight:1820,  pay:9 },
  { key:'wcherry', name:'弱チェリー',   weight:819,   pay:2 },
  { key:'scherry', name:'強チェリー',   weight:273,   pay:2 },
  { key:'suika',   name:'スイカ',       weight:728,   pay:6 },
  { key:'chance',  name:'チャンス目',   weight:328,   pay:0 },
  { key:'premium', name:'中段チェリー', weight:8,     pay:2 },
  { key:'miss',    name:'ハズレ',       weight:21125, pay:0 },
]
export const SLOT_ROLE_BY_KEY = Object.fromEntries(SLOT_ROLES.map((r, i) => [r.key, { ...r, index:i }]))
export const SLOT_MISS_PAY = 1   // 押し順ベルのこぼし
// 通常時：同じ1回の抽選（1000分率）を「AT直撃」「CZ」に分ける（AT＋CZ ≦ 1000）
export const SLOT_NORMAL_AT = { wcherry:10, scherry:200, suika:15, chance:50 }
export const SLOT_NORMAL_CZ = { wcherry:180, scherry:420, suika:220, chance:480, miss:1 }
// CZ：1Gごとの成功（1000分率）
export const SLOT_CZ_GAMES = 10
export const SLOT_CZ_WIN = { replay:35, obell:18, cbell:150, wcherry:500, scherry:1000, suika:500, chance:1000, premium:1000, miss:12 }
// AT
export const SLOT_AT_GAMES = 40
export const SLOT_PREMIUM_GAMES = 100
export const SLOT_AT_ADD = { wcherry:[400, 10], suika:[400, 20], scherry:[1000, 30], premium:[1000, 100] }   // [1000分率, 上乗せG]
export const SLOT_AT_TOKU = { scherry:250, chance:400 }   // 特化ゾーンに入る（1000分率）
export const SLOT_TOKU_GAMES = 5
export const SLOT_TOKU_ADDS = [{ g:10, w:45 }, { g:20, w:30 }, { g:30, w:15 }, { g:50, w:7 }, { g:100, w:3 }]

// 押し順（左0・中1・右2）。サーバーとやりとりするのは並びの番号（0〜5）
export const SLOT_ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
export const orderIndexOf = (seq) => SLOT_ORDERS.findIndex(o => o.every((v, i) => v === seq[i]))

// SQL の配列（役の並び）に直す
export const slotArrayOf = (table, pick = v => v) => SLOT_ROLES.map(r => (r.key in table ? pick(table[r.key]) : 0))

// 還元率（式で出す）。通常のベルは当てずっぽう、ATはナビどおり
export const slotRtp = () => {
  const W = Object.fromEntries(SLOT_ROLES.map(r => [r.key, r.weight / SLOT_TOTAL]))
  const sum = (t, f) => Object.entries(t).reduce((s, [k, v]) => s + W[k] * f(v), 0)
  const rN = SLOT_ROLES.reduce((s, r) => s + W[r.key] * (r.key === 'obell' ? (r.pay + 5 * SLOT_MISS_PAY) / 6 : r.pay), 0)
  const rA = SLOT_ROLES.reduce((s, r) => s + W[r.key] * r.pay, 0)
  const pAt = sum(SLOT_NORMAL_AT, v => v / 1000)
  const pCz = sum(SLOT_NORMAL_CZ, v => v / 1000)
  const s = sum(SLOT_CZ_WIN, v => v / 1000)
  const czSucc = 1 - (1 - s) ** SLOT_CZ_GAMES
  const czGames = czSucc / s
  const eA = sum(SLOT_AT_ADD, ([p, g]) => (p / 1000) * g)
  const zA = sum(SLOT_AT_TOKU, v => v / 1000) * SLOT_TOKU_GAMES
  const tw = SLOT_TOKU_ADDS.reduce((a, x) => a + x.w, 0)
  const eX = SLOT_TOKU_ADDS.reduce((a, x) => a + x.g * x.w / tw, 0)
  // ATの初めのG数 A0 から遊べるG数の平均（上乗せ・特化ゾーンこみ）＝ A0 × G
  const G = (1 + zA) / (1 - (1 + zA) * eA - zA * eX)
  const a0cz = czSucc * ((s - W.premium) / s * SLOT_AT_GAMES + W.premium / s * SLOT_PREMIUM_GAMES)
  const a0 = pAt * SLOT_AT_GAMES + W.premium * SLOT_PREMIUM_GAMES + pCz * a0cz
  const ret = rN + pCz * rN * czGames + a0 * G * rA
  const bet = SLOT_BET + pCz * SLOT_BET * czGames + a0 * G * SLOT_BET
  return {
    rtp: ret / bet,
    normalReturn: rN, atReturn: rA, czSuccess: czSucc, atGamesAvg: SLOT_AT_GAMES * G,
    atEvery: 1 / (pAt + W.premium + pCz * czSucc),   // 通常何Gに1回ATに入るか
  }
}

// ============================================================
// ハイ&ロー（連勝はしご）
// ------------------------------------------------------------
//   ・カードは52枚から毎回1枚（引いたカードは戻す）。強さは 2＜3＜…＜K＜A（スートは関係なし）
//   ・今のカードより「上」か「下」かを当てる。**同じ数字は負け**
//   ・倍率（小数2桁で切り捨て）：**1回目＝0.97 × 13 ÷ 当たりの枚数**（還元率97%）、
//     **2回目から＝13 ÷ 当たりの枚数**（確率どおり＝続けても得も損もしない）
//     【確定】2026-10-13 ユーザー選択「2回目からは確率どおり」＝どこで降りても全体で約97%（毎回97%だと4連勝で降りて約88%）
//   ・当たったら、引いたカードが次の基準。続けるか、受け取るか。10連勝か、賭けたメダルの1000倍で自動で受け取る
//   ・持ち分は 1/100 枚まで持ち、受け取るときに切り捨て
// ============================================================
export const HILO_MIN_BET = 10
export const HILO_MAX_BET = 1000
export const HILO_BETS = [10, 50, 100, 500, 1000]
export const HILO_MAX_STREAK = 10
export const HILO_CAP_MULT = 1000
export const HILO_FIRST_X13 = 1261   // 1回目：0.97 × 13 × 100
export const HILO_NEXT_X13 = 1300    // 2回目から：13 × 100
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const SUITS = ['♠', '♥', '♦', '♣']
export const rankOf = (card) => card % 13              // 0＝2 … 12＝A
export const suitOf = (card) => Math.floor(card / 13)  // 0〜3
export const cardLabelOf = (card) => `${SUITS[suitOf(card)]}${RANK_LABELS[rankOf(card)]}`
export const isRedCard = (card) => suitOf(card) === 1 || suitOf(card) === 2
// 当たりの枚数（13種のうち）
export const hiloCountOf = (card, high) => (high ? 12 - rankOf(card) : rankOf(card))
// 倍率（100倍の整数）。streak＝今の連勝数（0なら1回目）。選べないときは0
export const hiloMult100Of = (card, high, streak = 0) => {
  const n = hiloCountOf(card, high)
  return n > 0 ? Math.floor((streak > 0 ? HILO_NEXT_X13 : HILO_FIRST_X13) / n) : 0
}
export const hiloChanceOf = (card, high) => hiloCountOf(card, high) / 13
// 持ち分（1/100枚）× 倍率 → 次の持ち分（切り捨て）。サーバーと同じ整数の計算
export const hiloNextPotOf = (pot100, mult100) => Math.floor(pot100 * mult100 / 100)
export const hiloPayoutOf = (pot100) => Math.floor(pot100 / 100)

// ============================================================
// ルーレット（ラッキーナンバー付き）
// ------------------------------------------------------------
//   ・0〜36の37マス（0が1つ）。1回の合計は1〜1000枚
//   ・1点賭け30倍・赤黒/偶奇/前半後半2倍・ダズン/列3倍（払い出しは賭けたぶんこみ）
//   ・毎回1〜5個の数字に雷（ラッキーナンバー）。そこへの1点賭けは50〜500倍
//   ・還元率 1点賭け 97.24%・ほか 97.30%
// ============================================================
export const ROULETTE_MAX_TOTAL = 1000
export const ROULETTE_MAX_BETS = 60
export const ROULETTE_CHIPS = [1, 5, 10, 50, 100]
// ホイールの並び（ヨーロピアン）
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
const RED_SET = new Set(RED_NUMBERS)
export const colorOfNumber = (n) => (n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black')
export const ROULETTE_STRAIGHT = 30
// 雷の数（1〜5個）の出やすさ・倍率の出やすさ（100分率）
export const LUCKY_COUNT_W = [30, 25, 20, 15, 10]
export const LUCKY_MULTS = [{ m:50, w:45 }, { m:100, w:25 }, { m:150, w:12 }, { m:200, w:9 }, { m:300, w:5 }, { m:500, w:4 }]
// 賭け方。k＝種類・v＝数字や番号
export const BET_KINDS = {
  n:     { label:'1点',   pay:ROULETTE_STRAIGHT },
  red:   { label:'赤',    pay:2 },
  black: { label:'黒',    pay:2 },
  odd:   { label:'奇数',  pay:2 },
  even:  { label:'偶数',  pay:2 },
  low:   { label:'1〜18', pay:2 },
  high:  { label:'19〜36', pay:2 },
  dozen: { label:'ダズン', pay:3 },
  col:   { label:'列',    pay:3 },
}
export const betLabelOf = (b) => {
  if (b.k === 'n') return `${b.v}`
  if (b.k === 'dozen') return ['1st 12', '2nd 12', '3rd 12'][b.v - 1]
  if (b.k === 'col') return `${b.v}列`
  return BET_KINDS[b.k]?.label || b.k
}
export const betKeyOf = (b) => (b.k === 'n' || b.k === 'dozen' || b.k === 'col' ? `${b.k}:${b.v}` : b.k)
// 当たったか
export const betWins = (b, n) => {
  switch (b.k) {
    case 'n': return b.v === n
    case 'red': return n !== 0 && RED_SET.has(n)
    case 'black': return n !== 0 && !RED_SET.has(n)
    case 'odd': return n !== 0 && n % 2 === 1
    case 'even': return n !== 0 && n % 2 === 0
    case 'low': return n >= 1 && n <= 18
    case 'high': return n >= 19
    case 'dozen': return n !== 0 && Math.floor((n - 1) / 12) + 1 === b.v
    case 'col': return n !== 0 && ((n - 1) % 3) + 1 === b.v
    default: return false
  }
}
// 賭けの形が正しいか（サーバーと同じ決まり）
export const validBet = (b) => {
  if (!b || !(b.k in BET_KINDS)) return false
  if (!Number.isInteger(b.a) || b.a < 1) return false
  if (b.k === 'n') return Number.isInteger(b.v) && b.v >= 0 && b.v <= 36
  if (b.k === 'dozen' || b.k === 'col') return Number.isInteger(b.v) && b.v >= 1 && b.v <= 3
  return true
}
// 1つの賭けの払い出し（lucky … [{n, m}]）
export const betPayoutOf = (b, n, lucky = []) => {
  if (!betWins(b, n)) return 0
  if (b.k === 'n') {
    const l = lucky.find(x => x.n === n)
    return b.a * (l ? l.m : ROULETTE_STRAIGHT)
  }
  return b.a * BET_KINDS[b.k].pay
}
export const rouletteTotalOf = (bets) => bets.reduce((s, b) => s + (b.a || 0), 0)
// 還元率（式）
export const rouletteRtp = () => {
  const cw = LUCKY_COUNT_W.reduce((a, b) => a + b, 0)
  const ek = LUCKY_COUNT_W.reduce((a, w, i) => a + (i + 1) * w / cw, 0)
  const mw = LUCKY_MULTS.reduce((a, x) => a + x.w, 0)
  const em = LUCKY_MULTS.reduce((a, x) => a + x.m * x.w / mw, 0)
  const q = ek / 37
  return {
    straight: (q * em + (1 - q) * ROULETTE_STRAIGHT) / 37,
    even: 18 * 2 / 37,
    dozen: 12 * 3 / 37,
    luckyAvg: ek, luckyMultAvg: em,
  }
}
