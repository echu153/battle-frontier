-- ============================================================
-- profiles.is_admin（管理者権限フラグ）をクライアントの通常UPDATEから保護する。
--
-- 背景：クライアントは profiles を直接UPDATEするモデルだが、既存の保護トリガー
--       (supabase_protect_stats.sql) が守るのは stat_point_spent / pending_stat_points /
--       lv / char_lv / exp / retraining のみで、is_admin は対象外だった。
--       is_admin はゲーム全体の管理者判定（AI相談の許可・無制限quota・奈落リセット・
--       アバター審査・レイドdev 等）に使われるため、自己昇格を許すと全特権を突破できる。
--
-- 対策：is_admin の変更を、GUC app.allow_stat_change='on' のとき（＝service_role/管理RPC経由）
--       以外は拒否する。既存の保護方式と同じ作法。
--
-- 適用：手動で is_admin を変更する管理SQLは、先頭に
--          SET LOCAL "app.allow_stat_change" = 'on';
--       を付けてトランザクション内で実行すること（例：BEGIN; SET LOCAL ...; UPDATE ...; COMMIT;）。
--       供与済みの supabase_protect_stats.sql とは独立した追加トリガーなので、本ファイル単体で適用可。
-- ============================================================

create or replace function public.protect_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if current_setting('app.allow_stat_change', true) is distinct from 'on' then
    if NEW.is_admin is distinct from OLD.is_admin then
      raise exception '不正な操作です（管理者権限はサーバ経由でのみ変更できます）';
    end if;
  end if;
  return NEW;
end;
$func$;

drop trigger if exists trg_protect_admin_columns on public.profiles;
create trigger trg_protect_admin_columns
  before update on public.profiles
  for each row
  execute function public.protect_admin_columns();

-- 確認：一般ユーザーとして自分の行に is_admin=true を送ると失敗することをテストする。
--   （allow_stat_change を立てていない通常UPDATEは上記 RAISE で弾かれる）
