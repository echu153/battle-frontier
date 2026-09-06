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

-- ---- 念のため：作りかけの版で入れた古い関数を落とす ----
-- ★v2は**同名のオーバーロードを作らない運用**。引数を変えた関数は
--   create or replace では上書きされず、古いほうが残って両方呼べてしまう。
--   （このファイルを1度も流していなければ、下の3行は何もしない）
drop function if exists public.v2_raid_reward_tier(numeric, boolean, boolean);
drop function if exists public.v2_raid_spawn(text, int, int);
drop function if exists public.v2_debug_spawn_raid(text, int, int);

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

-- ★名簿は src/v2/lib/fusion.js が正。**このINSERTは fusion.js から機械的に作っている**
--   （tools/v2-fusion-sql.mjs で貼り直せる）。行数は敵270体＋レイドボス5体＝275。
insert into public.v2_fusion_materials (id, name, source, boss, crown) values
  ('fu:m:1:0', 'スライムの因子', 'enemy', 'スライム', 'スライム'),
  ('fu:m:1:1', 'コウモリの因子', 'enemy', 'コウモリ', 'コウモリ'),
  ('fu:m:1:2', '毒キノコの因子', 'enemy', '毒キノコ', '毒キノコ'),
  ('fu:m:1:3', '朝露のフェアリーの因子', 'enemy', '朝露のフェアリー', '朝露のフェアリー'),
  ('fu:m:1:4', 'ひなたトカゲの因子', 'enemy', 'ひなたトカゲ', 'ひなたトカゲ'),
  ('fu:m:1:5', '月夜のフクロウの因子', 'enemy', '月夜のフクロウ', '月夜のフクロウ'),
  ('fu:m:1:6', 'ビッグスライムの因子', 'enemy', 'ビッグスライム', 'ビッグスライム'),
  ('fu:m:1:7', '森ネズミの因子', 'enemy', '森ネズミ', '森ネズミ'),
  ('fu:m:1:8', 'オオアリの因子', 'enemy', 'オオアリ', 'オオアリ'),
  ('fu:m:1:9', 'つるヘビの因子', 'enemy', 'つるヘビ', 'つるヘビ'),
  ('fu:m:1:10', '朝もやのカエルの因子', 'enemy', '朝もやのカエル', '朝もやのカエル'),
  ('fu:m:1:11', 'ひなたのチョウの因子', 'enemy', 'ひなたのチョウ', 'ひなたのチョウ'),
  ('fu:m:1:12', '夜鳴きのコオロギの因子', 'enemy', '夜鳴きのコオロギ', '夜鳴きのコオロギ'),
  ('fu:m:2:0', 'ゴブリンの因子', 'enemy', 'ゴブリン', 'ゴブリン'),
  ('fu:m:2:1', '野良犬の因子', 'enemy', '野良犬', '野良犬'),
  ('fu:m:2:2', '盗賊の因子', 'enemy', '盗賊', '盗賊'),
  ('fu:m:2:3', '朝霧のワームの因子', 'enemy', '朝霧のワーム', '朝霧のワーム'),
  ('fu:m:2:4', '陽炎リザードの因子', 'enemy', '陽炎リザード', '陽炎リザード'),
  ('fu:m:2:5', '夜盗の斥候の因子', 'enemy', '夜盗の斥候', '夜盗の斥候'),
  ('fu:m:2:6', '盗賊団のリーダーの因子', 'enemy', '盗賊団のリーダー', '盗賊団のリーダー'),
  ('fu:m:2:7', '草原オオカミの因子', 'enemy', '草原オオカミ', '草原オオカミ'),
  ('fu:m:2:8', 'ゴブリン射手の因子', 'enemy', 'ゴブリン射手', 'ゴブリン射手'),
  ('fu:m:2:9', '野伏せのイノシシの因子', 'enemy', '野伏せのイノシシ', '野伏せのイノシシ'),
  ('fu:m:2:10', '朝露のオオバッタの因子', 'enemy', '朝露のオオバッタ', '朝露のオオバッタ'),
  ('fu:m:2:11', '炎天のハゲタカの因子', 'enemy', '炎天のハゲタカ', '炎天のハゲタカ'),
  ('fu:m:2:12', '夜盗の番犬の因子', 'enemy', '夜盗の番犬', '夜盗の番犬'),
  ('fu:m:3:0', 'コボルトの因子', 'enemy', 'コボルト', 'コボルト'),
  ('fu:m:3:1', 'スケルトンの因子', 'enemy', 'スケルトン', 'スケルトン'),
  ('fu:m:3:2', 'ゴーレムの因子', 'enemy', 'ゴーレム', 'ゴーレム'),
  ('fu:m:3:3', '曙のガーゴイルの因子', 'enemy', '曙のガーゴイル', '曙のガーゴイル'),
  ('fu:m:3:4', '石化トカゲの因子', 'enemy', '石化トカゲ', '石化トカゲ'),
  ('fu:m:3:5', '夜這うレイスの因子', 'enemy', '夜這うレイス', '夜這うレイス'),
  ('fu:m:3:6', '古代の番人の因子', 'enemy', '古代の番人', '古代の番人'),
  ('fu:m:3:7', '洞窟グモの因子', 'enemy', '洞窟グモ', '洞窟グモ'),
  ('fu:m:3:8', 'コボルト投石手の因子', 'enemy', 'コボルト投石手', 'コボルト投石手'),
  ('fu:m:3:9', 'スケルトンドッグの因子', 'enemy', 'スケルトンドッグ', 'スケルトンドッグ'),
  ('fu:m:3:10', '朝陰のオオムカデの因子', 'enemy', '朝陰のオオムカデ', '朝陰のオオムカデ'),
  ('fu:m:3:11', '石窟のサソリの因子', 'enemy', '石窟のサソリ', '石窟のサソリ'),
  ('fu:m:3:12', '亡霊コボルトの因子', 'enemy', '亡霊コボルト', '亡霊コボルト'),
  ('fu:m:4:0', '深海魚人の因子', 'enemy', '深海魚人', '深海魚人'),
  ('fu:m:4:1', '海賊の因子', 'enemy', '海賊', '海賊'),
  ('fu:m:4:2', '毒クラゲの因子', 'enemy', '毒クラゲ', '毒クラゲ'),
  ('fu:m:4:3', '朝凪のセイレーンの因子', 'enemy', '朝凪のセイレーン', '朝凪のセイレーン'),
  ('fu:m:4:4', '潮騒のカニの因子', 'enemy', '潮騒のカニ', '潮騒のカニ'),
  ('fu:m:4:5', '夜光アンコウの因子', 'enemy', '夜光アンコウ', '夜光アンコウ'),
  ('fu:m:4:6', 'シーサーペントの因子', 'enemy', 'シーサーペント', 'シーサーペント'),
  ('fu:m:4:7', '入り江のサメの因子', 'enemy', '入り江のサメ', '入り江のサメ'),
  ('fu:m:4:8', '大ウミヘビの因子', 'enemy', '大ウミヘビ', '大ウミヘビ'),
  ('fu:m:4:9', '海賊の砲手の因子', 'enemy', '海賊の砲手', '海賊の砲手'),
  ('fu:m:4:10', '朝凪のトビウオの因子', 'enemy', '朝凪のトビウオ', '朝凪のトビウオ'),
  ('fu:m:4:11', '日照りのウミガメの因子', 'enemy', '日照りのウミガメ', '日照りのウミガメ'),
  ('fu:m:4:12', '夜光のタコの因子', 'enemy', '夜光のタコ', '夜光のタコ'),
  ('fu:m:5:0', '山岳ゴブリンの因子', 'enemy', '山岳ゴブリン', '山岳ゴブリン'),
  ('fu:m:5:1', '岩石ゴーレムの因子', 'enemy', '岩石ゴーレム', '岩石ゴーレム'),
  ('fu:m:5:2', 'グリフォンの因子', 'enemy', 'グリフォン', 'グリフォン'),
  ('fu:m:5:3', '払暁のワイバーンの因子', 'enemy', '払暁のワイバーン', '払暁のワイバーン'),
  ('fu:m:5:4', '陽射しの大猿の因子', 'enemy', '陽射しの大猿', '陽射しの大猿'),
  ('fu:m:5:5', '宵闇の山猫の因子', 'enemy', '宵闇の山猫', '宵闇の山猫'),
  ('fu:m:5:6', '雷鷲サンダーロックの因子', 'enemy', '雷鷲サンダーロック', '雷鷲サンダーロック'),
  ('fu:m:5:7', '峰のオオワシの因子', 'enemy', '峰のオオワシ', '峰のオオワシ'),
  ('fu:m:5:8', '山岳トロールの因子', 'enemy', '山岳トロール', '山岳トロール'),
  ('fu:m:5:9', '岩場のヒグマの因子', 'enemy', '岩場のヒグマ', '岩場のヒグマ'),
  ('fu:m:5:10', '払暁のハヤブサの因子', 'enemy', '払暁のハヤブサ', '払暁のハヤブサ'),
  ('fu:m:5:11', '陽射しのヤマアラシの因子', 'enemy', '陽射しのヤマアラシ', '陽射しのヤマアラシ'),
  ('fu:m:5:12', '宵闇のオオカミの因子', 'enemy', '宵闇のオオカミ', '宵闇のオオカミ'),
  ('fu:m:6:0', '雪男の因子', 'enemy', '雪男', '雪男'),
  ('fu:m:6:1', '氷河ドラゴンの因子', 'enemy', '氷河ドラゴン', '氷河ドラゴン'),
  ('fu:m:6:2', '霜の精霊の因子', 'enemy', '霜の精霊', '霜の精霊'),
  ('fu:m:6:3', '朝焼けの氷狼の因子', 'enemy', '朝焼けの氷狼', '朝焼けの氷狼'),
  ('fu:m:6:4', '白光の樹氷精の因子', 'enemy', '白光の樹氷精', '白光の樹氷精'),
  ('fu:m:6:5', '極夜のワイトの因子', 'enemy', '極夜のワイト', '極夜のワイト'),
  ('fu:m:6:6', '氷霊フロストバーンの因子', 'enemy', '氷霊フロストバーン', '氷霊フロストバーン'),
  ('fu:m:6:7', '氷壁のゴーレムの因子', 'enemy', '氷壁のゴーレム', '氷壁のゴーレム'),
  ('fu:m:6:8', '白銀のシロクマの因子', 'enemy', '白銀のシロクマ', '白銀のシロクマ'),
  ('fu:m:6:9', '霜のスケルトンの因子', 'enemy', '霜のスケルトン', '霜のスケルトン'),
  ('fu:m:6:10', '朝焼けのアイスドレイクの因子', 'enemy', '朝焼けのアイスドレイク', '朝焼けのアイスドレイク'),
  ('fu:m:6:11', '白光のスノーハーピーの因子', 'enemy', '白光のスノーハーピー', '白光のスノーハーピー'),
  ('fu:m:6:12', '極夜のリッチの因子', 'enemy', '極夜のリッチ', '極夜のリッチ'),
  ('fu:m:7:0', '炎の精霊の因子', 'enemy', '炎の精霊', '炎の精霊'),
  ('fu:m:7:1', '溶岩ゴーレムの因子', 'enemy', '溶岩ゴーレム', '溶岩ゴーレム'),
  ('fu:m:7:2', 'ファイアドレイクの因子', 'enemy', 'ファイアドレイク', 'ファイアドレイク'),
  ('fu:m:7:3', '暁のフレイムバットの因子', 'enemy', '暁のフレイムバット', '暁のフレイムバット'),
  ('fu:m:7:4', '陽炎のイフリートの因子', 'enemy', '陽炎のイフリート', '陽炎のイフリート'),
  ('fu:m:7:5', '熾火のデーモンの因子', 'enemy', '熾火のデーモン', '熾火のデーモン'),
  ('fu:m:7:6', '深紅のサラマンダーの因子', 'enemy', '深紅のサラマンダー', '深紅のサラマンダー'),
  ('fu:m:7:7', '溶岩スライムの因子', 'enemy', '溶岩スライム', '溶岩スライム'),
  ('fu:m:7:8', '火口のヘルハウンドの因子', 'enemy', '火口のヘルハウンド', '火口のヘルハウンド'),
  ('fu:m:7:9', '燃えさかるインプの因子', 'enemy', '燃えさかるインプ', '燃えさかるインプ'),
  ('fu:m:7:10', '暁炎のフェニックスの因子', 'enemy', '暁炎のフェニックス', '暁炎のフェニックス'),
  ('fu:m:7:11', '陽炎のケルベロスの因子', 'enemy', '陽炎のケルベロス', '陽炎のケルベロス'),
  ('fu:m:7:12', '熾火のワイバーンの因子', 'enemy', '熾火のワイバーン', '熾火のワイバーン'),
  ('fu:m:8:0', '天翼のハーピーの因子', 'enemy', '天翼のハーピー', '天翼のハーピー'),
  ('fu:m:8:1', '雷雲の精霊の因子', 'enemy', '雷雲の精霊', '雷雲の精霊'),
  ('fu:m:8:2', '天空騎士グリフィオンの因子', 'enemy', '天空騎士グリフィオン', '天空騎士グリフィオン'),
  ('fu:m:8:3', '曙光のセラフの因子', 'enemy', '曙光のセラフ', '曙光のセラフ'),
  ('fu:m:8:4', '白昼のペガサスの因子', 'enemy', '白昼のペガサス', '白昼のペガサス'),
  ('fu:m:8:5', '星降りのヴァルキリーの因子', 'enemy', '星降りのヴァルキリー', '星降りのヴァルキリー'),
  ('fu:m:8:6', '天空覇龍ウラノスの因子', 'enemy', '天空覇龍ウラノス', '天空覇龍ウラノス'),
  ('fu:m:8:7', '蒼天のロック鳥の因子', 'enemy', '蒼天のロック鳥', '蒼天のロック鳥'),
  ('fu:m:8:8', '浮遊するゴーレムの因子', 'enemy', '浮遊するゴーレム', '浮遊するゴーレム'),
  ('fu:m:8:9', '天空の弓兵の因子', 'enemy', '天空の弓兵', '天空の弓兵'),
  ('fu:m:8:10', '曙光のケルビムの因子', 'enemy', '曙光のケルビム', '曙光のケルビム'),
  ('fu:m:8:11', '白昼のユニコーンの因子', 'enemy', '白昼のユニコーン', '白昼のユニコーン'),
  ('fu:m:8:12', '星降りのワイバーンの因子', 'enemy', '星降りのワイバーン', '星降りのワイバーン'),
  ('fu:m:9:0', '砂喰いワームの因子', 'enemy', '砂喰いワーム', '砂喰いワーム'),
  ('fu:m:9:1', '墓守のミイラの因子', 'enemy', '墓守のミイラ', '墓守のミイラ'),
  ('fu:m:9:2', '砂蠍サンドスコーピオンの因子', 'enemy', '砂蠍サンドスコーピオン', '砂蠍サンドスコーピオン'),
  ('fu:m:9:3', '陽炎の砂トカゲの因子', 'enemy', '陽炎の砂トカゲ', '陽炎の砂トカゲ'),
  ('fu:m:9:4', '灼熱のアヌビスの因子', 'enemy', '灼熱のアヌビス', '灼熱のアヌビス'),
  ('fu:m:9:5', '月砂のジャッカルの因子', 'enemy', '月砂のジャッカル', '月砂のジャッカル'),
  ('fu:m:9:6', '砂皇スカラベウスの因子', 'enemy', '砂皇スカラベウス', '砂皇スカラベウス'),
  ('fu:m:9:7', '遺丘のハゲワシの因子', 'enemy', '遺丘のハゲワシ', '遺丘のハゲワシ'),
  ('fu:m:9:8', '砂のゴーレムの因子', 'enemy', '砂のゴーレム', '砂のゴーレム'),
  ('fu:m:9:9', '墓荒らしの盗掘者の因子', 'enemy', '墓荒らしの盗掘者', '墓荒らしの盗掘者'),
  ('fu:m:9:10', '朝日のスカラベの因子', 'enemy', '朝日のスカラベ', '朝日のスカラベ'),
  ('fu:m:9:11', '灼熱のコブラの因子', 'enemy', '灼熱のコブラ', '灼熱のコブラ'),
  ('fu:m:9:12', '月下のハイエナの因子', 'enemy', '月下のハイエナ', '月下のハイエナ'),
  ('fu:m:10:0', '食人樹の因子', 'enemy', '食人樹', '食人樹'),
  ('fu:m:10:1', '毒霧のマンドラゴラの因子', 'enemy', '毒霧のマンドラゴラ', '毒霧のマンドラゴラ'),
  ('fu:m:10:2', '影狼シャドウウルフの因子', 'enemy', '影狼シャドウウルフ', '影狼シャドウウルフ'),
  ('fu:m:10:3', '朝靄のトレントの因子', 'enemy', '朝靄のトレント', '朝靄のトレント'),
  ('fu:m:10:4', '木漏れ日のピクシーの因子', 'enemy', '木漏れ日のピクシー', '木漏れ日のピクシー'),
  ('fu:m:10:5', '常闇のバンシーの因子', 'enemy', '常闇のバンシー', '常闇のバンシー'),
  ('fu:m:10:6', '森王エルダートレントの因子', 'enemy', '森王エルダートレント', '森王エルダートレント'),
  ('fu:m:10:7', '樹海のオオグモの因子', 'enemy', '樹海のオオグモ', '樹海のオオグモ'),
  ('fu:m:10:8', '苔むしたゴーレムの因子', 'enemy', '苔むしたゴーレム', '苔むしたゴーレム'),
  ('fu:m:10:9', '人喰いのツタの因子', 'enemy', '人喰いのツタ', '人喰いのツタ'),
  ('fu:m:10:10', '朝靄のマイコニドの因子', 'enemy', '朝靄のマイコニド', '朝靄のマイコニド'),
  ('fu:m:10:11', '木漏れ日のオオカブトの因子', 'enemy', '木漏れ日のオオカブト', '木漏れ日のオオカブト'),
  ('fu:m:10:12', '常闇のオオコウモリの因子', 'enemy', '常闇のオオコウモリ', '常闇のオオコウモリ'),
  ('fu:m:11:0', '嵐鳥ストームバードの因子', 'enemy', '嵐鳥ストームバード', '嵐鳥ストームバード'),
  ('fu:m:11:1', '雷刃のガーゴイルの因子', 'enemy', '雷刃のガーゴイル', '雷刃のガーゴイル'),
  ('fu:m:11:2', '断崖のトロールの因子', 'enemy', '断崖のトロール', '断崖のトロール'),
  ('fu:m:11:3', '暁雲のサンダーホークの因子', 'enemy', '暁雲のサンダーホーク', '暁雲のサンダーホーク'),
  ('fu:m:11:4', '雷光のエレメンタルの因子', 'enemy', '雷光のエレメンタル', '雷光のエレメンタル'),
  ('fu:m:11:5', '雷鳴のワイバーンの因子', 'enemy', '雷鳴のワイバーン', '雷鳴のワイバーン'),
  ('fu:m:11:6', '雷帝ケラウノスの因子', 'enemy', '雷帝ケラウノス', '雷帝ケラウノス'),
  ('fu:m:11:7', '断崖のコンドルの因子', 'enemy', '断崖のコンドル', '断崖のコンドル'),
  ('fu:m:11:8', '帯電のゴーレムの因子', 'enemy', '帯電のゴーレム', '帯電のゴーレム'),
  ('fu:m:11:9', '雷牙のオオカミの因子', 'enemy', '雷牙のオオカミ', '雷牙のオオカミ'),
  ('fu:m:11:10', '暁雲のグリフォンの因子', 'enemy', '暁雲のグリフォン', '暁雲のグリフォン'),
  ('fu:m:11:11', '雷光のドレイクの因子', 'enemy', '雷光のドレイク', '雷光のドレイク'),
  ('fu:m:11:12', '雷鳴のハーピーの因子', 'enemy', '雷鳴のハーピー', '雷鳴のハーピー'),
  ('fu:m:12:0', '沼のヒュドラの因子', 'enemy', '沼のヒュドラ', '沼のヒュドラ'),
  ('fu:m:12:1', '腐食スライムの因子', 'enemy', '腐食スライム', '腐食スライム'),
  ('fu:m:12:2', '沼底のリザードマンの因子', 'enemy', '沼底のリザードマン', '沼底のリザードマン'),
  ('fu:m:12:3', '朝霞のウィルオウィスプの因子', 'enemy', '朝霞のウィルオウィスプ', '朝霞のウィルオウィスプ'),
  ('fu:m:12:4', '陽だまりの大蛙の因子', 'enemy', '陽だまりの大蛙', '陽だまりの大蛙'),
  ('fu:m:12:5', '夜霧のゾンビの因子', 'enemy', '夜霧のゾンビ', '夜霧のゾンビ'),
  ('fu:m:12:6', '毒龍ヴェノムヒュドラの因子', 'enemy', '毒龍ヴェノムヒュドラ', '毒龍ヴェノムヒュドラ'),
  ('fu:m:12:7', '沼のオオワニの因子', 'enemy', '沼のオオワニ', '沼のオオワニ'),
  ('fu:m:12:8', '腐肉のオオバエの因子', 'enemy', '腐肉のオオバエ', '腐肉のオオバエ'),
  ('fu:m:12:9', '泥のゴーレムの因子', 'enemy', '泥のゴーレム', '泥のゴーレム'),
  ('fu:m:12:10', '朝霞のオオヒルの因子', 'enemy', '朝霞のオオヒル', '朝霞のオオヒル'),
  ('fu:m:12:11', '陽だまりのオオヘビの因子', 'enemy', '陽だまりのオオヘビ', '陽だまりのオオヘビ'),
  ('fu:m:12:12', '夜霧のバジリスクの因子', 'enemy', '夜霧のバジリスク', '夜霧のバジリスク'),
  ('fu:m:13:0', '坑道のグールの因子', 'enemy', '坑道のグール', '坑道のグール'),
  ('fu:m:13:1', '鉱石ゴーレムの因子', 'enemy', '鉱石ゴーレム', '鉱石ゴーレム'),
  ('fu:m:13:2', '闇喰いコウモリの因子', 'enemy', '闇喰いコウモリ', '闇喰いコウモリ'),
  ('fu:m:13:3', '曙光のクリスタルワームの因子', 'enemy', '曙光のクリスタルワーム', '曙光のクリスタルワーム'),
  ('fu:m:13:4', '灯火のドワーフ亡霊の因子', 'enemy', '灯火のドワーフ亡霊', '灯火のドワーフ亡霊'),
  ('fu:m:13:5', '深穴のシャドウの因子', 'enemy', '深穴のシャドウ', '深穴のシャドウ'),
  ('fu:m:13:6', '巌喰いガイアモールの因子', 'enemy', '巌喰いガイアモール', '巌喰いガイアモール'),
  ('fu:m:13:7', '坑道のオオネズミの因子', 'enemy', '坑道のオオネズミ', '坑道のオオネズミ'),
  ('fu:m:13:8', '錆びた自動人形の因子', 'enemy', '錆びた自動人形', '錆びた自動人形'),
  ('fu:m:13:9', '奈落のスケルトン兵の因子', 'enemy', '奈落のスケルトン兵', '奈落のスケルトン兵'),
  ('fu:m:13:10', '曙光のクリスタルゴーレムの因子', 'enemy', '曙光のクリスタルゴーレム', '曙光のクリスタルゴーレム'),
  ('fu:m:13:11', '灯火のドワーフ坑夫の因子', 'enemy', '灯火のドワーフ坑夫', '灯火のドワーフ坑夫'),
  ('fu:m:13:12', '深穴のオオグモの因子', 'enemy', '深穴のオオグモ', '深穴のオオグモ'),
  ('fu:m:14:0', '星読みの石像の因子', 'enemy', '星読みの石像', '星読みの石像'),
  ('fu:m:14:1', '遺跡の守護機兵の因子', 'enemy', '遺跡の守護機兵', '遺跡の守護機兵'),
  ('fu:m:14:2', '時喰いのクロノワームの因子', 'enemy', '時喰いのクロノワーム', '時喰いのクロノワーム'),
  ('fu:m:14:3', '暁星のアストラルナイトの因子', 'enemy', '暁星のアストラルナイト', '暁星のアストラルナイト'),
  ('fu:m:14:4', '白日のスフィンクスの因子', 'enemy', '白日のスフィンクス', '白日のスフィンクス'),
  ('fu:m:14:5', '星宿の月狼ルナウルフの因子', 'enemy', '星宿の月狼ルナウルフ', '星宿の月狼ルナウルフ'),
  ('fu:m:14:6', '時星龍アイオーンの因子', 'enemy', '時星龍アイオーン', '時星龍アイオーン'),
  ('fu:m:14:7', '星霜のゴーレムの因子', 'enemy', '星霜のゴーレム', '星霜のゴーレム'),
  ('fu:m:14:8', '遺跡の魔導兵の因子', 'enemy', '遺跡の魔導兵', '遺跡の魔導兵'),
  ('fu:m:14:9', '時喰いのカゲロウの因子', 'enemy', '時喰いのカゲロウ', '時喰いのカゲロウ'),
  ('fu:m:14:10', '暁星のケンタウロスの因子', 'enemy', '暁星のケンタウロス', '暁星のケンタウロス'),
  ('fu:m:14:11', '白日のマンティコアの因子', 'enemy', '白日のマンティコア', '白日のマンティコア'),
  ('fu:m:14:12', '星宿の月蛾の因子', 'enemy', '星宿の月蛾', '星宿の月蛾'),
  ('fu:m:15:0', '深淵のクラーケンの因子', 'enemy', '深淵のクラーケン', '深淵のクラーケン'),
  ('fu:m:15:1', '海淵のリヴァイアサン幼体の因子', 'enemy', '海淵のリヴァイアサン幼体', '海淵のリヴァイアサン幼体'),
  ('fu:m:15:2', '冥暗のシーウィッチの因子', 'enemy', '冥暗のシーウィッチ', '冥暗のシーウィッチ'),
  ('fu:m:15:3', '朝凪の海竜の因子', 'enemy', '朝凪の海竜', '朝凪の海竜'),
  ('fu:m:15:4', '陽射しの巨鯨の因子', 'enemy', '陽射しの巨鯨', '陽射しの巨鯨'),
  ('fu:m:15:5', '深海のセイレーンの因子', 'enemy', '深海のセイレーン', '深海のセイレーン'),
  ('fu:m:15:6', '深海覇王リヴァイアサンの因子', 'enemy', '深海覇王リヴァイアサン', '深海覇王リヴァイアサン'),
  ('fu:m:15:7', '深海のメガロドンの因子', 'enemy', '深海のメガロドン', '深海のメガロドン'),
  ('fu:m:15:8', '海溝のダイオウイカの因子', 'enemy', '海溝のダイオウイカ', '海溝のダイオウイカ'),
  ('fu:m:15:9', '冥暗のマーマンの因子', 'enemy', '冥暗のマーマン', '冥暗のマーマン'),
  ('fu:m:15:10', '朝凪のシャチの因子', 'enemy', '朝凪のシャチ', '朝凪のシャチ'),
  ('fu:m:15:11', '陽射しのマンタの因子', 'enemy', '陽射しのマンタ', '陽射しのマンタ'),
  ('fu:m:15:12', '深海のオオダコの因子', 'enemy', '深海のオオダコ', '深海のオオダコ'),
  ('fu:mr:1:0', 'ジェイドスライムの因子', 'enemy', 'ジェイドスライム', 'ジェイドスライム'),
  ('fu:mr:1:1', 'エンシェントトレントの因子', 'enemy', 'エンシェントトレント', 'エンシェントトレント'),
  ('fu:mr:1:2', 'オーロラフェアリーの因子', 'enemy', 'オーロラフェアリー', 'オーロラフェアリー'),
  ('fu:mr:1:3', 'サンリザードの因子', 'enemy', 'サンリザード', 'サンリザード'),
  ('fu:mr:1:4', 'ナイトオウルの因子', 'enemy', 'ナイトオウル', 'ナイトオウル'),
  ('fu:mr:2:0', 'ホブゴブリンの因子', 'enemy', 'ホブゴブリン', 'ホブゴブリン'),
  ('fu:mr:2:1', 'シルバーフェンリルの因子', 'enemy', 'シルバーフェンリル', 'シルバーフェンリル'),
  ('fu:mr:2:2', 'ミストワームの因子', 'enemy', 'ミストワーム', 'ミストワーム'),
  ('fu:mr:2:3', 'フレアバジリスクの因子', 'enemy', 'フレアバジリスク', 'フレアバジリスク'),
  ('fu:mr:2:4', 'シャドウシーフの因子', 'enemy', 'シャドウシーフ', 'シャドウシーフ'),
  ('fu:mr:3:0', 'オブシディアンコボルトの因子', 'enemy', 'オブシディアンコボルト', 'オブシディアンコボルト'),
  ('fu:mr:3:1', 'スケルトンナイトの因子', 'enemy', 'スケルトンナイト', 'スケルトンナイト'),
  ('fu:mr:3:2', 'ドーンガーゴイルの因子', 'enemy', 'ドーンガーゴイル', 'ドーンガーゴイル'),
  ('fu:mr:3:3', 'ロックバジリスクの因子', 'enemy', 'ロックバジリスク', 'ロックバジリスク'),
  ('fu:mr:3:4', 'ダークレイスの因子', 'enemy', 'ダークレイス', 'ダークレイス'),
  ('fu:mr:4:0', 'コーラルナイトの因子', 'enemy', 'コーラルナイト', 'コーラルナイト'),
  ('fu:mr:4:1', 'ベビークラーケンの因子', 'enemy', 'ベビークラーケン', 'ベビークラーケン'),
  ('fu:mr:4:2', 'サンライズセイレーンの因子', 'enemy', 'サンライズセイレーン', 'サンライズセイレーン'),
  ('fu:mr:4:3', 'ジャイアントクラブの因子', 'enemy', 'ジャイアントクラブ', 'ジャイアントクラブ'),
  ('fu:mr:4:4', 'ランタンアンコウの因子', 'enemy', 'ランタンアンコウ', 'ランタンアンコウ'),
  ('fu:mr:5:0', 'ストームグリフォンの因子', 'enemy', 'ストームグリフォン', 'ストームグリフォン'),
  ('fu:mr:5:1', 'マウンテンゴーレムの因子', 'enemy', 'マウンテンゴーレム', 'マウンテンゴーレム'),
  ('fu:mr:5:2', 'ドーンワイバーンの因子', 'enemy', 'ドーンワイバーン', 'ドーンワイバーン'),
  ('fu:mr:5:3', 'ブレイズゴリラの因子', 'enemy', 'ブレイズゴリラ', 'ブレイズゴリラ'),
  ('fu:mr:5:4', 'シャドウキャットの因子', 'enemy', 'シャドウキャット', 'シャドウキャット'),
  ('fu:mr:6:0', 'イエティロードの因子', 'enemy', 'イエティロード', 'イエティロード'),
  ('fu:mr:6:1', 'グレイシアドラゴンの因子', 'enemy', 'グレイシアドラゴン', 'グレイシアドラゴン'),
  ('fu:mr:6:2', 'ブリザードウルフの因子', 'enemy', 'ブリザードウルフ', 'ブリザードウルフ'),
  ('fu:mr:6:3', 'アイスドライアドの因子', 'enemy', 'アイスドライアド', 'アイスドライアド'),
  ('fu:mr:6:4', 'ワイトキングの因子', 'enemy', 'ワイトキング', 'ワイトキング'),
  ('fu:mr:7:0', 'イフリートロードの因子', 'enemy', 'イフリートロード', 'イフリートロード'),
  ('fu:mr:7:1', 'マグマゴーレムの因子', 'enemy', 'マグマゴーレム', 'マグマゴーレム'),
  ('fu:mr:7:2', 'ブレイズバットの因子', 'enemy', 'ブレイズバット', 'ブレイズバット'),
  ('fu:mr:7:3', 'サラマンダーロードの因子', 'enemy', 'サラマンダーロード', 'サラマンダーロード'),
  ('fu:mr:7:4', 'アークデーモンの因子', 'enemy', 'アークデーモン', 'アークデーモン'),
  ('fu:mr:8:0', 'ハーピークイーンの因子', 'enemy', 'ハーピークイーン', 'ハーピークイーン'),
  ('fu:mr:8:1', 'ストームエレメンタルの因子', 'enemy', 'ストームエレメンタル', 'ストームエレメンタル'),
  ('fu:mr:8:2', 'アークセラフの因子', 'enemy', 'アークセラフ', 'アークセラフ'),
  ('fu:mr:8:3', 'ペガサスロードの因子', 'enemy', 'ペガサスロード', 'ペガサスロード'),
  ('fu:mr:8:4', 'ヴァルキリーロードの因子', 'enemy', 'ヴァルキリーロード', 'ヴァルキリーロード'),
  ('fu:mr:9:0', 'サンドワームの因子', 'enemy', 'サンドワーム', 'サンドワーム'),
  ('fu:mr:9:1', 'ゴールデンマミーの因子', 'enemy', 'ゴールデンマミー', 'ゴールデンマミー'),
  ('fu:mr:9:2', 'ミラージュリザードの因子', 'enemy', 'ミラージュリザード', 'ミラージュリザード'),
  ('fu:mr:9:3', 'フレイムアヌビスの因子', 'enemy', 'フレイムアヌビス', 'フレイムアヌビス'),
  ('fu:mr:9:4', 'デザートウルフの因子', 'enemy', 'デザートウルフ', 'デザートウルフ'),
  ('fu:mr:10:0', 'キラープラントの因子', 'enemy', 'キラープラント', 'キラープラント'),
  ('fu:mr:10:1', 'クイーンマンドラゴラの因子', 'enemy', 'クイーンマンドラゴラ', 'クイーンマンドラゴラ'),
  ('fu:mr:10:2', 'ミストトレントの因子', 'enemy', 'ミストトレント', 'ミストトレント'),
  ('fu:mr:10:3', 'サンライトピクシーの因子', 'enemy', 'サンライトピクシー', 'サンライトピクシー'),
  ('fu:mr:10:4', 'クイーンバンシーの因子', 'enemy', 'クイーンバンシー', 'クイーンバンシー'),
  ('fu:mr:11:0', 'ストームイーグルの因子', 'enemy', 'ストームイーグル', 'ストームイーグル'),
  ('fu:mr:11:1', 'サンダーガーゴイルの因子', 'enemy', 'サンダーガーゴイル', 'サンダーガーゴイル'),
  ('fu:mr:11:2', 'サンダーバードの因子', 'enemy', 'サンダーバード', 'サンダーバード'),
  ('fu:mr:11:3', 'サンダーエレメンタルの因子', 'enemy', 'サンダーエレメンタル', 'サンダーエレメンタル'),
  ('fu:mr:11:4', 'ボルトワイバーンの因子', 'enemy', 'ボルトワイバーン', 'ボルトワイバーン'),
  ('fu:mr:12:0', 'ヒュドラロードの因子', 'enemy', 'ヒュドラロード', 'ヒュドラロード'),
  ('fu:mr:12:1', 'アシッドスライムの因子', 'enemy', 'アシッドスライム', 'アシッドスライム'),
  ('fu:mr:12:2', 'グレーターウィスプの因子', 'enemy', 'グレーターウィスプ', 'グレーターウィスプ'),
  ('fu:mr:12:3', 'ポイズンフロッグの因子', 'enemy', 'ポイズンフロッグ', 'ポイズンフロッグ'),
  ('fu:mr:12:4', 'グレーターゾンビの因子', 'enemy', 'グレーターゾンビ', 'グレーターゾンビ'),
  ('fu:mr:13:0', 'グールキングの因子', 'enemy', 'グールキング', 'グールキング'),
  ('fu:mr:13:1', 'ミスリルゴーレムの因子', 'enemy', 'ミスリルゴーレム', 'ミスリルゴーレム'),
  ('fu:mr:13:2', 'クリスタルワームロードの因子', 'enemy', 'クリスタルワームロード', 'クリスタルワームロード'),
  ('fu:mr:13:3', 'ドワーフキングの因子', 'enemy', 'ドワーフキング', 'ドワーフキング'),
  ('fu:mr:13:4', 'グレーターシャドウの因子', 'enemy', 'グレーターシャドウ', 'グレーターシャドウ'),
  ('fu:mr:14:0', 'スターゴーレムの因子', 'enemy', 'スターゴーレム', 'スターゴーレム'),
  ('fu:mr:14:1', 'ガーディアンゴーレムの因子', 'enemy', 'ガーディアンゴーレム', 'ガーディアンゴーレム'),
  ('fu:mr:14:2', 'セレスティアルナイトの因子', 'enemy', 'セレスティアルナイト', 'セレスティアルナイト'),
  ('fu:mr:14:3', 'スフィンクスロードの因子', 'enemy', 'スフィンクスロード', 'スフィンクスロード'),
  ('fu:mr:14:4', 'ルナウルフキングの因子', 'enemy', 'ルナウルフキング', 'ルナウルフキング'),
  ('fu:mr:15:0', 'クラーケンキングの因子', 'enemy', 'クラーケンキング', 'クラーケンキング'),
  ('fu:mr:15:1', 'エンシェントドラゴンの因子', 'enemy', 'エンシェントドラゴン', 'エンシェントドラゴン'),
  ('fu:mr:15:2', 'アビスサーペントの因子', 'enemy', 'アビスサーペント', 'アビスサーペント'),
  ('fu:mr:15:3', 'グレートホエールの因子', 'enemy', 'グレートホエール', 'グレートホエール'),
  ('fu:mr:15:4', 'セイレーンクイーンの因子', 'enemy', 'セイレーンクイーン', 'セイレーンクイーン'),
  ('fu:varuzenoku', '黒龍の逆鱗', 'raid', '黒龍ヴァルゼノク', '黒龍'),
  ('fu:amaza', '雨摩座の涙石', 'raid', '雨摩座', '雨摩座'),
  ('fu:zerugiasu', '雷鋼の動力核', 'raid', '雷鋼機神ゼルギアス', '雷鋼'),
  ('fu:enma', '閻魔の冥銭', 'raid', '閻魔', '閻魔'),
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


-- ============================================================
-- ⑤ 特殊能力の入手経路を「合成素材」へ一本化（2026-09-06 ユーザー指示）
-- ------------------------------------------------------------
-- それまで特殊能力は**ルーンを抽出するとき稀に付く**ものだったが、
-- **全部この合成素材へ移した**。ルーンは**ステータス%だけ**になる。
--
--   ・敵270体ぶんの合成素材を新設（上の v2_fusion_materials に source='enemy' で入っている）
--   ・**倒した敵の合成素材が一律1%**で落ちる（レア度による差は無い）
--   ・合成に使うのは**1個**
--
-- ⚠**supabase_v2_core.sql を流し直したら、このファイルも必ず流し直すこと。**
--   下の v2_extract_essence は core の同じ関数を**上書き**している
--   （core 側は特殊能力を抽選する古い版のままにしてある）。
-- ============================================================

-- ---- 抽出：特殊能力の抽選を外した版（core の関数を上書きする）----
create or replace function public.v2_extract_essence(p_materials jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_ids   text[];
  v_id    text;
  v_mat   public.v2_materials;
  v_stats jsonb := '{}'::jsonb;
  v_keys  text[] := array['hp','mp','str','dex','agi','int_stat','vit','luk'];
  v_others text[];
  v_pick  text[];
  v_k     text;
  v_val   numeric;
  v_choices text[] := '{}'::text[];
  v_chance numeric;   -- ★2026-09-06 以降は使っていない
  v_red numeric; v_blue numeric; v_green numeric;
  v_color text;
  v_ess   public.v2_essences;
  v_need  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  select array_agg(x #>> '{}') into v_ids from jsonb_array_elements(p_materials) x;
  if coalesce(array_length(v_ids, 1), 0) <> 5 then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  -- ボス素材は1個まで
  if (select count(*) from unnest(v_ids) u join public.v2_materials m on m.id = u where m.is_boss) > 1 then
    return jsonb_build_object('ok', false, 'error', 'ボス素材は1個までしか入れられません');
  end if;
  -- 持っているか（同じIDを重ねて選んだぶんも数える）
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    if coalesce((select qty from public.v2_player_materials
                  where player_id = v_uid and material_id = v_id), 0) < v_need then
      return jsonb_build_object('ok', false, 'error', '素材が足りません');
    end if;
  end loop;
  -- 消費
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    update public.v2_player_materials set qty = qty - v_need
     where player_id = v_uid and material_id = v_id;
  end loop;
  delete from public.v2_player_materials where player_id = v_uid and qty <= 0;

  -- 1個ずつ「型を決める → 値を引く」
  foreach v_id in array v_ids loop
    select * into v_mat from public.v2_materials where id = v_id;
    if not found then continue; end if;
    -- 型：激レアとボスは固定。雑魚の通常・レアは 70% で割り当てステ、30% でそれ以外の7種
    if v_mat.is_boss or v_mat.rarity = 'ultra' or random() * 100 < 70 then
      v_pick := v_mat.stats;
    else
      select array_agg(k) into v_others from unnest(v_keys) k where not (k = any (v_mat.stats));
      v_pick := array[v_others[1 + floor(random() * array_length(v_others, 1))::int]];
    end if;
    foreach v_k in array v_pick loop
      v_val := public.v2_roll_material_value(v_mat.lo, v_mat.hi);
      v_stats := jsonb_set(v_stats, array[v_k],
                   to_jsonb(round(coalesce((v_stats ->> v_k)::numeric, 0) + v_val, 1)));
    end loop;
    -- ★特殊能力はもう付かない（2026-09-06 ユーザー指示で合成素材へ一本化）。
    --   v_choices は空のまま insert する＝画面の「能力を選ぶ」も出なくなる
  end loop;

  -- 色：合計値を3グループで合算して、一番大きいグループ
  select coalesce(sum(case when k in ('str','int_stat')  then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('hp','mp','vit')   then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('dex','agi','luk') then v::numeric else 0 end), 0)
    into v_red, v_blue, v_green
    from jsonb_each_text(v_stats) as t(k, v);
  v_color := case when v_red >= v_blue and v_red >= v_green then 'red'
                  when v_blue >= v_green then 'blue' else 'green' end;

  insert into public.v2_essences (player_id, color, stats, ability_choices)
  values (v_uid, v_color, v_stats, v_choices)
  returning * into v_ess;

  -- デイリーミッション：ルーンを1個作った
  perform public.v2_daily_bump(v_uid, 'rune', 1);

  return jsonb_build_object('ok', true, 'essence', to_jsonb(v_ess));
end;
$$;
revoke all on function public.v2_extract_essence(jsonb) from public;
revoke all on function public.v2_extract_essence(jsonb) from anon;
grant execute on function public.v2_extract_essence(jsonb) to authenticated;

-- ---- 出撃で合成素材が落ちたときの受け取り ----
-- ⚠1%の抽選はクライアント（出撃・装備ドロップと同じ作り）。
--   サーバーが見張るのは「**その素材が実在するか**」と「**10秒に1回まで**」の2つだけ。
--   出撃のクールタイムと同じ間隔なので、まっとうに遊んでいれば当たらない。
alter table public.v2_profiles add column if not exists fusion_drop_at timestamptz;

create or replace function public.v2_grant_fusion_drop(p_fusion_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_at timestamptz;
  v_row jsonb;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  if v_me is null then return jsonb_build_object('ok', false, 'error', 'ログインしてください'); end if;
  -- ★敵から落ちるものだけ。レイドボスの合成素材はここからは配らない（報酬でしか出ない）
  select jsonb_build_object('id', id, 'name', name, 'crown', crown) into v_row
    from public.v2_fusion_materials where id = p_fusion_id and source = 'enemy';
  if v_row is null then return jsonb_build_object('ok', false, 'error', 'その合成素材はありません'); end if;

  select fusion_drop_at into v_at from public.v2_profiles where id = v_me;
  if v_at is not null and v_at > now() - interval '9 seconds' then
    return jsonb_build_object('ok', false, 'error', 'まだ受け取れません');
  end if;

  insert into public.v2_player_fusions (player_id, fusion_id, qty) values (v_me, p_fusion_id, 1)
    on conflict (player_id, fusion_id) do update set qty = public.v2_player_fusions.qty + 1;
  update public.v2_profiles set fusion_drop_at = now() where id = v_me;

  return jsonb_build_object('ok', true, 'fusion', v_row);
end;
$$;
revoke all on function public.v2_grant_fusion_drop(text) from public;
revoke all on function public.v2_grant_fusion_drop(text) from anon;
grant execute on function public.v2_grant_fusion_drop(text) to authenticated;
