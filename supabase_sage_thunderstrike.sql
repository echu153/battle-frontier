-- 賢者の「アースクエイク」を「サンダーストライク」に変更
-- コード側 executeSkill は skill.name で効果分岐するため、DBの name 一致が必須。
-- type は「魔法攻撃」のまま（変更不要）。
UPDATE skills
SET name = 'サンダーストライク',
    description = '敵の魔法防御を30%無視し、特殊攻撃力×1.4の特殊ダメージを与える（再修練5段で×1.6）。'
WHERE class_name = '賢者' AND name = 'アースクエイク';
