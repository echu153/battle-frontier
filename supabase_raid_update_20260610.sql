-- ============================================================
-- レイドボス アップデート 2026-06-10
--  ① ヴァルゼノク HP 100万（spawn RPC）
--  ② 30分で討伐できなかった場合（expired）でも、その時点の貢献度で討伐報酬を受け取れる
--  ③ 出撃回数ティア保証: 50回→Aティア / 20回→Bティア / 5回→Cティア
--  ④ 交換所: マレディクシオン（銃S）追加 / 強化石(S) 交換追加（鱗×70 or 逆鱗×2）
--  ⑤ do_exchange を item 報酬対応に更新
-- ※ supabase_protect_stats.sql 適用済み環境を想定（claim 内で GUC を立ててから profiles を更新）
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ============================================================
-- ① スポーンRPC（HP 1,000,000）
-- ============================================================
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_jst_hour  int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
BEGIN
  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_jst_hour := EXTRACT(hour FROM v_jst_now)::int;

  -- 21時前: アクティブなボスがあれば返す
  IF v_jst_hour < 21 THEN
    SELECT * INTO v_boss FROM raid_boss WHERE status = 'active' ORDER BY spawn_date DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN
        UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
        v_boss.status := 'expired';
      END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object(
          'status', v_boss.status, 'id', v_boss.id,
          'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
          'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
          'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
        );
      END IF;
    END IF;
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object(
        'status', v_boss.status, 'id', v_boss.id,
        'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
        'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
        'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
      );
    END IF;
    RETURN json_build_object(
      'status', 'waiting',
      'next_spawn', (v_jst_date::text || 'T21:00:00+09:00')
    );
  END IF;

  -- 21時以降: 今日のボスを取得または生成（HP 100万）
  SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  IF NOT FOUND THEN
    UPDATE raid_boss SET status = 'expired' WHERE status = 'active' AND spawn_date < v_jst_date;

    INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at)
    VALUES (v_jst_date, '黒龍ヴァルゼノク', 1000000, 1000000, 'active', now())
    ON CONFLICT (spawn_date) DO NOTHING;

    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  END IF;

  IF v_boss.status = 'active' THEN
    v_expire_at := v_boss.spawned_at + interval '30 minutes';
    IF now() > v_expire_at THEN
      UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
      v_boss.status := 'expired';
    END IF;
  END IF;

  RETURN json_build_object(
    'status', v_boss.status, 'id', v_boss.id,
    'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
    'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
    'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
  );
END;
$$;

-- ============================================================
-- ②③ リワード受け取り（expired でも受け取り可＋出撃回数ティア保証）
--  ティア: A=貢献10%+ or 出撃50回+ / B=貢献6%+ or 出撃20回+
--          C=貢献3%+ or 出撃5回+  / D=参加
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
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  -- 討伐成功(defeated)だけでなく時間切れ(expired)でも、その時点の貢献度で報酬獲得可
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', '参加記録がありません'); END IF;
  IF v_participant.reward_claimed THEN RETURN json_build_object('error', '既にリワードを受け取り済みです'); END IF;

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

  UPDATE raid_participants SET reward_claimed = true WHERE id = v_participant.id;

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

-- ============================================================
-- ④ 交換所: マレディクシオン＋強化石(S)
-- ============================================================

-- max_per_player の NULL（無制限）許可＆exchange_count カラム保証
ALTER TABLE exchange_shop ALTER COLUMN max_per_player DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_records' AND column_name = 'exchange_count'
  ) THEN
    ALTER TABLE exchange_records ADD COLUMN exchange_count int NOT NULL DEFAULT 1;
  END IF;
END $$;

-- 武器: マレディクシオン（銃S 攻撃60 特攻60 素早さ10）
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT 'マレディクシオン', 'gun', 'weapon', 's', 60, 0, 60, 0, 10
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = 'マレディクシオン');

-- 交換所エントリー（再実行しても重複しないよう NOT EXISTS ガード）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT 'マレディクシオン',
       'S級銃。攻撃ヒット時、2ターンの間対象の回復力-10%。',
       '[{"item_name": "黒龍の鱗", "quantity": 50}, {"item_name": "黒龍の逆鱗", "quantity": 1}]'::jsonb,
       'weapon', 'マレディクシオン', 'hit_heal_down_10_2t', 5, true, 3, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = 'マレディクシオン');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【鱗】',
       'S級強化石1個と交換。',
       '[{"item_name": "黒龍の鱗", "quantity": 70}]'::jsonb,
       'item', '強化石(S)', null, null, true, 4, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【鱗】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【逆鱗】',
       'S級強化石1個と交換。',
       '[{"item_name": "黒龍の逆鱗", "quantity": 2}]'::jsonb,
       'item', '強化石(S)', null, null, true, 5, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【逆鱗】');

-- ============================================================
-- ⑤ do_exchange（item 報酬対応＋回数制限・カウント対応）
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

  -- 素材所持確認
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
