-- ============================================================
-- 自動遠征 / 放置キャンプ（Idle Camp）  Phase1  ※is_admin限定で先行
--   ・「タスクバーヒーロー」的な放置・自動進行の土台。
--   ・開始すると、画面を閉じていても経過時間に応じて EXP/Gold が溜まる。
--   ・報酬は全てサーバー(now())基準で計算＝クライアント改ざん不可。
--     開始時刻 started_at は idle_camp テーブルに保持し、書込はRPCのみ(RLSは読取専用)。
--   ・受け取り(idle_claim)で「開始〜現在(上限あり)」を清算し、起点を now() に巻き直す。
--
-- ★適用順: protect_stats.sql / alchemy.sql の【後】に実行（calc_exp_next と
--   protect_profile_stats トリガーに依存。本ファイルはそれらを上書きしない）。
-- Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- ===== 調整パラメータ（ここを変えればバランス調整可能） =====
--   ・上限: 480分(8時間)ぶんまで溜まる（超過分は切り捨て）
--   ・レート: 到達済み最高エリア(area_max,1〜7)に比例
--       EXP /分 = 3 * area_max   （例 エリア1=3/分=180/時, エリア7=21/分=1260/時）
--       Gold/分 = 5 * area_max   （例 エリア1=5/分=300/時, エリア7=35/分=2100/時）
--   ※ 通常出撃より控えめ。本公開前に実数を見て微調整する想定。

-- ===== 1) 状態テーブル（書込はRPCのみ・読取は本人のみ） =====
CREATE TABLE IF NOT EXISTS idle_camp (
  player_id   uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  timestamptz,           -- 放置の起点。NULL=停止中
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE idle_camp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idle_camp_select ON idle_camp;
CREATE POLICY idle_camp_select ON idle_camp FOR SELECT USING (player_id = auth.uid());
-- INSERT/UPDATE/DELETE ポリシーは作らない＝通常クライアントは書込不可（SECURITY DEFINER RPC のみ）。

-- ===== 2) 共通ヘルパ：放置レート（/分）と上限 =====
-- 到達済み最高エリア(1〜7)に比例。戻り値は (exp_pm, gold_pm, cap_min)。
CREATE OR REPLACE FUNCTION public.idle_rates(p_uid uuid)
 RETURNS TABLE(exp_pm int, gold_pm int, cap_min int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_areas int[];
  v_area_max int;
BEGIN
  SELECT COALESCE(unlocked_areas, ARRAY[1]) INTO v_areas FROM profiles WHERE id = p_uid;
  SELECT COALESCE(MAX(a), 1) INTO v_area_max FROM unnest(COALESCE(v_areas, ARRAY[1])) AS a;
  v_area_max := GREATEST(1, LEAST(v_area_max, 7));
  exp_pm  := 3 * v_area_max;
  gold_pm := 5 * v_area_max;
  cap_min := 480;  -- 8時間ぶんまで蓄積
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_rates(uuid) TO authenticated;

-- ===== 3) 状態取得（受け取らずに「今いくら溜まっているか」を返す＝表示用） =====
CREATE OR REPLACE FUNCTION public.idle_get()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_started timestamptz;
  v_rate record;
  v_elapsed_min int := 0;
  v_capped_min int := 0;
  v_class_lv int;
  v_cap int;
  v_at_cap boolean;
  v_frozen boolean;
  v_pending_exp int := 0;
  v_pending_gold int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT COALESCE(v_profile.is_admin, false) THEN
    RETURN json_build_object('ok',false,'reason','not_admin');
  END IF;

  SELECT started_at INTO v_started FROM idle_camp WHERE player_id = v_uid;
  SELECT * INTO v_rate FROM idle_rates(v_uid);

  -- レベル上限／EXP凍結の判定（溜まり表示にも反映）
  SELECT lv INTO v_class_lv FROM class_levels WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5 THEN 300 ELSE 100 END;
  v_at_cap := v_class_lv >= v_cap;
  v_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF v_started IS NOT NULL THEN
    v_elapsed_min := FLOOR(EXTRACT(EPOCH FROM (now() - v_started)) / 60)::int;
    v_capped_min  := LEAST(GREATEST(v_elapsed_min, 0), v_rate.cap_min);
    v_pending_gold := v_capped_min * v_rate.gold_pm;
    IF NOT v_at_cap AND NOT v_frozen THEN
      v_pending_exp := v_capped_min * v_rate.exp_pm;
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'running', (v_started IS NOT NULL),
    'started_at', v_started,
    'cap_min', v_rate.cap_min,
    'exp_pm', v_rate.exp_pm,
    'gold_pm', v_rate.gold_pm,
    'elapsed_min', v_elapsed_min,
    'capped_min', v_capped_min,
    'is_full', (v_started IS NOT NULL AND v_elapsed_min >= v_rate.cap_min),
    'pending_exp', v_pending_exp,
    'pending_gold', v_pending_gold,
    'at_cap', v_at_cap,
    'exp_frozen', v_frozen,
    'server_now', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_get() TO authenticated;

-- ===== 4) 開始（起点を now() に。受け取り前の再開始は溜まりを失わないよう拒否） =====
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
    RETURN json_build_object('ok',false,'reason','already_running');  -- 受け取り前に再開始させない
  END IF;

  INSERT INTO idle_camp(player_id, started_at, updated_at) VALUES (v_uid, now(), now())
  ON CONFLICT (player_id) DO UPDATE SET started_at = now(), updated_at = now();
  RETURN json_build_object('ok',true,'started_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_start() TO authenticated;

-- ===== 5) 受け取り（経過ぶんを清算してEXP/Goldを付与・起点を now() に巻き直す） =====
CREATE OR REPLACE FUNCTION public.idle_claim()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_started timestamptz;
  v_rate record;
  v_elapsed_min int;
  v_capped_min int;
  v_class_lv int;
  v_cap int;
  v_at_cap boolean;
  v_frozen boolean;
  v_gain_exp int := 0;
  v_gain_gold int := 0;
  v_new_exp int; v_new_lv int; v_new_exp_next int;
  v_new_pending int; v_new_char_lv int;
  v_level_ups int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF NOT COALESCE(v_profile.is_admin, false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  -- ★行ロックして起点を取得 → 直後に now() へ巻き直す。
  --   FOR UPDATE で同時実行の二重受け取りをブロック（後続クエリは起点=now()を読むので獲得0）。
  SELECT started_at INTO v_started FROM idle_camp WHERE player_id = v_uid FOR UPDATE;
  IF v_started IS NULL THEN
    RETURN json_build_object('ok',false,'reason','not_running');
  END IF;

  SELECT * INTO v_rate FROM idle_rates(v_uid);
  v_elapsed_min := FLOOR(EXTRACT(EPOCH FROM (now() - v_started)) / 60)::int;
  v_capped_min  := LEAST(GREATEST(v_elapsed_min, 0), v_rate.cap_min);

  IF v_capped_min < 1 THEN
    RETURN json_build_object('ok',false,'reason','too_soon','elapsed_min',v_elapsed_min);
  END IF;

  -- レベル上限／EXP凍結
  SELECT lv INTO v_class_lv FROM class_levels WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5 THEN 300 ELSE 100 END;
  v_at_cap := v_class_lv >= v_cap;
  v_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  v_gain_gold := v_capped_min * v_rate.gold_pm;
  v_gain_exp  := CASE WHEN v_at_cap OR v_frozen THEN 0 ELSE v_capped_min * v_rate.exp_pm END;

  -- レベルアップ計算（apply_battle_result と同じロジックを踏襲）
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

  -- ★保護トリガー許可 → 保護列(exp/lv/char_lv/pending)とgoldを更新
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

  -- 起点を now() に巻き直して継続稼働
  UPDATE idle_camp SET started_at = now(), updated_at = now() WHERE player_id = v_uid;

  RETURN json_build_object(
    'ok', true,
    'gained_exp', v_gain_exp,
    'gained_gold', v_gain_gold,
    'claimed_min', v_capped_min,
    'level_ups', v_level_ups,
    'new_lv', v_new_lv
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.idle_claim() TO authenticated;
