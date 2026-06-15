-- ============================================================
-- 黒龍の鎧: 攻撃+5%(atk_bonus_pct) を確実に設定
--   クライアントは atk_bonus_pct を実効ステ・表示に反映するよう修正済み。
--   この列が 0 のままだと攻撃+5%が出ないため、念のため再設定する。
-- ============================================================
-- 列が無い環境向けの保険（既にあれば何もしない）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='weapons' AND column_name='atk_bonus_pct') THEN
    ALTER TABLE weapons ADD COLUMN atk_bonus_pct int NOT NULL DEFAULT 0;
  END IF;
END $$;

UPDATE weapons SET atk_bonus_pct = 5 WHERE name = '黒龍の鎧';

-- 確認
SELECT name, atk_bonus_pct, matk_bonus_pct FROM weapons WHERE name = '黒龍の鎧';
