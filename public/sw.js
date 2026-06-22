// Battle Frontier 最小サービスワーカー
// 目的: PWA(ホーム画面追加/全画面)のインストール要件を満たすこと。
// 方針: ゲームは常にサーバ最新データが必要なため、基本ネットワーク優先で
//       内容をキャッシュしない(古い画面が出る不具合を避ける)。
//       オフライン時のみ簡易フォールバックを返す。

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  event.respondWith(fetch(req).catch(() => Response.error()))
})
