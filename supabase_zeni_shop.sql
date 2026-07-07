-- ============================================================
-- ゼニ（ペットダンジョン限定通貨）＋秘密の商店＋裁断（2026-07-07）
--   1) dungeon_runs にゼニ拾得数/商店購入数のカウンタ列
--   2) dungeon_zeni_pickup：ゼニ拾得（金額はサーバーがフロア帯で抽選→pet_storage'zeni'へ）
--   3) secret_shop_buy：秘密の商店の購入（書1000/素100/石はランク別価格。ゼニ決済）
--   4) pet_charm_shred：チャーム/リボンを裁断→1個につきランダムな素×3（一括可）
--
-- ⚠ 適用順: supabase_ribbons_d60.sql より「後」に流すこと（順不同でも壊れないが一式適用が前提）
--   ※ゼニは pet_item_price に登録しない（商店購入・倉庫からの持ち込み対象外の通貨のため）
-- ============================================================

-- 1) カウンタ列（暴走防止用）
alter table dungeon_runs add column if not exists zeni_picks int not null default 0;
alter table dungeon_runs add column if not exists shop_buys int not null default 0;

-- 2) ゼニ拾得。金額帯: d30=1-10F:10-40 / 11-20F:20-50 / 21-29F:30-60
--                 d60=③1-12F:30-60 / ④13-24F:40-70 / ⑤25-36F:50-80 / ⑥37-48F:60-90 / ⑦49-59F:70-100
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
  update dungeon_runs set zeni_picks = zeni_picks + 1 where id = p_run_id;
  insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), 'zeni', v_amt)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_amt;
  select qty into v_bal from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  return json_build_object('amount', v_amt, 'balance', v_bal);
end; $$;
grant execute on function dungeon_zeni_pickup(uuid, int) to authenticated;

-- 3) 秘密の商店の購入。p_kind: 'book'(スキルの書)/'stone'(強化石ランク)/'seed'(素)
--   価格: 書1000 / 素100 / 石 F50 E100 D200 C400 B800 A1600 S3200
--   石のランク範囲: d30=F〜A / d60=D〜S（クライアント在庫と同じ制限をサーバーでも検証）
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
end; $;
grant execute on function secret_shop_buy(uuid, text, text) to authenticated;

-- 4) 裁断：チャーム/リボンを削除して1個につきランダムな素×3を倉庫へ（一括可・最大100個）
--   装備中(charm_id/ribbon_id参照中)のものは裁断不可
create or replace function pet_charm_shred(p_ids uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; c player_charms%rowtype; v_shredded int := 0; v_total int := 0; v_k text; i int;
  v_keys text[] := array['atk_seed','spatk_seed','def_seed','spdef_seed','hp_seed'];
  v_bd jsonb := '{}'::jsonb; -- 獲得内訳 { atk_seed: n, ... }
begin
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'no ids'; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'too many'; end if;
  foreach v_id in array p_ids loop
    select * into c from player_charms where id = v_id and owner_id = auth.uid();
    if not found then continue; end if;
    if exists (select 1 from pets where owner_id = auth.uid() and (charm_id = v_id or ribbon_id = v_id)) then
      raise exception 'equipped charm cannot be shredded';
    end if;
    delete from player_charms where id = v_id;
    v_shredded := v_shredded + 1;
    for i in 1..3 loop
      v_k := v_keys[1 + floor(random() * 5)::int];
      insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), v_k, 1)
        on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 1;
      v_total := v_total + 1;
      v_bd := jsonb_set(v_bd, array[v_k], to_jsonb(coalesce((v_bd->>v_k)::int, 0) + 1));
    end loop;
  end loop;
  return json_build_object('shredded', v_shredded, 'total', v_total, 'breakdown', v_bd);
end; $$;
grant execute on function pet_charm_shred(uuid[]) to authenticated;
