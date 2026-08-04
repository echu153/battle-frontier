-- ============================================================
-- エンドレスタワー
-- ------------------------------------------------------------
-- ・現状 is_admin 限定の開発先行。一般公開時の解放条件はキャラLV1000。
-- ・戦闘エリア1の流れ:
--     ① 出撃を (30 + エリア数×10) 回こなす → 強敵が5%で出現するようになる
--     ② 強敵を撃破 → そのエリアのエリアボスに挑戦できる（以降いつでも何度でも）
--     ③ エリアボス挑戦 = 6連戦。HP/MPは連戦中いっさい回復しない（持ち越し）
-- ・HP/MPは「タワー専用プール」。profiles.hp_current/mp_current とは完全に切り離す。
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

-- エリアごとの進捗（出撃カウンタ・強敵撃破・エリアボス撃破）
CREATE TABLE IF NOT EXISTS tower_progress (
  player_id      uuid    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  floor          int     NOT NULL,
  sortie_count   int     NOT NULL DEFAULT 0,   -- そのエリアで出撃した回数（永久保存）
  mid_defeated   boolean NOT NULL DEFAULT false, -- 強敵を倒した＝エリアボスに挑戦できる
  boss_cleared   boolean NOT NULL DEFAULT false, -- エリアボスを倒した＝次のエリアが解放
  first_clear_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, floor)
);
ALTER TABLE tower_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_progress_select_own ON tower_progress;
CREATE POLICY tower_progress_select_own ON tower_progress
  FOR SELECT USING (auth.uid() = player_id);

-- プレイヤーごとのタワーの状態（エンドEXP・エンドレベル・ツリー・進行中の連戦）
-- ※深いエリアの敵HPが天文学的になるため、HPを保存する列はすべて bigint
CREATE TABLE IF NOT EXISTS tower_player (
  player_id     uuid    PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tower_exp     bigint  NOT NULL DEFAULT 0,    -- 累計のエンドEXP
  tree_alloc    jsonb   NOT NULL DEFAULT '{}'::jsonb, -- {ノードkey: 段数}
  target_mode   text    NOT NULL DEFAULT 'top',-- 複数敵がいるときの狙い方 top/random/hp_high/hp_low
  max_floor     int     NOT NULL DEFAULT 0,    -- 到達エリア（ランキング用。エリアボスを倒した最高層）
  max_floor_at  timestamptz,                   -- その到達エリアに初めて到達した時刻（同率のタイブレーク）
  -- 進行中のエリアボス連戦（中断してもここから再開する。抜け道を塞ぐためHPごと保存）
  run_floor     int,                           -- NULL = 連戦していない
  run_stage     int     NOT NULL DEFAULT 0,    -- 0..5（BOSS_RUN_STAGES の添字）
  run_hp        bigint,
  run_mp        bigint,
  run_potion    int     NOT NULL DEFAULT 0,  -- この連戦で無限ポーションを使った回数（上限2回）
  run_started_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- 既存のテーブルには CREATE TABLE IF NOT EXISTS では列が足されないので明示的に足す
ALTER TABLE tower_player ADD COLUMN IF NOT EXISTS run_potion int NOT NULL DEFAULT 0;
-- 1戦の開始を宣言したがまだ結果が返っていない（通信を切って敗北を消す抜け道を塞ぐ）
ALTER TABLE tower_player ADD COLUMN IF NOT EXISTS run_pending boolean NOT NULL DEFAULT false;
ALTER TABLE tower_player ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_player_select_own ON tower_player;
CREATE POLICY tower_player_select_own ON tower_player
  FOR SELECT USING (auth.uid() = player_id);

-- 石碑：エリアボスのサーバー初討伐者（10エリアごとの節目だけ記録）
CREATE TABLE IF NOT EXISTS tower_first_clear (
  floor       int  PRIMARY KEY,                -- ユニーク制約で最初のINSERTだけが通る
  -- ★2026-08-04: profiles への外部キーは張らない。ON DELETE CASCADE だと
  --   退会で石碑の行ごと消えてしまい、「名前を焼き込む」意味が無かった。
  player_id   uuid,
  username    text NOT NULL,                   -- 改名・退会後も石碑に残すため名前を焼き込む
  cleared_at  timestamptz NOT NULL DEFAULT now()
);
-- 既存環境の作り直し（外部キーを外し、退会しても石碑に名前が残るようにする）
ALTER TABLE tower_first_clear DROP CONSTRAINT IF EXISTS tower_first_clear_player_id_fkey;
ALTER TABLE tower_first_clear ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE tower_first_clear ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tower_first_clear_select_all ON tower_first_clear;
CREATE POLICY tower_first_clear_select_all ON tower_first_clear
  FOR SELECT USING (true);   -- 石碑は全員が見られる

-- ============================================================
-- 1.5 監査ログ（エリアボス撃破と不審な呼び出しだけ残す）
-- ============================================================
CREATE TABLE IF NOT EXISTS tower_logs (
  id         bigserial PRIMARY KEY,
  player_id  uuid NOT NULL,
  kind       text NOT NULL,          -- boss_clear | suspicious
  floor      int,
  gold       bigint,
  exp        int,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tower_logs ENABLE ROW LEVEL SECURITY;
-- 閲覧は運営のみ（RLSポリシーを作らない＝一般クライアントからは読めない）
CREATE INDEX IF NOT EXISTS tower_logs_player_idx ON tower_logs (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tower_logs_kind_idx   ON tower_logs (kind, created_at DESC);

CREATE OR REPLACE FUNCTION tower_log(p_uid uuid, p_kind text, p_floor int, p_gold bigint, p_exp int, p_detail text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_recent boolean;
BEGIN
  -- 不審な呼び出しは連打できるので、同じプレイヤーぶんは1分に1件までに絞る
  -- （ログを膨らませること自体を攻撃に使われないようにする）
  IF p_kind = 'suspicious' THEN
    SELECT true INTO v_recent FROM tower_logs
      WHERE player_id = p_uid AND kind = 'suspicious' AND created_at > now() - interval '1 minute'
      LIMIT 1;
    IF COALESCE(v_recent, false) THEN RETURN; END IF;
  END IF;
  INSERT INTO tower_logs (player_id, kind, floor, gold, exp, detail)
  VALUES (p_uid, p_kind, p_floor, p_gold, p_exp, p_detail);
EXCEPTION WHEN OTHERS THEN NULL;   -- ログの失敗で本処理を止めない
END; $$;

CREATE OR REPLACE FUNCTION tower_hp_cap(p_uid uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_p profiles%ROWTYPE; v_raw text; v_steps int := 0; v_base bigint;
BEGIN
  SELECT * INTO v_p FROM profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- 街の invalid_hp 判定と同じ考え方（実効最大を信頼しつつ基礎の5倍でガード）
  v_base := LEAST(GREATEST(COALESCE(v_p.eff_hp_max, v_p.hp_max), v_p.hp_max), v_p.hp_max * 5);
  SELECT tree_alloc->>'max_hp' INTO v_raw FROM tower_player WHERE player_id = p_uid;
  IF v_raw ~ '^[0-9]+$' THEN v_steps := LEAST(50, v_raw::int); END IF;   -- 最大HP+は1段1%
  RETURN GREATEST(1, (v_base * (100 + v_steps) / 100)::bigint);
END; $$;

CREATE OR REPLACE FUNCTION tower_mp_cap(p_uid uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_mp bigint;
BEGIN
  SELECT GREATEST(1, COALESCE(mp_max, 1) * 5) INTO v_mp FROM profiles WHERE id = p_uid;
  RETURN COALESCE(v_mp, 1);
END; $$;

CREATE OR REPLACE FUNCTION tower_run_begin()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_tp tower_player%ROWTYPE; v_block text;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;

  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND OR v_tp.run_floor IS NULL THEN
    RETURN json_build_object('error', '進行中の連戦がありません');
  END IF;
  IF v_tp.run_pending THEN
    -- 前の戦闘の結果が返っていない＝離脱した扱いで連戦を終わらせる
    UPDATE tower_player SET run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
           run_potion = 0, run_pending = false, run_started_at = NULL, updated_at = now()
      WHERE player_id = v_pid;
    PERFORM tower_log(v_pid, 'suspicious', v_tp.run_floor, NULL, NULL, '戦闘の結果が返らないまま再開しようとした');
    RETURN json_build_object('error', '前の戦闘が中断されたため、連戦は最初からになります', 'aborted', true);
  END IF;

  UPDATE tower_player SET run_pending = true, updated_at = now() WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'stage', v_tp.run_stage);
END; $$;

-- ============================================================
-- 2. 定数（クライアントの src/lib/tower.js と必ず一致させること）
-- ============================================================
-- いま挑戦できる最大の層。データは10層ぶんあるが、5層以降はボスが想定より弱く
-- 調整中のため一時的に閉じている（2026-08-04）。調整が終わったら 10 に戻す。
-- ⚠クライアントの OPEN_MAX_FLOOR と必ず同じ値にすること。
CREATE OR REPLACE FUNCTION tower_max_floor() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;

CREATE OR REPLACE FUNCTION tower_sorties_to_mid(p_floor int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 + p_floor * 10 $$;

-- 出撃1回で得られるエンドEXP（20〜30のランダム・2026-08-03確定）
-- ⚠ 乱数なので、1回の処理の中で複数回呼ばない（呼ぶたび違う値になる）。
--   必ず変数に受けてから使うこと。
CREATE OR REPLACE FUNCTION tower_sortie_tower_exp() RETURNS int
LANGUAGE sql VOLATILE AS $$ SELECT 20 + floor(random() * 11)::int $$;

-- エリアボス撃破で得られるエンドEXP。初回だけ1000、2回目以降は出撃と同じ
CREATE OR REPLACE FUNCTION tower_boss_tower_exp(p_first boolean) RETURNS int
LANGUAGE sql VOLATILE AS $$
  SELECT CASE WHEN p_first THEN 1000 ELSE tower_sortie_tower_exp() END
$$;

-- エンドレベル lv → lv+1 に必要なエンドEXP = 50 × lv（2026-08-03変更・直線）
-- 2026-08-04: 段数解放はLV350で打ち止めなので、LV400以降は一定（50×400=20,000）にする。
CREATE OR REPLACE FUNCTION tower_exp_to_next(p_lv int) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT (50::bigint * LEAST(p_lv, 400)) $$;

-- 累計エンドEXPからエンドレベルを求める（上限850＝全17ノードを50段まで埋め切れる値）
CREATE OR REPLACE FUNCTION tower_level_from_exp(p_exp bigint) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_lv int := 1; v_rest bigint := COALESCE(p_exp, 0);
BEGIN
  WHILE v_lv < 850 AND v_rest >= tower_exp_to_next(v_lv) LOOP
    v_rest := v_rest - tower_exp_to_next(v_lv);
    v_lv := v_lv + 1;
  END LOOP;
  RETURN v_lv;
END; $$;

-- エンドレベルで1ノードに振れる最大段数（10段ごとに解放・上限50段）
CREATE OR REPLACE FUNCTION tower_max_steps(p_lv int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lv >= 350 THEN 50
    WHEN p_lv >= 200 THEN 40
    WHEN p_lv >= 100 THEN 30
    WHEN p_lv >=  50 THEN 20
    ELSE 10 END
$$;

-- エンドレスタワーに入れるか（2026-08-04 一般公開・解放条件はキャラクターLV1000）
-- ⚠ここを変えたら クライアントの src/lib/tower.js の TOWER_UNLOCK_CHAR_LV も合わせること
CREATE OR REPLACE FUNCTION tower_can_enter(p_profile profiles) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_profile.is_admin, false) OR COALESCE(p_profile.char_lv, 1) >= 1000
$$;

-- エンドレスタワーで行動できない状態なら理由を返す（行動できるなら NULL）
-- 条件は街の出撃とまったく同じ: 釣り中／かかし修練中／ペットダンジョン探索中(中断中を除く)
CREATE OR REPLACE FUNCTION tower_idle_block(p_uid uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_flag boolean; v_country uuid;
BEGIN
  SELECT COALESCE(is_fishing, false) INTO v_flag FROM profiles WHERE id = p_uid;
  IF COALESCE(v_flag, false) THEN
    RETURN '🎣 釣り中はタワーに入れません。先に釣りを終了してください。';
  END IF;

  v_flag := NULL;
  SELECT true INTO v_flag FROM scarecrow_sessions
    WHERE player_id = p_uid AND status = 'active' AND ends_at > now() LIMIT 1;
  IF COALESCE(v_flag, false) THEN
    RETURN '🌾 かかし修練中はタワーに入れません。修練が終わるまで待ちましょう。';
  END IF;

  v_flag := NULL;
  SELECT true INTO v_flag FROM dungeon_runs
    WHERE owner_id = p_uid AND status = 'active' AND COALESCE(suspended, false) = false LIMIT 1;
  IF COALESCE(v_flag, false) THEN
    RETURN '🕳 ダンジョン探索中はタワーに入れません。中断するか終えてからにしましょう。';
  END IF;

  -- ★2026-08-04追加: 戦争中は街の出撃ができないので、タワーも同じく入れない
  BEGIN
    SELECT country_id INTO v_country FROM profiles WHERE id = p_uid;
    IF v_country IS NOT NULL THEN
      v_flag := NULL;
      SELECT true INTO v_flag FROM wars
        WHERE status = 'active'
          AND (attacker_country_id = v_country OR defender_country_id = v_country)
        LIMIT 1;
      IF COALESCE(v_flag, false) THEN
        RETURN '⚔ 戦争中はタワーに入れません。';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;   -- 戦争SQL未適用の環境では判定しない
  END;

  RETURN NULL;
END; $$;

-- Goldは層と初回かどうかだけで決まるので、クライアントの申告を受け取らず
-- サーバーが計算する。これで改ざんの余地そのものが無くなる。
--   出撃    : エリア数×300（強敵に当たっても同額）
--   エリアボス撃破: 初回だけエリア数×100万、2回目以降は出撃と同じエリア数×300
CREATE OR REPLACE FUNCTION tower_sortie_gold(p_floor int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT GREATEST(0, p_floor) * 300 $$;

CREATE OR REPLACE FUNCTION tower_boss_gold(p_floor int, p_first boolean) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_first
    THEN GREATEST(0, p_floor) * 1000000
    ELSE tower_sortie_gold(p_floor) END
$$;

-- 旧: 申告Goldの上限チェック用。サーバー計算に変えたので不要
DROP FUNCTION IF EXISTS tower_gold_cap(int, boolean);

-- 通常EXPも街の出撃とまったく同じ量にする（2026-08-03確定）。Goldと同じくサーバーが決める。
--   雑魚 : 20秒モード 8〜11 / 10秒モード 5〜6
--   ボス : 20秒モード 13    / 10秒モード 7       （強敵・エリアボス）
--   キャラLV100未満は1.5倍（街と同じ）
--   さらにエンドポイント「取得経験値+1の確率」で +1（1段0.5%・最大50段=25%）
CREATE OR REPLACE FUNCTION tower_battle_exp(p_uid uuid, p_is_boss boolean) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_ten   boolean;
  v_exp   int;
  v_raw   text;
  v_steps int := 0;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_ten := COALESCE(v_profile.sortie_mode, 20) = 10;

  IF p_is_boss THEN
    v_exp := CASE WHEN v_ten THEN 7 ELSE 13 END;
  ELSE
    v_exp := CASE WHEN v_ten THEN 5 + floor(random() * 2)::int
                  ELSE 8 + floor(random() * 4)::int END;
  END IF;

  IF COALESCE(v_profile.char_lv, 1) < 100 THEN v_exp := floor(v_exp * 1.5); END IF;

  -- ツリーの「取得経験値+1の確率」。tree_alloc は jsonb なので数値以外が入りうる
  SELECT tree_alloc->>'exp_plus' INTO v_raw FROM tower_player WHERE player_id = p_uid;
  IF v_raw ~ '^[0-9]+$' THEN v_steps := LEAST(50, v_raw::int); END IF;
  IF v_steps > 0 AND random() < v_steps * 0.005 THEN v_exp := v_exp + 1; END IF;

  RETURN v_exp;
END; $$;

-- ------------------------------------------------------------
-- Gold と 通常EXP の付与（街の出撃と同じ扱い）
--  ⚠ profiles.exp は protect_stats の保護列なので、
--    set_config('app.allow_stat_change','on',true) を立てないと
--    「不正な操作です（ステータスはサーバ経由でのみ変更できます）」で弾かれる。
--  ⚠ EXPを足すだけではレベルが上がらないので、出撃と同じ繰り上がり処理を行う。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tower_grant_rewards(p_uid uuid, p_gold int, p_exp int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_profile  profiles%ROWTYPE;
  v_frozen   boolean;
  v_class_lv int;
  v_cap      int;
  v_new_exp  int; v_new_lv int; v_new_next int; v_new_pending int; v_new_char_lv int;
BEGIN
  -- ★他人ぶん／外部からの直接呼び出しを拒否する。
  --   タワーのRPCから呼ばれる場合、auth.uid() は呼び出したプレイヤー自身なので必ず一致する。
  IF auth.uid() IS NOT NULL AND p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '不正な操作です';
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- ★保護トリガー許可

  IF COALESCE(p_gold, 0) > 0 THEN
    UPDATE profiles SET gold = COALESCE(gold, 0) + p_gold WHERE id = p_uid;
  END IF;

  IF COALESCE(p_exp, 0) <= 0 THEN RETURN; END IF;

  -- EXP凍結中／クラスLVが上限のときは通常EXPを入れない（出撃と同じ）
  v_frozen := COALESCE(v_profile.exp_frozen, false)
    OR (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = p_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := public.class_level_cap(v_profile.class, v_profile.retraining);
  IF v_frozen OR v_class_lv >= v_cap THEN RETURN; END IF;

  v_new_exp      := COALESCE(v_profile.exp, 0) + p_exp;
  v_new_lv       := v_profile.lv;
  v_new_next     := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);
  WHILE v_new_exp >= v_new_next AND v_new_lv < v_cap LOOP
    v_new_exp     := v_new_exp - v_new_next;
    v_new_lv      := v_new_lv + 1;
    v_new_next    := calc_exp_next(v_new_lv);
    v_new_pending := v_new_pending + 1;
    v_new_char_lv := v_new_char_lv + 1;
  END LOOP;
  IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_next := calc_exp_next(v_cap); END IF;

  UPDATE profiles SET
    exp = v_new_exp, exp_next = v_new_next, lv = v_new_lv,
    pending_stat_points = v_new_pending, char_lv = v_new_char_lv
  WHERE id = p_uid;
  UPDATE class_levels SET lv = v_new_lv, exp = v_new_exp
    WHERE player_id = p_uid AND class_name = v_profile.class;
END; $$;

-- クライアントが戦闘を始める前に確認するための入口（権威は各RPC側の同じチェック）
CREATE OR REPLACE FUNCTION tower_can_act() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_block text;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;
  RETURN json_build_object('ok', true);
END; $$;

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
  v_dropped boolean := false;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT FOUND THEN RETURN json_build_object('error', 'プロフィールがありません'); END IF;
  IF NOT tower_can_enter(v_profile) THEN
    RETURN json_build_object('error', 'まだエンドレスタワーには入れません', 'locked', true);
  END IF;

  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND THEN
    INSERT INTO tower_player (player_id) VALUES (v_pid)
      ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  END IF;

  -- 閉じた層（調整中）で進行中の連戦は畳む。入口を塞いでも途中の連戦だけ残ると詰まるため。
  IF v_tp.run_floor IS NOT NULL AND v_tp.run_floor > tower_max_floor() THEN
    UPDATE tower_player SET run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
           run_potion = 0, run_pending = false, run_started_at = NULL, updated_at = now()
      WHERE player_id = v_pid;
    SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
    v_dropped := true;
  END IF;

  -- ★B-3: 戦闘を宣言したまま結果が返っていない＝離脱。連戦は失敗として畳む。
  IF v_tp.run_floor IS NOT NULL AND COALESCE(v_tp.run_pending, false) THEN
    UPDATE tower_player SET run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
           run_potion = 0, run_pending = false, run_started_at = NULL, updated_at = now()
      WHERE player_id = v_pid;
    SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
    v_dropped := true;
  END IF;

  v_lv := tower_level_from_exp(v_tp.tower_exp);
  v_used := 0;
  FOR v_i IN 1 .. (v_lv - 1) LOOP v_used := v_used + tower_exp_to_next(v_i); END LOOP;

  SELECT COALESCE(json_agg(json_build_object(
    'floor',        f.floor,
    'sortie_count', COALESCE(p.sortie_count, 0),
    'need',         tower_sorties_to_mid(f.floor),
    'mid_defeated', COALESCE(p.mid_defeated, false),
    'boss_cleared', COALESCE(p.boss_cleared, false),
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
    'run_dropped', v_dropped,
    'last_action_at', v_profile.last_action_at,
    -- ★残りクールダウンは秒数でサーバーが返す。
    --   端末の時計が数秒進んでいると、クライアント側で now() と引き算した瞬間に
    --   「もう出撃できる」と誤表示され、押した先でサーバーに弾かれていた。
    'cd_left', GREATEST(0, EXTRACT(EPOCH FROM (
      COALESCE(v_profile.last_action_at, now() - interval '1 day')
      + make_interval(secs => CASE WHEN COALESCE(v_profile.sortie_mode, 20) = 10 THEN 10 ELSE 20 END)
      - now()))),
    'wait',        CASE WHEN COALESCE(v_profile.sortie_mode, 20) = 10 THEN 10 ELSE 20 END,
    'run', CASE WHEN v_tp.run_floor IS NULL THEN NULL ELSE json_build_object(
      'floor', v_tp.run_floor, 'stage', v_tp.run_stage,
      'hp', v_tp.run_hp, 'mp', v_tp.run_mp, 'potion', COALESCE(v_tp.run_potion, 0), 'started_at', v_tp.run_started_at
    ) END,
    'floors',      v_floors
  );
END; $$;

-- ============================================================
-- 4. 出撃の結果を反映
--    p_won        : 勝ったか
--    p_mid_defeat : この出撃で強敵を倒したか
--    p_gold       : 使わない（Goldはサーバーが決める。互換のため引数だけ残してある）
--    p_exp        : 使わない（EXPもサーバーが決める。互換のため引数だけ残してある）
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
  v_texp    int;
  v_block   text;
  v_run     int;
  v_wait    int;
  v_locked  int := 0;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > tower_max_floor() THEN
    RETURN json_build_object('error', 'エリアが不正です');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT tower_can_enter(v_profile) THEN
    RETURN json_build_object('error', 'まだエンドレスタワーには入れません');
  END IF;
  -- 街の出撃と同じ排他（釣り／かかし／ペットダンジョン／戦争）
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;

  -- ★B-4: 連戦の途中は通常出撃できない（クライアントのボタン制御だけでは別タブから抜けられた）
  SELECT run_floor INTO v_run FROM tower_player WHERE player_id = v_pid;
  IF v_run IS NOT NULL THEN
    RETURN json_build_object('error', '連戦中は出撃できません');
  END IF;

  -- そのエリアが解放されているか
  IF p_floor > 1 THEN
    SELECT COALESCE(boss_cleared, false) INTO v_prev
      FROM tower_progress WHERE player_id = v_pid AND floor = p_floor - 1;
    IF NOT COALESCE(v_prev, false) THEN
      RETURN json_build_object('error', 'このエリアはまだ解放されていません');
    END IF;
  END IF;

  -- ★C-1: クールダウンをサーバーで確保する（街と同じ 20秒／10秒モードは10秒）。
  --   条件付きUPDATEなので、同時に何本投げても1本しか通らない。
  v_wait := CASE WHEN COALESCE(v_profile.sortie_mode, 20) = 10 THEN 10 ELSE 20 END;
  WITH upd AS (
    UPDATE profiles SET last_action_at = now()
     WHERE id = v_pid
       -- 0.5秒の猶予。境目ちょうどで押したときに往復遅延や丸めで弾かれるのを防ぐ
       AND (last_action_at IS NULL OR last_action_at <= now() - make_interval(secs => v_wait) + interval '0.5 second')
     RETURNING 1
  ) SELECT count(*) INTO v_locked FROM upd;
  IF v_locked = 0 THEN
    RETURN json_build_object('error', 'まだ出撃できません（クールダウン中）', 'cooldown', true,
      'retry_after', GREATEST(0, EXTRACT(EPOCH FROM
        (COALESCE(v_profile.last_action_at, now()) + make_interval(secs => v_wait) - now()))));
  END IF;

  -- Gold・EXPともサーバーが決める（p_gold / p_exp は受け取らない＝改ざんできない）
  v_gold := tower_sortie_gold(p_floor);
  v_exp  := tower_battle_exp(v_pid, COALESCE(p_mid_defeat, false));

  INSERT INTO tower_progress (player_id, floor, sortie_count)
    VALUES (v_pid, p_floor, 1)
  ON CONFLICT (player_id, floor) DO UPDATE
    SET sortie_count = tower_progress.sortie_count + 1, updated_at = now()
  RETURNING sortie_count INTO v_cnt;

  v_need := tower_sorties_to_mid(p_floor);

  IF p_mid_defeat AND p_won AND v_cnt >= v_need THEN
    UPDATE tower_progress SET mid_defeated = true, updated_at = now()
      WHERE player_id = v_pid AND floor = p_floor;
  END IF;

  v_texp := tower_sortie_tower_exp();
  INSERT INTO tower_player (player_id, tower_exp) VALUES (v_pid, v_texp)
  ON CONFLICT (player_id) DO UPDATE
    SET tower_exp = tower_player.tower_exp + v_texp, updated_at = now();

  IF p_won AND (v_gold > 0 OR v_exp > 0) THEN
    PERFORM tower_grant_rewards(v_pid, v_gold, v_exp);
  END IF;

  RETURN json_build_object(
    'sortie_count', v_cnt,
    'need',         v_need,
    'mid_open',     (v_cnt >= v_need),
    'gold',         CASE WHEN p_won THEN v_gold ELSE 0 END,
    'exp',          CASE WHEN p_won THEN v_exp ELSE 0 END,
    'tower_exp',    v_texp,
    'wait',         v_wait
  );
END; $$;

-- ============================================================
-- 5. エリアボス連戦：開始 / 進行の保存 / 破棄
--    中断してもHPごとサーバーに残るので「離脱して回復して戻る」抜け道がない。
-- ============================================================
CREATE OR REPLACE FUNCTION tower_run_start(p_floor int, p_hp bigint, p_mp bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid uuid; v_profile profiles%ROWTYPE; v_mid boolean; v_prev boolean; v_block text;
  v_hp bigint; v_mp bigint;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_pid;
  IF NOT tower_can_enter(v_profile) THEN RETURN json_build_object('error', 'まだエンドレスタワーには入れません'); END IF;
  IF p_floor < 1 OR p_floor > tower_max_floor() THEN RETURN json_build_object('error', 'エリアが不正です'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;

  IF p_floor > 1 THEN
    SELECT COALESCE(boss_cleared, false) INTO v_prev
      FROM tower_progress WHERE player_id = v_pid AND floor = p_floor - 1;
    IF NOT COALESCE(v_prev, false) THEN RETURN json_build_object('error', 'このエリアはまだ解放されていません'); END IF;
  END IF;

  SELECT COALESCE(mid_defeated, false) INTO v_mid
    FROM tower_progress WHERE player_id = v_pid AND floor = p_floor;
  IF NOT COALESCE(v_mid, false) THEN
    RETURN json_build_object('error', 'まず強敵を倒してください');
  END IF;

  -- ★C-2: 申告値をそのまま信じない
  v_hp := LEAST(GREATEST(COALESCE(p_hp, 0), 0), tower_hp_cap(v_pid));
  v_mp := LEAST(GREATEST(COALESCE(p_mp, 0), 0), tower_mp_cap(v_pid));

  INSERT INTO tower_player (player_id, run_floor, run_stage, run_hp, run_mp, run_potion, run_pending, run_started_at)
    VALUES (v_pid, p_floor, 0, v_hp, v_mp, 0, false, now())
  ON CONFLICT (player_id) DO UPDATE
    SET run_floor = p_floor, run_stage = 0,
        run_hp = v_hp, run_mp = v_mp, run_potion = 0, run_pending = false,
        run_started_at = now(), updated_at = now();

  RETURN json_build_object('ok', true, 'floor', p_floor, 'stage', 0, 'hp', v_hp, 'mp', v_mp);
END; $$;

-- 1戦終えるごとに呼ぶ（HP/MPを持ち越したままステージを進める）
-- 旧シグネチャ（3引数）は残すと呼び出しが曖昧になるので落とす
DROP FUNCTION IF EXISTS tower_run_save(int, bigint, bigint);

CREATE OR REPLACE FUNCTION tower_run_save(p_stage int, p_hp bigint, p_mp bigint, p_potion int DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_tp tower_player%ROWTYPE; v_block text; v_hp bigint; v_mp bigint;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;
  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND OR v_tp.run_floor IS NULL THEN
    RETURN json_build_object('error', '進行中の連戦がありません');
  END IF;

  -- ★A-2: ステージは必ず1つずつしか進めない
  IF p_stage IS DISTINCT FROM v_tp.run_stage + 1 THEN
    PERFORM tower_log(v_pid, 'suspicious', v_tp.run_floor, NULL, NULL,
      format('ステージ飛ばし: %s → %s', v_tp.run_stage, p_stage));
    RETURN json_build_object('error', 'ステージが不正です');
  END IF;
  -- 最終ステージ（添字5）の次は無い。撃破は tower_boss_clear で確定する。
  IF p_stage > 5 THEN
    RETURN json_build_object('error', 'ステージが不正です');
  END IF;

  v_hp := LEAST(GREATEST(COALESCE(p_hp, 0), 0), tower_hp_cap(v_pid));
  v_mp := LEAST(GREATEST(COALESCE(p_mp, 0), 0), tower_mp_cap(v_pid));

  UPDATE tower_player
    SET run_stage = p_stage, run_hp = v_hp, run_mp = v_mp,
        -- 無限ポーションの使用回数は減らせない（リロードで上限を戻す抜け道を塞ぐ）
        run_potion = GREATEST(COALESCE(run_potion, 0), LEAST(GREATEST(COALESCE(p_potion, 0), 0), 99)),
        run_pending = false,
        updated_at = now()
    WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'stage', p_stage, 'hp', v_hp, 'mp', v_mp);
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
        run_potion = 0, run_pending = false, run_started_at = NULL, updated_at = now()
    WHERE player_id = v_pid;
  RETURN json_build_object('ok', true);
END; $$;

-- ============================================================
-- 6. エリアボス撃破
--    連戦の最終ステージまで進んでいることをサーバ側で検証してから確定する。
-- ============================================================
CREATE OR REPLACE FUNCTION tower_boss_clear(p_floor int, p_gold int DEFAULT 0, p_exp int DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pid    uuid;
  v_name   text;
  v_first  boolean := false;
  v_rows   int := 0;
  v_claim  int := 0;
  v_gold   int;
  v_exp    int;
  v_texp   int;
  v_new    boolean := false;
  v_block  text;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;

  -- 初クリアかどうか（Goldの額がこれで変わるので先に判定する）
  SELECT NOT COALESCE(boss_cleared, false) INTO v_new
    FROM tower_progress WHERE player_id = v_pid AND floor = p_floor;
  v_new := COALESCE(v_new, true);
  v_texp := tower_boss_tower_exp(v_new);

  -- ★A-3: ここで連戦を「取り切る」。条件を満たす行が無ければ何も起きない＝報酬も出ない。
  WITH upd AS (
    UPDATE tower_player
       SET max_floor    = GREATEST(COALESCE(max_floor, 0), p_floor),
           max_floor_at = CASE WHEN p_floor > COALESCE(max_floor, 0) THEN now() ELSE max_floor_at END,
           tower_exp    = tower_exp + v_texp,
           run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
           run_potion = 0, run_pending = false, run_started_at = NULL,
           updated_at = now()
     WHERE player_id = v_pid
       AND run_floor = p_floor
       AND run_stage >= 5      -- 6戦目（添字5）まで進んでいなければ倒せるはずがない
     RETURNING 1
  ) SELECT count(*) INTO v_claim FROM upd;

  IF v_claim = 0 THEN
    PERFORM tower_log(v_pid, 'suspicious', p_floor, NULL, NULL, '連戦が成立していないのに撃破を申告した');
    RETURN json_build_object('error', 'このエリアの連戦が最後まで進んでいません');
  END IF;

  v_gold := tower_boss_gold(p_floor, v_new);
  v_exp  := tower_battle_exp(v_pid, true);

  INSERT INTO tower_progress (player_id, floor, boss_cleared, first_clear_at)
    VALUES (v_pid, p_floor, true, now())
  ON CONFLICT (player_id, floor) DO UPDATE
    SET boss_cleared = true,
        first_clear_at = COALESCE(tower_progress.first_clear_at, now()),
        updated_at = now();

  -- 石碑：最初の1つは10層。それ以降は1層ごとに、その層を最初に踏破した1人を記録する。
  IF p_floor >= 10 THEN
    SELECT username INTO v_name FROM profiles WHERE id = v_pid;
    INSERT INTO tower_first_clear (floor, player_id, username)
      VALUES (p_floor, v_pid, COALESCE(v_name, '？'))
    ON CONFLICT (floor) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_first := (v_rows > 0);
  END IF;

  PERFORM tower_grant_rewards(v_pid, v_gold, v_exp);
  PERFORM tower_log(v_pid, 'boss_clear', p_floor, v_gold, v_exp,
    CASE WHEN v_new THEN '初回踏破' ELSE '周回' END);

  RETURN json_build_object(
    'ok', true, 'floor', p_floor,
    'first_clear', v_new,
    'monument', COALESCE(v_first, false),
    'gold', v_gold, 'exp', v_exp, 'tower_exp', v_texp
  );
END; $$;

-- ============================================================
-- 7. エンドポイント
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
  IF NOT FOUND THEN RETURN json_build_object('error', 'エンドレスタワーのデータがありません'); END IF;

  v_lv  := tower_level_from_exp(v_tp.tower_exp);
  v_max := tower_max_steps(v_lv);

  FOR v_key, v_val IN SELECT key, value::int FROM jsonb_each_text(p_alloc) LOOP
    IF NOT (v_key = ANY(v_keys)) THEN
      RETURN json_build_object('error', '不明なノードです: ' || v_key);
    END IF;
    IF v_val < 0 THEN RETURN json_build_object('error', '段数が不正です'); END IF;
    IF v_val > v_max THEN
      RETURN json_build_object('error', 'エンドレベルが足りません（現在は1ノード' || v_max || '段まで）');
    END IF;
    v_sum := v_sum + v_val;
  END LOOP;

  IF v_sum > v_lv THEN
    RETURN json_build_object('error', 'ポイントが足りません');
  END IF;

  UPDATE tower_player SET tree_alloc = p_alloc, updated_at = now() WHERE player_id = v_pid;
  RETURN json_build_object('ok', true, 'spent', v_sum, 'tower_lv', v_lv);
END; $$;

-- 振り直し（Goldを消費して全部戻す）。費用はエンドレベルに比例。
CREATE OR REPLACE FUNCTION tower_tree_reset()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pid uuid; v_tp tower_player%ROWTYPE; v_lv int; v_cost bigint; v_gold bigint;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND THEN RETURN json_build_object('error', 'エンドレスタワーのデータがありません'); END IF;

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
-- 8. 石碑・到達エリアランキング（どちらも全員が見られる）
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
    FROM generate_series(10, tower_max_floor(), 1) AS f(floor)
    LEFT JOIN tower_first_clear c ON c.floor = f.floor
  );
END; $$;

CREATE OR REPLACE FUNCTION get_tower_ranking(p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(r), '[]'::json) FROM (
      SELECT p.id, p.username, p.avatar_url, p.class, p.lv, p.char_lv, p.retraining,
             t.max_floor, t.max_floor_at
      FROM tower_player t
      JOIN profiles p ON p.id = t.player_id
      WHERE t.max_floor > 0
        AND COALESCE(p.exclude_from_ranking, false) = false
        AND COALESCE(p.is_suspended, false) = false
      -- 到達エリアの降順 → 同じエリアなら到達が早かった順
      ORDER BY t.max_floor DESC, t.max_floor_at ASC NULLS LAST
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) r
  );
END; $$;

-- 旧: エンドEXP固定100。20〜30の乱数（tower_sortie_tower_exp）に変えたので不要
DROP FUNCTION IF EXISTS tower_exp_per_sortie();

-- ============================================================
-- 9. 権限
-- ============================================================
-- ★内部ヘルパは外から直接呼べないようにする。
--   PostgreSQL は新規関数の EXECUTE を既定で PUBLIC に与えるため、これが無いと
--   tower_grant_rewards(自分のuuid, 0, 20億) のような直接呼び出しが通ってしまう。
REVOKE ALL ON FUNCTION public.tower_grant_rewards(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_idle_block(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_battle_exp(uuid, boolean)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_hp_cap(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_mp_cap(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_log(uuid, text, int, bigint, int, text) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_grant_rewards(uuid, int, int) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_idle_block(uuid) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_battle_exp(uuid, boolean) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_hp_cap(uuid) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_mp_cap(uuid) FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

GRANT EXECUTE ON FUNCTION tower_run_begin()                         TO authenticated;
GRANT EXECUTE ON FUNCTION tower_can_act()                           TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_status()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_sortie_result(int, boolean, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_start(int, bigint, bigint)      TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_save(int, bigint, bigint, int)  TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_abort()                         TO authenticated;
GRANT EXECUTE ON FUNCTION tower_boss_clear(int, int, int)           TO authenticated;
GRANT EXECUTE ON FUNCTION tower_tree_set(jsonb)                     TO authenticated;
GRANT EXECUTE ON FUNCTION tower_tree_reset()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_set_target_mode(text)               TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_monument()                      TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_ranking(int)                    TO authenticated;
