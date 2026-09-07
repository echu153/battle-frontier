-- ============================================================
-- 拠点（Basecamp） v1   2026-07-28
--   設計書: docs/kyoten-design.md
--
-- 【何のファイルか】
--   「仲間を配置する → 時間が経つ → 資材を回収する → 拠点を強化する」だけの
--   最小ループを実装する。全て新規テーブル＋新規RPCで完結する。
--
-- 【v1スコープ】
--   ・拠点LV1〜5 / 施設5種(伐採所・採石場・薬草畑・魔力泉・倉庫)
--   ・資材4種(木材=wood / 石材=stone / 薬草=herb / 魔力の欠片=mana)
--     ※ゲーム内の「素材」は既存のお宝素材を指すので、拠点のものは必ず「資材」と呼ぶ
--   ・拠点仲間4種(スライム・盗賊・雪男・雪女)・所持上限10体
--   ・オフライン蓄積(閉じても進む)・施設ごと12時間ぶんの保管上限
--   ・v1に入れないもの: 証ドロップ / 出撃・釣りからの資材供給 / クラフト /
--     施設LV / 襲撃 / 拠点訪問 / 仲間の育成
--
-- 【★SQL適用順の制約なし＝いつ流してもよい】
--   apply_battle_result も apply_dungeon_reward も protect_profile_stats も
--   一切触らない。profiles に列も足さない(Goldを引くだけ)。
--   よって「mutant_gold_20260703.sql を最後に」の鉄則には抵触しない。
--   何度流しても壊れない(CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE /
--   DROP POLICY IF EXISTS / CREATE INDEX IF NOT EXISTS のみ)。
--
-- 【★is_admin限定先行】
--   全RPCの先頭に is_admin 判定を置いてある。一般公開時はその1行を外す
--   （コメント「★is_admin限定先行: 公開時はこの判定を外す」を目印にする）。
--
-- 【蓄積の権威 = settle方式】
--   ハートビートは使わない。pending(未回収の小数)と accrued_from(前回精算時刻)
--   だけが権威で、時刻は全て サーバー now()。クライアントから経過時間は受け取らない。
--     settle := pending を LEAST(cap, pending + rate/h × 経過時間) にし accrued_from=now()
--   settle を呼ぶのは base_assign(配置変更の【前と後】・移動元と移動先の両方) /
--   base_collect(全解放施設) / base_upgrade(LVを上げる前・全解放施設)。
--   base_get は書き込まない(STABLE)＝表示値を同じ式で計算して返すだけ。
--
-- 【capが下がったときの扱い＝自動回収】
--   仲間を外す/弱い仲間に替えると rate が下がり cap も下がる。このとき
--     ・素直に LEAST(cap,…) を代入   → 貯まっていた資材が消える
--     ・GREATEST(現在値,…) で守る    → pending>cap の間ずっと産出が止まる（凍結）
--   のどちらも事故なので、「capを超えているぶんは その場で資材へ回収する」方式にした。
--   これで pending は常に cap 以下に保たれ、貯めたぶんは1つも失われず、産出も止まらない。
--   配置変更の【後】にも settle を呼ぶのは、この超過ぶんを即その場で吐き出すため。
--
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================


-- ============================================================
-- 1) テーブル
--    書込は SECURITY DEFINER のRPCのみ。RLSは「本人のSELECT」だけ作り、
--    INSERT/UPDATE/DELETE ポリシーは作らない(＝クライアントから直接書けない)。
-- ============================================================

-- 拠点本体
CREATE TABLE IF NOT EXISTS base_camp (
  player_id  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lv         int  NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 資材台帳（player_items には入れない＝取引所・袋上限・装備UIに波及させないため）
CREATE TABLE IF NOT EXISTS base_materials (
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key       text NOT NULL,                  -- wood / stone / herb / mana
  qty       int  NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, key)
);

-- 拠点仲間（pets とは完全に別枠。戦闘・ダンジョン・ステータスに一切関与しない）
CREATE TABLE IF NOT EXISTS base_workers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  species    text NOT NULL,                 -- slime / touzoku / yeti / yukionna / ...
  nickname   text,
  facility   text,                          -- 配置先の施設key。NULL=待機
  slot       int,                           -- 薬草畑のみ 1=採集役 / 2=水やり役。他は 1
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 1つの枠に2体入れない（RPC側でも弾くが、最後の砦としてDB制約でも保証する）
CREATE UNIQUE INDEX IF NOT EXISTS base_workers_one_per_slot
  ON base_workers(player_id, facility, slot) WHERE facility IS NOT NULL;
CREATE INDEX IF NOT EXISTS base_workers_player_idx ON base_workers(player_id);

-- 施設（未回収ぶんの蓄積をここに持つ）
CREATE TABLE IF NOT EXISTS base_facilities (
  player_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key          text NOT NULL,               -- lumber / quarry / herbfield / manaspring
  pending      numeric NOT NULL DEFAULT 0,  -- 未回収の資材（小数で保持し、回収時に floor）
  accrued_from timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, key)
);

-- 最後の砦としてDB制約でも保証する（RPCのコードだけが唯一の防壁、という状態にしない）。
--   ※CREATE TABLE IF NOT EXISTS は既存テーブルに制約を足さないので、別途 DO で冪等に付ける。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_materials_qty_nonneg') THEN
    ALTER TABLE base_materials ADD CONSTRAINT base_materials_qty_nonneg CHECK (qty >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_camp_lv_range') THEN
    ALTER TABLE base_camp ADD CONSTRAINT base_camp_lv_range CHECK (lv BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_facilities_pending_nonneg') THEN
    ALTER TABLE base_facilities ADD CONSTRAINT base_facilities_pending_nonneg CHECK (pending >= 0);
  END IF;
  -- facility と slot は必ずセットで入る/抜ける。片方だけNULLだと上の部分UNIQUEが
  -- すり抜ける（UNIQUEインデックスではNULL同士が別物として扱われるため）。
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_workers_facility_slot_pair') THEN
    ALTER TABLE base_workers ADD CONSTRAINT base_workers_facility_slot_pair
      CHECK ((facility IS NULL) = (slot IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_workers_species_known') THEN
    ALTER TABLE base_workers ADD CONSTRAINT base_workers_species_known
      CHECK (species IN ('slime','touzoku','yeti','yukionna','lavagolem','magmaslime'));
  END IF;
END $$;

ALTER TABLE base_camp       ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_workers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS base_camp_select       ON base_camp;
DROP POLICY IF EXISTS base_materials_select  ON base_materials;
DROP POLICY IF EXISTS base_workers_select    ON base_workers;
DROP POLICY IF EXISTS base_facilities_select ON base_facilities;
CREATE POLICY base_camp_select       ON base_camp       FOR SELECT USING (player_id = auth.uid());
CREATE POLICY base_materials_select  ON base_materials  FOR SELECT USING (player_id = auth.uid());
CREATE POLICY base_workers_select    ON base_workers    FOR SELECT USING (player_id = auth.uid());
CREATE POLICY base_facilities_select ON base_facilities FOR SELECT USING (player_id = auth.uid());
-- INSERT/UPDATE/DELETE ポリシーは作らない＝書込は SECURITY DEFINER のRPCのみ。


-- ============================================================
-- 2) 内部ヘルパ（定数表・計算式）
--    ★PostgreSQL は新規関数の EXECUTE を既定で PUBLIC に与えるため、
--      内部ヘルパは必ず REVOKE する（サーバー権威を迂回されないように）。
--      REVOKE はこのセクションの最後にまとめてある。
-- ============================================================

-- 種族 × 適性 の表（0=なし＝配置不可 / 1 / 2 / 3）
--   lavagolem と magmaslime は v2(証ドロップ)用。v1では加入経路がないが表だけ持っておく。
CREATE OR REPLACE FUNCTION public.base_apt(p_species text, p_apt text)
 RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_species
    WHEN 'slime'      THEN CASE p_apt WHEN 'chop' THEN 0 WHEN 'mine' THEN 0 WHEN 'gather' THEN 2 WHEN 'water' THEN 3 ELSE 0 END
    WHEN 'touzoku'    THEN CASE p_apt WHEN 'chop' THEN 1 WHEN 'mine' THEN 2 WHEN 'gather' THEN 2 WHEN 'water' THEN 0 ELSE 0 END
    WHEN 'yeti'       THEN CASE p_apt WHEN 'chop' THEN 3 WHEN 'mine' THEN 1 WHEN 'gather' THEN 0 WHEN 'water' THEN 0 ELSE 0 END
    WHEN 'yukionna'   THEN CASE p_apt WHEN 'chop' THEN 0 WHEN 'mine' THEN 0 WHEN 'gather' THEN 3 WHEN 'water' THEN 2 ELSE 0 END
    WHEN 'lavagolem'  THEN CASE p_apt WHEN 'chop' THEN 1 WHEN 'mine' THEN 3 WHEN 'gather' THEN 0 WHEN 'water' THEN 0 ELSE 0 END
    WHEN 'magmaslime' THEN CASE p_apt WHEN 'chop' THEN 0 WHEN 'mine' THEN 2 WHEN 'gather' THEN 3 WHEN 'water' THEN 0 ELSE 0 END
    ELSE 0 END;
$$;

-- 種族の既定表示名（nickname 未設定時に使う。UI側の表記と揃えること）
CREATE OR REPLACE FUNCTION public.base_species_name(p_species text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_species
    WHEN 'slime'      THEN 'スライム'
    WHEN 'touzoku'    THEN '盗賊'
    WHEN 'yeti'       THEN '雪男'
    WHEN 'yukionna'   THEN '雪女'
    WHEN 'lavagolem'  THEN '溶岩ゴーレム'
    WHEN 'magmaslime' THEN 'マグマスライム'
    ELSE p_species END;
$$;

-- 適性倍率（適性0は配置不可なので 0 を返す＝万一入っていても産出0にする）
CREATE OR REPLACE FUNCTION public.base_apt_mult(p_lv int)
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_lv, 0)
    WHEN 1 THEN 1.0 WHEN 2 THEN 1.5 WHEN 3 THEN 2.2
    ELSE 0 END::numeric;
$$;

-- 水やり係数（薬草畑のslot2。未配置(0/NULL)は 0.5＝配置しなくても半分は育つ）
CREATE OR REPLACE FUNCTION public.base_water_mult(p_lv int)
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_lv, 0)
    WHEN 1 THEN 1.0 WHEN 2 THEN 1.2 WHEN 3 THEN 1.4
    ELSE 0.5 END::numeric;
$$;

-- 拠点LVの生産ボーナス
CREATE OR REPLACE FUNCTION public.base_lv_bonus(p_lv int)
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_lv,1) >= 5 THEN 1.2
    WHEN COALESCE(p_lv,1)  = 4 THEN 1.1
    ELSE 1.0 END::numeric;
$$;

-- 配置上限（体数）
CREATE OR REPLACE FUNCTION public.base_worker_cap(p_lv int)
 RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_lv,1)
    WHEN 1 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 WHEN 4 THEN 5
    ELSE 6 END;
$$;

-- 施設が解放される拠点LV（未知のキーは NULL）
--   ★UIの「拠点LV◯で解放」もこの値を base_get 経由で表示する。
--     JS側に同じ表を持たせない（SQLとJSでズレると案内文だけ古くなる）。
CREATE OR REPLACE FUNCTION public.base_facility_unlock_lv(p_key text)
 RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'lumber'     THEN 1
    WHEN 'quarry'     THEN 1
    WHEN 'herbfield'  THEN 2
    WHEN 'manaspring' THEN 3
    WHEN 'warehouse'  THEN 5
    ELSE NULL END;
$$;

-- 施設の解放判定（累積）。解放LVの正は base_facility_unlock_lv 側のみ。
CREATE OR REPLACE FUNCTION public.base_facility_unlocked(p_lv int, p_key text)
 RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(COALESCE(p_lv,1) >= base_facility_unlock_lv(p_key), false);
$$;

-- 施設が産出する資材key（倉庫は産出なし＝NULL）
CREATE OR REPLACE FUNCTION public.base_facility_material(p_key text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'lumber'     THEN 'wood'
    WHEN 'quarry'     THEN 'stone'
    WHEN 'herbfield'  THEN 'herb'
    WHEN 'manaspring' THEN 'mana'
    ELSE NULL END;
$$;

-- 施設の基礎レート（毎時）
CREATE OR REPLACE FUNCTION public.base_facility_base_rate(p_key text)
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'lumber'     THEN 20
    WHEN 'quarry'     THEN 20
    WHEN 'herbfield'  THEN 12
    WHEN 'manaspring' THEN 6
    ELSE 0 END::numeric;
$$;

-- 施設の枠が要求する適性（存在しない枠は NULL＝配置不可）
CREATE OR REPLACE FUNCTION public.base_slot_apt(p_key text, p_slot int)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_key = 'lumber'     AND p_slot = 1 THEN 'chop'
    WHEN p_key = 'quarry'     AND p_slot = 1 THEN 'mine'
    WHEN p_key = 'herbfield'  AND p_slot = 1 THEN 'gather'
    WHEN p_key = 'herbfield'  AND p_slot = 2 THEN 'water'
    WHEN p_key = 'manaspring' AND p_slot = 1 THEN 'gather'
    ELSE NULL END;
$$;

-- 施設の枠数（倉庫は0＝配置不要）
CREATE OR REPLACE FUNCTION public.base_slot_count(p_key text)
 RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'herbfield' THEN 2
    WHEN 'lumber'    THEN 1
    WHEN 'quarry'    THEN 1
    WHEN 'manaspring' THEN 1
    ELSE 0 END;
$$;

-- 次のLVの強化コスト（最大LVなら NULL）
CREATE OR REPLACE FUNCTION public.base_next_cost(p_lv int)
 RETURNS json LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_lv,1)
    WHEN 1 THEN json_build_object('lv',2,'wood', 100,'stone',  60,'herb',  0,'mana',  0,'gold',   5000)
    WHEN 2 THEN json_build_object('lv',3,'wood', 300,'stone', 200,'herb',  0,'mana',  0,'gold',  20000)
    WHEN 3 THEN json_build_object('lv',4,'wood', 800,'stone', 600,'herb',100,'mana',  0,'gold',  60000)
    WHEN 4 THEN json_build_object('lv',5,'wood',2000,'stone',1500,'herb',300,'mana',100,'gold', 150000)
    ELSE NULL::json END;
$$;

-- 現在の配置から、その施設の毎時レートを求める
--   通常施設 : 基礎 × 適性倍率(slot1) × 拠点LVボーナス
--   薬草畑   : 12 × 適性倍率(slot1=採集役) × 水やり係数(slot2) × 拠点LVボーナス
--   slot1が空なら 0（薬草畑は slot2 だけ埋まっていても 0）
CREATE OR REPLACE FUNCTION public.base_rate(p_uid uuid, p_key text)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lv   int;
  v_base numeric;
  v_s1   text;
  v_s2   text;
  v_rate numeric;
BEGIN
  -- ★権限剥がしが漏れても他人の拠点は覗けないようにする（内部ヘルパの最後の砦）
  IF p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'base_rate: 他人の拠点は参照できません';
  END IF;
  SELECT lv INTO v_lv FROM base_camp WHERE player_id = p_uid;
  IF v_lv IS NULL THEN RETURN 0; END IF;                            -- 拠点未作成
  IF NOT base_facility_unlocked(v_lv, p_key) THEN RETURN 0; END IF; -- 未解放
  v_base := base_facility_base_rate(p_key);
  IF v_base <= 0 THEN RETURN 0; END IF;                             -- 倉庫は産出なし

  SELECT species INTO v_s1 FROM base_workers
    WHERE player_id = p_uid AND facility = p_key AND slot = 1;
  IF v_s1 IS NULL THEN RETURN 0; END IF;                            -- 主役が空なら産出0

  v_rate := v_base
          * base_apt_mult(base_apt(v_s1, base_slot_apt(p_key, 1)))
          * base_lv_bonus(v_lv);

  IF p_key = 'herbfield' THEN
    SELECT species INTO v_s2 FROM base_workers
      WHERE player_id = p_uid AND facility = 'herbfield' AND slot = 2;
    v_rate := v_rate * base_water_mult(
      CASE WHEN v_s2 IS NULL THEN 0 ELSE base_apt(v_s2, 'water') END);
  END IF;

  RETURN COALESCE(v_rate, 0);
END;
$$;

-- 保管上限 = レート × 12時間 ×（倉庫解放済みなら1.5）
--   上限をレート連動にしているので、拠点を強化しても「12時間で満杯」の体験は変わらない。
CREATE OR REPLACE FUNCTION public.base_cap(p_uid uuid, p_key text)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lv int; v_rate numeric; v_mult numeric := 1.0;
BEGIN
  IF p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'base_cap: 他人の拠点は参照できません';
  END IF;
  SELECT lv INTO v_lv FROM base_camp WHERE player_id = p_uid;
  IF v_lv IS NULL THEN RETURN 0; END IF;
  v_rate := base_rate(p_uid, p_key);
  IF v_rate <= 0 THEN RETURN 0; END IF;
  IF base_facility_unlocked(v_lv, 'warehouse') THEN v_mult := 1.5; END IF;
  RETURN v_rate * 12 * v_mult;
END;
$$;

-- 精算。ここだけが pending を増やす。戻り値＝capを超えていて自動回収した量（通常は0）。
--   ★cap が下がった時（仲間を外す/弱い仲間に替える）の扱いが肝。
--     ・LEAST(cap,…) をそのまま代入 → 貯まっていた資材が消える
--     ・GREATEST(現在値,…) で守る   → pending>cap の間ずっと産出が止まる（凍結）
--     どちらも事故なので、超過ぶんは【その場で資材へ回収】して pending を cap 以下に戻す。
--   ※ 端数(1未満)は資材に移せないので、超過時に最大1だけ切り捨てられる。実害がないので許容。
DROP FUNCTION IF EXISTS public.base_settle(uuid, text);
CREATE OR REPLACE FUNCTION public.base_settle(p_uid uuid, p_key text)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     base_facilities%ROWTYPE;
  v_rate    numeric;
  v_cap     numeric;
  v_hours   numeric;
  v_pending numeric;
  v_spill   int := 0;
  v_mat     text;
BEGIN
  -- ★権限剥がしが漏れても他人のIDでは動かないようにする（内部ヘルパの最後の砦）
  IF p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'base_settle: 他人の拠点は操作できません';
  END IF;

  SELECT * INTO v_row FROM base_facilities
    WHERE player_id = p_uid AND key = p_key FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;   -- 未解放の施設は行が無い＝何もしない

  v_rate    := base_rate(p_uid, p_key);
  v_cap     := base_cap(p_uid, p_key);
  v_hours   := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_row.accrued_from))::numeric / 3600.0);
  v_pending := v_row.pending;

  -- ① capを超えているぶんを資材へ吐き出す（消さない・凍結させない）
  IF v_pending > v_cap THEN
    v_spill := FLOOR(v_pending - v_cap)::int;
    IF v_spill > 0 THEN
      v_mat := base_facility_material(p_key);
      IF v_mat IS NOT NULL THEN
        INSERT INTO base_materials(player_id, key, qty) VALUES (p_uid, v_mat, v_spill)
        ON CONFLICT (player_id, key) DO UPDATE SET qty = base_materials.qty + EXCLUDED.qty;
      END IF;
      v_pending := v_pending - v_spill;
    END IF;
  END IF;

  -- ② 経過ぶんを加算して上限で頭打ち
  UPDATE base_facilities
     SET pending      = LEAST(v_cap, v_pending + v_rate * v_hours),
         accrued_from = now()
   WHERE player_id = p_uid AND key = p_key;

  RETURN v_spill;
END;
$$;

-- 解放済みの生産施設の行を用意する（倉庫は産出が無いので行を作らない）
CREATE OR REPLACE FUNCTION public.base_ensure_facility_rows(p_uid uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lv int;
BEGIN
  IF p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'base_ensure_facility_rows: 他人の拠点は操作できません';
  END IF;
  SELECT lv INTO v_lv FROM base_camp WHERE player_id = p_uid;
  IF v_lv IS NULL THEN RETURN; END IF;
  INSERT INTO base_facilities(player_id, key, pending, accrued_from)
  SELECT p_uid, t.k, 0, now()
    FROM unnest(ARRAY['lumber','quarry','herbfield','manaspring']) AS t(k)
   WHERE base_facility_unlocked(v_lv, t.k)
  ON CONFLICT (player_id, key) DO NOTHING;
END;
$$;

-- 仲間を1体加入させる（所持上限10体。上限なら false）
CREATE OR REPLACE FUNCTION public.base_join_worker(p_uid uuid, p_species text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cnt int;
BEGIN
  IF p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'base_join_worker: 他人の拠点は操作できません';
  END IF;
  -- 未知のspeciesを焼き付けない（v2で入手経路が増えてもここが唯一の入口）
  IF p_species NOT IN ('slime','touzoku','yeti','yukionna','lavagolem','magmaslime') THEN
    RETURN false;
  END IF;
  SELECT COUNT(*) INTO v_cnt FROM base_workers WHERE player_id = p_uid;
  IF v_cnt >= 10 THEN RETURN false; END IF;
  INSERT INTO base_workers(player_id, species, nickname)
    VALUES (p_uid, p_species, base_species_name(p_species));
  RETURN true;
END;
$$;

-- ★内部ヘルパは外から直接呼べないようにする（既定で PUBLIC に EXECUTE が付くため）。
--   SECURITY DEFINER の base_settle / base_ensure_facility_rows / base_join_worker を
--   剥がさないと「他人のIDで精算」「仲間を無限に増やす」が通ってしまう。
REVOKE ALL ON FUNCTION public.base_apt(text, text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_species_name(text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_apt_mult(int)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_water_mult(int)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_lv_bonus(int)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_worker_cap(int)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_facility_unlock_lv(text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_facility_unlocked(int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_facility_material(text)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_facility_base_rate(text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_slot_apt(text, int)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_slot_count(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_next_cost(int)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_rate(uuid, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_cap(uuid, text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_settle(uuid, text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_ensure_facility_rows(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.base_join_worker(uuid, text)      FROM PUBLIC;
-- ★Supabaseは ALTER DEFAULT PRIVILEGES で新規関数に anon/authenticated への EXECUTE を
--   明示的に付けるため、FROM PUBLIC だけでは剥がれない。両ロールからも必ず剥がす。
--   ここは DOブロックで囲まない＝1本でも失敗したらスクリプト全体を止めるのが正しい
--   （握り潰すと「16本ぶんの剥がし忘れ」が成功したように見えるまま残る）。
REVOKE ALL ON FUNCTION public.base_apt(text, text)              FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_species_name(text)           FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_apt_mult(int)                FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_water_mult(int)              FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_lv_bonus(int)                FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_worker_cap(int)              FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_facility_unlock_lv(text)     FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_facility_unlocked(int, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_facility_material(text)      FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_facility_base_rate(text)     FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_slot_apt(text, int)          FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_slot_count(text)             FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_next_cost(int)               FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_rate(uuid, text)             FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_cap(uuid, text)              FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_settle(uuid, text)           FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_ensure_facility_rows(uuid)   FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.base_join_worker(uuid, text)      FROM anon, authenticated;


-- ============================================================
-- 3) base_init()  拠点の実体を作る（冪等）
--    base_get は読み取り専用にしたいので、初期化だけは専用RPCに分けている。
--    クライアントは base_get が initialized:false を返したらこれを呼ぶ。
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_init()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_created  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  INSERT INTO base_camp(player_id, lv) VALUES (v_uid, 1)
  ON CONFLICT (player_id) DO NOTHING;
  v_created := FOUND;   -- 今回このRPCで作られたか（二重実行で仲間が増えないように使う）

  -- 資材の行（無くても0扱いだが、UIの見た目を安定させるため先に作る）
  INSERT INTO base_materials(player_id, key, qty)
  SELECT v_uid, t.k, 0 FROM unnest(ARRAY['wood','stone','herb','mana']) AS t(k)
  ON CONFLICT (player_id, key) DO NOTHING;

  PERFORM base_ensure_facility_rows(v_uid);

  -- 開始時の確定配布＝スライム1体。既に持っていれば配らない（冪等）。
  -- ★v_created は見ない。拠点行だけ残って仲間が消えた状態（手動削除・部分移行）でも
  --   立て直せるようにする＝ NOT EXISTS だけで多重付与は防げている。
  IF NOT EXISTS (
      SELECT 1 FROM base_workers WHERE player_id = v_uid AND species = 'slime') THEN
    PERFORM base_join_worker(v_uid, 'slime');
  END IF;

  RETURN json_build_object('ok',true,'created',v_created);
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_init() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_init() TO authenticated;


-- ============================================================
-- 4) base_get()  状態の一括取得（★書き込まない = STABLE）
--    表示用の pending は settle と同じ式でその場で計算するだけ。
--    クライアントはレートを再計算しない（SQLとJSで式がズレる事故を作らないため）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_get()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_is_admin  boolean;
  v_gold      bigint;
  v_lv        int;
  v_init      boolean := false;
  v_keys      text[] := ARRAY['lumber','quarry','herbfield','manaspring','warehouse'];
  v_key       text;
  v_fac       json[] := ARRAY[]::json[];
  v_slots     json;
  v_workers   json;
  v_rate      numeric;
  v_cap       numeric;
  v_pending   numeric;
  v_from      timestamptz;
  v_hours     numeric;
  v_shown     numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false), COALESCE(gold,0) INTO v_is_admin, v_gold
    FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT lv INTO v_lv FROM base_camp WHERE player_id = v_uid;
  v_init := FOUND;
  v_lv := COALESCE(v_lv, 1);   -- 未作成でも「LV1・仲間なし」の初期状態を返す（書き込みはしない）

  FOREACH v_key IN ARRAY v_keys LOOP
    v_rate := base_rate(v_uid, v_key);
    v_cap  := base_cap(v_uid, v_key);

    SELECT pending, accrued_from INTO v_pending, v_from
      FROM base_facilities WHERE player_id = v_uid AND key = v_key;
    v_pending := COALESCE(v_pending, 0);
    IF v_from IS NULL THEN
      v_shown := v_pending;
    ELSIF v_pending > v_cap THEN
      -- capが下がった直後（次の精算で超過ぶんが資材へ自動回収される）。
      -- 表示は「回収できる量」なので pending をそのまま出す＝精算後の合計と一致する。
      v_shown := v_pending;
    ELSE
      -- ★base_settle の ② と同じ式にすること（ズレると表示より少なく回収されて見える）
      v_hours := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_from))::numeric / 3600.0);
      v_shown := LEAST(v_cap, v_pending + v_rate * v_hours);
    END IF;

    IF base_slot_count(v_key) = 0 THEN
      v_slots := '[]'::json;    -- 倉庫は配置不要
    ELSE
      SELECT COALESCE(json_agg(json_build_object(
               'slot', s.n,
               'apt',  base_slot_apt(v_key, s.n),
               'worker_id', (SELECT w.id FROM base_workers w
                              WHERE w.player_id = v_uid AND w.facility = v_key AND w.slot = s.n)
             ) ORDER BY s.n), '[]'::json)
        INTO v_slots
        FROM generate_series(1, base_slot_count(v_key)) AS s(n);
    END IF;

    -- ★ || ではなく array_append（json[] と json の演算子解決を曖昧にしないため）
    v_fac := array_append(v_fac, json_build_object(
      'key',      v_key,
      'unlocked', base_facility_unlocked(v_lv, v_key),
      'unlock_lv', base_facility_unlock_lv(v_key),
      'material', base_facility_material(v_key),
      'rate',     ROUND(v_rate, 2),
      'pending',  FLOOR(v_shown)::int,
      'cap',      FLOOR(v_cap)::int,
      'slots',    v_slots
    ));
  END LOOP;

  SELECT COALESCE(json_agg(json_build_object(
           'id',       w.id,
           'species',  w.species,
           'nickname', COALESCE(NULLIF(w.nickname,''), base_species_name(w.species)),
           'facility', w.facility,
           'slot',     w.slot,
           'apt',      json_build_object(
                         'chop',   base_apt(w.species,'chop'),
                         'mine',   base_apt(w.species,'mine'),
                         'gather', base_apt(w.species,'gather'),
                         'water',  base_apt(w.species,'water'))
         ) ORDER BY w.created_at), '[]'::json)
    INTO v_workers
    FROM base_workers w WHERE w.player_id = v_uid;

  RETURN json_build_object(
    'ok',           true,
    'initialized',  v_init,
    'lv',           v_lv,
    'worker_cap',   base_worker_cap(v_lv),
    'gold',         v_gold,
    'materials',    json_build_object(
       'wood',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='wood'), 0),
       'stone', COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='stone'),0),
       'herb',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='herb'), 0),
       'mana',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='mana'), 0)),
    'facilities',   array_to_json(v_fac),
    'workers',      v_workers,
    'next_cost',    base_next_cost(v_lv),
    'max_lv',       5,
    'storage_mult', CASE WHEN base_facility_unlocked(v_lv,'warehouse') THEN 1.5 ELSE 1.0 END,
    'server_now',   now()
  );
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_get() TO authenticated;


-- ============================================================
-- 5) base_assign(worker, facility, slot)  配置／解除
--    p_facility = NULL で待機に戻す。
--    ★配置を変える【前】に、移動元と移動先の両方を settle する。
--      （移動先も必ず。空のまま放置された accrued_from が残っていると、
--        配置直後に「過去ぶんを新レートで」水増し計上してしまうため）
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_assign(p_worker_id uuid, p_facility text, p_slot int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_is_admin  boolean;
  v_lv        int;
  v_worker    base_workers%ROWTYPE;
  v_apt       text;
  v_placed    int;
  v_occupant  uuid;
  v_after     text[] := ARRAY[]::text[];   -- 変更【後】に精算し直す施設
  v_k         text;
  v_mat       text;
  v_spill     int;
  v_wood int := 0; v_stone int := 0; v_herb int := 0; v_mana int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  -- 拠点行をロック＝同じプレイヤーの配置変更・回収・強化を直列化する
  SELECT lv INTO v_lv FROM base_camp WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','not_initialized'); END IF;

  -- ★所有チェックと UPDATE の間で行が動かないよう、ここで行ロックまで取る
  SELECT * INTO v_worker FROM base_workers
    WHERE id = p_worker_id AND player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','not_your_worker'); END IF;

  -- ---- 解除（待機に戻す） ----
  IF p_facility IS NULL THEN
    IF v_worker.facility IS NOT NULL THEN
      PERFORM base_settle(v_uid, v_worker.facility);   -- 外す前に、これまでのぶんを確定
      v_after := array_append(v_after, v_worker.facility);
    END IF;
    UPDATE base_workers SET facility = NULL, slot = NULL
      WHERE id = p_worker_id AND player_id = v_uid;
    -- ★外した【後】にもう一度精算＝下がったcapの超過ぶんをその場で資材へ回収する
    --   （経過時間0なので産出は増えない。凍結も消失もさせないための一手）
    FOREACH v_k IN ARRAY v_after LOOP
      v_spill := base_settle(v_uid, v_k);
      IF v_spill > 0 THEN
        v_mat := base_facility_material(v_k);
        IF    v_mat = 'wood'  THEN v_wood  := v_wood  + v_spill;
        ELSIF v_mat = 'stone' THEN v_stone := v_stone + v_spill;
        ELSIF v_mat = 'herb'  THEN v_herb  := v_herb  + v_spill;
        ELSIF v_mat = 'mana'  THEN v_mana  := v_mana  + v_spill;
        END IF;
      END IF;
    END LOOP;
    RETURN json_build_object('ok',true,
      'collected', json_build_object('wood',v_wood,'stone',v_stone,'herb',v_herb,'mana',v_mana));
  END IF;

  -- ---- 配置 ----
  IF base_slot_count(p_facility) = 0 THEN
    RETURN json_build_object('ok',false,'reason','invalid_facility');   -- 倉庫や不明キー
  END IF;
  IF NOT base_facility_unlocked(v_lv, p_facility) THEN
    RETURN json_build_object('ok',false,'reason','facility_locked');
  END IF;
  IF p_slot IS NULL OR p_slot < 1 OR p_slot > base_slot_count(p_facility) THEN
    RETURN json_build_object('ok',false,'reason','invalid_slot');
  END IF;

  v_apt := base_slot_apt(p_facility, p_slot);
  IF v_apt IS NULL OR base_apt(v_worker.species, v_apt) < 1 THEN
    RETURN json_build_object('ok',false,'reason','no_aptitude');        -- 適性0は配置不可
  END IF;

  -- 既に同じ枠にいるならそのまま成功（何もしない）
  IF v_worker.facility IS NOT DISTINCT FROM p_facility
     AND v_worker.slot IS NOT DISTINCT FROM p_slot THEN
    RETURN json_build_object('ok',true,'unchanged',true);
  END IF;

  SELECT id INTO v_occupant FROM base_workers
    WHERE player_id = v_uid AND facility = p_facility AND slot = p_slot;
  IF FOUND THEN RETURN json_build_object('ok',false,'reason','slot_taken'); END IF;

  -- 配置上限。★既に配置済みの仲間を「移す」場合は配置数が増えないので数えない
  IF v_worker.facility IS NULL THEN
    SELECT COUNT(*) INTO v_placed FROM base_workers
      WHERE player_id = v_uid AND facility IS NOT NULL;
    IF v_placed + 1 > base_worker_cap(v_lv) THEN
      RETURN json_build_object('ok',false,'reason','worker_cap');
    END IF;
  END IF;

  -- ★配置を変える前に両方を精算（同じ施設内の移動なら1回で足りる）
  IF v_worker.facility IS NOT NULL AND v_worker.facility IS DISTINCT FROM p_facility THEN
    PERFORM base_settle(v_uid, v_worker.facility);
    v_after := array_append(v_after, v_worker.facility);
  END IF;
  PERFORM base_settle(v_uid, p_facility);
  v_after := array_append(v_after, p_facility);

  UPDATE base_workers SET facility = p_facility, slot = p_slot
    WHERE id = p_worker_id AND player_id = v_uid;

  -- ★変えた【後】にも精算＝移動元でcapが下がったぶんをその場で資材へ回収する
  FOREACH v_k IN ARRAY v_after LOOP
    v_spill := base_settle(v_uid, v_k);
    IF v_spill > 0 THEN
      v_mat := base_facility_material(v_k);
      IF    v_mat = 'wood'  THEN v_wood  := v_wood  + v_spill;
      ELSIF v_mat = 'stone' THEN v_stone := v_stone + v_spill;
      ELSIF v_mat = 'herb'  THEN v_herb  := v_herb  + v_spill;
      ELSIF v_mat = 'mana'  THEN v_mana  := v_mana  + v_spill;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('ok',true,
    'collected', json_build_object('wood',v_wood,'stone',v_stone,'herb',v_herb,'mana',v_mana));
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_assign(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_assign(uuid, text, int) TO authenticated;


-- ============================================================
-- 6) base_collect()  全解放施設を精算して資材へ回収
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_collect()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_lv       int;
  v_keys     text[] := ARRAY['lumber','quarry','herbfield','manaspring'];
  v_key      text;
  v_mat      text;
  v_take     int;
  v_spill    int;
  v_pending  numeric;
  v_wood int := 0; v_stone int := 0; v_herb int := 0; v_mana int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT lv INTO v_lv FROM base_camp WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','not_initialized'); END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    CONTINUE WHEN NOT base_facility_unlocked(v_lv, v_key);
    v_mat := base_facility_material(v_key);

    -- settle の戻り＝capを超えていて自動回収したぶん。資材への加算は settle 内で
    -- 済んでいるので、ここでは受け取り表示(gained)に足すだけ（二重加算しない）。
    v_spill := base_settle(v_uid, v_key);
    IF v_spill > 0 THEN
      IF    v_mat = 'wood'  THEN v_wood  := v_wood  + v_spill;
      ELSIF v_mat = 'stone' THEN v_stone := v_stone + v_spill;
      ELSIF v_mat = 'herb'  THEN v_herb  := v_herb  + v_spill;
      ELSIF v_mat = 'mana'  THEN v_mana  := v_mana  + v_spill;
      END IF;
    END IF;

    SELECT pending INTO v_pending FROM base_facilities
      WHERE player_id = v_uid AND key = v_key;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_take := FLOOR(COALESCE(v_pending,0))::int;    -- 端数は施設に残す
    CONTINUE WHEN v_take <= 0;

    UPDATE base_facilities SET pending = pending - v_take
      WHERE player_id = v_uid AND key = v_key;

    INSERT INTO base_materials(player_id, key, qty) VALUES (v_uid, v_mat, v_take)
    ON CONFLICT (player_id, key) DO UPDATE SET qty = base_materials.qty + EXCLUDED.qty;

    IF    v_mat = 'wood'  THEN v_wood  := v_wood  + v_take;
    ELSIF v_mat = 'stone' THEN v_stone := v_stone + v_take;
    ELSIF v_mat = 'herb'  THEN v_herb  := v_herb  + v_take;
    ELSIF v_mat = 'mana'  THEN v_mana  := v_mana  + v_take;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'ok', true,
    'gained', json_build_object('wood',v_wood,'stone',v_stone,'herb',v_herb,'mana',v_mana),
    'materials', json_build_object(
       'wood',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='wood'), 0),
       'stone', COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='stone'),0),
       'herb',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='herb'), 0),
       'mana',  COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='mana'), 0))
  );
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_collect() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_collect() TO authenticated;


-- ============================================================
-- 7) base_upgrade()  資材とGoldを払って拠点LV+1
--    ★LVを上げる【前】に全解放施設を settle する（cap も rate も変わるため）。
--    ★消費は profiles を FOR UPDATE してから。検証を全部通してから消費に入り、
--      消費は例外ブロックで囲って「資材だけ減ってLVが上がらない」を作らない。
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_upgrade()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_gold     bigint;
  v_lv       int;
  v_keys     text[] := ARRAY['lumber','quarry','herbfield','manaspring'];
  v_key      text;
  v_cost     json;
  v_wood int; v_stone int; v_herb int; v_mana int; v_need_gold bigint;
  v_have_wood int; v_have_stone int; v_have_herb int; v_have_mana int;
  v_joined   text := NULL;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  -- Goldを引くので profiles を先にロック（同時実行での二重消費を防ぐ）
  SELECT COALESCE(is_admin,false), COALESCE(gold,0) INTO v_is_admin, v_gold
    FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行: 公開時はこの判定を外す
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  SELECT lv INTO v_lv FROM base_camp WHERE player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','not_initialized'); END IF;
  IF v_lv >= 5 THEN RETURN json_build_object('ok',false,'reason','max_lv'); END IF;

  v_cost := base_next_cost(v_lv);
  IF v_cost IS NULL THEN RETURN json_build_object('ok',false,'reason','max_lv'); END IF;
  v_wood      := (v_cost->>'wood')::int;
  v_stone     := (v_cost->>'stone')::int;
  v_herb      := (v_cost->>'herb')::int;
  v_mana      := (v_cost->>'mana')::int;
  v_need_gold := (v_cost->>'gold')::bigint;

  -- ★LVを上げる前に精算（LVボーナスが変わると rate も cap も変わるため）
  FOREACH v_key IN ARRAY v_keys LOOP
    CONTINUE WHEN NOT base_facility_unlocked(v_lv, v_key);
    PERFORM base_settle(v_uid, v_key);
  END LOOP;

  -- 先に全部検証（ここで返しても何も減っていない）
  SELECT COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='wood'), 0),
         COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='stone'),0),
         COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='herb'), 0),
         COALESCE((SELECT qty FROM base_materials WHERE player_id=v_uid AND key='mana'), 0)
    INTO v_have_wood, v_have_stone, v_have_herb, v_have_mana;

  IF v_have_wood < v_wood OR v_have_stone < v_stone
     OR v_have_herb < v_herb OR v_have_mana < v_mana THEN
    RETURN json_build_object('ok',false,'reason','not_enough_material');
  END IF;
  IF v_gold < v_need_gold THEN
    RETURN json_build_object('ok',false,'reason','not_enough_gold');
  END IF;

  -- 消費（万一ここで足りなくなっていたらブロックごと巻き戻して失敗を返す）
  BEGIN
    IF v_need_gold > 0 THEN
      UPDATE profiles SET gold = gold - v_need_gold
        WHERE id = v_uid AND gold >= v_need_gold;
      IF NOT FOUND THEN RAISE EXCEPTION 'base_upgrade_insufficient'; END IF;
    END IF;
    IF v_wood > 0 THEN
      UPDATE base_materials SET qty = qty - v_wood
        WHERE player_id = v_uid AND key = 'wood' AND qty >= v_wood;
      IF NOT FOUND THEN RAISE EXCEPTION 'base_upgrade_insufficient'; END IF;
    END IF;
    IF v_stone > 0 THEN
      UPDATE base_materials SET qty = qty - v_stone
        WHERE player_id = v_uid AND key = 'stone' AND qty >= v_stone;
      IF NOT FOUND THEN RAISE EXCEPTION 'base_upgrade_insufficient'; END IF;
    END IF;
    IF v_herb > 0 THEN
      UPDATE base_materials SET qty = qty - v_herb
        WHERE player_id = v_uid AND key = 'herb' AND qty >= v_herb;
      IF NOT FOUND THEN RAISE EXCEPTION 'base_upgrade_insufficient'; END IF;
    END IF;
    IF v_mana > 0 THEN
      UPDATE base_materials SET qty = qty - v_mana
        WHERE player_id = v_uid AND key = 'mana' AND qty >= v_mana;
      IF NOT FOUND THEN RAISE EXCEPTION 'base_upgrade_insufficient'; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- このブロック内の消費だけが巻き戻る（settle の結果は残ってよい）。
    -- ★想定外のエラーまで握り潰さない。足りなかった時だけ ok:false を返す。
    IF SQLERRM LIKE '%base_upgrade_insufficient%' THEN
      RETURN json_build_object('ok',false,'reason','not_enough');
    END IF;
    RAISE;
  END;

  v_lv := v_lv + 1;
  UPDATE base_camp SET lv = v_lv WHERE player_id = v_uid;

  -- 新しく解放された施設の行を作る（accrued_from は now()＝作った瞬間から蓄積開始）
  PERFORM base_ensure_facility_rows(v_uid);

  -- 拠点LVで加入する仲間（v1の入手経路はこれだけ）
  IF    v_lv = 2 THEN v_joined := 'touzoku';
  ELSIF v_lv = 3 THEN v_joined := 'yeti';
  ELSIF v_lv = 4 THEN v_joined := 'yukionna';
  END IF;
  IF v_joined IS NOT NULL THEN
    IF NOT base_join_worker(v_uid, v_joined) THEN
      v_joined := NULL;   -- 所持上限10体で入らなかった
    END IF;
  END IF;

  RETURN json_build_object('ok',true,'lv',v_lv,'joined',v_joined);
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_upgrade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_upgrade() TO authenticated;


-- ============================================================
-- 8) base_dev_reset()  開発用リセット（is_admin限定）
--    自分の拠点だけを消す。消した後は base_get が initialized:false を返すので、
--    クライアントが base_init() を呼び直して最初からになる。
-- ============================================================
CREATE OR REPLACE FUNCTION public.base_dev_reset()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- 開発用なので、公開後もこの判定は外さない
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;

  DELETE FROM base_workers    WHERE player_id = v_uid;
  DELETE FROM base_facilities WHERE player_id = v_uid;
  DELETE FROM base_materials  WHERE player_id = v_uid;
  DELETE FROM base_camp       WHERE player_id = v_uid;

  RETURN json_build_object('ok',true);
END;
$$;
-- 一般公開のRPCも、既定のPUBLIC付与を剥がしてから authenticated だけに出す
REVOKE ALL ON FUNCTION public.base_dev_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_dev_reset() TO authenticated;
