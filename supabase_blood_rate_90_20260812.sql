-- ============================================================
-- 血のドロップ率を恒常90%に引き上げ (2026-08-12)
--   grant_boss_evo_drop の「正」= 本ファイル
--     ・ベース: supabase_area8_soutenn_20260723.sql §3（エリア①〜⑧対応版）
--     ・変更点: 血ドロップ率 70% → 90% を恒常化（期間限定イベント判定を撤去）
--     ・心臓 0.5% は据え置き
--   ※クライアント側の血→心臓 変換は「血20個 → 心臓1個」に緩和済み
--     (src/constants/bossEvolution.js の BLOOD_PER_HEART = 20。SQL不要)
--   ※apply_battle_result 系には一切触れないため、SQL適用順の鉄則
--     (supabase_mutant_gold_20260703.sql v2 を最後に) とは無関係に単独で実行してよい。
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
  v_blood_rate numeric := 0.9;  -- 血ドロップ率（2026-08-12: 0.7 → 0.9 恒常化）
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false); END IF;
  v_blood := CASE p_area_id
    WHEN 1 THEN 'スライムの血' WHEN 2 THEN '盗賊の血' WHEN 3 THEN '番人の血'
    WHEN 4 THEN '海竜の血' WHEN 5 THEN '雷鷲の血' WHEN 6 THEN '氷霊の血'
    WHEN 7 THEN 'サラマンダーの血' WHEN 8 THEN '覇龍の血' ELSE NULL END;
  v_heart := CASE p_area_id
    WHEN 1 THEN 'スライムの心臓' WHEN 2 THEN '盗賊の心臓' WHEN 3 THEN '番人の心臓'
    WHEN 4 THEN '海竜の心臓' WHEN 5 THEN '雷鷲の心臓' WHEN 6 THEN '氷霊の心臓'
    WHEN 7 THEN 'サラマンダーの心臓' WHEN 8 THEN '覇龍の心臓' ELSE NULL END;
  IF v_blood IS NULL THEN RETURN json_build_object('ok', false); END IF;

  -- 血 90%（恒常）
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
