-- ============================================================
-- バトルフロンティアⅡ（リメイク版）— 特殊能力をルーンから合成へ移す
--   2026-09-06 ／ **④本目**
-- ------------------------------------------------------------
-- ★流す順（レイドまわりは4本あります）
--     ① supabase_v2_friends_20260906.sql   フレンド
--     ② supabase_v2_fusion_20260906.sql    合成素材と「合成」
--     ③ supabase_v2_raid_20260906.sql      レイドボスと救援
--     ④ supabase_v2_ability_move_20260906.sql 特殊能力をルーンから合成へ移す
--   どれも supabase_v2_core.sql を全文流したあとに、**この順番で**流してください。
--
-- ★**②を先に流してください**（敵の合成素材を配るため）。
-- ⚠このファイルは core の v2_extract_essence を**上書き**します。
--   **supabase_v2_core.sql を流し直したら、このファイルも必ず流し直してください。**
--
-- 設計は docs/v2-raid-design.md。数値の正は src/v2/lib/ 以下で、
-- **このファイルには同じ値の写しが入っている**（raid.test.js が突き合わせる）。
-- ============================================================

-- ============================================================
-- 特殊能力の入手経路を「合成素材」へ一本化（2026-09-06 ユーザー指示）
-- ------------------------------------------------------------
-- それまで特殊能力は**ルーンを抽出するとき稀に付く**ものだったが、
-- **全部この合成素材へ移した**。ルーンは**ステータス%だけ**になる。
--
--   ・敵270体ぶんの合成素材を新設（上の v2_fusion_materials に source='enemy' で入っている）
--   ・**倒した敵の合成素材が一律1%**で落ちる（レア度による差は無い）
--   ・合成に使うのは**1個**
--
-- ⚠**supabase_v2_core.sql を流し直したら、このファイルも必ず流し直すこと。**
--   下の v2_extract_essence は core の同じ関数を**上書き**している
--   （core 側は特殊能力を抽選する古い版のままにしてある）。
-- ============================================================

-- ---- 抽出：特殊能力の抽選を外した版（core の関数を上書きする）----
create or replace function public.v2_extract_essence(p_materials jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_ids   text[];
  v_id    text;
  v_mat   public.v2_materials;
  v_stats jsonb := '{}'::jsonb;
  v_keys  text[] := array['hp','mp','str','dex','agi','int_stat','vit','luk'];
  v_others text[];
  v_pick  text[];
  v_k     text;
  v_val   numeric;
  v_choices text[] := '{}'::text[];
  v_chance numeric;   -- ★2026-09-06 以降は使っていない
  v_red numeric; v_blue numeric; v_green numeric;
  v_color text;
  v_ess   public.v2_essences;
  v_need  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  select array_agg(x #>> '{}') into v_ids from jsonb_array_elements(p_materials) x;
  if coalesce(array_length(v_ids, 1), 0) <> 5 then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  -- ボス素材は1個まで
  if (select count(*) from unnest(v_ids) u join public.v2_materials m on m.id = u where m.is_boss) > 1 then
    return jsonb_build_object('ok', false, 'error', 'ボス素材は1個までしか入れられません');
  end if;
  -- 持っているか（同じIDを重ねて選んだぶんも数える）
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    if coalesce((select qty from public.v2_player_materials
                  where player_id = v_uid and material_id = v_id), 0) < v_need then
      return jsonb_build_object('ok', false, 'error', '素材が足りません');
    end if;
  end loop;
  -- 消費
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    update public.v2_player_materials set qty = qty - v_need
     where player_id = v_uid and material_id = v_id;
  end loop;
  delete from public.v2_player_materials where player_id = v_uid and qty <= 0;

  -- 1個ずつ「型を決める → 値を引く」
  foreach v_id in array v_ids loop
    select * into v_mat from public.v2_materials where id = v_id;
    if not found then continue; end if;
    -- 型：激レアとボスは固定。雑魚の通常・レアは 70% で割り当てステ、30% でそれ以外の7種
    if v_mat.is_boss or v_mat.rarity = 'ultra' or random() * 100 < 70 then
      v_pick := v_mat.stats;
    else
      select array_agg(k) into v_others from unnest(v_keys) k where not (k = any (v_mat.stats));
      v_pick := array[v_others[1 + floor(random() * array_length(v_others, 1))::int]];
    end if;
    foreach v_k in array v_pick loop
      v_val := public.v2_roll_material_value(v_mat.lo, v_mat.hi);
      v_stats := jsonb_set(v_stats, array[v_k],
                   to_jsonb(round(coalesce((v_stats ->> v_k)::numeric, 0) + v_val, 1)));
    end loop;
    -- ★特殊能力はもう付かない（2026-09-06 ユーザー指示で合成素材へ一本化）。
    --   v_choices は空のまま insert する＝画面の「能力を選ぶ」も出なくなる
  end loop;

  -- 色：合計値を3グループで合算して、一番大きいグループ
  select coalesce(sum(case when k in ('str','int_stat')  then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('hp','mp','vit')   then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('dex','agi','luk') then v::numeric else 0 end), 0)
    into v_red, v_blue, v_green
    from jsonb_each_text(v_stats) as t(k, v);
  v_color := case when v_red >= v_blue and v_red >= v_green then 'red'
                  when v_blue >= v_green then 'blue' else 'green' end;

  insert into public.v2_essences (player_id, color, stats, ability_choices)
  values (v_uid, v_color, v_stats, v_choices)
  returning * into v_ess;

  -- デイリーミッション：ルーンを1個作った
  perform public.v2_daily_bump(v_uid, 'rune', 1);

  return jsonb_build_object('ok', true, 'essence', to_jsonb(v_ess));
end;
$$;
revoke all on function public.v2_extract_essence(jsonb) from public;
revoke all on function public.v2_extract_essence(jsonb) from anon;
grant execute on function public.v2_extract_essence(jsonb) to authenticated;

-- ---- 出撃で合成素材が落ちたときの受け取り ----
-- ⚠1%の抽選はクライアント（出撃・装備ドロップと同じ作り）。
--   サーバーが見張るのは「**その素材が実在するか**」と「**10秒に1回まで**」の2つだけ。
--   出撃のクールタイムと同じ間隔なので、まっとうに遊んでいれば当たらない。
alter table public.v2_profiles add column if not exists fusion_drop_at timestamptz;

create or replace function public.v2_grant_fusion_drop(p_fusion_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_at timestamptz;
  v_row jsonb;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  if v_me is null then return jsonb_build_object('ok', false, 'error', 'ログインしてください'); end if;
  -- ★敵から落ちるものだけ。レイドボスの合成素材はここからは配らない（報酬でしか出ない）
  select jsonb_build_object('id', id, 'name', name, 'crown', crown) into v_row
    from public.v2_fusion_materials where id = p_fusion_id and source = 'enemy';
  if v_row is null then return jsonb_build_object('ok', false, 'error', 'その合成素材はありません'); end if;

  select fusion_drop_at into v_at from public.v2_profiles where id = v_me;
  if v_at is not null and v_at > now() - interval '9 seconds' then
    return jsonb_build_object('ok', false, 'error', 'まだ受け取れません');
  end if;

  insert into public.v2_player_fusions (player_id, fusion_id, qty) values (v_me, p_fusion_id, 1)
    on conflict (player_id, fusion_id) do update set qty = public.v2_player_fusions.qty + 1;
  update public.v2_profiles set fusion_drop_at = now() where id = v_me;

  return jsonb_build_object('ok', true, 'fusion', v_row);
end;
$$;
revoke all on function public.v2_grant_fusion_drop(text) from public;
revoke all on function public.v2_grant_fusion_drop(text) from anon;
grant execute on function public.v2_grant_fusion_drop(text) to authenticated;
