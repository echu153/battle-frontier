-- ============================================================
-- ペットダンジョン 複数端末同期 2026-06-13
--  探索の進行状態（フロア・座標・HP・満腹・持ち物・マップ等）をサーバーに保存し、
--  どの端末から開いても最新状態を復元できるようにする。
--  ・dungeon_runs.client_state(jsonb) に保存
--  ・dungeon_save_state(run_id, state) で更新（本人・active のみ）
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

alter table dungeon_runs add column if not exists client_state jsonb;

create or replace function dungeon_save_state(p_run_id uuid, p_state jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  update dungeon_runs set client_state = p_state
  where id = p_run_id and owner_id = auth.uid() and status = 'active';
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true);
end; $$;

grant execute on function dungeon_save_state(uuid, jsonb) to authenticated;
