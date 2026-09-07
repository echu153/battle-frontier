-- ============================================================
-- ボス装備（高レア）の一覧＋％ボーナス確認（読み取り専用・列名を決め打ちしない）
--   クライアント(lib/stats.js)が反映している％列:
--     atk_bonus_pct / matk_bonus_pct / hp_bonus_pct / mp_bonus_pct / spd_bonus_pct
--   → def_bonus_pct / mdef_bonus_pct は未反映。
-- ============================================================

-- ① weapons の全列名（スキーマ確認用）
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS weapons列一覧
FROM information_schema.columns
WHERE table_name = 'weapons';

-- ② ボス装備（S/SS/SSS）の固定ボーナスと％ボーナスを表示
SELECT
  w.name   AS 装備名,
  w.rarity AS レア,
  w.weapon_type AS 種別,
  w.slot   AS 部位,
  w.atk_bonus  AS atk, w.def_bonus AS def, w.matk_bonus AS matk,
  w.mdef_bonus AS mdef, w.spd_bonus AS spd,
  ( SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(to_jsonb(w))
    WHERE key LIKE '%\_pct' ESCAPE '\' AND value::text <> '0' AND value::text <> 'null'
  ) AS "％(非ゼロのみ)"
FROM weapons w
WHERE w.rarity IN ('s','ss','sss')
ORDER BY w.rarity DESC, w.name;

-- ③ どのレアにでも％が設定されている装備を全部（％の付け忘れ/表示漏れ調査用）
SELECT
  w.name AS 装備名, w.rarity AS レア,
  ( SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(to_jsonb(w))
    WHERE key LIKE '%\_pct' ESCAPE '\' AND value::text <> '0' AND value::text <> 'null'
  ) AS "％ボーナス"
FROM weapons w
WHERE EXISTS (
  SELECT 1 FROM jsonb_each(to_jsonb(w)) e
  WHERE e.key LIKE '%\_pct' ESCAPE '\' AND e.value::text <> '0' AND e.value::text <> 'null'
)
ORDER BY w.rarity DESC, w.name;
