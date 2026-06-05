-- ============================================================
-- ペット商店＆所持アイテム（バッチ4）
--  - 脱出アイテム / ニックネーム変更券 をGoldで購入（RPCでサーバー検証）
--  - 所持はペット専用テーブル pet_items（owner単位）
--  - 価格はRPC内で定義（escape=500 / rename=10000）
-- ============================================================

create table if not exists pet_items (
  owner_id uuid not null references profiles(id) on delete cascade,
  item_key text not null,           -- 'escape' / 'rename'
  qty      int  not null default 0,
  primary key (owner_id, item_key)
);

alter table pet_items enable row level security;
drop policy if exists pet_items_select_own on pet_items;
create policy pet_items_select_own on pet_items for select using (auth.uid() = owner_id);
-- 書き込みはRPC(SECURITY DEFINER)経由のみ

-- 価格表（RPCから参照）
create or replace function pet_item_price(p_key text)
returns int language sql immutable set search_path = public as $$
  select case p_key when 'escape' then 500 when 'onigiri' then 200 when 'rename' then 10000 else null end;
$$;

-- 持ち物上限(20)の対象アイテム（食料など。だっしゅつの翼は対象外）
create or replace function pet_is_inv_item(p_key text)
returns boolean language sql immutable set search_path = public as $$
  select p_key in ('onigiri');
$$;

-- 購入：Gold残高を確認して減算し、所持を加算（全部サーバー側）
create or replace function pet_shop_buy(p_key text, p_qty int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_price int; v_cost int; v_gold int; v_qty int; v_invtotal int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid qty'; end if;
  v_price := pet_item_price(p_key);
  if v_price is null then raise exception 'unknown item'; end if;
  v_cost := v_price * p_qty;

  -- 持ち物上限チェック（食料など対象アイテムの合計が20を超えない／だっしゅつの翼は対象外）
  if pet_is_inv_item(p_key) then
    select coalesce(sum(qty),0) into v_invtotal from pet_items
      where owner_id = auth.uid() and item_key in ('onigiri');
    if v_invtotal + p_qty > 20 then raise exception 'inventory full'; end if;
  end if;

  select gold into v_gold from profiles where id = auth.uid() for update;
  if v_gold is null then raise exception 'no profile'; end if;
  if v_gold < v_cost then raise exception 'not enough gold'; end if;

  update profiles set gold = gold - v_cost where id = auth.uid();

  insert into pet_items(owner_id, item_key, qty)
    values (auth.uid(), p_key, p_qty)
    on conflict (owner_id, item_key) do update set qty = pet_items.qty + p_qty
    returning qty into v_qty;

  return json_build_object('gold', v_gold - v_cost, 'item_key', p_key, 'qty', v_qty);
end; $$;

-- 脱出アイテム使用：1消費して残数を返す（ダンジョン側で精算する）
create or replace function pet_use_escape()
returns json language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  select qty into v_qty from pet_items where owner_id = auth.uid() and item_key = 'escape';
  if coalesce(v_qty,0) < 1 then raise exception 'no escape item'; end if;
  update pet_items set qty = qty - 1 where owner_id = auth.uid() and item_key = 'escape'
    returning qty into v_qty;
  return json_build_object('qty', v_qty);
end; $$;

-- 汎用：消費アイテムを1つ使う（食料/脱出など）。残数を返す
create or replace function pet_consume_item(p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  select qty into v_qty from pet_items where owner_id = auth.uid() and item_key = p_key;
  if coalesce(v_qty,0) < 1 then raise exception 'no item'; end if;
  update pet_items set qty = qty - 1 where owner_id = auth.uid() and item_key = p_key
    returning qty into v_qty;
  return json_build_object('item_key', p_key, 'qty', v_qty);
end; $$;

-- ニックネーム変更券使用：1消費してペット名を変更
create or replace function pet_use_rename(p_pet_id uuid, p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare v_qty int; v_name text;
begin
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'empty name'; end if;
  if char_length(v_name) > 12 then raise exception 'name too long'; end if;
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then
    raise exception 'pet not found';
  end if;

  select qty into v_qty from pet_items where owner_id = auth.uid() and item_key = 'rename';
  if coalesce(v_qty,0) < 1 then raise exception 'no rename ticket'; end if;

  update pet_items set qty = qty - 1 where owner_id = auth.uid() and item_key = 'rename'
    returning qty into v_qty;
  update pets set name = v_name where id = p_pet_id and owner_id = auth.uid();

  return json_build_object('name', v_name, 'qty', v_qty);
end; $$;

grant execute on function pet_item_price(text) to authenticated;
grant execute on function pet_is_inv_item(text) to authenticated;
grant execute on function pet_shop_buy(text, int) to authenticated;
grant execute on function pet_use_escape() to authenticated;
grant execute on function pet_consume_item(text) to authenticated;
grant execute on function pet_use_rename(uuid, text) to authenticated;
