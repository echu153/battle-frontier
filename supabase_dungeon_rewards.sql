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

alter table dungeon_runs enable row level security;
-- クライアントからは自分のランの閲覧のみ許可（書き込みはRPCのSECURITY DEFINER経由）
drop policy if exists dungeon_runs_select_own on dungeon_runs;
create policy dungeon_runs_select_own on dungeon_runs for select using (auth.uid() = owner_id);

-- ラン開始：自分のペットを確認し、既存activeを破棄して新規ラン発行
create or replace function dungeon_start(p_pet_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then
    raise exception 'pet not found';
  end if;
  update dungeon_runs set status = 'abandoned'
    where owner_id = auth.uid() and status = 'active';
  insert into dungeon_runs(owner_id, pet_id, status)
    values (auth.uid(), p_pet_id, 'active')
    returning id into v_id;
  return v_id;
end; $$;

-- ラン精算：サーバー側でクランプ→報酬計算→ペット更新（ランは使い切り）
--  EXPは「倒した敵」からのみ。深い階ほど敵が強い＝1体あたりEXPが増える。
--  なつき度はダンジョンでは増えない。倒された(p_died)場合のみ -3。
drop function if exists dungeon_finish(uuid, int, int, int, boolean);
drop function if exists dungeon_finish(uuid, int, int, int, boolean, boolean);
create or replace function dungeon_finish(
  p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_run    dungeon_runs%rowtype;
  v_pet    pets%rowtype;
  v_floors int; v_enemies int; v_items int;
  v_exp_gain int; v_aff_delta int;
  v_new_exp int; v_new_level int; v_new_aff int;
  v_elapsed numeric;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;

  -- 経過時間チェック（瞬間的な連打・自動化を弾く）
  v_elapsed := extract(epoch from (now() - v_run.started_at));
  if v_elapsed < 3 then raise exception 'too fast'; end if;

  -- サーバー上限でクランプ（10フロア / 敵60 / アイテム30）
  v_floors  := least(greatest(coalesce(p_floors,0),  0), 10);
  v_enemies := least(greatest(coalesce(p_enemies,0), 0), 60);
  v_items   := least(greatest(coalesce(p_items,0),   0), 30);

  -- EXP：敵を倒した分のみ。深い階ほど1体あたりが増える（到達深度で近似）
  v_exp_gain := v_enemies * (3 + v_floors);
  -- なつき度：ダンジョンでは増えない。倒されたら -3
  v_aff_delta := (case when p_died then -3 else 0 end);

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  -- レベルアップ（必要累計EXP = lv * 10、上限Lv50）
  v_new_exp   := v_pet.exp + v_exp_gain;
  v_new_level := v_pet.level;
  while v_new_level < 50 and v_new_exp >= (v_new_level+1)*10 loop
    v_new_level := v_new_level + 1;
  end loop;
  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));

  update pets set exp = v_new_exp, level = v_new_level, affection = v_new_aff
    where id = v_pet.id;
  update dungeon_runs set status = 'finished', finished_at = now(),
    floors_cleared = v_floors, enemies_defeated = v_enemies, items_collected = v_items
    where id = p_run_id;

  return json_build_object(
    'exp_gain', v_exp_gain, 'aff_delta', v_aff_delta,
    'level', v_new_level, 'exp', v_new_exp, 'affection', v_new_aff,
    'leveled', v_new_level > v_pet.level
  );
end; $$;

grant execute on function dungeon_start(uuid) to authenticated;
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
