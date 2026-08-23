// バトルフロンティアⅡ 取引所のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FEE_PCT, feeOf, payoutOf, LISTING_DAYS, MAX_LISTINGS, RETRADE_DAYS, PRICE_MAX,
  EQUIP_BASE, equipFloorOf, RUNE_FLOOR, RUNE_ABILITY_MULT, runeFloorOf, floorOf,
  checkPrice, canList, retradeLeftOf, listingLeftOf, sortListings, SORTS,
} from './market.js'
import { RANKS } from './equipment.js'
import { fuseCostOf, FUSE_GOLD_BASE, FUSE_GOLD_STEP } from './smith.js'
import { UNSOCKET_KIT_COST, UNSOCKET_KIT_RARITY } from './material.js'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  return SQL.slice(i, end)
}
const DAY = 24 * 60 * 60 * 1000

// ============================================================
// ★取引所はGoldを減らさない（設計の芯）。減るのは手数料だけ
// ============================================================
test('★売買でGoldの総量は減らない。消えるのは手数料だけ', () => {
  assert.equal(FEE_PCT, 25)
  for (const price of [1, 999, 1000, 123456, PRICE_MAX]) {
    assert.equal(feeOf(price) + payoutOf(price), price, `${price}Gで帳尻が合っていない`)
    assert.ok(feeOf(price) >= 0 && payoutOf(price) >= 0)
  }
  // 買い手が払った額 － 売り手が受け取った額 ＝ 消えた額
  assert.equal(feeOf(100000), 25000)
  assert.equal(payoutOf(100000), 75000)
})

test('下限価格は装備＝ランク×2^強化値、ルーン＝段×特殊能力', () => {
  assert.deepEqual(Object.keys(EQUIP_BASE).sort(), [...RANKS].sort())
  assert.equal(equipFloorOf('S', 0), 50000)
  assert.equal(equipFloorOf('S', 1), 100000, '1段ごとに倍')
  assert.equal(equipFloorOf('A', 5), 20000 * 32)
  assert.equal(equipFloorOf('知らないランク', 0), EQUIP_BASE.F, '知らないランクでも落ちない')
  // ルーンは名前の段（合計値0〜5）で跳ね上がり、特殊能力つきは3倍
  assert.equal(RUNE_FLOOR.length, 6)
  assert.equal(RUNE_ABILITY_MULT, 3)
  const weak = { str: 1 }          // 合計1%＝段0
  const strong = { str: 12 }       // 合計12%＝段5
  assert.equal(runeFloorOf(weak), RUNE_FLOOR[0])
  assert.equal(runeFloorOf(strong), RUNE_FLOOR[5])
  assert.equal(runeFloorOf(weak, 'スライム'), RUNE_FLOOR[0] * 3)
  assert.equal(floorOf('rune', { stats: strong }), RUNE_FLOOR[5])
  assert.equal(floorOf('equip', { rank:'B', plus:2 }), 8000 * 4)
})

test('値段は下限より安く・上限より高く付けられない（理由つきで返す）', () => {
  const o = { rank:'C', plus:0 }   // 下限3000
  assert.equal(checkPrice('equip', o, 3000).ok, true)
  assert.equal(checkPrice('equip', o, 2999).ok, false)
  assert.match(checkPrice('equip', o, 2999).error, /3,000G以上/)
  assert.equal(checkPrice('equip', o, PRICE_MAX).ok, true)
  assert.equal(checkPrice('equip', o, PRICE_MAX + 1).ok, false)
  assert.equal(checkPrice('equip', o, 0).ok, false)
  assert.equal(checkPrice('equip', o, -5).ok, false)
  assert.equal(checkPrice('equip', o, 'あ').ok, false)
})

// ★旧版は帰属の判定を見落とした一括加工が購入装備を消す事故を起こしている。
//   出品できるかの判定を1か所に固定して、同じ穴を作らない
test('★出品できるかの判定は1か所（装備中・刻印済み・取引直後は出せない）', () => {
  const inv = { id: 7, traded_at: null }
  assert.equal(canList(inv).ok, true)
  assert.equal(canList(null).ok, false)
  assert.match(canList(inv, { worn: new Set(['7']) }).error, /装備中/)
  assert.match(canList(inv, { runes: [{ id: 1 }] }).error, /ルーンを刻んだまま/)
  assert.match(canList(inv, { listed: true }).error, /すでに出品/)
  // 取引から7日経つまで出せない
  assert.equal(RETRADE_DAYS, 7)
  const now = Date.now()
  const traded = (days) => ({ id: 7, traded_at: new Date(now - days * DAY).toISOString() })
  assert.match(canList(traded(0), { now }).error, /あと7日/)
  assert.match(canList(traded(5), { now }).error, /あと2日/)
  assert.equal(canList(traded(7), { now }).ok, true)
  assert.equal(canList(traded(99), { now }).ok, true)
  assert.equal(retradeLeftOf(null), 0, '一度も取引していなければ0')
})

test('出品期間と残り日数', () => {
  assert.equal(LISTING_DAYS, 7)
  assert.equal(MAX_LISTINGS, 10)
  const now = Date.now()
  assert.equal(listingLeftOf(new Date(now).toISOString(), now), 7)
  assert.equal(listingLeftOf(new Date(now - 6 * DAY).toISOString(), now), 1)
  assert.equal(listingLeftOf(new Date(now - 8 * DAY).toISOString(), now), 0)
})

test('並べ替えは4種類とも効く', () => {
  const rows = [
    { id:1, price:300, listed_at:'2026-08-01', power:10 },
    { id:2, price:100, listed_at:'2026-08-03', power:50 },
    { id:3, price:200, listed_at:'2026-08-02', power:30 },
  ]
  assert.deepEqual(sortListings(rows, 'cheap').map(r => r.id), [2, 3, 1])
  assert.deepEqual(sortListings(rows, 'rich').map(r => r.id), [1, 3, 2])
  assert.deepEqual(sortListings(rows, 'new').map(r => r.id), [2, 3, 1])
  assert.deepEqual(sortListings(rows, 'power').map(r => r.id), [2, 3, 1])
  assert.equal(SORTS.length, 4)
  assert.deepEqual(sortListings(null, 'cheap'), [])
})

// ============================================================
// SQLとの突き合わせ（片方だけ直したら落ちる）
// ============================================================
test('取引所の数字がSQLと market.js で一致している', () => {
  const buy = bodyOf('v2_market_buy')
  assert.ok(buy.includes(`c_fee constant int := ${FEE_PCT};`), `手数料 ${FEE_PCT}% がSQLと違う`)
  const list = bodyOf('v2_market_list')
  assert.ok(list.includes(`c_days     constant int := ${LISTING_DAYS};`), '出品期間がSQLと違う')
  assert.ok(list.includes(`c_max      constant int := ${MAX_LISTINGS};`), '同時出品数がSQLと違う')
  assert.ok(list.includes(`c_price_max constant bigint := ${PRICE_MAX};`), '上限価格がSQLと違う')
  // 下限価格の表
  for (const rank of RANKS) {
    assert.ok(list.includes(`('${rank}', ${EQUIP_BASE[rank]})`), `${rank}級の下限がSQLと違う`)
  }
  assert.ok(list.includes('power(2, v_plus)'), '強化値で倍にしていない')
  const can = bodyOf('v2_can_list')
  assert.ok(can.includes(`interval '${RETRADE_DAYS} days'`), '再出品までの日数がSQLと違う')
})

// ★ここを落とすと二重購入・Goldの取りこぼしが起きる
test('v2_market_buy は行をロックして、支払い・受け取り・移管を1つでやる', () => {
  const body = bodyOf('v2_market_buy')
  const has = (t, msg) => assert.ok(body.includes(t), msg)
  has('for update', '出品の行をロックしていない（同時に買われる）')
  has("if v_row.sold_at is not null", '売り切れを見ていない')
  has('if v_row.expires_at <= now()', '期限切れを見ていない')
  has('if v_row.seller_id = v_uid', '自分の出品を買えてしまう')
  has('gold = gold - v_row.price', '買い手からGoldを引いていない')
  has('and gold >= v_row.price', '所持金を見ずに引いている')
  has('gold = gold + v_payout', '売り手へ渡していない')
  has('set player_id = v_uid, traded_at = now()', '所有者の移管と取引時刻を打っていない')
  has('set sold_at = now()', '出品を締めていない')
})

test('出品するときはサーバーも v2_can_list を通す（判定を2か所に書かない）', () => {
  assert.ok(bodyOf('v2_market_list').includes('public.v2_can_list(p_inv, v_uid)'),
    'v2_market_list が判定をコピーしている')
  assert.ok(bodyOf('v2_market_sellable').includes('public.v2_can_list(i.id, v_uid)'),
    '一覧が判定をコピーしている')
  // 刻印済み・装備中・取引直後をぜんぶ見ている
  const can = bodyOf('v2_can_list')
  assert.ok(can.includes('from public.v2_essences e where e.inv_id = p_inv'), 'ルーンを見ていない')
  assert.ok(can.includes('jsonb_each_text(coalesce(v_equipped'), '装備中を見ていない')
})

// ============================================================
// 強化のGold（2026-08-22 ユーザー決定）
// ============================================================
test('★強化にはGoldが要る。ランクが上・強化値が高いほど重い', () => {
  assert.equal(FUSE_GOLD_STEP, 1.5)
  assert.equal(fuseCostOf('S', 0), 5000)
  assert.equal(fuseCostOf('F', 0), 20)
  assert.ok(fuseCostOf('S', 0) > fuseCostOf('A', 0), 'ランクで増えていない')
  assert.ok(fuseCostOf('S', 5) > fuseCostOf('S', 0), '強化値で増えていない')
  assert.equal(fuseCostOf('S', 5), Math.round(5000 * 1.5 ** 5))
  assert.equal(fuseCostOf('知らないランク', 0), FUSE_GOLD_BASE.F, '知らないランクでも落ちない')
  assert.equal(fuseCostOf('F', -3), FUSE_GOLD_BASE.F, 'マイナスでも落ちない')
})

test('強化のGoldがSQLと smith.js で一致している', () => {
  const body = bodyOf('v2_fuse')
  assert.ok(body.includes('c_gold_step constant numeric := 1.5;'), '伸び方がSQLと違う')
  for (const rank of RANKS) {
    assert.ok(body.includes(`('${rank}', ${FUSE_GOLD_BASE[rank]})`), `${rank}級の基礎額がSQLと違う`)
  }
  assert.ok(body.includes('power(c_gold_step, v_plus)'), '強化値で伸ばしていない')
  // ★抽選より前に引く＝成否にかかわらず取られる
  const goldAt = body.indexOf('gold = gold - v_cost')
  const rollAt = body.indexOf('v_r := random();')
  assert.ok(goldAt !== -1 && rollAt !== -1 && goldAt < rollAt, '抽選のあとにGoldを引いている')
  assert.ok(body.includes('and gold >= v_cost'), '所持金を見ずに引いている')
})

// ============================================================
// 刻印除去装置（ルーンを外す道具）
// ============================================================
test('★刻印除去装置は激レア素材だけで作る（これが無いと刻印済みは売れない）', () => {
  assert.equal(UNSOCKET_KIT_COST, 5)
  assert.equal(UNSOCKET_KIT_RARITY, 'ultra')
  const body = bodyOf('v2_make_unsocket_kit')
  assert.ok(body.includes(`c_cost   constant int := ${UNSOCKET_KIT_COST};`), '必要な数がSQLと違う')
  assert.ok(body.includes(`c_rarity constant text := '${UNSOCKET_KIT_RARITY}';`), 'レア度がSQLと違う')
  assert.ok(body.includes('m.rarity = c_rarity'), '激レア以外も使えてしまう')
  assert.ok(body.includes('if v_sum <> c_cost'), 'ちょうどの個数を見ていない')
  assert.ok(body.includes('pm.qty >= q.qty'), '持っている数を見ていない')
  assert.ok(body.includes('unsocket_tickets = unsocket_tickets + 1'), '装置が増えていない')
  // 検証を全部済ませてから素材を引く（部分的に消えない）
  const checkAt = body.indexOf('if v_ok <> v_req')
  const spendAt = body.indexOf('set qty = pm.qty - q.qty')
  assert.ok(checkAt !== -1 && spendAt !== -1 && checkAt < spendAt, '検証の前に素材を引いている')
})
