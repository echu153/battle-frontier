-- ============================================================
-- バトルフロンティアⅡ（リメイク版）— レイドボス／救援／フレンド／合成
--   2026-09-06
-- ------------------------------------------------------------
-- 設計は docs/v2-raid-design.md。数値の正は src/v2/lib/raid.js と fusion.js で、
-- **このファイルには同じ値の写しが入っている**（src/v2/lib/raid.test.js が突き合わせる）。
--
-- ★流す順：**supabase_v2_core.sql を全文流したあとに、このファイルを1本流す。**
--   （v2_profiles / v2_inventory / v2_equipment / v2_materials / v2_player_materials に依存）
--
-- ★入れるもの
--   ① v2_friends            … フレンド（申請→承認）。救援の宛先に使う
--   ② v2_raids / v2_raid_members / v2_raid_calls … レイド本体・参加者・救援信号
--   ③ v2_fusion_materials / v2_player_fusions    … 合成素材（レイド報酬）
--   ④ v2_inventory.fused    … 武器に合成で付いた特殊能力（＝レイドボスの名前）
--
-- ⚠v2は「戦闘はクライアントが回して結果を申告する」作りなので、レイドも同じ。
--   サーバーが見張れるのは **1発の上限 ／ 10秒のクールタイム ／ 1時間の期限** の3つだけ。
--   出撃・アリーナと同じ穴で、**一般公開の前にまとめてサーバー権威化する**こと。
-- ============================================================


-- ============================================================
-- ① フレンド
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


-- ============================================================
-- ② レイドボス
-- ------------------------------------------------------------
-- 出撃で 0.4% を引いた人が主催者になり、レイドが1件立つ。
-- 挑戦できるのは1時間。終わってから3時間は次が出ない。参加は最大20人。
-- ============================================================
create table if not exists public.v2_raids (
  id         bigserial primary key,
  host_id    uuid   not null references auth.users(id) on delete cascade,
  boss_key   text   not null,            -- src/v2/lib/raid.js の RAID_BOSSES.key
  area_id    int    not null references public.v2_areas(id),  -- 報酬のルーン素材はここのボス素材
  power      int    not null,            -- ボスの強さの基準（主催者の戦闘力・下限つき）
  hp_max     bigint not null,
  hp_left    bigint not null,
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null,
  killed_at  timestamptz
);
create index if not exists v2_raids_host_idx on public.v2_raids(host_id, ends_at desc);
alter table public.v2_raids enable row level security;
revoke all on table public.v2_raids from anon;
revoke all on table public.v2_raids from authenticated;

create table if not exists public.v2_raid_members (
  raid_id     bigint not null references public.v2_raids(id) on delete cascade,
  player_id   uuid   not null references auth.users(id) on delete cascade,
  is_host     boolean not null default false,
  damage      bigint not null default 0,
  hits        int    not null default 0,
  last_hit_at timestamptz,
  joined_at   timestamptz not null default now(),
  claimed_at  timestamptz,
  primary key (raid_id, player_id)
);
create index if not exists v2_raid_members_player_idx on public.v2_raid_members(player_id);
alter table public.v2_raid_members enable row level security;
revoke all on table public.v2_raid_members from anon;
revoke all on table public.v2_raid_members from authenticated;

-- 救援信号の宛先。ここに載っている人だけがそのレイドへ入れる
create table if not exists public.v2_raid_calls (
  raid_id    bigint not null references public.v2_raids(id) on delete cascade,
  player_id  uuid   not null references auth.users(id) on delete cascade,
  kind       text   not null default 'online',   -- online / friend（国を作ったら country を足す）
  created_at timestamptz not null default now(),
  primary key (raid_id, player_id)
);
create index if not exists v2_raid_calls_player_idx on public.v2_raid_calls(player_id);
alter table public.v2_raid_calls enable row level security;
revoke all on table public.v2_raid_calls from anon;
revoke all on table public.v2_raid_calls from authenticated;

-- ★3つとも**RLSでは何も見せない**（select のポリシーを作っていない）。
--   レイドの中身は v2_raid_list が SECURITY DEFINER で組み立てて返す。
--   他人のレイドの残りHPや参加者を素で引けると、覗き見の入口になるため。

-- ---- 定数（src/v2/lib/raid.js の写し。片方だけ直すと raid.test.js が落ちる）----
create or replace function public.v2_raid_const() returns jsonb
  language sql immutable as $$ select jsonb_build_object(
    'rate', 0.4, 'minutes', 60, 'cooldown_hours', 3, 'max_members', 20,
    'min_power', 6000, 'hp_k', 2000, 'turns', 10,
    'call_max', 50, 'online_minutes', 5,
    'mat_count_max', 6, 'fusion_base_pct', 20, 'fusion_share_pct', 60, 'fusion_host_bonus', 10
  ) $$;

-- ---- 1件ぶんの見え方（参加者つき）----
-- ⚠これは内部ヘルパ。**外から叩かせない**（SECURITY DEFINER の一覧から呼ぶだけ）
create or replace function public.v2_raid_json(p_raid public.v2_raids)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p_raid) || jsonb_build_object(
    'host_name', (select username from public.v2_profiles where id = p_raid.host_id),
    'area_name', (select name from public.v2_areas where id = p_raid.area_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', m.player_id, 'name', p.username, 'damage', m.damage,
        'hits', m.hits, 'is_host', m.is_host, 'claimed_at', m.claimed_at
      ) order by m.damage desc)
      from public.v2_raid_members m
      left join public.v2_profiles p on p.id = m.player_id
      where m.raid_id = p_raid.id
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.v2_raid_json(public.v2_raids) from public;
revoke all on function public.v2_raid_json(public.v2_raids) from anon;
revoke all on function public.v2_raid_json(public.v2_raids) from authenticated;

-- ---- レイドを立てる（出撃で引いた人が呼ぶ）----
-- ⚠**出たかどうかの抽選はクライアント**（出撃・ドロップと同じ作り）。
--   サーバーが見るのは「前のレイドから3時間あいたか」「いま参加中でないか」だけ。
create or replace function public.v2_raid_spawn(p_boss_key text, p_area int, p_power int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c jsonb := public.v2_raid_const();
  v_power int;
  v_hp bigint;
  v_row public.v2_raids;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  if v_me is null then return jsonb_build_object('ok', false, 'error', 'ログインしてください'); end if;
  if p_boss_key is null or p_boss_key = '' then return jsonb_build_object('ok', false, 'error', 'ボスがありません'); end if;
  if not exists (select 1 from public.v2_areas where id = p_area) then
    return jsonb_build_object('ok', false, 'error', 'そのエリアはありません');
  end if;

  -- すでにどこかのレイドに参加している（＝主催中も含む）なら立てない
  if exists (
    select 1 from public.v2_raid_members m join public.v2_raids r on r.id = m.raid_id
     where m.player_id = v_me and r.killed_at is null and r.ends_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'すでにレイドに参加しています');
  end if;

  -- 終わってから3時間はあける
  if exists (
    select 1 from public.v2_raids r
     where r.host_id = v_me
       and coalesce(r.killed_at, r.ends_at) > now() - ((v_c->>'cooldown_hours')::int * interval '1 hour')
  ) then
    return jsonb_build_object('ok', false, 'error', 'まだ次のレイドは現れません');
  end if;

  v_power := greatest((v_c->>'min_power')::int, coalesce(p_power, 0));
  v_hp := (v_c->>'hp_k')::bigint * v_power;

  insert into public.v2_raids (host_id, boss_key, area_id, power, hp_max, hp_left, ends_at)
  values (v_me, p_boss_key, p_area, v_power, v_hp, v_hp,
          now() + ((v_c->>'minutes')::int * interval '1 minute'))
  returning * into v_row;

  insert into public.v2_raid_members (raid_id, player_id, is_host) values (v_row.id, v_me, true);
  return jsonb_build_object('ok', true, 'raid', public.v2_raid_json(v_row));
end;
$$;

-- ---- いまの状況（挑戦中／招かれている／未受取）----
create or replace function public.v2_raid_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_active jsonb; v_invites jsonb; v_unclaimed jsonb;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;

  select public.v2_raid_json(r) into v_active
    from public.v2_raids r join public.v2_raid_members m on m.raid_id = r.id
   where m.player_id = v_me and r.killed_at is null and r.ends_at > now()
   order by r.started_at desc limit 1;

  -- 救援に呼ばれていて、まだ入っていない生きたレイド
  select coalesce(jsonb_agg(public.v2_raid_json(r) order by r.started_at desc), '[]'::jsonb) into v_invites
    from public.v2_raids r join public.v2_raid_calls c on c.raid_id = r.id
   where c.player_id = v_me and r.killed_at is null and r.ends_at > now()
     and not exists (select 1 from public.v2_raid_members m where m.raid_id = r.id and m.player_id = v_me);

  -- 終わっていて、まだ報酬を受け取っていないもの
  select coalesce(jsonb_agg(public.v2_raid_json(r) order by r.started_at desc), '[]'::jsonb) into v_unclaimed
    from public.v2_raids r join public.v2_raid_members m on m.raid_id = r.id
   where m.player_id = v_me and m.claimed_at is null
     and (r.killed_at is not null or r.ends_at <= now());

  return jsonb_build_object('ok', true, 'active', v_active,
                            'invites', coalesce(v_invites, '[]'::jsonb),
                            'unclaimed', coalesce(v_unclaimed, '[]'::jsonb));
end;
$$;

-- ---- 救援に応じて入る ----
create or replace function public.v2_raid_join(p_raid_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_c jsonb := public.v2_raid_const(); v_r public.v2_raids; v_n int;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_r from public.v2_raids where id = p_raid_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのレイドはありません'); end if;
  if v_r.killed_at is not null or v_r.ends_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'そのレイドは終わっています');
  end if;
  if not exists (select 1 from public.v2_raid_calls where raid_id = p_raid_id and player_id = v_me) then
    return jsonb_build_object('ok', false, 'error', '救援に呼ばれていません');
  end if;
  if exists (
    select 1 from public.v2_raid_members m join public.v2_raids r on r.id = m.raid_id
     where m.player_id = v_me and r.killed_at is null and r.ends_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'すでに別のレイドに参加しています');
  end if;
  select count(*) into v_n from public.v2_raid_members where raid_id = p_raid_id;
  if v_n >= (v_c->>'max_members')::int then
    return jsonb_build_object('ok', false, 'error', 'そのレイドは満員です');
  end if;
  insert into public.v2_raid_members (raid_id, player_id) values (p_raid_id, v_me)
    on conflict (raid_id, player_id) do nothing;
  select * into v_r from public.v2_raids where id = p_raid_id;
  return jsonb_build_object('ok', true, 'raid', public.v2_raid_json(v_r));
end;
$$;

-- ---- 殴る ----
-- ⚠与ダメはクライアントの申告。サーバーが見張るのは3つ：
--     ・1発の上限は **最大HPの1/100**（実測の1発は約1/320なので3倍の余裕）
--     ・**10秒に1回まで**（出撃と同じクールタイム。時計のずれを見て9秒で判定する）
--     ・期限を過ぎたら受け付けない
create or replace function public.v2_raid_attack(p_raid_id bigint, p_damage bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_r public.v2_raids;
  v_m public.v2_raid_members;
  v_dmg bigint;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_m from public.v2_raid_members where raid_id = p_raid_id and player_id = v_me;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのレイドに参加していません'); end if;
  if v_m.last_hit_at is not null and v_m.last_hit_at > now() - interval '9 seconds' then
    return jsonb_build_object('ok', false, 'error', 'まだ次の行動はできません');
  end if;

  select * into v_r from public.v2_raids where id = p_raid_id for update;
  if v_r.killed_at is not null then return jsonb_build_object('ok', false, 'error', 'もう討伐されています'); end if;
  if v_r.ends_at <= now() then return jsonb_build_object('ok', false, 'error', '時間切れです'); end if;

  v_dmg := greatest(0, least(coalesce(p_damage, 0), v_r.hp_max / 100));
  v_dmg := least(v_dmg, v_r.hp_left);

  update public.v2_raids
     set hp_left = hp_left - v_dmg,
         killed_at = case when hp_left - v_dmg <= 0 then now() else null end
   where id = p_raid_id returning * into v_r;

  update public.v2_raid_members
     set damage = damage + v_dmg, hits = hits + 1, last_hit_at = now()
   where raid_id = p_raid_id and player_id = v_me;

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'hp_left', v_r.hp_left,
                            'hp_max', v_r.hp_max, 'killed', v_r.killed_at is not null);
end;
$$;

-- ---- 救援信号を出す（主催者だけ）----
create or replace function public.v2_raid_call(p_raid_id bigint, p_targets uuid[], p_kind text default 'online')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_c jsonb := public.v2_raid_const(); v_r public.v2_raids; v_n int;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_r from public.v2_raids where id = p_raid_id;
  if not found or v_r.host_id <> v_me then
    return jsonb_build_object('ok', false, 'error', '自分が呼んだレイドではありません');
  end if;
  if v_r.killed_at is not null or v_r.ends_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'そのレイドは終わっています');
  end if;
  if coalesce(array_length(p_targets, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', '送る相手を選んでください');
  end if;
  if array_length(p_targets, 1) > (v_c->>'call_max')::int then
    return jsonb_build_object('ok', false, 'error', '一度に送れるのは' || (v_c->>'call_max') || '人までです');
  end if;

  insert into public.v2_raid_calls (raid_id, player_id, kind)
  select p_raid_id, t, coalesce(p_kind, 'online')
    from unnest(p_targets) t
   where t <> v_me and exists (select 1 from public.v2_profiles p where p.id = t)
  on conflict (raid_id, player_id) do nothing;

  select count(*) into v_n from public.v2_raid_calls where raid_id = p_raid_id;
  return jsonb_build_object('ok', true, 'called', v_n);
end;
$$;

-- ---- オンライン中の人（救援の宛先）----
-- ★「直近5分のあいだに v2_profiles が更新された人」を動いているとみなす。
--   出撃・強化などのRPCが updated_at を進めるので、遊んでいれば必ず引っかかる。
create or replace function public.v2_raid_online()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_c jsonb := public.v2_raid_const();
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  return jsonb_build_object('ok', true, 'list', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.username, 'lv', p.lv) order by p.updated_at desc)
      from public.v2_profiles p
     where p.id <> v_me
       and p.updated_at > now() - ((v_c->>'online_minutes')::int * interval '1 minute')
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.v2_raid_spawn(text, int, int) from public;
revoke all on function public.v2_raid_spawn(text, int, int) from anon;
revoke all on function public.v2_raid_list() from public;
revoke all on function public.v2_raid_list() from anon;
revoke all on function public.v2_raid_join(bigint) from public;
revoke all on function public.v2_raid_join(bigint) from anon;
revoke all on function public.v2_raid_attack(bigint, bigint) from public;
revoke all on function public.v2_raid_attack(bigint, bigint) from anon;
revoke all on function public.v2_raid_call(bigint, uuid[], text) from public;
revoke all on function public.v2_raid_call(bigint, uuid[], text) from anon;
revoke all on function public.v2_raid_online() from public;
revoke all on function public.v2_raid_online() from anon;
grant execute on function public.v2_raid_spawn(text, int, int) to authenticated;
grant execute on function public.v2_raid_list() to authenticated;
grant execute on function public.v2_raid_join(bigint) to authenticated;
grant execute on function public.v2_raid_attack(bigint, bigint) to authenticated;
grant execute on function public.v2_raid_call(bigint, uuid[], text) to authenticated;
grant execute on function public.v2_raid_online() to authenticated;


-- ============================================================
-- ③ 合成素材と報酬の受け取り
-- ------------------------------------------------------------
-- 合成素材は**ユニークボスと共通の新カテゴリ**（2026-09-06 ユーザー決定）。
-- 名簿の正は src/v2/lib/fusion.js。ここは名簿の写しと所持数を持つ。
-- ============================================================
create table if not exists public.v2_fusion_materials (
  id     text primary key,       -- 'fu:<ボスのkey>'
  name   text not null,
  source text not null default 'raid',   -- raid / unique
  boss   text not null,
  crown  text not null           -- 合成した武器の頭に付く名前（「黒龍の鋼剣」の「黒龍」）
);
alter table public.v2_fusion_materials enable row level security;
drop policy if exists "v2_fusion_materials_read" on public.v2_fusion_materials;
create policy "v2_fusion_materials_read" on public.v2_fusion_materials for select to authenticated using (true);
revoke all on table public.v2_fusion_materials from anon;
grant select on table public.v2_fusion_materials to authenticated;

insert into public.v2_fusion_materials (id, name, source, boss, crown) values
  ('fu:varuzenoku', '黒龍の逆鱗',   'raid', '黒龍ヴァルゼノク',     '黒龍'),
  ('fu:amaza',      '雨摩座の涙石', 'raid', '雨摩座',               '雨摩座'),
  ('fu:zerugiasu',  '雷鋼の動力核', 'raid', '雷鋼機神ゼルギアス',   '雷鋼'),
  ('fu:enma',       '閻魔の冥銭',   'raid', '閻魔',                 '閻魔'),
  ('fu:guraudiosu', '炎獄の熾火片', 'raid', '炎獄王グラウディオス', '炎獄')
on conflict (id) do update set
  name = excluded.name, source = excluded.source, boss = excluded.boss, crown = excluded.crown;

create table if not exists public.v2_player_fusions (
  player_id uuid not null references auth.users(id) on delete cascade,
  fusion_id text not null references public.v2_fusion_materials(id),
  qty       int  not null default 0 check (qty >= 0),
  primary key (player_id, fusion_id)
);
alter table public.v2_player_fusions enable row level security;
drop policy if exists "v2_player_fusions_own" on public.v2_player_fusions;
create policy "v2_player_fusions_own" on public.v2_player_fusions for select to authenticated
  using (player_id = auth.uid());
revoke all on table public.v2_player_fusions from anon;
grant select on table public.v2_player_fusions to authenticated;

-- ---- 報酬を受け取る（1レイドにつき1回）----
-- share ＝ 自分の与ダメ ÷ 最大HP
--   ルーン素材 … 確定。個数 1 + floor(share×10)（最大6）。中身は**そのエリアのボス素材**
--   レア度     … 通常 70-50s ／ レア 25+30s ／ 激レア 5+20s（%）
--   合成素材   … **討伐できたときだけ** 20 + 60s（%）。主催者は +10%
create or replace function public.v2_raid_claim(p_raid_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c jsonb := public.v2_raid_const();
  v_r public.v2_raids;
  v_m public.v2_raid_members;
  v_share numeric;
  v_n int;
  v_i int;
  v_roll numeric;
  v_rarity text;
  v_mid text;
  v_got jsonb := '[]'::jsonb;
  v_fusion jsonb := null;
  v_fid text;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_m from public.v2_raid_members where raid_id = p_raid_id and player_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのレイドに参加していません'); end if;
  if v_m.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'もう受け取っています'); end if;
  select * into v_r from public.v2_raids where id = p_raid_id;
  if v_r.killed_at is null and v_r.ends_at > now() then
    return jsonb_build_object('ok', false, 'error', 'まだ終わっていません');
  end if;

  v_share := least(1, greatest(0, v_m.damage::numeric / greatest(1, v_r.hp_max)));
  v_n := least((v_c->>'mat_count_max')::int, 1 + floor(v_share * 10)::int);

  -- ルーン素材（そのエリアのボス素材。レア度を1個ずつ引く）
  for v_i in 1..v_n loop
    v_roll := random() * 100;
    if v_roll < 5 + 20 * v_share then v_rarity := 'ultra';
    elsif v_roll < (5 + 20 * v_share) + (25 + 30 * v_share) then v_rarity := 'rare';
    else v_rarity := 'normal';
    end if;
    select id into v_mid from public.v2_materials
     where area = v_r.area_id and is_boss and rarity = v_rarity limit 1;
    if v_mid is not null then
      insert into public.v2_player_materials (player_id, material_id, qty) values (v_me, v_mid, 1)
        on conflict (player_id, material_id) do update set qty = public.v2_player_materials.qty + 1;
      v_got := v_got || jsonb_build_array(jsonb_build_object(
        'id', v_mid, 'name', (select name from public.v2_materials where id = v_mid), 'rarity', v_rarity));
    end if;
  end loop;

  -- 合成素材（討伐できたときだけ）
  if v_r.killed_at is not null then
    if random() * 100 < least(100,
         (v_c->>'fusion_base_pct')::numeric + (v_c->>'fusion_share_pct')::numeric * v_share
         + case when v_m.is_host then (v_c->>'fusion_host_bonus')::numeric else 0 end) then
      v_fid := 'fu:' || v_r.boss_key;
      if exists (select 1 from public.v2_fusion_materials where id = v_fid) then
        insert into public.v2_player_fusions (player_id, fusion_id, qty) values (v_me, v_fid, 1)
          on conflict (player_id, fusion_id) do update set qty = public.v2_player_fusions.qty + 1;
        select jsonb_build_object('id', id, 'name', name, 'crown', crown) into v_fusion
          from public.v2_fusion_materials where id = v_fid;
      end if;
    end if;
  end if;

  update public.v2_raid_members set claimed_at = now() where raid_id = p_raid_id and player_id = v_me;
  return jsonb_build_object('ok', true, 'share', round(v_share, 4), 'killed', v_r.killed_at is not null,
                            'materials', v_got, 'fusion', v_fusion);
end;
$$;
revoke all on function public.v2_raid_claim(bigint) from public;
revoke all on function public.v2_raid_claim(bigint) from anon;
grant execute on function public.v2_raid_claim(bigint) to authenticated;


-- ============================================================
-- ④ 合成（鍛冶屋）
-- ------------------------------------------------------------
-- 武器1個 ＋ 合成素材1個 → その武器に特殊能力が付き、名前が「◯◯の××」になる。
-- ★名前は保存しない（equip_id から素の名前が引けるので、fused から毎回作る）。
-- ★強化はこれまで通り＝ v2_fuse は equip_id で見ているので、合成していても
--   「同じ武器名」であれば強化元にも強化素材にもできる（ユーザー指示）。
-- ============================================================
alter table public.v2_inventory add column if not exists fused text;

create or replace function public.v2_fuse_weapon(p_inv_id bigint, p_fusion_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_inv public.v2_inventory;
  v_part text;
  v_boss text;
  v_qty int;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_inv from public.v2_inventory where id = p_inv_id and player_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;

  select e.part into v_part from public.v2_equipment e where e.id = v_inv.equip_id;
  if v_part is distinct from '武器' then
    return jsonb_build_object('ok', false, 'error', '合成できるのは武器だけです');
  end if;

  select boss into v_boss from public.v2_fusion_materials where id = p_fusion_id;
  if v_boss is null then return jsonb_build_object('ok', false, 'error', 'その合成素材はありません'); end if;

  select qty into v_qty from public.v2_player_fusions
   where player_id = v_me and fusion_id = p_fusion_id for update;
  if coalesce(v_qty, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'その合成素材を持っていません'); end if;

  update public.v2_player_fusions set qty = qty - 1 where player_id = v_me and fusion_id = p_fusion_id;
  update public.v2_inventory set fused = v_boss where id = p_inv_id returning * into v_inv;

  return jsonb_build_object('ok', true, 'inv', to_jsonb(v_inv));
end;
$$;
revoke all on function public.v2_fuse_weapon(bigint, text) from public;
revoke all on function public.v2_fuse_weapon(bigint, text) from anon;
grant execute on function public.v2_fuse_weapon(bigint, text) to authenticated;

-- ---- 動作確認用（開発限定）：合成素材を配る ----
create or replace function public.v2_debug_grant_fusion(p_fusion_id text, p_count int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if not exists (select 1 from public.v2_fusion_materials where id = p_fusion_id) then
    return jsonb_build_object('ok', false, 'error', 'その合成素材はありません');
  end if;
  insert into public.v2_player_fusions (player_id, fusion_id, qty)
  values (v_me, p_fusion_id, greatest(1, coalesce(p_count, 1)))
  on conflict (player_id, fusion_id) do update
    set qty = public.v2_player_fusions.qty + greatest(1, coalesce(p_count, 1));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2_debug_grant_fusion(text, int) from public;
revoke all on function public.v2_debug_grant_fusion(text, int) from anon;
grant execute on function public.v2_debug_grant_fusion(text, int) to authenticated;

-- ---- 動作確認用（開発限定）：レイドをその場で呼ぶ ----
-- ★3時間のクールタイムと「参加中のレイド」を先に片付けてから立て直す。
--   未受取の報酬がある行は消さない（受け取りの動作確認ができなくなるため）
create or replace function public.v2_debug_spawn_raid(p_boss_key text, p_area int default 1, p_power int default 6000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- いま参加中のレイドを終わったことにする（報酬は残る）
  update public.v2_raids set ends_at = least(ends_at, now() - interval '1 second')
   where killed_at is null and ends_at > now()
     and id in (select raid_id from public.v2_raid_members where player_id = v_me);
  -- クールタイムぶん、過去のレイドを古い時刻へずらす
  update public.v2_raids
     set started_at = started_at - interval '4 hours',
         ends_at    = ends_at    - interval '4 hours',
         killed_at  = killed_at  - interval '4 hours'
   where host_id = v_me
     and coalesce(killed_at, ends_at) > now() - interval '4 hours';
  return public.v2_raid_spawn(p_boss_key, p_area, p_power);
end;
$$;
revoke all on function public.v2_debug_spawn_raid(text, int, int) from public;
revoke all on function public.v2_debug_spawn_raid(text, int, int) from anon;
grant execute on function public.v2_debug_spawn_raid(text, int, int) to authenticated;
