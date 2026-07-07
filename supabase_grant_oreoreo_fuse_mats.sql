-- ============================================================
-- おれおれお にリボン合成/解除のテスト素材を付与（2026-07-07）
--   合成/解除は各回 神秘の欠片1＋ゼニ10000。欠片50＋ゼニ50万を付与（約50回ぶん）。
--   ※ゼニは所持(zeni)へ付与。ダンジョンの秘密の商店/合成で使える。
-- ============================================================
insert into pet_storage(owner_id, item_key, qty)
  select id, 'shard', 50 from profiles where username = 'おれおれお'
  on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 50;

insert into pet_storage(owner_id, item_key, qty)
  select id, 'zeni', 500000 from profiles where username = 'おれおれお'
  on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 500000;

-- 付与結果の確認
select item_key, qty from pet_storage
 where owner_id = (select id from profiles where username = 'おれおれお')
   and item_key in ('shard', 'zeni');
