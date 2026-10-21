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
--   ・クラスLV（表記は ClassLV）を職業ごとに持つ。上限は初期職30・上位職50（v2cap_stages.max_jlv）。入るのは今の職業。上がるとスキルを覚える
--   ・上位職は20職（2026-10-10）：系統の初期職のClassLV30で就ける・必要ClassEXPは初期職の3倍・ClassLV1ごとに6点・武器は系統の初期職と同じ
--   ・初期職は11職（2026-10-09 に剣士を足した）。職業ごとに装備できる武器が3〜4種決まっている。上位職は一旦なし
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
--     （EXP＝そのLVの推奨の場所で10回出撃したくらい・Gold＝LV×100）。受注は自動（2026-10-15・ログインしたとき／日付が変わって最初に数えるとき）。
--     内容は 出撃に10回勝つ・装備を強化または分解する・塔に挑戦する（守護者なら達成済み）・宝樹に祈る（2026-10-15 に3つ足した）
--   ・賭博場（2026-10-13・§11）：メダル（100 Gold＝1枚・Goldへは戻せない）・スロット（AT機）・ハイ&ロー（連勝はしご）・
--     ルーレット（ラッキーナンバー付き）。還元率はどれも約97%。景品の交換所はあとで
--   ・塔（2026-10-14・§13）：あるけみすと型の対人。1〜100層の階層守護者に挑む・負けたら2つ下・守護者のHP/MPは回復しない・
--     勝ち負けによらず出撃と同じ報酬・出撃と待ち時間を共有・守護者でいるあいだは出撃の装備のドロップ率+1%
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
-- learn_at … スキルを覚えるClassLV（その職業の技を v2cap_skills の sort 順に当てる）／max_jlv … ClassLVの上限／
-- need_base … 必要ClassEXPに毎回足す量（2026-10-12 ユーザー指示「初期クラスは必要経験値15にして、上位職は30で」）
-- ★初期（ClassLV30まで）と上位（2026-10-10・ClassLV50まで）
create table if not exists public.v2cap_stages (
  stage     text primary key,
  mult      int  not null,
  per_lv    int  not null,
  learn_at  int[] not null,
  max_jlv   int  not null default 30,
  need_base int  not null default 0
);
alter table public.v2cap_stages add column if not exists max_jlv int not null default 30;
alter table public.v2cap_stages add column if not exists need_base int not null default 0;
alter table public.v2cap_stages enable row level security;
drop policy if exists v2cap_stages_read on public.v2cap_stages;
create policy v2cap_stages_read on public.v2cap_stages for select to authenticated using (true);
revoke all on table public.v2cap_stages from anon;
grant select on table public.v2cap_stages to authenticated;

-- @@seed:stages
insert into public.v2cap_stages (stage, mult, per_lv, learn_at, max_jlv, need_base) values
  ('shoki', 1, 8, '{1,5,10,15,20,25,30}'::int[], 30, 15),
  ('ichiji', 3, 10, '{1,5,10,15,20,25,30,35,40,45}'::int[], 50, 30)
on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at, max_jlv = excluded.max_jlv, need_base = excluded.need_base;
-- @@end:stages

-- ---- 1-2. 職業 ----
-- req_cls / req_jlv … 就くのに要る職業とClassLV（初期職は null）
-- bonus_seq … ClassLVで上がるステの並び（1点ずつ。jobs.js の bonusSeqOf と同じ）
-- weapons … 装備できる武器の種類（3つまで・上位職は系統の初期職と同じ）／kind … 通常攻撃が物理（phys）か魔法（mag）か
--   ★2026-10-11 ユーザー指示「クラスごとに装備できる武器種は3つまでに」：戦士から刀・盗賊から片手剣・魔法使いから短剣・
--     呪術師から投擲・僧侶から宝珠を外した。着けていた人の武器は §2 の後ろで外す（持ち物には残る）
-- lineage … スキルを使える職業＝[自分, 下位職, その下位職, …]（jobs.js の lineageOf。req_cls をさかのぼったもの）
--   ★スキルは「その職業でだけ使える。上位職は下位職のスキルも使える」（2026-10-09 ユーザー決定）
-- lv_hp / lv_mp … ClassLVが1上がるたびに必ず上がるHP・MP（bonus_seq の点数とは別。jobs.js の JOB_LV_HPMP）
--   ★2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいい」
--   ★2026-10-12 ユーザー指示で ClassLVごとの点数（v2cap_stages.per_lv）を 初期職5→8・上位職6→10、lv_hp・lv_mp も1.6倍
-- starter … キャラ作成で配る初期装備（v2cap_equipment の id を 武器・頭・鎧・腕・足・装飾品①・装飾品② の順。初期職だけ）
--   ★2026-10-12 ユーザー指示「キャラ作成時そのクラスに対応する装備一式（lv１）」（equipment.js の STARTER_SET）
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
alter table public.v2cap_classes add column if not exists starter text[] not null default '{}';
alter table public.v2cap_classes enable row level security;
drop policy if exists v2cap_classes_read on public.v2cap_classes;
create policy v2cap_classes_read on public.v2cap_classes for select to authenticated using (true);
revoke all on table public.v2cap_classes from anon;
grant select on table public.v2cap_classes to authenticated;

-- @@seed:classes
delete from public.v2cap_classes where id <> all('{剣士,戦士,槍使い,格闘家,盗賊,弓使い,銃士,魔法使い,呪術師,僧侶,薬師,侍,魔法剣士,狂戦士,聖騎士,竜騎士,ストームランサー,体術師,サイキッカー,暗殺者,忍者,狩人,アークアーチャー,魔銃士,デストロイヤー,元素使い,クロノマンサー,死霊使い,式神使い,聖職者,異端審問官,アルケミスト,霊薬師}'::text[]);
insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq, weapons, kind, lineage, lv_hp, lv_mp, starter) values
  ('剣士', 'shoki', 0, null, null, '{str,dex,agi,vit,hp,str,mp,dex,agi,str,vit,dex,str,hp,agi,luk,str,dex,vit,str,agi,hp,dex,mp,str,dex,agi,str,vit,hp,str,dex,agi,vit,str,mp,dex,str,agi,hp,dex,str,vit,luk,agi,str,dex,hp,str,vit,agi,dex,mp,str,hp,dex,str,agi,vit,str,dex,agi,str,hp,mp,dex,vit,str,agi,dex,str,luk,hp,vit,str,agi,dex,str,mp,dex,agi,str,vit,hp,dex,str,agi,vit,str,dex,hp,agi,str,mp,dex,str,vit,agi,hp,dex,str,luk,str,dex,agi,vit,str,hp,dex,mp,agi,str,vit,dex,str,hp,agi,str,dex,vit,str,agi,mp,dex,hp,str,vit,agi,dex,str,luk,str,dex,hp,agi,vit,str,dex,mp,str,agi,hp,dex,str,vit,agi,str,dex,hp,vit,str,agi,dex,mp,str,luk,dex,str,agi,vit,hp,str,dex,agi,str,vit,dex,mp,hp,str,agi,dex,str,vit,agi,str,dex,hp,str,mp,dex,agi,vit,str,hp,dex,str,agi,luk,vit,str,dex,hp,agi,str,dex,mp,str,vit,agi,dex,str,hp,vit,str,agi,dex,str,mp,dex,hp,agi,str,vit,dex,str,luk,agi,hp,str,dex,vit,str,agi,dex,mp,str,hp,vit,agi,dex,str}'::text[], '{刀,片手剣,両手剣}'::text[], 'phys', '{剣士}'::text[], 13, 2, '{0N:刀,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('戦士', 'shoki', 1, null, null, '{str,vit,hp,dex,agi,str,vit,hp,mp,str,vit,luk,str,hp,dex,agi,vit,str,hp,str,vit,mp,hp,str,dex,vit,agi,str,hp,vit,str,dex,agi,hp,vit,str,mp,str,vit,hp,luk,str,vit,dex,hp,agi,str,vit,str,hp,mp,vit,str,dex,agi,hp,str,vit,hp,str,vit,dex,agi,str,hp,mp,vit,str,hp,luk,vit,str,dex,agi,str,hp,vit,str,mp,vit,hp,str,dex,agi,vit,str,hp,vit,str,hp,dex,agi,str,vit,mp,hp,str,vit,luk,str,hp,dex,agi,vit,str,hp,vit,str,mp,dex,str,hp,vit,agi,str,hp,vit,str,dex,agi,vit,hp,str,mp,str,vit,hp,luk,str,vit,dex,agi,hp,str,vit,str,hp,mp,vit,str,dex,agi,hp,str,vit,hp,str,vit,dex,agi,str,hp,vit,mp,str,luk,vit,hp,str,dex,agi,str,vit,hp,str,vit,mp,hp,str,dex,agi,vit,str,hp,vit,str,hp,dex,agi,str,vit,mp,hp,str,vit,luk,str,hp,dex,vit,agi,str,hp,vit,str,mp,dex,str,vit,hp,agi,str,vit,hp,str,dex,vit,agi,str,hp,mp,vit,str,hp,luk,str,vit,dex,agi,str,hp,vit,str,hp,mp,vit,str,dex,agi,hp,vit,str}'::text[], '{両手剣,斧,鈍器}'::text[], 'phys', '{戦士}'::text[], 13, 2, '{0N:両手剣,0N:重鎧頭,0N:重鎧鎧,0N:重鎧腕,0N:重鎧足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('槍使い', 'shoki', 2, null, null, '{str,dex,agi,hp,str,vit,dex,str,mp,str,agi,dex,hp,str,luk,vit,str,dex,str,agi,dex,mp,str,hp,str,dex,vit,agi,str,dex,str,hp,mp,str,dex,agi,vit,str,dex,str,hp,luk,str,agi,dex,str,vit,hp,str,dex,agi,str,mp,dex,str,vit,str,hp,dex,agi,str,dex,str,mp,vit,agi,str,dex,hp,str,luk,str,dex,agi,str,vit,hp,dex,str,mp,str,dex,agi,str,hp,dex,str,vit,agi,str,dex,mp,str,hp,dex,str,vit,agi,str,dex,luk,str,hp,agi,str,dex,vit,str,mp,dex,str,hp,agi,str,dex,str,vit,dex,str,agi,hp,str,dex,mp,str,vit,agi,str,dex,hp,str,luk,dex,str,agi,vit,str,dex,mp,hp,str,dex,str,agi,str,vit,dex,hp,str,agi,dex,str,mp,str,dex,hp,vit,str,agi,luk,str,dex,str,hp,dex,str,agi,vit,mp,str,dex,str,hp,dex,agi,str,vit,str,dex,mp,str,agi,hp,str,dex,vit,str,dex,luk,str,agi,hp,str,dex,mp,str,vit,dex,str,agi,hp,str,dex,str,agi,vit,dex,str,hp,str,mp,dex,agi,str,luk,str,dex,vit,str,hp,dex,agi,str,mp,str,dex,vit,str,hp,agi,dex,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{槍使い}'::text[], 13, 2, '{0N:槍,0N:重鎧頭,0N:重鎧鎧,0N:重鎧腕,0N:重鎧足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('格闘家', 'shoki', 3, null, null, '{str,agi,hp,vit,dex,str,agi,mp,str,agi,hp,vit,str,agi,luk,hp,str,agi,dex,str,vit,agi,mp,hp,str,agi,str,vit,agi,hp,str,dex,agi,str,mp,vit,agi,hp,str,agi,luk,str,dex,hp,agi,vit,str,agi,str,hp,mp,agi,vit,str,dex,agi,str,hp,agi,str,vit,hp,agi,str,mp,dex,agi,str,vit,hp,agi,str,luk,agi,str,vit,hp,str,agi,dex,mp,str,agi,hp,vit,str,agi,hp,str,agi,dex,vit,str,agi,mp,hp,str,agi,luk,str,vit,agi,hp,str,agi,dex,str,vit,agi,hp,mp,str,agi,str,dex,hp,agi,vit,str,agi,str,mp,hp,agi,vit,str,dex,agi,str,hp,luk,agi,str,vit,agi,hp,str,mp,agi,str,vit,dex,agi,hp,str,agi,str,vit,hp,agi,str,mp,dex,agi,str,hp,vit,str,agi,luk,str,agi,hp,vit,str,agi,dex,mp,str,agi,hp,vit,str,agi,hp,str,agi,dex,str,vit,agi,mp,hp,str,agi,luk,str,vit,agi,hp,str,dex,agi,str,mp,hp,agi,vit,str,agi,dex,str,hp,agi,vit,str,agi,hp,str,mp,agi,vit,str,dex,agi,hp,str,luk,agi,str,vit,hp,agi,str,mp,dex,agi,str,vit,hp,agi,str}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{格闘家}'::text[], 13, 2, '{0N:拳,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('盗賊', 'shoki', 4, null, null, '{agi,str,dex,hp,agi,str,luk,mp,agi,dex,str,vit,agi,str,dex,agi,str,hp,luk,agi,dex,str,agi,mp,str,agi,dex,vit,str,agi,hp,luk,dex,str,agi,str,agi,dex,agi,str,hp,luk,agi,dex,str,mp,vit,agi,str,dex,agi,str,hp,agi,luk,str,dex,agi,str,mp,agi,dex,str,vit,agi,hp,str,dex,agi,luk,str,agi,dex,str,agi,mp,vit,agi,str,dex,hp,luk,agi,str,dex,agi,str,agi,str,dex,hp,agi,luk,str,agi,dex,str,mp,agi,vit,str,dex,agi,hp,str,luk,agi,dex,str,agi,mp,str,agi,dex,vit,hp,agi,str,luk,dex,agi,str,agi,str,dex,agi,hp,str,luk,agi,dex,str,mp,agi,vit,str,dex,agi,str,hp,agi,luk,dex,str,agi,str,agi,dex,mp,str,agi,vit,hp,luk,agi,str,dex,agi,str,dex,agi,str,hp,luk,agi,str,dex,agi,mp,str,vit,agi,dex,str,agi,hp,str,dex,agi,luk,str,agi,dex,str,agi,mp,vit,str,dex,agi,hp,luk,str,agi,dex,agi,str,hp,agi,str,dex,luk,agi,str,mp,vit,agi,dex,str,agi,str,dex,agi,hp,luk,str,agi,dex,str,agi,mp,vit,str,agi,dex,hp,str,agi,luk,dex,str,agi}'::text[], '{短剣,投擲,刀}'::text[], 'phys', '{盗賊}'::text[], 6, 2, '{0N:短剣,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('弓使い', 'shoki', 5, null, null, '{agi,str,dex,hp,luk,agi,str,mp,dex,agi,vit,hp,str,agi,dex,agi,str,hp,luk,dex,agi,str,hp,agi,dex,mp,str,agi,vit,luk,agi,hp,dex,str,agi,str,dex,hp,agi,str,luk,agi,dex,mp,hp,agi,str,vit,dex,agi,str,hp,agi,dex,luk,str,agi,hp,dex,agi,str,mp,vit,agi,hp,dex,str,agi,luk,str,agi,dex,hp,agi,str,dex,mp,agi,hp,str,luk,agi,dex,vit,str,agi,hp,dex,agi,str,luk,hp,agi,dex,str,agi,mp,vit,hp,str,agi,dex,luk,agi,str,dex,hp,agi,str,dex,agi,hp,str,agi,mp,dex,luk,vit,agi,str,hp,agi,dex,str,agi,hp,dex,str,agi,luk,mp,agi,str,dex,hp,vit,agi,str,dex,agi,hp,luk,str,agi,dex,hp,agi,str,mp,dex,agi,vit,str,luk,agi,hp,dex,str,agi,hp,dex,agi,str,luk,agi,str,dex,hp,agi,mp,vit,str,agi,dex,hp,agi,str,luk,dex,agi,hp,str,agi,dex,mp,str,agi,hp,vit,dex,agi,str,luk,agi,hp,dex,str,agi,luk,str,dex,agi,hp,mp,agi,str,vit,dex,agi,hp,str,agi,dex,luk,hp,str,agi,dex,agi,str,hp,mp,agi,dex,vit,str,agi,luk,hp,dex,str,agi}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{弓使い}'::text[], 6, 2, '{0N:弓,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('銃士', 'shoki', 6, null, null, '{dex,agi,str,luk,dex,hp,mp,agi,dex,str,vit,dex,agi,luk,dex,str,agi,dex,hp,str,dex,agi,mp,luk,dex,str,agi,dex,vit,hp,dex,agi,str,dex,luk,mp,agi,dex,str,dex,agi,hp,luk,dex,str,vit,agi,dex,str,dex,agi,mp,luk,dex,hp,str,agi,dex,dex,agi,str,vit,dex,luk,mp,agi,dex,str,hp,dex,agi,luk,dex,str,agi,dex,vit,str,dex,hp,agi,mp,dex,luk,str,agi,dex,dex,agi,str,hp,dex,luk,mp,agi,dex,str,vit,dex,agi,luk,dex,str,hp,agi,dex,str,dex,agi,mp,luk,dex,str,agi,dex,hp,vit,dex,agi,str,dex,luk,mp,agi,dex,str,dex,hp,agi,luk,dex,str,agi,dex,vit,str,dex,agi,mp,luk,dex,hp,str,agi,dex,dex,agi,str,luk,dex,vit,mp,agi,dex,str,hp,dex,agi,luk,dex,str,agi,dex,hp,str,dex,agi,mp,luk,dex,vit,str,agi,dex,hp,dex,agi,str,dex,luk,mp,agi,dex,str,dex,agi,vit,luk,dex,str,hp,agi,dex,str,dex,agi,mp,luk,dex,str,agi,dex,hp,vit,dex,agi,str,dex,luk,mp,agi,dex,str,hp,dex,agi,luk,dex,str,agi,dex,vit,str,dex,agi,mp,hp,dex,luk,str,agi,dex}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{銃士}'::text[], 6, 2, '{0N:銃,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:イヤリング,0N:イヤリング}'::text[]),
  ('魔法使い', 'shoki', 7, null, null, '{int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat,int_stat,mp,agi,hp,int_stat,dex,vit,mp,int_stat,agi,int_stat,mp,luk,hp,int_stat,agi,dex,mp,int_stat,agi,int_stat,mp,vit,hp,int_stat,dex,agi,mp,int_stat}'::text[], '{杖,書,宝珠}'::text[], 'mag', '{魔法使い}'::text[], 10, 5, '{0N:杖,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:リング,0N:リング}'::text[]),
  ('呪術師', 'shoki', 8, null, null, '{int_stat,mp,dex,luk,agi,int_stat,hp,mp,int_stat,vit,dex,luk,int_stat,mp,agi,int_stat,mp,dex,hp,int_stat,luk,mp,int_stat,agi,dex,int_stat,mp,vit,luk,int_stat,hp,mp,dex,int_stat,agi,luk,int_stat,mp,dex,int_stat,mp,hp,agi,int_stat,luk,vit,mp,int_stat,dex,int_stat,mp,luk,agi,int_stat,dex,hp,mp,int_stat,luk,mp,int_stat,dex,vit,agi,int_stat,mp,hp,int_stat,luk,dex,mp,int_stat,agi,int_stat,mp,luk,dex,int_stat,hp,mp,vit,int_stat,agi,dex,luk,int_stat,mp,int_stat,mp,dex,hp,int_stat,luk,agi,mp,int_stat,vit,dex,int_stat,mp,luk,agi,int_stat,hp,mp,dex,int_stat,luk,mp,int_stat,agi,dex,int_stat,mp,vit,hp,int_stat,luk,mp,int_stat,dex,agi,int_stat,mp,luk,int_stat,dex,hp,mp,int_stat,agi,luk,mp,int_stat,dex,vit,int_stat,mp,hp,luk,int_stat,agi,dex,mp,int_stat,luk,int_stat,mp,dex,agi,int_stat,vit,mp,hp,int_stat,dex,luk,mp,int_stat,agi,int_stat,mp,dex,luk,int_stat,hp,mp,int_stat,agi,vit,dex,int_stat,mp,luk,int_stat,hp,mp,dex,int_stat,agi,luk,mp,int_stat,dex,int_stat,mp,vit,luk,int_stat,agi,hp,mp,int_stat,dex,luk,int_stat,mp,agi,int_stat,dex,mp,hp,int_stat,luk,vit,mp,int_stat,dex,agi,int_stat,mp,luk,int_stat,hp,dex,mp,int_stat,agi,luk,int_stat,mp,dex,vit,int_stat,mp,hp,int_stat,agi,luk,dex,mp,int_stat}'::text[], '{杖,短剣,宝珠}'::text[], 'mag', '{呪術師}'::text[], 6, 5, '{0N:杖,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:リング,0N:リング}'::text[]),
  ('僧侶', 'shoki', 9, null, null, '{int_stat,vit,hp,mp,agi,int_stat,vit,hp,mp,int_stat,dex,vit,hp,int_stat,mp,luk,vit,int_stat,hp,agi,mp,int_stat,vit,hp,int_stat,mp,vit,hp,int_stat,agi,dex,vit,mp,int_stat,hp,int_stat,vit,mp,hp,int_stat,vit,luk,agi,mp,int_stat,hp,vit,int_stat,hp,mp,vit,int_stat,dex,hp,agi,int_stat,mp,vit,int_stat,hp,vit,mp,int_stat,hp,vit,agi,int_stat,mp,hp,vit,int_stat,luk,mp,dex,int_stat,hp,vit,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat,agi,vit,int_stat,mp,hp,int_stat,dex,vit,hp,mp,int_stat,vit,luk,hp,int_stat,mp,agi,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,mp,vit,dex,hp,int_stat,agi,vit,mp,int_stat,hp,vit,int_stat,mp,hp,agi,int_stat,vit,luk,mp,int_stat,hp,vit,int_stat,mp,hp,vit,dex,int_stat,agi,hp,mp,int_stat,vit,int_stat,hp,vit,mp,int_stat,agi,hp,vit,mp,int_stat,dex,vit,hp,int_stat,mp,luk,int_stat,vit,hp,agi,int_stat,mp,vit,hp,int_stat,mp,vit,hp,int_stat,agi,vit,int_stat,mp,hp,dex,int_stat,vit,mp,hp,int_stat,vit,luk,hp,int_stat,mp,agi,vit,int_stat,hp,mp,vit,int_stat,hp,dex,int_stat,mp,vit,agi,int_stat,hp,vit,mp,int_stat,hp,vit,int_stat,mp,agi,hp,int_stat,vit,luk,mp,int_stat,hp,vit,dex,int_stat,mp,hp,vit,int_stat,agi,mp,hp,vit,int_stat}'::text[], '{鈍器,杖,書}'::text[], 'mag', '{僧侶}'::text[], 13, 5, '{0N:杖,0N:重鎧頭,0N:重鎧鎧,0N:重鎧腕,0N:重鎧足,0N:リング,0N:リング}'::text[]),
  ('薬師', 'shoki', 10, null, null, '{int_stat,dex,mp,hp,agi,int_stat,vit,dex,mp,int_stat,hp,dex,luk,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,dex,vit,hp,agi,int_stat,mp,dex,int_stat,hp,dex,mp,int_stat,agi,vit,int_stat,dex,hp,mp,int_stat,dex,luk,hp,mp,int_stat,agi,dex,int_stat,mp,hp,dex,int_stat,vit,agi,mp,int_stat,dex,hp,int_stat,dex,mp,agi,int_stat,hp,vit,dex,int_stat,mp,hp,dex,int_stat,luk,mp,agi,int_stat,dex,hp,int_stat,mp,dex,vit,int_stat,agi,hp,mp,dex,int_stat,hp,dex,int_stat,mp,agi,int_stat,vit,dex,mp,hp,int_stat,dex,luk,int_stat,mp,agi,hp,dex,int_stat,mp,vit,int_stat,dex,hp,agi,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,agi,vit,hp,dex,int_stat,mp,int_stat,dex,hp,luk,mp,int_stat,agi,dex,int_stat,hp,mp,dex,vit,int_stat,agi,mp,int_stat,dex,hp,int_stat,dex,mp,hp,agi,int_stat,vit,dex,mp,int_stat,hp,dex,int_stat,luk,mp,agi,int_stat,dex,hp,mp,int_stat,dex,vit,hp,int_stat,agi,mp,dex,int_stat,hp,dex,int_stat,mp,agi,vit,int_stat,dex,hp,mp,int_stat,dex,luk,agi,int_stat,mp,hp,dex,int_stat,mp,vit,hp,int_stat,dex,agi,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,agi,hp,vit,dex,int_stat,mp,luk,int_stat,dex,hp,mp,agi,int_stat,dex,hp,int_stat,mp,dex,vit,int_stat,agi,hp,mp,dex,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{薬師}'::text[], 13, 5, '{0N:書,0N:軽装頭,0N:軽装鎧,0N:軽装腕,0N:軽装足,0N:リング,0N:リング}'::text[]),
  ('侍', 'ichiji', 11, '剣士', 30, '{str,dex,agi,hp,str,dex,vit,mp,str,dex,agi,luk,str,dex,hp,str,agi,dex,vit,str,mp,dex,str,agi,hp,dex,str,luk,agi,str,dex,vit,str,dex,hp,agi,str,dex,mp,str,dex,agi,vit,str,hp,dex,str,luk,dex,agi,str,mp,dex,str,hp,agi,vit,str,dex,str,dex,agi,hp,str,dex,mp,vit,str,dex,agi,luk,str,dex,hp,str,agi,dex,str,vit,dex,str,agi,mp,hp,dex,str,luk,str,dex,agi,vit,str,dex,hp,agi,str,dex,mp,str,dex,agi,str,hp,dex,vit,str,luk,dex,agi,str,mp,dex,str,hp,agi,str,dex,vit,str,dex,agi,hp,str,dex,mp,str,luk,dex,agi,str,vit,dex,hp,str,agi,dex,str,mp,dex,str,agi,vit,hp,dex,str,luk,str,dex,agi,str,dex,hp,vit,str,agi,dex,mp,str,dex,agi,str,hp,dex,str,vit,luk,dex,agi,str,mp,dex,str,hp,agi,str,dex,vit,str,dex,agi,hp,str,dex,mp,str,luk,dex,agi,str,vit,dex,str,hp,agi,dex,str,mp,dex,str,agi,hp,str,dex,vit,luk,str,dex,agi,str,dex,hp,agi,str,dex,vit,str,mp,dex,agi,str,hp,dex,str,luk,agi,dex,str,vit,mp,dex,str,hp,agi,str,dex,str,dex,agi,vit,str,hp,dex,str,luk,mp,dex,agi,str,dex,hp,str,agi,vit,dex,str,dex,str,agi,mp,hp,str,dex,vit,str,dex,agi,luk,str,dex,hp,str,agi,dex,mp,str,vit,dex,str,agi,hp,dex,str,luk,agi,dex,str,vit,dex,str,hp,mp,agi,str,dex,str,dex,agi,hp,str,dex,vit,str,luk,dex,agi,str,mp,dex,str,hp,agi,dex,str,vit,dex,str,agi,hp,mp,str,dex,luk,str,dex,agi,vit,str,dex,hp,str,agi,dex,str,mp,dex,agi,str,vit,hp,dex,str,luk,dex,str,agi,hp,str,dex,mp,agi,str,dex,vit,str,dex,agi,str,hp,dex,vit,str,luk,dex,agi,str,mp,dex,str,hp,agi,dex,str,vit,dex,str,agi,hp,str,dex,mp,luk,str,dex,agi,str,vit,dex,hp,str,agi,dex,str,mp,dex,str,agi,hp,dex,str,vit,luk,dex,str,agi,str,dex,hp,mp,agi,str,dex,vit,str,dex,agi,str,hp,dex,str,luk,agi,dex,str,vit,mp,dex,str,hp,agi,dex,str,vit,str,dex,agi,hp,str,dex,mp,str,dex,agi,luk,str,dex,hp,str,agi,vit,dex,str,mp,dex,str,agi,hp,dex,str,vit,luk,dex,str,agi,str,dex,hp,agi,str,dex,mp,str,vit,dex,agi,str,hp,dex,str,luk,agi,dex,str,mp,vit,dex,str,hp,agi,dex,str}'::text[], '{刀,片手剣,両手剣}'::text[], 'phys', '{侍,剣士}'::text[], 13, 3, '{}'::text[]),
  ('魔法剣士', 'ichiji', 12, '剣士', 30, '{str,int_stat,hp,agi,vit,str,int_stat,mp,str,int_stat,hp,agi,str,int_stat,luk,str,hp,int_stat,agi,vit,str,mp,int_stat,str,hp,int_stat,agi,str,int_stat,vit,hp,str,mp,int_stat,agi,str,int_stat,hp,str,agi,int_stat,luk,str,vit,mp,int_stat,str,hp,agi,int_stat,str,hp,int_stat,str,agi,vit,int_stat,str,mp,hp,int_stat,str,agi,str,int_stat,hp,vit,str,int_stat,agi,mp,str,int_stat,hp,luk,str,int_stat,agi,vit,str,int_stat,hp,str,mp,int_stat,agi,str,hp,int_stat,str,agi,vit,int_stat,str,hp,int_stat,mp,str,agi,int_stat,luk,str,hp,int_stat,vit,str,agi,int_stat,str,hp,mp,int_stat,str,agi,hp,int_stat,str,vit,int_stat,str,agi,mp,hp,str,int_stat,luk,str,int_stat,agi,vit,hp,str,int_stat,mp,str,int_stat,agi,hp,str,int_stat,vit,str,agi,int_stat,hp,str,int_stat,mp,str,agi,hp,int_stat,str,vit,int_stat,luk,str,agi,hp,int_stat,str,mp,int_stat,str,hp,agi,vit,int_stat,str,int_stat,hp,str,agi,mp,int_stat,str,vit,hp,int_stat,str,agi,int_stat,str,luk,hp,str,int_stat,agi,mp,str,int_stat,vit,hp,str,int_stat,agi,str,int_stat,mp,hp,str,agi,int_stat,vit,str,int_stat,hp,str,agi,int_stat,mp,str,hp,int_stat,vit,str,agi,int_stat,luk,str,hp,int_stat,str,agi,mp,int_stat,str,vit,hp,int_stat,str,agi,int_stat,str,hp,mp,int_stat,str,agi,vit,int_stat,str,hp,luk,str,int_stat,agi,hp,str,int_stat,vit,mp,str,int_stat,agi,hp,str,int_stat,agi,str,int_stat,hp,vit,str,int_stat,mp,agi,str,int_stat,hp,str,luk,int_stat,agi,str,vit,int_stat,hp,str,mp,int_stat,agi,str,hp,int_stat,str,vit,int_stat,agi,str,hp,mp,int_stat,str,agi,int_stat,str,hp,vit,int_stat,str,luk,mp,agi,int_stat,str,hp,str,int_stat,agi,hp,str,int_stat,vit,str,int_stat,mp,agi,str,hp,int_stat,str,int_stat,vit,agi,hp,str,int_stat,mp,str,luk,int_stat,hp,agi,str,int_stat,vit,str,int_stat,hp,agi,str,mp,int_stat,str,hp,int_stat,agi,str,vit,int_stat,str,hp,mp,int_stat,agi,str,luk,int_stat,str,hp,vit,agi,int_stat,str,mp,int_stat,str,hp,agi,str,int_stat,vit,str,int_stat,hp,agi,str,int_stat,mp,hp,str,int_stat,agi,str,vit,int_stat,luk,str,hp,int_stat,agi,str,mp,int_stat,hp,str,int_stat,vit,agi,str,int_stat,hp,str,mp,int_stat,agi,str,hp,int_stat,str,vit,agi,int_stat,str,luk,hp,int_stat,str,mp,agi,int_stat,str,vit,hp,int_stat,str,agi,str,int_stat,hp,mp,str,int_stat,vit,agi,str,int_stat,hp,str,int_stat,agi,luk,str,hp,int_stat,mp,str,vit,int_stat,agi,str,hp,int_stat,str,mp,int_stat,agi,str,hp,vit,int_stat,str,agi,int_stat,hp,str,int_stat,mp,str,vit,agi,int_stat,hp,str,luk,int_stat,str,agi,hp,int_stat,str,mp,vit,int_stat,str,agi,hp,int_stat,str}'::text[], '{刀,片手剣,両手剣}'::text[], 'phys', '{魔法剣士,剣士}'::text[], 13, 5, '{}'::text[]),
  ('狂戦士', 'ichiji', 13, '戦士', 30, '{str,hp,agi,dex,str,vit,hp,str,agi,mp,str,hp,str,luk,agi,dex,str,hp,vit,str,agi,hp,str,dex,str,hp,agi,str,vit,mp,str,hp,agi,str,dex,hp,str,vit,agi,str,hp,luk,str,dex,agi,str,hp,str,mp,vit,agi,str,hp,str,dex,hp,agi,str,vit,str,hp,agi,str,dex,hp,str,mp,agi,str,hp,vit,str,luk,dex,str,agi,hp,str,hp,agi,str,vit,dex,str,hp,agi,str,mp,hp,str,agi,str,vit,dex,hp,str,agi,str,hp,luk,str,dex,vit,str,hp,agi,str,mp,hp,str,agi,dex,str,hp,vit,str,agi,hp,str,agi,str,dex,hp,str,vit,mp,str,agi,hp,str,luk,hp,str,agi,dex,str,vit,hp,str,agi,dex,str,hp,agi,str,mp,hp,str,vit,str,agi,hp,dex,str,luk,str,hp,agi,vit,str,hp,str,dex,agi,str,hp,mp,str,agi,vit,str,hp,dex,str,agi,hp,str,vit,str,agi,hp,dex,str,mp,hp,str,agi,luk,str,hp,vit,str,dex,agi,str,hp,str,agi,hp,str,dex,vit,str,agi,hp,str,mp,str,hp,agi,dex,str,vit,hp,str,agi,luk,str,hp,dex,str,agi,vit,str,hp,mp,str,agi,hp,str,dex,str,hp,agi,vit,str,hp,str,agi,dex,str,luk,hp,str,mp,agi,str,vit,hp,str,dex,agi,str,hp,str,vit,agi,hp,str,dex,str,hp,agi,str,mp,vit,hp,str,agi,str,dex,hp,str,luk,agi,str,hp,vit,str,dex,agi,hp,str,mp,str,hp,agi,str,vit,dex,str,hp,agi,str,hp,str,agi,dex,str,vit,hp,str,luk,mp,agi,str,hp,str,dex,hp,agi,str,vit,str,hp,agi,str,dex,hp,str,vit,agi,str,mp,hp,str,agi,dex,str,hp,str,luk,vit,agi,str,hp,str,dex,hp,agi,str,mp,str,hp,vit,str,agi,dex,str,hp,agi,str,hp,vit,str,luk,agi,str,hp,dex,str,mp,hp,str,agi,vit,str,hp,dex,str,agi,str,hp,agi,str,vit,hp,str,dex,mp,str,agi,hp,str,vit,luk,str,hp,agi,dex,str,hp,str,agi,str,hp,dex,vit,str,agi,str,hp,mp,str,agi,hp,str,dex,vit,str,agi,hp,str,luk,hp,str,agi,dex,str,vit,hp,str,agi,mp,str,hp,dex,str,agi,hp,str,vit,str,agi,hp,dex,str,mp,str,hp,agi,vit,str,hp,str,agi,dex,str,luk,hp,str,agi,vit,str,hp,dex,str,agi,hp,str,mp,vit,str,agi,hp,str,dex,str,hp,agi,str,luk,hp,vit,str,agi,dex,str,hp,str,mp,agi,str,hp,vit,str,dex,agi,hp,str}'::text[], '{両手剣,斧,鈍器}'::text[], 'phys', '{狂戦士,戦士}'::text[], 16, 3, '{}'::text[]),
  ('聖騎士', 'ichiji', 14, '戦士', 30, '{vit,str,hp,int_stat,vit,str,mp,hp,vit,luk,str,dex,vit,hp,str,int_stat,vit,hp,str,vit,mp,hp,str,vit,int_stat,vit,str,hp,luk,vit,str,hp,dex,vit,str,int_stat,vit,hp,mp,str,vit,hp,str,vit,int_stat,hp,str,vit,luk,mp,vit,str,hp,int_stat,vit,str,hp,dex,vit,str,hp,vit,str,int_stat,vit,hp,mp,str,vit,luk,hp,str,vit,int_stat,vit,str,hp,dex,vit,str,hp,mp,vit,str,int_stat,vit,hp,str,luk,vit,hp,str,vit,int_stat,mp,hp,str,vit,dex,vit,str,hp,int_stat,vit,str,hp,vit,luk,str,hp,vit,mp,str,int_stat,vit,hp,str,vit,dex,hp,str,vit,int_stat,vit,str,hp,mp,vit,str,luk,hp,vit,str,int_stat,vit,hp,str,vit,hp,mp,str,vit,int_stat,dex,hp,str,vit,luk,vit,str,hp,int_stat,vit,str,hp,vit,mp,str,hp,vit,str,int_stat,vit,hp,luk,str,vit,dex,hp,str,vit,mp,int_stat,vit,str,hp,vit,str,hp,vit,int_stat,str,hp,vit,mp,str,luk,vit,hp,str,dex,vit,int_stat,hp,str,vit,vit,str,hp,mp,int_stat,vit,str,hp,vit,luk,str,hp,vit,str,int_stat,vit,dex,hp,str,vit,mp,hp,str,vit,int_stat,vit,str,hp,luk,vit,str,hp,vit,mp,str,int_stat,vit,hp,str,dex,vit,hp,str,vit,int_stat,hp,str,vit,mp,luk,vit,str,hp,int_stat,vit,str,hp,vit,str,dex,hp,vit,mp,str,int_stat,vit,hp,str,vit,luk,hp,str,vit,int_stat,vit,str,hp,mp,vit,str,hp,dex,vit,str,int_stat,vit,hp,str,luk,vit,hp,str,vit,int_stat,mp,hp,str,vit,vit,str,hp,int_stat,vit,str,dex,hp,vit,luk,str,mp,vit,hp,str,int_stat,vit,hp,str,vit,hp,str,vit,int_stat,mp,vit,str,hp,dex,vit,str,luk,hp,vit,str,int_stat,vit,hp,str,mp,vit,hp,str,vit,int_stat,hp,str,vit,luk,dex,vit,str,hp,int_stat,vit,str,mp,hp,vit,str,hp,vit,str,int_stat,vit,hp,luk,str,vit,mp,hp,str,vit,int_stat,dex,vit,str,hp,vit,str,hp,vit,int_stat,str,mp,vit,hp,str,luk,vit,hp,str,vit,int_stat,dex,hp,str,vit,mp,vit,str,hp,int_stat,vit,str,hp,vit,luk,str,hp,vit,str,int_stat,vit,mp,hp,str,vit,dex,hp,str,vit,int_stat,vit,str,hp,luk,vit,str,mp,hp,vit,str,int_stat,vit,hp,str,vit,dex,hp,str,vit,int_stat,mp,hp,str,vit,luk,vit,str,hp,int_stat,vit,str,hp,vit,str,mp,hp,vit,str,int_stat,vit,dex,hp,str,vit,luk,hp,str,vit,int_stat,mp,vit,str,hp,vit,str,hp,vit,int_stat,str,dex,vit,hp,str,luk,vit,hp,mp,str,vit,int_stat,hp,str,vit}'::text[], '{両手剣,斧,鈍器}'::text[], 'phys', '{聖騎士,戦士}'::text[], 16, 5, '{}'::text[]),
  ('竜騎士', 'ichiji', 15, '槍使い', 30, '{str,vit,dex,agi,hp,str,vit,mp,dex,str,agi,vit,str,hp,dex,luk,str,vit,agi,str,dex,vit,hp,str,agi,vit,dex,str,mp,hp,vit,str,agi,dex,str,vit,hp,dex,str,agi,vit,str,luk,dex,vit,str,agi,hp,mp,str,vit,dex,agi,str,vit,hp,dex,str,agi,vit,str,dex,hp,str,vit,agi,mp,str,dex,vit,luk,str,hp,agi,vit,dex,str,vit,str,dex,hp,agi,str,vit,dex,str,mp,agi,vit,hp,str,dex,vit,str,agi,hp,str,dex,vit,luk,str,agi,vit,dex,str,hp,vit,str,agi,dex,mp,str,vit,hp,dex,str,agi,vit,str,dex,vit,hp,str,agi,mp,vit,str,dex,luk,agi,str,vit,hp,dex,str,vit,agi,str,dex,hp,vit,str,agi,dex,str,vit,mp,hp,str,vit,dex,agi,str,vit,str,hp,dex,agi,luk,str,vit,dex,str,vit,agi,hp,str,mp,dex,vit,str,agi,hp,str,vit,dex,str,agi,vit,dex,str,hp,vit,mp,str,agi,dex,luk,vit,str,hp,dex,str,vit,agi,str,vit,dex,hp,str,agi,vit,str,dex,mp,agi,str,vit,hp,dex,str,vit,agi,str,luk,dex,hp,vit,str,agi,vit,str,dex,hp,str,mp,vit,dex,agi,str,vit,hp,str,dex,agi,vit,str,dex,str,vit,hp,agi,str,luk,mp,vit,dex,str,agi,hp,vit,str,dex,str,vit,agi,dex,str,hp,vit,str,agi,dex,vit,mp,str,hp,dex,str,vit,agi,luk,str,vit,dex,hp,str,agi,vit,str,dex,mp,hp,vit,str,agi,dex,str,vit,agi,str,hp,dex,vit,str,agi,vit,str,dex,hp,luk,str,vit,mp,dex,agi,str,vit,hp,str,dex,vit,agi,str,dex,vit,str,hp,agi,str,vit,dex,mp,str,hp,agi,vit,str,dex,luk,vit,str,agi,dex,hp,str,vit,str,agi,dex,vit,str,hp,mp,vit,str,dex,agi,str,vit,hp,dex,str,agi,vit,str,dex,luk,hp,vit,str,agi,mp,dex,str,vit,hp,str,agi,vit,dex,str,vit,agi,str,dex,hp,vit,str,mp,dex,agi,str,vit,hp,str,dex,vit,agi,str,luk,hp,vit,str,dex,agi,str,vit,dex,mp,str,hp,vit,agi,str,dex,vit,str,agi,hp,dex,str,vit,luk,str,dex,vit,agi,hp,str,vit,mp,str,dex,agi,vit,str,hp,dex,str,vit,agi,str,dex,hp,vit,str,agi,mp,dex,vit,str,hp,agi,str,vit,dex,luk,str,vit,agi,str,dex,hp,vit,str,dex,agi,str,vit,hp,mp,str,dex,vit,agi,str,hp,vit,dex,str,agi,vit,str,luk,dex,hp,str,vit,agi,mp,str,dex,vit,str,hp,agi,dex,vit,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{竜騎士,槍使い}'::text[], 13, 3, '{}'::text[]),
  ('ストームランサー', 'ichiji', 16, '槍使い', 30, '{str,dex,agi,hp,vit,str,dex,mp,agi,str,hp,dex,vit,str,agi,luk,hp,dex,str,agi,vit,dex,str,hp,mp,str,agi,dex,hp,str,vit,dex,agi,str,hp,dex,str,agi,vit,dex,str,luk,hp,agi,mp,str,dex,vit,hp,str,agi,dex,str,agi,dex,hp,vit,str,dex,mp,agi,str,hp,dex,str,vit,agi,hp,str,dex,luk,agi,str,vit,dex,hp,str,agi,dex,mp,str,hp,vit,dex,agi,str,hp,dex,str,agi,vit,str,dex,hp,agi,str,mp,dex,vit,str,agi,hp,dex,luk,str,agi,dex,vit,str,hp,mp,str,dex,agi,hp,str,vit,dex,agi,str,hp,dex,str,agi,vit,dex,hp,str,luk,agi,dex,str,mp,vit,hp,str,dex,agi,str,hp,dex,agi,vit,str,dex,hp,str,agi,mp,dex,vit,str,agi,hp,dex,str,luk,agi,str,dex,vit,hp,str,dex,agi,mp,str,hp,vit,dex,agi,str,hp,dex,str,agi,vit,dex,str,hp,agi,str,dex,mp,vit,hp,str,agi,dex,luk,str,hp,dex,agi,str,vit,dex,str,agi,hp,mp,str,dex,vit,agi,str,hp,dex,str,agi,vit,dex,hp,str,luk,agi,dex,str,hp,vit,mp,dex,str,agi,hp,str,dex,agi,vit,str,dex,hp,str,agi,mp,dex,vit,str,hp,agi,dex,str,luk,vit,hp,str,dex,agi,str,dex,agi,hp,str,vit,dex,mp,agi,str,hp,dex,str,vit,agi,dex,str,hp,agi,str,dex,mp,vit,hp,str,dex,agi,luk,str,hp,dex,agi,vit,str,dex,hp,str,agi,mp,dex,str,vit,hp,agi,str,dex,vit,str,agi,dex,hp,str,luk,dex,agi,str,hp,vit,mp,dex,str,agi,hp,str,dex,vit,agi,str,dex,hp,str,agi,dex,vit,mp,str,hp,agi,dex,str,luk,hp,dex,str,agi,vit,str,dex,hp,agi,str,vit,dex,mp,hp,str,agi,dex,str,vit,agi,hp,dex,str,luk,dex,agi,str,hp,vit,str,dex,mp,agi,str,hp,dex,vit,agi,str,dex,hp,str,agi,dex,vit,str,hp,mp,agi,str,dex,vit,hp,str,dex,agi,str,luk,dex,hp,agi,str,vit,dex,mp,str,agi,hp,dex,str,vit,agi,str,dex,hp,str,agi,dex,vit,hp,str,mp,dex,agi,str,hp,dex,vit,str,agi,luk,dex,str,hp,agi,vit,str,dex,hp,mp,str,agi,dex,str,vit,hp,dex,agi,str,dex,hp,str,agi,vit,luk,dex,str,mp,agi,hp,str,dex,vit,agi,str,hp,dex,str,agi,dex,vit,str,hp,mp,dex,agi,str,hp,vit,str,dex,agi,str,dex,hp,luk,agi,str,vit,dex,hp,str,agi,mp,dex,str,vit,hp,agi,dex,str}'::text[], '{槍,片手剣,投擲}'::text[], 'phys', '{ストームランサー,槍使い}'::text[], 10, 3, '{}'::text[]),
  ('体術師', 'ichiji', 17, '格闘家', 30, '{agi,str,dex,hp,vit,agi,str,mp,agi,dex,str,luk,agi,hp,str,vit,agi,dex,str,agi,hp,dex,agi,str,vit,agi,str,mp,luk,agi,dex,hp,str,agi,vit,str,dex,agi,hp,str,agi,dex,vit,agi,str,hp,agi,str,mp,dex,agi,luk,str,agi,vit,dex,hp,str,agi,str,agi,dex,vit,hp,agi,str,mp,agi,dex,str,luk,agi,hp,str,vit,agi,dex,str,agi,hp,dex,agi,str,vit,agi,str,mp,luk,dex,agi,str,hp,agi,vit,str,dex,agi,hp,str,agi,dex,vit,agi,str,mp,agi,str,hp,dex,agi,luk,str,vit,agi,dex,str,agi,hp,str,agi,dex,vit,agi,str,hp,mp,agi,dex,str,luk,agi,str,vit,hp,agi,dex,str,agi,dex,str,agi,hp,vit,agi,str,mp,dex,agi,luk,str,hp,agi,vit,str,dex,agi,str,agi,hp,dex,str,agi,vit,mp,agi,str,dex,luk,hp,agi,str,vit,agi,dex,str,agi,hp,str,agi,dex,vit,str,agi,hp,mp,agi,str,dex,luk,agi,str,vit,dex,agi,hp,str,agi,dex,str,agi,vit,hp,str,agi,mp,dex,agi,str,luk,hp,agi,vit,str,dex,agi,str,agi,dex,hp,str,agi,vit,mp,str,agi,dex,luk,agi,str,hp,vit,agi,dex,str,agi,hp,str,agi,dex,vit,str,agi,mp,luk,hp,agi,str,dex,agi,str,vit,dex,agi,str,hp,agi,str,dex,agi,vit,hp,str,agi,mp,dex,luk,agi,str,vit,agi,str,hp,dex,agi,str,agi,dex,str,vit,hp,agi,mp,str,agi,dex,luk,agi,str,hp,vit,agi,str,dex,agi,str,hp,agi,dex,vit,str,agi,mp,luk,str,agi,dex,hp,agi,str,vit,dex,agi,str,hp,agi,str,dex,agi,vit,str,mp,agi,hp,dex,str,agi,luk,vit,agi,str,dex,hp,agi,str,agi,dex,str,vit,agi,hp,str,mp,agi,dex,luk,str,agi,vit,hp,agi,str,dex,agi,str,dex,agi,hp,vit,str,agi,mp,luk,str,agi,dex,hp,str,agi,vit,dex,agi,str,hp,agi,str,dex,agi,vit,str,mp,agi,luk,dex,str,hp,agi,vit,agi,str,dex,agi,hp,str,agi,dex,str,vit,agi,hp,str,mp,agi,dex,luk,str,agi,vit,hp,agi,str,dex,agi,str,dex,agi,vit,str,hp,agi,mp,str,dex,agi,luk,str,agi,hp,vit,dex,agi,str,agi,str,hp,dex,vit,agi,str,mp,agi,dex,luk,str,agi,hp,vit,str,agi,dex,agi,str,hp,agi,dex,str,vit,agi,mp,str,hp,agi,dex,luk,str,agi,vit,str,agi,dex,hp,agi,str,dex,agi,vit,str,hp,agi,mp,str,dex,agi,luk,str,agi,vit,hp,dex,str,agi}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{体術師,格闘家}'::text[], 13, 3, '{}'::text[]),
  ('サイキッカー', 'ichiji', 18, '格闘家', 30, '{str,int_stat,agi,hp,dex,str,int_stat,mp,vit,agi,str,int_stat,luk,hp,str,int_stat,agi,dex,str,int_stat,mp,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,luk,hp,str,int_stat,agi,mp,dex,str,int_stat,agi,str,int_stat,hp,vit,str,int_stat,dex,agi,str,int_stat,mp,hp,str,int_stat,agi,luk,str,int_stat,dex,agi,hp,str,int_stat,mp,vit,str,int_stat,agi,dex,str,int_stat,hp,agi,str,int_stat,luk,str,int_stat,mp,agi,dex,hp,str,int_stat,vit,str,int_stat,agi,dex,str,int_stat,hp,agi,str,int_stat,mp,luk,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,mp,hp,str,int_stat,agi,dex,str,int_stat,luk,str,int_stat,agi,hp,dex,str,int_stat,mp,agi,str,int_stat,vit,hp,str,int_stat,agi,dex,str,int_stat,mp,agi,str,int_stat,hp,luk,str,int_stat,dex,agi,vit,str,int_stat,hp,str,int_stat,agi,mp,str,int_stat,dex,agi,hp,str,int_stat,vit,str,int_stat,agi,luk,dex,str,int_stat,mp,hp,agi,str,int_stat,str,int_stat,dex,agi,hp,str,int_stat,mp,vit,str,int_stat,agi,luk,str,int_stat,dex,hp,agi,str,int_stat,mp,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,luk,hp,str,int_stat,agi,dex,str,int_stat,mp,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,mp,hp,str,int_stat,agi,luk,dex,str,int_stat,agi,str,int_stat,hp,vit,str,int_stat,mp,agi,dex,str,int_stat,hp,str,int_stat,agi,luk,str,int_stat,dex,agi,mp,str,int_stat,hp,vit,str,int_stat,agi,dex,str,int_stat,hp,agi,str,int_stat,mp,str,int_stat,dex,agi,luk,hp,str,int_stat,vit,str,int_stat,agi,dex,str,int_stat,hp,mp,agi,str,int_stat,str,int_stat,agi,hp,dex,str,int_stat,luk,vit,agi,str,int_stat,mp,hp,str,int_stat,agi,dex,str,int_stat,mp,str,int_stat,agi,hp,dex,str,int_stat,luk,agi,str,int_stat,vit,hp,str,int_stat,agi,dex,str,int_stat,mp,agi,str,int_stat,hp,vit,str,int_stat,dex,agi,str,int_stat,luk,hp,mp,str,int_stat,agi,str,int_stat,dex,agi,hp,str,int_stat,vit,str,int_stat,agi,mp,dex,str,int_stat,hp,luk,agi,str,int_stat,str,int_stat,dex,agi,hp,str,int_stat,mp,vit,str,int_stat,agi,dex,str,int_stat,hp,agi,str,int_stat,luk,mp,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,hp,str,int_stat,mp,agi,dex,str,int_stat,luk,str,int_stat,agi,hp,dex,str,int_stat,vit,agi,str,int_stat,mp,hp,str,int_stat,agi,dex,str,int_stat,luk,agi,str,int_stat,hp,mp,str,int_stat,dex,agi,vit,str,int_stat,hp,str,int_stat,agi,dex,str,int_stat,mp,agi,hp,str,int_stat,luk,vit,str,int_stat,agi,dex,str,int_stat,hp,agi,str,int_stat,mp,str,int_stat,dex,agi,hp,str,int_stat,luk,vit,str,int_stat,agi,mp,str,int_stat,dex,hp,agi,str,int_stat}'::text[], '{拳,鈍器,杖}'::text[], 'phys', '{サイキッカー,格闘家}'::text[], 13, 5, '{}'::text[]),
  ('暗殺者', 'ichiji', 19, '盗賊', 30, '{agi,str,luk,dex,hp,agi,str,vit,agi,luk,mp,str,dex,agi,hp,agi,str,luk,dex,agi,str,agi,luk,hp,str,dex,agi,vit,luk,agi,str,mp,agi,dex,str,hp,agi,luk,str,agi,dex,luk,str,agi,hp,vit,agi,str,dex,luk,agi,str,mp,agi,hp,dex,luk,agi,str,agi,str,luk,dex,agi,hp,str,vit,agi,luk,dex,str,agi,hp,mp,agi,str,luk,dex,agi,str,agi,luk,hp,str,agi,dex,vit,agi,luk,str,dex,agi,str,hp,luk,agi,mp,str,agi,dex,luk,agi,str,hp,agi,dex,str,luk,agi,vit,str,agi,hp,dex,luk,agi,str,mp,agi,str,dex,luk,agi,hp,str,agi,vit,luk,dex,agi,str,hp,agi,str,luk,dex,agi,mp,str,agi,luk,hp,dex,str,agi,vit,agi,luk,str,dex,agi,hp,str,agi,luk,str,agi,dex,mp,luk,agi,str,hp,agi,dex,str,luk,agi,vit,str,agi,hp,dex,luk,agi,str,mp,agi,dex,str,luk,agi,hp,str,agi,vit,luk,dex,agi,str,hp,agi,luk,str,dex,agi,str,agi,luk,hp,dex,agi,str,mp,vit,agi,luk,str,dex,agi,hp,str,agi,luk,dex,str,agi,luk,agi,str,hp,mp,agi,dex,str,luk,agi,vit,str,agi,dex,hp,luk,agi,str,agi,dex,str,luk,agi,hp,mp,str,agi,dex,luk,vit,agi,str,hp,agi,luk,str,dex,agi,str,agi,luk,hp,dex,agi,str,vit,agi,luk,str,mp,agi,dex,hp,str,agi,luk,dex,agi,str,luk,agi,str,hp,agi,dex,vit,str,luk,agi,mp,str,agi,dex,hp,luk,agi,str,agi,dex,str,luk,agi,hp,vit,str,agi,dex,luk,agi,str,mp,agi,hp,luk,str,dex,agi,str,agi,luk,dex,hp,agi,str,vit,agi,luk,str,dex,agi,hp,str,agi,luk,mp,dex,agi,str,luk,agi,str,hp,agi,dex,vit,str,agi,luk,dex,agi,str,hp,luk,agi,str,mp,agi,dex,luk,str,agi,hp,vit,agi,str,dex,luk,agi,str,hp,agi,luk,dex,str,agi,mp,str,agi,luk,dex,hp,agi,str,vit,agi,luk,str,dex,agi,hp,str,agi,luk,dex,agi,str,mp,agi,luk,hp,str,agi,dex,vit,str,agi,luk,dex,agi,str,hp,luk,agi,str,agi,dex,mp,luk,str,agi,hp,agi,str,dex,luk,agi,vit,str,hp,agi,dex,luk,str,agi,mp,agi,str,luk,dex,agi,hp,str,agi,vit,luk,str,dex,agi,hp,agi,str,luk,dex,agi,str,luk,agi,hp,str,dex,agi,mp,vit,str,agi,luk,agi,dex,str,hp,luk,agi,str,agi,dex,luk,str,agi,hp,mp,agi,str,dex,luk,agi,vit,str,agi,hp,dex,luk,str,agi}'::text[], '{短剣,投擲,刀}'::text[], 'phys', '{暗殺者,盗賊}'::text[], 10, 3, '{}'::text[]),
  ('忍者', 'ichiji', 20, '盗賊', 30, '{agi,dex,str,hp,luk,agi,dex,str,agi,mp,vit,dex,agi,str,hp,luk,agi,dex,str,agi,dex,agi,hp,str,luk,dex,agi,mp,vit,str,agi,dex,agi,hp,dex,str,luk,agi,dex,str,agi,hp,dex,agi,luk,str,agi,dex,mp,vit,agi,str,dex,agi,hp,luk,str,agi,dex,str,agi,dex,hp,luk,agi,dex,str,agi,mp,vit,dex,agi,str,hp,luk,agi,dex,str,agi,dex,agi,str,hp,luk,dex,agi,mp,str,agi,dex,vit,agi,hp,str,dex,luk,agi,str,dex,agi,hp,luk,agi,dex,str,agi,mp,dex,vit,str,agi,dex,hp,agi,luk,str,agi,dex,str,agi,dex,hp,luk,agi,str,dex,agi,mp,vit,str,agi,dex,hp,luk,agi,dex,str,agi,dex,hp,agi,str,luk,dex,agi,mp,str,agi,vit,dex,agi,str,hp,luk,dex,agi,str,dex,agi,hp,luk,agi,str,dex,agi,mp,vit,dex,str,agi,hp,dex,agi,luk,str,agi,dex,str,agi,hp,dex,luk,agi,str,mp,dex,agi,vit,str,agi,dex,hp,luk,agi,str,dex,agi,dex,str,agi,hp,luk,agi,dex,str,mp,agi,vit,dex,hp,agi,str,luk,dex,agi,str,agi,dex,hp,luk,agi,str,dex,agi,mp,vit,str,dex,agi,hp,luk,agi,dex,str,agi,dex,str,agi,hp,luk,dex,agi,str,mp,dex,agi,vit,str,agi,dex,hp,luk,agi,str,dex,agi,str,dex,agi,hp,luk,agi,dex,str,mp,vit,agi,dex,str,agi,hp,luk,dex,agi,str,agi,dex,hp,luk,str,agi,dex,mp,agi,vit,str,dex,agi,hp,luk,agi,str,dex,agi,dex,str,agi,hp,luk,dex,agi,str,mp,vit,agi,dex,str,agi,hp,dex,luk,agi,str,dex,agi,str,hp,agi,dex,luk,mp,agi,str,dex,vit,agi,dex,str,agi,hp,luk,agi,dex,str,agi,dex,hp,luk,str,agi,dex,mp,agi,str,vit,agi,dex,hp,luk,str,agi,dex,agi,str,dex,agi,hp,luk,str,dex,agi,mp,vit,agi,dex,str,agi,hp,luk,dex,agi,str,dex,agi,str,hp,agi,luk,dex,mp,agi,str,dex,vit,agi,str,dex,agi,hp,luk,agi,str,dex,agi,hp,dex,str,luk,agi,mp,dex,agi,str,vit,agi,dex,hp,luk,str,agi,dex,agi,str,dex,agi,hp,luk,str,agi,dex,mp,vit,agi,str,dex,agi,hp,luk,dex,str,agi,dex,agi,str,hp,luk,agi,dex,str,agi,mp,vit,dex,agi,str,hp,agi,dex,luk,str,agi,dex,agi,hp,str,dex,luk,agi,mp,vit,dex,agi,str,agi,dex,hp,str,luk,agi,dex,agi,str,dex,agi,hp,luk,str,agi,dex,mp,vit,agi,str,dex,agi,hp,luk,str,dex,agi}'::text[], '{短剣,投擲,刀}'::text[], 'phys', '{忍者,盗賊}'::text[], 10, 3, '{}'::text[]),
  ('狩人', 'ichiji', 21, '弓使い', 30, '{dex,agi,str,luk,hp,dex,agi,str,vit,mp,dex,agi,luk,str,dex,hp,agi,dex,str,agi,luk,dex,vit,str,agi,hp,dex,mp,agi,dex,str,luk,dex,agi,hp,str,dex,agi,luk,str,vit,dex,agi,hp,mp,dex,str,agi,luk,dex,str,agi,dex,hp,vit,agi,str,dex,luk,agi,dex,str,mp,hp,agi,dex,luk,str,dex,agi,vit,str,dex,agi,hp,luk,dex,str,agi,mp,dex,agi,str,luk,dex,hp,agi,str,dex,vit,agi,luk,dex,str,hp,agi,dex,mp,str,dex,agi,luk,hp,dex,str,agi,vit,dex,agi,str,luk,dex,hp,agi,str,dex,mp,agi,luk,dex,str,vit,agi,hp,dex,str,luk,agi,dex,str,dex,agi,hp,mp,dex,luk,agi,str,vit,dex,agi,str,hp,dex,luk,agi,str,dex,agi,hp,dex,str,luk,agi,mp,dex,vit,str,agi,dex,hp,luk,str,dex,agi,dex,agi,str,vit,luk,dex,agi,hp,str,mp,dex,agi,str,dex,luk,agi,hp,dex,str,agi,dex,vit,luk,str,agi,dex,hp,mp,agi,dex,str,luk,dex,agi,str,hp,dex,agi,vit,str,dex,luk,agi,mp,dex,str,hp,agi,dex,luk,str,agi,dex,vit,hp,agi,str,dex,luk,agi,dex,str,mp,dex,agi,hp,str,luk,dex,agi,vit,str,dex,agi,hp,luk,dex,str,agi,mp,dex,agi,str,dex,luk,hp,agi,dex,str,vit,agi,dex,luk,str,hp,agi,dex,mp,str,dex,agi,luk,vit,dex,str,agi,hp,dex,agi,str,luk,dex,agi,hp,str,dex,mp,agi,luk,dex,str,vit,agi,dex,hp,str,agi,dex,luk,str,dex,agi,mp,hp,dex,agi,str,luk,vit,dex,agi,str,dex,hp,agi,luk,dex,str,agi,mp,dex,str,vit,agi,hp,dex,luk,str,agi,dex,hp,dex,agi,str,luk,dex,agi,str,vit,mp,dex,agi,luk,str,dex,hp,agi,dex,str,agi,luk,dex,hp,str,agi,dex,vit,mp,agi,str,dex,luk,hp,agi,dex,str,luk,dex,agi,str,vit,dex,agi,hp,str,dex,luk,agi,mp,dex,str,agi,hp,dex,luk,str,agi,dex,vit,agi,str,dex,hp,luk,agi,dex,mp,str,dex,agi,hp,str,dex,luk,agi,vit,dex,str,agi,hp,dex,luk,str,agi,mp,dex,agi,str,dex,luk,vit,agi,hp,dex,str,agi,dex,str,luk,mp,dex,agi,hp,str,dex,agi,vit,luk,dex,str,agi,hp,dex,agi,str,dex,luk,agi,mp,str,dex,hp,agi,dex,vit,str,luk,agi,dex,hp,str,agi,dex,luk,str,dex,agi,mp,vit,dex,agi,str,hp,dex,luk,agi,str,dex,agi,hp,dex,str,luk,agi,mp,dex,vit,str,agi,dex,hp,luk,str,agi,dex}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{狩人,弓使い}'::text[], 10, 3, '{}'::text[]),
  ('アークアーチャー', 'ichiji', 22, '弓使い', 30, '{dex,luk,agi,hp,str,dex,luk,agi,dex,mp,vit,luk,dex,agi,hp,str,dex,luk,agi,dex,luk,hp,dex,str,agi,dex,luk,mp,agi,dex,luk,hp,dex,str,vit,agi,luk,dex,hp,dex,agi,luk,str,dex,luk,agi,dex,hp,mp,luk,dex,agi,str,dex,vit,luk,agi,dex,hp,luk,dex,agi,str,dex,luk,hp,agi,dex,luk,str,dex,agi,mp,luk,dex,vit,hp,agi,dex,luk,str,dex,agi,luk,dex,hp,agi,dex,luk,str,dex,luk,agi,hp,dex,mp,vit,luk,dex,agi,str,dex,luk,hp,agi,dex,luk,str,dex,agi,hp,luk,dex,agi,mp,dex,luk,vit,str,dex,agi,hp,luk,dex,agi,dex,luk,str,hp,dex,agi,luk,dex,mp,luk,agi,dex,str,hp,dex,luk,vit,agi,dex,luk,str,dex,agi,hp,luk,dex,agi,dex,luk,str,hp,dex,agi,mp,luk,dex,vit,agi,dex,luk,hp,str,dex,agi,luk,dex,hp,agi,luk,dex,str,mp,dex,luk,agi,vit,dex,hp,luk,agi,dex,str,luk,dex,agi,hp,dex,luk,str,agi,dex,luk,dex,agi,hp,mp,dex,luk,str,vit,dex,agi,luk,dex,hp,agi,luk,dex,str,agi,dex,luk,hp,dex,str,agi,luk,dex,mp,vit,luk,dex,agi,hp,dex,luk,str,agi,dex,luk,hp,dex,agi,str,dex,luk,agi,dex,mp,hp,luk,vit,dex,agi,luk,dex,str,agi,dex,hp,luk,dex,agi,str,luk,dex,hp,agi,dex,luk,mp,vit,dex,str,luk,agi,dex,hp,luk,dex,agi,str,dex,luk,agi,hp,dex,luk,mp,dex,agi,vit,str,dex,luk,hp,agi,dex,luk,dex,agi,str,luk,dex,hp,agi,dex,luk,mp,dex,str,agi,luk,hp,dex,vit,luk,agi,dex,str,dex,luk,agi,hp,dex,luk,agi,dex,str,hp,luk,dex,agi,mp,dex,luk,vit,agi,dex,hp,str,luk,dex,agi,dex,luk,hp,str,dex,agi,luk,dex,agi,mp,luk,dex,vit,hp,dex,str,agi,luk,dex,luk,agi,dex,hp,str,luk,dex,agi,dex,luk,hp,agi,dex,str,mp,luk,dex,vit,agi,dex,luk,hp,agi,dex,str,luk,dex,agi,hp,luk,dex,str,agi,dex,luk,mp,vit,dex,hp,agi,luk,dex,str,luk,dex,agi,hp,dex,luk,agi,dex,str,luk,dex,agi,hp,mp,dex,luk,vit,agi,dex,str,luk,dex,agi,hp,luk,dex,str,agi,dex,luk,hp,dex,agi,luk,mp,dex,vit,str,agi,dex,luk,hp,dex,agi,luk,dex,str,hp,luk,dex,agi,dex,luk,agi,mp,str,dex,vit,luk,hp,dex,agi,luk,dex,agi,str,dex,hp,luk,dex,agi,luk,dex,str,hp,agi,dex,luk,mp,vit,dex,agi,luk,dex,str,hp,agi,luk,dex}'::text[], '{弓,短剣,片手剣}'::text[], 'phys', '{アークアーチャー,弓使い}'::text[], 10, 3, '{}'::text[]),
  ('魔銃士', 'ichiji', 23, '銃士', 30, '{str,int_stat,dex,agi,hp,mp,str,int_stat,luk,dex,str,int_stat,agi,vit,hp,str,int_stat,dex,mp,str,int_stat,agi,luk,dex,str,int_stat,hp,mp,dex,str,int_stat,agi,str,int_stat,dex,luk,hp,agi,str,int_stat,mp,vit,dex,str,int_stat,agi,hp,str,int_stat,dex,mp,luk,str,int_stat,agi,dex,str,int_stat,hp,mp,str,int_stat,dex,agi,luk,str,int_stat,dex,hp,mp,str,int_stat,agi,vit,str,int_stat,dex,hp,str,int_stat,agi,dex,mp,luk,str,int_stat,dex,agi,str,int_stat,hp,mp,str,int_stat,dex,luk,agi,str,int_stat,vit,hp,dex,str,int_stat,mp,agi,str,int_stat,dex,luk,str,int_stat,hp,agi,dex,mp,str,int_stat,str,int_stat,dex,hp,agi,mp,str,int_stat,luk,dex,vit,str,int_stat,agi,hp,str,int_stat,dex,mp,str,int_stat,agi,dex,luk,str,int_stat,hp,mp,dex,str,int_stat,agi,str,int_stat,dex,hp,luk,agi,str,int_stat,mp,vit,dex,str,int_stat,agi,hp,str,int_stat,dex,mp,str,int_stat,luk,dex,agi,str,int_stat,hp,mp,str,int_stat,dex,agi,vit,str,int_stat,luk,dex,hp,str,int_stat,agi,mp,dex,str,int_stat,hp,str,int_stat,agi,dex,luk,mp,str,int_stat,dex,str,int_stat,agi,hp,mp,str,int_stat,dex,vit,luk,str,int_stat,agi,hp,dex,str,int_stat,mp,agi,str,int_stat,dex,hp,str,int_stat,luk,dex,agi,str,int_stat,mp,dex,str,int_stat,hp,agi,vit,str,int_stat,mp,dex,luk,str,int_stat,agi,hp,dex,str,int_stat,mp,str,int_stat,agi,dex,luk,str,int_stat,hp,dex,str,int_stat,agi,mp,vit,str,int_stat,dex,hp,luk,str,int_stat,agi,dex,mp,str,int_stat,hp,agi,str,int_stat,dex,mp,str,int_stat,luk,dex,agi,str,int_stat,hp,dex,str,int_stat,mp,agi,vit,str,int_stat,hp,dex,luk,str,int_stat,agi,mp,dex,str,int_stat,hp,str,int_stat,agi,dex,luk,str,int_stat,mp,dex,hp,str,int_stat,agi,vit,str,int_stat,dex,mp,luk,str,int_stat,agi,hp,dex,str,int_stat,agi,mp,str,int_stat,dex,hp,str,int_stat,luk,dex,agi,str,int_stat,mp,dex,str,int_stat,hp,agi,vit,str,int_stat,dex,luk,mp,str,int_stat,agi,hp,dex,str,int_stat,mp,str,int_stat,dex,agi,hp,str,int_stat,luk,dex,str,int_stat,agi,mp,vit,str,int_stat,dex,hp,str,int_stat,agi,luk,dex,str,int_stat,mp,hp,agi,str,int_stat,dex,luk,str,int_stat,mp,dex,agi,str,int_stat,hp,dex,str,int_stat,vit,agi,mp,str,int_stat,hp,dex,luk,str,int_stat,agi,dex,str,int_stat,mp,hp,str,int_stat,dex,agi,luk,str,int_stat,mp,dex,hp,str,int_stat,agi,vit,str,int_stat,dex,mp,str,int_stat,agi,hp,dex,luk,str,int_stat,agi,dex,str,int_stat,mp,hp,str,int_stat,dex,luk,agi,str,int_stat,vit,mp,dex,str,int_stat,hp,agi,str,int_stat,dex,luk,str,int_stat,mp,hp,agi,dex,str,int_stat}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{魔銃士,銃士}'::text[], 13, 5, '{}'::text[]),
  ('デストロイヤー', 'ichiji', 24, '銃士', 30, '{dex,str,vit,hp,agi,dex,str,mp,dex,vit,luk,str,dex,hp,agi,dex,str,vit,dex,str,hp,mp,dex,vit,agi,str,dex,luk,vit,dex,str,hp,dex,str,agi,vit,dex,mp,str,hp,dex,vit,str,dex,agi,hp,dex,str,vit,luk,dex,mp,str,dex,agi,vit,hp,dex,str,dex,str,vit,agi,dex,hp,str,mp,dex,vit,luk,str,dex,hp,agi,dex,str,vit,dex,str,mp,dex,vit,hp,agi,str,dex,luk,dex,vit,str,hp,dex,str,agi,vit,dex,mp,str,dex,hp,vit,dex,str,agi,dex,luk,str,hp,vit,dex,mp,str,dex,agi,vit,dex,str,hp,dex,str,vit,agi,dex,hp,str,dex,mp,vit,luk,dex,str,agi,dex,hp,str,vit,dex,str,mp,dex,vit,hp,agi,str,dex,luk,dex,vit,str,dex,hp,agi,str,dex,vit,mp,str,dex,hp,vit,dex,str,agi,dex,luk,str,vit,dex,hp,str,dex,mp,agi,vit,dex,str,hp,dex,str,vit,agi,dex,luk,str,dex,hp,vit,mp,dex,str,agi,dex,vit,str,hp,dex,str,dex,vit,mp,agi,dex,str,hp,luk,dex,vit,str,dex,hp,agi,str,dex,vit,mp,str,dex,vit,hp,dex,str,agi,dex,luk,str,vit,dex,hp,str,dex,agi,mp,vit,dex,str,hp,dex,str,vit,dex,agi,luk,str,dex,hp,vit,mp,dex,str,agi,dex,vit,str,dex,hp,str,dex,vit,mp,agi,dex,str,hp,dex,vit,str,luk,dex,agi,str,dex,hp,vit,mp,dex,str,vit,dex,str,hp,agi,dex,luk,str,vit,dex,hp,str,dex,agi,mp,vit,dex,str,dex,hp,str,vit,dex,agi,luk,str,dex,vit,mp,dex,hp,str,dex,agi,vit,str,dex,hp,str,dex,vit,agi,mp,dex,str,hp,dex,vit,str,luk,dex,agi,str,dex,vit,hp,dex,str,mp,vit,dex,str,agi,hp,dex,luk,str,dex,vit,agi,dex,str,hp,mp,vit,dex,str,dex,vit,str,hp,dex,agi,luk,dex,str,vit,mp,dex,str,hp,dex,agi,vit,str,dex,hp,str,dex,vit,agi,dex,str,mp,luk,dex,vit,hp,str,dex,agi,str,dex,vit,hp,dex,str,mp,dex,vit,agi,str,dex,hp,luk,str,dex,vit,dex,str,agi,mp,vit,dex,hp,str,dex,vit,str,dex,agi,hp,dex,str,luk,vit,dex,mp,str,hp,dex,agi,vit,str,dex,hp,dex,str,vit,agi,dex,str,mp,dex,vit,luk,str,dex,hp,agi,dex,str,vit,dex,hp,str,mp,dex,vit,agi,str,dex,luk,hp,str,dex,vit,dex,str,agi,vit,dex,mp,hp,str,dex,vit,str,dex,agi,hp,dex,str,luk,vit,dex,mp,str,dex,agi,hp,vit,str,dex}'::text[], '{銃,片手剣,投擲}'::text[], 'phys', '{デストロイヤー,銃士}'::text[], 13, 5, '{}'::text[]),
  ('元素使い', 'ichiji', 25, '魔法使い', 30, '{int_stat,mp,hp,agi,int_stat,dex,mp,int_stat,vit,hp,int_stat,agi,mp,int_stat,luk,hp,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,vit,agi,int_stat,mp,hp,int_stat,dex,mp,int_stat,agi,hp,int_stat,mp,vit,int_stat,agi,mp,int_stat,hp,dex,int_stat,mp,luk,agi,int_stat,hp,mp,int_stat,vit,int_stat,agi,mp,hp,dex,int_stat,mp,int_stat,hp,agi,int_stat,mp,dex,int_stat,vit,hp,mp,int_stat,agi,int_stat,luk,mp,hp,int_stat,agi,int_stat,mp,dex,hp,int_stat,mp,agi,int_stat,vit,hp,int_stat,mp,agi,int_stat,dex,mp,int_stat,hp,vit,int_stat,mp,agi,int_stat,hp,mp,int_stat,dex,agi,int_stat,hp,mp,luk,int_stat,mp,agi,int_stat,hp,vit,int_stat,dex,mp,int_stat,agi,hp,int_stat,mp,int_stat,hp,mp,agi,int_stat,dex,vit,int_stat,mp,hp,int_stat,agi,mp,luk,int_stat,hp,dex,int_stat,mp,agi,int_stat,vit,mp,int_stat,hp,agi,int_stat,mp,dex,int_stat,hp,mp,int_stat,agi,vit,int_stat,hp,mp,int_stat,agi,dex,mp,int_stat,hp,luk,int_stat,mp,agi,int_stat,hp,mp,int_stat,vit,dex,int_stat,agi,hp,mp,int_stat,int_stat,mp,hp,agi,int_stat,dex,mp,int_stat,vit,hp,int_stat,agi,mp,int_stat,luk,hp,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,vit,agi,mp,int_stat,hp,int_stat,mp,dex,int_stat,agi,mp,int_stat,hp,vit,int_stat,agi,mp,int_stat,hp,dex,int_stat,mp,luk,agi,int_stat,hp,mp,int_stat,vit,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,hp,agi,int_stat,mp,dex,int_stat,hp,mp,agi,int_stat,vit,int_stat,mp,hp,int_stat,agi,luk,mp,int_stat,dex,hp,int_stat,mp,agi,int_stat,vit,hp,int_stat,mp,agi,int_stat,dex,mp,int_stat,hp,mp,int_stat,agi,vit,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,hp,luk,int_stat,mp,agi,int_stat,hp,vit,int_stat,mp,dex,int_stat,agi,hp,mp,int_stat,int_stat,mp,hp,agi,int_stat,dex,vit,mp,int_stat,hp,int_stat,agi,mp,int_stat,luk,hp,int_stat,mp,dex,agi,int_stat,mp,vit,int_stat,hp,agi,int_stat,mp,hp,int_stat,dex,mp,int_stat,agi,hp,int_stat,mp,vit,int_stat,agi,mp,int_stat,hp,dex,int_stat,luk,mp,agi,int_stat,hp,mp,int_stat,vit,dex,int_stat,agi,mp,hp,int_stat,mp,int_stat,hp,agi,int_stat,mp,dex,int_stat,vit,hp,int_stat,mp,agi,int_stat,luk,mp,hp,int_stat,agi,dex,int_stat,mp,hp,int_stat,vit,mp,agi,int_stat,hp,int_stat,mp,dex,int_stat,agi,mp,int_stat,hp,vit,int_stat,mp,agi,int_stat,hp,dex,mp,int_stat,luk,agi,int_stat,hp,mp,int_stat,vit,mp,int_stat,agi,hp,int_stat,dex,mp,int_stat,agi,hp,int_stat,mp,int_stat,dex,hp,mp,agi,int_stat,vit,int_stat,mp,hp,int_stat,agi,luk,mp,int_stat,dex,hp,int_stat,mp,agi,int_stat,vit,mp,int_stat,hp,agi,int_stat,mp,dex,int_stat,hp,mp,int_stat,agi,vit,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,hp,luk,int_stat,mp,agi,int_stat,hp,vit,int_stat,mp,dex,int_stat,agi,hp,mp,int_stat}'::text[], '{杖,書,宝珠}'::text[], 'mag', '{元素使い,魔法使い}'::text[], 10, 6, '{}'::text[]),
  ('クロノマンサー', 'ichiji', 26, '魔法使い', 30, '{int_stat,agi,mp,hp,int_stat,agi,dex,vit,int_stat,mp,agi,int_stat,luk,agi,mp,hp,int_stat,agi,dex,int_stat,mp,agi,int_stat,vit,hp,agi,int_stat,mp,dex,agi,int_stat,mp,int_stat,agi,hp,int_stat,agi,vit,mp,int_stat,dex,agi,luk,int_stat,mp,agi,hp,int_stat,agi,mp,int_stat,dex,agi,int_stat,hp,vit,mp,agi,int_stat,agi,int_stat,mp,hp,dex,int_stat,agi,vit,int_stat,mp,agi,luk,int_stat,agi,hp,mp,int_stat,agi,dex,int_stat,mp,agi,int_stat,hp,vit,agi,int_stat,mp,dex,agi,int_stat,mp,int_stat,agi,hp,int_stat,agi,mp,dex,int_stat,vit,agi,luk,int_stat,mp,agi,hp,int_stat,agi,mp,int_stat,dex,agi,hp,int_stat,vit,mp,agi,int_stat,agi,int_stat,mp,dex,hp,int_stat,agi,luk,int_stat,mp,agi,vit,int_stat,agi,hp,mp,int_stat,agi,dex,int_stat,mp,agi,int_stat,hp,agi,int_stat,mp,vit,dex,agi,int_stat,mp,agi,int_stat,hp,luk,int_stat,agi,mp,dex,int_stat,agi,vit,int_stat,hp,agi,mp,int_stat,agi,mp,int_stat,dex,agi,hp,int_stat,mp,agi,int_stat,vit,agi,int_stat,mp,dex,hp,agi,int_stat,luk,int_stat,agi,mp,int_stat,agi,hp,vit,mp,int_stat,agi,dex,int_stat,mp,agi,int_stat,hp,agi,int_stat,mp,dex,agi,int_stat,vit,mp,agi,int_stat,hp,luk,agi,int_stat,mp,dex,int_stat,agi,hp,int_stat,agi,mp,vit,int_stat,agi,dex,mp,int_stat,agi,hp,int_stat,mp,agi,int_stat,vit,agi,int_stat,dex,mp,hp,agi,int_stat,luk,mp,int_stat,agi,int_stat,agi,hp,mp,dex,int_stat,agi,vit,int_stat,agi,mp,int_stat,hp,agi,dex,int_stat,mp,agi,int_stat,vit,mp,agi,int_stat,hp,luk,agi,int_stat,mp,dex,int_stat,agi,hp,int_stat,agi,mp,vit,int_stat,agi,dex,mp,int_stat,agi,hp,int_stat,agi,mp,int_stat,dex,agi,int_stat,mp,vit,hp,agi,int_stat,luk,agi,int_stat,mp,int_stat,agi,hp,dex,mp,int_stat,agi,vit,int_stat,agi,mp,int_stat,hp,agi,dex,int_stat,mp,agi,int_stat,luk,agi,mp,int_stat,hp,vit,agi,int_stat,dex,mp,agi,int_stat,hp,int_stat,agi,mp,int_stat,agi,dex,vit,mp,int_stat,agi,hp,int_stat,agi,mp,int_stat,dex,agi,int_stat,mp,hp,agi,int_stat,vit,luk,agi,int_stat,mp,dex,agi,int_stat,hp,mp,int_stat,agi,vit,int_stat,agi,mp,int_stat,hp,agi,dex,int_stat,mp,agi,int_stat,luk,agi,mp,int_stat,hp,agi,vit,int_stat,dex,mp,agi,int_stat,hp,agi,int_stat,mp,int_stat,agi,dex,mp,int_stat,agi,vit,hp,int_stat,agi,mp,int_stat,dex,agi,int_stat,mp,hp,agi,int_stat,luk,vit,agi,int_stat,mp,dex,agi,int_stat,hp,mp,int_stat,agi,int_stat,agi,mp,vit,hp,int_stat,agi,dex,int_stat,mp,agi,int_stat,luk,agi,mp,int_stat,hp,agi,dex,int_stat,mp,vit,agi,int_stat,hp,agi,int_stat,mp,dex,int_stat,agi,mp,int_stat,agi,hp,vit,int_stat,agi,mp,int_stat,dex,agi,luk,int_stat,mp,agi,hp,int_stat,agi,mp,int_stat,vit,dex,agi,int_stat,hp,mp,agi,int_stat}'::text[], '{杖,書,宝珠}'::text[], 'mag', '{クロノマンサー,魔法使い}'::text[], 10, 6, '{}'::text[]),
  ('死霊使い', 'ichiji', 27, '呪術師', 30, '{int_stat,mp,hp,vit,int_stat,dex,mp,agi,int_stat,luk,hp,mp,int_stat,vit,int_stat,mp,dex,hp,int_stat,vit,mp,agi,int_stat,mp,int_stat,hp,vit,luk,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,mp,int_stat,hp,vit,dex,int_stat,mp,int_stat,luk,hp,mp,vit,int_stat,agi,int_stat,mp,dex,hp,int_stat,vit,mp,int_stat,agi,mp,hp,int_stat,vit,dex,int_stat,mp,luk,int_stat,hp,vit,mp,int_stat,dex,mp,int_stat,hp,vit,agi,int_stat,mp,int_stat,hp,mp,vit,int_stat,dex,luk,mp,int_stat,agi,hp,vit,int_stat,mp,int_stat,mp,hp,vit,int_stat,dex,mp,int_stat,agi,hp,int_stat,vit,mp,luk,int_stat,dex,mp,int_stat,hp,vit,mp,int_stat,agi,int_stat,mp,hp,vit,int_stat,dex,mp,int_stat,luk,hp,vit,int_stat,mp,agi,int_stat,mp,dex,hp,int_stat,vit,mp,int_stat,hp,vit,int_stat,mp,dex,int_stat,agi,mp,luk,int_stat,hp,vit,mp,int_stat,dex,int_stat,mp,hp,vit,int_stat,agi,mp,int_stat,hp,vit,mp,int_stat,luk,dex,int_stat,mp,hp,vit,int_stat,mp,agi,int_stat,hp,vit,mp,int_stat,dex,int_stat,mp,luk,hp,int_stat,vit,mp,int_stat,agi,dex,mp,int_stat,hp,vit,int_stat,mp,int_stat,hp,vit,mp,agi,int_stat,dex,luk,int_stat,mp,hp,vit,int_stat,mp,int_stat,dex,hp,mp,vit,int_stat,agi,int_stat,mp,hp,vit,int_stat,mp,luk,int_stat,dex,mp,int_stat,hp,vit,agi,int_stat,mp,int_stat,hp,vit,mp,dex,int_stat,luk,mp,int_stat,hp,vit,agi,int_stat,mp,int_stat,dex,mp,hp,vit,int_stat,mp,int_stat,agi,hp,vit,int_stat,mp,dex,int_stat,luk,mp,int_stat,hp,vit,mp,int_stat,agi,dex,int_stat,mp,hp,vit,int_stat,mp,int_stat,hp,vit,luk,int_stat,mp,dex,int_stat,agi,mp,hp,vit,int_stat,mp,int_stat,hp,vit,int_stat,mp,dex,agi,int_stat,mp,luk,int_stat,hp,vit,mp,int_stat,dex,hp,int_stat,mp,vit,int_stat,agi,mp,int_stat,hp,vit,mp,int_stat,dex,luk,int_stat,mp,hp,vit,int_stat,mp,agi,int_stat,dex,hp,vit,mp,int_stat,int_stat,mp,hp,vit,int_stat,luk,mp,agi,int_stat,dex,mp,int_stat,hp,vit,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,agi,luk,mp,int_stat,hp,vit,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,int_stat,mp,hp,vit,int_stat,mp,dex,int_stat,luk,mp,hp,int_stat,vit,agi,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,mp,int_stat,hp,vit,int_stat,mp,luk,dex,int_stat,hp,mp,vit,int_stat,mp,int_stat,agi,hp,vit,int_stat,mp,dex,int_stat,luk,mp,hp,int_stat,vit,mp,int_stat,dex,agi,int_stat,hp,vit,mp,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,luk,agi,int_stat,mp,hp,vit,int_stat,mp,int_stat,dex,hp,vit,int_stat,mp,agi,int_stat,mp,hp,vit,int_stat,luk,mp,int_stat,dex,hp,vit,int_stat,mp,int_stat,agi,mp,hp,int_stat,vit,dex,mp,int_stat,luk,int_stat,mp,hp,vit,int_stat,agi,mp,dex,int_stat,hp,vit,mp,int_stat}'::text[], '{杖,短剣,宝珠}'::text[], 'mag', '{死霊使い,呪術師}'::text[], 13, 6, '{}'::text[]),
  ('式神使い', 'ichiji', 28, '呪術師', 30, '{int_stat,mp,dex,agi,hp,int_stat,mp,vit,int_stat,dex,luk,mp,int_stat,agi,dex,int_stat,hp,mp,int_stat,agi,dex,mp,int_stat,hp,vit,int_stat,mp,dex,agi,int_stat,luk,mp,dex,int_stat,hp,mp,int_stat,agi,dex,int_stat,mp,vit,int_stat,hp,dex,mp,agi,int_stat,luk,mp,int_stat,dex,hp,int_stat,agi,mp,dex,int_stat,mp,vit,int_stat,dex,agi,int_stat,mp,hp,luk,int_stat,dex,mp,int_stat,agi,hp,mp,int_stat,dex,vit,int_stat,mp,agi,dex,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,luk,dex,int_stat,mp,hp,int_stat,agi,vit,mp,dex,int_stat,hp,int_stat,mp,dex,agi,int_stat,mp,luk,int_stat,dex,agi,mp,int_stat,hp,vit,dex,int_stat,mp,int_stat,agi,dex,mp,int_stat,hp,luk,int_stat,mp,dex,agi,int_stat,mp,vit,hp,int_stat,dex,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,dex,mp,agi,int_stat,luk,vit,mp,int_stat,dex,hp,int_stat,agi,mp,dex,int_stat,mp,int_stat,hp,agi,dex,int_stat,mp,vit,luk,int_stat,dex,mp,agi,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,dex,hp,int_stat,mp,vit,int_stat,dex,luk,agi,int_stat,mp,hp,int_stat,dex,mp,int_stat,agi,mp,dex,int_stat,vit,hp,int_stat,mp,agi,dex,int_stat,luk,mp,int_stat,dex,hp,mp,int_stat,agi,dex,int_stat,mp,vit,int_stat,agi,hp,mp,dex,int_stat,luk,mp,int_stat,dex,agi,int_stat,hp,mp,int_stat,dex,vit,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,luk,mp,dex,agi,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,vit,dex,int_stat,mp,hp,int_stat,agi,dex,int_stat,mp,luk,int_stat,dex,mp,hp,agi,int_stat,vit,mp,int_stat,dex,agi,int_stat,mp,hp,dex,int_stat,mp,luk,int_stat,dex,agi,mp,int_stat,hp,vit,int_stat,dex,mp,agi,int_stat,mp,dex,int_stat,hp,luk,int_stat,mp,agi,dex,int_stat,vit,mp,int_stat,hp,dex,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,agi,mp,dex,int_stat,luk,vit,mp,int_stat,dex,agi,hp,int_stat,mp,int_stat,dex,mp,agi,int_stat,hp,dex,int_stat,mp,vit,luk,int_stat,agi,mp,dex,int_stat,hp,mp,int_stat,dex,agi,int_stat,mp,vit,dex,int_stat,hp,mp,int_stat,agi,luk,dex,int_stat,mp,hp,int_stat,mp,dex,agi,int_stat,mp,int_stat,dex,vit,hp,int_stat,mp,agi,dex,int_stat,luk,mp,int_stat,agi,dex,hp,mp,int_stat,vit,int_stat,mp,dex,agi,int_stat,hp,mp,int_stat,dex,luk,mp,int_stat,agi,dex,int_stat,mp,hp,int_stat,dex,agi,mp,int_stat,vit,hp,int_stat,mp,dex,agi,int_stat,mp,luk,dex,int_stat,hp,mp,int_stat,agi,dex,int_stat,vit,mp,int_stat,dex,mp,agi,int_stat,hp,luk,dex,int_stat,mp,int_stat,agi,mp,dex,hp,int_stat,vit,mp,int_stat,dex,agi,int_stat,mp,hp,int_stat,dex,mp,luk,int_stat,agi,vit,dex,int_stat,mp,hp,int_stat,mp,dex,agi,int_stat,mp,hp,int_stat,dex,agi,int_stat,mp,luk,vit,int_stat,dex,mp,int_stat,hp,agi,dex,mp,int_stat}'::text[], '{杖,短剣,宝珠}'::text[], 'mag', '{式神使い,呪術師}'::text[], 10, 6, '{}'::text[]),
  ('聖職者', 'ichiji', 29, '僧侶', 30, '{int_stat,hp,vit,mp,agi,int_stat,hp,vit,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,luk,hp,vit,int_stat,agi,hp,mp,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,vit,hp,mp,agi,int_stat,vit,hp,int_stat,dex,mp,vit,hp,int_stat,luk,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,hp,int_stat,vit,hp,int_stat,vit,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,hp,luk,vit,int_stat,hp,mp,agi,vit,int_stat,hp,mp,int_stat,vit,hp,int_stat,vit,hp,mp,int_stat,agi,vit,hp,int_stat,dex,mp,vit,hp,int_stat,vit,hp,int_stat,mp,agi,hp,vit,int_stat,luk,mp,hp,int_stat,vit,hp,int_stat,vit,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,dex,int_stat,hp,vit,mp,int_stat,hp,vit,int_stat,hp,mp,agi,vit,int_stat,hp,luk,mp,int_stat,vit,hp,int_stat,vit,hp,mp,int_stat,agi,vit,hp,int_stat,dex,mp,vit,hp,int_stat,hp,vit,int_stat,mp,agi,hp,vit,int_stat,mp,hp,int_stat,vit,luk,hp,int_stat,vit,mp,hp,int_stat,vit,agi,mp,int_stat,hp,vit,dex,int_stat,hp,mp,vit,int_stat,hp,vit,int_stat,hp,mp,agi,int_stat,vit,hp,mp,int_stat,vit,hp,luk,int_stat,vit,hp,mp,int_stat,agi,vit,hp,int_stat,dex,mp,hp,vit,int_stat,hp,vit,int_stat,mp,hp,vit,int_stat,agi,mp,hp,int_stat,vit,hp,int_stat,vit,mp,luk,hp,int_stat,vit,dex,hp,int_stat,mp,agi,vit,int_stat,hp,mp,vit,int_stat,hp,vit,int_stat,hp,mp,agi,int_stat,vit,hp,mp,int_stat,vit,hp,int_stat,dex,vit,hp,mp,int_stat,agi,hp,vit,int_stat,mp,hp,vit,int_stat,luk,hp,vit,int_stat,mp,hp,vit,int_stat,agi,mp,hp,int_stat,vit,hp,int_stat,vit,mp,hp,int_stat,dex,vit,agi,hp,int_stat,mp,vit,int_stat,hp,luk,mp,vit,int_stat,hp,vit,int_stat,hp,mp,agi,int_stat,vit,hp,mp,int_stat,vit,hp,int_stat,dex,hp,vit,mp,int_stat,hp,vit,agi,int_stat,mp,hp,vit,int_stat,luk,hp,vit,int_stat,mp,hp,int_stat,vit,agi,hp,mp,int_stat,vit,hp,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,int_stat,hp,luk,vit,int_stat,hp,mp,agi,int_stat,vit,hp,mp,int_stat,hp,vit,int_stat,dex,hp,vit,mp,int_stat,hp,vit,agi,int_stat,mp,hp,vit,int_stat,hp,vit,int_stat,mp,hp,luk,int_stat,vit,agi,hp,mp,int_stat,vit,hp,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,int_stat,hp,luk,int_stat,vit,hp,mp,int_stat,hp,vit,agi,mp,int_stat,hp,vit,int_stat,hp,vit,mp,dex,int_stat,hp,vit,int_stat,agi,hp,mp,vit,int_stat,hp,mp,vit,int_stat,hp,int_stat,vit,agi,hp,mp,int_stat,vit,hp,luk,int_stat,mp,vit,hp,int_stat,dex,vit,hp,int_stat,mp,agi,vit,hp,int_stat,mp,vit,hp,int_stat}'::text[], '{鈍器,杖,書}'::text[], 'mag', '{聖職者,僧侶}'::text[], 16, 6, '{}'::text[]),
  ('異端審問官', 'ichiji', 30, '僧侶', 30, '{int_stat,mp,hp,vit,agi,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,agi,luk,int_stat,hp,mp,vit,int_stat,agi,mp,int_stat,hp,dex,vit,int_stat,mp,hp,int_stat,agi,mp,int_stat,vit,hp,mp,int_stat,agi,luk,int_stat,vit,mp,hp,int_stat,dex,mp,int_stat,hp,vit,agi,int_stat,mp,hp,int_stat,vit,mp,int_stat,agi,hp,mp,int_stat,dex,vit,int_stat,mp,agi,hp,int_stat,vit,mp,int_stat,luk,hp,agi,int_stat,mp,vit,int_stat,hp,mp,dex,int_stat,agi,mp,int_stat,vit,hp,int_stat,mp,hp,vit,int_stat,agi,mp,int_stat,dex,hp,mp,int_stat,vit,agi,int_stat,luk,mp,hp,int_stat,vit,mp,int_stat,agi,hp,int_stat,mp,vit,dex,int_stat,hp,mp,agi,int_stat,vit,hp,int_stat,mp,luk,int_stat,agi,mp,vit,hp,int_stat,dex,mp,int_stat,hp,vit,int_stat,agi,mp,int_stat,hp,mp,vit,int_stat,agi,mp,int_stat,hp,dex,vit,int_stat,mp,agi,int_stat,hp,mp,int_stat,vit,luk,hp,int_stat,mp,agi,int_stat,vit,mp,hp,int_stat,dex,agi,mp,int_stat,vit,hp,int_stat,mp,int_stat,agi,hp,vit,mp,int_stat,dex,luk,int_stat,mp,hp,vit,int_stat,agi,mp,int_stat,hp,vit,mp,int_stat,agi,hp,int_stat,mp,dex,vit,int_stat,hp,mp,int_stat,agi,vit,int_stat,mp,hp,int_stat,luk,mp,agi,int_stat,vit,hp,mp,int_stat,dex,agi,int_stat,hp,mp,vit,int_stat,mp,hp,int_stat,vit,agi,int_stat,mp,dex,hp,int_stat,mp,vit,int_stat,agi,hp,mp,int_stat,vit,luk,int_stat,mp,hp,agi,int_stat,mp,vit,int_stat,hp,dex,mp,int_stat,agi,vit,int_stat,hp,mp,int_stat,agi,mp,vit,int_stat,hp,dex,int_stat,mp,luk,hp,int_stat,vit,mp,agi,int_stat,hp,mp,int_stat,vit,agi,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,hp,agi,int_stat,mp,vit,hp,int_stat,mp,luk,int_stat,agi,vit,hp,mp,int_stat,dex,int_stat,mp,agi,hp,vit,int_stat,mp,int_stat,hp,vit,agi,int_stat,mp,dex,int_stat,hp,mp,vit,int_stat,agi,mp,int_stat,hp,luk,vit,int_stat,mp,hp,int_stat,agi,mp,int_stat,vit,dex,hp,int_stat,mp,agi,int_stat,vit,mp,hp,int_stat,mp,agi,int_stat,vit,hp,int_stat,mp,dex,luk,int_stat,hp,vit,mp,int_stat,agi,hp,int_stat,mp,vit,int_stat,agi,mp,hp,int_stat,dex,vit,mp,int_stat,hp,agi,int_stat,mp,vit,int_stat,hp,mp,luk,int_stat,agi,vit,mp,int_stat,hp,dex,int_stat,mp,agi,int_stat,vit,hp,mp,int_stat,hp,vit,int_stat,mp,agi,int_stat,dex,mp,hp,int_stat,vit,agi,mp,int_stat,hp,luk,int_stat,mp,vit,int_stat,hp,agi,mp,int_stat,vit,dex,int_stat,mp,hp,agi,int_stat,mp,vit,int_stat,hp,mp,int_stat,agi,vit,hp,int_stat,mp,dex,int_stat,luk,hp,mp,int_stat,vit,agi,int_stat,mp,hp,vit,int_stat,mp,agi,int_stat,hp,dex,mp,int_stat,vit,agi,int_stat,hp,mp,int_stat,vit,mp,hp,int_stat,luk,agi,int_stat,mp,vit,hp,int_stat,dex,mp,int_stat,agi,vit,hp,mp,int_stat}'::text[], '{鈍器,杖,書}'::text[], 'mag', '{異端審問官,僧侶}'::text[], 13, 6, '{}'::text[]),
  ('アルケミスト', 'ichiji', 31, '薬師', 30, '{int_stat,dex,mp,hp,agi,int_stat,dex,vit,int_stat,mp,dex,int_stat,hp,luk,mp,int_stat,dex,agi,int_stat,dex,mp,hp,int_stat,vit,agi,dex,int_stat,mp,int_stat,dex,hp,mp,int_stat,dex,agi,int_stat,vit,mp,dex,hp,int_stat,luk,dex,int_stat,mp,agi,int_stat,hp,dex,int_stat,mp,vit,dex,int_stat,agi,hp,mp,int_stat,dex,int_stat,dex,mp,agi,int_stat,hp,dex,vit,int_stat,mp,dex,int_stat,luk,hp,agi,int_stat,mp,dex,int_stat,dex,mp,int_stat,hp,vit,agi,dex,int_stat,mp,int_stat,dex,hp,mp,int_stat,dex,agi,int_stat,vit,mp,dex,int_stat,hp,luk,int_stat,dex,mp,agi,int_stat,dex,hp,int_stat,mp,vit,dex,int_stat,agi,mp,int_stat,dex,hp,int_stat,dex,mp,agi,int_stat,hp,dex,int_stat,vit,mp,luk,int_stat,dex,agi,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,vit,hp,agi,dex,int_stat,mp,int_stat,dex,hp,int_stat,mp,agi,dex,int_stat,vit,mp,dex,int_stat,luk,hp,int_stat,dex,agi,mp,int_stat,dex,hp,int_stat,mp,dex,int_stat,vit,agi,mp,int_stat,dex,hp,int_stat,dex,mp,agi,int_stat,luk,dex,int_stat,hp,mp,vit,int_stat,dex,agi,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,vit,agi,int_stat,dex,hp,mp,int_stat,dex,int_stat,mp,hp,agi,dex,int_stat,luk,vit,dex,int_stat,mp,hp,int_stat,dex,agi,mp,int_stat,dex,int_stat,mp,hp,dex,int_stat,agi,vit,int_stat,mp,dex,hp,int_stat,dex,mp,int_stat,agi,luk,dex,int_stat,hp,mp,vit,int_stat,dex,agi,int_stat,mp,dex,int_stat,hp,dex,mp,int_stat,vit,agi,int_stat,dex,hp,mp,int_stat,dex,int_stat,mp,agi,dex,int_stat,hp,luk,vit,int_stat,dex,mp,int_stat,dex,hp,agi,mp,int_stat,dex,int_stat,mp,hp,dex,int_stat,agi,vit,int_stat,mp,dex,int_stat,hp,dex,mp,int_stat,agi,luk,dex,int_stat,mp,vit,int_stat,hp,dex,int_stat,agi,mp,dex,int_stat,hp,dex,int_stat,mp,agi,vit,int_stat,dex,mp,int_stat,hp,dex,int_stat,mp,agi,dex,int_stat,hp,luk,int_stat,dex,mp,vit,int_stat,dex,agi,mp,int_stat,hp,dex,int_stat,mp,agi,int_stat,dex,hp,vit,int_stat,mp,dex,int_stat,luk,dex,hp,int_stat,mp,agi,int_stat,dex,mp,vit,int_stat,dex,hp,int_stat,agi,mp,dex,int_stat,hp,dex,int_stat,mp,agi,int_stat,dex,vit,mp,int_stat,hp,dex,int_stat,luk,mp,agi,dex,int_stat,hp,int_stat,dex,mp,vit,int_stat,agi,dex,int_stat,mp,hp,dex,int_stat,mp,int_stat,dex,agi,vit,hp,int_stat,mp,dex,int_stat,luk,dex,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,vit,dex,hp,int_stat,agi,mp,dex,int_stat,hp,int_stat,dex,mp,agi,int_stat,dex,vit,mp,int_stat,dex,hp,int_stat,luk,mp,agi,int_stat,dex,int_stat,hp,dex,mp,vit,int_stat,agi,dex,int_stat,mp,hp,dex,int_stat,mp,int_stat,dex,agi,vit,int_stat,hp,mp,dex,int_stat,luk,dex,int_stat,mp,agi,hp,int_stat,dex,mp,int_stat,vit,dex,int_stat,agi,hp,mp,dex,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{アルケミスト,薬師}'::text[], 13, 6, '{}'::text[]),
  ('霊薬師', 'ichiji', 32, '薬師', 30, '{int_stat,mp,vit,hp,dex,int_stat,agi,mp,vit,int_stat,hp,mp,int_stat,luk,vit,hp,int_stat,mp,dex,agi,int_stat,vit,mp,hp,int_stat,mp,vit,int_stat,dex,hp,mp,int_stat,vit,agi,int_stat,mp,hp,vit,int_stat,dex,mp,luk,int_stat,hp,vit,mp,int_stat,agi,hp,int_stat,mp,vit,dex,int_stat,mp,hp,vit,int_stat,agi,mp,int_stat,vit,hp,dex,mp,int_stat,vit,int_stat,hp,mp,luk,int_stat,agi,mp,vit,hp,int_stat,dex,mp,int_stat,vit,hp,int_stat,mp,agi,vit,int_stat,dex,mp,hp,int_stat,vit,mp,int_stat,hp,luk,vit,mp,int_stat,dex,agi,int_stat,hp,mp,vit,int_stat,mp,hp,int_stat,vit,dex,mp,int_stat,agi,hp,vit,int_stat,mp,int_stat,hp,vit,mp,dex,int_stat,agi,mp,vit,int_stat,hp,luk,int_stat,mp,vit,hp,int_stat,dex,mp,int_stat,vit,agi,mp,hp,int_stat,vit,mp,int_stat,dex,hp,int_stat,mp,vit,agi,int_stat,hp,mp,vit,int_stat,dex,luk,mp,int_stat,hp,vit,int_stat,mp,agi,hp,int_stat,vit,mp,dex,int_stat,hp,mp,vit,int_stat,agi,mp,int_stat,hp,vit,dex,int_stat,mp,luk,vit,int_stat,hp,mp,int_stat,agi,vit,mp,hp,int_stat,dex,int_stat,mp,vit,hp,int_stat,mp,dex,vit,int_stat,agi,hp,mp,int_stat,vit,mp,int_stat,hp,luk,dex,int_stat,vit,mp,agi,int_stat,hp,mp,vit,int_stat,hp,mp,int_stat,vit,dex,int_stat,mp,agi,hp,vit,int_stat,mp,int_stat,hp,dex,vit,mp,int_stat,luk,agi,hp,int_stat,mp,vit,int_stat,mp,vit,dex,hp,int_stat,mp,int_stat,vit,hp,agi,mp,int_stat,dex,vit,int_stat,mp,hp,int_stat,vit,mp,agi,int_stat,hp,luk,mp,int_stat,vit,dex,hp,int_stat,mp,vit,int_stat,mp,hp,agi,int_stat,vit,dex,mp,int_stat,hp,vit,mp,int_stat,dex,agi,int_stat,mp,hp,vit,int_stat,mp,luk,hp,int_stat,vit,mp,int_stat,dex,vit,hp,int_stat,mp,agi,int_stat,vit,mp,hp,int_stat,dex,mp,vit,int_stat,hp,agi,mp,int_stat,vit,luk,int_stat,hp,mp,dex,int_stat,vit,mp,hp,int_stat,agi,vit,mp,int_stat,hp,dex,int_stat,mp,vit,int_stat,hp,mp,agi,vit,int_stat,mp,dex,int_stat,hp,vit,mp,int_stat,luk,hp,int_stat,vit,mp,agi,int_stat,dex,mp,vit,hp,int_stat,mp,int_stat,vit,hp,agi,int_stat,mp,dex,vit,int_stat,hp,mp,int_stat,luk,vit,mp,int_stat,hp,agi,dex,int_stat,mp,vit,hp,int_stat,mp,vit,int_stat,hp,mp,dex,int_stat,vit,agi,mp,int_stat,hp,vit,int_stat,mp,dex,int_stat,hp,vit,mp,agi,int_stat,luk,mp,hp,int_stat,vit,dex,int_stat,mp,hp,vit,int_stat,mp,agi,int_stat,vit,hp,mp,int_stat,dex,vit,mp,int_stat,hp,agi,int_stat,mp,vit,luk,int_stat,hp,mp,dex,int_stat,vit,hp,mp,int_stat,agi,vit,int_stat,mp,hp,dex,int_stat,vit,mp,int_stat,hp,mp,vit,int_stat,agi,dex,mp,int_stat,hp,vit,luk,int_stat,mp,hp,int_stat,vit,mp,agi,int_stat,dex,hp,vit,mp,int_stat}'::text[], '{短剣,投擲,書}'::text[], 'mag', '{霊薬師,薬師}'::text[], 16, 6, '{}'::text[])
on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,
  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq,
  weapons = excluded.weapons, kind = excluded.kind, lineage = excluded.lineage,
  lv_hp = excluded.lv_hp, lv_mp = excluded.lv_mp, starter = excluded.starter;
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
-- ★2026-10-15 回数の上限がある技（狂鬼化・ゴスペル・エリクサー＝1・不動の誓い＝2）。null＝上限なし（skills.js の usesMax）
alter table public.v2cap_skills add column if not exists uses_max int;
alter table public.v2cap_skills enable row level security;
drop policy if exists v2cap_skills_read on public.v2cap_skills;
create policy v2cap_skills_read on public.v2cap_skills for select to authenticated using (true);
revoke all on table public.v2cap_skills from anon;
grant select on table public.v2cap_skills to authenticated;

-- @@seed:skills
delete from public.v2cap_skills;
insert into public.v2cap_skills (name, cls, mp, sort, passive, uses_max) values
  ('体当たり', '戦士', 4, 1, false, null),
  ('強撃', '戦士', 11, 2, false, null),
  ('防御崩し', '戦士', 8, 3, false, null),
  ('防御態勢', '戦士', 8, 4, false, null),
  ('シールドアタック', '戦士', 8, 5, false, null),
  ('狙撃', '弓使い', 8, 1, false, null),
  ('剛射', '弓使い', 11, 2, false, null),
  ('貫通射撃', '弓使い', 11, 3, false, null),
  ('疾風矢', '弓使い', 8, 4, false, null),
  ('駆け足', '弓使い', 6, 5, false, null),
  ('マジックアロー', '魔法使い', 5, 1, false, null),
  ('ファイア', '魔法使い', 13, 2, false, null),
  ('サンダー', '魔法使い', 13, 3, false, null),
  ('アイスランス', '魔法使い', 13, 4, false, null),
  ('精神統一', '魔法使い', 8, 5, false, null),
  ('ライト', '僧侶', 5, 1, false, null),
  ('ライトニング', '僧侶', 13, 2, false, null),
  ('ヒール', '僧侶', 12, 3, false, null),
  ('祈祷', '僧侶', 15, 4, false, null),
  ('プロテク', '僧侶', 10, 5, false, null),
  ('打撃', '格闘家', 4, 1, false, null),
  ('鉄拳', '格闘家', 11, 2, false, null),
  ('連打', '格闘家', 11, 3, false, null),
  ('爆裂拳', '格闘家', 11, 4, false, null),
  ('残心', '格闘家', 8, 5, false, null),
  ('突き', '槍使い', 4, 1, false, null),
  ('薙ぎ払い', '槍使い', 8, 2, false, null),
  ('投げ槍', '槍使い', 9, 3, false, null),
  ('三段突き', '槍使い', 11, 4, false, null),
  ('槍衾', '槍使い', 8, 5, false, null),
  ('切りつけ', '盗賊', 4, 1, false, null),
  ('早業', '盗賊', 8, 2, false, null),
  ('毒塗りの刃', '盗賊', 9, 3, false, null),
  ('目つぶし', '盗賊', 11, 4, false, null),
  ('影走り', '盗賊', 8, 5, false, null),
  ('早撃ち', '銃士', 4, 1, false, null),
  ('連射', '銃士', 8, 2, false, null),
  ('精密射撃', '銃士', 9, 3, false, null),
  ('徹甲弾', '銃士', 11, 4, false, null),
  ('狙いを定める', '銃士', 8, 5, false, null),
  ('袈裟斬り', '剣士', 4, 1, false, null),
  ('燕返し', '剣士', 8, 2, false, null),
  ('兜割り', '剣士', 9, 3, false, null),
  ('一閃', '剣士', 11, 4, false, null),
  ('剣の構え', '剣士', 8, 5, false, null),
  ('呪弾', '呪術師', 5, 1, false, null),
  ('呪縛', '呪術師', 9, 2, false, null),
  ('毒の呪い', '呪術師', 10, 3, false, null),
  ('災いの呪い', '呪術師', 13, 4, false, null),
  ('衰弱の呪詛', '呪術師', 9, 5, false, null),
  ('薬瓶投げ', '薬師', 5, 1, false, null),
  ('傷薬', '薬師', 12, 2, false, null),
  ('毒薬', '薬師', 10, 3, false, null),
  ('強壮剤', '薬師', 9, 4, false, null),
  ('気付け薬', '薬師', 8, 5, false, null),
  ('霞斬り', '剣士', 8, 6, false, null),
  ('乱れ斬り', '剣士', 11, 7, false, null),
  ('叩きつけ', '戦士', 11, 6, false, null),
  ('雄叫び', '戦士', 5, 7, false, null),
  ('鎧通し', '槍使い', 11, 6, false, null),
  ('穿ち', '槍使い', 8, 7, false, null),
  ('水面蹴り', '格闘家', 8, 6, false, null),
  ('百裂拳', '格闘家', 11, 7, false, null),
  ('投げナイフ', '盗賊', 8, 6, false, null),
  ('盗み取る', '盗賊', 8, 7, false, null),
  ('足止めの矢', '弓使い', 4, 6, false, null),
  ('五月雨撃ち', '弓使い', 11, 7, false, null),
  ('しびれ弾', '銃士', 9, 6, false, null),
  ('炸裂弾', '銃士', 11, 7, false, null),
  ('ウインド', '魔法使い', 9, 6, false, null),
  ('ディスペル', '魔法使い', 5, 7, false, null),
  ('封印の呪い', '呪術師', 10, 6, false, null),
  ('生命吸収', '呪術師', 9, 7, false, null),
  ('ホーリー', '僧侶', 5, 6, false, null),
  ('神罰', '僧侶', 13, 7, false, null),
  ('発火薬', '薬師', 9, 6, false, null),
  ('万能薬', '薬師', 10, 7, false, null),
  ('居合の構え', '侍', 0, 1, true, null),
  ('居合斬', '侍', 10, 2, false, null),
  ('納刀', '侍', 6, 3, false, null),
  ('抜刀術', '侍', 11, 4, false, null),
  ('断空', '侍', 14, 5, false, null),
  ('明鏡止水', '侍', 12, 6, false, null),
  ('二段斬り', '侍', 14, 7, false, null),
  ('桜花一閃', '侍', 17, 8, false, null),
  ('二の太刀', '侍', 14, 9, false, null),
  ('月影', '侍', 22, 10, false, null),
  ('秘剣・叢雲', '侍', 28, 11, false, null),
  ('エンチャント', '魔法剣士', 0, 1, true, null),
  ('マナエッジ', '魔法剣士', 10, 2, false, null),
  ('雷光斬', '魔法剣士', 10, 3, false, null),
  ('魔剣開放', '魔法剣士', 18, 4, false, null),
  ('フロストエッジ', '魔法剣士', 11, 5, false, null),
  ('マナバースト', '魔法剣士', 14, 6, false, null),
  ('双極斬', '魔法剣士', 14, 7, false, null),
  ('ソードオーラ', '魔法剣士', 15, 8, false, null),
  ('フレイムエッジ', '魔法剣士', 14, 9, false, null),
  ('エレメンタルエッジ', '魔法剣士', 20, 10, false, null),
  ('トリニティブレイド', '魔法剣士', 28, 11, false, null),
  ('バーサク', '狂戦士', 0, 1, true, null),
  ('マッドラッシュ', '狂戦士', 3, 2, false, null),
  ('血風斬', '狂戦士', 12, 3, false, null),
  ('狂乱の咆哮', '狂戦士', 10, 4, false, null),
  ('ブラッドスプラッシュ', '狂戦士', 6, 5, false, null),
  ('狂撃', '狂戦士', 14, 6, false, null),
  ('ブラッディロア', '狂戦士', 14, 7, false, null),
  ('血の誓い', '狂戦士', 10, 8, false, null),
  ('ブラッドサクリファイス', '狂戦士', 6, 9, false, null),
  ('フルブレイカー', '狂戦士', 11, 10, false, null),
  ('狂鬼化', '狂戦士', 10, 11, false, 1),
  ('聖騎士の心得', '聖騎士', 0, 1, true, null),
  ('ホーリーエッジ', '聖騎士', 10, 2, false, null),
  ('オースシールド', '聖騎士', 13, 3, false, null),
  ('シールドバッシュ', '聖騎士', 10, 4, false, null),
  ('ディバインスマイト', '聖騎士', 14, 5, false, null),
  ('ホーリーケア', '聖騎士', 16, 6, false, null),
  ('大防御', '聖騎士', 14, 7, false, null),
  ('ジャッジメントブロウ', '聖騎士', 14, 8, false, null),
  ('不動の誓い', '聖騎士', 14, 9, false, 2),
  ('神聖覚醒', '聖騎士', 20, 10, false, null),
  ('グランドクロス', '聖騎士', 28, 11, false, null),
  ('竜の血', '竜騎士', 0, 1, true, null),
  ('ドラゴンスラスト', '竜騎士', 7, 2, false, null),
  ('ジャンプ', '竜騎士', 14, 3, false, null),
  ('ドラゴンファング', '竜騎士', 12, 4, false, null),
  ('スカイスピア', '竜騎士', 11, 5, false, null),
  ('ドラゴンロア', '竜騎士', 12, 6, false, null),
  ('竜鱗', '竜騎士', 10, 7, false, null),
  ('ハイジャンプ', '竜騎士', 18, 8, false, null),
  ('竜翔', '竜騎士', 12, 9, false, null),
  ('天墜竜閃', '竜騎士', 24, 10, false, null),
  ('天竜落とし', '竜騎士', 28, 11, false, null),
  ('槍の型', 'ストームランサー', 0, 1, true, null),
  ('連突き', 'ストームランサー', 6, 2, false, null),
  ('薙ぎ崩し', 'ストームランサー', 9, 3, false, null),
  ('スパイラルスラスト', 'ストームランサー', 12, 4, false, null),
  ('足払い', 'ストームランサー', 9, 5, false, null),
  ('流星突き', 'ストームランサー', 15, 6, false, null),
  ('嵐の構え', 'ストームランサー', 10, 7, false, null),
  ('槍崩し', 'ストームランサー', 12, 8, false, null),
  ('疾風連突', 'ストームランサー', 12, 9, false, null),
  ('千本突き', 'ストームランサー', 22, 10, false, null),
  ('テンペストランス', 'ストームランサー', 28, 11, false, null),
  ('心眼', '体術師', 0, 1, true, null),
  ('半月蹴り', '体術師', 6, 2, false, null),
  ('受け流し', '体術師', 8, 3, false, null),
  ('五連殺', '体術師', 14, 4, false, null),
  ('旋風脚', '体術師', 13, 5, false, null),
  ('巴投げ', '体術師', 12, 6, false, null),
  ('流水の構え', '体術師', 12, 7, false, null),
  ('破衝掌', '体術師', 14, 8, false, null),
  ('後の先', '体術師', 12, 9, false, null),
  ('飛天三角蹴り', '体術師', 22, 10, false, null),
  ('流転掌', '体術師', 28, 11, false, null),
  ('精神感応', 'サイキッカー', 0, 1, true, null),
  ('サイコショット', 'サイキッカー', 10, 2, false, null),
  ('精神集中', 'サイキッカー', 16, 3, false, null),
  ('テレキネシス', 'サイキッカー', 10, 4, false, null),
  ('マインドブレイク', 'サイキッカー', 14, 5, false, null),
  ('マインドスパイク', 'サイキッカー', 14, 6, false, null),
  ('マインドアクセル', 'サイキッカー', 15, 7, false, null),
  ('サイキックチェイン', 'サイキッカー', 20, 8, false, null),
  ('マインドジャック', 'サイキッカー', 14, 9, false, null),
  ('サイコブラスト', 'サイキッカー', 20, 10, false, null),
  ('メンタルクラッシュ', 'サイキッカー', 28, 11, false, null),
  ('血の匂い', '暗殺者', 0, 1, true, null),
  ('刻み斬り', '暗殺者', 6, 2, false, null),
  ('鬼影閃', '暗殺者', 12, 3, false, null),
  ('ヴァイパーストライク', '暗殺者', 11, 4, false, null),
  ('隠形', '暗殺者', 10, 5, false, null),
  ('裂傷', '暗殺者', 10, 6, false, null),
  ('影討ち', '暗殺者', 14, 7, false, null),
  ('首狩り', '暗殺者', 16, 8, false, null),
  ('死の刻印', '暗殺者', 12, 9, false, null),
  ('急所突き', '暗殺者', 20, 10, false, null),
  ('絶命', '暗殺者', 28, 11, false, null),
  ('影の連携', '忍者', 0, 1, true, null),
  ('手裏剣', '忍者', 6, 2, false, null),
  ('分身の術', '忍者', 12, 3, false, null),
  ('雷遁', '忍者', 12, 4, false, null),
  ('火遁', '忍者', 12, 5, false, null),
  ('影斬り', '忍者', 12, 6, false, null),
  ('毒霧の術', '忍者', 10, 7, false, null),
  ('変わり身', '忍者', 14, 8, false, null),
  ('水遁・渦潮の術', '忍者', 14, 9, false, null),
  ('千本手裏剣', '忍者', 20, 10, false, null),
  ('微塵隠れの術', '忍者', 28, 11, false, null),
  ('獲物の弱り目', '狩人', 0, 1, true, null),
  ('毒矢', '狩人', 7, 2, false, null),
  ('くくり罠', '狩人', 10, 3, false, null),
  ('ハンターズマーク', '狩人', 8, 4, false, null),
  ('裂き矢', '狩人', 10, 5, false, null),
  ('目くらまし', '狩人', 10, 6, false, null),
  ('三連射', '狩人', 14, 7, false, null),
  ('狩猟の構え', '狩人', 10, 8, false, null),
  ('トラバサミ', '狩人', 10, 9, false, null),
  ('仕留めの一矢', '狩人', 20, 10, false, null),
  ('ワイルドハント', '狩人', 28, 11, false, null),
  ('狙撃手の勘', 'アークアーチャー', 0, 1, true, null),
  ('急所射ち', 'アークアーチャー', 7, 2, false, null),
  ('照準', 'アークアーチャー', 8, 3, false, null),
  ('ラピッドショット', 'アークアーチャー', 10, 4, false, null),
  ('貫き矢', 'アークアーチャー', 12, 5, false, null),
  ('息を止める', 'アークアーチャー', 10, 6, false, null),
  ('強弓', 'アークアーチャー', 16, 7, false, null),
  ('弱点看破', 'アークアーチャー', 12, 8, false, null),
  ('ロックオン', 'アークアーチャー', 12, 9, false, null),
  ('絶影狙撃', 'アークアーチャー', 22, 10, false, null),
  ('天穿の矢', 'アークアーチャー', 28, 11, false, null),
  ('魔弾', '魔銃士', 0, 1, true, null),
  ('マナショット', '魔銃士', 6, 2, false, null),
  ('焼夷弾', '魔銃士', 11, 3, false, null),
  ('雷撃弾', '魔銃士', 11, 4, false, null),
  ('氷結弾', '魔銃士', 11, 5, false, null),
  ('ブレイクショット', '魔銃士', 13, 6, false, null),
  ('魔力装填', '魔銃士', 12, 7, false, null),
  ('連装魔撃', '魔銃士', 16, 8, false, null),
  ('エーテルバレット', '魔銃士', 14, 9, false, null),
  ('アルカナバレット', '魔銃士', 22, 10, false, null),
  ('オーバーロードショット', '魔銃士', 0, 11, false, null),
  ('砲台の構え', 'デストロイヤー', 0, 1, true, null),
  ('散弾', 'デストロイヤー', 6, 2, false, null),
  ('装填', 'デストロイヤー', 6, 3, false, null),
  ('キャノン', 'デストロイヤー', 14, 4, false, null),
  ('スモークシェル', 'デストロイヤー', 10, 5, false, null),
  ('速射', 'デストロイヤー', 10, 6, false, null),
  ('グレネード', 'デストロイヤー', 12, 7, false, null),
  ('弾薬補給', 'デストロイヤー', 10, 8, false, null),
  ('弾帯換装', 'デストロイヤー', 12, 9, false, null),
  ('フルバースト', 'デストロイヤー', 24, 10, false, null),
  ('カーペットボム', 'デストロイヤー', 28, 11, false, null),
  ('元素共鳴', '元素使い', 0, 1, true, null),
  ('ファイアボール', '元素使い', 7, 2, false, null),
  ('詠唱', '元素使い', 6, 3, false, null),
  ('フロストノヴァ', '元素使い', 13, 4, false, null),
  ('ウィンドカッター', '元素使い', 13, 5, false, null),
  ('ライトニングボルト', '元素使い', 13, 6, false, null),
  ('魔力集中', '元素使い', 10, 7, false, null),
  ('メテオストライク', '元素使い', 22, 8, false, null),
  ('アースクエイク', '元素使い', 14, 9, false, null),
  ('カタストロフ', '元素使い', 28, 10, false, null),
  ('プリズムバースト', '元素使い', 30, 11, false, null),
  ('刻の加護', 'クロノマンサー', 0, 1, true, null),
  ('クロノバレット', 'クロノマンサー', 6, 2, false, null),
  ('アクセル', 'クロノマンサー', 10, 3, false, null),
  ('スロウ', 'クロノマンサー', 10, 4, false, null),
  ('ディレイ', 'クロノマンサー', 12, 5, false, null),
  ('ストップ', 'クロノマンサー', 16, 6, false, null),
  ('クイック', 'クロノマンサー', 14, 7, false, null),
  ('リワインド', 'クロノマンサー', 14, 8, false, null),
  ('リピート', 'クロノマンサー', 14, 9, false, null),
  ('クロノブレイク', 'クロノマンサー', 24, 10, false, null),
  ('パラドックス', 'クロノマンサー', 28, 11, false, null),
  ('死者の盾', '死霊使い', 0, 1, true, null),
  ('骸骨召喚', '死霊使い', 10, 2, false, null),
  ('ソウルドレイン', '死霊使い', 10, 3, false, null),
  ('ボーンスピア', '死霊使い', 11, 4, false, null),
  ('恐怖の囁き', '死霊使い', 10, 5, false, null),
  ('腐敗霧', '死霊使い', 14, 6, false, null),
  ('死の行軍', '死霊使い', 12, 7, false, null),
  ('魂喰らい', '死霊使い', 12, 8, false, null),
  ('レイズデッド', '死霊使い', 16, 9, false, null),
  ('幽世ノ門', '死霊使い', 24, 10, false, null),
  ('ソウルハーヴェスト', '死霊使い', 28, 11, false, null),
  ('陰陽の理', '式神使い', 0, 1, true, null),
  ('式打ち', '式神使い', 6, 2, false, null),
  ('式神召喚', '式神使い', 14, 3, false, null),
  ('封の符', '式神使い', 12, 4, false, null),
  ('火炎符', '式神使い', 12, 5, false, null),
  ('陰陽結界', '式神使い', 12, 6, false, null),
  ('魂削りの符', '式神使い', 12, 7, false, null),
  ('鬼神降ろし', '式神使い', 14, 8, false, null),
  ('封縛結界', '式神使い', 14, 9, false, null),
  ('禁術・神降ろし', '式神使い', 24, 10, false, null),
  ('急急如律令', '式神使い', 28, 11, false, null),
  ('神聖加護', '聖職者', 0, 1, true, null),
  ('聖光', '聖職者', 7, 2, false, null),
  ('ハイヒール', '聖職者', 12, 3, false, null),
  ('ブレス', '聖職者', 10, 4, false, null),
  ('奇跡', '聖職者', 16, 5, false, null),
  ('祈りの結界', '聖職者', 12, 6, false, null),
  ('癒しの光撃', '聖職者', 14, 7, false, null),
  ('リザレクション', '聖職者', 20, 8, false, null),
  ('光の帳', '聖職者', 14, 9, false, null),
  ('セイクリッドノヴァ', '聖職者', 24, 10, false, null),
  ('ゴスペル', '聖職者', 24, 11, false, 1),
  ('退魔の心得', '異端審問官', 0, 1, true, null),
  ('破魔の光', '異端審問官', 7, 2, false, null),
  ('封魔の印', '異端審問官', 12, 3, false, null),
  ('ホーリーチェイン', '異端審問官', 12, 4, false, null),
  ('聖水', '異端審問官', 10, 5, false, null),
  ('狂信', '異端審問官', 12, 6, false, null),
  ('浄化の炎', '異端審問官', 14, 7, false, null),
  ('聖なる裁き', '異端審問官', 16, 8, false, null),
  ('異端の烙印', '異端審問官', 14, 9, false, null),
  ('断罪', '異端審問官', 24, 10, false, null),
  ('火刑', '異端審問官', 28, 11, false, null),
  ('化学反応', 'アルケミスト', 0, 1, true, null),
  ('火炎瓶', 'アルケミスト', 7, 2, false, null),
  ('劇毒瓶', 'アルケミスト', 10, 3, false, null),
  ('スパークボトル', 'アルケミスト', 10, 4, false, null),
  ('腐食液', 'アルケミスト', 12, 5, false, null),
  ('閃光弾', 'アルケミスト', 10, 6, false, null),
  ('触媒', 'アルケミスト', 10, 7, false, null),
  ('溶解液', 'アルケミスト', 14, 8, false, null),
  ('爆炎毒', 'アルケミスト', 14, 9, false, null),
  ('メガボム', 'アルケミスト', 24, 10, false, null),
  ('賢者の石', 'アルケミスト', 22, 11, false, null),
  ('調合の極意', '霊薬師', 0, 1, true, null),
  ('霊薬瓶', '霊薬師', 7, 2, false, null),
  ('剛力薬', '霊薬師', 9, 3, false, null),
  ('叡智の薬', '霊薬師', 9, 4, false, null),
  ('鉄身薬', '霊薬師', 9, 5, false, null),
  ('再生薬', '霊薬師', 14, 6, false, null),
  ('霊薬', '霊薬師', 14, 7, false, null),
  ('薬効解放', '霊薬師', 16, 8, false, null),
  ('浸透薬', '霊薬師', 14, 9, false, null),
  ('仙丹', '霊薬師', 22, 10, false, null),
  ('エリクサー', '霊薬師', 26, 11, false, 1);
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
-- ★2026-10-21 ユニーク（ボス固有・レア度 U・equipment.js の UNIQUE_ITEMS）：落とすボスの場所（v2cap_spots.id）。ふつうの装備は null
alter table public.v2cap_equipment add column if not exists spot int;
alter table public.v2cap_equipment enable row level security;
drop policy if exists v2cap_equipment_read on public.v2cap_equipment;
create policy v2cap_equipment_read on public.v2cap_equipment for select to authenticated using (true);
revoke all on table public.v2cap_equipment from anon;
grant select on table public.v2cap_equipment to authenticated;

-- @@seed:equipment
insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot) values
  ('1N:片手剣', 'ブロンズソード', '武器', '片手剣', null, 1, 'N', 5, null),
  ('1N:両手剣', 'ブロンズクレイモア', '武器', '両手剣', null, 1, 'N', 5, null),
  ('1N:斧', 'ブロンズアクス', '武器', '斧', null, 1, 'N', 5, null),
  ('1N:槍', 'ブロンズスピア', '武器', '槍', null, 1, 'N', 5, null),
  ('1N:鈍器', 'ブロンズメイス', '武器', '鈍器', null, 1, 'N', 5, null),
  ('1N:短剣', 'ブロンズダガー', '武器', '短剣', null, 1, 'N', 5, null),
  ('1N:拳', 'ブロンズナックル', '武器', '拳', null, 1, 'N', 5, null),
  ('1N:弓', 'ウッドボウ', '武器', '弓', null, 1, 'N', 5, null),
  ('1N:銃', 'マッチロック', '武器', '銃', null, 1, 'N', 5, null),
  ('1N:杖', 'ウッドスタッフ', '武器', '杖', null, 1, 'N', 5, null),
  ('1N:書', '入門書', '武器', '書', null, 1, 'N', 5, null),
  ('1N:投擲', 'ブロンズチャクラム', '武器', '投擲', null, 1, 'N', 5, null),
  ('1N:刀', 'ブロンズカタナ', '武器', '刀', null, 1, 'N', 5, null),
  ('1N:宝珠', 'グラスオーブ', '武器', '宝珠', null, 1, 'N', 5, null),
  ('1N:重鎧頭', 'ブロンズヘルム', '頭', '重鎧', '重鎧', 1, 'N', 5, null),
  ('1N:重鎧鎧', 'ブロンズメイル', '鎧', '重鎧', '重鎧', 1, 'N', 5, null),
  ('1N:重鎧腕', 'ブロンズガントレット', '腕', '重鎧', '重鎧', 1, 'N', 5, null),
  ('1N:重鎧足', 'ブロンズグリーヴ', '足', '重鎧', '重鎧', 1, 'N', 5, null),
  ('1N:軽装頭', 'リネンフード', '頭', '軽装', '軽装', 1, 'N', 5, null),
  ('1N:軽装鎧', 'リネンコート', '鎧', '軽装', '軽装', 1, 'N', 5, null),
  ('1N:軽装腕', 'リネングローブ', '腕', '軽装', '軽装', 1, 'N', 5, null),
  ('1N:軽装足', 'リネンブーツ', '足', '軽装', '軽装', 1, 'N', 5, null),
  ('1N:リング', 'カッパーリング', 'アクセ', 'リング', null, 1, 'N', 5, null),
  ('1N:イヤリング', 'カッパーイヤリング', 'アクセ', 'イヤリング', null, 1, 'N', 5, null),
  ('1N:ベルト', 'カッパーベルト', 'アクセ', 'ベルト', null, 1, 'N', 5, null),
  ('1N:ネックレス', 'カッパーネックレス', 'アクセ', 'ネックレス', null, 1, 'N', 5, null),
  ('1R:片手剣', '若葉の剣', '武器', '片手剣', null, 1, 'R', 10, null),
  ('1R:両手剣', '古樹断ち', '武器', '両手剣', null, 1, 'R', 10, null),
  ('1R:斧', '木こりの斧', '武器', '斧', null, 1, 'R', 10, null),
  ('1R:槍', 'ブランチスピア', '武器', '槍', null, 1, 'R', 10, null),
  ('1R:鈍器', 'ドングリハンマー', '武器', '鈍器', null, 1, 'R', 10, null),
  ('1R:短剣', '葉隠れ短剣', '武器', '短剣', null, 1, 'R', 10, null),
  ('1R:拳', 'モスナックル', '武器', '拳', null, 1, 'R', 10, null),
  ('1R:弓', 'サンリーフボウ', '武器', '弓', null, 1, 'R', 10, null),
  ('1R:銃', '森番の猟銃', '武器', '銃', null, 1, 'R', 10, null),
  ('1R:杖', 'スプラウトロッド', '武器', '杖', null, 1, 'R', 10, null),
  ('1R:書', '妖精の絵本', '武器', '書', null, 1, 'R', 10, null),
  ('1R:投擲', '妖精の輪', '武器', '投擲', null, 1, 'R', 10, null),
  ('1R:刀', '苔むした古刀', '武器', '刀', null, 1, 'R', 10, null),
  ('1R:宝珠', '木霊の珠', '武器', '宝珠', null, 1, 'R', 10, null),
  ('1R:重鎧頭', '樹皮の兜', '頭', '重鎧', '重鎧', 1, 'R', 10, null),
  ('1R:重鎧鎧', '樹皮の鎧', '鎧', '重鎧', '重鎧', 1, 'R', 10, null),
  ('1R:重鎧腕', '樹皮の篭手', '腕', '重鎧', '重鎧', 1, 'R', 10, null),
  ('1R:重鎧足', '樹皮の脚甲', '足', '重鎧', '重鎧', 1, 'R', 10, null),
  ('1R:軽装頭', 'フェアリーハット', '頭', '軽装', '軽装', 1, 'R', 10, null),
  ('1R:軽装鎧', 'フェアリーローブ', '鎧', '軽装', '軽装', 1, 'R', 10, null),
  ('1R:軽装腕', 'フェアリーミトン', '腕', '軽装', '軽装', 1, 'R', 10, null),
  ('1R:軽装足', 'フェアリーシューズ', '足', '軽装', '軽装', 1, 'R', 10, null),
  ('1R:リング', '翡翠の指輪', 'アクセ', 'リング', null, 1, 'R', 10, null),
  ('1R:イヤリング', '朝露のしずく', 'アクセ', 'イヤリング', null, 1, 'R', 10, null),
  ('1R:ベルト', '蔓編みベルト', 'アクセ', 'ベルト', null, 1, 'R', 10, null),
  ('1R:ネックレス', 'どんぐりペンダント', 'アクセ', 'ネックレス', null, 1, 'R', 10, null),
  ('1E:片手剣', '木漏れ日の宝剣', '武器', '片手剣', null, 1, 'E', 15, null),
  ('1E:両手剣', '巨木の大剣', '武器', '両手剣', null, 1, 'E', 15, null),
  ('1E:斧', '獣道の大斧', '武器', '斧', null, 1, 'E', 15, null),
  ('1E:槍', '梢渡りの槍', '武器', '槍', null, 1, 'E', 15, null),
  ('1E:鈍器', '古樹の根鎚', '武器', '鈍器', null, 1, 'E', 15, null),
  ('1E:短剣', '朝露の短剣', '武器', '短剣', null, 1, 'E', 15, null),
  ('1E:拳', '若芽の拳', '武器', '拳', null, 1, 'E', 15, null),
  ('1E:弓', '陽だまりの弓', '武器', '弓', null, 1, 'E', 15, null),
  ('1E:銃', '緑陰の長銃', '武器', '銃', null, 1, 'E', 15, null),
  ('1E:杖', '小枝の杖', '武器', '杖', null, 1, 'E', 15, null),
  ('1E:書', '小径の詩集', '武器', '書', null, 1, 'E', 15, null),
  ('1E:投擲', '綿毛の戦輪', '武器', '投擲', null, 1, 'E', 15, null),
  ('1E:刀', '青葉丸', '武器', '刀', null, 1, 'E', 15, null),
  ('1E:宝珠', '森雫の宝珠', '武器', '宝珠', null, 1, 'E', 15, null),
  ('1E:重鎧頭', '苔石の兜', '頭', '重鎧', '重鎧', 1, 'E', 15, null),
  ('1E:重鎧鎧', '苔石の鎧', '鎧', '重鎧', '重鎧', 1, 'E', 15, null),
  ('1E:重鎧腕', '苔石の篭手', '腕', '重鎧', '重鎧', 1, 'E', 15, null),
  ('1E:重鎧足', '苔石の具足', '足', '重鎧', '重鎧', 1, 'E', 15, null),
  ('1E:軽装頭', '新緑の帽子', '頭', '軽装', '軽装', 1, 'E', 15, null),
  ('1E:軽装鎧', '新緑の衣', '鎧', '軽装', '軽装', 1, 'E', 15, null),
  ('1E:軽装腕', '新緑の手袋', '腕', '軽装', '軽装', 1, 'E', 15, null),
  ('1E:軽装足', '新緑の靴', '足', '軽装', '軽装', 1, 'E', 15, null),
  ('1E:リング', '蔦の指輪', 'アクセ', 'リング', null, 1, 'E', 15, null),
  ('1E:イヤリング', '露草の耳飾り', 'アクセ', 'イヤリング', null, 1, 'E', 15, null),
  ('1E:ベルト', '木の根の帯', 'アクセ', 'ベルト', null, 1, 'E', 15, null),
  ('1E:ネックレス', '木の実の首飾り', 'アクセ', 'ネックレス', null, 1, 'E', 15, null),
  ('1L:片手剣', '森剣シルヴァ', '武器', '片手剣', null, 1, 'L', 20, null),
  ('1L:両手剣', '始原の大剣', '武器', '両手剣', null, 1, 'L', 20, null),
  ('1L:斧', '樹神斧ドリュアス', '武器', '斧', null, 1, 'L', 20, null),
  ('1L:槍', '芽吹きの神槍', '武器', '槍', null, 1, 'L', 20, null),
  ('1L:鈍器', '樹冠の神鎚', '武器', '鈍器', null, 1, 'L', 20, null),
  ('1L:短剣', '森の囁き', '武器', '短剣', null, 1, 'L', 20, null),
  ('1L:拳', '万緑拳', '武器', '拳', null, 1, 'L', 20, null),
  ('1L:弓', 'はじまりの朝', '武器', '弓', null, 1, 'L', 20, null),
  ('1L:銃', '翠嵐砲', '武器', '銃', null, 1, 'L', 20, null),
  ('1L:杖', '世界樹の若枝', '武器', '杖', null, 1, 'L', 20, null),
  ('1L:書', '森の創世記', '武器', '書', null, 1, 'L', 20, null),
  ('1L:投擲', '千枚葉', '武器', '投擲', null, 1, 'L', 20, null),
  ('1L:刀', '青嵐', '武器', '刀', null, 1, 'L', 20, null),
  ('1L:宝珠', '始原の種子', '武器', '宝珠', null, 1, 'L', 20, null),
  ('1L:重鎧頭', '森主の兜', '頭', '重鎧', '重鎧', 1, 'L', 20, null),
  ('1L:重鎧鎧', '森主の鎧', '鎧', '重鎧', '重鎧', 1, 'L', 20, null),
  ('1L:重鎧腕', '森主の篭手', '腕', '重鎧', '重鎧', 1, 'L', 20, null),
  ('1L:重鎧足', '森主の具足', '足', '重鎧', '重鎧', 1, 'L', 20, null),
  ('1L:軽装頭', '森姫の冠', '頭', '軽装', '軽装', 1, 'L', 20, null),
  ('1L:軽装鎧', '森姫の衣', '鎧', '軽装', '軽装', 1, 'L', 20, null),
  ('1L:軽装腕', '森姫の手袋', '腕', '軽装', '軽装', 1, 'L', 20, null),
  ('1L:軽装足', '森姫の靴', '足', '軽装', '軽装', 1, 'L', 20, null),
  ('1L:リング', '始まりの指輪', 'アクセ', 'リング', null, 1, 'L', 20, null),
  ('1L:イヤリング', '森歌の耳飾り', 'アクセ', 'イヤリング', null, 1, 'L', 20, null),
  ('1L:ベルト', '若木の帯', 'アクセ', 'ベルト', null, 1, 'L', 20, null),
  ('1L:ネックレス', '古樹の涙', 'アクセ', 'ネックレス', null, 1, 'L', 20, null),
  ('2N:片手剣', 'アイアンソード', '武器', '片手剣', null, 2, 'N', 10, null),
  ('2N:両手剣', 'アイアンクレイモア', '武器', '両手剣', null, 2, 'N', 10, null),
  ('2N:斧', 'アイアンアクス', '武器', '斧', null, 2, 'N', 10, null),
  ('2N:槍', 'アイアンスピア', '武器', '槍', null, 2, 'N', 10, null),
  ('2N:鈍器', 'アイアンメイス', '武器', '鈍器', null, 2, 'N', 10, null),
  ('2N:短剣', 'アイアンダガー', '武器', '短剣', null, 2, 'N', 10, null),
  ('2N:拳', 'アイアンナックル', '武器', '拳', null, 2, 'N', 10, null),
  ('2N:弓', 'オークボウ', '武器', '弓', null, 2, 'N', 10, null),
  ('2N:銃', 'マスケット', '武器', '銃', null, 2, 'N', 10, null),
  ('2N:杖', 'オークスタッフ', '武器', '杖', null, 2, 'N', 10, null),
  ('2N:書', '教本', '武器', '書', null, 2, 'N', 10, null),
  ('2N:投擲', 'アイアンチャクラム', '武器', '投擲', null, 2, 'N', 10, null),
  ('2N:刀', 'アイアンカタナ', '武器', '刀', null, 2, 'N', 10, null),
  ('2N:宝珠', 'クォーツオーブ', '武器', '宝珠', null, 2, 'N', 10, null),
  ('2N:重鎧頭', 'アイアンヘルム', '頭', '重鎧', '重鎧', 2, 'N', 10, null),
  ('2N:重鎧鎧', 'アイアンメイル', '鎧', '重鎧', '重鎧', 2, 'N', 10, null),
  ('2N:重鎧腕', 'アイアンガントレット', '腕', '重鎧', '重鎧', 2, 'N', 10, null),
  ('2N:重鎧足', 'アイアングリーヴ', '足', '重鎧', '重鎧', 2, 'N', 10, null),
  ('2N:軽装頭', 'レザーフード', '頭', '軽装', '軽装', 2, 'N', 10, null),
  ('2N:軽装鎧', 'レザーコート', '鎧', '軽装', '軽装', 2, 'N', 10, null),
  ('2N:軽装腕', 'レザーグローブ', '腕', '軽装', '軽装', 2, 'N', 10, null),
  ('2N:軽装足', 'レザーブーツ', '足', '軽装', '軽装', 2, 'N', 10, null),
  ('2N:リング', 'クォーツリング', 'アクセ', 'リング', null, 2, 'N', 10, null),
  ('2N:イヤリング', 'クォーツイヤリング', 'アクセ', 'イヤリング', null, 2, 'N', 10, null),
  ('2N:ベルト', 'クォーツベルト', 'アクセ', 'ベルト', null, 2, 'N', 10, null),
  ('2N:ネックレス', 'クォーツネックレス', 'アクセ', 'ネックレス', null, 2, 'N', 10, null),
  ('2R:片手剣', '無名騎士の剣', '武器', '片手剣', null, 2, 'R', 15, null),
  ('2R:両手剣', '古戦場の大剣', '武器', '両手剣', null, 2, 'R', 15, null),
  ('2R:斧', '野盗の手斧', '武器', '斧', null, 2, 'R', 15, null),
  ('2R:槍', 'ウィンドパイク', '武器', '槍', null, 2, 'R', 15, null),
  ('2R:鈍器', '棘付き棍棒', '武器', '鈍器', null, 2, 'R', 15, null),
  ('2R:短剣', '盗賊短刀', '武器', '短剣', null, 2, 'R', 15, null),
  ('2R:拳', '狼牙拳', '武器', '拳', null, 2, 'R', 15, null),
  ('2R:弓', 'ゴブリンショートボウ', '武器', '弓', null, 2, 'R', 15, null),
  ('2R:銃', '流れ者の拳銃', '武器', '銃', null, 2, 'R', 15, null),
  ('2R:杖', '風読みの杖', '武器', '杖', null, 2, 'R', 15, null),
  ('2R:書', '戦場日誌', '武器', '書', null, 2, 'R', 15, null),
  ('2R:投擲', '猪狩りのボーラ', '武器', '投擲', null, 2, 'R', 15, null),
  ('2R:刀', '無銘の野太刀', '武器', '刀', null, 2, 'R', 15, null),
  ('2R:宝珠', '風見の水晶', '武器', '宝珠', null, 2, 'R', 15, null),
  ('2R:重鎧頭', '古兵の兜', '頭', '重鎧', '重鎧', 2, 'R', 15, null),
  ('2R:重鎧鎧', '古兵の鎧', '鎧', '重鎧', '重鎧', 2, 'R', 15, null),
  ('2R:重鎧腕', '古兵の篭手', '腕', '重鎧', '重鎧', 2, 'R', 15, null),
  ('2R:重鎧足', '古兵の具足', '足', '重鎧', '重鎧', 2, 'R', 15, null),
  ('2R:軽装頭', 'ウルフハイドフード', '頭', '軽装', '軽装', 2, 'R', 15, null),
  ('2R:軽装鎧', 'ウルフハイドジャケット', '鎧', '軽装', '軽装', 2, 'R', 15, null),
  ('2R:軽装腕', 'ウルフハイドグローブ', '腕', '軽装', '軽装', 2, 'R', 15, null),
  ('2R:軽装足', 'ウルフハイドブーツ', '足', '軽装', '軽装', 2, 'R', 15, null),
  ('2R:リング', '盗品の指輪', 'アクセ', 'リング', null, 2, 'R', 15, null),
  ('2R:イヤリング', '牙飾りのピアス', 'アクセ', 'イヤリング', null, 2, 'R', 15, null),
  ('2R:ベルト', 'バンディットベルト', 'アクセ', 'ベルト', null, 2, 'R', 15, null),
  ('2R:ネックレス', '骨片の首飾り', 'アクセ', 'ネックレス', null, 2, 'R', 15, null),
  ('2E:片手剣', '荒野の剣', '武器', '片手剣', null, 2, 'E', 20, null),
  ('2E:両手剣', '焼け跡の大剣', '武器', '両手剣', null, 2, 'E', 20, null),
  ('2E:斧', '灰塵の斧', '武器', '斧', null, 2, 'E', 20, null),
  ('2E:槍', '戦旗の槍', '武器', '槍', null, 2, 'E', 20, null),
  ('2E:鈍器', '廃村の鐘鎚', '武器', '鈍器', null, 2, 'E', 20, null),
  ('2E:短剣', '野分の短剣', '武器', '短剣', null, 2, 'E', 20, null),
  ('2E:拳', '流浪の拳', '武器', '拳', null, 2, 'E', 20, null),
  ('2E:弓', '地平の弓', '武器', '弓', null, 2, 'E', 20, null),
  ('2E:銃', '焦土の銃', '武器', '銃', null, 2, 'E', 20, null),
  ('2E:杖', '燃えさしの杖', '武器', '杖', null, 2, 'E', 20, null),
  ('2E:書', '焼けた日記', '武器', '書', null, 2, 'E', 20, null),
  ('2E:投擲', 'つむじ風の輪', '武器', '投擲', null, 2, 'E', 20, null),
  ('2E:刀', '野風丸', '武器', '刀', null, 2, 'E', 20, null),
  ('2E:宝珠', '戦火の宝珠', '武器', '宝珠', null, 2, 'E', 20, null),
  ('2E:重鎧頭', '焼鉄の兜', '頭', '重鎧', '重鎧', 2, 'E', 20, null),
  ('2E:重鎧鎧', '焼鉄の鎧', '鎧', '重鎧', '重鎧', 2, 'E', 20, null),
  ('2E:重鎧腕', '焼鉄の篭手', '腕', '重鎧', '重鎧', 2, 'E', 20, null),
  ('2E:重鎧足', '焼鉄の具足', '足', '重鎧', '重鎧', 2, 'E', 20, null),
  ('2E:軽装頭', '風来の帽子', '頭', '軽装', '軽装', 2, 'E', 20, null),
  ('2E:軽装鎧', '風来の外套', '鎧', '軽装', '軽装', 2, 'E', 20, null),
  ('2E:軽装腕', '風来の手袋', '腕', '軽装', '軽装', 2, 'E', 20, null),
  ('2E:軽装足', '風来の靴', '足', '軽装', '軽装', 2, 'E', 20, null),
  ('2E:リング', '形見の指輪', 'アクセ', 'リング', null, 2, 'E', 20, null),
  ('2E:イヤリング', '丘風の耳飾り', 'アクセ', 'イヤリング', null, 2, 'E', 20, null),
  ('2E:ベルト', '古戦場の剣帯', 'アクセ', 'ベルト', null, 2, 'E', 20, null),
  ('2E:ネックレス', '弔いの首飾り', 'アクセ', 'ネックレス', null, 2, 'E', 20, null),
  ('2L:片手剣', '英雄剣アルド', '武器', '片手剣', null, 2, 'L', 25, null),
  ('2L:両手剣', '千軍の大剣', '武器', '両手剣', null, 2, 'L', 25, null),
  ('2L:斧', '戦王斧グラン', '武器', '斧', null, 2, 'L', 25, null),
  ('2L:槍', '不倒の旗槍', '武器', '槍', null, 2, 'L', 25, null),
  ('2L:鈍器', '勝鬨の鎚', '武器', '鈍器', null, 2, 'L', 25, null),
  ('2L:短剣', '残光', '武器', '短剣', null, 2, 'L', 25, null),
  ('2L:拳', '英傑拳', '武器', '拳', null, 2, 'L', 25, null),
  ('2L:弓', '落日の弓', '武器', '弓', null, 2, 'L', 25, null),
  ('2L:銃', '開戦の号砲', '武器', '銃', null, 2, 'L', 25, null),
  ('2L:杖', '鎮魂の大杖', '武器', '杖', null, 2, 'L', 25, null),
  ('2L:書', '草原戦記', '武器', '書', null, 2, 'L', 25, null),
  ('2L:投擲', '草薙ぎの輪', '武器', '投擲', null, 2, 'L', 25, null),
  ('2L:刀', '戦塵', '武器', '刀', null, 2, 'L', 25, null),
  ('2L:宝珠', '凱旋の宝珠', '武器', '宝珠', null, 2, 'L', 25, null),
  ('2L:重鎧頭', '英雄王の兜', '頭', '重鎧', '重鎧', 2, 'L', 25, null),
  ('2L:重鎧鎧', '英雄王の鎧', '鎧', '重鎧', '重鎧', 2, 'L', 25, null),
  ('2L:重鎧腕', '英雄王の篭手', '腕', '重鎧', '重鎧', 2, 'L', 25, null),
  ('2L:重鎧足', '英雄王の具足', '足', '重鎧', '重鎧', 2, 'L', 25, null),
  ('2L:軽装頭', '遊牧王の帽子', '頭', '軽装', '軽装', 2, 'L', 25, null),
  ('2L:軽装鎧', '遊牧王の衣', '鎧', '軽装', '軽装', 2, 'L', 25, null),
  ('2L:軽装腕', '遊牧王の手袋', '腕', '軽装', '軽装', 2, 'L', 25, null),
  ('2L:軽装足', '遊牧王の靴', '足', '軽装', '軽装', 2, 'L', 25, null),
  ('2L:リング', '誓約の指輪', 'アクセ', 'リング', null, 2, 'L', 25, null),
  ('2L:イヤリング', '戦歌の耳飾り', 'アクセ', 'イヤリング', null, 2, 'L', 25, null),
  ('2L:ベルト', '覇者の帯', 'アクセ', 'ベルト', null, 2, 'L', 25, null),
  ('2L:ネックレス', '英霊の首飾り', 'アクセ', 'ネックレス', null, 2, 'L', 25, null),
  ('3N:片手剣', 'スチールソード', '武器', '片手剣', null, 3, 'N', 15, null),
  ('3N:両手剣', 'スチールクレイモア', '武器', '両手剣', null, 3, 'N', 15, null),
  ('3N:斧', 'スチールアクス', '武器', '斧', null, 3, 'N', 15, null),
  ('3N:槍', 'スチールスピア', '武器', '槍', null, 3, 'N', 15, null),
  ('3N:鈍器', 'スチールメイス', '武器', '鈍器', null, 3, 'N', 15, null),
  ('3N:短剣', 'スチールダガー', '武器', '短剣', null, 3, 'N', 15, null),
  ('3N:拳', 'スチールナックル', '武器', '拳', null, 3, 'N', 15, null),
  ('3N:弓', 'アッシュボウ', '武器', '弓', null, 3, 'N', 15, null),
  ('3N:銃', 'フリントロック', '武器', '銃', null, 3, 'N', 15, null),
  ('3N:杖', 'アッシュスタッフ', '武器', '杖', null, 3, 'N', 15, null),
  ('3N:書', '古写本', '武器', '書', null, 3, 'N', 15, null),
  ('3N:投擲', 'スチールチャクラム', '武器', '投擲', null, 3, 'N', 15, null),
  ('3N:刀', 'スチールカタナ', '武器', '刀', null, 3, 'N', 15, null),
  ('3N:宝珠', 'アメジストオーブ', '武器', '宝珠', null, 3, 'N', 15, null),
  ('3N:重鎧頭', 'スチールヘルム', '頭', '重鎧', '重鎧', 3, 'N', 15, null),
  ('3N:重鎧鎧', 'スチールメイル', '鎧', '重鎧', '重鎧', 3, 'N', 15, null),
  ('3N:重鎧腕', 'スチールガントレット', '腕', '重鎧', '重鎧', 3, 'N', 15, null),
  ('3N:重鎧足', 'スチールグリーヴ', '足', '重鎧', '重鎧', 3, 'N', 15, null),
  ('3N:軽装頭', 'ハードレザーフード', '頭', '軽装', '軽装', 3, 'N', 15, null),
  ('3N:軽装鎧', 'ハードレザーコート', '鎧', '軽装', '軽装', 3, 'N', 15, null),
  ('3N:軽装腕', 'ハードレザーグローブ', '腕', '軽装', '軽装', 3, 'N', 15, null),
  ('3N:軽装足', 'ハードレザーブーツ', '足', '軽装', '軽装', 3, 'N', 15, null),
  ('3N:リング', 'アメジストリング', 'アクセ', 'リング', null, 3, 'N', 15, null),
  ('3N:イヤリング', 'アメジストイヤリング', 'アクセ', 'イヤリング', null, 3, 'N', 15, null),
  ('3N:ベルト', 'アメジストベルト', 'アクセ', 'ベルト', null, 3, 'N', 15, null),
  ('3N:ネックレス', 'アメジストネックレス', 'アクセ', 'ネックレス', null, 3, 'N', 15, null),
  ('3R:片手剣', '刻印の剣', '武器', '片手剣', null, 3, 'R', 20, null),
  ('3R:両手剣', '骸骨騎士の大剣', '武器', '両手剣', null, 3, 'R', 20, null),
  ('3R:斧', '黒曜の斧', '武器', '斧', null, 3, 'R', 20, null),
  ('3R:槍', '石筍の槍', '武器', '槍', null, 3, 'R', 20, null),
  ('3R:鈍器', 'ゴーレムクラッシャー', '武器', '鈍器', null, 3, 'R', 20, null),
  ('3R:短剣', 'ファントムナイフ', '武器', '短剣', null, 3, 'R', 20, null),
  ('3R:拳', 'ガーゴイルクロー', '武器', '拳', null, 3, 'R', 20, null),
  ('3R:弓', 'ボーンボウ', '武器', '弓', null, 3, 'R', 20, null),
  ('3R:銃', 'からくり銃', '武器', '銃', null, 3, 'R', 20, null),
  ('3R:杖', '鍾乳石の杖', '武器', '杖', null, 3, 'R', 20, null),
  ('3R:書', '古代碑文集', '武器', '書', null, 3, 'R', 20, null),
  ('3R:投擲', '投石帯', '武器', '投擲', null, 3, 'R', 20, null),
  ('3R:刀', '骸武者の刀', '武器', '刀', null, 3, 'R', 20, null),
  ('3R:宝珠', '封印の水晶球', '武器', '宝珠', null, 3, 'R', 20, null),
  ('3R:重鎧頭', 'ガーディアンヘルム', '頭', '重鎧', '重鎧', 3, 'R', 20, null),
  ('3R:重鎧鎧', 'ガーディアンプレート', '鎧', '重鎧', '重鎧', 3, 'R', 20, null),
  ('3R:重鎧腕', 'ガーディアンガントレット', '腕', '重鎧', '重鎧', 3, 'R', 20, null),
  ('3R:重鎧足', 'ガーディアングリーヴ', '足', '重鎧', '重鎧', 3, 'R', 20, null),
  ('3R:軽装頭', '探索者の帽子', '頭', '軽装', '軽装', 3, 'R', 20, null),
  ('3R:軽装鎧', '探索者の外套', '鎧', '軽装', '軽装', 3, 'R', 20, null),
  ('3R:軽装腕', '探索者の手袋', '腕', '軽装', '軽装', 3, 'R', 20, null),
  ('3R:軽装足', '探索者の長靴', '足', '軽装', '軽装', 3, 'R', 20, null),
  ('3R:リング', '封印の指輪', 'アクセ', 'リング', null, 3, 'R', 20, null),
  ('3R:イヤリング', 'ソウルピアス', 'アクセ', 'イヤリング', null, 3, 'R', 20, null),
  ('3R:ベルト', '紋章ベルト', 'アクセ', 'ベルト', null, 3, 'R', 20, null),
  ('3R:ネックレス', '番人の護符', 'アクセ', 'ネックレス', null, 3, 'R', 20, null),
  ('3E:片手剣', '碑文の剣', '武器', '片手剣', null, 3, 'E', 25, null),
  ('3E:両手剣', '鍾乳の大剣', '武器', '両手剣', null, 3, 'E', 25, null),
  ('3E:斧', '石切りの斧', '武器', '斧', null, 3, 'E', 25, null),
  ('3E:槍', '水脈の槍', '武器', '槍', null, 3, 'E', 25, null),
  ('3E:鈍器', '封石の鎚', '武器', '鈍器', null, 3, 'E', 25, null),
  ('3E:短剣', '影石の短剣', '武器', '短剣', null, 3, 'E', 25, null),
  ('3E:拳', '岩窟の拳', '武器', '拳', null, 3, 'E', 25, null),
  ('3E:弓', '残響の弓', '武器', '弓', null, 3, 'E', 25, null),
  ('3E:銃', '古代式魔銃', '武器', '銃', null, 3, 'E', 25, null),
  ('3E:杖', '灯し火の杖', '武器', '杖', null, 3, 'E', 25, null),
  ('3E:書', '洞窟の写本', '武器', '書', null, 3, 'E', 25, null),
  ('3E:投擲', '紋様の円盤', '武器', '投擲', null, 3, 'E', 25, null),
  ('3E:刀', '岩清水', '武器', '刀', null, 3, 'E', 25, null),
  ('3E:宝珠', '地底湖の宝珠', '武器', '宝珠', null, 3, 'E', 25, null),
  ('3E:重鎧頭', '古岩の兜', '頭', '重鎧', '重鎧', 3, 'E', 25, null),
  ('3E:重鎧鎧', '古岩の鎧', '鎧', '重鎧', '重鎧', 3, 'E', 25, null),
  ('3E:重鎧腕', '古岩の篭手', '腕', '重鎧', '重鎧', 3, 'E', 25, null),
  ('3E:重鎧足', '古岩の具足', '足', '重鎧', '重鎧', 3, 'E', 25, null),
  ('3E:軽装頭', '刻印師の頭巾', '頭', '軽装', '軽装', 3, 'E', 25, null),
  ('3E:軽装鎧', '刻印師の衣', '鎧', '軽装', '軽装', 3, 'E', 25, null),
  ('3E:軽装腕', '刻印師の手袋', '腕', '軽装', '軽装', 3, 'E', 25, null),
  ('3E:軽装足', '刻印師の靴', '足', '軽装', '軽装', 3, 'E', 25, null),
  ('3E:リング', '古代文字の指輪', 'アクセ', 'リング', null, 3, 'E', 25, null),
  ('3E:イヤリング', '滴りの耳飾り', 'アクセ', 'イヤリング', null, 3, 'E', 25, null),
  ('3E:ベルト', '石室の鎖帯', 'アクセ', 'ベルト', null, 3, 'E', 25, null),
  ('3E:ネックレス', '黒石の首飾り', 'アクセ', 'ネックレス', null, 3, 'E', 25, null),
  ('3L:片手剣', '封剣セルディア', '武器', '片手剣', null, 3, 'L', 30, null),
  ('3L:両手剣', '巌窟王', '武器', '両手剣', null, 3, 'L', 30, null),
  ('3L:斧', '岩盤割り', '武器', '斧', null, 3, 'L', 30, null),
  ('3L:槍', '最奥の神槍', '武器', '槍', null, 3, 'L', 30, null),
  ('3L:鈍器', '巨石の神鎚', '武器', '鈍器', null, 3, 'L', 30, null),
  ('3L:短剣', '秘鍵', '武器', '短剣', null, 3, 'L', 30, null),
  ('3L:拳', '石神拳', '武器', '拳', null, 3, 'L', 30, null),
  ('3L:弓', '千年灯の弓', '武器', '弓', null, 3, 'L', 30, null),
  ('3L:銃', '失われた砲', '武器', '銃', null, 3, 'L', 30, null),
  ('3L:杖', '闇照らしの杖', '武器', '杖', null, 3, 'L', 30, null),
  ('3L:書', 'セルディア王国記', '武器', '書', null, 3, 'L', 30, null),
  ('3L:投擲', '刻の円環', '武器', '投擲', null, 3, 'L', 30, null),
  ('3L:刀', '千年封じ', '武器', '刀', null, 3, 'L', 30, null),
  ('3L:宝珠', '太古の瞳', '武器', '宝珠', null, 3, 'L', 30, null),
  ('3L:重鎧頭', '古代王の兜', '頭', '重鎧', '重鎧', 3, 'L', 30, null),
  ('3L:重鎧鎧', '古代王の鎧', '鎧', '重鎧', '重鎧', 3, 'L', 30, null),
  ('3L:重鎧腕', '古代王の篭手', '腕', '重鎧', '重鎧', 3, 'L', 30, null),
  ('3L:重鎧足', '古代王の具足', '足', '重鎧', '重鎧', 3, 'L', 30, null),
  ('3L:軽装頭', 'アルカナハット', '頭', '軽装', '軽装', 3, 'L', 30, null),
  ('3L:軽装鎧', 'アルカナローブ', '鎧', '軽装', '軽装', 3, 'L', 30, null),
  ('3L:軽装腕', 'アルカナグローブ', '腕', '軽装', '軽装', 3, 'L', 30, null),
  ('3L:軽装足', 'アルカナブーツ', '足', '軽装', '軽装', 3, 'L', 30, null),
  ('3L:リング', '王国の指輪', 'アクセ', 'リング', null, 3, 'L', 30, null),
  ('3L:イヤリング', '石の涙', 'アクセ', 'イヤリング', null, 3, 'L', 30, null),
  ('3L:ベルト', 'セルディアの帯', 'アクセ', 'ベルト', null, 3, 'L', 30, null),
  ('3L:ネックレス', '封印の核', 'アクセ', 'ネックレス', null, 3, 'L', 30, null),
  ('4N:片手剣', 'シルバーソード', '武器', '片手剣', null, 4, 'N', 20, null),
  ('4N:両手剣', 'シルバークレイモア', '武器', '両手剣', null, 4, 'N', 20, null),
  ('4N:斧', 'シルバーアクス', '武器', '斧', null, 4, 'N', 20, null),
  ('4N:槍', 'シルバースピア', '武器', '槍', null, 4, 'N', 20, null),
  ('4N:鈍器', 'シルバーメイス', '武器', '鈍器', null, 4, 'N', 20, null),
  ('4N:短剣', 'シルバーダガー', '武器', '短剣', null, 4, 'N', 20, null),
  ('4N:拳', 'シルバーナックル', '武器', '拳', null, 4, 'N', 20, null),
  ('4N:弓', 'ウォルナットボウ', '武器', '弓', null, 4, 'N', 20, null),
  ('4N:銃', 'ブランダーバス', '武器', '銃', null, 4, 'N', 20, null),
  ('4N:杖', 'ウォルナットスタッフ', '武器', '杖', null, 4, 'N', 20, null),
  ('4N:書', '術式書', '武器', '書', null, 4, 'N', 20, null),
  ('4N:投擲', 'シルバーチャクラム', '武器', '投擲', null, 4, 'N', 20, null),
  ('4N:刀', 'シルバーカタナ', '武器', '刀', null, 4, 'N', 20, null),
  ('4N:宝珠', 'パールオーブ', '武器', '宝珠', null, 4, 'N', 20, null),
  ('4N:重鎧頭', 'シルバーヘルム', '頭', '重鎧', '重鎧', 4, 'N', 20, null),
  ('4N:重鎧鎧', 'シルバーメイル', '鎧', '重鎧', '重鎧', 4, 'N', 20, null),
  ('4N:重鎧腕', 'シルバーガントレット', '腕', '重鎧', '重鎧', 4, 'N', 20, null),
  ('4N:重鎧足', 'シルバーグリーヴ', '足', '重鎧', '重鎧', 4, 'N', 20, null),
  ('4N:軽装頭', 'シルクフード', '頭', '軽装', '軽装', 4, 'N', 20, null),
  ('4N:軽装鎧', 'シルクコート', '鎧', '軽装', '軽装', 4, 'N', 20, null),
  ('4N:軽装腕', 'シルクグローブ', '腕', '軽装', '軽装', 4, 'N', 20, null),
  ('4N:軽装足', 'シルクブーツ', '足', '軽装', '軽装', 4, 'N', 20, null),
  ('4N:リング', 'パールリング', 'アクセ', 'リング', null, 4, 'N', 20, null),
  ('4N:イヤリング', 'パールイヤリング', 'アクセ', 'イヤリング', null, 4, 'N', 20, null),
  ('4N:ベルト', 'パールベルト', 'アクセ', 'ベルト', null, 4, 'N', 20, null),
  ('4N:ネックレス', 'パールネックレス', 'アクセ', 'ネックレス', null, 4, 'N', 20, null),
  ('4R:片手剣', '海賊刀', '武器', '片手剣', null, 4, 'R', 25, null),
  ('4R:両手剣', 'メイルストローム', '武器', '両手剣', null, 4, 'R', 25, null),
  ('4R:斧', 'ボーディングアクス', '武器', '斧', null, 4, 'R', 25, null),
  ('4R:槍', 'サハギントライデント', '武器', '槍', null, 4, 'R', 25, null),
  ('4R:鈍器', 'アンカーハンマー', '武器', '鈍器', null, 4, 'R', 25, null),
  ('4R:短剣', '鮫牙の短剣', '武器', '短剣', null, 4, 'R', 25, null),
  ('4R:拳', 'クラブクロー', '武器', '拳', null, 4, 'R', 25, null),
  ('4R:弓', 'セイレーンボウ', '武器', '弓', null, 4, 'R', 25, null),
  ('4R:銃', '船長の短銃', '武器', '銃', null, 4, 'R', 25, null),
  ('4R:杖', 'コーラルロッド', '武器', '杖', null, 4, 'R', 25, null),
  ('4R:書', '航海日誌', '武器', '書', null, 4, 'R', 25, null),
  ('4R:投擲', 'シェルチャクラム', '武器', '投擲', null, 4, 'R', 25, null),
  ('4R:刀', '潮風丸', '武器', '刀', null, 4, 'R', 25, null),
  ('4R:宝珠', '海鳴りの珠', '武器', '宝珠', null, 4, 'R', 25, null),
  ('4R:重鎧頭', 'コーラルヘルム', '頭', '重鎧', '重鎧', 4, 'R', 25, null),
  ('4R:重鎧鎧', 'コーラルメイル', '鎧', '重鎧', '重鎧', 4, 'R', 25, null),
  ('4R:重鎧腕', 'コーラルガントレット', '腕', '重鎧', '重鎧', 4, 'R', 25, null),
  ('4R:重鎧足', 'コーラルグリーヴ', '足', '重鎧', '重鎧', 4, 'R', 25, null),
  ('4R:軽装頭', 'パイレーツハット', '頭', '軽装', '軽装', 4, 'R', 25, null),
  ('4R:軽装鎧', 'パイレーツコート', '鎧', '軽装', '軽装', 4, 'R', 25, null),
  ('4R:軽装腕', 'パイレーツグローブ', '腕', '軽装', '軽装', 4, 'R', 25, null),
  ('4R:軽装足', 'パイレーツブーツ', '足', '軽装', '軽装', 4, 'R', 25, null),
  ('4R:リング', '潮騒の指輪', 'アクセ', 'リング', null, 4, 'R', 25, null),
  ('4R:イヤリング', '貝殻イヤリング', 'アクセ', 'イヤリング', null, 4, 'R', 25, null),
  ('4R:ベルト', '錨飾りのベルト', 'アクセ', 'ベルト', null, 4, 'R', 25, null),
  ('4R:ネックレス', '人魚の涙', 'アクセ', 'ネックレス', null, 4, 'R', 25, null),
  ('4E:片手剣', '浜風の剣', '武器', '片手剣', null, 4, 'E', 30, null),
  ('4E:両手剣', '海蝕洞の大剣', '武器', '両手剣', null, 4, 'E', 30, null),
  ('4E:斧', '船大工の斧', '武器', '斧', null, 4, 'E', 30, null),
  ('4E:槍', '潮騒の銛', '武器', '槍', null, 4, 'E', 30, null),
  ('4E:鈍器', '流木の棍', '武器', '鈍器', null, 4, 'E', 30, null),
  ('4E:短剣', '貝刃の短剣', '武器', '短剣', null, 4, 'E', 30, null),
  ('4E:拳', '荒波の拳', '武器', '拳', null, 4, 'E', 30, null),
  ('4E:弓', '灯台の弓', '武器', '弓', null, 4, 'E', 30, null),
  ('4E:銃', '沈没船の古砲', '武器', '銃', null, 4, 'E', 30, null),
  ('4E:杖', '入り江の杖', '武器', '杖', null, 4, 'E', 30, null),
  ('4E:書', '潮汐表', '武器', '書', null, 4, 'E', 30, null),
  ('4E:投擲', '難破船の舵輪', '武器', '投擲', null, 4, 'E', 30, null),
  ('4E:刀', '波返し', '武器', '刀', null, 4, 'E', 30, null),
  ('4E:宝珠', '渦潮の宝珠', '武器', '宝珠', null, 4, 'E', 30, null),
  ('4E:重鎧頭', '潮鉄の兜', '頭', '重鎧', '重鎧', 4, 'E', 30, null),
  ('4E:重鎧鎧', '潮鉄の鎧', '鎧', '重鎧', '重鎧', 4, 'E', 30, null),
  ('4E:重鎧腕', '潮鉄の篭手', '腕', '重鎧', '重鎧', 4, 'E', 30, null),
  ('4E:重鎧足', '潮鉄の具足', '足', '重鎧', '重鎧', 4, 'E', 30, null),
  ('4E:軽装頭', '白砂のハット', '頭', '軽装', '軽装', 4, 'E', 30, null),
  ('4E:軽装鎧', '白砂の衣', '鎧', '軽装', '軽装', 4, 'E', 30, null),
  ('4E:軽装腕', '白砂の手袋', '腕', '軽装', '軽装', 4, 'E', 30, null),
  ('4E:軽装足', '白砂のサンダル', '足', '軽装', '軽装', 4, 'E', 30, null),
  ('4E:リング', '漂流者の指輪', 'アクセ', 'リング', null, 4, 'E', 30, null),
  ('4E:イヤリング', '巻貝の耳飾り', 'アクセ', 'イヤリング', null, 4, 'E', 30, null),
  ('4E:ベルト', '帆綱の帯', 'アクセ', 'ベルト', null, 4, 'E', 30, null),
  ('4E:ネックレス', '星砂の首飾り', 'アクセ', 'ネックレス', null, 4, 'E', 30, null),
  ('4L:片手剣', '蒼海剣マリナ', '武器', '片手剣', null, 4, 'L', 35, null),
  ('4L:両手剣', '海割りの大剣', '武器', '両手剣', null, 4, 'L', 35, null),
  ('4L:斧', '大時化', '武器', '斧', null, 4, 'L', 35, null),
  ('4L:槍', '潮神槍ワダツミ', '武器', '槍', null, 4, 'L', 35, null),
  ('4L:鈍器', '千尋の錨', '武器', '鈍器', null, 4, 'L', 35, null),
  ('4L:短剣', '財宝の鍵', '武器', '短剣', null, 4, 'L', 35, null),
  ('4L:拳', '怒涛拳', '武器', '拳', null, 4, 'L', 35, null),
  ('4L:弓', '水平線の弓', '武器', '弓', null, 4, 'L', 35, null),
  ('4L:銃', '旗艦砲', '武器', '銃', null, 4, 'L', 35, null),
  ('4L:杖', '満ち引きの王杖', '武器', '杖', null, 4, 'L', 35, null),
  ('4L:書', '大航海記', '武器', '書', null, 4, 'L', 35, null),
  ('4L:投擲', '大渦輪', '武器', '投擲', null, 4, 'L', 35, null),
  ('4L:刀', '荒磯', '武器', '刀', null, 4, 'L', 35, null),
  ('4L:宝珠', '潮満珠', '武器', '宝珠', null, 4, 'L', 35, null),
  ('4L:重鎧頭', '海神の兜', '頭', '重鎧', '重鎧', 4, 'L', 35, null),
  ('4L:重鎧鎧', '海神の鎧', '鎧', '重鎧', '重鎧', 4, 'L', 35, null),
  ('4L:重鎧腕', '海神の篭手', '腕', '重鎧', '重鎧', 4, 'L', 35, null),
  ('4L:重鎧足', '海神の具足', '足', '重鎧', '重鎧', 4, 'L', 35, null),
  ('4L:軽装頭', '人魚姫のティアラ', '頭', '軽装', '軽装', 4, 'L', 35, null),
  ('4L:軽装鎧', '人魚姫のドレス', '鎧', '軽装', '軽装', 4, 'L', 35, null),
  ('4L:軽装腕', '人魚姫のグローブ', '腕', '軽装', '軽装', 4, 'L', 35, null),
  ('4L:軽装足', '人魚姫のサンダル', '足', '軽装', '軽装', 4, 'L', 35, null),
  ('4L:リング', '潮干の指輪', 'アクセ', 'リング', null, 4, 'L', 35, null),
  ('4L:イヤリング', '白真珠の耳飾り', 'アクセ', 'イヤリング', null, 4, 'L', 35, null),
  ('4L:ベルト', '七海の帯', 'アクセ', 'ベルト', null, 4, 'L', 35, null),
  ('4L:ネックレス', '蒼海の雫', 'アクセ', 'ネックレス', null, 4, 'L', 35, null),
  ('5N:片手剣', 'コバルトソード', '武器', '片手剣', null, 5, 'N', 25, null),
  ('5N:両手剣', 'コバルトクレイモア', '武器', '両手剣', null, 5, 'N', 25, null),
  ('5N:斧', 'コバルトアクス', '武器', '斧', null, 5, 'N', 25, null),
  ('5N:槍', 'コバルトスピア', '武器', '槍', null, 5, 'N', 25, null),
  ('5N:鈍器', 'コバルトメイス', '武器', '鈍器', null, 5, 'N', 25, null),
  ('5N:短剣', 'コバルトダガー', '武器', '短剣', null, 5, 'N', 25, null),
  ('5N:拳', 'コバルトナックル', '武器', '拳', null, 5, 'N', 25, null),
  ('5N:弓', 'エボニーボウ', '武器', '弓', null, 5, 'N', 25, null),
  ('5N:銃', 'カービン', '武器', '銃', null, 5, 'N', 25, null),
  ('5N:杖', 'エボニースタッフ', '武器', '杖', null, 5, 'N', 25, null),
  ('5N:書', '秘伝書', '武器', '書', null, 5, 'N', 25, null),
  ('5N:投擲', 'コバルトチャクラム', '武器', '投擲', null, 5, 'N', 25, null),
  ('5N:刀', 'コバルトカタナ', '武器', '刀', null, 5, 'N', 25, null),
  ('5N:宝珠', 'トパーズオーブ', '武器', '宝珠', null, 5, 'N', 25, null),
  ('5N:重鎧頭', 'コバルトヘルム', '頭', '重鎧', '重鎧', 5, 'N', 25, null),
  ('5N:重鎧鎧', 'コバルトメイル', '鎧', '重鎧', '重鎧', 5, 'N', 25, null),
  ('5N:重鎧腕', 'コバルトガントレット', '腕', '重鎧', '重鎧', 5, 'N', 25, null),
  ('5N:重鎧足', 'コバルトグリーヴ', '足', '重鎧', '重鎧', 5, 'N', 25, null),
  ('5N:軽装頭', 'リザードフード', '頭', '軽装', '軽装', 5, 'N', 25, null),
  ('5N:軽装鎧', 'リザードコート', '鎧', '軽装', '軽装', 5, 'N', 25, null),
  ('5N:軽装腕', 'リザードグローブ', '腕', '軽装', '軽装', 5, 'N', 25, null),
  ('5N:軽装足', 'リザードブーツ', '足', '軽装', '軽装', 5, 'N', 25, null),
  ('5N:リング', 'トパーズリング', 'アクセ', 'リング', null, 5, 'N', 25, null),
  ('5N:イヤリング', 'トパーズイヤリング', 'アクセ', 'イヤリング', null, 5, 'N', 25, null),
  ('5N:ベルト', 'トパーズベルト', 'アクセ', 'ベルト', null, 5, 'N', 25, null),
  ('5N:ネックレス', 'トパーズネックレス', 'アクセ', 'ネックレス', null, 5, 'N', 25, null),
  ('5R:片手剣', '陽炎のシャムシール', '武器', '片手剣', null, 5, 'R', 30, null),
  ('5R:両手剣', '砂皇の大剣', '武器', '両手剣', null, 5, 'R', 30, null),
  ('5R:斧', 'アヌビスの戦斧', '武器', '斧', null, 5, 'R', 30, null),
  ('5R:槍', '蠍尾の槍', '武器', '槍', null, 5, 'R', 30, null),
  ('5R:鈍器', 'ファラオセプター', '武器', '鈍器', null, 5, 'R', 30, null),
  ('5R:短剣', '砂蠍の毒針', '武器', '短剣', null, 5, 'R', 30, null),
  ('5R:拳', 'ジャッカルクロー', '武器', '拳', null, 5, 'R', 30, null),
  ('5R:弓', 'ミラージュボウ', '武器', '弓', null, 5, 'R', 30, null),
  ('5R:銃', '熱砂の長銃', '武器', '銃', null, 5, 'R', 30, null),
  ('5R:杖', 'アンクスタッフ', '武器', '杖', null, 5, 'R', 30, null),
  ('5R:書', '死者の書', '武器', '書', null, 5, 'R', 30, null),
  ('5R:投擲', '黄金日輪', '武器', '投擲', null, 5, 'R', 30, null),
  ('5R:刀', '砂紋の刀', '武器', '刀', null, 5, 'R', 30, null),
  ('5R:宝珠', '蜃気楼の珠', '武器', '宝珠', null, 5, 'R', 30, null),
  ('5R:重鎧頭', 'スカラベヘルム', '頭', '重鎧', '重鎧', 5, 'R', 30, null),
  ('5R:重鎧鎧', 'スカラベアーマー', '鎧', '重鎧', '重鎧', 5, 'R', 30, null),
  ('5R:重鎧腕', 'スカラベガントレット', '腕', '重鎧', '重鎧', 5, 'R', 30, null),
  ('5R:重鎧足', 'スカラベグリーヴ', '足', '重鎧', '重鎧', 5, 'R', 30, null),
  ('5R:軽装頭', '砂塵の頭巾', '頭', '軽装', '軽装', 5, 'R', 30, null),
  ('5R:軽装鎧', '砂塵の長衣', '鎧', '軽装', '軽装', 5, 'R', 30, null),
  ('5R:軽装腕', '砂塵の手袋', '腕', '軽装', '軽装', 5, 'R', 30, null),
  ('5R:軽装足', '砂塵の靴', '足', '軽装', '軽装', 5, 'R', 30, null),
  ('5R:リング', '王家の紋章指輪', 'アクセ', 'リング', null, 5, 'R', 30, null),
  ('5R:イヤリング', '月砂の耳飾り', 'アクセ', 'イヤリング', null, 5, 'R', 30, null),
  ('5R:ベルト', '王墓の飾り帯', 'アクセ', 'ベルト', null, 5, 'R', 30, null),
  ('5R:ネックレス', 'ウジャトの首飾り', 'アクセ', 'ネックレス', null, 5, 'R', 30, null),
  ('5E:片手剣', '砂丘の曲刀', '武器', '片手剣', null, 5, 'E', 35, null),
  ('5E:両手剣', '灼砂の大剣', '武器', '両手剣', null, 5, 'E', 35, null),
  ('5E:斧', '砂原の斧', '武器', '斧', null, 5, 'E', 35, null),
  ('5E:槍', '神殿柱の槍', '武器', '槍', null, 5, 'E', 35, null),
  ('5E:鈍器', '玄室の石鎚', '武器', '鈍器', null, 5, 'E', 35, null),
  ('5E:短剣', '熱風の短剣', '武器', '短剣', null, 5, 'E', 35, null),
  ('5E:拳', '焼け砂の拳', '武器', '拳', null, 5, 'E', 35, null),
  ('5E:弓', 'オアシスの弓', '武器', '弓', null, 5, 'E', 35, null),
  ('5E:銃', '遺丘の長銃', '武器', '銃', null, 5, 'E', 35, null),
  ('5E:杖', '祭司の杖', '武器', '杖', null, 5, 'E', 35, null),
  ('5E:書', '埋もれた祈祷書', '武器', '書', null, 5, 'E', 35, null),
  ('5E:投擲', '砂嵐の戦輪', '武器', '投擲', null, 5, 'E', 35, null),
  ('5E:刀', '炎陽丸', '武器', '刀', null, 5, 'E', 35, null),
  ('5E:宝珠', '太陽石の宝珠', '武器', '宝珠', null, 5, 'E', 35, null),
  ('5E:重鎧頭', '砂岩の兜', '頭', '重鎧', '重鎧', 5, 'E', 35, null),
  ('5E:重鎧鎧', '砂岩の鎧', '鎧', '重鎧', '重鎧', 5, 'E', 35, null),
  ('5E:重鎧腕', '砂岩の篭手', '腕', '重鎧', '重鎧', 5, 'E', 35, null),
  ('5E:重鎧足', '砂岩の具足', '足', '重鎧', '重鎧', 5, 'E', 35, null),
  ('5E:軽装頭', '隊商の頭巾', '頭', '軽装', '軽装', 5, 'E', 35, null),
  ('5E:軽装鎧', '隊商の長衣', '鎧', '軽装', '軽装', 5, 'E', 35, null),
  ('5E:軽装腕', '隊商の手袋', '腕', '軽装', '軽装', 5, 'E', 35, null),
  ('5E:軽装足', '隊商のサンダル', '足', '軽装', '軽装', 5, 'E', 35, null),
  ('5E:リング', '砂金の指輪', 'アクセ', 'リング', null, 5, 'E', 35, null),
  ('5E:イヤリング', '陽炎の耳飾り', 'アクセ', 'イヤリング', null, 5, 'E', 35, null),
  ('5E:ベルト', '黄金の腰帯', 'アクセ', 'ベルト', null, 5, 'E', 35, null),
  ('5E:ネックレス', '砂漠の薔薇', 'アクセ', 'ネックレス', null, 5, 'E', 35, null),
  ('5L:片手剣', '黄金剣ソラリス', '武器', '片手剣', null, 5, 'L', 40, null),
  ('5L:両手剣', '灼熱の審判', '武器', '両手剣', null, 5, 'L', 40, null),
  ('5L:斧', '砂海割り', '武器', '斧', null, 5, 'L', 40, null),
  ('5L:槍', '日輪神槍', '武器', '槍', null, 5, 'L', 40, null),
  ('5L:鈍器', '天秤の神鎚', '武器', '鈍器', null, 5, 'L', 40, null),
  ('5L:短剣', '王家の呪い', '武器', '短剣', null, 5, 'L', 40, null),
  ('5L:拳', '砂塵拳', '武器', '拳', null, 5, 'L', 40, null),
  ('5L:弓', '太陽を射る弓', '武器', '弓', null, 5, 'L', 40, null),
  ('5L:銃', '灼光砲', '武器', '銃', null, 5, 'L', 40, null),
  ('5L:杖', '死者の王杖', '武器', '杖', null, 5, 'L', 40, null),
  ('5L:書', '砂の王国記', '武器', '書', null, 5, 'L', 40, null),
  ('5L:投擲', '天日の円盤', '武器', '投擲', null, 5, 'L', 40, null),
  ('5L:刀', '炎天', '武器', '刀', null, 5, 'L', 40, null),
  ('5L:宝珠', 'ラーの瞳', '武器', '宝珠', null, 5, 'L', 40, null),
  ('5L:重鎧頭', '太陽王の兜', '頭', '重鎧', '重鎧', 5, 'L', 40, null),
  ('5L:重鎧鎧', '太陽王の鎧', '鎧', '重鎧', '重鎧', 5, 'L', 40, null),
  ('5L:重鎧腕', '太陽王の篭手', '腕', '重鎧', '重鎧', 5, 'L', 40, null),
  ('5L:重鎧足', '太陽王の具足', '足', '重鎧', '重鎧', 5, 'L', 40, null),
  ('5L:軽装頭', '砂の女王の冠', '頭', '軽装', '軽装', 5, 'L', 40, null),
  ('5L:軽装鎧', '砂の女王の長衣', '鎧', '軽装', '軽装', 5, 'L', 40, null),
  ('5L:軽装腕', '砂の女王の手甲', '腕', '軽装', '軽装', 5, 'L', 40, null),
  ('5L:軽装足', '砂の女王の履', '足', '軽装', '軽装', 5, 'L', 40, null),
  ('5L:リング', '黄金郷の指輪', 'アクセ', 'リング', null, 5, 'L', 40, null),
  ('5L:イヤリング', '蜃気楼の耳飾り', 'アクセ', 'イヤリング', null, 5, 'L', 40, null),
  ('5L:ベルト', '王の葬帯', 'アクセ', 'ベルト', null, 5, 'L', 40, null),
  ('5L:ネックレス', '永遠の命', 'アクセ', 'ネックレス', null, 5, 'L', 40, null),
  ('6N:片手剣', 'ダマスカスソード', '武器', '片手剣', null, 6, 'N', 30, null),
  ('6N:両手剣', 'ダマスカスクレイモア', '武器', '両手剣', null, 6, 'N', 30, null),
  ('6N:斧', 'ダマスカスアクス', '武器', '斧', null, 6, 'N', 30, null),
  ('6N:槍', 'ダマスカススピア', '武器', '槍', null, 6, 'N', 30, null),
  ('6N:鈍器', 'ダマスカスメイス', '武器', '鈍器', null, 6, 'N', 30, null),
  ('6N:短剣', 'ダマスカスダガー', '武器', '短剣', null, 6, 'N', 30, null),
  ('6N:拳', 'ダマスカスナックル', '武器', '拳', null, 6, 'N', 30, null),
  ('6N:弓', 'エルダーボウ', '武器', '弓', null, 6, 'N', 30, null),
  ('6N:銃', 'リボルバー', '武器', '銃', null, 6, 'N', 30, null),
  ('6N:杖', 'エルダースタッフ', '武器', '杖', null, 6, 'N', 30, null),
  ('6N:書', '魔導書', '武器', '書', null, 6, 'N', 30, null),
  ('6N:投擲', 'ダマスカスチャクラム', '武器', '投擲', null, 6, 'N', 30, null),
  ('6N:刀', 'ダマスカスカタナ', '武器', '刀', null, 6, 'N', 30, null),
  ('6N:宝珠', 'ガーネットオーブ', '武器', '宝珠', null, 6, 'N', 30, null),
  ('6N:重鎧頭', 'ダマスカスヘルム', '頭', '重鎧', '重鎧', 6, 'N', 30, null),
  ('6N:重鎧鎧', 'ダマスカスメイル', '鎧', '重鎧', '重鎧', 6, 'N', 30, null),
  ('6N:重鎧腕', 'ダマスカスガントレット', '腕', '重鎧', '重鎧', 6, 'N', 30, null),
  ('6N:重鎧足', 'ダマスカスグリーヴ', '足', '重鎧', '重鎧', 6, 'N', 30, null),
  ('6N:軽装頭', 'ワイバーンフード', '頭', '軽装', '軽装', 6, 'N', 30, null),
  ('6N:軽装鎧', 'ワイバーンコート', '鎧', '軽装', '軽装', 6, 'N', 30, null),
  ('6N:軽装腕', 'ワイバーングローブ', '腕', '軽装', '軽装', 6, 'N', 30, null),
  ('6N:軽装足', 'ワイバーンブーツ', '足', '軽装', '軽装', 6, 'N', 30, null),
  ('6N:リング', 'ガーネットリング', 'アクセ', 'リング', null, 6, 'N', 30, null),
  ('6N:イヤリング', 'ガーネットイヤリング', 'アクセ', 'イヤリング', null, 6, 'N', 30, null),
  ('6N:ベルト', 'ガーネットベルト', 'アクセ', 'ベルト', null, 6, 'N', 30, null),
  ('6N:ネックレス', 'ガーネットネックレス', 'アクセ', 'ネックレス', null, 6, 'N', 30, null),
  ('6R:片手剣', '疾風剣', '武器', '片手剣', null, 6, 'R', 35, null),
  ('6R:両手剣', 'トロールスレイヤー', '武器', '両手剣', null, 6, 'R', 35, null),
  ('6R:斧', '岩砕き斧', '武器', '斧', null, 6, 'R', 35, null),
  ('6R:槍', '峰突きの槍', '武器', '槍', null, 6, 'R', 35, null),
  ('6R:鈍器', '巨人の棍棒', '武器', '鈍器', null, 6, 'R', 35, null),
  ('6R:短剣', 'タロンダガー', '武器', '短剣', null, 6, 'R', 35, null),
  ('6R:拳', '剛猿の拳', '武器', '拳', null, 6, 'R', 35, null),
  ('6R:弓', '天衝く長弓', '武器', '弓', null, 6, 'R', 35, null),
  ('6R:銃', '鷹の目', '武器', '銃', null, 6, 'R', 35, null),
  ('6R:杖', 'クラウドピアサー', '武器', '杖', null, 6, 'R', 35, null),
  ('6R:書', '峰々の巡礼記', '武器', '書', null, 6, 'R', 35, null),
  ('6R:投擲', '風切り羽', '武器', '投擲', null, 6, 'R', 35, null),
  ('6R:刀', '山颪', '武器', '刀', null, 6, 'R', 35, null),
  ('6R:宝珠', '山彦の珠', '武器', '宝珠', null, 6, 'R', 35, null),
  ('6R:重鎧頭', '峠守の兜', '頭', '重鎧', '重鎧', 6, 'R', 35, null),
  ('6R:重鎧鎧', '峠守の鎧', '鎧', '重鎧', '重鎧', 6, 'R', 35, null),
  ('6R:重鎧腕', '峠守の篭手', '腕', '重鎧', '重鎧', 6, 'R', 35, null),
  ('6R:重鎧足', '峠守の具足', '足', '重鎧', '重鎧', 6, 'R', 35, null),
  ('6R:軽装頭', 'グリフォンフード', '頭', '軽装', '軽装', 6, 'R', 35, null),
  ('6R:軽装鎧', 'グリフォンジャケット', '鎧', '軽装', '軽装', 6, 'R', 35, null),
  ('6R:軽装腕', 'グリフォングローブ', '腕', '軽装', '軽装', 6, 'R', 35, null),
  ('6R:軽装足', 'グリフォンブーツ', '足', '軽装', '軽装', 6, 'R', 35, null),
  ('6R:リング', 'イーグルアイリング', 'アクセ', 'リング', null, 6, 'R', 35, null),
  ('6R:イヤリング', '風哭きの耳飾り', 'アクセ', 'イヤリング', null, 6, 'R', 35, null),
  ('6R:ベルト', 'クライマーベルト', 'アクセ', 'ベルト', null, 6, 'R', 35, null),
  ('6R:ネックレス', '熊爪の首飾り', 'アクセ', 'ネックレス', null, 6, 'R', 35, null),
  ('6E:片手剣', '尾根の剣', '武器', '片手剣', null, 6, 'E', 40, null),
  ('6E:両手剣', '山塊の大剣', '武器', '両手剣', null, 6, 'E', 40, null),
  ('6E:斧', '落石の斧', '武器', '斧', null, 6, 'E', 40, null),
  ('6E:槍', '登攀の槍', '武器', '槍', null, 6, 'E', 40, null),
  ('6E:鈍器', '大岩の鎚', '武器', '鈍器', null, 6, 'E', 40, null),
  ('6E:短剣', '風哭きの短剣', '武器', '短剣', null, 6, 'E', 40, null),
  ('6E:拳', '岩肌の拳', '武器', '拳', null, 6, 'E', 40, null),
  ('6E:弓', '山鳥の弓', '武器', '弓', null, 6, 'E', 40, null),
  ('6E:銃', '岩陰の狙撃銃', '武器', '銃', null, 6, 'E', 40, null),
  ('6E:杖', '山道の杖', '武器', '杖', null, 6, 'E', 40, null),
  ('6E:書', '山の道しるべ', '武器', '書', null, 6, 'E', 40, null),
  ('6E:投擲', '峰風の輪', '武器', '投擲', null, 6, 'E', 40, null),
  ('6E:刀', '岩燕', '武器', '刀', null, 6, 'E', 40, null),
  ('6E:宝珠', '雲間の宝珠', '武器', '宝珠', null, 6, 'E', 40, null),
  ('6E:重鎧頭', '山岳兵の兜', '頭', '重鎧', '重鎧', 6, 'E', 40, null),
  ('6E:重鎧鎧', '山岳兵の鎧', '鎧', '重鎧', '重鎧', 6, 'E', 40, null),
  ('6E:重鎧腕', '山岳兵の篭手', '腕', '重鎧', '重鎧', 6, 'E', 40, null),
  ('6E:重鎧足', '山岳兵の具足', '足', '重鎧', '重鎧', 6, 'E', 40, null),
  ('6E:軽装頭', '峠越えの頭巾', '頭', '軽装', '軽装', 6, 'E', 40, null),
  ('6E:軽装鎧', '峠越えの外套', '鎧', '軽装', '軽装', 6, 'E', 40, null),
  ('6E:軽装腕', '峠越えの手袋', '腕', '軽装', '軽装', 6, 'E', 40, null),
  ('6E:軽装足', '峠越えの靴', '足', '軽装', '軽装', 6, 'E', 40, null),
  ('6E:リング', '山頂の指輪', 'アクセ', 'リング', null, 6, 'E', 40, null),
  ('6E:イヤリング', '雪割草の耳飾り', 'アクセ', 'イヤリング', null, 6, 'E', 40, null),
  ('6E:ベルト', 'ザイルの帯', 'アクセ', 'ベルト', null, 6, 'E', 40, null),
  ('6E:ネックレス', '天頂石の首飾り', 'アクセ', 'ネックレス', null, 6, 'E', 40, null),
  ('6L:片手剣', '山神剣オロス', '武器', '片手剣', null, 6, 'L', 45, null),
  ('6L:両手剣', '天衝の大剣', '武器', '両手剣', null, 6, 'L', 45, null),
  ('6L:斧', '岩山割り', '武器', '斧', null, 6, 'L', 45, null),
  ('6L:槍', '天柱', '武器', '槍', null, 6, 'L', 45, null),
  ('6L:鈍器', '地響き', '武器', '鈍器', null, 6, 'L', 45, null),
  ('6L:短剣', '雲裂き', '武器', '短剣', null, 6, 'L', 45, null),
  ('6L:拳', '不動拳', '武器', '拳', null, 6, 'L', 45, null),
  ('6L:弓', '天翔ける弓', '武器', '弓', null, 6, 'L', 45, null),
  ('6L:銃', '山津波', '武器', '銃', null, 6, 'L', 45, null),
  ('6L:杖', '雲上の大杖', '武器', '杖', null, 6, 'L', 45, null),
  ('6L:書', '巨人の系譜', '武器', '書', null, 6, 'L', 45, null),
  ('6L:投擲', '烈風輪', '武器', '投擲', null, 6, 'L', 45, null),
  ('6L:刀', '天険', '武器', '刀', null, 6, 'L', 45, null),
  ('6L:宝珠', '巨峰の魂', '武器', '宝珠', null, 6, 'L', 45, null),
  ('6L:重鎧頭', '天嶺の兜', '頭', '重鎧', '重鎧', 6, 'L', 45, null),
  ('6L:重鎧鎧', '天嶺の鎧', '鎧', '重鎧', '重鎧', 6, 'L', 45, null),
  ('6L:重鎧腕', '天嶺の篭手', '腕', '重鎧', '重鎧', 6, 'L', 45, null),
  ('6L:重鎧足', '天嶺の具足', '足', '重鎧', '重鎧', 6, 'L', 45, null),
  ('6L:軽装頭', '風神の冠', '頭', '軽装', '軽装', 6, 'L', 45, null),
  ('6L:軽装鎧', '風神の羽衣', '鎧', '軽装', '軽装', 6, 'L', 45, null),
  ('6L:軽装腕', '風神の手甲', '腕', '軽装', '軽装', 6, 'L', 45, null),
  ('6L:軽装足', '風神の靴', '足', '軽装', '軽装', 6, 'L', 45, null),
  ('6L:リング', '登頂の指輪', 'アクセ', 'リング', null, 6, 'L', 45, null),
  ('6L:イヤリング', '高嶺の花', 'アクセ', 'イヤリング', null, 6, 'L', 45, null),
  ('6L:ベルト', '峰々の大帯', 'アクセ', 'ベルト', null, 6, 'L', 45, null),
  ('6L:ネックレス', '巨人の涙', 'アクセ', 'ネックレス', null, 6, 'L', 45, null),
  ('7N:片手剣', 'プラチナソード', '武器', '片手剣', null, 7, 'N', 35, null),
  ('7N:両手剣', 'プラチナクレイモア', '武器', '両手剣', null, 7, 'N', 35, null),
  ('7N:斧', 'プラチナアクス', '武器', '斧', null, 7, 'N', 35, null),
  ('7N:槍', 'プラチナスピア', '武器', '槍', null, 7, 'N', 35, null),
  ('7N:鈍器', 'プラチナメイス', '武器', '鈍器', null, 7, 'N', 35, null),
  ('7N:短剣', 'プラチナダガー', '武器', '短剣', null, 7, 'N', 35, null),
  ('7N:拳', 'プラチナナックル', '武器', '拳', null, 7, 'N', 35, null),
  ('7N:弓', 'トレントボウ', '武器', '弓', null, 7, 'N', 35, null),
  ('7N:銃', 'ライフル', '武器', '銃', null, 7, 'N', 35, null),
  ('7N:杖', 'トレントスタッフ', '武器', '杖', null, 7, 'N', 35, null),
  ('7N:書', '大魔導書', '武器', '書', null, 7, 'N', 35, null),
  ('7N:投擲', 'プラチナチャクラム', '武器', '投擲', null, 7, 'N', 35, null),
  ('7N:刀', 'プラチナカタナ', '武器', '刀', null, 7, 'N', 35, null),
  ('7N:宝珠', 'エメラルドオーブ', '武器', '宝珠', null, 7, 'N', 35, null),
  ('7N:重鎧頭', 'プラチナヘルム', '頭', '重鎧', '重鎧', 7, 'N', 35, null),
  ('7N:重鎧鎧', 'プラチナメイル', '鎧', '重鎧', '重鎧', 7, 'N', 35, null),
  ('7N:重鎧腕', 'プラチナガントレット', '腕', '重鎧', '重鎧', 7, 'N', 35, null),
  ('7N:重鎧足', 'プラチナグリーヴ', '足', '重鎧', '重鎧', 7, 'N', 35, null),
  ('7N:軽装頭', 'エルヴンフード', '頭', '軽装', '軽装', 7, 'N', 35, null),
  ('7N:軽装鎧', 'エルヴンコート', '鎧', '軽装', '軽装', 7, 'N', 35, null),
  ('7N:軽装腕', 'エルヴングローブ', '腕', '軽装', '軽装', 7, 'N', 35, null),
  ('7N:軽装足', 'エルヴンブーツ', '足', '軽装', '軽装', 7, 'N', 35, null),
  ('7N:リング', 'エメラルドリング', 'アクセ', 'リング', null, 7, 'N', 35, null),
  ('7N:イヤリング', 'エメラルドイヤリング', 'アクセ', 'イヤリング', null, 7, 'N', 35, null),
  ('7N:ベルト', 'エメラルドベルト', 'アクセ', 'ベルト', null, 7, 'N', 35, null),
  ('7N:ネックレス', 'エメラルドネックレス', 'アクセ', 'ネックレス', null, 7, 'N', 35, null),
  ('7R:片手剣', '黄昏の剣', '武器', '片手剣', null, 7, 'R', 40, null),
  ('7R:両手剣', 'ナイトフォール', '武器', '両手剣', null, 7, 'R', 40, null),
  ('7R:斧', 'ウッドイーター', '武器', '斧', null, 7, 'R', 40, null),
  ('7R:槍', 'ソーンランス', '武器', '槍', null, 7, 'R', 40, null),
  ('7R:鈍器', '樹王の棍', '武器', '鈍器', null, 7, 'R', 40, null),
  ('7R:短剣', '毒鱗の短剣', '武器', '短剣', null, 7, 'R', 40, null),
  ('7R:拳', 'ビートルホーン', '武器', '拳', null, 7, 'R', 40, null),
  ('7R:弓', '惑わしの弓', '武器', '弓', null, 7, 'R', 40, null),
  ('7R:銃', 'バンシーハウル', '武器', '銃', null, 7, 'R', 40, null),
  ('7R:杖', '霧魔女の杖', '武器', '杖', null, 7, 'R', 40, null),
  ('7R:書', '毒草図鑑', '武器', '書', null, 7, 'R', 40, null),
  ('7R:投擲', '胞子玉', '武器', '投擲', null, 7, 'R', 40, null),
  ('7R:刀', '宵闇丸', '武器', '刀', null, 7, 'R', 40, null),
  ('7R:宝珠', '惑い霧の珠', '武器', '宝珠', null, 7, 'R', 40, null),
  ('7R:重鎧頭', 'ブラックウッドヘルム', '頭', '重鎧', '重鎧', 7, 'R', 40, null),
  ('7R:重鎧鎧', 'ブラックウッドメイル', '鎧', '重鎧', '重鎧', 7, 'R', 40, null),
  ('7R:重鎧腕', 'ブラックウッドガントレット', '腕', '重鎧', '重鎧', 7, 'R', 40, null),
  ('7R:重鎧足', 'ブラックウッドグリーヴ', '足', '重鎧', '重鎧', 7, 'R', 40, null),
  ('7R:軽装頭', '常夜の頭巾', '頭', '軽装', '軽装', 7, 'R', 40, null),
  ('7R:軽装鎧', '常夜の外套', '鎧', '軽装', '軽装', 7, 'R', 40, null),
  ('7R:軽装腕', '常夜の手袋', '腕', '軽装', '軽装', 7, 'R', 40, null),
  ('7R:軽装足', '常夜の靴', '足', '軽装', '軽装', 7, 'R', 40, null),
  ('7R:リング', 'ピクシーリング', 'アクセ', 'リング', null, 7, 'R', 40, null),
  ('7R:イヤリング', '嘆きの耳飾り', 'アクセ', 'イヤリング', null, 7, 'R', 40, null),
  ('7R:ベルト', 'ルーツベルト', 'アクセ', 'ベルト', null, 7, 'R', 40, null),
  ('7R:ネックレス', 'マンドラゴラの護符', 'アクセ', 'ネックレス', null, 7, 'R', 40, null),
  ('7E:片手剣', '迷い森の剣', '武器', '片手剣', null, 7, 'E', 45, null),
  ('7E:両手剣', '常闇の大剣', '武器', '両手剣', null, 7, 'E', 45, null),
  ('7E:斧', '大樹伐りの斧', '武器', '斧', null, 7, 'E', 45, null),
  ('7E:槍', '絡み蔓の槍', '武器', '槍', null, 7, 'E', 45, null),
  ('7E:鈍器', '樹瘤の鎚', '武器', '鈍器', null, 7, 'E', 45, null),
  ('7E:短剣', '霧隠れの短剣', '武器', '短剣', null, 7, 'E', 45, null),
  ('7E:拳', '根張りの拳', '武器', '拳', null, 7, 'E', 45, null),
  ('7E:弓', '薄明の弓', '武器', '弓', null, 7, 'E', 45, null),
  ('7E:銃', '夜狩りの銃', '武器', '銃', null, 7, 'E', 45, null),
  ('7E:杖', '朽ち木の杖', '武器', '杖', null, 7, 'E', 45, null),
  ('7E:書', '樹海の手記', '武器', '書', null, 7, 'E', 45, null),
  ('7E:投擲', '迷路の戦輪', '武器', '投擲', null, 7, 'E', 45, null),
  ('7E:刀', '夜霧丸', '武器', '刀', null, 7, 'E', 45, null),
  ('7E:宝珠', '夕闇の宝珠', '武器', '宝珠', null, 7, 'E', 45, null),
  ('7E:重鎧頭', '闇樫の兜', '頭', '重鎧', '重鎧', 7, 'E', 45, null),
  ('7E:重鎧鎧', '闇樫の鎧', '鎧', '重鎧', '重鎧', 7, 'E', 45, null),
  ('7E:重鎧腕', '闇樫の篭手', '腕', '重鎧', '重鎧', 7, 'E', 45, null),
  ('7E:重鎧足', '闇樫の具足', '足', '重鎧', '重鎧', 7, 'E', 45, null),
  ('7E:軽装頭', '霧織りの頭巾', '頭', '軽装', '軽装', 7, 'E', 45, null),
  ('7E:軽装鎧', '霧織りの外套', '鎧', '軽装', '軽装', 7, 'E', 45, null),
  ('7E:軽装腕', '霧織りの手袋', '腕', '軽装', '軽装', 7, 'E', 45, null),
  ('7E:軽装足', '霧織りの靴', '足', '軽装', '軽装', 7, 'E', 45, null),
  ('7E:リング', '迷い人の指輪', 'アクセ', 'リング', null, 7, 'E', 45, null),
  ('7E:イヤリング', '蛍火の耳飾り', 'アクセ', 'イヤリング', null, 7, 'E', 45, null),
  ('7E:ベルト', '宿り木の帯', 'アクセ', 'ベルト', null, 7, 'E', 45, null),
  ('7E:ネックレス', '境界の鈴', 'アクセ', 'ネックレス', null, 7, 'E', 45, null),
  ('7L:片手剣', '夜神剣ニュクス', '武器', '片手剣', null, 7, 'L', 50, null),
  ('7L:両手剣', '光喰らい', '武器', '両手剣', null, 7, 'L', 50, null),
  ('7L:斧', '闇伐りの神斧', '武器', '斧', null, 7, 'L', 50, null),
  ('7L:槍', '黄昏の神槍', '武器', '槍', null, 7, 'L', 50, null),
  ('7L:鈍器', '永夜の鎚', '武器', '鈍器', null, 7, 'L', 50, null),
  ('7L:短剣', '新月', '武器', '短剣', null, 7, 'L', 50, null),
  ('7L:拳', '無明拳', '武器', '拳', null, 7, 'L', 50, null),
  ('7L:弓', '明けの明星', '武器', '弓', null, 7, 'L', 50, null),
  ('7L:銃', '黎明砲', '武器', '銃', null, 7, 'L', 50, null),
  ('7L:杖', '大樹の霊杖', '武器', '杖', null, 7, 'L', 50, null),
  ('7L:書', '常闇の禁書', '武器', '書', null, 7, 'L', 50, null),
  ('7L:投擲', '無限回廊', '武器', '投擲', null, 7, 'L', 50, null),
  ('7L:刀', '夜桜', '武器', '刀', null, 7, 'L', 50, null),
  ('7L:宝珠', '月蝕の宝珠', '武器', '宝珠', null, 7, 'L', 50, null),
  ('7L:重鎧頭', '樹海王の兜', '頭', '重鎧', '重鎧', 7, 'L', 50, null),
  ('7L:重鎧鎧', '樹海王の鎧', '鎧', '重鎧', '重鎧', 7, 'L', 50, null),
  ('7L:重鎧腕', '樹海王の篭手', '腕', '重鎧', '重鎧', 7, 'L', 50, null),
  ('7L:重鎧足', '樹海王の具足', '足', '重鎧', '重鎧', 7, 'L', 50, null),
  ('7L:軽装頭', '夜の女王の冠', '頭', '軽装', '軽装', 7, 'L', 50, null),
  ('7L:軽装鎧', '夜の女王のドレス', '鎧', '軽装', '軽装', 7, 'L', 50, null),
  ('7L:軽装腕', '夜の女王の手袋', '腕', '軽装', '軽装', 7, 'L', 50, null),
  ('7L:軽装足', '夜の女王の靴', '足', '軽装', '軽装', 7, 'L', 50, null),
  ('7L:リング', '夢路の指輪', 'アクセ', 'リング', null, 7, 'L', 50, null),
  ('7L:イヤリング', '月下の囁き', 'アクセ', 'イヤリング', null, 7, 'L', 50, null),
  ('7L:ベルト', '大蔓の帯', 'アクセ', 'ベルト', null, 7, 'L', 50, null),
  ('7L:ネックレス', '最後の光', 'アクセ', 'ネックレス', null, 7, 'L', 50, null),
  ('8N:片手剣', 'ミスリルソード', '武器', '片手剣', null, 8, 'N', 40, null),
  ('8N:両手剣', 'ミスリルクレイモア', '武器', '両手剣', null, 8, 'N', 40, null),
  ('8N:斧', 'ミスリルアクス', '武器', '斧', null, 8, 'N', 40, null),
  ('8N:槍', 'ミスリルスピア', '武器', '槍', null, 8, 'N', 40, null),
  ('8N:鈍器', 'ミスリルメイス', '武器', '鈍器', null, 8, 'N', 40, null),
  ('8N:短剣', 'ミスリルダガー', '武器', '短剣', null, 8, 'N', 40, null),
  ('8N:拳', 'ミスリルナックル', '武器', '拳', null, 8, 'N', 40, null),
  ('8N:弓', 'ミスリルボウ', '武器', '弓', null, 8, 'N', 40, null),
  ('8N:銃', 'ミスリルマグナム', '武器', '銃', null, 8, 'N', 40, null),
  ('8N:杖', 'ミスリルスタッフ', '武器', '杖', null, 8, 'N', 40, null),
  ('8N:書', '禁書', '武器', '書', null, 8, 'N', 40, null),
  ('8N:投擲', 'ミスリルチャクラム', '武器', '投擲', null, 8, 'N', 40, null),
  ('8N:刀', 'ミスリルカタナ', '武器', '刀', null, 8, 'N', 40, null),
  ('8N:宝珠', 'ムーンストーンオーブ', '武器', '宝珠', null, 8, 'N', 40, null),
  ('8N:重鎧頭', 'ミスリルヘルム', '頭', '重鎧', '重鎧', 8, 'N', 40, null),
  ('8N:重鎧鎧', 'ミスリルメイル', '鎧', '重鎧', '重鎧', 8, 'N', 40, null),
  ('8N:重鎧腕', 'ミスリルガントレット', '腕', '重鎧', '重鎧', 8, 'N', 40, null),
  ('8N:重鎧足', 'ミスリルグリーヴ', '足', '重鎧', '重鎧', 8, 'N', 40, null),
  ('8N:軽装頭', 'ミスリルフード', '頭', '軽装', '軽装', 8, 'N', 40, null),
  ('8N:軽装鎧', 'ミスリルコート', '鎧', '軽装', '軽装', 8, 'N', 40, null),
  ('8N:軽装腕', 'ミスリルグローブ', '腕', '軽装', '軽装', 8, 'N', 40, null),
  ('8N:軽装足', 'ミスリルブーツ', '足', '軽装', '軽装', 8, 'N', 40, null),
  ('8N:リング', 'ムーンストーンリング', 'アクセ', 'リング', null, 8, 'N', 40, null),
  ('8N:イヤリング', 'ムーンストーンイヤリング', 'アクセ', 'イヤリング', null, 8, 'N', 40, null),
  ('8N:ベルト', 'ムーンストーンベルト', 'アクセ', 'ベルト', null, 8, 'N', 40, null),
  ('8N:ネックレス', 'ムーンストーンネックレス', 'アクセ', 'ネックレス', null, 8, 'N', 40, null),
  ('8R:片手剣', 'フロストエッジ', '武器', '片手剣', null, 8, 'R', 45, null),
  ('8R:両手剣', '氷牙大剣', '武器', '両手剣', null, 8, 'R', 45, null),
  ('8R:斧', 'アバランチ', '武器', '斧', null, 8, 'R', 45, null),
  ('8R:槍', '樹氷の槍', '武器', '槍', null, 8, 'R', 45, null),
  ('8R:鈍器', '氷塊の鎚', '武器', '鈍器', null, 8, 'R', 45, null),
  ('8R:短剣', 'つらら刺し', '武器', '短剣', null, 8, 'R', 45, null),
  ('8R:拳', '雪豹の爪', '武器', '拳', null, 8, 'R', 45, null),
  ('8R:弓', '銀嶺の弓', '武器', '弓', null, 8, 'R', 45, null),
  ('8R:銃', '氷結砲', '武器', '銃', null, 8, 'R', 45, null),
  ('8R:杖', '霊峰の錫杖', '武器', '杖', null, 8, 'R', 45, null),
  ('8R:書', '凍れる魔導書', '武器', '書', null, 8, 'R', 45, null),
  ('8R:投擲', '六花の飛刃', '武器', '投擲', null, 8, 'R', 45, null),
  ('8R:刀', '霜月', '武器', '刀', null, 8, 'R', 45, null),
  ('8R:宝珠', '氷晶球', '武器', '宝珠', null, 8, 'R', 45, null),
  ('8R:重鎧頭', 'グレイシアヘルム', '頭', '重鎧', '重鎧', 8, 'R', 45, null),
  ('8R:重鎧鎧', 'グレイシアメイル', '鎧', '重鎧', '重鎧', 8, 'R', 45, null),
  ('8R:重鎧腕', 'グレイシアガントレット', '腕', '重鎧', '重鎧', 8, 'R', 45, null),
  ('8R:重鎧足', 'グレイシアグリーヴ', '足', '重鎧', '重鎧', 8, 'R', 45, null),
  ('8R:軽装頭', '白狼頭巾', '頭', '軽装', '軽装', 8, 'R', 45, null),
  ('8R:軽装鎧', '白狼の外套', '鎧', '軽装', '軽装', 8, 'R', 45, null),
  ('8R:軽装腕', '白狼の手袋', '腕', '軽装', '軽装', 8, 'R', 45, null),
  ('8R:軽装足', '白狼の雪靴', '足', '軽装', '軽装', 8, 'R', 45, null),
  ('8R:リング', '極光の指輪', 'アクセ', 'リング', null, 8, 'R', 45, null),
  ('8R:イヤリング', 'スノーフレークピアス', 'アクセ', 'イヤリング', null, 8, 'R', 45, null),
  ('8R:ベルト', 'マンモスベルト', 'アクセ', 'ベルト', null, 8, 'R', 45, null),
  ('8R:ネックレス', '白霊のロザリオ', 'アクセ', 'ネックレス', null, 8, 'R', 45, null),
  ('8E:片手剣', '雪原の剣', '武器', '片手剣', null, 8, 'E', 50, null),
  ('8E:両手剣', '雪崩の大剣', '武器', '両手剣', null, 8, 'E', 50, null),
  ('8E:斧', '氷割りの斧', '武器', '斧', null, 8, 'E', 50, null),
  ('8E:槍', '霧氷の槍', '武器', '槍', null, 8, 'E', 50, null),
  ('8E:鈍器', '凍土の鎚', '武器', '鈍器', null, 8, 'E', 50, null),
  ('8E:短剣', '霜柱の短剣', '武器', '短剣', null, 8, 'E', 50, null),
  ('8E:拳', '氷河の拳', '武器', '拳', null, 8, 'E', 50, null),
  ('8E:弓', '吹雪の弓', '武器', '弓', null, 8, 'E', 50, null),
  ('8E:銃', '白霜の長銃', '武器', '銃', null, 8, 'E', 50, null),
  ('8E:杖', '雪明かりの杖', '武器', '杖', null, 8, 'E', 50, null),
  ('8E:書', '祭壇の祝詞', '武器', '書', null, 8, 'E', 50, null),
  ('8E:投擲', '風花の輪', '武器', '投擲', null, 8, 'E', 50, null),
  ('8E:刀', '雪風丸', '武器', '刀', null, 8, 'E', 50, null),
  ('8E:宝珠', '氷晶の宝珠', '武器', '宝珠', null, 8, 'E', 50, null),
  ('8E:重鎧頭', '氷鉄の兜', '頭', '重鎧', '重鎧', 8, 'E', 50, null),
  ('8E:重鎧鎧', '氷鉄の鎧', '鎧', '重鎧', '重鎧', 8, 'E', 50, null),
  ('8E:重鎧腕', '氷鉄の篭手', '腕', '重鎧', '重鎧', 8, 'E', 50, null),
  ('8E:重鎧足', '氷鉄の具足', '足', '重鎧', '重鎧', 8, 'E', 50, null),
  ('8E:軽装頭', '白貂の帽子', '頭', '軽装', '軽装', 8, 'E', 50, null),
  ('8E:軽装鎧', '白貂の外套', '鎧', '軽装', '軽装', 8, 'E', 50, null),
  ('8E:軽装腕', '白貂の手袋', '腕', '軽装', '軽装', 8, 'E', 50, null),
  ('8E:軽装足', '白貂の靴', '足', '軽装', '軽装', 8, 'E', 50, null),
  ('8E:リング', '雪結晶の指輪', 'アクセ', 'リング', null, 8, 'E', 50, null),
  ('8E:イヤリング', '雪しずくの耳飾り', 'アクセ', 'イヤリング', null, 8, 'E', 50, null),
  ('8E:ベルト', '毛皮の帯', 'アクセ', 'ベルト', null, 8, 'E', 50, null),
  ('8E:ネックレス', '祈りの数珠', 'アクセ', 'ネックレス', null, 8, 'E', 50, null),
  ('8L:片手剣', '冬神剣スカディ', '武器', '片手剣', null, 8, 'L', 55, null),
  ('8L:両手剣', '万年雪', '武器', '両手剣', null, 8, 'L', 55, null),
  ('8L:斧', '氷河断ち', '武器', '斧', null, 8, 'L', 55, null),
  ('8L:槍', '雪嶺の神槍', '武器', '槍', null, 8, 'L', 55, null),
  ('8L:鈍器', '極寒の神鎚', '武器', '鈍器', null, 8, 'L', 55, null),
  ('8L:短剣', '白い闇', '武器', '短剣', null, 8, 'L', 55, null),
  ('8L:拳', '氷神拳', '武器', '拳', null, 8, 'L', 55, null),
  ('8L:弓', '銀世界', '武器', '弓', null, 8, 'L', 55, null),
  ('8L:銃', '零下砲', '武器', '銃', null, 8, 'L', 55, null),
  ('8L:杖', '白霊の大杖', '武器', '杖', null, 8, 'L', 55, null),
  ('8L:書', '雪の神話', '武器', '書', null, 8, 'L', 55, null),
  ('8L:投擲', '極光輪', '武器', '投擲', null, 8, 'L', 55, null),
  ('8L:刀', '白魔', '武器', '刀', null, 8, 'L', 55, null),
  ('8L:宝珠', '北極星の宝珠', '武器', '宝珠', null, 8, 'L', 55, null),
  ('8L:重鎧頭', '霊峰騎士の兜', '頭', '重鎧', '重鎧', 8, 'L', 55, null),
  ('8L:重鎧鎧', '霊峰騎士の鎧', '鎧', '重鎧', '重鎧', 8, 'L', 55, null),
  ('8L:重鎧腕', '霊峰騎士の篭手', '腕', '重鎧', '重鎧', 8, 'L', 55, null),
  ('8L:重鎧足', '霊峰騎士の具足', '足', '重鎧', '重鎧', 8, 'L', 55, null),
  ('8L:軽装頭', '冬女神の冠', '頭', '軽装', '軽装', 8, 'L', 55, null),
  ('8L:軽装鎧', '冬女神の衣', '鎧', '軽装', '軽装', 8, 'L', 55, null),
  ('8L:軽装腕', '冬女神の手袋', '腕', '軽装', '軽装', 8, 'L', 55, null),
  ('8L:軽装足', '冬女神の靴', '足', '軽装', '軽装', 8, 'L', 55, null),
  ('8L:リング', '冬至の指輪', 'アクセ', 'リング', null, 8, 'L', 55, null),
  ('8L:イヤリング', '細雪の耳飾り', 'アクセ', 'イヤリング', null, 8, 'L', 55, null),
  ('8L:ベルト', '白銀の大帯', 'アクセ', 'ベルト', null, 8, 'L', 55, null),
  ('8L:ネックレス', '凍れる時', 'アクセ', 'ネックレス', null, 8, 'L', 55, null),
  ('9N:片手剣', 'ルーンソード', '武器', '片手剣', null, 9, 'N', 45, null),
  ('9N:両手剣', 'ルーンクレイモア', '武器', '両手剣', null, 9, 'N', 45, null),
  ('9N:斧', 'ルーンアクス', '武器', '斧', null, 9, 'N', 45, null),
  ('9N:槍', 'ルーンスピア', '武器', '槍', null, 9, 'N', 45, null),
  ('9N:鈍器', 'ルーンメイス', '武器', '鈍器', null, 9, 'N', 45, null),
  ('9N:短剣', 'ルーンダガー', '武器', '短剣', null, 9, 'N', 45, null),
  ('9N:拳', 'ルーンナックル', '武器', '拳', null, 9, 'N', 45, null),
  ('9N:弓', 'ルーンボウ', '武器', '弓', null, 9, 'N', 45, null),
  ('9N:銃', 'ルーンマグナム', '武器', '銃', null, 9, 'N', 45, null),
  ('9N:杖', 'ルーンスタッフ', '武器', '杖', null, 9, 'N', 45, null),
  ('9N:書', '封印書', '武器', '書', null, 9, 'N', 45, null),
  ('9N:投擲', 'ルーンチャクラム', '武器', '投擲', null, 9, 'N', 45, null),
  ('9N:刀', 'ルーンカタナ', '武器', '刀', null, 9, 'N', 45, null),
  ('9N:宝珠', 'トルマリンオーブ', '武器', '宝珠', null, 9, 'N', 45, null),
  ('9N:重鎧頭', 'ルーンヘルム', '頭', '重鎧', '重鎧', 9, 'N', 45, null),
  ('9N:重鎧鎧', 'ルーンメイル', '鎧', '重鎧', '重鎧', 9, 'N', 45, null),
  ('9N:重鎧腕', 'ルーンガントレット', '腕', '重鎧', '重鎧', 9, 'N', 45, null),
  ('9N:重鎧足', 'ルーングリーヴ', '足', '重鎧', '重鎧', 9, 'N', 45, null),
  ('9N:軽装頭', 'ルーンフード', '頭', '軽装', '軽装', 9, 'N', 45, null),
  ('9N:軽装鎧', 'ルーンコート', '鎧', '軽装', '軽装', 9, 'N', 45, null),
  ('9N:軽装腕', 'ルーングローブ', '腕', '軽装', '軽装', 9, 'N', 45, null),
  ('9N:軽装足', 'ルーンブーツ', '足', '軽装', '軽装', 9, 'N', 45, null),
  ('9N:リング', 'トルマリンリング', 'アクセ', 'リング', null, 9, 'N', 45, null),
  ('9N:イヤリング', 'トルマリンイヤリング', 'アクセ', 'イヤリング', null, 9, 'N', 45, null),
  ('9N:ベルト', 'トルマリンベルト', 'アクセ', 'ベルト', null, 9, 'N', 45, null),
  ('9N:ネックレス', 'トルマリンネックレス', 'アクセ', 'ネックレス', null, 9, 'N', 45, null),
  ('9R:片手剣', '紫電の剣', '武器', '片手剣', null, 9, 'R', 50, null),
  ('9R:両手剣', 'サンダーボルト', '武器', '両手剣', null, 9, 'R', 50, null),
  ('9R:斧', '轟雷の戦斧', '武器', '斧', null, 9, 'R', 50, null),
  ('9R:槍', 'ボルトランス', '武器', '槍', null, 9, 'R', 50, null),
  ('9R:鈍器', '雷神の鎚', '武器', '鈍器', null, 9, 'R', 50, null),
  ('9R:短剣', 'フラッシュナイフ', '武器', '短剣', null, 9, 'R', 50, null),
  ('9R:拳', '雷爪', '武器', '拳', null, 9, 'R', 50, null),
  ('9R:弓', '嵐鳥の弓', '武器', '弓', null, 9, 'R', 50, null),
  ('9R:銃', 'スパークショット', '武器', '銃', null, 9, 'R', 50, null),
  ('9R:杖', 'ライトニングロッド', '武器', '杖', null, 9, 'R', 50, null),
  ('9R:書', '雷帝の勅書', '武器', '書', null, 9, 'R', 50, null),
  ('9R:投擲', '閃光輪', '武器', '投擲', null, 9, 'R', 50, null),
  ('9R:刀', '稲妻丸', '武器', '刀', null, 9, 'R', 50, null),
  ('9R:宝珠', '雷玉', '武器', '宝珠', null, 9, 'R', 50, null),
  ('9R:重鎧頭', 'テンペストヘルム', '頭', '重鎧', '重鎧', 9, 'R', 50, null),
  ('9R:重鎧鎧', 'テンペストメイル', '鎧', '重鎧', '重鎧', 9, 'R', 50, null),
  ('9R:重鎧腕', 'テンペストガントレット', '腕', '重鎧', '重鎧', 9, 'R', 50, null),
  ('9R:重鎧足', 'テンペストグリーヴ', '足', '重鎧', '重鎧', 9, 'R', 50, null),
  ('9R:軽装頭', '雷雲の頭巾', '頭', '軽装', '軽装', 9, 'R', 50, null),
  ('9R:軽装鎧', '雷雲の羽衣', '鎧', '軽装', '軽装', 9, 'R', 50, null),
  ('9R:軽装腕', '雷雲の手袋', '腕', '軽装', '軽装', 9, 'R', 50, null),
  ('9R:軽装足', '雷雲の靴', '足', '軽装', '軽装', 9, 'R', 50, null),
  ('9R:リング', '帯電の指輪', 'アクセ', 'リング', null, 9, 'R', 50, null),
  ('9R:イヤリング', 'ヒポグリフフェザー', 'アクセ', 'イヤリング', null, 9, 'R', 50, null),
  ('9R:ベルト', 'ギガースの腰帯', 'アクセ', 'ベルト', null, 9, 'R', 50, null),
  ('9R:ネックレス', '鵺の鈴', 'アクセ', 'ネックレス', null, 9, 'R', 50, null),
  ('9E:片手剣', '稲光の剣', '武器', '片手剣', null, 9, 'E', 55, null),
  ('9E:両手剣', '断崖の大剣', '武器', '両手剣', null, 9, 'E', 55, null),
  ('9E:斧', '絶壁の斧', '武器', '斧', null, 9, 'E', 55, null),
  ('9E:槍', '避雷の槍', '武器', '槍', null, 9, 'E', 55, null),
  ('9E:鈍器', '轟きの鎚', '武器', '鈍器', null, 9, 'E', 55, null),
  ('9E:短剣', '閃きの短剣', '武器', '短剣', null, 9, 'E', 55, null),
  ('9E:拳', '落雷拳', '武器', '拳', null, 9, 'E', 55, null),
  ('9E:弓', '黒雲の弓', '武器', '弓', null, 9, 'E', 55, null),
  ('9E:銃', '雷管銃', '武器', '銃', null, 9, 'E', 55, null),
  ('9E:杖', '雷呼びの杖', '武器', '杖', null, 9, 'E', 55, null),
  ('9E:書', '嵐の観測記', '武器', '書', null, 9, 'E', 55, null),
  ('9E:投擲', '稲妻の戦輪', '武器', '投擲', null, 9, 'E', 55, null),
  ('9E:刀', '雷光丸', '武器', '刀', null, 9, 'E', 55, null),
  ('9E:宝珠', '雷鳴の宝珠', '武器', '宝珠', null, 9, 'E', 55, null),
  ('9E:重鎧頭', '雷鋼の兜', '頭', '重鎧', '重鎧', 9, 'E', 55, null),
  ('9E:重鎧鎧', '雷鋼の鎧', '鎧', '重鎧', '重鎧', 9, 'E', 55, null),
  ('9E:重鎧腕', '雷鋼の篭手', '腕', '重鎧', '重鎧', 9, 'E', 55, null),
  ('9E:重鎧足', '雷鋼の具足', '足', '重鎧', '重鎧', 9, 'E', 55, null),
  ('9E:軽装頭', '風雷の頭巾', '頭', '軽装', '軽装', 9, 'E', 55, null),
  ('9E:軽装鎧', '風雷の羽織', '鎧', '軽装', '軽装', 9, 'E', 55, null),
  ('9E:軽装腕', '風雷の手袋', '腕', '軽装', '軽装', 9, 'E', 55, null),
  ('9E:軽装足', '風雷の靴', '足', '軽装', '軽装', 9, 'E', 55, null),
  ('9E:リング', '雷石の指輪', 'アクセ', 'リング', null, 9, 'E', 55, null),
  ('9E:イヤリング', '火花の耳飾り', 'アクセ', 'イヤリング', null, 9, 'E', 55, null),
  ('9E:ベルト', '命綱の帯', 'アクセ', 'ベルト', null, 9, 'E', 55, null),
  ('9E:ネックレス', '雷除けの護符', 'アクセ', 'ネックレス', null, 9, 'E', 55, null),
  ('9L:片手剣', '雷神剣インドラ', '武器', '片手剣', null, 9, 'L', 60, null),
  ('9L:両手剣', '轟天の大剣', '武器', '両手剣', null, 9, 'L', 60, null),
  ('9L:斧', '千雷斧', '武器', '斧', null, 9, 'L', 60, null),
  ('9L:槍', '雷霆神槍', '武器', '槍', null, 9, 'L', 60, null),
  ('9L:鈍器', '天鼓', '武器', '鈍器', null, 9, 'L', 60, null),
  ('9L:短剣', '電光石火', '武器', '短剣', null, 9, 'L', 60, null),
  ('9L:拳', '轟雷拳', '武器', '拳', null, 9, 'L', 60, null),
  ('9L:弓', '裂空の弓', '武器', '弓', null, 9, 'L', 60, null),
  ('9L:銃', '神鳴り砲', '武器', '銃', null, 9, 'L', 60, null),
  ('9L:杖', '嵐の王笏', '武器', '杖', null, 9, 'L', 60, null),
  ('9L:書', '雷の聖典', '武器', '書', null, 9, 'L', 60, null),
  ('9L:投擲', '金剛輪', '武器', '投擲', null, 9, 'L', 60, null),
  ('9L:刀', '鳴雷', '武器', '刀', null, 9, 'L', 60, null),
  ('9L:宝珠', '稲魂の宝珠', '武器', '宝珠', null, 9, 'L', 60, null),
  ('9L:重鎧頭', '天雷の兜', '頭', '重鎧', '重鎧', 9, 'L', 60, null),
  ('9L:重鎧鎧', '天雷の鎧', '鎧', '重鎧', '重鎧', 9, 'L', 60, null),
  ('9L:重鎧腕', '天雷の篭手', '腕', '重鎧', '重鎧', 9, 'L', 60, null),
  ('9L:重鎧足', '天雷の具足', '足', '重鎧', '重鎧', 9, 'L', 60, null),
  ('9L:軽装頭', '雷姫の冠', '頭', '軽装', '軽装', 9, 'L', 60, null),
  ('9L:軽装鎧', '雷姫の衣', '鎧', '軽装', '軽装', 9, 'L', 60, null),
  ('9L:軽装腕', '雷姫の手袋', '腕', '軽装', '軽装', 9, 'L', 60, null),
  ('9L:軽装足', '雷姫の靴', '足', '軽装', '軽装', 9, 'L', 60, null),
  ('9L:リング', '天鳴の指輪', 'アクセ', 'リング', null, 9, 'L', 60, null),
  ('9L:イヤリング', '雷鳥の羽飾り', 'アクセ', 'イヤリング', null, 9, 'L', 60, null),
  ('9L:ベルト', '神雷の帯', 'アクセ', 'ベルト', null, 9, 'L', 60, null),
  ('9L:ネックレス', '天の怒り', 'アクセ', 'ネックレス', null, 9, 'L', 60, null),
  ('10N:片手剣', 'アダマンソード', '武器', '片手剣', null, 10, 'N', 50, null),
  ('10N:両手剣', 'アダマンクレイモア', '武器', '両手剣', null, 10, 'N', 50, null),
  ('10N:斧', 'アダマンアクス', '武器', '斧', null, 10, 'N', 50, null),
  ('10N:槍', 'アダマンスピア', '武器', '槍', null, 10, 'N', 50, null),
  ('10N:鈍器', 'アダマンメイス', '武器', '鈍器', null, 10, 'N', 50, null),
  ('10N:短剣', 'アダマンダガー', '武器', '短剣', null, 10, 'N', 50, null),
  ('10N:拳', 'アダマンナックル', '武器', '拳', null, 10, 'N', 50, null),
  ('10N:弓', 'アダマンボウ', '武器', '弓', null, 10, 'N', 50, null),
  ('10N:銃', 'アダマンマグナム', '武器', '銃', null, 10, 'N', 50, null),
  ('10N:杖', 'アダマンスタッフ', '武器', '杖', null, 10, 'N', 50, null),
  ('10N:書', '黙示録', '武器', '書', null, 10, 'N', 50, null),
  ('10N:投擲', 'アダマンチャクラム', '武器', '投擲', null, 10, 'N', 50, null),
  ('10N:刀', 'アダマンカタナ', '武器', '刀', null, 10, 'N', 50, null),
  ('10N:宝珠', 'ルビーオーブ', '武器', '宝珠', null, 10, 'N', 50, null),
  ('10N:重鎧頭', 'アダマンヘルム', '頭', '重鎧', '重鎧', 10, 'N', 50, null),
  ('10N:重鎧鎧', 'アダマンメイル', '鎧', '重鎧', '重鎧', 10, 'N', 50, null),
  ('10N:重鎧腕', 'アダマンガントレット', '腕', '重鎧', '重鎧', 10, 'N', 50, null),
  ('10N:重鎧足', 'アダマングリーヴ', '足', '重鎧', '重鎧', 10, 'N', 50, null),
  ('10N:軽装頭', 'サラマンダーフード', '頭', '軽装', '軽装', 10, 'N', 50, null),
  ('10N:軽装鎧', 'サラマンダーコート', '鎧', '軽装', '軽装', 10, 'N', 50, null),
  ('10N:軽装腕', 'サラマンダーグローブ', '腕', '軽装', '軽装', 10, 'N', 50, null),
  ('10N:軽装足', 'サラマンダーブーツ', '足', '軽装', '軽装', 10, 'N', 50, null),
  ('10N:リング', 'ルビーリング', 'アクセ', 'リング', null, 10, 'N', 50, null),
  ('10N:イヤリング', 'ルビーイヤリング', 'アクセ', 'イヤリング', null, 10, 'N', 50, null),
  ('10N:ベルト', 'ルビーベルト', 'アクセ', 'ベルト', null, 10, 'N', 50, null),
  ('10N:ネックレス', 'ルビーネックレス', 'アクセ', 'ネックレス', null, 10, 'N', 50, null),
  ('10R:片手剣', 'フレイムタン', '武器', '片手剣', null, 10, 'R', 55, null),
  ('10R:両手剣', 'インフェルノ', '武器', '両手剣', null, 10, 'R', 55, null),
  ('10R:斧', '溶岩斧', '武器', '斧', null, 10, 'R', 55, null),
  ('10R:槍', '紅蓮槍', '武器', '槍', null, 10, 'R', 55, null),
  ('10R:鈍器', '鍛冶神の鎚', '武器', '鈍器', null, 10, 'R', 55, null),
  ('10R:短剣', '熾火の短剣', '武器', '短剣', null, 10, 'R', 55, null),
  ('10R:拳', '爆炎拳', '武器', '拳', null, 10, 'R', 55, null),
  ('10R:弓', '不死鳥の弓', '武器', '弓', null, 10, 'R', 55, null),
  ('10R:銃', 'ドラゴンブレス', '武器', '銃', null, 10, 'R', 55, null),
  ('10R:杖', 'イフリートスタッフ', '武器', '杖', null, 10, 'R', 55, null),
  ('10R:書', '魔神契約書', '武器', '書', null, 10, 'R', 55, null),
  ('10R:投擲', '焔輪', '武器', '投擲', null, 10, 'R', 55, null),
  ('10R:刀', '火車切', '武器', '刀', null, 10, 'R', 55, null),
  ('10R:宝珠', '溶岩の核', '武器', '宝珠', null, 10, 'R', 55, null),
  ('10R:重鎧頭', '炎獄の兜', '頭', '重鎧', '重鎧', 10, 'R', 55, null),
  ('10R:重鎧鎧', '炎獄の鎧', '鎧', '重鎧', '重鎧', 10, 'R', 55, null),
  ('10R:重鎧腕', '炎獄の篭手', '腕', '重鎧', '重鎧', 10, 'R', 55, null),
  ('10R:重鎧足', '炎獄の具足', '足', '重鎧', '重鎧', 10, 'R', 55, null),
  ('10R:軽装頭', 'フェニックスハット', '頭', '軽装', '軽装', 10, 'R', 55, null),
  ('10R:軽装鎧', 'フェニックスローブ', '鎧', '軽装', '軽装', 10, 'R', 55, null),
  ('10R:軽装腕', 'フェニックスグローブ', '腕', '軽装', '軽装', 10, 'R', 55, null),
  ('10R:軽装足', 'フェニックスブーツ', '足', '軽装', '軽装', 10, 'R', 55, null),
  ('10R:リング', '鬼火の指輪', 'アクセ', 'リング', null, 10, 'R', 55, null),
  ('10R:イヤリング', '火の粉の耳飾り', 'アクセ', 'イヤリング', null, 10, 'R', 55, null),
  ('10R:ベルト', 'マグマベルト', 'アクセ', 'ベルト', null, 10, 'R', 55, null),
  ('10R:ネックレス', '火蜥蜴の護符', 'アクセ', 'ネックレス', null, 10, 'R', 55, null),
  ('10E:片手剣', '火口の剣', '武器', '片手剣', null, 10, 'E', 60, null),
  ('10E:両手剣', '噴煙の大剣', '武器', '両手剣', null, 10, 'E', 60, null),
  ('10E:斧', '火打ちの斧', '武器', '斧', null, 10, 'E', 60, null),
  ('10E:槍', '溶岩流の槍', '武器', '槍', null, 10, 'E', 60, null),
  ('10E:鈍器', '鍛冶場の鎚', '武器', '鈍器', null, 10, 'E', 60, null),
  ('10E:短剣', '硫黄の短剣', '武器', '短剣', null, 10, 'E', 60, null),
  ('10E:拳', '赤熱の拳', '武器', '拳', null, 10, 'E', 60, null),
  ('10E:弓', '炎河の弓', '武器', '弓', null, 10, 'E', 60, null),
  ('10E:銃', '噴石砲', '武器', '銃', null, 10, 'E', 60, null),
  ('10E:杖', '火山灰の杖', '武器', '杖', null, 10, 'E', 60, null),
  ('10E:書', '炎の手引き', '武器', '書', null, 10, 'E', 60, null),
  ('10E:投擲', '火山弾', '武器', '投擲', null, 10, 'E', 60, null),
  ('10E:刀', '紅焔丸', '武器', '刀', null, 10, 'E', 60, null),
  ('10E:宝珠', '灼熱の宝珠', '武器', '宝珠', null, 10, 'E', 60, null),
  ('10E:重鎧頭', '溶鉄の兜', '頭', '重鎧', '重鎧', 10, 'E', 60, null),
  ('10E:重鎧鎧', '溶鉄の鎧', '鎧', '重鎧', '重鎧', 10, 'E', 60, null),
  ('10E:重鎧腕', '溶鉄の篭手', '腕', '重鎧', '重鎧', 10, 'E', 60, null),
  ('10E:重鎧足', '溶鉄の具足', '足', '重鎧', '重鎧', 10, 'E', 60, null),
  ('10E:軽装頭', '火守りの頭巾', '頭', '軽装', '軽装', 10, 'E', 60, null),
  ('10E:軽装鎧', '火守りの衣', '鎧', '軽装', '軽装', 10, 'E', 60, null),
  ('10E:軽装腕', '火守りの手袋', '腕', '軽装', '軽装', 10, 'E', 60, null),
  ('10E:軽装足', '火守りの靴', '足', '軽装', '軽装', 10, 'E', 60, null),
  ('10E:リング', '火山石の指輪', 'アクセ', 'リング', null, 10, 'E', 60, null),
  ('10E:イヤリング', '燠火の耳飾り', 'アクセ', 'イヤリング', null, 10, 'E', 60, null),
  ('10E:ベルト', '炎除けの帯', 'アクセ', 'ベルト', null, 10, 'E', 60, null),
  ('10E:ネックレス', '黒曜石の首飾り', 'アクセ', 'ネックレス', null, 10, 'E', 60, null),
  ('10L:片手剣', '炎神剣アグニ', '武器', '片手剣', null, 10, 'L', 65, null),
  ('10L:両手剣', '溶岩断ち', '武器', '両手剣', null, 10, 'L', 65, null),
  ('10L:斧', '大噴火', '武器', '斧', null, 10, 'L', 65, null),
  ('10L:槍', '火柱の神槍', '武器', '槍', null, 10, 'L', 65, null),
  ('10L:鈍器', 'ヘパイストスの鎚', '武器', '鈍器', null, 10, 'L', 65, null),
  ('10L:短剣', '劫火', '武器', '短剣', null, 10, 'L', 65, null),
  ('10L:拳', '赫灼拳', '武器', '拳', null, 10, 'L', 65, null),
  ('10L:弓', '炎の雨', '武器', '弓', null, 10, 'L', 65, null),
  ('10L:銃', '天焦がし', '武器', '銃', null, 10, 'L', 65, null),
  ('10L:杖', '業火の王杖', '武器', '杖', null, 10, 'L', 65, null),
  ('10L:書', '火山神話', '武器', '書', null, 10, 'L', 65, null),
  ('10L:投擲', '烈火輪', '武器', '投擲', null, 10, 'L', 65, null),
  ('10L:刀', '紅蓮', '武器', '刀', null, 10, 'L', 65, null),
  ('10L:宝珠', '炉心核', '武器', '宝珠', null, 10, 'L', 65, null),
  ('10L:重鎧頭', '煉獄の兜', '頭', '重鎧', '重鎧', 10, 'L', 65, null),
  ('10L:重鎧鎧', '煉獄の鎧', '鎧', '重鎧', '重鎧', 10, 'L', 65, null),
  ('10L:重鎧腕', '煉獄の篭手', '腕', '重鎧', '重鎧', 10, 'L', 65, null),
  ('10L:重鎧足', '煉獄の具足', '足', '重鎧', '重鎧', 10, 'L', 65, null),
  ('10L:軽装頭', '緋焔の冠', '頭', '軽装', '軽装', 10, 'L', 65, null),
  ('10L:軽装鎧', '緋焔の衣', '鎧', '軽装', '軽装', 10, 'L', 65, null),
  ('10L:軽装腕', '緋焔の手袋', '腕', '軽装', '軽装', 10, 'L', 65, null),
  ('10L:軽装足', '緋焔の靴', '足', '軽装', '軽装', 10, 'L', 65, null),
  ('10L:リング', '消えずの火の指輪', 'アクセ', 'リング', null, 10, 'L', 65, null),
  ('10L:イヤリング', '火の雫', 'アクセ', 'イヤリング', null, 10, 'L', 65, null),
  ('10L:ベルト', '大炉の帯', 'アクセ', 'ベルト', null, 10, 'L', 65, null),
  ('10L:ネックレス', '聖火の首飾り', 'アクセ', 'ネックレス', null, 10, 'L', 65, null),
  ('11N:片手剣', 'ドラゴンソード', '武器', '片手剣', null, 11, 'N', 55, null),
  ('11N:両手剣', 'ドラゴンクレイモア', '武器', '両手剣', null, 11, 'N', 55, null),
  ('11N:斧', 'ドラゴンアクス', '武器', '斧', null, 11, 'N', 55, null),
  ('11N:槍', 'ドラゴンスピア', '武器', '槍', null, 11, 'N', 55, null),
  ('11N:鈍器', 'ドラゴンメイス', '武器', '鈍器', null, 11, 'N', 55, null),
  ('11N:短剣', 'ドラゴンダガー', '武器', '短剣', null, 11, 'N', 55, null),
  ('11N:拳', 'ドラゴンナックル', '武器', '拳', null, 11, 'N', 55, null),
  ('11N:弓', 'ドラゴンボウ', '武器', '弓', null, 11, 'N', 55, null),
  ('11N:銃', 'ドラゴンマグナム', '武器', '銃', null, 11, 'N', 55, null),
  ('11N:杖', 'ドラゴンスタッフ', '武器', '杖', null, 11, 'N', 55, null),
  ('11N:書', '竜語典', '武器', '書', null, 11, 'N', 55, null),
  ('11N:投擲', 'ドラゴンチャクラム', '武器', '投擲', null, 11, 'N', 55, null),
  ('11N:刀', 'ドラゴンカタナ', '武器', '刀', null, 11, 'N', 55, null),
  ('11N:宝珠', 'オニキスオーブ', '武器', '宝珠', null, 11, 'N', 55, null),
  ('11N:重鎧頭', 'ドラゴンヘルム', '頭', '重鎧', '重鎧', 11, 'N', 55, null),
  ('11N:重鎧鎧', 'ドラゴンメイル', '鎧', '重鎧', '重鎧', 11, 'N', 55, null),
  ('11N:重鎧腕', 'ドラゴンガントレット', '腕', '重鎧', '重鎧', 11, 'N', 55, null),
  ('11N:重鎧足', 'ドラゴングリーヴ', '足', '重鎧', '重鎧', 11, 'N', 55, null),
  ('11N:軽装頭', 'ドラゴンフード', '頭', '軽装', '軽装', 11, 'N', 55, null),
  ('11N:軽装鎧', 'ドラゴンコート', '鎧', '軽装', '軽装', 11, 'N', 55, null),
  ('11N:軽装腕', 'ドラゴングローブ', '腕', '軽装', '軽装', 11, 'N', 55, null),
  ('11N:軽装足', 'ドラゴンブーツ', '足', '軽装', '軽装', 11, 'N', 55, null),
  ('11N:リング', 'オニキスリング', 'アクセ', 'リング', null, 11, 'N', 55, null),
  ('11N:イヤリング', 'オニキスイヤリング', 'アクセ', 'イヤリング', null, 11, 'N', 55, null),
  ('11N:ベルト', 'オニキスベルト', 'アクセ', 'ベルト', null, 11, 'N', 55, null),
  ('11N:ネックレス', 'オニキスネックレス', 'アクセ', 'ネックレス', null, 11, 'N', 55, null),
  ('11R:片手剣', 'ヴェノムブレード', '武器', '片手剣', null, 11, 'R', 60, null),
  ('11R:両手剣', '毒龍の大剣', '武器', '両手剣', null, 11, 'R', 60, null),
  ('11R:斧', '蜥蜴人の斧', '武器', '斧', null, 11, 'R', 60, null),
  ('11R:槍', '鰐顎の槍', '武器', '槍', null, 11, 'R', 60, null),
  ('11R:鈍器', '腐王の笏', '武器', '鈍器', null, 11, 'R', 60, null),
  ('11R:短剣', 'ブラッドリーチ', '武器', '短剣', null, 11, 'R', 60, null),
  ('11R:拳', 'クロコダイルナックル', '武器', '拳', null, 11, 'R', 60, null),
  ('11R:弓', '沼葦の弓', '武器', '弓', null, 11, 'R', 60, null),
  ('11R:銃', '腐蝕銃', '武器', '銃', null, 11, 'R', 60, null),
  ('11R:杖', 'ウィスプランタン', '武器', '杖', null, 11, 'R', 60, null),
  ('11R:書', '呪詛帳', '武器', '書', null, 11, 'R', 60, null),
  ('11R:投擲', '毒壺', '武器', '投擲', null, 11, 'R', 60, null),
  ('11R:刀', '毒蛇切り', '武器', '刀', null, 11, 'R', 60, null),
  ('11R:宝珠', '腐れ水晶', '武器', '宝珠', null, 11, 'R', 60, null),
  ('11R:重鎧頭', 'ヒュドラヘルム', '頭', '重鎧', '重鎧', 11, 'R', 60, null),
  ('11R:重鎧鎧', 'ヒュドラスケイル', '鎧', '重鎧', '重鎧', 11, 'R', 60, null),
  ('11R:重鎧腕', 'ヒュドラガントレット', '腕', '重鎧', '重鎧', 11, 'R', 60, null),
  ('11R:重鎧足', 'ヒュドラグリーヴ', '足', '重鎧', '重鎧', 11, 'R', 60, null),
  ('11R:軽装頭', '蛇革の帽子', '頭', '軽装', '軽装', 11, 'R', 60, null),
  ('11R:軽装鎧', '蛇革の上着', '鎧', '軽装', '軽装', 11, 'R', 60, null),
  ('11R:軽装腕', '蛇革の手袋', '腕', '軽装', '軽装', 11, 'R', 60, null),
  ('11R:軽装足', '蛇革の長靴', '足', '軽装', '軽装', 11, 'R', 60, null),
  ('11R:リング', '解毒の指輪', 'アクセ', 'リング', null, 11, 'R', 60, null),
  ('11R:イヤリング', '鬼灯の耳飾り', 'アクセ', 'イヤリング', null, 11, 'R', 60, null),
  ('11R:ベルト', '瘴気除けの帯', 'アクセ', 'ベルト', null, 11, 'R', 60, null),
  ('11R:ネックレス', '沈みし村の聖印', 'アクセ', 'ネックレス', null, 11, 'R', 60, null),
  ('11E:片手剣', '朽ち鉄の剣', '武器', '片手剣', null, 11, 'E', 65, null),
  ('11E:両手剣', '泥濘の大剣', '武器', '両手剣', null, 11, 'E', 65, null),
  ('11E:斧', '泥炭の斧', '武器', '斧', null, 11, 'E', 65, null),
  ('11E:槍', '葦切りの槍', '武器', '槍', null, 11, 'E', 65, null),
  ('11E:鈍器', '沼石の鎚', '武器', '鈍器', null, 11, 'E', 65, null),
  ('11E:短剣', '腐れ牙の短剣', '武器', '短剣', null, 11, 'E', 65, null),
  ('11E:拳', '毒爪の拳', '武器', '拳', null, 11, 'E', 65, null),
  ('11E:弓', '霧雨の弓', '武器', '弓', null, 11, 'E', 65, null),
  ('11E:銃', '湿原の長銃', '武器', '銃', null, 11, 'E', 65, null),
  ('11E:杖', '枯れ蓮の杖', '武器', '杖', null, 11, 'E', 65, null),
  ('11E:書', '沈みし村の日誌', '武器', '書', null, 11, 'E', 65, null),
  ('11E:投擲', '毒霧の輪', '武器', '投擲', null, 11, 'E', 65, null),
  ('11E:刀', '黒沼', '武器', '刀', null, 11, 'E', 65, null),
  ('11E:宝珠', '瘴気の宝珠', '武器', '宝珠', null, 11, 'E', 65, null),
  ('11E:重鎧頭', '沼鉄の兜', '頭', '重鎧', '重鎧', 11, 'E', 65, null),
  ('11E:重鎧鎧', '沼鉄の鎧', '鎧', '重鎧', '重鎧', 11, 'E', 65, null),
  ('11E:重鎧腕', '沼鉄の篭手', '腕', '重鎧', '重鎧', 11, 'E', 65, null),
  ('11E:重鎧足', '沼鉄の具足', '足', '重鎧', '重鎧', 11, 'E', 65, null),
  ('11E:軽装頭', '沼渡りの頭巾', '頭', '軽装', '軽装', 11, 'E', 65, null),
  ('11E:軽装鎧', '沼渡りの外套', '鎧', '軽装', '軽装', 11, 'E', 65, null),
  ('11E:軽装腕', '沼渡りの手袋', '腕', '軽装', '軽装', 11, 'E', 65, null),
  ('11E:軽装足', '沼渡りの長靴', '足', '軽装', '軽装', 11, 'E', 65, null),
  ('11E:リング', '泥中の指輪', 'アクセ', 'リング', null, 11, 'E', 65, null),
  ('11E:イヤリング', '毒草の耳飾り', 'アクセ', 'イヤリング', null, 11, 'E', 65, null),
  ('11E:ベルト', '葦編みの帯', 'アクセ', 'ベルト', null, 11, 'E', 65, null),
  ('11E:ネックレス', '蓮の首飾り', 'アクセ', 'ネックレス', null, 11, 'E', 65, null),
  ('11L:片手剣', '毒王剣トキシカ', '武器', '片手剣', null, 11, 'L', 70, null),
  ('11L:両手剣', '底なし沼', '武器', '両手剣', null, 11, 'L', 70, null),
  ('11L:斧', '大沼斧', '武器', '斧', null, 11, 'L', 70, null),
  ('11L:槍', '腐海神槍', '武器', '槍', null, 11, 'L', 70, null),
  ('11L:鈍器', '疫病の鎚', '武器', '鈍器', null, 11, 'L', 70, null),
  ('11L:短剣', '致死毒', '武器', '短剣', null, 11, 'L', 70, null),
  ('11L:拳', '呪縛拳', '武器', '拳', null, 11, 'L', 70, null),
  ('11L:弓', '蝕みの弓', '武器', '弓', null, 11, 'L', 70, null),
  ('11L:銃', '瘴気砲', '武器', '銃', null, 11, 'L', 70, null),
  ('11L:杖', '苗床の王杖', '武器', '杖', null, 11, 'L', 70, null),
  ('11L:書', '腐敗の福音', '武器', '書', null, 11, 'L', 70, null),
  ('11L:投擲', '死の輪舞', '武器', '投擲', null, 11, 'L', 70, null),
  ('11L:刀', '徒花', '武器', '刀', null, 11, 'L', 70, null),
  ('11L:宝珠', '蠱毒の珠', '武器', '宝珠', null, 11, 'L', 70, null),
  ('11L:重鎧頭', '腐王の兜', '頭', '重鎧', '重鎧', 11, 'L', 70, null),
  ('11L:重鎧鎧', '腐王の鎧', '鎧', '重鎧', '重鎧', 11, 'L', 70, null),
  ('11L:重鎧腕', '腐王の篭手', '腕', '重鎧', '重鎧', 11, 'L', 70, null),
  ('11L:重鎧足', '腐王の具足', '足', '重鎧', '重鎧', 11, 'L', 70, null),
  ('11L:軽装頭', '黒蓮の冠', '頭', '軽装', '軽装', 11, 'L', 70, null),
  ('11L:軽装鎧', '黒蓮の衣', '鎧', '軽装', '軽装', 11, 'L', 70, null),
  ('11L:軽装腕', '黒蓮の手袋', '腕', '軽装', '軽装', 11, 'L', 70, null),
  ('11L:軽装足', '黒蓮の靴', '足', '軽装', '軽装', 11, 'L', 70, null),
  ('11L:リング', '死者の指輪', 'アクセ', 'リング', null, 11, 'L', 70, null),
  ('11L:イヤリング', '毒涙の耳飾り', 'アクセ', 'イヤリング', null, 11, 'L', 70, null),
  ('11L:ベルト', '腐海の大帯', 'アクセ', 'ベルト', null, 11, 'L', 70, null),
  ('11L:ネックレス', '穢れた聖杯', 'アクセ', 'ネックレス', null, 11, 'L', 70, null),
  ('12N:片手剣', 'オリハルコンソード', '武器', '片手剣', null, 12, 'N', 60, null),
  ('12N:両手剣', 'オリハルコンクレイモア', '武器', '両手剣', null, 12, 'N', 60, null),
  ('12N:斧', 'オリハルコンアクス', '武器', '斧', null, 12, 'N', 60, null),
  ('12N:槍', 'オリハルコンスピア', '武器', '槍', null, 12, 'N', 60, null),
  ('12N:鈍器', 'オリハルコンメイス', '武器', '鈍器', null, 12, 'N', 60, null),
  ('12N:短剣', 'オリハルコンダガー', '武器', '短剣', null, 12, 'N', 60, null),
  ('12N:拳', 'オリハルコンナックル', '武器', '拳', null, 12, 'N', 60, null),
  ('12N:弓', 'オリハルコンボウ', '武器', '弓', null, 12, 'N', 60, null),
  ('12N:銃', 'オリハルコンマグナム', '武器', '銃', null, 12, 'N', 60, null),
  ('12N:杖', 'オリハルコンスタッフ', '武器', '杖', null, 12, 'N', 60, null),
  ('12N:書', '冥府録', '武器', '書', null, 12, 'N', 60, null),
  ('12N:投擲', 'オリハルコンチャクラム', '武器', '投擲', null, 12, 'N', 60, null),
  ('12N:刀', 'オリハルコンカタナ', '武器', '刀', null, 12, 'N', 60, null),
  ('12N:宝珠', 'オパールオーブ', '武器', '宝珠', null, 12, 'N', 60, null),
  ('12N:重鎧頭', 'オリハルコンヘルム', '頭', '重鎧', '重鎧', 12, 'N', 60, null),
  ('12N:重鎧鎧', 'オリハルコンメイル', '鎧', '重鎧', '重鎧', 12, 'N', 60, null),
  ('12N:重鎧腕', 'オリハルコンガントレット', '腕', '重鎧', '重鎧', 12, 'N', 60, null),
  ('12N:重鎧足', 'オリハルコングリーヴ', '足', '重鎧', '重鎧', 12, 'N', 60, null),
  ('12N:軽装頭', 'シャドウフード', '頭', '軽装', '軽装', 12, 'N', 60, null),
  ('12N:軽装鎧', 'シャドウコート', '鎧', '軽装', '軽装', 12, 'N', 60, null),
  ('12N:軽装腕', 'シャドウグローブ', '腕', '軽装', '軽装', 12, 'N', 60, null),
  ('12N:軽装足', 'シャドウブーツ', '足', '軽装', '軽装', 12, 'N', 60, null),
  ('12N:リング', 'オパールリング', 'アクセ', 'リング', null, 12, 'N', 60, null),
  ('12N:イヤリング', 'オパールイヤリング', 'アクセ', 'イヤリング', null, 12, 'N', 60, null),
  ('12N:ベルト', 'オパールベルト', 'アクセ', 'ベルト', null, 12, 'N', 60, null),
  ('12N:ネックレス', 'オパールネックレス', 'アクセ', 'ネックレス', null, 12, 'N', 60, null),
  ('12R:片手剣', '水晶剣', '武器', '片手剣', null, 12, 'R', 65, null),
  ('12R:両手剣', 'ドリルブレイカー', '武器', '両手剣', null, 12, 'R', 65, null),
  ('12R:斧', '大つるはし', '武器', '斧', null, 12, 'R', 65, null),
  ('12R:槍', '削岩槍', '武器', '槍', null, 12, 'R', 65, null),
  ('12R:鈍器', 'ガイアハンマー', '武器', '鈍器', null, 12, 'R', 65, null),
  ('12R:短剣', 'アラクネの毒牙', '武器', '短剣', null, 12, 'R', 65, null),
  ('12R:拳', 'モールクロー', '武器', '拳', null, 12, 'R', 65, null),
  ('12R:弓', '蜘蛛糸の弓', '武器', '弓', null, 12, 'R', 65, null),
  ('12R:銃', 'ドワーフ火砲', '武器', '銃', null, 12, 'R', 65, null),
  ('12R:杖', '晶石の杖', '武器', '杖', null, 12, 'R', 65, null),
  ('12R:書', '坑夫の手記', '武器', '書', null, 12, 'R', 65, null),
  ('12R:投擲', '発破筒', '武器', '投擲', null, 12, 'R', 65, null),
  ('12R:刀', '黒鉄丸', '武器', '刀', null, 12, 'R', 65, null),
  ('12R:宝珠', '灯守の水晶', '武器', '宝珠', null, 12, 'R', 65, null),
  ('12R:重鎧頭', 'ドワーフヘルム', '頭', '重鎧', '重鎧', 12, 'R', 65, null),
  ('12R:重鎧鎧', 'ドワーフプレート', '鎧', '重鎧', '重鎧', 12, 'R', 65, null),
  ('12R:重鎧腕', 'ドワーフガントレット', '腕', '重鎧', '重鎧', 12, 'R', 65, null),
  ('12R:重鎧足', 'ドワーフグリーヴ', '足', '重鎧', '重鎧', 12, 'R', 65, null),
  ('12R:軽装頭', '灯守の頭巾', '頭', '軽装', '軽装', 12, 'R', 65, null),
  ('12R:軽装鎧', '灯守の外套', '鎧', '軽装', '軽装', 12, 'R', 65, null),
  ('12R:軽装腕', '灯守の手袋', '腕', '軽装', '軽装', 12, 'R', 65, null),
  ('12R:軽装足', '灯守の長靴', '足', '軽装', '軽装', 12, 'R', 65, null),
  ('12R:リング', '原石の指輪', 'アクセ', 'リング', null, 12, 'R', 65, null),
  ('12R:イヤリング', 'クリスタルピアス', 'アクセ', 'イヤリング', null, 12, 'R', 65, null),
  ('12R:ベルト', 'ツールベルト', 'アクセ', 'ベルト', null, 12, 'R', 65, null),
  ('12R:ネックレス', '奈落の鍵', 'アクセ', 'ネックレス', null, 12, 'R', 65, null),
  ('12E:片手剣', '鉱脈の剣', '武器', '片手剣', null, 12, 'E', 70, null),
  ('12E:両手剣', '岩盤の大剣', '武器', '両手剣', null, 12, 'E', 70, null),
  ('12E:斧', '掘削の斧', '武器', '斧', null, 12, 'E', 70, null),
  ('12E:槍', '坑木の槍', '武器', '槍', null, 12, 'E', 70, null),
  ('12E:鈍器', '落盤の鎚', '武器', '鈍器', null, 12, 'E', 70, null),
  ('12E:短剣', '鋼玉の短剣', '武器', '短剣', null, 12, 'E', 70, null),
  ('12E:拳', '鉄塊の拳', '武器', '拳', null, 12, 'E', 70, null),
  ('12E:弓', '深坑の弓', '武器', '弓', null, 12, 'E', 70, null),
  ('12E:銃', '鉱山砲', '武器', '銃', null, 12, 'E', 70, null),
  ('12E:杖', 'カンテラの杖', '武器', '杖', null, 12, 'E', 70, null),
  ('12E:書', '坑道の地図', '武器', '書', null, 12, 'E', 70, null),
  ('12E:投擲', 'トロッコの車輪', '武器', '投擲', null, 12, 'E', 70, null),
  ('12E:刀', '玉鋼', '武器', '刀', null, 12, 'E', 70, null),
  ('12E:宝珠', '蛍石の宝珠', '武器', '宝珠', null, 12, 'E', 70, null),
  ('12E:重鎧頭', '黒鉱の兜', '頭', '重鎧', '重鎧', 12, 'E', 70, null),
  ('12E:重鎧鎧', '黒鉱の鎧', '鎧', '重鎧', '重鎧', 12, 'E', 70, null),
  ('12E:重鎧腕', '黒鉱の篭手', '腕', '重鎧', '重鎧', 12, 'E', 70, null),
  ('12E:重鎧足', '黒鉱の具足', '足', '重鎧', '重鎧', 12, 'E', 70, null),
  ('12E:軽装頭', '採掘師の帽子', '頭', '軽装', '軽装', 12, 'E', 70, null),
  ('12E:軽装鎧', '採掘師の上着', '鎧', '軽装', '軽装', 12, 'E', 70, null),
  ('12E:軽装腕', '採掘師の手袋', '腕', '軽装', '軽装', 12, 'E', 70, null),
  ('12E:軽装足', '採掘師の長靴', '足', '軽装', '軽装', 12, 'E', 70, null),
  ('12E:リング', '紫水晶の指輪', 'アクセ', 'リング', null, 12, 'E', 70, null),
  ('12E:イヤリング', '黄玉の耳飾り', 'アクセ', 'イヤリング', null, 12, 'E', 70, null),
  ('12E:ベルト', '縦穴の帯', 'アクセ', 'ベルト', null, 12, 'E', 70, null),
  ('12E:ネックレス', 'カナリアの首飾り', 'アクセ', 'ネックレス', null, 12, 'E', 70, null),
  ('12L:片手剣', '冥剣ハデス', '武器', '片手剣', null, 12, 'L', 75, null),
  ('12L:両手剣', '奈落断ち', '武器', '両手剣', null, 12, 'L', 75, null),
  ('12L:斧', '大地割り', '武器', '斧', null, 12, 'L', 75, null),
  ('12L:槍', '地獄穿ち', '武器', '槍', null, 12, 'L', 75, null),
  ('12L:鈍器', '地殻の鉄槌', '武器', '鈍器', null, 12, 'L', 75, null),
  ('12L:短剣', '禁忌', '武器', '短剣', null, 12, 'L', 75, null),
  ('12L:拳', '冥府拳', '武器', '拳', null, 12, 'L', 75, null),
  ('12L:弓', '闇底の弓', '武器', '弓', null, 12, 'L', 75, null),
  ('12L:銃', '地鳴り砲', '武器', '銃', null, 12, 'L', 75, null),
  ('12L:杖', '黄泉の杖', '武器', '杖', null, 12, 'L', 75, null),
  ('12L:書', '禁域の書', '武器', '書', null, 12, 'L', 75, null),
  ('12L:投擲', '無底輪', '武器', '投擲', null, 12, 'L', 75, null),
  ('12L:刀', '無間', '武器', '刀', null, 12, 'L', 75, null),
  ('12L:宝珠', '地底の太陽', '武器', '宝珠', null, 12, 'L', 75, null),
  ('12L:重鎧頭', '地底王の兜', '頭', '重鎧', '重鎧', 12, 'L', 75, null),
  ('12L:重鎧鎧', '地底王の鎧', '鎧', '重鎧', '重鎧', 12, 'L', 75, null),
  ('12L:重鎧腕', '地底王の篭手', '腕', '重鎧', '重鎧', 12, 'L', 75, null),
  ('12L:重鎧足', '地底王の具足', '足', '重鎧', '重鎧', 12, 'L', 75, null),
  ('12L:軽装頭', '輝石の冠', '頭', '軽装', '軽装', 12, 'L', 75, null),
  ('12L:軽装鎧', '輝石の衣', '鎧', '軽装', '軽装', 12, 'L', 75, null),
  ('12L:軽装腕', '輝石の手袋', '腕', '軽装', '軽装', 12, 'L', 75, null),
  ('12L:軽装足', '輝石の靴', '足', '軽装', '軽装', 12, 'L', 75, null),
  ('12L:リング', '金剛石の指輪', 'アクセ', 'リング', null, 12, 'L', 75, null),
  ('12L:イヤリング', '坑底の灯', 'アクセ', 'イヤリング', null, 12, 'L', 75, null),
  ('12L:ベルト', '大鉱脈の帯', 'アクセ', 'ベルト', null, 12, 'L', 75, null),
  ('12L:ネックレス', '眠れる原石', 'アクセ', 'ネックレス', null, 12, 'L', 75, null),
  ('13N:片手剣', 'セレスティアルソード', '武器', '片手剣', null, 13, 'N', 65, null),
  ('13N:両手剣', 'セレスティアルクレイモア', '武器', '両手剣', null, 13, 'N', 65, null),
  ('13N:斧', 'セレスティアルアクス', '武器', '斧', null, 13, 'N', 65, null),
  ('13N:槍', 'セレスティアルスピア', '武器', '槍', null, 13, 'N', 65, null),
  ('13N:鈍器', 'セレスティアルメイス', '武器', '鈍器', null, 13, 'N', 65, null),
  ('13N:短剣', 'セレスティアルダガー', '武器', '短剣', null, 13, 'N', 65, null),
  ('13N:拳', 'セレスティアルナックル', '武器', '拳', null, 13, 'N', 65, null),
  ('13N:弓', 'セレスティアルボウ', '武器', '弓', null, 13, 'N', 65, null),
  ('13N:銃', 'セレスティアルマグナム', '武器', '銃', null, 13, 'N', 65, null),
  ('13N:杖', 'セレスティアルスタッフ', '武器', '杖', null, 13, 'N', 65, null),
  ('13N:書', '天啓書', '武器', '書', null, 13, 'N', 65, null),
  ('13N:投擲', 'セレスティアルチャクラム', '武器', '投擲', null, 13, 'N', 65, null),
  ('13N:刀', 'セレスティアルカタナ', '武器', '刀', null, 13, 'N', 65, null),
  ('13N:宝珠', 'セレスタイトオーブ', '武器', '宝珠', null, 13, 'N', 65, null),
  ('13N:重鎧頭', 'セレスティアルヘルム', '頭', '重鎧', '重鎧', 13, 'N', 65, null),
  ('13N:重鎧鎧', 'セレスティアルメイル', '鎧', '重鎧', '重鎧', 13, 'N', 65, null),
  ('13N:重鎧腕', 'セレスティアルガントレット', '腕', '重鎧', '重鎧', 13, 'N', 65, null),
  ('13N:重鎧足', 'セレスティアルグリーヴ', '足', '重鎧', '重鎧', 13, 'N', 65, null),
  ('13N:軽装頭', 'セレスティアルフード', '頭', '軽装', '軽装', 13, 'N', 65, null),
  ('13N:軽装鎧', 'セレスティアルコート', '鎧', '軽装', '軽装', 13, 'N', 65, null),
  ('13N:軽装腕', 'セレスティアルグローブ', '腕', '軽装', '軽装', 13, 'N', 65, null),
  ('13N:軽装足', 'セレスティアルブーツ', '足', '軽装', '軽装', 13, 'N', 65, null),
  ('13N:リング', 'セレスタイトリング', 'アクセ', 'リング', null, 13, 'N', 65, null),
  ('13N:イヤリング', 'セレスタイトイヤリング', 'アクセ', 'イヤリング', null, 13, 'N', 65, null),
  ('13N:ベルト', 'セレスタイトベルト', 'アクセ', 'ベルト', null, 13, 'N', 65, null),
  ('13N:ネックレス', 'セレスタイトネックレス', 'アクセ', 'ネックレス', null, 13, 'N', 65, null),
  ('13R:片手剣', '蒼穹の剣', '武器', '片手剣', null, 13, 'R', 70, null),
  ('13R:両手剣', 'ゼニス', '武器', '両手剣', null, 13, 'R', 70, null),
  ('13R:斧', '戦乙女の斧', '武器', '斧', null, 13, 'R', 70, null),
  ('13R:槍', 'ペガサスランス', '武器', '槍', null, 13, 'R', 70, null),
  ('13R:鈍器', '天罰の鎚', '武器', '鈍器', null, 13, 'R', 70, null),
  ('13R:短剣', '風精の短剣', '武器', '短剣', null, 13, 'R', 70, null),
  ('13R:拳', 'ウィングナックル', '武器', '拳', null, 13, 'R', 70, null),
  ('13R:弓', '天穹の弓', '武器', '弓', null, 13, 'R', 70, null),
  ('13R:銃', 'スカイキャノン', '武器', '銃', null, 13, 'R', 70, null),
  ('13R:杖', '一角獣の杖', '武器', '杖', null, 13, 'R', 70, null),
  ('13R:書', '天上聖典', '武器', '書', null, 13, 'R', 70, null),
  ('13R:投擲', '天使の輪', '武器', '投擲', null, 13, 'R', 70, null),
  ('13R:刀', '雲居の太刀', '武器', '刀', null, 13, 'R', 70, null),
  ('13R:宝珠', '天空の宝珠', '武器', '宝珠', null, 13, 'R', 70, null),
  ('13R:重鎧頭', '天騎士の兜', '頭', '重鎧', '重鎧', 13, 'R', 70, null),
  ('13R:重鎧鎧', '天騎士の鎧', '鎧', '重鎧', '重鎧', 13, 'R', 70, null),
  ('13R:重鎧腕', '天騎士の篭手', '腕', '重鎧', '重鎧', 13, 'R', 70, null),
  ('13R:重鎧足', '天騎士の具足', '足', '重鎧', '重鎧', 13, 'R', 70, null),
  ('13R:軽装頭', 'セラフサークレット', '頭', '軽装', '軽装', 13, 'R', 70, null),
  ('13R:軽装鎧', 'セラフローブ', '鎧', '軽装', '軽装', 13, 'R', 70, null),
  ('13R:軽装腕', 'セラフグローブ', '腕', '軽装', '軽装', 13, 'R', 70, null),
  ('13R:軽装足', 'セラフサンダル', '足', '軽装', '軽装', 13, 'R', 70, null),
  ('13R:リング', '雲海の指輪', 'アクセ', 'リング', null, 13, 'R', 70, null),
  ('13R:イヤリング', 'エンジェルフェザー', 'アクセ', 'イヤリング', null, 13, 'R', 70, null),
  ('13R:ベルト', 'ヴァルキリーベルト', 'アクセ', 'ベルト', null, 13, 'R', 70, null),
  ('13R:ネックレス', '天主の勲章', 'アクセ', 'ネックレス', null, 13, 'R', 70, null),
  ('13E:片手剣', '浮雲の剣', '武器', '片手剣', null, 13, 'E', 75, null),
  ('13E:両手剣', '天空城の大剣', '武器', '両手剣', null, 13, 'E', 75, null),
  ('13E:斧', '雲割りの斧', '武器', '斧', null, 13, 'E', 75, null),
  ('13E:槍', '飛空の槍', '武器', '槍', null, 13, 'E', 75, null),
  ('13E:鈍器', '城壁砕き', '武器', '鈍器', null, 13, 'E', 75, null),
  ('13E:短剣', 'そよ風の短剣', '武器', '短剣', null, 13, 'E', 75, null),
  ('13E:拳', '空駆けの拳', '武器', '拳', null, 13, 'E', 75, null),
  ('13E:弓', '花園の弓', '武器', '弓', null, 13, 'E', 75, null),
  ('13E:銃', '見張り塔の銃', '武器', '銃', null, 13, 'E', 75, null),
  ('13E:杖', '天花の杖', '武器', '杖', null, 13, 'E', 75, null),
  ('13E:書', '謁見の作法', '武器', '書', null, 13, 'E', 75, null),
  ('13E:投擲', '風車の輪', '武器', '投擲', null, 13, 'E', 75, null),
  ('13E:刀', '天津風', '武器', '刀', null, 13, 'E', 75, null),
  ('13E:宝珠', '浮遊石の宝珠', '武器', '宝珠', null, 13, 'E', 75, null),
  ('13E:重鎧頭', '蒼鋼の兜', '頭', '重鎧', '重鎧', 13, 'E', 75, null),
  ('13E:重鎧鎧', '蒼鋼の鎧', '鎧', '重鎧', '重鎧', 13, 'E', 75, null),
  ('13E:重鎧腕', '蒼鋼の篭手', '腕', '重鎧', '重鎧', 13, 'E', 75, null),
  ('13E:重鎧足', '蒼鋼の具足', '足', '重鎧', '重鎧', 13, 'E', 75, null),
  ('13E:軽装頭', '白雲の帽子', '頭', '軽装', '軽装', 13, 'E', 75, null),
  ('13E:軽装鎧', '白雲の衣', '鎧', '軽装', '軽装', 13, 'E', 75, null),
  ('13E:軽装腕', '白雲の手袋', '腕', '軽装', '軽装', 13, 'E', 75, null),
  ('13E:軽装足', '白雲の靴', '足', '軽装', '軽装', 13, 'E', 75, null),
  ('13E:リング', '飛翔の指輪', 'アクセ', 'リング', null, 13, 'E', 75, null),
  ('13E:イヤリング', '白羽の耳飾り', 'アクセ', 'イヤリング', null, 13, 'E', 75, null),
  ('13E:ベルト', '風乗りの帯', 'アクセ', 'ベルト', null, 13, 'E', 75, null),
  ('13E:ネックレス', '雲海の首飾り', 'アクセ', 'ネックレス', null, 13, 'E', 75, null),
  ('13L:片手剣', '天剣エーテル', '武器', '片手剣', null, 13, 'L', 80, null),
  ('13L:両手剣', '天穿つ大剣', '武器', '両手剣', null, 13, 'L', 80, null),
  ('13L:斧', '天落とし', '武器', '斧', null, 13, 'L', 80, null),
  ('13L:槍', '天空神槍', '武器', '槍', null, 13, 'L', 80, null),
  ('13L:鈍器', '浮遊城の礎', '武器', '鈍器', null, 13, 'L', 80, null),
  ('13L:短剣', '蒼の一閃', '武器', '短剣', null, 13, 'L', 80, null),
  ('13L:拳', '覇空拳', '武器', '拳', null, 13, 'L', 80, null),
  ('13L:弓', '暁天の弓', '武器', '弓', null, 13, 'L', 80, null),
  ('13L:銃', '城塞砲', '武器', '銃', null, 13, 'L', 80, null),
  ('13L:杖', '天空の王笏', '武器', '杖', null, 13, 'L', 80, null),
  ('13L:書', '浮遊城の秘録', '武器', '書', null, 13, 'L', 80, null),
  ('13L:投擲', '光輪', '武器', '投擲', null, 13, 'L', 80, null),
  ('13L:刀', '天叢雲', '武器', '刀', null, 13, 'L', 80, null),
  ('13L:宝珠', '浮遊の秘石', '武器', '宝珠', null, 13, 'L', 80, null),
  ('13L:重鎧頭', '天主の兜', '頭', '重鎧', '重鎧', 13, 'L', 80, null),
  ('13L:重鎧鎧', '天主の鎧', '鎧', '重鎧', '重鎧', 13, 'L', 80, null),
  ('13L:重鎧腕', '天主の篭手', '腕', '重鎧', '重鎧', 13, 'L', 80, null),
  ('13L:重鎧足', '天主の具足', '足', '重鎧', '重鎧', 13, 'L', 80, null),
  ('13L:軽装頭', '天翼の冠', '頭', '軽装', '軽装', 13, 'L', 80, null),
  ('13L:軽装鎧', '天翼の衣', '鎧', '軽装', '軽装', 13, 'L', 80, null),
  ('13L:軽装腕', '天翼の手袋', '腕', '軽装', '軽装', 13, 'L', 80, null),
  ('13L:軽装足', '天翼の靴', '足', '軽装', '軽装', 13, 'L', 80, null),
  ('13L:リング', '蒼天の指輪', 'アクセ', 'リング', null, 13, 'L', 80, null),
  ('13L:イヤリング', '天の囁き', 'アクセ', 'イヤリング', null, 13, 'L', 80, null),
  ('13L:ベルト', '天空の大帯', 'アクセ', 'ベルト', null, 13, 'L', 80, null),
  ('13L:ネックレス', '蒼穹の首飾り', 'アクセ', 'ネックレス', null, 13, 'L', 80, null),
  ('14N:片手剣', 'メテオソード', '武器', '片手剣', null, 14, 'N', 70, null),
  ('14N:両手剣', 'メテオクレイモア', '武器', '両手剣', null, 14, 'N', 70, null),
  ('14N:斧', 'メテオアクス', '武器', '斧', null, 14, 'N', 70, null),
  ('14N:槍', 'メテオスピア', '武器', '槍', null, 14, 'N', 70, null),
  ('14N:鈍器', 'メテオメイス', '武器', '鈍器', null, 14, 'N', 70, null),
  ('14N:短剣', 'メテオダガー', '武器', '短剣', null, 14, 'N', 70, null),
  ('14N:拳', 'メテオナックル', '武器', '拳', null, 14, 'N', 70, null),
  ('14N:弓', 'メテオボウ', '武器', '弓', null, 14, 'N', 70, null),
  ('14N:銃', 'メテオマグナム', '武器', '銃', null, 14, 'N', 70, null),
  ('14N:杖', 'メテオスタッフ', '武器', '杖', null, 14, 'N', 70, null),
  ('14N:書', '星辰録', '武器', '書', null, 14, 'N', 70, null),
  ('14N:投擲', 'メテオチャクラム', '武器', '投擲', null, 14, 'N', 70, null),
  ('14N:刀', 'メテオカタナ', '武器', '刀', null, 14, 'N', 70, null),
  ('14N:宝珠', 'スターサファイアオーブ', '武器', '宝珠', null, 14, 'N', 70, null),
  ('14N:重鎧頭', 'メテオヘルム', '頭', '重鎧', '重鎧', 14, 'N', 70, null),
  ('14N:重鎧鎧', 'メテオメイル', '鎧', '重鎧', '重鎧', 14, 'N', 70, null),
  ('14N:重鎧腕', 'メテオガントレット', '腕', '重鎧', '重鎧', 14, 'N', 70, null),
  ('14N:重鎧足', 'メテオグリーヴ', '足', '重鎧', '重鎧', 14, 'N', 70, null),
  ('14N:軽装頭', 'アストラルフード', '頭', '軽装', '軽装', 14, 'N', 70, null),
  ('14N:軽装鎧', 'アストラルコート', '鎧', '軽装', '軽装', 14, 'N', 70, null),
  ('14N:軽装腕', 'アストラルグローブ', '腕', '軽装', '軽装', 14, 'N', 70, null),
  ('14N:軽装足', 'アストラルブーツ', '足', '軽装', '軽装', 14, 'N', 70, null),
  ('14N:リング', 'スターサファイアリング', 'アクセ', 'リング', null, 14, 'N', 70, null),
  ('14N:イヤリング', 'スターサファイアイヤリング', 'アクセ', 'イヤリング', null, 14, 'N', 70, null),
  ('14N:ベルト', 'スターサファイアベルト', 'アクセ', 'ベルト', null, 14, 'N', 70, null),
  ('14N:ネックレス', 'スターサファイアネックレス', 'アクセ', 'ネックレス', null, 14, 'N', 70, null),
  ('14R:片手剣', '星屑の剣', '武器', '片手剣', null, 14, 'R', 75, null),
  ('14R:両手剣', '時断ちの大剣', '武器', '両手剣', null, 14, 'R', 75, null),
  ('14R:斧', 'オベリスクアクス', '武器', '斧', null, 14, 'R', 75, null),
  ('14R:槍', '流星槍', '武器', '槍', null, 14, 'R', 75, null),
  ('14R:鈍器', '天球の鎚', '武器', '鈍器', null, 14, 'R', 75, null),
  ('14R:短剣', 'ルナエッジ', '武器', '短剣', null, 14, 'R', 75, null),
  ('14R:拳', 'マンティコアクロー', '武器', '拳', null, 14, 'R', 75, null),
  ('14R:弓', '射手座の弓', '武器', '弓', null, 14, 'R', 75, null),
  ('14R:銃', '古代魔導砲', '武器', '銃', null, 14, 'R', 75, null),
  ('14R:杖', '時針の杖', '武器', '杖', null, 14, 'R', 75, null),
  ('14R:書', 'アカシックレコード', '武器', '書', null, 14, 'R', 75, null),
  ('14R:投擲', '星環', '武器', '投擲', null, 14, 'R', 75, null),
  ('14R:刀', '星見の太刀', '武器', '刀', null, 14, 'R', 75, null),
  ('14R:宝珠', '星読みの水晶球', '武器', '宝珠', null, 14, 'R', 75, null),
  ('14R:重鎧頭', '機兵の兜', '頭', '重鎧', '重鎧', 14, 'R', 75, null),
  ('14R:重鎧鎧', '機兵の装甲', '鎧', '重鎧', '重鎧', 14, 'R', 75, null),
  ('14R:重鎧腕', '機兵の篭手', '腕', '重鎧', '重鎧', 14, 'R', 75, null),
  ('14R:重鎧足', '機兵の脚甲', '足', '重鎧', '重鎧', 14, 'R', 75, null),
  ('14R:軽装頭', 'スターゲイザーハット', '頭', '軽装', '軽装', 14, 'R', 75, null),
  ('14R:軽装鎧', 'スターゲイザーローブ', '鎧', '軽装', '軽装', 14, 'R', 75, null),
  ('14R:軽装腕', 'スターゲイザーグローブ', '腕', '軽装', '軽装', 14, 'R', 75, null),
  ('14R:軽装足', 'スターゲイザーブーツ', '足', '軽装', '軽装', 14, 'R', 75, null),
  ('14R:リング', 'クロノリング', 'アクセ', 'リング', null, 14, 'R', 75, null),
  ('14R:イヤリング', '月蛾の耳飾り', 'アクセ', 'イヤリング', null, 14, 'R', 75, null),
  ('14R:ベルト', '星図の帯', 'アクセ', 'ベルト', null, 14, 'R', 75, null),
  ('14R:ネックレス', '砂時計のペンダント', 'アクセ', 'ネックレス', null, 14, 'R', 75, null),
  ('14E:片手剣', '遺物の剣', '武器', '片手剣', null, 14, 'E', 80, null),
  ('14E:両手剣', '古代柱の大剣', '武器', '両手剣', null, 14, 'E', 80, null),
  ('14E:斧', '遺跡の大斧', '武器', '斧', null, 14, 'E', 80, null),
  ('14E:槍', '観測台の槍', '武器', '槍', null, 14, 'E', 80, null),
  ('14E:鈍器', '石碑の鎚', '武器', '鈍器', null, 14, 'E', 80, null),
  ('14E:短剣', '秒針の短剣', '武器', '短剣', null, 14, 'E', 80, null),
  ('14E:拳', '隕鉄の拳', '武器', '拳', null, 14, 'E', 80, null),
  ('14E:弓', '夜空の弓', '武器', '弓', null, 14, 'E', 80, null),
  ('14E:銃', '遠望の長銃', '武器', '銃', null, 14, 'E', 80, null),
  ('14E:杖', '栞の杖', '武器', '杖', null, 14, 'E', 80, null),
  ('14E:書', '大書庫の蔵書', '武器', '書', null, 14, 'E', 80, null),
  ('14E:投擲', 'アストロラーベ', '武器', '投擲', null, 14, 'E', 80, null),
  ('14E:刀', '星月夜', '武器', '刀', null, 14, 'E', 80, null),
  ('14E:宝珠', '天文の宝珠', '武器', '宝珠', null, 14, 'E', 80, null),
  ('14E:重鎧頭', '星鉄の兜', '頭', '重鎧', '重鎧', 14, 'E', 80, null),
  ('14E:重鎧鎧', '星鉄の鎧', '鎧', '重鎧', '重鎧', 14, 'E', 80, null),
  ('14E:重鎧腕', '星鉄の篭手', '腕', '重鎧', '重鎧', 14, 'E', 80, null),
  ('14E:重鎧足', '星鉄の具足', '足', '重鎧', '重鎧', 14, 'E', 80, null),
  ('14E:軽装頭', '観測者の帽子', '頭', '軽装', '軽装', 14, 'E', 80, null),
  ('14E:軽装鎧', '観測者の外套', '鎧', '軽装', '軽装', 14, 'E', 80, null),
  ('14E:軽装腕', '観測者の手袋', '腕', '軽装', '軽装', 14, 'E', 80, null),
  ('14E:軽装足', '観測者の靴', '足', '軽装', '軽装', 14, 'E', 80, null),
  ('14E:リング', '風化した指輪', 'アクセ', 'リング', null, 14, 'E', 80, null),
  ('14E:イヤリング', '星明かりの耳飾り', 'アクセ', 'イヤリング', null, 14, 'E', 80, null),
  ('14E:ベルト', '古書の帯', 'アクセ', 'ベルト', null, 14, 'E', 80, null),
  ('14E:ネックレス', '時止まりの懐中時計', 'アクセ', 'ネックレス', null, 14, 'E', 80, null),
  ('14L:片手剣', '時剣カイロス', '武器', '片手剣', null, 14, 'L', 85, null),
  ('14L:両手剣', '星墜とし', '武器', '両手剣', null, 14, 'L', 85, null),
  ('14L:斧', '歳月の大斧', '武器', '斧', null, 14, 'L', 85, null),
  ('14L:槍', '星霜神槍', '武器', '槍', null, 14, 'L', 85, null),
  ('14L:鈍器', '天墜の鎚', '武器', '鈍器', null, 14, 'L', 85, null),
  ('14L:短剣', '永遠の一瞬', '武器', '短剣', null, 14, 'L', 85, null),
  ('14L:拳', '彗星拳', '武器', '拳', null, 14, 'L', 85, null),
  ('14L:弓', '星降る夜', '武器', '弓', null, 14, 'L', 85, null),
  ('14L:銃', '流星砲', '武器', '銃', null, 14, 'L', 85, null),
  ('14L:杖', '星詠みの大杖', '武器', '杖', null, 14, 'L', 85, null),
  ('14L:書', '時の大典', '武器', '書', null, 14, 'L', 85, null),
  ('14L:投擲', '天球儀', '武器', '投擲', null, 14, 'L', 85, null),
  ('14L:刀', '久遠', '武器', '刀', null, 14, 'L', 85, null),
  ('14L:宝珠', '星の記憶', '武器', '宝珠', null, 14, 'L', 85, null),
  ('14L:重鎧頭', '時守りの兜', '頭', '重鎧', '重鎧', 14, 'L', 85, null),
  ('14L:重鎧鎧', '時守りの鎧', '鎧', '重鎧', '重鎧', 14, 'L', 85, null),
  ('14L:重鎧腕', '時守りの篭手', '腕', '重鎧', '重鎧', 14, 'L', 85, null),
  ('14L:重鎧足', '時守りの具足', '足', '重鎧', '重鎧', 14, 'L', 85, null),
  ('14L:軽装頭', '星乙女の冠', '頭', '軽装', '軽装', 14, 'L', 85, null),
  ('14L:軽装鎧', '星乙女の衣', '鎧', '軽装', '軽装', 14, 'L', 85, null),
  ('14L:軽装腕', '星乙女の手袋', '腕', '軽装', '軽装', 14, 'L', 85, null),
  ('14L:軽装足', '星乙女の靴', '足', '軽装', '軽装', 14, 'L', 85, null),
  ('14L:リング', '刻限の指輪', 'アクセ', 'リング', null, 14, 'L', 85, null),
  ('14L:イヤリング', '星の雫', 'アクセ', 'イヤリング', null, 14, 'L', 85, null),
  ('14L:ベルト', '星座の帯', 'アクセ', 'ベルト', null, 14, 'L', 85, null),
  ('14L:ネックレス', '墜ちた星', 'アクセ', 'ネックレス', null, 14, 'L', 85, null),
  ('15N:片手剣', 'ジェネシスソード', '武器', '片手剣', null, 15, 'N', 75, null),
  ('15N:両手剣', 'ジェネシスクレイモア', '武器', '両手剣', null, 15, 'N', 75, null),
  ('15N:斧', 'ジェネシスアクス', '武器', '斧', null, 15, 'N', 75, null),
  ('15N:槍', 'ジェネシススピア', '武器', '槍', null, 15, 'N', 75, null),
  ('15N:鈍器', 'ジェネシスメイス', '武器', '鈍器', null, 15, 'N', 75, null),
  ('15N:短剣', 'ジェネシスダガー', '武器', '短剣', null, 15, 'N', 75, null),
  ('15N:拳', 'ジェネシスナックル', '武器', '拳', null, 15, 'N', 75, null),
  ('15N:弓', 'ジェネシスボウ', '武器', '弓', null, 15, 'N', 75, null),
  ('15N:銃', 'ジェネシスマグナム', '武器', '銃', null, 15, 'N', 75, null),
  ('15N:杖', 'ジェネシススタッフ', '武器', '杖', null, 15, 'N', 75, null),
  ('15N:書', '創世記', '武器', '書', null, 15, 'N', 75, null),
  ('15N:投擲', 'ジェネシスチャクラム', '武器', '投擲', null, 15, 'N', 75, null),
  ('15N:刀', 'ジェネシスカタナ', '武器', '刀', null, 15, 'N', 75, null),
  ('15N:宝珠', 'ブラックダイヤオーブ', '武器', '宝珠', null, 15, 'N', 75, null),
  ('15N:重鎧頭', 'ジェネシスヘルム', '頭', '重鎧', '重鎧', 15, 'N', 75, null),
  ('15N:重鎧鎧', 'ジェネシスメイル', '鎧', '重鎧', '重鎧', 15, 'N', 75, null),
  ('15N:重鎧腕', 'ジェネシスガントレット', '腕', '重鎧', '重鎧', 15, 'N', 75, null),
  ('15N:重鎧足', 'ジェネシスグリーヴ', '足', '重鎧', '重鎧', 15, 'N', 75, null),
  ('15N:軽装頭', 'ジェネシスフード', '頭', '軽装', '軽装', 15, 'N', 75, null),
  ('15N:軽装鎧', 'ジェネシスコート', '鎧', '軽装', '軽装', 15, 'N', 75, null),
  ('15N:軽装腕', 'ジェネシスグローブ', '腕', '軽装', '軽装', 15, 'N', 75, null),
  ('15N:軽装足', 'ジェネシスブーツ', '足', '軽装', '軽装', 15, 'N', 75, null),
  ('15N:リング', 'ブラックダイヤリング', 'アクセ', 'リング', null, 15, 'N', 75, null),
  ('15N:イヤリング', 'ブラックダイヤイヤリング', 'アクセ', 'イヤリング', null, 15, 'N', 75, null),
  ('15N:ベルト', 'ブラックダイヤベルト', 'アクセ', 'ベルト', null, 15, 'N', 75, null),
  ('15N:ネックレス', 'ブラックダイヤネックレス', 'アクセ', 'ネックレス', null, 15, 'N', 75, null),
  ('15R:片手剣', '古都の宝剣', '武器', '片手剣', null, 15, 'R', 80, null),
  ('15R:両手剣', 'アビスブリンガー', '武器', '両手剣', null, 15, 'R', 80, null),
  ('15R:斧', '鯨骨の斧', '武器', '斧', null, 15, 'R', 80, null),
  ('15R:槍', '海王の三叉槍', '武器', '槍', null, 15, 'R', 80, null),
  ('15R:鈍器', 'クラーケンの触腕', '武器', '鈍器', null, 15, 'R', 80, null),
  ('15R:短剣', 'メガロドンの歯', '武器', '短剣', null, 15, 'R', 80, null),
  ('15R:拳', 'サカマタナックル', '武器', '拳', null, 15, 'R', 80, null),
  ('15R:弓', 'ローレライの竪琴', '武器', '弓', null, 15, 'R', 80, null),
  ('15R:銃', 'ハープーンガン', '武器', '銃', null, 15, 'R', 80, null),
  ('15R:杖', '海魔女の杖', '武器', '杖', null, 15, 'R', 80, null),
  ('15R:書', '海底古文書', '武器', '書', null, 15, 'R', 80, null),
  ('15R:投擲', 'ルミナスディスク', '武器', '投擲', null, 15, 'R', 80, null),
  ('15R:刀', '黒潮', '武器', '刀', null, 15, 'R', 80, null),
  ('15R:宝珠', '深海の真珠球', '武器', '宝珠', null, 15, 'R', 80, null),
  ('15R:重鎧頭', 'リヴァイアヘルム', '頭', '重鎧', '重鎧', 15, 'R', 80, null),
  ('15R:重鎧鎧', 'リヴァイアメイル', '鎧', '重鎧', '重鎧', 15, 'R', 80, null),
  ('15R:重鎧腕', 'リヴァイアガントレット', '腕', '重鎧', '重鎧', 15, 'R', 80, null),
  ('15R:重鎧足', 'リヴァイアグリーヴ', '足', '重鎧', '重鎧', 15, 'R', 80, null),
  ('15R:軽装頭', '海淵の頭巾', '頭', '軽装', '軽装', 15, 'R', 80, null),
  ('15R:軽装鎧', '海淵の衣', '鎧', '軽装', '軽装', 15, 'R', 80, null),
  ('15R:軽装腕', '海淵の手袋', '腕', '軽装', '軽装', 15, 'R', 80, null),
  ('15R:軽装足', '海淵の靴', '足', '軽装', '軽装', 15, 'R', 80, null),
  ('15R:リング', '黒真珠の指輪', 'アクセ', 'リング', null, 15, 'R', 80, null),
  ('15R:イヤリング', '燐光の耳飾り', 'アクセ', 'イヤリング', null, 15, 'R', 80, null),
  ('15R:ベルト', '海竜鱗の帯', 'アクセ', 'ベルト', null, 15, 'R', 80, null),
  ('15R:ネックレス', '深淵の瞳', 'アクセ', 'ネックレス', null, 15, 'R', 80, null),
  ('15E:片手剣', '深潮の剣', '武器', '片手剣', null, 15, 'E', 85, null),
  ('15E:両手剣', '海溝の大剣', '武器', '両手剣', null, 15, 'E', 85, null),
  ('15E:斧', '暗礁の斧', '武器', '斧', null, 15, 'E', 85, null),
  ('15E:槍', '海棚の銛', '武器', '槍', null, 15, 'E', 85, null),
  ('15E:鈍器', '水底の鎚', '武器', '鈍器', null, 15, 'E', 85, null),
  ('15E:短剣', '無音の短剣', '武器', '短剣', null, 15, 'E', 85, null),
  ('15E:拳', '暗流の拳', '武器', '拳', null, 15, 'E', 85, null),
  ('15E:弓', '静海の弓', '武器', '弓', null, 15, 'E', 85, null),
  ('15E:銃', '水圧砲', '武器', '銃', null, 15, 'E', 85, null),
  ('15E:杖', '燐光の杖', '武器', '杖', null, 15, 'E', 85, null),
  ('15E:書', '海底都市誌', '武器', '書', null, 15, 'E', 85, null),
  ('15E:投擲', '泡沫の輪', '武器', '投擲', null, 15, 'E', 85, null),
  ('15E:刀', '沈黙丸', '武器', '刀', null, 15, 'E', 85, null),
  ('15E:宝珠', '夜光虫の宝珠', '武器', '宝珠', null, 15, 'E', 85, null),
  ('15E:重鎧頭', '深海鋼の兜', '頭', '重鎧', '重鎧', 15, 'E', 85, null),
  ('15E:重鎧鎧', '深海鋼の鎧', '鎧', '重鎧', '重鎧', 15, 'E', 85, null),
  ('15E:重鎧腕', '深海鋼の篭手', '腕', '重鎧', '重鎧', 15, 'E', 85, null),
  ('15E:重鎧足', '深海鋼の具足', '足', '重鎧', '重鎧', 15, 'E', 85, null),
  ('15E:軽装頭', '古都の頭巾', '頭', '軽装', '軽装', 15, 'E', 85, null),
  ('15E:軽装鎧', '古都の衣', '鎧', '軽装', '軽装', 15, 'E', 85, null),
  ('15E:軽装腕', '古都の手袋', '腕', '軽装', '軽装', 15, 'E', 85, null),
  ('15E:軽装足', '古都の靴', '足', '軽装', '軽装', 15, 'E', 85, null),
  ('15E:リング', '古代貨幣の指輪', 'アクセ', 'リング', null, 15, 'E', 85, null),
  ('15E:イヤリング', '海蛍の耳飾り', 'アクセ', 'イヤリング', null, 15, 'E', 85, null),
  ('15E:ベルト', '海藻編みの帯', 'アクセ', 'ベルト', null, 15, 'E', 85, null),
  ('15E:ネックレス', '深渦の首飾り', 'アクセ', 'ネックレス', null, 15, 'E', 85, null),
  ('15L:片手剣', '原初剣タラッサ', '武器', '片手剣', null, 15, 'L', 90, null),
  ('15L:両手剣', '世界の果て', '武器', '両手剣', null, 15, 'L', 90, null),
  ('15L:斧', '海底割り', '武器', '斧', null, 15, 'L', 90, null),
  ('15L:槍', '深淵神槍', '武器', '槍', null, 15, 'L', 90, null),
  ('15L:鈍器', '大いなる鼓動', '武器', '鈍器', null, 15, 'L', 90, null),
  ('15L:短剣', '深海の夢', '武器', '短剣', null, 15, 'L', 90, null),
  ('15L:拳', '混沌拳', '武器', '拳', null, 15, 'L', 90, null),
  ('15L:弓', '虚空の弓', '武器', '弓', null, 15, 'L', 90, null),
  ('15L:銃', '海嘯砲', '武器', '銃', null, 15, 'L', 90, null),
  ('15L:杖', '万物の杖', '武器', '杖', null, 15, 'L', 90, null),
  ('15L:書', '深淵の黙示録', '武器', '書', null, 15, 'L', 90, null),
  ('15L:投擲', '輪廻の輪', '武器', '投擲', null, 15, 'L', 90, null),
  ('15L:刀', '凪', '武器', '刀', null, 15, 'L', 90, null),
  ('15L:宝珠', '生命の源', '武器', '宝珠', null, 15, 'L', 90, null),
  ('15L:重鎧頭', '深淵王の兜', '頭', '重鎧', '重鎧', 15, 'L', 90, null),
  ('15L:重鎧鎧', '深淵王の鎧', '鎧', '重鎧', '重鎧', 15, 'L', 90, null),
  ('15L:重鎧腕', '深淵王の篭手', '腕', '重鎧', '重鎧', 15, 'L', 90, null),
  ('15L:重鎧足', '深淵王の具足', '足', '重鎧', '重鎧', 15, 'L', 90, null),
  ('15L:軽装頭', '水神の冠', '頭', '軽装', '軽装', 15, 'L', 90, null),
  ('15L:軽装鎧', '水神の衣', '鎧', '軽装', '軽装', 15, 'L', 90, null),
  ('15L:軽装腕', '水神の手袋', '腕', '軽装', '軽装', 15, 'L', 90, null),
  ('15L:軽装足', '水神の靴', '足', '軽装', '軽装', 15, 'L', 90, null),
  ('15L:リング', '最果ての指輪', 'アクセ', 'リング', null, 15, 'L', 90, null),
  ('15L:イヤリング', '海の声', 'アクセ', 'イヤリング', null, 15, 'L', 90, null),
  ('15L:ベルト', '深海の大帯', 'アクセ', 'ベルト', null, 15, 'L', 90, null),
  ('15L:ネックレス', '原初の真珠', 'アクセ', 'ネックレス', null, 15, 'L', 90, null),
  ('0N:刀', '見習いの刀', '武器', '刀', null, 0, 'N', 1, null),
  ('0N:両手剣', '見習いの大剣', '武器', '両手剣', null, 0, 'N', 1, null),
  ('0N:槍', '見習いの槍', '武器', '槍', null, 0, 'N', 1, null),
  ('0N:拳', '見習いの拳当て', '武器', '拳', null, 0, 'N', 1, null),
  ('0N:短剣', '見習いの短剣', '武器', '短剣', null, 0, 'N', 1, null),
  ('0N:弓', '見習いの弓', '武器', '弓', null, 0, 'N', 1, null),
  ('0N:銃', '見習いの銃', '武器', '銃', null, 0, 'N', 1, null),
  ('0N:杖', '見習いの杖', '武器', '杖', null, 0, 'N', 1, null),
  ('0N:書', '見習いの書', '武器', '書', null, 0, 'N', 1, null),
  ('0N:重鎧頭', '見習いの兜', '頭', '重鎧', '重鎧', 0, 'N', 1, null),
  ('0N:重鎧鎧', '見習いの鎧', '鎧', '重鎧', '重鎧', 0, 'N', 1, null),
  ('0N:重鎧腕', '見習いの籠手', '腕', '重鎧', '重鎧', 0, 'N', 1, null),
  ('0N:重鎧足', '見習いの具足', '足', '重鎧', '重鎧', 0, 'N', 1, null),
  ('0N:軽装頭', '見習いの帽子', '頭', '軽装', '軽装', 0, 'N', 1, null),
  ('0N:軽装鎧', '見習いの服', '鎧', '軽装', '軽装', 0, 'N', 1, null),
  ('0N:軽装腕', '見習いの手袋', '腕', '軽装', '軽装', 0, 'N', 1, null),
  ('0N:軽装足', '見習いの靴', '足', '軽装', '軽装', 0, 'N', 1, null),
  ('0N:イヤリング', '古びた耳飾り', 'アクセ', 'イヤリング', null, 0, 'N', 1, null),
  ('0N:リング', '古びた指輪', 'アクセ', 'リング', null, 0, 'N', 1, null),
  ('U1:短剣', '蝕毒の牙', '武器', '短剣', null, 1, 'U', 80, 1),
  ('U2:重鎧鎧', '巣母の甲殻鎧', '鎧', '重鎧', '重鎧', 1, 'U', 80, 2),
  ('U3:片手剣', '蒼蝕の魔剣', '武器', '片手剣', null, 1, 'U', 80, 3),
  ('U3:リング', 'ビッグスライムの指輪', 'アクセ', 'リング', null, 1, 'U', 80, 3),
  ('U4:両手剣', 'ブラッドハウル', '武器', '両手剣', null, 2, 'U', 80, 4),
  ('U5:ベルト', 'ウォードラムベルト', 'アクセ', 'ベルト', null, 2, 'U', 80, 5),
  ('U6:短剣', '簒奪の刃', '武器', '短剣', null, 2, 'U', 80, 6),
  ('U6:軽装足', '影縫いのブーツ', '足', '軽装', '軽装', 2, 'U', 80, 6),
  ('U7:斧', 'ケイヴキーパー', '武器', '斧', null, 3, 'U', 80, 7),
  ('U8:重鎧頭', '亡将の鉄兜', '頭', '重鎧', '重鎧', 3, 'U', 80, 8),
  ('U9:ネックレス', '番人の心核', 'アクセ', 'ネックレス', null, 3, 'U', 80, 9),
  ('U9:杖', '虚葬の錫杖', '武器', '杖', null, 3, 'U', 80, 9),
  ('U10:重鎧腕', '磯蟹の大篭手', '腕', '重鎧', '重鎧', 4, 'U', 80, 10),
  ('U11:片手剣', '黒潮のカトラス', '武器', '片手剣', null, 4, 'U', 80, 11),
  ('U12:ネックレス', '海竜の蒼鱗', 'アクセ', 'ネックレス', null, 4, 'U', 80, 12),
  ('U12:軽装頭', 'タイダルクラウン', '頭', '軽装', '軽装', 4, 'U', 80, 12),
  ('U13:投擲', 'サンドトラップ', '武器', '投擲', null, 5, 'U', 80, 13),
  ('U14:軽装頭', 'フューネラルクラウン', '頭', '軽装', '軽装', 5, 'U', 80, 14),
  ('U15:投擲', 'ソリスティス', '武器', '投擲', null, 5, 'U', 80, 15),
  ('U15:重鎧頭', 'ケプリの仮面', '頭', '重鎧', '重鎧', 5, 'U', 80, 15),
  ('U16:軽装鎧', '熊王の戦装束', '鎧', '軽装', '軽装', 6, 'U', 80, 16),
  ('U17:ベルト', '不死身の大帯', 'アクセ', 'ベルト', null, 6, 'U', 80, 17),
  ('U18:拳', '嵐鷲の爪牙', '武器', '拳', null, 6, 'U', 80, 18),
  ('U18:重鎧鎧', '嵐纏の重鎧', '鎧', '重鎧', '重鎧', 6, 'U', 80, 18),
  ('U19:イヤリング', 'ダスクウィングピアス', 'アクセ', 'イヤリング', null, 7, 'U', 80, 19),
  ('U20:宝珠', 'ミストシーア', '武器', '宝珠', null, 7, 'U', 80, 20),
  ('U21:重鎧足', '千年根の具足', '足', '重鎧', '重鎧', 7, 'U', 80, 21),
  ('U21:書', '年輪の書', '武器', '書', null, 7, 'U', 80, 21),
  ('U22:槍', '永久凍牙', '武器', '槍', null, 8, 'U', 80, 22),
  ('U23:宝珠', 'プリズムハート', '武器', '宝珠', null, 8, 'U', 80, 23),
  ('U24:銃', '絶零の魔導砲', '武器', '銃', null, 8, 'U', 80, 24),
  ('U24:重鎧鎧', 'フロストバーンの聖鎧', '鎧', '重鎧', '重鎧', 8, 'U', 80, 24),
  ('U25:刀', '妖刀・鵺斬', '武器', '刀', null, 9, 'U', 80, 25),
  ('U26:鈍器', 'サンダーフォール', '武器', '鈍器', null, 9, 'U', 80, 26),
  ('U27:イヤリング', 'ストームロードピアス', 'アクセ', 'イヤリング', null, 9, 'U', 80, 27),
  ('U27:重鎧腕', '天罰の剛甲', '腕', '重鎧', '重鎧', 9, 'U', 80, 27),
  ('U28:重鎧頭', '亀甲の大兜', '頭', '重鎧', '重鎧', 10, 'U', 80, 28),
  ('U29:軽装腕', '炎竜鱗の手甲', '腕', '軽装', '軽装', 10, 'U', 80, 29),
  ('U30:リング', '深紅の牙輪', 'アクセ', 'リング', null, 10, 'U', 80, 30),
  ('U30:イヤリング', '深紅の魔眼石', 'アクセ', 'イヤリング', null, 10, 'U', 80, 30),
  ('U31:斧', 'デスロール', '武器', '斧', null, 11, 'U', 80, 31),
  ('U32:杖', 'カースバインド', '武器', '杖', null, 11, 'U', 80, 32),
  ('U33:軽装鎧', '九頭の鱗衣', '鎧', '軽装', '軽装', 11, 'U', 80, 33),
  ('U33:弓', 'ブライトレイン', '武器', '弓', null, 11, 'U', 80, 33),
  ('U34:拳', 'パンツァーブレッヒャー', '武器', '拳', null, 12, 'U', 80, 34),
  ('U35:軽装鎧', 'シャドウシルクドレス', '鎧', '軽装', '軽装', 12, 'U', 80, 35),
  ('U36:両手剣', 'ベルクシュパルター', '武器', '両手剣', null, 12, 'U', 80, 36),
  ('U36:重鎧足', '地潜りの鉄靴', '足', '重鎧', '重鎧', 12, 'U', 80, 36),
  ('U37:軽装足', 'エウロスブーツ', '足', '軽装', '軽装', 13, 'U', 80, 37),
  ('U38:槍', '聖光の旗槍', '武器', '槍', null, 13, 'U', 80, 38),
  ('U39:銃', 'ウラノスの天砲', '武器', '銃', null, 13, 'U', 80, 39),
  ('U39:リング', '蒼天龍の指輪', 'アクセ', 'リング', null, 13, 'U', 80, 39),
  ('U40:ベルト', 'クロックワークベルト', 'アクセ', 'ベルト', null, 14, 'U', 80, 40),
  ('U41:書', '禁書アポクリファ', '武器', '書', null, 14, 'U', 80, 41),
  ('U42:刀', '刹那の星刀', '武器', '刀', null, 14, 'U', 80, 42),
  ('U42:弓', '刻弓レトログラー', '武器', '弓', null, 14, 'U', 80, 42),
  ('U43:軽装腕', '常若の手甲', '腕', '軽装', '軽装', 15, 'U', 80, 43),
  ('U44:鈍器', 'ヴァンドルング', '武器', '鈍器', null, 15, 'U', 80, 44),
  ('U45:ネックレス', '海王の潮汐ペンダント', 'アクセ', 'ネックレス', null, 15, 'U', 80, 45),
  ('U45:重鎧足', '深淵歩きの脚甲', '足', '重鎧', '重鎧', 15, 'U', 80, 45)
on conflict (id) do update set name = excluded.name, part = excluded.part, type = excluded.type, line = excluded.line,
  area = excluded.area, rarity = excluded.rarity, lv = excluded.lv, spot = excluded.spot;
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
  lv_max     int  not null,
  rec_lv     int  not null default 1
);
-- 前の形（ランクの重み drop_ranks）の列を消す。★種を入れる前に（列が残っていると入れられない）
alter table public.v2cap_spots drop column if exists drop_ranks;
-- 推奨LVの上限（ボスを倒せる目安のLV・2026-10-12 ユーザー指示「推奨レベル」）。デイリーミッションと宝樹のEXPで「そのLVの推奨の場所」を引く（areas.js の SPOT_REC_LV）
alter table public.v2cap_spots add column if not exists rec_lv int not null default 1;
-- 前の形（アイテムLVを場所ごとに持っていた item_lv）の列も消す。アイテムLVは装備の必要LV（v2cap_equipment.lv）
alter table public.v2cap_spots drop column if exists item_lv;
alter table public.v2cap_spots enable row level security;
drop policy if exists v2cap_spots_read on public.v2cap_spots;
create policy v2cap_spots_read on public.v2cap_spots for select to authenticated using (true);
revoke all on table public.v2cap_spots from anon;
grant select on table public.v2cap_spots to authenticated;

-- @@seed:spots
delete from public.v2cap_spots;
insert into public.v2cap_spots (id, area, sub, area_name, name, exp_min, exp_max, gold_min, gold_max, lv_min, lv_max, rec_lv) values
  (1, 1, 1, '始まりの森', '木漏れ日の小径', 2, 3, 10, 15, 1, 10, 5),
  (2, 1, 2, '始まりの森', '苔むした獣道', 2, 4, 10, 17, 1, 12, 15),
  (3, 1, 3, '始まりの森', '森主の古樹', 3, 5, 10, 20, 10, 15, 18),
  (4, 2, 1, '荒廃した草原', '風吹く丘陵', 4, 5, 15, 20, 16, 17, 20),
  (5, 2, 2, '荒廃した草原', '焼け落ちた廃村', 4, 6, 15, 22, 16, 18, 22),
  (6, 2, 3, '荒廃した草原', '骸の古戦場', 5, 7, 15, 25, 17, 20, 25),
  (7, 3, 1, '古代の洞窟', '鍾乳の回廊', 6, 7, 20, 25, 21, 22, 27),
  (8, 3, 2, '古代の洞窟', '刻印の大広間', 6, 8, 20, 27, 21, 23, 29),
  (9, 3, 3, '古代の洞窟', '封じられし石室', 7, 9, 20, 30, 22, 26, 31),
  (10, 4, 1, '蒼海の入り江', '白砂の浜辺', 8, 9, 25, 30, 27, 27, 33),
  (11, 4, 2, '蒼海の入り江', '難破船の墓場', 8, 10, 25, 32, 27, 29, 34),
  (12, 4, 3, '蒼海の入り江', '大渦の海蝕洞', 9, 11, 25, 35, 27, 30, 37),
  (13, 5, 1, '灼砂の遺丘', '陽炎の砂原', 10, 11, 30, 35, 31, 31, 38),
  (14, 5, 2, '灼砂の遺丘', '埋もれし神殿', 10, 12, 30, 37, 31, 32, 39),
  (15, 5, 3, '灼砂の遺丘', '砂王の玄室', 11, 13, 30, 40, 31, 34, 41),
  (16, 6, 1, '巨峰山脈', '岩肌の山道', 12, 13, 35, 40, 35, 37, 44),
  (17, 6, 2, '巨峰山脈', '風哭きの峠', 12, 14, 35, 42, 35, 39, 47),
  (18, 6, 3, '巨峰山脈', '天衝く頂', 13, 15, 35, 45, 37, 43, 52),
  (19, 7, 1, '常闇の樹海', '黄昏の境界', 14, 15, 40, 45, 44, 45, 54),
  (20, 7, 2, '常闇の樹海', '惑い霧の迷路', 14, 16, 40, 47, 44, 46, 56),
  (21, 7, 3, '常闇の樹海', '光喰らいの大樹', 15, 17, 40, 50, 45, 49, 59),
  (22, 8, 1, '白銀の霊峰', '凍てつく雪原', 16, 17, 45, 50, 50, 51, 60),
  (23, 8, 2, '白銀の霊峰', '氷晶の大洞', 16, 18, 45, 52, 50, 53, 62),
  (24, 8, 3, '白銀の霊峰', '白霊の祭壇', 17, 19, 45, 55, 51, 56, 64),
  (25, 9, 1, '雷鳴の断崖', '稲光の岩棚', 18, 19, 50, 55, 57, 58, 65),
  (26, 9, 2, '雷鳴の断崖', '轟雷の架け橋', 18, 20, 50, 57, 57, 59, 66),
  (27, 9, 3, '雷鳴の断崖', '雷帝の玉座', 19, 21, 50, 60, 58, 62, 68),
  (28, 10, 1, '煉獄火山', '噴煙の山麓', 20, 21, 55, 60, 63, 63, 69),
  (29, 10, 2, '煉獄火山', '溶岩の大河', 20, 22, 55, 62, 63, 64, 70),
  (30, 10, 3, '煉獄火山', '業火の炉心', 21, 23, 55, 65, 63, 65, 71),
  (31, 11, 1, '腐海の沼獄', '瘴気漂う湿原', 22, 23, 60, 65, 66, 66, 71),
  (32, 11, 2, '腐海の沼獄', '沈みし廃村', 22, 24, 60, 67, 66, 67, 72),
  (33, 11, 3, '腐海の沼獄', '腐王の苗床', 23, 25, 60, 70, 66, 68, 73),
  (34, 12, 1, '奈落の坑道', '廃れた採掘場', 24, 25, 65, 70, 69, 69, 73),
  (35, 12, 2, '奈落の坑道', '底なしの大縦穴', 24, 26, 65, 72, 69, 70, 74),
  (36, 12, 3, '奈落の坑道', '掘り当てられし禁域', 25, 27, 65, 75, 69, 71, 75),
  (37, 13, 1, '蒼天の浮遊城', '雲海の桟橋', 26, 27, 70, 75, 72, 72, 75),
  (38, 13, 2, '蒼天の浮遊城', '浮かぶ空中庭園', 26, 28, 70, 77, 72, 73, 75),
  (39, 13, 3, '蒼天の浮遊城', '天主の謁見の間', 27, 29, 70, 80, 72, 74, 77),
  (40, 14, 1, '星霜の遺跡', '風化した列柱廊', 28, 29, 75, 80, 75, 75, 77),
  (41, 14, 2, '星霜の遺跡', '時止まりの大書庫', 28, 30, 75, 82, 75, 76, 77),
  (42, 14, 3, '星霜の遺跡', '星墜ちる観測台', 29, 31, 75, 85, 75, 77, 79),
  (43, 15, 1, '深淵の海溝', '燐光の海棚', 30, 31, 80, 85, 78, 78, 79),
  (44, 15, 2, '深淵の海溝', '沈みし古都', 30, 32, 80, 87, 78, 79, 79),
  (45, 15, 3, '深淵の海溝', '原初の深淵', 31, 33, 80, 90, 78, 80, 80);
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
  ('ツユフェアリー', 2, 11, 'timed', '朝'),
  ('モヤガエル', 2, 11, 'timed', '朝'),
  ('ひなたトカゲ', 2, 11, 'timed', '昼'),
  ('ひなたアゲハ', 2, 11, 'timed', '昼'),
  ('ツキミミズク', 2, 11, 'timed', '晩'),
  ('ヨナキコオロギ', 2, 11, 'timed', '晩'),
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
  ('ツユフェアリー', 3, 13, 'timed', '朝'),
  ('モヤガエル', 3, 13, 'timed', '朝'),
  ('ひなたトカゲ', 3, 13, 'timed', '昼'),
  ('ひなたアゲハ', 3, 13, 'timed', '昼'),
  ('ツキミミズク', 3, 13, 'timed', '晩'),
  ('ヨナキコオロギ', 3, 13, 'timed', '晩'),
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
  ('霧這いワーム', 5, 18, 'timed', '朝'),
  ('オオトビバッタ', 5, 18, 'timed', '朝'),
  ('陽炎リザード', 5, 18, 'timed', '昼'),
  ('炎天ハゲタカ', 5, 18, 'timed', '昼'),
  ('夜盗スカウト', 5, 18, 'timed', '晩'),
  ('夜盗ハウンド', 5, 18, 'timed', '晩'),
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
  ('霧這いワーム', 6, 19, 'timed', '朝'),
  ('オオトビバッタ', 6, 19, 'timed', '朝'),
  ('陽炎リザード', 6, 19, 'timed', '昼'),
  ('炎天ハゲタカ', 6, 19, 'timed', '昼'),
  ('夜盗スカウト', 6, 19, 'timed', '晩'),
  ('夜盗ハウンド', 6, 19, 'timed', '晩'),
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
  ('暁ガーゴイル', 8, 23, 'timed', '朝'),
  ('ヨロイムカデ', 8, 23, 'timed', '朝'),
  ('石化トカゲ', 8, 23, 'timed', '昼'),
  ('イワサソリ', 8, 23, 'timed', '昼'),
  ('サマヨイレイス', 8, 23, 'timed', '晩'),
  ('亡霊コボルト', 8, 23, 'timed', '晩'),
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
  ('暁ガーゴイル', 9, 24, 'timed', '朝'),
  ('ヨロイムカデ', 9, 24, 'timed', '朝'),
  ('石化トカゲ', 9, 24, 'timed', '昼'),
  ('イワサソリ', 9, 24, 'timed', '昼'),
  ('サマヨイレイス', 9, 24, 'timed', '晩'),
  ('亡霊コボルト', 9, 24, 'timed', '晩'),
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
  ('朝凪のセイレーン', 11, 28, 'timed', '朝'),
  ('ギンバネトビウオ', 11, 28, 'timed', '朝'),
  ('シオマネキ', 11, 28, 'timed', '昼'),
  ('オオウミガメ', 11, 28, 'timed', '昼'),
  ('夜光アンコウ', 11, 28, 'timed', '晩'),
  ('ホタルダコ', 11, 28, 'timed', '晩'),
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
  ('朝凪のセイレーン', 12, 30, 'timed', '朝'),
  ('ギンバネトビウオ', 12, 30, 'timed', '朝'),
  ('シオマネキ', 12, 30, 'timed', '昼'),
  ('オオウミガメ', 12, 30, 'timed', '昼'),
  ('夜光アンコウ', 12, 30, 'timed', '晩'),
  ('ホタルダコ', 12, 30, 'timed', '晩'),
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
  ('カゲロウトカゲ', 14, 32, 'timed', '朝'),
  ('聖スカラベ', 14, 32, 'timed', '朝'),
  ('アヌビス兵', 14, 32, 'timed', '昼'),
  ('熱砂コブラ', 14, 32, 'timed', '昼'),
  ('月影ジャッカル', 14, 32, 'timed', '晩'),
  ('ワライハイエナ', 14, 32, 'timed', '晩'),
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
  ('カゲロウトカゲ', 15, 33, 'timed', '朝'),
  ('聖スカラベ', 15, 33, 'timed', '朝'),
  ('アヌビス兵', 15, 33, 'timed', '昼'),
  ('熱砂コブラ', 15, 33, 'timed', '昼'),
  ('月影ジャッカル', 15, 33, 'timed', '晩'),
  ('ワライハイエナ', 15, 33, 'timed', '晩'),
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
  ('払暁のワイバーン', 17, 38, 'timed', '朝'),
  ('ハヤテハヤブサ', 17, 38, 'timed', '朝'),
  ('剛猿', 17, 38, 'timed', '昼'),
  ('鉄針ヤマアラシ', 17, 38, 'timed', '昼'),
  ('宵闇ヤマネコ', 17, 38, 'timed', '晩'),
  ('トオボエウルフ', 17, 38, 'timed', '晩'),
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
  ('払暁のワイバーン', 18, 40, 'timed', '朝'),
  ('ハヤテハヤブサ', 18, 40, 'timed', '朝'),
  ('剛猿', 18, 40, 'timed', '昼'),
  ('鉄針ヤマアラシ', 18, 40, 'timed', '昼'),
  ('宵闇ヤマネコ', 18, 40, 'timed', '晩'),
  ('トオボエウルフ', 18, 40, 'timed', '晩'),
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
  ('霧纏いトレント', 20, 46, 'timed', '朝'),
  ('胞子マイコニド', 20, 46, 'timed', '朝'),
  ('コモレビピクシー', 20, 46, 'timed', '昼'),
  ('ヨロイカブト', 20, 46, 'timed', '昼'),
  ('ナゲキバンシー', 20, 46, 'timed', '晩'),
  ('チスイオオコウモリ', 20, 46, 'timed', '晩'),
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
  ('霧纏いトレント', 21, 47, 'timed', '朝'),
  ('胞子マイコニド', 21, 47, 'timed', '朝'),
  ('コモレビピクシー', 21, 47, 'timed', '昼'),
  ('ヨロイカブト', 21, 47, 'timed', '昼'),
  ('ナゲキバンシー', 21, 47, 'timed', '晩'),
  ('チスイオオコウモリ', 21, 47, 'timed', '晩'),
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
  ('銀嶺ウルフ', 23, 52, 'timed', '朝'),
  ('アイスエルク', 23, 52, 'timed', '朝'),
  ('樹氷精', 23, 52, 'timed', '昼'),
  ('スノーハーピー', 23, 52, 'timed', '昼'),
  ('極夜ワイト', 23, 52, 'timed', '晩'),
  ('フロストリッチ', 23, 52, 'timed', '晩'),
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
  ('銀嶺ウルフ', 24, 54, 'timed', '朝'),
  ('アイスエルク', 24, 54, 'timed', '朝'),
  ('樹氷精', 24, 54, 'timed', '昼'),
  ('スノーハーピー', 24, 54, 'timed', '昼'),
  ('極夜ワイト', 24, 54, 'timed', '晩'),
  ('フロストリッチ', 24, 54, 'timed', '晩'),
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
  ('サンダーホーク', 26, 59, 'timed', '朝'),
  ('ヒポグリフ', 26, 59, 'timed', '朝'),
  ('雷精', 26, 59, 'timed', '昼'),
  ('迅雷ドレイク', 26, 59, 'timed', '昼'),
  ('雷雲ワイバーン', 26, 59, 'timed', '晩'),
  ('ストームハーピー', 26, 59, 'timed', '晩'),
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
  ('サンダーホーク', 27, 60, 'timed', '朝'),
  ('ヒポグリフ', 27, 60, 'timed', '朝'),
  ('雷精', 27, 60, 'timed', '昼'),
  ('迅雷ドレイク', 27, 60, 'timed', '昼'),
  ('雷雲ワイバーン', 27, 60, 'timed', '晩'),
  ('ストームハーピー', 27, 60, 'timed', '晩'),
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
  ('フレイムバット', 29, 64, 'timed', '朝'),
  ('雛フェニックス', 29, 64, 'timed', '朝'),
  ('イフリート', 29, 64, 'timed', '昼'),
  ('火吹きトカゲ', 29, 64, 'timed', '昼'),
  ('熾火デーモン', 29, 64, 'timed', '晩'),
  ('鬼火', 29, 64, 'timed', '晩'),
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
  ('フレイムバット', 30, 65, 'timed', '朝'),
  ('雛フェニックス', 30, 65, 'timed', '朝'),
  ('イフリート', 30, 65, 'timed', '昼'),
  ('火吹きトカゲ', 30, 65, 'timed', '昼'),
  ('熾火デーモン', 30, 65, 'timed', '晩'),
  ('鬼火', 30, 65, 'timed', '晩'),
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
  ('ウィルオウィスプ', 32, 67, 'timed', '朝'),
  ('オオヒル', 32, 67, 'timed', '朝'),
  ('オオヒキガエル', 32, 67, 'timed', '昼'),
  ('カミツキガメ', 32, 67, 'timed', '昼'),
  ('ドロゾンビ', 32, 67, 'timed', '晩'),
  ('コカトリス', 32, 67, 'timed', '晩'),
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
  ('ウィルオウィスプ', 33, 68, 'timed', '朝'),
  ('オオヒル', 33, 68, 'timed', '朝'),
  ('オオヒキガエル', 33, 68, 'timed', '昼'),
  ('カミツキガメ', 33, 68, 'timed', '昼'),
  ('ドロゾンビ', 33, 68, 'timed', '晩'),
  ('コカトリス', 33, 68, 'timed', '晩'),
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
  ('クリスタルワーム', 35, 70, 'timed', '朝'),
  ('クリスタルビートル', 35, 70, 'timed', '朝'),
  ('ドワーフレイス', 35, 70, 'timed', '昼'),
  ('狂乱ドワーフ', 35, 70, 'timed', '昼'),
  ('うごめく影', 35, 70, 'timed', '晩'),
  ('奈落グモ', 35, 70, 'timed', '晩'),
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
  ('クリスタルワーム', 36, 71, 'timed', '朝'),
  ('クリスタルビートル', 36, 71, 'timed', '朝'),
  ('ドワーフレイス', 36, 71, 'timed', '昼'),
  ('狂乱ドワーフ', 36, 71, 'timed', '昼'),
  ('うごめく影', 36, 71, 'timed', '晩'),
  ('奈落グモ', 36, 71, 'timed', '晩'),
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
  ('セラフ', 38, 73, 'timed', '朝'),
  ('ケルビム', 38, 73, 'timed', '朝'),
  ('ペガサス', 38, 73, 'timed', '昼'),
  ('ユニコーン', 38, 73, 'timed', '昼'),
  ('星降りのヴァルキリー', 38, 73, 'timed', '晩'),
  ('ナイトメア', 38, 73, 'timed', '晩'),
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
  ('セラフ', 39, 74, 'timed', '朝'),
  ('ケルビム', 39, 74, 'timed', '朝'),
  ('ペガサス', 39, 74, 'timed', '昼'),
  ('ユニコーン', 39, 74, 'timed', '昼'),
  ('星降りのヴァルキリー', 39, 74, 'timed', '晩'),
  ('ナイトメア', 39, 74, 'timed', '晩'),
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
  ('アストラルナイト', 41, 76, 'timed', '朝'),
  ('ケンタウロス', 41, 76, 'timed', '朝'),
  ('スフィンクス', 41, 76, 'timed', '昼'),
  ('マンティコア', 41, 76, 'timed', '昼'),
  ('ルナウルフ', 41, 76, 'timed', '晩'),
  ('月蛾', 41, 76, 'timed', '晩'),
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
  ('アストラルナイト', 42, 77, 'timed', '朝'),
  ('ケンタウロス', 42, 77, 'timed', '朝'),
  ('スフィンクス', 42, 77, 'timed', '昼'),
  ('マンティコア', 42, 77, 'timed', '昼'),
  ('ルナウルフ', 42, 77, 'timed', '晩'),
  ('月蛾', 42, 77, 'timed', '晩'),
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
  ('海竜', 44, 79, 'timed', '朝'),
  ('サカマタ', 44, 79, 'timed', '朝'),
  ('巨鯨', 44, 79, 'timed', '昼'),
  ('グランマンタ', 44, 79, 'timed', '昼'),
  ('ローレライ', 44, 79, 'timed', '晩'),
  ('ダイオウグソクムシ', 44, 79, 'timed', '晩'),
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
  ('海竜', 45, 80, 'timed', '朝'),
  ('サカマタ', 45, 80, 'timed', '朝'),
  ('巨鯨', 45, 80, 'timed', '昼'),
  ('グランマンタ', 45, 80, 'timed', '昼'),
  ('ローレライ', 45, 80, 'timed', '晩'),
  ('ダイオウグソクムシ', 45, 80, 'timed', '晩'),
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
-- ★はじめは仮の「出撃に10回勝つ」1つ。2026-10-15 ユーザー指示で「装備を強化または分解する」「塔に挑戦する」「宝樹に祈る」を足した。
--   種は src/v2cap/lib/daily.js の DAILY_TASKS から tools/v2cap-sql.mjs が作る（足したら数える所＝v2cap_daily_bump も足す）
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
delete from public.v2cap_daily_tasks where key <> all('{win,smith,tower,pray}'::text[]);
insert into public.v2cap_daily_tasks (key, label, goal, sort) values
  ('win', '出撃に勝つ', 10, 1),
  ('smith', '装備を強化または分解する', 1, 2),
  ('tower', 'ジークヴァルトの覇天塔に挑戦する', 1, 3),
  ('pray', 'ユグレシアの宝樹に祈りをささげる', 1, 4)
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
-- ★2026-10-14 毎日祈ったときのボーナス：何日続けて祈っているか（日本時間の5時区切り・1日でも空くと1に戻る）。0＝まだ数えていない
alter table public.v2cap_profiles add column if not exists pray_streak int not null default 0;
-- ★2026-10-13 安息の祠（§5・src/v2cap/lib/shrine.js）：祠のある場所（null＝祠にいない）・最深部までの残りの戦闘の数・全部の数。キャラは消さない
alter table public.v2cap_profiles add column if not exists shrine_spot int;
alter table public.v2cap_profiles add column if not exists shrine_left int not null default 0;
alter table public.v2cap_profiles add column if not exists shrine_total int not null default 0;
-- 開発用（2026-10-14）：次の祠の外の出撃で必ず祠を見つける（v2cap_debug_shrine_next が付け、見つけたら外れる）
alter table public.v2cap_profiles add column if not exists shrine_force boolean not null default false;
-- 開発用（2026-10-21）：次にボスに勝ったとき必ずユニークを落とす（v2cap_debug_unique_next が付け、落ちたら外れる）
alter table public.v2cap_profiles add column if not exists unique_force boolean not null default false;
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
-- ★いまの職業で装備できない武器を着けているキャラは、その武器を外す（持ち物には残る・何度流しても同じ）。
--   装備できる武器種を変えたとき用（2026-10-11 ユーザー指示「クラスごとに装備できる武器種は3つまでに」）。
--   着けたままでも強さには入らない（精算は装備できる武器しか数えない）が、画面で「着けているのに効かない」にならないように
update public.v2cap_profiles p
   set equipped = p.equipped - 'weapon', updated_at = now()
 where p.equipped ? 'weapon'
   and not exists (
     select 1
       from public.v2cap_inventory i
       join public.v2cap_equipment e on e.id = i.base_id
       join public.v2cap_classes c on c.id = p.class
      where i.id = (p.equipped ->> 'weapon')::bigint
        and i.player_id = p.id
        and e.type = any(c.weapons));

-- ============================================================
-- ===== 3. 計算（src/v2cap/lib と同じ式。片方だけ直さないこと）=====
-- ============================================================
-- 次のLVまでの必要EXP ＝ 20 ＋ 係数 × LV³。LV100で0（level.js の needExp）
-- 【確定】2026-10-12 ユーザー指示「通常のレベルはもう少しレベル上げにくくていい／レベル1時点で必要経験値20」→「+20・全体1.2倍」：
--   20 ＋ 0.162 × LV³（前は 0.135 × LV³）。ClassLV（v2cap_job_need）は変えない
-- ⚠千分率の整数で掛けてから割る＝JSと端数の丸めをそろえるため（level.js の NEED_BASE・NEED_PERMIL と同じ値）
create or replace function public.v2cap_need(p_lv int)
returns int language sql immutable set search_path = public as $$
  select case when p_lv >= 100 then 0
              else greatest(1, round((20 * 1000 + 162::numeric * p_lv * p_lv * p_lv) / 1000))::int end
$$;

-- 必要ClassEXP ＝ LVの係数 × 割合（%）× 段階の倍率 × ClassLV³ ／ 100000。段階の上限（初期30・上位50）で0（jobs.js の jobNeed）
-- 【確定】2026-10-12 ユーザー指示「通常のレベルよりもクラスレベルのほうが上がりやすくして」→「LVの5割」：
--   同じ数のLVの必要EXP（v2cap_need と同じ LV³ の形）の5割 × 段階の倍率（上位職3倍）。前は 4.4 × 段階の倍率 × ClassLV²
-- ⚠係数135はClassLVだけの値（jobs.js の JOB_NEED_BASE_PERMIL＝2026-10-12 に決めたときのLVの係数）・割合は jobs.js の JOB_NEED_PCT。
--   同じ日にLVだけ重くした（v2cap_need＝20＋0.162×LV³）ので、ここはLVの係数とは切り離してある
-- 【確定】さらに同じ日に「クラスレベルも最初の必要量少なすぎ、初期クラスは必要経験値15にして、上位職は30で」：
--   段階ごとの量（v2cap_stages.need_base＝初期15・上位30＝jobs.js の STAGES の needBase）を毎回足す
create or replace function public.v2cap_job_need(p_stage text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select case when p_jlv >= coalesce((select s.max_jlv from public.v2cap_stages s where s.stage = p_stage), 30) then 0
              else greatest(1, round((coalesce((select s.need_base from public.v2cap_stages s where s.stage = p_stage), 0) * 100000
                                      + 135::numeric * 50 * coalesce((select s.mult from public.v2cap_stages s where s.stage = p_stage), 1)
                                        * p_jlv * p_jlv * p_jlv) / 100000))::int end
$$;

-- そのLVの推奨の場所で10回出撃したくらいのEXP（areas.js の tenSortieExpOf と同じ）。デイリーミッションと宝樹（吉）の基準
-- 【確定】2026-10-12 ユーザー指示「そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」：
--   推奨の場所＝推奨LVの上限（rec_lv）がそのLV以上の、いちばん手前の場所（上限より上のLVは最後の場所）。
--   EXP＝ふつうの敵の1体あたりのEXPのまんなか × 10 ＝ 5 ×（最小＋最大）
create or replace function public.v2cap_ten_sortie_exp(p_lv int)
returns int language sql stable set search_path = public as $$
  select coalesce(
    (select 5 * (s.exp_min + s.exp_max) from public.v2cap_spots s
      where s.rec_lv >= greatest(1, coalesce(p_lv, 1)) order by s.id limit 1),
    (select 5 * (s.exp_min + s.exp_max) from public.v2cap_spots s order by s.id desc limit 1),
    0)
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
  -- ★回数の上限がある技（uses_max・2026-10-15）はその数まで
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name,
                    'uses', least(coalesce(s.uses_max, 99), greatest(1, coalesce((t.e ->> 'uses')::numeric::int, 1)))) order by t.i), '[]'::jsonb)
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
  v_cap   int[];   -- 足せる回数の上限（1枠最大5回・回数の上限がある技はその数まで＝ skills.js の usesCapOf）
  v_uses  int[];
  v_n     int;
  v_cost  int;
  v_grew  boolean := true;
  i       int;
begin
  select coalesce(array_agg(k.name order by k.sort), '{}'), coalesce(array_agg(k.mp order by k.sort), '{}'),
         coalesce(array_agg(least(c_uses_max, coalesce(k.uses_max, c_uses_max)) order by k.sort), '{}')
    into v_names, v_mp, v_cap
    from (select s.name, s.mp, s.sort, s.uses_max from public.v2cap_skills s
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
      if v_uses[i] < v_cap[i] and v_cost + v_mp[i] <= p_max then
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

-- 覚えた技を編成の空き枠へ入れる（skills.js の fillSetOf と同じ規則）。
-- 【確定】2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」：
--   p_names（覚えた順）のうち、その職業で使える技で、まだ編成に無いものを、空き枠（5枠）に入る数だけ・最大MPに収まるなら1回で入れる
--   （収まらない技はとばして次へ）。そのあと残りのMPで、入れた技に前から1回ずつ足す（1枠最大5回＝ v2cap_default_set と同じ）。
--   前から入っている技にはさわらない。使うのは v2cap_apply_exp（覚えたとき）と、今いるキャラを一度だけ埋める移行
create or replace function public.v2cap_fill_set(p_set jsonb, p_names jsonb, p_cls text, p_max int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  c_slots    constant int := 5;
  c_uses_max constant int := 5;
  v_set   jsonb := case when jsonb_typeof(p_set) = 'array' then p_set else '[]'::jsonb end;
  v_cost  int;
  v_names text[] := '{}';
  v_mp    int[]  := '{}';
  v_cap   int[]  := '{}';   -- 足せる回数の上限（1枠最大5回・回数の上限がある技はその数まで）
  v_uses  int[];
  v_n     int := 0;
  v_grew  boolean := true;
  r       record;
  i       int;
begin
  v_cost := public.v2cap_set_cost(v_set);
  for r in select s.name, s.mp, s.uses_max
             from jsonb_array_elements_text(case when jsonb_typeof(p_names) = 'array' then p_names else '[]'::jsonb end)
                  with ordinality as t(name, i)
             join public.v2cap_skills s on s.name = t.name
            where not s.passive and s.cls = any(public.v2cap_lineage(p_cls))
            order by t.i
  loop
    exit when jsonb_array_length(v_set) + v_n >= c_slots;
    continue when v_set @> jsonb_build_array(jsonb_build_object('name', r.name)) or r.name = any(v_names);
    continue when v_cost + r.mp > coalesce(p_max, 0);
    v_names := array_append(v_names, r.name);
    v_mp    := array_append(v_mp, r.mp);
    v_cap   := array_append(v_cap, least(c_uses_max, coalesce(r.uses_max, c_uses_max)));
    v_n     := v_n + 1;
    v_cost  := v_cost + r.mp;
  end loop;
  if v_n = 0 then return v_set; end if;
  v_uses := array_fill(1, array[v_n]);
  while v_grew loop
    v_grew := false;
    for i in 1..v_n loop
      if v_uses[i] < v_cap[i] and v_cost + v_mp[i] <= coalesce(p_max, 0) then
        v_uses[i] := v_uses[i] + 1;
        v_cost := v_cost + v_mp[i];
        v_grew := true;
      end if;
    end loop;
  end loop;
  return v_set || (select jsonb_agg(jsonb_build_object('name', v_names[g], 'uses', v_uses[g]) order by g)
                     from generate_series(1, v_n) as g);
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
revoke all on function public.v2cap_ten_sortie_exp(int) from public, anon, authenticated;
revoke all on function public.v2cap_stamina_max(int) from public, anon;
revoke all on function public.v2cap_learn(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.v2cap_job_bonus_mp(text, int) from public, anon, authenticated;
revoke all on function public.v2cap_lineage(text) from public, anon, authenticated;
revoke all on function public.v2cap_set_cost(jsonb) from public, anon, authenticated;
revoke all on function public.v2cap_fit_set(jsonb, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.v2cap_default_set(text, jsonb, int) from public, anon, authenticated;
revoke all on function public.v2cap_fill_set(jsonb, jsonb, text, int) from public, anon, authenticated;
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

-- ---- 一度だけの数え直し：ClassLVの必要ClassEXPを「LVの5割」にした（2026-10-12 ユーザー指示）----
-- 今いるキャラは、前の式（4.4 × 段階の倍率 × ClassLV²）でためたClassEXPの合計（今のClassLVまで＋今のClassLVの中のぶん）から、
-- 新しい式（上の v2cap_job_need）で職業ごとにClassLVを数え直す。上がったClassLVのぶんのスキルも覚える（v2cap_learn）。
-- ★印 job_need_half_lv_20261012 を付けるので、2回目以降に全文を流し直しても何もしない（数え直しを重ねない）
do $$
declare
  r         record;
  j         record;
  v_jobs    jsonb;
  v_learned jsonb;
  v_stage   text;
  v_mult    int;
  v_max     int;
  v_total   bigint;
  v_lv      int;
  v_need    int;
  k         int;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'job_need_half_lv_20261012') then
    for r in select p.id, p.jobs, p.learned from public.v2cap_profiles p loop
      v_jobs    := coalesce(r.jobs, '{}'::jsonb);
      v_learned := coalesce(r.learned, '[]'::jsonb);
      for j in select e.key as cls, e.value as v from jsonb_each(coalesce(r.jobs, '{}'::jsonb)) e loop
        v_stage := null;
        select c.stage, coalesce(s.mult, 1), coalesce(s.max_jlv, 30) into v_stage, v_mult, v_max
          from public.v2cap_classes c left join public.v2cap_stages s on s.stage = c.stage
         where c.id = j.cls;
        continue when v_stage is null;
        -- 前の式でためた合計
        v_lv    := least(greatest(coalesce((j.v ->> 'lv')::int, 1), 1), v_max);
        v_total := greatest(coalesce((j.v ->> 'exp')::bigint, 0), 0);
        for k in 1 .. v_lv - 1 loop
          v_total := v_total + greatest(1, round(44::numeric * v_mult * k * k / 10))::int;
        end loop;
        -- 新しい式で数え直す（上限に着いたらClassEXPは0＝出撃の精算と同じ）
        v_lv := 1;
        loop
          exit when v_lv >= v_max;
          v_need := public.v2cap_job_need(v_stage, v_lv);
          exit when v_total < v_need;
          v_total := v_total - v_need;
          v_lv    := v_lv + 1;
        end loop;
        if v_lv >= v_max then v_total := 0; end if;
        v_jobs    := jsonb_set(v_jobs, array[j.cls], jsonb_build_object('lv', v_lv, 'exp', v_total));
        v_learned := public.v2cap_learn(v_learned, j.cls, v_lv);
      end loop;
      update public.v2cap_profiles set jobs = v_jobs, learned = v_learned, updated_at = now() where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('job_need_half_lv_20261012');
  end if;
end $$;

-- ---- 一度だけ：編成の空き枠を、覚えている技で埋める（2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」）----
-- これからは覚えたときに入れる（v2cap_apply_exp）。今いるキャラは、いまの職業（と下位職）で覚えているのに編成に入っていない技を、
-- 覚えた順に入れる（v2cap_fill_set＝空き枠に入るだけ・最大MPに収まるだけ1回ずつ、残りのMPで1回ずつ足す・前から入っている技にはさわらない）。
-- ★印 fill_skill_sets_20261012 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r      record;
  v_set  jsonb;
  v_fill jsonb;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'fill_skill_sets_20261012') then
    for r in select p.id, p.class, p.mp, p.jobs, p.learned, p.skill_sets from public.v2cap_profiles p loop
      v_set  := case when jsonb_typeof(coalesce(r.skill_sets, '{}'::jsonb) -> r.class) = 'array' then r.skill_sets -> r.class else '[]'::jsonb end;
      v_fill := public.v2cap_fill_set(v_set, r.learned, r.class,
                  r.mp + public.v2cap_job_bonus_mp(r.class, coalesce((r.jobs -> r.class ->> 'lv')::int, 1)));
      if jsonb_array_length(v_fill) > jsonb_array_length(v_set) then
        update public.v2cap_profiles
           set skill_sets = jsonb_set(coalesce(skill_sets, '{}'::jsonb), array[r.class], v_fill), updated_at = now()
         where id = r.id;
      end if;
    end loop;
    insert into public.v2cap_migrations (key) values ('fill_skill_sets_20261012');
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
  v_job_max int := 30;   -- いまの職業の段階のClassLV上限（初期30・上位50）
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
  v_sets  jsonb;
  v_set   jsonb;
  v_fill  jsonb;
  v_setadd jsonb;
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
  select coalesce(jsonb_agg(t.name order by t.i), '[]'::jsonb) into v_added
    from jsonb_array_elements_text(v_new) with ordinality as t(name, i) where not (v_old ? t.name);

  -- 【確定】2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」：
  --   いま覚えた技は、いまの職業の編成に空き枠（5枠）があり、最大MP（本体のMP＋クラスのMP＋アセンションのMP＝v2cap_max_mp）に収まるなら入れる（v2cap_fill_set）。
  --   1回ずつ入れてから、残りのMPで1回ずつ足す（1枠最大5回）。前から入っている技にはさわらない。1回ぶんのMPも無ければ入れない
  v_sets := coalesce(v_row.skill_sets, '{}'::jsonb);
  v_set  := case when jsonb_typeof(v_sets -> v_cls) = 'array' then v_sets -> v_cls else '[]'::jsonb end;
  v_fill := public.v2cap_fill_set(v_set, v_added, v_cls, public.v2cap_max_mp(v_row.mp, v_row.ascension, v_cls, v_jlv));
  select coalesce(jsonb_agg(t.e -> 'name' order by t.i), '[]'::jsonb) into v_setadd
    from jsonb_array_elements(v_fill) with ordinality as t(e, i) where t.i > jsonb_array_length(v_set);
  if jsonb_array_length(v_setadd) > 0 then v_sets := jsonb_set(v_sets, array[v_cls], v_fill); end if;

  update public.v2cap_profiles set
    lv = v_lv, exp = v_exp,
    total_exp = total_exp + greatest(coalesce(p_amount, 0), 0),
    stat_points = stat_points + v_pts,
    jobs = jsonb_set(coalesce(jobs, '{}'::jsonb), array[v_cls], jsonb_build_object('lv', v_jlv, 'exp', v_jexp)),
    learned = v_new,
    skill_sets = v_sets,
    updated_at = now()
  where id = p_player
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'level_ups', v_ups, 'lv', v_lv,
    'job_ups', v_jups, 'jlv', v_jlv,
    'learned', v_added,
    'set_added', v_setadd,
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
  v_start text[];
  v_slots text[] := array['weapon', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2'];
  v_equip jsonb := '{}'::jsonb;
  v_inv   bigint;
  v_i     int;
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
  -- ★初期装備（2026-10-12 ユーザー指示「キャラ作成時そのクラスに対応する装備一式（lv１）」）：
  --   v2cap_classes.starter（武器・頭・鎧・腕・足・装飾品①・装飾品② の順）を持ち物に入れて、全部着ける。アイテムLV＝必要LV1
  select c.starter into v_start from public.v2cap_classes c where c.id = v_cls;
  for v_i in 1 .. least(coalesce(cardinality(v_start), 0), cardinality(v_slots)) loop
    if exists (select 1 from public.v2cap_equipment e where e.id = v_start[v_i]) then
      insert into public.v2cap_inventory (player_id, base_id, ilv)
      select v_uid, e.id, coalesce(e.lv, 1) from public.v2cap_equipment e where e.id = v_start[v_i]
      returning id into v_inv;
      v_equip := v_equip || jsonb_build_object(v_slots[v_i], v_inv);
    end if;
  end loop;
  -- 最大MP＝本体の初期MP（列の既定値）＋クラスのMP（ClassLV1では0）＋アセンションのMP（作ったばかりなので0）
  --   ★装備のMPはサーバーでは数えない（スキル編成の最大MPは本体＋クラス＋アセンションのぶん＝ v2cap_max_mp）
  update public.v2cap_profiles
     set skill_sets = jsonb_build_object(v_cls,
           public.v2cap_default_set(v_cls, v_learn, public.v2cap_max_mp(v_row.mp, v_row.ascension, v_cls, 1))),
         equipped = v_equip
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
-- ★安息の祠（2026-10-13 ユーザー指示・src/v2cap/lib/shrine.js と同じ数）：
--   ・祠の外の1戦ごとに 0.1% で祠を見つける（勝ち負け・ボスを問わない。祠にいる間は見つからない）。
--     戦闘の数は 3〜8 を均等に1つ。祠は見つけた場所に置く（v2cap_profiles の shrine_spot・shrine_left・shrine_total）
--   ・祠の中の戦闘（p_enemy＝ハピネスフェアリー）は、祠のある場所で残りがあるときだけ通す。
--     勝てば経験値＝場所の表の値×5・Gold＝ふつうの敵と同じ・装備は落とさない。負けたらふつうの負けと同じ（最低EXP・Goldなし）。
--     勝ち負けを問わず1つ奥へ進む。ボスの出やすさは変えない。スタミナはふつうと同じ（オートは1使う）
--   ・最後の1戦のあと（最深部）は、泉の力でスタミナをそのLV（この戦闘のEXPが入ったあと）の最大値まで戻す
-- ★宝箱（2026-10-14 ユーザー指示・src/v2cap/lib/sortie.js の CHEST_PCT・CHEST_SCRAP と同じ数）：
--   祠の外で勝って、装備が持ち物に入らなかったとき（落ちなかった・条件に合わなかった）だけ 5% で見つけて、その場で開ける。
--   中身はその場所のエリアの残骸 1〜10 個（均等に1つ）＝ materials（{"エリアの番号": 個数}）に足す。返事の chest＝{ area, n }（無ければ null）
-- ⚠引数を変えた（p_area → p_spot・ランクの p_rank をなくした）ので、前の形を落としてから作る
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, boolean);
drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, text, boolean);
create or replace function public.v2cap_sortie_settle(
  p_spot int, p_enemy text, p_win boolean, p_drop text default null, p_auto boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cd constant interval := interval '8 seconds';
  -- 安息の祠（shrine.js の SHRINE_FAIRY_NAME・SHRINE_PCT・SHRINE_FIGHTS・SHRINE_EXP_TENTHS・SHRINE_GOLD_TENTHS）
  c_shrine_fairy constant text := 'ハピネスフェアリー';
  c_shrine_rate  constant numeric := 0.001;
  c_shrine_min   constant int := 3;
  c_shrine_max   constant int := 8;
  c_shrine_exp   constant int := 50;
  c_shrine_gold  constant int := 10;
  -- 宝箱（sortie.js の CHEST_PCT・CHEST_SCRAP）
  c_chest_rate   constant numeric := 0.05;
  c_chest_min    constant int := 1;
  c_chest_max    constant int := 10;
  -- ユニーク（equipment.js の UNIQUE_DROP_PCT＝0.5%）
  c_unique_rate  constant numeric := 0.005;
  v_uid    uuid := auth.uid();
  v_row    public.v2cap_profiles;
  v_cls    public.v2cap_classes;
  v_spot   public.v2cap_spots;
  v_en     public.v2cap_enemies;
  v_eq     public.v2cap_equipment;
  v_boss   boolean;
  v_shrine boolean;          -- 祠の中の戦闘か
  v_found  boolean := false; -- この戦闘のあとで祠を見つけたか
  v_deep   boolean := false; -- 最深部に着いたか（祠の最後の1戦）
  v_sh_spot  int;
  v_sh_left  int;
  v_sh_total int;
  v_win    boolean := coalesce(p_win, false);
  v_tenths int;
  v_exp    int := 0;
  v_gold   int := 0;
  v_inv    bigint;
  v_drop   jsonb := null;
  v_chest  int := 0;         -- 宝箱から出た残骸の数（見つけなければ0）
  v_ueq    public.v2cap_equipment;
  v_unique jsonb := null;    -- 落ちたユニーク（落ちなければ null）
  v_uforce boolean := false; -- 開発用の「次のボスで必ずユニーク」を使ったか
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
  -- 祠の中の戦闘：相手はハピネスフェアリーだけ。祠のある場所で、最深部までの残りがあるときだけ
  v_shrine := p_enemy = c_shrine_fairy;
  if v_shrine then
    if coalesce(v_row.shrine_left, 0) <= 0 or v_row.shrine_spot is distinct from p_spot then
      return jsonb_build_object('ok', false, 'error', 'いまは安息の祠にいません');
    end if;
  else
    select * into v_en from public.v2cap_enemies where name = p_enemy and spot = p_spot;
    if not found then return jsonb_build_object('ok', false, 'error', 'その敵はこの場所にいません'); end if;
  end if;
  if v_row.last_sortie_at is not null and v_row.last_sortie_at > now() - c_cd then
    return jsonb_build_object('ok', false, 'error', '出撃の間隔が短すぎます');
  end if;
  v_boss := not v_shrine and v_en.role = 'boss';

  -- オートはスタミナを1使う。足りなければ通さない（手動は使わない）
  if coalesce(p_auto, false) then
    v_cost := 1;
    v_stam := public.v2cap_stamina_roll(v_uid);
    if v_stam < v_cost then
      return jsonb_build_object('ok', false, 'error', 'スタミナが足りません', 'stamina', v_stam);
    end if;
  end if;

  if v_win and v_shrine then
    -- 安息の祠：経験値は場所の表の値×5・Goldはふつうの敵と同じ・装備は落とさない（p_drop は見ない）
    v_exp  := ((v_spot.exp_min  + floor(random() * (v_spot.exp_max  - v_spot.exp_min  + 1))::int) * c_shrine_exp + 5) / 10;
    v_gold := ((v_spot.gold_min + floor(random() * (v_spot.gold_max - v_spot.gold_min + 1))::int) * c_shrine_gold + 5) / 10;
  elsif v_win then
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
    -- 宝箱：装備が入らなかったときだけ 5% で見つけて開ける（中身はその場所のエリアの残骸 1〜10 個）
    if v_drop is null and random() < c_chest_rate then
      v_chest := c_chest_min + floor(random() * (c_chest_max - c_chest_min + 1))::int;
    end if;
    -- ★ユニーク（2026-10-21・ユーザー決定）：ボスに勝ったとき 0.5%。大ボス（2つ持つ）は落ちたら2つのどちらかを50%ずつ。
    --   ふつうの装備・宝箱とは別に引く（画面の申告ではなくサーバーが引く）。武器はいまの職業が使えない種類でもそのまま落とす。
    --   開発用の「次のボスで必ず落とす」（unique_force・v2cap_debug_unique_next）が付いていれば必ず落とす（落ちたら外す）
    if v_boss and (coalesce(v_row.unique_force, false) or random() < c_unique_rate) then
      select * into v_ueq from public.v2cap_equipment e
       where e.rarity = 'U' and e.spot = p_spot
       order by random() limit 1;
      if found then
        insert into public.v2cap_inventory (player_id, base_id, ilv)
        values (v_uid, v_ueq.id, v_ueq.lv) returning id into v_inv;
        v_unique := jsonb_build_object('id', v_inv, 'base_id', v_ueq.id, 'rarity', v_ueq.rarity, 'ilv', v_ueq.lv);
        v_uforce := coalesce(v_row.unique_force, false);
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
  -- 祠の中ではボスの出やすさを変えない（外へ出たら続きから）
  v_rate := case when v_shrine then v_row.boss_rate when v_boss then 0 else least(100, v_row.boss_rate + 0.3) end;

  -- 安息の祠：祠の中なら勝ち負けを問わず1つ奥へ（残りが0＝最深部）。祠の外なら 0.1% で見つける（祠にいる間は見つからない）
  --   開発用の「次の出撃で祠を見つける」（shrine_force・v2cap_debug_shrine_next）が付いていれば必ず見つける（見つけたら外す）
  v_sh_spot  := v_row.shrine_spot;
  v_sh_left  := coalesce(v_row.shrine_left, 0);
  v_sh_total := coalesce(v_row.shrine_total, 0);
  if v_shrine then
    v_sh_left := v_sh_left - 1;
    v_deep := v_sh_left <= 0;
  elsif v_sh_left <= 0 and (coalesce(v_row.shrine_force, false) or random() < c_shrine_rate) then
    v_found := true;
    v_sh_spot := p_spot;
    v_sh_total := c_shrine_min + floor(random() * (c_shrine_max - c_shrine_min + 1))::int;
    v_sh_left := v_sh_total;
  end if;

  update public.v2cap_profiles
     set cleared_spots = v_cleared, boss_rate = v_rate, gold = gold + v_gold,
         materials = case when v_chest > 0
           then jsonb_set(coalesce(materials, '{}'::jsonb), array[v_spot.area::text],
                          to_jsonb(coalesce((materials ->> v_spot.area::text)::int, 0) + v_chest))
           else materials end,
         stamina = greatest(0, stamina - v_cost),
         shrine_spot = case when v_sh_left > 0 then v_sh_spot end,
         shrine_left = greatest(0, v_sh_left),
         shrine_total = case when v_sh_left > 0 then v_sh_total else 0 end,
         shrine_force = case when v_found then false else shrine_force end,
         unique_force = case when v_uforce then false else unique_force end,
         last_sortie_at = now(), updated_at = now()
   where id = v_uid
   returning stamina, stamina_at into v_stam, v_stam_at;

  -- デイリーミッション（§10）：勝ったら「出撃に勝つ」を1つ数える（受注していない日は数えない）
  if v_win then
    perform public.v2cap_daily_bump(v_uid, 'win', 1);
    -- モンスター図鑑：勝った敵の討伐数を1つ足す（敵の名前はこの場所にいることを上で確かめてある。祠ではハピネスフェアリー）
    insert into public.v2cap_kills (player_id, enemy, n) values (v_uid, case when v_shrine then c_shrine_fairy else v_en.name end, 1)
    on conflict (player_id, enemy) do update set n = public.v2cap_kills.n + 1;
  end if;

  v_res := public.v2cap_apply_exp(v_uid, v_exp);
  -- 最深部：泉の力でスタミナを全回復（この戦闘のEXPが入ったあとのLVの最大値まで。最大より多ければそのまま）
  if v_deep then
    update public.v2cap_profiles
       set stamina = greatest(stamina, public.v2cap_stamina_max(lv)), stamina_at = now(), updated_at = now()
     where id = v_uid
     returning stamina, stamina_at into v_stam, v_stam_at;
  end if;
  return jsonb_build_object('ok', true, 'win', v_win, 'boss', v_boss,
    'role', case when v_shrine then 'shrine' else v_en.role end, 'enemy_lv', v_en.lv,
    'exp', v_exp, 'gold', v_gold, 'drop', v_drop, 'unique', v_unique,
    'chest', case when v_chest > 0 then jsonb_build_object('area', v_spot.area, 'n', v_chest) end,
    'cleared', to_jsonb(v_cleared), 'open_until', public.v2cap_open_until(v_cleared), 'boss_rate', v_rate,
    'level', v_res,
    'stamina', v_stam, 'stamina_at', v_stam_at,
    'stamina_max', public.v2cap_stamina_max(coalesce((v_res -> 'profile' ->> 'lv')::int, v_row.lv)),
    'shrine', jsonb_build_object('found', v_found, 'deepest', v_deep, 'spot', v_sh_spot,
      'left', greatest(0, v_sh_left), 'total', v_sh_total));
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

  -- スキルセット（職業ごと）。最大MP＝本体のMP＋新しい職業のクラスのMP＋その職業のアセンションのMP（§12 の v2cap_max_mp）
  v_max  := public.v2cap_max_mp(v_row.mp, v_row.ascension, v_cls.id, v_jlv);
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
    -- ★回数の上限がある技（uses_max・2026-10-15）はその数まで（skills.js の validateSkillSet と同じ文言）
    if (e ->> 'uses')::numeric < 1 or (e ->> 'uses')::numeric > least(c_use_max, coalesce(v_sk.uses_max, c_use_max)) then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, least(c_use_max, coalesce(v_sk.uses_max, c_use_max))));
    end if;
  end loop;
  v_cost := public.v2cap_set_cost(v_set);
  -- 最大MP＝本体のMP＋クラスのMP＋アセンションのMP（§12 の v2cap_max_mp）
  v_max  := public.v2cap_max_mp(v_row.mp, v_row.ascension, v_row.class, coalesce((v_row.jobs -> v_row.class ->> 'lv')::int, 1));
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
  -- ★2026-10-21 ユーザー選択「1つまで」：同じユニークは1つしか着けられない（装飾品の2枠に同じものは着けられない・loadout.js も数えない）
  if v_eq.rarity = 'U' and exists (
    select 1 from public.v2cap_inventory i
     where i.player_id = v_uid and i.base_id = v_eq.id and i.id <> p_inventory_id
       and exists (select 1 from jsonb_each_text(coalesce(v_row.equipped, '{}'::jsonb)) q
                    where q.key <> p_slot and q.value = i.id::text)) then
    return jsonb_build_object('ok', false, 'error', format('%sはもう着けています（同じユニークは1つまで）', v_eq.name));
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
--   ユニーク（U）は50（2026-10-18 の案のシート・2026-10-21 ユーザー「一旦今のままで実装して」）。残骸はそのボスのエリアのもの
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
    -- ★初期装備（エリア0）は始まりの森（1）の残骸になる（smith.js の scrapAreaOf と同じ）
    select greatest(1, coalesce(e.area, 1)) as area, count(*)::int as n,
           sum(case e.rarity when 'N' then 1 when 'R' then 5 when 'E' then 10 when 'L' then 25 when 'U' then 50 else 0 end)::int as scrap
      from del join public.v2cap_equipment e on e.id = del.base_id
     group by greatest(1, coalesce(e.area, 1))
  )
  select coalesce(jsonb_object_agg(got.area::text, got.scrap), '{}'::jsonb), coalesce(sum(got.n), 0)::int
    into v_gain, v_n
    from got;
  v_mats := coalesce(v_row.materials, '{}'::jsonb);
  for v_key, v_add in select key, value::int from jsonb_each_text(v_gain) loop
    v_mats := jsonb_set(v_mats, array[v_key], to_jsonb(coalesce((v_mats ->> v_key)::int, 0) + v_add));
  end loop;
  update public.v2cap_profiles set materials = v_mats, updated_at = now() where id = v_uid;
  -- デイリーミッション（§10）：「装備を強化または分解する」を1つ数える（まとめて分解しても1回・1つも分解できなければ数えない）
  if v_n > 0 then
    perform public.v2cap_daily_bump(v_uid, 'smith', 1);
  end if;
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
-- 【確定】2026-10-12 ユーザー指示「初期装備は残骸不要、Goldだけで強化できるように」→「全装備のノーマル装備の強化で残骸の消費は不要に、※Goldのみで」：
--   **ノーマル（初期装備もノーマル）は残骸を使わない**（Gold・成功率・失敗したときは同じ）
-- ★表の写しは src/v2cap/lib/smith.js（ENHANCE_SCRAP・ENHANCE_RATE・ENHANCE_GOLD_PER_LV・enhanceScrapOf）。v2capsql.test.js が突き合わせる
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
  -- ★ノーマル（初期装備もノーマル）は残骸を使わない＝Goldだけ（smith.js の enhanceScrapOf）
  v_need := case when v_eq.rarity = 'N' then 0 else c_scrap[v_next] end;
  v_gold := greatest(1, v_inv.ilv)::bigint * c_gold_per_lv * v_next;
  v_key  := greatest(1, coalesce(v_eq.area, 1))::text;
  v_mats := coalesce(v_row.materials, '{}'::jsonb);
  v_have := coalesce((v_mats ->> v_key)::int, 0);
  if v_have < v_need then return jsonb_build_object('ok', false, 'error', '残骸が足りません'); end if;
  if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;

  -- 抽選（成功率は%。+1は100%なので必ず成功する）
  v_ok := random() * 100 < c_rate[v_next];
  -- 成功でも失敗でも、残骸とGoldは使う（残骸を使わないノーマルは、残骸の数にさわらない）
  if v_need > 0 then
    v_mats := jsonb_set(v_mats, array[v_key], to_jsonb(v_have - v_need));
  end if;
  update public.v2cap_profiles
     set materials = v_mats, gold = gold - v_gold, updated_at = now()
   where id = v_uid;
  if v_ok then
    update public.v2cap_inventory set plus = v_next where id = v_inv.id;
  end if;
  -- デイリーミッション（§10）：「装備を強化または分解する」を1つ数える（失敗しても1回）
  perform public.v2cap_daily_bump(v_uid, 'smith', 1);
  return jsonb_build_object('ok', true, 'success', v_ok, 'plus', case when v_ok then v_next else v_plus end,
    'area', greatest(1, coalesce(v_eq.area, 1)), 'scrap', v_need, 'gold', v_gold, 'materials', v_mats, 'gold_left', v_row.gold - v_gold);
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
    -- ★ユニーク（U・ボス固有）も作れない（2026-10-21・smith.js の craftErrorOf と同じ文）
    return jsonb_build_object('ok', false, 'error',
      case when v_eq.rarity = 'U' then 'ユニークの装備は作れません' else 'ノーマルの装備は作れません' end);
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
--   ・ごほうびは経験値だけ。基準＝【確定】2026-10-12「デイリーミッションと同じにする」：祈った時点のLVの推奨の場所で10回出撃したくらい
--     （v2cap_ten_sortie_exp・前は必要EXP × 2〜0.1%）、それに運勢の倍率（大吉×3〜大凶×0.2・今のⅡと同じ）。端数は切り上げ。EXPは戦闘と同じ扱い（v2cap_apply_exp）
--   ・運勢の並び・出やすさは今のⅡ（v2_pray・src/v2/lib/tree.js の FORTUNES）と同じ
--   ・1日1回（日本時間の5時で切り替わる）
--   ・【確定】2026-10-13 ユーザー指示「開発中祈りは何回でもできるようにして」：**管理者（is_admin）は何回でも祈れる**（日付の確認を飛ばす）。
--     今はこの版に管理者しか入れないので、開発中はだれでも何回でも。公開したあとも一般の人は1日1回のまま（前は「管理者も1日1回」）
--   ・【確定】2026-10-14 ユーザー指示「毎日祈ってたらもらえる経験値が少しだけ増えるようにして。2日目で1.1倍、10日目で2倍になるように。
--     途切れたらやり直し、更新タイミングはAM5時」＋ユーザーが選んだ：毎日+0.1倍・10日目だけ+0.2倍（c_streak）・11日目からは2倍のまま。
--     前に祈った日が 昨日＝連続+1／今日＝そのまま（管理者が同じ日にもう一度）／それより前・はじめて＝1。0（数える前のキャラ）は前の日を1日目とみなす
create or replace function public.v2cap_pray()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_names  constant text[] := array['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
  c_weight constant int[]  := array[5, 10, 15, 25, 20, 15, 10];
  c_mult   constant int[]  := array[30, 20, 15, 10, 7, 4, 2];   -- 運勢の倍率（10分率）
  c_streak constant int[]  := array[100, 110, 120, 130, 140, 150, 160, 170, 180, 200];   -- 連続1〜10日目の倍率（百分率）。11日目からは10日目と同じ
  c_keep   constant int    := 10;                               -- 履歴として残す件数
  v_uid   uuid := auth.uid();
  v_roll  int;
  v_acc   int := 0;
  v_idx   int := 7;
  v_name  text;
  v_lv    int;
  v_exp   int;
  v_count int;
  v_log   jsonb;
  v_streak int;
  v_spct  int;
  v_res   jsonb := null;
  v_admin boolean := coalesce((select pr.is_admin from public.profiles pr where pr.id = auth.uid()), false);
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
         -- 連続日数（右辺の p.last_pray_at は祈る前の値）
         pray_streak  = case
           when p.last_pray_at is null then 1
           when ((p.last_pray_at at time zone 'Asia/Tokyo') - interval '5 hours')::date
              = ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date     then greatest(p.pray_streak, 1)
           when ((p.last_pray_at at time zone 'Asia/Tokyo') - interval '5 hours')::date
              = ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date - 1 then greatest(p.pray_streak, 1) + 1
           else 1 end,
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
     and (v_admin                 -- 管理者は何回でも（2026-10-13）
          or p.last_pray_at is null
          or ((p.last_pray_at at time zone 'Asia/Tokyo') - interval '5 hours')::date
           < ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date)
   returning p.lv, p.pray_count, p.pray_log, p.pray_streak into v_lv, v_count, v_log, v_streak;

  if not found then
    if not exists (select 1 from public.v2cap_profiles where id = v_uid) then
      return jsonb_build_object('ok', false, 'error', 'キャラクターがいません');
    end if;
    return jsonb_build_object('ok', false, 'error', '今日はもう祈りました（日本時間の5時に変わります）');
  end if;

  -- デイリーミッション（§10）：「宝樹に祈りをささげる」を1つ数える（経験値を入れる前＝この日はじめてなら、祈る前のLVで受注する）
  perform public.v2cap_daily_bump(v_uid, 'pray', 1);

  -- 経験値：祈った時点のLVの推奨の場所で10回出撃したくらい × 運勢の倍率（10分率）× 連続日数の倍率（百分率）。
  --   切り上げは整数で（tree.js の prayExpOf と同じ）
  v_lv     := greatest(1, coalesce(v_lv, 1));
  v_streak := greatest(1, coalesce(v_streak, 1));
  v_spct   := c_streak[least(v_streak, array_length(c_streak, 1))];
  v_exp    := (public.v2cap_ten_sortie_exp(v_lv) * c_mult[v_idx] * v_spct + 999) / 1000;
  if v_exp > 0 then v_res := public.v2cap_apply_exp(v_uid, v_exp); end if;

  return jsonb_build_object('ok', true, 'fortune', v_name, 'lv', v_lv, 'exp', v_exp,
                            'streak', v_streak, 'streak_pct', v_spct,
                            'pray_count', v_count, 'pray_log', v_log, 'level', v_res);
end;
$$;
revoke all on function public.v2cap_pray() from public, anon;
grant execute on function public.v2cap_pray() to authenticated;

-- ============================================================
-- ===== 8-4. ホームの開け閉め（2026-10-15）=====
-- ============================================================
-- 【確定】2026-10-15 ユーザー指示「ホーム画面のステータスを表示、毎回開いてるから閉じたら閉じる、開いたら開くを継続させて」：
--   前は端末（localStorage）にだけ覚えていた＝端末・ブラウザが変わる／閲覧データが消えると、最初の「開く」に戻っていた。
--   キャラのデータにも覚えて、どこで開いても前の開け閉めから始める（写しは src/v2cap/lib/uiPrefs.js の FOLD_KEYS）
--   ・覚えるのは ステータス（openStatus）・メニュー（openMenu）・今日のミッション（openDaily）の開け閉めだけ（true＝開いている）
alter table public.v2cap_profiles add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

create or replace function public.v2cap_set_ui_pref(p_key text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_open is null or p_key is null or not (p_key = any(array['openStatus', 'openMenu', 'openDaily'])) then
    return jsonb_build_object('ok', false, 'error', '覚えられない設定です');
  end if;
  update public.v2cap_profiles
     set ui_prefs = jsonb_set(coalesce(ui_prefs, '{}'::jsonb), array[p_key], to_jsonb(p_open))
   where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2cap_set_ui_pref(text, boolean) from public, anon;
grant execute on function public.v2cap_set_ui_pref(text, boolean) to authenticated;

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

-- メダルを入れる（2026-10-13・賭博場を試す用。開発用の欄のボタン）
create or replace function public.v2cap_debug_gain_medals(p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int := greatest(1, least(coalesce(p_amount, 0), 1000000));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  update public.v2cap_profiles set medals = medals + v_n, updated_at = now() where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true, 'got', v_n, 'medals', (select medals from public.v2cap_profiles where id = auth.uid()));
end;
$$;
revoke all on function public.v2cap_debug_gain_medals(int) from public, anon;
grant execute on function public.v2cap_debug_gain_medals(int) to authenticated;

-- 安息の祠を出す（2026-10-13・演出を試す用。開発用の欄のボタン）：開いている場所に祠を置く（戦闘の数は 3〜8 を引く・
--   いま祠にいれば置き直す）。ふつうは出撃の精算が 0.1% で置く（§5）
create or replace function public.v2cap_debug_shrine(p_spot int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_shrine_min constant int := 3;
  c_shrine_max constant int := 8;
  v_row public.v2cap_profiles;
  v_n   int := c_shrine_min + floor(random() * (c_shrine_max - c_shrine_min + 1))::int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if p_spot is null or p_spot < 1 or p_spot > public.v2cap_open_until(v_row.cleared_spots) then
    return jsonb_build_object('ok', false, 'error', 'この場所はまだ解放されていません');
  end if;
  update public.v2cap_profiles set shrine_spot = p_spot, shrine_left = v_n, shrine_total = v_n, updated_at = now()
   where id = auth.uid()
   returning * into v_row;
  return jsonb_build_object('ok', true, 'total', v_n, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_debug_shrine(int) from public, anon;
grant execute on function public.v2cap_debug_shrine(int) to authenticated;

-- 次の出撃で安息の祠を見つける（2026-10-14・ユーザー「出撃で見つけたときの挙動確認したい」。開発用の欄のボタン）：
--   印（shrine_force）を付けるだけ。次の祠の外の出撃の精算（§5）が 0.1% の代わりに必ず見つけ、印を外す。祠の中にいれば出たあと
create or replace function public.v2cap_debug_shrine_next()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.v2cap_profiles;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  update public.v2cap_profiles set shrine_force = true, updated_at = now()
   where id = auth.uid()
   returning * into v_row;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true, 'in_shrine', coalesce(v_row.shrine_left, 0) > 0, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_debug_shrine_next() from public, anon;
grant execute on function public.v2cap_debug_shrine_next() to authenticated;

-- ユニークをもらう（2026-10-21・固有の能力が発動するか試す用。開発用の欄のボタン）：
--   p_ids を渡せばその装備だけ・null なら60個ぜんぶ。**持っていないものだけ**入れる（何度押しても増えすぎない）
create or replace function public.v2cap_debug_give_uniques(p_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if not exists (select 1 from public.v2cap_profiles where id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがいません');
  end if;
  insert into public.v2cap_inventory (player_id, base_id, ilv)
  select auth.uid(), e.id, e.lv from public.v2cap_equipment e
   where e.rarity = 'U' and (p_ids is null or e.id = any(p_ids))
     and not exists (select 1 from public.v2cap_inventory i where i.player_id = auth.uid() and i.base_id = e.id)
   order by e.spot, e.id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'got', v_n);
end;
$$;
revoke all on function public.v2cap_debug_give_uniques(text[]) from public, anon;
grant execute on function public.v2cap_debug_give_uniques(text[]) to authenticated;

-- 次にボスに勝ったとき必ずユニークを落とす（2026-10-21・ドロップの流れを試す用）：印（unique_force）を付けるだけ。
--   次のボスに勝った精算（§5）が 0.5% の代わりに必ず落とし、印を外す
create or replace function public.v2cap_debug_unique_next()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.v2cap_profiles;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  update public.v2cap_profiles set unique_force = true, updated_at = now()
   where id = auth.uid()
   returning * into v_row;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_debug_unique_next() from public, anon;
grant execute on function public.v2cap_debug_unique_next() to authenticated;

-- 自分のキャラを消して作り直せるようにする（この版のデータだけ。今のⅡ・旧版には触らない）
create or replace function public.v2cap_dev_reset()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  delete from public.v2cap_inventory where player_id = auth.uid();
  delete from public.v2cap_kills where player_id = auth.uid();
  delete from public.v2cap_casino where player_id = auth.uid();
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
--   ・報酬は**受注した時点のLV**（daily_lv）で決まる：EXP＝そのLVの推奨の場所で10回出撃したくらい（2026-10-12・v2cap_daily_reward）／
--     Gold＝LV×100。EXPは戦闘と同じ扱い（v2cap_apply_exp＝いまの職業のClassEXPにも同じ量）
--   ・ミッションの一覧は v2cap_daily_tasks。数えるのは各RPC（v2cap_daily_bump を呼ぶ所）：
--       win＝出撃の精算で勝ったとき／smith＝鍛冶屋の強化（失敗しても）・分解／tower＝塔の挑戦（勝ち負けによらず）／pray＝宝樹に祈ったとき
--   ・【確定】2026-10-15 ユーザー指示「ミッションログイン時に自動で受注するように ※ミッションは朝5時リセット」：
--     **受注は自動**。画面がホームを開いたとき（と開いたまま5時を過ぎたとき）に v2cap_daily_accept を呼ぶ。
--     サーバーも、日付が変わってから最初に見たとき（v2cap_daily_roll＝数える・受注・受け取りの入口）に「その時点のLVで受注した」状態で始める
--     （画面を開いたまま5時を過ぎてすぐ出撃しても、その勝ちを落とさないように）
--   ・【確定】2026-10-15 ユーザーが選んだ「守っていれば達成」：塔は守護者でいるあいだ挑戦できないので、
--     **受注したときに守護者なら「塔に挑戦する」は達成済み**で始める（daily.js の startCountsOf と同じ）

-- 今日の状態にそろえる（内部ヘルパ）。日付が変わっていたら（とまだ受注していない今日の行＝前の版で空にした行も）、
-- **その時点のLVで受注した状態**で始める：進みは空（守護者なら塔だけ1）・受け取っていない
create or replace function public.v2cap_daily_roll(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date;
begin
  update public.v2cap_profiles
     set daily_day = v_today, daily_lv = lv,
         daily_counts = case when tower_guard is not null then jsonb_build_object('tower', 1) else '{}'::jsonb end,
         daily_claimed = false
   where id = p_player and (daily_day is distinct from v_today or daily_lv is null);
end;
$$;
revoke all on function public.v2cap_daily_roll(uuid) from public, anon, authenticated;

-- 進みを数える（内部ヘルパ・各RPCから呼ぶ）。一覧に無いキー・受け取ったあとは数えない
-- （日付が変わってはじめてなら、上の roll がその時点のLVで受注してから数える）
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

-- 報酬（受注した時点のLVで決まる・daily.js の dailyRewardOf と同じ）。Gold＝LV×100
-- 【確定】2026-10-12 ユーザー指示「後半で大きくもらいすぎないように調整してた、そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」：
--   EXP＝そのLVの推奨の場所で10回出撃したくらい（v2cap_ten_sortie_exp）。前は「必要EXP × 10／5／3／1%」
create or replace function public.v2cap_daily_reward(p_lv int)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'exp', public.v2cap_ten_sortie_exp(p_lv),
    'gold', greatest(1, coalesce(p_lv, 1)) * 100)
$$;
revoke all on function public.v2cap_daily_reward(int) from public, anon;

-- 受注する：今日のミッションを受ける。報酬はこの時点のLVで決まる（daily_lv に入れる）。1日1回
-- 【確定】2026-10-15 受注は自動＝画面がホームを開いたときに呼ぶ。受注のしかたは roll と同じ（守護者なら塔は達成済み）。
--   もう受注していれば何もしない（何度呼んでも ok＝前は「今日のミッションはもう受注しました」を返していた）
create or replace function public.v2cap_daily_accept()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2cap_profiles;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから（2つの画面から同時に届いても、受注は1回だけ）
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  perform public.v2cap_daily_roll(v_uid);
  select * into v_row from public.v2cap_profiles where id = v_uid;
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

-- ============================================================
-- ===== 11. 賭博場（2026-10-13）=====
-- ============================================================
-- 【確定】2026-10-13 ユーザー指示「V2capに無印の時みたいに賭博場を設置したい、新たにルーレットも追加したい。
--   交換所はあと設置するからまずは土台を」＋選んだこと（設計 §6-5）：
--   ・通貨は**メダル**（v2cap_profiles.medals）。両替所で **100 Gold＝1枚**。メダルからGoldへは戻せない。景品の交換所はあとで
--   ・還元率は**どのゲームも約97%**
--   ・スロット＝AT機（押し順ベル・CZ・AT・上乗せ・特化ゾーン・中段チェリー）／ハイ&ロー＝連勝はしご／ルーレット＝ラッキーナンバー付き
-- ★抽選と払い出しは全部ここ。画面（src/v2cap/components/V2capCasino.jsx ほか）は返事を見せるだけ
-- ★表と倍率の写しは src/v2cap/lib/casino.js（v2capsql.test.js が突き合わせる）
-- ★v2cap_casino は**画面から読ませない**（押し順ベルの正解 slot_pending が入っている）。中身は v2cap_casino_state で返す
alter table public.v2cap_profiles add column if not exists medals bigint not null default 0;

create table if not exists public.v2cap_casino (
  player_id    uuid primary key references auth.users(id) on delete cascade,
  day          date,                                  -- 当日の収支の日付（日本時間の5時で切り替え）
  day_net      bigint not null default 0,             -- 当日の収支（払い出し − 賭けたメダル。両替は数えない）
  stats        jsonb  not null default '{}'::jsonb,   -- {"slot":{"n":回数,"bet":賭けた,"won":戻った,"best":一番}} ゲームごと
  -- スロット
  slot_mode    text   not null default 'normal',      -- normal／cz／at
  slot_rate    int    not null default 1,             -- レート（CZ・ATの間は入ったときのまま）
  slot_cz      int    not null default 0,             -- CZの残りG
  slot_at      int    not null default 0,             -- ATの残りG
  slot_toku    int    not null default 0,             -- 特化ゾーンの残りG（ATの残りGは減らない）
  slot_pending smallint,                              -- 押し順ベルの正解（並びの番号0〜5）。止めるまで持つ
  slot_pending_rate int,
  slot_pending_at boolean not null default false,     -- AT中の押し順ベル（ナビを出した）
  slot_at_net  bigint not null default 0,             -- 今の（最後の）ATの純増
  -- ハイ&ロー
  hilo_active  boolean not null default false,
  hilo_bet     int    not null default 0,
  hilo_pot     bigint not null default 0,             -- 持ち分（1/100枚）
  hilo_card    smallint,                              -- 今のカード（0〜51）
  hilo_streak  int    not null default 0,
  hilo_cards   smallint[] not null default '{}',      -- この勝負で出たカード
  -- ルーレット
  roul_hist    smallint[] not null default '{}',      -- 出た数字（新しい順・20件）
  updated_at   timestamptz not null default now()
);
alter table public.v2cap_casino enable row level security;
revoke all on table public.v2cap_casino from anon, authenticated;

-- 今日（日本時間の5時で切り替え）
create or replace function public.v2cap_casino_today()
returns date language sql stable set search_path = public as $$
  select ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date
$$;
revoke all on function public.v2cap_casino_today() from public, anon, authenticated;

-- 賭博場の行をつかむ（無ければ作る）。日付が変わっていたら当日の収支を0に（内部ヘルパ）
create or replace function public.v2cap_casino_lock(p_uid uuid)
returns public.v2cap_casino language plpgsql security definer set search_path = public as $$
declare
  v_row   public.v2cap_casino;
  v_today date := public.v2cap_casino_today();
begin
  insert into public.v2cap_casino (player_id, day) values (p_uid, v_today) on conflict (player_id) do nothing;
  select * into v_row from public.v2cap_casino where player_id = p_uid for update;
  if v_row.day is distinct from v_today then
    update public.v2cap_casino set day = v_today, day_net = 0 where player_id = p_uid returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.v2cap_casino_lock(uuid) from public, anon, authenticated;

-- 収支をつける（内部ヘルパ）。p_best … そのゲームの「一番」の候補（スロットはATの純増・ほかは1回の払い出し）
create or replace function public.v2cap_casino_book(p_uid uuid, p_game text, p_bet bigint, p_won bigint, p_best bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s jsonb;
begin
  select coalesce(stats -> p_game, '{}'::jsonb) into v_s from public.v2cap_casino where player_id = p_uid;
  update public.v2cap_casino
     set day_net = day_net + p_won - p_bet,
         stats = jsonb_set(stats, array[p_game], jsonb_build_object(
           'n',    coalesce((v_s ->> 'n')::bigint, 0) + case when p_bet > 0 then 1 else 0 end,
           'bet',  coalesce((v_s ->> 'bet')::bigint, 0) + p_bet,
           'won',  coalesce((v_s ->> 'won')::bigint, 0) + p_won,
           'best', greatest(coalesce((v_s ->> 'best')::bigint, 0), coalesce(p_best, 0)))),
         updated_at = now()
   where player_id = p_uid;
end;
$$;
revoke all on function public.v2cap_casino_book(uuid, text, bigint, bigint, bigint) from public, anon, authenticated;

-- 残高と当日の収支（内部ヘルパ・どのRPCも返事に足す）
create or replace function public.v2cap_casino_money(p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'medals',  (select p.medals from public.v2cap_profiles p where p.id = p_uid),
    'gold',    (select p.gold from public.v2cap_profiles p where p.id = p_uid),
    'day_net', coalesce((select c.day_net from public.v2cap_casino c where c.player_id = p_uid and c.day = public.v2cap_casino_today()), 0))
$$;
revoke all on function public.v2cap_casino_money(uuid) from public, anon, authenticated;

-- 開いたとき：残高・当日の収支・記録・途中の勝負（ATの残り・ハイ&ローの持ち分など）
create or replace function public.v2cap_casino_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.v2cap_casino;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  return jsonb_build_object(
    'ok', true,
    'stats', v_c.stats,
    -- ★押し順ベルの正解は、ATのナビとして出したものだけ返す（通常・CZでは隠す）
    'slot', jsonb_build_object('mode', v_c.slot_mode, 'rate', v_c.slot_rate, 'cz', v_c.slot_cz, 'at', v_c.slot_at,
                               'toku', v_c.slot_toku, 'pending', v_c.slot_pending is not null,
                               'nav', case when v_c.slot_pending_at then v_c.slot_pending end, 'at_net', v_c.slot_at_net),
    'hilo', jsonb_build_object('active', v_c.hilo_active, 'bet', v_c.hilo_bet, 'pot', v_c.hilo_pot, 'card', v_c.hilo_card,
                               'streak', v_c.hilo_streak, 'cards', to_jsonb(v_c.hilo_cards)),
    'roulette', jsonb_build_object('hist', to_jsonb(v_c.roul_hist))
  ) || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_casino_state() from public, anon;
grant execute on function public.v2cap_casino_state() to authenticated;

-- ---- 11-1. 両替所：Gold → メダル（戻せない）----
create or replace function public.v2cap_casino_exchange(p_medals int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_gold_per_medal constant int := 100;
  c_max            constant int := 1000000;
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_gold bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_medals is null or p_medals < 1 or p_medals > c_max then
    return jsonb_build_object('ok', false, 'error', '枚数が正しくありません');
  end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_gold := p_medals::bigint * c_gold_per_medal;
  if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;
  perform public.v2cap_casino_lock(v_uid);
  update public.v2cap_profiles set gold = gold - v_gold, medals = medals + p_medals, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'got', p_medals, 'spent', v_gold) || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_casino_exchange(int) from public, anon;
grant execute on function public.v2cap_casino_exchange(int) to authenticated;

-- ---- 11-2. スロット（AT機）----
-- レバー：役を引いて、払い出し（押し順ベルは止めるまで保留）とCZ・AT・上乗せを決める。
--   役の並び：1リプレイ 2押し順ベル 3共通ベル 4弱チェリー 5強チェリー 6スイカ 7チャンス目 8中段チェリー 9ハズレ
--   ★前のゲームの押し順ベルを止めずに回したときは、こぼし（1枚×レート）にしてから回す
create or replace function public.v2cap_slot_spin(p_rate int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_bet          constant int    := 3;
  c_rates        constant int[]  := array[1, 10, 100];
  c_total        constant int    := 65536;
  c_keys         constant text[] := array['replay', 'obell', 'cbell', 'wcherry', 'scherry', 'suika', 'chance', 'premium', 'miss'];
  c_weight       constant int[]  := array[8978, 31457, 1820, 819, 273, 728, 328, 8, 21125];
  c_pay          constant int[]  := array[3, 9, 9, 2, 2, 6, 0, 2, 0];
  c_miss_pay     constant int    := 1;
  c_n_at         constant int[]  := array[0, 0, 0, 10, 200, 15, 50, 0, 0];
  c_n_cz         constant int[]  := array[0, 0, 0, 180, 420, 220, 480, 0, 1];
  c_cz_games     constant int    := 10;
  c_cz_win       constant int[]  := array[35, 18, 150, 500, 1000, 500, 1000, 1000, 12];
  c_at_games     constant int    := 40;
  c_premium_games constant int   := 100;
  c_add_rate     constant int[]  := array[0, 0, 0, 400, 1000, 400, 0, 1000, 0];
  c_add_games    constant int[]  := array[0, 0, 0, 10, 30, 20, 0, 100, 0];
  c_toku_rate    constant int[]  := array[0, 0, 0, 0, 250, 0, 400, 0, 0];
  c_toku_games   constant int    := 5;
  c_toku_add     constant int[]  := array[10, 20, 30, 50, 100];
  c_toku_w       constant int[]  := array[45, 30, 15, 7, 3];
  c_obell        constant int    := 2;
  c_premium      constant int    := 8;
  v_uid  uuid := auth.uid();
  v_p    public.v2cap_profiles;
  v_c    public.v2cap_casino;
  v_rate int;
  v_bet  int;
  v_r    int;
  v_u    int;
  v_acc  int := 0;
  v_role int := 9;
  v_pay  int := 0;
  v_prev int := 0;
  v_mode text;
  v_before text;
  v_cz   int;
  v_at   int;
  v_toku int;
  v_net  bigint;
  v_pending smallint := null;
  v_cz_in boolean := false;
  v_cz_end boolean := false;
  v_at_in boolean := false;
  v_at_from text := null;
  v_at_end boolean := false;
  v_add  int := 0;
  v_toku_in boolean := false;
  v_toku_add int := 0;
  i int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから（連打しても1回ずつ）
  select * into v_p from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);

  -- 前のゲームの押し順ベルが止められていない → こぼし
  if v_c.slot_pending is not null then
    v_prev := c_miss_pay * coalesce(v_c.slot_pending_rate, 1);
    if v_c.slot_pending_at then v_c.slot_at_net := v_c.slot_at_net + v_prev; end if;
    update public.v2cap_profiles set medals = medals + v_prev where id = v_uid;
    update public.v2cap_casino
       set slot_pending = null, slot_pending_rate = null, slot_pending_at = false, slot_at_net = v_c.slot_at_net
     where player_id = v_uid;
    perform public.v2cap_casino_book(v_uid, 'slot', 0, v_prev, case when v_c.slot_pending_at then v_c.slot_at_net else 0 end);
    v_p.medals := v_p.medals + v_prev;
  end if;

  v_mode := v_c.slot_mode;
  v_before := v_mode;
  if v_mode = 'normal' then
    if p_rate is null or not (p_rate = any(c_rates)) then
      return jsonb_build_object('ok', false, 'error', 'レートが正しくありません');
    end if;
    v_rate := p_rate;
  else
    v_rate := v_c.slot_rate;   -- CZ・ATの間は入ったときのレート
  end if;
  v_bet := c_bet * v_rate;
  if v_p.medals < v_bet then return jsonb_build_object('ok', false, 'error', 'メダルが足りません'); end if;

  -- 役
  v_r := floor(random() * c_total)::int;
  for i in 1 .. array_length(c_weight, 1) loop
    v_acc := v_acc + c_weight[i];
    if v_r < v_acc then v_role := i; exit; end if;
  end loop;
  if v_role = c_obell then
    v_pending := floor(random() * 6)::int;   -- 正解の押し順（止めるまで払い出しは保留）
  else
    v_pay := c_pay[v_role] * v_rate;
  end if;

  v_cz := v_c.slot_cz; v_at := v_c.slot_at; v_toku := v_c.slot_toku; v_net := v_c.slot_at_net;
  if v_mode = 'normal' then
    if v_role = c_premium then
      v_mode := 'at'; v_at := c_premium_games; v_at_in := true; v_at_from := 'premium';
    else
      v_u := floor(random() * 1000)::int;
      if v_u < c_n_at[v_role] then
        v_mode := 'at'; v_at := c_at_games; v_at_in := true; v_at_from := 'direct';
      elsif v_u < c_n_at[v_role] + c_n_cz[v_role] then
        v_mode := 'cz'; v_cz := c_cz_games; v_cz_in := true;
      end if;
    end if;
  elsif v_mode = 'cz' then
    v_cz := v_cz - 1;
    v_u := floor(random() * 1000)::int;
    if v_u < c_cz_win[v_role] then
      v_mode := 'at'; v_cz := 0; v_at_in := true;
      v_at := case when v_role = c_premium then c_premium_games else c_at_games end;
      v_at_from := case when v_role = c_premium then 'premium' else 'cz' end;
    elsif v_cz <= 0 then
      v_mode := 'normal'; v_cz := 0; v_cz_end := true;
    end if;
  else
    -- AT（純増は押し順ベルのぶんを止めたときに足す）
    v_net := v_net + v_pay - v_bet;
    if v_toku > 0 then
      v_toku := v_toku - 1;      -- 特化ゾーン：ATの残りは減らず、毎G上乗せ
      v_u := floor(random() * 100)::int;
      v_acc := 0;
      for i in 1 .. array_length(c_toku_add, 1) loop
        v_acc := v_acc + c_toku_w[i];
        if v_u < v_acc then v_toku_add := c_toku_add[i]; exit; end if;
      end loop;
      v_at := v_at + v_toku_add;
    else
      v_at := v_at - 1;
      if floor(random() * 1000)::int < c_toku_rate[v_role] then v_toku := v_toku + c_toku_games; v_toku_in := true; end if;
    end if;
    if floor(random() * 1000)::int < c_add_rate[v_role] then v_add := c_add_games[v_role]; v_at := v_at + v_add; end if;
    if v_at <= 0 and v_toku <= 0 then v_mode := 'normal'; v_at := 0; v_at_end := true; end if;
  end if;
  if v_at_in then v_net := 0; v_toku := 0; end if;   -- 新しいATの純増は0から

  update public.v2cap_profiles set medals = medals - v_bet + v_pay, updated_at = now() where id = v_uid;
  update public.v2cap_casino
     set slot_mode = v_mode, slot_rate = v_rate, slot_cz = v_cz, slot_at = v_at, slot_toku = v_toku,
         slot_pending = v_pending,
         slot_pending_rate = case when v_pending is null then null else v_rate end,
         slot_pending_at = (v_pending is not null and v_before = 'at'),
         slot_at_net = v_net, updated_at = now()
   where player_id = v_uid;
  perform public.v2cap_casino_book(v_uid, 'slot', v_bet, v_pay, case when v_before = 'at' then v_net else 0 end);
  return jsonb_build_object(
    'ok', true, 'role', c_keys[v_role], 'payout', v_pay, 'prev_paid', v_prev, 'rate', v_rate, 'bet', v_bet,
    'pending', v_pending is not null,
    -- ★ナビ（正解の押し順）はAT中だけ渡す
    'nav', case when v_pending is not null and v_before = 'at' then v_pending end,
    'mode_before', v_before, 'mode', v_mode, 'cz', v_cz, 'at', v_at, 'toku', v_toku, 'at_net', v_net,
    'cz_in', v_cz_in, 'cz_end', v_cz_end, 'at_in', v_at_in, 'at_from', v_at_from, 'at_end', v_at_end,
    'add', v_add, 'toku_in', v_toku_in, 'toku_add', v_toku_add
  ) || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_slot_spin(int) from public, anon;
grant execute on function public.v2cap_slot_spin(int) to authenticated;

-- 押し順ベルを止めた：押した順番（並びの番号0〜5：0＝左中右 1＝左右中 2＝中左右 3＝中右左 4＝右左中 5＝右中左）で払い出す
create or replace function public.v2cap_slot_stop(p_order int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_bell_pay constant int := 9;
  c_miss_pay constant int := 1;
  v_uid uuid := auth.uid();
  v_c   public.v2cap_casino;
  v_hit boolean;
  v_pay int;
  v_net bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  if v_c.slot_pending is null then return jsonb_build_object('ok', false, 'error', '止める押し順ベルがありません'); end if;
  if p_order is null or p_order < 0 or p_order > 5 then
    return jsonb_build_object('ok', false, 'error', '押し順が正しくありません');
  end if;
  v_hit := p_order = v_c.slot_pending;
  v_pay := (case when v_hit then c_bell_pay else c_miss_pay end) * coalesce(v_c.slot_pending_rate, 1);
  v_net := v_c.slot_at_net + case when v_c.slot_pending_at then v_pay else 0 end;
  update public.v2cap_profiles set medals = medals + v_pay, updated_at = now() where id = v_uid;
  update public.v2cap_casino
     set slot_pending = null, slot_pending_rate = null, slot_pending_at = false, slot_at_net = v_net, updated_at = now()
   where player_id = v_uid;
  perform public.v2cap_casino_book(v_uid, 'slot', 0, v_pay, case when v_c.slot_pending_at then v_net else 0 end);
  return jsonb_build_object('ok', true, 'hit', v_hit, 'payout', v_pay, 'answer', v_c.slot_pending, 'at_net', v_net)
         || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_slot_stop(int) from public, anon;
grant execute on function public.v2cap_slot_stop(int) to authenticated;

-- ---- 11-3. ハイ&ロー（連勝はしご）----
-- 始める：賭けて1枚目を引く（カード0〜51・強さは card % 13：0＝2 … 12＝A）
create or replace function public.v2cap_hilo_start(p_bet int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_min constant int := 10;
  c_max constant int := 1000;
  v_uid  uuid := auth.uid();
  v_p    public.v2cap_profiles;
  v_c    public.v2cap_casino;
  v_card int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_p from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  if v_c.hilo_active then return jsonb_build_object('ok', false, 'error', 'ハイ&ローの勝負の途中です'); end if;
  if p_bet is null or p_bet < c_min or p_bet > c_max then
    return jsonb_build_object('ok', false, 'error', format('賭けるのは%s〜%s枚です', c_min, c_max));
  end if;
  if v_p.medals < p_bet then return jsonb_build_object('ok', false, 'error', 'メダルが足りません'); end if;
  v_card := floor(random() * 52)::int;
  update public.v2cap_profiles set medals = medals - p_bet, updated_at = now() where id = v_uid;
  update public.v2cap_casino
     set hilo_active = true, hilo_bet = p_bet, hilo_pot = p_bet::bigint * 100, hilo_card = v_card,
         hilo_streak = 0, hilo_cards = array[v_card]::smallint[], updated_at = now()
   where player_id = v_uid;
  perform public.v2cap_casino_book(v_uid, 'hilo', p_bet, 0, 0);
  return jsonb_build_object('ok', true, 'card', v_card, 'bet', p_bet, 'pot', p_bet::bigint * 100, 'streak', 0)
         || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_hilo_start(int) from public, anon;
grant execute on function public.v2cap_hilo_start(int) to authenticated;

-- 上か下かを当てる。同じ数字は負け。倍率（小数2桁・切り捨て）は
--   1回目＝1261 ÷ 当たりの枚数（0.97 × 13）／2回目から＝1300 ÷ 当たりの枚数（確率どおり）＝どこで降りても全体で約97%
--   【確定】2026-10-13 ユーザー選択「2回目からは確率どおり」。10連勝か、賭けたメダルの1000倍で自動で受け取る
create or replace function public.v2cap_hilo_guess(p_high boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_first_x13  constant int := 1261;
  c_next_x13   constant int := 1300;
  c_max_streak constant int := 10;
  c_cap_mult   constant int := 1000;
  v_uid    uuid := auth.uid();
  v_c      public.v2cap_casino;
  v_rank   int;
  v_n      int;
  v_mult   int;
  v_next   int;
  v_nrank  int;
  v_win    boolean;
  v_pot    bigint;
  v_cap    bigint;
  v_streak int;
  v_payout bigint := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  if not v_c.hilo_active then return jsonb_build_object('ok', false, 'error', '勝負していません'); end if;
  if p_high is null then return jsonb_build_object('ok', false, 'error', '上か下かを選んでください'); end if;
  v_rank := v_c.hilo_card % 13;
  v_n := case when p_high then 12 - v_rank else v_rank end;
  if v_n <= 0 then return jsonb_build_object('ok', false, 'error', 'その向きは選べません'); end if;
  v_mult := (case when v_c.hilo_streak > 0 then c_next_x13 else c_first_x13 end) / v_n;
  v_next := floor(random() * 52)::int;
  v_nrank := v_next % 13;
  v_win := case when p_high then v_nrank > v_rank else v_nrank < v_rank end;
  if not v_win then
    update public.v2cap_casino
       set hilo_active = false, hilo_pot = 0, hilo_card = v_next, hilo_cards = hilo_cards || v_next::smallint, updated_at = now()
     where player_id = v_uid;
    return jsonb_build_object('ok', true, 'win', false, 'card', v_next, 'mult', v_mult, 'pot', 0, 'streak', v_c.hilo_streak,
                              'payout', 0, 'done', true) || public.v2cap_casino_money(v_uid);
  end if;
  v_pot := v_c.hilo_pot * v_mult / 100;
  v_streak := v_c.hilo_streak + 1;
  v_cap := v_c.hilo_bet::bigint * c_cap_mult * 100;
  if v_pot > v_cap then v_pot := v_cap; end if;
  if v_streak >= c_max_streak or v_pot >= v_cap then
    -- 自動で受け取る
    v_payout := v_pot / 100;
    update public.v2cap_profiles set medals = medals + v_payout, updated_at = now() where id = v_uid;
    update public.v2cap_casino
       set hilo_active = false, hilo_pot = v_pot, hilo_card = v_next, hilo_streak = v_streak,
           hilo_cards = hilo_cards || v_next::smallint, updated_at = now()
     where player_id = v_uid;
    perform public.v2cap_casino_book(v_uid, 'hilo', 0, v_payout, v_payout);
    return jsonb_build_object('ok', true, 'win', true, 'card', v_next, 'mult', v_mult, 'pot', v_pot, 'streak', v_streak,
                              'payout', v_payout, 'done', true, 'auto', true) || public.v2cap_casino_money(v_uid);
  end if;
  update public.v2cap_casino
     set hilo_pot = v_pot, hilo_card = v_next, hilo_streak = v_streak, hilo_cards = hilo_cards || v_next::smallint, updated_at = now()
   where player_id = v_uid;
  return jsonb_build_object('ok', true, 'win', true, 'card', v_next, 'mult', v_mult, 'pot', v_pot, 'streak', v_streak,
                            'payout', 0, 'done', false) || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_hilo_guess(boolean) from public, anon;
grant execute on function public.v2cap_hilo_guess(boolean) to authenticated;

-- 受け取る（1回は当ててから）。持ち分の1/100枚は切り捨て
create or replace function public.v2cap_hilo_take()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_c      public.v2cap_casino;
  v_payout bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  if not v_c.hilo_active then return jsonb_build_object('ok', false, 'error', '勝負していません'); end if;
  if v_c.hilo_streak < 1 then return jsonb_build_object('ok', false, 'error', '1回当ててから受け取れます'); end if;
  v_payout := v_c.hilo_pot / 100;
  update public.v2cap_profiles set medals = medals + v_payout, updated_at = now() where id = v_uid;
  update public.v2cap_casino set hilo_active = false, updated_at = now() where player_id = v_uid;
  perform public.v2cap_casino_book(v_uid, 'hilo', 0, v_payout, v_payout);
  return jsonb_build_object('ok', true, 'payout', v_payout, 'streak', v_c.hilo_streak, 'pot', v_c.hilo_pot)
         || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_hilo_take() from public, anon;
grant execute on function public.v2cap_hilo_take() to authenticated;

-- ---- 11-4. ルーレット（ラッキーナンバー付き）----
-- p_bets … [{"k":"n","v":17,"a":10},{"k":"red","a":50},{"k":"dozen","v":2,"a":5}]（k＝種類・v＝数字や番号・a＝枚数）
--   1点30倍・赤黒/奇数偶数/1〜18・19〜36は2倍・ダズン/列は3倍（賭けたぶんこみ）。0は1点賭けだけ当たる
--   毎回1〜5個の数字に雷（ラッキーナンバー）。そこへの1点賭けは50〜500倍
create or replace function public.v2cap_roulette_spin(p_bets jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_total constant int   := 1000;
  c_max_bets  constant int   := 60;
  c_straight  constant int   := 30;
  c_red       constant int[] := array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  c_count_w   constant int[] := array[30, 25, 20, 15, 10];
  c_mults     constant int[] := array[50, 100, 150, 200, 300, 500];
  c_mult_w    constant int[] := array[45, 25, 12, 9, 5, 4];
  v_uid    uuid := auth.uid();
  v_p      public.v2cap_profiles;
  v_c      public.v2cap_casino;
  v_b      jsonb;
  v_k      text;
  v_v      int;
  v_a      int;
  v_total  int := 0;
  v_u      int;
  v_acc    int;
  v_count  int := 1;
  v_nums   int[];
  v_lucky  jsonb := '[]'::jsonb;
  v_lmult  int[] := '{}';
  v_res    int;
  v_win    boolean;
  v_pay    bigint;
  v_payout bigint := 0;
  v_wins   jsonb := '[]'::jsonb;
  i int;
  j int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 then
    return jsonb_build_object('ok', false, 'error', 'チップを置いてください');
  end if;
  if jsonb_array_length(p_bets) > c_max_bets then
    return jsonb_build_object('ok', false, 'error', format('賭けられるのは%s か所までです', c_max_bets));
  end if;
  -- 形を確かめる（数は整数・枚数は1以上）。★数でないものを数に直してエラーにならないよう、型を見てから直す
  for v_b in select value from jsonb_array_elements(p_bets) loop
    v_k := v_b ->> 'k';
    if jsonb_typeof(v_b) is distinct from 'object' or jsonb_typeof(v_b -> 'a') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', '賭けの枚数が正しくありません');
    end if;
    if (v_b ->> 'a')::numeric <> floor((v_b ->> 'a')::numeric) or (v_b ->> 'a')::numeric < 1 or (v_b ->> 'a')::numeric > c_max_total then
      return jsonb_build_object('ok', false, 'error', '賭けの枚数が正しくありません');
    end if;
    if v_k in ('n', 'dozen', 'col') then
      if jsonb_typeof(v_b -> 'v') is distinct from 'number' then
        return jsonb_build_object('ok', false, 'error', '賭けた場所が正しくありません');
      end if;
      if (v_b ->> 'v')::numeric <> floor((v_b ->> 'v')::numeric)
         or (v_b ->> 'v')::numeric < (case when v_k = 'n' then 0 else 1 end)
         or (v_b ->> 'v')::numeric > (case when v_k = 'n' then 36 else 3 end) then
        return jsonb_build_object('ok', false, 'error', '賭けた場所が正しくありません');
      end if;
    elsif v_k is null or v_k not in ('red', 'black', 'odd', 'even', 'low', 'high') then
      return jsonb_build_object('ok', false, 'error', '賭けた場所が正しくありません');
    end if;
    v_total := v_total + (v_b ->> 'a')::int;
  end loop;
  if v_total > c_max_total then
    return jsonb_build_object('ok', false, 'error', format('1回に賭けられるのは%s枚までです', c_max_total));
  end if;
  select * into v_p from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  v_c := public.v2cap_casino_lock(v_uid);
  if v_p.medals < v_total then return jsonb_build_object('ok', false, 'error', 'メダルが足りません'); end if;

  -- ラッキーナンバー（数と倍率）
  v_u := floor(random() * 100)::int;
  v_acc := 0;
  for i in 1 .. array_length(c_count_w, 1) loop
    v_acc := v_acc + c_count_w[i];
    if v_u < v_acc then v_count := i; exit; end if;
  end loop;
  select array_agg(n) into v_nums from (select n from generate_series(0, 36) n order by random() limit v_count) s;
  for i in 1 .. v_count loop
    v_u := floor(random() * 100)::int;
    v_acc := 0;
    for j in 1 .. array_length(c_mults, 1) loop
      v_acc := v_acc + c_mult_w[j];
      if v_u < v_acc then v_lmult := v_lmult || c_mults[j]; exit; end if;
    end loop;
    v_lucky := v_lucky || jsonb_build_array(jsonb_build_object('n', v_nums[i], 'm', v_lmult[i]));
  end loop;

  -- 玉
  v_res := floor(random() * 37)::int;
  for v_b in select value from jsonb_array_elements(p_bets) loop
    v_k := v_b ->> 'k';
    v_a := (v_b ->> 'a')::int;
    v_v := case when v_k in ('n', 'dozen', 'col') then (v_b ->> 'v')::int end;
    v_win := case v_k
      when 'n'     then v_v = v_res
      when 'red'   then v_res <> 0 and v_res = any(c_red)
      when 'black' then v_res <> 0 and not (v_res = any(c_red))
      when 'odd'   then v_res <> 0 and v_res % 2 = 1
      when 'even'  then v_res <> 0 and v_res % 2 = 0
      when 'low'   then v_res between 1 and 18
      when 'high'  then v_res >= 19
      when 'dozen' then v_res <> 0 and (v_res - 1) / 12 + 1 = v_v
      when 'col'   then v_res <> 0 and (v_res - 1) % 3 + 1 = v_v
      else false end;
    v_pay := 0;
    if v_win then
      if v_k = 'n' then
        v_pay := v_a::bigint * coalesce((select v_lmult[x] from generate_subscripts(v_nums, 1) x where v_nums[x] = v_res), c_straight);
      elsif v_k in ('dozen', 'col') then
        v_pay := v_a::bigint * 3;
      else
        v_pay := v_a::bigint * 2;
      end if;
    end if;
    v_payout := v_payout + v_pay;
    v_wins := v_wins || to_jsonb(v_pay);
  end loop;

  update public.v2cap_profiles set medals = medals - v_total + v_payout, updated_at = now() where id = v_uid;
  update public.v2cap_casino
     set roul_hist = (array[v_res::smallint] || roul_hist)[1:20], updated_at = now()
   where player_id = v_uid;
  perform public.v2cap_casino_book(v_uid, 'roulette', v_total, v_payout, v_payout);
  return jsonb_build_object('ok', true, 'result', v_res, 'lucky', v_lucky, 'total', v_total, 'payout', v_payout, 'wins', v_wins,
                            'hist', to_jsonb((array[v_res::smallint] || v_c.roul_hist)[1:20]))
         || public.v2cap_casino_money(v_uid);
end;
$$;
revoke all on function public.v2cap_roulette_spin(jsonb) from public, anon;
grant execute on function public.v2cap_roulette_spin(jsonb) to authenticated;

-- ============================================================
-- ===== 12. アセンション（2026-10-13）=====
-- ============================================================
-- 【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2・正は src/v2cap/lib/ascension.js）：
--   ・CLASS LVが1上がるごとにAPを1（職業ごと）。どのマスも1AP。盤面は職業ごとで、効くのはその職業でいる間だけ
--   ・同じ日に「もっとツリーっぽく」「アイオン2みたいにまばらに配置（決まった道がなく、欲しい能力までどのルートで届かせるか）」：
--     起点から4方向に枝分かれした木。**起点か開いたマスにつながったマスだけ開ける**。形は段階ごとに1つ（中身は職業ごと）
--     ＝プレイヤーが持つのは**開いたマスの番号**（v2cap_profiles.ascension ＝ {"剣士":[1,2,5]}）
--   ・振り直しは LV×100 Gold（その職業の盤面を全部戻してAPを返す）
-- ★サーバーが数えるのは「つながっているか」「APが足りるか」と「スキル編成の最大MP（MPのマス）」だけ。
--   ステ・スキルの強さは戦闘（画面側の src/v2cap/lib/loadout.js）で効く（サーバーは戦闘を計算しない）
-- ★盤面の形（v2cap_asc_nodes）と MPのマス（v2cap_asc_mp）の種は ascension.js から tools/v2cap-sql.mjs が作る（手で書き写さない）
alter table public.v2cap_profiles add column if not exists ascension jsonb not null default '{}'::jsonb;

-- ---- 最初の版（4本の道）を片づける ----
-- 同じ日の最初の版は「道ごとに何マス開いたか」で持っていた＝マスの番号で持つ今の形では読めないので、
-- **一度だけ**全員の盤面を空にしてAPを返す（印 asc_graph_20261013・2回目以降に流し直しても消えない）
drop function if exists public.v2cap_ascend(text, int, int);
drop function if exists public.v2cap_asc_depth(jsonb, text, int, int);
drop table if exists public.v2cap_asc_roads;
do $$
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'asc_graph_20261013') then
    update public.v2cap_profiles set ascension = '{}'::jsonb where ascension <> '{}'::jsonb;
    insert into public.v2cap_migrations (key) values ('asc_graph_20261013');
  end if;
end $$;

-- 盤面の形（段階ごと）：マスの番号とつながり。0は起点
create table if not exists public.v2cap_asc_nodes (
  stage text not null,
  id    int  not null,
  links int[] not null default '{}',
  primary key (stage, id)
);
alter table public.v2cap_asc_nodes enable row level security;
drop policy if exists v2cap_asc_nodes_read on public.v2cap_asc_nodes;
create policy v2cap_asc_nodes_read on public.v2cap_asc_nodes for select to authenticated using (true);
revoke all on table public.v2cap_asc_nodes from anon;
grant select on table public.v2cap_asc_nodes to authenticated;

-- スキル編成の最大MPに入るマス（職業ごと）：MPの小マス（mp＝上がるMP）・MPの大マス（pct＝MP+%）
create table if not exists public.v2cap_asc_mp (
  cls text not null,
  id  int  not null,
  mp  int  not null default 0,
  pct int  not null default 0,
  primary key (cls, id)
);
alter table public.v2cap_asc_mp enable row level security;
drop policy if exists v2cap_asc_mp_read on public.v2cap_asc_mp;
create policy v2cap_asc_mp_read on public.v2cap_asc_mp for select to authenticated using (true);
revoke all on table public.v2cap_asc_mp from anon;
grant select on table public.v2cap_asc_mp to authenticated;

-- @@seed:asc_nodes
delete from public.v2cap_asc_nodes;
insert into public.v2cap_asc_nodes (stage, id, links) values
  ('shoki', 0, '{1,15,29,43}'::int[]),
  ('shoki', 1, '{0,2}'::int[]),
  ('shoki', 2, '{1,3,4}'::int[]),
  ('shoki', 3, '{2,11,50}'::int[]),
  ('shoki', 4, '{2,5}'::int[]),
  ('shoki', 5, '{4,6}'::int[]),
  ('shoki', 6, '{5,7,8}'::int[]),
  ('shoki', 7, '{6,10}'::int[]),
  ('shoki', 8, '{6,9,17}'::int[]),
  ('shoki', 9, '{8,25}'::int[]),
  ('shoki', 10, '{7,13}'::int[]),
  ('shoki', 11, '{3,12,14,51}'::int[]),
  ('shoki', 12, '{11}'::int[]),
  ('shoki', 13, '{10}'::int[]),
  ('shoki', 14, '{11}'::int[]),
  ('shoki', 15, '{0,16}'::int[]),
  ('shoki', 16, '{15,17,18}'::int[]),
  ('shoki', 17, '{8,16,25}'::int[]),
  ('shoki', 18, '{16,19}'::int[]),
  ('shoki', 19, '{18,20}'::int[]),
  ('shoki', 20, '{19,21,22}'::int[]),
  ('shoki', 21, '{20,24}'::int[]),
  ('shoki', 22, '{20,23,31}'::int[]),
  ('shoki', 23, '{22,39}'::int[]),
  ('shoki', 24, '{21,27}'::int[]),
  ('shoki', 25, '{9,17,26,28}'::int[]),
  ('shoki', 26, '{25}'::int[]),
  ('shoki', 27, '{24}'::int[]),
  ('shoki', 28, '{25}'::int[]),
  ('shoki', 29, '{0,30}'::int[]),
  ('shoki', 30, '{29,31,32}'::int[]),
  ('shoki', 31, '{22,30,39}'::int[]),
  ('shoki', 32, '{30,33}'::int[]),
  ('shoki', 33, '{32,34}'::int[]),
  ('shoki', 34, '{33,35,36}'::int[]),
  ('shoki', 35, '{34,38}'::int[]),
  ('shoki', 36, '{34,37,45}'::int[]),
  ('shoki', 37, '{36,53}'::int[]),
  ('shoki', 38, '{35,41}'::int[]),
  ('shoki', 39, '{23,31,40,42}'::int[]),
  ('shoki', 40, '{39}'::int[]),
  ('shoki', 41, '{38}'::int[]),
  ('shoki', 42, '{39}'::int[]),
  ('shoki', 43, '{0,44}'::int[]),
  ('shoki', 44, '{43,45,46}'::int[]),
  ('shoki', 45, '{36,44,53}'::int[]),
  ('shoki', 46, '{44,47}'::int[]),
  ('shoki', 47, '{46,48}'::int[]),
  ('shoki', 48, '{47,49,50}'::int[]),
  ('shoki', 49, '{48,52}'::int[]),
  ('shoki', 50, '{3,48,51}'::int[]),
  ('shoki', 51, '{11,50}'::int[]),
  ('shoki', 52, '{49,55}'::int[]),
  ('shoki', 53, '{37,45,54,56}'::int[]),
  ('shoki', 54, '{53}'::int[]),
  ('shoki', 55, '{52}'::int[]),
  ('shoki', 56, '{53}'::int[]),
  ('ichiji', 0, '{1,25,49,73}'::int[]),
  ('ichiji', 1, '{0,2}'::int[]),
  ('ichiji', 2, '{1,3,6}'::int[]),
  ('ichiji', 3, '{2,4,90}'::int[]),
  ('ichiji', 4, '{3,5,94}'::int[]),
  ('ichiji', 5, '{4,7,8}'::int[]),
  ('ichiji', 6, '{2}'::int[]),
  ('ichiji', 7, '{5}'::int[]),
  ('ichiji', 8, '{5,9}'::int[]),
  ('ichiji', 9, '{8,10,11}'::int[]),
  ('ichiji', 10, '{9,16}'::int[]),
  ('ichiji', 11, '{9,12}'::int[]),
  ('ichiji', 12, '{11,13}'::int[]),
  ('ichiji', 13, '{12,14}'::int[]),
  ('ichiji', 14, '{13,15,19}'::int[]),
  ('ichiji', 15, '{14,17}'::int[]),
  ('ichiji', 16, '{10,18}'::int[]),
  ('ichiji', 17, '{15,20}'::int[]),
  ('ichiji', 18, '{16,22,27}'::int[]),
  ('ichiji', 19, '{14}'::int[]),
  ('ichiji', 20, '{17,21}'::int[]),
  ('ichiji', 21, '{20,23}'::int[]),
  ('ichiji', 22, '{18,24,28}'::int[]),
  ('ichiji', 23, '{21}'::int[]),
  ('ichiji', 24, '{22}'::int[]),
  ('ichiji', 25, '{0,26}'::int[]),
  ('ichiji', 26, '{25,27,30}'::int[]),
  ('ichiji', 27, '{18,26,28}'::int[]),
  ('ichiji', 28, '{22,27,29}'::int[]),
  ('ichiji', 29, '{28,31,32}'::int[]),
  ('ichiji', 30, '{26}'::int[]),
  ('ichiji', 31, '{29}'::int[]),
  ('ichiji', 32, '{29,33}'::int[]),
  ('ichiji', 33, '{32,34,35}'::int[]),
  ('ichiji', 34, '{33,40}'::int[]),
  ('ichiji', 35, '{33,36}'::int[]),
  ('ichiji', 36, '{35,37}'::int[]),
  ('ichiji', 37, '{36,38}'::int[]),
  ('ichiji', 38, '{37,39,43}'::int[]),
  ('ichiji', 39, '{38,41}'::int[]),
  ('ichiji', 40, '{34,42}'::int[]),
  ('ichiji', 41, '{39,44}'::int[]),
  ('ichiji', 42, '{40,46,51}'::int[]),
  ('ichiji', 43, '{38}'::int[]),
  ('ichiji', 44, '{41,45}'::int[]),
  ('ichiji', 45, '{44,47}'::int[]),
  ('ichiji', 46, '{42,48,52}'::int[]),
  ('ichiji', 47, '{45}'::int[]),
  ('ichiji', 48, '{46}'::int[]),
  ('ichiji', 49, '{0,50}'::int[]),
  ('ichiji', 50, '{49,51,54}'::int[]),
  ('ichiji', 51, '{42,50,52}'::int[]),
  ('ichiji', 52, '{46,51,53}'::int[]),
  ('ichiji', 53, '{52,55,56}'::int[]),
  ('ichiji', 54, '{50}'::int[]),
  ('ichiji', 55, '{53}'::int[]),
  ('ichiji', 56, '{53,57}'::int[]),
  ('ichiji', 57, '{56,58,59}'::int[]),
  ('ichiji', 58, '{57,64}'::int[]),
  ('ichiji', 59, '{57,60}'::int[]),
  ('ichiji', 60, '{59,61}'::int[]),
  ('ichiji', 61, '{60,62}'::int[]),
  ('ichiji', 62, '{61,63,67}'::int[]),
  ('ichiji', 63, '{62,65}'::int[]),
  ('ichiji', 64, '{58,66}'::int[]),
  ('ichiji', 65, '{63,68}'::int[]),
  ('ichiji', 66, '{64,70,75}'::int[]),
  ('ichiji', 67, '{62}'::int[]),
  ('ichiji', 68, '{65,69}'::int[]),
  ('ichiji', 69, '{68,71}'::int[]),
  ('ichiji', 70, '{66,72,76}'::int[]),
  ('ichiji', 71, '{69}'::int[]),
  ('ichiji', 72, '{70}'::int[]),
  ('ichiji', 73, '{0,74}'::int[]),
  ('ichiji', 74, '{73,75,78}'::int[]),
  ('ichiji', 75, '{66,74,76}'::int[]),
  ('ichiji', 76, '{70,75,77}'::int[]),
  ('ichiji', 77, '{76,79,80}'::int[]),
  ('ichiji', 78, '{74}'::int[]),
  ('ichiji', 79, '{77}'::int[]),
  ('ichiji', 80, '{77,81}'::int[]),
  ('ichiji', 81, '{80,82,83}'::int[]),
  ('ichiji', 82, '{81,88}'::int[]),
  ('ichiji', 83, '{81,84}'::int[]),
  ('ichiji', 84, '{83,85}'::int[]),
  ('ichiji', 85, '{84,86}'::int[]),
  ('ichiji', 86, '{85,87,91}'::int[]),
  ('ichiji', 87, '{86,89}'::int[]),
  ('ichiji', 88, '{82,90}'::int[]),
  ('ichiji', 89, '{87,92}'::int[]),
  ('ichiji', 90, '{3,88,94}'::int[]),
  ('ichiji', 91, '{86}'::int[]),
  ('ichiji', 92, '{89,93}'::int[]),
  ('ichiji', 93, '{92,95}'::int[]),
  ('ichiji', 94, '{4,90,96}'::int[]),
  ('ichiji', 95, '{93}'::int[]),
  ('ichiji', 96, '{94}'::int[]);
-- @@end:asc_nodes

-- @@seed:asc_mp
delete from public.v2cap_asc_mp;
insert into public.v2cap_asc_mp (cls, id, mp, pct) values
  ('剣士', 9, 12, 0),
  ('剣士', 16, 6, 0),
  ('剣士', 47, 9, 0),
  ('戦士', 17, 6, 0),
  ('戦士', 30, 6, 0),
  ('戦士', 53, 9, 0),
  ('槍使い', 19, 9, 0),
  ('槍使い', 22, 9, 0),
  ('槍使い', 45, 6, 0),
  ('格闘家', 22, 9, 0),
  ('格闘家', 43, 6, 0),
  ('格闘家', 50, 9, 0),
  ('盗賊', 33, 9, 0),
  ('盗賊', 45, 6, 0),
  ('弓使い', 6, 12, 0),
  ('弓使い', 19, 9, 0),
  ('弓使い', 21, 12, 0),
  ('銃士', 2, 6, 0),
  ('銃士', 38, 12, 0),
  ('銃士', 46, 6, 0),
  ('魔法使い', 4, 6, 0),
  ('魔法使い', 17, 6, 0),
  ('魔法使い', 21, 12, 0),
  ('魔法使い', 27, 0, 5),
  ('魔法使い', 31, 6, 0),
  ('魔法使い', 34, 12, 0),
  ('魔法使い', 45, 6, 0),
  ('魔法使い', 50, 9, 0),
  ('魔法使い', 52, 12, 0),
  ('魔法使い', 53, 9, 0),
  ('呪術師', 1, 6, 0),
  ('呪術師', 11, 9, 0),
  ('呪術師', 17, 6, 0),
  ('呪術師', 24, 12, 0),
  ('呪術師', 27, 0, 5),
  ('呪術師', 30, 6, 0),
  ('呪術師', 36, 9, 0),
  ('呪術師', 38, 12, 0),
  ('呪術師', 39, 9, 0),
  ('呪術師', 50, 9, 0),
  ('僧侶', 5, 9, 0),
  ('僧侶', 9, 12, 0),
  ('僧侶', 11, 9, 0),
  ('僧侶', 16, 6, 0),
  ('僧侶', 30, 6, 0),
  ('僧侶', 33, 9, 0),
  ('僧侶', 45, 6, 0),
  ('僧侶', 52, 12, 0),
  ('僧侶', 55, 0, 5),
  ('薬師', 6, 12, 0),
  ('薬師', 16, 6, 0),
  ('薬師', 23, 12, 0),
  ('薬師', 24, 12, 0),
  ('薬師', 25, 9, 0),
  ('薬師', 29, 6, 0),
  ('薬師', 38, 12, 0),
  ('薬師', 41, 0, 5),
  ('薬師', 49, 12, 0),
  ('侍', 12, 12, 0),
  ('侍', 18, 9, 0),
  ('侍', 45, 15, 0),
  ('侍', 78, 9, 0),
  ('侍', 85, 15, 0),
  ('魔法剣士', 2, 9, 0),
  ('魔法剣士', 6, 9, 0),
  ('魔法剣士', 18, 9, 0),
  ('魔法剣士', 26, 9, 0),
  ('魔法剣士', 42, 9, 0),
  ('魔法剣士', 82, 12, 0),
  ('狂戦士', 44, 15, 0),
  ('狂戦士', 66, 9, 0),
  ('狂戦士', 75, 9, 0),
  ('狂戦士', 92, 15, 0),
  ('聖騎士', 15, 15, 0),
  ('聖騎士', 49, 9, 0),
  ('聖騎士', 50, 9, 0),
  ('聖騎士', 57, 12, 0),
  ('聖騎士', 62, 15, 0),
  ('聖騎士', 78, 9, 0),
  ('竜騎士', 33, 12, 0),
  ('竜騎士', 51, 9, 0),
  ('竜騎士', 67, 15, 0),
  ('竜騎士', 76, 9, 0),
  ('ストームランサー', 15, 15, 0),
  ('ストームランサー', 18, 9, 0),
  ('ストームランサー', 51, 9, 0),
  ('ストームランサー', 73, 9, 0),
  ('ストームランサー', 94, 9, 0),
  ('体術師', 28, 9, 0),
  ('体術師', 67, 15, 0),
  ('体術師', 69, 15, 0),
  ('体術師', 86, 15, 0),
  ('サイキッカー', 10, 12, 0),
  ('サイキッカー', 63, 15, 0),
  ('サイキッカー', 82, 12, 0),
  ('サイキッカー', 91, 15, 0),
  ('サイキッカー', 93, 15, 0),
  ('暗殺者', 11, 12, 0),
  ('暗殺者', 51, 9, 0),
  ('暗殺者', 81, 12, 0),
  ('暗殺者', 93, 15, 0),
  ('忍者', 13, 15, 0),
  ('忍者', 39, 15, 0),
  ('忍者', 68, 15, 0),
  ('忍者', 93, 15, 0),
  ('狩人', 14, 15, 0),
  ('狩人', 61, 15, 0),
  ('狩人', 65, 15, 0),
  ('狩人', 66, 9, 0),
  ('狩人', 92, 15, 0),
  ('アークアーチャー', 6, 9, 0),
  ('アークアーチャー', 12, 12, 0),
  ('アークアーチャー', 56, 12, 0),
  ('アークアーチャー', 62, 15, 0),
  ('魔銃士', 21, 15, 0),
  ('魔銃士', 28, 9, 0),
  ('魔銃士', 45, 15, 0),
  ('魔銃士', 51, 9, 0),
  ('魔銃士', 67, 15, 0),
  ('魔銃士', 77, 9, 0),
  ('魔銃士', 86, 15, 0),
  ('デストロイヤー', 12, 12, 0),
  ('デストロイヤー', 36, 12, 0),
  ('デストロイヤー', 70, 9, 0),
  ('デストロイヤー', 87, 15, 0),
  ('デストロイヤー', 93, 15, 0),
  ('元素使い', 8, 12, 0),
  ('元素使い', 15, 15, 0),
  ('元素使い', 22, 9, 0),
  ('元素使い', 25, 9, 0),
  ('元素使い', 29, 9, 0),
  ('元素使い', 44, 15, 0),
  ('元素使い', 47, 0, 5),
  ('元素使い', 57, 12, 0),
  ('元素使い', 61, 15, 0),
  ('元素使い', 62, 15, 0),
  ('元素使い', 70, 9, 0),
  ('元素使い', 74, 9, 0),
  ('元素使い', 76, 9, 0),
  ('元素使い', 78, 9, 0),
  ('元素使い', 80, 12, 0),
  ('元素使い', 85, 15, 0),
  ('元素使い', 92, 15, 0),
  ('元素使い', 93, 15, 0),
  ('クロノマンサー', 5, 9, 0),
  ('クロノマンサー', 8, 12, 0),
  ('クロノマンサー', 20, 15, 0),
  ('クロノマンサー', 36, 12, 0),
  ('クロノマンサー', 45, 15, 0),
  ('クロノマンサー', 46, 9, 0),
  ('クロノマンサー', 54, 9, 0),
  ('クロノマンサー', 58, 12, 0),
  ('クロノマンサー', 60, 12, 0),
  ('クロノマンサー', 64, 9, 0),
  ('クロノマンサー', 71, 0, 5),
  ('クロノマンサー', 83, 12, 0),
  ('クロノマンサー', 84, 12, 0),
  ('クロノマンサー', 85, 15, 0),
  ('クロノマンサー', 92, 15, 0),
  ('死霊使い', 14, 15, 0),
  ('死霊使い', 20, 15, 0),
  ('死霊使い', 22, 9, 0),
  ('死霊使い', 33, 12, 0),
  ('死霊使い', 35, 12, 0),
  ('死霊使い', 36, 12, 0),
  ('死霊使い', 46, 9, 0),
  ('死霊使い', 47, 0, 5),
  ('死霊使い', 51, 9, 0),
  ('死霊使い', 53, 9, 0),
  ('死霊使い', 54, 9, 0),
  ('死霊使い', 56, 12, 0),
  ('死霊使い', 57, 12, 0),
  ('死霊使い', 59, 12, 0),
  ('死霊使い', 62, 15, 0),
  ('死霊使い', 64, 9, 0),
  ('死霊使い', 68, 15, 0),
  ('死霊使い', 78, 9, 0),
  ('死霊使い', 86, 15, 0),
  ('式神使い', 11, 12, 0),
  ('式神使い', 14, 15, 0),
  ('式神使い', 27, 9, 0),
  ('式神使い', 33, 12, 0),
  ('式神使い', 34, 12, 0),
  ('式神使い', 35, 12, 0),
  ('式神使い', 38, 15, 0),
  ('式神使い', 40, 9, 0),
  ('式神使い', 41, 15, 0),
  ('式神使い', 47, 0, 5),
  ('式神使い', 61, 15, 0),
  ('式神使い', 63, 15, 0),
  ('式神使い', 67, 15, 0),
  ('式神使い', 73, 9, 0),
  ('式神使い', 85, 15, 0),
  ('式神使い', 87, 15, 0),
  ('式神使い', 89, 15, 0),
  ('式神使い', 92, 15, 0),
  ('聖職者', 3, 9, 0),
  ('聖職者', 8, 12, 0),
  ('聖職者', 9, 12, 0),
  ('聖職者', 13, 15, 0),
  ('聖職者', 18, 9, 0),
  ('聖職者', 25, 9, 0),
  ('聖職者', 29, 9, 0),
  ('聖職者', 50, 9, 0),
  ('聖職者', 56, 12, 0),
  ('聖職者', 62, 15, 0),
  ('聖職者', 75, 9, 0),
  ('聖職者', 83, 12, 0),
  ('聖職者', 93, 15, 0),
  ('聖職者', 95, 0, 5),
  ('異端審問官', 2, 9, 0),
  ('異端審問官', 4, 9, 0),
  ('異端審問官', 10, 12, 0),
  ('異端審問官', 11, 12, 0),
  ('異端審問官', 14, 15, 0),
  ('異端審問官', 29, 9, 0),
  ('異端審問官', 30, 9, 0),
  ('異端審問官', 37, 15, 0),
  ('異端審問官', 44, 15, 0),
  ('異端審問官', 47, 0, 5),
  ('異端審問官', 49, 9, 0),
  ('異端審問官', 53, 9, 0),
  ('異端審問官', 54, 9, 0),
  ('異端審問官', 63, 15, 0),
  ('異端審問官', 65, 15, 0),
  ('異端審問官', 80, 12, 0),
  ('異端審問官', 87, 15, 0),
  ('異端審問官', 89, 15, 0),
  ('アルケミスト', 22, 9, 0),
  ('アルケミスト', 26, 9, 0),
  ('アルケミスト', 27, 9, 0),
  ('アルケミスト', 35, 12, 0),
  ('アルケミスト', 36, 12, 0),
  ('アルケミスト', 49, 9, 0),
  ('アルケミスト', 51, 9, 0),
  ('アルケミスト', 69, 15, 0),
  ('アルケミスト', 71, 0, 5),
  ('アルケミスト', 73, 9, 0),
  ('アルケミスト', 74, 9, 0),
  ('アルケミスト', 76, 9, 0),
  ('アルケミスト', 81, 12, 0),
  ('アルケミスト', 83, 12, 0),
  ('アルケミスト', 85, 15, 0),
  ('霊薬師', 4, 9, 0),
  ('霊薬師', 12, 12, 0),
  ('霊薬師', 15, 15, 0),
  ('霊薬師', 22, 9, 0),
  ('霊薬師', 28, 9, 0),
  ('霊薬師', 29, 9, 0),
  ('霊薬師', 40, 9, 0),
  ('霊薬師', 41, 15, 0),
  ('霊薬師', 47, 0, 5),
  ('霊薬師', 50, 9, 0),
  ('霊薬師', 51, 9, 0),
  ('霊薬師', 54, 9, 0),
  ('霊薬師', 63, 15, 0),
  ('霊薬師', 65, 15, 0),
  ('霊薬師', 70, 9, 0),
  ('霊薬師', 76, 9, 0),
  ('霊薬師', 78, 9, 0),
  ('霊薬師', 86, 15, 0);
-- @@end:asc_mp

-- その職業で開いたマス（盤面に無い番号・数でないもの・重なりは捨てて小さい順・起点の0は入れない）。ascension.js の ascStateOf
create or replace function public.v2cap_asc_state(p_asc jsonb, p_cls text)
returns int[] language sql stable set search_path = public as $$
  select coalesce(array_agg(n.id order by n.id), '{}')
    from public.v2cap_classes c
    join public.v2cap_asc_nodes n on n.stage = c.stage
   where c.id = p_cls and n.id > 0
     and jsonb_typeof(coalesce(p_asc, '{}'::jsonb) -> p_cls) = 'array'
     and exists (select 1 from jsonb_array_elements(p_asc -> p_cls) as e(v)
                  where jsonb_typeof(e.v) = 'number' and (e.v #>> '{}')::numeric = n.id)
$$;
revoke all on function public.v2cap_asc_state(jsonb, text) from public, anon, authenticated;

-- 使ったAP（開いたマスの数＝どのマスも1AP）。ascension.js の apSpentOf
create or replace function public.v2cap_asc_spent(p_asc jsonb, p_cls text)
returns int language sql stable set search_path = public as $$
  select coalesce(cardinality(public.v2cap_asc_state(p_asc, p_cls)), 0)
$$;
revoke all on function public.v2cap_asc_spent(jsonb, text) from public, anon, authenticated;

-- その職業のAP＝CLASS LVが上がった回数×1（上限より上は増えない）。jobs.js の jobLevelsGained × ASC_AP_PER_JLV
create or replace function public.v2cap_asc_ap(p_jobs jsonb, p_cls text)
returns int language sql stable set search_path = public as $$
  select coalesce((
    select greatest(0, least(coalesce((p_jobs -> p_cls ->> 'lv')::int, 1), s.max_jlv) - 1) * 1
      from public.v2cap_classes c join public.v2cap_stages s on s.stage = c.stage
     where c.id = p_cls), 0)
$$;
revoke all on function public.v2cap_asc_ap(jsonb, text) from public, anon, authenticated;

-- アセンションで上がるMP（スキル編成の最大MP）。loadout.js の statBreakdown と同じ数え方：
--   開いたMPの小マスの合計 ＋ 開いたMPの大マスの%×（p_base＋小マスのMP）の四捨五入（ascension.js の ascPctGain）
--   p_base ＝ 本体のMP＋クラスのMP（装備にMPは無い＝画面の「本体＋クラス＋装備」と同じ）
create or replace function public.v2cap_asc_mp(p_asc jsonb, p_cls text, p_base int)
returns int language sql stable set search_path = public as $$
  with f as (
    select coalesce(sum(m.mp), 0)::int as flat, coalesce(sum(m.pct), 0)::int as pct
      from public.v2cap_asc_mp m
     where m.cls = p_cls and m.id = any(public.v2cap_asc_state(p_asc, p_cls))
  )
  select f.flat + round((coalesce(p_base, 0) + f.flat) * f.pct / 100.0)::int from f
$$;
revoke all on function public.v2cap_asc_mp(jsonb, text, int) from public, anon, authenticated;

-- スキル編成の最大MP＝本体のMP＋クラスのMP＋アセンションのMP（いまの職業・転職先・覚えた技を空き枠へ入れる・キャラ作成で使う）
create or replace function public.v2cap_max_mp(p_mp int, p_asc jsonb, p_cls text, p_jlv int)
returns int language sql stable set search_path = public as $$
  select b.base + public.v2cap_asc_mp(p_asc, p_cls, b.base)
    from (select coalesce(p_mp, 0) + public.v2cap_job_bonus_mp(p_cls, p_jlv) as base) as b
$$;
revoke all on function public.v2cap_max_mp(int, jsonb, text, int) from public, anon, authenticated;

-- ---- 開く ----
-- p_class の盤面の p_nodes を順に開く。どのマスも、起点・開いたマス・この中で先に開くマスのどれかにつながっていること。
-- 確かめる順と文言は ascension.js の ascendError と同じ（いまの職業でなくても、APがあれば開ける）
create or replace function public.v2cap_ascend(p_class text, p_nodes int[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.v2cap_profiles;
  v_stage text;
  v_asc   jsonb;
  v_open  int[];
  v_id    int;
  v_links int[];
  v_left  int;
  v_save  jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select c.stage into v_stage from public.v2cap_classes c where c.id = p_class;
  if v_stage is null or not exists (select 1 from public.v2cap_asc_nodes n where n.stage = v_stage) then
    return jsonb_build_object('ok', false, 'error', 'その職業にはアセンションがありません');
  end if;
  if p_nodes is null or coalesce(cardinality(p_nodes), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'マスを選んでください');
  end if;
  v_asc  := case when jsonb_typeof(v_row.ascension) = 'object' then v_row.ascension else '{}'::jsonb end;
  v_open := array[0] || public.v2cap_asc_state(v_asc, p_class);
  foreach v_id in array p_nodes loop
    if v_id is null or v_id <= 0 then return jsonb_build_object('ok', false, 'error', 'そのマスはありません'); end if;
    select n.links into v_links from public.v2cap_asc_nodes n where n.stage = v_stage and n.id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'そのマスはありません'); end if;
    if v_id = any(v_open) then return jsonb_build_object('ok', false, 'error', 'もう開いています'); end if;
    if not (coalesce(v_links, '{}') && v_open) then
      return jsonb_build_object('ok', false, 'error', 'つながっていないマスは開けません');
    end if;
    v_open := v_open || v_id;
  end loop;
  v_left := public.v2cap_asc_ap(v_row.jobs, p_class) - public.v2cap_asc_spent(v_asc, p_class);
  if cardinality(p_nodes) > v_left then return jsonb_build_object('ok', false, 'error', 'APが足りません'); end if;
  -- 保存は起点の0を除いて小さい順
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_save from unnest(v_open) as t(x) where x > 0;
  update public.v2cap_profiles
     set ascension = jsonb_set(v_asc, array[p_class], v_save), updated_at = now()
   where id = v_uid
   returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_ascend(text, int[]) from public, anon;
grant execute on function public.v2cap_ascend(text, int[]) to authenticated;

-- ---- 振り直し ----
-- p_class の盤面を全部戻してAPを返す。費用は LV×100 Gold（ascension.js の ascResetGoldOf）。
-- いまの職業なら、スキル編成を新しい最大MPに収める（MPのマスを戻すと最大MPが下がるため・v2cap_fit_set）。
-- ほかの職業の編成は、転職したときに v2cap_change_class が収める
create or replace function public.v2cap_ascend_reset(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_gold_per_lv constant int := 100;
  v_uid  uuid := auth.uid();
  v_row  public.v2cap_profiles;
  v_asc  jsonb;
  v_gold bigint;
  v_sets jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if not exists (select 1 from public.v2cap_classes c join public.v2cap_asc_nodes n on n.stage = c.stage where c.id = p_class) then
    return jsonb_build_object('ok', false, 'error', 'その職業にはアセンションがありません');
  end if;
  v_asc := case when jsonb_typeof(v_row.ascension) = 'object' then v_row.ascension else '{}'::jsonb end;
  if public.v2cap_asc_spent(v_asc, p_class) <= 0 then return jsonb_build_object('ok', false, 'error', 'まだAPを振っていません'); end if;
  v_gold := greatest(1, v_row.lv)::bigint * c_gold_per_lv;
  if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;
  v_asc := v_asc - p_class;
  v_sets := case when jsonb_typeof(v_row.skill_sets) = 'object' then v_row.skill_sets else '{}'::jsonb end;
  if p_class = v_row.class and jsonb_typeof(v_sets -> p_class) = 'array' then
    v_sets := jsonb_set(v_sets, array[p_class], public.v2cap_fit_set(v_sets -> p_class, p_class, v_row.learned,
      public.v2cap_max_mp(v_row.mp, v_asc, p_class, coalesce((v_row.jobs -> p_class ->> 'lv')::int, 1))));
  end if;
  update public.v2cap_profiles
     set gold = gold - v_gold, ascension = v_asc, skill_sets = v_sets, updated_at = now()
   where id = v_uid
   returning * into v_row;
  return jsonb_build_object('ok', true, 'gold', v_gold, 'profile', to_jsonb(v_row));
end;
$$;
revoke all on function public.v2cap_ascend_reset(text) from public, anon;
grant execute on function public.v2cap_ascend_reset(text) to authenticated;

-- ===== 一度だけ：初期職の技を CLASS LV25・30 で1つずつ足した（2026-10-14 ユーザー承認）=====
-- 初期11職の技が5つ→7つになり（skills.js の LATE_SKILLS・v2cap_stages.learn_at が {1,5,10,15,20,25,30}）、
-- 剣士・槍使いはクラスのステの配分も変わった（jobs.js の JOB_BONUS）。アセンションの盤面は「技の数」と「配分」から中身を作るので、
-- 初期11職の盤面の中身が入れ替わる（ascension.js の placeSkillsOf・mixStatsOf）。今いるキャラは一度だけ：
--   ①初期職の盤面を空にする（ユーザーが選んだ「1回だけ戻してAPを返す」・Goldは取らない。APは CLASS LV から数え直すので戻る）
--   ②就いたことのある職業ぜんぶ、その CLASS LV までの技を覚える（v2cap_learn。CLASS LV25・30 を越えている人に新しい技が入る）
--   ③編成のある職業ぜんぶ：盤面を戻して最大MPが減ったぶん収め（v2cap_fit_set）、新しく覚えた技を空き枠へ入れる（v2cap_fill_set）
-- ★印 shoki_skills_2530_20261014 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r         record;
  j         record;
  v_asc     jsonb;
  v_old     jsonb;
  v_learned jsonb;
  v_added   jsonb;
  v_sets    jsonb;
  v_set     jsonb;
  v_max     int;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'shoki_skills_2530_20261014') then
    for r in select p.id, p.mp, p.jobs, p.learned, p.skill_sets, p.ascension from public.v2cap_profiles p loop
      v_asc := case when jsonb_typeof(r.ascension) = 'object' then r.ascension else '{}'::jsonb end;
      v_asc := v_asc - array(select c.id from public.v2cap_classes c where c.stage = 'shoki');
      v_old := coalesce(r.learned, '[]'::jsonb);
      v_learned := v_old;
      for j in select e.key as cls, e.value as v from jsonb_each(coalesce(r.jobs, '{}'::jsonb)) e loop
        v_learned := public.v2cap_learn(v_learned, j.cls, coalesce((j.v ->> 'lv')::int, 1));
      end loop;
      select coalesce(jsonb_agg(t.name order by t.i), '[]'::jsonb) into v_added
        from jsonb_array_elements_text(v_learned) with ordinality as t(name, i) where not (v_old ? t.name);
      v_sets := case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end;
      for j in select e.key as cls, e.value as v from jsonb_each(v_sets) e where jsonb_typeof(e.value) = 'array' loop
        v_max := public.v2cap_max_mp(r.mp, v_asc, j.cls, coalesce((r.jobs -> j.cls ->> 'lv')::int, 1));
        v_set := public.v2cap_fit_set(j.v, j.cls, v_learned, v_max);
        v_set := public.v2cap_fill_set(v_set, v_added, j.cls, v_max);
        v_sets := jsonb_set(v_sets, array[j.cls], v_set);
      end loop;
      update public.v2cap_profiles
         set ascension = v_asc, learned = v_learned, skill_sets = v_sets, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('shoki_skills_2530_20261014');
  end if;
end $$;

-- ============================================================
-- ===== 13. 塔（あるけみすと型の対人・2026-10-14）=====
-- ============================================================
-- 【確定】2026-10-14 ユーザー指示「普通にあるケミ風のPVPも用意しておく・○○の塔みたいな感じで1層～100層くらいまで
--   どんどん塔に上る感じ・仕様はあるケミと一緒、階層守護者になっている間はドロップ率1%増加」
--   ＋選択式で決めたこと：負けたら2つ下（あるけみと同じ）／空き層にNPC＋席を降りられる（今のⅡと同じ）／報酬は出撃と同じ旨み
-- 決まり（src/v2cap/lib/tower.js が正。今のⅡのアリーナ §10 と同じ形）：
--   ・1〜100層。各層に階層守護者が1人（行が無い層＝空き。画面が tower.js のNPCを置く＝サーバーは「空き」として扱うだけ）
--   ・勝つとその層の守護者になる。**守っているあいだは挑戦できない**
--   ・守っている層を破られた人は、1つ上の層へ挑戦できるようになる。自分から降りても1つ上へ（v2cap_tower_retire）
--   ・挑戦して負けると **2つ下** の層へ（あるけみと同じ・1層より下には行かない）
--   ・**守護者のHP/MPは回復しない**（残りHPは最大HPの千分率 hp_pm で持つ＝相手のLVで対人のHP倍率が変わっても割合で引き継ぐ）。
--     挑戦する側は毎回満タン。守護者が守り切るたびに連勝数 streak が1つ増える（挑戦する側のステ +5n% の元）
--   ・**勝ち負けによらず**、出撃と同じ旨み：開いている一番先の場所の「ふつうの敵1体ぶん」のEXP・Gold（倍率なし）＋
--     装備（その場所のエリアの装備・ノーマルかレア・武器はいまの職業の種類＝出撃のふつうの敵と同じ条件）
--   ・出撃と**待ち時間を共有**する（last_sortie_at を出撃と同じに見て、同じに書く。8秒）
--   ・守護者でいるあいだ、出撃の装備のドロップ率+1%（画面の確率＝サーバーは何が落ちたかの条件だけを見る。tower_guard で分かる）
-- ★戦闘は画面で回し、ここへ結果を申告する（出撃と同じ形）。**対人なので申告を信じる穴が残る**（勝ち負け・残りHP・守護者の姿）。
--   公開の前に、出撃と一緒にサーバーで戦闘を回すか決める（設計書 §10）
-- ★戦った相手が今の守護者か（p_foe＝守護者の id・空きなら null）を見る。画面が古いあいだに入れ替わっていたら何もせずに返す
--   （待ち時間も使わない・changed を返す＝画面が一覧を読み直して、もう一度挑戦してもらう）
alter table public.v2cap_profiles add column if not exists tower_floor  int not null default 1;  -- 次に挑戦する層
alter table public.v2cap_profiles add column if not exists tower_guard  int;                     -- 守っている層（守っていなければ null）
alter table public.v2cap_profiles add column if not exists tower_wins   int not null default 0;
alter table public.v2cap_profiles add column if not exists tower_losses int not null default 0;

-- 各層の階層守護者。行が無い層＝空き（NPC）。1人が守れるのは1層だけ。キャラを消すと（作り直し）行も消える
create table if not exists public.v2cap_tower_floors (
  floor     int primary key check (floor between 1 and 100),
  player_id uuid not null unique references public.v2cap_profiles(id) on delete cascade,
  snapshot  jsonb not null,                -- 守護者になったときの姿（tower.js の snapshotOf）
  hp_pm     int not null default 1000,     -- 残りHP（最大HPの千分率・1〜1000）。★回復しない
  mp        int not null default 0,        -- 残りMP。★回復しない
  streak    int not null default 0,        -- 守り切った回数（連勝数）
  since     timestamptz not null default now()
);
alter table public.v2cap_tower_floors enable row level security;
-- 一覧は誰でも読める（誰が何層を守っているかは公開の情報）。書き込みはRPCだけ（ポリシーを足さない）
drop policy if exists v2cap_tower_read on public.v2cap_tower_floors;
create policy v2cap_tower_read on public.v2cap_tower_floors for select to authenticated using (public.v2cap_is_dev());

-- ===== 挑戦の結果を反映する =====
-- p_floor      … 挑戦した層（画面が見ていた層。サーバーの tower_floor と違えば通さない）
-- p_foe        … 戦った守護者の id（空きの層＝NPCなら null）
-- p_win        … 勝ったか
-- p_my_hp_pm・p_my_mp   … 戦い終わったときの自分の残りHP（千分率）・MP（勝って守護者になるときに座る値）
-- p_foe_hp_pm・p_foe_mp … 戦い終わったときの守護者の残りHP（千分率）・MP（負けたとき、守護者がその値で座り直す）
-- p_snapshot   … 自分の姿（勝って守護者になるとき用）
-- p_drop       … 画面が引いた装備（出撃と同じ形。条件に合わなければ入れない）
drop function if exists public.v2cap_tower_fight(int, uuid, boolean, int, int, int, int, jsonb, text);
create or replace function public.v2cap_tower_fight(
  p_floor int, p_foe uuid, p_win boolean,
  p_my_hp_pm int, p_my_mp int, p_foe_hp_pm int, p_foe_mp int,
  p_snapshot jsonb, p_drop text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cd     constant interval := interval '8 seconds';   -- 出撃と同じ（待ち時間を共有）
  c_floors constant int := 100;                         -- tower.js の FLOORS
  c_lose   constant int := 2;                           -- tower.js の LOSE_DROP（負けたら2つ下）
  v_uid   uuid := auth.uid();
  v_row   public.v2cap_profiles;
  v_cls   public.v2cap_classes;
  v_spot  public.v2cap_spots;
  v_eq    public.v2cap_equipment;
  v_champ public.v2cap_tower_floors;
  v_has   boolean;
  v_floor int;
  v_next  int;
  v_win   boolean := coalesce(p_win, false);
  v_exp   int;
  v_gold  int;
  v_inv   bigint;
  v_drop  jsonb := null;
  v_res   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  -- ★行をつかんでから見る（同時に2回届いても、待ち時間の判定をすり抜けないように）
  select * into v_row from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  -- 守っているあいだは挑戦できない（あるけみと同じ）
  if v_row.tower_guard is not null or exists (select 1 from public.v2cap_tower_floors where player_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', '守っているあいだは挑戦できません');
  end if;
  if v_row.last_sortie_at is not null and v_row.last_sortie_at > now() - c_cd then
    return jsonb_build_object('ok', false, 'error', '待ち時間が終わっていません');
  end if;
  v_floor := least(greatest(coalesce(v_row.tower_floor, 1), 1), c_floors);
  if p_floor is distinct from v_floor then
    return jsonb_build_object('ok', false, 'error', '挑戦する層が変わりました。もう一度挑戦してください', 'changed', true);
  end if;

  -- その層の守護者（いれば行をつかむ）。戦った相手と違えば（画面が古いあいだに入れ替わった）何もしない
  select * into v_champ from public.v2cap_tower_floors where floor = v_floor for update;
  v_has := found;
  if (v_has and v_champ.player_id is distinct from p_foe) or (not v_has and p_foe is not null) then
    return jsonb_build_object('ok', false, 'error', '守護者が入れ替わりました。もう一度挑戦してください', 'changed', true);
  end if;

  -- デイリーミッション（§10・2026-10-15）：「塔に挑戦する」を1つ数える（勝ち負けによらず）。
  --   守護者になる前・経験値を入れる前に数える（この日はじめてなら、挑戦する前の姿＝守っていない・挑戦する前のLVで受注する）
  perform public.v2cap_daily_bump(v_uid, 'tower', 1);

  if v_win then
    -- 破られた守護者は「1つ上へ挑戦できる」状態に戻す（席は空ける）
    if v_has then
      update public.v2cap_profiles
         set tower_floor = least(c_floors, v_floor + 1), tower_guard = null, tower_losses = tower_losses + 1, updated_at = now()
       where id = v_champ.player_id;
      delete from public.v2cap_tower_floors where floor = v_floor;
    end if;
    -- 自分がその層の守護者になる。**HP/MPは戦い終わった値のまま座る**。
    --   空きの層に同時に2人が勝ったときは、あとの人を通さない（入れ替わった扱い）
    insert into public.v2cap_tower_floors (floor, player_id, snapshot, hp_pm, mp, streak, since)
    values (v_floor, v_uid, coalesce(p_snapshot, '{}'::jsonb),
            least(1000, greatest(1, coalesce(p_my_hp_pm, 1000))), greatest(0, coalesce(p_my_mp, 0)), 0, now())
    on conflict (floor) do nothing;
    if not found then
      return jsonb_build_object('ok', false, 'error', '守護者が入れ替わりました。もう一度挑戦してください', 'changed', true);
    end if;
    v_next := v_floor;
    update public.v2cap_profiles
       set tower_guard = v_floor, tower_floor = v_floor, tower_wins = tower_wins + 1, updated_at = now()
     where id = v_uid;
  else
    -- 負け。守護者は**HP/MPが減ったまま**居座り、連勝数が1つ増える
    if v_has then
      update public.v2cap_tower_floors
         set hp_pm = least(1000, greatest(1, coalesce(p_foe_hp_pm, hp_pm))), mp = greatest(0, coalesce(p_foe_mp, mp)),
             streak = streak + 1
       where floor = v_floor;
      update public.v2cap_profiles set tower_wins = tower_wins + 1, updated_at = now() where id = v_champ.player_id;
    end if;
    -- 2つ下へ（あるけみと同じ・1層より下には行かない）
    v_next := greatest(1, v_floor - c_lose);
    update public.v2cap_profiles
       set tower_floor = v_next, tower_losses = tower_losses + 1, updated_at = now()
     where id = v_uid;
  end if;

  -- 報酬（勝ち負けによらず・出撃と同じ旨み）：開いている一番先の場所の「ふつうの敵1体ぶん」（場所の表の値・倍率なし）
  select * into v_spot from public.v2cap_spots where id = public.v2cap_open_until(v_row.cleared_spots);
  v_exp  := v_spot.exp_min  + floor(random() * (v_spot.exp_max  - v_spot.exp_min  + 1))::int;
  v_gold := v_spot.gold_min + floor(random() * (v_spot.gold_max - v_spot.gold_min + 1))::int;
  -- 装備：その場所のエリアの装備で、ふつうの敵から落ちるレア度（ノーマル・レア）、武器ならいまの職業の種類のときだけ入れる
  if p_drop is not null then
    select * into v_cls from public.v2cap_classes where id = v_row.class;
    select * into v_eq from public.v2cap_equipment e where e.id = p_drop;
    if found and v_eq.area = v_spot.area and v_eq.rarity in ('N', 'R')
       and (v_eq.part <> '武器' or v_eq.type = any(coalesce(v_cls.weapons, '{}'))) then
      insert into public.v2cap_inventory (player_id, base_id, ilv)
      values (v_uid, v_eq.id, v_eq.lv) returning id into v_inv;
      v_drop := jsonb_build_object('id', v_inv, 'base_id', v_eq.id, 'rarity', v_eq.rarity, 'ilv', v_eq.lv);
    end if;
  end if;
  -- 待ち時間は出撃と共有（出撃の精算と同じ列）
  update public.v2cap_profiles set gold = gold + v_gold, last_sortie_at = now(), updated_at = now() where id = v_uid;
  v_res := public.v2cap_apply_exp(v_uid, v_exp);
  return jsonb_build_object('ok', true, 'win', v_win, 'floor', v_floor, 'next_floor', v_next,
    'guard', case when v_win then v_floor end, 'exp', v_exp, 'gold', v_gold, 'drop', v_drop, 'level', v_res);
end;
$$;
revoke all on function public.v2cap_tower_fight(int, uuid, boolean, int, int, int, int, jsonb, text) from public, anon;
grant execute on function public.v2cap_tower_fight(int, uuid, boolean, int, int, int, int, jsonb, text) to authenticated;

-- ===== 席を降りる（守るのをやめる）=====
-- ★あるけみすとに「降りる」は無い（破られるまで上へ行けない）。人が少ないと詰むので足した（今のⅡと同じ・ユーザーが選んだ）。
--   降りると破られたときと同じ扱い＝次は1つ上の層へ挑戦できる。待ち時間は使わない
drop function if exists public.v2cap_tower_retire();
create or replace function public.v2cap_tower_retire()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_floors constant int := 100;   -- tower.js の FLOORS
  v_uid   uuid := auth.uid();
  v_floor int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2cap_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform 1 from public.v2cap_profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  delete from public.v2cap_tower_floors where player_id = v_uid returning floor into v_floor;
  if v_floor is null then
    -- 守っていない（念のため印もそろえておく）
    update public.v2cap_profiles set tower_guard = null where id = v_uid and tower_guard is not null;
    return jsonb_build_object('ok', false, 'error', 'どの層も守っていません');
  end if;
  update public.v2cap_profiles
     set tower_guard = null, tower_floor = least(c_floors, v_floor + 1), updated_at = now()
   where id = v_uid;
  return jsonb_build_object('ok', true, 'floor', v_floor, 'next_floor', least(c_floors, v_floor + 1));
end;
$$;
revoke all on function public.v2cap_tower_retire() from public, anon;
grant execute on function public.v2cap_tower_retire() to authenticated;

-- ===== 一度だけ：上位職の並び替え（2026-10-14 ユーザー承認）=====
-- V1の職業を続投し、横文字の名前も入れた（jobs.js の ICHIJI_INFO・ICHIJI_RENAMED）。職業と技の表（v2cap_classes・v2cap_skills）は上の種で入れ替わる。
--   ・名前だけ変えた10職：槍術士→ストームランサー・狙撃手→アークアーチャー・砲撃士→デストロイヤー・魔導士→元素使い・時魔導士→クロノマンサー・
--     死霊術師→死霊使い・陰陽師→式神使い・司祭→聖職者・祓魔師→異端審問官・錬金術師→アルケミスト（技は同じ＝編成もそのまま移す）
--   ・入れ替え：重戦士→聖騎士・気功師→サイキッカー（技が替わる＝その職業の編成は作り直す）。剣士系に侍・魔法剣士を足した
-- 今いるキャラは一度だけ：
--   ①いまの職業・CLASS LV（jobs）・編成（skill_sets）を新しい名前へ移す（CLASS LVはそのまま）
--   ②覚えた技（learned）から名簿に無い技（重戦士・気功師の技）を外し、就いたことのある職業ぜんぶ、その CLASS LV までの技を覚え直す
--   ③上位職のアセンションの盤面を空にする（盤面は職業の名前と技・配分から作るので中身が変わる。APは CLASS LV から数え直すので戻る・Goldは取らない）
--   ④編成：最大MPに収め直す。編成が無い職業（入れ替えた2職）がいまの職業なら、覚えた技で作り直す（v2cap_default_set）
-- ★印 ichiji_roster_20261014 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r         record;
  j         record;
  v_map     jsonb := '{"槍術士":"ストームランサー","狙撃手":"アークアーチャー","砲撃士":"デストロイヤー","魔導士":"元素使い","時魔導士":"クロノマンサー","死霊術師":"死霊使い","陰陽師":"式神使い","司祭":"聖職者","祓魔師":"異端審問官","錬金術師":"アルケミスト","重戦士":"聖騎士","気功師":"サイキッカー"}'::jsonb;
  v_newkit  text[] := array['重戦士', '気功師'];
  v_cls     text;
  v_jobs    jsonb;
  v_sets    jsonb;
  v_set     jsonb;
  v_learned jsonb;
  v_asc     jsonb;
  v_max     int;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'ichiji_roster_20261014') then
    for r in select p.id, p.class, p.mp, p.jobs, p.learned, p.skill_sets, p.ascension from public.v2cap_profiles p loop
      v_cls := coalesce(v_map ->> r.class, r.class);
      -- ① CLASS LV と編成を新しい名前へ
      v_jobs := '{}'::jsonb;
      for j in select e.key, e.value from jsonb_each(case when jsonb_typeof(r.jobs) = 'object' then r.jobs else '{}'::jsonb end) e loop
        v_jobs := v_jobs || jsonb_build_object(coalesce(v_map ->> j.key, j.key), j.value);
      end loop;
      v_sets := '{}'::jsonb;
      for j in select e.key, e.value from jsonb_each(case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end) e loop
        continue when j.key = any(v_newkit);
        v_sets := v_sets || jsonb_build_object(coalesce(v_map ->> j.key, j.key), j.value);
      end loop;
      -- ② 覚えた技
      select coalesce(jsonb_agg(t.n order by t.i), '[]'::jsonb) into v_learned
        from jsonb_array_elements_text(case when jsonb_typeof(r.learned) = 'array' then r.learned else '[]'::jsonb end) with ordinality as t(n, i)
       where exists (select 1 from public.v2cap_skills s where s.name = t.n);
      for j in select e.key, e.value from jsonb_each(v_jobs) e loop
        v_learned := public.v2cap_learn(v_learned, j.key, coalesce((j.value ->> 'lv')::int, 1));
      end loop;
      -- ③ 上位職の盤面（前の名前のぶんも）を空にする
      v_asc := case when jsonb_typeof(r.ascension) = 'object' then r.ascension else '{}'::jsonb end;
      v_asc := v_asc - array(select c.id from public.v2cap_classes c where c.stage = 'ichiji');
      v_asc := v_asc - array(select jsonb_object_keys(v_map));
      -- ④ 編成
      for j in select e.key, e.value from jsonb_each(v_sets) e where jsonb_typeof(e.value) = 'array' loop
        continue when not exists (select 1 from public.v2cap_classes c where c.id = j.key);
        v_max := public.v2cap_max_mp(r.mp, v_asc, j.key, coalesce((v_jobs -> j.key ->> 'lv')::int, 1));
        v_sets := jsonb_set(v_sets, array[j.key], public.v2cap_fit_set(j.value, j.key, v_learned, v_max));
      end loop;
      if jsonb_typeof(v_sets -> v_cls) is distinct from 'array' then
        v_max := public.v2cap_max_mp(r.mp, v_asc, v_cls, coalesce((v_jobs -> v_cls ->> 'lv')::int, 1));
        v_set := public.v2cap_default_set(v_cls, v_learned, v_max);
        v_sets := jsonb_set(v_sets, array[v_cls], v_set);
      end if;
      update public.v2cap_profiles
         set class = v_cls, jobs = v_jobs, skill_sets = v_sets, learned = v_learned, ascension = v_asc, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('ichiji_roster_20261014');
  end if;
end $$;

-- ===== 一度だけ：上位クラスの作り直し（2026-10-15 ユーザー「チャット版の方でいろいろ考えた。ここで再度調整して」）=====
-- 上位クラスの技が CLASS LV35・45 で2つずつ増えて10個になった（v2cap_stages.learn_at と v2cap_skills は上の種で入れ替わる）。
-- 回数の上限がある技（狂鬼化・ゴスペル・エリクサー＝1・不動の誓い＝2）は v2cap_skills.uses_max。
-- 今いるキャラは一度だけ：
--   ①技の名前を変えたもの（間合い取り→嵐の構え）を、覚えた技（learned）と全部の職業の編成（skill_sets）で付け替える
--   ②就いたことのある職業ぜんぶ、その CLASS LV までの技を覚え直す（CLASS LV35・45 の新しい技）
--   ③上位クラスのアセンションの盤面を空にする（技が10個になり、技のマスが10個・置き場所が変わる＝中身が変わる。
--     APは CLASS LV から数え直すので戻る・Goldは取らない）
--   ④編成：最大MPに収め直す（消費MPが変わった技がある）。空き枠があれば、②で新しく覚えた技を入れる（v2cap_fill_set）
-- ★印 ichiji_rework_20261015 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r         record;
  j         record;
  v_ren     jsonb := '{"間合い取り":"嵐の構え"}'::jsonb;
  v_sets    jsonb;
  v_set     jsonb;
  v_learned jsonb;
  v_before  jsonb;
  v_new     jsonb;
  v_asc     jsonb;
  v_max     int;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'ichiji_rework_20261015') then
    for r in select p.id, p.class, p.mp, p.jobs, p.learned, p.skill_sets, p.ascension from public.v2cap_profiles p loop
      -- ① 覚えた技：名前を付け替え、名簿に無い技を外す（同じ技が2つにならないように）
      select coalesce(jsonb_agg(x.n order by x.i), '[]'::jsonb) into v_learned
        from (select distinct on (coalesce(v_ren ->> t.n, t.n)) coalesce(v_ren ->> t.n, t.n) as n, t.i
                from jsonb_array_elements_text(case when jsonb_typeof(r.learned) = 'array' then r.learned else '[]'::jsonb end) with ordinality as t(n, i)
               order by coalesce(v_ren ->> t.n, t.n), t.i) x
       where exists (select 1 from public.v2cap_skills s where s.name = x.n);
      v_before := v_learned;
      -- 編成の名前も付け替える
      v_sets := '{}'::jsonb;
      for j in select e.key, e.value from jsonb_each(case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end) e loop
        if jsonb_typeof(j.value) = 'array' then
          select coalesce(jsonb_agg(case when v_ren ? (t.e ->> 'name')
                                         then jsonb_set(t.e, '{name}', to_jsonb(v_ren ->> (t.e ->> 'name')))
                                         else t.e end order by t.i), '[]'::jsonb)
            into v_set
            from jsonb_array_elements(j.value) with ordinality as t(e, i);
          v_sets := v_sets || jsonb_build_object(j.key, v_set);
        else
          v_sets := v_sets || jsonb_build_object(j.key, j.value);
        end if;
      end loop;
      -- ② 就いたことのある職業ぜんぶ、その CLASS LV までの技を覚え直す
      for j in select e.key, e.value from jsonb_each(case when jsonb_typeof(r.jobs) = 'object' then r.jobs else '{}'::jsonb end) e loop
        continue when not exists (select 1 from public.v2cap_classes c where c.id = j.key);
        v_learned := public.v2cap_learn(v_learned, j.key, coalesce((j.value ->> 'lv')::int, 1));
      end loop;
      -- 新しく覚えた技（覚えた順）
      select coalesce(jsonb_agg(t.n order by t.i), '[]'::jsonb) into v_new
        from jsonb_array_elements_text(v_learned) with ordinality as t(n, i)
       where not (v_before ? t.n);
      -- ③ 上位クラスの盤面を空にする
      v_asc := case when jsonb_typeof(r.ascension) = 'object' then r.ascension else '{}'::jsonb end;
      v_asc := v_asc - array(select c.id from public.v2cap_classes c where c.stage = 'ichiji');
      -- ④ 編成：最大MPに収め直し、空き枠に新しい技を入れる
      for j in select e.key, e.value from jsonb_each(v_sets) e where jsonb_typeof(e.value) = 'array' loop
        continue when not exists (select 1 from public.v2cap_classes c where c.id = j.key);
        v_max := public.v2cap_max_mp(r.mp, v_asc, j.key, coalesce((r.jobs -> j.key ->> 'lv')::int, 1));
        v_set := public.v2cap_fit_set(j.value, j.key, v_learned, v_max);
        v_set := public.v2cap_fill_set(v_set, v_new, j.key, v_max);
        v_sets := jsonb_set(v_sets, array[j.key], v_set);
      end loop;
      update public.v2cap_profiles
         set skill_sets = v_sets, learned = v_learned, ascension = v_asc, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('ichiji_rework_20261015');
  end if;
end $$;

-- ===== 一度だけ：盗賊のクラスのステの配分を変えた（2026-10-15 ユーザー選択「LUK29→19・STR+10」）=====
-- 盗賊は対人の勝率が74〜75%で初期職で飛び抜けていた（元はLUKの多さ＝クリティカルの出やすさ）。
-- 配分（jobs.js の JOB_BONUS）が LUK29→19・STR51→61 になった（合計232のまま・v2cap_classes.bonus_seq は上の種で入れ替わる）。
-- アセンションの盤面は配分から中身（小マスのステの数と置き場・大マス）を作るので、盗賊の盤面の中身が入れ替わる
-- （ascension.js の mixStatsOf・areaStatsOf）。今いるキャラは一度だけ（2026-10-14 の初期職と同じやり方）：
--   ①盗賊の盤面を空にする（APは CLASS LV から数え直すので戻る・Goldは取らない）
--   ②編成のある職業ぜんぶ：盤面を戻して最大MPが減ったぶん収める（v2cap_fit_set）
-- ★印 touzoku_luk_20261015 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r      record;
  j      record;
  v_asc  jsonb;
  v_sets jsonb;
  v_max  int;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'touzoku_luk_20261015') then
    for r in select p.id, p.mp, p.jobs, p.learned, p.skill_sets, p.ascension from public.v2cap_profiles p
              where jsonb_typeof(p.ascension) = 'object' and p.ascension ? '盗賊' loop
      v_asc := r.ascension - '盗賊';
      v_sets := case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end;
      for j in select e.key as cls, e.value as v from jsonb_each(v_sets) e where jsonb_typeof(e.value) = 'array' loop
        v_max := public.v2cap_max_mp(r.mp, v_asc, j.cls, coalesce((r.jobs -> j.cls ->> 'lv')::int, 1));
        v_sets := jsonb_set(v_sets, array[j.cls], public.v2cap_fit_set(j.v, j.cls, coalesce(r.learned, '[]'::jsonb), v_max));
      end loop;
      update public.v2cap_profiles
         set ascension = v_asc, skill_sets = v_sets, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('touzoku_luk_20261015');
  end if;
end $$;

-- ===== 一度だけ：今日のミッションを「守っていれば達成」にそろえる（2026-10-15 ユーザーが選んだ）=====
-- 受注したときに塔の守護者なら「塔に挑戦する」は達成済みで始まる（§10 の v2cap_daily_roll）。
-- この版を流した日にもう受注していた人は roll を通らない（守っているあいだは挑戦もできない）ので、一度だけ：
-- 今日のぶんを受注済み・まだ受け取っていない・いま守護者の人は、塔の項目を達成済み（1）にする
-- ★印 daily_guard_20261015 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'daily_guard_20261015') then
    update public.v2cap_profiles
       set daily_counts = jsonb_set(coalesce(daily_counts, '{}'::jsonb), '{tower}',
                                    to_jsonb(greatest(1, coalesce((daily_counts ->> 'tower')::int, 0))))
     where tower_guard is not null
       and daily_lv is not null and not daily_claimed
       and daily_day = ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date;
    insert into public.v2cap_migrations (key) values ('daily_guard_20261015');
  end if;
end $$;

-- ===== 一度だけ：能力表で外れた17職を直した（2026-10-16 ユーザー「17の案とりあえず入れてほしい」）=====
-- 職業ごとの倍率をやめて設計の値（×1）に戻し、強さの差は能力（HP・守り・仕組み）で付けた。SQLに関わるのはクラスのステの配分だけ：
--   狂戦士・魔銃士・アークアーチャー・元素使い・ストームランサー・異端審問官・魔法剣士・弓使い・槍使いの配分（jobs.js の JOB_BONUS）が変わった
--   （v2cap_classes.bonus_seq と v2cap_asc_mp は上の種で入れ替わる）。アセンションの盤面は配分から中身を作るので、この9職の盤面の中身が入れ替わる。
-- 今いるキャラは一度だけ（2026-10-14 の初期職・10-15 の盗賊と同じやり方）：
--   ①この9職の盤面を空にする（APは CLASS LV から数え直すので戻る・Goldは取らない）
--   ②編成のある職業ぜんぶ：最大MPが減ったぶん収める（v2cap_fit_set。MPの配分が減った職業・盤面のMPのマスが無くなった職業）
-- ★印 nouryoku17_20261016 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r      record;
  j      record;
  v_asc  jsonb;
  v_sets jsonb;
  v_max  int;
  v_cls  text[] := array['狂戦士', '魔銃士', 'アークアーチャー', '元素使い', 'ストームランサー', '異端審問官', '魔法剣士', '弓使い', '槍使い'];
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'nouryoku17_20261016') then
    for r in select p.id, p.mp, p.jobs, p.learned, p.skill_sets, p.ascension from public.v2cap_profiles p loop
      v_asc := case when jsonb_typeof(r.ascension) = 'object' then r.ascension - v_cls else '{}'::jsonb end;
      v_sets := case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end;
      for j in select e.key as cls, e.value as v from jsonb_each(v_sets) e where jsonb_typeof(e.value) = 'array' loop
        v_max := public.v2cap_max_mp(r.mp, v_asc, j.cls, coalesce((r.jobs -> j.cls ->> 'lv')::int, 1));
        v_sets := jsonb_set(v_sets, array[j.cls], public.v2cap_fit_set(j.v, j.cls, coalesce(r.learned, '[]'::jsonb), v_max));
      end loop;
      update public.v2cap_profiles
         set ascension = v_asc, skill_sets = v_sets, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('nouryoku17_20261016');
  end if;
end $$;

-- ===== 一度だけ：技の名前を変えた（2026-10-18 ユーザーがスキル一覧のシートで「メテオ」→「メテオストライク」）=====
-- 3〜5連撃（毎回ランダム）・1ヒットごとに10%で火傷の技になった（skillsIchiji.js）。技の表（v2cap_skills）は上の種で入れ替わる。
-- 今いるキャラは一度だけ、覚えた技（learned）と全部の職業の編成（skill_sets）で名前を付け替える（10-15 の「間合い取り→嵐の構え」と同じやり方）。
-- 塔の姿（守護者・NPC）の前の名前は JS で読み替える（skills.js の SKILL_RENAMED）
-- ★印 meteor_rename_20261018 を付けるので、2回目以降に全文を流し直しても何もしない
do $$
declare
  r         record;
  j         record;
  v_ren     jsonb := '{"メテオ":"メテオストライク"}'::jsonb;
  v_sets    jsonb;
  v_set     jsonb;
  v_learned jsonb;
begin
  if not exists (select 1 from public.v2cap_migrations where key = 'meteor_rename_20261018') then
    for r in select p.id, p.learned, p.skill_sets from public.v2cap_profiles p
              where p.learned::text like '%"メテオ"%' or p.skill_sets::text like '%"メテオ"%' loop
      -- 覚えた技：名前を付け替える（同じ技が2つにならないように・並びはそのまま）
      select coalesce(jsonb_agg(x.n order by x.i), '[]'::jsonb) into v_learned
        from (select distinct on (coalesce(v_ren ->> t.n, t.n)) coalesce(v_ren ->> t.n, t.n) as n, t.i
                from jsonb_array_elements_text(case when jsonb_typeof(r.learned) = 'array' then r.learned else '[]'::jsonb end) with ordinality as t(n, i)
               order by coalesce(v_ren ->> t.n, t.n), t.i) x;
      -- 編成の名前も付け替える
      v_sets := '{}'::jsonb;
      for j in select e.key, e.value from jsonb_each(case when jsonb_typeof(r.skill_sets) = 'object' then r.skill_sets else '{}'::jsonb end) e loop
        if jsonb_typeof(j.value) = 'array' then
          select coalesce(jsonb_agg(case when v_ren ? (t.e ->> 'name')
                                         then jsonb_set(t.e, '{name}', to_jsonb(v_ren ->> (t.e ->> 'name')))
                                         else t.e end order by t.i), '[]'::jsonb)
            into v_set
            from jsonb_array_elements(j.value) with ordinality as t(e, i);
          v_sets := v_sets || jsonb_build_object(j.key, v_set);
        else
          v_sets := v_sets || jsonb_build_object(j.key, j.value);
        end if;
      end loop;
      update public.v2cap_profiles
         set learned = v_learned, skill_sets = v_sets, updated_at = now()
       where id = r.id;
    end loop;
    insert into public.v2cap_migrations (key) values ('meteor_rename_20261018');
  end if;
end $$;
