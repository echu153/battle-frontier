-- ============================================================
-- 戦争: 開戦時刻のJST補正 ＋ 開戦/終戦の自動化(pg_cron)
--   ※ supabase_war_m1.sql の後に適用。declare_war を JST補正版で置き換え、
--     war_tick を毎分cronで実行（誰もログインしていなくても開戦/終戦する）。
-- ============================================================

-- 1) declare_war: 開戦＝布告の3日後の「22時(JST)」。now()はUTCなので Asia/Tokyo で計算して戻す。
CREATE OR REPLACE FUNCTION public.declare_war(p_target_country uuid, p_test boolean DEFAULT false)
 RETURNS public.wars
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cid uuid; v_rank text; v_admin boolean;
  v_my_created timestamptz; v_tg_created timestamptz; v_tg_unaff boolean;
  v_starts timestamptz; v_war public.wars;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT p.country_id, p.country_rank, p.is_admin INTO v_cid, v_rank, v_admin
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;  -- 先行ゲート(公開で解除)
  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  IF v_rank IS DISTINCT FROM '元帥' THEN RAISE EXCEPTION '宣戦布告は元帥のみ可能です'; END IF;
  IF p_target_country IS NULL OR p_target_country = v_cid THEN RAISE EXCEPTION '対象の国が不正です'; END IF;

  SELECT is_unaffiliated, created_at INTO v_tg_unaff, v_tg_created
    FROM public.countries WHERE id = p_target_country;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の国が存在しません'; END IF;
  IF v_tg_unaff IS TRUE THEN RAISE EXCEPTION '非加盟国には宣戦布告できません'; END IF;

  SELECT created_at INTO v_my_created FROM public.countries WHERE id = v_cid;
  IF v_admin IS NOT TRUE THEN
    IF now() < v_my_created + interval '7 days' THEN RAISE EXCEPTION '建国から1週間は宣戦布告できません'; END IF;
    IF now() < v_tg_created + interval '7 days' THEN RAISE EXCEPTION 'その国は建国から1週間 経っていません'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.wars w
             WHERE w.status IN ('declared','active','resolving')
               AND (v_cid IN (w.attacker_country_id, w.defender_country_id)
                 OR p_target_country IN (w.attacker_country_id, w.defender_country_id))) THEN
    RAISE EXCEPTION '進行中の戦争があります（1国につき同時に1戦争まで）';
  END IF;

  -- 開戦時刻: 通常=布告の3日後22時(JST) / テスト(adminのみ)=即時
  IF p_test IS TRUE THEN
    v_starts := now();
  ELSE
    -- JSTの壁時計で「3日後の22:00」を作り、UTCの瞬間へ戻す
    v_starts := (date_trunc('day', (now() AT TIME ZONE 'Asia/Tokyo') + interval '3 days') + interval '22 hours')
                  AT TIME ZONE 'Asia/Tokyo';
  END IF;

  INSERT INTO public.wars (attacker_country_id, defender_country_id, starts_at, ends_at, status)
  VALUES (v_cid, p_target_country, v_starts, v_starts + interval '1 hour', 'declared')
  RETURNING * INTO v_war;
  RETURN v_war;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.declare_war(uuid, boolean) TO authenticated;

-- 2) 開戦/終戦の自動化: war_tick を毎分実行（declared→active の開戦seed・瀕死復活・active→決着）。
--    誰もログインしていなくても定刻に開戦/終戦する。同名ジョブは置き換え。
SELECT cron.schedule('war_tick', '* * * * *', $$ SELECT public.war_tick(); $$);
