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
--   ・**LVアップでステは上がらない**。ステータスポイント（3・5の倍数のLVは5）が入り、自分で振る（8種・振り直しなし）。
--     自動で上がるのはクラスのステ（ClassLVが1上がるごとに5点・その職業でいるあいだだけ）
--   ・場所（15エリア×①②③＝45か所）を1本道で進む。その場所のボスを倒すと次の場所が開く
--   ・1勝で入るEXPとGoldは**場所の表の値**×役割の倍率（朝昼晩1.5倍・レア3倍・ボス5倍）。
--     サーバーが決める（画面からは受け取らない）
--   ・クラスLV（表記は ClassLV）を職業ごとに持つ。上限は初期職30・一次職50（v2cap_stages.max_jlv）。入るのは今の職業。上がるとスキルを覚える
--   ・一次職は20職（2026-10-10）：系統の初期職のClassLV30で就ける・必要ClassEXPは初期職の3倍・ClassLV1ごとに6点・武器は系統の初期職と同じ
--   ・初期職は11職（2026-10-09 に剣士を足した）。職業ごとに装備できる武器が3〜4種決まっている。一次職は一旦なし
--   ・装備は**エリアごと**に、武器14種（刀・宝珠を足した）・重鎧4部位・軽装4部位・装飾品4種の26点が、レア度
--     （ノーマル・レア・エピック・レジェンダリー）ごとに1つずつ。アイテムLV＝装備の必要LV（エリア×レア度）。
--     エピックはレアとボスから・レジェンダリーはボスからだけ落ちる。武器は1本・盾なし・防具は重鎧／軽装
--   ・スキルは**その職業でだけ使える**（他職の技は置けない）。上位職は下位職のスキルをそのまま使える。
--     スキルセットは**職業ごと**に持つ（v2cap_profiles.skill_sets。転職して戻ると前の編成に戻る）
--   ・装備の強化（2026-10-10）：+10まで・+1ごとに元の強さの0.1倍ずつ足す。使うのは Gold と、その装備のエリアの「残骸」だけ。
--     残骸は装備を分解すると入る（ノーマル1・レア5・エピック10・レジェンダリー25）。失敗すると残骸とGoldは消え、強化値はそのまま。
--     「捨てる」は分解に置き換えた
--   ・鍛冶屋（2026-10-10）：強化・分解・作成をする所。作成はレア・エピック・レジェンダリーを Gold とその装備のエリアの残骸で作る
--     （残骸 30／100／300・Gold 必要LV×50／100／200・必ずできる・武器は14種どれでも）
--   ・デイリーミッション（2026-10-10・§10）：1日1組・難易度なし。受注してから数え、報酬は受注した時点のLVで決まる
--     （EXP＝必要EXP×10／5／3／1%・Gold＝LV×100）。内容はあとで決める（いまは仮の「出撃に10回勝つ」）
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
-- learn_at … スキルを覚えるClassLV（その職業の技を v2cap_skills の sort 順に当てる）／max_jlv … ClassLVの上限
-- ★初期（ClassLV30まで）と一次（2026-10-10・ClassLV50まで）
create table if not exists public.v2cap_stages (
  stage    text primary key,
  mult     int  not null,
  per_lv   int  not null,
  learn_at int[] not null,
  max_jlv  int  not null default 30
);
alter table public.v2cap_stages add column if not exists max_jlv int not null default 30;
alter table public.v2cap_stages enable row level security;
drop policy if exists v2cap_stages_read on public.v2cap_stages;
create policy v2cap_stages_read on public.v2cap_stages for select to authenticated using (true);
revoke all on table public.v2cap_stages from anon;
grant select on table public.v2cap_stages to authenticated;

-- @@seed:stages
insert into public.v2cap_stages (stage, mult, per_lv, learn_at, max_jlv) values
  ('shoki', 1, 5, '{1,5,10,15,20}'::int[], 30),
  ('ichiji', 3, 6, '{1,5,10,15,20,25,30,40}'::int[], 50)
on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at, max_jlv = excluded.max_jlv;
-- @@end:stages

-- ---- 1-2. 職業 ----
-- req_cls / req_jlv … 就くのに要る職業とClassLV（初期職は null）
-- bonus_seq … ClassLVで上がるステの並び（1点ずつ。jobs.js の bonusSeqOf と同じ）
-- weapons … 装備できる武器の種類（3〜4つ・一次職は系統の初期職と同じ）／kind … 通常攻撃が物理（phys）か魔法（mag）か
-- lineage … スキルを使える職業＝[自分, 下位職, その下位職, …]（jobs.js の lineageOf。req_cls をさかのぼったもの）
--   ★スキルは「その職業でだけ使える。上位職は下位職のスキルも使える」（2026-10-09 ユーザー決定）
-- lv_hp / lv_mp … ClassLVが1上がるたびに必ず上がるHP・MP（bonus_seq の点数とは別。jobs.js の JOB_LV_HPMP）
--   ★2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいい」
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
alter table public.v2cap_classes add column if not exists lv_hp int not null default 0;
alter table public.v2cap_classes add column if not exists lv_mp int not null default 0;
alter table public.v2cap_classes enable row level security;
drop policy if exists v2cap_classes_read on public.v2cap_classes;
create policy v2cap_classes_read on public.v2cap_classes for select to authenticated using (true);
revoke all on table public.v2cap_classes from anon;
grant select on table public.v2cap_classes to authenticated;

-- @@seed:classes
delete from public.v2cap_classes where id <> all('{戦士,槍使い,格闘家,盗賊,弓使い,銃士,剣士,魔法使い,呪術師,僧侶,薬師,狂戦士,重戦士,竜騎士,槍術士,体術師,気功師,暗殺者,忍者,狩人,狙撃手,魔銃士,砲撃士,魔導士,時魔導士,死霊術師,陰陽師,司祭,祓魔師,錬金術師,霊薬師}'::text[]);
insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq, weapons, kind, lineage, lv_hp, lv_mp) values
  ('戦士', 'shoki', 0, null, null, '{str,vit,hp,dex,agi,str,vit,mp,hp,str,vit,luk,str,hp,dex,agi,vit,str,hp,str,vit,mp,hp,str,dex,vit,agi,str,hp,vit,str,dex,agi,hp,vit,str,mp,str,vit,hp,luk,str,vit,dex,hp,agi,str,vit,str,hp,mp,vit,str,dex,agi,hp,str,vit,hp,str,vit,dex,agi,str,hp,vit,mp,str,luk,hp,vit,str,dex,agi,str,vit,hp,str,mp,vit,hp,str,dex,agi,vit,str,hp,vit,str,hp,dex,agi,str,vit,mp,hp,str,vit,luk,str,hp,dex,vit,agi,str,hp,vit,str,mp,dex,str,vit,hp,agi,str,vit,hp,str,dex,vit,agi,str,hp,mp,vit,str,hp,luk,str,vit,dex,agi,str,hp,vit,str,hp,mp,vit,str,dex,agi,hp,vit,str}'::text[], '{両手剣,斧,鈍器,刀}'::text[], 'phys', '{戦士}'::text[], 8, 1),
  ('槍使い', 'shoki', 1, null, null, '{str,dex,agi,vit,hp,str,dex,mp,str,agi,dex,vit,str,luk,dex,hp,str,agi,dex,str,vit,mp,dex,agi,str,hp,dex,str,vit,agi,str,dex,hp,str,dex,mp,agi,vit,str,dex,luk,str,agi,dex,hp,vit,str,dex,str,agi,mp,dex,str,vit,hp,dex,str,agi,vit,str,dex,hp,agi,str,dex,mp,str,vit,dex,agi,str,luk,dex,hp,str,agi,dex,vit,str,mp,dex,str,agi,hp,vit,dex,str,agi,str,dex,hp,vit,str,dex,mp,agi,str,dex,luk,str,vit,dex,hp,agi,str,dex,str,mp,agi,vit,dex,str,hp,dex,str,agi,vit,str,dex,hp,str,agi,dex,mp,vit,str,dex,agi,str,luk,dex,hp,str,vit,dex,agi,str,mp,dex,str,hp,vit,agi,dex,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{槍使い}'::text[], 6, 1),
  ('格闘家', 'shoki', 2, null, null, '{str,agi,hp,vit,dex,str,agi,mp,str,agi,hp,vit,str,agi,luk,hp,str,agi,dex,str,vit,agi,mp,hp,str,agi,str,vit,agi,hp,dex,str,agi,str,mp,vit,agi,hp,str,agi,luk,str,dex,hp,agi,vit,str,agi,str,hp,mp,agi,str,vit,dex,agi,str,hp,agi,str,vit,hp,agi,str,mp,dex,agi,str,vit,hp,agi,str,luk,str,agi,hp,vit,str,agi,dex,mp,str,agi,hp,vit,str,agi,hp,str,agi,dex,vit,str,agi,mp,hp,str,agi,luk,str,vit,agi,hp,str,dex,agi,str,mp,agi,hp,vit,str,agi,str,dex,hp,agi,vit,str,agi,str,hp,mp,agi,vit,str,dex,agi,str,hp,luk,agi,str,vit,hp,agi,str,mp,dex,agi,str,vit,hp,agi,str}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{格闘家}'::text[], 8, 1),
  ('盗賊', 'shoki', 3, null, null, '{agi,str,dex,luk,agi,hp,str,mp,agi,dex,vit,str,agi,luk,dex,agi,str,hp,agi,luk,str,dex,agi,mp,str,agi,dex,vit,luk,agi,str,hp,dex,agi,str,luk,agi,dex,str,agi,hp,mp,str,agi,dex,luk,agi,vit,str,dex,agi,str,luk,agi,hp,dex,str,agi,luk,agi,dex,str,mp,agi,vit,str,dex,agi,hp,luk,str,agi,dex,agi,str,luk,hp,agi,dex,str,mp,agi,vit,str,dex,agi,luk,agi,str,dex,hp,agi,luk,str,agi,dex,str,mp,agi,vit,luk,dex,agi,str,hp,agi,str,dex,agi,luk,str,agi,dex,hp,str,agi,luk,mp,vit,agi,dex,str,agi,luk,str,dex,agi,hp,str,agi,dex,luk,agi,str,mp,vit,agi,dex,str,hp,agi,luk,dex,str,agi}'::text[], '{短剣,片手剣,投擲,刀}'::text[], 'phys', '{盗賊}'::text[], 4, 1),
  ('弓使い', 'shoki', 4, null, null, '{agi,dex,str,hp,luk,agi,dex,str,mp,agi,dex,vit,str,agi,dex,agi,str,hp,dex,luk,agi,str,dex,agi,mp,vit,str,dex,agi,hp,luk,agi,dex,str,agi,dex,str,agi,dex,hp,str,agi,luk,dex,mp,agi,str,vit,dex,agi,str,dex,agi,hp,luk,str,dex,agi,agi,dex,str,mp,vit,agi,dex,str,hp,agi,luk,dex,str,agi,dex,agi,str,dex,hp,agi,luk,str,dex,agi,mp,vit,str,dex,agi,hp,agi,dex,str,luk,agi,dex,str,agi,dex,mp,str,agi,vit,dex,hp,agi,str,luk,dex,agi,str,dex,agi,hp,str,dex,agi,luk,mp,agi,dex,str,vit,agi,dex,str,agi,hp,dex,luk,str,agi,dex,agi,str,mp,dex,agi,vit,str,dex,agi,hp,luk,str,dex,agi}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{弓使い}'::text[], 4, 1),
  ('銃士', 'shoki', 5, null, null, '{dex,agi,str,luk,dex,hp,mp,agi,dex,str,vit,dex,agi,luk,dex,str,agi,dex,hp,str,dex,agi,mp,luk,dex,str,agi,dex,vit,hp,dex,agi,str,dex,luk,mp,agi,dex,str,dex,agi,hp,luk,dex,str,vit,agi,dex,str,dex,agi,mp,luk,dex,hp,str,agi,dex,dex,agi,str,vit,dex,luk,mp,agi,dex,str,hp,dex,agi,luk,dex,str,agi,dex,hp,str,dex,agi,mp,vit,dex,luk,str,agi,dex,dex,agi,str,hp,dex,luk,mp,agi,dex,str,dex,agi,vit,luk,dex,str,hp,agi,dex,str,dex,agi,mp,luk,dex,str,agi,dex,hp,vit,dex,agi,str,dex,luk,mp,agi,dex,str,hp,dex,agi,luk,dex,str,agi,dex,vit,str,dex,agi,mp,hp,dex,luk,str,agi,dex}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{銃士}'::text[], 4, 1),
  ('剣士', 'shoki', 6, null, null, '{str,dex,agi,vit,hp,str,dex,agi,mp,str,dex,agi,str,luk,vit,dex,str,agi,hp,str,dex,agi,mp,str,vit,dex,agi,str,hp,dex,str,agi,vit,dex,str,mp,agi,str,dex,hp,agi,str,dex,vit,luk,str,agi,dex,str,hp,agi,mp,dex,str,vit,agi,str,dex,hp,str,agi,dex,vit,str,mp,agi,dex,str,luk,agi,dex,str,vit,hp,str,dex,agi,str,mp,dex,agi,str,vit,dex,hp,agi,str,dex,str,agi,vit,str,dex,mp,agi,hp,str,dex,agi,str,luk,vit,dex,str,agi,hp,dex,str,agi,mp,str,dex,vit,agi,str,dex,hp,str,agi,dex,vit,str,mp,agi,dex,str,hp,agi,str,dex,vit,luk,str,agi,dex,str,mp,agi,dex,str,hp,vit,agi,dex,str}'::text[], '{刀,片手剣,両手剣}'::text[], 'phys', '{剣士}'::text[], 6, 1),
  ('魔法使い', 'shoki', 7, null, null, '{int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat}'::text[], '{杖,書,短剣,宝珠}'::text[], 'mag', '{魔法使い}'::text[], 6, 3),
  ('呪術師', 'shoki', 8, null, null, '{int_stat,mp,dex,luk,agi,int_stat,hp,mp,int_stat,vit,dex,luk,int_stat,mp,agi,int_stat,mp,hp,dex,int_stat,luk,mp,int_stat,agi,dex,int_stat,mp,vit,luk,int_stat,hp,mp,int_stat,dex,agi,luk,int_stat,mp,dex,int_stat,mp,hp,int_stat,agi,luk,vit,mp,int_stat,dex,int_stat,mp,luk,agi,int_stat,dex,hp,mp,int_stat,luk,mp,int_stat,dex,agi,int_stat,vit,mp,hp,int_stat,luk,dex,mp,int_stat,agi,int_stat,mp,dex,luk,int_stat,hp,mp,vit,int_stat,agi,dex,int_stat,mp,luk,int_stat,mp,hp,dex,int_stat,agi,luk,mp,int_stat,dex,vit,int_stat,mp,luk,agi,int_stat,hp,mp,int_stat,dex,luk,int_stat,mp,agi,dex,int_stat,mp,hp,int_stat,luk,vit,mp,int_stat,dex,agi,int_stat,mp,luk,int_stat,dex,hp,mp,int_stat,agi,luk,int_stat,mp,dex,vit,int_stat,mp,hp,int_stat,agi,luk,dex,mp,int_stat}'::text[], '{杖,短剣,投擲,宝珠}'::text[], 'mag', '{呪術師}'::text[], 4, 3),
  ('僧侶', 'shoki', 9, null, null, '{int_stat,vit,hp,mp,agi,int_stat,vit,hp,mp,int_stat,dex,vit,hp,int_stat,mp,luk,vit,int_stat,hp,agi,mp,int_stat,vit,hp,int_stat,mp,vit,hp,int_stat,agi,dex,vit,mp,int_stat,hp,vit,int_stat,mp,hp,int_stat,vit,agi,luk,mp,int_stat,hp,vit,int_stat,hp,mp,vit,int_stat,dex,agi,hp,int_stat,mp,vit,int_stat,hp,vit,mp,int_stat,hp,vit,agi,int_stat,mp,luk,hp,vit,int_stat,mp,dex,int_stat,vit,hp,agi,int_stat,mp,vit,hp,int_stat,mp,vit,hp,int_stat,agi,vit,int_stat,mp,hp,dex,int_stat,vit,mp,hp,int_stat,vit,luk,hp,int_stat,mp,agi,vit,int_stat,hp,mp,int_stat,vit,hp,dex,int_stat,mp,vit,agi,int_stat,hp,vit,mp,int_stat,hp,vit,int_stat,mp,agi,hp,int_stat,vit,luk,mp,int_stat,hp,vit,dex,int_stat,mp,hp,vit,int_stat,agi,mp,hp,vit,int_stat}'::text[], '{鈍器,杖,書,宝珠}'::text[], 'mag', '{僧侶}'::text[], 8, 3),
  ('薬師', 'shoki', 10, null, null, '{int_stat,dex,mp,hp,agi,int_stat,vit,dex,mp,int_stat,hp,dex,luk,int_stat,mp,agi,hp,dex,int_stat,mp,int_stat,dex,vit,hp,agi,int_stat,mp,dex,int_stat,hp,dex,mp,int_stat,agi,vit,hp,int_stat,dex,mp,int_stat,dex,luk,hp,mp,int_stat,agi,dex,int_stat,mp,hp,dex,int_stat,vit,agi,mp,int_stat,dex,hp,int_stat,dex,mp,agi,hp,int_stat,vit,dex,int_stat,mp,hp,dex,int_stat,luk,mp,agi,int_stat,dex,hp,mp,int_stat,dex,vit,int_stat,hp,agi,mp,dex,int_stat,hp,dex,int_stat,mp,agi,vit,int_stat,dex,hp,mp,int_stat,dex,luk,int_stat,mp,agi,hp,dex,int_stat,mp,vit,int_stat,dex,hp,agi,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,agi,hp,vit,dex,int_stat,mp,luk,int_stat,dex,hp,mp,agi,int_stat,dex,hp,int_stat,mp,dex,vit,int_stat,agi,hp,mp,dex,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{薬師}'::text[], 8, 3),
  ('狂戦士', 'ichiji', 11, '戦士', 30, '{str,hp,agi,vit,dex,str,hp,mp,str,agi,hp,str,vit,luk,hp,agi,str,dex,hp,str,agi,vit,str,hp,dex,str,agi,hp,mp,str,vit,hp,agi,str,dex,hp,str,agi,vit,str,hp,luk,str,dex,hp,agi,str,vit,hp,mp,str,agi,hp,str,dex,agi,vit,hp,str,str,hp,agi,dex,str,vit,hp,mp,str,agi,hp,str,luk,dex,hp,agi,str,vit,hp,str,agi,str,hp,vit,dex,str,agi,hp,mp,str,hp,vit,agi,str,dex,hp,str,agi,hp,str,vit,luk,str,hp,agi,dex,str,hp,mp,vit,str,agi,hp,str,dex,agi,hp,str,vit,str,hp,agi,dex,str,hp,vit,mp,str,agi,hp,str,luk,dex,hp,agi,str,vit,hp,str,agi,str,hp,dex,vit,str,agi,hp,mp,str,hp,agi,str,vit,dex,hp,str,agi,str,hp,luk,vit,str,hp,agi,dex,str,hp,mp,str,agi,vit,hp,str,dex,agi,hp,str,vit,str,hp,agi,dex,str,hp,mp,str,agi,vit,hp,str,luk,dex,hp,agi,str,vit,hp,str,agi,str,hp,dex,str,agi,vit,hp,str,mp,hp,agi,str,dex,vit,hp,str,agi,str,hp,luk,dex,str,hp,agi,vit,str,hp,mp,str,agi,hp,vit,str,dex,agi,hp,str,vit,str,hp,agi,dex,str,hp,mp,str,agi,hp,vit,str,luk,hp,agi,str,dex,hp,str,vit,agi,str,hp,dex,str,agi,hp,vit,str,mp,hp,agi,str,dex,hp,str,vit,agi,str,hp,luk,str,dex,hp,agi,vit,str,hp,mp,str,agi,hp,str,dex,vit,agi,hp,str}'::text[], '{両手剣,斧,鈍器,刀}'::text[], 'phys', '{狂戦士,戦士}'::text[], 10, 2),
  ('重戦士', 'ichiji', 12, '戦士', 30, '{vit,hp,str,dex,vit,agi,hp,str,vit,mp,hp,str,vit,luk,dex,vit,hp,str,agi,vit,hp,str,vit,dex,hp,str,vit,mp,hp,vit,str,agi,vit,hp,str,dex,vit,hp,str,vit,luk,agi,hp,str,vit,dex,vit,hp,str,mp,vit,hp,str,vit,dex,agi,hp,str,vit,vit,hp,str,dex,vit,hp,str,agi,vit,mp,hp,str,vit,luk,dex,vit,hp,str,vit,hp,str,agi,vit,dex,hp,str,vit,mp,hp,vit,str,agi,vit,hp,str,dex,vit,hp,str,vit,luk,hp,str,vit,dex,agi,vit,hp,str,mp,vit,hp,str,vit,dex,hp,str,vit,agi,vit,hp,str,dex,vit,hp,str,mp,vit,agi,hp,str,vit,luk,dex,vit,hp,str,vit,hp,str,vit,agi,dex,hp,str,vit,mp,hp,vit,str,vit,dex,hp,str,agi,vit,hp,str,vit,luk,hp,str,vit,dex,vit,hp,str,agi,mp,vit,hp,str,vit,dex,hp,str,vit,agi,vit,hp,str,dex,vit,hp,str,vit,mp,luk,hp,str,vit,agi,dex,vit,hp,str,vit,hp,str,vit,dex,hp,str,vit,agi,mp,vit,hp,str,vit,hp,str,dex,vit,agi,hp,str,vit,luk,hp,str,vit,dex,vit,hp,str,mp,vit,agi,hp,str,vit,dex,hp,str,vit,agi,vit,hp,str,dex,vit,hp,str,vit,mp,hp,str,vit,luk,dex,vit,hp,str,agi,vit,hp,str,vit,dex,hp,str,vit,agi,mp,vit,hp,str,vit,hp,str,dex,vit,hp,str,vit,agi,luk,hp,str,vit,dex,vit,hp,str,mp,vit,hp,str,agi,vit,dex,hp,str,vit}'::text[], '{両手剣,斧,鈍器,刀}'::text[], 'phys', '{重戦士,戦士}'::text[], 10, 2),
  ('竜騎士', 'ichiji', 13, '槍使い', 30, '{str,vit,dex,agi,hp,str,vit,mp,dex,str,agi,vit,hp,str,dex,luk,str,vit,agi,str,dex,vit,hp,str,agi,vit,dex,str,mp,hp,vit,str,agi,dex,str,vit,hp,dex,str,agi,vit,str,luk,dex,vit,agi,str,hp,mp,str,vit,dex,agi,str,vit,hp,dex,str,vit,agi,str,dex,hp,vit,str,agi,mp,dex,str,vit,hp,str,luk,vit,dex,agi,str,vit,str,dex,hp,agi,str,vit,dex,str,mp,agi,vit,hp,str,dex,vit,str,agi,hp,dex,str,vit,luk,str,agi,vit,dex,str,hp,vit,mp,str,agi,dex,vit,str,hp,dex,agi,str,vit,str,dex,vit,hp,agi,str,mp,vit,dex,str,agi,hp,str,vit,dex,luk,str,vit,agi,str,dex,hp,vit,str,agi,dex,vit,str,hp,mp,str,vit,dex,agi,str,vit,hp,dex,str,agi,vit,str,luk,dex,hp,str,vit,agi,mp,str,dex,vit,str,agi,hp,vit,dex,str,vit,str,agi,dex,hp,str,vit,mp,dex,str,agi,vit,hp,str,luk,dex,vit,str,agi,hp,str,vit,dex,agi,str,vit,dex,str,mp,hp,vit,agi,str,dex,vit,str,agi,hp,dex,str,vit,luk,str,agi,vit,dex,str,hp,mp,vit,str,dex,agi,str,vit,hp,dex,str,agi,vit,str,dex,hp,vit,str,agi,mp,dex,str,vit,hp,str,agi,vit,dex,str,luk,vit,agi,str,dex,hp,vit,str,dex,agi,str,vit,hp,mp,str,dex,vit,agi,str,hp,vit,dex,str,agi,luk,str,vit,dex,str,hp,vit,agi,str,dex,mp,vit,str,hp,agi,dex,vit,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{竜騎士,槍使い}'::text[], 8, 2),
  ('槍術士', 'ichiji', 14, '槍使い', 30, '{str,agi,dex,vit,hp,str,agi,dex,mp,str,agi,dex,vit,str,hp,agi,dex,luk,str,agi,dex,str,vit,hp,agi,str,dex,mp,agi,str,vit,dex,str,agi,hp,dex,str,agi,vit,dex,str,mp,agi,luk,hp,str,dex,agi,vit,str,dex,agi,str,hp,dex,agi,vit,str,dex,mp,agi,str,hp,dex,agi,str,vit,str,dex,agi,luk,str,hp,agi,dex,vit,str,mp,agi,dex,str,vit,agi,dex,str,hp,agi,dex,str,vit,agi,str,dex,hp,mp,agi,str,dex,vit,str,agi,dex,hp,luk,str,agi,dex,str,vit,agi,mp,dex,str,hp,agi,str,dex,vit,agi,str,dex,hp,agi,str,vit,dex,agi,str,mp,luk,dex,str,agi,hp,vit,str,dex,agi,str,dex,agi,hp,vit,str,dex,agi,mp,str,agi,dex,str,vit,hp,agi,dex,str,luk,agi,str,dex,vit,hp,agi,str,dex,mp,str,agi,dex,vit,str,agi,hp,dex,str,agi,vit,dex,str,mp,agi,hp,str,dex,agi,vit,str,dex,agi,str,luk,hp,dex,agi,str,vit,dex,str,agi,mp,hp,dex,str,agi,vit,str,dex,agi,hp,str,dex,agi,vit,str,mp,dex,agi,str,luk,hp,agi,dex,str,vit,agi,dex,str,vit,str,agi,dex,hp,mp,str,agi,dex,str,vit,agi,dex,hp,str,agi,dex,str,vit,agi,luk,str,dex,hp,mp,agi,str,dex,vit,agi,str,dex,hp,agi,str,dex,vit,str,agi,mp,dex,str,agi,hp,vit,str,dex,agi,str,luk,dex,agi,hp,str,vit,dex,agi,str,mp,dex,agi,str,hp,vit,dex,agi,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{槍術士,槍使い}'::text[], 6, 2),
  ('体術師', 'ichiji', 15, '格闘家', 30, '{agi,str,dex,hp,vit,agi,str,mp,agi,dex,str,luk,agi,hp,str,vit,agi,dex,str,agi,hp,dex,agi,str,vit,agi,str,mp,luk,agi,dex,hp,str,agi,vit,str,agi,dex,hp,agi,str,dex,agi,vit,str,mp,agi,hp,str,dex,agi,luk,str,agi,vit,dex,hp,str,agi,agi,str,dex,vit,agi,hp,str,mp,agi,dex,str,luk,agi,vit,str,agi,hp,dex,str,agi,hp,agi,dex,str,vit,agi,str,mp,luk,agi,dex,str,hp,agi,vit,str,agi,dex,hp,agi,str,dex,agi,str,vit,mp,agi,str,dex,hp,agi,luk,str,agi,vit,dex,str,agi,hp,agi,str,dex,vit,agi,str,hp,mp,agi,dex,str,luk,agi,vit,str,agi,dex,hp,str,agi,dex,agi,str,vit,hp,agi,str,mp,dex,agi,luk,str,agi,hp,vit,str,agi,dex,agi,str,hp,dex,agi,str,vit,agi,mp,str,dex,agi,luk,hp,str,agi,vit,dex,str,agi,hp,agi,str,dex,vit,agi,str,mp,agi,hp,dex,str,agi,luk,vit,str,agi,dex,hp,str,agi,dex,agi,str,vit,agi,hp,str,mp,agi,dex,luk,str,agi,vit,hp,str,agi,dex,agi,str,dex,vit,agi,str,hp,agi,mp,str,dex,agi,luk,str,hp,agi,vit,dex,str,agi,hp,agi,str,dex,vit,agi,str,mp,agi,dex,str,luk,agi,hp,str,vit,agi,dex,str,agi,hp,dex,agi,str,vit,agi,str,mp,hp,agi,dex,luk,str,agi,vit,str,agi,dex,hp,agi,str,dex,agi,vit,str,hp,agi,mp,str,dex,agi,luk,str,agi,vit,hp,dex,str,agi}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{体術師,格闘家}'::text[], 8, 2),
  ('気功師', 'ichiji', 16, '格闘家', 30, '{str,dex,vit,agi,hp,str,dex,mp,vit,str,dex,agi,hp,str,luk,dex,vit,str,agi,dex,hp,str,mp,vit,dex,str,agi,dex,hp,str,vit,dex,agi,str,mp,vit,dex,str,hp,agi,dex,str,vit,luk,hp,str,dex,agi,str,vit,dex,mp,str,hp,dex,agi,vit,str,dex,hp,str,vit,dex,agi,str,mp,dex,vit,str,hp,agi,dex,str,luk,vit,dex,str,agi,hp,dex,str,mp,vit,str,dex,agi,hp,vit,str,dex,agi,str,dex,hp,vit,mp,str,dex,agi,str,vit,dex,hp,luk,str,dex,agi,str,vit,mp,dex,hp,str,agi,vit,dex,str,hp,dex,str,vit,agi,dex,str,mp,hp,vit,str,dex,agi,luk,str,dex,vit,hp,str,dex,agi,str,mp,dex,vit,hp,str,agi,dex,str,vit,dex,agi,str,hp,vit,dex,mp,str,agi,dex,str,hp,vit,luk,dex,str,agi,vit,dex,str,hp,mp,str,dex,agi,vit,str,dex,hp,str,dex,vit,agi,str,mp,dex,hp,vit,str,agi,dex,str,luk,hp,dex,vit,str,agi,dex,str,mp,vit,hp,dex,str,agi,dex,str,vit,hp,agi,str,dex,vit,mp,str,dex,hp,agi,str,dex,vit,luk,str,dex,agi,hp,str,vit,dex,mp,str,dex,agi,vit,str,hp,dex,str,vit,agi,dex,hp,str,mp,dex,str,vit,agi,luk,dex,str,hp,vit,str,dex,agi,mp,str,dex,hp,vit,str,agi,dex,vit,str,hp,dex,agi,str,dex,vit,mp,str,hp,dex,agi,str,vit,dex,luk,str,hp,agi,dex,str,vit,mp,dex,str,hp,agi,vit,dex,str}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{気功師,格闘家}'::text[], 8, 3),
  ('暗殺者', 'ichiji', 17, '盗賊', 30, '{agi,str,luk,dex,hp,agi,str,vit,agi,luk,mp,str,dex,agi,hp,agi,str,luk,dex,agi,str,luk,agi,hp,str,dex,agi,vit,luk,agi,str,mp,agi,dex,str,hp,agi,luk,str,agi,dex,luk,str,agi,hp,vit,agi,str,dex,luk,agi,str,mp,agi,hp,dex,luk,str,agi,agi,str,luk,dex,hp,agi,str,vit,agi,luk,dex,str,agi,mp,hp,agi,str,luk,dex,agi,str,agi,luk,hp,str,agi,dex,vit,luk,agi,str,dex,agi,str,hp,luk,agi,mp,str,agi,dex,luk,str,agi,hp,agi,str,dex,luk,vit,agi,str,hp,agi,dex,luk,str,agi,mp,agi,str,luk,dex,agi,hp,str,agi,vit,luk,dex,str,agi,hp,agi,str,luk,dex,agi,mp,str,agi,luk,hp,str,agi,dex,vit,str,agi,luk,dex,agi,str,hp,luk,agi,str,mp,agi,dex,luk,str,agi,hp,agi,str,dex,luk,agi,vit,str,hp,agi,dex,luk,str,agi,mp,agi,str,luk,dex,agi,hp,str,agi,vit,luk,dex,str,agi,hp,agi,str,luk,dex,agi,str,mp,agi,luk,hp,str,agi,dex,vit,agi,str,luk,dex,agi,str,hp,luk,agi,str,agi,dex,mp,luk,str,agi,hp,agi,str,dex,luk,agi,vit,str,agi,hp,dex,luk,str,agi,mp,agi,str,luk,dex,agi,hp,str,agi,vit,luk,str,dex,agi,hp,agi,str,luk,dex,agi,str,luk,agi,hp,str,dex,agi,mp,vit,agi,str,luk,agi,dex,str,hp,agi,luk,str,agi,dex,luk,str,agi,hp,mp,agi,str,dex,luk,agi,vit,str,agi,hp,dex,luk,str,agi}'::text[], '{短剣,片手剣,投擲,刀}'::text[], 'phys', '{暗殺者,盗賊}'::text[], 6, 2),
  ('忍者', 'ichiji', 18, '盗賊', 30, '{agi,dex,str,hp,luk,agi,dex,str,agi,mp,vit,dex,agi,str,hp,luk,agi,dex,str,agi,dex,agi,hp,str,luk,dex,agi,mp,vit,agi,str,dex,agi,hp,dex,str,luk,agi,dex,agi,str,hp,agi,dex,luk,str,agi,mp,dex,vit,agi,str,dex,agi,hp,luk,str,agi,dex,agi,str,dex,hp,luk,agi,mp,dex,str,agi,vit,agi,dex,str,hp,agi,luk,dex,str,agi,dex,agi,hp,str,luk,agi,dex,mp,vit,agi,str,dex,agi,hp,luk,str,dex,agi,str,agi,dex,hp,agi,luk,dex,str,agi,mp,dex,vit,agi,str,hp,agi,dex,luk,str,agi,dex,agi,str,hp,dex,agi,luk,str,mp,agi,dex,vit,agi,dex,str,hp,agi,luk,dex,str,agi,dex,agi,hp,str,luk,agi,dex,mp,str,agi,vit,dex,agi,hp,str,luk,agi,dex,agi,str,dex,hp,agi,luk,str,dex,agi,mp,vit,dex,agi,str,hp,agi,dex,luk,str,agi,dex,agi,str,hp,luk,dex,agi,str,agi,mp,dex,vit,agi,str,dex,hp,agi,luk,str,dex,agi,agi,dex,str,hp,luk,agi,mp,dex,agi,str,vit,dex,agi,hp,str,luk,agi,dex,agi,str,dex,hp,agi,luk,str,dex,agi,mp,vit,agi,str,dex,agi,hp,luk,dex,str,agi,dex,agi,str,hp,luk,agi,dex,str,agi,mp,dex,vit,agi,str,hp,dex,agi,luk,str,agi,dex,agi,hp,str,dex,luk,agi,mp,dex,agi,str,vit,agi,dex,hp,str,luk,agi,dex,agi,str,dex,agi,hp,luk,str,agi,dex,mp,vit,agi,str,dex,agi,hp,luk,str,dex,agi}'::text[], '{短剣,片手剣,投擲,刀}'::text[], 'phys', '{忍者,盗賊}'::text[], 6, 2),
  ('狩人', 'ichiji', 19, '弓使い', 30, '{dex,agi,str,luk,hp,dex,agi,str,vit,dex,mp,agi,luk,str,dex,hp,agi,dex,str,agi,luk,dex,vit,str,agi,hp,dex,mp,agi,dex,str,luk,dex,agi,hp,str,dex,agi,luk,str,vit,dex,agi,hp,dex,str,mp,agi,luk,dex,str,agi,dex,hp,vit,agi,str,dex,luk,agi,dex,str,hp,mp,agi,dex,luk,str,dex,agi,vit,str,dex,agi,luk,hp,dex,str,agi,dex,mp,luk,agi,str,dex,hp,agi,str,dex,vit,luk,agi,dex,hp,str,agi,dex,mp,str,luk,dex,agi,hp,dex,str,agi,vit,dex,luk,agi,str,dex,hp,agi,str,dex,luk,agi,mp,dex,str,vit,agi,hp,dex,str,luk,agi,dex,str,dex,agi,hp,luk,dex,agi,str,mp,vit,dex,agi,str,hp,dex,luk,agi,str,dex,agi,luk,dex,hp,str,agi,dex,vit,mp,str,agi,dex,luk,hp,agi,dex,str,dex,agi,str,luk,vit,dex,agi,hp,str,dex,mp,agi,luk,dex,str,agi,hp,dex,str,agi,luk,dex,vit,agi,str,dex,hp,mp,agi,dex,str,luk,dex,agi,str,hp,dex,agi,luk,vit,dex,str,agi,mp,dex,hp,str,agi,luk,dex,agi,str,dex,vit,hp,agi,luk,dex,str,agi,dex,str,mp,luk,dex,agi,hp,str,dex,agi,vit,dex,str,agi,luk,hp,dex,agi,str,dex,luk,agi,mp,str,dex,hp,agi,dex,vit,str,luk,agi,dex,str,hp,agi,dex,luk,str,dex,agi,mp,vit,dex,agi,str,hp,dex,luk,agi,str,dex,agi,hp,dex,str,luk,agi,mp,dex,vit,str,agi,dex,hp,luk,str,agi,dex}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{狩人,弓使い}'::text[], 6, 2),
  ('狙撃手', 'ichiji', 20, '弓使い', 30, '{dex,luk,agi,str,dex,hp,luk,agi,dex,mp,vit,str,dex,luk,agi,dex,luk,hp,str,dex,agi,luk,dex,agi,str,dex,luk,mp,agi,dex,luk,hp,vit,dex,str,agi,luk,dex,str,dex,agi,luk,hp,dex,luk,agi,dex,str,mp,luk,dex,agi,vit,dex,luk,str,agi,dex,hp,luk,dex,agi,str,dex,luk,hp,agi,dex,luk,str,dex,agi,mp,luk,dex,vit,str,agi,dex,luk,hp,dex,agi,luk,dex,str,luk,agi,dex,hp,str,dex,luk,agi,mp,dex,vit,luk,dex,agi,str,luk,dex,hp,agi,dex,luk,str,dex,agi,luk,dex,mp,str,agi,dex,luk,hp,vit,dex,agi,luk,str,dex,agi,luk,dex,hp,str,dex,luk,agi,dex,mp,luk,str,agi,dex,vit,luk,dex,hp,agi,dex,str,luk,dex,agi,luk,str,dex,agi,hp,dex,luk,mp,vit,dex,agi,str,luk,dex,agi,luk,dex,str,hp,dex,luk,agi,dex,str,luk,agi,dex,mp,hp,luk,dex,agi,str,vit,dex,luk,agi,dex,str,luk,dex,agi,hp,dex,luk,str,agi,dex,luk,mp,dex,vit,agi,luk,dex,str,hp,dex,agi,luk,str,dex,luk,agi,dex,hp,luk,dex,agi,str,mp,dex,luk,vit,agi,dex,str,luk,dex,agi,hp,luk,dex,str,agi,dex,luk,hp,dex,agi,str,luk,dex,mp,vit,agi,dex,luk,str,dex,agi,luk,dex,hp,str,luk,dex,agi,dex,luk,agi,mp,str,dex,vit,luk,hp,dex,agi,luk,dex,str,agi,dex,luk,hp,dex,agi,str,luk,dex,agi,mp,dex,luk,str,vit,dex,agi,luk,hp,dex,str,agi,luk,dex}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{狙撃手,弓使い}'::text[], 6, 2),
  ('魔銃士', 'ichiji', 21, '銃士', 30, '{str,int_stat,dex,agi,mp,hp,str,int_stat,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,hp,agi,str,int_stat,dex,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,vit,str,int_stat,agi,hp,mp,str,int_stat,dex,agi,str,int_stat,dex,str,int_stat,mp,hp,agi,dex,str,int_stat,str,int_stat,dex,agi,mp,str,int_stat,hp,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,agi,str,int_stat,dex,hp,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,hp,agi,str,int_stat,dex,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,hp,str,int_stat,agi,vit,mp,str,int_stat,dex,agi,str,int_stat,dex,hp,str,int_stat,mp,agi,dex,str,int_stat,str,int_stat,dex,agi,mp,hp,str,int_stat,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,hp,agi,str,int_stat,dex,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,vit,str,int_stat,agi,hp,mp,str,int_stat,dex,agi,str,int_stat,dex,str,int_stat,mp,hp,agi,dex,str,int_stat,str,int_stat,dex,agi,mp,str,int_stat,hp,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,agi,str,int_stat,dex,hp,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,str,int_stat,agi,vit,mp,str,int_stat,dex,hp,agi,str,int_stat,dex,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,dex,agi,mp,str,int_stat,dex,hp,str,int_stat,agi,vit,mp,str,int_stat,dex,agi,str,int_stat,dex,hp,str,int_stat,mp,agi,dex,str,int_stat}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{魔銃士,銃士}'::text[], 6, 3),
  ('砲撃士', 'ichiji', 22, '銃士', 30, '{dex,str,vit,hp,agi,dex,str,mp,dex,vit,luk,str,dex,hp,agi,dex,str,vit,dex,str,hp,mp,dex,vit,agi,str,dex,luk,vit,dex,str,hp,dex,str,agi,vit,dex,mp,str,hp,dex,vit,str,dex,agi,luk,dex,str,hp,vit,dex,mp,str,dex,agi,vit,str,dex,hp,dex,str,vit,agi,dex,hp,str,mp,dex,vit,luk,str,dex,agi,hp,dex,str,vit,dex,str,mp,dex,vit,hp,str,agi,dex,luk,vit,dex,str,hp,dex,str,agi,vit,dex,mp,str,dex,hp,vit,str,dex,agi,dex,str,luk,vit,hp,dex,mp,str,dex,agi,vit,str,dex,hp,dex,str,vit,agi,dex,mp,str,hp,dex,vit,luk,str,dex,agi,dex,str,vit,hp,dex,str,mp,dex,vit,agi,str,hp,dex,luk,str,dex,vit,dex,hp,str,agi,vit,dex,mp,str,dex,hp,vit,str,dex,agi,dex,str,luk,vit,dex,hp,str,mp,dex,agi,vit,str,dex,hp,dex,str,vit,agi,dex,str,mp,dex,hp,vit,luk,str,dex,agi,dex,str,vit,hp,dex,str,mp,dex,vit,agi,str,dex,hp,luk,dex,str,vit,dex,str,agi,hp,vit,dex,mp,str,dex,vit,str,dex,hp,agi,dex,str,luk,vit,dex,mp,str,hp,dex,agi,vit,str,dex,hp,dex,str,vit,agi,dex,str,mp,dex,vit,luk,str,dex,hp,agi,dex,str,vit,dex,hp,str,mp,dex,vit,agi,str,dex,luk,hp,dex,str,vit,dex,str,agi,vit,dex,hp,mp,str,dex,vit,str,dex,agi,hp,dex,str,luk,vit,dex,mp,str,dex,agi,hp,vit,str,dex}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{砲撃士,銃士}'::text[], 8, 3),
  ('魔導士', 'ichiji', 23, '魔法使い', 30, '{int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,vit,mp,int_stat,agi,luk,int_stat,mp,hp,dex,int_stat,agi,mp,int_stat,vit,mp,int_stat,hp,dex,int_stat,agi,mp,int_stat,mp,agi,int_stat,hp,dex,int_stat,mp,vit,int_stat,mp,agi,int_stat,luk,hp,mp,int_stat,dex,agi,int_stat,mp,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,vit,mp,int_stat,agi,luk,int_stat,mp,hp,dex,int_stat,agi,mp,int_stat,mp,int_stat,hp,dex,agi,int_stat,mp,vit,int_stat,mp,int_stat,agi,hp,dex,int_stat,mp,int_stat,mp,agi,vit,int_stat,luk,mp,hp,int_stat,dex,int_stat,mp,agi,int_stat,mp,hp,dex,int_stat,agi,mp,int_stat,vit,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,luk,mp,int_stat,agi,vit,int_stat,mp,hp,dex,int_stat,agi,mp,int_stat,mp,int_stat,hp,dex,agi,int_stat,mp,int_stat,vit,mp,int_stat,agi,hp,dex,int_stat,mp,int_stat,mp,agi,luk,int_stat,hp,mp,int_stat,dex,vit,int_stat,mp,agi,int_stat,mp,hp,int_stat,dex,agi,mp,int_stat,vit,int_stat,mp,agi,int_stat,hp,dex,mp,int_stat,luk,mp,int_stat,agi,int_stat,hp,mp,dex,int_stat,vit,mp,agi,int_stat,mp,int_stat,hp,dex,agi,int_stat,mp,int_stat,vit,mp,int_stat,agi,hp,dex,int_stat,mp,int_stat,mp,agi,int_stat,luk,hp,mp,int_stat,dex,agi,int_stat,mp,vit,int_stat,mp,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,vit,int_stat,hp,dex,mp,int_stat,mp,int_stat,agi,luk,int_stat,mp,hp,dex,int_stat,agi,mp,int_stat,vit,mp,int_stat,hp,dex,int_stat,agi,mp,int_stat,mp,agi,int_stat,hp,dex,int_stat,mp,vit,int_stat,mp,agi,int_stat,luk,hp,mp,int_stat,dex,agi,int_stat,mp,vit,int_stat,mp,hp,int_stat,dex,agi,mp,int_stat}'::text[], '{杖,書,短剣,宝珠}'::text[], 'mag', '{魔導士,魔法使い}'::text[], 6, 4),
  ('時魔導士', 'ichiji', 24, '魔法使い', 30, '{int_stat,agi,mp,hp,int_stat,agi,dex,vit,int_stat,mp,agi,int_stat,luk,agi,mp,hp,int_stat,agi,dex,int_stat,mp,agi,int_stat,vit,hp,agi,int_stat,mp,dex,int_stat,agi,mp,int_stat,agi,hp,int_stat,agi,mp,vit,int_stat,dex,agi,luk,int_stat,mp,agi,hp,int_stat,agi,mp,int_stat,dex,agi,int_stat,hp,vit,mp,agi,int_stat,int_stat,agi,mp,hp,int_stat,agi,dex,mp,int_stat,agi,vit,int_stat,luk,agi,mp,int_stat,hp,agi,dex,int_stat,mp,agi,int_stat,hp,agi,int_stat,mp,vit,dex,int_stat,agi,mp,int_stat,agi,hp,int_stat,agi,mp,dex,int_stat,agi,vit,int_stat,mp,hp,agi,int_stat,luk,agi,mp,int_stat,dex,agi,int_stat,hp,mp,agi,int_stat,vit,int_stat,agi,mp,hp,int_stat,agi,dex,mp,int_stat,agi,luk,int_stat,vit,agi,mp,int_stat,hp,agi,dex,int_stat,mp,agi,int_stat,hp,agi,int_stat,mp,vit,dex,int_stat,agi,mp,int_stat,agi,hp,int_stat,agi,mp,int_stat,dex,agi,luk,int_stat,mp,hp,agi,int_stat,vit,agi,mp,int_stat,dex,agi,int_stat,hp,mp,agi,int_stat,vit,int_stat,agi,mp,hp,int_stat,agi,dex,int_stat,mp,agi,luk,int_stat,agi,hp,mp,int_stat,vit,agi,dex,int_stat,mp,agi,int_stat,hp,agi,int_stat,mp,dex,int_stat,agi,vit,mp,int_stat,agi,hp,int_stat,agi,mp,int_stat,dex,agi,luk,int_stat,mp,hp,agi,int_stat,vit,agi,int_stat,mp,dex,agi,int_stat,hp,mp,agi,int_stat,vit,int_stat,agi,mp,hp,int_stat,agi,dex,int_stat,mp,agi,int_stat,luk,agi,mp,hp,int_stat,agi,dex,int_stat,vit,mp,agi,int_stat,hp,agi,int_stat,mp,dex,int_stat,agi,mp,int_stat,agi,hp,vit,int_stat,agi,mp,int_stat,dex,agi,luk,int_stat,mp,agi,hp,int_stat,agi,mp,int_stat,vit,dex,agi,int_stat,hp,mp,agi,int_stat}'::text[], '{杖,書,短剣,宝珠}'::text[], 'mag', '{時魔導士,魔法使い}'::text[], 6, 4),
  ('死霊術師', 'ichiji', 25, '呪術師', 30, '{int_stat,mp,hp,vit,int_stat,dex,mp,agi,int_stat,luk,hp,mp,int_stat,vit,int_stat,mp,dex,hp,int_stat,vit,mp,int_stat,agi,mp,int_stat,hp,vit,luk,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,mp,int_stat,hp,vit,dex,int_stat,mp,int_stat,luk,hp,mp,int_stat,vit,agi,int_stat,mp,dex,hp,int_stat,vit,mp,int_stat,agi,mp,int_stat,hp,vit,dex,int_stat,mp,luk,int_stat,hp,mp,vit,int_stat,mp,int_stat,dex,agi,hp,vit,int_stat,mp,int_stat,mp,hp,vit,int_stat,luk,dex,mp,int_stat,agi,int_stat,hp,vit,mp,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,agi,int_stat,mp,hp,vit,int_stat,luk,mp,dex,int_stat,hp,vit,int_stat,mp,agi,int_stat,mp,hp,vit,int_stat,dex,mp,int_stat,luk,hp,int_stat,mp,vit,int_stat,agi,mp,dex,int_stat,hp,vit,mp,int_stat,int_stat,mp,hp,vit,int_stat,luk,mp,dex,agi,int_stat,hp,vit,mp,int_stat,int_stat,mp,hp,vit,int_stat,dex,mp,agi,int_stat,luk,mp,int_stat,hp,vit,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,mp,int_stat,hp,vit,dex,int_stat,mp,luk,int_stat,hp,vit,mp,int_stat,agi,int_stat,mp,dex,hp,int_stat,vit,mp,int_stat,agi,mp,hp,int_stat,vit,luk,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,mp,agi,int_stat,hp,vit,dex,int_stat,mp,int_stat,luk,mp,hp,vit,int_stat,mp,int_stat,dex,agi,hp,int_stat,vit,mp,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,luk,agi,int_stat,mp,hp,vit,int_stat,mp,dex,int_stat,hp,vit,int_stat,mp,agi,int_stat,mp,hp,vit,int_stat,luk,mp,dex,int_stat,hp,vit,int_stat,mp,agi,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,luk,int_stat,mp,hp,vit,int_stat,agi,mp,dex,int_stat,hp,vit,mp,int_stat}'::text[], '{杖,短剣,投擲,宝珠}'::text[], 'mag', '{死霊術師,呪術師}'::text[], 8, 4),
  ('陰陽師', 'ichiji', 26, '呪術師', 30, '{int_stat,mp,dex,agi,hp,int_stat,mp,vit,int_stat,dex,luk,mp,int_stat,agi,dex,hp,int_stat,mp,int_stat,dex,agi,mp,int_stat,hp,vit,int_stat,mp,dex,luk,int_stat,agi,mp,dex,int_stat,hp,mp,int_stat,agi,dex,int_stat,mp,vit,int_stat,hp,dex,mp,agi,int_stat,luk,mp,int_stat,dex,hp,int_stat,mp,agi,dex,int_stat,mp,vit,int_stat,dex,agi,hp,int_stat,mp,luk,int_stat,dex,mp,int_stat,agi,hp,mp,dex,int_stat,vit,int_stat,mp,dex,agi,int_stat,mp,hp,int_stat,dex,luk,mp,int_stat,agi,dex,int_stat,mp,hp,vit,int_stat,agi,mp,dex,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,luk,dex,int_stat,vit,mp,int_stat,hp,agi,dex,int_stat,mp,int_stat,dex,mp,agi,int_stat,hp,luk,mp,int_stat,dex,vit,int_stat,mp,agi,dex,int_stat,hp,mp,int_stat,dex,agi,mp,int_stat,hp,int_stat,dex,mp,luk,agi,int_stat,vit,mp,dex,int_stat,hp,int_stat,mp,agi,dex,int_stat,mp,hp,int_stat,dex,vit,mp,int_stat,agi,luk,dex,int_stat,mp,hp,int_stat,agi,mp,dex,int_stat,mp,int_stat,dex,agi,hp,int_stat,mp,vit,int_stat,dex,luk,mp,int_stat,agi,hp,dex,int_stat,mp,int_stat,mp,dex,agi,int_stat,vit,hp,mp,int_stat,dex,luk,int_stat,mp,agi,dex,int_stat,hp,mp,int_stat,agi,dex,mp,int_stat,vit,hp,int_stat,mp,dex,agi,int_stat,luk,mp,int_stat,dex,hp,mp,int_stat,agi,dex,int_stat,vit,mp,int_stat,dex,agi,mp,int_stat,hp,luk,int_stat,mp,dex,int_stat,agi,mp,dex,hp,int_stat,vit,mp,int_stat,dex,agi,int_stat,mp,hp,int_stat,dex,mp,luk,int_stat,agi,vit,dex,int_stat,mp,hp,int_stat,mp,agi,dex,int_stat,mp,int_stat,hp,dex,agi,int_stat,mp,luk,vit,int_stat,dex,mp,int_stat,hp,agi,dex,mp,int_stat}'::text[], '{杖,短剣,投擲,宝珠}'::text[], 'mag', '{陰陽師,呪術師}'::text[], 6, 4),
  ('司祭', 'ichiji', 27, '僧侶', 30, '{int_stat,hp,vit,mp,agi,int_stat,hp,vit,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,luk,hp,vit,int_stat,agi,hp,mp,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,vit,agi,hp,mp,int_stat,vit,hp,int_stat,mp,vit,dex,hp,int_stat,luk,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat,int_stat,hp,vit,mp,agi,int_stat,hp,vit,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,hp,vit,luk,int_stat,agi,hp,mp,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,vit,agi,hp,mp,int_stat,vit,hp,int_stat,mp,vit,hp,dex,int_stat,vit,hp,int_stat,mp,agi,vit,hp,int_stat,luk,mp,vit,hp,int_stat,int_stat,hp,vit,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,hp,vit,int_stat,agi,mp,hp,vit,int_stat,hp,luk,mp,int_stat,vit,hp,int_stat,vit,hp,mp,agi,int_stat,vit,hp,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat,luk,int_stat,hp,vit,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,int_stat,dex,hp,vit,mp,int_stat,hp,vit,int_stat,agi,hp,mp,vit,int_stat,hp,mp,int_stat,vit,hp,luk,int_stat,vit,hp,mp,int_stat,agi,vit,hp,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat,luk,int_stat,hp,vit,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,int_stat,hp,dex,vit,mp,int_stat,hp,vit,int_stat,agi,hp,mp,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,vit,agi,hp,mp,int_stat,vit,hp,luk,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat}'::text[], '{鈍器,杖,書,宝珠}'::text[], 'mag', '{司祭,僧侶}'::text[], 10, 4),
  ('祓魔師', 'ichiji', 28, '僧侶', 30, '{int_stat,mp,agi,vit,hp,int_stat,mp,dex,int_stat,agi,vit,mp,int_stat,hp,luk,int_stat,agi,mp,vit,int_stat,hp,mp,int_stat,agi,dex,vit,int_stat,mp,hp,int_stat,agi,mp,int_stat,vit,mp,agi,int_stat,hp,luk,int_stat,mp,vit,agi,int_stat,dex,mp,hp,int_stat,vit,agi,mp,int_stat,int_stat,hp,mp,vit,agi,int_stat,mp,dex,int_stat,agi,vit,hp,int_stat,mp,int_stat,agi,mp,vit,int_stat,hp,luk,mp,int_stat,agi,vit,int_stat,mp,dex,hp,int_stat,agi,mp,int_stat,vit,hp,mp,int_stat,agi,vit,int_stat,mp,dex,agi,int_stat,hp,mp,int_stat,vit,agi,mp,int_stat,luk,hp,int_stat,mp,vit,agi,int_stat,dex,mp,int_stat,hp,vit,agi,int_stat,mp,int_stat,agi,mp,vit,hp,int_stat,mp,int_stat,agi,vit,dex,int_stat,mp,hp,luk,int_stat,agi,mp,vit,int_stat,hp,mp,int_stat,agi,vit,int_stat,mp,dex,hp,int_stat,agi,mp,int_stat,vit,agi,int_stat,mp,hp,int_stat,vit,mp,agi,int_stat,luk,dex,mp,int_stat,hp,vit,agi,int_stat,mp,int_stat,hp,vit,mp,agi,int_stat,mp,int_stat,agi,vit,hp,int_stat,mp,dex,int_stat,agi,vit,mp,int_stat,hp,luk,int_stat,mp,agi,vit,int_stat,mp,hp,int_stat,agi,dex,mp,int_stat,vit,hp,int_stat,agi,mp,vit,int_stat,mp,agi,int_stat,hp,dex,mp,int_stat,vit,agi,int_stat,mp,luk,hp,int_stat,vit,mp,agi,int_stat,mp,int_stat,hp,vit,agi,int_stat,dex,mp,int_stat,agi,vit,mp,hp,int_stat,luk,int_stat,mp,agi,vit,int_stat,hp,mp,int_stat,dex,agi,mp,int_stat,vit,hp,int_stat,agi,mp,vit,int_stat,mp,hp,int_stat,agi,dex,mp,int_stat,vit,agi,int_stat,mp,hp,int_stat,vit,luk,mp,agi,int_stat,hp,int_stat,mp,vit,agi,int_stat,dex,mp,int_stat,hp,vit,agi,mp,int_stat}'::text[], '{鈍器,杖,書,宝珠}'::text[], 'mag', '{祓魔師,僧侶}'::text[], 8, 4),
  ('錬金術師', 'ichiji', 29, '薬師', 30, '{int_stat,dex,mp,hp,agi,int_stat,dex,vit,int_stat,mp,dex,int_stat,hp,luk,mp,agi,int_stat,dex,int_stat,dex,mp,hp,int_stat,vit,agi,dex,int_stat,mp,dex,int_stat,hp,mp,int_stat,dex,agi,vit,int_stat,mp,dex,hp,int_stat,luk,dex,int_stat,mp,agi,int_stat,dex,hp,mp,int_stat,vit,dex,int_stat,agi,mp,dex,int_stat,hp,int_stat,dex,mp,agi,int_stat,hp,dex,vit,int_stat,mp,dex,int_stat,luk,agi,mp,int_stat,dex,hp,int_stat,dex,mp,vit,int_stat,hp,dex,agi,int_stat,mp,dex,int_stat,hp,mp,int_stat,dex,agi,int_stat,vit,mp,dex,int_stat,hp,luk,dex,int_stat,mp,agi,int_stat,dex,hp,mp,int_stat,vit,dex,int_stat,agi,mp,dex,int_stat,hp,int_stat,dex,mp,agi,int_stat,vit,dex,hp,int_stat,mp,dex,int_stat,luk,agi,mp,int_stat,dex,hp,int_stat,dex,mp,vit,int_stat,agi,dex,hp,int_stat,mp,dex,int_stat,mp,int_stat,hp,dex,agi,int_stat,vit,mp,dex,int_stat,luk,hp,dex,int_stat,mp,agi,int_stat,dex,mp,int_stat,hp,dex,vit,int_stat,agi,mp,dex,int_stat,hp,int_stat,dex,mp,agi,int_stat,dex,vit,int_stat,mp,hp,dex,int_stat,luk,agi,mp,int_stat,dex,hp,int_stat,dex,mp,vit,int_stat,agi,dex,int_stat,mp,hp,int_stat,dex,mp,int_stat,dex,agi,hp,int_stat,vit,mp,dex,int_stat,luk,dex,int_stat,mp,hp,agi,int_stat,dex,mp,int_stat,vit,dex,hp,int_stat,agi,mp,dex,int_stat,hp,int_stat,dex,mp,agi,int_stat,dex,vit,int_stat,mp,hp,dex,int_stat,luk,mp,agi,int_stat,dex,int_stat,hp,dex,mp,int_stat,vit,agi,dex,int_stat,mp,hp,int_stat,dex,mp,int_stat,dex,agi,vit,int_stat,hp,mp,dex,int_stat,luk,dex,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,vit,dex,int_stat,agi,hp,mp,dex,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{錬金術師,薬師}'::text[], 8, 4),
  ('霊薬師', 'ichiji', 30, '薬師', 30, '{int_stat,mp,vit,hp,dex,int_stat,agi,mp,vit,int_stat,hp,mp,int_stat,luk,vit,hp,int_stat,mp,dex,agi,int_stat,vit,mp,hp,int_stat,mp,vit,int_stat,dex,hp,mp,int_stat,vit,agi,int_stat,mp,hp,vit,int_stat,mp,dex,hp,int_stat,luk,vit,mp,int_stat,agi,hp,int_stat,mp,vit,dex,int_stat,mp,hp,vit,int_stat,mp,agi,int_stat,vit,hp,mp,int_stat,dex,vit,int_stat,hp,mp,luk,int_stat,agi,mp,vit,int_stat,hp,dex,mp,int_stat,vit,hp,int_stat,mp,vit,agi,int_stat,mp,hp,dex,int_stat,vit,mp,int_stat,hp,vit,mp,int_stat,dex,agi,int_stat,hp,mp,vit,int_stat,luk,mp,hp,int_stat,vit,dex,mp,int_stat,agi,hp,vit,int_stat,mp,int_stat,vit,hp,mp,int_stat,dex,mp,agi,vit,int_stat,hp,luk,int_stat,mp,vit,hp,int_stat,mp,dex,int_stat,vit,mp,hp,int_stat,agi,vit,mp,int_stat,hp,dex,int_stat,mp,vit,agi,int_stat,hp,mp,vit,int_stat,dex,mp,int_stat,hp,vit,luk,int_stat,mp,agi,hp,int_stat,vit,mp,dex,int_stat,mp,hp,vit,int_stat,mp,int_stat,vit,hp,agi,int_stat,mp,dex,vit,int_stat,hp,mp,int_stat,luk,vit,mp,hp,int_stat,agi,dex,int_stat,mp,vit,hp,int_stat,mp,vit,int_stat,dex,hp,mp,int_stat,agi,vit,mp,int_stat,hp,vit,int_stat,mp,dex,luk,int_stat,hp,mp,vit,agi,int_stat,mp,hp,int_stat,vit,dex,int_stat,mp,hp,vit,int_stat,agi,mp,int_stat,vit,hp,mp,int_stat,dex,vit,mp,int_stat,hp,agi,int_stat,mp,vit,luk,hp,int_stat,dex,mp,int_stat,vit,hp,mp,int_stat,agi,vit,int_stat,mp,hp,dex,int_stat,vit,mp,int_stat,hp,mp,agi,vit,int_stat,dex,luk,int_stat,mp,hp,vit,int_stat,mp,hp,int_stat,vit,mp,agi,int_stat,dex,hp,vit,mp,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{霊薬師,薬師}'::text[], 10, 4)
on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,
  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq,
  weapons = excluded.weapons, kind = excluded.kind, lineage = excluded.lineage,
  lv_hp = excluded.lv_hp, lv_mp = excluded.lv_mp;
delete from public.v2cap_stages s where s.stage <> all('{shoki,ichiji}'::text[])
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
  ('袈裟斬り', '剣士', 4, 1, false),
  ('燕返し', '剣士', 8, 2, false),
  ('兜割り', '剣士', 9, 3, false),
  ('一閃', '剣士', 11, 4, false),
  ('剣の構え', '剣士', 8, 5, false),
  ('呪弾', '呪術師', 5, 1, false),
  ('呪縛', '呪術師', 9, 2, false),
  ('毒の呪い', '呪術師', 10, 3, false),
  ('災いの呪い', '呪術師', 13, 4, false),
  ('衰弱の呪詛', '呪術師', 9, 5, false),
  ('薬瓶投げ', '薬師', 5, 1, false),
  ('傷薬', '薬師', 12, 2, false),
  ('毒薬', '薬師', 10, 3, false),
  ('強壮剤', '薬師', 9, 4, false),
  ('気付け薬', '薬師', 8, 5, false),
  ('バーサク', '狂戦士', 0, 1, true),
  ('マッドラッシュ', '狂戦士', 6, 2, false),
  ('血風斬', '狂戦士', 12, 3, false),
  ('狂乱の咆哮', '狂戦士', 10, 4, false),
  ('ブラッドスプラッシュ', '狂戦士', 11, 5, false),
  ('狂撃', '狂戦士', 14, 6, false),
  ('ブラッディロア', '狂戦士', 14, 7, false),
  ('血の誓い', '狂戦士', 10, 8, false),
  ('フルブレイカー', '狂戦士', 22, 9, false),
  ('不動', '重戦士', 0, 1, true),
  ('重撃', '重戦士', 6, 2, false),
  ('鉄壁', '重戦士', 10, 3, false),
  ('受け止め', '重戦士', 8, 4, false),
  ('グランドスラム', '重戦士', 13, 5, false),
  ('報復の一撃', '重戦士', 12, 6, false),
  ('忍耐', '重戦士', 14, 7, false),
  ('地鳴らし', '重戦士', 14, 8, false),
  ('城塞崩し', '重戦士', 22, 9, false),
  ('竜の血', '竜騎士', 0, 1, true),
  ('ドラゴンスラスト', '竜騎士', 7, 2, false),
  ('ジャンプ', '竜騎士', 14, 3, false),
  ('ドラゴンファング', '竜騎士', 12, 4, false),
  ('スカイスピア', '竜騎士', 11, 5, false),
  ('ドラゴンロア', '竜騎士', 12, 6, false),
  ('竜鱗', '竜騎士', 10, 7, false),
  ('ハイジャンプ', '竜騎士', 18, 8, false),
  ('天墜竜閃', '竜騎士', 24, 9, false),
  ('槍の型', '槍術士', 0, 1, true),
  ('連突き', '槍術士', 6, 2, false),
  ('薙ぎ崩し', '槍術士', 9, 3, false),
  ('スパイラルスラスト', '槍術士', 12, 4, false),
  ('足払い', '槍術士', 9, 5, false),
  ('流星突き', '槍術士', 15, 6, false),
  ('間合い取り', '槍術士', 10, 7, false),
  ('槍崩し', '槍術士', 12, 8, false),
  ('千本突き', '槍術士', 22, 9, false),
  ('心眼', '体術師', 0, 1, true),
  ('半月蹴り', '体術師', 6, 2, false),
  ('受け流し', '体術師', 8, 3, false),
  ('五連殺', '体術師', 14, 4, false),
  ('旋風脚', '体術師', 13, 5, false),
  ('巴投げ', '体術師', 12, 6, false),
  ('流水の構え', '体術師', 12, 7, false),
  ('破衝掌', '体術師', 14, 8, false),
  ('飛天三角蹴り', '体術師', 22, 9, false),
  ('丹田', '気功師', 0, 1, true),
  ('気弾', '気功師', 6, 2, false),
  ('練気', '気功師', 8, 3, false),
  ('掌底波', '気功師', 11, 4, false),
  ('浸透勁', '気功師', 12, 5, false),
  ('内功', '気功師', 10, 6, false),
  ('気の鎧', '気功師', 10, 7, false),
  ('闘気', '気功師', 12, 8, false),
  ('天衝', '気功師', 20, 9, false),
  ('血の匂い', '暗殺者', 0, 1, true),
  ('刻み斬り', '暗殺者', 6, 2, false),
  ('鬼影閃', '暗殺者', 12, 3, false),
  ('ヴァイパーストライク', '暗殺者', 11, 4, false),
  ('隠形', '暗殺者', 10, 5, false),
  ('裂傷', '暗殺者', 10, 6, false),
  ('影討ち', '暗殺者', 14, 7, false),
  ('首狩り', '暗殺者', 16, 8, false),
  ('急所突き', '暗殺者', 20, 9, false),
  ('影の連携', '忍者', 0, 1, true),
  ('手裏剣', '忍者', 6, 2, false),
  ('分身の術', '忍者', 12, 3, false),
  ('雷遁', '忍者', 12, 4, false),
  ('火遁', '忍者', 12, 5, false),
  ('影斬り', '忍者', 12, 6, false),
  ('毒霧の術', '忍者', 10, 7, false),
  ('変わり身', '忍者', 14, 8, false),
  ('千本手裏剣', '忍者', 20, 9, false),
  ('獲物の弱り目', '狩人', 0, 1, true),
  ('毒矢', '狩人', 7, 2, false),
  ('くくり罠', '狩人', 10, 3, false),
  ('ハンターズマーク', '狩人', 8, 4, false),
  ('裂き矢', '狩人', 10, 5, false),
  ('目くらまし', '狩人', 10, 6, false),
  ('三連射', '狩人', 14, 7, false),
  ('狩猟の構え', '狩人', 10, 8, false),
  ('仕留めの一矢', '狩人', 20, 9, false),
  ('狙撃手の勘', '狙撃手', 0, 1, true),
  ('急所射ち', '狙撃手', 7, 2, false),
  ('照準', '狙撃手', 8, 3, false),
  ('ラピッドショット', '狙撃手', 10, 4, false),
  ('貫き矢', '狙撃手', 12, 5, false),
  ('息を止める', '狙撃手', 10, 6, false),
  ('強弓', '狙撃手', 16, 7, false),
  ('弱点看破', '狙撃手', 12, 8, false),
  ('絶影狙撃', '狙撃手', 22, 9, false),
  ('魔力循環', '魔銃士', 0, 1, true),
  ('マナショット', '魔銃士', 6, 2, false),
  ('焼夷弾', '魔銃士', 11, 3, false),
  ('雷撃弾', '魔銃士', 11, 4, false),
  ('氷結弾', '魔銃士', 11, 5, false),
  ('ブレイクショット', '魔銃士', 13, 6, false),
  ('魔力装填', '魔銃士', 12, 7, false),
  ('連装魔撃', '魔銃士', 16, 8, false),
  ('アルカナバレット', '魔銃士', 22, 9, false),
  ('砲台の構え', '砲撃士', 0, 1, true),
  ('散弾', '砲撃士', 6, 2, false),
  ('装填', '砲撃士', 6, 3, false),
  ('キャノン', '砲撃士', 14, 4, false),
  ('スモークシェル', '砲撃士', 10, 5, false),
  ('速射', '砲撃士', 10, 6, false),
  ('グレネード', '砲撃士', 12, 7, false),
  ('弾薬補給', '砲撃士', 10, 8, false),
  ('フルバースト', '砲撃士', 24, 9, false),
  ('元素共鳴', '魔導士', 0, 1, true),
  ('ファイアボール', '魔導士', 7, 2, false),
  ('詠唱', '魔導士', 6, 3, false),
  ('フロストノヴァ', '魔導士', 13, 4, false),
  ('ウィンドカッター', '魔導士', 13, 5, false),
  ('ライトニングボルト', '魔導士', 13, 6, false),
  ('魔力集中', '魔導士', 10, 7, false),
  ('メテオ', '魔導士', 22, 8, false),
  ('カタストロフ', '魔導士', 28, 9, false),
  ('刻の加護', '時魔導士', 0, 1, true),
  ('クロノバレット', '時魔導士', 6, 2, false),
  ('アクセル', '時魔導士', 10, 3, false),
  ('スロウ', '時魔導士', 10, 4, false),
  ('ディレイ', '時魔導士', 12, 5, false),
  ('ストップ', '時魔導士', 16, 6, false),
  ('クイック', '時魔導士', 14, 7, false),
  ('リワインド', '時魔導士', 14, 8, false),
  ('クロノブレイク', '時魔導士', 24, 9, false),
  ('死者の盾', '死霊術師', 0, 1, true),
  ('骸骨召喚', '死霊術師', 10, 2, false),
  ('ソウルドレイン', '死霊術師', 10, 3, false),
  ('ボーンスピア', '死霊術師', 11, 4, false),
  ('恐怖の囁き', '死霊術師', 10, 5, false),
  ('腐敗霧', '死霊術師', 14, 6, false),
  ('死の行軍', '死霊術師', 12, 7, false),
  ('魂喰らい', '死霊術師', 12, 8, false),
  ('幽世ノ門', '死霊術師', 24, 9, false),
  ('陰陽の理', '陰陽師', 0, 1, true),
  ('式打ち', '陰陽師', 6, 2, false),
  ('式神召喚', '陰陽師', 14, 3, false),
  ('封の符', '陰陽師', 12, 4, false),
  ('火炎符', '陰陽師', 12, 5, false),
  ('陰陽結界', '陰陽師', 12, 6, false),
  ('魂削りの符', '陰陽師', 12, 7, false),
  ('鬼神降ろし', '陰陽師', 14, 8, false),
  ('禁術・神降ろし', '陰陽師', 24, 9, false),
  ('神聖加護', '司祭', 0, 1, true),
  ('聖光', '司祭', 7, 2, false),
  ('ハイヒール', '司祭', 12, 3, false),
  ('ブレス', '司祭', 10, 4, false),
  ('奇跡', '司祭', 16, 5, false),
  ('祈りの結界', '司祭', 12, 6, false),
  ('癒しの光撃', '司祭', 14, 7, false),
  ('リザレクション', '司祭', 20, 8, false),
  ('セイクリッドノヴァ', '司祭', 24, 9, false),
  ('退魔の心得', '祓魔師', 0, 1, true),
  ('破魔の光', '祓魔師', 7, 2, false),
  ('封魔の印', '祓魔師', 12, 3, false),
  ('ホーリーチェイン', '祓魔師', 12, 4, false),
  ('聖水', '祓魔師', 10, 5, false),
  ('狂信', '祓魔師', 12, 6, false),
  ('浄化の炎', '祓魔師', 14, 7, false),
  ('聖なる裁き', '祓魔師', 16, 8, false),
  ('断罪', '祓魔師', 24, 9, false),
  ('化学反応', '錬金術師', 0, 1, true),
  ('火炎瓶', '錬金術師', 7, 2, false),
  ('劇毒瓶', '錬金術師', 10, 3, false),
  ('スパークボトル', '錬金術師', 10, 4, false),
  ('腐食液', '錬金術師', 12, 5, false),
  ('閃光弾', '錬金術師', 10, 6, false),
  ('触媒', '錬金術師', 10, 7, false),
  ('溶解液', '錬金術師', 14, 8, false),
  ('メガボム', '錬金術師', 24, 9, false),
  ('調合の極意', '霊薬師', 0, 1, true),
  ('霊薬瓶', '霊薬師', 7, 2, false),
  ('剛力薬', '霊薬師', 9, 3, false),
  ('叡智の薬', '霊薬師', 9, 4, false),
  ('鉄身薬', '霊薬師', 9, 5, false),
  ('再生薬', '霊薬師', 14, 6, false),
  ('霊薬', '霊薬師', 14, 7, false),
  ('薬効解放', '霊薬師', 16, 8, false),
  ('仙丹', '霊薬師', 22, 9, false);
-- @@end:skills

-- ---- 1-4. 装備の一覧（エリア × レア度 × 種類）----
-- ★2026-10-09 ユーザーの表で作り替えた：エリアごとに26点（武器14種・重鎧4部位・軽装4部位・装飾品4種）が
--   レア度（N ノーマル・R レア・E エピック・L レジェンダリー）ごとに1つずつ＝全部で1560点。ランク（F〜S）はやめた
--   （刀・宝珠は同じ日に足した。後ろに足したので前からある装備のIDは変わらない）
-- id … 「エリア＋レア度：種類」（例 1N:片手剣・15L:重鎧頭）
-- part … 武器／頭／鎧／腕／足／アクセ ／ type … 武器の種類（防具は系統・装飾品は種類）／ line … 重鎧／軽装
-- area … 落ちるエリア（1〜15）／ rarity … N／R／E／L ／ lv … 必要LV（＝アイテムLV。エリア×レア度・ユーザーの表：
--   ノーマル＝5×エリア、レア＋5・エピック＋10・レジェンダリー＋15）
-- ★配分（どのステに散らすか）と強さは src/v2cap/lib/equipment.js・gear.js にある。
--   サーバーが要るのは枠・種類・エリア・レア度の判定だけ
create table if not exists public.v2cap_equipment (
  id     text primary key,
  name   text not null,
  part   text not null,
  type   text not null,
  line   text,
  area   int,
  rarity text,
  lv     int
);
-- 前からあった表（ランクの形）に列を足す。前の基本装備の行は §2 の作り直しのあとで消す
alter table public.v2cap_equipment add column if not exists area int;
alter table public.v2cap_equipment add column if not exists rarity text;
alter table public.v2cap_equipment add column if not exists lv int;
alter table public.v2cap_equipment enable row level security;
drop policy if exists v2cap_equipment_read on public.v2cap_equipment;
create policy v2cap_equipment_read on public.v2cap_equipment for select to authenticated using (true);
revoke all on table public.v2cap_equipment from anon;
grant select on table public.v2cap_equipment to authenticated;

-- @@seed:equipment
insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv) values
  ('1N:片手剣', 'ブロンズソード', '武器', '片手剣', null, 1, 'N', 5),
  ('1N:両手剣', 'ブロンズクレイモア', '武器', '両手剣', null, 1, 'N', 5),
  ('1N:斧', 'ブロンズアクス', '武器', '斧', null, 1, 'N', 5),
  ('1N:槍', 'ブロンズスピア', '武器', '槍', null, 1, 'N', 5),
  ('1N:鈍器', 'ブロンズメイス', '武器', '鈍器', null, 1, 'N', 5),
  ('1N:短剣', 'ブロンズダガー', '武器', '短剣', null, 1, 'N', 5),
  ('1N:拳', 'ブロンズナックル', '武器', '拳', null, 1, 'N', 5),
  ('1N:弓', 'ウッドボウ', '武器', '弓', null, 1, 'N', 5),
  ('1N:銃', 'マッチロック', '武器', '銃', null, 1, 'N', 5),
  ('1N:杖', 'ウッドスタッフ', '武器', '杖', null, 1, 'N', 5),
  ('1N:書', '入門書', '武器', '書', null, 1, 'N', 5),
  ('1N:投擲', 'ブロンズチャクラム', '武器', '投擲', null, 1, 'N', 5),
  ('1N:刀', 'ブロンズカタナ', '武器', '刀', null, 1, 'N', 5),
  ('1N:宝珠', 'グラスオーブ', '武器', '宝珠', null, 1, 'N', 5),
  ('1N:重鎧頭', 'ブロンズヘルム', '頭', '重鎧', '重鎧', 1, 'N', 5),
  ('1N:重鎧鎧', 'ブロンズメイル', '鎧', '重鎧', '重鎧', 1, 'N', 5),
  ('1N:重鎧腕', 'ブロンズガントレット', '腕', '重鎧', '重鎧', 1, 'N', 5),
  ('1N:重鎧足', 'ブロンズグリーヴ', '足', '重鎧', '重鎧', 1, 'N', 5),
  ('1N:軽装頭', 'リネンフード', '頭', '軽装', '軽装', 1, 'N', 5),
  ('1N:軽装鎧', 'リネンコート', '鎧', '軽装', '軽装', 1, 'N', 5),
  ('1N:軽装腕', 'リネングローブ', '腕', '軽装', '軽装', 1, 'N', 5),
  ('1N:軽装足', 'リネンブーツ', '足', '軽装', '軽装', 1, 'N', 5),
  ('1N:リング', 'カッパーリング', 'アクセ', 'リング', null, 1, 'N', 5),
  ('1N:イヤリング', 'カッパーイヤリング', 'アクセ', 'イヤリング', null, 1, 'N', 5),
  ('1N:ベルト', 'カッパーベルト', 'アクセ', 'ベルト', null, 1, 'N', 5),
  ('1N:ネックレス', 'カッパーネックレス', 'アクセ', 'ネックレス', null, 1, 'N', 5),
  ('1R:片手剣', '若葉の剣', '武器', '片手剣', null, 1, 'R', 10),
  ('1R:両手剣', '古樹断ち', '武器', '両手剣', null, 1, 'R', 10),
  ('1R:斧', '木こりの斧', '武器', '斧', null, 1, 'R', 10),
  ('1R:槍', 'ブランチスピア', '武器', '槍', null, 1, 'R', 10),
  ('1R:鈍器', 'ドングリハンマー', '武器', '鈍器', null, 1, 'R', 10),
  ('1R:短剣', '葉隠れ短剣', '武器', '短剣', null, 1, 'R', 10),
  ('1R:拳', 'モスナックル', '武器', '拳', null, 1, 'R', 10),
  ('1R:弓', 'サンリーフボウ', '武器', '弓', null, 1, 'R', 10),
  ('1R:銃', '森番の猟銃', '武器', '銃', null, 1, 'R', 10),
  ('1R:杖', 'スプラウトロッド', '武器', '杖', null, 1, 'R', 10),
  ('1R:書', '妖精の絵本', '武器', '書', null, 1, 'R', 10),
  ('1R:投擲', '妖精の輪', '武器', '投擲', null, 1, 'R', 10),
  ('1R:刀', '苔むした古刀', '武器', '刀', null, 1, 'R', 10),
  ('1R:宝珠', '木霊の珠', '武器', '宝珠', null, 1, 'R', 10),
  ('1R:重鎧頭', '樹皮の兜', '頭', '重鎧', '重鎧', 1, 'R', 10),
  ('1R:重鎧鎧', '樹皮の鎧', '鎧', '重鎧', '重鎧', 1, 'R', 10),
  ('1R:重鎧腕', '樹皮の篭手', '腕', '重鎧', '重鎧', 1, 'R', 10),
  ('1R:重鎧足', '樹皮の脚甲', '足', '重鎧', '重鎧', 1, 'R', 10),
  ('1R:軽装頭', 'フェアリーハット', '頭', '軽装', '軽装', 1, 'R', 10),
  ('1R:軽装鎧', 'フェアリーローブ', '鎧', '軽装', '軽装', 1, 'R', 10),
  ('1R:軽装腕', 'フェアリーミトン', '腕', '軽装', '軽装', 1, 'R', 10),
  ('1R:軽装足', 'フェアリーシューズ', '足', '軽装', '軽装', 1, 'R', 10),
  ('1R:リング', '翡翠の指輪', 'アクセ', 'リング', null, 1, 'R', 10),
  ('1R:イヤリング', '朝露のしずく', 'アクセ', 'イヤリング', null, 1, 'R', 10),
  ('1R:ベルト', '蔓編みベルト', 'アクセ', 'ベルト', null, 1, 'R', 10),
  ('1R:ネックレス', 'どんぐりペンダント', 'アクセ', 'ネックレス', null, 1, 'R', 10),
  ('1E:片手剣', '翠玉剣ジェイド', '武器', '片手剣', null, 1, 'E', 15),
  ('1E:両手剣', '古樹王の大剣', '武器', '両手剣', null, 1, 'E', 15),
  ('1E:斧', '女王蟻の大顎', '武器', '斧', null, 1, 'E', 15),
  ('1E:槍', 'サンテイル', '武器', '槍', null, 1, 'E', 15),
  ('1E:鈍器', '粘王の鎚', '武器', '鈍器', null, 1, 'E', 15),
  ('1E:短剣', '親分の隠し刀', '武器', '短剣', null, 1, 'E', 15),
  ('1E:拳', '陽蜥蜴の爪', '武器', '拳', null, 1, 'E', 15),
  ('1E:弓', '陽光の弓サンレイ', '武器', '弓', null, 1, 'E', 15),
  ('1E:銃', '夜梟の長銃', '武器', '銃', null, 1, 'E', 15),
  ('1E:杖', '千年樹の杖', '武器', '杖', null, 1, 'E', 15),
  ('1E:書', '妖精王の詩篇', '武器', '書', null, 1, 'E', 15),
  ('1E:投擲', 'オーロラサークル', '武器', '投擲', null, 1, 'E', 15),
  ('1E:刀', '夜梟丸', '武器', '刀', null, 1, 'E', 15),
  ('1E:宝珠', 'オーロラの宝珠', '武器', '宝珠', null, 1, 'E', 15),
  ('1E:重鎧頭', '女王蟻の兜', '頭', '重鎧', '重鎧', 1, 'E', 15),
  ('1E:重鎧鎧', '女王蟻の甲殻鎧', '鎧', '重鎧', '重鎧', 1, 'E', 15),
  ('1E:重鎧腕', '女王蟻の篭手', '腕', '重鎧', '重鎧', 1, 'E', 15),
  ('1E:重鎧足', '女王蟻の脚甲', '足', '重鎧', '重鎧', 1, 'E', 15),
  ('1E:軽装頭', 'ティターニアハット', '頭', '軽装', '軽装', 1, 'E', 15),
  ('1E:軽装鎧', 'ティターニアドレス', '鎧', '軽装', '軽装', 1, 'E', 15),
  ('1E:軽装腕', 'ティターニアグローブ', '腕', '軽装', '軽装', 1, 'E', 15),
  ('1E:軽装足', 'ティターニアブーツ', '足', '軽装', '軽装', 1, 'E', 15),
  ('1E:リング', '翡翠王の指輪', 'アクセ', 'リング', null, 1, 'E', 15),
  ('1E:イヤリング', '陽光石の耳飾り', 'アクセ', 'イヤリング', null, 1, 'E', 15),
  ('1E:ベルト', '親分の金帯', 'アクセ', 'ベルト', null, 1, 'E', 15),
  ('1E:ネックレス', 'スライムコア', 'アクセ', 'ネックレス', null, 1, 'E', 15),
  ('1L:片手剣', '原初剣アルファ', '武器', '片手剣', null, 1, 'L', 20),
  ('1L:両手剣', '森羅万象', '武器', '両手剣', null, 1, 'L', 20),
  ('1L:斧', '千軍斧レギオン', '武器', '斧', null, 1, 'L', 20),
  ('1L:槍', '若葉神槍ヴェルデ', '武器', '槍', null, 1, 'L', 20),
  ('1L:鈍器', 'グラトニー', '武器', '鈍器', null, 1, 'L', 20),
  ('1L:短剣', '鼠小僧', '武器', '短剣', null, 1, 'L', 20),
  ('1L:拳', '不撓不屈', '武器', '拳', null, 1, 'L', 20),
  ('1L:弓', 'ファーストライト', '武器', '弓', null, 1, 'L', 20),
  ('1L:銃', '千両砲', '武器', '銃', null, 1, 'L', 20),
  ('1L:杖', '森主の霊杖', '武器', '杖', null, 1, 'L', 20),
  ('1L:書', 'はじまりの物語', '武器', '書', null, 1, 'L', 20),
  ('1L:投擲', '木霊返し', '武器', '投擲', null, 1, 'L', 20),
  ('1L:刀', '初太刀', '武器', '刀', null, 1, 'L', 20),
  ('1L:宝珠', '原初の光', '武器', '宝珠', null, 1, 'L', 20),
  ('1L:重鎧頭', '蟻帝の冠', '頭', '重鎧', '重鎧', 1, 'L', 20),
  ('1L:重鎧鎧', '蟻帝の聖鎧', '鎧', '重鎧', '重鎧', 1, 'L', 20),
  ('1L:重鎧腕', '蟻帝の篭手', '腕', '重鎧', '重鎧', 1, 'L', 20),
  ('1L:重鎧足', '蟻帝の具足', '足', '重鎧', '重鎧', 1, 'L', 20),
  ('1L:軽装頭', 'グリーンマンフード', '頭', '軽装', '軽装', 1, 'L', 20),
  ('1L:軽装鎧', 'グリーンマンローブ', '鎧', '軽装', '軽装', 1, 'L', 20),
  ('1L:軽装腕', 'グリーンマングローブ', '腕', '軽装', '軽装', 1, 'L', 20),
  ('1L:軽装足', 'グリーンマンブーツ', '足', '軽装', '軽装', 1, 'L', 20),
  ('1L:リング', 'ゼロの指輪', 'アクセ', 'リング', null, 1, 'L', 20),
  ('1L:イヤリング', '粘神の雫', 'アクセ', 'イヤリング', null, 1, 'L', 20),
  ('1L:ベルト', '旅立ちの帯', 'アクセ', 'ベルト', null, 1, 'L', 20),
  ('1L:ネックレス', '森主の種', 'アクセ', 'ネックレス', null, 1, 'L', 20),
  ('2N:片手剣', 'アイアンソード', '武器', '片手剣', null, 2, 'N', 10),
  ('2N:両手剣', 'アイアンクレイモア', '武器', '両手剣', null, 2, 'N', 10),
  ('2N:斧', 'アイアンアクス', '武器', '斧', null, 2, 'N', 10),
  ('2N:槍', 'アイアンスピア', '武器', '槍', null, 2, 'N', 10),
  ('2N:鈍器', 'アイアンメイス', '武器', '鈍器', null, 2, 'N', 10),
  ('2N:短剣', 'アイアンダガー', '武器', '短剣', null, 2, 'N', 10),
  ('2N:拳', 'アイアンナックル', '武器', '拳', null, 2, 'N', 10),
  ('2N:弓', 'オークボウ', '武器', '弓', null, 2, 'N', 10),
  ('2N:銃', 'マスケット', '武器', '銃', null, 2, 'N', 10),
  ('2N:杖', 'オークスタッフ', '武器', '杖', null, 2, 'N', 10),
  ('2N:書', '教本', '武器', '書', null, 2, 'N', 10),
  ('2N:投擲', 'アイアンチャクラム', '武器', '投擲', null, 2, 'N', 10),
  ('2N:刀', 'アイアンカタナ', '武器', '刀', null, 2, 'N', 10),
  ('2N:宝珠', 'クォーツオーブ', '武器', '宝珠', null, 2, 'N', 10),
  ('2N:重鎧頭', 'アイアンヘルム', '頭', '重鎧', '重鎧', 2, 'N', 10),
  ('2N:重鎧鎧', 'アイアンメイル', '鎧', '重鎧', '重鎧', 2, 'N', 10),
  ('2N:重鎧腕', 'アイアンガントレット', '腕', '重鎧', '重鎧', 2, 'N', 10),
  ('2N:重鎧足', 'アイアングリーヴ', '足', '重鎧', '重鎧', 2, 'N', 10),
  ('2N:軽装頭', 'レザーフード', '頭', '軽装', '軽装', 2, 'N', 10),
  ('2N:軽装鎧', 'レザーコート', '鎧', '軽装', '軽装', 2, 'N', 10),
  ('2N:軽装腕', 'レザーグローブ', '腕', '軽装', '軽装', 2, 'N', 10),
  ('2N:軽装足', 'レザーブーツ', '足', '軽装', '軽装', 2, 'N', 10),
  ('2N:リング', 'クォーツリング', 'アクセ', 'リング', null, 2, 'N', 10),
  ('2N:イヤリング', 'クォーツイヤリング', 'アクセ', 'イヤリング', null, 2, 'N', 10),
  ('2N:ベルト', 'クォーツベルト', 'アクセ', 'ベルト', null, 2, 'N', 10),
  ('2N:ネックレス', 'クォーツネックレス', 'アクセ', 'ネックレス', null, 2, 'N', 10),
  ('2R:片手剣', '無名騎士の剣', '武器', '片手剣', null, 2, 'R', 15),
  ('2R:両手剣', '古戦場の大剣', '武器', '両手剣', null, 2, 'R', 15),
  ('2R:斧', '野盗の手斧', '武器', '斧', null, 2, 'R', 15),
  ('2R:槍', 'ウィンドパイク', '武器', '槍', null, 2, 'R', 15),
  ('2R:鈍器', '棘付き棍棒', '武器', '鈍器', null, 2, 'R', 15),
  ('2R:短剣', '盗賊短刀', '武器', '短剣', null, 2, 'R', 15),
  ('2R:拳', '狼牙拳', '武器', '拳', null, 2, 'R', 15),
  ('2R:弓', 'ゴブリンショートボウ', '武器', '弓', null, 2, 'R', 15),
  ('2R:銃', '流れ者の拳銃', '武器', '銃', null, 2, 'R', 15),
  ('2R:杖', '風読みの杖', '武器', '杖', null, 2, 'R', 15),
  ('2R:書', '戦場日誌', '武器', '書', null, 2, 'R', 15),
  ('2R:投擲', '猪狩りのボーラ', '武器', '投擲', null, 2, 'R', 15),
  ('2R:刀', '無銘の野太刀', '武器', '刀', null, 2, 'R', 15),
  ('2R:宝珠', '風見の水晶', '武器', '宝珠', null, 2, 'R', 15),
  ('2R:重鎧頭', '古兵の兜', '頭', '重鎧', '重鎧', 2, 'R', 15),
  ('2R:重鎧鎧', '古兵の鎧', '鎧', '重鎧', '重鎧', 2, 'R', 15),
  ('2R:重鎧腕', '古兵の篭手', '腕', '重鎧', '重鎧', 2, 'R', 15),
  ('2R:重鎧足', '古兵の具足', '足', '重鎧', '重鎧', 2, 'R', 15),
  ('2R:軽装頭', 'ウルフハイドフード', '頭', '軽装', '軽装', 2, 'R', 15),
  ('2R:軽装鎧', 'ウルフハイドジャケット', '鎧', '軽装', '軽装', 2, 'R', 15),
  ('2R:軽装腕', 'ウルフハイドグローブ', '腕', '軽装', '軽装', 2, 'R', 15),
  ('2R:軽装足', 'ウルフハイドブーツ', '足', '軽装', '軽装', 2, 'R', 15),
  ('2R:リング', '盗品の指輪', 'アクセ', 'リング', null, 2, 'R', 15),
  ('2R:イヤリング', '牙飾りのピアス', 'アクセ', 'イヤリング', null, 2, 'R', 15),
  ('2R:ベルト', 'バンディットベルト', 'アクセ', 'ベルト', null, 2, 'R', 15),
  ('2R:ネックレス', '骨片の首飾り', 'アクセ', 'ネックレス', null, 2, 'R', 15),
  ('2E:片手剣', '盗賊王の宝剣', '武器', '片手剣', null, 2, 'E', 20),
  ('2E:両手剣', '大剣グレイファング', '武器', '両手剣', null, 2, 'E', 20),
  ('2E:斧', '首狩り斧', '武器', '斧', null, 2, 'E', 20),
  ('2E:槍', '族長の戦槍', '武器', '槍', null, 2, 'E', 20),
  ('2E:鈍器', '大鬼の金棍', '武器', '鈍器', null, 2, 'E', 20),
  ('2E:短剣', '影縫いの短剣', '武器', '短剣', null, 2, 'E', 20),
  ('2E:拳', 'フレアナックル', '武器', '拳', null, 2, 'E', 20),
  ('2E:弓', 'シルバームーン', '武器', '弓', null, 2, 'E', 20),
  ('2E:銃', 'ハイウェイマン', '武器', '銃', null, 2, 'E', 20),
  ('2E:杖', '邪眼の杖', '武器', '杖', null, 2, 'E', 20),
  ('2E:書', '盗賊団の裏帳簿', '武器', '書', null, 2, 'E', 20),
  ('2E:投擲', '幻霧のチャクラム', '武器', '投擲', null, 2, 'E', 20),
  ('2E:刀', '銀狼丸', '武器', '刀', null, 2, 'E', 20),
  ('2E:宝珠', 'ミストオーブ', '武器', '宝珠', null, 2, 'E', 20),
  ('2E:重鎧頭', '銀狼の兜', '頭', '重鎧', '重鎧', 2, 'E', 20),
  ('2E:重鎧鎧', '銀狼の鎧', '鎧', '重鎧', '重鎧', 2, 'E', 20),
  ('2E:重鎧腕', '銀狼の篭手', '腕', '重鎧', '重鎧', 2, 'E', 20),
  ('2E:重鎧足', '銀狼の具足', '足', '重鎧', '重鎧', 2, 'E', 20),
  ('2E:軽装頭', 'ローグフード', '頭', '軽装', '軽装', 2, 'E', 20),
  ('2E:軽装鎧', 'ローグコート', '鎧', '軽装', '軽装', 2, 'E', 20),
  ('2E:軽装腕', 'ローググローブ', '腕', '軽装', '軽装', 2, 'E', 20),
  ('2E:軽装足', 'ローグブーツ', '足', '軽装', '軽装', 2, 'E', 20),
  ('2E:リング', 'ゴブリン王の印章', 'アクセ', 'リング', null, 2, 'E', 20),
  ('2E:イヤリング', 'ミストパール', 'アクセ', 'イヤリング', null, 2, 'E', 20),
  ('2E:ベルト', '首領の弾帯', 'アクセ', 'ベルト', null, 2, 'E', 20),
  ('2E:ネックレス', '灰牙の首飾り', 'アクセ', 'ネックレス', null, 2, 'E', 20),
  ('2L:片手剣', '無頼剣', '武器', '片手剣', null, 2, 'L', 25),
  ('2L:両手剣', '一騎当千', '武器', '両手剣', null, 2, 'L', 25),
  ('2L:斧', '簒奪の斧', '武器', '斧', null, 2, 'L', 25),
  ('2L:槍', 'ヴォルフガング', '武器', '槍', null, 2, 'L', 25),
  ('2L:鈍器', '万夫不当', '武器', '鈍器', null, 2, 'L', 25),
  ('2L:短剣', '夜叉丸', '武器', '短剣', null, 2, 'L', 25),
  ('2L:拳', '群狼拳', '武器', '拳', null, 2, 'L', 25),
  ('2L:弓', '鎮魂の弓', '武器', '弓', null, 2, 'L', 25),
  ('2L:銃', 'ジャックポット', '武器', '銃', null, 2, 'L', 25),
  ('2L:杖', '古戦場の灯', '武器', '杖', null, 2, 'L', 25),
  ('2L:書', '英雄譚', '武器', '書', null, 2, 'L', 25),
  ('2L:投擲', '旋風輪', '武器', '投擲', null, 2, 'L', 25),
  ('2L:刀', '無双', '武器', '刀', null, 2, 'L', 25),
  ('2L:宝珠', '英霊の魂珠', '武器', '宝珠', null, 2, 'L', 25),
  ('2L:重鎧頭', '英霊の兜', '頭', '重鎧', '重鎧', 2, 'L', 25),
  ('2L:重鎧鎧', '英霊の鎧', '鎧', '重鎧', '重鎧', 2, 'L', 25),
  ('2L:重鎧腕', '英霊の篭手', '腕', '重鎧', '重鎧', 2, 'L', 25),
  ('2L:重鎧足', '英霊の具足', '足', '重鎧', '重鎧', 2, 'L', 25),
  ('2L:軽装頭', 'フェンリスフード', '頭', '軽装', '軽装', 2, 'L', 25),
  ('2L:軽装鎧', 'フェンリスコート', '鎧', '軽装', '軽装', 2, 'L', 25),
  ('2L:軽装腕', 'フェンリスグローブ', '腕', '軽装', '軽装', 2, 'L', 25),
  ('2L:軽装足', 'フェンリスブーツ', '足', '軽装', '軽装', 2, 'L', 25),
  ('2L:リング', '義賊の指輪', 'アクセ', 'リング', null, 2, 'L', 25),
  ('2L:イヤリング', '王狼のピアス', 'アクセ', 'イヤリング', null, 2, 'L', 25),
  ('2L:ベルト', '略奪王の帯', 'アクセ', 'ベルト', null, 2, 'L', 25),
  ('2L:ネックレス', '戦友の誓い', 'アクセ', 'ネックレス', null, 2, 'L', 25),
  ('3N:片手剣', 'スチールソード', '武器', '片手剣', null, 3, 'N', 15),
  ('3N:両手剣', 'スチールクレイモア', '武器', '両手剣', null, 3, 'N', 15),
  ('3N:斧', 'スチールアクス', '武器', '斧', null, 3, 'N', 15),
  ('3N:槍', 'スチールスピア', '武器', '槍', null, 3, 'N', 15),
  ('3N:鈍器', 'スチールメイス', '武器', '鈍器', null, 3, 'N', 15),
  ('3N:短剣', 'スチールダガー', '武器', '短剣', null, 3, 'N', 15),
  ('3N:拳', 'スチールナックル', '武器', '拳', null, 3, 'N', 15),
  ('3N:弓', 'アッシュボウ', '武器', '弓', null, 3, 'N', 15),
  ('3N:銃', 'フリントロック', '武器', '銃', null, 3, 'N', 15),
  ('3N:杖', 'アッシュスタッフ', '武器', '杖', null, 3, 'N', 15),
  ('3N:書', '古写本', '武器', '書', null, 3, 'N', 15),
  ('3N:投擲', 'スチールチャクラム', '武器', '投擲', null, 3, 'N', 15),
  ('3N:刀', 'スチールカタナ', '武器', '刀', null, 3, 'N', 15),
  ('3N:宝珠', 'アメジストオーブ', '武器', '宝珠', null, 3, 'N', 15),
  ('3N:重鎧頭', 'スチールヘルム', '頭', '重鎧', '重鎧', 3, 'N', 15),
  ('3N:重鎧鎧', 'スチールメイル', '鎧', '重鎧', '重鎧', 3, 'N', 15),
  ('3N:重鎧腕', 'スチールガントレット', '腕', '重鎧', '重鎧', 3, 'N', 15),
  ('3N:重鎧足', 'スチールグリーヴ', '足', '重鎧', '重鎧', 3, 'N', 15),
  ('3N:軽装頭', 'ハードレザーフード', '頭', '軽装', '軽装', 3, 'N', 15),
  ('3N:軽装鎧', 'ハードレザーコート', '鎧', '軽装', '軽装', 3, 'N', 15),
  ('3N:軽装腕', 'ハードレザーグローブ', '腕', '軽装', '軽装', 3, 'N', 15),
  ('3N:軽装足', 'ハードレザーブーツ', '足', '軽装', '軽装', 3, 'N', 15),
  ('3N:リング', 'アメジストリング', 'アクセ', 'リング', null, 3, 'N', 15),
  ('3N:イヤリング', 'アメジストイヤリング', 'アクセ', 'イヤリング', null, 3, 'N', 15),
  ('3N:ベルト', 'アメジストベルト', 'アクセ', 'ベルト', null, 3, 'N', 15),
  ('3N:ネックレス', 'アメジストネックレス', 'アクセ', 'ネックレス', null, 3, 'N', 15),
  ('3R:片手剣', '刻印の剣', '武器', '片手剣', null, 3, 'R', 20),
  ('3R:両手剣', '骸骨騎士の大剣', '武器', '両手剣', null, 3, 'R', 20),
  ('3R:斧', '黒曜の斧', '武器', '斧', null, 3, 'R', 20),
  ('3R:槍', '石筍の槍', '武器', '槍', null, 3, 'R', 20),
  ('3R:鈍器', 'ゴーレムクラッシャー', '武器', '鈍器', null, 3, 'R', 20),
  ('3R:短剣', 'ファントムナイフ', '武器', '短剣', null, 3, 'R', 20),
  ('3R:拳', 'ガーゴイルクロー', '武器', '拳', null, 3, 'R', 20),
  ('3R:弓', 'ボーンボウ', '武器', '弓', null, 3, 'R', 20),
  ('3R:銃', 'からくり銃', '武器', '銃', null, 3, 'R', 20),
  ('3R:杖', '鍾乳石の杖', '武器', '杖', null, 3, 'R', 20),
  ('3R:書', '古代碑文集', '武器', '書', null, 3, 'R', 20),
  ('3R:投擲', '投石帯', '武器', '投擲', null, 3, 'R', 20),
  ('3R:刀', '骸武者の刀', '武器', '刀', null, 3, 'R', 20),
  ('3R:宝珠', '封印の水晶球', '武器', '宝珠', null, 3, 'R', 20),
  ('3R:重鎧頭', 'ガーディアンヘルム', '頭', '重鎧', '重鎧', 3, 'R', 20),
  ('3R:重鎧鎧', 'ガーディアンプレート', '鎧', '重鎧', '重鎧', 3, 'R', 20),
  ('3R:重鎧腕', 'ガーディアンガントレット', '腕', '重鎧', '重鎧', 3, 'R', 20),
  ('3R:重鎧足', 'ガーディアングリーヴ', '足', '重鎧', '重鎧', 3, 'R', 20),
  ('3R:軽装頭', '探索者の帽子', '頭', '軽装', '軽装', 3, 'R', 20),
  ('3R:軽装鎧', '探索者の外套', '鎧', '軽装', '軽装', 3, 'R', 20),
  ('3R:軽装腕', '探索者の手袋', '腕', '軽装', '軽装', 3, 'R', 20),
  ('3R:軽装足', '探索者の長靴', '足', '軽装', '軽装', 3, 'R', 20),
  ('3R:リング', '封印の指輪', 'アクセ', 'リング', null, 3, 'R', 20),
  ('3R:イヤリング', 'ソウルピアス', 'アクセ', 'イヤリング', null, 3, 'R', 20),
  ('3R:ベルト', '紋章ベルト', 'アクセ', 'ベルト', null, 3, 'R', 20),
  ('3R:ネックレス', '番人の護符', 'アクセ', 'ネックレス', null, 3, 'R', 20),
  ('3E:片手剣', '黒騎士の魔剣', '武器', '片手剣', null, 3, 'E', 25),
  ('3E:両手剣', 'ガーディアンズオース', '武器', '両手剣', null, 3, 'E', 25),
  ('3E:斧', 'ドグラの大斧', '武器', '斧', null, 3, 'E', 25),
  ('3E:槍', '黒曜の長槍', '武器', '槍', null, 3, 'E', 25),
  ('3E:鈍器', 'ペトリファイア', '武器', '鈍器', null, 3, 'E', 25),
  ('3E:短剣', 'ソウルスティーラー', '武器', '短剣', null, 3, 'E', 25),
  ('3E:拳', '暁の石拳', '武器', '拳', null, 3, 'E', 25),
  ('3E:弓', 'ガーゴイルウィング', '武器', '弓', null, 3, 'E', 25),
  ('3E:銃', '番人の古代砲', '武器', '銃', null, 3, 'E', 25),
  ('3E:杖', 'バジリスクロッド', '武器', '杖', null, 3, 'E', 25),
  ('3E:書', '封印石室の秘文', '武器', '書', null, 3, 'E', 25),
  ('3E:投擲', '骨刃ブーメラン', '武器', '投擲', null, 3, 'E', 25),
  ('3E:刀', '黒曜刀', '武器', '刀', null, 3, 'E', 25),
  ('3E:宝珠', '暁石の宝珠', '武器', '宝珠', null, 3, 'E', 25),
  ('3E:重鎧頭', '骸将の兜', '頭', '重鎧', '重鎧', 3, 'E', 25),
  ('3E:重鎧鎧', '骸将の鎧', '鎧', '重鎧', '重鎧', 3, 'E', 25),
  ('3E:重鎧腕', '骸将の篭手', '腕', '重鎧', '重鎧', 3, 'E', 25),
  ('3E:重鎧足', '骸将の具足', '足', '重鎧', '重鎧', 3, 'E', 25),
  ('3E:軽装頭', 'レイスフード', '頭', '軽装', '軽装', 3, 'E', 25),
  ('3E:軽装鎧', 'レイスローブ', '鎧', '軽装', '軽装', 3, 'E', 25),
  ('3E:軽装腕', 'レイスグローブ', '腕', '軽装', '軽装', 3, 'E', 25),
  ('3E:軽装足', 'レイスブーツ', '足', '軽装', '軽装', 3, 'E', 25),
  ('3E:リング', '古代王の指輪', 'アクセ', 'リング', null, 3, 'E', 25),
  ('3E:イヤリング', '黒曜の耳飾り', 'アクセ', 'イヤリング', null, 3, 'E', 25),
  ('3E:ベルト', '骨鎖の帯', 'アクセ', 'ベルト', null, 3, 'E', 25),
  ('3E:ネックレス', '番人の心核', 'アクセ', 'ネックレス', null, 3, 'E', 25),
  ('3L:片手剣', '古王剣オルドゥス', '武器', '片手剣', null, 3, 'L', 30),
  ('3L:両手剣', '金剛不壊', '武器', '両手剣', null, 3, 'L', 30),
  ('3L:斧', '地底王の斧', '武器', '斧', null, 3, 'L', 30),
  ('3L:槍', '死将の旗槍', '武器', '槍', null, 3, 'L', 30),
  ('3L:鈍器', '守護神の鎚', '武器', '鈍器', null, 3, 'L', 30),
  ('3L:短剣', '骸の囁き', '武器', '短剣', null, 3, 'L', 30),
  ('3L:拳', 'グラディエーター', '武器', '拳', null, 3, 'L', 30),
  ('3L:弓', 'アルカナボウ', '武器', '弓', null, 3, 'L', 30),
  ('3L:銃', '遺失兵器', '武器', '銃', null, 3, 'L', 30),
  ('3L:杖', '封じの大杖', '武器', '杖', null, 3, 'L', 30),
  ('3L:書', '古代王国年代記', '武器', '書', null, 3, 'L', 30),
  ('3L:投擲', '髑髏の円月輪', '武器', '投擲', null, 3, 'L', 30),
  ('3L:刀', '鬼哭', '武器', '刀', null, 3, 'L', 30),
  ('3L:宝珠', '古代王の玉璽', '武器', '宝珠', null, 3, 'L', 30),
  ('3L:重鎧頭', 'モノリスヘルム', '頭', '重鎧', '重鎧', 3, 'L', 30),
  ('3L:重鎧鎧', 'モノリスアーマー', '鎧', '重鎧', '重鎧', 3, 'L', 30),
  ('3L:重鎧腕', 'モノリスガントレット', '腕', '重鎧', '重鎧', 3, 'L', 30),
  ('3L:重鎧足', 'モノリスグリーヴ', '足', '重鎧', '重鎧', 3, 'L', 30),
  ('3L:軽装頭', '古代神官の冠', '頭', '軽装', '軽装', 3, 'L', 30),
  ('3L:軽装鎧', '古代神官の法衣', '鎧', '軽装', '軽装', 3, 'L', 30),
  ('3L:軽装腕', '古代神官の手甲', '腕', '軽装', '軽装', 3, 'L', 30),
  ('3L:軽装足', '古代神官の履', '足', '軽装', '軽装', 3, 'L', 30),
  ('3L:リング', '番人の契約指輪', 'アクセ', 'リング', null, 3, 'L', 30),
  ('3L:イヤリング', '冥府の灯', 'アクセ', 'イヤリング', null, 3, 'L', 30),
  ('3L:ベルト', '封印の鎖帯', 'アクセ', 'ベルト', null, 3, 'L', 30),
  ('3L:ネックレス', '時を刻む石', 'アクセ', 'ネックレス', null, 3, 'L', 30),
  ('4N:片手剣', 'シルバーソード', '武器', '片手剣', null, 4, 'N', 20),
  ('4N:両手剣', 'シルバークレイモア', '武器', '両手剣', null, 4, 'N', 20),
  ('4N:斧', 'シルバーアクス', '武器', '斧', null, 4, 'N', 20),
  ('4N:槍', 'シルバースピア', '武器', '槍', null, 4, 'N', 20),
  ('4N:鈍器', 'シルバーメイス', '武器', '鈍器', null, 4, 'N', 20),
  ('4N:短剣', 'シルバーダガー', '武器', '短剣', null, 4, 'N', 20),
  ('4N:拳', 'シルバーナックル', '武器', '拳', null, 4, 'N', 20),
  ('4N:弓', 'ウォルナットボウ', '武器', '弓', null, 4, 'N', 20),
  ('4N:銃', 'ブランダーバス', '武器', '銃', null, 4, 'N', 20),
  ('4N:杖', 'ウォルナットスタッフ', '武器', '杖', null, 4, 'N', 20),
  ('4N:書', '術式書', '武器', '書', null, 4, 'N', 20),
  ('4N:投擲', 'シルバーチャクラム', '武器', '投擲', null, 4, 'N', 20),
  ('4N:刀', 'シルバーカタナ', '武器', '刀', null, 4, 'N', 20),
  ('4N:宝珠', 'パールオーブ', '武器', '宝珠', null, 4, 'N', 20),
  ('4N:重鎧頭', 'シルバーヘルム', '頭', '重鎧', '重鎧', 4, 'N', 20),
  ('4N:重鎧鎧', 'シルバーメイル', '鎧', '重鎧', '重鎧', 4, 'N', 20),
  ('4N:重鎧腕', 'シルバーガントレット', '腕', '重鎧', '重鎧', 4, 'N', 20),
  ('4N:重鎧足', 'シルバーグリーヴ', '足', '重鎧', '重鎧', 4, 'N', 20),
  ('4N:軽装頭', 'シルクフード', '頭', '軽装', '軽装', 4, 'N', 20),
  ('4N:軽装鎧', 'シルクコート', '鎧', '軽装', '軽装', 4, 'N', 20),
  ('4N:軽装腕', 'シルクグローブ', '腕', '軽装', '軽装', 4, 'N', 20),
  ('4N:軽装足', 'シルクブーツ', '足', '軽装', '軽装', 4, 'N', 20),
  ('4N:リング', 'パールリング', 'アクセ', 'リング', null, 4, 'N', 20),
  ('4N:イヤリング', 'パールイヤリング', 'アクセ', 'イヤリング', null, 4, 'N', 20),
  ('4N:ベルト', 'パールベルト', 'アクセ', 'ベルト', null, 4, 'N', 20),
  ('4N:ネックレス', 'パールネックレス', 'アクセ', 'ネックレス', null, 4, 'N', 20),
  ('4R:片手剣', '海賊刀', '武器', '片手剣', null, 4, 'R', 25),
  ('4R:両手剣', 'メイルストローム', '武器', '両手剣', null, 4, 'R', 25),
  ('4R:斧', 'ボーディングアクス', '武器', '斧', null, 4, 'R', 25),
  ('4R:槍', 'サハギントライデント', '武器', '槍', null, 4, 'R', 25),
  ('4R:鈍器', 'アンカーハンマー', '武器', '鈍器', null, 4, 'R', 25),
  ('4R:短剣', '鮫牙の短剣', '武器', '短剣', null, 4, 'R', 25),
  ('4R:拳', 'クラブクロー', '武器', '拳', null, 4, 'R', 25),
  ('4R:弓', 'セイレーンボウ', '武器', '弓', null, 4, 'R', 25),
  ('4R:銃', '船長の短銃', '武器', '銃', null, 4, 'R', 25),
  ('4R:杖', 'コーラルロッド', '武器', '杖', null, 4, 'R', 25),
  ('4R:書', '航海日誌', '武器', '書', null, 4, 'R', 25),
  ('4R:投擲', 'シェルチャクラム', '武器', '投擲', null, 4, 'R', 25),
  ('4R:刀', '潮風丸', '武器', '刀', null, 4, 'R', 25),
  ('4R:宝珠', '海鳴りの珠', '武器', '宝珠', null, 4, 'R', 25),
  ('4R:重鎧頭', 'コーラルヘルム', '頭', '重鎧', '重鎧', 4, 'R', 25),
  ('4R:重鎧鎧', 'コーラルメイル', '鎧', '重鎧', '重鎧', 4, 'R', 25),
  ('4R:重鎧腕', 'コーラルガントレット', '腕', '重鎧', '重鎧', 4, 'R', 25),
  ('4R:重鎧足', 'コーラルグリーヴ', '足', '重鎧', '重鎧', 4, 'R', 25),
  ('4R:軽装頭', 'パイレーツハット', '頭', '軽装', '軽装', 4, 'R', 25),
  ('4R:軽装鎧', 'パイレーツコート', '鎧', '軽装', '軽装', 4, 'R', 25),
  ('4R:軽装腕', 'パイレーツグローブ', '腕', '軽装', '軽装', 4, 'R', 25),
  ('4R:軽装足', 'パイレーツブーツ', '足', '軽装', '軽装', 4, 'R', 25),
  ('4R:リング', '潮騒の指輪', 'アクセ', 'リング', null, 4, 'R', 25),
  ('4R:イヤリング', '貝殻イヤリング', 'アクセ', 'イヤリング', null, 4, 'R', 25),
  ('4R:ベルト', '錨飾りのベルト', 'アクセ', 'ベルト', null, 4, 'R', 25),
  ('4R:ネックレス', '人魚の涙', 'アクセ', 'ネックレス', null, 4, 'R', 25),
  ('4E:片手剣', '船長剣ガルシオ', '武器', '片手剣', null, 4, 'E', 30),
  ('4E:両手剣', '海竜牙の大剣', '武器', '両手剣', null, 4, 'E', 30),
  ('4E:斧', '鉄鋏斧', '武器', '斧', null, 4, 'E', 30),
  ('4E:槍', '海蛇の銛', '武器', '槍', null, 4, 'E', 30),
  ('4E:鈍器', '大渦の鎚', '武器', '鈍器', null, 4, 'E', 30),
  ('4E:短剣', '人魚の短剣', '武器', '短剣', null, 4, 'E', 30),
  ('4E:拳', '大蟹拳', '武器', '拳', null, 4, 'E', 30),
  ('4E:弓', '暁歌の弓', '武器', '弓', null, 4, 'E', 30),
  ('4E:銃', 'ブラックパウダー', '武器', '銃', null, 4, 'E', 30),
  ('4E:杖', 'サーペントロッド', '武器', '杖', null, 4, 'E', 30),
  ('4E:書', '宝の地図', '武器', '書', null, 4, 'E', 30),
  ('4E:投擲', '提灯玉', '武器', '投擲', null, 4, 'E', 30),
  ('4E:刀', '海竜切り', '武器', '刀', null, 4, 'E', 30),
  ('4E:宝珠', 'ランタンオーブ', '武器', '宝珠', null, 4, 'E', 30),
  ('4E:重鎧頭', '珊瑚騎士の兜', '頭', '重鎧', '重鎧', 4, 'E', 30),
  ('4E:重鎧鎧', '珊瑚騎士の鎧', '鎧', '重鎧', '重鎧', 4, 'E', 30),
  ('4E:重鎧腕', '珊瑚騎士の篭手', '腕', '重鎧', '重鎧', 4, 'E', 30),
  ('4E:重鎧足', '珊瑚騎士の具足', '足', '重鎧', '重鎧', 4, 'E', 30),
  ('4E:軽装頭', 'セイレーンティアラ', '頭', '軽装', '軽装', 4, 'E', 30),
  ('4E:軽装鎧', 'セイレーンドレス', '鎧', '軽装', '軽装', 4, 'E', 30),
  ('4E:軽装腕', 'セイレーングローブ', '腕', '軽装', '軽装', 4, 'E', 30),
  ('4E:軽装足', 'セイレーンサンダル', '足', '軽装', '軽装', 4, 'E', 30),
  ('4E:リング', '船長の髑髏指輪', 'アクセ', 'リング', null, 4, 'E', 30),
  ('4E:イヤリング', '暁の真珠', 'アクセ', 'イヤリング', null, 4, 'E', 30),
  ('4E:ベルト', '大蟹の甲帯', 'アクセ', 'ベルト', null, 4, 'E', 30),
  ('4E:ネックレス', '深海の灯', 'アクセ', 'ネックレス', null, 4, 'E', 30),
  ('4L:片手剣', 'キャプテンズレガシー', '武器', '片手剣', null, 4, 'L', 35),
  ('4L:両手剣', '大海嘯', '武器', '両手剣', null, 4, 'L', 35),
  ('4L:斧', 'アイアンシザー', '武器', '斧', null, 4, 'L', 35),
  ('4L:槍', '蒼海槍アズール', '武器', '槍', null, 4, 'L', 35),
  ('4L:鈍器', '幽霊船の錨', '武器', '鈍器', null, 4, 'L', 35),
  ('4L:短剣', 'セブンシーズ', '武器', '短剣', null, 4, 'L', 35),
  ('4L:拳', '甲殻王の拳', '武器', '拳', null, 4, 'L', 35),
  ('4L:弓', '竜宮の弓', '武器', '弓', null, 4, 'L', 35),
  ('4L:銃', 'ブロードサイド', '武器', '銃', null, 4, 'L', 35),
  ('4L:杖', '潮の王杖', '武器', '杖', null, 4, 'L', 35),
  ('4L:書', '伝説の海図', '武器', '書', null, 4, 'L', 35),
  ('4L:投擲', '潮騒の戦輪', '武器', '投擲', null, 4, 'L', 35),
  ('4L:刀', '波切', '武器', '刀', null, 4, 'L', 35),
  ('4L:宝珠', '如意宝珠', '武器', '宝珠', null, 4, 'L', 35),
  ('4L:重鎧頭', '鉄甲の兜', '頭', '重鎧', '重鎧', 4, 'L', 35),
  ('4L:重鎧鎧', '鉄甲の鎧', '鎧', '重鎧', '重鎧', 4, 'L', 35),
  ('4L:重鎧腕', '鉄甲の篭手', '腕', '重鎧', '重鎧', 4, 'L', 35),
  ('4L:重鎧足', '鉄甲の具足', '足', '重鎧', '重鎧', 4, 'L', 35),
  ('4L:軽装頭', 'キャプテンハット', '頭', '軽装', '軽装', 4, 'L', 35),
  ('4L:軽装鎧', 'キャプテンコート', '鎧', '軽装', '軽装', 4, 'L', 35),
  ('4L:軽装腕', 'キャプテングローブ', '腕', '軽装', '軽装', 4, 'L', 35),
  ('4L:軽装足', 'キャプテンブーツ', '足', '軽装', '軽装', 4, 'L', 35),
  ('4L:リング', '宝島の指輪', 'アクセ', 'リング', null, 4, 'L', 35),
  ('4L:イヤリング', 'サーペントスケイル', 'アクセ', 'イヤリング', null, 4, 'L', 35),
  ('4L:ベルト', '海神の帯', 'アクセ', 'ベルト', null, 4, 'L', 35),
  ('4L:ネックレス', '人魚姫の真珠', 'アクセ', 'ネックレス', null, 4, 'L', 35),
  ('5N:片手剣', 'コバルトソード', '武器', '片手剣', null, 5, 'N', 25),
  ('5N:両手剣', 'コバルトクレイモア', '武器', '両手剣', null, 5, 'N', 25),
  ('5N:斧', 'コバルトアクス', '武器', '斧', null, 5, 'N', 25),
  ('5N:槍', 'コバルトスピア', '武器', '槍', null, 5, 'N', 25),
  ('5N:鈍器', 'コバルトメイス', '武器', '鈍器', null, 5, 'N', 25),
  ('5N:短剣', 'コバルトダガー', '武器', '短剣', null, 5, 'N', 25),
  ('5N:拳', 'コバルトナックル', '武器', '拳', null, 5, 'N', 25),
  ('5N:弓', 'エボニーボウ', '武器', '弓', null, 5, 'N', 25),
  ('5N:銃', 'カービン', '武器', '銃', null, 5, 'N', 25),
  ('5N:杖', 'エボニースタッフ', '武器', '杖', null, 5, 'N', 25),
  ('5N:書', '秘伝書', '武器', '書', null, 5, 'N', 25),
  ('5N:投擲', 'コバルトチャクラム', '武器', '投擲', null, 5, 'N', 25),
  ('5N:刀', 'コバルトカタナ', '武器', '刀', null, 5, 'N', 25),
  ('5N:宝珠', 'トパーズオーブ', '武器', '宝珠', null, 5, 'N', 25),
  ('5N:重鎧頭', 'コバルトヘルム', '頭', '重鎧', '重鎧', 5, 'N', 25),
  ('5N:重鎧鎧', 'コバルトメイル', '鎧', '重鎧', '重鎧', 5, 'N', 25),
  ('5N:重鎧腕', 'コバルトガントレット', '腕', '重鎧', '重鎧', 5, 'N', 25),
  ('5N:重鎧足', 'コバルトグリーヴ', '足', '重鎧', '重鎧', 5, 'N', 25),
  ('5N:軽装頭', 'リザードフード', '頭', '軽装', '軽装', 5, 'N', 25),
  ('5N:軽装鎧', 'リザードコート', '鎧', '軽装', '軽装', 5, 'N', 25),
  ('5N:軽装腕', 'リザードグローブ', '腕', '軽装', '軽装', 5, 'N', 25),
  ('5N:軽装足', 'リザードブーツ', '足', '軽装', '軽装', 5, 'N', 25),
  ('5N:リング', 'トパーズリング', 'アクセ', 'リング', null, 5, 'N', 25),
  ('5N:イヤリング', 'トパーズイヤリング', 'アクセ', 'イヤリング', null, 5, 'N', 25),
  ('5N:ベルト', 'トパーズベルト', 'アクセ', 'ベルト', null, 5, 'N', 25),
  ('5N:ネックレス', 'トパーズネックレス', 'アクセ', 'ネックレス', null, 5, 'N', 25),
  ('5R:片手剣', '陽炎のシャムシール', '武器', '片手剣', null, 5, 'R', 30),
  ('5R:両手剣', '砂皇の大剣', '武器', '両手剣', null, 5, 'R', 30),
  ('5R:斧', 'アヌビスの戦斧', '武器', '斧', null, 5, 'R', 30),
  ('5R:槍', '蠍尾の槍', '武器', '槍', null, 5, 'R', 30),
  ('5R:鈍器', 'ファラオセプター', '武器', '鈍器', null, 5, 'R', 30),
  ('5R:短剣', '砂蠍の毒針', '武器', '短剣', null, 5, 'R', 30),
  ('5R:拳', 'ジャッカルクロー', '武器', '拳', null, 5, 'R', 30),
  ('5R:弓', 'ミラージュボウ', '武器', '弓', null, 5, 'R', 30),
  ('5R:銃', '熱砂の長銃', '武器', '銃', null, 5, 'R', 30),
  ('5R:杖', 'アンクスタッフ', '武器', '杖', null, 5, 'R', 30),
  ('5R:書', '死者の書', '武器', '書', null, 5, 'R', 30),
  ('5R:投擲', '黄金日輪', '武器', '投擲', null, 5, 'R', 30),
  ('5R:刀', '砂紋の刀', '武器', '刀', null, 5, 'R', 30),
  ('5R:宝珠', '蜃気楼の珠', '武器', '宝珠', null, 5, 'R', 30),
  ('5R:重鎧頭', 'スカラベヘルム', '頭', '重鎧', '重鎧', 5, 'R', 30),
  ('5R:重鎧鎧', 'スカラベアーマー', '鎧', '重鎧', '重鎧', 5, 'R', 30),
  ('5R:重鎧腕', 'スカラベガントレット', '腕', '重鎧', '重鎧', 5, 'R', 30),
  ('5R:重鎧足', 'スカラベグリーヴ', '足', '重鎧', '重鎧', 5, 'R', 30),
  ('5R:軽装頭', '砂塵の頭巾', '頭', '軽装', '軽装', 5, 'R', 30),
  ('5R:軽装鎧', '砂塵の長衣', '鎧', '軽装', '軽装', 5, 'R', 30),
  ('5R:軽装腕', '砂塵の手袋', '腕', '軽装', '軽装', 5, 'R', 30),
  ('5R:軽装足', '砂塵の靴', '足', '軽装', '軽装', 5, 'R', 30),
  ('5R:リング', '王家の紋章指輪', 'アクセ', 'リング', null, 5, 'R', 30),
  ('5R:イヤリング', '月砂の耳飾り', 'アクセ', 'イヤリング', null, 5, 'R', 30),
  ('5R:ベルト', '王墓の飾り帯', 'アクセ', 'ベルト', null, 5, 'R', 30),
  ('5R:ネックレス', 'ウジャトの首飾り', 'アクセ', 'ネックレス', null, 5, 'R', 30),
  ('5E:片手剣', '砂皇剣スカラベウス', '武器', '片手剣', null, 5, 'E', 35),
  ('5E:両手剣', 'ゴールデンファラオ', '武器', '両手剣', null, 5, 'E', 35),
  ('5E:斧', '冥府の大斧', '武器', '斧', null, 5, 'E', 35),
  ('5E:槍', '蟻地獄の顎槍', '武器', '槍', null, 5, 'E', 35),
  ('5E:鈍器', '神官長の聖鎚', '武器', '鈍器', null, 5, 'E', 35),
  ('5E:短剣', '月影の短剣', '武器', '短剣', null, 5, 'E', 35),
  ('5E:拳', 'ワームファング', '武器', '拳', null, 5, 'E', 35),
  ('5E:弓', '砂嵐の弓', '武器', '弓', null, 5, 'E', 35),
  ('5E:銃', '砂皇の黄金銃', '武器', '銃', null, 5, 'E', 35),
  ('5E:杖', 'アヌビスの天秤杖', '武器', '杖', null, 5, 'E', 35),
  ('5E:書', '冥界審判の書', '武器', '書', null, 5, 'E', 35),
  ('5E:投擲', '蜃気楼の刃', '武器', '投擲', null, 5, 'E', 35),
  ('5E:刀', '月牙刀', '武器', '刀', null, 5, 'E', 35),
  ('5E:宝珠', '冥炎の宝珠', '武器', '宝珠', null, 5, 'E', 35),
  ('5E:重鎧頭', '黄金王の兜', '頭', '重鎧', '重鎧', 5, 'E', 35),
  ('5E:重鎧鎧', '黄金王の鎧', '鎧', '重鎧', '重鎧', 5, 'E', 35),
  ('5E:重鎧腕', '黄金王の篭手', '腕', '重鎧', '重鎧', 5, 'E', 35),
  ('5E:重鎧足', '黄金王の具足', '足', '重鎧', '重鎧', 5, 'E', 35),
  ('5E:軽装頭', 'ミラージュターバン', '頭', '軽装', '軽装', 5, 'E', 35),
  ('5E:軽装鎧', 'ミラージュローブ', '鎧', '軽装', '軽装', 5, 'E', 35),
  ('5E:軽装腕', 'ミラージュグローブ', '腕', '軽装', '軽装', 5, 'E', 35),
  ('5E:軽装足', 'ミラージュサンダル', '足', '軽装', '軽装', 5, 'E', 35),
  ('5E:リング', '聖甲虫の指輪', 'アクセ', 'リング', null, 5, 'E', 35),
  ('5E:イヤリング', '月牙のピアス', 'アクセ', 'イヤリング', null, 5, 'E', 35),
  ('5E:ベルト', '大神官の聖帯', 'アクセ', 'ベルト', null, 5, 'E', 35),
  ('5E:ネックレス', '蟻地獄の琥珀', 'アクセ', 'ネックレス', null, 5, 'E', 35),
  ('5L:片手剣', '日輪剣ソル', '武器', '片手剣', null, 5, 'L', 40),
  ('5L:両手剣', '天地開闢', '武器', '両手剣', null, 5, 'L', 40),
  ('5L:斧', '審判の斧', '武器', '斧', null, 5, 'L', 40),
  ('5L:槍', 'クイックサンド', '武器', '槍', null, 5, 'L', 40),
  ('5L:鈍器', '神の天秤', '武器', '鈍器', null, 5, 'L', 40),
  ('5L:短剣', '呪刃ネフティス', '武器', '短剣', null, 5, 'L', 40),
  ('5L:拳', '黄金甲拳', '武器', '拳', null, 5, 'L', 40),
  ('5L:弓', '砂海弓', '武器', '弓', null, 5, 'L', 40),
  ('5L:銃', 'サンバースト', '武器', '銃', null, 5, 'L', 40),
  ('5L:杖', '冥界の鍵杖', '武器', '杖', null, 5, 'L', 40),
  ('5L:書', '太陽神の聖典', '武器', '書', null, 5, 'L', 40),
  ('5L:投擲', 'ホルスの翼', '武器', '投擲', null, 5, 'L', 40),
  ('5L:刀', '月下美人', '武器', '刀', null, 5, 'L', 40),
  ('5L:宝珠', '太陽の眼', '武器', '宝珠', null, 5, 'L', 40),
  ('5L:重鎧頭', 'ファラオクラウン', '頭', '重鎧', '重鎧', 5, 'L', 40),
  ('5L:重鎧鎧', 'ファラオアーマー', '鎧', '重鎧', '重鎧', 5, 'L', 40),
  ('5L:重鎧腕', 'ファラオガントレット', '腕', '重鎧', '重鎧', 5, 'L', 40),
  ('5L:重鎧足', 'ファラオグリーヴ', '足', '重鎧', '重鎧', 5, 'L', 40),
  ('5L:軽装頭', '大神官の冠', '頭', '軽装', '軽装', 5, 'L', 40),
  ('5L:軽装鎧', '大神官の法衣', '鎧', '軽装', '軽装', 5, 'L', 40),
  ('5L:軽装腕', '大神官の手甲', '腕', '軽装', '軽装', 5, 'L', 40),
  ('5L:軽装足', '大神官の履', '足', '軽装', '軽装', 5, 'L', 40),
  ('5L:リング', '砂皇の神印', 'アクセ', 'リング', null, 5, 'L', 40),
  ('5L:イヤリング', '黄金の太陽', 'アクセ', 'イヤリング', null, 5, 'L', 40),
  ('5L:ベルト', '不死の帯', 'アクセ', 'ベルト', null, 5, 'L', 40),
  ('5L:ネックレス', '再生の護符', 'アクセ', 'ネックレス', null, 5, 'L', 40),
  ('6N:片手剣', 'ダマスカスソード', '武器', '片手剣', null, 6, 'N', 30),
  ('6N:両手剣', 'ダマスカスクレイモア', '武器', '両手剣', null, 6, 'N', 30),
  ('6N:斧', 'ダマスカスアクス', '武器', '斧', null, 6, 'N', 30),
  ('6N:槍', 'ダマスカススピア', '武器', '槍', null, 6, 'N', 30),
  ('6N:鈍器', 'ダマスカスメイス', '武器', '鈍器', null, 6, 'N', 30),
  ('6N:短剣', 'ダマスカスダガー', '武器', '短剣', null, 6, 'N', 30),
  ('6N:拳', 'ダマスカスナックル', '武器', '拳', null, 6, 'N', 30),
  ('6N:弓', 'エルダーボウ', '武器', '弓', null, 6, 'N', 30),
  ('6N:銃', 'リボルバー', '武器', '銃', null, 6, 'N', 30),
  ('6N:杖', 'エルダースタッフ', '武器', '杖', null, 6, 'N', 30),
  ('6N:書', '魔導書', '武器', '書', null, 6, 'N', 30),
  ('6N:投擲', 'ダマスカスチャクラム', '武器', '投擲', null, 6, 'N', 30),
  ('6N:刀', 'ダマスカスカタナ', '武器', '刀', null, 6, 'N', 30),
  ('6N:宝珠', 'ガーネットオーブ', '武器', '宝珠', null, 6, 'N', 30),
  ('6N:重鎧頭', 'ダマスカスヘルム', '頭', '重鎧', '重鎧', 6, 'N', 30),
  ('6N:重鎧鎧', 'ダマスカスメイル', '鎧', '重鎧', '重鎧', 6, 'N', 30),
  ('6N:重鎧腕', 'ダマスカスガントレット', '腕', '重鎧', '重鎧', 6, 'N', 30),
  ('6N:重鎧足', 'ダマスカスグリーヴ', '足', '重鎧', '重鎧', 6, 'N', 30),
  ('6N:軽装頭', 'ワイバーンフード', '頭', '軽装', '軽装', 6, 'N', 30),
  ('6N:軽装鎧', 'ワイバーンコート', '鎧', '軽装', '軽装', 6, 'N', 30),
  ('6N:軽装腕', 'ワイバーングローブ', '腕', '軽装', '軽装', 6, 'N', 30),
  ('6N:軽装足', 'ワイバーンブーツ', '足', '軽装', '軽装', 6, 'N', 30),
  ('6N:リング', 'ガーネットリング', 'アクセ', 'リング', null, 6, 'N', 30),
  ('6N:イヤリング', 'ガーネットイヤリング', 'アクセ', 'イヤリング', null, 6, 'N', 30),
  ('6N:ベルト', 'ガーネットベルト', 'アクセ', 'ベルト', null, 6, 'N', 30),
  ('6N:ネックレス', 'ガーネットネックレス', 'アクセ', 'ネックレス', null, 6, 'N', 30),
  ('6R:片手剣', '疾風剣', '武器', '片手剣', null, 6, 'R', 35),
  ('6R:両手剣', 'トロールスレイヤー', '武器', '両手剣', null, 6, 'R', 35),
  ('6R:斧', '岩砕き斧', '武器', '斧', null, 6, 'R', 35),
  ('6R:槍', '峰突きの槍', '武器', '槍', null, 6, 'R', 35),
  ('6R:鈍器', '巨人の棍棒', '武器', '鈍器', null, 6, 'R', 35),
  ('6R:短剣', 'タロンダガー', '武器', '短剣', null, 6, 'R', 35),
  ('6R:拳', '剛猿の拳', '武器', '拳', null, 6, 'R', 35),
  ('6R:弓', '天衝く長弓', '武器', '弓', null, 6, 'R', 35),
  ('6R:銃', '鷹の目', '武器', '銃', null, 6, 'R', 35),
  ('6R:杖', 'クラウドピアサー', '武器', '杖', null, 6, 'R', 35),
  ('6R:書', '峰々の巡礼記', '武器', '書', null, 6, 'R', 35),
  ('6R:投擲', '風切り羽', '武器', '投擲', null, 6, 'R', 35),
  ('6R:刀', '山颪', '武器', '刀', null, 6, 'R', 35),
  ('6R:宝珠', '山彦の珠', '武器', '宝珠', null, 6, 'R', 35),
  ('6R:重鎧頭', '峠守の兜', '頭', '重鎧', '重鎧', 6, 'R', 35),
  ('6R:重鎧鎧', '峠守の鎧', '鎧', '重鎧', '重鎧', 6, 'R', 35),
  ('6R:重鎧腕', '峠守の篭手', '腕', '重鎧', '重鎧', 6, 'R', 35),
  ('6R:重鎧足', '峠守の具足', '足', '重鎧', '重鎧', 6, 'R', 35),
  ('6R:軽装頭', 'グリフォンフード', '頭', '軽装', '軽装', 6, 'R', 35),
  ('6R:軽装鎧', 'グリフォンジャケット', '鎧', '軽装', '軽装', 6, 'R', 35),
  ('6R:軽装腕', 'グリフォングローブ', '腕', '軽装', '軽装', 6, 'R', 35),
  ('6R:軽装足', 'グリフォンブーツ', '足', '軽装', '軽装', 6, 'R', 35),
  ('6R:リング', 'イーグルアイリング', 'アクセ', 'リング', null, 6, 'R', 35),
  ('6R:イヤリング', '風哭きの耳飾り', 'アクセ', 'イヤリング', null, 6, 'R', 35),
  ('6R:ベルト', 'クライマーベルト', 'アクセ', 'ベルト', null, 6, 'R', 35),
  ('6R:ネックレス', '熊爪の首飾り', 'アクセ', 'ネックレス', null, 6, 'R', 35),
  ('6E:片手剣', '暁竜の剣', '武器', '片手剣', null, 6, 'E', 40),
  ('6E:両手剣', '峠守の巨剣', '武器', '両手剣', null, 6, 'E', 40),
  ('6E:斧', '熊王の大斧', '武器', '斧', null, 6, 'E', 40),
  ('6E:槍', '雷鷲の嘴槍', '武器', '槍', null, 6, 'E', 40),
  ('6E:鈍器', 'マウンテンブレイカー', '武器', '鈍器', null, 6, 'E', 40),
  ('6E:短剣', '影猫の短剣', '武器', '短剣', null, 6, 'E', 40),
  ('6E:拳', '炎猿拳', '武器', '拳', null, 6, 'E', 40),
  ('6E:弓', '嵐翼の弓', '武器', '弓', null, 6, 'E', 40),
  ('6E:銃', '巨岩砲', '武器', '銃', null, 6, 'E', 40),
  ('6E:杖', '山霊の杖', '武器', '杖', null, 6, 'E', 40),
  ('6E:書', '巨人族の叙事詩', '武器', '書', null, 6, 'E', 40),
  ('6E:投擲', 'グリフォンの羽刃', '武器', '投擲', null, 6, 'E', 40),
  ('6E:刀', '岩砕き丸', '武器', '刀', null, 6, 'E', 40),
  ('6E:宝珠', '雷鷲の眼', '武器', '宝珠', null, 6, 'E', 40),
  ('6E:重鎧頭', 'グリズリーヘルム', '頭', '重鎧', '重鎧', 6, 'E', 40),
  ('6E:重鎧鎧', 'グリズリーメイル', '鎧', '重鎧', '重鎧', 6, 'E', 40),
  ('6E:重鎧腕', 'グリズリーガントレット', '腕', '重鎧', '重鎧', 6, 'E', 40),
  ('6E:重鎧足', 'グリズリーグリーヴ', '足', '重鎧', '重鎧', 6, 'E', 40),
  ('6E:軽装頭', '雷鷲の頭巾', '頭', '軽装', '軽装', 6, 'E', 40),
  ('6E:軽装鎧', '雷鷲の羽織', '鎧', '軽装', '軽装', 6, 'E', 40),
  ('6E:軽装腕', '雷鷲の手甲', '腕', '軽装', '軽装', 6, 'E', 40),
  ('6E:軽装足', '雷鷲の脚絆', '足', '軽装', '軽装', 6, 'E', 40),
  ('6E:リング', '山岳王の指輪', 'アクセ', 'リング', null, 6, 'E', 40),
  ('6E:イヤリング', '嵐の羽飾り', 'アクセ', 'イヤリング', null, 6, 'E', 40),
  ('6E:ベルト', '峠守の大帯', 'アクセ', 'ベルト', null, 6, 'E', 40),
  ('6E:ネックレス', '炎魂の首飾り', 'アクセ', 'ネックレス', null, 6, 'E', 40),
  ('6L:片手剣', '天翔剣', '武器', '片手剣', null, 6, 'L', 45),
  ('6L:両手剣', 'ギガントマキア', '武器', '両手剣', null, 6, 'L', 45),
  ('6L:斧', '大熊座', '武器', '斧', null, 6, 'L', 45),
  ('6L:槍', '天を衝く槍', '武器', '槍', null, 6, 'L', 45),
  ('6L:鈍器', '山崩し', '武器', '鈍器', null, 6, 'L', 45),
  ('6L:短剣', '峰嵐', '武器', '短剣', null, 6, 'L', 45),
  ('6L:拳', '剛熊拳', '武器', '拳', null, 6, 'L', 45),
  ('6L:弓', '天穿つ弓', '武器', '弓', null, 6, 'L', 45),
  ('6L:銃', '山鳴りの砲', '武器', '銃', null, 6, 'L', 45),
  ('6L:杖', '山神の杖', '武器', '杖', null, 6, 'L', 45),
  ('6L:書', '峰神の伝承', '武器', '書', null, 6, 'L', 45),
  ('6L:投擲', '雷羽輪', '武器', '投擲', null, 6, 'L', 45),
  ('6L:刀', '大天狗', '武器', '刀', null, 6, 'L', 45),
  ('6L:宝珠', '山神の御霊', '武器', '宝珠', null, 6, 'L', 45),
  ('6L:重鎧頭', '巨人王の兜', '頭', '重鎧', '重鎧', 6, 'L', 45),
  ('6L:重鎧鎧', '巨人王の鎧', '鎧', '重鎧', '重鎧', 6, 'L', 45),
  ('6L:重鎧腕', '巨人王の篭手', '腕', '重鎧', '重鎧', 6, 'L', 45),
  ('6L:重鎧足', '巨人王の具足', '足', '重鎧', '重鎧', 6, 'L', 45),
  ('6L:軽装頭', 'ゼファーフード', '頭', '軽装', '軽装', 6, 'L', 45),
  ('6L:軽装鎧', 'ゼファーコート', '鎧', '軽装', '軽装', 6, 'L', 45),
  ('6L:軽装腕', 'ゼファーグローブ', '腕', '軽装', '軽装', 6, 'L', 45),
  ('6L:軽装足', 'ゼファーブーツ', '足', '軽装', '軽装', 6, 'L', 45),
  ('6L:リング', '熊神の指輪', 'アクセ', 'リング', null, 6, 'L', 45),
  ('6L:イヤリング', '雷鷲の宝羽', 'アクセ', 'イヤリング', null, 6, 'L', 45),
  ('6L:ベルト', '巨人の鎖帯', 'アクセ', 'ベルト', null, 6, 'L', 45),
  ('6L:ネックレス', '山頂の星', 'アクセ', 'ネックレス', null, 6, 'L', 45),
  ('7N:片手剣', 'プラチナソード', '武器', '片手剣', null, 7, 'N', 35),
  ('7N:両手剣', 'プラチナクレイモア', '武器', '両手剣', null, 7, 'N', 35),
  ('7N:斧', 'プラチナアクス', '武器', '斧', null, 7, 'N', 35),
  ('7N:槍', 'プラチナスピア', '武器', '槍', null, 7, 'N', 35),
  ('7N:鈍器', 'プラチナメイス', '武器', '鈍器', null, 7, 'N', 35),
  ('7N:短剣', 'プラチナダガー', '武器', '短剣', null, 7, 'N', 35),
  ('7N:拳', 'プラチナナックル', '武器', '拳', null, 7, 'N', 35),
  ('7N:弓', 'トレントボウ', '武器', '弓', null, 7, 'N', 35),
  ('7N:銃', 'ライフル', '武器', '銃', null, 7, 'N', 35),
  ('7N:杖', 'トレントスタッフ', '武器', '杖', null, 7, 'N', 35),
  ('7N:書', '大魔導書', '武器', '書', null, 7, 'N', 35),
  ('7N:投擲', 'プラチナチャクラム', '武器', '投擲', null, 7, 'N', 35),
  ('7N:刀', 'プラチナカタナ', '武器', '刀', null, 7, 'N', 35),
  ('7N:宝珠', 'エメラルドオーブ', '武器', '宝珠', null, 7, 'N', 35),
  ('7N:重鎧頭', 'プラチナヘルム', '頭', '重鎧', '重鎧', 7, 'N', 35),
  ('7N:重鎧鎧', 'プラチナメイル', '鎧', '重鎧', '重鎧', 7, 'N', 35),
  ('7N:重鎧腕', 'プラチナガントレット', '腕', '重鎧', '重鎧', 7, 'N', 35),
  ('7N:重鎧足', 'プラチナグリーヴ', '足', '重鎧', '重鎧', 7, 'N', 35),
  ('7N:軽装頭', 'エルヴンフード', '頭', '軽装', '軽装', 7, 'N', 35),
  ('7N:軽装鎧', 'エルヴンコート', '鎧', '軽装', '軽装', 7, 'N', 35),
  ('7N:軽装腕', 'エルヴングローブ', '腕', '軽装', '軽装', 7, 'N', 35),
  ('7N:軽装足', 'エルヴンブーツ', '足', '軽装', '軽装', 7, 'N', 35),
  ('7N:リング', 'エメラルドリング', 'アクセ', 'リング', null, 7, 'N', 35),
  ('7N:イヤリング', 'エメラルドイヤリング', 'アクセ', 'イヤリング', null, 7, 'N', 35),
  ('7N:ベルト', 'エメラルドベルト', 'アクセ', 'ベルト', null, 7, 'N', 35),
  ('7N:ネックレス', 'エメラルドネックレス', 'アクセ', 'ネックレス', null, 7, 'N', 35),
  ('7R:片手剣', '黄昏の剣', '武器', '片手剣', null, 7, 'R', 40),
  ('7R:両手剣', 'ナイトフォール', '武器', '両手剣', null, 7, 'R', 40),
  ('7R:斧', 'ウッドイーター', '武器', '斧', null, 7, 'R', 40),
  ('7R:槍', 'ソーンランス', '武器', '槍', null, 7, 'R', 40),
  ('7R:鈍器', '樹王の棍', '武器', '鈍器', null, 7, 'R', 40),
  ('7R:短剣', '毒鱗の短剣', '武器', '短剣', null, 7, 'R', 40),
  ('7R:拳', 'ビートルホーン', '武器', '拳', null, 7, 'R', 40),
  ('7R:弓', '惑わしの弓', '武器', '弓', null, 7, 'R', 40),
  ('7R:銃', 'バンシーハウル', '武器', '銃', null, 7, 'R', 40),
  ('7R:杖', '霧魔女の杖', '武器', '杖', null, 7, 'R', 40),
  ('7R:書', '毒草図鑑', '武器', '書', null, 7, 'R', 40),
  ('7R:投擲', '胞子玉', '武器', '投擲', null, 7, 'R', 40),
  ('7R:刀', '宵闇丸', '武器', '刀', null, 7, 'R', 40),
  ('7R:宝珠', '惑い霧の珠', '武器', '宝珠', null, 7, 'R', 40),
  ('7R:重鎧頭', 'ブラックウッドヘルム', '頭', '重鎧', '重鎧', 7, 'R', 40),
  ('7R:重鎧鎧', 'ブラックウッドメイル', '鎧', '重鎧', '重鎧', 7, 'R', 40),
  ('7R:重鎧腕', 'ブラックウッドガントレット', '腕', '重鎧', '重鎧', 7, 'R', 40),
  ('7R:重鎧足', 'ブラックウッドグリーヴ', '足', '重鎧', '重鎧', 7, 'R', 40),
  ('7R:軽装頭', '常夜の頭巾', '頭', '軽装', '軽装', 7, 'R', 40),
  ('7R:軽装鎧', '常夜の外套', '鎧', '軽装', '軽装', 7, 'R', 40),
  ('7R:軽装腕', '常夜の手袋', '腕', '軽装', '軽装', 7, 'R', 40),
  ('7R:軽装足', '常夜の靴', '足', '軽装', '軽装', 7, 'R', 40),
  ('7R:リング', 'ピクシーリング', 'アクセ', 'リング', null, 7, 'R', 40),
  ('7R:イヤリング', '嘆きの耳飾り', 'アクセ', 'イヤリング', null, 7, 'R', 40),
  ('7R:ベルト', 'ルーツベルト', 'アクセ', 'ベルト', null, 7, 'R', 40),
  ('7R:ネックレス', 'マンドラゴラの護符', 'アクセ', 'ネックレス', null, 7, 'R', 40),
  ('7E:片手剣', 'エルダーブレード', '武器', '片手剣', null, 7, 'E', 45),
  ('7E:両手剣', 'マンイーター', '武器', '両手剣', null, 7, 'E', 45),
  ('7E:斧', '大樹喰らいの斧', '武器', '斧', null, 7, 'E', 45),
  ('7E:槍', '叫び根の槍', '武器', '槍', null, 7, 'E', 45),
  ('7E:鈍器', '森王の古枝', '武器', '鈍器', null, 7, 'E', 45),
  ('7E:短剣', '妖蛾の鱗刃', '武器', '短剣', null, 7, 'E', 45),
  ('7E:拳', '食人花の拳', '武器', '拳', null, 7, 'E', 45),
  ('7E:弓', 'ミルヴァの弓', '武器', '弓', null, 7, 'E', 45),
  ('7E:銃', 'シードキャノン', '武器', '銃', null, 7, 'E', 45),
  ('7E:杖', '絶叫の杖', '武器', '杖', null, 7, 'E', 45),
  ('7E:書', '霧魔女の秘録', '武器', '書', null, 7, 'E', 45),
  ('7E:投擲', '嘆きの輪', '武器', '投擲', null, 7, 'E', 45),
  ('7E:刀', '嘆きの太刀', '武器', '刀', null, 7, 'E', 45),
  ('7E:宝珠', '霧魔女の水晶球', '武器', '宝珠', null, 7, 'E', 45),
  ('7E:重鎧頭', '森王の兜', '頭', '重鎧', '重鎧', 7, 'E', 45),
  ('7E:重鎧鎧', '森王の鎧', '鎧', '重鎧', '重鎧', 7, 'E', 45),
  ('7E:重鎧腕', '森王の篭手', '腕', '重鎧', '重鎧', 7, 'E', 45),
  ('7E:重鎧足', '森王の具足', '足', '重鎧', '重鎧', 7, 'E', 45),
  ('7E:軽装頭', 'バンシーフード', '頭', '軽装', '軽装', 7, 'E', 45),
  ('7E:軽装鎧', 'バンシードレス', '鎧', '軽装', '軽装', 7, 'E', 45),
  ('7E:軽装腕', 'バンシーグローブ', '腕', '軽装', '軽装', 7, 'E', 45),
  ('7E:軽装足', 'バンシーブーツ', '足', '軽装', '軽装', 7, 'E', 45),
  ('7E:リング', 'サンライトリング', 'アクセ', 'リング', null, 7, 'E', 45),
  ('7E:イヤリング', 'モスウィングピアス', 'アクセ', 'イヤリング', null, 7, 'E', 45),
  ('7E:ベルト', '霧樹の帯', 'アクセ', 'ベルト', null, 7, 'E', 45),
  ('7E:ネックレス', '魔女の瞳', 'アクセ', 'ネックレス', null, 7, 'E', 45),
  ('7L:片手剣', '常夜剣ノクス', '武器', '片手剣', null, 7, 'L', 50),
  ('7L:両手剣', '百鬼夜行', '武器', '両手剣', null, 7, 'L', 50),
  ('7L:斧', '伐神斧', '武器', '斧', null, 7, 'L', 50),
  ('7L:槍', '千本棘', '武器', '槍', null, 7, 'L', 50),
  ('7L:鈍器', '年輪', '武器', '鈍器', null, 7, 'L', 50),
  ('7L:短剣', '胡蝶の夢', '武器', '短剣', null, 7, 'L', 50),
  ('7L:拳', '根源拳', '武器', '拳', null, 7, 'L', 50),
  ('7L:弓', '月無き夜の弓', '武器', '弓', null, 7, 'L', 50),
  ('7L:銃', 'ウィッチクラフト', '武器', '銃', null, 7, 'L', 50),
  ('7L:杖', '魔女王の杖', '武器', '杖', null, 7, 'L', 50),
  ('7L:書', '大魔典', '武器', '書', null, 7, 'L', 50),
  ('7L:投擲', 'メビウス', '武器', '投擲', null, 7, 'L', 50),
  ('7L:刀', '朧月', '武器', '刀', null, 7, 'L', 50),
  ('7L:宝珠', '夢見の珠', '武器', '宝珠', null, 7, 'L', 50),
  ('7L:重鎧頭', 'グリーンナイトヘルム', '頭', '重鎧', '重鎧', 7, 'L', 50),
  ('7L:重鎧鎧', 'グリーンナイトアーマー', '鎧', '重鎧', '重鎧', 7, 'L', 50),
  ('7L:重鎧腕', 'グリーンナイトガントレット', '腕', '重鎧', '重鎧', 7, 'L', 50),
  ('7L:重鎧足', 'グリーンナイトグリーヴ', '足', '重鎧', '重鎧', 7, 'L', 50),
  ('7L:軽装頭', '大魔女の三角帽', '頭', '軽装', '軽装', 7, 'L', 50),
  ('7L:軽装鎧', '大魔女の法衣', '鎧', '軽装', '軽装', 7, 'L', 50),
  ('7L:軽装腕', '大魔女の手袋', '腕', '軽装', '軽装', 7, 'L', 50),
  ('7L:軽装足', '大魔女の靴', '足', '軽装', '軽装', 7, 'L', 50),
  ('7L:リング', '夜の女王の指輪', 'アクセ', 'リング', null, 7, 'L', 50),
  ('7L:イヤリング', '夢幻の耳飾り', 'アクセ', 'イヤリング', null, 7, 'L', 50),
  ('7L:ベルト', '大樹の根帯', 'アクセ', 'ベルト', null, 7, 'L', 50),
  ('7L:ネックレス', '黒い月', 'アクセ', 'ネックレス', null, 7, 'L', 50),
  ('8N:片手剣', 'ミスリルソード', '武器', '片手剣', null, 8, 'N', 40),
  ('8N:両手剣', 'ミスリルクレイモア', '武器', '両手剣', null, 8, 'N', 40),
  ('8N:斧', 'ミスリルアクス', '武器', '斧', null, 8, 'N', 40),
  ('8N:槍', 'ミスリルスピア', '武器', '槍', null, 8, 'N', 40),
  ('8N:鈍器', 'ミスリルメイス', '武器', '鈍器', null, 8, 'N', 40),
  ('8N:短剣', 'ミスリルダガー', '武器', '短剣', null, 8, 'N', 40),
  ('8N:拳', 'ミスリルナックル', '武器', '拳', null, 8, 'N', 40),
  ('8N:弓', 'ミスリルボウ', '武器', '弓', null, 8, 'N', 40),
  ('8N:銃', 'ミスリルマグナム', '武器', '銃', null, 8, 'N', 40),
  ('8N:杖', 'ミスリルスタッフ', '武器', '杖', null, 8, 'N', 40),
  ('8N:書', '禁書', '武器', '書', null, 8, 'N', 40),
  ('8N:投擲', 'ミスリルチャクラム', '武器', '投擲', null, 8, 'N', 40),
  ('8N:刀', 'ミスリルカタナ', '武器', '刀', null, 8, 'N', 40),
  ('8N:宝珠', 'ムーンストーンオーブ', '武器', '宝珠', null, 8, 'N', 40),
  ('8N:重鎧頭', 'ミスリルヘルム', '頭', '重鎧', '重鎧', 8, 'N', 40),
  ('8N:重鎧鎧', 'ミスリルメイル', '鎧', '重鎧', '重鎧', 8, 'N', 40),
  ('8N:重鎧腕', 'ミスリルガントレット', '腕', '重鎧', '重鎧', 8, 'N', 40),
  ('8N:重鎧足', 'ミスリルグリーヴ', '足', '重鎧', '重鎧', 8, 'N', 40),
  ('8N:軽装頭', 'ミスリルフード', '頭', '軽装', '軽装', 8, 'N', 40),
  ('8N:軽装鎧', 'ミスリルコート', '鎧', '軽装', '軽装', 8, 'N', 40),
  ('8N:軽装腕', 'ミスリルグローブ', '腕', '軽装', '軽装', 8, 'N', 40),
  ('8N:軽装足', 'ミスリルブーツ', '足', '軽装', '軽装', 8, 'N', 40),
  ('8N:リング', 'ムーンストーンリング', 'アクセ', 'リング', null, 8, 'N', 40),
  ('8N:イヤリング', 'ムーンストーンイヤリング', 'アクセ', 'イヤリング', null, 8, 'N', 40),
  ('8N:ベルト', 'ムーンストーンベルト', 'アクセ', 'ベルト', null, 8, 'N', 40),
  ('8N:ネックレス', 'ムーンストーンネックレス', 'アクセ', 'ネックレス', null, 8, 'N', 40),
  ('8R:片手剣', 'フロストエッジ', '武器', '片手剣', null, 8, 'R', 45),
  ('8R:両手剣', '氷牙大剣', '武器', '両手剣', null, 8, 'R', 45),
  ('8R:斧', 'アバランチ', '武器', '斧', null, 8, 'R', 45),
  ('8R:槍', '樹氷の槍', '武器', '槍', null, 8, 'R', 45),
  ('8R:鈍器', '氷塊の鎚', '武器', '鈍器', null, 8, 'R', 45),
  ('8R:短剣', 'つらら刺し', '武器', '短剣', null, 8, 'R', 45),
  ('8R:拳', '雪豹の爪', '武器', '拳', null, 8, 'R', 45),
  ('8R:弓', '銀嶺の弓', '武器', '弓', null, 8, 'R', 45),
  ('8R:銃', '氷結砲', '武器', '銃', null, 8, 'R', 45),
  ('8R:杖', '霊峰の錫杖', '武器', '杖', null, 8, 'R', 45),
  ('8R:書', '凍れる魔導書', '武器', '書', null, 8, 'R', 45),
  ('8R:投擲', '六花の飛刃', '武器', '投擲', null, 8, 'R', 45),
  ('8R:刀', '霜月', '武器', '刀', null, 8, 'R', 45),
  ('8R:宝珠', '氷晶球', '武器', '宝珠', null, 8, 'R', 45),
  ('8R:重鎧頭', 'グレイシアヘルム', '頭', '重鎧', '重鎧', 8, 'R', 45),
  ('8R:重鎧鎧', 'グレイシアメイル', '鎧', '重鎧', '重鎧', 8, 'R', 45),
  ('8R:重鎧腕', 'グレイシアガントレット', '腕', '重鎧', '重鎧', 8, 'R', 45),
  ('8R:重鎧足', 'グレイシアグリーヴ', '足', '重鎧', '重鎧', 8, 'R', 45),
  ('8R:軽装頭', '白狼頭巾', '頭', '軽装', '軽装', 8, 'R', 45),
  ('8R:軽装鎧', '白狼の外套', '鎧', '軽装', '軽装', 8, 'R', 45),
  ('8R:軽装腕', '白狼の手袋', '腕', '軽装', '軽装', 8, 'R', 45),
  ('8R:軽装足', '白狼の雪靴', '足', '軽装', '軽装', 8, 'R', 45),
  ('8R:リング', '極光の指輪', 'アクセ', 'リング', null, 8, 'R', 45),
  ('8R:イヤリング', 'スノーフレークピアス', 'アクセ', 'イヤリング', null, 8, 'R', 45),
  ('8R:ベルト', 'マンモスベルト', 'アクセ', 'ベルト', null, 8, 'R', 45),
  ('8R:ネックレス', '白霊のロザリオ', 'アクセ', 'ネックレス', null, 8, 'R', 45),
  ('8E:片手剣', '氷霊剣フロストバーン', '武器', '片手剣', null, 8, 'E', 50),
  ('8E:両手剣', '氷竜の大剣', '武器', '両手剣', null, 8, 'E', 50),
  ('8E:斧', '雪王の大斧', '武器', '斧', null, 8, 'E', 50),
  ('8E:槍', 'マンモスタスク', '武器', '槍', null, 8, 'E', 50),
  ('8E:鈍器', '晶獣の鎚', '武器', '鈍器', null, 8, 'E', 50),
  ('8E:短剣', 'ブリザードファング', '武器', '短剣', null, 8, 'E', 50),
  ('8E:拳', 'イエティフィスト', '武器', '拳', null, 8, 'E', 50),
  ('8E:弓', 'ダイヤモンドダスト', '武器', '弓', null, 8, 'E', 50),
  ('8E:銃', '氷葬砲', '武器', '銃', null, 8, 'E', 50),
  ('8E:杖', '屍王の錫杖', '武器', '杖', null, 8, 'E', 50),
  ('8E:書', '氷霊の祝詞', '武器', '書', null, 8, 'E', 50),
  ('8E:投擲', '雪華晶', '武器', '投擲', null, 8, 'E', 50),
  ('8E:刀', '吹雪丸', '武器', '刀', null, 8, 'E', 50),
  ('8E:宝珠', 'グラキエスの晶核', '武器', '宝珠', null, 8, 'E', 50),
  ('8E:重鎧頭', '氷竜の兜', '頭', '重鎧', '重鎧', 8, 'E', 50),
  ('8E:重鎧鎧', '氷竜の鎧', '鎧', '重鎧', '重鎧', 8, 'E', 50),
  ('8E:重鎧腕', '氷竜の篭手', '腕', '重鎧', '重鎧', 8, 'E', 50),
  ('8E:重鎧足', '氷竜の具足', '足', '重鎧', '重鎧', 8, 'E', 50),
  ('8E:軽装頭', 'ドライアドフード', '頭', '軽装', '軽装', 8, 'E', 50),
  ('8E:軽装鎧', 'ドライアドドレス', '鎧', '軽装', '軽装', 8, 'E', 50),
  ('8E:軽装腕', 'ドライアドグローブ', '腕', '軽装', '軽装', 8, 'E', 50),
  ('8E:軽装足', 'ドライアドブーツ', '足', '軽装', '軽装', 8, 'E', 50),
  ('8E:リング', '凍てた王の指輪', 'アクセ', 'リング', null, 8, 'E', 50),
  ('8E:イヤリング', 'グラキエスの涙晶', 'アクセ', 'イヤリング', null, 8, 'E', 50),
  ('8E:ベルト', '雪王の腰帯', 'アクセ', 'ベルト', null, 8, 'E', 50),
  ('8E:ネックレス', 'フロストハート', 'アクセ', 'ネックレス', null, 8, 'E', 50),
  ('8L:片手剣', '明鏡止水', '武器', '片手剣', null, 8, 'L', 55),
  ('8L:両手剣', '永久凍土', '武器', '両手剣', null, 8, 'L', 55),
  ('8L:斧', '氷河期', '武器', '斧', null, 8, 'L', 55),
  ('8L:槍', '絶対零度', '武器', '槍', null, 8, 'L', 55),
  ('8L:鈍器', '氷晶王の鎚', '武器', '鈍器', null, 8, 'L', 55),
  ('8L:短剣', '冬の吐息', '武器', '短剣', null, 8, 'L', 55),
  ('8L:拳', '牙王拳', '武器', '拳', null, 8, 'L', 55),
  ('8L:弓', '白夜の弓', '武器', '弓', null, 8, 'L', 55),
  ('8L:銃', 'コキュートス', '武器', '銃', null, 8, 'L', 55),
  ('8L:杖', '雪神の杖', '武器', '杖', null, 8, 'L', 55),
  ('8L:書', '白き神の預言書', '武器', '書', null, 8, 'L', 55),
  ('8L:投擲', '結晶星', '武器', '投擲', null, 8, 'L', 55),
  ('8L:刀', '雪月花', '武器', '刀', null, 8, 'L', 55),
  ('8L:宝珠', '白銀の月', '武器', '宝珠', null, 8, 'L', 55),
  ('8L:重鎧頭', '氷河王の兜', '頭', '重鎧', '重鎧', 8, 'L', 55),
  ('8L:重鎧鎧', '氷河王の鎧', '鎧', '重鎧', '重鎧', 8, 'L', 55),
  ('8L:重鎧腕', '氷河王の篭手', '腕', '重鎧', '重鎧', 8, 'L', 55),
  ('8L:重鎧足', '氷河王の具足', '足', '重鎧', '重鎧', 8, 'L', 55),
  ('8L:軽装頭', 'スノークイーンティアラ', '頭', '軽装', '軽装', 8, 'L', 55),
  ('8L:軽装鎧', 'スノークイーンドレス', '鎧', '軽装', '軽装', 8, 'L', 55),
  ('8L:軽装腕', 'スノークイーングローブ', '腕', '軽装', '軽装', 8, 'L', 55),
  ('8L:軽装足', 'スノークイーンブーツ', '足', '軽装', '軽装', 8, 'L', 55),
  ('8L:リング', '雪華の契り', 'アクセ', 'リング', null, 8, 'L', 55),
  ('8L:イヤリング', 'フロストバーンの涙', 'アクセ', 'イヤリング', null, 8, 'L', 55),
  ('8L:ベルト', 'マンモスの王帯', 'アクセ', 'ベルト', null, 8, 'L', 55),
  ('8L:ネックレス', '雪解けの雫', 'アクセ', 'ネックレス', null, 8, 'L', 55),
  ('9N:片手剣', 'ルーンソード', '武器', '片手剣', null, 9, 'N', 45),
  ('9N:両手剣', 'ルーンクレイモア', '武器', '両手剣', null, 9, 'N', 45),
  ('9N:斧', 'ルーンアクス', '武器', '斧', null, 9, 'N', 45),
  ('9N:槍', 'ルーンスピア', '武器', '槍', null, 9, 'N', 45),
  ('9N:鈍器', 'ルーンメイス', '武器', '鈍器', null, 9, 'N', 45),
  ('9N:短剣', 'ルーンダガー', '武器', '短剣', null, 9, 'N', 45),
  ('9N:拳', 'ルーンナックル', '武器', '拳', null, 9, 'N', 45),
  ('9N:弓', 'ルーンボウ', '武器', '弓', null, 9, 'N', 45),
  ('9N:銃', 'ルーンマグナム', '武器', '銃', null, 9, 'N', 45),
  ('9N:杖', 'ルーンスタッフ', '武器', '杖', null, 9, 'N', 45),
  ('9N:書', '封印書', '武器', '書', null, 9, 'N', 45),
  ('9N:投擲', 'ルーンチャクラム', '武器', '投擲', null, 9, 'N', 45),
  ('9N:刀', 'ルーンカタナ', '武器', '刀', null, 9, 'N', 45),
  ('9N:宝珠', 'トルマリンオーブ', '武器', '宝珠', null, 9, 'N', 45),
  ('9N:重鎧頭', 'ルーンヘルム', '頭', '重鎧', '重鎧', 9, 'N', 45),
  ('9N:重鎧鎧', 'ルーンメイル', '鎧', '重鎧', '重鎧', 9, 'N', 45),
  ('9N:重鎧腕', 'ルーンガントレット', '腕', '重鎧', '重鎧', 9, 'N', 45),
  ('9N:重鎧足', 'ルーングリーヴ', '足', '重鎧', '重鎧', 9, 'N', 45),
  ('9N:軽装頭', 'ルーンフード', '頭', '軽装', '軽装', 9, 'N', 45),
  ('9N:軽装鎧', 'ルーンコート', '鎧', '軽装', '軽装', 9, 'N', 45),
  ('9N:軽装腕', 'ルーングローブ', '腕', '軽装', '軽装', 9, 'N', 45),
  ('9N:軽装足', 'ルーンブーツ', '足', '軽装', '軽装', 9, 'N', 45),
  ('9N:リング', 'トルマリンリング', 'アクセ', 'リング', null, 9, 'N', 45),
  ('9N:イヤリング', 'トルマリンイヤリング', 'アクセ', 'イヤリング', null, 9, 'N', 45),
  ('9N:ベルト', 'トルマリンベルト', 'アクセ', 'ベルト', null, 9, 'N', 45),
  ('9N:ネックレス', 'トルマリンネックレス', 'アクセ', 'ネックレス', null, 9, 'N', 45),
  ('9R:片手剣', '紫電の剣', '武器', '片手剣', null, 9, 'R', 50),
  ('9R:両手剣', 'サンダーボルト', '武器', '両手剣', null, 9, 'R', 50),
  ('9R:斧', '轟雷の戦斧', '武器', '斧', null, 9, 'R', 50),
  ('9R:槍', 'ボルトランス', '武器', '槍', null, 9, 'R', 50),
  ('9R:鈍器', '雷神の鎚', '武器', '鈍器', null, 9, 'R', 50),
  ('9R:短剣', 'フラッシュナイフ', '武器', '短剣', null, 9, 'R', 50),
  ('9R:拳', '雷爪', '武器', '拳', null, 9, 'R', 50),
  ('9R:弓', '嵐鳥の弓', '武器', '弓', null, 9, 'R', 50),
  ('9R:銃', 'スパークショット', '武器', '銃', null, 9, 'R', 50),
  ('9R:杖', 'ライトニングロッド', '武器', '杖', null, 9, 'R', 50),
  ('9R:書', '雷帝の勅書', '武器', '書', null, 9, 'R', 50),
  ('9R:投擲', '閃光輪', '武器', '投擲', null, 9, 'R', 50),
  ('9R:刀', '稲妻丸', '武器', '刀', null, 9, 'R', 50),
  ('9R:宝珠', '雷玉', '武器', '宝珠', null, 9, 'R', 50),
  ('9R:重鎧頭', 'テンペストヘルム', '頭', '重鎧', '重鎧', 9, 'R', 50),
  ('9R:重鎧鎧', 'テンペストメイル', '鎧', '重鎧', '重鎧', 9, 'R', 50),
  ('9R:重鎧腕', 'テンペストガントレット', '腕', '重鎧', '重鎧', 9, 'R', 50),
  ('9R:重鎧足', 'テンペストグリーヴ', '足', '重鎧', '重鎧', 9, 'R', 50),
  ('9R:軽装頭', '雷雲の頭巾', '頭', '軽装', '軽装', 9, 'R', 50),
  ('9R:軽装鎧', '雷雲の羽衣', '鎧', '軽装', '軽装', 9, 'R', 50),
  ('9R:軽装腕', '雷雲の手袋', '腕', '軽装', '軽装', 9, 'R', 50),
  ('9R:軽装足', '雷雲の靴', '足', '軽装', '軽装', 9, 'R', 50),
  ('9R:リング', '帯電の指輪', 'アクセ', 'リング', null, 9, 'R', 50),
  ('9R:イヤリング', 'ヒポグリフフェザー', 'アクセ', 'イヤリング', null, 9, 'R', 50),
  ('9R:ベルト', 'ギガースの腰帯', 'アクセ', 'ベルト', null, 9, 'R', 50),
  ('9R:ネックレス', '鵺の鈴', 'アクセ', 'ネックレス', null, 9, 'R', 50),
  ('9E:片手剣', '雷帝剣ケラウノス', '武器', '片手剣', null, 9, 'E', 55),
  ('9E:両手剣', '巨神の大剣', '武器', '両手剣', null, 9, 'E', 55),
  ('9E:斧', '雷竜の尾斧', '武器', '斧', null, 9, 'E', 55),
  ('9E:槍', '鵺尾の槍', '武器', '槍', null, 9, 'E', 55),
  ('9E:鈍器', 'ギガースの雷槌', '武器', '鈍器', null, 9, 'E', 55),
  ('9E:短剣', 'ストームタロン', '武器', '短剣', null, 9, 'E', 55),
  ('9E:拳', '轟拳', '武器', '拳', null, 9, 'E', 55),
  ('9E:弓', '天鳴の弓', '武器', '弓', null, 9, 'E', 55),
  ('9E:銃', '雷霆砲', '武器', '銃', null, 9, 'E', 55),
  ('9E:杖', '嵐呼びの杖', '武器', '杖', null, 9, 'E', 55),
  ('9E:書', '嵐神の叙事詩', '武器', '書', null, 9, 'E', 55),
  ('9E:投擲', 'テンペストフェザー', '武器', '投擲', null, 9, 'E', 55),
  ('9E:刀', '鵺切り', '武器', '刀', null, 9, 'E', 55),
  ('9E:宝珠', '雷精の宝珠', '武器', '宝珠', null, 9, 'E', 55),
  ('9E:重鎧頭', '雷帝の兜', '頭', '重鎧', '重鎧', 9, 'E', 55),
  ('9E:重鎧鎧', '雷帝の鎧', '鎧', '重鎧', '重鎧', 9, 'E', 55),
  ('9E:重鎧腕', '雷帝の篭手', '腕', '重鎧', '重鎧', 9, 'E', 55),
  ('9E:重鎧足', '雷帝の具足', '足', '重鎧', '重鎧', 9, 'E', 55),
  ('9E:軽装頭', 'ライトニングフード', '頭', '軽装', '軽装', 9, 'E', 55),
  ('9E:軽装鎧', 'ライトニングコート', '鎧', '軽装', '軽装', 9, 'E', 55),
  ('9E:軽装腕', 'ライトニンググローブ', '腕', '軽装', '軽装', 9, 'E', 55),
  ('9E:軽装足', 'ライトニングブーツ', '足', '軽装', '軽装', 9, 'E', 55),
  ('9E:リング', '鵺眼の指輪', 'アクセ', 'リング', null, 9, 'E', 55),
  ('9E:イヤリング', '雷鳴のピアス', 'アクセ', 'イヤリング', null, 9, 'E', 55),
  ('9E:ベルト', 'ギガースベルト', 'アクセ', 'ベルト', null, 9, 'E', 55),
  ('9E:ネックレス', '雷精の核', 'アクセ', 'ネックレス', null, 9, 'E', 55),
  ('9L:片手剣', '疾風迅雷', '武器', '片手剣', null, 9, 'L', 60),
  ('9L:両手剣', '裁きの雷', '武器', '両手剣', null, 9, 'L', 60),
  ('9L:斧', '天割り', '武器', '斧', null, 9, 'L', 60),
  ('9L:槍', '鳴神', '武器', '槍', null, 9, 'L', 60),
  ('9L:鈍器', '万雷', '武器', '鈍器', null, 9, 'L', 60),
  ('9L:短剣', '紫電一閃', '武器', '短剣', null, 9, 'L', 60),
  ('9L:拳', '妖獣拳', '武器', '拳', null, 9, 'L', 60),
  ('9L:弓', '稲妻の神弓', '武器', '弓', null, 9, 'L', 60),
  ('9L:銃', 'ボルテックス', '武器', '銃', null, 9, 'L', 60),
  ('9L:杖', '雷帝の王笏', '武器', '杖', null, 9, 'L', 60),
  ('9L:書', '天空神話', '武器', '書', null, 9, 'L', 60),
  ('9L:投擲', '雷鼓', '武器', '投擲', null, 9, 'L', 60),
  ('9L:刀', '雷切', '武器', '刀', null, 9, 'L', 60),
  ('9L:宝珠', '雷神の宝珠', '武器', '宝珠', null, 9, 'L', 60),
  ('9L:重鎧頭', 'ジュピターヘルム', '頭', '重鎧', '重鎧', 9, 'L', 60),
  ('9L:重鎧鎧', 'ジュピターアーマー', '鎧', '重鎧', '重鎧', 9, 'L', 60),
  ('9L:重鎧腕', 'ジュピターガントレット', '腕', '重鎧', '重鎧', 9, 'L', 60),
  ('9L:重鎧足', 'ジュピターグリーヴ', '足', '重鎧', '重鎧', 9, 'L', 60),
  ('9L:軽装頭', '雷獣の頭巾', '頭', '軽装', '軽装', 9, 'L', 60),
  ('9L:軽装鎧', '雷獣の毛皮衣', '鎧', '軽装', '軽装', 9, 'L', 60),
  ('9L:軽装腕', '雷獣の手甲', '腕', '軽装', '軽装', 9, 'L', 60),
  ('9L:軽装足', '雷獣の靴', '足', '軽装', '軽装', 9, 'L', 60),
  ('9L:リング', '雷帝の指輪', 'アクセ', 'リング', null, 9, 'L', 60),
  ('9L:イヤリング', '雷鳴の勾玉', 'アクセ', 'イヤリング', null, 9, 'L', 60),
  ('9L:ベルト', '巨神の大帯', 'アクセ', 'ベルト', null, 9, 'L', 60),
  ('9L:ネックレス', '神雷の首飾り', 'アクセ', 'ネックレス', null, 9, 'L', 60),
  ('10N:片手剣', 'アダマンソード', '武器', '片手剣', null, 10, 'N', 50),
  ('10N:両手剣', 'アダマンクレイモア', '武器', '両手剣', null, 10, 'N', 50),
  ('10N:斧', 'アダマンアクス', '武器', '斧', null, 10, 'N', 50),
  ('10N:槍', 'アダマンスピア', '武器', '槍', null, 10, 'N', 50),
  ('10N:鈍器', 'アダマンメイス', '武器', '鈍器', null, 10, 'N', 50),
  ('10N:短剣', 'アダマンダガー', '武器', '短剣', null, 10, 'N', 50),
  ('10N:拳', 'アダマンナックル', '武器', '拳', null, 10, 'N', 50),
  ('10N:弓', 'アダマンボウ', '武器', '弓', null, 10, 'N', 50),
  ('10N:銃', 'アダマンマグナム', '武器', '銃', null, 10, 'N', 50),
  ('10N:杖', 'アダマンスタッフ', '武器', '杖', null, 10, 'N', 50),
  ('10N:書', '黙示録', '武器', '書', null, 10, 'N', 50),
  ('10N:投擲', 'アダマンチャクラム', '武器', '投擲', null, 10, 'N', 50),
  ('10N:刀', 'アダマンカタナ', '武器', '刀', null, 10, 'N', 50),
  ('10N:宝珠', 'ルビーオーブ', '武器', '宝珠', null, 10, 'N', 50),
  ('10N:重鎧頭', 'アダマンヘルム', '頭', '重鎧', '重鎧', 10, 'N', 50),
  ('10N:重鎧鎧', 'アダマンメイル', '鎧', '重鎧', '重鎧', 10, 'N', 50),
  ('10N:重鎧腕', 'アダマンガントレット', '腕', '重鎧', '重鎧', 10, 'N', 50),
  ('10N:重鎧足', 'アダマングリーヴ', '足', '重鎧', '重鎧', 10, 'N', 50),
  ('10N:軽装頭', 'サラマンダーフード', '頭', '軽装', '軽装', 10, 'N', 50),
  ('10N:軽装鎧', 'サラマンダーコート', '鎧', '軽装', '軽装', 10, 'N', 50),
  ('10N:軽装腕', 'サラマンダーグローブ', '腕', '軽装', '軽装', 10, 'N', 50),
  ('10N:軽装足', 'サラマンダーブーツ', '足', '軽装', '軽装', 10, 'N', 50),
  ('10N:リング', 'ルビーリング', 'アクセ', 'リング', null, 10, 'N', 50),
  ('10N:イヤリング', 'ルビーイヤリング', 'アクセ', 'イヤリング', null, 10, 'N', 50),
  ('10N:ベルト', 'ルビーベルト', 'アクセ', 'ベルト', null, 10, 'N', 50),
  ('10N:ネックレス', 'ルビーネックレス', 'アクセ', 'ネックレス', null, 10, 'N', 50),
  ('10R:片手剣', 'フレイムタン', '武器', '片手剣', null, 10, 'R', 55),
  ('10R:両手剣', 'インフェルノ', '武器', '両手剣', null, 10, 'R', 55),
  ('10R:斧', '溶岩斧', '武器', '斧', null, 10, 'R', 55),
  ('10R:槍', '紅蓮槍', '武器', '槍', null, 10, 'R', 55),
  ('10R:鈍器', '鍛冶神の鎚', '武器', '鈍器', null, 10, 'R', 55),
  ('10R:短剣', '熾火の短剣', '武器', '短剣', null, 10, 'R', 55),
  ('10R:拳', '爆炎拳', '武器', '拳', null, 10, 'R', 55),
  ('10R:弓', '不死鳥の弓', '武器', '弓', null, 10, 'R', 55),
  ('10R:銃', 'ドラゴンブレス', '武器', '銃', null, 10, 'R', 55),
  ('10R:杖', 'イフリートスタッフ', '武器', '杖', null, 10, 'R', 55),
  ('10R:書', '魔神契約書', '武器', '書', null, 10, 'R', 55),
  ('10R:投擲', '焔輪', '武器', '投擲', null, 10, 'R', 55),
  ('10R:刀', '火車切', '武器', '刀', null, 10, 'R', 55),
  ('10R:宝珠', '溶岩の核', '武器', '宝珠', null, 10, 'R', 55),
  ('10R:重鎧頭', '炎獄の兜', '頭', '重鎧', '重鎧', 10, 'R', 55),
  ('10R:重鎧鎧', '炎獄の鎧', '鎧', '重鎧', '重鎧', 10, 'R', 55),
  ('10R:重鎧腕', '炎獄の篭手', '腕', '重鎧', '重鎧', 10, 'R', 55),
  ('10R:重鎧足', '炎獄の具足', '足', '重鎧', '重鎧', 10, 'R', 55),
  ('10R:軽装頭', 'フェニックスハット', '頭', '軽装', '軽装', 10, 'R', 55),
  ('10R:軽装鎧', 'フェニックスローブ', '鎧', '軽装', '軽装', 10, 'R', 55),
  ('10R:軽装腕', 'フェニックスグローブ', '腕', '軽装', '軽装', 10, 'R', 55),
  ('10R:軽装足', 'フェニックスブーツ', '足', '軽装', '軽装', 10, 'R', 55),
  ('10R:リング', '鬼火の指輪', 'アクセ', 'リング', null, 10, 'R', 55),
  ('10R:イヤリング', '火の粉の耳飾り', 'アクセ', 'イヤリング', null, 10, 'R', 55),
  ('10R:ベルト', 'マグマベルト', 'アクセ', 'ベルト', null, 10, 'R', 55),
  ('10R:ネックレス', '火蜥蜴の護符', 'アクセ', 'ネックレス', null, 10, 'R', 55),
  ('10E:片手剣', '深紅の焔剣', '武器', '片手剣', null, 10, 'E', 60),
  ('10E:両手剣', '魔神の大剣', '武器', '両手剣', null, 10, 'E', 60),
  ('10E:斧', '岩甲斧', '武器', '斧', null, 10, 'E', 60),
  ('10E:槍', '溶岩竜の槍', '武器', '槍', null, 10, 'E', 60),
  ('10E:鈍器', '溶岩王の鎚', '武器', '鈍器', null, 10, 'E', 60),
  ('10E:短剣', '三頭犬の牙', '武器', '短剣', null, 10, 'E', 60),
  ('10E:拳', 'デーモンクロー', '武器', '拳', null, 10, 'E', 60),
  ('10E:弓', '紅炎の弓', '武器', '弓', null, 10, 'E', 60),
  ('10E:銃', 'ラヴァロア', '武器', '銃', null, 10, 'E', 60),
  ('10E:杖', '獄炎の杖', '武器', '杖', null, 10, 'E', 60),
  ('10E:書', '業火の魔導典', '武器', '書', null, 10, 'E', 60),
  ('10E:投擲', 'ブレイズウィング', '武器', '投擲', null, 10, 'E', 60),
  ('10E:刀', '業魔刀', '武器', '刀', null, 10, 'E', 60),
  ('10E:宝珠', 'イフリートの火珠', '武器', '宝珠', null, 10, 'E', 60),
  ('10E:重鎧頭', '岩甲の兜', '頭', '重鎧', '重鎧', 10, 'E', 60),
  ('10E:重鎧鎧', '岩甲の鎧', '鎧', '重鎧', '重鎧', 10, 'E', 60),
  ('10E:重鎧腕', '岩甲の篭手', '腕', '重鎧', '重鎧', 10, 'E', 60),
  ('10E:重鎧足', '岩甲の具足', '足', '重鎧', '重鎧', 10, 'E', 60),
  ('10E:軽装頭', 'イフリートターバン', '頭', '軽装', '軽装', 10, 'E', 60),
  ('10E:軽装鎧', 'イフリートローブ', '鎧', '軽装', '軽装', 10, 'E', 60),
  ('10E:軽装腕', 'イフリートグローブ', '腕', '軽装', '軽装', 10, 'E', 60),
  ('10E:軽装足', 'イフリートブーツ', '足', '軽装', '軽装', 10, 'E', 60),
  ('10E:リング', '深紅の指輪', 'アクセ', 'リング', null, 10, 'E', 60),
  ('10E:イヤリング', '悪魔の角飾り', 'アクセ', 'イヤリング', null, 10, 'E', 60),
  ('10E:ベルト', '溶岩竜の鱗帯', 'アクセ', 'ベルト', null, 10, 'E', 60),
  ('10E:ネックレス', '地獄犬の首輪', 'アクセ', 'ネックレス', null, 10, 'E', 60),
  ('10L:片手剣', '紅蓮業火', '武器', '片手剣', null, 10, 'L', 65),
  ('10L:両手剣', '終焉の焔', '武器', '両手剣', null, 10, 'L', 65),
  ('10L:斧', '火山王の大斧', '武器', '斧', null, 10, 'L', 65),
  ('10L:槍', '灼熱の竜槍', '武器', '槍', null, 10, 'L', 65),
  ('10L:鈍器', '炉心の大鎚', '武器', '鈍器', null, 10, 'L', 65),
  ('10L:短剣', '深紅の牙', '武器', '短剣', null, 10, 'L', 65),
  ('10L:拳', '火山拳', '武器', '拳', null, 10, 'L', 65),
  ('10L:弓', '焦熱の弓', '武器', '弓', null, 10, 'L', 65),
  ('10L:銃', 'ボルケイノ', '武器', '銃', null, 10, 'L', 65),
  ('10L:杖', '炎神の杖', '武器', '杖', null, 10, 'L', 65),
  ('10L:書', '煉獄の王典', '武器', '書', null, 10, 'L', 65),
  ('10L:投擲', '紅輪', '武器', '投擲', null, 10, 'L', 65),
  ('10L:刀', '不知火', '武器', '刀', null, 10, 'L', 65),
  ('10L:宝珠', '賢者の石', '武器', '宝珠', null, 10, 'L', 65),
  ('10L:重鎧頭', '炎帝の兜', '頭', '重鎧', '重鎧', 10, 'L', 65),
  ('10L:重鎧鎧', '炎帝の鎧', '鎧', '重鎧', '重鎧', 10, 'L', 65),
  ('10L:重鎧腕', '炎帝の篭手', '腕', '重鎧', '重鎧', 10, 'L', 65),
  ('10L:重鎧足', '炎帝の具足', '足', '重鎧', '重鎧', 10, 'L', 65),
  ('10L:軽装頭', 'クリムゾンフード', '頭', '軽装', '軽装', 10, 'L', 65),
  ('10L:軽装鎧', 'クリムゾンローブ', '鎧', '軽装', '軽装', 10, 'L', 65),
  ('10L:軽装腕', 'クリムゾングローブ', '腕', '軽装', '軽装', 10, 'L', 65),
  ('10L:軽装足', 'クリムゾンブーツ', '足', '軽装', '軽装', 10, 'L', 65),
  ('10L:リング', '炎竜の指輪', 'アクセ', 'リング', null, 10, 'L', 65),
  ('10L:イヤリング', '熾火の宝珠', 'アクセ', 'イヤリング', null, 10, 'L', 65),
  ('10L:ベルト', '火山王の帯', 'アクセ', 'ベルト', null, 10, 'L', 65),
  ('10L:ネックレス', '不滅の炎', 'アクセ', 'ネックレス', null, 10, 'L', 65),
  ('11N:片手剣', 'ドラゴンソード', '武器', '片手剣', null, 11, 'N', 55),
  ('11N:両手剣', 'ドラゴンクレイモア', '武器', '両手剣', null, 11, 'N', 55),
  ('11N:斧', 'ドラゴンアクス', '武器', '斧', null, 11, 'N', 55),
  ('11N:槍', 'ドラゴンスピア', '武器', '槍', null, 11, 'N', 55),
  ('11N:鈍器', 'ドラゴンメイス', '武器', '鈍器', null, 11, 'N', 55),
  ('11N:短剣', 'ドラゴンダガー', '武器', '短剣', null, 11, 'N', 55),
  ('11N:拳', 'ドラゴンナックル', '武器', '拳', null, 11, 'N', 55),
  ('11N:弓', 'ドラゴンボウ', '武器', '弓', null, 11, 'N', 55),
  ('11N:銃', 'ドラゴンマグナム', '武器', '銃', null, 11, 'N', 55),
  ('11N:杖', 'ドラゴンスタッフ', '武器', '杖', null, 11, 'N', 55),
  ('11N:書', '竜語典', '武器', '書', null, 11, 'N', 55),
  ('11N:投擲', 'ドラゴンチャクラム', '武器', '投擲', null, 11, 'N', 55),
  ('11N:刀', 'ドラゴンカタナ', '武器', '刀', null, 11, 'N', 55),
  ('11N:宝珠', 'オニキスオーブ', '武器', '宝珠', null, 11, 'N', 55),
  ('11N:重鎧頭', 'ドラゴンヘルム', '頭', '重鎧', '重鎧', 11, 'N', 55),
  ('11N:重鎧鎧', 'ドラゴンメイル', '鎧', '重鎧', '重鎧', 11, 'N', 55),
  ('11N:重鎧腕', 'ドラゴンガントレット', '腕', '重鎧', '重鎧', 11, 'N', 55),
  ('11N:重鎧足', 'ドラゴングリーヴ', '足', '重鎧', '重鎧', 11, 'N', 55),
  ('11N:軽装頭', 'ドラゴンフード', '頭', '軽装', '軽装', 11, 'N', 55),
  ('11N:軽装鎧', 'ドラゴンコート', '鎧', '軽装', '軽装', 11, 'N', 55),
  ('11N:軽装腕', 'ドラゴングローブ', '腕', '軽装', '軽装', 11, 'N', 55),
  ('11N:軽装足', 'ドラゴンブーツ', '足', '軽装', '軽装', 11, 'N', 55),
  ('11N:リング', 'オニキスリング', 'アクセ', 'リング', null, 11, 'N', 55),
  ('11N:イヤリング', 'オニキスイヤリング', 'アクセ', 'イヤリング', null, 11, 'N', 55),
  ('11N:ベルト', 'オニキスベルト', 'アクセ', 'ベルト', null, 11, 'N', 55),
  ('11N:ネックレス', 'オニキスネックレス', 'アクセ', 'ネックレス', null, 11, 'N', 55),
  ('11R:片手剣', 'ヴェノムブレード', '武器', '片手剣', null, 11, 'R', 60),
  ('11R:両手剣', '毒龍の大剣', '武器', '両手剣', null, 11, 'R', 60),
  ('11R:斧', '蜥蜴人の斧', '武器', '斧', null, 11, 'R', 60),
  ('11R:槍', '鰐顎の槍', '武器', '槍', null, 11, 'R', 60),
  ('11R:鈍器', '腐王の笏', '武器', '鈍器', null, 11, 'R', 60),
  ('11R:短剣', 'ブラッドリーチ', '武器', '短剣', null, 11, 'R', 60),
  ('11R:拳', 'クロコダイルナックル', '武器', '拳', null, 11, 'R', 60),
  ('11R:弓', '沼葦の弓', '武器', '弓', null, 11, 'R', 60),
  ('11R:銃', '腐蝕銃', '武器', '銃', null, 11, 'R', 60),
  ('11R:杖', 'ウィスプランタン', '武器', '杖', null, 11, 'R', 60),
  ('11R:書', '呪詛帳', '武器', '書', null, 11, 'R', 60),
  ('11R:投擲', '毒壺', '武器', '投擲', null, 11, 'R', 60),
  ('11R:刀', '毒蛇切り', '武器', '刀', null, 11, 'R', 60),
  ('11R:宝珠', '腐れ水晶', '武器', '宝珠', null, 11, 'R', 60),
  ('11R:重鎧頭', 'ヒュドラヘルム', '頭', '重鎧', '重鎧', 11, 'R', 60),
  ('11R:重鎧鎧', 'ヒュドラスケイル', '鎧', '重鎧', '重鎧', 11, 'R', 60),
  ('11R:重鎧腕', 'ヒュドラガントレット', '腕', '重鎧', '重鎧', 11, 'R', 60),
  ('11R:重鎧足', 'ヒュドラグリーヴ', '足', '重鎧', '重鎧', 11, 'R', 60),
  ('11R:軽装頭', '蛇革の帽子', '頭', '軽装', '軽装', 11, 'R', 60),
  ('11R:軽装鎧', '蛇革の上着', '鎧', '軽装', '軽装', 11, 'R', 60),
  ('11R:軽装腕', '蛇革の手袋', '腕', '軽装', '軽装', 11, 'R', 60),
  ('11R:軽装足', '蛇革の長靴', '足', '軽装', '軽装', 11, 'R', 60),
  ('11R:リング', '解毒の指輪', 'アクセ', 'リング', null, 11, 'R', 60),
  ('11R:イヤリング', '鬼灯の耳飾り', 'アクセ', 'イヤリング', null, 11, 'R', 60),
  ('11R:ベルト', '瘴気除けの帯', 'アクセ', 'ベルト', null, 11, 'R', 60),
  ('11R:ネックレス', '沈みし村の聖印', 'アクセ', 'ネックレス', null, 11, 'R', 60),
  ('11E:片手剣', '毒龍剣ヴェノム', '武器', '片手剣', null, 11, 'E', 65),
  ('11E:両手剣', '屍巨人の大剣', '武器', '両手剣', null, 11, 'E', 65),
  ('11E:斧', '沼主の顎斧', '武器', '斧', null, 11, 'E', 65),
  ('11E:槍', '多頭蛇の槍', '武器', '槍', null, 11, 'E', 65),
  ('11E:鈍器', '蛙王の鎚', '武器', '鈍器', null, 11, 'E', 65),
  ('11E:短剣', '酸蝕の短剣', '武器', '短剣', null, 11, 'E', 65),
  ('11E:拳', 'トードフィスト', '武器', '拳', null, 11, 'E', 65),
  ('11E:弓', '腐海の長弓', '武器', '弓', null, 11, 'E', 65),
  ('11E:銃', 'アシッドガン', '武器', '銃', null, 11, 'E', 65),
  ('11E:杖', 'ザルグの呪杖', '武器', '杖', null, 11, 'E', 65),
  ('11E:書', '沼呪師の禁書', '武器', '書', null, 11, 'E', 65),
  ('11E:投擲', 'ウィスプオーブ', '武器', '投擲', null, 11, 'E', 65),
  ('11E:刀', '毒龍切り', '武器', '刀', null, 11, 'E', 65),
  ('11E:宝珠', '大鬼火の珠', '武器', '宝珠', null, 11, 'E', 65),
  ('11E:重鎧頭', '沼主の兜', '頭', '重鎧', '重鎧', 11, 'E', 65),
  ('11E:重鎧鎧', '沼主の鎧', '鎧', '重鎧', '重鎧', 11, 'E', 65),
  ('11E:重鎧腕', '沼主の篭手', '腕', '重鎧', '重鎧', 11, 'E', 65),
  ('11E:重鎧足', '沼主の具足', '足', '重鎧', '重鎧', 11, 'E', 65),
  ('11E:軽装頭', 'ウィスプフード', '頭', '軽装', '軽装', 11, 'E', 65),
  ('11E:軽装鎧', 'ウィスプローブ', '鎧', '軽装', '軽装', 11, 'E', 65),
  ('11E:軽装腕', 'ウィスプグローブ', '腕', '軽装', '軽装', 11, 'E', 65),
  ('11E:軽装足', 'ウィスプブーツ', '足', '軽装', '軽装', 11, 'E', 65),
  ('11E:リング', '九頭の指輪', 'アクセ', 'リング', null, 11, 'E', 65),
  ('11E:イヤリング', '腐食の雫', 'アクセ', 'イヤリング', null, 11, 'E', 65),
  ('11E:ベルト', '鰐皮の大帯', 'アクセ', 'ベルト', null, 11, 'E', 65),
  ('11E:ネックレス', 'ヴェノムハート', 'アクセ', 'ネックレス', null, 11, 'E', 65),
  ('11L:片手剣', '諸行無常', '武器', '片手剣', null, 11, 'L', 70),
  ('11L:両手剣', '九頭龍の大剣', '武器', '両手剣', null, 11, 'L', 70),
  ('11L:斧', '大鰐斧', '武器', '斧', null, 11, 'L', 70),
  ('11L:槍', '百毒槍', '武器', '槍', null, 11, 'L', 70),
  ('11L:鈍器', '呪われし王笏', '武器', '鈍器', null, 11, 'L', 70),
  ('11L:短剣', '怨念の刃', '武器', '短剣', null, 11, 'L', 70),
  ('11L:拳', '鰐王拳', '武器', '拳', null, 11, 'L', 70),
  ('11L:弓', '毒霧の神弓', '武器', '弓', null, 11, 'L', 70),
  ('11L:銃', 'ペスティレンス', '武器', '銃', null, 11, 'L', 70),
  ('11L:杖', '大呪師の杖', '武器', '杖', null, 11, 'L', 70),
  ('11L:書', '死霊の書', '武器', '書', null, 11, 'L', 70),
  ('11L:投擲', '瘴気の珠', '武器', '投擲', null, 11, 'L', 70),
  ('11L:刀', '八岐', '武器', '刀', null, 11, 'L', 70),
  ('11L:宝珠', '怨嗟の珠', '武器', '宝珠', null, 11, 'L', 70),
  ('11L:重鎧頭', 'ヴェノムヘルム', '頭', '重鎧', '重鎧', 11, 'L', 70),
  ('11L:重鎧鎧', 'ヴェノムアーマー', '鎧', '重鎧', '重鎧', 11, 'L', 70),
  ('11L:重鎧腕', 'ヴェノムガントレット', '腕', '重鎧', '重鎧', 11, 'L', 70),
  ('11L:重鎧足', 'ヴェノムグリーヴ', '足', '重鎧', '重鎧', 11, 'L', 70),
  ('11L:軽装頭', '大呪師の頭巾', '頭', '軽装', '軽装', 11, 'L', 70),
  ('11L:軽装鎧', '大呪師の法衣', '鎧', '軽装', '軽装', 11, 'L', 70),
  ('11L:軽装腕', '大呪師の手甲', '腕', '軽装', '軽装', 11, 'L', 70),
  ('11L:軽装足', '大呪師の履', '足', '軽装', '軽装', 11, 'L', 70),
  ('11L:リング', '腐王の印章', 'アクセ', 'リング', null, 11, 'L', 70),
  ('11L:イヤリング', '猛毒の雫', 'アクセ', 'イヤリング', null, 11, 'L', 70),
  ('11L:ベルト', '大鰐の帯', 'アクセ', 'ベルト', null, 11, 'L', 70),
  ('11L:ネックレス', '沼底の聖杯', 'アクセ', 'ネックレス', null, 11, 'L', 70),
  ('12N:片手剣', 'オリハルコンソード', '武器', '片手剣', null, 12, 'N', 60),
  ('12N:両手剣', 'オリハルコンクレイモア', '武器', '両手剣', null, 12, 'N', 60),
  ('12N:斧', 'オリハルコンアクス', '武器', '斧', null, 12, 'N', 60),
  ('12N:槍', 'オリハルコンスピア', '武器', '槍', null, 12, 'N', 60),
  ('12N:鈍器', 'オリハルコンメイス', '武器', '鈍器', null, 12, 'N', 60),
  ('12N:短剣', 'オリハルコンダガー', '武器', '短剣', null, 12, 'N', 60),
  ('12N:拳', 'オリハルコンナックル', '武器', '拳', null, 12, 'N', 60),
  ('12N:弓', 'オリハルコンボウ', '武器', '弓', null, 12, 'N', 60),
  ('12N:銃', 'オリハルコンマグナム', '武器', '銃', null, 12, 'N', 60),
  ('12N:杖', 'オリハルコンスタッフ', '武器', '杖', null, 12, 'N', 60),
  ('12N:書', '冥府録', '武器', '書', null, 12, 'N', 60),
  ('12N:投擲', 'オリハルコンチャクラム', '武器', '投擲', null, 12, 'N', 60),
  ('12N:刀', 'オリハルコンカタナ', '武器', '刀', null, 12, 'N', 60),
  ('12N:宝珠', 'オパールオーブ', '武器', '宝珠', null, 12, 'N', 60),
  ('12N:重鎧頭', 'オリハルコンヘルム', '頭', '重鎧', '重鎧', 12, 'N', 60),
  ('12N:重鎧鎧', 'オリハルコンメイル', '鎧', '重鎧', '重鎧', 12, 'N', 60),
  ('12N:重鎧腕', 'オリハルコンガントレット', '腕', '重鎧', '重鎧', 12, 'N', 60),
  ('12N:重鎧足', 'オリハルコングリーヴ', '足', '重鎧', '重鎧', 12, 'N', 60),
  ('12N:軽装頭', 'シャドウフード', '頭', '軽装', '軽装', 12, 'N', 60),
  ('12N:軽装鎧', 'シャドウコート', '鎧', '軽装', '軽装', 12, 'N', 60),
  ('12N:軽装腕', 'シャドウグローブ', '腕', '軽装', '軽装', 12, 'N', 60),
  ('12N:軽装足', 'シャドウブーツ', '足', '軽装', '軽装', 12, 'N', 60),
  ('12N:リング', 'オパールリング', 'アクセ', 'リング', null, 12, 'N', 60),
  ('12N:イヤリング', 'オパールイヤリング', 'アクセ', 'イヤリング', null, 12, 'N', 60),
  ('12N:ベルト', 'オパールベルト', 'アクセ', 'ベルト', null, 12, 'N', 60),
  ('12N:ネックレス', 'オパールネックレス', 'アクセ', 'ネックレス', null, 12, 'N', 60),
  ('12R:片手剣', '水晶剣', '武器', '片手剣', null, 12, 'R', 65),
  ('12R:両手剣', 'ドリルブレイカー', '武器', '両手剣', null, 12, 'R', 65),
  ('12R:斧', '大つるはし', '武器', '斧', null, 12, 'R', 65),
  ('12R:槍', '削岩槍', '武器', '槍', null, 12, 'R', 65),
  ('12R:鈍器', 'ガイアハンマー', '武器', '鈍器', null, 12, 'R', 65),
  ('12R:短剣', 'アラクネの毒牙', '武器', '短剣', null, 12, 'R', 65),
  ('12R:拳', 'モールクロー', '武器', '拳', null, 12, 'R', 65),
  ('12R:弓', '蜘蛛糸の弓', '武器', '弓', null, 12, 'R', 65),
  ('12R:銃', 'ドワーフ火砲', '武器', '銃', null, 12, 'R', 65),
  ('12R:杖', '晶石の杖', '武器', '杖', null, 12, 'R', 65),
  ('12R:書', '坑夫の手記', '武器', '書', null, 12, 'R', 65),
  ('12R:投擲', '発破筒', '武器', '投擲', null, 12, 'R', 65),
  ('12R:刀', '黒鉄丸', '武器', '刀', null, 12, 'R', 65),
  ('12R:宝珠', '灯守の水晶', '武器', '宝珠', null, 12, 'R', 65),
  ('12R:重鎧頭', 'ドワーフヘルム', '頭', '重鎧', '重鎧', 12, 'R', 65),
  ('12R:重鎧鎧', 'ドワーフプレート', '鎧', '重鎧', '重鎧', 12, 'R', 65),
  ('12R:重鎧腕', 'ドワーフガントレット', '腕', '重鎧', '重鎧', 12, 'R', 65),
  ('12R:重鎧足', 'ドワーフグリーヴ', '足', '重鎧', '重鎧', 12, 'R', 65),
  ('12R:軽装頭', '灯守の頭巾', '頭', '軽装', '軽装', 12, 'R', 65),
  ('12R:軽装鎧', '灯守の外套', '鎧', '軽装', '軽装', 12, 'R', 65),
  ('12R:軽装腕', '灯守の手袋', '腕', '軽装', '軽装', 12, 'R', 65),
  ('12R:軽装足', '灯守の長靴', '足', '軽装', '軽装', 12, 'R', 65),
  ('12R:リング', '原石の指輪', 'アクセ', 'リング', null, 12, 'R', 65),
  ('12R:イヤリング', 'クリスタルピアス', 'アクセ', 'イヤリング', null, 12, 'R', 65),
  ('12R:ベルト', 'ツールベルト', 'アクセ', 'ベルト', null, 12, 'R', 65),
  ('12R:ネックレス', '奈落の鍵', 'アクセ', 'ネックレス', null, 12, 'R', 65),
  ('12E:片手剣', 'ドワーフ王の宝剣', '武器', '片手剣', null, 12, 'E', 70),
  ('12E:両手剣', '巌喰いの大剣', '武器', '両手剣', null, 12, 'E', 70),
  ('12E:斧', '螺旋斧', '武器', '斧', null, 12, 'E', 70),
  ('12E:槍', '蜘蛛脚の槍', '武器', '槍', null, 12, 'E', 70),
  ('12E:鈍器', '大地の鎚', '武器', '鈍器', null, 12, 'E', 70),
  ('12E:短剣', '影追いの短剣', '武器', '短剣', null, 12, 'E', 70),
  ('12E:拳', 'グールクロー', '武器', '拳', null, 12, 'E', 70),
  ('12E:弓', '女王蜘蛛の弓', '武器', '弓', null, 12, 'E', 70),
  ('12E:銃', '削岩砲', '武器', '銃', null, 12, 'E', 70),
  ('12E:杖', 'プリズムロッド', '武器', '杖', null, 12, 'E', 70),
  ('12E:書', '古ドワーフの鍛冶書', '武器', '書', null, 12, 'E', 70),
  ('12E:投擲', '虹晶の輪', '武器', '投擲', null, 12, 'E', 70),
  ('12E:刀', '魔銀刀', '武器', '刀', null, 12, 'E', 70),
  ('12E:宝珠', '虹晶の宝珠', '武器', '宝珠', null, 12, 'E', 70),
  ('12E:重鎧頭', '魔銀の兜', '頭', '重鎧', '重鎧', 12, 'E', 70),
  ('12E:重鎧鎧', '魔銀の鎧', '鎧', '重鎧', '重鎧', 12, 'E', 70),
  ('12E:重鎧腕', '魔銀の篭手', '腕', '重鎧', '重鎧', 12, 'E', 70),
  ('12E:重鎧足', '魔銀の具足', '足', '重鎧', '重鎧', 12, 'E', 70),
  ('12E:軽装頭', 'アラクネフード', '頭', '軽装', '軽装', 12, 'E', 70),
  ('12E:軽装鎧', 'アラクネドレス', '鎧', '軽装', '軽装', 12, 'E', 70),
  ('12E:軽装腕', 'アラクネグローブ', '腕', '軽装', '軽装', 12, 'E', 70),
  ('12E:軽装足', 'アラクネブーツ', '足', '軽装', '軽装', 12, 'E', 70),
  ('12E:リング', 'グール王の指輪', 'アクセ', 'リング', null, 12, 'E', 70),
  ('12E:イヤリング', '七色の耳飾り', 'アクセ', 'イヤリング', null, 12, 'E', 70),
  ('12E:ベルト', 'ドワーフ王の帯', 'アクセ', 'ベルト', null, 12, 'E', 70),
  ('12E:ネックレス', '奈落の宝珠', 'アクセ', 'ネックレス', null, 12, 'E', 70),
  ('12L:片手剣', '地底剣ガイア', '武器', '片手剣', null, 12, 'L', 75),
  ('12L:両手剣', '天地鳴動', '武器', '両手剣', null, 12, 'L', 75),
  ('12L:斧', '地殻斧', '武器', '斧', null, 12, 'L', 75),
  ('12L:槍', '八脚槍', '武器', '槍', null, 12, 'L', 75),
  ('12L:鈍器', '地母神の鎚', '武器', '鈍器', null, 12, 'L', 75),
  ('12L:短剣', '絡新婦', '武器', '短剣', null, 12, 'L', 75),
  ('12L:拳', '穿孔拳', '武器', '拳', null, 12, 'L', 75),
  ('12L:弓', '奈落の弓', '武器', '弓', null, 12, 'L', 75),
  ('12L:銃', 'パイルドライバー', '武器', '銃', null, 12, 'L', 75),
  ('12L:杖', '地脈の杖', '武器', '杖', null, 12, 'L', 75),
  ('12L:書', '大地の記憶', '武器', '書', null, 12, 'L', 75),
  ('12L:投擲', '蜘蛛の糸', '武器', '投擲', null, 12, 'L', 75),
  ('12L:刀', '黄泉路', '武器', '刀', null, 12, 'L', 75),
  ('12L:宝珠', '大地の瞳', '武器', '宝珠', null, 12, 'L', 75),
  ('12L:重鎧頭', 'テラヘルム', '頭', '重鎧', '重鎧', 12, 'L', 75),
  ('12L:重鎧鎧', 'テラアーマー', '鎧', '重鎧', '重鎧', 12, 'L', 75),
  ('12L:重鎧腕', 'テラガントレット', '腕', '重鎧', '重鎧', 12, 'L', 75),
  ('12L:重鎧足', 'テラグリーヴ', '足', '重鎧', '重鎧', 12, 'L', 75),
  ('12L:軽装頭', '女郎蜘蛛の頭巾', '頭', '軽装', '軽装', 12, 'L', 75),
  ('12L:軽装鎧', '女郎蜘蛛の打掛', '鎧', '軽装', '軽装', 12, 'L', 75),
  ('12L:軽装腕', '女郎蜘蛛の手袋', '腕', '軽装', '軽装', 12, 'L', 75),
  ('12L:軽装足', '女郎蜘蛛の草履', '足', '軽装', '軽装', 12, 'L', 75),
  ('12L:リング', '大地の指輪', 'アクセ', 'リング', null, 12, 'L', 75),
  ('12L:イヤリング', '黒蜘蛛のピアス', 'アクセ', 'イヤリング', null, 12, 'L', 75),
  ('12L:ベルト', '機兵の動力帯', 'アクセ', 'ベルト', null, 12, 'L', 75),
  ('12L:ネックレス', '地核石', 'アクセ', 'ネックレス', null, 12, 'L', 75),
  ('13N:片手剣', 'セレスティアルソード', '武器', '片手剣', null, 13, 'N', 65),
  ('13N:両手剣', 'セレスティアルクレイモア', '武器', '両手剣', null, 13, 'N', 65),
  ('13N:斧', 'セレスティアルアクス', '武器', '斧', null, 13, 'N', 65),
  ('13N:槍', 'セレスティアルスピア', '武器', '槍', null, 13, 'N', 65),
  ('13N:鈍器', 'セレスティアルメイス', '武器', '鈍器', null, 13, 'N', 65),
  ('13N:短剣', 'セレスティアルダガー', '武器', '短剣', null, 13, 'N', 65),
  ('13N:拳', 'セレスティアルナックル', '武器', '拳', null, 13, 'N', 65),
  ('13N:弓', 'セレスティアルボウ', '武器', '弓', null, 13, 'N', 65),
  ('13N:銃', 'セレスティアルマグナム', '武器', '銃', null, 13, 'N', 65),
  ('13N:杖', 'セレスティアルスタッフ', '武器', '杖', null, 13, 'N', 65),
  ('13N:書', '天啓書', '武器', '書', null, 13, 'N', 65),
  ('13N:投擲', 'セレスティアルチャクラム', '武器', '投擲', null, 13, 'N', 65),
  ('13N:刀', 'セレスティアルカタナ', '武器', '刀', null, 13, 'N', 65),
  ('13N:宝珠', 'セレスタイトオーブ', '武器', '宝珠', null, 13, 'N', 65),
  ('13N:重鎧頭', 'セレスティアルヘルム', '頭', '重鎧', '重鎧', 13, 'N', 65),
  ('13N:重鎧鎧', 'セレスティアルメイル', '鎧', '重鎧', '重鎧', 13, 'N', 65),
  ('13N:重鎧腕', 'セレスティアルガントレット', '腕', '重鎧', '重鎧', 13, 'N', 65),
  ('13N:重鎧足', 'セレスティアルグリーヴ', '足', '重鎧', '重鎧', 13, 'N', 65),
  ('13N:軽装頭', 'セレスティアルフード', '頭', '軽装', '軽装', 13, 'N', 65),
  ('13N:軽装鎧', 'セレスティアルコート', '鎧', '軽装', '軽装', 13, 'N', 65),
  ('13N:軽装腕', 'セレスティアルグローブ', '腕', '軽装', '軽装', 13, 'N', 65),
  ('13N:軽装足', 'セレスティアルブーツ', '足', '軽装', '軽装', 13, 'N', 65),
  ('13N:リング', 'セレスタイトリング', 'アクセ', 'リング', null, 13, 'N', 65),
  ('13N:イヤリング', 'セレスタイトイヤリング', 'アクセ', 'イヤリング', null, 13, 'N', 65),
  ('13N:ベルト', 'セレスタイトベルト', 'アクセ', 'ベルト', null, 13, 'N', 65),
  ('13N:ネックレス', 'セレスタイトネックレス', 'アクセ', 'ネックレス', null, 13, 'N', 65),
  ('13R:片手剣', '蒼穹の剣', '武器', '片手剣', null, 13, 'R', 70),
  ('13R:両手剣', 'ゼニス', '武器', '両手剣', null, 13, 'R', 70),
  ('13R:斧', '戦乙女の斧', '武器', '斧', null, 13, 'R', 70),
  ('13R:槍', 'ペガサスランス', '武器', '槍', null, 13, 'R', 70),
  ('13R:鈍器', '天罰の鎚', '武器', '鈍器', null, 13, 'R', 70),
  ('13R:短剣', '風精の短剣', '武器', '短剣', null, 13, 'R', 70),
  ('13R:拳', 'ウィングナックル', '武器', '拳', null, 13, 'R', 70),
  ('13R:弓', '天穹の弓', '武器', '弓', null, 13, 'R', 70),
  ('13R:銃', 'スカイキャノン', '武器', '銃', null, 13, 'R', 70),
  ('13R:杖', '一角獣の杖', '武器', '杖', null, 13, 'R', 70),
  ('13R:書', '天上聖典', '武器', '書', null, 13, 'R', 70),
  ('13R:投擲', '天使の輪', '武器', '投擲', null, 13, 'R', 70),
  ('13R:刀', '雲居の太刀', '武器', '刀', null, 13, 'R', 70),
  ('13R:宝珠', '天空の宝珠', '武器', '宝珠', null, 13, 'R', 70),
  ('13R:重鎧頭', '天騎士の兜', '頭', '重鎧', '重鎧', 13, 'R', 70),
  ('13R:重鎧鎧', '天騎士の鎧', '鎧', '重鎧', '重鎧', 13, 'R', 70),
  ('13R:重鎧腕', '天騎士の篭手', '腕', '重鎧', '重鎧', 13, 'R', 70),
  ('13R:重鎧足', '天騎士の具足', '足', '重鎧', '重鎧', 13, 'R', 70),
  ('13R:軽装頭', 'セラフサークレット', '頭', '軽装', '軽装', 13, 'R', 70),
  ('13R:軽装鎧', 'セラフローブ', '鎧', '軽装', '軽装', 13, 'R', 70),
  ('13R:軽装腕', 'セラフグローブ', '腕', '軽装', '軽装', 13, 'R', 70),
  ('13R:軽装足', 'セラフサンダル', '足', '軽装', '軽装', 13, 'R', 70),
  ('13R:リング', '雲海の指輪', 'アクセ', 'リング', null, 13, 'R', 70),
  ('13R:イヤリング', 'エンジェルフェザー', 'アクセ', 'イヤリング', null, 13, 'R', 70),
  ('13R:ベルト', 'ヴァルキリーベルト', 'アクセ', 'ベルト', null, 13, 'R', 70),
  ('13R:ネックレス', '天主の勲章', 'アクセ', 'ネックレス', null, 13, 'R', 70),
  ('13E:片手剣', '聖剣セレスト', '武器', '片手剣', null, 13, 'E', 75),
  ('13E:両手剣', '覇龍大剣ウラノス', '武器', '両手剣', null, 13, 'E', 75),
  ('13E:斧', 'ヴァルハラ', '武器', '斧', null, 13, 'E', 75),
  ('13E:槍', '天馬角の槍', '武器', '槍', null, 13, 'E', 75),
  ('13E:鈍器', '熾天使の聖鎚', '武器', '鈍器', null, 13, 'E', 75),
  ('13E:短剣', 'シルフィードの短剣', '武器', '短剣', null, 13, 'E', 75),
  ('13E:拳', 'ハーピィタロン', '武器', '拳', null, 13, 'E', 75),
  ('13E:弓', '戦乙女の聖弓', '武器', '弓', null, 13, 'E', 75),
  ('13E:銃', '天雷砲', '武器', '銃', null, 13, 'E', 75),
  ('13E:杖', '天空の錫杖', '武器', '杖', null, 13, 'E', 75),
  ('13E:書', 'ウラノス神典', '武器', '書', null, 13, 'E', 75),
  ('13E:投擲', '星雲の輪', '武器', '投擲', null, 13, 'E', 75),
  ('13E:刀', '風精丸', '武器', '刀', null, 13, 'E', 75),
  ('13E:宝珠', '熾天使の光球', '武器', '宝珠', null, 13, 'E', 75),
  ('13E:重鎧頭', 'ブリュンヒルデヘルム', '頭', '重鎧', '重鎧', 13, 'E', 75),
  ('13E:重鎧鎧', 'ブリュンヒルデメイル', '鎧', '重鎧', '重鎧', 13, 'E', 75),
  ('13E:重鎧腕', 'ブリュンヒルデガントレット', '腕', '重鎧', '重鎧', 13, 'E', 75),
  ('13E:重鎧足', 'ブリュンヒルデグリーヴ', '足', '重鎧', '重鎧', 13, 'E', 75),
  ('13E:軽装頭', '熾天使の冠', '頭', '軽装', '軽装', 13, 'E', 75),
  ('13E:軽装鎧', '熾天使の法衣', '鎧', '軽装', '軽装', 13, 'E', 75),
  ('13E:軽装腕', '熾天使の手甲', '腕', '軽装', '軽装', 13, 'E', 75),
  ('13E:軽装足', '熾天使の靴', '足', '軽装', '軽装', 13, 'E', 75),
  ('13E:リング', '覇龍の指輪', 'アクセ', 'リング', null, 13, 'E', 75),
  ('13E:イヤリング', 'シルフの囁き', 'アクセ', 'イヤリング', null, 13, 'E', 75),
  ('13E:ベルト', '天騎士長の剣帯', 'アクセ', 'ベルト', null, 13, 'E', 75),
  ('13E:ネックレス', '空鯨の鳴き石', 'アクセ', 'ネックレス', null, 13, 'E', 75),
  ('13L:片手剣', '天衣無縫', '武器', '片手剣', null, 13, 'L', 80),
  ('13L:両手剣', '蒼天覇王', '武器', '両手剣', null, 13, 'L', 80),
  ('13L:斧', '天翼斧', '武器', '斧', null, 13, 'L', 80),
  ('13L:槍', '天を統べる槍', '武器', '槍', null, 13, 'L', 80),
  ('13L:鈍器', '雲海の大鎚', '武器', '鈍器', null, 13, 'L', 80),
  ('13L:短剣', '天使の涙', '武器', '短剣', null, 13, 'L', 80),
  ('13L:拳', '天覇拳', '武器', '拳', null, 13, 'L', 80),
  ('13L:弓', '蒼穹の神弓', '武器', '弓', null, 13, 'L', 80),
  ('13L:銃', '覇龍砲', '武器', '銃', null, 13, 'L', 80),
  ('13L:杖', '天主の王笏', '武器', '杖', null, 13, 'L', 80),
  ('13L:書', '天空城の設計図', '武器', '書', null, 13, 'L', 80),
  ('13L:投擲', '天輪', '武器', '投擲', null, 13, 'L', 80),
  ('13L:刀', '蒼天一文字', '武器', '刀', null, 13, 'L', 80),
  ('13L:宝珠', '蒼天の宝玉', '武器', '宝珠', null, 13, 'L', 80),
  ('13L:重鎧頭', 'パラディンヘルム', '頭', '重鎧', '重鎧', 13, 'L', 80),
  ('13L:重鎧鎧', 'パラディンアーマー', '鎧', '重鎧', '重鎧', 13, 'L', 80),
  ('13L:重鎧腕', 'パラディンガントレット', '腕', '重鎧', '重鎧', 13, 'L', 80),
  ('13L:重鎧足', 'パラディングリーヴ', '足', '重鎧', '重鎧', 13, 'L', 80),
  ('13L:軽装頭', '天女の宝冠', '頭', '軽装', '軽装', 13, 'L', 80),
  ('13L:軽装鎧', '天女の羽衣', '鎧', '軽装', '軽装', 13, 'L', 80),
  ('13L:軽装腕', '天女の手甲', '腕', '軽装', '軽装', 13, 'L', 80),
  ('13L:軽装足', '天女の履', '足', '軽装', '軽装', 13, 'L', 80),
  ('13L:リング', '天空王の指輪', 'アクセ', 'リング', null, 13, 'L', 80),
  ('13L:イヤリング', '雲鯨の歌', 'アクセ', 'イヤリング', null, 13, 'L', 80),
  ('13L:ベルト', '覇龍の鱗帯', 'アクセ', 'ベルト', null, 13, 'L', 80),
  ('13L:ネックレス', '天空城の鍵', 'アクセ', 'ネックレス', null, 13, 'L', 80),
  ('14N:片手剣', 'メテオソード', '武器', '片手剣', null, 14, 'N', 70),
  ('14N:両手剣', 'メテオクレイモア', '武器', '両手剣', null, 14, 'N', 70),
  ('14N:斧', 'メテオアクス', '武器', '斧', null, 14, 'N', 70),
  ('14N:槍', 'メテオスピア', '武器', '槍', null, 14, 'N', 70),
  ('14N:鈍器', 'メテオメイス', '武器', '鈍器', null, 14, 'N', 70),
  ('14N:短剣', 'メテオダガー', '武器', '短剣', null, 14, 'N', 70),
  ('14N:拳', 'メテオナックル', '武器', '拳', null, 14, 'N', 70),
  ('14N:弓', 'メテオボウ', '武器', '弓', null, 14, 'N', 70),
  ('14N:銃', 'メテオマグナム', '武器', '銃', null, 14, 'N', 70),
  ('14N:杖', 'メテオスタッフ', '武器', '杖', null, 14, 'N', 70),
  ('14N:書', '星辰録', '武器', '書', null, 14, 'N', 70),
  ('14N:投擲', 'メテオチャクラム', '武器', '投擲', null, 14, 'N', 70),
  ('14N:刀', 'メテオカタナ', '武器', '刀', null, 14, 'N', 70),
  ('14N:宝珠', 'スターサファイアオーブ', '武器', '宝珠', null, 14, 'N', 70),
  ('14N:重鎧頭', 'メテオヘルム', '頭', '重鎧', '重鎧', 14, 'N', 70),
  ('14N:重鎧鎧', 'メテオメイル', '鎧', '重鎧', '重鎧', 14, 'N', 70),
  ('14N:重鎧腕', 'メテオガントレット', '腕', '重鎧', '重鎧', 14, 'N', 70),
  ('14N:重鎧足', 'メテオグリーヴ', '足', '重鎧', '重鎧', 14, 'N', 70),
  ('14N:軽装頭', 'アストラルフード', '頭', '軽装', '軽装', 14, 'N', 70),
  ('14N:軽装鎧', 'アストラルコート', '鎧', '軽装', '軽装', 14, 'N', 70),
  ('14N:軽装腕', 'アストラルグローブ', '腕', '軽装', '軽装', 14, 'N', 70),
  ('14N:軽装足', 'アストラルブーツ', '足', '軽装', '軽装', 14, 'N', 70),
  ('14N:リング', 'スターサファイアリング', 'アクセ', 'リング', null, 14, 'N', 70),
  ('14N:イヤリング', 'スターサファイアイヤリング', 'アクセ', 'イヤリング', null, 14, 'N', 70),
  ('14N:ベルト', 'スターサファイアベルト', 'アクセ', 'ベルト', null, 14, 'N', 70),
  ('14N:ネックレス', 'スターサファイアネックレス', 'アクセ', 'ネックレス', null, 14, 'N', 70),
  ('14R:片手剣', '星屑の剣', '武器', '片手剣', null, 14, 'R', 75),
  ('14R:両手剣', '時断ちの大剣', '武器', '両手剣', null, 14, 'R', 75),
  ('14R:斧', 'オベリスクアクス', '武器', '斧', null, 14, 'R', 75),
  ('14R:槍', '流星槍', '武器', '槍', null, 14, 'R', 75),
  ('14R:鈍器', '天球の鎚', '武器', '鈍器', null, 14, 'R', 75),
  ('14R:短剣', 'ルナエッジ', '武器', '短剣', null, 14, 'R', 75),
  ('14R:拳', 'マンティコアクロー', '武器', '拳', null, 14, 'R', 75),
  ('14R:弓', '射手座の弓', '武器', '弓', null, 14, 'R', 75),
  ('14R:銃', '古代魔導砲', '武器', '銃', null, 14, 'R', 75),
  ('14R:杖', '時針の杖', '武器', '杖', null, 14, 'R', 75),
  ('14R:書', 'アカシックレコード', '武器', '書', null, 14, 'R', 75),
  ('14R:投擲', '星環', '武器', '投擲', null, 14, 'R', 75),
  ('14R:刀', '星見の太刀', '武器', '刀', null, 14, 'R', 75),
  ('14R:宝珠', '星読みの水晶球', '武器', '宝珠', null, 14, 'R', 75),
  ('14R:重鎧頭', '機兵の兜', '頭', '重鎧', '重鎧', 14, 'R', 75),
  ('14R:重鎧鎧', '機兵の装甲', '鎧', '重鎧', '重鎧', 14, 'R', 75),
  ('14R:重鎧腕', '機兵の篭手', '腕', '重鎧', '重鎧', 14, 'R', 75),
  ('14R:重鎧足', '機兵の脚甲', '足', '重鎧', '重鎧', 14, 'R', 75),
  ('14R:軽装頭', 'スターゲイザーハット', '頭', '軽装', '軽装', 14, 'R', 75),
  ('14R:軽装鎧', 'スターゲイザーローブ', '鎧', '軽装', '軽装', 14, 'R', 75),
  ('14R:軽装腕', 'スターゲイザーグローブ', '腕', '軽装', '軽装', 14, 'R', 75),
  ('14R:軽装足', 'スターゲイザーブーツ', '足', '軽装', '軽装', 14, 'R', 75),
  ('14R:リング', 'クロノリング', 'アクセ', 'リング', null, 14, 'R', 75),
  ('14R:イヤリング', '月蛾の耳飾り', 'アクセ', 'イヤリング', null, 14, 'R', 75),
  ('14R:ベルト', '星図の帯', 'アクセ', 'ベルト', null, 14, 'R', 75),
  ('14R:ネックレス', '砂時計のペンダント', 'アクセ', 'ネックレス', null, 14, 'R', 75),
  ('14E:片手剣', '時星剣アイオーン', '武器', '片手剣', null, 14, 'E', 80),
  ('14E:両手剣', '銀河大剣', '武器', '両手剣', null, 14, 'E', 80),
  ('14E:斧', '機兵斧ゼクス', '武器', '斧', null, 14, 'E', 80),
  ('14E:槍', '星騎士の槍', '武器', '槍', null, 14, 'E', 80),
  ('14E:鈍器', '星核の鎚', '武器', '鈍器', null, 14, 'E', 80),
  ('14E:短剣', '月喰いの牙', '武器', '短剣', null, 14, 'E', 80),
  ('14E:拳', '謎掛けの拳', '武器', '拳', null, 14, 'E', 80),
  ('14E:弓', '流星群', '武器', '弓', null, 14, 'E', 80),
  ('14E:銃', 'オメガキャノン', '武器', '銃', null, 14, 'E', 80),
  ('14E:杖', 'ノクトゥアの梟杖', '武器', '杖', null, 14, 'E', 80),
  ('14E:書', '万象の書', '武器', '書', null, 14, 'E', 80),
  ('14E:投擲', '満月輪', '武器', '投擲', null, 14, 'E', 80),
  ('14E:刀', '星騎士の太刀', '武器', '刀', null, 14, 'E', 80),
  ('14E:宝珠', '星核の宝珠', '武器', '宝珠', null, 14, 'E', 80),
  ('14E:重鎧頭', '星騎士の兜', '頭', '重鎧', '重鎧', 14, 'E', 80),
  ('14E:重鎧鎧', '星騎士の鎧', '鎧', '重鎧', '重鎧', 14, 'E', 80),
  ('14E:重鎧腕', '星騎士の篭手', '腕', '重鎧', '重鎧', 14, 'E', 80),
  ('14E:重鎧足', '星騎士の具足', '足', '重鎧', '重鎧', 14, 'E', 80),
  ('14E:軽装頭', 'ノクトゥアハット', '頭', '軽装', '軽装', 14, 'E', 80),
  ('14E:軽装鎧', 'ノクトゥアローブ', '鎧', '軽装', '軽装', 14, 'E', 80),
  ('14E:軽装腕', 'ノクトゥアグローブ', '腕', '軽装', '軽装', 14, 'E', 80),
  ('14E:軽装足', 'ノクトゥアブーツ', '足', '軽装', '軽装', 14, 'E', 80),
  ('14E:リング', '永劫の指輪', 'アクセ', 'リング', null, 14, 'E', 80),
  ('14E:イヤリング', '獅子の耳飾り', 'アクセ', 'イヤリング', null, 14, 'E', 80),
  ('14E:ベルト', 'ゼクスの歯車帯', 'アクセ', 'ベルト', null, 14, 'E', 80),
  ('14E:ネックレス', '時の雫', 'アクセ', 'ネックレス', null, 14, 'E', 80),
  ('14L:片手剣', '永劫回帰', '武器', '片手剣', null, 14, 'L', 85),
  ('14L:両手剣', '時空断絶', '武器', '両手剣', null, 14, 'L', 85),
  ('14L:斧', '流星斧', '武器', '斧', null, 14, 'L', 85),
  ('14L:槍', '星穿ち', '武器', '槍', null, 14, 'L', 85),
  ('14L:鈍器', 'ビッグバン', '武器', '鈍器', null, 14, 'L', 85),
  ('14L:短剣', '沈黙の刃', '武器', '短剣', null, 14, 'L', 85),
  ('14L:拳', '時空拳', '武器', '拳', null, 14, 'L', 85),
  ('14L:弓', '天の川', '武器', '弓', null, 14, 'L', 85),
  ('14L:銃', '終末砲', '武器', '銃', null, 14, 'L', 85),
  ('14L:杖', '時の王笏', '武器', '杖', null, 14, 'L', 85),
  ('14L:書', '全知の書', '武器', '書', null, 14, 'L', 85),
  ('14L:投擲', '惑星輪', '武器', '投擲', null, 14, 'L', 85),
  ('14L:刀', '刹那', '武器', '刀', null, 14, 'L', 85),
  ('14L:宝珠', '時空の宝珠', '武器', '宝珠', null, 14, 'L', 85),
  ('14L:重鎧頭', '機神の兜', '頭', '重鎧', '重鎧', 14, 'L', 85),
  ('14L:重鎧鎧', '機神の鎧', '鎧', '重鎧', '重鎧', 14, 'L', 85),
  ('14L:重鎧腕', '機神の篭手', '腕', '重鎧', '重鎧', 14, 'L', 85),
  ('14L:重鎧足', '機神の具足', '足', '重鎧', '重鎧', 14, 'L', 85),
  ('14L:軽装頭', 'クロノスハット', '頭', '軽装', '軽装', 14, 'L', 85),
  ('14L:軽装鎧', 'クロノスローブ', '鎧', '軽装', '軽装', 14, 'L', 85),
  ('14L:軽装腕', 'クロノスグローブ', '腕', '軽装', '軽装', 14, 'L', 85),
  ('14L:軽装足', 'クロノスブーツ', '足', '軽装', '軽装', 14, 'L', 85),
  ('14L:リング', '悠久の指輪', 'アクセ', 'リング', null, 14, 'L', 85),
  ('14L:イヤリング', '梟王の耳飾り', 'アクセ', 'イヤリング', null, 14, 'L', 85),
  ('14L:ベルト', '時計仕掛けの帯', 'アクセ', 'ベルト', null, 14, 'L', 85),
  ('14L:ネックレス', '星の心臓', 'アクセ', 'ネックレス', null, 14, 'L', 85),
  ('15N:片手剣', 'ジェネシスソード', '武器', '片手剣', null, 15, 'N', 75),
  ('15N:両手剣', 'ジェネシスクレイモア', '武器', '両手剣', null, 15, 'N', 75),
  ('15N:斧', 'ジェネシスアクス', '武器', '斧', null, 15, 'N', 75),
  ('15N:槍', 'ジェネシススピア', '武器', '槍', null, 15, 'N', 75),
  ('15N:鈍器', 'ジェネシスメイス', '武器', '鈍器', null, 15, 'N', 75),
  ('15N:短剣', 'ジェネシスダガー', '武器', '短剣', null, 15, 'N', 75),
  ('15N:拳', 'ジェネシスナックル', '武器', '拳', null, 15, 'N', 75),
  ('15N:弓', 'ジェネシスボウ', '武器', '弓', null, 15, 'N', 75),
  ('15N:銃', 'ジェネシスマグナム', '武器', '銃', null, 15, 'N', 75),
  ('15N:杖', 'ジェネシススタッフ', '武器', '杖', null, 15, 'N', 75),
  ('15N:書', '創世記', '武器', '書', null, 15, 'N', 75),
  ('15N:投擲', 'ジェネシスチャクラム', '武器', '投擲', null, 15, 'N', 75),
  ('15N:刀', 'ジェネシスカタナ', '武器', '刀', null, 15, 'N', 75),
  ('15N:宝珠', 'ブラックダイヤオーブ', '武器', '宝珠', null, 15, 'N', 75),
  ('15N:重鎧頭', 'ジェネシスヘルム', '頭', '重鎧', '重鎧', 15, 'N', 75),
  ('15N:重鎧鎧', 'ジェネシスメイル', '鎧', '重鎧', '重鎧', 15, 'N', 75),
  ('15N:重鎧腕', 'ジェネシスガントレット', '腕', '重鎧', '重鎧', 15, 'N', 75),
  ('15N:重鎧足', 'ジェネシスグリーヴ', '足', '重鎧', '重鎧', 15, 'N', 75),
  ('15N:軽装頭', 'ジェネシスフード', '頭', '軽装', '軽装', 15, 'N', 75),
  ('15N:軽装鎧', 'ジェネシスコート', '鎧', '軽装', '軽装', 15, 'N', 75),
  ('15N:軽装腕', 'ジェネシスグローブ', '腕', '軽装', '軽装', 15, 'N', 75),
  ('15N:軽装足', 'ジェネシスブーツ', '足', '軽装', '軽装', 15, 'N', 75),
  ('15N:リング', 'ブラックダイヤリング', 'アクセ', 'リング', null, 15, 'N', 75),
  ('15N:イヤリング', 'ブラックダイヤイヤリング', 'アクセ', 'イヤリング', null, 15, 'N', 75),
  ('15N:ベルト', 'ブラックダイヤベルト', 'アクセ', 'ベルト', null, 15, 'N', 75),
  ('15N:ネックレス', 'ブラックダイヤネックレス', 'アクセ', 'ネックレス', null, 15, 'N', 75),
  ('15R:片手剣', '古都の宝剣', '武器', '片手剣', null, 15, 'R', 80),
  ('15R:両手剣', 'アビスブリンガー', '武器', '両手剣', null, 15, 'R', 80),
  ('15R:斧', '鯨骨の斧', '武器', '斧', null, 15, 'R', 80),
  ('15R:槍', '海王の三叉槍', '武器', '槍', null, 15, 'R', 80),
  ('15R:鈍器', 'クラーケンの触腕', '武器', '鈍器', null, 15, 'R', 80),
  ('15R:短剣', 'メガロドンの歯', '武器', '短剣', null, 15, 'R', 80),
  ('15R:拳', 'サカマタナックル', '武器', '拳', null, 15, 'R', 80),
  ('15R:弓', 'ローレライの竪琴', '武器', '弓', null, 15, 'R', 80),
  ('15R:銃', 'ハープーンガン', '武器', '銃', null, 15, 'R', 80),
  ('15R:杖', '海魔女の杖', '武器', '杖', null, 15, 'R', 80),
  ('15R:書', '海底古文書', '武器', '書', null, 15, 'R', 80),
  ('15R:投擲', 'ルミナスディスク', '武器', '投擲', null, 15, 'R', 80),
  ('15R:刀', '黒潮', '武器', '刀', null, 15, 'R', 80),
  ('15R:宝珠', '深海の真珠球', '武器', '宝珠', null, 15, 'R', 80),
  ('15R:重鎧頭', 'リヴァイアヘルム', '頭', '重鎧', '重鎧', 15, 'R', 80),
  ('15R:重鎧鎧', 'リヴァイアメイル', '鎧', '重鎧', '重鎧', 15, 'R', 80),
  ('15R:重鎧腕', 'リヴァイアガントレット', '腕', '重鎧', '重鎧', 15, 'R', 80),
  ('15R:重鎧足', 'リヴァイアグリーヴ', '足', '重鎧', '重鎧', 15, 'R', 80),
  ('15R:軽装頭', '海淵の頭巾', '頭', '軽装', '軽装', 15, 'R', 80),
  ('15R:軽装鎧', '海淵の衣', '鎧', '軽装', '軽装', 15, 'R', 80),
  ('15R:軽装腕', '海淵の手袋', '腕', '軽装', '軽装', 15, 'R', 80),
  ('15R:軽装足', '海淵の靴', '足', '軽装', '軽装', 15, 'R', 80),
  ('15R:リング', '黒真珠の指輪', 'アクセ', 'リング', null, 15, 'R', 80),
  ('15R:イヤリング', '燐光の耳飾り', 'アクセ', 'イヤリング', null, 15, 'R', 80),
  ('15R:ベルト', '海竜鱗の帯', 'アクセ', 'ベルト', null, 15, 'R', 80),
  ('15R:ネックレス', '深淵の瞳', 'アクセ', 'ネックレス', null, 15, 'R', 80),
  ('15E:片手剣', '海王剣リヴァイアサン', '武器', '片手剣', null, 15, 'E', 85),
  ('15E:両手剣', '深淵竜の大剣', '武器', '両手剣', null, 15, 'E', 85),
  ('15E:斧', '巨鯨の顎斧', '武器', '斧', null, 15, 'E', 85),
  ('15E:槍', '深淵蛇の槍', '武器', '槍', null, 15, 'E', 85),
  ('15E:鈍器', '王烏賊の鎚', '武器', '鈍器', null, 15, 'E', 85),
  ('15E:短剣', 'キルケの毒刃', '武器', '短剣', null, 15, 'E', 85),
  ('15E:拳', '覇王の鱗拳', '武器', '拳', null, 15, 'E', 85),
  ('15E:弓', '女王の歌弓', '武器', '弓', null, 15, 'E', 85),
  ('15E:銃', '巨鯨砲', '武器', '銃', null, 15, 'E', 85),
  ('15E:杖', 'キルケの杖', '武器', '杖', null, 15, 'E', 85),
  ('15E:書', '原初の海の書', '武器', '書', null, 15, 'E', 85),
  ('15E:投擲', '大海月の光輪', '武器', '投擲', null, 15, 'E', 85),
  ('15E:刀', '鯨切り', '武器', '刀', null, 15, 'E', 85),
  ('15E:宝珠', 'クラーケンの墨珠', '武器', '宝珠', null, 15, 'E', 85),
  ('15E:重鎧頭', '深淵竜の兜', '頭', '重鎧', '重鎧', 15, 'E', 85),
  ('15E:重鎧鎧', '深淵竜の鎧', '鎧', '重鎧', '重鎧', 15, 'E', 85),
  ('15E:重鎧腕', '深淵竜の篭手', '腕', '重鎧', '重鎧', 15, 'E', 85),
  ('15E:重鎧足', '深淵竜の具足', '足', '重鎧', '重鎧', 15, 'E', 85),
  ('15E:軽装頭', 'ローレライティアラ', '頭', '軽装', '軽装', 15, 'E', 85),
  ('15E:軽装鎧', 'ローレライドレス', '鎧', '軽装', '軽装', 15, 'E', 85),
  ('15E:軽装腕', 'ローレライグローブ', '腕', '軽装', '軽装', 15, 'E', 85),
  ('15E:軽装足', 'ローレライサンダル', '足', '軽装', '軽装', 15, 'E', 85),
  ('15E:リング', 'クラーケン王の指輪', 'アクセ', 'リング', null, 15, 'E', 85),
  ('15E:イヤリング', 'ルミナの光珠', 'アクセ', 'イヤリング', null, 15, 'E', 85),
  ('15E:ベルト', '海蛇王の鱗帯', 'アクセ', 'ベルト', null, 15, 'E', 85),
  ('15E:ネックレス', 'リヴァイアサンの心臓', 'アクセ', 'ネックレス', null, 15, 'E', 85),
  ('15L:片手剣', '終焉剣オメガ', '武器', '片手剣', null, 15, 'L', 90),
  ('15L:両手剣', '大海の怒り', '武器', '両手剣', null, 15, 'L', 90),
  ('15L:斧', '海溝断ち', '武器', '斧', null, 15, 'L', 90),
  ('15L:槍', '深海覇槍', '武器', '槍', null, 15, 'L', 90),
  ('15L:鈍器', '海鳴りの鎚', '武器', '鈍器', null, 15, 'L', 90),
  ('15L:短剣', '魔女の口づけ', '武器', '短剣', null, 15, 'L', 90),
  ('15L:拳', '覇海拳', '武器', '拳', null, 15, 'L', 90),
  ('15L:弓', '海の歌姫', '武器', '弓', null, 15, 'L', 90),
  ('15L:銃', 'アビスノヴァ', '武器', '銃', null, 15, 'L', 90),
  ('15L:杖', '変化の杖', '武器', '杖', null, 15, 'L', 90),
  ('15L:書', '終わりの物語', '武器', '書', null, 15, 'L', 90),
  ('15L:投擲', '燐光の神輪', '武器', '投擲', null, 15, 'L', 90),
  ('15L:刀', '終の太刀', '武器', '刀', null, 15, 'L', 90),
  ('15L:宝珠', '母なる海の珠', '武器', '宝珠', null, 15, 'L', 90),
  ('15L:重鎧頭', '海覇王の兜', '頭', '重鎧', '重鎧', 15, 'L', 90),
  ('15L:重鎧鎧', '海覇王の鎧', '鎧', '重鎧', '重鎧', 15, 'L', 90),
  ('15L:重鎧腕', '海覇王の篭手', '腕', '重鎧', '重鎧', 15, 'L', 90),
  ('15L:重鎧足', '海覇王の具足', '足', '重鎧', '重鎧', 15, 'L', 90),
  ('15L:軽装頭', 'ルミナスティアラ', '頭', '軽装', '軽装', 15, 'L', 90),
  ('15L:軽装鎧', 'ルミナスドレス', '鎧', '軽装', '軽装', 15, 'L', 90),
  ('15L:軽装腕', 'ルミナスグローブ', '腕', '軽装', '軽装', 15, 'L', 90),
  ('15L:軽装足', 'ルミナスサンダル', '足', '軽装', '軽装', 15, 'L', 90),
  ('15L:リング', '深海王の指輪', 'アクセ', 'リング', null, 15, 'L', 90),
  ('15L:イヤリング', '魔女の囁き', 'アクセ', 'イヤリング', null, 15, 'L', 90),
  ('15L:ベルト', '海竜王の帯', 'アクセ', 'ベルト', null, 15, 'L', 90),
  ('15L:ネックレス', '終焉の真珠', 'アクセ', 'ネックレス', null, 15, 'L', 90)
on conflict (id) do update set name = excluded.name, part = excluded.part, type = excluded.type, line = excluded.line,
  area = excluded.area, rarity = excluded.rarity, lv = excluded.lv;
-- @@end:equipment

-- ---- 1-5. 場所（15エリア×①②③＝45か所）----
-- ★2026-10-09 エリアの作り替え（ユーザー指示）：難易度帯（v2cap_tiers）とエリア（v2cap_areas）をやめて、
--   場所の1本道にした。どちらもマスタだけの表（キャラのデータは指していない）なので消してよい
drop table if exists public.v2cap_tiers;
drop table if exists public.v2cap_areas;
-- id … 1〜45（並び＝開く順）／area・sub … エリアの番号（1〜15）と ①②③
-- exp_* / gold_* … 1体あたりの経験値とGoldの範囲（役割の倍率を掛ける前）
-- lv_* … その場所の敵のLVの範囲（★装備のアイテムLVは装備ごと＝ v2cap_equipment.lv）
-- ★落ちる装備のレア度の内訳は敵の役割と①②③で決まる（src/v2cap/lib/sortie.js の dropRarityOf）。
--   サーバーは「その役割の敵から落ちるレア度か」だけを見る（v2cap_sortie_settle）
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
  lv_max     int  not null
);
-- 前の形（ランクの重み drop_ranks）の列を消す。★種を入れる前に（列が残っていると入れられない）
alter table public.v2cap_spots drop column if exists drop_ranks;
-- 前の形（アイテムLVを場所ごとに持っていた item_lv）の列も消す。アイテムLVは装備の必要LV（v2cap_equipment.lv）
alter table public.v2cap_spots drop column if exists item_lv;
alter table public.v2cap_spots enable row level security;
drop policy if exists v2cap_spots_read on public.v2cap_spots;
create policy v2cap_spots_read on public.v2cap_spots for select to authenticated using (true);
revoke all on table public.v2cap_spots from anon;
grant select on table public.v2cap_spots to authenticated;

-- @@seed:spots
delete from public.v2cap_spots;
insert into public.v2cap_spots (id, area, sub, area_name, name, exp_min, exp_max, gold_min, gold_max, lv_min, lv_max) values
  (1, 1, 1, '始まりの森', '木漏れ日の小径', 2, 3, 10, 15, 1, 10),
  (2, 1, 2, '始まりの森', '苔むした獣道', 2, 4, 10, 17, 1, 12),
  (3, 1, 3, '始まりの森', '森主の古樹', 3, 5, 10, 20, 2, 15),
  (4, 2, 1, '荒廃した草原', '風吹く丘陵', 4, 5, 15, 20, 16, 17),
  (5, 2, 2, '荒廃した草原', '焼け落ちた廃村', 4, 6, 15, 22, 16, 18),
  (6, 2, 3, '荒廃した草原', '骸の古戦場', 5, 7, 15, 25, 17, 20),
  (7, 3, 1, '古代の洞窟', '鍾乳の回廊', 6, 7, 20, 25, 21, 22),
  (8, 3, 2, '古代の洞窟', '刻印の大広間', 6, 8, 20, 27, 21, 23),
  (9, 3, 3, '古代の洞窟', '封じられし石室', 7, 9, 20, 30, 22, 26),
  (10, 4, 1, '蒼海の入り江', '白砂の浜辺', 8, 9, 25, 30, 27, 27),
  (11, 4, 2, '蒼海の入り江', '難破船の墓場', 8, 10, 25, 32, 27, 29),
  (12, 4, 3, '蒼海の入り江', '大渦の海蝕洞', 9, 11, 25, 35, 27, 30),
  (13, 5, 1, '灼砂の遺丘', '陽炎の砂原', 10, 11, 30, 35, 31, 31),
  (14, 5, 2, '灼砂の遺丘', '埋もれし神殿', 10, 12, 30, 37, 31, 32),
  (15, 5, 3, '灼砂の遺丘', '砂王の玄室', 11, 13, 30, 40, 31, 34),
  (16, 6, 1, '巨峰山脈', '岩肌の山道', 12, 13, 35, 40, 35, 37),
  (17, 6, 2, '巨峰山脈', '風哭きの峠', 12, 14, 35, 42, 35, 39),
  (18, 6, 3, '巨峰山脈', '天衝く頂', 13, 15, 35, 45, 36, 43),
  (19, 7, 1, '常闇の樹海', '黄昏の境界', 14, 15, 40, 45, 44, 45),
  (20, 7, 2, '常闇の樹海', '惑い霧の迷路', 14, 16, 40, 47, 44, 46),
  (21, 7, 3, '常闇の樹海', '光喰らいの大樹', 15, 17, 40, 50, 45, 49),
  (22, 8, 1, '白銀の霊峰', '凍てつく雪原', 16, 17, 45, 50, 50, 51),
  (23, 8, 2, '白銀の霊峰', '氷晶の大洞', 16, 18, 45, 52, 50, 53),
  (24, 8, 3, '白銀の霊峰', '白霊の祭壇', 17, 19, 45, 55, 51, 56),
  (25, 9, 1, '雷鳴の断崖', '稲光の岩棚', 18, 19, 50, 55, 57, 58),
  (26, 9, 2, '雷鳴の断崖', '轟雷の架け橋', 18, 20, 50, 57, 57, 59),
  (27, 9, 3, '雷鳴の断崖', '雷帝の玉座', 19, 21, 50, 60, 58, 62),
  (28, 10, 1, '煉獄火山', '噴煙の山麓', 20, 21, 55, 60, 63, 63),
  (29, 10, 2, '煉獄火山', '溶岩の大河', 20, 22, 55, 62, 63, 64),
  (30, 10, 3, '煉獄火山', '業火の炉心', 21, 23, 55, 65, 63, 65),
  (31, 11, 1, '腐海の沼獄', '瘴気漂う湿原', 22, 23, 60, 65, 66, 66),
  (32, 11, 2, '腐海の沼獄', '沈みし廃村', 22, 24, 60, 67, 66, 67),
  (33, 11, 3, '腐海の沼獄', '腐王の苗床', 23, 25, 60, 70, 66, 68),
  (34, 12, 1, '奈落の坑道', '廃れた採掘場', 24, 25, 65, 70, 69, 69),
  (35, 12, 2, '奈落の坑道', '底なしの大縦穴', 24, 26, 65, 72, 69, 70),
  (36, 12, 3, '奈落の坑道', '掘り当てられし禁域', 25, 27, 65, 75, 69, 71),
  (37, 13, 1, '蒼天の浮遊城', '雲海の桟橋', 26, 27, 70, 75, 72, 72),
  (38, 13, 2, '蒼天の浮遊城', '浮かぶ空中庭園', 26, 28, 70, 77, 72, 73),
  (39, 13, 3, '蒼天の浮遊城', '天主の謁見の間', 27, 29, 70, 80, 72, 74),
  (40, 14, 1, '星霜の遺跡', '風化した列柱廊', 28, 29, 75, 80, 75, 75),
  (41, 14, 2, '星霜の遺跡', '時止まりの大書庫', 28, 30, 75, 82, 75, 76),
  (42, 14, 3, '星霜の遺跡', '星墜ちる観測台', 29, 31, 75, 85, 75, 77),
  (43, 15, 1, '深淵の海溝', '燐光の海棚', 30, 31, 80, 85, 78, 78),
  (44, 15, 2, '深淵の海溝', '沈みし古都', 30, 32, 80, 87, 78, 79),
  (45, 15, 3, '深淵の海溝', '原初の深淵', 31, 33, 80, 90, 78, 80);
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
  ('コウモリ', 1, 2, 'normal', null),
  ('ツユフェアリー', 1, 2, 'timed', '朝'),
  ('モヤガエル', 1, 2, 'timed', '朝'),
  ('ひなたトカゲ', 1, 2, 'timed', '昼'),
  ('ひなたアゲハ', 1, 2, 'timed', '昼'),
  ('ツキミミズク', 1, 2, 'timed', '晩'),
  ('ヨナキコオロギ', 1, 2, 'timed', '晩'),
  ('ジェイドスライム', 1, 10, 'rare', null),
  ('エンシェントトレント', 1, 10, 'rare', null),
  ('オーロラフェアリー', 1, 10, 'rare', '朝'),
  ('サンリザード', 1, 10, 'rare', '昼'),
  ('ナイトオウル', 1, 10, 'rare', '晩'),
  ('オヤブンネズミ', 1, 10, 'boss', null),
  ('スライム', 2, 1, 'normal', null),
  ('コウモリ', 2, 2, 'normal', null),
  ('毒キノコ', 2, 10, 'normal', null),
  ('森ネズミ', 2, 11, 'normal', null),
  ('ツユフェアリー', 2, 2, 'timed', '朝'),
  ('モヤガエル', 2, 2, 'timed', '朝'),
  ('ひなたトカゲ', 2, 2, 'timed', '昼'),
  ('ひなたアゲハ', 2, 2, 'timed', '昼'),
  ('ツキミミズク', 2, 2, 'timed', '晩'),
  ('ヨナキコオロギ', 2, 2, 'timed', '晩'),
  ('ジェイドスライム', 2, 10, 'rare', null),
  ('エンシェントトレント', 2, 10, 'rare', null),
  ('オーロラフェアリー', 2, 10, 'rare', '朝'),
  ('サンリザード', 2, 10, 'rare', '昼'),
  ('ナイトオウル', 2, 10, 'rare', '晩'),
  ('クイーンアント', 2, 12, 'boss', null),
  ('毒キノコ', 3, 10, 'normal', null),
  ('森ネズミ', 3, 11, 'normal', null),
  ('オオアリ', 3, 12, 'normal', null),
  ('つるヘビ', 3, 13, 'normal', null),
  ('ツユフェアリー', 3, 2, 'timed', '朝'),
  ('モヤガエル', 3, 2, 'timed', '朝'),
  ('ひなたトカゲ', 3, 2, 'timed', '昼'),
  ('ひなたアゲハ', 3, 2, 'timed', '昼'),
  ('ツキミミズク', 3, 2, 'timed', '晩'),
  ('ヨナキコオロギ', 3, 2, 'timed', '晩'),
  ('ジェイドスライム', 3, 10, 'rare', null),
  ('エンシェントトレント', 3, 10, 'rare', null),
  ('オーロラフェアリー', 3, 10, 'rare', '朝'),
  ('サンリザード', 3, 10, 'rare', '昼'),
  ('ナイトオウル', 3, 10, 'rare', '晩'),
  ('ビッグスライム', 3, 15, 'boss', null),
  ('ゴブリン', 4, 16, 'normal', null),
  ('野良犬', 4, 17, 'normal', null),
  ('霧這いワーム', 4, 17, 'timed', '朝'),
  ('オオトビバッタ', 4, 17, 'timed', '朝'),
  ('陽炎リザード', 4, 17, 'timed', '昼'),
  ('炎天ハゲタカ', 4, 17, 'timed', '昼'),
  ('夜盗スカウト', 4, 17, 'timed', '晩'),
  ('夜盗ハウンド', 4, 17, 'timed', '晩'),
  ('ホブゴブリン', 4, 17, 'rare', null),
  ('シルバーフェンリル', 4, 17, 'rare', null),
  ('ミストワーム', 4, 17, 'rare', '朝'),
  ('フレアバジリスク', 4, 17, 'rare', '昼'),
  ('シャドウシーフ', 4, 17, 'rare', '晩'),
  ('群れ長グレイファング', 4, 17, 'boss', null),
  ('ゴブリン', 5, 16, 'normal', null),
  ('野良犬', 5, 17, 'normal', null),
  ('盗賊', 5, 17, 'normal', null),
  ('草原オオカミ', 5, 18, 'normal', null),
  ('霧這いワーム', 5, 17, 'timed', '朝'),
  ('オオトビバッタ', 5, 17, 'timed', '朝'),
  ('陽炎リザード', 5, 17, 'timed', '昼'),
  ('炎天ハゲタカ', 5, 17, 'timed', '昼'),
  ('夜盗スカウト', 5, 17, 'timed', '晩'),
  ('夜盗ハウンド', 5, 17, 'timed', '晩'),
  ('ホブゴブリン', 5, 17, 'rare', null),
  ('シルバーフェンリル', 5, 17, 'rare', null),
  ('ミストワーム', 5, 17, 'rare', '朝'),
  ('フレアバジリスク', 5, 17, 'rare', '昼'),
  ('シャドウシーフ', 5, 17, 'rare', '晩'),
  ('ゴブリンチーフ', 5, 18, 'boss', null),
  ('盗賊', 6, 17, 'normal', null),
  ('草原オオカミ', 6, 18, 'normal', null),
  ('ゴブリン射手', 6, 18, 'normal', null),
  ('キバイノシシ', 6, 19, 'normal', null),
  ('霧這いワーム', 6, 17, 'timed', '朝'),
  ('オオトビバッタ', 6, 17, 'timed', '朝'),
  ('陽炎リザード', 6, 17, 'timed', '昼'),
  ('炎天ハゲタカ', 6, 17, 'timed', '昼'),
  ('夜盗スカウト', 6, 17, 'timed', '晩'),
  ('夜盗ハウンド', 6, 17, 'timed', '晩'),
  ('ホブゴブリン', 6, 17, 'rare', null),
  ('シルバーフェンリル', 6, 17, 'rare', null),
  ('ミストワーム', 6, 17, 'rare', '朝'),
  ('フレアバジリスク', 6, 17, 'rare', '昼'),
  ('シャドウシーフ', 6, 17, 'rare', '晩'),
  ('盗賊団のリーダー', 6, 20, 'boss', null),
  ('コボルト', 7, 21, 'normal', null),
  ('スケルトン', 7, 22, 'normal', null),
  ('暁ガーゴイル', 7, 22, 'timed', '朝'),
  ('ヨロイムカデ', 7, 22, 'timed', '朝'),
  ('石化トカゲ', 7, 22, 'timed', '昼'),
  ('イワサソリ', 7, 22, 'timed', '昼'),
  ('サマヨイレイス', 7, 22, 'timed', '晩'),
  ('亡霊コボルト', 7, 22, 'timed', '晩'),
  ('オブシディアンコボルト', 7, 22, 'rare', null),
  ('スケルトンナイト', 7, 22, 'rare', null),
  ('ドーンガーゴイル', 7, 22, 'rare', '朝'),
  ('ロックバジリスク', 7, 22, 'rare', '昼'),
  ('ダークレイス', 7, 22, 'rare', '晩'),
  ('コボルト族長ドグラ', 7, 22, 'boss', null),
  ('コボルト', 8, 21, 'normal', null),
  ('スケルトン', 8, 22, 'normal', null),
  ('ストーンゴーレム', 8, 22, 'normal', null),
  ('ホラアナグモ', 8, 23, 'normal', null),
  ('暁ガーゴイル', 8, 22, 'timed', '朝'),
  ('ヨロイムカデ', 8, 22, 'timed', '朝'),
  ('石化トカゲ', 8, 22, 'timed', '昼'),
  ('イワサソリ', 8, 22, 'timed', '昼'),
  ('サマヨイレイス', 8, 22, 'timed', '晩'),
  ('亡霊コボルト', 8, 22, 'timed', '晩'),
  ('オブシディアンコボルト', 8, 22, 'rare', null),
  ('スケルトンナイト', 8, 22, 'rare', null),
  ('ドーンガーゴイル', 8, 22, 'rare', '朝'),
  ('ロックバジリスク', 8, 22, 'rare', '昼'),
  ('ダークレイス', 8, 22, 'rare', '晩'),
  ('ボーンジェネラル', 8, 23, 'boss', null),
  ('ストーンゴーレム', 9, 22, 'normal', null),
  ('ホラアナグモ', 9, 23, 'normal', null),
  ('コボルト投石手', 9, 23, 'normal', null),
  ('スケルトンドッグ', 9, 24, 'normal', null),
  ('暁ガーゴイル', 9, 22, 'timed', '朝'),
  ('ヨロイムカデ', 9, 22, 'timed', '朝'),
  ('石化トカゲ', 9, 22, 'timed', '昼'),
  ('イワサソリ', 9, 22, 'timed', '昼'),
  ('サマヨイレイス', 9, 22, 'timed', '晩'),
  ('亡霊コボルト', 9, 22, 'timed', '晩'),
  ('オブシディアンコボルト', 9, 22, 'rare', null),
  ('スケルトンナイト', 9, 22, 'rare', null),
  ('ドーンガーゴイル', 9, 22, 'rare', '朝'),
  ('ロックバジリスク', 9, 22, 'rare', '昼'),
  ('ダークレイス', 9, 22, 'rare', '晩'),
  ('古代の番人', 9, 26, 'boss', null),
  ('サハギン', 10, 27, 'normal', null),
  ('海賊', 10, 27, 'normal', null),
  ('朝凪のセイレーン', 10, 27, 'timed', '朝'),
  ('ギンバネトビウオ', 10, 27, 'timed', '朝'),
  ('シオマネキ', 10, 27, 'timed', '昼'),
  ('オオウミガメ', 10, 27, 'timed', '昼'),
  ('夜光アンコウ', 10, 27, 'timed', '晩'),
  ('ホタルダコ', 10, 27, 'timed', '晩'),
  ('コーラルナイト', 10, 27, 'rare', null),
  ('ベビークラーケン', 10, 27, 'rare', null),
  ('サンライズセイレーン', 10, 27, 'rare', '朝'),
  ('ジャイアントクラブ', 10, 27, 'rare', '昼'),
  ('ランタンアンコウ', 10, 27, 'rare', '晩'),
  ('鉄鋏ヨロイガニ', 10, 27, 'boss', null),
  ('サハギン', 11, 27, 'normal', null),
  ('海賊', 11, 27, 'normal', null),
  ('毒クラゲ', 11, 27, 'normal', null),
  ('イリエザメ', 11, 28, 'normal', null),
  ('朝凪のセイレーン', 11, 27, 'timed', '朝'),
  ('ギンバネトビウオ', 11, 27, 'timed', '朝'),
  ('シオマネキ', 11, 27, 'timed', '昼'),
  ('オオウミガメ', 11, 27, 'timed', '昼'),
  ('夜光アンコウ', 11, 27, 'timed', '晩'),
  ('ホタルダコ', 11, 27, 'timed', '晩'),
  ('コーラルナイト', 11, 27, 'rare', null),
  ('ベビークラーケン', 11, 27, 'rare', null),
  ('サンライズセイレーン', 11, 27, 'rare', '朝'),
  ('ジャイアントクラブ', 11, 27, 'rare', '昼'),
  ('ランタンアンコウ', 11, 27, 'rare', '晩'),
  ('海賊船長ガルシオ', 11, 29, 'boss', null),
  ('毒クラゲ', 12, 27, 'normal', null),
  ('イリエザメ', 12, 28, 'normal', null),
  ('大ウミヘビ', 12, 29, 'normal', null),
  ('海賊砲手', 12, 30, 'normal', null),
  ('朝凪のセイレーン', 12, 27, 'timed', '朝'),
  ('ギンバネトビウオ', 12, 27, 'timed', '朝'),
  ('シオマネキ', 12, 27, 'timed', '昼'),
  ('オオウミガメ', 12, 27, 'timed', '昼'),
  ('夜光アンコウ', 12, 27, 'timed', '晩'),
  ('ホタルダコ', 12, 27, 'timed', '晩'),
  ('コーラルナイト', 12, 27, 'rare', null),
  ('ベビークラーケン', 12, 27, 'rare', null),
  ('サンライズセイレーン', 12, 27, 'rare', '朝'),
  ('ジャイアントクラブ', 12, 27, 'rare', '昼'),
  ('ランタンアンコウ', 12, 27, 'rare', '晩'),
  ('シーサーペント', 12, 30, 'boss', null),
  ('砂喰いワーム', 13, 31, 'normal', null),
  ('墓守ミイラ', 13, 31, 'normal', null),
  ('カゲロウトカゲ', 13, 31, 'timed', '朝'),
  ('聖スカラベ', 13, 31, 'timed', '朝'),
  ('アヌビス兵', 13, 31, 'timed', '昼'),
  ('熱砂コブラ', 13, 31, 'timed', '昼'),
  ('月影ジャッカル', 13, 31, 'timed', '晩'),
  ('ワライハイエナ', 13, 31, 'timed', '晩'),
  ('サンドワーム', 13, 31, 'rare', null),
  ('ゴールデンマミー', 13, 31, 'rare', null),
  ('ミラージュリザード', 13, 31, 'rare', '朝'),
  ('フレイムアヌビス', 13, 31, 'rare', '昼'),
  ('ルナジャッカル', 13, 31, 'rare', '晩'),
  ('砂地獄アントリオン', 13, 31, 'boss', null),
  ('砂喰いワーム', 14, 31, 'normal', null),
  ('墓守ミイラ', 14, 31, 'normal', null),
  ('サンドスコーピオン', 14, 31, 'normal', null),
  ('ツボミミック', 14, 32, 'normal', null),
  ('カゲロウトカゲ', 14, 31, 'timed', '朝'),
  ('聖スカラベ', 14, 31, 'timed', '朝'),
  ('アヌビス兵', 14, 31, 'timed', '昼'),
  ('熱砂コブラ', 14, 31, 'timed', '昼'),
  ('月影ジャッカル', 14, 31, 'timed', '晩'),
  ('ワライハイエナ', 14, 31, 'timed', '晩'),
  ('サンドワーム', 14, 31, 'rare', null),
  ('ゴールデンマミー', 14, 31, 'rare', null),
  ('ミラージュリザード', 14, 31, 'rare', '朝'),
  ('フレイムアヌビス', 14, 31, 'rare', '昼'),
  ('ルナジャッカル', 14, 31, 'rare', '晩'),
  ('ミイラ大神官', 14, 32, 'boss', null),
  ('サンドスコーピオン', 15, 31, 'normal', null),
  ('ツボミミック', 15, 32, 'normal', null),
  ('サンドゴーレム', 15, 32, 'normal', null),
  ('盗掘者', 15, 33, 'normal', null),
  ('カゲロウトカゲ', 15, 31, 'timed', '朝'),
  ('聖スカラベ', 15, 31, 'timed', '朝'),
  ('アヌビス兵', 15, 31, 'timed', '昼'),
  ('熱砂コブラ', 15, 31, 'timed', '昼'),
  ('月影ジャッカル', 15, 31, 'timed', '晩'),
  ('ワライハイエナ', 15, 31, 'timed', '晩'),
  ('サンドワーム', 15, 31, 'rare', null),
  ('ゴールデンマミー', 15, 31, 'rare', null),
  ('ミラージュリザード', 15, 31, 'rare', '朝'),
  ('フレイムアヌビス', 15, 31, 'rare', '昼'),
  ('ルナジャッカル', 15, 31, 'rare', '晩'),
  ('砂皇スカラベウス', 15, 34, 'boss', null),
  ('山岳ゴブリン', 16, 35, 'normal', null),
  ('岩石ゴーレム', 16, 36, 'normal', null),
  ('払暁のワイバーン', 16, 36, 'timed', '朝'),
  ('ハヤテハヤブサ', 16, 36, 'timed', '朝'),
  ('剛猿', 16, 36, 'timed', '昼'),
  ('鉄針ヤマアラシ', 16, 36, 'timed', '昼'),
  ('宵闇ヤマネコ', 16, 36, 'timed', '晩'),
  ('トオボエウルフ', 16, 36, 'timed', '晩'),
  ('ストームグリフォン', 16, 37, 'rare', null),
  ('マウンテンゴーレム', 16, 37, 'rare', null),
  ('ドーンワイバーン', 16, 37, 'rare', '朝'),
  ('ブレイズゴリラ', 16, 37, 'rare', '昼'),
  ('シャドウキャット', 16, 37, 'rare', '晩'),
  ('岩砕きグリズリー', 16, 37, 'boss', null),
  ('山岳ゴブリン', 17, 35, 'normal', null),
  ('岩石ゴーレム', 17, 36, 'normal', null),
  ('グリフォン', 17, 37, 'normal', null),
  ('ミネオオワシ', 17, 38, 'normal', null),
  ('払暁のワイバーン', 17, 36, 'timed', '朝'),
  ('ハヤテハヤブサ', 17, 36, 'timed', '朝'),
  ('剛猿', 17, 36, 'timed', '昼'),
  ('鉄針ヤマアラシ', 17, 36, 'timed', '昼'),
  ('宵闇ヤマネコ', 17, 36, 'timed', '晩'),
  ('トオボエウルフ', 17, 36, 'timed', '晩'),
  ('ストームグリフォン', 17, 37, 'rare', null),
  ('マウンテンゴーレム', 17, 37, 'rare', null),
  ('ドーンワイバーン', 17, 37, 'rare', '朝'),
  ('ブレイズゴリラ', 17, 37, 'rare', '昼'),
  ('シャドウキャット', 17, 37, 'rare', '晩'),
  ('峠守ギガトロール', 17, 39, 'boss', null),
  ('グリフォン', 18, 37, 'normal', null),
  ('ミネオオワシ', 18, 38, 'normal', null),
  ('山岳トロール', 18, 39, 'normal', null),
  ('イワグマ', 18, 40, 'normal', null),
  ('払暁のワイバーン', 18, 36, 'timed', '朝'),
  ('ハヤテハヤブサ', 18, 36, 'timed', '朝'),
  ('剛猿', 18, 36, 'timed', '昼'),
  ('鉄針ヤマアラシ', 18, 36, 'timed', '昼'),
  ('宵闇ヤマネコ', 18, 36, 'timed', '晩'),
  ('トオボエウルフ', 18, 36, 'timed', '晩'),
  ('ストームグリフォン', 18, 37, 'rare', null),
  ('マウンテンゴーレム', 18, 37, 'rare', null),
  ('ドーンワイバーン', 18, 37, 'rare', '朝'),
  ('ブレイズゴリラ', 18, 37, 'rare', '昼'),
  ('シャドウキャット', 18, 37, 'rare', '晩'),
  ('雷鷲サンダーロック', 18, 43, 'boss', null),
  ('食人樹', 19, 44, 'normal', null),
  ('マンドラゴラ', 19, 45, 'normal', null),
  ('霧纏いトレント', 19, 45, 'timed', '朝'),
  ('胞子マイコニド', 19, 45, 'timed', '朝'),
  ('コモレビピクシー', 19, 45, 'timed', '昼'),
  ('ヨロイカブト', 19, 45, 'timed', '昼'),
  ('ナゲキバンシー', 19, 45, 'timed', '晩'),
  ('チスイオオコウモリ', 19, 45, 'timed', '晩'),
  ('キラープラント', 19, 45, 'rare', null),
  ('クイーンマンドラゴラ', 19, 45, 'rare', null),
  ('ミストトレント', 19, 45, 'rare', '朝'),
  ('サンライトピクシー', 19, 45, 'rare', '昼'),
  ('グリーフバンシー', 19, 45, 'rare', '晩'),
  ('妖蛾ポイズンモス', 19, 45, 'boss', null),
  ('食人樹', 20, 44, 'normal', null),
  ('マンドラゴラ', 20, 45, 'normal', null),
  ('シャドウウルフ', 20, 45, 'normal', null),
  ('オオドクガ', 20, 46, 'normal', null),
  ('霧纏いトレント', 20, 45, 'timed', '朝'),
  ('胞子マイコニド', 20, 45, 'timed', '朝'),
  ('コモレビピクシー', 20, 45, 'timed', '昼'),
  ('ヨロイカブト', 20, 45, 'timed', '昼'),
  ('ナゲキバンシー', 20, 45, 'timed', '晩'),
  ('チスイオオコウモリ', 20, 45, 'timed', '晩'),
  ('キラープラント', 20, 45, 'rare', null),
  ('クイーンマンドラゴラ', 20, 45, 'rare', null),
  ('ミストトレント', 20, 45, 'rare', '朝'),
  ('サンライトピクシー', 20, 45, 'rare', '昼'),
  ('グリーフバンシー', 20, 45, 'rare', '晩'),
  ('霧魔女ミルヴァ', 20, 46, 'boss', null),
  ('シャドウウルフ', 21, 45, 'normal', null),
  ('オオドクガ', 21, 46, 'normal', null),
  ('モスゴーレム', 21, 46, 'normal', null),
  ('シメコロシカズラ', 21, 47, 'normal', null),
  ('霧纏いトレント', 21, 45, 'timed', '朝'),
  ('胞子マイコニド', 21, 45, 'timed', '朝'),
  ('コモレビピクシー', 21, 45, 'timed', '昼'),
  ('ヨロイカブト', 21, 45, 'timed', '昼'),
  ('ナゲキバンシー', 21, 45, 'timed', '晩'),
  ('チスイオオコウモリ', 21, 45, 'timed', '晩'),
  ('キラープラント', 21, 45, 'rare', null),
  ('クイーンマンドラゴラ', 21, 45, 'rare', null),
  ('ミストトレント', 21, 45, 'rare', '朝'),
  ('サンライトピクシー', 21, 45, 'rare', '昼'),
  ('グリーフバンシー', 21, 45, 'rare', '晩'),
  ('森王エルダートレント', 21, 49, 'boss', null),
  ('雪男', 22, 50, 'normal', null),
  ('氷河ドレイク', 22, 51, 'normal', null),
  ('銀嶺ウルフ', 22, 51, 'timed', '朝'),
  ('アイスエルク', 22, 51, 'timed', '朝'),
  ('樹氷精', 22, 51, 'timed', '昼'),
  ('スノーハーピー', 22, 51, 'timed', '昼'),
  ('極夜ワイト', 22, 51, 'timed', '晩'),
  ('フロストリッチ', 22, 51, 'timed', '晩'),
  ('イエティロード', 22, 51, 'rare', null),
  ('グレイシアドラゴン', 22, 51, 'rare', null),
  ('ブリザードウルフ', 22, 51, 'rare', '朝'),
  ('アイスドライアド', 22, 51, 'rare', '昼'),
  ('ワイトキング', 22, 51, 'rare', '晩'),
  ('氷牙マンモス', 22, 51, 'boss', null),
  ('雪男', 23, 50, 'normal', null),
  ('氷河ドレイク', 23, 51, 'normal', null),
  ('霜精', 23, 51, 'normal', null),
  ('アイスゴーレム', 23, 52, 'normal', null),
  ('銀嶺ウルフ', 23, 51, 'timed', '朝'),
  ('アイスエルク', 23, 51, 'timed', '朝'),
  ('樹氷精', 23, 51, 'timed', '昼'),
  ('スノーハーピー', 23, 51, 'timed', '昼'),
  ('極夜ワイト', 23, 51, 'timed', '晩'),
  ('フロストリッチ', 23, 51, 'timed', '晩'),
  ('イエティロード', 23, 51, 'rare', null),
  ('グレイシアドラゴン', 23, 51, 'rare', null),
  ('ブリザードウルフ', 23, 51, 'rare', '朝'),
  ('アイスドライアド', 23, 51, 'rare', '昼'),
  ('ワイトキング', 23, 51, 'rare', '晩'),
  ('晶獣グラキエス', 23, 53, 'boss', null),
  ('霜精', 24, 51, 'normal', null),
  ('アイスゴーレム', 24, 52, 'normal', null),
  ('ユキオオグマ', 24, 53, 'normal', null),
  ('凍骸兵', 24, 54, 'normal', null),
  ('銀嶺ウルフ', 24, 51, 'timed', '朝'),
  ('アイスエルク', 24, 51, 'timed', '朝'),
  ('樹氷精', 24, 51, 'timed', '昼'),
  ('スノーハーピー', 24, 51, 'timed', '昼'),
  ('極夜ワイト', 24, 51, 'timed', '晩'),
  ('フロストリッチ', 24, 51, 'timed', '晩'),
  ('イエティロード', 24, 51, 'rare', null),
  ('グレイシアドラゴン', 24, 51, 'rare', null),
  ('ブリザードウルフ', 24, 51, 'rare', '朝'),
  ('アイスドライアド', 24, 51, 'rare', '昼'),
  ('ワイトキング', 24, 51, 'rare', '晩'),
  ('氷霊フロストバーン', 24, 56, 'boss', null),
  ('ストームバード', 25, 57, 'normal', null),
  ('雷刃ガーゴイル', 25, 58, 'normal', null),
  ('サンダーホーク', 25, 58, 'timed', '朝'),
  ('ヒポグリフ', 25, 58, 'timed', '朝'),
  ('雷精', 25, 58, 'timed', '昼'),
  ('迅雷ドレイク', 25, 58, 'timed', '昼'),
  ('雷雲ワイバーン', 25, 58, 'timed', '晩'),
  ('ストームハーピー', 25, 58, 'timed', '晩'),
  ('ストームイーグル', 25, 58, 'rare', null),
  ('サンダーガーゴイル', 25, 58, 'rare', null),
  ('テンペストホーク', 25, 58, 'rare', '朝'),
  ('サンダーエレメンタル', 25, 58, 'rare', '昼'),
  ('ボルトワイバーン', 25, 58, 'rare', '晩'),
  ('妖獣ヌエ', 25, 58, 'boss', null),
  ('ストームバード', 26, 57, 'normal', null),
  ('雷刃ガーゴイル', 26, 58, 'normal', null),
  ('崖巨人', 26, 58, 'normal', null),
  ('スパークリザード', 26, 59, 'normal', null),
  ('サンダーホーク', 26, 58, 'timed', '朝'),
  ('ヒポグリフ', 26, 58, 'timed', '朝'),
  ('雷精', 26, 58, 'timed', '昼'),
  ('迅雷ドレイク', 26, 58, 'timed', '昼'),
  ('雷雲ワイバーン', 26, 58, 'timed', '晩'),
  ('ストームハーピー', 26, 58, 'timed', '晩'),
  ('ストームイーグル', 26, 58, 'rare', null),
  ('サンダーガーゴイル', 26, 58, 'rare', null),
  ('テンペストホーク', 26, 58, 'rare', '朝'),
  ('サンダーエレメンタル', 26, 58, 'rare', '昼'),
  ('ボルトワイバーン', 26, 58, 'rare', '晩'),
  ('雷槌ギガース', 26, 59, 'boss', null),
  ('崖巨人', 27, 58, 'normal', null),
  ('スパークリザード', 27, 59, 'normal', null),
  ('帯電ゴーレム', 27, 59, 'normal', null),
  ('雷獣', 27, 60, 'normal', null),
  ('サンダーホーク', 27, 58, 'timed', '朝'),
  ('ヒポグリフ', 27, 58, 'timed', '朝'),
  ('雷精', 27, 58, 'timed', '昼'),
  ('迅雷ドレイク', 27, 58, 'timed', '昼'),
  ('雷雲ワイバーン', 27, 58, 'timed', '晩'),
  ('ストームハーピー', 27, 58, 'timed', '晩'),
  ('ストームイーグル', 27, 58, 'rare', null),
  ('サンダーガーゴイル', 27, 58, 'rare', null),
  ('テンペストホーク', 27, 58, 'rare', '朝'),
  ('サンダーエレメンタル', 27, 58, 'rare', '昼'),
  ('ボルトワイバーン', 27, 58, 'rare', '晩'),
  ('雷帝ケラウノス', 27, 62, 'boss', null),
  ('炎精', 28, 63, 'normal', null),
  ('溶岩ゴーレム', 28, 63, 'normal', null),
  ('フレイムバット', 28, 63, 'timed', '朝'),
  ('雛フェニックス', 28, 63, 'timed', '朝'),
  ('イフリート', 28, 63, 'timed', '昼'),
  ('火吹きトカゲ', 28, 63, 'timed', '昼'),
  ('熾火デーモン', 28, 63, 'timed', '晩'),
  ('鬼火', 28, 63, 'timed', '晩'),
  ('マグマゴーレム', 28, 63, 'rare', null),
  ('ケルベロス', 28, 63, 'rare', null),
  ('ブレイズバット', 28, 63, 'rare', '朝'),
  ('イフリートロード', 28, 63, 'rare', '昼'),
  ('アークデーモン', 28, 63, 'rare', '晩'),
  ('岩甲亀ヴォルカン', 28, 63, 'boss', null),
  ('炎精', 29, 63, 'normal', null),
  ('溶岩ゴーレム', 29, 63, 'normal', null),
  ('ファイアドレイク', 29, 63, 'normal', null),
  ('マグマスライム', 29, 64, 'normal', null),
  ('フレイムバット', 29, 63, 'timed', '朝'),
  ('雛フェニックス', 29, 63, 'timed', '朝'),
  ('イフリート', 29, 63, 'timed', '昼'),
  ('火吹きトカゲ', 29, 63, 'timed', '昼'),
  ('熾火デーモン', 29, 63, 'timed', '晩'),
  ('鬼火', 29, 63, 'timed', '晩'),
  ('マグマゴーレム', 29, 63, 'rare', null),
  ('ケルベロス', 29, 63, 'rare', null),
  ('ブレイズバット', 29, 63, 'rare', '朝'),
  ('イフリートロード', 29, 63, 'rare', '昼'),
  ('アークデーモン', 29, 63, 'rare', '晩'),
  ('溶岩竜ラヴァウルム', 29, 64, 'boss', null),
  ('ファイアドレイク', 30, 63, 'normal', null),
  ('マグマスライム', 30, 64, 'normal', null),
  ('ヘルハウンド', 30, 64, 'normal', null),
  ('ファイアインプ', 30, 65, 'normal', null),
  ('フレイムバット', 30, 63, 'timed', '朝'),
  ('雛フェニックス', 30, 63, 'timed', '朝'),
  ('イフリート', 30, 63, 'timed', '昼'),
  ('火吹きトカゲ', 30, 63, 'timed', '昼'),
  ('熾火デーモン', 30, 63, 'timed', '晩'),
  ('鬼火', 30, 63, 'timed', '晩'),
  ('マグマゴーレム', 30, 63, 'rare', null),
  ('ケルベロス', 30, 63, 'rare', null),
  ('ブレイズバット', 30, 63, 'rare', '朝'),
  ('イフリートロード', 30, 63, 'rare', '昼'),
  ('アークデーモン', 30, 63, 'rare', '晩'),
  ('深紅のサラマンダー', 30, 65, 'boss', null),
  ('双頭ヌマヘビ', 31, 66, 'normal', null),
  ('ヘドロスライム', 31, 66, 'normal', null),
  ('ウィルオウィスプ', 31, 66, 'timed', '朝'),
  ('オオヒル', 31, 66, 'timed', '朝'),
  ('オオヒキガエル', 31, 66, 'timed', '昼'),
  ('カミツキガメ', 31, 66, 'timed', '昼'),
  ('ドロゾンビ', 31, 66, 'timed', '晩'),
  ('コカトリス', 31, 66, 'timed', '晩'),
  ('ヤングヒュドラ', 31, 66, 'rare', null),
  ('アシッドスライム', 31, 66, 'rare', null),
  ('グレーターウィスプ', 31, 66, 'rare', '朝'),
  ('ポイズンフロッグ', 31, 66, 'rare', '昼'),
  ('ゾンビジャイアント', 31, 66, 'rare', '晩'),
  ('沼主ガヴィアル', 31, 66, 'boss', null),
  ('双頭ヌマヘビ', 32, 66, 'normal', null),
  ('ヘドロスライム', 32, 66, 'normal', null),
  ('リザードマン', 32, 66, 'normal', null),
  ('ヌマワニ', 32, 67, 'normal', null),
  ('ウィルオウィスプ', 32, 66, 'timed', '朝'),
  ('オオヒル', 32, 66, 'timed', '朝'),
  ('オオヒキガエル', 32, 66, 'timed', '昼'),
  ('カミツキガメ', 32, 66, 'timed', '昼'),
  ('ドロゾンビ', 32, 66, 'timed', '晩'),
  ('コカトリス', 32, 66, 'timed', '晩'),
  ('ヤングヒュドラ', 32, 66, 'rare', null),
  ('アシッドスライム', 32, 66, 'rare', null),
  ('グレーターウィスプ', 32, 66, 'rare', '朝'),
  ('ポイズンフロッグ', 32, 66, 'rare', '昼'),
  ('ゾンビジャイアント', 32, 66, 'rare', '晩'),
  ('沼呪師ザルグ', 32, 67, 'boss', null),
  ('リザードマン', 33, 66, 'normal', null),
  ('ヌマワニ', 33, 67, 'normal', null),
  ('腐肉バエ', 33, 67, 'normal', null),
  ('マッドゴーレム', 33, 68, 'normal', null),
  ('ウィルオウィスプ', 33, 66, 'timed', '朝'),
  ('オオヒル', 33, 66, 'timed', '朝'),
  ('オオヒキガエル', 33, 66, 'timed', '昼'),
  ('カミツキガメ', 33, 66, 'timed', '昼'),
  ('ドロゾンビ', 33, 66, 'timed', '晩'),
  ('コカトリス', 33, 66, 'timed', '晩'),
  ('ヤングヒュドラ', 33, 66, 'rare', null),
  ('アシッドスライム', 33, 66, 'rare', null),
  ('グレーターウィスプ', 33, 66, 'rare', '朝'),
  ('ポイズンフロッグ', 33, 66, 'rare', '昼'),
  ('ゾンビジャイアント', 33, 66, 'rare', '晩'),
  ('毒龍ヴェノムヒュドラ', 33, 68, 'boss', null),
  ('グール', 34, 69, 'normal', null),
  ('鉱石ゴーレム', 34, 69, 'normal', null),
  ('クリスタルワーム', 34, 69, 'timed', '朝'),
  ('クリスタルビートル', 34, 69, 'timed', '朝'),
  ('ドワーフレイス', 34, 69, 'timed', '昼'),
  ('狂乱ドワーフ', 34, 69, 'timed', '昼'),
  ('うごめく影', 34, 69, 'timed', '晩'),
  ('奈落グモ', 34, 69, 'timed', '晩'),
  ('グールキング', 34, 69, 'rare', null),
  ('ミスリルゴーレム', 34, 69, 'rare', null),
  ('プリズムワーム', 34, 69, 'rare', '朝'),
  ('エルダードワーフ', 34, 69, 'rare', '昼'),
  ('シャドウストーカー', 34, 69, 'rare', '晩'),
  ('掘削機兵ドリラー', 34, 69, 'boss', null),
  ('グール', 35, 69, 'normal', null),
  ('鉱石ゴーレム', 35, 69, 'normal', null),
  ('闇喰いコウモリ', 35, 69, 'normal', null),
  ('カナクイネズミ', 35, 70, 'normal', null),
  ('クリスタルワーム', 35, 69, 'timed', '朝'),
  ('クリスタルビートル', 35, 69, 'timed', '朝'),
  ('ドワーフレイス', 35, 69, 'timed', '昼'),
  ('狂乱ドワーフ', 35, 69, 'timed', '昼'),
  ('うごめく影', 35, 69, 'timed', '晩'),
  ('奈落グモ', 35, 69, 'timed', '晩'),
  ('グールキング', 35, 69, 'rare', null),
  ('ミスリルゴーレム', 35, 69, 'rare', null),
  ('プリズムワーム', 35, 69, 'rare', '朝'),
  ('エルダードワーフ', 35, 69, 'rare', '昼'),
  ('シャドウストーカー', 35, 69, 'rare', '晩'),
  ('奈落蜘蛛アラクネ', 35, 70, 'boss', null),
  ('闇喰いコウモリ', 36, 69, 'normal', null),
  ('カナクイネズミ', 36, 70, 'normal', null),
  ('錆びた自動人形', 36, 70, 'normal', null),
  ('坑夫スケルトン', 36, 71, 'normal', null),
  ('クリスタルワーム', 36, 69, 'timed', '朝'),
  ('クリスタルビートル', 36, 69, 'timed', '朝'),
  ('ドワーフレイス', 36, 69, 'timed', '昼'),
  ('狂乱ドワーフ', 36, 69, 'timed', '昼'),
  ('うごめく影', 36, 69, 'timed', '晩'),
  ('奈落グモ', 36, 69, 'timed', '晩'),
  ('グールキング', 36, 69, 'rare', null),
  ('ミスリルゴーレム', 36, 69, 'rare', null),
  ('プリズムワーム', 36, 69, 'rare', '朝'),
  ('エルダードワーフ', 36, 69, 'rare', '昼'),
  ('シャドウストーカー', 36, 69, 'rare', '晩'),
  ('巌喰いガイアモール', 36, 71, 'boss', null),
  ('スカイハーピー', 37, 72, 'normal', null),
  ('シルフ', 37, 72, 'normal', null),
  ('セラフ', 37, 72, 'timed', '朝'),
  ('ケルビム', 37, 72, 'timed', '朝'),
  ('ペガサス', 37, 72, 'timed', '昼'),
  ('ユニコーン', 37, 72, 'timed', '昼'),
  ('星降りのヴァルキリー', 37, 72, 'timed', '晩'),
  ('ナイトメア', 37, 72, 'timed', '晩'),
  ('ハーピークイーン', 37, 72, 'rare', null),
  ('シルフィード', 37, 72, 'rare', null),
  ('アークセラフ', 37, 72, 'rare', '朝'),
  ('アリコーン', 37, 72, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 37, 72, 'rare', '晩'),
  ('空鯨ネブラ', 37, 72, 'boss', null),
  ('スカイハーピー', 38, 72, 'normal', null),
  ('シルフ', 38, 72, 'normal', null),
  ('天空騎士グリフィオン', 38, 72, 'normal', null),
  ('ロック鳥', 38, 73, 'normal', null),
  ('セラフ', 38, 72, 'timed', '朝'),
  ('ケルビム', 38, 72, 'timed', '朝'),
  ('ペガサス', 38, 72, 'timed', '昼'),
  ('ユニコーン', 38, 72, 'timed', '昼'),
  ('星降りのヴァルキリー', 38, 72, 'timed', '晩'),
  ('ナイトメア', 38, 72, 'timed', '晩'),
  ('ハーピークイーン', 38, 72, 'rare', null),
  ('シルフィード', 38, 72, 'rare', null),
  ('アークセラフ', 38, 72, 'rare', '朝'),
  ('アリコーン', 38, 72, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 38, 72, 'rare', '晩'),
  ('天騎士長セレスト', 38, 73, 'boss', null),
  ('天空騎士グリフィオン', 39, 72, 'normal', null),
  ('ロック鳥', 39, 73, 'normal', null),
  ('浮遊砲台', 39, 73, 'normal', null),
  ('天弓兵', 39, 74, 'normal', null),
  ('セラフ', 39, 72, 'timed', '朝'),
  ('ケルビム', 39, 72, 'timed', '朝'),
  ('ペガサス', 39, 72, 'timed', '昼'),
  ('ユニコーン', 39, 72, 'timed', '昼'),
  ('星降りのヴァルキリー', 39, 72, 'timed', '晩'),
  ('ナイトメア', 39, 72, 'timed', '晩'),
  ('ハーピークイーン', 39, 72, 'rare', null),
  ('シルフィード', 39, 72, 'rare', null),
  ('アークセラフ', 39, 72, 'rare', '朝'),
  ('アリコーン', 39, 72, 'rare', '昼'),
  ('戦乙女長ブリュンヒルデ', 39, 72, 'rare', '晩'),
  ('天空覇龍ウラノス', 39, 74, 'boss', null),
  ('星見像', 40, 75, 'normal', null),
  ('守護機兵', 40, 75, 'normal', null),
  ('アストラルナイト', 40, 75, 'timed', '朝'),
  ('ケンタウロス', 40, 75, 'timed', '朝'),
  ('スフィンクス', 40, 75, 'timed', '昼'),
  ('マンティコア', 40, 75, 'timed', '昼'),
  ('ルナウルフ', 40, 75, 'timed', '晩'),
  ('月蛾', 40, 75, 'timed', '晩'),
  ('スターゴーレム', 40, 75, 'rare', null),
  ('オメガガーディアン', 40, 75, 'rare', null),
  ('セレスティアルナイト', 40, 75, 'rare', '朝'),
  ('アンドロスフィンクス', 40, 75, 'rare', '昼'),
  ('月喰いハティ', 40, 75, 'rare', '晩'),
  ('古代機兵ゼクス', 40, 75, 'boss', null),
  ('星見像', 41, 75, 'normal', null),
  ('守護機兵', 41, 75, 'normal', null),
  ('クロノワーム', 41, 75, 'normal', null),
  ('グリモワール', 41, 76, 'normal', null),
  ('アストラルナイト', 41, 75, 'timed', '朝'),
  ('ケンタウロス', 41, 75, 'timed', '朝'),
  ('スフィンクス', 41, 75, 'timed', '昼'),
  ('マンティコア', 41, 75, 'timed', '昼'),
  ('ルナウルフ', 41, 75, 'timed', '晩'),
  ('月蛾', 41, 75, 'timed', '晩'),
  ('スターゴーレム', 41, 75, 'rare', null),
  ('オメガガーディアン', 41, 75, 'rare', null),
  ('セレスティアルナイト', 41, 75, 'rare', '朝'),
  ('アンドロスフィンクス', 41, 75, 'rare', '昼'),
  ('月喰いハティ', 41, 75, 'rare', '晩'),
  ('大司書ノクトゥア', 41, 76, 'boss', null),
  ('クロノワーム', 42, 75, 'normal', null),
  ('グリモワール', 42, 76, 'normal', null),
  ('魔導兵', 42, 76, 'normal', null),
  ('トキカゲロウ', 42, 77, 'normal', null),
  ('アストラルナイト', 42, 75, 'timed', '朝'),
  ('ケンタウロス', 42, 75, 'timed', '朝'),
  ('スフィンクス', 42, 75, 'timed', '昼'),
  ('マンティコア', 42, 75, 'timed', '昼'),
  ('ルナウルフ', 42, 75, 'timed', '晩'),
  ('月蛾', 42, 75, 'timed', '晩'),
  ('スターゴーレム', 42, 75, 'rare', null),
  ('オメガガーディアン', 42, 75, 'rare', null),
  ('セレスティアルナイト', 42, 75, 'rare', '朝'),
  ('アンドロスフィンクス', 42, 75, 'rare', '昼'),
  ('月喰いハティ', 42, 75, 'rare', '晩'),
  ('時星龍アイオーン', 42, 77, 'boss', null),
  ('クラーケン', 43, 78, 'normal', null),
  ('リヴァイアサン幼体', 43, 78, 'normal', null),
  ('海竜', 43, 78, 'timed', '朝'),
  ('サカマタ', 43, 78, 'timed', '朝'),
  ('巨鯨', 43, 78, 'timed', '昼'),
  ('グランマンタ', 43, 78, 'timed', '昼'),
  ('ローレライ', 43, 78, 'timed', '晩'),
  ('ダイオウグソクムシ', 43, 78, 'timed', '晩'),
  ('クラーケンキング', 43, 78, 'rare', null),
  ('アビスドラゴン', 43, 78, 'rare', null),
  ('アビスサーペント', 43, 78, 'rare', '朝'),
  ('グレートホエール', 43, 78, 'rare', '昼'),
  ('ローレライクイーン', 43, 78, 'rare', '晩'),
  ('大海月ルミナ', 43, 78, 'boss', null),
  ('クラーケン', 44, 78, 'normal', null),
  ('リヴァイアサン幼体', 44, 78, 'normal', null),
  ('シーウィッチ', 44, 78, 'normal', null),
  ('メガロドン', 44, 79, 'normal', null),
  ('海竜', 44, 78, 'timed', '朝'),
  ('サカマタ', 44, 78, 'timed', '朝'),
  ('巨鯨', 44, 78, 'timed', '昼'),
  ('グランマンタ', 44, 78, 'timed', '昼'),
  ('ローレライ', 44, 78, 'timed', '晩'),
  ('ダイオウグソクムシ', 44, 78, 'timed', '晩'),
  ('クラーケンキング', 44, 78, 'rare', null),
  ('アビスドラゴン', 44, 78, 'rare', null),
  ('アビスサーペント', 44, 78, 'rare', '朝'),
  ('グレートホエール', 44, 78, 'rare', '昼'),
  ('ローレライクイーン', 44, 78, 'rare', '晩'),
  ('深海魔女キルケ', 44, 79, 'boss', null),
  ('シーウィッチ', 45, 78, 'normal', null),
  ('メガロドン', 45, 79, 'normal', null),
  ('ダイオウイカ', 45, 79, 'normal', null),
  ('アビスマーマン', 45, 80, 'normal', null),
  ('海竜', 45, 78, 'timed', '朝'),
  ('サカマタ', 45, 78, 'timed', '朝'),
  ('巨鯨', 45, 78, 'timed', '昼'),
  ('グランマンタ', 45, 78, 'timed', '昼'),
  ('ローレライ', 45, 78, 'timed', '晩'),
  ('ダイオウグソクムシ', 45, 78, 'timed', '晩'),
  ('クラーケンキング', 45, 78, 'rare', null),
  ('アビスドラゴン', 45, 78, 'rare', null),
  ('アビスサーペント', 45, 78, 'rare', '朝'),
  ('グレートホエール', 45, 78, 'rare', '昼'),
  ('ローレライクイーン', 45, 78, 'rare', '晩'),
  ('深海覇王リヴァイアサン', 45, 80, 'boss', null);
-- @@end:enemies
-- 種を入れ直したあとなら、どの行にも場所が入っている＝「名前＋場所」の主キーを付けられる
alter table public.v2cap_enemies alter column spot set not null;
do $$
begin
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.v2cap_enemies'::regclass and c.contype = 'p') then
    alter table public.v2cap_enemies add primary key (name, spot);
  end if;
end $$;

-- ---- 1-7. デイリーミッション（2026-10-10）----
-- key … v2cap_profiles.daily_counts のキー／goal … これだけ数えると達成。全部そろうと受け取れる（§10）
-- ★ミッションの内容はあとで決める（ユーザー指示）。いまは仮の「出撃に10回勝つ」1つ。
--   種は src/v2cap/lib/daily.js の DAILY_TASKS から tools/v2cap-sql.mjs が作る
create table if not exists public.v2cap_daily_tasks (
  key   text primary key,
  label text not null,
  goal  int  not null,
  sort  int  not null default 0
);
alter table public.v2cap_daily_tasks enable row level security;
drop policy if exists v2cap_daily_tasks_read on public.v2cap_daily_tasks;
create policy v2cap_daily_tasks_read on public.v2cap_daily_tasks for select to authenticated using (true);
revoke all on table public.v2cap_daily_tasks from anon;
grant select on table public.v2cap_daily_tasks to authenticated;

-- @@seed:daily_tasks
delete from public.v2cap_daily_tasks where key <> all('{win}'::text[]);
insert into public.v2cap_daily_tasks (key, label, goal, sort) values
  ('win', '出撃に勝つ', 10, 1)
on conflict (key) do update set label = excluded.label, goal = excluded.goal, sort = excluded.sort;
-- @@end:daily_tasks

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
-- ★2026-10-09 まだ振っていないステータスポイント（LVアップで入る・v2cap_allocate_points で振る）
alter table public.v2cap_profiles add column if not exists stat_points int not null default 0;
-- エリアの作り替え（2026-10-09）：Goldを持つ／進み具合は「ボスを倒した場所」だけで持つ
--   （前の unlocked_areas・cleared_areas は難易度帯のエリアの番号だった。キャラは下の作り直しで消える）
alter table public.v2cap_profiles add column if not exists gold bigint not null default 0;
alter table public.v2cap_profiles add column if not exists cleared_spots int[] not null default '{}';
alter table public.v2cap_profiles drop column if exists unlocked_areas;
alter table public.v2cap_profiles drop column if exists cleared_areas;
-- ★2026-10-10 装備の強化と分解：持っている残骸（エリアごと）。{"1": 12, "2": 5} ＝エリアの番号→個数
--   （名前は src/v2cap/lib/smith.js の SCRAP_NAMES。サーバーは番号だけで持つ）。キャラは消さない
alter table public.v2cap_profiles add column if not exists materials jsonb not null default '{}'::jsonb;
-- ★2026-10-10 デイリーミッション（§10）：その日（日本時間の5時で切り替わる）・受注した時点のLV（null＝まだ受注していない）・
--   進み（{"win": 3}）・受け取ったか。日付が変わると v2cap_daily_roll が空にする。キャラは消さない
alter table public.v2cap_profiles add column if not exists daily_day date;
alter table public.v2cap_profiles add column if not exists daily_lv int;
alter table public.v2cap_profiles add column if not exists daily_counts jsonb not null default '{}'::jsonb;
alter table public.v2cap_profiles add column if not exists daily_claimed boolean not null default false;
-- ★2026-10-11 アイコン（ユーザー指示「自分で設定できるように」）：avatars バケット（旧版・今のⅡと同じ置き場）の中の場所。
--   用意された8枚か、自分のフォルダ（<ユーザーID>/…）の画像だけ（v2cap_set_avatar が見る）。null は画像なし
alter table public.v2cap_profiles add column if not exists avatar text;
-- ★2026-10-11 ユグレシアの宝樹（§8-3）：最後に祈った時刻・結果・回数・直近10回（新しい順 [{"at":"10/11 21:03","fortune":"大吉"}]）
alter table public.v2cap_profiles add column if not exists last_pray_at timestamptz;
alter table public.v2cap_profiles add column if not exists last_fortune text;
alter table public.v2cap_profiles add column if not exists pray_count int not null default 0;
alter table public.v2cap_profiles add column if not exists pray_log jsonb not null default '[]'::jsonb;
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
-- ★2026-10-09 エリアの作り替え（ユーザー承認「作り直す」）：場所・経験値の大きさ・アイテムLVの決め方と、
--   装備の一覧（ランク→レア度・エリアごとの装備）が変わったので、**この版のキャラと装備をもう1回だけ消す**
--   （印は別）。今のⅡ・旧版には触らない
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
-- ★2026-10-09 ステータスポイントにした（ユーザー指示・ユーザー決定「キャラを作り直す」）：LVアップで抽選で上がっていたステを
--   やめたので、**この版のキャラと装備をもう1回だけ消す**（印は別）。今のⅡ・旧版には触らない
do $$
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'reset_points_20261009') then
    if to_regclass('public.v2cap_inventory') is not null then
      delete from public.v2cap_inventory;
    end if;
    delete from public.v2cap_profiles;
    insert into public.v2cap_migrations (key) values ('reset_points_20261009');
  end if;
end $$;

-- 所持している装備。base_id＝装備（レア度も装備が持つ）・ilv＝アイテムLV（＝必要LV。拾ったエリアで決まる）
create table if not exists public.v2cap_inventory (
  id         bigserial primary key,
  player_id  uuid not null references auth.users(id) on delete cascade,
  base_id    text not null references public.v2cap_equipment(id),
  ilv        int  not null default 1,
  created_at timestamptz not null default now()
);
-- 作り直しの前から表があった場合（上の do で空にしてある）
alter table public.v2cap_inventory add column if not exists base_id text references public.v2cap_equipment(id);
alter table public.v2cap_inventory alter column base_id set not null;
-- 前の形（ランク F〜S）の列。レア度は装備の一覧（v2cap_equipment.rarity）が持つようになった
alter table public.v2cap_inventory drop column if exists rank;
-- ★2026-10-10 強化値（0〜10）。+1ごとに元の強さの0.1倍ずつ足す（強さの計算は src/v2cap/lib/gear.js。サーバーは数だけ持つ）
alter table public.v2cap_inventory add column if not exists plus int not null default 0;
-- 前の基本装備（ランクの形＝レア度を持たない行）を一覧から消す。持ち物から指されているものは残す
--   （上の作り直しで持ち物は空になっているので、ふつうは全部消える）
delete from public.v2cap_equipment e
 where e.rarity is null
   and not exists (select 1 from public.v2cap_inventory i where i.base_id = e.id);
-- ★2026-10-09 必要LVを装備ごと（エリア×レア度・ユーザーの表）にした：持っている装備のアイテムLVを、その装備の必要LVへそろえる
update public.v2cap_inventory i set ilv = e.lv
  from public.v2cap_equipment e
 where e.id = i.base_id and e.lv is not null and i.ilv is distinct from e.lv;
-- ★2026-10-11 モンスター図鑑（設計 §6-4）：討伐数（プレイヤー × 敵の名前）。出撃の精算で勝ったときに1つ足す。
--   ⚠敵の表 v2cap_enemies は流し直すたびに消して入れ直すので、**外部キーでつながない**
--     （今のⅡの v2_kills はつないでいて、敵の表を入れ直すたびに連鎖削除で討伐数が消えていた）
create table if not exists public.v2cap_kills (
  player_id uuid not null references auth.users(id) on delete cascade,
  enemy     text not null,
  n         int  not null default 0,
  primary key (player_id, enemy)
);
alter table public.v2cap_kills enable row level security;
drop policy if exists v2cap_kills_own on public.v2cap_kills;
create policy v2cap_kills_own on public.v2cap_kills for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2cap_kills from anon;
grant select on table public.v2cap_kills to authenticated;
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
              else greatest(1, round(135::numeric * p_lv * p_lv * p_lv / 1000))::int end
$$;

-- 必要ClassEXP ＝ 係数 × 段階の倍率 × ClassLV²。段階の上限（初期30・一次50）で0（jobs.js の jobNeed）
-- ⚠係数は10分率の整数（jobs.js の JOB_NEED_TENTHS と同じ値）
create or replace function public.v2cap_job_need(p_stage text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select case when p_jlv >= coalesce((select s.max_jlv from public.v2cap_stages s where s.stage = p_stage), 30) then 0
              else greatest(1, round(44::numeric * coalesce((select s.mult from public.v2cap_stages s where s.stage = p_stage), 1)
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
-- ★2026-10-10 ClassLVが上がるたびに必ず上がるMP（lv_mp × 上がった回数）も足す（jobs.js の jobBonusStats と同じ）
create or replace function public.v2cap_job_bonus_mp(p_cls text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select coalesce((
    select count(*)::int
      from public.v2cap_classes c
      join public.v2cap_stages s on s.stage = c.stage,
           unnest(c.bonus_seq[1:greatest(0, least(coalesce(p_jlv, 1), s.max_jlv) - 1) * s.per_lv]) as x(k)
     where c.id = p_cls and x.k = 'mp'), 0) * 3
  + coalesce((
    select greatest(0, least(coalesce(p_jlv, 1), s.max_jlv) - 1) * c.lv_mp
      from public.v2cap_classes c
      join public.v2cap_stages s on s.stage = c.stage
     where c.id = p_cls), 0)
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
  v_job_max int := 30;   -- いまの職業の段階のClassLV上限（初期30・一次50）
  v_row   public.v2cap_profiles;
  v_lv    int;
  v_exp   int;
  v_pts   int := 0;
  v_ups   int := 0;
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
      -- 【確定】LVアップでステは上がらない。そのLVに上がったときにポイントが入る（5の倍数のLVは5・ほかは3）
      v_pts := v_pts + case when v_lv % 5 = 0 then 5 else 3 end;
    end loop;
    if v_lv >= c_max_lv then v_exp := 0; end if;
  end if;

  -- ClassLV（いまの職業だけ。入るのはEXPと同じ量）
  v_cls := v_row.class;
  select c.stage, coalesce(s.max_jlv, 30) into v_stage, v_job_max
    from public.v2cap_classes c left join public.v2cap_stages s on s.stage = c.stage
   where c.id = v_cls;
  v_job_max := coalesce(v_job_max, 30);
  v_jlv  := coalesce((v_row.jobs -> v_cls ->> 'lv')::int, 1);
  v_jexp := coalesce((v_row.jobs -> v_cls ->> 'exp')::int, 0);
  if v_stage is not null and coalesce(p_amount, 0) > 0 and v_jlv < v_job_max then
    v_jexp := v_jexp + p_amount;
    while v_jlv < v_job_max and v_jexp >= public.v2cap_job_need(v_stage, v_jlv) loop
      v_jexp := v_jexp - public.v2cap_job_need(v_stage, v_jlv);
      v_jlv  := v_jlv + 1;
      v_jups := v_jups + 1;
    end loop;
    if v_jlv >= v_job_max then v_jexp := 0; end if;
  end if;

  -- スキル（そのClassLVまでのぶんを覚える。覚えたものはずっと残る）
  v_old := coalesce(v_row.learned, '[]'::jsonb);
  v_new := public.v2cap_learn(v_old, v_cls, v_jlv);
  select coalesce(jsonb_agg(t.name), '[]'::jsonb) into v_added
    from jsonb_array_elements_text(v_new) as t(name) where not (v_old ? t.name);

  update public.v2cap_profiles set
    lv = v_lv, exp = v_exp,
    total_exp = total_exp + greatest(coalesce(p_amount, 0), 0),
    stat_points = stat_points + v_pts,
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
    'points', v_pts,
    'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_apply_exp(uuid, int) from public, anon, authenticated;

-- ---- ステータスポイントを振る ----
-- 【確定】2026-10-09 ユーザー決定：8種すべてに振れる。1ポイントで HP+8・MP+3・ほか+1（戦闘力+1）。振り直しはいまはできない。
-- p_add ＝ {"str": 3, "hp": 1, …}（0以上の整数）。合計がいまのポイント以下のときだけ振る（level.js の validateAllocation と同じ文言）
create or replace function public.v2cap_allocate_points(p_add jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_keys constant text[] := array['hp', 'mp', 'str', 'dex', 'agi', 'int_stat', 'vit', 'luk'];
  v_k    text;
  v_sum  bigint := 0;
  v_n    jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_add is null or jsonb_typeof(p_add) <> 'object' then
    return jsonb_build_object('ok', false, 'error', '振り方の形式が不正です');
  end if;
  for v_k in select jsonb_object_keys(p_add) loop
    if not (v_k = any(v_keys)) then return jsonb_build_object('ok', false, 'error', format('%sには振れません', v_k)); end if;
    v_n := p_add -> v_k;
    if jsonb_typeof(v_n) <> 'number' or (v_n #>> '{}') !~ '^[0-9]{1,6}$' then
      return jsonb_build_object('ok', false, 'error', '振る数は0以上の整数で指定してください');
    end if;
    v_sum := v_sum + (v_n #>> '{}')::int;
  end loop;
  if v_sum <= 0 then return jsonb_build_object('ok', false, 'error', 'ポイントを1以上振ってください'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if v_sum > v_row.stat_points then return jsonb_build_object('ok', false, 'error', 'ポイントが足りません'); end if;
  update public.v2cap_profiles set
    hp       = hp       + 8 * coalesce((p_add ->> 'hp')::int, 0),
    mp       = mp       + 3 * coalesce((p_add ->> 'mp')::int, 0),
    str      = str      + coalesce((p_add ->> 'str')::int, 0),
    dex      = dex      + coalesce((p_add ->> 'dex')::int, 0),
    agi      = agi      + coalesce((p_add ->> 'agi')::int, 0),
    int_stat = int_stat + coalesce((p_add ->> 'int_stat')::int, 0),
    vit      = vit      + coalesce((p_add ->> 'vit')::int, 0),
    luk      = luk      + coalesce((p_add ->> 'luk')::int, 0),
    stat_points = stat_points - v_sum::int,
    updated_at = now()
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_allocate_points(jsonb) from public, anon;
grant execute on function public.v2cap_allocate_points(jsonb) to authenticated;

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
-- ★落ちた装備（p_drop）は「その場所のエリアの装備か」「その役割の敵から落ちるレア度か」
--   （エピックはレアとボスだけ・レジェンダリーはボスだけ）「いまの職業の武器か」を見てから持ち物に入れる
-- ⚠引数を変えた（p_area → p_spot・ランクの p_rank をなくした）ので、前の形を落としてから作る
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, boolean);
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, text, boolean);
create or replace function public.v2cap_sortie_settle(
  p_spot int, p_enemy text, p_win boolean, p_drop text default null, p_auto boolean default false
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
      if found and v_eq.area = v_spot.area
         and (v_eq.rarity in ('N', 'R')
              or (v_eq.rarity = 'E' and v_en.role in ('rare', 'boss'))
              or (v_eq.rarity = 'L' and v_en.role = 'boss'))
         and (v_eq.part <> '武器' or v_eq.type = any(coalesce(v_cls.weapons, '{}'))) then
        insert into public.v2cap_inventory (player_id, base_id, ilv)
        values (v_uid, v_eq.id, v_eq.lv) returning id into v_inv;
        v_drop := jsonb_build_object('id', v_inv, 'base_id', v_eq.id, 'rarity', v_eq.rarity, 'ilv', v_eq.lv);
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

  -- デイリーミッション（§10）：勝ったら「出撃に勝つ」を1つ数える（受注していない日は数えない）
  if v_win then
    perform public.v2cap_daily_bump(v_uid, 'win', 1);
    -- モンスター図鑑：勝った敵の討伐数を1つ足す（敵の名前はこの場所にいることを上で確かめてある）
    insert into public.v2cap_kills (player_id, enemy, n) values (v_uid, v_en.name, 1)
    on conflict (player_id, enemy) do update set n = public.v2cap_kills.n + 1;
  end if;

  v_res := public.v2cap_apply_exp(v_uid, v_exp);
  return jsonb_build_object('ok', true, 'win', v_win, 'boss', v_boss, 'role', v_en.role, 'enemy_lv', v_en.lv,
    'exp', v_exp, 'gold', v_gold, 'drop', v_drop,
    'cleared', to_jsonb(v_cleared), 'open_until', public.v2cap_open_until(v_cleared), 'boss_rate', v_rate,
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
-- ===== 8. 装備の着脱・鍛冶屋（分解・強化・作成）=====
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

-- ★2026-10-10「捨てる」は分解に置き換えた（ユーザー決定）。前の形を落とす
drop function if exists public.v2cap_discard(bigint[]);

-- 分解：選んだ装備を消して、その装備のエリアの残骸を入れる（着けているものは分解できない＝飛ばす）
-- 【確定】2026-10-10 ユーザー決定：残骸の数はレア度で決まる＝ノーマル1・レア5・エピック10・レジェンダリー25
--   （強化した装備でも同じ。強化に使った残骸とGoldは戻らない）。数の写しは src/v2cap/lib/smith.js の SCRAP_YIELD
create or replace function public.v2cap_dismantle(p_ids bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_gain jsonb;
  v_n    int;
  v_mats jsonb;
  v_key  text;
  v_add  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', '分解する装備を選んでください');
  end if;
  -- ★行をつかんでから（強化と同時に届いても、残骸の数がずれないように）
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  with del as (
    delete from public.v2cap_inventory i
     where i.player_id = v_uid and i.id = any(p_ids)
       and not exists (select 1 from jsonb_each_text(coalesce(v_row.equipped, '{}'::jsonb)) q
                        where q.value ~ '^[0-9]+$' and q.value::bigint = i.id)
    returning i.base_id
  ), got as (
    select e.area, count(*)::int as n,
           sum(case e.rarity when 'N' then 1 when 'R' then 5 when 'E' then 10 when 'L' then 25 else 0 end)::int as scrap
      from del join public.v2cap_equipment e on e.id = del.base_id
     group by e.area
  )
  select coalesce(jsonb_object_agg(got.area::text, got.scrap), '{}'::jsonb), coalesce(sum(got.n), 0)::int
    into v_gain, v_n
    from got;
  v_mats := coalesce(v_row.materials, '{}'::jsonb);
  for v_key, v_add in select key, value::int from jsonb_each_text(v_gain) loop
    v_mats := jsonb_set(v_mats, array[v_key], to_jsonb(coalesce((v_mats ->> v_key)::int, 0) + v_add));
  end loop;
  update public.v2cap_profiles set materials = v_mats, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'dismantled', v_n, 'gained', v_gain, 'materials', v_mats);
end;
$$;
revoke all on function public.v2cap_dismantle(bigint[]) from public, anon;
grant execute on function public.v2cap_dismantle(bigint[]) to authenticated;

-- 強化：その装備の強化値を1つ上げる（失敗もある）。着けている装備も強化できる
-- 【確定】2026-10-10 ユーザー決定：
--   ・+10まで。+n にする回の 残骸＝1,2,3,4,5,7,8,9,10,11 個（その装備のエリアの残骸）・Gold＝必要LV×20×n・
--     成功率＝+1が100%、そこから10%ずつ下がって+10で10%
--   ・**失敗すると残骸とGoldはなくなり、強化値はそのまま**（下がらない・壊れない）
-- ★表の写しは src/v2cap/lib/smith.js（ENHANCE_SCRAP・ENHANCE_RATE・ENHANCE_GOLD_PER_LV）。v2capsql.test.js が突き合わせる
create or replace function public.v2cap_enhance(p_inventory_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max         constant int := 10;
  c_scrap       constant int[] := array[1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
  c_rate        constant int[] := array[100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  c_gold_per_lv constant int := 20;
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_inv  public.v2cap_inventory;
  v_eq   public.v2cap_equipment;
  v_plus int;
  v_next int;
  v_need int;
  v_gold bigint;
  v_key  text;
  v_have int;
  v_mats jsonb;
  v_ok   boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから見る（連打しても・分解と同時に届いても、残骸とGoldを二重に使えないように）
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_inv from public.v2cap_inventory where id = p_inventory_id and player_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  select * into v_eq from public.v2cap_equipment where id = v_inv.base_id;
  v_plus := coalesce(v_inv.plus, 0);
  if v_plus >= c_max then
    return jsonb_build_object('ok', false, 'error', format('強化値は+%sが上限です', c_max));
  end if;
  v_next := v_plus + 1;
  v_need := c_scrap[v_next];
  v_gold := greatest(1, v_inv.ilv)::bigint * c_gold_per_lv * v_next;
  v_key  := v_eq.area::text;
  v_mats := coalesce(v_row.materials, '{}'::jsonb);
  v_have := coalesce((v_mats ->> v_key)::int, 0);
  if v_have < v_need then return jsonb_build_object('ok', false, 'error', '残骸が足りません'); end if;
  if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;

  -- 抽選（成功率は%。+1は100%なので必ず成功する）
  v_ok := random() * 100 < c_rate[v_next];
  -- 成功でも失敗でも、残骸とGoldは使う
  v_mats := jsonb_set(v_mats, array[v_key], to_jsonb(v_have - v_need));
  update public.v2cap_profiles
     set materials = v_mats, gold = gold - v_gold, updated_at = now()
   where id = v_uid;
  if v_ok then
    update public.v2cap_inventory set plus = v_next where id = v_inv.id;
  end if;
  return jsonb_build_object('ok', true, 'success', v_ok, 'plus', case when v_ok then v_next else v_plus end,
    'area', v_eq.area, 'scrap', v_need, 'gold', v_gold, 'materials', v_mats, 'gold_left', v_row.gold - v_gold);
end;
$$;
revoke all on function public.v2cap_enhance(bigint) from public, anon;
grant execute on function public.v2cap_enhance(bigint) to authenticated;

-- 作成：選んだ装備を1つ作って持ち物に入れる（+0・アイテムLV＝その装備の必要LV）
-- 【確定】2026-10-10 ユーザーの表：作れるのはレア・エピック・レジェンダリー（ノーマルは作れない）。使うのは Gold と、その装備のエリアの残骸
--   ・残骸 … レア30・エピック100・レジェンダリー300
--   ・Gold … 必要LV × レア50・エピック100・レジェンダリー200
--   ・必ずできる。武器は14種どれでも作れる（いまの職業で装備できなくてよい・ユーザー決定）
-- ★表の写しは src/v2cap/lib/smith.js（CRAFT_SCRAP・CRAFT_GOLD_PER_LV）。v2capsql.test.js が突き合わせる
create or replace function public.v2cap_craft(p_equip_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_eq   public.v2cap_equipment;
  v_need int;
  v_gold bigint;
  v_key  text;
  v_have int;
  v_mats jsonb;
  v_inv  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから見る（連打しても・強化や分解と同時に届いても、残骸とGoldを二重に使えないように）
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_eq from public.v2cap_equipment where id = p_equip_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備はありません'); end if;
  if coalesce(v_eq.rarity, 'N') not in ('R', 'E', 'L') then
    return jsonb_build_object('ok', false, 'error', 'ノーマルの装備は作れません');
  end if;
  v_need := case v_eq.rarity when 'R' then 30 when 'E' then 100 when 'L' then 300 end;
  v_gold := greatest(1, v_eq.lv)::bigint * (case v_eq.rarity when 'R' then 50 when 'E' then 100 when 'L' then 200 end);
  v_key  := v_eq.area::text;
  v_mats := coalesce(v_row.materials, '{}'::jsonb);
  v_have := coalesce((v_mats ->> v_key)::int, 0);
  if v_have < v_need then return jsonb_build_object('ok', false, 'error', '残骸が足りません'); end if;
  if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;

  v_mats := jsonb_set(v_mats, array[v_key], to_jsonb(v_have - v_need));
  update public.v2cap_profiles
     set materials = v_mats, gold = gold - v_gold, updated_at = now()
   where id = v_uid;
  insert into public.v2cap_inventory (player_id, base_id, ilv)
  values (v_uid, v_eq.id, v_eq.lv) returning id into v_inv;
  return jsonb_build_object('ok', true, 'id', v_inv, 'base_id', v_eq.id, 'rarity', v_eq.rarity, 'ilv', v_eq.lv,
    'area', v_eq.area, 'scrap', v_need, 'gold', v_gold, 'materials', v_mats, 'gold_left', v_row.gold - v_gold);
end;
$$;
revoke all on function public.v2cap_craft(text) from public, anon;
grant execute on function public.v2cap_craft(text) to authenticated;

-- ============================================================
-- ===== 8-2. アイコン（2026-10-11）=====
-- ============================================================
-- 【確定】ユーザー指示「自分で設定できるように」：用意された8枚から選ぶか、自分でアップロードした画像にする（アップロードは無料）。
-- ★入れられるのは avatars バケットの「用意された8枚」か「自分のフォルダ（<ユーザーID>/名前）」だけ。
--   他人の画像・外のURL・おかしな名前は入れない（写しは src/v2cap/lib/avatar.js の isAllowedAvatar）
create or replace function public.v2cap_set_avatar(p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_path is not null and not (
       p_path = any(array['warrior1.png', 'knight1.png', 'samurai.png', 'hunter1.png', 'hunter2.png', 'wizard1.png', 'wizard2.png', 'priest.png'])
    or (left(p_path, 37) = v_uid::text || '/' and substr(p_path, 38) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
  ) then
    return jsonb_build_object('ok', false, 'error', 'その画像は選べません');
  end if;
  update public.v2cap_profiles set avatar = p_path, updated_at = now() where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true, 'avatar', p_path);
end;
$$;
revoke all on function public.v2cap_set_avatar(text) from public, anon;
grant execute on function public.v2cap_set_avatar(text) to authenticated;

-- ============================================================
-- ===== 8-3. ユグレシアの宝樹（2026-10-11）=====
-- ============================================================
-- 【確定】ユーザー指示「祈ったら大凶～大吉が出る、出た結果によって経験値もらえる」＋決めたこと（写しは src/v2cap/lib/tree.js）：
--   ・ごほうびは経験値だけ。基準＝祈った時点のLVの必要EXP × 2%（〜30）・1%（31〜50）・0.5%（51〜80）・0.1%（81〜）、
--     それに運勢の倍率（大吉×3〜大凶×0.2・今のⅡと同じ）。端数は切り上げ。EXPは戦闘と同じ扱い（v2cap_apply_exp）
--   ・運勢の並び・出やすさは今のⅡ（v2_pray・src/v2/lib/tree.js の FORTUNES）と同じ
--   ・1日1回（日本時間の5時で切り替わる）。この版は管理者しか入れないので、管理者だけ何回でも、はしない
create or replace function public.v2cap_pray()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_names  constant text[] := array['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
  c_weight constant int[]  := array[5, 10, 15, 25, 20, 15, 10];
  c_mult   constant int[]  := array[30, 20, 15, 10, 7, 4, 2];   -- 運勢の倍率（10分率）
  c_keep   constant int    := 10;                               -- 履歴として残す件数
  v_uid   uuid := auth.uid();
  v_roll  int;
  v_acc   int := 0;
  v_idx   int := 7;
  v_name  text;
  v_lv    int;
  v_permil int;
  v_exp   int;
  v_count int;
  v_log   jsonb;
  v_res   jsonb := null;
  i       int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;

  -- 先に引く。祈れなかったときは下のUPDATEが空振りして、この結果は捨てられる
  v_roll := floor(random() * 100)::int;   -- 0〜99
  for i in 1 .. array_length(c_names, 1) loop
    v_acc := v_acc + c_weight[i];
    if v_roll < v_acc then v_idx := i; exit; end if;
  end loop;
  v_name := c_names[v_idx];

  -- ★「今日まだ祈っていないこと」の確認と記録を1文でやる＝連打しても2回引けない
  update public.v2cap_profiles p
     set last_pray_at = now(),
         last_fortune = v_name,
         pray_count   = p.pray_count + 1,
         -- 新しいものを先頭に積んで、c_keep 件で切る
         pray_log     = (
           select coalesce(jsonb_agg(s.e order by s.ord), '[]'::jsonb)
             from (
               select e, ord
                 from jsonb_array_elements(
                        jsonb_build_array(jsonb_build_object(
                          'at',      to_char(now() at time zone 'Asia/Tokyo', 'MM/DD HH24:MI'),
                          'fortune', v_name))
                        || coalesce(p.pray_log, '[]'::jsonb)
                      ) with ordinality as t(e, ord)
                order by ord
                limit c_keep
             ) s
         ),
         updated_at   = now()
   where p.id = v_uid
     and (p.last_pray_at is null
          or ((p.last_pray_at at time zone 'Asia/Tokyo') - interval '5 hours')::date
           < ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date)
   returning p.lv, p.pray_count, p.pray_log into v_lv, v_count, v_log;

  if not found then
    if not exists (select 1 from public.v2cap_profiles where id = v_uid) then
      return jsonb_build_object('ok', false, 'error', 'キャラクターがいません');
    end if;
    return jsonb_build_object('ok', false, 'error', '今日はもう祈りました（日本時間の5時に変わります）');
  end if;

  -- 経験値：祈った時点のLVの必要EXP × 千分率 × 倍率（10分率）。切り上げは整数で（tree.js の prayExpOf と同じ）
  v_lv     := greatest(1, coalesce(v_lv, 1));
  v_permil := case when v_lv <= 30 then 20 when v_lv <= 50 then 10 when v_lv <= 80 then 5 else 1 end;
  v_exp    := (public.v2cap_need(v_lv) * v_permil * c_mult[v_idx] + 9999) / 10000;
  if v_exp > 0 then v_res := public.v2cap_apply_exp(v_uid, v_exp); end if;

  return jsonb_build_object('ok', true, 'fortune', v_name, 'lv', v_lv, 'exp', v_exp,
                            'pray_count', v_count, 'pray_log', v_log, 'level', v_res);
end;
$$;
revoke all on function public.v2cap_pray() from public, anon;
grant execute on function public.v2cap_pray() to authenticated;

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
  delete from public.v2cap_kills where player_id = auth.uid();
  delete from public.v2cap_profiles where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2cap_dev_reset() from public, anon;
grant execute on function public.v2cap_dev_reset() to authenticated;

-- ============================================================
-- ===== 10. デイリーミッション（2026-10-10）=====
-- ============================================================
-- 【確定】ユーザー指示「V2と一緒でデイリーミッションを追加したい、報酬は自分のレベルによって変わる」＋決めたこと
--   （設計 docs/v2cap-design.md「デイリーミッション」・写しは src/v2cap/lib/daily.js）：
--   ・1日1組・**難易度はなし**。「受注」してから数える（受注する前にやったことは数えない）
--   ・日付が変わるのは日本時間の5時（今のⅡの v2_daily_roll と同じ式）
--   ・報酬は**受注した時点のLV**（daily_lv）で決まる：EXP＝そのLVの必要EXP×%（〜10は10%・〜30は5%・〜50は3%・51〜は1%・切り上げ）／
--     Gold＝LV×100。EXPは戦闘と同じ扱い（v2cap_apply_exp＝いまの職業のClassEXPにも同じ量）
--   ・ミッションの一覧は v2cap_daily_tasks（いまは仮の「出撃に10回勝つ」）。数えるのは各RPC（いまは出撃の精算だけ）

-- 日付が変わっていたら、その日の状態を空にする（内部ヘルパ）
create or replace function public.v2cap_daily_roll(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date;
begin
  update public.v2cap_profiles
     set daily_day = v_today, daily_lv = null, daily_counts = '{}'::jsonb, daily_claimed = false
   where id = p_player and daily_day is distinct from v_today;
end;
$$;
revoke all on function public.v2cap_daily_roll(uuid) from public, anon, authenticated;

-- 進みを数える（内部ヘルパ・各RPCから呼ぶ）。一覧に無いキー・受注していない日・受け取ったあとは数えない
create or replace function public.v2cap_daily_bump(p_player uuid, p_key text, p_n int default 1)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_n, 0) <= 0 or not exists (select 1 from public.v2cap_daily_tasks t where t.key = p_key) then
    return;
  end if;
  perform public.v2cap_daily_roll(p_player);
  update public.v2cap_profiles
     set daily_counts = jsonb_set(coalesce(daily_counts, '{}'::jsonb), array[p_key],
                                  to_jsonb(coalesce((daily_counts ->> p_key)::int, 0) + p_n))
   where id = p_player and daily_lv is not null and not daily_claimed;
end;
$$;
revoke all on function public.v2cap_daily_bump(uuid, text, int) from public, anon, authenticated;

-- 報酬（受注した時点のLVで決まる）。切り上げは整数で：(必要EXP×% + 99) ÷ 100（daily.js の dailyRewardOf と同じ）
create or replace function public.v2cap_daily_reward(p_lv int)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'exp', (public.v2cap_need(greatest(1, coalesce(p_lv, 1)))
            * (case when greatest(1, coalesce(p_lv, 1)) <= 10 then 10
                    when greatest(1, coalesce(p_lv, 1)) <= 30 then 5
                    when greatest(1, coalesce(p_lv, 1)) <= 50 then 3
                    else 1 end) + 99) / 100,
    'gold', greatest(1, coalesce(p_lv, 1)) * 100)
$$;
revoke all on function public.v2cap_daily_reward(int) from public, anon;

-- 受注する：今日のミッションを受ける。報酬はこの時点のLVで決まる（daily_lv に入れる）。1日1回
create or replace function public.v2cap_daily_accept()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2cap_profiles;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから（同時に2回押しても、受注は1回だけ）
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  perform public.v2cap_daily_roll(v_uid);
  select * into v_row from public.v2cap_profiles where id = v_uid;
  if v_row.daily_lv is not null then
    return jsonb_build_object('ok', false, 'error', '今日のミッションはもう受注しました');
  end if;
  update public.v2cap_profiles
     set daily_lv = lv, daily_counts = '{}'::jsonb, daily_claimed = false, updated_at = now()
   where id = v_uid
   returning * into v_row;
  return jsonb_build_object('ok', true, 'daily_lv', v_row.daily_lv, 'reward', public.v2cap_daily_reward(v_row.daily_lv));
end;
$$;
revoke all on function public.v2cap_daily_accept() from public, anon;
grant execute on function public.v2cap_daily_accept() to authenticated;

-- 受け取る：全部そろっていたら、受注した時点のLVの報酬を入れる。1日1回
create or replace function public.v2cap_daily_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_rw   jsonb;
  v_exp  int;
  v_gold int;
  v_n    int;
  v_res  jsonb := null;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから見る（同時に2回押しても、受け取りは1回だけ）
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  perform public.v2cap_daily_roll(v_uid);
  select * into v_row from public.v2cap_profiles where id = v_uid;
  if v_row.daily_lv is null then return jsonb_build_object('ok', false, 'error', 'まだ受注していません'); end if;
  if v_row.daily_claimed then return jsonb_build_object('ok', false, 'error', '今日はもう受け取りました'); end if;
  if exists (select 1 from public.v2cap_daily_tasks t
              where coalesce((v_row.daily_counts ->> t.key)::int, 0) < t.goal) then
    return jsonb_build_object('ok', false, 'error', 'まだ達成していない項目があります');
  end if;
  v_rw   := public.v2cap_daily_reward(v_row.daily_lv);
  v_exp  := (v_rw ->> 'exp')::int;
  v_gold := (v_rw ->> 'gold')::int;
  update public.v2cap_profiles
     set daily_claimed = true, gold = gold + v_gold, updated_at = now()
   where id = v_uid and not daily_claimed;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', '今日はもう受け取りました'); end if;
  if v_exp > 0 then v_res := public.v2cap_apply_exp(v_uid, v_exp); end if;
  return jsonb_build_object('ok', true, 'daily_lv', v_row.daily_lv, 'exp', v_exp, 'gold', v_gold, 'level', v_res);
end;
$$;
revoke all on function public.v2cap_daily_claim() from public, anon;
grant execute on function public.v2cap_daily_claim() to authenticated;
