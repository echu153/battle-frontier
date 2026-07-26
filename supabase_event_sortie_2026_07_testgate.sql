-- ============================================================
-- 夏の出撃ポイントラリー: テスト中は「開発(is_admin)のみポイント加算」に絞る
--   ・event_config に test_only 列を追加（true の間は非管理者に加算しない）
--   ・sortie_lock / grant_event_point がその列を見て加算を判定
--   ・既に一般プレイヤーへ入ってしまった sortie_2026_07 のポイントを消す
--   公開するとき: UPDATE event_config SET test_only=false WHERE event_key='sortie_2026_07';
--                （関数の再適用は不要＝データ側フラグで切替）
--   適用順: apply_battle_result を触らないので任意（protect_stats/mutant_gold の後でOK）
-- ============================================================

-- 1) 期間中でも「test_only=true の間は非管理者に加算しない」ためのフラグ列
ALTER TABLE event_config ADD COLUMN IF NOT EXISTS test_only boolean NOT NULL DEFAULT false;
UPDATE event_config SET test_only = true  WHERE event_key = 'sortie_2026_07';

-- 2) 既に一般プレイヤーへ加算されてしまった分を取り消す（管理者の検証ぶんは残す）
DELETE FROM event_points
WHERE event_key = 'sortie_2026_07'
  AND player_id NOT IN (SELECT id FROM profiles WHERE COALESCE(is_admin, false));

-- 3) 通常出撃の加算（公開版sortie_mode_public_20260626を踏襲・イベント加算にゲートを追加）
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_row profiles%ROWTYPE; v_wait int; v_left numeric;
  v_half int;  -- 今回付与する半ポイント数（10秒=1, 20秒=2）
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  v_wait := CASE WHEN v_row.sortie_mode = 10 THEN 10 ELSE 20 END;

  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;

  -- イベント: 開催期間内なら出撃ポイント加算（20秒=1pt / 10秒=0.5pt・fracで繰越）。
  -- ★test_only=true のイベントは is_admin にのみ加算（公開時は test_only=false にする）。
  v_half := CASE WHEN v_row.sortie_mode = 10 THEN 1 ELSE 2 END;
  INSERT INTO event_points (player_id, event_key, points, frac)
  SELECT v_uid, ec.event_key, v_half / 2, v_half % 2
  FROM event_config ec
  WHERE now() >= ec.starts_at AND now() < ec.ends_at
    AND (NOT ec.test_only OR COALESCE(v_row.is_admin, false))
  ON CONFLICT (player_id, event_key) DO UPDATE
    SET points = event_points.points + ((event_points.frac + v_half) / 2),
        frac   = (event_points.frac + v_half) % 2;

  RETURN json_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;

-- 4) レイド/ダンジョンの加算（トリガーが呼ぶ grant_event_point にも同じゲート）
CREATE OR REPLACE FUNCTION public.grant_event_point(p_uid uuid, p_n int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_uid IS NULL OR p_n IS NULL OR p_n <= 0 THEN RETURN; END IF;
  INSERT INTO event_points (player_id, event_key, points)
  SELECT p_uid, ec.event_key, p_n FROM event_config ec
  WHERE now() >= ec.starts_at AND now() < ec.ends_at
    AND (NOT ec.test_only OR EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = p_uid AND COALESCE(pr.is_admin, false)))
  ON CONFLICT (player_id, event_key) DO UPDATE SET points = event_points.points + EXCLUDED.points;
END $$;
