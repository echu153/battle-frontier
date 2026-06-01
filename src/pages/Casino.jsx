import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

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
  const [finalResult, setFinalResult] = useState(null) // { type, pot }

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
    const bet = Math.floor(betAmount)
    if (!bet || bet < MIN_BET) { showMessage(`ベットは${MIN_BET}メダルからです`, '#ff4444'); return }
    if (bet > MAX_BET) { showMessage(`ベットは${MAX_BET}メダルまでです`, '#ff4444'); return }
    if ((profile.medals||0) < bet) { showMessage('メダルが足りません！', '#ff4444'); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('hilo_deal', { bet })
    if (error) { showMessage(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    setHiloGame(data)
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
      setFinalResult({ type: data.result, pot: data.pot })
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
      setFinalResult({ type: data.result, pot: 0 })
      setHiloPhase('result')
    }
    await fetchProfile()
    setLoading(false)
  }

  const hiloReset = () => { setHiloPhase('bet'); setHiloGame(null); setCard2(null); setPot(0); setStreak(0); setDoubleCard(null); setFinalResult(null) }

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
          {[{id:'exchange',label:'💰 両替所'},{id:'hilo',label:'🃏 ハイ&ロー'}].map(t=>(
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
                    {finalResult.type==='lose' && `😭 ハズレ… 没収`}
                    {finalResult.type==='bust' && `💥 7が出てバスト！ 没収`}
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
      </div>
    </div>
  )
}
