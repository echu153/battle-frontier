-- ============================================================
-- 交換所 SQL（完全版）
-- Supabase の SQL Editor で実行してください
-- ============================================================

-- ===== 素材アイテム追加 =====
INSERT INTO items (name, description, effect, value) VALUES
  ('黒龍の鱗',   '黒龍ヴァルゼノクの鱗。交換所で使用できる。', 'material', 0),
  ('黒龍の逆鱗', '黒龍ヴァルゼノクの逆鱗。極めて希少な素材。交換所で使用できる。', 'material', 0)
ON CONFLICT DO NOTHING;

-- ===== weapons テーブルに atk_bonus_pct カラム追加 =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'weapons' AND column_name = 'atk_bonus_pct'
  ) THEN
    ALTER TABLE weapons ADD COLUMN atk_bonus_pct int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ===== 交換所装備追加 =====
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, matk_bonus_pct)
VALUES
  ('ヴァルブレイカー', 'sword', 'weapon', 's', 80, 20, 0, 0, 0),
  ('黒龍の鎧', null, 'armor', 'a', 0, 25, 0, 25, 5)
ON CONFLICT DO NOTHING;

UPDATE weapons SET atk_bonus_pct = 5 WHERE name = '黒龍の鎧';

-- ===== 交換所テーブル =====
CREATE TABLE IF NOT EXISTS exchange_shop (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  cost_items jsonb NOT NULL,
  reward_type text NOT NULL DEFAULT 'weapon',
  reward_weapon_name text,
  reward_bonus_effect text,
  max_per_player int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  tab text NOT NULL DEFAULT 'レイドボス'
);

CREATE TABLE IF NOT EXISTS exchange_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shop_id int NOT NULL REFERENCES exchange_shop(id) ON DELETE CASCADE,
  exchanged_at timestamptz DEFAULT now(),
  UNIQUE (player_id, shop_id)
);

-- 既存テーブルへのカラム追加（既に実行済みの場合の対応）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_shop' AND column_name = 'reward_bonus_effect'
  ) THEN
    ALTER TABLE exchange_shop ADD COLUMN reward_bonus_effect text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_shop' AND column_name = 'tab'
  ) THEN
    ALTER TABLE exchange_shop ADD COLUMN tab text NOT NULL DEFAULT 'レイドボス';
  END IF;
END $$;

-- RLS
ALTER TABLE exchange_shop ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exchange_shop_select" ON exchange_shop;
DROP POLICY IF EXISTS "exchange_records_select" ON exchange_records;
CREATE POLICY "exchange_shop_select" ON exchange_shop FOR SELECT USING (true);
CREATE POLICY "exchange_records_select" ON exchange_records FOR SELECT USING (auth.uid() IS NOT NULL);

-- ===== 交換所エントリー =====
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
VALUES
  (
    'ヴァルブレイカー',
    'S級大剣。攻撃ヒット時、2ターンの間対象の回復力-10%。',
    '[{"item_name": "黒龍の鱗", "quantity": 50}, {"item_name": "黒龍の逆鱗", "quantity": 1}]',
    'weapon', 'ヴァルブレイカー', 'hit_heal_down_10_2t', 1, true, 1, 'レイドボス'
  ),
  (
    '黒龍の鎧',
    'A級鎧。防御25・魔法防御25、攻撃力+5%・特殊攻撃力+5%。',
    '[{"item_name": "黒龍の鱗", "quantity": 30}]',
    'weapon', '黒龍の鎧', null, 1, true, 2, 'レイドボス'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- RPC: 交換実行
-- ============================================================
CREATE OR REPLACE FUNCTION do_exchange(p_shop_id int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id  uuid;
  v_shop       exchange_shop%ROWTYPE;
  v_entry      jsonb;
  v_item_name  text;
  v_qty        int;
  v_item_id    int;
  v_held       int;
  v_weapon_id  int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_shop FROM exchange_shop WHERE id = p_shop_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('error', '交換項目が見つかりません'); END IF;

  IF v_shop.max_per_player = 1 THEN
    IF EXISTS (SELECT 1 FROM exchange_records WHERE player_id = v_player_id AND shop_id = p_shop_id) THEN
      RETURN json_build_object('error', '既に交換済みです');
    END IF;
  END IF;

  -- 素材所持確認
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    IF v_item_id IS NULL THEN RETURN json_build_object('error', v_item_name || 'が存在しません'); END IF;
    SELECT COALESCE(quantity, 0) INTO v_held FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id;
    IF v_held < v_qty THEN
      RETURN json_build_object('error', v_item_name || 'が不足しています（必要: ' || v_qty || '個、所持: ' || v_held || '個）');
    END IF;
  END LOOP;

  -- 素材消費
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    UPDATE player_items SET quantity = quantity - v_qty WHERE player_id = v_player_id AND item_id = v_item_id;
    DELETE FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id AND quantity <= 0;
  END LOOP;

  -- 報酬付与
  IF v_shop.reward_type = 'weapon' THEN
    SELECT id INTO v_weapon_id FROM weapons WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_weapon_id IS NULL THEN RETURN json_build_object('error', '報酬装備が見つかりません'); END IF;
    INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
    SELECT v_player_id, v_weapon_id, w.slot, false, 0, v_shop.reward_bonus_effect
    FROM weapons w WHERE w.id = v_weapon_id;
  END IF;

  INSERT INTO exchange_records (player_id, shop_id) VALUES (v_player_id, p_shop_id) ON CONFLICT DO NOTHING;

  RETURN json_build_object('success', true, 'reward_name', v_shop.reward_weapon_name);
END;
$$;

-- ============================================================
-- claim_raid_rewards 更新（黒龍の鱗・逆鱗ドロップ追加）
-- ============================================================
CREATE OR REPLACE FUNCTION claim_raid_rewards(p_raid_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id        uuid;
  v_boss             raid_boss%ROWTYPE;
  v_participant      raid_participants%ROWTYPE;
  v_total_eff        bigint;
  v_my_eff           bigint;
  v_contribution     float;
  v_gold             int;
  v_stone_name       text;
  v_stone_count      int;
  v_stone_item_id    int;
  v_gem_count        int;
  v_gem_type         text;
  v_gem_rank         text;
  v_gem_types        text[] := ARRAY[
    'peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'
  ];
  v_existing_gem_id  uuid;
  v_i                int;
  v_scale_count      int;
  v_scale_item_id    int;
  v_gyaku_item_id    int;
  v_gyaku_chance     float;
  v_got_gyaku        boolean := false;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status != 'defeated' THEN RETURN json_build_object('error', 'ボスはまだ討伐されていません'); END IF;

  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', '参加記録がありません'); END IF;
  IF v_participant.reward_claimed THEN RETURN json_build_object('error', '既にリワードを受け取り済みです'); END IF;

  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff      := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  IF v_contribution >= 0.3 THEN
    v_gold := 40000; v_stone_name := '強化石(B)'; v_stone_count := 1; v_gem_count := 3; v_gem_rank := 'D';
    v_scale_count := 5; v_gyaku_chance := 0.30;
  ELSIF v_contribution >= 0.1 THEN
    v_gold := 25000; v_stone_name := '強化石(C)'; v_stone_count := 1; v_gem_count := 2; v_gem_rank := 'E';
    v_scale_count := 3; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.03 THEN
    v_gold := 15000; v_stone_name := '強化石(D)'; v_stone_count := 1; v_gem_count := 2; v_gem_rank := 'F';
    v_scale_count := 2; v_gyaku_chance := 0.05;
  ELSE
    v_gold := 5000; v_stone_name := '強化石(F)'; v_stone_count := 1; v_gem_count := 1; v_gem_rank := 'F';
    v_scale_count := 1; v_gyaku_chance := 0.0;
  END IF;

  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
  IF v_stone_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_stone_item_id, v_stone_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_stone_count;
  END IF;

  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  SELECT id INTO v_scale_item_id FROM items WHERE name = '黒龍の鱗' LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = '黒龍の逆鱗' LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  UPDATE raid_participants SET reward_claimed = true WHERE id = v_participant.id;

  RETURN json_build_object(
    'success',          true,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold,
    'stone',            v_stone_name,
    'stone_count',      v_stone_count,
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank,
    'scale_count',      v_scale_count,
    'got_gyaku',        v_got_gyaku
  );
END;
$$;
