-- ============================================================
-- 戦争 満タン参戦RPC（war_self_buff / is_admin先行）
--   開戦中(active)の参加者が、自分の「実効最大HP(装備込み)」を申告して
--   1戦争1回だけ満タン参戦する。サーバー権威・冪等(loadout.buffedマーカー)。
--   ・war_participants.hp_max を実効値へ自己上書き（ロスター表示を正しく）
--   ・war_participants.hp と profiles.hp_current を 実効最大+10000（戦争上限）へ
--   ・loadout = {"buffed":true} を立てて以後の再ヒールを防止（リロード/別端末でも一度きり）
-- 前提: supabase_war_m1/m2/m2_attack 適用済み。クライアント(Game/WarPanel)が
--       active戦争を検知したら p_eff_hp_max=実効最大HP を渡して呼ぶ。
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_self_buff(p_war_id uuid, p_eff_hp_max int)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_war public.wars;
  v_p public.war_participants;
  v_eff int; v_warmax int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id;
  IF NOT FOUND OR v_war.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  SELECT * INTO v_p FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_participant');
  END IF;

  -- 既に満タン参戦済みなら何もしない（冪等）
  IF coalesce(v_p.loadout->>'buffed', '') = 'true' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'hp_max', v_p.hp_max);
  END IF;

  v_eff := greatest(1, coalesce(p_eff_hp_max, v_p.hp_max));   -- 実効最大HP(装備込み)
  v_warmax := v_eff + 10000;                                  -- 戦争上限(=満タン値)

  UPDATE public.war_participants
     SET hp_max = v_eff, hp = v_warmax, loadout = jsonb_build_object('buffed', true)
   WHERE war_id = p_war_id AND player_id = v_uid;

  -- 街と共有の現在HPを満タンへ（既に上限以上なら据え置き）。瀕死も解除。
  UPDATE public.profiles
     SET hp_current = v_warmax, is_dying = false
   WHERE id = v_uid AND coalesce(hp_current, 0) < v_warmax;

  RETURN jsonb_build_object('ok', true, 'hp_max', v_eff, 'war_max', v_warmax);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.war_self_buff(uuid, int) TO authenticated;
