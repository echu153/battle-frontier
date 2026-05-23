import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const WAIT_SECONDS = 20
const REGEN_SECONDS = 180

const AREAS = [
  {
    id: 1,
    name: '始まりの森',
    enemies: [
      { name:'スライム',   hp:20, atk:8,  def:2, gold:5  },
      { name:'コウモリ',   hp:25, atk:10, def:2, gold:6  },
      { name:'毒キノコ',   hp:40, atk:15, def:3, gold:8  },
    ],
    boss: { name:'ビッグスライム', hp:500, atk:40, def:10, gold:100, isBoss:true },
  },
  {
    id: 2,
    name: '荒廃した草原',
    enemies: [
      { name:'ゴブリン',   hp:80,  atk:35, def:8,  gold:20 },
      { name:'野良犬',     hp:100, atk:45, def:10, gold:25 },
      { name:'盗賊',       hp:120, atk:55, def:12, gold:30 },
    ],
    boss: { name:'盗賊団のリーダー', hp:2000, atk:120, def:30, gold:500, isBoss:true },
  },
  {
    id: 3,
    name: '古代の洞窟',
    enemies: [
      { name:'コボルト',   hp:200, atk:100, def:25, gold:60  },
      { name:'スケルトン', hp:250, atk:120, def:30, gold:80  },
      { name:'ゴーレム',   hp:300, atk:150, def:40, gold:100 },
    ],
    boss: { name:'古代の番人', hp:8000, atk:300, def:80, gold:2000, isBoss:true },
  },
]

const JOB_GROWTH = {
  '戦士':    { hp:6, mp:1, atk:2, def:2, matk:0, mdef:1, spd:0 },
  '弓使い':  { hp:4, mp:2, atk:2, def:1, matk:1, mdef:1, spd:2 },
  '魔法使い':{ hp:3, mp:5, atk:0, def:1, matk:3, mdef:1, spd:1 },
  '僧侶':    { hp:4, mp:4, atk:0, def:1, matk:2, mdef:3, spd:0 },
}

const STAT_LABELS = {
  hp:'HP (+10)', mp:'MP (+5)', atk:'攻撃力 (+1)', def:'防御力 (+1)',
  matk:'特殊攻撃力 (+1)', mdef:'特殊防御力 (+1)', spd:'素早さ (+1)'
}

const calcTotal = (p) => Math.floor(
  (p.hp_max / 10) + (p.mp_max / 5) +
  p.atk + p.def + p.matk + p.mdef + p.spd
)

const calcExpNext = (lv) => (Math.floor((lv - 1) / 10) + 1) * 100

export default function Game() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [canAct, setCanAct] = useState(false)
  const [scene, setScene] = useState('town')
  const [battleLogs, setBattleLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [pendingPoints, setPendingPoints] = useState(0)
  const [statPoints, setStatPoints] = useState({})
  const [showStatPanel, setShowStatPanel] = useState(false)
  const [selectedArea, setSelectedArea] = useState(1)
  const [regenRemaining, setRegenRemaining] = useState(0)
  const [innMessage, setInnMessage] = useState('')

  useEffect(() => { fetchProfile() }, [])

  useEffect(() => {
    if (!profile) return
    const id = setInterval(() => {
      const elapsed = (Date.now() - new Date(profile.last_action_at).getTime()) / 1000
      const rem = Math.max(0, WAIT_SECONDS - elapsed)
      setRemaining(rem)
      setCanAct(rem === 0)

      const regenElapsed = (Date.now() - new Date(profile.last_regen_at).getTime()) / 1000
      const regenRem = Math.max(0, REGEN_SECONDS - regenElapsed)
      setRegenRemaining(regenRem)
      if (regenRem === 0) doRegen()
    }, 200)
    return () => clearInterval(id)
  }, [profile])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!data) { nav('/create'); return }
    setProfile(data)
    setPendingPoints(data.pending_stat_points || 0)
    const unlocked = data.unlocked_areas || [1]
    if (!unlocked.includes(selectedArea)) setSelectedArea(unlocked[0])
  }

  const doRegen = async () => {
    if (!profile) return
    const current = profile.hp_current ?? profile.hp_max
    const newHp = Math.min(profile.hp_max, Math.floor(current + profile.hp_max * 0.1))
    const newMp = Math.min(profile.mp_max, Math.floor((profile.mp_current ?? profile.mp_max) + profile.mp_max * 0.1))
    await supabase.from('profiles').update({
      hp_current: newHp, mp_current: newMp,
      last_regen_at: new Date().toISOString(),
    }).eq('id', profile.id)
    await fetchProfile()
  }

  const doBattle = async () => {
    if (!canAct || loading) return
    const hpCurrent = profile.hp_current ?? profile.hp_max
    if (hpCurrent <= 0) return // 瀕死中は戦闘不可
    setLoading(true)
    setScene('battle')
    setBattleLogs([])

    const area = AREAS.find(a => a.id === selectedArea)
    const bossRate = profile.boss_encounter_rate || 0
    const isBossEncounter = Math.random() * 100 < bossRate
    const enemy = isBossEncounter
      ? { ...area.boss }
      : { ...area.enemies[Math.floor(Math.random() * area.enemies.length)] }

    const logs = []
    let playerHp = hpCurrent
    let enemyHp = enemy.hp
    let turn = 1

    if (isBossEncounter) {
      logs.push({ text:`⚠ ボス出現！ ${enemy.name}が現れた！`, color:'#ff4444' })
    } else {
      logs.push({ text:`${enemy.name}が現れた！`, color:'#88ccff' })
    }

    while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
      const dmgToEnemy = Math.max(1, profile.atk - Math.floor(enemy.def / 2) + Math.floor(Math.random() * 4))
      enemyHp -= dmgToEnemy
      logs.push({ text:`${turn}ターン目: あなたの攻撃！ ${enemy.name}に${dmgToEnemy}ダメージ！`, color:'#ffcc00' })
      if (enemyHp <= 0) break

      const dmgToPlayer = Math.max(1, enemy.atk - Math.floor(profile.def / 2) + Math.floor(Math.random() * 3))
      playerHp -= dmgToPlayer
      logs.push({ text:`${turn}ターン目: ${enemy.name}の反撃！ あなたに${dmgToPlayer}ダメージ…`, color:'#ff6644' })
      turn++
    }

    // HPは0以下にしない
    playerHp = Math.max(0, playerHp)

    const win = enemyHp <= 0
    const expGained = isBossEncounter ? 13 : Math.floor(Math.random() * 4) + 8
    const goldGained = win ? enemy.gold : 0

    if (win) {
      logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
      logs.push({ text:`EXP + ${expGained}　Gold + ${goldGained}`, color:'#ffcc00' })
    } else {
      logs.push({ text:`敗北…`, color:'#ff4444' })
      logs.push({ text:`EXP + ${expGained}`, color:'#ff6644' })
    }

    if (playerHp === 0) {
      logs.push({ text:`⚠ 瀕死状態！宿屋で回復してください。`, color:'#ff4444' })
    }

    setBattleLogs(logs)

    const newBossRate = isBossEncounter ? 0 : bossRate + 0.5
    let newUnlockedAreas = [...(profile.unlocked_areas || [1])]
    if (win && enemy.isBoss && !newUnlockedAreas.includes(selectedArea + 1)) {
      const nextArea = selectedArea + 1
      if (nextArea <= AREAS.length) {
        newUnlockedAreas.push(nextArea)
        logs.push({ text:`🎉 新エリア「${AREAS.find(a => a.id === nextArea)?.name}」が解放された！`, color:'#cc44ff' })
        setBattleLogs([...logs])
      }
    }

    let newExp = profile.exp + expGained
    let newGold = profile.gold + goldGained
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPendingPoints = profile.pending_stat_points || 0
    const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
    let statUpdates = {}

    while (newExp >= newExpNext) {
      newExp -= newExpNext
      newLv++
      newExpNext = calcExpNext(newLv)
      newPendingPoints++
      statUpdates = {
        hp_max: (statUpdates.hp_max || profile.hp_max) + growth.hp,
        mp_max: (statUpdates.mp_max || profile.mp_max) + growth.mp,
        atk:    (statUpdates.atk    || profile.atk)    + growth.atk,
        def:    (statUpdates.def    || profile.def)    + growth.def,
        matk:   (statUpdates.matk   || profile.matk)   + growth.matk,
        mdef:   (statUpdates.mdef   || profile.mdef)   + growth.mdef,
        spd:    (statUpdates.spd    || profile.spd)    + growth.spd,
      }
      logs.push({ text:`★ LEVEL UP！ LV${newLv} になった！ ステータスポイント+1`, color:'#cc44ff' })
      setBattleLogs([...logs])
    }

    await supabase.from('profiles').update({
      exp: newExp, exp_next: newExpNext, lv: newLv, gold: newGold,
      hp_current: playerHp,
      boss_encounter_rate: newBossRate,
      unlocked_areas: newUnlockedAreas,
      pending_stat_points: newPendingPoints,
      last_action_at: new Date().toISOString(),
      ...statUpdates,
    }).eq('id', profile.id)

    await fetchProfile()
    setLoading(false)
  }

  const useInn = async () => {
    const isDying = (profile.hp_current ?? profile.hp_max) <= 0
    const cost = isDying ? profile.lv * 30 : profile.lv * 3
    if (profile.gold < cost) return
    await supabase.from('profiles').update({
      hp_current: profile.hp_max,
      mp_current: profile.mp_max,
      gold: profile.gold - cost,
    }).eq('id', profile.id)
    await fetchProfile()
    setInnMessage('HPとMPが回復しました！')
    setTimeout(() => { setInnMessage(''); setScene('town') }, 1500)
  }

  const confirmStatPoints = async () => {
    const total = Object.values(statPoints).reduce((a, b) => a + b, 0)
    if (total !== pendingPoints) return
    const updates = {
      hp_max: profile.hp_max + (statPoints.hp || 0) * 10,
      mp_max: profile.mp_max + (statPoints.mp || 0) * 5,
      atk:    profile.atk   + (statPoints.atk  || 0),
      def:    profile.def   + (statPoints.def  || 0),
      matk:   profile.matk  + (statPoints.matk || 0),
      mdef:   profile.mdef  + (statPoints.mdef || 0),
      spd:    profile.spd   + (statPoints.spd  || 0),
      pending_stat_points: 0,
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchProfile()
    setPendingPoints(0)
    setStatPoints({})
    setShowStatPanel(false)
  }

  const backToTown = () => { setScene('town'); setBattleLogs([]) }
  const logout = async () => { await supabase.auth.signOut(); nav('/login') }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const hpCurrent = Math.max(0, profile.hp_current ?? profile.hp_max)
  const mpCurrent = Math.max(0, profile.mp_current ?? profile.mp_max)
  const isDying = hpCurrent <= 0
  const hpPct = Math.min(100, (hpCurrent / profile.hp_max) * 100)
  const mpPct = Math.min(100, (mpCurrent / profile.mp_max) * 100)
  const expPct = Math.min(100, (profile.exp / profile.exp_next) * 100)
  const timerPct = ((WAIT_SECONDS - remaining) / WAIT_SECONDS) * 100
  const regenPct = ((REGEN_SECONDS - regenRemaining) / REGEN_SECONDS) * 100
  const unlockedAreas = profile.unlocked_areas || [1]
  const availableAreas = AREAS.filter(a => unlockedAreas.includes(a.id))
  const isDyingCost = profile.lv * 30
  const normalCost = profile.lv * 3
  const innCost = isDying ? isDyingCost : normalCost
  const allocatedPoints = Object.values(statPoints).reduce((a, b) => a + b, 0)
  const total = calcTotal(profile)

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'900px', margin:'0 auto' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={() => nav('/ranking')}
              style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
              🏆 ランキング
            </button>
            <button onClick={logout}
              style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
              ログアウト
            </button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>

          {/* ステータス */}
          <div style={{ border:`1px solid ${isDying ? '#660000' : '#0044aa'}`, background:'#001040', padding:'10px', alignSelf:'start' }}>
            {isDying && (
              <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #660000', padding:'4px', background:'#1a0000' }}>
                ⚠ 瀕死状態
              </div>
            )}
            <div style={{ color:'#ffcc00', fontSize:'12px', borderBottom:'1px dashed #003366', paddingBottom:'4px', marginBottom:'8px' }}>
              {profile.username}
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>クラス: <span style={{color:'#88ccff'}}>{profile.class}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'6px' }}>
              総合力: <span style={{color:'#44ff88', fontWeight:'bold'}}>{total}</span>
            </div>

            <StatBar label="HP" val={`${hpCurrent}/${profile.hp_max}`} pct={hpPct} color={isDying ? '#ff2200' : '#00cc44'} />
            <StatBar label="MP" val={`${mpCurrent}/${profile.mp_max}`} pct={mpPct} color="#4488ff" />

            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
              <span>経験値</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
            </div>
            <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'4px' }}>
              <div style={{ height:'100%', width:`${expPct}%`, background:'linear-gradient(90deg,#331100,#cc8800)', transition:'width 0.4s' }} />
            </div>

            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
              <span>自然回復まで</span>
              <span style={{color:'#44ccff'}}>{regenRemaining > 0 ? `${Math.ceil(regenRemaining)}秒` : '回復中...'}</span>
            </div>
            <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${regenPct}%`, background:'linear-gradient(90deg,#003333,#44ccff)', transition:'width 0.2s' }} />
            </div>

            <div style={{ fontSize:'11px', display:'grid', gridTemplateColumns:'1fr', gap:'2px', color:'#446688', marginBottom:'8px' }}>
              <span>攻撃力: <span style={{color:'#ffcc00'}}>{profile.atk}</span></span>
              <span>防御力: <span style={{color:'#88aaff'}}>{profile.def}</span></span>
              <span>特殊攻撃力: <span style={{color:'#cc44ff'}}>{profile.matk}</span></span>
              <span>特殊防御力: <span style={{color:'#44ccff'}}>{profile.mdef}</span></span>
              <span>素早さ: <span style={{color:'#ff8844'}}>{profile.spd}</span></span>
              <span>ゴールド: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
            </div>

            {pendingPoints > 0 && (
              <button onClick={() => {
                setShowStatPanel(true)
                setStatPoints({ hp:0, mp:0, atk:0, def:0, matk:0, mdef:0, spd:0 })
              }}
                style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                ★ ステータスを振り分ける（{pendingPoints}pt）
              </button>
            )}
          </div>

          {/* 右カラム */}
          <div>
            {showStatPanel && (
              <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#cc44ff', fontSize:'13px', marginBottom:'6px' }}>
                  ステータスポイント振り分け（残り {pendingPoints - allocatedPoints}pt）
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'10px' }}>
                  {Object.entries(STAT_LABELS).map(([stat, label]) => (
                    <div key={stat} style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      border:`1px solid ${(statPoints[stat]||0) > 0 ? '#cc44ff' : '#003366'}`,
                      background: (statPoints[stat]||0) > 0 ? '#1a0030' : '#000818',
                      padding:'6px 8px',
                    }}>
                      <span style={{ color:'#88ccff', fontSize:'10px' }}>{label}</span>
                      <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                        <button onClick={() => {
                          if ((statPoints[stat]||0) > 0) setStatPoints(p => ({ ...p, [stat]: p[stat] - 1 }))
                        }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                        <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                        <button onClick={() => {
                          if (allocatedPoints < pendingPoints) setStatPoints(p => ({ ...p, [stat]: (p[stat]||0) + 1 }))
                        }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={() => setShowStatPanel(false)}
                    style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                    後で振り分ける
                  </button>
                  <button onClick={confirmStatPoints}
                    disabled={allocatedPoints !== pendingPoints}
                    style={{ flex:2, padding:'8px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity: allocatedPoints !== pendingPoints ? 0.4 : 1 }}>
                    決定する
                  </button>
                </div>
              </div>
            )}

            {scene === 'town' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>

                {isDying && (
                  <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'10px', border:'1px solid #660000', padding:'8px', background:'#1a0000' }}>
                    ⚠ 瀕死状態です。宿屋で回復してから出撃してください。
                  </div>
                )}

                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
                  <span style={{ color:'#446688' }}>次の行動まで</span>
                  <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>
                    {canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}
                  </span>
                </div>
                <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'12px' }}>
                  <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
                </div>

                <div style={{ marginBottom:'10px' }}>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>エリア選択</div>
                  <select value={selectedArea} onChange={e => setSelectedArea(Number(e.target.value))}
                    style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'6px', fontFamily:'monospace', fontSize:'12px' }}>
                    {availableAreas.map(area => (
                      <option key={area.id} value={area.id}>{area.name}</option>
                    ))}
                  </select>
                </div>

                <button onClick={doBattle} disabled={!canAct || loading || isDying}
                  style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct && !isDying ? '#ffcc00' : '#003366'}`, color: canAct && !isDying ? '#ffcc00' : '#446688', cursor: canAct && !isDying ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
                  {isDying ? '💀 瀕死中（出撃不可）' : canAct ? `⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！` : '⏳ 待機中...'}
                </button>

                <button onClick={() => { setScene('inn'); setInnMessage('') }}
                  style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                  🏨 宿屋へ
                </button>
              </div>
            )}

            {scene === 'inn' && (
              <div style={{ border:'1px solid #0088aa', background:'#001030', padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#00aacc', fontSize:'14px', marginBottom:'16px' }}>🏨 宿屋</div>
                {innMessage ? (
                  <div style={{ color:'#44ff88', fontSize:'14px', padding:'20px' }}>{innMessage}</div>
                ) : (
                  <>
                    <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'2', marginBottom:'16px' }}>
                      {isDying ? (
                        <>
                          これはひどいお姿で…。<br/>
                          特別なお手当が必要でございます。<br/>
                          <span style={{color:'#ffcc00'}}>{innCost} ゴールド</span> になりますが、よろしいですか？
                        </>
                      ) : (
                        <>
                          一泊 <span style={{color:'#ffcc00'}}>{innCost} ゴールド</span> でございます。<br/>
                          ゆっくりお休みになりますか？
                        </>
                      )}
                    </div>
                    <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
                      所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
                      {profile.gold < innCost && <span style={{color:'#ff4444'}}> （ゴールドが足りません）</span>}
                    </div>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={backToTown}
                        style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        街に戻る
                      </button>
                      <button onClick={useInn} disabled={profile.gold < innCost}
                        style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor: profile.gold < innCost ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'12px', opacity: profile.gold < innCost ? 0.4 : 1 }}>
                        利用する
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {scene === 'battle' && (
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