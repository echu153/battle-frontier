-- ============================================================
-- V2 初期構成をデータベースから消す（2026-10-22）／② 5分ごとの v2-npc-tick を止める
--   1_check → **2_stop_cron（これ）** → 本番の関数 v2-npc-tick を消す → 3_drop
--
-- ★あとから戻せる（戻すときは supabase_v2_npc_cron.sql を流し直す）。
-- ★止めるのは V2 の NPC を動かす定期処理だけ。レイド通知（raid-push-*）・戦争・同時接続数など
--   旧版の定期処理には触らない（名前と中身で選ぶ）。
-- ============================================================
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select jobid, jobname
      from cron.job
     where jobname = 'v2-npc-tick'
        or command ilike '%v2-npc-tick%'
  loop
    perform cron.unschedule(r.jobid);
    n := n + 1;
    raise notice '止めた: %（jobid %）', r.jobname, r.jobid;
  end loop;
  raise notice '止めた定期処理: % 個', n;
end $$;

-- 残っている定期処理（v2-npc-tick が無ければよい）
select jobname, schedule, active from cron.job order by jobname;
