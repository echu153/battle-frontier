-- ============================================================
-- 出撃改善 2026-06-20  ★is_admin限定先行（一般プレイヤーは従来どおり）
--   ① 通常出撃クールダウン: 管理者のみ 10→20秒（非管理者は10秒のまま）
--   ② ブーストタイム: 管理者のみ 1日1回30分、街の出撃CDが10秒に短縮
--   ③ レベルアップ必要EXP: 管理者のみ半減（非管理者は従来値）
--
--   ※ レイド出撃CD/回数ティアの管理者先行は supabase_raid_cooldown_fix.sql / supabase_raid_update_20260610.sql を再適用。
--   ※ 一般公開時は各関数の is_admin 分岐を外す（このファイルのコメントの「公開時」を参照）。
--   ※ pure関数置換＋列追加＋新RPCのみ。protect_stats等の戦闘/報酬関数には触れないため適用順は任意。
-- ============================================================

-- ① ブースト管理列＋パピア時間帯（プレイヤー選択） ----------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_active_until timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_used_date    date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour        int;          -- パピア出現率アップ開始時刻(JST 0-23) 枠1。NULL=未設定
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour2       int;          -- パピア枠2(JST 0-23)。NULL=未設定
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour_set_at timestamptz;  -- 設定日時（変更は1か月に1回まで）

-- パピア時間帯の設定RPC（is_admin限定先行・2枠・一度決めたら1か月変更不可）
DROP FUNCTION IF EXISTS public.set_papia_hour(int);
CREATE OR REPLACE FUNCTION public.set_papia_hour(p_hour int, p_hour2 int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_hour IS NULL OR p_hour < 0 OR p_hour > 23 THEN RETURN json_build_object('ok',false,'reason','invalid_hour'); END IF;
  IF p_hour2 IS NOT NULL AND (p_hour2 < 0 OR p_hour2 > 23) THEN RETURN json_build_object('ok',false,'reason','invalid_hour'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★2026-06-20公開: 全プレイヤー設定可
  -- 一度決めたら1か月（30日）変更不可
  IF v_row.papia_hour_set_at IS NOT NULL AND now() < v_row.papia_hour_set_at + interval '30 days' THEN
    RETURN json_build_object('ok',false,'reason','locked',
      'papia_hour', v_row.papia_hour, 'papia_hour2', v_row.papia_hour2,
      'unlock_at', v_row.papia_hour_set_at + interval '30 days');
  END IF;
  PERFORM set_config('app.allow_boost_change','on',true);  -- ★列保護トリガー許可
  UPDATE profiles SET papia_hour = p_hour, papia_hour2 = p_hour2, papia_hour_set_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true,'papia_hour', p_hour, 'papia_hour2', p_hour2, 'unlock_at', now() + interval '30 days');
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_papia_hour(int, int) TO authenticated;

-- ② 通常出撃ロック（管理者: ブースト中10秒/通常20秒、非管理者: 10秒） ----
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

  -- ★2026-06-20公開: 全プレイヤー20秒・ブースト中10秒
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

-- ②-2 ブースト発動RPC（管理者限定・1日1回・30分） -----------------
CREATE OR REPLACE FUNCTION public.start_boost()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   profiles%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo' - interval '5 hours')::date;  -- 日次リセットはJST朝5時基準（5時より前は前日扱い）
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★2026-06-20公開: 全プレイヤー発動可
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
  PERFORM set_config('app.allow_boost_change','on',true);  -- ★列保護トリガー許可
  UPDATE profiles SET boost_active_until = v_until, boost_used_date = v_today WHERE id = v_uid;

  RETURN json_build_object('ok',true,'boost_active_until', v_until, 'boost_used_date', v_today);
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_boost() TO authenticated;

-- ③ レベルアップ必要EXP（管理者のみ半減。クライアント calcExpNext と一致） --
--   STABLE: 呼び出しユーザー(auth.uid())の is_admin を参照するため IMMUTABLE 不可。
--   apply_battle_result / casino_settle_sortie からは calc_exp_next(lv) 呼び出しのまま
--   auth.uid() 経由で当人の is_admin が効くので、それらの関数の再定義は不要。
--   公開時は「常に半減（base/2）」に変更する。
-- ★2026-06-20公開: 全プレイヤー「半減＋10」。auth.uid()依存をやめ IMMUTABLE に戻す。
CREATE OR REPLACE FUNCTION public.calc_exp_next(lv integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_in_block integer;
  v_base     integer;
BEGIN
  IF lv >= 100 THEN
    v_base := CASE WHEN lv <= 150 THEN 150 WHEN lv <= 200 THEN 160 WHEN lv <= 250 THEN 170 ELSE 180 END;
  ELSE
    v_in_block := (lv - 1) % 100;
    v_base := CASE WHEN v_in_block < 9 THEN 80 WHEN v_in_block < 29 THEN 100 WHEN v_in_block < 59 THEN 120 ELSE 140 END;
  END IF;
  RETURN floor(v_base / 2.0)::integer + 10;
END;
$$;

-- ★2026-06-20公開: boost/papia 列の直接書き換え対策（start_boost / set_papia_hour 経由のみ許可）
--   通常UPDATEでこれらの列を変えると拒否。RPCは app.allow_boost_change='on' を立ててから更新する。
CREATE OR REPLACE FUNCTION public.protect_boost_papia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_boost_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.boost_active_until IS DISTINCT FROM OLD.boost_active_until
       OR NEW.boost_used_date  IS DISTINCT FROM OLD.boost_used_date
       OR NEW.papia_hour       IS DISTINCT FROM OLD.papia_hour
       OR NEW.papia_hour2      IS DISTINCT FROM OLD.papia_hour2
       OR NEW.papia_hour_set_at IS DISTINCT FROM OLD.papia_hour_set_at THEN
      RAISE EXCEPTION '不正な操作です（ブースト/パピア設定はサーバー経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_boost_papia ON public.profiles;
CREATE TRIGGER trg_protect_boost_papia
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_boost_papia();
