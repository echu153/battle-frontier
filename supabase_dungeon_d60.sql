-- ============================================================
-- 五霊の大峡谷（d60・60F）サーバー対応 2026-07-06
--   1) profiles.cleared_d60 列追加（60Fボス討伐フラグ）
--   2) dungeon_kill 上書き：d60専用EXP表＋撃破数上限900＋カモルス討伐でcleared_d60
--      （supabase_alchemy.sql の dungeon_kill がベース。d30の挙動は完全維持）
--   3) dungeon_pickup 上書き：エリア⑤⑥⑦装備を許可リストに追加
--      （supabase_takumi_hidensho.sql の dungeon_pickup がベース。book型対応込み）
--
-- ⚠ 適用順: supabase_alchemy.sql / supabase_takumi_hidensho.sql より「後」に流すこと。
--    （先に流すと後からの再適用で d60 対応が消える）
--    apply_battle_result には触れないため mutant_gold_20260703.sql の鉄則とは独立。
-- ============================================================

-- 1) 60Fボス討伐フラグ
alter table profiles add column if not exists cleared_d60 boolean default false;

-- 2) dungeon_kill（d30/d60別EXP表）
DROP FUNCTION IF EXISTS dungeon_kill(uuid, int);
DROP FUNCTION IF EXISTS dungeon_kill(uuid, int, text);
CREATE OR REPLACE FUNCTION dungeon_kill(p_run_id uuid, p_floor int, p_enemy text default null, p_lucky boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int; v_cap int; v_lucky boolean := false;
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
    -- 五霊の大峡谷：敵別EXP（2026-07-07 約55%に圧縮＝レベリングを緩やかに。LV100→350は6周前後の想定）
    v_exp_gain := case p_enemy
      -- ③古代の洞窟帯 F1-12
      when 'コボルト'           then 70
      when 'スケルトン（剣）'   then 80
      when 'スケルトン（弓）'   then 75
      when 'ゴーレム（攻）'     then 90
      when 'ゴーレム（守）'     then 95
      -- ④蒼海の入り江帯 F13-24
      when '深海魚人'           then 115
      when '海賊（男）'         then 130
      when '海賊（女）'         then 125
      when 'ハリセンボン'       then 140
      when '毒クラゲ'           then 135
      when '電気クラゲ'         then 135
      -- ⑤巨峰山脈帯 F25-36
      when '山岳ゴブリン（斧）' then 180
      when '山岳ゴブリン（弓）' then 190
      when 'マウンテンゴリラ'   then 215
      when 'グリフォン'         then 210
      when '一角獣'             then 205
      when '岩石ゴーレム（古）' then 240
      when '岩石ゴーレム（新）' then 230
      -- ⑥白銀の霊峰帯 F37-48
      when '雪男'               then 290
      when '氷狼フェンリル'     then 310
      when '雪女'               then 305
      when '霜の精霊'           then 315
      when '氷河ドラゴン'       then 360
      when '氷結ゴーレム'       then 375
      -- ⑦煉獄火山帯 F49-59
      when 'ヘルハウンド'       then 430
      when 'マグマスライム'     then 420
      when '炎の精霊'           then 470
      when 'ファイアドレイク'   then 510
      when 'イフリート'         then 530
      when '溶岩ゴーレム'       then 550
      -- 60Fボス
      when 'カモルス・V・ナスB=パピア' then 15000
      else greatest(1, 10 + v_floor) end;
    -- ボスEXPは d60 の60Fのみ（低層での申告連打は通常EXPに是正）
    if p_enemy = 'カモルス・V・ナスB=パピア' and v_floor <> 60 then
      v_exp_gain := greatest(1, 10 + v_floor);
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

  if p_lucky and random() < 0.5 then v_exp_gain := round(v_exp_gain * 1.5)::int; v_lucky := true; end if;

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_cap := case when v_pet.evolved then 9999 else 50 end;
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

-- 3) dungeon_pickup（エリア⑤⑥⑦装備を許可リストに追加。book型対応込み＝takumi_hidensho版がベース）
create or replace function dungeon_pickup(p_run_id uuid, p_entry jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_entry jsonb; v_id text; v_type text; v_key text;
  v_seeds  text[] := array['atk_seed','spatk_seed','def_seed','spdef_seed','hp_seed'];
  v_stones text[] := array['F','E','D','C','B','A','S','SS','SSS'];
  v_gems   text[] := array['peridot','lapis','ruby','sapphire','amethyst','emerald','topaz','rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'];
  v_charms text[] := array['antidote','guard','mdefup','atkup','spatkup','evade','hit','lucky'];
  -- ダンジョンで拾える装備のみ許可（クライアント Dungeon.jsx の AREA_EQUIPS と一致）。
  -- これでS級レイド/交換装備など対象外武器名の注入を防ぐ。AREA_EQUIPS変更時は要同期。
  v_dungeon_equips text[] := array[
    '木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書','魔導の杖','魔術教本',
    '鋼鉄の剣','鋭利なナイフ','狩人の弓','戦士の指輪','略奪の腕輪','古代の護符','秘術の首飾り',
    '重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪','蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符',
    -- ★エリア⑤巨峰山脈（d60 F25-36）
    '山岳の斧','岩砕の拳','霞散弾銃','嵐のオーブ','峰岳の兜','岩石鎧','山岳の靴','岩石の護符','雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪',
    -- ★エリア⑥白銀の霊峰（d60 F37-48）
    '氷刃の剣','霜穿の槍','吹雪の弓','氷晶の杖','凍月刀','氷晶の護符','白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠',
    -- ★エリア⑦煉獄火山（d60 F49-59）
    '業火の短剣','炎のワンド','煉獄魔導書','炎の兜','溶岩鎧','紅蓮の靴','溶岩の指輪','サラマンダーブレード','フェニックスワンド','煉獄のコデックス','溶鉄のクラウン','ドレイクアーマー','ヴァルカンブーツ','業炎の指輪'];
  v_pending jsonb; v_arr jsonb := '[]'::jsonb; v_found boolean := false; v_e jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.loot_rolls >= 500 then raise exception 'too many loot'; end if;

  v_id := gen_random_uuid()::text;
  v_type := p_entry->>'type';
  if v_type = 'seed' then
    v_key := p_entry->>'seedKey';
    if not (v_key = any(v_seeds)) then raise exception 'bad seed'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'seed', 'seedKey', v_key, 'qty', 1);
  elsif v_type = 'stone' then
    v_key := p_entry->>'rank';
    if not (v_key = any(v_stones)) then raise exception 'bad stone'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'stone', 'rank', v_key);
  elsif v_type = 'gem' then
    v_key := p_entry->>'gemType';
    if not (v_key = any(v_gems)) then raise exception 'bad gem'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'gem', 'gemType', v_key);
  elsif v_type = 'charm' then
    v_key := p_entry->>'ctype';
    if not (v_key = any(v_charms)) then raise exception 'bad charm'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'charm', 'ctype', v_key);
  elsif v_type = 'equip' then
    v_key := p_entry->>'name';
    if not (v_key = any(v_dungeon_equips)) then raise exception 'bad equip'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'equip', 'name', v_key);
  elsif v_type = 'shard' then
    v_entry := jsonb_build_object('id', v_id, 'type', 'shard');
  elsif v_type = 'book' then
    -- 匠の秘伝書（Ⅰ〜Ⅲ）。levelは1〜3のみ許可
    v_key := p_entry->>'level';
    if not (v_key = any(array['1','2','3'])) then raise exception 'bad book'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'book', 'level', v_key::int);
  else
    raise exception 'bad loot type';
  end if;

  v_pending := v_run.pending_loot;
  if v_entry->>'type' = 'seed' then
    for v_e in select * from jsonb_array_elements(v_pending) loop
      if not v_found and v_e->>'type' = 'seed' and v_e->>'seedKey' = v_entry->>'seedKey' then
        v_arr := v_arr || jsonb_set(v_e, '{qty}', to_jsonb(coalesce((v_e->>'qty')::int,1) + 1)); v_found := true;
      else v_arr := v_arr || v_e; end if;
    end loop;
    if not v_found then v_arr := v_arr || v_entry; end if;
    v_pending := v_arr;
  else
    v_pending := v_pending || v_entry;
  end if;

  update dungeon_runs set pending_loot = v_pending, loot_rolls = loot_rolls + 1 where id = p_run_id;
  return v_entry;
end; $$;
grant execute on function dungeon_pickup(uuid, jsonb) to authenticated;
