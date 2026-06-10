-- ============================================================
-- チャーム（ペット装備品）土台
--  - player_charms: 所持チャーム（種類＋5ステの成長値 0〜100、HPは10刻み）
--  - pets.charm_id: そのペットが装備しているチャーム
--  - RPC: 初期化(はじまりのチャーム自動付与)/付与/装備/強化(素消費)/継承
-- ============================================================

create table if not exists player_charms (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  ctype      text not null,             -- 'hajimari' / 'antidote' / 'guard' ...
  atk   int not null default 0,
  spatk int not null default 0,
  def   int not null default 0,
  spdef int not null default 0,
  hp    int not null default 0,         -- HPは10刻みで加算
  created_at timestamptz not null default now()
);
create index if not exists player_charms_owner_idx on player_charms(owner_id);
alter table player_charms enable row level security;
drop policy if exists player_charms_select_own on player_charms;
create policy player_charms_select_own on player_charms for select using (auth.uid() = owner_id);

alter table pets add column if not exists charm_id uuid references player_charms(id) on delete set null;

-- 初期化：チャーム未装備のペットに「はじまりのチャーム」を付与＆装備
create or replace function pet_charm_init()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_id uuid;
begin
  for r in select id from pets where owner_id = auth.uid() and charm_id is null loop
    insert into player_charms(owner_id, ctype) values (auth.uid(), 'hajimari') returning id into v_id;
    update pets set charm_id = v_id where id = r.id;
  end loop;
end; $$;

-- 付与（ダンジョンのドロップ等）。新しいチャームを1個作る
create or replace function pet_charm_grant(p_ctype text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_ctype,'') = '' then raise exception 'bad ctype'; end if;
  insert into player_charms(owner_id, ctype) values (auth.uid(), p_ctype) returning id into v_id;
  return v_id;
end; $$;

-- 装備（p_charm_id = null で外す）
create or replace function pet_charm_equip(p_pet_id uuid, p_charm_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then raise exception 'pet not found'; end if;
  if p_charm_id is not null and not exists (select 1 from player_charms where id = p_charm_id and owner_id = auth.uid()) then raise exception 'charm not found'; end if;
  update pets set charm_id = p_charm_id where id = p_pet_id and owner_id = auth.uid();
end; $$;

-- 強化：素(pet_items)を消費してチャームの1ステ列(=使用個数)を上げる。
--  各素は消費1。全ステの合計(使用個数)は 150 まで。HPの素のみ表示上 1個=HP+5（列には個数を保存）
--  p_stat: 'atk'|'spatk'|'def'|'spdef'|'hp' / p_times: 使用する素の個数
create or replace function pet_charm_enhance(p_charm_id uuid, p_stat text, p_times int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_key text; v_have int; v_total int; v_use int; v_room int; c player_charms%rowtype;
begin
  if p_times is null or p_times < 1 then raise exception 'bad times'; end if;
  select * into c from player_charms where id = p_charm_id and owner_id = auth.uid();
  if not found then raise exception 'charm not found'; end if;
  v_key := case p_stat when 'atk' then 'atk_seed' when 'spatk' then 'spatk_seed' when 'def' then 'def_seed'
                       when 'spdef' then 'spdef_seed' when 'hp' then 'hp_seed' else null end;
  if v_key is null then raise exception 'bad stat'; end if;

  v_total := c.atk + c.spatk + c.def + c.spdef + c.hp;   -- 既に使った素の合計
  v_room := 150 - v_total;                               -- あと使える数
  -- 素は倉庫(pet_storage)から消費する
  select coalesce(qty,0) into v_have from pet_storage where owner_id = auth.uid() and item_key = v_key;
  v_use := least(p_times, v_have, v_room);
  if v_use <= 0 then raise exception 'cannot enhance'; end if;

  update pet_storage set qty = qty - v_use where owner_id = auth.uid() and item_key = v_key;
  execute format('update player_charms set %I = %I + $1 where id = $2', p_stat, p_stat) using v_use, p_charm_id;
  return json_build_object('used', v_use, 'stat', p_stat);
end; $$;

-- 継承：継承元(p_from)の成長値を継承先(p_to)へ移し、元のチャームは削除する
create or replace function pet_charm_inherit(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f player_charms%rowtype;
begin
  if p_from = p_to then raise exception 'same charm'; end if;
  select * into f from player_charms where id = p_from and owner_id = auth.uid();
  if not found then raise exception 'from not found'; end if;
  if not exists (select 1 from player_charms where id = p_to and owner_id = auth.uid()) then raise exception 'to not found'; end if;
  -- 継承先に元の成長値（使用個数）をそのままコピー（合計は元々150以下）
  update player_charms set
    atk = f.atk, spatk = f.spatk, def = f.def, spdef = f.spdef, hp = f.hp
    where id = p_to and owner_id = auth.uid();
  -- 装備していたペットがいれば外す → 元チャーム削除
  update pets set charm_id = null where charm_id = p_from and owner_id = auth.uid();
  delete from player_charms where id = p_from and owner_id = auth.uid();
end; $$;

grant execute on function pet_charm_init() to authenticated;
grant execute on function pet_charm_grant(text) to authenticated;
grant execute on function pet_charm_equip(uuid, uuid) to authenticated;
grant execute on function pet_charm_enhance(uuid, text, int) to authenticated;
grant execute on function pet_charm_inherit(uuid, uuid) to authenticated;
