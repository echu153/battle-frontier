-- ============================================================
-- 星霜百層塔（せいそうひゃくそうとう）
-- ------------------------------------------------------------
-- ・現状 is_admin 限定の開発先行。一般公開時の解放条件はキャラLV1000。
-- ・1層の流れ:
--     ① 塔出撃を (30 + 層数×10) 回こなす → 中ボスが5%で出現するようになる
--     ② 中ボスを撃破 → その層の層主に挑戦できる（以降いつでも何度でも）
--     ③ 層主挑戦 = 6連戦。HP/MPは連戦中いっさい回復しない（持ち越し）
-- ・HP/MPは「塔専用プール」。profiles.hp_current/mp_current とは完全に切り離す。
--   → profiles の保護列を一切書かないので protect_stats トリガーに触れない。
-- ・報酬は未設計。このSQLでは Gold と通常EXP だけを付与する（apply_battle_result は触らない）。
--
-- ⚠ 適用順の鉄則には抵触しない:
--    このファイルは apply_battle_result / apply_dungeon_reward を一切定義しない。
--    そのため supabase_mutant_gold_20260703.sql より前後どちらに流してもよい。
--
-- 実行はユーザー側（Supabase SQL Editor）で行う。
-- ============================================================

-- ============================================================
-- 1. テーブル
-- ============================================================

-- 層ごとの進捗（出撃カウンタ・中ボス撃破・層主撃破）
CREATE TABLE IF NOT EXISTS tower_progress (
  player_id      uuid    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  floor          int     NOT NULL,
  sortie_count   int     NOT NULL DEFAULT 0,   -- その層で塔出撃した回数（永久保存）
  mid_defeated   boolean NOT NULL DEFAULT false, -- 中ボスを倒した＝層主に挑戦できる
  boss_cleared   boolean NOT NULL DEFAULT false, -- 層主を倒した＝次の層が解放
  first_clear_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, floor)
);
ALTER TABLE tower_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_progress_select_own ON tower_progress;
CREATE POLICY tower_progress_select_own ON tower_progress
  FOR SELECT USING (auth.uid() = player_id);

-- プレイヤーごとの塔の状態（塔EXP・塔LV・ツリー・進行中の連戦）
-- ※深層の敵HPが天文学的になるため、HPを保存する列はすべて bigint
CREATE TABLE IF NOT EXISTS tower_player (
  player_id     uuid    PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tower_exp     bigint  NOT NULL DEFAULT 0,    -- 累計の塔EXP
  tree_alloc    jsonb   NOT NULL DEFAULT '{}'::jsonb, -- {ノードkey: 段数}
  target_mode   text    NOT NULL DEFAULT 'top',-- 複数敵がいるときの狙い方 top/random/hp_high/hp_low
  max_floor     int     NOT NULL DEFAULT 0,    -- 到達層（ランキング用。層主を倒した最高層）
  max_floor_at  timestamptz,                   -- その到達層に初めて到達した時刻（同率のタイブレーク）
  -- 進行中の層主連戦（中断してもここから再開する。抜け道を塞ぐためHPごと保存）
  run_floor     int,                           -- NULL = 連戦していない
  run_stage     int     NOT NULL DEFAULT 0,    -- 0..5（BOSS_RUN_STAGES の添字）
  run_hp        bigint,
  run_mp        bigint,
  run_started_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tower_player ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_player_select_own ON tower_player;
CREATE POLICY tower_player_select_own ON tower_player
  FOR SELECT USING (auth.uid() = player_id);

-- 石碑：層主のサーバー初討伐者（10層ごとの節目だけ記録）
CREATE TABLE IF NOT EXISTS tower_first_clear (
  floor       int  PRIMARY KEY,                -- ユニーク制約で最初のINSERTだけが通る
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username    text NOT NULL,                   -- 改名・退会後も石碑に残すため名前を焼き込む
  cleared_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tower_first_clear ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_first_clear_select_all ON tower_first_clear;
CREATE POLICY tower_first_clear_select_all ON tower_first_clear
  FOR SELECT USING (true);   -- 石碑は全員が見られる

-- ============================================================
-- 2. 定数（クライアントの src/lib/tower.js と必ず一致させること）
-- ============================================================
CREATE OR REPLACE FUNCTION tower_max_floor() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;              -- 実装済みの最終層

CREATE OR REPLACE FUNCTION tower_sorties_to_mid(p_floor int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 + p_floor * 10 $$;

CREATE OR REPLACE FUNCTION tower_exp_per_sortie() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 100 $$;

-- 塔LV lv → lv+1 に必要な塔EXP = 5 × lv²
CREATE OR REPLACE FUNCTION tower_exp_to_next(p_lv int) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT (5::bigint * p_lv * p_lv) $$;

-- 累計塔EXPから塔LVを求める
CREATE OR REPLACE FUNCTION tower_level_from_exp(p_exp bigint) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_lv int := 1; v_rest bigint := COALESCE(p_exp, 0);
BEGIN
  WHILE v_lv < 9999 AND v_rest >= tower_exp_to_next(v_lv) LOOP
    v_rest := v_rest - tower_exp_to_next(v_lv);
    v_lv := v_lv + 1;
  END LOOP;
  RETURN v_lv;
END; $$;

-- 塔LVで1ノードに振れる最大段数（10段ごとに解放・上限50段）
CREATE OR REPLACE FUNCTION tower_max_steps(p_lv int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lv >= 200 THEN 50
    WHEN p_lv >= 150 THEN 40
    WHEN p_lv >= 100 THEN 30
    WHEN p_lv >=  50 THEN 20
    ELSE 10 END
$$;

-- 塔に入れるか（現状 is_admin 限定。一般公開時は char_lv >= 1000 へ切り替える）
CREATE OR REPLACE FUNCTION tower_can_enter(p_profile profiles) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_profile.is_admin, false)
  -- 一般公開時はこちらに差し替える:
  -- SELECT COALESCE(p_profile.is_admin, false) OR COALESCE(p_profile.char_lv, 1) >= 1000
$$;

-- ============================================================
-- 3. 状況取得
-- ============================================================
CREATE OR REPLACE FUNCTION get_tower_status()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid     uuid;
  v_profile profiles%ROWTYPE;
  v_tp      tower_player%ROWTYPE;
  v_lv      int;
  v_used    bigint;
  v_i       int;
  v_floors  json;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT FOUND THEN RETURN json_build_object('error', 'プロフィールがありません'); END IF;
  IF NOT tower_can_enter(v_profile) THEN
    RETURN json_build_object('error', 'まだ塔には入れません', 'locked', true);
  END IF;

  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND THEN
    INSERT INTO tower_player (player_id) VALUES (v_pid)
      ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  END IF;

  v_lv := tower_level_from_exp(v_tp.tower_exp);
  -- 塔LVまでに消費した累計EXP → 現在LV内の余剰を出す
  v_used := 0;
  FOR v_i IN 1 .. (v_lv - 1) LOOP v_used := v_used + tower_exp_to_next(v_i); END LOOP;

  SELECT COALESCE(json_agg(json_build_object(
    'floor',        f.floor,
    'sortie_count', COALESCE(p.sortie_count, 0),
    'need',         tower_sorties_to_mid(f.floor),
    'mid_defeated', COALESCE(p.mid_defeated, false),
    'boss_cleared', COALESCE(p.boss_cleared, false),
    -- 1層は常に解放。2層以降は前の層の層主を倒していれば解放
    'unlocked',     (f.floor = 1 OR COALESCE(prev.boss_cleared, false))
  ) ORDER BY f.floor), '[]'::json) INTO v_floors
  FROM generate_series(1, tower_max_floor()) AS f(floor)
  LEFT JOIN tower_progress p    ON p.player_id    = v_pid AND p.floor    = f.floor
  LEFT JOIN tower_progress prev ON prev.player_id = v_pid AND prev.floor = f.floor - 1;

  RETURN json_build_object(
    'tower_lv',    v_lv,
    'tower_exp',   v_tp.tower_exp,
    'exp_in_lv',   v_tp.tower_exp - v_used,
    'exp_to_next', tower_exp_to_next(v_lv),
    'max_steps',   tower_max_steps(v_lv),
    'spent',       (SELECT COALESCE(SUM(GREATEST(0, LEAST(50, value::int))), 0)
                    FROM jsonb_each_text(v_tp.tree_alloc)),
    'tree_alloc',  v_tp.tree_alloc,
    'target_mode', v_tp.target_mode,
    'max_floor',   v_tp.max_floor,
    'run', CASE WHEN v_tp.run_floor IS NULL THEN NULL ELSE json_build_object(
      'floor', v_tp.run_floor, 'stage', v_tp.run_stage,
      'hp', v_tp.run_hp, 'mp', v_tp.run_mp, 'started_at', v_tp.run_started_at
    ) END,
    'floors',      v_floors
  );
END; $$;

-- ============================================================
-- 4. 塔出撃の結果を反映
--    p_won        : 勝ったか
--    p_mid_defeat : この出撃で中ボスを倒したか
--    p_gold       : クライアントが計算したGold（サーバ側で上限を検証）
--    p_exp        : 通常EXP（キャラLV用）
-- ============================================================
CREATE OR REPLACE FUNCTION tower_sortie_result(
  p_floor int, p_won boolean, p_mid_defeat boolean DEFAULT false,
  p_gold int DEFAULT 0, p_exp int DEFAULT 0
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid     uuid;
  v_profile profiles%ROWTYPE;
  v_prev    boolean;
  v_cnt     int;
  v_need    int;
  v_gold    int;
  v_exp     int;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > tower_max_floor() THEN
    RETURN json_build_object('error', '層が不正です');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT tower_can_enter(v_profile) THEN
    RETURN json_build_object('error', 'まだ塔には入れません');
  END IF;

  -- その層が解放されているか（1層は常に可・2層以降は前の層の層主撃破が必要）
  IF p_floor > 1 THEN
    SELECT COALESCE(boss_cleared, false) INTO v_prev
      FROM tower_progress WHERE player_id = v_pid AND floor = p_floor - 1;
    IF NOT COALESCE(v_prev, false) THEN
      RETURN json_build_object('error', 'この層はまだ解放されていません');
    END IF;
  END IF;

  -- 不正値の抑止（クライアント申告のGold/EXPに上限を掛ける）
  v_gold := LEAST(GREATEST(COALESCE(p_gold, 0), 0), 20000000);
  v_exp  := LEAST(GREATEST(COALESCE(p_exp,  0), 0), 100);

  INSERT INTO tower_progress (player_id, floor, sortie_count)
    VALUES (v_pid, p_floor, 1)
  ON CONFLICT (player_id, floor) DO UPDATE
    SET sortie_count = tower_progress.sortie_count + 1, updated_at = now()
  RETURNING sortie_count INTO v_cnt;

  v_need := tower_sorties_to_mid(p_floor);

  -- 中ボス撃破：しきい値に到達していなければ受け付けない
  IF p_mid_defeat AND p_won AND v_cnt >= v_need THEN
    UPDATE tower_progress SET mid_defeated = true, updated_at = now()
      WHERE player_id = v_pid AND floor = p_floor;
  END IF;

  -- 塔EXPは勝敗にかかわらず1出撃ぶん入る（出撃したこと自体が積み上がる）
  INSERT INTO tower_player (player_id, tower_exp) VALUES (v_pid, tower_exp_per_sortie())
  ON CONFLICT (player_id) DO UPDATE
    SET tower_exp = tower_player.tower_exp + tower_exp_per_sortie(), updated_at = now();

  -- Gold と 通常EXP（勝った時だけ）。profiles の保護列(atk/def等)は触らない。
  IF p_won AND (v_gold > 0 OR v_exp > 0) THEN
    UPDATE profiles SET
      gold = COALESCE(gold, 0) + v_gold,
      exp  = COALESCE(exp, 0)  + v_exp
    WHERE id = v_pid;
  END IF;

  RETURN json_build_object(
    'sortie_count', v_cnt,
    'need',         v_need,
    'mid_open',     (v_cnt >= v_need),
    'gold',         CASE WHEN p_won THEN v_gold ELSE 0 END,
    'exp',          CASE WHEN p_won THEN v_exp ELSE 0 END,
    'tower_exp',    tower_exp_per_sortie()
  );
END; $$;

-- ============================================================
-- 5. 層主連戦：開始 / 進行の保存 / 破棄
--    中断してもHPごとサーバーに残るので「離脱して回復して戻る」抜け道がない。
-- ============================================================
CREATE OR REPLACE FUNCTION tower_run_start(p_floor int, p_hp bigint, p_mp bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid uuid; v_profile profiles%ROWTYPE; v_mid boolean; v_prev boolean;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT tower_can_enter(v_profile) THEN RETURN json_build_object('error', 'まだ塔には入れません'); END IF;
  IF p_floor < 1 OR p_floor > tower_max_floor() THEN RETURN json_build_object('error', '層が不正です'); END IF;

  IF p_floor > 1 THEN
    SELECT COALESCE(boss_cleared, false) INTO v_prev
      FROM tower_progress WHERE player_id = v_pid AND floor = p_floor - 1;
    IF NOT COALESCE(v_prev, false) THEN RETURN json_build_object('error', 'この層はまだ解放されていません'); END IF;
  END IF;

  SELECT COALESCE(mid_defeated, false) INTO v_mid
    FROM tower_progress WHERE player_id = v_pid AND floor = p_floor;
  IF NOT COALESCE(v_mid, false) THEN
    RETURN json_build_object('error', 'まず中ボスを倒してください');
  END IF;

  INSERT INTO tower_player (player_id, run_floor, run_stage, run_hp, run_mp, run_started_at)
    VALUES (v_pid, p_floor, 0, GREATEST(p_hp, 0), GREATEST(p_mp, 0), now())
  ON CONFLICT (player_id) DO UPDATE
    SET run_floor = p_floor, run_stage = 0,
        run_hp = GREATEST(p_hp, 0), run_mp = GREATEST(p_mp, 0),
        run_started_at = now(), updated_at = now();

  RETURN json_build_object('ok', true, 'floor', p_floor, 'stage', 0);
END; $$;

-- 1戦終えるごとに呼ぶ（HP/MPを持ち越したままステージを進める）
CREATE OR REPLACE FUNCTION tower_run_save(p_stage int, p_hp bigint, p_mp bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_tp tower_player%ROWTYPE;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND OR v_tp.run_floor IS NULL THEN
    RETURN json_build_object('error', '進行中の連戦がありません');
  END IF;
  -- 巻き戻し防止：ステージは前に進むときだけ受け付ける
  IF p_stage <= v_tp.run_stage THEN
    RETURN json_build_object('error', 'ステージが不正です');
  END IF;

  UPDATE tower_player
    SET run_stage = LEAST(p_stage, 6), run_hp = GREATEST(p_hp, 0), run_mp = GREATEST(p_mp, 0),
        updated_at = now()
    WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'stage', LEAST(p_stage, 6));
END; $$;

-- 連戦を破棄（敗北・自主放棄）
CREATE OR REPLACE FUNCTION tower_run_abort()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  UPDATE tower_player
    SET run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
        run_started_at = NULL, updated_at = now()
    WHERE player_id = v_pid;
  RETURN json_build_object('ok', true);
END; $$;

-- ============================================================
-- 6. 層主撃破
--    連戦の最終ステージまで進んでいることをサーバ側で検証してから確定する。
-- ============================================================
CREATE OR REPLACE FUNCTION tower_boss_clear(p_floor int, p_gold int DEFAULT 0, p_exp int DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid   uuid;
  v_tp    tower_player%ROWTYPE;
  v_name  text;
  v_first boolean := false;
  v_rows  int := 0;
  v_gold  int;
  v_exp   int;
  v_new   boolean := false;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND OR v_tp.run_floor IS DISTINCT FROM p_floor THEN
    RETURN json_build_object('error', 'この層の連戦を行っていません');
  END IF;
  -- 6戦目（添字5）まで進んでいなければ層主を倒せるはずがない
  IF v_tp.run_stage < 5 THEN
    RETURN json_build_object('error', '連戦が最後まで進んでいません');
  END IF;

  v_gold := LEAST(GREATEST(COALESCE(p_gold, 0), 0), 20000000);
  v_exp  := LEAST(GREATEST(COALESCE(p_exp,  0), 0), 100);

  -- 初クリアかどうか
  SELECT NOT COALESCE(boss_cleared, false) INTO v_new
    FROM tower_progress WHERE player_id = v_pid AND floor = p_floor;
  v_new := COALESCE(v_new, true);

  INSERT INTO tower_progress (player_id, floor, boss_cleared, first_clear_at)
    VALUES (v_pid, p_floor, true, now())
  ON CONFLICT (player_id, floor) DO UPDATE
    SET boss_cleared = true,
        first_clear_at = COALESCE(tower_progress.first_clear_at, now()),
        updated_at = now();

  -- 到達層の更新（ランキング用）
  UPDATE tower_player
    SET max_floor    = GREATEST(COALESCE(max_floor, 0), p_floor),
        max_floor_at = CASE WHEN p_floor > COALESCE(max_floor, 0) THEN now() ELSE max_floor_at END,
        run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL, run_started_at = NULL,
        updated_at = now()
    WHERE player_id = v_pid;

  -- 石碑：10層ごとの節目だけ、サーバーで最初の1人を記録する
  IF p_floor % 10 = 0 THEN
    SELECT username INTO v_name FROM profiles WHERE id = v_pid;
    INSERT INTO tower_first_clear (floor, player_id, username)
      VALUES (p_floor, v_pid, COALESCE(v_name, '？'))
    ON CONFLICT (floor) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_first := (v_rows > 0);   -- 1行入った＝サーバーで最初の1人だった
  END IF;

  UPDATE profiles SET
    gold = COALESCE(gold, 0) + v_gold,
    exp  = COALESCE(exp, 0)  + v_exp
  WHERE id = v_pid;

  RETURN json_build_object(
    'ok', true, 'floor', p_floor,
    'first_clear', v_new,          -- そのプレイヤーにとって初クリアか
    'monument', COALESCE(v_first, false), -- 石碑に名前が刻まれたか（サーバー初）
    'gold', v_gold, 'exp', v_exp
  );
END; $$;

-- ============================================================
-- 7. 塔スキルツリー
-- ============================================================
-- 振り分けの保存。段数上限・解放条件・所持ポイントをサーバ側で検証する。
CREATE OR REPLACE FUNCTION tower_tree_set(p_alloc jsonb)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid   uuid;
  v_tp    tower_player%ROWTYPE;
  v_lv    int;
  v_max   int;
  v_sum   int := 0;
  v_key   text;
  v_val   int;
  v_keys  text[] := ARRAY[
    'phys_dmg','mag_dmg','crit_rate','crit_dmg','phys_pen','mag_pen',
    'max_hp','dmg_taken','ail_resist','pct_resist','crit_resist','evasion',
    'spd','mp_cost','kill_heal','ail_rate','exp_plus'
  ];
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND THEN RETURN json_build_object('error', '塔のデータがありません'); END IF;

  v_lv  := tower_level_from_exp(v_tp.tower_exp);
  v_max := tower_max_steps(v_lv);

  FOR v_key, v_val IN SELECT key, value::int FROM jsonb_each_text(p_alloc) LOOP
    IF NOT (v_key = ANY(v_keys)) THEN
      RETURN json_build_object('error', '不明なノードです: ' || v_key);
    END IF;
    IF v_val < 0 THEN RETURN json_build_object('error', '段数が不正です'); END IF;
    IF v_val > v_max THEN
      RETURN json_build_object('error', '塔LVが足りません（現在は1ノード' || v_max || '段まで）');
    END IF;
    v_sum := v_sum + v_val;
  END LOOP;

  IF v_sum > v_lv THEN
    RETURN json_build_object('error', 'ポイントが足りません');
  END IF;

  UPDATE tower_player SET tree_alloc = p_alloc, updated_at = now() WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'spent', v_sum, 'tower_lv', v_lv);
END; $$;

-- 振り直し（Goldを消費して全部戻す）。費用は塔LVに比例。
CREATE OR REPLACE FUNCTION tower_tree_reset()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_tp tower_player%ROWTYPE; v_lv int; v_cost bigint; v_gold bigint;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND THEN RETURN json_build_object('error', '塔のデータがありません'); END IF;

  v_lv   := tower_level_from_exp(v_tp.tower_exp);
  v_cost := 10000::bigint * GREATEST(1, v_lv);

  SELECT COALESCE(gold, 0) INTO v_gold FROM profiles WHERE id = v_pid;
  IF v_gold < v_cost THEN
    RETURN json_build_object('error', 'Goldが足りません', 'cost', v_cost);
  END IF;

  UPDATE profiles SET gold = COALESCE(gold, 0) - v_cost WHERE id = v_pid;
  UPDATE tower_player SET tree_alloc = '{}'::jsonb, updated_at = now() WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'cost', v_cost);
END; $$;

-- 複数敵がいるときの狙い方（スキルセット全体で1つ）
CREATE OR REPLACE FUNCTION tower_set_target_mode(p_mode text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_mode NOT IN ('top','random','hp_high','hp_low') THEN
    RETURN json_build_object('error', '設定が不正です');
  END IF;
  INSERT INTO tower_player (player_id, target_mode) VALUES (v_pid, p_mode)
  ON CONFLICT (player_id) DO UPDATE SET target_mode = p_mode, updated_at = now();
  RETURN json_build_object('ok', true, 'target_mode', p_mode);
END; $$;

-- ============================================================
-- 8. 石碑・到達層ランキング（どちらも全員が見られる）
-- ============================================================
CREATE OR REPLACE FUNCTION get_tower_monument()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'floor', f.floor,
      'username', c.username,
      'cleared_at', c.cleared_at
    ) ORDER BY f.floor), '[]'::json)
    FROM generate_series(10, tower_max_floor(), 10) AS f(floor)
    LEFT JOIN tower_first_clear c ON c.floor = f.floor
  );
END; $$;

CREATE OR REPLACE FUNCTION get_tower_ranking(p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(r), '[]'::json) FROM (
      SELECT p.username, p.avatar_url, t.max_floor, t.max_floor_at
      FROM tower_player t
      JOIN profiles p ON p.id = t.player_id
      WHERE t.max_floor > 0
        AND COALESCE(p.exclude_from_ranking, false) = false
        AND COALESCE(p.is_suspended, false) = false
      -- 到達層の降順 → 同じ層なら到達が早かった順
      ORDER BY t.max_floor DESC, t.max_floor_at ASC NULLS LAST
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) r
  );
END; $$;

-- ============================================================
-- 9. 権限
-- ============================================================
GRANT EXECUTE ON FUNCTION get_tower_status()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_sortie_result(int, boolean, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_start(int, bigint, bigint)      TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_save(int, bigint, bigint)       TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_abort()                         TO authenticated;
GRANT EXECUTE ON FUNCTION tower_boss_clear(int, int, int)           TO authenticated;
GRANT EXECUTE ON FUNCTION tower_tree_set(jsonb)                     TO authenticated;
GRANT EXECUTE ON FUNCTION tower_tree_reset()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_set_target_mode(text)               TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_monument()                      TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_ranking(int)                    TO authenticated;
