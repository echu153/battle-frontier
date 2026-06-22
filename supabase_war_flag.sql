-- ============================================================
-- 戦争コンテンツ用 グローバルフラグ（管理者が手動でON/OFF）
--   ・game_flags.war_active が true の間、通常出撃のバトル中のみ全員HP+20000（クライアント側で付与）。
--   ・全員に読み取り許可（クライアントが参照）。書き込みは管理者のみ。
--   ・既定 OFF。
-- ============================================================
CREATE TABLE IF NOT EXISTS public.game_flags (
  key        text PRIMARY KEY,
  bool_value boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.game_flags (key, bool_value) VALUES ('war_active', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.game_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_flags_read_all ON public.game_flags;
CREATE POLICY game_flags_read_all ON public.game_flags FOR SELECT USING (true);

-- 書き込みは is_admin のみ
DROP POLICY IF EXISTS game_flags_admin_write ON public.game_flags;
CREATE POLICY game_flags_admin_write ON public.game_flags FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- ============== 戦争 ON/OFF の切り替え（管理者が手動で実行） ==============
-- 戦争 開始:
--   UPDATE public.game_flags SET bool_value = true,  updated_at = now() WHERE key = 'war_active';
-- 戦争 終了:
--   UPDATE public.game_flags SET bool_value = false, updated_at = now() WHERE key = 'war_active';

-- 現在の状態確認:
SELECT key, bool_value, updated_at FROM public.game_flags WHERE key = 'war_active';
