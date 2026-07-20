-- ============================================================
-- 娯楽ゲームのGold賭けシステム (2026-07-18)
-- 双極盤/トランプ広場(大富豪・スピード・7ならべ・ババ抜き)用
-- 仕組み:
--   1) 対局開始時に参加者全員が wager_join でベット額を供託(Goldから差し引き)
--   2) 対局終了時に各参加者クライアントが wager_report で勝者を報告
--      → 過半数(参加者の50%超)が同じ勝者に一致した時点でポットを勝者へ払い出し
--      → 「引き分け/NPC勝ち」は p_winner=NULL で報告 → 一致で全員に返金
--   3) 報告が揃わず放置された場合は wager_refund_stale で2時間後に誰でも返金可
-- 単独では実行可能(他SQLと非依存)。profiles.gold の保護トリガーにはGUCで対応済
-- ============================================================

create table if not exists public.game_wagers (
  key text primary key,                     -- 部屋ID:開始時刻 (クライアント生成)
  game_type text not null,
  bet bigint not null check (bet > 0 and bet <= 10000000),
  pot bigint not null default 0,
  status text not null default 'open',      -- open | settled | refunded
  participants uuid[] not null default '{}',
  reports jsonb not null default '{}'::jsonb, -- reporter_uuid -> winner_uuid or 'refund'
  winner uuid,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

alter table public.game_wagers enable row level security;
drop policy if exists game_wagers_select on public.game_wagers;
create policy game_wagers_select on public.game_wagers
  for select to authenticated using (auth.uid() = any(participants));

-- ---- 参加(供託) ----
create or replace function public.wager_join(p_key text, p_game_type text, p_bet bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row game_wagers;
  v_gold bigint;
begin
  if p_bet is null or p_bet <= 0 or p_bet > 10000000 then
    return jsonb_build_object('error', 'ベット額が不正です');
  end if;
  perform set_config('app.allow_stat_change', 'on', true);

  insert into game_wagers(key, game_type, bet)
  values (p_key, p_game_type, p_bet)
  on conflict (key) do nothing;

  select * into v_row from game_wagers where key = p_key for update;
  if v_row.status <> 'open' then return jsonb_build_object('error', '受付終了しています'); end if;
  if v_row.bet <> p_bet then return jsonb_build_object('error', 'ベット額が一致しません'); end if;
  if auth.uid() = any(v_row.participants) then return jsonb_build_object('ok', true, 'already', true); end if;
  if array_length(v_row.participants, 1) >= 8 then return jsonb_build_object('error', '満員です'); end if;

  select gold into v_gold from profiles where id = auth.uid() for update;
  if v_gold is null or v_gold < p_bet then
    return jsonb_build_object('error', 'Goldが足りません');
  end if;
  update profiles set gold = gold - p_bet where id = auth.uid();
  update game_wagers
     set participants = participants || auth.uid(),
         pot = pot + p_bet
   where key = p_key;
  return jsonb_build_object('ok', true, 'pot', v_row.pot + p_bet);
end;
$$;

-- ---- 結果報告(過半数一致で精算) ----
-- p_winner: 勝者のUUID。引き分け/NPC勝ちは NULL(返金希望)
create or replace function public.wager_report(p_key text, p_winner uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row game_wagers;
  v_val text;
  v_agree int;
  v_need int;
  v_uid uuid;
begin
  perform set_config('app.allow_stat_change', 'on', true);
  select * into v_row from game_wagers where key = p_key for update;
  if v_row is null then return jsonb_build_object('error', '賭けが見つかりません'); end if;
  if v_row.status <> 'open' then return jsonb_build_object('ok', true, 'status', v_row.status); end if;
  if not (auth.uid() = any(v_row.participants)) then
    return jsonb_build_object('error', '参加者ではありません');
  end if;
  if p_winner is not null and not (p_winner = any(v_row.participants)) then
    return jsonb_build_object('error', '勝者が参加者ではありません');
  end if;

  v_val := coalesce(p_winner::text, 'refund');
  update game_wagers
     set reports = reports || jsonb_build_object(auth.uid()::text, v_val)
   where key = p_key
  returning * into v_row;

  -- 過半数(50%超)が同じ値なら確定
  v_need := array_length(v_row.participants, 1) / 2 + 1;
  select count(*) into v_agree from jsonb_each_text(v_row.reports) where value = v_val;
  if v_agree < v_need then
    return jsonb_build_object('ok', true, 'pending', true);
  end if;

  if v_val = 'refund' then
    foreach v_uid in array v_row.participants loop
      update profiles set gold = gold + v_row.bet where id = v_uid;
    end loop;
    update game_wagers set status = 'refunded', settled_at = now() where key = p_key;
    return jsonb_build_object('ok', true, 'status', 'refunded', 'refund', v_row.bet);
  end if;

  update profiles set gold = gold + v_row.pot where id = p_winner;
  update game_wagers set status = 'settled', winner = p_winner, settled_at = now() where key = p_key;
  return jsonb_build_object('ok', true, 'status', 'settled', 'pot', v_row.pot, 'winner', p_winner);
end;
$$;

-- ---- 放置された賭けの返金(2時間経過後・参加者なら誰でも) ----
create or replace function public.wager_refund_stale(p_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row game_wagers;
  v_uid uuid;
begin
  perform set_config('app.allow_stat_change', 'on', true);
  select * into v_row from game_wagers where key = p_key for update;
  if v_row is null then return jsonb_build_object('error', '賭けが見つかりません'); end if;
  if v_row.status <> 'open' then return jsonb_build_object('ok', true, 'status', v_row.status); end if;
  if not (auth.uid() = any(v_row.participants)) then
    return jsonb_build_object('error', '参加者ではありません');
  end if;
  if v_row.created_at > now() - interval '2 hours' then
    return jsonb_build_object('error', 'まだ返金できません(開始から2時間後に可能)');
  end if;
  foreach v_uid in array v_row.participants loop
    update profiles set gold = gold + v_row.bet where id = v_uid;
  end loop;
  update game_wagers set status = 'refunded', settled_at = now() where key = p_key;
  return jsonb_build_object('ok', true, 'status', 'refunded');
end;
$$;

revoke all on function public.wager_join(text, text, bigint) from public, anon;
revoke all on function public.wager_report(text, uuid) from public, anon;
revoke all on function public.wager_refund_stale(text) from public, anon;
grant execute on function public.wager_join(text, text, bigint) to authenticated;
grant execute on function public.wager_report(text, uuid) to authenticated;
grant execute on function public.wager_refund_stale(text) to authenticated;
