-- ============================================================
-- 他人のプロフィール（ランキング経由）でペット・チャームを閲覧可能にする (2026-06-11)
--   従来: pets / player_charms の SELECT が owner 限定だったため、
--         他人のプロフィールではペットが空表示になっていた。
--   変更: 全員が SELECT 可能な公開読み取りポリシーを追加（参照のみ）。
--         INSERT/UPDATE/DELETE は従来どおり owner 限定なので改ざん不可。
-- ============================================================

-- pets: 公開読み取り
drop policy if exists pets_select_public on pets;
create policy pets_select_public on pets for select using (true);
-- 旧 owner 限定SELECTは公開版に内包されるため不要（残っていても害はないが整理）
drop policy if exists pets_select_own on pets;

-- player_charms: 公開読み取り
drop policy if exists player_charms_select_public on player_charms;
create policy player_charms_select_public on player_charms for select using (true);
drop policy if exists player_charms_select_own on player_charms;
