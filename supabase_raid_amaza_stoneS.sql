-- ============================================================
-- あまざ素材版の強化石(S)交換を追加＋強化石を一覧の一番下にまとめる
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 1) あまざ素材で強化石(S)（無制限・2エントリー）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【水禍の雫】',
       'S級強化石1個と交換。',
       '[{"item_name": "水禍の雫", "quantity": 70}]'::jsonb,
       'item', '強化石(S)', null, null, true, 23, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【水禍の雫】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【雨禍の心核】',
       'S級強化石1個と交換。',
       '[{"item_name": "雨禍の心核", "quantity": 2}]'::jsonb,
       'item', '強化石(S)', null, null, true, 24, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【雨禍の心核】');

-- 2) 強化石(S)は4種とも一番下にまとめる（武器類は sort_order 1〜13）
UPDATE exchange_shop SET sort_order = 21 WHERE name = '強化石(S)【鱗】';
UPDATE exchange_shop SET sort_order = 22 WHERE name = '強化石(S)【逆鱗】';
UPDATE exchange_shop SET sort_order = 23 WHERE name = '強化石(S)【水禍の雫】';
UPDATE exchange_shop SET sort_order = 24 WHERE name = '強化石(S)【雨禍の心核】';
