-- ============================================================
-- ⚠【旧版・実行不要】supabase_ribbon_separate_pool.sql に置き換わりました。
--   後から流すと凝縮強化が「本体atk等と共有の300」に巻き戻ります。適用しないでください。
-- ============================================================
-- リボン合成済みチャーム(ctype3あり)を「凝縮された素」で強化（2026-07-07・旧版=共有300）
--   pet_charm_enhance は通常の素専用。リボン合成後は凝縮された素の使い道が無かったため追加。
--   ・対象: ctype3(リボン合成枠)を持つチャームのみ
--   ・消費: 凝縮された素(atk_seed_c 等) 1個 = +1（HPは表示+5）
--   ・上限: 通常強化と共有で合計300まで（+ステの総和で判定）
-- 適用順の制約なし（独立機能）
-- ============================================================
create or replace function pet_charm_enhance_condensed(p_charm_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_charm_id and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  if c.ctype3 is null then raise exception 'not ribbon-fused'; end if;  -- リボン合成済みのみ
  v_key := case p_stat when 'atk' then 'atk_seed_c' when 'spatk' then 'spatk_seed_c' when 'def' then 'def_seed_c'
                       when 'spdef' then 'spdef_seed_c' when 'hp' then 'hp_seed_c' else null end;
  if v_key is null then raise exception 'bad stat'; end if;

  v_total := c.atk + c.spatk + c.def + c.spdef + c.hp;
  v_room := 300 - v_total;  -- 通常の素と共有で合計300まで
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', p_stat, p_stat) using v_use, p_charm_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;
grant execute on function pet_charm_enhance_condensed(uuid, text, int) to authenticated;
