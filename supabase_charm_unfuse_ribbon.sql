-- ============================================================
-- リボン合成の解除（2026-07-07）
--   pet_charm_fuse_ribbon の逆操作。合成と「同じ素材」＝神秘の欠片1＋ゼニ10000を消費。
--   ・ctype3(リボン合成枠)を外し、そのリボンを元の種類で新規生成（+値0・特殊能力なし）
--   ・チャーム本体の成長値(+ステ)はそのまま維持。ctype3ぶんの特殊能力(3枠目)は除去
--   ・装備中のチャームは解除不可
-- 適用順の制約なし（独立機能）
-- ============================================================
create or replace function pet_charm_unfuse_ribbon(p_charm uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c player_charms%rowtype; v_shard int; v_zeni int; v_rib text;
begin
  select * into c from player_charms where id = p_charm and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if c.ctype3 is null then raise exception 'no fused ribbon'; end if;
  -- 装備中は解除不可（安全）
  if exists (select 1 from pets where owner_id = auth.uid() and (charm_id = p_charm or ribbon_id = p_charm)) then
    raise exception 'equipped charm cannot be unfused';
  end if;

  -- コスト：神秘の欠片1＋ゼニ10000（合成と同じ）
  select coalesce(qty,0) into v_shard from pet_storage where owner_id = auth.uid() and item_key = 'shard';
  if coalesce(v_shard,0) < 1 then raise exception 'not enough shard'; end if;
  select coalesce(qty,0) into v_zeni from pet_storage where owner_id = auth.uid() and item_key = 'zeni';
  if coalesce(v_zeni,0) < 10000 then raise exception 'not enough zeni'; end if;
  update pet_storage set qty = qty - 1 where owner_id = auth.uid() and item_key = 'shard';
  update pet_storage set qty = qty - 10000 where owner_id = auth.uid() and item_key = 'zeni';

  v_rib := c.ctype3;
  -- リボンを元の種類で新規生成（+値0・特殊能力なし）
  insert into player_charms(owner_id, ctype) values (auth.uid(), v_rib);
  -- チャームは現状の+ステを維持し、リボン枠(ctype3)と3枠目の特殊能力を外す
  update player_charms set ctype3 = null, specials = coalesce(specials, '[]'::jsonb) - 2 where id = p_charm;
  return json_build_object('ribbon', v_rib);
end; $$;
grant execute on function pet_charm_unfuse_ribbon(uuid) to authenticated;
