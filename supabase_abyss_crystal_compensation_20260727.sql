-- ============================================================
-- 奈落闘技場 強者の結晶 取りこぼし補填（2026-07-27）
--   claim_abyss_floor の古い版(結晶付与なし)で20/25/30階をクリアした人へ、
--   通過した節目ぶんの強者の結晶をプレゼント(player_gifts)で配布する。
--   ・到達20〜24=1個 / 25〜29=2個 / 30=3個
--   ・今週(月曜5時JST境界)の進捗のみ対象。
--   ・二重実行しても増えない（補填ギフト既存者を除外）。
--   ※ player_gifts(supabase_gift_system.sql) 適用済みが前提。
-- ============================================================

-- 【1】まずクリア状況を確認（配布はされない・SELECTのみ）
WITH wk AS (
  SELECT date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours')::date AS week_start
)
SELECT p.username,
       ap.cleared_floor AS 到達階,
       ap.last_clear_week,
       ((ap.cleared_floor >= 20)::int + (ap.cleared_floor >= 25)::int + (ap.cleared_floor >= 30)::int) AS 配布結晶数
FROM abyss_progress ap
JOIN profiles p ON p.id = ap.player_id
CROSS JOIN wk
WHERE ap.last_clear_week >= wk.week_start
  AND ap.cleared_floor >= 20
ORDER BY ap.cleared_floor DESC, p.username;

-- 【2】上のリストで問題なければ、この INSERT を実行して配布
WITH wk AS (
  SELECT date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours')::date AS week_start
)
INSERT INTO player_gifts (player_id, item_name, quantity, message)
SELECT ap.player_id, '強者の結晶',
       ((ap.cleared_floor >= 20)::int + (ap.cleared_floor >= 25)::int + (ap.cleared_floor >= 30)::int),
       '奈落闘技場の不具合により、地下20・25・30階の「強者の結晶」が受け取れていませんでした。お詫びとしてお届けします。'
FROM abyss_progress ap
CROSS JOIN wk
WHERE ap.last_clear_week >= wk.week_start
  AND ap.cleared_floor >= 20
  AND NOT EXISTS (  -- 既に補填ギフトを配った人は除外（二重配布防止）
    SELECT 1 FROM player_gifts g
    WHERE g.player_id = ap.player_id
      AND g.message LIKE '奈落闘技場の不具合により%'
  );

-- 【3】配布結果の確認
SELECT p.username, g.item_name, g.quantity, g.claimed, g.created_at
FROM player_gifts g
JOIN profiles p ON p.id = g.player_id
WHERE g.message LIKE '奈落闘技場の不具合により%'
ORDER BY g.created_at DESC;
