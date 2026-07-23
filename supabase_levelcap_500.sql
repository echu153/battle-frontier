-- ============================================================
-- 再修練5回のクラスLV上限を 300 → 500 に引き上げる（2026-07-24）
--   EXPを付与する各サーバー関数(apply_battle_result / apply_dungeon_reward /
--   casino_settle_sortie / attack_raid_boss / claim_abyss_floor 等)は、
--   キャップを "CASE WHEN retraining>=5 THEN 300 ELSE 100 END" とインラインで持っている。
--   → 現在liveの定義をそのまま活かし、その CASE の "THEN 300 ELSE 100" だけを
--      "THEN 500 ELSE 100" に書き換えて各関数を再作成する（どのファイルが正でも安全）。
--   ※ calc_exp_next は LV251+ で一律 base180 を返すため 500 まで対応済み（変更不要）。
--   ※ 既に LV300 で頭打ちだったプレイヤーは、次のEXP獲得から 300→500 へ再び伸び始める。
--   ※ 冪等（2回流しても "THEN 300 ELSE 100" が無ければ何もしない）。
-- ============================================================
DO $$
DECLARE
  r     record;
  v_new text;
  v_cnt int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ~* 'THEN\s+300\s+ELSE\s+100'
  LOOP
    v_new := regexp_replace(pg_get_functiondef(r.oid),
                            'THEN\s+300\s+ELSE\s+100', 'THEN 500 ELSE 100', 'gi');
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
    RAISE NOTICE 'level cap 300->500 applied: %()', r.proname;
  END LOOP;
  RAISE NOTICE 'updated % function(s)', v_cnt;
END $$;
