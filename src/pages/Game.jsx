import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const WAIT_SECONDS = 20

const ENEMIES = [
  { name:'スライム',  hp:15, atk:4,  def:1, exp:8,  gold:5  },
  { name:'コウモリ',  hp:18, atk:6,  def:2, exp:10, gold:8  },
  { name:'毒キノコ',  hp:20, atk:5,  def:3, exp:12, gold:10 },
]

const JOB_GROWTH = {
  '戦士':    { hp:6, mp:1, atk:2, def:2, matk:0, mdef:1, spd:0 },
  '弓使い':  { hp:4, mp:2, atk:2, def:1, matk:1, mdef:1, spd:2 },
  '魔法使い':{ hp:3, mp:5, atk:0, def:1, matk:3, mdef:1, spd:1 },
  '僧侶':    { hp:4, mp:4, atk:0, def:1, matk:2, mdef:3, spd:0 },
}

const STAT_LABELS = {
  hp:'HP', mp:'MP', atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ'
}

export default function Game() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [canAct, setCanAct] = useState(false)
  const [scene, setScene] = useState('town')
  const [battleLogs, setBattleLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [levelUpData, setLevelUpData] = useState(null) // レベルアップ時のデータ
  const [statPoints, setStatPoints] = useState({}) // 振り分け中のポイント

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

    const enemy = { ...ENEMIES[Math.floor(Math.random() * ENEMIES.length)] }
    const logs = []
    let playerHp = profile.hp_max
    let enemyHp = enemy.hp
    let turn = 1

    logs.push({ text:`${enemy.name}が現れた！`, color:'#88ccff' })

    while (playerHp > 0 && enemyHp > 0 && turn <= 20) {
      const dmgToEnemy = Math.max(1, profile.atk - enemy.def + Math.floor(Math.random() * 4))
      enemyHp -= dmgToEnemy
      logs.push({ text:`${turn}ターン目: あなたの攻撃！ ${enemy.name}に${dmgToEnemy}ダメージ！`, color:'#ffcc00' })
      if (enemyHp <= 0) break

      const dmgToPlayer = Math.max(1, enemy.atk - Math.floor(profile.def / 2) + Math.floor(Math.random() * 3))
      playerHp -= dmgToPlayer
      logs.push({ text:`${turn}ターン目: ${enemy.name}の反撃！ あなたに${dmgToPlayer}ダメージ…`, color:'#ff6644' })
      turn++
    }

    const win = enemyHp <= 0
    const expGained = win ? enemy.exp : Math.floor(enemy.exp * 0.2)
    const goldGained = win ? enemy.gold : 0

    if (win) {
      logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
      logs.push({ text:`EXP + ${expGained}　Gold + ${goldGained}`, color:'#ffcc00' })
    } else {
      logs.push({ text:`敗北…`, color:'#ff4444' })
      logs.push({ text:`EXP + ${expGained}`, color:'#ff6644' })
    }

    setBattleLogs(logs)

    const newExp = profile.exp + expGained
    const newGold = profile.gold + goldGained
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let finalExp = newExp
    const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
    let updates = {
      exp: finalExp,
      exp_next: newExpNext,
      lv: newLv,
      gold: newGold,
      last_action_at: new Date().toISOString(),
    }

    if (finalExp >= newExpNext) {
      finalExp -= newExpNext
      newLv++
      newExpNext = newLv * 100
      updates = {
        ...updates,
        exp: finalExp,
        exp_next: newExpNext,
        lv: newLv,
        hp_max: profile.hp_max + growth.hp,
        mp_max: profile.mp_max + growth.mp,
        atk: profile.atk + growth.atk,
        def: profile.def + growth.def,
        matk: profile.matk + growth.matk,
        mdef: profile.mdef + growth.mdef,
        spd: profile.spd + growth.spd,
      }
      setLevelUpData({ newLv, updates })
      setStatPoints({ hp:0, mp:0, atk:0, def:0, matk:0, mdef:0, spd:0 })
    }

    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchProfile()
    setLoading(false)
  }

  const confirmStatPoints = async () => {
    const total = Object.values(statPoints).reduce((a, b) => a + b, 0)
    if (total !== 1) return
    const updates = {
      hp_max: levelUpData.updates.hp_max + (statPoints.hp || 0) * 10,
      mp_max: levelUpData.updates.mp_max + (statPoints.mp || 0) * 5,
      atk: levelUpData.updates.atk + (statPoints.atk || 0),
      def: levelUpData.updates.def + (statPoints.def || 0),
      matk: levelUpData.updates.matk + (statPoints.matk || 0),
      mdef: levelUpData.updates.mdef + (statPoints.mdef || 0),
      spd: levelUpData.updates.spd + (statPoints.spd || 0),
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchProfile()
    setLevelUpData(null)
    setScene('town')
  }

  const backToTown = () => {
    if (levelUpData) return
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

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={logout} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ログアウト</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>

          {/* ステータス */}
          <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', alignSelf:'start' }}>
            <div style={{ color:'#ffcc00', fontSize:'12px', borderBottom:'1px dashed #003366', paddingBottom:'4px', marginBottom:'8px' }}>
              {profile.username}
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>クラス: <span style={{color:'#88ccff'}}>{profile.class}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'6px' }}>LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span></div>

            <StatBar label="HP" val={`${profile.hp_max}/${profile.hp_max}`} pct={100} color="#00cc44" />
            <StatBar label="MP" val={`${profile.mp_max}/${profile.mp_max}`} pct={100} color="#4488ff" />

            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
              <span>経験値</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
            </div>
            <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${expPct}%`, background:'linear-gradient(90deg,#331100,#cc8800)', transition:'width 0.4s' }} />
            </div>

            <div style={{ fontSize:'11px', display:'grid', gridTemplateColumns:'1fr', gap:'2px', color:'#446688' }}>
              <span>攻撃力: <span style={{color:'#ffcc00'}}>{profile.atk}</span></span>
              <span>防御力: <span style={{color:'#88aaff'}}>{profile.def}</span></span>
              <span>特殊攻撃力: <span style={{color:'#cc44ff'}}>{profile.matk}</span></span>
              <span>特殊防御力: <span style={{color:'#44ccff'}}>{profile.mdef}</span></span>
              <span>素早さ: <span style={{color:'#ff8844'}}>{profile.spd}</span></span>
              <span>ゴールド: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
            </div>
          </div>

          {/* 右カラム */}
          <div>
            {/* レベルアップ画面 */}
            {levelUpData && (
              <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#cc44ff', fontSize:'14px', marginBottom:'10px', textAlign:'center' }}>
                  ★ LEVEL UP！ LV{levelUpData.newLv} になった！
                </div>
                <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'10px', textAlign:'center' }}>
                  ステータスポイントを1つ振り分けてください
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
                  {Object.keys(STAT_LABELS).map(stat => (
                    <div key={stat} style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      border:`1px solid ${statPoints[stat] > 0 ? '#cc44ff' : '#003366'}`,
                      background: statPoints[stat] > 0 ? '#1a0030' : '#000818',
                      padding:'6px 8px', cursor:'pointer',
                    }}
                      onClick={() => {
                        const total = Object.values(statPoints).reduce((a, b) => a + b, 0)
                        if (statPoints[stat] > 0) {
                          setStatPoints(p => ({ ...p, [stat]: 0 }))
                        } else if (total < 1) {
                          setStatPoints(p => ({ ...p, [stat]: 1 }))
                        }
                      }}
                    >
                      <span style={{ color:'#88ccff', fontSize:'11px' }}>{STAT_LABELS[stat]}</span>
                      <span style={{ color: statPoints[stat] > 0 ? '#cc44ff' : '#446688', fontSize:'11px' }}>
                        {statPoints[stat] > 0 ? '+1 ✓' : '+1'}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={confirmStatPoints}
                  disabled={Object.values(statPoints).reduce((a, b) => a + b, 0) !== 1}
                  style={{ width:'100%', padding:'10px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', opacity: Object.values(statPoints).reduce((a, b) => a + b, 0) !== 1 ? 0.4 : 1 }}>
                  決定する
                </button>
              </div>
            )}

            {/* 街 */}
            {scene === 'town' && !levelUpData && (
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
            )}

            {/* バトル */}
            {scene === 'battle' && !levelUpData && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
                <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
                {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
                <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
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