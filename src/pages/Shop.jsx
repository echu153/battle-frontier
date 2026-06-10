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
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: p, error: pe } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (pe || !p) { nav('/game'); return } // プロフィール取得失敗時は固まらず街へ
      setProfile(p)
      const unlockedAreas = Array.isArray(p.unlocked_areas) && p.unlocked_areas.length ? p.unlocked_areas : [1]
      const maxArea = Math.max(...unlockedAreas)
      const { data: it } = await supabase.from('items').select('*')
        .lte('unlock_area', maxArea)
        .eq('is_shop_item', true)
        .order('id')
      setItems(it || [])
      const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
      setPlayerItems(pi || [])
    } catch (err) {
      console.error('Shop fetch error:', err)
      setProfile((prev) => prev || { gold: 0, _error: true })
    }
  }

  const getQuantity = (itemId) => {
    const v = quantities[itemId]
    if (v === '' || v === undefined) return 1 // 入力中の空欄は1扱いで計算
    return v
  }

  const setQuantity = (itemId, val) => {
    const num = Math.max(1, Math.min(999, Number(val) || 1))
    setQuantities(q => ({ ...q, [itemId]: num }))
  }

  // 入力中: 空欄を許容（打ち直せるように）。数字は即クランプ
  const onQuantityInput = (itemId, raw) => {
    if (raw === '') { setQuantities(q => ({ ...q, [itemId]: '' })); return }
    setQuantity(itemId, raw)
  }

  // フォーカスが外れたら空欄を1に補正
  const onQuantityBlur = (itemId) => {
    if (quantities[itemId] === '') setQuantities(q => ({ ...q, [itemId]: 1 }))
  }

  const buyItem = async (item) => {
    const qty = getQuantity(item.id)
    const totalCost = item.buy_price * qty
    if (profile.gold < totalCost) return
    setLoading(true)
    const { data, error } = await supabase.rpc('buy_item_from_shop', {
      p_item_id: item.id,
      p_quantity: qty,
    })
    if (error || !data?.ok) {
      setMessage('購入に失敗しました')
      setTimeout(() => setMessage(''), 2000)
      setLoading(false)
      return
    }
    setMessage(`${item.name}を${qty}個購入しました！（${totalCost}G）`)
    setTimeout(() => setMessage(''), 2000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>
      読み込み中...<br /><br />
      <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'6px 14px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>← 街に戻る</button>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
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
                    type="number" value={quantities[item.id] === '' ? '' : qty} min={1} max={999}
                    onChange={e => onQuantityInput(item.id, e.target.value)}
                    onBlur={() => onQuantityBlur(item.id)}
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
