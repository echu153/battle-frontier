import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品' }
const RARITY_COLORS = { common:'#44ff88', rare:'#4488ff', epic:'#cc44ff', legendary:'#ffcc00' }
const RARITY_LABELS = { common:'Common', rare:'Rare', epic:'Epic', legendary:'Legendary' }

// 強化コスト
const ENHANCE_COST = [0,100,200,400,800,1500,3000,5000,8000,12000,20000,35000,60000,100000,150000,200000,300000]
// 強化成功率（+6以降）
const ENHANCE_RATE = { 6:70, 7:60, 8:50, 9:40, 10:30, 11:20, 12:10, 13:5, 14:3, 15:1, 16:0.1 }
// 素材消費数
const MATERIAL_COUNT = (plus) => {
  if (plus <= 5) return 1
  if (plus <= 10) return 2
  if (plus <= 15) return 3
  return 4
}

export default function Smithy() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [tab, setTab] = useState('enhance')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [selectedItem, setSelectedItem] = useState(null)

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

  const showMessage = (msg, color = '#44ff88') => {
    setMessage(msg)
    setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const doEnhance = async (item) => {
    setLoading(true)
    const currentPlus = item.enhance_plus || 0
    const nextPlus = currentPlus + 1
    const cost = ENHANCE_COST[nextPlus] || ENHANCE_COST[ENHANCE_COST.length - 1]
    const materialCount = MATERIAL_COUNT(currentPlus)

    if (profile.gold < cost) {
      showMessage('ゴールドが足りません！', '#ff4444')
      setLoading(false)
      return
    }

    // 同名装備を素材として消費
    const sameItems = equipment.filter(e =>
      e.weapons.name === item.weapons.name &&
      e.id !== item.id &&
      !e.equipped
    )

    if (sameItems.length < materialCount) {
      showMessage(`素材が足りません！（${materialCount}個必要）`, '#ff4444')
      setLoading(false)
      return
    }

    // ゴールド消費
    await supabase.from('profiles').update({ gold: profile.gold - cost }).eq('id', profile.id)

    // 素材消費
    for (let i = 0; i < materialCount; i++) {
      await supabase.from('player_equipment').delete().eq('id', sameItems[i].id)
    }

    // 成功判定
    let success = true
    if (nextPlus >= 6) {
      const rate = ENHANCE_RATE[nextPlus] || ENHANCE_RATE[16]
      success = Math.random() * 100 < rate
    }

    if (success) {
      // 強化成功：+値を上げてステータス1.2倍
      await supabase.from('player_equipment').update({
        enhance_plus: nextPlus,
      }).eq('id', item.id)
      showMessage(`✨ 強化成功！ ${item.weapons.name} が +${nextPlus} になった！`, '#ffcc00')
    } else if (nextPlus >= 11) {
      // +11以降失敗：+値が1下落
      const newPlus = Math.max(0, currentPlus - 1)
      await supabase.from('player_equipment').update({
        enhance_plus: newPlus,
      }).eq('id', item.id)
      showMessage(`💔 強化失敗… ${item.weapons.name} が +${newPlus} に下落した…`, '#ff4444')
    } else {
      // +6〜+10失敗：変化なし
      showMessage(`💔 強化失敗… ${item.weapons.name} は変化しなかった`, '#ff6644')
    }

    await fetchAll()
    setSelectedItem(null)
    setLoading(false)
  }

  const sellItem = async (item) => {
    if (item.equipped) return
    setLoading(true)
    const sellPrice = item.weapons.sell_price || 0
    await supabase.from('player_equipment').delete().eq('id', item.id)
    await supabase.from('profiles').update({ gold: profile.gold + sellPrice }).eq('id', profile.id)
    showMessage(`${item.weapons.name}を${sellPrice}Gで売却しました！`)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const slots = ['weapon', 'armor', 'accessory']

  // 強化倍率計算
const getEnhancedStats = (weapon, plus) => {
  if (!plus || plus === 0) return weapon
  const mult = Math.pow(1.2, plus)
  return {
    atk_bonus:  Math.max(weapon.atk_bonus  > 0 ? 1 : 0, Math.ceil((weapon.atk_bonus  || 0) * mult)),
    def_bonus:  Math.max(weapon.def_bonus  > 0 ? 1 : 0, Math.ceil((weapon.def_bonus  || 0) * mult)),
    matk_bonus: Math.max(weapon.matk_bonus > 0 ? 1 : 0, Math.ceil((weapon.matk_bonus || 0) * mult)),
    mdef_bonus: Math.max(weapon.mdef_bonus > 0 ? 1 : 0, Math.ceil((weapon.mdef_bonus || 0) * mult)),
    spd_bonus:  Math.max(weapon.spd_bonus  > 0 ? 1 : 0, Math.ceil((weapon.spd_bonus  || 0) * mult)),
    hp_bonus:   Math.max(weapon.hp_bonus   > 0 ? 1 : 0, Math.ceil((weapon.hp_bonus   || 0) * mult)),
    mp_bonus:   Math.max(weapon.mp_bonus   > 0 ? 1 : 0, Math.ceil((weapon.mp_bonus   || 0) * mult)),
  }
}

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
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
          <div style={{ color: messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        <div style={{ display:'flex', gap:'4px', marginBottom:'12px' }}>
          {[{id:'enhance', label:'強化'}, {id:'sell', label:'売却'}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab === t.id ? '#001840' : '#000818',
                border: `1px solid ${tab === t.id ? '#aa6644' : '#003366'}`,
                color: tab === t.id ? '#aa6644' : '#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'enhance' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>
              同じ名前の装備を素材に使って強化できます。装備中の武器も強化可能です。
            </div>
            {slots.map(slot => {
              const slotItems = equipment.filter(e => e.slot === slot)
              if (slotItems.length === 0) return null
              return (
                <div key={slot} style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#aa6644', fontSize:'11px', marginBottom:'6px' }}>── {SLOT_LABELS[slot]} ──</div>
                  {slotItems.map(item => {
                    const w = item.weapons
                    const plus = item.enhance_plus || 0
                    const nextPlus = plus + 1
                    const cost = ENHANCE_COST[nextPlus] || ENHANCE_COST[ENHANCE_COST.length - 1]
                    const materialCount = MATERIAL_COUNT(plus)
                    const sameCount = equipment.filter(e => e.weapons.name === w.name && e.id !== item.id && !e.equipped).length
                    const canEnhance = profile.gold >= cost && sameCount >= materialCount
                    const successRate = nextPlus >= 6 ? (ENHANCE_RATE[nextPlus] || 0.1) : 100
                    const enhanced = getEnhancedStats(w, plus)
                    const isSelected = selectedItem?.id === item.id

                    return (
                      <div key={item.id} style={{ border:`1px solid ${isSelected ? '#aa6644' : '#002244'}`, background: isSelected ? '#1a0800' : '#001028', padding:'10px', marginBottom:'6px' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>
                              {RARITY_LABELS[w.rarity]}
                            </span>
                            <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>
                              {w.name}{plus > 0 ? ` +${plus}` : ''}
                            </span>
                            {item.equipped && <span style={{ color:'#0088ff', fontSize:'10px' }}>装備中</span>}
                          </div>
                          <button onClick={() => setSelectedItem(isSelected ? null : item)}
                            style={{ padding:'3px 8px', background:'#001', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                            {isSelected ? '閉じる' : '強化する'}
                          </button>
                        </div>

                        <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                          {enhanced.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{enhanced.atk_bonus} </span>}
                          {enhanced.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{enhanced.def_bonus} </span>}
                          {enhanced.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{enhanced.matk_bonus} </span>}
                          {enhanced.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{enhanced.mdef_bonus} </span>}
                          {enhanced.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{enhanced.spd_bonus} </span>}
                          {enhanced.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{enhanced.hp_bonus} </span>}
                          {enhanced.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{enhanced.mp_bonus} </span>}
                        </div>

                        {isSelected && (
                          <div style={{ borderTop:'1px solid #003366', paddingTop:'8px', marginTop:'6px' }}>
                            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'4px' }}>
                              強化先: <span style={{color:'#ffcc00'}}>{w.name} +{nextPlus}</span>
                            </div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                              必要G: <span style={{color:'#ffcc00'}}>{cost.toLocaleString()}G</span>　
                              素材: <span style={{color: sameCount >= materialCount ? '#44ff88' : '#ff4444'}}>{w.name} ×{materialCount}（所持{sameCount}個）</span>
                            </div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'8px' }}>
                              成功率: <span style={{color: successRate >= 50 ? '#44ff88' : successRate >= 20 ? '#ffcc00' : '#ff4444'}}>{successRate}%</span>
                              {nextPlus >= 11 && <span style={{color:'#ff4444'}}> ⚠ 失敗時+値下落</span>}
                            </div>
                            <button onClick={() => doEnhance(item)} disabled={!canEnhance || loading}
                              style={{ width:'100%', padding:'8px', background: canEnhance ? '#1a0800' : '#001', border:`1px solid ${canEnhance ? '#aa6644' : '#002244'}`, color: canEnhance ? '#aa6644' : '#334455', cursor: canEnhance ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
                              ⚒ 鍛錬する
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

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
                    const plus = item.enhance_plus || 0
                    const sellPrice = w.sell_price || 0
                    return (
                      <div key={item.id} style={{ border:`1px solid ${item.equipped ? '#003366' : '#002244'}`, background: item.equipped ? '#001040' : '#001028', padding:'10px', marginBottom:'6px', opacity: item.equipped ? 0.5 : 1 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>
                              {RARITY_LABELS[w.rarity]}
                            </span>
                            <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>
                              {w.name}{plus > 0 ? ` +${plus}` : ''}
                            </span>
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
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}