-- ============================================================
-- 簡易出撃100回ごとに、選択中ペットのなつき +1
--  - クライアントは清算済みの累計出撃回数から「今回上げるべき回数(p_times)」を計算して呼ぶ
--  - サーバーは選択中(is_active)ペットのなつきを p_times だけ加算（上限100）
-- ============================================================
create or replace function pet_sortie_affection(p_times int)
returns json language plpgsql security definer set search_path = public as $$
declare v_pet pets%rowtype; v_new_aff int;
begin
  if p_times is null or p_times < 1 then return json_build_object('affection', null, 'added', 0); end if;
  if p_times > 100 then p_times := 100; end if; -- 暴走防止
  select * into v_pet from pets where owner_id = auth.uid() and is_active = true limit 1;
  if not found then return json_build_object('affection', null, 'added', 0); end if;
  v_new_aff := least(100, v_pet.affection + p_times);
  update pets set affection = v_new_aff where id = v_pet.id;
  return json_build_object('affection', v_new_aff, 'added', v_new_aff - v_pet.affection);
end; $$;
grant execute on function pet_sortie_affection(int) to authenticated;
