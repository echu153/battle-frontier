-- ============================================================
-- 博物館 寄贈ボーナス倍率アップ（2026-08-08）／全5ファイル
--   1_backup   … バックアップ作成         ← 最初に必ず
--   2_check    … 事前チェック（読むだけ）  ← 全部0なら安全
--   3_preview  … 変化プレビュー（読むだけ）
--   4_apply    … 本体（★これだけがデータを変える）
--   5_rollback … 戻す（問題が出た時だけ）
-- ============================================================
-- 【このファイル②】再計算で取りこぼす記録が無いかを数えるだけ（データは一切変えない）。
--   ★「件数」が全部 0 なら、そのまま 3_preview → 4_apply へ進んでよい。
--   0以外の行があれば 4_apply を流さずに件数を共有すること。
-- ============================================================

WITH item_group(name, gid) AS (VALUES
    ('木の盾', 'beginner'),
    ('木の靴', 'beginner'),
    ('粗悪な布', 'beginner'),
    ('粗悪な鎧', 'beginner'),
    ('粗悪な指輪', 'beginner'),
    ('粗悪なピアス', 'beginner'),
    ('ロングソード', 'beginner'),
    ('マチェット', 'beginner'),
    ('丈夫な弓', 'beginner'),
    ('見習いの杖', 'beginner'),
    ('見習い魔導書', 'beginner'),
    ('鋼鉄の剣', 'beginner'),
    ('鋭利なナイフ', 'beginner'),
    ('狩人の弓', 'beginner'),
    ('魔導の杖', 'beginner'),
    ('魔術教本', 'beginner'),
    ('戦士の指輪', 'beginner'),
    ('略奪の腕輪', 'beginner'),
    ('古代の護符', 'beginner'),
    ('秘術の首飾り', 'beginner'),
    ('重鋼剣', 'area4'),
    ('双牙短剣', 'area4'),
    ('疾風の弓', 'area4'),
    ('蒼木の杖', 'area4'),
    ('精霊魔導典', 'area4'),
    ('海流の腕輪', 'area4'),
    ('蒼海の大剣', 'area4'),
    ('海狼短剣', 'area4'),
    ('蒼潮の弓', 'area4'),
    ('海晶の杖', 'area4'),
    ('海霊詠唱録', 'area4'),
    ('蒼海の護符', 'area4'),
    ('山岳の斧', 'area5'),
    ('岩砕の拳', 'area5'),
    ('霞散弾銃', 'area5'),
    ('嵐のオーブ', 'area5'),
    ('峰岳の兜', 'area5'),
    ('岩石鎧', 'area5'),
    ('山岳の靴', 'area5'),
    ('岩石の護符', 'area5'),
    ('雷砕斧', 'area5'),
    ('鷹爪の拳', 'area5'),
    ('雷鳴銃', 'area5'),
    ('雷晶オーブ', 'area5'),
    ('嵐の兜', 'area5'),
    ('雷鷲鎧', 'area5'),
    ('疾風の靴', 'area5'),
    ('峰岳の守護輪', 'area5'),
    ('氷刃の剣', 'area6'),
    ('霜穿の槍', 'area6'),
    ('吹雪の弓', 'area6'),
    ('氷晶の杖', 'area6'),
    ('凍月刀', 'area6'),
    ('氷晶の護符', 'area6'),
    ('白銀の大剣', 'area6'),
    ('氷河長槍', 'area6'),
    ('極雪の弓', 'area6'),
    ('霜嵐の杖', 'area6'),
    ('凍蒼の刀', 'area6'),
    ('霜の宝珠', 'area6'),
    ('業火の短剣', 'area7'),
    ('炎のワンド', 'area7'),
    ('煉獄魔導書', 'area7'),
    ('炎の兜', 'area7'),
    ('溶岩鎧', 'area7'),
    ('紅蓮の靴', 'area7'),
    ('溶岩の指輪', 'area7'),
    ('サラマンダーブレード', 'area7'),
    ('フェニックスワンド', 'area7'),
    ('煉獄のコデックス', 'area7'),
    ('溶鉄のクラウン', 'area7'),
    ('ドレイクアーマー', 'area7'),
    ('ヴァルカンブーツ', 'area7'),
    ('業炎の指輪', 'area7'),
    ('蒼天の剣', 'area8'),
    ('天翼の短剣', 'area8'),
    ('疾風天弓', 'area8'),
    ('蒼雲の杖', 'area8'),
    ('天空魔導書', 'area8'),
    ('天羽の鎧', 'area8'),
    ('蒼天の指輪', 'area8'),
    ('蒼天大剣', 'area8'),
    ('天翔短剣', 'area8'),
    ('天穿弓', 'area8'),
    ('蒼天霊杖', 'area8'),
    ('天空霊典', 'area8'),
    ('蒼穹の鎧', 'area8'),
    ('天翼の護符', 'area8'),
    ('スライムの指輪', 'boss'),
    ('蒼粘剣', 'boss'),
    ('略奪者の短剣', 'boss'),
    ('影踏みのブーツ', 'boss'),
    ('古代魔導コア', 'boss'),
    ('虚無の杖', 'boss'),
    ('海竜の鱗', 'boss'),
    ('アクアクラウン', 'boss'),
    ('雷鷲の爪牙', 'boss'),
    ('嵐の重装甲', 'boss'),
    ('絶零の魔導砲', 'boss'),
    ('フロストバーンの聖鎧', 'boss'),
    ('深紅の牙輪', 'boss'),
    ('深紅の魔眼石', 'boss'),
    ('インフェルノバスティオン', 'boss'),
    ('ウラノスの天砲', 'boss'),
    ('覇龍の聖鎧', 'boss'),
    ('蒼天龍の指輪', 'boss'),
    ('ぷよぷよロッド', 'boss'),
    ('怪盗の指輪', 'boss'),
    ('結晶グリーブ', 'boss')
)
SELECT 'bonus_statが未設定/不明（この寄贈分が0になる）' AS check_item, count(*) AS "件数"
  FROM public.museum_donations
 WHERE bonus_stat IS NULL
    OR bonus_stat NOT IN ('atk','def','matk','mdef','spd','hp_max','mp_max','atk_matk')
UNION ALL
SELECT 'enhance_tierが0/1/2以外（この寄贈分が0になる）', count(*)
  FROM public.museum_donations
 WHERE enhance_tier IS NULL OR enhance_tier NOT IN (0,1,2)
UNION ALL
SELECT '今の装備リストに無い装備名（記録時のarea_groupで計算する）', count(*)
  FROM public.museum_donations md
  LEFT JOIN item_group ig ON ig.name = md.weapon_name
 WHERE ig.name IS NULL
UNION ALL
SELECT '旧形式のコンプ記録（__なし・ティア0として数える）', count(*)
  FROM public.museum_complete_bonuses
 WHERE position('__' in group_id) = 0
UNION ALL
SELECT '定義に無いコンプgroup_id（この分が0になる）', count(*)
  FROM public.museum_complete_bonuses mcb
 WHERE split_part(mcb.group_id, '__', 1) NOT IN ('beginner','area4','area5','area6','area7','area8');
