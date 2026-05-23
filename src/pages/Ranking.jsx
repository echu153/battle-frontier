import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const calcTotal = (p) => {
  return Math.floor(
    (p.hp_max / 10) +
    (p.mp_max / 5) +
    p.atk + p.def + p.matk + p.mdef + p.spd
  )
}

const JOB_ICONS = { '戦士':'⚔️', '弓使い':'🏹', '魔法使い':'🔮', '僧侶':'✨' }

export default function Ranking() {
  const nav = useNavigate()
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('profiles')
      .select('username, lv, class, hp_max, mp_max, atk, def, matk, mdef, spd')
      .order('lv', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const sorted = (data || []).sort((a, b) => calcTotal(b) - calcTotal(a))
        setPlayers(sorted)
        setLoading(false)
      })
  }, [])

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'16px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
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
            {/* ヘッダー */}
            <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 60px 60px 80px', padding:'8px 12px', borderBottom:'1px solid #003366', fontSize:'10px', color:'#446688' }}>
              <span>順位</span>
              <span>名前</span>
              <span style={{textAlign:'center'}}>クラス</span>
              <span style={{textAlign:'center'}}>LV</span>
              <span style={{textAlign:'right'}}>総合力</span>
            </div>

            {players.map((p, i) => {
              const total = calcTotal(p)
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`
              return (
                <div key={p.username} style={{
                  display:'grid', gridTemplateColumns:'40px 1fr 60px 60px 80px',
                  padding:'8px 12px',
                  borderBottom:'1px solid #001428',
                  background: i === 0 ? '#1a1000' : 'transparent',
                }}>
                  <span style={{ color: i < 3 ? '#ffcc00' : '#446688', fontSize:'12px' }}>{medal}</span>
                  <span style={{ color:'#88ccff', fontSize:'12px' }}>{p.username}</span>
                  <span style={{ color:'#446688', fontSize:'12px', textAlign:'center' }}>{JOB_ICONS[p.class]}</span>
                  <span style={{ color:'#ffcc00', fontSize:'12px', textAlign:'center' }}>{p.lv}</span>
                  <span style={{ color:'#44ff88', fontSize:'12px', textAlign:'right', fontWeight:'bold' }}>{total}</span>
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