-- ============================================================
-- 退会処理の修正: 成立済みの取引履歴(sold)を消さない (2026-07-20)
-- ------------------------------------------------------------
-- 問題: delete_account_full が marketplace_listings を seller_id/buyer_id で
--   全削除していたため、退会者が売り手/買い手だった「成立済みの取引」まで
--   相手側の取引履歴から消えていた（「買った履歴が無い」報告の原因）。
-- 修正: sold の行は残す。削除するのは退会者の未成立出品(active/cancelled/expired)のみ。
--   残った sold 行の seller_id/buyer_id は profiles に相手がいない「宙ぶらり」になるが、
--   クライアントは「退会したユーザー」と表示するので問題ない
--   （削除処理は session_replication_role='replica' でFKチェックを無効化して走るため挿入可）。
-- 適用: このファイル単独で delete_account_full を置き換える。特権ロールで実行。
-- ============================================================
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

  -- 2-2) 取引所: 成立済み(sold)は取引履歴として残す。未成立の出品のみ削除
  BEGIN EXECUTE 'DELETE FROM public.marketplace_listings WHERE seller_id = $1 AND status <> ''sold''' USING p_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN EXECUTE 'DELETE FROM public.announcements WHERE target_player_id = $1' USING p_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  -- 2-3) 本体
  DELETE FROM public.profiles WHERE id = p_uid;
  DELETE FROM auth.users      WHERE id = p_uid;

  DELETE FROM public.account_deletions WHERE user_id = p_uid;
END; $$;
