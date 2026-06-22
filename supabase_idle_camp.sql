-- ============================================================
-- 自動遠征 / 放置キャンプ（Idle Camp）  ※is_admin限定で先行
--   ・「ページ（または常駐ミニ窓）を開いている間だけ」EXP/Goldが溜まる方式。
--     ＝完全放置(閉じても進む)ではない。ハートビートで在席時間のみ加算する。
--   ・加算判定は全てサーバー(now())基準＝クライアント改ざん不可。
--     状態は idle_camp に保持し、書込はRPCのみ(RLSは読取専用)。
--
-- 【方式】
--   - idle_start: 起点。running化(started_at=now)・accrued_sec=0・last_beat_at=now。
--   - idle_heartbeat: ページが定期送信(20秒毎)。前回beatからの経過が
--       GRACE(90秒)以内なら accrued_sec に加算 / 超なら加算せず起点だけnowに戻す
--       （＝ページを閉じていた空白時間は貯まらない）。上限 cap_min*60 秒。
--   - idle_claim: accrued_sec を分換算してEXP/Gold付与。端数秒は残す。
--
-- ★適用順: protect_stats.sql / alchemy.sql の【後】に実行（calc_exp_next と
--   protect_profile_stats トリガーに依存）。既存DBへの再適用も想定し ALTER 込み。
-- Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- ===== 調整パラメータ =====
--   ・上限: 480分(8時間)ぶんまで蓄積（在席分のみ）
--   ・レート: 到達済み最高エリア(area_max,1〜7)に比例
--       EXP /分 = 3 * area_max   /   Gold/分 = 5 * area_max
--   ・GRACE(在席とみなす最大空白) = 90秒（heartbeatが20秒毎なので余裕を持たせる）

-- ===== 1) 状態テーブル（書込はRPCのみ・読取は本人のみ） =====
CREATE TABLE IF NOT EXISTS idle_camp (
  player_id   uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  timestamptz,                       -- NULL=停止中 / NOT NULL=遠征中
  accrued_sec int         NOT NULL DEFAULT 0,    -- 在席中に貯まった秒（未受取）
  last_beat_at timestamptz,                      -- 最終ハートビート
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- 既存DB（旧バージョン適用済み）への列追加（冪等）
ALTER TABLE idle_camp ADD COLUMN IF NOT EXISTS accrued_sec  int NOT NULL DEFAULT 0;
ALTER TABLE idle_camp ADD COLUMN IF NOT EXISTS last_beat_at timestamptz;

ALTER TABLE idle_camp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idle_camp_select ON idle_camp;
CREATE POLICY idle_camp_select ON idle_camp FOR SELECT USING (player_id = auth.uid());
-- INSERT/UPDATE/DELETE ポリシーは作らない＝通常クライアントは書込不可（SECURITY DEFINER RPC のみ）。

-- ===== 2) 共通ヘルパ：放置レート（/分）と上限 =====
CREATE OR REPLACE FUNCTION public.idle_rates(p_uid uuid)
 RETURNS TABLE(exp_pm int, gold_pm int, cap_min int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_areas int[]; v_area_max int;
BEGIN
  SELECT COALESCE(unlocked_areas, ARRAY[1]) INTO v_areas FROM profiles WHERE id = p_uid;
  SELECT COALESCE(MAX(a), 1) INTO v_area_max FROM unnest(COALESCE(v_areas, ARRAY[1])) AS a;
  v_area_max := GREATEST(1, LEAST(v_area_max, 7));
  exp_pm  := 3 * v_area_max;
  gold_pm := 5 * v_area_max;
  cap_min := 480;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_rates(uuid) TO authenticated;

-- ===== 3) 状態取得（表示用・非破壊） =====
CREATE OR REPLACE FUNCTION public.idle_get()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_row idle_camp%ROWTYPE;
  v_rate record;
  v_class_lv int; v_cap int; v_at_cap boolean; v_frozen boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT COALESCE(v_profile.is_admin, false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT * INTO v_row FROM idle_camp WHERE player_id = v_uid;
  SELECT * INTO v_rate FROM idle_rates(v_uid);

  SELECT lv INTO v_class_lv FROM class_levels WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5 THEN 300 ELSE 100 END;
  v_at_cap := v_class_lv >= v_cap;
  v_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  RETURN json_build_object(
    'ok', true,
    'running', (v_row.started_at IS NOT NULL),
    'accrued_sec', COALESCE(v_row.accrued_sec, 0),
    'last_beat_at', v_row.last_beat_at,
    'grace_sec', 90,
    'cap_min', v_rate.cap_min,
    'exp_pm', v_rate.exp_pm,
    'gold_pm', v_rate.gold_pm,
    'at_cap', v_at_cap,
    'exp_frozen', v_frozen,
    'server_now', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_get() TO authenticated;

-- ===== 4) 開始（起点を now() に・蓄積0から） =====
CREATE OR REPLACE FUNCTION public.idle_start()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_started timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin,false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT started_at INTO v_started FROM idle_camp WHERE player_id = v_uid;
  IF v_started IS NOT NULL THEN
    RETURN json_build_object('ok',false,'reason','already_running');
  END IF;

  INSERT INTO idle_camp(player_id, started_at, accrued_sec, last_beat_at, updated_at)
    VALUES (v_uid, now(), 0, now(), now())
  ON CONFLICT (player_id) DO UPDATE
    SET started_at = now(), accrued_sec = 0, last_beat_at = now(), updated_at = now();
  RETURN json_build_object('ok',true,'started_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_start() TO authenticated;

-- ===== 5) ハートビート（在席時間のみ accrued_sec に加算） =====
--   ページ/ミニ窓が開いている間、20秒ごとに呼ぶ。前回beatからの経過が
--   GRACE以内なら加算（＝開いていた）、超なら加算せず起点リセット（＝閉じていた）。
CREATE OR REPLACE FUNCTION public.idle_heartbeat()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_row idle_camp%ROWTYPE;
  v_rate record;
  v_cap_sec int;
  v_gap numeric;
  v_grace int := 90;
  v_add int := 0;
  v_capped boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin,false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT * INTO v_row FROM idle_camp WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_row.started_at IS NULL THEN
    RETURN json_build_object('ok',true,'running',false,'server_now',now());
  END IF;

  SELECT * INTO v_rate FROM idle_rates(v_uid);
  v_cap_sec := v_rate.cap_min * 60;

  IF v_row.last_beat_at IS NOT NULL THEN
    v_gap := EXTRACT(EPOCH FROM (now() - v_row.last_beat_at));
    IF v_gap > 0 AND v_gap <= v_grace THEN
      v_add := FLOOR(v_gap)::int;  -- 在席分だけ加算
    END IF;
  END IF;

  UPDATE idle_camp
     SET accrued_sec = LEAST(COALESCE(accrued_sec,0) + v_add, v_cap_sec),
         last_beat_at = now(),
         updated_at = now()
   WHERE player_id = v_uid
  RETURNING accrued_sec INTO v_row.accrued_sec;

  v_capped := v_row.accrued_sec >= v_cap_sec;

  RETURN json_build_object(
    'ok', true, 'running', true,
    'accrued_sec', v_row.accrued_sec,
    'last_beat_at', now(),
    'added_sec', v_add,
    'is_full', v_capped,
    'server_now', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_heartbeat() TO authenticated;

-- ===== 6) 受け取り（accrued_sec を分換算して付与・端数秒は残す） =====
CREATE OR REPLACE FUNCTION public.idle_claim()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_row idle_camp%ROWTYPE;
  v_rate record;
  v_cap_sec int;
  v_total_sec int;
  v_gap numeric;
  v_grace int := 90;
  v_claim_min int;
  v_leftover_sec int;
  v_class_lv int; v_cap int; v_at_cap boolean; v_frozen boolean;
  v_gain_exp int := 0; v_gain_gold int := 0;
  v_new_exp int; v_new_lv int; v_new_exp_next int; v_new_pending int; v_new_char_lv int;
  v_level_ups int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF NOT COALESCE(v_profile.is_admin, false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  -- 行ロック（二重受け取り防止）
  SELECT * INTO v_row FROM idle_camp WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_row.started_at IS NULL THEN
    RETURN json_build_object('ok',false,'reason','not_running');
  END IF;

  SELECT * INTO v_rate FROM idle_rates(v_uid);
  v_cap_sec := v_rate.cap_min * 60;

  -- 受け取り時点で、最後のbeatからの在席ぶん(GRACE以内)も締めて加算
  v_total_sec := COALESCE(v_row.accrued_sec, 0);
  IF v_row.last_beat_at IS NOT NULL THEN
    v_gap := EXTRACT(EPOCH FROM (now() - v_row.last_beat_at));
    IF v_gap > 0 AND v_gap <= v_grace THEN
      v_total_sec := v_total_sec + FLOOR(v_gap)::int;
    END IF;
  END IF;
  v_total_sec := LEAST(v_total_sec, v_cap_sec);

  v_claim_min := FLOOR(v_total_sec / 60.0)::int;
  IF v_claim_min < 1 THEN
    -- 1分未満：締めだけ反映して終了（端数は保持）
    UPDATE idle_camp SET accrued_sec = v_total_sec, last_beat_at = now(), updated_at = now()
      WHERE player_id = v_uid;
    RETURN json_build_object('ok',false,'reason','too_soon','accrued_sec',v_total_sec);
  END IF;
  v_leftover_sec := v_total_sec - v_claim_min * 60;

  -- レベル上限／EXP凍結
  SELECT lv INTO v_class_lv FROM class_levels WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5 THEN 300 ELSE 100 END;
  v_at_cap := v_class_lv >= v_cap;
  v_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  v_gain_gold := v_claim_min * v_rate.gold_pm;
  v_gain_exp  := CASE WHEN v_at_cap OR v_frozen THEN 0 ELSE v_claim_min * v_rate.exp_pm END;

  -- レベルアップ計算（apply_battle_result と同じロジック）
  v_new_exp      := COALESCE(v_profile.exp, 0) + v_gain_exp;
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);

  IF NOT v_at_cap AND NOT v_frozen THEN
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
      v_level_ups := v_level_ups + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    exp = v_new_exp, exp_next = v_new_exp_next, lv = v_new_lv,
    char_lv = v_new_char_lv, pending_stat_points = v_new_pending,
    gold = gold + v_gain_gold
  WHERE id = v_uid;

  IF NOT v_at_cap AND NOT v_frozen THEN
    UPDATE class_levels SET lv = v_new_lv, exp = v_new_exp
      WHERE player_id = v_uid AND class_name = v_profile.class;
  END IF;

  -- 端数秒だけ残して継続稼働。last_beat_atをnowにして空白を作らない。
  UPDATE idle_camp SET accrued_sec = v_leftover_sec, last_beat_at = now(), updated_at = now()
    WHERE player_id = v_uid;

  RETURN json_build_object(
    'ok', true,
    'gained_exp', v_gain_exp,
    'gained_gold', v_gain_gold,
    'claimed_min', v_claim_min,
    'level_ups', v_level_ups,
    'new_lv', v_new_lv
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_claim() TO authenticated;
