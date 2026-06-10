-- =====================================================================
-- 同時接続数レポート (games-alchemist.com ポータル連携)
-- =====================================================================
-- 仕組み:
--   ① クライアントが2分おきに heartbeat RPC → profiles.last_action_at 更新
--   ② pg_cron が5分おきに「過去5分以内にアクションしたユーザー数」を集計
--   ③ pg_net でポータルAPIへ GET 送信
--
-- 【事前準備（ダッシュボードで実施）】
--   Database → Extensions で「pg_cron」と「pg_net」を有効化すること。
--
-- 【APIキーの登録】
--   下の2行の YOUR_API_KEY / your_game_key を実際の値に書き換えてから実行。
--   Vault に保存されるのでコードには残らない。
--   ※2回目以降に値を変えたい場合は Dashboard → Settings → Vault で編集。
-- =====================================================================

-- ① アクティブ時刻列 ＋ heartbeat RPC
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_action_at timestamptz;

CREATE OR REPLACE FUNCTION heartbeat() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_action_at = now() WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION heartbeat() FROM anon;
GRANT EXECUTE ON FUNCTION heartbeat() TO authenticated;

-- ② APIキーを Vault へ（★実行前にここを書き換える★）
SELECT vault.create_secret('YOUR_API_KEY', 'portal_api_key');
SELECT vault.create_secret('your_game_key', 'portal_game_key');

-- ③ 集計＆送信関数
CREATE OR REPLACE FUNCTION report_online_count() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cnt int;
  v_api text;
  v_game text;
BEGIN
  SELECT count(*) INTO cnt
    FROM profiles
   WHERE last_action_at > now() - interval '5 minutes';

  SELECT decrypted_secret INTO v_api
    FROM vault.decrypted_secrets WHERE name = 'portal_api_key';
  SELECT decrypted_secret INTO v_game
    FROM vault.decrypted_secrets WHERE name = 'portal_game_key';

  IF v_api IS NULL OR v_game IS NULL THEN
    RAISE NOTICE 'portal_api_key / portal_game_key が Vault に未登録のため送信をスキップ';
    RETURN;
  END IF;

  PERFORM net.http_get(
    url := 'https://games-alchemist.com/api/portal/online-count/'
        || '?game_key='     || v_game
        || '&api_key='      || v_api
        || '&online_count=' || cnt
  );
END;
$$;

REVOKE ALL ON FUNCTION report_online_count() FROM anon, authenticated;

-- ④ 5分おきに実行（同名ジョブがあれば置き換え）
SELECT cron.unschedule('report-online-count')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'report-online-count');
SELECT cron.schedule('report-online-count', '*/5 * * * *', 'SELECT report_online_count()');

-- =====================================================================
-- 【動作確認】
--   手動で1回送信:  SELECT report_online_count();
--   送信結果の確認: SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
--   現在のカウント: SELECT count(*) FROM profiles
--                   WHERE last_action_at > now() - interval '5 minutes';
--   ジョブ確認:     SELECT * FROM cron.job;
-- =====================================================================
