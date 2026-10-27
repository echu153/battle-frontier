// v2cap 賭博場：表・還元率・リールの見え方（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GOLD_PER_MEDAL, exchangeGoldOf, maxExchangeOf, winTierOf,
  SLOT_ROLES, SLOT_TOTAL, SLOT_ROLE_BY_KEY, SLOT_NORMAL_AT, SLOT_NORMAL_CZ, SLOT_CZ_WIN, SLOT_TOKU_ADDS, SLOT_ORDERS, orderIndexOf,
  SLOT_AT_GAMES, SLOT_PREMIUM_GAMES, SLOT_CZ_GAMES, SLOT_AT_ADD, SLOT_AT_TOKU, SLOT_TOKU_GAMES, SLOT_MISS_PAY, slotRtp,
  RANK_LABELS, hiloCountOf, hiloMult100Of, hiloChanceOf, hiloNextPotOf, hiloPayoutOf, HILO_MAX_STREAK,
  WHEEL_ORDER, RED_NUMBERS, colorOfNumber, betWins, betPayoutOf, validBet, rouletteRtp, LUCKY_COUNT_W, LUCKY_MULTS, ROULETTE_STRAIGHT,
  CASINO_UNLOCKS, casinoWonOf, isUnlocked, newlyUnlockedOf, unlockOf,
  BJ_MIN_BET, BJ_MAX_BET, BJ_BETS, BJ_PAY_NUM, BJ_PAY_DEN, bjPointOf, bjValueOf, bjIsNatural, bjDealerPeeks, bjDealerHits, bjResultOf, bjPayoutOf, bjOutcomeOf, bjBestActionOf, bjRtp,
  POKER_MIN_ANTE, POKER_MAX_ANTE, POKER_ANTES, POKER_RAISE_MULT, POKER_HANDS, pkScoreOf, pkCatOf, pkHandOf, pkQualifies, pkResultOf, pkPayoutOf, pkShouldRaise,
} from './casino.js'
import { displayTable, pickStops, classOf, missStopsOf, DISPLAY_OF_ROLE, REELS, REEL_LEN, winLinesOf, noticeKindOf, noticeLevelOf, NOTICE_TABLE_FOR_TEST } from './slotReels.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('【確定】両替所：100 Gold＝1枚（前作と同じ）', () => {
  assert.equal(GOLD_PER_MEDAL, 100)
  assert.equal(exchangeGoldOf(123), 12300)
  assert.equal(maxExchangeOf(12345), 123)
  assert.equal(maxExchangeOf(-5), 0)
})

test('当たりの大きさの段階：WIN／BIG WIN（10倍）／MEGA WIN（30倍）／JACKPOT（100倍）', () => {
  assert.equal(winTierOf(0, 10), null)
  assert.equal(winTierOf(5, 10).label, 'WIN')
  assert.equal(winTierOf(100, 10).label, 'BIG WIN')
  assert.equal(winTierOf(300, 10).label, 'MEGA WIN')
  assert.equal(winTierOf(1000, 10).label, 'JACKPOT')
})

// ===== スロット =====
test('スロットの表：役の重みは65536・AT＋CZは1000以内・特化の上乗せは100分率', () => {
  assert.equal(SLOT_ROLES.reduce((s, r) => s + r.weight, 0), SLOT_TOTAL)
  for (const r of SLOT_ROLES) assert.ok((SLOT_NORMAL_AT[r.key] || 0) + (SLOT_NORMAL_CZ[r.key] || 0) <= 1000, r.key)
  assert.equal(SLOT_TOKU_ADDS.reduce((s, x) => s + x.w, 0), 100)
  assert.equal(SLOT_ROLE_BY_KEY.obell.pay, 9)
  assert.equal(SLOT_MISS_PAY, 1)
  assert.equal(SLOT_ROLE_BY_KEY.premium.weight, 8, '中段チェリーは1/8192')
  assert.equal(SLOT_ORDERS.length, 6)
  assert.equal(orderIndexOf([1, 2, 0]), 3)
})

test('【確定】スロットの還元率は約97%（通常のベルは当てずっぽう・ATはナビどおり）', () => {
  const r = slotRtp()
  assert.ok(Math.abs(r.rtp - 0.97) < 0.002, `還元率 ${(r.rtp * 100).toFixed(2)}%`)
  // 遊び心地の目安：ATは通常200G前後に1回・平均100G前後・CZは3回に1回ちょっと
  assert.ok(r.atEvery > 150 && r.atEvery < 300, `AT ${r.atEvery.toFixed(0)}Gに1回`)
  assert.ok(r.atGamesAvg > 80 && r.atGamesAvg < 130, `AT平均 ${r.atGamesAvg.toFixed(0)}G`)
  assert.ok(r.czSuccess > 0.3 && r.czSuccess < 0.45, `CZ成功 ${(r.czSuccess * 100).toFixed(0)}%`)
})

test('スロット：式の還元率と、実際に回したとき（120万G）がほぼ同じ', () => {
  const rnd = rngOf(20261013)
  const keys = SLOT_ROLES.map(r => r.key)
  const roleOf = () => { const x = Math.floor(rnd() * SLOT_TOTAL); let acc = 0; for (const r of SLOT_ROLES) { acc += r.weight; if (x < acc) return r.key } return 'miss' }
  let mode = 'normal', cz = 0, at = 0, toku = 0, bet = 0, ret = 0
  const N = 1200000
  for (let i = 0; i < N; i++) {
    const role = roleOf()
    bet += 3
    ret += mode === 'at' ? SLOT_ROLE_BY_KEY[role].pay : role === 'obell' ? (rnd() < 1 / 6 ? 9 : 1) : SLOT_ROLE_BY_KEY[role].pay
    if (mode === 'normal') {
      if (role === 'premium') { mode = 'at'; at = SLOT_PREMIUM_GAMES; toku = 0 }
      else {
        const u = Math.floor(rnd() * 1000), a = SLOT_NORMAL_AT[role] || 0, c = SLOT_NORMAL_CZ[role] || 0
        if (u < a) { mode = 'at'; at = SLOT_AT_GAMES; toku = 0 } else if (u < a + c) { mode = 'cz'; cz = SLOT_CZ_GAMES }
      }
    } else if (mode === 'cz') {
      cz--
      if (Math.floor(rnd() * 1000) < (SLOT_CZ_WIN[role] || 0)) { mode = 'at'; at = role === 'premium' ? SLOT_PREMIUM_GAMES : SLOT_AT_GAMES; toku = 0 }
      else if (cz <= 0) mode = 'normal'
    } else {
      if (toku > 0) { toku--; const u = Math.floor(rnd() * 100); let acc = 0; for (const x of SLOT_TOKU_ADDS) { acc += x.w; if (u < acc) { at += x.g; break } } }
      else { at--; if (Math.floor(rnd() * 1000) < (SLOT_AT_TOKU[role] || 0)) toku += SLOT_TOKU_GAMES }
      const ad = SLOT_AT_ADD[role]; if (ad && Math.floor(rnd() * 1000) < ad[0]) at += ad[1]
      if (at <= 0 && toku <= 0) mode = 'normal'
    }
  }
  assert.ok(keys.length === 9)
  const sim = ret / bet
  assert.ok(Math.abs(sim - slotRtp().rtp) < 0.03, `回した ${(sim * 100).toFixed(2)}%／式 ${(slotRtp().rtp * 100).toFixed(2)}%`)
})

test('リールの見え方：どの役にも見え方があり、選んだ止まり方はその見え方になる', () => {
  const t = displayTable()
  for (const r of SLOT_ROLES) {
    const d = DISPLAY_OF_ROLE[r.key]
    assert.ok(d, r.key)
    const list = d === 'bell' ? t.bellTenpai : t.buckets[d]
    assert.ok(list && list.length > 0, `${r.name}（${d}）の止まり方がある`)
  }
  assert.ok(t.buckets.seven.length > 0, '777（AT開始の演出）')
  for (const r of REELS) assert.equal(r.length, REEL_LEN)
  const rnd = rngOf(7)
  for (const d of ['replay', 'bell', 'suika', 'wcherry', 'scherry', 'premium', 'chance', 'miss', 'seven']) {
    for (let i = 0; i < 30; i++) assert.equal(classOf(pickStops(d, rnd)), d)
  }
})

test('押し順ベル：どのリールを最後に止めても、外れなら「こぼし（何も揃わない）」にできる', () => {
  const rnd = rngOf(11)
  for (let i = 0; i < 200; i++) {
    const pos = pickStops('bell', rnd)
    assert.equal(classOf(pos), 'bell')
    assert.equal(winLinesOf(pos).length, 1)
    for (const j of [0, 1, 2]) {
      const q = missStopsOf(pos, j, rnd)
      assert.equal(classOf(q), 'miss')
      assert.deepEqual(q.filter((_, k) => k !== j), pos.filter((_, k) => k !== j), '先に止めた2つは動かない')
    }
  }
})

test('予告：虹（確定）はAT確定のときだけ・強い予告ほどATに近い', () => {
  const T = NOTICE_TABLE_FOR_TEST
  for (const [k, row] of Object.entries(T)) {
    if (k !== 'at') assert.equal(row[5], 0, `${k} で虹は出ない`)
  }
  assert.ok(T.at[5] > 0)
  assert.equal(noticeKindOf({ role:'miss', mode_before:'normal' }), 'none')
  assert.equal(noticeKindOf({ role:'scherry', mode_before:'normal', at_in:true }), 'at')
  assert.equal(noticeKindOf({ role:'wcherry', mode_before:'normal', cz_in:true }), 'cz')
  const rnd = rngOf(3)
  for (let i = 0; i < 2000; i++) assert.notEqual(noticeLevelOf({ role:'chance', mode_before:'cz' }, rnd), 5)
  // 赤以上の割合：AT確定 ＞ CZ突入 ＞ 何もない
  const hot = (row) => (row[3] + row[4] + row[5]) / row.reduce((a, b) => a + b, 0)
  assert.ok(hot(T.at) > hot(T.cz) && hot(T.cz) > hot(T.none))
})

// ===== ハイ&ロー =====
test('【確定】ハイ&ローの倍率：1回目は0.97×13÷当たりの枚数・2回目からは13÷当たりの枚数（同じ数字は負け）', () => {
  const seven = RANK_LABELS.indexOf('7')
  assert.equal(hiloMult100Of(seven, true), 180)
  assert.equal(hiloMult100Of(seven, false), 252)
  assert.equal(hiloMult100Of(seven, true, 1), 185)
  assert.equal(hiloMult100Of(seven, false, 3), 260)
  assert.equal(hiloMult100Of(0, false), 0, '2からローは選べない')
  assert.equal(hiloMult100Of(12, true), 0, 'Aからハイは選べない')
  assert.equal(hiloCountOf(0, true), 12)
  for (let card = 0; card < 52; card++) {
    for (const high of [true, false]) {
      if (!hiloCountOf(card, high)) continue
      const first = hiloChanceOf(card, high) * hiloMult100Of(card, high) / 100
      const next = hiloChanceOf(card, high) * hiloMult100Of(card, high, 1) / 100
      assert.ok(first <= 0.97 + 1e-9 && first > 0.96, `1回目 ${card} ${high} ${first}`)
      assert.ok(next <= 1 + 1e-9 && next > 0.985, `2回目から ${card} ${high} ${next}`)
    }
  }
})

test('【確定】ハイ&ロー：どこで降りても全体の還元率は約97%（確率の高いほうを選び、k連勝で降りる）', () => {
  // 期待値を正確に出す（引いたカードは戻す＝毎回13種が同じ確率）。V[s][r]＝連勝s・今のカードrから、k連勝で降りるまでの倍率の期待値
  for (let k = 1; k <= HILO_MAX_STREAK; k++) {
    let next = Array(13).fill(1)
    for (let s = k - 1; s >= 0; s--) {
      next = Array.from({ length: 13 }, (_, rank) => {
        const high = hiloCountOf(rank, true) >= hiloCountOf(rank, false)
        const m = hiloMult100Of(rank, high, s) / 100
        let v = 0
        for (let nr = 0; nr < 13; nr++) if (high ? nr > rank : nr < rank) v += m * next[nr] / 13
        return v
      })
    }
    const ev = next.reduce((a, b) => a + b, 0) / 13
    assert.ok(ev > 0.94 && ev <= 0.97, `${k}連勝で降りる：${(ev * 100).toFixed(2)}%`)
  }
})

test('ハイ&ローの持ち分は1/100枚の整数で掛け、受け取りで切り捨て（サーバーと同じ）', () => {
  assert.equal(hiloNextPotOf(10000, 180), 18000)
  assert.equal(hiloNextPotOf(1050, 185), 1942)
  assert.equal(hiloPayoutOf(1942), 19)
})

// ===== ルーレット =====
test('ルーレット：ホイールは0〜36が1つずつ・赤は18個', () => {
  assert.deepEqual([...WHEEL_ORDER].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i))
  assert.equal(RED_NUMBERS.length, 18)
  assert.equal(colorOfNumber(0), 'green')
  // 隣どうしは赤と黒が交互（0を除く）
  for (let i = 1; i < WHEEL_ORDER.length - 1; i++) assert.notEqual(colorOfNumber(WHEEL_ORDER[i]), colorOfNumber(WHEEL_ORDER[i + 1]))
})

test('ルーレット：賭け方ごとの当たりの数（0はどれにも入らない）', () => {
  const count = (b) => Array.from({ length: 37 }, (_, n) => n).filter(n => betWins(b, n)).length
  for (const k of ['red', 'black', 'odd', 'even', 'low', 'high']) assert.equal(count({ k }), 18, k)
  for (const v of [1, 2, 3]) { assert.equal(count({ k:'dozen', v }), 12); assert.equal(count({ k:'col', v }), 12) }
  assert.equal(count({ k:'n', v:0 }), 1)
  assert.ok(betWins({ k:'col', v:1 }, 34) && betWins({ k:'col', v:3 }, 36) && betWins({ k:'dozen', v:3 }, 25))
  assert.ok(!validBet({ k:'n', v:37, a:1 }) && !validBet({ k:'red', a:0 }) && !validBet({ k:'dozen', v:0, a:1 }) && validBet({ k:'n', v:0, a:3 }))
})

test('【確定】ルーレットの還元率：1点賭け約97.2%（ラッキーナンバー込み）・ほか97.3%', () => {
  const r = rouletteRtp()
  assert.ok(r.straight > 0.97 && r.straight < 0.975, `1点 ${(r.straight * 100).toFixed(2)}%`)
  assert.equal(r.even, 36 / 37)
  assert.equal(r.dozen, 36 / 37)
  assert.equal(LUCKY_COUNT_W.reduce((a, b) => a + b, 0), 100)
  assert.equal(LUCKY_MULTS.reduce((a, x) => a + x.w, 0), 100)
  assert.equal(betPayoutOf({ k:'n', v:17, a:10 }, 17, [{ n:17, m:300 }]), 3000, '雷の数字は倍率で払う')
  assert.equal(betPayoutOf({ k:'n', v:17, a:10 }, 17, [{ n:3, m:300 }]), 10 * ROULETTE_STRAIGHT)
  assert.equal(betPayoutOf({ k:'red', a:10 }, 0, []), 0)
})

// ===== 解禁・ブラックジャック（2026-10-28）=====
// カード（0〜51・強さは card % 13：0＝2 … 8＝10・9〜11＝J/Q/K・12＝A）
const C = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, J: 9, Q: 10, K: 11, A: 12 }
const hand = (...xs) => xs.map(x => C[x])

test('【確定】解禁：これまでの払い出し（どのゲームも・両替は数えない）が1万枚でブラックジャック・一度解禁したらそのまま', () => {
  assert.equal(CASINO_UNLOCKS[0].key, 'bj', 'ブラックジャックがいちばん先')
  assert.equal(unlockOf('bj').need, 10000)
  const stats = { slot: { n: 5, bet: 15, won: 6000 }, hilo: { won: 2500 }, roulette: { won: 1499 } }
  assert.equal(casinoWonOf(stats), 9999)
  assert.equal(casinoWonOf(null), 0)
  assert.equal(isUnlocked('bj', 9999), false)
  assert.equal(isUnlocked('bj', 10000), true)
  assert.equal(isUnlocked('slot', 0), true, '解禁の表に無いゲームは最初から遊べる')
  assert.deepEqual(newlyUnlockedOf(9999, 10000).map(u => u.key), ['bj'], '線をまたいだときだけ演出を出す')
  assert.deepEqual(newlyUnlockedOf(10000, 20000), [])
  assert.equal(unlockOf('bj').label, 'ブラックジャック')
})

test('ブラックジャック：カードの点（2〜10はその数・J/Q/Kは10・Aは11か1）と手の合計', () => {
  assert.deepEqual(['2', '9', '10', 'J', 'Q', 'K', 'A'].map(x => bjPointOf(C[x])), [2, 9, 10, 10, 10, 10, 11])
  assert.equal(bjPointOf(C.A + 13 * 3), 11, 'マークは関係なし')
  assert.deepEqual(bjValueOf(hand('A', 6)), { total: 17, soft: true })
  assert.deepEqual(bjValueOf(hand('A', 6, 10)), { total: 17, soft: false }, '21を超えるときはAを1に')
  assert.deepEqual(bjValueOf(hand('A', 'A')), { total: 12, soft: true })
  assert.deepEqual(bjValueOf(hand('A', 'A', 9)), { total: 21, soft: true })
  assert.deepEqual(bjValueOf(hand(10, 6, 'K')), { total: 26, soft: false })
  assert.equal(bjIsNatural(hand('A', 'Q')), true)
  assert.equal(bjIsNatural(hand(7, 7, 7)), false, '3枚の21はブラックジャックではない')
})

test('【確定】アレアは17以上になるまで引く・Aを11と数えた17（ソフト17）でも引く・表がAか10点ならのぞく', () => {
  assert.equal(bjDealerHits(hand(10, 6)), true)
  assert.equal(bjDealerHits(hand(10, 7)), false)
  assert.equal(bjDealerHits(hand('A', 6)), true, 'ソフト17は引く')
  assert.equal(bjDealerHits(hand('A', 6, 10)), false, 'ハード17は止まる')
  assert.equal(bjDealerHits(hand('A', 7)), false)
  assert.deepEqual(['A', 10, 'J', 'Q', 'K', 9, 2].map(x => bjDealerPeeks(C[x])), [true, true, true, true, true, false, false])
})

test('【確定】ブラックジャックの配当は6:5（賭けたぶんこみ2.2倍）・勝ち2倍・引き分けは戻る・ダブルは賭けを倍に', () => {
  assert.deepEqual([BJ_MIN_BET, BJ_MAX_BET, BJ_PAY_NUM, BJ_PAY_DEN], [10, 1000, 6, 5])
  assert.ok(BJ_BETS.every(b => b >= BJ_MIN_BET && b <= BJ_MAX_BET && b % BJ_PAY_DEN === 0), '画面の賭けは5枚きざみ（6:5に端数が出ない）')
  assert.equal(bjPayoutOf('bj', 100), 220)
  assert.equal(bjPayoutOf('bj', 10), 22)
  assert.equal(bjPayoutOf('bj', 11), 24, '端数は切り捨て（13.2→13）')
  assert.equal(bjPayoutOf('win', 100), 200)
  assert.equal(bjPayoutOf('win', 100, true), 400)
  assert.equal(bjPayoutOf('push', 100, true), 200)
  assert.equal(bjPayoutOf('lose', 100, true), 0)
  // 勝ち負け
  assert.equal(bjResultOf(hand('A', 'K'), hand(10, 7)), 'bj')
  assert.equal(bjResultOf(hand('A', 'K'), hand('A', 'Q')), 'push', 'どちらもブラックジャックは引き分け')
  assert.equal(bjResultOf(hand(10, 9), hand('A', 'Q')), 'lose')
  assert.equal(bjResultOf(hand(7, 7, 7), hand('A', 'Q')), 'lose', 'アレアのブラックジャックは3枚の21にも勝つ')
  assert.equal(bjResultOf(hand(10, 6, 9), hand(10, 6, 10)), 'lose', 'こちらが先に21を超えたら負け（アレアが超えても）')
  assert.equal(bjResultOf(hand(10, 8), hand(10, 6, 10)), 'win')
  assert.equal(bjResultOf(hand(10, 8), hand(10, 7)), 'win')
  assert.equal(bjResultOf(hand(10, 7), hand(10, 7)), 'push')
  assert.equal(bjResultOf(hand(10, 6), hand(10, 7)), 'lose')
  // 終わり方（アレアのひとことと結果の表示）
  assert.equal(bjOutcomeOf(hand('A', 'K'), hand(10, 7)), 'natural')
  assert.equal(bjOutcomeOf(hand(10, 9), hand('A', 'Q')), 'dealerNatural')
  assert.equal(bjOutcomeOf(hand(10, 6, 9), hand(10, 6)), 'bust')
  assert.equal(bjOutcomeOf(hand(10, 8), hand(10, 6, 10)), 'dealerBust')
  assert.equal(bjOutcomeOf(hand(10, 8), hand(10, 7)), 'win')
  assert.equal(bjOutcomeOf(hand(10, 6), hand(10, 7)), 'lose')
  assert.equal(bjOutcomeOf(hand(10, 7), hand(10, 7)), 'push')
})

test('いちばん良い打ち方（式の還元率の前提）：ハード17はやめる・11はダブル・A/6はアレアの表が5ならダブル', () => {
  assert.equal(bjBestActionOf(hand(10, 7), C[10], true), 'stand')
  assert.equal(bjBestActionOf(hand(10, 2), C[2], true), 'hit')
  assert.equal(bjBestActionOf(hand(10, 2), C[5], true), 'stand')
  assert.equal(bjBestActionOf(hand(6, 5), C[6], true), 'double')
  assert.equal(bjBestActionOf(hand(6, 5), C[6], false), 'hit', '3枚目からはダブルできない')
  assert.equal(bjBestActionOf(hand('A', 6), C[5], true), 'double')
  assert.equal(bjBestActionOf(hand(9, 'A', 'A'), C[10]), 'stand', '21はやめる')
})

test('【確定】ブラックジャックの還元率は約97.6%（6:5・スプリットなし・ソフト17でも引く・いちばん良い打ち方）', () => {
  const r = bjRtp()
  assert.ok(r.rtp > 0.975 && r.rtp < 0.977, `${(r.rtp * 100).toFixed(2)}%`)
  assert.ok(r.stake > 1.05 && r.stake < 1.15, 'ダブルのぶん、1回に賭ける平均は少し多い')
})

test('ブラックジャック：式の還元率と、決まりの関数で実際に30万回配ったときがほぼ同じ', () => {
  const rng = rngOf(20261028)
  const draw = () => Math.floor(rng() * 52)
  const unit = 10
  let paid = 0, back = 0
  for (let i = 0; i < 300000; i++) {
    const player = [draw()], dealer = [draw()]
    player.push(draw()); dealer.push(draw())
    paid += unit
    let doubled = false
    if (!bjIsNatural(player) && !(bjDealerPeeks(dealer[0]) && bjIsNatural(dealer))) {
      for (;;) {
        const a = bjBestActionOf(player, dealer[0], player.length === 2)
        if (a === 'stand') break
        player.push(draw())
        if (a === 'double') { doubled = true; paid += unit; break }
        if (bjValueOf(player).total >= 21) break
      }
      if (bjValueOf(player).total <= 21) while (bjDealerHits(dealer)) dealer.push(draw())
    }
    back += bjPayoutOf(bjResultOf(player, dealer), unit, doubled)
  }
  const sim = back / paid, rtp = bjRtp().rtp
  assert.ok(Math.abs(sim - rtp) < 0.006, `シミュ ${(sim * 100).toFixed(2)}%・式 ${(rtp * 100).toFixed(2)}%`)
})

// ===== ポーカー（カリビアンスタッド・2026-10-28）=====
// マークつきのカード：'As'＝スペードのA・'Th'＝ハートの10（s♠ h♥ d♦ c♣）
const PK_R = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, T: 8, J: 9, Q: 10, K: 11, A: 12 }
const PK_S = { s: 0, h: 1, d: 2, c: 3 }
const pk = (str) => str.split(' ').map(x => PK_S[x[1]] * 13 + PK_R[x[0]])

test('【確定】解禁：ポーカーはこれまでの払い出し3万枚（ブラックジャックの次の段）', () => {
  assert.deepEqual(CASINO_UNLOCKS.map(u => [u.key, u.need]), [['bj', 10000], ['poker', 30000]])
  assert.equal(isUnlocked('poker', 29999), false)
  assert.equal(isUnlocked('poker', 30000), true)
  assert.deepEqual(newlyUnlockedOf(9999, 30000).map(u => u.key), ['bj', 'poker'], '一度に2つ越えたら両方')
})

test('ポーカーの役：10種類の判定と強さの順（A2345 のストレートは5が上・マークは関係なし）', () => {
  const cat = (str) => pkHandOf(pk(str)).key
  assert.equal(cat('As Ks Qs Js Ts'), 'royal')
  assert.equal(cat('9h 8h 7h 6h 5h'), 'sflush')
  assert.equal(cat('5d 4d 3d 2d Ad'), 'sflush', 'A2345 のストレートフラッシュ')
  assert.equal(cat('7s 7h 7d 7c 2s'), 'quads')
  assert.equal(cat('Ks Kh Kd 4c 4s'), 'full')
  assert.equal(cat('As 9s 7s 4s 2s'), 'flush')
  assert.equal(cat('Ts 9h 8d 7c 6s'), 'straight')
  assert.equal(cat('5s 4h 3d 2c Ah'), 'straight')
  assert.equal(cat('Qs Qh Qd 9c 2s'), 'trips')
  assert.equal(cat('Js Jh 4d 4c As'), 'twopair')
  assert.equal(cat('9s 9h Ad 7c 2s'), 'pair')
  assert.equal(cat('As Kh 9d 7c 2s'), 'high')
  const order = ['high', 'pair', 'twopair', 'trips', 'straight', 'flush', 'full', 'quads', 'sflush', 'royal']
  assert.deepEqual(POKER_HANDS.map(h => h.key), order)
  const S = (str) => pkScoreOf(pk(str))
  assert.ok(S('6s 5h 4d 3c 2s') > S('5s 4h 3d 2c Ah'), 'A2345 は6ハイのストレートより下')
  assert.ok(S('As Ah 3d 4c 6s') > S('Ks Kh Qd Jc 9s'), 'ペアはペアの数字で比べる')
  assert.ok(S('Ks Kh 7d 7c 2s') > S('Ks Kh 6d 6c As'), 'ツーペアは2つめのペアまで比べる')
  assert.ok(S('Ks Kh Qd 9c 3s') > S('Ks Kh Qd 9c 2s'), '最後の1枚まで比べる')
  assert.equal(S('As Kh 9d 7c 2s'), S('Ah Ks 9c 7d 2h'), 'マークがちがうだけなら引き分け')
  assert.equal(pkCatOf(S('As Ks Qs Js Ts')), 9)
})

test('【確定】ディーラーはAとKがそろった役なし以上で勝負・勝負しないとアンティ1:1で上乗せは戻る', () => {
  assert.equal(pkQualifies(pk('As Kh 9d 7c 2s')), true)
  assert.equal(pkQualifies(pk('As Qh 9d 7c 2s')), false)
  assert.equal(pkQualifies(pk('2s 2h 9d 7c 4s')), true, 'ワンペアなら数字によらず勝負')
  assert.deepEqual([POKER_MIN_ANTE, POKER_MAX_ANTE, POKER_RAISE_MULT], [10, 1000, 2])
  assert.ok(POKER_ANTES.every(a => a >= POKER_MIN_ANTE && a <= POKER_MAX_ANTE))
  const player = pk('Qs Qh 9d 7c 2s')
  assert.equal(pkResultOf(player, pk('As Jh 9c 7d 3h')), 'noqual')
  assert.equal(pkPayoutOf('noqual', 100, player), 400, 'アンティ100が200・上乗せ200が戻る')
  assert.equal(pkResultOf(player, pk('Js Jh 9c 7d 3h')), 'win')
  assert.equal(pkPayoutOf('win', 100, player), 200 + 200 * 2, 'ワンペアの上乗せは1:1')
  assert.equal(pkPayoutOf('win', 100, pk('As 9s 7s 4s 2s')), 200 + 200 * 6, 'フラッシュは5:1')
  assert.equal(pkPayoutOf('win', 1000, pk('As Ks Qs Js Ts')), 2000 + 2000 * 101, 'ロイヤルは100:1')
  assert.equal(pkResultOf(player, pk('Qc Qd 9h 7s 2h')), 'push')
  assert.equal(pkPayoutOf('push', 100, player), 300)
  assert.equal(pkResultOf(player, pk('Ks Kh 9c 7d 3h')), 'lose')
  assert.equal(pkPayoutOf('lose', 100, player), 0)
  assert.deepEqual(POKER_HANDS.map(h => h.pay), [1, 1, 2, 3, 4, 5, 7, 20, 50, 100], '上乗せの配当（標準）')
})

test('勝負する打ち方（還元率の前提）：ワンペア以上か、役なしなら A K J 8 3 以上', () => {
  assert.equal(pkShouldRaise(pk('2s 2h 9d 7c 4s')), true)
  assert.equal(pkShouldRaise(pk('As Kh Jd 8c 3s')), true)
  assert.equal(pkShouldRaise(pk('As Kh Jd 8c 2s')), false)
  assert.equal(pkShouldRaise(pk('As Kh Qd 3c 2s')), true)
  assert.equal(pkShouldRaise(pk('As Qh Jd 9c 8s')), false, 'Kがない役なしは降りる')
})

test('【確定】ポーカーの還元率は約97.4%（52枚をまぜて30万回配ったとき・ワンペア以上と A K J 8 3 以上で勝負）', () => {
  const rng = rngOf(20261028)
  const deck = Array.from({ length: 52 }, (_, i) => i)
  let paid = 0, back = 0, raised = 0, noqual = 0
  for (let i = 0; i < 300000; i++) {
    for (let j = 0; j < 10; j++) { const k = j + Math.floor(rng() * (52 - j)); const t = deck[j]; deck[j] = deck[k]; deck[k] = t }
    const p = deck.slice(0, 5), d = deck.slice(5, 10)
    paid += 10
    if (!pkShouldRaise(p)) continue
    raised++
    paid += 10 * POKER_RAISE_MULT
    const r = pkResultOf(p, d)
    if (r === 'noqual') noqual++
    back += pkPayoutOf(r, 10, p)
  }
  const rtp = back / paid
  assert.ok(rtp > 0.968 && rtp < 0.98, `${(rtp * 100).toFixed(2)}%`)
  assert.ok(raised / 300000 > 0.5 && raised / 300000 < 0.55, '勝負するのは半分ちょっと')
  assert.ok(noqual / raised > 0.42 && noqual / raised < 0.45, 'ディーラーが勝負しないのは勝負したときの4割強')
})
