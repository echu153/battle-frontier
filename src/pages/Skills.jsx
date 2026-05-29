import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const TYPE_COLORS = {
  '物理攻撃': '#ffcc00',
  '魔法攻撃': '#cc44ff',
  '回復':     '#44ff88',
  '強化':     '#44ccff',
  'パッシブ': '#ff8844',
}

export default function Skills() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [allSkills, setAllSkills] = useState([])
  const [playerSkills, setPlayerSkills] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('current')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)

    // 現在のクラスのスキル（パッシブ含む全て）
    const { data: skills } = await supabase
      .from('skills').select('*')
      .eq('class_name', p.class)
      .order('required_lv')
    setAllSkills(skills || [])

    // 全習得済みスキル
    const { data: ps } = await supabase
      .from('player_skills').select('*, skills(*)')
      .eq('player_id', user.id)
    setPlayerSkills(ps || [])

    const { data: ss } = await supabase
      .from('skill_sets').select('*, skills(*)')
      .eq('player_id', user.id)
      .order('slot_order')
    setSkillSets(ss || [])

    // 現在のクラスのスキルで未習得のものを自動習得
    const learnedIds = (ps||[]).map(s => s.skill_id)
    const toLearn = (skills||[]).filter(s => s.required_lv <= p.lv && !learnedIds.includes(s.id))
    for (const skill of toLearn) {
      await supabase.from('player_skills').insert({ player_id: user.id, skill_id: skill.id })
    }
    if (toLearn.length > 0) {
      const { data: ps2 } = await supabase.from('player_skills').select('*, skills(*)').eq('player_id', user.id)
      setPlayerSkills(ps2 || [])
    }
  }

  const setSkillToSlot = async (skillId, slotOrder) => {
    setLoading(true)
    await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('skill_id', skillId)
    const existing = skillSets.find(ss => ss.slot_order === slotOrder)
    if (existing) {
      await supabase.from('skill_sets').update({ skill_id: skillId, use_count: 1 }).eq('player_id', profile.id).eq('slot_order', slotOrder)
    } else {
      await supabase.from('skill_sets').insert({ player_id: profile.id, skill_id: skillId, slot_order: slotOrder, use_count: 1 })
    }
    await fetchAll()
    setLoading(false)
  }

  const updateUseCount = async (slotOrder, useCount) => {
    setLoading(true)
    await supabase.from('skill_sets').update({ use_count: useCount }).eq('player_id', profile.id).eq('slot_order', slotOrder)
    await fetchAll()
    setLoading(false)
  }

  const removeFromSlot = async (slotOrder) => {
    setLoading(true)
    await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('slot_order', slotOrder)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const learnedIds = playerSkills.map(ps => ps.skill_id)

  // クラス別にグループ化
  const skillsByClass = {}
  for (const ps of playerSkills) {
    if (!ps.skills) continue
    const cls = ps.skills.class_name
    if (!skillsByClass[cls]) skillsByClass[cls] = []
    skillsByClass[cls].push(ps.skills)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'4px' }}>⚡ スキル</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          クラス: <span style={{color:'#88ccff'}}>{profile.class}</span>　LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span>
        </div>

        {/* スキルセット */}
        <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'4px' }}>スキルセット（最大5個・上から順に発動）</div>
          <div style={{ color:'#336688', fontSize:'10px', marginBottom:'8px' }}>パッシブスキルをセットすると常時発動する</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'4px' }}>
            {[1,2,3,4,5].map(slot => {
              const set = skillSets.find(ss => ss.slot_order === slot)
              return (
                <div key={slot} style={{ display:'flex', alignItems:'center', gap:'8px', border:'1px solid #002244', background:'#000818', padding:'8px' }}>
                  <span style={{ color:'#446688', fontSize:'11px', minWidth:'20px' }}>{slot}.</span>
                  {set ? (
                    <>
                      <span style={{ color: TYPE_COLORS[set.skills.type] || '#88ccff', fontSize:'11px', flex:1 }}>{set.skills.name}</span>
                      <span style={{ color:'#446688', fontSize:'10px' }}>{set.skills.class_name}</span>
                      {set.skills.type !== 'パッシブ' ? (
                        <>
                          <span style={{ color:'#446688', fontSize:'10px' }}>MP{set.skills.mp_cost}</span>
                          <select value={set.use_count || 1} onChange={e => updateUseCount(slot, Number(e.target.value))}
                            style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}回</option>)}
                          </select>
                        </>
                      ) : (
                        <span style={{ color:'#ff8844', fontSize:'10px' }}>常時発動</span>
                      )}
                      <button onClick={() => removeFromSlot(slot)} disabled={loading}
                        style={{ padding:'2px 6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                    </>
                  ) : (
                    <span style={{ color:'#334455', fontSize:'11px' }}>未設定</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* タブ切り替え */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
          <button onClick={()=>setActiveTab('current')}
            style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:activeTab==='current'?'#001840':'#000818', border:`1px solid ${activeTab==='current'?'#ffcc00':'#003366'}`, color:activeTab==='current'?'#ffcc00':'#446688' }}>
            現在のクラス
          </button>
          <button onClick={()=>setActiveTab('all')}
            style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:activeTab==='all'?'#001840':'#000818', border:`1px solid ${activeTab==='all'?'#ffcc00':'#003366'}`, color:activeTab==='all'?'#ffcc00':'#446688' }}>
            全習得済みスキル
          </button>
        </div>

        {/* 現在のクラスのスキル（パッシブ含む） */}
        {activeTab === 'current' && (
          <div>
            {allSkills.map(skill => {
              const learned = learnedIds.includes(skill.id)
              const inSet = skillSets.find(ss => ss.skill_id === skill.id)
              return (
                <SkillCard key={skill.id} skill={skill} learned={learned} inSet={inSet} skillSets={skillSets} loading={loading} onSet={setSkillToSlot} canSet={true} />
              )
            })}
          </div>
        )}

        {/* 全習得済みスキル（クラス別） */}
        {activeTab === 'all' && (
          <div>
            {Object.entries(skillsByClass).map(([className, skills]) => (
              <div key={className} style={{ marginBottom:'16px' }}>
                <div style={{ color:'#88ccff', fontSize:'12px', borderBottom:'1px solid #003366', paddingBottom:'4px', marginBottom:'8px' }}>
                  {className}
                  {className !== profile.class && <span style={{ color:'#446688', fontSize:'10px', marginLeft:'8px' }}>（現在のクラスでは使用不可）</span>}
                </div>
                {skills.map(skill => {
                  const inSet = skillSets.find(ss => ss.skill_id === skill.id)
                  return (
                    <SkillCard key={skill.id} skill={skill} learned={true} inSet={inSet} skillSets={skillSets} loading={loading} onSet={setSkillToSlot} canSet={className === profile.class} />
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SkillCard({ skill, learned, inSet, skillSets, loading, onSet, canSet }) {
  return (
    <div style={{ border:`1px solid ${learned ? '#0044aa' : '#002244'}`, background: learned ? '#001028' : '#000818', padding:'10px', marginBottom:'6px', opacity: learned ? 1 : 0.5 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <span style={{ fontSize:'9px', padding:'1px 4px', color: TYPE_COLORS[skill.type], border:`1px solid ${TYPE_COLORS[skill.type]}` }}>{skill.type}</span>
          <span style={{ color: learned ? '#88ccff' : '#446688', fontSize:'12px' }}>{skill.name}</span>
        </div>
        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
          {skill.type !== 'パッシブ' && <span style={{ color:'#446688', fontSize:'10px' }}>MP{skill.mp_cost}</span>}
          {learned && !inSet && canSet && (
            <select onChange={e => { if (e.target.value) onSet(skill.id, Number(e.target.value)) }} defaultValue=""
              style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
              <option value="">セットする</option>
              {[1,2,3,4,5].map(slot => <option key={slot} value={slot}>スロット{slot}</option>)}
            </select>
          )}
          {inSet && <span style={{ color: skill.type === 'パッシブ' ? '#ff8844' : '#0088ff', fontSize:'10px' }}>
            {skill.type === 'パッシブ' ? `スロット${inSet.slot_order}（常時発動）` : `スロット${inSet.slot_order}（${inSet.use_count || 1}回）`}
          </span>}
          {!learned && <span style={{ color:'#446688', fontSize:'10px' }}>LV{skill.required_lv}で習得</span>}
        </div>
      </div>
      <div style={{ color:'#446688', fontSize:'10px' }}>{skill.description}</div>
    </div>
  )
}
