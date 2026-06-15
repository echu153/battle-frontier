-- ============================================================
-- 称号「ドラゴンスレイヤー」の報酬「竜騎士の証」を確実に付与
--   ① 竜騎士の証アイテムを保証（effect=dragon_knight_proof：転職判定で参照）
--   ② 称号の bonus_item_name を「竜騎士の証」に設定（今後の獲得時に自動付与）
--   ③ 既に称号を持っているのに証が無いプレイヤーへ遡及付与
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ① アイテム保証
INSERT INTO items (name, description, effect, value)
SELECT '竜騎士の証', '竜騎士に転職できる証。', 'dragon_knight_proof', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '竜騎士の証');
-- 既存でも effect を正しく(dragon_knight_proof)に
UPDATE items SET effect = 'dragon_knight_proof' WHERE name = '竜騎士の証';

-- ② 称号の報酬アイテムを設定
UPDATE titles SET bonus_item_name = '竜騎士の証' WHERE name = 'ドラゴンスレイヤー';

-- ③ 既に称号獲得済みで証を持っていないプレイヤーへ遡及付与
INSERT INTO player_items (player_id, item_id, quantity, equipped)
SELECT pt.player_id, (SELECT id FROM items WHERE name = '竜騎士の証'), 1, false
FROM player_titles pt
JOIN titles t ON t.id = pt.title_id
WHERE t.name = 'ドラゴンスレイヤー'
  AND NOT EXISTS (
    SELECT 1 FROM player_items pi
    WHERE pi.player_id = pt.player_id
      AND pi.item_id = (SELECT id FROM items WHERE name = '竜騎士の証')
  );
