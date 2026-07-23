-- ============================================================
-- ボス装備進化支援箱: エリア⑧「覇龍の血」を選択肢に追加
--   use_boss_blood_box の v_valid に '覇龍の血' を追加するだけ。他は現行のまま。
--   前提: 覇龍の血 が items に存在すること（supabase_area8_soutenn_20260723.sql §2で挿入済み）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.use_boss_blood_box(p_blood_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_box   items.id%TYPE;
  v_blood items.id%TYPE;
  v_pi    player_items%ROWTYPE;
  v_valid text[] := ARRAY['スライムの血','盗賊の血','番人の血','海竜の血','雷鷲の血','氷霊の血','サラマンダーの血','覇龍の血'];  -- ★覇龍の血を追加
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF NOT (p_blood_name = ANY(v_valid)) THEN RETURN false; END IF;
  SELECT id INTO v_box   FROM items WHERE name = 'ボス装備進化支援箱' LIMIT 1;
  SELECT id INTO v_blood FROM items WHERE name = p_blood_name LIMIT 1;
  IF v_box IS NULL OR v_blood IS NULL THEN RETURN false; END IF;
  -- 箱を1個消費（楽観ロック）
  SELECT * INTO v_pi FROM player_items
   WHERE player_id = v_uid AND item_id = v_box AND quantity >= 1 LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_pi.quantity > 1 THEN
    UPDATE player_items SET quantity = quantity - 1 WHERE id = v_pi.id AND quantity = v_pi.quantity;
  ELSE
    DELETE FROM player_items WHERE id = v_pi.id AND quantity = v_pi.quantity;
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;
  -- 血×10付与
  SELECT * INTO v_pi FROM player_items WHERE player_id = v_uid AND item_id = v_blood LIMIT 1;
  IF FOUND THEN
    UPDATE player_items SET quantity = quantity + 10 WHERE id = v_pi.id;
  ELSE
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_uid, v_blood, 10, false);
  END IF;
  RETURN true;
END $function$;
