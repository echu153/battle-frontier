-- ============================================================
-- LV100未満のEXP1.5倍が原因で誤検知(invalid_exp)されたプレイヤーの洗い出し（読み取り専用）
--   旧上限: 通常11 / ボス13 / パピア200
--   1.5倍後の正規上限: 通常17 / ボス20 / パピア300（CEIL基準）
--   suspicious=true かつ exp_gained が「旧上限超〜1.5倍上限以下」＝今回の誤検知。
--   ※この帯は1.5倍なら正規なので不正ではない（チート値はこの帯を超える）。
--   ※Gold検知は元から1.5倍上限のため対象外。
-- ============================================================

-- ① 誤検知されたプレイヤー別の件数・最終発生時刻
SELECT p.username AS プレイヤー,
       count(*)   AS 誤検知回数,
       max(bl.created_at) AS 最終発生,
       pr.suspicious_flag AS 現在の不正フラグ,
       pr.exp_frozen_until AS EXP凍結期限
FROM battle_logs bl
JOIN profiles p  ON p.id = bl.player_id
JOIN profiles pr ON pr.id = bl.player_id
WHERE bl.suspicious = true
  AND (
        (bl.is_papia = true                       AND bl.exp_gained BETWEEN 201 AND 300)
     OR (bl.is_boss  = true AND bl.is_papia=false  AND bl.exp_gained BETWEEN 14  AND 20)
     OR (bl.is_boss = false AND bl.is_papia=false  AND bl.exp_gained BETWEEN 12  AND 17)
      )
GROUP BY p.username, pr.suspicious_flag, pr.exp_frozen_until
ORDER BY 誤検知回数 DESC;

-- ② 今も影響が残っている人だけ（凍結中 or 不正フラグ立ったまま）
-- SELECT DISTINCT p.username, pr.suspicious_flag, pr.exp_frozen_until
-- FROM battle_logs bl
-- JOIN profiles p  ON p.id = bl.player_id
-- JOIN profiles pr ON pr.id = bl.player_id
-- WHERE bl.suspicious = true
--   AND ( (bl.is_papia AND bl.exp_gained BETWEEN 201 AND 300)
--      OR (bl.is_boss AND NOT bl.is_papia AND bl.exp_gained BETWEEN 14 AND 20)
--      OR (NOT bl.is_boss AND NOT bl.is_papia AND bl.exp_gained BETWEEN 12 AND 17) )
--   AND (pr.suspicious_flag = true OR (pr.exp_frozen_until IS NOT NULL AND pr.exp_frozen_until > now()));
