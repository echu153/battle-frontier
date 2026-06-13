-- ============================================================
-- 追憶の遺跡(d30) 専用の敵EXP 2026-06-13
--  dungeon_kill が run の dungeon_id を見て、d30 のときは d30専用EXP表を使う。
--  （d10 等は従来どおり。ランから dungeon_id を読むのでクライアント改ざん不可）
--  エリア③以降は伸びを緩やかに調整。
--  ※ supabase_pet_evolve.sql の dungeon_kill を上書き。再適用時はこのファイルも再適用。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

drop function if exists dungeon_kill(uuid, int);
create or replace function dungeon_kill(p_run_id uuid, p_floor int, p_enemy text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int; v_cap int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.enemies_defeated >= 300 then raise exception 'too many kills'; end if;

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);

  if v_run.dungeon_id = 'd30' then
    -- 追憶の遺跡：エリア①→④で緩やかに（③以降は伸びを抑えめ）
    v_exp_gain := case p_enemy
      when 'スライム'         then 12
      when 'コウモリ'         then 18
      when '毒キノコ'         then 24
      when 'ゴブリン'         then 36
      when '野良犬'           then 36
      when '盗賊'             then 42
      when 'コボルト'         then 48
      when 'スケルトン（剣）' then 54
      when 'スケルトン（弓）' then 50
      when 'ゴーレム（攻）'   then 62
      when 'ゴーレム（守）'   then 66
      when '深海魚人'         then 78
      when '海賊（男）'       then 88
      when '海賊（女）'       then 82
      when '毒クラゲ'         then 78
      when '電気クラゲ'       then 80
      when 'ハリセンボン'     then 75
      when 'デビルパピア'     then 1000  -- 30Fボス（撃破クリア報酬EXP）
      else greatest(1, 10 + v_floor) end;
  else
    -- 初級の洞窟など（従来どおり）
    v_exp_gain := case p_enemy
      when 'スライム' then 4
      when 'コウモリ' then 7
      when '毒キノコ' then 10
      when 'ゴブリン' then 13
      when '野良犬'   then 17
      when '盗賊'     then 21
      else greatest(1, 3 + v_floor) end;
  end if;

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_cap := case when v_pet.evolved then 9999 else 50 end;  -- 進化で上限が実質無限(9999)に
  v_new_exp := v_pet.exp + v_exp_gain;
  v_new_level := v_pet.level;
  while v_new_level < v_cap and v_new_exp >= v_new_level * 10 loop
    v_new_exp := v_new_exp - v_new_level * 10;
    v_new_level := v_new_level + 1;
  end loop;
  if v_new_level >= v_cap then v_new_exp := 0; end if;

  update pets set exp = v_new_exp, level = v_new_level where id = v_pet.id;
  update dungeon_runs set enemies_defeated = enemies_defeated + 1 where id = p_run_id;

  return json_build_object('exp_gain', v_exp_gain, 'level', v_new_level, 'exp', v_new_exp, 'leveled', v_new_level > v_pet.level);
end; $$;
grant execute on function dungeon_kill(uuid, int, text) to authenticated;
