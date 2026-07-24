-- ============================================================
-- 再修練5回のクラスLV上限を「クラス判定つき」に修正（2026-07-24）
--   正しい仕様：再修練5回での上限解放は
--     ・初期職（戦士/弓使い/魔法使い/僧侶/格闘家/サモナー）→ 300
--     ・上位職（それ以外すべて）                          → 500
--   だが、EXP付与系の各サーバー関数(apply_battle_result / apply_dungeon_reward /
--   casino_settle_sortie / attack_raid_boss / claim_abyss_floor / idle_camp 等)は
--   キャップを "CASE WHEN 再修練>=5 THEN 300(or 500) ELSE 100 END" とクラス無関係で
--   持っている（supabase_levelcap_500.sql が全職一律で 500 に置換していた）。
--
--   → その内側の "THEN <300|500>" を、クラス列(X.class)を見て
--        THEN (CASE WHEN X.class IN (初期職6種) THEN 300 ELSE 500 END)
--      に書き換えて各関数を再作成する。
--
--   ※ どのファイルが正でも安全：現在liveの定義(pg_get_functiondef)をそのまま活かし、
--      "300 ELSE 100" でも "500 ELSE 100" でも両対応で拾う。
--   ※ 冪等：適用後は "THEN <数値> ELSE 100" が消える(THENの直後がCASEになる)ため再マッチしない。
--   ※ calc_exp_next は LV251+ で一律 base180 を返すため 300/500 いずれも対応済（変更不要）。
--   ※ 集約関数は pg_get_functiondef がエラーになるため prokind='f'(通常関数)のみ対象。
-- ============================================================
DO $do$
DECLARE
  r     record;
  v_def text;
  v_new text;
  v_cnt int := 0;
  -- クラス列を捕捉：group1=…>=5 THEN まで / group2=X.class
  v_pat text := $pat$(->>\s*([A-Za-z_][A-Za-z0-9_]*\.class)\)::int,\s*0\)\s*>=\s*5\s+THEN)\s+(?:300|500)\s+ELSE\s+100$pat$;
  v_rep text := $rep$\1 CASE WHEN \2 IN ('戦士','弓使い','魔法使い','僧侶','格闘家','サモナー') THEN 300 ELSE 500 END ELSE 100$rep$;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ~* v_pat THEN
      v_new := regexp_replace(v_def, v_pat, v_rep, 'gi');
      EXECUTE v_new;
      v_cnt := v_cnt + 1;
      RAISE NOTICE 'class-aware level cap applied: %()', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'updated % function(s)', v_cnt;
END $do$;

-- 検証用（任意）：初期職が>300に到達していないか確認したい場合
-- SELECT cl.player_id, cl.class_name, cl.lv
--   FROM class_levels cl
--  WHERE cl.class_name IN ('戦士','弓使い','魔法使い','僧侶','格闘家','サモナー')
--    AND cl.lv > 300;
