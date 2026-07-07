-- ============================================================
-- 途中階スタート用「到達した最深階」の記録（2026-07-07）
--   ダンジョンごとに到達した最深階を保存し、次回その階から開始できるようにする。
--   ・dungeon_progress(owner_id, dungeon_id, max_floor)
--   ・dungeon_mark_floor：フロア進入時にクライアントが呼ぶ（max更新のみ）
--   ・読み取りは本人のみ（RLS）。書き込みは security definer RPC 経由のみ
-- ============================================================
create table if not exists dungeon_progress (
  owner_id   uuid not null,
  dungeon_id text not null,
  max_floor  int  not null default 1,
  primary key (owner_id, dungeon_id)
);
alter table dungeon_progress enable row level security;
drop policy if exists dungeon_progress_sel on dungeon_progress;
create policy dungeon_progress_sel on dungeon_progress for select using (owner_id = auth.uid());
-- INSERT/UPDATE ポリシーは作らない＝直書き不可。更新は下のRPCのみ

create or replace function dungeon_mark_floor(p_dungeon text, p_floor int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_dungeon is null or p_floor is null or p_floor < 1 then return; end if;
  insert into dungeon_progress(owner_id, dungeon_id, max_floor)
    values (auth.uid(), p_dungeon, least(p_floor, 99))
    on conflict (owner_id, dungeon_id)
    do update set max_floor = greatest(dungeon_progress.max_floor, excluded.max_floor);
end; $$;
grant execute on function dungeon_mark_floor(text, int) to authenticated;
