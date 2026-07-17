-- ============================================================
-- レイドEXPスタック（レベル上限で戦う時のEXPを貯めて後で自動反映）
--   ・現在クラスがレベル上限に達している間は、レイドの出撃報酬EXP(7〜10)を
--     profiles.raid_exp_stack に「貯める」（最大100）。exp自体には加算しない。
--   ・レベル上限が解放される等でクラスLVが上限未満になると、次のレイド攻撃時に
--     貯めたスタックを今回のEXPと一緒にまとめてexpへ反映（＝後で自動反映）。
--   土台: supabase_raid_top3_relax25_20260712.sql（attack_raid_boss 最新版）
--   ※ これは attack_raid_boss のみを再定義。apply_battle_result等には触れないため
--      「mutant_gold を最後に」の鉄則には影響しない。raid系では本ファイルを最後に適用すること。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- 1) スタック用カラム（未追加なら追加）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS raid_exp_stack int NOT NULL DEFAULT 0;

-- 2) attack_raid_boss を再定義（上限中はEXPをスタックへ・上限未満で自動反映）
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
  -- ★EXPスタック用
  v_class_lv    int;
  v_cap         int;
  v_is_at_cap   boolean;
  v_stack_before int;
  v_stack_after  int;
  v_stack_added  int;
  v_exp_applied  int;
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

  -- 参加者レコードUpsert
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, raw_damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_eff_new, v_raw_new, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt     = v_eff_new,
      raw_damage_dealt = v_raw_new,
      attack_count     = raid_participants.attack_count + 1,
      last_attack_at   = now();

  -- 出撃報酬EXP（7〜10ランダム）
  v_exp_gain := floor(random() * 4)::int + 7;

  -- ★レベル上限判定（現在クラスのレベル vs キャップ。apply_battle_result と同じロジック）
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_player_id AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;

  v_stack_before := COALESCE(v_profile.raid_exp_stack, 0);

  PERFORM set_config('app.allow_stat_change', 'on', true);

  IF v_is_at_cap THEN
    -- 上限到達中：EXPは加算せず「EXPスタック」に貯める（最大100）
    v_stack_after := LEAST(100, v_stack_before + v_exp_gain);
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
    'exp_gain',       v_exp_applied,                       -- 実際にexpへ反映された量（上限中は0）
    'at_cap',         v_is_at_cap,
    'stack_gain',     v_stack_added,                       -- 今回スタックに貯まった量
    'stack_drained',  CASE WHEN NOT v_is_at_cap THEN v_stack_before ELSE 0 END,  -- 反映されたスタック量
    'raid_exp_stack', v_stack_after,                       -- 更新後のスタック（0〜100）
    'status',         CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;
