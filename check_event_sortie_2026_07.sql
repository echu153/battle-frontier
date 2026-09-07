-- ============================================================
-- 確認用: 夏の出撃ポイントラリー（event_key = 'sortie_2026_07'・2026/7/27 5:00〜8/17 5:00）
--   ※Supabase の SQL Editor は最後のSELECTの結果しか表示しないため、①〜④を1つずつ実行すること。
-- ============================================================

-- ① サマリ（参加人数・5000pt到達者数・平均/最大）
SELECT
  COUNT(*)                                          AS 参加人数,
  COUNT(*) FILTER (WHERE ep.points >= 5000)         AS "5000pt到達者",
  COUNT(*) FILTER (WHERE ep.points >= 4000)         AS "4000pt以上",
  COUNT(*) FILTER (WHERE ep.points >= 2500)         AS "2500pt以上",
  COUNT(*) FILTER (WHERE ep.points >= 1000)         AS "1000pt以上",
  MAX(ep.points)                                    AS 最高pt,
  ROUND(AVG(ep.points))                             AS 平均pt,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ep.points)::numeric) AS 中央値
FROM event_points ep
WHERE ep.event_key = 'sortie_2026_07';

-- ② 5000pt到達者の一覧（0人なら結果0行＝まだ誰も到達していない）
SELECT p.username, ep.points, p.lv, p.is_admin
FROM event_points ep
JOIN profiles p ON p.id = ep.player_id
WHERE ep.event_key = 'sortie_2026_07' AND ep.points >= 5000
ORDER BY ep.points DESC;

-- ③ 上位30名（到達までの残りptつき）
SELECT
  RANK() OVER (ORDER BY ep.points DESC) AS 順位,
  p.username,
  ep.points                             AS pt,
  GREATEST(0, 5000 - ep.points)         AS "5000までの残り",
  p.is_admin
FROM event_points ep
JOIN profiles p ON p.id = ep.player_id
WHERE ep.event_key = 'sortie_2026_07'
ORDER BY ep.points DESC
LIMIT 30;

-- ④ 未受取の報酬段階が多い人（ptは足りているのに交換所で受け取っていない段階数）
SELECT p.username, ep.points,
       COUNT(r.threshold) FILTER (WHERE c.threshold IS NULL) AS 未受取段階数
FROM event_points ep
JOIN profiles p ON p.id = ep.player_id
JOIN event_rewards r
  ON r.event_key = ep.event_key AND r.threshold <= ep.points
LEFT JOIN event_claims c
  ON c.event_key = ep.event_key AND c.player_id = ep.player_id AND c.threshold = r.threshold
WHERE ep.event_key = 'sortie_2026_07'
GROUP BY p.username, ep.points
HAVING COUNT(r.threshold) FILTER (WHERE c.threshold IS NULL) > 0
ORDER BY 3 DESC, ep.points DESC
LIMIT 30;
