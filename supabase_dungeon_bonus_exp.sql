-- ============================================================
-- ⚠️【廃止・実行しないこと】 2026-06-09
--   この apply_dungeon_reward は supabase_protect_stats.sql の版に完全に内包された
--   （ボーナスEXPロジック同一＋保護トリガー対応の set_config 入り）。
--   protect_stats.sql 適用後にこのファイルを流すと、apply_dungeon_reward が
--   非GUC版へ巻き戻り、保護トリガーでダンジョン報酬(EXP/Gold)が弾かれて壊れる。
--   → 実行不要。履歴として残すのみ。[[protect-stats-apply-note]]
-- ============================================================
-- デイリーダンジョン：EXP以外（gold/stone/prof/gem）にもおまけ経験値を付与
--  - 既存の apply_dungeon_reward を拡張（gold/exp の挙動は変更なし）
--  - 非EXPタイプで p_claimed_exp(8〜11想定) を受け取り、上限15でクランプして付与
--  - レベルアップ処理は経験値ダンジョンと同一。EXP凍結・レベルキャップ(100)を尊重
--  - ※ クライアント([Game.jsx] doDungeon) から渡す。日次回数はクライアント側で管理
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
  v_max_gold integer;
  v_char_lv integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_pending integer; v_new_char_lv integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_is_at_cap := v_class_lv >= 100;

  IF p_type = 'gold' THEN
    -- Goldの上限 = char_lv * 30 * 1.5(乱数max)。char_lv<=300は育成ボーナス×1.5
    v_char_lv := COALESCE(v_profile.char_lv, v_profile.lv);
    v_max_gold := CEIL(v_char_lv * 45 * (CASE WHEN v_char_lv <= 300 THEN 1.5 ELSE 1.0 END));
    IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
      UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
      RETURN json_build_object('ok',false,'reason','invalid_gold');
    END IF;
    UPDATE profiles SET gold=gold+p_claimed_gold, last_action_at=now() WHERE id=v_uid;

  ELSIF p_type = 'exp' THEN
    -- EXPは50〜100の範囲
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
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < 100 LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
    END LOOP;
    IF v_new_lv >= 100 THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(100); END IF;

    UPDATE profiles SET
      exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
      pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
      last_action_at=now()
    WHERE id=v_uid;
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
      WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  -- ▼▼ 追加：EXP以外（gold/stone/prof/gem）へのおまけ経験値（8〜11想定・上限15でクランプ）
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
      WHILE v_new_exp >= v_new_exp_next AND v_new_lv < 100 LOOP
        v_new_exp := v_new_exp - v_new_exp_next;
        v_new_lv := v_new_lv + 1;
        v_new_exp_next := calc_exp_next(v_new_lv);
        v_new_pending := v_new_pending + 1;
        v_new_char_lv := v_new_char_lv + 1;
      END LOOP;
      IF v_new_lv >= 100 THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(100); END IF;

      UPDATE profiles SET
        exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
        pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
        last_action_at=now()
      WHERE id=v_uid;
      UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
        WHERE player_id=v_uid AND class_name=v_profile.class;
    END IF;
  END IF;
  -- ▲▲ 追加ここまで

  RETURN json_build_object('ok',true);
END;
$function$;
