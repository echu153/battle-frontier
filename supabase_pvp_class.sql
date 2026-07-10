-- ============================================================
-- PvP専用クラス設定（対人戦を出撃と切り離す）
--  ・pvp_class = 対人戦で使うクラス（null=現クラスで戦う＝従来動作）
--  ・set_pvp_class: 就いたことのある(class_levelsにある)クラスのみ設定可
-- 保護トリガー対象外の列なので素のUPDATEで可（安全のためGUCも立てる）
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pvp_class text;

CREATE OR REPLACE FUNCTION public.set_pvp_class(p_class text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_val text := NULLIF(p_class, '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  -- 解除(null)以外は「就いたことのあるクラス」のみ許可
  IF v_val IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM class_levels
       WHERE player_id = v_uid AND class_name = v_val
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'class_not_owned');
  END IF;
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET pvp_class = v_val WHERE id = v_uid;
  RETURN json_build_object('ok', true, 'pvp_class', v_val);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_pvp_class(text) TO authenticated;

-- ============================================================
-- pvp_get_skillsets を更新: 相手の class_levels も返す
--  （対人戦でPvPクラスのステを「そのクラスに転職した値」で再計算するため。
--    class_levels はSECURITY DEFINERで読む＝RLSに依存しない）
-- ============================================================
CREATE OR REPLACE FUNCTION pvp_get_skillsets(p_target uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result   json;
  v_use_type text;
  v_classes  json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', '未認証です');
  END IF;

  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM skill_sets s2
      JOIN skills sk2 ON sk2.id = s2.skill_id
      WHERE s2.player_id = p_target AND s2.set_type = 'pvp'
        AND COALESCE(sk2.type, '') <> 'パッシブ'
    ) THEN 'pvp' ELSE 'sortie' END
  INTO v_use_type;

  SELECT COALESCE(json_agg(t ORDER BY t.slot_order), '[]'::json) INTO v_result
  FROM (
    SELECT ss.id, ss.player_id, ss.skill_id, ss.slot_order,
           COALESCE(ss.use_count, 1) AS use_count, ss.set_type,
           row_to_json(sk) AS skills
    FROM skill_sets ss
    LEFT JOIN skills sk ON sk.id = ss.skill_id
    WHERE ss.player_id = p_target
      AND COALESCE(ss.set_type, 'sortie') = v_use_type
  ) t;

  SELECT COALESCE(json_agg(json_build_object('class_name', class_name, 'lv', lv)), '[]'::json)
  INTO v_classes
  FROM class_levels WHERE player_id = p_target;

  RETURN json_build_object('ok', true, 'skill_sets', v_result, 'class_levels', v_classes);
END;
$$;
GRANT EXECUTE ON FUNCTION pvp_get_skillsets(uuid) TO authenticated;
