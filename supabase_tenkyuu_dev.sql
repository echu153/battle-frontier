-- ============================================================
-- 天穹十二宮 開発テスト用: 「えちゅ」アカウントの強化＆ランキング除外
--   ・ステータス付与 HP30000 / MP10000 / atk,def,matk,mdef,spd=3000(基礎値)
--   ・スキル全取得（全クラスのスキルを習得済みに・どのクラスでも使えるよう持ち越し扱い）
--   ・再修練すべて完了（全クラス 5/5）
--   ・ランキング集計から除外
-- ※ユーザーが手動実行（[[feedback_sql]]）。
-- ※ username が 'えちゅ' でない場合は各 WHERE の 'えちゅ' を実際の username に変更すること。
-- ============================================================

-- 1) ランキング集計除外フラグ列（無ければ追加）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS exclude_from_ranking boolean DEFAULT false;

-- 2) ステータス付与（基礎列） ＋ 再修練すべて完了(全クラス=5) ＋ ランキング除外フラグ
--    ※effective値は装備/宝石/博物館/釣り/称号が上乗せされるので、純粋にこの値にしたい場合は
--      装備等を外すか museum_*/fishing_* 列を0にする。天穹十二宮では上限2500で頭打ちになる。
UPDATE profiles p SET
  hp_max = 30000,
  mp_max = 10000,
  atk = 3000, def = 3000, matk = 3000, mdef = 3000, spd = 3000,
  exclude_from_ranking = true,
  retraining = COALESCE(
    (SELECT jsonb_object_agg(class_name, 5)
       FROM (SELECT DISTINCT class_name FROM skills WHERE class_name <> '共通') t),
    '{}'::jsonb)
WHERE p.username = 'えちゅ';

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

-- 確認用:
-- SELECT username, hp_max, mp_max, atk, def, matk, mdef, spd, exclude_from_ranking, retraining FROM profiles WHERE username = 'えちゅ';
-- SELECT count(*) FROM player_skills ps JOIN profiles p ON p.id = ps.player_id WHERE p.username = 'えちゅ';
