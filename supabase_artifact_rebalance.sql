-- ============================================================
-- アーティファクト武器 リバランス（rarity ss→s・ステ調整・武器種統合）
--   ・10種アーティファクトのステを合計100（銃のみ130）に圧縮し rarity を s に変更
--   ・wand / rod を staff に統合（武器種固有能力＝特殊攻撃+5% が乗るようにする）
--   ・武器種固有能力（攻撃+5%等）はクライアント側 stats.js で全武器に適用（DB変更不要）
--   ・artifact 特殊能力（MP2倍・スキルダメージ1.3倍）はクライアント側で処理（DB変更不要）
-- ============================================================

-- 1) wand / rod を staff に統合
UPDATE weapons SET weapon_type = 'staff' WHERE weapon_type IN ('wand', 'rod');

-- 2) アーティファクト10種のステ＆レアリティ更新（def_bonus は全て0）
UPDATE weapons SET rarity='s', atk_bonus=90,  matk_bonus=0,   mdef_bonus=0,  spd_bonus=10 WHERE id=35; -- 黒星ノ断剣(剣)
UPDATE weapons SET rarity='s', atk_bonus=40,  matk_bonus=0,   mdef_bonus=0,  spd_bonus=60 WHERE id=36; -- 血哭ノ短刃(短剣)
UPDATE weapons SET rarity='s', atk_bonus=50,  matk_bonus=0,   mdef_bonus=0,  spd_bonus=50 WHERE id=37; -- 月影ノ断弓(弓)
UPDATE weapons SET rarity='s', atk_bonus=100, matk_bonus=0,   mdef_bonus=0,  spd_bonus=0  WHERE id=38; -- 奈落ノ処刑斧(斧)
UPDATE weapons SET rarity='s', atk_bonus=70,  matk_bonus=0,   mdef_bonus=0,  spd_bonus=30 WHERE id=39; -- 斬月ノ終刀(刀)
UPDATE weapons SET rarity='s', atk_bonus=60,  matk_bonus=60,  mdef_bonus=0,  spd_bonus=10 WHERE id=40; -- 虚無ノ閃砲(銃)
UPDATE weapons SET rarity='s', atk_bonus=70,  matk_bonus=0,   mdef_bonus=0,  spd_bonus=30 WHERE id=43; -- 冥哭ノ長槍(槍)
UPDATE weapons SET rarity='s', atk_bonus=0,   matk_bonus=100, mdef_bonus=0,  spd_bonus=0  WHERE id=41; -- 星喰ノ導杖(杖)
UPDATE weapons SET rarity='s', atk_bonus=0,   matk_bonus=70,  mdef_bonus=30, spd_bonus=0  WHERE id=42; -- 終焉ノ魔書(魔導書)
UPDATE weapons SET rarity='s', atk_bonus=0,   matk_bonus=80,  mdef_bonus=0,  spd_bonus=20 WHERE id=44; -- 深淵ノ霊珠(オーブ)

-- 3) 補填：既にアーティファクトを強化済み(enhance_plus>=1)のプレイヤーは強化値+1
--    ※ステ圧縮(ss→s)の補償。未強化(0)は対象外。
UPDATE player_equipment
SET enhance_plus = enhance_plus + 1
WHERE weapon_id IN (35,36,37,38,39,40,41,42,43,44)
  AND COALESCE(enhance_plus, 0) >= 1;

-- 確認用（武器）
SELECT id, name, weapon_type, rarity, atk_bonus, matk_bonus, mdef_bonus, spd_bonus
FROM weapons WHERE id IN (35,36,37,38,39,40,41,42,43,44) ORDER BY id;

-- 確認用（補填対象）
SELECT pe.id, p.username, w.name, pe.enhance_plus
FROM player_equipment pe
JOIN profiles p ON p.id = pe.player_id
JOIN weapons  w ON w.id = pe.weapon_id
WHERE pe.weapon_id IN (35,36,37,38,39,40,41,42,43,44)
ORDER BY pe.enhance_plus DESC;
