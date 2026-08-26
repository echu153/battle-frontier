// ============================================================
// 自動成長NPC 100体の投入SQLを作る（node tools/v2-npc-seed.mjs）
// ------------------------------------------------------------
//   出力 … supabase_v2_npc_seed.sql
//   中身の正は src/v2/lib/npc.js。**手でSQLを書き足さないこと**
//   （名前・職業・成長速度・初期の強さを変えたいときは npc.js を直してここを流し直す）
//
// ★何度流しても壊れない（on conflict do nothing）。
//   既にいるNPCの進行度は書き換えない＝作り直したいときは delete してから流す。
// ============================================================
import { writeFileSync } from 'node:fs'
import { seedListOf, snapshotOfNpc, progressOf, mulberry32, arenaDelayOf } from '../src/v2/lib/npc.js'

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const rows = seedListOf()

const npcValues = rows.map(n => {
  const id = n.idx + 1
  // 挑戦する時刻をばらけさせる（全員が同じ分に動かないように）
  const delay = arenaDelayOf(n.speed, mulberry32(n.seed + 31))
  return `  (${id}, ${q(n.name)}, ${q(n.cls)}, ${n.seed}, ${n.speed}, ${n.total_exp}, ${n.arena_floor},` +
    ` now() - interval '${n.born_hours_ago} hours', now(), now() + interval '${delay} minutes')`
}).join(',\n')

// 最初から座らせるぶん（半数）。空いている階にだけ入れる
const seats = rows.filter(n => n.defending).map(n => {
  const id = n.idx + 1
  const snap = snapshotOfNpc({ ...n, id })
  return `  (${n.arena_floor}, ${id}, ${q(JSON.stringify(snap))}::jsonb, ${snap.stats.hp}, ${snap.stats.mp})`
}).join(',\n')

const summary = rows.filter((_, i) => i % 11 === 0).map(n => {
  const p = progressOf(n.total_exp)
  return `--   ${String(n.idx + 1).padStart(3)} ${n.name}（${n.cls}）速度${n.speed}EXP/時　${n.arena_floor}階　戦闘力${n.power}　LV${p.lv}／転職${p.jobs}回`
}).join('\n')

const sql = `-- ============================================================
-- 自動成長NPC 100体の投入（②）— 2026-08-27
-- ------------------------------------------------------------
-- ★このファイルは tools/v2-npc-seed.mjs が作る。手で直さないこと。
--   中身の正は src/v2/lib/npc.js（名前・職業・成長速度・初期の強さ）。
--
-- 流す順番： ① supabase_v2_core.sql（全文）→ ② このファイル → ③ supabase_v2_npc_cron.sql
--
-- 何度流しても壊れない（on conflict do nothing）。
-- **作り直したいときは先に delete from public.v2_npcs; を流してから**（進行度が消えます）
--
-- 11体ごとに抜き出した様子（作った直後）：
${summary}
-- ============================================================
insert into public.v2_npcs (id, name, cls, seed, speed, total_exp, arena_floor, born_at, last_tick_at, next_arena_at)
values
${npcValues}
on conflict (id) do nothing;

-- 最初から階層守護者として座らせるぶん（半数）。
-- ★空いている階にだけ入れる＝すでにプレイヤーやNPCが座っている席は動かさない
insert into public.v2_arena_floors (floor, npc_id, snapshot, hp, mp)
values
${seats}
on conflict (floor) do nothing;

-- 確認（任意）
-- select id, name, cls, speed, total_exp, arena_floor from public.v2_npcs order by id;
-- select floor, npc_id, snapshot->>'name' as name from public.v2_arena_floors order by floor;
`

writeFileSync(new URL('../supabase_v2_npc_seed.sql', import.meta.url), sql)
console.log(`supabase_v2_npc_seed.sql を書きました（NPC ${rows.length}体 / 初期の席 ${rows.filter(n => n.defending).length}）`)
