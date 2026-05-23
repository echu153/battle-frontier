import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品' }
const RARITY_COLORS = { common:'#88ccff', rare:'#44ff88', epic:'#cc44ff', legendary:'#ffcc00' }
const RARITY_LABELS = { common:'並', rare:'珍', epic:'秘', legendary:'伝' }

const calcProfBonus = (prof) => {
  if (!prof) return {}
  const awakening = prof.awakening || 0
  const lv = prof.prof_lv + awakening * 20
  const bonus = Math.floor(lv / 10)
  const weapon = prof.weapon
  if (!weapon) return {}
  if (weapon.weapon_type === 'staff') return { matk: bonus }
  if (weapon.weapon_type === 'bow') return { atk: bonus, spd: bonus }
  return { atk: bonus }
}

export default function Equipment() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [tab, setTab] = useState('weapon')
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }

    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)

    const { data: eq } = await supabase
      .from('player_equipment')
      .select('*, weapons(*)')
      .eq('player_id', user.id)
      .order('obtained_at')
    setEquipment(eq || [])

    const { data: prof } = await supabase
      .from('proficiency')
      .select('*, weapons(*)')
      .eq('player_id', user.id)
    setProficiency(prof || [])
  }

  const equip = async (item) => {
    setLoading(true)
    // 同スロットの装備を外す
    await supabase.from('player_equipment')
      .update({ equipped: false })
      .eq('player_id', profile.id)
      .eq('slot', item.slot)
      .eq('equipped', true)

    // 新しい装備をセット
    await supabase.from('player_equipment')
      .update({ equipped: true })
      .eq('id', item.id)

    await fetchAll()
    setLoading(false)
  }

  const unequip = async (item) => {
    setLoading(true)
    await supabase.from('player_equipment')
      .update({ equipped: false })
      .eq('id', item.id)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const slots = ['weapon', 'armor', 'accessory']
  const filteredEquipment = equipment.filter(e => e.slot === tab)

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>

        {/* ヘッダー */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 街に戻る
          </button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:'12px' }}>

          {/* 装備中スロット */}
          <div>
            <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>装備中</div>
            {slots.map(slot => {
              const equipped = equipment.find(e => e.slot === slot && e.equipped)
              return (
                <div key={slot} style={{ border:'1px solid #003366', background:'#001028', padding:'8px', marginBottom:'6px' }}>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>{SLOT_LABELS[slot]}</div>
                  {equipped ? (
                    <>
                      <div style={{ color: RARITY_COLORS[equipped.weapons.rarity], fontSize:'11px' }}>
                        {equipped.weapons.name}
                      </div>
                      <div style={{ color:'#334455', fontSize:'10px', marginTop:'2px' }}>
                        {equipped.weapons.atk_bonus > 0 && `ATK+${equipped.weapons.atk_bonus} `}
                        {equipped.weapons.matk_bonus > 0 && `MATK+${equipped.weapons.matk_bonus} `}
                        {equipped.weapons.def_bonus > 0 && `DEF+${equipped.weapons.def_bonus} `}
                        {equipped.weapons.mdef_bonus > 0 && `MDEF+${equipped.weapons.mdef_bonus} `}
                        {equipped.weapons.spd_bonus > 0 && `SPD+${equipped.weapons.spd_bonus} `}
                      </div>
                    </>
                  ) : (
                    <div style={{ color:'#334455', fontSize:'11px' }}>なし</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 所持装備 */}
          <div>
            {/* タブ */}
            <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
              {slots.map(slot => (
                <button key={slot} onClick={() => setTab(slot)}
                  style={{ padding:'4px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: tab === slot ? '#001840' : '#000818',
                    border: `1px solid ${tab === slot ? '#ffcc00' : '#003366'}`,
                    color: tab === slot ? '#ffcc00' : '#446688' }}>
                  {SLOT_LABELS[slot]}
                </button>
              ))}
            </div>

            {filteredEquipment.length === 0 && (
              <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>
            )}

            {filteredEquipment.map(item => {
              const w = item.weapons
              const prof = proficiency.find(p => p.weapon_id === w.id)
              const profBonus = calcProfBonus(prof ? { ...prof, weapon: w } : null)
              const profPct = prof ? Math.min(100, (prof.prof_exp / 100) * 100) : 0

              return (
                <div key={item.id} style={{
                  border: `1px solid ${item.equipped ? '#0044aa' : '#002244'}`,
                  background: item.equipped ? '#001028' : '#000818',
                  padding:'10px', marginBottom:'6px',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                    <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                      <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>
                        {RARITY_LABELS[w.rarity]}
                      </span>
                      <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{w.name}</span>
                    </div>
                    {item.equipped
                      ? <span style={{ color:'#0088ff', fontSize:'10px' }}>装備中</span>
                      : <button onClick={() => equip(item)} disabled={loading}
                          style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                          装備する
                        </button>
                    }
                  </div>

                  <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                    {w.atk_bonus > 0 && <span style={{color:'#ffcc00'}}>ATK+{w.atk_bonus} </span>}
                    {w.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>MATK+{w.matk_bonus} </span>}
                    {w.def_bonus > 0 && <span style={{color:'#88aaff'}}>DEF+{w.def_bonus} </span>}
                    {w.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>MDEF+{w.mdef_bonus} </span>}
                    {w.spd_bonus > 0 && <span style={{color:'#ff8844'}}>SPD+{w.spd_bonus} </span>}
                    {w.hp_bonus > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus} </span>}
                    {w.mp_bonus > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus} </span>}
                  </div>

                  {/* 熟練度（武器のみ） */}
                  {tab === 'weapon' && prof && (
                    <div>
                      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
                        <span>熟練度 LV{prof.prof_lv}{prof.awakening > 0 && <span style={{color:'#ffcc00'}}> +{prof.awakening}</span>}</span>
                        <span>{prof.prof_exp}/100</span>
                      </div>
                      <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'2px' }}>
                        <div style={{ height:'100%', width:`${profPct}%`, background:'linear-gradient(90deg,#220044,#aa44ff)' }} />
                      </div>
                      {Object.keys(profBonus).length > 0 && (
                        <div style={{ fontSize:'10px', color:'#aa44ff' }}>
                          熟練度ボーナス: {Object.entries(profBonus).map(([k,v]) => `${k.toUpperCase()}+${v}`).join(' ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}