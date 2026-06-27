-- ============================================================
-- レイド通知 cron：毎日21時/22時(JST)に Edge Function send-raid-push を叩く。
--   ・cronはUTCで動く → 21:00 JST = 12:00 UTC、22:00 JST = 13:00 UTC。
--   ・SQL Editor で「特権ロール」で実行すること（pg_cron/pg_net 拡張が要る）。
--   ・実行前に下の <CRON_SECRET> を、Edgeのシークレット CRON_SECRET と同じ値に置き換える。
--   ・プロジェクトref: jxbcuqwqtstxgmpiruuu （違うなら関数URLを直す）
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 再実行に備えて既存ジョブを掃除
do $$
begin
  if exists (select 1 from cron.job where jobname = 'raid-push-21') then perform cron.unschedule('raid-push-21'); end if;
  if exists (select 1 from cron.job where jobname = 'raid-push-22') then perform cron.unschedule('raid-push-22'); end if;
end $$;

-- 21:00 JST（12:00 UTC）
select cron.schedule('raid-push-21', '0 12 * * *', $job$
  select net.http_post(
    url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$job$);

-- 22:00 JST（13:00 UTC）
select cron.schedule('raid-push-22', '0 13 * * *', $job$
  select net.http_post(
    url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$job$);

-- 確認: select jobname, schedule, active from cron.job where jobname like 'raid-push-%';
-- 手動テスト（今すぐ1回送る）:
--   select net.http_post(
--     url:='https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
--     headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body:='{}'::jsonb);
