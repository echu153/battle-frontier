-- ============================================================
-- ダンジョン報酬＋不正対策（Phase 3）
--  - 報酬(EXP/なつき)の付与は RPC(SECURITY DEFINER)経由のみ
--  - dungeon_start でラン発行 → dungeon_finish で精算（ランIDは使い切り）
--  - サーバー側で倒した敵数/フロア数/アイテム数を上限クランプして報酬計算
-- ============================================================

create table if not exists dungeon_runs (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references profiles(id) on delete cascade,
  pet_id           uuid not null references pets(id) on delete cascade,
  status           text not null default 'active',  -- active / finished / abandoned
  floors_cleared   int  not null default 0,
  enemies_defeated int  not null default 0,
  items_collected  int  not null default 0,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists dungeon_runs_owner_idx on dungeon_runs(owner_id);
-- ダンジョン種別と踏破フラグ（Phase5：複数ダンジョン・開放条件用）
alter table dungeon_runs add column if not exists dungeon_id text not null default 'd10';
alter table dungeon_runs add column if not exists cleared boolean not null default false;

alter table dungeon_runs enable row level security;
-- クライアントからは自分のランの閲覧のみ許可（書き込みはRPCのSECURITY DEFINER経由）
drop policy if exists dungeon_runs_select_own on dungeon_runs;
create policy dungeon_runs_select_own on dungeon_runs for select using (auth.uid() = owner_id);

-- ラン開始：自分のペットを確認し、既存activeを破棄して新規ラン発行
drop function if exists dungeon_start(uuid);
create or replace function dungeon_start(p_pet_id uuid, p_dungeon_id text default 'd10')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then
    raise exception 'pet not found';
  end if;
  update dungeon_runs set status = 'abandoned'
    where owner_id = auth.uid() and status = 'active';
  insert into dungeon_runs(owner_id, pet_id, status, dungeon_id)
    values (auth.uid(), p_pet_id, 'active', coalesce(p_dungeon_id, 'd10'))
    returning id into v_id;
  return v_id;
end; $$;

-- 敵撃破ごとにEXPを即時付与（深い階ほど多い）。サーバー検証。
create or replace function dungeon_kill(p_run_id uuid, p_floor int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.enemies_defeated >= 300 then raise exception 'too many kills'; end if; -- 暴走防止

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);
  v_exp_gain := 3 + v_floor;  -- 深い階ほど1体あたり多い

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_new_exp := v_pet.exp + v_exp_gain;
  v_new_level := v_pet.level;
  while v_new_level < 50 and v_new_exp >= (v_new_level+1)*10 loop v_new_level := v_new_level + 1; end loop;

  update pets set exp = v_new_exp, level = v_new_level where id = v_pet.id;
  update dungeon_runs set enemies_defeated = enemies_defeated + 1 where id = p_run_id;

  return json_build_object('exp_gain', v_exp_gain, 'level', v_new_level, 'exp', v_new_exp, 'leveled', v_new_level > v_pet.level);
end; $$;

-- ラン精算：なつき度の処理(被撃破で-3)＆ラン終了のみ（EXPは撃破時に即時付与済み）
drop function if exists dungeon_finish(uuid, int, int, int, boolean);
drop function if exists dungeon_finish(uuid, int, int, int, boolean, boolean);
create or replace function dungeon_finish(
  p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_run    dungeon_runs%rowtype;
  v_pet    pets%rowtype;
  v_floors int; v_items int;
  v_aff_delta int; v_new_aff int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;

  v_floors := least(greatest(coalesce(p_floors,0), 0), 99);
  v_items  := least(greatest(coalesce(p_items,0),  0), 99);

  -- なつき度：ダンジョンでは増えない。倒されたら -3
  v_aff_delta := (case when p_died then -3 else 0 end);

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));
  update pets set affection = v_new_aff where id = v_pet.id;
  update dungeon_runs set status = 'finished', finished_at = now(),
    floors_cleared = v_floors, items_collected = v_items, cleared = coalesce(p_cleared, false)
    where id = p_run_id;

  return json_build_object(
    'aff_delta', v_aff_delta, 'affection', v_new_aff,
    'level', v_pet.level, 'exp', v_pet.exp
  );
end; $$;

grant execute on function dungeon_start(uuid, text) to authenticated;
grant execute on function dungeon_kill(uuid, int) to authenticated;
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
