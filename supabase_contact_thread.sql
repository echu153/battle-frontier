-- ============================================================
-- お問い合わせの往復（スレッド）対応
--   ・初回質問(contact_messages.body)＋初回運営返信(contact_messages.reply)はそのまま。
--   ・それ以降の往復を contact_thread に蓄積（ユーザー⇔運営）。
--   ・ユーザーは運営の返信に返信でき、運営も続けて返信できる（毎回新規問い合わせ不要）。
-- ============================================================

-- 1) 往復メッセージテーブル
CREATE TABLE IF NOT EXISTS public.contact_thread (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contact_messages(id) ON DELETE CASCADE,
  sender     text NOT NULL CHECK (sender IN ('user','admin')),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_thread_contact_idx ON public.contact_thread(contact_id, created_at);

ALTER TABLE public.contact_thread ENABLE ROW LEVEL SECURITY;

-- 閲覧: 親問い合わせの本人 or 管理人(おれおれお)
DROP POLICY IF EXISTS contact_thread_select ON public.contact_thread;
CREATE POLICY contact_thread_select ON public.contact_thread
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.contact_messages c WHERE c.id = contact_id AND c.player_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.username = 'おれおれお')
  );
-- 追記は RPC 経由のみ（INSERTポリシーは作らない）

-- 2) スレッドへの追記 RPC（送信者ロールはサーバー側で判定）
CREATE OR REPLACE FUNCTION public.contact_post_message(p_contact_id uuid, p_body text)
RETURNS public.contact_thread
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_owner    uuid;
  v_sender   text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_row      public.contact_thread;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'メッセージを入力してください'; END IF;
  IF char_length(v_body) > 2000 THEN RAISE EXCEPTION 'メッセージが長すぎます（2000文字以内）'; END IF;

  SELECT player_id INTO v_owner FROM public.contact_messages WHERE id = p_contact_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION '対象のお問い合わせが見つかりません'; END IF;

  SELECT (username = 'おれおれお') INTO v_is_admin FROM public.profiles WHERE id = v_uid;
  IF COALESCE(v_is_admin, false) THEN
    v_sender := 'admin';
  ELSIF v_owner = v_uid THEN
    v_sender := 'user';
  ELSE
    RAISE EXCEPTION '権限がありません';
  END IF;

  INSERT INTO public.contact_thread (contact_id, sender, body)
  VALUES (p_contact_id, v_sender, v_body)
  RETURNING * INTO v_row;

  -- 運営メッセージのときは親の reply_at を進める＝ユーザーの「未読返信」判定(reply_atベース)を継続利用
  IF v_sender = 'admin' THEN
    UPDATE public.contact_messages
       SET reply_at = now()
     WHERE id = p_contact_id AND (reply_at IS NULL OR reply_at < now());
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contact_post_message(uuid, text) TO authenticated;
