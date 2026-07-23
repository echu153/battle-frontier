-- ============================================================
-- エリア⑧「蒼天の浮遊城」追加 (天空系・推奨戦闘力5万・2026-07-23)
--   ボス=天空覇龍ウラノス。ドロップ装備は専用フルセット(特殊能力なし)。
--   ボス装備3種は他ボス装備と同じく進化/真化が可能(真化=基礎ステ×2＋S表示、特殊能力は付かない)。
--
--   ★このファイルは通しで1回実行すれば揃う。ただし §4 apply_battle_result は
--     「apply_battle_result の最後に流す正」を supabase_event_20260720_scarecrow_abyss.sql
--     から【このファイルへ引き継ぐ】もの。以後 apply_battle_result が巻き戻ったら
--     必ず【このファイルの §4 を最後に】流し直すこと。
-- ============================================================

-- ===== 1) 新装備 (weapons) =====
--   スケールは既存S級(レイド装備=primary80前後)を踏襲。common=A / rare・boss=S。
--   ボス装備(§末尾3種)は特殊能力なし=固定ステのみ。真化で基礎ステ×2。

-- --- commonDrops (A級) ---
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼天の剣',   'sword',     'weapon',    'a', 46, 0,  0,  0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼天の剣');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天翼の短剣', 'dagger',    'weapon',    'a', 38, 0,  0,  0,  14 WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天翼の短剣');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '疾風天弓',   'bow',       'weapon',    'a', 42, 0,  0,  0,  8  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='疾風天弓');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼雲の杖',   'staff',     'weapon',    'a', 0,  0,  46, 0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼雲の杖');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天空魔導書', 'tome',      'weapon',    'a', 0,  0,  44, 0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天空魔導書');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天羽の鎧',   'armor',     'armor',     'a', 0,  42, 0,  42, 0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天羽の鎧');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼天の指輪', 'accessory', 'accessory', 'a', 22, 0,  22, 0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼天の指輪');

-- --- rareDrops (A級・雑魚ドロップは common/rare とも A) ---
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼天大剣',   'sword',     'weapon',    'a', 78, 0,  0,  0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼天大剣');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天翔短剣',   'dagger',    'weapon',    'a', 64, 0,  0,  0,  20 WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天翔短剣');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天穿弓',     'bow',       'weapon',    'a', 70, 0,  0,  0,  12 WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天穿弓');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼天霊杖',   'staff',     'weapon',    'a', 0,  0,  78, 0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼天霊杖');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天空霊典',   'tome',      'weapon',    'a', 0,  0,  72, 0,  0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天空霊典');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼穹の鎧',   'armor',     'armor',     'a', 0,  68, 0,  68, 0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼穹の鎧');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '天翼の護符', 'accessory', 'accessory', 'a', 0,  0,  34, 0,  22 WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='天翼の護符');

-- --- bossDrops (S級・進化可能・特殊能力なし) ---
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT 'ウラノスの天砲', 'gun',       'weapon',    's', 95,  0,   95,  0,   0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='ウラノスの天砲');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '覇龍の聖鎧',     'armor',     'armor',     's', 0,   110, 0,   110, 0  WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='覇龍の聖鎧');
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT '蒼天龍の指輪',   'accessory', 'accessory', 's', 42,  0,   42,  0,   32 WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name='蒼天龍の指輪');


-- ===== 2) アイテム (許可証・進化素材) =====
INSERT INTO items (name, description, effect, value) VALUES
  ('蒼天の浮遊城 出撃許可証', '簡易出撃(賭博場/ヘッダー)でエリア⑧に出撃できる許可証。エリア⑦ボスを3ターン以内に撃破すると入手。', 'casino_area_8', 0),
  ('覇龍の血',   '天空覇龍ウラノスの血。ボス装備の進化素材。', 'material', 0),
  ('覇龍の心臓', '天空覇龍ウラノスの心臓。ボス装備の真化(5段)素材。極めて希少。', 'material', 0)
ON CONFLICT DO NOTHING;


-- ===== 3) grant_boss_evo_drop: エリア⑧(覇龍の血/心臓)を追加 =====
--   血70%(通常)・心臓0.5%。血ドロップ率UPイベント判定は既存踏襲(期間は過去)。
CREATE OR REPLACE FUNCTION public.grant_boss_evo_drop(p_area_id integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_blood text;
  v_heart text;
  v_id items.id%TYPE;
  v_got_blood text := null;
  v_got_heart text := null;
  v_blood_rate numeric := 0.7;  -- 通常時の血ドロップ率
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false); END IF;
  v_blood := CASE p_area_id
    WHEN 1 THEN 'スライムの血' WHEN 2 THEN '盗賊の血' WHEN 3 THEN '番人の血'
    WHEN 4 THEN '海竜の血' WHEN 5 THEN '雷鷲の血' WHEN 6 THEN '氷霊の血'
    WHEN 7 THEN 'サラマンダーの血' WHEN 8 THEN '覇龍の血' ELSE NULL END;
  v_heart := CASE p_area_id
    WHEN 1 THEN 'スライムの心臓' WHEN 2 THEN '盗賊の心臓' WHEN 3 THEN '番人の心臓'
    WHEN 4 THEN '海竜の心臓' WHEN 5 THEN '雷鷲の心臓' WHEN 6 THEN '氷霊の心臓'
    WHEN 7 THEN 'サラマンダーの心臓' WHEN 8 THEN '覇龍の心臓' ELSE NULL END;
  IF v_blood IS NULL THEN RETURN json_build_object('ok', false); END IF;

  -- 血ドロップ率UPイベント (JST 2026/7/6 5:00 〜 7/20 4:59) 中は 90%
  IF now() >= '2026-07-06 05:00:00+09'::timestamptz
     AND now() <  '2026-07-20 05:00:00+09'::timestamptz THEN
    v_blood_rate := 0.9;
  END IF;

  -- 血（期間自動判定: イベント中90% / 通常70%）
  IF random() < v_blood_rate THEN
    SELECT id INTO v_id FROM items WHERE name = v_blood LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
      v_got_blood := v_blood;
    END IF;
  END IF;
  -- 心臓 0.5%（据え置き）
  IF random() < 0.005 THEN
    SELECT id INTO v_id FROM items WHERE name = v_heart LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
      v_got_heart := v_heart;
    END IF;
  END IF;
  RETURN json_build_object('ok', true, 'blood', v_got_blood, 'heart', v_got_heart);
END $function$;

GRANT EXECUTE ON FUNCTION public.grant_boss_evo_drop(integer) TO authenticated;


-- ===== 4) apply_battle_result: エリア⑧のGold検証上限とエリア解放を追加 =====
--   ベース = supabase_event_20260720_scarecrow_abyss.sql の全文(10引数版・かかしイベント込み)。
--   変更点は4箇所のみ:
--     ・v_boss_golds   に ⑧=40000 を追加
--     ・v_normal_golds に ⑧=800 を追加
--     ・Gold上限判定 BETWEEN 1 AND 7 → BETWEEN 1 AND 8 (ボス/雑魚の2行)
--     ・エリア解放 p_area_id < 7 → p_area_id < 8 (⑦撃破で⑧が解放されるように)
CREATE OR REPLACE FUNCTION public.apply_battle_result(p_area_id integer, p_is_boss boolean, p_is_papia boolean, p_papia_escaped boolean, p_win boolean, p_claimed_exp integer, p_claimed_gold integer, p_hp_current integer, p_mp_current integer, p_mutant_boss boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_class_lv integer;
  v_cap integer;
  v_is_at_cap boolean;
  v_exp_frozen boolean;
  v_max_gold integer;
  v_max_exp integer;
  v_eff_exp integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_char_lv integer; v_new_pending integer;
  v_new_boss_rate numeric;
  v_new_unlocked integer[];
  v_level_ups integer := 0;
  v_boss_golds   integer[] := ARRAY[50, 250, 1000, 2500, 6000, 12500, 25000, 40000];  -- ★⑧=40000追加
  v_normal_golds integer[] := ARRAY[30,  60,  120,  200,  400,   600,   800,   800];  -- ★⑧=800追加
  v_mutant_eligible boolean := false;
  v_mutant_first_clear boolean := false;
  v_alch_unlocked boolean := false;
  v_crys_drop int := 0;
  v_sc_week date;
  v_sc_charges int;
  v_sc_progress int;
  v_sc_earned int;
  v_sc_charged boolean := false;
  -- ★イベント(2026/7/20〜8/3): チャージ必要出撃回数 50→10
  v_sc_need int := CASE WHEN bf_event_20260720_active() THEN 10 ELSE 50 END;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  IF has_active_dungeon(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','dungeon_active');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 8 THEN v_max_gold := v_boss_golds[p_area_id];    -- ★1 AND 8
  ELSIF p_area_id BETWEEN 1 AND 8 THEN v_max_gold := v_normal_golds[p_area_id];                -- ★1 AND 8
  ELSE v_max_gold := 800; END IF;
  v_max_gold := CEIL(v_max_gold * (CASE WHEN p_area_id BETWEEN 1 AND 4 THEN 2.0 ELSE 1.5 END));

  -- ★【変異】対応(char_lv500以上・エリア①〜④)。クライアントの請求と一致させる:
  --   ・変異ボス撃破(p_mutant_boss=true) = floor(6000*1.5)          = 9000
  --   ・撃破済みエリアの雑魚             = floor(エリア⑤敵gold最大400*1.5) = 600
  --   ※トグルOFF(通常ボス)では変異ボス扱いしない＝上限も攻略記録もしない。
  v_mutant_eligible := p_area_id BETWEEN 1 AND 4 AND COALESCE(v_profile.char_lv, 1) >= 500;
  IF p_win AND v_mutant_eligible THEN
    IF p_is_boss AND p_mutant_boss THEN
      v_max_gold := GREATEST(v_max_gold, 9000);
    ELSIF NOT p_is_boss AND COALESCE(v_profile.mutant_cleared_areas, '{}'::integer[]) @> ARRAY[p_area_id] THEN
      v_max_gold := GREATEST(v_max_gold, 600);
    END IF;
  END IF;

  IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
    UPDATE profiles SET suspicious_flag=true,
      exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
    WHERE id=v_uid;
    INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
    VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
    RETURN json_build_object('ok',false,'reason','invalid_gold');
  END IF;

  IF NOT v_exp_frozen AND NOT v_is_at_cap AND NOT p_papia_escaped THEN
    IF p_is_papia THEN v_max_exp := 200;
    ELSIF p_is_boss THEN v_max_exp := 13;
    ELSE v_max_exp := 11; END IF;
    IF COALESCE(v_profile.char_lv, 1) < 100 THEN v_max_exp := CEIL(v_max_exp * 1.5); END IF;

    IF p_claimed_exp < 0 OR p_claimed_exp > v_max_exp THEN
      UPDATE profiles SET suspicious_flag=true,
        exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
      WHERE id=v_uid;
      INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
      VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
      RETURN json_build_object('ok',false,'reason','invalid_exp');
    END IF;
  END IF;

  -- HP上限検証: クライアントが戦闘直前にキャッシュした実効最大HP(eff_hp_max)を上限として信頼する。
  IF p_hp_current < 0 OR p_hp_current >
       GREATEST(COALESCE(v_profile.eff_hp_max, v_profile.hp_max * 5), v_profile.hp_max) THEN
    RETURN json_build_object('ok',false,'reason','invalid_hp'); END IF;

  -- ★【変異】ボス初撃破: 実際に変異ボス(p_mutant_boss=true)を倒したときのみ記録
  v_mutant_first_clear := p_win AND p_is_boss AND p_mutant_boss AND v_mutant_eligible
    AND NOT (COALESCE(v_profile.mutant_cleared_areas, '{}'::integer[]) @> ARRAY[p_area_id]);

  v_eff_exp      := CASE WHEN v_exp_frozen OR v_is_at_cap OR p_papia_escaped THEN 0 ELSE p_claimed_exp END;
  v_new_exp      := COALESCE(v_profile.exp, 0) + v_eff_exp;
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
      v_level_ups := v_level_ups + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;
  END IF;

  v_new_boss_rate := CASE WHEN p_is_boss THEN 0
    ELSE COALESCE(v_profile.boss_encounter_rate,0)+0.5 END;
  v_new_unlocked := COALESCE(v_profile.unlocked_areas, ARRAY[1]);
  IF p_win AND p_is_boss AND p_area_id < 8                                                     -- ★< 8 (⑦撃破で⑧解放)
    AND NOT (v_new_unlocked @> ARRAY[p_area_id+1]) THEN
    v_new_unlocked := array_append(v_new_unlocked, p_area_id+1);
  END IF;

  -- ★錬金ドロップ抽選（解放済み＝エリア③ボス撃破済のみ。サーバー側乱数＝改ざん不可）
  v_alch_unlocked := v_new_unlocked @> ARRAY[4];
  IF v_alch_unlocked AND p_win AND random() < 0.01 THEN v_crys_drop := 1; END IF; -- 勝利で時の結晶

  INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,level_ups)
  VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,v_eff_exp,p_claimed_gold,v_level_ups);

  v_sc_week := scarecrow_week_key_now();
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_sc_week THEN
    v_sc_charges := 0; v_sc_earned := 0;
  ELSE
    v_sc_charges := COALESCE(v_profile.scarecrow_charges, 0);
    v_sc_earned  := COALESCE(v_profile.scarecrow_earned_week, 0);
  END IF;
  v_sc_progress := COALESCE(v_profile.scarecrow_progress, 0);
  -- ★イベント: 必要回数 v_sc_need（イベント中10/通常50）。
  --   イベント開始時に進捗が既に10以上溜まっているケースがあるため WHILE でまとめて消化
  --   （週5回の獲得上限は従来どおり厳守）
  IF v_sc_earned < 5 THEN
    v_sc_progress := v_sc_progress + 1;
    WHILE v_sc_progress >= v_sc_need AND v_sc_earned < 5 LOOP
      v_sc_progress := v_sc_progress - v_sc_need;
      v_sc_charges := v_sc_charges + 1;
      v_sc_earned  := v_sc_earned + 1;
      v_sc_charged := true;
    END LOOP;
  END IF;

  UPDATE profiles SET
    exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
    gold=gold+p_claimed_gold,
    hp_current=p_hp_current, mp_current=p_mp_current,
    is_dying=(p_hp_current=0),
    boss_encounter_rate=v_new_boss_rate,
    unlocked_areas=v_new_unlocked,
    pending_stat_points=v_new_pending,
    char_lv=v_new_char_lv,
    mutant_cleared_areas=CASE WHEN v_mutant_first_clear
      THEN array_append(COALESCE(mutant_cleared_areas, '{}'::integer[]), p_area_id)
      ELSE mutant_cleared_areas END,
    time_crystal=COALESCE(time_crystal,0)+v_crys_drop,  -- ★錬金
    boss_kill_count=CASE WHEN p_win AND p_is_boss
      THEN COALESCE(boss_kill_count,0)+1 ELSE boss_kill_count END,
    scarecrow_charges=v_sc_charges,
    scarecrow_progress=v_sc_progress,
    scarecrow_earned_week=v_sc_earned,
    scarecrow_week_key=v_sc_week
  WHERE id=v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
    WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  RETURN json_build_object('ok',true,'level_ups',v_level_ups,'new_lv',v_new_lv,
    'mutant_first_clear',v_mutant_first_clear,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges,
    'crystal_drop',v_crys_drop);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_battle_result(integer, boolean, boolean, boolean, boolean, integer, integer, integer, integer, boolean) TO authenticated;
