// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の結果を確かめる関数の中身（Vercel の api/v2cap-dungeon-verify.js から呼ぶ）
// ------------------------------------------------------------
// サーバーが預かった記録を読み（v2cap_dungeon_verify_load）→ 回し直し（dungeonVerify.js）→ 結果を入れる（v2cap_dungeon_verify_settle）。
//   ・画面から受け取るのは「どの挑戦か」だけ。中身はサーバーの表から読む＝だれが頼んでも同じ結果になる
//   ・DB の呼び出しは合い言葉（環境変数 BF_DUNGEON_SECRET・SQL には SHA-256 だけ）がないと通らない。公開の鍵（下）で呼ぶので、強い鍵は Vercel に置かない
//   ・もう入れた挑戦は入れ直さない（同じ結果を返すだけ）＝通信が切れて聞き直しても2回入らない
// ⚠画面の決まりは V2capDungeon.jsx・送り方は dungeonVerifyCall.js。下の2つは src/supabase.js と同じ（dungeonVerify.test.js が突き合わせる）
// ============================================================
import { verifyTry } from './dungeonVerify.js'

export const SUPABASE_URL = 'https://jxbcuqwqtstxgmpiruuu.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_vlexKdF2oJrIIwMFEA81OA_1XyShoIt'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const rpcOf = (fetchFn) => async (fn, args) => {
  const res = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`)
  return res.json()
}

// 頼みを1つ処理する。{ status, body } を返す（status＝HTTP の番号）
//   ping … いまの版を答えるだけ（画面が古くないかを挑戦の前に見る・dungeonVerifyCall.js）
export const verifyRequest = async ({ body, secret, sha = '', fetchFn = fetch }) => {
  if (body?.ping) return { status: 200, body: { ok: true, sha } }
  const run = Number(body?.run)
  const player = String(body?.player || '')
  if (!Number.isSafeInteger(run) || !UUID.test(player)) return { status: 400, body: { ok: false, error: 'どの挑戦か分かりません' } }
  if (!secret) return { status: 500, body: { ok: false, error: '合い言葉の設定がありません' } }
  const rpc = rpcOf(fetchFn)
  try {
    const t = await rpc('v2cap_dungeon_verify_load', { p_secret: secret, p_run: run, p_player: player })
    if (!t?.ok || t.done) return { status: 200, body: t }
    const v = verifyTry({ boss: t.boss, diff: t.diff, hp: t.hp, seed: t.seed, snap: t.snap, inputs: t.inputs, endStep: t.end_step, elapsedSec: t.elapsed_sec })
    const done = await rpc('v2cap_dungeon_verify_settle', { p_secret: secret, p_run: run, p_player: player, p_try: t.try, p_damage: v.damage, p_reason: v.reason })
    return { status: 200, body: done }
  } catch (e) {
    console.error(e)
    return { status: 500, body: { ok: false, error: '結果を確かめられませんでした' } }
  }
}
