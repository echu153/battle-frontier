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
--
-- ★強さは**出撃していたエリアの難易度帯だけで決まる**（2026-09-06 ユーザー指示）。
--   挑む人の戦闘力では変わらない。奥のエリアで引くほど強く、報酬も豪華になる。
-- ★1回の挑戦は30ターン。ボスは**ターンが進むほど火力と耐久が上がる**（たかぶり）。
--   この計算はクライアント（battle.js）が回すので、サーバーは結果だけを受け取る。
-- ============================================================

-- ---- 帯ごとの強さ（src/v2/lib/raid.js の RAID_HP / raidPowerOfTier の写し）----
-- ⚠**勘で書き換えない。** node tools/v2-raid-tune.mjs を回して出た表を貼ること。
--   power … そのエリアのボスの戦闘力 × 2（守りのステを作るもとになる数字）
--   hp        … その帯の**作り込んだ**編成が、想定人数（5人）で1時間フル（360回×5）
--                殴ってちょうど削り切れる量。★ソロだと1時間で2割ほどしか削れない
--   ultra_pct … 報酬の激レア素材の確率(%)。**帯だけで決まる**（①3% 〜 ⑧7%）
create table if not exists public.v2_raid_tiers (
  tier      int    primary key,
  power     int    not null,
  hp        bigint not null,
  ultra_pct numeric not null default 3   -- 激レア素材の確率(%)。帯だけで決まる
);
alter table public.v2_raid_tiers add column if not exists ultra_pct numeric not null default 3;
alter table public.v2_raid_tiers enable row level security;
drop policy if exists "v2_raid_tiers_read" on public.v2_raid_tiers;
create policy "v2_raid_tiers_read" on public.v2_raid_tiers for select to authenticated using (true);
revoke all on table public.v2_raid_tiers from anon;
grant select on table public.v2_raid_tiers to authenticated;

insert into public.v2_raid_tiers (tier, power, hp, ultra_pct) values
  (1,   2572,    1900000, 3),
  (2,   3720,    4800000, 3),
  (3,   5588,   15000000, 4),
  (4,   9212,   19000000, 4),
  (5,  26288,  260000000, 5),
  (6,  48824,  580000000, 5),
  (7,  69538,  930000000, 6),
  (8,  90494, 1500000000, 7)
on conflict (tier) do update set
  power = excluded.power, hp = excluded.hp, ultra_pct = excluded.ultra_pct;

create table if not exists public.v2_raids (
  id         bigserial primary key,
  host_id    uuid   not null references auth.users(id) on delete cascade,
  boss_key   text   not null,            -- src/v2/lib/raid.js の RAID_BOSSES.key
  area_id    int    not null references public.v2_areas(id),  -- 報酬のルーン素材はここのボス素材
  tier       int    not null,            -- そのエリアの難易度帯。強さも報酬もこれで決まる
  power      int    not null,            -- ボスの戦闘力（v2_raid_tiers の写し）
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
    'turns', 30, 'ramp_atk', 8, 'ramp_def', 6,
    'power_mult', 2, 'atk_mult', 0.06,
    'call_max', 50, 'online_minutes', 5,
    'tier_share_a', 0.25, 'tier_share_b', 0.10, 'tier_share_c', 0.03,
    'fusion_pct', 1,
    'exp_min', 8, 'exp_max', 11,
    'box_mat', 3, 'box_ultra', 10, 'box_rare', 30, 'box_fusion_pct', 3
  ) $$;

-- ---- 貢献度のティア（★share だけで決まる）----
-- ★主催者とMVPは**別枠の箱**でもらうので、ここでは優遇しない
--   （src/v2/lib/raid.js の tierOfShare と同じ規則）
create or replace function public.v2_raid_reward_tier(p_share numeric)
returns text language sql immutable as $$
  select case
    when p_share >= 0.25 then 'A'
    when p_share >= 0.10 then 'B'
    when p_share >= 0.03 then 'C'
    else 'D' end
$$;

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
--   ★**強さはサーバーが決める**（エリアの帯 → v2_raid_tiers）。クライアントは
--     どのエリアで引いたかしか送れないので、強さも報酬も盛れない。
create or replace function public.v2_raid_spawn(p_boss_key text, p_area int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c jsonb := public.v2_raid_const();
  v_tier int;
  v_t public.v2_raid_tiers;
  v_row public.v2_raids;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  if v_me is null then return jsonb_build_object('ok', false, 'error', 'ログインしてください'); end if;
  if p_boss_key is null or p_boss_key = '' then return jsonb_build_object('ok', false, 'error', 'ボスがありません'); end if;

  select tier into v_tier from public.v2_areas where id = p_area;
  if v_tier is null then return jsonb_build_object('ok', false, 'error', 'そのエリアはありません'); end if;
  select * into v_t from public.v2_raid_tiers where tier = v_tier;
  if not found then return jsonb_build_object('ok', false, 'error', 'その難易度帯の設定がありません'); end if;

  -- ★そのエリアが解放されていない人はレイドを立てられない（帯を飛ばして報酬だけ取れない）
  if not exists (
    select 1 from public.v2_profiles p
     where p.id = v_me and (v_tier = 1 or p_area = any(coalesce(p.unlocked_areas, '{}')))
  ) then
    return jsonb_build_object('ok', false, 'error', 'そのエリアはまだ解放されていません');
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

  insert into public.v2_raids (host_id, boss_key, area_id, tier, power, hp_max, hp_left, ends_at)
  values (v_me, p_boss_key, p_area, v_tier, v_t.power, v_t.hp, v_t.hp,
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
--     ・1発の上限は **最大HPの1/10**（実測の1発は約1/1800）
--   ★EXPは**サーバーが抽選して配る**（出撃の通常敵と同じ 8〜11）。
--     ・**10秒に1回まで**（出撃と同じクールタイム。時計のずれを見て9秒で判定する）
--     ・期限を過ぎたら受け付けない
create or replace function public.v2_raid_attack(p_raid_id bigint, p_damage bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c jsonb := public.v2_raid_const();
  v_r public.v2_raids;
  v_m public.v2_raid_members;
  v_dmg bigint;
  v_exp int;
  v_lvl jsonb;
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

  v_dmg := greatest(0, least(coalesce(p_damage, 0), v_r.hp_max / 10));
  v_dmg := least(v_dmg, v_r.hp_left);

  update public.v2_raids
     set hp_left = hp_left - v_dmg,
         killed_at = case when hp_left - v_dmg <= 0 then now() else null end
   where id = p_raid_id returning * into v_r;

  update public.v2_raid_members
     set damage = damage + v_dmg, hits = hits + 1, last_hit_at = now()
   where raid_id = p_raid_id and player_id = v_me;

  -- ★EXP（2026-09-06 ユーザー指示「レイドでも経験値を稼げるように」）。
  --   出撃の通常敵と同じ 8〜11。**抽選も付与もサーバー**（言い値は受け取らない）
  v_exp := (v_c->>'exp_min')::int
         + floor(random() * (((v_c->>'exp_max')::int - (v_c->>'exp_min')::int) + 1))::int;
  v_lvl := public.v2_apply_exp(v_me, v_exp);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'hp_left', v_r.hp_left,
                            'hp_max', v_r.hp_max, 'killed', v_r.killed_at is not null,
                            'exp', v_exp, 'level', v_lvl);
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

revoke all on function public.v2_raid_spawn(text, int) from public;
revoke all on function public.v2_raid_spawn(text, int) from anon;
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
grant execute on function public.v2_raid_spawn(text, int) to authenticated;
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
-- ★報酬は**3枠**あり、条件を満たせば**重ねてもらえる**（2026-09-06 ユーザー指示）
--     ① 貢献度  … share（自分の与ダメ ÷ 最大HP）で ティアA〜D
--                  素材の数 A5〜7 / B3〜5 / C2〜3 / D1〜2（帯ボーナスは無し）
--                  激レアは**帯だけ**（v2_raid_tiers.ultra_pct・①3%〜⑧7%）
--                  レアは**ティアだけ**（A30 B24 C18 D12）／残りが通常（★必ず一番多い）
--                  合成素材は**固定1%**
--     ② 主催の箱 … そのレイドを呼んだ人
--     ③ MVPの箱  … いちばん削った人（与ダメ0はMVPにしない）
--                  ②③は**中身が同じ**：素材3個固定・激レア10%・レア30%・合成素材3%
--   ＝主催者がMVPを取って貢献度もAなら、3つとも受け取る。
-- ★合成素材はどの枠も**討伐できたときだけ**。ルーン素材は時間切れでももらえる
-- ⚠数値の正は src/v2/lib/raid.js。raid.test.js が両方を突き合わせている

-- 素材を n 個配って、中身を jsonb で返す内部ヘルパ（3枠とも同じ道を通す）
create or replace function public.v2_raid_grant(
  p_player uuid, p_area int, p_boss_key text, p_killed boolean,
  p_count int, p_ultra numeric, p_rare numeric, p_fusion_pct numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_i int;
  v_roll numeric;
  v_rarity text;
  v_mid text;
  v_got jsonb := '[]'::jsonb;
  v_fusion jsonb := null;
  v_fid text;
begin
  for v_i in 1..greatest(0, coalesce(p_count, 0)) loop
    v_roll := random() * 100;
    if v_roll < p_ultra then v_rarity := 'ultra';
    elsif v_roll < p_ultra + p_rare then v_rarity := 'rare';
    else v_rarity := 'normal';
    end if;
    select id into v_mid from public.v2_materials
     where area = p_area and is_boss and rarity = v_rarity limit 1;
    if v_mid is not null then
      insert into public.v2_player_materials (player_id, material_id, qty) values (p_player, v_mid, 1)
        on conflict (player_id, material_id) do update set qty = public.v2_player_materials.qty + 1;
      v_got := v_got || jsonb_build_array(jsonb_build_object(
        'id', v_mid, 'name', (select name from public.v2_materials where id = v_mid), 'rarity', v_rarity));
    end if;
  end loop;

  -- 合成素材は**討伐できたときだけ**
  if coalesce(p_killed, false) and random() * 100 < coalesce(p_fusion_pct, 0) then
    v_fid := 'fu:' || p_boss_key;
    if exists (select 1 from public.v2_fusion_materials where id = v_fid) then
      insert into public.v2_player_fusions (player_id, fusion_id, qty) values (p_player, v_fid, 1)
        on conflict (player_id, fusion_id) do update set qty = public.v2_player_fusions.qty + 1;
      select jsonb_build_object('id', id, 'name', name, 'crown', crown) into v_fusion
        from public.v2_fusion_materials where id = v_fid;
    end if;
  end if;

  return jsonb_build_object('materials', v_got, 'fusion', v_fusion);
end;
$$;
-- ⚠内部ヘルパ。**外から叩かせない**（叩けると素材を配り放題になる）
revoke all on function public.v2_raid_grant(uuid, int, text, boolean, int, numeric, numeric, numeric) from public;
revoke all on function public.v2_raid_grant(uuid, int, text, boolean, int, numeric, numeric, numeric) from anon;
revoke all on function public.v2_raid_grant(uuid, int, text, boolean, int, numeric, numeric, numeric) from authenticated;

create or replace function public.v2_raid_claim(p_raid_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c jsonb := public.v2_raid_const();
  v_r public.v2_raids;
  v_m public.v2_raid_members;
  v_mvp uuid;
  v_is_mvp boolean;
  v_killed boolean;
  v_rt text;
  v_share numeric;
  v_n int;
  v_lo int;
  v_hi int;
  v_ultra numeric;
  v_rare numeric;
  v_parts jsonb := '[]'::jsonb;
  v_one jsonb;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_m from public.v2_raid_members where raid_id = p_raid_id and player_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのレイドに参加していません'); end if;
  if v_m.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'もう受け取っています'); end if;
  select * into v_r from public.v2_raids where id = p_raid_id;
  if v_r.killed_at is null and v_r.ends_at > now() then
    return jsonb_build_object('ok', false, 'error', 'まだ終わっていません');
  end if;
  v_killed := v_r.killed_at is not null;

  -- MVP＝いちばん削った人（与ダメ0はMVPにしない）
  select player_id into v_mvp from public.v2_raid_members
   where raid_id = p_raid_id and damage > 0 order by damage desc, joined_at limit 1;
  v_is_mvp := v_mvp is not null and v_mvp = v_me;

  v_share := least(1, greatest(0, v_m.damage::numeric / greatest(1, v_r.hp_max)));
  v_rt := public.v2_raid_reward_tier(v_share);

  -- ===== ① 貢献度 =====
  select ultra_pct into v_ultra from public.v2_raid_tiers where tier = v_r.tier;
  v_rare := (case v_rt when 'A' then 30 when 'B' then 24 when 'C' then 18 else 12 end);
  v_lo := (case v_rt when 'A' then 5 when 'B' then 3 when 'C' then 2 else 1 end);
  v_hi := (case v_rt when 'A' then 7 when 'B' then 5 when 'C' then 3 else 2 end);
  v_n := v_lo + floor(random() * ((v_hi - v_lo) + 1))::int;
  v_one := public.v2_raid_grant(v_me, v_r.area_id, v_r.boss_key, v_killed,
                                v_n, v_ultra, v_rare, (v_c->>'fusion_pct')::numeric);
  v_parts := v_parts || jsonb_build_array(
    jsonb_build_object('kind', 'share', 'tier', v_rt) || v_one);

  -- ===== ② 主催の箱 ／ ③ MVPの箱（中身は同じ）=====
  if v_m.is_host then
    v_one := public.v2_raid_grant(v_me, v_r.area_id, v_r.boss_key, v_killed,
                                  (v_c->>'box_mat')::int, (v_c->>'box_ultra')::numeric,
                                  (v_c->>'box_rare')::numeric, (v_c->>'box_fusion_pct')::numeric);
    v_parts := v_parts || jsonb_build_array(jsonb_build_object('kind', 'host') || v_one);
  end if;
  if v_is_mvp then
    v_one := public.v2_raid_grant(v_me, v_r.area_id, v_r.boss_key, v_killed,
                                  (v_c->>'box_mat')::int, (v_c->>'box_ultra')::numeric,
                                  (v_c->>'box_rare')::numeric, (v_c->>'box_fusion_pct')::numeric);
    v_parts := v_parts || jsonb_build_array(jsonb_build_object('kind', 'mvp') || v_one);
  end if;

  update public.v2_raid_members set claimed_at = now() where raid_id = p_raid_id and player_id = v_me;
  return jsonb_build_object('ok', true, 'share', round(v_share, 4), 'killed', v_killed,
                            'reward_tier', v_rt, 'is_host', v_m.is_host, 'is_mvp', v_is_mvp,
                            'tier', v_r.tier, 'parts', v_parts);
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
create or replace function public.v2_debug_spawn_raid(p_boss_key text, p_area int default 1)
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
  return public.v2_raid_spawn(p_boss_key, p_area);
end;
$$;
revoke all on function public.v2_debug_spawn_raid(text, int) from public;
revoke all on function public.v2_debug_spawn_raid(text, int) from anon;
grant execute on function public.v2_debug_spawn_raid(text, int) to authenticated;
