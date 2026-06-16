-- ============================================================
-- 改名: 「あまざ」→「雨摩座」（ライブDB一括）
--   ① 既存レイドボス行の名前変更
--   ② raid_boss_for_slot / claim_raid_rewards をボス名「雨摩座」基準に更新
--   ③ アイテム説明・お知らせ本文の「あまざ」を「雨摩座」に置換
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ① 既存ボス行
UPDATE raid_boss SET boss_name = '雨摩座' WHERE boss_name = 'あまざ';

-- ③ アイテム説明・お知らせの文言
UPDATE items SET description = REPLACE(description, 'あまざ', '雨摩座') WHERE description LIKE '%あまざ%';
UPDATE exchange_shop SET description = REPLACE(description, 'あまざ', '雨摩座') WHERE description LIKE '%あまざ%';
UPDATE announcements SET title = REPLACE(title, 'あまざ', '雨摩座'), content = REPLACE(content, 'あまざ', '雨摩座')
  WHERE title LIKE '%あまざ%' OR content LIKE '%あまざ%';

-- ② 出現ボス名（日替わり交互）
CREATE OR REPLACE FUNCTION raid_boss_for_slot(p_date date, p_slot int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ((p_date - DATE '2000-01-01') % 2) = 0 THEN
      CASE WHEN p_slot = 21 THEN '黒龍ヴァルゼノク' ELSE '雨摩座' END
    ELSE
      CASE WHEN p_slot = 21 THEN '雨摩座' ELSE '黒龍ヴァルゼノク' END
  END
$$;

-- ② 報酬関数のボス別素材判定を「雨摩座」に
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
  v_mat_name      text;
  v_rare_name     text;
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
    v_tier := 'A'; v_gold := 150000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 2; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.06 OR v_participant.attack_count >= 20 THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.03 OR v_participant.attack_count >= 5 THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  IF v_boss.boss_name = '雨摩座' THEN
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

  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

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
