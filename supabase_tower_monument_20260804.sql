-- ============================================================
-- エンドレスタワー：石碑のルール変更（2026-08-04）
-- ------------------------------------------------------------
-- 変更前: 10層ごとの節目（10/20/30…）だけ、最初の1人を刻む
-- 変更後: まず10層に最初に到達した者を刻み、
--         それ以降は1層ごとに、その層を最初に踏破した者を刻む
--
-- ・このファイルは supabase_tower.sql の該当2関数だけを差し替えるものです。
--   supabase_tower.sql を丸ごと流し直しても同じ結果になります。
-- ・既に tower_first_clear に入っている記録はそのまま残ります（消しません）。
-- ・apply_battle_result は触らないので、SQL適用順の鉄則には影響しません。
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
  v_texp  int;
  v_new   boolean := false;
  v_block text;
BEGIN
  v_pid := auth.uid();
  IF v_pid IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  v_block := tower_idle_block(v_pid);
  IF v_block IS NOT NULL THEN RETURN json_build_object('error', v_block); END IF;

  SELECT * INTO v_tp FROM tower_player WHERE player_id = v_pid;
  IF NOT FOUND OR v_tp.run_floor IS DISTINCT FROM p_floor THEN
    RETURN json_build_object('error', 'このエリアの連戦を行っていません');
  END IF;
  -- 6戦目（添字5）まで進んでいなければエリアボスを倒せるはずがない
  IF v_tp.run_stage < 5 THEN
    RETURN json_build_object('error', '連戦が最後まで進んでいません');
  END IF;

  -- 初クリアかどうか（Goldの額がこれで変わるので先に判定する）
  SELECT NOT COALESCE(boss_cleared, false) INTO v_new
    FROM tower_progress WHERE player_id = v_pid AND floor = p_floor;
  v_new := COALESCE(v_new, true);

  -- Gold・EXPともサーバーが決める（p_gold / p_exp は受け取らない＝改ざんできない）
  -- Goldは初回だけエリア数×100万、2回目以降は出撃と同じエリア数×300
  v_gold := tower_boss_gold(p_floor, v_new);
  v_exp  := tower_battle_exp(v_pid, true);

  INSERT INTO tower_progress (player_id, floor, boss_cleared, first_clear_at)
    VALUES (v_pid, p_floor, true, now())
  ON CONFLICT (player_id, floor) DO UPDATE
    SET boss_cleared = true,
        first_clear_at = COALESCE(tower_progress.first_clear_at, now()),
        updated_at = now();

  -- 到達エリアの更新（ランキング用）
  -- エンドEXP：初回撃破だけ1000、2回目以降は出撃と同じ（乱数なので1回だけ引く）
  v_texp := tower_boss_tower_exp(v_new);

  UPDATE tower_player
    SET max_floor    = GREATEST(COALESCE(max_floor, 0), p_floor),
        max_floor_at = CASE WHEN p_floor > COALESCE(max_floor, 0) THEN now() ELSE max_floor_at END,
        tower_exp    = tower_exp + v_texp,
        run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL, run_started_at = NULL,
        updated_at = now()
    WHERE player_id = v_pid;

  -- 石碑：最初の1つは10層（最初にここまで来た者だけ）。それ以降は1層ごとに、
  --       その層をサーバーで最初に踏破した1人を記録する。
  IF p_floor >= 10 THEN
    SELECT username INTO v_name FROM profiles WHERE id = v_pid;
    INSERT INTO tower_first_clear (floor, player_id, username)
      VALUES (p_floor, v_pid, COALESCE(v_name, '？'))
    ON CONFLICT (floor) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_first := (v_rows > 0);   -- 1行入った＝サーバーで最初の1人だった
  END IF;

  PERFORM tower_grant_rewards(v_pid, v_gold, v_exp);

  RETURN json_build_object(
    'ok', true, 'floor', p_floor,
    'first_clear', v_new,          -- そのプレイヤーにとって初クリアか
    'monument', COALESCE(v_first, false), -- 石碑に名前が刻まれたか（サーバー初）
    'gold', v_gold, 'exp', v_exp, 'tower_exp', v_texp
  );
END; $$;

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

GRANT EXECUTE ON FUNCTION tower_boss_clear(int, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_monument()            TO authenticated;
