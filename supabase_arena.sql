-- ============================================================
-- アリーナ（梯子型対人コンテンツ）  2026-07-04
-- ------------------------------------------------------------
-- 仕様:
--   ・全20階。全員 floor1 から挑戦（着席していない人＝自由挑戦者）。
--   ・自由挑戦者は「自分の目標階(target_floor)」にだけ挑める。
--       空席      → 戦わず着席（EXPなし・CDなし・HP/MPフル）。
--       占有       → 戦闘（1hCD消費・EXP+20）。
--         勝ち → 自分がその階に着席。敗れた守護者は目標＝その階+1 の自由挑戦者に（上へ）。
--         負け → 自分の目標＝1つ下の階（max(1, floor-1)）に。
--   ・守護中(着席中)は挑戦不可。席を失って初めて次の階に挑戦できる。
--   ・持続HP/MP（街HPとは別プール・自然回復なし）: 削れるのは「挑戦された守護者」のみ。
--       守護者は着席時フル → 防衛のたびに戦闘終了時HP/MPを保存（回復なし）。
--       挑戦者は毎回フルで挑む（＝クライアントの simulatePvpBattle は挑戦者A満タン、
--       守護者B の開始HP/MPに slot.hp_current/mp_current を startHpB/startMpB で渡す）。
--
-- 戦闘はクライアント計算。サーバーは CD/目標/占有 を検証し、勝敗・残HP申告を信頼(clampのみ)。
-- 既存の対人モデル（組み手/出撃）と同じ信頼水準。報酬は軽微（EXP+20・Gold×1.1・順位）。
--
-- 適用順: protect_stats.sql の後（EXP付与で app.allow_stat_change を使うため独立して問題なし）。
--   ※ 出撃Gold×1.1（守護ボーナス）は別ファイル supabase_arena_gold_bonus.sql
--     （apply_battle_result 上書き）を scarecrow.sql の後に適用すること。
--   ※ 初期配置は supabase_arena_seed.sql。
-- Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- ===== 1) テーブル =====
CREATE TABLE IF NOT EXISTS arena_slots (
  floor         int PRIMARY KEY CHECK (floor BETWEEN 1 AND 20),
  holder_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  hp_current    int,               -- 守護者の持続HP（着席時フル・防衛で減少・回復なし）
  mp_current    int,               -- 同上MP
  hp_max        int,               -- 着席時の実効最大HP（HPバー表示用）
  mp_max        int,               -- 同上MP
  streak        int  NOT NULL DEFAULT 0,   -- 連勝数（0=着席直後 / ≥1=N連勝中）
  defeated_name text,              -- 直近で倒した相手名（「Xに勝利」表示用）
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- 1人につき着席は最大1階
CREATE UNIQUE INDEX IF NOT EXISTS arena_slots_holder_uniq
  ON arena_slots(holder_id) WHERE holder_id IS NOT NULL;
-- 1..20 を空きで初期化
INSERT INTO arena_slots(floor) SELECT generate_series(1,20)
  ON CONFLICT (floor) DO NOTHING;

-- 自由挑戦者の状態（着席していない人の目標階）＋挑戦CD
CREATE TABLE IF NOT EXISTS arena_players (
  player_id         uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  target_floor      int NOT NULL DEFAULT 1 CHECK (target_floor BETWEEN 1 AND 20),
  last_challenge_at timestamptz
);

-- ===== 2) RLS（SELECTのみ許可・書込みはRPC=SECURITY DEFINER経由） =====
ALTER TABLE arena_slots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arena_slots_sel ON arena_slots;
CREATE POLICY arena_slots_sel   ON arena_slots   FOR SELECT USING (true);           -- 盤面は公開
DROP POLICY IF EXISTS arena_players_sel ON arena_players;
CREATE POLICY arena_players_sel ON arena_players FOR SELECT USING (auth.uid() = player_id);

-- 挑戦CD（秒）
CREATE OR REPLACE FUNCTION public.arena_cooldown_seconds()
 RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 3600 $$;

-- ============================================================
-- 3) 盤面取得: 20階＋自分の階/目標/CD を1往復で返す
-- ============================================================
CREATE OR REPLACE FUNCTION public.arena_get_board()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_board json;
  v_my_floor int;
  v_target int;
  v_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT COALESCE(json_agg(t ORDER BY t.floor), '[]'::json) INTO v_board FROM (
    SELECT s.floor, s.holder_id, p.username, p.char_lv, p.class, p.avatar_url,
           s.hp_current, s.mp_current, s.hp_max, s.mp_max, s.streak, s.defeated_name
    FROM arena_slots s
    LEFT JOIN profiles p ON p.id = s.holder_id
  ) t;

  SELECT floor INTO v_my_floor FROM arena_slots WHERE holder_id = v_uid;
  SELECT target_floor, last_challenge_at INTO v_target, v_last
    FROM arena_players WHERE player_id = v_uid;

  RETURN json_build_object(
    'ok', true,
    'my_floor', v_my_floor,               -- null なら非着席（自由挑戦者）
    'target_floor', COALESCE(v_target, 1),
    'last_challenge_at', v_last,
    'cooldown_seconds', arena_cooldown_seconds(),
    'board', v_board
  );
END; $function$;
GRANT EXECUTE ON FUNCTION public.arena_get_board() TO authenticated;

-- ============================================================
-- 4) 空席に着席（戦わず獲得・EXP/CDなし）
--    p_hp_max/p_mp_max = 自分の実効最大（着席時フル値として保存）
-- ============================================================
CREATE OR REPLACE FUNCTION public.arena_claim_empty(p_floor int, p_hp_max int, p_mp_max int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_my_floor int;
  v_target int;
  v_holder uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_floor IS NULL OR p_floor < 1 OR p_floor > 20 THEN
    RETURN json_build_object('ok',false,'reason','invalid_floor'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('ok',false,'reason','suspended'); END IF;

  -- 着席中は挑戦・移動不可
  SELECT floor INTO v_my_floor FROM arena_slots WHERE holder_id = v_uid;
  IF v_my_floor IS NOT NULL THEN
    RETURN json_build_object('ok',false,'reason','already_seated','my_floor',v_my_floor); END IF;

  -- 目標階チェック
  SELECT target_floor INTO v_target FROM arena_players WHERE player_id = v_uid;
  v_target := COALESCE(v_target, 1);
  IF p_floor <> v_target THEN
    RETURN json_build_object('ok',false,'reason','wrong_floor','target',v_target); END IF;

  -- 対象階をロックして空席確認
  SELECT holder_id INTO v_holder FROM arena_slots WHERE floor = p_floor FOR UPDATE;
  IF v_holder IS NOT NULL THEN
    RETURN json_build_object('ok',false,'reason','occupied'); END IF;

  -- 着席（HP/MPフル）
  UPDATE arena_slots SET
    holder_id     = v_uid,
    hp_current    = GREATEST(1, COALESCE(p_hp_max, 1)),
    mp_current    = GREATEST(0, COALESCE(p_mp_max, 0)),
    hp_max        = GREATEST(1, COALESCE(p_hp_max, 1)),
    mp_max        = GREATEST(0, COALESCE(p_mp_max, 0)),
    streak        = 0,
    defeated_name = NULL,
    updated_at    = now()
  WHERE floor = p_floor;

  INSERT INTO arena_players(player_id, target_floor) VALUES (v_uid, p_floor)
    ON CONFLICT (player_id) DO NOTHING;

  RETURN json_build_object('ok',true,'seated_floor',p_floor);
END; $function$;
GRANT EXECUTE ON FUNCTION public.arena_claim_empty(int,int,int) TO authenticated;

-- ============================================================
-- 5) 占有階への戦闘結果を反映（1hCD・EXP+20・入れ替え/降格）
--    p_won        = 挑戦者(自分)が勝ったか（クライアント計算結果）
--    p_def_end_hp/mp = 守護者の戦闘終了時HP/MP（負け時=守護者存続の保存値）
--    p_my_hp_max/mp_max = 自分の実効最大（勝って着席するときフル値として保存）
-- ============================================================
CREATE OR REPLACE FUNCTION public.arena_battle_result(
  p_floor int, p_opponent uuid, p_won boolean,
  p_def_end_hp int, p_def_end_mp int,
  p_my_hp_max int, p_my_mp_max int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_my_floor int;
  v_target int;
  v_holder uuid;
  v_cd int := arena_cooldown_seconds();
  v_last timestamptz;
  v_opp_name text;
  -- EXP付与用
  v_class_lv int; v_cap int; v_is_at_cap boolean; v_exp_frozen boolean;
  v_new_exp int; v_new_lv int; v_new_exp_next int; v_new_pending int; v_new_char_lv int;
  v_old_lv int; v_level_ups int := 0; v_learned text[];
  v_exp_gain int := 20;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_floor IS NULL OR p_floor < 1 OR p_floor > 20 THEN
    RETURN json_build_object('ok',false,'reason','invalid_floor'); END IF;
  IF p_opponent IS NULL THEN RETURN json_build_object('ok',false,'reason','no_opponent'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('ok',false,'reason','suspended'); END IF;

  -- 着席中(守護中)は挑戦不可
  SELECT floor INTO v_my_floor FROM arena_slots WHERE holder_id = v_uid;
  IF v_my_floor IS NOT NULL THEN
    RETURN json_build_object('ok',false,'reason','seated_cannot_challenge','my_floor',v_my_floor); END IF;

  -- 目標階チェック
  SELECT target_floor, last_challenge_at INTO v_target, v_last
    FROM arena_players WHERE player_id = v_uid;
  v_target := COALESCE(v_target, 1);
  IF p_floor <> v_target THEN
    RETURN json_build_object('ok',false,'reason','wrong_floor','target',v_target); END IF;

  -- CD（1時間に1回）
  IF v_last IS NOT NULL AND now() - v_last < (v_cd || ' seconds')::interval THEN
    RETURN json_build_object('ok',false,'reason','cooldown',
      'seconds_left', v_cd - EXTRACT(EPOCH FROM (now() - v_last))::int); END IF;

  -- 対象階をロックし、想定した相手が現在も占有しているか再確認（レース対策）
  SELECT holder_id INTO v_holder FROM arena_slots WHERE floor = p_floor FOR UPDATE;
  IF v_holder IS NULL THEN
    RETURN json_build_object('ok',false,'reason','now_empty'); END IF;   -- 空いた→着席側で処理し直し
  IF v_holder <> p_opponent THEN
    RETURN json_build_object('ok',false,'reason','target_changed'); END IF;
  IF v_holder = v_uid THEN
    RETURN json_build_object('ok',false,'reason','self'); END IF;

  SELECT username INTO v_opp_name FROM profiles WHERE id = p_opponent;

  -- ===== CD消費＋EXP+20（レベルアップ処理込み。casino_settle_sortie と同方式） =====
  PERFORM set_config('app.allow_stat_change','on',true);

  INSERT INTO arena_players(player_id, target_floor, last_challenge_at)
    VALUES (v_uid, v_target, now())
    ON CONFLICT (player_id) DO UPDATE SET last_challenge_at = now();

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int,0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen,false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  v_old_lv       := v_profile.lv;
  v_new_exp      := COALESCE(v_profile.exp,0) + (CASE WHEN v_exp_frozen OR v_is_at_cap THEN 0 ELSE v_exp_gain END);
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points,0);
  v_new_char_lv  := COALESCE(v_profile.char_lv,1);
  IF v_exp_frozen OR v_is_at_cap THEN v_exp_gain := 0; END IF;

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

  UPDATE profiles SET
    exp = v_new_exp, exp_next = v_new_exp_next, lv = v_new_lv,
    char_lv = v_new_char_lv, pending_stat_points = v_new_pending
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
        AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = v_uid AND ps.skill_id = s.id)
      RETURNING skill_id
    )
    SELECT array_agg(s.name) INTO v_learned FROM ins JOIN skills s ON s.id = ins.skill_id;
  END IF;

  -- ===== 勝敗を盤面へ反映 =====
  IF p_won THEN
    -- 勝ち: 自分がその階に着席（フルHP）。旧守護者は目標＝その階+1 の自由挑戦者へ。
    UPDATE arena_slots SET
      holder_id     = v_uid,
      hp_current    = GREATEST(1, COALESCE(p_my_hp_max, 1)),
      mp_current    = GREATEST(0, COALESCE(p_my_mp_max, 0)),
      hp_max        = GREATEST(1, COALESCE(p_my_hp_max, 1)),
      mp_max        = GREATEST(0, COALESCE(p_my_mp_max, 0)),
      streak        = 1,
      defeated_name = v_opp_name,
      updated_at    = now()
    WHERE floor = p_floor;

    INSERT INTO arena_players(player_id, target_floor)
      VALUES (p_opponent, LEAST(20, p_floor + 1))
      ON CONFLICT (player_id) DO UPDATE SET target_floor = LEAST(20, p_floor + 1);
  ELSE
    -- 負け: 守護者存続（残HP/MP保存・連勝+1・撃破名=自分）。自分の目標は1つ下へ。
    UPDATE arena_slots SET
      hp_current    = GREATEST(0, LEAST(COALESCE(p_def_end_hp, 0), 99999999)),
      mp_current    = GREATEST(0, LEAST(COALESCE(p_def_end_mp, 0), 99999999)),
      streak        = streak + 1,
      defeated_name = v_profile.username,
      updated_at    = now()
    WHERE floor = p_floor;

    UPDATE arena_players SET target_floor = GREATEST(1, p_floor - 1) WHERE player_id = v_uid;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'won', p_won,
    'exp_gained', v_exp_gain,
    'level_ups', v_level_ups,
    'new_lv', v_new_lv,
    'learned', COALESCE(v_learned, ARRAY[]::text[]),
    'seated_floor', CASE WHEN p_won THEN p_floor ELSE NULL END,
    'new_target', CASE WHEN p_won THEN NULL ELSE GREATEST(1, p_floor - 1) END
  );
END; $function$;
GRANT EXECUTE ON FUNCTION public.arena_battle_result(int,uuid,boolean,int,int,int,int) TO authenticated;
