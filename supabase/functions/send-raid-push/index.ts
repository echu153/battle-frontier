// ============================================================
// レイド通知 配信 Edge Function（send-raid-push）
//   ・cron（pg_cron→pg_net）が毎日21時/22時(JST)に x-cron-secret 付きで叩く。
//   ・push_subscriptions を service_role で全件読み、各エンドポイントへ Web Push（ペイロード無し＝VAPID認証のみ）。
//   ・無効購読(404/410)はテーブルから削除。通知の中身は Service Worker(sw.js) の push ハンドラが固定文言で出す。
//
// シークレット:
//   CRON_SECRET        … cronと共有する秘密（このヘッダが一致しないと弾く）
//   VAPID_PUBLIC_KEY   … VAPID公開鍵 base64url（65バイト・0x04||x||y）。クライアントの VITE_VAPID_PUBLIC_KEY と同じもの
//   VAPID_PRIVATE_KEY  … VAPID秘密鍵 base64url（32バイト d）
//   VAPID_SUBJECT      … 連絡先（任意・既定 mailto:admin@example.com）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は自動注入。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

// ---- base64url ヘルパー ----
const b64urlToBytes = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
const bytesToB64url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const strToB64url = (s: string): string => bytesToB64url(new TextEncoder().encode(s))

// VAPID秘密鍵(d) + 公開鍵(x,y) から ECDSA P-256 署名鍵を import
async function importVapidKey(): Promise<CryptoKey> {
  const d = VAPID_PRIVATE_KEY
  const pub = b64urlToBytes(VAPID_PUBLIC_KEY) // 0x04 || x(32) || y(32)
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('bad VAPID_PUBLIC_KEY')
  const x = bytesToB64url(pub.slice(1, 33))
  const y = bytesToB64url(pub.slice(33, 65))
  const jwk = { kty: 'EC', crv: 'P-256', d, x, y, ext: true, key_ops: ['sign'] }
  return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

// aud(プッシュサービスのorigin)向けの VAPID JWT を作る（ES256）
async function makeVapidJwt(key: CryptoKey, aud: string): Promise<string> {
  const header = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60 // 12時間
  const payload = strToB64url(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT }))
  const signingInput = `${header}.${payload}`
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)),
  )
  return `${signingInput}.${bytesToB64url(sig)}`
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  // cronとの共有シークレットで保護（誰でも叩いて通知連打できないように）
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'forbidden' }, 403)
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'vapid_not_configured' }, 503)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: subs, error } = await svc.from('push_subscriptions').select('endpoint')
  if (error) { console.error('[send-raid-push] db error'); return json({ error: 'db' }, 500) }
  if (!subs || subs.length === 0) return json({ ok: true, sent: 0 })

  let key: CryptoKey
  try { key = await importVapidKey() } catch (e) { console.error('[send-raid-push] key', String(e)); return json({ error: 'vapid_key' }, 500) }

  const jwtByAud = new Map<string, string>()
  const stale: string[] = []
  let sent = 0

  await Promise.allSettled(subs.map(async (s) => {
    const endpoint: string = s.endpoint
    let aud: string
    try { aud = new URL(endpoint).origin } catch { stale.push(endpoint); return }
    let jwt = jwtByAud.get(aud)
    if (!jwt) { jwt = await makeVapidJwt(key, aud); jwtByAud.set(aud, jwt) }
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
          TTL: '1800',
          // ペイロード無し（Content-Length:0）。本文はSWが固定で出す。
        },
        signal: AbortSignal.timeout(10000),
      })
      if (r.status === 404 || r.status === 410) stale.push(endpoint) // 失効購読
      else if (r.ok || r.status === 201) sent++
      else console.error('[send-raid-push] push status', r.status)
    } catch (e) {
      console.error('[send-raid-push] fetch fail', String(e))
    }
  }))

  // 失効した購読を掃除（次回以降の無駄打ちを減らす）
  if (stale.length) {
    await svc.from('push_subscriptions').delete().in('endpoint', stale)
  }

  console.log(`[send-raid-push] sent=${sent} stale=${stale.length} total=${subs.length}`)
  return json({ ok: true, sent, stale: stale.length, total: subs.length })
})
