-- ============================================================
-- バトルフロンティアⅡ「レベルキャップあり」版（v2cap）コア
--   設計は docs/v2cap-design.md。画面は src/v2cap、計算の写しは src/v2cap/lib。
-- ------------------------------------------------------------
-- ★このファイルは v2cap_ 接頭辞の新規オブジェクトだけを作る。
--   今のⅡ（v2_）と旧版のテーブル・RPCには**一切触らない**（読みもしない）。
--   2026-10-09 の初期職の見直しで、スキルの名簿（v2cap_skills）と装備の一覧（v2cap_equipment）も
--   この版で持つようになった。
-- ★全体が冪等。仕様を足すたびに**全文を流し直す**運用（今のⅡと同じ）。何度流しても既存データは消えない
--   （例外は §2 の「一度だけの作り直し」＝初期職の見直し・エリアの作り替えのときに1回ずつ消す。
--     2回目以降は何もしない）。
-- ★「-- @@seed:名前」〜「-- @@end:名前」のあいだは手で直さない。
--   `node tools/v2cap-sql.mjs --write` が src/v2cap/lib から作り直す（v2capsql.test.js が見張る）。
--
-- 今のⅡとの違い（ユーザー決定・2026-10-09）：
--   ・LVは上限100。**転職しても下がらない**（周回なし）。必要EXPは上がるほど重い
--   ・場所（15エリア×①②③＝45か所）を1本道で進む。その場所のボスを倒すと次の場所が開く
--   ・1勝で入るEXPとGoldは**場所の表の値**×役割の倍率（朝昼晩1.5倍・レア3倍・ボス5倍）。
--     サーバーが決める（画面からは受け取らない）
--   ・クラスLV（表記は ClassLV・最大30）を職業ごとに持つ。入るのは今の職業。上がるとスキルを覚える
--   ・初期職は10職。職業ごとに装備できる武器が3種決まっている。一次職は一旦なし
--   ・装備は「基本装備＋ランク＋アイテムLV（エリアごとに1つ）」。武器は1本・盾なし・防具は重鎧／軽装
--   ・スキルは**その職業でだけ使える**（他職の技は置けない）。上位職は下位職のスキルをそのまま使える。
--     スキルセットは**職業ごと**に持つ（v2cap_profiles.skill_sets。転職して戻ると前の編成に戻る）
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
-- ---- 1-1. 段階 ----
-- mult … 必要ClassEXPの倍率／per_lv … ClassLVが1上がるごとのステの点数／
-- learn_at … スキルを覚えるClassLV（その職業の技を v2cap_skills の sort 順に当てる）
-- ★いまは初期だけ（一次職は見直すまで一旦なし・2026-10-09）
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
  ('shoki', 1, 1, '{1,5,10,15,20}'::int[])
on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at;
-- @@end:stages

-- ---- 1-2. 職業 ----
-- req_cls / req_jlv … 就くのに要る職業とClassLV（初期職は null）
-- bonus_seq … ClassLVで上がるステの並び（1点ずつ。jobs.js の bonusSeqOf と同じ）
-- weapons … 装備できる武器の種類（3つ）／kind … 通常攻撃が物理（phys）か魔法（mag）か
-- lineage … スキルを使える職業＝[自分, 下位職, その下位職, …]（jobs.js の lineageOf。req_cls をさかのぼったもの）
--   ★スキルは「その職業でだけ使える。上位職は下位職のスキルも使える」（2026-10-09 ユーザー決定）
create table if not exists public.v2cap_classes (
  id        text primary key,
  stage     text not null references public.v2cap_stages(stage),
  sort      int  not null default 0,
  req_cls   text,
  req_jlv   int,
  bonus_seq text[] not null default '{}'
);
alter table public.v2cap_classes add column if not exists weapons text[] not null default '{}';
alter table public.v2cap_classes add column if not exists kind text not null default 'phys';
alter table public.v2cap_classes add column if not exists lineage text[] not null default '{}';
alter table public.v2cap_classes enable row level security;
drop policy if exists v2cap_classes_read on public.v2cap_classes;
create policy v2cap_classes_read on public.v2cap_classes for select to authenticated using (true);
revoke all on table public.v2cap_classes from anon;
grant select on table public.v2cap_classes to authenticated;

-- @@seed:classes
delete from public.v2cap_classes where id <> all('{戦士,槍使い,格闘家,盗賊,弓使い,銃士,魔法使い,呪術師,僧侶,薬師}'::text[]);
insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq, weapons, kind, lineage) values
  ('戦士', 'shoki', 0, null, null, '{str,vit,hp,dex,str,str,vit,hp,str,dex,vit,str,str,hp,vit,dex,str,str,vit,hp,str,dex,vit,str,str,hp,dex,vit,str}'::text[], '{両手剣,斧,鈍器}'::text[], 'phys', '{戦士}'::text[]),
  ('槍使い', 'shoki', 1, null, null, '{str,dex,vit,hp,str,dex,str,dex,vit,str,hp,dex,str,vit,str,dex,str,dex,hp,str,vit,dex,str,dex,str,hp,vit,dex,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{槍使い}'::text[]),
  ('格闘家', 'shoki', 2, null, null, '{str,agi,hp,vit,str,agi,str,agi,hp,vit,str,agi,str,hp,agi,vit,str,agi,str,hp,vit,agi,str,agi,str,hp,vit,agi,str}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{格闘家}'::text[]),
  ('盗賊', 'shoki', 3, null, null, '{agi,dex,str,agi,luk,dex,agi,str,agi,dex,agi,luk,dex,agi,str,agi,dex,luk,agi,dex,agi,str,agi,dex,luk,agi,str,dex,agi}'::text[], '{短剣,片手剣,投擲}'::text[], 'phys', '{盗賊}'::text[]),
  ('弓使い', 'shoki', 4, null, null, '{dex,agi,str,dex,luk,agi,dex,str,dex,agi,dex,luk,agi,dex,str,dex,agi,luk,dex,agi,dex,str,dex,agi,luk,dex,str,agi,dex}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{弓使い}'::text[]),
  ('銃士', 'shoki', 5, null, null, '{dex,str,agi,dex,luk,dex,str,dex,str,dex,agi,luk,dex,str,dex,str,dex,agi,luk,dex,str,dex,str,dex,agi,dex,luk,str,dex}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{銃士}'::text[]),
  ('魔法使い', 'shoki', 6, null, null, '{int_stat,mp,dex,int_stat,agi,int_stat,mp,int_stat,dex,int_stat,agi,int_stat,mp,int_stat,dex,int_stat,mp,int_stat,agi,int_stat,dex,int_stat,mp,int_stat,agi,int_stat,dex,mp,int_stat}'::text[], '{杖,書,短剣}'::text[], 'mag', '{魔法使い}'::text[]),
  ('呪術師', 'shoki', 7, null, null, '{int_stat,mp,dex,int_stat,luk,int_stat,mp,int_stat,dex,luk,int_stat,mp,int_stat,dex,int_stat,luk,int_stat,mp,int_stat,dex,luk,int_stat,mp,int_stat,dex,int_stat,luk,mp,int_stat}'::text[], '{杖,短剣,投擲}'::text[], 'mag', '{呪術師}'::text[]),
  ('僧侶', 'shoki', 8, null, null, '{int_stat,vit,hp,mp,int_stat,vit,hp,int_stat,mp,int_stat,vit,hp,mp,int_stat,vit,int_stat,hp,mp,vit,int_stat,hp,int_stat,mp,vit,int_stat,hp,mp,vit,int_stat}'::text[], '{鈍器,杖,書}'::text[], 'mag', '{僧侶}'::text[]),
  ('薬師', 'shoki', 9, null, null, '{int_stat,dex,hp,mp,int_stat,dex,hp,int_stat,mp,int_stat,dex,hp,mp,int_stat,dex,int_stat,hp,mp,dex,int_stat,hp,int_stat,mp,dex,int_stat,hp,mp,dex,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{薬師}'::text[])
on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,
  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq,
  weapons = excluded.weapons, kind = excluded.kind, lineage = excluded.lineage;
delete from public.v2cap_stages s where s.stage <> all('{shoki}'::text[])
  and not exists (select 1 from public.v2cap_classes c where c.stage = s.stage);
-- @@end:classes

-- ---- 1-3. スキルの名簿 ----
-- ★持つのは「スキル名 → どの職業のものか・消費MP・覚える順」だけ。倍率などの中身は src/v2cap/lib/skills.js
create table if not exists public.v2cap_skills (
  name    text primary key,
  cls     text not null,
  mp      int  not null default 0,
  sort    int  not null default 0,
  passive boolean not null default false
);
alter table public.v2cap_skills enable row level security;
drop policy if exists v2cap_skills_read on public.v2cap_skills;
create policy v2cap_skills_read on public.v2cap_skills for select to authenticated using (true);
revoke all on table public.v2cap_skills from anon;
grant select on table public.v2cap_skills to authenticated;

-- @@seed:skills
delete from public.v2cap_skills;
insert into public.v2cap_skills (name, cls, mp, sort, passive) values
  ('体当たり', '戦士', 4, 1, false),
  ('強撃', '戦士', 11, 2, false),
  ('防御崩し', '戦士', 8, 3, false),
  ('防御態勢', '戦士', 8, 4, false),
  ('シールドアタック', '戦士', 8, 5, false),
  ('狙撃', '弓使い', 8, 1, false),
  ('剛射', '弓使い', 11, 2, false),
  ('貫通射撃', '弓使い', 11, 3, false),
  ('疾風矢', '弓使い', 8, 4, false),
  ('駆け足', '弓使い', 6, 5, false),
  ('マジックアロー', '魔法使い', 5, 1, false),
  ('ファイア', '魔法使い', 13, 2, false),
  ('サンダー', '魔法使い', 13, 3, false),
  ('アイスランス', '魔法使い', 13, 4, false),
  ('精神統一', '魔法使い', 8, 5, false),
  ('ライト', '僧侶', 5, 1, false),
  ('ライトニング', '僧侶', 13, 2, false),
  ('ヒール', '僧侶', 12, 3, false),
  ('祈祷', '僧侶', 15, 4, false),
  ('プロテク', '僧侶', 10, 5, false),
  ('打撃', '格闘家', 4, 1, false),
  ('鉄拳', '格闘家', 11, 2, false),
  ('連打', '格闘家', 11, 3, false),
  ('爆裂拳', '格闘家', 11, 4, false),
  ('残心', '格闘家', 8, 5, false),
  ('突き', '槍使い', 4, 1, false),
  ('薙ぎ払い', '槍使い', 8, 2, false),
  ('投げ槍', '槍使い', 9, 3, false),
  ('三段突き', '槍使い', 11, 4, false),
  ('槍衾', '槍使い', 8, 5, false),
  ('切りつけ', '盗賊', 4, 1, false),
  ('早業', '盗賊', 8, 2, false),
  ('毒塗りの刃', '盗賊', 9, 3, false),
  ('目つぶし', '盗賊', 11, 4, false),
  ('影走り', '盗賊', 8, 5, false),
  ('早撃ち', '銃士', 4, 1, false),
  ('連射', '銃士', 8, 2, false),
  ('精密射撃', '銃士', 9, 3, false),
  ('徹甲弾', '銃士', 11, 4, false),
  ('狙いを定める', '銃士', 8, 5, false),
  ('呪弾', '呪術師', 5, 1, false),
  ('呪縛', '呪術師', 9, 2, false),
  ('毒の呪い', '呪術師', 10, 3, false),
  ('災いの呪い', '呪術師', 13, 4, false),
  ('衰弱の呪詛', '呪術師', 9, 5, false),
  ('薬瓶投げ', '薬師', 5, 1, false),
  ('傷薬', '薬師', 12, 2, false),
  ('毒薬', '薬師', 10, 3, false),
  ('強壮剤', '薬師', 9, 4, false),
  ('気付け薬', '薬師', 8, 5, false);
-- @@end:skills

-- ---- 1-4. 装備の一覧（基本装備）----
-- part … 武器／頭／鎧／腕／足／アクセ ／ type … 武器の種類（防具は系統・アクセは名前）／ line … 重鎧／軽装
-- ★配分（どのステに散らすか）は src/v2cap/lib/equipment.js にある。サーバーが要るのは枠と種類の判定だけ
create table if not exists public.v2cap_equipment (
  id   text primary key,
  name text not null,
  part text not null,
  type text not null,
  line text
);
alter table public.v2cap_equipment enable row level security;
drop policy if exists v2cap_equipment_read on public.v2cap_equipment;
create policy v2cap_equipment_read on public.v2cap_equipment for select to authenticated using (true);
revoke all on table public.v2cap_equipment from anon;
grant select on table public.v2cap_equipment to authenticated;

-- @@seed:equipment
insert into public.v2cap_equipment (id, name, part, type, line) values
  ('w:ロングソード', 'ロングソード', '武器', '片手剣', null),
  ('w:レイピア', 'レイピア', '武器', '片手剣', null),
  ('w:曲刀', '曲刀', '武器', '片手剣', null),
  ('w:大剣', '大剣', '武器', '両手剣', null),
  ('w:太刀', '太刀', '武器', '両手剣', null),
  ('w:片手斧', '片手斧', '武器', '斧', null),
  ('w:大斧', '大斧', '武器', '斧', null),
  ('w:長槍', '長槍', '武器', '槍', null),
  ('w:斧槍', '斧槍', '武器', '槍', null),
  ('w:三叉槍', '三叉槍', '武器', '槍', null),
  ('w:メイス', 'メイス', '武器', '鈍器', null),
  ('w:ハンマー', 'ハンマー', '武器', '鈍器', null),
  ('w:トンファー', 'トンファー', '武器', '鈍器', null),
  ('w:ダガー', 'ダガー', '武器', '短剣', null),
  ('w:ナイフ', 'ナイフ', '武器', '短剣', null),
  ('w:メス', 'メス', '武器', '短剣', null),
  ('w:ナックル', 'ナックル', '武器', '拳', null),
  ('w:鉤爪', '鉤爪', '武器', '拳', null),
  ('w:ガントレット', 'ガントレット', '武器', '拳', null),
  ('w:長弓', '長弓', '武器', '弓', null),
  ('w:短弓', '短弓', '武器', '弓', null),
  ('w:弩', '弩', '武器', '弓', null),
  ('w:拳銃', '拳銃', '武器', '銃', null),
  ('w:長銃', '長銃', '武器', '銃', null),
  ('w:携行砲', '携行砲', '武器', '銃', null),
  ('w:長杖', '長杖', '武器', '杖', null),
  ('w:短杖', '短杖', '武器', '杖', null),
  ('w:棍', '棍', '武器', '杖', null),
  ('w:魔導書', '魔導書', '武器', '書', null),
  ('w:聖典', '聖典', '武器', '書', null),
  ('w:薬学書', '薬学書', '武器', '書', null),
  ('w:投げナイフ', '投げナイフ', '武器', '投擲', null),
  ('w:手裏剣', '手裏剣', '武器', '投擲', null),
  ('w:薬瓶', '薬瓶', '武器', '投擲', null),
  ('w:呪符', '呪符', '武器', '投擲', null),
  ('w:投槍', '投槍', '武器', '投擲', null),
  ('a:鉄兜', '鉄兜', '頭', '重鎧', '重鎧'),
  ('a:鉄冠', '鉄冠', '頭', '重鎧', '重鎧'),
  ('a:プレートメイル', 'プレートメイル', '鎧', '重鎧', '重鎧'),
  ('a:聖鉄の鎧', '聖鉄の鎧', '鎧', '重鎧', '重鎧'),
  ('a:鉄の籠手', '鉄の籠手', '腕', '重鎧', '重鎧'),
  ('a:聖鉄の腕甲', '聖鉄の腕甲', '腕', '重鎧', '重鎧'),
  ('a:鉄靴', '鉄靴', '足', '重鎧', '重鎧'),
  ('a:聖鉄の具足', '聖鉄の具足', '足', '重鎧', '重鎧'),
  ('a:バンダナ', 'バンダナ', '頭', '軽装', '軽装'),
  ('a:フード', 'フード', '頭', '軽装', '軽装'),
  ('a:レザーアーマー', 'レザーアーマー', '鎧', '軽装', '軽装'),
  ('a:ローブ', 'ローブ', '鎧', '軽装', '軽装'),
  ('a:リストバンド', 'リストバンド', '腕', '軽装', '軽装'),
  ('a:魔導腕輪', '魔導腕輪', '腕', '軽装', '軽装'),
  ('a:ブーツ', 'ブーツ', '足', '軽装', '軽装'),
  ('a:サンダル', 'サンダル', '足', '軽装', '軽装'),
  ('c:イヤリング', 'イヤリング', 'アクセ', 'イヤリング', null),
  ('c:ネックレス', 'ネックレス', 'アクセ', 'ネックレス', null),
  ('c:リング', 'リング', 'アクセ', 'リング', null),
  ('c:ベルト', 'ベルト', 'アクセ', 'ベルト', null)
on conflict (id) do update set name = excluded.name, part = excluded.part, type = excluded.type, line = excluded.line;
-- @@end:equipment

-- ---- 1-5. 場所（15エリア×①②③＝45か所）----
-- ★2026-10-09 エリアの作り替え（ユーザー指示）：難易度帯（v2cap_tiers）とエリア（v2cap_areas）をやめて、
--   場所の1本道にした。どちらもマスタだけの表（キャラのデータは指していない）なので消してよい
drop table if exists public.v2cap_tiers;
drop table if exists public.v2cap_areas;
-- id … 1〜45（並び＝開く順）／area・sub … エリアの番号（1〜15）と ①②③
-- exp_* / gold_* … 1体あたりの経験値とGoldの範囲（役割の倍率を掛ける前）
-- lv_* … その場所の敵のLVの範囲／item_lv … 落ちる装備のアイテムLV（エリアごとに1つ）
-- drop_ranks … 落ちるランクと重み（後の場所ほど高いランクが出やすい）
create table if not exists public.v2cap_spots (
  id         int  primary key,
  area       int  not null,
  sub        int  not null,
  area_name  text not null,
  name       text not null,
  exp_min    int  not null,
  exp_max    int  not null,
  gold_min   int  not null,
  gold_max   int  not null,
  lv_min     int  not null,
  lv_max     int  not null,
  item_lv    int  not null,
  drop_ranks jsonb not null
);
alter table public.v2cap_spots enable row level security;
drop policy if exists v2cap_spots_read on public.v2cap_spots;
create policy v2cap_spots_read on public.v2cap_spots for select to authenticated using (true);
revoke all on table public.v2cap_spots from anon;
grant select on table public.v2cap_spots to authenticated;

-- @@seed:spots
delete from public.v2cap_spots;
insert into public.v2cap_spots (id, area, sub, area_name, name, exp_min, exp_max, gold_min, gold_max, lv_min, lv_max, item_lv, drop_ranks) values
  (1, 1, 1, '始まりの森', '木漏れ日の小径', 2, 3, 10, 15, 1, 13, 13, '{"F":47.9,"E":37.5,"D":14.7}'::jsonb),
  (2, 1, 2, '始まりの森', '苔むした獣道', 2, 4, 10, 17, 13, 15, 13, '{"F":40,"E":40,"D":20}'::jsonb),
  (3, 1, 3, '始まりの森', '森主の古樹', 3, 5, 10, 20, 15, 19, 13, '{"F":32.8,"E":41.3,"D":26}'::jsonb),
  (4, 2, 1, '荒廃した草原', '風吹く丘陵', 4, 5, 15, 20, 19, 21, 21, '{"F":40.1,"E":30.2,"D":19.5,"C":10.2}'::jsonb),
  (5, 2, 2, '荒廃した草原', '焼け落ちた廃村', 4, 6, 15, 22, 21, 23, 21, '{"F":35,"E":30,"D":22,"C":13}'::jsonb),
  (6, 2, 3, '荒廃した草原', '骸の古戦場', 5, 7, 15, 25, 23, 25, 21, '{"F":31.8,"E":29.6,"D":23.5,"C":15.1}'::jsonb),
  (7, 3, 1, '古代の洞窟', '鍾乳の回廊', 6, 7, 20, 25, 25, 28, 28, '{"F":32.6,"E":28.6,"D":22.9,"C":11.6,"B":4.2}'::jsonb),
  (8, 3, 2, '古代の洞窟', '刻印の大広間', 6, 8, 20, 27, 28, 29, 28, '{"F":30,"E":28,"D":24,"C":13,"B":5}'::jsonb),
  (9, 3, 3, '古代の洞窟', '封じられし石室', 7, 9, 20, 30, 29, 32, 28, '{"F":27.5,"E":27.3,"D":24.9,"C":14.4,"B":5.9}'::jsonb),
  (10, 4, 1, '蒼海の入り江', '白砂の浜辺', 8, 9, 25, 30, 32, 34, 34, '{"F":28.2,"E":26.7,"D":22.4,"C":13.9,"B":8.8}'::jsonb),
  (11, 4, 2, '蒼海の入り江', '難破船の墓場', 8, 10, 25, 32, 34, 36, 34, '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb),
  (12, 4, 3, '蒼海の入り江', '大渦の海蝕洞', 9, 11, 25, 35, 36, 38, 34, '{"F":23.5,"E":25,"D":23.5,"C":16.3,"B":11.6}'::jsonb),
  (13, 5, 1, '灼砂の遺丘', '陽炎の砂原', 10, 11, 30, 35, 38, 39, 39, '{"F":22.4,"E":24.5,"D":23.8,"C":17,"B":12.4}'::jsonb),
  (14, 5, 2, '灼砂の遺丘', '埋もれし神殿', 10, 12, 30, 37, 39, 40, 39, '{"F":20.1,"E":23.4,"D":24.1,"C":18.3,"B":14.2}'::jsonb),
  (15, 5, 3, '灼砂の遺丘', '砂王の玄室', 11, 13, 30, 40, 40, 43, 39, '{"F":18,"E":22.2,"D":24.2,"C":19.5,"B":16}'::jsonb),
  (16, 6, 1, '巨峰山脈', '岩肌の山道', 12, 13, 35, 40, 43, 46, 46, '{"E":41.7,"D":30.1,"C":18.3,"B":7.5,"A":2.3}'::jsonb),
  (17, 6, 2, '巨峰山脈', '風哭きの峠', 12, 14, 35, 42, 46, 49, 46, '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb),
  (18, 6, 3, '巨峰山脈', '天衝く頂', 13, 15, 35, 45, 49, 54, 46, '{"E":36.7,"D":29.9,"C":20.6,"B":9.5,"A":3.3}'::jsonb),
  (19, 7, 1, '常闇の樹海', '黄昏の境界', 14, 15, 40, 45, 54, 56, 56, '{"E":36.1,"D":29.8,"C":20.8,"B":9.8,"A":3.4}'::jsonb),
  (20, 7, 2, '常闇の樹海', '惑い霧の迷路', 14, 16, 40, 47, 56, 58, 56, '{"E":34.8,"D":29.7,"C":21.4,"B":10.4,"A":3.7}'::jsonb),
  (21, 7, 3, '常闇の樹海', '光喰らいの大樹', 15, 17, 40, 50, 58, 61, 56, '{"E":33.6,"D":29.5,"C":21.9,"B":10.9,"A":4.1}'::jsonb),
  (22, 8, 1, '白銀の霊峰', '凍てつく雪原', 16, 17, 45, 50, 61, 64, 64, '{"E":34.1,"D":29.2,"C":20.6,"B":10.5,"A":5.6}'::jsonb),
  (23, 8, 2, '白銀の霊峰', '氷晶の大洞', 16, 18, 45, 52, 64, 66, 64, '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb),
  (24, 8, 3, '白銀の霊峰', '白霊の祭壇', 17, 19, 45, 55, 66, 70, 64, '{"E":29,"D":28,"C":22.4,"B":12.9,"A":7.7}'::jsonb),
  (25, 9, 1, '雷鳴の断崖', '稲光の岩棚', 18, 19, 50, 55, 70, 72, 72, '{"E":27.1,"D":27.5,"C":22.9,"B":13.8,"A":8.7}'::jsonb),
  (26, 9, 2, '雷鳴の断崖', '轟雷の架け橋', 18, 20, 50, 57, 72, 74, 72, '{"E":23.6,"D":26.1,"C":23.8,"B":15.7,"A":10.8}'::jsonb),
  (27, 9, 3, '雷鳴の断崖', '雷帝の玉座', 19, 21, 50, 60, 74, 77, 72, '{"E":20.4,"D":24.6,"C":24.4,"B":17.5,"A":13.1}'::jsonb),
  (28, 10, 1, '煉獄火山', '噴煙の山麓', 20, 21, 55, 60, 77, 78, 78, '{"D":46,"C":29.7,"B":17,"A":7.3}'::jsonb),
  (29, 10, 2, '煉獄火山', '溶岩の大河', 20, 22, 55, 62, 78, 79, 78, '{"D":40,"C":30,"B":20,"A":10}'::jsonb),
  (30, 10, 3, '煉獄火山', '業火の炉心', 21, 23, 55, 65, 79, 81, 78, '{"D":39.2,"C":30,"B":20.4,"A":10.4}'::jsonb),
  (31, 11, 1, '腐海の沼獄', '瘴気漂う湿原', 22, 23, 60, 65, 81, 82, 82, '{"D":38.8,"C":30,"B":20.6,"A":10.6}'::jsonb),
  (32, 11, 2, '腐海の沼獄', '沈みし廃村', 22, 24, 60, 67, 82, 83, 82, '{"D":38,"C":30,"B":21,"A":11}'::jsonb),
  (33, 11, 3, '腐海の沼獄', '腐王の苗床', 23, 25, 60, 70, 83, 85, 82, '{"D":37.3,"C":29.9,"B":21.4,"A":11.4}'::jsonb),
  (34, 12, 1, '奈落の坑道', '廃れた採掘場', 24, 25, 65, 70, 85, 86, 86, '{"D":36.9,"C":29.9,"B":21.6,"A":11.7}'::jsonb),
  (35, 12, 2, '奈落の坑道', '底なしの大縦穴', 24, 26, 65, 72, 86, 87, 86, '{"D":36.1,"C":29.9,"B":21.9,"A":12.1}'::jsonb),
  (36, 12, 3, '奈落の坑道', '掘り当てられし禁域', 25, 27, 65, 75, 87, 89, 86, '{"D":35.4,"C":29.8,"B":22.3,"A":12.5}'::jsonb),
  (37, 13, 1, '蒼天の浮遊城', '雲海の桟橋', 26, 27, 70, 75, 89, 90, 90, '{"D":35.7,"C":29.1,"B":21.7,"A":13.5}'::jsonb),
  (38, 13, 2, '蒼天の浮遊城', '浮かぶ空中庭園', 26, 28, 70, 77, 90, 91, 90, '{"D":35,"C":29,"B":22,"A":14}'::jsonb),
  (39, 13, 3, '蒼天の浮遊城', '天主の謁見の間', 27, 29, 70, 80, 91, 93, 90, '{"D":33.6,"C":28.8,"B":22.7,"A":14.9}'::jsonb),
  (40, 14, 1, '星霜の遺跡', '風化した列柱廊', 28, 29, 75, 80, 93, 94, 94, '{"D":32.9,"C":28.7,"B":23,"A":15.4}'::jsonb),
  (41, 14, 2, '星霜の遺跡', '時止まりの大書庫', 28, 30, 75, 82, 94, 94, 94, '{"D":31.5,"C":28.5,"B":23.6,"A":16.4}'::jsonb),
  (42, 14, 3, '星霜の遺跡', '星墜ちる観測台', 29, 31, 75, 85, 94, 96, 94, '{"D":30.1,"C":28.2,"B":24.2,"A":17.4}'::jsonb),
  (43, 15, 1, '深淵の海溝', '燐光の海棚', 30, 31, 80, 85, 96, 97, 97, '{"D":29.4,"C":28.1,"B":24.5,"A":18}'::jsonb),
  (44, 15, 2, '深淵の海溝', '沈みし古都', 30, 32, 80, 87, 97, 98, 97, '{"D":28.1,"C":27.8,"B":25.1,"A":19}'::jsonb),
  (45, 15, 3, '深淵の海溝', '原初の深淵', 31, 33, 80, 90, 98, 100, 97, '{"D":26.8,"C":27.4,"B":25.6,"A":20.1}'::jsonb);
-- @@end:spots

-- ---- 1-6. 敵 ----
-- ★EXP・Gold・アイテムLVはサーバーがここ（と v2cap_spots）から決める（画面からは「どの敵と戦ったか」だけ受け取る）
-- role … normal（ふつう）／timed（朝昼晩の限定・1.5倍）／rare（3倍）／boss（5倍）。band … 朝・昼・晩
-- ★主キーは「名前＋場所」。同じ敵が②と③の両方に出る（場所ごとにLVが違う）ので名前だけでは決まらない
create table if not exists public.v2cap_enemies (
  name text not null,
  spot int  not null,
  lv   int  not null,
  role text not null,
  band text,
  primary key (name, spot)
);
-- 作り替えの前の形（area 列・名前だけが主キー）から移す。種は下で丸ごと入れ直すので、列と主キーだけそろえる
alter table public.v2cap_enemies add column if not exists spot int;
alter table public.v2cap_enemies add column if not exists band text;
alter table public.v2cap_enemies drop column if exists area;
do $$
declare v_con text;
begin
  select c.conname into v_con from pg_constraint c
   where c.conrelid = 'public.v2cap_enemies'::regclass and c.contype = 'p' and array_length(c.conkey, 1) = 1;
  if v_con is not null then
    execute format('alter table public.v2cap_enemies drop constraint %I', v_con);
  end if;
end $$;
alter table public.v2cap_enemies enable row level security;
drop policy if exists v2cap_enemies_read on public.v2cap_enemies;
create policy v2cap_enemies_read on public.v2cap_enemies for select to authenticated using (true);
revoke all on table public.v2cap_enemies from anon;
grant select on table public.v2cap_enemies to authenticated;

-- @@seed:enemies
delete from public.v2cap_enemies;
insert into public.v2cap_enemies (name, spot, lv, role, band) values
  ('スライム', 1, 1, 'normal', null),
  ('コウモリ', 1, 9, 'normal', null),
  ('ツユフェアリー', 1, 11, 'timed', '朝'),
  ('モヤガエル', 1, 11, 'timed', '朝'),
  ('ひなたトカゲ', 1, 11, 'timed', '昼'),
  ('ひなたアゲハ', 1, 11, 'timed', '昼'),
  ('ツキミミズク', 1, 11, 'timed', '晩'),
  ('ヨナキコオロギ', 1, 11, 'timed', '晩'),
  ('ジェイドスライム', 1, 13, 'rare', null),
  ('エンシェントトレント', 1, 13, 'rare', null),
  ('オーロラフェアリー', 1, 13, 'rare', '朝'),
  ('サンリザード', 1, 13, 'rare', '昼'),
  ('ナイトオウル', 1, 13, 'rare', '晩'),
  ('オヤブンネズミ', 1, 13, 'boss', null),
  ('スライム', 2, 13, 'normal', null),
  ('コウモリ', 2, 13, 'normal', null),
  ('毒キノコ', 2, 14, 'normal', null),
  ('森ネズミ', 2, 14, 'normal', null),
  ('ツユフェアリー', 2, 15, 'timed', '朝'),
  ('モヤガエル', 2, 15, 'timed', '朝'),
  ('ひなたトカゲ', 2, 15, 'timed', '昼'),
  ('ひなたアゲハ', 2, 15, 'timed', '昼'),
  ('ツキミミズク', 2, 15, 'timed', '晩'),
  ('ヨナキコオロギ', 2, 15, 'timed', '晩'),
  ('ジェイドスライム', 2, 15, 'rare', null),
  ('エンシェントトレント', 2, 15, 'rare', null),
  ('オーロラフェアリー', 2, 15, 'rare', '朝'),
  ('サンリザード', 2, 15, 'rare', '昼'),
  ('ナイトオウル', 2, 15, 'rare', '晩'),
  ('クイーンアント', 2, 15, 'boss', null),
  ('毒キノコ', 3, 15, 'normal', null),
  ('森ネズミ', 3, 16, 'normal', null),
  ('オオアリ', 3, 17, 'normal', null),
  ('つるヘビ', 3, 18, 'normal', null),
  ('ツユフェアリー', 3, 18, 'timed', '朝'),
  ('モヤガエル', 3, 18, 'timed', '朝'),
  ('ひなたトカゲ', 3, 18, 'timed', '昼'),
  ('ひなたアゲハ', 3, 18, 'timed', '昼'),
  ('ツキミミズク', 3, 18, 'timed', '晩'),
  ('ヨナキコオロギ', 3, 18, 'timed', '晩'),
  ('ジェイドスライム', 3, 19, 'rare', null),
  ('エンシェントトレント', 3, 19, 'rare', null),
  ('オーロラフェアリー', 3, 19, 'rare', '朝'),
  ('サンリザード', 3, 19, 'rare', '昼'),
  ('ナイトオウル', 3, 19, 'rare', '晩'),
  ('ビッグスライム', 3, 19, 'boss', null),
  ('ゴブリン', 4, 19, 'normal', null),
  ('野良犬', 4, 20, 'normal', null),
  ('霧這いワーム', 4, 21, 'timed', '朝'),
  ('オオトビバッタ', 4, 21, 'timed', '朝'),
  ('陽炎リザード', 4, 21, 'timed', '昼'),
  ('炎天ハゲタカ', 4, 21, 'timed', '昼'),
  ('夜盗スカウト', 4, 21, 'timed', '晩'),
  ('夜盗ハウンド', 4, 21, 'timed', '晩'),
  ('ホブゴブリン', 4, 21, 'rare', null),
  ('シルバーフェンリル', 4, 21, 'rare', null),
  ('ミストワーム', 4, 21, 'rare', '朝'),
  ('フレアバジリスク', 4, 21, 'rare', '昼'),
  ('シャドウシーフ', 4, 21, 'rare', '晩'),
  ('群れ長グレイファング', 4, 21, 'boss', null),
  ('ゴブリン', 5, 21, 'normal', null),
  ('野良犬', 5, 21, 'normal', null),
  ('盗賊', 5, 22, 'normal', null),
  ('草原オオカミ', 5, 22, 'normal', null),
  ('霧這いワーム', 5, 23, 'timed', '朝'),
  ('オオトビバッタ', 5, 23, 'timed', '朝'),
  ('陽炎リザード', 5, 23, 'timed', '昼'),
  ('炎天ハゲタカ', 5, 23, 'timed', '昼'),
  ('夜盗スカウト', 5, 23, 'timed', '晩'),
  ('夜盗ハウンド', 5, 23, 'timed', '晩'),
  ('ホブゴブリン', 5, 23, 'rare', null),
  ('シルバーフェンリル', 5, 23, 'rare', null),
  ('ミストワーム', 5, 23, 'rare', '朝'),
  ('フレアバジリスク', 5, 23, 'rare', '昼'),
  ('シャドウシーフ', 5, 23, 'rare', '晩'),
  ('ゴブリンチーフ', 5, 23, 'boss', null),
  ('盗賊', 6, 23, 'normal', null),
  ('草原オオカミ', 6, 23, 'normal', null),
  ('ゴブリン射手', 6, 24, 'normal', null),
  ('キバイノシシ', 6, 24, 'normal', null),
  ('霧這いワーム', 6, 25, 'timed', '朝'),
  ('オオトビバッタ', 6, 25, 'timed', '朝'),
  ('陽炎リザード', 6, 25, 'timed', '昼'),
  ('炎天ハゲタカ', 6, 25, 'timed', '昼'),
  ('夜盗スカウト', 6, 25, 'timed', '晩'),
  ('夜盗ハウンド', 6, 25, 'timed', '晩'),
  ('ホブゴブリン', 6, 25, 'rare', null),
  ('シルバーフェンリル', 6, 25, 'rare', null),
  ('ミストワーム', 6, 25, 'rare', '朝'),
  ('フレアバジリスク', 6, 25, 'rare', '昼'),
  ('シャドウシーフ', 6, 25, 'rare', '晩'),
  ('盗賊団のリーダー', 6, 25, 'boss', null),
  ('コボルト', 7, 25, 'normal', null),
  ('スケルトン', 7, 27, 'normal', null),
  ('暁ガーゴイル', 7, 27, 'timed', '朝'),
  ('ヨロイムカデ', 7, 27, 'timed', '朝'),
  ('石化トカゲ', 7, 27, 'timed', '昼'),
  ('イワサソリ', 7, 27, 'timed', '昼'),
  ('サマヨイレイス', 7, 27, 'timed', '晩'),
  ('亡霊コボルト', 7, 27, 'timed', '晩'),
  ('オブシディアンコボルト', 7, 28, 'rare', null),
  ('スケルトンナイト', 7, 28, 'rare', null),
  ('ドーンガーゴイル', 7, 28, 'rare', '朝'),
  ('ロックバジリスク', 7, 28, 'rare', '昼'),
  ('ダークレイス', 7, 28, 'rare', '晩'),
  ('コボルト族長ドグラ', 7, 28, 'boss', null),
  ('コボルト', 8, 28, 'normal', null),
  ('スケルトン', 8, 28, 'normal', null),
  ('ストーンゴーレム', 8, 28, 'normal', null),
  ('ホラアナグモ', 8, 29, 'normal', null),
  ('暁ガーゴイル', 8, 29, 'timed', '朝'),
  ('ヨロイムカデ', 8, 29, 'timed', '朝'),
  ('石化トカゲ', 8, 29, 'timed', '昼'),
  ('イワサソリ', 8, 29, 'timed', '昼'),
  ('サマヨイレイス', 8, 29, 'timed', '晩'),
  ('亡霊コボルト', 8, 29, 'timed', '晩'),
  ('オブシディアンコボルト', 8, 29, 'rare', null),
  ('スケルトンナイト', 8, 29, 'rare', null),
  ('ドーンガーゴイル', 8, 29, 'rare', '朝'),
  ('ロックバジリスク', 8, 29, 'rare', '昼'),
  ('ダークレイス', 8, 29, 'rare', '晩'),
  ('ボーンジェネラル', 8, 29, 'boss', null),
  ('ストーンゴーレム', 9, 29, 'normal', null),
  ('ホラアナグモ', 9, 30, 'normal', null),
  ('コボルト投石手', 9, 30, 'normal', null),
  ('スケルトンドッグ', 9, 31, 'normal', null),
  ('暁ガーゴイル', 9, 31, 'timed', '朝'),
  ('ヨロイムカデ', 9, 31, 'timed', '朝'),
  ('石化トカゲ', 9, 31, 'timed', '昼'),
  ('イワサソリ', 9, 31, 'timed', '昼'),
  ('サマヨイレイス', 9, 31, 'timed', '晩'),
  ('亡霊コボルト', 9, 31, 'timed', '晩'),
  ('オブシディアンコボルト', 9, 32, 'rare', null),
  ('スケルトンナイト', 9, 32, 'rare', null),
  ('ドーンガーゴイル', 9, 32, 'rare', '朝'),
  ('ロックバジリスク', 9, 32, 'rare', '昼'),
  ('ダークレイス', 9, 32, 'rare', '晩'),
  ('古代の番人', 9, 32, 'boss', null),
  ('サハギン', 10, 32, 'normal', null),
  ('海賊', 10, 33, 'normal', null),
  ('朝凪のセイレーン', 10, 34, 'timed', '朝'),
  ('ギンバネトビウオ', 10, 34, 'timed', '朝'),
  ('シオマネキ', 10, 34, 'timed', '昼'),
  ('オオウミガメ', 10, 34, 'timed', '昼'),
  ('夜光アンコウ', 10, 34, 'timed', '晩'),
  ('ホタルダコ', 10, 34, 'timed', '晩'),
  ('コーラルナイト', 10, 34, 'rare', null),
  ('ベビークラーケン', 10, 34, 'rare', null),
  ('サンライズセイレーン', 10, 34, 'rare', '朝'),
  ('ジャイアントクラブ', 10, 34, 'rare', '昼'),
  ('ランタンアンコウ', 10, 34, 'rare', '晩'),
  ('鉄鋏ヨロイガニ', 10, 34, 'boss', null),
  ('サハギン', 11, 34, 'normal', null),
  ('海賊', 11, 34, 'normal', null),
  ('毒クラゲ', 11, 35, 'normal', null),
  ('イリエザメ', 11, 35, 'normal', null),
  ('朝凪のセイレーン', 11, 36, 'timed', '朝'),
  ('ギンバネトビウオ', 11, 36, 'timed', '朝'),
  ('シオマネキ', 11, 36, 'timed', '昼'),
  ('オオウミガメ', 11, 36, 'timed', '昼'),
  ('夜光アンコウ', 11, 36, 'timed', '晩'),
  ('ホタルダコ', 11, 36, 'timed', '晩'),
  ('コーラルナイト', 11, 36, 'rare', null),
  ('ベビークラーケン', 11, 36, 'rare', null),
  ('サンライズセイレーン', 11, 36, 'rare', '朝'),
  ('ジャイアントクラブ', 11, 36, 'rare', '昼'),
  ('ランタンアンコウ', 11, 36, 'rare', '晩'),
  ('海賊船長ガルシオ', 11, 36, 'boss', null),
  ('毒クラゲ', 12, 36, 'normal', null),
  ('イリエザメ', 12, 36, 'normal', null),
  ('大ウミヘビ', 12, 37, 'normal', null),
  ('海賊砲手', 12, 37, 'normal', null),
  ('朝凪のセイレーン', 12, 38, 'timed', '朝'),
  ('ギンバネトビウオ', 12, 38, 'timed', '朝'),
  ('シオマネキ', 12, 38, 'timed', '昼'),
  ('オオウミガメ', 12, 38, 'timed', '昼'),
  ('夜光アンコウ', 12, 38, 'timed', '晩'),
  ('ホタルダコ', 12, 38, 'timed', '晩'),
  ('コーラルナイト', 12, 38, 'rare', null),
  ('ベビークラーケン', 12, 38, 'rare', null),
  ('サンライズセイレーン', 12, 38, 'rare', '朝'),
  ('ジャイアントクラブ', 12, 38, 'rare', '昼'),
  ('ランタンアンコウ', 12, 38, 'rare', '晩'),
  ('シーサーペント', 12, 38, 'boss', null),
  ('砂喰いワーム', 13, 38, 'normal', null),
  ('墓守ミイラ', 13, 39, 'normal', null),
  ('カゲロウトカゲ', 13, 39, 'timed', '朝'),
  ('聖スカラベ', 13, 39, 'timed', '朝'),
  ('アヌビス兵', 13, 39, 'timed', '昼'),
  ('熱砂コブラ', 13, 39, 'timed', '昼'),
  ('月影ジャッカル', 13, 39, 'timed', '晩'),
  ('ワライハイエナ', 13, 39, 'timed', '晩'),
  ('サンドワーム', 13, 39, 'rare', null),
  ('ゴールデンマミー', 13, 39, 'rare', null),
  ('ミラージュリザード', 13, 39, 'rare', '朝'),
  ('フレイムアヌビス', 13, 39, 'rare', '昼'),
  ('ルナジャッカル', 13, 39, 'rare', '晩'),
  ('砂地獄アントリオン', 13, 39, 'boss', null),
  ('砂喰いワーム', 14, 39, 'normal', null),
  ('墓守ミイラ', 14, 39, 'normal', null),
  ('サンドスコーピオン', 14, 39, 'normal', null),
  ('ツボミミック', 14, 40, 'normal', null),
  ('カゲロウトカゲ', 14, 40, 'timed', '朝'),
  ('聖スカラベ', 14, 40, 'timed', '朝'),
  ('アヌビス兵', 14, 40, 'timed', '昼'),
  ('熱砂コブラ', 14, 40, 'timed', '昼'),
  ('月影ジャッカル', 14, 40, 'timed', '晩'),
  ('ワライハイエナ', 14, 40, 'timed', '晩'),
  ('サンドワーム', 14, 40, 'rare', null),
  ('ゴールデンマミー', 14, 40, 'rare', null),
  ('ミラージュリザード', 14, 40, 'rare', '朝'),
  ('フレイムアヌビス', 14, 40, 'rare', '昼'),
  ('ルナジャッカル', 14, 40, 'rare', '晩'),
  ('ミイラ大神官', 14, 40, 'boss', null),
  ('サンドスコーピオン', 15, 40, 'normal', null),
  ('ツボミミック', 15, 41, 'normal', null),
  ('サンドゴーレム', 15, 41, 'normal', null),
  ('盗掘者', 15, 42, 'normal', null),
  ('カゲロウトカゲ', 15, 42, 'timed', '朝'),
  ('聖スカラベ', 15, 42, 'timed', '朝'),
  ('アヌビス兵', 15, 42, 'timed', '昼'),
  ('熱砂コブラ', 15, 42, 'timed', '昼'),
  ('月影ジャッカル', 15, 42, 'timed', '晩'),
  ('ワライハイエナ', 15, 42, 'timed', '晩'),
  ('サンドワーム', 15, 43, 'rare', null),
  ('ゴールデンマミー', 15, 43, 'rare', null),
  ('ミラージュリザード', 15, 43, 'rare', '朝'),
  ('フレイムアヌビス', 15, 43, 'rare', '昼'),
  ('ルナジャッカル', 15, 43, 'rare', '晩'),
  ('砂皇スカラベウス', 15, 43, 'boss', null),
  ('山岳ゴブリン', 16, 43, 'normal', null),
  ('岩石ゴーレム', 16, 45, 'normal', null),
  ('払暁のワイバーン', 16, 45, 'timed', '朝'),
  ('ハヤテハヤブサ', 16, 45, 'timed', '朝'),
  ('剛猿', 16, 45, 'timed', '昼'),
  ('鉄針ヤマアラシ', 16, 45, 'timed', '昼'),
  ('宵闇ヤマネコ', 16, 45, 'timed', '晩'),
  ('トオボエウルフ', 16, 45, 'timed', '晩'),
  ('ストームグリフォン', 16, 46, 'rare', null),
  ('マウンテンゴーレム', 16, 46, 'rare', null),
  ('ドーンワイバーン', 16, 46, 'rare', '朝'),
  ('ブレイズゴリラ', 16, 46, 'rare', '昼'),
  ('シャドウキャット', 16, 46, 'rare', '晩'),
  ('岩砕きグリズリー', 16, 46, 'boss', null),
  ('山岳ゴブリン', 17, 46, 'normal', null),
  ('岩石ゴーレム', 17, 47, 'normal', null),
  ('グリフォン', 17, 47, 'normal', null),
  ('ミネオオワシ', 17, 48, 'normal', null),
  ('払暁のワイバーン', 17, 48, 'timed', '朝'),
  ('ハヤテハヤブサ', 17, 48, 'timed', '朝'),
  ('剛猿', 17, 48, 'timed', '昼'),
  ('鉄針ヤマアラシ', 17, 48, 'timed', '昼'),
  ('宵闇ヤマネコ', 17, 48, 'timed', '晩'),
  ('トオボエウルフ', 17, 48, 'timed', '晩'),
  ('ストームグリフォン', 17, 49, 'rare', null),
  ('マウンテンゴーレム', 17, 49, 'rare', null),
  ('ドーンワイバーン', 17, 49, 'rare', '朝'),
  ('ブレイズゴリラ', 17, 49, 'rare', '昼'),
  ('シャドウキャット', 17, 49, 'rare', '晩'),
  ('峠守ギガトロール', 17, 49, 'boss', null),
  ('グリフォン', 18, 49, 'normal', null),
  ('ミネオオワシ', 18, 50, 'normal', null),
  ('山岳トロール', 18, 51, 'normal', null),
  ('イワグマ', 18, 52, 'normal', null),
  ('払暁のワイバーン', 18, 53, 'timed', '朝'),
  ('ハヤテハヤブサ', 18, 53, 'timed', '朝'),
  ('剛猿', 18, 53, 'timed', '昼'),
  ('鉄針ヤマアラシ', 18, 53, 'timed', '昼'),
  ('宵闇ヤマネコ', 18, 53, 'timed', '晩'),
  ('トオボエウルフ', 18, 53, 'timed', '晩'),
  ('ストームグリフォン', 18, 54, 'rare', null),
  ('マウンテンゴーレム', 18, 54, 'rare', null),
  ('ドーンワイバーン', 18, 54, 'rare', '朝'),
  ('ブレイズゴリラ', 18, 54, 'rare', '昼'),
  ('シャドウキャット', 18, 54, 'rare', '晩'),
  ('雷鷲サンダーロック', 18, 54, 'boss', null),
  ('食人樹', 19, 54, 'normal', null),
  ('マンドラゴラ', 19, 55, 'normal', null),
  ('霧纏いトレント', 19, 56, 'timed', '朝'),
  ('胞子マイコニド', 19, 56, 'timed', '朝'),
  ('コモレビピクシー', 19, 56, 'timed', '昼'),
  ('ヨロイカブト', 19, 56, 'timed', '昼'),
  ('ナゲキバンシー', 19, 56, 'timed', '晩'),
  ('チスイオオコウモリ', 19, 56, 'timed', '晩'),
  ('キラープラント', 19, 56, 'rare', null),
  ('クイーンマンドラゴラ', 19, 56, 'rare', null),
  ('ミストトレント', 19, 56, 'rare', '朝'),
  ('サンライトピクシー', 19, 56, 'rare', '昼'),
  ('グリーフバンシー', 19, 56, 'rare', '晩'),
  ('妖蛾ポイズンモス', 19, 56, 'boss', null),
  ('食人樹', 20, 56, 'normal', null),
  ('マンドラゴラ', 20, 56, 'normal', null),
  ('シャドウウルフ', 20, 57, 'normal', null),
  ('オオドクガ', 20, 57, 'normal', null),
  ('霧纏いトレント', 20, 58, 'timed', '朝'),
  ('胞子マイコニド', 20, 58, 'timed', '朝'),
  ('コモレビピクシー', 20, 58, 'timed', '昼'),
  ('ヨロイカブト', 20, 58, 'timed', '昼'),
  ('ナゲキバンシー', 20, 58, 'timed', '晩'),
  ('チスイオオコウモリ', 20, 58, 'timed', '晩'),
  ('キラープラント', 20, 58, 'rare', null),
  ('クイーンマンドラゴラ', 20, 58, 'rare', null),
  ('ミストトレント', 20, 58, 'rare', '朝'),
  ('サンライトピクシー', 20, 58, 'rare', '昼'),
  ('グリーフバンシー', 20, 58, 'rare', '晩'),
  ('霧魔女ミルヴァ', 20, 58, 'boss', null),
  ('シャドウウルフ', 21, 58, 'normal', null),
  ('オオドクガ', 21, 59, 'normal', null),
  ('モスゴーレム', 21, 59, 'normal', null),
  ('シメコロシカズラ', 21, 60, 'normal', null),
  ('霧纏いトレント', 21, 60, 'timed', '朝'),
  ('胞子マイコニド', 21, 60, 'timed', '朝'),
  ('コモレビピクシー', 21, 60, 'timed', '昼'),
  ('ヨロイカブト', 21, 60, 'timed', '昼'),
  ('ナゲキバンシー', 21, 60, 'timed', '晩'),
  ('チスイオオコウモリ', 21, 60, 'timed', '晩'),
  ('キラープラント', 21, 61, 'rare', null),
  ('クイーンマンドラゴラ', 21, 61, 'rare', null),
  ('ミストトレント', 21, 61, 'rare', '朝'),
  ('サンライトピクシー', 21, 61, 'rare', '昼'),
  ('グリーフバンシー', 21, 61, 'rare', '晩'),
  ('森王エルダートレント', 21, 61, 'boss', null),
  ('雪男', 22, 61, 'normal', null),
  ('氷河ドレイク', 22, 63, 'normal', null),
  ('銀嶺ウルフ', 22, 63, 'timed', '朝'),
  ('アイスエルク', 22, 63, 'timed', '朝'),
  ('樹氷精', 22, 63, 'timed', '昼'),
  ('スノーハーピー', 22, 63, 'timed', '昼'),
  ('極夜ワイト', 22, 63, 'timed', '晩'),
  ('フロストリッチ', 22, 63, 'timed', '晩'),
  ('イエティロード', 22, 64, 'rare', null),
  ('グレイシアドラゴン', 22, 64, 'rare', null),
  ('ブリザードウルフ', 22, 64, 'rare', '朝'),
  ('アイスドライアド', 22, 64, 'rare', '昼'),
  ('ワイトキング', 22, 64, 'rare', '晩'),
  ('氷牙マンモス', 22, 64, 'boss', null),
  ('雪男', 23, 64, 'normal', null),
  ('氷河ドレイク', 23, 64, 'normal', null),
  ('霜精', 23, 65, 'normal', null),
  ('アイスゴーレム', 23, 65, 'normal', null),
  ('銀嶺ウルフ', 23, 66, 'timed', '朝'),
  ('アイスエルク', 23, 66, 'timed', '朝'),
  ('樹氷精', 23, 66, 'timed', '昼'),
  ('スノーハーピー', 23, 66, 'timed', '昼'),
  ('極夜ワイト', 23, 66, 'timed', '晩'),
  ('フロストリッチ', 23, 66, 'timed', '晩'),
  ('イエティロード', 23, 66, 'rare', null),
  ('グレイシアドラゴン', 23, 66, 'rare', null),
  ('ブリザードウルフ', 23, 66, 'rare', '朝'),
  ('アイスドライアド', 23, 66, 'rare', '昼'),
  ('ワイトキング', 23, 66, 'rare', '晩'),
  ('晶獣グラキエス', 23, 66, 'boss', null),
  ('霜精', 24, 66, 'normal', null),
  ('アイスゴーレム', 24, 67, 'normal', null),
  ('ユキオオグマ', 24, 68, 'normal', null),
  ('凍骸兵', 24, 69, 'normal', null),
  ('銀嶺ウルフ', 24, 69, 'timed', '朝'),
  ('アイスエルク', 24, 69, 'timed', '朝'),
  ('樹氷精', 24, 69, 'timed', '昼'),
  ('スノーハーピー', 24, 69, 'timed', '昼'),
  ('極夜ワイト', 24, 69, 'timed', '晩'),
  ('フロストリッチ', 24, 69, 'timed', '晩'),
  ('イエティロード', 24, 70, 'rare', null),
  ('グレイシアドラゴン', 24, 70, 'rare', null),
  ('ブリザードウルフ', 24, 70, 'rare', '朝'),
  ('アイスドライアド', 24, 70, 'rare', '昼'),
  ('ワイトキング', 24, 70, 'rare', '晩'),
  ('氷霊フロストバーン', 24, 70, 'boss', null),
  ('ストームバード', 25, 70, 'normal', null),
  ('雷刃ガーゴイル', 25, 71, 'normal', null),
  ('サンダーホーク', 25, 72, 'timed', '朝'),
  ('ヒポグリフ', 25, 72, 'timed', '朝'),
  ('雷精', 25, 72, 'timed', '昼'),
  ('迅雷ドレイク', 25, 72, 'timed', '昼'),
  ('雷雲ワイバーン', 25, 72, 'timed', '晩'),
  ('ストームハーピー', 25, 72, 'timed', '晩'),
  ('ストームイーグル', 25, 72, 'rare', null),
  ('サンダーガーゴイル', 25, 72, 'rare', null),
  ('テンペストホーク', 25, 72, 'rare', '朝'),
  ('サンダーエレメンタル', 25, 72, 'rare', '昼'),
  ('ボルトワイバーン', 25, 72, 'rare', '晩'),
  ('妖獣ヌエ', 25, 72, 'boss', null),
  ('ストームバード', 26, 72, 'normal', null),
  ('雷刃ガーゴイル', 26, 72, 'normal', null),
  ('崖巨人', 26, 73, 'normal', null),
  ('スパークリザード', 26, 73, 'normal', null),
  ('サンダーホーク', 26, 74, 'timed', '朝'),
  ('ヒポグリフ', 26, 74, 'timed', '朝'),
  ('雷精', 26, 74, 'timed', '昼'),
  ('迅雷ドレイク', 26, 74, 'timed', '昼'),
  ('雷雲ワイバーン', 26, 74, 'timed', '晩'),
  ('ストームハーピー', 26, 74, 'timed', '晩'),
  ('ストームイーグル', 26, 74, 'rare', null),
  ('サンダーガーゴイル', 26, 74, 'rare', null),
  ('テンペストホーク', 26, 74, 'rare', '朝'),
  ('サンダーエレメンタル', 26, 74, 'rare', '昼'),
  ('ボルトワイバーン', 26, 74, 'rare', '晩'),
  ('雷槌ギガース', 26, 74, 'boss', null),
  ('崖巨人', 27, 74, 'normal', null),
  ('スパークリザード', 27, 75, 'normal', null),
  ('帯電ゴーレム', 27, 75, 'normal', null),
  ('雷獣', 27, 76, 'normal', null),
  ('サンダーホーク', 27, 76, 'timed', '朝'),
  ('ヒポグリフ', 27, 76, 'timed', '朝'),
  ('雷精', 27, 76, 'timed', '昼'),
  ('迅雷ドレイク', 27, 76, 'timed', '昼'),
  ('雷雲ワイバーン', 27, 76, 'timed', '晩'),
  ('ストームハーピー', 27, 76, 'timed', '晩'),
  ('ストームイーグル', 27, 77, 'rare', null),
  ('サンダーガーゴイル', 27, 77, 'rare', null),
  ('テンペストホーク', 27, 77, 'rare', '朝'),
  ('サンダーエレメンタル', 27, 77, 'rare', '昼'),
  ('ボルトワイバーン', 27, 77, 'rare', '晩'),
  ('雷帝ケラウノス', 27, 77, 'boss', null),
  ('炎精', 28, 77, 'normal', null),
  ('溶岩ゴーレム', 28, 78, 'normal', null),
  ('フレイムバット', 28, 78, 'timed', '朝'),
  ('雛フェニックス', 28, 78, 'timed', '朝'),
  ('イフリート', 28, 78, 'timed', '昼'),
  ('火吹きトカゲ', 28, 78, 'timed', '昼'),
  ('熾火デーモン', 28, 78, 'timed', '晩'),
  ('鬼火', 28, 78, 'timed', '晩'),
  ('マグマゴーレム', 28, 78, 'rare', null),
  ('ケルベロス', 28, 78, 'rare', null),
  ('ブレイズバット', 28, 78, 'rare', '朝'),
  ('イフリートロード', 28, 78, 'rare', '昼'),
  ('アークデーモン', 28, 78, 'rare', '晩'),
  ('岩甲亀ヴォルカン', 28, 78, 'boss', null),
  ('炎精', 29, 78, 'normal', null),
  ('溶岩ゴーレム', 29, 78, 'normal', null),
  ('ファイアドレイク', 29, 78, 'normal', null),
  ('マグマスライム', 29, 79, 'normal', null),
  ('フレイムバット', 29, 79, 'timed', '朝'),
  ('雛フェニックス', 29, 79, 'timed', '朝'),
  ('イフリート', 29, 79, 'timed', '昼'),
  ('火吹きトカゲ', 29, 79, 'timed', '昼'),
  ('熾火デーモン', 29, 79, 'timed', '晩'),
  ('鬼火', 29, 79, 'timed', '晩'),
  ('マグマゴーレム', 29, 79, 'rare', null),
  ('ケルベロス', 29, 79, 'rare', null),
  ('ブレイズバット', 29, 79, 'rare', '朝'),
  ('イフリートロード', 29, 79, 'rare', '昼'),
  ('アークデーモン', 29, 79, 'rare', '晩'),
  ('溶岩竜ラヴァウルム', 29, 79, 'boss', null),
  ('ファイアドレイク', 30, 79, 'normal', null),
  ('マグマスライム', 30, 79, 'normal', null),
  ('ヘルハウンド', 30, 80, 'normal', null),
  ('ファイアインプ', 30, 80, 'normal', null),
  ('フレイムバット', 30, 81, 'timed', '朝'),
  ('雛フェニックス', 30, 81, 'timed', '朝'),
  ('イフリート', 30, 81, 'timed', '昼'),
  ('火吹きトカゲ', 30, 81, 'timed', '昼'),
  ('熾火デーモン', 30, 81, 'timed', '晩'),
  ('鬼火', 30, 81, 'timed', '晩'),
  ('マグマゴーレム', 30, 81, 'rare', null),
  ('ケルベロス', 30, 81, 'rare', null),
  ('ブレイズバット', 30, 81, 'rare', '朝'),
  ('イフリートロード', 30, 81, 'rare', '昼'),
  ('アークデーモン', 30, 81, 'rare', '晩'),
  ('深紅のサラマンダー', 30, 81, 'boss', null),
  ('双頭ヌマヘビ', 31, 81, 'normal', null),
  ('ヘドロスライム', 31, 82, 'normal', null),
  ('ウィルオウィスプ', 31, 82, 'timed', '朝'),
  ('オオヒル', 31, 82, 'timed', '朝'),
  ('オオヒキガエル', 31, 82, 'timed', '昼'),
  ('カミツキガメ', 31, 82, 'timed', '昼'),
  ('ドロゾンビ', 31, 82, 'timed', '晩'),
  ('コカトリス', 31, 82, 'timed', '晩'),
  ('ヤングヒュドラ', 31, 82, 'rare', null),
  ('アシッドスライム', 31, 82, 'rare', null),
  ('グレーターウィスプ', 31, 82, 'rare', '朝'),
  ('ポイズンフロッグ', 31, 82, 'rare', '昼'),
  ('ゾンビジャイアント', 31, 82, 'rare', '晩'),
  ('沼主ガヴィアル', 31, 82, 'boss', null),
  ('双頭ヌマヘビ', 32, 82, 'normal', null),
  ('ヘドロスライム', 32, 82, 'normal', null),
  ('リザードマン', 32, 82, 'normal', null),
  ('ヌマワニ', 32, 83, 'normal', null),
  ('ウィルオウィスプ', 32, 83, 'timed', '朝'),
  ('オオヒル', 32, 83, 'timed', '朝'),
  ('オオヒキガエル', 32, 83, 'timed', '昼'),
  ('カミツキガメ', 32, 83, 'timed', '昼'),
  ('ドロゾンビ', 32, 83, 'timed', '晩'),
  ('コカトリス', 32, 83, 'timed', '晩'),
  ('ヤングヒュドラ', 32, 83, 'rare', null),
  ('アシッドスライム', 32, 83, 'rare', null),
  ('グレーターウィスプ', 32, 83, 'rare', '朝'),
  ('ポイズンフロッグ', 32, 83, 'rare', '昼'),
  ('ゾンビジャイアント', 32, 83, 'rare', '晩'),
  ('沼呪師ザルグ', 32, 83, 'boss', null),
  ('リザードマン', 33, 83, 'normal', null),
  ('ヌマワニ', 33, 83, 'normal', null),
  ('腐肉バエ', 33, 84, 'normal', null),
  ('マッドゴーレム', 33, 84, 'normal', null),
  ('ウィルオウィスプ', 33, 85, 'timed', '朝'),
  ('オオヒル', 33, 85, 'timed', '朝'),
  ('オオヒキガエル', 33, 85, 'timed', '昼'),
  ('カミツキガメ', 33, 85, 'timed', '昼'),
  ('ドロゾンビ', 33, 85, 'timed', '晩'),
  ('コカトリス', 33, 85, 'timed', '晩'),
  ('ヤングヒュドラ', 33, 85, 'rare', null),
  ('アシッドスライム', 33, 85, 'rare', null),
  ('グレーターウィスプ', 33, 85, 'rare', '朝'),
  ('ポイズンフロッグ', 33, 85, 'rare', '昼'),
  ('ゾンビジャイアント', 33, 85, 'rare', '晩'),
  ('毒龍ヴェノムヒュドラ', 33, 85, 'boss', null),
  ('グール', 34, 85, 'normal', null),
  ('鉱石ゴーレム', 34, 86, 'normal', null),
  ('クリスタルワーム', 34, 86, 'timed', '朝'),
  ('クリスタルビートル', 34, 86, 'timed', '朝'),
  ('ドワーフレイス', 34, 86, 'timed', '昼'),
  ('狂乱ドワーフ', 34, 86, 'timed', '昼'),
  ('うごめく影', 34, 86, 'timed', '晩'),
  ('奈落グモ', 34, 86, 'timed', '晩'),
  ('グールキング', 34, 86, 'rare', null),
  ('ミスリルゴーレム', 34, 86, 'rare', null),
  ('プリズムワーム', 34, 86, 'rare', '朝'),
  ('エルダードワーフ', 34, 86, 'rare', '昼'),
  ('シャドウストーカー', 34, 86, 'rare', '晩'),
  ('掘削機兵ドリラー', 34, 86, 'boss', null),
  ('グール', 35, 86, 'normal', null),
  ('鉱石ゴーレム', 35, 86, 'normal', null),
  ('闇喰いコウモリ', 35, 86, 'normal', null),
  ('カナクイネズミ', 35, 87, 'normal', null),
  ('クリスタルワーム', 35, 87, 'timed', '朝'),
  ('クリスタルビートル', 35, 87, 'timed', '朝'),
  ('ドワーフレイス', 35, 87, 'timed', '昼'),
  ('狂乱ドワーフ', 35, 87, 'timed', '昼'),
  ('うごめく影', 35, 87, 'timed', '晩'),
  ('奈落グモ', 35, 87, 'timed', '晩'),
  ('グールキング', 35, 87, 'rare', null),
  ('ミスリルゴーレム', 35, 87, 'rare', null),
  ('プリズムワーム', 35, 87, 'rare', '朝'),
  ('エルダードワーフ', 35, 87, 'rare', '昼'),
  ('シャドウストーカー', 35, 87, 'rare', '晩'),
  ('奈落蜘蛛アラクネ', 35, 87, 'boss', null),
  ('闇喰いコウモリ', 36, 87, 'normal', null),
  ('カナクイネズミ', 36, 87, 'normal', null),
  ('錆びた自動人形', 36, 88, 'normal', null),
  ('坑夫スケルトン', 36, 88, 'normal', null),
  ('クリスタルワーム', 36, 89, 'timed', '朝'),
  ('クリスタルビートル', 36, 89, 'timed', '朝'),
  ('ドワーフレイス', 36, 89, 'timed', '昼'),
  ('狂乱ドワーフ', 36, 89, 'timed', '昼'),
  ('うごめく影', 36, 89, 'timed', '晩'),
  ('奈落グモ', 36, 89, 'timed', '晩'),
  ('グールキング', 36, 89, 'rare', null),
  ('ミスリルゴーレム', 36, 89, 'rare', null),
  ('プリズムワーム', 36, 89, 'rare', '朝'),
  ('エルダードワーフ', 36, 89, 'rare', '昼'),
  ('シャドウストーカー', 36, 89, 'rare', '晩'),
  ('巌喰いガイアモール', 36, 89, 'boss', null),
  ('スカイハーピー', 37, 89, 'normal', null),
  ('シルフ', 37, 90, 'normal', null),
  ('セラフ', 37, 90, 'timed', '朝'),
  ('ケルビム', 37, 90, 'timed', '朝'),
  ('ペガサス', 37, 90, 'timed', '昼'),
  ('ユニコーン', 37, 90, 'timed', '昼'),
  ('星降りのヴァルキリー', 37, 90, 'timed', '晩'),
  ('ナイトメア', 37, 90, 'timed', '晩'),
  ('ハーピークイーン', 37, 90, 'rare', null),
  ('シルフィード', 37, 90, 'rare', null),
  ('アークセラフ', 37, 90, 'rare', '朝'),
  ('アリコーン', 37, 90, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 37, 90, 'rare', '晩'),
  ('空鯨ネブラ', 37, 90, 'boss', null),
  ('スカイハーピー', 38, 90, 'normal', null),
  ('シルフ', 38, 90, 'normal', null),
  ('天空騎士グリフィオン', 38, 90, 'normal', null),
  ('ロック鳥', 38, 91, 'normal', null),
  ('セラフ', 38, 91, 'timed', '朝'),
  ('ケルビム', 38, 91, 'timed', '朝'),
  ('ペガサス', 38, 91, 'timed', '昼'),
  ('ユニコーン', 38, 91, 'timed', '昼'),
  ('星降りのヴァルキリー', 38, 91, 'timed', '晩'),
  ('ナイトメア', 38, 91, 'timed', '晩'),
  ('ハーピークイーン', 38, 91, 'rare', null),
  ('シルフィード', 38, 91, 'rare', null),
  ('アークセラフ', 38, 91, 'rare', '朝'),
  ('アリコーン', 38, 91, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 38, 91, 'rare', '晩'),
  ('天騎士長セレスト', 38, 91, 'boss', null),
  ('天空騎士グリフィオン', 39, 91, 'normal', null),
  ('ロック鳥', 39, 91, 'normal', null),
  ('浮遊砲台', 39, 92, 'normal', null),
  ('天弓兵', 39, 92, 'normal', null),
  ('セラフ', 39, 93, 'timed', '朝'),
  ('ケルビム', 39, 93, 'timed', '朝'),
  ('ペガサス', 39, 93, 'timed', '昼'),
  ('ユニコーン', 39, 93, 'timed', '昼'),
  ('星降りのヴァルキリー', 39, 93, 'timed', '晩'),
  ('ナイトメア', 39, 93, 'timed', '晩'),
  ('ハーピークイーン', 39, 93, 'rare', null),
  ('シルフィード', 39, 93, 'rare', null),
  ('アークセラフ', 39, 93, 'rare', '朝'),
  ('アリコーン', 39, 93, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 39, 93, 'rare', '晩'),
  ('天空覇龍ウラノス', 39, 93, 'boss', null),
  ('星見像', 40, 93, 'normal', null),
  ('守護機兵', 40, 94, 'normal', null),
  ('アストラルナイト', 40, 94, 'timed', '朝'),
  ('ケンタウロス', 40, 94, 'timed', '朝'),
  ('スフィンクス', 40, 94, 'timed', '昼'),
  ('マンティコア', 40, 94, 'timed', '昼'),
  ('ルナウルフ', 40, 94, 'timed', '晩'),
  ('月蛾', 40, 94, 'timed', '晩'),
  ('スターゴーレム', 40, 94, 'rare', null),
  ('オメガガーディアン', 40, 94, 'rare', null),
  ('セレスティアルナイト', 40, 94, 'rare', '朝'),
  ('アンドロスフィンクス', 40, 94, 'rare', '昼'),
  ('月喰いハティ', 40, 94, 'rare', '晩'),
  ('古代機兵ゼクス', 40, 94, 'boss', null),
  ('星見像', 41, 94, 'normal', null),
  ('守護機兵', 41, 94, 'normal', null),
  ('クロノワーム', 41, 94, 'normal', null),
  ('グリモワール', 41, 94, 'normal', null),
  ('アストラルナイト', 41, 94, 'timed', '朝'),
  ('ケンタウロス', 41, 94, 'timed', '朝'),
  ('スフィンクス', 41, 94, 'timed', '昼'),
  ('マンティコア', 41, 94, 'timed', '昼'),
  ('ルナウルフ', 41, 94, 'timed', '晩'),
  ('月蛾', 41, 94, 'timed', '晩'),
  ('スターゴーレム', 41, 94, 'rare', null),
  ('オメガガーディアン', 41, 94, 'rare', null),
  ('セレスティアルナイト', 41, 94, 'rare', '朝'),
  ('アンドロスフィンクス', 41, 94, 'rare', '昼'),
  ('月喰いハティ', 41, 94, 'rare', '晩'),
  ('大司書ノクトゥア', 41, 94, 'boss', null),
  ('クロノワーム', 42, 94, 'normal', null),
  ('グリモワール', 42, 94, 'normal', null),
  ('魔導兵', 42, 95, 'normal', null),
  ('トキカゲロウ', 42, 95, 'normal', null),
  ('アストラルナイト', 42, 96, 'timed', '朝'),
  ('ケンタウロス', 42, 96, 'timed', '朝'),
  ('スフィンクス', 42, 96, 'timed', '昼'),
  ('マンティコア', 42, 96, 'timed', '昼'),
  ('ルナウルフ', 42, 96, 'timed', '晩'),
  ('月蛾', 42, 96, 'timed', '晩'),
  ('スターゴーレム', 42, 96, 'rare', null),
  ('オメガガーディアン', 42, 96, 'rare', null),
  ('セレスティアルナイト', 42, 96, 'rare', '朝'),
  ('アンドロスフィンクス', 42, 96, 'rare', '昼'),
  ('月喰いハティ', 42, 96, 'rare', '晩'),
  ('時星龍アイオーン', 42, 96, 'boss', null),
  ('クラーケン', 43, 96, 'normal', null),
  ('リヴァイアサン幼体', 43, 97, 'normal', null),
  ('海竜', 43, 97, 'timed', '朝'),
  ('サカマタ', 43, 97, 'timed', '朝'),
  ('巨鯨', 43, 97, 'timed', '昼'),
  ('グランマンタ', 43, 97, 'timed', '昼'),
  ('ローレライ', 43, 97, 'timed', '晩'),
  ('ダイオウグソクムシ', 43, 97, 'timed', '晩'),
  ('クラーケンキング', 43, 97, 'rare', null),
  ('アビスドラゴン', 43, 97, 'rare', null),
  ('アビスサーペント', 43, 97, 'rare', '朝'),
  ('グレートホエール', 43, 97, 'rare', '昼'),
  ('ローレライクイーン', 43, 97, 'rare', '晩'),
  ('大海月ルミナ', 43, 97, 'boss', null),
  ('クラーケン', 44, 97, 'normal', null),
  ('リヴァイアサン幼体', 44, 97, 'normal', null),
  ('シーウィッチ', 44, 97, 'normal', null),
  ('メガロドン', 44, 98, 'normal', null),
  ('海竜', 44, 98, 'timed', '朝'),
  ('サカマタ', 44, 98, 'timed', '朝'),
  ('巨鯨', 44, 98, 'timed', '昼'),
  ('グランマンタ', 44, 98, 'timed', '昼'),
  ('ローレライ', 44, 98, 'timed', '晩'),
  ('ダイオウグソクムシ', 44, 98, 'timed', '晩'),
  ('クラーケンキング', 44, 98, 'rare', null),
  ('アビスドラゴン', 44, 98, 'rare', null),
  ('アビスサーペント', 44, 98, 'rare', '朝'),
  ('グレートホエール', 44, 98, 'rare', '昼'),
  ('ローレライクイーン', 44, 98, 'rare', '晩'),
  ('深海魔女キルケ', 44, 98, 'boss', null),
  ('シーウィッチ', 45, 98, 'normal', null),
  ('メガロドン', 45, 98, 'normal', null),
  ('ダイオウイカ', 45, 99, 'normal', null),
  ('アビスマーマン', 45, 99, 'normal', null),
  ('海竜', 45, 100, 'timed', '朝'),
  ('サカマタ', 45, 100, 'timed', '朝'),
  ('巨鯨', 45, 100, 'timed', '昼'),
  ('グランマンタ', 45, 100, 'timed', '昼'),
  ('ローレライ', 45, 100, 'timed', '晩'),
  ('ダイオウグソクムシ', 45, 100, 'timed', '晩'),
  ('クラーケンキング', 45, 100, 'rare', null),
  ('アビスドラゴン', 45, 100, 'rare', null),
  ('アビスサーペント', 45, 100, 'rare', '朝'),
  ('グレートホエール', 45, 100, 'rare', '昼'),
  ('ローレライクイーン', 45, 100, 'rare', '晩'),
  ('深海覇王リヴァイアサン', 45, 100, 'boss', null);
-- @@end:enemies
-- 種を入れ直したあとなら、どの行にも場所が入っている＝「名前＋場所」の主キーを付けられる
alter table public.v2cap_enemies alter column spot set not null;
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.v2cap_enemies'::regclass and c.contype = 'p') then
    alter table public.v2cap_enemies add primary key (name, spot);
  end if;
end $$;

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
  class      text  not null default '戦士',
  jobs       jsonb not null default '{}'::jsonb,   -- {"戦士":{"lv":12,"exp":345}}
  learned    jsonb not null default '[]'::jsonb,   -- 覚えたスキル名（ずっと残る。使えるのは覚えた職業と、その上位職だけ）
  skill_sets jsonb not null default '{}'::jsonb,   -- 職業ごとの編成 {"戦士":[{"name":"体当たり","uses":3}]}
  favorites  jsonb not null default '[]'::jsonb,
  equipped   jsonb not null default '{}'::jsonb,   -- {"weapon": 12, "head": 13, ...} v2cap_inventory.id
  gold       bigint not null default 0,
  cleared_spots int[] not null default '{}',       -- ボスを倒した場所（1〜45）。開いているのは「一番先＋1」まで
  boss_rate  numeric not null default 0,           -- ボス遭遇率(%)。戦うたび+0.3、当たると0へ
  stamina    int not null default 10,
  stamina_at timestamptz not null default now(),
  last_sortie_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.v2cap_profiles alter column class set default '戦士';
-- スキルセットを職業ごとにした（2026-10-09）。前の1つだけの編成（skill_set）は §3 の終わりで移して消す
alter table public.v2cap_profiles add column if not exists skill_sets jsonb not null default '{}'::jsonb;
-- エリアの作り替え（2026-10-09）：Goldを持つ／進み具合は「ボスを倒した場所」だけで持つ
--   （前の unlocked_areas・cleared_areas は難易度帯のエリアの番号だった。キャラは下の作り直しで消える）
alter table public.v2cap_profiles add column if not exists gold bigint not null default 0;
alter table public.v2cap_profiles add column if not exists cleared_spots int[] not null default '{}';
alter table public.v2cap_profiles drop column if exists unlocked_areas;
alter table public.v2cap_profiles drop column if exists cleared_areas;
create unique index if not exists v2cap_profiles_username_lower_idx
  on public.v2cap_profiles (lower(username));
-- 参照は認証済み全員（今のⅡと同じ）。書き込みはRPC経由だけ
alter table public.v2cap_profiles enable row level security;
drop policy if exists v2cap_profiles_select on public.v2cap_profiles;
create policy v2cap_profiles_select on public.v2cap_profiles for select to authenticated using (true);
revoke all on table public.v2cap_profiles from anon;
grant select on table public.v2cap_profiles to authenticated;

-- ---- 一度だけの作り直し ----
-- ★2026-10-09 初期職の見直し（ユーザー承認）：装備の一覧が変わった（武器12種・盾なし・防具は重鎧／軽装・
--   名前は基本装備＋ランク）ので、**この版のキャラと装備を1回だけ消す**。
--   v2cap_migrations に印を付けるので、2回目以降に全文を流し直しても何も消えない。
--   今のⅡ（v2_）・旧版のテーブルには触らない。
create table if not exists public.v2cap_migrations (
  key text primary key,
  at  timestamptz not null default now()
);
alter table public.v2cap_migrations enable row level security;
revoke all on table public.v2cap_migrations from anon;
revoke all on table public.v2cap_migrations from authenticated;
do $$
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'reset_classes_20261009') then
    if to_regclass('public.v2cap_inventory') is not null then
      delete from public.v2cap_inventory;
      -- 旧版の列（今のⅡの装備の一覧 v2_equipment を指していた）
      alter table public.v2cap_inventory drop column if exists equip_id;
    end if;
    delete from public.v2cap_profiles;
    insert into public.v2cap_migrations (key) values ('reset_classes_20261009');
  end if;
end $$;
-- ★2026-10-09 エリアの作り替え（ユーザー承認「作り直す」）：場所・経験値の大きさ・アイテムLVの決め方が
--   変わったので、**この版のキャラと装備をもう1回だけ消す**（印は別）。今のⅡ・旧版には触らない
do $$
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'reset_areas_20261009') then
    if to_regclass('public.v2cap_inventory') is not null then
      delete from public.v2cap_inventory;
    end if;
    delete from public.v2cap_profiles;
    insert into public.v2cap_migrations (key) values ('reset_areas_20261009');
  end if;
end $$;

-- 所持している装備。base_id＝基本装備・rank＝F〜S・ilv＝アイテムLV（＝必要LV。拾ったエリアで決まる）
create table if not exists public.v2cap_inventory (
  id         bigserial primary key,
  player_id  uuid not null references auth.users(id) on delete cascade,
  base_id    text not null references public.v2cap_equipment(id),
  rank       text not null default 'F',
  ilv        int  not null default 1,
  created_at timestamptz not null default now()
);
-- 作り直しの前から表があった場合（上の do で空にしてある）
alter table public.v2cap_inventory add column if not exists base_id text references public.v2cap_equipment(id);
alter table public.v2cap_inventory add column if not exists rank text not null default 'F';
alter table public.v2cap_inventory alter column base_id set not null;
create index if not exists v2cap_inventory_player_idx on public.v2cap_inventory(player_id);
alter table public.v2cap_inventory enable row level security;
drop policy if exists v2cap_inventory_own on public.v2cap_inventory;
create policy v2cap_inventory_own on public.v2cap_inventory for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2cap_inventory from anon;
grant select on table public.v2cap_inventory to authenticated;

-- ============================================================
-- ===== 3. 計算（src/v2cap/lib と同じ式。片方だけ直さないこと）=====
-- ============================================================
-- 次のLVまでの必要EXP ＝ 係数 × LV³。LV100で0（level.js の needExp）
-- ⚠係数は千分率の整数で掛けてから割る＝JSと端数の丸めをそろえるため（level.js の NEED_PERMIL と同じ値）
create or replace function public.v2cap_need(p_lv int)
returns int language sql immutable set search_path = public as $$
  select case when p_lv >= 100 then 0
              else greatest(1, round(131::numeric * p_lv * p_lv * p_lv / 1000))::int end
$$;

-- 必要ClassEXP ＝ 係数 × 段階の倍率 × ClassLV²。ClassLV30で0（jobs.js の jobNeed）
-- ⚠係数は10分率の整数（jobs.js の JOB_NEED_TENTHS と同じ値）
create or replace function public.v2cap_job_need(p_stage text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select case when p_jlv >= 30 then 0
              else greatest(1, round(42::numeric * coalesce((select s.mult from public.v2cap_stages s where s.stage = p_stage), 1)
                                     * p_jlv * p_jlv / 10))::int end
$$;

-- スタミナの最大値 ＝ 10＋(LV−1)＝LVが1上がるごとに+1（level.js の staminaMaxOf・2026-10-09 ユーザー指示）
create or replace function public.v2cap_stamina_max(p_lv int)
returns int language sql immutable set search_path = public as $$
  select 10 + greatest(1, coalesce(p_lv, 1)) - 1
$$;

-- そのClassLVまでに覚えるスキルを足した learned を返す（jobs.js の skillsLearnedBy）。
-- 並び＝その職業の技の sort 順（skills.js の名簿の順）。パッシブは除く
create or replace function public.v2cap_learn(p_learned jsonb, p_cls text, p_jlv int)
returns jsonb language sql stable set search_path = public as $$
  with st as (
    select s.learn_at from public.v2cap_classes c
      join public.v2cap_stages s on s.stage = c.stage
     where c.id = p_cls
  ), ord as (
    -- ⚠row_number() は bigint。配列の添字は integer しか受けないので int にしておく
    select k.name, (row_number() over (order by k.sort))::int as i
      from public.v2cap_skills k
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

-- クラスのステのうちMPぶん（スキルセットの想定利用MPの上限に使う）。
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

-- その職業でスキルを使える職業＝[自分, 下位職, …]（v2cap_classes.lineage。jobs.js の lineageOf）。
-- 種が入っていなければ自分だけ（「その職業でだけ使える」の最低限）
create or replace function public.v2cap_lineage(p_cls text)
returns text[] language sql stable set search_path = public as $$
  select coalesce((select nullif(c.lineage, '{}') from public.v2cap_classes c where c.id = p_cls), array[p_cls])
$$;

-- 編成の想定利用MP（Σ 消費MP×回数）。skills.js の setMpCost
-- ★置けるのはその職業（と下位職）の技だけなので、消費MPは名簿の値のまま（今のⅡの「他職は2倍」は無い）
-- ⚠前は (jsonb, text) で他職を2倍にしていた。同じ名前で残ると呼び分けが曖昧になるので落とす
drop function if exists public.v2cap_set_cost(jsonb, text);
create or replace function public.v2cap_set_cost(p_set jsonb)
returns int language sql stable set search_path = public as $$
  select coalesce(sum(s.mp * greatest(1, coalesce((t.e ->> 'uses')::numeric::int, 1))), 0)::int
    from jsonb_array_elements(coalesce(p_set, '[]'::jsonb)) as t(e)
    join public.v2cap_skills s on s.name = t.e ->> 'name'
$$;

-- 編成を「その職業で使える技だけ」にし、最大MPに収まる形へ縮める（転職で戻ってきたとき・前の形からの移し替え）。
-- 使えない技（他の職業の技・覚えていない技・パッシブ・名簿に無い技）を外す →
-- 収まっていればそのまま／超えていれば回数を全部1へ／それでも超えるなら後ろの枠から外す
drop function if exists public.v2cap_fit_set(jsonb, text, int);
create or replace function public.v2cap_fit_set(p_set jsonb, p_cls text, p_learned jsonb, p_max int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_set jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name,
                    'uses', least(99, greatest(1, coalesce((t.e ->> 'uses')::numeric::int, 1)))) order by t.i), '[]'::jsonb)
    into v_set
    from jsonb_array_elements(case when jsonb_typeof(p_set) = 'array' then p_set else '[]'::jsonb end)
         with ordinality as t(e, i)
    join public.v2cap_skills s on s.name = t.e ->> 'name'
   where not s.passive
     and s.cls = any(public.v2cap_lineage(p_cls))
     and coalesce(p_learned, '[]'::jsonb) ? s.name;
  if public.v2cap_set_cost(v_set) <= p_max then return v_set; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', t.e ->> 'name', 'uses', 1) order by t.i), '[]'::jsonb)
    into v_set
    from jsonb_array_elements(v_set) with ordinality as t(e, i);
  while jsonb_array_length(v_set) > 0 and public.v2cap_set_cost(v_set) > p_max loop
    v_set := v_set - (jsonb_array_length(v_set) - 1);
  end loop;
  return v_set;
end;
$$;

-- 初めて就いた職業の編成（skills.js の defaultSetOf と同じ規則）。キャラ作成と、初めての転職で使う。
-- その職業の覚えている技を覚えた順に最大5枠・回数は1回ずつから、最大MPに収まるだけ前の枠から1回ずつ足す
-- （1枠最大5回）。1回ずつでも収まらなければ後ろの枠から外す
create or replace function public.v2cap_default_set(p_cls text, p_learned jsonb, p_max int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  c_slots    constant int := 5;
  c_uses_max constant int := 5;
  v_names text[];
  v_mp    int[];
  v_uses  int[];
  v_n     int;
  v_cost  int;
  v_grew  boolean := true;
  i       int;
begin
  select coalesce(array_agg(k.name order by k.sort), '{}'), coalesce(array_agg(k.mp order by k.sort), '{}')
    into v_names, v_mp
    from (select s.name, s.mp, s.sort from public.v2cap_skills s
           where s.cls = p_cls and not s.passive and coalesce(p_learned, '[]'::jsonb) ? s.name
           order by s.sort limit c_slots) k;
  v_n := coalesce(array_length(v_names, 1), 0);
  v_uses := array_fill(1, array[greatest(v_n, 1)]);
  v_cost := 0;
  for i in 1..v_n loop v_cost := v_cost + v_mp[i]; end loop;
  while v_n > 0 and v_cost > p_max loop
    v_cost := v_cost - v_mp[v_n];
    v_n := v_n - 1;
  end loop;
  while v_grew loop
    v_grew := false;
    for i in 1..v_n loop
      if v_uses[i] < c_uses_max and v_cost + v_mp[i] <= p_max then
        v_uses[i] := v_uses[i] + 1;
        v_cost := v_cost + v_mp[i];
        v_grew := true;
      end if;
    end loop;
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('name', v_names[g], 'uses', v_uses[g]) order by g)
                     from generate_series(1, v_n) as g), '[]'::jsonb);
end;
$$;

-- 開いている一番先の場所（1本道）＝ボスを倒した一番先の場所の次。最後の場所より先は無い。
-- sortie.js の openUntilOf と同じ。★難易度帯で開く形（v2cap_unlocked_from_cleared）は作り替えでやめた
drop function if exists public.v2cap_unlocked_from_cleared(int[], int[]);
create or replace function public.v2cap_open_until(p_cleared int[])
returns int language sql stable set search_path = public as $$
  select least(coalesce((select max(s.id) from public.v2cap_spots s), 1),
               coalesce((select max(x) from unnest(coalesce(p_cleared, '{}')) as t(x)), 0) + 1)
$$;

-- ⚠ここまでの計算は書き込みをしないが、外から叩く理由も無いので閉じておく
revoke all on function public.v2cap_need(int) from public, anon;
revoke all on function public.v2cap_job_need(text, int) from public, anon;
revoke all on function public.v2cap_stamina_max(int) from public, anon;
revoke all on function public.v2cap_learn(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.v2cap_job_bonus_mp(text, int) from public, anon, authenticated;
revoke all on function public.v2cap_lineage(text) from public, anon, authenticated;
revoke all on function public.v2cap_set_cost(jsonb) from public, anon, authenticated;
revoke all on function public.v2cap_fit_set(jsonb, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.v2cap_default_set(text, jsonb, int) from public, anon, authenticated;
revoke all on function public.v2cap_open_until(int[]) from public, anon, authenticated;

-- ---- 一度だけの移し替え：スキルセットを職業ごとに（2026-10-09 ユーザー決定）----
-- 前は編成が1つだけ（skill_set）で、他の職業の技も置けた。いまの職業の編成として skill_sets へ移し、
-- その職業で使えない技（他の職業の技）は外してから、古い列を消す。
-- ★古い列があるときだけ動く＝全文を流し直しても2回目以降は何もしない。
--   古い列の名前は、列が無いときに文として読まれないよう execute で渡す
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'v2cap_profiles' and column_name = 'skill_set') then
    execute $m$
      update public.v2cap_profiles p
         set skill_sets = jsonb_build_object(p.class, public.v2cap_fit_set(p.skill_set, p.class, p.learned,
               p.mp + public.v2cap_job_bonus_mp(p.class, coalesce((p.jobs -> p.class ->> 'lv')::int, 1))))
       where p.skill_sets = '{}'::jsonb
    $m$;
    alter table public.v2cap_profiles drop column skill_set;
  end if;
end $$;

-- ===== スタミナを数え直す（数え方は今のⅡの v2_stamina_roll と同じ。間隔は**3分に1**・最大値はLVで決まる）=====
-- ⚠SECURITY DEFINER の内部ヘルパは既定で PUBLIC 実行可＝必ず REVOKE する
-- ⚠間隔は level.js の STAMINA_RECOVER_MS と同じにすること（2026-10-09 ユーザー指示で5分→3分）
create or replace function public.v2cap_stamina_roll(p_player uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_span constant interval := interval '3 minutes';
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

-- ===== EXPを入れる（LVアップの抽選・ClassEXP・スキル習得）=====
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

  -- ClassLV（いまの職業だけ。入るのはEXPと同じ量）
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

  -- スキル（そのClassLVまでのぶんを覚える。覚えたものはずっと残る）
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
-- 名前と、最初の職業（初期職10から）。ClassLV1で覚えるスキルを1つ持って始め、その職業の編成にも入れておく
-- （回数は最大MPに収まるだけ・最大5回＝ v2cap_default_set）
create or replace function public.v2cap_create_character(p_username text, p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_username, ''));
  v_cls   text := btrim(coalesce(p_class, ''));
  v_row   public.v2cap_profiles;
  v_learn jsonb;
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
  insert into public.v2cap_profiles (id, username, class, jobs, learned)
  values (v_uid, v_name, v_cls, jsonb_build_object(v_cls, jsonb_build_object('lv', 1, 'exp', 0)), v_learn)
  returning * into v_row;
  -- 最大MP＝本体の初期MP（列の既定値）＋クラスのMP（ClassLV1では0）
  update public.v2cap_profiles
     set skill_sets = jsonb_build_object(v_cls,
           public.v2cap_default_set(v_cls, v_learn, v_row.mp + public.v2cap_job_bonus_mp(v_cls, 1)))
   where id = v_uid
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
-- 戦闘は画面で回し、ここへ「どの場所の、どの敵と戦って、勝ったか」と、落ちた装備（基本装備とランク）を送る。
-- ★EXPとGoldは**サーバーが場所の表から決める**（範囲の中の整数を均等に1つ × 役割の倍率を掛けて四捨五入。
--   朝昼晩の限定の敵1.5倍・レア3倍・ボス5倍＝ areas.js の ROLE_TENTHS・sortie.js の rollRewards と同じ）。
--   **負けても経験値はその場所の最低値**（倍率なし・Goldは入らない）。画面からは受け取らない。
-- ★アイテムLVも**その場所のエリアのアイテムLV**をサーバーが付ける。装備は「その場所で落ちるランクか」
--   「武器ならいまの職業が装備できる種類か」を見る。
-- ★場所は1本道：ボスを倒した一番先の場所の次まで開いている（v2cap_open_until）。
-- ★出撃の間隔（10秒）はサーバーでも見る。通信の揺れぶん2秒の余裕を持たせて8秒
-- ⚠勝ち負けと、出会った敵（ボス・レア・時間帯の敵か）は画面の申告のまま
--   （戦闘と敵の抽選をサーバーで回すまでは、今のⅡと同じ限界）
-- ⚠引数の名前を変えた（p_area → p_spot）ので、前の形を落としてから作る
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, boolean);
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, text, boolean);
create or replace function public.v2cap_sortie_settle(
  p_spot int, p_enemy text, p_win boolean, p_drop text default null, p_rank text default null,
  p_auto boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cd constant interval := interval '8 seconds';
  v_uid    uuid := auth.uid();
  v_row    public.v2cap_profiles;
  v_cls    public.v2cap_classes;
  v_spot   public.v2cap_spots;
  v_en     public.v2cap_enemies;
  v_eq     public.v2cap_equipment;
  v_boss   boolean;
  v_win    boolean := coalesce(p_win, false);
  v_tenths int;
  v_exp    int := 0;
  v_gold   int := 0;
  v_inv    bigint;
  v_drop   jsonb := null;
  v_cleared int[];
  v_rate   numeric;
  v_cost   int := 0;
  v_stam   int;
  v_stam_at timestamptz;
  v_res    jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから見る（同時に2回届いても、間隔の判定をすり抜けないように）
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_cls from public.v2cap_classes where id = v_row.class;
  select * into v_spot from public.v2cap_spots where id = p_spot;
  if not found then return jsonb_build_object('ok', false, 'error', 'その場所はありません'); end if;
  if p_spot > public.v2cap_open_until(v_row.cleared_spots) then
    return jsonb_build_object('ok', false, 'error', 'この場所はまだ解放されていません');
  end if;
  select * into v_en from public.v2cap_enemies where name = p_enemy and spot = p_spot;
  if not found then return jsonb_build_object('ok', false, 'error', 'その敵はこの場所にいません'); end if;
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
    -- 役割の倍率（10分率）。朝昼晩1.5倍・レア3倍・ボス5倍
    v_tenths := case v_en.role when 'timed' then 15 when 'rare' then 30 when 'boss' then 50 else 10 end;
    v_exp  := ((v_spot.exp_min  + floor(random() * (v_spot.exp_max  - v_spot.exp_min  + 1))::int) * v_tenths + 5) / 10;
    v_gold := ((v_spot.gold_min + floor(random() * (v_spot.gold_max - v_spot.gold_min + 1))::int) * v_tenths + 5) / 10;
    if p_drop is not null then
      select * into v_eq from public.v2cap_equipment e where e.id = p_drop;
      if found and v_spot.drop_ranks ? coalesce(p_rank, '')
         and (v_eq.part <> '武器' or v_eq.type = any(coalesce(v_cls.weapons, '{}'))) then
        insert into public.v2cap_inventory (player_id, base_id, rank, ilv)
        values (v_uid, v_eq.id, p_rank, v_spot.item_lv) returning id into v_inv;
        v_drop := jsonb_build_object('id', v_inv, 'base_id', v_eq.id, 'rank', p_rank, 'ilv', v_spot.item_lv);
      end if;
    end if;
  else
    -- 【確定】負けても経験値は**その場所の最低値**（朝昼晩・レア・ボスの倍率は掛けない）。Goldは入らない
    --   （2026-10-09 ユーザー指示。sortie.js の lossExpOf と同じ）
    v_exp := v_spot.exp_min;
  end if;

  v_cleared := coalesce(v_row.cleared_spots, '{}');
  if v_boss and v_win and not (v_cleared @> array[p_spot]) then
    v_cleared := array_append(v_cleared, p_spot);
  end if;
  v_rate := case when v_boss then 0 else least(100, v_row.boss_rate + 0.3) end;

  update public.v2cap_profiles
     set cleared_spots = v_cleared, boss_rate = v_rate, gold = gold + v_gold,
         stamina = greatest(0, stamina - v_cost),
         last_sortie_at = now(), updated_at = now()
   where id = v_uid
   returning stamina, stamina_at into v_stam, v_stam_at;

  v_res := public.v2cap_apply_exp(v_uid, v_exp);
  return jsonb_build_object('ok', true, 'win', v_win, 'boss', v_boss, 'role', v_en.role, 'enemy_lv', v_en.lv,
    'exp', v_exp, 'gold', v_gold, 'drop', v_drop,
    'cleared', to_jsonb(v_cleared), 'open_until', public.v2cap_open_until(v_cleared), 'boss_rate', v_rate,
    'level', v_res,
    'stamina', v_stam, 'stamina_at', v_stam_at,
    'stamina_max', public.v2cap_stamina_max(coalesce((v_res -> 'profile' ->> 'lv')::int, v_row.lv)));
end;
$$;
revoke all on function public.v2cap_sortie_settle(int, text, boolean, text, text, boolean) from public, anon;
grant execute on function public.v2cap_sortie_settle(int, text, boolean, text, text, boolean) to authenticated;

-- ============================================================
-- ===== 6. 転職（神殿）=====
-- ============================================================
-- いつでも無料。LVはそのまま、ClassLVは職業ごとに続きから。初めて就く職業はClassLV1から
-- ★新しい職業で装備できない武器は外す（なくならない）
-- ★スキルセットは**職業ごと**（2026-10-09 ユーザー決定）。いまの職業の編成はそのまま残し、
--   新しい職業の編成に切り替える。前に就いたことがあればその編成（使えない技を外し、最大MPに収まる形へ＝
--   v2cap_fit_set）、初めてなら覚えている技を入れた編成（v2cap_default_set）で始まる
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
  v_sets  jsonb;
  v_set   jsonb;
  v_max   int;
  v_equip jsonb;
  v_off   boolean := false;
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
        format('%sのClassLV%sが必要です（いま%s）', v_cls.req_cls, v_cls.req_jlv, v_have));
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

  -- スキルセット（職業ごと）。最大MP＝本体のMP＋新しい職業のクラスのMP
  v_max  := v_row.mp + public.v2cap_job_bonus_mp(v_cls.id, v_jlv);
  v_sets := case when jsonb_typeof(v_row.skill_sets) = 'object' then v_row.skill_sets else '{}'::jsonb end;
  if v_sets ? v_cls.id then
    v_set := public.v2cap_fit_set(v_sets -> v_cls.id, v_cls.id, v_new, v_max);
  else
    v_set := public.v2cap_default_set(v_cls.id, v_new, v_max);
  end if;
  v_sets := jsonb_set(v_sets, array[v_cls.id], v_set);

  -- 新しい職業で装備できない武器は外す
  v_equip := coalesce(v_row.equipped, '{}'::jsonb);
  if v_equip ? 'weapon' then
    select not (e.type = any(coalesce(v_cls.weapons, '{}'))) into v_off
      from public.v2cap_inventory i join public.v2cap_equipment e on e.id = i.base_id
     where i.id = (v_equip ->> 'weapon')::bigint and i.player_id = v_uid;
    if coalesce(v_off, true) then v_equip := v_equip - 'weapon'; end if;
  end if;

  update public.v2cap_profiles
     set class = v_cls.id, jobs = v_jobs, learned = v_new, skill_sets = v_sets, equipped = v_equip, updated_at = now()
   where id = v_uid
   returning * into v_row;
  return jsonb_build_object('ok', true, 'learned', v_added, 'unequipped', coalesce(v_off, false), 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_change_class(text) from public, anon;
grant execute on function public.v2cap_change_class(text) to authenticated;

-- ============================================================
-- ===== 7. スキル編成 =====
-- ============================================================
-- いまの職業の編成を保存する（スキルセットは職業ごと＝ skill_sets[いまの職業] だけを書き換える）。
-- 5枠・並び順＝発動順。置けるのは**いまの職業（と下位職）の技で、覚えたものだけ**（2026-10-09 ユーザー決定）。
-- 想定利用MP（Σ 消費MP×回数）が最大MP（本体＋クラスのMP）を超えたら保存させない。
-- ★確かめる順と文言は skills.js の validateSkillSet と同じ
create or replace function public.v2cap_set_skills(p_set jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_slots   constant int := 5;
  c_use_max constant int := 99;
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_set  jsonb := coalesce(p_set, '[]'::jsonb);
  v_lin  text[];
  v_sk   public.v2cap_skills;
  e      jsonb;
  v_name text;
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
  v_lin := public.v2cap_lineage(v_row.class);
  for e in select value from jsonb_array_elements(v_set) loop
    v_name := e ->> 'name';
    if v_name is null then return jsonb_build_object('ok', false, 'error', '枠にスキルが入っていません'); end if;
    select * into v_sk from public.v2cap_skills s where s.name = v_name;
    if not found then
      return jsonb_build_object('ok', false, 'error', format('%sというスキルはありません', v_name));
    end if;
    if v_sk.passive then
      return jsonb_build_object('ok', false, 'error', format('%sはパッシブなので枠に置けません', v_name));
    end if;
    -- ★その職業でだけ使える（上位職は下位職の技も使える＝ v2cap_classes.lineage）
    if not (v_sk.cls = any(v_lin)) then
      return jsonb_build_object('ok', false, 'error', format('%sは%sでは使えません（%sのスキル）', v_name, v_row.class, v_sk.cls));
    end if;
    if not (coalesce(v_row.learned, '[]'::jsonb) ? v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sはまだ覚えていません', v_name));
    end if;
    -- ⚠回数が無い（null）・小数・桁あふれも弾く（前は回数が無いと null のまま通っていた）
    if jsonb_typeof(e -> 'uses') is distinct from 'number'
       or (e ->> 'uses')::numeric <> trunc((e ->> 'uses')::numeric) then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数が不正です', v_name));
    end if;
    if (e ->> 'uses')::numeric < 1 or (e ->> 'uses')::numeric > c_use_max then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, c_use_max));
    end if;
  end loop;
  v_cost := public.v2cap_set_cost(v_set);
  v_max  := v_row.mp + public.v2cap_job_bonus_mp(v_row.class, coalesce((v_row.jobs -> v_row.class ->> 'lv')::int, 1));
  if v_cost > v_max then
    return jsonb_build_object('ok', false, 'error', format('想定利用MPが最大MPを超えています（%s / %s）', v_cost, v_max));
  end if;
  -- 保存するのは名前と回数だけ（ほかのキーは落とす）
  select coalesce(jsonb_agg(jsonb_build_object('name', t.e ->> 'name', 'uses', (t.e ->> 'uses')::numeric::int) order by t.i), '[]'::jsonb)
    into v_set
    from jsonb_array_elements(v_set) with ordinality as t(e, i);
  update public.v2cap_profiles
     set skill_sets = jsonb_set(case when jsonb_typeof(skill_sets) = 'object' then skill_sets else '{}'::jsonb end,
                                array[class], v_set),
         updated_at = now()
   where id = v_uid
   returning * into v_row;
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
   where exists (select 1 from public.v2cap_skills s where s.name = e.value);
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
-- ★枠は 武器・頭・鎧・腕・足・装飾品①・装飾品② の7つ（盾なし・武器は1本）。装飾品の部位の内部名は「アクセ」
-- ★武器は**いまの職業が装備できる種類だけ**。必要LVに足りなくても着けられる（効果が下がるだけ）
create or replace function public.v2cap_equip(p_slot text, p_inventory_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_cls  public.v2cap_classes;
  v_inv  public.v2cap_inventory;
  v_eq   public.v2cap_equipment;
  v_new  jsonb;
  v_key  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if p_slot not in ('weapon','head','body','arm','foot','acc1','acc2') then
    return jsonb_build_object('ok', false, 'error', 'そんな枠はありません');
  end if;
  select * into v_inv from public.v2cap_inventory where id = p_inventory_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  select * into v_eq from public.v2cap_equipment where id = v_inv.base_id;
  select * into v_cls from public.v2cap_classes where id = v_row.class;

  if v_eq.part = '武器' then
    if p_slot <> 'weapon' then return jsonb_build_object('ok', false, 'error', '武器は武器の枠に着けます'); end if;
    if not (v_eq.type = any(coalesce(v_cls.weapons, '{}'))) then
      return jsonb_build_object('ok', false, 'error', format('%sは%sを装備できません', v_row.class, v_eq.type));
    end if;
  elsif v_eq.part = 'アクセ' then
    if p_slot not in ('acc1','acc2') then return jsonb_build_object('ok', false, 'error', '装飾品は装飾品の枠に着けます'); end if;
  else
    if p_slot <> (case v_eq.part when '頭' then 'head' when '鎧' then 'body' when '腕' then 'arm' when '足' then 'foot' end) then
      return jsonb_build_object('ok', false, 'error', format('%sは%sの枠に着けます', v_eq.name, v_eq.part));
    end if;
  end if;

  v_new := coalesce(v_row.equipped, '{}'::jsonb);
  -- 同じ装備が別の枠に着いていたら外す
  for v_key in select key from jsonb_each_text(v_new) where value ~ '^[0-9]+$' and value::bigint = p_inventory_id loop
    v_new := v_new - v_key;
  end loop;
  v_new := jsonb_set(v_new, array[p_slot], to_jsonb(p_inventory_id));
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
-- EXPを入れる（戦闘で入ったのと同じ扱い＝ClassEXPも同じ量入る）
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
