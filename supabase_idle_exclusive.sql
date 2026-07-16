-- 放置系の排他: 釣り と かかし修練 は同時に片方だけ
--
-- 原因: 排他チェックが片方向にしか無かった。
--       釣りページは かかし修練中なら ScarecrowBlockScreen でブロックしていたが、
--       かかし側は is_fishing を誰も見ておらず、scarecrow_start RPC にもチェックが無い。
--       → 「釣り開始 → かかしへ移動 → 修練開始」で両方成立していた。
--
-- 方針: チェックを各RPC/各ページに手書きで散らすのをやめ、
--       **テーブルのトリガー**を唯一の関所にする。
--         ・scarecrow_sessions への active INSERT を、釣り中なら弾く
--         ・profiles.is_fishing の false→true を、修練中なら弾く
--       こうすると scarecrow_start / scarecrow_start_test / 今後追加されるRPC や、
--       クライアント直更新まで、どの経路から来ても排他が効く。
--       RPC側のチェックはエラー文言を親切にするためのもので、権威はトリガー側。
--
-- ★ supabase_scarecrow.sql を再適用してもこのファイルのトリガーは消えないが、
--   scarecrow_start は上書きされる（＝親切な文言が消えてトリガーの例外になる）。
--   supabase_scarecrow.sql を流し直したら、このファイルも流し直すこと。
--
-- 単独実行可・冪等。SQLエディタで全文まとめて実行。
-- ※自動遠征(idle_camp)は is_admin 限定のため今回は対象外（一般公開時に同じ関所へ追加すること）。

-- ============================================================
-- ① 共通判定: いま「修練中」か（時間経過後＝報酬受け取り待ちは修練中とみなさない）
--    ※クライアントの useScarecrowBlock と同じ条件に揃えてある
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_scarecrow_training(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scarecrow_sessions
     WHERE player_id = p_uid AND status = 'active' AND ends_at > now()
  );
$$;

-- ============================================================
-- ② 関所その1: 修練の開始を、釣り中なら弾く
--    （scarecrow_sessions への INSERT はどのRPCから来てもここを通る）
-- ============================================================
CREATE OR REPLACE FUNCTION public.assert_not_fishing_on_scarecrow()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'active'
     AND EXISTS (SELECT 1 FROM profiles WHERE id = NEW.player_id AND COALESCE(is_fishing,false)) THEN
    RAISE EXCEPTION '釣り中はかかし修練を開始できません。釣りを終了してから開始してください。';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_scarecrow_not_fishing ON public.scarecrow_sessions;
CREATE TRIGGER trg_scarecrow_not_fishing
  BEFORE INSERT ON public.scarecrow_sessions
  FOR EACH ROW EXECUTE FUNCTION public.assert_not_fishing_on_scarecrow();

-- ============================================================
-- ③ 関所その2: 釣りの開始を、修練中なら弾く
--    （釣り開始はRPCではなくクライアントからの profiles 直更新なのでトリガーで見る）
-- ============================================================
CREATE OR REPLACE FUNCTION public.assert_not_scarecrow_on_fishing()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF COALESCE(NEW.is_fishing,false) AND NOT COALESCE(OLD.is_fishing,false)
     AND is_scarecrow_training(NEW.id) THEN
    RAISE EXCEPTION 'かかし修練中は釣りを開始できません。修練を終えてから開始してください。';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fishing_not_scarecrow ON public.profiles;
CREATE TRIGGER trg_fishing_not_scarecrow
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assert_not_scarecrow_on_fishing();

-- ============================================================
-- ④ scarecrow_start に釣り中チェックを追加（文言を親切にするため。権威は②のトリガー）
--    ※ supabase_scarecrow.sql の同名関数を、この一行分だけ足して上書きする
-- ============================================================
CREATE OR REPLACE FUNCTION public.scarecrow_start(p_hours int)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_week date := scarecrow_week_key_now();
  v_charges int;
  v_week_sessions int;
  v_session scarecrow_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;
  IF p_hours IS NULL OR p_hours < 3 OR p_hours > 8 THEN
    RETURN json_build_object('error','時間は3〜8時間で設定してください');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error','アカウント停止中'); END IF;

  -- ★放置系の排他: 釣り中は開始不可
  IF COALESCE(v_profile.is_fishing,false) THEN
    RETURN json_build_object('error','🎣 釣り中はかかし修練を開始できません');
  END IF;

  -- 既にactiveがあれば不可
  IF EXISTS (SELECT 1 FROM scarecrow_sessions WHERE player_id = v_uid AND status = 'active') THEN
    RETURN json_build_object('error','既に修練中です');
  END IF;

  -- 週リセット込みのチャージ確認
  v_charges := CASE WHEN v_profile.scarecrow_week_key IS DISTINCT FROM v_week
                    THEN 0 ELSE COALESCE(v_profile.scarecrow_charges, 0) END;
  IF v_charges <= 0 THEN
    RETURN json_build_object('error','修練回数がありません（出撃100回で1回チャージ）');
  END IF;

  -- ★不正検知: 今週6回目以降の開始は正規ルートでは不可能（チャージ獲得は週5回まで）。
  --   発生した場合はデータ改ざんとみなしアカウント停止（管理者のテストは除外）
  SELECT count(*) INTO v_week_sessions FROM scarecrow_sessions
  WHERE player_id = v_uid
    AND started_at >= ((v_week::timestamp + interval '5 hours') AT TIME ZONE 'Asia/Tokyo');
  IF v_week_sessions >= 5 THEN
    IF NOT COALESCE(v_profile.is_admin, false) THEN
      PERFORM set_config('app.allow_stat_change','on',true);
      UPDATE profiles SET is_suspended = true, suspicious_flag = true WHERE id = v_uid;
      RETURN json_build_object('error','不正な操作が検出されたためアカウントを停止しました');
    END IF;
    RETURN json_build_object('error','今週の修練回数の上限（5回）に達しています');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET scarecrow_charges = v_charges - 1, scarecrow_week_key = v_week
  WHERE id = v_uid;

  INSERT INTO scarecrow_sessions (player_id, duration_hours, started_at, ends_at)
  VALUES (v_uid, p_hours, now(), now() + (p_hours || ' hours')::interval)
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'ends_at', v_session.ends_at,
    'exp_reward', scarecrow_exp_for_hours(p_hours),
    'charges_left', v_charges - 1
  );
END;
$function$;

-- ============================================================
-- ⑤ 動作確認（実行後に流して確認する用）
-- ============================================================
-- 排他が両方向とも仕掛かっているか
-- SELECT tgname, tgrelid::regclass AS "テーブル"
--   FROM pg_trigger
--  WHERE tgname IN ('trg_scarecrow_not_fishing','trg_fishing_not_scarecrow');
--
-- 現在「釣り中かつ修練中」になってしまっている人がいないか（本来0件）
-- SELECT p.id, p.username
--   FROM profiles p
--  WHERE COALESCE(p.is_fishing,false) AND is_scarecrow_training(p.id);
