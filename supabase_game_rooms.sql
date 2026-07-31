-- ============================================================
-- 娯楽(トランプ広場/麻雀/双極盤)の部屋一覧をDBにも保存する
--   これまで部屋一覧は Realtime の presence だけで持っていたため、
--   ホストの通信が一瞬でも切れる(スマホの画面オフ・アプリ切替・電波の谷)と
--   presence が消え、他の人の一覧から部屋が丸ごと消えていた。
--   → DBに「掲示」を残し、25秒ごとの更新が90秒途切れるまでは一覧に出す。
--   presence(即時)とDB(耐久)の両方をクライアント側でマージして表示する。
-- 単独で実行可。他のSQLとの適用順は問わない(profiles等の保護列に触れないため)。
-- ============================================================

create table if not exists public.game_rooms (
  room_id    text primary key,
  game       text not null check (game in ('cards', 'mahjong', 'othello')),
  title      text not null,
  host_id    uuid not null,
  host_name  text not null,
  status     text not null default 'waiting',   -- waiting | playing
  meta       jsonb not null default '{}'::jsonb, -- gameType/bet/rules/count など画面表示用
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists game_rooms_game_updated_idx on public.game_rooms (game, updated_at desc);

alter table public.game_rooms enable row level security;

-- 読み取りはログイン者全員。書き込みは下のRPC(SECURITY DEFINER)経由のみ許可する
drop policy if exists game_rooms_select on public.game_rooms;
create policy game_rooms_select on public.game_rooms
  for select to authenticated using (true);

-- ---- ホストが自分の部屋を掲示/更新する(25秒ごとのキープアライブでも呼ばれる) ----
create or replace function public.upsert_game_room(
  p_room_id   text,
  p_game      text,
  p_title     text,
  p_host_name text,
  p_status    text default 'waiting',
  p_meta      jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_game not in ('cards', 'mahjong', 'othello') then raise exception 'unknown game'; end if;

  insert into public.game_rooms as g (room_id, game, title, host_id, host_name, status, meta, updated_at)
  values (
    p_room_id, p_game,
    left(coalesce(p_title, ''), 40), auth.uid(), left(coalesce(p_host_name, ''), 20),
    case when p_status in ('waiting', 'playing') then p_status else 'waiting' end,
    coalesce(p_meta, '{}'::jsonb), now()
  )
  on conflict (room_id) do update
    set title      = excluded.title,
        host_name  = excluded.host_name,
        status     = excluded.status,
        meta       = excluded.meta,
        updated_at = now()
    where g.host_id = auth.uid();  -- 他人の部屋は書き換えられない
end $$;

-- ---- 部屋を閉じる(退室/解散時。ホスト本人のみ) ----
create or replace function public.close_game_room(p_room_id text)
returns void
language sql security definer set search_path = public as $$
  delete from public.game_rooms where room_id = p_room_id and host_id = auth.uid();
$$;

-- ---- 部屋一覧(90秒以内に更新のあるものだけ) ----
create or replace function public.list_game_rooms(p_game text)
returns setof public.game_rooms
language plpgsql security definer set search_path = public as $$
begin
  -- 古い掲示の掃除(ホストが閉じずに落ちた分)。頻繁に呼ばれるので条件は緩めに
  delete from public.game_rooms where updated_at < now() - interval '10 minutes';

  return query
    select * from public.game_rooms
     where game = p_game
       and updated_at > now() - interval '90 seconds'
     order by updated_at desc
     limit 50;
end $$;

grant execute on function public.upsert_game_room(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.close_game_room(text) to authenticated;
grant execute on function public.list_game_rooms(text) to authenticated;
