import { useState, useEffect } from 'react'
import { pushSupported, pushConfigured, getPushStatus, enableRaidPush, disableRaidPush, getPushKinds, setPushKinds } from '../lib/push'

// ============================================================
// レイド通知（Web Push）のON/OFF本体。★これが唯一の実装。
//  ・街の☰メニュー（RaidNotify のモーダル）と、レイド画面の設定欄の両方がこれを使う。
//    以前は2画面が別々に同じUIを持っており、夜/昼の切替を片方にしか足せていなかった。
//  ・端末ごとの購読（同じアカウントでもスマホとPCは別々にON/OFFが要る）。
//  ・iOSはホーム画面に追加（PWAインストール）してから開かないと購読できない。
//  ・枠は夜（21時・22時）と昼（12〜17時のどこか1回）を別々に選べる。両方OFF＝通知OFF。
// ============================================================
export default function RaidPushSettings({ onStatusChange }) {
  const [status, setStatus] = useState('loading') // loading|unsupported|notconfigured|denied|on|off
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [kinds, setKinds] = useState({ night: true, day: true })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let s
      if (!pushSupported()) s = 'unsupported'
      else if (!pushConfigured()) s = 'notconfigured'
      else s = await getPushStatus()
      if (cancelled) return
      setMsg(''); setStatus(s); onStatusChange?.(s)
      if (s === 'on') {
        const k = await getPushKinds()
        if (!cancelled && k) setKinds(k)
      }
    })()
    return () => { cancelled = true }
  }, [onStatusChange])

  const apply = (s) => { setStatus(s); onStatusChange?.(s) }

  const toggle = async () => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      if (status === 'on') { apply(await disableRaidPush()); setMsg('レイド通知をOFFにしました。') }
      else { apply(await enableRaidPush(kinds)); setMsg('レイド通知をONにしました。出現時刻にお知らせします。') }
    } catch (e) {
      const m = e?.message || ''
      if (m === 'denied') setMsg('通知が許可されていません。端末／ブラウザの設定で通知を許可してください。')
      else if (m === 'not_configured') setMsg('通知はまだ準備中です（サーバー設定待ち）。')
      else if (m === 'unsupported') setMsg('この端末／ブラウザは通知に対応していません。')
      else if (m === 'unauth') setMsg('ログインし直してからお試しください。')
      else setMsg('うまくいきませんでした。時間を置いて、もう一度お試しください。')
    } finally { setBusy(false) }
  }

  // 夜/昼の受け取り切替。両方OFFにしたら通知そのものをOFFにする（届かないのにONと表示しない）
  const toggleKind = async (key) => {
    if (busy || status !== 'on') return
    const next = { ...kinds, [key]: !kinds[key] }
    setBusy(true); setMsg('')
    try {
      if (!next.night && !next.day) {
        apply(await disableRaidPush())
        setKinds({ night: true, day: true })
        setMsg('レイド通知をOFFにしました。')
      } else {
        await setPushKinds(next)
        setKinds(next)
        setMsg(`通知する枠を更新しました（${[next.night && '夜', next.day && '昼'].filter(Boolean).join('・')}）。`)
      }
    } catch {
      setMsg('うまくいきませんでした。時間を置いて、もう一度お試しください。')
    } finally { setBusy(false) }
  }

  const isOn = status === 'on'
  const canToggle = status === 'on' || status === 'off'

  return (
    <>
      <p style={{ fontSize: '12px', lineHeight: 1.7, color: '#88bbaa', margin: '0 0 10px' }}>
        ONにすると、レイドボスの出現時刻に、アプリを閉じていても端末へ通知が届きます。
        <b style={{ color: '#aaffdd' }}>夜（21時・22時）</b>と<b style={{ color: '#aaffdd' }}>昼（12〜17時のどこか1回）</b>は別々に選べます。
      </p>
      {status === 'unsupported' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>この端末／ブラウザは通知に対応していません。</p>}
      {status === 'notconfigured' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>通知はまだ準備中です（サーバー設定待ち）。</p>}
      {status === 'denied' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>通知がブロックされています。端末／ブラウザの設定で、このサイトの通知を「許可」にしてから開き直してください。</p>}
      {status === 'loading' && <p style={{ fontSize: '11px', color: '#557', margin: '0 0 8px' }}>…確認中</p>}
      {canToggle && (
        <button onClick={toggle} disabled={busy} style={{
          width: '100%', padding: '12px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
          fontFamily: 'monospace', fontSize: '13px',
          background: isOn ? '#0a3a2a' : '#0a1530', border: `1px solid ${isOn ? '#44ddaa' : '#446688'}`, color: isOn ? '#44ddaa' : '#88bbee',
        }}>
          {busy ? '…処理中' : isOn ? '✅ 通知ON（タップでOFF）' : '🔔 レイド通知をONにする'}
        </button>
      )}
      {isOn && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {[{ key: 'night', label: '🌙 夜 21時・22時' }, { key: 'day', label: '☀ 昼 12〜17時' }].map(k => (
            <button key={k.key} onClick={() => toggleKind(k.key)} disabled={busy} style={{
              flex: 1, padding: '8px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
              fontFamily: 'monospace', fontSize: '11px',
              background: kinds[k.key] ? '#0a3a2a' : '#0a1018',
              border: `1px solid ${kinds[k.key] ? '#44ddaa' : '#334455'}`,
              color: kinds[k.key] ? '#44ddaa' : '#667788',
            }}>
              {kinds[k.key] ? '✓ ' : '　'}{k.label}
            </button>
          ))}
        </div>
      )}
      {msg && <p style={{ fontSize: '11px', color: '#9bd', marginTop: '8px', lineHeight: 1.6 }}>{msg}</p>}
      <p style={{ fontSize: '10px', color: '#557', marginTop: '10px', lineHeight: 1.6 }}>
        ※通知は端末ごとの設定です（スマホとPCで別々）。<br />
        ※iPhoneは「ホーム画面に追加」してアプリとして開いてからでないとONにできません（iOS16.4以降）。
      </p>
    </>
  )
}
