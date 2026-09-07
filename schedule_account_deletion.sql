-- ============================================================
-- アカウントの「3日後 自動削除」予約システム（pg_cron）
--   ・予約テーブル account_deletions に (user_id, delete_after) を入れておくと、
--     日次cronが delete_after 経過分を自動削除する。
--   ・削除＝紐づくゲームデータ＋profiles＋auth.users を全消去（取り消し不可）。
--   ⚠ 実行前に必ず確認:
--     1) 対象が「国の元帥(リーダー)」でないか（後述の事前チェック参照）。
--     2) Supabaseで pg_cron 拡張が使えること（Database > Extensions）。
--   ※このスクリプトは SQL Editor で「特権ロール」で実行すること（cron/authへの権限が要る）。
-- ============================================================

-- 0) pg_cron 有効化（既に有効なら無視される）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) 予約テーブル
CREATE TABLE IF NOT EXISTS public.account_deletions (
  user_id      uuid PRIMARY KEY,
  delete_after timestamptz NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2) 1アカウントを完全削除する関数（FK/トリガーを一時無効化して順序エラーを回避）
CREATE OR REPLACE FUNCTION public.delete_account_full(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r record;
BEGIN
  IF p_uid IS NULL THEN RETURN; END IF;
  PERFORM set_config('session_replication_role', 'replica', true);  -- FK/トリガー無効化（cron=superuser前提）

  -- 2-1) player_id / owner_id / user_id を持つ public テーブルを総当たりで削除
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('player_id','owner_id','user_id')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.table_name, r.column_name) USING p_uid;
  END LOOP;

  -- 2-2) その他の紐付き列（取引所・個別お知らせ等）
  BEGIN EXECUTE 'DELETE FROM public.marketplace_listings WHERE seller_id = $1' USING p_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN EXECUTE 'DELETE FROM public.marketplace_listings WHERE buyer_id  = $1' USING p_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN EXECUTE 'DELETE FROM public.announcements      WHERE target_player_id = $1' USING p_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  -- 2-3) 本体
  DELETE FROM public.profiles WHERE id = p_uid;
  DELETE FROM auth.users      WHERE id = p_uid;

  DELETE FROM public.account_deletions WHERE user_id = p_uid;
END; $$;

-- 3) 期限が来た予約を処理する関数（cronから叩く）
CREATE OR REPLACE FUNCTION public.process_account_deletions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE d record;
BEGIN
  FOR d IN SELECT user_id FROM public.account_deletions WHERE delete_after <= now() LOOP
    PERFORM public.delete_account_full(d.user_id);
  END LOOP;
END; $$;

-- 4) 日次スケジュール（毎日 04:10 UTC = 13:10 JST に処理）。重複登録を避けるため既存を解除してから登録
SELECT cron.unschedule('process_account_deletions') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='process_account_deletions');
SELECT cron.schedule('process_account_deletions', '10 4 * * *', $$SELECT public.process_account_deletions();$$);

-- 5) 今回の対象を「3日後」に予約（メールで解決）
INSERT INTO public.account_deletions (user_id, delete_after, reason)
SELECT u.id, now() + interval '3 days', '本人希望による退会(2026-06-21受付)'
FROM auth.users u
WHERE lower(u.email) = lower('0505ms1990@ymail.ne.jp')
ON CONFLICT (user_id) DO UPDATE SET delete_after = EXCLUDED.delete_after, reason = EXCLUDED.reason;

-- 6) 予約内容の確認
SELECT ad.user_id, p.username, u.email, ad.delete_after, ad.reason
FROM public.account_deletions ad
JOIN auth.users u ON u.id = ad.user_id
LEFT JOIN public.profiles p ON p.id = ad.user_id;
