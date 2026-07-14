-- ============================================================
-- 初心者ビンゴミッション ①②（is_admin 開発限定・先行実装）
-- ------------------------------------------------------------
-- card=1（ビンゴ①）/ card=2（ビンゴ②）を1つの仕組みで管理。
--   マス達成→マス報酬 / ライン報酬=揃えたライン本数(1〜8)で解放。フルコンプ報酬なし。
-- ★ 達成判定は「そのビンゴを始めてからの増分／開始後の状態変化」のみ（過去分は計上しない）。
--   初回 get/claim 時に beginner_bingo_state.base(jsonb) へ現在値スナップショットを記録＝起点。
-- 報酬は beginner_bingo_rewards(card,kind,idx,rewards jsonb)。付与は claim_event_reward と同ロジック。
-- サーバー権威型：判定・付与は SECURITY DEFINER RPC 内でのみ。is_admin 限定先行。
--
-- ※ 全体を再実行するとビンゴ受取状態はリセットされます（状態テーブルをdrop再作成・dev限定）。
-- 単独実行可（protect_stats の保護列には触れない。gold付与時のみ GUC 許可）。
-- ============================================================

-- ---------- 1) 進捗カウンタ列（profiles）----------
--   すべて bingo_bump(key) でクライアントから加算（is_admin限定）。開始後の増分で判定。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_sortie_count  integer NOT NULL DEFAULT 0; -- 出撃(①)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_d10_count     integer NOT NULL DEFAULT 0; -- 初級の洞窟踏破(②)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_fish3h_count  integer NOT NULL DEFAULT 0; -- 3h以上の釣り放置回収(②)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bingo_scare3h_count integer NOT NULL DEFAULT 0; -- 3h以上のかかし修練完了(②)

-- ---------- 2) 受取状態（player×card）----------
DROP TABLE IF EXISTS beginner_bingo_state;
CREATE TABLE beginner_bingo_state (
  player_id     uuid    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card          integer NOT NULL DEFAULT 1,
  claimed_cells integer[]   NOT NULL DEFAULT '{}',
  claimed_lines integer[]   NOT NULL DEFAULT '{}',
  base          jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- 開始時点の各カウンタ snapshot
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, card)
);
ALTER TABLE beginner_bingo_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_state_sel ON beginner_bingo_state;
CREATE POLICY bingo_state_sel ON beginner_bingo_state
  FOR SELECT USING (player_id = auth.uid());

-- ---------- 3) 報酬設定（card×kind×idx）----------
DROP TABLE IF EXISTS beginner_bingo_rewards;
CREATE TABLE beginner_bingo_rewards (
  card    integer NOT NULL DEFAULT 1,
  kind    text    NOT NULL,               -- 'cell'(idx 0-8) / 'line'(idx 1-8=達成ライン本数)
  idx     integer NOT NULL,
  rewards jsonb   NOT NULL DEFAULT '[]'::jsonb,
  label   text,
  PRIMARY KEY (card, kind, idx)
);
ALTER TABLE beginner_bingo_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bingo_rewards_sel ON beginner_bingo_rewards;
CREATE POLICY bingo_rewards_sel ON beginner_bingo_rewards FOR SELECT USING (true);

-- ビンゴ① マス報酬（中央 idx4=ログイン1日目）
INSERT INTO beginner_bingo_rewards(card, kind, idx, rewards, label) VALUES
  (1,'cell',0,'[{"type":"weapon","name":"溶岩の指輪"},{"type":"weapon","name":"峰岳の守護輪"}]'::jsonb,'溶岩の指輪＋峰岳の守護輪'),
  (1,'cell',1,'[{"type":"item","name":"強化石(B)","qty":1}]'::jsonb,'強化石(B)×1'),
  (1,'cell',2,'[{"type":"item","name":"強化石(B)","qty":2}]'::jsonb,'強化石(B)×2'),
  (1,'cell',3,'[{"type":"item","name":"強化石(B)","qty":3}]'::jsonb,'強化石(B)×3'),
  (1,'cell',4,'[{"type":"weapon","name":"蒼海の大剣"},{"type":"weapon","name":"炎のワンド"}]'::jsonb,'蒼海の大剣＋炎のワンド'),
  (1,'cell',5,'[{"type":"weapon","name":"疾風の靴"},{"type":"weapon","name":"溶岩鎧"}]'::jsonb,'疾風の靴＋溶岩鎧'),
  (1,'cell',6,'[{"type":"item","name":"強化石(B)","qty":2},{"type":"gold","qty":10000}]'::jsonb,'強化石(B)×2＋10000G'),
  (1,'cell',7,'[{"type":"item","name":"強化石(B)","qty":3}]'::jsonb,'強化石(B)×3'),
  (1,'cell',8,'[{"type":"item","name":"強化石(B)","qty":5}]'::jsonb,'強化石(B)×5');
-- ビンゴ① ライン報酬（本数1〜8）
INSERT INTO beginner_bingo_rewards(card, kind, idx, rewards, label) VALUES
  (1,'line',1,'[{"type":"gold","qty":2000}]'::jsonb,'2000G'),
  (1,'line',2,'[{"type":"gold","qty":3000}]'::jsonb,'3000G'),
  (1,'line',3,'[{"type":"gold","qty":4000}]'::jsonb,'4000G'),
  (1,'line',4,'[{"type":"gold","qty":5000}]'::jsonb,'5000G'),
  (1,'line',5,'[{"type":"weapon","name":"溶岩の指輪"},{"type":"weapon","name":"峰岳の守護輪"}]'::jsonb,'溶岩の指輪＋峰岳の守護輪'),
  (1,'line',6,'[{"type":"gold","qty":10000}]'::jsonb,'10000G'),
  (1,'line',7,'[{"type":"gold","qty":20000}]'::jsonb,'20000G'),
  (1,'line',8,'[{"type":"item","name":"初級ボス装備選択箱","qty":1}]'::jsonb,'初級ボス装備選択箱');

-- ビンゴ② マス報酬（全マス 50000G・中央 idx4=レイド参加）
--   0:ランクマッチ挑戦 1:釣り放置3h 2:かかし修練3h
--   3:初級の洞窟踏破 4:レイド参加 5:上位職に転職
--   6:博物館5個寄贈 7:非加盟国以外に所属 8:奈落地下5階
INSERT INTO beginner_bingo_rewards(card, kind, idx, rewards, label)
  SELECT 2,'cell',g,'[{"type":"gold","qty":50000}]'::jsonb,'50000G' FROM generate_series(0,8) g;
-- ビンゴ② ライン報酬（本数1〜8）
INSERT INTO beginner_bingo_rewards(card, kind, idx, rewards, label) VALUES
  (2,'line',1,'[{"type":"item","name":"初級エリアボス装備選択箱","qty":1}]'::jsonb,'初級エリアボス装備選択箱'),
  (2,'line',2,'[{"type":"item","name":"強化石(A)","qty":2}]'::jsonb,'強化石(A)×2'),
  (2,'line',3,'[{"type":"item","name":"強化石(A)","qty":3}]'::jsonb,'強化石(A)×3'),
  (2,'line',4,'[{"type":"item","name":"中級エリアボス装備選択箱","qty":1}]'::jsonb,'中級エリアボス装備選択箱'),
  (2,'line',5,'[{"type":"item","name":"強化石(A)","qty":4}]'::jsonb,'強化石(A)×4'),
  (2,'line',6,'[{"type":"item","name":"強化石(A)","qty":5}]'::jsonb,'強化石(A)×5'),
  (2,'line',7,'[{"type":"gold","qty":200000}]'::jsonb,'200000G'),
  (2,'line',8,'[{"type":"item","name":"上級エリアボス装備選択箱","qty":1}]'::jsonb,'上級エリアボス装備選択箱');

-- ---------- 4) 選択箱アイテム ----------
INSERT INTO items (name, description, effect, value)
SELECT v.n, v.d, 'material', 0 FROM (VALUES
  ('初級ボス装備選択箱',      'エリア①〜②のボス装備1つと交換できる選択箱。初心者ビンゴ①報酬。'),
  ('初級エリアボス装備選択箱','エリア①〜③のボス装備1つと交換できる選択箱。初心者ビンゴ②報酬。'),
  ('中級エリアボス装備選択箱','エリア④〜⑤のボス装備1つと交換できる選択箱。初心者ビンゴ②報酬。'),
  ('上級エリアボス装備選択箱','エリア⑥〜⑦のボス装備1つと交換できる選択箱。初心者ビンゴ②報酬。')
) AS v(n,d)
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = v.n);

-- ---------- 5) 進捗カウンタ加算RPC ----------
CREATE OR REPLACE FUNCTION bingo_bump(p_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false) THEN RETURN; END IF;
  IF    p_key = 'sortie'  THEN UPDATE profiles SET bingo_sortie_count  = LEAST(COALESCE(bingo_sortie_count,0)+1,1000000)  WHERE id = auth.uid();
  ELSIF p_key = 'd10'     THEN UPDATE profiles SET bingo_d10_count     = LEAST(COALESCE(bingo_d10_count,0)+1,1000000)     WHERE id = auth.uid();
  ELSIF p_key = 'fish3h'  THEN UPDATE profiles SET bingo_fish3h_count  = LEAST(COALESCE(bingo_fish3h_count,0)+1,1000000)  WHERE id = auth.uid();
  ELSIF p_key = 'scare3h' THEN UPDATE profiles SET bingo_scare3h_count = LEAST(COALESCE(bingo_scare3h_count,0)+1,1000000) WHERE id = auth.uid();
  END IF;
END;
$$;
-- 旧名の互換（①クライアントが呼んでいた場合の保険）
CREATE OR REPLACE FUNCTION bingo_bump_sortie()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT bingo_bump('sortie'); $$;

-- ---------- 6) 現在値スナップショット ----------
CREATE OR REPLACE FUNCTION _bingo_snapshot(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = p_uid;
  RETURN jsonb_build_object(
    'sortie',    COALESCE(p.bingo_sortie_count,0),
    'enhance',   COALESCE(p.enhance_success_count,0) + COALESCE(p.enhance_fail_count,0),
    'boss_kill', COALESCE(p.boss_kill_count,0),
    'd10',       COALESCE(p.bingo_d10_count,0),
    'fish3h',    COALESCE(p.bingo_fish3h_count,0),
    'scare3h',   COALESCE(p.bingo_scare3h_count,0),
    'rank',      (SELECT count(*) FROM rank_matches      WHERE challenger_id = p_uid),
    'raid',      (SELECT count(*) FROM raid_participants WHERE player_id    = p_uid),
    'donation',  (SELECT count(*) FROM museum_donations  WHERE player_id    = p_uid),
    'advanced',  (SELECT count(*) FROM class_levels      WHERE player_id    = p_uid
                    AND class_name NOT IN ('戦士','弓使い','魔法使い','僧侶','格闘家')),
    'abyss',     COALESCE((SELECT cleared_floor FROM abyss_progress WHERE player_id = p_uid), 0),
    'country',   CASE WHEN p.country_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM countries WHERE id = p.country_id AND COALESCE(is_unaffiliated,false) = false)
                      THEN 1 ELSE 0 END
  );
END;
$$;

-- ---------- 7) マス評価（開始後の増分/状態変化で判定）----------
-- 返り値: { cells: boolean[9], prog: [[cur,target] x9] }（target>1 のマスだけ進捗バー表示）
CREATE OR REPLACE FUNCTION _bingo_eval(p_uid uuid, p_card integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cur jsonb; v_base jsonb;
  cells boolean[]; prog jsonb;
  ds int; de int; db int;                 -- ①: 出撃/強化/ボス撃破の増分
  dr int; dra int; dd int; dad int; dfi int; dsc int;  -- ②各増分
  cn int; ab_now int; ab_base int;
BEGIN
  cur := _bingo_snapshot(p_uid);
  INSERT INTO beginner_bingo_state(player_id, card, base) VALUES (p_uid, p_card, cur)
    ON CONFLICT (player_id, card) DO NOTHING;
  SELECT s.base INTO v_base FROM beginner_bingo_state s WHERE s.player_id = p_uid AND s.card = p_card;

  IF p_card = 1 THEN
    ds := (cur->>'sortie')::int  - (v_base->>'sortie')::int;
    de := (cur->>'enhance')::int - (v_base->>'enhance')::int;
    db := (cur->>'boss_kill')::int - (v_base->>'boss_kill')::int;
    cells := ARRAY[ ds>=10, ds>=30, ds>=50, ds>=100, true, de>=1, de>=5, de>=10, db>=1 ];
    prog := jsonb_build_array(
      jsonb_build_array(LEAST(GREATEST(ds,0),10),10),
      jsonb_build_array(LEAST(GREATEST(ds,0),30),30),
      jsonb_build_array(LEAST(GREATEST(ds,0),50),50),
      jsonb_build_array(LEAST(GREATEST(ds,0),100),100),
      jsonb_build_array(0,0),
      jsonb_build_array(LEAST(GREATEST(de,0),1),1),
      jsonb_build_array(LEAST(GREATEST(de,0),5),5),
      jsonb_build_array(LEAST(GREATEST(de,0),10),10),
      jsonb_build_array(LEAST(GREATEST(db,0),1),1)
    );
  ELSE
    dr  := (cur->>'rank')::int     - (v_base->>'rank')::int;
    dfi := (cur->>'fish3h')::int   - (v_base->>'fish3h')::int;
    dsc := (cur->>'scare3h')::int  - (v_base->>'scare3h')::int;
    dd  := (cur->>'d10')::int      - (v_base->>'d10')::int;
    dra := (cur->>'raid')::int     - (v_base->>'raid')::int;
    dad := (cur->>'advanced')::int - (v_base->>'advanced')::int;
    de  := (cur->>'donation')::int - (v_base->>'donation')::int;   -- 博物館寄贈の増分
    cn  := (cur->>'country')::int;
    ab_now  := (cur->>'abyss')::int;  ab_base := (v_base->>'abyss')::int;
    cells := ARRAY[
      dr>=1, dfi>=1, dsc>=1, dd>=1, dra>=1, dad>=1, de>=5,
      (cn=1 AND (v_base->>'country')::int = 0),   -- 開始後に非加盟国以外へ加入/建国
      (ab_now>=5 AND ab_base<5)                 -- 開始後に奈落地下5階到達
    ];
    prog := jsonb_build_array(
      jsonb_build_array(LEAST(GREATEST(dr,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dfi,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dsc,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dd,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dra,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dad,0),1),1),
      jsonb_build_array(LEAST(GREATEST(de,0),5),5),
      jsonb_build_array(CASE WHEN (cn=1 AND (v_base->>'country')::int=0) THEN 1 ELSE 0 END,1),
      jsonb_build_array(CASE WHEN (ab_now>=5 AND ab_base<5) THEN 1 ELSE 0 END,1)
    );
  END IF;

  RETURN jsonb_build_object('cells', to_jsonb(cells), 'prog', prog);
END;
$$;

-- ライン成立（横3・縦3・斜め2）。cells は boolean[9]。
CREATE OR REPLACE FUNCTION _bingo_lines(cells boolean[])
RETURNS boolean[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    cells[1] AND cells[2] AND cells[3],
    cells[4] AND cells[5] AND cells[6],
    cells[7] AND cells[8] AND cells[9],
    cells[1] AND cells[4] AND cells[7],
    cells[2] AND cells[5] AND cells[8],
    cells[3] AND cells[6] AND cells[9],
    cells[1] AND cells[5] AND cells[9],
    cells[3] AND cells[5] AND cells[7]
  ];
$$;

-- ---------- 8) 取得RPC ----------
CREATE OR REPLACE FUNCTION get_beginner_bingo(p_card integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  ev      jsonb; v_cells boolean[]; v_lines boolean[];
  st      beginner_bingo_state%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('dev_only', true);
  END IF;
  ev := _bingo_eval(v_uid, p_card);
  v_cells := ARRAY(SELECT jsonb_array_elements_text(ev->'cells')::boolean);
  v_lines := _bingo_lines(v_cells);
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = v_uid AND card = p_card;

  RETURN jsonb_build_object(
    'card',          p_card,
    'cells',         ev->'cells',
    'prog',          ev->'prog',
    'lines',         to_jsonb(v_lines),
    'claimed_cells', to_jsonb(COALESCE(st.claimed_cells, '{}')),
    'claimed_lines', to_jsonb(COALESCE(st.claimed_lines, '{}')),
    'rewards',       (SELECT jsonb_agg(jsonb_build_object('kind',kind,'idx',idx,'rewards',rewards,'label',label))
                      FROM beginner_bingo_rewards WHERE card = p_card)
  );
END;
$$;

-- ---------- 9) 報酬付与 helper ----------
CREATE OR REPLACE FUNCTION _bingo_grant(p_uid uuid, p_rewards jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry jsonb; v_type text; v_name text; v_qty int; v_itemid bigint; v_weapon weapons%ROWTYPE; v_i int;
BEGIN
  IF p_rewards IS NULL OR jsonb_typeof(p_rewards) <> 'array' THEN RETURN; END IF;
  PERFORM set_config('app.allow_stat_change','on',true);
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_rewards) LOOP
    v_type := v_entry->>'type'; v_name := v_entry->>'name';
    v_qty  := GREATEST(COALESCE((v_entry->>'qty')::int, 1), 1);
    IF v_type = 'gold' THEN
      UPDATE profiles SET gold = COALESCE(gold,0) + v_qty WHERE id = p_uid;
    ELSIF v_type = 'item' THEN
      SELECT id INTO v_itemid FROM items WHERE name = v_name LIMIT 1;
      IF v_itemid IS NULL THEN RAISE EXCEPTION '報酬アイテムが見つかりません: %', v_name; END IF;
      INSERT INTO player_items(player_id, item_id, quantity, equipped) VALUES (p_uid, v_itemid, v_qty, false)
        ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_qty;
    ELSIF v_type = 'weapon' THEN
      SELECT * INTO v_weapon FROM weapons WHERE name = v_name LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION '報酬装備が見つかりません: %', v_name; END IF;
      FOR v_i IN 1..v_qty LOOP
        INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
        VALUES (p_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
      END LOOP;
    ELSE RAISE EXCEPTION '不明な報酬タイプです: %', v_type;
    END IF;
  END LOOP;
END;
$$;

-- ---------- 10) 受取RPC ----------
CREATE OR REPLACE FUNCTION claim_beginner_bingo(p_kind text, p_idx integer, p_card integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  ev jsonb; v_cells boolean[]; v_lines boolean[]; v_lcnt int;
  st beginner_bingo_state%ROWTYPE; rw beginner_bingo_rewards%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dev_only');
  END IF;
  ev := _bingo_eval(v_uid, p_card);
  v_cells := ARRAY(SELECT jsonb_array_elements_text(ev->'cells')::boolean);
  v_lines := _bingo_lines(v_cells);
  SELECT * INTO st FROM beginner_bingo_state WHERE player_id = v_uid AND card = p_card FOR UPDATE;

  IF p_kind = 'cell' THEN
    IF p_idx < 0 OR p_idx > 8 THEN RETURN jsonb_build_object('ok',false,'error','bad_index'); END IF;
    IF NOT v_cells[p_idx + 1] THEN RETURN jsonb_build_object('ok',false,'error','not_completed'); END IF;
    IF p_idx = ANY(st.claimed_cells) THEN RETURN jsonb_build_object('ok',false,'error','already'); END IF;
  ELSIF p_kind = 'line' THEN
    IF p_idx < 1 OR p_idx > 8 THEN RETURN jsonb_build_object('ok',false,'error','bad_index'); END IF;
    v_lcnt := (SELECT count(*) FROM unnest(v_lines) x WHERE x);
    IF v_lcnt < p_idx THEN RETURN jsonb_build_object('ok',false,'error','not_completed'); END IF;
    IF p_idx = ANY(st.claimed_lines) THEN RETURN jsonb_build_object('ok',false,'error','already'); END IF;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','bad_kind');
  END IF;

  SELECT * INTO rw FROM beginner_bingo_rewards WHERE card = p_card AND kind = p_kind AND idx = p_idx;
  IF FOUND THEN PERFORM _bingo_grant(v_uid, rw.rewards); END IF;

  IF p_kind = 'cell' THEN
    UPDATE beginner_bingo_state SET claimed_cells = array_append(claimed_cells, p_idx), updated_at = now()
      WHERE player_id = v_uid AND card = p_card;
  ELSE
    UPDATE beginner_bingo_state SET claimed_lines = array_append(claimed_lines, p_idx), updated_at = now()
      WHERE player_id = v_uid AND card = p_card;
  END IF;
  RETURN jsonb_build_object('ok', true, 'rewards', COALESCE(rw.rewards,'[]'::jsonb), 'label', rw.label);
END;
$$;

-- ---------- 11) 選択箱の交換RPC ----------
-- ①: 初級ボス装備選択箱（エリア①〜②）
CREATE OR REPLACE FUNCTION redeem_beginner_boss_box(p_weapon_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_box_id bigint; v_held int; v_weapon weapons%ROWTYPE;
  v_allowed text[] := ARRAY['スライムの指輪','蒼粘剣','略奪者の短剣','影踏みのブーツ'];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','未認証'); END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN RETURN jsonb_build_object('ok',false,'error','選択できない装備です'); END IF;
  SELECT id INTO v_box_id FROM items WHERE name = '初級ボス装備選択箱' LIMIT 1;
  IF v_box_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','選択箱アイテムが存在しません'); END IF;
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items WHERE player_id=v_uid AND item_id=v_box_id FOR UPDATE;
  IF v_held < 1 THEN RETURN jsonb_build_object('ok',false,'error','選択箱を所持していません'); END IF;
  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','装備が見つかりません'); END IF;
  UPDATE player_items SET quantity = quantity - 1 WHERE player_id=v_uid AND item_id=v_box_id AND quantity>=1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','選択箱の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id=v_uid AND item_id=v_box_id AND quantity<=0;
  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
  RETURN jsonb_build_object('ok',true,'weapon',p_weapon_name);
END;
$$;

-- ②: 初級/中級/上級 エリアボス装備選択箱（帯ごとの許可リスト）
CREATE OR REPLACE FUNCTION redeem_area_boss_box(p_tier text, p_weapon_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_box text; v_box_id bigint; v_held int; v_weapon weapons%ROWTYPE; v_allowed text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','未認証'); END IF;
  IF    p_tier = '初級' THEN v_box := '初級エリアボス装備選択箱';
        v_allowed := ARRAY['スライムの指輪','蒼粘剣','略奪者の短剣','影踏みのブーツ','古代魔導コア','虚無の杖'];
  ELSIF p_tier = '中級' THEN v_box := '中級エリアボス装備選択箱';
        v_allowed := ARRAY['海竜の鱗','アクアクラウン','雷鷲の爪牙','嵐の重装甲'];
  ELSIF p_tier = '上級' THEN v_box := '上級エリアボス装備選択箱';
        v_allowed := ARRAY['絶零の魔導砲','フロストバーンの聖鎧','深紅の牙輪','深紅の魔眼石','インフェルノバスティオン'];
  ELSE  RETURN jsonb_build_object('ok',false,'error','不明な選択箱です');
  END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN RETURN jsonb_build_object('ok',false,'error','選択できない装備です'); END IF;
  SELECT id INTO v_box_id FROM items WHERE name = v_box LIMIT 1;
  IF v_box_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','選択箱アイテムが存在しません'); END IF;
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items WHERE player_id=v_uid AND item_id=v_box_id FOR UPDATE;
  IF v_held < 1 THEN RETURN jsonb_build_object('ok',false,'error','選択箱を所持していません'); END IF;
  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','装備が見つかりません'); END IF;
  UPDATE player_items SET quantity = quantity - 1 WHERE player_id=v_uid AND item_id=v_box_id AND quantity>=1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','選択箱の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id=v_uid AND item_id=v_box_id AND quantity<=0;
  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
  RETURN jsonb_build_object('ok',true,'weapon',p_weapon_name);
END;
$$;

GRANT EXECUTE ON FUNCTION bingo_bump(text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION bingo_bump_sortie()                            TO authenticated;
GRANT EXECUTE ON FUNCTION get_beginner_bingo(integer)                    TO authenticated;
GRANT EXECUTE ON FUNCTION claim_beginner_bingo(text, integer, integer)   TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_beginner_boss_box(text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_area_boss_box(text, text)               TO authenticated;
