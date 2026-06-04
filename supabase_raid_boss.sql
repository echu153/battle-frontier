-- ============================================================
-- レイドボス実装 SQL（完全版）
-- Supabase の SQL Editor で実行してください
-- ============================================================

-- ===== テーブル =====

CREATE TABLE IF NOT EXISTS raid_boss (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spawn_date date NOT NULL,
  boss_name text NOT NULL,
  hp_max int NOT NULL,
  hp_current int NOT NULL,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'defeated' | 'expired'
  spawned_at timestamptz DEFAULT now(),
  defeated_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS raid_boss_spawn_date_idx ON raid_boss(spawn_date);

CREATE TABLE IF NOT EXISTS raid_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id uuid NOT NULL REFERENCES raid_boss(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  damage_dealt bigint NOT NULL DEFAULT 0,
  attack_count int NOT NULL DEFAULT 0,
  last_attack_at timestamptz,
  reward_claimed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS raid_participants_unique_idx ON raid_participants(raid_id, player_id);

-- attack_count カラムが存在しない場合は追加（既存テーブルへの対応）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'raid_participants' AND column_name = 'attack_count'
  ) THEN
    ALTER TABLE raid_participants ADD COLUMN attack_count int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- RLS
ALTER TABLE raid_boss ENABLE ROW LEVEL SECURITY;
ALTER TABLE raid_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "raid_boss_select" ON raid_boss;
DROP POLICY IF EXISTS "raid_participants_select" ON raid_participants;
CREATE POLICY "raid_boss_select" ON raid_boss FOR SELECT USING (true);
CREATE POLICY "raid_participants_select" ON raid_participants FOR SELECT USING (true);

-- ============================================================
-- RPC: スポーン確認・生成
-- ============================================================
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_jst_hour  int;
  v_jst_min   int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
BEGIN
  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_jst_hour := EXTRACT(hour FROM v_jst_now)::int;
  v_jst_min  := EXTRACT(minute FROM v_jst_now)::int;

  -- 21時前: アクティブなボスがあれば返す（当日分が繰り越し中の場合など）
  IF v_jst_hour < 21 THEN
    SELECT * INTO v_boss FROM raid_boss WHERE status = 'active' ORDER BY spawn_date DESC LIMIT 1;
    IF FOUND THEN
      -- 30分タイムアウトチェック
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN
        UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
        v_boss.status := 'expired';
      END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object(
          'status', v_boss.status, 'id', v_boss.id,
          'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
          'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
          'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
        );
      END IF;
    END IF;
    -- 今日の終了済みボス（defeated/expired）があれば返す
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object(
        'status', v_boss.status, 'id', v_boss.id,
        'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
        'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
        'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
      );
    END IF;
    RETURN json_build_object(
      'status', 'waiting',
      'next_spawn', (v_jst_date::text || 'T21:00:00+09:00')
    );
  END IF;

  -- 21時以降: 今日のボスを取得または生成
  SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  IF NOT FOUND THEN
    -- 古いアクティブボスを期限切れに
    UPDATE raid_boss SET status = 'expired' WHERE status = 'active' AND spawn_date < v_jst_date;

    INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at)
    VALUES (v_jst_date, '黒龍ヴァルゼノク', 500000, 500000, 'active', now())
    ON CONFLICT (spawn_date) DO NOTHING;

    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  END IF;

  -- 30分タイムアウトチェック（active のまま放置されている場合）
  IF v_boss.status = 'active' THEN
    v_expire_at := v_boss.spawned_at + interval '30 minutes';
    IF now() > v_expire_at THEN
      UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
      v_boss.status := 'expired';
    END IF;
  END IF;

  RETURN json_build_object(
    'status', v_boss.status, 'id', v_boss.id,
    'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
    'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
    'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
  );
END;
$$;

-- ============================================================
-- RPC: 攻撃（クライアント計算ダメージを受け取る）
-- ============================================================
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_participant raid_participants%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 10;
  v_expire_at   timestamptz;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  -- ボス取得（行ロック）
  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  -- 30分タイムアウトチェック
  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;

  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  -- プレイヤー取得
  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

  -- クールダウン確認（共有CD: last_action_at を使用）
  IF v_profile.last_action_at IS NOT NULL THEN
    IF now() - v_profile.last_action_at < (v_cooldown || ' seconds')::interval THEN
      RETURN json_build_object(
        'error', 'cooldown',
        'seconds_left', v_cooldown - EXTRACT(EPOCH FROM (now() - v_profile.last_action_at))::int
      );
    END IF;
  END IF;

  -- ダメージ上限チェック（不正防止: 合理的な上限を設定）
  v_damage := LEAST(p_damage, 1000000);
  v_damage := GREATEST(v_damage, 0);

  v_new_hp := GREATEST(0, v_boss.hp_current - v_damage);

  -- ボスHP更新
  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  -- 参加者レコードUpsert（attack_count も加算）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_damage, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt   = raid_participants.damage_dealt + v_damage,
      attack_count   = raid_participants.attack_count + 1,
      last_attack_at = now();

  -- 共有CD更新（profiles.last_action_at）
  UPDATE profiles SET last_action_at = now() WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',     v_damage,
    'hp_current', v_new_hp,
    'hp_max',     v_boss.hp_max,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END
  );
END;
$$;

-- ============================================================
-- RPC: リワード受け取り
-- ============================================================
CREATE OR REPLACE FUNCTION claim_raid_rewards(p_raid_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id        uuid;
  v_boss             raid_boss%ROWTYPE;
  v_participant      raid_participants%ROWTYPE;
  v_total_eff        bigint;
  v_my_eff           bigint;
  v_contribution     float;
  v_gold             int;
  v_stone_name       text;
  v_stone_count      int;
  v_stone_item_id    int;  -- items.id は int 型
  v_gem_count        int;
  v_gem_type         text;
  v_gem_rank         text;
  v_gem_types        text[] := ARRAY[
    'peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'
  ];
  v_existing_gem_id  uuid;
  v_i                int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status != 'defeated' THEN RETURN json_build_object('error', 'ボスはまだ討伐されていません'); END IF;

  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', '参加記録がありません'); END IF;
  IF v_participant.reward_claimed THEN RETURN json_build_object('error', '既にリワードを受け取り済みです'); END IF;

  -- 有効スコアで貢献度計算（出撃1回=500ボーナス）
  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff      := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  -- 貢献度ティアでリワード決定
  IF v_contribution >= 0.3 THEN
    v_gold := 40000; v_stone_name := '強化石(B)'; v_stone_count := 1; v_gem_count := 3; v_gem_rank := 'D';
  ELSIF v_contribution >= 0.1 THEN
    v_gold := 25000; v_stone_name := '強化石(C)'; v_stone_count := 1; v_gem_count := 2; v_gem_rank := 'E';
  ELSIF v_contribution >= 0.03 THEN
    v_gold := 15000; v_stone_name := '強化石(D)'; v_stone_count := 1; v_gem_count := 2; v_gem_rank := 'F';
  ELSE
    v_gold := 5000;  v_stone_name := '強化石(F)'; v_stone_count := 1; v_gem_count := 1; v_gem_rank := 'F';
  END IF;

  -- Gold付与
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  -- 強化石付与
  SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
  IF v_stone_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_stone_item_id, v_stone_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE
    SET quantity = player_items.quantity + v_stone_count;
  END IF;

  -- 宝石付与（ティアに応じた個数、毎回ランダム種類）
  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];

    SELECT id INTO v_existing_gem_id FROM player_gems
    WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;

    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity)
      VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- 受け取り済みフラグ
  UPDATE raid_participants SET reward_claimed = true WHERE id = v_participant.id;

  RETURN json_build_object(
    'success',          true,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold,
    'stone',            v_stone_name,
    'stone_count',      v_stone_count,
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank
  );
END;
$$;
