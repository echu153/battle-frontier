import { useState, useEffect } from 'react'
import { pushSupported, pushConfigured, getPushStatus, enableRaidPush, disableRaidPush } from '../lib/push'

// レイド通知（Web Push）のON/OFFパネル。☰メニューから開く。
//   ・端末ごとの購読（同じアカウントでもスマホとPCは別々にON/OFFが要る）。
//   ・iOSはホーム画面に追加（PWAインストール）してから開かないと購読できない。
export default function RaidNotify({ open, onClose }) {
  const [status, setStatus] = useState('loading') // loading|unsupported|denied|on|off
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      let s
      if (!pushSupported()) s = 'unsupported'
      else if (!pushConfigured()) s = 'notconfigured'
      else s = await getPushStatus()
      if (!cancelled) { setMsg(''); setStatus(s) }
    })()
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const toggle = async () => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      if (status === 'on') {
        setStatus(await disableRaidPush())
      } else {
        setStatus(await enableRaidPush())
        setMsg('レイド通知をONにしました。毎日21時・22時にお知らせします。')
      }
    } catch (e) {
      const m = e?.message || ''
      if (m === 'denied') setMsg('通知が許可されていません。端末／ブラウザの設定で通知を許可してください。')
      else if (m === 'not_configured') setMsg('通知はまだ準備中です（サーバー設定待ち）。')
      else if (m === 'unsupported') setMsg('この端末／ブラウザは通知に対応していません。')
      else if (m === 'unauth') setMsg('ログインし直してからお試しください。')
      else setMsg('うまくいきませんでした。時間を置いて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const isOn = status === 'on'
  const canToggle = status === 'on' || status === 'off'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(360px, 100%)', background: '#000a1c', border: '1px solid #44ddaa', borderRadius: '8px', fontFamily: 'monospace', color: '#cfe', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: '#44ddaa', fontSize: '14px' }}>🔔 レイド通知</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#668899', fontSize: '16px', cursor: 'pointer' }}>✕</button>
        </div>

        <p style={{ fontSize: '12px', lineHeight: 1.7, color: '#9bd' }}>
          ONにすると、レイドボスが出現する<b>毎日21時・22時</b>に、アプリを閉じていてもスマホへ通知が届きます。
        </p>

        {status === 'unsupported' && (
          <p style={{ fontSize: '12px', color: '#cc9944' }}>この端末／ブラウザは通知に対応していません。</p>
        )}
        {status === 'notconfigured' && (
          <p style={{ fontSize: '12px', color: '#cc9944' }}>通知はまだ準備中です（サーバー設定待ち）。</p>
        )}
        {status === 'denied' && (
          <p style={{ fontSize: '12px', color: '#cc9944' }}>通知がブロックされています。端末／ブラウザの設定で、このサイトの通知を「許可」にしてから開き直してください。</p>
        )}

        {canToggle && (
          <button onClick={toggle} disabled={busy} style={{
            width: '100%', marginTop: '8px', padding: '12px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
            fontFamily: 'monospace', fontSize: '13px',
            background: isOn ? '#0a3a2a' : '#0a1530', border: `1px solid ${isOn ? '#44ddaa' : '#446688'}`, color: isOn ? '#44ddaa' : '#88bbee',
          }}>
            {busy ? '…処理中' : isOn ? '✅ 通知ON（タップでOFF）' : '🔔 レイド通知をONにする'}
          </button>
        )}
        {status === 'loading' && <p style={{ fontSize: '12px', color: '#668899' }}>…確認中</p>}

        {msg && <p style={{ fontSize: '11px', color: '#9bd', marginTop: '8px', lineHeight: 1.6 }}>{msg}</p>}

        <p style={{ fontSize: '10px', color: '#557', marginTop: '12px', lineHeight: 1.6 }}>
          ※通知は端末ごとの設定です（スマホとPCで別々）。<br />
          ※iPhoneは「ホーム画面に追加」してアプリとして開いてからでないとONにできません（iOS16.4以降）。
        </p>
      </div>
    </div>
  )
}
