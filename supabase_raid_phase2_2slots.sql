-- ============================================================
-- レイド Phase 2: 21時/22時の2枠・日替わり交互（ヴァルゼノク／雨摩座）
--   ・1日2体: 21:00〜21:30 と 22:00〜22:30（各30分・HP100万）
--   ・日替わりで交互: 偶数日 21時=ヴァルゼノク/22時=雨摩座、奇数日は逆
--   ・各枠は別レイド（参加・貢献・報酬は枠ごと独立）
--   ・管理者テスト出現(is_dev)も内包（Phase1未適用環境でもこの1本でOK）
--   Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- 1) 列追加（is_dev / slot）
ALTER TABLE raid_boss ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;
ALTER TABLE raid_boss ADD COLUMN IF NOT EXISTS slot   int;

-- 既存の本番行は slot=21 とみなす
UPDATE raid_boss SET slot = 21 WHERE slot IS NULL AND is_dev = false;

-- 2) ユニーク制約を (spawn_date, slot) に（本番のみ・is_devは対象外）
DROP INDEX IF EXISTS raid_boss_spawn_date_idx;
DROP INDEX IF EXISTS raid_boss_spawn_date_live_idx;
CREATE UNIQUE INDEX IF NOT EXISTS raid_boss_date_slot_idx ON raid_boss(spawn_date, slot) WHERE is_dev = false;

-- 3) 日付＋枠 → 出現ボス名（日替わり交互）
CREATE OR REPLACE FUNCTION raid_boss_for_slot(p_date date, p_slot int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ((p_date - DATE '2000-01-01') % 2) = 0 THEN
      CASE WHEN p_slot = 21 THEN '黒龍ヴァルゼノク' ELSE '雨摩座' END
    ELSE
      CASE WHEN p_slot = 21 THEN '雨摩座' ELSE '黒龍ヴァルゼノク' END
  END
$$;

-- 4) スポーンRPC（2枠 + 管理者テスト対応）
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

  -- ★開発テストボス（管理者のみ）: アクティブな is_dev ボスを最優先で返す
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

  -- 現在のウィンドウ（21:00-21:30 / 22:00-22:30）
  IF    v_hour = 21 AND v_min < 30 THEN v_slot := 21;
  ELSIF v_hour = 22 AND v_min < 30 THEN v_slot := 22;
  ELSE  v_slot := NULL; END IF;

  -- ウィンドウ内: その枠のボスを取得/生成して返す
  IF v_slot IS NOT NULL THEN
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND slot=v_slot AND is_dev=false;
    IF NOT FOUND THEN
      v_win_start := (v_jst_date::text || 'T' || lpad(v_slot::text,2,'0') || ':00:00+09:00')::timestamptz;
      INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, slot)
      VALUES (v_jst_date, raid_boss_for_slot(v_jst_date, v_slot), 2000000, 2000000, 'active', v_win_start, v_slot)
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

  -- ウィンドウ外: 次の出現時刻＆ボスを算出
  IF v_hour < 21 THEN
    v_next_start := (v_jst_date::text || 'T21:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date, 21);
  ELSIF v_hour = 21 THEN  -- 21:30〜21:59（21:00-21:29は上で処理済み）
    v_next_start := (v_jst_date::text || 'T22:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date, 22);
  ELSE  -- 22:30以降
    v_next_start := ((v_jst_date+1)::text || 'T21:00:00+09:00'); v_next_boss := raid_boss_for_slot(v_jst_date+1, 21);
  END IF;

  -- 受け取り用: 21時以降なら今日の最新枠ボス（終了済み）を返す
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

-- 5) 管理者テスト用RPC（Phase1未適用でも使えるよう同梱・冪等）
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
  VALUES (v_date, p_boss_name, 2000000, 2000000, 'active', now(), true)
  RETURNING * INTO v_boss;
  RETURN json_build_object('status','active','id',v_boss.id,'boss_name',v_boss.boss_name,
    'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
    'spawned_at',v_boss.spawned_at,'is_dev',true);
END;
$$;
GRANT EXECUTE ON FUNCTION spawn_raid_boss_dev(text) TO authenticated;

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
