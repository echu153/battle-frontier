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

-- 名前は大文字小文字を無視して一意
create unique index if not exists v2_profiles_username_lower_idx
  on public.v2_profiles (lower(username));

-- ※戦闘力（HP/8＋MP/3＋他6ステ）はクライアントの calcPower で算出する。
--   ランキングを作るときに生成列かビューをここへ足す。

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
  c_exp_step_jobs constant int := 10;   -- 何回の転職ごとに1段階上げるか
  c_rolls         constant int := 5;
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
begin
  select * into v_row from public.v2_profiles where id = p_player for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;

  v_lv   := v_row.lv;
  v_exp  := v_row.exp;
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
    updated_at = now()
  where id = p_player
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'level_ups', v_ups,
    'exp_need', v_need,
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
-- LV上限でのみ実行できる。LV1・初期ステータスへ戻し、
-- 「転職回数×100」戦闘力分を8種へランダムに配り直す（前回の配分は引き継がず毎回引き直し）。
create or replace function public.v2_change_job()
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
  v_uid    uuid := auth.uid();
  v_row    public.v2_profiles;
  v_jobs   int;
  v_stat   int[] := c_init;
  v_alloc  int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  v_points int;
  v_i      int;
  v_k      int;
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

  v_jobs   := v_row.job_changes + 1;
  v_points := v_jobs * c_power_per;
  for v_i in 1..v_points loop
    v_k := 1 + floor(random() * array_length(c_unit, 1))::int;
    v_alloc[v_k] := v_alloc[v_k] + c_unit[v_k];
    v_stat[v_k]  := v_stat[v_k]  + c_unit[v_k];
  end loop;

  update public.v2_profiles set
    lv = 1, exp = 0, job_changes = v_jobs,
    hp = v_stat[1], mp = v_stat[2], str = v_stat[3], dex = v_stat[4],
    agi = v_stat[5], int_stat = v_stat[6], vit = v_stat[7], luk = v_stat[8],
    updated_at = now()
  where id = v_uid
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'job_changes', v_jobs,
    'points', v_points,
    'alloc', jsonb_build_object(
      'hp', v_alloc[1], 'mp', v_alloc[2], 'str', v_alloc[3], 'dex', v_alloc[4],
      'agi', v_alloc[5], 'int_stat', v_alloc[6], 'vit', v_alloc[7], 'luk', v_alloc[8]),
    'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_change_job() from public;
revoke all on function public.v2_change_job() from anon;
grant execute on function public.v2_change_job() to authenticated;

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

-- ===== 7. 適用後の確認（任意・1文ずつ実行）=====
-- select column_name, data_type from information_schema.columns where table_name = 'v2_profiles' order by ordinal_position;
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like 'v2\_%';
