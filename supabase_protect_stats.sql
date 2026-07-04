-- ⚠⚠【2026-07-04 注意】このファイルの apply_battle_result は旧Gold上限(v_normal_golds=[8,30,100,180,300,450,700])。
-- ⚠⚠ 再適用したら必ず「最後に」supabase_mutant_gold_20260703.sql を流し直すこと。
-- ⚠⚠ 流さないと現行クライアント(263772e以降)の出撃が全プレイヤー invalid_gold 誤検知→EXP12時間凍結になる。
-- ============================================================
-- ステータス改変対策（最重要スコープ）
--   profiles / class_levels の「強さの真の入力」列を列保護トリガーで守り、
--   正規の更新は SECURITY DEFINER の RPC 経由（GUC を立てた場合）のみ許可する。
--   既存のメダル保護（protect_medals + app.allow_medals）と同一方式。
--
--   保護列:
--     profiles: stat_point_spent, pending_stat_points, lv, char_lv, exp, retraining
--     class_levels: lv, exp
--   ※ 派生ステ列(hp_max/atk/...) と exp_next は保護しない（クライアント再計算キャッシュ）。
--
--   GUC: app.allow_stat_change = 'on' のとき保護列の変更を許可。
--
--   ★ メンテ用の手動UPDATE（例: supabase_tenkyuu_dev.sql のえちゅ強化）を流すときは、
--      同一トランザクションで先頭に↓を入れてから実行すること:
--          SET LOCAL "app.allow_stat_change" = 'on';
-- ============================================================


-- ===== 1) 保護トリガー =====
CREATE OR REPLACE FUNCTION public.protect_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_stat_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.stat_point_spent    IS DISTINCT FROM OLD.stat_point_spent
       OR NEW.pending_stat_points IS DISTINCT FROM OLD.pending_stat_points
       OR NEW.lv               IS DISTINCT FROM OLD.lv
       OR NEW.char_lv          IS DISTINCT FROM OLD.char_lv
       OR NEW.exp              IS DISTINCT FROM OLD.exp
       OR NEW.retraining       IS DISTINCT FROM OLD.retraining THEN
      RAISE EXCEPTION '不正な操作です（ステータスはサーバ経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_profile_stats ON public.profiles;
CREATE TRIGGER trg_protect_profile_stats
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_stats();


CREATE OR REPLACE FUNCTION public.protect_class_levels()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_stat_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.lv IS DISTINCT FROM OLD.lv OR NEW.exp IS DISTINCT FROM OLD.exp THEN
      RAISE EXCEPTION '不正な操作です（クラスレベルはサーバ経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_class_levels ON public.class_levels;
CREATE TRIGGER trg_protect_class_levels
  BEFORE UPDATE ON public.class_levels
  FOR EACH ROW EXECUTE FUNCTION public.protect_class_levels();


-- ===== 2) ステータスポイント振り分け =====
-- 置換: Game.jsx confirmStatPoints
-- p_alloc 例: {"hp":3,"mp":0,"atk":2,"def":0,"matk":0,"mdef":0,"spd":0}
CREATE OR REPLACE FUNCTION public.allocate_stat_points(p_alloc jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_spent jsonb;
  v_a int; v_b int; v_c int; v_d int; v_e int; v_f int; v_g int;
  v_total int;
  v_new_pending int;
  v_new_spent jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  v_a := GREATEST(0, COALESCE((p_alloc->>'hp')::int,   0));
  v_b := GREATEST(0, COALESCE((p_alloc->>'mp')::int,   0));
  v_c := GREATEST(0, COALESCE((p_alloc->>'atk')::int,  0));
  v_d := GREATEST(0, COALESCE((p_alloc->>'def')::int,  0));
  v_e := GREATEST(0, COALESCE((p_alloc->>'matk')::int, 0));
  v_f := GREATEST(0, COALESCE((p_alloc->>'mdef')::int, 0));
  v_g := GREATEST(0, COALESCE((p_alloc->>'spd')::int,  0));
  v_total := v_a+v_b+v_c+v_d+v_e+v_f+v_g;

  IF v_total <= 0 THEN RETURN json_build_object('ok',false,'reason','no_points'); END IF;
  IF v_total > COALESCE(v_profile.pending_stat_points,0) THEN
    RETURN json_build_object('ok',false,'reason','insufficient_points');
  END IF;

  v_spent := COALESCE(v_profile.stat_point_spent, '{}'::jsonb);
  v_new_spent := jsonb_build_object(
    'hp',   COALESCE((v_spent->>'hp')::int,0)   + v_a,
    'mp',   COALESCE((v_spent->>'mp')::int,0)   + v_b,
    'atk',  COALESCE((v_spent->>'atk')::int,0)  + v_c,
    'def',  COALESCE((v_spent->>'def')::int,0)  + v_d,
    'matk', COALESCE((v_spent->>'matk')::int,0) + v_e,
    'mdef', COALESCE((v_spent->>'mdef')::int,0) + v_f,
    'spd',  COALESCE((v_spent->>'spd')::int,0)  + v_g
  );
  v_new_pending := COALESCE(v_profile.pending_stat_points,0) - v_total;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    stat_point_spent = v_new_spent,
    pending_stat_points = v_new_pending
  WHERE id = v_uid;

  RETURN json_build_object('ok',true,'pending_stat_points',v_new_pending,'stat_point_spent',v_new_spent);
END;
$function$;


-- ===== 3) ステータスリセット（振り直し）=====
-- 置換: Equipment.jsx useStatReset の profiles 更新部分
-- ※ リセットアイテムの消費はクライアント側のまま（振り分けポイントの増減はゼロサムで不正利得なし）
CREATE OR REPLACE FUNCTION public.reset_stat_points()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_spent jsonb;
  v_total int;
  v_new_pending int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  v_spent := COALESCE(v_profile.stat_point_spent, '{}'::jsonb);
  v_total := COALESCE((v_spent->>'hp')::int,0)+COALESCE((v_spent->>'mp')::int,0)
           + COALESCE((v_spent->>'atk')::int,0)+COALESCE((v_spent->>'def')::int,0)
           + COALESCE((v_spent->>'matk')::int,0)+COALESCE((v_spent->>'mdef')::int,0)
           + COALESCE((v_spent->>'spd')::int,0);
  v_new_pending := COALESCE(v_profile.pending_stat_points,0) + v_total;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    stat_point_spent = '{}'::jsonb,
    pending_stat_points = v_new_pending
  WHERE id = v_uid;

  RETURN json_build_object('ok',true,'pending_stat_points',v_new_pending);
END;
$function$;


-- ===== 4) 転職 =====
-- 置換: Game.jsx doChangeClass の class_levels 同期 + profiles 更新部分
-- ※ スキルセットの整理はクライアント側のまま（skill_sets は保護対象外）
CREATE OR REPLACE FUNCTION public.switch_class(p_target_class text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_target_lv int; v_target_exp int;
  v_found boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_target_class IS NULL OR length(p_target_class) = 0 THEN
    RETURN json_build_object('ok',false,'reason','invalid_class'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  PERFORM set_config('app.allow_stat_change','on',true);

  -- 現クラスの進捗を class_levels に退避
  UPDATE class_levels SET lv = v_profile.lv, exp = v_profile.exp
    WHERE player_id = v_uid AND class_name = v_profile.class;

  -- 対象クラスの進捗を取得（無ければ新規作成）
  SELECT lv, exp INTO v_target_lv, v_target_exp
    FROM class_levels WHERE player_id = v_uid AND class_name = p_target_class;
  v_found := FOUND;
  IF NOT v_found THEN
    v_target_lv := 1; v_target_exp := 0;
    INSERT INTO class_levels(player_id, class_name, lv, exp)
      VALUES (v_uid, p_target_class, 1, 0);
  END IF;

  UPDATE profiles SET
    class = p_target_class,
    lv = v_target_lv,
    exp = v_target_exp,
    exp_next = calc_exp_next(v_target_lv),
    job_change_count = COALESCE(job_change_count,0) + 1
  WHERE id = v_uid;

  RETURN json_build_object('ok',true,'class',p_target_class,'lv',v_target_lv,'exp',v_target_exp);
END;
$function$;


-- ===== 5) 再修練 =====
-- 置換: Game.jsx doRetraining の profiles / class_levels 更新部分
-- ※ 持ち越しスキル(is_carried_over)の設定はクライアント側のまま
CREATE OR REPLACE FUNCTION public.retrain_class(p_target_class text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_count int;
  v_new_retraining jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_target_class IS NULL OR length(p_target_class) = 0 THEN
    RETURN json_build_object('ok',false,'reason','invalid_class'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  v_count := COALESCE((v_profile.retraining ->> p_target_class)::int, 0);
  IF v_count >= 5 THEN RETURN json_build_object('ok',false,'reason','max_retraining'); END IF;

  v_new_retraining := COALESCE(v_profile.retraining, '{}'::jsonb)
    || jsonb_build_object(p_target_class, v_count + 1);

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    retraining = v_new_retraining,
    lv = 1,
    exp = 0,
    exp_next = calc_exp_next(1)
  WHERE id = v_uid;

  UPDATE class_levels SET lv = 1, exp = 0
    WHERE player_id = v_uid AND class_name = p_target_class;

  RETURN json_build_object('ok',true,'retraining',v_new_retraining,'count',v_count+1);
END;
$function$;


-- ===== 6) カジノ簡易出撃の清算 =====
-- 置換: Casino.jsx settleSortie の profiles / class_levels / player_skills 更新部分
-- ※ ドロップ(weapons/player_equipment)の付与はクライアント側のまま
-- 検証: claimed_exp <= count*11, claimed_gold <= count*1000（雑魚gold上限の安全側）
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
-- 7) 既存RPCに GUC を追加（保護トリガー下でも更新できるように）
--    supabase_levelcap_300.sql の apply_battle_result / apply_dungeon_reward を
--    「PERFORM set_config('app.allow_stat_change','on',true);」入りで上書き。
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
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

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
