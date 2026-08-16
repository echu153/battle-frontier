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
