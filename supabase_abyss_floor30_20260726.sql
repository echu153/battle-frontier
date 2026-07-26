-- ============================================================
-- 奈落闘技場：20〜30階の追加（2026-07-26）
-- ------------------------------------------------------------
-- ・全体を 20階 → 30階 に拡張する。
--   20階 = 複数職ボス／21〜25階 = 新クラス5職／26〜30階 = 複数職ボス。
-- ・【公開ゲート】20〜30階は JST 2026/7/27 5:00 から一般公開。それまでは is_admin のみ
--   挑戦可（開発先行）。claim_abyss_floor / get_abyss_status の両方が同じ時刻＋is_admin
--   判定を持つ（サーバが本番の権威）。→ このSQLは今すぐ適用してよい（時刻まで自動で開発限定）。
-- ・claim_abyss_floor / get_abyss_status の上限「20」を「30」へ引き上げ。
-- ・報酬テーブル(20〜30)・匠の秘伝書(階層別)を更新。
--
-- 【ベース】claim_abyss_floor の最新の正 =
--   supabase_event_20260720_scarecrow_abyss.sql 版
--   （イベント2倍 v_mul ＋ 秘伝書付与 ＋ 並行クレーム防止 FOR UPDATE）。
--   本ファイルはその全文を土台に「30階まで」拡張したもの。
--   → 以降は claim_abyss_floor の「最新の正」が本ファイルになる。
--   ※ bf_event_20260720_active() はイベントSQLで作成済みの前提（依存）。
--      イベント終了後は false を返すため v_mul=1 で通常挙動になる。
--
-- 【報酬(20〜30)】※ src/lib/abyss.js の FLOOR_REWARD と一致させること
--   20: 840,000 / A×4 / 宝石E×3 / 秘伝書Ⅳ / 強者の結晶×1
--   21: 1,000,000 / S×1 / 宝石D×2 / 秘伝書Ⅲ
--   22: 1,000,000 / S×1 / 宝石D×2 / 秘伝書Ⅲ
--   23: 1,000,000 / S×2 / 宝石D×2 / 秘伝書Ⅲ
--   24: 1,000,000 / S×2 / 宝石D×3 / 秘伝書Ⅲ
--   25: 1,000,000 / S×3 / 宝石D×3 / 秘伝書Ⅲ / 強者の結晶×1
--   26: 1,200,000 / S×3 / 宝石D×3 / 秘伝書Ⅳ
--   27: 1,200,000 / S×3 / 宝石C×1 / 秘伝書Ⅳ
--   28: 1,200,000 / S×4 / 宝石C×1 / 秘伝書Ⅳ
--   29: 1,200,000 / S×4 / 宝石C×1 / 秘伝書Ⅳ
--   30: 1,500,000 / S×4 / 宝石C×2 / 秘伝書Ⅳ / 強者の結晶×1
--
-- 実行はユーザー側（Supabase SQL Editor）で行う。
-- ============================================================

-- ============================================================
-- 状況取得：上限を 30 へ
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
  v_eff        int;
  v_next       int;
  v_is_admin   boolean;
  v_max        int;   -- 挑戦可能な最深階（20〜30階は公開前 is_admin 以外 19 で頭打ち）
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id;
  IF NOT FOUND THEN
    v_row.cleared_floor := 0;
    v_row.last_clear_week := NULL;
  END IF;

  -- 20〜30階は 2026/7/27 5:00(JST) から一般公開。それまでは is_admin のみ 20階以降に進める。
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_player_id;
  v_max := CASE WHEN v_is_admin OR now() >= '2026-07-27 05:00:00+09'::timestamptz THEN 30 ELSE 19 END;

  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  v_reset   := ((date_trunc('week', v_shifted) + interval '7 days' + interval '5 hours') AT TIME ZONE 'Asia/Tokyo');

  IF v_row.last_clear_week IS NOT NULL AND v_row.last_clear_week >= v_week THEN
    v_eff := v_row.cleared_floor;
  ELSE
    v_eff := 0;
  END IF;

  v_next := LEAST(v_eff + 1, v_max);

  RETURN json_build_object(
    'cleared_floor', v_eff,
    'can_challenge', (v_eff < v_max),   -- 公開分を制覇までは週内いつでも挑戦可
    'next_floor',    v_next,
    'reset_at',      v_reset
  );
END;
$$;

-- ============================================================
-- フロア報酬の受け取り（30階対応）
-- ============================================================
DROP FUNCTION IF EXISTS claim_abyss_floor(int);
CREATE OR REPLACE FUNCTION claim_abyss_floor(p_floor int, p_turns int DEFAULT 0)
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
  v_eff            int;
  v_book_name      text;
  v_book_item_id   int;
  v_crystal_count  int := 0;   -- 強者の結晶（節目報酬: 20/25/30階）
  v_crystal_item_id int;
  v_is_admin       boolean;
  -- ★イベント(2026/7/20〜8/3): 報酬2倍（終了後は 1）
  v_mul            int := CASE WHEN bf_event_20260720_active() THEN 2 ELSE 1 END;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;
  IF p_floor < 1 OR p_floor > 30 THEN RETURN json_build_object('error', '不正なフロアです'); END IF;

  -- 20〜30階は 2026/7/27 5:00(JST) から一般公開。それまでは is_admin のみ挑戦可（開発先行）。
  IF p_floor >= 20 THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_player_id;
    IF NOT v_is_admin AND now() < '2026-07-27 05:00:00+09'::timestamptz THEN
      RETURN json_build_object('error', '地下20階以降は 2026/7/27 5:00 に公開予定です');
    END IF;
  END IF;

  -- 奈落ウィーク（毎週月曜 朝5時JSTが境界）
  v_shifted := (now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours';
  v_week    := date_trunc('week', v_shifted)::date;
  v_reset   := ((v_week + interval '7 days')::timestamp + interval '5 hours') AT TIME ZONE 'Asia/Tokyo';

  -- 行ロック（並行クレーム防止）。なければ作成。
  SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO abyss_progress (player_id, cleared_floor) VALUES (v_player_id, 0)
    ON CONFLICT (player_id) DO NOTHING;
    SELECT * INTO v_row FROM abyss_progress WHERE player_id = v_player_id FOR UPDATE;
  END IF;

  -- 今週分の有効到達階（前週以前の進捗は0＝週次リセット）
  IF v_row.last_clear_week IS NOT NULL AND v_row.last_clear_week >= v_week THEN
    v_eff := v_row.cleared_floor;
  ELSE
    v_eff := 0;
  END IF;

  -- フロア順検証：次に挑めるのは「今週の到達階 + 1」のみ
  IF p_floor <> v_eff + 1 THEN
    RETURN json_build_object('error', '挑戦できる階ではありません');
  END IF;

  -- フロア報酬テーブル（src/lib/abyss.js の FLOOR_REWARD と一致させること）
  CASE p_floor
    WHEN 1  THEN v_gold:=3000;    v_stone_rank:='F'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 2  THEN v_gold:=5000;    v_stone_rank:='F'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 3  THEN v_gold:=8000;    v_stone_rank:='E'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=1;
    WHEN 4  THEN v_gold:=12000;   v_stone_rank:='E'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 5  THEN v_gold:=18000;   v_stone_rank:='D'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 6  THEN v_gold:=26000;   v_stone_rank:='D'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=2;
    WHEN 7  THEN v_gold:=36000;   v_stone_rank:='D'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 8  THEN v_gold:=50000;   v_stone_rank:='C'; v_stone_count:=1; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 9  THEN v_gold:=66000;   v_stone_rank:='C'; v_stone_count:=2; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 10 THEN v_gold:=90000;   v_stone_rank:='C'; v_stone_count:=3; v_gem_rank:='F'; v_gem_count:=3;
    WHEN 11 THEN v_gold:=120000;  v_stone_rank:='B'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 12 THEN v_gold:=156000;  v_stone_rank:='B'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 13 THEN v_gold:=200000;  v_stone_rank:='B'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=1;
    WHEN 14 THEN v_gold:=250000;  v_stone_rank:='A'; v_stone_count:=1; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 15 THEN v_gold:=310000;  v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 16 THEN v_gold:=380000;  v_stone_rank:='A'; v_stone_count:=2; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 17 THEN v_gold:=460000;  v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=2;
    WHEN 18 THEN v_gold:=560000;  v_stone_rank:='A'; v_stone_count:=3; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 19 THEN v_gold:=680000;  v_stone_rank:='A'; v_stone_count:=4; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 20 THEN v_gold:=840000;  v_stone_rank:='A'; v_stone_count:=4; v_gem_rank:='E'; v_gem_count:=3;
    WHEN 21 THEN v_gold:=1000000; v_stone_rank:='S'; v_stone_count:=1; v_gem_rank:='D'; v_gem_count:=2;
    WHEN 22 THEN v_gold:=1000000; v_stone_rank:='S'; v_stone_count:=1; v_gem_rank:='D'; v_gem_count:=2;
    WHEN 23 THEN v_gold:=1000000; v_stone_rank:='S'; v_stone_count:=2; v_gem_rank:='D'; v_gem_count:=2;
    WHEN 24 THEN v_gold:=1000000; v_stone_rank:='S'; v_stone_count:=2; v_gem_rank:='D'; v_gem_count:=3;
    WHEN 25 THEN v_gold:=1000000; v_stone_rank:='S'; v_stone_count:=3; v_gem_rank:='D'; v_gem_count:=3;
    WHEN 26 THEN v_gold:=1200000; v_stone_rank:='S'; v_stone_count:=3; v_gem_rank:='D'; v_gem_count:=3;
    WHEN 27 THEN v_gold:=1200000; v_stone_rank:='S'; v_stone_count:=3; v_gem_rank:='C'; v_gem_count:=1;
    WHEN 28 THEN v_gold:=1200000; v_stone_rank:='S'; v_stone_count:=4; v_gem_rank:='C'; v_gem_count:=1;
    WHEN 29 THEN v_gold:=1200000; v_stone_rank:='S'; v_stone_count:=4; v_gem_rank:='C'; v_gem_count:=1;
    WHEN 30 THEN v_gold:=1500000; v_stone_rank:='S'; v_stone_count:=4; v_gem_rank:='C'; v_gem_count:=2;
  END CASE;

  -- ★イベント倍率適用（Gold/強化石/宝石。秘伝書は下で v_mul 冊付与）
  v_gold        := v_gold * v_mul;
  v_stone_count := v_stone_count * v_mul;
  v_gem_count   := v_gem_count * v_mul;

  -- ★匠の秘伝書（3〜7=Ⅰ / 8〜13=Ⅱ / 14〜19=Ⅲ / 20=Ⅳ / 21〜25=Ⅲ / 26〜30=Ⅳ・1〜2階は無し）
  v_book_name := CASE
    WHEN p_floor BETWEEN 3 AND 7   THEN '匠の秘伝書Ⅰ'
    WHEN p_floor BETWEEN 8 AND 13  THEN '匠の秘伝書Ⅱ'
    WHEN p_floor BETWEEN 14 AND 19 THEN '匠の秘伝書Ⅲ'
    WHEN p_floor = 20              THEN '匠の秘伝書Ⅳ'
    WHEN p_floor BETWEEN 21 AND 25 THEN '匠の秘伝書Ⅲ'
    WHEN p_floor >= 26             THEN '匠の秘伝書Ⅳ'
    ELSE NULL END;

  -- 強者の結晶（節目報酬）: 20/25/30階で各1個。イベント倍率は掛けない（固定ボーナス）。
  v_crystal_count := CASE p_floor WHEN 20 THEN 1 WHEN 25 THEN 1 WHEN 30 THEN 1 ELSE 0 END;

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

  -- ★匠の秘伝書付与（階層別・イベント中は2冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, v_mul, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_mul;
    END IF;
  END IF;

  -- 強者の結晶付与（20/25/30階のみ・固定個数）
  IF v_crystal_count > 0 THEN
    SELECT id INTO v_crystal_item_id FROM items WHERE name = '強者の結晶' LIMIT 1;
    IF v_crystal_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_crystal_item_id, v_crystal_count, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_crystal_count;
    END IF;
  END IF;

  -- 進行更新（撃破階を前進＋今週クリア済みフラグ）
  UPDATE abyss_progress
  SET cleared_floor = p_floor,
      last_clear_week = v_week,
      last_clear_turns = GREATEST(p_turns, 1),
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
    'book',        v_book_name,
    'book_count',  CASE WHEN v_book_name IS NULL THEN 0 ELSE v_mul END,
    'crystal_count', v_crystal_count,
    'event_x2',    (v_mul > 1),
    'reset_at',    v_reset
  );
END;
$$;
GRANT EXECUTE ON FUNCTION claim_abyss_floor(int, int) TO authenticated;
