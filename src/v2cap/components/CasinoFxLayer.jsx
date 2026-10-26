// v2cap 賭博場 — 演出の層（コイン・紙吹雪・光・揺れ・大きな文字・当たりの段階）
//   casinoFx.js の fx(…) を受けて、子の上にかぶせて出す。押しても下のボタンに届く（pointer-events:none）
//   ★当たりの段階の表示（BIG WIN など）だけは押して閉じられる
import { useEffect, useRef, useState } from 'react'
import { fxSubscribe, reducedMotion, sfx } from './casinoFx.js'
import { CountUp } from './casinoParts.jsx'
import { DISPLAY_FONT, RAINBOW_BASE } from './casinoStyle.js'

const KEYFRAMES = `
@keyframes csPop { 0% { transform: translate(-50%,-50%) scale(0.2); opacity: 0 } 18% { transform: translate(-50%,-50%) scale(1.25); opacity: 1 }
  30% { transform: translate(-50%,-50%) scale(0.95) } 40% { transform: translate(-50%,-50%) scale(1.04) } 80% { opacity: 1 }
  100% { transform: translate(-50%,-62%) scale(1); opacity: 0 } }
@keyframes csBanner { 0% { transform: scale(0.1) rotate(-8deg); opacity: 0 } 25% { transform: scale(1.18) rotate(2deg); opacity: 1 }
  40% { transform: scale(0.96) rotate(0) } 55% { transform: scale(1.03) } 100% { transform: scale(1) } }
@keyframes csRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes csShine { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
@keyframes csPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
@keyframes csBlink { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
@keyframes csHue { from { filter: hue-rotate(0deg) } to { filter: hue-rotate(360deg) } }
@keyframes csShake { 0% { transform: translate(0,0) } 20% { transform: translate(var(--p),calc(var(--p) * -0.6)) } 40% { transform: translate(calc(var(--p) * -1),calc(var(--p) * 0.4)) }
  60% { transform: translate(calc(var(--p) * 0.7),var(--p)) } 80% { transform: translate(calc(var(--p) * -0.5),calc(var(--p) * -0.8)) } 100% { transform: translate(0,0) } }
`

const COLORS = ['#ffcc00', '#ff4fa3', '#33e0ff', '#44ff88', '#a77bff', '#ffffff', '#ff6b3d']

export default function CasinoFxLayer({ children }) {
  const canvas = useRef(null)
  const parts = useRef([])
  const raf = useRef(0)
  const [flash, setFlash] = useState(null)       // {color, ms, key}
  const [rays, setRays] = useState(null)
  const [popups, setPopups] = useState([])
  const [banner, setBanner] = useState(null)
  const [shake, setShake] = useState(null)
  const seq = useRef(0)

  useEffect(() => {
    const cv = canvas.current
    const c2 = cv.getContext('2d')
    const resize = () => { cv.width = window.innerWidth * devicePixelRatio; cv.height = window.innerHeight * devicePixelRatio }
    resize()
    window.addEventListener('resize', resize)
    let last = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const W = cv.width, H = cv.height, s = devicePixelRatio
      c2.clearRect(0, 0, W, H)
      const list = parts.current
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt
        if (p.life <= 0 || p.y > H / s + 60) { list.splice(i, 1); continue }
        const alpha = Math.min(1, p.life / 0.5)
        c2.save(); c2.globalAlpha = alpha; c2.translate(p.x * s, p.y * s)
        if (p.kind === 'coin') {
          const w = Math.abs(Math.cos(p.rot)) * p.r * s + 1
          const grd = c2.createLinearGradient(-w, -p.r * s, w, p.r * s)
          grd.addColorStop(0, '#fff6b0'); grd.addColorStop(0.5, '#ffc400'); grd.addColorStop(1, '#a86b00')
          c2.fillStyle = grd
          c2.beginPath(); c2.ellipse(0, 0, w, p.r * s, 0, 0, Math.PI * 2); c2.fill()
          c2.strokeStyle = '#7a4c00'; c2.lineWidth = 1.2 * s; c2.stroke()
          if (w > p.r * s * 0.5) { c2.fillStyle = '#fffbe0aa'; c2.beginPath(); c2.ellipse(-w * 0.3, -p.r * s * 0.35, w * 0.25, p.r * s * 0.2, -0.6, 0, Math.PI * 2); c2.fill() }
        } else if (p.kind === 'spark') {
          c2.rotate(p.rot); c2.fillStyle = p.color
          c2.beginPath()
          for (let k = 0; k < 8; k++) { const r = (k % 2 ? 0.35 : 1) * p.r * s; c2.lineTo(Math.cos(k * Math.PI / 4) * r, Math.sin(k * Math.PI / 4) * r) }
          c2.closePath(); c2.fill()
        } else {
          c2.rotate(p.rot); c2.scale(1, Math.cos(p.rot * 1.7)); c2.fillStyle = p.color
          c2.fillRect(-p.r * s, -p.r * 0.5 * s, p.r * 2 * s, p.r * s)
        }
        c2.restore()
      }
      raf.current = list.length ? requestAnimationFrame(loop) : 0
    }
    const kick = () => { if (!raf.current) { last = performance.now(); raf.current = requestAnimationFrame(loop) } }
    const W = () => window.innerWidth, H = () => window.innerHeight
    const reduced = reducedMotion()
    const unsub = fxSubscribe((type, d) => {
      const key = ++seq.current
      if (type === 'coins') {
        const n = Math.min(260, reduced ? Math.ceil((d.n || 20) / 3) : d.n || 20)
        for (let i = 0; i < n; i++) {
          const top = d.from === 'top'
          const ox = typeof d.from === 'object' ? d.from.x : W() / 2, oy = typeof d.from === 'object' ? d.from.y : H() + 10
          parts.current.push(top
            ? { kind:'coin', x: Math.random() * W(), y: -20 - Math.random() * H() * 0.6, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 200, g: 380, r: 7 + Math.random() * 6, rot: Math.random() * 6, vr: 6 + Math.random() * 10, life: 4.5 }
            : { kind:'coin', x: ox + (Math.random() - 0.5) * 60, y: oy, vx: (Math.random() - 0.5) * 520, vy: -(520 + Math.random() * 520), g: 900, r: 6 + Math.random() * 6, rot: Math.random() * 6, vr: 8 + Math.random() * 12, life: 3.2 })
        }
        let k = 0
        const ding = () => { if (k < Math.min(12, n / 4)) { sfx.coin(k); k++; setTimeout(ding, 55) } }
        ding()
        kick()
      } else if (type === 'confetti') {
        const n = Math.min(260, reduced ? 30 : d.n || 80)
        for (let i = 0; i < n; i++) {
          const spark = Math.random() < 0.2
          parts.current.push({ kind: spark ? 'spark' : 'confetti', x: Math.random() * W(), y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 140,
            vy: 60 + Math.random() * 160, g: 90, r: spark ? 5 + Math.random() * 4 : 4 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
            color: COLORS[i % COLORS.length], life: 5 })
        }
        kick()
      } else if (type === 'flash') {
        if (!reduced) setFlash({ color: d.color || '#fff', ms: d.ms || 400, key })
      } else if (type === 'rays') {
        setRays({ color: d.color || '#ffcc00', ms: d.ms || 2000, key })
      } else if (type === 'popup') {
        setPopups(list => [...list.slice(-2), { ...d, key }])
        setTimeout(() => setPopups(list => list.filter(x => x.key !== key)), d.ms || 1500)
      } else if (type === 'banner') {
        setBanner({ ...d, key })
      } else if (type === 'shake') {
        if (!reduced) setShake({ ms: d.ms || 400, power: d.power || 4, key })
      }
    })
    return () => { unsub(); window.removeEventListener('resize', resize); cancelAnimationFrame(raf.current); raf.current = 0 }
  }, [])

  // 光・光の筋・揺れ・当たりの表示は時間で消す
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(null), flash.ms); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (!rays) return undefined; const t = setTimeout(() => setRays(null), rays.ms); return () => clearTimeout(t) }, [rays])
  useEffect(() => { if (!shake) return undefined; const t = setTimeout(() => setShake(null), shake.ms); return () => clearTimeout(t) }, [shake])
  useEffect(() => {
    if (!banner) return undefined
    const lv = { win: 1, big: 2, mega: 3, jackpot: 4 }[banner.tier?.key] || 2
    const t = setTimeout(() => setBanner(null), 2600 + lv * 1100)
    return () => clearTimeout(t)
  }, [banner])

  const bannerLv = banner ? ({ win: 1, big: 2, mega: 3, jackpot: 4 }[banner.tier?.key] || 2) : 0
  return (
    <div style={{ position:'relative' }}>
      <style>{KEYFRAMES}</style>
      <div style={shake ? { animation:`csShake 0.09s linear ${Math.ceil(shake.ms / 90)}`, '--p': `${shake.power}px` } : undefined}>
        {children}
      </div>
      <canvas ref={canvas} style={{ position:'fixed', inset:0, width:'100vw', height:'100vh', pointerEvents:'none', zIndex:400 }} />
      {flash && (
        <div key={flash.key} style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:390, background: flash.color, mixBlendMode:'screen',
          animation:`csBlink ${flash.ms / 3}ms ease-out 3`, opacity:0.35 }} />
      )}
      {rays && (
        <div key={rays.key} style={{ position:'fixed', left:'50%', top:'45%', width:'160vmax', height:'160vmax', pointerEvents:'none', zIndex:385,
          background:`repeating-conic-gradient(${rays.color}33 0deg 8deg, transparent 8deg 20deg)`,
          maskImage:'radial-gradient(circle, #000 0%, transparent 55%)', WebkitMaskImage:'radial-gradient(circle, #000 0%, transparent 55%)',
          animation:'csRays 6s linear infinite' }} />
      )}
      {popups.map(p => {
        const rainbow = p.color === 'rainbow'
        const c = rainbow ? RAINBOW_BASE : (p.color || '#ffcc00')
        return (
          <div key={p.key} style={{ position:'fixed', left:'50%', top: p.top || '40%', zIndex:410, pointerEvents:'none', textAlign:'center', whiteSpace:'nowrap',
            animation:`csPop ${(p.ms || 1500)}ms ease-out forwards`, fontFamily: DISPLAY_FONT }}>
            <div style={{ fontSize: p.size || 34, fontWeight:'bold', color: c, letterSpacing:'2px',
              textShadow:`0 0 8px ${c}, 0 0 22px ${c}, 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000`,
              animation: rainbow ? 'csHue 1.2s linear infinite' : undefined }}>{p.text}</div>
            {p.sub && <div style={{ fontSize:14, fontWeight:'bold', color:'#fff', textShadow:'0 0 6px #000, 1px 1px 0 #000', marginTop:4 }}>{p.sub}</div>}
          </div>
        )
      })}
      {banner && (
        <div key={banner.key} onClick={() => setBanner(null)} style={{ position:'fixed', inset:0, zIndex:420, display:'flex', alignItems:'center', justifyContent:'center',
          background:'radial-gradient(circle, #000a 0%, #000d 70%)', cursor:'pointer' }}>
          <div style={{ textAlign:'center', animation:'csBanner 0.9s cubic-bezier(.2,1.6,.4,1) both', padding:'0 16px' }}>
            {banner.title && <div style={{ color:'#fff', fontSize:16, fontWeight:'bold', fontFamily: DISPLAY_FONT, letterSpacing:'3px', marginBottom:6, textShadow:'0 0 8px #000' }}>{banner.title}</div>}
            {/* ★グラデーションの切り抜き（background-clip:text）は英字だけのここに限る（日本語はつぶれる・casinoStyle.js） */}
            <div style={{ fontFamily: DISPLAY_FONT, fontWeight:900, fontSize: 40 + bannerLv * 10, lineHeight:1.05, letterSpacing:'2px',
              background:`linear-gradient(90deg, #fff 0%, ${banner.tier.color} 25%, #fff 50%, ${banner.tier.color} 75%, #fff 100%)`, backgroundSize:'200% 100%',
              WebkitBackgroundClip:'text', backgroundClip:'text', color:'transparent', animation:'csShine 1.6s linear infinite',
              filter:`drop-shadow(0 0 12px ${banner.tier.color}) drop-shadow(0 0 2px #000)` }}>
              {banner.tier.label}
            </div>
            <div style={{ marginTop:10, fontSize: 30 + bannerLv * 4, fontWeight:'bold', color:'#ffe680', fontFamily: DISPLAY_FONT,
              textShadow:'0 0 10px #ffb300, 2px 2px 0 #000', animation:'csPulse 0.6s ease-in-out infinite' }}>
              +<CountUp value={banner.amount} start={0} ms={900 + bannerLv * 700} onTick={sfx.tick} />枚
            </div>
            {banner.sub && <div style={{ marginTop:8, color:'#cfe2ff', fontSize:12 }}>{banner.sub}</div>}
            {/* 受付嬢アレアのひとこと（celebrate の say・2026-10-27）。後ろの吹き出しは演出で隠れるので、ここにも出す */}
            {banner.say}
            <div style={{ marginTop:14, color:'#ffffff88', fontSize:10 }}>タップで閉じる</div>
          </div>
        </div>
      )}
    </div>
  )
}
