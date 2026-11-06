// ============================================================
// 「レベルキャップあり」版（v2cap）— 出撃と塔の結果を決める関数の中身（Vercel の api/v2cap-sortie.js から呼ぶ）
// ------------------------------------------------------------
// サーバーの頼みを読み（v2cap_sortie_fill_load・v2cap_tower_try_load）→ 回し（sortieVerify.js）→ 画面から読めない表に入れる（…_save）。
//   ・画面から受け取るのは「どの種類の、だれの頼みか」だけ。写しと相手はサーバーの表から読む＝だれが頼んでも結果は同じ
//   ・返事に結果を入れない（画面は精算のあとで初めて知る＝先の結果を見て捨てることができない）
//   ・DB の呼び方と合い言葉は挑戦の確かめと同じ（dungeonVerifyApi.js の rpcOf・環境変数 BF_DUNGEON_SECRET）
// ============================================================
import { UUID, rpcOf } from './dungeonVerifyApi.js'
import { fillSortie, randomSeed, towerResultOf } from './sortieVerify.js'

const fill = async (rpc, secret, player) => {
  const t = await rpc('v2cap_sortie_fill_load', { p_secret: secret, p_player: player })
  if (!t?.ok || t.done) return t?.ok ? { ok: true } : t
  const entries = fillSortie({ snap: t.snap, spot: t.spot, shrineSpot: t.shrine_spot, rate: t.rate, forcePapia: t.force_papia })
  return rpc('v2cap_sortie_fill_save', { p_secret: secret, p_player: player, p_at: t.snap.at, p_entries: entries })
}

const tower = async (rpc, secret, player) => {
  const t = await rpc('v2cap_tower_try_load', { p_secret: secret, p_player: player })
  if (!t?.ok || t.done) return t?.ok ? { ok: true } : t
  const res = towerResultOf({ snap: t.snap, floor: t.floor, row: t.row, seed: randomSeed() })
  return rpc('v2cap_tower_try_save', { p_secret: secret, p_player: player, p_at: t.snap.at, p_res: res })
}

const KINDS = { fill, tower }

// 頼みを1つ処理する。{ status, body } を返す。body.kind＝fill（出撃）・tower（塔）。結果は返さない
//   ping … いまの版を答えるだけ（出撃の画面を開いたときに関数を起こしておく・dungeonVerifyCall.js の warmSortie）
//   決めたときの返事にも版（sha）を付ける＝画面はこれで古くないかを見る（2026-11-07・前は別の関数に先に聞いていた）
export const sortieRequest = async ({ body, secret, sha = '', fetchFn = fetch }) => {
  if (body?.ping) return { status: 200, body: { ok: true, sha } }
  const run = KINDS[Object.hasOwn(KINDS, String(body?.kind)) ? body.kind : '']
  const player = String(body?.player || '')
  if (!run || !UUID.test(player)) return { status: 400, body: { ok: false, error: 'どの頼みか分かりません' } }
  if (!secret) return { status: 500, body: { ok: false, error: '合い言葉の設定がありません' } }
  try {
    const out = await run(rpcOf(fetchFn), secret, player)
    return { status: 200, body: out?.ok ? { ok: true, ...(sha ? { sha } : {}) } : out }
  } catch (e) {
    console.error(e)
    return { status: 500, body: { ok: false, error: '結果を決められませんでした' } }
  }
}
