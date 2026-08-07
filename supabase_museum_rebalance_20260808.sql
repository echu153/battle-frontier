-- ============================================================
-- 博物館：寄贈ボーナスの強化ティア倍率引き上げ＋既存プレイヤーへの遡及反映  2026-08-08
-- ------------------------------------------------------------
-- 【変更内容】src/pages/Museum.jsx と同じ値
--   寄贈ボーナス（素の値・未強化/+5以上/+9以上）… +5を2倍・+9を5倍へ
--     通常装備 [1,2,4] → [1,4,20]（さらに×エリア倍率×2）
--     レアドロップ [2,3,6] → [2,6,30]（×2）
--     ボスドロップ [8,13,20] → [8,26,100]（×2）
--   コンプリートボーナス倍率 [1,3,5] → [1,4,10]
--
-- 【このSQLがやること】
--   museum_donations / museum_complete_bonuses の記録から、全プレイヤーの
--   profiles.museum_atk/def/matk/mdef/spd/hp/mp を「新しい倍率で丸ごと再計算」して上書きする。
--   → 既に寄贈済みの人も新倍率が反映される。何度流しても同じ結果（冪等）。
--
-- 【注意】
--   ・museum_* 列に書き込むのは博物館（Museum.jsx）だけ＝この全再計算で消える他の加算はない。
--   ・protect_stats の保護列（lv/exp/stat_point_spent等）は触らないので app.allow_stat_change 不要。
--   ・SQLエディタは1文ずつ自動コミットのため、意図的に「1つのUPDATE文」だけで完結させている。
--   ・寄贈記録がまったく無いプレイヤーは対象外（既存値をそのまま残す）。
-- ============================================================

WITH
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
-- 強化ティア別の素の値（新）: 未強化=0 / +5以上=1 / +9以上=2
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
-- コンプリートボーナスの強化ティア倍率（新）
cmult(tier, m) AS (VALUES (0, 1), (1, 4), (2, 10)),

-- 1件ごとの新しい寄贈ボーナス量
d AS (
  SELECT md.player_id,
         md.bonus_stat,
         (CASE
            WHEN md.area_group = 'boss' THEN t.boss
            WHEN r.name IS NOT NULL     THEN t.rr
            ELSE t.nrm * coalesce(am.m, 1)
          END) * bm.m AS amt
    FROM public.museum_donations md
    JOIN tier_new   t  ON t.tier = md.enhance_tier
    CROSS JOIN bonus_mult bm
    LEFT JOIN rare      r  ON r.name = md.weapon_name
    LEFT JOIN area_mult am ON am.gid = md.area_group
),
-- プレイヤーごとの寄贈ボーナス合計（HPは×10・MPは×5で付与／attack+特攻は半々）
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
-- プレイヤーごとのコンプリートボーナス合計（group_id は '<グループ>__<ティア>'）
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
    JOIN cmult cm ON cm.tier = nullif(split_part(mcb.group_id, '__', 2), '')::int
   GROUP BY mcb.player_id
),
tot AS (
  SELECT player_id,
         coalesce(d.atk,0)  + coalesce(c.atk,0)  AS atk,
         coalesce(d.def,0)  + coalesce(c.def,0)  AS def,
         coalesce(d.matk,0) + coalesce(c.matk,0) AS matk,
         coalesce(d.mdef,0) + coalesce(c.mdef,0) AS mdef,
         coalesce(d.spd,0)  + coalesce(c.spd,0)  AS spd,
         coalesce(d.hp,0)   + coalesce(c.hp,0)   AS hp,
         coalesce(d.mp,0)   + coalesce(c.mp,0)   AS mp
    FROM dsum d FULL OUTER JOIN csum c USING (player_id)
)
UPDATE public.profiles p
   SET museum_atk  = t.atk::int,
       museum_def  = t.def::int,
       museum_matk = t.matk::int,
       museum_mdef = t.mdef::int,
       museum_spd  = t.spd::int,
       museum_hp   = t.hp::int,
       museum_mp   = t.mp::int
  FROM tot t
 WHERE p.id = t.player_id;
