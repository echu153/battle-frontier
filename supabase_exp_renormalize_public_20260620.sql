-- ※ クラスLVキャップは public.class_level_cap(class, retraining) が唯一の正（初期職300/上位職500）。
--    定義は supabase_levelcap_stack_fix_20260802.sql。このファイル単体を流す場合は先に同ファイルを適用すること。
-- ============================================================
-- 全プレイヤーのEXP正規化（本番公開 2026-06-20）
--   必要EXPが全プレイヤーで「floor(base/2)+10」へ変わったため、超過しているexpを
--   その場でレベルアップ消化し、class_levels同期・習得スキル補完まで行う。冪等（再実行安全）。
--   ※ 公開SQL（sortie_boost等）を適用した後、メンテナンス中に1回実行すること。
--   ※ lv/exp/char_lv は protect_stats 保護下のため GUC を立ててから更新。
--   ※ しきい値はインライン計算（クライアント calcExpNext と一致＝floor(base/2)+10）。
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
    FROM profiles
  LOOP
    v_lv  := r.lv;
    v_exp := COALESCE(r.exp, 0);
    v_pend := COALESCE(r.pending_stat_points, 0);
    v_clv  := COALESCE(r.char_lv, 1);
    v_ups  := 0;
    v_cap := public.class_level_cap(r.class, r.retraining);

    LOOP
      v_next := floor((CASE
        WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
        ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
      END) / 2.0)::int + 10;
      EXIT WHEN v_exp < v_next OR v_lv >= v_cap;
      v_exp  := v_exp - v_next;
      v_lv   := v_lv + 1;
      v_pend := v_pend + 1;
      v_clv  := v_clv + 1;
      v_ups  := v_ups + 1;
    END LOOP;

    IF v_lv >= v_cap THEN v_exp := 0; END IF;

    v_next := floor((CASE
      WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
      ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
    END) / 2.0)::int + 10;

    -- ★[CODEX]88 #1: レベルを跨がない行も exp_next が旧値（80→50等）のため全行を同期する。
    --   冪等性は値が同じなら同結果＝再実行安全。class_levels UPSERT / skill補完も全行で実行。
    UPDATE profiles
      SET lv = v_lv, exp = v_exp, exp_next = v_next,
          char_lv = v_clv, pending_stat_points = v_pend
      WHERE id = r.id;

    INSERT INTO class_levels (player_id, class_name, lv, exp)
    VALUES (r.id, r.class, v_lv, v_exp)
    ON CONFLICT (player_id, class_name) DO UPDATE SET lv = EXCLUDED.lv, exp = EXCLUDED.exp;

    INSERT INTO player_skills (player_id, skill_id)
    SELECT r.id, s.id FROM skills s
    WHERE s.class_name = r.class AND s.required_lv <= v_lv
      AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = r.id AND ps.skill_id = s.id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
