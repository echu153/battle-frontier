-- ============================================================
-- 自動成長NPC cron（③）— 2026-08-27
-- ------------------------------------------------------------
-- 5分おきに Edge Function「v2-npc-tick」を叩く。
--   ・NPCの成長（通算EXP）とアリーナへの挑戦は、この呼び出しだけで進む
--     ＝**誰もゲームを開いていない時間帯でも動き続ける**
--   ・成長は「前回のティックからの経過時間 × speed」なので、
--     間隔を変えても速度は変わらない（呼び出しが止まっていた間もまとめて追いつく）
--   ・挑戦の頻度は npc.js の arenaIntervalOf（20〜240分）が決める。
--     ここを5分より短くしても挑戦は増えない
--
-- 流す順番： ① supabase_v2_core.sql（全文）→ ② supabase_v2_npc_seed.sql → ③ このファイル
--
-- ⚠事前に必要なもの：
--   ・Edge Function をデプロイしておく（レイド通知と同じ手順）
--       node tools/v2-npc-fn-sync.mjs        ← src/v2/lib を _lib へコピー
--       supabase functions deploy v2-npc-tick
--   ・Edge のシークレット CRON_SECRET を設定しておく（レイド通知と同じ値でよい）
--       supabase secrets set CRON_SECRET=＜秘密の文字列＞
--   ・SQL Editor で「特権ロール」で実行する（pg_cron / pg_net が要る）
--   ・下の <CRON_SECRET> を実際の値に置き換える
--   ・プロジェクトref: jxbcuqwqtstxgmpiruuu （違うなら関数URLを直す）
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 再実行に備えて既存ジョブを掃除
do $$
begin
  if exists (select 1 from cron.job where jobname = 'v2-npc-tick') then perform cron.unschedule('v2-npc-tick'); end if;
end $$;

select cron.schedule('v2-npc-tick', '*/5 * * * *', $job$
  select net.http_post(
    url     := 'https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/v2-npc-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$job$);

-- 確認: select jobname, schedule, active from cron.job where jobname = 'v2-npc-tick';
-- 手動で1回動かす（動作確認）:
--   select net.http_post(
--     url:='https://jxbcuqwqtstxgmpiruuu.functions.supabase.co/v2-npc-tick',
--     headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body:='{}'::jsonb);
--
-- 止めたいとき:
--   select cron.unschedule('v2-npc-tick');            -- 全部止める
--   update public.v2_npcs set active = false;          -- NPCだけ止める（cronは回ったまま）
--   update public.v2_npcs set active = false where id = 7;  -- 1体だけ止める
