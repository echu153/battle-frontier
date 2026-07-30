import { useRef, useState } from 'react'
import { supabase } from '../supabase'

// 部屋の待機画面からプレイヤー名を指定して招待を送る(受信はInviteListener)
// 相手がオンライン(=ログインして画面を開いている)のときのみ届く
export function InvitePanel({ me, room, path }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const cdRef = useRef(0)

  const send = async () => {
    const uname = name.trim()
    if (!uname) { setMsg('プレイヤー名を入力してください'); return }
    if (uname === me.name) { setMsg('自分は招待できません'); return }
    const now = Date.now()
    if (now - cdRef.current < 3000) { setMsg('少し間をあけてください'); return }
    cdRef.current = now
    setBusy(true); setMsg(null)
    let ch = null
    try {
      const { data } = await supabase.from('profiles').select('id, username').eq('username', uname).maybeSingle()
      if (!data || data.id === me.id) { setMsg('そのプレイヤーが見つかりません(名前は完全一致)'); return }
      ch = supabase.channel(`bf-invite-${data.id}`)
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timeout')), 8000)
        ch.subscribe((s) => {
          if (s === 'SUBSCRIBED') { clearTimeout(to); resolve() }
          if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(to); reject(new Error(s)) }
        })
      })
      ch.send({
        type: 'broadcast', event: 'invite',
        payload: { fromName: me.name, path, roomInfo: { id: room.id, title: room.title, hostId: room.hostId, hostName: room.hostName, ...(room.bet !== undefined ? { bet: room.bet } : {}) } },
      })
      setMsg(`${data.username} さんに招待を送りました(オンラインの場合のみ届きます)`)
      setName('')
    } catch {
      setMsg('送信に失敗しました。時間をおいて試してください')
    } finally {
      setBusy(false)
      // 送信が飛んでからチャンネルを畳む
      if (ch) { const c = ch; setTimeout(() => supabase.removeChannel(c), 1500) }
    }
  }

  return (
    <div style={{ border: '1px solid #224466', padding: '8px 10px', marginTop: '10px', fontFamily: 'monospace' }}>
      <button
        onClick={() => { setOpen(!open); setMsg(null) }}
        style={{ background: 'none', border: 'none', color: '#88ccff', fontSize: '12px', cursor: 'pointer', padding: 0, fontFamily: 'monospace' }}
      >
        📨 プレイヤーを招待 {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              value={name} onChange={(e) => setName(e.target.value)} maxLength={16}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) send() }}
              placeholder="プレイヤー名(完全一致)"
              style={{ flex: 1, minWidth: 0, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: '16px' }}
            />
            <button
              onClick={send} disabled={busy}
              style={{ background: 'none', border: '1px solid #44dd88', color: '#44dd88', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: 'monospace', opacity: busy ? 0.5 : 1 }}
            >{busy ? '…' : '送る'}</button>
          </div>
          {msg && <div style={{ fontSize: '11px', color: msg.includes('送りました') ? '#44dd88' : '#ff8866', marginTop: '6px' }}>{msg}</div>}
          <div style={{ fontSize: '10px', color: '#668', marginTop: '4px' }}>相手がゲームを開いていると画面上部に招待が届きます</div>
        </div>
      )}
    </div>
  )
}
