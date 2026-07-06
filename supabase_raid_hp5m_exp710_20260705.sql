-- ============================================================
-- レイドボス調整（2026-07-05）
--   ① HP 500万（今アクティブなボスへ即反映）
--   ② 出撃報酬EXP 7〜10 ランダム（attack_raid_boss 再定義）
--   ③ ダメージ「30万以降90%軽減」はクライアント(RaidBoss.jsx)側＝デプロイで反映。
--   ※ 次回spawn以降もHP500万にするには、編集済みの
--      supabase_raid_phase2_2slots.sql（spawn関数群）も実行すること。
--   Supabase の SQL Editor で丸ごと実行してOK。
-- ============================================================

-- ① 現在アクティブなレイドボスを即HP500万へ（既存ダメージ分は維持しつつ上限を+300万）
UPDATE raid_boss
SET hp_max     = 5000000,
    hp_current = hp_current + (5000000 - hp_max)
WHERE status = 'active' AND hp_max < 5000000;

-- ② attack_raid_boss を再定義（出撃報酬EXPを 7〜10 のランダムに）
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_participant raid_participants%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;
  v_expire_at   timestamptz;
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

  -- ダメージ上限チェック（不正防止: 合理的な上限を設定）
  v_damage := LEAST(p_damage, 1000000);
  v_damage := GREATEST(v_damage, 0);

  v_new_hp := GREATEST(0, v_boss.hp_current - v_damage);

  -- ボスHP更新
  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  -- 参加者レコードUpsert（attack_count も加算）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_damage, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt   = raid_participants.damage_dealt + v_damage,
      attack_count   = raid_participants.attack_count + 1,
      last_attack_at = now();

  -- 共有CD更新 + 出撃報酬（HP/MP全回復・EXP 7〜10 ランダム）
  -- ※ exp は保護トリガー対象のため GUC を立ててから更新する
  v_exp_gain := floor(random() * 4)::int + 7;  -- 7,8,9,10 のいずれか
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET
    hp_current     = v_profile.hp_max,
    mp_current     = v_profile.mp_max,
    exp            = COALESCE(exp, 0) + v_exp_gain,
    last_action_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',     v_damage,
    'hp_current', v_new_hp,
    'hp_max',     v_boss.hp_max,
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;
