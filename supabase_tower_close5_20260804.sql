-- ============================================================
-- エンドレスタワー：5層以降を一時停止（2026-08-04）
-- ------------------------------------------------------------
-- エリアボスが想定より弱いため、5層以降を調整するあいだ閉じる。
--
--   ・挑戦できるのは 4層まで。5層以降は出撃も連戦も受け付けない
--   ・進行状況（出撃回数・強敵撃破・踏破済み・到達エリア）は消さない。
--     再開したときにそのまま続きから遊べる
--   ・5層以降で連戦の途中だった人は、次に画面を開いた時点で連戦だけ畳まれる
--     （HPの持ち越しが宙に浮かないようにするため。踏破済みの記録は残る）
--   ・到達エリアランキングと石碑もそのまま
--
-- 【再開するとき】tower_max_floor() を 10 に戻し、クライアントの
--   src/lib/tower.js の OPEN_MAX_FLOOR も 10 に戻す。
--   ⚠片方だけ戻すと「選べるのに出撃が弾かれる」状態になる。
--     回帰テスト（npm test）が両者のズレを検出する。
--
-- ・supabase_tower.sql 本体にも同じ内容を反映済み。
-- ・apply_battle_result は触らないので、SQL適用順の鉄則には影響しない。
-- ============================================================

-- 挑戦できる最大の層
CREATE OR REPLACE FUNCTION tower_max_floor() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;

-- 閉じた層で進行中だった連戦を畳む（次に状況を読んだ時点で実行される）
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

GRANT EXECUTE ON FUNCTION get_tower_status() TO authenticated;

-- 確認用：5層以降で連戦が残っている人の数（適用後に開けば0になっていく）
-- SELECT count(*) FROM tower_player WHERE run_floor > 4;
