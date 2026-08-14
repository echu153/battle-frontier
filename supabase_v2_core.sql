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
  -- 特殊職：証のみ（★証が要るのはこの3職だけ）
  ('ギャンブラー',       'special',  50, '{}', 'ギャンブラーの証'),
  ('竜騎士',             'special',  51, '{}', '竜騎士の証'),
  ('ブリーダー',         'special',  52, '{}', 'ブリーダーの証')
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
alter table public.v2_skills enable row level security;
drop policy if exists v2_skills_select on public.v2_skills;
create policy v2_skills_select on public.v2_skills for select to authenticated using (true);
grant select on table public.v2_skills to authenticated;

insert into public.v2_skills (name, cls, mp, sort) values
  ('はたく','ノーブル',0,1), ('狙い撃ち','ノーブル',5,2), ('応急手当','ノーブル',8,3), ('身構える','ノーブル',6,4), ('気合い','ノーブル',8,5),
  ('体当たり','戦士',5,1), ('強撃','戦士',12,2), ('防御崩し','戦士',10,3), ('防御態勢','戦士',8,4), ('シールドアタック','戦士',10,5),
  ('狙撃','弓使い',8,1), ('剛射','弓使い',11,2), ('貫通射撃','弓使い',12,3), ('疾風矢','弓使い',8,4), ('駆け足','弓使い',6,5),
  ('マジックアロー','魔法使い',5,1), ('ファイア','魔法使い',11,2), ('サンダー','魔法使い',15,3), ('アイスランス','魔法使い',12,4), ('精神統一','魔法使い',8,5),
  ('ライト','僧侶',6,1), ('ライトニング','僧侶',13,2), ('ヒール','僧侶',12,3), ('祈祷','僧侶',15,4), ('プロテク','僧侶',10,5),
  ('打撃','格闘家',4,1), ('鉄拳','格闘家',12,2), ('連打','格闘家',10,3), ('爆裂拳','格闘家',16,4), ('残心','格闘家',8,5),
  ('オオカミ召喚','サモナー',8,1), ('小悪魔召喚','サモナー',11,2), ('グリフォン召喚','サモナー',13,3), ('群れの号令','サモナー',14,4), ('魔力供給','サモナー',0,5),
  ('居合斬','侍',12,1), ('断空','侍',16,2), ('居合の構え','侍',0,3), ('明鏡止水','侍',12,4), ('月影','侍',24,5),
  ('マッドラッシュ','狂戦士',16,1), ('すてみ','狂戦士',18,2), ('バーサク','狂戦士',0,3), ('ブラッティロア','狂戦士',14,4), ('フルブレイカー','狂戦士',18,5),
  ('毒矢','狩人',12,1), ('三連射','狩人',14,2), ('鷹ノ目','狩人',0,3), ('狩猟本能','狩人',14,4), ('絶影狙撃','狩人',20,5),
  ('瞬歩瞬殺','暗殺者',12,1), ('鬼影閃','暗殺者',15,2), ('隠身','暗殺者',0,3), ('影歩き','暗殺者',12,4), ('急所突き','暗殺者',20,5),
  ('アクアショット','元素使い',12,1), ('アースクエイク','元素使い',15,2), ('元素共鳴','元素使い',0,3), ('ライトニングボルト','元素使い',17,4), ('フレイムバースト','元素使い',20,5),
  ('骸骨召喚','死霊使い',11,1), ('ソウルドレイン','死霊使い',15,2), ('骸の壁','死霊使い',0,3), ('腐敗霧','死霊使い',16,4), ('幽世ノ門','死霊使い',20,5),
  ('ホーリーライト','聖職者',12,1), ('奇跡','聖職者',18,2), ('神聖加護','聖職者',0,3), ('祈りの結界','聖職者',14,4), ('神罰執行','聖職者',20,5),
  ('粛清','異端審問官',13,1), ('狂信','異端審問官',12,2), ('執行本能','異端審問官',0,3), ('聖なる裁き','異端審問官',17,4), ('断罪','異端審問官',21,5),
  ('サンダーストライク','賢者',14,1), ('マナボルト','賢者',0,2), ('天啓','賢者',0,3), ('氷の障壁','賢者',15,4), ('メテオストライク','賢者',26,5),
  ('ホーリーエッジ','聖騎士',13,1), ('ディバインスマイト','聖騎士',16,2), ('聖騎士の心得','聖騎士',0,3), ('聖域展開','聖騎士',18,4), ('神聖覚醒','聖騎士',20,5),
  ('雷光斬','魔法剣士',13,1), ('閃光','魔法剣士',15,2), ('魔導剣術','魔法剣士',0,3), ('魔剣開放','魔法剣士',18,4), ('エレメンタルエッジ','魔法剣士',22,5),
  ('魔弾','魔銃士',13,1), ('連装銃撃','魔銃士',15,2), ('精密照準','魔銃士',0,3), ('強化装填','魔銃士',16,4), ('キャノネスチュームビンド','魔銃士',22,5),
  ('サイコショット','サイキッカー',12,1), ('マインドブレイク','サイキッカー',15,2), ('第六感','サイキッカー',0,3), ('精神集中','サイキッカー',16,4), ('サイコブラスト','サイキッカー',21,5),
  ('半月蹴り','体術師',12,1), ('五連殺','体術師',20,2), ('闘争本能','体術師',0,3), ('破衝掌','体術師',16,4), ('飛天三角蹴り','体術師',17,5),
  ('ジャグリング','ギャンブラー',15,1), ('ラッキーダイス','ギャンブラー',13,2), ('ギャンブルボディ','ギャンブラー',0,3), ('オールイン','ギャンブラー',18,4), ('ジャックポット','ギャンブラー',24,5),
  ('ドラゴンスラスト','竜騎士',13,1), ('ドラゴンファング','竜騎士',17,2), ('竜鱗の加護','竜騎士',0,3), ('ドラゴンロア','竜騎士',14,4), ('天墜竜閃','竜騎士',28,5),
  ('サラマンド','精霊召喚士',13,1), ('ウンディーネ','精霊召喚士',16,2), ('精霊共鳴','精霊召喚士',0,3), ('シルフ','精霊召喚士',14,4), ('ノーム','精霊召喚士',20,5),
  ('符術・式打ち','式神使い',12,1), ('呪符・魂削り','式神使い',16,2), ('式神召喚','式神使い',0,3), ('陰陽結界','式神使い',15,4), ('禁術・神降ろし','式神使い',24,5),
  ('ペット召喚','ブリーダー',0,1), ('攻撃して！','ブリーダー',14,2), ('一緒に頑張ろう！','ブリーダー',14,3), ('休憩しよう！','ブリーダー',16,4), ('やっちゃえ！','ブリーダー',26,5),
  ('練気掌','武僧',12,1), ('活殺自在','武僧',14,2), ('心身一如','武僧',0,3), ('金剛身','武僧',15,4), ('崩拳','武僧',20,5),
  ('獣呼びの矢','ビーストレンジャー',12,1), ('群狼の牙','ビーストレンジャー',16,2), ('野性の勘','ビーストレンジャー',0,3), ('共鳴の咆哮','ビーストレンジャー',14,4), ('貫狼撃','ビーストレンジャー',20,5)
on conflict (name) do update set cls = excluded.cls, mp = excluded.mp, sort = excluded.sort;

-- ===== 2. RLS =====
-- 参照は認証済み全員（将来のランキング用）。書き込みポリシーは作らない
-- ＝クライアントからの直接 INSERT/UPDATE/DELETE は不可。更新は下のRPC経由のみ。
alter table public.v2_profiles enable row level security;
drop policy if exists v2_profiles_select on public.v2_profiles;
create policy v2_profiles_select on public.v2_profiles
  for select to authenticated using (true);

revoke all on table public.v2_profiles from anon;
grant select on table public.v2_profiles to authenticated;

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
      where s.cls = v_row.class and not (v_skills ? s.name);
      if v_unlearned > 0 then
        v_must := greatest(0, v_unlearned - greatest(0, c_learn_by_lv - v_lv));
        if v_unlearned - v_must > 0 and random() * 100 < c_learn_pct then
          v_must := v_must + 1;
        end if;
        for v_i in 1..v_must loop
          select s.name into v_pick
          from public.v2_skills s
          where s.cls = v_row.class and not (v_skills ? s.name)
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
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_set   jsonb := coalesce(p_set, '[]'::jsonb);
  v_cost  int := 0;
  v_names text[] := '{}';
  e       jsonb;
  v_name  text;
  v_uses  int;
  v_mp    int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
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
    -- 使えるスキルか（いまの職業のスキル ∪ 習得済み）。ついでに消費MPを取る
    select s.mp into v_mp from public.v2_skills s where s.name = v_name;
    if v_mp is null then
      return jsonb_build_object('ok', false, 'error', format('%sというスキルはありません', v_name));
    end if;
    -- 使えるスキル ＝ 習得中 ∪ 習得済み
    if not (coalesce(v_row.skills, '[]'::jsonb) ? v_name)
       and not (coalesce(v_row.learned, '[]'::jsonb) ? v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sはまだ使えません', v_name));
    end if;
    if v_name = any(v_names) then
      return jsonb_build_object('ok', false, 'error', format('%sが重複しています', v_name));
    end if;
    v_names := array_append(v_names, v_name);
    if jsonb_typeof(e -> 'uses') <> 'number' then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数が不正です', v_name));
    end if;
    v_uses := (e ->> 'uses')::int;
    if v_uses < 1 or v_uses > c_use_max then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, c_use_max));
    end if;
    v_cost := v_cost + v_mp * v_uses;
  end loop;

  -- 想定利用MPが最大MPを超える編成は保存させない（これが使用回数の実質的な上限）
  if v_cost > v_row.mp then
    return jsonb_build_object('ok', false, 'error',
      format('想定利用MPが最大MPを超えています（%s / %s）', v_cost, v_row.mp));
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
alter table public.v2_profiles add column if not exists boss_rate      numeric     not null default 0;   -- ボス遭遇率(%)。戦うたび+0.3、当たると0へ
alter table public.v2_profiles add column if not exists sortie_cd      int         not null default 20;  -- 出撃のクールタイム（10 or 20）
alter table public.v2_profiles add column if not exists equipped       jsonb       not null default '{}'::jsonb; -- {"right": 12, ...} v2_inventory.id
alter table public.v2_profiles add column if not exists last_sortie_at timestamptz;

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

-- ---- エリアのマスタ（ドロップ範囲とGoldの上限＝サーバー側の検証に使う）----
create table if not exists public.v2_areas (
  id            int primary key,
  name          text not null,
  drop_ranks    jsonb not null,
  boss_gold     int not null,
  max_zako_gold int not null
);
alter table public.v2_areas enable row level security;
drop policy if exists "v2_areas_read" on public.v2_areas;
create policy "v2_areas_read" on public.v2_areas for select to authenticated using (true);
revoke all on table public.v2_areas from anon;
grant select on table public.v2_areas to authenticated;

insert into public.v2_areas (id, name, drop_ranks, boss_gold, max_zako_gold) values
  (1, '始まりの森', '{"F":40,"E":40,"D":20}'::jsonb, 100, 60),
  (2, '荒廃した草原', '{"F":35,"E":30,"D":22,"C":13}'::jsonb, 500, 120),
  (3, '古代の洞窟', '{"F":30,"E":28,"D":24,"C":13,"B":5}'::jsonb, 2000, 240),
  (4, '蒼海の入り江', '{"F":26,"E":26,"D":23,"C":15,"B":10}'::jsonb, 5000, 400),
  (5, '巨峰山脈', '{"E":38,"D":30,"C":20,"B":9,"A":3}'::jsonb, 9000, 600),
  (6, '白銀の霊峰', '{"E":33,"D":29,"C":21,"B":11,"A":6}'::jsonb, 18750, 900),
  (7, '煉獄火山', '{"D":40,"C":30,"B":20,"A":10}'::jsonb, 37500, 1200),
  (8, '蒼天の浮遊城', '{"D":35,"C":29,"B":22,"A":14}'::jsonb, 60000, 1600)
on conflict (id) do update set
  name = excluded.name, drop_ranks = excluded.drop_ranks,
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

-- ===== 出撃の清算 =====
-- 旧版と同じで、戦闘そのものはクライアントが回し、まとめてここへ送る。
-- ⚠サーバーは「その回数で取り得る上限」を超えていないかだけ検証する（完全な権威ではない）。
--   戦闘をサーバーで回すようにしたら、このRPCの中で回すよう差し替える。
create or replace function public.v2_sortie_settle(
  p_area int, p_normals int, p_boss_wins int, p_boss_seen int,
  p_exp int, p_gold bigint, p_drops jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_area  public.v2_areas;
  v_n     int := greatest(coalesce(p_normals, 0), 0);
  v_bw    int := greatest(coalesce(p_boss_wins, 0), 0);
  v_bs    int := greatest(coalesce(p_boss_seen, 0), 0);
  v_exp_cap  int;
  v_gold_cap bigint;
  v_exp   int;
  v_gold  bigint;
  v_drop  jsonb;
  v_ok    int := 0;
  v_res   jsonb;
  v_unlocked int[];
  v_rate  numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  select * into v_area from public.v2_areas where id = p_area;
  if not found then return jsonb_build_object('ok', false, 'error', 'そのエリアはありません'); end if;
  if not (v_row.unlocked_areas @> array[p_area]) then
    return jsonb_build_object('ok', false, 'error', 'このエリアはまだ解放されていません');
  end if;
  if v_n + v_bs = 0 then return jsonb_build_object('ok', false, 'error', '清算するものがありません'); end if;
  if v_n + v_bs > 500 then return jsonb_build_object('ok', false, 'error', '一度に清算できる回数を超えています'); end if;

  -- 取り得る上限。通常敵はEXP11・ボスは13が最大（sortie.js と同じ）
  v_exp_cap  := v_n * 11 + v_bw * 13;
  v_gold_cap := v_n::bigint * v_area.max_zako_gold + v_bw::bigint * v_area.boss_gold;
  v_exp  := least(greatest(coalesce(p_exp, 0), 0), v_exp_cap);
  v_gold := least(greatest(coalesce(p_gold, 0), 0), v_gold_cap);

  -- ドロップ。そのエリアで落ちるランクかどうかだけ見る
  if p_drops is not null and jsonb_typeof(p_drops) = 'array' then
    if jsonb_array_length(p_drops) > v_n + v_bs then
      return jsonb_build_object('ok', false, 'error', 'ドロップの数が戦闘回数を超えています');
    end if;
    for v_drop in select * from jsonb_array_elements(p_drops) loop
      insert into public.v2_inventory (player_id, equip_id)
      select v_uid, e.id from public.v2_equipment e
      where e.id = (v_drop #>> '{}') and v_area.drop_ranks ? e.rank;
      if found then v_ok := v_ok + 1; end if;
    end loop;
  end if;

  -- ボス撃破で次のエリアが解放される（旧版と同じ）
  v_unlocked := v_row.unlocked_areas;
  if v_bw > 0 and p_area < 8 and not (v_unlocked @> array[p_area + 1]) then
    v_unlocked := array_append(v_unlocked, p_area + 1);
  end if;
  -- ボス遭遇率。通常敵と戦うたび+0.3、ボスに当たった回があれば0へ戻す
  v_rate := case when v_bs > 0 then 0 else least(100, v_row.boss_rate + 0.3 * v_n) end;

  update public.v2_profiles
     set gold = gold + v_gold, unlocked_areas = v_unlocked, boss_rate = v_rate,
         last_sortie_at = now(), updated_at = now()
   where id = v_uid;

  v_res := public.v2_apply_exp(v_uid, v_exp);
  return jsonb_build_object('ok', true, 'exp', v_exp, 'gold', v_gold, 'drops', v_ok,
    'unlocked', to_jsonb(v_unlocked), 'boss_rate', v_rate, 'level', v_res);
end;
$$;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb) from public;
revoke all on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb) from anon;
grant execute on function public.v2_sortie_settle(int, int, int, int, int, bigint, jsonb) to authenticated;

-- ===== 出撃のクールタイムの設定（10 or 20）=====
create or replace function public.v2_set_cooldown(p_sec int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if p_sec not in (10, 20) then return jsonb_build_object('ok', false, 'error', '10秒か20秒を選んでください'); end if;
  update public.v2_profiles set sortie_cd = p_sec, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'sortie_cd', p_sec);
end;
$$;
revoke all on function public.v2_set_cooldown(int) from public;
revoke all on function public.v2_set_cooldown(int) from anon;
grant execute on function public.v2_set_cooldown(int) to authenticated;

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
  select equipped - p_slot into v_new from public.v2_profiles where id = v_uid;
  if v_new is null then return jsonb_build_object('ok', false, 'error', 'キャラクターがいません'); end if;
  update public.v2_profiles set equipped = v_new, updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'equipped', v_new);
end;
$$;
revoke all on function public.v2_unequip(text) from public;
revoke all on function public.v2_unequip(text) from anon;
grant execute on function public.v2_unequip(text) to authenticated;

-- ===== 鍛冶屋：同じ強化値の装備3個を合成 =====
-- あるけみすと式。失敗＝消失／成功+1／大成功+2／超大成功+3。ランクが高いほど失敗しやすい。
-- ⚠3個消して1個返す。必ず1つのトランザクションで行う（旧版で補填SQLを書く羽目になった事故がある）
create or replace function public.v2_fuse(p_a bigint, p_b bigint, p_c bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids bigint[] := array[p_a, p_b, p_c];
  v_cnt int;
  v_plus int;
  v_equip text;
  v_rank text;
  v_r numeric;
  v_fail numeric; v_great numeric; v_super numeric;
  v_up int;
  v_new bigint;
  v_equipped jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'ログインが必要です'); end if;
  if p_a = p_b or p_b = p_c or p_a = p_c then return jsonb_build_object('ok', false, 'error', '同じ装備を重ねて指定しています'); end if;

  select count(*), min(plus), min(equip_id) into v_cnt, v_plus, v_equip
    from public.v2_inventory where id = any(v_ids) and player_id = v_uid;
  if v_cnt <> 3 then return jsonb_build_object('ok', false, 'error', 'その装備を持っていません'); end if;
  if exists (select 1 from public.v2_inventory where id = any(v_ids) and player_id = v_uid and plus <> v_plus) then
    return jsonb_build_object('ok', false, 'error', '強化値が同じ装備を3つ選んでください');
  end if;
  if exists (select 1 from public.v2_inventory where id = any(v_ids) and player_id = v_uid and equip_id <> v_equip) then
    return jsonb_build_object('ok', false, 'error', '同じ装備を3つ選んでください');
  end if;
  if v_plus >= 12 then return jsonb_build_object('ok', false, 'error', '強化値は+12が上限です'); end if;
  -- 装備中のものは合成に使えない
  select equipped into v_equipped from public.v2_profiles where id = v_uid;
  if exists (select 1 from jsonb_each_text(v_equipped) where value::bigint = any(v_ids)) then
    return jsonb_build_object('ok', false, 'error', '装備中のものは合成に使えません');
  end if;

  select rank into v_rank from public.v2_equipment where id = v_equip;
  -- ランク別の確率（docs/v2-equipment-design.md）
  select f, g, s into v_fail, v_great, v_super from (values
    ('F', 0.00, 0.12, 0.03), ('E', 0.02, 0.13, 0.03), ('D', 0.04, 0.14, 0.04),
    ('C', 0.06, 0.15, 0.05), ('B', 0.09, 0.16, 0.06), ('A', 0.12, 0.17, 0.07),
    ('S', 0.15, 0.18, 0.09)
  ) t(r, f, g, s) where t.r = v_rank;

  delete from public.v2_inventory where id = any(v_ids) and player_id = v_uid;

  v_r := random();
  if v_r < v_fail then
    return jsonb_build_object('ok', true, 'result', 'fail', 'plus', null);
  elsif v_r < v_fail + v_super then v_up := 3;
  elsif v_r < v_fail + v_super + v_great then v_up := 2;
  else v_up := 1;
  end if;

  insert into public.v2_inventory (player_id, equip_id, plus)
  values (v_uid, v_equip, least(12, v_plus + v_up)) returning id into v_new;
  return jsonb_build_object('ok', true, 'result',
    case v_up when 3 then 'super' when 2 then 'great' else 'ok' end,
    'plus', least(12, v_plus + v_up), 'id', v_new);
end;
$$;
revoke all on function public.v2_fuse(bigint, bigint, bigint) from public;
revoke all on function public.v2_fuse(bigint, bigint, bigint) from anon;
grant execute on function public.v2_fuse(bigint, bigint, bigint) to authenticated;

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
