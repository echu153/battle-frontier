-- ============================================================
-- チャーム合成の解除：神秘の欠片1つで合成状態を解除
--  - 合成済み(fused=true)のチャームの 2つ目の効果(ctype2) を外し fused=false に戻す
--  - 成長値(atk/spatk/def/spdef/hp)はそのまま据え置き
--  - 神秘の欠片は pet_storage の item_key='shard' を1つ消費
--  Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================
create or replace function pet_charm_unfuse(p_charm uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c player_charms%rowtype; v_shard int;
begin
  select * into c from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if not c.fused then raise exception 'not fused'; end if;

  -- 神秘の欠片を1つ消費
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'no shard'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';

  -- 2つ目の効果を外し、合成フラグを解除（成長値はそのまま）
  update player_charms set ctype2 = null, fused = false where id = p_charm and owner_id = auth.uid();

  return json_build_object('ok', true);
end; $$;
grant execute on function pet_charm_unfuse(uuid) to authenticated;
