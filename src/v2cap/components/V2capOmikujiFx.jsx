// ============================================================
// v2cap ユグレシアの宝樹 — 祈りの演出（おみくじ）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「ユグレシアの祈りにも演出加えてほしい、結果が出る過程の、おみくじみたいな感じで」（音はなし）
//   みくじ箱を返す → 振る（結果が届くまで）→ みくじ棒が出て「第◯番」→ おみくじの紙が開く → 運勢がハンコのように押される
//   → 運勢ごとの光（大吉＝金の光の筋と花びら／中吉・小吉・吉・末吉＝だんだん控えめに／凶・大凶＝暗いもや）→ EXP を数え上げる
//   ・押すと飛ばせる（結果が届いていれば最後まで）。番号は飾り（運勢はサーバー v2cap_pray が決める）
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { CountUp } from './casinoParts.jsx'
import { FORTUNE_BY_NAME } from '../lib/tree.js'
import { omikujiStyleOf, kanjiNumberOf } from '../lib/fxStyle.js'

const KF = `
@keyframes okFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes okTurn { from { transform: rotate(0deg) } to { transform: rotate(165deg) } }
@keyframes okShake { 0% { transform: rotate(165deg) translate(0,0) } 25% { transform: rotate(178deg) translate(-5px,7px) } 50% { transform: rotate(158deg) translate(4px,-5px) }
  75% { transform: rotate(174deg) translate(-3px,4px) } 100% { transform: rotate(165deg) translate(0,0) } }
@keyframes okStick { 0% { transform: translate(-50%, -70px); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(-50%, 0); opacity: 1 } }
@keyframes okAway { to { transform: translateY(-40px) scale(0.85); opacity: 0 } }
@keyframes okUnfold { 0% { transform: perspective(700px) rotateX(70deg) scaleY(0.08); opacity: 0.4 } 60% { transform: perspective(700px) rotateX(-6deg) scaleY(1.03); opacity: 1 }
  100% { transform: perspective(700px) rotateX(0) scaleY(1); opacity: 1 } }
@keyframes okStamp { 0% { transform: scale(2.1) rotate(-8deg); opacity: 0 } 55% { transform: scale(0.92) rotate(1deg); opacity: 1 } 75% { transform: scale(1.05) } 100% { transform: scale(1) rotate(0); opacity: 1 } }
@keyframes okSeal { 0% { transform: scale(2.4) rotate(-20deg); opacity: 0 } 60% { transform: scale(0.9) rotate(-10deg); opacity: 0.95 } 100% { transform: scale(1) rotate(-12deg); opacity: 0.9 } }
@keyframes okRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes okTremble { 0%,100% { transform: translate(0,0) rotate(0) } 25% { transform: translate(-2px,1px) rotate(-0.6deg) } 75% { transform: translate(2px,-1px) rotate(0.6deg) } }
@keyframes okFlash { 0% { opacity: 0.85 } 100% { opacity: 0 } }
@keyframes okUp { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes okGlow { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
`
const MINCHO = "'Yu Mincho','YuMincho','Hiragino Mincho ProN','MS PMincho','Noto Serif JP',serif"
// 紙に書く字の色（運勢の色は紙の上だと薄いものがあるので、墨と朱で書く）
const INK = { 大吉: '#c8001e', 中吉: '#c8001e', 小吉: '#b0102a', 吉: '#a0142c', 末吉: '#7a2a2a', 凶: '#3a2a4a', 大凶: '#1c0418' }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// みくじ箱（六角の木の箱・正面から3面）
function MikujiBox() {
  return (
    <svg width="110" height="160" viewBox="0 0 110 160" aria-hidden="true">
      <defs>
        <linearGradient id="okWoodL" x1="0" x2="1"><stop offset="0" stopColor="#5a3412" /><stop offset="1" stopColor="#8a5424" /></linearGradient>
        <linearGradient id="okWoodM" x1="0" x2="1"><stop offset="0" stopColor="#b0763a" /><stop offset="0.5" stopColor="#d49a58" /><stop offset="1" stopColor="#b0763a" /></linearGradient>
        <linearGradient id="okWoodR" x1="0" x2="1"><stop offset="0" stopColor="#8a5424" /><stop offset="1" stopColor="#5a3412" /></linearGradient>
      </defs>
      <polygon points="10,22 32,30 32,152 10,144" fill="url(#okWoodL)" />
      <polygon points="32,30 78,30 78,152 32,152" fill="url(#okWoodM)" />
      <polygon points="78,30 100,22 100,144 78,152" fill="url(#okWoodR)" />
      <polygon points="10,22 32,14 78,14 100,22 78,30 32,30" fill="#e2b273" stroke="#7a4a1c" strokeWidth="1" />
      <ellipse cx="55" cy="22" rx="6" ry="3" fill="#1a0c04" />
      <rect x="38" y="48" width="34" height="88" fill="#f6efe0" stroke="#7a1010" strokeWidth="1.5" />
      {['御', '神', '籤'].map((c, i) => (
        <text key={c} x="55" y={74 + i * 26} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#8a0a0a" fontFamily={MINCHO}>{c}</text>
      ))}
      <path d="M10 60 L32 66 L78 66 L100 60" fill="none" stroke="#3a2008" strokeWidth="2" opacity="0.5" />
      <path d="M10 118 L32 124 L78 124 L100 118" fill="none" stroke="#3a2008" strokeWidth="2" opacity="0.5" />
    </svg>
  )
}

// みくじ棒
function Stick({ no }) {
  return (
    <div style={{ width:22, height:170, background:'linear-gradient(90deg,#c9a06a,#efd3a0,#c9a06a)', borderRadius:'3px 3px 6px 6px',
      boxShadow:'0 2px 6px #0008', display:'flex', flexDirection:'column', alignItems:'center', paddingTop:30 }}>
      <div style={{ writingMode:'vertical-rl', fontFamily: MINCHO, fontSize:15, fontWeight:'bold', color:'#2a1408', letterSpacing:2 }}>第{no}番</div>
      <div style={{ marginTop:'auto', width:'100%', height:14, background:'#b8121e', borderRadius:'0 0 6px 6px' }} />
    </div>
  )
}

export default function V2capOmikujiFx({ result, onClose }) {
  const [no] = useState(() => kanjiNumberOf(1 + Math.floor(Math.random() * 100)))
  const [phase, setPhase] = useState('turn')    // turn | shake | stick | paper | stamp | final
  const [flash, setFlash] = useState(null)
  const canvasRef = useRef(null)
  const paperRef = useRef(null)
  const fx = useRef(null)
  const resultRef = useRef(result)
  const skipRef = useRef(false)
  useEffect(() => { resultRef.current = result }, [result])

  const f = result ? FORTUNE_BY_NAME[result.fortune] : null
  const style = f ? omikujiStyleOf(f.name) : null

  useEffect(() => {
    fx.current = createParticles(canvasRef.current)
    fx.current.fall(10, { shape: 'leaf', colors: ['#2f8f55', '#3fa866'], speed: [30, 70] })   // 宝樹の葉がゆっくり落ちている
    return () => fx.current?.destroy()
  }, [])

  // 運勢が出たときの光
  const reveal = () => {
    const r = resultRef.current
    if (!r) return
    const st = omikujiStyleOf(r.fortune)
    const p = paperRef.current?.getBoundingClientRect()
    const c = canvasRef.current?.getBoundingClientRect()
    const cx = p && c ? p.left + p.width / 2 - c.left : (c?.width || 0) / 2
    const cy = p && c ? p.top + p.height * 0.42 - c.top : (c?.height || 0) / 2
    if (st.level >= 4) setFlash({ color: st.glow, key: Date.now() })
    if (st.burst) fx.current?.burst(cx, cy, st.level >= 5 ? 140 : st.level * 22, { colors: st.burst, speed: [160, 420 + st.level * 40], g: 120, shapes: ['star', 'dot', 'spark'], life: 1.8 })
    if (st.fall) fx.current?.fall(st.level >= 5 ? 90 : st.level >= 4 ? 50 : st.level * 8, { shape: st.fall.shape, colors: st.fall.colors, size: st.fall.shape === 'petal' ? [5, 9] : [5, 10] })
    if (st.mist) fx.current?.mist(cx, cy, st.level <= -2 ? 26 : 14, { colors: st.mist, spread: 190 })
  }

  // 流れ。結果が届くまでは振り続ける（最低1.4秒）
  useEffect(() => {
    let alive = true
    ;(async () => {
      await sleep(450)
      if (!alive) return
      setPhase('shake')
      const t0 = performance.now()
      while (alive && (!resultRef.current || (!skipRef.current && performance.now() - t0 < 1400))) await sleep(60)
      if (!alive) return
      if (!skipRef.current) { setPhase('stick'); await sleep(1150) }
      if (!alive) return
      if (!skipRef.current) { setPhase('paper'); await sleep(750) }
      if (!alive) return
      setPhase('stamp'); reveal()
      await sleep(skipRef.current ? 200 : 900)
      if (alive) setPhase('final')
    })()
    return () => { alive = false }
  }, [])   // 開いたときに1回だけ流す

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

  const showBox = phase === 'turn' || phase === 'shake' || phase === 'stick'
  const showPaper = phase === 'paper' || phase === 'stamp' || phase === 'final'
  const stamped = phase === 'stamp' || phase === 'final'
  const ink = f ? INK[f.name] || '#a0142c' : '#a0142c'
  const bad = style && style.level < 0
  return (
    <div onClick={phase === 'final' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', fontFamily:'monospace', cursor: phase === 'final' ? 'default' : 'pointer',
        background: bad && stamped
          ? 'radial-gradient(circle at 50% 40%, #1a0f24 0%, #050208 75%)'
          : 'radial-gradient(circle at 50% 38%, #0d3324 0%, #03100c 55%, #010604 100%)',
        transition:'background 0.8s', animation:'okFadeIn 0.3s ease-out', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <style>{KF}</style>
      {/* 光の筋（大吉・中吉） */}
      {stamped && style && style.level >= 4 && (
        <div style={{ position:'absolute', left:'50%', top:'44%', width:'170vmax', height:'170vmax', pointerEvents:'none',
          background:`repeating-conic-gradient(${style.glow}2e 0deg 7deg, transparent 7deg 18deg)`,
          maskImage:'radial-gradient(circle, #000 0%, transparent 55%)', WebkitMaskImage:'radial-gradient(circle, #000 0%, transparent 55%)',
          animation:'okRays 9s linear infinite' }} />
      )}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {flash && <div key={flash.key} style={{ position:'absolute', inset:0, background: flash.color, mixBlendMode:'screen', pointerEvents:'none', animation:'okFlash 0.7s ease-out forwards' }} />}

      <div style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'center', width:'min(360px, 100%)' }}>
        <div style={{ color:'#9fe0b8', fontSize:12, letterSpacing:3, height:20, marginBottom:10, textShadow:'0 0 8px #2f8f55', animation: phase === 'final' ? undefined : 'okGlow 1.2s ease-in-out infinite' }}>
          {phase === 'turn' || phase === 'shake' ? 'ユグレシアの宝樹に問いかけています…' : phase === 'stick' ? `第${no}番` : '🌳 ユグレシアの宝樹'}
        </div>

        {/* 箱と棒 */}
        {showBox && (
          <div style={{ position:'relative', width:200, height:350, animation: phase === 'stick' ? 'okAway 0.45s ease-in 0.7s forwards' : undefined }}>
            {phase === 'stick' && (
              <div style={{ position:'absolute', left:'50%', top:150, zIndex:0, animation:'okStick 0.6s cubic-bezier(.2,1.2,.4,1) forwards' }}>
                <Stick no={no} />
              </div>
            )}
            <div style={{ position:'absolute', left:45, top:20, zIndex:1, transformOrigin:'55px 80px',
              animation: phase === 'turn' ? 'okTurn 0.45s ease-in-out forwards' : phase === 'shake' ? 'okShake 0.22s linear infinite' : undefined,
              transform: phase === 'stick' ? 'rotate(180deg)' : undefined }}>
              <MikujiBox />
            </div>
          </div>
        )}

        {/* おみくじの紙 */}
        {showPaper && f && (
          <div ref={paperRef} style={{ position:'relative', width:210, padding:'14px 14px 48px', transformOrigin:'50% 0%',
            background:'repeating-linear-gradient(0deg, #fbf6e8 0 3px, #f6efdc 3px 6px)', border:'3px double #b8121e',
            boxShadow: stamped && style ? `0 0 ${style.level >= 4 ? 40 : 18}px ${style.glow}${style.level >= 1 ? 'aa' : '66'}, 0 6px 18px #000a` : '0 6px 18px #000a',
            animation: phase === 'paper' ? 'okUnfold 0.7s cubic-bezier(.2,1.1,.4,1) both' : stamped && style.level <= -2 ? 'okTremble 0.16s linear 6' : undefined,
            filter: stamped && style.level < 0 ? 'saturate(0.6) brightness(0.92)' : undefined, transition:'filter 0.6s' }}>
            <div style={{ textAlign:'center', fontFamily: MINCHO, color:'#7a1010', fontSize:12, letterSpacing:2, borderBottom:'1px solid #b8121e55', paddingBottom:6 }}>
              ユグレシアの宝樹　御神籤
            </div>
            <div style={{ textAlign:'center', fontFamily: MINCHO, color:'#5a3a2a', fontSize:11, marginTop:4 }}>第{no}番</div>
            <div style={{ height:150, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {stamped && (
                <div style={{ writingMode:'vertical-rl', fontFamily: MINCHO, fontWeight:900, fontSize: f.name.length >= 2 ? 64 : 76, color: ink, letterSpacing:6,
                  textShadow: style.level >= 4 ? `0 0 12px ${style.glow}, 0 0 2px #fff` : style.level < 0 ? `0 0 10px ${style.glow}88` : 'none',
                  animation:'okStamp 0.55s cubic-bezier(.2,1.3,.4,1) both' }}>
                  {f.name}
                </div>
              )}
            </div>
            <div style={{ minHeight:36, textAlign:'center', fontFamily: MINCHO, color:'#3a2a20', fontSize:12, lineHeight:1.6 }}>
              {stamped && <span style={{ animation:'okUp 0.5s ease-out 0.3s both', display:'inline-block' }}>{f.text}</span>}
            </div>
            {stamped && (
              <div style={{ position:'absolute', right:10, bottom:10, width:34, height:34, border:'2px solid #c8001e', color:'#c8001e', fontFamily: MINCHO,
                fontSize:12, fontWeight:'bold', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1, animation:'okSeal 0.45s ease-out 0.25s both' }}>
                宝樹
              </div>
            )}
          </div>
        )}

        {/* ごほうび */}
        {phase === 'final' && result && (
          <div onClick={e => e.stopPropagation()} style={{ marginTop:14, textAlign:'center', animation:'okUp 0.4s ease-out both' }}>
            <div style={{ color:'#ffcc00', fontSize:22, fontWeight:'bold', textShadow:'0 0 10px #ffb30088' }}>
              EXP +<CountUp value={Number(result.exp) || 0} start={0} ms={900} />
            </div>
            {result.level?.level_ups > 0 && <div style={{ color:'#44ff88', fontSize:13, marginTop:4 }}>🆙 LEVEL UP！ LV{result.level.lv}</div>}
            {result.level?.job_ups > 0 && <div style={{ color:'#ffcc00', fontSize:12, marginTop:2 }}>⭐ CLASS LEVEL UP！</div>}
            <button onClick={onClose} style={{ marginTop:14, minWidth:180, background:'#03201a', border:'1px solid #44dd99', color:'#44dd99', padding:'10px', cursor:'pointer', fontFamily:'monospace', fontSize:13 }}>
              閉じる
            </button>
          </div>
        )}
        {phase !== 'final' && <div style={{ marginTop:12, fontSize:10, color:'#4f7a66' }}>押すと飛ばせます</div>}
      </div>
    </div>
  )
}
