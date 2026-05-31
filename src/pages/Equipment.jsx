import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const RARITY_LABELS = {
  f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS'
}
const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品', accessory2:'装飾品' }

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
]

const RARITY_ORDER = ['f','e','d','c','b','a','s','ss','sss']

const sortEquipment = (items, key) => [...items].sort((a, b) => {
  if (key === 'rarity_asc')  return RARITY_ORDER.indexOf(a.weapons.rarity) - RARITY_ORDER.indexOf(b.weapons.rarity)
  if (key === 'rarity_desc') return RARITY_ORDER.indexOf(b.weapons.rarity) - RARITY_ORDER.indexOf(a.weapons.rarity)
  if (key === 'obtained_desc') return new Date(b.obtained_at) - new Date(a.obtained_at)
  return new Date(a.obtained_at) - new Date(b.obtained_at)
})

const ARTIFACT_EVOLVED = {
  '古びた剣':'黒星ノ断剣','古びた短剣':'血哭ノ短刃','古びた弓':'月影ノ断弓',
  '古びた斧':'奈落ノ処刑斧','古びた刀':'斬月ノ終刀','古びた銃':'虚無ノ閃砲',
  '古びた杖':'星喰ノ導杖','古びた魔導書':'終焉ノ魔書','古びた槍':'冥哭ノ長槍',
  '古びたハンマー':'鬼神ノ断槌',
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

// 熟練度ボーナス：物理武器→ATK / 特殊武器→MATK（Game.jsxと同一ロジック）
// 上昇値 = floor(元ステータス × (LV×1% + floor(LV/100)×50%))
const calcProfBonus = (prof) => {
  if (!prof) return {}
  const weapon = prof.weapon
  if (!weapon) return {}
  const lv = prof.prof_lv || 1
  const isMagical = getWeaponGroup(weapon.weapon_type) === 'magical'
  const baseStat = isMagical ? (weapon.matk_bonus||0) : (weapon.atk_bonus||0)
  if (baseStat <= 0) return {}
  const rate = lv * 0.01 + Math.floor(lv/100) * 0.5
  const gain = Math.floor(baseStat * rate)
  if (gain <= 0) return {}
  return isMagical ? { matk: gain } : { atk: gain }
}

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

const getEffectLabel = (effect) => {
  const labels = {
    'open_atk_10_2t':'【開幕2T・攻撃力+10%】','open_atk_20_1t':'【開幕1T・攻撃力+20%】',
    'open_def_10_2t':'【開幕2T・防御力+10%】','open_def_20_1t':'【開幕1T・防御力+20%】',
    'open_matk_10_2t':'【開幕2T・特殊攻撃力+10%】','open_matk_20_1t':'【開幕1T・特殊攻撃力+20%】',
    'open_mdef_10_2t':'【開幕2T・特殊防御力+10%】','open_mdef_20_1t':'【開幕1T・特殊防御力+20%】',
    'open_spd_10_2t':'【開幕2T・素早さ+10%】','open_spd_20_1t':'【開幕1T・素早さ+20%】',
    'delay_heal_10':'【3T後・HP10%回復】','regen_heal_5_3t':'【開幕3T・毎T HP5%回復】',
    'artifact':'【消費MP2倍・与ダメージ1.2倍】',
  }
  return labels[effect] || effect
}

// enhance_plusによる強化後ステータス計算（1.5倍・古びた○○除外）
const calcEnhancedStats = (weapon, plus) => {
  if (!plus || plus <= 0) return weapon
  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(weapon.name)
  if (isArtifactBase) return weapon
  const mult = Math.pow(1.5, plus)
  return {
    ...weapon,
    atk_bonus:  weapon.atk_bonus  > 0 ? Math.ceil(weapon.atk_bonus  * mult) : weapon.atk_bonus,
    def_bonus:  weapon.def_bonus  > 0 ? Math.ceil(weapon.def_bonus  * mult) : weapon.def_bonus,
    matk_bonus: weapon.matk_bonus > 0 ? Math.ceil(weapon.matk_bonus * mult) : weapon.matk_bonus,
    mdef_bonus: weapon.mdef_bonus > 0 ? Math.ceil(weapon.mdef_bonus * mult) : weapon.mdef_bonus,
    spd_bonus:  weapon.spd_bonus  > 0 ? Math.ceil(weapon.spd_bonus  * mult) : weapon.spd_bonus,
    hp_bonus:   weapon.hp_bonus   > 0 ? Math.ceil(weapon.hp_bonus   * mult) : weapon.hp_bonus,
    mp_bonus:   weapon.mp_bonus   > 0 ? Math.ceil(weapon.mp_bonus   * mult) : weapon.mp_bonus,
  }
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
  const [confirmReset, setConfirmReset] = useState(null)
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('equipSortKey') || 'obtained_asc')

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
    await supabase.from('player_equipment').update({ equipped: false }).eq('player_id', profile.id).eq('slot', item.slot).eq('equipped', true)
    await supabase.from('player_equipment').update({ equipped: true }).eq('id', item.id)
    if (item.slot === 'weapon') {
      // 装備インスタンス(item.id)ごとに熟練度を管理
      const { data: existing } = await supabase.from('proficiency').select('id').eq('player_id', profile.id).eq('equipment_id', item.id).maybeSingle()
      if (!existing) {
        await supabase.from('proficiency').insert({ player_id: profile.id, weapon_id: item.weapons.id, equipment_id: item.id, prof_exp: 0, prof_lv: 1, awakening: 0 })
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

  const changeSlot = async (item, newSlot) => {
    setLoading(true)
    await supabase.from('player_equipment').update({ equipped: false }).eq('player_id', profile.id).eq('slot', newSlot).eq('equipped', true)
    await supabase.from('player_equipment').update({ slot: newSlot, equipped: true }).eq('id', item.id)
    await fetchAll()
    setLoading(false)
  }

  const setItemSlot = async (itemId) => {
    setLoading(true)
    await supabase.from('player_items').update({ equipped: false }).eq('player_id', profile.id)
    if (itemId) await supabase.from('player_items').update({ equipped: true }).eq('id', itemId)
    await fetchAll()
    setLoading(false)
  }

  const setItemThreshold = async (itemId, threshold) => {
    setLoading(true)
    await supabase.from('player_items').update({ use_threshold: threshold }).eq('id', itemId)
    await fetchAll()
    setLoading(false)
  }

  const useStatReset = async (pi) => {
    setLoading(true)
    const spent = profile.stat_point_spent || {}
    const totalSpent = (spent.hp||0)+(spent.mp||0)+(spent.atk||0)+(spent.def||0)+(spent.matk||0)+(spent.mdef||0)+(spent.spd||0)
    const newHpMax = profile.hp_max - (spent.hp||0)*10
    const newMpMax = profile.mp_max - (spent.mp||0)*5
    await supabase.from('profiles').update({
      hp_max: newHpMax,
      mp_max: newMpMax,
      atk:  profile.atk  - (spent.atk ||0),
      def:  profile.def  - (spent.def  ||0),
      matk: profile.matk - (spent.matk ||0),
      mdef: profile.mdef - (spent.mdef ||0),
      spd:  profile.spd  - (spent.spd  ||0),
      hp_current: Math.min(profile.hp_current ?? profile.hp_max, newHpMax),
      mp_current: Math.min(profile.mp_current ?? profile.mp_max, newMpMax),
      pending_stat_points: (profile.pending_stat_points||0) + totalSpent,
      stat_point_spent: {},
    }).eq('id', profile.id)
    if (pi.quantity > 1) {
      await supabase.from('player_items').update({ quantity: pi.quantity - 1 }).eq('id', pi.id)
    } else {
      await supabase.from('player_items').delete().eq('id', pi.id)
    }
    await fetchAll()
    setConfirmReset(null)
    setLoading(false)
  }

  const doAwaken = async (item) => {
    setLoading(true)
    const evolvedName = ARTIFACT_EVOLVED[item.weapons.name]
    if (!evolvedName) { setLoading(false); return }
    const { data: evolvedWeapon } = await supabase.from('weapons').select('*').eq('name', evolvedName).single()
    if (!evolvedWeapon) { setLoading(false); return }
    await supabase.from('player_equipment').update({ weapon_id: evolvedWeapon.id, bonus_effect: 'artifact' }).eq('id', item.id)
    // 覚醒後は熟練度をLV1・EXP0にリセット（この装備インスタンス）
    await supabase.from('proficiency').update({ prof_lv: 1, prof_exp: 0 }).eq('player_id', profile.id).eq('equipment_id', item.id)
    setAwakenMessage(`✨ ${evolvedName} に覚醒した！`)
    setTimeout(() => setAwakenMessage(''), 3000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const slots = ['weapon', 'armor', 'accessory', 'accessory2']
  const filteredEquipment = sortEquipment(equipment.filter(e => e.slot === tab), sortKey)
  const equippedItem = allItems.find(i => i.equipped)

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        {awakenMessage && (
          <div style={{ color:'#ffcc00', fontSize:'14px', textAlign:'center', padding:'12px', border:'1px solid #ffcc00', marginBottom:'12px', background:'#1a1000' }}>{awakenMessage}</div>
        )}

        {/* 装備中セクション（横並び） */}
        <div style={{ marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>装備中</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'6px' }}>
            {slots.map(slot => {
              const equipped = equipment.find(e => e.slot === slot && e.equipped)
              const plus = equipped?.enhance_plus || 0
              const enhW = equipped ? calcEnhancedStats(equipped.weapons, plus) : null
              return (
                <div key={slot} style={{ border:'1px solid #003366', background:'#001028', padding:'8px' }}>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'3px' }}>{SLOT_LABELS[slot]}</div>
                  {equipped ? (
                    <>
                      <div style={{ color: RARITY_COLORS[equipped.weapons.rarity], fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {getProfPrefix(proficiency.find(p => p.equipment_id === equipped.id)?.prof_lv || 0)}{equipped.weapons.name}
                        {plus > 0 && <span style={{color:'#ffcc00'}}> +{plus}</span>}
                      </div>
                      <div style={{ fontSize:'9px', color: RARITY_COLORS[equipped.weapons.rarity] }}>{RARITY_LABELS[equipped.weapons.rarity]}</div>
                      <div style={{ fontSize:'9px', marginTop:'2px', lineHeight:'1.4' }}>
                        {enhW.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻+{enhW.atk_bonus} </span>}
                        {enhW.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防+{enhW.def_bonus} </span>}
                        {enhW.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>魔攻+{enhW.matk_bonus} </span>}
                        {enhW.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>魔防+{enhW.mdef_bonus} </span>}
                        {enhW.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>速+{enhW.spd_bonus} </span>}
                      </div>
                      {equipped.bonus_effect && <div style={{color:'#ffaa00', fontSize:'9px'}}>{getEffectLabel(equipped.bonus_effect)}</div>}
                    </>
                  ) : (
                    <div style={{ color:'#334455', fontSize:'11px' }}>なし</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 持ち物 */}
          <div style={{ border:'1px solid #003366', background:'#001028', padding:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ color:'#446688', fontSize:'10px' }}>持ち物</span>
              {equippedItem ? (
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ color:'#44ff88', fontSize:'11px' }}>{equippedItem.items.name}</span>
                  <span style={{ color:'#446688', fontSize:'10px' }}>×{equippedItem.quantity}</span>
                  {(equippedItem.items.effect === 'hp_pct' || equippedItem.items.effect === 'mp_pct') && (
                    <select value={equippedItem.use_threshold || 50} onChange={e => setItemThreshold(equippedItem.id, Number(e.target.value))}
                      style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                      {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下</option>)}
                    </select>
                  )}
                  <button onClick={() => setItemSlot(null)} disabled={loading}
                    style={{ padding:'2px 6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                </div>
              ) : (
                <span style={{ color:'#334455', fontSize:'11px' }}>なし</span>
              )}
            </div>
          </div>
        </div>

        {/* 所持装備 */}
        <div>
            <div style={{ display:'flex', gap:'4px', marginBottom:'6px', flexWrap:'wrap' }}>
              {[...slots, 'item'].map(s => (
                <button key={s} onClick={() => setTab(s)}
                  style={{ padding:'4px 8px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: tab === s ? '#001840' : '#000818',
                    border: `1px solid ${tab === s ? '#ffcc00' : '#003366'}`,
                    color: tab === s ? '#ffcc00' : '#446688' }}>
                  {s === 'item' ? 'アイテム' : SLOT_LABELS[s]}
                </button>
              ))}
            </div>

            {tab !== 'item' && (
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px', fontSize:'11px' }}>
                <span style={{color:'#446688'}}>並び替え:</span>
                <select value={sortKey} onChange={e => { const v=e.target.value; setSortKey(v); localStorage.setItem('equipSortKey',v) }}
                  style={{ background:'#001028', border:'1px solid #003366', color:'#88ccff', fontFamily:'monospace', fontSize:'11px', padding:'2px 4px' }}>
                  <option value="obtained_asc">入手順（古い順）</option>
                  <option value="obtained_desc">入手順（新しい順）</option>
                  <option value="rarity_asc">レアリティ（低い順）</option>
                  <option value="rarity_desc">レアリティ（高い順）</option>
                </select>
              </div>
            )}

            {tab === 'item' && (
              <div>
                {allItems.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>}
                {allItems.map(pi => (
                  <div key={pi.id} style={{ border:`1px solid ${pi.equipped ? '#0044aa' : '#002244'}`, background: pi.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                      <span style={{ color:'#44ff88', fontSize:'12px' }}>{pi.items.name}</span>
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>×{pi.quantity}</span>
                        {(pi.items.effect === 'enhance_stone' || pi.items.name?.includes('依頼書')) ? (
                          <span style={{ color:'#aa8800', fontSize:'10px' }}>強化素材</span>
                        ) : pi.items.effect === 'stat_reset' ? (
                          <button onClick={() => setConfirmReset(pi)} disabled={loading}
                            style={{ padding:'2px 8px', background:'#200010', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.equipped ? (
                          <span style={{ color:'#0088ff', fontSize:'10px' }}>セット中</span>
                        ) : (
                          <button onClick={() => setItemSlot(pi.id)} disabled={loading}
                            style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>セットする</button>
                        )}
                      </div>
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>{pi.items.description}</div>
                    {pi.equipped && (pi.items.effect === 'hp_pct' || pi.items.effect === 'mp_pct') && (
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'4px' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>使用タイミング:</span>
                        <select value={pi.use_threshold || 50} onChange={e => setItemThreshold(pi.id, Number(e.target.value))}
                          style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                          {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下で使用</option>)}
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
                  const plus = item.enhance_plus || 0
                  const enhW = calcEnhancedStats(w, plus)
                  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(w.name)
                  const prof = tab === 'weapon' ? proficiency.find(p => p.equipment_id === item.id) : null
                  const profBonus = calcProfBonus(prof ? { ...prof, weapon: w } : null)
                  const profPct = prof ? Math.min(100, (prof.prof_exp / 100) * 100) : 0
                  const profPrefix = prof ? getProfPrefix(prof.prof_lv) : ''
                  const canAwaken = isArtifactBase && prof && prof.prof_lv >= 300
                  const hasBonus = item.bonus_atk > 0 || item.bonus_def > 0 || item.bonus_matk > 0 || item.bonus_mdef > 0 || item.bonus_spd > 0 || item.bonus_hp > 0 || item.bonus_mp > 0 || (item.bonus_crit||0) > 0 || (item.bonus_evasion||0) > 0 || (item.bonus_hit||0) > 0
                  const isAccessory = tab === 'accessory'

                  return (
                    <div key={item.id} style={{ border:`1px solid ${item.equipped ? '#0044aa' : '#002244'}`, background: item.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                          <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>{RARITY_LABELS[w.rarity]}</span>
                          <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{profPrefix}{w.name}</span>
                          {plus > 0 && !isArtifactBase && <span style={{ color:'#ffcc00', fontSize:'11px', fontWeight:'bold' }}>+{plus}</span>}
                        </div>
                        <div style={{ display:'flex', gap:'4px' }}>
                          {canAwaken && (
                            <button onClick={() => doAwaken(item)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#1a0800', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>✨ 覚醒</button>
                          )}
                          {item.equipped ? (
                            <button onClick={() => unequip(item)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                          ) : (
                            <>
                              <button onClick={() => equip(item)} disabled={loading}
                                style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>装備①</button>
                              {isAccessory && (
                                <button onClick={() => changeSlot(item, 'accessory2')} disabled={loading}
                                  style={{ padding:'2px 8px', background:'#001840', border:'1px solid #4466aa', color:'#88aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>装備②</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* 強化後ステータス表示 */}
                      <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                        {enhW.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{enhW.atk_bonus}{plus>0&&!isArtifactBase&&w.atk_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{w.atk_bonus})</span>:null} </span>}
                        {enhW.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{enhW.def_bonus}{plus>0&&!isArtifactBase&&w.def_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{w.def_bonus})</span>:null} </span>}
                        {enhW.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{enhW.matk_bonus}{plus>0&&!isArtifactBase&&w.matk_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{w.matk_bonus})</span>:null} </span>}
                        {enhW.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{enhW.mdef_bonus}{plus>0&&!isArtifactBase&&w.mdef_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{w.mdef_bonus})</span>:null} </span>}
                        {enhW.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{enhW.spd_bonus}{plus>0&&!isArtifactBase&&w.spd_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{w.spd_bonus})</span>:null} </span>}
                        {w.spd_bonus_pct > 0 && <span style={{color:'#ff8844'}}>素早さ+{w.spd_bonus_pct}% </span>}
                        {enhW.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{enhW.hp_bonus} </span>}
                        {enhW.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{enhW.mp_bonus} </span>}
                        {w.hp_bonus_pct  > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus_pct}% </span>}
                        {w.mp_bonus_pct  > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus_pct}% </span>}
                        {w.matk_bonus_pct > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{w.matk_bonus_pct}% </span>}
                        {w.hit_bonus     > 0 && <span style={{color:'#ffaa44'}}>命中+{w.hit_bonus}% </span>}
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
                          {(item.bonus_crit||0) > 0 && ` クリティカル率+${item.bonus_crit}%`}
                          {(item.bonus_evasion||0) > 0 && ` 回避率+${item.bonus_evasion}%`}
                          {(item.bonus_hit||0) > 0 && ` 命中率+${item.bonus_hit}%`}
                        </div>
                      )}
                      {item.bonus_effect && <div style={{ fontSize:'10px', color:'#ffaa00', marginBottom:'4px' }}>{getEffectLabel(item.bonus_effect)}</div>}

                      {tab === 'weapon' && prof && item.equipped && (
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
                                const label = k==='atk'?'攻撃力':k==='matk'?'特殊攻撃力':k==='def'?'防御力':k==='mdef'?'特殊防御力':'素早さ'
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

      {/* 記憶除去装置 確認ダイアログ */}
      {confirmReset && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'#0a0020', border:'1px solid #cc44ff', padding:'24px', maxWidth:'320px', width:'90%', fontFamily:'monospace' }}>
            <div style={{ color:'#cc44ff', fontSize:'14px', marginBottom:'12px' }}>⚠ 記憶除去装置を使用しますか？</div>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'16px', lineHeight:'1.6' }}>
              振り分けたステータスポイントがすべてリセットされ、再度割り振りできるようになります。<br/>
              <span style={{ color:'#ff8844' }}>この操作は取り消せません。</span>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => setConfirmReset(null)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
              <button onClick={() => useStatReset(confirmReset)} disabled={loading} style={{ flex:1, padding:'8px', background:'#200010', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>使用する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
