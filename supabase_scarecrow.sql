-- ============================================================
-- かかし修練場 2026-06-11
--   ・出撃100回（簡易出撃を除く＝apply_battle_result経由のみ）で1回分チャージ
--   ・チャージは週5回まで。毎週月曜朝5時(JST)にチャージ数リセット
--   ・3〜8時間を選んで開始。時間経過まで解除しなければEXP獲得
--     3h:200 / 4h:300 / 5h:450 / 6h:600 / 7h:850 / 8h:1000
--   ・途中解除するとEXPなし（サーバー側で時刻検証）
--   ・報酬はEXPのみ
--
-- 【不正対策】
--   ・チャージ/進捗(profiles.scarecrow_*)は保護トリガーで直接更新不可（GUC必須）
--   ・セッション(scarecrow_sessions)はRLSでSELECTのみ。作成/更新はRPC経由のみ
--   ・チャージ加算はサーバーRPC apply_battle_result 内でのみ実施
--   ・報酬EXPはサーバー側で時間検証(now() >= ends_at)・二重受取防止(status)
--
-- ★ 実行順: supabase_protect_stats.sql より【後】に実行すること。
--   このファイルは apply_battle_result を「protect_stats版＋かかしチャージ加算」で上書きする。
--   今後 protect_stats.sql を再適用した場合は、このファイルも必ず再適用する。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ===== 1) profiles 列追加 =====
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scarecrow_charges  int  NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scarecrow_progress int  NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scarecrow_week_key date;
-- 今週のチャージ獲得数（厳密な週5回獲得上限用。消費しても減らない）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scarecrow_earned_week int NOT NULL DEFAULT 0;

-- ===== 2) 保護トリガー（scarecrow_* 列はRPC経由のみ変更可） =====
CREATE OR REPLACE FUNCTION public.protect_scarecrow_cols()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_stat_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.scarecrow_charges  IS DISTINCT FROM OLD.scarecrow_charges
       OR NEW.scarecrow_progress IS DISTINCT FROM OLD.scarecrow_progress
       OR NEW.scarecrow_week_key IS DISTINCT FROM OLD.scarecrow_week_key
       OR NEW.scarecrow_earned_week IS DISTINCT FROM OLD.scarecrow_earned_week THEN
      RAISE EXCEPTION '不正な操作です（かかし修練場のデータはサーバ経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_scarecrow ON public.profiles;
CREATE TRIGGER trg_protect_scarecrow
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_scarecrow_cols();

-- ===== 3) セッションテーブル =====
CREATE TABLE IF NOT EXISTS scarecrow_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  duration_hours int NOT NULL CHECK (duration_hours BETWEEN 3 AND 8),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',  -- 'active' | 'claimed' | 'cancelled'
  exp_reward int,
  created_at timestamptz DEFAULT now()
);
-- 1人につきactiveは同時に1つだけ（部分ユニークインデックスで保証）
CREATE UNIQUE INDEX IF NOT EXISTS scarecrow_one_active_idx
  ON scarecrow_sessions(player_id) WHERE status = 'active';

ALTER TABLE scarecrow_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scarecrow_select_own" ON scarecrow_sessions;
CREATE POLICY "scarecrow_select_own" ON scarecrow_sessions FOR SELECT USING (auth.uid() = player_id);
-- INSERT/UPDATE/DELETE ポリシーは作らない＝RPC(SECURITY DEFINER)経由のみ

-- ===== 4) 共通: 週キー（直近の月曜朝5時JSTを起点とする日付） =====
CREATE OR REPLACE FUNCTION public.scarecrow_week_key_now()
 RETURNS date
 LANGUAGE sql STABLE
AS $$
  SELECT (date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours'))::date;
$$;

-- 時間→EXP報酬
CREATE OR REPLACE FUNCTION public.scarecrow_exp_for_hours(p_hours int)
 RETURNS int
 LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_hours
    WHEN 3 THEN 200 WHEN 4 THEN 300 WHEN 5 THEN 450
    WHEN 6 THEN 600 WHEN 7 THEN 850 WHEN 8 THEN 1000
    ELSE 0 END;
$$;

-- ===== 5) 状態取得（週リセットの正規化込み） =====
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
      'exp_reward', scarecrow_exp_for_hours(v_session.duration_hours),
      'finished', now() >= v_session.ends_at
    ) END
  );
END;
$function$;

-- ===== 6) 開始 =====
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
    -- 管理者はBANしないが上限自体は通知（テスト時はscarecrow_start_testを使用）
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

-- ===== 7) 解除（EXPなし） =====
CREATE OR REPLACE FUNCTION public.scarecrow_cancel()
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session scarecrow_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;
  SELECT * INTO v_session FROM scarecrow_sessions
  WHERE player_id = v_uid AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','修練中ではありません'); END IF;

  -- 時間経過後の「解除」は受け取り忘れ防止のため不可（claimへ誘導）
  IF now() >= v_session.ends_at THEN
    RETURN json_build_object('error','修練は完了しています。報酬を受け取ってください');
  END IF;

  UPDATE scarecrow_sessions SET status = 'cancelled' WHERE id = v_session.id;
  RETURN json_build_object('success', true, 'cancelled', true);
END;
$function$;

-- ===== 8) 報酬受け取り（時間検証つき・レベルアップ処理込み） =====
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
  v_exp := scarecrow_exp_for_hours(v_session.duration_hours);

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

-- ============================================================
-- 9) apply_battle_result 上書き（protect_stats版＋かかしチャージ加算）
--    変更点は末尾の「★かかし修練場チャージ」ブロックのみ
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_battle_result(p_area_id integer, p_is_boss boolean, p_is_papia boolean, p_papia_escaped boolean, p_win boolean, p_claimed_exp integer, p_claimed_gold integer, p_hp_current integer, p_mp_current integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_class_lv integer;
  v_cap integer;
  v_is_at_cap boolean;
  v_exp_frozen boolean;
  v_max_gold integer;
  v_max_exp integer;
  v_eff_exp integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_char_lv integer; v_new_pending integer;
  v_new_boss_rate numeric;
  v_new_unlocked integer[];
  v_level_ups integer := 0;
  v_boss_golds   integer[] := ARRAY[50, 250, 1000, 2500, 6000, 12500, 25000];
  v_normal_golds integer[] := ARRAY[8,   30,  100,  180,  300,   450,   700];
  v_sc_week date;
  v_sc_charges int;
  v_sc_progress int;
  v_sc_earned int;
  v_sc_charged boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★かかし修練中（時間経過前）は出撃不可
  IF EXISTS (SELECT 1 FROM scarecrow_sessions
             WHERE player_id = v_uid AND status = 'active' AND now() < ends_at) THEN
    RETURN json_build_object('ok',false,'reason','scarecrow_active');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- ★保護トリガー許可

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_boss_golds[p_area_id];
  ELSIF p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_normal_golds[p_area_id];
  ELSE v_max_gold := 700; END IF;
  v_max_gold := CEIL(v_max_gold * 1.5);

  IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
    UPDATE profiles SET suspicious_flag=true,
      exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
    WHERE id=v_uid;
    INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
    VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
    RETURN json_build_object('ok',false,'reason','invalid_gold');
  END IF;

  IF NOT v_exp_frozen AND NOT v_is_at_cap AND NOT p_papia_escaped THEN
    IF p_is_papia THEN v_max_exp := 200;
    ELSIF p_is_boss THEN v_max_exp := 13;
    ELSE v_max_exp := 11; END IF;

    IF p_claimed_exp < 0 OR p_claimed_exp > v_max_exp THEN
      UPDATE profiles SET suspicious_flag=true,
        exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
      WHERE id=v_uid;
      INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
      VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
      RETURN json_build_object('ok',false,'reason','invalid_exp');
    END IF;
  END IF;

  IF p_hp_current < 0 OR p_hp_current > v_profile.hp_max THEN
    RETURN json_build_object('ok',false,'reason','invalid_hp'); END IF;

  v_eff_exp      := CASE WHEN v_exp_frozen OR v_is_at_cap OR p_papia_escaped THEN 0 ELSE p_claimed_exp END;
  v_new_exp      := COALESCE(v_profile.exp, 0) + v_eff_exp;
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
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

  v_new_boss_rate := CASE WHEN p_is_boss THEN 0
    ELSE COALESCE(v_profile.boss_encounter_rate,0)+0.5 END;
  v_new_unlocked := COALESCE(v_profile.unlocked_areas, ARRAY[1]);
  IF p_win AND p_is_boss AND p_area_id < 7
    AND NOT (v_new_unlocked @> ARRAY[p_area_id+1]) THEN
    v_new_unlocked := array_append(v_new_unlocked, p_area_id+1);
  END IF;

  INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,level_ups)
  VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,v_eff_exp,p_claimed_gold,v_level_ups);

  -- ★かかし修練場チャージ: 出撃1回ごとに進捗+1。100回で1チャージ（週5回まで）
  --   ※ 簡易出撃(casino_settle_sortie)はこの関数を通らないため対象外
  v_sc_week := scarecrow_week_key_now();
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_sc_week THEN
    v_sc_charges := 0;  -- 月曜朝5時(JST)でチャージ・今週の獲得数をリセット
    v_sc_earned  := 0;
  ELSE
    v_sc_charges := COALESCE(v_profile.scarecrow_charges, 0);
    v_sc_earned  := COALESCE(v_profile.scarecrow_earned_week, 0);
  END IF;
  v_sc_progress := COALESCE(v_profile.scarecrow_progress, 0);
  -- 厳密な週5回獲得上限: 今週5回チャージ済みなら消費していてもそれ以上貯まらない
  IF v_sc_earned < 5 THEN
    v_sc_progress := v_sc_progress + 1;
    IF v_sc_progress >= 100 THEN
      v_sc_progress := v_sc_progress - 100;
      v_sc_charges := v_sc_charges + 1;
      v_sc_earned  := v_sc_earned + 1;
      v_sc_charged := true;
    END IF;
  END IF;

  UPDATE profiles SET
    exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
    gold=gold+p_claimed_gold,
    hp_current=p_hp_current, mp_current=p_mp_current,
    is_dying=(p_hp_current=0),
    boss_encounter_rate=v_new_boss_rate,
    unlocked_areas=v_new_unlocked,
    pending_stat_points=v_new_pending,
    char_lv=v_new_char_lv,
    last_action_at=now(),
    boss_kill_count=CASE WHEN p_win AND p_is_boss
      THEN COALESCE(boss_kill_count,0)+1 ELSE boss_kill_count END,
    scarecrow_charges=v_sc_charges,
    scarecrow_progress=v_sc_progress,
    scarecrow_earned_week=v_sc_earned,
    scarecrow_week_key=v_sc_week
  WHERE id=v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
    WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  RETURN json_build_object('ok',true,'level_ups',v_level_ups,'new_lv',v_new_lv,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges);
END;
$function$;

-- ============================================================
-- 10) テスト用: 1分修練（管理者限定・チャージ1消費・報酬は3時間分のEXP200）
-- ============================================================
CREATE OR REPLACE FUNCTION public.scarecrow_start_test()
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_week date := scarecrow_week_key_now();
  v_charges int;
  v_session scarecrow_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','キャラクターが見つかりません'); END IF;
  IF NOT COALESCE(v_profile.is_admin, false) THEN
    RETURN json_build_object('error','権限がありません');
  END IF;
  IF EXISTS (SELECT 1 FROM scarecrow_sessions WHERE player_id = v_uid AND status = 'active') THEN
    RETURN json_build_object('error','既に修練中です');
  END IF;
  v_charges := CASE WHEN v_profile.scarecrow_week_key IS DISTINCT FROM v_week
                    THEN 0 ELSE COALESCE(v_profile.scarecrow_charges, 0) END;
  IF v_charges <= 0 THEN RETURN json_build_object('error','修練回数がありません'); END IF;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET scarecrow_charges = v_charges - 1, scarecrow_week_key = v_week
  WHERE id = v_uid;

  INSERT INTO scarecrow_sessions (player_id, duration_hours, started_at, ends_at)
  VALUES (v_uid, 3, now(), now() + interval '1 minute')
  RETURNING * INTO v_session;

  RETURN json_build_object('success', true, 'ends_at', v_session.ends_at, 'exp_reward', 200, 'test', true);
END;
$function$;

-- ============================================================
-- 11) attack_raid_boss 上書き（かかし修練中もレイドボス出撃は可・ただし出撃報酬EXPなし）
--     supabase_raid_boss.sql の最新版＋かかしチェックのみ追加。
--     ※ 今後 supabase_raid_boss.sql を再適用したら、このセクションも再適用すること
-- ============================================================
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;
  v_expire_at   timestamptz;
  v_sc_active   boolean;
  v_exp_gain    int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  -- ★かかし修練中（時間経過前）は出撃自体は可能だが、出撃報酬のEXPは付与しない
  v_sc_active := EXISTS (SELECT 1 FROM scarecrow_sessions
                         WHERE player_id = v_player_id AND status = 'active' AND now() < ends_at);
  v_exp_gain := CASE WHEN v_sc_active THEN 0 ELSE 10 END;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;

  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

  IF v_profile.last_action_at IS NOT NULL THEN
    IF now() - v_profile.last_action_at < (v_cooldown || ' seconds')::interval THEN
      RETURN json_build_object(
        'error', 'cooldown',
        'seconds_left', v_cooldown - EXTRACT(EPOCH FROM (now() - v_profile.last_action_at))::int
      );
    END IF;
  END IF;

  v_damage := LEAST(p_damage, 1000000);
  v_damage := GREATEST(v_damage, 0);

  v_new_hp := GREATEST(0, v_boss.hp_current - v_damage);

  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_damage, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt   = raid_participants.damage_dealt + v_damage,
      attack_count   = raid_participants.attack_count + 1,
      last_attack_at = now();

  -- 共有CD更新 + 出撃報酬（HP/MP全回復・EXP+10。かかし修練中はEXP+0）
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET
    hp_current     = v_profile.hp_max,
    mp_current     = v_profile.mp_max,
    exp            = COALESCE(exp, 0) + v_exp_gain,
    last_action_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',     v_damage,
    'hp_current', v_new_hp,
    'hp_max',     v_boss.hp_max,
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gained', v_exp_gain,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;

-- ============================================================
-- 12) 修練中アクティビティのサーバー側ブロック
--     賭博場（全ゲーム=メダル変動をトリガーで遮断）・釣り開始・
--     ペットダンジョン開始・デイリーダンジョン報酬・簡易出撃精算
-- ============================================================

-- 共通ヘルパー: 修練中（時間経過前）か
CREATE OR REPLACE FUNCTION public.scarecrow_is_active(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scarecrow_sessions
    WHERE player_id = p_uid AND status = 'active' AND now() < ends_at
  );
$$;

-- 賭博場・釣り: profiles トリガーで遮断
--   ・メダル変動 = 全カジノゲーム（ハイロー/スロット/両替/景品）はRPC本体に触れず確実にブロック
--   ・is_fishing false→true = 釣り開始のブロック
CREATE OR REPLACE FUNCTION public.protect_scarecrow_activity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.medals IS DISTINCT FROM OLD.medals)
     OR (COALESCE(NEW.is_fishing, false) AND NOT COALESCE(OLD.is_fishing, false)) THEN
    IF scarecrow_is_active(NEW.id) THEN
      RAISE EXCEPTION 'かかし修練中は賭博場・釣りを利用できません';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_scarecrow_activity ON public.profiles;
CREATE TRIGGER trg_protect_scarecrow_activity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_scarecrow_activity();

-- ペットダンジョン開始（supabase_dungeon_rewards.sql の dungeon_start＋修練チェック。
-- ※ dungeon_rewards.sql を再適用したらこのセクションも再適用）
create or replace function dungeon_start(p_pet_id uuid, p_dungeon_id text default 'd10')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if scarecrow_is_active(auth.uid()) then
    raise exception 'かかし修練中はダンジョンに入れません';
  end if;
  if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then
    raise exception 'pet not found';
  end if;
  update dungeon_runs set status = 'abandoned'
    where owner_id = auth.uid() and status = 'active';
  insert into dungeon_runs(owner_id, pet_id, status, dungeon_id)
    values (auth.uid(), p_pet_id, 'active', coalesce(p_dungeon_id, 'd10'))
    returning id into v_id;
  return v_id;
end; $$;

-- デイリーダンジョン報酬（protect_stats版＋修練チェック。
-- ※ protect_stats.sql を再適用したらこのセクションも再適用）
CREATE OR REPLACE FUNCTION public.apply_dungeon_reward(p_type text, p_claimed_gold integer DEFAULT 0, p_claimed_exp integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_exp_frozen boolean;
  v_is_at_cap boolean;
  v_class_lv integer;
  v_cap integer;
  v_max_gold integer;
  v_char_lv integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_pending integer; v_new_char_lv integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★かかし修練中は不可
  IF scarecrow_is_active(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','scarecrow_active');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- ★保護トリガー許可

  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;

  IF p_type = 'gold' THEN
    v_char_lv := COALESCE(v_profile.char_lv, v_profile.lv);
    v_max_gold := CEIL(v_char_lv * 45 * (CASE WHEN v_char_lv <= 300 THEN 1.5 ELSE 1.0 END) * 1.5);
    IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
      UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
      RETURN json_build_object('ok',false,'reason','invalid_gold');
    END IF;
    UPDATE profiles SET gold=gold+p_claimed_gold, last_action_at=now() WHERE id=v_uid;

  ELSIF p_type = 'exp' THEN
    IF NOT v_exp_frozen AND NOT v_is_at_cap THEN
      IF p_claimed_exp < 0 OR p_claimed_exp > 100 THEN
        UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
        RETURN json_build_object('ok',false,'reason','invalid_exp');
      END IF;
    END IF;
    IF v_exp_frozen OR v_is_at_cap THEN
      RETURN json_build_object('ok',true,'frozen',true);
    END IF;

    v_new_exp := COALESCE(v_profile.exp,0) + p_claimed_exp;
    v_new_lv := v_profile.lv;
    v_new_exp_next := calc_exp_next(v_new_lv);
    v_new_pending := COALESCE(v_profile.pending_stat_points,0);
    v_new_char_lv := COALESCE(v_profile.char_lv,1);
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;

    UPDATE profiles SET
      exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
      pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
      last_action_at=now()
    WHERE id=v_uid;
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
      WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  IF p_type <> 'exp' AND p_claimed_exp <> 0 THEN
    IF p_claimed_exp < 0 OR p_claimed_exp > 15 THEN
      UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
      RETURN json_build_object('ok',false,'reason','invalid_bonus_exp');
    END IF;
    IF NOT v_exp_frozen AND NOT v_is_at_cap THEN
      v_new_exp := COALESCE(v_profile.exp,0) + p_claimed_exp;
      v_new_lv := v_profile.lv;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := COALESCE(v_profile.pending_stat_points,0);
      v_new_char_lv := COALESCE(v_profile.char_lv,1);
      WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
        v_new_exp := v_new_exp - v_new_exp_next;
        v_new_lv := v_new_lv + 1;
        v_new_exp_next := calc_exp_next(v_new_lv);
        v_new_pending := v_new_pending + 1;
        v_new_char_lv := v_new_char_lv + 1;
      END LOOP;
      IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;

      UPDATE profiles SET
        exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
        pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
        last_action_at=now()
      WHERE id=v_uid;
      UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
        WHERE player_id=v_uid AND class_name=v_profile.class;
    END IF;
  END IF;

  RETURN json_build_object('ok',true);
END;
$function$;

-- 簡易出撃の精算（protect_stats版＋修練チェック。
-- ※ protect_stats.sql を再適用したらこのセクションも再適用）
CREATE OR REPLACE FUNCTION public.casino_settle_sortie(p_count integer, p_claimed_exp integer, p_claimed_gold integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_class_lv integer;
  v_cap integer;
  v_is_at_cap boolean;
  v_exp_frozen boolean;
  v_new_exp int; v_new_lv int; v_new_exp_next int;
  v_new_pending int; v_new_char_lv int;
  v_old_lv int;
  v_learned text[];
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★かかし修練中は不可
  IF scarecrow_is_active(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','scarecrow_active');
  END IF;

  IF p_count IS NULL OR p_count <= 0 OR p_count > 1000 THEN
    RETURN json_build_object('ok',false,'reason','invalid_count'); END IF;
  IF p_claimed_exp < 0 OR p_claimed_exp > p_count * 11 THEN
    UPDATE profiles SET suspicious_flag = true WHERE id = v_uid;
    RETURN json_build_object('ok',false,'reason','invalid_exp'); END IF;
  IF p_claimed_gold < 0 OR p_claimed_gold > p_count * 1000 THEN
    UPDATE profiles SET suspicious_flag = true WHERE id = v_uid;
    RETURN json_build_object('ok',false,'reason','invalid_gold'); END IF;

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int,0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen,false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  v_old_lv       := v_profile.lv;
  v_new_exp      := COALESCE(v_profile.exp,0) + (CASE WHEN v_exp_frozen OR v_is_at_cap THEN 0 ELSE p_claimed_exp END);
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points,0);
  v_new_char_lv  := COALESCE(v_profile.char_lv,1);

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    exp = v_new_exp, exp_next = v_new_exp_next, lv = v_new_lv,
    char_lv = v_new_char_lv, pending_stat_points = v_new_pending,
    gold = gold + p_claimed_gold,
    last_action_at = now()
  WHERE id = v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv = v_new_lv, exp = v_new_exp
      WHERE player_id = v_uid AND class_name = v_profile.class;
  END IF;

  -- レベルアップで習得するスキルを一括付与（未習得のみ）
  IF v_new_lv > v_old_lv THEN
    WITH ins AS (
      INSERT INTO player_skills(player_id, skill_id)
      SELECT v_uid, s.id FROM skills s
      WHERE s.class_name = v_profile.class
        AND s.required_lv > v_old_lv AND s.required_lv <= v_new_lv
        AND NOT EXISTS (
          SELECT 1 FROM player_skills ps WHERE ps.player_id = v_uid AND ps.skill_id = s.id)
      RETURNING skill_id
    )
    SELECT array_agg(s.name) INTO v_learned
      FROM ins JOIN skills s ON s.id = ins.skill_id;
  END IF;

  RETURN json_build_object('ok',true,'lv',v_new_lv,'exp',v_new_exp,
    'pending_stat_points',v_new_pending,'char_lv',v_new_char_lv,
    'learned', COALESCE(v_learned, ARRAY[]::text[]));
END;
$function$;

-- ============================================================
-- 13) 開発アカウント(おれおれお)をテスト状態に（手動・このまま実行可）
--     チャージ0・進捗99/100（次の出撃1回でチャージ完了通知をテスト可能）
-- ============================================================
BEGIN;
SET LOCAL "app.allow_stat_change" = 'on';
UPDATE profiles SET scarecrow_charges = 0, scarecrow_progress = 99, scarecrow_earned_week = 0,
                    scarecrow_week_key = scarecrow_week_key_now()
WHERE username = 'おれおれお';
COMMIT;
