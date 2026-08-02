-- ※ クラスLVキャップは public.class_level_cap(class, retraining) が唯一の正（初期職300/上位職500）。
--    定義は supabase_levelcap_stack_fix_20260802.sql。このファイル単体を流す場合は先に同ファイルを適用すること。
-- ============================================================
-- かかし修練場＋奈落闘技場イベント (JST 2026/7/20 5:00 〜 2026/8/3 4:59)
--   ・かかし修練場: 獲得EXP 2倍 ＋ チャージ必要出撃回数 50回→10回
--   ・奈落闘技場 : フロア報酬(Gold/強化石/宝石/匠の秘伝書) 2倍
--   すべて期間自動判定＝イベント終了後は自動で通常値に戻る（再適用不要）。
--
-- ★★【重要・SQL適用順の鉄則を更新】★★
--   このファイルの apply_battle_result は supabase_mutant_toggle_fix_20260707.sql
--   （10引数版・最新の正）をベースに「かかしチャージ回数のイベント判定」を追加したもの。
--   → 以後、protect_stats 等で apply_battle_result が巻き戻った場合は
--     【このファイルを最後に】流し直すこと（mutant_toggle_fix ではなく）。
--     イベント期間外は toggle_fix 版と完全に同じ挙動（チャージ50回）になる。
--   claim_abyss_floor は supabase_takumi_hidensho.sql 版（秘伝書付与あり）がベース。
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ===== 0) イベント期間判定（共通ヘルパー） =====
CREATE OR REPLACE FUNCTION public.bf_event_20260720_active()
 RETURNS boolean
 LANGUAGE sql STABLE
AS $$
  SELECT now() >= '2026-07-20 05:00:00+09'::timestamptz
     AND now() <  '2026-08-03 05:00:00+09'::timestamptz;
$$;

-- ===== 1) かかし修練場: 獲得EXP 2倍 =====
--   scarecrow_state / scarecrow_start / scarecrow_claim すべてがこの関数を参照するため
--   ここを差し替えるだけで表示・付与の両方がイベント対応になる。
--   ※ 旧定義は IMMUTABLE だったが期間判定のため STABLE に変更（CREATE OR REPLACE で変更可）
CREATE OR REPLACE FUNCTION public.scarecrow_exp_for_hours(p_hours int)
 RETURNS int
 LANGUAGE sql STABLE
AS $$
  SELECT (CASE p_hours
    WHEN 3 THEN 200 WHEN 4 THEN 300 WHEN 5 THEN 450
    WHEN 6 THEN 600 WHEN 7 THEN 850 WHEN 8 THEN 1000
    ELSE 0 END) * (CASE WHEN bf_event_20260720_active() THEN 2 ELSE 1 END);
$$;

-- ===== 2) apply_battle_result: チャージ必要出撃回数 50→10（イベント中のみ） =====
--   supabase_mutant_toggle_fix_20260707.sql（10引数版・最新の正）の全文＋
--   ★イベント箇所のみ変更（v_sc_need と WHILE ループ化）。
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
  v_boss_golds   integer[] := ARRAY[50, 250, 1000, 2500, 6000, 12500, 25000];
  v_normal_golds integer[] := ARRAY[30,  60,  120,  200,  400,   600,   800];  -- ★出撃ゴールド再配分(2026-07-03)
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
  v_cap := public.class_level_cap(v_profile.class, v_profile.retraining);
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_boss_golds[p_area_id];
  ELSIF p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_normal_golds[p_area_id];
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
  IF p_win AND p_is_boss AND p_area_id < 7
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

-- ===== 3) claim_abyss_floor: フロア報酬2倍（イベント中のみ） =====
--   supabase_takumi_hidensho.sql 版（秘伝書付与あり＝最新の正）の全文＋
--   ★イベント倍率 v_mul と、並行クレーム防止の FOR UPDATE を復元（takumi版で欠落していた）。
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
  -- ★イベント(2026/7/20〜8/3): 報酬2倍
  v_mul            int := CASE WHEN bf_event_20260720_active() THEN 2 ELSE 1 END;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > 20 THEN RETURN json_build_object('error', '不正なフロアです'); END IF;

  -- 奈落ウィーク（毎週月曜 朝5時JSTが境界）
  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  v_reset   := ((v_week + interval '7 days')::timestamp + interval '5 hours') AT TIME ZONE 'Asia/Tokyo';

  -- 行ロック（並行クレーム防止）。なければ作成。
  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO abyss_progress (player_id, cleared_floor) VALUES (v_player_id, 0)
    ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
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

  -- ★イベント倍率適用（Gold/強化石/宝石。秘伝書は下で v_mul 冊付与）
  v_gold        := v_gold * v_mul;
  v_stone_count := v_stone_count * v_mul;
  v_gem_count   := v_gem_count * v_mul;

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

  -- ★匠の秘伝書付与（階層別・イベント中は2冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, v_mul, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_mul;
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
    'book_count',  CASE WHEN v_book_name IS NULL THEN 0 ELSE v_mul END,
    'event_x2',    (v_mul > 1),
    'reset_at',    v_reset
  );
END;
$$;
GRANT EXECUTE ON FUNCTION claim_abyss_floor(int, int) TO authenticated;
