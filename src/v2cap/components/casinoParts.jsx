// v2cap 賭博場 — 小さな部品（数字のカウントアップ・リールの絵柄・トランプ）
import { useEffect, useRef, useState } from 'react'
import { SUITS, RANK_LABELS, rankOf, suitOf, isRedCard } from '../lib/casino.js'

// 数字を前の値から新しい値へ数え上げる（当たりの気持ちよさの本体）
//   start を渡すと、出たときにその値から数え始める（当たりの表示は0から）
export function CountUp({ value, start, ms = 600, style, prefix = '', suffix = '', onTick }) {
  const [shown, setShown] = useState(start ?? value)
  const from = useRef(start ?? value)
  const raf = useRef(0)
  const tickRef = useRef(onTick)
  useEffect(() => { tickRef.current = onTick }, [onTick])
  useEffect(() => {
    const start = performance.now()
    const a = from.current, b = value
    if (a === b) return undefined
    let lastTick = 0
    const step = (now) => {
      const t = Math.min(1, (now - start) / Math.max(1, ms))
      const e = 1 - (1 - t) ** 3
      const v = Math.round(a + (b - a) * e)
      setShown(v)
      from.current = v
      if (tickRef.current && now - lastTick > 70 && t < 1) { lastTick = now; tickRef.current() }
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, ms])
  return <span style={style}>{prefix}{Math.floor(shown).toLocaleString()}{suffix}</span>
}

// リールの絵柄（グラデーションの定義は SlotDefs を1回だけ置く）
export function SlotDefs() {
  return (
    <svg width="0" height="0" style={{ position:'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="cs-g7" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a9a" /><stop offset="0.45" stopColor="#ff2a2a" /><stop offset="1" stopColor="#8a0000" />
        </linearGradient>
        <linearGradient id="cs-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3a0" /><stop offset="0.5" stopColor="#ffcc00" /><stop offset="1" stopColor="#a06a00" />
        </linearGradient>
        <radialGradient id="cs-cherry" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#ffb3c0" /><stop offset="0.35" stopColor="#ff1f4b" /><stop offset="1" stopColor="#7a0018" />
        </radialGradient>
        <linearGradient id="cs-replay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fb2ff" /><stop offset="1" stopColor="#1a4fd6" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export function SlotSymbol({ sym, size = 56, glow }) {
  const h = Math.round(size * 52 / 60)
  const filter = glow ? `drop-shadow(0 0 6px ${glow}) drop-shadow(0 0 2px ${glow})` : undefined
  return (
    <svg width={size} height={h} viewBox="0 0 60 52" style={{ display:'block', filter }} aria-label={sym}>
      {sym === '7' && (
        <text x="31" y="46" textAnchor="middle" fontSize="50" fontWeight="900" fontFamily="Impact, 'Arial Black', sans-serif"
          fill="url(#cs-g7)" stroke="#fff" strokeWidth="2.2" paintOrder="stroke" transform="skewX(-8)">7</text>
      )}
      {sym === 'BAR' && (
        <g>
          <rect x="5" y="13" width="50" height="26" rx="4" fill="#111" stroke="url(#cs-gold)" strokeWidth="3" />
          <text x="30" y="32" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" fontFamily="Impact, 'Arial Black', sans-serif" letterSpacing="1">BAR</text>
        </g>
      )}
      {sym === 'bell' && (
        <g>
          <circle cx="30" cy="8" r="3.5" fill="url(#cs-gold)" />
          <path d="M30 10c-9.5 0-14 7.5-14 17v7l-5 6h38l-5-6v-7c0-9.5-4.5-17-14-17z" fill="url(#cs-gold)" stroke="#6b4500" strokeWidth="1.5" />
          <circle cx="30" cy="44" r="4" fill="#c98a00" stroke="#6b4500" strokeWidth="1" />
          <path d="M22 22c1-4 3-6 6-7" stroke="#fffbe0" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {sym === 'suika' && (
        <g>
          <path d="M6 16 A24 24 0 0 0 54 16 Z" fill="#ff3355" stroke="#1c9e3a" strokeWidth="5" strokeLinejoin="round" />
          <path d="M9 16 H51" stroke="#e8ffe8" strokeWidth="1.5" />
          {[[20, 24], [30, 28], [40, 24], [25, 33], [35, 33]].map(([x, y], k) => <ellipse key={k} cx={x} cy={y} rx="1.6" ry="2.6" fill="#1a0a0a" />)}
        </g>
      )}
      {sym === 'cherry' && (
        <g>
          <path d="M20 34 C22 22 28 14 36 9 M39 37 C38 26 37 17 36 9" stroke="#2f8f2f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M36 9 C42 4 50 5 53 10 C47 13 41 12 36 9z" fill="#44c444" stroke="#1f6f1f" strokeWidth="1" />
          <circle cx="19" cy="38" r="10" fill="url(#cs-cherry)" />
          <circle cx="39" cy="40" r="10" fill="url(#cs-cherry)" />
        </g>
      )}
      {sym === 'replay' && (
        <g>
          <rect x="3" y="14" width="54" height="24" rx="12" fill="url(#cs-replay)" stroke="#dbe8ff" strokeWidth="1.5" />
          <text x="30" y="31" textAnchor="middle" fontSize="11.5" fontWeight="900" fill="#fff" fontFamily="'Arial Black', sans-serif" letterSpacing="0.5">REPLAY</text>
        </g>
      )}
    </svg>
  )
}

// トランプ（表・裏）。flip を変えると回って表になる
export function PlayingCard({ card, faceDown = false, w = 72, glow, dim }) {
  const h = Math.round(w * 1.4)
  const red = card != null && isRedCard(card)
  const color = red ? '#d4002a' : '#111'
  const face = card == null ? null : { r: RANK_LABELS[rankOf(card)], s: SUITS[suitOf(card)] }
  const side = { position:'absolute', inset:0, borderRadius: Math.round(w / 9), backfaceVisibility:'hidden', WebkitBackfaceVisibility:'hidden' }
  return (
    <div style={{ width:w, height:h, perspective:'600px', flex:'0 0 auto', opacity: dim ? 0.55 : 1 }}>
      <div style={{ position:'relative', width:'100%', height:'100%', transformStyle:'preserve-3d', transition:'transform 0.45s cubic-bezier(.3,1.4,.5,1)', transform: faceDown ? 'rotateY(180deg)' : 'none' }}>
        <div style={{ ...side, background:'linear-gradient(160deg,#ffffff 0%,#f1f1f6 100%)', border:'1px solid #bbb',
          boxShadow: glow ? `0 0 14px ${glow}, 0 0 4px ${glow}` : '0 2px 6px #0008', color, fontFamily:"Georgia, 'Times New Roman', serif" }}>
          {face && (
            <>
              <div style={{ position:'absolute', top:4, left:6, fontSize: w * 0.24, fontWeight:'bold', lineHeight:1 }}>{face.r}<div style={{ fontSize: w * 0.2 }}>{face.s}</div></div>
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize: w * 0.6 }}>{face.s}</div>
              <div style={{ position:'absolute', bottom:4, right:6, fontSize: w * 0.24, fontWeight:'bold', lineHeight:1, transform:'rotate(180deg)' }}>{face.r}<div style={{ fontSize: w * 0.2 }}>{face.s}</div></div>
            </>
          )}
        </div>
        <div style={{ ...side, transform:'rotateY(180deg)', border:'2px solid #e8d48a',
          background:'repeating-linear-gradient(45deg,#5a0f2e 0 6px,#7a1740 6px 12px)', boxShadow:'0 2px 6px #0008' }}>
          <div style={{ position:'absolute', inset: Math.round(w / 10), border:'1px solid #e8d48a88', borderRadius: Math.round(w / 14),
            display:'flex', alignItems:'center', justifyContent:'center', color:'#e8d48a', fontSize: w * 0.3 }}>♛</div>
        </div>
      </div>
    </div>
  )
}
