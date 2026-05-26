import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品' }
const RARITY_COLORS = {
  common:'#44ff88', rare:'#4488ff', epic:'#cc44ff', legendary:'#ffcc00'
}
const RARITY_LABELS = {
  common:'Common', rare:'Rare', epic:'Epic', legendary:'Legendary'
}

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
]

const ARTIFACT_EVOLVED = {
  '古びた剣':     '黒星ノ断剣',
  '古びた短剣':   '血哭ノ短刃',
  '古びた弓':     '月影ノ断弓',
  '古びた斧':     '奈落ノ処刑斧',
  '古びた刀':     '斬月ノ終刀',
  '古びた銃':     '虚無ノ閃砲',
  '古びた杖':     '星喰ノ導杖',
  '古びた魔導書': '終焉ノ魔書',
  '古びた槍':     '冥哭ノ長槍',
  '古びたハンマー':'鬼神ノ断槌',
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical',
  staff:'magical', wand:'magical', tome:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

const calcProfBonus = (prof) => {
  if (!prof) return {}
  const lv = prof.prof_lv
  const bonus = Math.floor(lv / 10)
  const weapon = prof.weapon
  if (!weapon) return {}
  const group = getWeaponGroup(weapon.weapon_type)
  if (group === 'magical') return { matk: bonus }
  if (weapon.weapon_type === 'bow') return { atk: bonus, spd: bonus }
  return { atk: bonus }
}

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

const getEffectLabel = (effect) => {
  const labels = {
    'open_atk_10_2t':  '【開幕2T・攻撃力+10%】',
    'open_atk_20_1t':  '【開幕1T・攻撃力+20%】',
    'open_def_10_2t':  '【開幕2T・防御力+10%】',
    'open_def_20_1t':  '【開幕1T・防御力+20%】',
    'open_matk_10_2t': '【開幕2T・特殊攻撃力+10%】',
    'open_matk_20_1t': '【開幕1T・特殊攻撃力+20%】',
    'open_mdef_10_2t': '【開幕2T・特殊防御力+10%】',
    'open_mdef_20_1t': '【開幕1T・特殊防御力+20%】',
    'open_spd_10_2t':  '【開幕2T・素早さ+10%】',
    'open_spd_20_1t':  '【開幕1T・素早さ+20%】',
    'delay_heal_10':   '【3T後・HP10%回復】',
    'regen_heal_5_3t': '【開幕3T・毎T HP5%回復】',
    'artifact':        '【消費MP2倍・与ダメージ1.2倍】',
  }
  return labels[effect] || effect
}

export default function Equipment() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [allItems, setAllItems] = useState([])
  const [tab, setTab] = useState('weapon')
  const [loading, setLoading] = useState(false)
  const [awakenMessage, setAwakenMessage] = useState('')

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
    const { data: prof } = await supabase
      .from('proficiency').select('*, weapons(*)')
      .eq('player_id', user.id)
    setProficiency(prof || [])
    const { data: pi } = await supabase
      .from('player_items').select('*, items(*)')
      .eq('player_id', user.id)
    setAllItems(pi || [])
  }

  const equip = async (item) => {
    setLoading(true)
    await supabase.from('player_equipment')
      .update({ equipped: false })
      .eq('player_id', profile.id)
      .eq('slot', item.slot)
      .eq('equipped', true)
    await supabase.from('player_equipment')
      .update({ equipped: true })
      .eq('id', item.id)
    if (item.slot === 'weapon') {
      const { data: existing } = await supabase
        .from('proficiency').select('id')
        .eq('player_id', profile.id)
        .eq('weapon_id', item.weapons.id)
        .single()
      if (!existing) {
        await supabase.from('proficiency').insert({
          player_id: profile.id, weapon_id: item.weapons.id,
          prof_exp: 0, prof_lv: 1, awakening: 0,
        })
      }
    }
    await fetchAll()
    setLoading(false)
  }

  const unequip = async (item) => {
    setLoading(true)
    await supabase.from('player_equipment').update({ equipped: false }).eq('id', item.id)
    await fetchAll()
    setLoading(false)
  }

  const setItemSlot = async (itemId) => {
    setLoading(true)
    await supabase.from('player_items').update({ equipped: false }).eq('player_id', profile.id)
    if (itemId) {
      await supabase.from('player_items').update({ equipped: true }).eq('id', itemId)
    }
    await fetchAll()
    setLoading(false)
  }

  const setItemThreshold = async (itemId, threshold) => {
    setLoading(true)
    await supabase.from('player_items').update({ use_threshold: threshold }).eq('id', itemId)
    await fetchAll()
    setLoading(false)
  }

  const doAwaken = async (item) => {
    setLoading(true)
    const evolvedName = ARTIFACT_EVOLVED[item.weapons.name]
    if (!evolvedName) { setLoading(false); return }

    // 進化後の武器データを取得
    const { data: evolvedWeapon } = await supabase
      .from('weapons').select('*').eq('name', evolvedName).single()
    if (!evolvedWeapon) { setLoading(false); return }

    // player_equipmentの武器IDを進化後に変更・特殊能力付与
    await supabase.from('player_equipment').update({
      weapon_id: evolvedWeapon.id,
      bonus_effect: 'artifact',
    }).eq('id', item.id)

    setAwakenMessage(`✨ ${evolvedName} に覚醒した！`)
    setTimeout(() => setAwakenMessage(''), 3000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const slots = ['weapon', 'armor', 'accessory']
  const filteredEquipment = equipment.filter(e => e.slot === tab)
  const equippedItem = allItems.find(i => i.equipped)

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

        {awakenMessage && (
          <div style={{ color:'#ffcc00', fontSize:'14px', textAlign:'center', padding:'12px', border:'1px solid #ffcc00', marginBottom:'12px', background:'#1a1000' }}>
            {awakenMessage}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:'12px' }}>
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
                        {getProfPrefix(proficiency.find(p => p.weapon_id === equipped.weapons.id)?.prof_lv || 0)}{equipped.weapons.name}
                      </div>
                      <div style={{ fontSize:'9px', color: RARITY_COLORS[equipped.weapons.rarity], marginBottom:'2px' }}>
                        {RARITY_LABELS[equipped.weapons.rarity]}
                      </div>
                      <div style={{ fontSize:'10px', marginTop:'2px' }}>
                        {equipped.weapons.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{equipped.weapons.atk_bonus} </span>}
                        {equipped.weapons.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{equipped.weapons.def_bonus} </span>}
                        {equipped.weapons.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{equipped.weapons.matk_bonus} </span>}
                        {equipped.weapons.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{equipped.weapons.mdef_bonus} </span>}
                        {equipped.weapons.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{equipped.weapons.spd_bonus} </span>}
                        {equipped.weapons.spd_bonus_pct > 0 && <span style={{color:'#ff8844'}}>素早さ+{equipped.weapons.spd_bonus_pct}% </span>}
                        {equipped.weapons.hp_bonus_pct > 0 && <span style={{color:'#44ff88'}}>HP+{equipped.weapons.hp_bonus_pct}% </span>}
                        {equipped.weapons.mp_bonus_pct > 0 && <span style={{color:'#4488ff'}}>MP+{equipped.weapons.mp_bonus_pct}% </span>}
                      </div>
                      {equipped.bonus_effect && <div style={{color:'#ffaa00', fontSize:'10px'}}>{getEffectLabel(equipped.bonus_effect)}</div>}
                    </>
                  ) : (
                    <div style={{ color:'#334455', fontSize:'11px' }}>なし</div>
                  )}
                </div>
              )
            })}

            <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px', marginTop:'12px' }}>持ち物</div>
            <div style={{ border:'1px solid #003366', background:'#001028', padding:'8px' }}>
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>アイテム（1個）</div>
              {equippedItem ? (
                <>
                  <div style={{ color:'#44ff88', fontSize:'11px' }}>{equippedItem.items.name}</div>
                  <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>残り{equippedItem.quantity}個</div>
                  {(equippedItem.items.effect === 'hp_pct' || equippedItem.items.effect === 'mp_pct') && (
                    <div style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'4px' }}>
                      <span style={{ color:'#446688', fontSize:'10px' }}>使用:</span>
                      <select value={equippedItem.use_threshold || 50}
                        onChange={e => setItemThreshold(equippedItem.id, Number(e.target.value))}
                        style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                        {[10,20,30,40,50,60,70,80,90,100].map(n => (
                          <option key={n} value={n}>{n}%以下</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button onClick={() => setItemSlot(null)} disabled={loading}
                    style={{ marginTop:'4px', padding:'2px 6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                    外す
                  </button>
                </>
              ) : (
                <div style={{ color:'#334455', fontSize:'11px' }}>なし</div>
              )}
            </div>
          </div>

          <div>
            <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
              {[...slots, 'item'].map(s => (
                <button key={s} onClick={() => setTab(s)}
                  style={{ padding:'4px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: tab === s ? '#001840' : '#000818',
                    border: `1px solid ${tab === s ? '#ffcc00' : '#003366'}`,
                    color: tab === s ? '#ffcc00' : '#446688' }}>
                  {s === 'item' ? 'アイテム' : SLOT_LABELS[s]}
                </button>
              ))}
            </div>

            {tab === 'item' && (
              <div>
                {allItems.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>}
                {allItems.map(pi => (
                  <div key={pi.id} style={{ border:`1px solid ${pi.equipped ? '#0044aa' : '#002244'}`, background: pi.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                      <span style={{ color:'#44ff88', fontSize:'12px' }}>{pi.items.name}</span>
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>×{pi.quantity}</span>
                        {pi.equipped
                          ? <span style={{ color:'#0088ff', fontSize:'10px' }}>セット中</span>
                          : <button onClick={() => setItemSlot(pi.id)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>セットする</button>
                        }
                      </div>
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>{pi.items.description}</div>
                    {pi.equipped && (pi.items.effect === 'hp_pct' || pi.items.effect === 'mp_pct') && (
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'4px' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>使用タイミング:</span>
                        <select value={pi.use_threshold || 50}
                          onChange={e => setItemThreshold(pi.id, Number(e.target.value))}
                          style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                          {[10,20,30,40,50,60,70,80,90,100].map(n => (
                            <option key={n} value={n}>{n}%以下で使用</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab !== 'item' && (
              <div>
                {filteredEquipment.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>}
                {filteredEquipment.map(item => {
                  const w = item.weapons
                  const prof = tab === 'weapon' ? proficiency.find(p => p.weapon_id === w.id) : null
                  const profBonus = calcProfBonus(prof ? { ...prof, weapon: w } : null)
                  const profPct = prof ? Math.min(100, (prof.prof_exp / 100) * 100) : 0
                  const profPrefix = prof ? getProfPrefix(prof.prof_lv) : ''
                  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(w.name)
                  const canAwaken = isArtifactBase && prof && prof.prof_lv >= 300
                  const hasBonus = item.bonus_atk > 0 || item.bonus_def > 0 || item.bonus_matk > 0 || item.bonus_mdef > 0 || item.bonus_spd > 0 || item.bonus_hp > 0 || item.bonus_mp > 0

                  return (
                    <div key={item.id} style={{ border:`1px solid ${item.equipped ? '#0044aa' : '#002244'}`, background: item.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                          <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>
                            {RARITY_LABELS[w.rarity]}
                          </span>
                          <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{profPrefix}{w.name}</span>
                        </div>
                        <div style={{ display:'flex', gap:'4px' }}>
                          {canAwaken && (
                            <button onClick={() => doAwaken(item)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#1a0800', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                              ✨ 覚醒
                            </button>
                          )}
                          {item.equipped
                            ? <button onClick={() => unequip(item)} disabled={loading} style={{ padding:'2px 8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                            : <button onClick={() => equip(item)} disabled={loading} style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>装備する</button>
                          }
                        </div>
                      </div>

                      <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                        {w.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{w.atk_bonus} </span>}
                        {w.atk_bonus  < 0 && <span style={{color:'#ff4444'}}>攻撃力{w.atk_bonus} </span>}
                        {w.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{w.def_bonus} </span>}
                        {w.def_bonus  < 0 && <span style={{color:'#ff4444'}}>防御力{w.def_bonus} </span>}
                        {w.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{w.matk_bonus} </span>}
                        {w.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{w.mdef_bonus} </span>}
                        {w.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{w.spd_bonus} </span>}
                        {w.spd_bonus  < 0 && <span style={{color:'#ff4444'}}>素早さ{w.spd_bonus} </span>}
                        {w.spd_bonus_pct > 0 && <span style={{color:'#ff8844'}}>素早さ+{w.spd_bonus_pct}% </span>}
                        {w.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus} </span>}
                        {w.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus} </span>}
                        {w.hp_bonus_pct > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus_pct}% </span>}
                        {w.mp_bonus_pct > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus_pct}% </span>}
                      </div>

                      {hasBonus && (
                        <div style={{ fontSize:'10px', color:'#ffaa00', marginBottom:'4px' }}>
                          ボーナス:
                          {item.bonus_atk  > 0 && ` 攻撃力+${item.bonus_atk}`}
                          {item.bonus_def  > 0 && ` 防御力+${item.bonus_def}`}
                          {item.bonus_matk > 0 && ` 特殊攻撃力+${item.bonus_matk}`}
                          {item.bonus_mdef > 0 && ` 特殊防御力+${item.bonus_mdef}`}
                          {item.bonus_spd  > 0 && ` 素早さ+${item.bonus_spd}`}
                          {item.bonus_hp   > 0 && ` HP+${item.bonus_hp}`}
                          {item.bonus_mp   > 0 && ` MP+${item.bonus_mp}`}
                        </div>
                      )}
                      {item.bonus_effect && (
                        <div style={{ fontSize:'10px', color:'#ffaa00', marginBottom:'4px' }}>
                          {getEffectLabel(item.bonus_effect)}
                        </div>
                      )}

                      {tab === 'weapon' && prof && (
                        <div>
                          <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
                            <span>{profPrefix}熟練度 LV{prof.prof_lv}</span>
                            <span>{prof.prof_exp}/100</span>
                          </div>
                          <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'2px' }}>
                            <div style={{ height:'100%', width:`${profPct}%`, background:'linear-gradient(90deg,#220044,#aa44ff)' }} />
                          </div>
                          {Object.keys(profBonus).length > 0 && (
                            <div style={{ fontSize:'10px', color:'#aa44ff' }}>
                              熟練度ボーナス: {Object.entries(profBonus).map(([k,v]) => {
                                const label = k === 'atk' ? '攻撃力' : k === 'matk' ? '特殊攻撃力' : k === 'def' ? '防御力' : k === 'mdef' ? '特殊防御力' : '素早さ'
                                return `${label}+${v}`
                              }).join(' ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}