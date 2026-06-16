-- 博物館 寄贈数ランキングのサーバー側集計RPC
-- 全museum_donationsレコードをクライアントへ送らず、上位50だけ返す（Egress削減）。
-- 読み取り専用のためステ保護トリガー(protect_stats)とは無関係。実行順の制約なし。
create or replace function get_museum_ranking()
returns table (
  id uuid,
  username text,
  lv int,
  char_lv int,
  class text,
  avatar_url text,
  retraining jsonb,
  donation_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.lv, p.char_lv, p.class, p.avatar_url, p.retraining,
         count(d.id) as donation_count
  from museum_donations d
  join profiles p on p.id = d.player_id
  where coalesce(p.exclude_from_ranking, false) = false
  group by p.id
  order by donation_count desc, p.char_lv desc
  limit 50;
$$;

grant execute on function get_museum_ranking() to anon, authenticated;
