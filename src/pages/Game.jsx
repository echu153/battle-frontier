import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const WAIT_SECONDS = 20

const ENEMIES = [
  { name:'スライム',  hp:15, atk:4,  def:1, exp:8,  gold:5  },
  { name:'コウモリ',  hp:18, atk:6,  def:2, exp:10, gold:8  },
  { name:'毒キノコ',  hp:20, atk:5,  def:3, exp:12, gold:10 },
]

export default function Game() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [canAct, setCanAct] = useState(false)
  const [scene, setScene] = useState('town') // town / battle
  const [battleLogs, setBattleLogs] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchProfile() }, [])

  useEffect(() => {
    if (!profile) return
    const id = setInterval(() => {
      const elapsed = (Date.now() - new Date(profile.last_action_at).getTime()) / 1000
      const rem = Math.max(0, WAIT_SECONDS - elapsed)
      setRemaining(rem)
      setCanAct(rem === 0)
    }, 200)
    return () => clearInterval(id)
  }, [profile])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!data) { nav('/create'); return }
    setProfile(data)
  }

  const doBattle = async () => {
    if (!canAct || loading) return
    setLoading(true)
    setScene('battle')
    setBattleLogs([])

    const enemy = ENEMIES[Math.floor(Math.random() * ENEMIES.length)]
    const logs = []

    logs.push({ text:`${enemy.name}が現れた！`, color:'#88ccff' })

    const dmgToEnemy = Math.max(1, profile.atk - enemy.def + Math.floor(Math.random() * 4))
    const dmgToPlayer = Math.max(1, enemy.atk - Math.floor(profile.def / 2) + Math.floor(Math.random() * 3))
    const win = dmgToEnemy >= enemy.hp

    logs.push({ text:`あなたの攻撃！ ${enemy.name}に${dmgToEnemy}ダメージ！`, color:'#ffcc00' })

    if (win) {
      logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
      logs.push({ text:`EXP + ${enemy.exp}　Gold + ${enemy.gold}`, color:'#ffcc00' })
    } else {
      logs.push({ text:`${enemy.name}の反撃！ あなたに${dmgToPlayer}ダメージ…`, color:'#ff4444' })
      logs.push({ text:`敗北…　EXP + ${Math.floor(enemy.exp * 0.2)}`, color:'#ff6644' })
    }

    const newExp = profile.exp + (win ? enemy.exp : Math.floor(enemy.exp * 0.2))
    const newGold = profile.gold + (win ? enemy.gold : 0)
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let finalExp = newExp

    if (finalExp >= newExpNext) {
      finalExp -= newExpNext
      newLv++
      newExpNext = newLv * 100
      logs.push({ text:`★ レベルアップ！ LV${newLv} になった！`, color:'#cc44ff' })
    }

    setBattleLogs(logs)

    await supabase.from('profiles').update({
      exp: finalExp,
      exp_next: newExpNext,
      lv: newLv,
      gold: newGold,
      last_action_at: new Date().toISOString(),
    }).eq('id', profile.id)

    await fetchProfile()
    setLoading(false)
  }

  const backToTown = () => {
    setScene('town')
    setBattleLogs([])
  }

  const logout = async () => {
    await supabase.auth.signOut()
    nav('/login')
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const expPct = Math.min(100, (profile.exp / profile.exp_next) * 100)
  const timerPct = ((WAIT_SECONDS - remaining) / WAIT_SECONDS) * 100

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'800px', margin:'0 auto' }}>

        {/* ヘッダー */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={logout} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ログアウト</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>

          {/* ステータス（常に表示） */}
          <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', alignSelf:'start' }}>
            <div style={{ color:'#ffcc00', fontSize:'12px', borderBottom:'1px dashed #003366', paddingBottom:'4px', marginBottom:'8px' }}>
              {profile.username}
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>クラス: <span style={{color:'#88ccff'}}>{profile.class}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'6px' }}>LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span></div>

            <StatBar label="HP" val={`${profile.hp_max}/${profile.hp_max}`} pct={100} color="#00cc44" />
            <StatBar label="MP" val={`${profile.mp_max}/${profile.mp_max}`} pct={100} color="#4488ff" />

            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
              <span>EXP</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
            </div>
            <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${expPct}%`, background:'linear-gradient(90deg,#331100,#cc8800)', transition:'width 0.4s' }} />
            </div>

            <div style={{ fontSize:'11px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', color:'#446688' }}>
              <span>ATK: <span style={{color:'#ffcc00'}}>{profile.atk}</span></span>
              <span>DEF: <span style={{color:'#88aaff'}}>{profile.def}</span></span>
              <span>MATK: <span style={{color:'#cc44ff'}}>{profile.matk}</span></span>
              <span>MDEF: <span style={{color:'#44ccff'}}>{profile.mdef}</span></span>
              <span>SPD: <span style={{color:'#ff8844'}}>{profile.spd}</span></span>
              <span>G: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
            </div>
          </div>

          {/* 右カラム：街 or バトル */}
          <div>
            {scene === 'town' && (
              <div>
                {/* タイマー */}
                <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'8px' }}>
                  <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
                    <span style={{ color:'#446688' }}>次の行動まで</span>
                    <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>
                      {canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}
                    </span>
                  </div>
                  <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'12px' }}>
                    <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
                  </div>
                  <button onClick={doBattle} disabled={!canAct || loading}
                    style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`, color: canAct ? '#ffcc00' : '#446688', cursor: canAct ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
                    {canAct ? '⚔ 始まりの森へ出撃！' : '⏳ 待機中...'}
                  </button>
                </div>
              </div>
            )}

            {scene === 'battle' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
                <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>

                {loading && (
                  <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>
                )}

                <div style={{ marginBottom:'12px' }}>
                  {battleLogs.map((l, i) => (
                    <div key={i} style={{ color: l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0' }}>
                      {l.text}
                    </div>
                  ))}
                </div>

                {!loading && (
                  <button onClick={backToTown}
                    style={{ width:'100%', padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                    🏰 街に戻る
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatBar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'11px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
        <span>{label}</span><span style={{color}}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}