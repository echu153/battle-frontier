-- ※ クラスLVキャップは public.class_level_cap(class, retraining) が唯一の正（初期職300/上位職500）。
--    定義は supabase_levelcap_stack_fix_20260802.sql。このファイル単体を流す場合は先に同ファイルを適用すること。
-- ============================================================
-- 管理者(is_admin)のEXP超過を即時正規化（2026-06-20）
--   背景: calc_exp_next を半減(is_admin先行)した結果、半減前に貯まっていた exp が
--         新しい必要EXP(半減値)を超えたまま残り、街HUDで「152/70」のように
--         レベルアップ未反映に見える。戦闘清算RPCが走れば解消するが、その場で直す。
--   対象: is_admin = true の行のみ（先行対象＝開発者）。一般プレイヤーには触れない。
--   注意: lv/exp/char_lv は protect_stats のトリガー保護下のため GUC を立ててから更新。
--         半減しきい値はSQL Editor(JWTなし)では calc_exp_next が半減を返せないため、
--         ここではインラインで「半減値」を計算する（クライアント calcExpNext と一致）。
--   一回限り。再実行しても超過が無ければ何も変わらない（冪等）。
-- ============================================================
DO $$
DECLARE
  r       record;
  v_lv    int;
  v_exp   int;
  v_cap   int;
  v_next  int;
  v_pend  int;
  v_clv   int;
  v_ups   int;
BEGIN
  PERFORM set_config('app.allow_stat_change', 'on', true);

  FOR r IN
    SELECT id, lv, exp, char_lv, pending_stat_points, class, retraining
    FROM profiles WHERE is_admin = true
  LOOP
    v_lv  := r.lv;
    v_exp := COALESCE(r.exp, 0);
    v_pend := COALESCE(r.pending_stat_points, 0);
    v_clv  := COALESCE(r.char_lv, 1);
    v_ups  := 0;
    -- 当該クラスの有効キャップ（再修練5回で300、それ以外100）
    v_cap := public.class_level_cap(r.class, r.retraining);

    LOOP
      v_next := floor((CASE
        WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
        ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
      END) / 2.0)::int;
      EXIT WHEN v_exp < v_next OR v_lv >= v_cap;
      v_exp  := v_exp - v_next;
      v_lv   := v_lv + 1;
      v_pend := v_pend + 1;
      v_clv  := v_clv + 1;
      v_ups  := v_ups + 1;
    END LOOP;

    IF v_lv >= v_cap THEN v_exp := 0; END IF;

    -- 確定後の必要EXP（次レベルまで）を再計算
    v_next := floor((CASE
      WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
      ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
    END) / 2.0)::int;

    UPDATE profiles
      SET lv = v_lv, exp = v_exp, exp_next = v_next,
          char_lv = v_clv, pending_stat_points = v_pend
      WHERE id = r.id;

    -- class_levels は行が無くても確実に同期（UPSERT）
    INSERT INTO class_levels (player_id, class_name, lv, exp)
    VALUES (r.id, r.class, v_lv, v_exp)
    ON CONFLICT (player_id, class_name) DO UPDATE SET lv = EXCLUDED.lv, exp = EXCLUDED.exp;

    -- 跨いだレベルの習得スキルを補完（現在LV以下の未習得を一括付与＝冪等・再実行安全）
    INSERT INTO player_skills (player_id, skill_id)
    SELECT r.id, s.id FROM skills s
    WHERE s.class_name = r.class AND s.required_lv <= v_lv
      AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = r.id AND ps.skill_id = s.id)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'is_admin % 正規化: lv=% exp=%/% (level_ups=%)', r.id, v_lv, v_exp, v_next, v_ups;
  END LOOP;
END $$;
