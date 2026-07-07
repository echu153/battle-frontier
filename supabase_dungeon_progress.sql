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

-- フロア進入時に到達最深階を更新。ただし「現在の最深＋1」までしか伸ばせない
--   （一足飛びに深い階を申告して max_floor を水増しする不正を抑止＝順番に潜らないと伸びない）
create or replace function dungeon_mark_floor(p_dungeon text, p_floor int)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur int; v_new int;
begin
  if p_dungeon is null or p_floor is null or p_floor < 1 then return; end if;
  select coalesce(max_floor, 0) into v_cur from dungeon_progress
    where owner_id = auth.uid() and dungeon_id = p_dungeon;
  v_cur := coalesce(v_cur, 0);
  -- 既に到達済みの階(≤現在最深)は無視。新規は現在最深＋1のみ許可
  if p_floor <= v_cur then return; end if;
  if p_floor > v_cur + 1 then return; end if;  -- 飛び級は無視
  v_new := least(p_floor, 99);
  insert into dungeon_progress(owner_id, dungeon_id, max_floor)
    values (auth.uid(), p_dungeon, v_new)
    on conflict (owner_id, dungeon_id)
    do update set max_floor = greatest(dungeon_progress.max_floor, excluded.max_floor);
end; $$;
grant execute on function dungeon_mark_floor(text, int) to authenticated;

-- ラン開始時に開始階を検証・記録。到達した最深階を超える開始は1階に是正（未到達の深部からの開始＝不正を防止）
alter table dungeon_runs add column if not exists start_floor int not null default 1;

drop function if exists dungeon_start(uuid, text);
drop function if exists dungeon_start(uuid, text, int);
create or replace function dungeon_start(p_pet_id uuid, p_dungeon_id text default 'd10', p_start_floor int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_max int; v_sf int; v_dg text := coalesce(p_dungeon_id, 'd10');
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then
    raise exception 'pet not found';
  end if;
  -- 開始階＝到達した最深階まで。超過や未記録なら1階に是正
  v_sf := greatest(coalesce(p_start_floor, 1), 1);
  if v_sf > 1 then
    select coalesce(max_floor, 1) into v_max from dungeon_progress where owner_id = auth.uid() and dungeon_id = v_dg;
    if v_sf > coalesce(v_max, 1) then v_sf := 1; end if;
  end if;
  update dungeon_runs set status = 'abandoned' where owner_id = auth.uid() and status = 'active';
  insert into dungeon_runs(owner_id, pet_id, status, dungeon_id, start_floor)
    values (auth.uid(), p_pet_id, 'active', v_dg, v_sf)
    returning id into v_id;
  return v_id;
end; $$;
grant execute on function dungeon_start(uuid, text, int) to authenticated;
