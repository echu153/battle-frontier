-- ============================================================
-- チャーム合成の解除：神秘の欠片1つで合成状態を解除
--  - 合成済み(fused=true)のチャームの 2つ目の効果(ctype2) を外し fused=false に戻す
--  - ★成長値は単体チャーム上限(150)へ切り詰める（合成は2体ぶん300まで持てるため、
--    解除して単体に戻すと「単体なのに上限超過(最大300)」の不正状態が残る不具合を修正）
--    超過分は合成時と同じ順(hp→特防→防→特攻→攻)で詰める
--  - 神秘の欠片は pet_storage の item_key='shard' を1つ消費
--  Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================
create or replace function pet_charm_unfuse(p_charm uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c player_charms%rowtype; v_shard int;
  v_atk int; v_spatk int; v_def int; v_spdef int; v_hp int; v_total int;
begin
  select * into c from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if not c.fused then raise exception 'not fused'; end if;

  -- 神秘の欠片を1つ消費
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'no shard'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';

  -- 成長値を単体上限(150)へ切り詰める（超過分は hp→特防→防→特攻→攻 の順で削る）
  v_atk := c.atk; v_spatk := c.spatk; v_def := c.def; v_spdef := c.spdef; v_hp := c.hp;
  v_total := v_atk + v_spatk + v_def + v_spdef + v_hp;
  if v_total > 150 then
    declare v_over int := v_total - 150; declare v_cut int;
    begin
      v_cut := least(v_hp, v_over);    v_hp := v_hp - v_cut;       v_over := v_over - v_cut;
      v_cut := least(v_spdef, v_over); v_spdef := v_spdef - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_def, v_over);   v_def := v_def - v_cut;     v_over := v_over - v_cut;
      v_cut := least(v_spatk, v_over); v_spatk := v_spatk - v_cut; v_over := v_over - v_cut;
      v_cut := least(v_atk, v_over);   v_atk := v_atk - v_cut;     v_over := v_over - v_cut;
    end;
  end if;

  -- 2つ目の効果を外し、合成フラグ解除＋成長値を上限内に補正＋特殊能力(フェイトコア抽選)を全消去
  update player_charms set ctype2 = null, fused = false,
    atk = v_atk, spatk = v_spatk, def = v_def, spdef = v_spdef, hp = v_hp,
    specials = '[]'::jsonb
    where id = p_charm and owner_id = auth.uid();

  return json_build_object('ok', true);
end; $$;
grant execute on function pet_charm_unfuse(uuid) to authenticated;
