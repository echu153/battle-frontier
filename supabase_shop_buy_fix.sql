-- ============================================================
-- 商店購入バグ修正（複数/100個以上で「購入に失敗しました」）
--   原因: buy_item_from_shop が個数 > 99 を invalid_quantity で弾いていた。
--         クライアント(Shop.jsx)は 1〜999 を許可しているため不整合。
--   修正: サーバー上限を 999 に揃える。
--         + コスト計算を bigint 化して整数オーバーフローを防止。
--   ※ Gold は保護トリガー(protect_stats)の対象外なので GUC 不要。
--   ※ player_items は UNIQUE(player_id, item_id) 済 → ON CONFLICT そのまま。
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_item_from_shop(p_item_id integer, p_quantity integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_gold integer;
  v_item_price integer;
  v_total_cost bigint;   -- ★ オーバーフロー防止
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 999 THEN   -- ★ 99 → 999
    RETURN json_build_object('ok',false,'reason','invalid_quantity'); END IF;

  SELECT buy_price INTO v_item_price FROM items WHERE id = p_item_id AND is_shop_item = true;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','item_not_found'); END IF;

  v_total_cost := v_item_price::bigint * p_quantity;
  SELECT gold INTO v_gold FROM profiles WHERE id = v_uid;
  IF v_gold < v_total_cost THEN
    RETURN json_build_object('ok',false,'reason','not_enough_gold'); END IF;

  UPDATE profiles SET gold = gold - v_total_cost
    WHERE id = v_uid AND gold >= v_total_cost;
  IF NOT FOUND THEN
    RETURN json_build_object('ok',false,'reason','not_enough_gold'); END IF;

  INSERT INTO player_items(player_id, item_id, quantity, equipped)
  VALUES(v_uid, p_item_id, p_quantity, false)
  ON CONFLICT (player_id, item_id)
  DO UPDATE SET quantity = player_items.quantity + p_quantity;

  RETURN json_build_object('ok',true,'cost',v_total_cost);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buy_item_from_shop(integer, integer) TO authenticated;
