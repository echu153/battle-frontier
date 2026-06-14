-- ============================================================
-- 追加: 釣りでの時の結晶ドロップ(1匹ごと1%) ＋ おれおれおの錬金完了
--   ※ supabase_alchemy.sql 適用済みの環境で、この差分だけ実行すればOK。
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 1) 釣りでの時の結晶ドロップRPC（錬金解放後=エリア③ボス撃破済のみ・サーバー側抽選）
CREATE OR REPLACE FUNCTION public.fishing_grant_crystal(p_count int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_areas int[]; v_n int; v_drops int := 0; i int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(unlocked_areas, ARRAY[1]) INTO v_areas FROM profiles WHERE id = v_uid;
  IF v_areas IS NULL OR NOT (v_areas @> ARRAY[4]) THEN RETURN json_build_object('ok',true,'crystal_drop',0); END IF;
  v_n := GREATEST(0, LEAST(COALESCE(p_count,0), 100));  -- 1回の付与上限100匹ぶん
  FOR i IN 1..v_n LOOP
    IF random() < 0.01 THEN v_drops := v_drops + 1; END IF;
  END LOOP;
  IF v_drops > 0 THEN
    PERFORM set_config('app.allow_stat_change','on',true);
    UPDATE profiles SET time_crystal = time_crystal + v_drops WHERE id = v_uid;
  END IF;
  RETURN json_build_object('ok',true,'crystal_drop',v_drops);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fishing_grant_crystal(int) TO authenticated;

-- 2) おれおれおの錬金を即完了（稼働中の枠の完成時刻を now に＝受け取り可能に）
UPDATE alchemy_jobs SET finish_at = now()
WHERE player_id = (SELECT id FROM profiles WHERE username = 'おれおれお')
  AND rank IS NOT NULL;
