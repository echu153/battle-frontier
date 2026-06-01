import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const EXCHANGE_RATE = 100 // 100G = 1メダル（SQLのrateと一致させること）
const EXCHANGE_OPTIONS = [1, 5, 10, 50, 100]

export default function Casino() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#ffaa00')
  const [tab, setTab] = useState('exchange')

  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    setProfile(p)
  }

  const showMessage = (msg, color = '#ffaa00') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const exchange = async (medalCount) => {
    if (loading || !profile) return
    const goldCost = medalCount * EXCHANGE_RATE
    if (profile.gold < goldCost) { showMessage('Goldが足りません！', '#ff4444'); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('exchange_gold_to_medals', { gold_amount: goldCost })
    if (error) {
      showMessage(`両替に失敗しました: ${error.message}`, '#ff4444')
      setLoading(false)
      return
    }
    await fetchProfile()
    showMessage(`💰 ${goldCost}Gを ${data.gained}メダルに両替しました！`, '#ffcc00')
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#ffaa00', fontSize:'14px', marginBottom:'4px' }}>🎰 賭博場</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', display:'flex', gap:'16px' }}>
          <span>所持金: <span style={{color:'#ffcc00'}}>{profile.gold.toLocaleString()}G</span></span>
          <span>メダル: <span style={{color:'#ffaa00'}}>🎫 {(profile.medals||0).toLocaleString()}</span></span>
        </div>

        {message && (
          <div style={{ color:messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        <div style={{ display:'flex', gap:'4px', marginBottom:'12px', flexWrap:'wrap' }}>
          {[{id:'exchange',label:'💰 両替所'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab===t.id?'#1a1000':'#000818',
                border:`1px solid ${tab===t.id?'#ffaa00':'#003366'}`,
                color: tab===t.id?'#ffaa00':'#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==='exchange' && (
          <div style={{ border:'1px solid #886600', background:'#0a0800', padding:'16px' }}>
            <div style={{ color:'#ffaa00', fontSize:'13px', marginBottom:'8px' }}>💰 メダル両替所</div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', lineHeight:'1.8' }}>
              Goldをメダルに両替できます。<br/>
              レート: <span style={{color:'#ffcc00'}}>{EXCHANGE_RATE}G</span> = <span style={{color:'#ffaa00'}}>🎫 1メダル</span><br/>
              ※ メダルからGoldへの払い戻しはできません
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
              {EXCHANGE_OPTIONS.map(n => {
                const cost = n * EXCHANGE_RATE
                const canBuy = profile.gold >= cost
                return (
                  <button key={n} onClick={()=>exchange(n)} disabled={!canBuy || loading}
                    style={{ padding:'10px', background: canBuy?'#1a1000':'#001', border:`1px solid ${canBuy?'#ffaa00':'#002244'}`, color: canBuy?'#ffaa00':'#334455', cursor: canBuy?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
                    🎫 {n}メダル<br/>
                    <span style={{ fontSize:'10px', color: canBuy?'#ccaa66':'#334455' }}>{cost.toLocaleString()}G</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
