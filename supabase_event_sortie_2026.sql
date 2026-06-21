-- ============================================================
-- 期間限定イベント「出撃ポイントラリー」 (2026-06-22 〜 2026-07-06)
--   ・出撃1回ごとに 1pt（sortie_lock に加算を追記。期間内のみ・原子的）
--   ・累計ポイントのマイルストーンで報酬を受け取れる（25刻み→100刻み・最大2000pt）
--   ・将来のイベントも event_key で使い回せる汎用設計
--   Supabase の SQL Editor でファイル全体を実行してください
--   ※protect_stats より後でOK（gold付与は set_config で許可済み）
-- ============================================================

-- ===== 0) 新規アイテム / 称号 =====
INSERT INTO items (name, description, effect, value)
SELECT '神雷炉心', '神雷を宿す炉の核。将来実装されるレイドボスのレア素材。', 'material', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '神雷炉心');

INSERT INTO items (name, description, effect, value)
SELECT 'Sレアレイドボス装備選択券', 'S級レイドボス装備1つと交換できる選択券。イベント報酬。', 'material', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = 'Sレアレイドボス装備選択券');

-- 称号「暇人」：見た目専用（効果なし）。condition_type='event' は判定スイッチに無いため
-- 称号ページからは取得不可（イベント報酬のRPCからのみ player_titles へ付与される）。
INSERT INTO titles (name, description, category, condition_type, condition_value)
SELECT '暇人', '出撃イベントで2000ptを達成した証。', 'event', 'event', 2000
WHERE NOT EXISTS (SELECT 1 FROM titles WHERE name = '暇人');

-- ===== 1) テーブル =====
CREATE TABLE IF NOT EXISTS event_config (
  event_key  text PRIMARY KEY,
  name       text NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS event_points (
  player_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_key  text NOT NULL,
  points     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, event_key)
);

-- 公開テーブル: threshold と「表示ラベル（隠し報酬は伏字）」のみ。client SELECT可。
CREATE TABLE IF NOT EXISTS event_rewards (
  event_key  text NOT NULL,
  threshold  int  NOT NULL,
  label      text NOT NULL,
  PRIMARY KEY (event_key, threshold)
);

-- 秘匿テーブル: 付与内容(rewards)と隠し報酬の正体(reveal_label)。
--   RLSを有効にしSELECTポリシーを作らない＝clientはRESTからも読めない。
--   SECURITY DEFINER の claim_event_reward だけが参照する（RLSバイパス）。
CREATE TABLE IF NOT EXISTS event_reward_payloads (
  event_key    text NOT NULL,
  threshold    int  NOT NULL,
  rewards      jsonb NOT NULL,   -- [{"type":"gold|item|weapon|title","name":"...","qty":N}]
  reveal_label text,             -- 受取時に表示する正体（伏字報酬のみ）
  PRIMARY KEY (event_key, threshold)
);

CREATE TABLE IF NOT EXISTS event_claims (
  player_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_key    text NOT NULL,
  threshold    int  NOT NULL,
  reveal_label text,             -- 受取時に確定した表示名（本人のみ閲覧可＝受取後は正体を表示）
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, event_key, threshold)
);
ALTER TABLE event_claims ADD COLUMN IF NOT EXISTS reveal_label text;  -- 既存環境への移行

-- ===== 2) RLS =====
ALTER TABLE event_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_points          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rewards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_reward_payloads ENABLE ROW LEVEL SECURITY;  -- ★SELECTポリシー無し＝client読取不可
ALTER TABLE event_claims          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_config_select"  ON event_config;
DROP POLICY IF EXISTS "event_rewards_select" ON event_rewards;
DROP POLICY IF EXISTS "event_points_select"  ON event_points;
DROP POLICY IF EXISTS "event_claims_select"  ON event_claims;
-- event_reward_payloads には SELECT ポリシーを作らない（claim の SECURITY DEFINER のみ参照）
CREATE POLICY "event_config_select"  ON event_config  FOR SELECT USING (true);
CREATE POLICY "event_rewards_select" ON event_rewards FOR SELECT USING (true);
CREATE POLICY "event_points_select"  ON event_points  FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "event_claims_select"  ON event_claims  FOR SELECT USING (auth.uid() = player_id);

-- ===== 3) イベント設定（期間: JST 6/22 05:00 〜 7/6 05:00=「7/6 4:59まで」）=====
INSERT INTO event_config (event_key, name, starts_at, ends_at) VALUES
  ('sortie_2026_06', '出撃イベント', '2026-06-22 05:00:00+09', '2026-07-06 05:00:00+09')
ON CONFLICT (event_key) DO UPDATE
  SET name = EXCLUDED.name, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

-- ===== 4) 報酬データ =====
-- 既存(rewards/reveal_labelを公開event_rewardsに持っていた版)からの移行: 公開側から秘匿列を落とす
ALTER TABLE event_rewards DROP COLUMN IF EXISTS rewards;
ALTER TABLE event_rewards DROP COLUMN IF EXISTS reveal_label;

-- 4-1) 秘匿: 付与内容＋正体（client SELECT不可）
DELETE FROM event_reward_payloads WHERE event_key = 'sortie_2026_06';
INSERT INTO event_reward_payloads (event_key, threshold, rewards, reveal_label) VALUES
  ('sortie_2026_06',   25, '[{"type":"weapon","name":"氷刃の剣"},{"type":"weapon","name":"氷晶の杖"},{"type":"weapon","name":"峰岳の守護輪"}]', NULL),
  ('sortie_2026_06',   50, '[{"type":"gold","qty":100000}]', NULL),
  ('sortie_2026_06',   75, '[{"type":"gold","qty":100000}]', NULL),
  ('sortie_2026_06',  100, '[{"type":"weapon","name":"結晶グリーブ"}]', NULL),
  ('sortie_2026_06',  125, '[{"type":"item","name":"強化石(B)","qty":2}]', NULL),
  ('sortie_2026_06',  150, '[{"type":"gold","qty":150000}]', NULL),
  ('sortie_2026_06',  175, '[{"type":"item","name":"強化石(B)","qty":2}]', NULL),
  ('sortie_2026_06',  200, '[{"type":"gold","qty":150000}]', NULL),
  ('sortie_2026_06',  225, '[{"type":"weapon","name":"蒼粘剣"}]', NULL),
  ('sortie_2026_06',  250, '[{"type":"item","name":"強化石(A)","qty":1}]', NULL),
  ('sortie_2026_06',  275, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_06',  300, '[{"type":"weapon","name":"虚無の杖"}]', NULL),
  ('sortie_2026_06',  325, '[{"type":"item","name":"強化石(A)","qty":1}]', NULL),
  ('sortie_2026_06',  350, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_06',  375, '[{"type":"weapon","name":"スライムの指輪"}]', NULL),
  ('sortie_2026_06',  400, '[{"type":"item","name":"強化石(A)","qty":1}]', NULL),
  ('sortie_2026_06',  425, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_06',  450, '[{"type":"weapon","name":"影踏みのブーツ"}]', NULL),
  ('sortie_2026_06',  475, '[{"type":"item","name":"強化石(A)","qty":1}]', NULL),
  ('sortie_2026_06',  500, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_06',  525, '[{"type":"weapon","name":"古代魔導コア"}]', NULL),
  ('sortie_2026_06',  550, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_06',  575, '[{"type":"gold","qty":250000}]', NULL),
  ('sortie_2026_06',  600, '[{"type":"weapon","name":"海竜の鱗"}]', NULL),
  ('sortie_2026_06',  625, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_06',  650, '[{"type":"gold","qty":250000}]', NULL),
  ('sortie_2026_06',  675, '[{"type":"weapon","name":"アクアクラウン"}]', NULL),
  ('sortie_2026_06',  700, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_06',  725, '[{"type":"gold","qty":250000}]', NULL),
  ('sortie_2026_06',  750, '[{"type":"weapon","name":"嵐の重装甲"}]', NULL),
  ('sortie_2026_06',  775, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_06',  800, '[{"type":"gold","qty":250000}]', NULL),
  ('sortie_2026_06',  825, '[{"type":"weapon","name":"絶零の魔導砲"}]', NULL),
  ('sortie_2026_06',  850, '[{"type":"item","name":"強化石(A)","qty":3}]', NULL),
  ('sortie_2026_06',  875, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_06',  900, '[{"type":"weapon","name":"雷鷲の爪牙"}]', NULL),
  ('sortie_2026_06',  925, '[{"type":"item","name":"強化石(A)","qty":3}]', NULL),
  ('sortie_2026_06',  950, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_06',  975, '[{"type":"weapon","name":"フロストバーンの聖鎧"}]', NULL),
  ('sortie_2026_06', 1000, '[{"type":"item","name":"強化石(A)","qty":3}]', NULL),
  ('sortie_2026_06', 1025, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_06', 1050, '[{"type":"weapon","name":"インフェルノバスティオン"}]', NULL),
  ('sortie_2026_06', 1075, '[{"type":"item","name":"強化石(A)","qty":3}]', NULL),
  ('sortie_2026_06', 1100, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_06', 1125, '[{"type":"item","name":"黒龍の逆鱗","qty":1}]', NULL),
  ('sortie_2026_06', 1150, '[{"type":"item","name":"雨禍の心核","qty":1}]', NULL),
  ('sortie_2026_06', 1175, '[{"type":"item","name":"神雷炉心","qty":1}]', NULL),
  ('sortie_2026_06', 1200, '[{"type":"item","name":"Sレアレイドボス装備選択券","qty":1}]', NULL),
  ('sortie_2026_06', 1300, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1400, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1500, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1600, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1700, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1800, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_06', 1900, '[{"type":"gold","qty":1000000}]', NULL),
  ('sortie_2026_06', 2000, '[{"type":"title","name":"暇人"}]', '称号「暇人」');

-- 4-2) 公開: 表示ラベルのみ（2000ptは伏字＝？？？？）
DELETE FROM event_rewards WHERE event_key = 'sortie_2026_06';
INSERT INTO event_rewards (event_key, threshold, label) VALUES
  ('sortie_2026_06',   25, '氷刃の剣・氷晶の杖・峰岳の守護輪'),
  ('sortie_2026_06',   50, '10万ゴールド'),
  ('sortie_2026_06',   75, '10万ゴールド'),
  ('sortie_2026_06',  100, '結晶グリーブ'),
  ('sortie_2026_06',  125, '強化石(B)×2'),
  ('sortie_2026_06',  150, '15万ゴールド'),
  ('sortie_2026_06',  175, '強化石(B)×2'),
  ('sortie_2026_06',  200, '15万ゴールド'),
  ('sortie_2026_06',  225, '蒼粘剣'),
  ('sortie_2026_06',  250, '強化石(A)'),
  ('sortie_2026_06',  275, '20万ゴールド'),
  ('sortie_2026_06',  300, '虚無の杖'),
  ('sortie_2026_06',  325, '強化石(A)'),
  ('sortie_2026_06',  350, '20万ゴールド'),
  ('sortie_2026_06',  375, 'スライムの指輪'),
  ('sortie_2026_06',  400, '強化石(A)'),
  ('sortie_2026_06',  425, '20万ゴールド'),
  ('sortie_2026_06',  450, '影踏みのブーツ'),
  ('sortie_2026_06',  475, '強化石(A)'),
  ('sortie_2026_06',  500, '20万ゴールド'),
  ('sortie_2026_06',  525, '古代魔導コア'),
  ('sortie_2026_06',  550, '強化石(A)×2'),
  ('sortie_2026_06',  575, '25万ゴールド'),
  ('sortie_2026_06',  600, '海竜の鱗'),
  ('sortie_2026_06',  625, '強化石(A)×2'),
  ('sortie_2026_06',  650, '25万ゴールド'),
  ('sortie_2026_06',  675, 'アクアクラウン'),
  ('sortie_2026_06',  700, '強化石(A)×2'),
  ('sortie_2026_06',  725, '25万ゴールド'),
  ('sortie_2026_06',  750, '嵐の重装甲'),
  ('sortie_2026_06',  775, '強化石(A)×2'),
  ('sortie_2026_06',  800, '25万ゴールド'),
  ('sortie_2026_06',  825, '絶零の魔導砲'),
  ('sortie_2026_06',  850, '強化石(A)×3'),
  ('sortie_2026_06',  875, '30万ゴールド'),
  ('sortie_2026_06',  900, '雷鷲の爪牙'),
  ('sortie_2026_06',  925, '強化石(A)×3'),
  ('sortie_2026_06',  950, '30万ゴールド'),
  ('sortie_2026_06',  975, 'フロストバーンの聖鎧'),
  ('sortie_2026_06', 1000, '強化石(A)×3'),
  ('sortie_2026_06', 1025, '30万ゴールド'),
  ('sortie_2026_06', 1050, 'インフェルノバスティオン'),
  ('sortie_2026_06', 1075, '強化石(A)×3'),
  ('sortie_2026_06', 1100, '30万ゴールド'),
  ('sortie_2026_06', 1125, '黒龍の逆鱗'),
  ('sortie_2026_06', 1150, '雨禍の心核'),
  ('sortie_2026_06', 1175, '神雷炉心'),
  ('sortie_2026_06', 1200, 'Sレアレイドボス装備選択券'),
  ('sortie_2026_06', 1300, '50万ゴールド'),
  ('sortie_2026_06', 1400, '50万ゴールド'),
  ('sortie_2026_06', 1500, '50万ゴールド'),
  ('sortie_2026_06', 1600, '50万ゴールド'),
  ('sortie_2026_06', 1700, '50万ゴールド'),
  ('sortie_2026_06', 1800, '50万ゴールド'),
  ('sortie_2026_06', 1900, '100万ゴールド'),
  ('sortie_2026_06', 2000, '？？？？');

-- 4-3) ボス装備報酬は装備名を公開列に持たせ、クライアントがweaponsからステータスを表示する
--   （ボス装備はゲーム内ドロップ＝非秘匿。称号など隠し報酬には付けない）
ALTER TABLE event_rewards ADD COLUMN IF NOT EXISTS weapon_names text[];
UPDATE event_rewards SET weapon_names = NULL WHERE event_key = 'sortie_2026_06';
UPDATE event_rewards SET weapon_names = ARRAY['氷刃の剣','氷晶の杖','峰岳の守護輪'] WHERE event_key='sortie_2026_06' AND threshold=25;
UPDATE event_rewards SET weapon_names = ARRAY['結晶グリーブ']               WHERE event_key='sortie_2026_06' AND threshold=100;
UPDATE event_rewards SET weapon_names = ARRAY['蒼粘剣']                     WHERE event_key='sortie_2026_06' AND threshold=225;
UPDATE event_rewards SET weapon_names = ARRAY['虚無の杖']                   WHERE event_key='sortie_2026_06' AND threshold=300;
UPDATE event_rewards SET weapon_names = ARRAY['スライムの指輪']             WHERE event_key='sortie_2026_06' AND threshold=375;
UPDATE event_rewards SET weapon_names = ARRAY['影踏みのブーツ']             WHERE event_key='sortie_2026_06' AND threshold=450;
UPDATE event_rewards SET weapon_names = ARRAY['古代魔導コア']               WHERE event_key='sortie_2026_06' AND threshold=525;
UPDATE event_rewards SET weapon_names = ARRAY['海竜の鱗']                   WHERE event_key='sortie_2026_06' AND threshold=600;
UPDATE event_rewards SET weapon_names = ARRAY['アクアクラウン']             WHERE event_key='sortie_2026_06' AND threshold=675;
UPDATE event_rewards SET weapon_names = ARRAY['嵐の重装甲']                 WHERE event_key='sortie_2026_06' AND threshold=750;
UPDATE event_rewards SET weapon_names = ARRAY['絶零の魔導砲']               WHERE event_key='sortie_2026_06' AND threshold=825;
UPDATE event_rewards SET weapon_names = ARRAY['雷鷲の爪牙']                 WHERE event_key='sortie_2026_06' AND threshold=900;
UPDATE event_rewards SET weapon_names = ARRAY['フロストバーンの聖鎧']       WHERE event_key='sortie_2026_06' AND threshold=975;
UPDATE event_rewards SET weapon_names = ARRAY['インフェルノバスティオン']   WHERE event_key='sortie_2026_06' AND threshold=1050;

-- ============================================================
-- 5) sortie_lock 更新（出撃ポイント加算を追記。20/10秒ロジックは維持）
-- ============================================================
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  profiles%ROWTYPE;
  v_wait int;
  v_left numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  -- 全プレイヤー20秒・ブースト中10秒
  v_wait := CASE WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now()
                 THEN 10 ELSE 20 END;

  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;

  -- ★イベント: 開催期間内なら出撃ポイント+1（同時/連打でも行ロック直下のため二重加算しない）
  --   ※テスト中は supabase_event_test_oreoreo.sql の is_admin 限定版で上書きする
  INSERT INTO event_points (player_id, event_key, points)
  SELECT v_uid, ec.event_key, 1 FROM event_config ec
  WHERE now() >= ec.starts_at AND now() < ec.ends_at
  ON CONFLICT (player_id, event_key) DO UPDATE SET points = event_points.points + 1;

  RETURN json_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;

-- ============================================================
-- 6) 報酬受取RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_event_reward(p_event_key text, p_threshold int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_points   int;
  v_rewards  jsonb;
  v_label    text;
  v_entry    jsonb;
  v_type     text;
  v_name     text;
  v_qty      int;
  v_item_id  int;
  v_weapon   weapons%ROWTYPE;
  v_title_id int;
  v_inserted int;
  v_i        int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;

  -- 付与内容は秘匿テーブル(event_reward_payloads)から。受取時のみ正体(reveal_label)を返し、
  -- 無ければ公開label。秘匿テーブルは SECURITY DEFINER の本関数からのみ読める。
  SELECT p.rewards, COALESCE(p.reveal_label, r.label) INTO v_rewards, v_label
  FROM event_reward_payloads p
  JOIN event_rewards r ON r.event_key = p.event_key AND r.threshold = p.threshold
  WHERE p.event_key = p_event_key AND p.threshold = p_threshold;
  IF NOT FOUND THEN RETURN json_build_object('error','報酬が見つかりません'); END IF;

  SELECT points INTO v_points FROM event_points WHERE player_id = v_uid AND event_key = p_event_key;
  v_points := COALESCE(v_points, 0);
  IF v_points < p_threshold THEN
    RETURN json_build_object('error','ポイントが足りません','points',v_points);
  END IF;

  -- 原子的に受取記録（同時/連打でも片方しか挿入されず二重受取を防ぐ）。
  -- 受取後の表示用に正体(v_label)を本人の受取行へ保存（event_claimsは本人のみSELECT可）。
  INSERT INTO event_claims (player_id, event_key, threshold, reveal_label)
  VALUES (v_uid, p_event_key, p_threshold, v_label) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN json_build_object('error','既に受け取り済みです'); END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- gold付与の保護トリガー許可

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_rewards) LOOP
    v_type := v_entry->>'type';
    v_name := v_entry->>'name';
    v_qty  := COALESCE((v_entry->>'qty')::int, 1);

    IF v_type = 'gold' THEN
      IF v_qty <= 0 THEN RAISE EXCEPTION 'gold報酬額が不正です: %', v_qty; END IF;
      UPDATE profiles SET gold = gold + v_qty WHERE id = v_uid;

    ELSIF v_type = 'item' THEN
      -- ★報酬名/数量が不正なら例外で全ロールバック（受取権だけ失わせない・[CODEX]99 P2）
      IF v_qty <= 0 THEN RAISE EXCEPTION '報酬数量が不正です: % %', v_name, v_qty; END IF;
      SELECT id INTO v_item_id FROM items WHERE name = v_name LIMIT 1;
      IF v_item_id IS NULL THEN RAISE EXCEPTION '報酬アイテムが見つかりません: %', v_name; END IF;
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_item_id, v_qty, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_qty;

    ELSIF v_type = 'weapon' THEN
      -- weaponは v_qty>0 を検証し qty 個ぶん付与（qty:0/負数/欠落不正をrollback・[CODEX]101 P2）
      IF v_qty <= 0 THEN RAISE EXCEPTION '報酬装備数が不正です: % %', v_name, v_qty; END IF;
      SELECT * INTO v_weapon FROM weapons WHERE name = v_name LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION '報酬装備が見つかりません: %', v_name; END IF;
      FOR v_i IN 1..v_qty LOOP
        INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
        VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
      END LOOP;

    ELSIF v_type = 'title' THEN
      -- 称号は重複不能なので数量は1のみ許可（[CODEX]101 P2）
      IF v_qty <> 1 THEN RAISE EXCEPTION '称号報酬の数量は1のみです: % %', v_name, v_qty; END IF;
      SELECT id INTO v_title_id FROM titles WHERE name = v_name LIMIT 1;
      IF v_title_id IS NULL THEN RAISE EXCEPTION '報酬称号が見つかりません: %', v_name; END IF;
      INSERT INTO player_titles (player_id, title_id) VALUES (v_uid, v_title_id) ON CONFLICT DO NOTHING;

    ELSE
      RAISE EXCEPTION '不明な報酬タイプです: %', v_type;
    END IF;
  END LOOP;

  RETURN json_build_object('success',true,'threshold',p_threshold,'label',v_label,'points',v_points);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_event_reward(text, int) TO authenticated;

-- ============================================================
-- 7) Sレアレイドボス装備 選択券の交換RPC
--    券1枚を消費し、S級レイド装備（ヴァルブレイカー/濡羽杖アマザネ/哭雨の羽衣）から1つ付与
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_raid_ticket(p_weapon_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_ticket_id int;
  v_held      int;
  v_weapon    weapons%ROWTYPE;
  v_effect    text;
  v_allowed   text[] := ARRAY['ヴァルブレイカー','マレディクシオン','濡羽杖アマザネ','哭雨の羽衣','雷鋼の機神鎧','蒼雷の短刃'];
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN
    RETURN json_build_object('error','選択できない装備です');
  END IF;

  SELECT id INTO v_ticket_id FROM items WHERE name = 'Sレアレイドボス装備選択券' LIMIT 1;
  IF v_ticket_id IS NULL THEN RETURN json_build_object('error','選択券アイテムが存在しません'); END IF;

  -- ★同時交換による複製防止: 所持行をロックしてから消費する（[CODEX]99 P1）
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items
    WHERE player_id = v_uid AND item_id = v_ticket_id FOR UPDATE;
  IF v_held < 1 THEN RETURN json_build_object('error','選択券を所持していません'); END IF;

  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('error','装備が見つかりません'); END IF;

  v_effect := CASE p_weapon_name
    WHEN 'ヴァルブレイカー' THEN 'hit_heal_down_10_2t'
    WHEN 'マレディクシオン' THEN 'hit_heal_down_10_2t'
    WHEN '濡羽杖アマザネ'   THEN 'hit_spd_down_5'
    WHEN '哭雨の羽衣'       THEN 'battle_start_ailment_shield'
    WHEN '雷鋼の機神鎧'     THEN 'ondmg_spd_up_5_2t'
    WHEN '蒼雷の短刃'       THEN 'extra_hit_paralysis_30'
  END;

  -- 更新0件＝別リクエストが先に消費済み→中断（複製防止の二重ガード）
  UPDATE player_items SET quantity = quantity - 1
    WHERE player_id = v_uid AND item_id = v_ticket_id AND quantity >= 1;
  IF NOT FOUND THEN RETURN json_build_object('error','選択券の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id = v_uid AND item_id = v_ticket_id AND quantity <= 0;

  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, v_effect);

  RETURN json_build_object('success',true,'weapon',p_weapon_name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_raid_ticket(text) TO authenticated;

-- ============================================================
-- 8) レイドボス・デイリーダンジョンでもポイント加算（RPC本体を触らずトリガーで）
--    ・期間内のみ加算（grant_event_point が期間判定）
--    ・raid_participants.attack_count の増分＝レイド攻撃回数ぶん加算
--    ・dungeon_attempts の cnt_* 合計の増分＝ダンジョン挑戦回数ぶん加算
--    ※attack_raid_boss/dungeon_consume の関数定義に依存しないので並行改修と衝突しない
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_event_point(p_uid uuid, p_n int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_uid IS NULL OR p_n IS NULL OR p_n <= 0 THEN RETURN; END IF;
  INSERT INTO event_points (player_id, event_key, points)
  SELECT p_uid, ec.event_key, p_n FROM event_config ec
  WHERE now() >= ec.starts_at AND now() < ec.ends_at
  ON CONFLICT (player_id, event_key) DO UPDATE SET points = event_points.points + EXCLUDED.points;
END $$;

-- レイド: 攻撃ごとに attack_count が増える分を加算
CREATE OR REPLACE FUNCTION public.trg_raid_event_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_delta int;
BEGIN
  v_delta := COALESCE(NEW.attack_count,0) - CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.attack_count,0) ELSE 0 END;
  PERFORM grant_event_point(NEW.player_id, v_delta);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS raid_event_point ON raid_participants;
CREATE TRIGGER raid_event_point AFTER INSERT OR UPDATE OF attack_count ON raid_participants
FOR EACH ROW EXECUTE FUNCTION trg_raid_event_point();

-- デイリーダンジョン: cnt_* の合計増分ぶん加算（dungeon_consume は1回1増）
CREATE OR REPLACE FUNCTION public.trg_dungeon_event_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_new int; v_old int;
BEGIN
  v_new := COALESCE(NEW.cnt_exp,0)+COALESCE(NEW.cnt_gold,0)+COALESCE(NEW.cnt_stone,0)+COALESCE(NEW.cnt_prof,0)+COALESCE(NEW.cnt_gem,0);
  v_old := CASE WHEN TG_OP='UPDATE'
                THEN COALESCE(OLD.cnt_exp,0)+COALESCE(OLD.cnt_gold,0)+COALESCE(OLD.cnt_stone,0)+COALESCE(OLD.cnt_prof,0)+COALESCE(OLD.cnt_gem,0)
                ELSE 0 END;
  PERFORM grant_event_point(NEW.player_id, v_new - v_old);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dungeon_event_point ON dungeon_attempts;
CREATE TRIGGER dungeon_event_point AFTER INSERT OR UPDATE ON dungeon_attempts
FOR EACH ROW EXECUTE FUNCTION trg_dungeon_event_point();
