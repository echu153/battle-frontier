-- ============================================================
-- スキルの書 追加5種（初期クラス分・2026-07-07）
--   強撃(戦士)/貫通射撃(弓使い)/サンダー(魔法使い)/ヒール(僧侶)/爆裂拳(格闘家)
--   これで全21クラスの書が揃う。pet_item_price を21種対応で上書き。
--   ※ pet_grant_item / pet_consume_item は pet_item_price が null でないことを要件に
--     しているため、これを流さないと新しい書を拾う/使うことができない。
-- ============================================================
create or replace function pet_item_price(p_key text)
returns int language sql immutable set search_path = public as $$
  select case p_key
    when 'escape' then 500 when 'onigiri' then 200 when 'konomi' then 300 when 'rename' then 100000
    when 'atk_seed' then 0 when 'spatk_seed' then 0 when 'def_seed' then 0 when 'spdef_seed' then 0 when 'hp_seed' then 0
    when 'shard' then 0
    -- スキルの書（買えない＝0。ダンジョンドロップ専用）
    when 'scr_iai' then 0 when 'scr_sutemi' then 0 when 'scr_sanren' then 0 when 'scr_shunpo' then 0
    when 'scr_quake' then 0 when 'scr_soul' then 0 when 'scr_inori' then 0 when 'scr_sabaki' then 0
    when 'scr_kori' then 0 when 'scr_mind' then 0 when 'scr_goren' then 0 when 'scr_gun' then 0
    when 'scr_dice' then 0 when 'scr_raikou' then 0 when 'scr_seiiki' then 0 when 'scr_dragon' then 0
    -- ★初期クラス5種の書（2026-07-07追加）
    when 'scr_kyogeki' then 0 when 'scr_kantsu' then 0 when 'scr_thunder' then 0
    when 'scr_heal' then 0 when 'scr_bakuretsu' then 0
    else null end;
$$;
grant execute on function pet_item_price(text) to authenticated;
