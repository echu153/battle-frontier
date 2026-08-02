-- ============================================================
-- スキルの対象設定（複数の敵が同時に出るときに狙う相手）
-- ------------------------------------------------------------
-- ・単位はスキルセットごと（sortie / papia / challenge / hachigoku / raid / pvp）
-- ・初期値は top（上から順番）＝単体戦と挙動が変わらず予測しやすい
-- ・skill_sets と同じく、クライアントから直接読み書きする（RLSで自分の行だけ）
--
-- ⚠ 適用順の鉄則には抵触しない:
--    apply_battle_result / apply_dungeon_reward を一切定義しないので、
--    supabase_mutant_gold_20260703.sql より前後どちらに流してもよい。
--
-- 実行はユーザー側（Supabase SQL Editor）で行う。
-- ============================================================

CREATE TABLE IF NOT EXISTS skill_set_options (
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_type    text NOT NULL,
  target_mode text NOT NULL DEFAULT 'top'
              CHECK (target_mode IN ('top', 'random', 'hp_high', 'hp_low')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, set_type)
);

ALTER TABLE skill_set_options ENABLE ROW LEVEL SECURITY;

-- 自分の設定だけ読み書きできる
DROP POLICY IF EXISTS skill_set_options_select_own ON skill_set_options;
CREATE POLICY skill_set_options_select_own ON skill_set_options
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS skill_set_options_insert_own ON skill_set_options;
CREATE POLICY skill_set_options_insert_own ON skill_set_options
  FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS skill_set_options_update_own ON skill_set_options;
CREATE POLICY skill_set_options_update_own ON skill_set_options
  FOR UPDATE USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS skill_set_options_delete_own ON skill_set_options;
CREATE POLICY skill_set_options_delete_own ON skill_set_options
  FOR DELETE USING (auth.uid() = player_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON skill_set_options TO authenticated;

-- ------------------------------------------------------------
-- 星霜百層塔で設定済みの値を引き継ぐ（塔は「挑戦」セットを使う）
-- tower_player が無い環境ではスキップされる
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.tower_player') IS NOT NULL THEN
    INSERT INTO skill_set_options (player_id, set_type, target_mode)
    SELECT player_id, 'challenge', target_mode
      FROM tower_player
     WHERE target_mode IN ('top', 'random', 'hp_high', 'hp_low')
    ON CONFLICT (player_id, set_type) DO NOTHING;
  END IF;
END $$;

-- 塔側の tower_set_target_mode / tower_player.target_mode は使わなくなる。
-- 消すと既存の get_tower_status が壊れるため、列とRPCはそのまま残しておく。
