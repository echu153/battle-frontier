-- ============================================================
-- プレゼント配布: 「箸」へ誕生日プレゼント
--   ・ボス装備進化支援箱 ×1（ボスの血を選んで受け取れる箱）
--   ・＋11確定強化石 ×1
--   メッセージ: はっぴーばーすでー🎉
--   ※ supabase_gift_system.sql 適用済みが前提。＋11確定強化石は
--     supabase_plus11_stone.sql 適用済みが前提（items未登録だと受取時に弾かれる）。
-- ============================================================
INSERT INTO player_gifts (player_id, item_name, quantity, message)
SELECT p.id, v.item_name, 1, 'はっぴーばーすでー🎉'
FROM profiles p
CROSS JOIN (VALUES
  ('ボス装備進化支援箱'),
  ('＋11確定強化石')
) AS v(item_name)
WHERE p.username = '箸';

-- 確認
SELECT g.id, pr.username AS 宛先, g.item_name, g.quantity, g.message, g.claimed
FROM player_gifts g JOIN profiles pr ON pr.id = g.player_id
WHERE pr.username = '箸'
ORDER BY g.created_at DESC;
