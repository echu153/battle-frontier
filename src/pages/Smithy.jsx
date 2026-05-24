import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品' }
const RARITY_COLORS = { common:'#88ccff', rare:'#44ff88', epic:'#cc44ff', legendary:'#ffcc00' }
const RARITY_LABELS = { common:'並', rare:'珍', epic:'秘', legendary:'伝' }

export default function Smithy() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [tab, setTab] = useState('sell')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const { data: eq } = await supabase
      .from('player_equipment').select('*, weapons(*)')
      .eq('player_id', user.id).order('obtained_at')
    setEquipment(eq || [])
  }

  const sellItem = async (item) => {
    if (item.equipped) return
    setLoading(true)
    const sellPrice = item.weapons.sell_price || 0
    await supabase.from('player_equipment').delete().eq('id', item.id)
    await supabase.from('profiles').update({ gold: profile.gold + sellPrice }).eq('id', profile.id)
    setMessage(`${item.weapons.name}を${sellPrice}Gで売却しました！`)
    setTimeout(() => setMessage(''), 2000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const slots = ['weapon', 'armor', 'accessory']

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 街に戻る
          </button>
        </div>

        <div style={{ color:'#aa6644', fontSize:'14px', marginBottom:'4px' }}>⚒ 鍛冶屋</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
        </div>

        {message && (
          <div style={{ color:'#44ff88', fontSize:'12px', padding:'8px', border:'1px solid #44ff88', marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        {/* タブ */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'12px' }}>
          {[{id:'sell', label:'売却'}, {id:'enhance', label:'強化（準備中）'}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab === t.id ? '#001840' : '#000818',
                border: `1px solid ${tab === t.id ? '#aa6644' : '#003366'}`,
                color: tab === t.id ? '#aa6644' : '#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'sell' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>装備中のアイテムは売却できません</div>
            {slots.map(slot => {
              const slotItems = equipment.filter(e => e.slot === slot)
              if (slotItems.length === 0) return null
              return (
                <div key={slot} style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#aa6644', fontSize:'11px', marginBottom:'6px' }}>── {SLOT_LABELS[slot]} ──</div>
                  {slotItems.map(item => {
                    const w = item.weapons
                    const sellPrice = w.sell_price || 0
                    return (
                      <div key={item.id} style={{
                        border: `1px solid ${item.equipped ? '#003366' : '#002244'}`,
                        background: item.equipped ? '#001040' : '#001028',
                        padding:'10px', marginBottom:'6px',
                        opacity: item.equipped ? 0.5 : 1,
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>
                              {RARITY_LABELS[w.rarity]}
                            </span>
                            <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{w.name}</span>
                            {item.equipped && <span style={{ color:'#446688', fontSize:'10px' }}>（装備中）</span>}
                          </div>
                          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                            <span style={{ color:'#ffcc00', fontSize:'11px' }}>{sellPrice}G</span>
                            <button onClick={() => sellItem(item)} disabled={item.equipped || loading}
                              style={{ padding:'3px 8px', background: item.equipped ? '#001' : '#1a0800', border:`1px solid ${item.equipped ? '#002244' : '#aa6644'}`, color: item.equipped ? '#334455' : '#aa6644', cursor: item.equipped ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                              売却
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize:'10px', color:'#446688' }}>
                          {w.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{w.atk_bonus} </span>}
                          {w.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{w.def_bonus} </span>}
                          {w.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{w.matk_bonus} </span>}
                          {w.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{w.mdef_bonus} </span>}
                          {w.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{w.spd_bonus} </span>}
                          {w.spd_bonus  < 0 && <span style={{color:'#ff4444'}}>素早さ{w.spd_bonus} </span>}
                          {w.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus} </span>}
                          {w.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus} </span>}
                          {w.hp_bonus_pct > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus_pct}% </span>}
                          {w.mp_bonus_pct > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus_pct}% </span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'enhance' && (
          <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>
            強化システムは準備中です
          </div>
        )}
      </div>
    </div>
  )
}