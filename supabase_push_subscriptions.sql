-- ============================================================
-- レイド通知（Web Push）の購読保存テーブル。
--   ・クライアントが pushManager.subscribe した購読を upsert（RLSで本人のみ）。
--   ・送信は Edge Function send-raid-push が service_role で全件読み取り、cronが毎日21/22時に叩く。
-- ============================================================
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text,
  auth       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_sub_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 本人のみ自分の購読を登録/参照/削除できる。送信側(Edge)は service_role でRLSを跨いで全件読む。
drop policy if exists push_sub_owner on public.push_subscriptions;
create policy push_sub_owner on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
