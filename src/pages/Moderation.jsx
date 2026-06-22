import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// 管理者用: プレイヤーがアップロードしたアバター画像の一覧・削除ページ
// 削除はサーバー側RPC（admin_remove_player_avatar）で is_admin を再チェックする
export default function Moderation() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => { fetchAll() }, [])

  const showMsg = (text, color = '#44ff88') => {
    setMessage(text); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('id, is_admin').eq('id', user.id).single()
    if (!p?.is_admin) { nav('/game'); return }
    setProfile(p)

    const { data: rows } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .not('avatar_url', 'is', null)
    // プリセット画像（avatars/xxx.png 直下）は除外し、アップロード画像（avatars/{uid}/...）のみ表示
    setPlayers((rows || []).filter(r => r.avatar_url?.includes(`/avatars/${r.id}/`)))
  }

  const removeAvatar = async (player) => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('admin_remove_player_avatar', { p_player_id: player.id })
    if (error || data?.error) {
      showMsg(data?.error || 'エラーが発生しました', '#ff4444')
    } else {
      showMsg(`${player.username} のアバターを削除しました（ファイル${data.deleted_files}件）`)
      await fetchAll()
    }
    setConfirmTarget(null)
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#ff8844', fontSize:'14px', marginBottom:'4px' }}>🛡 アバター管理 [開発]</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'14px' }}>
          プレイヤーがアップロードしたアバター画像の一覧です。不適切な画像は削除できます（デフォルト表示に戻り、ファイルも完全削除されます）。
        </div>

        {message && (
          <div style={{ color: messageColor, fontSize:'12px', textAlign:'center', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px' }}>{message}</div>
        )}

        {players.length === 0 && (
          <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>アップロードされたアバターはありません</div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:'10px' }}>
          {players.map(p => (
            <div key={p.id} style={{ border:'1px solid #002244', background:'#000e20', padding:'10px', textAlign:'center' }}>
              <img src={p.avatar_url} alt={p.username}
                style={{ width:'80px', height:'80px', objectFit:'cover', display:'block', margin:'0 auto 8px', border:'1px solid #112233' }}
                onError={e => { e.target.style.opacity = 0.2 }} />
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px', wordBreak:'break-all' }}>{p.username}</div>
              {confirmTarget === p.id ? (
                <div style={{ display:'flex', gap:'4px' }}>
                  <button onClick={() => removeAvatar(p)} disabled={loading}
                    style={{ flex:1, padding:'6px', background:'#1a0000', border:'1px solid #ff4444', color:'#ff4444', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                    {loading ? '処理中...' : '本当に削除'}
                  </button>
                  <button onClick={() => setConfirmTarget(null)} disabled={loading}
                    style={{ flex:1, padding:'6px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                    やめる
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmTarget(p.id)}
                  style={{ width:'100%', padding:'6px', background:'#100008', border:'1px solid #aa4444', color:'#cc6666', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                  🗑 削除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
