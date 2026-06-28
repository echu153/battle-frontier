-- ============================================================
-- 戦争システム M2-2（相互戦闘 war_attack・瀕死復活 / is_admin先行）
--   ★HP/MP共有版: 実プレイヤーの戦争HP/MPは profiles.hp_current/mp_current を
--     直接使う（街と完全共有・自然回復もそのまま反映）。+20000バッファは廃止。
--     NPCダミー(実profilesなし)のみ war_participants.hp/mp を使う。
-- ------------------------------------------------------------
-- 前提: supabase_war_m1.sql / supabase_war_m2.sql 適用済み。
--   ※以前の war_attack(8引数)版を置き換える（引数が増えたので DROP してから作成）。
-- ============================================================

-- 1) war_tick: 開戦seed＋瀕死復活＋締め
--    瀕死復活: dummyは全快/realはフラグ解除のみ(HPは自然回復doRegenが回復)。
CREATE OR REPLACE FUNCTION public.war_tick()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, attacker_country_id, defender_country_id
             FROM public.wars WHERE status='declared' AND starts_at <= now() FOR UPDATE LOOP
    UPDATE public.wars SET status='active', attacker_core_hp=300000, defender_core_hp=300000 WHERE id = r.id;
    -- 実国民を seed（HPは profiles を使うので war_participants.hp は表示フォールバック用の概算）
    INSERT INTO public.war_participants
      (war_id, player_id, country_id, hp, mp, hp_max, mp_max, loadout, status, is_dummy)
    SELECT r.id, p.id, p.country_id,
           coalesce(p.hp_current, p.hp_max), coalesce(p.mp_current, p.mp_max),
           p.hp_max, p.mp_max, NULL, 'active', false
    FROM public.profiles p
    WHERE p.country_id IN (r.attacker_country_id, r.defender_country_id)
    ON CONFLICT (war_id, player_id) DO NOTHING;
  END LOOP;

  -- 瀕死復活(dummy): 全快して復帰
  UPDATE public.war_participants SET status='active', hp=hp_max, mp=mp_max, dying_until=NULL
   WHERE status='dying' AND dying_until IS NOT NULL AND dying_until <= now() AND is_dummy = true;
  -- 瀕死復活(real): 瀕死フラグのみ解除（HP/MPは自然回復に委ねる）
  UPDATE public.profiles p SET is_dying = false
    FROM public.war_participants wp
   WHERE wp.player_id = p.id AND wp.status='dying' AND wp.dying_until IS NOT NULL
     AND wp.dying_until <= now() AND wp.is_dummy = false;
  UPDATE public.war_participants SET status='active', dying_until=NULL
   WHERE status='dying' AND dying_until IS NOT NULL AND dying_until <= now() AND is_dummy = false;

  FOR r IN SELECT id FROM public.wars WHERE status='active' AND ends_at <= now() FOR UPDATE LOOP
    PERFORM public._war_resolve(r.id);
  END LOOP;
END;
$function$;

-- 2) war_attack: 敵参加者へ交戦。
--    攻撃側(=自分・実プレイヤー)は profiles.hp_current/mp_current を更新（街と共有）。
--    対象がdummyなら war_participants、realなら profiles を更新。HP0で瀕死(5分)。
DROP FUNCTION IF EXISTS public.war_attack(uuid, uuid, int, int, int, int, int, int);
CREATE OR REPLACE FUNCTION public.war_attack(
    p_war_id uuid, p_target uuid,
    p_atk_end_hp int, p_atk_end_mp int,
    p_tgt_end_hp int, p_tgt_end_mp int,
    p_atk_hp_max int, p_atk_mp_max int,
    p_tgt_hp_max int DEFAULT NULL, p_tgt_mp_max int DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cid uuid; v_admin boolean;
  v_war public.wars;
  v_enemy uuid;
  v_atk public.war_participants;
  v_tgt public.war_participants;
  v_atk_hp int; v_atk_mp int; v_tgt_hp int; v_tgt_mp int;
  v_tgt_max int; v_tgt_mmax int;
  v_atk_dying boolean; v_tgt_dying boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT country_id, is_admin INTO v_cid, v_admin FROM public.profiles WHERE id = v_uid;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;

  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id;
  IF NOT FOUND THEN RAISE EXCEPTION '戦争が存在しません'; END IF;
  IF v_war.status <> 'active' THEN RAISE EXCEPTION '戦争中ではありません'; END IF;

  IF v_cid = v_war.attacker_country_id THEN v_enemy := v_war.defender_country_id;
  ELSIF v_cid = v_war.defender_country_id THEN v_enemy := v_war.attacker_country_id;
  ELSE RAISE EXCEPTION 'この戦争の参加国ではありません'; END IF;

  SELECT * INTO v_atk FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'あなたは参加者として登録されていません'; END IF;
  IF v_atk.status = 'dying' AND v_atk.dying_until > now() THEN RAISE EXCEPTION 'あなたは瀕死中です'; END IF;
  IF v_atk.last_attack_at IS NOT NULL AND v_atk.last_attack_at > now() - interval '20 seconds' THEN
    RAISE EXCEPTION '攻撃のクールダウン中です';
  END IF;

  SELECT * INTO v_tgt FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象が存在しません'; END IF;
  IF v_tgt.country_id <> v_enemy THEN RAISE EXCEPTION '対象は敵国の参加者ではありません'; END IF;
  IF v_tgt.status = 'dying' AND v_tgt.dying_until > now() THEN RAISE EXCEPTION '対象は瀕死中です'; END IF;

  -- 攻撃側（実プレイヤー）→ profiles.hp_current/mp_current（街と共有）
  v_atk_hp := greatest(0, least(coalesce(p_atk_end_hp, 0), greatest(1, coalesce(p_atk_hp_max, 1))));
  v_atk_mp := greatest(0, least(coalesce(p_atk_end_mp, 0), greatest(0, coalesce(p_atk_mp_max, 0))));
  v_atk_dying := v_atk_hp <= 0;
  UPDATE public.profiles SET
      hp_current = v_atk_hp, mp_current = v_atk_mp,
      is_dying = CASE WHEN v_atk_dying THEN true ELSE is_dying END
    WHERE id = v_uid;
  UPDATE public.war_participants SET
      status = CASE WHEN v_atk_dying THEN 'dying' ELSE 'active' END,
      dying_until = CASE WHEN v_atk_dying THEN now() + interval '5 minutes' ELSE NULL END,
      last_attack_at = now()
    WHERE war_id = p_war_id AND player_id = v_uid;

  -- 対象
  IF v_tgt.is_dummy THEN
    v_tgt_hp := greatest(0, least(coalesce(p_tgt_end_hp, 0), v_tgt.hp_max));
    v_tgt_mp := greatest(0, least(coalesce(p_tgt_end_mp, 0), greatest(0, v_tgt.mp_max)));
    v_tgt_dying := v_tgt_hp <= 0;
    UPDATE public.war_participants SET
        hp = v_tgt_hp, mp = v_tgt_mp,
        status = CASE WHEN v_tgt_dying THEN 'dying' ELSE 'active' END,
        dying_until = CASE WHEN v_tgt_dying THEN now() + interval '5 minutes' ELSE NULL END
      WHERE war_id = p_war_id AND player_id = p_target;
  ELSE
    v_tgt_max  := greatest(1, coalesce(p_tgt_hp_max, 1));
    v_tgt_mmax := greatest(0, coalesce(p_tgt_mp_max, 0));
    v_tgt_hp := greatest(0, least(coalesce(p_tgt_end_hp, 0), v_tgt_max));
    v_tgt_mp := greatest(0, least(coalesce(p_tgt_end_mp, 0), v_tgt_mmax));
    v_tgt_dying := v_tgt_hp <= 0;
    UPDATE public.profiles SET
        hp_current = v_tgt_hp, mp_current = v_tgt_mp,
        is_dying = CASE WHEN v_tgt_dying THEN true ELSE is_dying END
      WHERE id = p_target;
    UPDATE public.war_participants SET
        status = CASE WHEN v_tgt_dying THEN 'dying' ELSE 'active' END,
        dying_until = CASE WHEN v_tgt_dying THEN now() + interval '5 minutes' ELSE NULL END
      WHERE war_id = p_war_id AND player_id = p_target;
  END IF;

  RETURN jsonb_build_object(
    'atk_hp', v_atk_hp, 'atk_mp', v_atk_mp, 'atk_dying', v_atk_dying,
    'tgt_hp', v_tgt_hp, 'tgt_mp', v_tgt_mp, 'tgt_dying', v_tgt_dying);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.war_attack(uuid, uuid, int, int, int, int, int, int, int, int) TO authenticated;
