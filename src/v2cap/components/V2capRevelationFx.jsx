// ============================================================
// v2cap ユグレシアの宝樹 — 祈りの演出（天啓）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「ユグレシアの祈りの演出、いいっちゃいいんだけど、木に『祈る』って感じだから
//   神から天啓をもらう感じの演出にしてほしい」（音はなし）。前のおみくじ（箱を振る→棒→紙）から作り直した
//   ・祈る：夜空の下の宝樹へ、地面から光の粒が昇っていく（結果が届くまで・最低1.6秒）
//   ・天啓が降りる：天の光輪が現れ、空から光の柱が宝樹へ降りる・羽根が舞う
//   ・天啓：「─ 天 啓 ─」の下に運勢が光の中から現れ、宝樹のことば（運勢のひとこと）が1文字ずつ届く
//     大吉＝金の光・金色の葉と羽根が降りそそぐ … 末吉＝かすかな光／凶＝光が弱くまたたいて消える・もや／大凶＝暗雲と稲光・赤黒いもや
//   ・最後に EXP を数え上げる。押すと飛ばせる
//   ★宝樹はユーザーの絵（lib/fxStyle.js の TREE_ART）を場面の背景にする。明るさを 祈り→降りる→天啓（運勢しだい）で変え、
//     ことばの後ろだけ少し暗くして読めるようにする。TREE_ART が null なら星空と影絵の木（SacredTree）
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { CountUp } from './casinoParts.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { FORTUNE_BY_NAME } from '../lib/tree.js'
import { revelationStyleOf, TREE_ART, ART_PRAY, ART_DESCEND, ART_BY_FORTUNE, artFilterOf } from '../lib/fxStyle.js'

const KF = `
@keyframes rvFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes rvTwinkle { 0%,100% { opacity: 0.25 } 50% { opacity: 1 } }
@keyframes rvBeam { from { transform: translateX(-50%) scaleY(0); opacity: 0 } to { transform: translateX(-50%) scaleY(1); opacity: 1 } }
@keyframes rvFlicker { 0%,100% { opacity: 0.35 } 15% { opacity: 0.7 } 30% { opacity: 0.12 } 50% { opacity: 0.55 } 70% { opacity: 0.08 } 85% { opacity: 0.3 } }
@keyframes rvSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes rvHaloIn { from { opacity: 0; filter: blur(8px) } to { opacity: 1; filter: blur(0) } }
@keyframes rvWord { 0% { opacity: 0; transform: translateY(-26px) scale(1.35); filter: blur(14px) } 60% { opacity: 1; filter: blur(0) } 100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) } }
@keyframes rvUp { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes rvPulse { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
@keyframes rvFlash { 0% { opacity: 0.85 } 100% { opacity: 0 } }
@keyframes rvCloudL { from { transform: translateX(-70%) } to { transform: translateX(0) } }
@keyframes rvCloudR { from { transform: translateX(70%) } to { transform: translateX(0) } }
@keyframes rvBolt { 0%,100% { opacity: 0 } 5%,18% { opacity: 1 } 10% { opacity: 0.2 } }
@keyframes rvRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
`
const MINCHO = "'Yu Mincho','YuMincho','Hiragino Mincho ProN','Noto Serif JP','MS PMincho',serif"
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// 宝樹（影絵）。glow＝葉の光の色・power＝光の強さ（0〜1）
const CANOPY = [
  [200, 58, 40], [172, 74, 40], [228, 74, 40], [200, 100, 58], [150, 104, 50], [250, 104, 50], [122, 132, 46], [278, 132, 46],
  [200, 140, 70], [158, 150, 58], [242, 150, 58], [96, 164, 40], [304, 164, 40], [130, 182, 46], [270, 182, 46], [70, 192, 30], [330, 192, 30],
  [176, 196, 52], [224, 196, 52], [104, 206, 30], [296, 206, 30], [200, 214, 44], [150, 218, 32], [250, 218, 32],
]
function SacredTree({ glow, power, dim }) {
  const lights = useMemo(() => {
    const rnd = seeded(7)
    const out = []
    while (out.length < 48) {
      const [cx, cy, r] = CANOPY[Math.floor(rnd() * CANOPY.length)]
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.85
      out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: 1.2 + rnd() * 2.2, delay: (rnd() * 3).toFixed(2), dur: (1.6 + rnd() * 2).toFixed(2) })
    }
    return out
  }, [])
  const shadow = `drop-shadow(0 0 ${6 + power * 18}px ${glow}) drop-shadow(0 0 ${2 + power * 6}px ${glow})`
  return (
    <svg viewBox="0 0 400 420" width="100%" height="100%" style={{ display:'block', overflow:'visible' }} aria-hidden="true">
      <defs>
        <radialGradient id="rvLeaf" gradientUnits="userSpaceOnUse" cx="200" cy="100" r="190">
          <stop offset="0" stopColor={dim ? '#1a2a24' : '#1f5a3a'} /><stop offset="1" stopColor={dim ? '#0a100e' : '#08200f'} />
        </radialGradient>
        <linearGradient id="rvBark" x1="0" x2="1">
          <stop offset="0" stopColor="#120c07" /><stop offset="0.5" stopColor="#2c1f12" /><stop offset="1" stopColor="#120c07" />
        </linearGradient>
        <radialGradient id="rvGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={glow} stopOpacity={0.35 * power + 0.08} /><stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="414" rx="190" ry="26" fill="url(#rvGround)" />
      <g fill="url(#rvBark)" style={{ filter: `drop-shadow(0 0 ${2 + power * 4}px ${glow}88)` }}>
        <path d="M150 420 C160 410 172 404 182 402 L218 402 C228 404 240 410 250 420 Z" />
        <path d="M182 404 C160 408 120 412 66 419 C110 410 150 402 172 394 Z" />
        <path d="M218 404 C240 408 280 412 334 419 C290 410 250 402 228 394 Z" />
        <path d="M178 412 C176 380 168 352 160 338 C150 322 128 318 108 322 C130 312 152 314 168 326 C172 300 178 276 184 252 C170 240 150 230 132 214 C154 222 172 232 186 240 C190 220 192 200 194 182 L206 182 C208 200 210 220 214 240 C228 232 246 222 268 214 C250 230 230 240 216 252 C222 276 228 300 232 326 C248 314 270 312 292 322 C272 318 250 322 240 338 C232 352 224 380 222 412 Z" />
      </g>
      <g style={{ filter: shadow, transition:'filter 0.8s' }}>
        {CANOPY.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill="url(#rvLeaf)" />)}
      </g>
      <g>
        {lights.map((l, i) => (
          <circle key={i} cx={l.x} cy={l.y} r={l.r} fill={dim ? '#6a5a7a' : glow}
            style={{ animation:`rvTwinkle ${l.dur}s ease-in-out ${l.delay}s infinite`, opacity: 0.6 }} />
        ))}
      </g>
    </svg>
  )
}

// 天の光輪
function Halo({ color, size = 220 }) {
  const ticks = Array.from({ length: 48 }, (_, i) => i)
  return (
    <svg width={size} height={size} viewBox="-110 -110 220 220" aria-hidden="true" style={{ overflow:'visible' }}>
      <circle r="96" fill="none" stroke={color} strokeWidth="1.5" opacity="0.85" />
      <circle r="84" fill="none" stroke={color} strokeWidth="0.8" opacity="0.6" strokeDasharray="3 6" />
      {ticks.map(i => <line key={i} x1="0" y1="-96" x2="0" y2={i % 4 === 0 ? -82 : -90} stroke={color} strokeWidth="1" transform={`rotate(${i * 7.5})`} opacity="0.8" />)}
      <circle r="60" fill="none" stroke={color} strokeWidth="1.2" opacity="0.7" />
      {Array.from({ length: 8 }, (_, i) => <path key={i} d="M0,-60 L5,-48 L0,-36 L-5,-48 Z" fill={color} opacity="0.8" transform={`rotate(${i * 45})`} />)}
      <circle r="22" fill={color} opacity="0.25" />
    </svg>
  )
}

export default function V2capRevelationFx({ result, onClose }) {
  const [phase, setPhase] = useState('pray')   // pray | descend | oracle | final
  const [chars, setChars] = useState(0)
  const [flash, setFlash] = useState(null)
  const [bolt, setBolt] = useState(0)
  const canvasRef = useRef(null)
  const treeRef = useRef(null)
  const wordRef = useRef(null)
  const fx = useRef(null)
  const resultRef = useRef(result)
  const skipRef = useRef(false)
  const shown = useRef(false)
  useEffect(() => { resultRef.current = result }, [result])

  const f = result ? FORTUNE_BY_NAME[result.fortune] : null
  const st = f ? revelationStyleOf(f.name) : null
  const stars = useMemo(() => {
    const rnd = seeded(42)
    return Array.from({ length: 70 }, () => ({ x: rnd() * 100, y: rnd() * 62, s: 1 + rnd() * 1.8, d: (rnd() * 3).toFixed(2), t: (1.5 + rnd() * 2.5).toFixed(2) }))
  }, [])

  useEffect(() => {
    fx.current = createParticles(canvasRef.current)
    return () => fx.current?.destroy()
  }, [])
  const rectIn = (el, ax, ay) => {
    const r = el?.getBoundingClientRect(), c = canvasRef.current?.getBoundingClientRect()
    if (!r || !c) return { x: 0, y: 0 }
    return { x: r.left + r.width * ax - c.left, y: r.top + r.height * ay - c.top }
  }

  // 天啓が出たときの光
  const showOracle = () => {
    if (shown.current || !resultRef.current) return
    shown.current = true
    const s = revelationStyleOf(resultRef.current.fortune)
    const w = rectIn(wordRef.current, 0.5, 0.5)
    const t = rectIn(treeRef.current, 0.5, 0.3)
    const W = canvasRef.current?.getBoundingClientRect().width || 400
    if (s.level >= 4) setFlash({ color: s.glow, key: Date.now() })
    if (s.burst) fx.current?.burst(w.x, w.y, s.level >= 5 ? 120 : s.level * 22, { colors: s.burst, speed: [140, 380 + s.level * 40], g: 120, shapes: ['star', 'dot', 'spark'], life: 1.8 })
    if (s.fall) fx.current?.fall(s.level >= 5 ? 80 : s.level >= 4 ? 40 : s.level * 8, { shape: s.fall.shape, colors: s.fall.colors, size: [5, 10] })
    if (s.mist) fx.current?.mist(t.x, t.y, s.storm ? 26 : 14, { colors: s.mist, spread: 190 })
    if (s.feathers) fx.current?.fall(Math.round(s.feathers / 2), { shape: 'feather', colors: ['#ffffff', '#f4f7ff'], speed: [30, 70], size: [6, 11], x: [W / 2 - 160, W / 2 + 160] })
  }

  // 流れ
  useEffect(() => {
    let alive = true
    const motes = setInterval(() => {
      const t = rectIn(treeRef.current, 0.5, 0.95)
      fx.current?.rise(t.x, t.y, 2, { colors: TREE_ART ? ['#fff2c0', '#ffffff', '#ffe08a'] : ['#bff5d0', '#ffffff', '#9fe0b8'], spread: 150 })
    }, 110)
    ;(async () => {
      const t0 = performance.now()
      while (alive && (!resultRef.current || (!skipRef.current && performance.now() - t0 < 1600))) await sleep(60)
      clearInterval(motes)
      if (!alive) return
      const s = revelationStyleOf(resultRef.current.fortune)
      if (!skipRef.current) {
        setPhase('descend')
        const W = canvasRef.current?.getBoundingClientRect().width || 400
        if (s.feathers) fx.current?.fall(Math.round(s.feathers / 2), { shape: 'feather', colors: ['#ffffff', '#eef3ff'], speed: [30, 70], size: [6, 11], x: [W / 2 - 140, W / 2 + 140] })
        if (s.storm) {
          await sleep(450); if (!alive) return
          setBolt(b => b + 1); setFlash({ color: '#c9a6ff', key: Date.now() })
          await sleep(500); if (!alive) return
          setBolt(b => b + 1); setFlash({ color: '#ffffff', key: Date.now() + 1 })
          await sleep(300)
        } else await sleep(1100)
      }
      if (!alive) return
      setPhase('oracle')
      await sleep(80)
      showOracle()
      // 宝樹のことばを1文字ずつ
      const text = FORTUNE_BY_NAME[resultRef.current.fortune]?.text || ''
      for (let i = 1; i <= text.length && alive; i++) {
        if (skipRef.current) { setChars(text.length); break }
        setChars(i); await sleep(55)
      }
      if (!alive) return
      await sleep(skipRef.current ? 150 : 650)
      if (alive) setPhase('final')
    })()
    return () => { alive = false; clearInterval(motes) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ流す
  }, [])

  const skip = () => { if (phase !== 'final') skipRef.current = true }
  useEffect(() => {
    const onKey = (e) => {
      if (!['Enter', ' ', 'Escape'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      if (phase === 'final') onClose(); else skipRef.current = true
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, onClose])

  const lit = phase === 'descend' || phase === 'oracle' || phase === 'final'
  const told = phase === 'oracle' || phase === 'final'
  const bad = st && st.level < 0
  const treeGlow = told && st ? (bad ? '#5a4a6a' : st.glow) : '#3fae6a'
  const treePower = told && st ? (bad ? 0.1 : 0.35 + st.level * 0.13) : 0.25
  const beamColor = st ? st.beam : '#e2f2ff'
  return (
    <div onClick={phase === 'final' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', fontFamily:'monospace', cursor: phase === 'final' ? 'default' : 'pointer',
        background: told && bad
          ? `linear-gradient(180deg, ${st.storm ? '#0d0510' : '#0c0816'} 0%, #04020a 100%)`
          : 'linear-gradient(180deg, #050b1e 0%, #071a1c 55%, #020806 100%)',
        transition:'background 0.9s', animation:'rvFadeIn 0.35s ease-out' }}>
      <style>{KF}</style>
      {TREE_ART && (
        <div style={{ position:'absolute', inset:0, backgroundImage:`url(${TREE_ART})`, backgroundSize:'cover', backgroundPosition:'50% 30%',
          filter: artFilterOf(told && f ? (ART_BY_FORTUNE[f.name] || ART_DESCEND) : lit ? ART_DESCEND : ART_PRAY),
          transform: told && st && st.level >= 4 ? 'scale(1.035)' : 'scale(1)', transition:'filter 1.4s ease, transform 3s ease' }} />
      )}
      {TREE_ART && told && st && st.level >= 3 && (
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'screen', animation:'rvFadeIn 1s ease-out both',
          background:`radial-gradient(circle at 50% 36%, ${st.glow}38 0%, transparent 60%)` }} />
      )}
      {TREE_ART && told && bad && (
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'multiply', animation:'rvFadeIn 1s ease-out both',
          background: st.storm ? 'rgba(90,0,30,0.45)' : 'rgba(40,20,90,0.35)' }} />
      )}
      {TREE_ART && told && (
        <div style={{ position:'absolute', left:0, right:0, top:0, height:'64vh', pointerEvents:'none', animation:'rvFadeIn 0.6s ease-out both',
          background:'radial-gradient(ellipse 58% 50% at 50% 40%, rgba(0,0,14,0.8) 0%, rgba(0,0,14,0.5) 50%, transparent 80%)' }} />
      )}
      {/* 星（絵が無いときだけ。絵には空が描いてある） */}
      {!TREE_ART && stars.map((s, i) => (
        <div key={i} style={{ position:'absolute', left:`${s.x}%`, top:`${s.y}%`, width:s.s, height:s.s, borderRadius:'50%', background:'#ffffff',
          animation:`rvTwinkle ${s.t}s ease-in-out ${s.d}s infinite`, opacity: told && st?.storm ? 0.1 : 0.7, transition:'opacity 0.8s' }} />
      ))}
      {/* 光の筋（大吉・中吉） */}
      {told && st && st.level >= 4 && (
        <div style={{ position:'absolute', left:'50%', top:'26%', width:'170vmax', height:'170vmax', pointerEvents:'none',
          background:`repeating-conic-gradient(${st.glow}26 0deg 7deg, transparent 7deg 18deg)`,
          maskImage:'radial-gradient(circle, #000 0%, transparent 50%)', WebkitMaskImage:'radial-gradient(circle, #000 0%, transparent 50%)',
          animation:'rvRays 10s linear infinite' }} />
      )}
      {/* 暗雲（大凶） */}
      {lit && st?.storm && (
        <>
          <div style={{ position:'absolute', left:'-10%', top:'-6%', width:'70%', height:'30%', borderRadius:'50%', background:'#1a0d1e', filter:'blur(18px)', opacity:0.95, animation:'rvCloudL 0.9s ease-out both' }} />
          <div style={{ position:'absolute', right:'-10%', top:'-4%', width:'70%', height:'28%', borderRadius:'50%', background:'#14081a', filter:'blur(18px)', opacity:0.95, animation:'rvCloudR 0.9s ease-out both' }} />
        </>
      )}
      {/* 天の光輪 */}
      {lit && (
        <div style={{ position:'absolute', left:'50%', top:-14, width:180, height:180, marginLeft:-90, pointerEvents:'none', opacity: bad ? 0.45 : 1,
          animation:'rvHaloIn 0.8s ease-out both' }}>
          <div style={{ width:180, height:180, animation:'rvSpin 18s linear infinite' }}><Halo color={beamColor} size={180} /></div>
        </div>
      )}
      {/* 天から降りる光の柱 */}
      {lit && (
        <div style={{ position:'absolute', left:'50%', top:0, width: bad ? 110 : 190, height:'58vh', transformOrigin:'50% 0%', pointerEvents:'none',
          background:`linear-gradient(90deg, transparent, ${beamColor}55 25%, ${beamColor}cc 50%, ${beamColor}55 75%, transparent)`,
          maskImage:'linear-gradient(180deg, #000 0%, #000 60%, transparent 100%)', WebkitMaskImage:'linear-gradient(180deg, #000 0%, #000 60%, transparent 100%)',
          animation: told && st?.flicker ? 'rvBeam 0.9s ease-out both, rvFlicker 1.4s linear 0.9s infinite' : 'rvBeam 0.9s ease-out both', filter:'blur(1px)' }} />
      )}
      {/* 稲光（大凶） */}
      {bolt > 0 && (
        <svg key={bolt} width="120" height="360" viewBox="0 0 120 360" style={{ position:'absolute', left:'calc(50% - 90px)', top:'4vh', pointerEvents:'none', animation:'rvBolt 0.7s linear both' }} aria-hidden="true">
          <polyline points="70,0 48,90 78,96 40,200 72,206 30,360" fill="none" stroke="#efe2ff" strokeWidth="4" style={{ filter:'drop-shadow(0 0 8px #b98cff) drop-shadow(0 0 2px #fff)' }} />
        </svg>
      )}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {flash && <div key={flash.key} style={{ position:'absolute', inset:0, background: flash.color, mixBlendMode:'screen', pointerEvents:'none', animation:'rvFlash 0.6s ease-out forwards' }} />}

      {/* 宝樹 */}
      {TREE_ART
        ? <div ref={treeRef} style={{ position:'absolute', left:'50%', top:'8%', width:'min(80vw, 900px)', height:'70%', transform:'translateX(-50%)', pointerEvents:'none' }} />
        : (
          <div ref={treeRef} style={{ position:'absolute', left:'50%', bottom:0, width:'min(92vw, 440px, calc(54vh * 400 / 420))', aspectRatio:'400 / 420', transform:'translateX(-50%)', pointerEvents:'none' }}>
            <SacredTree glow={treeGlow} power={treePower} dim={told && bad} />
          </div>
        )}

      {/* ことば */}
      <div style={{ position:'absolute', left:0, right:0, top: told ? 172 : '24vh', display:'flex', flexDirection:'column', alignItems:'center', padding:'0 16px', textAlign:'center', pointerEvents:'none' }}>
        {phase === 'pray' && (
          <div style={{ color:'#e6f5ea', fontFamily: MINCHO, fontSize:16, letterSpacing:4, textShadow:'0 0 10px #000, 0 0 3px #000, 0 0 14px #2f8f55', animation:'rvPulse 1.4s ease-in-out infinite' }}>
            ユグレシアの宝樹に祈りを捧げる…
          </div>
        )}
        {phase === 'descend' && (
          <div style={{ color: beamColor, fontFamily: MINCHO, fontSize:15, letterSpacing:6, textShadow:`0 0 10px ${beamColor}`, animation:'rvUp 0.6s ease-out both' }}>
            天より、ことばが降りる…
          </div>
        )}
        {told && f && (
          <>
            <div style={{ color: bad ? '#9a86b0' : '#efe6c8', fontFamily: MINCHO, fontSize:14, letterSpacing:10, animation:'rvUp 0.5s ease-out both', textShadow:'0 0 8px #000, 0 0 3px #000, 0 1px 0 #000' }}>─ 天 啓 ─</div>
            <div ref={wordRef} style={{ fontFamily: MINCHO, fontWeight:'bold', fontSize: 'clamp(54px, 15vw, 84px)', letterSpacing:14, color: f.color, lineHeight:1.15, marginTop:4,
              textShadow: bad ? `0 0 3px #000, 0 0 14px ${f.color}88, 0 2px 0 #000` : `0 0 3px #000, 0 0 10px ${f.color}, 0 0 26px ${f.color}, 0 0 50px ${f.color}88, 0 2px 0 #000`,
              animation:'rvWord 0.9s cubic-bezier(.2,1,.3,1) both' }}>
              {f.name}
            </div>
            <div style={{ minHeight:46, maxWidth:440, marginTop:8, padding: chars > 0 ? '4px 14px' : 0, borderRadius:8, background: chars > 0 && TREE_ART ? 'rgba(0,0,14,0.55)' : 'transparent', fontFamily: MINCHO, fontSize:15, lineHeight:1.7, color: bad ? '#c6b6d8' : '#fbf4e2', textShadow:'0 0 8px #000, 0 0 2px #000, 0 1px 0 #000' }}>
              {chars > 0 && <>「{f.text.slice(0, chars)}{chars >= f.text.length ? '」' : ''}</>}
            </div>
          </>
        )}
      </div>

      {/* ごほうび */}
      {phase === 'final' && result && (
        <div style={{ position:'absolute', left:0, right:0, bottom:'5vh', display:'flex', justifyContent:'center', pointerEvents:'none' }}>
        <div onClick={e => e.stopPropagation()} style={{ pointerEvents:'auto', minWidth:240, textAlign:'center',
          background:'#020a08cc', border:`1px solid ${bad ? '#5a4a6a' : '#2f8f55'}`, padding:'12px 18px', animation:'rvUp 0.4s ease-out both' }}>
          <div style={{ color:'#ffcc00', fontSize:22, fontWeight:'bold', fontFamily: JP_BOLD, textShadow:'0 0 10px #ffb30088' }}>
            EXP +<CountUp value={Number(result.exp) || 0} start={0} ms={900} />
          </div>
          {result.level?.level_ups > 0 && <div style={{ color:'#44ff88', fontSize:13, marginTop:4 }}>🆙 LEVEL UP！ LV{result.level.lv}</div>}
          {result.level?.job_ups > 0 && <div style={{ color:'#ffcc00', fontSize:12, marginTop:2 }}>⭐ CLASS LEVEL UP！</div>}
          <button onClick={onClose} style={{ marginTop:12, minWidth:180, background:'#03201a', border:'1px solid #44dd99', color:'#44dd99', padding:'10px', cursor:'pointer', fontFamily:'monospace', fontSize:13 }}>
            閉じる
          </button>
        </div>
        </div>
      )}
      {phase !== 'final' && <div style={{ position:'absolute', left:0, right:0, bottom:'2vh', textAlign:'center', fontSize:10, color:'#4f7a66', pointerEvents:'none' }}>押すと飛ばせます</div>}
    </div>
  )
}
