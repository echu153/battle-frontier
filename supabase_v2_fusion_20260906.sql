-- ============================================================
-- バトルフロンティアⅡ（リメイク版）— 合成素材と「合成」
--   2026-09-06 ／ **②本目**
-- ------------------------------------------------------------
-- ★流す順（レイドまわりは4本あります）
--     ① supabase_v2_friends_20260906.sql   フレンド
--     ② supabase_v2_fusion_20260906.sql    合成素材と「合成」
--     ③ supabase_v2_raid_20260906.sql      レイドボスと救援
--   どれも supabase_v2_core.sql を全文流したあとに、**この順番で**流してください。
--
-- ★③④はこのファイルの v2_fusion_materials / v2_player_fusions に依存します。
--
-- 設計は docs/v2-raid-design.md。数値の正は src/v2/lib/ 以下で、
-- **このファイルには同じ値の写しが入っている**（raid.test.js が突き合わせる）。
-- ============================================================

-- ============================================================
-- 合成素材の名簿と所持
-- ------------------------------------------------------------
-- 合成素材は**ユニークボスと共通の新カテゴリ**（2026-09-06 ユーザー決定）。
-- 名簿の正は src/v2/lib/fusion.js。ここは名簿の写しと所持数を持つ。
-- ============================================================
create table if not exists public.v2_fusion_materials (
  id     text primary key,       -- 'fu:<ボスのkey>'
  name   text not null,
  source text not null default 'raid',   -- raid / unique
  boss   text not null,
  crown  text not null           -- 合成した武器の頭に付く名前（「黒龍の鋼剣」の「黒龍」）
);
alter table public.v2_fusion_materials enable row level security;
drop policy if exists "v2_fusion_materials_read" on public.v2_fusion_materials;
create policy "v2_fusion_materials_read" on public.v2_fusion_materials for select to authenticated using (true);
revoke all on table public.v2_fusion_materials from anon;
grant select on table public.v2_fusion_materials to authenticated;

-- ★名簿は src/v2/lib/fusion.js が正。**このINSERTは fusion.js から機械的に作っている**
--   （tools/v2-fusion-sql.mjs で貼り直せる）。行数は敵270体＋レイドボス5体＝275。
insert into public.v2_fusion_materials (id, name, source, boss, crown) values
  ('fu:varuzenoku', '黒龍の逆鱗', 'raid', '黒龍ヴァルゼノク', '黒龍'),
  ('fu:amaza', '雨摩座の涙石', 'raid', '雨摩座', '雨摩座'),
  ('fu:zerugiasu', '雷鋼の動力核', 'raid', '雷鋼機神ゼルギアス', '雷鋼'),
  ('fu:enma', '閻魔の冥銭', 'raid', '閻魔', '閻魔'),
  ('fu:guraudiosu', '炎獄の熾火片', 'raid', '炎獄王グラウディオス', '炎獄')
on conflict (id) do update set
  name = excluded.name, source = excluded.source, boss = excluded.boss, crown = excluded.crown;

create table if not exists public.v2_player_fusions (
  player_id uuid not null references auth.users(id) on delete cascade,
  fusion_id text not null references public.v2_fusion_materials(id),
  qty       int  not null default 0 check (qty >= 0),
  primary key (player_id, fusion_id)
);
alter table public.v2_player_fusions enable row level security;
drop policy if exists "v2_player_fusions_own" on public.v2_player_fusions;
create policy "v2_player_fusions_own" on public.v2_player_fusions for select to authenticated
  using (player_id = auth.uid());
revoke all on table public.v2_player_fusions from anon;
grant select on table public.v2_player_fusions to authenticated;

-- ============================================================
-- 合成（鍛冶屋の「合成」タブ）
-- ------------------------------------------------------------
-- 武器1個 ＋ 合成素材1個 → その武器に特殊能力が付き、名前が「◯◯の××」になる。
-- ★名前は保存しない（equip_id から素の名前が引けるので、fused から毎回作る）。
-- ★強化はこれまで通り＝ v2_fuse は equip_id で見ているので、合成していても
--   「同じ武器名」であれば強化元にも強化素材にもできる（ユーザー指示）。
-- ============================================================
alter table public.v2_inventory add column if not exists fused text;

create or replace function public.v2_fuse_weapon(p_inv_id bigint, p_fusion_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_inv public.v2_inventory;
  v_part text;
  v_boss text;
  v_qty int;
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発中の機能です'); end if;
  select * into v_inv from public.v2_inventory where id = p_inv_id and player_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;

  select e.part into v_part from public.v2_equipment e where e.id = v_inv.equip_id;
  if v_part is distinct from '武器' then
    return jsonb_build_object('ok', false, 'error', '合成できるのは武器だけです');
  end if;

  select boss into v_boss from public.v2_fusion_materials where id = p_fusion_id;
  if v_boss is null then return jsonb_build_object('ok', false, 'error', 'その合成素材はありません'); end if;

  select qty into v_qty from public.v2_player_fusions
   where player_id = v_me and fusion_id = p_fusion_id for update;
  if coalesce(v_qty, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'その合成素材を持っていません'); end if;

  update public.v2_player_fusions set qty = qty - 1 where player_id = v_me and fusion_id = p_fusion_id;
  update public.v2_inventory set fused = v_boss where id = p_inv_id returning * into v_inv;

  return jsonb_build_object('ok', true, 'inv', to_jsonb(v_inv));
end;
$$;
revoke all on function public.v2_fuse_weapon(bigint, text) from public;
revoke all on function public.v2_fuse_weapon(bigint, text) from anon;
grant execute on function public.v2_fuse_weapon(bigint, text) to authenticated;

-- ---- 動作確認用（開発限定）：合成素材を配る ----
create or replace function public.v2_debug_grant_fusion(p_fusion_id text, p_count int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if not exists (select 1 from public.v2_fusion_materials where id = p_fusion_id) then
    return jsonb_build_object('ok', false, 'error', 'その合成素材はありません');
  end if;
  insert into public.v2_player_fusions (player_id, fusion_id, qty)
  values (v_me, p_fusion_id, greatest(1, coalesce(p_count, 1)))
  on conflict (player_id, fusion_id) do update
    set qty = public.v2_player_fusions.qty + greatest(1, coalesce(p_count, 1));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2_debug_grant_fusion(text, int) from public;
revoke all on function public.v2_debug_grant_fusion(text, int) from anon;
grant execute on function public.v2_debug_grant_fusion(text, int) to authenticated;
