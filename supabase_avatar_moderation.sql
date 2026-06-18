-- ============================================================
-- アバターモデレーション（管理者による不適切画像の削除）2026-06-11
--  admin_remove_player_avatar(対象プレイヤーID):
--   ・呼び出し元が is_admin であることを確認
--   ・対象プレイヤーの avatar_url を NULL に（デフォルト表示へ戻す）
--   ・avatars バケット内の対象プレイヤーのアップロードファイルを全削除
-- Supabase の SQL Editor で実行してください
-- ============================================================

CREATE OR REPLACE FUNCTION admin_remove_player_avatar(p_player_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller   uuid;
  v_is_admin boolean;
  v_deleted  int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN json_build_object('error', '権限がありません');
  END IF;

  -- アバターURLをリセット（デフォルト表示に戻る）
  UPDATE profiles SET avatar_url = NULL WHERE id = p_player_id;

  -- アップロード済みファイルをストレージから削除
  DELETE FROM storage.objects
  WHERE bucket_id = 'avatars' AND name LIKE p_player_id::text || '/%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN json_build_object('success', true, 'deleted_files', v_deleted);
END;
$$;
