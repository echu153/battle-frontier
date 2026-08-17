// バトルフロンティアⅡ 拠点（node --test）
// ------------------------------------------------------------
// ★式の権威はサーバー（supabase_v2_core.sql §11）。ここは仕様を固定するためのテストで、
//   最後の1本で「SQLとJSに同じ数字が2か所ある」箇所を突き合わせている。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MATERIAL_KINDS, KIND_KEYS, GRADE_MAX, materialName, gradeLabel,
  FACILITIES, FACILITY_BY_KEY, PRODUCERS,
  CAP_HOURS, PRODUCE_PER_HOUR, SCARECROW_8H, scarecrowPerHour,
  WORKER_MAX, workerLimitOf, HIRE_COST, hireCostOf,
  rateOf, capOf, UPGRADE_COST, upgradeCostOf, reqAreaOf, upgradeBlockOf,
  EXCHANGE_RATE, exchangeGainOf, exchangeTotalOf, previewOf, fullInOf,
  MATERIAL_SELL, sellPriceOf, sellTotalOf,
} from './basecamp.js'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  assert.notEqual(end, -1, `${name} の終わりが見つからない`)
  return SQL.slice(i, end)
}

// ===== 資材 =====
test('資材は3種・グレードは9段。表記はローマ数字', () => {
  assert.equal(MATERIAL_KINDS.length, 3)
  assert.deepEqual(KIND_KEYS, ['wood', 'stone', 'mana'])
  assert.equal(GRADE_MAX, 9)
  assert.equal(materialName('wood', 1), '木材Ⅰ')
  assert.equal(materialName('stone', 8), '石材Ⅷ')
  assert.equal(materialName('mana', 9), '魔石Ⅸ')
  assert.equal(gradeLabel(9), 'Ⅸ')
})

// ===== 施設 =====
test('生産施設は3つで、かかしには労働者を置けない', () => {
  assert.equal(PRODUCERS.length, 3)
  assert.deepEqual(PRODUCERS.map(f => f.produces), ['wood', 'stone', 'mana'])
  assert.equal(FACILITY_BY_KEY.scarecrow.hasWorkers, false)
  // 生産施設と資材が1対1で対応している（片方だけ増やすと落ちる）
  assert.deepEqual(PRODUCERS.map(f => f.produces).sort(), [...KIND_KEYS].sort())
})

// ===== かかし =====
test('かかしはグレード1で8時間300EXP、グレード9で8時間1200EXP（ユーザー決定）', () => {
  assert.equal(SCARECROW_8H.length, GRADE_MAX)
  assert.equal(SCARECROW_8H[0], 300)
  assert.equal(SCARECROW_8H[8], 1200)
  assert.equal(scarecrowPerHour(1) * CAP_HOURS, 300)
  assert.equal(scarecrowPerHour(9) * CAP_HOURS, 1200)
  // 下がる段が無い（拡張したのに弱くなる、が起きない）
  for (let i = 1; i < SCARECROW_8H.length; i++) {
    assert.ok(SCARECROW_8H[i] > SCARECROW_8H[i - 1], `グレード${i + 1}で下がっている`)
  }
})

test('かかしのレートは労働者に左右されない', () => {
  assert.equal(rateOf('scarecrow', 5, 0), rateOf('scarecrow', 5, 3))
})

// ===== 生産 =====
test('生産施設はグレードで産出が増えない（増えるのは資材のグレードだけ）', () => {
  assert.equal(rateOf('lumber', 1, 1), PRODUCE_PER_HOUR)
  assert.equal(rateOf('lumber', 9, 1), PRODUCE_PER_HOUR, 'グレードで増えている')
  assert.equal(rateOf('lumber', 9, 3), PRODUCE_PER_HOUR * 3)
  assert.equal(rateOf('lumber', 1, 0), 0, '労働者がいなければ止まる')
  assert.equal(capOf('lumber', 4, 2), PRODUCE_PER_HOUR * 2 * CAP_HOURS)
})

test('労働者は施設グレードで1〜3人・拠点全体で9人まで', () => {
  assert.equal(workerLimitOf(1), 1)
  assert.equal(workerLimitOf(3), 1)
  assert.equal(workerLimitOf(4), 2)
  assert.equal(workerLimitOf(6), 2)
  assert.equal(workerLimitOf(7), 3)
  assert.equal(workerLimitOf(9), 3)
  assert.equal(PRODUCERS.length * workerLimitOf(GRADE_MAX), WORKER_MAX)
  assert.equal(HIRE_COST.length, WORKER_MAX)
  assert.equal(hireCostOf(0), 10000)
  assert.equal(hireCostOf(8), 15000000)
  assert.equal(hireCostOf(9), null, '10人目は雇えない')
})

test('労働者は買いきり＝維持費という仕組みがどこにも残っていない', () => {
  // ★2026-08-17 ユーザー決定で廃止。残っていると「Goldが尽きて生産停止」が復活する
  assert.doesNotMatch(SQL, /v2_base_upkeep\(p_key/, '維持費の関数がSQLに残っている')
  assert.match(SQL, /drop function if exists public\.v2_base_upkeep/, '古い関数を落としていない')
  const settle = bodyOf('v2_base_settle')
  assert.doesNotMatch(settle, /upkeep|gold_short/, 'settle に維持費が残っている')
  assert.match(settle, /v_work\s*:=\s*least\(v_elapsed, v_room\)/, '止まるのは満杯のときだけ')
})

test('資材はグレードに関係なくGoldに売れる', () => {
  assert.equal(MATERIAL_SELL.length, GRADE_MAX, '9グレードぶんの売値がある')
  assert.equal(sellPriceOf(1), 3)
  assert.equal(sellPriceOf(GRADE_MAX), 320, '最終グレードの資材が売れないと使い道が無くなる')
  assert.equal(sellPriceOf(0), 0)
  assert.equal(sellPriceOf(10), 0)
  for (let g = 2; g <= GRADE_MAX; g++) {
    assert.ok(MATERIAL_SELL[g - 1] > MATERIAL_SELL[g - 2], `グレード${g}の売値が上がっていない`)
  }
  assert.equal(sellTotalOf([{ kind: 'wood', grade: 9, qty: 3 }, { kind: 'mana', grade: 1, qty: 10 }]),
    320 * 3 + 3 * 10)
  // ★サーバーにも同じ表がある
  const sell = bodyOf('v2_base_material_sell')
  assert.match(sell, new RegExp(`array\\[${MATERIAL_SELL.join(', ')}\\]`), '売値がSQLと違う')
})

test('資材の売却は検証を全部済ませてから引く（部分的に消えない）', () => {
  const body = bodyOf('v2_base_sell_materials')
  const checkAt = body.search(/if v_ok <> v_req then/)
  const updateAt = body.search(/update public\.v2_base_materials bm/)
  assert.ok(checkAt !== -1 && updateAt !== -1)
  assert.ok(checkAt < updateAt, '検証より前に資材を引いている')
  // 値段はサーバーの関数から計算する（クライアントの申告を使わない）
  assert.match(body, /public\.v2_base_material_sell\(q\.grade\)/, '売値をサーバーで計算していない')
})

// ===== 拡張 =====
test('拡張コストは上のグレードほど重い', () => {
  for (let g = 2; g <= GRADE_MAX; g++) {
    assert.ok(UPGRADE_COST[g], `グレード${g}のコストがある`)
    if (g > 2) {
      assert.ok(UPGRADE_COST[g].qty > UPGRADE_COST[g - 1].qty, `グレード${g}の資材が増えていない`)
      assert.ok(UPGRADE_COST[g].gold > UPGRADE_COST[g - 1].gold, `グレード${g}のGoldが増えていない`)
    }
  }
  assert.equal(upgradeCostOf(GRADE_MAX), null, '最大グレードから先は無い')
})

test('グレード③以降はエリアの解放が条件（＝手前のエリアのボス撃破）', () => {
  assert.equal(reqAreaOf(2), 0, 'グレード2に条件は無い')
  assert.equal(reqAreaOf(3), 2)
  assert.equal(reqAreaOf(9), 8, '最終グレードはエリア⑧解放＝⑦のボス撃破')
  assert.equal(upgradeBlockOf(1, [1]), null, 'グレード2へは条件なしで上げられる')
  assert.match(upgradeBlockOf(2, [1]), /エリア②/)
  assert.equal(upgradeBlockOf(2, [1, 2]), null)
  assert.match(upgradeBlockOf(8, [1, 2, 3, 4, 5, 6, 7]), /エリア⑧/)
  assert.equal(upgradeBlockOf(GRADE_MAX, [1, 2, 3, 4, 5, 6, 7, 8]), '最大グレードです')
})

// ===== 素材 → 資材 =====
test('エリアNの素材がグレードNの資材になる。比率は売却と同じ 1:4:20', () => {
  assert.deepEqual(EXCHANGE_RATE, { normal: 3, rare: 12, ultra: 60 })
  assert.equal(EXCHANGE_RATE.rare / EXCHANGE_RATE.normal, 4)
  assert.equal(EXCHANGE_RATE.ultra / EXCHANGE_RATE.normal, 20)
  // m:<エリア>:<敵の番号>:<レア度の頭文字>
  const gain = exchangeGainOf([{ id: 'm:1:0:n', qty: 2 }, { id: 'm:1:0:r', qty: 1 }, { id: 'm:8:6:u', qty: 1 }])
  assert.equal(gain[1], 2 * 3 + 12)
  assert.equal(gain[8], 60)
  assert.equal(exchangeTotalOf([{ id: 'm:1:0:n', qty: 2 }]), 6)
})

test('存在しない素材・0個は無視する', () => {
  assert.deepEqual(exchangeGainOf([{ id: 'nope', qty: 5 }, { id: 'm:1:0:n', qty: 0 }]), {})
  assert.deepEqual(exchangeGainOf(null), {})
})

// ===== 蓄積の見込み =====
const facOf = (over) => ({
  key: 'lumber', pending: 0, rate: 30, cap: 240,
  accrued_from: new Date('2026-08-17T00:00:00Z').toISOString(), ...over,
})
const AT = (h) => new Date(new Date('2026-08-17T00:00:00Z').getTime() + h * 3600000)

test('見込みは 経過時間と満杯までの時間 の小さいほうで止まる', () => {
  const a = previewOf(facOf(), AT(2))
  assert.equal(a.pending, 60)
  assert.equal(a.full, false)

  // 12時間放置しても8時間ぶんで満杯
  const b = previewOf(facOf(), AT(12))
  assert.equal(b.pending, 240)
  assert.equal(b.full, true)

  // ★Goldは関係しない（労働者は買いきり）
  assert.equal(previewOf(facOf(), AT(2)).pending, 60)
})

test('労働者がいない施設は時間が経っても増えない／「満杯」にもならない', () => {
  const f = facOf({ rate: 0, cap: 0 })
  assert.equal(previewOf(f, AT(8)).pending, 0)
  assert.equal(fullInOf(f, AT(8)), null)
  // ★動いていないだけなのに full を立てると、画面に「満杯です」と出てしまう
  assert.equal(previewOf(f, AT(8)).full, false, '労働者0の施設が満杯扱いになっている')
  assert.equal(previewOf(facOf(), AT(12)).full, true, '本当に満杯のときは立つこと')
})

test('かかしも同じ式で貯まる', () => {
  const f = facOf({ key: 'scarecrow', rate: scarecrowPerHour(1), cap: 300 })
  assert.equal(previewOf(f, AT(8)).pending, 300)
})

test('満杯までの残り時間（分）', () => {
  assert.equal(Math.round(fullInOf(facOf(), AT(2))), 6 * 60)
  assert.equal(fullInOf(facOf(), AT(8)), null, '満杯なら null')
})

// ===== SQLとの突き合わせ =====
// ★v2は「1ファイルを全文流し直す」運用なので、同じ数字がSQLとJSの2か所にある。
//   片方だけ直したときにここで落ちる。
test('拠点の数字がSQLと basecamp.js で一致している', () => {
  const rate = bodyOf('v2_base_rate')
  // かかしの1時間あたり（8時間ぶんを8で割った値）
  const scare = SCARECROW_8H.map(v => v / CAP_HOURS)
  assert.match(rate, new RegExp(`array\\[${scare.join(', ')}\\]`),
    `かかしのレート [${scare.join(', ')}] がSQLにある`)
  assert.match(rate, new RegExp(`${PRODUCE_PER_HOUR}::numeric \\* greatest`), '生産施設のレート')

  const limit = bodyOf('v2_base_worker_limit')
  assert.match(limit, /<= 3 then 1/)
  assert.match(limit, /<= 6 then 2/)

  const hire = bodyOf('v2_base_hire_cost')
  assert.match(hire, new RegExp(`array\\[${HIRE_COST.join(', ')}\\]`), '雇用費')

  const up = bodyOf('v2_base_upgrade_cost')
  const qty = Object.keys(UPGRADE_COST).sort((a, b) => a - b).map(g => UPGRADE_COST[g].qty)
  const gold = Object.keys(UPGRADE_COST).sort((a, b) => a - b).map(g => UPGRADE_COST[g].gold)
  assert.match(up, new RegExp(`array\\[${qty.join(', ')}\\]`), '拡張に要る資材の個数')
  assert.match(up, new RegExp(`array\\[${gold.join(', ')}\\]`), '拡張に要るGold')

  const ex = bodyOf('v2_base_exchange')
  assert.match(ex, new RegExp(`'normal' then ${EXCHANGE_RATE.normal}`), '通常の交換レート')
  assert.match(ex, new RegExp(`'rare' then ${EXCHANGE_RATE.rare}`), 'レアの交換レート')
  assert.match(ex, new RegExp(`else ${EXCHANGE_RATE.ultra} end`), '激レアの交換レート')
})

test('v2_base_settle は 経過時間と満杯で頭打ちにする', () => {
  const body = bodyOf('v2_base_settle')
  // ★これが抜けると、放置しただけで無限に貯まる
  assert.match(body, /v_work\s*:=\s*least\(v_elapsed, v_room\)/, '経過時間と満杯の頭打ち')
  // 本人以外を弾いている（SECURITY DEFINER の内部ヘルパは既定でPUBLICが叩ける）
  assert.match(body, /p_uid is distinct from auth\.uid\(\)/, '本人以外を弾いていない')
})

test('上限が下がったときは、切り捨てる前に資材へ回収する', () => {
  // ★実機で踏んだ穴：労働者を外すと cap が0になり、先に least(cap, …) を掛けていたため
  //   pending が0へ潰れてから超過を判定していた＝**未回収の資材が黙って消えた**
  const body = bodyOf('v2_base_settle')
  assert.match(body, /v_new\s*:=\s*v_f\.pending \+ v_rate \* v_work/,
    'pending をいったん素のまま組み立てていない')
  const overAt = body.search(/v_over := floor\(v_new - v_cap\)/)
  const updAt  = body.search(/set pending = v_new/)
  assert.notEqual(overAt, -1, '超過ぶんの回収がない')
  assert.notEqual(updAt, -1)
  assert.ok(overAt < updAt, '書き戻しより後で超過を判定している')
  assert.doesNotMatch(body, /set pending = least\(v_cap/,
    '上限で切り捨ててから超過を判定する書き方が残っている')
  // 労働者を外すと rate も cap も0になり、pending がまるごと超過になる
  assert.match(body, /v_new := v_new - v_over/, '回収したぶんを pending から引いていない')
})

test('配置替えは自動回収した量を返し、画面もそれを出す', () => {
  // ★黙って資材が増えると「なぜ増えたのか」が分からない（設計メモの約束）
  const body = bodyOf('v2_base_move_worker')
  assert.match(body, /v_auto := v_auto \+ coalesce\(\(v_st ->> 'auto_collected'\)::int, 0\)/,
    '自動回収した量を集めていない')
  assert.match(body, /'auto', jsonb_build_object/, '自動回収した量を返していない')
  const src = readFileSync(new URL('../components/V2Base.jsx', import.meta.url), 'utf8')
  assert.match(src, /d\.auto\?\.qty > 0/, '画面が自動回収した量を出していない')
})

test('内部ヘルパは authenticated から REVOKE してある', () => {
  for (const name of ['v2_base_settle', 'v2_base_rate', 'v2_base_material_sell',
                      'v2_base_hire_cost', 'v2_base_upgrade_cost', 'v2_base_kind_of']) {
    const re = new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`)
    assert.match(SQL, re, `${name} が authenticated から revoke されていない`)
  }
  // grant されていないことも確かめる（revoke のあとに grant が来ていたら意味がない）
  for (const name of ['v2_base_settle', 'v2_base_rate']) {
    assert.doesNotMatch(SQL, new RegExp(`grant execute on function public\\.${name}\\(`),
      `${name} を grant している`)
  }
})

test('v2_base_get に STABLE を付けていない（更新直後の状態を返せなくなる）', () => {
  // ★STABLE の関数は呼び出し元の問い合わせのスナップショットで動くので、
  //   v2_base_collect が更新したあとに呼んでも**更新前の値**が返ってしまう
  const i = SQL.indexOf('create or replace function public.v2_base_get()')
  assert.notEqual(i, -1)
  assert.doesNotMatch(SQL.slice(i, i + 200), /stable/, 'stable が付いている')
})

test('回収は検証を済ませてから引く／LV上限のときはかかしを回収しない', () => {
  const body = bodyOf('v2_base_collect')
  assert.match(body, /c_max_lv constant int := 100/, 'LV上限がSQLにある')
  assert.match(body, /if v_lv >= c_max_lv then/, 'LV上限でかかしを飛ばしていない')
  assert.match(body, /public\.v2_apply_exp\(v_uid, v_exp\)/, 'EXPは v2_apply_exp を通す')
})

test('拡張はグレードを上げる前に「回収」する（貯めた資材が上のグレードに化けない）', () => {
  // ★settle だけでは足りない。pending は個数しか持っていないので、
  //   低いグレードで8時間ぶん貯めてから拡張すると、回収時に上のグレードで入ってしまう
  //   （釣り場のエリア切り替えと同じ形の穴）
  const body = bodyOf('v2_base_upgrade')
  const collectAt = body.search(/v_col := public\.v2_base_collect\(p_key\)/)
  const gradeAt = body.search(/update public\.v2_base_facilities set grade = v_to/)
  const payAt = body.search(/update public\.v2_base_materials set qty = qty - v_qty/)
  assert.notEqual(collectAt, -1, '拡張の前に回収していない')
  assert.ok(collectAt < gradeAt, '回収より先にグレードを上げている')
  assert.ok(collectAt < payAt, '回収より先に資材を引いている')
  // 資材の検証を全部済ませてから引くこと（plpgsql は return でロールバックしない）
  const checkAt = body.search(/if coalesce\(v_have, 0\) < v_qty then/)
  assert.ok(checkAt < payAt, '検証より先に資材を引いている')
})
