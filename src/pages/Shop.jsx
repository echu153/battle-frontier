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
  const [quantities, setQuantities] = useState({})

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const unlockedAreas = p.unlocked_areas || [1]
    const maxArea = Math.max(...unlockedAreas)
    const { data: it } = await supabase.from('items').select('*')
      .lte('unlock_area', maxArea)
      .not('name', 'like', '強化石%')  // 強化石を除外
      .order('id')
    setItems(it || [])
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
    setPlayerItems(pi || [])
  }

  const getQuantity = (itemId) => quantities[itemId] || 1

  const setQuantity = (itemId, val) => {
    const num = Math.max(1, Math.min(999, Number(val) || 1))
    setQuantities(q => ({ ...q, [itemId]: num }))
  }

  const buyItem = async (item) => {
    const qty = getQuantity(item.id)
    const totalCost = item.buy_price * qty
    if (profile.gold < totalCost) return
    setLoading(true)
    const existing = playerItems.find(pi => pi.item_id === item.id)
    if (existing) {
      await supabase.from('player_items').update({ quantity: existing.quantity + qty }).eq('id', existing.id)
    } else {
      await supabase.from('player_items').insert({
        player_id: profile.id, item_id: item.id, quantity: qty, equipped: false,
      })
    }
    await supabase.from('profiles').update({ gold: profile.gold - totalCost }).eq('id', profile.id)
    setMessage(`${item.name}を${qty}個購入しました！（${totalCost}G）`)
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

        {items.length === 0 && (
          <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'20px' }}>
            購入できるアイテムがありません
          </div>
        )}

        {items.map(item => {
          const owned = playerItems.find(pi => pi.item_id === item.id)
          const qty = getQuantity(item.id)
          const totalCost = item.buy_price * qty
          const canBuy = profile.gold >= totalCost
          return (
            <div key={item.id} style={{ border:'1px solid #002244', background:'#001028', padding:'12px', marginBottom:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ color:'#88ccff', fontSize:'13px' }}>{item.name}</span>
                {owned && <span style={{ color:'#446688', fontSize:'10px' }}>所持: {owned.quantity}個</span>}
              </div>
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>{item.description}</div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <span style={{ color:'#446688', fontSize:'10px' }}>個数:</span>
                  <button onClick={() => setQuantity(item.id, qty - 1)}
                    style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 6px', fontFamily:'monospace', fontSize:'12px' }}>-</button>
                  <input
                    type="number" value={qty} min={1} max={999}
                    onChange={e => setQuantity(item.id, e.target.value)}
                    style={{ width:'40px', background:'#001028', border:'1px solid #003366', color:'#88ccff', textAlign:'center', fontFamily:'monospace', fontSize:'12px', padding:'2px' }}
                  />
                  <button onClick={() => setQuantity(item.id, qty + 1)}
                    style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 6px', fontFamily:'monospace', fontSize:'12px' }}>+</button>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ color:'#ffcc00', fontSize:'12px' }}>{totalCost.toLocaleString()}G</span>
                  <span style={{ color:'#446688', fontSize:'10px' }}>({item.buy_price}G×{qty})</span>
                  <button onClick={() => buyItem(item)} disabled={!canBuy || loading}
                    style={{ padding:'4px 10px', background: canBuy ? '#001840' : '#001', border:`1px solid ${canBuy ? '#44aa44' : '#002244'}`, color: canBuy ? '#44aa44' : '#334455', cursor: canBuy ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                    購入
                  </button>
                </div>
              </div>
              {!canBuy && (
                <div style={{ color:'#ff4444', fontSize:'10px', marginTop:'4px', textAlign:'right' }}>
                  {(totalCost - profile.gold).toLocaleString()}G不足
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
