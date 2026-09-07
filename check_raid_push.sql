-- ============================================================
-- レイド通知 診断（1〜5は読み取りのみ。6の手動テストだけ実際に送信）
--   これで「cronが登録されているか / 実行が成功しているか / Edgeが何を返したか /
--   購読者がいるか」が分かる。通知が飛ばない原因の切り分け用。
--   ※特権ロール（cron/pg_netを見られる権限）で実行すること。
-- ============================================================

-- 1) cronジョブが登録されているか（空＝supabase_raid_push_cron_20260717.sql 未適用＝通知は絶対に飛ばない）
select jobname, schedule, active
from cron.job
where jobname like 'raid-push-%'
order by jobname;

-- 2) 直近のcron実行履歴（失敗していないか。statusがsucceeded以外なら要確認）
--    ※ job_run_details には jobname 列が無い（jobid のみ）ので cron.job と結合する
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname like 'raid-push-%'
order by d.start_time desc
limit 20;

-- 3) Edge関数からのHTTP応答（★最重要）
--    status_code=200 かつ content に "sent":N が見えれば送信できている。
--    403=CRON_SECRET不一致 / 503=VAPID未設定 / 500=鍵かDBエラー。
--    ※テーブル名は環境により net._http_response（先頭アンダースコア）。
--      エラーになる場合は net.http_response で試す。
select id, status_code, left(content::text, 300) as content, created
from net._http_response
order by created desc
limit 10;

-- 4) 購読者数（0なら誰も通知ONにしていない＝そもそも送り先がない）
select count(*)                          as total,
       count(*) filter (where notify_night) as night_on,
       count(*) filter (where notify_day)   as day_on
from push_subscriptions;

-- 5) 本日の昼枠の時刻（この時刻ちょうどに昼通知が飛ぶ）
select raid_day_slot((now() at time zone 'Asia/Tokyo')::date) as 昼枠時刻_jst;

-- 6) 手動テスト（今すぐ1回・夜扱いで送信）
--    <CRON_SECRET> を Edge のシークレット CRON_SECRET と同じ値に置換してから、この1文だけ実行。
--    実行後にもう一度 3) を見ると status_code と sent 件数が確認できる。
-- select net.http_post(
--   url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
--   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--   body    := '{"kind":"night"}'::jsonb
-- );
