-- ============================================================
-- V2 初期構成をデータベースから消す（2026-10-22）／③ V2 の表・関数を消す
--   1_check → 2_stop_cron → 本番の関数 v2-npc-tick を消す → **3_drop（これ）**
--
-- ⚠**戻せない**。V2 初期構成のキャラ・持ち物・NPC・レイドなどのデータが全部なくなる。
--
-- 消すもの：public の中で名前が v2_ で始まる 表・ビュー・関数・型（v2cap_ は3文字目が c なので入らない）
-- 消さないもの：v2cap_ の表・関数、旧版の表・関数、auth・storage（アイコンの画像も）
--
-- ★1つの do ブロックなので、途中で1つでも失敗したら**何も消えない**（全部元のまま）。
-- ★次のときは何も消さずに止まる：
--   ・v2-npc-tick の定期処理がまだある（先に ② を流す）
--   ・V2 以外の表が外部キーで V2 の表につながっている／V2 以外のビュー・関数・決まりが V2 の表や関数を使っている
--     （表と関数は cascade を付けずに消すので、つながりがあれば Postgres がエラーにする）
--
-- 本番の関数 v2-npc-tick の消し方（② のあと・③ の前）：
--   ・画面：Supabase のダッシュボード → Edge Functions → v2-npc-tick → 右上の「⋯」（または Settings）→ Delete function
--   ・コマンド：supabase functions delete v2-npc-tick --project-ref jxbcuqwqtstxgmpiruuu
--   ⚠シークレット CRON_SECRET は**消さない**（レイド通知 send-raid-push が同じものを使っている）
-- ============================================================
do $$
declare
  r record;
  bad text;
  n_fk int := 0; n_view int := 0; n_tbl int := 0; n_fn int := 0; n_etc int := 0;
begin
  -- 守り①：定期処理が残っていたら止まる
  if exists (select 1 from cron.job where jobname = 'v2-npc-tick' or command ilike '%v2-npc-tick%') then
    raise exception '定期処理 v2-npc-tick がまだあります。先に supabase_v2_cleanup_20261022_2_stop_cron.sql を流してください';
  end if;

  -- 守り②：V2 以外の表から V2 の表への外部キー（分かりやすい言葉で止めるため先に見る）
  select string_agg(format('%s → %s（%s）', c.conrelid::regclass, c.confrelid::regclass, c.conname), ' / ')
    into bad
    from pg_constraint c
    join pg_class tc on tc.oid = c.confrelid
    join pg_class fc on fc.oid = c.conrelid
   where c.contype = 'f'
     and tc.relnamespace = 'public'::regnamespace and left(tc.relname, 3) = 'v2_'
     and not (fc.relnamespace = 'public'::regnamespace and left(fc.relname, 3) = 'v2_');
  if bad is not null then
    raise exception 'V2 以外の表が V2 の表につながっています（何も消していません）: %', bad;
  end if;

  -- 1) V2 の表どうしの外部キーを外す（表を cascade なしで消すため）
  for r in
    select c.conname, c.conrelid::regclass as t
      from pg_constraint c
      join pg_class fc on fc.oid = c.conrelid
     where c.contype = 'f'
       and fc.relnamespace = 'public'::regnamespace and left(fc.relname, 3) = 'v2_'
  loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
    n_fk := n_fk + 1;
  end loop;

  -- 1b) V2 の表についている RLS の決まりを外す（別の V2 の表を見ている決まりがあると、消す順番でエラーになるため）
  for r in
    select pol.polname, pol.polrelid::regclass as t
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
     where c.relnamespace = 'public'::regnamespace and left(c.relname, 3) = 'v2_'
  loop
    execute format('drop policy %I on %s', r.polname, r.t);
  end loop;

  -- 2) V2 のビュー
  for r in
    select c.oid::regclass as v, c.relkind
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and left(c.relname, 3) = 'v2_'
  loop
    if r.relkind = 'm' then execute format('drop materialized view %s', r.v);
    else execute format('drop view %s', r.v); end if;
    n_view := n_view + 1;
  end loop;

  -- 2b) V2 の表の「行の形」を引数・戻り値に使う V2 の関数（v2_raid_visible(v2_raids, uuid) など）は、表より先に消す
  --     （表を cascade なしで消すと「この関数が使っている」でエラーになるため。2026-10-22 PGlite で確かめた）
  for r in
    select p.oid::regprocedure as f
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and left(p.proname, 3) = 'v2_'
       and exists (
         select 1
           from pg_type t
           join pg_class c on c.oid = t.typrelid
          where c.relnamespace = 'public'::regnamespace and left(c.relname, 3) = 'v2_'
            and (t.oid = p.prorettype or t.typarray = p.prorettype
                 or t.oid = any(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                 or t.typarray = any(coalesce(p.proallargtypes, p.proargtypes::oid[])))
       )
  loop
    execute format('drop function %s', r.f);
    n_fn := n_fn + 1;
  end loop;

  -- 3) V2 の表（cascade なし＝V2 以外のものが使っていればここでエラーになり、全部元に戻る）
  --    表についている RLS・トリガー・索引・連番は表といっしょに消える
  for r in
    select c.oid::regclass as t
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and left(c.relname, 3) = 'v2_'
       and not c.relispartition
  loop
    execute format('drop table %s', r.t);
    n_tbl := n_tbl + 1;
  end loop;

  -- 4) V2 の関数（同じ名前の引数ちがいも。cascade なし）
  for r in
    select p.oid::regprocedure as f, p.prokind
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and left(p.proname, 3) = 'v2_'
  loop
    if r.prokind = 'p' then execute format('drop procedure %s', r.f);
    elsif r.prokind = 'a' then execute format('drop aggregate %s', r.f);
    else execute format('drop function %s', r.f); end if;
    n_fn := n_fn + 1;
  end loop;

  -- 5) 残った V2 の連番・型（表の外で作ったものがあれば）
  for r in
    select c.oid::regclass as s
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and left(c.relname, 3) = 'v2_'
  loop
    execute format('drop sequence %s', r.s);
    n_etc := n_etc + 1;
  end loop;
  for r in
    select t.oid::regtype as ty
      from pg_type t
     where t.typnamespace = 'public'::regnamespace and left(t.typname, 3) = 'v2_'
       and t.typtype in ('e', 'c', 'd') and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c')
  loop
    execute format('drop type %s', r.ty);
    n_etc := n_etc + 1;
  end loop;

  raise notice '消した: 表 % 個・関数 % 個・ビュー % 個・そのほか % 個（外した外部キー % 個）', n_tbl, n_fn, n_view, n_etc, n_fk;
end $$;

-- 残りの確かめ（どちらも 0 なら全部消えた。v2cap は数が変わらない）
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and left(relname, 3) = 'v2_') as "V2 の表など（0 なら消えた）",
  (select count(*) from pg_proc  where pronamespace = 'public'::regnamespace and left(proname, 3) = 'v2_') as "V2 の関数（0 なら消えた）",
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and left(relname, 6) = 'v2cap_') as "v2cap の表（そのまま）",
  (select count(*) from pg_proc  where pronamespace = 'public'::regnamespace and left(proname, 6) = 'v2cap_') as "v2cap の関数（そのまま）";
