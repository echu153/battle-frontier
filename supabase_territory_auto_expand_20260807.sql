-- ============================================================
-- 領地：補助金の自動受け取り／領地拡大の「自動モード」  2026-08-07
-- ------------------------------------------------------------
-- ・拡大方法をプレイヤーが選べるようにする（変更は7日に1回）。
--     'manual'（既定）… 従来どおり領地ページのボタンで満額拡大（1時間に1回）
--     'auto'          … ホーム画面を開いている間、拡大CD明けに選択エリアを自動拡大
--                       獲得量は手動の10分の1（最低1）。CDは手動と共有＝二重取り不可。
-- ・自動拡大の対象エリアは profiles.expand_area に保存（領地ページのエリア選択で更新）。
-- ・本日の補助金（claim_country_subsidy）はクライアントがホーム表示時に自動で呼ぶ。
--   → 補助金側のSQL変更は不要（このファイルでは触らない）。
--
-- ★ protect_stats.sql の保護列（stat_point_spent/lv/exp 等）は一切変更しないため、
--   app.allow_stat_change は不要（新規列と既存の領地列のみ更新）。
-- ★ 適用順の鉄則は従来どおり: supabase_mutant_gold_20260703.sql を常に「最後」に流すこと。
--   （このファイルは apply_battle_result / apply_dungeon_reward を一切定義しないため影響なし）
-- ============================================================

-- ===== 1) profiles 列追加 =====
-- 拡大方法。'manual' | 'auto'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expand_mode text NOT NULL DEFAULT 'manual';
-- 最後に拡大方法を変更した時刻（7日CDの基準。NULL=一度も変更していない＝すぐ変更できる）
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expand_mode_changed_at timestamptz;
-- 自動拡大の対象エリア（1〜8。NULLならエリア①として扱う）
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expand_area int;

-- ===== 2) 拡大方法の直接書き換えガード =====
-- expand_mode / expand_mode_changed_at はクライアントから直接UPDATEできてはいけない
-- （7日に1回の制限をすり抜けられるため）。変更は set_expand_mode() だけに許可する。
-- ※ protect_profile_stats と同じ形（SECURITY DEFINERにしない素のトリガー関数）。
CREATE OR REPLACE FUNCTION public.guard_expand_mode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_expand_mode', true) IS DISTINCT FROM 'on' THEN
    IF NEW.expand_mode IS DISTINCT FROM OLD.expand_mode
       OR NEW.expand_mode_changed_at IS DISTINCT FROM OLD.expand_mode_changed_at THEN
      RAISE EXCEPTION '拡大方法の変更は set_expand_mode() から行ってください';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_expand_mode ON public.profiles;
CREATE TRIGGER trg_guard_expand_mode
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_expand_mode();

-- ===== 3) 拡大方法の変更（7日に1回・is_adminは免除）=====
CREATE OR REPLACE FUNCTION public.set_expand_mode(p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_cur   text;
  v_at    timestamptz;
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('manual','auto') THEN
    RAISE EXCEPTION '拡大方法は manual / auto のどちらかです';
  END IF;

  -- ★FOR UPDATE で自分の行を排他ロック＝連打で7日CDをすり抜けるのを防ぐ
  SELECT coalesce(expand_mode,'manual'), expand_mode_changed_at, is_admin
    INTO v_cur, v_at, v_admin
    FROM public.profiles WHERE id = v_uid FOR UPDATE;

  -- 同じモードへの変更はCDを消費しない（UIの取りこぼし対策）
  IF v_cur = p_mode THEN
    RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'unchanged', true,
                              'next_at', CASE WHEN v_at IS NULL THEN NULL ELSE v_at + interval '7 days' END);
  END IF;

  IF v_admin IS NOT TRUE AND v_at IS NOT NULL AND now() - v_at < interval '7 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown', 'next_at', v_at + interval '7 days');
  END IF;

  PERFORM set_config('app.allow_expand_mode','on',true);  -- ★ガードトリガー許可
  UPDATE public.profiles
     SET expand_mode = p_mode, expand_mode_changed_at = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'next_at', now() + interval '7 days');
END;
$function$;

-- ===== 4) 自動拡大の対象エリアを保存 =====
-- 解放済みエリアのみ。いつでも変更できる（7日CDの対象は拡大方法だけ）。
CREATE OR REPLACE FUNCTION public.set_expand_area(p_area int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_unlocked int[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_area IS NULL OR p_area < 1 OR p_area > 8 THEN
    RAISE EXCEPTION 'エリアの指定が不正です';
  END IF;

  SELECT unlocked_areas INTO v_unlocked FROM public.profiles WHERE id = v_uid;
  IF NOT (p_area = ANY(coalesce(v_unlocked, ARRAY[1]))) THEN
    RAISE EXCEPTION 'そのエリアはまだ解放されていません';
  END IF;

  UPDATE public.profiles SET expand_area = p_area WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true, 'area', p_area);
END;
$function$;

-- ===== 5) 自動領地拡大（1/10効率・拡大CDは手動と共有）=====
-- p_power = クライアントが計算した総合力（expand_territory と同じ扱い）。
-- ホーム画面から定期的に呼ばれるため、CD中などの通常ケースは例外ではなく ok:false を返す。
CREATE OR REPLACE FUNCTION public.auto_expand_territory(p_power numeric)
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
  v_mode    text;
  v_area    int;
  v_power   numeric := least(greatest(coalesce(p_power,0),0), 100000);
  v_gain    numeric;
  v_terr    numeric;
  v_area_amt numeric;
  v_newrank text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  -- ★FOR UPDATE で自分の行を排他ロック＝同一プレイヤーの多重発火（複数タブ等）を直列化
  SELECT country_id, last_expand_at, country_contrib, country_rank, unlocked_areas,
         is_admin, territory_locked_until, coalesce(expand_mode,'manual'), expand_area
    INTO v_cid, v_last, v_contrib, v_rank, v_unlocked, v_admin, v_lock, v_mode, v_area
    FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_mode <> 'auto' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_auto');
  END IF;
  IF v_cid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_country'); END IF;
  SELECT is_unaffiliated INTO v_unaff FROM public.countries WHERE id = v_cid;
  IF v_unaff IS TRUE THEN RETURN jsonb_build_object('ok', false, 'reason', 'unaffiliated'); END IF;

  -- 所属国を移った直後ロック中は拡大不可（is_adminは除外。手動と同じ扱い）
  IF v_admin IS NOT TRUE AND v_lock IS NOT NULL AND now() < v_lock THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'asylum_locked', 'until', v_lock);
  END IF;

  -- 未設定ならエリア①。解放外になっていたら解放済みの最小エリアへ落とす。
  v_area := coalesce(v_area, 1);
  IF NOT (v_area = ANY(coalesce(v_unlocked, ARRAY[1]))) THEN
    SELECT min(a) INTO v_area FROM unnest(coalesce(v_unlocked, ARRAY[1])) AS a;
  END IF;
  IF v_area IS NULL OR v_area < 1 OR v_area > 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_area');
  END IF;

  -- 拡大クールダウンは手動(expand_territory)と共有。自動と手動の二重取りはできない。
  IF v_last IS NOT NULL AND now() - v_last < interval '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown', 'next_at', v_last + interval '1 hour');
  END IF;

  -- 獲得量: 手動と同じ式の10分の1（最低1）。乱数0.9〜1.1倍も手動と同じ。
  v_gain := greatest(1, floor((10 + v_power / 20.0) * (0.9 + random() * 0.2) / 10.0));

  UPDATE public.countries SET territory = territory + v_gain WHERE id = v_cid
  RETURNING territory INTO v_terr;

  INSERT INTO public.country_area_territory (country_id, area_id, amount)
  VALUES (v_cid, v_area, v_gain)
  ON CONFLICT (country_id, area_id) DO UPDATE SET amount = country_area_territory.amount + v_gain
  RETURNING amount INTO v_area_amt;

  v_contrib := coalesce(v_contrib,0) + v_gain;

  -- 階級自動更新（元帥/副元帥/参謀は据え置き）
  IF v_rank IN ('元帥','副元帥','参謀') THEN
    v_newrank := v_rank;
  ELSE
    v_newrank := public.territory_rank_for_contrib(v_contrib);
  END IF;

  UPDATE public.profiles
     SET country_contrib = v_contrib, last_expand_at = now(), country_rank = v_newrank, expand_area = v_area
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'gain', v_gain, 'territory', v_terr, 'area', v_area,
                            'area_amount', v_area_amt, 'contrib', v_contrib, 'rank', v_newrank);
END;
$function$;

-- ===== 6) 権限 =====
REVOKE ALL ON FUNCTION public.set_expand_mode(text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expand_area(int)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_expand_territory(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_expand_mode(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_expand_area(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_expand_territory(numeric) TO authenticated;
