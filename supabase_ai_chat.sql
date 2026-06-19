-- ============================================================
-- AI相談アシスタント：会話用LLMの「1日N回/ユーザー」上限管理
--   Edge Function ai-chat から service_role で ai_chat_consume を呼ぶ。
--   JST(=UTC+9)の暦日でカウントし、日付が変われば自動リセット。
-- ============================================================

create table if not exists public.ai_chat_usage (
  user_id  uuid not null,
  day      date not null,                 -- JSTの暦日
  count    int  not null default 0,
  primary key (user_id, day)
);

alter table public.ai_chat_usage enable row level security;
-- 直接の読み書きは不可（RPC=SECURITY DEFINER 経由のみ）。閲覧したい場合は管理者ポリシーを別途。

-- 1回分消費して残り回数を返す。上限到達なら -1 を返す（消費しない）。
-- p_user は Edge Function が検証済みのJWTから渡す（service_role 専用）。
create or replace function public.ai_chat_consume(p_user uuid, p_limit int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_day   date := (now() at time zone 'Asia/Tokyo')::date;
  v_count int;
begin
  if p_user is null then return -1; end if;

  insert into public.ai_chat_usage (user_id, day, count)
  values (p_user, v_day, 0)
  on conflict (user_id, day) do nothing;

  select count into v_count from public.ai_chat_usage
  where user_id = p_user and day = v_day
  for update;

  if v_count >= greatest(p_limit, 0) then
    return -1;                                  -- 上限到達（消費しない）
  end if;

  update public.ai_chat_usage set count = count + 1
  where user_id = p_user and day = v_day;

  return greatest(p_limit, 0) - (v_count + 1);   -- 残り回数
end;
$func$;

-- anon/authenticated には付与しない。Edge Function が使う service_role にのみ許可する。
revoke all on function public.ai_chat_consume(uuid, int) from public, anon, authenticated;
grant execute on function public.ai_chat_consume(uuid, int) to service_role;

-- 任意：管理者が利用状況を見るための参照ポリシー
drop policy if exists ai_chat_usage_admin_read on public.ai_chat_usage;
create policy ai_chat_usage_admin_read on public.ai_chat_usage
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- 古いログの掃除（任意・pg_cron等で）:
--   delete from public.ai_chat_usage where day < (now() at time zone 'Asia/Tokyo')::date - 7;
