-- ============================================================
-- 「釣り中(is_fishing=true)」から抜けられないプレイヤーの救済
--   ・fishing_started_at が無効(null)のまま is_fishing=true で固まっているケースを解除。
--   ・特定プレイヤーを解除したい場合は username 指定版を使う。
-- ============================================================

-- ① 異常状態（is_fishing=true なのに開始時刻が無い）を一括解除
UPDATE profiles
SET is_fishing = false, fishing_location = NULL, fishing_started_at = NULL
WHERE is_fishing = true AND fishing_started_at IS NULL;

-- ② 報告のあった「釣り中」固着プレイヤーを強制終了（開始時刻は有効だが抜けられない人）
--    ※釣果は付与されない（フラグ解除のみ）。本人は再度釣りをやり直せる。
UPDATE profiles
SET is_fishing = false, fishing_location = NULL, fishing_started_at = NULL
WHERE username IN ('哀','アズサ','水狼','ここにゃん','ツキミ','えるもあ');

-- （任意）現在「釣り中」の全員を一括終了したい場合はこちら
-- UPDATE profiles SET is_fishing = false, fishing_location = NULL, fishing_started_at = NULL WHERE is_fishing = true;

-- 確認: まだ釣り中のプレイヤー一覧
SELECT username, is_fishing, fishing_started_at
FROM profiles
WHERE is_fishing = true
ORDER BY fishing_started_at NULLS FIRST;
