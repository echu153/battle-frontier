-- ============================================================
-- レイドボス調整
--   ① HPを 200万 → 300万 に（自動出現・開発テスト出現とも）
--   ② 与ダメ半減: 1人が累計50万ダメージ与えたら、それ以降そのプレイヤーの与ダメは半分
--       （50万を跨ぐ一撃は、超過分だけ半減）
--   ※ attack_raid_boss は最新版(supabase_sortie_mode_public_20260626.sql)ベース
--   ※ spawn系は最新版(supabase_raid_phase2_2slots.sql / dev_claim_fix)ベース
--   Supabase の SQL Editor でファイル全体を実行してください（protect_stats より後でOK）。
-- ============================================================

-- ① & ② 攻撃RPC（与ダメ半減つき）
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;   -- 全員公開: レイド10秒固定
  v_expire_at   timestamptz;
  v_exp_gain    int;
  v_prev_dmg    bigint;      -- ★このボスへの自分の累計ダメージ
  v_over        bigint;      -- ★50万を超える分
  v_halved      boolean := false;
  v_threshold   bigint := 500000;   -- 半減の境界（累計50万）
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;
  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

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

  -- ★与ダメ半減: このボスへの自分の累計ダメージが50万を超えた分は半分になる
  SELECT damage_dealt INTO v_prev_dmg FROM raid_participants
   WHERE raid_id = p_raid_id AND player_id = v_player_id;
  v_prev_dmg := COALESCE(v_prev_dmg, 0);
  IF v_prev_dmg >= v_threshold THEN
    -- 既に50万到達済み → 今回は全部半減
    v_damage := (v_damage / 2)::bigint;
    v_halved := (v_damage > 0);
  ELSIF v_prev_dmg + v_damage > v_threshold THEN
    -- 50万を跨ぐ一撃 → 超過分だけ半減
    v_over   := (v_prev_dmg + v_damage) - v_threshold;
    v_damage := (v_damage - v_over) + (v_over / 2)::bigint;
    v_halved := true;
  END IF;

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

  v_exp_gain := 10;

  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET
    hp_current     = v_profile.hp_max,
    mp_current     = v_profile.mp_max,
    exp            = COALESCE(exp, 0) + v_exp_gain,
    last_action_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',       v_damage,
    'hp_current',   v_new_hp,
    'hp_max',       v_boss.hp_max,
    'status',       CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
    'exp',          COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gained',   v_exp_gain,
    'halved',       v_halved,
    'total_damage', v_prev_dmg + v_damage
  );
END;
$$;
GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;


-- ① 自動出現ボスのHPを300万に（21時/22時枠）
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_hour      int;
  v_min       int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
  v_is_admin  boolean;
  v_slot      int;
  v_win_start timestamptz;
  v_next_start text;
  v_next_boss  text;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = auth.uid();

  -- 開発テストボス（管理者のみ）: アクティブな is_dev ボスを最優先で返す
  IF COALESCE(v_is_admin, false) THEN
    SELECT * INTO v_boss FROM raid_boss WHERE is_dev = true AND status = 'active' ORDER BY spawned_at DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
          'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
          'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',true);
      END IF;
    END IF;
  END IF;

  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_hour     := EXTRACT(hour   FROM v_jst_now)::int;
  v_min      := EXTRACT(minute FROM v_jst_now)::int;

  IF    v_hour = 21 AND v_min < 30 THEN v_slot := 21;
  ELSIF v_hour = 22 AND v_min < 30 THEN v_slot := 22;
  ELSE  v_slot := NULL; END IF;

  IF v_slot IS NOT NULL THEN
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND slot=v_slot AND is_dev=false;
    IF NOT FOUND THEN
      v_win_start := (v_jst_date::text || 'T' || lpad(v_slot::text,2,'0') || ':00:00+09:00')::timestamptz;
      INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, slot)
      VALUES (v_jst_date, raid_boss_for_slot(v_jst_date, v_slot), 3000000, 3000000, 'active', v_win_start, v_slot)
      ON CONFLICT (spawn_date, slot) WHERE is_dev = false DO NOTHING;
      SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND slot=v_slot AND is_dev=false;
    END IF;
    IF v_boss.status = 'active' THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
    END IF;
    IF v_slot = 21 THEN
      v_next_start := (v_jst_date::text || 'T22:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date, 22);
    ELSE
      v_next_start := ((v_jst_date+1)::text || 'T21:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date+1, 21);
    END IF;
    RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
      'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
      'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',false,
      'next_spawn',v_next_start,'next_boss_name',v_next_boss);
  END IF;

  IF v_hour < 21 THEN
    v_next_start := (v_jst_date::text || 'T21:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date, 21);
  ELSIF v_hour = 21 THEN
    v_next_start := (v_jst_date::text || 'T22:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date, 22);
  ELSE
    v_next_start := ((v_jst_date+1)::text || 'T21:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date+1, 21);
  END IF;

  IF v_hour >= 21 THEN
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND is_dev=false ORDER BY slot DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      IF v_boss.status = 'active' THEN
        v_expire_at := v_boss.spawned_at + interval '30 minutes';
        IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
      END IF;
      RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
        'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
        'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',false,
        'next_spawn',v_next_start,'next_boss_name',v_next_boss);
    END IF;
  END IF;

  RETURN json_build_object('status','waiting','next_spawn',v_next_start,'next_boss_name',v_next_boss);
END;
$$;

-- ① 開発テスト出現のHPも300万に
CREATE OR REPLACE FUNCTION spawn_raid_boss_dev(p_boss_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin boolean; v_boss raid_boss%ROWTYPE; v_date date;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, false) THEN RETURN json_build_object('error', '権限がありません'); END IF;
  UPDATE raid_boss SET status = 'expired' WHERE is_dev = true AND status = 'active';
  v_date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, is_dev)
  VALUES (v_date, p_boss_name, 3000000, 3000000, 'active', now(), true)
  RETURNING * INTO v_boss;
  RETURN json_build_object('status','active','id',v_boss.id,'boss_name',v_boss.boss_name,
    'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
    'spawned_at',v_boss.spawned_at,'is_dev',true);
END;
$$;
GRANT EXECUTE ON FUNCTION spawn_raid_boss_dev(text) TO authenticated;

-- （任意）現在アクティブなボスのHP上限を300万へ引き上げる。hp_current は差分だけ増やす。
-- 実行中の討伐を強くしたくない場合はこの UPDATE はスキップしてOK。
-- UPDATE raid_boss
--   SET hp_current = hp_current + (3000000 - hp_max), hp_max = 3000000
--   WHERE status = 'active' AND hp_max < 3000000;
