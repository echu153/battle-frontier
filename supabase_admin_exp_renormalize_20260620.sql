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
    v_cap := CASE WHEN COALESCE((r.retraining ->> r.class)::int, 0) >= 5 THEN 300 ELSE 100 END;

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

    UPDATE class_levels SET lv = v_lv, exp = v_exp
      WHERE player_id = r.id AND class_name = r.class;

    RAISE NOTICE 'is_admin % 正規化: lv=% exp=%/% (level_ups=%)', r.id, v_lv, v_exp, v_next, v_ups;
  END LOOP;
END $$;
