-- ============================================================
-- 博物館 寄贈ボーナス倍率アップ（2026-08-08）／全5ファイル
--   1_backup   … バックアップ作成         ← 最初に必ず
--   2_check    … 事前チェック（読むだけ）  ← 全部0なら安全
--   3_preview  … 変化プレビュー（読むだけ）
--   4_apply    … 本体（★これだけがデータを変える）
--   5_rollback … 戻す（問題が出た時だけ）
-- ============================================================
-- 【このファイル⑤】★問題が出た時だけ実行★
--   1_backup で退避した値に museum_* を戻す（4_apply を取り消す）。
--   ・4_apply の後に寄贈した人の分も、バックアップ時点の値に戻る点に注意。
--   ・戻したら src/pages/Museum.jsx の倍率も元に戻すこと
--     （通常[1,2,4] / レア[2,3,6] / ボス[8,13,20] / COMPLETE_BONUS_MULT=[1,3,5]）。
-- ============================================================

UPDATE public.profiles p
   SET museum_atk  = b.museum_atk,
       museum_def  = b.museum_def,
       museum_matk = b.museum_matk,
       museum_mdef = b.museum_mdef,
       museum_spd  = b.museum_spd,
       museum_hp   = b.museum_hp,
       museum_mp   = b.museum_mp
  FROM public.museum_backup_20260808 b
 WHERE p.id = b.id;
