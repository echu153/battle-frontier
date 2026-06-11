import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// かかし修練場
// ・出撃100回（簡易出撃を除く）で1回チャージ、週5回まで（月曜朝5時リセット）
// ・3〜8時間を設定し、解除せず時間経過でEXP獲得（途中解除は報酬なし）
// ・チャージ/開始/解除/受取はすべてサーバーRPCで検証
const HOUR_OPTIONS = [
  { hours: 3, exp: 200 },
  { hours: 4, exp: 300 },
  { hours: 5, exp: 450 },
  { hours: 6, exp: 600 },
  { hours: 7, exp: 850 },
  { hours: 8, exp: 1000 },
]

function Countdown({ targetIso, onFinish }) {
  const [left, setLeft] = useState('')
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetIso).getTime() - Date.now()
      if (diff <= 0) { setLeft('完了！'); onFinish?.(); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setLeft(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])
  return <span>{left}</span>
}

export default function Scarecrow() {
  const nav = useNavigate()
  const [state, setState] = useState(null)
  const [selectedHours, setSelectedHours] = useState(3)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [claimResult, setClaimResult] = useState(null)
  const [, setTickFinished] = useState(false)

  useEffect(() => { fetchState() }, [])

  const showMsg = (text, color = '#44ff88') => {
    setMessage(text); setMessageColor(color)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchState = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    // 開発中: 管理者アカウント限定
    const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    if (!me?.is_admin) { nav('/game'); return }
    const { data, error } = await supabase.rpc('scarecrow_state')
    if (error || data?.error) {
      setLoadError(data?.error || error?.message || 'エラーが発生しました')
      return
    }
    setLoadError(null)
    setState(data)
  }

  const startTraining = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('scarecrow_start', { p_hours: selectedHours })
    if (error || data?.error) {
      showMsg(data?.error || 'エラーが発生しました', '#ff4444')
    } else {
      showMsg(`🌾 修練開始！ ${selectedHours}時間後まで解除しなければ EXP+${data.exp_reward}`)
      await fetchState()
    }
    setLoading(false)
  }

  // 開発用: 1分で完了するテスト修練
  const startTest = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('scarecrow_start_test')
    if (error || data?.error) {
      showMsg(data?.error || 'エラーが発生しました', '#ff4444')
    } else {
      showMsg('🧪 1分テスト修練を開始しました')
      await fetchState()
    }
    setLoading(false)
  }

  const cancelTraining = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('scarecrow_cancel')
    if (error || data?.error) {
      showMsg(data?.error || 'エラーが発生しました', '#ff4444')
    } else {
      showMsg('修練を解除しました（経験値はもらえません）', '#ffaa44')
      await fetchState()
    }
    setShowCancelConfirm(false)
    setLoading(false)
  }

  const claimReward = async () => {
    if (loading) return
    setLoading(true)
    const { data, error } = await supabase.rpc('scarecrow_claim')
    if (error || data?.error) {
      showMsg(data?.error || 'エラーが発生しました', '#ff4444')
    } else {
      setClaimResult(data)
      await fetchState()
    }
    setLoading(false)
  }

  if (loadError) {
    return (
      <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ border:'1px solid #663333', background:'#100008', padding:'24px', textAlign:'center', maxWidth:'420px' }}>
          <div style={{ color:'#ff6666', fontSize:'13px', marginBottom:'8px' }}>かかし修練場を読み込めませんでした</div>
          <div style={{ color:'#996666', fontSize:'11px', marginBottom:'8px', wordBreak:'break-all' }}>{loadError}</div>
          <div style={{ color:'#446688', fontSize:'10px', marginBottom:'16px' }}>※ supabase_scarecrow.sql が未適用の可能性があります</div>
          <button onClick={() => nav('/game')} style={{ padding:'8px 20px', background:'none', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>← 街に戻る</button>
        </div>
      </div>
    )
  }
  if (!state) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const session = state.session
  const finished = session && (session.finished || new Date(session.ends_at) <= new Date())

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'12px' }}>🌾 かかし修練場</div>

        {message && (
          <div style={{ color: messageColor, fontSize:'12px', textAlign:'center', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px' }}>{message}</div>
        )}

        {/* 受け取り結果 */}
        {claimResult && (
          <div style={{ border:'1px solid #44aa44', background:'#001a08', padding:'14px', marginBottom:'14px', textAlign:'center' }}>
            <div style={{ color:'#44ff88', fontSize:'14px', marginBottom:'6px' }}>✨ 修練完了！</div>
            {claimResult.exp > 0 ? (
              <div style={{ color:'#ffcc44', fontSize:'13px' }}>
                EXP +{claimResult.exp}
                {claimResult.level_ups > 0 && <span style={{ color:'#44ff88', marginLeft:'8px' }}>LVが{claimResult.level_ups}上がった！（LV{claimResult.new_lv}）</span>}
              </div>
            ) : (
              <div style={{ color:'#ffaa44', fontSize:'12px' }}>
                {claimResult.at_cap ? 'レベルキャップに到達しているため経験値は獲得できませんでした' : '経験値は獲得できませんでした'}
              </div>
            )}
          </div>
        )}

        {/* 修練回数 */}
        <div style={{ border:'1px solid #002244', background:'#000e20', padding:'12px', marginBottom:'14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
            <span style={{ color:'#446688', fontSize:'11px' }}>修練回数</span>
            <span style={{ color:'#ffcc44', fontSize:'13px' }}>{state.charges} / 5 回</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
            <span style={{ color:'#446688', fontSize:'11px' }}>次のチャージまで</span>
            <span style={{ color:'#88ccff', fontSize:'11px' }}>{state.charges >= 5 ? '満タン（週上限）' : `出撃あと${100 - (state.progress || 0)}回`}</span>
          </div>
          {state.charges < 5 && (
            <div style={{ background:'#001028', height:'6px', border:'1px solid #002244' }}>
              <div style={{ height:'100%', width:`${state.progress || 0}%`, background:'linear-gradient(90deg,#332200,#ffcc44)' }} />
            </div>
          )}
          <div style={{ color:'#334455', fontSize:'10px', marginTop:'6px' }}>
            ※ 出撃100回で1回チャージ（簡易出撃は対象外）。週5回まで・毎週月曜朝5時にリセット
          </div>
        </div>

        {/* 修練中 */}
        {session ? (
          <div style={{ border:`1px solid ${finished ? '#44aa44' : '#886600'}`, background: finished ? '#001a08' : '#0a0800', padding:'20px', textAlign:'center', marginBottom:'14px' }}>
            <div style={{ fontSize:'40px', marginBottom:'10px' }}>🌾</div>
            {finished ? (
              <>
                <div style={{ color:'#44ff88', fontSize:'14px', marginBottom:'10px' }}>修練完了！</div>
                <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'14px' }}>報酬: EXP +{session.exp_reward}</div>
                <button onClick={claimReward} disabled={loading}
                  style={{ padding:'12px 40px', background:'#001a08', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'14px' }}>
                  {loading ? '処理中...' : '🎁 報酬を受け取る'}
                </button>
              </>
            ) : (
              <>
                <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'6px' }}>修練中... （{session.duration_hours}時間設定）</div>
                <div style={{ color:'#88ccff', fontSize:'22px', marginBottom:'6px' }}>
                  <Countdown targetIso={session.ends_at} onFinish={() => setTickFinished(v => !v)} />
                </div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>
                  終了予定: {new Date(session.ends_at).toLocaleString('ja-JP')}
                </div>
                <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'14px' }}>
                  完了まで解除しなければ EXP +{session.exp_reward}
                </div>
                <div style={{ color:'#884444', fontSize:'10px', marginBottom:'10px' }}>
                  ※ 修練中は 出撃・レイドボス・賭博場・釣り・挑戦・ダンジョン を利用できません
                </div>
                {showCancelConfirm ? (
                  <div style={{ border:'1px solid #ff4444', background:'#1a0000', padding:'14px' }}>
                    <div style={{ color:'#ff6666', fontSize:'12px', lineHeight:'1.8', marginBottom:'10px' }}>
                      ⚠ 本当に解除しますか？<br/>
                      <span style={{ color:'#ffcc44' }}>途中で解除すると経験値は一切もらえません！</span><br/>
                      使用した修練回数も戻りません。
                    </div>
                    <div style={{ display:'flex', gap:'8px', justifyContent:'center' }}>
                      <button onClick={cancelTraining} disabled={loading}
                        style={{ padding:'8px 20px', background:'#1a0000', border:'1px solid #ff4444', color:'#ff4444', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        {loading ? '処理中...' : '解除する（報酬なし）'}
                      </button>
                      <button onClick={() => setShowCancelConfirm(false)} disabled={loading}
                        style={{ padding:'8px 20px', background:'none', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        修練を続ける
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowCancelConfirm(true)}
                    style={{ padding:'6px 20px', background:'none', border:'1px solid #663333', color:'#996666', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                    修練を解除する...
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          /* 開始パネル */
          <div style={{ border:'1px solid #002244', background:'#000e20', padding:'14px', marginBottom:'14px' }}>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'10px' }}>修練時間を選択（1回ごとに設定・開始後は変更不可）</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'6px', marginBottom:'12px' }}>
              {HOUR_OPTIONS.map(o => (
                <button key={o.hours} onClick={() => setSelectedHours(o.hours)}
                  style={{
                    padding:'10px 4px',
                    background: selectedHours === o.hours ? '#1a1400' : '#000818',
                    border:`1px solid ${selectedHours === o.hours ? '#ffcc44' : '#002244'}`,
                    color: selectedHours === o.hours ? '#ffcc44' : '#446688',
                    cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
                  }}>
                  {o.hours}時間<br/><span style={{ fontSize:'10px' }}>EXP {o.exp}</span>
                </button>
              ))}
            </div>
            <button onClick={startTraining} disabled={loading || state.charges <= 0}
              style={{
                width:'100%', padding:'12px',
                background: state.charges > 0 ? '#1a1400' : '#000818',
                border:`1px solid ${state.charges > 0 ? '#ffcc44' : '#002244'}`,
                color: state.charges > 0 ? '#ffcc44' : '#334455',
                cursor: state.charges > 0 ? 'pointer' : 'not-allowed',
                fontFamily:'monospace', fontSize:'13px',
              }}>
              {loading ? '処理中...' : state.charges > 0 ? `🌾 ${selectedHours}時間の修練を開始する` : '修練回数がありません'}
            </button>
            <button onClick={startTest} disabled={loading || state.charges <= 0}
              style={{ width:'100%', padding:'8px', marginTop:'8px', background:'#0a0a1a', border:'1px dashed #446688', color:'#88aacc', cursor: state.charges > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
              🧪 1分テスト修練を開始（開発用・チャージ1消費・EXP200）
            </button>
          </div>
        )}

        {/* 説明 */}
        <div style={{ border:'1px solid #112233', background:'#000810', padding:'12px', fontSize:'11px', color:'#446688', lineHeight:'1.9', textAlign:'left' }}>
          <div style={{ color:'#335566', marginBottom:'4px' }}>📖 かかし修練場とは</div>
          ● 出撃100回ごとに修練回数が1回チャージされる（簡易出撃はカウントされない）<br/>
          ● チャージは週5回まで。毎週月曜朝5時に修練回数はリセット<br/>
          ● 3〜8時間を設定して開始。<span style={{ color:'#ffcc44' }}>設定した時間まで解除しなければ経験値を獲得</span><br/>
          ● 1回でも解除すると経験値はもらえない（修練回数も戻らない）<br/>
          ● 修練中は 出撃・レイドボス・賭博場・釣り・挑戦・ダンジョン が利用できない（買い物などは可能）<br/>
          ● もらえるのは経験値のみ。装備はドロップしない
        </div>
      </div>
    </div>
  )
}
