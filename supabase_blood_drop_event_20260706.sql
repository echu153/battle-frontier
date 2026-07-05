-- ============================================================
-- 血のドロップ率UPイベント (JST 2026/7/6 5:00 〜 7/20 4:59)
--   grant_boss_evo_drop を「期間自動判定」つきに差し替える。
--   ・イベント期間中: 血 90%
--   ・通常時        : 血 70%（2026-07-05時点の本番値。イベント終了後は自動で70%に戻る＝再適用不要）
--   ・心臓          : 0.5% 据え置き（イベント対象外）
--   ※apply_battle_result 系には一切触れないため、SQL適用順の鉄則
--     (mutant_gold_20260703.sql v2 を最後に) とは無関係に単独で実行してよい。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_boss_evo_drop(p_area_id integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_blood text;
  v_heart text;
  v_id items.id%TYPE;
  v_got_blood text := null;
  v_got_heart text := null;
  v_blood_rate numeric := 0.7;  -- 通常時の血ドロップ率
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false); END IF;
  v_blood := CASE p_area_id
    WHEN 1 THEN 'スライムの血' WHEN 2 THEN '盗賊の血' WHEN 3 THEN '番人の血'
    WHEN 4 THEN '海竜の血' WHEN 5 THEN '雷鷲の血' WHEN 6 THEN '氷霊の血'
    WHEN 7 THEN 'サラマンダーの血' ELSE NULL END;
  v_heart := CASE p_area_id
    WHEN 1 THEN 'スライムの心臓' WHEN 2 THEN '盗賊の心臓' WHEN 3 THEN '番人の心臓'
    WHEN 4 THEN '海竜の心臓' WHEN 5 THEN '雷鷲の心臓' WHEN 6 THEN '氷霊の心臓'
    WHEN 7 THEN 'サラマンダーの心臓' ELSE NULL END;
  IF v_blood IS NULL THEN RETURN json_build_object('ok', false); END IF;

  -- 血ドロップ率UPイベント (JST 2026/7/6 5:00 〜 7/20 4:59) 中は 90%
  IF now() >= '2026-07-06 05:00:00+09'::timestamptz
     AND now() <  '2026-07-20 05:00:00+09'::timestamptz THEN
    v_blood_rate := 0.9;
  END IF;

  -- 血（期間自動判定: イベント中90% / 通常70%）
  IF random() < v_blood_rate THEN
    SELECT id INTO v_id FROM items WHERE name = v_blood LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
      v_got_blood := v_blood;
    END IF;
  END IF;
  -- 心臓 0.5%（据え置き）
  IF random() < 0.005 THEN
    SELECT id INTO v_id FROM items WHERE name = v_heart LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
      v_got_heart := v_heart;
    END IF;
  END IF;
  RETURN json_build_object('ok', true, 'blood', v_got_blood, 'heart', v_got_heart);
END $function$;

GRANT EXECUTE ON FUNCTION public.grant_boss_evo_drop(integer) TO authenticated;
