-- ============================================================
-- モンスター図鑑のリセット（検証用・2026-08-26）
-- ------------------------------------------------------------
-- おれおれおの「倒した敵」と「拾ったことのある素材」を消して、
-- 図鑑をまっさらな状態（全部 ???）に戻す。
--
-- ⚠消えるのは**図鑑の記録だけ**。持ち物・装備・素材の個数・踏破状況はそのまま。
-- ⚠supabase_v2_core.sql を流し直しても元に戻らない
--   （素材の拾い直しは v2_migrations で1回きりにしてある）。
--   もう一度まっさらにしたいときは、このファイルをまた流せばよい。
--
-- 名前を変えれば他のプレイヤーにも使える。全員ぶん消すなら where を外す。
-- ============================================================
do $$
declare
  v_uid uuid;
  v_k   int;
  v_m   int;
begin
  select id into v_uid from public.v2_profiles where username = 'おれおれお';
  if v_uid is null then
    raise exception 'おれおれお が見つかりません（v2_profiles.username）';
  end if;

  delete from public.v2_kills where player_id = v_uid;
  get diagnostics v_k = row_count;
  delete from public.v2_dex_materials where player_id = v_uid;
  get diagnostics v_m = row_count;

  raise notice '図鑑をリセットしました： 討伐の記録 % 件 ／ 素材の記録 % 件', v_k, v_m;
end $$;

-- 確認（0 と 0 になっていればまっさら）
select
  (select count(*) from public.v2_kills k
     join public.v2_profiles p on p.id = k.player_id where p.username = 'おれおれお') as 討伐の記録,
  (select count(*) from public.v2_dex_materials d
     join public.v2_profiles p on p.id = d.player_id where p.username = 'おれおれお') as 素材の記録;
