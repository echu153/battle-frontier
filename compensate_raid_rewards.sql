-- ============================================================
-- 【お詫び配布】レイド報酬を全プレイヤーへ補填（claim_raid_rewards を再現）
--   ・雨摩座：全員参加できなかった → Aティア相当を全員へ
--       Gold+150000 / 強化石(B)(C)(D)各×2 / 宝石(D)×2(ランダム種) / 水禍の雫×9
--   ・ヴァルゼノク：途中参加対応 → Cティア相当を全員へ
--       Gold+30000 / 強化石(D)(E)(F)各×2 / 宝石(F)×2(ランダム種) / 黒龍の鱗×5
--   ※レア素材(雨禍の心核/黒龍の逆鱗)は希少性維持のため配布対象外。
--   ⚠ このスクリプトは「1回だけ」実行してください（2回流すと二重配布になります）。
-- ============================================================
DO $$
DECLARE
  v_pid       uuid;
  v_gem_types text[] := ARRAY['peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'];
  v_rank   text;
  v_gtype  text;
  v_i      int;
  v_item   int;
  v_exist  uuid;
BEGIN
  PERFORM set_config('app.allow_stat_change', 'on', true);

  FOR v_pid IN SELECT id FROM profiles LOOP
    -- ===== 雨摩座 Aティア相当 =====
    UPDATE profiles SET gold = gold + 150000 WHERE id = v_pid;

    FOREACH v_rank IN ARRAY ARRAY['B','C','D'] LOOP
      SELECT id INTO v_item FROM items WHERE name = '強化石(' || v_rank || ')' LIMIT 1;
      IF v_item IS NOT NULL THEN
        INSERT INTO player_items (player_id, item_id, quantity, equipped)
        VALUES (v_pid, v_item, 2, false)
        ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 2;
      END IF;
    END LOOP;

    FOR v_i IN 1..2 LOOP
      v_gtype := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
      SELECT id INTO v_exist FROM player_gems WHERE player_id = v_pid AND gem_type = v_gtype AND rank = 'D';
      IF FOUND THEN UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_exist;
      ELSE INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_pid, v_gtype, 'D', 1); END IF;
    END LOOP;

    SELECT id INTO v_item FROM items WHERE name = '水禍の雫' LIMIT 1;
    IF v_item IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_pid, v_item, 9, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 9;
    END IF;

    -- ===== ヴァルゼノク Cティア相当 =====
    UPDATE profiles SET gold = gold + 30000 WHERE id = v_pid;

    FOREACH v_rank IN ARRAY ARRAY['D','E','F'] LOOP
      SELECT id INTO v_item FROM items WHERE name = '強化石(' || v_rank || ')' LIMIT 1;
      IF v_item IS NOT NULL THEN
        INSERT INTO player_items (player_id, item_id, quantity, equipped)
        VALUES (v_pid, v_item, 2, false)
        ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 2;
      END IF;
    END LOOP;

    FOR v_i IN 1..2 LOOP
      v_gtype := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
      SELECT id INTO v_exist FROM player_gems WHERE player_id = v_pid AND gem_type = v_gtype AND rank = 'F';
      IF FOUND THEN UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_exist;
      ELSE INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_pid, v_gtype, 'F', 1); END IF;
    END LOOP;

    SELECT id INTO v_item FROM items WHERE name = '黒龍の鱗' LIMIT 1;
    IF v_item IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_pid, v_item, 5, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 5;
    END IF;
  END LOOP;
END $$;

-- 確認: 配布後の人数と一例
SELECT count(*) AS 対象プレイヤー数 FROM profiles;
