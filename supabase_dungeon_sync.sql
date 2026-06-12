-- ============================================================
-- ペットダンジョン 状態保存＋1端末専用ロック 2026-06-13
--  ・探索の進行状態を dungeon_runs.client_state(jsonb) に保存（中断/リロード継続）
--  ・device_id で「最後に開いた端末」を記録し、別端末で開くと前の端末はロック
--    （ダンジョンは複数端末同時プレイ不可）
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

alter table dungeon_runs add column if not exists client_state jsonb;
alter table dungeon_runs add column if not exists device_id text;

-- 端末を主張（最後に開いた端末が操作権を持つ）
create or replace function dungeon_claim_device(p_run_id uuid, p_device text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update dungeon_runs set device_id = p_device
  where id = p_run_id and owner_id = auth.uid() and status = 'active';
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true);
end; $$;

-- 進行状態を保存（操作権を持つ端末のみ。別端末が主張済みなら locked を返す）
create or replace function dungeon_save_state(p_run_id uuid, p_state jsonb, p_device text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_dev text; v_owner uuid;
begin
  select device_id, owner_id into v_dev, v_owner from dungeon_runs where id = p_run_id and status = 'active';
  if v_owner is null or v_owner <> auth.uid() then return json_build_object('ok', false); end if;
  if v_dev is not null and p_device is not null and v_dev <> p_device then
    return json_build_object('ok', false, 'locked', true);  -- 別端末でプレイ中
  end if;
  update dungeon_runs set client_state = p_state, device_id = coalesce(p_device, device_id) where id = p_run_id;
  return json_build_object('ok', true);
end; $$;

grant execute on function dungeon_claim_device(uuid, text) to authenticated;
grant execute on function dungeon_save_state(uuid, jsonb, text) to authenticated;
