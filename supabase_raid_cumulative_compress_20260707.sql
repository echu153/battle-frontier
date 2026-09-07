-- ============================================================
-- レイド 与ダメ制限【仕組みA：累計】を「プレイヤーごとの累計貢献」に適用（2026-07-07）
--   ・レイド中の累計ダメージが30万に達したら、それ以降は90%カット（超過分×0.1）。
--   ・raid_participants.damage_dealt（＝参加者一覧の表示/貢献の元）に反映。
--   ・生の累計は raw_damage_dealt 列で保持し、圧縮後を damage_dealt に格納。
--   ・ボスHPも「圧縮後の貢献の増分」だけ減る。
--   ※【仕組みB：1ヒット段階カット】はクライアント(RaidBoss.jsx)側＝デプロイで反映。
--   Supabase の SQL Editor で丸ごと実行してください。
-- ============================================================

-- 1) 圧縮関数（累計30万まで等倍・超過分は90%カット＝×0.1）
CREATE OR REPLACE FUNCTION compress_raid_dmg(d bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d <= 0      THEN 0
    WHEN d <= 300000 THEN d
    ELSE 300000 + floor((d - 300000) * 0.1)::bigint
  END
$$;

-- 2) 生累計ダメージ列を追加。既存 damage_dealt を生累計としてシードし、
--    表示値(damage_dealt)は即座に圧縮後へ置き換える（進行中レイドにも即反映）。
ALTER TABLE raid_participants ADD COLUMN IF NOT EXISTS raw_damage_dealt bigint;
UPDATE raid_participants SET raw_damage_dealt = damage_dealt WHERE raw_damage_dealt IS NULL;
UPDATE raid_participants SET damage_dealt = compress_raid_dmg(raw_damage_dealt)
  WHERE damage_dealt <> compress_raid_dmg(raw_damage_dealt);

-- 3) attack_raid_boss を再定義（累計圧縮＋出撃報酬EXP7〜10）
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

  -- 累計に対して圧縮：今回ボスに通る有効ダメージ＝圧縮後の増分
  v_raw_new  := v_prev_raw + v_damage;
  v_eff_prev := compress_raid_dmg(v_prev_raw);
  v_eff_new  := compress_raid_dmg(v_raw_new);
  v_boss_dmg := GREATEST(0, v_eff_new - v_eff_prev);

  v_new_hp := GREATEST(0, v_boss.hp_current - v_boss_dmg);

  -- ボスHP更新
  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  -- 参加者レコードUpsert（damage_dealt=圧縮後の累計・raw_damage_dealt=生累計）
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
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gain',   v_exp_gain,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;
