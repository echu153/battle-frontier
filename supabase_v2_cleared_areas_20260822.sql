-- ===== v2：エリアの踏破済み表示（cleared_areas）2026-08-22 =====
-- エリアボスを倒したエリアを覚えて、出撃のプルダウンに「✔踏破済み」と出すための差分。
-- ⚠ supabase_v2_core.sql を全文流し直すなら**この差分は不要**（本体に取り込み済み）。

-- ---- 1) 列を足す ----
alter table public.v2_profiles add column if not exists cleared_areas  int[]       not null default '{}'; -- エリアボスを倒したエリア（⑧は次が無いので unlocked では分からない）


-- ---- 2) 踏破済みの埋め戻し（列を足した直後の1回だけ効く） ----
-- 「エリアNが解放されている＝エリアN-1のボスを倒した」で過去ぶんを復元する。
-- ⑧の踏破だけは記録が残っていないので復元できない（次に⑧のボスを倒したときに付く）
update public.v2_profiles p
   set cleared_areas = sub.arr
  from (
    select pr.id,
           coalesce(array_agg(distinct a - 1) filter (where a > 1), '{}') as arr
      from public.v2_profiles pr, unnest(pr.unlocked_areas) as a
     group by pr.id
  ) sub
 where p.id = sub.id and coalesce(array_length(p.cleared_areas, 1), 0) = 0;



-- ---- 3) 出撃の清算：ボスに勝ったら cleared_areas へ積む ----
drop function if exists public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb);
create or replace function public.v2_sortie_settle(
  p_area int, p_normals int, p_boss_wins int, p_boss_seen int,
  p_exp int, p_gold bigint, p_drops jsonb, p_materials jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_area  public.v2_areas;
  v_equip public.v2_equipment;
  v_sock  text[];
  v_mid   text;
  v_n     int := greatest(coalesce(p_normals, 0), 0);
  v_bw    int := greatest(coalesce(p_boss_wins, 0), 0);
  v_bs    int := greatest(coalesce(p_boss_seen, 0), 0);
  v_exp_cap  int;
  v_exp   int;
  v_drop  jsonb;
  v_ok    int := 0;
  v_res   jsonb;
  v_unlocked int[];
  v_cleared  int[];
  v_rate  numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_area from public.v2_areas where id = p_area;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエリアはありません'); end if;
  if not (v_row.unlocked_areas @> array[p_area]) then
    return jsonb_build_object('ok', false, 'error', 'このエリアはまだ解放されていません');
  end if;
  if v_n + v_bs = 0 then return jsonb_build_object('ok', false, 'error', '清算するものがありません'); end if;
  if v_n + v_bs > 500 then return jsonb_build_object('ok', false, 'error', '一度に清算できる回数を超えています'); end if;
  -- ★ボス勝利数は「ボスに遭遇した回数」を超えられない。
  --   ここを見ていないと、遭遇1回のまま勝利数だけ大きく送れて下の上限計算が青天井になる
  --   （回数の頭打ちは v_n + v_bs にしか掛かっていないため）。
  v_bw := least(v_bw, v_bs);

  -- 取り得る上限。通常敵はEXP11・ボスは13が最大（sortie.js と同じ）
  v_exp_cap  := v_n * 11 + v_bw * 13;
  v_exp  := least(greatest(coalesce(p_exp, 0), 0), v_exp_cap);
  -- ★Goldはここで一切足さない（p_gold は無視）

  -- ドロップ。そのエリアで落ちるランクかどうかだけ見る
  if p_drops is not null and jsonb_typeof(p_drops) = 'array' then
    if jsonb_array_length(p_drops) > v_n + v_bs then
      return jsonb_build_object('ok', false, 'error', 'ドロップの数が戦闘回数を超えています');
    end if;
    for v_drop in select * from jsonb_array_elements(p_drops) loop
      select * into v_equip from public.v2_equipment e
      where e.id = (v_drop #>> '{}') and v_area.drop_ranks ? e.rank;
      if found then
        -- ★ソケットの色はここで決める（サーバー権威）。**いまは武器だけ・1枠ずつ1/3**
        --   片手2枠・両手3枠。防具・アクセへ広げるときはこの条件を直す
        v_sock := '{}'::text[];
        if v_equip.part = '武器' then
          for i in 1 .. (case when v_equip.hands = '2' then 3 else 2 end) loop
            v_sock := array_append(v_sock, (array['red','blue','green'])[1 + floor(random() * 3)::int]);
          end loop;
        end if;
        insert into public.v2_inventory (player_id, equip_id, sockets) values (v_uid, v_equip.id, v_sock);
        v_ok := v_ok + 1;
      end if;
    end loop;
  end if;

  -- エンチャントの素材。**1戦闘につき1個まで**しか落ちないので、そこだけ検証する
  --   ⚠「素材ドロップ率up」の特殊能力はクライアント側の確率なので、サーバーからは検証できない
  if p_materials is not null and jsonb_typeof(p_materials) = 'array' then
    if jsonb_array_length(p_materials) > v_n + v_bs then
      return jsonb_build_object('ok', false, 'error', '素材の数が戦闘回数を超えています');
    end if;
    for v_drop in select * from jsonb_array_elements(p_materials) loop
      v_mid := v_drop #>> '{}';
      insert into public.v2_player_materials (player_id, material_id, qty)
      select v_uid, m.id, 1 from public.v2_materials m where m.id = v_mid and m.area = p_area
      on conflict (player_id, material_id) do update set qty = public.v2_player_materials.qty + 1;
    end loop;
  end if;

  -- ボス撃破で次のエリアが解放される（旧版と同じ）
  v_unlocked := v_row.unlocked_areas;
  if v_bw > 0 and p_area < 8 and not (v_unlocked @> array[p_area + 1]) then
    v_unlocked := array_append(v_unlocked, p_area + 1);
  end if;
  -- 踏破済み（そのエリアのボスを倒した）。⑧は解放される先が無いのでここでしか残らない
  v_cleared := coalesce(v_row.cleared_areas, '{}');
  if v_bw > 0 and not (v_cleared @> array[p_area]) then
    v_cleared := array_append(v_cleared, p_area);
  end if;
  -- ボス遭遇率。通常敵と戦うたび+0.3、ボスに当たった回があれば0へ戻す
  v_rate := case when v_bs > 0 then 0 else least(100, v_row.boss_rate + 0.3 * v_n) end;

  update public.v2_profiles
     set unlocked_areas = v_unlocked, cleared_areas = v_cleared, boss_rate = v_rate,
         last_sortie_at = now(), updated_at = now()
   where id = v_uid;

  v_res := public.v2_apply_exp(v_uid, v_exp);
  -- デイリーミッション：この清算で戦った回数ぶん数える（通常敵＋ボス）。
  -- ★20秒設定は1回で2カウント（src/v2/lib/daily.js の SORTIE_COUNT と同じ）。
  --   20秒×50回も10秒×100回も同じ1000秒＝かかる時間あたりの進み具合をそろえる
  perform public.v2_daily_bump(v_uid, 'sortie',
    (v_n + v_bs) * (case when v_row.sortie_cd = 20 then 2 else 1 end));
  return jsonb_build_object('ok', true, 'exp', v_exp, 'gold', 0, 'drops', v_ok,
    'unlocked', to_jsonb(v_unlocked), 'cleared', to_jsonb(v_cleared),
    'boss_rate', v_rate, 'level', v_res);
end;
$$;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb) from public;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb) from anon;
grant execute on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb) to authenticated;

