-- ============================================================
-- レイド調整（2026-07-12）
--   ① 上位与ダメージ 上位3名に「追加報酬」（tier報酬とは別途・加算）
--        1位: Gold +100,000 ＋ 匠の秘伝書Ⅴ
--        2位: Gold +100,000 ＋ 匠の秘伝書Ⅳ
--        3位: Gold +100,000 ＋ 匠の秘伝書Ⅲ
--      （順位は damage_dealt＝参加者一覧のダメージ表示・ソート基準で決定）
--   ② 25分経過（＝残り5分・討伐支援フェーズ）の緩和
--        ・累計30万“超過分”のボスへの与ダメを 90%カット(×0.1) → 50%カット(×0.5) に緩和
--        ・25分経過後に与えたダメージは【累計(raw)にも貢献(damage_dealt=ランキング)にも加算しない】
--          → ボスは倒しやすくなるが、上位3名の順位はラスト5分では動かない（25分時点で確定）
--
--   ※【重要】現在の“ダメージ軽減”系（クライアント RaidBoss.jsx の1ヒット段階カット cutRaidHit＝仕組みB、
--            およびボス被ダメ計算 weakMult/defScale/evoTakenMult 等）には一切触れていません。
--            変更は仕組みA（累計圧縮＝attack_raid_boss / compress_raid_dmg）のみ。
--
--   土台: supabase_raid_cumulative_compress_20260707.sql（attack_raid_boss）
--         supabase_takumi_hidensho.sql（claim_raid_rewards・0ee75fe時点）
--   Supabase の SQL Editor でファイル全体を実行してください（他の raid 系より後でOK）。
-- ============================================================

-- 0) 生累計列の存在保証（既存環境では適用済み。念のため冪等に）
ALTER TABLE raid_participants ADD COLUMN IF NOT EXISTS raw_damage_dealt bigint;
UPDATE raid_participants SET raw_damage_dealt = damage_dealt WHERE raw_damage_dealt IS NULL;

-- 1) 圧縮関数
--   通常（従来）：累計30万まで等倍・超過分×0.1（90%カット）
CREATE OR REPLACE FUNCTION compress_raid_dmg(d bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d <= 0      THEN 0
    WHEN d <= 300000 THEN d
    ELSE 300000 + floor((d - 300000) * 0.1)::bigint
  END
$$;

--   緩和（25分経過後の討伐支援用）：累計30万まで等倍・超過分×0.5（50%カット）
CREATE OR REPLACE FUNCTION compress_raid_dmg_relaxed(d bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d <= 0      THEN 0
    WHEN d <= 300000 THEN d
    ELSE 300000 + floor((d - 300000) * 0.5)::bigint
  END
$$;

-- ============================================================
-- 2) attack_raid_boss を再定義（累計圧縮＋25分緩和／25分以降は累計・貢献に非加算）
-- ============================================================
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_participant raid_participants%ROWTYPE;
  v_damage      bigint;
  v_prev_raw    bigint;
  v_raw_new     bigint;
  v_eff_prev    bigint;
  v_eff_new     bigint;
  v_boss_dmg    bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;
  v_expire_at   timestamptz;
  v_over25      boolean;
  v_exp_gain    int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  -- ボス取得（行ロック）
  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  -- 30分タイムアウトチェック
  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;

  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  -- プレイヤー取得
  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

  -- クールダウン確認（共有CD: last_action_at を使用）
  IF v_profile.last_action_at IS NOT NULL THEN
    IF now() - v_profile.last_action_at < (v_cooldown || ' seconds')::interval THEN
      RETURN json_build_object(
        'error', 'cooldown',
        'seconds_left', v_cooldown - EXTRACT(EPOCH FROM (now() - v_profile.last_action_at))::int
      );
    END IF;
  END IF;

  -- 生ダメージ（1回の申告上限＝不正防止。圧縮は累計で行う）
  v_damage := LEAST(GREATEST(p_damage, 0), 5000000);

  -- 既存の貢献（生累計）を取得
  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  v_prev_raw := COALESCE(v_participant.raw_damage_dealt, v_participant.damage_dealt, 0);

  -- 25分経過（残り5分＝討伐支援フェーズ）判定
  v_over25 := (now() > v_boss.spawned_at + interval '25 minutes');

  IF NOT v_over25 THEN
    -- 従来通り：累計に対して圧縮（30万まで等倍・超過×0.1）。ボスに通る有効ダメージ＝圧縮後の増分
    v_raw_new  := v_prev_raw + v_damage;
    v_eff_prev := compress_raid_dmg(v_prev_raw);
    v_eff_new  := compress_raid_dmg(v_raw_new);
    v_boss_dmg := GREATEST(0, v_eff_new - v_eff_prev);
  ELSE
    -- 25分経過後：ボスへの与ダメは緩和圧縮（30万超過×0.5）で計算し討伐を支援。
    -- ただし累計(raw)・貢献(damage_dealt=ランキング)は据え置き＝25分以降のダメージは累計に含めない。
    v_raw_new  := v_prev_raw;                       -- 累計は増やさない
    v_eff_new  := compress_raid_dmg(v_prev_raw);    -- 貢献（ランキング）も据え置き
    v_boss_dmg := GREATEST(0, compress_raid_dmg_relaxed(v_prev_raw + v_damage) - compress_raid_dmg_relaxed(v_prev_raw));
  END IF;

  v_new_hp := GREATEST(0, v_boss.hp_current - v_boss_dmg);

  -- ボスHP更新
  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  -- 参加者レコードUpsert（damage_dealt=圧縮後の累計・raw_damage_dealt=生累計。
  -- 25分経過後は damage_dealt/raw は据え置き＝実質変化なし。attack_count と last_attack_at は更新）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, raw_damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_eff_new, v_raw_new, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt     = v_eff_new,
      raw_damage_dealt = v_raw_new,
      attack_count     = raid_participants.attack_count + 1,
      last_attack_at   = now();

  -- 共有CD更新 + 出撃報酬（HP/MP全回復・EXP 7〜10 ランダム）
  v_exp_gain := floor(random() * 4)::int + 7;
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET
    hp_current     = v_profile.hp_max,
    mp_current     = v_profile.mp_max,
    exp            = COALESCE(exp, 0) + v_exp_gain,
    last_action_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',     v_boss_dmg,
    'raw_damage', v_damage,
    'hp_current', v_new_hp,
    'hp_max',     v_boss.hp_max,
    'over25',     v_over25,
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gain',   v_exp_gain,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;

-- ============================================================
-- 3) claim_raid_rewards を再定義（tier報酬＋上位与ダメ3名への追加報酬）
--    ※ supabase_takumi_hidensho.sql をベースに、末尾の上位3名ボーナスのみ追加
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
  v_book_name        text;   -- 匠の秘伝書（ティア別）
  v_book_item_id     int;
  -- ★上位与ダメ3名への追加報酬
  v_dmg_rank         int;    -- damage_dealt による順位（1位=最大）
  v_top_book         text;   -- 上位3名の追加秘伝書（1位Ⅴ/2位Ⅳ/3位Ⅲ）
  v_top_gold         int := 0;
  v_top_book_item_id int;
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

  -- ★上位与ダメ3名への追加報酬（順位は damage_dealt で決定・0ダメは対象外）
  --   同数タイは同順位（strict比較）。1位=Ⅴ / 2位=Ⅳ / 3位=Ⅲ・各Gold+10万
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

  -- ★上位与ダメ3名の追加秘伝書付与（1冊・tier報酬とは別途）
  IF v_top_book IS NOT NULL THEN
    SELECT id INTO v_top_book_item_id FROM items WHERE name = v_top_book LIMIT 1;
    IF v_top_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_top_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
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
    'top_rank',         v_dmg_rank,     -- 上位3名なら1〜3、それ以外はnull
    'top_book',         v_top_book,     -- 上位3名の追加秘伝書名
    'top_gold',         v_top_gold      -- 上位3名なら100000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_raid_rewards(uuid) TO authenticated;
