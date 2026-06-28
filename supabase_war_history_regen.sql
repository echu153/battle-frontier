-- ============================================================
-- 戦争: 対戦履歴ログ ＋ 戦闘記録つき war_attack ＋ 非ログイン自動回復(cron)
--   ※このファイルは supabase_war_m1/m2/m2_attack/self_buff の後に適用する。
--     war_attack を「戦闘ログ記録つき」版で置き換える（引数は10個版のまま）。
-- ============================================================

-- 1) 対戦履歴テーブル（お互いの国民が交戦した結果を残す）
CREATE TABLE IF NOT EXISTS public.war_battle_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  war_id uuid NOT NULL,
  attacker_id uuid,
  attacker_name text,
  attacker_country_id uuid,
  target_id uuid,
  target_name text,
  target_country_id uuid,
  dmg_to_target int DEFAULT 0,
  dmg_to_attacker int DEFAULT 0,
  target_dying boolean DEFAULT false,
  attacker_dying boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS war_battle_log_war_idx ON public.war_battle_log (war_id, created_at DESC);

ALTER TABLE public.war_battle_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS war_battle_log_select ON public.war_battle_log;
CREATE POLICY war_battle_log_select ON public.war_battle_log FOR SELECT TO authenticated USING (true);
-- INSERT は war_attack(SECURITY DEFINER) からのみ。クライアント直INSERTは許可しない。

-- 2) war_attack: 交戦。終了HP/MPを街共有(profiles)へ反映し、戦闘結果を war_battle_log に記録。
DROP FUNCTION IF EXISTS public.war_attack(uuid, uuid, int, int, int, int, int, int, int, int);
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
  v_atk_before int; v_tgt_before int;
  v_atk_name text; v_tgt_name text;
  v_dmg_tgt int; v_dmg_atk int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT country_id, is_admin, hp_current, username
    INTO v_cid, v_admin, v_atk_before, v_atk_name FROM public.profiles WHERE id = v_uid;
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

  -- 対象の交戦前HP・名前（実プレイヤーは profiles、ダミーは war_participants）
  IF v_tgt.is_dummy THEN
    v_tgt_before := v_tgt.hp; v_tgt_name := 'ダミー兵';
  ELSE
    SELECT hp_current, username INTO v_tgt_before, v_tgt_name FROM public.profiles WHERE id = p_target;
  END IF;

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

  -- 戦闘結果を履歴に記録（与ダメージ＝交戦前HP − 交戦後HP）
  v_dmg_tgt := greatest(0, coalesce(v_tgt_before, 0) - v_tgt_hp);
  v_dmg_atk := greatest(0, coalesce(v_atk_before, 0) - v_atk_hp);
  INSERT INTO public.war_battle_log
    (war_id, attacker_id, attacker_name, attacker_country_id,
     target_id, target_name, target_country_id,
     dmg_to_target, dmg_to_attacker, target_dying, attacker_dying)
  VALUES
    (p_war_id, v_uid, v_atk_name, v_cid,
     p_target, v_tgt_name, v_enemy,
     v_dmg_tgt, v_dmg_atk, v_tgt_dying, v_atk_dying);

  RETURN jsonb_build_object(
    'atk_hp', v_atk_hp, 'atk_mp', v_atk_mp, 'atk_dying', v_atk_dying,
    'tgt_hp', v_tgt_hp, 'tgt_mp', v_tgt_mp, 'tgt_dying', v_tgt_dying,
    'dmg_to_target', v_dmg_tgt, 'dmg_to_attacker', v_dmg_atk);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.war_attack(uuid, uuid, int, int, int, int, int, int, int, int) TO authenticated;

-- 3) 戦争中の自然回復（ログインしていなくてもサーバーが回復させる）。
--    active戦争の実プレイヤー参加者を対象に、最終回復からの経過60秒ごとに
--    戦争HP上限(=war_participants.hp_max + 10000)の20%を回復。MPも同様(上限はmp_max)。
--    war_participants.hp_max は満タン参戦RPC(war_self_buff)で実効値に自己上書き済み。
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
    v_newhp := least(v_warmax, coalesce(r.hp_current, v_warmax) + v_intervals * floor(v_warmax * 0.2));
    v_newmp := least(coalesce(r.war_mp_max, 0), coalesce(r.mp_current, r.war_mp_max) + v_intervals * floor(coalesce(r.war_mp_max, 0) * 0.2));
    UPDATE public.profiles SET
        hp_current = v_newhp,
        mp_current = v_newmp,
        is_dying = CASE WHEN v_newhp >= coalesce(r.war_hp_max, v_warmax) THEN false ELSE is_dying END,
        last_regen_at = coalesce(r.last_regen_at, now()) + (v_intervals * interval '60 seconds')
      WHERE id = r.id;
  END LOOP;
END;
$function$;

-- 4) pg_cron で1分ごとに war_regen_tick を実行（同名ジョブは置き換え）。
--    ※pg_cron 拡張が有効であること（レイド通知などで既に利用済み）。
SELECT cron.schedule('war_regen', '* * * * *', $$ SELECT public.war_regen_tick(); $$);
