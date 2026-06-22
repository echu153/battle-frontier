// ============================================================
// 自動遠征 / 放置キャンプ（Idle Camp）  ※is_admin限定で先行公開
//   ・このページ（または常駐ミニ窓）を開いている間だけ EXP/Gold が溜まる方式。
//     在席はハートビート(idle_heartbeat,20秒毎)でサーバーに通知し、在席分のみ加算。
//   ・溜まり/上限/レートは全てサーバーが計算＝改ざん不可。
//   ・Phase2: PC常駐ミニ窓（Document Picture-in-Picture）。別作業中も小窓で
//     遠征状況を表示し、小窓内から受け取りも可能（Chrome/Edgeのみ対応）。
//   ※スマホの動画PiP(canvas→captureStream)は Phase3 で追加予定。
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

// 在席ハートビート方式：サーバーが持つ accrued_sec（在席中に貯まった秒）に、
// 最終beatからの「開いている間」のぶん(GRACE上限)を上乗せして表示。
// 閉じている間は heartbeat が止まるので加算されない＝ページを開いている間だけ進む。
// 画面本体とPiP小窓の両方で同じ計算を使い、表示を一致させる。
const computeLive = (data, nowMs) => {
  const capSec = (data?.cap_min || 0) * 60
  let totalSec = data?.accrued_sec || 0
  if (data?.running && data?.last_beat_at) {
    const delta = (nowMs - new Date(data.last_beat_at).getTime()) / 1000
    totalSec += Math.min(Math.max(0, delta), data.grace_sec || 90)
  }
  totalSec = Math.min(totalSec, capSec)
  const liveMin = Math.floor(totalSec / 60)
  const pendingGold = liveMin * (data?.gold_pm || 0)
  const pendingExp = (data?.at_cap || data?.exp_frozen) ? 0 : liveMin * (data?.exp_pm || 0)
  const isFull = capSec > 0 && totalSec >= capSec
  const pct = capSec ? Math.min(100, Math.round((totalSec / capSec) * 100)) : 0
  return { liveMin, pendingExp, pendingGold, isFull, pct }
}

const PIP_SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window
// 動画PiP（スマホ向け）: Android Chrome=requestPictureInPicture / iOS Safari=webkit presentation mode
const VIDEO_PIP_SUPPORTED = typeof document !== 'undefined' && (
  document.pictureInPictureEnabled ||
  (typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.webkitSetPresentationMode === 'function')
)

export default function Idle() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pipActive, setPipActive] = useState(false)
  const [videoPipActive, setVideoPipActive] = useState(false)
  const [, setTick] = useState(0)
  const offsetRef = useRef(0)     // serverNow(ms) - Date.now()
  const dataRef = useRef(null)    // 最新dataをPiP更新ループから参照
  const actionsRef = useRef({})   // 最新doStart/doClaimをPiPボタンから参照（クロージャ陳腐化対策）
  const pipWinRef = useRef(null)
  const pipCleanupRef = useRef(null)
  // 動画PiP（スマホ）用
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const drawIntervalRef = useRef(null)
  const heroFrameRef = useRef(false)

  const load = async () => {
    const { data: res, error } = await supabase.rpc('idle_get')
    if (error || !res?.ok) { setMsg({ t: `読み込み失敗: ${error?.message || res?.reason || ''}`, c: '#ff5555' }); return }
    if (res.server_now) offsetRef.current = new Date(res.server_now).getTime() - Date.now()
    setData(res)
  }

  // 在席ハートビート：開いている間だけサーバーに在席を通知し、在席ぶんを加算してもらう。
  // 返り値で accrued_sec / last_beat_at を最新化（閉じればこの送信が止まり加算も止まる）。
  const beat = async () => {
    const { data: res } = await supabase.rpc('idle_heartbeat')
    if (!res?.ok) return
    if (res.server_now) offsetRef.current = new Date(res.server_now).getTime() - Date.now()
    setData(prev => prev ? { ...prev, running: res.running, accrued_sec: res.accrued_sec ?? prev.accrued_sec, last_beat_at: res.last_beat_at ?? prev.last_beat_at } : prev)
  }

  useEffect(() => {
    let beatId
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!me?.is_admin) { nav('/game'); return }
      await load()
      setLoading(false)
      await beat()
      // 20秒ごとに在席通知（サーバーGRACE=90秒なのでバックグラウンド絞りでも在席維持）
      beatId = setInterval(beat, 20000)
    })()
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => {
      clearInterval(id)
      if (beatId) clearInterval(beatId)
      if (pipCleanupRef.current) pipCleanupRef.current()
      if (pipWinRef.current) { try { pipWinRef.current.close() } catch { /* ignore */ } }
      if (drawIntervalRef.current) clearInterval(drawIntervalRef.current)
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    }
  }, [])

  const flash = (t, c = '#44ffaa') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 3000) }
  const serverNowMs = () => Date.now() + offsetRef.current

  const doStart = async () => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('idle_start')
    setBusy(false)
    if (error || !res?.ok) { flash(`開始失敗: ${error?.message || res?.reason || ''}`, '#ff5555'); return res }
    flash('🏕 自動遠征を開始しました。画面を閉じても進みます')
    await load()
    return res
  }
  const doClaim = async () => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('idle_claim')
    setBusy(false)
    if (error || !res?.ok) {
      const r = res?.reason
      if (r === 'too_soon') { flash('まだ受け取れる報酬がありません（1分未満）', '#ffaa44'); return res }
      flash(`受取失敗: ${error?.message || r || ''}`, '#ff5555'); return res
    }
    const lvTxt = res.level_ups > 0 ? ` / ⬆ ${res.level_ups}レベルアップ！` : ''
    flash(`🎁 EXP +${res.gained_exp} / 💰 +${res.gained_gold}G（${fmtDur(res.claimed_min)}ぶん）${lvTxt}`)
    await load()
    return res
  }

  // PiP小窓・ボタンが常に最新のdata/関数を見るようにrefへ同期
  useEffect(() => {
    dataRef.current = data
    actionsRef.current = { doStart, doClaim }
  })

  // ===== PC常駐ミニ窓（Document Picture-in-Picture） =====
  const openPip = async () => {
    if (!PIP_SUPPORTED) { flash('このブラウザは常駐ミニ窓に未対応です（Chrome/Edgeでご利用ください）', '#ffaa44'); return }
    if (pipWinRef.current) { try { pipWinRef.current.focus() } catch { /* ignore */ } return }
    let pip
    try { pip = await window.documentPictureInPicture.requestWindow({ width: 300, height: 380 }) }
    catch { flash('ミニ窓を開けませんでした', '#ff5555'); return }
    pipWinRef.current = pip
    setPipActive(true)

    const d = pip.document
    d.body.style.cssText = 'margin:0;font-family:monospace;background:#000a08;color:#aaffdd'
    const root = d.createElement('div')
    root.style.cssText = 'padding:12px'
    root.innerHTML = `
      <div style="font-size:13px;letter-spacing:1px;color:#44ffaa;margin-bottom:8px;text-align:center">🏕 自動遠征</div>
      <div id="hero" style="font-size:30px;text-align:center;margin:4px 0">🗡️🐉</div>
      <div id="status" style="font-size:11px;color:#88ccaa;text-align:center;margin-bottom:8px">読み込み中...</div>
      <div style="height:8px;background:#021c14;border:1px solid #0a4030;margin-bottom:10px"><div id="gauge" style="height:100%;width:0%;background:#2ec27e"></div></div>
      <div style="display:flex;justify-content:space-around;margin-bottom:10px">
        <div style="text-align:center"><div style="font-size:9px;color:#557777">EXP</div><div id="exp" style="font-size:18px;color:#aaffdd">+0</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:#557777">Gold</div><div id="gold" style="font-size:18px;color:#ffe9a3">+0</div></div>
      </div>
      <button id="act" style="width:100%;padding:9px;background:#2a2200;border:1px solid #ffcc44;color:#ffcc44;font-family:monospace;font-size:12px;cursor:pointer">🎁 受け取る</button>
      <div id="pmsg" style="font-size:10px;color:#557777;text-align:center;margin-top:6px;min-height:13px"></div>`
    d.body.appendChild(root)

    const $ = (id) => d.getElementById(id)
    let heroFrame = false
    const update = () => {
      const cur = dataRef.current
      if (!cur) { $('status').textContent = '読み込み中...'; return }
      if (!cur.running) {
        $('hero').textContent = '🏕'
        $('status').textContent = '遠征していません'
        $('gauge').style.width = '0%'
        $('exp').textContent = '+0'; $('gold').textContent = '+0'
        const a = $('act'); a.textContent = '🚩 遠征に出発'
        a.style.cssText = 'width:100%;padding:9px;background:#0a2a1e;border:1px solid #44ffaa;color:#44ffaa;font-family:monospace;font-size:12px;cursor:pointer'
        return
      }
      const { liveMin, pendingExp, pendingGold, isFull, pct } = computeLive(cur, serverNowMs())
      heroFrame = !heroFrame
      $('hero').textContent = heroFrame ? '🗡️🐉' : '💥🐉'
      $('status').textContent = isFull ? '🈵 上限到達・受け取り推奨' : `遠征中… ${fmtDur(liveMin)}ぶん`
      $('gauge').style.width = `${pct}%`
      $('gauge').style.background = isFull ? '#ffcc44' : '#2ec27e'
      $('exp').textContent = `+${pendingExp}`
      $('gold').textContent = `+${pendingGold}`
      const a = $('act'); a.textContent = '🎁 受け取る'
      a.style.cssText = 'width:100%;padding:9px;background:#2a2200;border:1px solid #ffcc44;color:#ffcc44;font-family:monospace;font-size:12px;cursor:pointer'
    }
    update()
    const iv = setInterval(update, 1000)

    $('act').addEventListener('click', async () => {
      const cur = dataRef.current
      const a = actionsRef.current
      $('pmsg').textContent = '処理中...'
      const res = cur?.running ? await a.doClaim?.() : await a.doStart?.()
      if (res?.ok) {
        $('pmsg').textContent = cur?.running
          ? `🎁 +${res.gained_exp}EXP / +${res.gained_gold}G${res.level_ups > 0 ? ` / ⬆${res.level_ups}` : ''}`
          : '🏕 遠征開始'
      } else {
        $('pmsg').textContent = res?.reason === 'too_soon' ? 'まだ受け取れません' : '失敗しました'
      }
      setTimeout(() => { if ($('pmsg')) $('pmsg').textContent = '' }, 2600)
    })

    const cleanup = () => { clearInterval(iv) }
    pipCleanupRef.current = cleanup
    pip.addEventListener('pagehide', () => {
      cleanup()
      pipWinRef.current = null
      pipCleanupRef.current = null
      setPipActive(false)
    })
  }

  const closePip = () => { if (pipWinRef.current) { try { pipWinRef.current.close() } catch { /* ignore */ } } }

  // ===== スマホ常駐ミニ窓（canvas→動画PiP・観賞用） =====
  // 自動戦闘の様子をcanvasに描き、captureStreamで映像化して動画PiPに乗せる。
  // 動画PiPはYouTube等と同じOS小窓でYouTube全画面の上に浮かせられるが、操作は不可（観賞用）。
  const drawFrame = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const W = c.width, H = c.height
    const cur = dataRef.current
    const { liveMin, pendingExp, pendingGold, isFull, pct } = computeLive(cur, serverNowMs())
    heroFrameRef.current = !heroFrameRef.current

    ctx.fillStyle = '#000a08'; ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#44ffaa'; ctx.font = '15px monospace'
    ctx.fillText('🏕 自動遠征', W / 2, 24)

    ctx.font = '36px serif'
    ctx.fillText(!cur?.running ? '🏕' : (heroFrameRef.current ? '🗡️🐉' : '💥🐉'), W / 2, 78)

    ctx.font = '12px monospace'; ctx.fillStyle = '#88ccaa'
    ctx.fillText(!cur?.running ? '停止中' : (isFull ? '🈵 上限到達・受取推奨' : `遠征中… ${fmtDur(liveMin)}ぶん`), W / 2, 104)

    ctx.strokeStyle = '#0a4030'; ctx.strokeRect(40, 116, W - 80, 10)
    ctx.fillStyle = isFull ? '#ffcc44' : '#2ec27e'; ctx.fillRect(40, 116, (W - 80) * pct / 100, 10)

    ctx.textAlign = 'left'; ctx.font = '16px monospace'
    ctx.fillStyle = '#aaffdd'; ctx.fillText(`EXP  +${pendingExp}`, 50, 152)
    ctx.fillStyle = '#ffe9a3'; ctx.fillText(`Gold +${pendingGold}`, 50, 176)
  }

  const stopVideoPip = () => {
    const video = videoRef.current
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture()
      else if (video && typeof video.webkitSetPresentationMode === 'function') video.webkitSetPresentationMode('inline')
    } catch { /* ignore */ }
    if (drawIntervalRef.current) { clearInterval(drawIntervalRef.current); drawIntervalRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (video) { try { video.pause() } catch { /* ignore */ } video.srcObject = null }
    setVideoPipActive(false)
  }

  const openVideoPip = async () => {
    const video = videoRef.current
    if (!VIDEO_PIP_SUPPORTED || !video) { flash('このブラウザは動画ミニ窓に未対応です', '#ffaa44'); return }
    try {
      if (!canvasRef.current) {
        const c = document.createElement('canvas'); c.width = 320; c.height = 200; canvasRef.current = c
      }
      drawFrame()
      const stream = canvasRef.current.captureStream(4)
      streamRef.current = stream
      video.srcObject = stream
      video.muted = true
      await video.play()
      if (drawIntervalRef.current) clearInterval(drawIntervalRef.current)
      drawIntervalRef.current = setInterval(drawFrame, 500)
      if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture()
      } else if (typeof video.webkitSetPresentationMode === 'function') {
        video.webkitSetPresentationMode('picture-in-picture')
      } else { throw new Error('unsupported') }
      setVideoPipActive(true)
    } catch {
      flash('動画ミニ窓を開けませんでした（操作直後にお試しください）', '#ff5555')
      stopVideoPip()
    }
  }

  // 動画PiPがユーザー操作（小窓を閉じる/全画面化）で終了したらstateを戻す
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onLeave = () => { if (!document.pictureInPictureElement) { stopVideoPip() } }
    const onWebkit = () => { if (video.webkitPresentationMode && video.webkitPresentationMode !== 'picture-in-picture') stopVideoPip() }
    video.addEventListener('leavepictureinpicture', onLeave)
    video.addEventListener('webkitpresentationmodechanged', onWebkit)
    return () => {
      video.removeEventListener('leavepictureinpicture', onLeave)
      video.removeEventListener('webkitpresentationmodechanged', onWebkit)
    }
  }, [])

  if (loading) return <div style={{ color:'#44ffaa', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const { liveMin, pendingExp, pendingGold, isFull, pct } = computeLive(data, serverNowMs())

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

        {/* PC常駐ミニ窓（Document PiP・操作可） */}
        <div style={{ ...box, display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap', marginBottom:'8px' }}>
          <div style={{ color:'#88ccaa', fontSize:'11px', lineHeight:'1.6' }}>
            🖥 <b style={{ color:'#cceeff' }}>PC常駐ミニ窓</b><span style={{ color:'#557777' }}>（Chrome/Edge）</span><br />
            <span style={{ color:'#557777', fontSize:'10px' }}>別の作業中も小窓で表示。小窓内から受け取りも可能</span>
          </div>
          {pipActive ? (
            <button onClick={closePip} style={{ padding:'8px 14px', background:'#1a0a0a', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✕ 閉じる</button>
          ) : (
            <button onClick={openPip} disabled={!PIP_SUPPORTED}
              style={{ padding:'8px 14px', background: PIP_SUPPORTED?'#04141a':'#0a0e08', border:`1px solid ${PIP_SUPPORTED?'#66ccff':'#1a3a2a'}`, color: PIP_SUPPORTED?'#66ccff':'#445555', cursor: PIP_SUPPORTED?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
              🖥 常駐
            </button>
          )}
        </div>

        {/* スマホ動画ミニ窓（動画PiP・観賞用） */}
        <div style={{ ...box, display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
          <div style={{ color:'#88ccaa', fontSize:'11px', lineHeight:'1.6' }}>
            📱 <b style={{ color:'#cceeff' }}>スマホ動画ミニ窓</b><span style={{ color:'#557777' }}>（YouTube脇に）</span><br />
            <span style={{ color:'#557777', fontSize:'10px' }}>YouTube等を全画面で見ながら脇に表示。観賞用（操作はアプリに戻って）</span>
          </div>
          {videoPipActive ? (
            <button onClick={stopVideoPip} style={{ padding:'8px 14px', background:'#1a0a0a', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✕ 閉じる</button>
          ) : (
            <button onClick={openVideoPip} disabled={!VIDEO_PIP_SUPPORTED}
              style={{ padding:'8px 14px', background: VIDEO_PIP_SUPPORTED?'#1a0a14':'#0a0e08', border:`1px solid ${VIDEO_PIP_SUPPORTED?'#ff88cc':'#1a3a2a'}`, color: VIDEO_PIP_SUPPORTED?'#ff88cc':'#445555', cursor: VIDEO_PIP_SUPPORTED?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
              📱 小窓で表示
            </button>
          )}
        </div>
        {!PIP_SUPPORTED && !VIDEO_PIP_SUPPORTED && (
          <div style={{ color:'#557777', fontSize:'10px', marginBottom:'10px' }}>※ お使いのブラウザはミニ窓に未対応です。PCはChrome/Edge、スマホはSafari/Chromeをお試しください。</div>
        )}
        {/* 動画PiP用の隠しvideo（DOM上に存在し再生されている必要がある） */}
        <video ref={videoRef} muted playsInline aria-hidden="true"
          style={{ position:'absolute', width:'1px', height:'1px', opacity:0, pointerEvents:'none' }} />

        <div style={{ color:'#88ccaa', fontSize:'11px', lineHeight:'1.8', marginBottom:'12px' }}>
          キャラを遠征に送り出すと、<b style={{ color:'#cceeff' }}>このページ（または常駐ミニ窓）を開いている間だけ</b>時間に応じて EXP / Gold が溜まります。<br />
          <span style={{ color:'#557777' }}>※ ページを閉じている間は溜まりません。</span>溜まる速さは到達した最奥エリアで上がり、最大 <b style={{ color:'#cceeff' }}>{fmtDur(data?.cap_min || 0)}</b> ぶんまで蓄積。受け取ると再び0から溜まり始めます。
        </div>

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
            <div style={{ height:'10px', background:'#021c14', border:'1px solid #0a4030', marginBottom:'12px' }}>
              <div style={{ height:'100%', width:`${pct}%`, background: isFull ? '#ffcc44' : '#2ec27e', transition:'width 0.5s' }} />
            </div>
            <div style={{ display:'flex', gap:'24px', justifyContent:'center', marginBottom:'14px', flexWrap:'wrap' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:'#557777', fontSize:'10px' }}>溜まったEXP</div>
                <div style={{ color:'#aaffdd', fontSize:'20px', fontWeight:'bold' }}>+{pendingExp}</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:'#557777', fontSize:'10px' }}>溜まったGold</div>
                <div style={{ color:'#ffe9a3', fontSize:'20px', fontWeight:'bold' }}>+{pendingGold}</div>
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
