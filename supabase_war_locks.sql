-- ============================================================
-- 戦争: 準備フェーズの非対称ロック（亡命ロック＋ステ振りリセットロック）
--   ※ supabase_territory.sql / supabase_protect_stats.sql / supabase_war_m1.sql の後に適用。
--   既存の seek_asylum / reset_stat_points を「戦争ロックを足した版」で置き換える。
--
-- ・亡命ロック: 自国が戦争(布告1日経過〜終戦)に関与している間は亡命不可（逃げ得防止）。
--     布告から1日は猶予（戦いたくない人は離脱可）→以降は終戦まで不可。
-- ・ステ振りリセット(記憶除去)ロック: 布告側=布告時から / 被布告側=開戦1日前から、終戦まで不可。
--     被布告側は「布告〜開戦1日前」にビルド最適化できる＝受けた側がやや有利。
-- ============================================================

-- 1) seek_asylum（亡命ロック追加）
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

  IF v_rank = '元帥' THEN
    RAISE EXCEPTION '元帥は亡命できません';
  END IF;

  -- ★戦争中の逃げ得防止: 自国が戦争(布告1日経過〜終戦)に関与中は亡命不可
  IF v_cid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wars w
     WHERE w.status IN ('declared','active','resolving')
       AND v_cid IN (w.attacker_country_id, w.defender_country_id)
       AND now() >= w.created_at + interval '1 day'
  ) THEN
    RAISE EXCEPTION '戦争中は亡命できません（布告から1日以降は終戦まで不可）';
  END IF;

  -- 現在地が非加盟国(または無所属)かどうか
  IF v_cid IS NULL THEN
    v_from_unaff := true;
  ELSE
    SELECT is_unaffiliated INTO v_from_unaff FROM public.countries WHERE id = v_cid;
    v_from_unaff := coalesce(v_from_unaff, true);
  END IF;

  UPDATE public.profiles
     SET country_id = p_country_id, country_rank = '二等兵', country_contrib = 0,
         last_asylum_at = now(),
         territory_locked_until = CASE WHEN v_from_unaff THEN NULL ELSE now() + interval '3 days' END
   WHERE id = v_uid
  RETURNING * INTO v_me;

  RETURN v_me;
END;
$function$;

-- 2) reset_stat_points（ステ振りリセットロック追加）
CREATE OR REPLACE FUNCTION public.reset_stat_points()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_spent jsonb;
  v_total int;
  v_new_pending int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★戦争ロック: 布告側=布告時から / 被布告側=開戦1日前から、終戦まで振り直し不可
  IF v_profile.country_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wars w
     WHERE w.status IN ('declared','active','resolving')
       AND (
         (w.attacker_country_id = v_profile.country_id AND now() >= w.created_at)
         OR (w.defender_country_id = v_profile.country_id AND now() >= w.starts_at - interval '1 day')
       )
  ) THEN
    RETURN json_build_object('ok',false,'reason','war_locked');
  END IF;

  v_spent := COALESCE(v_profile.stat_point_spent, '{}'::jsonb);
  v_total := COALESCE((v_spent->>'hp')::int,0)+COALESCE((v_spent->>'mp')::int,0)
           + COALESCE((v_spent->>'atk')::int,0)+COALESCE((v_spent->>'def')::int,0)
           + COALESCE((v_spent->>'matk')::int,0)+COALESCE((v_spent->>'mdef')::int,0)
           + COALESCE((v_spent->>'spd')::int,0);
  v_new_pending := COALESCE(v_profile.pending_stat_points,0) + v_total;

  PERFORM set_config('app.allow_stat_change','on',true);
  UPDATE profiles SET
    stat_point_spent = '{}'::jsonb,
    pending_stat_points = v_new_pending
  WHERE id = v_uid;

  RETURN json_build_object('ok',true,'pending_stat_points',v_new_pending);
END;
$function$;
