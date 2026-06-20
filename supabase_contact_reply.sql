-- ============================================================
-- お問い合わせ返信機能
--   ・contact_messages に返信列(reply / reply_at / replied_by)を追加
--   ・本人は自分の問い合わせを、is_admin は全件を閲覧可能（SELECTポリシー）
--   ・is_admin がアプリ内から直接返信できる RPC admin_reply_contact
-- ============================================================

-- 1) 返信用カラム
ALTER TABLE contact_messages
  ADD COLUMN IF NOT EXISTS reply       text,
  ADD COLUMN IF NOT EXISTS reply_at    timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by  uuid;

-- 2) RLS（行レベルセキュリティ）
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- 本人 or 管理人(おれおれお)のみ閲覧可。
-- ※ 他の is_admin（えちゅ等の開発アカウント）には全件を見せない＝お問い合わせ管理は管理人専用。
DROP POLICY IF EXISTS contact_select_own_or_admin ON contact_messages;
CREATE POLICY contact_select_own_or_admin ON contact_messages
  FOR SELECT TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.username = 'おれおれお')
  );

-- 送信（INSERT）は本人のみ（既存に同等ポリシーがあれば重複してもこのDROP/CREATEで上書き）
DROP POLICY IF EXISTS contact_insert_self ON contact_messages;
CREATE POLICY contact_insert_self ON contact_messages
  FOR INSERT TO authenticated
  WITH CHECK (player_id = auth.uid());

-- 3) 管理者がお問い合わせに返信する RPC（SECURITY DEFINER で reply 列を更新）
CREATE OR REPLACE FUNCTION admin_reply_contact(p_id uuid, p_reply text)
RETURNS contact_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_row contact_messages;
BEGIN
  SELECT username INTO v_username FROM profiles WHERE id = auth.uid();
  IF v_username IS DISTINCT FROM 'おれおれお' THEN
    RAISE EXCEPTION '権限がありません（管理人専用）';
  END IF;

  UPDATE contact_messages
     SET reply = p_reply,
         reply_at = now(),
         replied_by = auth.uid()
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION '対象のお問い合わせが見つかりません';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reply_contact(uuid, text) TO authenticated;

-- 確認
-- SELECT id, player_name, category, left(body,20) AS body, reply IS NOT NULL AS replied, reply_at
-- FROM contact_messages ORDER BY created_at DESC LIMIT 10;
