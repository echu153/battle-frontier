-- ============================================================
-- ゼニの戦闘不能ロスト（2026-07-07）
--   仕様: 戦闘不能になると「そのランで拾ったゼニ（純増分）」の半分を落とす。
--         倉庫にある元々の残高（ラン前の残高）は絶対に減らない。
--   実装: dungeon_runs.zeni_run に「このランの純増ゼニ」を記録。
--         ・dungeon_zeni_pickup で +拾得額 / secret_shop_buy で -購入額
--         ・dungeon_finish（p_died=true）で floor(greatest(zeni_run,0)/2) を pet_storage から差し引く
--         ・商店で使った分は zeni_run から引くので、倉庫の元残高までは削らない
--
-- ⚠ 適用順: supabase_zeni_shop.sql / supabase_fatecore.sql より「後」に流すこと
--    （この3関数の最新版。後から旧版を流すと本仕様が消える）
-- ============================================================

-- 0) このランの純増ゼニ（拾得-商店支払い）。ラン単位・default 0
alter table dungeon_runs add column if not exists zeni_run int not null default 0;

-- 1) ゼニ拾得（zeni_run を加算する版）
create or replace function dungeon_zeni_pickup(p_run_id uuid, p_floor int)
returns json language plpgsql security definer set search_path = public as $$
declare v_run dungeon_runs%rowtype; v_floor int; v_lo int; v_hi int; v_amt int; v_bal int;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.zeni_picks >= 400 then raise exception 'too many zeni'; end if;

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);
  if v_run.dungeon_id = 'd60' then
    if    v_floor <= 12 then v_lo := 30; v_hi := 60;
    elsif v_floor <= 24 then v_lo := 40; v_hi := 70;
    elsif v_floor <= 36 then v_lo := 50; v_hi := 80;
    elsif v_floor <= 48 then v_lo := 60; v_hi := 90;
    else                     v_lo := 70; v_hi := 100;
    end if;
  elsif v_run.dungeon_id = 'd30' then
    if    v_floor <= 10 then v_lo := 10; v_hi := 40;
    elsif v_floor <= 20 then v_lo := 20; v_hi := 50;
    else                     v_lo := 30; v_hi := 60;
    end if;
  else
    raise exception 'no zeni in this dungeon';
  end if;

  v_amt := v_lo + floor(random() * (v_hi - v_lo + 1))::int;
  update dungeon_runs set zeni_picks = zeni_picks + 1, zeni_run = zeni_run + v_amt where id = p_run_id;
  insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), 'zeni', v_amt)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_amt;
  select qty into v_bal from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  return json_build_object('amount', v_amt, 'balance', v_bal);
end; $$;
grant execute on function dungeon_zeni_pickup(uuid, int) to authenticated;

-- 2) 秘密の商店の購入（zeni_run を減算する版。倉庫の元残高を守るため）
create or replace function secret_shop_buy(p_run_id uuid, p_kind text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_price int; v_bal int; v_iid items.id%type;
  v_entry jsonb; v_e jsonb; v_arr jsonb; v_found boolean;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.shop_buys >= 24 then raise exception 'too many buys'; end if;

  -- 価格決定＆キー検証
  if p_kind = 'book' then
    if p_key not like 'scr\_%' or pet_item_price(p_key) is null then raise exception 'bad book'; end if;
    v_price := 1000;
  elsif p_kind = 'seed' then
    if not (p_key = any(array['atk_seed','spatk_seed','def_seed','spdef_seed','hp_seed'])) then raise exception 'bad seed'; end if;
    v_price := 100;
  elsif p_kind = 'stone' then
    if v_run.dungeon_id = 'd60' then
      if not (p_key = any(array['D','C','B','A','S'])) then raise exception 'bad stone rank'; end if;
    else
      if not (p_key = any(array['F','E','D','C','B','A'])) then raise exception 'bad stone rank'; end if;
    end if;
    v_price := case p_key when 'F' then 50 when 'E' then 100 when 'D' then 200 when 'C' then 400
                          when 'B' then 800 when 'A' then 1600 when 'S' then 3200 end;
  else
    raise exception 'bad kind';
  end if;

  -- ゼニ決済（不足なら失敗）
  select coalesce(qty,0) into v_bal from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  if coalesce(v_bal,0) < v_price then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - v_price where owner_id = auth.uid() and item_key = 'zeni';
  -- このランの純増ゼニから支払い分を控除（倉庫の元残高までは risk にしない）
  update dungeon_runs set zeni_run = zeni_run - v_price where id = p_run_id;

  -- 商品付与（失敗時は全体ロールバック＝ゼニも戻る）
  -- 書=消耗品として持ち物(pet_items)へ / 石・素=床拾いと同じく持ち帰り袋(pending_loot)へ
  --   ※袋のアイテムは生還で確定入手・死亡時は半分ロストの対象（床のルート品と同じ扱い）
  if p_kind = 'book' then
    perform pet_grant_item(p_key, 1); -- 袋上限は pet_grant_item 側で検証（超過なら例外）
  elsif p_kind = 'seed' then
    v_entry := jsonb_build_object('id', gen_random_uuid()::text, 'type', 'seed', 'seedKey', p_key, 'qty', 1);
    -- 既存の同種seedにスタック（dungeon_pickupと同じ挙動）
    v_found := false; v_arr := '[]'::jsonb;
    for v_e in select * from jsonb_array_elements(v_run.pending_loot) loop
      if not v_found and v_e->>'type' = 'seed' and v_e->>'seedKey' = p_key then
        v_arr := v_arr || jsonb_set(v_e, '{qty}', to_jsonb(coalesce((v_e->>'qty')::int,1) + 1)); v_found := true;
      else v_arr := v_arr || v_e; end if;
    end loop;
    if not v_found then v_arr := v_arr || v_entry; end if;
    update dungeon_runs set pending_loot = v_arr where id = p_run_id;
  else -- stone
    select id into v_iid from items where name = '強化石(' || p_key || ')';
    if v_iid is null then raise exception 'stone item missing'; end if; -- 存在検証のみ（付与は生還時のdungeon_finish）
    v_entry := jsonb_build_object('id', gen_random_uuid()::text, 'type', 'stone', 'rank', p_key);
    update dungeon_runs set pending_loot = pending_loot || v_entry where id = p_run_id;
  end if;

  update dungeon_runs set shop_buys = shop_buys + 1 where id = p_run_id;
  select qty into v_bal from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  return json_build_object('balance', coalesce(v_bal, 0), 'entry', v_entry);
end; $$;
grant execute on function secret_shop_buy(uuid, text, text) to authenticated;

-- 3) ラン精算（戦闘不能でこのランの純増ゼニの半分を落とす版・fatecore版がベース）
create or replace function dungeon_finish(p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype; v_floors int; v_items int;
  v_aff_delta int; v_new_aff int; v_new_clears int; v_bonus int;
  v_e jsonb; v_t text; v_slot text; v_uid uuid := auth.uid();
  v_iid items.id%type; v_wid weapons.id%type; v_q int; v_exrow record;
  v_keep jsonb := '[]'::jsonb; v_kq int;
  v_book_name text;
  v_zeni_loss int := 0; v_zeni_bal int := 0;
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

    -- ★ゼニ：このランで拾った純増分の半分を落とす（倉庫の元残高は守る）
    v_zeni_loss := floor(greatest(coalesce(v_run.zeni_run, 0), 0) / 2.0)::int;
    if v_zeni_loss > 0 then
      select coalesce(qty,0) into v_zeni_bal from pet_storage where owner_id = v_uid and item_key = 'zeni';
      v_zeni_loss := least(v_zeni_loss, v_zeni_bal); -- 残高を割らない安全弁
      if v_zeni_loss > 0 then
        update pet_storage set qty = qty - v_zeni_loss where owner_id = v_uid and item_key = 'zeni';
      end if;
    end if;
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

  select coalesce(qty,0) into v_zeni_bal from pet_storage where owner_id = v_uid and item_key = 'zeni';
  return json_build_object('aff_delta', v_aff_delta, 'affection', v_new_aff, 'aff_bonus', v_bonus,
    'clears', v_new_clears, 'level', v_pet.level, 'exp', v_pet.exp,
    'loot_granted', jsonb_array_length(v_keep), 'kept_loot', v_keep,
    'zeni_lost', v_zeni_loss, 'zeni_balance', v_zeni_bal);
end; $$;
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
