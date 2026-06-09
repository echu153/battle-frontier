-- ============================================================
-- ダンジョンを10回こなすごとに なつき度 +1
--  - pets.dungeon_clears にダンジョン完了回数を記録
--  - dungeon_finish で完了するたびカウント、10回ごとに なつき +1
--  - 被撃破の -3 は従来どおり（ボーナスと合算）
-- ============================================================

alter table pets add column if not exists dungeon_clears int not null default 0;

create or replace function dungeon_finish(
  p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_run    dungeon_runs%rowtype;
  v_pet    pets%rowtype;
  v_floors int; v_items int;
  v_aff_delta int; v_new_aff int; v_new_clears int; v_bonus int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;

  v_floors := least(greatest(coalesce(p_floors,0), 0), 99);
  v_items  := least(greatest(coalesce(p_items,0),  0), 99);

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  -- 完了回数を+1し、10回ごとに なつき+1
  v_new_clears := coalesce(v_pet.dungeon_clears, 0) + 1;
  v_bonus := case when v_new_clears % 10 = 0 then 1 else 0 end;
  -- なつき：被撃破で-3、加えて10回ごとに+1
  v_aff_delta := (case when p_died then -3 else 0 end) + v_bonus;
  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));

  update pets set affection = v_new_aff, dungeon_clears = v_new_clears where id = v_pet.id;
  update dungeon_runs set status = 'finished', finished_at = now(),
    floors_cleared = v_floors, items_collected = v_items, cleared = coalesce(p_cleared, false)
    where id = p_run_id;

  return json_build_object(
    'aff_delta', v_aff_delta, 'affection', v_new_aff, 'aff_bonus', v_bonus,
    'clears', v_new_clears, 'level', v_pet.level, 'exp', v_pet.exp
  );
end; $$;

grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
