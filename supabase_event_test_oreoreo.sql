-- ============================================================
-- 【テスト】出撃ポイントラリーを「おれおれお」だけで確認する
--   ① sortie_lock を おれおれお のみポイント加算する版に差し替え
--   ② Sレアレイドボス装備選択券を おれおれお に1枚付与
--   ※公開時は supabase_event_sortie_2026.sql の sortie_lock（username条件なし）を再適用すること
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ① sortie_lock（テスト：おれおれお のみ加算）
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_row profiles%ROWTYPE; v_wait int; v_left numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;
  v_wait := CASE WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now()
                 THEN 10 ELSE 20 END;
  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;
  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;
  -- ★テスト中: 管理者のみ・期間/event_config非依存で必ず加算（event_key直書き）。
  --   公開時は is_admin 条件を外し、event_config の期間で判定する版（本体SQL）に戻すこと。
  IF v_row.is_admin THEN
    INSERT INTO event_points (player_id, event_key, points)
    VALUES (v_uid, 'sortie_2026_06', 1)
    ON CONFLICT (player_id, event_key) DO UPDATE SET points = event_points.points + 1;
  END IF;
  RETURN json_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;

-- ② Sレアレイドボス装備選択券を おれおれお に1枚付与
INSERT INTO player_items (player_id, item_id, quantity, equipped)
SELECT p.id, i.id, 1, false
FROM profiles p, items i
WHERE p.username = 'おれおれお' AND i.name = 'Sレアレイドボス装備選択券'
ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;

-- 確認
SELECT p.username, i.name, pi.quantity
FROM player_items pi
JOIN profiles p ON p.id = pi.player_id
JOIN items i ON i.id = pi.item_id
WHERE p.username = 'おれおれお' AND i.name = 'Sレアレイドボス装備選択券';
