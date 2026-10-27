// ============================================================
// v2cap 賭博場 — ルーレット（ラッキーナンバー付き）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー選択「ラッキーナンバー付き」。表は src/v2cap/lib/casino.js、抽選はサーバー（v2cap_roulette_spin）
//   ・チップを置いて SPIN → 雷が1〜5個の数字に落ちる（1点賭けは50〜500倍）→ ホイールが回って玉が落ちる
//   ・盤は広い画面では横、狭い画面（スマホ）では縦
//   ・チップは左クリック（タップ）で置く・右クリックで1枚戻す。「1つ戻す」「クリア」「前回と同じ」「×2」
//   【2026-10-27 直した】ユーザー指示「スマホのルーレットも、スクロールなしで回せるように詰めて」：スマホ（620px以下）は
//     ホイールを回すときだけ画面の真ん中に大きく出す（玉が落ちて数字が出たら閉じる・押しても閉じる）。盤の行を低く（30→26px）し、
//     出た数字と賭けの合計は盤の上の1行・チップと SPIN は1行・ほかのボタンはその下の1行にまとめた（前は全部を縦に積んで約940px）
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { WHEEL_ORDER, colorOfNumber, ROULETTE_CHIPS, ROULETTE_MAX_TOTAL, ROULETTE_MAX_BETS, ROULETTE_STRAIGHT, betKeyOf, betLabelOf, rouletteTotalOf, winTierOf } from '../lib/casino.js'
import { winTalkOf, nextMissRun, ROULETTE_MISS_RUN } from '../lib/alea.js'
import { sfx, fx, celebrate, vibrate } from './casinoFx.js'
import { CASINO, panel, bigBtn, pill, fmt } from './casinoStyle.js'
import V2Modal from './V2Modal.jsx'
import { miniBtn } from './v2ui.js'

const HELP_HEAD = { color: CASINO.gold, fontSize:'12px', marginBottom:'2px' }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const N = WHEEL_ORDER.length
const SEG = 360 / N
const COLOR_HEX = { red: '#c8102e', black: '#151515', green: '#0a8a3a' }
const CHIP_COLOR = { 1: '#e0e0e0', 5: '#e53935', 10: '#1e88e5', 50: '#43a047', 100: '#212121' }
const chipColorOf = (a) => CHIP_COLOR[[100, 50, 10, 5, 1].find(v => a >= v) || 1]

// 狭い画面かどうか
const useNarrow = () => {
  const q = '(max-width: 620px)'
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

// ===== ホイール =====
function Wheel({ wheelDeg, ballDeg, ballR, result, lucky, size }) {
  const R = 150
  const pockets = WHEEL_ORDER.map((n, i) => {
    const a0 = (i * SEG - SEG / 2 - 90) * Math.PI / 180, a1 = (i * SEG + SEG / 2 - 90) * Math.PI / 180
    const r0 = 92, r1 = 132
    const d = `M${Math.cos(a0) * r0},${Math.sin(a0) * r0} L${Math.cos(a0) * r1},${Math.sin(a0) * r1} A${r1},${r1} 0 0 1 ${Math.cos(a1) * r1},${Math.sin(a1) * r1} L${Math.cos(a1) * r0},${Math.sin(a1) * r0} A${r0},${r0} 0 0 0 ${Math.cos(a0) * r0},${Math.sin(a0) * r0}Z`
    const lk = lucky.find(x => x.n === n)
    return (
      <g key={n}>
        <path d={d} fill={COLOR_HEX[colorOfNumber(n)]} stroke={lk ? '#ffe14d' : '#c9a24a'} strokeWidth={lk ? 2.5 : 0.8} />
        <text x="0" y={-116} transform={`rotate(${i * SEG})`} textAnchor="middle" fontSize="11" fontWeight="bold" fill={lk ? '#ffe14d' : '#fff'} fontFamily="Arial, sans-serif">{n}</text>
      </g>
    )
  })
  const ba = (ballDeg - 90) * Math.PI / 180
  return (
    <svg width={size} height={size} viewBox="-160 -160 320 320" style={{ display:'block' }}>
      <defs>
        <radialGradient id="cs-wood" cx="0.5" cy="0.5" r="0.5"><stop offset="0.85" stopColor="#5a2d0c" /><stop offset="1" stopColor="#2a1305" /></radialGradient>
        <radialGradient id="cs-hub" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stopColor="#ffe9a8" /><stop offset="0.6" stopColor="#c99a2e" /><stop offset="1" stopColor="#6b4a10" /></radialGradient>
        <radialGradient id="cs-ball" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#9aa3ad" /></radialGradient>
      </defs>
      <circle r={R + 8} fill="url(#cs-wood)" />
      <circle r={R} fill="#1a0d05" stroke="#c9a24a" strokeWidth="2" />
      <g transform={`rotate(${wheelDeg})`}>
        {pockets}
        <circle r="92" fill="#3b1f08" stroke="#c9a24a" strokeWidth="1.5" />
        <circle r="60" fill="url(#cs-hub)" />
        {[0, 90, 180, 270].map(a => <rect key={a} x="-4" y="-80" width="8" height="40" rx="3" fill="url(#cs-hub)" transform={`rotate(${a + 45})`} />)}
        <circle r="10" fill="#fff3c4" />
      </g>
      {/* 玉 */}
      <circle cx={Math.cos(ba) * ballR} cy={Math.sin(ba) * ballR} r="6" fill="url(#cs-ball)" stroke="#555" strokeWidth="0.5" style={{ filter:'drop-shadow(0 0 3px #fff)' }} />
      {result != null && (
        <g>
          <circle r="34" fill={COLOR_HEX[colorOfNumber(result)]} stroke="#ffe14d" strokeWidth="3" style={{ filter:'drop-shadow(0 0 8px #ffe14d)' }} />
          <text y="12" textAnchor="middle" fontSize="34" fontWeight="900" fill="#fff" fontFamily="'Arial Black', Arial, sans-serif">{result}</text>
        </g>
      )}
    </svg>
  )
}

// onTalk … アレアに結果を伝える（V2capCasino・lib/alea.js）。返すのは当たりの演出の上に出すアレア
export default function V2capRoulette({ init, medals, onMoney, onTalk }) {
  const narrow = useNarrow()
  const missRun = useRef(0)   // 続けて外れた回数（ROULETTE_MISS_RUN 回でアレアがなぐさめる）
  const [chip, setChip] = useStored('capRouletteChip', 10)
  const [bets, setBets] = useState([])              // [{k, v, a}]（置いた順の1回ずつ）
  const [lastBets, setLastBets] = useStored('capRouletteLast', [])
  const [hist, setHist] = useState(() => init?.hist || [])
  const [lucky, setLucky] = useState([])
  const [result, setResult] = useState(null)
  const [wins, setWins] = useState(null)            // {key: 払い出し}
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [strike, setStrike] = useState(null)        // 雷が落ちている数字
  const [wheel, setWheel] = useState({ w: 0, b: 0, r: 141 })
  const [wheelOpen, setWheelOpen] = useState(false)   // スマホ：回している間だけホイールを大きく出す
  const [help, setHelp] = useState(false)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // 同じ場所の賭けはまとめて表示
  const stacks = useMemo(() => {
    const m = {}
    for (const b of bets) { const k = betKeyOf(b); m[k] = m[k] ? { ...m[k], a: m[k].a + b.a } : { ...b } }
    return m
  }, [bets])
  const total = rouletteTotalOf(bets)

  const place = (b) => {
    if (busy) return
    setResult(null); setWins(null); setMsg('')
    if (total + chip > ROULETTE_MAX_TOTAL) { setMsg(`1回に賭けられるのは${ROULETTE_MAX_TOTAL}枚までです`); return }
    if (total + chip > medals) { setMsg('メダルが足りません'); return }
    const keys = new Set(bets.map(betKeyOf)); keys.add(betKeyOf(b))
    if (keys.size > ROULETTE_MAX_BETS) { setMsg(`賭けられるのは${ROULETTE_MAX_BETS}か所までです`); return }
    sfx.chip()
    setBets(x => [...x, { ...b, a: chip }])
  }
  const removeOne = (b) => {
    if (busy) return
    const k = betKeyOf(b)
    const i = bets.map(betKeyOf).lastIndexOf(k)
    if (i >= 0) { sfx.chip(); setBets(x => x.filter((_, j) => j !== i)) }
  }
  const undo = () => { if (!busy && bets.length) { sfx.chip(); setBets(x => x.slice(0, -1)) } }
  const clear = () => { if (!busy) { setBets([]); setMsg('') } }
  const rebet = () => {
    if (busy || !lastBets.length) return
    const t = rouletteTotalOf(lastBets)
    if (t > medals) { setMsg('メダルが足りません'); return }
    sfx.chip(); setResult(null); setWins(null); setBets(lastBets)
  }
  const double = () => {
    if (busy || !bets.length) return
    if (total * 2 > ROULETTE_MAX_TOTAL) { setMsg(`1回に賭けられるのは${ROULETTE_MAX_TOTAL}枚までです`); return }
    if (total * 2 > medals) { setMsg('メダルが足りません'); return }
    sfx.chip(); setBets(x => [...x, ...x])
  }

  // ホイールを回す：玉は逆向き。最後に結果のポケットへ落ちる
  const spinWheel = (n, ms) => new Promise(resolve => {
    const idx = WHEEL_ORDER.indexOf(n)
    const w0 = wheel.w, b0 = wheel.b
    const wF = w0 + 360 * 3 + Math.random() * 360
    // 玉の最後の角度＝ホイールの角度＋ポケットの角度（同じ向きの値に直して、逆回りに5周以上）
    const target = ((wF + idx * SEG) % 360 + 360) % 360
    let bF = b0 - 360 * 5
    bF = bF - (((bF - target) % 360) + 360) % 360
    const t0 = performance.now()
    let lastPocket = null
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      const ew = 1 - (1 - t) ** 3
      const eb = 1 - (1 - t) ** 4
      const w = w0 + (wF - w0) * ew
      const b = b0 + (bF - b0) * eb
      // 玉は終わりの4割で内側へ落ちながら跳ねる
      let r = 141
      if (t > 0.6) {
        const u = (t - 0.6) / 0.4
        r = 141 - (141 - 112) * Math.min(1, u * 1.4) + Math.abs(Math.sin(u * 14)) * 9 * (1 - u)
      }
      // ポケットをまたいだら小さく鳴らす
      const rel = Math.floor((((b - w) % 360) + 360) % 360 / SEG)
      if (t > 0.6 && rel !== lastPocket) { if (lastPocket != null) sfx.ballTick(); lastPocket = rel }
      setWheel({ w, b, r })
      if (t < 1) raf.current = requestAnimationFrame(step)
      else { sfx.ballDrop(); resolve() }
    }
    raf.current = requestAnimationFrame(step)
  })

  const spin = async () => {
    if (busy || !bets.length) return
    if (total > medals) { setMsg('メダルが足りません'); return }
    setBusy(true); setMsg(''); setResult(null); setWins(null); setLucky([])
    const sent = bets
    const { data, error } = await supabase.rpc('v2cap_roulette_spin', { p_bets: sent })
    if (error || !data?.ok) { setBusy(false); setMsg(error?.message || data?.error || '回せませんでした'); return }
    setLastBets(sent)
    // 賭けたぶんはすぐ減らして見せる（払い出しは玉が落ちてから）
    onMoney({ medals: Number(data.medals) - Number(data.payout), day_net: Number(data.day_net) - Number(data.payout) })
    // 雷
    const myStraight = new Set(sent.filter(b => b.k === 'n').map(b => b.v))
    const got = []
    for (const l of data.lucky) {
      setStrike(l.n)
      sfx.lightning(); fx('flash', { color: '#fff7c0', ms: 220 })
      if (myStraight.has(l.n)) { vibrate(60); fx('popup', { text: `${l.n} ×${l.m}!!`, color: '#ffe14d', size: 30, ms: 900, top: '30%' }) }
      got.push(l); setLucky([...got])
      await sleep(520)
    }
    setStrike(null)
    sfx.reach()
    if (narrow) setWheelOpen(true)
    await spinWheel(data.result, 5200)
    setResult(data.result)
    const winMap = {}
    sent.forEach((b, i) => { const w = data.wins[i]; if (w > 0) { const k = betKeyOf(b); winMap[k] = (winMap[k] || 0) + w } })
    setWins(winMap)
    setHist(data.hist || [data.result, ...hist].slice(0, 20))
    onMoney(data)
    const pay = Number(data.payout)
    missRun.current = nextMissRun(missRun.current, pay)
    if (pay > 0) {
      const luckyHit = data.lucky.some(l => l.n === data.result) && myStraight.has(data.result)
      const tier = winTierOf(pay, data.total)
      if (tier?.key === 'win' && !luckyHit) { sfx.win(1); fx('coins', { n: 14, from: 'bottom' }); fx('popup', { text: `+${fmt(pay)}枚`, color: CASINO.green, size: 32 }) }
      else celebrate(luckyHit ? (winTierOf(pay, data.total) || tier) : tier, pay, { title: luckyHit ? `⚡ ラッキーナンバー ${data.result} ⚡` : `${data.result}（${{ red:'赤', black:'黒', green:'緑' }[colorOfNumber(data.result)]}）`, sub: `${fmt(data.total)}枚 → ${fmt(pay)}枚`, say: onTalk?.(winTalkOf(tier?.key, { lucky: luckyHit })) })
    } else {
      sfx.lose()
      // 続けて外れた（アレアは1分に1回まで）。言ったら0から数え直す
      if (missRun.current >= ROULETTE_MISS_RUN) { missRun.current = 0; onTalk?.('lose') }
    }
    setBusy(false)
    // スマホ：出た数字を少し見せてからホイールを閉じる（盤の上で、出た数字と当たった賭けが光る）
    if (narrow) setTimeout(() => setWheelOpen(false), 1400)
  }

  // ===== 盤 =====
  const cell = (b, text, style = {}) => {
    const k = betKeyOf(b)
    const st = stacks[k]
    const won = wins?.[k]
    const lk = b.k === 'n' ? lucky.find(x => x.n === b.v) : null
    const isRes = result != null && b.k === 'n' && b.v === result
    return (
      <div key={k} onClick={() => place(b)} onContextMenu={(e) => { e.preventDefault(); removeOne(b) }}
        style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:'center', cursor: busy ? 'default' : 'pointer', userSelect:'none',
          border:'1px solid #d8c27a88', color:'#fff', fontWeight:'bold', fontSize: narrow ? '12px' : '13px', minHeight: narrow ? 26 : 38,
          boxSizing: narrow ? 'border-box' : undefined,   // スマホは枠の線も入れて26px（盤が縦に長いので1行でも低く）
          boxShadow: isRes ? 'inset 0 0 0 3px #ffe14d, 0 0 14px #ffe14d' : lk ? 'inset 0 0 0 2px #ffe14d' : undefined,
          animation: strike === b.v && b.k === 'n' ? 'csBlink 0.12s linear 4' : isRes ? 'csPulse 0.6s ease-in-out infinite' : undefined,
          ...style }}>
        {text}
        {lk && <span style={{ position:'absolute', top:1, right:2, fontSize:'9px', color:'#ffe14d', fontWeight:900, textShadow:'0 0 4px #000' }}>×{lk.m}</span>}
        {st && (
          <span style={{ position:'absolute', bottom:1, left:'50%', transform:'translateX(-50%)', minWidth: narrow ? 17 : 20, height: narrow ? 17 : 20, padding:'0 3px', borderRadius:10,
            background: chipColorOf(st.a), border:'2px dashed #fff', color: chipColorOf(st.a) === CHIP_COLOR[1] ? '#111' : '#fff',
            fontSize:'9px', lineHeight: narrow ? '13px' : '16px', textAlign:'center', boxShadow:'0 2px 3px #000a', boxSizing:'border-box' }}>{st.a}</span>
        )}
        {won > 0 && <span style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', color:'#ffe14d', fontSize:'10px', fontWeight:900, textShadow:'0 0 4px #000, 0 0 6px #ffb300', whiteSpace:'nowrap', zIndex:2 }}>+{fmt(won)}</span>}
      </div>
    )
  }
  const numBg = (n) => ({ background: COLOR_HEX[colorOfNumber(n)] })
  const felt = { background:'#0b5a2e' }
  // 横：0｜12列×3段（上が3の列）｜2to1。下にダズン・2倍の賭け
  // 縦：0｜12行×3列（1,2,3 が1行目）｜下に列（2to1）。左にダズン・右に2倍の賭け
  const board = narrow ? (
    <div style={{ display:'grid', gridTemplateColumns:'34px repeat(3, 1fr) 34px', gap:0, ...felt, padding:'4px', borderRadius:'6px' }}>
      <div style={{ gridColumn:'2 / 5', gridRow:'1' }}>{cell({ k:'n', v:0 }, '0', { ...numBg(0), minHeight:28 })}</div>
      {Array.from({ length: 12 }, (_, row) => [1, 2, 3].map(c => {
        const n = row * 3 + c
        return <div key={n} style={{ gridColumn: 1 + c, gridRow: 2 + row }}>{cell({ k:'n', v:n }, n, numBg(n))}</div>
      }))}
      {[1, 2, 3].map(d => <div key={`d${d}`} style={{ gridColumn:'1', gridRow:`${2 + (d - 1) * 4} / span 4`, display:'flex' }}>{cell({ k:'dozen', v:d }, <span style={{ writingMode:'vertical-rl' }}>{['1st 12', '2nd 12', '3rd 12'][d - 1]}</span>, { ...felt, flex:1, fontSize:'10px' })}</div>)}
      {[['low', '1-18'], ['even', '偶'], ['red', '赤'], ['black', '黒'], ['odd', '奇'], ['high', '19-36']].map(([k, t], j) => (
        <div key={k} style={{ gridColumn:'5', gridRow:`${2 + j * 2} / span 2`, display:'flex' }}>
          {cell({ k }, <span style={{ writingMode: t.length > 1 && /\d/.test(t) ? 'vertical-rl' : undefined }}>{t}</span>, { flex:1, fontSize:'10px', ...(k === 'red' ? { background: COLOR_HEX.red } : k === 'black' ? { background: COLOR_HEX.black } : felt) })}
        </div>
      ))}
      {[1, 2, 3].map(c => <div key={`c${c}`} style={{ gridColumn: 1 + c, gridRow: 14 }}>{cell({ k:'col', v:c }, '2:1', { ...felt, fontSize:'10px' })}</div>)}
    </div>
  ) : (
    <div style={{ display:'grid', gridTemplateColumns:'40px repeat(12, 1fr) 44px', gap:0, ...felt, padding:'4px', borderRadius:'6px' }}>
      <div style={{ gridColumn:'1', gridRow:'1 / span 3', display:'flex' }}>{cell({ k:'n', v:0 }, '0', { ...numBg(0), flex:1 })}</div>
      {[3, 2, 1].map((top, r) => Array.from({ length: 12 }, (_, c) => {
        const n = c * 3 + top
        return <div key={n} style={{ gridColumn: 2 + c, gridRow: 1 + r }}>{cell({ k:'n', v:n }, n, numBg(n))}</div>
      }))}
      {[3, 2, 1].map((col, r) => <div key={`c${col}`} style={{ gridColumn:'14', gridRow: 1 + r, display:'flex' }}>{cell({ k:'col', v:col }, '2:1', { ...felt, flex:1, fontSize:'11px' })}</div>)}
      {[1, 2, 3].map(d => <div key={`d${d}`} style={{ gridColumn:`${2 + (d - 1) * 4} / span 4`, gridRow:'4' }}>{cell({ k:'dozen', v:d }, ['1st 12', '2nd 12', '3rd 12'][d - 1], felt)}</div>)}
      {[['low', '1-18'], ['even', '偶数'], ['red', '赤'], ['black', '黒'], ['odd', '奇数'], ['high', '19-36']].map(([k, t], j) => (
        <div key={k} style={{ gridColumn:`${2 + j * 2} / span 2`, gridRow:'5' }}>
          {cell({ k }, t, k === 'red' ? { background: COLOR_HEX.red } : k === 'black' ? { background: COLOR_HEX.black } : felt)}
        </div>
      ))}
    </div>
  )

  // ===== 出た数字・チップ・ボタン・SPIN・説明（広い画面とスマホで並べ方だけ変える）=====
  // 出た数字（新しい順）
  const histDots = (count, size) => hist.slice(0, count).map((n, k) => (
    <span key={k} style={{ width:size, height:size, borderRadius:'50%', background: COLOR_HEX[colorOfNumber(n)], color:'#fff', fontSize: size >= 20 ? '10px' : '9px', flex:'0 0 auto',
      display:'inline-flex', alignItems:'center', justifyContent:'center', border: k === 0 ? '2px solid #ffe14d' : '1px solid #555', opacity: k === 0 ? 1 : 0.8 }}>{n}</span>
  ))
  const chipBtns = (size) => ROULETTE_CHIPS.map(c => (
    <button key={c} onClick={() => setChip(c)} aria-label={`チップ${c}`}
      style={{ width:size, height:size, flex:'0 0 auto', padding:0, borderRadius:'50%', cursor:'pointer', fontWeight:900, fontSize: size >= 38 ? '12px' : '11px', fontFamily:'monospace',
        background: CHIP_COLOR[c], color: c === 1 ? '#111' : '#fff', border:`3px dashed ${chip === c ? '#ffe14d' : '#ffffffaa'}`,
        boxShadow: chip === c ? '0 0 12px #ffe14d' : '0 2px 4px #000a', transform: chip === c ? 'translateY(-3px)' : 'none', transition:'all 0.15s' }}>{c}</button>
  ))
  const totalText = <span style={{ fontSize:'12px', color:CASINO.body, whiteSpace:'nowrap' }}>合計 <b style={{ color:CASINO.gold }}>{fmt(total)}</b>／{ROULETTE_MAX_TOTAL}枚</span>
  const actionBtns = (
    <>
      <button onClick={undo} disabled={busy || !bets.length} style={pill(CASINO.label, false)}>1つ戻す</button>
      <button onClick={clear} disabled={busy || !bets.length} style={pill(CASINO.label, false)}>クリア</button>
      <button onClick={rebet} disabled={busy || !lastBets.length} style={pill(CASINO.label, false)}>前回と同じ</button>
      <button onClick={double} disabled={busy || !bets.length} style={pill(CASINO.label, false)}>×2</button>
    </>
  )
  const spinBtn = (style) => (
    <button onClick={spin} disabled={busy || !bets.length || total > medals}
      style={{ ...bigBtn(CASINO.gold, !busy && bets.length > 0 && total <= medals), ...style }}>
      {busy ? '…' : `🎡 SPIN（${fmt(total)}枚）`}
    </button>
  )
  const notes = (
    <>
      {msg && <div style={{ color:'#ff6666', fontSize:'12px', marginTop:'6px' }}>⚠ {msg}</div>}
      {Object.keys(stacks).length > 0 && !busy && result == null && (
        <div style={{ fontSize:'10px', color:CASINO.label, marginTop:'6px' }}>
          {Object.values(stacks).map(b => `${betLabelOf(b)}:${b.a}`).join('　')}
        </div>
      )}
    </>
  )
  // 決まりの説明は ❓ HELP に（2026-10-27 ユーザー指示「ここはHELPで」＝前は盤の下に2行で出していた文）。ボタンは合計の横
  const helpBtn = <button type="button" onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>
  const helpModal = help && (
    <V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>
      <div style={HELP_HEAD}>配当</div>
      <div>1点 {ROULETTE_STRAIGHT}倍・赤黒／奇数偶数／1-18・19-36 2倍・ダズン／列 3倍（賭けたぶんこみ）。0 は1点賭けだけ当たる。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>⚡ 雷（ラッキーナンバー）</div>
      <div>毎回1〜5個の数字に雷。そこへの1点賭けは 50〜500倍。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>チップ</div>
      <div>盤を押すとチップを置く。右クリック（スマホは「1つ戻す」）でチップを1枚戻す。</div>
    </V2Modal>
  )

  // スマホ：ホイールは回している間だけ画面の真ん中に大きく出す。上の1行＝出た数字と合計・盤・チップと SPIN の1行・ほかのボタンの1行
  if (narrow) {
    const big = Math.min(300, (typeof window !== 'undefined' ? window.innerWidth : 375) - 40)
    return (
      <div style={panel('#8a6d1f')}>
        {helpModal}
        {wheelOpen && (
          <div role="presentation" onClick={() => { if (!busy) setWheelOpen(false) }}
            style={{ position:'fixed', inset:0, zIndex:380, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(4, 2, 10, 0.62)' }}>
            <Wheel wheelDeg={wheel.w} ballDeg={wheel.b} ballR={wheel.r} result={busy ? null : result} lucky={lucky} size={big} />
          </div>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px' }}>
          <div style={{ display:'flex', gap:'2px', overflow:'hidden', flex:'1 1 auto', minWidth:0 }}>{histDots(10, 17)}</div>
          {totalText}
          {helpBtn}
        </div>
        {board}
        <div style={{ display:'flex', alignItems:'center', gap:'5px', marginTop:'8px' }}>
          {chipBtns(32)}
          {spinBtn({ flex:'1 1 auto', minWidth:0, padding:'9px 6px', fontSize:'13px', letterSpacing:0, whiteSpace:'nowrap' })}
        </div>
        <div style={{ display:'flex', gap:'5px', flexWrap:'wrap', marginTop:'6px' }}>{actionBtns}</div>
        {notes}
      </div>
    )
  }

  const wheelSize = 300
  return (
    <div style={panel('#8a6d1f')}>
      {helpModal}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'12px', alignItems:'flex-start', justifyContent:'center' }}>
        <div style={{ flex:'0 0 auto', position:'relative' }}>
          <Wheel wheelDeg={wheel.w} ballDeg={wheel.b} ballR={wheel.r} result={busy ? null : result} lucky={lucky} size={wheelSize} />
          <div style={{ display:'flex', gap:'3px', flexWrap:'wrap', justifyContent:'center', maxWidth: wheelSize, marginTop:'6px' }}>{histDots(15, 20)}</div>
        </div>
        <div style={{ flex:'1 1 360px', minWidth:0 }}>
          {board}
          {/* チップ */}
          <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap', marginTop:'10px' }}>
            {chipBtns(38)}
            <span style={{ marginLeft:'4px' }}>{totalText}</span>
            <span style={{ marginLeft:'auto' }}>{helpBtn}</span>
          </div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginTop:'8px' }}>{actionBtns}</div>
          {spinBtn({ width:'100%', marginTop:'10px' })}
          {notes}
        </div>
      </div>
    </div>
  )
}
