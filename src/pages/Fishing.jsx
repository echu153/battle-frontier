import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const FISH_SELL_PRICE = { f:5, e:15, d:40, c:100, b:250, a:600, s:1500, ss:4000, sss:10000 }
const FISH_RANK_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const FISH_RANK_LABELS = { f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS' }
const FISH_RANK_RATES = { f:50, e:30, d:10, c:5, b:3, a:1, s:0.5, ss:0.1, sss:0.01 }

const FISH_RANK_BONUS_STATS = {
  f:   ['atk','def','matk','mdef','spd'],
  e:   ['atk','def','matk','mdef','spd'],
  d:   ['atk','def','matk','mdef','spd'],
  c:   ['def','mdef','spd'],
  b:   ['atk','matk','spd'],
  a:   ['hp','mp'],
  s:   ['def','mdef'],
  ss:  ['atk','matk','spd'],
  sss: ['hp'],
}
const FISH_RANK_BONUS_AMOUNT = { f:1, e:1, d:1, c:1, b:1, a:null, s:3, ss:3, sss:100 }
const FISH_A_BONUS = { hp_max:10, mp_max:5 }
const FISH_SSS_BONUS = { hp_max:100 }

const FISH_DATA = {
  日本海: [
    { rank:'f', name:'アジ', statIdx:0 },
    { rank:'f', name:'イワシ', statIdx:1 },
    { rank:'f', name:'サバ', statIdx:2 },
    { rank:'f', name:'カタクチイワシ', statIdx:3 },
    { rank:'f', name:'キス', statIdx:4 },
    { rank:'e', name:'カサゴ', statIdx:0 },
    { rank:'e', name:'メバル', statIdx:1 },
    { rank:'e', name:'ベラ', statIdx:2 },
    { rank:'e', name:'コノシロ', statIdx:3 },
    { rank:'e', name:'小ダイ', statIdx:4 },
    { rank:'d', name:'クロダイ', statIdx:0 },
    { rank:'d', name:'シーバス', statIdx:1 },
    { rank:'d', name:'ヒラメ', statIdx:2 },
    { rank:'d', name:'ホウボウ', statIdx:3 },
    { rank:'d', name:'アイナメ', statIdx:4 },
    { rank:'c', name:'真鯛', statIdx:0 },
    { rank:'c', name:'ワラサ', statIdx:1 },
    { rank:'c', name:'アオリイカ', statIdx:2 },
    { rank:'b', name:'ブリ', statIdx:0 },
    { rank:'b', name:'カンパチ', statIdx:1 },
    { rank:'b', name:'石鯛', statIdx:2 },
    { rank:'a', name:'マグロ', statIdx:0 },
    { rank:'a', name:'巨大真鯛', statIdx:1 },
    { rank:'s', name:'リュウグウノツカイ', statIdx:0 },
    { rank:'ss', name:'ダイオウイカ', statIdx:0 },
    { rank:'sss', name:'シロナガスクジラ', statIdx:0 },
  ],
  カリブ海: [
    { rank:'f', name:'ブルータン', statIdx:0 },
    { rank:'f', name:'クイーンエンゼル', statIdx:1 },
    { rank:'f', name:'サージェントメジャー', statIdx:2 },
    { rank:'f', name:'フレンチグラント', statIdx:3 },
    { rank:'f', name:'パロットフィッシュ幼魚', statIdx:4 },
    { rank:'e', name:'カマス', statIdx:0 },
    { rank:'e', name:'フエダイ', statIdx:1 },
    { rank:'e', name:'ハタ', statIdx:2 },
    { rank:'e', name:'カサゴ系', statIdx:3 },
    { rank:'e', name:'グルーパー', statIdx:4 },
    { rank:'d', name:'シイラ', statIdx:0 },
    { rank:'d', name:'バラクーダ', statIdx:1 },
    { rank:'d', name:'カンパチ', statIdx:2 },
    { rank:'d', name:'ロウニンアジ', statIdx:3 },
    { rank:'d', name:'ターポン', statIdx:4 },
    { rank:'c', name:'キングフィッシュ', statIdx:0 },
    { rank:'c', name:'シロカジキ', statIdx:1 },
    { rank:'c', name:'マヒマヒ', statIdx:2 },
    { rank:'b', name:'ナポレオンフィッシュ', statIdx:0 },
    { rank:'b', name:'ハンマーヘッドシャーク', statIdx:1 },
    { rank:'b', name:'タイガーシャーク', statIdx:2 },
    { rank:'a', name:'ブルーマーリン', statIdx:0 },
    { rank:'a', name:'ホホジロザメ', statIdx:1 },
    { rank:'s', name:'ジンベエザメ', statIdx:0 },
    { rank:'ss', name:'マッコウクジラ', statIdx:0 },
    { rank:'sss', name:'ダイオウホウズキイカ', statIdx:0 },
  ],
  ミミミッミ川: [
    { rank:'f', name:'ミハゼ', statIdx:0 },
    { rank:'f', name:'カワピヨ', statIdx:1 },
    { rank:'f', name:'チビナマ', statIdx:2 },
    { rank:'f', name:'ミミコイ', statIdx:3 },
    { rank:'f', name:'ハネビレ', statIdx:4 },
    { rank:'e', name:'シマミミウオ', statIdx:0 },
    { rank:'e', name:'ミミマス', statIdx:1 },
    { rank:'e', name:'青ヒレナマズ', statIdx:2 },
    { rank:'e', name:'ミズハネ', statIdx:3 },
    { rank:'e', name:'カワツノ魚', statIdx:4 },
    { rank:'d', name:'銀鱗ミミマス', statIdx:0 },
    { rank:'d', name:'オオヒレナマズ', statIdx:1 },
    { rank:'d', name:'双尾ゴイ', statIdx:2 },
    { rank:'d', name:'水晶魚', statIdx:3 },
    { rank:'d', name:'月光アユ', statIdx:4 },
    { rank:'c', name:'深川ナマズ', statIdx:0 },
    { rank:'c', name:'雷光ウナギ', statIdx:1 },
    { rank:'c', name:'蒼水龍魚', statIdx:2 },
    { rank:'b', name:'金鱗龍魚', statIdx:0 },
    { rank:'b', name:'古代ナマズ', statIdx:1 },
    { rank:'b', name:'深淵ウナギ', statIdx:2 },
    { rank:'a', name:'奈落ナマズ', statIdx:0 },
    { rank:'a', name:'神雷ウナギ', statIdx:1 },
    { rank:'s', name:'ミミミ龍魚', statIdx:0 },
    { rank:'ss', name:'超巨大奈落ナマズ', statIdx:0 },
    { rank:'sss', name:'ミミミッミ神龍', statIdx:0 },
  ],
}

const COMPLETE_BONUS = {
  日本海:      { atk:30, matk:30, spd:30 },
  カリブ海:    { def:30, mdef:30 },
  ミミミッミ川: { hp_max:500, mp_max:250 },
}

const LOCATIONS = ['日本海', 'カリブ海', 'ミミミッミ川']
const MIN_INTERVAL = 5 * 60
const MAX_INTERVAL = 15 * 60
const STONE_DROP_RATE = 3
const STONE_RANKS = ['f','e','d','c']
const STONE_WEIGHTS = { f:40, e:30, d:20, c:10 }
const STONE_NAMES = { f:'強化石(F)', e:'強化石(E)', d:'強化石(D)', c:'強化石(C)' }

const calcFishBonus = (fish, rank) => {
  const stats = FISH_RANK_BONUS_STATS[rank] || []
  const stat = stats[fish.statIdx]
  if (!stat) return null
  if (rank === 'a') return FISH_A_BONUS
  if (rank === 'sss') return FISH_SSS_BONUS
  const amount = FISH_RANK_BONUS_AMOUNT[rank] || 1
  const statMap = { atk:'atk', def:'def', matk:'matk', mdef:'mdef', spd:'spd', hp:'hp_max', mp:'mp_max' }
  return { [statMap[stat] || stat]: amount }
}

const drawFishRank = () => {
  const r = Math.random() * 100
  let cumulative = 0
  const order = ['sss','ss','s','a','b','c','d','e','f']
  for (const rank of order) {
    cumulative += FISH_RANK_RATES[rank]
    if (r < cumulative) return rank
  }
  return 'f'
}

const drawFish = (location, rank) => {
  const pool = FISH_DATA[location].filter(f => f.rank === rank)
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

const drawStone = () => {
  const total = Object.values(STONE_WEIGHTS).reduce((a,b)=>a+b,0)
  let r = Math.random() * total
  for (const rank of STONE_RANKS) {
    r -= STONE_WEIGHTS[rank]
    if (r <= 0) return rank
  }
  return 'f'
}

const calcCaughtFish = (location, startAt, now) => {
  const elapsed = (now - new Date(startAt).getTime()) / 1000
  const results = []
  const avgInterval = (MIN_INTERVAL + MAX_INTERVAL) / 2
  const count = Math.floor(elapsed / avgInterval)
  for (let i = 0; i < count; i++) {
    const rank = drawFishRank()
    const fish = drawFish(location, rank)
    if (fish) results.push({ ...fish, location })
    if (Math.random() * 100 < STONE_DROP_RATE) {
      const stoneRank = drawStone()
      results.push({ isStone: true, rank: stoneRank, name: STONE_NAMES[stoneRank], location })
    }
  }
  return results
}

export default function Fishing() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [caughtFish, setCaughtFish] = useState([])
  const [records, setRecords] = useState([])
  const [selectedLocation, setSelectedLocation] = useState('日本海')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [tab, setTab] = useState('fishing')
  const [now, setNow] = useState(Date.now())

useEffect(() => {
  const id = setInterval(() => setNow(Date.now()), 1000)
  return () => clearInterval(id)
}, [])
  const [encLocation, setEncLocation] = useState('日本海')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    // caught_fishを取得（player_idのみで検索）
    const { data: caught } = await supabase.from('caught_fish')
      .select('*').eq('player_id', user.id).order('caught_at')
    setCaughtFish(caught || [])
    const { data: recs } = await supabase.from('fishing_records')
      .select('*').eq('player_id', user.id)
    setRecords(recs || [])
  }

  const showMessage = (msg, color = '#44ff88') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  // 釣り開始：profilesのフラグを立てるだけ
  const startFishing = async () => {
    if (!profile || profile.is_fishing) return
    setLoading(true)
    await supabase.from('profiles').update({
      is_fishing: true,
      fishing_location: selectedLocation,
      fishing_started_at: new Date().toISOString(),
    }).eq('id', profile.id)
    await fetchAll()
    showMessage(`🎣 ${selectedLocation}で釣りを開始しました！`)
    setLoading(false)
  }

  // 釣り終了：経過時間から釣果を計算してcaught_fishに保存
  const endFishing = async () => {
    if (!profile || !profile.is_fishing) return
    setLoading(true)
    const now = new Date()
    const results = calcCaughtFish(
      profile.fishing_location,
      profile.fishing_started_at,
      now
    )
    // caught_fishに保存（session_idなし）
    for (const item of results) {
      await supabase.from('caught_fish').insert({
        player_id: profile.id,
        fish_name: item.name,
        fish_rank: item.rank,
        location: item.location || profile.fishing_location,
        caught_at: new Date().toISOString(),
      })
    }
    // profilesのフラグをリセット
    await supabase.from('profiles').update({
      is_fishing: false,
      fishing_location: null,
      fishing_started_at: null,
    }).eq('id', profile.id)
    await fetchAll()
    showMessage(`🎣 釣りを終了しました！${results.length}匹釣れました！`)
    setLoading(false)
  }

  // 売却
  const sellAll = async () => {
    if (caughtFish.length === 0) return
    setLoading(true)
    let totalGold = 0
    const fishItems = caughtFish.filter(f => !f.fish_name?.startsWith('強化石'))
    const stoneItems = caughtFish.filter(f => f.fish_name?.startsWith('強化石'))

    for (const fish of fishItems) {
      const rankKey = fish.fish_rank?.toLowerCase() || 'f'
      totalGold += FISH_SELL_PRICE[rankKey] || 5
      const existing = records.find(r => r.fish_name === fish.fish_name)
      if (!existing) {
        await supabase.from('fishing_records').insert({
          player_id: profile.id,
          fish_name: fish.fish_name,
          fish_rank: fish.fish_rank,
          location: fish.location,
          first_caught_at: new Date().toISOString(),
          bonus_claimed: false,
        })
      }
    }
    for (const stone of stoneItems) {
      const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stone.fish_name).single()
      if (stoneItem) {
        let existing = null
        try {
          const res = await supabase.from('player_items').select('*').eq('player_id', profile.id).eq('item_id', stoneItem.id).single()
          existing = res.data
        } catch {}
        if (existing) {
          await supabase.from('player_items').update({ quantity: (existing.quantity||1)+1 }).eq('id', existing.id)
        } else {
          await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
        }
      }
    }
    await supabase.from('profiles').update({ gold: profile.gold + totalGold }).eq('id', profile.id)
    // caught_fish全削除
    await supabase.from('caught_fish').delete().eq('player_id', profile.id)
    await fetchAll()
    showMessage(`💰 ${totalGold}G獲得！${stoneItems.length > 0 ? `強化石${stoneItems.length}個入手！` : ''}`)
    setLoading(false)
  }

  const claimBonus = async (record) => {
    if (record.bonus_claimed) return
    setLoading(true)
    const rank = record.fish_rank?.toLowerCase() || 'f'
    const fishData = FISH_DATA[record.location]?.find(f => f.name === record.fish_name)
    if (!fishData) { setLoading(false); return }
    const bonus = calcFishBonus(fishData, rank)
    if (!bonus) { setLoading(false); return }
    const updates = {}
    for (const [key, val] of Object.entries(bonus)) {
      updates[key] = (profile[key] || 0) + val
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await supabase.from('fishing_records').update({ bonus_claimed: true }).eq('id', record.id)
    await fetchAll()
    const bonusText = Object.entries(bonus).map(([k,v]) => {
      const labels = { atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ', hp_max:'HP', mp_max:'MP' }
      return `${labels[k]||k}+${v}`
    }).join(' ')
    showMessage(`✨ ${record.fish_name}のボーナス受取！ ${bonusText}`)
    setLoading(false)
  }

  const claimCompleteBonus = async (location) => {
    setLoading(true)
    const allFish = FISH_DATA[location]
    const claimedNames = records.filter(r => r.location === location && r.bonus_claimed).map(r => r.fish_name)
    const allClaimed = allFish.every(f => claimedNames.includes(f.name))
    if (!allClaimed) { showMessage('まだ全部の魚を釣っていません！', '#ff4444'); setLoading(false); return }
    const bonus = COMPLETE_BONUS[location]
    const updates = {}
    for (const [key, val] of Object.entries(bonus)) {
      updates[key] = (profile[key] || 0) + val
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchAll()
    const bonusText = Object.entries(bonus).map(([k,v]) => {
      const labels = { atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ', hp_max:'HP', mp_max:'MP' }
      return `${labels[k]||k}+${v}`
    }).join(' ')
    showMessage(`🎉 ${location}コンプリート！ ${bonusText}`, '#ffcc00')
    setLoading(false)
  }

const getElapsedText = () => {
  if (!profile?.fishing_started_at) return ''
  const elapsed = Math.floor((now - new Date(profile.fishing_started_at).getTime()) / 1000)
    const h = Math.floor(elapsed / 3600)
    const m = Math.floor((elapsed % 3600) / 60)
    const s = elapsed % 60
    if (h > 0) return `${h}時間${m}分${s}秒`
    if (m > 0) return `${m}分${s}秒`
    return `${s}秒`
  }

 const getEstimatedCount = () => {
  if (!profile?.fishing_started_at) return 0
  const elapsed = (now - new Date(profile.fishing_started_at).getTime()) / 1000
    const avg = (MIN_INTERVAL + MAX_INTERVAL) / 2
    return Math.floor(elapsed / avg)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const isFishing = profile.is_fishing || false
  const encFish = FISH_DATA[encLocation] || []
  const encRecords = records.filter(r => r.location === encLocation)
  const allCaught = encFish.every(f => encRecords.some(r => r.fish_name === f.name))

  const fishSummary = {}
  for (const f of caughtFish) {
    const key = f.fish_name
    if (!fishSummary[key]) fishSummary[key] = { name:f.fish_name, rank:f.fish_rank, count:0, isStone: f.fish_name?.startsWith('強化石') }
    fishSummary[key].count++
  }
  const summaryList = Object.values(fishSummary)
  const totalGold = summaryList.filter(f=>!f.isStone).reduce((sum,f) => sum + (FISH_SELL_PRICE[f.rank?.toLowerCase()] || 5) * f.count, 0)

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#44aaff', fontSize:'14px', marginBottom:'4px' }}>🎣 釣り場</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
        </div>

        {message && (
          <div style={{ color:messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        <div style={{ display:'flex', gap:'4px', marginBottom:'12px' }}>
          {[{id:'fishing',label:'🎣 釣り'},{id:'encyclopedia',label:'📖 魚図鑑'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab===t.id?'#001840':'#000818',
                border:`1px solid ${tab===t.id?'#44aaff':'#003366'}`,
                color: tab===t.id?'#44aaff':'#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==='fishing' && (
          <div>
            {!isFishing ? (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'16px' }}>
                <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'12px' }}>釣り場所を選んで放置釣りを開始！</div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', lineHeight:'1.8' }}>
                  ・5〜15分ごとに1匹釣れます<br/>
                  ・ブラウザを閉じても釣り続けます<br/>
                  ・釣り中は戦闘・他の行動はできません<br/>
                  ・終了ボタンを押すと結果が確認できます
                </div>
                <div style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>釣り場所</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'6px' }}>
                    {LOCATIONS.map(loc=>(
                      <button key={loc} onClick={()=>setSelectedLocation(loc)}
                        style={{ padding:'10px 6px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                          background: selectedLocation===loc?'#001840':'#000818',
                          border:`2px solid ${selectedLocation===loc?'#44aaff':'#003366'}`,
                          color: selectedLocation===loc?'#44aaff':'#446688' }}>
                        {loc}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ border:'1px solid #002244', background:'#000818', padding:'8px', marginBottom:'12px', fontSize:'10px', color:'#446688' }}>
                  <div style={{ color:'#88ccff', marginBottom:'4px' }}>{selectedLocation}で釣れる魚（一例）</div>
                  {['f','e','d'].map(rank=>(
                    <div key={rank} style={{ marginBottom:'2px' }}>
                      <span style={{color:FISH_RANK_COLORS[rank]}}>{FISH_RANK_LABELS[rank]}: </span>
                      {FISH_DATA[selectedLocation].filter(f=>f.rank===rank).map(f=>f.name).join('・')}
                    </div>
                  ))}
                  <div style={{color:'#446688', marginTop:'4px'}}>※ C〜SSSも釣れる可能性あり</div>
                </div>
                <button onClick={startFishing} disabled={loading}
                  style={{ width:'100%', padding:'14px', background:'#001840', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
                  🎣 釣りを開始する
                </button>

                {/* 前回の釣果が残っていれば表示 */}
                {caughtFish.length > 0 && (
                  <div style={{ border:'1px solid #0044aa', background:'#001028', padding:'12px', marginTop:'12px' }}>
                    <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>前回の釣果（未売却）</div>
                    <div style={{ maxHeight:'200px', overflowY:'auto', marginBottom:'8px' }}>
                      {summaryList.map((f,i)=>(
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #001428', padding:'4px 0', fontSize:'11px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            <span style={{ color:FISH_RANK_COLORS[f.rank?.toLowerCase()||'f'], fontSize:'9px', padding:'1px 4px', border:`1px solid ${FISH_RANK_COLORS[f.rank?.toLowerCase()||'f']}` }}>
                              {FISH_RANK_LABELS[f.rank?.toLowerCase()||'f']}
                            </span>
                            <span style={{ color: f.isStone?'#6699cc':'#88ccff' }}>{f.name}</span>
                          </div>
                          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                            <span style={{ color:'#446688' }}>×{f.count}</span>
                            {!f.isStone && <span style={{ color:'#ffcc00', fontSize:'10px' }}>{(FISH_SELL_PRICE[f.rank?.toLowerCase()||'f']||5)*f.count}G</span>}
                            {f.isStone && <span style={{ color:'#6699cc', fontSize:'10px' }}>強化素材</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', fontSize:'11px', color:'#446688' }}>
                      <span>合計売却額</span>
                      <span style={{color:'#ffcc00', fontSize:'13px'}}>{totalGold}G</span>
                    </div>
                    <button onClick={sellAll} disabled={loading}
                      style={{ width:'100%', padding:'10px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                      💰 全部売却する
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ border:'1px solid #44aaff', background:'#001040', padding:'16px', marginBottom:'12px' }}>
                  <div style={{ color:'#44aaff', fontSize:'13px', marginBottom:'8px' }}>🎣 釣り中...</div>
                  <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'4px' }}>
                    場所: <span style={{color:'#ffcc00'}}>{profile.fishing_location}</span>
                  </div>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>
                    経過時間: <span style={{color:'#44ccff'}}>{getElapsedText()}</span>
                  </div>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
                    推定釣果: <span style={{color:'#44ff88'}}>約{getEstimatedCount()}匹</span>
                  </div>
                  <button onClick={endFishing} disabled={loading}
                    style={{ width:'100%', padding:'12px', background:'#1a0800', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
                    ⬛ 釣りを終了する
                  </button>
                  <div style={{ color:'#446688', fontSize:'10px', textAlign:'center' }}>終了すると釣れた魚の一覧が確認できます</div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab==='encyclopedia' && (
          <div>
            <div style={{ display:'flex', gap:'4px', marginBottom:'12px', flexWrap:'wrap' }}>
              {LOCATIONS.map(loc=>(
                <button key={loc} onClick={()=>setEncLocation(loc)}
                  style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: encLocation===loc?'#001840':'#000818',
                    border:`1px solid ${encLocation===loc?'#44aaff':'#003366'}`,
                    color: encLocation===loc?'#44aaff':'#446688' }}>
                  {loc}
                </button>
              ))}
            </div>

            <div style={{ border:`1px solid ${allCaught?'#ffcc00':'#002244'}`, background:'#001028', padding:'10px', marginBottom:'12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color: allCaught?'#ffcc00':'#446688', fontSize:'12px', marginBottom:'2px' }}>
                    {encLocation} コンプリートボーナス
                  </div>
                  <div style={{ fontSize:'10px', color:'#446688' }}>
                    {Object.entries(COMPLETE_BONUS[encLocation]).map(([k,v])=>{
                      const labels = { atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ', hp_max:'HP', mp_max:'MP' }
                      return `${labels[k]||k}+${v}`
                    }).join(' ')}
                  </div>
                  <div style={{ fontSize:'10px', color:'#446688', marginTop:'2px' }}>
                    {encRecords.length}/{encFish.length}種類釣り上げ済み
                  </div>
                </div>
                <button onClick={()=>claimCompleteBonus(encLocation)} disabled={!allCaught || loading}
                  style={{ padding:'6px 10px', background: allCaught?'#1a1000':'#001', border:`1px solid ${allCaught?'#ffcc00':'#002244'}`, color: allCaught?'#ffcc00':'#334455', cursor: allCaught?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                  {allCaught ? '受け取る' : '未達成'}
                </button>
              </div>
            </div>

            {['sss','ss','s','a','b','c','d','e','f'].map(rank=>{
              const fishInRank = encFish.filter(f=>f.rank===rank)
              if (fishInRank.length === 0) return null
              return (
                <div key={rank} style={{ marginBottom:'12px' }}>
                  <div style={{ color:FISH_RANK_COLORS[rank], fontSize:'11px', borderBottom:`1px solid ${FISH_RANK_COLORS[rank]}`, paddingBottom:'4px', marginBottom:'6px' }}>
                    {FISH_RANK_LABELS[rank]}ランク（釣れる確率: {FISH_RANK_RATES[rank]}%）
                  </div>
                  {fishInRank.map(fish=>{
                    const rec = encRecords.find(r=>r.fish_name===fish.name)
                    const caught = !!rec
                    const claimed = rec?.bonus_claimed || false
                    const bonus = calcFishBonus(fish, rank)
                    const bonusText = bonus ? Object.entries(bonus).map(([k,v])=>{
                      const labels = { atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ', hp_max:'HP', mp_max:'MP' }
                      return `${labels[k]||k}+${v}`
                    }).join(' ') : ''
                    return (
                      <div key={fish.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:`1px solid ${caught?'#0044aa':'#001428'}`, background: caught?'#001028':'#000818', padding:'8px', marginBottom:'4px', opacity: caught?1:0.5 }}>
                        <div>
                          <span style={{ color: caught?'#88ccff':'#446688', fontSize:'12px' }}>{caught?fish.name:'???'}</span>
                          {bonusText && <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>{bonusText}</div>}
                          {!caught && <div style={{ color:'#334455', fontSize:'10px' }}>未釣り上げ</div>}
                        </div>
                        {caught && !claimed && (
                          <button onClick={()=>claimBonus(rec)} disabled={loading}
                            style={{ padding:'4px 8px', background:'#001840', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                            ボーナス受取
                          </button>
                        )}
                        {caught && claimed && (
                          <span style={{ color:'#446688', fontSize:'10px' }}>受取済み</span>
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
