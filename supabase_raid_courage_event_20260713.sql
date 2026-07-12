-- ============================================================
-- レイドボスイベント「勇気の証」（2026-07-13 〜 2026-07-27）
--   期間: JST 2026/07/13 05:00 〜 2026/07/27 04:59
--         （UTC 2026-07-12 20:00 〜 2026-07-26 20:00 未満）
--
--   ① レイドボスの報酬を受け取るたびに「勇気の証」×2 を獲得
--      さらに Cティア以上（A/B/C）の報酬なら +1（＝合計3個）
--      ※イベント期間内のみ付与
--   ② 交換所に「勇気の証」タブを追加し、下記10種を交換可能に
--
--   土台: supabase_raid_top3_relax25_20260712.sql（claim_raid_rewards 最新版）
--         supabase_race_fix_20260611.sql（do_exchange 在庫ガード版）
--         supabase_exchange.sql（exchange_shop / exchange_records）
--
--   ★適用順: raid 系（top3_relax25）より後・mutant_gold_20260703.sql より前でOK。
--            claim_raid_rewards / do_exchange のみ再定義（他関数には触れない）。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- ============================================================
-- 0) 素材アイテム「勇気の証」
-- ============================================================
INSERT INTO items (name, description, effect, value) VALUES
  ('勇気の証', 'レイドボスイベントの証。交換所（勇気の証タブ）でアイテムと交換できる。', 'material', 0)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1) exchange_shop に reward_qty 列を追加（報酬個数・ゴールド報酬額）
--    weapon: 未使用(常に1) / item: 付与個数 / gold: 付与ゴールド額
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_shop' AND column_name = 'reward_qty'
  ) THEN
    ALTER TABLE exchange_shop ADD COLUMN reward_qty int NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ============================================================
-- 2) do_exchange 再定義（reward_qty 個数付与＋ゴールド報酬対応）
--    ベース: supabase_race_fix_20260611.sql（在庫ガード版）
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
  v_reward_item_id int;
  v_reward_qty int;
  v_done_count int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_shop FROM exchange_shop WHERE id = p_shop_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('error', '交換項目が見つかりません'); END IF;

  v_reward_qty := GREATEST(COALESCE(v_shop.reward_qty, 1), 1);

  -- 回数制限（max_per_player が NULL なら無制限）
  IF v_shop.max_per_player IS NOT NULL THEN
    SELECT COALESCE(SUM(exchange_count), 0) INTO v_done_count
    FROM exchange_records WHERE player_id = v_player_id AND shop_id = p_shop_id;
    IF v_done_count >= v_shop.max_per_player THEN
      RETURN json_build_object('error', '交換回数の上限に達しています');
    END IF;
  END IF;

  -- 素材所持確認（ユーザー向けエラーメッセージ用の事前チェック）
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    IF v_item_id IS NULL THEN RETURN json_build_object('error', v_item_name || 'が存在しません'); END IF;
    SELECT COALESCE(quantity, 0) INTO v_held FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id;
    IF v_held IS NULL OR v_held < v_qty THEN
      RETURN json_build_object('error', v_item_name || 'が不足しています（必要: ' || v_qty || '個、所持: ' || COALESCE(v_held, 0) || '個）');
    END IF;
  END LOOP;

  -- 素材消費（★在庫ガード付き: 同時実行で負数になる前に弾いてロールバック）
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    UPDATE player_items SET quantity = quantity - v_qty
    WHERE player_id = v_player_id AND item_id = v_item_id AND quantity >= v_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%が不足しています', v_item_name;
    END IF;
    DELETE FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id AND quantity <= 0;
  END LOOP;

  -- 報酬付与
  IF v_shop.reward_type = 'weapon' THEN
    SELECT id INTO v_weapon_id FROM weapons WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_weapon_id IS NULL THEN RETURN json_build_object('error', '報酬装備が見つかりません'); END IF;
    INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
    SELECT v_player_id, v_weapon_id, w.slot, false, 0, v_shop.reward_bonus_effect
    FROM weapons w WHERE w.id = v_weapon_id;
    v_reward_qty := 1;

  ELSIF v_shop.reward_type = 'item' THEN
    SELECT id INTO v_reward_item_id FROM items WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_reward_item_id IS NULL THEN RETURN json_build_object('error', '報酬アイテムが見つかりません'); END IF;
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_reward_item_id, v_reward_qty, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_reward_qty;

  ELSIF v_shop.reward_type = 'gold' THEN
    -- reward_qty をゴールド額として profiles.gold へ加算（保護トリガー対応）
    PERFORM set_config('app.allow_stat_change', 'on', true);
    UPDATE profiles SET gold = gold + v_reward_qty WHERE id = v_player_id;

  ELSE
    RETURN json_build_object('error', '不明な報酬種別です');
  END IF;

  -- 交換記録（回数加算）
  INSERT INTO exchange_records (player_id, shop_id, exchange_count)
  VALUES (v_player_id, p_shop_id, 1)
  ON CONFLICT (player_id, shop_id) DO UPDATE
  SET exchange_count = exchange_records.exchange_count + 1,
      exchanged_at   = now();

  RETURN json_build_object(
    'success',     true,
    'reward_name', v_shop.reward_weapon_name,
    'reward_type', v_shop.reward_type,
    'reward_qty',  CASE WHEN v_shop.reward_type = 'item' THEN v_reward_qty ELSE 1 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION do_exchange(int) TO authenticated;

-- ============================================================
-- 3) claim_raid_rewards 再定義（tier報酬＋上位3名報酬＋★勇気の証）
--    ベース: supabase_raid_top3_relax25_20260712.sql をそのまま踏襲し、
--            末尾に「勇気の証」付与（イベント期間内のみ）を追加。
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

  -- ★ボス別の素材名
  IF v_boss.boss_name = '雨摩座' THEN
    v_mat_name := '水禍の雫'; v_rare_name := '雨禍の心核';
  ELSIF v_boss.boss_name = '雷鋼機神ゼルギアス' THEN
    v_mat_name := '雷鋼片'; v_rare_name := '神雷炉心';
  ELSE
    v_mat_name := '黒龍の鱗'; v_rare_name := '黒龍の逆鱗';
  END IF;

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

-- ============================================================
-- 4) 交換所エントリー（勇気の証タブ・10種）
--    ※再実行しても重複しないよう name 単位で NOT EXISTS ガード。
--      exchange_records は shop_id 参照(ON DELETE CASCADE)のため、
--      既存エントリーは削除せず維持する。
-- ============================================================
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_qty, max_per_player, active, sort_order, tab)
SELECT * FROM (VALUES
  -- ▼ 勇気の証×10（各1回限定）
  ('勇気_強化石S3',  '勇気の証×10で交換。強化石(S)×3。',   '[{"item_name":"勇気の証","quantity":10}]'::jsonb, 'item', '強化石(S)',     3, 1,    true, 101, '勇気の証'),
  ('勇気_強化石A10', '勇気の証×10で交換。強化石(A)×10。',  '[{"item_name":"勇気の証","quantity":10}]'::jsonb, 'item', '強化石(A)',    10, 1,    true, 102, '勇気の証'),
  ('勇気_秘伝書V',   '勇気の証×10で交換。匠の秘伝書Ⅴ×1。','[{"item_name":"勇気の証","quantity":10}]'::jsonb, 'item', '匠の秘伝書Ⅴ',  1, 1,    true, 103, '勇気の証'),
  ('勇気_ゴールド100万','勇気の証×10で交換。100万G。',      '[{"item_name":"勇気の証","quantity":10}]'::jsonb, 'gold', '100万G',  1000000, 1,    true, 104, '勇気の証'),
  -- ▼ 勇気の証×5（各2回まで）
  ('勇気_強化石S1',  '勇気の証×5で交換。強化石(S)×1。',    '[{"item_name":"勇気の証","quantity":5}]'::jsonb,  'item', '強化石(S)',     1, 2,    true, 105, '勇気の証'),
  ('勇気_強化石A3',  '勇気の証×5で交換。強化石(A)×3。',    '[{"item_name":"勇気の証","quantity":5}]'::jsonb,  'item', '強化石(A)',     3, 2,    true, 106, '勇気の証'),
  ('勇気_秘伝書IV',  '勇気の証×5で交換。匠の秘伝書Ⅳ×1。', '[{"item_name":"勇気の証","quantity":5}]'::jsonb,  'item', '匠の秘伝書Ⅳ',  1, 2,    true, 107, '勇気の証'),
  ('勇気_ゴールド50万','勇気の証×5で交換。50万G。',         '[{"item_name":"勇気の証","quantity":5}]'::jsonb,  'gold', '50万G',    500000, 2,    true, 108, '勇気の証'),
  -- ▼ 勇気の証×3（交換制限なし）
  ('勇気_強化石A1',  '勇気の証×3で交換。強化石(A)×1。',    '[{"item_name":"勇気の証","quantity":3}]'::jsonb,  'item', '強化石(A)',     1, NULL, true, 109, '勇気の証'),
  ('勇気_ゴールド10万','勇気の証×3で交換。10万G。',         '[{"item_name":"勇気の証","quantity":3}]'::jsonb,  'gold', '10万G',    100000, NULL, true, 110, '勇気の証')
) AS v(name, description, cost_items, reward_type, reward_weapon_name, reward_qty, max_per_player, active, sort_order, tab)
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop es WHERE es.name = v.name AND es.tab = '勇気の証');
