-- ============================================================
-- ダンジョン戦利品のサーバー権威化（不正対策）
--  - ✨拾得/捨てる/拾い直しはRPCで dungeon_runs.pending_loot(jsonb) を更新
--  - 退出(dungeon_finish)で「生還時のみ」pending_loot をサーバー側で各テーブルへ付与
--  - クライアントは抽選も付与もせず、表示するだけ
--  抽選: 素70 / 強化石15 / 宝石10 / 装備5 / チャーム3（合計103の重み）
-- ============================================================

alter table dungeon_runs add column if not exists pending_loot jsonb not null default '[]'::jsonb;
alter table dungeon_runs add column if not exists dropped_loot jsonb not null default '[]'::jsonb;
alter table dungeon_runs add column if not exists loot_rolls int not null default 0;

-- 拾得：クライアントが床で決めた戦利品(p_entry)を検証して pending_loot に積む（上限80）。素は同種でスタック
--  ※床に実アイテムを表示するため抽選はクライアント。サーバーは「正規の種別・値のみ」許可してチート範囲を限定
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
    '重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪','蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符'];
  v_pending jsonb; v_arr jsonb := '[]'::jsonb; v_found boolean := false; v_e jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.loot_rolls >= 500 then raise exception 'too many loot'; end if;  -- 旧80は30階ダンジョンで途中(29階付近)に到達し拾得不能＝アイテム消失の原因だったため緩和

  -- 受け取った戦利品を正規化＆検証（不正な値は弾く）。idはサーバーで採番
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
    -- 存在チェックではなく「ダンジョン許可装備」のみ通す（S級装備等の注入防止）
    if not (v_key = any(v_dungeon_equips)) then raise exception 'bad equip'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'equip', 'name', v_key);
  elsif v_type = 'shard' then
    v_entry := jsonb_build_object('id', v_id, 'type', 'shard');
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

-- 捨てる：pending_loot から dropped_loot へ移す
create or replace function dungeon_drop_loot(p_run_id uuid, p_loot_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_run dungeon_runs%rowtype; v_e jsonb; v_moved jsonb := null; v_keep jsonb := '[]'::jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found or v_run.owner_id <> auth.uid() or v_run.status <> 'active' then raise exception 'bad run'; end if;
  for v_e in select * from jsonb_array_elements(v_run.pending_loot) loop
    if v_moved is null and v_e->>'id' = p_loot_id then v_moved := v_e;
    else v_keep := v_keep || v_e; end if;
  end loop;
  if v_moved is null then raise exception 'loot not found'; end if;
  update dungeon_runs set pending_loot = v_keep, dropped_loot = v_run.dropped_loot || v_moved where id = p_run_id;
  return json_build_object('ok', true);
end; $$;

-- 拾い直し：dropped_loot から pending_loot へ戻す（素はスタック）
create or replace function dungeon_repick_loot(p_run_id uuid, p_loot_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_run dungeon_runs%rowtype; v_e jsonb; v_moved jsonb := null; v_keep jsonb := '[]'::jsonb;
  v_pending jsonb; v_arr jsonb := '[]'::jsonb; v_found boolean := false; v_x jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found or v_run.owner_id <> auth.uid() or v_run.status <> 'active' then raise exception 'bad run'; end if;
  for v_e in select * from jsonb_array_elements(v_run.dropped_loot) loop
    if v_moved is null and v_e->>'id' = p_loot_id then v_moved := v_e;
    else v_keep := v_keep || v_e; end if;
  end loop;
  if v_moved is null then raise exception 'loot not found'; end if;
  v_pending := v_run.pending_loot;
  if v_moved->>'type' = 'seed' then
    for v_x in select * from jsonb_array_elements(v_pending) loop
      if not v_found and v_x->>'type'='seed' and v_x->>'seedKey'=v_moved->>'seedKey' then
        v_arr := v_arr || jsonb_set(v_x, '{qty}', to_jsonb(coalesce((v_x->>'qty')::int,1) + coalesce((v_moved->>'qty')::int,1))); v_found := true;
      else v_arr := v_arr || v_x; end if;
    end loop;
    if not v_found then v_arr := v_arr || v_moved; end if;
    v_pending := v_arr;
  else
    v_pending := v_pending || v_moved;
  end if;
  update dungeon_runs set pending_loot = v_pending, dropped_loot = v_keep where id = p_run_id;
  return v_moved;
end; $$;

-- 退出精算：なつき(±)＆ pending_loot をサーバーで付与。
--  生還＝全部入手／死亡＝ランダムで半分失い、残りは持ち帰り（kept_lootで返す）
create or replace function dungeon_finish(p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype; v_floors int; v_items int;
  v_aff_delta int; v_new_aff int; v_new_clears int; v_bonus int;
  v_e jsonb; v_t text; v_slot text; v_uid uuid := auth.uid();
  v_iid items.id%type; v_wid weapons.id%type; v_q int; v_exrow record;
  v_keep jsonb := '[]'::jsonb; v_kq int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> v_uid then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;
  v_floors := least(greatest(coalesce(p_floors,0), 0), 99);
  v_items  := least(greatest(coalesce(p_items,0),  0), 99);
  select * into v_pet from pets where id = v_run.pet_id and owner_id = v_uid;
  if not found then raise exception 'pet not found'; end if;

  -- なつき
  v_new_clears := coalesce(v_pet.dungeon_clears, 0) + 1;
  v_bonus := case when v_new_clears % 10 = 0 then 1 else 0 end;
  v_aff_delta := (case when p_died then -3 else 0 end) + v_bonus;
  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));
  update pets set affection = v_new_aff, dungeon_clears = v_new_clears where id = v_pet.id;

  -- 戦利品：生還＝全部／死亡＝ランダムで半分失う（素は個数を半減・その他は各50%で残る）
  if p_died then
    for v_e in select * from jsonb_array_elements(v_run.pending_loot) loop
      if v_e->>'type' = 'seed' then
        v_q := coalesce((v_e->>'qty')::int, 1);
        v_kq := floor(v_q / 2.0)::int + (case when v_q % 2 = 1 and random() < 0.5 then 1 else 0 end);
        if v_kq > 0 then v_keep := v_keep || jsonb_set(v_e, '{qty}', to_jsonb(v_kq)); end if;
      elsif random() < 0.5 then
        v_keep := v_keep || v_e;
      end if;
    end loop;
  else
    v_keep := v_run.pending_loot;
  end if;

  for v_e in select * from jsonb_array_elements(v_keep) loop
      v_t := v_e->>'type';
      if v_t = 'seed' then
        v_q := coalesce((v_e->>'qty')::int, 1);
        -- 戦利品の素は倉庫(pet_storage)へ預ける
        insert into pet_storage(owner_id, item_key, qty) values (v_uid, v_e->>'seedKey', v_q)
          on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_q;
      elsif v_t = 'stone' then
        select id into v_iid from items where name = '強化石(' || (v_e->>'rank') || ')';
        if v_iid is not null then
          select id, quantity into v_exrow from player_items where player_id = v_uid and item_id = v_iid;
          if v_exrow.id is not null then update player_items set quantity = coalesce(v_exrow.quantity,0) + 1 where id = v_exrow.id;
          else insert into player_items(player_id, item_id, quantity, equipped) values (v_uid, v_iid, 1, false); end if;
        end if;
      elsif v_t = 'gem' then
        select id, quantity into v_exrow from player_gems where player_id = v_uid and gem_type = v_e->>'gemType' and rank = 'F';
        if v_exrow.id is not null then update player_gems set quantity = coalesce(v_exrow.quantity,1) + 1 where id = v_exrow.id;
        else insert into player_gems(player_id, gem_type, rank, quantity) values (v_uid, v_e->>'gemType', 'F', 1); end if;
      elsif v_t = 'equip' then
        select id, slot into v_wid, v_slot from weapons where name = v_e->>'name';
        if v_wid is not null then insert into player_equipment(player_id, weapon_id, slot, equipped) values (v_uid, v_wid, v_slot, false); end if;
      elsif v_t = 'charm' then
        insert into player_charms(owner_id, ctype) values (v_uid, v_e->>'ctype');
      elsif v_t = 'shard' then
        insert into pet_storage(owner_id, item_key, qty) values (v_uid, 'shard', 1)
          on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 1;
      end if;
    end loop;

  update dungeon_runs set status = 'finished', finished_at = now(), floors_cleared = v_floors,
    items_collected = v_items, cleared = coalesce(p_cleared, false),
    pending_loot = '[]'::jsonb, dropped_loot = '[]'::jsonb
    where id = p_run_id;

  return json_build_object('aff_delta', v_aff_delta, 'affection', v_new_aff, 'aff_bonus', v_bonus,
    'clears', v_new_clears, 'level', v_pet.level, 'exp', v_pet.exp,
    'loot_granted', jsonb_array_length(v_keep), 'kept_loot', v_keep);
end; $$;

drop function if exists dungeon_pickup(uuid); -- 旧1引数版を削除
grant execute on function dungeon_pickup(uuid, jsonb) to authenticated;
grant execute on function dungeon_drop_loot(uuid, text) to authenticated;
grant execute on function dungeon_repick_loot(uuid, text) to authenticated;
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
