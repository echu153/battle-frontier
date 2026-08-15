-- ============================================================
-- 「不思議な箱」「奇妙な箱」ドロップ (2026-08-16)
--   ・エリア①〜⑧の出撃で敵を討伐したとき … 3%
--   ・レイドボスへの攻撃1回ごと           … 5%
--     （どちらも装備ドロップ／レイド報酬とは完全に独立した別枠）
--   ・箱が落ちたら中身を抽選: 不思議な箱 90% / 奇妙な箱 10%
--   ・現時点では使い道なし＝アイテム欄に溜まるだけ。
--     バトルフロンティアⅡへ「ランダムな素材が手に入るアイテム」として
--     引き継ぐ前提で、先に落ちるところ（導線）だけ用意する。
--   ・説明文はプレイヤーに中身を明かさない（'？？？' 固定）。
--   ※apply_battle_result 系には一切触れないため、SQL適用順の鉄則
--     (supabase_mutant_gold_20260703.sql v2 を最後に) とは無関係に単独実行してよい。
--   Supabase の SQL Editor でファイル全体を実行してください。
-- ============================================================

-- 0) 旧版（アイテム名「不思議な素材箱」・引数1つ）を適用済みの場合の後始末
--    未適用ならどちらも何も起きない。
UPDATE public.items SET name = '不思議な箱'
 WHERE name = '不思議な素材箱'
   AND NOT EXISTS (SELECT 1 FROM public.items WHERE name = '不思議な箱');
DROP FUNCTION IF EXISTS public.grant_mystery_box(integer);

-- 1) アイテム登録（重複追加を防ぐ）
--    effect='mystery_box_v2' … アイテム欄で「セットする／使用する」を出さないための識別子。
--    Ⅱへの引き継ぎ実装時もこの effect を目印にする。
INSERT INTO public.items (name, description, effect, value)
SELECT '不思議な箱', '？？？', 'mystery_box_v2', 0
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE name = '不思議な箱');

INSERT INTO public.items (name, description, effect, value)
SELECT '奇妙な箱', '？？？', 'mystery_box_v2', 0
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE name = '奇妙な箱');

-- 2) ドロップ付与RPC（サーバー側RNG）
--    p_count : まとめて判定する回数（簡易出撃の清算用）。1〜100にクランプする。
--    p_source: 'raid' なら5%、それ以外（出撃）は3%。確率はサーバーが決める＝
--              クライアントから確率を渡させない。
CREATE OR REPLACE FUNCTION public.grant_mystery_box(
  p_count  integer DEFAULT 1,
  p_source text    DEFAULT 'sortie'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_id       items.id%TYPE;
  v_n        integer := LEAST(GREATEST(COALESCE(p_count, 1), 1), 100);
  v_rate     numeric := CASE WHEN p_source = 'raid' THEN 0.05 ELSE 0.03 END;
  v_strange  numeric := 0.10;  -- 箱が落ちたときに「奇妙な箱」になる確率
  v_mystery_n integer := 0;
  v_strange_n integer := 0;
  i          integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false); END IF;

  FOR i IN 1..v_n LOOP
    IF random() < v_rate THEN
      IF random() < v_strange THEN v_strange_n := v_strange_n + 1;
      ELSE                         v_mystery_n := v_mystery_n + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_mystery_n > 0 THEN
    SELECT id INTO v_id FROM items WHERE name = '不思議な箱' LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, v_mystery_n, false)
      ON CONFLICT (player_id, item_id)
      DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;
    ELSE
      v_mystery_n := 0;
    END IF;
  END IF;

  IF v_strange_n > 0 THEN
    SELECT id INTO v_id FROM items WHERE name = '奇妙な箱' LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_uid, v_id, v_strange_n, false)
      ON CONFLICT (player_id, item_id)
      DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;
    ELSE
      v_strange_n := 0;
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'mystery', v_mystery_n, 'strange', v_strange_n);
END $function$;

GRANT EXECUTE ON FUNCTION public.grant_mystery_box(integer, text) TO authenticated;
