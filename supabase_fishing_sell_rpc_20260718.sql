-- ============================================================
-- 釣り一括売却のサーバーRPC化（2026-07-18）
-- ------------------------------------------------------------
-- 不具合: クライアントの一括売却が「Gold付与→caught_fish削除」の順で、
--   削除のエラー/件数を未チェックだったため、削除失敗時(釣果が多すぎて
--   .in('id',...)のURL長超過等)にGoldだけ入り釣果が残留→何度でも売却できた。
-- 対策: 削除・図鑑登録・強化石付与・Gold加算を1トランザクションのRPCに統合。
--   クライアント計算のGold申告も廃止（改ざん穴も同時に封鎖）。
-- 単独実行可。適用後にクライアント(263772e以降の売却RPC版)をデプロイ。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sell_caught_fish()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_total  int; v_gold bigint; v_stones int; v_shrimp int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauth'); END IF;
  PERFORM set_config('app.allow_stat_change','on',true);

  WITH del AS (
    -- 全釣果を削除しつつ内容を回収（このRPC実行中に釣れた分は次回売却対象）
    DELETE FROM caught_fish WHERE player_id = v_uid
    RETURNING fish_name, fish_rank, location
  ), dex AS (
    -- 魚図鑑登録（場所＋魚名で1件。イベントエビ・強化石は登録しない）
    INSERT INTO fishing_records(player_id, fish_name, fish_rank, location, first_caught_at, bonus_claimed)
    SELECT DISTINCT ON (d.location, d.fish_name)
           v_uid, d.fish_name, d.fish_rank, d.location, now(), false
    FROM del d
    WHERE d.fish_name NOT LIKE '強化石%'
      AND d.fish_name NOT IN ('スゴクテガナガイエビ','カナリテガナガイエビ','スゴイテガナガイエビ')
    ORDER BY d.location, d.fish_name
    ON CONFLICT DO NOTHING
  ), stones AS (
    -- 強化石はアイテムとして付与
    INSERT INTO player_items(player_id, item_id, quantity, equipped)
    SELECT v_uid, i.id, count(*), false
    FROM del d JOIN items i ON i.name = d.fish_name
    WHERE d.fish_name LIKE '強化石%'
    GROUP BY i.id
    ON CONFLICT (player_id, item_id)
      DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity
  )
  SELECT count(*),
         COALESCE(sum(CASE
           WHEN d.fish_name = 'カナリテガナガイエビ' THEN 50000
           WHEN d.fish_name IN ('スゴクテガナガイエビ','スゴイテガナガイエビ') THEN 10000
           WHEN d.fish_name LIKE '強化石%' THEN 0
           ELSE COALESCE(CASE lower(COALESCE(d.fish_rank,'f'))
             WHEN 'f' THEN 150   WHEN 'e' THEN 450    WHEN 'd' THEN 1200
             WHEN 'c' THEN 3000  WHEN 'b' THEN 7500   WHEN 'a' THEN 18000
             WHEN 's' THEN 45000 WHEN 'ss' THEN 120000 WHEN 'sss' THEN 300000
           END, 50)
         END), 0),
         count(*) FILTER (WHERE d.fish_name LIKE '強化石%'),
         count(*) FILTER (WHERE d.fish_name IN ('スゴクテガナガイエビ','カナリテガナガイエビ','スゴイテガナガイエビ'))
  INTO v_total, v_gold, v_stones, v_shrimp
  FROM del d;

  IF v_gold > 0 THEN
    UPDATE profiles SET gold = COALESCE(gold,0) + v_gold WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'count', v_total, 'gold', v_gold,
                            'stones', v_stones, 'shrimp', v_shrimp);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_caught_fish() TO authenticated;
