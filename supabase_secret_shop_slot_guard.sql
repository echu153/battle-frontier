-- ============================================================
-- 秘密の商店：スロット単位の購入済みガード（2026-07-25）
--   これまで secret_shop_buy は「どのスロットを買ったか」をサーバーで持たず、
--   購入済み状態はクライアントのローカルstateのみだった。そのため連打や改ざんで
--   同じ品を何度でも買えてしまう（アイテム復活・二重購入）不具合があった。
--
--   本SQLで dungeon_runs.shop_state に「商店インスタンスID＋購入済みスロット」を持たせ、
--   同一商店内の各スロットは1回しか買えないようサーバーで弾く。
--   ・p_shop_id が前回と違えば新しい商店＝購入済みスロットをリセット
--   ・p_slot が既に購入済みなら 'slot already bought' で失敗（ゼニは減らない）
--
--   ※旧3引数版 secret_shop_buy(uuid,text,text) は破棄し、5引数版へ差し替え。
--     クライアントは p_shop_id / p_slot を必ず渡す（未適用だと購入不可になるので必ず適用）。
-- 適用順の制約なし（secret_shop_buy の再定義のみ）。
-- ============================================================

-- 商店状態: { id: '<shop instance uuid>', slots: { 'b0': true, 's1': true, ... } }
alter table dungeon_runs add column if not exists shop_state jsonb not null default '{}'::jsonb;

-- 旧3引数版を破棄（新5引数版との曖昧さ回避）
drop function if exists secret_shop_buy(uuid, text, text);

create or replace function secret_shop_buy(
  p_run_id uuid, p_kind text, p_key text,
  p_shop_id text default null, p_slot text default null
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_price int; v_bal int; v_iid items.id%type;
  v_entry jsonb; v_e jsonb; v_arr jsonb; v_found boolean;
  v_state jsonb; v_slots jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.shop_buys >= 24 then raise exception 'too many buys'; end if;

  -- スロット重複購入ガード（同一商店インスタンス内で各スロット1回まで）
  v_state := coalesce(v_run.shop_state, '{}'::jsonb);
  if p_shop_id is not null then
    if (v_state->>'id') is distinct from p_shop_id then
      v_slots := '{}'::jsonb;                                   -- 新しい商店＝購入済みをリセット
    else
      v_slots := coalesce(v_state->'slots', '{}'::jsonb);
    end if;
    if p_slot is not null and (v_slots ? p_slot) then
      raise exception 'slot already bought';                    -- 既に購入済み＝ゼニを減らさず失敗
    end if;
  end if;

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
  --   書=消耗品として持ち物(pet_items)へ / 石・素=床拾いと同じく持ち帰り袋(pending_loot)へ
  if p_kind = 'book' then
    perform pet_grant_item(p_key, 1); -- 袋上限は pet_grant_item 側で検証（超過なら例外）
  elsif p_kind = 'seed' then
    v_entry := jsonb_build_object('id', gen_random_uuid()::text, 'type', 'seed', 'seedKey', p_key, 'qty', 1);
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

  -- 購入したスロットを記録（この商店インスタンスに紐づけて保存）
  if p_shop_id is not null and p_slot is not null then
    v_slots := jsonb_set(v_slots, array[p_slot], 'true'::jsonb, true);
    update dungeon_runs set shop_state = jsonb_build_object('id', p_shop_id, 'slots', v_slots) where id = p_run_id;
  end if;

  select qty into v_bal from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  return json_build_object('balance', coalesce(v_bal, 0), 'entry', v_entry);
end; $$;
grant execute on function secret_shop_buy(uuid, text, text, text, text) to authenticated;
