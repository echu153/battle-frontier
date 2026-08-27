// ============================================================
// 自動成長NPC 100体の投入SQLを作る（node tools/v2-npc-seed.mjs）
// ------------------------------------------------------------
//   出力 … supabase_v2_npc_seed.sql       … ②（100体を入れる。動くのは開発中の数体だけ）
//          supabase_v2_npc_deploy_all.sql … ④（一般公開のときに残りを一斉に起こす）
//
//   中身の正は src/v2/lib/npc.js。**手でSQLを書き足さないこと**
//   （名前・職業・成長速度・初期の強さ・開発中に動かす顔ぶれは npc.js を直してここを流し直す）
//
// ★何度流しても壊れない（on conflict do nothing）。
//   既にいるNPCの進行度は書き換えない＝作り直したいときは delete してから流す。
// ============================================================
import { writeFileSync } from 'node:fs'
import {
  seedListOf, snapshotOfNpc, progressOf, mulberry32, arenaDelayOf, isDevActive, DEV_ACTIVE_IDS,
} from '../src/v2/lib/npc.js'

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const rows = seedListOf().map(n => ({ ...n, id: n.idx + 1 }))
const seatLine = (n) => {
  const snap = snapshotOfNpc(n)
  return `  (${n.arena_floor}, ${n.id}, ${q(JSON.stringify(snap))}::jsonb, ${snap.stats.hp}, ${snap.stats.mp})`
}
const line = (n) => {
  const p = progressOf(n.total_exp)
  return `--   ${String(n.id).padStart(3)} ${n.name}（${n.cls}）速度${n.speed}EXP/時　${n.arena_floor}階　` +
    `戦闘力${n.power}　LV${p.lv}／転職${p.jobs}回　${n.defending ? '守る側' : '挑む側'}`
}

// ===== ② 100体を入れる =====
// 動かすのは DEV_ACTIVE_IDS の数体だけ。残りは active=false で眠らせておく
const npcValues = rows.map(n => {
  const delay = arenaDelayOf(n.speed, mulberry32(n.seed + 31))
  return `  (${n.id}, ${q(n.name)}, ${q(n.cls)}, ${n.seed}, ${n.speed}, ${n.total_exp}, ${n.arena_floor},` +
    ` ${isDevActive(n.id)}, now() - interval '${n.born_hours_ago} hours', now(), now() + interval '${delay} minutes')`
}).join(',\n')

const devRows = rows.filter(n => isDevActive(n.id))
const devSeats = devRows.filter(n => n.defending).map(seatLine).join(',\n')

const seedSql = `-- ============================================================
-- 自動成長NPC 100体の投入（②）— 2026-08-27
-- ------------------------------------------------------------
-- ★このファイルは tools/v2-npc-seed.mjs が作る。手で直さないこと。
--   中身の正は src/v2/lib/npc.js（名前・職業・成長速度・初期の強さ・開発中に動かす顔ぶれ）。
--
-- 流す順番： ① supabase_v2_core.sql（全文）→ ② このファイル → ③ supabase_v2_npc_cron.sql
--            そして**v2の一般公開と同時に** ④ supabase_v2_npc_deploy_all.sql
--
-- ★100体すべてを入れるが、**実際に動くのは開発中の${devRows.length}体だけ**（active = true）。
--   残り${rows.length - devRows.length}体は active = false で眠っていて、成長もしないし挑戦もしてこない。
--   ④を流した瞬間に全員が起き出す。
--
-- 開発中に動く${devRows.length}体（1階・2階・6階に「ゆっくり守る側」と「速い挑む側」を1体ずつ）：
${devRows.map(line).join('\n')}
--
-- 何度流しても壊れない（on conflict do nothing）。
-- **作り直したいときは先に delete from public.v2_npcs; を流してから**（進行度が消えます）
-- ============================================================
insert into public.v2_npcs (id, name, cls, seed, speed, total_exp, arena_floor, active, born_at, last_tick_at, next_arena_at)
values
${npcValues}
on conflict (id) do nothing;

-- 開発中に動くぶんのうち「守る側」を席に着かせる。
-- ★空いている階にだけ入れる＝すでにプレイヤーやNPCが座っている席は動かさない
insert into public.v2_arena_floors (floor, npc_id, snapshot, hp, mp)
values
${devSeats}
on conflict (floor) do nothing;

-- 確認（任意）
-- select id, name, cls, speed, arena_floor, active from public.v2_npcs order by id;
-- select count(*) filter (where active) as 動いている, count(*) as 全部 from public.v2_npcs;
-- select floor, npc_id, snapshot->>'name' as name from public.v2_arena_floors order by floor;
`

// ===== ④ 一般公開のときに残りを起こす =====
const restSeats = rows.filter(n => !isDevActive(n.id) && n.defending).map(seatLine).join(',\n')

const deploySql = `-- ============================================================
-- 自動成長NPC 残り全部を展開する（④）— **v2の一般公開と同時に流す**
-- ------------------------------------------------------------
-- ★このファイルは tools/v2-npc-seed.mjs が作る。手で直さないこと。
--
-- ②で入れておいた${rows.length}体のうち、眠っていた${rows.length - devRows.length}体を一斉に起こす。
-- 起きた瞬間から、それぞれの速度で育ち、それぞれの間隔でアリーナに挑戦しはじめる。
--
-- ★last_tick_at を now() に直しているのが肝。
--   これをやらないと「眠っていた期間 × 速度」ぶんの成長が**まとめて1回で入って**、
--   全員が一気に最上階の強さになる。眠っている間は育たない、が正しい。
-- ★next_arena_at は id ごとに0〜59分ずらす。全員が同じ分に挑戦して詰まらないように。
--
-- 何度流しても壊れない（起きているNPCには触らない）。
-- ============================================================
update public.v2_npcs
   set active        = true,
       last_tick_at  = now(),
       next_arena_at = now() + ((id % 60) * interval '1 minute'),
       updated_at    = now()
 where not active;

-- 眠っていたぶんのうち「守る側」を席に着かせる。
-- ★空いている階にだけ入れる＝プレイヤーが守っている席は絶対に奪わない
insert into public.v2_arena_floors (floor, npc_id, snapshot, hp, mp)
values
${restSeats}
on conflict (floor) do nothing;

-- 確認（任意）
-- select count(*) filter (where active) as 動いている, count(*) as 全部 from public.v2_npcs;
-- select floor, npc_id, player_id, snapshot->>'name' as name from public.v2_arena_floors order by floor;
`

writeFileSync(new URL('../supabase_v2_npc_seed.sql', import.meta.url), seedSql)
writeFileSync(new URL('../supabase_v2_npc_deploy_all.sql', import.meta.url), deploySql)
console.log(`supabase_v2_npc_seed.sql（${rows.length}体・うち動くのは ${DEV_ACTIVE_IDS.join(',')} の${devRows.length}体／初期の席${devRows.filter(n => n.defending).length}）`)
console.log(`supabase_v2_npc_deploy_all.sql（残り${rows.length - devRows.length}体を起こす／席${rows.filter(n => !isDevActive(n.id) && n.defending).length}）`)
