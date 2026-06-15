-- ============================================================
-- レイド新ボス「あまざ」開発テスト（Phase 1）
--   ・raid_boss に is_dev 列を追加（テスト用ボス＝一般プレイヤーには見えない）
--   ・spawn_raid_boss_dev / end_raid_boss_dev（管理者のみ・即出現/終了）
--   ・spawn_raid_boss_if_needed を is_dev 対応で更新
--       - 管理者: アクティブな is_dev ボスがあれば最優先で返す
--       - 一般  : is_dev ボスは一切返さない（日次ロジックは is_dev=false のみ）
--   ※ Phase 2（21時/22時の2枠・日替わり交互）は別SQLで本番投入予定。
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 1) 列追加
ALTER TABLE raid_boss ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;

-- 2) ユニーク制約を「本番ボスのみ(spawn_date)」に変更（is_devは制約対象外＝何体でも作れる）
DROP INDEX IF EXISTS raid_boss_spawn_date_idx;
CREATE UNIQUE INDEX IF NOT EXISTS raid_boss_spawn_date_live_idx ON raid_boss(spawn_date) WHERE is_dev = false;

-- 3) スポーンRPC（is_dev対応版で上書き）
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_jst_hour  int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
  v_is_admin  boolean;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = auth.uid();

  -- ★開発テストボス（管理者のみ）: アクティブな is_dev ボスを最優先で返す
  IF COALESCE(v_is_admin, false) THEN
    SELECT * INTO v_boss FROM raid_boss WHERE is_dev = true AND status = 'active' ORDER BY spawned_at DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN
        UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
        v_boss.status := 'expired';
      END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object(
          'status', v_boss.status, 'id', v_boss.id,
          'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
          'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
          'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at, 'is_dev', true
        );
      END IF;
    END IF;
  END IF;

  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_jst_hour := EXTRACT(hour FROM v_jst_now)::int;

  -- 21時前: アクティブな本番ボスがあれば返す
  IF v_jst_hour < 21 THEN
    SELECT * INTO v_boss FROM raid_boss WHERE status = 'active' AND is_dev = false ORDER BY spawn_date DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN
        UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
        v_boss.status := 'expired';
      END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object(
          'status', v_boss.status, 'id', v_boss.id,
          'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
          'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
          'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at, 'is_dev', false
        );
      END IF;
    END IF;
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date AND is_dev = false ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object(
        'status', v_boss.status, 'id', v_boss.id,
        'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
        'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
        'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at, 'is_dev', false
      );
    END IF;
    RETURN json_build_object(
      'status', 'waiting',
      'next_spawn', (v_jst_date::text || 'T21:00:00+09:00')
    );
  END IF;

  -- 21時以降: 今日の本番ボスを取得または生成（HP 100万）
  SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date AND is_dev = false;
  IF NOT FOUND THEN
    UPDATE raid_boss SET status = 'expired' WHERE status = 'active' AND is_dev = false AND spawn_date < v_jst_date;

    INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at)
    VALUES (v_jst_date, '黒龍ヴァルゼノク', 1000000, 1000000, 'active', now())
    ON CONFLICT (spawn_date) WHERE is_dev = false DO NOTHING;

    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date AND is_dev = false;
  END IF;

  IF v_boss.status = 'active' THEN
    v_expire_at := v_boss.spawned_at + interval '30 minutes';
    IF now() > v_expire_at THEN
      UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
      v_boss.status := 'expired';
    END IF;
  END IF;

  RETURN json_build_object(
    'status', v_boss.status, 'id', v_boss.id,
    'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
    'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
    'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at, 'is_dev', false
  );
END;
$$;

-- 4) 管理者: テストボスを即出現（is_dev=true・HP100万・30分）
CREATE OR REPLACE FUNCTION spawn_raid_boss_dev(p_boss_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin boolean; v_boss raid_boss%ROWTYPE; v_date date;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, false) THEN RETURN json_build_object('error', '権限がありません'); END IF;

  -- 既存のテストボスを終了してから新規出現
  UPDATE raid_boss SET status = 'expired' WHERE is_dev = true AND status = 'active';
  v_date := (now() AT TIME ZONE 'Asia/Tokyo')::date;

  INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, is_dev)
  VALUES (v_date, p_boss_name, 1000000, 1000000, 'active', now(), true)
  RETURNING * INTO v_boss;

  RETURN json_build_object(
    'status', 'active', 'id', v_boss.id, 'boss_name', v_boss.boss_name,
    'hp_max', v_boss.hp_max, 'hp_current', v_boss.hp_current,
    'spawn_date', v_boss.spawn_date, 'spawned_at', v_boss.spawned_at, 'is_dev', true
  );
END;
$$;
GRANT EXECUTE ON FUNCTION spawn_raid_boss_dev(text) TO authenticated;

-- 5) 管理者: テストボスを終了
CREATE OR REPLACE FUNCTION end_raid_boss_dev()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin boolean;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, false) THEN RETURN json_build_object('error', '権限がありません'); END IF;
  UPDATE raid_boss SET status = 'expired' WHERE is_dev = true AND status = 'active';
  RETURN json_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION end_raid_boss_dev() TO authenticated;
