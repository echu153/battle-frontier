// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 出撃と塔の待ち時間（画面とサーバーで1つの決まり）
// ------------------------------------------------------------
// ・画面は精算が返ってきてから SORTIE_CD（10秒）を数える。サーバー（v2cap_sortie_settle・v2cap_tower_fight の c_cd）は
//   前に通した精算から SORTIE_CD − SORTIE_CD_SLACK（8秒）空いているかを見る（通信の揺れぶんの余裕）。塔の挑戦も同じ待ち時間
//   ⚠数を変えたら SQL の c_cd も直す（v2capsql.test.js が突き合わせる）
// 【確定】2026-10-23 ユーザー報告「⚠ 反映に失敗しました（出撃の間隔が短すぎます）」の直し：
//   画面の10秒は画面（PC）の時計で数えるので、次のときに8秒より早く届くことがあった。そのとき戦闘の結果は捨てていた
//   ・同じキャラを別のタブ・端末で動かしている（その出撃をこの画面は知らない）
//   ・施設の画面から戻った・読み込み直した → 出撃の画面がサーバーの時刻（last_sortie_at）をPCの時計とそのまま比べて数え直していた
//     （PCの時計が進んでいると、そのぶん早く「出撃可能」になる）。塔の画面も同じ比べ方をしていた
//   ・通信が切れて、ブラウザが同じ精算を送り直した（1回目は通っている）
//   そこで：
//   ・待ち時間の時計は出撃と塔で1つ（sortieClock）。施設の画面へ行って戻っても残る。サーバーの時刻を読むのは、
//     ページを開いて最初の1回だけ・いまから10秒より先には置かない（PCの時計が遅れていても待ちすぎない）
//   ・サーバーに早すぎると言われたら、サーバーが数えた残り（wait_ms）を待ってから同じ精算を送り直す（sendWithCooldownRetry）
//   ・精算には戦闘ごとの印（p_key・newSettleKey）を付ける。サーバーは同じ印を2回入れない（前の返事を返す）
// ============================================================
import { SORTIE_CD } from './sortie.js'

export { SORTIE_CD }
export const SORTIE_CD_SLACK = 2       // サーバーはこの秒数だけ短く見る（SQL の c_cd ＝ 10 − 2 ＝ 8秒）
export const RESEND_TRIES = 3          // 送り直す回数の上限（ほかのタブと取り合っても、いつかは止まるように）
export const RESEND_MARGIN_MS = 250    // サーバーが数えた残りに足して待つ（通信の揺れ）

const FULL_MS = SORTIE_CD * 1000

// 待ち時間の時計（画面の時計＝Date.now() で持つ）。now を渡せるのはテストのため
export const createSortieClock = () => {
  let readyAt = 0       // この時刻（画面の時計）になったら出撃・挑戦できる
  let synced = false    // サーバーの時刻をもう読んだか（ページを開いて最初の1回だけ）
  return {
    leftMs: (now = Date.now()) => Math.max(0, readyAt - now),
    // 精算を送ったとき・返ってきたとき：ここから10秒
    start: (now = Date.now()) => { readyAt = now + FULL_MS },
    // サーバーに「あと◯ms」と言われた（10秒より長くは待たない）
    wait: (ms, now = Date.now()) => { readyAt = Math.max(readyAt, now + Math.min(FULL_MS, Math.max(0, Number(ms) || 0))) },
    // 塔で「守護者が入れ替わった」（サーバーは待ち時間を使っていない）
    clear: () => { readyAt = 0 },
    // サーバーの最後の精算の時刻（last_sortie_at）。ページを開いて最初の1回だけ・いまから10秒より先には置かない
    fromServer: (iso, now = Date.now()) => {
      if (synced) return
      synced = true
      const t = iso ? new Date(iso).getTime() : NaN
      if (Number.isFinite(t)) readyAt = Math.max(readyAt, Math.min(t + FULL_MS, now + FULL_MS))
    },
  }
}
// 出撃（V2capSortie）と塔（V2capTower）が使う1つの時計
export const sortieClock = createSortieClock()

const sleepMs = (ms) => new Promise(r => setTimeout(r, ms))

// 精算を送る。サーバーに早すぎると言われたら（wait_ms つきの断り）、そのぶん待って同じ中身で送り直す。
//   send … () => supabase.rpc(…)（返事は { data, error }）。onWait … 待つ前に呼ぶ（時計を合わせる）
//   断るときサーバーは何も書いていないので、送り直しても2回は入らない。
//   サーバーが前の版（wait_ms を返さない）のあいだは送り直さない＝前と同じく失敗を出す
export const sendWithCooldownRetry = async (send, { onWait, sleep = sleepMs, tries = RESEND_TRIES } = {}) => {
  for (let i = 0; ; i++) {
    const res = await send()
    const wait = Math.min(FULL_MS, Number(res?.data?.wait_ms))
    if (res?.error || res?.data?.ok || !(wait > 0) || i >= tries) return res
    onWait?.(wait)
    await sleep(wait + RESEND_MARGIN_MS)
  }
}

// 精算に付ける戦闘ごとの印
export const newSettleKey = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
// 印を送ってよいか：プロフィールに last_sortie_key の列がある＝サーバーが印を受け取れる版（2026-10-23 のSQLのあと）。
//   前の版に p_key を送ると関数が見つからず出撃がすべて失敗するので、そのあいだは送らない
export const settleKeyArgOf = (prof, key) => (prof && 'last_sortie_key' in prof ? { p_key: key } : {})
