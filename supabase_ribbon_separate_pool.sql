-- ============================================================
-- リボン合成枠を別プール化（2026-07-07）
--   チャーム本体(atk等・上限300)とリボン枠(rib_*・上限300)を独立させ、合計最大600に。
--   ・リボン合成: リボンの+値を rib_* にそのまま格納（本体atk等はマージしない）
--   ・凝縮強化 pet_charm_enhance_condensed: rib_* を凝縮された素で強化（上限300）
--   ・解除 pet_charm_unfuse_ribbon: rib_* の値でリボンを復元し、rib_*/ctype3/specials をクリア
--   ※既存のリボン合成済みチャーム(旧マージ方式)は rib_*=0 のまま。作り直せば別枠になる
-- 適用順の制約なし（独立機能）。supabase_fatecore.sql / supabase_charm_*.sql より後に流すこと
-- ============================================================

-- 1) リボン枠の+値カラム（本体atk等とは別枠）
alter table player_charms add column if not exists rib_atk   int not null default 0;
alter table player_charms add column if not exists rib_spatk int not null default 0;
alter table player_charms add column if not exists rib_def   int not null default 0;
alter table player_charms add column if not exists rib_spdef int not null default 0;
alter table player_charms add column if not exists rib_hp    int not null default 0;

-- 2) リボン合成：リボンの+値を rib_* に格納（本体はそのまま・マージ/切り詰めなし）
create or replace function pet_charm_fuse_ribbon(p_charm uuid, p_ribbon uuid)
returns json language plpgsql security definer set search_path = public as $$
declare b player_charms%rowtype; r player_charms%rowtype; v_shard int; v_wallet int; v_bank int; v_from_wallet int;
begin
  select * into b from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if b.ctype like 'rib\_%' then raise exception 'base cannot be ribbon'; end if;
  if b.ctype2 is null then raise exception 'charm must be fused'; end if;
  if b.ctype3 is not null then raise exception 'ribbon already fused'; end if;
  select * into r from player_charms where id = p_ribbon and owner_id = auth.uid();
  if not found then raise exception 'ribbon not found'; end if;
  if r.ctype not like 'rib\_%' then raise exception 'material must be ribbon'; end if;
  if exists (select 1 from pets where owner_id = auth.uid() and (charm_id = p_ribbon or ribbon_id = p_ribbon)) then
    raise exception 'equipped ribbon cannot be fused';
  end if;

  -- コスト：神秘の欠片1＋ゼニ10000（ゼニは所持zeni＋倉庫zeni_bankから支払い。所持を優先消費）
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'not enough shard'; end if;
  select coalesce(qty,0) into v_wallet from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  select coalesce(qty,0) into v_bank   from pet_storage where owner_id = auth.uid() and item_key = 'zeni_bank';
  if coalesce(v_wallet,0) + coalesce(v_bank,0) < 10000 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';
  v_from_wallet := least(coalesce(v_wallet,0), 10000);
  if v_from_wallet > 0 then update pet_storage set qty = qty - v_from_wallet where owner_id = auth.uid() and item_key = 'zeni'; end if;
  if 10000 - v_from_wallet > 0 then update pet_storage set qty = qty - (10000 - v_from_wallet) where owner_id = auth.uid() and item_key = 'zeni_bank'; end if;

  -- リボンの+値を rib_* に別枠格納（本体atk等は変更しない）。リボンは削除
  update player_charms set ctype3 = r.ctype,
    rib_atk = r.atk, rib_spatk = r.spatk, rib_def = r.def, rib_spdef = r.spdef, rib_hp = r.hp
    where id = p_charm;
  delete from player_charms where id = p_ribbon;
  return json_build_object('ctype3', r.ctype);
end; $$;
grant execute on function pet_charm_fuse_ribbon(uuid, uuid) to authenticated;

-- 3) 凝縮強化：リボン枠 rib_* を凝縮された素で強化（上限300・本体とは別枠）
create or replace function pet_charm_enhance_condensed(p_charm_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_col text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_charm_id and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if c.ctype3 is null then raise exception 'not ribbon-fused'; end if;
  v_key := case p_stat when 'atk' then 'atk_seed_c' when 'spatk' then 'spatk_seed_c' when 'def' then 'def_seed_c'
                       when 'spdef' then 'spdef_seed_c' when 'hp' then 'hp_seed_c' else null end;
  if v_key is null then raise exception 'bad stat'; end if;
  v_col := 'rib_' || p_stat;

  v_total := c.rib_atk + c.rib_spatk + c.rib_def + c.rib_spdef + c.rib_hp;
  v_room := 300 - v_total;  -- リボン枠は上限300（本体とは別）
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', v_col, v_col) using v_use, p_charm_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;
grant execute on function pet_charm_enhance_condensed(uuid, text, int) to authenticated;

-- 4) リボン解除：rib_* の値でリボンを復元し、rib_*/ctype3/特殊能力をクリア（欠片1＋ゼニ10000）
create or replace function pet_charm_unfuse_ribbon(p_charm uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c player_charms%rowtype; v_shard int; v_wallet int; v_bank int; v_from_wallet int;
begin
  select * into c from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if c.ctype3 is null then raise exception 'no fused ribbon'; end if;

  -- コスト：神秘の欠片1＋ゼニ10000（ゼニは所持zeni＋倉庫zeni_bankから支払い。所持を優先消費）
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'not enough shard'; end if;
  select coalesce(qty,0) into v_wallet from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  select coalesce(qty,0) into v_bank   from pet_storage where owner_id = auth.uid() and item_key = 'zeni_bank';
  if coalesce(v_wallet,0) + coalesce(v_bank,0) < 10000 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';
  v_from_wallet := least(coalesce(v_wallet,0), 10000);
  if v_from_wallet > 0 then update pet_storage set qty = qty - v_from_wallet where owner_id = auth.uid() and item_key = 'zeni'; end if;
  if 10000 - v_from_wallet > 0 then update pet_storage set qty = qty - (10000 - v_from_wallet) where owner_id = auth.uid() and item_key = 'zeni_bank'; end if;

  -- リボンを rib_* の+値ごと復元
  insert into player_charms(owner_id, ctype, atk, spatk, def, spdef, hp)
    values (auth.uid(), c.ctype3, c.rib_atk, c.rib_spatk, c.rib_def, c.rib_spdef, c.rib_hp);
  -- チャームはリボン枠(ctype3/rib_*)と特殊能力を外す（本体atk等はそのまま）
  update player_charms set ctype3 = null, specials = '[]'::jsonb,
    rib_atk = 0, rib_spatk = 0, rib_def = 0, rib_spdef = 0, rib_hp = 0
    where id = p_charm;
  return json_build_object('ribbon', c.ctype3);
end; $$;
grant execute on function pet_charm_unfuse_ribbon(uuid) to authenticated;
