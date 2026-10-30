// ============================================================
// 「レベルキャップあり」版（v2cap）— ボス戦の絵を先に読む
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「実機でしっかり見てよ」で本番を見て分かった：初めて開いたとき、絵が届く前に戦闘が始まる
//   （雨摩座の背景は本番で約1.1秒＝そのあいだ真っ黒な舞台に光の粒だけが浮く。スマホの回線ならもっと長い）。
//   V2capAtbFight.jsx は絵がそろうまで戦闘の時計を進めない。ART_WAIT_MS を過ぎたら、そろわなくても始める（回線のせいで戦えなくならない）。
//   1枚の絵は1回だけ読む（入口の画面で読み始めたぶんも使い回す）。読めなかった絵は待たない
// 【確定】2026-10-31 ユーザー「たまーにイラストが一瞬なくなることもあるから改善してほしい」：スマホのブラウザは、どこからも使われていない絵を捨てる
//   ＝次にその絵を出すとき読み直すあいだ、立ち絵は隠れているのにポーズの絵が出ず、ボスが消えて見えた。読んだ絵は手放さず（held）、先に開いておく（decode）。
//   それでも届いていない絵は artIsLoaded で分かる＝IllustRig は届くまで立ち絵のまま
// ============================================================
export const ART_WAIT_MS = 8000

const loading = new Map()   // 絵のアドレス → 読み終わると解決する Promise
const loaded = new Set()
const held = []             // 読んだ絵（手放さない）
const loadByImage = (src, done) => {
  const im = new Image()
  held.push(im)
  im.onload = () => { im.decode?.()?.catch(() => {}); done() }
  im.onerror = done
  im.src = src
}
const loadOne = (src, load) => {
  if (!loading.has(src)) loading.set(src, new Promise((res) => load(src, () => { loaded.add(src); res() })))
  return loading.get(src)
}

// 読み終わった絵か
export const artIsLoaded = (src) => loaded.has(src)
// いくつ読み終わったか
export const artLoadedCount = (srcs) => srcs.filter(s => loaded.has(s)).length

// 読む。そろったら（または timeoutMs たったら）解決する。onProgress(読み終わった数)・load は読み方（テスト用）
export const preloadArt = (srcs, { timeoutMs = ART_WAIT_MS, onProgress = null, load = loadByImage } = {}) => new Promise((res) => {
  const timer = setTimeout(res, timeoutMs)
  Promise.all(srcs.map(src => loadOne(src, load).then(() => onProgress?.(artLoadedCount(srcs))))).then(() => { clearTimeout(timer); res() })
})
