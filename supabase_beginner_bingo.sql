-- ============================================================
-- 初心者ビンゴミッション①（is_admin 開発限定・先行実装）
-- ------------------------------------------------------------
-- 3×3ビンゴ。中央=ログイン1日目。マス達成→マス報酬 / ライン成立→ライン報酬(横3+縦3+斜め2=8)。
--   ※フルコンプ報酬は無し（8ラインのクリア報酬がコンプ相当）。
-- 報酬は beginner_bingo_rewards テーブルで管理。付与内容は event 方式の rewards jsonb
--   （[{"type":"gold","qty":N}] / [{"type":"item","name":"強化石(B)","qty":3}] /
--    [{"type":"weapon","name":"溶岩の指輪"}] ）＝ claim_event_reward と同じ付与ロジック。
-- サーバー権威型：達成判定・付与は SECURITY DEFINER RPC 内でのみ行う。is_admin 限定先行。
--
-- 単独実行可（protect_stats の保護列には触れない。gold付与時のみ GUC を許可）。
-- ※ 旧版(v1)からの作り直し：報酬テーブルは構造が変わったため DROP して再作成。
--   受取状態は dev検証のためリセット（マス定義が変わったので旧受取記録は無効）。
-- ============================================================

-- ---------- 1) 進捗列（profiles）----------
--   bingo_sortie_count : 出撃回数（bingo_bump_sortie で加算）。出撃10/30/50/100の判定に使用。
--   ※ 強化回数は既存の enhance_success_count/enhance_fail_count を使用（新カウンタ不要）。
--   ※ ログイン1日目は常に達成扱い（プレイ中＝ログイン済み）。
--   ※ 始まりの森ボスは boss_kill_count の開始後増分≥1（=ボス撃破。序盤の初ボス＝始まりの森）で判定。
--   ★ 強化/出撃/ボス撃破は「ビンゴ開始時点からの増分」で判定（過去分は計上しない。§2/§6参照）。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_sortie_count integer NOT NULL DEFAULT 0;

-- ---------- 2) 受取状態 ----------
--   ★ base_* : ビンゴ開始時点（初回 get/claim）の各カウンター値を記録。
--     以降の達成判定は「現在値 − base_*」＝ビンゴ開始後の増分のみで行う（過去分は計上しない）。
CREATE TABLE IF NOT EXISTS beginner_bingo_state (
  player_id      uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  claimed_cells  integer[]   NOT NULL DEFAULT '{}',   -- 受取済みマス index(0-8)
  claimed_lines  integer[]   NOT NULL DEFAULT '{}',   -- 受取済みライン本数(1-8)
  claimed_full   boolean     NOT NULL DEFAULT false,  -- 未使用（フルコンプ廃止・後方互換で残置）
  base_sortie    integer     NOT NULL DEFAULT 0,      -- 開始時の bingo_sortie_count
  base_enhance   integer     NOT NULL DEFAULT 0,      -- 開始時の 強化回数(success+fail)
  base_boss_kill integer     NOT NULL DEFAULT 0,      -- 開始時の boss_kill_count
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- 既存テーブルにも基準値カラムを追加（旧版から作り直し時の互換）
ALTER TABLE beginner_bingo_state ADD COLUMN IF NOT EXISTS base_sortie    integer NOT NULL DEFAULT 0;
ALTER TABLE beginner_bingo_state ADD COLUMN IF NOT EXISTS base_enhance   integer NOT NULL DEFAULT 0;
ALTER TABLE beginner_bingo_state ADD COLUMN IF NOT EXISTS base_boss_kill integer NOT NULL DEFAULT 0;
ALTER TABLE beginner_bingo_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_state_sel ON beginner_bingo_state;
CREATE POLICY bingo_state_sel ON beginner_bingo_state
  FOR SELECT USING (player_id = auth.uid());
-- 直接の書き込みポリシーは作らない（更新は SECURITY DEFINER RPC 経由のみ）。
-- マス定義が変わったため旧受取記録をリセット（dev限定・is_admin のみ影響）。
TRUNCATE beginner_bingo_state;

-- ---------- 3) 報酬設定（event 方式の rewards jsonb）----------
--   kind : 'cell'(idx 0-8=マス) / 'line'(idx 1-8=達成ライン本数)
--   rewards : [{"type":"gold","qty":N} | {"type":"item","name":..,"qty":N} | {"type":"weapon","name":..}]
--   label   : 表示用テキスト
DROP TABLE IF EXISTS beginner_bingo_rewards;
CREATE TABLE beginner_bingo_rewards (
  kind    text    NOT NULL,
  idx     integer NOT NULL,
  rewards jsonb   NOT NULL DEFAULT '[]'::jsonb,
  label   text,
  PRIMARY KEY (kind, idx)
);
ALTER TABLE beginner_bingo_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_rewards_sel ON beginner_bingo_rewards;
CREATE POLICY bingo_rewards_sel ON beginner_bingo_rewards
  FOR SELECT USING (true);   -- 報酬内容は全員が閲覧可（表示用）

-- マス報酬（盤: row-major・中央 idx4=ログイン1日目）
--   0:出撃10 1:出撃30 2:出撃50
--   3:出撃100 4:ログイン1日目 5:強化1
--   6:強化5 7:強化10 8:始まりの森ボス
INSERT INTO beginner_bingo_rewards(kind, idx, rewards, label) VALUES
  ('cell', 0, '[{"type":"weapon","name":"溶岩の指輪"},{"type":"weapon","name":"峰岳の守護輪"}]'::jsonb, '溶岩の指輪＋峰岳の守護輪'),
  ('cell', 1, '[{"type":"item","name":"強化石(B)","qty":1}]'::jsonb,                                   '強化石(B)×1'),
  ('cell', 2, '[{"type":"item","name":"強化石(B)","qty":2}]'::jsonb,                                   '強化石(B)×2'),
  ('cell', 3, '[{"type":"item","name":"強化石(B)","qty":3}]'::jsonb,                                   '強化石(B)×3'),
  ('cell', 4, '[{"type":"weapon","name":"蒼海の大剣"},{"type":"weapon","name":"炎のワンド"}]'::jsonb,    '蒼海の大剣＋炎のワンド'),
  ('cell', 5, '[{"type":"weapon","name":"疾風の靴"},{"type":"weapon","name":"溶岩鎧"}]'::jsonb,          '疾風の靴＋溶岩鎧'),
  ('cell', 6, '[{"type":"item","name":"強化石(B)","qty":2},{"type":"gold","qty":10000}]'::jsonb,        '強化石(B)×2＋10000G'),
  ('cell', 7, '[{"type":"item","name":"強化石(B)","qty":3}]'::jsonb,                                   '強化石(B)×3'),
  ('cell', 8, '[{"type":"item","name":"強化石(B)","qty":5}]'::jsonb,                                   '強化石(B)×5');

-- ライン報酬（★達成した「ライン本数」で解放。idx = 必要ライン数 1〜8。どのラインかは不問）
INSERT INTO beginner_bingo_rewards(kind, idx, rewards, label) VALUES
  ('line', 1, '[{"type":"gold","qty":2000}]'::jsonb,                                                   '2000G'),
  ('line', 2, '[{"type":"gold","qty":3000}]'::jsonb,                                                   '3000G'),
  ('line', 3, '[{"type":"gold","qty":4000}]'::jsonb,                                                   '4000G'),
  ('line', 4, '[{"type":"gold","qty":5000}]'::jsonb,                                                   '5000G'),
  ('line', 5, '[{"type":"weapon","name":"溶岩の指輪"},{"type":"weapon","name":"峰岳の守護輪"}]'::jsonb, '溶岩の指輪＋峰岳の守護輪'),
  ('line', 6, '[{"type":"gold","qty":10000}]'::jsonb,                                                  '10000G'),
  ('line', 7, '[{"type":"gold","qty":20000}]'::jsonb,                                                  '20000G'),
  ('line', 8, '[{"type":"item","name":"初級ボス装備選択箱","qty":1}]'::jsonb,                          '初級ボス装備選択箱');

-- ---------- 4) 選択箱アイテム ----------
INSERT INTO items (name, description, effect, value)
SELECT '初級ボス装備選択箱', 'エリア①〜②のボス装備1つと交換できる選択箱。初心者ビンゴ報酬。', 'material', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '初級ボス装備選択箱');

-- ---------- 5) 出撃カウント加算RPC（クライアントから呼ぶ）----------
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

-- ---------- 6) セル達成判定 helper ----------
-- 9マスの達成状況を boolean[9] で返す（index はビンゴ盤の row-major）。
-- ★ ビンゴ開始時点の基準値（base_*）を記録し、以降の「増分」だけで判定する（過去分は計上しない）。
--   初回呼び出し時に beginner_bingo_state を現在のカウンター値で作成＝その瞬間が起点。
CREATE OR REPLACE FUNCTION _bingo_cells(p_uid uuid)
RETURNS boolean[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p          profiles%ROWTYPE;
  st         beginner_bingo_state%ROWTYPE;
  v_sortie   integer;
  v_enhance  integer;
  v_bosskill integer;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN ARRAY[false,false,false,false,false,false,false,false,false]; END IF;

  -- 基準値の記録（初回のみ）。現在のカウンター値をそのまま基準にする＝この時点からの増分で判定。
  INSERT INTO beginner_bingo_state(player_id, base_sortie, base_enhance, base_boss_kill)
  VALUES (
    p_uid,
    COALESCE(p.bingo_sortie_count,0),
    COALESCE(p.enhance_success_count,0) + COALESCE(p.enhance_fail_count,0),
    COALESCE(p.boss_kill_count,0)
  )
  ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = p_uid;

  -- 開始後の増分（過去分は base_* で相殺）
  v_sortie   := COALESCE(p.bingo_sortie_count,0) - COALESCE(st.base_sortie,0);
  v_enhance  := (COALESCE(p.enhance_success_count,0) + COALESCE(p.enhance_fail_count,0)) - COALESCE(st.base_enhance,0);
  v_bosskill := COALESCE(p.boss_kill_count,0) - COALESCE(st.base_boss_kill,0);

  RETURN ARRAY[
    v_sortie   >= 10,    -- 0 出撃10回（開始後）
    v_sortie   >= 30,    -- 1 出撃30回
    v_sortie   >= 50,    -- 2 出撃50回
    v_sortie   >= 100,   -- 3 出撃100回
    true,                -- 4 ログイン1日目（常に達成）
    v_enhance  >= 1,     -- 5 強化1回（開始後）
    v_enhance  >= 5,     -- 6 強化5回
    v_enhance  >= 10,    -- 7 強化10回
    v_bosskill >= 1      -- 8 始まりの森ボス撃破（開始後にボス撃破1回。序盤の初ボス＝始まりの森）
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

-- ---------- 7) 取得RPC ----------
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
    'rewards',       (SELECT jsonb_agg(jsonb_build_object(
                        'kind', kind, 'idx', idx, 'rewards', rewards, 'label', label))
                      FROM beginner_bingo_rewards)
  );
END;
$$;

-- ---------- 8) 報酬付与 helper（event 方式の rewards jsonb を付与）----------
CREATE OR REPLACE FUNCTION _bingo_grant(p_uid uuid, p_rewards jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry  jsonb;
  v_type   text;
  v_name   text;
  v_qty    integer;
  v_itemid bigint;
  v_weapon weapons%ROWTYPE;
  v_i      integer;
BEGIN
  IF p_rewards IS NULL OR jsonb_typeof(p_rewards) <> 'array' THEN RETURN; END IF;
  PERFORM set_config('app.allow_stat_change','on',true);  -- gold付与の保護トリガー許可

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_rewards) LOOP
    v_type := v_entry->>'type';
    v_name := v_entry->>'name';
    v_qty  := GREATEST(COALESCE((v_entry->>'qty')::int, 1), 1);

    IF v_type = 'gold' THEN
      UPDATE profiles SET gold = COALESCE(gold,0) + v_qty WHERE id = p_uid;

    ELSIF v_type = 'item' THEN
      SELECT id INTO v_itemid FROM items WHERE name = v_name LIMIT 1;
      IF v_itemid IS NULL THEN RAISE EXCEPTION '報酬アイテムが見つかりません: %', v_name; END IF;
      INSERT INTO player_items(player_id, item_id, quantity, equipped)
        VALUES (p_uid, v_itemid, v_qty, false)
        ON CONFLICT (player_id, item_id)
        DO UPDATE SET quantity = player_items.quantity + v_qty;

    ELSIF v_type = 'weapon' THEN
      SELECT * INTO v_weapon FROM weapons WHERE name = v_name LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION '報酬装備が見つかりません: %', v_name; END IF;
      FOR v_i IN 1..v_qty LOOP
        INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
        VALUES (p_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
      END LOOP;

    ELSE
      RAISE EXCEPTION '不明な報酬タイプです: %', v_type;
    END IF;
  END LOOP;
END;
$$;

-- ---------- 9) 受取RPC ----------
--   p_kind: 'cell'|'line' / p_idx: cell 0-8(マス) / line 1-8(達成ライン本数)
CREATE OR REPLACE FUNCTION claim_beginner_bingo(p_kind text, p_idx integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cells boolean[];
  v_lines boolean[];
  v_lcnt  integer;
  st      beginner_bingo_state%ROWTYPE;
  rw      beginner_bingo_rewards%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dev_only');
  END IF;

  v_cells := _bingo_cells(v_uid);
  v_lines := _bingo_lines(v_cells);

  INSERT INTO beginner_bingo_state(player_id) VALUES (v_uid)
    ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = v_uid FOR UPDATE;

  IF p_kind = 'cell' THEN
    IF p_idx < 0 OR p_idx > 8 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_index'); END IF;
    IF NOT v_cells[p_idx + 1] THEN RETURN jsonb_build_object('ok', false, 'error', 'not_completed'); END IF;
    IF p_idx = ANY(st.claimed_cells) THEN RETURN jsonb_build_object('ok', false, 'error', 'already'); END IF;
  ELSIF p_kind = 'line' THEN
    -- ★ p_idx = 必要ライン本数(1〜8)。達成ライン本数が p_idx 以上で解放（どのラインかは不問）
    IF p_idx < 1 OR p_idx > 8 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_index'); END IF;
    v_lcnt := (SELECT count(*) FROM unnest(v_lines) x WHERE x);
    IF v_lcnt < p_idx THEN RETURN jsonb_build_object('ok', false, 'error', 'not_completed'); END IF;
    IF p_idx = ANY(st.claimed_lines) THEN RETURN jsonb_build_object('ok', false, 'error', 'already'); END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'bad_kind');
  END IF;

  SELECT * INTO rw FROM beginner_bingo_rewards WHERE kind = p_kind AND idx = p_idx;
  IF FOUND THEN
    PERFORM _bingo_grant(v_uid, rw.rewards);
  END IF;

  IF p_kind = 'cell' THEN
    UPDATE beginner_bingo_state SET claimed_cells = array_append(claimed_cells, p_idx), updated_at = now() WHERE player_id = v_uid;
  ELSE
    UPDATE beginner_bingo_state SET claimed_lines = array_append(claimed_lines, p_idx), updated_at = now() WHERE player_id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rewards', COALESCE(rw.rewards,'[]'::jsonb), 'label', rw.label);
END;
$$;

-- ---------- 10) 初級ボス装備選択箱の交換RPC ----------
--   箱1個を消費し、エリア①〜②のボス装備1つを付与。
CREATE OR REPLACE FUNCTION redeem_beginner_boss_box(p_weapon_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_box_id  bigint;
  v_held    integer;
  v_weapon  weapons%ROWTYPE;
  v_allowed text[] := ARRAY['スライムの指輪','蒼粘剣','略奪者の短剣','影踏みのブーツ'];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', '未認証'); END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'error', '選択できない装備です');
  END IF;

  SELECT id INTO v_box_id FROM items WHERE name = '初級ボス装備選択箱' LIMIT 1;
  IF v_box_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', '選択箱アイテムが存在しません'); END IF;

  -- 同時交換の複製防止：所持行をロックしてから消費
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items
    WHERE player_id = v_uid AND item_id = v_box_id FOR UPDATE;
  IF v_held < 1 THEN RETURN jsonb_build_object('ok', false, 'error', '選択箱を所持していません'); END IF;

  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '装備が見つかりません'); END IF;

  UPDATE player_items SET quantity = quantity - 1
    WHERE player_id = v_uid AND item_id = v_box_id AND quantity >= 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '選択箱の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id = v_uid AND item_id = v_box_id AND quantity <= 0;

  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);

  RETURN jsonb_build_object('ok', true, 'weapon', p_weapon_name);
END;
$$;

GRANT EXECUTE ON FUNCTION bingo_bump_sortie()                  TO authenticated;
GRANT EXECUTE ON FUNCTION get_beginner_bingo()                 TO authenticated;
GRANT EXECUTE ON FUNCTION claim_beginner_bingo(text, integer)  TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_beginner_boss_box(text)       TO authenticated;
