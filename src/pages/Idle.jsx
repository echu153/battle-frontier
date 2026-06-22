// ============================================================
// 自動遠征 / 放置キャンプ（Idle Camp）  ※is_admin限定で先行公開
//   ・開始すると、画面を閉じていても経過時間に応じて EXP/Gold が溜まる。
//   ・溜まり/上限/レートは全てサーバー(idle_get/idle_claim)が計算＝改ざん不可。
//   ・本ページ表示中はサーバー起点(started_at)から1秒ごとに見込み額を再計算して表示。
//   ※「タスクバーヒーロー」的な常駐ミニ表示(PiP)は Phase2/3 で追加予定。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const fmtDur = (min) => {
  if (min <= 0) return '0分'
  const h = Math.floor(min / 60), m = min % 60
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`
  return `${m}分`
}

export default function Idle() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [, setTick] = useState(0)
  const offsetRef = useRef(0) // serverNow(ms) - Date.now()

  const load = async () => {
    const { data: res, error } = await supabase.rpc('idle_get')
    if (error || !res?.ok) { setMsg({ t: `読み込み失敗: ${error?.message || res?.reason || ''}`, c: '#ff5555' }); return }
    if (res.server_now) offsetRef.current = new Date(res.server_now).getTime() - Date.now()
    setData(res)
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      // is_admin限定（サーバー側でも弾くが、非管理者はページに留めない）
      const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!me?.is_admin) { nav('/game'); return }
      await load()
      setLoading(false)
    })()
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const flash = (t, c = '#44ffaa') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 3000) }
  const serverNowMs = () => Date.now() + offsetRef.current

  const doStart = async () => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('idle_start')
    setBusy(false)
    if (error || !res?.ok) { flash(`開始失敗: ${error?.message || res?.reason || ''}`, '#ff5555'); return }
    flash('🏕 自動遠征を開始しました。画面を閉じても進みます')
    await load()
  }
  const doClaim = async () => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('idle_claim')
    setBusy(false)
    if (error || !res?.ok) {
      const r = res?.reason
      if (r === 'too_soon') { flash('まだ受け取れる報酬がありません（1分未満）', '#ffaa44'); return }
      flash(`受取失敗: ${error?.message || r || ''}`, '#ff5555'); return
    }
    const lvTxt = res.level_ups > 0 ? ` / ⬆ ${res.level_ups}レベルアップ！` : ''
    flash(`🎁 EXP +${res.gained_exp} / 💰 +${res.gained_gold}G（${fmtDur(res.claimed_min)}ぶん）${lvTxt}`)
    await load()
  }

  if (loading) return <div style={{ color:'#44ffaa', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  // サーバー起点から、表示中もリアルタイムに見込み額を再計算（1秒ごとtick）
  let liveMin = data?.capped_min || 0
  let livePendingExp = data?.pending_exp || 0
  let livePendingGold = data?.pending_gold || 0
  let isFull = data?.is_full || false
  if (data?.running && data?.started_at) {
    const elapsedMin = Math.floor((serverNowMs() - new Date(data.started_at).getTime()) / 60000)
    liveMin = Math.max(0, Math.min(elapsedMin, data.cap_min))
    isFull = elapsedMin >= data.cap_min
    livePendingGold = liveMin * (data.gold_pm || 0)
    livePendingExp = (data.at_cap || data.exp_frozen) ? 0 : liveMin * (data.exp_pm || 0)
  }
  const pct = data?.cap_min ? Math.min(100, Math.round((liveMin / data.cap_min) * 100)) : 0

  const box = { border:'1px solid #1a5a3a', background:'#021410', padding:'16px', marginBottom:'12px', borderRadius:'2px' }

  return (
    <div style={{ minHeight:'100vh', background:'#000a08', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'620px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #0a4030', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#44ffaa', fontSize:'15px', letterSpacing:'2px' }}>🏕 自動遠征 <span style={{ color:'#557777', fontSize:'10px' }}>[開発]</span></div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        {msg && (
          <div style={{ color:msg.c, fontSize:'12px', border:`1px solid ${msg.c}55`, background:'#001810', padding:'8px 12px', marginBottom:'10px' }}>{msg.t}</div>
        )}

        <div style={{ color:'#88ccaa', fontSize:'11px', lineHeight:'1.8', marginBottom:'12px' }}>
          キャラを遠征に送り出すと、<b style={{ color:'#cceeff' }}>ゲームを閉じていても</b>時間に応じて EXP / Gold が溜まります。<br />
          溜まる速さは到達した最奥エリアで上がり、最大 <b style={{ color:'#cceeff' }}>{fmtDur(data?.cap_min || 0)}</b> ぶんまで蓄積。受け取ると再び0から溜まり始めます。
        </div>

        {/* レート表示 */}
        <div style={{ ...box, display:'flex', gap:'20px', flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ color:'#88ccaa', fontSize:'12px' }}>獲得レート</span>
          <span style={{ color:'#aaffdd', fontSize:'12px' }}>EXP <b style={{ color:'#cceeff' }}>{data?.exp_pm || 0}</b>/分</span>
          <span style={{ color:'#ffd966', fontSize:'12px' }}>Gold <b style={{ color:'#ffe9a3' }}>{data?.gold_pm || 0}</b>/分</span>
        </div>

        {data?.at_cap && (
          <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'10px' }}>⚠ 現在のクラスはレベル上限のため EXP は溜まりません（Goldのみ）。</div>
        )}
        {data?.exp_frozen && (
          <div style={{ color:'#ff6666', fontSize:'11px', marginBottom:'10px' }}>⚠ EXP凍結中のため EXP は溜まりません（Goldのみ）。</div>
        )}

        {!data?.running ? (
          <div style={{ ...box, textAlign:'center', padding:'28px 16px' }}>
            <div style={{ fontSize:'34px', marginBottom:'10px' }}>🏕</div>
            <div style={{ color:'#88ccaa', fontSize:'13px', marginBottom:'14px' }}>いまは遠征していません</div>
            <button onClick={doStart} disabled={busy}
              style={{ padding:'10px 22px', background:'#0a2a1e', border:'1px solid #44ffaa', color:'#44ffaa', cursor: busy?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px' }}>
              🚩 遠征に出発する
            </button>
          </div>
        ) : (
          <div style={{ ...box, border:`1px solid ${isFull ? '#ffcc44' : '#1a5a3a'}` }}>
            <div style={{ color:'#88ccaa', fontSize:'12px', marginBottom:'6px' }}>遠征中… <span style={{ color:'#557777' }}>（{fmtDur(liveMin)} 経過 / 上限 {fmtDur(data.cap_min)}）</span></div>
            {/* 蓄積ゲージ */}
            <div style={{ height:'10px', background:'#021c14', border:'1px solid #0a4030', marginBottom:'12px' }}>
              <div style={{ height:'100%', width:`${pct}%`, background: isFull ? '#ffcc44' : '#2ec27e', transition:'width 0.5s' }} />
            </div>
            <div style={{ display:'flex', gap:'24px', justifyContent:'center', marginBottom:'14px', flexWrap:'wrap' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:'#557777', fontSize:'10px' }}>溜まったEXP</div>
                <div style={{ color:'#aaffdd', fontSize:'20px', fontWeight:'bold' }}>+{livePendingExp}</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:'#557777', fontSize:'10px' }}>溜まったGold</div>
                <div style={{ color:'#ffe9a3', fontSize:'20px', fontWeight:'bold' }}>+{livePendingGold}</div>
              </div>
            </div>
            {isFull && (
              <div style={{ color:'#ffcc44', fontSize:'11px', textAlign:'center', marginBottom:'10px' }}>🈵 上限に達しました。受け取らないと、これ以上は溜まりません。</div>
            )}
            <div style={{ textAlign:'center' }}>
              <button onClick={doClaim} disabled={busy || liveMin < 1}
                style={{ padding:'10px 22px', background: liveMin>=1?'#2a2200':'#0a0e08', border:`1px solid ${liveMin>=1?'#ffcc44':'#1a3a2a'}`, color: liveMin>=1?'#ffcc44':'#445555', cursor:(busy||liveMin<1)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                🎁 報酬を受け取る
              </button>
            </div>
            <div style={{ color:'#446666', fontSize:'10px', textAlign:'center', marginTop:'10px' }}>
              ※ 受け取り判定はサーバー時刻基準です。表示額は目安で、受け取り時に確定します。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
