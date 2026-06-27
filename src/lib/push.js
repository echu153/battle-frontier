// レイド通知（Web Push）クライアントヘルパー。
//   ・購読＝Service Worker の PushManager.subscribe（VAPID公開鍵が必要）。
//   ・購読情報は push_subscriptions テーブルに upsert（RLSで本人のみ）。
//   ・実際の送信はサーバー（cron→Edge send-raid-push）。ここは購読の登録/解除のみ。
import { supabase } from '../supabase'

// VAPID公開鍵（Vercel等の環境変数 VITE_VAPID_PUBLIC_KEY に設定）。未設定なら機能オフ。
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

export const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window

export const pushConfigured = () => !!VAPID_PUBLIC_KEY

// base64url(VAPID公開鍵) → Uint8Array（applicationServerKey 用）
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// 現在の状態: 'unsupported' | 'denied' | 'on' | 'off'
export const getPushStatus = async () => {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

// 通知をONにする（許可要求→購読→DB保存）。成功で 'on'、失敗は throw。
export const enableRaidPush = async () => {
  if (!pushSupported()) throw new Error('unsupported')
  if (!pushConfigured()) throw new Error('not_configured')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('denied')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('unauth')

  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      user_id: user.id,
      p256dh: j.keys?.p256dh || null,
      auth: j.keys?.auth || null,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return 'on'
}

// 通知をOFFにする（DB削除→購読解除）。
export const disableRaidPush = async () => {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch { /* 解除失敗は無視（再度ONで上書きできる） */ }
  return 'off'
}
