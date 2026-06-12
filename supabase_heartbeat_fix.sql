-- ============================================================
-- heartbeat がクールダウンを潰す不具合の修正 (2026-06-12)
--   原因: 同時接続カウント用 heartbeat() が profiles.last_action_at（＝出撃CDの起点）
--         を now() で上書きしていた。App は起動時・タブ復帰時・2分ごとに heartbeat を
--         呼ぶため、「ブラウザ起動直後は確定でCD10秒」「プレイ中も時々CDがリセット」
--         という症状になっていた。
--   修正: heartbeat はオンライン判定専用の last_seen_at 列に書き、
--         last_action_at（出撃CD）には一切触れない。
--         集計は last_seen_at / last_action_at のどちらか新しい方で判定
--         （戦闘行動もオンラインの証拠なのでカウント精度は維持）。
--   クライアント変更: 不要（RPC名そのまま）。
-- ============================================================

-- ① オンライン判定専用列
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- ② heartbeat を last_seen_at 書き込みに変更（last_action_at には触れない）
CREATE OR REPLACE FUNCTION heartbeat() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_seen_at = now() WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION heartbeat() FROM anon;
GRANT EXECUTE ON FUNCTION heartbeat() TO authenticated;

-- ③ 集計は last_seen_at / last_action_at の新しい方
CREATE OR REPLACE FUNCTION report_online_count() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cnt int;
  v_api text;
  v_game text;
BEGIN
  SELECT count(*) INTO cnt
    FROM profiles
   WHERE GREATEST(COALESCE(last_seen_at, '-infinity'), COALESCE(last_action_at, '-infinity'))
         > now() - interval '5 minutes';

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
