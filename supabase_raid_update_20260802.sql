-- ============================================================
-- レイドアップデート（2026-08-02）
--   ① 出撃報酬EXPに「出撃回数ボーナス」を追加
--        そのレイドでの累計出撃回数（raid_participants.attack_count）に応じて加算。
--        10〜19回 +1 / 20〜29回 +2 / 30〜39回 +3 / 40〜49回 +5 / 50回〜 +6
--        （基本EXPは従来どおり7〜10のランダム。ボーナスはその上に加算）
--        ※かかし修練中はボーナス込みで0（従来どおり）。レベル上限中はEXPスタックに乗る。
--   ② ティア報酬に「強者の結晶」を低確率で追加
--        A 8% / B 5% / C 3%（Dティアは無し）
--
--   ★★ 以後、attack_raid_boss / claim_raid_rewards の「最後に流す正」は【このファイル】。
--      ベース: attack_raid_boss     = supabase_raid_scarecrow_noexp_fix_20260720.sql
--              claim_raid_rewards   = supabase_raid_day_20260717.sql
--      raid系SQLを再適用したら必ず最後にこれを流し直すこと。
--      （※全体の適用順の鉄則「supabase_mutant_gold_20260703.sql を一番最後」は別軸。
--        あちらは apply_battle_result / apply_dungeon_reward であり本ファイルとは無関係）
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- 前提: スタック用カラム（未追加なら追加・冪等）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS raid_exp_stack int NOT NULL DEFAULT 0;

-- 前提: 強者の結晶のアイテム定義（supabase_kyousha_crystal.sql 未適用でも報酬が消えないよう冪等に用意）
INSERT INTO items (name, description, effect, value)
SELECT '強者の結晶', 'エリアボス装備10個から生成される結晶。+11以上の強化で使うと、失敗しても強化値が下がらない（失敗時に1個消費）。', 'material', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '強者の結晶');

-- ============================================================
-- ① attack_raid_boss: 出撃回数ボーナスEXP
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
  -- ★出撃回数ボーナス
  v_atk_count   int;
  v_exp_bonus   int;
  -- EXPスタック用
  v_class_lv    int;
  v_cap         int;
  v_is_at_cap   boolean;
  v_stack_before int;
  v_stack_after  int;
  v_stack_added  int;
  v_exp_applied  int;
  -- かかし修練中は出撃報酬EXPなし（スタックへの蓄積・反映もなし）
  v_sc_active   boolean;
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

  -- かかし修練中（時間経過前）判定。出撃自体は可・EXPのみなし（supabase_scarecrow.sql のヘルパー）
  v_sc_active := scarecrow_is_active(v_player_id);

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
    v_raw_new  := v_prev_raw + v_damage;
    v_eff_prev := compress_raid_dmg(v_prev_raw);
    v_eff_new  := compress_raid_dmg(v_raw_new);
    v_boss_dmg := GREATEST(0, v_eff_new - v_eff_prev);
  ELSE
    v_raw_new  := v_prev_raw;
    v_eff_new  := compress_raid_dmg(v_prev_raw);
    v_boss_dmg := GREATEST(0, compress_raid_dmg_relaxed(v_prev_raw + v_damage) - compress_raid_dmg_relaxed(v_prev_raw));
  END IF;

  v_new_hp := GREATEST(0, v_boss.hp_current - v_boss_dmg);

  -- ボスHP更新
  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  -- 参加者レコードUpsert（★更新後の出撃回数を受け取る＝ボーナス判定に使う）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, raw_damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_eff_new, v_raw_new, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt     = v_eff_new,
      raw_damage_dealt = v_raw_new,
      attack_count     = raid_participants.attack_count + 1,
      last_attack_at   = now()
  RETURNING attack_count INTO v_atk_count;

  -- ★出撃回数ボーナス（このレイドでの累計出撃回数で決まる）
  v_exp_bonus := CASE
    WHEN v_atk_count >= 50 THEN 6
    WHEN v_atk_count >= 40 THEN 5
    WHEN v_atk_count >= 30 THEN 3
    WHEN v_atk_count >= 20 THEN 2
    WHEN v_atk_count >= 10 THEN 1
    ELSE 0 END;

  -- 出撃報酬EXP（基本7〜10ランダム ＋ 出撃回数ボーナス・かかし修練中は0）
  IF v_sc_active THEN
    v_exp_bonus := 0;
    v_exp_gain  := 0;
  ELSE
    v_exp_gain := floor(random() * 4)::int + 7 + v_exp_bonus;
  END IF;

  -- レベル上限判定（現在クラスのレベル vs キャップ。apply_battle_result と同じロジック）
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_player_id AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;

  v_stack_before := COALESCE(v_profile.raid_exp_stack, 0);

  PERFORM set_config('app.allow_stat_change', 'on', true);

  IF v_sc_active THEN
    -- かかし修練中: EXPなし・スタックにも貯めず反映もしない（HP/MP回復とCD更新のみ）
    v_stack_after := v_stack_before;
    v_stack_added := 0;
    v_exp_applied := 0;
    UPDATE profiles SET
      hp_current     = v_profile.hp_max,
      mp_current     = v_profile.mp_max,
      last_action_at = now()
    WHERE id = v_player_id;
  ELSIF v_is_at_cap THEN
    -- 上限到達中：EXPは加算せず「EXPスタック」に貯める（最大200）
    v_stack_after := LEAST(200, v_stack_before + v_exp_gain);
    v_stack_added := v_stack_after - v_stack_before;
    v_exp_applied := 0;
    UPDATE profiles SET
      hp_current     = v_profile.hp_max,
      mp_current     = v_profile.mp_max,
      raid_exp_stack = v_stack_after,
      last_action_at = now()
    WHERE id = v_player_id;
  ELSE
    -- 上限未満：今回のEXP＋貯めたスタックをまとめてEXPへ反映（後で自動反映）
    v_stack_after := 0;
    v_stack_added := 0;
    v_exp_applied := v_exp_gain + v_stack_before;
    UPDATE profiles SET
      hp_current     = v_profile.hp_max,
      mp_current     = v_profile.mp_max,
      exp            = COALESCE(exp, 0) + v_exp_applied,
      raid_exp_stack = 0,
      last_action_at = now()
    WHERE id = v_player_id;
  END IF;

  RETURN json_build_object(
    'damage',         v_boss_dmg,
    'raw_damage',     v_damage,
    'hp_current',     v_new_hp,
    'hp_max',         v_boss.hp_max,
    'over25',         v_over25,
    'exp',            COALESCE(v_profile.exp, 0) + v_exp_applied,
    'exp_gain',       v_exp_applied,                       -- 実際にexpへ反映された量（上限中・修練中は0）
    'exp_bonus',      v_exp_bonus,                         -- ★出撃回数ボーナス分（修練中は0）
    'attack_count',   v_atk_count,                         -- ★このレイドでの累計出撃回数
    'at_cap',         v_is_at_cap,
    'scarecrow_active', v_sc_active,                       -- かかし修練中（EXPなしの理由表示用）
    'stack_gain',     v_stack_added,                       -- 今回スタックに貯まった量
    'stack_drained',  CASE WHEN NOT v_is_at_cap AND NOT v_sc_active THEN v_stack_before ELSE 0 END,  -- 反映されたスタック量
    'raid_exp_stack', v_stack_after,                       -- 更新後のスタック（0〜200）
    'status',         CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;

-- ============================================================
-- ② claim_raid_rewards: ティア報酬に強者の結晶を低確率で追加（A 8% / B 5% / C 3%）
--    ベース: supabase_raid_day_20260717.sql（昼枠は上位3名報酬なし）
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
  v_mats             text[];
  v_book_name        text;
  v_book_item_id     int;
  v_dmg_rank         int;
  v_top_book         text;
  v_top_gold         int := 0;
  v_top_book_item_id int;
  -- 勇気の証イベント
  v_courage          int := 0;
  v_courage_item_id  int;
  -- ★強者の結晶（ティア別・低確率）
  v_crystal_chance   float := 0.0;
  v_got_crystal      boolean := false;
  v_crystal_item_id  int;
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
    v_crystal_chance := 0.08;
  ELSIF v_contribution >= 0.04 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
    v_crystal_chance := 0.05;
  ELSIF v_contribution >= 0.02 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
    v_crystal_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
    v_crystal_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ボス別の素材名（raid_boss_mats に一元化。新ボス追加時はその関数だけ直せば足りる＝
  --   ここに分岐を足し忘れて黙って黒龍素材が配られる、を再発させない）
  v_mats      := raid_boss_mats(v_boss.boss_name);
  v_mat_name  := v_mats[1];
  v_rare_name := v_mats[2];

  -- 匠の秘伝書（C=Ⅰ / B=Ⅱ / A=Ⅲ・Dは無し）
  v_book_name := CASE v_tier
    WHEN 'A' THEN '匠の秘伝書Ⅲ'
    WHEN 'B' THEN '匠の秘伝書Ⅱ'
    WHEN 'C' THEN '匠の秘伝書Ⅰ'
    ELSE NULL END;

  -- 上位与ダメ3名への追加報酬（夜枠のみ。昼枠=12〜17時は人が少なく上位が固定化するため付けない）
  v_dmg_rank := NULL;
  IF COALESCE(v_boss.slot, 21) IN (21, 22) AND v_participant.damage_dealt > 0 THEN
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

  -- ★強者の結晶（A 8% / B 5% / C 3%・Dは無し）
  IF v_crystal_chance > 0 AND random() < v_crystal_chance THEN
    SELECT id INTO v_crystal_item_id FROM items WHERE name = '強者の結晶' LIMIT 1;
    IF v_crystal_item_id IS NOT NULL THEN
      v_got_crystal := true;
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_crystal_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- 匠の秘伝書付与（ティア別・1冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- 上位与ダメ3名の追加秘伝書付与（1冊）
  IF v_top_book IS NOT NULL THEN
    SELECT id INTO v_top_book_item_id FROM items WHERE name = v_top_book LIMIT 1;
    IF v_top_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_top_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- 勇気の証イベント（期間内のみ）: 参加報酬×2 ＋ Cティア以上で+1
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
    'courage',          v_courage,     -- 勇気の証 付与数（期間外は0）
    'got_crystal',      v_got_crystal  -- ★強者の結晶（A8%/B5%/C3%）
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_raid_rewards(uuid) TO authenticated;
