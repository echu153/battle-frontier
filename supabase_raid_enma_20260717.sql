-- ============================================================
-- 新レイドボス：閻魔（4体目）
--   ・通常素材: 獄王の断罪片 / レア素材: 閻魔の審判核
--   ・出現枠: 21時/22時の2枠のうち「必ず1枠」が閻魔（＝全出現の1/2）。
--       残り1枠を旧3体（ヴァルゼノク/雨摩座/ゼルギアス）が3日周期で回る。
--       d = (spawn_date - 2000-01-01)
--       d が偶数 → 21時=閻魔 / 22時=旧3体   d が奇数 → 21時=旧3体 / 22時=閻魔
--       ※ RaidBoss.jsx の同名ロジックと必ず一致させること（ズレると予告と実出現が食い違う）
--   ・交換所3種（冥獄宝珠・断罪／冥府王の獄衣／六道輪廻の数珠・全てS級）＋ 強化石(S) 2種
--   ・claim_raid_rewards は最新版（supabase_raid_courage_event_20260713.sql）を土台に、
--     ボス別素材の分岐を raid_boss_mats() へ一元化して再定義
--
--   Supabase の SQL Editor でファイル全体を実行してください（protect_stats より後でOK）。
--   ※ supabase_mutant_gold_20260703.sql より前に実行すること（適用順の鉄則）。
-- ============================================================

-- 1) 素材アイテム
INSERT INTO items (name, description, effect, value) VALUES
  ('獄王の断罪片', '閻魔の断罪片。交換所で使用できる。', 'material', 0),
  ('閻魔の審判核', '閻魔の審判核。極めて希少な素材。交換所で使用できる。', 'material', 0)
ON CONFLICT DO NOTHING;

-- 2) 交換報酬の装備（武器テーブル）
--   冥獄宝珠・断罪(武器S/オーブ): 特殊攻撃60/素早さ40 ＋ 攻撃ヒット時20%で毒
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '冥獄宝珠・断罪', 'orb', 'weapon', 's', 0, 0, 60, 0, 40
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '冥獄宝珠・断罪');
--   冥府王の獄衣(防具S): 特殊攻撃30/防御35/魔法防御35 ＋ 被ダメージ-5%（HP半分以下で-10%）
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '冥府王の獄衣', 'armor', 'armor', 's', 0, 35, 30, 35, 0
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '冥府王の獄衣');
--   六道輪廻の数珠(装飾S): 特殊攻撃70/攻撃30 ＋ 攻撃力の2%を特殊攻撃に加算
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '六道輪廻の数珠', 'accessory', 'accessory', 's', 30, 0, 70, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = '六道輪廻の数珠');

-- 3) 交換所エントリー（タブ=レイドボス）。コスト/上限は既存レイド装備と同等（S級=通常50+レア1・上限5）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '冥獄宝珠・断罪',
       'S級オーブ。特殊攻撃60 素早さ40。攻撃ヒット時、20%の確率で毒を付与。',
       '[{"item_name": "獄王の断罪片", "quantity": 50}, {"item_name": "閻魔の審判核", "quantity": 1}]'::jsonb,
       'weapon', '冥獄宝珠・断罪', 'hit_poison_20', 5, true, 17, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '冥獄宝珠・断罪');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '冥府王の獄衣',
       'S級防具。特殊攻撃30 防御35 魔法防御35。受けるダメージを5%軽減（HPが半分以下の場合は10%軽減）。',
       '[{"item_name": "獄王の断罪片", "quantity": 50}, {"item_name": "閻魔の審判核", "quantity": 1}]'::jsonb,
       'weapon', '冥府王の獄衣', 'dmg_taken_down_5_hp50_x2', 5, true, 18, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '冥府王の獄衣');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '六道輪廻の数珠',
       'S級装飾品。特殊攻撃70 攻撃30。攻撃力の2%を特殊攻撃に加算。',
       '[{"item_name": "獄王の断罪片", "quantity": 50}, {"item_name": "閻魔の審判核", "quantity": 1}]'::jsonb,
       'weapon', '六道輪廻の数珠', 'atk_to_matk_2', 5, true, 19, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '六道輪廻の数珠');

-- 強化石(S)（閻魔素材版・無制限）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【獄王の断罪片】',
       'S級強化石1個と交換。',
       '[{"item_name": "獄王の断罪片", "quantity": 70}]'::jsonb,
       'item', '強化石(S)', null, null, true, 27, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【獄王の断罪片】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【閻魔の審判核】',
       'S級強化石1個と交換。',
       '[{"item_name": "閻魔の審判核", "quantity": 2}]'::jsonb,
       'item', '強化石(S)', null, null, true, 28, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【閻魔の審判核】');

-- 4) ボス→ドロップ素材の対応表（新ボス追加時はここだけ直せばよい）
--    claim_raid_rewards 内の IF チェーンに分岐を足し忘れると、黙って黒龍素材が配られていたため関数化。
CREATE OR REPLACE FUNCTION raid_boss_mats(p_boss text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_boss
    WHEN '雨摩座'             THEN ARRAY['水禍の雫',     '雨禍の心核']
    WHEN '雷鋼機神ゼルギアス' THEN ARRAY['雷鋼片',       '神雷炉心']
    WHEN '閻魔'               THEN ARRAY['獄王の断罪片', '閻魔の審判核']
    WHEN '黒龍ヴァルゼノク'   THEN ARRAY['黒龍の鱗',     '黒龍の逆鱗']
    ELSE ARRAY['黒龍の鱗', '黒龍の逆鱗']  -- 未知のボス名は従来通り黒龍素材（後方互換）
  END
$$;

-- 5) 出現ボス（2枠のうち必ず1枠が閻魔＝全出現の1/2。残り1枠は旧3体が3日周期）
CREATE OR REPLACE FUNCTION raid_boss_for_slot(p_date date, p_slot int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- d が偶数の日は21時が閻魔、奇数の日は22時が閻魔（時間帯が偏らないよう日替わりで入れ替え）
    WHEN (p_slot = 21) = (((((p_date - DATE '2000-01-01') % 2) + 2) % 2) = 0) THEN '閻魔'
    ELSE (ARRAY['黒龍ヴァルゼノク','雨摩座','雷鋼機神ゼルギアス'])[
           ((((p_date - DATE '2000-01-01') % 3) + 3) % 3) + 1
         ]
  END
$$;

-- 6) claim_raid_rewards 再定義
--    ベース: supabase_raid_courage_event_20260713.sql（上位3名報酬＋匠の秘伝書＋勇気の証を含む最新版）
--    変更点: ボス別素材の IF チェーン → raid_boss_mats() 呼び出しに一元化（閻魔対応もこれで入る）
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
  v_atk_a            int := 40;
  v_atk_b            int := 20;
  v_atk_c            int := 10;
  v_mat_name         text;
  v_rare_name        text;
  v_mats             text[];
  v_book_name        text;
  v_book_item_id     int;
  v_dmg_rank         int;
  v_top_book         text;
  v_top_gold         int := 0;
  v_top_book_item_id int;
  -- ★勇気の証イベント
  v_courage          int := 0;
  v_courage_item_id  int;
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

  IF v_contribution >= 0.07 OR v_participant.attack_count >= v_atk_a THEN
    v_tier := 'A'; v_gold := 150000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 2; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.04 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.02 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名（raid_boss_mats に一元化。新ボス追加時はその関数だけ直せば足りる＝
  --   ここに分岐を足し忘れて黙って黒龍素材が配られる、を再発させない）
  v_mats      := raid_boss_mats(v_boss.boss_name);
  v_mat_name  := v_mats[1];
  v_rare_name := v_mats[2];

  -- ★匠の秘伝書（C=Ⅰ / B=Ⅱ / A=Ⅲ・Dは無し）
  v_book_name := CASE v_tier
    WHEN 'A' THEN '匠の秘伝書Ⅲ'
    WHEN 'B' THEN '匠の秘伝書Ⅱ'
    WHEN 'C' THEN '匠の秘伝書Ⅰ'
    ELSE NULL END;

  -- ★上位与ダメ3名への追加報酬
  v_dmg_rank := NULL;
  IF v_participant.damage_dealt > 0 THEN
    SELECT COUNT(*) + 1 INTO v_dmg_rank
    FROM raid_participants
    WHERE raid_id = p_raid_id AND damage_dealt > v_participant.damage_dealt;
  END IF;
  v_top_book := CASE v_dmg_rank
    WHEN 1 THEN '匠の秘伝書Ⅴ'
    WHEN 2 THEN '匠の秘伝書Ⅳ'
    WHEN 3 THEN '匠の秘伝書Ⅲ'
    ELSE NULL END;
  v_top_gold := CASE WHEN v_dmg_rank IS NOT NULL AND v_dmg_rank BETWEEN 1 AND 3 THEN 100000 ELSE 0 END;

  PERFORM set_config('app.allow_stat_change', 'on', true);
  -- Gold（tier報酬＋上位3名ボーナス）
  UPDATE profiles SET gold = gold + v_gold + v_top_gold WHERE id = v_player_id;

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

  -- ★匠の秘伝書付与（ティア別・1冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- ★上位与ダメ3名の追加秘伝書付与（1冊）
  IF v_top_book IS NOT NULL THEN
    SELECT id INTO v_top_book_item_id FROM items WHERE name = v_top_book LIMIT 1;
    IF v_top_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_top_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- ★勇気の証イベント（期間内のみ）: 参加報酬×2 ＋ Cティア以上で+1
  --   JST 2026/07/13 05:00 〜 2026/07/27 04:59（UTC 07-12 20:00 〜 07-26 20:00 未満）
  IF now() >= '2026-07-12 20:00:00+00'::timestamptz
     AND now() < '2026-07-26 20:00:00+00'::timestamptz THEN
    v_courage := 2 + CASE WHEN v_tier IN ('A','B','C') THEN 1 ELSE 0 END;
    SELECT id INTO v_courage_item_id FROM items WHERE name = '勇気の証' LIMIT 1;
    IF v_courage_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_courage_item_id, v_courage, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_courage;
    END IF;
  END IF;

  RETURN json_build_object(
    'success',          true,
    'tier',             v_tier,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold + v_top_gold,
    'stones',           to_json(v_stone_ranks),
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank,
    'scale_count',      v_scale_count,
    'got_gyaku',        v_got_gyaku,
    'mat_name',         v_mat_name,
    'rare_name',        v_rare_name,
    'book',             v_book_name,
    'top_rank',         v_dmg_rank,
    'top_book',         v_top_book,
    'top_gold',         v_top_gold,
    'courage',          v_courage      -- ★勇気の証 付与数（期間外は0）
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_raid_rewards(uuid) TO authenticated;
