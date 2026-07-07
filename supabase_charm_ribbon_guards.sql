-- ============================================================
-- リボンのサーバー側ガード追加（2026-07-07・d60一般公開前の不正対策）
--   通常の合成/継承/強化にリボン(ctype='rib_%')が混入できないようサーバーで弾く。
--   （クライアントUIでは除外済みだが、改ざんリクエスト対策）
--   ・pet_charm_fuse    : base/mat がリボンなら不可（リボンは「融合」pet_charm_fuse_ribbon で）
--   ・pet_charm_inherit : from/to がリボンなら不可
--   ・pet_charm_enhance : 対象がリボンなら不可（リボンは pet_ribbon_enhance で凝縮強化）
-- 適用順の制約なし（既存3関数に1行ガードを足した再定義）
-- ============================================================

-- 通常合成：チャーム＋チャームのみ。リボンは弾く
create or replace function pet_charm_fuse(p_base uuid, p_mat uuid)
returns json language plpgsql security definer set search_path = public as $$
declare b player_charms%rowtype; m player_charms%rowtype; v_shard int;
  v_atk int; v_spatk int; v_def int; v_spdef int; v_hp int; v_total int;
begin
  if p_base = p_mat then raise exception 'same charm'; end if;
  select * into b from player_charms where id = p_base and owner_id = auth.uid();
  if not found then raise exception 'base not found'; end if;
  select * into m from player_charms where id = p_mat and owner_id = auth.uid();
  if not found then raise exception 'mat not found'; end if;
  if b.ctype like 'rib\_%' or m.ctype like 'rib\_%' then raise exception 'ribbon cannot be fused here'; end if;
  if b.fused or m.fused then raise exception 'already fused'; end if;

  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'no shard'; end if;

  v_atk := b.atk + m.atk; v_spatk := b.spatk + m.spatk; v_def := b.def + m.def; v_spdef := b.spdef + m.spdef; v_hp := b.hp + m.hp;
  v_total := v_atk + v_spatk + v_def + v_spdef + v_hp;
  if v_total > 300 then
    declare v_over int := v_total - 300; declare v_cut int;
    begin
      v_cut := least(v_hp, v_over); v_hp := v_hp - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_spdef, v_over); v_spdef := v_spdef - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_def, v_over); v_def := v_def - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_spatk, v_over); v_spatk := v_spatk - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_atk, v_over); v_atk := v_atk - v_cut; v_over := v_over - v_cut;
    end;
  end if;

  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';
  update player_charms set atk = v_atk, spatk = v_spatk, def = v_def, spdef = v_spdef, hp = v_hp,
    ctype2 = m.ctype, fused = true where id = p_base and owner_id = auth.uid();
  update pets set charm_id = null where charm_id = p_mat and owner_id = auth.uid();
  delete from player_charms where id = p_mat and owner_id = auth.uid();
  return json_build_object('ok', true, 'total', v_atk + v_spatk + v_def + v_spdef + v_hp);
end; $$;
grant execute on function pet_charm_fuse(uuid, uuid) to authenticated;

-- 継承：チャーム同士のみ。リボンは弾く
create or replace function pet_charm_inherit(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f player_charms%rowtype;
begin
  if p_from = p_to then raise exception 'same charm'; end if;
  select * into f from player_charms where id = p_from and owner_id = auth.uid();
  if not found then raise exception 'from not found'; end if;
  declare t player_charms%rowtype;
  begin
  select * into t from player_charms where id = p_to and owner_id = auth.uid();
  if not found then raise exception 'to not found'; end if;
  if f.ctype like 'rib\_%' or t.ctype like 'rib\_%' then raise exception 'ribbon cannot inherit here'; end if;
  declare v_atk int := f.atk; v_spatk int := f.spatk; v_def int := f.def; v_spdef int := f.spdef; v_hp int := f.hp;
    v_cap int := case when t.fused then 300 else 150 end; v_total int; v_over int; v_cut int;
  begin
    v_total := v_atk + v_spatk + v_def + v_spdef + v_hp;
    if v_total > v_cap then
      v_over := v_total - v_cap;
      v_cut := least(v_hp, v_over);    v_hp := v_hp - v_cut;       v_over := v_over - v_cut;
      v_cut := least(v_spdef, v_over); v_spdef := v_spdef - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_def, v_over);   v_def := v_def - v_cut;     v_over := v_over - v_cut;
      v_cut := least(v_spatk, v_over); v_spatk := v_spatk - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_atk, v_over);   v_atk := v_atk - v_cut;     v_over := v_over - v_cut;
    end if;
    update player_charms set
      atk = v_atk, spatk = v_spatk, def = v_def, spdef = v_spdef, hp = v_hp
      where id = p_to and owner_id = auth.uid();
  end;
  end;
  update pets set charm_id = null where charm_id = p_from and owner_id = auth.uid();
  delete from player_charms where id = p_from and owner_id = auth.uid();
end; $$;
grant execute on function pet_charm_inherit(uuid, uuid) to authenticated;

-- 通常強化：リボンは弾く（リボンは pet_ribbon_enhance で凝縮された素を使う）
create or replace function pet_charm_enhance(p_charm_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_charm_id and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if c.ctype like 'rib\_%' then raise exception 'use pet_ribbon_enhance for ribbon'; end if;
  v_key := case p_stat when 'atk' then 'atk_seed' when 'spatk' then 'spatk_seed' when 'def' then 'def_seed'
                       when 'spdef' then 'spdef_seed' when 'hp' then 'hp_seed' else null end;
  if v_key is null then raise exception 'bad stat'; end if;

  v_total := c.atk + c.spatk + c.def + c.spdef + c.hp;
  v_room := (case when c.fused then 300 else 150 end) - v_total;
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', p_stat, p_stat) using v_use, p_charm_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;
grant execute on function pet_charm_enhance(uuid, text, int) to authenticated;
