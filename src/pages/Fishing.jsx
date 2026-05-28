import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// ============================================================
// 釣りデータ定義
// ============================================================

const FISH_SELL_PRICE = { f:5, e:15, d:40, c:100, b:250, a:600, s:1500, ss:4000, sss:10000 }
const FISH_RANK_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const FISH_RANK_LABELS = { f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS' }

// ランク別釣れる確率（%）
const FISH_RANK_RATES = { f:50, e:30, d:10, c:5, b:3, a:1, s:0.5, ss:0.1, sss:0.01 }

// 初回釣り上げボーナス（各ランクの魚の順番にATK→DEF→MATK→MDEF→SPDを割り当て）
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
const FISH_RANK_BONUS_AMOUNT = {
  f:1, e:1, d:1, c:1, b:1, a:null, s:3, ss:3, sss:100
}
// Aランクは特殊（HP+10, MP+5）
const FISH_A_BONUS = { hp_max:10, mp_max:5 }
// SSSは HP+100
const FISH_SSS_BONUS = { hp_max:100 }

// 各地域の魚データ（rank, name, statBonus）
// statBonusはそのランク内での順番でstatsを割り当て
const FISH_DATA = {
  日本海: [
    // F
    { rank:'f', name:'アジ',         statIdx:0 },
    { rank:'f', name:'イワシ',       statIdx:1 },
    { rank:'f', name:'サバ',         statIdx:2 },
    { rank:'f', name:'カタクチイワシ', statIdx:3 },
    { rank:'f', name:'キス',         statIdx:4 },
    // E
    { rank:'e', name:'カサゴ',       statIdx:0 },
    { rank:'e', name:'メバル',       statIdx:1 },
    { rank:'e', name:'ベラ',         statIdx:2 },
    { rank:'e', name:'コノシロ',     statIdx:3 },
    { rank:'e', name:'小ダイ',       statIdx:4 },
    // D
    { rank:'d', name:'クロダイ',     statIdx:0 },
    { rank:'d', name:'シーバス',     statIdx:1 },
    { rank:'d', name:'ヒラメ',       statIdx:2 },
    { rank:'d', name:'ホウボウ',     statIdx:3 },
    { rank:'d', name:'アイナメ',     statIdx:4 },
    // C
    { rank:'c', name:'真鯛',         statIdx:0 },
    { rank:'c', name:'ワラサ',       statIdx:1 },
    { rank:'c', name:'アオリイカ',   statIdx:2 },
    // B
    { rank:'b', name:'ブリ',         statIdx:0 },
    { rank:'b', name:'カンパチ',     statIdx:1 },
    { rank:'b', name:'石鯛',         statIdx:2 },
    // A
    { rank:'a', name:'マグロ',       statIdx:0 },
    { rank:'a', name:'巨大真鯛',     statIdx:1 },
    // S
    { rank:'s', name:'リュウグウノツカイ', statIdx:0 },
    // SS
    { rank:'ss', name:'ダイオウイカ', statIdx:0 },
    // SSS
    { rank:'sss', name:'シロナガスクジラ', statIdx:0 },
  ],
  カリブ海: [
    // F
    { rank:'f', name:'ブルータン',         statIdx:0 },
    { rank:'f', name:'クイーンエンゼル',   statIdx:1 },
    { rank:'f', name:'サージェントメジャー', statIdx:2 },
    { rank:'f', name:'フレンチグラント',   statIdx:3 },
    { rank:'f', name:'パロットフィッシュ幼魚', statIdx:4 },
    // E
    { rank:'e', name:'カマス',     statIdx:0 },
    { rank:'e', name:'フエダイ',   statIdx:1 },
    { rank:'e', name:'ハタ',       statIdx:2 },
    { rank:'e', name:'カサゴ系',   statIdx:3 },
    { rank:'e', name:'グルーパー', statIdx:4 },
    // D
    { rank:'d', name:'シイラ',         statIdx:0 },
    { rank:'d', name:'バラクーダ',     statIdx:1 },
    { rank:'d', name:'カンパチ',       statIdx:2 },
    { rank:'d', name:'ロウニンアジ',   statIdx:3 },
    { rank:'d', name:'ターポン',       statIdx:4 },
    // C
    { rank:'c', name:'キングフィッシュ', statIdx:0 },
    { rank:'c', name:'シロカジキ',       statIdx:1 },
    { rank:'c', name:'マヒマヒ',         statIdx:2 },
    // B
    { rank:'b', name:'ナポレオンフィッシュ', statIdx:0 },
    { rank:'b', name:'ハンマーヘッドシャーク', statIdx:1 },
    { rank:'b', name:'タイガーシャーク',   statIdx:2 },
    // A
    { rank:'a', name:'ブルーマーリン', statIdx:0 },
    { rank:'a', name:'ホホジロザメ',   statIdx:1 },
    // S
    { rank:'s', name:'ジンベエザメ', statIdx:0 },
    // SS
    { rank:'ss', name:'マッコウクジラ', statIdx:0 },
    // SSS
    { rank:'sss', name:'ダイオウホウズキイカ', statIdx:0 },
  ],
  ミミミッミ川: [
    // F
    { rank:'f', name:'ミハゼ',   statIdx:0 },
    { rank:'f', name:'カワピヨ', statIdx:1 },
    { rank:'f', name:'チビナマ', statIdx:2 },
    { rank:'f', name:'ミミコイ', statIdx:3 },
    { rank:'f', name:'ハネビレ', statIdx:4 },
    // E
    { rank:'e', name:'シマミミウオ', statIdx:0 },
    { rank:'e', name:'ミミマス',     statIdx:1 },
    { rank:'e', name:'青ヒレナマズ', statIdx:2 },
    { rank:'e', name:'ミズハネ',     statIdx:3 },
    { rank:'e', name:'カワツノ魚',   statIdx:4 },
    // D
    { rank:'d', name:'銀鱗ミミマス', statIdx:0 },
    { rank:'d', name:'オオヒレナマズ', statIdx:1 },
    { rank:'d', name:'双尾ゴイ',     statIdx:2 },
    { rank:'d', name:'水晶魚',       statIdx:3 },
    { rank:'d', name:'月光アユ',     statIdx:4 },
    // C
    { rank:'c', name:'深川ナマズ', statIdx:0 },
    { rank:'c', name:'雷光ウナギ', statIdx:1 },
    { rank:'c', name:'蒼水龍魚',   statIdx:2 },
    // B
    { rank:'b', name:'金鱗龍魚', statIdx:0 },
    { rank:'b', name:'古代ナマズ', statIdx:1 },
    { rank:'b', name:'深淵ウナギ', statIdx:2 },
    // A
    { rank:'a', name:'奈落ナマズ', statIdx:0 },
    { rank:'a', name:'神雷ウナギ', statIdx:1 },
    // S
    { rank:'s', name:'ミミミ龍魚', statIdx:0 },
    // SS
    { rank:'ss', name:'超巨大奈落ナマズ', statIdx:0 },
    // SSS
    { rank:'sss', name:'ミミミッミ神龍', statIdx:0 },
  ],
}

// コンプリートボーナス
const COMPLETE_BONUS = {
  日本海:      { atk:30, matk:30, spd:30 },
  カリブ海:    { def:30, mdef:30 },
  ミミミッミ川: { hp_max:500, mp_max:250 },
}

const LOCATIONS = ['日本海', 'カリブ海', 'ミミミッミ川']
const MIN_INTERVAL = 5 * 60  // 5分（秒）
const MAX_INTERVAL = 15 * 60 // 15分（秒）

// 強化石ドロップ
const STONE_DROP_RATE = 3 // 3%
const STONE_RANKS = ['f','e','d','c']
const STONE_WEIGHTS = { f:40, e:30, d:20, c:10 }
const STONE_NAMES = { f:'強化石(F)', e:'強化石(E)', d:'強化石(D)', c:'強化石(C)' }

// ============================================================
// ヘルパー関数
// ============================================================

const calcFishBonus = (fish, rank) => {
  const stats = FISH_RANK_BONUS_STATS[rank] || []
  const stat = stats[fish.statIdx]
  if (!stat) return null
  if (rank === 'a') return FISH_A_BONUS
  if (rank === 'sss') return FISH_SSS_BONUS
  const amount = FISH_RANK_BONUS_AMOUNT[rank] || 1
  const statMap = {
    atk: 'atk', def: 'def', matk: 'matk', mdef: 'mdef', spd: 'spd',
    hp: 'hp_max', mp: 'mp_max',
  }
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
  let t = MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL)
  // シード再現性のため時刻ベースの疑似乱数は使わず、経過秒数で回数を推定
  const avgInterval = (MIN_INTERVAL + MAX_INTERVAL) / 2
  const count = Math.floor(elapsed / avgInterval)
  for (let i = 0; i < count; i++) {
    const rank = drawFishRank()
    const fish = drawFish(location, rank)
    if (fish) results.push({ ...fish, location })
    // 強化石
    if (Math.random() * 100 < STONE_DROP_RATE) {
      const stoneRank = drawStone()
      results.push({ isStone: true, rank: stoneRank, name: STONE_NAMES[stoneRank], location })
    }
  }
  return results
}

// ============================================================
// メインコンポーネント
// ============================================================

export default function Fishing() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [session, setSession] = useState(null)
  const [caughtFish, setCaughtFish] = useState([])
  const [records, setRecords] = useState([]) // 図鑑
  const [selectedLocation, setSelectedLocation] = useState('日本海')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [tab, setTab] = useState('fishing') // 'fishing' | 'encyclopedia'
  const [encLocation, setEncLocation] = useState('日本海')
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    // アクティブなセッション確認
    const { data: sess } = await supabase.from('fishing_sessions')
      .select('*').eq('player_id', user.id).eq('is_active', true).single()
    setSession(sess || null)
    // 釣れた魚（未売却）
    if (sess) {
      const { data: caught } = await supabase.from('caught_fish')
        .select('*').eq('player_id', user.id).eq('session_id', sess.id)
        .order('caught_at')
      setCaughtFish(caught || [])
    } else {
      setCaughtFish([])
    }
    // 図鑑
    const { data: recs } = await supabase.from('fishing_records')
      .select('*').eq('player_id', user.id)
    setRecords(recs || [])
  }

  const showMessage = (msg, color = '#44ff88') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  // 釣り開始
const startFishing = async () => {
  if (!profile || session) return
  setLoading(true)
  const { data: sess, error } = await supabase.from('fishing_sessions').insert({
    player_id: profile.id,
    location: selectedLocation,
    started_at: new Date().toISOString(),
    is_active: true,
  }).select().single()
  if (error) {
    showMessage('釣り開始に失敗しました', '#ff4444')
    setLoading(false); return
  }
  setSession(sess)
  showMessage(`🎣 ${selectedLocation}で釣りを開始しました！`)
  setLoading(false)
}

  // 釣り終了（結果を計算してDBに保存）
  const endFishing = async () => {
    if (!session) return
    setLoading(true)
    const now = new Date()
    const results = calcCaughtFish(session.location, session.started_at, now)
    // caught_fishに保存
    for (const item of results) {
      await supabase.from('caught_fish').insert({
        player_id: profile.id,
        session_id: session.id,
        fish_name: item.name,
        fish_rank: item.rank,
        location: item.location,
        caught_at: new Date().toISOString(),
      })
    }
    // セッションを非アクティブに
    await supabase.from('fishing_sessions').update({ is_active: false }).eq('id', session.id)
    await fetchAll()
    showMessage(`🎣 釣りを終了しました！${results.length}匹釣れました！`)
    setLoading(false)
  }

  // 売却
  const sellAll = async () => {
    if (caughtFish.length === 0 || !session) return
    setLoading(true)
    let totalGold = 0
    const fishItems = caughtFish.filter(f => !f.fish_name?.startsWith('強化石'))
    const stoneItems = caughtFish.filter(f => f.fish_name?.startsWith('強化石'))

    // 魚の売却
    for (const fish of fishItems) {
      const rankKey = fish.fish_rank?.toLowerCase() || 'f'
      totalGold += FISH_SELL_PRICE[rankKey] || 5
      // 図鑑未登録なら登録
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
    // 強化石の付与
    for (const stone of stoneItems) {
      const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stone.fish_name).single()
      if (stoneItem) {
        const { data: existing } = await supabase.from('player_items')
          .select('*').eq('player_id', profile.id).eq('item_id', stoneItem.id).single()
          .catch(() => ({ data: null }))
        if (existing) {
          await supabase.from('player_items').update({ quantity: (existing.quantity||1)+1 }).eq('id', existing.id)
        } else {
          await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
        }
      }
    }
    // ゴールド加算
    await supabase.from('profiles').update({ gold: profile.gold + totalGold }).eq('id', profile.id)
    // caught_fish削除
    await supabase.from('caught_fish').delete().eq('player_id', profile.id).eq('session_id', session.id)
    // セッション削除
    await supabase.from('fishing_sessions').delete().eq('id', session.id)
    await fetchAll()
    showMessage(`💰 ${totalGold}G獲得！${stoneItems.length > 0 ? `強化石${stoneItems.length}個入手！` : ''}`)
    setLoading(false)
  }

  // 初回ボーナス受取
  const claimBonus = async (record) => {
    if (record.bonus_claimed) return
    setLoading(true)
    const rank = record.fish_rank?.toLowerCase() || 'f'
    const fishData = FISH_DATA[record.location]?.find(f => f.name === record.fish_name)
    if (!fishData) { setLoading(false); return }
    const bonus = calcFishBonus(fishData, rank)
    if (!bonus) { setLoading(false); return }
    // ステータス更新
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

  // コンプリートボーナス受取
  const claimCompleteBonus = async (location) => {
    setLoading(true)
    const allFish = FISH_DATA[location]
    const claimedNames = records.filter(r => r.location === location && r.bonus_claimed).map(r => r.fish_name)
    const allClaimed = allFish.every(f => claimedNames.includes(f.name))
    if (!allClaimed) { showMessage('まだ全部の魚を釣っていません！', '#ff4444'); setLoading(false); return }
    // コンプリートボーナスが既に適用済みかチェック（profilesテーブルに専用カラムがないのでlocal管理）
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
    if (!session) return ''
    const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
    const h = Math.floor(elapsed / 3600)
    const m = Math.floor((elapsed % 3600) / 60)
    const s = elapsed % 60
    if (h > 0) return `${h}時間${m}分${s}秒`
    if (m > 0) return `${m}分${s}秒`
    return `${s}秒`
  }

  const getEstimatedCount = () => {
    if (!session) return 0
    const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000
    const avg = (MIN_INTERVAL + MAX_INTERVAL) / 2
    return Math.floor(elapsed / avg)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  // 図鑑データ整理
  const encFish = FISH_DATA[encLocation] || []
  const encRecords = records.filter(r => r.location === encLocation)
  const allCaught = encFish.every(f => encRecords.some(r => r.fish_name === f.name))
  const allBonusClaimed = encFish.every(f => encRecords.some(r => r.fish_name === f.name && r.bonus_claimed))

  // caught_fishをランク別に集計
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
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
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

        {/* タブ */}
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

        {/* ===== 釣りタブ ===== */}
        {tab==='fishing' && (
          <div>
            {!session ? (
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
              </div>
            ) : (
              <div>
                {/* 釣り中 */}
                <div style={{ border:'1px solid #44aaff', background:'#001040', padding:'16px', marginBottom:'12px' }}>
                  <div style={{ color:'#44aaff', fontSize:'13px', marginBottom:'8px' }}>🎣 釣り中...</div>
                  <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'4px' }}>
                    場所: <span style={{color:'#ffcc00'}}>{session.location}</span>
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

                {/* 釣果一覧 */}
                {caughtFish.length > 0 && (
                  <div style={{ border:'1px solid #0044aa', background:'#001028', padding:'12px', marginBottom:'12px' }}>
                    <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>釣果一覧（前回分）</div>
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
            )}
          </div>
        )}

        {/* ===== 魚図鑑タブ ===== */}
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

            {/* コンプリートボーナス */}
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
                <button onClick={()=>claimCompleteBonus(encLocation)}
                  disabled={!allCaught || loading}
                  style={{ padding:'6px 10px', background: allCaught?'#1a1000':'#001', border:`1px solid ${allCaught?'#ffcc00':'#002244'}`, color: allCaught?'#ffcc00':'#334455', cursor: allCaught?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                  {allCaught ? '受け取る' : '未達成'}
                </button>
              </div>
            </div>

            {/* 魚一覧 */}
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
