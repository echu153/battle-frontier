-- ============================================================
-- 新レイドボス：雷鋼機神ゼルギアス（3体目）
--   ・通常素材: 雷鋼片 / レア素材: 神雷炉心
--   ・3体ローテ化（21時/22時の2枠を3日周期で全員が回る）
--       d = (spawn_date - 2000-01-01) % 3
--       21時 = cycle[d] / 22時 = cycle[d+1]  cycle=[ヴァルゼノク, 雨摩座, ゼルギアス]
--   ・交換所3種（雷鋼の機神鎧/蒼雷の短刃/神雷の環）＋ 強化石(S) 2種
--   ・claim_raid_rewards にボス別ドロップ分岐を追加（最新版=20260621 に追従）
--   Supabase の SQL Editor でファイル全体を実行してください（protect_stats より後でOK）。
-- ============================================================

-- 1) 素材アイテム
INSERT INTO items (name, description, effect, value) VALUES
  ('雷鋼片', '雷鋼機神ゼルギアスの雷鋼片。交換所で使用できる。', 'material', 0),
  ('神雷炉心', 'ゼルギアスの神雷炉心。極めて希少な素材。交換所で使用できる。', 'material', 0)
ON CONFLICT DO NOTHING;

-- 2) 交換報酬の装備（武器テーブル）
--   雷鋼の機神鎧(防具S): 防御60/特防40 ＋ 麻痺になる確率を50%軽減
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '雷鋼の機神鎧', 'armor', 'armor', 's', 0, 60, 0, 40, 0
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '雷鋼の機神鎧');
--   蒼雷の短刃(武器S/短剣): 攻撃40/素早さ60 ＋ 追加行動の攻撃ヒット時 30%で相手を麻痺
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼雷の短刃', 'dagger', 'weapon', 's', 40, 0, 0, 0, 60
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '蒼雷の短刃');
--   神雷の環(装飾A): 防御10/素早さ40 ＋ 素早さ+10%（spd_bonus_pct）
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus, spd_bonus_pct)
SELECT '神雷の環', 'accessory', 'accessory', 'a', 0, 10, 0, 0, 40, 10
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '神雷の環');

-- 3) 交換所エントリー（タブ=レイドボス）。コストはヴァルゼノク/雨摩座装備と同等
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '雷鋼の機神鎧',
       'S級防具。防御60 特防40。麻痺になる確率を50%軽減する。',
       '[{"item_name": "雷鋼片", "quantity": 50}, {"item_name": "神雷炉心", "quantity": 1}]'::jsonb,
       'weapon', '雷鋼の機神鎧', 'paralysis_resist_50', 5, true, 14, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '雷鋼の機神鎧');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '蒼雷の短刃',
       'S級短剣。攻撃40 素早さ60。追加行動の攻撃ヒット時、30%で相手を麻痺させる。',
       '[{"item_name": "雷鋼片", "quantity": 50}, {"item_name": "神雷炉心", "quantity": 1}]'::jsonb,
       'weapon', '蒼雷の短刃', 'extra_hit_paralysis_30', 5, true, 15, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '蒼雷の短刃');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '神雷の環',
       'A級装飾品。防御10 素早さ40。素早さ+10%。',
       '[{"item_name": "雷鋼片", "quantity": 25}]'::jsonb,
       'weapon', '神雷の環', null, null, true, 16, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '神雷の環');

-- 強化石(S)（ゼルギアス素材版・無制限）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【雷鋼片】',
       'S級強化石1個と交換。',
       '[{"item_name": "雷鋼片", "quantity": 70}]'::jsonb,
       'item', '強化石(S)', null, null, true, 25, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【雷鋼片】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【神雷炉心】',
       'S級強化石1個と交換。',
       '[{"item_name": "神雷炉心", "quantity": 2}]'::jsonb,
       'item', '強化石(S)', null, null, true, 26, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【神雷炉心】');

-- 4) 3体ローテのボス名関数（21時=cycle[d] / 22時=cycle[d+1]・3日周期）
CREATE OR REPLACE FUNCTION raid_boss_for_slot(p_date date, p_slot int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['黒龍ヴァルゼノク','雨摩座','雷鋼機神ゼルギアス'])[
    CASE WHEN p_slot = 21
      THEN ((((p_date - DATE '2000-01-01') % 3) + 3) % 3) + 1
      ELSE (((((p_date - DATE '2000-01-01') % 3) + 3) % 3 + 1) % 3) + 1
    END
  ]
$$;

-- 5) claim_raid_rewards：ボス別素材ドロップにゼルギアスを追加（最新版 20260621 に追従）
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
  v_tier             text;
  v_gold             int;
  v_stone_ranks      text[];
  v_stone_name       text;
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
  v_rank             text;
  v_scale_min        int;
  v_scale_max        int;
  v_scale_count      int;
  v_scale_item_id    int;
  v_gyaku_item_id    int;
  v_gyaku_chance     float;
  v_got_gyaku        boolean := false;
  v_atk_a            int := 20;
  v_atk_b            int := 10;
  v_atk_c            int := 5;
  v_mat_name         text;
  v_rare_name        text;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  -- 原子的クレーム
  UPDATE raid_participants SET reward_claimed = true
  WHERE raid_id = p_raid_id AND player_id = v_player_id AND NOT reward_claimed
  RETURNING * INTO v_participant;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id) THEN
      RETURN json_build_object('error', '既にリワードを受け取り済みです');
    END IF;
    RETURN json_build_object('error', '参加記録がありません');
  END IF;

  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff       := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  IF v_contribution >= 0.10 OR v_participant.attack_count >= v_atk_a THEN
    v_tier := 'A'; v_gold := 150000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 2; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.06 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.03 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名（ゼルギアスを追加）
  IF v_boss.boss_name = '雨摩座' THEN
    v_mat_name := '水禍の雫'; v_rare_name := '雨禍の心核';
  ELSIF v_boss.boss_name = '雷鋼機神ゼルギアス' THEN
    v_mat_name := '雷鋼片'; v_rare_name := '神雷炉心';
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
      VALUES (v_player_id, v_stone_item_id, 2, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 2;
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

  -- 通常素材（ボス別）
  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- レア素材（ボス別・確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = v_rare_name LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  RETURN json_build_object(
    'success',          true,
    'tier',             v_tier,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold,
    'stones',           to_json(v_stone_ranks),
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank,
    'scale_count',      v_scale_count,
    'got_gyaku',        v_got_gyaku,
    'mat_name',         v_mat_name,
    'rare_name',        v_rare_name
  );
END;
$$;
