-- ============================================================
-- スキルの書（消費アイテム）をサーバーに登録
--  - pet_item_price に16種を追加（価格0＝買えないが、ドロップ付与・使用の検証に必要）
--  - pet_is_inv_item は「だっしゅつの翼以外すべて true」なので変更不要（袋上限の対象）
--  ※ pet_grant_item / pet_consume_item は pet_item_price が null でないことを要件にしているため、
--    この関数を更新しないとスキルの書を拾う/使うことができない。
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
    else null end;
$$;
grant execute on function pet_item_price(text) to authenticated;
