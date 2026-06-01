import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SLOT_SYMBOLS = ['7️⃣', '⭐', '🔔', '🍇', '🍒', '🍋']

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
  const [navStep, setNavStep] = useState(0)            // ナビ押し順の進行
  const [atTotalWin, setAtTotalWin] = useState(0)      // AT中の累計払い出し
  const spinRef = useRef(null)
  const slotStoppedRef = useRef([false,false,false])

  useEffect(() => { slotStoppedRef.current = slotStopped }, [slotStopped])
  useEffect(() => () => { if (spinRef.current) clearInterval(spinRef.current) }, [])

  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    setProfile(p)
  }

  const showMessage = (msg, color = '#ffaa00') => {
    setMessage(msg); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

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
    await fetchProfile()
    showMessage(`💰 ${goldCost}Gを ${data.gained}メダルに両替しました！`, '#ffcc00')
    setLoading(false)
  }

  // ハイ&ロー：カードを引く
  const hiloDeal = async () => {
    if (loading || !profile) return
    if (profile.is_fishing) { showMessage('🎣 釣り中は賭博場で遊べません', '#ff8844'); return }
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
    setSlotPhase('spinning')
    if (spinRef.current) clearInterval(spinRef.current)
    spinRef.current = setInterval(() => {
      setSlotDisplay(prev => prev.map((v,idx) => (slotStoppedRef.current[idx] ? v : Math.floor(Math.random()*SLOT_SYMBOLS.length))))
    }, 80)
    setLoading(false)
  }

  // スロット：リールを止める
  const slotStop = (idx) => {
    if (slotPhase!=='spinning' || slotStopped[idx] || !slotResult) return
    // ATゲーム中はナビの押し順を厳守（違う順は無効）
    if (slotResult.is_at_game && slotResult.nav) {
      if (idx !== slotResult.nav[navStep]) return
      setNavStep(s => s + 1)
    }
    const nextStopped = slotStopped.map((v,i) => i===idx ? true : v)
    setSlotStopped(nextStopped)
    setSlotDisplay(prev => prev.map((v,i) => i===idx ? slotResult.reels[i] : v))
    if (nextStopped.every(Boolean)) {
      if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null }
      setSlotPhase('done')
      setSlotMode(slotResult.mode)
      setAtGames(slotResult.at_games)
      // AT累計払い出しの集計
      if (slotResult.is_at_game) setAtTotalWin(w => w + slotResult.payout)
      if (slotResult.at_triggered) setAtTotalWin(0)
      fetchProfile()
    }
  }

  const slotReset = () => { setSlotPhase('idle'); setSlotResult(null); setSlotStopped([false,false,false]); setNavStep(0) }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ border:'1px dashed #ff8844', background:'#1a0800', color:'#ff8844', fontSize:'11px', padding:'8px', marginBottom:'12px', textAlign:'center' }}>
          🚧 賭博場は現在テスト中です。仕様や倍率は予告なく変更される場合があります 🚧
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
        </div>

        {message && (
          <div style={{ color:messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        <div style={{ display:'flex', gap:'4px', marginBottom:'12px', flexWrap:'wrap' }}>
          {[{id:'exchange',label:'💰 両替所'},{id:'hilo',label:'🃏 ハイ&ロー'},{id:'slot',label:'🎰 スロット'}].map(t=>(
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

        {tab==='slot' && (
          <div style={{ border:`1px solid ${slotMode==='at'?'#ff4488':'#886600'}`, background: slotMode==='at'?'#1a0014':'#0a0800', padding:'16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <div style={{ color: slotMode==='at'?'#ff4488':'#ffaa00', fontSize:'13px' }}>🎰 スロット</div>
              {slotMode==='at' && (
                <div style={{ color:'#ff88bb', fontSize:'12px', fontWeight:'bold' }}>🔥 AT中 残り{atGames}G</div>
              )}
            </div>
            {slotMode==='normal' ? (
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                レバーを引いて3つのストップボタンで止めよう。<br/>
                7️⃣7️⃣7️⃣=×250（AT確定！）/ ⭐×60 / 🔔×25 / 🍇×16 / 🍒×12 / 🍋×12 / 左🍒=賭け金返却
              </div>
            ) : (
              <div style={{ color:'#ff88bb', fontSize:'10px', marginBottom:'12px', lineHeight:'1.7' }}>
                🔥 アシストタイム中！ ナビ（①②③）の順にボタンを押すと確定で出玉！<br/>
                AT累計獲得: <span style={{color:'#ffcc00'}}>{atTotalWin.toLocaleString()}枚</span>
              </div>
            )}

            {/* リール表示（ATスピン中はナビ番号を表示） */}
            <div style={{ display:'flex', justifyContent:'center', gap:'8px', margin:'16px 0' }}>
              {[0,1,2].map(i => {
                const navOrder = (slotResult?.is_at_game && slotResult?.nav) ? slotResult.nav.indexOf(i)+1 : 0
                return (
                  <div key={i} style={{ position:'relative', width:'72px', height:'96px', border:`3px solid ${slotStopped[i]?'#ffcc00':(slotMode==='at'||slotResult?.is_at_game)?'#ff4488':'#664400'}`, borderRadius:'8px', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'44px' }}>
                    {SLOT_SYMBOLS[slotDisplay[i]]}
                    {slotPhase==='spinning' && slotResult?.is_at_game && navOrder>0 && !slotStopped[i] && (
                      <div style={{ position:'absolute', top:'-10px', left:'50%', transform:'translateX(-50%)', background:'#ff4488', color:'#fff', fontSize:'13px', fontWeight:'bold', borderRadius:'50%', width:'22px', height:'22px', display:'flex', alignItems:'center', justifyContent:'center',
                      boxShadow: navOrder===navStep+1 ? '0 0 8px #ff88bb' : 'none', opacity: navOrder===navStep+1?1:0.5 }}>
                        {navOrder}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ストップボタン */}
            {slotPhase==='spinning' && (
              <div style={{ display:'flex', gap:'8px', marginBottom:'8px' }}>
                {['左','中','右'].map((label,i) => {
                  const isNext = slotResult?.is_at_game && slotResult?.nav && slotResult.nav[navStep]===i
                  return (
                    <button key={i} onClick={()=>slotStop(i)} disabled={slotStopped[i]}
                      style={{ flex:1, padding:'14px', background: slotStopped[i]?'#001':(isNext?'#3a0020':'#1a1000'), border:`1px solid ${slotStopped[i]?'#002244':(isNext?'#ff88bb':'#ffaa00')}`, color: slotStopped[i]?'#334455':(isNext?'#ff88bb':'#ffaa00'), cursor: slotStopped[i]?'default':'pointer', fontFamily:'monospace', fontSize:'14px', fontWeight:'bold' }}>
                      {slotStopped[i]?'■':`STOP ${label}`}
                    </button>
                  )
                })}
              </div>
            )}

            {/* ベット＆レバー */}
            {slotPhase!=='spinning' && (
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
                    {slotResult.at_triggered && (
                      <div style={{ textAlign:'center', padding:'16px', marginBottom:'10px', border:'3px double #ff4488', background:'linear-gradient(180deg,#2a0018,#0a0008)', color:'#ff88bb' }}>
                        <div style={{ fontSize:'24px', marginBottom:'4px' }}>🔥⚡🔥</div>
                        <div style={{ fontSize:'18px', fontWeight:'bold', letterSpacing:'2px' }}>AT GET！！</div>
                        <div style={{ fontSize:'12px', color:'#ffccdd', marginTop:'4px' }}>アシストタイム {atGames}ゲーム突入！</div>
                      </div>
                    )}
                    <div style={{ textAlign:'center', padding:'10px', marginBottom:'10px', fontSize:'15px',
                      color: slotResult.payout>0?'#44ff88':'#ff4444', border:`1px solid ${slotResult.payout>0?'#44ff88':'#ff4444'}` }}>
                      {slotResult.is_at_game ? `🔔 ナビ成功！ +${slotResult.payout.toLocaleString()}枚！`
                        : slotResult.mult>=250 ? `🎊7️⃣7️⃣7️⃣ 大当たり！🎊 ${slotResult.payout.toLocaleString()}メダル！`
                        : slotResult.payout>slotResult.bet ? `🎉 当たり！ ${slotResult.payout.toLocaleString()}メダル獲得！（×${slotResult.mult}）`
                        : slotResult.payout>0 ? `🍒 賭け金返却（×${slotResult.mult}）`
                        : `😭 ハズレ… ${slotResult.bet.toLocaleString()}メダル没収`}
                    </div>
                    {slotResult.is_at_game && slotResult.mode==='normal' && (
                      <div style={{ textAlign:'center', padding:'8px', marginBottom:'10px', border:'1px solid #ffcc00', color:'#ffcc00', fontSize:'13px' }}>
                        🎉 AT終了！ 今回の合計 {atTotalWin.toLocaleString()}枚獲得！
                      </div>
                    )}
                  </>
                )}

                <button onClick={slotLever} disabled={loading || (slotMode==='normal' && (profile.medals||0) < slotBet) || (slotMode==='at' && (profile.medals||0) < (slotResult?.bet||0))}
                  style={{ width:'100%', padding:'14px', background: slotMode==='at'?'#2a0018':'#1a1000', border:`1px solid ${slotMode==='at'?'#ff4488':'#ffaa00'}`, color: slotMode==='at'?'#ff88bb':'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'15px', letterSpacing:'2px' }}>
                  {slotMode==='at' ? `🔥 AT レバーON（残り${atGames}G）` : `🎰 レバーON（${slotBet}メダル）`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
