-- ============================================================
-- 夏の出撃ポイントラリー: 公開前(加算が止まっていた期間)の出撃ポイントを遡って補填
--   ・対象期間: イベント開始(JST 7/27 5:00) 〜 加算開始(JST 7/27 22:34頃)
--   ・battle_logs の出撃記録から1人あたりの出撃回数を数えて event_points に加算
--   ・sortie_mode に合わせて 20秒=1pt / 10秒=0.5pt(frac繰越)で換算＝通常時と同じレート
--   ・不正記録(suspicious=true)は除外。二重実行しても増えない(実行済み記録で保護)
--   ⚠カットオフ時刻は実際に加算が始まった時刻に合わせて調整可(下の v_cutoff)
-- ============================================================

-- 二重補填を防ぐ実行済み記録
CREATE TABLE IF NOT EXISTS event_backfill_done (
  event_key text NOT NULL,
  note      text NOT NULL,
  done_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, note)
);

DO $$
DECLARE
  v_key    text        := 'sortie_2026_07';
  v_note   text        := 'pre_publish_sortie_backfill';
  v_start  timestamptz := '2026-07-27 05:00:00+09';  -- イベント開始
  v_cutoff timestamptz := '2026-07-27 22:34:00+09';  -- 加算が始まった時刻(表記が出た頃)
  v_rows   int := 0;
BEGIN
  -- 既に補填済みなら何もしない(二重加算防止)
  IF EXISTS (SELECT 1 FROM event_backfill_done WHERE event_key = v_key AND note = v_note) THEN
    RAISE NOTICE '補填は既に実行済みです。何もしませんでした。';
    RETURN;
  END IF;

  -- 期間内の出撃回数を集計し、sortie_mode に応じた半ポイント単位で加算
  WITH counted AS (
    SELECT bl.player_id,
           COUNT(*)::int AS sorties,
           -- 20秒モード=1回2半pt(=1pt) / 10秒モード=1回1半pt(=0.5pt)
           COUNT(*)::int * CASE WHEN COALESCE(p.sortie_mode, 20) = 10 THEN 1 ELSE 2 END AS half_pts
    FROM battle_logs bl
    JOIN profiles p ON p.id = bl.player_id
    WHERE bl.created_at >= v_start
      AND bl.created_at <  v_cutoff
      AND COALESCE(bl.suspicious, false) = false   -- 不正検知ログは除外
    GROUP BY bl.player_id, p.sortie_mode
  )
  INSERT INTO event_points (player_id, event_key, points, frac)
  SELECT c.player_id, v_key, c.half_pts / 2, c.half_pts % 2
  FROM counted c
  ON CONFLICT (player_id, event_key) DO UPDATE
    SET points = event_points.points + ((event_points.frac + EXCLUDED.points * 2 + EXCLUDED.frac) / 2),
        frac   = (event_points.frac + EXCLUDED.points * 2 + EXCLUDED.frac) % 2;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO event_backfill_done (event_key, note) VALUES (v_key, v_note);
  RAISE NOTICE '補填完了: % 人に加算しました', v_rows;
END $$;

-- 確認用: 補填後の上位20人
SELECT p.username, ep.points, ep.frac
FROM event_points ep
JOIN profiles p ON p.id = ep.player_id
WHERE ep.event_key = 'sortie_2026_07'
ORDER BY ep.points DESC
LIMIT 20;
