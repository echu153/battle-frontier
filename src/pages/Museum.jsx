import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// ===== データ定義 =====

const BOSS_DROPS = new Set([
  'スライムの指輪','蒼粘剣','略奪者の短剣','影踏みのブーツ',
  '古代魔導コア','虚無の杖','海竜の鱗','アクアクラウン',
  '雷鷲の爪牙','嵐の重装甲','絶零の魔導砲','フロストバーンの聖鎧',
  '深紅の牙輪','深紅の魔眼石','インフェルノバスティオン',
  'ウラノスの天砲','覇龍の聖鎧','蒼天龍の指輪',
  'ぷよぷよロッド','怪盗の指輪','結晶グリーブ',
])

const BOSS_STAT = {
  'スライムの指輪':'hp_max','蒼粘剣':'hp_max',
  '略奪者の短剣':'spd','影踏みのブーツ':'spd',
  '古代魔導コア':'mp_max','虚無の杖':'matk',
  '海竜の鱗':'atk_matk','アクアクラウン':'hp_max',
  '雷鷲の爪牙':'atk','嵐の重装甲':'def',
  '絶零の魔導砲':'matk','フロストバーンの聖鎧':'mdef',
  '深紅の牙輪':'atk','深紅の魔眼石':'matk','インフェルノバスティオン':'def',
  'ウラノスの天砲':'atk_matk','覇龍の聖鎧':'def','蒼天龍の指輪':'atk_matk',
  'ぷよぷよロッド':'matk','怪盗の指輪':'atk_matk','結晶グリーブ':'def',
}

// エリア4以降のレアドロップ（ボーナス 2/3/6 固定）
const RARE_DROPS = new Set([
  '蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符',
  '雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪',
  '白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠',
  'サラマンダーブレード','フェニックスワンド','煉獄のコデックス','溶鉄のクラウン','ドレイクアーマー','ヴァルカンブーツ','業炎の指輪',
  '蒼天大剣','天翔短剣','天穿弓','蒼天霊杖','天空霊典','蒼穹の鎧','天翼の護符',
])

const STAT_LABELS = {
  atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力',
  spd:'素早さ', hp_max:'HP', mp_max:'MP', atk_matk:'攻撃力+特殊攻撃力',
}

// ボス別枠（コンプリートボーナスなし）
const BOSS_GROUP = {
  id: 'boss', name: 'ボスドロップ', color: '#ffcc00',
  items: [
    'スライムの指輪','蒼粘剣',
    '略奪者の短剣','影踏みのブーツ',
    '古代魔導コア','虚無の杖',
    '海竜の鱗','アクアクラウン',
    '雷鷲の爪牙','嵐の重装甲',
    '絶零の魔導砲','フロストバーンの聖鎧',
    '深紅の牙輪','深紅の魔眼石','インフェルノバスティオン',
    'ウラノスの天砲','覇龍の聖鎧','蒼天龍の指輪',
    'ぷよぷよロッド','怪盗の指輪','結晶グリーブ',
  ],
}

const MUSEUM_GROUPS = [
  {
    id: 'beginner', name: '初級エリア（エリア1〜3）', color: '#4488ff',
    items: [
      '木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス',
      'ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書',
      '鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本','戦士の指輪','略奪の腕輪',
      '古代の護符','秘術の首飾り',
    ],
    completeBonus: { hp_max:100, mp_max:40 },
    areaMultiplier: 1,
  },
  {
    id: 'area4', name: 'エリア4：蒼海の入り江', color: '#44aaff',
    items: [
      '重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪',
      '蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符',
    ],
    completeBonus: { atk:10, def:10, matk:10, mdef:10 },
    areaMultiplier: 2,
  },
  {
    id: 'area5', name: 'エリア5：巨峰山脈', color: '#ffaa44',
    items: [
      '山岳の斧','岩砕の拳','霞散弾銃','嵐のオーブ','峰岳の兜','岩石鎧','山岳の靴','岩石の護符',
      '雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪',
    ],
    completeBonus: { def:20, mdef:20, hp_max:100 },
    areaMultiplier: 3,
  },
  {
    id: 'area6', name: 'エリア6：白銀の霊峰', color: '#88ddff',
    items: [
      '氷刃の剣','霜穿の槍','吹雪の弓','氷晶の杖','凍月刀','氷晶の護符',
      '白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠',
    ],
    completeBonus: { def:30, mdef:30, mp_max:50 },
    areaMultiplier: 4,
  },
  {
    id: 'area7', name: 'エリア7：煉獄火山', color: '#ff6644',
    items: [
      '業火の短剣','炎のワンド','煉獄魔導書','炎の兜','溶岩鎧','紅蓮の靴','溶岩の指輪',
      'サラマンダーブレード','フェニックスワンド','煉獄のコデックス','溶鉄のクラウン','ドレイクアーマー','ヴァルカンブーツ','業炎の指輪',
    ],
    completeBonus: { atk:30, matk:30, hp_max:200 },
    areaMultiplier: 5,
  },
  {
    id: 'area8', name: 'エリア8：蒼天の浮遊城', color: '#66ccff',
    items: [
      '蒼天の剣','天翼の短剣','疾風天弓','蒼雲の杖','天空魔導書','天羽の鎧','蒼天の指輪',
      '蒼天大剣','天翔短剣','天穿弓','蒼天霊杖','天空霊典','蒼穹の鎧','天翼の護符',
    ],
    completeBonus: { atk:35, matk:35, spd:20 },
    areaMultiplier: 6,
  },
]

const ITEM_GROUP_MAP = {}
for (const g of MUSEUM_GROUPS) {
  for (const item of g.items) ITEM_GROUP_MAP[item] = g.id
}
for (const item of BOSS_GROUP.items) ITEM_GROUP_MAP[item] = 'boss'

const getMuseumStat = (name, weaponType, slot) => {
  if (BOSS_STAT[name]) return BOSS_STAT[name]
  if (['sword','axe','gun','knuckle'].includes(weaponType)) return 'atk'
  if (['spear','katana'].includes(weaponType)) return 'def'
  if (['bow','dagger'].includes(weaponType)) return 'spd'
  if (['staff','wand','tome','orb'].includes(weaponType)) return 'matk'
  if (name.includes('靴') || name.includes('ブーツ') || weaponType === 'boots') return 'spd'
  if (slot === 'armor') return 'def'
  return 'mdef'
}

const getEnhanceTier = (plus) => plus >= 9 ? 2 : plus >= 5 ? 1 : 0
const TIER_LABELS = ['未強化', '+5以上', '+9以上']
const TIER_COLORS = ['#88ccff', '#44ff88', '#ffcc00']
// コンプリートボーナスの強化ティア倍率（2026-08-08: +5=3→4倍 / +9=5→10倍）
const COMPLETE_BONUS_MULT = [1, 4, 10]

// 寄贈ボーナスの全体倍率（コンプリートボーナスには掛からない＝COMPLETE_BONUS_MULT側で完結）
const MUSEUM_BONUS_MULT = 2

// 強化ティア別の素の値。2026-08-08に +5を2倍・+9を5倍へ引き上げ
//   通常 [1,2,4]→[1,4,20] / レア [2,3,6]→[2,6,30] / ボス [8,13,20]→[8,26,100]
// ★変更したら supabase_museum_rebalance_20260808.sql の tier_new / cmult も必ず合わせること
//   （既存プレイヤーの museum_* はそのSQLで全再計算しているため）
const getBonusAmount = (name, groupId, enhancePlus) => {
  const tier = getEnhanceTier(enhancePlus)
  if (BOSS_DROPS.has(name)) return [8, 26, 100][tier] * MUSEUM_BONUS_MULT
  if (RARE_DROPS.has(name)) return [2, 6, 30][tier] * MUSEUM_BONUS_MULT
  const mult = MUSEUM_GROUPS.find(g => g.id === groupId)?.areaMultiplier || 1
  return [1, 4, 20][tier] * mult * MUSEUM_BONUS_MULT
}

const museumCol = (stat) =>
  stat === 'hp_max' ? 'museum_hp' : stat === 'mp_max' ? 'museum_mp' : `museum_${stat}`

const applyBonusToProfile = (profile, stat, amount) => {
  if (stat === 'atk_matk') {
    return {
      museum_atk:  (profile.museum_atk  || 0) + Math.floor(amount / 2),
      museum_matk: (profile.museum_matk || 0) + Math.ceil(amount / 2),
    }
  }
  const actual = stat === 'hp_max' ? amount * 10 : stat === 'mp_max' ? amount * 5 : amount
  const col = museumCol(stat)
  return { [col]: (profile[col] || 0) + actual }
}

const formatBonusText = (stat, amount) => {
  if (stat === 'atk_matk') return `攻撃力+${Math.floor(amount/2)} 特殊攻撃力+${Math.ceil(amount/2)}`
  const actual = stat === 'hp_max' ? amount * 10 : stat === 'mp_max' ? amount * 5 : amount
  return `${STAT_LABELS[stat]}+${actual}`
}

// ===== コンポーネント =====

export default function Museum() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [donations, setDonations] = useState([])
  const [completeBonuses, setCompleteBonuses] = useState([])
  const [tab, setTab] = useState('donate')
  const [loading, setLoading] = useState(false)
  const donateBusyRef = useRef(false)  // 寄贈/コンプ報酬の二重実行ガード（連打対策）
  const [message, setMessage] = useState(null)
  const [expandedGroup, setExpandedGroup] = useState(null)

  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: p }, { data: eq }, { data: don }, { data: cb }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('museum_donations').select('*').eq('player_id', user.id),
      supabase.from('museum_complete_bonuses').select('*').eq('player_id', user.id),
    ])
    setProfile(p)
    setEquipment(eq || [])
    setDonations(don || [])
    setCompleteBonuses(cb || [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const showMsg = (text, color = '#44ff88') => {
    setMessage({ text, color })
    setTimeout(() => setMessage(null), 3000)
  }

  const donate = async (item) => {
    if (loading) return
    if (donateBusyRef.current) return  // 連打ガード（二重寄贈＝ステ二重付与を防ぐ）
    const name = item.weapons?.name
    if (!name) return
    const groupId = ITEM_GROUP_MAP[name]
    if (!groupId) { showMsg('この装備は寄贈できません', '#ff4444'); return }
    if (item.equipped) { showMsg('装備中は寄贈できません。先に外してください', '#ff4444'); return }
    if (item.is_favorite) { showMsg('お気に入り装備は寄贈できません。先に★を解除してください', '#ff4444'); return }
    if ((item.evolve_stage || 0) > 0) { showMsg('進化・真化させた装備は寄贈できません', '#ff4444'); return }
    const tier = getEnhanceTier(item.enhance_plus || 0)
    if (donations.find(d => d.weapon_name === name && d.enhance_tier === tier)) {
      showMsg('このティアはすでに寄贈済みです', '#ff8844'); return
    }
    donateBusyRef.current = true
    setLoading(true)
    try {
    const stat = getMuseumStat(name, item.weapons.weapon_type, item.slot)
    const amount = getBonusAmount(name, groupId, item.enhance_plus || 0)
    // 寄贈する装備を「現存する」条件付きで削除し、削除できた時だけボーナス付与＝二重付与を防ぐ
    const { data: del } = await supabase.from('player_equipment').delete().eq('id', item.id)
      .or('evolve_stage.is.null,evolve_stage.eq.0').select('id')
    if (!del || del.length === 0) { showMsg('寄贈に失敗しました（装備が見つかりません）', '#ff4444'); await fetchAll(); return }
    // ボーナスは最新のmuseum_*に加算（複数寄贈時のlost update防止）
    const { data: fresh } = await supabase.from('profiles').select('*').eq('id', profile.id).maybeSingle()
    const updates = applyBonusToProfile(fresh || profile, stat, amount)
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await supabase.from('museum_donations').insert({
      player_id: profile.id, weapon_name: name, weapon_slot: item.slot,
      weapon_type: item.weapons.weapon_type, enhance_plus: item.enhance_plus || 0,
      enhance_tier: tier, bonus_stat: stat, bonus_amount: amount, area_group: groupId,
    })
    await fetchAll()
    showMsg(`🏛 ${name}（${TIER_LABELS[tier]}）を寄贈！ ${formatBonusText(stat, amount)}`)
    } finally { setLoading(false); donateBusyRef.current = false }
  }

  const claimCompleteBonus = async (group, tier) => {
    if (loading) return
    if (donateBusyRef.current) return  // 連打ガード（コンプ報酬の二重受取＝ステ二重付与を防ぐ）
    donateBusyRef.current = true
    setLoading(true)
    try {
    const tierMap = {}
    for (const d of donations) {
      if (!tierMap[d.weapon_name]) tierMap[d.weapon_name] = new Set()
      tierMap[d.weapon_name].add(d.enhance_tier)
    }
    const allOk = group.items.every(i => {
      const tiers = tierMap[i]
      if (!tiers) return false
      if (tier === 0) return tiers.size > 0
      if (tier === 1) return tiers.has(1) || tiers.has(2)
      return tiers.has(2)
    })
    if (!allOk) { showMsg('条件を満たしていません', '#ff4444'); return }
    const groupKey = `${group.id}__${tier}`
    // 受取済みチェック（サーバー側の記録で確認＝再受取・二重付与を防ぐ）
    const { data: already } = await supabase.from('museum_complete_bonuses')
      .select('id').eq('player_id', profile.id).eq('group_id', groupKey).maybeSingle()
    if (already) { showMsg('このコンプリート報酬は受取済みです', '#ff8844'); return }
    const mult = COMPLETE_BONUS_MULT[tier]
    // 記録を先に作成（重複時は失敗させ二重付与を防ぐ）。失敗したら付与しない
    const { error: recErr } = await supabase.from('museum_complete_bonuses').insert({ player_id: profile.id, group_id: groupKey })
    if (recErr) { showMsg('このコンプリート報酬は受取済みです', '#ff8844'); await fetchAll(); return }
    const { data: fresh } = await supabase.from('profiles').select('*').eq('id', profile.id).maybeSingle()
    const base = fresh || profile
    const updates = {}
    for (const [stat, val] of Object.entries(group.completeBonus)) {
      const col = museumCol(stat)
      updates[col] = (base[col] || 0) + val * mult
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchAll()
    const bonusText = Object.entries(group.completeBonus).map(([k,v]) => `${STAT_LABELS[k]}+${v * mult}`).join(' ')
    showMsg(`🏆 ${group.name}（${TIER_LABELS[tier]}コンプ）！ ${bonusText}`)
    } finally { setLoading(false); donateBusyRef.current = false }
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  // 寄贈済み (weapon_name, enhance_tier) セット
  const donatedKeySet = new Set(donations.map(d => `${d.weapon_name}__${d.enhance_tier}`))
  // 寄贈済み weapon_name セット（コンプ判定用）
  const donatedNames = new Set(donations.map(d => d.weapon_name))
  // 寄贈済みティア map: weapon_name → Set<tier>
  const donatedTierMap = {}
  for (const d of donations) {
    if (!donatedTierMap[d.weapon_name]) donatedTierMap[d.weapon_name] = new Set()
    donatedTierMap[d.weapon_name].add(d.enhance_tier)
  }

  // 寄贈可能アイテム: (name, tier) ごとに1件ずつ（装備中でも表示、ボタンを「装備中」にする）
  const donatableByGroup = {}
  const seenKeys = new Set()
  // お気に入りは後回しにして、同(name,tier)に非お気に入りがあればそちらを寄贈候補にする
  for (const item of [...equipment].sort((a, b) => (a.is_favorite ? 1 : 0) - (b.is_favorite ? 1 : 0))) {
    const name = item.weapons?.name
    if (!name || !ITEM_GROUP_MAP[name]) continue
    if ((item.evolve_stage || 0) > 0) continue  // 進化・真化させた装備は寄贈不可
    const tier = getEnhanceTier(item.enhance_plus || 0)
    const key = `${name}__${tier}`
    if (donatedKeySet.has(key) || seenKeys.has(key)) continue
    seenKeys.add(key)
    const gId = ITEM_GROUP_MAP[name]
    if (!donatableByGroup[gId]) donatableByGroup[gId] = []
    donatableByGroup[gId].push(item)
  }

  const allGroups = [...MUSEUM_GROUPS, BOSS_GROUP]

  return (
    <div style={{ minHeight:'100vh', background:'#000820', color:'#cccccc', fontFamily:'monospace', fontSize:'13px' }}>
      <div style={{ padding:'16px', maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>
        <div style={{ color:'#ccaa44', fontSize:'14px', marginBottom:'12px' }}>🏛 博物館</div>
        {message && (
          <div style={{ color:message.color, fontSize:'12px', padding:'8px', border:'1px solid #002244', marginBottom:'12px', textAlign:'center' }}>
            {message.text}
          </div>
        )}
        <div>
        <div style={{ display:'flex', gap:'4px', marginBottom:'12px' }}>
          {[{ id:'donate', label:'🎁 寄贈' }, { id:'collection', label:'📋 コレクション' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background: tab===t.id ? '#001840' : '#000820', border:`1px solid ${tab===t.id ? '#4488ff' : '#002244'}`, color: tab===t.id ? '#4488ff' : '#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 寄贈タブ */}
        {tab === 'donate' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', lineHeight:'1.6', background:'#000c1c', border:'1px solid #001428', padding:'8px' }}>
              同名装備は「未強化」「+5以上」「+9以上」の3ティアそれぞれ寄贈可能。<br />
              強化値が高いほど大きなボーナス（+9以上は未強化の10倍以上）。<br />
              <span style={{ color:'#ff8844' }}>⚠ 寄贈した装備は消費されます</span>
            </div>

            {allGroups.map(group => {
              const items = donatableByGroup[group.id] || []
              if (items.length === 0) return null
              return (
                <div key={group.id} style={{ marginBottom:'12px' }}>
                  <div style={{ color:group.color, fontSize:'12px', marginBottom:'6px', borderBottom:`1px solid ${group.color}44`, paddingBottom:'4px' }}>
                    {group.name}
                    {group.id === 'boss' && <span style={{ color:'#888', fontSize:'10px', marginLeft:'6px' }}>（コンプリートボーナスなし）</span>}
                  </div>
                  {items.map(item => {
                    const name = item.weapons.name
                    const plus = item.enhance_plus || 0
                    const tier = getEnhanceTier(plus)
                    const stat = getMuseumStat(name, item.weapons.weapon_type, item.slot)
                    const amount = getBonusAmount(name, group.id, plus)
                    const isBoss = BOSS_DROPS.has(name)
                    return (
                      <div key={`${item.id}`} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid #001a33', background:'#000c1c', padding:'8px', marginBottom:'4px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
                          <span style={{ color: isBoss ? '#ffcc00' : '#88ccff', fontSize:'12px' }}>{name}</span>
                          {isBoss && <span style={{ color:'#ffcc00', fontSize:'9px' }}>BOSS</span>}
                          <span style={{ color:TIER_COLORS[tier], fontSize:'10px' }}>{TIER_LABELS[tier]}</span>
                          <span style={{ color:'#44aa88', fontSize:'10px' }}>{formatBonusText(stat, amount)}</span>
                        </div>
                        <button
                          onClick={() => !item.equipped && !item.is_favorite && donate(item)}
                          disabled={loading || item.equipped || item.is_favorite}
                          style={{ flexShrink:0, padding:'4px 10px', background:'#001020', border:`1px solid ${(item.equipped || item.is_favorite) ? '#446688' : '#4488ff'}`, color: (item.equipped || item.is_favorite) ? '#446688' : '#4488ff', cursor: (item.equipped || item.is_favorite) ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                          {item.equipped ? '装備中' : item.is_favorite ? '★お気に入り' : '寄贈'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {Object.keys(donatableByGroup).length === 0 && (
              <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'32px' }}>
                寄贈できる装備がありません
              </div>
            )}
          </div>
        )}

        {/* コレクションタブ */}
        {tab === 'collection' && (
          <div>
            {MUSEUM_GROUPS.map(group => {
              const donated = group.items.filter(i => donatedNames.has(i))
              const total = group.items.length
              const isComplete = donated.length === total
              const tierClaimed = [0,1,2].map(t => !!completeBonuses.find(cb => cb.group_id === `${group.id}__${t}`))
              const pct = Math.round(donated.length / total * 100)
              const isExpanded = expandedGroup === group.id
              return (
                <div key={group.id} style={{ marginBottom:'8px', border:`1px solid ${isComplete ? group.color+'88' : '#001428'}`, background:'#000c1c' }}>
                  <div onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                    style={{ padding:'10px 12px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <span style={{ color:group.color, fontSize:'12px' }}>{group.name}</span>
                      <span style={{ color: isComplete ? '#44ff88' : '#446688', fontSize:'11px', marginLeft:'8px' }}>{donated.length}/{total}</span>
                      {isComplete && <span style={{ color:'#44ff88', fontSize:'10px', marginLeft:'6px' }}>✓ コンプ</span>}
                      {tierClaimed[2] && <span style={{ color:'#ffcc00', fontSize:'10px', marginLeft:'4px' }}>★MAX</span>}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <div style={{ width:'60px', height:'6px', background:'#001428', borderRadius:'3px' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:group.color, borderRadius:'3px' }} />
                      </div>
                      <span style={{ color:'#446688', fontSize:'10px' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  <div style={{ padding:'0 12px 10px' }}>
                    <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>コンプリートボーナス</div>
                    {[0,1,2].map(t => {
                      const mult = COMPLETE_BONUS_MULT[t]
                      const bonusText = Object.entries(group.completeBonus).map(([k,v]) => `${STAT_LABELS[k]}+${v * mult}`).join(' ')
                      const allOk = group.items.every(i => {
                        const tiers = donatedTierMap[i]
                        if (!tiers) return false
                        if (t === 0) return tiers.size > 0
                        if (t === 1) return tiers.has(1) || tiers.has(2)
                        return tiers.has(2)
                      })
                      return (
                        <div key={t} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                          <span style={{ color:TIER_COLORS[t], fontSize:'10px', minWidth:'50px' }}>{TIER_LABELS[t]}</span>
                          <span style={{ color:'#ccaa44', fontSize:'10px', flex:1 }}>{bonusText}</span>
                          {tierClaimed[t]
                            ? <span style={{ color:'#446688', fontSize:'10px' }}>✓ 受取済み</span>
                            : allOk
                              ? <button onClick={() => claimCompleteBonus(group, t)} disabled={loading}
                                  style={{ padding:'2px 8px', background:'#001840', border:`1px solid ${TIER_COLORS[t]}`, color:TIER_COLORS[t], cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                                  受取
                                </button>
                              : <span style={{ color:'#334455', fontSize:'10px' }}>未達成</span>
                          }
                        </div>
                      )
                    })}
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop:'1px solid #001428', padding:'8px 12px' }}>
                      {group.items.map(itemName => {
                        const tiers = donatedTierMap[itemName]
                        const hasAny = !!tiers?.size
                        return (
                          <div key={itemName} style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px', opacity: hasAny ? 1 : 0.4 }}>
                            <span style={{ color: hasAny ? '#88ccff' : '#334455', fontSize:'11px', minWidth:'120px' }}>{itemName}</span>
                            {[0,1,2].map(t => {
                              const donated = tiers?.has(t)
                              return (
                                <span key={t} style={{ fontSize:'9px', padding:'1px 4px', border:`1px solid ${donated ? TIER_COLORS[t]+'88' : '#001428'}`, color: donated ? TIER_COLORS[t] : '#223344', background: donated ? '#001428' : 'transparent' }}>
                                  {['未','＋5','＋9'][t]}
                                </span>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* ボス別枠 */}
            <div style={{ marginBottom:'8px', border:'1px solid #ffcc0044', background:'#000c1c' }}>
              <div onClick={() => setExpandedGroup(expandedGroup === 'boss' ? null : 'boss')}
                style={{ padding:'10px 12px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <span style={{ color:'#ffcc00', fontSize:'12px' }}>⭐ ボスドロップ</span>
                  <span style={{ color:'#446688', fontSize:'11px', marginLeft:'8px' }}>
                    {BOSS_GROUP.items.filter(i => donatedNames.has(i)).length}/{BOSS_GROUP.items.length}
                  </span>
                  <span style={{ color:'#888', fontSize:'10px', marginLeft:'6px' }}>（コンプリートボーナスなし）</span>
                </div>
                <span style={{ color:'#446688', fontSize:'10px' }}>{expandedGroup === 'boss' ? '▲' : '▼'}</span>
              </div>
              {expandedGroup === 'boss' && (
                <div style={{ borderTop:'1px solid #001428', padding:'8px 12px' }}>
                  {BOSS_GROUP.items.map(itemName => {
                    const tiers = donatedTierMap[itemName]
                    const hasAny = !!tiers?.size
                    return (
                      <div key={itemName} style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px', opacity: hasAny ? 1 : 0.4 }}>
                        <span style={{ color: hasAny ? '#ffcc00' : '#554400', fontSize:'11px', minWidth:'120px' }}>{itemName}</span>
                        {[0,1,2].map(t => {
                          const donated = tiers?.has(t)
                          return (
                            <span key={t} style={{ fontSize:'9px', padding:'1px 4px', border:`1px solid ${donated ? TIER_COLORS[t]+'88' : '#001428'}`, color: donated ? TIER_COLORS[t] : '#223344', background: donated ? '#001428' : 'transparent' }}>
                              {['未','＋5','＋9'][t]}
                            </span>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
