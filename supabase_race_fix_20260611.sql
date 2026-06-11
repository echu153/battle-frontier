-- ============================================================
-- 二重実行レース対策 (2026-06-11)
--   ① claim_raid_rewards: reward_claimed のチェック→付与→更新の間に
--      ロックが無く、同時リクエストで報酬を二重取得できた。
--      → 先に reward_claimed を原子的に立てて(UPDATE ... AND NOT reward_claimed)、
--        取れなかったら受取済みとして弾く方式に変更。
--   ② do_exchange: 所持確認と消費の間にロックが無く、同時実行で
--      素材が負数になり報酬を二重取得できた。
--      → 消費UPDATEに quantity >= 必要数 ガードを付け、失敗したら
--        RAISE EXCEPTION でトランザクションごとロールバック。
--   ※ どちらも supabase_raid_update_20260610.sql の関数を完全置換。
--   ※ Gold加算前の set_config('app.allow_stat_change') は維持（保護トリガー対応）。
-- ============================================================

-- ① claim_raid_rewards（原子的クレーム版）
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
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  -- 討伐成功(defeated)だけでなく時間切れ(expired)でも、その時点の貢献度で報酬獲得可
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  -- ★ 原子的クレーム: 先に reward_claimed を立てる。
  --    同時リクエストでも片方しか成功しない（二重受け取り防止）。
  UPDATE raid_participants SET reward_claimed = true
  WHERE raid_id = p_raid_id AND player_id = v_player_id AND NOT reward_claimed
  RETURNING * INTO v_participant;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id) THEN
      RETURN json_build_object('error', '既にリワードを受け取り済みです');
    END IF;
    RETURN json_build_object('error', '参加記録がありません');
  END IF;

  -- 有効スコアで貢献度計算（出撃1回=500ボーナス）
  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff       := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  -- ティア決定（貢献度 or 出撃回数のどちらか高い方）
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

  -- Gold付与（保護トリガー対応）
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  -- 強化石付与（各ランク×3）
  FOREACH v_rank IN ARRAY v_stone_ranks LOOP
    v_stone_name := '強化石(' || v_rank || ')';
    SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
    IF v_stone_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_stone_item_id, 3, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 3;
    END IF;
  END LOOP;

  -- 宝石付与
  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- 黒龍の鱗
  SELECT id INTO v_scale_item_id FROM items WHERE name = '黒龍の鱗' LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- 黒龍の逆鱗（確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = '黒龍の逆鱗' LIMIT 1;
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
    'got_gyaku',        v_got_gyaku
  );
END;
$$;

-- ② do_exchange（素材消費に在庫ガード版）
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
  v_done_count int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_shop FROM exchange_shop WHERE id = p_shop_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('error', '交換項目が見つかりません'); END IF;

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
      -- ここまでの消費・付与を全て巻き戻す（json返却だとコミットされてしまうため例外で）
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
  ELSIF v_shop.reward_type = 'item' THEN
    SELECT id INTO v_reward_item_id FROM items WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_reward_item_id IS NULL THEN RETURN json_build_object('error', '報酬アイテムが見つかりません'); END IF;
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_reward_item_id, 1, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
  END IF;

  -- 交換記録（回数加算）
  INSERT INTO exchange_records (player_id, shop_id, exchange_count)
  VALUES (v_player_id, p_shop_id, 1)
  ON CONFLICT (player_id, shop_id) DO UPDATE
  SET exchange_count = exchange_records.exchange_count + 1,
      exchanged_at   = now();

  RETURN json_build_object('success', true, 'reward_name', v_shop.reward_weapon_name);
END;
$$;
