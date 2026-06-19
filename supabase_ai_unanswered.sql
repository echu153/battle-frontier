-- ============================================================
-- AI相談アシスタント：答えられなかった質問の自動集約
--   フォールバック時にクライアントが log_unanswered RPC を呼ぶ。
--   normalize 正規化キー(norm)で集約し hits を加算。後でKBに反映する。
-- セキュリティ（Codexレビュー[CODEX]4 反映）:
--   ・asker はクライアント指定を信用せず auth.uid() から取得
--   ・認証必須（uid が null なら何もしない）／空・極小入力は拒否／質問長は上限300
--   ・anon には付与しない（authenticated のみ EXECUTE）
--   ・閲覧は is_admin のみ（RLS）
-- ============================================================

create table if not exists public.ai_unanswered (
  norm        text primary key,            -- 正規化済みの質問（dedupキー）
  question    text not null,               -- 直近の生の質問（最大300字）
  hits        int  not null default 1,     -- 聞かれた回数
  resolved    boolean not null default false, -- KB反映済みフラグ
  asker       uuid,                         -- 直近に聞いたプレイヤー(auth.uid())
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);

alter table public.ai_unanswered enable row level security;

-- 閲覧は管理者(is_admin)のみ。書き込みは RPC(SECURITY DEFINER)経由のみ。
drop policy if exists ai_unanswered_admin_read on public.ai_unanswered;
create policy ai_unanswered_admin_read on public.ai_unanswered
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.is_admin));

-- 旧シグネチャ(asker付き・anon許可)が適用済みなら破棄
drop function if exists public.log_unanswered(text, text, uuid);

create or replace function public.log_unanswered(q text, n text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  nn  text := btrim(coalesce(n, ''));
begin
  if uid is null then return; end if;           -- 認証必須（匿名は記録しない）
  if length(nn) < 2 then return; end if;         -- 空・極小入力は拒否
  insert into public.ai_unanswered as t (norm, question, asker, hits, last_at, resolved)
  values (nn, left(coalesce(q, ''), 300), uid, 1, now(), false)
  on conflict (norm) do update
    set hits     = t.hits + 1,
        question = excluded.question,
        asker    = excluded.asker,
        last_at  = now(),
        resolved = false;                         -- 再度聞かれたら未対応へ戻す
end;
$func$;

-- anon からは叩けないようにし、ログイン済みユーザーのみ許可
revoke all on function public.log_unanswered(text, text) from public, anon;
grant execute on function public.log_unanswered(text, text) to authenticated;

-- 管理者が一覧を見るとき:
--   select question, hits, last_at from public.ai_unanswered where not resolved order by hits desc;
-- 反映済みにする:
--   update public.ai_unanswered set resolved = true where norm = '...';
