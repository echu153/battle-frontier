// ============================================================
// 「レベルキャップあり」版（v2cap）— アプリを最新にする（ホームの帯の「🔄 更新」）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー指示「旧版へ戻る使わないから消していい、ここにゲームの更新ボタン」
//   「スマホで確認するとき、いちいちアプリ消して確認する必要があるからゲーム内の更新で解決できるようにしたい」
//   スマホで古いままになる理由は2つ：
//   ・ホーム画面のアプリは開き直しても前の画面に戻るだけのことがあり、読み直す手段が無い
//   ・sw.js は画像を「まず保存してあるもの」から出す（アドレスが同じなら古い絵が1回出る）
//   → 新しい sw.js を取りにいき、保存してあるものを全部消して、読み直す。ログインとゲームのデータには触らない
//   ★エラー画面の hardReset と違って登録は消さない（unregister すると通知の登録＝V1 のレイド通知まで切れる）
// ============================================================
export const SW_WAIT_MS = 3000   // 電波が悪くても止まらないように、sw.js はこれだけ待ったら先へ進む

export async function updateApp({
  sw = globalThis.navigator?.serviceWorker,
  store = globalThis.caches,
  reload = () => globalThis.location.reload(),
  waitMs = SW_WAIT_MS,
} = {}) {
  try {
    const regs = (await sw?.getRegistrations?.()) || []
    let timer
    await Promise.race([
      Promise.allSettled(regs.map(r => r.update())),
      new Promise(done => { timer = setTimeout(done, waitMs) }),
    ])
    clearTimeout(timer)
  } catch { /* 失敗しても読み直しは続ける */ }
  try {
    const keys = (await store?.keys?.()) || []
    await Promise.allSettled(keys.map(k => store.delete(k)))
  } catch { /* 失敗しても読み直しは続ける */ }
  reload()
}
