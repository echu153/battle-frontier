// v2cap サブ垢の見張りのテスト（node --test）
//   ★止めない・IPも端末の印もそのままは残さない・一覧は公開したあとも管理者だけ・ホームを開いたときと作った直後に送る、を見張る。
//   SQL まで通した確かめは scratchpad の watch_check.mjs（PGlite・2026-11-06・塩は1回だけ・権限・救援で一緒・アカウント削除）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEVICE_KEY, DEVICE_RE, deviceMark, pairFacts, pairStrength, shortDate } from './altWatch.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const SEC_HEAD = '-- ===== 4-2. サブ垢の見張り'
const secOf = () => {
  const i = SQL.indexOf(SEC_HEAD)
  assert.ok(i > 0, '§4-2 がある')
  const start = SQL.lastIndexOf('-- ====', i - 1)
  const end = SQL.indexOf('-- ===== 5. 出撃の精算', i)
  return SQL.slice(start, SQL.lastIndexOf('-- ====', end - 1))
}
const fnOf = (sec, name) => {
  const i = sec.indexOf(`create or replace function public.${name}(`)
  assert.ok(i >= 0, name)
  return sec.slice(i, sec.indexOf('\n$$;', i) + 4)
}
const memStore = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }
}

test('端末の印：無ければ作って覚え、次からは同じものを返す', () => {
  const s = memStore()
  const a = deviceMark(s)
  assert.ok(DEVICE_RE.test(a), a)
  assert.equal(s.m.get(DEVICE_KEY), a)
  assert.equal(deviceMark(s), a)
  // 変な値が入っていたら作り直す（サーバーは形の違う印を残さない）
  s.m.set(DEVICE_KEY, "'; drop --")
  const b = deviceMark(s)
  assert.ok(DEVICE_RE.test(b) && b !== a)
  // 覚えられない（シークレットモードなど）ときは送らない
  assert.equal(deviceMark({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }), null)
  assert.equal(deviceMark(undefined), null)
  // ブラウザの randomUUID の形も通る
  assert.ok(DEVICE_RE.test('3b241101-e2bb-4255-8caf-4136c566a962'))
})

test('一覧の見え方：同じ端末が一番強い・同じIPだけは決めつけない', () => {
  assert.equal(pairStrength({ device: true, ip: 0, rescue: 0 }).key, 'strong')
  assert.equal(pairStrength({ device: false, ip: 1, rescue: 3 }).key, 'mid')
  assert.equal(pairStrength({ device: false, ip: 2, rescue: 0 }).key, 'weak')
  assert.deepEqual(pairFacts({ device: true, atCreate: true, ip: 2, rescue: 4 }), ['同じ端末（作ったときから）', '同じIP 2か所', '救援で一緒 4回'])
  assert.deepEqual(pairFacts({ device: false, ip: 1, rescue: 0 }), ['同じIP'])
  // 日本時間の日付（UTCの15時は次の日）
  assert.equal(shortDate('2026-11-06T15:30:00Z'), '11/07')
  assert.equal(shortDate(null), '—')
  assert.equal(shortDate('x'), '—')
})

test('SQL §4-2：IPも端末の印もそのままは残さない・塩はだれも読めず作り直さない', () => {
  const sec = secOf()
  // 表は画面から開けない
  for (const t of ['v2cap_watch_salt', 'v2cap_watch']) {
    assert.ok(sec.includes(`alter table public.${t} enable row level security;`), `${t} RLS`)
    assert.ok(sec.includes(`revoke all on public.${t} from public, anon, authenticated;`), `${t} を閉じる`)
  }
  assert.ok(sec.includes('on conflict (id) do nothing;'), '塩は最初の1回だけ作る（作り直すと記録と突き合わせられない）')
  assert.ok(sec.includes('user_id   uuid not null references auth.users(id) on delete cascade'), 'アカウントを消したら記録も消える')
  // 記録は塩を混ぜた sha256 だけ
  const hash = fnOf(sec, 'v2cap_watch_hash')
  assert.ok(hash.includes("encode(sha256(convert_to((select s.salt from public.v2cap_watch_salt s where s.id = 1) || '|' || p_kind || '|' || btrim(p_value), 'UTF8')), 'hex')"))
  assert.ok(sec.includes('revoke all on function public.v2cap_watch_hash(text, text) from public, anon, authenticated;'), '塩の計算は中だけ')
  const touch = fnOf(sec, 'v2cap_watch_touch')
  assert.ok(touch.includes("from (values ('ip', public.v2cap_watch_hash('ip', v_ip)),"), 'IPは塩を混ぜてから入れる')
  assert.ok(touch.includes("('device', public.v2cap_watch_hash('device', v_dev))) as x(kind, hash)"), '端末の印も塩を混ぜてから入れる')
  assert.equal((touch.match(/insert into /g) || []).length, 1, '書きこむのは1か所')
  // 端末の印の形は画面と同じ
  assert.ok(touch.includes(`if v_dev !~ '${DEVICE_RE.source}' then v_dev := null; end if;`), '端末の印の形が画面と同じ')
  // IPは返さない・見出しの名前は管理者だけ
  const ret = touch.slice(touch.indexOf("return jsonb_build_object('ok', true"))
  assert.ok(ret.includes("'ip', v_ip is not null"), '読めたかどうかだけ返す')
  assert.ok(!/v_ip(?! is not null)/.test(ret) && !ret.includes('v_dev,') && !ret.includes('v_h->>'), 'IPも端末の印も、見出しの値も返さない')
  assert.ok(touch.includes("'heads', case when v_admin then"))
  assert.ok(touch.includes("v_src := case when coalesce(v_h->>'cf-connecting-ip', '') <> '' then 'cf-connecting-ip'"), 'IPの見出しは cf-connecting-ip が先')
  // 公開まで開発者だけ（v2cap_is_dev）・画面から呼べる
  assert.ok(touch.includes('if not public.v2cap_is_dev() then'))
  assert.ok(sec.includes('grant execute on function public.v2cap_watch_touch(text, boolean) to authenticated;'))
})

test('SQL §4-2：一覧は公開したあとも管理者だけ・読むだけ', () => {
  const sec = secOf()
  const pairs = fnOf(sec, 'v2cap_watch_pairs')
  assert.ok(pairs.includes('if not public.v2cap_is_dev() then'))
  assert.ok(pairs.includes("if not coalesce((select pr.is_admin from public.profiles pr where pr.id = v_uid), false) then"), 'v2cap_is_dev を開けても管理者だけ')
  assert.ok(!/\b(insert into|update public|delete from)\b/.test(pairs), '一覧は書きこまない')
  assert.ok(pairs.includes('order by p.device desc, q.rescue desc, p.ip desc, p.last_at desc'), '同じ端末→救援で一緒→同じIP→最近')
  assert.ok(pairs.includes("bool_or(a.kind = 'device' and a.at_create and b.at_create) as at_create"), '「作ったときから」は端末だけで見る')
  assert.ok(sec.includes('grant execute on function public.v2cap_watch_pairs(int) to authenticated;'))
  // 流す追加分（作業フォルダ直下・git に入れない）があれば全文の §4-2 と同じ
  let delta = null
  try { delta = read('../../../v2cap_watch_20261106.sql') } catch { /* 別の作業場所には無い */ }
  if (delta) assert.ok(delta.includes(sec.trimEnd()), '流す追加分と全文の §4-2 が同じ')
})

test('画面：ホームを開いたときと作った直後に送る・見張りの画面は管理者だけ・読むだけ', () => {
  const home = read('../pages/V2capHome.jsx')
  assert.ok(home.includes("supabase.rpc('v2cap_watch_touch', { p_device: deviceMark(), p_create: create }).then(() => {}, () => {})"), '失敗しても止めない')
  assert.match(home, /if \(!p\?\.is_admin\) \{[^\n]*return \}\n\s+touchWatch\(\)\n/, '開いたとき（入れる人だけ）')
  assert.match(home, /setInventory\(\[\]\)\n\s+touchWatch\(true\)/, 'キャラを作った直後')
  assert.ok(home.includes("{isAdmin && <button onClick={() => setScreen('altWatch')}"), '開発用の枠のボタンは管理者だけ')
  assert.ok(home.includes("{screen === 'altWatch' && isAdmin && ("), '画面も管理者だけ')
  const view = read('../components/V2capAltWatch.jsx')
  assert.deepEqual([...view.matchAll(/supabase\.(rpc|from)\('(\w+)'/g)].map(m => m[2]), ['v2cap_watch_pairs'], '一覧を読むだけ')
})
