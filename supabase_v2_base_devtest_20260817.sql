-- ============================================================
-- 【開発テスト用・使い捨て】拠点の動作確認に必要なものを配る
-- ------------------------------------------------------------
-- 目的：まだ試せていない挙動（労働者の雇用・生産・拡張・配置替え・
--       上限が下がったときの自動回収・釣り場エリアの切り替え）を通すため。
--
-- ⚠**おれおれお（v2）だけが対象**。他のプレイヤーには一切触らない。
-- ⚠これは仕様ではなくテストの足場。**確認が終わったら流し直す必要はない**。
--   （拠点そのものは supabase_v2_core.sql に入っている）
--
-- 配るもの
--   ・Gold 1億（労働者9人の雇用費が合計およそ2,700万Gなので、余裕を見て）
--   ・資材3種 × グレードⅠ〜Ⅲ を各5,000個
--     └ グレードⅣ以降の拡張には エリア③以降の解放が要る（いまは①②まで）ので配らない
--   ・蓄積の起点を9時間前にずらす＝**その場で満杯の状態を作る**
--     └ 8時間待たずに「満杯です」「回収」「上限が下がったときの自動回収」を確かめられる
-- ============================================================

do $$
declare
  c_name constant text := 'おれおれお';   -- ★v2の冒険者名
  v_id   uuid;
begin
  select id into v_id from public.v2_profiles where username = c_name;
  if v_id is null then
    raise exception 'v2のキャラクター「%」が見つかりません', c_name;
  end if;
  if not exists (select 1 from public.v2_base where player_id = v_id) then
    raise exception '拠点がまだありません。先に拠点の画面を一度開いてください';
  end if;

  -- Gold
  update public.v2_profiles set gold = gold + 100000000, updated_at = now() where id = v_id;

  -- 資材（グレードⅠ〜Ⅲ）
  insert into public.v2_base_materials (player_id, kind, grade, qty)
  select v_id, k, g, 5000
    from unnest(array['wood', 'stone', 'mana']) as k,
         generate_series(1, 3) as g
  on conflict (player_id, kind, grade)
    do update set qty = public.v2_base_materials.qty + 5000;

  -- 蓄積の起点を9時間前へ＝満杯の状態を作る
  update public.v2_base_facilities
     set accrued_from = now() - interval '9 hours'
   where player_id = v_id;

  raise notice '拠点のテスト用データを配りました（%）', c_name;
end $$;

-- 確認用（実行後の状態）
select p.username, p.gold,
       (select jsonb_object_agg(m.kind || m.grade::text, m.qty)
          from public.v2_base_materials m where m.player_id = p.id) as materials,
       (select jsonb_object_agg(f.key, jsonb_build_object('grade', f.grade, 'workers', f.workers,
                                                          'spot', f.spot, 'pending', round(f.pending, 1)))
          from public.v2_base_facilities f where f.player_id = p.id) as facilities
  from public.v2_profiles p
 where p.username = 'おれおれお';
