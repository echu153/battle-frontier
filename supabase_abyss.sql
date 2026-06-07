-- ============================================================
-- 奈落闘技場（挑戦コンテンツ）
-- ------------------------------------------------------------
-- ・20階層のNPCと順番に対戦。1階を倒すと2階に挑める（順番制）。
-- ・1週間に1階だけ前進。勝利すると次の「月曜 朝5時(JST)」まで再挑戦不可。
-- ・撃破済みの階は報酬を再取得できない（フロア順をサーバ側で検証）。
-- ・報酬（Gold/強化石/宝石）はこのRPCで付与する。
--
-- 週の境界 = 毎週月曜 朝5時(JST)。
--   v_shifted = (JST現在 - 5時間) として、その週(月曜始まり)の月曜日付を週キーにする。
--   → 月曜5時を境に週キーが変わる。
--
-- 実行はユーザー側（Supabase SQL Editor）で行う。
-- ============================================================

-- 進行状況テーブル
CREATE TABLE IF NOT EXISTS abyss_progress (
  player_id        uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  cleared_floor    int  NOT NULL DEFAULT 0,   -- 撃破済み最高階（0=未挑戦）
  last_clear_week  date,                       -- 直近クリアした「奈落ウィーク」の月曜日付
  total_clears     int  NOT NULL DEFAULT 0,   -- 累計クリア回数（統計用）
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE abyss_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abyss_progress_select_own ON abyss_progress;
CREATE POLICY abyss_progress_select_own ON abyss_progress
  FOR SELECT USING (auth.uid() = player_id);

-- ============================================================
-- 状況取得：到達階・挑戦可否・次の階・次回リセット時刻
-- ============================================================
CREATE OR REPLACE FUNCTION get_abyss_status()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id  uuid;
  v_row        abyss_progress%ROWTYPE;
  v_shifted    timestamp;
  v_week       date;
  v_reset      timestamptz;
  v_can        boolean;
  v_next       int;
  v_is_admin   boolean;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_player_id;

  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id;
  IF NOT FOUND THEN
    v_row.cleared_floor := 0;
    v_row.last_clear_week := NULL;
  END IF;

  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  -- 次回リセット = 翌週の月曜5時(JST) を timestamptz に変換
  v_reset   := ((date_trunc('week', v_shifted) + interval '7 days' + interval '5 hours') AT TIME ZONE 'Asia/Tokyo');

  -- 管理者[開発]は週次ロックを無視して連続で挑戦できる（テスト用）
  v_can  := v_is_admin OR (v_row.last_clear_week IS NULL OR v_row.last_clear_week < v_week);
  v_next := LEAST(v_row.cleared_floor + 1, 20);

  RETURN json_build_object(
    'cleared_floor', v_row.cleared_floor,
    'can_challenge', v_can,
    'next_floor',    v_next,
    'reset_at',      v_reset
  );
END;
$$;

-- ============================================================
-- フロア報酬の受け取り（勝利時にクライアントから呼ぶ）
-- フロア順＋週次ロックをサーバ側で検証してから付与する。
-- ============================================================
CREATE OR REPLACE FUNCTION claim_abyss_floor(p_floor int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id      uuid;
  v_row            abyss_progress%ROWTYPE;
  v_shifted        timestamp;
  v_week           date;
  v_reset          timestamptz;
  v_gold           int;
  v_stone_rank     text;
  v_stone_count    int;
  v_stone_name     text;
  v_stone_item_id  int;
  v_gem_rank       text;
  v_gem_count      int;
  v_gem_type       text;
  v_gem_types      text[] := ARRAY[
    'peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'
  ];
  v_existing_gem_id uuid;
  v_i              int;
  v_is_admin       boolean;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > 20 THEN RETURN json_build_object('error', '不正なフロアです'); END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_player_id;

  -- 行ロック（並行クレーム防止）。なければ作成。
  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO abyss_progress (player_id, cleared_floor) VALUES (v_player_id, 0)
    ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
  END IF;

  -- フロア順検証：次に挑めるのは cleared_floor + 1 のみ
  IF p_floor <> v_row.cleared_floor + 1 THEN
    RETURN json_build_object('error', '挑戦できる階ではありません');
  END IF;

  -- 週次ロック検証
  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  v_reset   := ((date_trunc('week', v_shifted) + interval '7 days' + interval '5 hours') AT TIME ZONE 'Asia/Tokyo');
  -- 管理者[開発]は週次ロックを無視（テスト用）
  IF NOT v_is_admin AND v_row.last_clear_week IS NOT NULL AND v_row.last_clear_week >= v_week THEN
    RETURN json_build_object('error', '今週はすでにクリア済みです', 'reset_at', v_reset);
  END IF;

  -- フロア報酬テーブル（src/lib/abyss.js の FLOOR_REWARD と一致させること）
  CASE p_floor
    WHEN 1  THEN v_gold:=3000;   v_stone_rank:='F'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 2  THEN v_gold:=5000;   v_stone_rank:='F'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 3  THEN v_gold:=8000;   v_stone_rank:='E'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 4  THEN v_gold:=12000;  v_stone_rank:='E'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 5  THEN v_gold:=18000;  v_stone_rank:='D'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 6  THEN v_gold:=26000;  v_stone_rank:='D'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 7  THEN v_gold:=36000;  v_stone_rank:='D'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 8  THEN v_gold:=50000;  v_stone_rank:='C'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 9  THEN v_gold:=66000;  v_stone_rank:='C'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 10 THEN v_gold:=90000;  v_stone_rank:='C'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 11 THEN v_gold:=120000; v_stone_rank:='B'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 12 THEN v_gold:=156000; v_stone_rank:='B'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 13 THEN v_gold:=200000; v_stone_rank:='B'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 14 THEN v_gold:=250000; v_stone_rank:='A'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 15 THEN v_gold:=310000; v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 16 THEN v_gold:=380000; v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 17 THEN v_gold:=460000; v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 18 THEN v_gold:=560000; v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 19 THEN v_gold:=680000; v_stone_rank:='A'; v_stone_count:=4; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 20 THEN v_gold:=840000; v_stone_rank:='A'; v_stone_count:=5; v_gem_rank:='E'; v_gem_count:=3;
  END CASE;

  -- Gold付与
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  -- 強化石付与
  v_stone_name := '強化石(' || v_stone_rank || ')';
  SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
  IF v_stone_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_stone_item_id, v_stone_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE
    SET quantity = player_items.quantity + v_stone_count;
  END IF;

  -- 宝石付与（ランダム種類）
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

  -- 進行更新（撃破階を前進＋今週クリア済みフラグ）
  UPDATE abyss_progress
  SET cleared_floor = p_floor,
      last_clear_week = v_week,
      total_clears = total_clears + 1,
      updated_at = now()
  WHERE player_id = v_player_id;

  RETURN json_build_object(
    'success',     true,
    'floor',       p_floor,
    'gold',        v_gold,
    'stone',       v_stone_rank,
    'stone_count', v_stone_count,
    'gem_rank',    v_gem_rank,
    'gem_count',   v_gem_count,
    'reset_at',    v_reset
  );
END;
$$;

-- ============================================================
-- 進行リセット（管理者[開発]専用・テスト用）
-- 到達階を0に戻し、週次ロックも解除する。
-- ============================================================
CREATE OR REPLACE FUNCTION reset_abyss_progress()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id uuid;
  v_is_admin  boolean;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_player_id;
  IF NOT v_is_admin THEN RETURN json_build_object('error', '権限がありません'); END IF;

  INSERT INTO abyss_progress (player_id, cleared_floor, last_clear_week)
  VALUES (v_player_id, 0, NULL)
  ON CONFLICT (player_id) DO UPDATE
  SET cleared_floor = 0, last_clear_week = NULL, updated_at = now();

  RETURN json_build_object('success', true);
END;
$$;
