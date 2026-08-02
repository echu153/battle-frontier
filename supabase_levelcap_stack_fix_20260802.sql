-- ============================================================
-- 2026-08-02 【重大】上位職LV300超がEXPを一切もらえない＋レイドEXPスタックが永久に残る 修正
--
-- ■ 症状（プレイヤー報告）
--   ・出撃するたび「レイドで貯めたEXPスタック +200 を反映！」が出るのに数値が変わらない
--   ・LV394 ⇄ LV395 を永遠に繰り返す（レベルアップ表示だけ出て、リロードすると戻る）
--
-- ■ 原因（2つの複合）
--   ①【本丸】サーバー関数のレベルキャップが "retraining>=5 THEN 300 ELSE 100" と
--     ベタ書きのままだった。2026-07-24 の supabase_levelcap_initial300 は「live定義への
--     正規表現パッチ」なので、その後に全文再定義SQL（area8 / raid_update 等）を流すと
--     上位職のキャップが 500→300 に巻き戻る。
--     → 上位職LV300超は apply_battle_result / attack_raid_boss が v_is_at_cap=true と判定し、
--       EXPを一切加算しない（レイドEXPはスタックに貯まり200で頭打ち）。
--       一方クライアント(getEffectiveCap)は上位職500なので「まだ上限前」としてレベルアップを表示 → 不一致。
--   ②apply_battle_result から raid_exp_stack のドレイン処理が欠落していた
--     （2026-07-18 で追加 → 07-20 scarecrow_abyss / 07-23 area8 の全文再定義で消失）。
--     → 上限未満に戻ってもスタックが永久に残る。
--
-- ■ 対策（このファイル）
--   1) class_level_cap(class, retraining) を唯一の正として新設（100 / 初期職300 / 上位職500）
--   2) live の全関数のベタ書きキャップCASEを class_level_cap() 呼び出しへ機械的に置換
--      → 以後どのSQLを流し直しても、置換対象の形が残っていれば同じパッチで是正できる
--      （リポジトリ内の全 *.sql も同時に class_level_cap() 呼び出しへ書き換え済み＝再発防止）
--   3) apply_battle_result を「area8版 + スタックのドレイン復旧 + class_level_cap()」で再定義
--   4) 被害プレイヤーの救済: 上限未満に戻った人のスタックは次の出撃で自動反映される
--
-- ■ 適用順
--   このファイルを最後に流すこと（apply_battle_result の最新の正はこのファイル）。
--   ※ ただし supabase_mutant_gold_20260703.sql(v2) より後であること＝本ファイルが上書きする。
-- ============================================================

-- ===== 1) レベルキャップの単一の正 =====
--   再修練5回未満        : 100
--   再修練5回以上の初期職: 300
--   再修練5回以上の上位職: 500
CREATE OR REPLACE FUNCTION public.class_level_cap(p_class text, p_retraining jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE((p_retraining ->> p_class)::int, 0) < 5 THEN 100
    WHEN p_class IN ('戦士','弓使い','魔法使い','僧侶','格闘家','サモナー') THEN 300
    ELSE 500
  END;
$$;

GRANT EXECUTE ON FUNCTION public.class_level_cap(text, jsonb) TO authenticated;


-- ===== 2) live の全関数を class_level_cap() 呼び出しへ機械置換 =====
--   対象の形（いずれも1つの正規表現で拾う）:
--     CASE WHEN COALESCE((X.retraining ->> X.class)::int, 0) >= 5 THEN 300 ELSE 100 END
--     CASE WHEN COALESCE((X.retraining ->> X.class)::int, 0) >= 5 THEN 500 ELSE 100 END
--     CASE WHEN COALESCE((X.retraining ->> X.class)::int, 0) >= 5 THEN CASE WHEN X.class IN (...) THEN 300 ELSE 500 END ELSE 100 END
--   ※ 集約関数は pg_get_functiondef がエラーになるため prokind='f'(通常関数)のみ対象。
DO $do$
DECLARE
  r     record;
  v_def text;
  v_new text;
  v_cnt int := 0;
  v_pat text := $pat$CASE\s+WHEN\s+COALESCE\(\(([A-Za-z_][A-Za-z0-9_]*)\.retraining\s*->>\s*\1\.class\)::int,\s*0\)\s*>=\s*5\s+THEN\s+(?:300|500|CASE\s+WHEN\s+\1\.class\s+IN\s*\([^()]*\)\s+THEN\s+(?:300|500)\s+ELSE\s+(?:300|500)\s+END)\s+ELSE\s+100\s+END$pat$;
  v_rep text := $rep$public.class_level_cap(\1.class, \1.retraining)$rep$;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'class_level_cap'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ~ v_pat THEN
      v_new := regexp_replace(v_def, v_pat, v_rep, 'g');
      EXECUTE v_new;
      v_cnt := v_cnt + 1;
      RAISE NOTICE 'class_level_cap() applied: %()', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'updated % function(s)', v_cnt;
END $do$;


-- ===== 3) apply_battle_result 再定義 =====
--   ベース = supabase_area8_soutenn_20260723.sql §4（10引数版・エリア⑧/変異/かかしイベント込み）
--   変更点:
--     ・v_cap を class_level_cap() 呼び出しに変更
--     ・raid_exp_stack のドレイン処理を復旧（合算 → 反映したら0に）
--     ・戻り値に stack_drained / new_exp / at_cap / exp_frozen を追加
--       （クライアントがサーバー確定値でレベルアップ表示を出せるようにする）
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
  v_stack_drained integer := 0;   -- ★レイドEXPスタックの反映量（0なら未反映）
  -- ★2026-07-24: エリア別Gold倍率(×2/×1.5)を撤廃。ボス上限=倍率を織り込んだ実取得額、
  --   雑魚上限=「各エリア最大敵Gold×2(20秒モード)」の実値。これで v_max_gold への一律倍率行を廃止。
  v_boss_golds   integer[] := ARRAY[100, 500, 2000, 5000, 9000, 18750, 37500, 60000];  -- ボス取得額(織込済)
  v_normal_golds integer[] := ARRAY[60,  120,  240,  400,  600,   900,  1200,  1600];  -- 雑魚上限=最大敵Gold×2
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
  v_cap := public.class_level_cap(v_profile.class, v_profile.retraining);   -- ★初期職300/上位職500（単一の正）
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 8 THEN v_max_gold := v_boss_golds[p_area_id];    -- ★1 AND 8
  ELSIF p_area_id BETWEEN 1 AND 8 THEN v_max_gold := v_normal_golds[p_area_id];                -- ★1 AND 8
  ELSE v_max_gold := 1600; END IF;
  -- ★2026-07-24: エリア別倍率(×2/×1.5)行は撤廃（上限は上記配列の実値をそのまま使用）。

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
  -- ★上限未満・非凍結でEXPを得られる時は、レイド上限中に貯めたEXPスタックを合算してレベルアップ計算
  --   （2026-07-18 supabase_raid_exp_stack_drain で追加 → 07-20/07-23 の全文再定義で欠落していた分の復旧）
  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    v_stack_drained := COALESCE(v_profile.raid_exp_stack, 0);
    v_new_exp := v_new_exp + v_stack_drained;
  END IF;
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
    scarecrow_week_key=v_sc_week,
    raid_exp_stack=CASE WHEN v_stack_drained > 0 THEN 0 ELSE raid_exp_stack END  -- ★反映したらスタックを0に
  WHERE id=v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
    WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  RETURN json_build_object('ok',true,'level_ups',v_level_ups,'new_lv',v_new_lv,
    'mutant_first_clear',v_mutant_first_clear,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges,
    'crystal_drop',v_crys_drop,
    'stack_drained',v_stack_drained,'new_exp',v_new_exp,'at_cap',v_is_at_cap,'exp_frozen',v_exp_frozen);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_battle_result(integer, boolean, boolean, boolean, boolean, integer, integer, integer, integer, boolean) TO authenticated;


-- ===== 4) 確認用（任意） =====
-- 上位職LV300超で「上限扱い」になっていた被害者の確認
-- SELECT p.username, p.class, cl.lv, p.exp, p.raid_exp_stack,
--        public.class_level_cap(p.class, p.retraining) AS cap
--   FROM profiles p
--   LEFT JOIN class_levels cl ON cl.player_id = p.id AND cl.class_name = p.class
--  WHERE COALESCE(cl.lv, p.lv) > 300
--    AND public.class_level_cap(p.class, p.retraining) > COALESCE(cl.lv, p.lv)
--  ORDER BY cl.lv DESC;
--
-- ベタ書きキャップが残っている関数が無いことの確認（0件になればOK）
-- SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.prokind='f'
--    AND pg_get_functiondef(p.oid) ~ 'retraining\s*->>.*>=\s*5\s+THEN\s+(300|500)'
--  ORDER BY 1;
