-- ============================================================
-- ダンジョン中断中は出撃を許可する 2026-06-13
--  ・dungeon_runs.suspended（中断フラグ）を追加。
--  ・「現在プレイ中（active かつ suspended=false）」のときだけ出撃をブロック。
--    中断して街に戻った状態（suspended=true）なら出撃できる。
--  ・suspended は 街に戻る(中断) で true、ダンジョン入場/再開(claim) で false。
-- ★ apply_battle_result は has_active_dungeon を使うので、その関数定義（scarecrow.sql /
--    dungeon_block_sortie.sql）はそのままでOK。has_active_dungeon の中身だけ更新する。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

alter table dungeon_runs add column if not exists suspended boolean not null default false;

-- 「現在プレイ中の探索があるか」＝ active かつ 中断していない
create or replace function public.has_active_dungeon(p_uid uuid)
 returns boolean
 language sql stable
as $$
  select exists (
    select 1 from dungeon_runs
    where owner_id = p_uid and status = 'active' and coalesce(suspended, false) = false
  );
$$;

-- 中断フラグの設定
create or replace function public.dungeon_set_suspended(p_run_id uuid, p_suspended boolean)
 returns json language plpgsql security definer set search_path = public as $$
begin
  update dungeon_runs set suspended = p_suspended
  where id = p_run_id and owner_id = auth.uid() and status = 'active';
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true);
end; $$;
grant execute on function public.dungeon_set_suspended(uuid, boolean) to authenticated;

-- 端末主張(=入場/再開)時に「プレイ中」へ戻す（suspended=false も同時に解除）
create or replace function dungeon_claim_device(p_run_id uuid, p_device text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update dungeon_runs set device_id = p_device, suspended = false
  where id = p_run_id and owner_id = auth.uid() and status = 'active';
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true);
end; $$;
grant execute on function dungeon_claim_device(uuid, text) to authenticated;
