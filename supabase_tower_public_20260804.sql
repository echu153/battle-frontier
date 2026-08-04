-- ============================================================
-- エンドレスタワー：一般公開（2026-08-04）
-- ------------------------------------------------------------
-- 入場条件を is_admin 限定から「キャラクターLV1000以上」へ切り替える。
-- ・キャラクターLVは全クラス通算のレベルアップ回数（profiles.char_lv）。
-- ・is_admin は引き続き無条件で入れる（動作確認用）。
-- ・クライアント側の解放判定は src/lib/tower.js の TOWER_UNLOCK_CHAR_LV。
--   数値を変えるときは必ず両方そろえること（権威はこのサーバー側）。
-- ・supabase_tower.sql 本体にも同じ内容を反映済み。
-- ・apply_battle_result は触らないので、SQL適用順の鉄則には影響しない。
--
-- ⚠先に supabase_tower_harden_20260804.sql（公開前の穴埋め）を流しておくこと。
-- ============================================================

CREATE OR REPLACE FUNCTION tower_can_enter(p_profile profiles) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_profile.is_admin, false) OR COALESCE(p_profile.char_lv, 1) >= 1000
$$;

-- 確認用：条件を満たすプレイヤーが何人いるか
-- SELECT count(*) FILTER (WHERE COALESCE(char_lv,1) >= 1000) AS 入れる人数,
--        count(*)                                            AS 全体,
--        max(char_lv)                                        AS 最高キャラクターLV
--   FROM profiles WHERE COALESCE(is_suspended,false) = false;
