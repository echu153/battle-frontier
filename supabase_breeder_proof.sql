-- ============================================================
-- 称号「ペット想い」の報酬「ブリーダーの証」を確実に付与
--   ① ブリーダーの証アイテムを保証（effect=breeder_proof：転職判定で参照）
--   ② 称号「ペット想い」の bonus_item_name を「ブリーダーの証」に設定（今後の獲得時に自動付与）
--   ③ 既に称号を持っているのに証が無いプレイヤーへ遡及付与
--   ※ ブリーダー転職の必須アイテム effect は 'breeder_proof'（src/pages/Game.jsx 参照）
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ① アイテム保証
INSERT INTO items (name, description, effect, value)
SELECT 'ブリーダーの証', 'ブリーダーに転職できる証。', 'breeder_proof', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = 'ブリーダーの証');
-- 既存でも effect を正しく(breeder_proof)に
UPDATE items SET effect = 'breeder_proof' WHERE name = 'ブリーダーの証';

-- ② 称号の報酬アイテムを設定
UPDATE titles SET bonus_item_name = 'ブリーダーの証' WHERE name = 'ペット想い';

-- ③ 既に称号獲得済みで証を持っていないプレイヤーへ遡及付与
INSERT INTO player_items (player_id, item_id, quantity, equipped)
SELECT pt.player_id, (SELECT id FROM items WHERE name = 'ブリーダーの証'), 1, false
FROM player_titles pt
JOIN titles t ON t.id = pt.title_id
WHERE t.name = 'ペット想い'
  AND NOT EXISTS (
    SELECT 1 FROM player_items pi
    WHERE pi.player_id = pt.player_id
      AND pi.item_id = (SELECT id FROM items WHERE name = 'ブリーダーの証')
  );
