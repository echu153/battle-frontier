import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveTotal, getTotalRank } from '../lib/stats'

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
      const list = data || []
      const ids = list.map(p => p.id)
      // 50人分の装備中装備と熟練度をまとめて取得（in句で2クエリ）
      let eqs = [], profs = []
      if (ids.length > 0) {
        const [{ data: eqData }, { data: profData }] = await Promise.all([
          supabase.from('player_equipment').select('*, weapons(*)').in('player_id', ids).eq('equipped', true),
          supabase.from('proficiency').select('player_id, equipment_id, prof_lv').in('player_id', ids),
        ])
        eqs = eqData || []
        profs = profData || []
      }
      // プレイヤーごとに装備＋熟練度込みの総合力を算出
      const withTotal = list.map(p => {
        const eq = eqs.filter(e => e.player_id === p.id)
        const pf = profs.filter(x => x.player_id === p.id)
        return { ...p, _total: calcEffectiveTotal(p, eq, pf) }
      })
      const sorted = withTotal.sort((a, b) => b._total - a._total)
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
              const total = p._total
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
                      {p.username}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                      {p.class}<span style={{color:'#ffcc00'}}>{stars}</span> <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
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
