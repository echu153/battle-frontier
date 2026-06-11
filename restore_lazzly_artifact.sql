-- ============================================================
-- Lazzly の【SS】斬月ノ終刀 +4 のアーティファクト特殊能力を復元
--   再鑑定(doReAppraise)が bonus_effect='artifact' を保護せず上書きしていた不具合の補填。
--   斬月ノ終刀 は古びた刀の進化先＝アーティファクト。特殊能力は bonus_effect='artifact'
--   （【消費MP2倍・与ダメージ1.2倍】）。
-- ============================================================

-- 1) 対象行の確認（実行して1行であることを確認してから 2) を実行）
SELECT pe.id, p.username, w.name, pe.enhance_plus, pe.equipped, pe.bonus_effect
FROM player_equipment pe
JOIN profiles p ON p.id = pe.player_id
JOIN weapons  w ON w.id = pe.weapon_id
WHERE p.username = 'Lazzly' AND w.name = '斬月ノ終刀';

-- 2) 特殊能力を復元（装備中の斬月ノ終刀のみ）
UPDATE player_equipment pe
SET bonus_effect = 'artifact'
FROM profiles p, weapons w
WHERE pe.player_id = p.id AND pe.weapon_id = w.id
  AND p.username = 'Lazzly' AND w.name = '斬月ノ終刀'
  AND pe.equipped = true;
