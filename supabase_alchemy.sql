-- ============================================================
-- 錬金部屋（Alchemy Room）  2026-06-14
--   ・時間経過で強化石(F〜A)を生成する錬金枠（最大4枠）
--   ・戦闘勝利1%で「時の結晶」ドロップ → 枠の時間 -1時間（短縮はこれのみ）
--   ・解放: エリア③ボス撃破で1枠 / 追憶の遺跡(d30)踏破で+1 /
--           奈落闘技場10回踏破で+1 / エリア⑤ボス撃破で+1
--   ・不正対策: 所持数(time_crystal)と d30踏破フラグ(cleared_d30) は
--     protect_profile_stats で列保護。錬金枠の時刻は全てサーバー now() 基準。
--     ドロップ抽選はサーバー側(apply_battle_result / casino_settle_sortie)で実施。
--
-- ★適用順: protect_stats.sql / scarecrow.sql の【後】に実行すること。
--   （このファイルは apply_battle_result / casino_settle_sortie / protect_profile_stats
--     をそれらの最新版＋錬金ドロップで上書きする。再適用が必要なら本ファイルを流し直す）
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ===== 1) 列追加（保護対象） =====
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cleared_d30  boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS alchemy_mat  int     NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS time_crystal int     NOT NULL DEFAULT 0;

-- ===== 2) 保護トリガー上書き（既存列＋錬金3列を守る） =====
CREATE OR REPLACE FUNCTION public.protect_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_stat_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.stat_point_spent     IS DISTINCT FROM OLD.stat_point_spent
       OR NEW.pending_stat_points IS DISTINCT FROM OLD.pending_stat_points
       OR NEW.lv                IS DISTINCT FROM OLD.lv
       OR NEW.char_lv           IS DISTINCT FROM OLD.char_lv
       OR NEW.exp               IS DISTINCT FROM OLD.exp
       OR NEW.retraining        IS DISTINCT FROM OLD.retraining
       OR NEW.cleared_d30       IS DISTINCT FROM OLD.cleared_d30
       OR NEW.alchemy_mat       IS DISTINCT FROM OLD.alchemy_mat
       OR NEW.time_crystal      IS DISTINCT FROM OLD.time_crystal THEN
      RAISE EXCEPTION '不正な操作です（ステータスはサーバ経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== 3) 錬金枠テーブル（クライアントからは読取のみ。書込はRPCのみ） =====
CREATE TABLE IF NOT EXISTS alchemy_jobs (
  player_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slot       int         NOT NULL CHECK (slot BETWEEN 1 AND 4),
  rank       text        CHECK (rank IN ('F','E','D','C','B','A')),
  started_at timestamptz,
  finish_at  timestamptz,
  PRIMARY KEY (player_id, slot)
);
ALTER TABLE alchemy_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alchemy_jobs_select ON alchemy_jobs;
CREATE POLICY alchemy_jobs_select ON alchemy_jobs FOR SELECT USING (player_id = auth.uid());
-- INSERT/UPDATE/DELETE ポリシーは作らない＝通常クライアントは書込不可。SECURITY DEFINER のRPCのみ。

-- ===== 4) 共通ヘルパ：ランク→所要分 / 解放枠数 =====
CREATE OR REPLACE FUNCTION public.alchemy_rank_minutes(p_rank text)
 RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rank
    WHEN 'F' THEN 60 WHEN 'E' THEN 120 WHEN 'D' THEN 300
    WHEN 'C' THEN 720 WHEN 'B' THEN 1800 WHEN 'A' THEN 4800 END;
$$;

-- 解放枠数（0=未解放）。エリア③ボス未撃破なら0（=ページ自体ロック）。
CREATE OR REPLACE FUNCTION public.alchemy_slot_count(p_uid uuid)
 RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_areas int[]; v_d30 boolean; v_clears int; v_slots int := 0;
BEGIN
  SELECT COALESCE(unlocked_areas, ARRAY[1]), COALESCE(cleared_d30,false)
    INTO v_areas, v_d30 FROM profiles WHERE id = p_uid;
  IF v_areas IS NULL OR NOT (v_areas @> ARRAY[4]) THEN
    RETURN 0;  -- エリア③ボス未撃破＝未解放
  END IF;
  v_slots := 1;                                            -- 1枠目: エリア③ボス
  IF v_d30 THEN v_slots := v_slots + 1; END IF;            -- 2枠目: 追憶の遺跡(d30)踏破
  SELECT COALESCE(total_clears,0) INTO v_clears FROM abyss_progress WHERE player_id = p_uid;
  IF COALESCE(v_clears,0) >= 10 THEN v_slots := v_slots + 1; END IF;  -- 3枠目: 奈落10回踏破
  IF v_areas @> ARRAY[6] THEN v_slots := v_slots + 1; END IF;         -- 4枠目: エリア⑤ボス
  RETURN LEAST(v_slots, 4);
END;
$$;
-- 指定枠が解放済みか（各枠は条件ごとに独立。エリア③ボスがマスターゲート）
CREATE OR REPLACE FUNCTION public.alchemy_slot_unlocked(p_uid uuid, p_slot int)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_areas int[]; v_d30 boolean; v_clears int;
BEGIN
  SELECT COALESCE(unlocked_areas, ARRAY[1]), COALESCE(cleared_d30,false)
    INTO v_areas, v_d30 FROM profiles WHERE id = p_uid;
  IF v_areas IS NULL OR NOT (v_areas @> ARRAY[4]) THEN RETURN false; END IF;  -- エリア③ボス=ゲート
  IF p_slot = 1 THEN RETURN true; END IF;                       -- 1: エリア③ボス
  IF p_slot = 2 THEN RETURN v_d30; END IF;                      -- 2: 追憶の遺跡(d30)踏破
  IF p_slot = 3 THEN
    SELECT COALESCE(total_clears,0) INTO v_clears FROM abyss_progress WHERE player_id = p_uid;
    RETURN COALESCE(v_clears,0) >= 10;                          -- 3: 奈落10回踏破
  END IF;
  IF p_slot = 4 THEN RETURN v_areas @> ARRAY[6]; END IF;        -- 4: エリア⑤ボス
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.alchemy_rank_minutes(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alchemy_slot_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alchemy_slot_unlocked(uuid, int) TO authenticated;

-- ===== 5) 状態取得 =====
CREATE OR REPLACE FUNCTION public.alchemy_get()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_slots int;
  v_jobs json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  v_slots := alchemy_slot_count(v_uid);

  SELECT COALESCE(json_agg(json_build_object(
            'slot', slot, 'rank', rank, 'finish_at', finish_at,
            'ready', (finish_at IS NOT NULL AND now() >= finish_at)
          ) ORDER BY slot), '[]'::json)
    INTO v_jobs
    FROM alchemy_jobs WHERE player_id = v_uid AND rank IS NOT NULL;

  RETURN json_build_object(
    'ok', true,
    'slots', v_slots,
    'crystal', COALESCE(v_profile.time_crystal,0),
    'cleared_d30', COALESCE(v_profile.cleared_d30,false),
    'abyss_clears', (SELECT COALESCE(total_clears,0) FROM abyss_progress WHERE player_id = v_uid),
    'area3_boss', (COALESCE(v_profile.unlocked_areas,ARRAY[1]) @> ARRAY[4]),
    'area5_boss', (COALESCE(v_profile.unlocked_areas,ARRAY[1]) @> ARRAY[6]),
    'jobs', v_jobs,
    'server_now', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.alchemy_get() TO authenticated;

-- ===== 6) 錬金開始 =====
CREATE OR REPLACE FUNCTION public.alchemy_start(p_slot int, p_rank text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_slots int; v_min int; v_exists boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_rank NOT IN ('F','E','D','C','B','A') THEN RETURN json_build_object('ok',false,'reason','invalid_rank'); END IF;
  v_slots := alchemy_slot_count(v_uid);  -- 達成条件数ぶん 1→4 が順に開放
  IF p_slot < 1 OR p_slot > v_slots THEN RETURN json_build_object('ok',false,'reason','slot_locked'); END IF;
  -- 既に稼働中ならNG
  SELECT (rank IS NOT NULL) INTO v_exists FROM alchemy_jobs WHERE player_id = v_uid AND slot = p_slot;
  IF COALESCE(v_exists,false) THEN RETURN json_build_object('ok',false,'reason','slot_busy'); END IF;
  v_min := alchemy_rank_minutes(p_rank);
  INSERT INTO alchemy_jobs(player_id, slot, rank, started_at, finish_at)
    VALUES (v_uid, p_slot, p_rank, now(), now() + (v_min || ' minutes')::interval)
  ON CONFLICT (player_id, slot) DO UPDATE
    SET rank = EXCLUDED.rank, started_at = EXCLUDED.started_at, finish_at = EXCLUDED.finish_at;
  RETURN json_build_object('ok',true,'slot',p_slot,'rank',p_rank,'finish_at', now() + (v_min || ' minutes')::interval);
END;
$$;
GRANT EXECUTE ON FUNCTION public.alchemy_start(int, text) TO authenticated;

-- ===== 7) 受取（完成した強化石を player_items へ付与） =====
CREATE OR REPLACE FUNCTION public.alchemy_claim(p_slot int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job alchemy_jobs%ROWTYPE;
  v_item_id int;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_job FROM alchemy_jobs WHERE player_id = v_uid AND slot = p_slot;
  IF NOT FOUND OR v_job.rank IS NULL THEN RETURN json_build_object('ok',false,'reason','empty'); END IF;
  IF v_job.finish_at IS NULL OR now() < v_job.finish_at THEN RETURN json_build_object('ok',false,'reason','not_ready'); END IF;
  v_name := '強化石(' || v_job.rank || ')';
  SELECT id INTO v_item_id FROM items WHERE name = v_name;
  IF v_item_id IS NULL THEN RETURN json_build_object('ok',false,'reason','item_not_found'); END IF;
  INSERT INTO player_items(player_id, item_id, quantity) VALUES (v_uid, v_item_id, 1)
  ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
  -- 枠を空に
  UPDATE alchemy_jobs SET rank = NULL, started_at = NULL, finish_at = NULL
    WHERE player_id = v_uid AND slot = p_slot;
  RETURN json_build_object('ok',true,'item', v_name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.alchemy_claim(int) TO authenticated;

-- ===== 8) （廃止）錬金用素材での時間短縮 =====
-- 仕様変更で錬金用素材は廃止。短縮は時の結晶のみ。旧関数があれば削除。
DROP FUNCTION IF EXISTS public.alchemy_speedup(int, int);

-- ===== 9) 時の結晶で -1時間 =====
CREATE OR REPLACE FUNCTION public.alchemy_use_crystal(p_slot int, p_count int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_have int; v_use int; v_job alchemy_jobs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_job FROM alchemy_jobs WHERE player_id = v_uid AND slot = p_slot;
  IF NOT FOUND OR v_job.rank IS NULL THEN RETURN json_build_object('ok',false,'reason','empty'); END IF;
  IF now() >= v_job.finish_at THEN RETURN json_build_object('ok',false,'reason','already_done'); END IF;
  SELECT COALESCE(time_crystal,0) INTO v_have FROM profiles WHERE id = v_uid;
  v_use := GREATEST(1, LEAST(COALESCE(p_count,1), v_have));
  IF v_have < 1 THEN RETURN json_build_object('ok',false,'reason','no_crystal'); END IF;
  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET time_crystal = time_crystal - v_use WHERE id = v_uid;
  UPDATE alchemy_jobs SET finish_at = GREATEST(now(), finish_at - (v_use || ' hours')::interval)
    WHERE player_id = v_uid AND slot = p_slot;
  SELECT * INTO v_job FROM alchemy_jobs WHERE player_id = v_uid AND slot = p_slot;
  RETURN json_build_object('ok',true,'used',v_use,'finish_at',v_job.finish_at);
END;
$$;
GRANT EXECUTE ON FUNCTION public.alchemy_use_crystal(int, int) TO authenticated;

-- ============================================================
-- 10) apply_battle_result 上書き（scarecrow版＋錬金ドロップ）
--   追加点: 解放済み(エリア③ボス撃破済)なら
--     ・出撃ごとに 5% で 錬金用素材 +1
--     ・勝利時 1% で 時の結晶 +1
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
  v_alch_unlocked boolean := false;   -- ★錬金
  v_crys_drop int := 0;                -- ★錬金
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  IF EXISTS (SELECT 1 FROM scarecrow_sessions
             WHERE player_id = v_uid AND status = 'active' AND now() < ends_at) THEN
    RETURN json_build_object('ok',false,'reason','scarecrow_active');
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

  -- ★錬金ドロップ抽選（解放済み＝エリア③ボス撃破済のみ。サーバー側乱数＝改ざん不可）
  v_alch_unlocked := v_new_unlocked @> ARRAY[4];
  IF v_alch_unlocked AND p_win AND random() < 0.01 THEN v_crys_drop := 1; END IF; -- 勝利で時の結晶

  INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,level_ups)
  VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,v_eff_exp,p_claimed_gold,v_level_ups);

  v_sc_week := scarecrow_week_key_now();
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_sc_week THEN
    v_sc_charges := 0;
    v_sc_earned  := 0;
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
    time_crystal = time_crystal + v_crys_drop,    -- ★錬金
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
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges,
    'crystal_drop',v_crys_drop);
END;
$function$;

-- ============================================================
-- 11) casino_settle_sortie 上書き（scarecrow版そのまま。錬金素材は廃止）
--   ※ 簡易出撃での錬金ドロップは無し。protect_stats/scarecrowを再適用したらこのセクションも再適用。
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
-- 12) dungeon_kill 上書き（d30専用EXP＋デビルパピア撃破で cleared_d30=true）
--   supabase_dungeon_d30_exp.sql の dungeon_kill を錬金対応で上書き。
--   再適用時は本ファイルを流し直すこと（d30_exp.sql を後から流すとフラグ付与が消える）。
-- ============================================================
DROP FUNCTION IF EXISTS dungeon_kill(uuid, int);
DROP FUNCTION IF EXISTS dungeon_kill(uuid, int, text);
CREATE OR REPLACE FUNCTION dungeon_kill(p_run_id uuid, p_floor int, p_enemy text default null, p_lucky boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype;
  v_floor int; v_exp_gain int; v_new_exp int; v_new_level int; v_cap int; v_lucky boolean := false;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.enemies_defeated >= 300 then raise exception 'too many kills'; end if;

  v_floor := least(greatest(coalesce(p_floor,1), 1), 99);

  if v_run.dungeon_id = 'd30' then
    v_exp_gain := case p_enemy
      when 'スライム'         then 12
      when 'コウモリ'         then 18
      when '毒キノコ'         then 24
      when 'ゴブリン'         then 36
      when '野良犬'           then 36
      when '盗賊'             then 42
      when 'コボルト'         then 48
      when 'スケルトン（剣）' then 54
      when 'スケルトン（弓）' then 50
      when 'ゴーレム（攻）'   then 62
      when 'ゴーレム（守）'   then 66
      when '深海魚人'         then 78
      when '海賊（男）'       then 88
      when '海賊（女）'       then 82
      when '毒クラゲ'         then 78
      when '電気クラゲ'       then 80
      when 'ハリセンボン'     then 75
      when 'デビルパピア'     then 1000
      else greatest(1, 10 + v_floor) end;
  else
    v_exp_gain := case p_enemy
      when 'スライム' then 4
      when 'コウモリ' then 7
      when '毒キノコ' then 10
      when 'ゴブリン' then 13
      when '野良犬'   then 17
      when '盗賊'     then 21
      else greatest(1, 3 + v_floor) end;
  end if;

  if p_lucky and random() < 0.5 then v_exp_gain := round(v_exp_gain * 1.5)::int; v_lucky := true; end if;

  select * into v_pet from pets where id = v_run.pet_id and owner_id = auth.uid();
  if not found then raise exception 'pet not found'; end if;

  v_cap := case when v_pet.evolved then 9999 else 50 end;
  v_new_exp := v_pet.exp + v_exp_gain;
  v_new_level := v_pet.level;
  while v_new_level < v_cap and v_new_exp >= v_new_level * 10 loop
    v_new_exp := v_new_exp - v_new_level * 10;
    v_new_level := v_new_level + 1;
  end loop;
  if v_new_level >= v_cap then v_new_exp := 0; end if;

  update pets set exp = v_new_exp, level = v_new_level where id = v_pet.id;
  update dungeon_runs set enemies_defeated = enemies_defeated + 1 where id = p_run_id;

  -- ★追憶の遺跡(d30)のボス「デビルパピア」撃破で踏破フラグを立てる（錬金2枠目の解放条件）
  if v_run.dungeon_id = 'd30' and p_enemy = 'デビルパピア' then
    perform set_config('app.allow_stat_change','on',true);
    update profiles set cleared_d30 = true where id = auth.uid() and coalesce(cleared_d30,false) = false;
  end if;

  return json_build_object('exp_gain', v_exp_gain, 'level', v_new_level, 'exp', v_new_exp, 'leveled', v_new_level > v_pet.level, 'lucky', v_lucky);
end; $$;
grant execute on function dungeon_kill(uuid, int, text, boolean) to authenticated;

-- ============================================================
-- 13) 釣りでの時の結晶ドロップ（1匹ごと1%・サーバー側抽選）
--   釣り終了時にクライアントが釣れた匹数で呼ぶ。錬金解放後(エリア③ボス撃破済)のみ有効。
-- ============================================================
CREATE OR REPLACE FUNCTION public.fishing_grant_crystal(p_count int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_areas int[]; v_n int; v_drops int := 0; i int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(unlocked_areas, ARRAY[1]) INTO v_areas FROM profiles WHERE id = v_uid;
  IF v_areas IS NULL OR NOT (v_areas @> ARRAY[4]) THEN RETURN json_build_object('ok',true,'crystal_drop',0); END IF;
  v_n := GREATEST(0, LEAST(COALESCE(p_count,0), 100));  -- 1回の付与上限100匹ぶん
  FOR i IN 1..v_n LOOP
    IF random() < 0.01 THEN v_drops := v_drops + 1; END IF;
  END LOOP;
  IF v_drops > 0 THEN
    PERFORM set_config('app.allow_stat_change','on',true);
    UPDATE profiles SET time_crystal = time_crystal + v_drops WHERE id = v_uid;
  END IF;
  RETURN json_build_object('ok',true,'crystal_drop',v_drops);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fishing_grant_crystal(int) TO authenticated;
