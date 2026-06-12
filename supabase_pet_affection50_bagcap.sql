-- ============================================================
-- ペット調整 2026-06-12
--  ① なつき度は50%スタート（新規ペット）。既に所持しているペットは +50（上限100）
--  ② アイテム袋（持ち物）上限を「初めて踏破したダンジョン1種につき+10」で拡張
--     基本10 + 10×(クリア済みダンジョンの種類数)
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ===== ① なつき度50%スタート =====
ALTER TABLE pets ALTER COLUMN affection SET DEFAULT 50;
-- 既存ペットは一律 +50（上限100）。※1回だけ実行されることを想定（再実行で二重加算しない）
UPDATE pets SET affection = LEAST(100, affection + 50)
WHERE affection < 50;

-- ===== ② アイテム袋容量 = 10 + 10×(クリア済みダンジョン種類数) =====
CREATE OR REPLACE FUNCTION public.pet_bag_capacity(p_uid uuid)
 RETURNS int
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 10 + 10 * COALESCE((
    SELECT count(DISTINCT dungeon_id) FROM dungeon_runs
    WHERE owner_id = p_uid AND cleared = true
  ), 0)::int;
$$;
GRANT EXECUTE ON FUNCTION public.pet_bag_capacity(uuid) TO authenticated;

-- 倉庫→持ち物 移動（袋上限を pet_bag_capacity で動的に）
create or replace function pet_storage_move(p_key text, p_qty int, p_to_bag boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_have int; v_use int; v_bagtotal int; v_room int; v_cap int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid qty'; end if;
  if pet_item_price(p_key) is null then raise exception 'unknown item'; end if;

  if p_to_bag then
    select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = p_key;
    v_use := least(p_qty, coalesce(v_have,0));
    if v_use <= 0 then raise exception 'no item in storage'; end if;
    if pet_is_inv_item(p_key) then
      v_cap := pet_bag_capacity(auth.uid());
      select coalesce(sum(qty),0) into v_bagtotal from pet_items where owner_id = auth.uid() and item_key <> 'escape';
      v_room := v_cap - v_bagtotal;
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

-- ダンジョンドロップ等の付与（袋上限を pet_bag_capacity で動的に）
create or replace function pet_grant_item(p_key text, p_qty int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_qty int; v_invtotal int; v_add int; v_cap int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid qty'; end if;
  if pet_item_price(p_key) is null then raise exception 'unknown item'; end if;
  v_add := p_qty;
  if pet_is_inv_item(p_key) then
    v_cap := pet_bag_capacity(auth.uid());
    select coalesce(sum(qty),0) into v_invtotal from pet_items where owner_id = auth.uid() and item_key <> 'escape';
    if v_invtotal >= v_cap then return json_build_object('granted', 0, 'full', true); end if;
    if v_invtotal + v_add > v_cap then v_add := v_cap - v_invtotal; end if;
  end if;
  insert into pet_items(owner_id, item_key, qty) values (auth.uid(), p_key, v_add)
    on conflict (owner_id, item_key) do update set qty = pet_items.qty + v_add
    returning qty into v_qty;
  return json_build_object('granted', v_add, 'qty', v_qty);
end; $$;

grant execute on function pet_storage_move(text, int, boolean) to authenticated;
grant execute on function pet_grant_item(text, int) to authenticated;
