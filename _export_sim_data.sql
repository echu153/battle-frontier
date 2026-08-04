-- ============================================================
-- エンドレスタワー調整用：シミュレーションに必要なデータの書き出し
-- ------------------------------------------------------------
-- Supabase の SQL Editor で実行し、返ってきた1個のJSONを
--   プロジェクト直下に  _sim_data.json  という名前で保存してください。
--   （結果セルのコピーボタン → メモ帳などに貼り付け → その名前で保存）
--
-- 中身: おれおれおのプロフィール／装備／熟練度／紋章／アクティブペットとチャーム／
--       称号／エンドポイントの振り分け、そして skills テーブル全件。
-- ※読み取りだけです。データは一切書き換えません。
-- ※列を列挙せず行まるごと（to_jsonb）で取るので、列名のズレで欠けることがありません。
-- ============================================================
WITH me AS (SELECT id FROM profiles WHERE username = 'おれおれお' LIMIT 1)
SELECT json_build_object(
  'profile',     (SELECT to_jsonb(p) FROM profiles p WHERE p.id = (SELECT id FROM me)),
  'equipment',   (SELECT COALESCE(json_agg(to_jsonb(e) || jsonb_build_object('weapons', to_jsonb(w))), '[]'::json)
                    FROM player_equipment e JOIN weapons w ON w.id = e.weapon_id
                   WHERE e.player_id = (SELECT id FROM me)),
  'proficiency', (SELECT COALESCE(json_agg(to_jsonb(pr)), '[]'::json)
                    FROM proficiency pr WHERE pr.player_id = (SELECT id FROM me)),
  'emblem',      (SELECT alloc FROM player_emblem WHERE player_id = (SELECT id FROM me)),
  'pet',         (SELECT to_jsonb(pt) FROM pets pt
                   WHERE pt.owner_id = (SELECT id FROM me) AND pt.is_active = true LIMIT 1),
  'charms',      (SELECT COALESCE(json_agg(to_jsonb(c)), '[]'::json) FROM player_charms c
                   WHERE c.id IN (SELECT charm_id  FROM pets WHERE owner_id = (SELECT id FROM me) AND is_active = true
                                  UNION
                                  SELECT ribbon_id FROM pets WHERE owner_id = (SELECT id FROM me) AND is_active = true)),
  'title',       (SELECT to_jsonb(t) FROM titles t
                   WHERE t.id = (SELECT ability_title_id FROM profiles WHERE id = (SELECT id FROM me))),
  'tower_player',(SELECT to_jsonb(tp) FROM tower_player tp WHERE tp.player_id = (SELECT id FROM me)),
  'class_levels',(SELECT COALESCE(json_agg(to_jsonb(cl)), '[]'::json)
                    FROM class_levels cl WHERE cl.player_id = (SELECT id FROM me)),
  -- スキルとクラスの対応はここにしか無い。全件必要。
  'skills',      (SELECT COALESCE(json_agg(to_jsonb(s) ORDER BY s.class_name, s.required_lv), '[]'::json) FROM skills s)
) AS sim_data;
