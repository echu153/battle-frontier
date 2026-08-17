// バトルフロンティアⅡ SQL（supabase_v2_core.sql）とJS側の突き合わせ（node --test）
// ------------------------------------------------------------
// v2は「1ファイルにまとめて全文を流し直す」運用なので、SQLとJSに同じ数字が
// 2か所ある箇所がいくつかある。**片方だけ直したときに気付けるように**ここで固定する。
// 旧版の「SQL の定数がテストの写しと一致している」テストと同じ考え方。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RATES } from './smith.js'
import { RANKS } from './equipment.js'
import { SELL_BASE, SELL_RARITY_MULT } from './material.js'
import { LOSE_DROP, floorAfterLose } from './arena.js'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')

// 関数の本体を切り出す（v2は同名オーバーロードを作らない運用）
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  assert.notEqual(end, -1, `${name} の終わりが見つからない`)
  return SQL.slice(i, end)
}

test('v2_fuse の確率表が smith.js の RATES と一致している（片方だけ直すと気付く）', () => {
  const body = bodyOf('v2_fuse')
  for (const rank of RANKS) {
    const r = RATES[rank]
    // SQL側は ('F', 0.00, 0.14, 0.04) のように (rank, fail, great, super) を小数で持つ
    const m = body.match(new RegExp(`\\('${rank}',\\s*([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)\\)`))
    assert.ok(m, `${rank} の行がSQLにある`)
    assert.equal(Math.round(Number(m[1]) * 100), r.fail,  `${rank} の失敗率`)
    assert.equal(Math.round(Number(m[2]) * 100), r.great, `${rank} の大成功率`)
    assert.equal(Math.round(Number(m[3]) * 100), r.super, `${rank} の超大成功率`)
  }
})

test('v2_sortie_settle はボス勝利数をボス遭遇数で頭打ちにする', () => {
  const body = bodyOf('v2_sortie_settle')
  // ★ここが無いと「遭遇1回・勝利10万回」を送れて、EXP/Goldの上限計算が青天井になる。
  //   回数の頭打ち（500）は v_n + v_bs にしか掛かっていないため、v_bw は別に抑える必要がある。
  assert.match(body, /v_bw\s*:=\s*least\(v_bw,\s*v_bs\)/,
    'v_bw := least(v_bw, v_bs) が要る')
  // 上限を組み立てるより前に抑えていること（順番が逆だと意味がない）
  //   ※ declare の `v_exp_cap int;` ではなく**代入**の位置と比べる
  const capAt = body.search(/v_exp_cap\s*:=/)
  assert.notEqual(capAt, -1, 'v_exp_cap の代入がある')
  assert.ok(body.indexOf('least(v_bw, v_bs)') < capAt, '頭打ちは上限計算より前で行う')
})

test('authenticated に開放しているv2のRPCは全部 is_admin を見ている（開発限定のまま）', () => {
  // ★画面（V2Home.jsx）のゲートだけだと、RPCを直接叩けば誰でもv2を遊べてしまう。
  //   旧版の arena/pvp と同じ穴なので、grant したものは必ずサーバー側でも弾く。
  const granted = [...SQL.matchAll(/grant execute on function public\.(v2_\w+)\(/g)].map(m => m[1])
  assert.ok(granted.length >= 15, `grant されたRPCを拾えている（${granted.length}件）`)
  const holes = [...new Set(granted)].filter(name => {
    const body = bodyOf(name)
    return !body.includes('v2_is_dev()') && !body.includes('is_admin')
  })
  assert.deepEqual(holes, [], `is_admin を見ていないRPC: ${holes.join(', ')}`)
})

test('v2_set_skills はルーンのMP+%を最大MPに乗せる（素の profiles.mp で判定しない）', () => {
  const body = bodyOf('v2_set_skills')
  // ★素の mp で判定すると、蒼ルーンのMPが**どこにも効かない**
  //   （戦闘はHP/MP満タン開始で決着5〜13ターン＝MPが枯れないため）
  assert.match(body, /v2_essences/, '装着中のルーンを見ている')
  assert.match(body, /stats\s*->>\s*'mp'/, 'ルーンのMP+%を読んでいる')
  assert.match(body, /if v_cost > v_max_mp then/, 'ルーンぶんを乗せた最大MPで判定している')
  assert.doesNotMatch(body, /if v_cost > v_row\.mp then/, '素の mp での判定が残っていない')
})

// ===== Gold（2026-08-17 ユーザー決定・docs/v2-gold-design.md）=====
test('v2_sortie_settle はGoldを足さない（敵はGoldを落とさない）', () => {
  const body = bodyOf('v2_sortie_settle')
  // ★ここが戻ると「敵からもGold・素材売却でもGold」の二重の湧き口になる
  assert.doesNotMatch(body, /set gold = gold \+/, 'Goldを加算している')
  assert.doesNotMatch(body, /max_zako_gold/, '旧Gold上限の計算が残っている')
  // p_gold は互換のため受け取るが、使っていないこと
  assert.match(body, /p_gold bigint/, '引数は互換のため残す')
  assert.doesNotMatch(body, /coalesce\(p_gold/, 'p_gold を読んでいる')
})

test('素材の売値がSQLと material.js で一致している（片方だけ直すと落ちる）', () => {
  // ★売却の権威はサーバー（v2_materials.sell）。表示だけJSにある
  const m = SQL.match(/update public\.v2_materials set sell =[\s\S]*?;/)
  assert.ok(m, 'v2_materials.sell を埋めるUPDATEがSQLにある')
  const sql = m[0]
  for (const [area, base] of Object.entries(SELL_BASE)) {
    assert.match(sql, new RegExp(`when ${area} then ${base}[^0-9]`), `エリア${area}の基準額 ${base}`)
  }
  for (const [rarity, mult] of Object.entries(SELL_RARITY_MULT)) {
    assert.match(sql, new RegExp(`when '${rarity}' then ${mult}[^0-9]`), `${rarity} の倍率 ${mult}`)
  }
})

// ===== アリーナ =====
test('負けたときに落ちる階が、SQLと arena.js で一致している', () => {
  // ★2026-08-17の事故：SQLは戦闘力を見ずに必ず1つ落としていたのに、
  //   クライアントの floorAfterLose だけ「戦闘力が足りていれば落ちない」を計算していた。
  //   画面の「次は◯階から」とサーバーの結果がズレる（権威はサーバー）。
  const body = bodyOf('v2_arena_fight')
  assert.match(body, /c_drop\s+constant int := 1;/, '落ちる階数がSQLにある')
  assert.equal(LOSE_DROP, 1, 'JS側の落ちる階数')
  assert.match(body, /v_next := greatest\(1, v_floor - c_drop\)/, '必ず1つ落とす')
  // JS側も戦闘力で結果が変わらないこと（下限が復活したらここで落ちる）
  assert.equal(floorAfterLose(10), 10 - LOSE_DROP)
  assert.equal(floorAfterLose(10, 10 ** 9), 10 - LOSE_DROP, '戦闘力で結果が変わっている')
})

test('v2_sell_materials は検証を全部済ませてから素材を引く（部分的に消えない）', () => {
  const body = bodyOf('v2_sell_materials')
  // ★plpgsql は例外を投げない限りロールバックしない。
  //   「引いてから足りないと気付いて return」だと**引かれたまま**になる
  const checkAt = body.search(/if v_ok <> v_req then/)
  const updateAt = body.search(/update public\.v2_player_materials/)
  assert.notEqual(checkAt, -1, '所持数の検証がある')
  assert.notEqual(updateAt, -1, '素材を引くUPDATEがある')
  assert.ok(checkAt < updateAt, '検証より前に素材を引いている')
  // 金額はサーバーが持つ列から計算する（クライアントの申告を使わない）
  assert.match(body, /sum\(q\.qty \* m\.sell\)/, '売値は v2_materials.sell から計算する')
})
