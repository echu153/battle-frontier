-- ============================================================
-- 開発限定機能アクセス検知＋管理者（おれおれお）通知
--   ・非管理者が開発限定機能（/status /idle /tenkyuu /war・アリーナ・対人戦・自動出撃）に
--     触れるとクライアントが log_dev_access RPC を呼び、dev_access_logs に記録。
--   ・同時に おれおれお 宛の個別お知らせ（運営からのお知らせバナー）を自動生成。
--     同一プレイヤー×同一機能は1時間に1通まで（連打スパム防止。ログは全件残る）。
--   ・管理者本人のアクセスは記録しない（正規利用）。
--   ・保護列は触らないため SET LOCAL "app.allow_stat_change" は不要。
--   ・適用順の鉄則（mutant_gold_20260703.sql v2 を最後に）とは無関係＝いつ適用してもOK。
-- ============================================================

-- 1) 記録テーブル
CREATE TABLE IF NOT EXISTS dev_access_logs (
  id         bigserial PRIMARY KEY,
  player_id  uuid NOT NULL,
  username   text,
  feature    text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dev_access_logs_player_feature
  ON dev_access_logs (player_id, feature, created_at DESC);

ALTER TABLE dev_access_logs ENABLE ROW LEVEL SECURITY;
-- 閲覧は管理者のみ。書き込みポリシーは作らない＝クライアント直INSERT不可（RPC経由のみ）
DROP POLICY IF EXISTS dev_access_logs_admin_read ON dev_access_logs;
CREATE POLICY dev_access_logs_admin_read ON dev_access_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND COALESCE(is_admin, false)));

-- 2) 記録＋通知RPC
CREATE OR REPLACE FUNCTION log_dev_access(p_feature text, p_detail text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_row      profiles%ROWTYPE;
  v_admin_id uuid;
  v_cnt      int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid;
  IF v_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_profile');
  END IF;
  -- 管理者本人は記録しない（正規利用）
  IF COALESCE(v_row.is_admin, false) THEN
    RETURN json_build_object('ok', true, 'logged', false);
  END IF;
  -- 入力ガード（長文・NULL対策）
  IF p_feature IS NULL OR length(p_feature) = 0 OR length(p_feature) > 64
     OR (p_detail IS NOT NULL AND length(p_detail) > 200) THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid');
  END IF;

  INSERT INTO dev_access_logs (player_id, username, feature, detail)
  VALUES (v_uid, v_row.username, p_feature, p_detail);

  -- 直近1時間の同一プレイヤー×同一機能のログ件数（今の1件を含む）。
  -- 2件以上＝この1時間内に通知済みなのでお知らせは追加しない。
  SELECT count(*) INTO v_cnt FROM dev_access_logs
   WHERE player_id = v_uid AND feature = p_feature
     AND created_at > now() - interval '1 hour';
  IF v_cnt <= 1 THEN
    SELECT id INTO v_admin_id FROM profiles WHERE username = 'おれおれお' LIMIT 1;
    IF v_admin_id IS NOT NULL THEN
      INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
      VALUES (
        '⚠ 開発限定機能アクセス検知',
        'プレイヤー「' || COALESCE(v_row.username, '(名前なし)') || '」が開発限定機能に触れました。' || E'\n'
          || '機能: ' || p_feature
          || COALESCE(E'\n' || '詳細: ' || p_detail, '') || E'\n'
          || '※詳細な履歴は dev_access_logs テーブルを確認してください。',
        'update', true, now(), v_admin_id
      );
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'logged', true);
END;
$$;

REVOKE ALL ON FUNCTION log_dev_access(text, text) FROM public;
GRANT EXECUTE ON FUNCTION log_dev_access(text, text) TO authenticated;

-- 確認
SELECT 'dev_access_watch applied' AS status;
