-- ============================================================
-- チャーム合成：神秘の欠片1つ消費で2つのチャームを1つに（効果も両方引継ぎ）
--  - player_charms に ctype2(2つ目の効果) と fused(合成済みフラグ) を追加
--  - 成長値は合算（上限 合計300）。合成済みのチャームは再合成不可
--  - 神秘の欠片は pet_storage の item_key='shard' を消費
-- ============================================================
alter table player_charms add column if not exists ctype2 text;
alter table player_charms add column if not exists fused boolean not null default false;

-- p_base: 残すチャーム(効果＝base.ctype + 吸収側のctypeをctype2に)。p_mat: 吸収して消えるチャーム
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
  if b.fused or m.fused then raise exception 'already fused'; end if; -- 合成済みは不可

  -- 神秘の欠片を1つ消費
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'no shard'; end if;

  -- 成長値を合算（合計300まで。超過分は切り捨て＝攻→特攻→防→特防→HPの順に詰める）
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
  -- baseに合算＆2つ目の効果(ctype2)を付与・合成済みフラグ
  update player_charms set atk = v_atk, spatk = v_spatk, def = v_def, spdef = v_spdef, hp = v_hp,
    ctype2 = m.ctype, fused = true where id = p_base and owner_id = auth.uid();
  -- 吸収素材は装備を外して削除
  update pets set charm_id = null where charm_id = p_mat and owner_id = auth.uid();
  delete from player_charms where id = p_mat and owner_id = auth.uid();

  return json_build_object('ok', true, 'total', v_atk + v_spatk + v_def + v_spdef + v_hp);
end; $$;
grant execute on function pet_charm_fuse(uuid, uuid) to authenticated;
