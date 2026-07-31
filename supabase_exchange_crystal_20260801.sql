-- ============================================================
-- 交換所「レイドボス」タブに 強者の結晶 を追加（2026-08-01）
--   既存レイドボス4体それぞれの素材で交換できるようにする。
--     通常素材 100個 → 強者の結晶 1個
--     レア素材   5個 → 強者の結晶 1個
--   回数無制限（max_per_player = NULL）。
--
--   ・ヴァルゼノク: 黒龍の鱗 / 黒龍の逆鱗
--   ・あまざ      : 水禍の雫 / 雨禍の心核
--   ・ゼルギアス  : 雷鋼片   / 神雷炉心
--   ・閻魔        : 獄王の断罪片 / 閻魔の審判核
--
--   土台: supabase_exchange.sql（exchange_shop）
--         supabase_raid_courage_event_20260713.sql（do_exchange の reward_qty 対応版）
--   ※ do_exchange は再定義しない＝適用順の制約なし。SQL Editor で全体を実行。
--   ※ クライアント側の変更は不要（交換所はDB駆動・素材の所持表示も既に対応済み）。
-- ============================================================

-- 0) 前提チェック: 報酬アイテム「強者の結晶」と素材8種がDBに存在すること
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(n, ', ') INTO v_missing
  FROM (VALUES
    ('強者の結晶'), ('黒龍の鱗'), ('黒龍の逆鱗'), ('水禍の雫'), ('雨禍の心核'),
    ('雷鋼片'), ('神雷炉心'), ('獄王の断罪片'), ('閻魔の審判核')
  ) AS t(n)
  WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.name = t.n);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'items に未登録のアイテムがあります: %', v_missing;
  END IF;
END $$;

-- 1) 通常素材 100個 → 強者の結晶 1個
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【黒龍の鱗】',
       '強者の結晶1個と交換。',
       '[{"item_name": "黒龍の鱗", "quantity": 100}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 31, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【黒龍の鱗】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【水禍の雫】',
       '強者の結晶1個と交換。',
       '[{"item_name": "水禍の雫", "quantity": 100}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 32, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【水禍の雫】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【雷鋼片】',
       '強者の結晶1個と交換。',
       '[{"item_name": "雷鋼片", "quantity": 100}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 33, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【雷鋼片】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【獄王の断罪片】',
       '強者の結晶1個と交換。',
       '[{"item_name": "獄王の断罪片", "quantity": 100}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 34, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【獄王の断罪片】');

-- 2) レア素材 5個 → 強者の結晶 1個
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【黒龍の逆鱗】',
       '強者の結晶1個と交換。',
       '[{"item_name": "黒龍の逆鱗", "quantity": 5}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 35, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【黒龍の逆鱗】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【雨禍の心核】',
       '強者の結晶1個と交換。',
       '[{"item_name": "雨禍の心核", "quantity": 5}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 36, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【雨禍の心核】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【神雷炉心】',
       '強者の結晶1個と交換。',
       '[{"item_name": "神雷炉心", "quantity": 5}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 37, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【神雷炉心】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, reward_qty, max_per_player, active, sort_order, tab)
SELECT '強者の結晶【閻魔の審判核】',
       '強者の結晶1個と交換。',
       '[{"item_name": "閻魔の審判核", "quantity": 5}]'::jsonb,
       'item', '強者の結晶', null, 1, null, true, 38, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強者の結晶【閻魔の審判核】');

-- 3) 確認
SELECT name, cost_items, reward_weapon_name, reward_qty, max_per_player, sort_order
FROM exchange_shop
WHERE reward_weapon_name = '強者の結晶'
ORDER BY sort_order;
