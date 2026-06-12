-- ============================================================
-- 出撃ロックRPC（クールダウン判定の完全サーバー化） (2026-06-12)
--   これまで: クライアントが端末時計(オフセット補正付き)で lockTime を計算して
--             UPDATE ... WHERE last_action_at < lockTime を実行
--             → オフセット推定誤差(回線ジッタ)分だけ「出撃可能表示なのにCD中」が残った
--   これから: 判定も記録も100%サーバー時計。クライアントは成功/残り秒数を受け取り、
--             残り秒数から相対カウントダウンするだけ（端末時計に依存しない）
-- ============================================================
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row profiles%ROWTYPE;
  v_left numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  -- 行ロックで連打・複数端末を直列化
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  IF v_row.last_action_at IS NOT NULL THEN
    v_left := 10 - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;
