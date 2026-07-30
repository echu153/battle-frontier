import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

// 娯楽の部屋招待の受信(ログイン中は全画面で待ち受け)
// broadcastベースなのでオンラインの相手にのみ届く(オフラインには残らない)
const INVITE_GAMES = {
  '/cards': { storeKey: 'bf-cards-room', label: 'トランプ広場' },
  '/mahjong': { storeKey: 'bf-mahjong-room', label: '麻雀' },
  '/othello': { storeKey: 'bf-othello-room', label: '双極盤' },
}

export function InviteListener({ userId }) {
  const [invite, setInvite] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel(`bf-invite-${userId}`)
    ch.on('broadcast', { event: 'invite' }, ({ payload }) => {
      // 送信元は他クライアントなので中身は信用せず、既知のゲームのみ・文字数を制限して受ける
      const def = INVITE_GAMES[payload?.path]
      const ri = payload?.roomInfo
      if (!def || !ri?.id || !ri?.hostId) return
      setInvite({
        fromName: String(payload.fromName ?? '?').slice(0, 16),
        path: payload.path, storeKey: def.storeKey, label: def.label,
        roomInfo: {
          id: String(ri.id).slice(0, 40), title: String(ri.title ?? '').slice(0, 30),
          hostId: String(ri.hostId), hostName: String(ri.hostName ?? '').slice(0, 16),
          ...(ri.bet !== undefined ? { bet: Number(ri.bet) || 0 } : {}),
        },
      })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setInvite(null), 30000)
    })
    ch.subscribe()
    return () => { supabase.removeChannel(ch); if (timerRef.current) clearTimeout(timerRef.current) }
  }, [userId])

  if (!invite) return null

  const accept = () => {
    // 各ゲームの「リロード復帰」保存形式で書き込んでからページを開く=自動で入室される
    try { sessionStorage.setItem(invite.storeKey, JSON.stringify({ roomInfo: invite.roomInfo, spectator: false })) } catch { /* 無視 */ }
    window.location.assign(invite.path)
  }

  return (
    <div style={{
      position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: 200,
      width: 'min(94vw, 340px)', background: 'rgba(8,16,34,0.97)', border: '1px solid #ffcc44',
      borderRadius: '10px', padding: '10px 12px', fontFamily: 'monospace',
    }}>
      <div style={{ color: '#ffcc44', fontSize: '13px', marginBottom: '4px' }}>📨 対局への招待</div>
      <div style={{ color: '#eee', fontSize: '12px', lineHeight: 1.6, marginBottom: '8px', wordBreak: 'break-word' }}>
        {invite.fromName} さんから【{invite.label}】部屋「{invite.roomInfo.title}」に招待されました
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={() => setInvite(null)} style={{ background: 'none', border: '1px solid #556', borderRadius: '6px', color: '#aab', padding: '5px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: 'monospace' }}>閉じる</button>
        <button onClick={accept} style={{ background: '#ffcc44', border: 'none', borderRadius: '6px', color: '#000', padding: '5px 14px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace' }}>参加する</button>
      </div>
    </div>
  )
}
