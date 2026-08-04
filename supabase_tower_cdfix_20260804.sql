-- ============================================================
-- エンドレスタワー：クールダウンが端末の時計ズレで早く0になる不具合の修正（2026-08-04）
-- ------------------------------------------------------------
-- 【症状】20秒待って出撃しようとすると、押した瞬間にクールダウンの途中へ戻され、
--         さらに数秒待たされる。
--
-- 【原因】クールダウンの確保をサーバー側へ移した際、画面の残り秒数だけを
--         「サーバーが返した last_action_at」と「端末の Date.now()」の引き算で
--         出していた。端末の時計がサーバーより数秒進んでいると、その差のぶん
--         早く0になり、押した先でサーバーに弾かれていた。
--         （街の出撃には元から時計ズレ対策が入っていたが、タワーには無かった）
--
-- 【修正】
--   ① get_tower_status が残り秒数(cd_left)をサーバー側で計算して返す
--      → クライアントは時刻の引き算をしない＝端末の時計に影響されない
--   ② 境目ちょうどの押下が往復遅延や丸めで弾かれないよう 0.5秒の猶予を持たせる
--
-- ・supabase_tower.sql 本体にも同じ内容を反映済み。
-- ・クライアント側の対応も同じコミットに入っている（デプロイ後に有効）。
-- ・apply_battle_result は触らないので、SQL適用順の鉄則には影響しない。
-- ============================================================

-- ① 残りクールダウンをサーバーが秒数で返す（cd_left）
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

-- ② 境目ちょうどの押下に 0.5秒の猶予を持たせる
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

GRANT EXECUTE ON FUNCTION get_tower_status()                        TO authenticated;
GRANT EXECUTE ON FUNCTION tower_sortie_result(int, boolean, boolean, int, int) TO authenticated;
