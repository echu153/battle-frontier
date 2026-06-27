-- ============================================================
-- 戦争システム M2-1（参加者seed・瀕死ゲート検証 / is_admin先行）
-- ------------------------------------------------------------
-- 目的: 開戦時に両国の国民を war_participants へ seed し、敵が全員瀕死のときだけ
--       コアが攻撃できる（war_attack_core のゲート）ことを実機検証する。
--       相互戦闘 war_attack 本体は M2-2（supabase_war_m2_attack.sql）。
-- 前提: supabase_war_m1.sql 適用済み。
-- 方針:
--   ・参加者の実効HP/MPは本来クライアント計算(calcEffectiveStats)だが、オフライン国民も
--     確実に seed するため、サーバーは「基礎 + museum_* + fishing_*」で概算 seed する。
--     オンライン勢はクライアントが自分の行を正確な eff で上書きする（M2-2で実装）。
--   ・NPC国は実国民を持たないため、検証用に war_admin_seed_npc でダミー参加者を作る。
--     ダミーは実 profiles を持たないので player_id の外部キーを外し is_dummy 列で識別する。
-- ============================================================

-- 0) war_participants: ダミー参加者を許すため player_id の FK を外し、識別列を追加
ALTER TABLE public.war_participants DROP CONSTRAINT IF EXISTS war_participants_player_id_fkey;
ALTER TABLE public.war_participants ADD COLUMN IF NOT EXISTS is_dummy boolean NOT NULL DEFAULT false;
-- war_id 側の CASCADE は維持（戦争削除で参加者も消える）。profiles 削除時の孤児は先行では許容（M4で再設計）。

-- 戦争の最大HP補正（spec: 最大HP+20000）
-- ※ SQL内では直接 20000 を使用（関数定数）。

-- ============================================================
-- 1) war_tick 改修: 開戦時に両国の実国民を war_participants へ概算 seed
--    （M1からの差分は declared→active ループ内の seed のみ。締め処理は不変）
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_tick()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE r record;
BEGIN
  -- 開戦: コアHPに戦争定数300000をセット ＋ 両国の実国民を概算 seed
  FOR r IN SELECT id, attacker_country_id, defender_country_id
             FROM public.wars WHERE status='declared' AND starts_at <= now() FOR UPDATE LOOP
    UPDATE public.wars SET status='active', attacker_core_hp=300000, defender_core_hp=300000 WHERE id = r.id;

    -- 実国民を seed（基礎 + museum_* + fishing_* で概算。+20000 は戦争HP補正）。
    -- ON CONFLICT DO NOTHING で二重 seed を防止（このループは開戦時に1回のみだが安全側）。
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

  -- 締め: 時間切れ→決着（M1から不変）
  FOR r IN SELECT id FROM public.wars WHERE status='active' AND ends_at <= now() FOR UPDATE LOOP
    PERFORM public._war_resolve(r.id);
  END LOOP;
END;
$function$;

-- ============================================================
-- 2) 管理者テスト補助: NPC国側にダミー参加者を seed
--    呼び出し元(=布告した管理者)の敵国(defender)にダミーを作る。
--    p_dying=true なら瀕死状態(5分)で作る（コア解禁の確認用）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_admin_seed_npc(
    p_war_id uuid, p_count int DEFAULT 1, p_hp int DEFAULT 50000, p_dying boolean DEFAULT false)
 RETURNS int
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_admin boolean; v_war public.wars; v_enemy uuid; i int;
BEGIN
  SELECT is_admin INTO v_admin FROM public.profiles WHERE id = auth.uid();
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '管理者限定です'; END IF;
  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id;
  IF NOT FOUND THEN RAISE EXCEPTION '戦争が存在しません'; END IF;
  v_enemy := v_war.defender_country_id;  -- 管理者は通常 attacker。ダミーは defender(NPC) 側に置く。

  FOR i IN 1..greatest(1, coalesce(p_count,1)) LOOP
    INSERT INTO public.war_participants
      (war_id, player_id, country_id, hp, mp, hp_max, mp_max, loadout, status, dying_until, is_dummy)
    VALUES (
      p_war_id, gen_random_uuid(), v_enemy,
      CASE WHEN p_dying THEN 0 ELSE greatest(1, p_hp) END, 0,
      greatest(1, p_hp), 0, NULL,
      CASE WHEN p_dying THEN 'dying' ELSE 'active' END,
      CASE WHEN p_dying THEN now() + interval '5 minutes' ELSE NULL END,
      true);
  END LOOP;
  RETURN greatest(1, coalesce(p_count,1));
END;
$function$;

-- ============================================================
-- 3) 管理者テスト補助: 参加者を全消去（再 seed 用）
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_admin_clear_participants(p_war_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_admin boolean;
BEGIN
  SELECT is_admin INTO v_admin FROM public.profiles WHERE id = auth.uid();
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '管理者限定です'; END IF;
  DELETE FROM public.war_participants WHERE war_id = p_war_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.war_admin_seed_npc(uuid, int, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.war_admin_clear_participants(uuid)          TO authenticated;
