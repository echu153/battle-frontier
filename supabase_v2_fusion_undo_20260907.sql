-- ============================================================
-- バトルフロンティアⅡ（リメイク版）— 「因子」を廃止して、特殊能力を刻印へ戻す
--   2026-09-07
-- ------------------------------------------------------------
-- ★ユーザー指示（2026-09-07）
--   ・合成素材は**レイドボスからだけ**落ちる（敵270体ぶんの「◯◯の因子」は廃止）
--   ・特殊能力は**これまで通り刻印（ルーンの抽出）から低確率で**付く
--     通常0% / レア1% / 激レア3%
--
-- ★流すのはこの1本だけでOKです（core を流し直す必要はありません）。
--   もし supabase_v2_ability_move_20260906.sql（④本目）を流していたら、
--   このファイルがその変更を打ち消します。流していなくても**何も壊しません**。
--   ⚠④のファイルはもう配りません。手元にあっても流さないでください。
-- ============================================================

-- ① 敵ぶんの合成素材（source=enemy）を消す。
--    ★持っている人がいるかもしれないので、**先に所持ぶんを消す**（外部キーのため）。
--    レイドぶん（source=raid）の5種はそのまま残る。
delete from public.v2_player_fusions
 where fusion_id in (select id from public.v2_fusion_materials where source = 'enemy');
delete from public.v2_fusion_materials where source = 'enemy';

-- ② 出撃で合成素材を配っていたRPCを落とす（画面はもう呼びません）
drop function if exists public.v2_grant_fusion_drop(text);

-- ③ 抽出で**特殊能力が付く**版へ戻す（supabase_v2_core.sql と同じ中身）。
--    ④で上書きされていた場合はここで元に戻ります。
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
  v_chance numeric;
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
    -- 特殊能力：通常0% / レア1% / 激レア3%
    v_chance := case v_mat.rarity when 'ultra' then 3 when 'rare' then 1 else 0 end;
    if v_chance > 0 and random() * 100 < v_chance and not (v_mat.enemy = any (v_choices)) then
      v_choices := array_append(v_choices, v_mat.enemy);
    end if;
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
