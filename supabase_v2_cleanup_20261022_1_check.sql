-- ============================================================
-- V2 初期構成をデータベースから消す（2026-10-22）／全3ファイル
--   1_check      … 確かめ（読むだけ・何も変えない）  ← 最初に
--   2_stop_cron  … 5分ごとの v2-npc-tick を止める（あとから戻せる）
--   （ここで本番の関数 v2-npc-tick を消す。やり方は 3_drop の頭）
--   3_drop       … V2 の表・関数を消す（⚠戻せない）
--
-- ユーザー「データベースの V2 初期構成（v2_ の表・関数・5分ごとの v2-npc-tick の定期処理）を消す SQL を作って」
-- 2026-10-22 から Ⅱ＝v2cap（コードの V2 初期構成は dcb0987e で消した）。
-- v2cap の表・関数は名前が v2cap_ で始まるので、ここでは一切さわらない（v2_ の3文字目までで分ける）。
-- ============================================================
--
-- ★このファイルは1回の実行で1つの表を出す（SQL Editor は最後の結果しか見せないため）。
--   見るところ：
--   ・「定期処理」… v2-npc-tick が出ていれば ② で止める。ほかに出たものは名前を見て判断
--   ・「表」「関数」… これから消すもの（表は行数と大きさつき）
--   ・「⚠つながり」… **1行でも出たら ③ を流さない**（V2 以外のものが V2 の表を使っている）
--   ・「名前が出てくる関数」… V2 以外の関数の中身に V2 の名前がある（説明書きの中だけのこともある）。
--     出たら ③ の前に中身を見る（手元で V2・v2cap の SQL を全部流して試したときは 0 行だった）
with
v2_tables as (
  select c.oid, c.relname, c.relkind
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm')
     and left(c.relname, 3) = 'v2_'
),
v2_funcs as (
  select p.oid, p.proname
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and left(p.proname, 3) = 'v2_'
),
names as (
  select relname as name from v2_tables union select proname from v2_funcs
),
pattern as (
  select '[[:<:]](' || string_agg(name, '|') || ')[[:>:]]' as re from names
)
-- 定期処理
select 1 as 順, '定期処理' as 区分, j.jobname as 名前,
       j.schedule || '／' || case when j.active then '動いている' else '止まっている' end || '／' || left(j.command, 90) as くわしく
  from cron.job j
 where j.jobname = 'v2-npc-tick' or j.command ilike '%v2-npc-tick%'
    or j.command ~ (select re from pattern)
union all
-- 消す表（行数は数え直した本当の数）
select 2, case t.relkind when 'v' then 'ビュー' when 'm' then 'ビュー' else '表' end, t.relname,
       case when t.relkind in ('r', 'p') then
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.relname), false, true, '')))[1]::text
         || ' 行／' || pg_size_pretty(pg_total_relation_size(t.oid))
       else '' end
  from v2_tables t
union all
-- 消す関数（同じ名前で引数ちがいも1行ずつ）
select 3, '関数', f.oid::regprocedure::text, ''
  from v2_funcs f
union all
-- ⚠V2 以外の表から V2 の表への外部キー
select 0, '⚠つながり（外部キー）', c.conname,
       c.conrelid::regclass::text || ' → ' || c.confrelid::regclass::text
  from pg_constraint c
 where c.contype = 'f'
   and c.confrelid in (select oid from v2_tables)
   and c.conrelid not in (select oid from v2_tables)
union all
-- ⚠V2 以外のビューが V2 の表を使っている
select distinct 0, '⚠つながり（ビュー）', v.oid::regclass::text, '使っている表: ' || t.relname
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  join v2_tables t on t.oid = d.refobjid
 where d.classid = 'pg_rewrite'::regclass
   and v.oid not in (select oid from v2_tables)
union all
-- ⚠V2 以外の表の決まり（RLS・トリガー・初期値）が V2 の関数・表を使っている
select 0, '⚠つながり（RLS）', pol.polname, pol.polrelid::regclass::text
  from pg_policy pol
 where pol.polrelid not in (select oid from v2_tables)
   and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
       ~ (select re from pattern)
union all
select 0, '⚠つながり（トリガー）', tg.tgname, tg.tgrelid::regclass::text || ' → ' || tg.tgfoid::regprocedure::text
  from pg_trigger tg
 where not tg.tgisinternal
   and tg.tgrelid not in (select oid from v2_tables)
   and tg.tgfoid in (select oid from v2_funcs)
union all
select 0, '⚠つながり（初期値）', a.attname, ad.adrelid::regclass::text || '：' || pg_get_expr(ad.adbin, ad.adrelid)
  from pg_attrdef ad
  join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
 where ad.adrelid not in (select oid from v2_tables)
   and pg_get_expr(ad.adbin, ad.adrelid) ~ (select re from pattern)
union all
-- ⚠V2 以外の関数が V2 の表の「行の形」を引数・戻り値に使っている
select 0, '⚠つながり（関数の形）', p.oid::regprocedure::text, '使っている表: ' || c.relname
  from pg_proc p
  join pg_type t on t.oid = p.prorettype or t.typarray = p.prorettype
                 or t.oid = any(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                 or t.typarray = any(coalesce(p.proallargtypes, p.proargtypes::oid[]))
  join v2_tables c on c.oid = t.typrelid
 where left(p.proname, 3) <> 'v2_'
union all
-- V2 以外の関数の中身に V2 の名前（説明書きだけのこともある）
select 4, '名前が出てくる関数', p.oid::regprocedure::text,
       (select string_agg(distinct m[1], ', ') from regexp_matches(p.prosrc, (select re from pattern), 'g') as m)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and left(p.proname, 3) <> 'v2_'
   and p.prosrc ~ (select re from pattern)
order by 1, 2, 3;
