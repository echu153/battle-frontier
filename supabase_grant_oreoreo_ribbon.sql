-- おれおれお にリボンを1つ付与（2026-07-07）
--   ctype='rib_phys'（物理ダメ+5%）を1つ。他にしたい場合は rib_spec(特殊+5%) / rib_wall(防御特防+6%)
insert into player_charms(owner_id, ctype)
  select id, 'rib_phys' from profiles where username = 'おれおれお';

-- 付与結果の確認
select id, ctype, atk, spatk, def, spdef, hp
  from player_charms
 where owner_id = (select id from profiles where username = 'おれおれお')
   and ctype like 'rib_%';
