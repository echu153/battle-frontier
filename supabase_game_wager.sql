-- ============================================================
-- 娯楽ゲームのGold賭けシステム (2026-07-18)
-- 双極盤/トランプ広場(大富豪・スピード・7ならべ・ババ抜き)用
-- 仕組み:
--   1) 対局開始時に参加者全員が wager_join でベット額を供託(Goldから差し引き)
--   2) 対局終了時に各参加者クライアントが wager_report で勝者を報告
--      → 過半数(参加者の50%超)が同じ勝者に一致した時点でポットを勝者へ払い出し
--      → 「引き分け/NPC勝ち」は p_winner=NULL で報告 → 一致で全員に返金
--   3) 報告が揃わず放置された場合は wager_refund_stale で2時間後に誰でも返金可
--   4) 対局中に切断(無効試合)が起きた場合は wager_forfeit で「落ちた人」を負け扱いにし
--      残った参加者へポットを払い出す(全員の掛け金が供託に消えたままになるのを防ぐ)。
--      なりすまし防止のため wager_ping のプレゼンス(最終確認時刻)が新しい相手は離脱指定不可。
-- 単独では実行可能(他SQLと非依存)。profiles.gold の保護トリガーにはGUCで対応済
-- 再実行可能(create or replace / add column if not exists)。
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

-- 無効試合(切断)対応の追加列(既存テーブルにも安全に追加)
alter table public.game_wagers add column if not exists forfeited uuid[] not null default '{}';       -- 離脱(負け)確定した参加者
alter table public.game_wagers add column if not exists forfeit_votes jsonb not null default '{}'::jsonb; -- voter_uuid -> loser_uuid
alter table public.game_wagers add column if not exists last_seen jsonb not null default '{}'::jsonb;  -- uuid -> epoch秒(プレゼンス)

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
         pot = pot + p_bet,
         last_seen = last_seen || jsonb_build_object(auth.uid()::text, extract(epoch from now())::bigint)
   where key = p_key;
  return jsonb_build_object('ok', true, 'pot', v_row.pot + p_bet);
end;
$$;

-- ---- プレゼンス更新(在室ハートビート) ----
-- 定期的に呼ぶことで「まだ居る」ことを記録。切断者(last_seenが古い者)だけが離脱指定できる。
create or replace function public.wager_ping(p_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row game_wagers;
begin
  select * into v_row from game_wagers where key = p_key for update;
  if v_row is null then return jsonb_build_object('error', '賭けが見つかりません'); end if;
  if v_row.status <> 'open' then return jsonb_build_object('ok', true, 'status', v_row.status); end if;
  if not (auth.uid() = any(v_row.participants)) then
    return jsonb_build_object('error', '参加者ではありません');
  end if;
  update game_wagers
     set last_seen = last_seen || jsonb_build_object(auth.uid()::text, extract(epoch from now())::bigint)
   where key = p_key;
  return jsonb_build_object('ok', true);
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
  v_active uuid[];
begin
  perform set_config('app.allow_stat_change', 'on', true);
  select * into v_row from game_wagers where key = p_key for update;
  if v_row is null then return jsonb_build_object('error', '賭けが見つかりません'); end if;
  if v_row.status <> 'open' then return jsonb_build_object('ok', true, 'status', v_row.status); end if;
  if not (auth.uid() = any(v_row.participants)) then
    return jsonb_build_object('error', '参加者ではありません');
  end if;
  if auth.uid() = any(v_row.forfeited) then
    return jsonb_build_object('error', '離脱扱いのため報告できません');
  end if;
  if p_winner is not null and not (p_winner = any(v_row.participants)) then
    return jsonb_build_object('error', '勝者が参加者ではありません');
  end if;
  if p_winner is not null and p_winner = any(v_row.forfeited) then
    return jsonb_build_object('error', '離脱者を勝者にはできません');
  end if;

  v_val := coalesce(p_winner::text, 'refund');
  update game_wagers
     set reports = reports || jsonb_build_object(auth.uid()::text, v_val),
         last_seen = last_seen || jsonb_build_object(auth.uid()::text, extract(epoch from now())::bigint)
   where key = p_key
  returning * into v_row;

  -- 精算は「離脱していないアクティブ参加者」の過半数一致で確定
  select array(select u from unnest(v_row.participants) u where not (u = any(v_row.forfeited))) into v_active;
  v_need := coalesce(array_length(v_active, 1), 0) / 2 + 1;
  -- 一致数はアクティブな報告者のみ数える(離脱者の古い報告は無視)
  select count(*) into v_agree
    from jsonb_each_text(v_row.reports) r
   where r.value = v_val and r.key::uuid = any(v_active);
  if v_agree < v_need then
    return jsonb_build_object('ok', true, 'pending', true);
  end if;

  if v_val = 'refund' then
    -- 返金はアクティブ参加者のみ(離脱者は掛け金を失う)
    foreach v_uid in array v_active loop
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

-- ---- 無効試合(切断)処理: 落ちた人を負け扱いにして残りへ払い出す ----
-- p_loser: 切断した(負けにする)参加者。
--   ・なりすまし防止: p_loser の last_seen が40秒以内に更新されていれば拒否(まだ居る)。
--   ・悪用防止: 「被指名を除くアクティブ参加者」の過半数が同じ相手を指名して初めて離脱確定
--     (1対1では残った1人=過半数なので即確定。3人以上では多数決が必要)。
--   ・確定後アクティブが1人になればポット全額をその1人へ払い出す。
create or replace function public.wager_forfeit(p_key text, p_loser uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row game_wagers;
  v_now bigint;
  v_seen bigint;
  v_active uuid[];
  v_eligible int;
  v_votes int;
  v_need int;
  v_winner uuid;
begin
  perform set_config('app.allow_stat_change', 'on', true);
  select * into v_row from game_wagers where key = p_key for update;
  if v_row is null then return jsonb_build_object('error', '賭けが見つかりません'); end if;
  if v_row.status <> 'open' then return jsonb_build_object('ok', true, 'status', v_row.status); end if;
  if not (auth.uid() = any(v_row.participants)) then
    return jsonb_build_object('error', '参加者ではありません');
  end if;
  if auth.uid() = any(v_row.forfeited) then
    return jsonb_build_object('error', '離脱扱いのため操作できません');
  end if;
  if p_loser is null or not (p_loser = any(v_row.participants)) then
    return jsonb_build_object('error', '対象が参加者ではありません');
  end if;
  if p_loser = auth.uid() then
    return jsonb_build_object('error', '自分は指定できません');
  end if;
  if p_loser = any(v_row.forfeited) then
    return jsonb_build_object('ok', true, 'status', v_row.status, 'forfeited', p_loser);
  end if;

  -- プレゼンス確認: 相手がまだ居る(40秒以内に確認済み)なら離脱指定不可
  v_now := extract(epoch from now())::bigint;
  v_seen := nullif(v_row.last_seen ->> p_loser::text, '')::bigint;
  if v_seen is not null and v_now - v_seen <= 40 then
    return jsonb_build_object('error', 'まだ切断が確定していません');
  end if;

  -- 離脱投票を記録(同時に自分のプレゼンスも更新)
  update game_wagers
     set forfeit_votes = forfeit_votes || jsonb_build_object(auth.uid()::text, p_loser::text),
         last_seen = last_seen || jsonb_build_object(auth.uid()::text, v_now)
   where key = p_key
  returning * into v_row;

  -- アクティブ(未離脱)参加者と、被指名を除く投票権者数
  select array(select u from unnest(v_row.participants) u where not (u = any(v_row.forfeited))) into v_active;
  select count(*) into v_eligible from unnest(v_active) u where u <> p_loser;
  v_need := v_eligible / 2 + 1;
  -- p_loser への有効投票数(アクティブな投票者・本人以外)
  select count(*) into v_votes
    from jsonb_each_text(v_row.forfeit_votes) fv
   where fv.value = p_loser::text
     and fv.key::uuid = any(v_active)
     and fv.key::uuid <> p_loser;
  if v_votes < v_need then
    return jsonb_build_object('ok', true, 'pending', true);
  end if;

  -- 離脱確定
  update game_wagers set forfeited = forfeited || p_loser where key = p_key returning * into v_row;
  select array(select u from unnest(v_row.participants) u where not (u = any(v_row.forfeited))) into v_active;

  -- アクティブが1人だけになったらポット全額をその1人へ払い出し
  if array_length(v_active, 1) = 1 then
    v_winner := v_active[1];
    update profiles set gold = gold + v_row.pot where id = v_winner;
    update game_wagers set status = 'settled', winner = v_winner, settled_at = now() where key = p_key;
    return jsonb_build_object('ok', true, 'status', 'settled', 'pot', v_row.pot, 'winner', v_winner);
  end if;

  -- まだ複数残っている(多人数戦) → 通常の勝者報告(wager_report)で決着
  return jsonb_build_object('ok', true, 'status', 'open', 'forfeited', p_loser);
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
revoke all on function public.wager_ping(text) from public, anon;
revoke all on function public.wager_forfeit(text, uuid) from public, anon;
grant execute on function public.wager_join(text, text, bigint) to authenticated;
grant execute on function public.wager_report(text, uuid) to authenticated;
grant execute on function public.wager_refund_stale(text) to authenticated;
grant execute on function public.wager_ping(text) to authenticated;
grant execute on function public.wager_forfeit(text, uuid) to authenticated;
