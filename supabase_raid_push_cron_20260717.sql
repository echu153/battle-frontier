-- ============================================================
-- レイド通知 cron（昼枠対応版・2026-07-17）
--   ・夜: 21時/22時(JST) → body {"kind":"night"}（notify_night=true の購読だけに送る）
--   ・昼: 12〜17時(JST) の毎時に仕掛けておき、
--         「その日の昼枠がその時刻のときだけ」送る（raid_day_slot で判定）→ body {"kind":"day"}
--   ・cronはUTCで動く → JST = UTC+9（21時=12:00 UTC / 12時=03:00 UTC …）
--
--   ・SQL Editor で「特権ロール」で実行すること（pg_cron/pg_net が要る）。
--   ・実行前に <CRON_SECRET> を Edge のシークレット CRON_SECRET と同じ値へ置換すること。
--   ・先に supabase_raid_day_20260717.sql（raid_day_slot を作る）を適用しておくこと。
--   ・Edge Function send-raid-push の再デプロイも必要（kind で購読を絞る対応が入っている）。
--   ・プロジェクトref: jxbcuqwqtstxgmpiruuu （違うなら関数URLを直す）
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 再実行に備えて既存ジョブを掃除（旧21/22時ジョブも作り直す）
do $$
declare j text;
begin
  foreach j in array array['raid-push-21','raid-push-22',
                           'raid-push-day-12','raid-push-day-13','raid-push-day-14',
                           'raid-push-day-15','raid-push-day-16','raid-push-day-17'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

-- ▼ 夜（固定・従来どおり）
select cron.schedule('raid-push-21', '0 12 * * *', $job$
  select net.http_post(
    url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{"kind":"night"}'::jsonb
  );
$job$);

select cron.schedule('raid-push-22', '0 13 * * *', $job$
  select net.http_post(
    url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{"kind":"night"}'::jsonb
  );
$job$);

-- ▼ 昼（12〜17時ぶんを仕掛けておき、その日の昼枠に当たる時刻だけが実際に送る）
--    where 句で弾くので、当たらない時間帯は http_post 自体が実行されない。
do $$
declare h int;
begin
  for h in 12..17 loop
    perform cron.schedule(
      'raid-push-day-' || h,
      (0 || ' ' || (h - 9) || ' * * *'),   -- JST h時 = UTC (h-9)時
      format($job$
        select net.http_post(
          url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
          body    := '{"kind":"day"}'::jsonb
        )
        where raid_day_slot((now() at time zone 'Asia/Tokyo')::date) = %s;
      $job$, h)
    );
  end loop;
end $$;

-- 確認: select jobname, schedule, active from cron.job where jobname like 'raid-push-%' order by jobname;
-- 本日の昼枠の確認: select raid_day_slot((now() at time zone 'Asia/Tokyo')::date);
-- 手動テスト（今すぐ1回・夜扱いで送る）:
--   select net.http_post(
--     url:='https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/send-raid-push',
--     headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body:='{"kind":"night"}'::jsonb);
