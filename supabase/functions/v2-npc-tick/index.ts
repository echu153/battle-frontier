// ============================================================
// 自動成長NPC ティック（v2-npc-tick）— 2026-08-27
// ------------------------------------------------------------
// pg_cron が数分おきに x-cron-secret 付きで叩く（supabase_v2_npc_cron.sql）。
// やることは2つだけ：
//   ① 成長 … 前回からの経過時間 × speed だけ通算EXPを足す（上限で止まる）
//   ② アリーナ … 挑戦の時刻が来たNPCが、いまいる階の階層守護者へ挑む
//      ★勝敗は**本物の runBattle**（src/v2/lib/battle.js のコピー）が決める。
//        スキルも状態異常も職業補正も、プレイヤーが戦うときとまったく同じ。
//      ★守っていて、その階には強すぎる／守りすぎているNPCは自分から席を降りる。
//
// 中身の正は src/v2/lib/npc.js。_lib/ はそのコピー（tools/v2-npc-fn-sync.mjs が同期）。
//
// シークレット:
//   CRON_SECRET … cronと共有する秘密（一致しないと弾く）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は自動注入。
//   ★service_role で動く＝RLSを通らない。v2_npc_* のRPCも service_role にだけ許可してある。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-nocheck 相当：_lib は素のJS（型は付いていない）
import { runBattle } from './_lib/battle.js'
import { SKILL_BY_NAME } from './_lib/skills.js'
import { calcPower } from './_lib/stats.js'
import { champOf, streakBonusPct, applyStreakBonus, FLOORS } from './_lib/arena.js'
import {
  fighterOf, snapshotOfNpc, grownExp, arenaDelayOf, shouldRetire, powerOfExp, mulberry32,
} from './_lib/npc.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

// 1回のティックで処理する挑戦の上限。**実行時間が伸びすぎないための蓋**。
// 100体・平均90分間隔なら1時間で約65回＝5分おきのティックでは5〜6回しか来ない。
// つまり普段この上限には当たらない（詰まったときだけ効く）
const MAX_FIGHTS = 40

// 1回のティックでまとめて入れる成長の上限（時間）。
// cronが数時間止まっていたぶんは、次のティックでまとめて追いつくのが正しい。
// ただし**何か月ぶん**が一度に入るのは、止まっていたのではなく
// 「眠らせていたNPCを起こした」など別の理由なので、そこで頭を打つ。
// ★眠っていたNPCを起こす supabase_v2_npc_deploy_all.sql は last_tick_at を now() に直すので、
//   本来ここには当たらない。当たったときのための保険
const MAX_CATCHUP_HOURS = 24 * 7

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 })
  }
  const now = Date.now()
  const log: string[] = []

  // ---- 読み込み ----
  const { data: npcs, error: e1 } = await db.from('v2_npcs').select('*').eq('active', true).order('id')
  if (e1) return new Response(JSON.stringify({ ok: false, error: e1.message }), { status: 500 })
  const { data: floorRows, error: e2 } = await db.from('v2_arena_floors').select('*')
  if (e2) return new Response(JSON.stringify({ ok: false, error: e2.message }), { status: 500 })

  // 階 → いま座っている行。戦うたびにここも書き換えて、同じティック内で辻褄を合わせる
  const byFloor = new Map<number, any>((floorRows || []).map((r: any) => [r.floor, r]))
  const seatOfNpc = new Map<number, any>()
  for (const r of floorRows || []) if (r.npc_id) seatOfNpc.set(r.npc_id, r)

  // ---- ① 成長（全員ぶん）----
  const grown: any[] = []
  for (const n of npcs || []) {
    const hours = Math.min(MAX_CATCHUP_HOURS, Math.max(0, (now - new Date(n.last_tick_at).getTime()) / 3600000))
    n.total_exp = grownExp(n, hours)
    grown.push({ id: n.id, total_exp: n.total_exp, last_tick_at: new Date(now).toISOString(), next_arena_at: n.next_arena_at })
  }

  // ---- ② アリーナ ----
  // 時刻が来た順に、1体ずつ順番に処理する（同じ階を2体が同時に取り合わないように）
  const due = (npcs || [])
    .filter((n: any) => new Date(n.next_arena_at).getTime() <= now)
    .sort((a: any, b: any) => new Date(a.next_arena_at).getTime() - new Date(b.next_arena_at).getTime())
    .slice(0, MAX_FIGHTS)

  let fights = 0, wins = 0, retires = 0
  for (const n of due) {
    const rng = mulberry32((n.seed >>> 0) + Math.floor(now / 60000))
    const bump = (mins: number) => {
      const row = grown.find(g => g.id === n.id)
      if (row) row.next_arena_at = new Date(now + mins * 60000).toISOString()
    }
    const power = powerOfExp(n.total_exp)

    // 守っているとき：降りるかどうかだけ決める（守っているあいだは挑戦できない）
    const seat = seatOfNpc.get(n.id)
    if (seat) {
      if (shouldRetire(power, seat.floor, seat.streak || 0)) {
        const { data, error } = await db.rpc('v2_npc_retire', { p_npc_id: n.id })
        if (!error && data?.ok) {
          byFloor.delete(seat.floor)
          seatOfNpc.delete(n.id)
          n.arena_floor = data.next_floor
          retires++
          log.push(`${n.name} が${seat.floor}階の席を降りた（次は${data.next_floor}階）`)
        }
      }
      bump(arenaDelayOf(n.speed, rng))
      continue
    }

    // 挑戦する
    const floor = Math.min(FLOORS, Math.max(1, n.arena_floor || 1))
    // ★自分の戦闘力を先に出す。空き階のNPCはこれに合わせて底上げされる
    //   （プレイヤーとまったく同じ扱い。片方だけ底上げすると釣り合わなくなる）
    const me = fighterOf(n)
    const myPower = calcPower(me.stats)
    const champ = champOf(floor, byFloor.get(floor), SKILL_BY_NAME, myPower)
    if (!champ) { bump(arenaDelayOf(n.speed, rng)); continue }
    const foePower = calcPower(champ.stats)
    // 連勝中の相手に挑むとこちらが強くなる（プレイヤーとまったく同じ補正）
    const bonus = streakBonusPct(champ.streak, floor, myPower, foePower)
    const mine = { ...me, stats: applyStreakBonus(me.stats, bonus) }
    // 挑戦側は毎回満タン・守る側は削れたまま
    const foe = { ...champ, startHp: champ.hp, startMp: champ.mp }
    const r = runBattle(mine, foe)
    const win = r.winner === 'a'
    fights++
    if (win) wins++

    const snapshot = win ? snapshotOfNpc({ ...n, id: n.id }) : null
    const { data, error } = await db.rpc('v2_npc_arena_apply', {
      p_npc_id: n.id,
      p_win: win,
      p_my_hp: Math.max(1, Math.round(r.a.hp)),
      p_my_mp: Math.max(0, Math.round(r.a.mp)),
      p_foe_hp: Math.max(1, Math.round(r.b.hp)),
      p_foe_mp: Math.max(0, Math.round(r.b.mp)),
      p_snapshot: snapshot,
    })
    if (error || !data?.ok) {
      log.push(`⚠ ${n.name} の申告に失敗（${error?.message || data?.error}）`)
      bump(arenaDelayOf(n.speed, rng))
      continue
    }

    if (win) {
      // その階に座った。同じティック内の後続が正しい相手と戦えるように手元も直す
      const row = {
        floor, player_id: null, npc_id: n.id, snapshot,
        hp: Math.max(1, Math.round(r.a.hp)), mp: Math.max(0, Math.round(r.a.mp)), streak: 0,
      }
      byFloor.set(floor, row)
      seatOfNpc.set(n.id, row)
      n.arena_floor = floor
      log.push(`${n.name} が${floor}階の${champ.name}を破って階層守護者になった`)
    } else {
      const cur = byFloor.get(floor)
      if (cur) {
        cur.hp = Math.max(1, Math.round(r.b.hp))
        cur.mp = Math.max(0, Math.round(r.b.mp))
        cur.streak = (cur.streak || 0) + 1
      }
      n.arena_floor = data.next_floor
      log.push(`${n.name} が${floor}階で敗れた（次は${data.next_floor}階）`)
    }
    bump(arenaDelayOf(n.speed, rng))
  }

  // ---- 書き戻し ----
  const { error: e3 } = await db.rpc('v2_npc_grow', { p_rows: grown })
  if (e3) return new Response(JSON.stringify({ ok: false, error: e3.message }), { status: 500 })

  return new Response(JSON.stringify({
    ok: true, npcs: (npcs || []).length, due: due.length, fights, wins, retires, log,
  }), { headers: { 'content-type': 'application/json' } })
})
