-- ============================================================
-- 2026-07-03 【変異】ボスのGold反映＋撃破記録の一般公開対応
--
--  背景:
--   ・char_lv500以上はエリア①〜④のボスが【変異】ボス(Gold 9000)に置き換わるが、
--     サーバーのGold上限が通常ボス基準(100/500/2000/5000)のため invalid_gold で全没収されていた。
--   ・撃破済みエリアの雑魚は⑤相当Gold(最大600)を請求するが、これも上限超えで没収。
--   ・さらに撃破フラグ mutant_cleared_areas はどこからも書き込まれておらず(読取のみ)、
--     一般プレイヤーには機能していなかった。
--
--  このSQLで:
--   ① profiles.mutant_cleared_areas 列を追加(integer[]・既存なら何もしない)
--   ② apply_battle_result を上書き:
--      ・出撃ゴールド再配分(2026-07-03): v_normal_golds = [30,60,120,200,400,600,800]
--      ・char_lv500以上・①〜④のボス勝利: Gold上限を9000に引き上げ＋mutant_cleared_areas へ自動記録
--      ・撃破済みエリアの雑魚: Gold上限を600に引き上げ
--      ・初回記録時は戻り値 mutant_first_clear=true (クライアントが攻略ログ表示 b7bb568)
--
--  ★適用順: protect_stats / scarecrow / dungeon_block_sortie / exp_1.5x より「後」。
--    以後 apply_battle_result を再定義するSQLを流したら、このファイルも必ず再適用すること。
--  ※トグルOFF(通常ボス)で勝った場合も記録される(サーバーはトグル状態を検証できないため)。
--    Lv500プレイヤーにとって①〜④ボスの難度差は実質無く、利便性を優先。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mutant_cleared_areas integer[] DEFAULT '{}'::integer[];

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
  v_normal_golds integer[] := ARRAY[30,  60,  120,  200,  400,   600,   800];  -- ★出撃ゴールド再配分(2026-07-03)
  v_mutant_eligible boolean := false;
  v_mutant_first_clear boolean := false;
  v_sc_week date;
  v_sc_charges int;
  v_sc_progress int;
  v_sc_earned int;
  v_sc_charged boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  IF has_active_dungeon(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','dungeon_active');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);

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
  ELSE v_max_gold := 800; END IF;
  v_max_gold := CEIL(v_max_gold * (CASE WHEN p_area_id BETWEEN 1 AND 4 THEN 2.0 ELSE 1.5 END));

  -- ★【変異】対応(char_lv500以上・エリア①〜④)。クライアントの請求と一致させる:
  --   ・変異ボス撃破        = floor(6000*1.5)          = 9000
  --   ・撃破済みエリアの雑魚 = floor(エリア⑤敵gold最大400*1.5) = 600
  v_mutant_eligible := p_area_id BETWEEN 1 AND 4 AND COALESCE(v_profile.char_lv, 1) >= 500;
  IF p_win AND v_mutant_eligible THEN
    IF p_is_boss THEN
      v_max_gold := GREATEST(v_max_gold, 9000);
    ELSIF COALESCE(v_profile.mutant_cleared_areas, '{}'::integer[]) @> ARRAY[p_area_id] THEN
      v_max_gold := GREATEST(v_max_gold, 600);
    END IF;
  END IF;

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
    IF COALESCE(v_profile.char_lv, 1) < 100 THEN v_max_exp := CEIL(v_max_exp * 1.5); END IF;

    IF p_claimed_exp < 0 OR p_claimed_exp > v_max_exp THEN
      UPDATE profiles SET suspicious_flag=true,
        exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
      WHERE id=v_uid;
      INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
      VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
      RETURN json_build_object('ok',false,'reason','invalid_exp');
    END IF;
  END IF;

  IF p_hp_current < 0 OR p_hp_current >
       LEAST(GREATEST(COALESCE(v_profile.eff_hp_max, v_profile.hp_max), v_profile.hp_max), v_profile.hp_max * 5) THEN
    RETURN json_build_object('ok',false,'reason','invalid_hp'); END IF;

  -- ★【変異】ボス初撃破: mutant_cleared_areas に記録(全プレイヤー対象)
  v_mutant_first_clear := p_win AND p_is_boss AND v_mutant_eligible
    AND NOT (COALESCE(v_profile.mutant_cleared_areas, '{}'::integer[]) @> ARRAY[p_area_id]);

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
    IF v_sc_progress >= 50 THEN
      v_sc_progress := v_sc_progress - 50;
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
    mutant_cleared_areas=CASE WHEN v_mutant_first_clear
      THEN array_append(COALESCE(mutant_cleared_areas, '{}'::integer[]), p_area_id)
      ELSE mutant_cleared_areas END,
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
    'mutant_first_clear',v_mutant_first_clear,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges);
END;
$function$;
