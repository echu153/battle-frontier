// ============================================================
// v2cap 鍛冶屋 — 作成の演出（残骸とGoldが金床に集まる → 金槌で3回打つ → レア度の光で完成）＋結果のポップアップ
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「作成にも演出付けてほしい（具体的な装備のアイコンはないからそれを考慮して）」（音はなし）
//   ・装備ごとの絵は無いので、形は 武器・防具・装飾品 の3種だけ（GearGlyph）。主役はレア度の色（レア青・エピック紫・レジェンダリー金）と名前
//   ・集める：暗転・金床へ光の粒（溶けた残骸とGold）が集まる → 打つ：金槌が3回下りて火花、打つたびに地金の色がレア度の色へ変わる
//   ・完成：白い光 → レア度の色の粒が弾ける（エピックは光の筋・レジェンダリーは光の柱と光の筋）→ ポップアップ「○○を作成しました！」
//   ・作成は必ずできるので、成否の待ちはない（サーバーの返事は打っている間に届く）。押すと飛ばせる。Enter＝続けて作る・Esc＝閉じる
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { GearGlyph, Anvil, Hammer } from './v2capFxParts.jsx'
import { craftTierOf, craftTitleOf, CRAFT_STRIKES } from '../lib/fxStyle.js'
import { JP_BOLD } from './casinoStyle.js'

const KF = `
@keyframes cfFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes cfStrike { 0% { transform: rotate(-58deg) } 55% { transform: rotate(-58deg) } 78% { transform: rotate(6deg) } 86% { transform: rotate(-2deg) } 100% { transform: rotate(-58deg) } }
@keyframes cfFlash { 0% { opacity: 0.85 } 100% { opacity: 0 } }
@keyframes cfFlashSoft { 0% { opacity: 0.22 } 100% { opacity: 0 } }
@keyframes cfShakeA { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-4px,2px) } 50% { transform: translate(3px,-2px) } 75% { transform: translate(-2px,1px) } }
@keyframes cfShakeB { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-4px,2px) } 50% { transform: translate(3px,-2px) } 75% { transform: translate(-2px,1px) } }
@keyframes cfRise { 0% { transform: translateY(0) scale(1); opacity: 1 } 100% { transform: translateY(-40px) scale(0.6); opacity: 0 } }
@keyframes cfPop { 0% { transform: scale(0.2) rotate(-10deg); opacity: 0 } 45% { transform: scale(1.22) rotate(2deg); opacity: 1 } 70% { transform: scale(0.95) } 100% { transform: scale(1) rotate(0) } }
@keyframes cfPillar { 0% { opacity: 0; transform: translateX(-50%) scaleX(0.2) } 25% { opacity: 1; transform: translateX(-50%) scaleX(1) } 100% { opacity: 0; transform: translateX(-50%) scaleX(0.6) } }
@keyframes cfRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes cfText { 0% { transform: scale(1.8); opacity: 0; letter-spacing: 16px } 45% { transform: scale(0.96); opacity: 1 } 100% { transform: scale(1); letter-spacing: 5px } }
@keyframes cfPulse { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
@keyframes cfPanel { from { transform: translateY(16px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
`
const STAGE = 280
const STRIKE_AT = [650, 1100, 1550]   // 金槌が当たる時刻（ms）
const REVEAL_AT = 2000
const MOLTEN = '#ff9a3c'
// 2つの色を混ぜる（打つたびに地金の色をレア度の色へ）
const mix = (a, b, t) => {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

export default function V2capCraftFx({ job, nextLabel, nextReason, onAgain, onClose }) {
  const tier = craftTierOf(job.rarity)
  const [phase, setPhase] = useState('gather')   // gather | forge | reveal | result
  const [strikes, setStrikes] = useState(0)
  const [flash, setFlash] = useState(null)
  const [shake, setShake] = useState(0)
  const canvasRef = useRef(null)
  const anvilRef = useRef(null)
  const fx = useRef(null)
  const resultRef = useRef(job.result)
  const skipRef = useRef(false)
  const timers = useRef([])
  useEffect(() => { resultRef.current = job.result }, [job.result])

  useEffect(() => {
    fx.current = createParticles(canvasRef.current)
    return () => fx.current?.destroy()
  }, [])
  // 金床の上（地金のある所）
  const point = () => {
    const a = anvilRef.current?.getBoundingClientRect()
    const c = canvasRef.current?.getBoundingClientRect()
    if (!a || !c) return { x: 0, y: 0 }
    return { x: a.left + a.width * 0.42 - c.left, y: a.top + a.height * 0.08 - c.top }
  }

  // 流れ（1回の作成ごとに最初から）
  useEffect(() => {
    setPhase('gather'); setStrikes(0); setFlash(null)
    skipRef.current = false
    const later = (ms, f) => timers.current.push(setTimeout(f, ms))
    const tier0 = craftTierOf(job.rarity)
    // 集める：溶けた残骸とGoldが金床へ
    let n = 0
    const gather = setInterval(() => {
      const p = point()
      fx.current?.converge(p.x, p.y, 5, { colors: [MOLTEN, '#ffd27a', '#ffe680'], r0: 150, r1: 240 })
      if (++n > 9) clearInterval(gather)
    }, 60)
    later(STRIKE_AT[0] - Math.round(450 * 0.78), () => setPhase('forge'))
    STRIKE_AT.forEach((t, i) => later(t, () => {
      if (skipRef.current) return
      setStrikes(i + 1)
      const p = point()
      const share = (i + 1) / CRAFT_STRIKES
      const colors = share < 1 ? [MOLTEN, '#ffd27a', '#ffffff', ...(share > 0.5 ? tier0.colors : [])] : [...tier0.colors, '#ffd27a']
      fx.current?.burst(p.x, p.y, 26 + i * 10, { colors, speed: [160, 420], g: 900, shapes: ['spark', 'spark', 'dot'], life: 0.9 })
      setFlash({ color: share < 1 ? '#ffcf8a' : tier0.color, key: Date.now(), strong: false })
      setShake(k => k + 1)
    }))
    const reveal = () => {
      if (!resultRef.current) { later(80, reveal); return }
      doReveal()
    }
    later(REVEAL_AT, reveal)
    return () => { clearInterval(gather); timers.current.forEach(clearTimeout); timers.current = [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1回の作成（job.id）ごとに最初から
  }, [job.id])

  const revealed = useRef(false)
  useEffect(() => { revealed.current = false }, [job.id])
  const doReveal = () => {
    if (revealed.current || !resultRef.current) return
    revealed.current = true
    timers.current.forEach(clearTimeout); timers.current = []
    setStrikes(CRAFT_STRIKES)
    setPhase('reveal')
    const p = point()
    const cy = p.y - 70
    setFlash({ color: '#ffffff', key: Date.now(), strong: true })
    fx.current?.clear()
    fx.current?.burst(p.x, cy, 50 + tier.level * 40, { colors: tier.colors, speed: [200, 480 + tier.level * 60], g: 220, shapes: ['spark', 'star', 'dot'] })
    fx.current?.rise(p.x, cy + 40, 20 + tier.level * 15, { colors: tier.colors })
    if (tier.level >= 3) timers.current.push(setTimeout(() => fx.current?.burst(p.x, cy, 90, { colors: tier.colors, speed: [120, 360], shapes: ['star'] }), 280))
    timers.current.push(setTimeout(() => setPhase('result'), 950 + tier.level * 150))
  }

  const skip = () => {
    if (phase === 'gather' || phase === 'forge') { skipRef.current = true; doReveal() }
    else if (phase === 'reveal') { timers.current.forEach(clearTimeout); timers.current = []; setPhase('result') }
  }
  // キーボード：演出中は Enter／スペース／Esc で飛ばす。結果のあとは Enter＝続けて作る・Esc＝閉じる（下の画面へは渡さない）
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

  const ended = phase === 'reveal' || phase === 'result'
  const blank = mix(MOLTEN, tier.color, Math.min(1, strikes / CRAFT_STRIKES))
  return (
    <div onClick={phase === 'result' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', fontFamily:'monospace', cursor: phase === 'result' ? 'default' : 'pointer',
        background:`radial-gradient(circle at 50% 46%, ${ended ? tier.color + '22' : '#3a1a0833'} 0%, transparent 68%), #05060c`, transition:'background 0.6s',
        animation:'cfFadeIn 0.25s ease-out', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <style>{KF}</style>
      {/* 光の筋（エピック・レジェンダリー） */}
      {ended && tier.level >= 2 && (
        <div style={{ position:'absolute', left:'50%', top:'44%', width:'170vmax', height:'170vmax', pointerEvents:'none',
          background:`repeating-conic-gradient(${tier.color}2a 0deg 7deg, transparent 7deg 18deg)`,
          maskImage:'radial-gradient(circle, #000 0%, transparent 55%)', WebkitMaskImage:'radial-gradient(circle, #000 0%, transparent 55%)',
          animation:'cfRays 9s linear infinite' }} />
      )}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {flash && <div key={flash.key} style={{ position:'absolute', inset:0, background: flash.color, mixBlendMode:'screen', pointerEvents:'none', opacity:0, animation: flash.strong ? 'cfFlash 0.6s ease-out forwards' : 'cfFlashSoft 0.22s ease-out forwards' }} />}

      <div style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'center', width:'min(420px, 100%)' }}>
        {/* 上の文字 */}
        <div style={{ height:60, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {!ended && <div style={{ color:'#ffb46a', fontSize:16, letterSpacing:6, fontFamily: JP_BOLD, fontWeight:'bold', textShadow:'0 0 10px #ff7a1a', animation:'cfPulse 0.9s ease-in-out infinite' }}>鍛造中…</div>}
          {ended && (
            <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize: 30 + tier.level * 3, letterSpacing:5, color:'#ffffff',
              textShadow:`0 0 6px ${tier.color}, 0 0 16px ${tier.color}, 0 0 30px ${tier.color}, 0 2px 0 #000`, animation:'cfText 0.6s cubic-bezier(.2,1.4,.4,1) both' }}>
              完成!
            </div>
          )}
        </div>

        {/* 金床と金槌／できた装備 */}
        <div style={{ position:'relative', width:STAGE, height:STAGE, maxWidth:'80vw', animation: shake && !ended ? `${shake % 2 ? 'cfShakeA' : 'cfShakeB'} 0.18s linear` : undefined }}>
          {ended && tier.level >= 3 && (
            <div style={{ position:'absolute', left:'50%', top:'-60vh', width:130, height:'160vh', pointerEvents:'none',
              background:`linear-gradient(90deg, transparent, ${tier.color}66 30%, #ffffffcc 50%, ${tier.color}66 70%, transparent)`,
              animation:'cfPillar 1.4s ease-out forwards', filter:'blur(2px)' }} />
          )}
          {!ended && (
            <>
              {/* 地金の光 */}
              <div style={{ position:'absolute', left:'50%', top:'54%', width:200, height:120, marginLeft:-100, marginTop:-60, borderRadius:'50%', pointerEvents:'none',
                background:`radial-gradient(ellipse, ${blank}88 0%, transparent 65%)`, transition:'background 0.3s' }} />
              <div ref={anvilRef} style={{ position:'absolute', left:'50%', bottom:40, marginLeft:-85 }}>
                <Anvil width={170} />
                {/* 地金 */}
                <div style={{ position:'absolute', left:50, top:-14, width:44, height:16, borderRadius:5, background:`linear-gradient(180deg, #fff6d8, ${blank})`,
                  boxShadow:`0 0 ${10 + strikes * 6}px ${blank}, 0 0 ${20 + strikes * 10}px ${blank}`, transition:'all 0.25s' }} />
              </div>
              {/* 金槌（持ち手の端を中心に回す） */}
              <div style={{ position:'absolute', right:6, top:22, width:120, height:120, transformOrigin:'60px 114px',
                transform:'rotate(-58deg)', animation: phase === 'forge' ? `cfStrike 450ms cubic-bezier(.5,0,.7,1) infinite` : undefined }}>
                <Hammer size={120} />
              </div>
            </>
          )}
          {ended && (
            <div style={{ position:'absolute', left:'50%', top:'50%', width:120, height:120, marginLeft:-60, marginTop:-60, borderRadius:16,
              background:'radial-gradient(circle at 50% 40%, #1d2a4a 0%, #0a1024 75%)', border:`3px solid ${tier.color}`,
              boxShadow:`0 0 24px ${tier.color}, inset 0 0 22px ${tier.color}88`, display:'flex', alignItems:'center', justifyContent:'center',
              animation:'cfPop 0.7s cubic-bezier(.2,1.4,.4,1) both' }}>
              <GearGlyph part={job.part} color={tier.color} size={78} />
            </div>
          )}
        </div>

        {/* 下の文字 */}
        <div style={{ marginTop:4, textAlign:'center', fontSize:12, color:'#cfe2ff', minHeight:20 }}>
          <span style={{ color: tier.color }}>{job.name}</span>
          <span style={{ marginLeft:6, color:'#93a9be' }}>（{job.kind}・LV{job.lv}）</span>
        </div>
        {phase !== 'result' && <div style={{ marginTop:8, fontSize:10, color:'#62789a' }}>押すと飛ばせます</div>}

        {/* 結果のポップアップ */}
        {phase === 'result' && (
          <div onClick={e => e.stopPropagation()} style={{ marginTop:12, width:'100%', border:`1px solid ${tier.color}`, background:'#001040ee',
            boxShadow:`0 0 18px ${tier.color}55`, animation:'cfPanel 0.3s ease-out both' }}>
            <div style={{ padding:'10px 12px', borderBottom:'1px solid #002a55', color: tier.color, fontSize:14, fontWeight:'bold' }}>
              🔨 {craftTitleOf(job.name)}
            </div>
            <div style={{ padding:'10px 12px', fontSize:12, color:'#88ccff', lineHeight:1.8 }}>
              <div>戦闘力 <span style={{ color:'#44ff88' }}>{job.power}</span>{job.sync && <span style={{ color:'#ff8844', fontSize:11 }}>（いまは{job.sync}）</span>}</div>
              <div style={{ color:'#93a9be', fontSize:11 }}>{job.statText}</div>
              <div>使ったもの：<span style={{ color:'#cfe2ff' }}>{job.scrapName} {job.scrap}個</span>・<span style={{ color:'#ffcc00' }}>Gold {Number(job.gold).toLocaleString()}</span></div>
              <div style={{ color:'#93a9be', fontSize:11 }}>+0で持ち物に入りました</div>
              {!nextLabel && nextReason && <div style={{ color:'#7fa6d0', fontSize:11 }}>{nextReason}</div>}
            </div>
            <div style={{ padding:'10px 12px', borderTop:'1px solid #002a55', display:'flex', gap:8 }}>
              <button onClick={onClose} style={panelBtn('#88aaff')}>閉じる</button>
              {nextLabel && <button onClick={onAgain} style={panelBtn('#ffaa44')}>{nextLabel}</button>}
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
