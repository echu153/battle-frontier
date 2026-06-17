-- ============================================================
-- 領地（国・建国）システム  Phase 1  ※is_admin限定で先行公開
-- ------------------------------------------------------------
-- ・9カ国構成（うち1つは固定の「非加盟国」＝どこにも属さないプレイヤーの居場所）。
--   残り最大8カ国はプレイヤーが空き枠がある限り自由に建国できる。
-- ・建国条件: キャラクターLV(char_lv) 100以上 ＆ 非加盟国に居ること。
-- ・亡命（他国への加入/離脱）は1週間(7日)に1回まで。
-- ・領地は1時間に1回拡大でき、総合力に応じて1回の獲得量が変わる。
-- ・階級は貢献度(country_contrib)で自動決定。建国者は「元帥」固定。
--   「副元帥」「参謀」は将来の任命/下剋上用に予約（自動昇格では到達しない）。
-- ・core_hp は将来の「国同士の戦争（コア破壊で国消滅）」用に列だけ先行用意。
--
-- ★ protect_stats.sql のステ保護列(stat_point_spent/lv/char_lv/exp等)は一切変更しないため、
--   本RPC群は app.allow_stat_change を立てる必要はない（新規列のみ更新）。
-- ============================================================

-- ===== 1) countries テーブル =====
CREATE TABLE IF NOT EXISTS public.countries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  emblem          text,                              -- 国旗/エンブレム（絵文字や記号）
  description     text,                              -- 国の説明文
  region          int,                               -- 地図上の領域(1〜9)。1領域=1国。非加盟国は region=7 固定。
  founder_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  territory       numeric NOT NULL DEFAULT 0,        -- 領地の広さ（拡大の累積）
  core_hp         int NOT NULL DEFAULT 1000000,      -- 将来の戦争用（コアHP）
  is_unaffiliated boolean NOT NULL DEFAULT false,    -- 非加盟国フラグ（1つだけ）
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- 既に旧バージョンを適用済みでも region 列を追加
ALTER TABLE public.countries ADD COLUMN IF NOT EXISTS region int;
-- NPC国（建国者なし・時間経過で領地が自動増加）用の列
ALTER TABLE public.countries ADD COLUMN IF NOT EXISTS is_npc        boolean NOT NULL DEFAULT false;
ALTER TABLE public.countries ADD COLUMN IF NOT EXISTS npc_rate      numeric NOT NULL DEFAULT 0;       -- 領地/時間（全エリア合計）
ALTER TABLE public.countries ADD COLUMN IF NOT EXISTS npc_last_tick timestamptz;

-- 非加盟国は1つだけ
CREATE UNIQUE INDEX IF NOT EXISTS uniq_unaffiliated_country
  ON public.countries (is_unaffiliated) WHERE is_unaffiliated;
-- 1領域=1国（地図 ryouti.png の9大陸。region 1〜9 が各大陸に対応）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_country_region
  ON public.countries (region) WHERE region IS NOT NULL;

-- 非加盟国を1つだけ生成（存在しなければ）。下段・左から2番目の大陸 region=7 に配置。
INSERT INTO public.countries (name, emblem, description, region, is_unaffiliated)
SELECT '非加盟国', '🏳', 'どの国にも属さない者たちが暮らす中立の地。ここから新たな国を建てることができる。', 7, true
WHERE NOT EXISTS (SELECT 1 FROM public.countries WHERE is_unaffiliated);
-- 非加盟国の領域を region=7 に確定（旧版で 5 に置いていた場合も移動）
UPDATE public.countries SET region = 7 WHERE is_unaffiliated AND region IS DISTINCT FROM 7;

-- ===== 2) profiles 列追加 =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_id      uuid REFERENCES public.countries(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_rank    text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_contrib numeric NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_asylum_at  timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_expand_at  timestamptz;
-- 亡命後ロック：この時刻まで領地システム（拡大/建国/チャット/再亡命）を利用不可
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS territory_locked_until timestamptz;
-- country_id が NULL のプレイヤーは「非加盟国」扱い（明示移行はしない）。

-- ===== 3) RLS（countries は全ログインユーザーが閲覧可） =====
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS countries_select_all ON public.countries;
CREATE POLICY countries_select_all ON public.countries
  FOR SELECT USING (true);
-- INSERT/UPDATE はRPC(SECURITY DEFINER)経由のみ。直接書き込みポリシーは作らない。

-- ===== 4) 階級ヘルパ：貢献度→階級 =====
-- 自動昇格で到達する範囲は 二等兵〜大将（16段）。副元帥/参謀/元帥は任命・建国専用。
CREATE OR REPLACE FUNCTION public.territory_rank_for_contrib(p_contrib numeric)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  ranks  text[]    := ARRAY['二等兵','一等兵','上等兵','伍長','軍曹','曹長','准尉','少尉','中尉','大尉','少佐','中佐','大佐','少将','中将','大将'];
  thr    numeric[] := ARRAY[0,500,1500,3000,6000,10000,16000,25000,40000,60000,90000,130000,180000,250000,350000,500000];
  i      int;
BEGIN
  FOR i IN REVERSE array_length(thr,1)..1 LOOP
    IF p_contrib >= thr[i] THEN
      RETURN ranks[i];
    END IF;
  END LOOP;
  RETURN ranks[1];
END;
$function$;

-- ===== 5) 建国 =====
-- 旧シグネチャ(region無し)が残っていれば削除
DROP FUNCTION IF EXISTS public.found_country(text, text, text);

CREATE OR REPLACE FUNCTION public.found_country(p_name text, p_emblem text, p_desc text, p_region int)
 RETURNS public.countries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_charlv  int;
  v_cid     uuid;
  v_unaff   boolean;
  v_taken   boolean;
  v_admin   boolean;
  v_lock    timestamptz;
  v_name    text := btrim(coalesce(p_name,''));
  v_new     public.countries;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION '国名を入力してください'; END IF;
  IF char_length(v_name) > 20 THEN RAISE EXCEPTION '国名は20文字以内にしてください'; END IF;

  SELECT is_admin, territory_locked_until INTO v_admin, v_lock FROM public.profiles WHERE id = v_uid;
  IF v_admin IS NOT TRUE AND v_lock IS NOT NULL AND now() < v_lock THEN
    RAISE EXCEPTION '所属国を移った直後は1週間 建国できません（% まで）', to_char(v_lock, 'MM/DD HH24:MI');
  END IF;

  -- 領域(大陸)の指定チェック
  IF p_region IS NULL OR p_region < 1 OR p_region > 9 THEN
    RAISE EXCEPTION '建国する大陸を選択してください';
  END IF;
  -- 既にその領域に国がある（非加盟国の領域含む）なら建国不可
  SELECT is_unaffiliated INTO v_taken FROM public.countries WHERE region = p_region;
  IF FOUND THEN
    IF v_taken IS TRUE THEN
      RAISE EXCEPTION 'そこは非加盟国の領域です';
    END IF;
    RAISE EXCEPTION 'その大陸には既に国があります';
  END IF;

  SELECT char_lv, country_id INTO v_charlv, v_cid FROM public.profiles WHERE id = v_uid;
  IF v_charlv IS NULL OR v_charlv < 100 THEN
    RAISE EXCEPTION '建国にはキャラクターLV100以上が必要です';
  END IF;

  -- 非加盟国（country_id が NULL もしくは is_unaffiliated）に居ること
  IF v_cid IS NOT NULL THEN
    SELECT is_unaffiliated INTO v_unaff FROM public.countries WHERE id = v_cid;
    IF v_unaff IS NOT TRUE THEN
      RAISE EXCEPTION '建国は非加盟国に居るプレイヤーのみ可能です';
    END IF;
  END IF;

  INSERT INTO public.countries (name, emblem, description, region, founder_id, is_unaffiliated)
  VALUES (v_name, nullif(btrim(coalesce(p_emblem,'')),''), nullif(btrim(coalesce(p_desc,'')),''), p_region, v_uid, false)
  RETURNING * INTO v_new;

  UPDATE public.profiles
     SET country_id = v_new.id, country_rank = '元帥', country_contrib = 0, last_asylum_at = now()
   WHERE id = v_uid;

  RETURN v_new;
EXCEPTION
  WHEN unique_violation THEN
    -- name か region の重複
    IF EXISTS (SELECT 1 FROM public.countries WHERE region = p_region) THEN
      RAISE EXCEPTION 'その大陸には既に国があります';
    END IF;
    RAISE EXCEPTION 'その国名は既に使われています';
END;
$function$;

-- ===== 6) 亡命（他国へ加入 / 非加盟国へ離脱）=====
CREATE OR REPLACE FUNCTION public.seek_asylum(p_country_id uuid)
 RETURNS public.profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_cid    uuid;
  v_rank   text;
  v_npc    boolean;
  v_from_unaff boolean;
  v_me     public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT country_id, country_rank INTO v_cid, v_rank
    FROM public.profiles WHERE id = v_uid;

  SELECT is_npc INTO v_npc FROM public.countries WHERE id = p_country_id;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の国が存在しません'; END IF;
  IF v_npc IS TRUE THEN RAISE EXCEPTION 'その国には亡命できません'; END IF;

  IF v_cid IS NOT DISTINCT FROM p_country_id THEN
    RAISE EXCEPTION '既にその国に所属しています';
  END IF;

  -- 元帥は自国を放棄して亡命できない（国の喪失を防ぐ。将来の遷都/譲位で対応）
  IF v_rank = '元帥' THEN
    RAISE EXCEPTION '元帥は亡命できません';
  END IF;

  -- 現在地が非加盟国(または無所属)かどうか
  IF v_cid IS NULL THEN
    v_from_unaff := true;
  ELSE
    SELECT is_unaffiliated INTO v_from_unaff FROM public.countries WHERE id = v_cid;
    v_from_unaff := coalesce(v_from_unaff, true);
  END IF;

  -- 亡命はいつでも可能。所属国から他国へ移る場合のみ1週間ロック。
  -- 非加盟国からの加入はペナルティなし（ロックを解除）。
  UPDATE public.profiles
     SET country_id = p_country_id, country_rank = '二等兵', country_contrib = 0,
         last_asylum_at = now(),
         territory_locked_until = CASE WHEN v_from_unaff THEN NULL ELSE now() + interval '7 days' END
   WHERE id = v_uid
  RETURNING * INTO v_me;

  RETURN v_me;
END;
$function$;

-- ===== 6.5) 任命（元帥が副元帥・参謀を任命／解任）=====
-- 元帥のみ実行可。p_rank='副元帥'|'参謀'|'解任'。副元帥/参謀は国に各1名（既存者は自動階級に戻す）。
CREATE OR REPLACE FUNCTION public.appoint_rank(p_target uuid, p_rank text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_cid     uuid;
  v_myrank  text;
  v_tcid    uuid;
  v_tcontrib numeric;
  v_trank   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT country_id, country_rank INTO v_cid, v_myrank FROM public.profiles WHERE id = v_uid;
  IF v_myrank IS DISTINCT FROM '元帥' THEN RAISE EXCEPTION '元帥のみが任命できます'; END IF;
  IF p_target = v_uid THEN RAISE EXCEPTION '自分自身は任命できません'; END IF;

  SELECT country_id, country_contrib, country_rank INTO v_tcid, v_tcontrib, v_trank
    FROM public.profiles WHERE id = p_target;
  IF v_tcid IS NULL OR v_tcid IS DISTINCT FROM v_cid THEN
    RAISE EXCEPTION '同じ国の国民のみ任命できます';
  END IF;
  IF v_trank = '元帥' THEN RAISE EXCEPTION '元帥の階級は変更できません'; END IF;

  IF p_rank IN ('副元帥','参謀') THEN
    -- 同役職の既存者を自動階級に戻す（各1名制）
    UPDATE public.profiles
       SET country_rank = public.territory_rank_for_contrib(country_contrib)
     WHERE country_id = v_cid AND country_rank = p_rank AND id <> p_target;
    UPDATE public.profiles SET country_rank = p_rank WHERE id = p_target;
  ELSIF p_rank = '解任' OR p_rank IS NULL THEN
    UPDATE public.profiles SET country_rank = public.territory_rank_for_contrib(v_tcontrib) WHERE id = p_target;
  ELSE
    RAISE EXCEPTION '無効な役職です';
  END IF;
END;
$function$;

-- ===== 6.6) 国の説明文を編集（元帥のみ）=====
CREATE OR REPLACE FUNCTION public.update_country_desc(p_desc text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_cid  uuid;
  v_rank text;
  v_desc text := nullif(btrim(coalesce(p_desc,'')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_desc IS NOT NULL AND char_length(v_desc) > 200 THEN
    RAISE EXCEPTION '説明文は200文字以内にしてください';
  END IF;
  SELECT country_id, country_rank INTO v_cid, v_rank FROM public.profiles WHERE id = v_uid;
  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  IF v_rank IS DISTINCT FROM '元帥' THEN RAISE EXCEPTION '元帥のみが国の説明を編集できます'; END IF;
  UPDATE public.countries SET description = v_desc WHERE id = v_cid;
END;
$function$;

-- ===== 7) エリア別領地（出撃エリアごとに領地を蓄積）=====
-- ・各エリア(1〜7)ごとに国の領地量を保持。シェア最大の国がそのエリアを支配。
-- ・将来: 支配国の国民はそのエリアで装備ドロップ率が上昇（最大+3%）。←実装は後日。
CREATE TABLE IF NOT EXISTS public.country_area_territory (
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  area_id    int  NOT NULL,
  amount     numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (country_id, area_id)
);
ALTER TABLE public.country_area_territory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cat_select_all ON public.country_area_territory;
CREATE POLICY cat_select_all ON public.country_area_territory FOR SELECT USING (true);

-- ===== 8) 領地拡大（1時間に1回・総合力依存・出撃エリア指定）=====
-- p_power = クライアントが計算した総合力。先行公開(is_admin限定)のため簡易採用。
-- p_area  = 出撃エリア(1〜7)。プレイヤーの解放済みエリア(unlocked_areas)に含まれること。
-- クールダウン(1h)はサーバ側で厳密判定。獲得量は power を上限クランプして算出。
DROP FUNCTION IF EXISTS public.expand_territory(numeric);
CREATE OR REPLACE FUNCTION public.expand_territory(p_power numeric, p_area int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_cid     uuid;
  v_unaff   boolean;
  v_last    timestamptz;
  v_contrib numeric;
  v_rank    text;
  v_unlocked int[];
  v_admin   boolean;
  v_lock    timestamptz;
  v_power   numeric := least(greatest(coalesce(p_power,0),0), 100000);
  v_gain    numeric;
  v_terr    numeric;
  v_area_amt numeric;
  v_newrank text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_area IS NULL OR p_area < 1 OR p_area > 7 THEN
    RAISE EXCEPTION '出撃エリアを選択してください';
  END IF;

  SELECT country_id, last_expand_at, country_contrib, country_rank, unlocked_areas, is_admin, territory_locked_until
    INTO v_cid, v_last, v_contrib, v_rank, v_unlocked, v_admin, v_lock
    FROM public.profiles WHERE id = v_uid;

  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  SELECT is_unaffiliated INTO v_unaff FROM public.countries WHERE id = v_cid;
  IF v_unaff IS TRUE THEN RAISE EXCEPTION '非加盟国では領地を広げられません'; END IF;

  -- 所属国を移った直後ロック中は領地拡大不可（is_adminは除外）
  IF v_admin IS NOT TRUE AND v_lock IS NOT NULL AND now() < v_lock THEN
    RAISE EXCEPTION '所属国を移った直後は1週間 領地を広げられません（% まで）', to_char(v_lock, 'MM/DD HH24:MI');
  END IF;

  IF NOT (p_area = ANY(coalesce(v_unlocked, ARRAY[1]))) THEN
    RAISE EXCEPTION 'そのエリアはまだ解放されていません';
  END IF;

  -- 領地拡大は1時間に1回（全員適用）
  IF v_last IS NOT NULL AND now() - v_last < interval '1 hour' THEN
    RAISE EXCEPTION '領地拡大は1時間に1回までです';
  END IF;

  -- 獲得量: 基礎10 + 総合力/20 に 0.9〜1.1 の乱数を乗算（総合力2万で約1010±10%）
  v_gain := floor((10 + v_power / 20.0) * (0.9 + random() * 0.2));

  -- 国の総領地に加算
  UPDATE public.countries SET territory = territory + v_gain WHERE id = v_cid
  RETURNING territory INTO v_terr;

  -- 選択エリアの領地に加算（無ければ作成）
  INSERT INTO public.country_area_territory (country_id, area_id, amount)
  VALUES (v_cid, p_area, v_gain)
  ON CONFLICT (country_id, area_id) DO UPDATE SET amount = country_area_territory.amount + v_gain
  RETURNING amount INTO v_area_amt;

  v_contrib := coalesce(v_contrib,0) + v_gain;

  -- 階級自動更新（建国者の元帥や任命枠の副元帥/参謀は据え置き）
  IF v_rank IN ('元帥','副元帥','参謀') THEN
    v_newrank := v_rank;
  ELSE
    v_newrank := public.territory_rank_for_contrib(v_contrib);
  END IF;

  UPDATE public.profiles
     SET country_contrib = v_contrib, last_expand_at = now(), country_rank = v_newrank
   WHERE id = v_uid;

  RETURN jsonb_build_object('gain', v_gain, 'territory', v_terr, 'area', p_area, 'area_amount', v_area_amt, 'contrib', v_contrib, 'rank', v_newrank);
END;
$function$;

-- ===== 9) 国限定チャット =====
-- 同じ国に所属するプレイヤーだけが読み書きできるチャット。
CREATE TABLE IF NOT EXISTS public.country_chat (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username   text NOT NULL,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_country_chat_country_time
  ON public.country_chat (country_id, created_at DESC);

ALTER TABLE public.country_chat ENABLE ROW LEVEL SECURITY;
-- 読み取り: 自分が今所属している国のメッセージのみ
DROP POLICY IF EXISTS country_chat_select ON public.country_chat;
CREATE POLICY country_chat_select ON public.country_chat
  FOR SELECT USING (
    country_id = (SELECT country_id FROM public.profiles WHERE id = auth.uid())
  );
-- 書き込みは RPC(SECURITY DEFINER)経由のみ。直接INSERTポリシーは作らない。

-- 投稿RPC: サーバ側で country_id / username を確定（クライアント値を信用しない）
CREATE OR REPLACE FUNCTION public.post_country_chat(p_message text)
 RETURNS public.country_chat
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_cid  uuid;
  v_name text;
  v_unaff boolean;
  v_admin boolean;
  v_lock  timestamptz;
  v_msg  text := btrim(coalesce(p_message,''));
  v_row  public.country_chat;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_msg = '' THEN RAISE EXCEPTION 'メッセージを入力してください'; END IF;
  IF char_length(v_msg) > 200 THEN RAISE EXCEPTION 'メッセージは200文字以内です'; END IF;

  SELECT country_id, username, is_admin, territory_locked_until INTO v_cid, v_name, v_admin, v_lock FROM public.profiles WHERE id = v_uid;
  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  IF v_admin IS NOT TRUE AND v_lock IS NOT NULL AND now() < v_lock THEN
    RAISE EXCEPTION '亡命後1週間は領地システムを利用できません（% まで）', to_char(v_lock, 'MM/DD HH24:MI');
  END IF;
  SELECT is_unaffiliated INTO v_unaff FROM public.countries WHERE id = v_cid;
  IF v_unaff IS TRUE THEN RAISE EXCEPTION '非加盟国ではチャットを使えません'; END IF;

  INSERT INTO public.country_chat (country_id, user_id, username, message)
  VALUES (v_cid, v_uid, v_name, v_msg)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- ===== 10) NPC国（建国者なし・領地が時間経過で自動増加）=====
-- ダミー国民の表示用テーブル（実プロフィールではなく表示専用）
CREATE TABLE IF NOT EXISTS public.npc_country_members (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  name       text NOT NULL,
  rank       text NOT NULL,
  class      text,
  power      int  NOT NULL DEFAULT 0,    -- 総合力
  contrib    numeric NOT NULL DEFAULT 0,
  stats      jsonb,                      -- クラス相応のステ配分（将来の戦争/詳細表示用）
  sort       int  NOT NULL DEFAULT 0
);
ALTER TABLE public.npc_country_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS npc_members_select_all ON public.npc_country_members;
CREATE POLICY npc_members_select_all ON public.npc_country_members FOR SELECT USING (true);

-- NPC国の領地を経過時間ぶん自動加算（ページ表示時に呼ぶ。cron不要・サーバnow()基準）
CREATE OR REPLACE FUNCTION public.tick_npc_countries()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  r        record;
  v_elapsed numeric;
  v_gain    numeric;
  v_per     numeric;
  a         int;
BEGIN
  FOR r IN SELECT id, npc_rate, npc_last_tick FROM public.countries WHERE is_npc LOOP
    IF r.npc_rate IS NULL OR r.npc_rate <= 0 THEN CONTINUE; END IF;
    v_elapsed := extract(epoch FROM (now() - coalesce(r.npc_last_tick, now()))) / 3600.0;
    v_gain := floor(r.npc_rate * v_elapsed);
    IF v_gain < 1 THEN CONTINUE; END IF;         -- 1未満は次回に持ち越し（端数を失わない）
    v_per := v_gain / 7.0;                        -- 7エリアへ均等配分
    UPDATE public.countries
       SET territory = territory + v_gain,
           npc_last_tick = coalesce(npc_last_tick, now()) + make_interval(secs => (v_gain / r.npc_rate) * 3600)
     WHERE id = r.id;
    FOR a IN 1..7 LOOP
      INSERT INTO public.country_area_territory (country_id, area_id, amount)
      VALUES (r.id, a, v_per)
      ON CONFLICT (country_id, area_id) DO UPDATE SET amount = country_area_territory.amount + v_per;
    END LOOP;
  END LOOP;
END;
$function$;

-- NPC国「ZONE」を空き大陸に設置（中央 region=5 を優先、無ければ最小の空き）
INSERT INTO public.countries (name, emblem, description, region, is_npc, is_unaffiliated, npc_rate, npc_last_tick, territory)
SELECT 'ZONE', '🦁', '謎多き古き大国。誰が治めているのかは定かではない。', f.region, true, false, 50, now(), 0
FROM (
  SELECT g AS region FROM generate_series(1,9) g
  WHERE g <> 7 AND g NOT IN (SELECT region FROM public.countries WHERE region IS NOT NULL)
  ORDER BY (g <> 5), g LIMIT 1
) f
WHERE NOT EXISTS (SELECT 1 FROM public.countries WHERE name IN ('ZONE','Zoon'));
-- 旧名Zoonがあれば改名
UPDATE public.countries SET name = 'ZONE' WHERE name = 'Zoon';

-- ZONE のダミー国民（全員 総合力10000・クラス相応のステ配分）
INSERT INTO public.npc_country_members (country_id, name, rank, class, power, contrib, stats, sort)
SELECT z.id, v.name, v.rank, v.class, 10000, v.contrib, v.stats, v.sort
FROM (SELECT id FROM public.countries WHERE name = 'ZONE' AND is_npc LIMIT 1) z,
(VALUES
  ('りおん','元帥','魔銃士',   6000, '{"hp":4000,"mp":2500,"atk":800,"def":800,"matk":5400,"mdef":1200,"spd":1800}'::jsonb, 1),
  ('れいし','副元帥','賢者',   4000, '{"hp":4000,"mp":4000,"atk":300,"def":900,"matk":4200,"mdef":2200,"spd":1200}'::jsonb, 2),
  ('くさりひめ','参謀','元素使い',3000,'{"hp":3500,"mp":3000,"atk":400,"def":900,"matk":5000,"mdef":1550,"spd":1200}'::jsonb, 3),
  ('がが','大将','死霊使い',   2000, '{"hp":4000,"mp":3500,"atk":300,"def":900,"matk":4800,"mdef":1700,"spd":1200}'::jsonb, 4),
  ('とま','大将','体術師',     2000, '{"hp":5000,"mp":1000,"atk":4200,"def":1600,"matk":200,"mdef":1300,"spd":2000}'::jsonb, 5),
  ('えちゅ','大将','暗殺者',    2000, '{"hp":3500,"mp":1000,"atk":4500,"def":1000,"matk":200,"mdef":1200,"spd":2550}'::jsonb, 6)
) AS v(name, rank, class, contrib, stats, sort)
WHERE EXISTS (SELECT 1 FROM public.countries WHERE name = 'ZONE' AND is_npc)
  AND NOT EXISTS (SELECT 1 FROM public.npc_country_members nm
                  JOIN public.countries c ON c.id = nm.country_id WHERE c.name = 'ZONE');

GRANT EXECUTE ON FUNCTION public.found_country(text, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seek_asylum(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.appoint_rank(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_country_desc(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.expand_territory(numeric, int)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_country_chat(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.tick_npc_countries()           TO authenticated;
