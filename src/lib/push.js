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
// 通知の対象枠（夜=21時/22時の固定枠 / 昼=12〜17時のランダム枠）。
// サーバー(send-raid-push)は notify_night / notify_day 列を見て送信先を絞る。
export const enableRaidPush = async (kinds = { night: true, day: true }) => {
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
      notify_night: kinds.night !== false,
      notify_day: kinds.day !== false,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return 'on'
}

// この端末の購読が「夜/昼どちらを受け取るか」を読む。未購読なら null。
export const getPushKinds = async () => {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return null
    const { data } = await supabase.from('push_subscriptions')
      .select('notify_night, notify_day').eq('endpoint', sub.endpoint).maybeSingle()
    if (!data) return null
    return { night: data.notify_night !== false, day: data.notify_day !== false }
  } catch { return null }  // 列が無い(SQL未適用)/オフライン時は既定表示にフォールバック
}

// 夜/昼の受け取り設定を更新する（購読済みの端末のみ）。
export const setPushKinds = async (kinds) => {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) throw new Error('not_subscribed')
  const { error } = await supabase.from('push_subscriptions')
    .update({ notify_night: !!kinds.night, notify_day: !!kinds.day })
    .eq('endpoint', sub.endpoint)
  if (error) throw error
  return kinds
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
