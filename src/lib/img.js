// 画像URLユーティリティ
//
// Supabase Storage の公開画像URL(object/public)を、サーバー側リサイズ版
// (render/image/public) に変換する。アバターやペット画像は数MBの原寸を
// 36px等の小さな枠で表示しており、そのまま読むと激重なので一覧ではサムネを使う。
//
// - Storage の object/public URL でなければ（ローカル/public 配下の画像など）そのまま返す。
// - size はCSS表示サイズの2倍程度を指定するとRetinaでも綺麗（例: 36px枠なら72）。
// - resize: 'cover'(枠を埋める/切り抜き=アバター向き) / 'contain'(全体を収める/切り抜かない=ペット絵向き)。
export function thumbUrl(url, size = 72, resize = 'cover') {
  if (!url || typeof url !== 'string') return url
  const marker = '/storage/v1/object/public/'
  const i = url.indexOf(marker)
  if (i === -1) return url
  const base = url.slice(0, i)
  const path = url.slice(i + marker.length).split('?')[0]
  return `${base}/storage/v1/render/image/public/${path}?width=${size}&height=${size}&resize=${resize}&quality=75`
}
