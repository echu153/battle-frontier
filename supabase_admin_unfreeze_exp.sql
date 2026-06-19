-- ============================================================
-- 管理者アカウントのEXP凍結を解除（2026-06-20 診断＋修正）
--   症状: 出撃してもEXPが増えない／レベルアップ表示は出るが実際は上がらない。
--   原因候補: 不正検知の誤発動で exp_frozen / exp_frozen_until が立ち、獲得EXP=0になっている。
--   ※ exp_frozen / exp_frozen_until / suspicious_flag は protect_stats の保護対象外＝GUC不要で更新可。
-- ============================================================

-- ① 診断（現状確認）
SELECT username, lv, exp, exp_next, exp_frozen, exp_frozen_until, suspicious_flag, is_admin
FROM profiles WHERE is_admin = true;

-- ② 凍結解除（is_admin のみ）
UPDATE profiles
  SET exp_frozen = false,
      exp_frozen_until = NULL,
      suspicious_flag = false
WHERE is_admin = true;
