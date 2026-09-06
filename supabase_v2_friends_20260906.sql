-- ============================================================
-- バトルフロンティアⅡ（リメイク版）— フレンド
--   2026-09-06 ／ **①本目**
-- ------------------------------------------------------------
-- ★流す順（レイドまわりは4本あります）
--     ① supabase_v2_friends_20260906.sql   フレンド
--     ② supabase_v2_fusion_20260906.sql    合成素材と「合成」
--     ③ supabase_v2_raid_20260906.sql      レイドボスと救援
--     ④ supabase_v2_ability_move_20260906.sql 特殊能力をルーンから合成へ移す
--   どれも supabase_v2_core.sql を全文流したあとに、**この順番で**流してください。
--
-- ★これは独立しています（他のファイルに依存しません）。
--
-- 設計は docs/v2-raid-design.md。数値の正は src/v2/lib/ 以下で、
-- **このファイルには同じ値の写しが入っている**（raid.test.js が突き合わせる）。
-- ============================================================

-- ============================================================
-- フレンド
-- ------------------------------------------------------------
-- 申請 → 承認で成立。どちらからでも解除できる。上限100人。
-- ★救援の宛先に使うだけなので、持つのは「誰と誰が」と状態だけ。
-- ============================================================
create table if not exists public.v2_friends (
  id          bigserial primary key,
  requester   uuid not null references auth.users(id) on delete cascade,
  addressee   uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending',   -- pending / accepted
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester <> addressee)
);
-- 同じ2人の行は1本だけ（どちらから申請しても重複しない）
create unique index if not exists v2_friends_pair_uniq
  on public.v2_friends (least(requester, addressee), greatest(requester, addressee));
create index if not exists v2_friends_req_idx on public.v2_friends(requester);
create index if not exists v2_friends_adr_idx on public.v2_friends(addressee);

alter table public.v2_friends enable row level security;
-- 見えるのは**自分が関わっている行だけ**（他人の交友関係は配らない）
drop policy if exists "v2_friends_own" on public.v2_friends;
create policy "v2_friends_own" on public.v2_friends for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
revoke all on table public.v2_friends from anon;
revoke all on table public.v2_friends from authenticated;
grant select on table public.v2_friends to authenticated;

-- 上限（src/v2/lib/friends.js の FRIEND_MAX と同じ値）
create or replace function public.v2_friend_max() returns int
  language sql immutable as $$ select 100 $$;

-- ---- 申請する（名前で探す）----
create or replace function public.v2_friend_request(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_n int; v_row public.v2_friends;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  if v_me is null then return jsonb_build_object('ok', false, 'error', 'ログインしてください'); end if;
  select id into v_id from public.v2_profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'その名前の人が見つかりません'); end if;
  if v_id = v_me then return jsonb_build_object('ok', false, 'error', '自分には申請できません'); end if;

  select count(*) into v_n from public.v2_friends
   where status = 'accepted' and (requester = v_me or addressee = v_me);
  if v_n >= public.v2_friend_max() then
    return jsonb_build_object('ok', false, 'error', 'フレンドは' || public.v2_friend_max() || '人までです');
  end if;

  select * into v_row from public.v2_friends
   where least(requester, addressee) = least(v_me, v_id)
     and greatest(requester, addressee) = greatest(v_me, v_id);
  if found then
    if v_row.status = 'accepted' then return jsonb_build_object('ok', false, 'error', 'すでにフレンドです'); end if;
    -- 相手からの申請が来ていたら、申請し返した時点で成立させる
    if v_row.addressee = v_me then
      update public.v2_friends set status = 'accepted', accepted_at = now() where id = v_row.id;
      return jsonb_build_object('ok', true, 'status', 'accepted');
    end if;
    return jsonb_build_object('ok', false, 'error', 'すでに申請しています');
  end if;

  insert into public.v2_friends (requester, addressee) values (v_me, v_id);
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- ---- 承認する（申請された側だけ）----
create or replace function public.v2_friend_accept(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_n int;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select count(*) into v_n from public.v2_friends
   where status = 'accepted' and (requester = v_me or addressee = v_me);
  if v_n >= public.v2_friend_max() then
    return jsonb_build_object('ok', false, 'error', 'フレンドは' || public.v2_friend_max() || '人までです');
  end if;
  update public.v2_friends set status = 'accepted', accepted_at = now()
   where id = p_id and addressee = v_me and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'error', 'その申請は見つかりません'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- 解除・申請の取り消し（当事者ならどちらからでも）----
create or replace function public.v2_friend_remove(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  delete from public.v2_friends where id = p_id and (requester = v_me or addressee = v_me);
  if not found then return jsonb_build_object('ok', false, 'error', 'その行は見つかりません'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.v2_friend_request(text) from public;
revoke all on function public.v2_friend_request(text) from anon;
revoke all on function public.v2_friend_accept(bigint) from public;
revoke all on function public.v2_friend_accept(bigint) from anon;
revoke all on function public.v2_friend_remove(bigint) from public;
revoke all on function public.v2_friend_remove(bigint) from anon;
grant execute on function public.v2_friend_request(text) to authenticated;
grant execute on function public.v2_friend_accept(bigint) to authenticated;
grant execute on function public.v2_friend_remove(bigint) to authenticated;
