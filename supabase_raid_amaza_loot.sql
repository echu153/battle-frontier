-- ============================================================
-- あまざ専用 素材＋交換所（ヴァルゼノクの黒龍素材と対になる水禍素材）
--   ・通常素材: 水禍の雫 / レア素材: 雨禍の心核
--   ・claim_raid_rewards をボス別ドロップに（あまざ=水禍素材 / ヴァルゼノク=黒龍素材）
--   ・交換所3種（濡羽杖アマザネ/哭雨の羽衣/水禍の蒼珠）
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 1) 素材アイテム
INSERT INTO items (name, description, effect, value) VALUES
  ('水禍の雫',   'あまざの水禍の雫。交換所で使用できる。', 'material', 0),
  ('雨禍の心核', 'あまざの雨禍の心核。極めて希少な素材。交換所で使用できる。', 'material', 0)
ON CONFLICT DO NOTHING;

-- 2) 交換報酬の武器
--   濡羽杖アマザネ(杖S): 特攻80/特防20 ＋ 攻撃ヒット時 対象SPD-5%
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '濡羽杖アマザネ', 'staff', 'weapon', 's', 0, 0, 80, 20, 0
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '濡羽杖アマザネ');
--   哭雨の羽衣(防具S): 特攻20/特防80 ＋ 開幕1回だけ状態異常無効バフ
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '哭雨の羽衣', null, 'armor', 's', 0, 0, 20, 80, 0
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '哭雨の羽衣');
--   水禍の蒼珠(装飾A): 特攻20/特防20/素早さ10 ＋ 魔法防御貫通+5%
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '水禍の蒼珠', null, 'accessory', 'a', 0, 0, 20, 20, 10
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '水禍の蒼珠');

-- 3) 交換所エントリー（タブ=レイドボス）。コストはヴァルゼノク装備と同等
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '濡羽杖アマザネ',
       'S級杖。特攻80 特防20。攻撃ヒット時、対象の素早さ-5%。',
       '[{"item_name": "水禍の雫", "quantity": 50}, {"item_name": "雨禍の心核", "quantity": 1}]'::jsonb,
       'weapon', '濡羽杖アマザネ', 'hit_spd_down_5', 5, true, 11, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '濡羽杖アマザネ');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '哭雨の羽衣',
       'S級防具。特攻20 特防80。戦闘開始時、1回だけ状態異常を無効化するバフを獲得。',
       '[{"item_name": "水禍の雫", "quantity": 50}, {"item_name": "雨禍の心核", "quantity": 1}]'::jsonb,
       'weapon', '哭雨の羽衣', 'battle_start_ailment_shield', 5, true, 12, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '哭雨の羽衣');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '水禍の蒼珠',
       'A級装飾品。特攻20 特防20 素早さ10。魔法防御貫通+5%。',
       '[{"item_name": "水禍の雫", "quantity": 25}]'::jsonb,
       'weapon', '水禍の蒼珠', 'mdef_pen_5', null, true, 13, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '水禍の蒼珠');

-- 4) claim_raid_rewards をボス別ドロップに（あまざ=水禍素材／ヴァルゼノク=黒龍素材）
CREATE OR REPLACE FUNCTION claim_raid_rewards(p_raid_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id     uuid;
  v_boss          raid_boss%ROWTYPE;
  v_participant   raid_participants%ROWTYPE;
  v_total_eff     bigint;
  v_my_eff        bigint;
  v_contribution  float;
  v_tier          text;
  v_gold          int;
  v_stone_ranks   text[];
  v_stone_name    text;
  v_stone_item_id int;
  v_gem_count     int;
  v_gem_type      text;
  v_gem_rank      text;
  v_gem_types     text[] := ARRAY['peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'];
  v_existing_gem_id uuid;
  v_i             int;
  v_rank          text;
  v_scale_min     int;
  v_scale_max     int;
  v_scale_count   int;
  v_scale_item_id int;
  v_gyaku_item_id int;
  v_gyaku_chance  float;
  v_got_gyaku     boolean := false;
  v_mat_name      text;   -- 通常素材名（ボス別）
  v_rare_name     text;   -- レア素材名（ボス別）
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', '参加記録がありません'); END IF;
  IF v_participant.reward_claimed THEN RETURN json_build_object('error', '既にリワードを受け取り済みです'); END IF;

  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff       := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  IF v_contribution >= 0.10 OR v_participant.attack_count >= 50 THEN
    v_tier := 'A'; v_gold := 50000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 3; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.06 OR v_participant.attack_count >= 20 THEN
    v_tier := 'B'; v_gold := 30000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.03 OR v_participant.attack_count >= 5 THEN
    v_tier := 'C'; v_gold := 10000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 1; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 5000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 1; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名
  IF v_boss.boss_name = 'あまざ' THEN
    v_mat_name := '水禍の雫'; v_rare_name := '雨禍の心核';
  ELSE
    v_mat_name := '黒龍の鱗'; v_rare_name := '黒龍の逆鱗';
  END IF;

  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  FOREACH v_rank IN ARRAY v_stone_ranks LOOP
    v_stone_name := '強化石(' || v_rank || ')';
    SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
    IF v_stone_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_stone_item_id, 3, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 3;
    END IF;
  END LOOP;

  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- 通常素材（鱗 / 水禍の雫）
  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- レア素材（逆鱗 / 雨禍の心核）（確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = v_rare_name LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  UPDATE raid_participants SET reward_claimed = true WHERE id = v_participant.id;

  RETURN json_build_object(
    'success', true, 'tier', v_tier,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold', v_gold, 'stones', to_json(v_stone_ranks),
    'gem_count', v_gem_count, 'gem_rank', v_gem_rank,
    'scale_count', v_scale_count, 'got_gyaku', v_got_gyaku,
    'mat_name', v_mat_name, 'rare_name', v_rare_name
  );
END;
$$;
