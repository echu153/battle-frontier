// ============================================================
// v2cap ユグレシアの宝樹 — 祈りの演出（天啓）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「ユグレシアの祈りの演出、いいっちゃいいんだけど、木に『祈る』って感じだから
//   神から天啓をもらう感じの演出にしてほしい」（音はなし）。前のおみくじ（箱を振る→棒→紙）から作り直した
//   ・祈る：夜空の下の宝樹へ、地面から光の粒が昇っていく（結果が届くまで・最低1.6秒）
//   ・天啓が降りる：天の光輪が現れ、空から光の柱が宝樹へ降りる・羽根が舞う
//   ・天啓：「─ 天 啓 ─」の下に運勢が光の中から現れ、宝樹のことば（運勢のひとこと）が1文字ずつ届く
//     大吉＝金の光・金色の葉と羽根が降りそそぐ … 末吉＝かすかな光／凶＝光が弱くまたたいて消える・もや／大凶＝嵐（下）・赤黒いもや
//   ・最後に EXP を数え上げる。押すと飛ばせる
//   ★宝樹はユーザーの絵（lib/fxStyle.js の TREE_ART）を場面の背景にする。明るさを 祈り→降りる→天啓（運勢しだい）で変え、
//     ことばの後ろだけ少し暗くして読めるようにする。TREE_ART が null なら星空と影絵の木（SacredTree）
// 【確定】2026-10-14 ユーザー指示「大凶の時の演出、雷とか魔法陣の演出安っぽいから修正したい」→ ユーザーの絵（STORM_ART）で作り直した：
//   ・暗雲の絵が左右からゆっくり覆って流れ、雨が降る（fxParticles の rain）。光の柱は出さない
//     （【確定】同じ日にユーザー「雲も急に上から出てきてるから、初期みたいに左右からゆっくり雲が覆うように」＝上から落とすのはやめた）
//   ・【確定】同じ日にユーザー「魔法陣は初期のままでよさそうかも、違和感ある」＝魔法陣の絵はやめ、天の光輪は前のまま（大凶の色・0.45）
//   ・雷の絵が2回落ちる（STORM_STRIKES）→「大凶」が出るときにもう1回。落ちるたび画面が光って揺れ、宝樹が一瞬照らされる
//   ・天啓のあとも遠くで時々雷（小さく・揺れない）。大凶の絵は大凶になったときに読み込み始め、降りる前に最大1.5秒待つ
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { CountUp } from './casinoParts.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { FORTUNE_BY_NAME } from '../lib/tree.js'
import { gainedExpOf } from '../lib/settleLines.js'
import { revelationStyleOf, TREE_ART, ART_PRAY, ART_DESCEND, ART_BY_FORTUNE, artFilterOf, MINCHO,
  STORM_ART, STORM_STRIKES, STORM_AMBIENT_MS, STORM_DESCEND_MS, STORM_CLOUD_MS } from '../lib/fxStyle.js'

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
@keyframes rvRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes rvFlashSoft { 0% { opacity: 0.28 } 100% { opacity: 0 } }
@keyframes rvStrike { 0% { opacity: 0 } 4% { opacity: 1 } 10% { opacity: 0.15 } 16% { opacity: 1 } 40% { opacity: 0.9 } 100% { opacity: 0 } }
@keyframes rvCloudInL { from { transform: translateX(-75%); opacity: 0 } 35% { opacity: 1 } to { transform: translateX(0); opacity: 1 } }
@keyframes rvCloudInR { from { transform: translateX(75%); opacity: 0 } 35% { opacity: 1 } to { transform: translateX(0); opacity: 1 } }
@keyframes rvStormDrift { from { transform: translateX(-3%) } to { transform: translateX(3%) } }
`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
// 大凶の絵を先に読み込む（読み込めなくても演出は進む）
const preloadStorm = () => Promise.all([...STORM_ART.bolts, STORM_ART.cloud].map(src => new Promise(res => {
  const img = new Image(); img.onload = img.onerror = () => res(); img.src = src
})))
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
  const [strikes, setStrikes] = useState([])     // 落ちている雷（大凶）
  const rootRef = useRef(null)
  const artRef = useRef(null)
  const strikeSeq = useRef(0)
  const stormReady = useRef(null)
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
  const storm = !!st?.storm
  // 大凶とわかったら、祈っている間に絵を読み込み始める
  useEffect(() => { if (storm && !stormReady.current) stormReady.current = preloadStorm() }, [storm])
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

  // 雷を1本落とす（大凶）。soft＝遠くの雷（小さく・弱く光る・揺れない）
  const strike = ({ x, bolt, h, shake = 0, top = 18, soft = false }) => {
    const key = ++strikeSeq.current
    const src = STORM_ART.bolts[bolt ?? Math.floor(Math.random() * STORM_ART.bolts.length)]
    setStrikes(a => [...a, { key, src, x, h, top, soft, flip: Math.random() < 0.5 }])
    setTimeout(() => setStrikes(a => a.filter(s => s.key !== key)), 900)
    setFlash({ color: soft ? '#b98cff' : '#f1e2ff', key: `s${key}`, soft })
    if (soft) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (shake && !reduce) {
      const k = shake
      rootRef.current?.animate?.([
        { transform: 'translate(0,0)' }, { transform: `translate(${-k}px,${k * 0.5}px)` }, { transform: `translate(${k * 0.8}px,${-k * 0.6}px)` },
        { transform: `translate(${-k * 0.4}px,${k * 0.3}px)` }, { transform: 'translate(0,0)' },
      ], { duration: 360, easing: 'ease-out' })
    }
    // 宝樹が一瞬照らされる（明るい状態から、もとの明るさ（CSS の値）へ戻る。途中の値を拾わないように終わりは書かない）
    artRef.current?.animate?.([{ offset: 0, filter: 'brightness(1.05) saturate(0.55)' }], { duration: 520, easing: 'ease-out' })
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
    // 「大凶」が出るときにもう1本（文字にかからない横のほう）
    if (s.storm) strike({ x: Math.random() < 0.5 ? rand(0.14, 0.24) : rand(0.76, 0.86), bolt: 2, h: 60, shake: 7 })
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
        // 大凶は絵が届くのを少しだけ待つ（最大1.5秒）
        if (s.storm) { await Promise.race([stormReady.current || (stormReady.current = preloadStorm()), sleep(1500)]); if (!alive) return }
        setPhase('descend')
        const W = canvasRef.current?.getBoundingClientRect().width || 400
        if (s.feathers) fx.current?.fall(Math.round(s.feathers / 2), { shape: 'feather', colors: ['#ffffff', '#eef3ff'], speed: [30, 70], size: [6, 11], x: [W / 2 - 140, W / 2 + 140] })
        if (s.storm) {
          // 暗雲が垂れ込めたところへ雷が2回
          const t1 = performance.now()
          for (const k of STORM_STRIKES) {
            await sleep(Math.max(0, k.at - (performance.now() - t1)))
            if (!alive) return
            if (skipRef.current) break
            strike(k)
          }
          if (!skipRef.current) await sleep(Math.max(0, STORM_DESCEND_MS - (performance.now() - t1)))
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
  // 大凶：降りてからはずっと雨
  useEffect(() => {
    if (!(lit && storm)) return
    const t = setInterval(() => fx.current?.rain(5, { colors: ['rgba(205,185,235,0.5)', 'rgba(255,150,185,0.32)'] }), 45)
    return () => clearInterval(t)
  }, [lit, storm])
  // 大凶：天啓のあとも遠くで時々雷
  useEffect(() => {
    if (!(told && storm)) return
    let t = 0
    const next = () => {
      t = setTimeout(() => {
        strike({ x: Math.random() < 0.5 ? rand(0.08, 0.26) : rand(0.74, 0.92), h: rand(34, 44), top: 16, soft: true })
        next()
      }, rand(STORM_AMBIENT_MS[0], STORM_AMBIENT_MS[1]))
    }
    next()
    return () => clearTimeout(t)
  }, [told, storm])
  const treeGlow = told && st ? (bad ? '#5a4a6a' : st.glow) : '#3fae6a'
  const treePower = told && st ? (bad ? 0.1 : 0.35 + st.level * 0.13) : 0.25
  const beamColor = st ? st.beam : '#e2f2ff'
  return (
    <div ref={rootRef} onClick={phase === 'final' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', fontFamily:'monospace', cursor: phase === 'final' ? 'default' : 'pointer',
        background: told && bad
          ? `linear-gradient(180deg, ${st.storm ? '#0d0510' : '#0c0816'} 0%, #04020a 100%)`
          : 'linear-gradient(180deg, #050b1e 0%, #071a1c 55%, #020806 100%)',
        transition:'background 0.9s', animation:'rvFadeIn 0.35s ease-out' }}>
      <style>{KF}</style>
      {TREE_ART && (
        <div ref={artRef} style={{ position:'absolute', inset:0, backgroundImage:`url(${TREE_ART})`, backgroundSize:'cover', backgroundPosition:'50% 30%',
          // 大凶は暗雲が来た時点で暗くする（大凶の宝樹の絵は「今のかんじのままでいい」＝赤黒く沈めるだけ）
          filter: artFilterOf((told || (lit && storm)) && f ? (ART_BY_FORTUNE[f.name] || ART_DESCEND) : lit ? ART_DESCEND : ART_PRAY),
          transform: told && st && st.level >= 4 ? 'scale(1.035)' : 'scale(1)', transition:'filter 1.4s ease, transform 3s ease' }} />
      )}
      {TREE_ART && told && st && st.level >= 3 && (
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'screen', animation:'rvFadeIn 1s ease-out both',
          background:`radial-gradient(circle at 50% 36%, ${st.glow}38 0%, transparent 60%)` }} />
      )}
      {TREE_ART && ((told && bad) || (lit && storm)) && (
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
      {/* 大凶：暗雲（ユーザーの絵）が左右からゆっくり覆って流れる・下に赤黒いもや
          雲の絵を左半分・右半分に分け（同じ絵をマスクで切る）、左右から真ん中へ寄せる。寄り切ると1枚の絵に戻る */}
      {lit && storm && (
        <>
          <div style={{ position:'absolute', left:0, right:0, top:'26vh', height:'34vh', pointerEvents:'none', animation:`rvFadeIn ${STORM_CLOUD_MS}ms ease-out both`,
            background:'linear-gradient(180deg, rgba(70,0,28,0.55) 0%, rgba(40,0,20,0.25) 55%, transparent 100%)' }} />
          <div style={{ position:'absolute', left:'-8%', right:'-8%', top:0, height:'44vh', pointerEvents:'none', animation:'rvStormDrift 14s ease-in-out infinite alternate' }}>
            {[['rvCloudInL', 'linear-gradient(90deg, #000 0%, #000 46%, transparent 62%)'], ['rvCloudInR', 'linear-gradient(90deg, transparent 38%, #000 54%, #000 100%)']].map(([anim, mask]) => (
              <div key={anim} style={{ position:'absolute', inset:0, backgroundImage:`url(${STORM_ART.cloud})`, backgroundSize:'cover', backgroundPosition:'50% 100%',
                maskImage: mask, WebkitMaskImage: mask, animation:`${anim} ${STORM_CLOUD_MS}ms cubic-bezier(.3,.1,.25,1) both` }} />
            ))}
          </div>
        </>
      )}
      {/* 天の光輪（大凶も前のまま＝大凶の色で薄く） */}
      {lit && (
        <div style={{ position:'absolute', left:'50%', top:-14, width:180, height:180, marginLeft:-90, pointerEvents:'none', opacity: bad ? 0.45 : 1,
          animation:'rvHaloIn 0.8s ease-out both' }}>
          <div style={{ width:180, height:180, animation:'rvSpin 18s linear infinite' }}><Halo color={beamColor} size={180} /></div>
        </div>
      )}
      {/* 天から降りる光の柱（大凶は出さない） */}
      {lit && !storm && (
        <div style={{ position:'absolute', left:'50%', top:0, width: bad ? 110 : 190, height:'58vh', transformOrigin:'50% 0%', pointerEvents:'none',
          background:`linear-gradient(90deg, transparent, ${beamColor}55 25%, ${beamColor}cc 50%, ${beamColor}55 75%, transparent)`,
          maskImage:'linear-gradient(180deg, #000 0%, #000 60%, transparent 100%)', WebkitMaskImage:'linear-gradient(180deg, #000 0%, #000 60%, transparent 100%)',
          animation: told && st?.flicker ? 'rvBeam 0.9s ease-out both, rvFlicker 1.4s linear 0.9s infinite' : 'rvBeam 0.9s ease-out both', filter:'blur(1px)' }} />
      )}
      {/* 雷（大凶・ユーザーの絵）。暗いふちは screen で消え、白い芯と赤い光だけが乗る */}
      {strikes.map(k => (
        <div key={k.key} style={{ position:'absolute', left:`${k.x * 100}%`, top:`${k.top}vh`, height:`${k.h}vh`, transform:'translateX(-50%)',
          pointerEvents:'none', mixBlendMode:'screen', opacity: k.soft ? 0.5 : 1 }}>
          <img src={k.src} alt="" style={{ display:'block', height:'100%', width:'auto', transform: k.flip ? 'scaleX(-1)' : 'none',
            filter: k.soft ? 'none' : 'drop-shadow(0 0 14px #ff2a6d)', animation:`rvStrike ${k.soft ? 0.75 : 0.6}s linear forwards` }} />
        </div>
      ))}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {flash && <div key={flash.key} style={{ position:'absolute', inset:0, background: flash.color, mixBlendMode:'screen', pointerEvents:'none', animation: flash.soft ? 'rvFlashSoft 0.5s ease-out forwards' : 'rvFlash 0.6s ease-out forwards' }} />}

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
          <div style={{ color: storm ? '#f0b8c8' : beamColor, fontFamily: MINCHO, fontSize:15, letterSpacing:6, textShadow: storm ? '0 0 8px #000, 0 0 14px #ff2a6d' : `0 0 10px ${beamColor}`, animation:'rvUp 0.6s ease-out both',
            ...(storm ? { background:'rgba(10,0,8,0.62)', padding:'4px 14px', borderRadius:8 } : {}) }}>
            天より、ことばが降りる…
          </div>
        )}
        {told && f && (
          <>
            <div style={{ color: storm ? '#e6c4d2' : bad ? '#9a86b0' : '#efe6c8', fontFamily: MINCHO, fontSize:14, letterSpacing:10, animation:'rvUp 0.5s ease-out both', textShadow:'0 0 8px #000, 0 0 3px #000, 0 1px 0 #000' }}>─ 天 啓 ─</div>
            <div ref={wordRef} style={{ fontFamily: MINCHO, fontWeight:'bold', fontSize: 'clamp(54px, 15vw, 84px)', letterSpacing:14, color: f.color, lineHeight:1.15, marginTop:4,
              textShadow: storm ? `0 0 3px #000, 0 0 10px #000, 0 0 22px ${f.color}88, 0 2px 0 #000` : bad ? `0 0 3px #000, 0 0 14px ${f.color}88, 0 2px 0 #000` : `0 0 3px #000, 0 0 10px ${f.color}, 0 0 26px ${f.color}, 0 0 50px ${f.color}88, 0 2px 0 #000`,
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
            EXP +<CountUp value={gainedExpOf(result)} start={0} ms={900} />
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
