// ダンジョン描画の軽量化：巨大PNG（敵・タイルは1254×1254/1枚2〜3MBが多い）を
// 初回に1度だけcanvasで表示サイズ相当まで縮小し、Blob URLでキャッシュして使い回す。
// 可能なブラウザではCSSフィルター（壁の暗色化など）も縮小時に焼き込み、
// マスごとのfilter合成レイヤーをなくす。スマホのGPU負荷（発熱）対策。
//
// 使い方:
//   dgImg(src, 192)            → 縮小済みURL（未処理の間は元srcを返す）
//   dgImgF(src, 192, filter)   → { url, baked } bakedがtrueならCSSフィルター不要
//   setDgImageNotify(fn)       → 縮小が完了したタイミングで呼ばれる（再レンダー用）

const done = new Map()    // key -> objectURL | null（null=処理不可。元画像を使う）
const pending = new Set() // 処理中のkey

let notify = null
let notifyScheduled = false
const fireNotify = () => {
  if (!notify || notifyScheduled) return
  notifyScheduled = true
  setTimeout(() => { notifyScheduled = false; if (notify) notify() }, 60)
}
export const setDgImageNotify = (fn) => { notify = fn }

// canvasの2Dコンテキストがfilterを解釈できるか（iOS Safariの旧版は不可）
export const canBakeFilter = (() => {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    return typeof ctx.filter === 'string'
  } catch { return false }
})()

const keyOf = (src, size, filter) => `${src}|${size}|${filter || ''}`

const process = (key, src, size, filter) => {
  if (done.has(key) || pending.has(key)) return
  pending.add(key)
  const im = new Image()
  // ペット画像などSupabase等の外部URLはCORS指定（失敗時はonerrorで元画像にフォールバック）
  if (/^https?:/i.test(src)) im.crossOrigin = 'anonymous'
  const fail = () => { done.set(key, null); pending.delete(key); fireNotify() }
  im.onload = () => {
    try {
      const long = Math.max(im.naturalWidth || 0, im.naturalHeight || 0)
      // 既に十分小さい＆フィルター焼き込みも無い→縮小の意味なし
      if (!long || (long <= size && !filter)) return fail()
      const scale = Math.min(1, size / long)
      const w = Math.max(1, Math.round(im.naturalWidth * scale))
      const h = Math.max(1, Math.round(im.naturalHeight * scale))
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      const ctx = cv.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      if (filter) ctx.filter = filter
      ctx.drawImage(im, 0, 0, w, h)
      cv.toBlob((blob) => {
        if (blob) done.set(key, URL.createObjectURL(blob))
        else done.set(key, null)
        pending.delete(key)
        fireNotify()
      }, 'image/png')
    } catch { fail() } // CORS汚染などは元画像のまま
  }
  im.onerror = fail
  im.src = src
}

// 縮小のみ。未処理の間は元のsrcをそのまま返す
export const dgImg = (src, size = 192) => {
  if (!src || typeof src !== 'string') return src
  const key = keyOf(src, size, null)
  const hit = done.get(key)
  if (hit !== undefined) return hit || src
  process(key, src, size, null)
  return src
}

// 縮小＋フィルター焼き込み。bakedがfalseの間は呼び出し側でCSSフィルターを併用する
export const dgImgF = (src, size, filter) => {
  if (!src || typeof src !== 'string') return { url: src, baked: false }
  if (!filter) return { url: dgImg(src, size), baked: false }
  if (!canBakeFilter) return { url: dgImg(src, size), baked: false }
  const key = keyOf(src, size, filter)
  const hit = done.get(key)
  if (hit) return { url: hit, baked: true }
  if (hit === null) return { url: src, baked: false }
  process(key, src, size, filter)
  return { url: src, baked: false }
}
