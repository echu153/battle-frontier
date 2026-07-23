-- ============================================================
-- 紋章（第5の装備枠）＋ 八獄（はちごく）
--   【is_admin開発限定の先行実装】一般公開時は各RPCの is_admin チェックを外す
--   ・player_emblem: 紋章本体（LV/上限開放段階/結晶の割り振り）
--   ・hachigoku_progress: 1日3勝カウント（JST朝5時リセット）＋クリア記録
--   ・アイテム: 紋章の成長石 / 魂8種 / 記憶8種 / 結晶22種
--   ・RPC: emblem_get / emblem_level_up / emblem_unlock_cap / emblem_allocate
--          / hachigoku_result（勝利報酬の確率ドロップ・サーバー権威）
--   ※apply_battle_result 系には一切触れないため、SQL適用順の鉄則
--     (mutant_gold_20260703.sql v2 を最後に) とは無関係に単独で実行してよい。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- 1) テーブル -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_emblem (
  player_id  uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level      int  NOT NULL DEFAULT 1,
  cap_stage  int  NOT NULL DEFAULT 0,   -- 0:上限100 / 1:125 / 2:150 / 3:175 / 4:200
  alloc      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {結晶キー: 振り数}
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.player_emblem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own emblem select" ON public.player_emblem;
DROP POLICY IF EXISTS "emblem select all" ON public.player_emblem;
-- 対人戦で相手の紋章もステ計算に使うため、閲覧は全ログインユーザー可（allocのみで機微情報なし）
CREATE POLICY "emblem select all" ON public.player_emblem
  FOR SELECT TO authenticated USING (true);
-- 書き込みは SECURITY DEFINER の RPC のみ（クライアント直接更新は不可）

CREATE TABLE IF NOT EXISTS public.hachigoku_progress (
  player_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  win_day   date,                        -- JST朝5時基準の「その日」
  win_count int NOT NULL DEFAULT 0,      -- その日の勝利数（上限3）
  clears    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {地獄キー: {"maxDiff": 0..4, "memory": true}}
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hachigoku_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own hachigoku select" ON public.hachigoku_progress;
CREATE POLICY "own hachigoku select" ON public.hachigoku_progress
  FOR SELECT USING (auth.uid() = player_id);

-- 2) アイテム定義 ---------------------------------------------
-- 2-0) 旧名「紋章の欠片」→「紋章の成長石」の移行（必ずINSERTより前に実行・冪等）
--   ・旧のみ存在: 改名
--   ・新旧両方存在（過去に不発マイグレーションを踏んだDB）: 所持を新IDへ合算して旧を削除
DO $mig$
DECLARE v_old items.id%TYPE; v_new items.id%TYPE;
BEGIN
  SELECT id INTO v_old FROM items WHERE name = '紋章の欠片' LIMIT 1;
  SELECT id INTO v_new FROM items WHERE name = '紋章の成長石' LIMIT 1;
  IF v_old IS NOT NULL AND v_new IS NULL THEN
    UPDATE items SET name = '紋章の成長石',
      description = '紋章の力を宿した石。集めると紋章のレベルを上げられる。'
     WHERE id = v_old;
  ELSIF v_old IS NOT NULL AND v_new IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
      SELECT player_id, v_new, quantity, false FROM player_items WHERE item_id = v_old
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;
    DELETE FROM player_items WHERE item_id = v_old;
    DELETE FROM items WHERE id = v_old;
  END IF;
END $mig$;

-- 2-1) アイテム作成（items.name はUNIQUE制約が無いため NOT EXISTS 方式＝再実行しても重複しない）
INSERT INTO items (name, description, effect, value)
SELECT v.name, v.description, v.effect, v.value
FROM (VALUES
  ('紋章の成長石', '紋章の力を宿した石。集めると紋章のレベルを上げられる。', 'material', 0),
  -- 魂（紋章の上限開放素材・八獄ボスがドロップ）
  ('ターパナの魂',       '焦熱地獄の主ターパナの魂。紋章の上限開放に使う。', 'material', 0),
  ('マカハドマの魂',     '氷結地獄の主マカハドマの魂。紋章の上限開放に使う。', 'material', 0),
  ('アシパトラの魂',     '針山地獄の主アシパトラの魂。紋章の上限開放に使う。', 'material', 0),
  ('チボンダラの魂',     '血池地獄の主チボンダラの魂。紋章の上限開放に使う。', 'material', 0),
  ('プレータの魂',       '餓鬼地獄の主プレータの魂。紋章の上限開放に使う。', 'material', 0),
  ('ラウラヴァの魂',     '叫喚地獄の主ラウラヴァの魂。紋章の上限開放に使う。', 'material', 0),
  ('カーラスートラの魂', '黒縄地獄の主カーラスートラの魂。紋章の上限開放に使う。', 'material', 0),
  ('ジョウハリの魂',     '鏡獄地獄の主ジョウハリの魂。紋章の上限開放に使う。', 'material', 0),
  -- 記憶（各地獄Hell初回クリア・紋章LV175→200の開放素材）
  ('ターパナの記憶',       '焦熱地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('マカハドマの記憶',     '氷結地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('アシパトラの記憶',     '針山地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('チボンダラの記憶',     '血池地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('プレータの記憶',       '餓鬼地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('ラウラヴァの記憶',     '叫喚地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('カーラスートラの記憶', '黒縄地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  ('ジョウハリの記憶',     '鏡獄地獄Hellを制した証。紋章の最終上限開放に使う。', 'material', 0),
  -- 結晶（紋章の能力+1素材・22種）
  ('力の結晶',       '紋章に力を注ぐ結晶。攻撃力+25。',                'material', 0),
  ('物理の結晶',     '紋章に力を注ぐ結晶。物理ダメージ+0.3%。',        'material', 0),
  ('知恵の結晶',     '紋章に力を注ぐ結晶。特殊攻撃+25。',              'material', 0),
  ('特殊の結晶',     '紋章に力を注ぐ結晶。特殊ダメージ+0.3%。',        'material', 0),
  ('破甲の結晶',     '紋章に力を注ぐ結晶。物理防御貫通+0.3%。',        'material', 0),
  ('破魔の結晶',     '紋章に力を注ぐ結晶。特殊防御貫通+0.3%。',        'material', 0),
  ('裂傷の結晶',     '紋章に力を注ぐ結晶。出血ダメージ+1%。',          'material', 0),
  ('火傷の結晶',     '紋章に力を注ぐ結晶。やけどダメージ+1%。',        'material', 0),
  ('猛毒の結晶',     '紋章に力を注ぐ結晶。毒/猛毒ダメージ+1%。',       'material', 0),
  ('物理吸収の結晶', '紋章に力を注ぐ結晶。物理攻撃の与ダメ吸収+0.2%。', 'material', 0),
  ('特殊吸収の結晶', '紋章に力を注ぐ結晶。特殊攻撃の与ダメ吸収+0.2%。', 'material', 0),
  ('守護の結晶',     '紋章に力を注ぐ結晶。防御+30。',                  'material', 0),
  ('抗魔の結晶',     '紋章に力を注ぐ結晶。特殊防御+30。',              'material', 0),
  ('回避の結晶',     '紋章に力を注ぐ結晶。回避率+0.1%。',              'material', 0),
  ('改心の結晶',     '紋章に力を注ぐ結晶。クリティカル率+0.2%。',      'material', 0),
  ('致命の結晶',     '紋章に力を注ぐ結晶。クリティカル威力+1%。',      'material', 0),
  ('会耐の結晶',     '紋章に力を注ぐ結晶。クリティカル抵抗+0.3%。',    'material', 0),
  ('防毒の結晶',     '紋章に力を注ぐ結晶。毒/猛毒耐性+0.4%。',         'material', 0),
  ('防麻の結晶',     '紋章に力を注ぐ結晶。麻痺耐性+0.4%。',            'material', 0),
  ('防火の結晶',     '紋章に力を注ぐ結晶。やけど耐性+0.4%。',          'material', 0),
  ('防血の結晶',     '紋章に力を注ぐ結晶。出血耐性+0.4%。',            'material', 0),
  ('防絶の結晶',     '紋章に力を注ぐ結晶。スタン耐性+0.2%。',          'material', 0)
) AS v(name, description, effect, value)
WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.name = v.name);

-- 3) 共通ヘルパー ---------------------------------------------
-- アイテムを名前で付与
CREATE OR REPLACE FUNCTION public._emblem_grant_item(p_uid uuid, p_name text, p_qty int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id items.id%TYPE;
BEGIN
  IF p_qty <= 0 THEN RETURN; END IF;
  SELECT id INTO v_id FROM items WHERE name = p_name LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  INSERT INTO player_items (player_id, item_id, quantity, equipped)
  VALUES (p_uid, v_id, p_qty, false)
  ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + p_qty;
END $$;

-- アイテムを名前で消費（足りなければ false）
CREATE OR REPLACE FUNCTION public._emblem_consume_item(p_uid uuid, p_name text, p_qty int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id items.id%TYPE; v_updated int;
BEGIN
  IF p_qty <= 0 THEN RETURN true; END IF;
  SELECT id INTO v_id FROM items WHERE name = p_name LIMIT 1;
  IF v_id IS NULL THEN RETURN false; END IF;
  UPDATE player_items SET quantity = quantity - p_qty
   WHERE player_id = p_uid AND item_id = v_id AND quantity >= p_qty;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RETURN false; END IF;
  DELETE FROM player_items WHERE player_id = p_uid AND item_id = v_id AND quantity <= 0;
  RETURN true;
END $$;

-- JST朝5時基準の「今日」
CREATE OR REPLACE FUNCTION public._hachigoku_today()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT ((now() AT TIME ZONE 'Asia/Tokyo') - interval '5 hours')::date
$$;

-- 4) RPC: 紋章 -------------------------------------------------
-- 紋章の取得（無ければLV1で自動付与）＋八獄の本日勝利数を返す
CREATE OR REPLACE FUNCTION public.emblem_get()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_area_ok boolean;
  v_e player_emblem%ROWTYPE;
  v_p hachigoku_progress%ROWTYPE;
  v_wins int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT is_admin, COALESCE(unlocked_areas, ARRAY[1]) @> ARRAY[6] INTO v_admin, v_area_ok FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) AND NOT COALESCE(v_area_ok, false) THEN RETURN json_build_object('error', 'locked'); END IF;  -- エリア⑤踏破(unlocked_areas@>6)または管理者で解放
  INSERT INTO player_emblem (player_id) VALUES (v_uid) ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO v_e FROM player_emblem WHERE player_id = v_uid;
  SELECT * INTO v_p FROM hachigoku_progress WHERE player_id = v_uid;
  IF FOUND AND v_p.win_day = public._hachigoku_today() THEN v_wins := v_p.win_count; END IF;
  RETURN json_build_object(
    'ok', true, 'level', v_e.level, 'cap_stage', v_e.cap_stage, 'alloc', v_e.alloc,
    'wins_today', v_wins, 'clears', COALESCE(v_p.clears, '{}'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.emblem_get() TO authenticated;

-- レベルアップ（紋章の成長石を消費・p_times回まとめて）
--   コスト: 次LV2〜50=1個 / 51〜100=2個 / 101〜150=3個 / 151〜200=4個
CREATE OR REPLACE FUNCTION public.emblem_level_up(p_times int DEFAULT 1)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_area_ok boolean;
  v_e player_emblem%ROWTYPE;
  v_cap int;
  v_cost int := 0;
  v_next int;
  v_ups int := 0;
  i int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT is_admin, COALESCE(unlocked_areas, ARRAY[1]) @> ARRAY[6] INTO v_admin, v_area_ok FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) AND NOT COALESCE(v_area_ok, false) THEN RETURN json_build_object('error', 'locked'); END IF;  -- エリア⑤踏破(unlocked_areas@>6)または管理者で解放
  IF p_times IS NULL OR p_times < 1 OR p_times > 200 THEN RETURN json_build_object('error', 'bad_times'); END IF;
  INSERT INTO player_emblem (player_id) VALUES (v_uid) ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO v_e FROM player_emblem WHERE player_id = v_uid FOR UPDATE;
  v_cap := (ARRAY[100,125,150,175,200])[LEAST(v_e.cap_stage, 4) + 1];
  FOR i IN 1..p_times LOOP
    v_next := v_e.level + v_ups + 1;
    EXIT WHEN v_next > v_cap;
    v_cost := v_cost + (CASE WHEN v_next <= 50 THEN 1 WHEN v_next <= 100 THEN 2 WHEN v_next <= 150 THEN 3 ELSE 4 END);
    v_ups := v_ups + 1;
  END LOOP;
  IF v_ups = 0 THEN RETURN json_build_object('error', 'cap_reached', 'cap', v_cap); END IF;
  IF NOT public._emblem_consume_item(v_uid, '紋章の成長石', v_cost) THEN
    RETURN json_build_object('error', 'not_enough_shards', 'cost', v_cost);
  END IF;
  UPDATE player_emblem SET level = level + v_ups, updated_at = now() WHERE player_id = v_uid;
  RETURN json_build_object('ok', true, 'level', v_e.level + v_ups, 'used_shards', v_cost, 'ups', v_ups);
END $$;
GRANT EXECUTE ON FUNCTION public.emblem_level_up(int) TO authenticated;

-- 上限開放（魂を消費。LV100→125:各1 / 125→150:各3 / 150→175:各5 / 175→200:各10＋記憶各1）
CREATE OR REPLACE FUNCTION public.emblem_unlock_cap()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_area_ok boolean;
  v_e player_emblem%ROWTYPE;
  v_cap int;
  v_souls int;
  v_need_memory boolean := false;
  v_names text[] := ARRAY['ターパナ','マカハドマ','アシパトラ','チボンダラ','プレータ','ラウラヴァ','カーラスートラ','ジョウハリ'];
  v_n text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT is_admin, COALESCE(unlocked_areas, ARRAY[1]) @> ARRAY[6] INTO v_admin, v_area_ok FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) AND NOT COALESCE(v_area_ok, false) THEN RETURN json_build_object('error', 'locked'); END IF;  -- エリア⑤踏破(unlocked_areas@>6)または管理者で解放
  SELECT * INTO v_e FROM player_emblem WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'no_emblem'); END IF;
  IF v_e.cap_stage >= 4 THEN RETURN json_build_object('error', 'max_stage'); END IF;
  v_cap := (ARRAY[100,125,150,175,200])[v_e.cap_stage + 1];
  IF v_e.level < v_cap THEN RETURN json_build_object('error', 'not_at_cap', 'cap', v_cap); END IF;
  v_souls := (ARRAY[1,3,5,10])[v_e.cap_stage + 1];
  v_need_memory := (v_e.cap_stage = 3);
  -- 所持チェック（消費前に全チェック→足りなければ何も消費しない）
  FOREACH v_n IN ARRAY v_names LOOP
    IF NOT EXISTS (
      SELECT 1 FROM player_items pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = v_uid AND i.name = v_n || 'の魂' AND pi.quantity >= v_souls
    ) THEN RETURN json_build_object('error', 'not_enough_souls', 'need', v_souls, 'missing', v_n || 'の魂'); END IF;
    IF v_need_memory AND NOT EXISTS (
      SELECT 1 FROM player_items pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = v_uid AND i.name = v_n || 'の記憶' AND pi.quantity >= 1
    ) THEN RETURN json_build_object('error', 'not_enough_memories', 'missing', v_n || 'の記憶'); END IF;
  END LOOP;
  -- 消費
  FOREACH v_n IN ARRAY v_names LOOP
    PERFORM public._emblem_consume_item(v_uid, v_n || 'の魂', v_souls);
    IF v_need_memory THEN PERFORM public._emblem_consume_item(v_uid, v_n || 'の記憶', 1); END IF;
  END LOOP;
  UPDATE player_emblem SET cap_stage = cap_stage + 1, updated_at = now() WHERE player_id = v_uid;
  RETURN json_build_object('ok', true, 'cap_stage', v_e.cap_stage + 1,
    'new_cap', (ARRAY[100,125,150,175,200])[v_e.cap_stage + 2]);
END $$;
GRANT EXECUTE ON FUNCTION public.emblem_unlock_cap() TO authenticated;

-- 結晶の割り振り（結晶をp_count個消費して能力+p_count。1項目MAX50・合計はLVまで）
CREATE OR REPLACE FUNCTION public.emblem_allocate(p_key text, p_count int DEFAULT 1)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_area_ok boolean;
  v_e player_emblem%ROWTYPE;
  v_item text;
  v_cur int;
  v_total int;
  -- 結晶キー→アイテム名（クライアントの emblem.js と一致させること）
  v_map jsonb := '{
    "chikara":"力の結晶","butsuri":"物理の結晶","chie":"知恵の結晶","tokushu":"特殊の結晶",
    "hakou":"破甲の結晶","hama":"破魔の結晶","resshou":"裂傷の結晶","kashou":"火傷の結晶",
    "moudoku":"猛毒の結晶","bkyuushuu":"物理吸収の結晶","tkyuushuu":"特殊吸収の結晶",
    "shugo":"守護の結晶","kouma":"抗魔の結晶","kaihi":"回避の結晶","kaishin":"改心の結晶",
    "chimei":"致命の結晶","kaitai":"会耐の結晶","boudoku":"防毒の結晶","bouma":"防麻の結晶",
    "bouka":"防火の結晶","bouketsu":"防血の結晶","bouzetsu":"防絶の結晶"
  }'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT is_admin, COALESCE(unlocked_areas, ARRAY[1]) @> ARRAY[6] INTO v_admin, v_area_ok FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) AND NOT COALESCE(v_area_ok, false) THEN RETURN json_build_object('error', 'locked'); END IF;  -- エリア⑤踏破(unlocked_areas@>6)または管理者で解放
  IF p_count IS NULL OR p_count < 1 OR p_count > 50 THEN RETURN json_build_object('error', 'bad_count'); END IF;
  v_item := v_map ->> p_key;
  IF v_item IS NULL THEN RETURN json_build_object('error', 'bad_key'); END IF;
  INSERT INTO player_emblem (player_id) VALUES (v_uid) ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO v_e FROM player_emblem WHERE player_id = v_uid FOR UPDATE;
  v_cur := COALESCE((v_e.alloc ->> p_key)::int, 0);
  IF v_cur + p_count > 50 THEN RETURN json_build_object('error', 'alloc_max', 'current', v_cur); END IF;
  SELECT COALESCE(SUM(value::int), 0) INTO v_total FROM jsonb_each_text(v_e.alloc);
  IF v_total + p_count > v_e.level THEN
    RETURN json_build_object('error', 'level_limit', 'total', v_total, 'level', v_e.level);
  END IF;
  IF NOT public._emblem_consume_item(v_uid, v_item, p_count) THEN
    RETURN json_build_object('error', 'not_enough_crystals', 'item', v_item);
  END IF;
  UPDATE player_emblem
     SET alloc = jsonb_set(alloc, ARRAY[p_key], to_jsonb(v_cur + p_count)), updated_at = now()
   WHERE player_id = v_uid;
  RETURN json_build_object('ok', true, 'key', p_key, 'value', v_cur + p_count, 'total', v_total + p_count);
END $$;
GRANT EXECUTE ON FUNCTION public.emblem_allocate(text, int) TO authenticated;

-- 5) RPC: 八獄 勝利報酬（サーバー権威・確率ドロップ）------------
--   p_hell: 地獄キー / p_diff: 0=Easy 1=Normal 2=Hard 3=EXTREME 4=Hell
--   1日3勝まで（JST朝5時リセット）。敗北時はこのRPCを呼ばない＝ノーカウント。
--   ドロップ（難易度 0..4）※結晶は個数を決めてから対応結晶グループからランダム抽選:
--     結晶: Easy=1+60%×1 / Normal=2+60%×1+20%×1 / Hard=3+同 / EXTREME=4+同 / Hell=5+同
--     紋章の成長石: Easy=1 / Normal=1〜2 / Hard=2〜3 / EXTREME=3〜4 / Hell=4〜5（範囲は均等乱数）
--     魂:   [1%, 3%, 6%, 15%, 40%]
--     記憶: Hell(4) 初回クリアで確定1個
CREATE OR REPLACE FUNCTION public.hachigoku_result(p_hell text, p_diff int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_area_ok boolean;
  v_today date := public._hachigoku_today();
  v_p hachigoku_progress%ROWTYPE;
  v_wins int := 0;
  v_bosses jsonb := '{
    "shonetsu":"ターパナ","hyoketsu":"マカハドマ","hariyama":"アシパトラ","chiike":"チボンダラ",
    "gaki":"プレータ","kyokan":"ラウラヴァ","kokujou":"カーラスートラ","kyogoku":"ジョウハリ"
  }'::jsonb;
  v_crystals jsonb := '{
    "shonetsu": ["力の結晶","物理の結晶"],
    "hyoketsu": ["知恵の結晶","特殊の結晶"],
    "hariyama": ["破甲の結晶","破魔の結晶"],
    "chiike":   ["裂傷の結晶","火傷の結晶","猛毒の結晶"],
    "gaki":     ["物理吸収の結晶","特殊吸収の結晶"],
    "kyokan":   ["守護の結晶","抗魔の結晶","回避の結晶"],
    "kokujou":  ["致命の結晶","改心の結晶","会耐の結晶"],
    "kyogoku":  ["防毒の結晶","防麻の結晶","防火の結晶","防血の結晶","防絶の結晶"]
  }'::jsonb;
  v_boss text;
  v_pool jsonb;
  v_crystal_count int := 0;
  v_shard_count int := 0;
  v_soul_rate numeric;
  v_got_soul boolean := false;
  v_got_memory boolean := false;
  v_drops jsonb := '{}'::jsonb;
  v_name text;
  v_hell_clear jsonb;
  v_max_diff int;
  i int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT is_admin, COALESCE(unlocked_areas, ARRAY[1]) @> ARRAY[6] INTO v_admin, v_area_ok FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) AND NOT COALESCE(v_area_ok, false) THEN RETURN json_build_object('error', 'locked'); END IF;  -- エリア⑤踏破(unlocked_areas@>6)または管理者で解放
  v_boss := v_bosses ->> p_hell;
  IF v_boss IS NULL OR p_diff IS NULL OR p_diff < 0 OR p_diff > 4 THEN
    RETURN json_build_object('error', 'bad_params');
  END IF;

  -- 本日の勝利数チェック（1日3勝まで）。is_adminは無制限（開発テスト用・一般公開後も管理者は免除）
  INSERT INTO hachigoku_progress (player_id, win_day, win_count)
  VALUES (v_uid, v_today, 0)
  ON CONFLICT (player_id) DO NOTHING;
  SELECT * INTO v_p FROM hachigoku_progress WHERE player_id = v_uid FOR UPDATE;
  IF v_p.win_day = v_today THEN v_wins := v_p.win_count; END IF;
  IF NOT COALESCE(v_admin, false) AND v_wins >= 5 THEN RETURN json_build_object('error', 'daily_limit'); END IF;

  -- 結晶（個数を決めてから、その地獄の対応結晶グループから1個ずつランダム抽選）
  --   Easy=1 / Normal=2 / Hard=3 / EXTREME=4 / Hell=5 を基礎に、
  --   Easyのみ +60%で1個、Normal以上は +60%で1個 かつ +20%でさらに1個
  v_pool := v_crystals -> p_hell;
  v_crystal_count := (ARRAY[
    1 + CASE WHEN random() < 0.6 THEN 1 ELSE 0 END,                                              -- Easy
    2 + CASE WHEN random() < 0.6 THEN 1 ELSE 0 END + CASE WHEN random() < 0.2 THEN 1 ELSE 0 END, -- Normal
    3 + CASE WHEN random() < 0.6 THEN 1 ELSE 0 END + CASE WHEN random() < 0.2 THEN 1 ELSE 0 END, -- Hard
    4 + CASE WHEN random() < 0.6 THEN 1 ELSE 0 END + CASE WHEN random() < 0.2 THEN 1 ELSE 0 END, -- EXTREME
    5 + CASE WHEN random() < 0.6 THEN 1 ELSE 0 END + CASE WHEN random() < 0.2 THEN 1 ELSE 0 END  -- Hell
  ])[p_diff + 1];
  FOR i IN 1..v_crystal_count LOOP
    v_name := v_pool ->> floor(random() * jsonb_array_length(v_pool))::int;
    PERFORM public._emblem_grant_item(v_uid, v_name, 1);
    v_drops := jsonb_set(v_drops, ARRAY[v_name], to_jsonb(COALESCE((v_drops ->> v_name)::int, 0) + 1));
  END LOOP;

  -- 紋章の成長石（難易度別の範囲を均等乱数で）
  --   Easy=1 / Normal=1〜2 / Hard=2〜3 / EXTREME=3〜4 / Hell=4〜5
  v_shard_count := (ARRAY[
    1,
    1 + floor(random() * 2)::int,   -- 1〜2
    2 + floor(random() * 2)::int,   -- 2〜3
    3 + floor(random() * 2)::int,   -- 3〜4
    4 + floor(random() * 2)::int    -- 4〜5
  ])[p_diff + 1];
  IF v_shard_count > 0 THEN
    PERFORM public._emblem_grant_item(v_uid, '紋章の成長石', v_shard_count);
    v_drops := jsonb_set(v_drops, ARRAY['紋章の成長石'], to_jsonb(v_shard_count));
  END IF;

  -- 魂（確率）
  v_soul_rate := (ARRAY[0.01, 0.03, 0.06, 0.15, 0.40])[p_diff + 1];
  IF random() < v_soul_rate THEN
    PERFORM public._emblem_grant_item(v_uid, v_boss || 'の魂', 1);
    v_drops := jsonb_set(v_drops, ARRAY[v_boss || 'の魂'], to_jsonb(1));
    v_got_soul := true;
  END IF;

  -- クリア記録＋Hell初回クリアの記憶
  v_hell_clear := COALESCE(v_p.clears -> p_hell, '{}'::jsonb);
  v_max_diff := GREATEST(COALESCE((v_hell_clear ->> 'maxDiff')::int, -1), p_diff);
  IF p_diff = 4 AND NOT COALESCE((v_hell_clear ->> 'memory')::boolean, false) THEN
    PERFORM public._emblem_grant_item(v_uid, v_boss || 'の記憶', 1);
    v_drops := jsonb_set(v_drops, ARRAY[v_boss || 'の記憶'], to_jsonb(1));
    v_got_memory := true;
  END IF;
  v_hell_clear := jsonb_build_object('maxDiff', v_max_diff,
    'memory', COALESCE((v_hell_clear ->> 'memory')::boolean, false) OR v_got_memory);

  UPDATE hachigoku_progress
     SET win_day = v_today,
         win_count = v_wins + 1,
         clears = jsonb_set(clears, ARRAY[p_hell], v_hell_clear),
         updated_at = now()
   WHERE player_id = v_uid;

  RETURN json_build_object('ok', true, 'drops', v_drops,
    'got_soul', v_got_soul, 'got_memory', v_got_memory,
    'wins_today', v_wins + 1, 'wins_left', GREATEST(0, 5 - (v_wins + 1)));
END $$;
GRANT EXECUTE ON FUNCTION public.hachigoku_result(text, int) TO authenticated;
