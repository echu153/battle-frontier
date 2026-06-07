-- 釣りボーナス永続化（基礎列の再計算で消えるバグの修正）
-- 博物館(museum_*)と同様に専用列へ分離する。
-- ※ デプロイ前（または直後すぐ）に本SQLを実行してください。
--   コード側は列が無い間も読み取りは 0 扱いで安全、書き込みは列作成後に自動復元されます。

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS fishing_atk  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_def  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_matk integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_mdef integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_spd  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_hp   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fishing_mp   integer NOT NULL DEFAULT 0,
  -- コンプリートボーナス受取済みの釣り場名（二重取得防止）
  ADD COLUMN IF NOT EXISTS fishing_completed text[] NOT NULL DEFAULT '{}',
  -- 旧仕様で消えた分を fishing_records から一度だけ自動復元するためのフラグ
  ADD COLUMN IF NOT EXISTS fishing_migrated boolean NOT NULL DEFAULT false;

-- 復元はクライアント側（Fishing/StatusDetail を開いた時）に fishing_records から
-- 自動計算して fishing_* へ書き込み、fishing_migrated=true にする。
-- 全員に即時反映したい場合のみ、各プレイヤーが釣り場/ステータス詳細を開けば確定する。
