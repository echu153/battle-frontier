import { useEffect, useRef, useState } from 'react'

// 運営(おれおれお)が建てた部屋専用のフリーチャット(右下の💬から開閉)
// messages: [{ id, name, senderId, text }] / onSend(text) => 送信できたら true
export function RoomChat({ messages, onSend, meId }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [unread, setUnread] = useState(0)
  const listRef = useRef(null)
  const prevLenRef = useRef(messages.length)

  useEffect(() => {
    const diff = messages.length - prevLenRef.current
    prevLenRef.current = messages.length
    if (diff > 0 && !open) setUnread((u) => Math.min(99, u + diff))
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, open])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    if (onSend(t)) setText('')
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setUnread(0) }}
        style={{
          position: 'fixed', right: '8px', bottom: '56px', zIndex: 56,
          width: '44px', height: '44px', borderRadius: '50%',
          background: 'rgba(10,20,40,0.92)', border: '1px solid #ffcc44',
          color: '#fff', fontSize: '20px', cursor: 'pointer',
        }}
      >
        💬
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: '-4px', right: '-4px', background: '#ff4444', color: '#fff',
            borderRadius: '10px', fontSize: '11px', minWidth: '18px', height: '18px', lineHeight: '18px', padding: '0 3px',
          }}>{unread}</span>
        )}
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', right: '8px', bottom: '56px', zIndex: 56,
      width: 'min(94vw, 300px)', background: 'rgba(8,16,34,0.96)', border: '1px solid #ffcc44',
      borderRadius: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #334', color: '#ffcc44', fontSize: '13px' }}>
        <span>💬 チャット(運営部屋)</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer' }}>✕</button>
      </div>
      <div ref={listRef} style={{ height: '180px', overflowY: 'auto', padding: '6px 10px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {messages.length === 0 && <div style={{ color: '#667', fontSize: '12px' }}>メッセージはまだありません</div>}
        {messages.map((m) => {
          const mine = m.senderId === meId
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              {!mine && <span style={{ color: '#88ccff', fontSize: '10px', margin: '0 4px 1px' }}>{m.name}</span>}
              <div style={{
                maxWidth: '85%', wordBreak: 'break-word', lineHeight: 1.4, color: '#eee',
                background: mine ? 'rgba(255,204,68,0.18)' : '#1c2a44',
                border: `1px solid ${mine ? '#aa8830' : '#334'}`,
                borderRadius: mine ? '10px 10px 3px 10px' : '3px 10px 10px 10px',
                padding: '4px 9px',
              }}>{m.text}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '6px', padding: '6px', borderTop: '1px solid #334' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
          maxLength={100}
          placeholder="メッセージ(100文字まで)"
          style={{ flex: 1, minWidth: 0, background: '#0a1428', border: '1px solid #445', borderRadius: '6px', color: '#fff', padding: '6px 8px', fontSize: '16px' }}
        />
        <button onClick={submit} style={{ background: '#ffcc44', border: 'none', borderRadius: '6px', color: '#000', padding: '0 12px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>送信</button>
      </div>
    </div>
  )
}
