-- ============================================================
-- 【緊急修正 2026-06-21】レイド報酬のボス別素材ドロップが効かない不具合
--   症状: 雨摩座を討伐しても通常素材が「黒龍の鱗」（ヴァルゼノク素材）で付与される。
--   原因: supabase_PUBLIC_LAUNCH_20260620.sql の claim_raid_rewards が
--         ボス名分岐の無い古い版（素材=黒龍の鱗 固定・返却JSONに mat_name 無し）で
--         上書き適用されていた。Gold/宝石/石の数値は公開時の調整値なので維持し、
--         「ボス別素材分岐」と「返却JSONに mat_name/rare_name を含める」だけを修正。
--   ・雨摩座      → 通常:水禍の雫 / レア:雨禍の心核
--   ・ヴァルゼノク → 通常:黒龍の鱗 / レア:黒龍の逆鱗
--   Supabase の SQL Editor でファイル全体を実行してください（protect_stats より後でOK）。
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
  v_atk_a            int := 20;   -- 2026-06-20公開: 全プレイヤー 20/10/5
  v_atk_b            int := 10;
  v_atk_c            int := 5;
  v_mat_name         text;   -- ★通常素材名（ボス別）
  v_rare_name        text;   -- ★レア素材名（ボス別）
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  -- ★原子的クレーム: 先に reward_claimed を立て、二重受け取りを防ぐ
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

  -- ティア決定（公開時の調整値を維持）
  IF v_contribution >= 0.10 OR v_participant.attack_count >= v_atk_a THEN
    v_tier := 'A'; v_gold := 50000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 3; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.06 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 30000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.03 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 10000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 1; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 5000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 1; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名（これが抜けていたのが今回の不具合）
  IF v_boss.boss_name = '雨摩座' THEN
    v_mat_name := '水禍の雫'; v_rare_name := '雨禍の心核';
  ELSE
    v_mat_name := '黒龍の鱗'; v_rare_name := '黒龍の逆鱗';
  END IF;

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

  -- 通常素材（ボス別: 黒龍の鱗 / 水禍の雫）
  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- レア素材（ボス別: 黒龍の逆鱗 / 雨禍の心核）（確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = v_rare_name LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- reward_claimed は冒頭で原子的に確定済み

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
    'mat_name',         v_mat_name,   -- ★クライアントの素材表示用
    'rare_name',        v_rare_name
  );
END;
$$;
