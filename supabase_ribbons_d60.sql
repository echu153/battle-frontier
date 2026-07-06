-- ============================================================
-- リボン＆新チャーム＆おいしい食料（d60アップデート第2弾・2026-07-07）
--   1) pets.ribbon_id 列（リボン＝チャームとは別の装備枠）
--   2) pet_ribbon_equip / pet_charm_equip（リボンと通常チャームの装備先を相互ガード）
--   3) pet_seed_condense：○○の素10個 → 凝縮された○○の素1個
--   4) pet_ribbon_enhance：凝縮された素でリボンを強化（合計150まで）
--   5) dungeon_pickup 上書き：スタン/やけどチャーム＋リボン3種を許可リストへ
--   6) pet_item_price 上書き：おいしい食料2種＋凝縮された素5種を追加
--
-- ⚠ 適用順: supabase_dungeon_d60.sql / supabase_pet_scrolls_v2.sql より「後」に流すこと
--   （dungeon_pickup / pet_item_price を本ファイルの最新版で上書きするため）
-- ============================================================

-- 1) リボン装備枠（player_charms の行を参照。ctype='rib_%' のみ装備可）
alter table pets add column if not exists ribbon_id uuid references player_charms(id) on delete set null;

-- 2) 装備RPC（リボン⇔チャームの取り違えをサーバー側で拒否）
create or replace function pet_ribbon_equip(p_pet_id uuid, p_ribbon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then raise exception 'pet not found'; end if;
  if p_ribbon_id is not null then
    if not exists (select 1 from player_charms where id = p_ribbon_id and owner_id = auth.uid()) then raise exception 'ribbon not found'; end if;
    if not exists (select 1 from player_charms where id = p_ribbon_id and ctype like 'rib_%') then raise exception 'not a ribbon'; end if;
  end if;
  update pets set ribbon_id = p_ribbon_id where id = p_pet_id and owner_id = auth.uid();
end; $$;
grant execute on function pet_ribbon_equip(uuid, uuid) to authenticated;

create or replace function pet_charm_equip(p_pet_id uuid, p_charm_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then raise exception 'pet not found'; end if;
  if p_charm_id is not null then
    if not exists (select 1 from player_charms where id = p_charm_id and owner_id = auth.uid()) then raise exception 'charm not found'; end if;
    -- リボンはチャーム枠に装備できない
    if exists (select 1 from player_charms where id = p_charm_id and ctype like 'rib_%') then raise exception 'ribbon cannot equip as charm'; end if;
  end if;
  update pets set charm_id = p_charm_id where id = p_pet_id and owner_id = auth.uid();
end; $$;
grant execute on function pet_charm_equip(uuid, uuid) to authenticated;

-- 3) 凝縮：○○の素10個 → 凝縮された○○の素1個（p_times回まとめて可）。倉庫(pet_storage)で完結
create or replace function pet_seed_condense(p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_base text; v_c text; v_have int; v_do int;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  v_base := case p_stat when 'atk' then 'atk_seed' when 'spatk' then 'spatk_seed' when 'def' then 'def_seed'
                        when 'spdef' then 'spdef_seed' when 'hp' then 'hp_seed' else null end;
  if v_base is null then raise exception 'bad stat'; end if;
  v_c := v_base || '_c';
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_base;
  v_do := least(p_times, coalesce(v_have,0) / 10);
  if v_do <= 0 then raise exception 'not enough seeds'; end if;
  update pet_storage set qty = qty - v_do * 10 where owner_id = auth.uid() and item_key = v_base;
  insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), v_c, v_do)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_do;
  return json_build_object('made', v_do, 'key', v_c);
end; $$;
grant execute on function pet_seed_condense(text, int) to authenticated;

-- 4) リボン強化：凝縮された素を消費（消費1=+1、HPのみ表示+5）。合計150まで。リボンのみ対象
create or replace function pet_ribbon_enhance(p_ribbon_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_ribbon_id and owner_id = auth.uid();
  if not found then raise exception 'ribbon not found'; end if;
  if c.ctype not like 'rib_%' then raise exception 'not a ribbon'; end if;
  v_key := case p_stat when 'atk' then 'atk_seed_c' when 'spatk' then 'spatk_seed_c' when 'def' then 'def_seed_c'
                       when 'spdef' then 'spdef_seed_c' when 'hp' then 'hp_seed_c' else null end;
  if v_key is null then raise exception 'bad stat'; end if;

  v_total := c.atk + c.spatk + c.def + c.spdef + c.hp;
  v_room := 150 - v_total;  -- リボンは合成なし＝常に150上限
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', p_stat, p_stat) using v_use, p_ribbon_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;
grant execute on function pet_ribbon_enhance(uuid, text, int) to authenticated;

-- 5) dungeon_pickup（チャーム許可リストにスタン/やけど/リボン3種を追加。book型・エリア⑤⑥⑦装備対応込み）
create or replace function dungeon_pickup(p_run_id uuid, p_entry jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_entry jsonb; v_id text; v_type text; v_key text;
  v_seeds  text[] := array['atk_seed','spatk_seed','def_seed','spdef_seed','hp_seed'];
  v_stones text[] := array['F','E','D','C','B','A','S','SS','SSS'];
  v_gems   text[] := array['peridot','lapis','ruby','sapphire','amethyst','emerald','topaz','rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'];
  v_charms text[] := array['antidote','guard','mdefup','atkup','spatkup','evade','hit','lucky',
                           'stunres','burnres','rib_phys','rib_spec','rib_wall'];
  v_dungeon_equips text[] := array[
    '木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書','魔導の杖','魔術教本',
    '鋼鉄の剣','鋭利なナイフ','狩人の弓','戦士の指輪','略奪の腕輪','古代の護符','秘術の首飾り',
    '重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪','蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符',
    '山岳の斧','岩砕の拳','霞散弾銃','嵐のオーブ','峰岳の兜','岩石鎧','山岳の靴','岩石の護符','雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪',
    '氷刃の剣','霜穿の槍','吹雪の弓','氷晶の杖','凍月刀','氷晶の護符','白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠',
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

-- 6) pet_item_price（おいしい食料2種＋凝縮された素5種を追加。書25種対応込み）
create or replace function pet_item_price(p_key text)
returns int language sql immutable set search_path = public as $$
  select case p_key
    when 'escape' then 500 when 'onigiri' then 200 when 'konomi' then 300 when 'rename' then 100000
    when 'atk_seed' then 0 when 'spatk_seed' then 0 when 'def_seed' then 0 when 'spdef_seed' then 0 when 'hp_seed' then 0
    when 'shard' then 0
    -- おいしい食料（d60のF25以降ドロップ専用）
    when 'oishii_onigiri' then 0 when 'oishii_konomi' then 0
    -- 凝縮された素（リボン強化用。素10個から合成）
    when 'atk_seed_c' then 0 when 'spatk_seed_c' then 0 when 'def_seed_c' then 0 when 'spdef_seed_c' then 0 when 'hp_seed_c' then 0
    -- スキルの書（買えない＝0。ダンジョンドロップ専用）
    when 'scr_iai' then 0 when 'scr_sutemi' then 0 when 'scr_sanren' then 0 when 'scr_shunpo' then 0
    when 'scr_quake' then 0 when 'scr_soul' then 0 when 'scr_inori' then 0 when 'scr_sabaki' then 0
    when 'scr_kori' then 0 when 'scr_mind' then 0 when 'scr_goren' then 0 when 'scr_gun' then 0
    when 'scr_dice' then 0 when 'scr_raikou' then 0 when 'scr_seiiki' then 0 when 'scr_dragon' then 0
    when 'scr_kyogeki' then 0 when 'scr_kantsu' then 0 when 'scr_thunder' then 0
    when 'scr_heal' then 0 when 'scr_bakuretsu' then 0
    when 'scr_mure' then 0 when 'scr_salamand' then 0 when 'scr_kamioroshi' then 0 when 'scr_yatchae' then 0
    else null end;
$$;
grant execute on function pet_item_price(text) to authenticated;
