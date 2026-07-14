-- ============================================================
-- 初心者ビンゴミッション（is_admin 開発限定・先行実装）
-- ------------------------------------------------------------
-- 3×3ビンゴ（中央=出撃100回で固定）。
--   マス達成 → マス報酬 / ライン成立 → ライン報酬(横3+縦3+斜め2=最大8) / 全9マス → フルコンプ報酬。
-- 報酬は beginner_bingo_rewards テーブルで管理（あとで UPDATE で具体値を差し替え）。
-- サーバー権威型：達成判定と報酬付与は SECURITY DEFINER RPC 内でのみ行う。
-- ※ is_admin 限定先行。一般公開時は各RPC冒頭の is_admin チェックを外す。
--
-- 単独実行可（他SQLへの依存なし。protect_stats の保護列には触れない）。
-- ============================================================

-- ---------- 1) 進捗列（profiles）----------
--   bingo_sortie_count : 出撃回数（bingo_bump_sortie で加算）
--   bingo_fish_3h      : 3時間以上の釣り放置を1回でも回収した
--   bingo_scarecrow_3h : 3時間以上のかかし修練を1回でも完了した
--   cleared_d10        : 初級の洞窟(d10)を踏破した
--   ※ protect_stats の保護対象外の新規列（クライアント直更新は可能だが、
--     先行の開発限定機能のため不正対策は後回し＝残タスク）。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_sortie_count  integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_fish_3h       boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_scarecrow_3h  boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cleared_d10         boolean NOT NULL DEFAULT false;

-- ---------- 2) 受取状態 ----------
CREATE TABLE IF NOT EXISTS beginner_bingo_state (
  player_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  claimed_cells integer[]   NOT NULL DEFAULT '{}',   -- 受取済みマス index(0-8)
  claimed_lines integer[]   NOT NULL DEFAULT '{}',   -- 受取済みライン index(0-7)
  claimed_full  boolean     NOT NULL DEFAULT false,  -- フルコンプ報酬受取済み
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE beginner_bingo_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_state_sel ON beginner_bingo_state;
CREATE POLICY bingo_state_sel ON beginner_bingo_state
  FOR SELECT USING (player_id = auth.uid());
-- 直接の書き込みポリシーは作らない（更新は SECURITY DEFINER RPC 経由のみ）。

-- ---------- 3) 報酬設定（あとで UPDATE で具体値を入れる）----------
--   kind : 'cell'(idx 0-8) / 'line'(idx 0-7) / 'full'(idx 0)
--   gold : 付与Gold
--   items: [{"name":"強化石（Ｆ）","qty":3}, ...] 形式。items.name で id を引いて付与。
--          強化石・宝石・回数券なども items テーブルの1行なのでこれで表現できる。
--   label: 管理用メモ（任意）
CREATE TABLE IF NOT EXISTS beginner_bingo_rewards (
  kind  text    NOT NULL,
  idx   integer NOT NULL,
  gold  bigint  NOT NULL DEFAULT 0,
  items jsonb   NOT NULL DEFAULT '[]'::jsonb,
  label text,
  PRIMARY KEY (kind, idx)
);
ALTER TABLE beginner_bingo_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_rewards_sel ON beginner_bingo_rewards;
CREATE POLICY bingo_rewards_sel ON beginner_bingo_rewards
  FOR SELECT USING (true);   -- 報酬内容は全員が閲覧可（表示用）

-- 初期行（すべて gold=0 の仮値。あとで下記の例のように UPDATE して具体値を入れる）:
--   UPDATE beginner_bingo_rewards SET gold=1000                       WHERE kind='cell';
--   UPDATE beginner_bingo_rewards SET gold=5000                       WHERE kind='line';
--   UPDATE beginner_bingo_rewards SET gold=50000, items='[{"name":"強化石（Ａ）","qty":1}]'::jsonb WHERE kind='full';
INSERT INTO beginner_bingo_rewards(kind, idx, gold)
  SELECT 'cell', g, 0 FROM generate_series(0,8) g
  ON CONFLICT (kind, idx) DO NOTHING;
INSERT INTO beginner_bingo_rewards(kind, idx, gold)
  SELECT 'line', g, 0 FROM generate_series(0,7) g
  ON CONFLICT (kind, idx) DO NOTHING;
INSERT INTO beginner_bingo_rewards(kind, idx, gold)
  VALUES ('full', 0, 0)
  ON CONFLICT (kind, idx) DO NOTHING;

-- ---------- 4) 進捗更新RPC（クライアントから呼ぶ）----------
-- 出撃1回ごとに +1
CREATE OR REPLACE FUNCTION bingo_bump_sortie()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false) THEN
    RETURN;  -- is_admin 限定先行（非管理者は無視）
  END IF;
  UPDATE profiles
     SET bingo_sortie_count = LEAST(COALESCE(bingo_sortie_count,0) + 1, 1000000)
   WHERE id = auth.uid();
END;
$$;

-- 3時間セッション達成フラグ / d10踏破フラグの立て（キー指定）
CREATE OR REPLACE FUNCTION bingo_mark(p_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false) THEN
    RETURN;
  END IF;
  IF p_key = 'fish_3h' THEN
    UPDATE profiles SET bingo_fish_3h = true WHERE id = auth.uid();
  ELSIF p_key = 'scarecrow_3h' THEN
    UPDATE profiles SET bingo_scarecrow_3h = true WHERE id = auth.uid();
  ELSIF p_key = 'd10' THEN
    UPDATE profiles SET cleared_d10 = true WHERE id = auth.uid();
  END IF;
END;
$$;

-- ---------- 5) セル達成判定 helper ----------
-- 9マスの達成状況を boolean[9] で返す（index はビンゴ盤の row-major）。
--   0:強化10回 1:かかし3h 2:レイド参加1回
--   3:博物館寄贈5個 4:出撃100回(中央) 5:上位職転職
--   6:始まりの森ボス 7:釣り放置3h 8:初級洞窟踏破
CREATE OR REPLACE FUNCTION _bingo_cells(p_uid uuid)
RETURNS boolean[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p             profiles%ROWTYPE;
  v_enhance     integer;
  v_donations   integer;
  v_raid        boolean;
  v_advanced    boolean;
  v_area1boss   boolean;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN ARRAY[false,false,false,false,false,false,false,false,false]; END IF;

  v_enhance   := COALESCE(p.enhance_success_count,0) + COALESCE(p.enhance_fail_count,0);
  v_donations := (SELECT count(*) FROM museum_donations WHERE player_id = p_uid);
  v_raid      := EXISTS (SELECT 1 FROM raid_participants WHERE player_id = p_uid);
  v_advanced  := EXISTS (
                   SELECT 1 FROM class_levels
                    WHERE player_id = p_uid
                      AND class_name NOT IN ('戦士','弓使い','魔法使い','僧侶','格闘家')
                 );
  -- 始まりの森(エリア1)のボスを倒すとエリア2が解放される＝2が unlocked_areas に入る
  v_area1boss := (2 = ANY(COALESCE(p.unlocked_areas, ARRAY[1])));

  RETURN ARRAY[
    v_enhance   >= 10,                        -- 0 強化10回
    COALESCE(p.bingo_scarecrow_3h,false),     -- 1 かかし修練3h
    v_raid,                                   -- 2 レイド参加1回
    v_donations >= 5,                         -- 3 博物館寄贈5個
    COALESCE(p.bingo_sortie_count,0) >= 100,  -- 4 出撃100回(中央)
    v_advanced,                               -- 5 上位職に転職
    v_area1boss,                              -- 6 始まりの森ボス撃破
    COALESCE(p.bingo_fish_3h,false),          -- 7 釣り放置3h
    COALESCE(p.cleared_d10,false)             -- 8 初級洞窟踏破
  ];
END;
$$;

-- ライン定義（横3・縦3・斜め2）: 各ラインを構成するマスindex
--   L0{0,1,2} L1{3,4,5} L2{6,7,8} L3{0,3,6} L4{1,4,7} L5{2,5,8} L6{0,4,8} L7{2,4,6}
CREATE OR REPLACE FUNCTION _bingo_lines(cells boolean[])
RETURNS boolean[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    cells[1] AND cells[2] AND cells[3],   -- L0 横上
    cells[4] AND cells[5] AND cells[6],   -- L1 横中
    cells[7] AND cells[8] AND cells[9],   -- L2 横下
    cells[1] AND cells[4] AND cells[7],   -- L3 縦左
    cells[2] AND cells[5] AND cells[8],   -- L4 縦中
    cells[3] AND cells[6] AND cells[9],   -- L5 縦右
    cells[1] AND cells[5] AND cells[9],   -- L6 斜め＼
    cells[3] AND cells[5] AND cells[7]    -- L7 斜め／
  ];
$$;

-- ---------- 6) 取得RPC ----------
CREATE OR REPLACE FUNCTION get_beginner_bingo()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cells boolean[];
  v_lines boolean[];
  st      beginner_bingo_state%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('dev_only', true);
  END IF;

  v_cells := _bingo_cells(v_uid);
  v_lines := _bingo_lines(v_cells);
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = v_uid;

  RETURN jsonb_build_object(
    'cells',         to_jsonb(v_cells),
    'lines',         to_jsonb(v_lines),
    'claimed_cells', to_jsonb(COALESCE(st.claimed_cells, '{}')),
    'claimed_lines', to_jsonb(COALESCE(st.claimed_lines, '{}')),
    'claimed_full',  COALESCE(st.claimed_full, false),
    'rewards',       (SELECT jsonb_agg(jsonb_build_object(
                        'kind', kind, 'idx', idx, 'gold', gold, 'items', items, 'label', label))
                      FROM beginner_bingo_rewards)
  );
END;
$$;

-- ---------- 7) 報酬付与 helper ----------
CREATE OR REPLACE FUNCTION _bingo_grant(p_uid uuid, p_gold bigint, p_items jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  it       jsonb;
  v_name   text;
  v_qty    integer;
  v_itemid bigint;
BEGIN
  IF COALESCE(p_gold,0) > 0 THEN
    UPDATE profiles SET gold = COALESCE(gold,0) + p_gold WHERE id = p_uid;  -- gold は保護対象外
  END IF;
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_name := it->>'name';
      v_qty  := GREATEST(COALESCE((it->>'qty')::int, 1), 1);
      IF v_name IS NULL THEN CONTINUE; END IF;
      SELECT id INTO v_itemid FROM items WHERE name = v_name LIMIT 1;
      IF v_itemid IS NULL THEN CONTINUE; END IF;   -- 未知アイテム名はスキップ
      INSERT INTO player_items(player_id, item_id, quantity)
        VALUES (p_uid, v_itemid, v_qty)
        ON CONFLICT (player_id, item_id)
        DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;
    END LOOP;
  END IF;
END;
$$;

-- ---------- 8) 受取RPC ----------
--   p_kind: 'cell'|'line'|'full' / p_idx: cell 0-8, line 0-7, full 0
CREATE OR REPLACE FUNCTION claim_beginner_bingo(p_kind text, p_idx integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cells boolean[];
  v_lines boolean[];
  st      beginner_bingo_state%ROWTYPE;
  rw      beginner_bingo_rewards%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dev_only');
  END IF;

  v_cells := _bingo_cells(v_uid);
  v_lines := _bingo_lines(v_cells);

  -- 受取状態行を用意
  INSERT INTO beginner_bingo_state(player_id) VALUES (v_uid)
    ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = v_uid FOR UPDATE;

  -- 達成判定 & 重複受取チェック
  IF p_kind = 'cell' THEN
    IF p_idx < 0 OR p_idx > 8 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_index'); END IF;
    IF NOT v_cells[p_idx + 1] THEN RETURN jsonb_build_object('ok', false, 'error', 'not_completed'); END IF;
    IF p_idx = ANY(st.claimed_cells) THEN RETURN jsonb_build_object('ok', false, 'error', 'already'); END IF;
  ELSIF p_kind = 'line' THEN
    IF p_idx < 0 OR p_idx > 7 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_index'); END IF;
    IF NOT v_lines[p_idx + 1] THEN RETURN jsonb_build_object('ok', false, 'error', 'not_completed'); END IF;
    IF p_idx = ANY(st.claimed_lines) THEN RETURN jsonb_build_object('ok', false, 'error', 'already'); END IF;
  ELSIF p_kind = 'full' THEN
    IF p_idx <> 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_index'); END IF;
    IF NOT (SELECT bool_and(c) FROM unnest(v_cells) c) THEN RETURN jsonb_build_object('ok', false, 'error', 'not_completed'); END IF;
    IF st.claimed_full THEN RETURN jsonb_build_object('ok', false, 'error', 'already'); END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'bad_kind');
  END IF;

  -- 報酬取得＆付与
  SELECT * INTO rw FROM beginner_bingo_rewards WHERE kind = p_kind AND idx = p_idx;
  IF FOUND THEN
    PERFORM _bingo_grant(v_uid, rw.gold, rw.items);
  END IF;

  -- 受取記録
  IF p_kind = 'cell' THEN
    UPDATE beginner_bingo_state SET claimed_cells = array_append(claimed_cells, p_idx), updated_at = now() WHERE player_id = v_uid;
  ELSIF p_kind = 'line' THEN
    UPDATE beginner_bingo_state SET claimed_lines = array_append(claimed_lines, p_idx), updated_at = now() WHERE player_id = v_uid;
  ELSE
    UPDATE beginner_bingo_state SET claimed_full = true, updated_at = now() WHERE player_id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'gold', COALESCE(rw.gold,0), 'items', COALESCE(rw.items,'[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION bingo_bump_sortie()                 TO authenticated;
GRANT EXECUTE ON FUNCTION bingo_mark(text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION get_beginner_bingo()                TO authenticated;
GRANT EXECUTE ON FUNCTION claim_beginner_bingo(text, integer) TO authenticated;
