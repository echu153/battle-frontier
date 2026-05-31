import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const CLASSES = [
  { id:'戦士',    icon:'⚔️', hp_max:80,  mp_max:10, atk:10, def:8,  matk:1,  mdef:3,  spd:5,  desc:'高HP・高防御の前衛',     weaponName:'木の剣' },
  { id:'弓使い',  icon:'🏹', hp_max:60,  mp_max:15, atk:8,  def:4,  matk:2,  mdef:3,  spd:10, desc:'素早さ特化のバランス型', weaponName:'短弓' },
  { id:'魔法使い',icon:'🔮', hp_max:45,  mp_max:50, atk:2,  def:2,  matk:14, mdef:4,  spd:4,  desc:'高魔力・強力な魔法攻撃', weaponName:'木の杖' },
  { id:'僧侶',    icon:'✨', hp_max:55,  mp_max:45, atk:2,  def:3,  matk:7,  mdef:12, spd:3,  desc:'回復・魔法防御が高い',   weaponName:'聖なる杖' },
  { id:'格闘家',  icon:'👊', hp_max:70,  mp_max:10, atk:11, def:5,  matk:1,  mdef:3,  spd:8,  desc:'素手で戦う打撃特化の格闘家', weaponName:'木の剣' },
]

const ALL_INITIAL_CLASSES = ['戦士','弓使い','魔法使い','僧侶','格闘家']

// Supabaseプロジェクト設定（supabase.jsから取得）
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const PRESET_AVATARS = [
  { id:'warrior1',  label:'戦士①',    url:`${SUPABASE_URL}/storage/v1/object/public/avatars/warrior1.png` },
  { id:'knight1',   label:'騎士',      url:`${SUPABASE_URL}/storage/v1/object/public/avatars/knight1.png` },
  { id:'samurai',   label:'侍',        url:`${SUPABASE_URL}/storage/v1/object/public/avatars/samurai.png` },
  { id:'hunter1',   label:'狩人①',    url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter1.png` },
  { id:'hunter2',   label:'狩人②',    url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter2.png` },
  { id:'wizard1',   label:'魔法使い①', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard1.png` },
  { id:'wizard2',   label:'魔法使い②', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard2.png` },
  { id:'priest',    label:'僧侶',      url:`${SUPABASE_URL}/storage/v1/object/public/avatars/priest.png` },
]

export default function CharCreate() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [selectedClass, setSelectedClass] = useState('戦士')
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handle = async (e) => {
    e.preventDefault()
    if (!username.trim()) { setError('名前を入力してください'); return }
    setLoading(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('ログインが必要です')
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).single()
      if (existing) { nav('/game'); return }
      const c = CLASSES.find(c => c.id === selectedClass)
      const { error: pErr } = await supabase.from('profiles').insert({
        id: user.id,
        username: username.trim(),
        class: selectedClass,
        hp_max: c.hp_max, mp_max: c.mp_max,
        hp_current: c.hp_max, mp_current: c.mp_max,
        atk: c.atk, def: c.def, matk: c.matk, mdef: c.mdef, spd: c.spd,
        avatar_url: selectedAvatar,
      })
      if (pErr) throw pErr
      const classLevelData = ALL_INITIAL_CLASSES.map(cls => ({
        player_id: user.id, class_name: cls, lv: 1, exp: 0,
      }))
      await supabase.from('class_levels').insert(classLevelData)
      const { data: weapon } = await supabase.from('weapons').select('id').eq('name', c.weaponName).single()
      if (weapon) {
        const { data: eqRow } = await supabase.from('player_equipment').insert({
          player_id: user.id, weapon_id: weapon.id, slot: 'weapon', equipped: true,
        }).select('id').single()
        await supabase.from('proficiency').insert({
          player_id: user.id, weapon_id: weapon.id, equipment_id: eqRow?.id, prof_exp: 0, prof_lv: 1, awakening: 0,
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
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#000820', padding:'20px' }}>
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'30px', width:'500px', fontFamily:'monospace' }}>
        <div style={{ color:'#ffcc00', textAlign:'center', fontSize:'18px', marginBottom:'20px', letterSpacing:'3px' }}>
          キャラクター作成
        </div>

        <form onSubmit={handle} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
          {/* 名前 */}
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              maxLength={16} placeholder="名前（最大16文字）"
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', boxSizing:'border-box' }}
              required />
          </div>

          {/* クラス選択 */}
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>クラスを選ぶ</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
              {CLASSES.map(c => (
                <div key={c.id} onClick={() => setSelectedClass(c.id)}
                  style={{ padding:'10px', textAlign:'center', cursor:'pointer',
                    border: `1px solid ${selectedClass === c.id ? '#ffcc00' : '#003366'}`,
                    background: selectedClass === c.id ? '#1a1000' : '#000818' }}>
                  <div style={{ fontSize:'24px' }}>{c.icon}</div>
                  <div style={{ color: selectedClass === c.id ? '#ffcc00' : '#446688', fontSize:'12px', marginTop:'4px' }}>{c.id}</div>
                </div>
              ))}
            </div>
          </div>

          {/* クラス詳細 */}
          {selectedJob && (
            <div style={{ background:'#000818', border:'1px solid #002244', padding:'10px', fontSize:'11px' }}>
              <div style={{ color:'#88ccff', marginBottom:'6px' }}>{selectedJob.desc}</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'4px', color:'#446688' }}>
                <span>HP: <span style={{color:'#44ff88'}}>{selectedJob.hp_max}</span></span>
                <span>MP: <span style={{color:'#4488ff'}}>{selectedJob.mp_max}</span></span>
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

          {/* アバター選択 */}
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>アイコンを選ぶ</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px' }}>
              {PRESET_AVATARS.map(a => (
                <div key={a.id} onClick={() => setSelectedAvatar(a.url)}
                  style={{ cursor:'pointer', border:`2px solid ${selectedAvatar === a.url ? '#ffcc00' : '#003366'}`,
                    background: selectedAvatar === a.url ? '#1a1000' : '#000818', padding:'4px', textAlign:'center' }}>
                  <img src={a.url} alt={a.label}
                    style={{ width:'100%', aspectRatio:'1', objectFit:'cover', display:'block' }}
                    onError={e => { e.target.style.display='none' }} />
                  <div style={{ color: selectedAvatar === a.url ? '#ffcc00' : '#446688', fontSize:'9px', marginTop:'2px' }}>{a.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 選択中アイコンプレビュー */}
          {selectedAvatar && (
            <div style={{ textAlign:'center' }}>
              <img src={selectedAvatar} alt="選択中"
                style={{ width:'80px', height:'80px', objectFit:'cover', border:'2px solid #ffcc00' }} />
              <div style={{ color:'#446688', fontSize:'10px', marginTop:'4px' }}>選択中のアイコン</div>
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