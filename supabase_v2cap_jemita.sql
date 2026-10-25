-- ============================================================
-- バトルフロンティアⅡ（v2cap）— AI案内役「ジェミータ」（Claude）の表と関数
-- ------------------------------------------------------------
-- 2026-10-26 ユーザー指示「V2でClaude Consoleを用いてジェミータを作りたい・1人1日10回制限」
--   ＋ユーザー選択「管理者は無制限」「会話は記録する（管理者だけ読める・30日で消す）」
-- ・Claude を呼ぶのは Edge Function「v2cap-jemita」（supabase/functions/v2cap-jemita/index.ts）。鍵（ANTHROPIC_API_KEY）はそちらの秘密の設定にだけ置く
-- ・回数・記録・資料はこの表。画面（anon / authenticated）からは直接読み書きできない（RLS・権限なし）。
--   画面が呼べるのは残りの回数を見る v2cap_jemita_left だけ。ほかは Edge Function（service_role）専用
-- ・日付の切り替えは毎朝5時（日本時間）。ほかのゲームの機能と同じ
-- ・資料（ゲームの資料と決まり）は別の SQL「supabase_v2cap_jemita_kb.sql」で入れる（道具 tools/v2cap-jemita-kb.mjs が作る）。
--   ★この SQL を先に流し、そのあと資料の SQL を流す
-- 何度流してもよい
-- ============================================================

-- ===== 1日の回数（上限はここで決める）=====
create or replace function public.v2cap_jemita_limit()
returns int
language sql
immutable
as $$ select 10 $$;

create table if not exists public.v2cap_jemita_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,          -- 日本時間の朝5時で切り替わる日
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.v2cap_jemita_usage enable row level security;
revoke all on public.v2cap_jemita_usage from public, anon, authenticated;
grant select, insert, update on public.v2cap_jemita_usage to service_role;

-- ===== 会話の記録（30日で消す・読めるのは管理者だけ）=====
create table if not exists public.v2cap_jemita_log (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  question    text not null,
  answer      text not null,
  source      text not null check (source in ('llm', 'blocked', 'refusal', 'guard')),   -- llm＝Claudeの答え／blocked＝送る前に断った／refusal＝Claudeが断った／guard＝答えを差し止めた
  model       text,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cache_write_tokens int
);
create index if not exists v2cap_jemita_log_user_at on public.v2cap_jemita_log (user_id, created_at desc);
create index if not exists v2cap_jemita_log_at on public.v2cap_jemita_log (created_at);
alter table public.v2cap_jemita_log enable row level security;
revoke all on public.v2cap_jemita_log from public, anon, authenticated;
grant select on public.v2cap_jemita_log to authenticated;
grant select, insert, delete on public.v2cap_jemita_log to service_role;
grant usage on sequence public.v2cap_jemita_log_id_seq to service_role;
drop policy if exists v2cap_jemita_log_admin_read on public.v2cap_jemita_log;
create policy v2cap_jemita_log_admin_read on public.v2cap_jemita_log
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ===== 資料（1行だけ）=====
create table if not exists public.v2cap_jemita_kb (
  id         int primary key default 1 check (id = 1),
  version    text not null,      -- 資料の版（src/v2cap/lib/jemitaKbVersion.js と同じ値）
  rules      text not null,      -- ジェミータの決まり（src/v2cap/lib/jemitaPrompt.js）
  body       text not null,      -- ゲームの資料（src/v2cap/lib/jemitaKb.js）
  updated_at timestamptz not null default now()
);
alter table public.v2cap_jemita_kb enable row level security;
revoke all on public.v2cap_jemita_kb from public, anon, authenticated;
grant select on public.v2cap_jemita_kb to service_role;

-- ===== 1回ぶん使う（Edge Function 専用）=====
-- 返すのは使ったあとの残りの回数。上限に届いていれば -1（使わない）。管理者は 999999（数えない＝無制限）。
-- ついでに30日より前の記録を消す（索引つき・数行ずつなので軽い）
create or replace function public.v2cap_jemita_consume(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Asia/Tokyo' - interval '5 hours')::date;
  v_limit int  := public.v2cap_jemita_limit();
  v_count int;
begin
  if p_user is null then return -1; end if;
  delete from public.v2cap_jemita_log where created_at < now() - interval '30 days';
  if exists (select 1 from public.profiles where id = p_user and is_admin) then
    return 999999;
  end if;
  insert into public.v2cap_jemita_usage (user_id, day, count) values (p_user, v_day, 0)
  on conflict (user_id, day) do nothing;
  select count into v_count from public.v2cap_jemita_usage where user_id = p_user and day = v_day for update;
  if v_count >= v_limit then return -1; end if;
  update public.v2cap_jemita_usage set count = count + 1 where user_id = p_user and day = v_day;
  return v_limit - (v_count + 1);
end;
$$;
revoke all on function public.v2cap_jemita_consume(uuid) from public, anon, authenticated;
grant execute on function public.v2cap_jemita_consume(uuid) to service_role;

-- ===== 使った1回を戻す（Claude が失敗したとき・Edge Function 専用）=====
create or replace function public.v2cap_jemita_refund(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Tokyo' - interval '5 hours')::date;
begin
  update public.v2cap_jemita_usage set count = greatest(count - 1, 0) where user_id = p_user and day = v_day;
end;
$$;
revoke all on function public.v2cap_jemita_refund(uuid) from public, anon, authenticated;
grant execute on function public.v2cap_jemita_refund(uuid) to service_role;

-- ===== 今日の残り（画面が開いたときに見る）=====
-- { "left": 7, "limit": 10, "unlimited": false }。管理者は unlimited=true
create or replace function public.v2cap_jemita_left()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Asia/Tokyo' - interval '5 hours')::date;
  v_limit int  := public.v2cap_jemita_limit();
  v_used  int;
begin
  if auth.uid() is null then return jsonb_build_object('left', 0, 'limit', v_limit, 'unlimited', false); end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    return jsonb_build_object('left', v_limit, 'limit', v_limit, 'unlimited', true);
  end if;
  select count into v_used from public.v2cap_jemita_usage where user_id = auth.uid() and day = v_day;
  return jsonb_build_object('left', greatest(v_limit - coalesce(v_used, 0), 0), 'limit', v_limit, 'unlimited', false);
end;
$$;
revoke all on function public.v2cap_jemita_left() from public, anon;
grant execute on function public.v2cap_jemita_left() to authenticated;

-- ===== 見直し用（管理者が SQL Editor で）=====
--   select created_at, source, question, answer, input_tokens, output_tokens, cache_read_tokens
--   from public.v2cap_jemita_log order by created_at desc limit 50;
--   -- この30日に使ったおおよその料金（Haiku 5.5・ドル）
--   select round(sum(coalesce(input_tokens,0))*0.10/1e6 + sum(coalesce(cache_read_tokens,0))*0.01/1e6
--              + sum(coalesce(cache_write_tokens,0))*0.125/1e6 + sum(coalesce(output_tokens,0))*0.50/1e6, 4) as usd
--   from public.v2cap_jemita_log;
