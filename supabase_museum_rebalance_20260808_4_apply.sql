-- ============================================================
-- 博物館 寄贈ボーナス倍率アップ（2026-08-08）／全5ファイル
--   1_backup   … バックアップ作成         ← 最初に必ず
--   2_check    … 事前チェック（読むだけ）  ← 全部0なら安全
--   3_preview  … 変化プレビュー（読むだけ）
--   4_apply    … 本体（★これだけがデータを変える）
--   5_rollback … 戻す（問題が出た時だけ）
-- ============================================================
-- 【このファイル④】★データを変更する唯一のファイル★
--   museum_donations / museum_complete_bonuses の記録から、全プレイヤーの
--   profiles.museum_atk/def/matk/mdef/spd/hp/mp を新しい倍率で丸ごと再計算して上書きする。
--   → 既に寄贈済みの人にも反映される。何度流しても同じ結果（冪等）。
--
-- 【変更内容】src/pages/Museum.jsx と同じ値
--   寄贈ボーナス（素の値・未強化/+5以上/+9以上）… +5を2倍・+9を5倍へ
--     通常装備     [1,2,4]   → [1,4,20]（さらに×エリア倍率×2）
--     レアドロップ [2,3,6]   → [2,6,30]（×2）
--     ボスドロップ [8,13,20] → [8,26,100]（×2）
--   コンプリートボーナス倍率 [1,3,5] → [1,4,10]
--
-- 【前提・注意】
--   ・先に 1_backup を実行しておくこと（戻せなくなる）。
--   ・museum_* 列に書き込むのは博物館（Museum.jsx）だけ＝この全再計算で消える他の加算はない。
--   ・寄贈記録がまったく無いプレイヤーは対象外（現在値をそのまま残す）。
--   ・過去の二重付与/取りこぼし（99fcf72で修正済のstale上書き）があった人は
--     「記録が正」に揃う＝わずかに増減する可能性がある。
--   ・どのステータスが上がるか（bonus_stat）は記録時のまま。量だけ計算し直す。
--   ・protect_stats の保護列（lv/exp/stat_point_spent等）は触らないので app.allow_stat_change 不要。
--   ・今後また倍率を変える時は、上の tier_new / cmult を新しい値に直してこのファイルを流し直せば
--     既存プレイヤーへの反映も同時に済む。
-- ============================================================

WITH
-- 装備名 → 所属グループ（Museum.jsx ITEM_GROUP_MAP と一致。ボス枠は 'boss'）
item_group(name, gid) AS (VALUES
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
),
-- エリア4以降のレアドロップ（Museum.jsx RARE_DROPS と一致）
rare(name) AS (VALUES
    ('蒼海の大剣'),
    ('海狼短剣'),
    ('蒼潮の弓'),
    ('海晶の杖'),
    ('海霊詠唱録'),
    ('蒼海の護符'),
    ('雷砕斧'),
    ('鷹爪の拳'),
    ('雷鳴銃'),
    ('雷晶オーブ'),
    ('嵐の兜'),
    ('雷鷲鎧'),
    ('疾風の靴'),
    ('峰岳の守護輪'),
    ('白銀の大剣'),
    ('氷河長槍'),
    ('極雪の弓'),
    ('霜嵐の杖'),
    ('凍蒼の刀'),
    ('霜の宝珠'),
    ('サラマンダーブレード'),
    ('フェニックスワンド'),
    ('煉獄のコデックス'),
    ('溶鉄のクラウン'),
    ('ドレイクアーマー'),
    ('ヴァルカンブーツ'),
    ('業炎の指輪'),
    ('蒼天大剣'),
    ('天翔短剣'),
    ('天穿弓'),
    ('蒼天霊杖'),
    ('天空霊典'),
    ('蒼穹の鎧'),
    ('天翼の護符')
),
-- グループ別のエリア倍率（Museum.jsx MUSEUM_GROUPS.areaMultiplier と一致）
area_mult(gid, m) AS (VALUES
    ('beginner', 1),
    ('area4', 2),
    ('area5', 3),
    ('area6', 4),
    ('area7', 5),
    ('area8', 6)
),
-- ★強化ティア別の素の値（新）: 未強化=0 / +5以上=1 / +9以上=2
tier_new(tier, nrm, rr, boss) AS (VALUES
    (0, 1,  2,  8),
    (1, 4,  6,  26),
    (2, 20, 30, 100)
),
-- 寄贈ボーナスの全体倍率（Museum.jsx MUSEUM_BONUS_MULT と一致）
bonus_mult(m) AS (VALUES (2)),
-- コンプリートボーナスの素の値（Museum.jsx MUSEUM_GROUPS.completeBonus と一致）
cbase(gid, stat, val) AS (VALUES
    ('beginner', 'hp_max', 100),
    ('beginner', 'mp_max', 40),
    ('area4', 'atk', 10),
    ('area4', 'def', 10),
    ('area4', 'matk', 10),
    ('area4', 'mdef', 10),
    ('area5', 'def', 20),
    ('area5', 'mdef', 20),
    ('area5', 'hp_max', 100),
    ('area6', 'def', 30),
    ('area6', 'mdef', 30),
    ('area6', 'mp_max', 50),
    ('area7', 'atk', 30),
    ('area7', 'matk', 30),
    ('area7', 'hp_max', 200),
    ('area8', 'atk', 35),
    ('area8', 'matk', 35),
    ('area8', 'spd', 20)
),
-- ★コンプリートボーナスの強化ティア倍率（新）
cmult(tier, m) AS (VALUES (0, 1), (1, 4), (2, 10)),

-- 寄贈1件ごとの新しいボーナス量。
-- グループは「今の装備リスト」で判定し、リストに無い装備だけ記録時の area_group を使う
-- （装備が別グループへ移動していても、今日の寄贈と同じ値になる）。
d AS (
  SELECT md.player_id,
         md.bonus_stat,
         (CASE
            WHEN coalesce(ig.gid, md.area_group) = 'boss' THEN t.boss
            WHEN r.name IS NOT NULL                       THEN t.rr
            ELSE t.nrm * coalesce(am.m, 1)
          END) * bm.m AS amt
    FROM public.museum_donations md
    JOIN tier_new t ON t.tier = md.enhance_tier
    CROSS JOIN bonus_mult bm
    LEFT JOIN item_group ig ON ig.name = md.weapon_name
    LEFT JOIN rare      r  ON r.name   = md.weapon_name
    LEFT JOIN area_mult am ON am.gid   = coalesce(ig.gid, md.area_group)
),
-- プレイヤーごとの寄贈ボーナス合計（HPは×10・MPは×5で付与／攻撃+特殊攻撃は半々）
dsum AS (
  SELECT player_id,
         sum(CASE WHEN bonus_stat = 'atk'      THEN amt
                  WHEN bonus_stat = 'atk_matk' THEN floor(amt / 2.0) ELSE 0 END) AS atk,
         sum(CASE WHEN bonus_stat = 'def'      THEN amt ELSE 0 END)              AS def,
         sum(CASE WHEN bonus_stat = 'matk'     THEN amt
                  WHEN bonus_stat = 'atk_matk' THEN ceil(amt / 2.0) ELSE 0 END)  AS matk,
         sum(CASE WHEN bonus_stat = 'mdef'     THEN amt ELSE 0 END)              AS mdef,
         sum(CASE WHEN bonus_stat = 'spd'      THEN amt ELSE 0 END)              AS spd,
         sum(CASE WHEN bonus_stat = 'hp_max'   THEN amt * 10 ELSE 0 END)         AS hp,
         sum(CASE WHEN bonus_stat = 'mp_max'   THEN amt * 5  ELSE 0 END)         AS mp
    FROM d GROUP BY player_id
),
-- プレイヤーごとのコンプリートボーナス合計。
-- group_id は '<グループ>__<ティア>'。2026-06-02 14:29〜19:08 に存在した旧形式（'<グループ>'だけ）は
-- 当時の付与が今のティア0（倍率1）と同じなので、ティア0として数える＝既存の取得分を減らさない。
csum AS (
  SELECT mcb.player_id,
         sum(CASE WHEN cb.stat = 'atk'    THEN cb.val * cm.m ELSE 0 END) AS atk,
         sum(CASE WHEN cb.stat = 'def'    THEN cb.val * cm.m ELSE 0 END) AS def,
         sum(CASE WHEN cb.stat = 'matk'   THEN cb.val * cm.m ELSE 0 END) AS matk,
         sum(CASE WHEN cb.stat = 'mdef'   THEN cb.val * cm.m ELSE 0 END) AS mdef,
         sum(CASE WHEN cb.stat = 'spd'    THEN cb.val * cm.m ELSE 0 END) AS spd,
         sum(CASE WHEN cb.stat = 'hp_max' THEN cb.val * cm.m ELSE 0 END) AS hp,
         sum(CASE WHEN cb.stat = 'mp_max' THEN cb.val * cm.m ELSE 0 END) AS mp
    FROM public.museum_complete_bonuses mcb
    JOIN cbase cb ON cb.gid  = split_part(mcb.group_id, '__', 1)
    JOIN cmult cm ON cm.tier = coalesce(nullif(split_part(mcb.group_id, '__', 2), '')::int, 0)
   GROUP BY mcb.player_id
),
tot AS (
  SELECT player_id,
         (coalesce(d.atk,0)  + coalesce(c.atk,0))::int  AS atk,
         (coalesce(d.def,0)  + coalesce(c.def,0))::int  AS def,
         (coalesce(d.matk,0) + coalesce(c.matk,0))::int AS matk,
         (coalesce(d.mdef,0) + coalesce(c.mdef,0))::int AS mdef,
         (coalesce(d.spd,0)  + coalesce(c.spd,0))::int  AS spd,
         (coalesce(d.hp,0)   + coalesce(c.hp,0))::int   AS hp,
         (coalesce(d.mp,0)   + coalesce(c.mp,0))::int   AS mp
    FROM dsum d FULL OUTER JOIN csum c USING (player_id)
)
UPDATE public.profiles p
   SET museum_atk  = t.atk,
       museum_def  = t.def,
       museum_matk = t.matk,
       museum_mdef = t.mdef,
       museum_spd  = t.spd,
       museum_hp   = t.hp,
       museum_mp   = t.mp
  FROM tot t
 WHERE p.id = t.player_id;
