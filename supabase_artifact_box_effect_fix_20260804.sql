-- ============================================================
-- 修正: アーティファクト装備選択箱で受け取った装備に特殊能力が付いていない
--   ・原因: redeem_artifact_box が bonus_effect = NULL で付与していた。
--     アーティファクトの特殊能力（MP消費2倍・スキルダメージ1.3倍）は
--     player_equipment.bonus_effect = 'artifact' で判定される（出撃/レイド/奈落/
--     八獄/エンドレスタワー/対人戦すべて共通）ため、覚醒（古びた○○→アーティファクト）
--     で入手した装備にしか効果が乗らず、選択箱で受け取った装備は効果なしだった。
--   ・対応: ①RPCを修正（以後は 'artifact' 付きで付与）②配布済みの装備を遡って修正
--   Supabase の SQL Editor でファイル全体を実行してください
--   ※protect_stats / mutant_gold より後でOK（apply_battle_result を触らない）
-- ============================================================

-- ===== 1) RPC修正: bonus_effect='artifact' を付けて付与 =====
CREATE OR REPLACE FUNCTION public.redeem_artifact_box(p_weapon_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_box_id bigint;
  v_held int;
  v_weapon weapons%ROWTYPE;
  v_allowed text[] := ARRAY[
    '黒星ノ断剣','血哭ノ短刃','月影ノ断弓','奈落ノ処刑斧','斬月ノ終刀',
    '虚無ノ閃砲','星喰ノ導杖','終焉ノ魔書','冥哭ノ長槍','深淵ノ霊珠'];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','未認証'); END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok',false,'error','選択できない装備です');
  END IF;
  SELECT id INTO v_box_id FROM items WHERE name = 'アーティファクト装備選択箱' LIMIT 1;
  IF v_box_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','選択箱アイテムが存在しません'); END IF;
  -- 同時交換による複製防止: 所持行をロックしてから消費
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items
    WHERE player_id = v_uid AND item_id = v_box_id FOR UPDATE;
  IF v_held < 1 THEN RETURN jsonb_build_object('ok',false,'error','選択箱を所持していません'); END IF;
  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','装備が見つかりません'); END IF;
  -- 更新0件＝別リクエストが先に消費済み→中断（複製防止の二重ガード）
  UPDATE player_items SET quantity = quantity - 1
    WHERE player_id = v_uid AND item_id = v_box_id AND quantity >= 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','選択箱の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id = v_uid AND item_id = v_box_id AND quantity <= 0;
  -- bonus_effect='artifact'＝アーティファクトの特殊能力（MP消費2倍・スキルダメージ1.3倍）。
  -- 覚醒(Equipment.jsx doAwaken)と同じ値。NULLだと特殊能力なしの只の武器になる。
  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, 'artifact');
  RETURN jsonb_build_object('ok',true,'weapon',p_weapon_name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_artifact_box(text) TO authenticated;

-- ===== 2) 配布済み装備の遡り修正 =====
--   アーティファクト10種は「覚醒」か「選択箱」でしか入手できず、覚醒経由は必ず
--   bonus_effect='artifact' が入っている。よって 'artifact' 以外＝選択箱で配布された分。
--   ※取引所には出せない装備（rarity=s で base_price 未設定＝出品不可）なので
--     他人へ渡っている可能性は無く、出品中の在庫が詰まる心配もない。
DO $$
DECLARE v_n int;
BEGIN
  UPDATE player_equipment pe
     SET bonus_effect = 'artifact'
    FROM weapons w
   WHERE w.id = pe.weapon_id
     AND w.name IN ('黒星ノ断剣','血哭ノ短刃','月影ノ断弓','奈落ノ処刑斧','斬月ノ終刀',
                    '虚無ノ閃砲','星喰ノ導杖','終焉ノ魔書','冥哭ノ長槍','深淵ノ霊珠')
     AND pe.bonus_effect IS DISTINCT FROM 'artifact';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '特殊能力を付け直したアーティファクト: % 件', v_n;
END $$;

-- ===== 3) 確認用（任意）=====
-- SELECT w.name, pe.bonus_effect, count(*)
--   FROM player_equipment pe JOIN weapons w ON w.id = pe.weapon_id
--  WHERE w.name IN ('黒星ノ断剣','血哭ノ短刃','月影ノ断弓','奈落ノ処刑斧','斬月ノ終刀',
--                   '虚無ノ閃砲','星喰ノ導杖','終焉ノ魔書','冥哭ノ長槍','深淵ノ霊珠')
--  GROUP BY 1,2 ORDER BY 1;
