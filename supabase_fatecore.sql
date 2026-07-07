-- ============================================================
-- リボン合成＆フェイトコア特殊能力（2026-07-07）
--   1) player_charms に ctype3(リボン合成枠)・specials(特殊能力jsonb) 列
--   2) pet_ribbon_enhance：リボンの強化上限を150→300へ
--   3) pet_charm_fuse_ribbon：合成済みチャーム＋リボンを合成（欠片1＋ゼニ10000）
--      装備名先頭に【物理】等タグ(クライアント表示)・＋値は合算(上限300)・リボンは消滅
--   4) pet_charm_reroll：フェイトコア1個で特殊能力を全枠再抽選（枠数=構成数）
--   5) dungeon_pickup / dungeon_finish：フェイトコア(60Fボス討伐ドロップ)対応
--
-- ⚠ 適用順: supabase_zeni_shop.sql より「後」に流すこと
-- ============================================================

-- 1) 列追加
alter table player_charms add column if not exists ctype3 text;
alter table player_charms add column if not exists specials jsonb not null default '[]'::jsonb;

-- 2) リボン強化：上限300へ（凝縮された素を消費）
create or replace function pet_ribbon_enhance(p_ribbon_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_ribbon_id and owner_id = auth.uid();
  if not found then raise exception 'ribbon not found'; end if;
  if c.ctype not like 'rib\_%' then raise exception 'not a ribbon'; end if;
  v_key := case p_stat when 'atk' then 'atk_seed_c' when 'spatk' then 'spatk_seed_c' when 'def' then 'def_seed_c'
                       when 'spdef' then 'spdef_seed_c' when 'hp' then 'hp_seed_c' else null end;
  if v_key is null then raise exception 'bad stat'; end if;

  v_total := c.atk + c.spatk + c.def + c.spdef + c.hp;
  v_room := 300 - v_total;  -- リボンの強化上限は300
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', p_stat, p_stat) using v_use, p_ribbon_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;
grant execute on function pet_ribbon_enhance(uuid, text, int) to authenticated;

-- 3) リボン合成：合成済みチャーム(ctype2あり・ctype3なし)＋リボン。欠片1＋ゼニ10000消費
--    ＋値は合算して上限300に切り詰め(HP→特防→防→特攻→攻の順でカット)。リボンは削除
create or replace function pet_charm_fuse_ribbon(p_charm uuid, p_ribbon uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  b player_charms%rowtype; r player_charms%rowtype;
  v_shard int; v_zeni int;
  v_atk int; v_spatk int; v_def int; v_spdef int; v_hp int; v_over int; v_cut int;
begin
  select * into b from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if b.ctype like 'rib\_%' then raise exception 'base cannot be ribbon'; end if;
  if b.ctype2 is null then raise exception 'charm must be fused'; end if;      -- 合成済みチャーム限定
  if b.ctype3 is not null then raise exception 'ribbon already fused'; end if; -- リボン枠は1つ
  select * into r from player_charms where id = p_ribbon and owner_id = auth.uid();
  if not found then raise exception 'ribbon not found'; end if;
  if r.ctype not like 'rib\_%' then raise exception 'material must be ribbon'; end if;
  if exists (select 1 from pets where owner_id = auth.uid() and (charm_id = p_ribbon or ribbon_id = p_ribbon)) then
    raise exception 'equipped ribbon cannot be fused';
  end if;

  -- コスト：神秘の欠片1＋ゼニ10000
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'not enough shard'; end if;
  select coalesce(qty,0) into v_zeni from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  if coalesce(v_zeni,0) < 10000 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';
  update pet_storage set qty = qty - 10000 where owner_id = auth.uid() and item_key = 'zeni';

  -- ＋値の合算（上限300。超過はHP→特防→防→特攻→攻の順で切り捨て）
  v_atk := b.atk + r.atk; v_spatk := b.spatk + r.spatk; v_def := b.def + r.def; v_spdef := b.spdef + r.spdef; v_hp := b.hp + r.hp;
  v_over := (v_atk + v_spatk + v_def + v_spdef + v_hp) - 300;
  if v_over > 0 then v_cut := least(v_hp, v_over);    v_hp := v_hp - v_cut;       v_over := v_over - v_cut; end if;
  if v_over > 0 then v_cut := least(v_spdef, v_over); v_spdef := v_spdef - v_cut; v_over := v_over - v_cut; end if;
  if v_over > 0 then v_cut := least(v_def, v_over);   v_def := v_def - v_cut;     v_over := v_over - v_cut; end if;
  if v_over > 0 then v_cut := least(v_spatk, v_over); v_spatk := v_spatk - v_cut; v_over := v_over - v_cut; end if;
  if v_over > 0 then v_cut := least(v_atk, v_over);   v_atk := v_atk - v_cut;     v_over := v_over - v_cut; end if;

  update player_charms set ctype3 = r.ctype, atk = v_atk, spatk = v_spatk, def = v_def, spdef = v_spdef, hp = v_hp
    where id = p_charm;
  delete from player_charms where id = p_ribbon;
  return json_build_object('ctype3', r.ctype);
end; $$;
grant execute on function pet_charm_fuse_ribbon(uuid, uuid) to authenticated;

-- 4) フェイトコアで特殊能力を全枠再抽選。枠数=構成数(単体1/合成2/リボン合成3。リボン単体1)
--    抽選テーブル: ステ%40%(攻/特攻/防/特防 2-5%) / ダメ%20%(物理/特殊 1-3%)
--                  耐性20%(毒/麻痺/やけど 5-10%) / 率20%(命中/回避/クリ率/クリ抵抗 1-3%)
create or replace function pet_charm_reroll(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  c player_charms%rowtype; v_core int; v_slots int; v_arr jsonb := '[]'::jsonb;
  v_r float; v_k text; v_v int; i int;
begin
  select * into c from player_charms where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  select coalesce(qty,0) into v_core from pet_storage where owner_id = auth.uid() and item_key = 'fatecore';
  if coalesce(v_core,0) < 1 then raise exception 'not enough fatecore'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'fatecore';

  v_slots := 1 + (case when c.ctype2 is not null then 1 else 0 end) + (case when c.ctype3 is not null then 1 else 0 end);
  for i in 1..v_slots loop
    v_r := random();
    if v_r < 0.4 then
      v_k := (array['atk','spatk','def','spdef'])[1 + floor(random() * 4)::int];
      v_v := 2 + floor(random() * 4)::int;   -- 2〜5%
    elsif v_r < 0.6 then
      v_k := (array['physdmg','specdmg'])[1 + floor(random() * 2)::int];
      v_v := 1 + floor(random() * 3)::int;   -- 1〜3%
    elsif v_r < 0.8 then
      v_k := (array['res_poison','res_paralyze','res_burn'])[1 + floor(random() * 3)::int];
      v_v := 5 + floor(random() * 6)::int;   -- 5〜10%
    else
      v_k := (array['hit','evade','crit','critres'])[1 + floor(random() * 4)::int];
      v_v := 1 + floor(random() * 3)::int;   -- 1〜3%
    end if;
    v_arr := v_arr || jsonb_build_object('k', v_k, 'v', v_v);
  end loop;

  update player_charms set specials = v_arr where id = p_id;
  return json_build_object('specials', v_arr, 'slots', v_slots);
end; $$;
grant execute on function pet_charm_reroll(uuid) to authenticated;

-- 5a) dungeon_pickup：fatecore型を許可（既存の全対応込み・最新版）
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
  elsif v_type = 'fatecore' then
    v_entry := jsonb_build_object('id', v_id, 'type', 'fatecore');
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

-- 5b) dungeon_finish：fatecoreをpet_storageへ付与（既存の全対応込み・最新版）
create or replace function dungeon_finish(p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype; v_floors int; v_items int;
  v_aff_delta int; v_new_aff int; v_new_clears int; v_bonus int;
  v_e jsonb; v_t text; v_slot text; v_uid uuid := auth.uid();
  v_iid items.id%type; v_wid weapons.id%type; v_q int; v_exrow record;
  v_keep jsonb := '[]'::jsonb; v_kq int;
  v_book_name text;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> v_uid then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;
  v_floors := least(greatest(coalesce(p_floors,0), 0), 99);
  v_items  := least(greatest(coalesce(p_items,0),  0), 99);
  select * into v_pet from pets where id = v_run.pet_id and owner_id = v_uid;
  if not found then raise exception 'pet not found'; end if;

  v_new_clears := coalesce(v_pet.dungeon_clears, 0) + 1;
  v_bonus := case when v_new_clears % 10 = 0 then 1 else 0 end;
  v_aff_delta := (case when p_died then -3 else 0 end) + v_bonus;
  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));
  update pets set affection = v_new_aff, dungeon_clears = v_new_clears where id = v_pet.id;

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
      elsif v_t = 'fatecore' then
        -- ★フェイトコア（60Fボス討伐ドロップ。特殊能力の抽選に使う）
        insert into pet_storage(owner_id, item_key, qty) values (v_uid, 'fatecore', 1)
          on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 1;
      elsif v_t = 'book' then
        v_book_name := '匠の秘伝書' || (case v_e->>'level' when '1' then 'Ⅰ' when '2' then 'Ⅱ' when '3' then 'Ⅲ' else 'Ⅰ' end);
        select id into v_iid from items where name = v_book_name;
        if v_iid is not null then
          select id, quantity into v_exrow from player_items where player_id = v_uid and item_id = v_iid;
          if v_exrow.id is not null then update player_items set quantity = coalesce(v_exrow.quantity,0) + 1 where id = v_exrow.id;
          else insert into player_items(player_id, item_id, quantity, equipped) values (v_uid, v_iid, 1, false); end if;
        end if;
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
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
