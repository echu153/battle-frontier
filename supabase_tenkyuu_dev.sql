-- ============================================================
-- 天穹十二宮 開発テスト用: 「えちゅ」アカウントの強化＆ランキング除外
--   ・開発環境(is_admin)付与
--   ・ステータス上昇（再計算で消えないよう stat_point_spent に積む）
--       HP +30000 / MP +10000 / atk,def,matk,mdef,spd +3000
--   ・スキル全取得（全クラスのスキルを習得済みに・どのクラスでも使えるよう持ち越し扱い）
--   ・再修練すべて完了（全クラス 5/5）
--   ・ランキング集計から除外
-- ※ユーザーが手動実行（[[feedback_sql]]）。
-- ※ username が 'えちゅ' でない場合は各 WHERE の 'えちゅ' を実際の username に変更すること。
--
-- 【重要】基礎ステ列(hp_max/atk/...)は /game を開くたびにクラス成長＋stat_point_spent から
--   再計算されて上書きされる(Game.jsx)。そのため直接 hp_max=... を書いても消える。
--   再計算の入力である stat_point_spent に積むと反映が残る。
--   反映タイミング: SQL実行後にえちゅで /game を一度開くと hp_max 等が再計算され確定する。
--   ・hp は ×10、mp は ×5、atk/def/matk/mdef/spd は ×1 で基礎値へ加算される。
--   ・実際の値 = クラス基礎値 + 全クラス成長分 + 上記加算。天穹十二宮では上限(HP25000/各2500)で頭打ち。
-- ============================================================

-- 1) ランキング集計除外フラグ列（無ければ追加）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS exclude_from_ranking boolean DEFAULT false;

-- 2) 開発環境(is_admin) ＋ ステ振り(stat_point_spent) ＋ 再修練完了(全クラス5) ＋ ランキング除外
-- ※ stat_point_spent / retraining は保護トリガー(supabase_protect_stats.sql)対象のため、
--    同一トランザクション内で GUC を立ててから更新する。[[protect-stats-apply-note]]
BEGIN;
SET LOCAL "app.allow_stat_change" = 'on';
UPDATE profiles p SET
  is_admin = true,
  exclude_from_ranking = true,
  stat_point_spent = '{"hp":3000,"mp":2000,"atk":3000,"def":3000,"matk":3000,"mdef":3000,"spd":3000}'::jsonb,
  retraining = COALESCE(
    (SELECT jsonb_object_agg(class_name, 5)
       FROM (SELECT DISTINCT class_name FROM skills WHERE class_name <> '共通') t),
    '{}'::jsonb)
WHERE p.username = 'えちゅ';
COMMIT;

-- 3) スキル全取得（player_skills に全スキルを付与。is_carried_over=true で現在のクラス以外も使用可）
INSERT INTO player_skills (player_id, skill_id, is_carried_over)
SELECT p.id, s.id, true
FROM profiles p CROSS JOIN skills s
WHERE p.username = 'えちゅ'
  AND NOT EXISTS (
    SELECT 1 FROM player_skills ps WHERE ps.player_id = p.id AND ps.skill_id = s.id
  );

-- 既に習得済みのスキルも全て持ち越し（どのクラスでもセット可能）にする
UPDATE player_skills ps SET is_carried_over = true
FROM profiles p
WHERE ps.player_id = p.id AND p.username = 'えちゅ' AND COALESCE(ps.is_carried_over, false) = false;

-- 確認用（/game を一度開いた後に hp_max 等が確定）:
-- SELECT username, is_admin, hp_max, mp_max, atk, def, matk, mdef, spd, exclude_from_ranking, stat_point_spent, retraining
--   FROM profiles WHERE username = 'えちゅ';
-- SELECT count(*) FROM player_skills ps JOIN profiles p ON p.id = ps.player_id WHERE p.username = 'えちゅ';
