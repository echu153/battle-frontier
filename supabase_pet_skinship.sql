-- ============================================================
-- スキンシップ（なつき度を上げる唯一の手段）Phase/バッチ2
--  - 1日2回まで +1。毎日 5:00 / 17:00 (JST) にリセット（2つの時間帯）
--  - 付与は RPC(SECURITY DEFINER) のみ＝クライアント改ざん不可
-- ============================================================

alter table pets add column if not exists skinship_count int not null default 0;
alter table pets add column if not exists skinship_period_start timestamptz;

-- 現在の時間帯の開始時刻（JST 5:00 or 17:00 境界）を返す
create or replace function pet_period_start()
returns timestamptz language plpgsql stable set search_path = public as $$
declare v_jst timestamp; v_hour int; v_date date;
begin
  v_jst  := timezone('Asia/Tokyo', now());  -- JSTの壁掛け時刻
  v_hour := extract(hour from v_jst);
  v_date := v_jst::date;
  if v_hour >= 17 then
    return timezone('Asia/Tokyo', (v_date::text || ' 17:00')::timestamp);
  elsif v_hour >= 5 then
    return timezone('Asia/Tokyo', (v_date::text || ' 05:00')::timestamp);
  else
    return timezone('Asia/Tokyo', ((v_date - 1)::text || ' 17:00')::timestamp);
  end if;
end; $$;

-- スキンシップ実行：時間帯内2回まで、なつき +1
create or replace function pet_skinship(p_pet_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_pet   pets%rowtype;
  v_pstart timestamptz;
  v_count int;
  v_new_aff int;
begin
  select * into v_pet from pets where id = p_pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_pstart := pet_period_start();
  if v_pet.skinship_period_start is distinct from v_pstart then
    v_count := 0;            -- 時間帯が変わったのでリセット
  else
    v_count := v_pet.skinship_count;
  end if;

  -- 1時間帯(12時間)につき1回まで＝1日2回
  if v_count >= 1 then
    raise exception 'skinship limit reached';
  end if;

  v_new_aff := least(100, v_pet.affection + 1);
  update pets set affection = v_new_aff,
                  skinship_count = v_count + 1,
                  skinship_period_start = v_pstart
    where id = v_pet.id;

  return json_build_object('affection', v_new_aff, 'remaining', 1 - (v_count + 1));
end; $$;

grant execute on function pet_period_start() to authenticated;
grant execute on function pet_skinship(uuid) to authenticated;
