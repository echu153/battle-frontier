// Battle Frontier サービスワーカー
// 方針:
//  - HTML(ナビゲーション)は常にネットワーク優先＝デプロイ後すぐ最新版が出る（古い画面事故を防ぐ）
//  - ハッシュ付きビルド資産(/assets/*)は不変なのでキャッシュ優先＝2回目以降は瞬時
//  - 画像/音声/アイコン等の同一オリジン静的ファイルは stale-while-revalidate
//    （まずキャッシュで即表示→裏で更新）＝ダンジョン再入場などが軽くなる
//  - Supabase等のクロスオリジン(API/データ)とGET以外は一切触らない＝余計な遅延やデータ事故なし

const VERSION = 'bf-v2'
const STATIC_CACHE = `bf-static-${VERSION}`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => k.startsWith('bf-static-') && k !== STATIC_CACHE).map((k) => caches.delete(k)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // 非GETはノータッチ（書き込み系は素通し）

  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return // Supabase等クロスオリジンは素通し

  // ナビゲーション(HTML)=ネットワーク優先・オフライン時のみキャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    )
    return
  }

  // ハッシュ付き不変資産=キャッシュ優先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
    return
  }

  // その他の同一オリジン静的(画像/音声/アイコン/manifest等)=stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req))
})

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone())
  return res
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(req)
  const fetching = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => hit)
  return hit || fetching
}
