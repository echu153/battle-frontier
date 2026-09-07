-- ============================================================
-- レイドボスが出ない原因の切り分け（読み取り専用）
-- ============================================================

-- ① サーバーが認識している現在のJST時刻（窓: 21:00-21:30 / 22:00-22:30 のみ出現）
SELECT (now() AT TIME ZONE 'Asia/Tokyo')              AS jst_now,
       EXTRACT(hour   FROM now() AT TIME ZONE 'Asia/Tokyo')::int AS jst_hour,
       EXTRACT(minute FROM now() AT TIME ZONE 'Asia/Tokyo')::int AS jst_min;

-- ② 本番の出現関数が今この瞬間に何を返すか（status=waiting なら窓外/未生成）
SELECT spawn_raid_boss_if_needed() AS spawn_result;

-- ③ 本日(JST)の raid_boss 行（slot列が無い＝Phase2未適用の可能性）
SELECT id, boss_name, status, slot, is_dev, spawn_date, spawned_at, hp_current
FROM raid_boss
WHERE spawn_date = (now() AT TIME ZONE 'Asia/Tokyo')::date
ORDER BY spawned_at DESC;

-- ④ 関数定義に slot/2枠ロジックが入っているか（Phase2が本番かどうかの確認）
SELECT (pg_get_functiondef('public.spawn_raid_boss_if_needed()'::regprocedure)
        LIKE '%v_slot%') AS is_phase2_2slots;
