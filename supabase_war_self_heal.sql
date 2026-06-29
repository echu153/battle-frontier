-- ============================================================
-- 戦争: 自己全回復コマンド（war_self_heal / is_admin先行）
--   戦争中、参加者1人につき1回だけ・いつでも（瀕死中/低HP問わず）発動して全快する。
--   両国全員が対象（完全対称）。HP/MPを戦争上限(実効最大HP+10000 / 実効最大MP)まで回復し、
--   瀕死なら復帰する。war_participants.self_heal_used で1戦争1回を保証。
--   ※ supabase_war_m1/m2/m2_attack/self_buff の後に適用。
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_self_heal(p_war_id uuid, p_eff_hp_max int)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_war public.wars;
  v_p public.war_participants;
  v_eff int; v_warmax int; v_mpmax int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT is_admin, mp_max INTO v_admin, v_mpmax FROM public.profiles WHERE id = v_uid;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;  -- 先行ゲート(公開時に解除)

  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id;
  IF NOT FOUND OR v_war.status <> 'active' THEN RAISE EXCEPTION '戦争中ではありません'; END IF;

  SELECT * INTO v_p FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'あなたは参加者として登録されていません'; END IF;
  IF v_p.self_heal_used THEN RAISE EXCEPTION '自己回復は1戦争に1回までです'; END IF;

  v_eff := greatest(1, coalesce(p_eff_hp_max, v_p.hp_max));   -- 実効最大HP(装備込み)
  v_warmax := v_eff + 10000;                                  -- 戦争HP上限(=全快値)

  -- 参加者: 使用済みフラグ＋瀕死復帰＋HP満タン（hp_maxも実効値へ更新）
  UPDATE public.war_participants
     SET self_heal_used = true, status = 'active', dying_until = NULL,
         hp = v_warmax, hp_max = v_eff
   WHERE war_id = p_war_id AND player_id = v_uid;

  -- 街と共有の現在HP/MPを全快（瀕死解除）
  UPDATE public.profiles
     SET hp_current = v_warmax, mp_current = coalesce(v_mpmax, mp_current), is_dying = false
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'hp', v_warmax, 'war_max', v_warmax);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.war_self_heal(uuid, int) TO authenticated;
