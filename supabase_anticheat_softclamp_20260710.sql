-- ============================================================
-- 2026-07-10 【誤検知(invalid_gold/invalid_exp)の撲滅】apply_battle_result 改善版
--
--  背景: 変異Gold実装(7/03-04)以降、正規プレイヤーが上限のわずかなズレで
--        「12hEXP凍結」まで受ける誤検知が多発(7/04に全体事故・7/09にも単発)。
--        原因は上限が「理論値ピッタリ」で、サーバーとクライアントのモデル差
--        (mutant_cleared_areas未登録 / p_mutant_boss欠落 等)を吸収できないこと。
--
--  改善(3段構え・凍結を極力避ける):
--   ① 変異上限を eligible(char_lv500以上・エリア①〜④) なら常に許容:
--      ・ボス勝利  → 上限9000 (p_mutant_boss や登録状態に依存しない)
--      ・雑魚勝利  → 上限600  (mutant_cleared_areas 未登録でも許容)
--      ※これで7/04スパイク・7/09単発の“正体=誤検知”が原理的に発生しなくなる。
--      ※「🧬エリア○の変異を攻略」記録(mutant_first_clear)は従来どおり
--        p_mutant_boss=true のときだけ＝トグルの意味は維持。
--   ② 上限超過でも即凍結しない。悪質レベル未満なら「上限にクランプして付与」:
--      Gold:  [0, v_max_gold]           = 請求どおり
--             (v_max_gold, v_hard_gold] = v_max_gold にクランプ(無罰・凍結なし)
--             v_hard_gold(=max(上限×3, 100000)) 超 = チート → suspicious+12h凍結+棄却
--      EXP:   同様に v_hard_exp(=max(上限×3, 100)) 超のみ凍結。それ未満はクランプ。
--      負数はクライアントバグ扱いで0にクランプ(凍結しない)。
--   ③ クランプが起きたら戻り値に gold_clamped / exp_clamped=true を返す(監視・調整用)。
--   ④ 開発アカウント(is_admin)は検知対象外(自動出撃[開発]等の検証用)。
--      フラグ/凍結/棄却を一切せず、値のみ上限にクランプ。is_adminは自己昇格防止済み=悪用不可。
--
--  ★★ これが apply_battle_result の【最新の正】。protect_stats/scarecrow 等を
--     再適用したら supabase_mutant_toggle_fix_20260707.sql ではなく「このファイル」を
--     最後に流すこと。旧9引数版も念のためDROPする。
--  ※ シグネチャ(10引数)は7/07版と同一なので CREATE OR REPLACE で置換される。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mutant_cleared_areas integer[] DEFAULT '{}'::integer[];

-- 旧9引数版を削除（新版と共存させると PostgREST が曖昧になるため）
DROP FUNCTION IF EXISTS public.apply_battle_result(integer, boolean, boolean, boolean, boolean, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.apply_battle_result(p_area_id integer, p_is_boss boolean, p_is_papia boolean, p_papia_escaped boolean, p_win boolean, p_claimed_exp integer, p_claimed_gold integer, p_hp_current integer, p_mp_current integer, p_mutant_boss boolean DEFAULT false)
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
  v_hard_gold integer;
  v_gold_grant integer;
  v_gold_clamped boolean := false;
  v_max_exp integer;
  v_hard_exp integer;
  v_eff_claimed_exp integer;
  v_exp_clamped boolean := false;
  v_eff_exp integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_char_lv integer; v_new_pending integer;
  v_new_boss_rate numeric;
  v_new_unlocked integer[];
  v_level_ups integer := 0;
  v_boss_golds   integer[] := ARRAY[50, 250, 1000, 2500, 6000, 12500, 25000];
  v_normal_golds integer[] := ARRAY[30,  60,  120,  200,  400,   600,   800];  -- ★出撃ゴールド再配分(2026-07-03)
  v_is_admin boolean := false;
  v_mutant_eligible boolean := false;
  v_mutant_first_clear boolean := false;
  v_alch_unlocked boolean := false;
  v_crys_drop int := 0;
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

  -- ★開発アカウント(is_admin)は不正検知の対象外。自動出撃[開発]等の検証で
  --   フラグ/凍結/棄却されないよう、以降の検知を全てスキップする(値は上限にクランプするのみ)。
  --   ※is_adminは自己昇格防止(protect_is_admin)済みのため悪用リスクなし。
  v_is_admin := COALESCE(v_profile.is_admin, false);

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

  -- ★【変異】上限(char_lv500以上・エリア①〜④)。誤検知防止のため eligible なら常に許容する。
  --   ・ボス勝利 = 9000 (p_mutant_boss や登録状態に依存させない。7/09の4500誤検知対策)
  --   ・雑魚勝利 = 600  (mutant_cleared_areas 未登録でも許容。7/04スパイク対策)
  --   ※トグルの意味は mutant_first_clear(下部)側で維持=「🧬攻略」記録は p_mutant_boss=true のみ。
  v_mutant_eligible := p_area_id BETWEEN 1 AND 4 AND COALESCE(v_profile.char_lv, 1) >= 500;
  IF p_win AND v_mutant_eligible THEN
    IF p_is_boss THEN
      v_max_gold := GREATEST(v_max_gold, 9000);
    ELSE
      v_max_gold := GREATEST(v_max_gold, 600);
    END IF;
  END IF;

  -- ★Gold検証(3段): 正規=そのまま / モデルズレ=上限にクランプ(無罰) / 悪質=凍結+棄却
  v_hard_gold := GREATEST(v_max_gold * 3, 100000);
  IF NOT v_is_admin AND p_claimed_gold > v_hard_gold THEN
    UPDATE profiles SET suspicious_flag=true,
      exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
    WHERE id=v_uid;
    INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
    VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
    RETURN json_build_object('ok',false,'reason','invalid_gold');
  END IF;
  v_gold_grant   := LEAST(GREATEST(p_claimed_gold, 0), v_max_gold);
  v_gold_clamped := (p_claimed_gold <> v_gold_grant);

  -- ★EXP検証(3段): 同様に悪質(上限×3 かつ100超)だけ凍結。それ未満は上限にクランプ。
  v_eff_claimed_exp := GREATEST(p_claimed_exp, 0);
  IF NOT v_exp_frozen AND NOT v_is_at_cap AND NOT p_papia_escaped THEN
    IF p_is_papia THEN v_max_exp := 200;
    ELSIF p_is_boss THEN v_max_exp := 13;
    ELSE v_max_exp := 11; END IF;
    IF COALESCE(v_profile.char_lv, 1) < 100 THEN v_max_exp := CEIL(v_max_exp * 1.5); END IF;

    v_hard_exp := GREATEST(v_max_exp * 3, 100);
    IF NOT v_is_admin AND p_claimed_exp > v_hard_exp THEN
      UPDATE profiles SET suspicious_flag=true,
        exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
      WHERE id=v_uid;
      INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
      VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
      RETURN json_build_object('ok',false,'reason','invalid_exp');
    END IF;
    v_eff_claimed_exp := LEAST(v_eff_claimed_exp, v_max_exp);
    v_exp_clamped := (GREATEST(p_claimed_exp,0) <> v_eff_claimed_exp);
  END IF;

  -- HP上限検証: クライアントが戦闘直前にキャッシュした実効最大HP(eff_hp_max)を上限として信頼する。
  --   ★再修練でクラスLVが1に戻るとベースhp_max(profiles.hp_max)が激減するが、装備/博物館/釣り/称号/ペットの
  --     HP加算は据え置きのため、実効HPがベースの5倍を超えうる。旧式の `hp_max*5` 天井で正当な戦果を invalid_hp で
  --     弾いていた不具合を修正(2026-07-09)。eff_hp_max未キャッシュ時のみ hp_max*5 にフォールバック。
  IF p_hp_current < 0 OR p_hp_current >
       GREATEST(COALESCE(v_profile.eff_hp_max, v_profile.hp_max * 5), v_profile.hp_max) THEN
    RETURN json_build_object('ok',false,'reason','invalid_hp'); END IF;

  -- ★【変異】ボス初撃破: 実際に変異ボス(p_mutant_boss=true)を倒したときのみ記録(トグル尊重)
  v_mutant_first_clear := p_win AND p_is_boss AND p_mutant_boss AND v_mutant_eligible
    AND NOT (COALESCE(v_profile.mutant_cleared_areas, '{}'::integer[]) @> ARRAY[p_area_id]);

  v_eff_exp      := CASE WHEN v_exp_frozen OR v_is_at_cap OR p_papia_escaped THEN 0 ELSE v_eff_claimed_exp END;
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

  -- ★錬金ドロップ抽選（解放済み＝エリア③ボス撃破済のみ。サーバー側乱数＝改ざん不可）
  v_alch_unlocked := v_new_unlocked @> ARRAY[4];
  IF v_alch_unlocked AND p_win AND random() < 0.01 THEN v_crys_drop := 1; END IF; -- 勝利で時の結晶

  INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,level_ups)
  VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,v_eff_exp,v_gold_grant,v_level_ups);

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
    gold=gold+v_gold_grant,
    hp_current=p_hp_current, mp_current=p_mp_current,
    is_dying=(p_hp_current=0),
    boss_encounter_rate=v_new_boss_rate,
    unlocked_areas=v_new_unlocked,
    pending_stat_points=v_new_pending,
    char_lv=v_new_char_lv,
    mutant_cleared_areas=CASE WHEN v_mutant_first_clear
      THEN array_append(COALESCE(mutant_cleared_areas, '{}'::integer[]), p_area_id)
      ELSE mutant_cleared_areas END,
    time_crystal=COALESCE(time_crystal,0)+v_crys_drop,  -- ★錬金
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
    'gold_clamped',v_gold_clamped,'exp_clamped',v_exp_clamped,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges,
    'crystal_drop',v_crys_drop);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_battle_result(integer, boolean, boolean, boolean, boolean, integer, integer, integer, integer, boolean) TO authenticated;
