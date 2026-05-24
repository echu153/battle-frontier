import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

export default function Shop() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [items, setItems] = useState([])
  const [playerItems, setPlayerItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const unlockedAreas = p.unlocked_areas || [1]
    const maxArea = Math.max(...unlockedAreas)
    const { data: it } = await supabase.from('items').select('*').lte('unlock_area', maxArea).order('id')
    setItems(it || [])
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
    setPlayerItems(pi || [])
  }

  const buyItem = async (item) => {
    if (profile.gold < item.buy_price) return
    setLoading(true)
    const existing = playerItems.find(pi => pi.item_id === item.id)
    if (existing) {
      await supabase.from('player_items').update({ quantity: existing.quantity + 1 }).eq('id', existing.id)
    } else {
      await supabase.from('player_items').insert({
        player_id: profile.id, item_id: item.id, quantity: 1, equipped: false,
      })
    }
    await supabase.from('profiles').update({ gold: profile.gold - item.buy_price }).eq('id', profile.id)
    setMessage(`${item.name}を購入しました！`)
    setTimeout(() => setMessage(''), 2000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 街に戻る
          </button>
        </div>

        <div style={{ color:'#44aa44', fontSize:'14px', marginBottom:'4px' }}>🛒 商店</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
        </div>

        {message && (
          <div style={{ color:'#44ff88', fontSize:'12px', padding:'8px', border:'1px solid #44ff88', marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        {items.map(item => {
          const owned = playerItems.find(pi => pi.item_id === item.id)
          const canBuy = profile.gold >= item.buy_price
          return (
            <div key={item.id} style={{ border:'1px solid #002244', background:'#001028', padding:'12px', marginBottom:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ color:'#88ccff', fontSize:'13px' }}>{item.name}</span>
                <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                  {owned && <span style={{ color:'#446688', fontSize:'10px' }}>所持: {owned.quantity}個</span>}
                  <span style={{ color:'#ffcc00', fontSize:'12px' }}>{item.buy_price}G</span>
                  <button onClick={() => buyItem(item)} disabled={!canBuy || loading}
                    style={{ padding:'4px 10px', background: canBuy ? '#001840' : '#001', border:`1px solid ${canBuy ? '#44aa44' : '#002244'}`, color: canBuy ? '#44aa44' : '#334455', cursor: canBuy ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                    購入
                  </button>
                </div>
              </div>
              <div style={{ color:'#446688', fontSize:'10px' }}>{item.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}