-- ============================================================
-- ペットのレベル上限を400に（2026-07-07）
--   dungeon_kill の進化後キャップ 9999→400。dungeon_kill は他ファイルで上書き
--   されないため単独再定義でOK（supabase_dungeon_d60.sql の最新版と同一＋cap400）
-- ============================================================

DROP FUNCTION IF EXISTS dungeon_kill(uuid, int);
DROP FUNCTION IF EXISTS dungeon_kill(uuid, int, text);
CREATE OR REPLACE FUNCTION dungeon_kill(p_run_id uuid, p_floor int, p_enemy text default null, p_lucky boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int; v_cap int; v_lucky boolean := false;
  v_already boolean := false; -- ボス討伐済みか（2回目以降はEXP10%）
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  -- 撃破数上限（暴走防止）。d60は60F構成で撃破数が多いため900に緩和
  if v_run.enemies_defeated >= (case when v_run.dungeon_id = 'd60' then 900 else 300 end) then
    raise exception 'too many kills';
  end if;

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);

  if v_run.dungeon_id = 'd60' then
    -- 五霊の大峡谷：敵別EXP（2026-07-07再調整: ④以降をさらに緩やかに・⑦上限300）
    v_exp_gain := case p_enemy
      -- ③古代の洞窟帯 F1-12
      when 'コボルト'           then 70
      when 'スケルトン（剣）'   then 80
      when 'スケルトン（弓）'   then 75
      when 'ゴーレム（攻）'     then 90
      when 'ゴーレム（守）'     then 95
      -- ④蒼海の入り江帯 F13-24
      when '深海魚人'           then 100
      when '海賊（男）'         then 110
      when '海賊（女）'         then 105
      when 'ハリセンボン'       then 120
      when '毒クラゲ'           then 115
      when '電気クラゲ'         then 115
      -- ⑤巨峰山脈帯 F25-36
      when '山岳ゴブリン（斧）' then 140
      when '山岳ゴブリン（弓）' then 145
      when 'マウンテンゴリラ'   then 160
      when 'グリフォン'         then 155
      when '一角獣'             then 150
      when '岩石ゴーレム（古）' then 170
      when '岩石ゴーレム（新）' then 165
      -- ⑥白銀の霊峰帯 F37-48
      when '雪男'               then 190
      when '氷狼フェンリル'     then 200
      when '雪女'               then 195
      when '霜の精霊'           then 205
      when '氷河ドラゴン'       then 220
      when '氷結ゴーレム'       then 230
      -- ⑦煉獄火山帯 F49-59（上限300）
      when 'ヘルハウンド'       then 250
      when 'マグマスライム'     then 245
      when '炎の精霊'           then 265
      when 'ファイアドレイク'   then 280
      when 'イフリート'         then 290
      when '溶岩ゴーレム'       then 300
      -- 60Fボス（初回のみ満額。2回目以降は10%＝下で判定）
      when 'カモルス・V・ナスB=パピア' then 10000
      else greatest(1, 10 + v_floor) end;
    -- ボスEXPは d60 の60Fのみ（低層での申告連打は通常EXPに是正）
    if p_enemy = 'カモルス・V・ナスB=パピア' and v_floor <> 60 then
      v_exp_gain := greatest(1, 10 + v_floor);
    end if;
    -- ★2回目以降のカモルス討伐はEXP10%（初回判定＝cleared_d60）
    if p_enemy = 'カモルス・V・ナスB=パピア' and v_floor = 60 then
      select coalesce(cleared_d60, false) into v_already from profiles where id = auth.uid();
      if v_already then v_exp_gain := 1000; end if;
    end if;
  elsif v_run.dungeon_id = 'd30' then
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
      when 'デビルパピア'     then 1000
      else greatest(1, 10 + v_floor) end;
  else
    v_exp_gain := case p_enemy
      when 'スライム' then 4
      when 'コウモリ' then 7
      when '毒キノコ' then 10
      when 'ゴブリン' then 13
      when '野良犬'   then 17
      when '盗賊'     then 21
      else greatest(1, 3 + v_floor) end;
  end if;

  -- デビルパピアはd30の30Fボスのみ。floorが30以外での「デビルパピア」申告は通常EXPに是正（1000EXP連打防止）
  if p_enemy = 'デビルパピア' and not (v_run.dungeon_id = 'd30' and v_floor = 30) then
    v_exp_gain := greatest(1, 10 + v_floor);
  end if;
  -- ★2回目以降のデビルパピア討伐はEXP10%（初回判定＝cleared_d30）
  if p_enemy = 'デビルパピア' and v_run.dungeon_id = 'd30' and v_floor = 30 then
    select coalesce(cleared_d30, false) into v_already from profiles where id = auth.uid();
    if v_already then v_exp_gain := 100; end if;
  end if;

  if p_lucky and random() < 0.5 then v_exp_gain := round(v_exp_gain * 1.5)::int; v_lucky := true; end if;

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_cap := case when v_pet.evolved then 400 else 50 end;  -- 2026-07-07: 進化後の上限を400に制定
  v_new_exp := v_pet.exp + v_exp_gain;
  v_new_level := v_pet.level;
  while v_new_level < v_cap and v_new_exp >= v_new_level * 10 loop
    v_new_exp := v_new_exp - v_new_level * 10;
    v_new_level := v_new_level + 1;
  end loop;
  if v_new_level >= v_cap then v_new_exp := 0; end if;

  update pets set exp = v_new_exp, level = v_new_level where id = v_pet.id;
  update dungeon_runs set enemies_defeated = enemies_defeated + 1 where id = p_run_id;

  -- 追憶の遺跡(d30)ボス「デビルパピア」撃破で踏破フラグ（錬金2枠目の解放条件）
  if v_run.dungeon_id = 'd30' and p_enemy = 'デビルパピア' and v_floor = 30 then
    perform set_config('app.allow_stat_change','on',true);
    update profiles set cleared_d30 = true where id = auth.uid() and coalesce(cleared_d30,false) = false;
  end if;
  -- ★五霊の大峡谷(d60)ボス「カモルス・V・ナスB=パピア」撃破で踏破フラグ
  if v_run.dungeon_id = 'd60' and p_enemy = 'カモルス・V・ナスB=パピア' and v_floor = 60 then
    perform set_config('app.allow_stat_change','on',true);
    update profiles set cleared_d60 = true where id = auth.uid() and coalesce(cleared_d60,false) = false;
  end if;

  return json_build_object('exp_gain', v_exp_gain, 'level', v_new_level, 'exp', v_new_exp, 'leveled', v_new_level > v_pet.level, 'lucky', v_lucky);
end; $$;
grant execute on function dungeon_kill(uuid, int, text, boolean) to authenticated;
