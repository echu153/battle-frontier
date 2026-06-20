-- ============================================================
-- 「釣り中(is_fishing=true)」から抜けられないプレイヤーの救済
--   ・fishing_started_at が無効(null)のまま is_fishing=true で固まっているケースを解除。
--   ・特定プレイヤーを解除したい場合は username 指定版を使う。
-- ============================================================

-- ① 異常状態（is_fishing=true なのに開始時刻が無い）を一括解除
UPDATE profiles
SET is_fishing = false, fishing_location = NULL, fishing_started_at = NULL
WHERE is_fishing = true AND fishing_started_at IS NULL;

-- ② 特定プレイヤーを強制的に釣り終了させる場合（usernameを書き換えて実行）
-- UPDATE profiles
-- SET is_fishing = false, fishing_location = NULL, fishing_started_at = NULL
-- WHERE username = 'ここにユーザー名';

-- 確認: まだ釣り中のプレイヤー一覧
SELECT username, is_fishing, fishing_started_at
FROM profiles
WHERE is_fishing = true
ORDER BY fishing_started_at NULLS FIRST;
