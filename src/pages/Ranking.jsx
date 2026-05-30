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
        .select('id, username, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url, retraining')
        .order('char_lv', { ascending: false })
        .limit(50)
      const sorted = (data || []).sort((a, b) => calcTotal(b) - calcTotal(a))
      setPlayers(sorted)
      setLoading(false)
    }
    init()
  }, [])

  const getStars = (p) => {
    const count = (p.retraining || {})[p.class] || 0
    return '★'.repeat(count)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'14px', letterSpacing:'2px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 戻る
          </button>
        </div>

        <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'10px', textAlign:'center', letterSpacing:'2px' }}>
          🏆 総合力ランキング
        </div>

        {loading ? (
          <div style={{ color:'#446688', textAlign:'center' }}>読み込み中...</div>
        ) : (
          <div>
            {players.map((p, i) => {
              const total = calcTotal(p)
              const totalRank = getTotalRank(total)
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              const isMe = p.id === currentUserId
              const stars = getStars(p)
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px',
                    marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#001a33'}`,
                    background: isMe ? '#001830' : i === 0 ? '#1a1000' : '#000e1a',
                    cursor:'pointer',
                    borderRadius:'2px',
                  }}
                >
                  {/* 順位 */}
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal
                      ? <span style={{ fontSize:'16px' }}>{medal}</span>
                      : <span style={{ color:'#446688', fontSize:'11px' }}>{i+1}</span>
                    }
                  </div>

                  {/* アバター */}
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" style={{ width:'36px', height:'36px', objectFit:'cover', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', background:'#001428', border:'1px solid #003366', flexShrink:0 }} />
                  }

                  {/* 名前・クラス */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#88ccff', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.username}{stars && <span style={{color:'#ffcc00'}}>{stars}</span>}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                      {p.class} <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
                    </div>
                  </div>

                  {/* 総合力・ランク */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#44ff88', fontSize:'13px', fontWeight:'bold' }}>{total}</div>
                    <div style={{ color: totalRank.color, fontSize:'11px', fontWeight:'bold' }}>{totalRank.rank}</div>
                  </div>
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
