-- ============================================================
-- 戦争: 終戦処理の修正（+1万バッファ解除＋対戦履歴削除）＋ 自動回復を「減らさない」版に
--   ※ supabase_war_m1/m2/m2_attack/self_buff/history_regen の後に適用する。
--   _war_resolve と war_regen_tick を上書き（war_battle_log 参照のため history_regen の後）。
-- ============================================================

-- 1) _war_resolve: 決着時に
--    ・敗国マージ/解散（従来どおり）
--    ・全参加者の現在HPを実効最大(war_participants.hp_max)へクランプ＝戦争+1万バッファ解除
--    ・対戦履歴(war_battle_log)を削除
CREATE OR REPLACE FUNCTION public._war_resolve(p_war_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_war public.wars;
  v_winner uuid; v_loser uuid; v_result text;
  v_loser_founder uuid; v_loser_territory numeric;
BEGIN
  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id FOR UPDATE;
  IF NOT FOUND OR v_war.status NOT IN ('active','resolving') THEN RETURN; END IF;

  IF v_war.defender_core_hp <= 0 AND v_war.attacker_core_hp > 0 THEN
    v_winner := v_war.attacker_country_id; v_loser := v_war.defender_country_id; v_result := 'attacker_win';
  ELSIF v_war.attacker_core_hp <= 0 AND v_war.defender_core_hp > 0 THEN
    v_winner := v_war.defender_country_id; v_loser := v_war.attacker_country_id; v_result := 'defender_win';
  ELSE
    v_winner := NULL; v_loser := NULL; v_result := 'draw';  -- 時間切れ/両者残存=引き分け（現状維持）
  END IF;

  -- ★終戦: 戦争中の最大HP+10000バッファを解除（現在HPを実効最大=war_participants.hp_maxへ下げる）
  UPDATE public.profiles p
     SET hp_current = least(p.hp_current, wp.hp_max)
    FROM public.war_participants wp
   WHERE wp.war_id = p_war_id AND wp.player_id = p.id AND wp.is_dummy = false
     AND p.hp_current > wp.hp_max;

  IF v_winner IS NOT NULL THEN
    -- 敗国エリア領地→勝国へマージ
    INSERT INTO public.country_area_territory (country_id, area_id, amount)
    SELECT v_winner, area_id, amount FROM public.country_area_territory WHERE country_id = v_loser
    ON CONFLICT (country_id, area_id) DO UPDATE SET amount = country_area_territory.amount + EXCLUDED.amount;
    -- 総領地を加算
    SELECT coalesce(territory,0), founder_id INTO v_loser_territory, v_loser_founder
      FROM public.countries WHERE id = v_loser;
    UPDATE public.countries SET territory = territory + v_loser_territory WHERE id = v_winner;
    -- 敗国の実国民→非加盟（country_id=NULL・階級/貢献リセット）
    UPDATE public.profiles SET country_id = NULL, country_rank = NULL, country_contrib = 0
      WHERE country_id = v_loser;
    -- 敗北元帥の半年建国ロック（NPCはfounder無し＝NULLでスキップ）
    IF v_loser_founder IS NOT NULL THEN
      UPDATE public.profiles SET found_lock_until = now() + interval '6 months' WHERE id = v_loser_founder;
    END IF;
    -- 敗国を解散（CASCADEで area/members/chat除去・region枠が空く）
    DELETE FROM public.countries WHERE id = v_loser;
  END IF;

  -- ★対戦履歴を削除（戦争が終わったら残さない）
  DELETE FROM public.war_battle_log WHERE war_id = p_war_id;

  UPDATE public.wars SET status='done', winner_country_id = v_winner, result = v_result WHERE id = p_war_id;
END;
$function$;

-- 2) war_regen_tick: 自動回復を「上げるだけ（絶対に減らさない）」に。
--    war_participants.hp_max が基礎値止まり(未満タン参戦)でも、現在HPの+1万バッファを削らない。
CREATE OR REPLACE FUNCTION public.war_regen_tick()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  r record; v_elapsed numeric; v_intervals int; v_warmax int; v_newhp int; v_newmp int;
BEGIN
  FOR r IN
    SELECT p.id, p.hp_current, p.mp_current, p.is_dying, p.last_regen_at,
           wp.hp_max AS war_hp_max, wp.mp_max AS war_mp_max
    FROM public.profiles p
    JOIN public.war_participants wp ON wp.player_id = p.id AND wp.is_dummy = false
    JOIN public.wars w ON w.id = wp.war_id AND w.status = 'active'
  LOOP
    v_elapsed := EXTRACT(EPOCH FROM (now() - coalesce(r.last_regen_at, now() - interval '1 hour')));
    v_intervals := floor(v_elapsed / 60);
    IF v_intervals < 1 THEN CONTINUE; END IF;
    v_warmax := coalesce(r.war_hp_max, 0) + 10000;   -- 戦争HP上限
    -- 上げるだけ（現在HPが上限超でも下げない）
    v_newhp := greatest(coalesce(r.hp_current, 0), least(v_warmax, coalesce(r.hp_current, v_warmax) + v_intervals * floor(v_warmax * 0.2)));
    v_newmp := greatest(coalesce(r.mp_current, 0), least(coalesce(r.war_mp_max, 0), coalesce(r.mp_current, r.war_mp_max) + v_intervals * floor(coalesce(r.war_mp_max, 0) * 0.2)));
    UPDATE public.profiles SET
        hp_current = v_newhp, mp_current = v_newmp,
        is_dying = CASE WHEN v_newhp >= coalesce(r.war_hp_max, v_warmax) THEN false ELSE is_dying END,
        last_regen_at = coalesce(r.last_regen_at, now()) + (v_intervals * interval '60 seconds')
      WHERE id = r.id;
  END LOOP;
END;
$function$;
