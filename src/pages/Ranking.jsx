import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const calcTotal = (p) => Math.floor(
  (p.hp_max / 10) + (p.mp_max / 5) +
  p.atk + p.def + p.matk + p.mdef + p.spd
)

const getTotalRank = (total) => {
  const thresholds = [200, 500, 1000, 2000, 4000, 7000, 11000, 16000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank: 'SSS', color: '#ffcc00' }
}


export default function Ranking() {
  const nav = useNavigate()
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setCurrentUserId(user.id)
      const { data } = await supabase
        .from('profiles')
.select('id, username, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url')
.order('char_lv', { ascending: false })        .limit(50)
      const sorted = (data || []).sort((a, b) => calcTotal(b) - calcTotal(a))
      setPlayers(sorted)
      setLoading(false)
    }
    init()
  }, [])

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'16px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 街に戻る
          </button>
        </div>

        <div style={{ color:'#ffcc00', fontSize:'14px', marginBottom:'12px', textAlign:'center', letterSpacing:'2px' }}>
          🏆 総合力ランキング
        </div>

        {loading ? (
          <div style={{ color:'#446688', textAlign:'center' }}>読み込み中...</div>
        ) : (
          <div style={{ border:'1px solid #0044aa', background:'#001040' }}>
            <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 50px 50px 70px 50px', padding:'8px 12px', borderBottom:'1px solid #003366', fontSize:'10px', color:'#446688' }}>
              <span>順位</span>
              <span>名前</span>
              <span style={{textAlign:'center'}}>クラス</span>
              <span style={{textAlign:'center'}}>LV</span>
              <span style={{textAlign:'right'}}>総合力</span>
              <span style={{textAlign:'center'}}>ランク</span>
            </div>

            {players.map((p, i) => {
              const total = calcTotal(p)
              const totalRank = getTotalRank(total)
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`
              const isMe = p.id === currentUserId
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'grid', gridTemplateColumns:'40px 1fr 50px 50px 70px 50px',
                    padding:'8px 12px',
                    borderBottom:'1px solid #001428',
                    background: isMe ? '#001830' : i === 0 ? '#1a1000' : 'transparent',
                    cursor:'pointer',
                    transition:'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#001840'}
                  onMouseLeave={e => e.currentTarget.style.background = isMe ? '#001830' : i === 0 ? '#1a1000' : 'transparent'}
                >
                  <span style={{ color: i < 3 ? '#ffcc00' : '#446688', fontSize:'12px' }}>{medal}</span>
<span style={{ display:'flex', alignItems:'center', gap:'6px', color: isMe ? '#44ff88' : '#88ccff', fontSize:'12px' }}>
  {p.avatar_url && (
<img src={p.avatar_url} alt="avatar"
      style={{ width:'24px', height:'24px', objectFit:'cover' }} />
  )}
  {p.username}{isMe && ' (自分)'}
</span>
<span style={{ color:'#88ccff', fontSize:'11px', textAlign:'center' }}>{p.class}</span><span style={{ color:'#ffcc00', fontSize:'12px', textAlign:'center' }}>{p.char_lv || p.lv}</span>                  <span style={{ color:'#44ff88', fontSize:'12px', textAlign:'right', fontWeight:'bold' }}>{total}</span>
                  <span style={{ color: totalRank.color, fontSize:'11px', textAlign:'center', fontWeight:'bold' }}>{totalRank.rank}</span>
                </div>
              )
            })}

            {players.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだプレイヤーがいません
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}