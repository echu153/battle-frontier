import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品①', accessory2:'装飾品②' }
const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const RARITY_LABELS = {
  f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS'
}

const ENHANCE_COST = [0,100,200,400,800,1500,3000,5000,8000,12000,20000,35000,60000,100000,150000,200000,300000]
const ENHANCE_RATE = { 6:70, 7:60, 8:50, 9:40, 10:30, 11:20, 12:10, 13:5, 14:3, 15:1, 16:0.1 }
const MATERIAL_COUNT = (plus) => {
  if (plus <= 5) return 1
  if (plus <= 10) return 2
  if (plus <= 15) return 3
  return 4
}

const STONE_RANKS = ['f','e','d','c','b','a','s','ss','sss']
const STONE_NAMES = {
  f:'強化石(F)', e:'強化石(E)', d:'強化石(D)', c:'強化石(C)',
  b:'強化石(B)', a:'強化石(A)', s:'強化石(S)', ss:'強化石(SS)', sss:'強化石(SSS)'
}

export default function Smithy() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [playerItems, setPlayerItems] = useState([])
  const [tab, setTab] = useState('enhance')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [selectedItem, setSelectedItem] = useState(null)
  const [craftTab, setCraftTab] = useState('equipment')

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
    const { data: pi } = await supabase
      .from('player_items').select('*, items(*)')
      .eq('player_id', user.id)
    setPlayerItems(pi || [])
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
      setLoading(false); return
    }

    const sameItems = equipment.filter(e =>
      e.weapons.name === item.weapons.name && e.id !== item.id && !e.equipped
    )

    if (sameItems.length < materialCount) {
      showMessage(`素材が足りません！（${materialCount}個必要）`, '#ff4444')
      setLoading(false); return
    }

    await supabase.from('profiles').update({ gold: profile.gold - cost }).eq('id', profile.id)
    for (let i = 0; i < materialCount; i++) {
      await supabase.from('player_equipment').delete().eq('id', sameItems[i].id)
    }

    let success = true
    if (nextPlus >= 6) {
      const rate = ENHANCE_RATE[nextPlus] || ENHANCE_RATE[16]
      success = Math.random() * 100 < rate
    }

    if (success) {
      await supabase.from('player_equipment').update({ enhance_plus: nextPlus }).eq('id', item.id)
      showMessage(`✨ 強化成功！ ${item.weapons.name} が +${nextPlus} になった！`, '#ffcc00')
    } else if (nextPlus >= 11) {
      const newPlus = Math.max(0, currentPlus - 1)
      await supabase.from('player_equipment').update({ enhance_plus: newPlus }).eq('id', item.id)
      showMessage(`💔 強化失敗… ${item.weapons.name} が +${newPlus} に下落した…`, '#ff4444')
    } else {
      showMessage(`💔 強化失敗… ${item.weapons.name} は変化しなかった`, '#ff6644')
    }

    await fetchAll()
    setSelectedItem(null)
    setLoading(false)
  }

  const craftStoneFromSelectedItems = async (selectedIds) => {
    setLoading(true)
    const selected = selectedIds.map(id => equipment.find(e => e.id === id)).filter(Boolean)
    if (selected.length !== 3) {
      showMessage('3つ選択してください！', '#ff4444')
      setLoading(false); return
    }
    const rarity = selected[0].weapons.rarity
    if (!selected.every(e => e.weapons.rarity === rarity)) {
      showMessage('同じランクの装備を3つ選択してください！', '#ff4444')
      setLoading(false); return
    }
    for (const item of selected) {
      await supabase.from('player_equipment').delete().eq('id', item.id)
    }
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    if (stoneItem) {
      const existing = playerItems.find(pi => pi.item_id === stoneItem.id)
      if (existing) {
        await supabase.from('player_items').update({ quantity: (existing.quantity||1)+1 }).eq('id', existing.id)
      } else {
        await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
      }
    }
    showMessage(`✨ ${stoneName} を1つ作成した！`, '#ffcc00')
    await fetchAll()
    setLoading(false)
  }

  const craftStoneFromStones = async (rarity) => {
    setLoading(true)
    const stoneIdx = STONE_RANKS.indexOf(rarity)
    if (stoneIdx >= STONE_RANKS.length - 1) {
      showMessage('これ以上ランクアップできません！', '#ff4444')
      setLoading(false); return
    }
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    const existing = playerItems.find(pi => pi.item_id === stoneItem?.id)
    if (!existing || (existing.quantity||0) < 3) {
      showMessage(`${stoneName}が3つ必要です！（所持${existing?.quantity||0}個）`, '#ff4444')
      setLoading(false); return
    }
    if ((existing.quantity||0) - 3 <= 0) {
      await supabase.from('player_items').delete().eq('id', existing.id)
    } else {
      await supabase.from('player_items').update({ quantity: (existing.quantity||0)-3 }).eq('id', existing.id)
    }
    const nextRarity = STONE_RANKS[stoneIdx + 1]
    const nextStoneName = STONE_NAMES[nextRarity]
    const { data: nextStoneItem } = await supabase.from('items').select('*').eq('name', nextStoneName).single()
    if (nextStoneItem) {
      const nextExisting = playerItems.find(pi => pi.item_id === nextStoneItem.id)
      if (nextExisting) {
        await supabase.from('player_items').update({ quantity: (nextExisting.quantity||1)+1 }).eq('id', nextExisting.id)
      } else {
        await supabase.from('player_items').insert({ player_id: profile.id, item_id: nextStoneItem.id, quantity: 1, equipped: false })
      }
    }
    showMessage(`✨ ${nextStoneName} を1つ作成した！`, '#ffcc00')
    await fetchAll()
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

  const slots = ['weapon', 'armor', 'accessory', 'accessory2']

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

  const getStoneCount = (rarity) => {
    const stoneName = STONE_NAMES[rarity]
    const found = playerItems.find(pi => pi.items?.name === stoneName)
    return found?.quantity || 0
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
          {[{id:'enhance', label:'強化'}, {id:'craft', label:'加工'}, {id:'sell', label:'売却'}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab === t.id ? '#001840' : '#000818',
                border: `1px solid ${tab === t.id ? '#aa6644' : '#003366'}`,
                color: tab === t.id ? '#aa6644' : '#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 強化タブ */}
        {tab === 'enhance' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>
              同じ名前の装備を素材に使って強化できます。
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

        {/* 加工タブ */}
        {tab === 'craft' && (
          <div>
            <div style={{ display:'flex', gap:'4px', marginBottom:'12px' }}>
              {[{id:'equipment', label:'装備→強化石'}, {id:'stone', label:'強化石→上位強化石'}].map(t => (
                <button key={t.id} onClick={() => setCraftTab(t.id)}
                  style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: craftTab === t.id ? '#001840' : '#000818',
                    border: `1px solid ${craftTab === t.id ? '#ffcc00' : '#003366'}`,
                    color: craftTab === t.id ? '#ffcc00' : '#446688' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* 装備→強化石 */}
            {craftTab === 'equipment' && (
              <div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
                  同ランクの装備を3つ選択して強化石に加工できます（装備中は選択不可）
                </div>
                <CraftSelector
                  equipment={equipment}
                  loading={loading}
                  onCraft={craftStoneFromSelectedItems}
                />
              </div>
            )}

            {/* 強化石→上位強化石 */}
            {craftTab === 'stone' && (
              <div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
                  同ランクの強化石3つ→1つ上のランクの強化石1つに加工できます
                </div>
                {STONE_RANKS.slice(0, -1).map(rarity => {
                  const count = getStoneCount(rarity)
                  const canCraft = count >= 3
                  const nextRarity = STONE_RANKS[STONE_RANKS.indexOf(rarity) + 1]
                  return (
                    <div key={rarity} style={{ border:`1px solid ${canCraft ? '#446600' : '#002244'}`, background:'#001028', padding:'10px', marginBottom:'6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <span style={{ color:'#88ccff', fontSize:'12px' }}>{STONE_NAMES[rarity]} ×3</span>
                        <span style={{ color: canCraft ? '#44ff88' : '#ff4444', fontSize:'10px', marginLeft:'8px' }}>（所持{count}個）</span>
                        <span style={{ color:'#446688', fontSize:'10px', marginLeft:'8px' }}>→ {STONE_NAMES[nextRarity]}</span>
                      </div>
                      <button onClick={() => craftStoneFromStones(rarity)} disabled={!canCraft || loading}
                        style={{ padding:'4px 10px', background: canCraft ? '#1a1400' : '#001', border:`1px solid ${canCraft ? '#aa8800' : '#002244'}`, color: canCraft ? '#ffcc00' : '#334455', cursor: canCraft ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                        加工する
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* 売却タブ */}
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

function CraftSelector({ equipment, loading, onCraft }) {
  const [selected, setSelected] = useState([])
  const unequipped = equipment.filter(e => !e.equipped)

  const toggle = (id) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id))
      return
    }
    if (selected.length >= 3) return
    if (selected.length > 0) {
      const firstItem = unequipped.find(e => e.id === selected[0])
      const thisItem = unequipped.find(e => e.id === id)
      if (firstItem?.weapons.rarity !== thisItem?.weapons.rarity) return
    }
    setSelected([...selected, id])
  }

  const selectedRarity = selected.length > 0 ? unequipped.find(e => e.id === selected[0])?.weapons.rarity : null

  const RARITY_COLORS_LOCAL = {
    f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
    b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
  }
  const RARITY_LABELS_LOCAL = {
    f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS'
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', padding:'8px', border:'1px solid #003366', background:'#001028' }}>
        <div style={{ fontSize:'11px', color:'#446688' }}>
          選択中: <span style={{color: selected.length===3?'#44ff88':'#ffcc00'}}>{selected.length}/3</span>
          {selectedRarity && <span style={{color: RARITY_COLORS_LOCAL[selectedRarity], marginLeft:'8px'}}>{RARITY_LABELS_LOCAL[selectedRarity]}ランク</span>}
          {selectedRarity && <span style={{color:'#446688', marginLeft:'8px'}}>→ {STONE_NAMES[selectedRarity]}</span>}
        </div>
        <div style={{ display:'flex', gap:'6px' }}>
          <button onClick={() => setSelected([])} disabled={selected.length===0}
            style={{ padding:'4px 8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
            クリア
          </button>
          <button onClick={() => { onCraft(selected); setSelected([]) }} disabled={selected.length!==3 || loading}
            style={{ padding:'4px 10px', background: selected.length===3?'#1a1400':'#001', border:`1px solid ${selected.length===3?'#aa8800':'#002244'}`, color: selected.length===3?'#ffcc00':'#334455', cursor: selected.length===3?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
            加工する
          </button>
        </div>
      </div>

      {unequipped.length === 0 && (
        <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>加工できる装備がありません</div>
      )}

      {unequipped.map(item => {
        const w = item.weapons
        const isSelected = selected.includes(item.id)
        const isDiffRarity = selected.length > 0 && !isSelected &&
          unequipped.find(e => e.id === selected[0])?.weapons.rarity !== w.rarity
        const isDisabled = (!isSelected && selected.length >= 3) || isDiffRarity

        return (
          <div key={item.id}
            onClick={() => !isDisabled && toggle(item.id)}
            style={{
              border:`2px solid ${isSelected ? RARITY_COLORS_LOCAL[w.rarity] : '#002244'}`,
              background: isSelected ? '#1a1200' : '#001028',
              padding:'8px', marginBottom:'4px',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.4 : 1,
              display:'flex', justifyContent:'space-between', alignItems:'center'
            }}>
            <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              {isSelected && <span style={{color:'#ffcc00', fontSize:'12px'}}>✓</span>}
              <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS_LOCAL[w.rarity], border:`1px solid ${RARITY_COLORS_LOCAL[w.rarity]}` }}>
                {RARITY_LABELS_LOCAL[w.rarity]}
              </span>
              <span style={{ color: RARITY_COLORS_LOCAL[w.rarity], fontSize:'12px' }}>{w.name}</span>
              {item.enhance_plus > 0 && <span style={{color:'#ffcc00', fontSize:'10px'}}>+{item.enhance_plus}</span>}
            </div>
            <div style={{ fontSize:'10px', color:'#446688' }}>
              {w.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻+{w.atk_bonus} </span>}
              {w.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防+{w.def_bonus} </span>}
              {w.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特攻+{w.matk_bonus} </span>}
              {w.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特防+{w.mdef_bonus} </span>}
              {w.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>速+{w.spd_bonus} </span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}