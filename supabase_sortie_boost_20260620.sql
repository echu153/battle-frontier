-- ============================================================
-- 出撃改善 2026-06-20
--   ① 通常出撃クールダウン 10秒 → 20秒（sortie_lock）
--   ② ブーストタイム: 1日1回30分、街の出撃CDが10秒に短縮（profilesに列追加＋start_boost RPC）
--   ③ レベルアップ必要EXPを半減（calc_exp_next。クライアント calcExpNext と一致）
--
--   ※ レイド出撃CD20秒化は supabase_raid_cooldown_fix.sql（v_cooldown=20）を再適用。
--   ※ レイド出撃回数ティア保証の半減は supabase_raid_update_20260610.sql を再適用。
--   ※ 簡易出撃(SortiePanel)の60秒化はクライアントのみ（last_action_atの楽観ロック）。
--   ※ このファイルは pure関数の置換＋列追加＋新RPCのみ。protect_stats等の戦闘/報酬関数には触れないため、適用順は任意。
-- ============================================================

-- ① ブースト管理列 -------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_active_until timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_used_date    date;

-- ② 通常出撃ロック（ブースト中は10秒、通常は20秒） -----------------
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  profiles%ROWTYPE;
  v_wait int;
  v_left numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  -- 行ロックで連打・複数端末を直列化
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  -- ブーストタイム中は10秒、それ以外は20秒
  v_wait := CASE WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now()
                 THEN 10 ELSE 20 END;

  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;

-- ②-2 ブースト発動RPC（1日1回・30分） ----------------------------
CREATE OR REPLACE FUNCTION public.start_boost()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   profiles%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;  -- 日次リセットはJST基準（デイリーダンジョンと同じ）
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- すでにブースト中
  IF v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now() THEN
    RETURN json_build_object('ok',false,'reason','active',
      'boost_active_until', v_row.boost_active_until, 'boost_used_date', v_row.boost_used_date);
  END IF;

  -- 本日分は使用済み
  IF v_row.boost_used_date = v_today THEN
    RETURN json_build_object('ok',false,'reason','already_used',
      'boost_used_date', v_row.boost_used_date);
  END IF;

  v_until := now() + interval '30 minutes';
  UPDATE profiles SET boost_active_until = v_until, boost_used_date = v_today WHERE id = v_uid;

  RETURN json_build_object('ok',true,'boost_active_until', v_until, 'boost_used_date', v_today);
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_boost() TO authenticated;

-- ③ レベルアップ必要EXP半減（クライアント calcExpNext と一致） ------
CREATE OR REPLACE FUNCTION public.calc_exp_next(lv integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_in_block integer;
BEGIN
  -- LV100超（再修練でキャップ300になったクラス）
  IF lv >= 100 THEN
    IF lv <= 150 THEN RETURN 75; END IF;  -- LV100〜150
    IF lv <= 200 THEN RETURN 80; END IF;  -- LV151〜200
    IF lv <= 250 THEN RETURN 85; END IF;  -- LV201〜250
    RETURN 90;                            -- LV251〜300
  END IF;
  v_in_block := (lv - 1) % 100;
  IF v_in_block < 9  THEN RETURN 40; END IF;  -- LV1〜9
  IF v_in_block < 29 THEN RETURN 50; END IF;  -- LV10〜29
  IF v_in_block < 59 THEN RETURN 60; END IF;  -- LV30〜59
  RETURN 70;                                   -- LV60〜99
END;
$$;
