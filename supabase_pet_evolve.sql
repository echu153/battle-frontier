-- ============================================================
-- ペット進化（Lv50で進化 → ステ×1.5・成長×2・上限Lv100）
--  - pets.evolved 列を追加（進化済みフラグ）
--  - pet_evolve(): Lv50到達かつ未進化のときだけ evolved=true にする
--  - dungeon_kill(): EXP上限を 進化済=100 / 未進化=50 に切替
--  ※ステータス自体は species + level + evolved からクライアント側で算出する
--    （DBには数値を保存しないので、進化フラグだけで「現在ステ×1.5」「成長×2」が反映される）
-- ============================================================

alter table pets add column if not exists evolved boolean not null default false;

-- 進化：自分のペットで Lv50以上 かつ 未進化 のときだけ実行可
create or replace function pet_evolve(p_pet_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_pet pets%rowtype;
begin
  select * into v_pet from pets where id = p_pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;
  if v_pet.evolved then raise exception 'already evolved'; end if;
  if v_pet.level < 50 then raise exception 'level too low (need Lv50)'; end if;
  update pets set evolved = true where id = p_pet_id;
  return json_build_object('evolved', true, 'level', v_pet.level);
end; $$;
grant execute on function pet_evolve(uuid) to authenticated;

-- 敵撃破でEXP即時付与。EXP上限レベルを 進化済=9999 / 未進化=50 に切替
-- EXPは敵ごとの強さ倍率（クライアントの statMult と同じ表をサーバー側に持ち検証）に比例
drop function if exists dungeon_kill(uuid, int); -- 旧2引数版はデフォルト引数と曖昧になるため削除
create or replace function dungeon_kill(p_run_id uuid, p_floor int, p_enemy text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int; v_cap int;
  v_mult numeric;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.enemies_defeated >= 300 then raise exception 'too many kills'; end if;

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);
  -- 敵ごとの強さ倍率（constants/pets.js の statMult と一致させること。未知の敵は1.0）
  v_mult := case p_enemy
    when 'スライム' then 0.5
    when 'コウモリ' then 0.75
    when '毒キノコ' then 1.0
    when 'ゴブリン' then 1.0
    when '野良犬'   then 1.0
    when '盗賊'     then 1.1
    else 1.0 end;
  v_exp_gain := greatest(1, round((3 + v_floor) * v_mult * 1.1)::int);  -- 強さ比例＋1.1倍

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
