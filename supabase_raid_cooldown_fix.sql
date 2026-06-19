-- ============================================================
-- レイドボス 0秒出撃（クールダウンすり抜け）対策 (2026-06-11)
--   原因: attack_raid_boss が profiles を行ロック無しで SELECT してから
--         last_action_at をチェック→更新していたため、連打・複数端末・
--         二重発火で複数リクエストが同時にCDチェックを通過できた。
--   修正: profiles を SELECT ... FOR UPDATE で行ロックし、同一プレイヤーの
--         attack_raid_boss を直列化。これでCDチェックがすり抜けない。
--   ※ supabase_scarecrow.sql の attack_raid_boss（かかし修練ガード入り・最新版）
--     を完全置換。差分は v_profile の SELECT に FOR UPDATE を足しただけ。
-- ============================================================
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;
  v_expire_at   timestamptz;
  v_exp_gain    int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  -- かかし修練は時間経過待ちの放置型のため、その間もレイド出撃は許可する
  -- （以前は「かかし修練中は出撃できません」で弾いていたが、ユーザー要望で解除）

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;

  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  -- ★ FOR UPDATE で行ロック：同一プレイヤーの同時/連打リクエストを直列化し
  --   クールダウンチェックのすり抜け（0秒出撃）を防ぐ
  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

  IF v_profile.last_action_at IS NOT NULL THEN
    IF now() - v_profile.last_action_at < (v_cooldown || ' seconds')::interval THEN
      RETURN json_build_object(
        'error', 'cooldown',
        'seconds_left', v_cooldown - EXTRACT(EPOCH FROM (now() - v_profile.last_action_at))::int
      );
    END IF;
  END IF;

  v_damage := LEAST(p_damage, 1000000);
  v_damage := GREATEST(v_damage, 0);

  v_new_hp := GREATEST(0, v_boss.hp_current - v_damage);

  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_damage, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt   = raid_participants.damage_dealt + v_damage,
      attack_count   = raid_participants.attack_count + 1,
      last_attack_at = now();

  -- かかし修練中もレイド出撃EXPを付与する（2026-06-19仕様変更）
  v_exp_gain := 10;

  -- 共有CD更新 + 出撃報酬（HP/MP全回復・EXP+v_exp_gain）
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
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gained', v_exp_gain
  );
END;
$$;

GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;
