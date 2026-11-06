/* global __BUILD_SHA__ */
// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の結果を確かめてもらう（画面から Vercel の関数を呼ぶ・dungeonVerifyApi.js）
// ------------------------------------------------------------
// ・本番は同じサイトの /api。手元の開発（vite は /api を動かさない）は本番の関数を呼ぶ
//   ⚠手元で戦闘のコードを直している最中に本物の挑戦をすると、本番のコードで回し直すのでずれる（直している途中は試し撃ちで見る）
// ・通信が切れても、記録はサーバーが預かっている＝何度聞いても入るのは1回。入口に戻ると確かめ直す（V2capDungeon.jsx）
// ・__BUILD_SHA__ … この画面のコミット（vite.config.js）。本番の関数が別のコミットなら画面が古い＝読み直してもらう
// ============================================================
const PATH = '/api/v2cap-dungeon-verify'
const SORTIE_PATH = '/api/v2cap-sortie'
export const PROD_ORIGIN = 'https://battle-frontier-six.vercel.app'
export const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : ''
const RETRY_MS = [600, 1500, 3000]   // うまくいかなかったときに待つ長さ（公開の切り替えや起動の遅れをまたぐ）
const STALE_WAIT_MS = 2500           // 版を聞いて待つ長さ（届かなければ挑戦を止めない）
const LOCAL_HOSTS = ['localhost', '127.0.0.1']
// サーバーの計算が画面と違ったときの一言（書き換えていなければ、古い画面のまま戦ったときだけ）
export const CORRECTED_TEXT = '画面とサーバーの計算がずれたので、サーバーの計算で入れました'

export const verifyUrlOf = (host = typeof location === 'undefined' ? '' : location.hostname, path = PATH) =>
  (LOCAL_HOSTS.includes(host) ? PROD_ORIGIN + path : path)

const post = (fetchFn, body, signal, path = PATH) => fetchFn(verifyUrlOf(undefined, path), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true, signal,
})

const callWithRetry = async (args, path, { fetchFn = fetch, retryMs = RETRY_MS, wait = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) => {
  for (let i = 0; i <= retryMs.length; i++) {
    if (i > 0) await wait(retryMs[i - 1])
    try {
      const res = await post(fetchFn, args, undefined, path)
      if (res.status < 500) return await res.json()
    } catch { /* 通信が切れた：次へ */ }
  }
  return null
}

// 確かめてもらう。args＝{ run, player }。返事（{ ok, damage, reward, corrected, run }）か、届かなければ null
export const callVerify = (args, opts) => callWithRetry(args, PATH, opts)
// 修練場の案山子を確かめてもらう。args＝{ id, player }。返事（{ ok, damage, pct, exp, gained, level_ups, … }）か、届かなければ null
export const callScarecrowVerify = (args, opts) => callWithRetry({ ...args, kind: 'scarecrow' }, PATH, opts)
// 日替わりクエストの曜日のクエストを確かめてもらう。args＝{ id, player }。返事（{ ok, quest, damage, pct, gold, … }）か、届かなければ null
export const callDayQuestVerify = (args, opts) => callWithRetry({ ...args, kind: 'dayquest' }, PATH, opts)
// 出撃と塔の結果を決めてもらう。args＝{ kind:'fill'|'tower', player }。返事は { ok } だけ（結果は精算のあとで分かる）か、届かなければ null
export const callSortie = (args, opts) => callWithRetry(args, SORTIE_PATH, opts)

// 関数が答えた版（got）が画面と違うか。手元の開発（sha が無い）と、関数の版が分からないときは止めない
export const staleShaOf = (got, sha = BUILD_SHA) => !!sha && !!got && got !== sha

// 画面が古いか（挑戦の前に見る）。手元の開発と、版を聞けなかったときは止めない。path＝聞く関数（ふだんは挑戦の関数）
export const isStaleBuild = async ({ fetchFn = fetch, sha = BUILD_SHA, waitMs = STALE_WAIT_MS, path = PATH } = {}) => {
  if (!sha) return false
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), waitMs)
  try {
    const data = await (await post(fetchFn, { ping: true }, ctl.signal, path)).json()
    return staleShaOf(data?.sha, sha)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// 出撃と塔の関数（api/v2cap-sortie.js）を先に起こしておき、ついでに版を聞く。
// 【確定】2026-11-07 ユーザー「最初のオート出撃、戦闘ログが出るまで5秒くらいかかるんだけどなんで？」→「直して」：
//   しばらく呼ばれていない関数は眠っていて、起きるのに時間がかかる。最初の出撃は30戦を決める関数を呼ぶので、その待ちがログの前に乗っていた
//   ・warmSortie … 出撃と塔の画面を開いたとき・画面に戻ってきたときに呼ぶ。WARM_GAP_MS に1回まで（Vercel の呼び出しの数を増やしすぎない）
//   ・askSortieStale … 塔の挑戦の前の版の確かめ。SORTIE_STALE_REUSE_MS 以内に聞いていればその答え（押してから待たない）。
//     聞く先は塔が次に呼ぶ関数と同じ＝別の関数（挑戦の関数）を起こす待ちが無い
//   ・返すのは「画面が古いか」の Promise。now・ask はテストのため
export const WARM_GAP_MS = 3 * 60 * 1000
export const SORTIE_STALE_REUSE_MS = 60 * 1000
let sortieAsked = null   // { at, ask }
export const askSortieStale = ({ now = Date.now(), reuseMs = SORTIE_STALE_REUSE_MS, ask = () => isStaleBuild({ path: SORTIE_PATH }) } = {}) => {
  if (sortieAsked && now - sortieAsked.at < reuseMs) return sortieAsked.ask
  sortieAsked = { at: now, ask: ask() }
  return sortieAsked.ask
}
export const warmSortie = (opts = {}) => askSortieStale({ reuseMs: WARM_GAP_MS, ...opts })
