-- ============================================================
-- 領地（国・建国）システム  Phase 1  ※is_admin限定で先行公開
-- ------------------------------------------------------------
-- ・9カ国構成（うち1つは固定の「非加盟国」＝どこにも属さないプレイヤーの居場所）。
--   残り最大8カ国はプレイヤーが空き枠がある限り自由に建国できる。
-- ・建国条件: キャラクターLV(char_lv) 500以上 ＆ 非加盟国に居ること。
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
  region          int,                               -- 地図上の領域(1〜9)。1領域=1国。非加盟国は中央(5)固定。
  founder_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  territory       numeric NOT NULL DEFAULT 0,        -- 領地の広さ（拡大の累積）
  core_hp         int NOT NULL DEFAULT 1000000,      -- 将来の戦争用（コアHP）
  is_unaffiliated boolean NOT NULL DEFAULT false,    -- 非加盟国フラグ（1つだけ）
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- 既に旧バージョンを適用済みでも region 列を追加
ALTER TABLE public.countries ADD COLUMN IF NOT EXISTS region int;

-- 非加盟国は1つだけ
CREATE UNIQUE INDEX IF NOT EXISTS uniq_unaffiliated_country
  ON public.countries (is_unaffiliated) WHERE is_unaffiliated;
-- 1領域=1国（地図 ryouti.png の9大陸。region 1〜9 が各大陸に対応）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_country_region
  ON public.countries (region) WHERE region IS NOT NULL;

-- 非加盟国を1つだけ生成（存在しなければ）。中央の大陸 region=5 に配置。
INSERT INTO public.countries (name, emblem, description, region, is_unaffiliated)
SELECT '非加盟国', '🏳', 'どの国にも属さない者たちが暮らす中立の地。ここから新たな国を建てることができる。', 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.countries WHERE is_unaffiliated);
-- 旧データ救済: 非加盟国に region が無ければ中央(5)を割り当て
UPDATE public.countries SET region = 5 WHERE is_unaffiliated AND region IS NULL;

-- ===== 2) profiles 列追加 =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_id      uuid REFERENCES public.countries(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_rank    text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_contrib numeric NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_asylum_at  timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_expand_at  timestamptz;
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
  v_name    text := btrim(coalesce(p_name,''));
  v_new     public.countries;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION '国名を入力してください'; END IF;
  IF char_length(v_name) > 20 THEN RAISE EXCEPTION '国名は20文字以内にしてください'; END IF;

  -- 領域(大陸)の指定チェック
  IF p_region IS NULL OR p_region < 1 OR p_region > 9 THEN
    RAISE EXCEPTION '建国する大陸を選択してください';
  END IF;
  IF p_region = 5 THEN
    RAISE EXCEPTION '中央の大陸は非加盟国の領域です';
  END IF;
  SELECT true INTO v_taken FROM public.countries WHERE region = p_region;
  IF v_taken IS TRUE THEN
    RAISE EXCEPTION 'その大陸には既に国があります';
  END IF;

  SELECT char_lv, country_id INTO v_charlv, v_cid FROM public.profiles WHERE id = v_uid;
  IF v_charlv IS NULL OR v_charlv < 500 THEN
    RAISE EXCEPTION '建国にはキャラクターLV500以上が必要です';
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
  v_last   timestamptz;
  v_exists boolean;
  v_me     public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT country_id, country_rank, last_asylum_at INTO v_cid, v_rank, v_last
    FROM public.profiles WHERE id = v_uid;

  SELECT true INTO v_exists FROM public.countries WHERE id = p_country_id;
  IF v_exists IS NOT TRUE THEN RAISE EXCEPTION '対象の国が存在しません'; END IF;

  IF v_cid IS NOT DISTINCT FROM p_country_id THEN
    RAISE EXCEPTION '既にその国に所属しています';
  END IF;

  -- 元帥は自国を放棄して亡命できない（国の喪失を防ぐ。将来の遷都/譲位で対応）
  IF v_rank = '元帥' THEN
    RAISE EXCEPTION '元帥は亡命できません';
  END IF;

  IF v_last IS NOT NULL AND now() - v_last < interval '7 days' THEN
    RAISE EXCEPTION '亡命は1週間に1回までです（次回 % まで）', to_char(v_last + interval '7 days', 'MM/DD HH24:MI');
  END IF;

  UPDATE public.profiles
     SET country_id = p_country_id, country_rank = '二等兵', country_contrib = 0, last_asylum_at = now()
   WHERE id = v_uid
  RETURNING * INTO v_me;

  RETURN v_me;
END;
$function$;

-- ===== 7) 領地拡大（1時間に1回・総合力依存）=====
-- p_power = クライアントが計算した総合力。先行公開(is_admin限定)のため簡易採用。
-- クールダウン(1h)はサーバ側で厳密判定。獲得量は power を上限クランプして算出。
CREATE OR REPLACE FUNCTION public.expand_territory(p_power numeric)
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
  v_power   numeric := least(greatest(coalesce(p_power,0),0), 100000);
  v_gain    numeric;
  v_terr    numeric;
  v_newrank text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT country_id, last_expand_at, country_contrib, country_rank
    INTO v_cid, v_last, v_contrib, v_rank
    FROM public.profiles WHERE id = v_uid;

  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  SELECT is_unaffiliated INTO v_unaff FROM public.countries WHERE id = v_cid;
  IF v_unaff IS TRUE THEN RAISE EXCEPTION '非加盟国では領地を広げられません'; END IF;

  IF v_last IS NOT NULL AND now() - v_last < interval '1 hour' THEN
    RAISE EXCEPTION '領地拡大は1時間に1回までです';
  END IF;

  -- 獲得量: 基礎10 + 総合力/20（総合力2万で約1010、上限クランプ済み）
  v_gain := floor(10 + v_power / 20.0);

  UPDATE public.countries SET territory = territory + v_gain WHERE id = v_cid
  RETURNING territory INTO v_terr;

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

  RETURN jsonb_build_object('gain', v_gain, 'territory', v_terr, 'contrib', v_contrib, 'rank', v_newrank);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.found_country(text, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seek_asylum(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.expand_territory(numeric)      TO authenticated;
