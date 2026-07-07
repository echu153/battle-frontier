-- おれおれお にフェイトコアを付与（2026-07-07）
--   特殊能力の再抽選 pet_charm_reroll は1回につきフェイトコア1個。20個付与。
insert into pet_storage(owner_id, item_key, qty)
  select id, 'fatecore', 20 from profiles where username = 'おれおれお'
  on conflict (owner_id, item_key) do update set qty = pet_storage.qty + 20;

select item_key, qty from pet_storage
 where owner_id = (select id from profiles where username = 'おれおれお')
   and item_key = 'fatecore';
