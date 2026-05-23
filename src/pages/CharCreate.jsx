import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const CLASSES = [
  { id:'戦士',    icon:'⚔️',  hp:120, mp:20,  atk:15, def:10, matk:5,  mdef:8,  spd:8,  desc:'高HP・高防御の前衛', weaponName:'木の剣' },
  { id:'弓使い',  icon:'🏹',  hp:90,  mp:40,  atk:12, def:6,  matk:8,  mdef:6,  spd:15, desc:'素早さ特化のバランス型', weaponName:'短弓' },
  { id:'魔法使い',icon:'🔮',  hp:60,  mp:100, atk:5,  def:3,  matk:20, mdef:10, spd:10, desc:'高魔力・強力な魔法攻撃', weaponName:'木の杖' },
  { id:'僧侶',    icon:'✨',  hp:80,  mp:80,  atk:6,  def:6,  matk:15, mdef:15, spd:9,  desc:'回復・魔法防御が高い', weaponName:'聖なる杖' },
]

export default function CharCreate() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [selectedClass, setSelectedClass] = useState('戦士')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handle = async (e) => {
    e.preventDefault()
    if (!username.trim()) { setError('名前を入力してください'); return }
    setLoading(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('ログインが必要です')

      const { data: existing } = await supabase
        .from('profiles').select('id').eq('id', user.id).single()
      if (existing) { nav('/game'); return }

      const c = CLASSES.find(c => c.id === selectedClass)

      // キャラ作成
      const { error: pErr } = await supabase.from('profiles').insert({
        id: user.id,
        username: username.trim(),
        class: selectedClass,
        hp: c.hp, hp_max: c.hp,
        mp: c.mp, mp_max: c.mp,
        hp_current: c.hp,
        mp_current: c.mp,
        atk: c.atk, def: c.def,
        matk: c.matk, mdef: c.mdef, spd: c.spd,
      })
      if (pErr) throw pErr

      // 初期武器を取得
      const { data: weapon } = await supabase
        .from('weapons')
        .select('id')
        .eq('name', c.weaponName)
        .single()

      if (weapon) {
        // 所持装備に追加
        await supabase.from('player_equipment').insert({
          player_id: user.id,
          weapon_id: weapon.id,
          slot: 'weapon',
          equipped: true,
        })
        // 熟練度テーブルに追加
        await supabase.from('proficiency').insert({
          player_id: user.id,
          weapon_id: weapon.id,
        })
      }

      nav('/game')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const selectedJob = CLASSES.find(c => c.id === selectedClass)

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#000820' }}>
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'30px', width:'460px' }}>
        <div style={{ color:'#ffcc00', textAlign:'center', fontSize:'18px', marginBottom:'20px', letterSpacing:'3px' }}>
          キャラクター作成
        </div>

        <form onSubmit={handle} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              maxLength={16} placeholder="名前（最大16文字）"
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace' }}
              required
            />
          </div>

          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>クラスを選ぶ</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
              {CLASSES.map(c => (
                <div key={c.id} onClick={() => setSelectedClass(c.id)}
                  style={{
                    padding:'10px', textAlign:'center', cursor:'pointer',
                    border: `1px solid ${selectedClass === c.id ? '#ffcc00' : '#003366'}`,
                    background: selectedClass === c.id ? '#1a1000' : '#000818',
                  }}>
                  <div style={{ fontSize:'24px' }}>{c.icon}</div>
                  <div style={{ color: selectedClass === c.id ? '#ffcc00' : '#446688', fontSize:'12px', marginTop:'4px' }}>{c.id}</div>
                </div>
              ))}
            </div>
          </div>

          {selectedJob && (
            <div style={{ background:'#000818', border:'1px solid #002244', padding:'10px', fontSize:'11px' }}>
              <div style={{ color:'#88ccff', marginBottom:'6px' }}>{selectedJob.desc}</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'4px', color:'#446688' }}>
                <span>HP: <span style={{color:'#44ff88'}}>{selectedJob.hp}</span></span>
                <span>MP: <span style={{color:'#4488ff'}}>{selectedJob.mp}</span></span>
                <span>攻撃力: <span style={{color:'#ffcc00'}}>{selectedJob.atk}</span></span>
                <span>防御力: <span style={{color:'#88aaff'}}>{selectedJob.def}</span></span>
                <span>特殊攻撃: <span style={{color:'#cc44ff'}}>{selectedJob.matk}</span></span>
                <span>特殊防御: <span style={{color:'#44ccff'}}>{selectedJob.mdef}</span></span>
                <span>素早さ: <span style={{color:'#ff8844'}}>{selectedJob.spd}</span></span>
              </div>
              <div style={{ color:'#446688', fontSize:'10px', marginTop:'6px' }}>
                初期装備: <span style={{color:'#88ccff'}}>{selectedJob.weaponName}</span>
              </div>
            </div>
          )}

          {error && <div style={{ color:'#ff4444', fontSize:'11px' }}>⚠ {error}</div>}

          <button type="submit" disabled={loading}
            style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
            {loading ? '作成中...' : '▶ 冒険を始める'}
          </button>
        </form>
      </div>
    </div>
  )
}