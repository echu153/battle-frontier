-- ============================================================
-- バトルフロンティアⅡ（リメイク版）コア
--   v2_profiles テーブル／ステータス成長（あるけみすと方式）／転職
-- ------------------------------------------------------------
-- ★このファイルは v2_ 接頭辞の新規オブジェクトだけを作る。
--   既存テーブル・既存RPC（apply_battle_result / protect_stats 等）には一切触れないので、
--   「supabase_mutant_gold_20260703.sql を常に最後に」の適用順の鉄則には影響しない。
--
-- ★v2のSQLはこの1ファイルにまとめる（分割しない）。全体が冪等なので、
--   仕様を足すたびに「全文を流し直す」運用でよい。何度流しても既存データは消えない。
--
-- 成長方式（src/v2/lib/stats.js と同じ式。片方だけ直すと表示と実値がズレる）：
--   ・LVアップ1回につき5回抽選し、当たったステータスが上がる
--   ・当たりが HP なら +8 / MP なら +3 / それ以外は +1（＝どれも戦闘力換算 +1）
--   ・8種すべて均等 1/8（「手相」は未採用）
--   ・LV上限100。到達したらEXPは入らず、「転職」でLV1に戻って周回する
--   ・必要EXPは 60 スタート、転職10回ごとに +10、100 で打ち止め
--   ・転職するとステータスは初期値に戻り、「転職回数×100」戦闘力分をランダムに配り直す
--     （あるけみすとの転生＝初期ステータスに転生回数×125を振り分ける、に相当）
-- ============================================================

-- ===== 1. テーブル =====
create table if not exists public.v2_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  lv         int  not null default 1,
  exp        int  not null default 0,   -- 現在LV内の累積EXP
  total_exp  bigint not null default 0, -- 通算で得たEXP（統計用）
  -- ステータス8種。並びは src/v2/lib/stats.js の STAT_KEYS と対応
  hp         int not null default 40,
  mp         int not null default 12,
  str        int not null default 5,
  dex        int not null default 5,
  agi        int not null default 5,
  int_stat   int not null default 5,    -- INT。int は型名のため列名は int_stat
  vit        int not null default 5,
  luk        int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 転職回数（あるけみすとの転生回数に相当）
alter table public.v2_profiles add column if not exists job_changes int not null default 0;
-- 職業。開始時はノーブル。job_counts は職業ごとの転職回数 {"戦士":3}
-- proofs は所持している証の個数 {"侍の証":2}。証は転職で1個消費するので個数で持つ
alter table public.v2_profiles add column if not exists class      text  not null default 'ノーブル';
alter table public.v2_profiles add column if not exists job_counts jsonb not null default '{}'::jsonb;
alter table public.v2_profiles add column if not exists proofs     jsonb not null default '{}'::jsonb;
-- proofs を配列（初版の ["侍の証"]）で作っていた場合は個数の形へ移行する
alter table public.v2_profiles alter column proofs set default '{}'::jsonb;
update public.v2_profiles p set proofs = (
  select coalesce(jsonb_object_agg(e.value, 1), '{}'::jsonb) from jsonb_array_elements_text(p.proofs) e
) where jsonb_typeof(p.proofs) = 'array';

-- スキルは2段構え（あるけみすと準拠）
--   skills  = 習得中のスキル名。LVアップで増え、**転職すると失われる**
--   learned = 習得済みのスキル名。転職のとき習得中から1つ選ばれ、以降ずっと残る
--   skill_set = 編成 [{"name":"体当たり","uses":3}]
-- 使えるスキル ＝ skills ∪ learned
alter table public.v2_profiles add column if not exists skills    jsonb not null default '[]'::jsonb;
alter table public.v2_profiles add column if not exists learned   jsonb not null default '[]'::jsonb;
-- 旧名(mastered)で作っていた場合は中身を移して列を落とす
do $mig$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'v2_profiles' and column_name = 'mastered') then
    execute 'update public.v2_profiles set learned = mastered where jsonb_array_length(coalesce(mastered, ''[]''::jsonb)) > 0';
    execute 'alter table public.v2_profiles drop column mastered';
  end if;
end $mig$;
alter table public.v2_profiles add column if not exists skill_set jsonb not null default '[]'::jsonb;
-- favorites = お気に入り登録したスキル名 ["強撃"]（一覧を絞り込むための印）
alter table public.v2_profiles add column if not exists favorites jsonb not null default '[]'::jsonb;

-- 名前は大文字小文字を無視して一意
create unique index if not exists v2_profiles_username_lower_idx
  on public.v2_profiles (lower(username));

-- ※戦闘力（HP/8＋MP/3＋他6ステ）はクライアントの calcPower で算出する。
--   ランキングを作るときに生成列かビューをここへ足す。

-- ===== 1-2. 職業マスタ =====
-- ★職業の正はこの表。クライアントはここを読んで表示するだけ（JS側にマスタを持たない）。
--   req_jobs = 必要な「その初期職での転職回数」 {"戦士":3}
--   req_proof = 必要な証（証の名前は必ず「職業名＋の証」）
create table if not exists public.v2_classes (
  id        text primary key,
  tier      text not null,                          -- start / basic / advanced / hybrid / special
  sort      int  not null default 0,
  req_jobs  jsonb not null default '{}'::jsonb,
  req_proof text
);

alter table public.v2_classes enable row level security;
drop policy if exists v2_classes_select on public.v2_classes;
create policy v2_classes_select on public.v2_classes for select to authenticated using (true);
grant select on table public.v2_classes to authenticated;

insert into public.v2_classes (id, tier, sort, req_jobs, req_proof) values
  ('ノーブル',           'start',     0, '{}', null),
  -- 初期職：条件なし
  ('戦士',               'basic',    10, '{}', null),
  ('弓使い',             'basic',    11, '{}', null),
  ('魔法使い',           'basic',    12, '{}', null),
  ('僧侶',               'basic',    13, '{}', null),
  ('格闘家',             'basic',    14, '{}', null),
  ('サモナー',           'basic',    15, '{}', null),
  -- 上位職：初期職1つで転職3回（★2026-08-15 証は不要になった）
  ('侍',                 'advanced', 20, '{"戦士":3}',       null),
  ('狂戦士',             'advanced', 21, '{"戦士":3}',       null),
  ('狩人',               'advanced', 22, '{"弓使い":3}',     null),
  ('暗殺者',             'advanced', 23, '{"弓使い":3}',     null),
  ('元素使い',           'advanced', 24, '{"魔法使い":3}',   null),
  ('死霊使い',           'advanced', 25, '{"魔法使い":3}',   null),
  ('聖職者',             'advanced', 26, '{"僧侶":3}',       null),
  ('異端審問官',         'advanced', 27, '{"僧侶":3}',       null),
  ('サイキッカー',       'advanced', 28, '{"格闘家":3}',     null),
  ('体術師',             'advanced', 29, '{"格闘家":3}',     null),
  ('精霊召喚士',         'advanced', 30, '{"サモナー":3}',   null),
  ('式神使い',           'advanced', 31, '{"サモナー":3}',   null),
  -- 複合上位職：初期職2つで各転職3回（★2026-08-15 証は不要になった）
  ('魔法剣士',           'hybrid',   40, '{"戦士":3,"魔法使い":3}',     null),
  ('魔銃士',             'hybrid',   41, '{"弓使い":3,"魔法使い":3}',   null),
  ('聖騎士',             'hybrid',   42, '{"僧侶":3,"戦士":3}',         null),
  ('賢者',               'hybrid',   43, '{"魔法使い":3,"僧侶":3}',     null),
  ('武僧',               'hybrid',   44, '{"格闘家":3,"僧侶":3}',       null),
  ('ビーストレンジャー', 'hybrid',   45, '{"サモナー":3,"弓使い":3}',   null),
  -- 特殊職：証のみ（★証が要るのはこの2職だけ）
  ('ギャンブラー',       'special',  50, '{}', 'ギャンブラーの証'),
  ('竜騎士',             'special',  51, '{}', '竜騎士の証')
on conflict (id) do update set
  tier = excluded.tier, sort = excluded.sort,
  req_jobs = excluded.req_jobs, req_proof = excluded.req_proof;

-- ===== 1-3. スキルの名簿 =====
-- ★ここが持つのは「スキル名 → どの職業のものか」と「消費MP」だけ。
--   倍率・発動率などの数値は src/v2/lib/skills.js にある（調整の速さを優先しているため）。
--   サーバーが必要とするのは「転職時にどれを習得させるか」「その編成は使ってよいか
--   （想定利用MPが最大MPを超えないか）」の判定だけなので、これで足りる。
-- ⚠スキルを増やす／職業や消費MPを変えるときは skills.js と この INSERT の両方を直すこと。
create table if not exists public.v2_skills (
  name text primary key,
  cls  text not null references public.v2_classes(id),
  mp   int  not null default 0,
  sort int not null default 0
);
alter table public.v2_skills add column if not exists mp int not null default 0;
-- ★2026-08-19：転職回数が要るスキル（侍の納刀・見切りなど＝転職5回以上）
alter table public.v2_skills add column if not exists req_jobs int not null default 0;
alter table public.v2_skills enable row level security;
drop policy if exists v2_skills_select on public.v2_skills;
create policy v2_skills_select on public.v2_skills for select to authenticated using (true);
grant select on table public.v2_skills to authenticated;

insert into public.v2_skills (name, cls, mp, sort, req_jobs) values
  ('はたく','ノーブル',0,1,0), ('狙い撃ち','ノーブル',7,2,0), ('応急手当','ノーブル',8,3,0), ('身構える','ノーブル',6,4,0), ('気合い','ノーブル',8,5,0),
  ('体当たり','戦士',4,1,0), ('強撃','戦士',11,2,0), ('防御崩し','戦士',8,3,0), ('防御態勢','戦士',8,4,0), ('シールドアタック','戦士',8,5,0),
  ('狙撃','弓使い',8,1,0), ('剛射','弓使い',11,2,0), ('貫通射撃','弓使い',11,3,0), ('疾風矢','弓使い',8,4,0), ('駆け足','弓使い',6,5,0),
  ('マジックアロー','魔法使い',5,1,0), ('ファイア','魔法使い',13,2,0), ('サンダー','魔法使い',13,3,0), ('アイスランス','魔法使い',13,4,0), ('精神統一','魔法使い',8,5,0),
  ('ライト','僧侶',5,1,0), ('ライトニング','僧侶',13,2,0), ('ヒール','僧侶',12,3,0), ('祈祷','僧侶',15,4,0), ('プロテク','僧侶',10,5,0),
  ('打撃','格闘家',4,1,0), ('鉄拳','格闘家',11,2,0), ('連打','格闘家',11,3,0), ('爆裂拳','格闘家',11,4,0), ('残心','格闘家',8,5,0),
  ('オオカミ召喚','サモナー',9,1,0), ('小悪魔召喚','サモナー',13,2,0), ('グリフォン召喚','サモナー',13,3,0), ('群れの号令','サモナー',13,4,0), ('魔力供給','サモナー',0,5,0),
  ('居合斬','侍',12,1,0), ('断空','侍',16,2,0), ('居合の構え','侍',0,3,0), ('明鏡止水','侍',12,4,0), ('月影','侍',22,5,0), ('納刀','侍',6,6,5), ('峰打ち','侍',14,7,5), ('二段斬り','侍',16,8,5), ('桜花一閃','侍',18,9,5), ('見切り','侍',10,10,5),
  ('マッドラッシュ','狂戦士',16,1,0), ('すてみ','狂戦士',22,2,0), ('バーサク','狂戦士',0,3,0), ('ブラッティロア','狂戦士',14,4,0), ('フルブレイカー','狂戦士',16,5,0), ('猛り斬り','狂戦士',12,6,0), ('血の代償','狂戦士',16,7,0), ('裂傷撃','狂戦士',14,8,0), ('狂乱連斬','狂戦士',20,9,0), ('威嚇咆哮','狂戦士',12,10,0),
  ('毒矢','狩人',12,1,0), ('三連射','狩人',16,2,0), ('鷹ノ目','狩人',0,3,0), ('狩猟本能','狩人',14,4,0), ('絶影狙撃','狩人',20,5,0), ('貫き矢','狩人',14,6,0), ('追い討ち','狩人',14,7,0), ('煙玉','狩人',16,8,0), ('鷹爪連射','狩人',20,9,0), ('罠設置','狩人',13,10,0),
  ('瞬歩瞬殺','暗殺者',12,1,0), ('鬼影閃','暗殺者',16,2,0), ('隠身','暗殺者',0,3,0), ('影歩き','暗殺者',12,4,0), ('急所突き','暗殺者',20,5,0), ('背後刺し','暗殺者',14,6,0), ('毒刃','暗殺者',14,7,0), ('足首断ち','暗殺者',18,8,0), ('千刃乱舞','暗殺者',20,9,0), ('影分身','暗殺者',13,10,0),
  ('アクアショット','元素使い',13,1,0), ('アースクエイク','元素使い',17,2,0), ('元素共鳴','元素使い',0,3,0), ('ライトニングボルト','元素使い',17,4,0), ('フレイムバースト','元素使い',21,5,0), ('スパークショット','元素使い',13,6,0), ('アイスプリズン','元素使い',17,7,0), ('マグマフィスト','元素使い',17,8,0), ('エレメンタルレイン','元素使い',23,9,0), ('元素装填','元素使い',14,10,0),
  ('骸骨召喚','死霊使い',13,1,0), ('ソウルドレイン','死霊使い',17,2,0), ('骸の壁','死霊使い',0,3,0), ('腐敗霧','死霊使い',17,4,0), ('幽世ノ門','死霊使い',21,5,0), ('呪詛の手','死霊使い',13,6,0), ('屍毒','死霊使い',17,7,0), ('亡者の呻き','死霊使い',17,8,0), ('冥府の鎖','死霊使い',21,9,0), ('生命転換','死霊使い',16,10,0),
  ('ホーリーライト','聖職者',13,1,0), ('奇跡','聖職者',18,2,0), ('神聖加護','聖職者',0,3,0), ('祈りの結界','聖職者',14,4,0), ('神罰執行','聖職者',21,5,0), ('セイントレイ','聖職者',13,6,0), ('浄化','聖職者',17,7,0), ('断罪の光','聖職者',17,8,0), ('大治癒','聖職者',20,9,0), ('加護の風','聖職者',12,10,0),
  ('粛清','異端審問官',13,1,0), ('狂信','異端審問官',12,2,0), ('執行本能','異端審問官',0,3,0), ('聖なる裁き','異端審問官',17,4,0), ('断罪','異端審問官',21,5,0), ('尋問','異端審問官',13,6,0), ('拷問具','異端審問官',17,7,0), ('異端狩り','異端審問官',17,8,0), ('沈黙の枷','異端審問官',15,9,0), ('火刑','異端審問官',21,10,0),
  ('サンダーストライク','賢者',13,1,0), ('マナボルト','賢者',0,2,0), ('天啓','賢者',0,3,0), ('氷の障壁','賢者',15,4,0), ('メテオストライク','賢者',23,5,0), ('アルカナボルト','賢者',13,6,0), ('ディスペルウェーブ','賢者',17,7,0), ('インフェルノ','賢者',17,8,0), ('アストラルレイ','賢者',23,9,0), ('マナリカバリ','賢者',14,10,0),
  ('ホーリーエッジ','聖騎士',12,1,0), ('ディバインスマイト','聖騎士',16,2,0), ('聖騎士の心得','聖騎士',0,3,0), ('聖域展開','聖騎士',18,4,0), ('神聖覚醒','聖騎士',20,5,0), ('シールドバッシュ','聖騎士',12,6,0), ('ジャッジメントブロウ','聖騎士',16,7,0), ('ラストガード','聖騎士',18,8,0), ('誓いの盾','聖騎士',13,9,0), ('聖光の癒し','聖騎士',16,10,0),
  ('雷光斬','魔法剣士',12,1,0), ('閃光','魔法剣士',12,2,0), ('魔導剣術','魔法剣士',0,3,0), ('魔剣開放','魔法剣士',18,4,0), ('エレメンタルエッジ','魔法剣士',20,5,0), ('魔力刃','魔法剣士',12,6,0), ('氷結斬','魔法剣士',14,7,0), ('マナバースト','魔法剣士',17,8,0), ('天魔閃','魔法剣士',20,9,0), ('剣気開放','魔法剣士',15,10,0),
  ('魔弾','魔銃士',16,1,0), ('連装銃撃','魔銃士',16,2,0), ('精密照準','魔銃士',0,3,0), ('強化装填','魔銃士',16,4,0), ('キャノネスチュームビンド','魔銃士',20,5,0), ('速射弾','魔銃士',11,6,0), ('貫通弾','魔銃士',14,7,0), ('炸裂弾','魔銃士',16,8,0), ('フルバースト','魔銃士',22,9,0), ('曳光装填','魔銃士',14,10,0),
  ('サイコショット','サイキッカー',12,1,0), ('マインドブレイク','サイキッカー',17,2,0), ('第六感','サイキッカー',0,3,0), ('精神集中','サイキッカー',16,4,0), ('サイコブラスト','サイキッカー',20,5,0), ('テレキネシス','サイキッカー',12,6,0), ('サイコノイズ','サイキッカー',15,7,0), ('マインドスパイク','サイキッカー',17,8,0), ('サイキックチェイン','サイキッカー',20,9,0), ('精神加速','サイキッカー',15,10,0),
  ('半月蹴り','体術師',12,1,0), ('五連殺','体術師',20,2,0), ('闘争本能','体術師',0,3,0), ('破衝掌','体術師',16,4,0), ('飛天三角蹴り','体術師',22,5,0), ('旋風脚','体術師',11,6,0), ('当身','体術師',14,7,0), ('疾風連撃','体術師',16,8,0), ('崩落蹴','体術師',18,9,0), ('気孔術','体術師',14,10,0),
  ('ジャグリング','ギャンブラー',16,1,0), ('ラッキーダイス','ギャンブラー',16,2,0), ('ギャンブルボディ','ギャンブラー',0,3,0), ('オールイン','ギャンブラー',18,4,0), ('ジャックポット','ギャンブラー',22,5,0), ('コイントス','ギャンブラー',12,6,0), ('カードスロー','ギャンブラー',16,7,0), ('ラストベット','ギャンブラー',20,8,0), ('イカサマ','ギャンブラー',13,9,0), ('幸運の女神','ギャンブラー',14,10,0),
  ('ドラゴンスラスト','竜騎士',12,1,0), ('ドラゴンファング','竜騎士',16,2,0), ('竜鱗の加護','竜騎士',0,3,0), ('ドラゴンロア','竜騎士',14,4,0), ('天墜竜閃','竜騎士',22,5,0), ('ランスチャージ','竜騎士',12,6,0), ('竜鱗突き','竜騎士',14,7,0), ('空中殺法','竜騎士',18,8,0), ('威圧の咆哮','竜騎士',14,9,0), ('竜血覚醒','竜騎士',15,10,0),
  ('サラマンド','精霊召喚士',13,1,0), ('ウンディーネ','精霊召喚士',16,2,0), ('精霊共鳴','精霊召喚士',0,3,0), ('シルフ','精霊召喚士',13,4,0), ('ノーム','精霊召喚士',21,5,0), ('イフリート','精霊召喚士',15,6,0), ('マーメイド','精霊召喚士',13,7,0), ('精霊解放','精霊召喚士',23,8,0), ('ドリアード','精霊召喚士',16,9,0), ('フェニックス','精霊召喚士',20,10,0),
  ('符術・式打ち','式神使い',13,1,0), ('呪符・魂削り','式神使い',17,2,0), ('式神召喚','式神使い',0,3,0), ('陰陽結界','式神使い',15,4,0), ('禁術・神降ろし','式神使い',23,5,0), ('呪符・鬼火','式神使い',13,6,0), ('式符・鎌鼬','式神使い',17,7,0), ('呪詛返し','式神使い',17,8,0), ('封印符','式神使い',15,9,0), ('大祓','式神使い',16,10,0),
  ('練気掌','武僧',16,1,0), ('活殺自在','武僧',16,2,0), ('心身一如','武僧',0,3,0), ('金剛身','武僧',15,4,0), ('崩拳','武僧',18,5,0), ('気功掌','武僧',12,6,0), ('三連震脚','武僧',16,7,0), ('破戒撃','武僧',16,8,0), ('自癒功','武僧',15,9,0), ('阿吽の呼吸','武僧',15,10,0),
  ('獣呼びの矢','ビーストレンジャー',12,1,0), ('群狼の牙','ビーストレンジャー',17,2,0), ('野性の勘','ビーストレンジャー',0,3,0), ('共鳴の咆哮','ビーストレンジャー',14,4,0), ('貫狼撃','ビーストレンジャー',18,5,0), ('鷹の急襲','ビーストレンジャー',12,6,0), ('熊の一撃','ビーストレンジャー',14,7,0), ('蛇毒の矢','ビーストレンジャー',16,8,0), ('疾風獣走','ビーストレンジャー',20,9,0), ('獣王の号令','ビーストレンジャー',14,10,0)
on conflict (name) do update set cls = excluded.cls, mp = excluded.mp, sort = excluded.sort, req_jobs = excluded.req_jobs;

-- ===== 2. RLS =====
-- 参照は認証済み全員（将来のランキング用）。書き込みポリシーは作らない
-- ＝クライアントからの直接 INSERT/UPDATE/DELETE は不可。更新は下のRPC経由のみ。
alter table public.v2_profiles enable row level security;
drop policy if exists v2_profiles_select on public.v2_profiles;
create policy v2_profiles_select on public.v2_profiles
  for select to authenticated using (true);

revoke all on table public.v2_profiles from anon;
grant select on table public.v2_profiles to authenticated;

-- ===== 2-2. 開発限定ゲート =====
-- ★v2（リメイク版）は開発限定コンテンツ。画面は V2Home.jsx が is_admin を見て弾いているが、
--   RPC は authenticated 全員に grant されているので、**画面を通さず直接呼べば誰でも遊べてしまう**。
--   旧版の arena/pvp と同じ穴なので、v2 の公開RPCは全部この関数を最初に通す。
--   一般公開するときは、この関数の中身を `select true` にすれば一斉に開けられる。
-- ⚠自分の is_admin を読むだけなので REVOKE は不要（他人の情報は返らない）。
create or replace function public.v2_is_dev()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- ===== 3. 内部ヘルパ: EXP付与とLVアップ抽選（サーバー権威） =====
-- ⚠ SECURITY DEFINER の内部ヘルパは既定で PUBLIC 実行可＝任意のEXPを自分に配れる穴になる。
--    必ず下の REVOKE をセットで流すこと（公開RPCからのみ呼ばせる）。
create or replace function public.v2_apply_exp(p_player uuid, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_lv        constant int := 100;
  c_exp_base      constant int := 60;   -- 必要EXPの基準
  c_exp_max       constant int := 100;  -- 必要EXPの打ち止め
  c_exp_step      constant int := 10;   -- 1段階で増える量
  c_exp_step_jobs constant int := 100;  -- 何回の転職ごとに1段階上げるか
  c_rolls         constant int := 5;
  -- LVアップでのスキル習得。基礎確率で抽選しつつ c_learn_by_lv までに必ず全部そろう
  -- （skills.js の LEARN_BY_LV / LEARN_PCT / forcedLearnCount と同じ規則）
  c_learn_by_lv   constant int := 50;
  c_learn_pct     constant int := 15;
  -- 抽選の並び: 1=hp 2=mp 3=str 4=dex 5=agi 6=int_stat 7=vit 8=luk
  -- ★ src/v2/lib/stats.js の STAT_KEYS と同じ順序であること
  c_unit constant int[] := array[8, 3, 1, 1, 1, 1, 1, 1];
  v_row   public.v2_profiles;
  v_lv    int;
  v_exp   int;
  v_need  int;
  v_gain  int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  v_ups   int := 0;
  v_r     int;
  v_k     int;
  v_skills    jsonb;
  v_learned   text[] := '{}';
  v_unlearned int;
  v_must      int;
  v_pick      text;
  v_i         int;
begin
  select * into v_row from public.v2_profiles where id = p_player for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;

  v_lv     := v_row.lv;
  v_exp    := v_row.exp;
  v_skills := coalesce(v_row.skills, '[]'::jsonb);
  -- 必要EXP＝転職回数で段階的に重くなる（stats.js の expPerLv と同じ式）
  v_need := least(c_exp_max, c_exp_base + (greatest(v_row.job_changes, 0) / c_exp_step_jobs) * c_exp_step);

  if coalesce(p_amount, 0) > 0 and v_lv < c_max_lv then
    v_exp := v_exp + p_amount;
    while v_lv < c_max_lv and v_exp >= v_need loop
      v_exp := v_exp - v_need;
      v_lv  := v_lv + 1;
      v_ups := v_ups + 1;
      for v_r in 1..c_rolls loop
        v_k := 1 + floor(random() * array_length(c_unit, 1))::int;
        v_gain[v_k] := v_gain[v_k] + c_unit[v_k];
      end loop;

      -- スキル習得：いまの職業の未習得スキルを確率で覚える。
      -- 残りLV数が足りなくなったぶんは確定で覚えるので、c_learn_by_lv までに必ず全部そろう
      select count(*) into v_unlearned
      from public.v2_skills s
      where s.cls = v_row.class and not (v_skills ? s.name)
        and s.req_jobs <= coalesce(v_row.job_changes, 0);   -- ★転職回数が足りない技は覚えられない
      if v_unlearned > 0 then
        v_must := greatest(0, v_unlearned - greatest(0, c_learn_by_lv - v_lv));
        if v_unlearned - v_must > 0 and random() * 100 < c_learn_pct then
          v_must := v_must + 1;
        end if;
        for v_i in 1..v_must loop
          select s.name into v_pick
          from public.v2_skills s
          where s.cls = v_row.class and not (v_skills ? s.name)
            and s.req_jobs <= coalesce(v_row.job_changes, 0)
          order by random() limit 1;
          exit when v_pick is null;
          v_skills  := v_skills || to_jsonb(v_pick);
          v_learned := array_append(v_learned, v_pick);
        end loop;
      end if;
    end loop;
    -- 上限到達＝あふれたEXPは捨てる（転職待ち）
    if v_lv >= c_max_lv then v_exp := 0; end if;
  end if;

  update public.v2_profiles set
    lv        = v_lv,
    exp       = v_exp,
    total_exp = total_exp + greatest(coalesce(p_amount, 0), 0),
    hp = hp + v_gain[1], mp = mp + v_gain[2], str = str + v_gain[3], dex = dex + v_gain[4],
    agi = agi + v_gain[5], int_stat = int_stat + v_gain[6], vit = vit + v_gain[7], luk = luk + v_gain[8],
    skills = v_skills,
    updated_at = now()
  where id = p_player
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'level_ups', v_ups,
    'exp_need', v_need,
    'learned', to_jsonb(v_learned),
    'gains', jsonb_build_object(
      'hp', v_gain[1], 'mp', v_gain[2], 'str', v_gain[3], 'dex', v_gain[4],
      'agi', v_gain[5], 'int_stat', v_gain[6], 'vit', v_gain[7], 'luk', v_gain[8]),
    'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_apply_exp(uuid, int) from public;
revoke all on function public.v2_apply_exp(uuid, int) from anon;
revoke all on function public.v2_apply_exp(uuid, int) from authenticated;

-- ===== 4. キャラクター作成 =====
create or replace function public.v2_create_character(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_username, ''));
  v_row  public.v2_profiles;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 16 then
    return jsonb_build_object('ok', false, 'error', '名前は1〜16文字で入力してください');
  end if;

  select * into v_row from public.v2_profiles where id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'profile', to_jsonb(v_row));
  end if;
  if exists (select 1 from public.v2_profiles where lower(username) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'その名前はすでに使われています');
  end if;

  insert into public.v2_profiles (id, username) values (v_uid, v_name) returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'その名前はすでに使われています');
end;
$$;

revoke all on function public.v2_create_character(text) from public;
revoke all on function public.v2_create_character(text) from anon;
grant execute on function public.v2_create_character(text) to authenticated;

-- ===== 5. 転職（あるけみすとの転生に相当） =====
-- LV上限でのみ実行できる。転職先の職業を選び、LV1・初期ステータスへ戻したうえで
-- 「転職回数×100」戦闘力分を8種へランダムに配り直す（前回の配分は引き継がず毎回引き直し）。
-- 転職条件（その初期職での転職回数・証）の判定はここで行う＝クライアントを信用しない。
drop function if exists public.v2_change_job();  -- 引数なしの旧版を破棄（職業選択の追加で署名が変わった）
create or replace function public.v2_change_job(p_class text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_lv    constant int := 100;
  c_power_per constant int := 100;  -- 転職1回あたりに配る戦闘力（＝20LV分）
  -- 並びは 1=hp 2=mp 3=str 4=dex 5=agi 6=int_stat 7=vit 8=luk
  c_unit constant int[] := array[8, 3, 1, 1, 1, 1, 1, 1];
  c_init constant int[] := array[40, 12, 5, 5, 5, 5, 5, 5];  -- stats.js の INITIAL_STATS と一致させる
  v_uid     uuid := auth.uid();
  v_row     public.v2_profiles;
  v_cls     public.v2_classes;
  v_jobs    int;
  v_counts  jsonb;
  v_proofs  jsonb;
  v_learned  text;
  v_skills   jsonb;
  v_kept     jsonb;
  v_set      jsonb;
  v_stat    int[] := c_init;
  v_alloc   int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  v_points  int;
  v_missing int;
  v_i       int;
  v_k       int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;
  if v_row.lv < c_max_lv then
    return jsonb_build_object('ok', false, 'error', format('LV%sで転職できます', c_max_lv));
  end if;

  select * into v_cls from public.v2_classes where id = btrim(coalesce(p_class, ''));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'その職業はありません');
  end if;
  if v_cls.tier = 'start' then
    return jsonb_build_object('ok', false, 'error', 'その職業には転職できません');
  end if;

  -- 条件①：初期職ごとの転職回数
  select count(*) into v_missing
  from jsonb_each_text(v_cls.req_jobs) as r(k, v)
  where coalesce((v_row.job_counts ->> r.k)::int, 0) < r.v::int;
  if v_missing > 0 then
    return jsonb_build_object('ok', false, 'error', '転職回数が足りません');
  end if;
  -- 条件②：証（転職で1個消費する）
  if v_cls.req_proof is not null and coalesce((v_row.proofs ->> v_cls.req_proof)::int, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', format('%sがありません', v_cls.req_proof));
  end if;

  v_jobs   := v_row.job_changes + 1;
  v_points := v_jobs * c_power_per;
  for v_i in 1..v_points loop
    v_k := 1 + floor(random() * array_length(c_unit, 1))::int;
    v_alloc[v_k] := v_alloc[v_k] + c_unit[v_k];
    v_stat[v_k]  := v_stat[v_k]  + c_unit[v_k];
  end loop;

  -- 職業ごとの転職回数を1つ増やす（上位職の条件はこれを見る）
  v_counts := coalesce(v_row.job_counts, '{}'::jsonb);
  v_counts := jsonb_set(v_counts, array[v_cls.id],
                        to_jsonb(coalesce((v_counts ->> v_cls.id)::int, 0) + 1), true);

  -- 証を1個消費する（0になったキーは残さない）
  v_proofs := coalesce(v_row.proofs, '{}'::jsonb);
  if v_cls.req_proof is not null then
    if coalesce((v_proofs ->> v_cls.req_proof)::int, 0) <= 1 then
      v_proofs := v_proofs - v_cls.req_proof;
    else
      v_proofs := jsonb_set(v_proofs, array[v_cls.req_proof],
                            to_jsonb((v_proofs ->> v_cls.req_proof)::int - 1), true);
    end if;
  end if;

  -- スキルを「習得済み」にする：
  --   いまの職業のスキルのうち「習得中だがまだ習得済みでない」ものから1つを永久に残す。
  --   全部習得済み／そもそも習得中が無い場合は何も残らない。
  --   習得済みにならなかったスキルは転職で失われる。
  v_kept := coalesce(v_row.learned, '[]'::jsonb);
  select s.name into v_learned
  from public.v2_skills s
  where s.cls = v_row.class
    and (coalesce(v_row.skills, '[]'::jsonb) ? s.name)
    and not (v_kept ? s.name)
  order by random()
  limit 1;
  if v_learned is not null then
    v_kept := v_kept || to_jsonb(v_learned);
  end if;
  v_skills := '[]'::jsonb;   -- 習得中はここで失われる（習得済みだけ残る）

  -- 編成から、使えなくなったスキル（習得済みでないもの）を外す
  v_set := (
    select coalesce(jsonb_agg(e), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_row.skill_set, '[]'::jsonb)) e
    where v_kept ? (e ->> 'name')
  );

  update public.v2_profiles set
    lv = 1, exp = 0, job_changes = v_jobs, class = v_cls.id, job_counts = v_counts, proofs = v_proofs,
    skills = v_skills, learned = v_kept, skill_set = v_set,
    hp = v_stat[1], mp = v_stat[2], str = v_stat[3], dex = v_stat[4],
    agi = v_stat[5], int_stat = v_stat[6], vit = v_stat[7], luk = v_stat[8],
    updated_at = now()
  where id = v_uid
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'job_changes', v_jobs,
    'class', v_cls.id,
    'points', v_points,
    'used_proof', v_cls.req_proof,
    'kept', v_learned,
    'alloc', jsonb_build_object(
      'hp', v_alloc[1], 'mp', v_alloc[2], 'str', v_alloc[3], 'dex', v_alloc[4],
      'agi', v_alloc[5], 'int_stat', v_alloc[6], 'vit', v_alloc[7], 'luk', v_alloc[8]),
    'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_change_job(text) from public;
revoke all on function public.v2_change_job(text) from anon;
grant execute on function public.v2_change_job(text) to authenticated;

-- ===== 5-2. スキル編成 =====
-- 5枠に「並び順と使用回数」を設定する。並び順＝発動順（ABCDE→ABCDE…）。
-- 使えるのは「習得中 ∪ 習得済み」のスキルだけ。
-- ★使用回数の上限は「想定利用MP（Σ 消費MP×回数）が最大MPを超えないこと」で決まる
--   （あるけみすとの「あなたの最大MPは◯MPです／想定利用MPは◯MPです」と同じ考え方）。
--   MPを伸ばすほど強い技を多く積める＝MPがステータスとして効く。
-- ★規則は src/v2/lib/skills.js の validateSkillSet と同じ。片方だけ直さないこと。
create or replace function public.v2_set_skills(p_set jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_slots   constant int := 5;   -- SKILL_SET_SLOTS
  c_use_max constant int := 99;  -- SKILL_USE_MAX（実際の上限は下の想定利用MPで決まる）
  -- ★いまの職業以外のスキルは消費MPが2倍（skills.js の OFF_CLASS_MP_MULT と同じ値）。
  --   画面の想定利用MP（setMpCost）とここがズレると「画面では保存できるのに弾かれる」になる。
  --   ⚠片方だけ直さないこと。v2sql.test.js が突き合わせている
  c_off_mp  constant int := 2;
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_set   jsonb := coalesce(p_set, '[]'::jsonb);
  v_cost  int := 0;
  v_names text[] := '{}';
  e       jsonb;
  v_name  text;
  v_uses  int;
  v_mp    int;
  v_scls  text;            -- そのスキルの職業（他職なら消費MPが c_off_mp 倍）
  v_mp_pct numeric := 0;   -- 装着中の武器に刺さったルーンのMP+%の合計
  v_max_mp int;            -- ルーンぶんを乗せた最大MP（＝想定利用MPの上限）
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;
  if jsonb_typeof(v_set) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '編成の形式が不正です');
  end if;
  if jsonb_array_length(v_set) > c_slots then
    return jsonb_build_object('ok', false, 'error', format('枠は%s個までです', c_slots));
  end if;

  for e in select value from jsonb_array_elements(v_set) loop
    v_name := e ->> 'name';
    if v_name is null then
      return jsonb_build_object('ok', false, 'error', '枠にスキルが入っていません');
    end if;
    -- 使えるスキルか（いまの職業のスキル ∪ 習得済み）。ついでに消費MPと職業を取る
    select s.mp, s.cls into v_mp, v_scls from public.v2_skills s where s.name = v_name;
    if v_mp is null then
      return jsonb_build_object('ok', false, 'error', format('%sというスキルはありません', v_name));
    end if;
    -- 使えるスキル ＝ 習得中 ∪ 習得済み
    if not (coalesce(v_row.skills, '[]'::jsonb) ? v_name)
       and not (coalesce(v_row.learned, '[]'::jsonb) ? v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sはまだ使えません', v_name));
    end if;
    -- ★2026-08-19：同じスキルを複数の枠に置けるようにした
    --   （納刀→居合斬→納刀→月影 のように「構えて斬る」を並べられる）
    v_names := array_append(v_names, v_name);
    if jsonb_typeof(e -> 'uses') <> 'number' then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数が不正です', v_name));
    end if;
    v_uses := (e ->> 'uses')::int;
    if v_uses < 1 or v_uses > c_use_max then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, c_use_max));
    end if;
    -- 他職のスキルは消費MPが c_off_mp 倍で数えられる＝そのぶん使用回数を積めない
    v_cost := v_cost + (case when v_scls = v_row.class then v_mp else v_mp * c_off_mp end) * v_uses;
  end loop;

  -- ★ルーン（エッセンス）のMP+%を最大MPへ乗せる。
  --   ここを素の v2_profiles.mp のままにすると、蒼ルーンのMPが**どこにも効かない**
  --   （戦闘はHP/MP満タン開始で5〜13ターン＝MPが枯れないため）。
  --   装備そのものは HP/MP/LUK を持たない（equipment.js）ので、素のMPに%を掛けるだけで
  --   画面の totalStats(profile, inventory, runes).mp と同じ値になる。
  select coalesce(sum((e.stats ->> 'mp')::numeric), 0) into v_mp_pct
    from public.v2_essences e
   where e.player_id = v_uid
     and e.inv_id is not null
     and e.stats ? 'mp'
     and exists (
       select 1 from jsonb_each_text(coalesce(v_row.equipped, '{}'::jsonb)) q
        where q.value ~ '^[0-9]+$' and q.value::bigint = e.inv_id);
  v_max_mp := round(v_row.mp * (1 + v_mp_pct / 100));

  -- 想定利用MPが最大MPを超える編成は保存させない（これが使用回数の実質的な上限）
  if v_cost > v_max_mp then
    return jsonb_build_object('ok', false, 'error',
      format('想定利用MPが最大MPを超えています（%s / %s）', v_cost, v_max_mp));
  end if;

  update public.v2_profiles set skill_set = v_set, updated_at = now()
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_set_skills(jsonb) from public;
revoke all on function public.v2_set_skills(jsonb) from anon;
grant execute on function public.v2_set_skills(jsonb) to authenticated;

-- お気に入り（スキル一覧を絞り込むための印。存在するスキル名だけ受け付ける）
create or replace function public.v2_set_favorites(p_names jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2_profiles;
  v_new jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if jsonb_typeof(coalesce(p_names, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '形式が不正です');
  end if;
  select coalesce(jsonb_agg(distinct e.value), '[]'::jsonb) into v_new
  from jsonb_array_elements_text(coalesce(p_names, '[]'::jsonb)) e(value)
  where exists (select 1 from public.v2_skills s where s.name = e.value);

  update public.v2_profiles set favorites = v_new, updated_at = now()
  where id = v_uid
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_set_favorites(jsonb) from public;
revoke all on function public.v2_set_favorites(jsonb) from anon;
grant execute on function public.v2_set_favorites(jsonb) to authenticated;

-- ===== 6. 動作確認用のEXP付与（開発限定） =====
-- まだ戦闘コンテンツが無いため、成長の確認用に is_admin だけEXPを自分に入れられる。
-- 本番のEXP源を作るときは、そのRPCの中から v2_apply_exp を呼ぶ（このRPCは残さない/公開しない）。
create or replace function public.v2_debug_gain_exp(p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = v_uid;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('ok', false, 'error', '開発限定の機能です');
  end if;
  return public.v2_apply_exp(v_uid, least(greatest(coalesce(p_amount, 0), 0), 100000));
end;
$$;

revoke all on function public.v2_debug_gain_exp(int) from public;
revoke all on function public.v2_debug_gain_exp(int) from anon;
grant execute on function public.v2_debug_gain_exp(int) to authenticated;

-- 証の入手手段（ドロップ等）はまだ無いので、確認用に is_admin だけ全種類を1個ずつ足せる。
-- 証は転職で1個消費するため、押すたびに在庫が増える。
-- 入手コンテンツを作ったら、そちらから proofs に足す（このRPCは残さない/公開しない）。
create or replace function public.v2_debug_grant_proofs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_row   public.v2_profiles;
  v_new   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = v_uid;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('ok', false, 'error', '開発限定の機能です');
  end if;
  select * into v_row from public.v2_profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;
  select coalesce(jsonb_object_agg(c.req_proof,
                  coalesce((v_row.proofs ->> c.req_proof)::int, 0) + 1), '{}'::jsonb)
    into v_new
  from (select distinct req_proof from public.v2_classes where req_proof is not null) c;

  update public.v2_profiles set proofs = coalesce(v_row.proofs, '{}'::jsonb) || v_new, updated_at = now()
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_debug_grant_proofs() from public;
revoke all on function public.v2_debug_grant_proofs() from anon;
grant execute on function public.v2_debug_grant_proofs() to authenticated;

-- ===== 7. 適用後の確認（任意・1文ずつ実行）=====
-- select column_name, data_type from information_schema.columns where table_name = 'v2_profiles' order by ordinal_position;
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like 'v2\_%';
-- ===== 7. 出撃・装備 =====
-- 2026-08-15 追加。出撃（エリア①〜⑧）と装備の所持・装着・合成。
-- 設計は docs/v2-sortie-design.md / docs/v2-equipment-design.md。
--   ・装備マスタ v2_equipment は src/v2/lib/equipment.js から生成した同じ内容
--     （v2_skills と同じ方針＝サーバー側の検証に要るのでDBにも持つ）
--   ・⚠ 装備を増やすときは equipment.js と このシードの両方を直すこと

-- ---- 列の追加 ----
alter table public.v2_profiles add column if not exists gold           bigint      not null default 0;
alter table public.v2_profiles add column if not exists unlocked_areas int[]       not null default array[1];
alter table public.v2_profiles add column if not exists cleared_areas  int[]       not null default '{}'; -- エリアボスを倒したエリア（⑧は次が無いので unlocked では分からない）
alter table public.v2_profiles add column if not exists boss_rate      numeric     not null default 0;   -- ボス遭遇率(%)。戦うたび+0.3、当たると0へ
-- ★出撃のクールタイムは**10秒固定**になった（2026-08-22 ユーザー決定）ので sortie_cd は廃止。
--   10／20を選ぶ仕組みごと消した（src/v2/lib/sortie.js の SORTIE_CD が正）
alter table public.v2_profiles drop column if exists sortie_cd;
-- スタミナ（オート出撃の燃料）。src/v2/lib/stamina.js と同じ計算にすること
--   ・stamina    … いま持っているぶん。オート出撃1回につき1減る（手動は減らない）
--   ・stamina_at … 最後に数え直した時刻。ここからの経過時間で5分に1ずつ戻す
--   ・上限は v2_stamina_max(job_changes)。★増え方はマスク（画面に出さない）
alter table public.v2_profiles add column if not exists stamina        int         not null default 10;
alter table public.v2_profiles add column if not exists stamina_at     timestamptz not null default now();
alter table public.v2_profiles add column if not exists equipped       jsonb       not null default '{}'::jsonb; -- {"right": 12, ...} v2_inventory.id
alter table public.v2_profiles add column if not exists last_sortie_at timestamptz;

-- ---- 踏破済みの埋め戻し（列を足した直後の1回だけ効く） ----
-- 「エリアNが解放されている＝エリアN-1のボスを倒した」で過去ぶんを復元する。
-- ⑧の踏破だけは記録が残っていないので復元できない（次に⑧のボスを倒したときに付く）
update public.v2_profiles p
   set cleared_areas = sub.arr
  from (
    select pr.id,
           coalesce(array_agg(distinct a - 1) filter (where a > 1), '{}') as arr
      from public.v2_profiles pr, unnest(pr.unlocked_areas) as a
     group by pr.id
  ) sub
 where p.id = sub.id and coalesce(array_length(p.cleared_areas, 1), 0) = 0;

-- ---- 装備マスタ ----
create table if not exists public.v2_equipment (
  id         text primary key,     -- 'w:剣:A' / 'a:重装:鎧:A' / 'c:リング:A'
  name       text not null,
  part       text not null,        -- 武器 / 頭 / 鎧 / 腕 / 足 / アクセ
  type       text not null,        -- 剣・短剣… / 重装・軽装・魔装 / イヤリング…
  rank       text not null,        -- F E D C B A S
  hands      text not null,        -- '1'=片手 '2'=両手 'L'=左手専用
  base_power int  not null
);
alter table public.v2_equipment enable row level security;
drop policy if exists "v2_equipment_read" on public.v2_equipment;
create policy "v2_equipment_read" on public.v2_equipment for select to authenticated using (true);
revoke all on table public.v2_equipment from anon;
grant select on table public.v2_equipment to authenticated;

insert into public.v2_equipment (id, name, part, type, rank, hands, base_power) values
  ('w:剣:F', 'ソード', '武器', '剣', 'F', '1', 10),
  ('w:剣:E', 'ショートソード', '武器', '剣', 'E', '1', 20),
  ('w:剣:D', '鉄剣', '武器', '剣', 'D', '1', 30),
  ('w:剣:C', 'ロングソード', '武器', '剣', 'C', '1', 40),
  ('w:剣:B', 'セイバー', '武器', '剣', 'B', '1', 50),
  ('w:剣:A', 'ミスリルソード', '武器', '剣', 'A', '1', 60),
  ('w:剣:S', '蒼氷剣', '武器', '剣', 'S', '1', 70),
  ('w:短剣:F', 'ナイフ', '武器', '短剣', 'F', '1', 10),
  ('w:短剣:E', 'ダガー', '武器', '短剣', 'E', '1', 20),
  ('w:短剣:D', 'スティレット', '武器', '短剣', 'D', '1', 30),
  ('w:短剣:C', '三日月のダガー', '武器', '短剣', 'C', '1', 40),
  ('w:短剣:B', '月影の短剣', '武器', '短剣', 'B', '1', 50),
  ('w:短剣:A', '霧隠れのダガー', '武器', '短剣', 'A', '1', 60),
  ('w:短剣:S', '宵闇の短剣', '武器', '短剣', 'S', '1', 70),
  ('w:槍:F', '竹槍', '武器', '槍', 'F', '1', 10),
  ('w:槍:E', 'ロングスピア', '武器', '槍', 'E', '1', 20),
  ('w:槍:D', 'パルチザン', '武器', '槍', 'D', '1', 30),
  ('w:槍:C', 'ランス', '武器', '槍', 'C', '1', 40),
  ('w:槍:B', '翡翠のランス', '武器', '槍', 'B', '1', 50),
  ('w:槍:A', '穿光のランス', '武器', '槍', 'A', '1', 60),
  ('w:槍:S', '烈風槍', '武器', '槍', 'S', '1', 70),
  ('w:斧:F', '石斧', '武器', '斧', 'F', '1', 10),
  ('w:斧:E', 'ウォーアクス', '武器', '斧', 'E', '1', 20),
  ('w:斧:D', 'バトルアックス', '武器', '斧', 'D', '1', 30),
  ('w:斧:C', 'バルディッシュ', '武器', '斧', 'C', '1', 40),
  ('w:斧:B', 'グレートアックス', '武器', '斧', 'B', '1', 50),
  ('w:斧:A', '業火の戦斧', '武器', '斧', 'A', '1', 60),
  ('w:斧:S', '処刑斧ギロチナ', '武器', '斧', 'S', '1', 70),
  ('w:籠手:F', 'グローブ', '武器', '籠手', 'F', '1', 10),
  ('w:籠手:E', 'レザーガントレット', '武器', '籠手', 'E', '1', 20),
  ('w:籠手:D', 'アイアンナックル', '武器', '籠手', 'D', '1', 30),
  ('w:籠手:C', 'スチールクロー', '武器', '籠手', 'C', '1', 40),
  ('w:籠手:B', 'ウォーガントレット', '武器', '籠手', 'B', '1', 50),
  ('w:籠手:A', 'ミスリルガントレット', '武器', '籠手', 'A', '1', 60),
  ('w:籠手:S', '金剛籠手', '武器', '籠手', 'S', '1', 70),
  ('w:魔道書:F', '手記', '武器', '魔道書', 'F', '1', 10),
  ('w:魔道書:E', '初歩の魔道書', '武器', '魔道書', 'E', '1', 20),
  ('w:魔道書:D', '鉄綴じの魔道書', '武器', '魔道書', 'D', '1', 30),
  ('w:魔道書:C', 'コーデックス', '武器', '魔道書', 'C', '1', 40),
  ('w:魔道書:B', 'トーム', '武器', '魔道書', 'B', '1', 50),
  ('w:魔道書:A', '星辰書', '武器', '魔道書', 'A', '1', 60),
  ('w:魔道書:S', '禁書「灰の頁」', '武器', '魔道書', 'S', '1', 70),
  ('w:大剣:F', 'グレートソード', '武器', '大剣', 'F', '2', 22),
  ('w:大剣:E', 'バスタードソード', '武器', '大剣', 'E', '2', 44),
  ('w:大剣:D', 'クレイモア', '武器', '大剣', 'D', '2', 66),
  ('w:大剣:C', 'ツヴァイハンダー', '武器', '大剣', 'C', '2', 88),
  ('w:大剣:B', 'フランベルジュ', '武器', '大剣', 'B', '2', 110),
  ('w:大剣:A', 'ハイランダー', '武器', '大剣', 'A', '2', 132),
  ('w:大剣:S', '王家の大剣', '武器', '大剣', 'S', '2', 154),
  ('w:弓:F', 'ショートボウ', '武器', '弓', 'F', '2', 22),
  ('w:弓:E', 'ロングボウ', '武器', '弓', 'E', '2', 44),
  ('w:弓:D', '猟弓', '武器', '弓', 'D', '2', 66),
  ('w:弓:C', 'アルバレスト', '武器', '弓', 'C', '2', 88),
  ('w:弓:B', '精霊樹の弓', '武器', '弓', 'B', '2', 110),
  ('w:弓:A', 'エルフボウ', '武器', '弓', 'A', '2', 132),
  ('w:弓:S', '天翔弓', '武器', '弓', 'S', '2', 154),
  ('w:杖:F', 'ワンド', '武器', '杖', 'F', '2', 22),
  ('w:杖:E', '樫のロッド', '武器', '杖', 'E', '2', 44),
  ('w:杖:D', '節くれのスタッフ', '武器', '杖', 'D', '2', 66),
  ('w:杖:C', 'オーク材のスタッフ', '武器', '杖', 'C', '2', 88),
  ('w:杖:B', 'セプター', '武器', '杖', 'B', '2', 110),
  ('w:杖:A', '星詠みの宝杖', '武器', '杖', 'A', '2', 132),
  ('w:杖:S', '叡智錫杖', '武器', '杖', 'S', '2', 154),
  ('w:盾:F', 'バックラー', '武器', '盾', 'F', 'L', 10),
  ('w:盾:E', 'ラウンドシールド', '武器', '盾', 'E', 'L', 20),
  ('w:盾:D', 'カイトシールド', '武器', '盾', 'D', 'L', 30),
  ('w:盾:C', 'ヒーターシールド', '武器', '盾', 'C', 'L', 40),
  ('w:盾:B', 'タワーシールド', '武器', '盾', 'B', 'L', 50),
  ('w:盾:A', 'ミスリルシールド', '武器', '盾', 'A', 'L', 60),
  ('w:盾:S', '城塞盾', '武器', '盾', 'S', 'L', 70),
  ('a:重装:頭:F', 'ヘッドギア', '頭', '重装', 'F', '1', 10),
  ('a:重装:頭:E', 'アイアンヘルム', '頭', '重装', 'E', '1', 20),
  ('a:重装:頭:D', 'スチールヘルム', '頭', '重装', 'D', '1', 30),
  ('a:重装:頭:C', 'グレートヘルム', '頭', '重装', 'C', '1', 40),
  ('a:重装:頭:B', '鉄面の兜', '頭', '重装', 'B', '1', 50),
  ('a:重装:頭:A', 'ミスリルヘルム', '頭', '重装', 'A', '1', 60),
  ('a:重装:頭:S', '金剛兜', '頭', '重装', 'S', '1', 70),
  ('a:重装:鎧:F', 'チェインメイル', '鎧', '重装', 'F', '1', 13),
  ('a:重装:鎧:E', 'スケイルメイル', '鎧', '重装', 'E', '1', 26),
  ('a:重装:鎧:D', 'プレートメイル', '鎧', '重装', 'D', '1', 39),
  ('a:重装:鎧:C', 'フルプレート', '鎧', '重装', 'C', '1', 52),
  ('a:重装:鎧:B', '銀装の鎧', '鎧', '重装', 'B', '1', 65),
  ('a:重装:鎧:A', 'ミスリルアーマー', '鎧', '重装', 'A', '1', 78),
  ('a:重装:鎧:S', '城塞鎧', '鎧', '重装', 'S', '1', 91),
  ('a:重装:腕:F', 'アームガード', '腕', '重装', 'F', '1', 10),
  ('a:重装:腕:E', 'アイアンブレーサー', '腕', '重装', 'E', '1', 20),
  ('a:重装:腕:D', 'スチールブレーサー', '腕', '重装', 'D', '1', 30),
  ('a:重装:腕:C', 'ヘヴィブレーサー', '腕', '重装', 'C', '1', 40),
  ('a:重装:腕:B', '鋼板のブレーサー', '腕', '重装', 'B', '1', 50),
  ('a:重装:腕:A', '白銀の腕甲', '腕', '重装', 'A', '1', 60),
  ('a:重装:腕:S', '鉄壁腕甲', '腕', '重装', 'S', '1', 70),
  ('a:重装:足:F', 'アイアンシューズ', '足', '重装', 'F', '1', 10),
  ('a:重装:足:E', 'アイアングリーヴ', '足', '重装', 'E', '1', 20),
  ('a:重装:足:D', 'スチールグリーヴ', '足', '重装', 'D', '1', 30),
  ('a:重装:足:C', 'ヘヴィグリーヴ', '足', '重装', 'C', '1', 40),
  ('a:重装:足:B', '鋼鉄のグリーヴ', '足', '重装', 'B', '1', 50),
  ('a:重装:足:A', '星鉄のグリーヴ', '足', '重装', 'A', '1', 60),
  ('a:重装:足:S', '不動具足', '足', '重装', 'S', '1', 70),
  ('a:軽装:頭:F', 'バンダナ', '頭', '軽装', 'F', '1', 10),
  ('a:軽装:頭:E', 'レザーキャップ', '頭', '軽装', 'E', '1', 20),
  ('a:軽装:頭:D', 'フード', '頭', '軽装', 'D', '1', 30),
  ('a:軽装:頭:C', 'シャドウフード', '頭', '軽装', 'C', '1', 40),
  ('a:軽装:頭:B', '忍びのフード', '頭', '軽装', 'B', '1', 50),
  ('a:軽装:頭:A', '隠者のフード', '頭', '軽装', 'A', '1', 60),
  ('a:軽装:頭:S', '幻影頭巾', '頭', '軽装', 'S', '1', 70),
  ('a:軽装:鎧:F', 'クロースベスト', '鎧', '軽装', 'F', '1', 13),
  ('a:軽装:鎧:E', 'レザーアーマー', '鎧', '軽装', 'E', '1', 26),
  ('a:軽装:鎧:D', 'スタッデドレザー', '鎧', '軽装', 'D', '1', 39),
  ('a:軽装:鎧:C', 'チェインベスト', '鎧', '軽装', 'C', '1', 52),
  ('a:軽装:鎧:B', '影織の胴衣', '鎧', '軽装', 'B', '1', 65),
  ('a:軽装:鎧:A', '霧纏いの胴衣', '鎧', '軽装', 'A', '1', 78),
  ('a:軽装:鎧:S', '影纏衣', '鎧', '軽装', 'S', '1', 91),
  ('a:軽装:腕:F', 'リストバンド', '腕', '軽装', 'F', '1', 10),
  ('a:軽装:腕:E', 'レザーブレーサー', '腕', '軽装', 'E', '1', 20),
  ('a:軽装:腕:D', 'スタッデドガード', '腕', '軽装', 'D', '1', 30),
  ('a:軽装:腕:C', 'ライトブレーサー', '腕', '軽装', 'C', '1', 40),
  ('a:軽装:腕:B', '疾風の腕輪', '腕', '軽装', 'B', '1', 50),
  ('a:軽装:腕:A', 'ミスリルバングル', '腕', '軽装', 'A', '1', 60),
  ('a:軽装:腕:S', '迅雷腕輪', '腕', '軽装', 'S', '1', 70),
  ('a:軽装:足:F', 'サンダル', '足', '軽装', 'F', '1', 10),
  ('a:軽装:足:E', 'レザーブーツ', '足', '軽装', 'E', '1', 20),
  ('a:軽装:足:D', 'トラベルブーツ', '足', '軽装', 'D', '1', 30),
  ('a:軽装:足:C', 'ハイブーツ', '足', '軽装', 'C', '1', 40),
  ('a:軽装:足:B', '月影のブーツ', '足', '軽装', 'B', '1', 50),
  ('a:軽装:足:A', '韋駄天のブーツ', '足', '軽装', 'A', '1', 60),
  ('a:軽装:足:S', '縮地靴', '足', '軽装', 'S', '1', 70),
  ('a:魔装:頭:F', 'サークレット', '頭', '魔装', 'F', '1', 10),
  ('a:魔装:頭:E', '見習いのサークレット', '頭', '魔装', 'E', '1', 20),
  ('a:魔装:頭:D', 'マジックハット', '頭', '魔装', 'D', '1', 30),
  ('a:魔装:頭:C', 'ポインテッドハット', '頭', '魔装', 'C', '1', 40),
  ('a:魔装:頭:B', '星読みの帽子', '頭', '魔装', 'B', '1', 50),
  ('a:魔装:頭:A', '賢者のハット', '頭', '魔装', 'A', '1', 60),
  ('a:魔装:頭:S', '叡智の冠', '頭', '魔装', 'S', '1', 70),
  ('a:魔装:鎧:F', 'ローブ', '鎧', '魔装', 'F', '1', 13),
  ('a:魔装:鎧:E', 'ウィザードローブ', '鎧', '魔装', 'E', '1', 26),
  ('a:魔装:鎧:D', 'メイジローブ', '鎧', '魔装', 'D', '1', 39),
  ('a:魔装:鎧:C', 'セージローブ', '鎧', '魔装', 'C', '1', 52),
  ('a:魔装:鎧:B', '銀糸のローブ', '鎧', '魔装', 'B', '1', 65),
  ('a:魔装:鎧:A', 'ミスリルローブ', '鎧', '魔装', 'A', '1', 78),
  ('a:魔装:鎧:S', '秘奥の法衣', '鎧', '魔装', 'S', '1', 91),
  ('a:魔装:腕:F', 'クロースバンド', '腕', '魔装', 'F', '1', 10),
  ('a:魔装:腕:E', '銅の腕輪', '腕', '魔装', 'E', '1', 20),
  ('a:魔装:腕:D', '銀の腕輪', '腕', '魔装', 'D', '1', 30),
  ('a:魔装:腕:C', 'ルーンバングル', '腕', '魔装', 'C', '1', 40),
  ('a:魔装:腕:B', '翡翠のバングル', '腕', '魔装', 'B', '1', 50),
  ('a:魔装:腕:A', '星辰のバングル', '腕', '魔装', 'A', '1', 60),
  ('a:魔装:腕:S', '魔導腕輪', '腕', '魔装', 'S', '1', 70),
  ('a:魔装:足:F', 'クロースシューズ', '足', '魔装', 'F', '1', 10),
  ('a:魔装:足:E', 'ソフトシューズ', '足', '魔装', 'E', '1', 20),
  ('a:魔装:足:D', 'メイジシューズ', '足', '魔装', 'D', '1', 30),
  ('a:魔装:足:C', 'ルーンシューズ', '足', '魔装', 'C', '1', 40),
  ('a:魔装:足:B', '精霊靴', '足', '魔装', 'B', '1', 50),
  ('a:魔装:足:A', '妖精靴', '足', '魔装', 'A', '1', 60),
  ('a:魔装:足:S', '浮遊靴', '足', '魔装', 'S', '1', 70),
  ('c:イヤリング:F', '石のピアス', 'アクセ', 'イヤリング', 'F', '1', 8),
  ('c:イヤリング:E', '銅のピアス', 'アクセ', 'イヤリング', 'E', '1', 16),
  ('c:イヤリング:D', '獣牙のイヤリング', 'アクセ', 'イヤリング', 'D', '1', 24),
  ('c:イヤリング:C', 'ガーネットピアス', 'アクセ', 'イヤリング', 'C', '1', 32),
  ('c:イヤリング:B', '闘気のイヤリング', 'アクセ', 'イヤリング', 'B', '1', 40),
  ('c:イヤリング:A', '猛虎のピアス', 'アクセ', 'イヤリング', 'A', '1', 48),
  ('c:イヤリング:S', '覇気の耳飾り', 'アクセ', 'イヤリング', 'S', '1', 56),
  ('c:ネックレス:F', '麻紐の首飾り', 'アクセ', 'ネックレス', 'F', '1', 8),
  ('c:ネックレス:E', '貝殻のネックレス', 'アクセ', 'ネックレス', 'E', '1', 16),
  ('c:ネックレス:D', '銀のネックレス', 'アクセ', 'ネックレス', 'D', '1', 24),
  ('c:ネックレス:C', 'アメジストの首飾り', 'アクセ', 'ネックレス', 'C', '1', 32),
  ('c:ネックレス:B', '五色の首飾り', 'アクセ', 'ネックレス', 'B', '1', 40),
  ('c:ネックレス:A', '賢者のネックレス', 'アクセ', 'ネックレス', 'A', '1', 48),
  ('c:ネックレス:S', '調和の首飾り', 'アクセ', 'ネックレス', 'S', '1', 56),
  ('c:リング:F', '木の指輪', 'アクセ', 'リング', 'F', '1', 8),
  ('c:リング:E', '銅の指輪', 'アクセ', 'リング', 'E', '1', 16),
  ('c:リング:D', 'ルーンリング', 'アクセ', 'リング', 'D', '1', 24),
  ('c:リング:C', 'サファイアリング', 'アクセ', 'リング', 'C', '1', 32),
  ('c:リング:B', '魔導の指輪', 'アクセ', 'リング', 'B', '1', 40),
  ('c:リング:A', '大賢者の指輪', 'アクセ', 'リング', 'A', '1', 48),
  ('c:リング:S', '秘奥の指輪', 'アクセ', 'リング', 'S', '1', 56),
  ('c:ベルト:F', '粗革のベルト', 'アクセ', 'ベルト', 'F', '1', 8),
  ('c:ベルト:E', 'レザーベルト', 'アクセ', 'ベルト', 'E', '1', 16),
  ('c:ベルト:D', '鋼のベルト', 'アクセ', 'ベルト', 'D', '1', 24),
  ('c:ベルト:C', 'ヘヴィベルト', 'アクセ', 'ベルト', 'C', '1', 32),
  ('c:ベルト:B', '巨人のベルト', 'アクセ', 'ベルト', 'B', '1', 40),
  ('c:ベルト:A', 'ミスリルベルト', 'アクセ', 'ベルト', 'A', '1', 48),
  ('c:ベルト:S', '不動の帯', 'アクセ', 'ベルト', 'S', '1', 56)
on conflict (id) do update set
  name = excluded.name, part = excluded.part, type = excluded.type,
  rank = excluded.rank, hands = excluded.hands, base_power = excluded.base_power;

-- ---- 難易度帯（tier）----
-- ★2026-08-22 ユーザー決定：エリアは「帯」に属し、**その帯を全部踏破すると次の帯が開く**。
--   ①②③は1エリアずつ／④⑤⑥は2エリア／⑦⑧は3エリア。
--   req＝その帯をいくつ踏破したら次が開くか（＝用意してあるエリア数）。
--   ⚠ src/v2/lib/sortie.js の TIER_REQ と同じ表。**片方だけ直すと v2sql.test.js が落ちる**
create table if not exists public.v2_tiers (
  tier int primary key,
  req  int not null
);
alter table public.v2_tiers enable row level security;
drop policy if exists "v2_tiers_read" on public.v2_tiers;
create policy "v2_tiers_read" on public.v2_tiers for select to authenticated using (true);
revoke all on table public.v2_tiers from anon;
grant select on table public.v2_tiers to authenticated;
insert into public.v2_tiers (tier, req) values
  (1,1), (2,1), (3,1), (4,2), (5,2), (6,2), (7,3), (8,3)
on conflict (tier) do update set req = excluded.req;

-- ---- エリアのマスタ（ドロップ範囲とGoldの上限＝サーバー側の検証に使う）----
-- ⚠ boss_gold / max_zako_gold は**敵がGoldを落としていた頃の名残**（今はどちらも使っていない）
create table if not exists public.v2_areas (
  id            int primary key,
  name          text not null,
  drop_ranks    jsonb not null,
  boss_gold     int not null,
  max_zako_gold int not null
);
-- ★エリアは難易度帯に属する（同じ帯のエリアは同格）。id は続き番号で難易度順ではない
alter table public.v2_areas add column if not exists tier int not null default 1;
alter table public.v2_areas enable row level security;
drop policy if exists "v2_areas_read" on public.v2_areas;
create policy "v2_areas_read" on public.v2_areas for select to authenticated using (true);
revoke all on table public.v2_areas from anon;
grant select on table public.v2_areas to authenticated;

insert into public.v2_areas (id, tier, name, drop_ranks, boss_gold, max_zako_gold) values
  (1, 1, '始まりの森', '{"F":40,"E":40,"D":20}'::jsonb, 100, 60),
  (2, 2, '荒廃した草原', '{"F":35,"E":30,"D":22,"C":13}'::jsonb, 500, 120),
  (3, 3, '古代の洞窟', '{"F":30,"E":28,"D":24,"C":13,"B":5}'::jsonb, 2000, 240),
  (4, 4, '蒼海の入り江', '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb, 5000, 400),
  (9, 4, '灼砂の遺丘', '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb, 5000, 400),
  (5, 5, '巨峰山脈', '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb, 9000, 600),
  (10, 5, '常闇の樹海', '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb, 9000, 600),
  (6, 6, '白銀の霊峰', '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb, 18750, 900),
  (11, 6, '雷鳴の断崖', '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb, 18750, 900),
  (7, 7, '煉獄火山', '{"D":40,"C":30,"B":20,"A":10}'::jsonb, 37500, 1200),
  (12, 7, '腐海の沼獄', '{"D":40,"C":30,"B":20,"A":10}'::jsonb, 37500, 1200),
  (13, 7, '奈落の坑道', '{"D":40,"C":30,"B":20,"A":10}'::jsonb, 37500, 1200),
  (8, 8, '蒼天の浮遊城', '{"D":35,"C":29,"B":22,"A":14}'::jsonb, 60000, 1600),
  (14, 8, '星霜の遺跡', '{"D":35,"C":29,"B":22,"A":14}'::jsonb, 60000, 1600),
  (15, 8, '深淵の海溝', '{"D":35,"C":29,"B":22,"A":14}'::jsonb, 60000, 1600)
on conflict (id) do update set
  tier = excluded.tier, name = excluded.name, drop_ranks = excluded.drop_ranks,
  boss_gold = excluded.boss_gold, max_zako_gold = excluded.max_zako_gold;

-- ---- 所持している装備 ----
-- 強化値は個体ごとなのでここに持つ（同じ装備でも+0と+3が別物になる）
create table if not exists public.v2_inventory (
  id         bigserial primary key,
  player_id  uuid not null references auth.users(id) on delete cascade,
  equip_id   text not null references public.v2_equipment(id),
  plus       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists v2_inventory_player_idx on public.v2_inventory(player_id);
alter table public.v2_inventory enable row level security;
drop policy if exists "v2_inventory_own" on public.v2_inventory;
create policy "v2_inventory_own" on public.v2_inventory for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2_inventory from anon;
grant select on table public.v2_inventory to authenticated;

-- ============================================================
-- ===== 7-2. エンチャント（素材 → 抽出 → エッセンス → ソケット） =====
-- 設計は docs/v2-enchant-design.md。
--   素材は**敵ごと固有で168種**（56体 × 通常/レア/激レア）。
--   ★**値もステータスの型も「抽出するとき」に抽選する**ので、素材はスタックで持てる。
--   ★**抽選の権威はこちら（サーバー）**。src/v2/lib/material.js は画面とテスト用の写し。
--     **数式を変えるときは必ず両方を直すこと**（片方だけだと表示と実値がズレる）。
-- ============================================================

-- ---- 素材マスタ（315種）----
-- ★このINSERTは src/v2/lib/material.js の MATERIALS から生成している。
--   素材を足す・名前を変えるときは向こうを直してから生成し直すこと。
create table if not exists public.v2_materials (
  id       text primary key,      -- 'm:<エリア>:<敵の並び>:<n|r|u>'
  name     text    not null,
  enemy    text    not null,      -- 特殊能力のキーでもある（src/v2/lib/enchant.js）
  area     int     not null,
  tier     int     not null default 1,  -- そのエリアの難易度帯。**レンジも売値もこちらで決まる**
  rarity   text    not null,      -- normal / rare / ultra
  is_boss  boolean not null,
  stats    text[]  not null,      -- 割り当てステータス（ボスは2つ）
  lo       numeric not null,      -- 値のレンジ(%)。刻みは0.1
  hi       numeric not null
);
alter table public.v2_materials add column if not exists tier int not null default 1;
alter table public.v2_materials enable row level security;
drop policy if exists "v2_materials_read" on public.v2_materials;
create policy "v2_materials_read" on public.v2_materials for select to authenticated using (true);
revoke all on table public.v2_materials from anon;
grant select on table public.v2_materials to authenticated;

insert into public.v2_materials (id, name, enemy, area, tier, rarity, is_boss, stats, lo, hi) values
  ('m:1:0:n', 'スライムのゼリー', 'スライム', 1, 1, 'normal', false, array['vit'], 0.1, 1.0),
  ('m:1:0:r', '透きとおったゼリー', 'スライム', 1, 1, 'rare', false, array['vit'], 0.3, 1.0),
  ('m:1:0:u', '粘性の芯核', 'スライム', 1, 1, 'ultra', false, array['vit'], 0.5, 1.0),
  ('m:1:1:n', 'コウモリの翼膜', 'コウモリ', 1, 1, 'normal', false, array['agi'], 0.1, 1.0),
  ('m:1:1:r', '鋭い犬歯', 'コウモリ', 1, 1, 'rare', false, array['agi'], 0.3, 1.0),
  ('m:1:1:u', '音無しの耳', 'コウモリ', 1, 1, 'ultra', false, array['agi'], 0.5, 1.0),
  ('m:1:2:n', '毒キノコの傘', '毒キノコ', 1, 1, 'normal', false, array['int_stat'], 0.1, 1.0),
  ('m:1:2:r', '痺れ胞子', '毒キノコ', 1, 1, 'rare', false, array['int_stat'], 0.3, 1.0),
  ('m:1:2:u', '猛毒の菌糸', '毒キノコ', 1, 1, 'ultra', false, array['int_stat'], 0.5, 1.0),
  ('m:1:3:n', '朝露のしずく', '朝露のフェアリー', 1, 1, 'normal', false, array['mp'], 0.1, 1.0),
  ('m:1:3:r', '妖精の鱗粉', '朝露のフェアリー', 1, 1, 'rare', false, array['mp'], 0.3, 1.0),
  ('m:1:3:u', 'フェアリーの羽根', '朝露のフェアリー', 1, 1, 'ultra', false, array['mp'], 0.5, 1.0),
  ('m:1:4:n', 'トカゲの尻尾', 'ひなたトカゲ', 1, 1, 'normal', false, array['str'], 0.1, 1.0),
  ('m:1:4:r', '陽だまりの鱗', 'ひなたトカゲ', 1, 1, 'rare', false, array['str'], 0.3, 1.0),
  ('m:1:4:u', '日輪の心鱗', 'ひなたトカゲ', 1, 1, 'ultra', false, array['str'], 0.5, 1.0),
  ('m:1:5:n', 'フクロウの羽根', '月夜のフクロウ', 1, 1, 'normal', false, array['dex'], 0.1, 1.0),
  ('m:1:5:r', '静寂の風切羽', '月夜のフクロウ', 1, 1, 'rare', false, array['dex'], 0.3, 1.0),
  ('m:1:5:u', '月光の瞳', '月夜のフクロウ', 1, 1, 'ultra', false, array['dex'], 0.5, 1.0),
  ('m:1:6:n', '大粘塊のゼリー', 'ビッグスライム', 1, 1, 'normal', true, array['hp','vit'], 0.1, 1.0),
  ('m:1:6:r', '王核の粘膜', 'ビッグスライム', 1, 1, 'rare', true, array['hp','vit'], 0.3, 1.0),
  ('m:1:6:u', 'ビッグスライムの芯核', 'ビッグスライム', 1, 1, 'ultra', true, array['hp','vit'], 0.5, 1.0),
  ('m:2:0:n', 'ゴブリンの牙', 'ゴブリン', 2, 2, 'normal', false, array['str'], 0.1, 1.0),
  ('m:2:0:r', 'ゴブリンの棍棒片', 'ゴブリン', 2, 2, 'rare', false, array['str'], 0.3, 1.0),
  ('m:2:0:u', '族長の証', 'ゴブリン', 2, 2, 'ultra', false, array['str'], 0.5, 1.0),
  ('m:2:1:n', '野良犬の毛皮', '野良犬', 2, 2, 'normal', false, array['agi'], 0.1, 1.0),
  ('m:2:1:r', '研ぎ澄まされた爪', '野良犬', 2, 2, 'rare', false, array['agi'], 0.3, 1.0),
  ('m:2:1:u', '野犬の心臓', '野良犬', 2, 2, 'ultra', false, array['agi'], 0.5, 1.0),
  ('m:2:2:n', '盗賊の革帯', '盗賊', 2, 2, 'normal', false, array['luk'], 0.1, 1.0),
  ('m:2:2:r', '隠しナイフ', '盗賊', 2, 2, 'rare', false, array['luk'], 0.3, 1.0),
  ('m:2:2:u', '盗賊の秘符', '盗賊', 2, 2, 'ultra', false, array['luk'], 0.5, 1.0),
  ('m:2:3:n', 'ワームの粘液', '朝霧のワーム', 2, 2, 'normal', false, array['hp'], 0.1, 1.0),
  ('m:2:3:r', '朝霧の環節', '朝霧のワーム', 2, 2, 'rare', false, array['hp'], 0.3, 1.0),
  ('m:2:3:u', '大地喰らいの顎', '朝霧のワーム', 2, 2, 'ultra', false, array['hp'], 0.5, 1.0),
  ('m:2:4:n', 'リザードの鱗', '陽炎リザード', 2, 2, 'normal', false, array['str'], 0.1, 1.0),
  ('m:2:4:r', '陽炎の鱗', '陽炎リザード', 2, 2, 'rare', false, array['str'], 0.3, 1.0),
  ('m:2:4:u', '灼熱の尾芯', '陽炎リザード', 2, 2, 'ultra', false, array['str'], 0.5, 1.0),
  ('m:2:5:n', '斥候の外套片', '夜盗の斥候', 2, 2, 'normal', false, array['dex'], 0.1, 1.0),
  ('m:2:5:r', '暗視の眼帯', '夜盗の斥候', 2, 2, 'rare', false, array['dex'], 0.3, 1.0),
  ('m:2:5:u', '影渡りの短刀', '夜盗の斥候', 2, 2, 'ultra', false, array['dex'], 0.5, 1.0),
  ('m:2:6:n', '奪われた小袋', '盗賊団のリーダー', 2, 2, 'normal', true, array['str','luk'], 0.1, 1.0),
  ('m:2:6:r', 'リーダーの手甲', '盗賊団のリーダー', 2, 2, 'rare', true, array['str','luk'], 0.3, 1.0),
  ('m:2:6:u', '略奪王の徽章', '盗賊団のリーダー', 2, 2, 'ultra', true, array['str','luk'], 0.5, 1.0),
  ('m:3:0:n', 'コボルトの毛皮', 'コボルト', 3, 3, 'normal', false, array['str'], 0.1, 1.3),
  ('m:3:0:r', 'コボルトの牙', 'コボルト', 3, 3, 'rare', false, array['str'], 0.4, 1.3),
  ('m:3:0:u', '洞窟王の角', 'コボルト', 3, 3, 'ultra', false, array['str'], 0.7, 1.3),
  ('m:3:1:n', 'もろい骨片', 'スケルトン', 3, 3, 'normal', false, array['hp'], 0.1, 1.3),
  ('m:3:1:r', '硬化した肋骨', 'スケルトン', 3, 3, 'rare', false, array['hp'], 0.4, 1.3),
  ('m:3:1:u', '不朽の頭蓋', 'スケルトン', 3, 3, 'ultra', false, array['hp'], 0.7, 1.3),
  ('m:3:2:n', 'ゴーレムの土塊', 'ゴーレム', 3, 3, 'normal', false, array['vit'], 0.1, 1.3),
  ('m:3:2:r', '魔力を帯びた岩片', 'ゴーレム', 3, 3, 'rare', false, array['vit'], 0.4, 1.3),
  ('m:3:2:u', 'ゴーレムの動力核', 'ゴーレム', 3, 3, 'ultra', false, array['vit'], 0.7, 1.3),
  ('m:3:3:n', 'ガーゴイルの石片', '曙のガーゴイル', 3, 3, 'normal', false, array['vit'], 0.1, 1.3),
  ('m:3:3:r', '曙光の翼石', '曙のガーゴイル', 3, 3, 'rare', false, array['vit'], 0.4, 1.3),
  ('m:3:3:u', '石像の魔眼', '曙のガーゴイル', 3, 3, 'ultra', false, array['vit'], 0.7, 1.3),
  ('m:3:4:n', '石化した鱗', '石化トカゲ', 3, 3, 'normal', false, array['vit'], 0.1, 1.3),
  ('m:3:4:r', '岩肌の甲殻', '石化トカゲ', 3, 3, 'rare', false, array['vit'], 0.4, 1.3),
  ('m:3:4:u', '不動の石心', '石化トカゲ', 3, 3, 'ultra', false, array['vit'], 0.7, 1.3),
  ('m:3:5:n', '霊気の残滓', '夜這うレイス', 3, 3, 'normal', false, array['int_stat'], 0.1, 1.3),
  ('m:3:5:r', '怨嗟の衣片', '夜這うレイス', 3, 3, 'rare', false, array['int_stat'], 0.4, 1.3),
  ('m:3:5:u', 'レイスの魂核', '夜這うレイス', 3, 3, 'ultra', false, array['int_stat'], 0.7, 1.3),
  ('m:3:6:n', '古代の石片', '古代の番人', 3, 3, 'normal', true, array['int_stat','mp'], 0.1, 1.3),
  ('m:3:6:r', '番人の魔導回路', '古代の番人', 3, 3, 'rare', true, array['int_stat','mp'], 0.4, 1.3),
  ('m:3:6:u', '古代文明の心臓', '古代の番人', 3, 3, 'ultra', true, array['int_stat','mp'], 0.7, 1.3),
  ('m:4:0:n', '魚人の鱗', '深海魚人', 4, 4, 'normal', false, array['dex'], 0.1, 1.3),
  ('m:4:0:r', '深海の鰭', '深海魚人', 4, 4, 'rare', false, array['dex'], 0.4, 1.3),
  ('m:4:0:u', '深海の心鱗', '深海魚人', 4, 4, 'ultra', false, array['dex'], 0.7, 1.3),
  ('m:4:1:n', '海賊の頭巾', '海賊', 4, 4, 'normal', false, array['luk'], 0.1, 1.3),
  ('m:4:1:r', '錆びた鉤爪', '海賊', 4, 4, 'rare', false, array['luk'], 0.4, 1.3),
  ('m:4:1:u', '海賊旗の切れ端', '海賊', 4, 4, 'ultra', false, array['luk'], 0.7, 1.3),
  ('m:4:2:n', 'クラゲの触手', '毒クラゲ', 4, 4, 'normal', false, array['int_stat'], 0.1, 1.3),
  ('m:4:2:r', '痺れ毒袋', '毒クラゲ', 4, 4, 'rare', false, array['int_stat'], 0.4, 1.3),
  ('m:4:2:u', '深海毒の結晶', '毒クラゲ', 4, 4, 'ultra', false, array['int_stat'], 0.7, 1.3),
  ('m:4:3:n', 'セイレーンの鱗', '朝凪のセイレーン', 4, 4, 'normal', false, array['mp'], 0.1, 1.3),
  ('m:4:3:r', '歌声の貝殻', '朝凪のセイレーン', 4, 4, 'rare', false, array['mp'], 0.4, 1.3),
  ('m:4:3:u', '魅了の喉笛', '朝凪のセイレーン', 4, 4, 'ultra', false, array['mp'], 0.7, 1.3),
  ('m:4:4:n', 'カニの殻片', '潮騒のカニ', 4, 4, 'normal', false, array['vit'], 0.1, 1.3),
  ('m:4:4:r', '頑丈な鋏', '潮騒のカニ', 4, 4, 'rare', false, array['vit'], 0.4, 1.3),
  ('m:4:4:u', '潮騒の甲核', '潮騒のカニ', 4, 4, 'ultra', false, array['vit'], 0.7, 1.3),
  ('m:4:5:n', 'アンコウの提灯', '夜光アンコウ', 4, 4, 'normal', false, array['agi'], 0.1, 1.3),
  ('m:4:5:r', '夜光の粘液', '夜光アンコウ', 4, 4, 'rare', false, array['agi'], 0.4, 1.3),
  ('m:4:5:u', '深淵の発光器', '夜光アンコウ', 4, 4, 'ultra', false, array['agi'], 0.7, 1.3),
  ('m:4:6:n', '海竜の鱗', 'シーサーペント', 4, 4, 'normal', true, array['hp','str'], 0.1, 1.3),
  ('m:4:6:r', '海竜の逆鱗', 'シーサーペント', 4, 4, 'rare', true, array['hp','str'], 0.4, 1.3),
  ('m:4:6:u', 'シーサーペントの海心', 'シーサーペント', 4, 4, 'ultra', true, array['hp','str'], 0.7, 1.3),
  ('m:5:0:n', '山ゴブリンの毛皮', '山岳ゴブリン', 5, 5, 'normal', false, array['str'], 0.1, 1.6),
  ('m:5:0:r', '岩砕きの棍棒片', '山岳ゴブリン', 5, 5, 'rare', false, array['str'], 0.5, 1.6),
  ('m:5:0:u', '山賊頭の兜', '山岳ゴブリン', 5, 5, 'ultra', false, array['str'], 0.8, 1.6),
  ('m:5:1:n', '巨岩の破片', '岩石ゴーレム', 5, 5, 'normal', false, array['vit'], 0.1, 1.6),
  ('m:5:1:r', '鉱脈の結晶', '岩石ゴーレム', 5, 5, 'rare', false, array['vit'], 0.5, 1.6),
  ('m:5:1:u', '岩石ゴーレムの心核', '岩石ゴーレム', 5, 5, 'ultra', false, array['vit'], 0.8, 1.6),
  ('m:5:2:n', 'グリフォンの羽根', 'グリフォン', 5, 5, 'normal', false, array['agi'], 0.1, 1.6),
  ('m:5:2:r', '猛禽の鉤爪', 'グリフォン', 5, 5, 'rare', false, array['agi'], 0.5, 1.6),
  ('m:5:2:u', 'グリフォンの風心', 'グリフォン', 5, 5, 'ultra', false, array['agi'], 0.8, 1.6),
  ('m:5:3:n', 'ワイバーンの鱗', '払暁のワイバーン', 5, 5, 'normal', false, array['dex'], 0.1, 1.6),
  ('m:5:3:r', '飛膜の切れ端', '払暁のワイバーン', 5, 5, 'rare', false, array['dex'], 0.5, 1.6),
  ('m:5:3:u', '払暁の翼骨', '払暁のワイバーン', 5, 5, 'ultra', false, array['dex'], 0.8, 1.6),
  ('m:5:4:n', '大猿の毛皮', '陽射しの大猿', 5, 5, 'normal', false, array['hp'], 0.1, 1.6),
  ('m:5:4:r', '岩砕きの拳骨', '陽射しの大猿', 5, 5, 'rare', false, array['hp'], 0.5, 1.6),
  ('m:5:4:u', '猛猿の闘魂', '陽射しの大猿', 5, 5, 'ultra', false, array['hp'], 0.8, 1.6),
  ('m:5:5:n', '山猫の毛皮', '宵闇の山猫', 5, 5, 'normal', false, array['luk'], 0.1, 1.6),
  ('m:5:5:r', '宵闇の爪', '宵闇の山猫', 5, 5, 'rare', false, array['luk'], 0.5, 1.6),
  ('m:5:5:u', '疾影の後肢', '宵闇の山猫', 5, 5, 'ultra', false, array['luk'], 0.8, 1.6),
  ('m:5:6:n', '帯電した羽根', '雷鷲サンダーロック', 5, 5, 'normal', true, array['agi','str'], 0.1, 1.6),
  ('m:5:6:r', '雷鷲の風切羽', '雷鷲サンダーロック', 5, 5, 'rare', true, array['agi','str'], 0.5, 1.6),
  ('m:5:6:u', '雷鷲の雷嚢', '雷鷲サンダーロック', 5, 5, 'ultra', true, array['agi','str'], 0.8, 1.6),
  ('m:6:0:n', '雪男の白毛', '雪男', 6, 6, 'normal', false, array['hp'], 0.1, 1.6),
  ('m:6:0:r', '凍てつく拳', '雪男', 6, 6, 'rare', false, array['hp'], 0.5, 1.6),
  ('m:6:0:u', '雪山王の心臓', '雪男', 6, 6, 'ultra', false, array['hp'], 0.8, 1.6),
  ('m:6:1:n', '氷結の鱗', '氷河ドラゴン', 6, 6, 'normal', false, array['str'], 0.1, 1.6),
  ('m:6:1:r', '氷河竜の牙', '氷河ドラゴン', 6, 6, 'rare', false, array['str'], 0.5, 1.6),
  ('m:6:1:u', '氷河竜の逆鱗', '氷河ドラゴン', 6, 6, 'ultra', false, array['str'], 0.8, 1.6),
  ('m:6:2:n', '霜のかけら', '霜の精霊', 6, 6, 'normal', false, array['int_stat'], 0.1, 1.6),
  ('m:6:2:r', '凍気の結晶', '霜の精霊', 6, 6, 'rare', false, array['int_stat'], 0.5, 1.6),
  ('m:6:2:u', '霜精の魔核', '霜の精霊', 6, 6, 'ultra', false, array['int_stat'], 0.8, 1.6),
  ('m:6:3:n', '氷狼の毛皮', '朝焼けの氷狼', 6, 6, 'normal', false, array['agi'], 0.1, 1.6),
  ('m:6:3:r', '凍牙', '朝焼けの氷狼', 6, 6, 'rare', false, array['agi'], 0.5, 1.6),
  ('m:6:3:u', '朝焼けの氷心', '朝焼けの氷狼', 6, 6, 'ultra', false, array['agi'], 0.8, 1.6),
  ('m:6:4:n', '樹氷の枝', '白光の樹氷精', 6, 6, 'normal', false, array['mp'], 0.1, 1.6),
  ('m:6:4:r', '白光の氷片', '白光の樹氷精', 6, 6, 'rare', false, array['mp'], 0.5, 1.6),
  ('m:6:4:u', '樹氷の魔晶', '白光の樹氷精', 6, 6, 'ultra', false, array['mp'], 0.8, 1.6),
  ('m:6:5:n', '凍りついた骨', '極夜のワイト', 6, 6, 'normal', false, array['vit'], 0.1, 1.6),
  ('m:6:5:r', '極夜の屍衣', '極夜のワイト', 6, 6, 'rare', false, array['vit'], 0.5, 1.6),
  ('m:6:5:u', 'ワイトの呪核', '極夜のワイト', 6, 6, 'ultra', false, array['vit'], 0.8, 1.6),
  ('m:6:6:n', '凍える霊気', '氷霊フロストバーン', 6, 6, 'normal', true, array['int_stat','mp'], 0.1, 1.6),
  ('m:6:6:r', 'フロストバーンの氷刃', '氷霊フロストバーン', 6, 6, 'rare', true, array['int_stat','mp'], 0.5, 1.6),
  ('m:6:6:u', '永久凍土の氷芯', '氷霊フロストバーン', 6, 6, 'ultra', true, array['int_stat','mp'], 0.8, 1.6),
  ('m:7:0:n', 'くすぶる残り火', '炎の精霊', 7, 7, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:7:0:r', '揺らめく炎心', '炎の精霊', 7, 7, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:7:0:u', '炎精の魔核', '炎の精霊', 7, 7, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:7:1:n', '冷えた溶岩塊', '溶岩ゴーレム', 7, 7, 'normal', false, array['vit'], 0.1, 2.0),
  ('m:7:1:r', '灼熱の鉱石', '溶岩ゴーレム', 7, 7, 'rare', false, array['vit'], 0.6, 2.0),
  ('m:7:1:u', '溶岩ゴーレムの熔核', '溶岩ゴーレム', 7, 7, 'ultra', false, array['vit'], 1.0, 2.0),
  ('m:7:2:n', 'ドレイクの鱗', 'ファイアドレイク', 7, 7, 'normal', false, array['agi'], 0.1, 2.0),
  ('m:7:2:r', '燃える飛膜', 'ファイアドレイク', 7, 7, 'rare', false, array['agi'], 0.6, 2.0),
  ('m:7:2:u', '火竜の焔袋', 'ファイアドレイク', 7, 7, 'ultra', false, array['agi'], 1.0, 2.0),
  ('m:7:3:n', '焦げた翼膜', '暁のフレイムバット', 7, 7, 'normal', false, array['dex'], 0.1, 2.0),
  ('m:7:3:r', '暁の火翼', '暁のフレイムバット', 7, 7, 'rare', false, array['dex'], 0.6, 2.0),
  ('m:7:3:u', '業火の牙', '暁のフレイムバット', 7, 7, 'ultra', false, array['dex'], 1.0, 2.0),
  ('m:7:4:n', '陽炎の残滓', '陽炎のイフリート', 7, 7, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:7:4:r', 'イフリートの炎環', '陽炎のイフリート', 7, 7, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:7:4:u', '魔炎の心核', '陽炎のイフリート', 7, 7, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:7:5:n', 'デーモンの角', '熾火のデーモン', 7, 7, 'normal', false, array['str'], 0.1, 2.0),
  ('m:7:5:r', '熾火の皮膜', '熾火のデーモン', 7, 7, 'rare', false, array['str'], 0.6, 2.0),
  ('m:7:5:u', '悪魔の焔心', '熾火のデーモン', 7, 7, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:7:6:n', '深紅の鱗', '深紅のサラマンダー', 7, 7, 'normal', true, array['str','hp'], 0.1, 2.0),
  ('m:7:6:r', 'サラマンダーの焔牙', '深紅のサラマンダー', 7, 7, 'rare', true, array['str','hp'], 0.6, 2.0),
  ('m:7:6:u', '焔龍の心臓', '深紅のサラマンダー', 7, 7, 'ultra', true, array['str','hp'], 1.0, 2.0),
  ('m:8:0:n', 'ハーピーの羽根', '天翼のハーピー', 8, 8, 'normal', false, array['agi'], 0.1, 2.0),
  ('m:8:0:r', '天翼の風切羽', '天翼のハーピー', 8, 8, 'rare', false, array['agi'], 0.6, 2.0),
  ('m:8:0:u', '蒼天の羽衣', '天翼のハーピー', 8, 8, 'ultra', false, array['agi'], 1.0, 2.0),
  ('m:8:1:n', '帯電した霧片', '雷雲の精霊', 8, 8, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:8:1:r', '雷雲の結晶', '雷雲の精霊', 8, 8, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:8:1:u', '雷精の魔核', '雷雲の精霊', 8, 8, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:8:2:n', '騎士の甲片', '天空騎士グリフィオン', 8, 8, 'normal', false, array['str'], 0.1, 2.0),
  ('m:8:2:r', '蒼天の紋章盾', '天空騎士グリフィオン', 8, 8, 'rare', false, array['str'], 0.6, 2.0),
  ('m:8:2:u', '天空騎士の魂鎧', '天空騎士グリフィオン', 8, 8, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:8:3:n', '聖なる羽根', '曙光のセラフ', 8, 8, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:8:3:r', '曙光の光輪', '曙光のセラフ', 8, 8, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:8:3:u', 'セラフの神核', '曙光のセラフ', 8, 8, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:8:4:n', 'ペガサスのたてがみ', '白昼のペガサス', 8, 8, 'normal', false, array['hp'], 0.1, 2.0),
  ('m:8:4:r', '白昼の蹄鉄', '白昼のペガサス', 8, 8, 'rare', false, array['hp'], 0.6, 2.0),
  ('m:8:4:u', '天馬の翼心', '白昼のペガサス', 8, 8, 'ultra', false, array['hp'], 1.0, 2.0),
  ('m:8:5:n', '戦乙女の羽根', '星降りのヴァルキリー', 8, 8, 'normal', false, array['luk'], 0.1, 2.0),
  ('m:8:5:r', '星屑の槍先', '星降りのヴァルキリー', 8, 8, 'rare', false, array['luk'], 0.6, 2.0),
  ('m:8:5:u', 'ヴァルキリーの誓約印', '星降りのヴァルキリー', 8, 8, 'ultra', false, array['luk'], 1.0, 2.0),
  ('m:8:6:n', '覇龍の鱗', '天空覇龍ウラノス', 8, 8, 'normal', true, array['hp','vit'], 0.1, 2.0),
  ('m:8:6:r', 'ウラノスの天鱗', '天空覇龍ウラノス', 8, 8, 'rare', true, array['hp','vit'], 0.6, 2.0),
  ('m:8:6:u', '天空覇龍の龍核', '天空覇龍ウラノス', 8, 8, 'ultra', true, array['hp','vit'], 1.0, 2.0),
  ('m:9:0:n', '砂まみれの外皮', '砂喰いワーム', 9, 4, 'normal', false, array['vit'], 0.1, 1.3),
  ('m:9:0:r', '砂喰いの顎', '砂喰いワーム', 9, 4, 'rare', false, array['vit'], 0.4, 1.3),
  ('m:9:0:u', '灼砂の胃石', '砂喰いワーム', 9, 4, 'ultra', false, array['vit'], 0.7, 1.3),
  ('m:9:1:n', '朽ちた包帯', '墓守のミイラ', 9, 4, 'normal', false, array['hp'], 0.1, 1.3),
  ('m:9:1:r', '墓守の護符', '墓守のミイラ', 9, 4, 'rare', false, array['hp'], 0.4, 1.3),
  ('m:9:1:u', '不朽の心臓', '墓守のミイラ', 9, 4, 'ultra', false, array['hp'], 0.7, 1.3),
  ('m:9:2:n', '蠍の甲殻', '砂蠍サンドスコーピオン', 9, 4, 'normal', false, array['dex'], 0.1, 1.3),
  ('m:9:2:r', '毒針の欠片', '砂蠍サンドスコーピオン', 9, 4, 'rare', false, array['dex'], 0.4, 1.3),
  ('m:9:2:u', '砂蠍の猛毒嚢', '砂蠍サンドスコーピオン', 9, 4, 'ultra', false, array['dex'], 0.7, 1.3),
  ('m:9:3:n', '揺らめく陽炎', '陽炎のミラージュ', 9, 4, 'normal', false, array['int_stat'], 0.1, 1.3),
  ('m:9:3:r', '幻影の砂片', '陽炎のミラージュ', 9, 4, 'rare', false, array['int_stat'], 0.4, 1.3),
  ('m:9:3:u', '蜃気楼の核', '陽炎のミラージュ', 9, 4, 'ultra', false, array['int_stat'], 0.7, 1.3),
  ('m:9:4:n', '聖獣の耳飾り', '灼熱のアヌビス', 9, 4, 'normal', false, array['str'], 0.1, 1.3),
  ('m:9:4:r', '灼熱の錫杖', '灼熱のアヌビス', 9, 4, 'rare', false, array['str'], 0.4, 1.3),
  ('m:9:4:u', '冥導者の首飾り', '灼熱のアヌビス', 9, 4, 'ultra', false, array['str'], 0.7, 1.3),
  ('m:9:5:n', 'ジャッカルの毛皮', '月砂のジャッカル', 9, 4, 'normal', false, array['agi'], 0.1, 1.3),
  ('m:9:5:r', '月砂の牙', '月砂のジャッカル', 9, 4, 'rare', false, array['agi'], 0.4, 1.3),
  ('m:9:5:u', '疾走の後肢', '月砂のジャッカル', 9, 4, 'ultra', false, array['agi'], 0.7, 1.3),
  ('m:9:6:n', '黄金の鞘翅', '砂皇スカラベウス', 9, 4, 'normal', true, array['vit','hp'], 0.1, 1.3),
  ('m:9:6:r', 'スカラベウスの角', '砂皇スカラベウス', 9, 4, 'rare', true, array['vit','hp'], 0.4, 1.3),
  ('m:9:6:u', '砂皇の黄金核', '砂皇スカラベウス', 9, 4, 'ultra', true, array['vit','hp'], 0.7, 1.3),
  ('m:10:0:n', '絡みつく蔓', '食人樹', 10, 5, 'normal', false, array['str'], 0.1, 1.6),
  ('m:10:0:r', '食人樹の牙葉', '食人樹', 10, 5, 'rare', false, array['str'], 0.5, 1.6),
  ('m:10:0:u', '樹魔の芯木', '食人樹', 10, 5, 'ultra', false, array['str'], 0.8, 1.6),
  ('m:10:1:n', 'マンドラゴラの根', '毒霧のマンドラゴラ', 10, 5, 'normal', false, array['int_stat'], 0.1, 1.6),
  ('m:10:1:r', '毒霧の胞子', '毒霧のマンドラゴラ', 10, 5, 'rare', false, array['int_stat'], 0.5, 1.6),
  ('m:10:1:u', '絶叫の球根', '毒霧のマンドラゴラ', 10, 5, 'ultra', false, array['int_stat'], 0.8, 1.6),
  ('m:10:2:n', '影狼の毛皮', '影狼シャドウウルフ', 10, 5, 'normal', false, array['agi'], 0.1, 1.6),
  ('m:10:2:r', '闇夜の爪', '影狼シャドウウルフ', 10, 5, 'rare', false, array['agi'], 0.5, 1.6),
  ('m:10:2:u', '影渡りの後肢', '影狼シャドウウルフ', 10, 5, 'ultra', false, array['agi'], 0.8, 1.6),
  ('m:10:3:n', '苔むした樹皮', '朝靄のトレント', 10, 5, 'normal', false, array['vit'], 0.1, 1.6),
  ('m:10:3:r', '朝靄の若枝', '朝靄のトレント', 10, 5, 'rare', false, array['vit'], 0.5, 1.6),
  ('m:10:3:u', '古木の年輪核', '朝靄のトレント', 10, 5, 'ultra', false, array['vit'], 0.8, 1.6),
  ('m:10:4:n', 'ピクシーの羽根', '木漏れ日のピクシー', 10, 5, 'normal', false, array['mp'], 0.1, 1.6),
  ('m:10:4:r', '木漏れ日の粉', '木漏れ日のピクシー', 10, 5, 'rare', false, array['mp'], 0.5, 1.6),
  ('m:10:4:u', '妖精王の雫', '木漏れ日のピクシー', 10, 5, 'ultra', false, array['mp'], 0.8, 1.6),
  ('m:10:5:n', '破れた喪服', '常闇のバンシー', 10, 5, 'normal', false, array['luk'], 0.1, 1.6),
  ('m:10:5:r', '嘆きの涙石', '常闇のバンシー', 10, 5, 'rare', false, array['luk'], 0.5, 1.6),
  ('m:10:5:u', '常闇の呪印', '常闇のバンシー', 10, 5, 'ultra', false, array['luk'], 0.8, 1.6),
  ('m:10:6:n', '大樹の樹皮', '森王エルダートレント', 10, 5, 'normal', true, array['hp','vit'], 0.1, 1.6),
  ('m:10:6:r', 'エルダートレントの根', '森王エルダートレント', 10, 5, 'rare', true, array['hp','vit'], 0.5, 1.6),
  ('m:10:6:u', '森王の生命核', '森王エルダートレント', 10, 5, 'ultra', true, array['hp','vit'], 0.8, 1.6),
  ('m:11:0:n', '嵐鳥の風切羽', '嵐鳥ストームバード', 11, 6, 'normal', false, array['agi'], 0.1, 1.6),
  ('m:11:0:r', '雷雲の羽毛', '嵐鳥ストームバード', 11, 6, 'rare', false, array['agi'], 0.5, 1.6),
  ('m:11:0:u', '疾風の翼骨', '嵐鳥ストームバード', 11, 6, 'ultra', false, array['agi'], 0.8, 1.6),
  ('m:11:1:n', '帯電した石片', '雷刃のガーゴイル', 11, 6, 'normal', false, array['dex'], 0.1, 1.6),
  ('m:11:1:r', '雷刃の爪', '雷刃のガーゴイル', 11, 6, 'rare', false, array['dex'], 0.5, 1.6),
  ('m:11:1:u', 'ガーゴイルの雷核', '雷刃のガーゴイル', 11, 6, 'ultra', false, array['dex'], 0.8, 1.6),
  ('m:11:2:n', 'トロールの厚皮', '断崖のトロール', 11, 6, 'normal', false, array['vit'], 0.1, 1.6),
  ('m:11:2:r', '断崖の岩拳', '断崖のトロール', 11, 6, 'rare', false, array['vit'], 0.5, 1.6),
  ('m:11:2:u', '巨人の頑健骨', '断崖のトロール', 11, 6, 'ultra', false, array['vit'], 0.8, 1.6),
  ('m:11:3:n', '鷹の雷羽', '暁雲のサンダーホーク', 11, 6, 'normal', false, array['str'], 0.1, 1.6),
  ('m:11:3:r', '暁雲の鉤爪', '暁雲のサンダーホーク', 11, 6, 'rare', false, array['str'], 0.5, 1.6),
  ('m:11:3:u', '雷鷹の心羽', '暁雲のサンダーホーク', 11, 6, 'ultra', false, array['str'], 0.8, 1.6),
  ('m:11:4:n', '雷光の残滓', '雷光のエレメンタル', 11, 6, 'normal', false, array['int_stat'], 0.1, 1.6),
  ('m:11:4:r', '放電する結晶', '雷光のエレメンタル', 11, 6, 'rare', false, array['int_stat'], 0.5, 1.6),
  ('m:11:4:u', '雷精の閃核', '雷光のエレメンタル', 11, 6, 'ultra', false, array['int_stat'], 0.8, 1.6),
  ('m:11:5:n', '雷鳴の鱗', '雷鳴のワイバーン', 11, 6, 'normal', false, array['hp'], 0.1, 1.6),
  ('m:11:5:r', '裂けた飛膜', '雷鳴のワイバーン', 11, 6, 'rare', false, array['hp'], 0.5, 1.6),
  ('m:11:5:u', '轟雷の逆鱗', '雷鳴のワイバーン', 11, 6, 'ultra', false, array['hp'], 0.8, 1.6),
  ('m:11:6:n', '帝竜の雷鱗', '雷帝ケラウノス', 11, 6, 'normal', true, array['int_stat','agi'], 0.1, 1.6),
  ('m:11:6:r', 'ケラウノスの雷角', '雷帝ケラウノス', 11, 6, 'rare', true, array['int_stat','agi'], 0.5, 1.6),
  ('m:11:6:u', '天雷の帝核', '雷帝ケラウノス', 11, 6, 'ultra', true, array['int_stat','agi'], 0.8, 1.6),
  ('m:12:0:n', 'ヒュドラの鱗', '沼のヒュドラ', 12, 7, 'normal', false, array['str'], 0.1, 2.0),
  ('m:12:0:r', '沼毒の牙', '沼のヒュドラ', 12, 7, 'rare', false, array['str'], 0.6, 2.0),
  ('m:12:0:u', '再生する首', '沼のヒュドラ', 12, 7, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:12:1:n', '腐食した粘液', '腐食スライム', 12, 7, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:12:1:r', '溶解の核', '腐食スライム', 12, 7, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:12:1:u', '腐海の原液', '腐食スライム', 12, 7, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:12:2:n', '沼底の鱗', '沼底のリザードマン', 12, 7, 'normal', false, array['dex'], 0.1, 2.0),
  ('m:12:2:r', '沼底の骨槍', '沼底のリザードマン', 12, 7, 'rare', false, array['dex'], 0.6, 2.0),
  ('m:12:2:u', '毒沼の心鱗', '沼底のリザードマン', 12, 7, 'ultra', false, array['dex'], 1.0, 2.0),
  ('m:12:3:n', 'ゆらめく鬼火', '朝霞のウィルオウィスプ', 12, 7, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:12:3:r', '朝霞の灯芯', '朝霞のウィルオウィスプ', 12, 7, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:12:3:u', '惑わしの魂火', '朝霞のウィルオウィスプ', 12, 7, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:12:4:n', '大蛙の粘皮', '陽だまりの大蛙', 12, 7, 'normal', false, array['hp'], 0.1, 2.0),
  ('m:12:4:r', '伸縮する舌', '陽だまりの大蛙', 12, 7, 'rare', false, array['hp'], 0.6, 2.0),
  ('m:12:4:u', '飽食の胃袋', '陽だまりの大蛙', 12, 7, 'ultra', false, array['hp'], 1.0, 2.0),
  ('m:12:5:n', '腐った腕', '夜霧のゾンビ', 12, 7, 'normal', false, array['vit'], 0.1, 2.0),
  ('m:12:5:r', '夜霧の屍布', '夜霧のゾンビ', 12, 7, 'rare', false, array['vit'], 0.6, 2.0),
  ('m:12:5:u', '不死の腐核', '夜霧のゾンビ', 12, 7, 'ultra', false, array['vit'], 1.0, 2.0),
  ('m:12:6:n', '毒龍の鱗', '毒龍ヴェノムヒュドラ', 12, 7, 'normal', true, array['str','int_stat'], 0.1, 2.0),
  ('m:12:6:r', 'ヴェノムヒュドラの猛毒牙', '毒龍ヴェノムヒュドラ', 12, 7, 'rare', true, array['str','int_stat'], 0.6, 2.0),
  ('m:12:6:u', '腐海の毒心核', '毒龍ヴェノムヒュドラ', 12, 7, 'ultra', true, array['str','int_stat'], 1.0, 2.0),
  ('m:13:0:n', 'グールの爪', '坑道のグール', 13, 7, 'normal', false, array['dex'], 0.1, 2.0),
  ('m:13:0:r', '錆びたつるはし', '坑道のグール', 13, 7, 'rare', false, array['dex'], 0.6, 2.0),
  ('m:13:0:u', '屍喰いの顎', '坑道のグール', 13, 7, 'ultra', false, array['dex'], 1.0, 2.0),
  ('m:13:1:n', '砕けた鉱石', '鉱石ゴーレム', 13, 7, 'normal', false, array['vit'], 0.1, 2.0),
  ('m:13:1:r', '純度の高い鉱脈', '鉱石ゴーレム', 13, 7, 'rare', false, array['vit'], 0.6, 2.0),
  ('m:13:1:u', '鉱石ゴーレムの動力核', '鉱石ゴーレム', 13, 7, 'ultra', false, array['vit'], 1.0, 2.0),
  ('m:13:2:n', '闇喰いの翼膜', '闇喰いコウモリ', 13, 7, 'normal', false, array['agi'], 0.1, 2.0),
  ('m:13:2:r', '反響する耳', '闇喰いコウモリ', 13, 7, 'rare', false, array['agi'], 0.6, 2.0),
  ('m:13:2:u', '無音の飛膜', '闇喰いコウモリ', 13, 7, 'ultra', false, array['agi'], 1.0, 2.0),
  ('m:13:3:n', '水晶の欠片', '曙光のクリスタルワーム', 13, 7, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:13:3:r', '曙光の結晶', '曙光のクリスタルワーム', 13, 7, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:13:3:u', '虹映の魔晶', '曙光のクリスタルワーム', 13, 7, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:13:4:n', '亡霊の鉄槌', '灯火のドワーフ亡霊', 13, 7, 'normal', false, array['str'], 0.1, 2.0),
  ('m:13:4:r', '消えぬ灯火', '灯火のドワーフ亡霊', 13, 7, 'rare', false, array['str'], 0.6, 2.0),
  ('m:13:4:u', '坑夫王の遺志', '灯火のドワーフ亡霊', 13, 7, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:13:5:n', 'よどんだ影', '深穴のシャドウ', 13, 7, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:13:5:r', '深穴の闇片', '深穴のシャドウ', 13, 7, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:13:5:u', '虚無の魔核', '深穴のシャドウ', 13, 7, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:13:6:n', '巨大な鉤爪', '巌喰いガイアモール', 13, 7, 'normal', true, array['hp','str'], 0.1, 2.0),
  ('m:13:6:r', 'ガイアモールの牙', '巌喰いガイアモール', 13, 7, 'rare', true, array['hp','str'], 0.6, 2.0),
  ('m:13:6:u', '大地喰らいの熱核', '巌喰いガイアモール', 13, 7, 'ultra', true, array['hp','str'], 1.0, 2.0),
  ('m:14:0:n', '星読みの石片', '星読みの石像', 14, 8, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:14:0:r', '刻まれた星図', '星読みの石像', 14, 8, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:14:0:u', '天測儀の核', '星読みの石像', 14, 8, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:14:1:n', '守護機構の装甲', '遺跡守護機構', 14, 8, 'normal', false, array['vit'], 0.1, 2.0),
  ('m:14:1:r', '古代の歯車', '遺跡守護機構', 14, 8, 'rare', false, array['vit'], 0.6, 2.0),
  ('m:14:1:u', '不朽の駆動核', '遺跡守護機構', 14, 8, 'ultra', false, array['vit'], 1.0, 2.0),
  ('m:14:2:n', '時喰いの外殻', '時喰いのクロノワーム', 14, 8, 'normal', false, array['agi'], 0.1, 2.0),
  ('m:14:2:r', '砂時計の砂', '時喰いのクロノワーム', 14, 8, 'rare', false, array['agi'], 0.6, 2.0),
  ('m:14:2:u', '刻を喰う顎', '時喰いのクロノワーム', 14, 8, 'ultra', false, array['agi'], 1.0, 2.0),
  ('m:14:3:n', '星鋼の兜', '暁星のアストラルナイト', 14, 8, 'normal', false, array['str'], 0.1, 2.0),
  ('m:14:3:r', '暁星の剣先', '暁星のアストラルナイト', 14, 8, 'rare', false, array['str'], 0.6, 2.0),
  ('m:14:3:u', '星霊騎士の魂片', '暁星のアストラルナイト', 14, 8, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:14:4:n', '獅子の鬣', '白日のスフィンクス', 14, 8, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:14:4:r', '謎かけの石板', '白日のスフィンクス', 14, 8, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:14:4:u', '白日の叡智核', '白日のスフィンクス', 14, 8, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:14:5:n', '月光の裾布', '星宿のルナリス', 14, 8, 'normal', false, array['luk'], 0.1, 2.0),
  ('m:14:5:r', '星宿の耳飾り', '星宿のルナリス', 14, 8, 'rare', false, array['luk'], 0.6, 2.0),
  ('m:14:5:u', 'ルナリスの月華石', '星宿のルナリス', 14, 8, 'ultra', false, array['luk'], 1.0, 2.0),
  ('m:14:6:n', '星霜の龍鱗', '時星龍アイオーン', 14, 8, 'normal', true, array['int_stat','mp'], 0.1, 2.0),
  ('m:14:6:r', 'アイオーンの時角', '時星龍アイオーン', 14, 8, 'rare', true, array['int_stat','mp'], 0.6, 2.0),
  ('m:14:6:u', '悠久の星核', '時星龍アイオーン', 14, 8, 'ultra', true, array['int_stat','mp'], 1.0, 2.0),
  ('m:15:0:n', 'クラーケンの吸盤', '深淵のクラーケン', 15, 8, 'normal', false, array['str'], 0.1, 2.0),
  ('m:15:0:r', '断ち切れた触腕', '深淵のクラーケン', 15, 8, 'rare', false, array['str'], 0.6, 2.0),
  ('m:15:0:u', '深淵の墨袋', '深淵のクラーケン', 15, 8, 'ultra', false, array['str'], 1.0, 2.0),
  ('m:15:1:n', '幼体の鱗', '海淵のリヴァイアサン幼体', 15, 8, 'normal', false, array['hp'], 0.1, 2.0),
  ('m:15:1:r', '未熟な逆鱗', '海淵のリヴァイアサン幼体', 15, 8, 'rare', false, array['hp'], 0.6, 2.0),
  ('m:15:1:u', '海淵の胎動核', '海淵のリヴァイアサン幼体', 15, 8, 'ultra', false, array['hp'], 1.0, 2.0),
  ('m:15:2:n', '海妖の髪', '冥暗のシーウィッチ', 15, 8, 'normal', false, array['int_stat'], 0.1, 2.0),
  ('m:15:2:r', '呪詛の巻貝', '冥暗のシーウィッチ', 15, 8, 'rare', false, array['int_stat'], 0.6, 2.0),
  ('m:15:2:u', '冥暗の魔核', '冥暗のシーウィッチ', 15, 8, 'ultra', false, array['int_stat'], 1.0, 2.0),
  ('m:15:3:n', '海竜の背鰭', '朝凪の海竜', 15, 8, 'normal', false, array['dex'], 0.1, 2.0),
  ('m:15:3:r', '朝凪の鱗', '朝凪の海竜', 15, 8, 'rare', false, array['dex'], 0.6, 2.0),
  ('m:15:3:u', '静海の心鱗', '朝凪の海竜', 15, 8, 'ultra', false, array['dex'], 1.0, 2.0),
  ('m:15:4:n', '巨鯨の皮脂', '陽射しの巨鯨', 15, 8, 'normal', false, array['vit'], 0.1, 2.0),
  ('m:15:4:r', '潮吹きの噴気孔', '陽射しの巨鯨', 15, 8, 'rare', false, array['vit'], 0.6, 2.0),
  ('m:15:4:u', '海獣の巨心', '陽射しの巨鯨', 15, 8, 'ultra', false, array['vit'], 1.0, 2.0),
  ('m:15:5:n', '女王の鱗衣', '深海のセイレーン女王', 15, 8, 'normal', false, array['mp'], 0.1, 2.0),
  ('m:15:5:r', '蒼海の宝冠', '深海のセイレーン女王', 15, 8, 'rare', false, array['mp'], 0.6, 2.0),
  ('m:15:5:u', '魅惑の歌声', '深海のセイレーン女王', 15, 8, 'ultra', false, array['mp'], 1.0, 2.0),
  ('m:15:6:n', '覇王の巨鱗', '深海覇王リヴァイアサン', 15, 8, 'normal', true, array['hp','vit'], 0.1, 2.0),
  ('m:15:6:r', 'リヴァイアサンの逆鱗', '深海覇王リヴァイアサン', 15, 8, 'rare', true, array['hp','vit'], 0.6, 2.0),
  ('m:15:6:u', '深淵覇王の海心', '深海覇王リヴァイアサン', 15, 8, 'ultra', true, array['hp','vit'], 1.0, 2.0)
on conflict (id) do update set
  name = excluded.name, enemy = excluded.enemy, area = excluded.area, tier = excluded.tier,
  rarity = excluded.rarity,
  is_boss = excluded.is_boss, stats = excluded.stats, lo = excluded.lo, hi = excluded.hi;

-- ---- 素材の売値（v2で唯一Goldが湧く場所）----
-- ★**敵はGoldを落とさない**（2026-08-17 ユーザー決定・docs/v2-gold-design.md）。
--   売値＝ **難易度帯**の基準額 × レア度の倍率（通常1 / レア8 / 激レア40）。
--   基準額は**デイリーミッション「かんたん」の100G**から引いた（2026-08-22 ユーザー決定で
--   大幅に引き下げ。旧値は①40〜⑧2330）。①帯の激レア1個＝120G＝デイリー1回ぶん。
-- ⚠**同じ表が src/v2/lib/material.js の SELL_BASE_TIER / SELL_RARITY_MULT にもある。
--   片方だけ直すと v2sql.test.js が落ちる**（売却の権威はこちら）
alter table public.v2_materials add column if not exists sell int not null default 0;
update public.v2_materials set sell =
  (case tier when 1 then 3 when 2 then 6 when 3 then 9 when 4 then 12
             when 5 then 18 when 6 then 24 when 7 then 36 when 8 then 54 else 0 end)
  * (case rarity when 'normal' then 1 when 'rare' then 8 when 'ultra' then 40 else 0 end);

-- ---- 持っている素材（スタック）----
create table if not exists public.v2_player_materials (
  player_id   uuid not null references auth.users(id) on delete cascade,
  material_id text not null references public.v2_materials(id),
  qty         int  not null default 0 check (qty >= 0),
  primary key (player_id, material_id)
);
alter table public.v2_player_materials enable row level security;
drop policy if exists "v2_player_materials_own" on public.v2_player_materials;
create policy "v2_player_materials_own" on public.v2_player_materials for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2_player_materials from anon;
grant select on table public.v2_player_materials to authenticated;

-- ---- ソケット ----
-- **いまは武器だけ**。片手2枠・両手3枠で、**色はドロップした瞬間に1枠ずつ1/3で決まる**
alter table public.v2_inventory add column if not exists sockets text[] not null default '{}'::text[];

-- ---- エッセンス ----
-- inv_id が入っていれば、その装備の socket_idx 番の枠に刺さっている
create table if not exists public.v2_essences (
  id          bigserial primary key,
  player_id   uuid    not null references auth.users(id) on delete cascade,
  color       text    not null,                      -- red / blue / green
  stats       jsonb   not null default '{}'::jsonb,  -- {"vit": 0.6, "agi": 1.0} ＝ %
  -- ability は敵の名前（＝特殊能力のキー）。v2_materials.enemy は一意ではないので外部キーは張れない
  ability     text,
  ability_choices text[] not null default '{}'::text[],  -- 抽出で当たった候補。ここから1つ選ぶ
  inv_id      bigint  references public.v2_inventory(id) on delete set null,
  socket_idx  int,
  created_at  timestamptz not null default now()
);
create index if not exists v2_essences_player_idx on public.v2_essences(player_id);
create unique index if not exists v2_essences_socket_uniq on public.v2_essences(inv_id, socket_idx) where inv_id is not null;
alter table public.v2_essences enable row level security;
drop policy if exists "v2_essences_own" on public.v2_essences;
create policy "v2_essences_own" on public.v2_essences for select to authenticated using (player_id = auth.uid());
revoke all on table public.v2_essences from anon;
grant select on table public.v2_essences to authenticated;

-- ---- エッセンスを外すためのアイテム ----
-- ⚠**名前も入手手段もまだ決まっていない**（docs/v2-enchant-design.md の「残り」）。
--   いまは枚数だけ持たせて、is_admin が動作確認用に配れるようにしてある。
alter table public.v2_profiles add column if not exists unsocket_tickets int not null default 0;

-- ============================================================
-- ===== スタミナ（オート出撃の燃料）=====
-- ------------------------------------------------------------
-- ★2026-08-22 ユーザー決定。
--   ・スタミナが1以上あるあいだは、画面が**10秒ごとに自動で出撃**する
--   ・オート出撃1回につき1消費（**手動の出撃は消費しない**）
--   ・切れたらこれまで通り自分でクリックして出撃する
--   ・回復は**5分に1**・上限は最大値まで（画面を閉じているあいだも溜まる）
--   ・最大値は**転職回数**で伸びる。★伸びる条件はマスク＝画面には出さない
-- ⚠数える権威はここ。src/v2/lib/stamina.js はその写しで、v2sql.test.js が突き合わせる。
-- ============================================================

-- 最大スタミナ。転職回数の段ごとに「その段に入った回数 ÷ per」を切り捨てて足す
--   1〜29回=1回ごと／30〜49回=3回ごと／50〜99回=5回ごと／100〜299回=10回ごと／300回〜=30回ごと
create or replace function public.v2_stamina_max(p_jobs int)
returns int language sql immutable set search_path = public as $$
  select 10
       + least(greatest(coalesce(p_jobs, 0), 0), 29)
       + least(greatest(coalesce(p_jobs, 0) -  29, 0),  20) /  3
       + least(greatest(coalesce(p_jobs, 0) -  49, 0),  50) /  5
       + least(greatest(coalesce(p_jobs, 0) -  99, 0), 200) / 10
       +       greatest(coalesce(p_jobs, 0) - 299, 0)       / 30;
$$;
-- ★増え方はマスクなので、クライアントからは叩かせない（表示用の写しはJS側に持つ）
revoke all on function public.v2_stamina_max(int) from public;
revoke all on function public.v2_stamina_max(int) from anon;
revoke all on function public.v2_stamina_max(int) from authenticated;

-- 経過時間ぶんを足して数え直し、いまのスタミナを返す。
--   ・端数は捨てない＝消化したぶんだけ stamina_at を進める（4分59秒が毎回消えないように）
--   ・満タンのあいだは stamina_at を now() にしておく（止まっているあいだに溜め込まない）
-- ⚠SECURITY DEFINER の内部ヘルパは既定で PUBLIC 実行可なので必ず REVOKE する
--   （旧版で protect_stats を迂回できた穴と同じ）。RPCからだけ呼ぶ。
create or replace function public.v2_stamina_roll(p_player uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_span constant interval := interval '5 minutes';   -- 回復の間隔（stamina.js の STAMINA_RECOVER_MS）
  v_row  public.v2_profiles;
  v_max  int;
  v_gain int;
  v_n    int;
  v_at   timestamptz;
begin
  if p_player is null then return 0; end if;
  select * into v_row from public.v2_profiles where id = p_player for update;
  if not found then return 0; end if;
  v_max := public.v2_stamina_max(v_row.job_changes);
  v_n   := greatest(least(coalesce(v_row.stamina, 0), v_max), 0);
  v_at  := coalesce(v_row.stamina_at, now());
  if v_n >= v_max then
    v_n := v_max; v_at := now();
  else
    v_gain := greatest(floor(extract(epoch from (now() - v_at)) / extract(epoch from c_span))::int, 0);
    v_n  := least(v_max, v_n + v_gain);
    v_at := case when v_n >= v_max then now() else v_at + (v_gain * c_span) end;
  end if;
  update public.v2_profiles set stamina = v_n, stamina_at = v_at, updated_at = now()
   where id = p_player;
  return v_n;
end;
$$;
revoke all on function public.v2_stamina_roll(uuid) from public;
revoke all on function public.v2_stamina_roll(uuid) from anon;
revoke all on function public.v2_stamina_roll(uuid) from authenticated;

-- ===== 出撃の清算 =====
-- 旧版と同じで、戦闘そのものはクライアントが回し、まとめてここへ送る。
-- ⚠サーバーは「その回数で取り得る上限」を超えていないかだけ検証する（完全な権威ではない）。
--   戦闘をサーバーで回すようにしたら、このRPCの中で回すよう差し替える。
-- ★**敵はGoldを落とさない**（2026-08-17 ユーザー決定・docs/v2-gold-design.md）。
--   p_gold は**受け取るが完全に無視する**（クライアントを先に配っても壊れないよう引数だけ残した）。
--   Goldはルーン素材をNPCへ売って稼ぐ＝ v2_sell_materials が唯一の湧き口
-- ---- 解放しておくエリアを作り直す（難易度帯の規則）----
-- ★2026-08-22 ユーザー決定：**その帯を全部踏破すると次の帯がまとめて開く**。
--   req は v2_tiers（④⑤⑥は2・⑦⑧は3）。⚠ src/v2/lib/sortie.js の unlockNext と同じ規則。
--   p_unlocked を渡すのは「**一度開いた帯は閉じない**」ため（新ルールの前に開いていたぶんを残す）
create or replace function public.v2_unlocked_from_cleared(p_cleared int[], p_unlocked int[] default '{}')
returns int[] language sql stable set search_path = public as $$
  with open_tier as (
    -- ①は最初から／すでに開いているエリアが属する帯／前の帯を req ぶん踏破した帯
    select 1 as tier
    union
    select a.tier from public.v2_areas a where a.id = any(coalesce(p_unlocked, '{}'))
    union
    select t.tier + 1 from public.v2_tiers t
     where (select count(*) from public.v2_areas a
             where a.tier = t.tier and a.id = any(coalesce(p_cleared, '{}'))) >= t.req
  )
  select coalesce(array_agg(a.id order by a.id), '{}')
    from public.v2_areas a where a.tier in (select tier from open_tier);
$$;
-- ⚠これは v2_sortie_settle の中だけで使う内部ヘルパ。**外から叩かせない**
--   （SECURITY DEFINER の settle から呼ぶので、authenticated への grant は要らない）
revoke all on function public.v2_unlocked_from_cleared(int[], int[]) from public;
revoke all on function public.v2_unlocked_from_cleared(int[], int[]) from anon;
revoke all on function public.v2_unlocked_from_cleared(int[], int[]) from authenticated;

-- 既存プレイヤーの解放を新しい規則へそろえる（**閉じない**＝開いている帯の新エリアが増えるだけ）
update public.v2_profiles p
   set unlocked_areas = public.v2_unlocked_from_cleared(p.cleared_areas, p.unlocked_areas)
 where p.unlocked_areas is distinct from
       public.v2_unlocked_from_cleared(p.cleared_areas, p.unlocked_areas);

-- ⚠引数が増えたので、古い版は落としてから作り直す（同じ名前で残ると呼び分けが曖昧になる）
drop function if exists public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb);
drop function if exists public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb);
-- p_auto ＝ **オート出撃で戦ったか**（2026-08-22 追加）。true なら戦った回数ぶんスタミナを消費する。
--   手動（自分でクリック）は消費しない＝スタミナが切れてもこれまで通り遊べる
create or replace function public.v2_sortie_settle(
  p_area int, p_normals int, p_boss_wins int, p_boss_seen int,
  p_exp int, p_gold bigint, p_drops jsonb, p_materials jsonb default '[]'::jsonb,
  p_auto boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_area  public.v2_areas;
  v_equip public.v2_equipment;
  v_sock  text[];
  v_mid   text;
  v_n     int := greatest(coalesce(p_normals, 0), 0);
  v_bw    int := greatest(coalesce(p_boss_wins, 0), 0);
  v_bs    int := greatest(coalesce(p_boss_seen, 0), 0);
  v_exp_cap  int;
  v_exp   int;
  v_drop  jsonb;
  v_ok    int := 0;
  v_res   jsonb;
  v_unlocked int[];
  v_cleared  int[];
  v_rate  numeric;
  v_cost  int := 0;   -- この清算で使うスタミナ（オートのときだけ）
  v_stam  int := 0;
  v_stam_at timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_area from public.v2_areas where id = p_area;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエリアはありません'); end if;
  if not (v_row.unlocked_areas @> array[p_area]) then
    return jsonb_build_object('ok', false, 'error', 'このエリアはまだ解放されていません');
  end if;
  if v_n + v_bs = 0 then return jsonb_build_object('ok', false, 'error', '清算するものがありません'); end if;
  if v_n + v_bs > 500 then return jsonb_build_object('ok', false, 'error', '一度に清算できる回数を超えています'); end if;
  -- ★ボス勝利数は「ボスに遭遇した回数」を超えられない。
  --   ここを見ていないと、遭遇1回のまま勝利数だけ大きく送れて下の上限計算が青天井になる
  --   （回数の頭打ちは v_n + v_bs にしか掛かっていないため）。
  v_bw := least(v_bw, v_bs);

  -- ★オート出撃はスタミナを戦った回数ぶん消費する。足りなければ**1戦も通さない**
  --   （手動は消費しない＝切れても自分でクリックすれば遊べる）
  if coalesce(p_auto, false) then
    v_cost := v_n + v_bs;
    v_stam := public.v2_stamina_roll(v_uid);
    if v_stam < v_cost then
      return jsonb_build_object('ok', false, 'error', 'スタミナが足りません', 'stamina', v_stam);
    end if;
  end if;

  -- 取り得る上限。通常敵はEXP11・ボスは13が最大（sortie.js と同じ）
  v_exp_cap  := v_n * 11 + v_bw * 13;
  v_exp  := least(greatest(coalesce(p_exp, 0), 0), v_exp_cap);
  -- ★Goldはここで一切足さない（p_gold は無視）

  -- ドロップ。そのエリアで落ちるランクかどうかだけ見る
  if p_drops is not null and jsonb_typeof(p_drops) = 'array' then
    if jsonb_array_length(p_drops) > v_n + v_bs then
      return jsonb_build_object('ok', false, 'error', 'ドロップの数が戦闘回数を超えています');
    end if;
    for v_drop in select * from jsonb_array_elements(p_drops) loop
      select * into v_equip from public.v2_equipment e
      where e.id = (v_drop #>> '{}') and v_area.drop_ranks ? e.rank;
      if found then
        -- ★ソケットの色はここで決める（サーバー権威）。**いまは武器だけ・1枠ずつ1/3**
        --   片手2枠・両手3枠。防具・アクセへ広げるときはこの条件を直す
        v_sock := '{}'::text[];
        if v_equip.part = '武器' then
          for i in 1 .. (case when v_equip.hands = '2' then 3 else 2 end) loop
            v_sock := array_append(v_sock, (array['red','blue','green'])[1 + floor(random() * 3)::int]);
          end loop;
        end if;
        insert into public.v2_inventory (player_id, equip_id, sockets) values (v_uid, v_equip.id, v_sock);
        v_ok := v_ok + 1;
      end if;
    end loop;
  end if;

  -- エンチャントの素材。**1戦闘につき1個まで**しか落ちないので、そこだけ検証する
  --   ⚠「素材ドロップ率up」の特殊能力はクライアント側の確率なので、サーバーからは検証できない
  if p_materials is not null and jsonb_typeof(p_materials) = 'array' then
    if jsonb_array_length(p_materials) > v_n + v_bs then
      return jsonb_build_object('ok', false, 'error', '素材の数が戦闘回数を超えています');
    end if;
    for v_drop in select * from jsonb_array_elements(p_materials) loop
      v_mid := v_drop #>> '{}';
      insert into public.v2_player_materials (player_id, material_id, qty)
      select v_uid, m.id, 1 from public.v2_materials m where m.id = v_mid and m.area = p_area
      on conflict (player_id, material_id) do update set qty = public.v2_player_materials.qty + 1;
    end loop;
  end if;

  -- 踏破済み（そのエリアのボスを倒した）。**帯が開いたかどうかはここから数える**
  v_cleared := coalesce(v_row.cleared_areas, '{}');
  if v_bw > 0 and not (v_cleared @> array[p_area]) then
    v_cleared := array_append(v_cleared, p_area);
  end if;
  -- ★解放は「その難易度帯を全部踏破したか」で決まる（1本道ではない・2026-08-22 ユーザー決定）。
  --   今の解放も渡す＝**一度開いた帯は閉じない**
  v_unlocked := public.v2_unlocked_from_cleared(v_cleared, v_row.unlocked_areas);
  -- ボス遭遇率。通常敵と戦うたび+0.3、ボスに当たった回があれば0へ戻す
  v_rate := case when v_bs > 0 then 0 else least(100, v_row.boss_rate + 0.3 * v_n) end;

  update public.v2_profiles
     set unlocked_areas = v_unlocked, cleared_areas = v_cleared, boss_rate = v_rate,
         -- ★スタミナは減らすだけ（stamina_at は v2_stamina_roll が置いた値のまま）。
         --   満タンから使ったときは roll が now() にしているので、そこから5分で1戻る
         stamina = greatest(0, stamina - v_cost),
         last_sortie_at = now(), updated_at = now()
   where id = v_uid
   returning stamina, stamina_at into v_stam, v_stam_at;

  v_res := public.v2_apply_exp(v_uid, v_exp);
  -- デイリーミッション：この清算で戦った回数ぶん数える（通常敵＋ボス）。
  -- ★**1回＝1カウント**。出撃間隔が10秒固定になったので倍率は無い（daily.js と同じ）
  perform public.v2_daily_bump(v_uid, 'sortie', v_n + v_bs);
  return jsonb_build_object('ok', true, 'exp', v_exp, 'gold', 0, 'drops', v_ok,
    'unlocked', to_jsonb(v_unlocked), 'cleared', to_jsonb(v_cleared),
    'boss_rate', v_rate, 'level', v_res,
    'stamina', v_stam, 'stamina_at', v_stam_at, 'stamina_max', public.v2_stamina_max(v_row.job_changes));
end;
$$;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb, boolean) from public;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb, boolean) from anon;
grant execute on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb, jsonb, boolean) to authenticated;

-- ===== 出撃のクールタイムの設定は廃止（10秒固定・2026-08-22 ユーザー決定）=====
drop function if exists public.v2_set_cooldown(int);

-- ===== 装備の着脱 =====
-- ★枠の種類チェックはサーバーで行う（両手武器は左手を塞ぐ・盾は左手専用・アクセは2枠）
create or replace function public.v2_equip(p_slot text, p_inventory_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.v2_profiles;
  v_inv public.v2_inventory;
  v_eq  public.v2_equipment;
  v_new jsonb;
  v_slot text := p_slot;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  if v_slot not in ('right','left','head','body','arm','foot','acc1','acc2') then
    return jsonb_build_object('ok', false, 'error', 'そんな枠はありません');
  end if;
  select * into v_inv from public.v2_inventory where id = p_inventory_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  select * into v_eq from public.v2_equipment where id = v_inv.equip_id;

  -- 部位と枠が合っているか
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

  v_new := v_row.equipped;
  -- 同じ装備が別の枠に着いていたら外す
  for v_slot in select key from jsonb_each_text(v_new) where value::bigint = p_inventory_id loop
    v_new := v_new - v_slot;
  end loop;
  v_slot := p_slot;
  v_new := jsonb_set(v_new, array[v_slot], to_jsonb(p_inventory_id));
  -- 両手武器を右手に着けたら左手を空ける／左手に何か着けるとき右手が両手武器なら外す
  if v_eq.part = '武器' and v_eq.hands = '2' then
    v_new := v_new - 'left';
  elsif v_slot = 'left' and (v_new ? 'right') then
    if exists (select 1 from public.v2_inventory i join public.v2_equipment e on e.id = i.equip_id
               where i.id = (v_new ->> 'right')::bigint and e.hands = '2') then
      v_new := v_new - 'right';
    end if;
  end if;

  update public.v2_profiles set equipped = v_new, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'equipped', v_new);
end;
$$;
revoke all on function public.v2_equip(text, bigint) from public;
revoke all on function public.v2_equip(text, bigint) from anon;
grant execute on function public.v2_equip(text, bigint) to authenticated;

create or replace function public.v2_unequip(p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_new jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select equipped - p_slot into v_new from public.v2_profiles where id = v_uid;
  if v_new is null then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  update public.v2_profiles set equipped = v_new, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'equipped', v_new);
end;
$$;
revoke all on function public.v2_unequip(text) from public;
revoke all on function public.v2_unequip(text) from anon;
grant execute on function public.v2_unequip(text) to authenticated;

-- ===== 鍛冶屋：強化（強化元1個＋強化素材2個） =====
-- ★2026-08-16 に「3個まとめて溶けて新しい1個ができる」方式から作り直した。
--   前の方式は強化元を選べず、エッセンス入り・ソケット厳選の装備が
--   どれか分からないまま消えていた。いまは：
--     ・強化元（p_base）  … **成功しても失敗しても残る**。行そのものを更新するので
--                            ソケットに入っているエッセンス（v2_essences.inv_id）もそのまま
--     ・強化素材（2個）    … 成功なら消える。失敗でも消える
--                            （守りの護符を使ったときだけ、失敗で消えない）
-- ★守りの護符（p_protect）… 失敗しても強化素材が消えない。そのかわり
--   上がるときは必ず+1（大成功・超大成功は出ない）。護符は使うと1個減る。
-- ★確率は src/v2/lib/smith.js の RATES と同じ数字にすること（片方だけ直すとズレる）。
--   あるけみすとは強化の仕様を公表していないのでBF独自。
--   守っているのは「ランクが高いほど上がりにくい」だけ。
alter table public.v2_profiles add column if not exists protect_count int not null default 0;

-- 古い3個指定の関数は残しておくと画面から呼べてしまうので落とす
drop function if exists public.v2_fuse(bigint, bigint, bigint);

create or replace function public.v2_fuse(p_base bigint, p_mat_a bigint, p_mat_b bigint, p_protect boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_plus_max constant int := 12;
  v_uid   uuid := auth.uid();
  v_mats  bigint[] := array[p_mat_a, p_mat_b];
  v_equip text;
  v_plus  int;
  v_rank  text;
  v_cnt   int;
  v_r     numeric;
  v_fail numeric; v_great numeric; v_super numeric;
  v_up    int;
  v_new   int;
  v_res   text;
  v_protect boolean := coalesce(p_protect, false);
  v_equipped jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_base = p_mat_a or p_base = p_mat_b or p_mat_a = p_mat_b then
    return jsonb_build_object('ok', false, 'error', '同じものを重ねて選んでいます');
  end if;

  -- 強化元。装備中でも使える（消えないため）
  select equip_id, plus into v_equip, v_plus
    from public.v2_inventory where id = p_base and player_id = v_uid;
  if v_equip is null then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  if v_plus >= c_plus_max then
    return jsonb_build_object('ok', false, 'error', format('強化値は+%sが上限です', c_plus_max));
  end if;

  -- 強化素材。同じ装備・同じ強化値でなければならない
  select count(*) into v_cnt
    from public.v2_inventory
   where id = any(v_mats) and player_id = v_uid and equip_id = v_equip and plus = v_plus;
  if v_cnt <> 2 then
    return jsonb_build_object('ok', false, 'error', '同じ装備・同じ強化値のものを2個選んでください');
  end if;

  -- ★装備中のものは強化素材にできない（消えてしまうため）
  select equipped into v_equipped from public.v2_profiles where id = v_uid;
  if exists (select 1 from jsonb_each_text(v_equipped) where value::bigint = any(v_mats)) then
    return jsonb_build_object('ok', false, 'error', '装備中のものは強化素材に使えません');
  end if;

  -- 護符を使うなら、ここで1個減らす。減らせなければ持っていない
  if v_protect then
    update public.v2_profiles set protect_count = protect_count - 1, updated_at = now()
     where id = v_uid and protect_count > 0;
    if not found then return jsonb_build_object('ok', false, 'error', '守りの護符を持っていません'); end if;
  end if;

  select rank into v_rank from public.v2_equipment where id = v_equip;
  -- ★src/v2/lib/smith.js の RATES と同じ数字
  select f, g, s into v_fail, v_great, v_super from (values
    ('F', 0.00, 0.14, 0.04), ('E', 0.03, 0.12, 0.03), ('D', 0.07, 0.10, 0.03),
    ('C', 0.12, 0.09, 0.02), ('B', 0.18, 0.07, 0.02), ('A', 0.25, 0.06, 0.01),
    ('S', 0.33, 0.05, 0.01)
  ) t(r, f, g, s) where t.r = v_rank;
  -- 護符を使うと大成功・超大成功のぶんが成功に寄る（失敗率は変わらない）
  if v_protect then v_great := 0; v_super := 0; end if;

  v_r := random();
  if v_r < v_fail then
    v_up := 0; v_res := 'fail';
  elsif v_r < v_fail + v_super then v_up := 3; v_res := 'super';
  elsif v_r < v_fail + v_super + v_great then v_up := 2; v_res := 'great';
  else v_up := 1; v_res := 'ok';
  end if;

  -- ★強化素材を消すのは「成功したとき」か「失敗＋護符なし」のとき。
  --   護符ありで失敗したときだけ、何も消えない
  if v_up > 0 or not v_protect then
    delete from public.v2_inventory where id = any(v_mats) and player_id = v_uid;
  end if;

  -- ★強化元は行を作り直さず**そのまま更新する**＝ソケットのエッセンスが外れない
  v_new := least(c_plus_max, v_plus + v_up);
  if v_up > 0 then
    update public.v2_inventory set plus = v_new where id = p_base and player_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'result', v_res, 'plus', v_new,
                            'id', p_base, 'protected', v_protect and v_up = 0);
end;
$$;
revoke all on function public.v2_fuse(bigint, bigint, bigint, boolean) from public;
revoke all on function public.v2_fuse(bigint, bigint, bigint, boolean) from anon;
grant execute on function public.v2_fuse(bigint, bigint, bigint, boolean) to authenticated;

-- ===== 動作確認用（開発限定）：守りの護符を配る =====
-- ★入手方法は未定（2026-08-16）。決まるまでは開発だけがここで増やせる
create or replace function public.v2_debug_grant_protect(p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_n int := least(greatest(coalesce(p_count, 1), 1), 99); v_have int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = v_uid;
  if not v_admin then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  update public.v2_profiles set protect_count = protect_count + v_n, updated_at = now()
   where id = v_uid returning protect_count into v_have;
  return jsonb_build_object('ok', true, 'protect_count', v_have);
end;
$$;
revoke all on function public.v2_debug_grant_protect(int) from public;
revoke all on function public.v2_debug_grant_protect(int) from anon;
grant execute on function public.v2_debug_grant_protect(int) to authenticated;

-- ===== 動作確認用（開発限定）：装備を配る =====
create or replace function public.v2_debug_grant_equip(p_rank text, p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_n int := least(greatest(coalesce(p_count,1),1), 60);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = v_uid;
  if not coalesce(v_admin, false) then return jsonb_build_object('ok', false, 'error', '開発限定の機能です'); end if;
  insert into public.v2_inventory (player_id, equip_id)
  select v_uid, e.id from (
    select id from public.v2_equipment where rank = coalesce(p_rank, 'F') order by random() limit v_n
  ) e;
  return jsonb_build_object('ok', true, 'granted', v_n);
end;
$$;
revoke all on function public.v2_debug_grant_equip(text, int) from public;
revoke all on function public.v2_debug_grant_equip(text, int) from anon;
grant execute on function public.v2_debug_grant_equip(text, int) to authenticated;

-- ===== 8. プロフィール（アイコン） =====
-- 旧版と同じ avatars バケットの画像をそのまま使う（v2で画像を増やす必要はない）
alter table public.v2_profiles add column if not exists avatar_url text;

create or replace function public.v2_set_avatar(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_url is not null and length(p_url) > 500 then
    return jsonb_build_object('ok', false, 'error', 'URLが長すぎます');
  end if;
  update public.v2_profiles set avatar_url = p_url, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'avatar_url', p_url);
end;
$$;
revoke all on function public.v2_set_avatar(text) from public;
revoke all on function public.v2_set_avatar(text) from anon;
grant execute on function public.v2_set_avatar(text) to authenticated;

-- アップロードした画像をアイコンにする（100 Gold）。
-- ★Goldの引き落としとアイコンの差し替えを1つのUPDATEでやる＝二重課金にならない
--   （旧版はクライアントから引いていて、連打ガードを手で書く必要があった）
create or replace function public.v2_upload_avatar(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_cost constant bigint := 100;
  v_uid  uuid := auth.uid();
  v_gold bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_url is null or length(p_url) > 500 then return jsonb_build_object('ok', false, 'error', 'URLが不正です'); end if;
  update public.v2_profiles set gold = gold - c_cost, avatar_url = p_url, updated_at = now()
   where id = v_uid and gold >= c_cost
   returning gold into v_gold;
  if not found then
    return jsonb_build_object('ok', false, 'error', format('Goldが足りません（%s必要）', c_cost));
  end if;
  return jsonb_build_object('ok', true, 'avatar_url', p_url, 'gold', v_gold, 'cost', c_cost);
end;
$$;
revoke all on function public.v2_upload_avatar(text) from public;
revoke all on function public.v2_upload_avatar(text) from anon;
grant execute on function public.v2_upload_avatar(text) to authenticated;


-- ============================================================
-- ===== 9. 施設「ユグレシアの宝樹」（1日1回の祈り） =====
-- ------------------------------------------------------------
-- 1日1回だけ祈れて、大凶〜大吉が引かれる。日付が変わるのは**日本時間の5時**
-- （旧版の日課と同じ区切り）。
--
-- ★抽選も回数の管理もサーバーで行う。クライアント（src/v2/components/V2Tree.jsx）は
--   結果を表示するだけで、自分では引かない。
-- ★開発（profiles.is_admin）だけ**回数制限なし**で祈れる。
--   一般公開するときもこのゲートは外さないこと。
-- ★出る確率は画面に出していない（正は src/v2/lib/tree.js の FORTUNES）。
-- ★報酬は未定（2026-08-16）。決まったら下の「報酬をここに入れる」に処理を足す。
--   いまは結果だけ返して何も配っていない。
-- ============================================================
alter table public.v2_profiles add column if not exists last_pray_at timestamptz;
alter table public.v2_profiles add column if not exists last_fortune text;
alter table public.v2_profiles add column if not exists pray_count   int   not null default 0;
-- 直近10回の結果。新しい順に [{"at":"08/16 21:03","fortune":"大吉"}, ...]
alter table public.v2_profiles add column if not exists pray_log     jsonb not null default '[]'::jsonb;

create or replace function public.v2_pray()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- ★ src/v2/lib/tree.js の FORTUNES と「並び」も「重み」も同じにすること（合計100）。
  --   片方だけ直すと、実際に引かれる確率が設計と変わる。
  c_names  constant text[] := array['大吉','中吉','小吉','吉','末吉','凶','大凶'];
  c_weight constant int[]  := array[5, 10, 15, 25, 20, 15, 10];
  c_keep   constant int    := 10;   -- 履歴として残す件数
  v_uid   uuid := auth.uid();
  v_admin boolean := false;
  v_roll  int;
  v_acc   int := 0;
  v_name  text := c_names[array_length(c_names, 1)];
  v_count int;
  v_log   jsonb;
  i       int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;

  -- 開発だけ回数制限を外す（旧版の profiles を見る）
  select coalesce(p.is_admin, false) into v_admin from public.profiles p where p.id = v_uid;

  -- 先に引く。祈れなかったときは下のUPDATEが空振りして、この結果は捨てられる
  v_roll := floor(random() * 100)::int;   -- 0〜99
  for i in 1 .. array_length(c_names, 1) loop
    v_acc := v_acc + c_weight[i];
    if v_roll < v_acc then v_name := c_names[i]; exit; end if;
  end loop;

  -- ★「まだ祈っていないこと」の確認と記録を**1文でやる**＝連打しても2回引けない。
  --   先に select して確かめる書き方だと、同時に2回叩かれたときに両方通る。
  update public.v2_profiles p
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
     and (v_admin
          or p.last_pray_at is null
          or ((p.last_pray_at at time zone 'Asia/Tokyo') - interval '5 hours')::date
           < ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date)
   returning p.pray_count, p.pray_log into v_count, v_log;

  if not found then
    return jsonb_build_object('ok', false, 'error', '今日はもう祈りました（日本時間の5時に変わります）');
  end if;

  -- デイリーミッション：実際に祈れた回だけ数える
  perform public.v2_daily_bump(v_uid, 'pray', 1);

  -- ★報酬をここに入れる（未定）。v_name（大吉〜大凶）で分けて Gold や装備を配り、
  --   配ったものを 'reward' に文字列で入れて返すと、そのまま画面に出る。
  return jsonb_build_object('ok', true, 'fortune', v_name,
                            'pray_count', v_count, 'pray_log', v_log, 'reward', null);
end;
$$;
revoke all on function public.v2_pray() from public;
revoke all on function public.v2_pray() from anon;
grant execute on function public.v2_pray() to authenticated;

-- ============================================================
-- ===== 10. エンチャント（抽出・ソケット） =====
-- 設計は docs/v2-enchant-design.md。
-- ★**抽選の権威はここ**。src/v2/lib/material.js に同じ計算の写しがあるので、
--   数式を変えるときは必ず両方を直すこと。
-- ============================================================

-- 値を1つ引く。**高い値ほど出にくい**。
--   刻みは0.1で、重みは0.1上がるごとに一定倍率で減る。
--   ⚠**倍率を全レンジ共通にしてはいけない**（段数の多いレンジで最大値が引けなくなり、
--     エリアを進む意味が消える）。「最大値の出やすさ」がどのレンジでも先頭の7.5%に
--     なるよう、レンジごとに 0.075^(1/(段数-1)) を使う。
create or replace function public.v2_roll_material_value(p_lo numeric, p_hi numeric)
returns numeric language plpgsql as $$
declare
  v_n int := round((p_hi - p_lo) / 0.1)::int + 1;
  v_ratio numeric; v_sum numeric := 0; v_r numeric; v_acc numeric := 0; i int;
begin
  if v_n <= 1 then return p_lo; end if;
  v_ratio := power(0.075, 1.0 / (v_n - 1));
  for i in 0 .. v_n - 1 loop v_sum := v_sum + power(v_ratio, i); end loop;
  v_r := random() * v_sum;
  for i in 0 .. v_n - 1 loop
    v_acc := v_acc + power(v_ratio, i);
    if v_r <= v_acc then return round(p_lo + i * 0.1, 1); end if;
  end loop;
  return p_hi;
end;
$$;
revoke all on function public.v2_roll_material_value(numeric, numeric) from public;
revoke all on function public.v2_roll_material_value(numeric, numeric) from anon;

-- 抽出。素材5個を消費してエッセンスを1つ作る
--   p_materials = 素材IDの配列（5個ちょうど。同じIDを重ねてよい）
--   ★ボス素材は1個までしか入れられない（ユニーク素材）
create or replace function public.v2_extract_essence(p_materials jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_ids   text[];
  v_id    text;
  v_mat   public.v2_materials;
  v_stats jsonb := '{}'::jsonb;
  v_keys  text[] := array['hp','mp','str','dex','agi','int_stat','vit','luk'];
  v_others text[];
  v_pick  text[];
  v_k     text;
  v_val   numeric;
  v_choices text[] := '{}'::text[];
  v_chance numeric;
  v_red numeric; v_blue numeric; v_green numeric;
  v_color text;
  v_ess   public.v2_essences;
  v_need  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  select array_agg(x #>> '{}') into v_ids from jsonb_array_elements(p_materials) x;
  if coalesce(array_length(v_ids, 1), 0) <> 5 then
    return jsonb_build_object('ok', false, 'error', '素材を5個選んでください');
  end if;
  -- ボス素材は1個まで
  if (select count(*) from unnest(v_ids) u join public.v2_materials m on m.id = u where m.is_boss) > 1 then
    return jsonb_build_object('ok', false, 'error', 'ボス素材は1個までしか入れられません');
  end if;
  -- 持っているか（同じIDを重ねて選んだぶんも数える）
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    if coalesce((select qty from public.v2_player_materials
                  where player_id = v_uid and material_id = v_id), 0) < v_need then
      return jsonb_build_object('ok', false, 'error', '素材が足りません');
    end if;
  end loop;
  -- 消費
  for v_id, v_need in select u, count(*)::int from unnest(v_ids) u group by u loop
    update public.v2_player_materials set qty = qty - v_need
     where player_id = v_uid and material_id = v_id;
  end loop;
  delete from public.v2_player_materials where player_id = v_uid and qty <= 0;

  -- 1個ずつ「型を決める → 値を引く」
  foreach v_id in array v_ids loop
    select * into v_mat from public.v2_materials where id = v_id;
    if not found then continue; end if;
    -- 型：激レアとボスは固定。雑魚の通常・レアは 70% で割り当てステ、30% でそれ以外の7種
    if v_mat.is_boss or v_mat.rarity = 'ultra' or random() * 100 < 70 then
      v_pick := v_mat.stats;
    else
      select array_agg(k) into v_others from unnest(v_keys) k where not (k = any (v_mat.stats));
      v_pick := array[v_others[1 + floor(random() * array_length(v_others, 1))::int]];
    end if;
    foreach v_k in array v_pick loop
      v_val := public.v2_roll_material_value(v_mat.lo, v_mat.hi);
      v_stats := jsonb_set(v_stats, array[v_k],
                   to_jsonb(round(coalesce((v_stats ->> v_k)::numeric, 0) + v_val, 1)));
    end loop;
    -- 特殊能力：通常0% / レア1% / 激レア3%
    v_chance := case v_mat.rarity when 'ultra' then 3 when 'rare' then 1 else 0 end;
    if v_chance > 0 and random() * 100 < v_chance and not (v_mat.enemy = any (v_choices)) then
      v_choices := array_append(v_choices, v_mat.enemy);
    end if;
  end loop;

  -- 色：合計値を3グループで合算して、一番大きいグループ
  select coalesce(sum(case when k in ('str','int_stat')  then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('hp','mp','vit')   then v::numeric else 0 end), 0),
         coalesce(sum(case when k in ('dex','agi','luk') then v::numeric else 0 end), 0)
    into v_red, v_blue, v_green
    from jsonb_each_text(v_stats) as t(k, v);
  v_color := case when v_red >= v_blue and v_red >= v_green then 'red'
                  when v_blue >= v_green then 'blue' else 'green' end;

  insert into public.v2_essences (player_id, color, stats, ability_choices)
  values (v_uid, v_color, v_stats, v_choices)
  returning * into v_ess;

  -- デイリーミッション：ルーンを1個作った
  perform public.v2_daily_bump(v_uid, 'rune', 1);

  return jsonb_build_object('ok', true, 'essence', to_jsonb(v_ess));
end;
$$;
revoke all on function public.v2_extract_essence(jsonb) from public;
revoke all on function public.v2_extract_essence(jsonb) from anon;
grant execute on function public.v2_extract_essence(jsonb) to authenticated;

-- 抽出で複数の特殊能力が当たったとき、1つを選ぶ。選び直しはできない
create or replace function public.v2_choose_ability(p_essence_id bigint, p_ability text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ess public.v2_essences;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_ess from public.v2_essences where id = p_essence_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエッセンスはありません'); end if;
  if v_ess.ability is not null then return jsonb_build_object('ok', false, 'error', 'もう選んでいます'); end if;
  if not (p_ability = any (v_ess.ability_choices)) then
    return jsonb_build_object('ok', false, 'error', 'その特殊能力は候補にありません');
  end if;
  update public.v2_essences set ability = p_ability where id = p_essence_id
  returning * into v_ess;
  return jsonb_build_object('ok', true, 'essence', to_jsonb(v_ess));
end;
$$;
revoke all on function public.v2_choose_ability(bigint, text) from public;
revoke all on function public.v2_choose_ability(bigint, text) from anon;
grant execute on function public.v2_choose_ability(bigint, text) to authenticated;

-- エッセンスを武器のソケットにはめる。**色が合う枠にしか入らない**
-- ★ふさがっている枠には**上書きできる。ただし元のエッセンスは消える**
--   （無傷で取り出したいときだけ「外す」＝専用アイテムを使う。2026-08-16 ユーザー決定）
create or replace function public.v2_socket_essence(p_essence_id bigint, p_inventory_id bigint, p_slot int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_ess public.v2_essences; v_inv public.v2_inventory;
  v_over int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_ess from public.v2_essences where id = p_essence_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエッセンスはありません'); end if;
  if v_ess.inv_id is not null then return jsonb_build_object('ok', false, 'error', 'もうはめてあります'); end if;
  select * into v_inv from public.v2_inventory where id = p_inventory_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'その装備はありません'); end if;
  if p_slot is null or p_slot < 0 or p_slot >= coalesce(array_length(v_inv.sockets, 1), 0) then
    return jsonb_build_object('ok', false, 'error', 'その枠はありません');
  end if;
  if v_inv.sockets[p_slot + 1] <> v_ess.color then
    return jsonb_build_object('ok', false, 'error', '枠の色が合いません');
  end if;
  -- ふさがっていたら上書き。**元のエッセンスは消える**
  delete from public.v2_essences
   where player_id = v_uid and inv_id = p_inventory_id and socket_idx = p_slot;
  get diagnostics v_over = row_count;
  update public.v2_essences set inv_id = p_inventory_id, socket_idx = p_slot where id = p_essence_id;
  return jsonb_build_object('ok', true, 'overwrote', v_over > 0);
end;
$$;
revoke all on function public.v2_socket_essence(bigint, bigint, int) from public;
revoke all on function public.v2_socket_essence(bigint, bigint, int) from anon;
grant execute on function public.v2_socket_essence(bigint, bigint, int) to authenticated;

-- エッセンスを外す。**専用アイテムを1個消費する**（エッセンスは無傷で戻る）
-- ⚠アイテムの名前と入手手段はまだ決まっていない（docs/v2-enchant-design.md の「残り」）
create or replace function public.v2_unsocket_essence(p_essence_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ess public.v2_essences; v_left int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_ess from public.v2_essences where id = p_essence_id and player_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエッセンスはありません'); end if;
  if v_ess.inv_id is null then return jsonb_build_object('ok', false, 'error', 'はめていません'); end if;
  update public.v2_profiles set unsocket_tickets = unsocket_tickets - 1
   where id = v_uid and unsocket_tickets > 0
  returning unsocket_tickets into v_left;
  if not found then return jsonb_build_object('ok', false, 'error', '外すためのアイテムが足りません'); end if;
  update public.v2_essences set inv_id = null, socket_idx = null where id = p_essence_id;
  return jsonb_build_object('ok', true, 'tickets', v_left);
end;
$$;
revoke all on function public.v2_unsocket_essence(bigint) from public;
revoke all on function public.v2_unsocket_essence(bigint) from anon;
grant execute on function public.v2_unsocket_essence(bigint) to authenticated;

-- 既に持っている武器にソケットを開ける
-- （この機能より前に拾った武器は sockets が空なので、1回だけ通しておく）
create or replace function public.v2_backfill_sockets()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv record; v_sock text[]; v_n int := 0; i int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  for v_inv in
    select i2.id as inv_id, e.hands from public.v2_inventory i2
      join public.v2_equipment e on e.id = i2.equip_id
     where i2.player_id = v_uid and e.part = '武器'
       and coalesce(array_length(i2.sockets, 1), 0) = 0
  loop
    v_sock := '{}'::text[];
    for i in 1 .. (case when v_inv.hands = '2' then 3 else 2 end) loop
      v_sock := array_append(v_sock, (array['red','blue','green'])[1 + floor(random() * 3)::int]);
    end loop;
    update public.v2_inventory set sockets = v_sock where id = v_inv.inv_id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'filled', v_n);
end;
$$;
revoke all on function public.v2_backfill_sockets() from public;
revoke all on function public.v2_backfill_sockets() from anon;
grant execute on function public.v2_backfill_sockets() to authenticated;

-- ===== 動作確認用（開発限定）=====
-- 素材の入手手段は出撃のドロップだけなので、確認用に is_admin だけまとめて配れるようにする
-- （外すためのアイテムも一緒に5個入れる）
create or replace function public.v2_debug_grant_material(p_area int, p_qty int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_q int := least(greatest(coalesce(p_qty,10),1), 99);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = v_uid;
  if not coalesce(v_admin, false) then return jsonb_build_object('ok', false, 'error', '開発限定の機能です'); end if;
  insert into public.v2_player_materials (player_id, material_id, qty)
  select v_uid, m.id, v_q from public.v2_materials m where m.area = coalesce(p_area, 1)
  on conflict (player_id, material_id) do update set qty = public.v2_player_materials.qty + v_q;
  update public.v2_profiles set unsocket_tickets = unsocket_tickets + 5 where id = v_uid;
  return jsonb_build_object('ok', true, 'area', coalesce(p_area, 1), 'qty', v_q);
end;
$$;
revoke all on function public.v2_debug_grant_material(int, int) from public;
revoke all on function public.v2_debug_grant_material(int, int) from anon;
grant execute on function public.v2_debug_grant_material(int, int) to authenticated;

-- ===== 素材を売る（v2で唯一Goldが湧く場所）=====
-- ★売値の権威はサーバー（v2_materials.sell）。クライアントの申告額は一切使わない。
-- ★**所持数の検証を全部済ませてから引く**。途中でエラーを返す作りにすると、
--   plpgsql は例外を投げない限りロールバックしないので**引かれた素材だけ残る**事故になる。
-- p_items … [{ "id": "m:1:0:n", "qty": 3 }, ...]（同じIDが重複していても合算して扱う）
create or replace function public.v2_sell_materials(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_kinds constant int := 300;   -- 一度に売れる種類
  c_max_qty   constant int := 99999; -- 1種類あたりの個数
  v_uid   uuid := auth.uid();
  v_req   int;      -- 送られてきた種類（qty>0 のもの）
  v_ok    int;      -- そのうち「実在して・足りている」種類
  v_total bigint;
  v_gold  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', '売るものがありません');
  end if;
  if jsonb_array_length(p_items) > c_max_kinds then
    return jsonb_build_object('ok', false, 'error', '一度に売れる数を超えています');
  end if;

  -- 検証：qty が正しいか・実在するか・足りているか
  select count(*) into v_req
    from (select r.id, sum(r.qty)::bigint as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where q.qty <= c_max_qty;
  if v_req = 0 then return jsonb_build_object('ok', false, 'error', '個数が不正です'); end if;

  select count(*), coalesce(sum(q.qty * m.sell), 0) into v_ok, v_total
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
    join public.v2_materials m on m.id = q.id
    join public.v2_player_materials pm
      on pm.player_id = v_uid and pm.material_id = q.id and pm.qty >= q.qty
   where q.qty <= c_max_qty;
  if v_ok <> v_req then
    return jsonb_build_object('ok', false, 'error', '素材が足りません');
  end if;

  -- ここから先は失敗しない（検証が通っている）
  update public.v2_player_materials pm
     set qty = pm.qty - q.qty
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where pm.player_id = v_uid and pm.material_id = q.id;

  update public.v2_profiles set gold = gold + v_total, updated_at = now()
   where id = v_uid returning gold into v_gold;

  return jsonb_build_object('ok', true, 'gained', v_total, 'gold', v_gold, 'kinds', v_ok);
end;
$$;
revoke all on function public.v2_sell_materials(jsonb) from public;
revoke all on function public.v2_sell_materials(jsonb) from anon;
grant execute on function public.v2_sell_materials(jsonb) to authenticated;

-- ============================================================
-- ===== 10. アリーナ（対人）=====
-- ------------------------------------------------------------
-- あるけみすとの「天空闘技場」と同じ仕組み（出典 wikiwiki alchemist-p /天空闘技場）。
--   ・各階に**階層守護者**（守る側）が1人。挑戦者は自分がいる階の階層守護者と戦う
--   ・勝つとその階の階層守護者になる。守っているあいだは挑戦できない
--   ・自分の階層守護者が破られると解放され、1つ上の階へ挑戦できるようになる
--   ・負けると1つ下の階へ。ただし戦闘力が足りていれば落ちない
--   ・**階層守護者のHP/MPは回復しない**。挑戦者は毎回満タン
--   ・EXPは勝敗によらず9〜13。**装備も勝敗によらず**落ちる（確率は出撃と同じ）
--   ・出撃とクールタイムを共有する（last_sortie_at を同じように更新する）
--
-- ★階層数50と、空き階に置くNPC階層守護者は wiki に無く、こちらで決めたもの
--   （NPCの中身は src/v2/lib/arena.js が持つ。サーバーは「空席」として扱うだけ）。
-- ★戦闘そのものはクライアントの runBattle が回し、ここへ結果を申告する。
--   v2の戦闘は全部この形（出撃も同じ）。**対人なので申告を信じる穴が残る**＝
--   一般公開の前にサーバー権威化の判断が要る。
-- ============================================================
alter table public.v2_profiles add column if not exists arena_floor  int not null default 1;  -- 次に挑戦する階
alter table public.v2_profiles add column if not exists arena_wins   int not null default 0;
alter table public.v2_profiles add column if not exists arena_losses int not null default 0;

-- 各階の階層守護者。行が無い階＝空席（クライアントがNPCを置く）
create table if not exists public.v2_arena_floors (
  floor      int primary key,
  player_id  uuid references auth.users(id) on delete set null,
  snapshot   jsonb not null,          -- 就いたときの姿（arena.js の snapshotOf）
  hp         int not null,            -- ★回復しない。守るたびに減っていく
  mp         int not null,
  streak     int not null default 0,  -- 連勝数（挑戦者への +5n% の元）
  since      timestamptz not null default now()
);
create index if not exists v2_arena_floors_player_idx on public.v2_arena_floors(player_id);
alter table public.v2_arena_floors enable row level security;

-- 一覧は誰でも読める（誰が何階を守っているかは公開情報）
drop policy if exists v2_arena_read on public.v2_arena_floors;
create policy v2_arena_read on public.v2_arena_floors for select to authenticated using (public.v2_is_dev());
-- 書き込みはRPCだけ（直接いじれないようにポリシーを足さない）

-- ===== 挑戦の結果を反映する =====
-- p_win        … 勝ったか
-- p_my_hp/mp   … 戦い終わったときの自分のHP/MP（勝ったら階層守護者として座る値）
-- p_foe_hp/mp  … 戦い終わったときの階層守護者のHP/MP（負けたらその値で座り直す）
-- p_snapshot   … 自分の姿（勝って階層守護者になるとき用）
-- p_exp / p_drop … クライアントが引いたEXPとドロップ（出撃と同じ形）
create or replace function public.v2_arena_fight(
  p_win boolean, p_my_hp int, p_my_mp int, p_foe_hp int, p_foe_mp int,
  p_snapshot jsonb, p_exp int, p_drop text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_floors constant int := 50;
  c_drop   constant int := 1;    -- 負けたときに落ちる階数（arena.js の LOSE_DROP と同じ）
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles%rowtype;
  v_floor int;
  v_champ public.v2_arena_floors%rowtype;
  v_next  int;
  v_exp   int := least(greatest(coalesce(p_exp, 0), 0), 13);
  v_lv    jsonb;
  v_inv   bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;

  -- ★守っているあいだは挑戦できない（wikiと同じ）
  if exists (select 1 from public.v2_arena_floors where player_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', '守っているあいだは挑戦できません');
  end if;

  v_floor := least(greatest(coalesce(v_row.arena_floor, 1), 1), c_floors);
  select * into v_champ from public.v2_arena_floors where floor = v_floor;

  if p_win then
    -- 破られた本人は「1つ上へ挑戦できる」状態に戻す（席は空ける）
    if v_champ.player_id is not null then
      update public.v2_profiles
         set arena_floor = least(c_floors, v_floor + 1),
             arena_losses = arena_losses + 1, updated_at = now()
       where id = v_champ.player_id;
    end if;
    -- 自分がその階の階層守護者になる。**HP/MPは戦い終わった値のまま座る**
    insert into public.v2_arena_floors (floor, player_id, snapshot, hp, mp, streak, since)
    values (v_floor, v_uid, coalesce(p_snapshot, '{}'::jsonb),
            greatest(1, coalesce(p_my_hp, 1)), greatest(0, coalesce(p_my_mp, 0)), 0, now())
    on conflict (floor) do update
      set player_id = excluded.player_id, snapshot = excluded.snapshot,
          hp = excluded.hp, mp = excluded.mp, streak = 0, since = now();
    v_next := v_floor;   -- 守っているので、次に挑戦する階は据え置き
    update public.v2_profiles
       set arena_wins = arena_wins + 1, last_sortie_at = now(), updated_at = now()
     where id = v_uid;
  else
    -- 負け。階層守護者は**HP/MPが減ったまま**居座り、連勝数が1つ増える
    if v_champ.floor is not null then
      update public.v2_arena_floors
         set hp = greatest(1, coalesce(p_foe_hp, hp)), mp = greatest(0, coalesce(p_foe_mp, mp)),
             streak = streak + 1
       where floor = v_floor;
      if v_champ.player_id is not null then
        update public.v2_profiles set arena_wins = arena_wins + 1, updated_at = now()
         where id = v_champ.player_id;
      end if;
    end if;
    -- 1つ下へ。**戦闘力に関係なく必ず落ちる**（2026-08-17 ユーザー決定）
    -- ⚠以前は「その戦闘力なら居ていい階より下には落ちない」とコメントしていたが、
    --   その下限はここに実装されていなかった（画面の予告表示だけが下限を計算していて
    --   ズレていた）。下限は廃止し、クライアント側の floorAfterLose も1つ下で固定した
    v_next := greatest(1, v_floor - c_drop);
    update public.v2_profiles
       set arena_losses = arena_losses + 1, last_sortie_at = now(), updated_at = now()
     where id = v_uid;
  end if;

  update public.v2_profiles set arena_floor = v_next, updated_at = now() where id = v_uid;

  -- EXPは勝敗によらず入る（保護トリガー対応で、付与は必ず v2_apply_exp を通す）
  if v_exp > 0 then v_lv := public.v2_apply_exp(v_uid, v_exp); end if;
  -- デイリーミッション：勝敗によらず「挑戦1回」として数える
  perform public.v2_daily_bump(v_uid, 'arena', 1);

  -- ★装備は**勝敗によらず**落ちる（2026-08-17 ユーザー決定）。確率は出撃と同じで、
  --   落ちるランクはどの階でも同じ表（src/v2/lib/arena.js の DROP_RANKS）
  if p_drop is not null then
    insert into public.v2_inventory (player_id, equip_id, plus)
    values (v_uid, p_drop, 0) returning id into v_inv;
  end if;

  return jsonb_build_object('ok', true, 'win', p_win, 'floor', v_floor, 'next_floor', v_next,
                            'defending', p_win, 'exp', v_exp, 'drop', p_drop,
                            'level', v_lv,
                            'profile', (select to_jsonb(p) from public.v2_profiles p where p.id = v_uid));
end;
$$;
revoke all on function public.v2_arena_fight(boolean, int, int, int, int, jsonb, int, text) from public;
revoke all on function public.v2_arena_fight(boolean, int, int, int, int, jsonb, int, text) from anon;
grant execute on function public.v2_arena_fight(boolean, int, int, int, int, jsonb, int, text) to authenticated;

-- ===== 席を降りる（守るのをやめる）=====
-- ★あるけみすとに「降りる」は無い（破られるまで上へ行けない）。人が少ないと詰むので足した。
-- 降りると**破られたときと同じ扱い**で、次は1つ上の階へ挑戦できる（2026-08-17 ユーザー決定）
create or replace function public.v2_arena_retire()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_floor int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  delete from public.v2_arena_floors where player_id = v_uid returning floor into v_floor;
  if not found then return jsonb_build_object('ok', false, 'error', 'どの階も守っていません'); end if;
  update public.v2_profiles set arena_floor = least(50, v_floor + 1), updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'floor', v_floor, 'next_floor', least(50, v_floor + 1));
end;
$$;
revoke all on function public.v2_arena_retire() from public;
revoke all on function public.v2_arena_retire() from anon;
grant execute on function public.v2_arena_retire() to authenticated;

-- ============================================================
-- ===== 11. 拠点 =====
-- ------------------------------------------------------------
-- 設計は docs/v2-kyoten-design.md。
--
--   ルーン素材を資材に交換 → 労働者をGoldで雇う → 放置で資材が貯まる
--                          → 施設を拡張（グレード1〜9）
--                             → かかしのEXPが増える
--                             → 釣り場が広がり、魚と副産物が豪華になる
--
-- ★**権威はここ**。src/v2/lib/basecamp.js と fishing.js に同じ式・同じ表の写しが
--   あるので、数字を変えるときは必ず両方を直すこと
--   （basecamp.test.js / fishing.test.js が突き合わせている）。
--
-- ★**同じ関数を2回 create しない。**「あとの節で置き換える」書き方にすると、
--   前の節を直しても何も変わらない状態ができる（LVキャップで一度踏んだ形）。
--   施設を足すときは、この節の中の関数を**その場で直す**こと。
--
-- ★蓄積は「settle方式」＝**時刻だけで決まる**（錬金部屋と同じ）。ハートビートは使わない。
--   settle を呼ぶのは **回収・拡張（上げる前）・労働者の増減（前と後）**。
--   v2_base_get は書き込まないので、画面のカウンタは同じ式でクライアントが進める。
--
-- ★維持費は**回収のときにまとめて精算する**。放置中にGoldを引く手段が無いため、
--     生産していた時間 = LEAST(経過時間, 満杯までの時間, Goldで払える時間)
--   とすることで「Goldが尽きた時点で止まっていた」を後から再現する。
--
-- ★釣り図鑑のボーナスは **v2_profiles の列に足し込まない**。図鑑
--   （v2_player_fish.first_at）から毎回算出する。足し込むと、リセットや仕様変更の
--   たびにステが壊れる（無印で「釣りボーナス消失」を起こした形と同じ根）。
-- ============================================================

-- ===== 11-1. テーブル =====
create table if not exists public.v2_base (
  player_id   uuid primary key references public.v2_profiles(id) on delete cascade,
  hired       int    not null default 0,      -- これまでに雇った通し人数（雇用費の計算用）
  fish_medals bigint not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.v2_base add column if not exists fish_medals bigint not null default 0;

create table if not exists public.v2_base_facilities (
  player_id    uuid not null references public.v2_profiles(id) on delete cascade,
  key          text not null,                 -- lumber / quarry / manaforge / scarecrow / fishing
  grade        int  not null default 1,
  workers      int  not null default 0,
  spot         int  not null default 1,       -- 釣り場だけ使う。いま釣っている釣り場エリア
  pending      numeric not null default 0,    -- 未回収（資材の個数 / EXP / 匹）。回収時に floor
  accrued_from timestamptz not null default now(),
  primary key (player_id, key)
);
alter table public.v2_base_facilities add column if not exists spot int not null default 1;

-- ★資材は player_items にも v2_inventory にも入れない（取引所・倉庫UIに波及させない）
create table if not exists public.v2_base_materials (
  player_id uuid not null references public.v2_profiles(id) on delete cascade,
  kind      text not null,                    -- wood / stone / mana
  grade     int  not null,                    -- 1〜9
  qty       int  not null default 0,
  primary key (player_id, kind, grade)
);

alter table public.v2_base            enable row level security;
alter table public.v2_base_facilities enable row level security;
alter table public.v2_base_materials  enable row level security;

-- 読むのは本人だけ。書込ポリシーは作らない＝ SECURITY DEFINER のRPC経由でしか変わらない
drop policy if exists v2_base_own on public.v2_base;
create policy v2_base_own on public.v2_base for select using (player_id = auth.uid());
drop policy if exists v2_base_fac_own on public.v2_base_facilities;
create policy v2_base_fac_own on public.v2_base_facilities for select using (player_id = auth.uid());
drop policy if exists v2_base_mat_own on public.v2_base_materials;
create policy v2_base_mat_own on public.v2_base_materials for select using (player_id = auth.uid());

grant select on public.v2_base, public.v2_base_facilities, public.v2_base_materials to authenticated;

-- ===== 11-2. 魚のマスタ（54種 × 4グレード ＝ 216枠）=====
create table if not exists public.v2_fish (
  id     text primary key,        -- f:<釣り場エリア>:<番号>:<グレードの頭文字>
  name   text not null,
  spot   int  not null,           -- 釣り場エリア 1〜9
  idx    int  not null,           -- そのエリアの中の番号 0〜5
  tier   text not null,           -- common / rare / epic / legend
  stat   text not null,           -- 図鑑ボーナスのステータス
  pct    numeric not null,        -- 図鑑ボーナス(%)
  medal  int  not null            -- 釣りメダルの枚数（釣り場エリア番号 × グレード倍率）
);

-- ★ステータスは「通し番号を str,dex,agi,int_stat,vit,luk の順で回す」割り当て。
--   **HPとMPには乗らない**（2026-08-17 ユーザー決定）。54 ÷ 6 ＝ 9 なので
--   どのステータスもちょうど9種ずつ＝全部そろえると 1ステータス +9.0%・合計 +54.0%。
--   src/v2/lib/fishing.js の DEX_STATS / buildFish と同じ並びであること
insert into public.v2_fish (id, name, spot, idx, tier, stat, pct, medal)
select 'f:' || f.spot || ':' || f.idx || ':' || t.short,
       f.name, f.spot, f.idx, t.tier,
       (array['str','dex','agi','int_stat','vit','luk'])
         [((f.spot - 1) * 6 + f.idx) % 6 + 1],
       t.pct, f.spot * t.mult
from (values
  (1,0,'ヤマメ'), (1,1,'イワナ'), (1,2,'カジカ'), (1,3,'ハヤ'), (1,4,'モロコ'), (1,5,'ニジマス'),
  (2,0,'フナ'), (2,1,'コイ'), (2,2,'ワカサギ'), (2,3,'ライギョ'), (2,4,'ナマズ'), (2,5,'テナガエビ'),
  (3,0,'アユ'), (3,1,'ウナギ'), (3,2,'ソウギョ'), (3,3,'チョウザメ'), (3,4,'カワカマス'), (3,5,'スッポン'),
  (4,0,'アジ'), (4,1,'キス'), (4,2,'メバル'), (4,3,'カサゴ'), (4,4,'ハゼ'), (4,5,'イサキ'),
  (5,0,'イシダイ'), (5,1,'クエ'), (5,2,'ウツボ'), (5,3,'イセエビ'), (5,4,'タコ'), (5,5,'アワビ'),
  (6,0,'タラ'), (6,1,'ホッケ'), (6,2,'ニシン'), (6,3,'シシャモ'), (6,4,'オヒョウ'), (6,5,'タラバガニ'),
  (7,0,'溶岩ナマズ'), (7,1,'熱鱗ドジョウ'), (7,2,'焔ビレウオ'), (7,3,'硫黄イワナ'), (7,4,'マグマウナギ'), (7,5,'火喰いザリガニ'),
  (8,0,'ラブカ'), (8,1,'チョウチンアンコウ'), (8,2,'ダイオウイカ'), (8,3,'リュウグウノツカイ'), (8,4,'オオグチボヤ'), (8,5,'シーラカンス'),
  (9,0,'雲喰いイワナ'), (9,1,'星屑メダカ'), (9,2,'天泳ぐマンタ'), (9,3,'虹鱗のドラゴンフィッシュ'), (9,4,'蒼天ウナギ'), (9,5,'神代のヌシ')
) as f(spot, idx, name)
cross join (values
  ('common','c',0.1,1), ('rare','r',0.2,3), ('epic','e',0.3,10), ('legend','l',0.4,40)
) as t(tier, short, pct, mult)
on conflict (id) do update set
  name = excluded.name, spot = excluded.spot, idx = excluded.idx, tier = excluded.tier,
  stat = excluded.stat, pct = excluded.pct, medal = excluded.medal;

alter table public.v2_fish enable row level security;
drop policy if exists v2_fish_read on public.v2_fish;
create policy v2_fish_read on public.v2_fish for select using (true);
grant select on public.v2_fish to authenticated;

-- 所持と図鑑。first_at が入っていれば図鑑に登録済み＝恒久ステータスの対象
create table if not exists public.v2_player_fish (
  player_id uuid not null references public.v2_profiles(id) on delete cascade,
  fish_id   text not null references public.v2_fish(id),
  qty       int  not null default 0,
  first_at  timestamptz,
  primary key (player_id, fish_id)
);
alter table public.v2_player_fish enable row level security;
drop policy if exists v2_player_fish_own on public.v2_player_fish;
create policy v2_player_fish_own on public.v2_player_fish for select using (player_id = auth.uid());
grant select on public.v2_player_fish to authenticated;

-- ===== 11-3. 釣りメダルの交換所 =====
-- ⚠並べるのは「ルーン素材」と「保護札」の2つだけ（2026-08-17 ユーザー決定）
create table if not exists public.v2_fish_shop (
  id      text primary key,
  label   text not null,
  cost    int  not null,        -- 釣りメダル
  kind    text not null,        -- material / protect
  payload jsonb not null default '{}'::jsonb,
  sort    int  not null default 0
);

-- ルーン素材：**難易度帯**とレア度を指定して買う。その帯のそのレア度からランダムで1個
--   （エリアも敵も指名できると激レアで色を完全に狙えてしまうため、そこは絞らない）
insert into public.v2_fish_shop (id, label, cost, kind, payload, sort)
select 'mat:' || a.tier || ':' || r.rarity,
       'エリア' || substr('①②③④⑤⑥⑦⑧', a.tier, 1) || 'の' || r.label || '素材',
       a.tier * r.cost, 'material',
       jsonb_build_object('tier', a.tier, 'rarity', r.rarity),
       a.tier * 10 + r.sort
from generate_series(1, 8) as a(tier)
cross join (values ('normal','通常',10,1), ('rare','レア',40,2), ('ultra','激レア',200,3))
  as r(rarity, label, cost, sort)
on conflict (id) do update set
  label = excluded.label, cost = excluded.cost, kind = excluded.kind,
  payload = excluded.payload, sort = excluded.sort;

insert into public.v2_fish_shop (id, label, cost, kind, payload, sort)
values ('protect', '保護札（強化の失敗を防ぐ）', 150, 'protect', '{}'::jsonb, 1)
on conflict (id) do update set label = excluded.label, cost = excluded.cost,
  kind = excluded.kind, payload = excluded.payload, sort = excluded.sort;

alter table public.v2_fish_shop enable row level security;
drop policy if exists v2_fish_shop_read on public.v2_fish_shop;
create policy v2_fish_shop_read on public.v2_fish_shop for select using (true);
grant select on public.v2_fish_shop to authenticated;

-- ===== 11-4. 内部ヘルパ =====
-- ⚠ SECURITY DEFINER の内部ヘルパは既定で PUBLIC が実行できてしまう（エンドレスタワーで
--   塞いだ穴と同じ形）。**必ず REVOKE し、さらに p_uid <> auth.uid() で例外を投げる**

-- 1時間あたりの産出。**生産施設はグレードで増えない**（上がるのは出る資材のグレードだけ）
create or replace function public.v2_base_rate(p_key text, p_grade int, p_workers int)
returns numeric language sql immutable as $$
  select case
    when p_key = 'scarecrow'
      then (array[37.5, 50, 62.5, 75, 87.5, 100, 112.5, 125, 150]::numeric[])
             [greatest(1, least(9, coalesce(p_grade, 1)))]
    when p_key = 'fishing'
      then 2::numeric + 0.5 * (greatest(1, least(9, coalesce(p_grade, 1))) - 1)
    when p_key in ('lumber', 'quarry', 'manaforge')
      then 30::numeric * greatest(0, coalesce(p_workers, 0))
    else 0::numeric
  end;
$$;

-- ★維持費は廃止（2026-08-17 ユーザー決定「労働者は買いきり」）。
--   一度でも流したことがある環境から関数を消しておく
drop function if exists public.v2_base_upkeep(text, int, int);

-- 資材1個あたりの売値(Gold)。**グレードに関係なく全部売れる**（同じ決定）。
-- ⚠ここが**Goldの2本目の湧き口**になる（1本目はルーン素材のNPC売却）。
--   目安：グレードNの資材3個 ≒ エリアNの通常素材1個。その売値のおよそ1/4に置いてある。
--   src/v2/lib/basecamp.js の MATERIAL_SELL と同じ値であること
create or replace function public.v2_base_material_sell(p_grade int)
returns int language sql immutable as $$
  select case when coalesce(p_grade, 0) between 1 and 9
    then (array[1, 2, 3, 4, 6, 8, 12, 18, 27]::int[])[p_grade]
    else 0 end;
$$;

create or replace function public.v2_base_worker_limit(p_grade int)
returns int language sql immutable as $$
  select case when coalesce(p_grade, 1) <= 3 then 1
              when coalesce(p_grade, 1) <= 6 then 2
              else 3 end;
$$;

-- 何人目かで上がる雇用費。9人を超えたら null
create or replace function public.v2_base_hire_cost(p_hired int)
returns bigint language sql immutable as $$
  select case when coalesce(p_hired, 0) between 0 and 8
    then (array[1000, 3000, 8000, 20000, 50000, 120000, 300000, 700000, 1500000]::bigint[])
           [coalesce(p_hired, 0) + 1]
    else null end;
$$;

-- 拡張コスト。グレード p_to へ上げるのに要る「グレード(p_to-1)の資材」3種の各個数とGold
create or replace function public.v2_base_upgrade_cost(p_to int)
returns jsonb language sql immutable as $$
  select case when coalesce(p_to, 0) between 2 and 9 then jsonb_build_object(
    'qty',  (array[50, 80, 130, 200, 320, 500, 800, 1300]::int[])[p_to - 1],
    'gold', (array[500, 2000, 6000, 15000, 40000, 100000, 250000, 600000]::bigint[])[p_to - 1]
  ) else null end;
$$;

-- 生産施設 → 出る資材の種類。null なら生産施設ではない（かかし・釣り場）
create or replace function public.v2_base_kind_of(p_key text)
returns text language sql immutable as $$
  select case p_key when 'lumber' then 'wood' when 'quarry' then 'stone'
                    when 'manaforge' then 'mana' else null end;
$$;

-- 1施設を settle する。**経過時間・満杯・Goldの3つで頭打ち**にして pending を進め、
-- そのぶんの維持費をGoldから引く。cap が下がっているときは超過ぶんをその場で資材へ回収する
create or replace function public.v2_base_settle(p_uid uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_cap_hours constant numeric := 8;
  v_f       public.v2_base_facilities;
  v_rate    numeric;
  v_cap     numeric;
  v_elapsed numeric;
  v_room    numeric;
  v_work    numeric;
  v_new     numeric;
  v_kind    text;
  v_over    int := 0;
begin
  -- ★本人以外は絶対に通さない（REVOKE と二重の守り）
  if p_uid is null or p_uid is distinct from auth.uid() then
    raise exception '不正な呼び出しです';
  end if;

  select * into v_f from public.v2_base_facilities
   where player_id = p_uid and key = p_key for update;
  if not found then return jsonb_build_object('ok', false); end if;

  v_rate    := public.v2_base_rate(v_f.key, v_f.grade, v_f.workers);
  v_cap     := v_rate * c_cap_hours;
  v_elapsed := greatest(0, extract(epoch from (now() - v_f.accrued_from)) / 3600.0);
  v_room    := case when v_rate > 0 then greatest(0, (v_cap - v_f.pending) / v_rate) else 0 end;
  -- ★維持費は廃止（2026-08-17 ユーザー決定「労働者は買いきり」）。
  --   生産が止まるのは**満杯になったときだけ**になった
  v_work    := least(v_elapsed, v_room);

  v_new := v_f.pending + v_rate * v_work;

  -- ★capが下がったとき（労働者を外した等）。切り捨てても凍結させてもいけないので、
  --   超過ぶんをその場で資材へ回収する。回収した量は呼び出し側が必ず画面に出すこと。
  -- ⚠**ここで先に least(v_cap, …) を掛けてはいけない。**
  --   掛けると、労働者を外して cap が0になったときに pending が0へ潰れてから
  --   超過を判定することになり、**未回収の資材が黙って消える**（実機で踏んだ）。
  v_kind := public.v2_base_kind_of(p_key);
  if v_kind is not null and v_new > v_cap then
    v_over := floor(v_new - v_cap)::int;
    if v_over > 0 then
      insert into public.v2_base_materials (player_id, kind, grade, qty)
      values (p_uid, v_kind, v_f.grade, v_over)
      on conflict (player_id, kind, grade)
        do update set qty = public.v2_base_materials.qty + v_over;
      v_new := v_new - v_over;
    end if;
  else
    -- かかし・釣り場は資材へ回収できないので、上限で頭打ちにするだけ
    v_new := least(v_cap, v_new);
  end if;

  update public.v2_base_facilities
     set pending = v_new, accrued_from = now()
   where player_id = p_uid and key = p_key;

  return jsonb_build_object('ok', true, 'hours', v_work, 'auto_collected', v_over);
end;
$$;

-- 釣り上げる（回収の中から呼ぶ）。p_count 匹ぶんを抽選し、副産物もここで抽選する
create or replace function public.v2_base_fish_haul(p_uid uuid, p_grade int, p_spot int, p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n       int := least(greatest(coalesce(p_count, 0), 0), 100);
  v_g       int := greatest(1, least(9, coalesce(p_grade, 1)));
  v_spot    int := greatest(1, least(v_g, coalesce(p_spot, 1)));
  v_mat_pct numeric := 1 + v_g;        -- 2〜10%
  v_eq_pct  numeric := 0.5 * v_g;      -- 0.5〜4.5%
  v_area_hi int := greatest(1, least(8, v_g));   -- ★ここは**難易度帯**の上限（エリアIDではない）
  v_atier   int;
  v_i       int;
  v_r       numeric;
  v_tier    text;
  v_idx     int;
  v_id      text;
  v_new     boolean;
  v_area    int;
  v_mid     text;
  v_eq      public.v2_equipment;
  v_sock    text[];
  v_j       int;
  v_rank    text;
  v_tot     numeric;
  v_pick    numeric;
  v_acc     numeric;
  v_rec     record;
  v_fish    jsonb := '{}'::jsonb;      -- { 魚ID: 匹数 }
  v_newdex  jsonb := '[]'::jsonb;
  v_mats    int := 0;
  v_eqs     int := 0;
begin
  if p_uid is null or p_uid is distinct from auth.uid() then
    raise exception '不正な呼び出しです';
  end if;

  for v_i in 1 .. v_n loop
    -- グレード（レア度）。コモン70 / レア22 / エピック7 / レジェンド1
    v_r := random() * 100;
    v_tier := case when v_r < 70 then 'c' when v_r < 92 then 'r' when v_r < 99 then 'e' else 'l' end;
    v_idx  := floor(random() * 6)::int;
    v_id   := 'f:' || v_spot || ':' || v_idx || ':' || v_tier;

    -- ★図鑑に初めて載るかどうかは**先に見る**（あとから xmax を読む書き方は分かりにくい）
    v_new := not exists(select 1 from public.v2_player_fish
                         where player_id = p_uid and fish_id = v_id);
    insert into public.v2_player_fish (player_id, fish_id, qty, first_at)
    values (p_uid, v_id, 1, now())
    on conflict (player_id, fish_id) do update
      set qty = public.v2_player_fish.qty + 1,
          first_at = coalesce(public.v2_player_fish.first_at, now());
    if v_new then
      v_newdex := v_newdex || (select to_jsonb(f) from public.v2_fish f where f.id = v_id);
    end if;
    v_fish := jsonb_set(v_fish, array[v_id],
                        to_jsonb(coalesce((v_fish ->> v_id)::int, 0) + 1), true);

    -- 副産物：ルーン素材。**釣り場グレードと同じ番号の難易度帯まで**（解放状況では縛らない）。
    --   ⚠④以降は1つの帯に複数エリアあるので「帯を引いてから、その帯の素材を1個」
    if random() * 100 < v_mat_pct then
      v_atier := 1 + floor(random() * v_area_hi)::int;
      select m.id into v_mid from public.v2_materials m
       where m.tier = v_atier order by random() limit 1;
      if v_mid is not null then
        insert into public.v2_player_materials (player_id, material_id, qty)
        values (p_uid, v_mid, 1)
        on conflict (player_id, material_id)
          do update set qty = public.v2_player_materials.qty + 1;
        v_mats := v_mats + 1;
      end if;
    end if;

    -- 副産物：装備。落ちるランクは出撃と同じ「そのエリアの drop_ranks」
    --   （同じ帯のエリアは drop_ranks も同じなので、帯の中はどのエリアを引いても同じ）
    if random() * 100 < v_eq_pct then
      v_atier := 1 + floor(random() * v_area_hi)::int;
      select a.id into v_area from public.v2_areas a where a.tier = v_atier order by random() limit 1;
      -- ★ランクは**重みで引く**（src/v2/lib/enemies.js の rollDropRank と同じ）。
      --   drop_ranks は {"F":40,"E":40,"D":20} の重み表なので、? でキーの有無だけを
      --   見て装備から一様に選ぶと、上位ランクが本来よりずっと出やすくなる
      select sum(e.value::numeric) into v_tot
        from public.v2_areas a, jsonb_each_text(a.drop_ranks) e where a.id = v_area;
      v_pick := random() * coalesce(v_tot, 0);
      v_acc  := 0;
      v_rank := null;
      for v_rec in select e.key as rank, e.value::numeric as w
                     from public.v2_areas a, jsonb_each_text(a.drop_ranks) e
                    where a.id = v_area order by e.key loop
        v_acc := v_acc + v_rec.w;
        if v_pick < v_acc then v_rank := v_rec.rank; exit; end if;
      end loop;
      if v_rank is not null then
        select e.* into v_eq from public.v2_equipment e
         where e.rank = v_rank order by random() limit 1;
      end if;
      if v_rank is not null and found then
        -- ソケットの色は出撃と同じ決め方（武器だけ・片手2枠／両手3枠・1枠ずつ 1/3）
        v_sock := '{}'::text[];
        if v_eq.part = '武器' then
          for v_j in 1 .. (case when v_eq.hands = '2' then 3 else 2 end) loop
            v_sock := array_append(v_sock, (array['red','blue','green'])[1 + floor(random() * 3)::int]);
          end loop;
        end if;
        insert into public.v2_inventory (player_id, equip_id, sockets) values (p_uid, v_eq.id, v_sock);
        v_eqs := v_eqs + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('caught', v_fish, 'new_dex', v_newdex,
                            'materials', v_mats, 'equips', v_eqs, 'count', v_n);
end;
$$;

revoke all on function public.v2_base_rate(text, int, int)   from public, anon, authenticated;
revoke all on function public.v2_base_material_sell(int)     from public, anon, authenticated;
revoke all on function public.v2_base_worker_limit(int)      from public, anon, authenticated;
revoke all on function public.v2_base_hire_cost(int)         from public, anon, authenticated;
revoke all on function public.v2_base_upgrade_cost(int)      from public, anon, authenticated;
revoke all on function public.v2_base_kind_of(text)          from public, anon, authenticated;
revoke all on function public.v2_base_settle(uuid, text)     from public, anon, authenticated;
revoke all on function public.v2_base_fish_haul(uuid, int, int, int) from public, anon, authenticated;

-- ===== 11-5. 状態の取得（書き込まない）=====
-- ⚠**STABLE を付けてはいけない。** STABLE の関数は呼び出し元の問い合わせの
--   スナップショットで動くため、v2_base_collect などが「更新したあとの状態」を
--   返そうとしても**更新前の値**が返ってしまう。書き込まないのは中身の話で、
--   volatility の指定とは別物。
create or replace function public.v2_base_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_p   public.v2_profiles;
  v_has boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_p from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;

  select exists(select 1 from public.v2_base b where b.player_id = v_uid) into v_has;

  return jsonb_build_object(
    'ok', true,
    'initialized', v_has,
    'server_now', now(),
    'gold', v_p.gold,
    'lv', v_p.lv,
    'protect_count', v_p.protect_count,
    'unlocked_areas', to_jsonb(v_p.unlocked_areas),
    'hired', coalesce((select b.hired from public.v2_base b where b.player_id = v_uid), 0),
    'medals', coalesce((select b.fish_medals from public.v2_base b where b.player_id = v_uid), 0),
    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'grade', f.grade, 'workers', f.workers, 'spot', f.spot,
               'pending', f.pending, 'accrued_from', f.accrued_from,
               'rate',   public.v2_base_rate(f.key, f.grade, f.workers),
               'cap',    public.v2_base_rate(f.key, f.grade, f.workers) * 8,

               'worker_limit', public.v2_base_worker_limit(f.grade),
               'next_cost', public.v2_base_upgrade_cost(f.grade + 1)
             ) order by f.key)
        from public.v2_base_facilities f where f.player_id = v_uid), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.kind, 'grade', m.grade, 'qty', m.qty)
                       order by m.kind, m.grade)
        from public.v2_base_materials m where m.player_id = v_uid and m.qty > 0), '[]'::jsonb),
    'fish', coalesce((
      select jsonb_agg(jsonb_build_object('id', pf.fish_id, 'qty', pf.qty, 'first_at', pf.first_at)
                       order by pf.fish_id)
        from public.v2_player_fish pf where pf.player_id = v_uid), '[]'::jsonb),
    'hire_cost', public.v2_base_hire_cost(
                   coalesce((select b.hired from public.v2_base b where b.player_id = v_uid), 0))
  );
end;
$$;
revoke all on function public.v2_base_get() from public;
revoke all on function public.v2_base_get() from anon;
grant execute on function public.v2_base_get() to authenticated;

-- ===== 11-6. 開設（冪等）=====
-- ★足りない施設だけ作るので、施設を増やしたあとに呼び直しても安全
--   （既に拠点を持っている人も、次に開いたときに新しい施設が生える）
create or replace function public.v2_base_init()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if not exists(select 1 from public.v2_profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがいません');
  end if;

  insert into public.v2_base (player_id) values (v_uid) on conflict (player_id) do nothing;
  insert into public.v2_base_facilities (player_id, key)
  select v_uid, k from unnest(array['lumber', 'quarry', 'manaforge', 'scarecrow', 'fishing']) k
  on conflict (player_id, key) do nothing;

  return public.v2_base_get();
end;
$$;
revoke all on function public.v2_base_init() from public;
revoke all on function public.v2_base_init() from anon;
grant execute on function public.v2_base_init() to authenticated;

-- ===== 11-7. 回収 =====
-- p_key が null なら全施設。かかしは v2_apply_exp を通す（LVアップ・スキル習得が走る）
-- ★LVが上限のときは**かかしを回収しない**（回収するとEXPが捨てられるため、貯めたまま残す）
create or replace function public.v2_base_collect(p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_lv constant int := 100;
  v_uid   uuid := auth.uid();
  v_lv    int;
  v_f     record;
  v_st    jsonb;
  v_take  int;
  v_kind  text;
  v_auto  int := 0;
  v_exp   int := 0;
  v_skip  boolean := false;
  v_gains jsonb := '[]'::jsonb;
  v_haul  jsonb := null;
  v_lvres jsonb := null;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select lv into v_lv from public.v2_profiles where id = v_uid;
  if v_lv is null then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;

  for v_f in select * from public.v2_base_facilities
              where player_id = v_uid and (p_key is null or key = p_key) order by key loop
    v_st   := public.v2_base_settle(v_uid, v_f.key);
    v_auto := v_auto + coalesce((v_st ->> 'auto_collected')::int, 0);

    if v_f.key = 'scarecrow' then
      if v_lv >= c_max_lv then
        v_skip := true;      -- 貯めたまま残す（回収すると捨てられるため）
      else
        select floor(pending)::int into v_take from public.v2_base_facilities
         where player_id = v_uid and key = v_f.key;
        if coalesce(v_take, 0) > 0 then
          update public.v2_base_facilities set pending = pending - v_take
           where player_id = v_uid and key = v_f.key;
          v_exp := v_exp + v_take;
        end if;
      end if;

    elsif v_f.key = 'fishing' then
      select floor(pending)::int into v_take from public.v2_base_facilities
       where player_id = v_uid and key = v_f.key;
      if coalesce(v_take, 0) > 0 then
        update public.v2_base_facilities set pending = pending - v_take
         where player_id = v_uid and key = v_f.key;
        v_haul := public.v2_base_fish_haul(v_uid, v_f.grade, v_f.spot, v_take);
      end if;

    else
      v_kind := public.v2_base_kind_of(v_f.key);
      if v_kind is not null then
        select floor(pending)::int into v_take from public.v2_base_facilities
         where player_id = v_uid and key = v_f.key;
        if coalesce(v_take, 0) > 0 then
          update public.v2_base_facilities set pending = pending - v_take
           where player_id = v_uid and key = v_f.key;
          insert into public.v2_base_materials (player_id, kind, grade, qty)
          values (v_uid, v_kind, v_f.grade, v_take)
          on conflict (player_id, kind, grade)
            do update set qty = public.v2_base_materials.qty + v_take;
          v_gains := v_gains || jsonb_build_object('key', v_f.key, 'kind', v_kind,
                                                   'grade', v_f.grade, 'qty', v_take);
        end if;
      end if;
    end if;
  end loop;

  if v_exp > 0 then v_lvres := public.v2_apply_exp(v_uid, v_exp); end if;

  return jsonb_build_object('ok', true, 'gains', v_gains, 'exp', v_exp,
                            'auto_collected', v_auto, 'lv_capped', v_skip,
                            'haul', v_haul, 'level', v_lvres, 'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_collect(text) from public;
revoke all on function public.v2_base_collect(text) from anon;
grant execute on function public.v2_base_collect(text) to authenticated;

-- ===== 11-8. 拡張 =====
create or replace function public.v2_base_upgrade(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_areas int[];
  v_f     public.v2_base_facilities;
  v_to    int;
  v_cost  jsonb;
  v_qty   int;
  v_need_gold bigint;
  v_gold  bigint;
  v_need  int;
  v_have  int;
  v_k     text;
  v_col   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select unlocked_areas into v_areas from public.v2_profiles where id = v_uid;
  if v_areas is null then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;

  -- ★**先に回収する。settle だけでは足りない。**
  --   pending は「個数」しか持っていないので、グレードを上げてから回収すると
  --   低いグレードで貯めた資材が丸ごと上のグレードに化ける（釣り場のエリア切り替えと同じ穴）。
  v_col := public.v2_base_collect(p_key);

  select * into v_f from public.v2_base_facilities
   where player_id = v_uid and key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その施設はありません'); end if;
  v_to := v_f.grade + 1;
  if v_to > 9 then return jsonb_build_object('ok', false, 'error', 'すでに最大グレードです'); end if;

  -- グレード③以降はエリアの解放（＝その手前のエリアのボス撃破）が条件
  v_need := case when v_to >= 3 then v_to - 1 else 0 end;
  if v_need > 0 and not (v_areas @> array[v_need]) then
    return jsonb_build_object('ok', false, 'error',
      'エリア' || substr('①②③④⑤⑥⑦⑧', v_need, 1) || 'の解放が必要です');
  end if;

  v_cost      := public.v2_base_upgrade_cost(v_to);
  v_qty       := (v_cost ->> 'qty')::int;
  v_need_gold := (v_cost ->> 'gold')::bigint;

  select gold into v_gold from public.v2_profiles where id = v_uid for update;
  if coalesce(v_gold, 0) < v_need_gold then
    return jsonb_build_object('ok', false, 'error', 'Goldが足りません');
  end if;

  -- 3種すべてのグレード(v_to - 1)の資材が要る
  foreach v_k in array array['wood', 'stone', 'mana'] loop
    select coalesce(qty, 0) into v_have from public.v2_base_materials
     where player_id = v_uid and kind = v_k and grade = v_to - 1;
    if coalesce(v_have, 0) < v_qty then
      return jsonb_build_object('ok', false, 'error', '資材が足りません');
    end if;
  end loop;

  update public.v2_base_materials set qty = qty - v_qty
   where player_id = v_uid and grade = v_to - 1 and kind in ('wood', 'stone', 'mana');
  update public.v2_profiles set gold = gold - v_need_gold, updated_at = now() where id = v_uid;
  update public.v2_base_facilities set grade = v_to where player_id = v_uid and key = p_key;

  return jsonb_build_object('ok', true, 'key', p_key, 'grade', v_to,
                            'cost', v_cost, 'collected', v_col, 'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_upgrade(text) from public;
revoke all on function public.v2_base_upgrade(text) from anon;
grant execute on function public.v2_base_upgrade(text) to authenticated;

-- ===== 11-9. 労働者を雇う =====
create or replace function public.v2_base_hire(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_hired int;
  v_f     public.v2_base_facilities;
  v_cost  bigint;
  v_gold  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if public.v2_base_kind_of(p_key) is null then
    return jsonb_build_object('ok', false, 'error', 'その施設には労働者を置けません');
  end if;

  -- ★先に settle（人数が変わるとレートも維持費も変わるため）
  perform public.v2_base_settle(v_uid, p_key);

  select hired into v_hired from public.v2_base where player_id = v_uid for update;
  if v_hired is null then return jsonb_build_object('ok', false, 'error', '拠点がありません'); end if;
  v_cost := public.v2_base_hire_cost(v_hired);
  if v_cost is null then return jsonb_build_object('ok', false, 'error', 'これ以上は雇えません'); end if;

  select * into v_f from public.v2_base_facilities
   where player_id = v_uid and key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その施設はありません'); end if;
  if v_f.workers >= public.v2_base_worker_limit(v_f.grade) then
    return jsonb_build_object('ok', false, 'error', 'この施設の受け入れ人数が上限です');
  end if;

  select gold into v_gold from public.v2_profiles where id = v_uid for update;
  if coalesce(v_gold, 0) < v_cost then
    return jsonb_build_object('ok', false, 'error', 'Goldが足りません');
  end if;

  update public.v2_profiles set gold = gold - v_cost, updated_at = now() where id = v_uid;
  update public.v2_base set hired = hired + 1 where player_id = v_uid;
  update public.v2_base_facilities set workers = workers + 1 where player_id = v_uid and key = p_key;

  return jsonb_build_object('ok', true, 'key', p_key, 'cost', v_cost, 'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_hire(text) from public;
revoke all on function public.v2_base_hire(text) from anon;
grant execute on function public.v2_base_hire(text) to authenticated;

-- ===== 11-10. 労働者の配置替え =====
-- ★前と後の両方で settle する。後にも回すのは、capが下がったぶんの自動回収を即座に走らせるため
create or replace function public.v2_base_move_worker(p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.v2_base_facilities;
  v_b    public.v2_base_facilities;
  v_st   jsonb;
  v_auto int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_from = p_to then return jsonb_build_object('ok', false, 'error', '同じ施設です'); end if;
  if public.v2_base_kind_of(p_from) is null or public.v2_base_kind_of(p_to) is null then
    return jsonb_build_object('ok', false, 'error', 'その施設には労働者を置けません');
  end if;

  perform public.v2_base_settle(v_uid, p_from);
  perform public.v2_base_settle(v_uid, p_to);

  select * into v_a from public.v2_base_facilities where player_id = v_uid and key = p_from for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その施設はありません'); end if;
  select * into v_b from public.v2_base_facilities where player_id = v_uid and key = p_to for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'その施設はありません'); end if;
  if v_a.workers <= 0 then return jsonb_build_object('ok', false, 'error', 'その施設に労働者がいません'); end if;
  if v_b.workers >= public.v2_base_worker_limit(v_b.grade) then
    return jsonb_build_object('ok', false, 'error', '移動先の受け入れ人数が上限です');
  end if;

  update public.v2_base_facilities set workers = workers - 1 where player_id = v_uid and key = p_from;
  update public.v2_base_facilities set workers = workers + 1 where player_id = v_uid and key = p_to;

  -- 減らした側の cap が下がるので、超過ぶんをここで資材へ回収する。
  -- ⚠**回収した量は必ず返して画面に出す**（黙って資材が増えると不審なため）
  v_st   := public.v2_base_settle(v_uid, p_from);
  v_auto := v_auto + coalesce((v_st ->> 'auto_collected')::int, 0);
  v_st   := public.v2_base_settle(v_uid, p_to);
  v_auto := v_auto + coalesce((v_st ->> 'auto_collected')::int, 0);

  return jsonb_build_object('ok', true, 'from', p_from, 'to', p_to,
                            'auto', jsonb_build_object(
                              'kind',  public.v2_base_kind_of(p_from),
                              'grade', v_a.grade,
                              'qty',   v_auto),
                            'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_move_worker(text, text) from public;
revoke all on function public.v2_base_move_worker(text, text) from anon;
grant execute on function public.v2_base_move_worker(text, text) to authenticated;

-- ===== 11-11. ルーン素材 → 資材 =====
-- エリアNの素材がグレードNの資材になる。通常3 / レア12 / 激レア60（売却と同じ 1:4:20 の比）
create or replace function public.v2_base_exchange(p_items jsonb, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_kinds constant int := 300;
  c_max_qty   constant int := 99999;
  v_uid   uuid := auth.uid();
  v_req   int;
  v_ok    int;
  v_total int := 0;
  v_gain  jsonb := '[]'::jsonb;
  v_row   record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_kind not in ('wood', 'stone', 'mana') then
    return jsonb_build_object('ok', false, 'error', '資材の種類が不正です');
  end if;
  if not exists(select 1 from public.v2_base where player_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', '拠点がありません');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', '交換するものがありません');
  end if;
  if jsonb_array_length(p_items) > c_max_kinds then
    return jsonb_build_object('ok', false, 'error', '一度に交換できる数を超えています');
  end if;

  -- 検証：個数が正しいか・実在するか・足りているか（v2_sell_materials と同じ形）
  select count(*) into v_req
    from (select r.id, sum(r.qty)::bigint as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where q.qty <= c_max_qty;
  if v_req = 0 then return jsonb_build_object('ok', false, 'error', '個数が不正です'); end if;

  select count(*) into v_ok
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
    join public.v2_materials m on m.id = q.id
    join public.v2_player_materials pm
      on pm.player_id = v_uid and pm.material_id = q.id and pm.qty >= q.qty
   where q.qty <= c_max_qty;
  if v_ok <> v_req then return jsonb_build_object('ok', false, 'error', '素材が足りません'); end if;

  -- ここから先は失敗しない（検証が通っている）
  update public.v2_player_materials pm
     set qty = pm.qty - q.qty
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where pm.player_id = v_uid and pm.material_id = q.id;

  for v_row in
    -- ★グレードは**難易度帯**の番号（④の帯の素材はどのエリアでもグレード4の資材になる）
    select m.tier as grade,
           sum(q.qty * case m.rarity when 'normal' then 3 when 'rare' then 12 else 60 end)::int as qty
      from (select r.id, sum(r.qty)::int as qty
              from jsonb_to_recordset(p_items) as r(id text, qty int)
             where r.id is not null and coalesce(r.qty, 0) > 0
             group by r.id) q
      join public.v2_materials m on m.id = q.id
     group by m.tier order by m.tier
  loop
    insert into public.v2_base_materials (player_id, kind, grade, qty)
    values (v_uid, p_kind, v_row.grade, v_row.qty)
    on conflict (player_id, kind, grade)
      do update set qty = public.v2_base_materials.qty + v_row.qty;
    v_gain  := v_gain || jsonb_build_object('grade', v_row.grade, 'qty', v_row.qty);
    v_total := v_total + v_row.qty;
  end loop;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'gained', v_gain, 'total', v_total,
                            'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_exchange(jsonb, text) from public;
revoke all on function public.v2_base_exchange(jsonb, text) from anon;
grant execute on function public.v2_base_exchange(jsonb, text) to authenticated;

-- ===== 11-11b. 資材 → Gold =====
-- ★**グレードに関係なく全部売れる**（2026-08-17 ユーザー決定）。
--   これがないと、最終グレードの施設が出す資材（木材Ⅸなど）に使い道が無くなる。
-- ⚠これは**Goldの2本目の湧き口**。1本目のルーン素材の売却と合わせて、
--   v2のインフレはこの2つの蛇口で決まる（docs/v2-gold-design.md）。値は調整前提。
create or replace function public.v2_base_sell_materials(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_kinds constant int := 60;      -- 3種 × 9グレード ＝ 27 なので十分
  c_max_qty   constant int := 9999999;
  v_uid   uuid := auth.uid();
  v_req   int;
  v_ok    int;
  v_total bigint;
  v_gold  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', '売るものがありません');
  end if;
  if jsonb_array_length(p_items) > c_max_kinds then
    return jsonb_build_object('ok', false, 'error', '一度に売れる数を超えています');
  end if;

  -- 検証を全部済ませてから引く（plpgsql は return でロールバックしない）
  select count(*) into v_req
    from (select r.kind, r.grade, sum(r.qty)::bigint as qty
            from jsonb_to_recordset(p_items) as r(kind text, grade int, qty int)
           where r.kind in ('wood', 'stone', 'mana')
             and r.grade between 1 and 9 and coalesce(r.qty, 0) > 0
           group by r.kind, r.grade) q
   where q.qty <= c_max_qty;
  if v_req = 0 then return jsonb_build_object('ok', false, 'error', '個数が不正です'); end if;

  select count(*), coalesce(sum(q.qty::bigint * public.v2_base_material_sell(q.grade)), 0)
    into v_ok, v_total
    from (select r.kind, r.grade, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(kind text, grade int, qty int)
           where r.kind in ('wood', 'stone', 'mana')
             and r.grade between 1 and 9 and coalesce(r.qty, 0) > 0
           group by r.kind, r.grade) q
    join public.v2_base_materials bm
      on bm.player_id = v_uid and bm.kind = q.kind and bm.grade = q.grade and bm.qty >= q.qty
   where q.qty <= c_max_qty;
  if v_ok <> v_req then return jsonb_build_object('ok', false, 'error', '資材が足りません'); end if;

  update public.v2_base_materials bm
     set qty = bm.qty - q.qty
    from (select r.kind, r.grade, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(kind text, grade int, qty int)
           where r.kind in ('wood', 'stone', 'mana')
             and r.grade between 1 and 9 and coalesce(r.qty, 0) > 0
           group by r.kind, r.grade) q
   where bm.player_id = v_uid and bm.kind = q.kind and bm.grade = q.grade;

  update public.v2_profiles set gold = gold + v_total, updated_at = now()
   where id = v_uid returning gold into v_gold;

  return jsonb_build_object('ok', true, 'gained', v_total, 'gold', v_gold,
                            'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_sell_materials(jsonb) from public;
revoke all on function public.v2_base_sell_materials(jsonb) from anon;
grant execute on function public.v2_base_sell_materials(jsonb) to authenticated;

-- ===== 11-12. 釣り場エリアを選ぶ =====
-- ⚠**切り替える前に必ず釣り上げる。** pending は「匹数」しか持っていないので、
--   settle するだけでは足りない（第1エリアで8時間ぶん貯めてから第9エリアへ替えると、
--   全部が第9エリアの魚として釣れてしまう＝メダルが最大40倍まで化ける穴）。
create or replace function public.v2_base_set_spot(p_spot int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_grade int; v_col jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;

  select grade into v_grade from public.v2_base_facilities
   where player_id = v_uid and key = 'fishing';
  if v_grade is null then return jsonb_build_object('ok', false, 'error', '釣り場がありません'); end if;
  if coalesce(p_spot, 0) < 1 or p_spot > v_grade then
    return jsonb_build_object('ok', false, 'error', 'その釣り場はまだ解放されていません');
  end if;

  -- いまのエリアぶんを先に釣り上げてから切り替える
  v_col := public.v2_base_collect('fishing');

  update public.v2_base_facilities set spot = p_spot where player_id = v_uid and key = 'fishing';
  return jsonb_build_object('ok', true, 'spot', p_spot, 'collected', v_col,
                            'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_base_set_spot(int) from public;
revoke all on function public.v2_base_set_spot(int) from anon;
grant execute on function public.v2_base_set_spot(int) to authenticated;

-- ===== 11-13. 魚 → 釣りメダル =====
-- ★図鑑への登録は「初めて釣った瞬間」に済んでいるので、**全部メダルにしてよい**
create or replace function public.v2_fish_to_medal(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_max_kinds constant int := 300;
  c_max_qty   constant int := 999999;
  v_uid   uuid := auth.uid();
  v_req   int;
  v_ok    int;
  v_total bigint;
  v_have  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if not exists(select 1 from public.v2_base where player_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', '拠点がありません');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', '交換するものがありません');
  end if;
  if jsonb_array_length(p_items) > c_max_kinds then
    return jsonb_build_object('ok', false, 'error', '一度に交換できる数を超えています');
  end if;

  -- 検証を全部済ませてから引く（plpgsql は return でロールバックしない）
  select count(*) into v_req
    from (select r.id, sum(r.qty)::bigint as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where q.qty <= c_max_qty;
  if v_req = 0 then return jsonb_build_object('ok', false, 'error', '個数が不正です'); end if;

  select count(*), coalesce(sum(q.qty * f.medal), 0) into v_ok, v_total
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
    join public.v2_fish f on f.id = q.id
    join public.v2_player_fish pf
      on pf.player_id = v_uid and pf.fish_id = q.id and pf.qty >= q.qty
   where q.qty <= c_max_qty;
  if v_ok <> v_req then return jsonb_build_object('ok', false, 'error', '魚が足りません'); end if;

  update public.v2_player_fish pf
     set qty = pf.qty - q.qty
    from (select r.id, sum(r.qty)::int as qty
            from jsonb_to_recordset(p_items) as r(id text, qty int)
           where r.id is not null and coalesce(r.qty, 0) > 0
           group by r.id) q
   where pf.player_id = v_uid and pf.fish_id = q.id;

  update public.v2_base set fish_medals = fish_medals + v_total
   where player_id = v_uid returning fish_medals into v_have;

  return jsonb_build_object('ok', true, 'gained', v_total, 'medals', v_have,
                            'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_fish_to_medal(jsonb) from public;
revoke all on function public.v2_fish_to_medal(jsonb) from anon;
grant execute on function public.v2_fish_to_medal(jsonb) to authenticated;

-- ===== 11-14. メダルで交換する =====
create or replace function public.v2_fish_shop_buy(p_id text, p_qty int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_n     int := least(greatest(coalesce(p_qty, 1), 1), 99);
  v_row   public.v2_fish_shop;
  v_cost  bigint;
  v_have  bigint;
  v_area  int;
  v_rar   text;
  v_mid   text;
  v_i     int;
  v_got   jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_fish_shop where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'その品はありません'); end if;
  if v_row.kind not in ('material', 'protect') then
    return jsonb_build_object('ok', false, 'error', 'その品はまだ配れません');
  end if;

  v_cost := v_row.cost::bigint * v_n;
  select fish_medals into v_have from public.v2_base where player_id = v_uid for update;
  if v_have is null then return jsonb_build_object('ok', false, 'error', '拠点がありません'); end if;
  if v_have < v_cost then return jsonb_build_object('ok', false, 'error', '釣りメダルが足りません'); end if;

  -- 検証が済んでいるのでここから先は必ず配れる
  update public.v2_base set fish_medals = fish_medals - v_cost
   where player_id = v_uid returning fish_medals into v_have;

  if v_row.kind = 'protect' then
    update public.v2_profiles set protect_count = protect_count + v_n, updated_at = now()
     where id = v_uid;
    v_got := jsonb_build_array(jsonb_build_object('label', v_row.label, 'qty', v_n));

  else
    -- ★payload は難易度帯（'tier'）。'area' は帯を分ける前の古い行のための読み替え
    v_area := coalesce((v_row.payload ->> 'tier')::int, (v_row.payload ->> 'area')::int);
    v_rar  := v_row.payload ->> 'rarity';
    for v_i in 1 .. v_n loop
      -- ★その帯のそのレア度から**ランダムで1個**（エリアも敵も指名させない）
      select m.id into v_mid from public.v2_materials m
       where m.tier = v_area and m.rarity = v_rar order by random() limit 1;
      exit when v_mid is null;
      insert into public.v2_player_materials (player_id, material_id, qty)
      values (v_uid, v_mid, 1)
      on conflict (player_id, material_id)
        do update set qty = public.v2_player_materials.qty + 1;
      v_got := v_got || jsonb_build_object('id', v_mid,
                 'name', (select name from public.v2_materials where id = v_mid));
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'spent', v_cost, 'medals', v_have,
                            'got', v_got, 'base', public.v2_base_get());
end;
$$;
revoke all on function public.v2_fish_shop_buy(text, int) from public;
revoke all on function public.v2_fish_shop_buy(text, int) from anon;
grant execute on function public.v2_fish_shop_buy(text, int) to authenticated;

-- ===== 11-15. 開発用のリセット =====
-- ⚠ is_admin 限定。**一般公開したあともこの判定は外さない**
create or replace function public.v2_base_dev_reset()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not coalesce((select p.is_admin from public.profiles p where p.id = v_uid), false) then
    return jsonb_build_object('ok', false, 'error', '開発限定です');
  end if;
  delete from public.v2_player_fish     where player_id = v_uid;
  delete from public.v2_base_materials  where player_id = v_uid;
  delete from public.v2_base_facilities where player_id = v_uid;
  delete from public.v2_base            where player_id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.v2_base_dev_reset() from public;
revoke all on function public.v2_base_dev_reset() from anon;
grant execute on function public.v2_base_dev_reset() to authenticated;

-- ============================================================
-- ===== 11. デイリーミッション =====
-- ------------------------------------------------------------
-- 1日1組。**難易度を2つから選ぶ**（毎日の最初のログインで選ぶ）。
-- 4つ（出撃／アリーナ挑戦／ルーン作成／祈る）を全部こなすとEXPとGoldをもらえる。
--   easy   … 20 / 1 / 1 / 1 → EXP+60・100G
--   normal … 50 / 5 / 3 / 1 → EXP+180・300G
--
-- ★日付が変わるのは**日本時間の5時**（宝樹と同じ）。
-- ★数える権威はサーバー。出撃・アリーナ・抽出・祈るの各RPCが v2_daily_bump を呼ぶ。
--   数字の正は src/v2/lib/daily.js（LEVELS）。片方だけ直すとズレる。
-- ★**難易度を選ぶ前でも数える**（あとから選んでも進捗を捨てない）。
-- ============================================================
alter table public.v2_profiles add column if not exists daily_day     date;
alter table public.v2_profiles add column if not exists daily_level   text;
alter table public.v2_profiles add column if not exists daily_counts  jsonb   not null default '{}'::jsonb;
alter table public.v2_profiles add column if not exists daily_claimed boolean not null default false;

-- ===== 内部ヘルパ：日付が変わっていたら今日ぶんに切り替える =====
-- ⚠SECURITY DEFINER の内部ヘルパは既定で PUBLIC 実行可なので、必ず REVOKE する
--   （旧版で protect_stats を迂回できた穴と同じ）。RPCからだけ呼ぶ。
create or replace function public.v2_daily_roll(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date;
begin
  update public.v2_profiles
     set daily_day = v_today, daily_level = null,
         daily_counts = '{}'::jsonb, daily_claimed = false, updated_at = now()
   where id = p_player and daily_day is distinct from v_today;
end;
$$;
revoke all on function public.v2_daily_roll(uuid) from public;
revoke all on function public.v2_daily_roll(uuid) from anon;
revoke all on function public.v2_daily_roll(uuid) from authenticated;

-- ===== 内部ヘルパ：進み具合を数える =====
-- p_key は 'sortie' / 'arena' / 'rune' / 'pray'（daily.js の TASK_KEYS）
create or replace function public.v2_daily_bump(p_player uuid, p_key text, p_n int default 1)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_player is null or p_key is null or coalesce(p_n, 0) <= 0 then return; end if;
  if p_key not in ('sortie', 'arena', 'rune', 'pray') then return; end if;
  perform public.v2_daily_roll(p_player);
  update public.v2_profiles
     set daily_counts = jsonb_set(coalesce(daily_counts, '{}'::jsonb), array[p_key],
           to_jsonb(coalesce((daily_counts ->> p_key)::int, 0) + p_n), true),
         updated_at = now()
   where id = p_player;
end;
$$;
revoke all on function public.v2_daily_bump(uuid, text, int) from public;
revoke all on function public.v2_daily_bump(uuid, text, int) from anon;
revoke all on function public.v2_daily_bump(uuid, text, int) from authenticated;

-- ===== 難易度を選ぶ =====
-- ★一度選んだら、その日は変えられない（かんたんで受け取ってからふつうへ、を防ぐ）
create or replace function public.v2_daily_pick(p_level text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cur text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_level not in ('easy', 'normal') then return jsonb_build_object('ok', false, 'error', '難易度が不正です'); end if;

  perform public.v2_daily_roll(v_uid);
  select daily_level into v_cur from public.v2_profiles where id = v_uid;
  if v_cur is not null then
    return jsonb_build_object('ok', false, 'error', '今日の難易度はもう選びました', 'level', v_cur);
  end if;

  update public.v2_profiles set daily_level = p_level, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'level', p_level,
                            'profile', (select to_jsonb(p) from public.v2_profiles p where p.id = v_uid));
end;
$$;
revoke all on function public.v2_daily_pick(text) from public;
revoke all on function public.v2_daily_pick(text) from anon;
grant execute on function public.v2_daily_pick(text) to authenticated;

-- ===== 報酬を受け取る =====
-- ★達成の判定も報酬もサーバーが決める（クライアントは金額を送らない）。
--   数字は src/v2/lib/daily.js の LEVELS と同じにすること。
create or replace function public.v2_daily_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_lv    text;
  v_c     jsonb;
  v_exp   int;
  v_gold  bigint;
  v_ok    boolean;
  v_res   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  perform public.v2_daily_roll(v_uid);

  select daily_level, coalesce(daily_counts, '{}'::jsonb) into v_lv, v_c
    from public.v2_profiles where id = v_uid;
  if v_lv is null then return jsonb_build_object('ok', false, 'error', '難易度を選んでください'); end if;

  -- ★ src/v2/lib/daily.js の LEVELS と同じ数字
  if v_lv = 'easy' then
    v_ok := coalesce((v_c ->> 'sortie')::int, 0) >= 20
        and coalesce((v_c ->> 'arena')::int, 0)  >= 1
        and coalesce((v_c ->> 'rune')::int, 0)   >= 1
        and coalesce((v_c ->> 'pray')::int, 0)   >= 1;
    v_exp := 60;  v_gold := 100;
  else
    v_ok := coalesce((v_c ->> 'sortie')::int, 0) >= 50
        and coalesce((v_c ->> 'arena')::int, 0)  >= 5
        and coalesce((v_c ->> 'rune')::int, 0)   >= 3
        and coalesce((v_c ->> 'pray')::int, 0)   >= 1;
    v_exp := 180; v_gold := 300;
  end if;
  if not v_ok then return jsonb_build_object('ok', false, 'error', 'まだ達成していない項目があります'); end if;

  -- ★受け取り済みにするのと同じ1文で弾く＝連打しても二重に受け取れない
  update public.v2_profiles
     set daily_claimed = true, gold = gold + v_gold, updated_at = now()
   where id = v_uid and daily_claimed = false;
  if not found then return jsonb_build_object('ok', false, 'error', '今日はもう受け取りました'); end if;

  -- EXPの付与は必ず v2_apply_exp を通す（保護トリガー対応）
  v_res := public.v2_apply_exp(v_uid, v_exp);

  return jsonb_build_object('ok', true, 'level', v_lv, 'exp', v_exp, 'gold', v_gold,
                            'level_up', v_res,
                            'profile', (select to_jsonb(p) from public.v2_profiles p where p.id = v_uid));
end;
$$;
revoke all on function public.v2_daily_claim() from public;
revoke all on function public.v2_daily_claim() from anon;
grant execute on function public.v2_daily_claim() to authenticated;

-- ============================================================
-- ===== 12. 武器の進化（戦闘記憶）=====
-- ------------------------------------------------------------
-- シャングリラ・フロンティア風。**その武器で戦い続けると熟練度が貯まり、節目で
-- 「どう戦ってきたか」に応じた能力が1つ付く。**
-- 設計とスコアの正は src/v2/lib/evolve.js ／ 能力の名簿は src/v2/lib/evolveTraits.js。
--   ・熟練度が貯まるのは**装備している武器だけ**（右手・左手それぞれ独立）
--   ・ルーンの刻印とは別枠（ソケットを食わない）
--   ・★武器は**レベル**で育つ。攻撃が当たるたび経験値+1、100で1レベル
--   ・覚醒できるのは LV300 / LV1000 / LV2000、値の予算は 6 / 10 / 15%
--   ・能力は163種。得1〜2個＋代償0〜1個の組み合わせでできている
--
-- ⚠戦闘そのものはクライアントが回すので、戦績もクライアントから送られてくる。
--   **1戦あたりの増分をサーバー側で頭打ちにする**ことで、でたらめな値を積めなくする。
--   さらに**能力の値はサーバーが計算し直す**（クライアントが送るのは
--   「どの能力か」と「偏りの強さ(0〜1)」だけ）＝値そのものは盛れない。
--   戦闘をサーバー権威化するときは、この検証ごと本物の計算へ差し替えること。
-- ============================================================
alter table public.v2_inventory add column if not exists record     jsonb not null default '{}'::jsonb;
alter table public.v2_inventory add column if not exists evolutions jsonb not null default '[]'::jsonb;

-- ---- 能力の名簿（src/v2/lib/evolveTraits.js から生成。手で書き換えないこと）----
-- atoms … [{"a":部品, "w":倍率, "c":代償か}]。値 = 段階の予算 × 偏りの強さ × w
create table if not exists public.v2_evolve_traits (
  key   text primary key,
  axis  text not null,
  name  text not null,
  atoms jsonb not null
);
alter table public.v2_evolve_traits enable row level security;
drop policy if exists "v2_evolve_traits_read" on public.v2_evolve_traits;
create policy "v2_evolve_traits_read" on public.v2_evolve_traits for select to authenticated using (true);
revoke all on table public.v2_evolve_traits from anon;
grant select on table public.v2_evolve_traits to authenticated;

delete from public.v2_evolve_traits;
insert into public.v2_evolve_traits (key, axis, name, atoms) values
  ('crit_eye','crit','見切りの冴え','[{"a":"critRate","w":0.9,"c":false}]'),
  ('crit_blood','crit','紅蓮の一閃','[{"a":"critDmg","w":3,"c":false},{"a":"critHpCost","w":0.18,"c":true}]'),
  ('crit_fang','crit','吸血の牙','[{"a":"critHpHeal","w":0.22,"c":false},{"a":"critDmg","w":1.2,"c":false}]'),
  ('crit_mana','crit','魔喰らいの刃','[{"a":"critMpHeal","w":0.45,"c":false},{"a":"critRate","w":0.4,"c":false},{"a":"mpCost","w":0.7,"c":true}]'),
  ('crit_gash','crit','裂傷の太刀','[{"a":"critAil","w":2.6,"c":false},{"a":"ailDmg","w":1.2,"c":false}]'),
  ('crit_focus','crit','一点集中','[{"a":"critRate","w":1.6,"c":false},{"a":"hit","w":0.9,"c":true}]'),
  ('crit_reckless','crit','捨て身の閃き','[{"a":"critDmg","w":2.6,"c":false},{"a":"taken","w":0.9,"c":true}]'),
  ('crit_luck','crit','幸運の刃','[{"a":"st_luk","w":0.8,"c":false}]'),
  ('crit_burn','crit','魔焼きの刃','[{"a":"critDmg","w":2.2,"c":false},{"a":"critMpCost","w":0.5,"c":true}]'),
  ('eva_thin','eva','紙一重','[{"a":"eva","w":0.8,"c":false}]'),
  ('eva_wind','eva','風纏い','[{"a":"eva","w":0.5,"c":false},{"a":"st_agi","w":0.6,"c":false}]'),
  ('eva_counter','eva','見切り返し','[{"a":"dmgDodge","w":2.6,"c":false}]'),
  ('eva_breath','eva','呼吸の間','[{"a":"onDodgeHeal","w":0.1,"c":false},{"a":"eva","w":0.4,"c":false}]'),
  ('eva_accel','eva','加速の舞','[{"a":"onDodgeAgi","w":0.5,"c":false}]'),
  ('eva_paper','eva','薄紙の構え','[{"a":"eva","w":1.3,"c":false},{"a":"st_vit","w":0.8,"c":true}]'),
  ('eva_last','eva','際の見切り','[{"a":"evaLow","w":2.2,"c":false}]'),
  ('tank_iron','tank','鉄壁の体','[{"a":"cut","w":0.7,"c":false}]'),
  ('tank_scale','tank','逆鱗','[{"a":"dmgHurt","w":2.4,"c":false}]'),
  ('tank_rage','tank','痛みの糧','[{"a":"onHurtStr","w":0.5,"c":false}]'),
  ('tank_mana','tank','痛撃転化','[{"a":"onHurtMp","w":0.5,"c":false}]'),
  ('tank_guts','tank','不屈','[{"a":"guts","w":2.2,"c":false}]'),
  ('tank_wall','tank','重甲','[{"a":"cut","w":1.1,"c":false},{"a":"st_agi","w":0.9,"c":true}]'),
  ('tank_endure','tank','耐えの構え','[{"a":"cutLow","w":2.4,"c":false}]'),
  ('tank_flesh','tank','肉厚','[{"a":"st_hp","w":0.9,"c":false},{"a":"st_agi","w":0.5,"c":true}]'),
  ('ail_venom','ail','蝕みの刃','[{"a":"ailRate","w":1,"c":false}]'),
  ('ail_rot','ail','腐蝕','[{"a":"ailDmg","w":1.8,"c":false}]'),
  ('ail_hunt','ail','病み狩り','[{"a":"dmgAil","w":2.2,"c":false}]'),
  ('ail_leech','ail','疫の恵み','[{"a":"ailDrain","w":0.22,"c":false}]'),
  ('ail_plague','ail','疫禍','[{"a":"ailRate","w":1.6,"c":false},{"a":"heal","w":0.9,"c":true}]'),
  ('ail_curse','ail','呪詛返し','[{"a":"ailRate","w":0.7,"c":false},{"a":"ailDmg","w":0.9,"c":false}]'),
  ('ailed_ward','ailed','慣れた痛み','[{"a":"ailResist","w":1.2,"c":false}]'),
  ('ailed_will','ailed','毒に慣れた体','[{"a":"ailResist","w":0.7,"c":false},{"a":"regen","w":0.18,"c":false}]'),
  ('ailed_pain','ailed','痛みを喰う','[{"a":"dmgLow","w":1.8,"c":false},{"a":"ailWeak","w":0.8,"c":true}]'),
  ('ailed_sacr','ailed','供物の刃','[{"a":"dmg","w":1.1,"c":false},{"a":"ailWeak","w":1,"c":true}]'),
  ('ailed_purge','ailed','浄化の呼吸','[{"a":"heal","w":1.4,"c":false},{"a":"ailResist","w":0.5,"c":false}]'),
  ('ailed_blood','ailed','毒血の巡り','[{"a":"regen","w":0.3,"c":false},{"a":"taken","w":1.4,"c":true}]'),
  ('heal_grace','heal','癒しの手','[{"a":"heal","w":1.2,"c":false}]'),
  ('heal_light','heal','治癒の光','[{"a":"heal","w":0.8,"c":false},{"a":"regen","w":0.15,"c":false}]'),
  ('heal_pray','heal','祈りの刃','[{"a":"heal","w":1.6,"c":false},{"a":"dmg","w":0.5,"c":true}]'),
  ('heal_flow','heal','生命の巡り','[{"a":"regen","w":0.3,"c":false}]'),
  ('heal_mend','heal','手当ての心得','[{"a":"heal","w":0.7,"c":false},{"a":"mpCost","w":0.6,"c":false}]'),
  ('heal_zeal','heal','献身','[{"a":"heal","w":1,"c":false},{"a":"st_int_stat","w":0.5,"c":false},{"a":"st_str","w":0.8,"c":true}]'),
  ('buff_rite','buff','高揚の儀','[{"a":"proc","w":0.7,"c":false}]'),
  ('buff_echo','buff','重ねがけ','[{"a":"dmgCombo","w":0.35,"c":false}]'),
  ('buff_focus','buff','集中の型','[{"a":"st_str","w":0.5,"c":false},{"a":"st_int_stat","w":0.5,"c":false},{"a":"st_vit","w":0.8,"c":true}]'),
  ('buff_swift','buff','疾走の型','[{"a":"extra","w":0.7,"c":false}]'),
  ('buff_rise','buff','高まる刃','[{"a":"dmgLate","w":1.4,"c":false}]'),
  ('buff_ready','buff','支度の妙','[{"a":"mpCost","w":0.8,"c":false}]'),
  ('mp_font','mpBurn','魔力の泉','[{"a":"mpRegen","w":0.5,"c":false}]'),
  ('mp_thrift','mpBurn','節制','[{"a":"mpCost","w":1,"c":false}]'),
  ('mp_burst','mpBurn','燃焼','[{"a":"dmgSkill","w":1.2,"c":false},{"a":"mpCost","w":0.8,"c":true}]'),
  ('mp_drain','mpBurn','魔喰い','[{"a":"onHitMp","w":0.12,"c":false}]'),
  ('mp_last','mpBurn','最後の一滴','[{"a":"dmgLate","w":1.5,"c":false},{"a":"mpRegen","w":0.25,"c":false}]'),
  ('mp_over','mpBurn','過負荷','[{"a":"dmg","w":1.2,"c":false},{"a":"st_mp","w":1.2,"c":true}]'),
  ('th_basic','thrift','素振りの積み','[{"a":"dmgNormal","w":1.8,"c":false}]'),
  ('th_flow','thrift','淀みなき手','[{"a":"dmgNormal","w":1.2,"c":false},{"a":"hit","w":0.5,"c":false}]'),
  ('th_sharp','thrift','研ぎ澄まし','[{"a":"dmgNormal","w":2.4,"c":false},{"a":"dmgSkill","w":0.8,"c":true}]'),
  ('th_quick','thrift','手数の妙','[{"a":"extra","w":0.6,"c":false},{"a":"dmgNormal","w":0.8,"c":false}]'),
  ('th_read','thrift','見切りの手','[{"a":"critRate","w":0.6,"c":false},{"a":"dmgNormal","w":1,"c":false}]'),
  ('th_stance','thrift','自然体','[{"a":"cut","w":0.5,"c":false},{"a":"dmgNormal","w":1,"c":false}]'),
  ('th_hand','thrift','手癖','[{"a":"st_dex","w":0.8,"c":false}]'),
  ('ph_edge','phys','鋭刃','[{"a":"dmgPhys","w":1,"c":false}]'),
  ('ph_might','phys','剛力','[{"a":"st_str","w":0.8,"c":false}]'),
  ('ph_pierce','phys','貫き手','[{"a":"defPen","w":1.2,"c":false}]'),
  ('ph_heavy','phys','重い一撃','[{"a":"dmgPhys","w":1.5,"c":false},{"a":"dmgMag","w":1.2,"c":true}]'),
  ('ph_grind','phys','削りの型','[{"a":"dmgPhys","w":0.6,"c":false},{"a":"cutPhys","w":0.8,"c":false}]'),
  ('ph_blood','phys','血振り','[{"a":"drain","w":0.45,"c":false}]'),
  ('mg_flow','mag','魔導の理','[{"a":"dmgMag","w":1,"c":false}]'),
  ('mg_mind','mag','深智','[{"a":"st_int_stat","w":0.8,"c":false}]'),
  ('mg_break','mag','術式貫通','[{"a":"defPen","w":1.2,"c":false}]'),
  ('mg_burst','mag','増幅術式','[{"a":"dmgMag","w":1.5,"c":false},{"a":"dmgPhys","w":1.2,"c":true}]'),
  ('mg_ward','mag','魔よけ','[{"a":"dmgMag","w":0.6,"c":false},{"a":"cutMag","w":0.8,"c":false}]'),
  ('mg_font','mag','詠唱の巡り','[{"a":"mpRegen","w":0.4,"c":false},{"a":"dmgMag","w":0.6,"c":false}]'),
  ('mu_storm','multi','乱れ撃ち','[{"a":"dmgMulti","w":1.8,"c":false}]'),
  ('mu_rhythm','multi','刻みの型','[{"a":"dmgMulti","w":1.1,"c":false},{"a":"hit","w":0.5,"c":false}]'),
  ('mu_bleed','multi','千の裂傷','[{"a":"critAil","w":2,"c":false},{"a":"dmgMulti","w":0.9,"c":false}]'),
  ('mu_leech','multi','削り取り','[{"a":"onHitHeal","w":0.09,"c":false}]'),
  ('mu_mana','multi','連撃の余韻','[{"a":"onHitMp","w":0.1,"c":false}]'),
  ('mu_press','multi','手数の圧','[{"a":"dmgMulti","w":2.4,"c":false},{"a":"hit","w":0.8,"c":true}]'),
  ('sw_blitz','swift','疾き刃','[{"a":"dmgFirst","w":1.5,"c":false}]'),
  ('sw_first','swift','先の先','[{"a":"first","w":1.6,"c":false}]'),
  ('sw_rush','swift','突撃','[{"a":"dmgFirst","w":2,"c":false},{"a":"taken","w":1,"c":true}]'),
  ('sw_edge','swift','出足','[{"a":"st_agi","w":0.7,"c":false}]'),
  ('sw_open','swift','初手の型','[{"a":"dmgFull","w":1.3,"c":false}]'),
  ('sw_finish','swift','一気呵成','[{"a":"dmgSmall","w":1.3,"c":false},{"a":"extra","w":0.5,"c":false}]'),
  ('lg_grind','long','持久の型','[{"a":"dmgLate","w":1.6,"c":false}]'),
  ('lg_stack','long','積み重ね','[{"a":"dmgCombo","w":0.4,"c":false}]'),
  ('lg_root','long','根を張る','[{"a":"regen","w":0.28,"c":false}]'),
  ('lg_calm','long','静かな刃','[{"a":"cut","w":0.6,"c":false},{"a":"mpRegen","w":0.3,"c":false}]'),
  ('lg_late','long','遅咲き','[{"a":"dmgLate","w":2.1,"c":false},{"a":"dmg","w":0.5,"c":true}]'),
  ('lg_wear','long','摩耗誘い','[{"a":"ailDmg","w":1.4,"c":false},{"a":"ailRate","w":0.6,"c":false}]'),
  ('lw_ice','lowHp','薄氷の勝者','[{"a":"dmgLow","w":2.4,"c":false}]'),
  ('lw_guts','lowHp','死中に活','[{"a":"guts","w":2.4,"c":false}]'),
  ('lw_last','lowHp','背水','[{"a":"dmgLow","w":3.4,"c":false},{"a":"taken","w":1,"c":true}]'),
  ('lw_veil','lowHp','窮鼠の見切り','[{"a":"evaLow","w":2,"c":false}]'),
  ('lw_hard','lowHp','火事場の硬さ','[{"a":"cutLow","w":2.2,"c":false}]'),
  ('lw_leech','lowHp','命の削り合い','[{"a":"drain","w":0.4,"c":false},{"a":"dmgLow","w":1.2,"c":false}]'),
  ('gi_slay','giant','巨人殺し','[{"a":"dmgBig","w":2.6,"c":false}]'),
  ('gi_pierce','giant','大物貫き','[{"a":"defPen","w":1,"c":false},{"a":"dmgBig","w":1,"c":false}]'),
  ('gi_brave','giant','蛮勇','[{"a":"dmgBig","w":3.6,"c":false},{"a":"taken","w":1.1,"c":true}]'),
  ('gi_read','giant','力量差の見切り','[{"a":"evaLow","w":1.4,"c":false},{"a":"dmgBig","w":1.2,"c":false}]'),
  ('gi_grit','giant','挑む者','[{"a":"st_vit","w":0.6,"c":false},{"a":"dmgBig","w":1.4,"c":false}]'),
  ('gi_fell','giant','討ち取り','[{"a":"critRate","w":0.6,"c":false},{"a":"dmgBig","w":1.4,"c":false}]'),
  ('fn_reap','finish','刈り取り','[{"a":"dmgFinish","w":2.4,"c":false}]'),
  ('fn_chase','finish','逃さぬ手','[{"a":"hitFinish","w":1.2,"c":false},{"a":"dmgFinish","w":1.4,"c":false}]'),
  ('fn_eye','finish','首筋を見る','[{"a":"critFinish","w":1.6,"c":false},{"a":"dmgFinish","w":1,"c":false}]'),
  ('fn_deep','finish','深追い','[{"a":"dmgFinish","w":3.4,"c":false},{"a":"taken","w":1,"c":true}]'),
  ('fn_feast','finish','止めの一口','[{"a":"dmgFinish","w":1.2,"c":false},{"a":"drain","w":0.3,"c":false}]'),
  ('fn_press','finish','詰め','[{"a":"dmgFinish","w":1,"c":false},{"a":"extra","w":0.5,"c":false}]'),
  ('bo_slay','boss','大敵斬り','[{"a":"dmgBoss","w":2.6,"c":false}]'),
  ('bo_long','boss','長期戦の心得','[{"a":"dmgBoss","w":1.4,"c":false},{"a":"regen","w":0.18,"c":false}]'),
  ('bo_pierce','boss','巨躯貫き','[{"a":"dmgBoss","w":1.4,"c":false},{"a":"defPen","w":0.8,"c":false}]'),
  ('bo_defy','boss','王殺し','[{"a":"dmgBoss","w":3.6,"c":false},{"a":"taken","w":1,"c":true}]'),
  ('bo_focus','boss','討伐の集中','[{"a":"dmgBoss","w":1.2,"c":false},{"a":"critRate","w":0.5,"c":false}]'),
  ('bo_stand','boss','踏み止まり','[{"a":"dmgBoss","w":1.2,"c":false},{"a":"cut","w":0.5,"c":false}]'),
  ('dr_leech','drain','血の恵み','[{"a":"drain","w":0.55,"c":false}]'),
  ('dr_hit','drain','一撃ごとの糧','[{"a":"onHitHeal","w":0.11,"c":false}]'),
  ('dr_greed','drain','貪食','[{"a":"drain","w":0.85,"c":false},{"a":"heal","w":1,"c":true}]'),
  ('dr_crit','drain','牙の悦び','[{"a":"critHpHeal","w":0.25,"c":false}]'),
  ('dr_mana','drain','生命転換','[{"a":"onHitMp","w":0.11,"c":false},{"a":"drain","w":0.2,"c":false}]'),
  ('dr_cycle','drain','循環','[{"a":"regen","w":0.2,"c":false},{"a":"drain","w":0.25,"c":false}]'),
  ('mi_kata','misfire','居合の心得','[{"a":"misfireDmg","w":3,"c":false}]'),
  ('mi_proc','misfire','呼吸を合わせる','[{"a":"proc","w":0.8,"c":false}]'),
  ('mi_wait','misfire','溜めの型','[{"a":"dmgSkill","w":1.1,"c":false},{"a":"proc","w":0.6,"c":true}]'),
  ('mi_ready','misfire','二の太刀','[{"a":"misfireDmg","w":2,"c":false},{"a":"dmgNormal","w":1,"c":false}]'),
  ('mi_calm','misfire','平常心','[{"a":"proc","w":0.5,"c":false},{"a":"mpCost","w":0.5,"c":false}]'),
  ('mi_burst','misfire','大振り','[{"a":"dmgSkill","w":1.6,"c":false},{"a":"hit","w":0.9,"c":true}]'),
  ('ex_swift','extra','疾風の足','[{"a":"extra","w":0.8,"c":false}]'),
  ('ex_agi','extra','軽身','[{"a":"st_agi","w":0.8,"c":false}]'),
  ('ex_combo','extra','連なる手','[{"a":"dmgCombo","w":0.4,"c":false}]'),
  ('ex_press','extra','畳みかけ','[{"a":"extra","w":0.5,"c":false},{"a":"dmgNormal","w":1,"c":false}]'),
  ('ex_reck','extra','前のめり','[{"a":"extra","w":1.2,"c":false},{"a":"eva","w":0.8,"c":true}]'),
  ('ex_flow','extra','途切れぬ手','[{"a":"extra","w":0.5,"c":false},{"a":"mpCost","w":0.6,"c":false}]'),
  ('fs_edge','first','先手必勝','[{"a":"first","w":1.8,"c":false}]'),
  ('fs_open','first','出会い頭','[{"a":"dmgFirst","w":1.4,"c":false}]'),
  ('fs_full','first','満を持して','[{"a":"dmgFull","w":1.4,"c":false}]'),
  ('fs_agi','first','疾さの証','[{"a":"st_agi","w":0.7,"c":false},{"a":"first","w":0.8,"c":false}]'),
  ('fs_press','first','先制の圧','[{"a":"first","w":1,"c":false},{"a":"dmgFirst","w":0.9,"c":false}]'),
  ('fs_bold','first','抜き打ち','[{"a":"dmgFirst","w":1.9,"c":false},{"a":"taken","w":0.9,"c":true}]'),
  ('ov_might','overkill','有り余る力','[{"a":"dmg","w":0.8,"c":false}]'),
  ('ov_crush','overkill','打ち砕き','[{"a":"dmgSmall","w":1.5,"c":false}]'),
  ('ov_pierce','overkill','力任せ','[{"a":"defPen","w":1.3,"c":false}]'),
  ('ov_burst','overkill','出し惜しみなし','[{"a":"dmgSkill","w":1.2,"c":false},{"a":"mpCost","w":0.9,"c":true}]'),
  ('ov_wild','overkill','大暴れ','[{"a":"dmg","w":1.5,"c":false},{"a":"taken","w":1,"c":true}]'),
  ('ov_finish','overkill','止めの一撃','[{"a":"critDmg","w":1.6,"c":false},{"a":"dmgSmall","w":0.8,"c":false}]'),
  ('pf_grace','perfect','無傷の型','[{"a":"dmgFull","w":1.6,"c":false}]'),
  ('pf_calm','perfect','静謐','[{"a":"cut","w":0.8,"c":false}]'),
  ('pf_eye','perfect','完璧な見切り','[{"a":"eva","w":0.7,"c":false},{"a":"hit","w":0.5,"c":false}]'),
  ('pf_high','perfect','余裕','[{"a":"dmgHigh","w":1.1,"c":false}]'),
  ('pf_pure','perfect','一分の隙もなく','[{"a":"dmgFull","w":2.1,"c":false},{"a":"taken","w":0.8,"c":true}]'),
  ('pf_keep','perfect','崩さぬ構え','[{"a":"cut","w":0.5,"c":false},{"a":"regen","w":0.18,"c":false}]'),
  ('cb_rise','comeback','巻き返し','[{"a":"dmgLow","w":2.2,"c":false},{"a":"regen","w":0.15,"c":false}]'),
  ('cb_guts','comeback','諦めの悪さ','[{"a":"guts","w":2.6,"c":false}]'),
  ('cb_turn','comeback','形勢逆転','[{"a":"dmgHurt","w":2.6,"c":false}]'),
  ('cb_bear','comeback','耐え忍び','[{"a":"cutLow","w":2,"c":false},{"a":"heal","w":0.6,"c":false}]'),
  ('cb_heart','comeback','折れぬ心','[{"a":"st_vit","w":0.7,"c":false},{"a":"dmgLow","w":1.2,"c":false}]'),
  ('cb_spite','comeback','意地','[{"a":"dmgLow","w":3.2,"c":false},{"a":"eva","w":0.9,"c":true}]'),
  ('tk_rot','tick','蝕みを深く','[{"a":"ailDmg","w":2,"c":false}]'),
  ('tk_spread','tick','病巣拡大','[{"a":"ailRate","w":0.8,"c":false},{"a":"ailDmg","w":0.9,"c":false}]'),
  ('tk_feed','tick','病の恵み','[{"a":"ailDrain","w":0.25,"c":false}]'),
  ('tk_hunt','tick','弱りを突く','[{"a":"dmgAil","w":2,"c":false}]'),
  ('tk_gash','tick','傷口を開く','[{"a":"critAil","w":2.4,"c":false}]'),
  ('tk_patient','tick','待ちの構え','[{"a":"cut","w":0.5,"c":false},{"a":"ailDmg","w":1.2,"c":false}]');

-- ===== 1戦ぶんの戦績を積む =====
-- p_ids … いま装備している武器の所持品ID（右手・左手）／ p_rec … evolve.js の recordOfBattle の結果
create or replace function public.v2_weapon_record(p_ids bigint[], p_rec jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  -- 1戦あたりの上限。★ここを超える申告は切り捨てる
  c_max_turns constant int := 100;   -- battle.js の MAX_TURNS
  c_max_hits  constant int := 200;   -- 多段＋追加行動を見込んだ上限
  c_max_acts  constant int := 200;   -- 回復・バフ・不発などの回数の上限
  c_max_exp   constant int := 200;   -- 1戦で入る経験値の上限（＝行動できる回数の上限。追加行動を見込む）
  c_per_lv    constant int := 100;
  c_foes_keep constant int := 12;    -- evolve.js の FOES_KEEP
  c_levels    constant int[] := array[300, 1000, 2000];   -- 覚醒できるレベル
  v_hits  int;  v_taken int;  v_wins int;
  v_add   jsonb;
  v_foe   text;
  v_row   record;
  v_old   jsonb;
  v_foes  jsonb;
  v_n     int;
  v_out   jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  if p_ids is null or array_length(p_ids, 1) is null then return jsonb_build_object('ok', true, 'weapons', v_out); end if;
  -- 一度に積めるのは2本まで（右手・左手）
  if array_length(p_ids, 1) > 2 then return jsonb_build_object('ok', false, 'error', '武器が多すぎます'); end if;

  -- ---- 申告を頭打ちにする ----
  v_hits  := least(greatest(coalesce((p_rec ->> 'hits')::int, 0), 0), c_max_hits);
  v_taken := least(greatest(coalesce((p_rec ->> 'taken')::int, 0), 0), c_max_hits);
  v_wins  := least(greatest(coalesce((p_rec ->> 'wins')::int, 0), 0), 1);
  -- 倒した敵は1戦に1体だけ。勝っていなければ数えない
  v_foe := null;
  if v_wins = 1 then
    select key into v_foe from jsonb_each_text(coalesce(p_rec -> 'foes', '{}'::jsonb)) limit 1;
  end if;
  v_add := jsonb_build_object(
    'battles',    1,
    'exp',        least(greatest(coalesce((p_rec ->> 'exp')::int, 0), 0), c_max_exp),
    'turns',      least(greatest(coalesce((p_rec ->> 'turns')::int, 0), 0), c_max_turns),
    'hits',       v_hits,
    'crit',       least(greatest(coalesce((p_rec ->> 'crit')::int, 0), 0), v_hits),
    'physHits',   least(greatest(coalesce((p_rec ->> 'physHits')::int, 0), 0), v_hits),
    'magHits',    least(greatest(coalesce((p_rec ->> 'magHits')::int, 0), 0), v_hits),
    'skillHits',  least(greatest(coalesce((p_rec ->> 'skillHits')::int, 0), 0), v_hits),
    'normalHits', least(greatest(coalesce((p_rec ->> 'normalHits')::int, 0), 0), v_hits),
    'multiHits',  least(greatest(coalesce((p_rec ->> 'multiHits')::int, 0), 0), v_hits),
    'finishTurns',least(greatest(coalesce((p_rec ->> 'finishTurns')::int, 0), 0), c_max_turns),
    'drains',     least(greatest(coalesce((p_rec ->> 'drains')::int, 0), 0), v_hits),
    'ail',        least(greatest(coalesce((p_rec ->> 'ail')::int, 0), 0), v_hits),
    'taken',      v_taken,
    'dodged',     least(greatest(coalesce((p_rec ->> 'dodged')::int, 0), 0), v_taken),
    'hurtPct',    round(least(greatest(coalesce((p_rec ->> 'hurtPct')::numeric, 0), 0), 1), 3),
    'ailed',      least(greatest(coalesce((p_rec ->> 'ailed')::int, 0), 0), c_max_acts),
    'ailTicks',   least(greatest(coalesce((p_rec ->> 'ailTicks')::int, 0), 0), c_max_acts),
    'heals',      least(greatest(coalesce((p_rec ->> 'heals')::int, 0), 0), c_max_acts),
    'buffs',      least(greatest(coalesce((p_rec ->> 'buffs')::int, 0), 0), c_max_acts),
    'misfires',   least(greatest(coalesce((p_rec ->> 'misfires')::int, 0), 0), c_max_acts),
    'extras',     least(greatest(coalesce((p_rec ->> 'extras')::int, 0), 0), c_max_acts),
    'firsts',     least(greatest(coalesce((p_rec ->> 'firsts')::int, 0), 0), 1),
    'mpEmpty',    least(greatest(coalesce((p_rec ->> 'mpEmpty')::int, 0), 0), 1),
    'wins',       v_wins,
    'lowWin',     least(greatest(coalesce((p_rec ->> 'lowWin')::int, 0), 0), v_wins),
    'bigWin',     least(greatest(coalesce((p_rec ->> 'bigWin')::int, 0), 0), v_wins),
    'bossWin',    least(greatest(coalesce((p_rec ->> 'bossWin')::int, 0), 0), v_wins),
    'fastWin',    least(greatest(coalesce((p_rec ->> 'fastWin')::int, 0), 0), v_wins),
    'longWin',    least(greatest(coalesce((p_rec ->> 'longWin')::int, 0), 0), v_wins),
    'perfect',    least(greatest(coalesce((p_rec ->> 'perfect')::int, 0), 0), v_wins),
    'comeback',   least(greatest(coalesce((p_rec ->> 'comeback')::int, 0), 0), v_wins),
    'overkill',   least(greatest(coalesce((p_rec ->> 'overkill')::int, 0), 0), v_wins)
  );

  -- ---- 装備している武器へ積む（自分のもので、部位が武器のものだけ）----
  -- ⚠**行をロックしてから読む**。読んで足して書くので、同じ武器へ同時に呼ばれると
  --   片方の増分が消える（2026-08-21 実機テストで実測：100回呼んで37回しか積まれなかった）。
  --   タブを2つ開いている・連打した、で普通に起きる。
  for v_row in
    select i.id, i.record
      from public.v2_inventory i
      join public.v2_equipment e on e.id = i.equip_id
     where i.id = any(p_ids) and i.player_id = v_uid and e.part = '武器'
     for update of i
  loop
    v_old := coalesce(v_row.record, '{}'::jsonb);
    v_foes := coalesce(v_old -> 'foes', '{}'::jsonb);
    if v_foe is not null then
      v_foes := jsonb_set(v_foes, array[v_foe],
                          to_jsonb(coalesce((v_foes ->> v_foe)::int, 0) + 1), true);
      -- 際限なく増やさない。多い順に c_foes_keep 件だけ残す
      if (select count(*) from jsonb_object_keys(v_foes)) > c_foes_keep then
        select coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb) into v_foes
          from (select key, value from jsonb_each(v_foes)
                 order by (value #>> '{}')::int desc, key limit c_foes_keep) t;
      end if;
    end if;
    -- 数のキーは足し算、foes だけ別枠
    v_old := (
      select coalesce(jsonb_object_agg(k, to_jsonb(
               coalesce((v_old ->> k)::numeric, 0) + coalesce((v_add ->> k)::numeric, 0))), '{}'::jsonb)
        from jsonb_object_keys(v_add) k
    ) || jsonb_build_object('foes', v_foes);
    update public.v2_inventory set record = v_old where id = v_row.id;
    -- 熟練度のレベル（経験値 ÷ 100）
    v_n := coalesce((v_old ->> 'exp')::int, 0) / c_per_lv;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'level', v_n,
      -- まだ受け取っていない覚醒の数（0＝無し）。画面はこれを見てポップアップを出す
      'pending', (select count(*) from unnest(c_levels) s where v_n >= s)
                 - (select jsonb_array_length(coalesce(i2.evolutions, '[]'::jsonb))
                      from public.v2_inventory i2 where i2.id = v_row.id),
      'record', v_old));
  end loop;

  return jsonb_build_object('ok', true, 'weapons', v_out);
end;
$$;
revoke all on function public.v2_weapon_record(bigint[], jsonb) from public;
revoke all on function public.v2_weapon_record(bigint[], jsonb) from anon;
grant execute on function public.v2_weapon_record(bigint[], jsonb) to authenticated;

-- ===== 進化を1つ付ける =====
-- クライアントが送るのは「どの能力か(p_key)」と「偏りの強さ(p_s・0〜1)」だけ。
-- ★**効果の値はサーバーが名簿の倍率から計算する**＝値そのものは水増しできない。
-- ⚠引数を変えたので作り直す（create or replace では引数を変えられない）
drop function if exists public.v2_weapon_evolve(bigint, text, numeric, text);
drop function if exists public.v2_weapon_evolve(bigint, text, numeric);
create or replace function public.v2_weapon_evolve(p_id bigint, p_key text, p_s numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  c_levels constant int[]     := array[300, 1000, 2000];      -- evolve.js の LEVELS
  c_caps   constant numeric[] := array[6, 10, 15];   -- evolve.js の STAGE_CAP
  c_per_lv constant int       := 100;
  v_row    record;
  v_tr     record;
  v_evos   jsonb;
  v_stage  int;
  v_lv     int;
  v_s      numeric;
  v_cap    numeric;
  v_eff    jsonb;
  v_ev     jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;

  select t.key, t.atoms into v_tr from public.v2_evolve_traits t where t.key = p_key;
  if not found then return jsonb_build_object('ok', false, 'error', '知らない能力です'); end if;

  select i.id, i.record, i.evolutions into v_row
    from public.v2_inventory i
    join public.v2_equipment e on e.id = i.equip_id
   where i.id = p_id and i.player_id = v_uid and e.part = '武器'
   for update of i;
  if not found then return jsonb_build_object('ok', false, 'error', '武器が見つかりません'); end if;

  v_evos  := coalesce(v_row.evolutions, '[]'::jsonb);
  v_stage := jsonb_array_length(v_evos) + 1;
  if v_stage > array_length(c_levels, 1) then return jsonb_build_object('ok', false, 'error', 'これ以上は覚醒しません'); end if;

  v_lv := coalesce((coalesce(v_row.record, '{}'::jsonb) ->> 'exp')::int, 0) / c_per_lv;
  if v_lv < c_levels[v_stage] then
    return jsonb_build_object('ok', false, 'error', format('熟練度がLV%sに届いていません', c_levels[v_stage]));
  end if;

  -- 同じ能力は2回付かない
  if exists (select 1 from jsonb_array_elements(v_evos) e where e ->> 'key' = p_key) then
    return jsonb_build_object('ok', false, 'error', 'その能力はもう付いています');
  end if;

  -- ★効果の値はここで作る（クライアントの言い値は使わない）
  v_s   := least(greatest(coalesce(p_s, 0), 0), 1);
  v_cap := c_caps[v_stage];
  select coalesce(jsonb_object_agg(e ->> 'a',
           greatest(0.1, round(v_cap * v_s * (e ->> 'w')::numeric, 1))), '{}'::jsonb)
    into v_eff
    from jsonb_array_elements(v_tr.atoms) e;

  v_ev := jsonb_build_object('stage', v_stage, 'key', p_key, 's', round(v_s, 3), 'eff', v_eff);

  update public.v2_inventory set evolutions = v_evos || jsonb_build_array(v_ev) where id = p_id;
  return jsonb_build_object('ok', true, 'evolution', v_ev,
                            'inventory', (select to_jsonb(i) from public.v2_inventory i where i.id = p_id));
end;
$$;
revoke all on function public.v2_weapon_evolve(bigint, text, numeric) from public;
revoke all on function public.v2_weapon_evolve(bigint, text, numeric) from anon;
grant execute on function public.v2_weapon_evolve(bigint, text, numeric) to authenticated;
