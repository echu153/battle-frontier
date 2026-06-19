-- ============================================================
-- AI相談アシスタント：答えられなかった質問の自動集約
--   フォールバック時にクライアントが log_unanswered(q) を呼ぶ。
--   サーバ側で正規化キー(norm)を生成して集約し hits を加算。後でKBに反映する。
--
-- セキュリティ（Codex [CODEX]4 / [CODEX]6 反映）:
--   ・asker はクライアント指定を信用せず auth.uid() から取得（認証必須）
--   ・norm はクライアント指定を受け取らず、サーバが q から生成（任意キーでの水増し防止）
--   ・q は trim＋非空チェック＋最大300字、norm は最大200字。テーブルにも CHECK 制約
--   ・EXECUTE は authenticated のみ（anon剥奪）
--   ・閲覧/更新は is_admin のみ（RLS。resolved 更新用に UPDATE policy も付与）
--
-- 【PII保持方針】question は自由入力で個人情報を含み得る。用途はKB育成のみ。
--   ・保持するもの: 直近の生質問(最大300字)＋直近 asker(auth.uid())。集約は norm 単位。
--   ・asker は90日で NULL 化、resolved 済みは180日で削除を推奨（下部の定期SQLを pg_cron 等で）。
-- ============================================================

create table if not exists public.ai_unanswered (
  norm        text primary key,            -- サーバ生成の正規化キー（dedup）
  question    text not null,               -- 直近の生の質問（最大300字）
  hits        int  not null default 1,
  resolved    boolean not null default false,
  asker       uuid,                         -- 直近に聞いたプレイヤー(auth.uid())
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);

-- 既存テーブルにも CHECK 制約を冪等に付与
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_unanswered_question_len') then
    alter table public.ai_unanswered
      add constraint ai_unanswered_question_len check (char_length(question) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_unanswered_norm_len') then
    alter table public.ai_unanswered
      add constraint ai_unanswered_norm_len check (char_length(norm) between 1 and 200);
  end if;
end $$;

alter table public.ai_unanswered enable row level security;

-- 閲覧は管理者(is_admin)のみ
drop policy if exists ai_unanswered_admin_read on public.ai_unanswered;
create policy ai_unanswered_admin_read on public.ai_unanswered
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- resolved 等の更新も管理者のみ（[CODEX]6-1）
drop policy if exists ai_unanswered_admin_update on public.ai_unanswered;
create policy ai_unanswered_admin_update on public.ai_unanswered
  for update to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- 旧シグネチャを破棄（asker付き3引数 / n付き2引数）
drop function if exists public.log_unanswered(text, text, uuid);
drop function if exists public.log_unanswered(text, text);

-- 記録RPC：引数は q のみ。norm はサーバで生成（[CODEX]6-2）
create or replace function public.log_unanswered(q text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  nq  text := left(btrim(coalesce(q, '')), 300);
  nn  text;
begin
  if uid is null then return; end if;          -- 認証必須
  if char_length(nq) = 0 then return; end if;   -- 空質問は拒否
  -- 正規化：小文字化→空白除去→記号除去→200字上限
  nn := lower(nq);
  nn := regexp_replace(nn, '\s+', '', 'g');
  nn := regexp_replace(nn, '[、。，．・！!？?「」『』（）()【】_~〜:：]', '', 'g');
  nn := left(nn, 200);
  if char_length(nn) < 2 then return; end if;   -- 正規化後が極小なら捨てる

  insert into public.ai_unanswered as t (norm, question, asker, hits, last_at, resolved)
  values (nn, nq, uid, 1, now(), false)
  on conflict (norm) do update
    set hits     = t.hits + 1,
        question = excluded.question,
        asker    = excluded.asker,
        last_at  = now(),
        resolved = false;
end;
$func$;

revoke all on function public.log_unanswered(text) from public, anon;
grant execute on function public.log_unanswered(text) to authenticated;

-- ============================================================
-- 運用（管理者）
--   一覧:       select question, hits, last_at from public.ai_unanswered where not resolved order by hits desc;
--   反映済み化: update public.ai_unanswered set resolved = true where norm = '...';
-- PII定期クリーンアップ（pg_cron 等で定期実行を推奨）:
--   update public.ai_unanswered set asker = null where last_at < now() - interval '90 days';
--   delete from public.ai_unanswered where resolved and last_at < now() - interval '180 days';
-- ============================================================
