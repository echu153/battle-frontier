-- ============================================================
-- ゼニ倉庫（任意の預け入れ／引き出し）＋戦闘不能ロスト再定義（2026-07-07）
--   仕様変更: ゼニは拾っても自動で安全にはならない。
--     ・所持ゼニ  = pet_storage 'zeni'      … ダンジョンで拾う。戦闘不能で「半分」失う
--     ・倉庫ゼニ  = pet_storage 'zeni_bank' … 任意で預けた分。安全（絶対に減らない）
--     ・出し入れは街（ダンジョン選択画面）でのみ。zeni_deposit / zeni_withdraw
--   戦闘不能: 所持ゼニ（wallet）全体の floor(半分) を失う。倉庫は無傷。
--
-- ⚠ 適用順: supabase_zeni_shop.sql / supabase_fatecore.sql より「後」に流すこと。
--   （dungeon_finish の最新版。supabase_zeni_death_loss.sql は本ファイルで置き換わる＝
--     未適用でも適用済みでもOK。本ファイルは zeni_run 列に依存しない）
-- ============================================================

-- 1) 預ける：所持ゼニ(zeni) → 倉庫(zeni_bank)。amount と所持のうち少ない方を移動
create or replace function zeni_deposit(p_amount int)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_wallet int; v_move int; v_bank int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  select coalesce(qty,0) into v_wallet from pet_storage where owner_id = v_uid and item_key = 'zeni';
  v_move := least(p_amount, coalesce(v_wallet,0));
  if v_move <= 0 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - v_move where owner_id = v_uid and item_key = 'zeni';
  insert into pet_storage(owner_id, item_key, qty) values (v_uid, 'zeni_bank', v_move)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_move;
  select coalesce(qty,0) into v_wallet from pet_storage where owner_id = v_uid and item_key = 'zeni';
  select coalesce(qty,0) into v_bank   from pet_storage where owner_id = v_uid and item_key = 'zeni_bank';
  return json_build_object('moved', v_move, 'zeni', v_wallet, 'zeni_bank', v_bank);
end; $$;
grant execute on function zeni_deposit(int) to authenticated;

-- 2) 引き出す：倉庫(zeni_bank) → 所持ゼニ(zeni)
create or replace function zeni_withdraw(p_amount int)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bank int; v_move int; v_wallet int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  select coalesce(qty,0) into v_bank from pet_storage where owner_id = v_uid and item_key = 'zeni_bank';
  v_move := least(p_amount, coalesce(v_bank,0));
  if v_move <= 0 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - v_move where owner_id = v_uid and item_key = 'zeni_bank';
  insert into pet_storage(owner_id, item_key, qty) values (v_uid, 'zeni', v_move)
    on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_move;
  select coalesce(qty,0) into v_wallet from pet_storage where owner_id = v_uid and item_key = 'zeni';
  select coalesce(qty,0) into v_bank   from pet_storage where owner_id = v_uid and item_key = 'zeni_bank';
  return json_build_object('moved', v_move, 'zeni', v_wallet, 'zeni_bank', v_bank);
end; $$;
grant execute on function zeni_withdraw(int) to authenticated;

-- 3) ラン精算（戦闘不能で所持ゼニ全体の半分を失う版・fatecore版がベース）
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

    -- ★ゼニ：所持ゼニ(wallet)全体の半分を失う。倉庫(zeni_bank)は無傷。
    select coalesce(qty,0) into v_zeni_bal from pet_storage where owner_id = v_uid and item_key = 'zeni';
    v_zeni_loss := floor(coalesce(v_zeni_bal,0) / 2.0)::int;
    if v_zeni_loss > 0 then
      update pet_storage set qty = qty - v_zeni_loss where owner_id = v_uid and item_key = 'zeni';
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
