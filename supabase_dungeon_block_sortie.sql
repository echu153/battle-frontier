-- ============================================================
-- 2026-06-13
--  ① ペットダンジョン探索中は出撃不可（別端末での同時プレイ対策）。
--     apply_battle_result（通常出撃）/ casino_settle_sortie（簡易出撃）に
--     「active な dungeon_runs があれば拒否」のチェックを追加。
--  ② だっしゅつの翼(escape)も持ち物にカウントする（pet_is_inv_item を全アイテム対象に）。
--
-- ★ apply_battle_result / casino_settle_sortie は supabase_scarecrow.sql で定義済み。
--   このファイルは「先頭にダンジョンチェックを差し込んだ最新版」で上書きする。
--   今後 supabase_scarecrow.sql を再適用したら、このファイルも必ず再適用すること。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ===== 共通: active なダンジョン探索があるか =====
CREATE OR REPLACE FUNCTION public.has_active_dungeon(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM dungeon_runs WHERE owner_id = p_uid AND status = 'active');
$$;

-- ===== ② だっしゅつの翼も持ち物にカウント =====
CREATE OR REPLACE FUNCTION public.pet_is_inv_item(p_key text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT true;  -- 全アイテムを袋上限の対象に（escape も含む）
$$;

-- ============================================================
-- ① apply_battle_result（通常出撃）＝scarecrow版＋ダンジョン中ブロック
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

  -- ★ペットダンジョン探索中は出撃不可（別端末対策）
  IF has_active_dungeon(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','dungeon_active');
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

  -- かかし修練場チャージ
  v_sc_week := scarecrow_week_key_now();
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_sc_week THEN
    v_sc_charges := 0; v_sc_earned := 0;
  ELSE
    v_sc_charges := COALESCE(v_profile.scarecrow_charges, 0);
    v_sc_earned  := COALESCE(v_profile.scarecrow_earned_week, 0);
  END IF;
  v_sc_progress := COALESCE(v_profile.scarecrow_progress, 0);
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
-- ① casino_settle_sortie（簡易出撃）＝scarecrow版＋ダンジョン中ブロック
-- ============================================================
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

  -- ★かかし修練中／ペットダンジョン探索中は不可
  IF scarecrow_is_active(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','scarecrow_active');
  END IF;
  IF has_active_dungeon(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','dungeon_active');
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
