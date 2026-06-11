-- ============================================================
-- サーバー時刻取得RPC（クールダウンの端末時計ズレ補正用）
--   クライアントは起動時にこれを呼び、Date.now() との差(offset)を求めて
--   クールダウン計算をサーバー時刻基準に補正する。
-- ============================================================
CREATE OR REPLACE FUNCTION public.server_now()
RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT now() $$;

GRANT EXECUTE ON FUNCTION public.server_now() TO authenticated;
