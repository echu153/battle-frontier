-- ============================================================
-- 博物館 寄贈ボーナス倍率アップ（2026-08-08）／全5ファイル
--   1_backup   … バックアップ作成         ← 最初に必ず
--   2_check    … 事前チェック（読むだけ）  ← 全部0なら安全
--   3_preview  … 変化プレビュー（読むだけ）
--   4_apply    … 本体（★これだけがデータを変える）
--   5_rollback … 戻す（問題が出た時だけ）
-- ============================================================
-- 【このファイル①】museum_* の現在値をバックアップ表に退避する。
--   これを取っておけば 4_apply はいつでも 5_rollback で元に戻せる。
--   3文まとめて実行してよい。実行済みでも安全（IF NOT EXISTS）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.museum_backup_20260808 AS
SELECT id, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp
  FROM public.profiles;

-- public の新規テーブルは既定で anon/authenticated に権限が付き、RLS無しだと
-- APIから誰でも読み書きできてしまう。触れるのを service_role だけに絞る。
ALTER TABLE public.museum_backup_20260808 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.museum_backup_20260808 FROM anon, authenticated;
