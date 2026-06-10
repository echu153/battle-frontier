-- ============================================================
-- ペット倉庫（無制限ストック）
--  - ペット商店の購入は倉庫(pet_storage)へ預ける（袋上限の対象外）
--  - ダンジョン戦利品の素も倉庫へ（supabase_dungeon_loot.sql 側で対応）
--  - 倉庫 ↔ 持ち物(pet_items) は pet_storage_move で移動（持ち物は10個まで）
-- ============================================================

create table if not exists pet_storage (
  owner_id uuid not null references profiles(id) on delete cascade,
  item_key text not null,
  qty      int  not null default 0,
  primary key (owner_id, item_key)
);
alter table pet_storage enable row level security;
drop policy if exists pet_storage_select_own on pet_storage;
create policy pet_storage_select_own on pet_storage for select using (auth.uid() = owner_id);

-- 購入は倉庫へ（袋上限なし）
create or replace function pet_shop_buy(p_key text, p_qty int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_price int; v_cost int; v_gold int; v_qty int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid qty'; end if;
  v_price := pet_item_price(p_key);
  if v_price is null then raise exception 'unknown item'; end if;
  v_cost := v_price * p_qty;
  select gold into v_gold from profiles where id = auth.uid() for update;
  if v_gold is null then raise exception 'no profile'; end if;
  if v_gold < v_cost then raise exception 'not enough gold'; end if;
  update profiles set gold = gold - v_cost where id = auth.uid();
  insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), p_key, p_qty)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + p_qty
    returning qty into v_qty;
  return json_build_object('gold', v_gold - v_cost, 'item_key', p_key, 'qty', v_qty);
end; $$;

-- 倉庫 ↔ 持ち物 の移動。p_to_bag=true: 倉庫→持ち物（袋上限10／翼以外）, false: 持ち物→倉庫
create or replace function pet_storage_move(p_key text, p_qty int, p_to_bag boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_have int; v_use int; v_bagtotal int; v_room int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid qty'; end if;
  if pet_item_price(p_key) is null then raise exception 'unknown item'; end if;

  if p_to_bag then
    select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = p_key;
    v_use := least(p_qty, coalesce(v_have,0));
    if v_use <= 0 then raise exception 'no item in storage'; end if;
    if pet_is_inv_item(p_key) then
      select coalesce(sum(qty),0) into v_bagtotal from pet_items where owner_id = auth.uid() and item_key <> 'escape';
      v_room := 10 - v_bagtotal;
      v_use := least(v_use, v_room);
      if v_use <= 0 then raise exception 'bag full'; end if;
    end if;
    update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = p_key;
    insert into pet_items(owner_id, item_key, qty) values (auth.uid(), p_key, v_use)
      on conflict (owner_id, item_key) do update set qty = pet_items.qty + v_use;
    return json_build_object('moved', v_use, 'to_bag', true);
  else
    select coalesce(qty,0) into v_have from pet_items where owner_id = auth.uid() and item_key = p_key;
    v_use := least(p_qty, coalesce(v_have,0));
    if v_use <= 0 then raise exception 'no item in bag'; end if;
    update pet_items set qty = qty - v_use where owner_id = auth.uid() and item_key = p_key;
    insert into pet_storage(owner_id, item_key, qty) values (auth.uid(), p_key, v_use)
      on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_use;
    return json_build_object('moved', v_use, 'to_bag', false);
  end if;
end; $$;

grant execute on function pet_shop_buy(text, int) to authenticated;
grant execute on function pet_storage_move(text, int, boolean) to authenticated;
