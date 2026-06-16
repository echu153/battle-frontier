-- ============================================================
-- おれおれお に「峰岳の兜 +5」を付与
-- ============================================================

-- 1) weapon 確認（峰岳の兜が1件あること・slotを確認）
SELECT id, name, slot, rarity FROM weapons WHERE name = '峰岳の兜';

-- 2) おれおれお に +5 で付与（未装備）
INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus)
SELECT p.id, w.id, w.slot, false, 5
FROM profiles p, weapons w
WHERE p.username = 'おれおれお' AND w.name = '峰岳の兜'
LIMIT 1;
