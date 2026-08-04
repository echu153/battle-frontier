-- ============================================================
-- エンドレスタワー：公開前の穴埋め（2026-08-04）
-- ------------------------------------------------------------
-- 監査で見つかった A（重大3件）／B（仕様の穴4件）／C（サーバー権威の強化3件）を
-- まとめて塞ぐ。supabase_tower.sql 本体にも同じ内容を反映済みなので、
-- 本体を丸ごと流し直しても同じ結果になる。
--
-- ⚠ apply_battle_result / apply_dungeon_reward は一切触らないので、
--   「mutant_gold_20260703.sql を最後に」の鉄則には抵触しない。
-- ⚠ 何度流しても安全（作り直し・条件付きのみ）。
--
-- 【この後にクライアント側の変更も必要】
--   ・出撃CDの確保がサーバー側に移るので、Tower.jsx の先行UPDATEを外す
--   ・連戦の各戦の前に tower_run_begin() を呼ぶ
--   （どちらも同コミットで対応済み）
-- ============================================================

-- ============================================================
-- C-3. 監査ログ（エリアボス撃破と、不審な呼び出しを残す）
--      出撃は件数が多すぎるので記録しない。100万G単位が動く撃破だけを残す。
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
BEGIN
  INSERT INTO tower_logs (player_id, kind, floor, gold, exp, detail)
  VALUES (p_uid, p_kind, p_floor, p_gold, p_exp, p_detail);
EXCEPTION WHEN OTHERS THEN NULL;   -- ログの失敗で本処理を止めない
END; $$;

-- ============================================================
-- B-1. 石碑：退会しても名前を残す
--      ON DELETE CASCADE のままだと退会で行ごと消え、
--      「名前を焼き込む」という設計意図が成立していなかった。
-- ============================================================
ALTER TABLE tower_first_clear DROP CONSTRAINT IF EXISTS tower_first_clear_player_id_fkey;
ALTER TABLE tower_first_clear ALTER COLUMN player_id DROP NOT NULL;

-- ============================================================
-- B-3 / C-2 用の列
--   run_pending : 1戦分の戦闘を開始したがまだ結果が返っていない
--                 （＝通信を切って敗北を無かったことにする抜け道を塞ぐ）
-- ============================================================
ALTER TABLE tower_player ADD COLUMN IF NOT EXISTS run_pending boolean NOT NULL DEFAULT false;

-- ============================================================
-- A-1. 内部ヘルパを外から直接呼べないようにする
--   PostgreSQL は新規関数の EXECUTE を既定で PUBLIC に与えるため、
--   REVOKE していないと tower_grant_rewards(自分のuuid, 0, 20億) が通ってしまう。
--   （この関数は protect_stats を自分で解除するので、EXP/LV/ステポが任意に取れる）
-- ============================================================
REVOKE ALL ON FUNCTION public.tower_grant_rewards(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_idle_block(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tower_battle_exp(uuid, boolean)     FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_grant_rewards(uuid, int, int) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_idle_block(uuid) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tower_battle_exp(uuid, boolean) FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;   -- ロールが無い環境では無視
END $$;

-- 同じ形の穴が既存にもある（任意のアイテム・装備・Goldを付与できる内部ヘルパ）。
-- 内部からしか呼ばないので REVOKE しても既存機能は壊れない。
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public._bingo_grant(uuid, jsonb) FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public._bingo_snapshot(uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public._bingo_eval(uuid, integer) FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 念のため関数の中でも本人確認する（REVOKE を流し忘れても穴が開かないように）
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
REVOKE ALL ON FUNCTION public.tower_grant_rewards(uuid, int, int) FROM PUBLIC;

-- ============================================================
-- B-2. 戦争中はタワーに入れない（街の出撃と同じ扱い）
--      wars が無い環境でも落ちないよう例外を握りつぶす。
-- ============================================================
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
REVOKE ALL ON FUNCTION public.tower_idle_block(uuid) FROM PUBLIC;

-- ============================================================
-- C-2. 連戦のHP/MPをサーバーで上限クランプ
--      申告値をそのまま保存していたため「HP無限で連戦」ができた。
--      実効最大HP(eff_hp_max)にエンドポイントの最大HP+段数を掛けた値で頭打ちにする。
-- ============================================================
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
REVOKE ALL ON FUNCTION public.tower_hp_cap(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION tower_mp_cap(p_uid uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_mp bigint;
BEGIN
  SELECT GREATEST(1, COALESCE(mp_max, 1) * 5) INTO v_mp FROM profiles WHERE id = p_uid;
  RETURN COALESCE(v_mp, 1);
END; $$;
REVOKE ALL ON FUNCTION public.tower_mp_cap(uuid) FROM PUBLIC;

-- ============================================================
-- B-4 / C-1. 出撃：連戦中は不可＋クールダウンをサーバーで確保
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
       AND (last_action_at IS NULL OR last_action_at <= now() - make_interval(secs => v_wait))
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
-- 連戦：開始
--   HP/MPはサーバー側の上限でクランプする（C-2）
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

-- ============================================================
-- B-3. 連戦：1戦の開始を宣言する（通信を切って敗北を消す抜け道を塞ぐ）
--      戦闘前にこれを呼び、結果は tower_run_save / tower_boss_clear で確定する。
--      宣言したまま結果が返らなかった連戦は、次に状況を読んだ時点で失敗扱いになる。
-- ============================================================
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
-- A-2. 連戦：1戦ぶん進める（ステージ飛ばしを塞ぐ）
--      これまでは「前より大きければ通る」だったので、0→5 の1回で
--      6連戦を丸ごと飛ばしてエリアボスを撃破できた。
-- ============================================================
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
-- A-3. エリアボス撃破：二重取得のレースを塞ぐ
--      進行中の連戦を「条件付きUPDATEで先に消してから」報酬を配る。
--      同時に2本投げても1本しか消せないので、初回踏破Goldが2重に入らない。
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
-- 状況取得：中断したまま結果が返っていない連戦は、ここで失敗扱いにする（B-3）
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
    'wait',        CASE WHEN COALESCE(v_profile.sortie_mode, 20) = 10 THEN 10 ELSE 20 END,
    'run', CASE WHEN v_tp.run_floor IS NULL THEN NULL ELSE json_build_object(
      'floor', v_tp.run_floor, 'stage', v_tp.run_stage,
      'hp', v_tp.run_hp, 'mp', v_tp.run_mp, 'potion', COALESCE(v_tp.run_potion, 0), 'started_at', v_tp.run_started_at
    ) END,
    'floors',      v_floors
  );
END; $$;

-- ============================================================
-- 権限（内部ヘルパは PUBLIC から剥がしたまま）
-- ============================================================
GRANT EXECUTE ON FUNCTION tower_can_act()                           TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_status()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_sortie_result(int, boolean, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_start(int, bigint, bigint)      TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_begin()                         TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_save(int, bigint, bigint, int)  TO authenticated;
GRANT EXECUTE ON FUNCTION tower_run_abort()                         TO authenticated;
GRANT EXECUTE ON FUNCTION tower_boss_clear(int, int, int)           TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_monument()                      TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_ranking(int)                    TO authenticated;

-- 確認用：内部ヘルパが外から呼べなくなっているか
--   authenticated_can_call が false になっていれば塞がっている
-- SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_call
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('tower_grant_rewards','tower_idle_block','tower_battle_exp','tower_hp_cap','tower_mp_cap','_bingo_grant');
