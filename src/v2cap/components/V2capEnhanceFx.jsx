// ============================================================
// v2cap 鍛冶屋 — 強化の演出（黒い砂漠の強化のような「ためて → 結果」）＋結果のポップアップ
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「強化…成功！みたいな1分しか出ないけど、黒い砂漠の強化みたいな演出が欲しい、
//   強化の成否もポップアップ出るようにしてほしい ○○の強化に成功！ 失敗… みたいな」（音はなし）
//   ・ため：暗転・魔法陣が回り、光の粒が装備へ集まる・まわりのゲージがたまる（強化値が高いほど長い＝+6 にする回から大きく延ばす
//     ＝2026-10-24 ユーザー指示「緊張感を持たせるため」・fxStyle.js の enhanceChargeMsOf。結果はその間に届く）
//     ＋ +6 にする回からは、たまったあと満タンのまま1〜6秒待ってから結果（同じ日・enhanceHoldMsOf。長さは成否と関係ない）
//     ＋ ためている間は発光（同じ日・enhanceGlowOf）：ゲージが進むほど少しずつ光り、満タンで点灯 → 結果まで強く明滅
//   ・成功：白く光る → 衝撃の輪・光の柱・金の粒が弾ける・「強化成功」。強化値が高いほど色と派手さが上がる（+10は虹）
//   ・失敗：赤く光る → 魔法陣が割れて落ちる・破片・装備が揺れて暗くなる・「強化失敗」
//   ・最後にポップアップ「○○の強化に成功！／失敗…」。「続けて +N にする」（Enter）・「閉じる」（Esc）
//   ・押すと飛ばせる（結果が届いていれば、ためを終わらせる）
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { GearGlyph } from './v2capFxParts.jsx'
import { StatChange } from './v2capGear.jsx'
import { enhanceTierOf, enhanceChargeMsOf, enhanceHoldMsOf, enhanceGlowOf, enhanceTitleOf } from '../lib/fxStyle.js'
import { DISPLAY_FONT, JP_BOLD, RAINBOW_BASE } from './casinoStyle.js'

const KF = `
@keyframes efFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes efFlash { 0% { opacity: 0.9 } 100% { opacity: 0 } }
@keyframes efFlashFail { 0% { opacity: 0.4 } 100% { opacity: 0 } }
@keyframes efShock { 0% { transform: translate(-50%,-50%) scale(0.3); opacity: 1 } 100% { transform: translate(-50%,-50%) scale(2.6); opacity: 0 } }
@keyframes efPillar { 0% { opacity: 0; transform: translateX(-50%) scaleX(0.2) } 25% { opacity: 1; transform: translateX(-50%) scaleX(1) } 100% { opacity: 0; transform: translateX(-50%) scaleX(0.6) } }
@keyframes efPop { 0% { transform: scale(1) } 30% { transform: scale(1.32) } 55% { transform: scale(0.94) } 75% { transform: scale(1.06) } 100% { transform: scale(1) } }
@keyframes efTremble { 0%,100% { transform: translate(0,0) } 20% { transform: translate(-6px,2px) } 40% { transform: translate(5px,-2px) } 60% { transform: translate(-4px,1px) } 80% { transform: translate(3px,-1px) } }
@keyframes efText { 0% { transform: scale(2.2); opacity: 0; letter-spacing: 18px } 40% { transform: scale(0.95); opacity: 1 } 60% { transform: scale(1.04) } 100% { transform: scale(1); letter-spacing: 6px } }
@keyframes efTextFail { 0% { transform: translateY(-14px); opacity: 0 } 50% { transform: translateY(3px); opacity: 1 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes efDrop { 0% { transform: translateY(0) rotate(0); opacity: 1 } 100% { transform: translateY(70px) rotate(8deg); opacity: 0 } }
@keyframes efPanel { from { transform: translateY(16px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes efPulse { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
@keyframes efHue { from { filter: hue-rotate(0deg) } to { filter: hue-rotate(360deg) } }
`
const RING = 260   // 魔法陣の大きさ

// 魔法陣（外の輪・内の輪・星形）。angle で回す
function MagicCircle({ angle, color, broken }) {
  const ticks = Array.from({ length: 36 }, (_, i) => i)
  const glyphs = Array.from({ length: 12 }, (_, i) => i)
  const star = Array.from({ length: 6 }, (_, k) => {
    const a = (k * 60 - 90) * Math.PI / 180
    return `${Math.cos(a) * 78},${Math.sin(a) * 78}`
  })
  return (
    <svg width={RING} height={RING} viewBox="-130 -130 260 260" style={{ position:'absolute', inset:0, overflow:'visible' }} aria-hidden="true">
      <g transform={`rotate(${angle})`} opacity={broken ? 0.75 : 1}>
        <circle r="122" fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />
        <circle r="112" fill="none" stroke={color} strokeWidth="0.8" opacity="0.6" strokeDasharray="2 5" />
        {ticks.map(i => <line key={i} x1="0" y1="-122" x2="0" y2={i % 3 === 0 ? -108 : -115} stroke={color} strokeWidth="1.2" transform={`rotate(${i * 10})`} opacity="0.85" />)}
        {glyphs.map(i => (
          <path key={i} d="M0,-101 l4,6 l-4,6 l-4,-6 Z" fill={color} opacity="0.9" transform={`rotate(${i * 30 + 15})`} />
        ))}
      </g>
      <g transform={`rotate(${-angle * 1.6})`}>
        <circle r="88" fill="none" stroke={color} strokeWidth="1.2" opacity="0.75" />
        <polygon points={`${star[0]} ${star[2]} ${star[4]}`} fill="none" stroke={color} strokeWidth="1" opacity="0.7" />
        <polygon points={`${star[1]} ${star[3]} ${star[5]}`} fill="none" stroke={color} strokeWidth="1" opacity="0.7" />
        <circle r="58" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5" strokeDasharray="6 4" />
      </g>
      {broken && (
        <g stroke="#ff5a6a" strokeWidth="2.2" fill="none" strokeLinecap="round" style={{ filter:'drop-shadow(0 0 4px #ff2244)' }}>
          <path d="M-20,-125 L-8,-70 L-30,-30 L-5,10" />
          <path d="M110,-60 L60,-35 L40,10 L80,40" />
          <path d="M-115,40 L-60,30 L-45,75" />
          <path d="M20,124 L10,80 L35,55" />
        </g>
      )}
    </svg>
  )
}

// say … 結果のポップアップの上に出すもの（鍛冶屋の親方のひとこと・2026-10-26。V2capSmithMaster.jsx の MasterSays）
export default function V2capEnhanceFx({ job, say, nextLabel, nextReason, onAgain, onClose }) {
  const tier = enhanceTierOf(job.plusTo)
  const chargeMs = enhanceChargeMsOf(job.plusTo)
  const [phase, setPhase] = useState('charge')    // charge | climax | result
  const [progress, setProgress] = useState(0)
  const [lit, setLit] = useState(0)               // ためている間の発光 0〜1（enhanceGlowOf）
  const [angle, setAngle] = useState(0)
  const [flash, setFlash] = useState(null)
  const canvasRef = useRef(null)
  const ringRef = useRef(null)
  const fx = useRef(null)
  const fast = useRef(false)
  const climaxed = useRef(false)   // 結果の演出は1回だけ（飛ばしたときに2回走らないように）
  const t0 = useRef(performance.now())
  const resultRef = useRef(job.result)
  useEffect(() => { resultRef.current = job.result }, [job.result])

  // 光の粒
  useEffect(() => {
    fx.current = createParticles(canvasRef.current)
    return () => fx.current?.destroy()
  }, [])
  const center = () => {
    const r = ringRef.current?.getBoundingClientRect()
    const c = canvasRef.current?.getBoundingClientRect()
    if (!r || !c) return { x: 0, y: 0 }
    return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }
  }

  // ため（job が変わるたびに最初から）
  useEffect(() => {
    setPhase('charge'); setProgress(0); setLit(0); setFlash(null)
    fast.current = false
    climaxed.current = false
    t0.current = performance.now()
    // 満タンで待つ時間は押した時点で決める（結果はまだ届いていない＝成否と関係ない）
    const holdMs = enhanceHoldMsOf(job.plusTo)
    let raf = 0
    let lastSpawn = 0
    let ang = 0
    let lastT = performance.now()
    const step = (now) => {
      if (climaxed.current) return
      const dt = (now - lastT) / 1000; lastT = now
      const p = Math.min(1, (now - t0.current) / chargeMs)
      const done = (now - t0.current >= chargeMs + holdMs || fast.current) && resultRef.current
      ang += dt * (40 + p * 520)
      setAngle(ang)
      setProgress(fast.current && resultRef.current ? 1 : p)
      setLit(enhanceGlowOf(now - t0.current, chargeMs))
      if (now - lastSpawn > 70) {
        lastSpawn = now
        const c = center()
        fx.current?.converge(c.x, c.y, 2 + Math.round(p * 7), { colors: tier.colors, r0: 120, r1: 200 })
      }
      if (done) { startClimax(); return }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1回の強化（job.id）ごとに最初から
  }, [job.id])

  // 結果
  const climaxTimer = useRef(0)
  const startClimax = () => {
    const r = resultRef.current
    if (!r || climaxed.current) return
    climaxed.current = true
    setProgress(1)
    setPhase('climax')
    const c = center()
    const lv = tier.key === 'max' ? 4 : tier.key === 'gold' ? 3 : tier.key === 'purple' ? 2 : 1
    if (r.success) {
      setFlash({ color: '#ffffff', key: Date.now() })
      fx.current?.clear()
      fx.current?.burst(c.x, c.y, 70 + lv * 35, { colors: tier.colors, speed: [240, 560 + lv * 80] })
      fx.current?.rise(c.x, c.y + 30, 30 + lv * 12, { colors: tier.colors })
      if (lv >= 3) setTimeout(() => fx.current?.burst(c.x, c.y, 80, { colors: tier.colors, speed: [120, 380], shapes: ['star'] }), 260)
    } else {
      setFlash({ color: '#ff2244', key: Date.now() })
      fx.current?.clear()
      fx.current?.shards(c.x, c.y, 46)
    }
    clearTimeout(climaxTimer.current)
    climaxTimer.current = setTimeout(() => setPhase('result'), r.success ? 1200 + lv * 150 : 1000)
  }
  useEffect(() => () => clearTimeout(climaxTimer.current), [])

  const skip = () => {
    if (phase === 'charge') { fast.current = true; if (resultRef.current) startClimax() }
    else if (phase === 'climax') { clearTimeout(climaxTimer.current); setPhase('result') }
  }

  // キーボード：演出中は Enter／スペース／Esc で飛ばす。結果のあとは Enter＝続けて・Esc＝閉じる
  //   ★下の強化の画面（V2Modal）も Esc で閉じるので、ここで止めて下へ渡さない
  const keyRef = useRef(null)
  useEffect(() => { keyRef.current = { phase, skip, onClose, onAgain, nextLabel } })
  useEffect(() => {
    const onKey = (e) => {
      const k = keyRef.current
      if (!k || !['Enter', ' ', 'Escape'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      if (k.phase !== 'result') { k.skip(); return }
      if (e.key === 'Escape') k.onClose()
      else if (e.key === 'Enter' && k.nextLabel) k.onAgain()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const r = job.result
  const success = !!r?.success
  const ended = phase !== 'charge'
  const circleColor = ended && !success ? '#ff5a6a' : tier.color
  const glow = phase === 'charge' ? tier.color : success ? tier.color : '#ff3355'
  const titleGlow = tier.key === 'max' ? RAINBOW_BASE : tier.color
  const g = phase === 'charge' ? lit : 0   // 発光（ためている間だけ）
  const itemStyle = {
    position:'absolute', left:'50%', top:'50%', width:96, height:96, marginLeft:-48, marginTop:-48, borderRadius:14,
    background:'radial-gradient(circle at 50% 40%, #1d2a4a 0%, #0a1024 75%)', border:`2px solid ${job.color}`,
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    boxShadow:`0 0 ${10 + progress * 30 + g * 34}px ${glow}, inset 0 0 ${8 + progress * 16 + g * 16}px ${glow}88`,
    animation: phase === 'climax' ? (success ? 'efPop 0.7s ease-out' : 'efTremble 0.12s linear 5') : undefined,
    // 発光：ためている間は装備そのものも明るく（満タンで点灯して明滅）
    filter: phase === 'climax' && !success ? 'grayscale(0.7) brightness(0.75)' : g > 0 ? `brightness(${1 + g * 0.45})` : undefined,
    transition: phase === 'charge' ? undefined : 'filter 0.4s',   // ためている間の明滅は毎こま変えるので、なめらかにしない
  }
  return (
    <div onClick={phase === 'result' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', fontFamily:'monospace', cursor: phase === 'result' ? 'default' : 'pointer',
        background:'radial-gradient(circle at 50% 42%, #101a3a 0%, #04060f 70%)', animation:'efFadeIn 0.25s ease-out',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <style>{KF}</style>
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {flash && <div key={flash.key} style={{ position:'absolute', inset:0, background: flash.color, pointerEvents:'none', opacity:0, animation: success ? 'efFlash 0.6s ease-out forwards' : 'efFlashFail 0.45s ease-out forwards', mixBlendMode: success ? 'screen' : 'normal' }} />}

      <div style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'center', width:'min(420px, 100%)' }}>
        {/* 上の文字 */}
        <div style={{ height:64, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:4 }}>
          {phase === 'charge' && (
            <div style={{ color: tier.color, fontSize:16, letterSpacing:6, animation:'efPulse 0.9s ease-in-out infinite', textShadow:`0 0 10px ${tier.color}` }}>強化中…</div>
          )}
          {ended && success && (
            <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize: tier.key === 'max' ? 40 : 36, letterSpacing:6,
              color: tier.key === 'max' ? RAINBOW_BASE : '#ffffff',
              textShadow: `0 0 6px ${titleGlow}, 0 0 16px ${titleGlow}, 0 0 30px ${titleGlow}, 0 2px 0 #000`,
              animation: tier.key === 'max' ? 'efText 0.6s cubic-bezier(.2,1.4,.4,1) both, efHue 1.2s linear infinite' : 'efText 0.6s cubic-bezier(.2,1.4,.4,1) both' }}>
              強化成功{tier.key === 'max' ? '!!' : '!'}
            </div>
          )}
          {ended && !success && (
            <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:30, letterSpacing:6, color:'#ff6677', textShadow:'0 0 8px #ff2244, 2px 2px 0 #000', animation:'efTextFail 0.5s ease-out both' }}>強化失敗…</div>
          )}
        </div>

        {/* 魔法陣・ゲージ・装備 */}
        <div ref={ringRef} style={{ position:'relative', width:RING, height:RING, maxWidth:'80vw', maxHeight:'80vw' }}>
          {phase === 'climax' && success && (
            <div style={{ position:'absolute', left:'50%', top:'-60vh', width:120, height:'160vh', pointerEvents:'none',
              background:`linear-gradient(90deg, transparent, ${tier.color}66 30%, #ffffffcc 50%, ${tier.color}66 70%, transparent)`,
              animation:'efPillar 1.3s ease-out forwards', filter:'blur(2px)' }} />
          )}
          <div style={{ position:'absolute', inset:0, animation: ended && !success ? 'efDrop 0.9s ease-in 0.35s forwards' : undefined }}>
            <MagicCircle angle={angle} color={circleColor} broken={ended && !success} />
          </div>
          {/* ゲージ（ため） */}
          <svg width={RING} height={RING} viewBox="-130 -130 260 260" style={{ position:'absolute', inset:0, transform:'rotate(-90deg)', opacity: phase === 'charge' ? 1 : 0, transition:'opacity 0.3s' }} aria-hidden="true">
            <circle r="70" fill="none" stroke="#ffffff1a" strokeWidth="6" />
            <circle r="70" fill="none" stroke={tier.color} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 70}`} strokeDashoffset={`${2 * Math.PI * 70 * (1 - progress)}`} style={{ filter:`drop-shadow(0 0 ${6 + g * 14}px ${tier.color})` }} />
            {/* 発光：ゲージの芯が白く光る（満タンで点灯して明滅） */}
            <circle r="70" fill="none" stroke="#ffffff" strokeWidth={2 + g * 2} strokeLinecap="round" opacity={g}
              strokeDasharray={`${2 * Math.PI * 70}`} strokeDashoffset={`${2 * Math.PI * 70 * (1 - progress)}`} />
          </svg>
          {/* 発光：装備のまわりの光の輪（ためている間だけ・満タンで点灯して明滅） */}
          {phase === 'charge' && (
            <div style={{ position:'absolute', left:'50%', top:'50%', width:300, height:300, marginLeft:-150, marginTop:-150, borderRadius:'50%', pointerEvents:'none',
              background:`radial-gradient(circle, ${tier.color} 0%, ${tier.color}dd 30%, ${tier.color}66 48%, transparent 70%)`,
              opacity: g, transform:`scale(${0.8 + g * 0.3})`, mixBlendMode:'screen' }} />
          )}
          {phase === 'climax' && success && (
            <div style={{ position:'absolute', left:'50%', top:'50%', width:180, height:180, borderRadius:'50%', border:`4px solid ${tier.color}`, pointerEvents:'none',
              boxShadow:`0 0 20px ${tier.color}, inset 0 0 20px ${tier.color}`, animation:'efShock 0.7s ease-out forwards' }} />
          )}
          <div style={itemStyle}>
            <GearGlyph part={job.part} color={job.color} />
            <div style={{ fontFamily: DISPLAY_FONT, fontWeight:'bold', fontSize:15, color: ended && success ? tier.color : '#ffffff', textShadow:'0 0 6px #000, 1px 1px 0 #000', marginTop:-4 }}>
              +{ended && success ? job.plusTo : job.plusFrom}
            </div>
          </div>
        </div>

        {/* 下の文字 */}
        <div style={{ marginTop:6, textAlign:'center', fontSize:12, color:'#cfe2ff' }}>
          <span style={{ color: job.color }}>{job.name}</span>
          <span style={{ marginLeft:8 }}>+{job.plusFrom} → <span style={{ color: tier.color }}>+{job.plusTo}</span></span>
          <span style={{ marginLeft:8, color: job.rate >= 50 ? '#44ff88' : '#ff8844' }}>成功率 {job.rate}%</span>
        </div>
        {phase !== 'result' && <div style={{ marginTop:8, fontSize:10, color:'#62789a' }}>押すと飛ばせます</div>}

        {/* 結果のポップアップ */}
        {phase === 'result' && r && (
          <div onClick={e => e.stopPropagation()} style={{ marginTop:14, width:'100%', border:`1px solid ${success ? tier.color : '#ff5a6a'}`, background:'#001040ee',
            boxShadow:`0 0 18px ${success ? tier.color : '#ff2244'}55`, animation:'efPanel 0.3s ease-out both' }}>
            <div style={{ padding:'10px 12px', borderBottom:'1px solid #002a55', color: success ? tier.color : '#ff8a96', fontSize:14, fontWeight:'bold' }}>
              {success ? '✨ ' : '💥 '}{enhanceTitleOf(job.name, success)}
            </div>
            <div style={{ padding:'10px 12px', fontSize:12, color:'#88ccff', lineHeight:1.8 }}>
              {say}
              {success ? (
                <>
                  <div>強化値 +{job.plusFrom} → <span style={{ color: tier.color, fontWeight:'bold' }}>+{r.plus}</span>{r.plus >= 10 && <span style={{ color:'#ff66ff', marginLeft:6 }}>（上限）</span>}</div>
                  <div>戦闘力 {job.powerFrom} → <span style={{ color:'#44ff88' }}>{job.powerTo}</span></div>
                  {/* 上がったステ（2026-10-24 ユーザー指示「戦闘値しかないけど、ちゃんと武器のステータスどのくらい上昇してるのかも記載するようにして」） */}
                  <StatChange from={job.statsFrom} to={job.statsTo} />
                </>
              ) : (
                <>
                  {/* 「強化値はそのまま（+N）」は出さない（2026-10-26 ユーザー指示「ここいらない」＝そのことは HELP に書いてある） */}
                  <div style={{ color:'#ff8844' }}>{r.scrap > 0 ? `${job.scrapName} ${r.scrap}個と ` : ''}Gold {Number(r.gold).toLocaleString()} を失いました</div>
                </>
              )}
              {!nextLabel && nextReason && <div style={{ color:'#7fa6d0', fontSize:11 }}>{nextReason}</div>}
            </div>
            <div style={{ padding:'10px 12px', borderTop:'1px solid #002a55', display:'flex', gap:8 }}>
              <button onClick={onClose} style={panelBtn('#88aaff')}>閉じる</button>
              {nextLabel && <button onClick={onAgain} style={panelBtn('#ffcc00')}>続けて {nextLabel}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const panelBtn = (color) => ({
  flex:1, background:'#001840', border:`1px solid ${color}`, color, padding:'10px', cursor:'pointer', fontFamily:'monospace', fontSize:12,
})
