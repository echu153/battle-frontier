-- ============================================================
-- apply_dungeon_reward を最新版へ（経験値ダンジョンのLV100未満1.5倍に対応）
--   ・exp上限を char_lv<100 で 100→150 に（クライアントの1.5倍と一致＝誤検知防止）
--   ・他のロジックは現行のまま（gold上限/ボーナスEXP上限15/レベルアップ処理）
--   これ1ファイルで本番の apply_dungeon_reward を確実に上書きできる
--   （protect_stats / scarecrow のどちらが本番でもOK）。
--   ※protect_stats系のため app.allow_stat_change を立ててから保護列を更新している。
--   ※他のSQL(scarecrow等)を後から流すと巻き戻るため、流す場合はこのファイルを最後に。
-- ============================================================
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
      -- キャラLV100未満は経験値1.5倍（クライアントと一致）。上限も1.5倍(150)にして誤検知を防ぐ
      IF p_claimed_exp < 0 OR p_claimed_exp > (CASE WHEN COALESCE(v_profile.char_lv, v_profile.lv) < 100 THEN 150 ELSE 100 END) THEN
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

  -- ゴールドダンジョン等の「ついでEXP」(8〜11想定)。上限15は据え置き（1.5倍対象外）
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

GRANT EXECUTE ON FUNCTION public.apply_dungeon_reward(text, integer, integer) TO authenticated;
