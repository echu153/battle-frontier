-- ============================================================
-- バトルフロンティアⅡ「レベルキャップあり」版（v2cap）コア
--   設計は docs/v2cap-design.md。画面は src/v2cap、計算の写しは src/v2cap/lib。
-- ------------------------------------------------------------
-- ★このファイルは v2cap_ 接頭辞の新規オブジェクトだけを作る。
--   今のⅡ（v2_）と旧版のテーブル・RPCには**一切書き込まない**。
--   読むのは v2_skills（スキル名→職業・消費MP・並び）と v2_equipment（装備の一覧）だけ
--   ＝ supabase_v2_core.sql を先に流してあること（今のⅡの開発で流し済み）。
-- ★全体が冪等。仕様を足すたびに**全文を流し直す**運用（今のⅡと同じ）。何度流しても既存データは消えない。
-- ★「-- @@seed:名前」〜「-- @@end:名前」のあいだは手で直さない。
--   `node tools/v2cap-sql.mjs --write` が src/v2cap/lib から作り直す（v2capsql.test.js が見張る）。
--
-- 今のⅡとの違い（2026-10-09 ユーザー決定）：
--   ・LVは上限100。**転職しても下がらない**（周回なし）。必要EXPは上がるほど重い
--   ・1勝で入るEXPは**敵のLV**で決まる（サーバーが決める。画面からは受け取らない）
--   ・ジョブLV（最大30）を職業ごとに持つ。入るのは今の職業。上がるとスキルを覚える
--   ・装備は**アイテムLV**（＝倒した敵のLV）を持つ
-- ============================================================

-- ===== 0. 開発限定ゲート =====
-- ★入れるのは is_admin だけ（今のⅡのテスター名簿 v2_testers は通さない）。
--   画面（V2capHome.jsx）でも弾いているが、RPCは authenticated に grant するので、
--   **画面を通さず直接呼ばれても弾けるように、公開RPCは全部これを最初に通す**。
create or replace function public.v2cap_is_dev()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- ============================================================
-- ===== 1. マスタ =====
-- ============================================================
-- ---- 1-1. 段階（初期・一次）----
-- mult … 必要ジョブEXPの倍率／per_lv … ジョブLVが1上がるごとのステの点数／
-- learn_at … スキルを覚えるジョブLV（その職業の技を v2_skills の req_jobs, sort 順に当てる）
create table if not exists public.v2cap_stages (
  stage    text primary key,
  mult     int  not null,
  per_lv   int  not null,
  learn_at int[] not null
);
alter table public.v2cap_stages enable row level security;
drop policy if exists v2cap_stages_read on public.v2cap_stages;
create policy v2cap_stages_read on public.v2cap_stages for select to authenticated using (true);
revoke all on table public.v2cap_stages from anon;
grant select on table public.v2cap_stages to authenticated;

-- @@seed:stages
insert into public.v2cap_stages (stage, mult, per_lv, learn_at) values
  ('shoki', 1, 1, '{1,5,10,15,20}'::int[]),
  ('ichiji', 3, 2, '{1,4,7,10,13,16,19,22,25,28}'::int[])
on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at;
-- @@end:stages

-- ---- 1-2. 職業 ----
-- req_cls / req_jlv … 就くのに要る職業とジョブLV（初期職は null）
-- bonus_seq … ジョブLVで上がるステの並び（1点ずつ。jobs.js の bonusSeqOf と同じ）
-- ★複合上位職・特殊職は二次・三次を作るときに置き場を決める（2026-10-09）＝まだ入れない
create table if not exists public.v2cap_classes (
  id        text primary key,
  stage     text not null references public.v2cap_stages(stage),
  sort      int  not null default 0,
  req_cls   text,
  req_jlv   int,
  bonus_seq text[] not null default '{}'
);
alter table public.v2cap_classes enable row level security;
drop policy if exists v2cap_classes_read on public.v2cap_classes;
create policy v2cap_classes_read on public.v2cap_classes for select to authenticated using (true);
revoke all on table public.v2cap_classes from anon;
grant select on table public.v2cap_classes to authenticated;

-- @@seed:classes
insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq) values
  ('ノーブル', 'shoki', 0, null, null, '{hp,str,dex,agi,int_stat,mp,vit,luk,hp,str,dex,agi,int_stat,mp,vit,luk,hp,str,dex,agi,int_stat,mp,vit,luk,hp,str,dex,agi,int_stat}'::text[]),
  ('戦士', 'shoki', 1, null, null, '{str,vit,hp,dex,str,str,vit,hp,str,dex,vit,str,str,hp,vit,dex,str,str,vit,hp,str,dex,vit,str,str,hp,dex,vit,str}'::text[]),
  ('弓使い', 'shoki', 2, null, null, '{dex,agi,str,dex,luk,agi,dex,str,dex,agi,dex,luk,agi,dex,str,dex,agi,luk,dex,agi,dex,str,dex,agi,luk,dex,str,agi,dex}'::text[]),
  ('魔法使い', 'shoki', 3, null, null, '{int_stat,mp,dex,int_stat,agi,int_stat,mp,int_stat,dex,int_stat,agi,int_stat,mp,int_stat,dex,int_stat,mp,int_stat,agi,int_stat,dex,int_stat,mp,int_stat,agi,int_stat,dex,mp,int_stat}'::text[]),
  ('僧侶', 'shoki', 4, null, null, '{int_stat,vit,hp,mp,int_stat,vit,hp,int_stat,mp,int_stat,vit,hp,mp,int_stat,vit,int_stat,hp,mp,vit,int_stat,hp,int_stat,mp,vit,int_stat,hp,mp,vit,int_stat}'::text[]),
  ('格闘家', 'shoki', 5, null, null, '{str,agi,hp,vit,str,agi,str,agi,hp,vit,str,agi,str,hp,agi,vit,str,agi,str,hp,vit,agi,str,agi,str,hp,vit,agi,str}'::text[]),
  ('サモナー', 'shoki', 6, null, null, '{int_stat,mp,agi,luk,int_stat,int_stat,mp,agi,int_stat,luk,int_stat,mp,agi,int_stat,luk,int_stat,mp,agi,int_stat,luk,int_stat,mp,agi,int_stat,int_stat,luk,mp,agi,int_stat}'::text[]),
  ('侍', 'ichiji', 10, '戦士', 30, '{str,dex,hp,str,vit,dex,str,hp,str,dex,str,vit,dex,str,hp,str,dex,vit,str,dex,str,hp,str,dex,vit,str,hp,dex,str,str,dex,hp,str,vit,dex,str,hp,str,dex,str,vit,dex,str,hp,str,dex,vit,str,dex,str,hp,str,dex,vit,str,hp,dex,str}'::text[]),
  ('狂戦士', 'ichiji', 11, '戦士', 30, '{str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str,str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str}'::text[]),
  ('狩人', 'ichiji', 12, '弓使い', 30, '{str,dex,hp,str,vit,dex,str,hp,str,dex,str,vit,dex,str,hp,str,dex,vit,str,dex,str,hp,str,dex,vit,str,hp,dex,str,str,dex,hp,str,vit,dex,str,hp,str,dex,str,vit,dex,str,hp,str,dex,vit,str,dex,str,hp,str,dex,vit,str,hp,dex,str}'::text[]),
  ('暗殺者', 'ichiji', 13, '弓使い', 30, '{str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str,str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str}'::text[]),
  ('元素使い', 'ichiji', 14, '魔法使い', 30, '{int_stat,dex,hp,int_stat,mp,dex,int_stat,hp,int_stat,dex,int_stat,mp,dex,int_stat,hp,int_stat,dex,mp,int_stat,dex,int_stat,hp,int_stat,dex,mp,int_stat,hp,dex,int_stat,int_stat,dex,hp,int_stat,mp,dex,int_stat,hp,int_stat,dex,int_stat,mp,dex,int_stat,hp,int_stat,dex,mp,int_stat,dex,int_stat,hp,int_stat,dex,mp,int_stat,hp,dex,int_stat}'::text[]),
  ('死霊使い', 'ichiji', 15, '魔法使い', 30, '{int_stat,vit,hp,int_stat,mp,vit,int_stat,hp,int_stat,vit,int_stat,mp,vit,int_stat,hp,int_stat,vit,mp,int_stat,vit,int_stat,hp,int_stat,vit,mp,int_stat,hp,vit,int_stat,int_stat,vit,hp,int_stat,mp,vit,int_stat,hp,int_stat,vit,int_stat,mp,vit,int_stat,hp,int_stat,vit,mp,int_stat,vit,int_stat,hp,int_stat,vit,mp,int_stat,hp,vit,int_stat}'::text[]),
  ('聖職者', 'ichiji', 16, '僧侶', 30, '{int_stat,vit,hp,int_stat,mp,vit,int_stat,hp,int_stat,vit,int_stat,mp,vit,int_stat,hp,int_stat,vit,mp,int_stat,vit,int_stat,hp,int_stat,vit,mp,int_stat,hp,vit,int_stat,int_stat,vit,hp,int_stat,mp,vit,int_stat,hp,int_stat,vit,int_stat,mp,vit,int_stat,hp,int_stat,vit,mp,int_stat,vit,int_stat,hp,int_stat,vit,mp,int_stat,hp,vit,int_stat}'::text[]),
  ('異端審問官', 'ichiji', 17, '僧侶', 30, '{int_stat,luk,hp,int_stat,mp,luk,int_stat,hp,int_stat,luk,int_stat,mp,luk,int_stat,hp,int_stat,luk,mp,int_stat,luk,int_stat,hp,int_stat,luk,mp,int_stat,hp,luk,int_stat,int_stat,luk,hp,int_stat,mp,luk,int_stat,hp,int_stat,luk,int_stat,mp,luk,int_stat,hp,int_stat,luk,mp,int_stat,luk,int_stat,hp,int_stat,luk,mp,int_stat,hp,luk,int_stat}'::text[]),
  ('サイキッカー', 'ichiji', 18, '格闘家', 30, '{str,int_stat,hp,str,vit,int_stat,str,hp,str,int_stat,str,vit,int_stat,str,hp,str,int_stat,vit,str,int_stat,str,hp,str,int_stat,vit,str,hp,int_stat,str,str,int_stat,hp,str,vit,int_stat,str,hp,str,int_stat,str,vit,int_stat,str,hp,str,int_stat,vit,str,int_stat,str,hp,str,int_stat,vit,str,hp,int_stat,str}'::text[]),
  ('体術師', 'ichiji', 19, '格闘家', 30, '{str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str,str,agi,hp,str,vit,agi,str,hp,str,agi,str,vit,agi,str,hp,str,agi,vit,str,agi,str,hp,str,agi,vit,str,hp,agi,str}'::text[]),
  ('精霊召喚士', 'ichiji', 20, 'サモナー', 30, '{int_stat,agi,hp,int_stat,mp,agi,int_stat,hp,int_stat,agi,int_stat,mp,agi,int_stat,hp,int_stat,agi,mp,int_stat,agi,int_stat,hp,int_stat,agi,mp,int_stat,hp,agi,int_stat,int_stat,agi,hp,int_stat,mp,agi,int_stat,hp,int_stat,agi,int_stat,mp,agi,int_stat,hp,int_stat,agi,mp,int_stat,agi,int_stat,hp,int_stat,agi,mp,int_stat,hp,agi,int_stat}'::text[]),
  ('式神使い', 'ichiji', 21, 'サモナー', 30, '{int_stat,dex,hp,int_stat,mp,dex,int_stat,hp,int_stat,dex,int_stat,mp,dex,int_stat,hp,int_stat,dex,mp,int_stat,dex,int_stat,hp,int_stat,dex,mp,int_stat,hp,dex,int_stat,int_stat,dex,hp,int_stat,mp,dex,int_stat,hp,int_stat,dex,int_stat,mp,dex,int_stat,hp,int_stat,dex,mp,int_stat,dex,int_stat,hp,int_stat,dex,mp,int_stat,hp,dex,int_stat}'::text[])
on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,
  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq;
-- @@end:classes

-- ---- 1-3. 難易度帯 ----
-- lv_min / lv_max … その帯の敵のLVの範囲／req … いくつ踏破したら次の帯が開くか
create table if not exists public.v2cap_tiers (
  tier   int primary key,
  lv_min int not null,
  lv_max int not null,
  req    int not null
);
alter table public.v2cap_tiers enable row level security;
drop policy if exists v2cap_tiers_read on public.v2cap_tiers;
create policy v2cap_tiers_read on public.v2cap_tiers for select to authenticated using (true);
revoke all on table public.v2cap_tiers from anon;
grant select on table public.v2cap_tiers to authenticated;

-- @@seed:tiers
insert into public.v2cap_tiers (tier, lv_min, lv_max, req) values
  (1, 1, 20, 1),
  (2, 20, 27, 1),
  (3, 27, 34, 1),
  (4, 34, 44, 2),
  (5, 44, 63, 2),
  (6, 63, 79, 2),
  (7, 79, 90, 3),
  (8, 90, 100, 3)
on conflict (tier) do update set lv_min = excluded.lv_min, lv_max = excluded.lv_max, req = excluded.req;
-- @@end:tiers

-- ---- 1-4. エリア ----
create table if not exists public.v2cap_areas (
  id         int primary key,
  tier       int not null,
  name       text not null,
  drop_ranks jsonb not null
);
alter table public.v2cap_areas enable row level security;
drop policy if exists v2cap_areas_read on public.v2cap_areas;
create policy v2cap_areas_read on public.v2cap_areas for select to authenticated using (true);
revoke all on table public.v2cap_areas from anon;
grant select on table public.v2cap_areas to authenticated;

-- @@seed:areas
insert into public.v2cap_areas (id, tier, name, drop_ranks) values
  (1, 1, '始まりの森', '{"F":40,"E":40,"D":20}'::jsonb),
  (2, 2, '荒廃した草原', '{"F":35,"E":30,"D":22,"C":13}'::jsonb),
  (3, 3, '古代の洞窟', '{"F":30,"E":28,"D":24,"C":13,"B":5}'::jsonb),
  (4, 4, '蒼海の入り江', '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb),
  (9, 4, '灼砂の遺丘', '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb),
  (5, 5, '巨峰山脈', '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb),
  (10, 5, '常闇の樹海', '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb),
  (6, 6, '白銀の霊峰', '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb),
  (11, 6, '雷鳴の断崖', '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb),
  (7, 7, '煉獄火山', '{"D":40,"C":30,"B":20,"A":10}'::jsonb),
  (12, 7, '腐海の沼獄', '{"D":40,"C":30,"B":20,"A":10}'::jsonb),
  (13, 7, '奈落の坑道', '{"D":40,"C":30,"B":20,"A":10}'::jsonb),
  (8, 8, '蒼天の浮遊城', '{"D":35,"C":29,"B":22,"A":14}'::jsonb),
  (14, 8, '星霜の遺跡', '{"D":35,"C":29,"B":22,"A":14}'::jsonb),
  (15, 8, '深淵の海溝', '{"D":35,"C":29,"B":22,"A":14}'::jsonb)
on conflict (id) do update set tier = excluded.tier, name = excluded.name, drop_ranks = excluded.drop_ranks;
-- @@end:areas

-- ---- 1-5. 敵のLV ----
-- ★EXPとアイテムLVはサーバーがここから決める（画面からは「どの敵と戦ったか」だけ受け取る）
create table if not exists public.v2cap_enemies (
  name text primary key,
  area int  not null,
  lv   int  not null,
  role text not null   -- normal / timed / boss
);
alter table public.v2cap_enemies enable row level security;
drop policy if exists v2cap_enemies_read on public.v2cap_enemies;
create policy v2cap_enemies_read on public.v2cap_enemies for select to authenticated using (true);
revoke all on table public.v2cap_enemies from anon;
grant select on table public.v2cap_enemies to authenticated;

-- @@seed:enemies
delete from public.v2cap_enemies;
insert into public.v2cap_enemies (name, area, lv, role) values
  ('森ネズミ', 1, 1, 'normal'),
  ('スライム', 1, 3, 'normal'),
  ('コウモリ', 1, 5, 'normal'),
  ('オオアリ', 1, 8, 'normal'),
  ('毒キノコ', 1, 11, 'normal'),
  ('つるヘビ', 1, 13, 'normal'),
  ('朝露のフェアリー', 1, 16, 'timed'),
  ('ひなたトカゲ', 1, 16, 'timed'),
  ('月夜のフクロウ', 1, 16, 'timed'),
  ('朝もやのカエル', 1, 16, 'timed'),
  ('ひなたのチョウ', 1, 16, 'timed'),
  ('夜鳴きのコオロギ', 1, 16, 'timed'),
  ('ビッグスライム', 1, 20, 'boss'),
  ('草原オオカミ', 2, 20, 'normal'),
  ('ゴブリン', 2, 21, 'normal'),
  ('野良犬', 2, 21, 'normal'),
  ('ゴブリン射手', 2, 22, 'normal'),
  ('盗賊', 2, 24, 'normal'),
  ('野伏せのイノシシ', 2, 25, 'normal'),
  ('朝霧のワーム', 2, 26, 'timed'),
  ('陽炎リザード', 2, 26, 'timed'),
  ('夜盗の斥候', 2, 26, 'timed'),
  ('朝露のオオバッタ', 2, 26, 'timed'),
  ('炎天のハゲタカ', 2, 26, 'timed'),
  ('夜盗の番犬', 2, 26, 'timed'),
  ('盗賊団のリーダー', 2, 27, 'boss'),
  ('洞窟グモ', 3, 27, 'normal'),
  ('コボルト', 3, 28, 'normal'),
  ('スケルトン', 3, 28, 'normal'),
  ('コボルト投石手', 3, 29, 'normal'),
  ('ゴーレム', 3, 31, 'normal'),
  ('スケルトンドッグ', 3, 32, 'normal'),
  ('曙のガーゴイル', 3, 33, 'timed'),
  ('石化トカゲ', 3, 33, 'timed'),
  ('夜這うレイス', 3, 33, 'timed'),
  ('朝陰のオオムカデ', 3, 33, 'timed'),
  ('石窟のサソリ', 3, 33, 'timed'),
  ('亡霊コボルト', 3, 33, 'timed'),
  ('古代の番人', 3, 34, 'boss'),
  ('毒クラゲ', 4, 34, 'normal'),
  ('入り江のサメ', 4, 35, 'normal'),
  ('深海魚人', 4, 36, 'normal'),
  ('海賊の砲手', 4, 38, 'normal'),
  ('海賊', 4, 39, 'normal'),
  ('大ウミヘビ', 4, 41, 'normal'),
  ('朝凪のセイレーン', 4, 42, 'timed'),
  ('潮騒のカニ', 4, 42, 'timed'),
  ('夜光アンコウ', 4, 42, 'timed'),
  ('朝凪のトビウオ', 4, 42, 'timed'),
  ('日照りのウミガメ', 4, 42, 'timed'),
  ('夜光のタコ', 4, 42, 'timed'),
  ('シーサーペント', 4, 44, 'boss'),
  ('峰のオオワシ', 5, 44, 'normal'),
  ('山岳ゴブリン', 5, 46, 'normal'),
  ('グリフォン', 5, 48, 'normal'),
  ('岩場のヒグマ', 5, 51, 'normal'),
  ('岩石ゴーレム', 5, 54, 'normal'),
  ('山岳トロール', 5, 56, 'normal'),
  ('払暁のワイバーン', 5, 59, 'timed'),
  ('陽射しの大猿', 5, 59, 'timed'),
  ('宵闇の山猫', 5, 59, 'timed'),
  ('払暁のハヤブサ', 5, 59, 'timed'),
  ('陽射しのヤマアラシ', 5, 59, 'timed'),
  ('宵闇のオオカミ', 5, 59, 'timed'),
  ('雷鷲サンダーロック', 5, 63, 'boss'),
  ('氷壁のゴーレム', 6, 63, 'normal'),
  ('霜の精霊', 6, 65, 'normal'),
  ('雪男', 6, 66, 'normal'),
  ('霜のスケルトン', 6, 69, 'normal'),
  ('氷河ドラゴン', 6, 71, 'normal'),
  ('白銀のシロクマ', 6, 73, 'normal'),
  ('朝焼けの氷狼', 6, 76, 'timed'),
  ('白光の樹氷精', 6, 76, 'timed'),
  ('極夜のワイト', 6, 76, 'timed'),
  ('朝焼けのアイスドレイク', 6, 76, 'timed'),
  ('白光のスノーハーピー', 6, 76, 'timed'),
  ('極夜のリッチ', 6, 76, 'timed'),
  ('氷霊フロストバーン', 6, 79, 'boss'),
  ('溶岩スライム', 7, 79, 'normal'),
  ('炎の精霊', 7, 80, 'normal'),
  ('ファイアドレイク', 7, 81, 'normal'),
  ('溶岩ゴーレム', 7, 83, 'normal'),
  ('燃えさかるインプ', 7, 85, 'normal'),
  ('火口のヘルハウンド', 7, 86, 'normal'),
  ('暁のフレイムバット', 7, 88, 'timed'),
  ('陽炎のイフリート', 7, 88, 'timed'),
  ('熾火のデーモン', 7, 88, 'timed'),
  ('暁炎のフェニックス', 7, 88, 'timed'),
  ('陽炎のケルベロス', 7, 88, 'timed'),
  ('熾火のワイバーン', 7, 88, 'timed'),
  ('深紅のサラマンダー', 7, 90, 'boss'),
  ('蒼天のロック鳥', 8, 90, 'normal'),
  ('天翼のハーピー', 8, 91, 'normal'),
  ('雷雲の精霊', 8, 92, 'normal'),
  ('浮遊するゴーレム', 8, 94, 'normal'),
  ('天空騎士グリフィオン', 8, 95, 'normal'),
  ('天空の弓兵', 8, 97, 'normal'),
  ('曙光のセラフ', 8, 98, 'timed'),
  ('白昼のペガサス', 8, 98, 'timed'),
  ('星降りのヴァルキリー', 8, 98, 'timed'),
  ('曙光のケルビム', 8, 98, 'timed'),
  ('白昼のユニコーン', 8, 98, 'timed'),
  ('星降りのワイバーン', 8, 98, 'timed'),
  ('天空覇龍ウラノス', 8, 100, 'boss'),
  ('墓守のミイラ', 9, 34, 'normal'),
  ('遺丘のハゲワシ', 9, 35, 'normal'),
  ('砂のゴーレム', 9, 36, 'normal'),
  ('砂蠍サンドスコーピオン', 9, 38, 'normal'),
  ('砂喰いワーム', 9, 39, 'normal'),
  ('墓荒らしの盗掘者', 9, 41, 'normal'),
  ('陽炎の砂トカゲ', 9, 42, 'timed'),
  ('灼熱のアヌビス', 9, 42, 'timed'),
  ('月砂のジャッカル', 9, 42, 'timed'),
  ('朝日のスカラベ', 9, 42, 'timed'),
  ('灼熱のコブラ', 9, 42, 'timed'),
  ('月下のハイエナ', 9, 42, 'timed'),
  ('砂皇スカラベウス', 9, 44, 'boss'),
  ('毒霧のマンドラゴラ', 10, 44, 'normal'),
  ('苔むしたゴーレム', 10, 46, 'normal'),
  ('樹海のオオグモ', 10, 48, 'normal'),
  ('影狼シャドウウルフ', 10, 51, 'normal'),
  ('食人樹', 10, 54, 'normal'),
  ('人喰いのツタ', 10, 56, 'normal'),
  ('朝靄のトレント', 10, 59, 'timed'),
  ('木漏れ日のピクシー', 10, 59, 'timed'),
  ('常闇のバンシー', 10, 59, 'timed'),
  ('朝靄のマイコニド', 10, 59, 'timed'),
  ('木漏れ日のオオカブト', 10, 59, 'timed'),
  ('常闇のオオコウモリ', 10, 59, 'timed'),
  ('森王エルダートレント', 10, 63, 'boss'),
  ('断崖のコンドル', 11, 63, 'normal'),
  ('断崖のトロール', 11, 65, 'normal'),
  ('嵐鳥ストームバード', 11, 66, 'normal'),
  ('雷牙のオオカミ', 11, 69, 'normal'),
  ('雷刃のガーゴイル', 11, 71, 'normal'),
  ('帯電のゴーレム', 11, 73, 'normal'),
  ('暁雲のサンダーホーク', 11, 76, 'timed'),
  ('雷光のエレメンタル', 11, 76, 'timed'),
  ('雷鳴のワイバーン', 11, 76, 'timed'),
  ('暁雲のグリフォン', 11, 76, 'timed'),
  ('雷光のドレイク', 11, 76, 'timed'),
  ('雷鳴のハーピー', 11, 76, 'timed'),
  ('雷帝ケラウノス', 11, 79, 'boss'),
  ('腐食スライム', 12, 79, 'normal'),
  ('腐肉のオオバエ', 12, 80, 'normal'),
  ('沼のオオワニ', 12, 81, 'normal'),
  ('沼底のリザードマン', 12, 83, 'normal'),
  ('沼のヒュドラ', 12, 85, 'normal'),
  ('泥のゴーレム', 12, 86, 'normal'),
  ('朝霞のウィルオウィスプ', 12, 88, 'timed'),
  ('陽だまりの大蛙', 12, 88, 'timed'),
  ('夜霧のゾンビ', 12, 88, 'timed'),
  ('朝霞のオオヒル', 12, 88, 'timed'),
  ('陽だまりのオオヘビ', 12, 88, 'timed'),
  ('夜霧のバジリスク', 12, 88, 'timed'),
  ('毒龍ヴェノムヒュドラ', 12, 90, 'boss'),
  ('坑道のオオネズミ', 13, 79, 'normal'),
  ('闇喰いコウモリ', 13, 80, 'normal'),
  ('坑道のグール', 13, 81, 'normal'),
  ('奈落のスケルトン兵', 13, 83, 'normal'),
  ('鉱石ゴーレム', 13, 85, 'normal'),
  ('錆びた自動人形', 13, 86, 'normal'),
  ('曙光のクリスタルワーム', 13, 88, 'timed'),
  ('灯火のドワーフ亡霊', 13, 88, 'timed'),
  ('深穴のシャドウ', 13, 88, 'timed'),
  ('曙光のクリスタルゴーレム', 13, 88, 'timed'),
  ('灯火のドワーフ坑夫', 13, 88, 'timed'),
  ('深穴のオオグモ', 13, 88, 'timed'),
  ('巌喰いガイアモール', 13, 90, 'boss'),
  ('時喰いのクロノワーム', 14, 90, 'normal'),
  ('星霜のゴーレム', 14, 91, 'normal'),
  ('時喰いのカゲロウ', 14, 92, 'normal'),
  ('星読みの石像', 14, 94, 'normal'),
  ('遺跡の守護機兵', 14, 95, 'normal'),
  ('遺跡の魔導兵', 14, 97, 'normal'),
  ('暁星のアストラルナイト', 14, 98, 'timed'),
  ('白日のスフィンクス', 14, 98, 'timed'),
  ('星宿の月狼ルナウルフ', 14, 98, 'timed'),
  ('暁星のケンタウロス', 14, 98, 'timed'),
  ('白日のマンティコア', 14, 98, 'timed'),
  ('星宿の月蛾', 14, 98, 'timed'),
  ('時星龍アイオーン', 14, 100, 'boss'),
  ('冥暗のシーウィッチ', 15, 90, 'normal'),
  ('冥暗のマーマン', 15, 91, 'normal'),
  ('海淵のリヴァイアサン幼体', 15, 92, 'normal'),
  ('深海のメガロドン', 15, 94, 'normal'),
  ('海溝のダイオウイカ', 15, 95, 'normal'),
  ('深淵のクラーケン', 15, 97, 'normal'),
  ('朝凪の海竜', 15, 98, 'timed'),
  ('陽射しの巨鯨', 15, 98, 'timed'),
  ('深海のセイレーン', 15, 98, 'timed'),
  ('朝凪のシャチ', 15, 98, 'timed'),
  ('陽射しのマンタ', 15, 98, 'timed'),
  ('深海のオオダコ', 15, 98, 'timed'),
  ('深海覇王リヴァイアサン', 15, 100, 'boss');
-- @@end:enemies

-- ============================================================
-- ===== 2. プレイヤー =====
-- ============================================================
create table if not exists public.v2cap_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  lv         int  not null default 1,
  exp        int  not null default 0,      -- 現在LV内の累積EXP
  total_exp  bigint not null default 0,    -- 通算で得たEXP（統計用）
  -- 本体のステ。並びは src/v2/lib/stats.js の STAT_KEYS と対応（初期値も今のⅡと同じ）
  hp         int not null default 40,
  mp         int not null default 12,
  str        int not null default 5,
  dex        int not null default 5,
  agi        int not null default 5,
  int_stat   int not null default 5,
  vit        int not null default 5,
  luk        int not null default 5,
  class      text  not null default 'ノーブル',
  jobs       jsonb not null default '{}'::jsonb,   -- {"戦士":{"lv":12,"exp":345}}
  learned    jsonb not null default '[]'::jsonb,   -- 覚えたスキル名（ずっと残る）
  skill_set  jsonb not null default '[]'::jsonb,   -- [{"name":"体当たり","uses":3}]
  favorites  jsonb not null default '[]'::jsonb,
  equipped   jsonb not null default '{}'::jsonb,   -- {"right": 12, ...} v2cap_inventory.id
  unlocked_areas int[] not null default array[1],
  cleared_areas  int[] not null default '{}',
  boss_rate  numeric not null default 0,           -- ボス遭遇率(%)。戦うたび+0.3、当たると0へ
  stamina    int not null default 10,
  stamina_at timestamptz not null default now(),
  last_sortie_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists v2cap_profiles_username_lower_idx
  on public.v2cap_profiles (lower(username));
-- 参照は認証済み全員（今のⅡと同じ）。書き込みはRPC経由だけ
alter table public.v2cap_profiles enable row level security;
drop policy if exists v2cap_profiles_select on public.v2cap_profiles;
create policy v2cap_profiles_select on public.v2cap_profiles for select to authenticated using (true);
revoke all on table public.v2cap_profiles from anon;
grant select on table public.v2cap_profiles to authenticated;

-- 所持している装備。ilv＝アイテムLV（＝必要LV。倒した敵のLV）
create table if not exists public.v2cap_inventory (
  id         bigserial primary key,
  player_id  uuid not null references auth.users(id) on delete cascade,
  equip_id   text not null references public.v2_equipment(id),
  ilv        int  not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists v2cap_inventory_player_idx on public.v2cap_inventory(player_id);
alter table public.v2cap_inventory enable row level security;
drop policy if exists v2cap_inventory_own on public.v2cap_inventory;
create policy v2cap_inventory_own on public.v2cap_inventory for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2cap_inventory from anon;
grant select on table public.v2cap_inventory to authenticated;

-- ============================================================
-- ===== 3. 計算（src/v2cap/lib と同じ式。片方だけ直さないこと）=====
-- ============================================================
-- 次のLVまでの必要EXP ＝ 0.335 × LV² × (LV＋9)。LV100で0（level.js の needExp）
-- ⚠千分率の整数（335）で掛けてから割る＝JSと端数の丸めをそろえるため
create or replace function public.v2cap_need(p_lv int)
returns int language sql immutable set search_path = public as $$
  select case when p_lv >= 100 then 0
              else greatest(1, round(335::numeric * p_lv * p_lv * (p_lv + 9) / 1000))::int end
$$;

-- 必要ジョブEXP ＝ 12.3 × 段階の倍率 × ジョブLV²。ジョブLV30で0（jobs.js の jobNeed）
create or replace function public.v2cap_job_need(p_stage text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select case when p_jlv >= 30 then 0
              else greatest(1, round(123::numeric * coalesce((select s.mult from public.v2cap_stages s where s.stage = p_stage), 1)
                                     * p_jlv * p_jlv / 10))::int end
$$;

-- スタミナの最大値 ＝ 10＋LV÷5（level.js の staminaMaxOf）
create or replace function public.v2cap_stamina_max(p_lv int)
returns int language sql immutable set search_path = public as $$
  select 10 + greatest(1, coalesce(p_lv, 1)) / 5
$$;

-- そのジョブLVまでに覚えるスキルを足した learned を返す（jobs.js の skillsLearnedBy）。
-- 並び＝その職業の技を「転職5回が要った技（req_jobs）は後ろ・同じ組は sort 順」。パッシブは除く
create or replace function public.v2cap_learn(p_learned jsonb, p_cls text, p_jlv int)
returns jsonb language sql stable set search_path = public as $$
  with st as (
    select s.learn_at from public.v2cap_classes c
      join public.v2cap_stages s on s.stage = c.stage
     where c.id = p_cls
  ), ord as (
    -- ⚠row_number() は bigint。配列の添字は integer しか受けないので int にしておく
    select k.name, (row_number() over (order by k.req_jobs, k.sort))::int as i
      from public.v2_skills k
     where k.cls = p_cls and not k.passive
  ), newly as (
    select o.name, o.i from ord o, st
     where o.i <= coalesce(array_length(st.learn_at, 1), 0)
       and st.learn_at[o.i] <= coalesce(p_jlv, 1)
       and not (coalesce(p_learned, '[]'::jsonb) ? o.name)
  )
  select coalesce(p_learned, '[]'::jsonb)
         || coalesce((select jsonb_agg(n.name order by n.i) from newly n), '[]'::jsonb)
$$;

-- ジョブのステのうちMPぶん（スキルセットの想定利用MPの上限に使う）。
-- ★装備はMPを持たない（今のⅡと同じ）ので、最大MP＝本体のMP＋これ
create or replace function public.v2cap_job_bonus_mp(p_cls text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select coalesce((
    select count(*)::int
      from public.v2cap_classes c
      join public.v2cap_stages s on s.stage = c.stage,
           unnest(c.bonus_seq[1:greatest(0, least(coalesce(p_jlv, 1), 30) - 1) * s.per_lv]) as x(k)
     where c.id = p_cls and x.k = 'mp'), 0) * 3
$$;

-- 編成の想定利用MP。★いまの職業以外のスキルは消費MPが2倍（skills.js の OFF_CLASS_MP_MULT）
create or replace function public.v2cap_set_cost(p_set jsonb, p_cls text)
returns int language sql stable set search_path = public as $$
  select coalesce(sum(s.mp * (case when s.cls = p_cls then 1 else 2 end)
                      * greatest(1, coalesce((t.e ->> 'uses')::int, 1))), 0)::int
    from jsonb_array_elements(coalesce(p_set, '[]'::jsonb)) as t(e)
    join public.v2_skills s on s.name = t.e ->> 'name'
$$;

-- 転職でMPの事情が変わったとき、編成を最大MPに収まる形へ縮める。
-- 収まっていればそのまま／超えていれば回数を全部1へ／それでも超えるなら後ろの枠から外す
create or replace function public.v2cap_fit_set(p_set jsonb, p_cls text, p_max int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_set jsonb := coalesce(p_set, '[]'::jsonb);
begin
  if public.v2cap_set_cost(v_set, p_cls) <= p_max then return v_set; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', t.e ->> 'name', 'uses', 1) order by t.i), '[]'::jsonb)
    into v_set
    from jsonb_array_elements(v_set) with ordinality as t(e, i);
  while jsonb_array_length(v_set) > 0 and public.v2cap_set_cost(v_set, p_cls) > p_max loop
    v_set := v_set - (jsonb_array_length(v_set) - 1);
  end loop;
  return v_set;
end;
$$;

-- 踏破から、開いておくエリアを作り直す（今のⅡと同じ規則：その帯を req ぶん踏破したら次の帯が開く。
-- 一度開いた帯は閉じない）。sortie.js の unlockNext と同じ
create or replace function public.v2cap_unlocked_from_cleared(p_cleared int[], p_unlocked int[] default '{}')
returns int[] language sql stable set search_path = public as $$
  with open_tier as (
    select 1 as tier
    union
    select a.tier from public.v2cap_areas a where a.id = any(coalesce(p_unlocked, '{}'))
    union
    select t.tier + 1 from public.v2cap_tiers t
     where (select count(*) from public.v2cap_areas a
             where a.tier = t.tier and a.id = any(coalesce(p_cleared, '{}'))) >= t.req
  )
  select coalesce(array_agg(a.id order by a.id), '{}')
    from public.v2cap_areas a where a.tier in (select tier from open_tier);
$$;

-- ⚠ここまでの計算は書き込みをしないが、外から叩く理由も無いので閉じておく
revoke all on function public.v2cap_need(int) from public, anon;
revoke all on function public.v2cap_job_need(text, int) from public, anon;
revoke all on function public.v2cap_stamina_max(int) from public, anon;
revoke all on function public.v2cap_learn(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.v2cap_job_bonus_mp(text, int) from public, anon, authenticated;
revoke all on function public.v2cap_set_cost(jsonb, text) from public, anon, authenticated;
revoke all on function public.v2cap_fit_set(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.v2cap_unlocked_from_cleared(int[], int[]) from public, anon, authenticated;

-- ===== スタミナを数え直す（今のⅡの v2_stamina_roll と同じ。最大値だけLVで決まる）=====
-- ⚠SECURITY DEFINER の内部ヘルパは既定で PUBLIC 実行可＝必ず REVOKE する
create or replace function public.v2cap_stamina_roll(p_player uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_span constant interval := interval '5 minutes';
  v_row  public.v2cap_profiles;
  v_max  int;
  v_gain int;
  v_n    int;
  v_at   timestamptz;
begin
  if p_player is null then return 0; end if;
  select * into v_row from public.v2cap_profiles where id = p_player for update;
  if not found then return 0; end if;
  v_max := public.v2cap_stamina_max(v_row.lv);
  v_n   := greatest(least(coalesce(v_row.stamina, 0), v_max), 0);
  v_at  := coalesce(v_row.stamina_at, now());
  if v_n >= v_max then
    v_n := v_max; v_at := now();
  else
    v_gain := greatest(floor(extract(epoch from (now() - v_at)) / extract(epoch from c_span))::int, 0);
    v_n  := least(v_max, v_n + v_gain);
    v_at := case when v_n >= v_max then now() else v_at + (v_gain * c_span) end;
  end if;
  update public.v2cap_profiles set stamina = v_n, stamina_at = v_at, updated_at = now()
   where id = p_player;
  return v_n;
end;
$$;
revoke all on function public.v2cap_stamina_roll(uuid) from public, anon, authenticated;

-- ===== EXPを入れる（LVアップの抽選・ジョブEXP・スキル習得）=====
-- ⚠内部ヘルパ。公開RPC（出撃の精算・開発用のEXP付与）からだけ呼ぶ。必ず REVOKE する
create or replace function public.v2cap_apply_exp(p_player uuid, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_lv  constant int := 100;
  c_rolls   constant int := 5;
  c_job_max constant int := 30;
  -- 抽選の並び: 1=hp 2=mp 3=str 4=dex 5=agi 6=int_stat 7=vit 8=luk（stats.js の STAT_KEYS と同じ）
  c_unit constant int[] := array[8, 3, 1, 1, 1, 1, 1, 1];
  v_row   public.v2cap_profiles;
  v_lv    int;
  v_exp   int;
  v_gain  int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  v_ups   int := 0;
  v_r     int;
  v_k     int;
  v_cls   text;
  v_stage text;
  v_jlv   int;
  v_jexp  int;
  v_jups  int := 0;
  v_old   jsonb;
  v_new   jsonb;
  v_added jsonb;
begin
  select * into v_row from public.v2cap_profiles where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがありません'); end if;

  -- LV（転職しても下がらない。LV100で止まり、あふれたぶんは捨てる）
  v_lv  := v_row.lv;
  v_exp := v_row.exp;
  if coalesce(p_amount, 0) > 0 and v_lv < c_max_lv then
    v_exp := v_exp + p_amount;
    while v_lv < c_max_lv and v_exp >= public.v2cap_need(v_lv) loop
      v_exp := v_exp - public.v2cap_need(v_lv);
      v_lv  := v_lv + 1;
      v_ups := v_ups + 1;
      for v_r in 1..c_rolls loop
        v_k := 1 + floor(random() * array_length(c_unit, 1))::int;
        v_gain[v_k] := v_gain[v_k] + c_unit[v_k];
      end loop;
    end loop;
    if v_lv >= c_max_lv then v_exp := 0; end if;
  end if;

  -- ジョブLV（いまの職業だけ。入るのはEXPと同じ量）
  v_cls := v_row.class;
  select c.stage into v_stage from public.v2cap_classes c where c.id = v_cls;
  v_jlv  := coalesce((v_row.jobs -> v_cls ->> 'lv')::int, 1);
  v_jexp := coalesce((v_row.jobs -> v_cls ->> 'exp')::int, 0);
  if v_stage is not null and coalesce(p_amount, 0) > 0 and v_jlv < c_job_max then
    v_jexp := v_jexp + p_amount;
    while v_jlv < c_job_max and v_jexp >= public.v2cap_job_need(v_stage, v_jlv) loop
      v_jexp := v_jexp - public.v2cap_job_need(v_stage, v_jlv);
      v_jlv  := v_jlv + 1;
      v_jups := v_jups + 1;
    end loop;
    if v_jlv >= c_job_max then v_jexp := 0; end if;
  end if;

  -- スキル（そのジョブLVまでのぶんを覚える。覚えたものはずっと残る）
  v_old := coalesce(v_row.learned, '[]'::jsonb);
  v_new := public.v2cap_learn(v_old, v_cls, v_jlv);
  select coalesce(jsonb_agg(t.name), '[]'::jsonb) into v_added
    from jsonb_array_elements_text(v_new) as t(name) where not (v_old ? t.name);

  update public.v2cap_profiles set
    lv = v_lv, exp = v_exp,
    total_exp = total_exp + greatest(coalesce(p_amount, 0), 0),
    hp = hp + v_gain[1], mp = mp + v_gain[2], str = str + v_gain[3], dex = dex + v_gain[4],
    agi = agi + v_gain[5], int_stat = int_stat + v_gain[6], vit = vit + v_gain[7], luk = luk + v_gain[8],
    jobs = jsonb_set(coalesce(jobs, '{}'::jsonb), array[v_cls], jsonb_build_object('lv', v_jlv, 'exp', v_jexp)),
    learned = v_new,
    updated_at = now()
  where id = p_player
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'level_ups', v_ups, 'lv', v_lv,
    'job_ups', v_jups, 'jlv', v_jlv,
    'learned', v_added,
    'gains', jsonb_build_object(
      'hp', v_gain[1], 'mp', v_gain[2], 'str', v_gain[3], 'dex', v_gain[4],
      'agi', v_gain[5], 'int_stat', v_gain[6], 'vit', v_gain[7], 'luk', v_gain[8]),
    'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_apply_exp(uuid, int) from public, anon, authenticated;

-- ============================================================
-- ===== 4. キャラクター作成 =====
-- ============================================================
-- 名前と、最初の職業（初期職7つから）。JLV1で覚えるスキルを1つ持って始め、編成の1枠目にも入れておく
create or replace function public.v2cap_create_character(p_username text, p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_username, ''));
  v_cls   text := btrim(coalesce(p_class, ''));
  v_row   public.v2cap_profiles;
  v_learn jsonb;
  v_first text;
  v_mp    int;
  v_set   jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 16 then
    return jsonb_build_object('ok', false, 'error', '名前は1〜16文字で入力してください');
  end if;
  if not exists (select 1 from public.v2cap_classes c where c.id = v_cls and c.stage = 'shoki') then
    return jsonb_build_object('ok', false, 'error', '最初の職業は初期職から選んでください');
  end if;
  select * into v_row from public.v2cap_profiles where id = v_uid;
  if found then return jsonb_build_object('ok', true, 'already', true, 'profile', to_jsonb(v_row)); end if;
  if exists (select 1 from public.v2cap_profiles where lower(username) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'その名前はすでに使われています');
  end if;

  v_learn := public.v2cap_learn('[]'::jsonb, v_cls, 1);
  v_first := v_learn ->> 0;
  if v_first is not null then
    -- 初期のMPは12。回数はMPに収まるだけ（最大5回）
    select k.mp into v_mp from public.v2_skills k where k.name = v_first;
    v_set := jsonb_build_array(jsonb_build_object('name', v_first,
      'uses', case when coalesce(v_mp, 0) = 0 then 5 else greatest(1, least(5, 12 / v_mp)) end));
  end if;

  insert into public.v2cap_profiles (id, username, class, jobs, learned, skill_set)
  values (v_uid, v_name, v_cls, jsonb_build_object(v_cls, jsonb_build_object('lv', 1, 'exp', 0)), v_learn, v_set)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'その名前はすでに使われています');
end;
$$;
revoke all on function public.v2cap_create_character(text, text) from public, anon;
grant execute on function public.v2cap_create_character(text, text) to authenticated;

-- ============================================================
-- ===== 5. 出撃の精算（1戦ごと）=====
-- ============================================================
-- 戦闘は画面で回し、ここへ「どのエリアの、どの敵と戦って、勝ったか」と、落ちた装備のIDを送る。
-- ★EXPは**サーバーが敵のLVから決める**（雑魚±15%・ボス1.4倍）。画面からは受け取らない。
-- ★アイテムLVも**倒した敵のLV**をサーバーが付ける。装備は「そのエリアで落ちるランクか」だけ見る。
-- ★出撃の間隔（10秒）はサーバーでも見る。通信の揺れぶん2秒の余裕を持たせて8秒
-- ⚠勝ち負けは画面の申告のまま（戦闘をサーバーで回すまでは、今のⅡと同じ限界）
create or replace function public.v2cap_sortie_settle(
  p_area int, p_enemy text, p_win boolean, p_drop text default null, p_auto boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cd constant interval := interval '8 seconds';
  v_uid   uuid := auth.uid();
  v_row   public.v2cap_profiles;
  v_area  public.v2cap_areas;
  v_en    public.v2cap_enemies;
  v_eq    public.v2_equipment;
  v_boss  boolean;
  v_win   boolean := coalesce(p_win, false);
  v_base  int;
  v_exp   int := 0;
  v_inv   bigint;
  v_drop  jsonb := null;
  v_cleared  int[];
  v_unlocked int[];
  v_rate  numeric;
  v_cost  int := 0;
  v_stam  int;
  v_stam_at timestamptz;
  v_res   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_area from public.v2cap_areas where id = p_area;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエリアはありません'); end if;
  if not (v_row.unlocked_areas @> array[p_area]) then
    return jsonb_build_object('ok', false, 'error', 'このエリアはまだ解放されていません');
  end if;
  select * into v_en from public.v2cap_enemies where name = p_enemy and area = p_area;
  if not found then return jsonb_build_object('ok', false, 'error', 'その敵はこのエリアにいません'); end if;
  if v_row.last_sortie_at is not null and v_row.last_sortie_at > now() - c_cd then
    return jsonb_build_object('ok', false, 'error', '出撃の間隔が短すぎます');
  end if;
  v_boss := v_en.role = 'boss';

  -- オートはスタミナを1使う。足りなければ通さない（手動は使わない）
  if coalesce(p_auto, false) then
    v_cost := 1;
    v_stam := public.v2cap_stamina_roll(v_uid);
    if v_stam < v_cost then
      return jsonb_build_object('ok', false, 'error', 'スタミナが足りません', 'stamina', v_stam);
    end if;
  end if;

  if v_win then
    v_base := v_en.lv + 9;
    v_exp := case when v_boss then round(v_base * 14 / 10.0)::int
                  else round(v_base * (85 + random() * 30) / 100.0)::int end;
    if p_drop is not null then
      select * into v_eq from public.v2_equipment e where e.id = p_drop and v_area.drop_ranks ? e.rank;
      if found then
        insert into public.v2cap_inventory (player_id, equip_id, ilv)
        values (v_uid, v_eq.id, v_en.lv) returning id into v_inv;
        v_drop := jsonb_build_object('id', v_inv, 'equip_id', v_eq.id, 'ilv', v_en.lv);
      end if;
    end if;
  end if;

  v_cleared := coalesce(v_row.cleared_areas, '{}');
  if v_boss and v_win and not (v_cleared @> array[p_area]) then
    v_cleared := array_append(v_cleared, p_area);
  end if;
  v_unlocked := public.v2cap_unlocked_from_cleared(v_cleared, v_row.unlocked_areas);
  v_rate := case when v_boss then 0 else least(100, v_row.boss_rate + 0.3) end;

  update public.v2cap_profiles
     set unlocked_areas = v_unlocked, cleared_areas = v_cleared, boss_rate = v_rate,
         stamina = greatest(0, stamina - v_cost),
         last_sortie_at = now(), updated_at = now()
   where id = v_uid
   returning stamina, stamina_at into v_stam, v_stam_at;

  v_res := public.v2cap_apply_exp(v_uid, v_exp);
  return jsonb_build_object('ok', true, 'win', v_win, 'boss', v_boss, 'enemy_lv', v_en.lv,
    'exp', v_exp, 'drop', v_drop,
    'unlocked', to_jsonb(v_unlocked), 'cleared', to_jsonb(v_cleared), 'boss_rate', v_rate,
    'level', v_res,
    'stamina', v_stam, 'stamina_at', v_stam_at,
    'stamina_max', public.v2cap_stamina_max(coalesce((v_res -> 'profile' ->> 'lv')::int, v_row.lv)));
end;
$$;
revoke all on function public.v2cap_sortie_settle(int, text, boolean, text, boolean) from public, anon;
grant execute on function public.v2cap_sortie_settle(int, text, boolean, text, boolean) to authenticated;

-- ============================================================
-- ===== 6. 転職（神殿）=====
-- ============================================================
-- いつでも無料。LVはそのまま、ジョブLVは職業ごとに続きから。初めて就く職業はJLV1から
-- ★一次職は元の初期職のJLV30が要る（v2cap_classes.req_cls / req_jlv）
-- ★消費MPが変わる（他職の技は2倍）ので、編成が最大MPを超えたら縮める（v2cap_fit_set）
create or replace function public.v2cap_change_class(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.v2cap_profiles;
  v_cls   public.v2cap_classes;
  v_jobs  jsonb;
  v_jlv   int;
  v_have  int;
  v_old   jsonb;
  v_new   jsonb;
  v_added jsonb;
  v_set   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_cls from public.v2cap_classes where id = btrim(coalesce(p_class, ''));
  if not found then return jsonb_build_object('ok', false, 'error', 'その職業はありません'); end if;
  if v_cls.id = v_row.class then return jsonb_build_object('ok', false, 'error', 'すでにその職業です'); end if;
  if v_cls.req_cls is not null then
    v_have := coalesce((v_row.jobs -> v_cls.req_cls ->> 'lv')::int, 1);
    if v_have < v_cls.req_jlv then
      return jsonb_build_object('ok', false, 'error',
        format('%sのジョブLV%sが必要です（いま%s）', v_cls.req_cls, v_cls.req_jlv, v_have));
    end if;
  end if;

  v_jobs := coalesce(v_row.jobs, '{}'::jsonb);
  if not (v_jobs ? v_cls.id) then
    v_jobs := jsonb_set(v_jobs, array[v_cls.id], jsonb_build_object('lv', 1, 'exp', 0));
  end if;
  v_jlv := coalesce((v_jobs -> v_cls.id ->> 'lv')::int, 1);
  v_old := coalesce(v_row.learned, '[]'::jsonb);
  v_new := public.v2cap_learn(v_old, v_cls.id, v_jlv);
  select coalesce(jsonb_agg(t.name), '[]'::jsonb) into v_added
    from jsonb_array_elements_text(v_new) as t(name) where not (v_old ? t.name);
  v_set := public.v2cap_fit_set(v_row.skill_set, v_cls.id, v_row.mp + public.v2cap_job_bonus_mp(v_cls.id, v_jlv));

  update public.v2cap_profiles
     set class = v_cls.id, jobs = v_jobs, learned = v_new, skill_set = v_set, updated_at = now()
   where id = v_uid
   returning * into v_row;
  return jsonb_build_object('ok', true, 'learned', v_added, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_change_class(text) from public, anon;
grant execute on function public.v2cap_change_class(text) to authenticated;

-- ============================================================
-- ===== 7. スキル編成 =====
-- ============================================================
-- 5枠・並び順＝発動順。置けるのは**覚えたスキルだけ**（どの職業で覚えたものでもよい）。
-- 想定利用MP（Σ 消費MP×回数。他職の技は消費MP2倍）が最大MP（本体＋ジョブのMP）を超えたら保存させない
create or replace function public.v2cap_set_skills(p_set jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_slots   constant int := 5;
  c_use_max constant int := 99;
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_set  jsonb := coalesce(p_set, '[]'::jsonb);
  e      jsonb;
  v_name text;
  v_uses int;
  v_cost int;
  v_max  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if jsonb_typeof(v_set) <> 'array' then return jsonb_build_object('ok', false, 'error', '編成の形式が不正です'); end if;
  if jsonb_array_length(v_set) > c_slots then
    return jsonb_build_object('ok', false, 'error', format('枠は%s個までです', c_slots));
  end if;
  for e in select value from jsonb_array_elements(v_set) loop
    v_name := e ->> 'name';
    if v_name is null then return jsonb_build_object('ok', false, 'error', '枠にスキルが入っていません'); end if;
    if not exists (select 1 from public.v2_skills s where s.name = v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sというスキルはありません', v_name));
    end if;
    if exists (select 1 from public.v2_skills s where s.name = v_name and s.passive) then
      return jsonb_build_object('ok', false, 'error', format('%sはパッシブなので枠に置けません', v_name));
    end if;
    if not (coalesce(v_row.learned, '[]'::jsonb) ? v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sはまだ覚えていません', v_name));
    end if;
    if jsonb_typeof(e -> 'uses') <> 'number' then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数が不正です', v_name));
    end if;
    v_uses := (e ->> 'uses')::int;
    if v_uses < 1 or v_uses > c_use_max then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, c_use_max));
    end if;
  end loop;
  v_cost := public.v2cap_set_cost(v_set, v_row.class);
  v_max  := v_row.mp + public.v2cap_job_bonus_mp(v_row.class, coalesce((v_row.jobs -> v_row.class ->> 'lv')::int, 1));
  if v_cost > v_max then
    return jsonb_build_object('ok', false, 'error', format('想定利用MPが最大MPを超えています（%s / %s）', v_cost, v_max));
  end if;
  update public.v2cap_profiles set skill_set = v_set, updated_at = now() where id = v_uid returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_set_skills(jsonb) from public, anon;
grant execute on function public.v2cap_set_skills(jsonb) to authenticated;

-- お気に入り（スキル一覧を絞り込むための印。存在するスキル名だけ受け付ける）
create or replace function public.v2cap_set_favorites(p_names jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2cap_profiles;
  v_new jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if jsonb_typeof(coalesce(p_names, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '形式が不正です');
  end if;
  select coalesce(jsonb_agg(distinct e.value), '[]'::jsonb) into v_new
    from jsonb_array_elements_text(coalesce(p_names, '[]'::jsonb)) e(value)
   where exists (select 1 from public.v2_skills s where s.name = e.value);
  update public.v2cap_profiles set favorites = v_new, updated_at = now() where id = v_uid returning * into v_row;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_set_favorites(jsonb) from public, anon;
grant execute on function public.v2cap_set_favorites(jsonb) to authenticated;

-- ============================================================
-- ===== 8. 装備の着脱・捨てる =====
-- ============================================================
-- ★必要LVに足りなくても着けられる（効果が下がるだけ。計算は画面側 gear.js）
-- ★枠の種類チェックはサーバー（両手武器は左手を塞ぐ・盾は左手専用・アクセは2枠）＝今のⅡと同じ
create or replace function public.v2cap_equip(p_slot text, p_inventory_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_inv  public.v2cap_inventory;
  v_eq   public.v2_equipment;
  v_new  jsonb;
  v_slot text := p_slot;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if v_slot not in ('right','left','head','body','arm','foot','acc1','acc2') then
    return jsonb_build_object('ok', false, 'error', 'そんな枠はありません');
  end if;
  select * into v_inv from public.v2cap_inventory where id = p_inventory_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  select * into v_eq from public.v2_equipment where id = v_inv.equip_id;

  if v_eq.part = '武器' then
    if v_eq.hands = 'L' and v_slot <> 'left' then return jsonb_build_object('ok', false, 'error', '盾は左手にしか着けられません'); end if;
    if v_eq.hands = '2' and v_slot <> 'right' then return jsonb_build_object('ok', false, 'error', '両手武器は右手に着けます'); end if;
    if v_slot not in ('right','left') then return jsonb_build_object('ok', false, 'error', '武器は手の枠に着けます'); end if;
  elsif v_eq.part = 'アクセ' then
    if v_slot not in ('acc1','acc2') then return jsonb_build_object('ok', false, 'error', 'アクセはアクセ枠に着けます'); end if;
  else
    if v_slot <> (case v_eq.part when '頭' then 'head' when '鎧' then 'body' when '腕' then 'arm' when '足' then 'foot' end) then
      return jsonb_build_object('ok', false, 'error', format('%sは%sの枠に着けます', v_eq.name, v_eq.part));
    end if;
  end if;

  v_new := coalesce(v_row.equipped, '{}'::jsonb);
  -- 同じ装備が別の枠に着いていたら外す
  for v_slot in select key from jsonb_each_text(v_new) where value::bigint = p_inventory_id loop
    v_new := v_new - v_slot;
  end loop;
  v_slot := p_slot;
  v_new := jsonb_set(v_new, array[v_slot], to_jsonb(p_inventory_id));
  -- 両手武器を右手に着けたら左手を空ける／左手に着けるとき右手が両手武器なら外す
  if v_eq.part = '武器' and v_eq.hands = '2' then
    v_new := v_new - 'left';
  elsif v_slot = 'left' and (v_new ? 'right') then
    if exists (select 1 from public.v2cap_inventory i join public.v2_equipment e on e.id = i.equip_id
                where i.id = (v_new ->> 'right')::bigint and e.hands = '2') then
      v_new := v_new - 'right';
    end if;
  end if;
  update public.v2cap_profiles set equipped = v_new, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'equipped', v_new);
end;
$$;
revoke all on function public.v2cap_equip(text, bigint) from public, anon;
grant execute on function public.v2cap_equip(text, bigint) to authenticated;

create or replace function public.v2cap_unequip(p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_new jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select equipped - p_slot into v_new from public.v2cap_profiles where id = v_uid;
  if v_new is null then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  update public.v2cap_profiles set equipped = v_new, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'equipped', v_new);
end;
$$;
revoke all on function public.v2cap_unequip(text) from public, anon;
grant execute on function public.v2cap_unequip(text) to authenticated;

-- 捨てる（着けているものは捨てられない）
create or replace function public.v2cap_discard(p_ids bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2cap_profiles;
  v_n   int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  delete from public.v2cap_inventory i
   where i.player_id = v_uid and i.id = any(coalesce(p_ids, '{}'))
     and not exists (select 1 from jsonb_each_text(coalesce(v_row.equipped, '{}'::jsonb)) q
                      where q.value ~ '^[0-9]+$' and q.value::bigint = i.id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;
revoke all on function public.v2cap_discard(bigint[]) from public, anon;
grant execute on function public.v2cap_discard(bigint[]) to authenticated;

-- ============================================================
-- ===== 9. 開発用 =====
-- ============================================================
-- EXPを入れる（戦闘で入ったのと同じ扱い＝ジョブEXPも同じ量入る）
create or replace function public.v2cap_debug_gain_exp(p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  return public.v2cap_apply_exp(auth.uid(), greatest(1, least(coalesce(p_amount, 0), 20000000)));
end;
$$;
revoke all on function public.v2cap_debug_gain_exp(int) from public, anon;
grant execute on function public.v2cap_debug_gain_exp(int) to authenticated;

-- 自分のキャラを消して作り直せるようにする（この版のデータだけ。今のⅡ・旧版には触らない）
create or replace function public.v2cap_dev_reset()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  delete from public.v2cap_inventory where player_id = auth.uid();
  delete from public.v2cap_profiles where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2cap_dev_reset() from public, anon;
grant execute on function public.v2cap_dev_reset() to authenticated;
