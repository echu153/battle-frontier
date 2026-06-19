-- ============================================================
-- EXP誤検知の補填：経験値ダンジョン使用回数券を10枚ずつ配布
--   対象: えちゅ / ここにゃん / めぐる / ユウ / 水狼
-- ============================================================
INSERT INTO player_items (player_id, item_id, quantity, equipped)
SELECT p.id, i.id, 10, false
FROM profiles p
CROSS JOIN (SELECT id FROM items WHERE effect = 'exp_dungeon_ticket' LIMIT 1) i
WHERE p.username IN ('えちゅ','ここにゃん','めぐる','ユウ','水狼')
ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 10;

-- 確認
SELECT p.username, pi.quantity AS 回数券
FROM player_items pi
JOIN profiles p ON p.id = pi.player_id
JOIN items i ON i.id = pi.item_id AND i.effect = 'exp_dungeon_ticket'
WHERE p.username IN ('えちゅ','ここにゃん','めぐる','ユウ','水狼');
