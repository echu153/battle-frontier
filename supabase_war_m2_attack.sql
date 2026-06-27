-- ============================================================
-- 戦争システム M2-2（相互戦闘 war_attack・瀕死復活 / is_admin先行）
-- ------------------------------------------------------------
-- 目的: 敵参加者(実プレイヤー/NPCダミー)を選んで殴り、持続HP/MPを削る消耗戦。
--       HP0で瀕死(5分・攻撃対象外)。5分後に全快して復帰。全員瀕死でコア解禁。
-- 前提: supabase_war_m1.sql / supabase_war_m2.sql 適用済み。
-- 方針(先行): 戦闘はクライアントが simulatePvpBattle で計算し、終了HP/MPを送信。
--       サーバーは行ロック＋範囲クランプ＋CD＋瀕死判定の権威を持つ(M4でEdge権威化)。
-- ============================================================

-- ============================================================
-- 1) war_tick 改修: 開戦seed(M2-1)＋瀕死復活(M2-2)＋締め
--    瀕死は dying_until 経過で「全快して復帰」(対象外ゆえ必然全快)。
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_tick()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE r record;
BEGIN
  -- 開戦: コアHPセット＋両国の実国民を概算 seed
  FOR r IN SELECT id, attacker_country_id, defender_country_id
             FROM public.wars WHERE status='declared' AND starts_at <= now() FOR UPDATE LOOP
    UPDATE public.wars SET status='active', attacker_core_hp=300000, defender_core_hp=300000 WHERE id = r.id;
    INSERT INTO public.war_participants
      (war_id, player_id, country_id, hp, mp, hp_max, mp_max, loadout, status, is_dummy)
    SELECT r.id, p.id, p.country_id,
           (p.hp_max + coalesce(p.museum_hp,0) + coalesce(p.fishing_hp,0) + 20000),
           (p.mp_max + coalesce(p.museum_mp,0) + coalesce(p.fishing_mp,0)),
           (p.hp_max + coalesce(p.museum_hp,0) + coalesce(p.fishing_hp,0) + 20000),
           (p.mp_max + coalesce(p.museum_mp,0) + coalesce(p.fishing_mp,0)),
           NULL, 'active', false
    FROM public.profiles p
    WHERE p.country_id IN (r.attacker_country_id, r.defender_country_id)
    ON CONFLICT (war_id, player_id) DO NOTHING;
  END LOOP;

  -- 瀕死復活: dying_until 経過 → 全快して復帰
  UPDATE public.war_participants
     SET status='active', hp=hp_max, mp=mp_max, dying_until=NULL
   WHERE status='dying' AND dying_until IS NOT NULL AND dying_until <= now();

  -- 締め: 時間切れ→決着
  FOR r IN SELECT id FROM public.wars WHERE status='active' AND ends_at <= now() FOR UPDATE LOOP
    PERFORM public._war_resolve(r.id);
  END LOOP;
END;
$function$;

-- ============================================================
-- 2) war_attack: 敵参加者へ交戦（クライアント計算の終了HP/MPを適用）
--    p_target           : 攻撃対象の player_id（敵国の war_participants）
--    p_atk_end_hp/mp    : 交戦後の自分の持続HP/MP
--    p_tgt_end_hp/mp    : 交戦後の対象の持続HP/MP
--    p_atk_hp_max/mp_max: 自分の正確な最大HP/MP（オンライン自己上書き＝eff+20000）
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_attack(
    p_war_id uuid, p_target uuid,
    p_atk_end_hp int, p_atk_end_mp int,
    p_tgt_end_hp int, p_tgt_end_mp int,
    p_atk_hp_max int DEFAULT NULL, p_atk_mp_max int DEFAULT NULL)
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
  v_atk_max int; v_atk_mmax int;
  v_atk_hp int; v_atk_mp int; v_tgt_hp int; v_tgt_mp int;
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

  -- 自分の参加者行（開戦時に seed 済みのはず）。デッドロック回避のため uid 小さい順は不要（別pkey）。
  SELECT * INTO v_atk FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'あなたは参加者として登録されていません'; END IF;
  IF v_atk.status = 'dying' AND v_atk.dying_until > now() THEN RAISE EXCEPTION 'あなたは瀕死中です'; END IF;

  -- 攻撃CD（20秒）
  IF v_atk.last_attack_at IS NOT NULL AND v_atk.last_attack_at > now() - interval '20 seconds' THEN
    RAISE EXCEPTION '攻撃のクールダウン中です';
  END IF;

  -- 対象（敵国の参加者）
  SELECT * INTO v_tgt FROM public.war_participants
    WHERE war_id = p_war_id AND player_id = p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象が存在しません'; END IF;
  IF v_tgt.country_id <> v_enemy THEN RAISE EXCEPTION '対象は敵国の参加者ではありません'; END IF;
  IF v_tgt.status = 'dying' AND v_tgt.dying_until > now() THEN RAISE EXCEPTION '対象は瀕死中です'; END IF;

  -- 自分の最大HP/MP（正確値が来ていれば自己上書き＝オンライン精度向上）
  v_atk_max  := greatest(1, coalesce(p_atk_hp_max, v_atk.hp_max));
  v_atk_mmax := greatest(0, coalesce(p_atk_mp_max, v_atk.mp_max));

  -- 範囲クランプ（クライアント値を信用しすぎない・先行の簡易権威）
  v_atk_hp := greatest(0, least(coalesce(p_atk_end_hp, v_atk.hp), v_atk_max));
  v_atk_mp := greatest(0, least(coalesce(p_atk_end_mp, v_atk.mp), v_atk_mmax));
  v_tgt_hp := greatest(0, least(coalesce(p_tgt_end_hp, v_tgt.hp), v_tgt.hp_max));
  v_tgt_mp := greatest(0, least(coalesce(p_tgt_end_mp, v_tgt.mp), v_tgt.mp_max));

  v_atk_dying := v_atk_hp <= 0;
  v_tgt_dying := v_tgt_hp <= 0;

  UPDATE public.war_participants SET
      hp_max = v_atk_max, mp_max = v_atk_mmax,
      hp = v_atk_hp, mp = v_atk_mp,
      status = CASE WHEN v_atk_dying THEN 'dying' ELSE 'active' END,
      dying_until = CASE WHEN v_atk_dying THEN now() + interval '5 minutes' ELSE NULL END,
      last_attack_at = now()
    WHERE war_id = p_war_id AND player_id = v_uid;

  UPDATE public.war_participants SET
      hp = v_tgt_hp, mp = v_tgt_mp,
      status = CASE WHEN v_tgt_dying THEN 'dying' ELSE 'active' END,
      dying_until = CASE WHEN v_tgt_dying THEN now() + interval '5 minutes' ELSE NULL END
    WHERE war_id = p_war_id AND player_id = p_target;

  RETURN jsonb_build_object(
    'atk_hp', v_atk_hp, 'atk_mp', v_atk_mp, 'atk_dying', v_atk_dying,
    'tgt_hp', v_tgt_hp, 'tgt_mp', v_tgt_mp, 'tgt_dying', v_tgt_dying);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.war_attack(uuid, uuid, int, int, int, int, int, int) TO authenticated;
