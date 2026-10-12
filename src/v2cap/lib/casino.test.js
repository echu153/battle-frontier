// v2cap 賭博場：表・還元率・リールの見え方（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GOLD_PER_MEDAL, exchangeGoldOf, maxExchangeOf, winTierOf,
  SLOT_ROLES, SLOT_TOTAL, SLOT_ROLE_BY_KEY, SLOT_NORMAL_AT, SLOT_NORMAL_CZ, SLOT_CZ_WIN, SLOT_TOKU_ADDS, SLOT_ORDERS, orderIndexOf,
  SLOT_AT_GAMES, SLOT_PREMIUM_GAMES, SLOT_CZ_GAMES, SLOT_AT_ADD, SLOT_AT_TOKU, SLOT_TOKU_GAMES, SLOT_MISS_PAY, slotRtp,
  RANK_LABELS, hiloCountOf, hiloMult100Of, hiloChanceOf, hiloNextPotOf, hiloPayoutOf, HILO_MAX_STREAK,
  WHEEL_ORDER, RED_NUMBERS, colorOfNumber, betWins, betPayoutOf, validBet, rouletteRtp, LUCKY_COUNT_W, LUCKY_MULTS, ROULETTE_STRAIGHT,
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
