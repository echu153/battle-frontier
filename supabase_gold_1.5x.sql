-- ============================================================
-- ゴールド1.5倍（出撃 / デイリーダンジョン）
--  - apply_battle_result: 出撃ゴールド上限を1.5倍（超過時の不正判定を防ぐため必須）
--  - apply_dungeon_reward: デイリーダンジョンのゴールド上限を1.5倍
--    （※ 前回のおまけ経験値ブロックも含む完全版。supabase_dungeon_bonus_exp.sql を置き換え）
--  - ⚠ クライアント(×1.5)より先に本SQLを適用すること。
--    先にデプロイすると正規ゴールドが上限超過で suspicious_flag + 12hEXP凍結される。
-- ============================================================

-- ===== 出撃（通常戦闘）=====
CREATE OR REPLACE FUNCTION public.apply_battle_result(p_area_id integer, p_is_boss boolean, p_is_papia boolean, p_papia_escaped boolean, p_win boolean, p_claimed_exp integer, p_claimed_gold integer, p_hp_current integer, p_mp_current integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_class_lv integer;
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
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_is_at_cap := v_class_lv >= 100;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  -- Gold検証
  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_boss_golds[p_area_id];
  ELSIF p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_normal_golds[p_area_id];
  ELSE v_max_gold := 700; END IF;
  v_max_gold := CEIL(v_max_gold * 1.5);  -- ★出撃ゴールド1.5倍

  IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
    UPDATE profiles SET suspicious_flag=true,
      exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
    WHERE id=v_uid;
    INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
    VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
    RETURN json_build_object('ok',false,'reason','invalid_gold');
  END IF;

  -- EXP検証（凍結中・キャップ済み・パピア逃走はスキップ）
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
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < 100 LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
      v_level_ups := v_level_ups + 1;
    END LOOP;
    IF v_new_lv >= 100 THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(100); END IF;
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
      THEN COALESCE(boss_kill_count,0)+1 ELSE boss_kill_count END
  WHERE id=v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
    WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  RETURN json_build_object('ok',true,'level_ups',v_level_ups,'new_lv',v_new_lv);
END;
$function$;


-- ===== デイリーダンジョン =====
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
    -- Goldの上限 = char_lv * 45 * 育成bonus * 1.5(ゴールド1.5倍)
    v_char_lv := COALESCE(v_profile.char_lv, v_profile.lv);
    v_max_gold := CEIL(v_char_lv * 45 * (CASE WHEN v_char_lv <= 300 THEN 1.5 ELSE 1.0 END) * 1.5);  -- ★ゴールド1.5倍
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

  -- EXP以外（gold/stone/prof/gem）へのおまけ経験値（8〜11想定・上限15でクランプ）
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

  RETURN json_build_object('ok',true);
END;
$function$;
