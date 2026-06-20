-- ============================================================
-- AI相談「ジェミータ」の会話ログ（質問＋回答＋種別）。管理者がSupabaseでSELECTして確認する。
--   ・記録は log_chat RPC（SECURITY DEFINER）経由のみ。user_id はサーバーが auth.uid() で確定。
--   ・閲覧は is_admin のみ（RLS）。
--   ・source = 'llm'(AIが生成) / 'rule'(ルールベースが回答) / 'template'(定型・フォールバック) / 'blocked'(不適切で拒否)
--   ・kind   = askAssistant の内部種別（kb/db/class/advice/matchup/fallback/chat など。詳細確認用）
--   ※クライアント記録のため厳密な改ざん耐性はない（運営の利用状況把握・KB育成が目的）。
-- ============================================================

create table if not exists public.ai_chat_log (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  asked_at  timestamptz not null default now(),
  question  text not null,
  answer    text not null,
  source    text not null,
  kind      text
);
create index if not exists idx_ai_chat_log_asked_at on public.ai_chat_log (asked_at desc);
create index if not exists idx_ai_chat_log_user     on public.ai_chat_log (user_id);

alter table public.ai_chat_log enable row level security;

-- 閲覧は管理者のみ
drop policy if exists ai_chat_log_admin_select on public.ai_chat_log;
create policy ai_chat_log_admin_select on public.ai_chat_log
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
-- INSERT/UPDATE/DELETE のポリシーは作らない＝直接書き込み不可。記録は下記 RPC（SECURITY DEFINER）経由のみ。

create or replace function public.log_chat(p_question text, p_answer text, p_source text, p_kind text default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if coalesce(p_question, '') = '' then return; end if;
  insert into public.ai_chat_log (user_id, question, answer, source, kind)
  values (
    uid,
    left(p_question, 500),
    left(coalesce(p_answer, ''), 4000),
    case when p_source in ('llm', 'rule', 'template', 'blocked') then p_source else 'rule' end,
    nullif(left(coalesce(p_kind, ''), 32), '')
  );
end;
$func$;

revoke all on function public.log_chat(text, text, text, text) from public, anon;
grant execute on function public.log_chat(text, text, text, text) to authenticated;

-- 確認の例（Supabase SQL Editor で管理者として）:
--   最近の会話:        select asked_at, source, kind, question, answer from ai_chat_log order by asked_at desc limit 100;
--   プレイヤー別件数:  select p.username, count(*) from ai_chat_log l join profiles p on p.id=l.user_id group by 1 order by 2 desc;
--   よくある質問:      select question, count(*) from ai_chat_log group by 1 order by 2 desc limit 50;
--   AIが答えた割合:    select source, count(*) from ai_chat_log group by 1 order by 2 desc;
