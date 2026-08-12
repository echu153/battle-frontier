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
  -- 上位職：初期職1つで転職3回＋証
  ('侍',                 'advanced', 20, '{"戦士":3}',       '侍の証'),
  ('狂戦士',             'advanced', 21, '{"戦士":3}',       '狂戦士の証'),
  ('狩人',               'advanced', 22, '{"弓使い":3}',     '狩人の証'),
  ('暗殺者',             'advanced', 23, '{"弓使い":3}',     '暗殺者の証'),
  ('元素使い',           'advanced', 24, '{"魔法使い":3}',   '元素使いの証'),
  ('死霊使い',           'advanced', 25, '{"魔法使い":3}',   '死霊使いの証'),
  ('聖職者',             'advanced', 26, '{"僧侶":3}',       '聖職者の証'),
  ('異端審問官',         'advanced', 27, '{"僧侶":3}',       '異端審問官の証'),
  ('サイキッカー',       'advanced', 28, '{"格闘家":3}',     'サイキッカーの証'),
  ('体術師',             'advanced', 29, '{"格闘家":3}',     '体術師の証'),
  ('精霊召喚士',         'advanced', 30, '{"サモナー":3}',   '精霊召喚士の証'),
  ('式神使い',           'advanced', 31, '{"サモナー":3}',   '式神使いの証'),
  -- 複合上位職：初期職2つで各転職3回＋証
  ('魔法剣士',           'hybrid',   40, '{"戦士":3,"魔法使い":3}',     '魔法剣士の証'),
  ('魔銃士',             'hybrid',   41, '{"弓使い":3,"魔法使い":3}',   '魔銃士の証'),
  ('聖騎士',             'hybrid',   42, '{"僧侶":3,"戦士":3}',         '聖騎士の証'),
  ('賢者',               'hybrid',   43, '{"魔法使い":3,"僧侶":3}',     '賢者の証'),
  ('武僧',               'hybrid',   44, '{"格闘家":3,"僧侶":3}',       '武僧の証'),
  ('ビーストレンジャー', 'hybrid',   45, '{"サモナー":3,"弓使い":3}',   'ビーストレンジャーの証'),
  -- 特殊職：証のみ
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
  ('オオカミ召喚','サモナー',8,1), ('小悪魔召喚','サモナー',11,2), ('グリフォン召喚','サモナー',13,3), ('群れの号令','サモナー',14,4), ('魔力供給','サモナー',0,5)
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
