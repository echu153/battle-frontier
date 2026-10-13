// ============================================================
// v2cap 安息の祠 — 演出（最深部・見つけたとき）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「最深部に到達した！　スタミナが全回復した！　って表示される演出が欲しい
//   ※暗転後に泉が見えるような演出がいいかなー」（音はなし＝v2cap の演出の決まり）
//   ・最深部（kind:'deepest'）：暗転 → 闇の中から泉（ユーザーの絵）が少しずつ見えてくる・天井から光が差し、泉から光の粒が昇る
//     → 「最深部に到達した！」 → 泉から光の波が広がり「スタミナが全回復した！」とスタミナのゲージが満ちる → 閉じる
//   ・見つけたとき（kind:'found'）：暗転 → 祠の入口（ユーザーの絵）が見えてくる・入口の奥から青い光の粒
//     → 「安息の祠を見つけた！」＋最深部までの戦闘の数 → 閉じる（こちらで足した。ユーザーが入口の絵も用意していたので）
//   ・押すと飛ばせる（Enter／スペース／Esc も）。最後は「閉じる」（Enter／Esc）
//   ★出撃の画面の上に重ねる（zIndex 1100）。オート出撃は止めない（後ろで続く）
//   ★日本語の大きな文字は字体を名指しする（明朝＝MINCHO・ゴシック＝JP_BOLD）。グラデーションで切り抜かない
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { createParticles } from './fxParticles.js'
import { CountUp } from './casinoParts.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { SHRINE_ART, SPRING_ART, SHRINE_TEXT, SHRINE_DOOR, SPRING_POOL, SPRING_LIGHT, MINCHO } from '../lib/fxStyle.js'

const KF = `
@keyframes shFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes shWord { 0% { opacity: 0; transform: translateY(14px) scale(1.12); filter: blur(10px) } 100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) } }
@keyframes shUp { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes shShaft { 0%,100% { opacity: 0.5 } 50% { opacity: 0.85 } }
@keyframes shWave { from { transform: translate(-50%,-50%) scale(0.15); opacity: 0.85 } to { transform: translate(-50%,-50%) scale(1); opacity: 0 } }
@keyframes shFlash { 0% { opacity: 0.6 } 100% { opacity: 0 } }
@keyframes shPulse { 0%,100% { opacity: 0.45 } 50% { opacity: 1 } }
@keyframes shGrow { from { transform: scaleX(var(--from, 0)) } to { transform: scaleX(1) } }
`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// 流れ（ms）。dark＝暗転・reveal＝絵が見えてくる・title＝見出し・heal＝スタミナ（最深部だけ）・final＝閉じるボタン
const FLOW = {
  deepest: { dark: 1000, reveal: 1700, title: 1500, heal: 1300 },
  found:   { dark: 700,  reveal: 1300, title: 1000 },
}
const REVEAL_MS = { deepest: 2600, found: 2000 }

export default function V2capShrineFx({ kind = 'deepest', total = 0, place = '', stamina = null, onClose }) {
  const deep = kind === 'deepest'
  const art = deep ? SPRING_ART : SHRINE_ART
  const spot = deep ? SPRING_POOL : SHRINE_DOOR
  const [phase, setPhase] = useState('dark')   // dark | reveal | title | heal | final
  const [skipped, setSkipped] = useState(false)
  const [wave, setWave] = useState(null)        // 光の波（{ n, x, y }）
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const fx = useRef(null)
  const skipRef = useRef(false)
  const lit = phase !== 'dark'

  useEffect(() => {
    fx.current = createParticles(canvasRef.current)
    return () => fx.current?.destroy()
  }, [])
  // 絵の中の点（割合）→ キャンバスの座標
  const at = (p) => {
    const r = imgRef.current?.getBoundingClientRect(), c = canvasRef.current?.getBoundingClientRect()
    if (!r || !c) return { x: 0, y: 0, w: 0 }
    return { x: r.left + r.width * p.x - c.left, y: r.top + r.height * p.y - c.top, w: r.width }
  }

  // 光の粒（絵が見えてから最後まで）：泉からは白と水色・入口の奥からは青
  useEffect(() => {
    if (!lit) return undefined
    const t = setInterval(() => {
      const p = at(spot)
      fx.current?.rise(p.x, p.y, deep ? 2 : 1, { colors: deep ? ['#ffffff', '#bff6ff', '#7fe3ff'] : ['#9fd8ff', '#ffffff', '#5fb0ff'], spread: Math.max(60, p.w * (deep ? 0.16 : 0.07)) })
    }, deep ? 120 : 160)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 絵が見えたときに1回だけ始める
  }, [lit])

  // スタミナが戻る瞬間：泉から光の波・白い光・粒がはじける
  const healBurst = () => {
    const p = at(SPRING_POOL)
    setWave(w => ({ n: (w?.n || 0) + 1, x: p.x, y: p.y }))
    fx.current?.burst(p.x, p.y, 70, { colors: ['#ffffff', '#bff6ff', '#7dffb0', '#ffe9a0'], speed: [120, 360], g: 90, shapes: ['dot', 'star', 'spark'], life: 1.7 })
  }

  // 流れ
  useEffect(() => {
    let alive = true
    const f = FLOW[deep ? 'deepest' : 'found']
    const wait = async (ms) => { const t0 = performance.now(); while (alive && !skipRef.current && performance.now() - t0 < ms) await sleep(40) }
    ;(async () => {
      await wait(f.dark); if (!alive) return
      if (skipRef.current) { setPhase('final'); return }
      setPhase('reveal')
      await wait(f.reveal); if (!alive) return
      if (skipRef.current) { setPhase('final'); return }
      setPhase('title')
      await wait(f.title); if (!alive) return
      if (deep) {
        if (skipRef.current) { setPhase('final'); return }
        setPhase('heal'); healBurst()
        await wait(f.heal); if (!alive) return
      }
      setPhase('final')
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ流す
  }, [])

  const skip = () => { if (phase !== 'final') { skipRef.current = true; setSkipped(true) } }
  useEffect(() => {
    const onKey = (e) => {
      if (!['Enter', ' ', 'Escape'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      if (phase === 'final') onClose(); else { skipRef.current = true; setSkipped(true) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, onClose])

  const titled = phase === 'title' || phase === 'heal' || phase === 'final'
  const healed = deep && (phase === 'heal' || phase === 'final')
  const st = stamina || {}
  const max = Math.max(1, Number(st.max) || Number(st.after) || 1)
  const after = Number(st.after) || 0
  const before = Math.min(after, Math.max(0, Number(st.before) || 0))
  const revealMs = skipped ? 300 : REVEAL_MS[deep ? 'deepest' : 'found']
  return (
    <div onClick={phase === 'final' ? undefined : skip}
      style={{ position:'fixed', inset:0, zIndex:1100, overflow:'hidden', background:'#000', fontFamily:'monospace',
        cursor: phase === 'final' ? 'default' : 'pointer', animation:'shFadeIn 0.5s ease-out' }}>
      <style>{KF}</style>
      {/* 絵：闇の中から少しずつ見えてくる（横長の絵を画面いっぱい・縦長の画面では左右を切って真ん中を大きく） */}
      <img ref={imgRef} src={art} alt="" draggable={false}
        style={{ position:'absolute', left:'50%', top: deep ? '50%' : '48%', width:'max(min(100vw, 1400px), calc(60vh * 1672 / 941))', aspectRatio:'1672 / 941',
          transform:`translate(-50%,-50%) scale(${lit ? 1 : 1.08})`, pointerEvents:'none', userSelect:'none',
          filter: lit ? `brightness(${healed ? 1.12 : 1}) saturate(${healed ? 1.15 : 1.02})` : 'brightness(0) saturate(0.5)',
          transition: `filter ${revealMs}ms ease-in, transform ${revealMs + 1200}ms ease-out` }} />
      {/* 天井から差す光（泉の絵の光の筋に重ねる） */}
      {deep && lit && (
        <div style={{ position:'absolute', left:0, right:0, top:0, bottom:0, pointerEvents:'none', mixBlendMode:'screen',
          background:`radial-gradient(ellipse 18% 62% at ${SPRING_LIGHT.x * 100}% 18%, rgba(255,246,210,0.38) 0%, rgba(255,246,210,0.12) 45%, transparent 75%)`,
          animation:`shFadeIn ${revealMs}ms ease-in both, shShaft 3.2s ease-in-out ${revealMs}ms infinite` }} />
      )}
      {/* 入口の奥の青い光 */}
      {!deep && lit && (
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'screen',
          background:`radial-gradient(circle at 50% ${SHRINE_DOOR.y * 100 - 6}%, rgba(110,190,255,0.28) 0%, transparent 32%)`,
          animation:`shFadeIn ${revealMs}ms ease-in both, shShaft 2.6s ease-in-out ${revealMs}ms infinite` }} />
      )}
      {/* 文字の後ろだけ少し暗く（読めるように） */}
      {titled && (
        <div style={{ position:'absolute', left:0, right:0, top:0, height:'46vh', pointerEvents:'none', animation:'shFadeIn 0.6s ease-out both',
          background:'radial-gradient(ellipse 60% 55% at 50% 30%, rgba(0,4,14,0.78) 0%, rgba(0,4,14,0.45) 55%, transparent 85%)' }} />
      )}
      {/* 光の波（スタミナが戻る瞬間） */}
      {wave && (
        <>
          <div key={`w${wave.n}`} style={{ position:'absolute', left: wave.x, top: wave.y, width:'min(130vw, 1300px)', aspectRatio:'1 / 1',
            borderRadius:'50%', pointerEvents:'none', border:'3px solid rgba(190,250,255,0.9)', boxShadow:'0 0 40px rgba(140,240,255,0.8), inset 0 0 40px rgba(140,240,255,0.6)',
            animation:'shWave 1.4s ease-out forwards' }} />
          <div key={`f${wave.n}`} style={{ position:'absolute', inset:0, background:'#c8fbff', mixBlendMode:'screen', pointerEvents:'none', animation:'shFlash 0.8s ease-out forwards' }} />
        </>
      )}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />

      {/* 見出し */}
      <div style={{ position:'absolute', left:0, right:0, top:'11vh', display:'flex', flexDirection:'column', alignItems:'center', padding:'0 16px', textAlign:'center', pointerEvents:'none' }}>
        {titled && (
          <>
            {(deep || place) && (
              <div style={{ color:'#bcd8f0', fontFamily: MINCHO, fontSize:13, letterSpacing:4, marginBottom:6, textShadow:'0 0 6px #000, 0 0 2px #000', animation:'shUp 0.5s ease-out both' }}>
                ─ {deep ? '安息の祠' : place} ─
              </div>
            )}
            <div style={{ fontFamily: MINCHO, fontWeight:'bold', fontSize:'clamp(28px, 7.4vw, 50px)', letterSpacing:4, color:'#f4fdff', lineHeight:1.25,
              textShadow:'0 0 3px #000, 0 0 12px #7fe3ff, 0 0 28px #3fb8ff, 0 2px 0 #000', animation:'shWord 0.9s cubic-bezier(.2,1,.3,1) both' }}>
              {deep ? SHRINE_TEXT.deepest : SHRINE_TEXT.found}
            </div>
            {!deep && total > 0 && (
              <div style={{ marginTop:10, color:'#ffe9a0', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:15, textShadow:'0 0 6px #000, 0 0 2px #000', animation:'shUp 0.5s ease-out 0.4s both' }}>
                最深部まで {total}回の戦闘
              </div>
            )}
          </>
        )}
      </div>

      {/* 下の段：スタミナ（最深部）と「閉じる」。最深部はボタンの場所を先に取っておく（出たときに上の札が動かないように） */}
      {(healed || phase === 'final') && (
        <div style={{ position:'absolute', left:0, right:0, bottom: deep ? '4vh' : '9vh', display:'flex', flexDirection:'column', alignItems:'center', gap:'10px', padding:'0 16px', pointerEvents:'none' }}>
          {healed && (
          <div style={{ minWidth:'min(320px, 100%)', textAlign:'center', background:'rgba(0,10,20,0.78)', border:'1px solid #4fd8ff', padding:'12px 18px',
            boxShadow:'0 0 18px rgba(79,216,255,0.35)', animation:'shUp 0.45s ease-out both' }}>
            <div style={{ color:'#7dffb0', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(20px, 5.4vw, 26px)', letterSpacing:2,
              textShadow:'0 0 3px #000, 0 0 12px #2fdc7f, 0 2px 0 #000' }}>
              {SHRINE_TEXT.healed}
            </div>
            {stamina && (
              <>
                <div style={{ marginTop:8, color:'#ffcc00', fontSize:18, fontWeight:'bold', fontFamily: JP_BOLD }}>
                  ⚡ <CountUp value={after} start={skipped ? after : before} ms={900} /> <span style={{ color:'#9fb8d0', fontSize:13 }}>/ {max}</span>
                </div>
                <div style={{ marginTop:6, height:8, background:'#04121e', border:'1px solid #1f5a7a', overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${Math.min(100, after / max * 100)}%`, background:'linear-gradient(90deg,#1fb86a,#7dffb0)',
                    boxShadow:'0 0 10px #7dffb0', animation: skipped ? 'none' : 'shGrow 0.9s ease-out both', transformOrigin:'0 50%',
                    '--from': after > 0 ? before / after : 0 }} />
                </div>
              </>
            )}
          </div>
          )}
          <button onClick={onClose} disabled={phase !== 'final'}
            style={{ pointerEvents: phase === 'final' ? 'auto' : 'none', visibility: phase === 'final' ? 'visible' : 'hidden', minWidth:180,
              background:'#03182a', border:'1px solid #4fd8ff', color:'#bff3ff', padding:'9px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:13,
              animation: phase === 'final' ? 'shUp 0.4s ease-out both' : 'none' }}>
            閉じる
          </button>
        </div>
      )}
      {phase !== 'final' && (
        <div style={{ position:'absolute', left:0, right:0, bottom:'2vh', textAlign:'center', fontSize:10, color:'#4f7a8a', pointerEvents:'none', animation:'shPulse 2s ease-in-out infinite' }}>
          押すと飛ばせます
        </div>
      )}
    </div>
  )
}
