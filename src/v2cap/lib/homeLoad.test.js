// v2cap：ホームを開いたときにサーバーへの問い合わせを順番に待つ回数（node --test）
// 【確定】2026-10-25 ユーザー指示「V2のホームが表示前に待つ問い合わせを減らして（約5回→2〜3回）」：
//   入口（App.jsx の checkChar）の1回＋ホームの1回（管理者かどうかと、この版のキャラ・持ち物を同時に聞く）。
//   前は getUser（毎回サーバーへ行く）→管理者→getUser→キャラと持ち物 の4回を順番に待っていた（このPCからは1回およそ0.3秒）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // 手元は CRLF のことがある
const code = SRC.replace(/^[ \t]*\/\/.*$/gm, '')   // 説明の行は見ない

test('ホームはだれがログインしているかを端末のセッションで見る（getUser でサーバーへ聞きに行かない）', () => {
  assert.ok(!code.includes('auth.getUser('), 'getUser は使わない（1回ぶん待ちが増える）')
  assert.ok(code.includes('supabase.auth.getSession()'), 'getSession で見る')
})

test('開いたときは 管理者かどうか と この版のキャラ・持ち物 を1回で聞く', () => {
  const a = code.indexOf('useEffect(() => {\n    let alive = true')
  assert.ok(a >= 0, '開いたときの読み込み')
  const body = code.slice(a, code.indexOf('}, [nav, applyCap])', a))
  const all = body.indexOf('await Promise.all([')
  assert.ok(all >= 0, 'まとめて聞く')
  assert.ok(body.indexOf("from('profiles')") > all && body.indexOf('fetchCap(uid)') > all, '管理者とキャラ・持ち物が同じ Promise.all の中')
  // 待つのは セッション（端末）と まとめた1回 の2つだけ
  assert.equal((body.match(/\bawait\b/g) || []).length, 2, `await は2つだけ：${(body.match(/\bawait\b/g) || []).length}`)
  // キャラと持ち物は1回で（fetchCap）
  const f = code.slice(code.indexOf('const fetchCap ='), code.indexOf('])', code.indexOf('const fetchCap =')))
  assert.ok(f.includes("from('v2cap_profiles')") && f.includes("from('v2cap_inventory')"), 'fetchCap はキャラと持ち物を一緒に聞く')
})
