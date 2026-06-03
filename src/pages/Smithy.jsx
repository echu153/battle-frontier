import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品', accessory2:'装飾品' }
const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const RARITY_LABELS = {
  f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS'
}

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
]

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

const RARITY_ORDER = ['f','e','d','c','b','a','s','ss','sss']
const RARITY_BONUS_CONFIG = {
  f:   { slots:1, min:1,  max:5  },
  e:   { slots:1, min:1,  max:8  },
  d:   { slots:2, min:1,  max:12 },
  c:   { slots:2, min:2,  max:18 },
  b:   { slots:3, min:3,  max:25 },
  a:   { slots:3, min:5,  max:35 },
  s:   { slots:4, min:5,  max:45 },
  ss:  { slots:4, min:8,  max:55 },
  sss: { slots:4, min:10, max:60 },
}
const BONUS_TYPES_BASE = ['atk','def','matk','mdef','spd','hp','mp','effect']
const BONUS_TYPES_HIGH = ['atk','def','matk','mdef','spd','hp','mp','effect','crit','evasion','hit']
const EFFECT_POOL = [
  'open_atk_10_2t','open_atk_20_1t','open_def_10_2t','open_def_20_1t',
  'open_matk_10_2t','open_matk_20_1t','open_mdef_10_2t','open_mdef_20_1t',
  'open_spd_10_2t','open_spd_20_1t','delay_heal_10','regen_heal_5_3t',
]
const RE_EVAL_SHEETS = { f:1, e:2, d:5, c:10, b:30, a:50, s:150, ss:300, sss:1000 }

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

const generateBonusSlots = (rarity) => {
  const config = RARITY_BONUS_CONFIG[rarity]
  const pool = ['a','s','ss','sss'].includes(rarity) ? BONUS_TYPES_HIGH : BONUS_TYPES_BASE
  const usedTypes = new Set()
  const slots = []
  for (let i = 0; i < config.slots; i++) {
    const available = pool.filter(t => !usedTypes.has(t))
    const type = available[Math.floor(Math.random() * available.length)]
    usedTypes.add(type)
    const baseVal = Math.floor(Math.random() * (config.max - config.min + 1)) + config.min
    if (type === 'effect') {
      slots.push({ type, value: EFFECT_POOL[Math.floor(Math.random() * EFFECT_POOL.length)] })
    } else if (type === 'crit' || type === 'evasion' || type === 'hit') {
      slots.push({ type, value: 1.0 + Math.floor(Math.random() * 9) * 0.5 })
    } else if (type === 'hp') {
      slots.push({ type, value: baseVal * 10 })
    } else if (type === 'mp') {
      slots.push({ type, value: baseVal * 5 })
    } else {
      slots.push({ type, value: baseVal })
    }
  }
  return slots
}

const slotsToColumns = (slots) => {
  const cols = {
    bonus_atk:0, bonus_def:0, bonus_matk:0, bonus_mdef:0,
    bonus_spd:0, bonus_hp:0, bonus_mp:0, bonus_effect:null,
    bonus_crit:0, bonus_evasion:0, bonus_hit:0,
    bonus_slots_json: JSON.stringify(slots),
  }
  for (const s of slots) {
    if (s.type==='atk') cols.bonus_atk=s.value
    else if (s.type==='def') cols.bonus_def=s.value
    else if (s.type==='matk') cols.bonus_matk=s.value
    else if (s.type==='mdef') cols.bonus_mdef=s.value
    else if (s.type==='spd') cols.bonus_spd=s.value
    else if (s.type==='hp') cols.bonus_hp=s.value
    else if (s.type==='mp') cols.bonus_mp=s.value
    else if (s.type==='effect') cols.bonus_effect=s.value
    else if (s.type==='crit') cols.bonus_crit=s.value
    else if (s.type==='evasion') cols.bonus_evasion=s.value
    else if (s.type==='hit') cols.bonus_hit=s.value
  }
  return cols
}

const sortEquipment = (items, key) => [...items].sort((a, b) => {
  if (key === 'rarity_asc')  return RARITY_ORDER.indexOf(a.weapons.rarity) - RARITY_ORDER.indexOf(b.weapons.rarity)
  if (key === 'rarity_desc') return RARITY_ORDER.indexOf(b.weapons.rarity) - RARITY_ORDER.indexOf(a.weapons.rarity)
  if (key === 'obtained_desc') return new Date(b.obtained_at) - new Date(a.obtained_at)
  return new Date(a.obtained_at) - new Date(b.obtained_at)
})

// 強化後ステータス計算（1.5倍）
const calcEnhancedStats = (weapon, plus) => {
  if (!plus || plus <= 0) return weapon
  const mult = Math.pow(1.5, plus)
  return {
    atk_bonus:  weapon.atk_bonus  > 0 ? Math.ceil(weapon.atk_bonus  * mult) : weapon.atk_bonus,
    def_bonus:  weapon.def_bonus  > 0 ? Math.ceil(weapon.def_bonus  * mult) : weapon.def_bonus,
    matk_bonus: weapon.matk_bonus > 0 ? Math.ceil(weapon.matk_bonus * mult) : weapon.matk_bonus,
    mdef_bonus: weapon.mdef_bonus > 0 ? Math.ceil(weapon.mdef_bonus * mult) : weapon.mdef_bonus,
    spd_bonus:  weapon.spd_bonus  > 0 ? Math.ceil(weapon.spd_bonus  * mult) : weapon.spd_bonus,
    hp_bonus:   weapon.hp_bonus   > 0 ? Math.ceil(weapon.hp_bonus   * mult) : weapon.hp_bonus,
    mp_bonus:   weapon.mp_bonus   > 0 ? Math.ceil(weapon.mp_bonus   * mult) : weapon.mp_bonus,
  }
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
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('equipSortKey') || 'obtained_asc')
  const [craftConfirm, setCraftConfirm] = useState(null) // { type:'equipment'|'stone', items?, selectedIds?, rarity }

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const { data: eq } = await supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id).order('obtained_at')
    setEquipment(eq || [])
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
    setPlayerItems(pi || [])
  }

  const showMessage = (msg, color = '#44ff88') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const getStoneCount = (rarity) => {
    const stoneName = STONE_NAMES[rarity]
    const found = playerItems.find(pi => pi.items?.name === stoneName)
    return found?.quantity || 0
  }

  const consumeStones = async (rarity, count) => {
    const stoneName = STONE_NAMES[rarity]
    const found = playerItems.find(pi => pi.items?.name === stoneName)
    if (!found) return
    const newQty = (found.quantity || 0) - count
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', found.id)
    else await supabase.from('player_items').update({ quantity: newQty }).eq('id', found.id)
  }

  const doEnhance = async (item) => {
    setLoading(true)
    const currentPlus = item.enhance_plus || 0
    const nextPlus = currentPlus + 1
    const cost = ENHANCE_COST[nextPlus] || ENHANCE_COST[ENHANCE_COST.length - 1]
    const materialCount = MATERIAL_COUNT(currentPlus)
    const rarity = item.weapons.rarity

    // ローカルチェック（UX用）
    if (profile.gold < cost) { showMessage('ゴールドが足りません！', '#ff4444'); setLoading(false); return }

    // ★ サーバーから最新状態を取得（複数タブ同時実行・stale state対策）
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: serverProfile }, { data: serverEquip }, { data: serverPItems }] = await Promise.all([
      supabase.from('profiles').select('gold').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('player_items').select('*, items(*)').eq('player_id', user.id),
    ])

    if (!serverProfile || serverProfile.gold < cost) {
      showMessage('ゴールドが足りません！', '#ff4444'); setLoading(false); return
    }

    const stoneName = STONE_NAMES[rarity]
    const serverStoneItem = serverPItems?.find(pi => pi.items?.name === stoneName)
    const serverStoneCount = serverStoneItem?.quantity || 0
    const serverSameItems = (serverEquip || []).filter(e =>
      e.weapons?.name === item.weapons.name && e.id !== item.id && !e.equipped
    )
    const serverTotalAvailable = serverSameItems.length + serverStoneCount

    if (serverTotalAvailable < materialCount) {
      showMessage(`素材が足りません！（同名装備${serverSameItems.length}個 + 強化石(${RARITY_LABELS[rarity]})${serverStoneCount}個 = ${serverTotalAvailable}個、${materialCount}個必要）`, '#ff4444')
      setLoading(false); return
    }

    // ★ 楽観ロック: ゴールドが読み取り時と同じ値の場合のみ消費（別タブが先に消費してたら失敗）
    const { data: goldLocked } = await supabase.from('profiles')
      .update({ gold: serverProfile.gold - cost })
      .eq('id', profile.id)
      .eq('gold', serverProfile.gold)
      .select('id')
    if (!goldLocked || goldLocked.length === 0) {
      showMessage('処理が競合しました。もう一度お試しください。', '#ff4444')
      await fetchAll(); setLoading(false); return
    }

    // 同名装備を消費
    const useEquipCount = Math.min(serverSameItems.length, materialCount)
    const useStoneCount = materialCount - useEquipCount
    for (let i = 0; i < useEquipCount; i++) {
      await supabase.from('player_equipment').delete().eq('id', serverSameItems[i].id)
    }

    // ★ 楽観ロック: 石が読み取り時と同じ数の場合のみ消費
    if (useStoneCount > 0 && serverStoneItem) {
      const newQty = serverStoneCount - useStoneCount
      const { data: stoneLocked } = newQty <= 0
        ? await supabase.from('player_items').delete().eq('id', serverStoneItem.id).eq('quantity', serverStoneCount).select('id')
        : await supabase.from('player_items').update({ quantity: newQty }).eq('id', serverStoneItem.id).eq('quantity', serverStoneCount).select('id')
      if (!stoneLocked || stoneLocked.length === 0) {
        // 石の消費失敗 → ゴールドを返金して中断
        await supabase.from('profiles').update({ gold: serverProfile.gold }).eq('id', profile.id)
        showMessage('素材の消費に失敗しました。もう一度お試しください。', '#ff4444')
        await fetchAll(); setLoading(false); return
      }
    }

    // 強化実行
    let success = true
    if (nextPlus >= 6) {
      const rate = ENHANCE_RATE[nextPlus] || ENHANCE_RATE[16]
      success = Math.random() * 100 < rate
    }

    let resultPlus = currentPlus
    if (success) {
      await supabase.from('player_equipment').update({ enhance_plus: nextPlus }).eq('id', item.id)
      resultPlus = nextPlus
      showMessage(`✨ 強化成功！ ${item.weapons.name} が +${nextPlus} になった！`, '#ffcc00')
    } else if (nextPlus >= 11) {
      const newPlus = Math.max(0, currentPlus - 1)
      await supabase.from('player_equipment').update({ enhance_plus: newPlus }).eq('id', item.id)
      resultPlus = newPlus
      showMessage(`💔 強化失敗… ${item.weapons.name} が +${newPlus} に下落した…`, '#ff4444')
    } else {
      showMessage(`💔 強化失敗… ${item.weapons.name} は変化しなかった`, '#ff6644')
    }

    await supabase.from('enhance_logs').insert({
      player_id: user.id,
      weapon_name: item.weapons.name,
      from_plus: currentPlus,
      to_plus: resultPlus,
      success,
    })

    await fetchAll()
    setSelectedItem(null)
    setLoading(false)
  }

  const craftStoneFromSelectedItems = async (selectedIds) => {
    setLoading(true)
    const selected = selectedIds.map(id => equipment.find(e => e.id === id)).filter(Boolean)
    if (selected.length !== 3) { showMessage('3つ選択してください！', '#ff4444'); setLoading(false); return }
    const rarity = selected[0].weapons.rarity
    if (!selected.every(e => e.weapons.rarity === rarity)) { showMessage('同じランクの装備を3つ選択してください！', '#ff4444'); setLoading(false); return }
    for (const item of selected) await supabase.from('player_equipment').delete().eq('id', item.id)
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    if (stoneItem) {
      const existing = playerItems.find(pi => pi.item_id === stoneItem.id)
      if (existing) await supabase.from('player_items').update({ quantity: (existing.quantity||1)+1 }).eq('id', existing.id)
      else await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
    }
    showMessage(`✨ ${stoneName} を1つ作成した！`, '#ffcc00')
    await fetchAll()
    setLoading(false)
  }

  const craftStoneFromStones = async (rarity) => {
    setLoading(true)
    const stoneIdx = STONE_RANKS.indexOf(rarity)
    if (stoneIdx >= STONE_RANKS.length - 1) { showMessage('これ以上ランクアップできません！', '#ff4444'); setLoading(false); return }
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    const existing = playerItems.find(pi => pi.item_id === stoneItem?.id)
    if (!existing || (existing.quantity||0) < 3) { showMessage(`${stoneName}が3つ必要です！（所持${existing?.quantity||0}個）`, '#ff4444'); setLoading(false); return }
    if ((existing.quantity||0) - 3 <= 0) await supabase.from('player_items').delete().eq('id', existing.id)
    else await supabase.from('player_items').update({ quantity: (existing.quantity||0)-3 }).eq('id', existing.id)
    const nextRarity = STONE_RANKS[stoneIdx + 1]
    const nextStoneName = STONE_NAMES[nextRarity]
    const { data: nextStoneItem } = await supabase.from('items').select('*').eq('name', nextStoneName).single()
    if (nextStoneItem) {
      const nextExisting = playerItems.find(pi => pi.item_id === nextStoneItem.id)
      if (nextExisting) await supabase.from('player_items').update({ quantity: (nextExisting.quantity||1)+1 }).eq('id', nextExisting.id)
      else await supabase.from('player_items').insert({ player_id: profile.id, item_id: nextStoneItem.id, quantity: 1, equipped: false })
    }
    showMessage(`✨ ${nextStoneName} を1つ作成した！`, '#ffcc00')
    await fetchAll()
    setLoading(false)
  }


  const doReEval = async (item) => {
    setLoading(true)
    const rarity = item.weapons.rarity
    const needed = RE_EVAL_SHEETS[rarity]
    const sheetItem = playerItems.find(pi => pi.items?.name === '再評価依頼書')
    const owned = sheetItem?.quantity || 0
    if (owned < needed) { showMessage(`再評価依頼書が足りません！（所持${owned}枚・必要${needed}枚）`, '#ff4444'); setLoading(false); return }
    const newSlots = generateBonusSlots(rarity)
    const cols = slotsToColumns(newSlots)
    if (item.bonus_effect === 'artifact') cols.bonus_effect = 'artifact'
    await supabase.from('player_equipment').update(cols).eq('id', item.id)
    const newQty = owned - needed
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', sheetItem.id)
    else await supabase.from('player_items').update({ quantity: newQty }).eq('id', sheetItem.id)
    showMessage(`✨ ${item.weapons.name} のボーナスを再評価しました！`, '#ffcc00')
    await fetchAll()
    setLoading(false)
  }

  const doReAppraise = async (item) => {
    setLoading(true)
    const rarity = item.weapons.rarity
    const needed = RE_EVAL_SHEETS[rarity]
    const sheetItem = playerItems.find(pi => pi.items?.name === '再鑑定依頼書')
    const owned = sheetItem?.quantity || 0
    if (owned < needed) { showMessage(`再鑑定依頼書が足りません！（所持${owned}枚・必要${needed}枚）`, '#ff4444'); setLoading(false); return }
    if (!item.bonus_slots_json) { showMessage('まず再評価を行ってください', '#ff4444'); setLoading(false); return }
    const existingSlots = JSON.parse(item.bonus_slots_json)
    const config = RARITY_BONUS_CONFIG[rarity]
    const newSlots = existingSlots.map(s => {
      if (s.type === 'effect') return { type:'effect', value: EFFECT_POOL[Math.floor(Math.random()*EFFECT_POOL.length)] }
      if (s.type==='crit'||s.type==='evasion'||s.type==='hit') return { type:s.type, value: 1.0+Math.floor(Math.random()*9)*0.5 }
      const baseVal = Math.floor(Math.random()*(config.max-config.min+1))+config.min
      if (s.type==='hp') return { type:'hp', value: baseVal*10 }
      if (s.type==='mp') return { type:'mp', value: baseVal*5 }
      return { type:s.type, value: baseVal }
    })
    await supabase.from('player_equipment').update(slotsToColumns(newSlots)).eq('id', item.id)
    const newQty = owned - needed
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', sheetItem.id)
    else await supabase.from('player_items').update({ quantity: newQty }).eq('id', sheetItem.id)
    showMessage(`🔍 ${item.weapons.name} のボーナス値を再鑑定しました！`, '#88ccff')
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const slots = ['weapon', 'armor', 'accessory', 'accessory2']

  const handleCraftConfirm = () => {
    if (!craftConfirm) return
    const c = craftConfirm
    setCraftConfirm(null)
    if (c.type === 'equipment') craftStoneFromSelectedItems(c.selectedIds)
    else craftStoneFromStones(c.rarity)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>

      {/* 加工確認ダイアログ */}
      {craftConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
          <div style={{ background:'#001040', border:'1px solid #aa8800', padding:'24px', maxWidth:'400px', width:'100%' }}>
            <div style={{ color:'#ffcc00', fontSize:'14px', marginBottom:'16px', textAlign:'center', letterSpacing:'2px' }}>加工確認</div>

            {craftConfirm.type === 'equipment' && (
              <>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'10px' }}>以下の装備を消費して強化石に加工します</div>
                <div style={{ marginBottom:'12px' }}>
                  {craftConfirm.items.map(item => (
                    <div key={item.id} style={{ color:'#88ccff', fontSize:'11px', padding:'5px 8px', borderBottom:'1px solid #002244', display:'flex', alignItems:'center', gap:'6px' }}>
                      <span style={{ fontSize:'9px', padding:'1px 4px', color:RARITY_COLORS[item.weapons.rarity], border:`1px solid ${RARITY_COLORS[item.weapons.rarity]}` }}>{RARITY_LABELS[item.weapons.rarity]}</span>
                      <span>{item.weapons.name}{(item.enhance_plus||0)>0?` +${item.enhance_plus}`:''}</span>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign:'center', color:'#446688', fontSize:'11px', marginBottom:'4px' }}>↓</div>
                <div style={{ textAlign:'center', color:'#ffcc00', fontSize:'13px', marginBottom:'16px' }}>
                  {STONE_NAMES[craftConfirm.rarity]} × 1
                </div>
              </>
            )}

            {craftConfirm.type === 'stone' && (() => {
              const nextRarity = STONE_RANKS[STONE_RANKS.indexOf(craftConfirm.rarity)+1]
              return (
                <>
                  <div style={{ marginBottom:'12px' }}>
                    <div style={{ color:'#88ccff', fontSize:'12px', padding:'6px 8px', borderBottom:'1px solid #002244' }}>
                      {STONE_NAMES[craftConfirm.rarity]} × 3
                    </div>
                  </div>
                  <div style={{ textAlign:'center', color:'#446688', fontSize:'11px', marginBottom:'4px' }}>↓</div>
                  <div style={{ textAlign:'center', color:'#ffcc00', fontSize:'13px', marginBottom:'16px' }}>
                    {STONE_NAMES[nextRarity]} × 1
                  </div>
                </>
              )
            })()}

            <div style={{ color:'#446688', fontSize:'10px', textAlign:'center', marginBottom:'16px' }}>上記を消費して加工します。よろしいですか？</div>

            <div style={{ display:'flex', gap:'10px', justifyContent:'center' }}>
              <button onClick={handleCraftConfirm} disabled={loading}
                style={{ background:'#1a1000', border:'1px solid #aa8800', color:'#ffcc00', padding:'8px 24px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                加工する
              </button>
              <button onClick={() => setCraftConfirm(null)}
                style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'8px 24px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#aa6644', fontSize:'14px', marginBottom:'4px' }}>⚒ 鍛冶屋</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span></div>

        {message && <div style={{ color: messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>{message}</div>}

        <div style={{ display:'flex', gap:'4px', marginBottom:'8px', flexWrap:'wrap' }}>
          {[{id:'enhance', label:'強化'}, {id:'craft', label:'加工'}, {id:'reeval', label:'再評価/再鑑定'}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab === t.id ? '#001840' : '#000818',
                border: `1px solid ${tab === t.id ? '#aa6644' : '#003366'}`,
                color: tab === t.id ? '#aa6644' : '#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {(tab === 'enhance' || tab === 'craft' || tab === 'reeval') && (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px', fontSize:'11px' }}>
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

        {/* 強化タブ */}
        {tab === 'enhance' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>
              同じ名前の装備または同ランクの強化石を素材に使って強化できます。※古びた○○は強化不可
            </div>
            {slots.map(slot => {
              const slotItems = sortEquipment(equipment.filter(e => e.slot === slot), sortKey)
              if (slotItems.length === 0) return null
              return (
                <div key={slot} style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#aa6644', fontSize:'11px', marginBottom:'6px' }}>── {SLOT_LABELS[slot]} ──</div>
                  {slotItems.map(item => {
                    const w = item.weapons
                    const isArtifactBase = ARTIFACT_BASE_NAMES.includes(w.name)
                    const plus = item.enhance_plus || 0
                    const nextPlus = plus + 1
                    const cost = ENHANCE_COST[nextPlus] || ENHANCE_COST[ENHANCE_COST.length - 1]
                    const materialCount = MATERIAL_COUNT(plus)
                    const sameCount = equipment.filter(e => e.weapons.name === w.name && e.id !== item.id && !e.equipped).length
                    const stoneCount = getStoneCount(w.rarity)
                    const totalMaterials = sameCount + stoneCount
                    const canEnhance = !isArtifactBase && profile.gold >= cost && totalMaterials >= materialCount
                    const successRate = nextPlus >= 6 ? (ENHANCE_RATE[nextPlus] || 0.1) : 100
                    const enhanced = calcEnhancedStats(w, plus)
                    const nextEnhanced = isArtifactBase ? w : calcEnhancedStats(w, nextPlus)
                    const isSelected = selectedItem?.id === item.id

                    return (
                      <div key={item.id} style={{ border:`1px solid ${isSelected ? '#aa6644' : '#002244'}`, background: isSelected ? '#1a0800' : '#001028', padding:'10px', marginBottom:'6px', opacity: isArtifactBase ? 0.5 : 1 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>{RARITY_LABELS[w.rarity]}</span>
                            <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{w.name}{plus > 0 ? ` +${plus}` : ''}</span>
                            {item.equipped && <span style={{ color:'#0088ff', fontSize:'10px' }}>装備中</span>}
                            {isArtifactBase && <span style={{ color:'#446688', fontSize:'10px' }}>強化不可</span>}
                          </div>
                          {!isArtifactBase && (
                            <button onClick={() => setSelectedItem(isSelected ? null : item)}
                              style={{ padding:'3px 8px', background:'#001', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                              {isSelected ? '閉じる' : '強化する'}
                            </button>
                          )}
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
                            <div style={{ fontSize:'10px', color:'#88ccff', marginBottom:'4px' }}>
                              強化後ステータス:
                              {nextEnhanced.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}> 攻撃力+{nextEnhanced.atk_bonus}</span>}
                              {nextEnhanced.def_bonus  > 0 && <span style={{color:'#88aaff'}}> 防御力+{nextEnhanced.def_bonus}</span>}
                              {nextEnhanced.matk_bonus > 0 && <span style={{color:'#cc44ff'}}> 特殊攻撃力+{nextEnhanced.matk_bonus}</span>}
                              {nextEnhanced.mdef_bonus > 0 && <span style={{color:'#44ccff'}}> 特殊防御力+{nextEnhanced.mdef_bonus}</span>}
                              {nextEnhanced.spd_bonus  > 0 && <span style={{color:'#ff8844'}}> 素早さ+{nextEnhanced.spd_bonus}</span>}
                            </div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'2px' }}>必要G: <span style={{color:'#ffcc00'}}>{cost.toLocaleString()}G</span></div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'2px' }}>必要素材: <span style={{color:'#aa6644'}}>{materialCount}個</span></div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'2px' }}>　同名装備: <span style={{color: sameCount >= materialCount ? '#44ff88' : '#ffcc00'}}>{sameCount}個</span></div>
                            <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                              　{STONE_NAMES[w.rarity]}: <span style={{color: stoneCount > 0 ? '#ffcc00' : '#446688'}}>{stoneCount}個</span>
                              <span style={{color: totalMaterials >= materialCount ? '#44ff88' : '#ff4444', marginLeft:'8px'}}>（合計 {totalMaterials}/{materialCount}）</span>
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
            {craftTab === 'equipment' && (
              <div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'10px' }}>同ランクの装備を3つ選択して強化石に加工できます（装備中は選択不可）</div>

                {/* ランクボタン：ランダム3選択 */}
                <div style={{ border:'1px solid #002244', background:'#000818', padding:'10px', marginBottom:'12px' }}>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>ランク指定でランダムに3つ選んで加工</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                    {RARITY_ORDER.map(rarity => {
                      const avail = sortEquipment(equipment.filter(e => !e.equipped && e.weapons.rarity === rarity), sortKey)
                      const canPick = avail.length >= 3
                      return (
                        <button key={rarity} onClick={() => {
                          const shuffled = [...avail].sort(() => Math.random() - 0.5)
                          const picked = shuffled.slice(0, 3)
                          setCraftConfirm({ type:'equipment', items:picked, selectedIds:picked.map(i=>i.id), rarity })
                        }} disabled={!canPick}
                          style={{ padding:'5px 9px', background:canPick?'#0d1a00':'#001', border:`1px solid ${canPick?RARITY_COLORS[rarity]:'#002244'}`, color:canPick?RARITY_COLORS[rarity]:'#334455', cursor:canPick?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                          {RARITY_LABELS[rarity]} <span style={{fontSize:'9px'}}>({avail.length})</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 手動選択 */}
                <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>または手動で3つ選択:</div>
                <CraftSelector equipment={equipment} loading={loading} sortKey={sortKey} onRequestCraft={(ids) => {
                  const items = ids.map(id => equipment.find(e => e.id === id)).filter(Boolean)
                  const rarity = items[0]?.weapons.rarity
                  setCraftConfirm({ type:'equipment', items, selectedIds:ids, rarity })
                }} />
              </div>
            )}
            {craftTab === 'stone' && (
              <div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>同ランクの強化石3つ→1つ上のランクの強化石1つに加工できます</div>
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
                      <button onClick={() => setCraftConfirm({ type:'stone', rarity })} disabled={!canCraft || loading}
                        style={{ padding:'4px 10px', background: canCraft ? '#1a1400' : '#001', border:`1px solid ${canCraft ? '#aa8800' : '#002244'}`, color: canCraft ? '#ffcc00' : '#334455', cursor: canCraft ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>加工する</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* 再評価タブ */}
        {tab === 'reeval' && (
          <div>
            <div style={{ display:'flex', gap:'16px', marginBottom:'8px', fontSize:'11px' }}>
              <span style={{color:'#446688'}}>再評価依頼書: <span style={{color:'#ffcc00'}}>{playerItems.find(pi=>pi.items?.name==='再評価依頼書')?.quantity||0}枚</span></span>
              <span style={{color:'#446688'}}>再鑑定依頼書: <span style={{color:'#88ccff'}}>{playerItems.find(pi=>pi.items?.name==='再鑑定依頼書')?.quantity||0}枚</span></span>
            </div>
            <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px' }}>再評価：全ボーナス再抽選　再鑑定：種類固定で値のみ再抽選（要：再評価済み）　古びた○○は対象外</div>
            {slots.map(slot => {
              const slotItems = sortEquipment(equipment.filter(e => e.slot === slot), sortKey)
              if (slotItems.length === 0) return null
              return (
                <div key={slot} style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#aa6644', fontSize:'11px', marginBottom:'6px' }}>── {SLOT_LABELS[slot]} ──</div>
                  {slotItems.map(item => {
                    const w = item.weapons
                    const isArtifactBase = ARTIFACT_BASE_NAMES.includes(w.name)
                    const rarity = w.rarity
                    const needed = RE_EVAL_SHEETS[rarity]
                    const evalOwned = playerItems.find(pi=>pi.items?.name==='再評価依頼書')?.quantity||0
                    const appOwned = playerItems.find(pi=>pi.items?.name==='再鑑定依頼書')?.quantity||0
                    const canEval = !isArtifactBase && evalOwned >= needed
                    const canApp = !isArtifactBase && !!item.bonus_slots_json && appOwned >= needed
                    const hasBonus = item.bonus_atk>0||item.bonus_def>0||item.bonus_matk>0||item.bonus_mdef>0||item.bonus_spd>0||item.bonus_hp>0||item.bonus_mp>0||(item.bonus_crit||0)>0||(item.bonus_evasion||0)>0||(item.bonus_hit||0)>0||(item.bonus_effect&&item.bonus_effect!=='artifact')
                    return (
                      <div key={item.id} style={{ border:'1px solid #002244', background:'#001028', padding:'10px', marginBottom:'6px', opacity: isArtifactBase ? 0.5 : 1 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ fontSize:'9px', padding:'1px 4px', color:RARITY_COLORS[rarity], border:`1px solid ${RARITY_COLORS[rarity]}` }}>{RARITY_LABELS[rarity]}</span>
                            <span style={{ color:RARITY_COLORS[rarity], fontSize:'12px' }}>{w.name}{(item.enhance_plus||0)>0?` +${item.enhance_plus}`:''}</span>
                            {item.equipped && <span style={{color:'#0088ff',fontSize:'10px'}}>装備中</span>}
                            {isArtifactBase && <span style={{color:'#446688',fontSize:'10px'}}>対象外</span>}
                          </div>
                          {!isArtifactBase && (
                            <div style={{ display:'flex', gap:'4px' }}>
                              <button onClick={() => doReEval(item)} disabled={!canEval||loading}
                                style={{ padding:'3px 8px', background:canEval?'#1a0800':'#001', border:`1px solid ${canEval?'#aa6644':'#002244'}`, color:canEval?'#aa6644':'#334455', cursor:canEval?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                                再評価 {needed}枚
                              </button>
                              <button onClick={() => doReAppraise(item)} disabled={!canApp||loading}
                                style={{ padding:'3px 8px', background:canApp?'#001840':'#001', border:`1px solid ${canApp?'#4466aa':'#002244'}`, color:canApp?'#88aaff':'#334455', cursor:canApp?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                                再鑑定 {needed}枚
                              </button>
                            </div>
                          )}
                        </div>
                        {hasBonus ? (
                          <div style={{ fontSize:'10px', color:'#ffaa00' }}>
                            ボーナス:
                            {item.bonus_atk>0 && ` 攻撃力+${item.bonus_atk}`}
                            {item.bonus_def>0 && ` 防御力+${item.bonus_def}`}
                            {item.bonus_matk>0 && ` 特殊攻撃力+${item.bonus_matk}`}
                            {item.bonus_mdef>0 && ` 特殊防御力+${item.bonus_mdef}`}
                            {item.bonus_spd>0 && ` 素早さ+${item.bonus_spd}`}
                            {item.bonus_hp>0 && ` HP+${item.bonus_hp}`}
                            {item.bonus_mp>0 && ` MP+${item.bonus_mp}`}
                            {(item.bonus_crit||0)>0 && ` クリティカル率+${item.bonus_crit}%`}
                            {(item.bonus_evasion||0)>0 && ` 回避率+${item.bonus_evasion}%`}
                            {(item.bonus_hit||0)>0 && ` 命中率+${item.bonus_hit}%`}
                            {item.bonus_effect && item.bonus_effect !== 'artifact' && ` ${getEffectLabel(item.bonus_effect)}`}
                          </div>
                        ) : (
                          !isArtifactBase && <div style={{fontSize:'10px',color:'#334455'}}>ボーナスなし（再評価で付与）</div>
                        )}
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

function CraftSelector({ equipment, loading, sortKey, onRequestCraft }) {
  const [selected, setSelected] = useState([])
  const unequipped = sortEquipment(equipment.filter(e => !e.equipped), sortKey || 'obtained_asc')

  const toggle = (id) => {
    if (selected.includes(id)) { setSelected(selected.filter(s => s !== id)); return }
    if (selected.length >= 3) return
    if (selected.length > 0) {
      const firstItem = unequipped.find(e => e.id === selected[0])
      const thisItem = unequipped.find(e => e.id === id)
      if (firstItem?.weapons.rarity !== thisItem?.weapons.rarity) return
    }
    setSelected([...selected, id])
  }

  const selectedRarity = selected.length > 0 ? unequipped.find(e => e.id === selected[0])?.weapons.rarity : null

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', padding:'8px', border:'1px solid #003366', background:'#001028' }}>
        <div style={{ fontSize:'11px', color:'#446688' }}>
          選択中: <span style={{color: selected.length===3?'#44ff88':'#ffcc00'}}>{selected.length}/3</span>
          {selectedRarity && <span style={{color: RARITY_COLORS[selectedRarity], marginLeft:'8px'}}>{RARITY_LABELS[selectedRarity]}ランク</span>}
          {selectedRarity && <span style={{color:'#446688', marginLeft:'8px'}}>→ {STONE_NAMES[selectedRarity]}</span>}
        </div>
        <div style={{ display:'flex', gap:'6px' }}>
          <button onClick={() => setSelected([])} disabled={selected.length===0}
            style={{ padding:'4px 8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>クリア</button>
          <button onClick={() => { onRequestCraft(selected); setSelected([]) }} disabled={selected.length!==3 || loading}
            style={{ padding:'4px 10px', background: selected.length===3?'#1a1400':'#001', border:`1px solid ${selected.length===3?'#aa8800':'#002244'}`, color: selected.length===3?'#ffcc00':'#334455', cursor: selected.length===3?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>加工する</button>
        </div>
      </div>
      {unequipped.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>加工できる装備がありません</div>}
      {unequipped.map(item => {
        const w = item.weapons
        const isSelected = selected.includes(item.id)
        const isDiffRarity = selected.length > 0 && !isSelected && unequipped.find(e => e.id === selected[0])?.weapons.rarity !== w.rarity
        const isDisabled = (!isSelected && selected.length >= 3) || isDiffRarity
        return (
          <div key={item.id} onClick={() => !isDisabled && toggle(item.id)}
            style={{ border:`2px solid ${isSelected ? RARITY_COLORS[w.rarity] : '#002244'}`, background: isSelected ? '#1a1200' : '#001028', padding:'8px', marginBottom:'4px', cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.4 : 1, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              {isSelected && <span style={{color:'#ffcc00', fontSize:'12px'}}>✓</span>}
              <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}` }}>{RARITY_LABELS[w.rarity]}</span>
              <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'12px' }}>{w.name}</span>
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
