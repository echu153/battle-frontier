-- ============================================================
-- 戦闘ドロップ付与RPC (2026-06-11)
--   霜の精気が「入手した！」表示なのに付与されない報告への根本対策。
--   従来: クライアントが SELECT→INSERT/UPDATE の2段階で付与
--         （隙間での競合・瞬断で無言失敗の余地があった）
--   今後: サーバー側で ON CONFLICT の原子的upsert一発。
--   対象は戦闘ドロップで配布される消耗品（強化石・無限ポーション素材）のみ。
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_battle_item(p_item_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item_id int;
  v_qty int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  -- 戦闘ドロップで配布される消耗品のみ許可（武器/装備は対象外）
  IF NOT (p_item_name LIKE '強化石(%' OR p_item_name IN ('森の生命液','荒野の薬草','古代の精髄','蒼海の精気','雷鳴の精気','霜の精気')) THEN
    RETURN json_build_object('ok',false,'reason','not_allowed');
  END IF;
  SELECT id INTO v_item_id FROM items WHERE name = p_item_name ORDER BY id LIMIT 1;
  IF v_item_id IS NULL THEN RETURN json_build_object('ok',false,'reason','item_not_found'); END IF;

  INSERT INTO player_items (player_id, item_id, quantity, equipped)
  VALUES (v_uid, v_item_id, 1, false)
  ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1
  RETURNING quantity INTO v_qty;

  RETURN json_build_object('ok', true, 'quantity', v_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_battle_item(text) TO authenticated;
