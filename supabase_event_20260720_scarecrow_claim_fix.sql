-- ============================================================
-- かかしイベント補正: イベント終了間際の修練でEXPが半減する問題の予防修正
--   症状(予防): 8/3 4:59までに開始した修練(最長8h)を、イベント終了後(8/3 5:00以降)に
--   受け取ると、scarecrow_claim が「受取時刻」で判定するため表示2倍→実付与1倍になる。
--   → 判定を「開始時 or 受取時のどちらかがイベント期間内なら2倍」に変更（プレイヤー有利側。
--     表示(scarecrow_state)も同じ判定にするので、表示が実付与を上回ることは無い）。
--   ※イベント本体 supabase_event_20260720_scarecrow_abyss.sql の【後】に実行。
--     scarecrow_start(idle_exclusive版) は開始時点で now()=started_at のため変更不要。
--   イベント終了後は自動で通常挙動＝再適用不要。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 開始時刻も考慮した修練EXP（開始時 or 現在のどちらかがイベント期間内なら2倍）
CREATE OR REPLACE FUNCTION public.scarecrow_exp_for_session(p_hours int, p_started timestamptz)
 RETURNS int
 LANGUAGE sql STABLE
AS $$
  SELECT (CASE p_hours
    WHEN 3 THEN 200 WHEN 4 THEN 300 WHEN 5 THEN 450
    WHEN 6 THEN 600 WHEN 7 THEN 850 WHEN 8 THEN 1000
    ELSE 0 END) * (CASE WHEN bf_event_20260720_active()
      OR (p_started >= '2026-07-20 05:00:00+09'::timestamptz
          AND p_started < '2026-08-03 05:00:00+09'::timestamptz)
    THEN 2 ELSE 1 END);
$$;

-- ===== 状態取得（supabase_scarecrow.sql 版＋session.exp_reward を開始時刻考慮に変更） =====
CREATE OR REPLACE FUNCTION public.scarecrow_state()
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_week date := scarecrow_week_key_now();
  v_session scarecrow_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('error','キャラクターが見つかりません'); END IF;

  -- 週が変わっていればチャージ・今週の獲得数をリセット
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_week THEN
    PERFORM set_config('app.allow_stat_change','on',true);
    UPDATE profiles SET scarecrow_charges = 0, scarecrow_earned_week = 0, scarecrow_week_key = v_week WHERE id = v_uid;
    v_profile.scarecrow_charges := 0;
    v_profile.scarecrow_earned_week := 0;
  END IF;

  SELECT * INTO v_session FROM scarecrow_sessions
  WHERE player_id = v_uid AND status = 'active' LIMIT 1;

  RETURN json_build_object(
    'charges',  v_profile.scarecrow_charges,
    'progress', v_profile.scarecrow_progress,
    'earned',   COALESCE(v_profile.scarecrow_earned_week, 0),
    'session',  CASE WHEN v_session.id IS NULL THEN NULL ELSE json_build_object(
      'id', v_session.id,
      'duration_hours', v_session.duration_hours,
      'started_at', v_session.started_at,
      'ends_at', v_session.ends_at,
      'exp_reward', scarecrow_exp_for_session(v_session.duration_hours, v_session.started_at),
      'finished', now() >= v_session.ends_at
    ) END
  );
END;
$function$;

-- ===== 報酬受け取り（supabase_scarecrow.sql 版＋EXP算出を開始時刻考慮に変更） =====
CREATE OR REPLACE FUNCTION public.scarecrow_claim()
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_session scarecrow_sessions%ROWTYPE;
  v_exp int;
  v_class_lv integer;
  v_cap integer;
  v_is_at_cap boolean;
  v_exp_frozen boolean;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_pending integer; v_new_char_lv integer;
  v_level_ups integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;

  SELECT * INTO v_session FROM scarecrow_sessions
  WHERE player_id = v_uid AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','修練中ではありません'); END IF;

  -- ★時間検証: サーバー時刻で終了時刻を過ぎていなければ受け取れない
  IF now() < v_session.ends_at THEN
    RETURN json_build_object('error','まだ修練が終わっていません');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid FOR UPDATE;
  -- ★イベント: 開始時 or 受取時のどちらかが期間内なら2倍（表示と一致）
  v_exp := scarecrow_exp_for_session(v_session.duration_hours, v_session.started_at);

  PERFORM set_config('app.allow_stat_change','on',true);

  -- レベルキャップ・EXP凍結（不正ペナルティ）は出撃と同じ扱い
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  v_new_exp      := COALESCE(v_profile.exp, 0);
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    v_new_exp := v_new_exp + v_exp;
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
      v_level_ups := v_level_ups + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;
  ELSE
    v_exp := 0;  -- キャップ到達 or EXP凍結中はEXPなし
  END IF;

  UPDATE profiles SET
    exp = v_new_exp, exp_next = v_new_exp_next, lv = v_new_lv,
    pending_stat_points = v_new_pending, char_lv = v_new_char_lv
  WHERE id = v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv = v_new_lv, exp = v_new_exp
    WHERE player_id = v_uid AND class_name = v_profile.class;
  END IF;

  UPDATE scarecrow_sessions SET status = 'claimed', exp_reward = v_exp WHERE id = v_session.id;

  RETURN json_build_object(
    'success', true,
    'exp', v_exp,
    'level_ups', v_level_ups,
    'new_lv', v_new_lv,
    'at_cap', v_is_at_cap,
    'exp_frozen', v_exp_frozen
  );
END;
$function$;
