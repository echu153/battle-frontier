-- ============================================================
-- 戦争: コア攻撃も対戦履歴(war_battle_log)へ記録する
--   ※ supabase_war_history_regen.sql（war_battle_log作成）の後に適用。
--   is_core 列を追加し、war_attack_core から「コア攻撃」行をINSERTする。
-- ============================================================

ALTER TABLE public.war_battle_log ADD COLUMN IF NOT EXISTS is_core boolean DEFAULT false;

-- war_attack_core: 敵コアへダメージ（全員瀕死時のみ）。適用ダメージを is_core=true で履歴記録。
CREATE OR REPLACE FUNCTION public.war_attack_core(p_war_id uuid, p_raw_damage int)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cid uuid; v_admin boolean;
  v_war public.wars;
  v_enemy uuid; v_is_attacker boolean;
  v_enemy_defenders int; v_dmg int; v_new_hp int;
  v_atk_name text; v_enemy_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT country_id, is_admin, username INTO v_cid, v_admin, v_atk_name FROM public.profiles WHERE id = v_uid;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;

  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '戦争が存在しません'; END IF;
  IF v_war.status <> 'active' THEN RAISE EXCEPTION '戦争中ではありません'; END IF;

  IF v_cid = v_war.attacker_country_id THEN v_is_attacker := true;  v_enemy := v_war.defender_country_id;
  ELSIF v_cid = v_war.defender_country_id THEN v_is_attacker := false; v_enemy := v_war.attacker_country_id;
  ELSE RAISE EXCEPTION 'この戦争の参加国ではありません'; END IF;

  SELECT count(*) INTO v_enemy_defenders FROM public.war_participants wp
   WHERE wp.war_id = p_war_id AND wp.country_id = v_enemy
     AND NOT (wp.status = 'dying' AND wp.dying_until > now());
  IF v_enemy_defenders > 0 THEN RAISE EXCEPTION '敵国民が全員瀕死ではありません'; END IF;

  v_dmg := greatest(1, floor(least(greatest(coalesce(p_raw_damage,0),0), 1000000) * 0.1));

  IF v_is_attacker THEN
    UPDATE public.wars SET defender_core_hp = greatest(0, defender_core_hp - v_dmg) WHERE id = p_war_id
      RETURNING defender_core_hp INTO v_new_hp;
  ELSE
    UPDATE public.wars SET attacker_core_hp = greatest(0, attacker_core_hp - v_dmg) WHERE id = p_war_id
      RETURNING attacker_core_hp INTO v_new_hp;
  END IF;

  -- コア攻撃を履歴に記録（is_core=true）。対象は敵国コア。
  SELECT name INTO v_enemy_name FROM public.countries WHERE id = v_enemy;
  INSERT INTO public.war_battle_log
    (war_id, attacker_id, attacker_name, attacker_country_id,
     target_id, target_name, target_country_id,
     dmg_to_target, dmg_to_attacker, target_dying, attacker_dying, is_core)
  VALUES
    (p_war_id, v_uid, v_atk_name, v_cid,
     NULL, coalesce(v_enemy_name, '敵国') || 'のコア', v_enemy,
     v_dmg, 0, false, false, true);

  IF v_new_hp <= 0 THEN PERFORM public._war_resolve(p_war_id); END IF;

  RETURN jsonb_build_object('damage', v_dmg, 'enemy_core_hp', v_new_hp, 'resolved', v_new_hp <= 0);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.war_attack_core(uuid, int) TO authenticated;
