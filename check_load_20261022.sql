-- ============================================================
-- 本番の重さを見る（読むだけ・何も変えない）2026-10-22
--   ユーザー「V1のレイド機能あったらゲーム全体重くなるよね？そしたら停止してほしい。
--             他にV2に影響出そうなものがあれば教えて」
--   V1 と v2cap は同じデータベースを使っているので、どの処理がどれだけ時間を使っているかを数字で見る。
--
-- 出るもの（1つの表にまとめて出す。SQL Editor は最後の結果しか見せないため）
--   1 割合     … データベースの処理時間のうち、レイド／戦争／v2cap／そのほか が何%か
--   2 上位     … 処理時間をいちばん使っている処理 15 個（回数・合計秒・1回の平均ミリ秒・割合）
--   3 定期処理 … ここ24時間の回数・1回の平均ミリ秒・失敗の数
--   4 人数     … ここ1日／7日に遊んだ旧版の人数・v2cap のキャラ数・ここ7日のレイドの参加人数と攻撃回数
--   ※処理時間は「数え始め」から今までの合計（1 割合 の行に数え始めの日時が出る）
-- ============================================================
with
st as (
  select s.query, s.calls, s.total_exec_time::numeric as ms,   -- 小数のままだと round(…, 1) が使えない
         coalesce(substring(s.query from '"public"\."([a-z0-9_]+)"'),
                  substring(s.query from 'public\.([a-z0-9_]+)\('),
                  left(regexp_replace(s.query, '\s+', ' ', 'g'), 70)) as name
    from extensions.pg_stat_statements s
),
tot as (select sum(ms) as ms from st),
grp as (
  select case
           when name ~* 'raid' then 'レイド（旧版）'
           when name ~* '^war_|war_tick|war_regen' then '戦争（旧版）'
           when name ~* 'v2cap' then 'v2cap'
           when name ~* 'heartbeat|report_online_count' then '同時接続数（旧版）'
           else 'そのほか（旧版の出撃・ログイン・Supabase 自身など）'
         end as g,
         sum(ms) as ms, sum(calls) as calls
    from st group by 1
),
jobs as (
  select j.jobname, j.schedule, j.active,
         count(d.runid) as runs,
         round(avg(extract(epoch from (d.end_time - d.start_time)) * 1000)::numeric, 1) as avg_ms,
         count(*) filter (where d.status = 'failed') as fails
    from cron.job j
    left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '24 hours'
   group by j.jobname, j.schedule, j.active
)
select 1 as 順, row_number() over (order by ms desc) as n, '割合' as 区分, g as 名前,
       round(100 * ms / nullif((select ms from tot), 0), 1) || '%（' || calls || '回・' || round(ms / 1000) || '秒）' as くわしく
  from grp
union all
select 1, 99, '割合', '（数え始め）', coalesce((select stats_reset::text from extensions.pg_stat_statements_info), '不明')
union all
select * from (
  select 2, row_number() over (order by ms desc), '上位', name,
         calls || '回・合計' || round(ms / 1000) || '秒・平均' || round((ms / nullif(calls, 0))::numeric, 2) || 'ms・'
         || round(100 * ms / nullif((select ms from tot), 0), 1) || '%'
    from st order by ms desc limit 15
) top
union all
select 3, row_number() over (order by avg_ms * runs desc nulls last), '定期処理', jobname,
       schedule || '／' || case when active then '動いている' else '止まっている' end
       || '／24時間で' || runs || '回・平均' || coalesce(avg_ms::text, '-') || 'ms・失敗' || fails
  from jobs
union all
select 4, 1, '人数', '旧版で遊んだ人（1日／7日）',
       (select count(*) from profiles where greatest(last_seen_at, last_action_at) > now() - interval '1 day') || '人／'
       || (select count(*) from profiles where greatest(last_seen_at, last_action_at) > now() - interval '7 days') || '人'
union all
select 4, 2, '人数', 'v2cap のキャラ', (select count(*) from v2cap_profiles)::text || '人'
union all
select 4, 3, '人数', 'レイド（ここ7日）',
       (select count(*) from raid_boss where spawned_at > now() - interval '7 days') || '回出現・参加'
       || (select count(distinct p.player_id) from raid_participants p join raid_boss b on b.id = p.raid_id
            where b.spawned_at > now() - interval '7 days') || '人・攻撃'
       || (select coalesce(sum(p.attack_count), 0) from raid_participants p join raid_boss b on b.id = p.raid_id
            where b.spawned_at > now() - interval '7 days') || '回'
order by 1, 2;
