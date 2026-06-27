-- ============================================================
-- 戦争システム M1（NPC core-only / is_admin先行テスト）
-- ------------------------------------------------------------
-- 目的: 持続HP/瀕死/相互戦闘を使わず、「宣戦布告→開戦→コアを削る→勝利→領地総取り」
--       のパイプラインと、コア戦の数値感（コアHP10万・軽減90%が1時間で割れるか）を先に検証する。
-- 前提: 領地システム(supabase_territory.sql)適用済み。countries/profiles/country_area_territory を流用。
-- 方針: コアHP=100000・軽減90% は spec の戦争定数（countries.core_hp 既定1Mには依存しない）。
--       スケジューラ(cron)は使わず war_tick() を画面表示時に呼ぶオンデマンド方式（tick_npc_countriesと同方針）。
--       先行のため declare_war / war_attack_core は is_admin 限定。公開(M4)でゲート解除＋Edge権威化。
-- ============================================================

-- 0) profiles: 敗北元帥の半年建国ロック列（亡命の territory_locked_until とは別管理）
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS found_lock_until timestamptz;

-- 1) wars（対戦カード＝状態機械）
CREATE TABLE IF NOT EXISTS public.wars (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,  -- 布告側
  defender_country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,  -- 被布告側
  declared_at         timestamptz NOT NULL DEFAULT now(),
  starts_at           timestamptz NOT NULL,                 -- 開戦（通常=布告の3日後22時 / テスト=即時）
  ends_at             timestamptz NOT NULL,                 -- 締め（starts_at + 1時間）
  status              text NOT NULL DEFAULT 'declared',     -- declared|active|resolving|done|cancelled
  attacker_core_hp    int,                                  -- 開戦時に戦争定数100000をセット
  defender_core_hp    int,
  winner_country_id   uuid REFERENCES public.countries(id) ON DELETE SET NULL,
  result              text,                                 -- attacker_win|defender_win|draw
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wars_select_all ON public.wars;
CREATE POLICY wars_select_all ON public.wars FOR SELECT USING (true);

-- 2) war_participants（夜間の持続状態。★M2で使用。M1では作成のみ・seedしない）
CREATE TABLE IF NOT EXISTS public.war_participants (
  war_id         uuid NOT NULL REFERENCES public.wars(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  country_id     uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  hp             int NOT NULL DEFAULT 0,
  mp             int NOT NULL DEFAULT 0,
  hp_max         int NOT NULL DEFAULT 0,    -- = eff.hp_max + 20000（戦争補正）
  mp_max         int NOT NULL DEFAULT 0,
  loadout        jsonb,                     -- 開戦時のeff＋スキルのスナップショット（ビルド凍結＝装備込み）
  status         text NOT NULL DEFAULT 'active',   -- active|dying
  dying_until    timestamptz,               -- 瀕死復帰時刻（now超過で復帰=全快）
  self_heal_used boolean NOT NULL DEFAULT false,   -- 戦争中1回の自己全回復
  last_attack_at timestamptz,               -- 20秒CD用
  PRIMARY KEY (war_id, player_id)
);
ALTER TABLE public.war_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wp_select_all ON public.war_participants;
CREATE POLICY wp_select_all ON public.war_participants FOR SELECT USING (true);

-- ============================================================
-- 3) 宣戦布告（元帥のみ・先行はis_admin限定）
-- ============================================================
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
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;  -- 先行ゲート(M4で解除)
  IF v_cid IS NULL THEN RAISE EXCEPTION '国に所属していません'; END IF;
  IF v_rank IS DISTINCT FROM '元帥' THEN RAISE EXCEPTION '宣戦布告は元帥のみ可能です'; END IF;
  IF p_target_country IS NULL OR p_target_country = v_cid THEN RAISE EXCEPTION '対象の国が不正です'; END IF;

  SELECT is_unaffiliated, created_at INTO v_tg_unaff, v_tg_created
    FROM public.countries WHERE id = p_target_country;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の国が存在しません'; END IF;
  IF v_tg_unaff IS TRUE THEN RAISE EXCEPTION '非加盟国には宣戦布告できません'; END IF;

  -- 建国1週間保護（is_adminは免除＝テスト容易化）
  SELECT created_at INTO v_my_created FROM public.countries WHERE id = v_cid;
  IF v_admin IS NOT TRUE THEN
    IF now() < v_my_created + interval '7 days' THEN RAISE EXCEPTION '建国から1週間は宣戦布告できません'; END IF;
    IF now() < v_tg_created + interval '7 days' THEN RAISE EXCEPTION 'その国は建国から1週間 経っていません'; END IF;
  END IF;

  -- 1日1国1戦争（両国とも進行中の戦争が無いこと）
  IF EXISTS (SELECT 1 FROM public.wars w
             WHERE w.status IN ('declared','active','resolving')
               AND (v_cid IN (w.attacker_country_id, w.defender_country_id)
                 OR p_target_country IN (w.attacker_country_id, w.defender_country_id))) THEN
    RAISE EXCEPTION '進行中の戦争があります（1国につき同時に1戦争まで）';
  END IF;

  -- 開戦時刻: 通常=布告の3日後22時 / テスト(adminのみ)=即時
  -- ※「22時」はサーバ now() がUTCのため、本番スケジュールはJST(UTC+9)補正が必要（M3で対応）。テストは即時なので無関係。
  IF p_test IS TRUE THEN
    v_starts := now();
  ELSE
    v_starts := date_trunc('day', now() + interval '3 days') + interval '22 hours';
  END IF;

  INSERT INTO public.wars (attacker_country_id, defender_country_id, starts_at, ends_at, status)
  VALUES (v_cid, p_target_country, v_starts, v_starts + interval '1 hour', 'declared')
  RETURNING * INTO v_war;
  RETURN v_war;
END;
$function$;

-- ============================================================
-- 4) 内部: 決着処理（war_tick/コア破壊から呼ばれる。直接公開しない）
-- ============================================================
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

  UPDATE public.wars SET status='done', winner_country_id = v_winner, result = v_result WHERE id = p_war_id;
END;
$function$;

-- ============================================================
-- 5) war_tick: オンデマンドの状態遷移（画面表示時に呼ぶ。cron不要）
--   declared→active（開戦時刻到来）/ active→決着（締め時刻到来）
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_tick()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE r record;
BEGIN
  -- 開戦: コアHPに戦争定数100000をセット。★参加者seedはM2（M1のNPC core-onlyでは不要）
  FOR r IN SELECT id FROM public.wars WHERE status='declared' AND starts_at <= now() FOR UPDATE LOOP
    UPDATE public.wars SET status='active', attacker_core_hp=300000, defender_core_hp=300000 WHERE id = r.id;
  END LOOP;
  -- 締め: 時間切れ→決着
  FOR r IN SELECT id FROM public.wars WHERE status='active' AND ends_at <= now() FOR UPDATE LOOP
    PERFORM public._war_resolve(r.id);
  END LOOP;
END;
$function$;

-- ============================================================
-- 6) war_attack_core: 敵コアへダメージ（先行はクライアント計算の生ダメを送信→サーバが90%軽減して適用）
--   敵国民が全員瀕死(=非瀕死participantが0)のときのみ可。NPC/未seedは0で通過。
-- ============================================================
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT country_id, is_admin INTO v_cid, v_admin FROM public.profiles WHERE id = v_uid;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '戦争機能は開発中です（管理者限定）'; END IF;  -- 先行ゲート(M4で解除)

  SELECT * INTO v_war FROM public.wars WHERE id = p_war_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '戦争が存在しません'; END IF;
  IF v_war.status <> 'active' THEN RAISE EXCEPTION '戦争中ではありません'; END IF;

  IF v_cid = v_war.attacker_country_id THEN v_is_attacker := true;  v_enemy := v_war.defender_country_id;
  ELSIF v_cid = v_war.defender_country_id THEN v_is_attacker := false; v_enemy := v_war.attacker_country_id;
  ELSE RAISE EXCEPTION 'この戦争の参加国ではありません'; END IF;

  -- 敵国民が全員瀕死か（非瀕死=「statusがdyingでない」or「dying_untilが既に過ぎて復帰済み」をカウント）
  SELECT count(*) INTO v_enemy_defenders FROM public.war_participants wp
   WHERE wp.war_id = p_war_id AND wp.country_id = v_enemy
     AND NOT (wp.status = 'dying' AND wp.dying_until > now());
  IF v_enemy_defenders > 0 THEN RAISE EXCEPTION '敵国民が全員瀕死ではありません'; END IF;

  -- 生ダメ（クライアント計算・圧縮済）を90%軽減して適用。異常値は上限でブロック（先行の簡易対策・M4で権威化）。
  v_dmg := greatest(1, floor(least(greatest(coalesce(p_raw_damage,0),0), 1000000) * 0.1));

  IF v_is_attacker THEN
    UPDATE public.wars SET defender_core_hp = greatest(0, defender_core_hp - v_dmg) WHERE id = p_war_id
      RETURNING defender_core_hp INTO v_new_hp;
  ELSE
    UPDATE public.wars SET attacker_core_hp = greatest(0, attacker_core_hp - v_dmg) WHERE id = p_war_id
      RETURNING attacker_core_hp INTO v_new_hp;
  END IF;

  IF v_new_hp <= 0 THEN PERFORM public._war_resolve(p_war_id); END IF;

  RETURN jsonb_build_object('damage', v_dmg, 'enemy_core_hp', v_new_hp, 'resolved', v_new_hp <= 0);
END;
$function$;

-- ============================================================
-- 7) 管理者テスト補助: 戦争を即決着させる（時間切れを待たずに引き分け/勝敗パイプラインを検証）
-- ============================================================
CREATE OR REPLACE FUNCTION public.war_admin_end(p_war_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_admin boolean;
BEGIN
  SELECT is_admin INTO v_admin FROM public.profiles WHERE id = auth.uid();
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION '管理者限定です'; END IF;
  PERFORM public._war_resolve(p_war_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.declare_war(uuid, boolean)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.war_tick()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.war_attack_core(uuid, int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.war_admin_end(uuid)          TO authenticated;
-- _war_resolve は内部専用（SECURITY DEFINER間PERFORMで実行）。authenticatedへGRANTしない。
