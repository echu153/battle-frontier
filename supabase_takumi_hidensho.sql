-- ============================================================
-- 匠の秘伝書（強化成功率アップ・Ⅰ〜Ⅴ）
--   ・鍛冶屋の武器強化で1冊消費し、成功率を倍率アップ（上限100%）
--       Ⅰ=1.1倍 / Ⅱ=1.2倍 / Ⅲ=1.3倍 / Ⅳ=1.4倍 / Ⅴ=1.5倍
--   ・入手（現状 Ⅰ〜Ⅲ のみ。Ⅳ・Ⅴ はアイテム定義のみ＝今後の入手経路用）
--       レイド報酬:   Cティア→Ⅰ / Bティア→Ⅱ / Aティア→Ⅲ
--       奈落闘技場:   3〜7階→Ⅰ / 8〜13階→Ⅱ / 14階以上→Ⅲ
--       ペットダンジョン: 戦利品枠で1%抽選（Ⅰ〜Ⅲランダム・生還時付与）
--   Supabase の SQL Editor でファイル全体を実行してください（protect_stats より後でOK）。
-- ============================================================

-- 1) アイテム定義（Ⅰ〜Ⅴ）
INSERT INTO items (name, description, effect, value) VALUES
  ('匠の秘伝書Ⅰ', '鍛冶の秘伝書（一）。武器強化で1冊使うと成功率が1.1倍になる。', 'material', 0),
  ('匠の秘伝書Ⅱ', '鍛冶の秘伝書（二）。武器強化で1冊使うと成功率が1.2倍になる。', 'material', 0),
  ('匠の秘伝書Ⅲ', '鍛冶の秘伝書（三）。武器強化で1冊使うと成功率が1.3倍になる。', 'material', 0),
  ('匠の秘伝書Ⅳ', '鍛冶の秘伝書（四）。武器強化で1冊使うと成功率が1.4倍になる。', 'material', 0),
  ('匠の秘伝書Ⅴ', '鍛冶の秘伝書（五）。武器強化で1冊使うと成功率が1.5倍になる。', 'material', 0)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 2) レイド報酬：ティア別に匠の秘伝書を付与（C→Ⅰ / B→Ⅱ / A→Ⅲ）
--    ※ 最新版 supabase_raid_zerugiasu.sql の claim_raid_rewards をベースに秘伝書付与を追加
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
  v_atk_a            int := 20;
  v_atk_b            int := 10;
  v_atk_c            int := 5;
  v_mat_name         text;
  v_rare_name        text;
  v_book_name        text;   -- ★匠の秘伝書（ティア別）
  v_book_item_id     int;
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

  -- ★匠の秘伝書付与（ティア別・1冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, 1, false)
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
    'rare_name',        v_rare_name,
    'book',             v_book_name
  );
END;
$$;


-- ============================================================
-- 3) 奈落闘技場：階層別に匠の秘伝書を付与（3〜7→Ⅰ / 8〜13→Ⅱ / 14以上→Ⅲ）
--    ※ supabase_abyss.sql の claim_abyss_floor をベースに秘伝書付与を追加
--    フロア報酬テーブルは src/lib/abyss.js の FLOOR_REWARD と一致させること
-- ============================================================
DROP FUNCTION IF EXISTS claim_abyss_floor(int);
CREATE OR REPLACE FUNCTION claim_abyss_floor(p_floor int, p_turns int DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id      uuid;
  v_row            abyss_progress%ROWTYPE;
  v_shifted        timestamp;
  v_week           date;
  v_reset          timestamptz;
  v_gold           int;
  v_stone_rank     text;
  v_stone_count    int;
  v_stone_name     text;
  v_stone_item_id  int;
  v_gem_rank       text;
  v_gem_count      int;
  v_gem_type       text;
  v_gem_types      text[] := ARRAY[
    'peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'
  ];
  v_existing_gem_id uuid;
  v_i              int;
  v_eff            int;   -- 今週分の有効到達階（前週以前は0＝週次リセット）
  v_book_name      text;  -- ★匠の秘伝書（階層別）
  v_book_item_id   int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > 20 THEN RETURN json_build_object('error', '不正なフロアです'); END IF;

  -- 奈落ウィーク（毎週月曜 朝5時JSTが境界）
  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  v_reset   := ((v_week + interval '7 days')::timestamp + interval '5 hours') AT TIME ZONE 'Asia/Tokyo';

  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id;
  IF NOT FOUND THEN
    INSERT INTO abyss_progress (player_id, cleared_floor) VALUES (v_player_id, 0)
    ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id;
  END IF;

  -- 今週分の有効到達階（前週以前の進捗は0＝週次リセット＝1階から登り直し）
  IF v_row.last_clear_week IS NOT NULL AND v_row.last_clear_week >= v_week THEN
    v_eff := v_row.cleared_floor;
  ELSE
    v_eff := 0;
  END IF;

  -- フロア順検証：次に挑めるのは「今週の到達階 + 1」のみ
  IF p_floor <> v_eff + 1 THEN
    RETURN json_build_object('error', '挑戦できる階ではありません');
  END IF;

  -- フロア報酬テーブル（src/lib/abyss.js の FLOOR_REWARD と一致させること）
  CASE p_floor
    WHEN 1  THEN v_gold:=3000;   v_stone_rank:='F'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 2  THEN v_gold:=5000;   v_stone_rank:='F'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 3  THEN v_gold:=8000;   v_stone_rank:='E'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 4  THEN v_gold:=12000;  v_stone_rank:='E'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 5  THEN v_gold:=18000;  v_stone_rank:='D'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 6  THEN v_gold:=26000;  v_stone_rank:='D'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 7  THEN v_gold:=36000;  v_stone_rank:='D'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 8  THEN v_gold:=50000;  v_stone_rank:='C'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 9  THEN v_gold:=66000;  v_stone_rank:='C'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 10 THEN v_gold:=90000;  v_stone_rank:='C'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 11 THEN v_gold:=120000; v_stone_rank:='B'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 12 THEN v_gold:=156000; v_stone_rank:='B'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 13 THEN v_gold:=200000; v_stone_rank:='B'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 14 THEN v_gold:=250000; v_stone_rank:='A'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 15 THEN v_gold:=310000; v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 16 THEN v_gold:=380000; v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 17 THEN v_gold:=460000; v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 18 THEN v_gold:=560000; v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 19 THEN v_gold:=680000; v_stone_rank:='A'; v_stone_count:=4; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 20 THEN v_gold:=840000; v_stone_rank:='A'; v_stone_count:=5; v_gem_rank:='E'; v_gem_count:=3;
  END CASE;

  -- ★匠の秘伝書（3〜7=Ⅰ / 8〜13=Ⅱ / 14以上=Ⅲ・1〜2階は無し）
  v_book_name := CASE
    WHEN p_floor BETWEEN 3 AND 7  THEN '匠の秘伝書Ⅰ'
    WHEN p_floor BETWEEN 8 AND 13 THEN '匠の秘伝書Ⅱ'
    WHEN p_floor >= 14            THEN '匠の秘伝書Ⅲ'
    ELSE NULL END;

  -- Gold付与
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  -- 強化石付与
  v_stone_name := '強化石(' || v_stone_rank || ')';
  SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
  IF v_stone_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_stone_item_id, v_stone_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE
    SET quantity = player_items.quantity + v_stone_count;
  END IF;

  -- 宝石付与（ランダム種類）
  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems
    WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity)
      VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- ★匠の秘伝書付与（階層別・1冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- 進行更新（撃破階を前進＋今週クリア済みフラグ）
  UPDATE abyss_progress
  SET cleared_floor = p_floor,
      last_clear_week = v_week,
      last_clear_turns = GREATEST(p_turns, 1),
      total_clears = total_clears + 1,
      updated_at = now()
  WHERE player_id = v_player_id;

  RETURN json_build_object(
    'success',     true,
    'floor',       p_floor,
    'gold',        v_gold,
    'stone',       v_stone_rank,
    'stone_count', v_stone_count,
    'gem_rank',    v_gem_rank,
    'gem_count',   v_gem_count,
    'book',        v_book_name,
    'reset_at',    v_reset
  );
END;
$$;
GRANT EXECUTE ON FUNCTION claim_abyss_floor(int, int) TO authenticated;


-- ============================================================
-- 4) ペットダンジョン：戦利品に匠の秘伝書（type='book' level 1〜3）を追加
--    ※ supabase_dungeon_loot.sql の dungeon_pickup / dungeon_finish をベースに book 型を追加
--    抽選（1%）はクライアント Dungeon.jsx の rollFloorLoot で実施。ここは検証と付与のみ。
-- ============================================================
create or replace function dungeon_pickup(p_run_id uuid, p_entry jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_entry jsonb; v_id text; v_type text; v_key text;
  v_seeds  text[] := array['atk_seed','spatk_seed','def_seed','spdef_seed','hp_seed'];
  v_stones text[] := array['F','E','D','C','B','A','S','SS','SSS'];
  v_gems   text[] := array['peridot','lapis','ruby','sapphire','amethyst','emerald','topaz','rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'];
  v_charms text[] := array['antidote','guard','mdefup','atkup','spatkup','evade','hit','lucky'];
  v_dungeon_equips text[] := array[
    '木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書','魔導の杖','魔術教本',
    '鋼鉄の剣','鋭利なナイフ','狩人の弓','戦士の指輪','略奪の腕輪','古代の護符','秘術の首飾り',
    '重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪','蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符'];
  v_pending jsonb; v_arr jsonb := '[]'::jsonb; v_found boolean := false; v_e jsonb;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> auth.uid() then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run not active'; end if;
  if v_run.loot_rolls >= 500 then raise exception 'too many loot'; end if;

  v_id := gen_random_uuid()::text;
  v_type := p_entry->>'type';
  if v_type = 'seed' then
    v_key := p_entry->>'seedKey';
    if not (v_key = any(v_seeds)) then raise exception 'bad seed'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'seed', 'seedKey', v_key, 'qty', 1);
  elsif v_type = 'stone' then
    v_key := p_entry->>'rank';
    if not (v_key = any(v_stones)) then raise exception 'bad stone'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'stone', 'rank', v_key);
  elsif v_type = 'gem' then
    v_key := p_entry->>'gemType';
    if not (v_key = any(v_gems)) then raise exception 'bad gem'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'gem', 'gemType', v_key);
  elsif v_type = 'charm' then
    v_key := p_entry->>'ctype';
    if not (v_key = any(v_charms)) then raise exception 'bad charm'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'charm', 'ctype', v_key);
  elsif v_type = 'equip' then
    v_key := p_entry->>'name';
    if not (v_key = any(v_dungeon_equips)) then raise exception 'bad equip'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'equip', 'name', v_key);
  elsif v_type = 'shard' then
    v_entry := jsonb_build_object('id', v_id, 'type', 'shard');
  elsif v_type = 'book' then
    -- ★匠の秘伝書（Ⅰ〜Ⅲ）。levelは1〜3のみ許可
    v_key := p_entry->>'level';
    if not (v_key = any(array['1','2','3'])) then raise exception 'bad book'; end if;
    v_entry := jsonb_build_object('id', v_id, 'type', 'book', 'level', v_key::int);
  else
    raise exception 'bad loot type';
  end if;

  v_pending := v_run.pending_loot;
  if v_entry->>'type' = 'seed' then
    for v_e in select * from jsonb_array_elements(v_pending) loop
      if not v_found and v_e->>'type' = 'seed' and v_e->>'seedKey' = v_entry->>'seedKey' then
        v_arr := v_arr || jsonb_set(v_e, '{qty}', to_jsonb(coalesce((v_e->>'qty')::int,1) + 1)); v_found := true;
      else v_arr := v_arr || v_e; end if;
    end loop;
    if not v_found then v_arr := v_arr || v_entry; end if;
    v_pending := v_arr;
  else
    v_pending := v_pending || v_entry;
  end if;

  update dungeon_runs set pending_loot = v_pending, loot_rolls = loot_rolls + 1 where id = p_run_id;
  return v_entry;
end; $$;

create or replace function dungeon_finish(p_run_id uuid, p_floors int, p_enemies int, p_items int, p_cleared boolean, p_died boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_run dungeon_runs%rowtype; v_pet pets%rowtype; v_floors int; v_items int;
  v_aff_delta int; v_new_aff int; v_new_clears int; v_bonus int;
  v_e jsonb; v_t text; v_slot text; v_uid uuid := auth.uid();
  v_iid items.id%type; v_wid weapons.id%type; v_q int; v_exrow record;
  v_keep jsonb := '[]'::jsonb; v_kq int;
  v_book_name text;
begin
  select * into v_run from dungeon_runs where id = p_run_id;
  if not found then raise exception 'run not found'; end if;
  if v_run.owner_id <> v_uid then raise exception 'not your run'; end if;
  if v_run.status <> 'active' then raise exception 'run already finished'; end if;
  v_floors := least(greatest(coalesce(p_floors,0), 0), 99);
  v_items  := least(greatest(coalesce(p_items,0),  0), 99);
  select * into v_pet from pets where id = v_run.pet_id and owner_id = v_uid;
  if not found then raise exception 'pet not found'; end if;

  -- なつき
  v_new_clears := coalesce(v_pet.dungeon_clears, 0) + 1;
  v_bonus := case when v_new_clears % 10 = 0 then 1 else 0 end;
  v_aff_delta := (case when p_died then -3 else 0 end) + v_bonus;
  v_new_aff := greatest(0, least(100, v_pet.affection + v_aff_delta));
  update pets set affection = v_new_aff, dungeon_clears = v_new_clears where id = v_pet.id;

  -- 戦利品：生還＝全部／死亡＝ランダムで半分失う
  if p_died then
    for v_e in select * from jsonb_array_elements(v_run.pending_loot) loop
      if v_e->>'type' = 'seed' then
        v_q := coalesce((v_e->>'qty')::int, 1);
        v_kq := floor(v_q / 2.0)::int + (case when v_q % 2 = 1 and random() < 0.5 then 1 else 0 end);
        if v_kq > 0 then v_keep := v_keep || jsonb_set(v_e, '{qty}', to_jsonb(v_kq)); end if;
      elsif random() < 0.5 then
        v_keep := v_keep || v_e;
      end if;
    end loop;
  else
    v_keep := v_run.pending_loot;
  end if;

  for v_e in select * from jsonb_array_elements(v_keep) loop
      v_t := v_e->>'type';
      if v_t = 'seed' then
        v_q := coalesce((v_e->>'qty')::int, 1);
        insert into pet_storage(owner_id, item_key, qty) values (v_uid, v_e->>'seedKey', v_q)
          on conflict (owner_id, item_key) do update set qty = pet_storage.qty + v_q;
      elsif v_t = 'stone' then
        select id into v_iid from items where name = '強化石(' || (v_e->>'rank') || ')';
        if v_iid is not null then
          select id, quantity into v_exrow from player_items where player_id = v_uid and item_id = v_iid;
          if v_exrow.id is not null then update player_items set quantity = coalesce(v_exrow.quantity,0) + 1 where id = v_exrow.id;
          else insert into player_items(player_id, item_id, quantity, equipped) values (v_uid, v_iid, 1, false); end if;
        end if;
      elsif v_t = 'gem' then
        select id, quantity into v_exrow from player_gems where player_id = v_uid and gem_type = v_e->>'gemType' and rank = 'F';
        if v_exrow.id is not null then update player_gems set quantity = coalesce(v_exrow.quantity,1) + 1 where id = v_exrow.id;
        else insert into player_gems(player_id, gem_type, rank, quantity) values (v_uid, v_e->>'gemType', 'F', 1); end if;
      elsif v_t = 'equip' then
        select id, slot into v_wid, v_slot from weapons where name = v_e->>'name';
        if v_wid is not null then insert into player_equipment(player_id, weapon_id, slot, equipped) values (v_uid, v_wid, v_slot, false); end if;
      elsif v_t = 'charm' then
        insert into player_charms(owner_id, ctype) values (v_uid, v_e->>'ctype');
      elsif v_t = 'shard' then
        insert into pet_storage(owner_id, item_key, qty) values (v_uid, 'shard', 1)
          on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 1;
      elsif v_t = 'book' then
        -- ★匠の秘伝書（level 1〜3 → Ⅰ〜Ⅲ）
        v_book_name := '匠の秘伝書' || (case v_e->>'level' when '1' then 'Ⅰ' when '2' then 'Ⅱ' when '3' then 'Ⅲ' else 'Ⅰ' end);
        select id into v_iid from items where name = v_book_name;
        if v_iid is not null then
          select id, quantity into v_exrow from player_items where player_id = v_uid and item_id = v_iid;
          if v_exrow.id is not null then update player_items set quantity = coalesce(v_exrow.quantity,0) + 1 where id = v_exrow.id;
          else insert into player_items(player_id, item_id, quantity, equipped) values (v_uid, v_iid, 1, false); end if;
        end if;
      end if;
    end loop;

  update dungeon_runs set status = 'finished', finished_at = now(), floors_cleared = v_floors,
    items_collected = v_items, cleared = coalesce(p_cleared, false),
    pending_loot = '[]'::jsonb, dropped_loot = '[]'::jsonb
    where id = p_run_id;

  return json_build_object('aff_delta', v_aff_delta, 'affection', v_new_aff, 'aff_bonus', v_bonus,
    'clears', v_new_clears, 'level', v_pet.level, 'exp', v_pet.exp,
    'loot_granted', jsonb_array_length(v_keep), 'kept_loot', v_keep);
end; $$;

grant execute on function dungeon_pickup(uuid, jsonb) to authenticated;
grant execute on function dungeon_finish(uuid, int, int, int, boolean, boolean) to authenticated;
