-- ============================================================
-- 「不思議な素材箱」ドロップ (2026-08-16)
--   ・エリア①〜⑧の出撃で敵を討伐したとき、装備ドロップとは別枠で3%獲得
--     （ザコ／ボスどちらでも判定・装備ドロップの成否とは完全に独立）
--   ・現時点では使い道なし＝アイテム欄に溜まるだけ。
--     バトルフロンティアⅡへ「ランダムな素材が手に入るアイテム」として
--     引き継ぐ前提で、先に落ちるところ（導線）だけ用意する。
--   ・説明文はプレイヤーに中身を明かさない（'？？？' 固定）。
--   ※apply_battle_result 系には一切触れないため、SQL適用順の鉄則
--     (supabase_mutant_gold_20260703.sql v2 を最後に) とは無関係に単独実行してよい。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- 1) アイテム登録（重複追加を防ぐ）
--    effect='mystery_box_v2' … アイテム欄で「セットする／使用する」を出さないための識別子。
--    Ⅱへの引き継ぎ実装時もこの effect を目印にする。
INSERT INTO public.items (name, description, effect, value)
SELECT '不思議な素材箱', '？？？', 'mystery_box_v2', 0
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE name = '不思議な素材箱');

-- 2) ドロップ付与RPC（サーバー側RNG＝1回あたり3%）
--    p_count: まとめて判定する討伐回数（簡易出撃の清算用）。1〜100にクランプする。
CREATE OR REPLACE FUNCTION public.grant_mystery_box(p_count integer DEFAULT 1)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_id   items.id%TYPE;
  v_n    integer := LEAST(GREATEST(COALESCE(p_count, 1), 1), 100);
  v_got  integer := 0;
  v_rate numeric := 0.03;  -- ドロップ率（3%）
  i      integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false); END IF;

  FOR i IN 1..v_n LOOP
    IF random() < v_rate THEN v_got := v_got + 1; END IF;
  END LOOP;

  IF v_got = 0 THEN RETURN json_build_object('ok', true, 'got', 0); END IF;

  SELECT id INTO v_id FROM items WHERE name = '不思議な素材箱' LIMIT 1;
  IF v_id IS NULL THEN RETURN json_build_object('ok', false); END IF;

  INSERT INTO player_items (player_id, item_id, quantity, equipped)
  VALUES (v_uid, v_id, v_got, false)
  ON CONFLICT (player_id, item_id)
  DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;

  RETURN json_build_object('ok', true, 'got', v_got);
END $function$;

GRANT EXECUTE ON FUNCTION public.grant_mystery_box(integer) TO authenticated;
