import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// バトルフロンティアⅡ — テスト用アカウント（クローズドテスト）の見張り
// ------------------------------------------------------------
// ★「開発限定のゲートは明示指示があるまで緩めない」を守れているかを機械的に確かめる。
//   テスターは**名簿に載っている人だけ**・名簿に足せるのは**is_admin だけ**。

test('★Ⅱに入れるのは 公開後 or 管理者 or 名簿のテスター だけ', async () => {
  const { canPlayV2, V2_PUBLIC } = await import('../../lib/gameMode.js')
  assert.equal(canPlayV2(true, false), true, '管理者')
  assert.equal(canPlayV2(false, true), true, 'テスター')
  // ★ここが本丸。どちらでもない人は V2_PUBLIC のときだけ
  assert.equal(canPlayV2(false, false), V2_PUBLIC, '関係ない人まで通してはいけない')
  assert.equal(canPlayV2(), V2_PUBLIC)
})

test('★サーバー側も同じ判定（画面だけのゲートにしない）', () => {
  const body = SQL.slice(SQL.lastIndexOf('create or replace function public.v2_is_dev'))
  assert.match(body, /profiles p where p\.id = auth\.uid\(\)/, 'is_admin を見ていない')
  assert.match(body, /exists \(select 1 from public\.v2_testers t where t\.id = auth\.uid\(\)\)/,
    'テスター名簿を見ていない')
})

// ★テスターがテスターを増やせると、1つ漏れただけで際限なく広がる
test('★名簿に足せるのは is_admin だけ（v2_is_dev では足せない）', () => {
  const i = SQL.indexOf('create or replace function public.v2_dev_create_tester')
  assert.notEqual(i, -1, 'v2_dev_create_tester がSQLに無い')
  const body = SQL.slice(i, SQL.indexOf('\n$$;', i))
  assert.match(body, /is_admin from public\.profiles/, 'is_admin を見ていない')
  assert.ok(!/v2_is_dev\(\)/.test(body), 'v2_is_dev で通してしまっている（テスターが増やせる）')
  // 認証ユーザが先に居ること
  assert.match(body, /from auth\.users u where u\.id = p_user_id/, 'auth.users の存在を確かめていない')
})

test('★テスター名簿は自分の行しか見えない・自分では書けない', () => {
  assert.match(SQL, /create policy "v2_testers_read_self"[\s\S]{0,160}using \(id = auth\.uid\(\)\)/,
    '自分の行だけ、になっていない')
  assert.match(SQL, /grant select on table public\.v2_testers to authenticated/, 'select の許可が無い')
  for (const bad of ['insert', 'update', 'delete', 'all']) {
    assert.ok(!new RegExp(`grant ${bad}[^;]*on table public\\.v2_testers to authenticated`).test(SQL),
      `v2_testers に ${bad} を許してしまっている`)
  }
  assert.match(SQL, /revoke all on table public\.v2_testers from anon/, 'anon を止めていない')
})

test('★画面：テスト用アカウントを作れるのは管理者だけ／自分のセッションを飛ばさない', () => {
  const home = src('../pages/V2Home.jsx')
  assert.match(home, /\{isAdmin && <V2TestAccount \/>\}/, '管理者以外にも出している')
  const panel = src('../components/V2TestAccount.jsx')
  // ★いつもの supabase で signUp すると自分がログアウトされる
  assert.match(panel, /persistSession: false/, '使い捨てクライアントを使っていない')
  assert.ok(!/supabase\.auth\.signUp/.test(panel), '自分のクライアントで signUp している（ログアウトされる）')
  assert.match(panel, /tmp\.auth\.signUp/, '使い捨てクライアントで signUp していない')
})

// ※V2_PUBLIC / CREATE_MODE の値そのものはここで固定しない。
//   「いつでも切り替えられるように」（2026-08-26 ユーザー指示）なので、
//   値を書いたテストがあると切り替えのたびに落ちる。
//   危ない組み合わせ（V2_PUBLIC=false なのに CREATE_MODE に v2 が入っている＝
//   Ⅱを作らせたのに入れない行き止まり）は src/lib/gameMode.test.js が縛っている。
