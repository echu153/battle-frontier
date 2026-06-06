import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { AREAS, JOB_GROWTH, JOB_LEVEL3_BONUS, calcExpNext, getEffectiveCap, generateDropBonus, ARTIFACT_BASE_NAMES } from './Game'

const SLOT_SYMBOLS = ['7️⃣', '⭐', '🔔', '🍇', '🍒', '🍋']
const PRIZES = [
  { key:'stoneF',    name:'強化石(F)',         price:100,   limit:5, today:false },
  { key:'stoneE',    name:'強化石(E)',         price:300,   limit:5, today:false },
  { key:'stoneD',    name:'強化石(D)',         price:900,   limit:5, today:false },
  { key:'stoneC',    name:'強化石(C)',         price:2700,  limit:5, today:false },
  { key:'stoneB',    name:'強化石(B)',         price:5000,  limit:1, today:true  },
  { key:'stoneA',    name:'強化石(A)',         price:10000, limit:1, today:true  },
  { key:'goldBlade', name:'ゴールドブレード', price:50000, limit:1, today:false, type:'equip', desc:'ATK+30 DEF+10 MDEF+10  特殊: クリティカル確率+5%' },
  { key:'fortuneRod',name:'フォーチュンロッド',price:50000, limit:1, today:false, type:'equip', desc:'MATK+40 MDEF+10  特殊: クリティカル確率+5%' },
  { key:'royalArmor',name:'ロイヤルアーマー', price:50000, limit:1, today:false, type:'equip', desc:'DEF+30 MDEF+20  特殊: クリティカル抵抗+10%' },
  { key:'luckyRing',    name:'幸運の指輪',       price:50000,  limit:1, today:false, type:'equip', desc:'全能力値+10  特殊: 回避率+5%（重複不可）' },
  { key:'gamblerProof', name:'ギャンブラーの証', price:100000, limit:1, today:false, type:'keyitem', desc:'ギャンブラーに転職できる証。1度きりの交換。' },
]
const SORTIE_WAIT = 30 // 賭博場出撃のクールダウン秒（通常出撃と共通のlast_action_atで管理）
// EXP凍結中か（手動のexp_frozen、または期限付きのexp_frozen_until）
const expIsFrozen = (p) => !!(p && (p.exp_frozen || (p.exp_frozen_until && new Date(p.exp_frozen_until) > new Date())))
const AUTOCLICK_SAMPLES = 12   // オートクリッカー検知：直近サンプル数
const AUTOCLICK_SPREAD_MS = 1200 // 出撃間隔のばらつき許容幅(ms)。これ未満なら機械的連打とみなす
const SORTIE_STREAK_LIMIT = 20  // カジノで遊ばず簡易出撃が連続したらBOTチャレンジ発動する回数
const AREA_PASS_EFFECT = { 2:'casino_area_2', 3:'casino_area_3', 4:'casino_area_4', 5:'casino_area_5', 6:'casino_area_6', 7:'casino_area_7' }

const EXCHANGE_RATE = 100 // 100G = 1メダル（SQLのrateと一致させること）
const EXCHANGE_OPTIONS = [1, 5, 10, 50, 100, 1000]
const MAX_BET = 1000 // SQLのmax_betと一致させること
const MIN_BET = 10
const BET_PRESETS = [10, 50, 100, 500, 1000]
// ランク1〜13 → カード表示（2が最弱・Aが最強）
const RANK_LABELS = ['', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export default function Casino() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const prevMedalsRef = useRef(null)
  const skipMedalGainRef = useRef(false)  // 両替によるメダル増加は累計獲得に含めない
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#ffaa00')
  const [tab, setTab] = useState('exchange')
  const [exchangeAmount, setExchangeAmount] = useState(1)
  // ハイ&ロー状態
  const [betAmount, setBetAmount] = useState(10)
  const [hiloPhase, setHiloPhase] = useState('bet') // bet → pick → double → result
  const [hiloGame, setHiloGame] = useState(null)     // { card1, mult_high, mult_low }
  const [card2, setCard2] = useState(null)           // メイン勝負の2枚目
  const [pot, setPot] = useState(0)                  // 現在の持ち分
  const [streak, setStreak] = useState(0)            // 倍々連勝数
  const [doubleCard, setDoubleCard] = useState(null) // 倍々でめくったカード
  const [finalResult, setFinalResult] = useState(null) // { type, pot, lost }
  const [lastBet, setLastBet] = useState(0)
  // スロット状態
  const [slotBet, setSlotBet] = useState(10)
  const [slotPhase, setSlotPhase] = useState('idle')   // idle → spinning → done
  const [slotResult, setSlotResult] = useState(null)   // { reels, mult, payout }
  const [slotDisplay, setSlotDisplay] = useState([0,0,0])
  const [slotStopped, setSlotStopped] = useState([false,false,false])
  const [slotMode, setSlotMode] = useState('normal')  // normal / at（次ゲームの状態）
  const [atGames, setAtGames] = useState(0)            // AT残りゲーム数
  const [navStep, setNavStep] = useState(0)            // ナビ押し順の進行（演出用）
  const [atTotalWin, setAtTotalWin] = useState(0)      // AT中の累計払い出し
  const [atResult, setAtResult] = useState(null)       // { success, payout } / CZは{success,czWon,kind:'cz'}
  const [czGames, setCzGames] = useState(0)            // CZ残りゲーム数
  const [tokuGames, setTokuGames] = useState(0)        // 特化ゾーン残りゲーム数
  const [tokuAdded, setTokuAdded] = useState(null)     // 直近の上乗せ量
  // 簡易出撃状態
  const [playerItems, setPlayerItems] = useState([])
  const [sortieArea, setSortieArea] = useState(1)
  const [sortiePending, setSortiePending] = useState({ count:0, exp:0, gold:0, drops:[] })
  const DEV_ACCOUNTS = []  // 停止・BAN対象外アカウント（現在なし。おれおれおも対象に含める）
  const sortieTimesRef = useRef([])     // オートクリッカー検知：簡易出撃時刻の履歴
  const [botCheck, setBotCheck] = useState(null)  // BOT確認チャレンジ {top,left} or null
  const botCheckTimerRef = useRef(null) // BOT確認チャレンジの60秒タイマー
  const botCheckActiveRef = useRef(false) // チャレンジ中フラグ（ボタン押下で解除＝停止を確実に防ぐ）
  const [showSettle, setShowSettle] = useState(false)
  const [sortieMsg, setSortieMsg] = useState('')
  const [now, setNow] = useState(Date.now())
  // 景品
  const [dailyNet, setDailyNet] = useState(0)
  const [dailyCounts, setDailyCounts] = useState({})
  const [prizeQty, setPrizeQty] = useState({})
  const [playerEquipment, setPlayerEquipment] = useState([])
  const spinRef = useRef(null)
  const slotStoppedRef = useRef([false,false,false])
  const pressOrderRef = useRef([])

  useEffect(() => { slotStoppedRef.current = slotStopped }, [slotStopped])
  useEffect(() => () => { if (spinRef.current) clearInterval(spinRef.current) }, [])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])

  useEffect(() => { initCasino() }, [])

  // 賭博場を開いた時：サーバーの進行中状態を復元（リロードしてもAT/ダブルアップ等を継続）
  const initCasino = async () => {
    await fetchProfile()
    await restoreCasinoState()
  }

  const restoreCasinoState = async () => {
    try {
      const { data } = await supabase.rpc('casino_state')
      if (!data) return
      const s = data.slot
      if (s && s.mode) {
        setSlotMode(s.mode)
        setAtGames(s.at_games || 0); setCzGames(s.cz_games || 0); setTokuGames(s.toku_games || 0)
        if (s.mode !== 'normal' && s.at_bet) setSlotBet(s.at_bet)
      }
      const h = data.hilo
      if (h) {
        if (h.phase === 'pick') {
          setHiloGame({ card1:h.card1, mult_high:h.mult_high, mult_low:h.mult_low })
          setLastBet(h.bet); setCard2(null); setHiloPhase('pick')
        } else if (h.phase === 'double') {
          setPot(h.pot); setStreak(h.streak); setDoubleCard(null); setHiloPhase('double')
        }
        setTab('hilo')
      } else if (s && s.mode && s.mode !== 'normal') {
        setTab('slot')
      }
    } catch {}
  }

  const loadDaily = async () => {
    const { data } = await supabase.rpc('casino_daily_get')
    if (data) { setDailyNet(data.net || 0); setDailyCounts(data.counts || {}) }
  }

  const equipPrizeOwned = (prize) => {
    if (prize.type === 'equip') return playerEquipment.some(pe => pe.weapons?.name === prize.name)
    if (prize.type === 'keyitem') return playerItems.some(pi => pi.items?.effect === 'gambler_proof' && (pi.quantity||0) > 0)
    return false
  }

  const exchangePrize = async (prize) => {
    if (loading) return
    const qty = 1
    const used = dailyCounts[prize.key] || 0
    if (used + qty > prize.limit) { showMessage('本日の交換上限を超えています', '#ff4444'); return }
    if ((profile.medals||0) < prize.price) { showMessage('メダルが足りません', '#ff4444'); return }
    if (prize.today && dailyNet < prize.price) { showMessage('当日獲得メダルが足りません', '#ff4444'); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('casino_exchange_prize', { prize_key: prize.key, qty })
    if (error) { showMessage(`交換失敗: ${error.message}`, '#ff4444'); setLoading(false); return }
    setPrizeQty(q => ({ ...q, [prize.key]: 1 }))
    await fetchProfile()
    showMessage(`🎁 ${prize.name} を交換しました！`, '#44ff88')
    setLoading(false)
  }

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    // メダル増加分を当日累計として追跡し称号用に保存
    if (prevMedalsRef.current !== null && p.medals > prevMedalsRef.current && !skipMedalGainRef.current) {
      const gained = p.medals - prevMedalsRef.current
      const todayKey = `bf_medal_day_${user.id}`
      const stored = JSON.parse(localStorage.getItem(todayKey) || '{"date":"","total":0}')
      const todayJST = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toDateString()
      const todayTotal = stored.date === todayJST ? stored.total + gained : gained
      localStorage.setItem(todayKey, JSON.stringify({ date: todayJST, total: todayTotal }))
      if (todayTotal > (p.gambling_medal_max_daily || 0)) {
        await supabase.from('profiles').update({ gambling_medal_max_daily: todayTotal }).eq('id', user.id)
        p.gambling_medal_max_daily = todayTotal
      }
      // 累計獲得メダル（両替除く）をランキング用に加算
      const newTotal = (p.total_medals_earned || 0) + gained
      await supabase.from('profiles').update({ total_medals_earned: newTotal }).eq('id', user.id)
      p.total_medals_earned = newTotal
    }
    skipMedalGainRef.current = false  // フラグは1回限り
    prevMedalsRef.current = p.medals
    setProfile(p)
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id)
    setPlayerItems(pi || [])
    const { data: pe } = await supabase.from('player_equipment').select('*, weapons(name)').eq('player_id', user.id)
    setPlayerEquipment(pe || [])
    // 未清算の戦果をlocalStorageから復元
    try {
      const saved = localStorage.getItem('bf_sortie_' + p.id)
      if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.count > 0) setSortiePending(parsed) }
    } catch {}
    await loadDaily()
  }

  const savePending = (pend) => {
    try {
      if (pend.count > 0) localStorage.setItem('bf_sortie_' + profile.id, JSON.stringify(pend))
      else localStorage.removeItem('bf_sortie_' + profile.id)
    } catch {}
  }

  const showMessage = (msg, color = '#ffaa00') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const suspendAccount = async (reason) => {
    if (DEV_ACCOUNTS.includes(profile.username)) return  // 開発用アカウントは対象外
    await supabase.from('profiles').update({ is_suspended: true, suspension_reason: reason }).eq('id', profile.id)
    showMessage('⛔ 不正行為が検出されました。アカウントを停止します。', '#ff4444')
    setTimeout(async () => { await supabase.auth.signOut() }, 3000)
  }

  // BOT確認チャレンジ：ランダム位置にボタンを出し、60秒以内に押さなければ停止措置
  const triggerBotCheck = () => {
    const top = Math.floor(15 + Math.random()*65)   // 15〜80vh
    const left = Math.floor(5 + Math.random()*65)   // 5〜70vw
    botCheckActiveRef.current = true
    setBotCheck({ top, left })
    if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current)
    botCheckTimerRef.current = setTimeout(async () => {
      botCheckTimerRef.current = null
      if (!botCheckActiveRef.current) return  // 既にボタンが押されていれば停止しない
      botCheckActiveRef.current = false
      setBotCheck(null)
      await suspendAccount('BOT確認ボタンを1分以内に押せなかった')
    }, 60000)
  }
  const passBotCheck = () => {
    botCheckActiveRef.current = false  // 先にフラグを落として停止を確実に無効化
    if (botCheckTimerRef.current) { clearTimeout(botCheckTimerRef.current); botCheckTimerRef.current = null }
    setBotCheck(null)
    sortieTimesRef.current = []  // 履歴リセットして再判定を回避
  }
  useEffect(() => () => { if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current) }, [])

  const botCheckOverlay = botCheck && (
    <div style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.88)' }}>
      <div style={{ position:'absolute', top:'24px', left:0, right:0, textAlign:'center', color:'#ffcc00', fontFamily:'monospace', fontSize:'13px', padding:'0 16px' }}>
        ⚠ 自動操作の疑いがあります。<br/>1分以内に下のボタンを押してください（未操作の場合アカウントを停止します）
      </div>
      <button onClick={passBotCheck}
        style={{ position:'absolute', top:`${botCheck.top}vh`, left:`${botCheck.left}vw`, padding:'14px 22px', background:'#1a0000', border:'2px solid #ff4444', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', whiteSpace:'nowrap' }}>
        🤖 私はBOTではありません
      </button>
    </div>
  )

  const exchange = async (medalCount) => {
    if (loading || !profile) return
    const goldCost = medalCount * EXCHANGE_RATE
    if (profile.gold < goldCost) { showMessage('Goldが足りません！', '#ff4444'); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('exchange_gold_to_medals', { gold_amount: goldCost })
    if (error) {
      showMessage(`両替に失敗しました: ${error.message}`, '#ff4444')
      setLoading(false)
      return
    }
    skipMedalGainRef.current = true  // この増加分は両替なので累計獲得に含めない
    await fetchProfile()
    showMessage(`💰 ${goldCost}Gを ${data.gained}メダルに両替しました！`, '#ffcc00')
    setLoading(false)
  }

  // ハイ&ロー：カードを引く
  const hiloDeal = async () => {
    if (loading || !profile) return
    if (profile.is_fishing) { showMessage('🎣 釣り中は賭博場で遊べません', '#ff8844'); return }
    await supabase.from('profiles').update({ sortie_streak: 0 }).eq('id', profile.id)
    setProfile(p => ({ ...p, sortie_streak: 0 }))
    const bet = Math.floor(betAmount)
    if (!bet || bet < MIN_BET) { showMessage(`ベットは${MIN_BET}メダルからです`, '#ff4444'); return }
    if (bet > MAX_BET) { showMessage(`ベットは${MAX_BET}メダルまでです`, '#ff4444'); return }
    if ((profile.medals||0) < bet) { showMessage('メダルが足りません！', '#ff4444'); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('hilo_deal', { bet })
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setHiloGame(data)
    setLastBet(bet)
    setCard2(null); setPot(0); setStreak(0); setDoubleCard(null); setFinalResult(null)
    setHiloPhase('pick')
    await fetchProfile()
    setLoading(false)
  }

  // ハイ&ロー：メインのHigh/Low勝負
  const hiloPick = async (choice) => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('hilo_pick', { choice })
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setCard2(data.card2)
    if (data.result === 'win') {
      setPot(data.pot); setStreak(0); setDoubleCard(null)
      setHiloPhase('double')
    } else {
      // push（返却）または lose（賭け金没収）
      setFinalResult({ type: data.result, pot: data.pot, lost: data.result==='lose' ? lastBet : 0 })
      setHiloPhase('result')
    }
    await fetchProfile()
    setLoading(false)
  }

  // 倍々チャンス：確定して受け取る
  const hiloTake = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('hilo_take')
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setFinalResult({ type: 'take', pot: data.pot })
    setHiloPhase('result')
    await fetchProfile()
    setLoading(false)
  }

  // 倍々チャンス：High/Lowを宣言してめくる
  const hiloDouble = async (choice) => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('hilo_double', { choice })
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setDoubleCard(data.card)
    if (data.result === 'win' && !data.finished) {
      setPot(data.pot); setStreak(data.streak)
    } else if (data.result === 'win' && data.finished) {
      setPot(data.pot); setStreak(data.streak)
      setFinalResult({ type: 'maxed', pot: data.pot })
      setHiloPhase('result')
    } else {
      // bust または lose：その時点の持ち分を全没収
      setFinalResult({ type: data.result, pot: 0, lost: pot })
      setHiloPhase('result')
    }
    await fetchProfile()
    setLoading(false)
  }

  const hiloReset = () => { setHiloPhase('bet'); setHiloGame(null); setCard2(null); setPot(0); setStreak(0); setDoubleCard(null); setFinalResult(null) }

  // スロット：レバーON（サーバーで結果確定→リール回転開始）
  const slotLever = async () => {
    if (loading || slotPhase==='spinning' || !profile) return
    if (profile.is_fishing) { showMessage('🎣 釣り中は賭博場で遊べません', '#ff8844'); return }
    await supabase.from('profiles').update({ sortie_streak: 0 }).eq('id', profile.id)
    setProfile(p => ({ ...p, sortie_streak: 0 }))
    const bet = Math.floor(slotBet)
    if (slotMode==='normal') {
      if (!bet || bet < MIN_BET) { showMessage(`ベットは${MIN_BET}メダルからです`, '#ff4444'); return }
      if (bet > MAX_BET) { showMessage(`ベットは${MAX_BET}メダルまでです`, '#ff4444'); return }
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('slot_spin', { bet })
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setSlotResult(data)
    setSlotStopped([false,false,false])
    setNavStep(0)
    setAtResult(null)
    setTokuAdded(null)
    pressOrderRef.current = []
    setSlotPhase('spinning')
    if (spinRef.current) clearInterval(spinRef.current)
    spinRef.current = setInterval(() => {
      setSlotDisplay(prev => prev.map((v,idx) => (slotStoppedRef.current[idx] ? v : Math.floor(Math.random()*SLOT_SYMBOLS.length))))
    }, 80)
    setLoading(false)
  }

  // 特化ゾーン：上乗せ（無料・レバーのみ）
  const slotToku = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('slot_toku')
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setTokuAdded(data.added)
    setAtGames(data.at_games)
    setTokuGames(data.toku_games)
    setSlotMode(data.mode)
    setAtTotalWin(w => w)  // 据え置き
    setLoading(false)
  }

  // スロット：リールを止める（どのボタンも押せる。AT中は押し順が違うと失敗）
  const slotStop = async (idx) => {
    if (slotPhase!=='spinning' || slotStopped[idx] || !slotResult) return
    pressOrderRef.current = [...pressOrderRef.current, idx]
    if (slotResult.pending) setNavStep(s => s + 1)
    const nextStopped = slotStopped.map((v,i) => i===idx ? true : v)
    setSlotStopped(nextStopped)
    setSlotDisplay(prev => prev.map((v,i) => i===idx ? slotResult.reels[i] : v))
    if (nextStopped.every(Boolean)) {
      if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null }
      if (slotResult.pending) {
        // CZ/AT のナビ判定をサーバーで
        setLoading(true)
        const { data, error } = await supabase.rpc('slot_at_resolve', { press_order: pressOrderRef.current })
        if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
        setSlotMode(data.mode)
        if (!data.success) setSlotDisplay([2,2,5]) // こぼし演出
        if (data.kind === 'cz') {
          setAtResult({ kind:'cz', success:data.success, czWon:data.at_won })
          setCzGames(data.cz_games)
          if (data.at_won) { setAtGames(data.at_games); setAtTotalWin(0) }
        } else {
          setAtResult({ kind:'at', success:data.success, payout:data.payout, toku:data.toku_triggered, bonus:data.bonus||0, added:data.added||0 })
          setAtGames(data.at_games)
          if (data.success) setAtTotalWin(w => w + data.payout + (data.bonus||0))
        }
        setSlotPhase('done')
        await fetchProfile()
        setLoading(false)
      } else {
        // 通常スピン
        setSlotPhase('done')
        setSlotMode(slotResult.mode)
        setCzGames(slotResult.cz_games || 0)
        setAtGames(slotResult.at_games || 0)
        if (slotResult.at_entered) setAtTotalWin(0)
        fetchProfile()
      }
    }
  }

  const slotReset = () => { setSlotPhase('idle'); setSlotResult(null); setSlotStopped([false,false,false]); setNavStep(0); setAtResult(null); setTokuAdded(null); pressOrderRef.current = [] }

  // 簡易出撃：エリア解放判定
  const isAreaUnlocked = (areaId) => {
    if (areaId === 1) return true
    const eff = AREA_PASS_EFFECT[areaId]
    return playerItems.some(pi => pi.items?.effect === eff && (pi.quantity||0) > 0)
  }

  // 簡易出撃：クールダウン残り秒
  const sortieRemain = () => {
    if (!profile?.last_action_at) return 0
    const elapsed = (now - new Date(profile.last_action_at).getTime()) / 1000
    return Math.max(0, Math.ceil(SORTIE_WAIT - elapsed))
  }

  // 簡易出撃：1回出撃（ボス/パピア無し・必ず勝利）
  const doSortie = async (e) => {
    if (loading || !profile) return
    if (botCheck) return  // BOT確認チャレンジ中は出撃不可
    if (e && !e.isTrusted) { await suspendAccount('自動操作が検出されました'); return }
    if (profile.is_fishing) { setSortieMsg('🎣 釣り中は出撃できません'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()) { setSortieMsg('⛔ 異常な行動を検出。出撃禁止中です'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (!isAreaUnlocked(sortieArea)) { setSortieMsg('このエリアの出撃許可証を持っていません'); setTimeout(()=>setSortieMsg(''),2500); return }
    if (sortieRemain() > 0) { setSortieMsg(`次の出撃まで ${sortieRemain()}秒`); setTimeout(()=>setSortieMsg(''),1500); return }
    setLoading(true)
    // ★ どこかで例外が出ても loading を必ず false に戻し、画面が固まる（リロードまで操作不可）のを防ぐ
    try {
      // 共通の last_action_at で30秒ロック（不正対策）
      const lockTime = new Date(Date.now() - SORTIE_WAIT * 1000).toISOString()
      const { data: locked } = await supabase.from('profiles')
        .update({ last_action_at: new Date().toISOString() })
        .eq('id', profile.id).lt('last_action_at', lockTime).eq('is_fishing', false).select('id')
      if (!locked || locked.length === 0) {
        await fetchProfile()
        setSortieMsg('⏳ クールダウン中です（街の出撃と共通）'); setTimeout(()=>setSortieMsg(''),2500)
        return
      }

      // オートクリッカー検知①：出撃間隔が異常に規則的（一定間隔の機械的連打）なら12時間出撃禁止
      if (!DEV_ACCOUNTS.includes(profile.username)) {
        const times = sortieTimesRef.current
        times.push(Date.now())
        if (times.length > AUTOCLICK_SAMPLES) times.shift()
        if (times.length >= AUTOCLICK_SAMPLES) {
          const intervals = times.slice(1).map((t,i) => t - times[i])
          const spread = Math.max(...intervals) - Math.min(...intervals)
          if (spread < AUTOCLICK_SPREAD_MS) {
            triggerBotCheck()
            return
          }
        }
      }

      // 簡易出撃連続検知：カジノで遊ばず連続SORTIE_STREAK_LIMIT回でBOTチャレンジ発動
      const newStreak = (profile.sortie_streak || 0) + 1
      if (newStreak >= SORTIE_STREAK_LIMIT) {
        await supabase.from('profiles').update({ sortie_streak: 0 }).eq('id', profile.id)
        setProfile(p => ({ ...p, sortie_streak: 0 }))
        triggerBotCheck()
        return
      } else {
        await supabase.from('profiles').update({ sortie_streak: newStreak }).eq('id', profile.id)
        setProfile(p => ({ ...p, sortie_streak: newStreak }))
      }

      const area = AREAS.find(a => a.id === sortieArea) || AREAS[0]
      const enemies = area.enemies || []
      const cap = getEffectiveCap(profile.class, profile.retraining)
      const isAtCap = profile.lv >= cap
      const frozen = expIsFrozen(profile)
      const expGain = (isAtCap || frozen) ? 0 : Math.floor(Math.random()*4) + 8
      const zako = enemies.length > 0 ? enemies[Math.floor(Math.random()*enemies.length)] : null
      const goldGain = zako?.gold || 0
      if (goldGain >= 5000 && (profile.gambling_gold_max_single || 0) < goldGain) {
        await supabase.from('profiles').update({ gambling_gold_max_single: goldGain }).eq('id', profile.id)
      }

      // ドロップ（通常の非ボスと同じ確率）
      const drops = []
      const commonDrops = area.commonDrops || []
      const rareDrops = area.rareDrops || []
      if (commonDrops.length > 0 && Math.random()*100 < 3) {
        if (rareDrops.length > 0 && Math.random()*100 < 10) drops.push(rareDrops[Math.floor(Math.random()*rareDrops.length)])
        else drops.push(commonDrops[Math.floor(Math.random()*commonDrops.length)])
      }
      if (Math.random()*100 < 0.1) drops.push(ARTIFACT_BASE_NAMES[Math.floor(Math.random()*ARTIFACT_BASE_NAMES.length)])

      setSortiePending(prev => {
        const next = {
          count: prev.count + 1,
          exp: prev.exp + expGain,
          gold: prev.gold + goldGain,
          drops: [...prev.drops, ...drops],
        }
        savePending(next)
        return next
      })
      // 出撃ごとに重いfetchProfile()を呼ぶと画面が固まるため、
      // クールダウン表示に必要な last_action_at だけローカル更新する（清算時にまとめて反映）
      setProfile(p => ({ ...p, last_action_at: new Date().toISOString() }))
    } catch (err) {
      console.error('簡易出撃エラー:', err)
      setSortieMsg('⚠ 出撃処理でエラーが発生しました。もう一度お試しください')
      setTimeout(()=>setSortieMsg(''),2500)
    } finally {
      setLoading(false)
    }
  }

  // 簡易出撃：清算（蓄積した戦果をまとめて反映）
  const settleSortie = async () => {
    if (loading) return
    const pend = sortiePending
    if (pend.count === 0) { setShowSettle(false); return }
    setLoading(true)
    const cap = getEffectiveCap(profile.class, profile.retraining)
    const isAtCap = profile.lv >= cap
    const frozen = expIsFrozen(profile)
    const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
    const bonusSlots = JOB_LEVEL3_BONUS[profile.class] || []

    let newExp = profile.exp + (frozen ? 0 : pend.exp)
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPending = profile.pending_stat_points || 0
    let newCharLv = profile.char_lv || 1
    let stat = { hp_max:profile.hp_max, mp_max:profile.mp_max, atk:profile.atk, def:profile.def, matk:profile.matk, mdef:profile.mdef, spd:profile.spd }
    const learnedSkillNames = []

    if (!isAtCap && !frozen) {
      while (newExp >= newExpNext && newLv < cap) {
        newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv); newPending++; newCharLv++
        stat = { hp_max:stat.hp_max+growth.hp, mp_max:stat.mp_max+growth.mp, atk:stat.atk+growth.atk, def:stat.def+growth.def, matk:stat.matk+growth.matk, mdef:stat.mdef+growth.mdef, spd:stat.spd+growth.spd }
        if (bonusSlots.length > 0 && newLv%3===0) { const bi = Math.floor(newLv/3-1)%bonusSlots.length; stat[bonusSlots[bi]] = (stat[bonusSlots[bi]]||0)+1 }
        // レベルアップでスキル習得
        const { data: lvupSkills } = await supabase.from('skills').select('*').eq('class_name', profile.class).eq('required_lv', newLv)
        const { data: learned } = await supabase.from('player_skills').select('skill_id').eq('player_id', profile.id)
        const learnedIds = (learned||[]).map(s => s.skill_id)
        for (const sk of (lvupSkills||[])) {
          if (!learnedIds.includes(sk.id)) { await supabase.from('player_skills').insert({ player_id:profile.id, skill_id:sk.id }); learnedSkillNames.push(sk.name) }
        }
      }
      if (newLv >= cap) { newExp = 0; newExpNext = calcExpNext(cap) }
    }

    await supabase.from('profiles').update({
      exp:newExp, exp_next:newExpNext, lv:newLv, gold: profile.gold + pend.gold,
      pending_stat_points:newPending, char_lv:newCharLv, ...stat,
    }).eq('id', profile.id)
    // class_levels も同期
    const { data: cl } = await supabase.from('class_levels').select('id').eq('player_id', profile.id).eq('class_name', profile.class).maybeSingle()
    if (cl && !isAtCap && !frozen) await supabase.from('class_levels').update({ lv:newLv, exp:newExp }).eq('id', cl.id)

    // ドロップ付与
    for (const name of pend.drops) {
      const { data: weapon } = await supabase.from('weapons').select('*').eq('name', name).single()
      if (weapon) {
        const isArti = ARTIFACT_BASE_NAMES.includes(weapon.name)
        const bonusData = isArti ? {} : generateDropBonus(weapon)
        await supabase.from('player_equipment').insert({ player_id:profile.id, weapon_id:weapon.id, slot:weapon.slot, equipped:false, ...bonusData })
      }
    }

    setSortiePending({ count:0, exp:0, gold:0, drops:[] })
    savePending({ count:0 })
    setShowSettle(false)
    await fetchProfile()
    setLoading(false)
    showMessage(`清算完了！ EXP+${pend.exp} Gold+${pend.gold}${pend.drops.length?` ドロップ${pend.drops.length}個`:''}${learnedSkillNames.length?` スキル習得:${learnedSkillNames.join('・')}`:''}`, '#44ff88')
  }

  // 街に戻る：未清算があれば清算を促す
  const tryLeave = () => {
    if (sortiePending.count > 0) { setShowSettle(true); return }
    nav('/game')
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      {botCheckOverlay}
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={tryLeave} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ border:'1px dashed #ff8844', background:'#1a0800', color:'#ff8844', fontSize:'11px', padding:'8px', marginBottom:'12px', textAlign:'center' }}>
          🚧 賭博場はテスト中です。仕様や倍率は予告なく変更される場合があります 🚧
        </div>

        {profile.is_fishing && (
          <div style={{ border:'1px solid #44aaff', background:'#001028', color:'#44aaff', fontSize:'12px', padding:'10px', marginBottom:'12px', textAlign:'center' }}>
            🎣 釣り中は賭博場で遊べません。先に釣りを終了してください。
          </div>
        )}

        <div style={{ color:'#ffaa00', fontSize:'14px', marginBottom:'4px' }}>🎰 賭博場</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', display:'flex', gap:'16px' }}>
          <span>所持金: <span style={{color:'#ffcc00'}}>{profile.gold.toLocaleString()}G</span></span>
          <span>メダル: <span style={{color:'#ffaa00'}}>🎫 {(profile.medals||0).toLocaleString()}</span></span>
          <span>当日獲得: <span style={{color:'#44ff88'}}>{dailyNet.toLocaleString()}</span></span>
        </div>

        {message && (
          <div style={{ color:messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        <div style={{ display:'flex', gap:'4px', marginBottom:'12px', flexWrap:'wrap' }}>
          {[{id:'exchange',label:'💰 両替所'},{id:'hilo',label:'🃏 ハイ&ロー'},{id:'slot',label:'🎰 スロット'},{id:'prize',label:'🎁 景品'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ padding:'6px 14px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                background: tab===t.id?'#1a1000':'#000818',
                border:`1px solid ${tab===t.id?'#ffaa00':'#003366'}`,
                color: tab===t.id?'#ffaa00':'#446688' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==='exchange' && (
          <div style={{ border:'1px solid #886600', background:'#0a0800', padding:'16px' }}>
            <div style={{ color:'#ffaa00', fontSize:'13px', marginBottom:'8px' }}>💰 メダル両替所</div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', lineHeight:'1.8' }}>
              Goldをメダルに両替できます。<br/>
              レート: <span style={{color:'#ffcc00'}}>{EXCHANGE_RATE}G</span> = <span style={{color:'#ffaa00'}}>🎫 1メダル</span><br/>
              ※ メダルからGoldへの払い戻しはできません
            </div>
            {(() => {
              const cost = exchangeAmount * EXCHANGE_RATE
              const canBuy = profile.gold >= cost
              return (
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <select value={exchangeAmount} onChange={e=>setExchangeAmount(Number(e.target.value))}
                    style={{ flex:1, background:'#001028', border:'1px solid #886600', color:'#ffaa00', fontFamily:'monospace', fontSize:'12px', padding:'8px' }}>
                    {EXCHANGE_OPTIONS.map(n => (
                      <option key={n} value={n}>🎫 {n.toLocaleString()}メダル （{(n*EXCHANGE_RATE).toLocaleString()}G）</option>
                    ))}
                  </select>
                  <button onClick={()=>exchange(exchangeAmount)} disabled={!canBuy || loading}
                    style={{ padding:'8px 16px', background: canBuy?'#1a1000':'#001', border:`1px solid ${canBuy?'#ffaa00':'#002244'}`, color: canBuy?'#ffaa00':'#334455', cursor: canBuy?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'12px', whiteSpace:'nowrap' }}>
                    両替する
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {tab==='hilo' && (
          <div style={{ border:'1px solid #886600', background:'#0a0800', padding:'16px' }}>
            <div style={{ color:'#ffaa00', fontSize:'13px', marginBottom:'8px' }}>🃏 ハイ&ロー</div>
            <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
              1枚目を見て、次のカードが <span style={{color:'#ff6688'}}>High（大きい）</span> か <span style={{color:'#66aaff'}}>Low（小さい）</span> かを予想。<br/>
              強さ順: 2 → 3 → … → 10 → J → Q → K → A<br/>
              堅い予想ほど低倍率・際どい予想ほど高倍率。引き分けは賭け金が戻ります。
            </div>

            {/* ベット設定 */}
            <div style={{ marginBottom:'12px', opacity: hiloPhase==='bet'?1:0.5, pointerEvents: hiloPhase==='bet'?'auto':'none' }}>
              <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>ベット額（{MIN_BET}〜{MAX_BET}）</div>
              <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'6px' }}>
                {BET_PRESETS.map(n => (
                  <button key={n} onClick={()=>setBetAmount(n)}
                    style={{ padding:'4px 8px', background: betAmount===n?'#1a1000':'#000818', border:`1px solid ${betAmount===n?'#ffaa00':'#003366'}`, color: betAmount===n?'#ffaa00':'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                    {n}
                  </button>
                ))}
              </div>
              <input type="number" min={MIN_BET} max={MAX_BET} value={betAmount}
                onChange={e=>setBetAmount(Math.min(MAX_BET, Math.max(MIN_BET, Math.floor(Number(e.target.value)||0))))}
                style={{ width:'100%', background:'#001028', border:'1px solid #886600', color:'#ffaa00', fontFamily:'monospace', fontSize:'13px', padding:'8px', boxSizing:'border-box' }} />
            </div>

            {/* カード表示エリア（メイン勝負）。倍々フェーズでは倍々カードを表示 */}
            {hiloPhase !== 'double' && !(hiloPhase==='result' && (finalResult?.type==='take'||finalResult?.type==='maxed'||finalResult?.type==='bust'||finalResult?.type==='lose') && doubleCard) && (
              <div style={{ display:'flex', justifyContent:'center', gap:'16px', alignItems:'center', margin:'16px 0' }}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ color:'#446688', fontSize:'9px', marginBottom:'4px' }}>1枚目</div>
                  <div style={{ width:'64px', height:'88px', border:'2px solid #ffaa00', borderRadius:'6px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', color:'#ffcc00', fontSize:'28px', fontWeight:'bold' }}>
                    {hiloGame ? RANK_LABELS[hiloGame.card1] : '?'}
                  </div>
                </div>
                <div style={{ color:'#446688', fontSize:'20px' }}>VS</div>
                <div style={{ textAlign:'center' }}>
                  <div style={{ color:'#446688', fontSize:'9px', marginBottom:'4px' }}>2枚目</div>
                  <div style={{ width:'64px', height:'88px', border:'2px solid #446688', borderRadius:'6px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', color:'#88ccff', fontSize:'28px', fontWeight:'bold' }}>
                    {card2 ? RANK_LABELS[card2] : '?'}
                  </div>
                </div>
              </div>
            )}

            {/* 操作エリア */}
            {hiloPhase==='bet' && (
              <button onClick={hiloDeal} disabled={loading || (profile.medals||0) < betAmount}
                style={{ width:'100%', padding:'12px', background:'#1a1000', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                🎴 {betAmount}メダルでカードを引く
              </button>
            )}

            {hiloPhase==='pick' && hiloGame && (
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={()=>hiloPick('high')} disabled={loading || hiloGame.mult_high<=0}
                  style={{ flex:1, padding:'12px', background:'#1a0008', border:'1px solid #ff6688', color:'#ff6688', cursor: hiloGame.mult_high>0?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'13px', opacity: hiloGame.mult_high>0?1:0.4 }}>
                  ▲ High<br/><span style={{ fontSize:'11px' }}>×{hiloGame.mult_high}</span>
                </button>
                <button onClick={()=>hiloPick('low')} disabled={loading || hiloGame.mult_low<=0}
                  style={{ flex:1, padding:'12px', background:'#000818', border:'1px solid #66aaff', color:'#66aaff', cursor: hiloGame.mult_low>0?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'13px', opacity: hiloGame.mult_low>0?1:0.4 }}>
                  ▼ Low<br/><span style={{ fontSize:'11px' }}>×{hiloGame.mult_low}</span>
                </button>
              </div>
            )}

            {/* 倍々チャンス */}
            {hiloPhase==='double' && (
              <div>
                {doubleCard && (
                  <div style={{ display:'flex', justifyContent:'center', margin:'12px 0' }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ color:'#446688', fontSize:'9px', marginBottom:'4px' }}>めくったカード</div>
                      <div style={{ width:'64px', height:'88px', border:'2px solid #44ff88', borderRadius:'6px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', color:'#44ff88', fontSize:'28px', fontWeight:'bold' }}>
                        {RANK_LABELS[doubleCard]}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ textAlign:'center', padding:'10px', marginBottom:'10px', border:'1px solid #44ff88', color:'#44ff88', fontSize:'14px' }}>
                  🎉 現在の持ち分: <span style={{ fontSize:'18px', fontWeight:'bold' }}>{pot.toLocaleString()}</span> メダル<br/>
                  <span style={{ fontSize:'11px', color:'#88ccaa' }}>ダブルアップ {streak}/5</span>
                </div>
                <button onClick={hiloTake} disabled={loading}
                  style={{ width:'100%', padding:'10px', marginBottom:'8px', background:'#001a0a', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                  💰 確定して {pot.toLocaleString()} メダル受け取る
                </button>
                <div style={{ color:'#446688', fontSize:'10px', textAlign:'center', marginBottom:'6px' }}>▼ ダブルアップ（当たれば2倍・7か逆で全没収）</div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={()=>hiloDouble('high')} disabled={loading}
                    style={{ flex:1, padding:'12px', background:'#1a0008', border:'1px solid #ff6688', color:'#ff6688', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                    ▲ High<br/><span style={{ fontSize:'10px' }}>(8〜A)</span>
                  </button>
                  <button onClick={()=>hiloDouble('low')} disabled={loading}
                    style={{ flex:1, padding:'12px', background:'#000818', border:'1px solid #66aaff', color:'#66aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                    ▼ Low<br/><span style={{ fontSize:'10px' }}>(2〜6)</span>
                  </button>
                </div>
              </div>
            )}

            {hiloPhase==='result' && finalResult && (
              <div>
                {(finalResult.type==='bust'||finalResult.type==='lose'||finalResult.type==='maxed'||finalResult.type==='take') && doubleCard && (
                  <div style={{ display:'flex', justifyContent:'center', margin:'12px 0' }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ color:'#446688', fontSize:'9px', marginBottom:'4px' }}>めくったカード</div>
                      <div style={{ width:'64px', height:'88px', border:'2px solid #446688', borderRadius:'6px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', color:'#88ccff', fontSize:'28px', fontWeight:'bold' }}>
                        {RANK_LABELS[doubleCard]}
                      </div>
                    </div>
                  </div>
                )}
                {finalResult.type==='maxed' ? (
                  <div style={{ textAlign:'center', padding:'20px 10px', marginBottom:'10px',
                    border:'3px double #ffcc00', background:'linear-gradient(180deg,#1a1400,#0a0800)', color:'#ffcc00' }}>
                    <div style={{ fontSize:'28px', marginBottom:'4px' }}>🎊👑🎊</div>
                    <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px', marginBottom:'4px' }}>5連勝 ダブルアップ制覇！</div>
                    <div style={{ fontSize:'13px', color:'#fff0a0', marginBottom:'8px' }}>✨ G R A N D   W I N ✨</div>
                    <div style={{ fontSize:'24px', fontWeight:'bold', color:'#ffee44' }}>🎫 {finalResult.pot.toLocaleString()} メダル獲得！</div>
                    <div style={{ fontSize:'20px', marginTop:'6px' }}>🎉🎰🎉🎰🎉</div>
                  </div>
                ) : (
                  <div style={{ textAlign:'center', padding:'10px', marginBottom:'10px', fontSize:'15px',
                    color: finalResult.type==='take'?'#44ff88':finalResult.type==='push'?'#ffcc00':'#ff4444',
                    border:`1px solid ${finalResult.type==='take'?'#44ff88':finalResult.type==='push'?'#ffcc00':'#ff4444'}` }}>
                    {finalResult.type==='take' && `💰 ${finalResult.pot.toLocaleString()}メダル獲得！`}
                    {finalResult.type==='push' && `🤝 引き分け 賭け金返却`}
                    {finalResult.type==='lose' && `😭 ハズレ… ${finalResult.lost.toLocaleString()}メダル没収`}
                    {finalResult.type==='bust' && `💥 7が出てバスト！ ${finalResult.lost.toLocaleString()}メダル没収`}
                  </div>
                )}
                <button onClick={hiloReset} disabled={loading}
                  style={{ width:'100%', padding:'12px', background:'#1a1000', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                  もう一度
                </button>
              </div>
            )}
          </div>
        )}

        {tab==='slot' && (() => {
          const navMode = slotMode==='cz' || slotMode==='at'
          const accent = slotMode==='at' ? '#ff4488' : slotMode==='cz' ? '#44ddff' : slotMode==='toku' ? '#ffcc00' : '#886600'
          const bg = slotMode==='at' ? '#1a0014' : slotMode==='cz' ? '#001824' : slotMode==='toku' ? '#1a1400' : '#0a0800'
          return (
          <div style={{ border:`1px solid ${accent}`, background: bg, padding:'16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <div style={{ color: accent, fontSize:'13px' }}>🎰 スロット</div>
              {slotMode==='cz'   && <div style={{ color:'#88e0ff', fontSize:'12px', fontWeight:'bold' }}>⚡ CZ中 残り{czGames}G</div>}
              {slotMode==='at'   && <div style={{ color:'#ff88bb', fontSize:'12px', fontWeight:'bold' }}>🔥 AT中 残り{atGames}G</div>}
              {slotMode==='toku' && <div style={{ color:'#ffee44', fontSize:'12px', fontWeight:'bold' }}>💫 特化ゾーン 残り{tokuGames}G</div>}
            </div>
            {slotMode==='normal' && (
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                レバーを引いて3つのストップボタンで止めよう。<br/>
                7️⃣7️⃣7️⃣=×250（AT直撃！）/ ⭐×60 / 🔔×25 / 🍇×16 / 🍒×12 / 🍋×12 / 左🍒=返却。<br/>
                たまに <span style={{color:'#44ddff'}}>⚡CZ</span> 突入！ナビ成功でAT当選を狙え！
              </div>
            )}
            {slotMode==='cz' && (
              <div style={{ color:'#88e0ff', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                ⚡ チャンスゾーン！ ナビ（①②③）の順に押すとAT当選抽選！5G以内に当てろ！
              </div>
            )}
            {slotMode==='at' && (
              <div style={{ color:'#ff88bb', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                🔥 アシストタイム！ ナビ通り押すと出玉。たまに💫特化ゾーンで上乗せ！<br/>
                AT累計獲得: <span style={{color:'#ffcc00'}}>{atTotalWin.toLocaleString()}枚</span>
              </div>
            )}
            {slotMode==='toku' && (
              <div style={{ color:'#ffee44', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                💫 特化ゾーン！ レバーを引くたびにATゲーム数を上乗せ！
              </div>
            )}

            {/* リール表示 */}
            {slotMode!=='toku' && (
              <div style={{ display:'flex', justifyContent:'center', gap:'8px', margin:'16px 0' }}>
                {[0,1,2].map(i => {
                  const navOrder = (slotResult?.pending && slotResult?.nav) ? slotResult.nav.indexOf(i)+1 : 0
                  const isNextReel = slotResult?.pending && slotResult?.nav && slotResult.nav[navStep]===i && !slotStopped[i]
                  return (
                    <div key={i} style={{ position:'relative', width:'72px', height:'96px',
                      border:`3px solid ${slotStopped[i]?'#ffcc00':(isNextReel?'#ffffff':(navMode?accent:'#664400'))}`, borderRadius:'8px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'44px',
                      boxShadow: isNextReel ? `0 0 14px ${accent}` : 'none' }}>
                      {SLOT_SYMBOLS[slotDisplay[i]]}
                      {slotPhase==='spinning' && slotResult?.pending && navOrder>0 && !slotStopped[i] && (
                        <div style={{ position:'absolute', top:'-12px', left:'50%', transform:'translateX(-50%)',
                          background: isNextReel?'#ffffff':'#222', color: isNextReel?accent:'#888', fontSize:isNextReel?'16px':'12px', fontWeight:'bold', borderRadius:'50%', width:isNextReel?'28px':'20px', height:isNextReel?'28px':'20px', display:'flex', alignItems:'center', justifyContent:'center',
                          boxShadow: isNextReel ? `0 0 10px ${accent}` : 'none' }}>
                          {navOrder}
                        </div>
                      )}
                      {isNextReel && <div style={{ position:'absolute', bottom:'-18px', left:'50%', transform:'translateX(-50%)', color:accent, fontSize:'16px' }}>▲</div>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ストップボタン */}
            {slotPhase==='spinning' && slotMode!=='toku' && (
              <div style={{ display:'flex', gap:'8px', marginBottom:'8px' }}>
                {['左','中','右'].map((label,i) => {
                  const isNext = slotResult?.pending && slotResult?.nav && slotResult.nav[navStep]===i && !slotStopped[i]
                  return (
                    <button key={i} onClick={()=>slotStop(i)} disabled={slotStopped[i]}
                      style={{ flex:1, padding:'14px', background: slotStopped[i]?'#001':(isNext?accent:'#1a1000'), border:`2px solid ${slotStopped[i]?'#002244':(isNext?'#ffffff':'#ffaa00')}`, color: slotStopped[i]?'#334455':(isNext?'#000':'#ffaa00'), cursor: slotStopped[i]?'default':'pointer', fontFamily:'monospace', fontSize:'14px', fontWeight:'bold', boxShadow: isNext?`0 0 12px ${accent}`:'none' }}>
                      {slotStopped[i]?'■':(isNext?`▶ ${label} ◀`:`STOP ${label}`)}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 特化ゾーン操作 */}
            {slotMode==='toku' && (
              <div style={{ margin:'16px 0' }}>
                {tokuAdded !== null && (
                  <div style={{ textAlign:'center', padding:'20px', marginBottom:'12px', border:'3px double #ffcc00', background:'linear-gradient(180deg,#1a1400,#0a0800)' }}>
                    <div style={{ fontSize:'14px', color:'#ffee44', marginBottom:'4px' }}>💫 上乗せ 💫</div>
                    <div style={{ fontSize:'34px', fontWeight:'bold', color:'#ffee44' }}>+{tokuAdded}G</div>
                    <div style={{ fontSize:'12px', color:'#ccaa44', marginTop:'4px' }}>AT残り {atGames}G</div>
                  </div>
                )}
                <button onClick={slotToku} disabled={loading}
                  style={{ width:'100%', padding:'16px', background:'#2a2000', border:'1px solid #ffcc00', color:'#ffee44', cursor:'pointer', fontFamily:'monospace', fontSize:'15px', letterSpacing:'2px' }}>
                  💫 上乗せ抽選！（残り{tokuGames}G）
                </button>
              </div>
            )}

            {/* ベット＆レバー（通常/CZ/AT） */}
            {slotPhase!=='spinning' && slotMode!=='toku' && (
              <div>
                {slotMode==='normal' && (
                  <div style={{ opacity: slotPhase==='idle'?1:0.6 }}>
                    <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>ベット額（{MIN_BET}〜{MAX_BET}）</div>
                    <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'6px' }}>
                      {BET_PRESETS.map(n => (
                        <button key={n} onClick={()=>setSlotBet(n)}
                          style={{ padding:'4px 8px', background: slotBet===n?'#1a1000':'#000818', border:`1px solid ${slotBet===n?'#ffaa00':'#003366'}`, color: slotBet===n?'#ffaa00':'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <input type="number" min={MIN_BET} max={MAX_BET} value={slotBet}
                      onChange={e=>setSlotBet(Math.min(MAX_BET, Math.max(MIN_BET, Math.floor(Number(e.target.value)||0))))}
                      style={{ width:'100%', background:'#001028', border:'1px solid #886600', color:'#ffaa00', fontFamily:'monospace', fontSize:'13px', padding:'8px', boxSizing:'border-box', marginBottom:'10px' }} />
                  </div>
                )}

                {slotPhase==='done' && slotResult && (
                  <>
                    {/* CZ突入演出 */}
                    {slotResult.cz_entered && (
                      <div style={{ textAlign:'center', padding:'16px', marginBottom:'10px', border:'3px double #44ddff', background:'linear-gradient(180deg,#001828,#000810)', color:'#88e0ff' }}>
                        <div style={{ fontSize:'24px', marginBottom:'4px' }}>⚡⚡⚡</div>
                        <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px' }}>CZ 突入！</div>
                        <div style={{ fontSize:'12px', color:'#aae8ff', marginTop:'4px' }}>ナビ成功でAT当選を狙え！</div>
                      </div>
                    )}
                    {/* AT直撃演出 */}
                    {slotResult.at_entered && (
                      <div style={{ textAlign:'center', padding:'16px', marginBottom:'10px', border:'3px double #ff4488', background:'linear-gradient(180deg,#2a0018,#0a0008)', color:'#ff88bb' }}>
                        <div style={{ fontSize:'24px', marginBottom:'4px' }}>🔥⚡🔥</div>
                        <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px' }}>AT 直撃！！</div>
                        <div style={{ fontSize:'12px', color:'#ffccdd', marginTop:'4px' }}>アシストタイム {atGames}ゲーム突入！</div>
                      </div>
                    )}
                    {/* CZ当選/特化突入演出 */}
                    {atResult?.kind==='cz' && atResult.czWon && (
                      <div style={{ textAlign:'center', padding:'16px', marginBottom:'10px', border:'3px double #ff4488', background:'linear-gradient(180deg,#2a0018,#0a0008)', color:'#ff88bb' }}>
                        <div style={{ fontSize:'24px', marginBottom:'4px' }}>🎉🔥🎉</div>
                        <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px' }}>AT 当選！！</div>
                        <div style={{ fontSize:'12px', color:'#ffccdd', marginTop:'4px' }}>アシストタイム {atGames}ゲーム突入！</div>
                      </div>
                    )}
                    {atResult?.kind==='at' && atResult.toku && (
                      <div style={{ textAlign:'center', padding:'16px', marginBottom:'10px', border:'3px double #ffcc00', background:'linear-gradient(180deg,#1a1400,#0a0800)', color:'#ffee44' }}>
                        <div style={{ fontSize:'24px', marginBottom:'4px' }}>💫✨💫</div>
                        <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px' }}>上乗せ！</div>
                        <div style={{ fontSize:'14px', color:'#fff0a0', marginTop:'4px' }}>+{atResult.added}G ＆ +{(atResult.bonus||0).toLocaleString()}メダル！</div>
                      </div>
                    )}

                    {/* 結果メッセージ */}
                    <div style={{ textAlign:'center', padding:'10px', marginBottom:'10px', fontSize:'15px',
                      color: slotResult.pending ? (atResult?.success?'#44ff88':'#ff4444') : (slotResult.payout>0?'#44ff88':'#ff4444'),
                      border:`1px solid ${slotResult.pending ? (atResult?.success?'#44ff88':'#ff4444') : (slotResult.payout>0?'#44ff88':'#ff4444')}` }}>
                      {slotResult.kind==='cz' ? (atResult?.success ? (atResult.czWon ? `🔔 ナビ成功！` : `🔔 ナビ成功！ …AT当選ならず`) : `💢 ナビ失敗… こぼした！`)
                        : slotResult.kind==='at' ? (atResult?.success ? `🔔 ナビ成功！ +${atResult.payout.toLocaleString()}枚！` : `💢 ナビ失敗… こぼした！（払い出しなし）`)
                        : slotResult.mult>=250 ? `🎊7️⃣7️⃣7️⃣ 大当たり！🎊 ${slotResult.payout.toLocaleString()}メダル！`
                        : slotResult.payout>slotResult.bet ? `🎉 当たり！ ${slotResult.payout.toLocaleString()}メダル獲得！（×${slotResult.mult}）`
                        : slotResult.payout>0 ? `🍒 賭け金返却（×${slotResult.mult}）`
                        : `😭 ハズレ… ${slotResult.bet.toLocaleString()}メダル没収`}
                    </div>

                    {/* CZ失敗 */}
                    {slotResult.kind==='cz' && atResult && !atResult.czWon && slotMode==='normal' && (
                      <div style={{ textAlign:'center', padding:'8px', marginBottom:'10px', border:'1px solid #446688', color:'#446688', fontSize:'13px' }}>
                        ⚡ CZ失敗… また次回！
                      </div>
                    )}
                    {/* AT終了 */}
                    {slotResult.kind==='at' && slotMode==='normal' && (
                      <div style={{ textAlign:'center', padding:'8px', marginBottom:'10px', border:'1px solid #ffcc00', color:'#ffcc00', fontSize:'13px' }}>
                        🎉 AT終了！ 今回の合計 {atTotalWin.toLocaleString()}枚獲得！
                      </div>
                    )}
                  </>
                )}

                <button onClick={slotLever} disabled={loading || (slotMode==='normal' && (profile.medals||0) < slotBet)}
                  style={{ width:'100%', padding:'14px', background: navMode?'#2a0018':'#1a1000', border:`1px solid ${accent}`, color: accent, cursor:'pointer', fontFamily:'monospace', fontSize:'15px', letterSpacing:'2px' }}>
                  {slotMode==='cz' ? `⚡ CZ レバーON（残り${czGames}G）`
                    : slotMode==='at' ? `🔥 AT レバーON（残り${atGames}G）`
                    : `🎰 レバーON（${slotBet}メダル）`}
                </button>
              </div>
            )}
          </div>
          )
        })()}

        {tab==='prize' && (
          <div style={{ border:'1px solid #886600', background:'#0a0800', padding:'16px' }}>
            <div style={{ color:'#ffaa00', fontSize:'13px', marginBottom:'8px' }}>🎁 景品交換所</div>
            <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
              交換上限は毎日午前5時にリセット。<br/>
              <span style={{color:'#44ff88'}}>当日獲得</span>マークの景品は「その日にゲームで稼いだメダル」が必要です（両替分は対象外）。
            </div>
            <div style={{ textAlign:'left' }}>
            {PRIZES.map(p => {
              const used = dailyCounts[p.key] || 0
              const remain = p.limit - used
              const enoughMedals = (profile.medals||0) >= p.price
              const enoughToday = !p.today || dailyNet >= p.price
              const alreadyOwned = equipPrizeOwned(p)
              const canBuy = remain > 0 && enoughMedals && enoughToday && !alreadyOwned
              const borderColor = p.type==='equip' ? '#664400' : p.today ? '#446644' : '#003366'
              return (
                <div key={p.key} style={{ border:`1px solid ${borderColor}`, background:'#001028', padding:'10px', marginBottom:'6px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#88ccff', fontSize:'12px' }}>
                        {p.name}
                        {p.today && <span style={{ color:'#44ff88', fontSize:'9px', marginLeft:'6px', border:'1px solid #44ff88', padding:'1px 4px' }}>当日獲得</span>}
                        {p.type==='equip' && <span style={{ color:'#ffaa44', fontSize:'9px', marginLeft:'6px', border:'1px solid #ffaa44', padding:'1px 4px' }}>装備</span>}
                      </div>
                      <div style={{ color:'#ffaa00', fontSize:'11px', marginTop:'2px' }}>🎫 {p.price.toLocaleString()}</div>
                      {p.desc && <div style={{ color:'#557799', fontSize:'10px', marginTop:'2px' }}>{p.desc}</div>}
                      <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                        {(p.type==='equip' || p.type==='keyitem') ? '1度きりの交換' : `本日 残り${remain}/${p.limit}個`}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                      <button onClick={()=>exchangePrize(p)} disabled={!canBuy || loading}
                        style={{ padding:'8px 14px', background: canBuy?'#1a1000':'#001', border:`1px solid ${canBuy?'#ffaa00':'#002244'}`, color: canBuy?'#ffaa00':'#334455', cursor: canBuy?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>
                        {alreadyOwned ? '所持済み' : remain<=0 ? '上限' : !enoughMedals ? 'メダル不足' : !enoughToday ? '当日不足' : '交換'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}

        {/* ⚔ 簡易出撃パネル（常設・タブ非依存） */}
        {(() => {
          const remain = sortieRemain()
          const unlocked = isAreaUnlocked(sortieArea)
          const availableAreas = AREAS.filter(a => isAreaUnlocked(a.id))
          return (
            <div style={{ border:'1px solid #335577', background:'#001020', padding:'14px', marginTop:'16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <div style={{ color:'#66aaff', fontSize:'13px' }}>⚔ 簡易出撃</div>
                {sortiePending.count > 0 && (
                  <button onClick={()=>setShowSettle(true)} style={{ background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', padding:'3px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                    📋 戦果({sortiePending.count})
                  </button>
                )}
              </div>
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'10px', lineHeight:'1.6' }}>
                ボス・パピアなし／必ず勝利。{SORTIE_WAIT}秒に1回出撃でき、戦果は貯まります。街に戻る前に清算してください。
              </div>

              <div style={{ marginBottom:'8px' }}>
                <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>出撃エリア</div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                  {AREAS.map(a => {
                    const ok = isAreaUnlocked(a.id)
                    const sel = sortieArea === a.id
                    return (
                      <button key={a.id} onClick={()=> ok && setSortieArea(a.id)} disabled={!ok}
                        style={{ padding:'4px 8px', background: sel?'#001840':'#000818', border:`1px solid ${sel?'#66aaff':(ok?'#335577':'#222')}`, color: sel?'#66aaff':(ok?'#88aacc':'#445'), cursor: ok?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>
                        {ok ? `${a.id}.${a.name}` : `🔒${a.id}`}
                      </button>
                    )
                  })}
                </div>
              </div>

              {sortieMsg && <div style={{ color:'#ff8844', fontSize:'11px', textAlign:'center', marginBottom:'6px' }}>{sortieMsg}</div>}

              <button onClick={doSortie} disabled={loading || !unlocked || remain>0 || profile.is_fishing}
                style={{ width:'100%', padding:'12px', background: (remain>0||!unlocked)?'#001':'#001830', border:`1px solid ${(remain>0||!unlocked)?'#223':'#0088cc'}`, color: (remain>0||!unlocked)?'#445':'#00aaff', cursor:(loading||remain>0||!unlocked)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'14px', letterSpacing:'1px' }}>
                {!unlocked ? '🔒 出撃許可証が必要' : remain>0 ? `⏳ 次の出撃まで ${remain}秒` : `⚔ 出撃する（エリア${sortieArea}）`}
              </button>
            </div>
          )
        })()}
      </div>

      {/* 清算モーダル */}
      {showSettle && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
          <div style={{ background:'#001020', border:'1px solid #ffcc00', padding:'20px', maxWidth:'420px', width:'100%' }}>
            <div style={{ color:'#ffcc00', fontSize:'15px', marginBottom:'12px', textAlign:'center' }}>📋 出撃の戦果（清算）</div>
            {sortiePending.count === 0 ? (
              <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'12px' }}>戦果はありません</div>
            ) : (
              <div style={{ fontSize:'12px', color:'#88ccff', lineHeight:'2', marginBottom:'12px' }}>
                <div>出撃回数: <span style={{color:'#ffcc00'}}>{sortiePending.count}回</span></div>
                <div>獲得EXP: <span style={{color:'#44ff88'}}>{sortiePending.exp.toLocaleString()}</span></div>
                <div>獲得Gold: <span style={{color:'#ffcc00'}}>{sortiePending.gold.toLocaleString()}</span></div>
                <div>ドロップ: <span style={{color:'#44ff88'}}>{sortiePending.drops.length}個</span></div>
                {sortiePending.drops.length > 0 && (
                  <div style={{ fontSize:'10px', color:'#88aacc', lineHeight:'1.6' }}>
                    {Object.entries(sortiePending.drops.reduce((m,n)=>{m[n]=(m[n]||0)+1;return m},{})).map(([n,c])=>`${n}${c>1?`×${c}`:''}`).join('、')}
                  </div>
                )}
              </div>
            )}
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={()=>setShowSettle(false)} disabled={loading}
                style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>戻る</button>
              {sortiePending.count > 0
                ? <button onClick={settleSortie} disabled={loading}
                    style={{ flex:2, padding:'10px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>清算して受け取る</button>
                : <button onClick={()=>{ setShowSettle(false); nav('/game') }}
                    style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088cc', color:'#00aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>街に戻る</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
