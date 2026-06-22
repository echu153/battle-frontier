import { useEffect, useState, useRef } from 'react'
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

// ランク別強化費用 [+0〜+16]（SSを基準に倍率適用）
const ENHANCE_COST_BY_RANK = {
  f:   [0,     80,    400,    800,   2400,   4000,   6000,   8000,  10400,  12800,  16000,  19200,  24000,  28000,  32000,  36000,  40000],
  e:   [0,    160,    800,   1600,   4800,   8000,  12000,  16000,  20800,  25600,  32000,  38400,  48000,  56000,  64000,  72000,  80000],
  d:   [0,    400,   2000,   4000,  12000,  20000,  30000,  40000,  52000,  64000,  80000,  96000, 120000, 140000, 160000, 180000, 200000],
  c:   [0,    800,   4000,   8000,  24000,  40000,  60000,  80000, 104000, 128000, 160000, 192000, 240000, 280000, 320000, 360000, 400000],
  b:   [0,   1600,   8000,  16000,  48000,  80000, 120000, 160000, 208000, 256000, 320000, 384000, 480000, 560000, 640000, 720000, 800000],
  a:   [0,   4000,  20000,  40000, 120000, 200000, 300000, 400000, 520000, 640000, 800000, 960000,1200000,1400000,1600000,1800000,2000000],
  s:   [0,   7000,  35000,  70000, 210000, 350000, 525000, 700000, 910000,1120000,1400000,1680000,2100000,2450000,2800000,3150000,3500000],
  ss:  [0,  10000,  50000, 100000, 300000, 500000, 750000,1000000,1300000,1600000,2000000,2400000,3000000,3500000,4000000,4500000,5000000],
  sss: [0,  20000, 100000, 200000, 600000,1000000,1500000,2000000,2600000,3200000,4000000,4800000,6000000,7000000,8000000,9000000,10000000],
}
const ENHANCE_RATE = { 3:90, 4:80, 5:70, 6:50, 7:40, 8:30, 9:20, 10:10, 11:5, 12:3, 13:2, 14:1, 15:0.5, 16:0.1 }
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
  const craftBusyRef = useRef(false)  // 加工/合成の二重実行ガード（連打対策・stateより前に同期判定）
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [selectedItem, setSelectedItem] = useState(null)
  const [craftTab, setCraftTab] = useState('equipment')
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('equipSortKey') || 'obtained_asc')
  const [craftConfirm, setCraftConfirm] = useState(null) // { type:'equipment'|'stone', items?, selectedIds?, rarity }
  const [enhanceResult, setEnhanceResult] = useState(null) // { ok, title, text } 強化ポップアップの結果表示
  const [matSource, setMatSource] = useState('equip')       // 強化素材の選択: 'equip'=同名装備 / 'stone'=強化石
  const [craftTimes, setCraftTimes] = useState(1)            // 加工(装備→強化石)の作成回数（1回=装備3個→強化石1個）

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const { data: eq } = await supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id).order('obtained_at')
    setEquipment((eq || []).filter(e => !e.listed))  // 取引所に出品中の装備は隠す
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

  const doEnhance = async (item, source = 'equip') => {
    setLoading(true)
    const currentPlus = item.enhance_plus || 0
    const nextPlus = currentPlus + 1
    const rarity = item.weapons.rarity
    const rankCosts = ENHANCE_COST_BY_RANK[rarity] || ENHANCE_COST_BY_RANK.ss
    const cost = rankCosts[nextPlus] || rankCosts[rankCosts.length - 1]
    const materialCount = MATERIAL_COUNT(currentPlus)

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
      e.weapons?.name === item.weapons.name && e.id !== item.id && !e.equipped && !e.is_favorite && !e.listed
      && !(e.enhance_plus > 0)  // 強化済み(+1以上)の装備は素材にしない
    )
    // 選択した素材だけで足りているか判定（同名装備 or 強化石）
    if (source === 'stone') {
      if (serverStoneCount < materialCount) {
        showMessage(`強化石(${RARITY_LABELS[rarity]})が足りません！（${serverStoneCount}/${materialCount}個）`, '#ff4444')
        setLoading(false); return
      }
    } else {
      if (serverSameItems.length < materialCount) {
        showMessage(`同名装備が足りません！（${serverSameItems.length}/${materialCount}個）`, '#ff4444')
        setLoading(false); return
      }
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

    // 選択した素材のみ消費（同名装備 or 強化石）
    const useEquipCount = source === 'stone' ? 0 : materialCount
    const useStoneCount = source === 'stone' ? materialCount : 0
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
    if (ENHANCE_RATE[nextPlus] !== undefined) {
      const rate = ENHANCE_RATE[nextPlus]
      success = Math.random() * 100 < rate
    }

    let resultPlus = currentPlus
    if (success) {
      await supabase.from('player_equipment').update({ enhance_plus: nextPlus }).eq('id', item.id)
      resultPlus = nextPlus
      setEnhanceResult({ ok: true, title: '✨ 強化成功！', text: `${item.weapons.name} が +${nextPlus} になった！` })
    } else if (nextPlus >= 11) {
      const newPlus = Math.max(0, currentPlus - 1)
      await supabase.from('player_equipment').update({ enhance_plus: newPlus }).eq('id', item.id)
      resultPlus = newPlus
      setEnhanceResult({ ok: false, title: '💔 強化失敗…', text: `${item.weapons.name} が +${newPlus} に下落した…` })
    } else {
      setEnhanceResult({ ok: false, title: '💔 強化失敗…', text: `${item.weapons.name} は変化しなかった` })
    }

    await supabase.from('enhance_logs').insert({
      player_id: user.id,
      weapon_name: item.weapons.name,
      from_plus: currentPlus,
      to_plus: resultPlus,
      success,
    })
    const { data: pr } = await supabase.from('profiles').select('enhance_success_count,enhance_fail_count').eq('id', user.id).single()
    if (pr) {
      if (success) await supabase.from('profiles').update({ enhance_success_count: (pr.enhance_success_count||0)+1 }).eq('id', user.id)
      else await supabase.from('profiles').update({ enhance_fail_count: (pr.enhance_fail_count||0)+1 }).eq('id', user.id)
    }

    await fetchAll()
    setLoading(false)
  }

  const craftStoneFromSelectedItems = async (selectedIds) => {
    if (craftBusyRef.current) return  // 連打ガード（state更新前の二重実行を同期的に防ぐ）
    craftBusyRef.current = true
    setLoading(true)
    try {
    const selected = selectedIds.map(id => equipment.find(e => e.id === id)).filter(Boolean)
    if (selected.length < 3 || selected.length % 3 !== 0) { showMessage('装備は3の倍数で選択してください！', '#ff4444'); return }
    const rarity = selected[0].weapons.rarity
    if (!selected.every(e => e.weapons.rarity === rarity)) { showMessage('同じランクの装備を選択してください！', '#ff4444'); return }
    if (selected.some(e => e.is_favorite)) { showMessage('お気に入り装備は加工できません！（★を解除してください）', '#ff4444'); return }
    if (selected.some(e => e.enhance_plus > 0)) { showMessage('強化済み(+1以上)の装備は加工できません！', '#ff4444'); return }
    if (selected.some(e => e.is_bound)) { showMessage('帰属アイテム（取引所で入手）は加工できません！', '#ff4444'); return }
    // 消費する装備を「未強化のまま現存する」条件付きで削除し、実際に削除できた数だけ加工する
    // （連打・別端末で同じ装備を二重消費→石を二重生成するのを防ぐ）
    let deleted = 0
    for (const item of selected) {
      const { data: del } = await supabase.from('player_equipment').delete()
        .eq('id', item.id).eq('enhance_plus', 0).select('id')
      if (del && del.length > 0) deleted++
    }
    const count = Math.floor(deleted / 3)   // 実際に消費できた装備3個=強化石1個
    if (count <= 0) { showMessage('加工に失敗しました（対象装備が見つかりません）', '#ff4444'); await fetchAll(); return }
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    if (stoneItem) {
      const existing = playerItems.find(pi => pi.item_id === stoneItem.id)
      if (existing) await supabase.from('player_items').update({ quantity: (existing.quantity||1)+count }).eq('id', existing.id)
      else await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: count, equipped: false })
    }
    showMessage(`✨ ${stoneName} を${count}つ作成した！`, '#ffcc00')
    await fetchAll()
    } finally { setLoading(false); craftBusyRef.current = false }
  }

  const craftStoneFromStones = async (rarity) => {
    if (craftBusyRef.current) return
    craftBusyRef.current = true
    setLoading(true)
    try {
    const stoneIdx = STONE_RANKS.indexOf(rarity)
    if (stoneIdx >= STONE_RANKS.length - 1) { showMessage('これ以上ランクアップできません！', '#ff4444'); return }
    const stoneName = STONE_NAMES[rarity]
    const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
    const existing = playerItems.find(pi => pi.item_id === stoneItem?.id)
    if (!existing || (existing.quantity||0) < 3) { showMessage(`${stoneName}が3つ必要です！（所持${existing?.quantity||0}個）`, '#ff4444'); return }
    // 消費を楽観ロック：所持数が読み取り時と一致する時だけ-3（連打/別端末での二重消費を防ぐ）
    const newQty = (existing.quantity||0) - 3
    const { data: consumed } = await supabase.from('player_items')
      .update({ quantity: newQty }).eq('id', existing.id).eq('quantity', existing.quantity).select('id')
    if (!consumed || consumed.length === 0) { showMessage('合成に失敗しました。もう一度お試しください。', '#ff4444'); await fetchAll(); return }
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', existing.id).eq('quantity', 0)
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
    } finally { setLoading(false); craftBusyRef.current = false }
  }


  // 再評価：種類固定で値のみ再抽選（要：再鑑定済み＝スロット生成済み）
  const doReEval = async (item) => {
    setLoading(true)
    const rarity = item.weapons.rarity
    const needed = RE_EVAL_SHEETS[rarity]
    const sheetItem = playerItems.find(pi => pi.items?.name === '再評価依頼書')
    const owned = sheetItem?.quantity || 0
    if (owned < needed) { showMessage(`再評価依頼書が足りません！（所持${owned}枚・必要${needed}枚）`, '#ff4444'); setLoading(false); return }
    if (!item.bonus_slots_json) { showMessage('まず再鑑定を行ってください', '#ff4444'); setLoading(false); return }
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
    const cols = slotsToColumns(newSlots)
    // アーティファクト(古びた○○の進化先)の特殊能力は消さない
    if (item.bonus_effect === 'artifact') cols.bonus_effect = 'artifact'
    await supabase.from('player_equipment').update(cols).eq('id', item.id)
    const newQty = owned - needed
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', sheetItem.id)
    else await supabase.from('player_items').update({ quantity: newQty }).eq('id', sheetItem.id)
    showMessage(`🔍 ${item.weapons.name} のボーナス値を再評価しました！`, '#88ccff')
    await fetchAll()
    setLoading(false)
  }

  // 再鑑定：全ボーナス再抽選（種類・値ともに引き直し）
  const doReAppraise = async (item) => {
    setLoading(true)
    const rarity = item.weapons.rarity
    const needed = RE_EVAL_SHEETS[rarity]
    const sheetItem = playerItems.find(pi => pi.items?.name === '再鑑定依頼書')
    const owned = sheetItem?.quantity || 0
    if (owned < needed) { showMessage(`再鑑定依頼書が足りません！（所持${owned}枚・必要${needed}枚）`, '#ff4444'); setLoading(false); return }
    const newSlots = generateBonusSlots(rarity)
    const cols = slotsToColumns(newSlots)
    if (item.bonus_effect === 'artifact') cols.bonus_effect = 'artifact'
    await supabase.from('player_equipment').update(cols).eq('id', item.id)
    const newQty = owned - needed
    if (newQty <= 0) await supabase.from('player_items').delete().eq('id', sheetItem.id)
    else await supabase.from('player_items').update({ quantity: newQty }).eq('id', sheetItem.id)
    showMessage(`✨ ${item.weapons.name} のボーナスを再鑑定しました！`, '#ffcc00')
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
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'10px' }}>以下の装備{craftConfirm.items.length}個を消費して強化石に加工します</div>
                <div style={{ marginBottom:'12px', maxHeight:'34vh', overflowY:'auto' }}>
                  {craftConfirm.items.map(item => (
                    <div key={item.id} style={{ color:'#88ccff', fontSize:'11px', padding:'5px 8px', borderBottom:'1px solid #002244', display:'flex', alignItems:'center', gap:'6px' }}>
                      <span style={{ fontSize:'9px', padding:'1px 4px', color:RARITY_COLORS[item.weapons.rarity], border:`1px solid ${RARITY_COLORS[item.weapons.rarity]}` }}>{RARITY_LABELS[item.weapons.rarity]}</span>
                      <span>{item.weapons.name}{(item.enhance_plus||0)>0?` +${item.enhance_plus}`:''}</span>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign:'center', color:'#446688', fontSize:'11px', marginBottom:'4px' }}>↓</div>
                <div style={{ textAlign:'center', color:'#ffcc00', fontSize:'13px', marginBottom:'16px' }}>
                  {STONE_NAMES[craftConfirm.rarity]} × {Math.floor((craftConfirm.items?.length || 0) / 3)}
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#aa6644', fontSize:'14px', marginBottom:'4px' }}>⚒ 鍛冶屋</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span></div>

        {message && <div style={{ color: messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>{message}</div>}

        {/* 強化ポップアップ */}
        {selectedItem && (() => {
          const item = equipment.find(e => e.id === selectedItem.id) || selectedItem
          const w = item.weapons
          const plus = item.enhance_plus || 0
          const nextPlus = plus + 1
          const rankCosts = ENHANCE_COST_BY_RANK[w.rarity] || ENHANCE_COST_BY_RANK.ss
          const cost = rankCosts[nextPlus] || rankCosts[rankCosts.length - 1]
          const materialCount = MATERIAL_COUNT(plus)
          const sameCount = equipment.filter(e => e.weapons.name === w.name && e.id !== item.id && !e.equipped && !e.is_favorite && !(e.enhance_plus > 0)).length
          const stoneCount = getStoneCount(w.rarity)
          // 選択中の素材で足りているか
          const matEnough = matSource === 'stone' ? stoneCount >= materialCount : sameCount >= materialCount
          const canEnhance = profile.gold >= cost && matEnough
          const successRate = ENHANCE_RATE[nextPlus] !== undefined ? ENHANCE_RATE[nextPlus] : 100
          const nextEnhanced = calcEnhancedStats(w, nextPlus)
          const closeModal = () => { setSelectedItem(null); setEnhanceResult(null) }
          return (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,4,16,0.85)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
              <div style={{ background:'#0a0800', border:'1px solid #aa6644', padding:'20px', maxWidth:'380px', width:'100%', fontFamily:'monospace' }}>
                {message && <div style={{ color: messageColor, fontSize:'11px', padding:'6px', border:`1px solid ${messageColor}`, marginBottom:'10px', textAlign:'center' }}>{message}</div>}
                {enhanceResult ? (
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'30px', marginBottom:'10px' }}>{enhanceResult.ok ? '✨' : '💔'}</div>
                    <div style={{ color: enhanceResult.ok ? '#ffcc00' : '#ff4444', fontSize:'16px', letterSpacing:'2px', marginBottom:'10px' }}>
                      {enhanceResult.ok ? '強化成功！' : '強化失敗…'}
                    </div>
                    <div style={{ color: enhanceResult.ok ? '#ffeeaa' : '#cc8888', fontSize:'13px', marginBottom:'18px' }}>{enhanceResult.text}</div>
                    <div style={{ display:'flex', gap:'8px', justifyContent:'center' }}>
                      <button onClick={() => setEnhanceResult(null)} disabled={loading}
                        style={{ padding:'8px 16px', background:'#1a0800', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        続けて鍛錬する
                      </button>
                      <button onClick={closeModal} disabled={loading}
                        style={{ padding:'8px 16px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        閉じる
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ color:'#aa6644', fontSize:'13px', marginBottom:'10px', textAlign:'center' }}>⚒ 武器強化</div>
                    <div style={{ textAlign:'center', marginBottom:'12px' }}>
                      <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[w.rarity], border:`1px solid ${RARITY_COLORS[w.rarity]}`, marginRight:'6px' }}>{RARITY_LABELS[w.rarity]}</span>
                      <span style={{ color: RARITY_COLORS[w.rarity], fontSize:'14px' }}>{w.name}{plus > 0 ? ` +${plus}` : ''}</span>
                      <span style={{ color:'#446688', fontSize:'12px' }}> → </span>
                      <span style={{ color:'#ffcc00', fontSize:'14px' }}>+{nextPlus}</span>
                    </div>
                    <div style={{ fontSize:'10px', color:'#88ccff', marginBottom:'8px' }}>
                      強化後ステータス:
                      {nextEnhanced.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}> 攻撃力+{nextEnhanced.atk_bonus}</span>}
                      {nextEnhanced.def_bonus  > 0 && <span style={{color:'#88aaff'}}> 防御力+{nextEnhanced.def_bonus}</span>}
                      {nextEnhanced.matk_bonus > 0 && <span style={{color:'#cc44ff'}}> 特殊攻撃力+{nextEnhanced.matk_bonus}</span>}
                      {nextEnhanced.mdef_bonus > 0 && <span style={{color:'#44ccff'}}> 特殊防御力+{nextEnhanced.mdef_bonus}</span>}
                      {nextEnhanced.spd_bonus  > 0 && <span style={{color:'#ff8844'}}> 素早さ+{nextEnhanced.spd_bonus}</span>}
                      {nextEnhanced.hp_bonus   > 0 && <span style={{color:'#44ff88'}}> HP+{nextEnhanced.hp_bonus}</span>}
                      {nextEnhanced.mp_bonus   > 0 && <span style={{color:'#4488ff'}}> MP+{nextEnhanced.mp_bonus}</span>}
                    </div>
                    <div style={{ fontSize:'10px', color:'#446688', marginBottom:'2px' }}>必要G: <span style={{color: profile.gold >= cost ? '#ffcc00' : '#ff4444'}}>{cost.toLocaleString()}G</span>（所持 {profile.gold.toLocaleString()}G）</div>
                    <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>必要素材: <span style={{color:'#aa6644'}}>{materialCount}個</span>（どちらかを選択）</div>
                    {/* 素材の選択：同名装備 or 強化石 */}
                    <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
                      {[
                        { key:'equip', label:`同名装備 ${sameCount}/${materialCount}`, ok: sameCount >= materialCount },
                        { key:'stone', label:`${STONE_NAMES[w.rarity]} ${stoneCount}/${materialCount}`, ok: stoneCount >= materialCount },
                      ].map(opt => {
                        const on = matSource === opt.key
                        return (
                          <button key={opt.key} onClick={() => setMatSource(opt.key)}
                            style={{ flex:1, padding:'7px 4px', background: on ? '#1a1000' : '#000818', border:`1px solid ${on ? '#ffcc44' : '#223344'}`, color: on ? '#ffcc44' : (opt.ok ? '#88aacc' : '#665544'), cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                            {on ? '● ' : '○ '}{opt.label}{!opt.ok && ' (不足)'}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ fontSize:'10px', color:'#446688', marginBottom:'12px' }}>
                      成功率: <span style={{color: successRate >= 50 ? '#44ff88' : successRate >= 20 ? '#ffcc00' : '#ff4444'}}>{successRate}%</span>
                      {nextPlus >= 11 && <span style={{color:'#ff4444'}}> ⚠ 失敗すると+が1下がる</span>}
                    </div>
                    <button onClick={() => doEnhance(item, matSource)} disabled={!canEnhance || loading}
                      style={{ width:'100%', padding:'10px', background: canEnhance ? '#1a0800' : '#001', border:`1px solid ${canEnhance ? '#aa6644' : '#002244'}`, color: canEnhance ? '#ffcc88' : '#334455', cursor: canEnhance ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
                      {loading ? '鍛錬中...' : '⚒ 鍛錬する'}
                    </button>
                    <button onClick={closeModal} disabled={loading}
                      style={{ width:'100%', padding:'7px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                      やめる
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })()}

        <div style={{ display:'flex', gap:'4px', marginBottom:'8px', flexWrap:'wrap' }}>
          {[{id:'enhance', label:'強化'}, {id:'craft', label:'加工'}, {id:'reeval', label:'再鑑定/再評価'}].map(t => (
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
              同じ名前の装備または同ランクの強化石を素材に使って強化できます。※古びた○○は強化不可。+1以上に強化済みの装備は素材になりません
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
                    const rankCosts = ENHANCE_COST_BY_RANK[w.rarity] || ENHANCE_COST_BY_RANK.ss
                    const cost = rankCosts[nextPlus] || rankCosts[rankCosts.length - 1]
                    const materialCount = MATERIAL_COUNT(plus)
                    const sameCount = equipment.filter(e => e.weapons.name === w.name && e.id !== item.id && !e.equipped && !e.is_favorite && !(e.enhance_plus > 0)).length
                    const stoneCount = getStoneCount(w.rarity)
                    const totalMaterials = sameCount + stoneCount
                    const canEnhance = !isArtifactBase && profile.gold >= cost && totalMaterials >= materialCount
                    const successRate = ENHANCE_RATE[nextPlus] !== undefined ? ENHANCE_RATE[nextPlus] : 100
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
                            <button onClick={() => { setSelectedItem(item); setEnhanceResult(null); setMatSource(sameCount >= materialCount ? 'equip' : (stoneCount >= materialCount ? 'stone' : 'equip')) }}
                              style={{ padding:'3px 8px', background:'#001', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                              強化する
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

                {/* ランクボタン：ランダム選択（作成回数ぶん一気に） */}
                <div style={{ border:'1px solid #002244', background:'#000818', padding:'10px', marginBottom:'12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                    <span style={{ color:'#446688', fontSize:'10px' }}>作成回数</span>
                    <select value={craftTimes} onChange={e=>setCraftTimes(Number(e.target.value))}
                      style={{ background:'#001028', border:'1px solid #003366', color:'#ffcc00', fontFamily:'monospace', fontSize:'11px', padding:'2px 6px' }}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}回</option>)}
                    </select>
                    <span style={{ color:'#446688', fontSize:'9px' }}>（1回＝装備3個→強化石1個）</span>
                  </div>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>ランク指定でランダムに選んで一気に加工</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                    {RARITY_ORDER.map(rarity => {
                      const avail = sortEquipment(equipment.filter(e => !e.equipped && !e.is_favorite && !(e.enhance_plus > 0) && e.weapons.rarity === rarity), sortKey)
                      const maxTimes = Math.floor(avail.length / 3)
                      const canPick = maxTimes >= 1
                      const times = Math.min(craftTimes, maxTimes)
                      return (
                        <button key={rarity} onClick={() => {
                          const shuffled = [...avail].sort(() => Math.random() - 0.5)
                          const picked = shuffled.slice(0, times * 3)
                          setCraftConfirm({ type:'equipment', items:picked, selectedIds:picked.map(i=>i.id), rarity })
                        }} disabled={!canPick}
                          style={{ padding:'5px 9px', background:canPick?'#0d1a00':'#001', border:`1px solid ${canPick?RARITY_COLORS[rarity]:'#002244'}`, color:canPick?RARITY_COLORS[rarity]:'#334455', cursor:canPick?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                          {RARITY_LABELS[rarity]} <span style={{fontSize:'9px'}}>({avail.length}→{maxTimes})</span>
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ color:'#334455', fontSize:'9px', marginTop:'6px' }}>※ 各ランクの(所持数→最大作成数)。選んだ回数が最大を超える場合は最大数まで加工します。</div>
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
              <span style={{color:'#446688'}}>再鑑定依頼書: <span style={{color:'#88ccff'}}>{playerItems.find(pi=>pi.items?.name==='再鑑定依頼書')?.quantity||0}枚</span></span>
              <span style={{color:'#446688'}}>再評価依頼書: <span style={{color:'#ffcc00'}}>{playerItems.find(pi=>pi.items?.name==='再評価依頼書')?.quantity||0}枚</span></span>
            </div>
            <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px' }}>再鑑定：全ボーナス再抽選　再評価：種類固定で値のみ再抽選（要：再鑑定済み）　古びた○○は対象外</div>
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
                    // 再評価=値のみ再抽選(要スロット)、再鑑定=全再抽選(前提なし)
                    const canEval = !isArtifactBase && !!item.bonus_slots_json && evalOwned >= needed
                    const canApp = !isArtifactBase && appOwned >= needed
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
                              <button onClick={() => doReAppraise(item)} disabled={!canApp||loading}
                                style={{ padding:'3px 8px', background:canApp?'#001840':'#001', border:`1px solid ${canApp?'#4466aa':'#002244'}`, color:canApp?'#88aaff':'#334455', cursor:canApp?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                                再鑑定 {needed}枚
                              </button>
                              <button onClick={() => doReEval(item)} disabled={!canEval||loading}
                                style={{ padding:'3px 8px', background:canEval?'#1a0800':'#001', border:`1px solid ${canEval?'#aa6644':'#002244'}`, color:canEval?'#aa6644':'#334455', cursor:canEval?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                                再評価 {needed}枚
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
                          !isArtifactBase && <div style={{fontSize:'10px',color:'#334455'}}>ボーナスなし（再鑑定で付与）</div>
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
  const unequipped = sortEquipment(equipment.filter(e => !e.equipped && !e.is_favorite && !(e.enhance_plus > 0)), sortKey || 'obtained_asc')

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
