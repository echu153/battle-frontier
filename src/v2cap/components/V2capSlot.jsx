// ============================================================
// v2cap 賭博場 — スロット（AT機）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー選択「AT機で作り直す」。表と確率は src/v2cap/lib/casino.js、抽選はサーバー（v2cap_slot_spin）
//   ・レバー → 予告（青→緑→赤→金→虹。虹はAT確定だけ）→ 3つ止める → 揃った役・CZ・AT・上乗せの告知
//   ・押し順ベルは2つ止めた時点で押し順が決まる＝そこでサーバーに送り、3つ目で揃う（9枚）かこぼれる（1枚）
//   ・AT中はナビ（①②③）が出る。ナビどおりなら必ず9枚
//   ・CZの最後と成功は「PUSH」ボタンで結果を見る。ATに入ったら「7を狙え」で777を揃えてから始まる
//   ・中段チェリー（1/8192）はフリーズ（画面が止まって暗くなる）→ AT確定
//   ・止まる位置は押した所から近い所を選ぶ（滑りすぎない）。当たり外れはレバーの時点でサーバーが決めている
//   ・キーボード：スペース／Enter＝レバー、← ↓ →（1 2 3）＝止める
// ============================================================
import { useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { SLOT_BET, SLOT_RATES, SLOT_ROLES, SLOT_ORDERS, SLOT_AT_GAMES, SLOT_CZ_GAMES, SLOT_PREMIUM_GAMES, SLOT_TOKU_GAMES, SLOT_MISS_PAY, orderIndexOf, winTierOf } from '../lib/casino.js'
import { REEL_LEN, REELS, displayTable, classOf, winLinesOf, noticeLevelOf, NOTICE_LEVELS, DISPLAY_OF_ROLE } from '../lib/slotReels.js'
import { sfx, fx, celebrate, vibrate } from './casinoFx.js'
import { CASINO, panel, bigBtn, pill, fmt, signed, DISPLAY_FONT, JP_BOLD, RAINBOW_BASE } from './casinoStyle.js'
import { CountUp, SlotDefs, SlotSymbol } from './casinoParts.jsx'

const CELL = 54        // 1コマの高さ
const SYM = 50         // 絵柄の幅
const REEL_W = 74
const SPEED = 21       // 回っている速さ（コマ/秒）
const mod = (n) => ((n % REEL_LEN) + REEL_LEN) % REEL_LEN
const RARE_LABEL = {
  wcherry: ['弱チェリー', '#ff88aa'], scherry: ['強チェリー', '#ff3366'], suika: ['スイカ', '#44dd66'],
  chance: ['チャンス目', '#ffaa33'], premium: ['中段チェリー', 'rainbow'],
}
const THEME = {
  normal: { color: CASINO.gold, name: 'NORMAL' },
  cz:     { color: CASINO.cyan, name: 'CHANCE ZONE' },
  at:     { color: CASINO.pink, name: 'ASSIST TIME' },
  toku:   { color: '#ffd700',   name: '上乗せ特化ゾーン' },
}
const listOf = (d) => { const t = displayTable(); return d === 'bell' ? t.bellTenpai : (t.buckets[d] || t.buckets.miss) }
// p（今の位置・下へ減っていく）から少なくとも0.6コマ動いて q に止まる位置
const finalOf = (p, q) => { const base = Math.floor(p - 0.6); return base - mod(base - q) }
const svOf = (s) => ({ mode: s?.mode || 'normal', rate: s?.rate || 1, cz: s?.cz || 0, at: s?.at || 0, toku: s?.toku || 0, atNet: Number(s?.at_net) || 0, atGames: 0 })

export default function V2capSlot({ init, medals, onMoney, active = true }) {
  const [rateSel, setRateSel] = useStored('capSlotRate', 1)
  const [help, setHelp] = useStored('capSlotHelp', false)
  const [sv, setSv] = useState(() => svOf(init))
  const [phase, setPhaseState] = useState('idle')   // idle | wait | spin | freeze | push | reveal | intro
  const [stopped, setStopped] = useState([false, false, false])
  const [nav, setNav] = useState(null)               // AT中の押し順 [左中右の番号…]
  const [notice, setNotice] = useState(0)
  const [label, setLabel] = useState(null)
  const [lines, setLines] = useState([])
  const [win, setWin] = useState(0)
  const [msg, setMsg] = useState('')
  const [push, setPush] = useState(null)             // {success, from, games}
  const [intro, setIntro] = useState(null)           // {games, from}
  const [dark, setDark] = useState(false)
  const [log, setLog] = useState([])
  const [, redraw] = useReducer(x => x + 1, 0)

  const phaseRef = useRef('idle')
  const setPhase = (p) => { phaseRef.current = p; setPhaseState(p) }
  const pos = useRef([2, 9, 16])
  const spin = useRef([false, false, false])
  const slow = useRef(false)
  const anim = useRef([null, null, null])
  const raf = useRef(0)
  const fixed = useRef([null, null, null])
  const press = useRef([])
  const res = useRef(null)
  const display = useRef('miss')
  const bell = useRef(null)
  const bellRes = useRef(null)
  const landed = useRef(0)
  const handlers = useRef({})
  const pushSv = useRef(null)    // PUSH を押したら見せる状態
  const svRef = useRef(sv)
  useEffect(() => { svRef.current = sv }, [sv])

  const rate = sv.mode === 'normal' ? rateSel : sv.rate
  const bet = SLOT_BET * rate
  const inToku = sv.mode === 'at' && sv.toku > 0
  const theme = THEME[inToku ? 'toku' : sv.mode] || THEME.normal

  const addLog = (text, color = CASINO.body) => setLog(l => [{ text, color, key: Date.now() + Math.random() }, ...l].slice(0, 8))

  // ===== リールを動かす =====
  const ensureLoop = () => {
    if (raf.current) return
    let last = performance.now()
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      let active = false
      for (let i = 0; i < 3; i++) {
        const a = anim.current[i]
        if (a) {
          const t = Math.min(1, (now - a.t0) / a.dur)
          const c1 = 1.3, c3 = c1 + 1
          const e = 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2   // 少し行き過ぎて戻る
          pos.current[i] = a.from + (a.to - a.from) * e
          if (t >= 1) { pos.current[i] = a.to; anim.current[i] = null; onLanded(i) } else active = true
        } else if (spin.current[i]) {
          pos.current[i] -= SPEED * dt * (slow.current ? 0.18 : 1)
          active = true
        }
      }
      redraw()
      raf.current = active ? requestAnimationFrame(step) : 0
    }
    raf.current = requestAnimationFrame(step)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const startSpin = () => { spin.current = [true, true, true]; anim.current = [null, null, null]; ensureLoop() }
  const stopAllNow = () => {
    spin.current = [false, false, false]; anim.current = [null, null, null]
    pos.current = pos.current.map(p => Math.round(p)); redraw()
  }

  // リール i を、見え方 d に合う一番近い位置で止める
  const landTarget = (i, d) => {
    const p = pos.current[i]
    let options
    if (d === 'bellmiss') {
      options = []
      for (let q = 0; q < REEL_LEN; q++) {
        const t = fixed.current.map((f, k) => (k === i ? q : f))
        if (classOf(t) === 'miss') options.push(q)
      }
    } else {
      const cons = listOf(d).filter(t => t.every((v, k) => k === i || fixed.current[k] == null || fixed.current[k] === v))
      options = [...new Set(cons.map(t => t[i]))]
    }
    if (!options.length) options = [mod(Math.floor(p))]
    let best = null, bestD = Infinity
    for (const q of options) {
      const F = finalOf(p, q)
      const dd = p - F
      if (dd < bestD) { best = F; bestD = dd }
    }
    fixed.current[i] = mod(best)
    spin.current[i] = false
    anim.current[i] = { from: p, to: best, t0: performance.now(), dur: 130 + bestD * 24 }
    ensureLoop()
  }

  // ===== レバー =====
  const resetView = () => {
    setLabel(null); setLines([]); setWin(0); setNotice(0); setNav(null); setMsg('')
    setStopped([false, false, false]); fixed.current = [null, null, null]; press.current = []
    bell.current = null; bellRes.current = null; landed.current = 0
  }
  const lever = async () => {
    const ph = phaseRef.current
    if (ph === 'push') return doPush()
    if (ph === 'intro') return startIntro()
    if (ph !== 'idle') return
    const s = svRef.current
    const r8 = s.mode === 'normal' ? rateSel : s.rate
    if (medals < SLOT_BET * r8) { setMsg('メダルが足りません（両替所で替えられます）'); return }
    resetView()
    res.current = null
    sfx.lever(); startSpin(); setPhase('wait')
    const t0 = performance.now()
    const { data, error } = await supabase.rpc('v2cap_slot_spin', { p_rate: r8 })
    if (error || !data?.ok) {
      stopAllNow(); setPhase('idle'); setMsg(error?.message || data?.error || '回せませんでした')
      return
    }
    res.current = data
    // 賭けたぶんだけ先に減らして見せる（払い出しは止まってから。先に足すと当たりがわかってしまう）
    onMoney({ medals: Number(data.medals) - Number(data.payout), day_net: Number(data.day_net) - Number(data.payout) })
    if (data.role === 'premium') { runFreeze(); return }
    display.current = DISPLAY_OF_ROLE[data.role] || 'miss'
    if (data.nav != null) setNav(SLOT_ORDERS[data.nav])
    const lv = noticeLevelOf(data)
    setTimeout(() => {
      if (lv > 0) {
        setNotice(lv); sfx.notice(lv)
        if (lv >= 3) { fx('flash', { color: lv === 5 ? '#ffffff' : NOTICE_LEVELS[lv].color, ms: 300 }); vibrate(40) }
        if (lv === 5) fx('rays', { color: '#ffffff', ms: 1500 })
      }
      setPhase('spin')
    }, Math.max(0, 160 - (performance.now() - t0)))
  }

  // ===== 止める =====
  const stopReel = (i) => {
    if (phaseRef.current !== 'spin' || press.current.includes(i)) return
    press.current.push(i)
    setStopped(s => { const n = [...s]; n[i] = true; return n })
    const r = res.current
    if (r?.pending && press.current.length === 2) {
      // 押し順が決まった＝ここでサーバーに送る（3つ目を押すまでに返ってくる）
      const rest = [0, 1, 2].find(k => !press.current.includes(k))
      const order = orderIndexOf([...press.current, rest])
      bell.current = supabase.rpc('v2cap_slot_stop', { p_order: order })
        .then(({ data, error }) => (error || !data?.ok ? { ok: false, error: error?.message || data?.error } : data))
    }
    if (r?.pending && press.current.length === 3) {
      // 3つ目は結果を待ってから止める（それまで回ったまま）
      bell.current.then(b => { bellRes.current = b; landTarget(i, b?.ok && b.hit ? 'bell' : 'bellmiss') })
      return
    }
    landTarget(i, display.current)
  }
  const stopAll = () => {
    if (phaseRef.current !== 'spin') return
    const seq = (nav || [0, 1, 2]).filter(k => !press.current.includes(k))
    seq.forEach((k, n) => setTimeout(() => stopReel(k), n * 120))
  }

  const onLanded = (i) => {
    sfx.reelStop(i)
    landed.current += 1
    if (landed.current >= 3) setTimeout(finish, 60)
  }

  // ===== 中段チェリー：フリーズ =====
  const runFreeze = () => {
    setPhase('freeze'); stopAllNow()
    setDark(true); sfx.freeze(); vibrate([200, 100, 200])
    setTimeout(() => {
      setDark(false)
      fx('popup', { text: 'PREMIUM', color: 'rainbow', size: 48, ms: 1800 })
      fx('rays', { color: '#ffffff', ms: 2500 })
      slow.current = true; startSpin()
    }, 1900)
    setTimeout(() => {
      display.current = 'premium'
      ;[0, 1, 2].forEach((k, n) => setTimeout(() => {
        press.current.push(k); setStopped(s => { const x = [...s]; x[k] = true; return x })
        landTarget(k, 'premium')
      }, n * 650))
    }, 3300)
  }

  // ===== ATの告知・7を狙え =====
  const announceAt = (from) => {
    fx('popup', { text: 'AT確定!!', color: 'rainbow', size: 52, ms: 2200, sub: from === 'premium' ? `中段チェリー・${SLOT_PREMIUM_GAMES}G` : undefined })
    sfx.fanfare('at'); fx('rays', { color: CASINO.pink, ms: 3000 }); fx('confetti', { n: 140 }); fx('flash', { color: '#ffffff', ms: 500 })
    fx('shake', { ms: 500, power: 6 }); vibrate([80, 50, 80, 50, 200])
  }
  const startIntro = () => {
    resetView()
    res.current = { intro: true }
    display.current = 'seven'
    sfx.lever(); startSpin(); setPhase('spin')
    setNotice(5)
  }
  const doPush = () => {
    const p = push
    if (!p) return
    setPush(null); setPhase('reveal')
    sfx.push(); fx('shake', { ms: 300, power: 5 }); setDark(true)
    setTimeout(() => {
      setDark(false)
      if (pushSv.current) { setSv(pushSv.current); pushSv.current = null }
      if (p.success) {
        announceAt(p.from); addLog(`CZ成功 → AT ${p.games}G`, CASINO.pink)
        setIntro({ games: p.games, from: p.from }); setPhase('intro')
      } else {
        fx('popup', { text: '残念…', color: '#8899bb', size: 32 }); sfx.lose(); addLog('CZ失敗', CASINO.dim)
        setPhase('idle')
      }
    }, 750)
  }

  // ===== 3つ止まったあと =====
  const finish = () => {
    const r = res.current
    if (!r) return
    slow.current = false
    setLines(winLinesOf(fixed.current))
    if (r.intro) {
      const g = intro?.games ?? svRef.current.at
      setIntro(null)
      fx('popup', { text: 'AT START!!', color: CASINO.pink, size: 50, ms: 2000, sub: `${g}G` })
      sfx.win(3); fx('coins', { n: 70, from: 'bottom' }); fx('confetti', { n: 100 }); fx('rays', { color: CASINO.pink, ms: 2200 })
      fx('shake', { ms: 450, power: 5 }); vibrate([60, 40, 160])
      setNotice(0); setPhase('idle')
      return
    }
    const b = bellRes.current
    const pay = (Number(r.payout) || 0) + (b?.ok ? Number(b.payout) : 0)
    if (b && !b.ok) setMsg(b.error || '押し順ベルの精算に失敗しました')
    onMoney(b?.ok ? b : r)
    setWin(pay)
    const rl = RARE_LABEL[r.role]
    if (rl) setLabel({ text: rl[0], color: rl[1] })
    if (r.role === 'obell' || r.role === 'cbell') {
      if (pay >= 9 * r.rate) { sfx.small(); fx('coins', { n: 5, from: 'bottom' }) } else { sfx.lose() }
    } else if (pay > 0) sfx.coin(r.role === 'suika' ? 6 : 2)
    const atNet = b?.ok ? Number(b.at_net) : Number(r.at_net)
    const s0 = svRef.current
    const atGames = r.mode_before === 'at' ? s0.atGames + 1 : 0
    const nextSv = { mode: r.mode, rate: r.rate, cz: r.cz, at: r.at, toku: r.toku, atNet, atGames }
    // ★CZの結果は PUSH を押すまで見せない（上の表示はCZのまま・残り0G）
    if (r.mode_before === 'cz' && (r.at_in || r.cz_end) && r.role !== 'premium') {
      pushSv.current = nextSv
      setSv({ ...s0, mode: 'cz', cz: 0 })
    } else setSv(nextSv)
    setNotice(0)

    // 中段チェリーでAT
    if (r.role === 'premium' && r.at_in) {
      announceAt('premium'); addLog(`中段チェリー → AT ${r.at}G`, '#ffffff')
      setIntro({ games: r.at, from: 'premium' }); setPhase('intro'); return
    }
    if (r.cz_in) {
      fx('popup', { text: 'CHANCE ZONE!!', color: CASINO.cyan, size: 40, ms: 1800, sub: `${SLOT_CZ_GAMES}G` })
      sfx.fanfare('cz'); fx('flash', { color: CASINO.cyan, ms: 400 }); fx('rays', { color: CASINO.cyan, ms: 1800 }); vibrate([60, 40, 60])
      addLog(`${rl ? rl[0] : '？'} → CZ突入`, CASINO.cyan)
    }
    if (r.mode_before === 'cz' && (r.at_in || r.cz_end)) {
      setPush({ success: !!r.at_in, from: r.at_from, games: r.at })
      sfx.reach(); setPhase('push'); return
    }
    if (r.at_in) {
      announceAt(r.at_from); addLog(`${rl ? rl[0] : 'レア役'} → AT直撃 ${r.at}G`, CASINO.pink)
      setIntro({ games: r.at, from: r.at_from }); setPhase('intro'); return
    }
    if (r.mode_before === 'at') {
      if (r.toku_add > 0) {
        fx('popup', { text: `+${r.toku_add}G!!`, color: '#ffd700', size: 36 + Math.min(24, r.toku_add / 4), ms: 1300, top: '35%' })
        sfx.uwanose(r.toku_add >= 50); fx('coins', { n: 8 + r.toku_add / 4, from: 'bottom' })
        if (r.toku_add >= 50) { fx('shake', { ms: 400, power: 6 }); fx('flash', { color: '#ffd700', ms: 400 }); vibrate([60, 40, 60]) }
      }
      if (r.add > 0) {
        setTimeout(() => {
          fx('popup', { text: `+${r.add}G 上乗せ!`, color: CASINO.gold, size: 34 + Math.min(20, r.add / 5), ms: 1400, top: '48%' })
          sfx.uwanose(r.add >= 30); fx('flash', { color: CASINO.gold, ms: 300 }); vibrate(50)
        }, r.toku_add > 0 ? 500 : 0)
        addLog(`${rl ? rl[0] : '上乗せ'} → +${r.add}G`, CASINO.gold)
      }
      if (r.toku_in) {
        setTimeout(() => {
          fx('popup', { text: '上乗せ特化ゾーン突入!!', color: '#ffd700', size: 30, ms: 2000, sub: `${SLOT_TOKU_GAMES}G 毎G上乗せ` })
          sfx.fanfare('toku'); fx('rays', { color: '#ffd700', ms: 2200 }); fx('confetti', { n: 60 }); vibrate([80, 40, 80])
        }, 600)
        addLog('上乗せ特化ゾーン突入', '#ffd700')
      }
      if (r.at_end) {
        const tier = winTierOf(atNet, SLOT_BET * r.rate)
        setTimeout(() => {
          if (tier && atNet > 0) celebrate(tier, atNet, { title: 'AT終了', sub: `${atGames}G・純増 ${fmt(atNet)}枚` })
          else { fx('popup', { text: 'AT終了', color: CASINO.pink, size: 32, sub: `純増 ${signed(atNet)}枚` }); sfx.small() }
        }, 400)
        addLog(`AT終了 ${atGames}G 純増 ${signed(atNet)}枚`, CASINO.pink)
      }
    }
    setPhase('idle')
  }

  // 開いたときに押し順ベルが止まっていなければ、ATのナビどおり（ほかは左から）で止めておく
  useEffect(() => {
    if (!init?.pending) return
    supabase.rpc('v2cap_slot_stop', { p_order: init.nav ?? 0 }).then(({ data }) => {
      if (data?.ok) { onMoney(data); setSv(s => ({ ...s, atNet: Number(data.at_net) || 0 })) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, [])

  // キーボード
  useEffect(() => { handlers.current = { lever, stop: stopReel, active } })
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.repeat) return
      const h = handlers.current
      if (!h.active) return   // ほかのタブを見ているときは効かない
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); h.lever?.() }
      else if (e.code === 'ArrowLeft' || e.key === '1') { e.preventDefault(); h.stop?.(0) }
      else if (e.code === 'ArrowDown' || e.key === '2') { e.preventDefault(); h.stop?.(1) }
      else if (e.code === 'ArrowRight' || e.key === '3') { e.preventDefault(); h.stop?.(2) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ===== 見た目 =====
  const navNo = (i) => (nav ? nav.indexOf(i) + 1 : 0)
  const nextNav = nav ? nav.find(k => !stopped[k]) : null
  const lit = new Set(lines.flatMap(l => l.line.map((row, reel) => `${reel}:${row}`)))
  const nt = notice ? NOTICE_LEVELS[notice] : null
  const ntColor = nt ? (nt.color === 'rainbow' ? RAINBOW_BASE : nt.color) : null
  const leverLabel = phase === 'push' ? 'PUSH!!' : phase === 'intro' ? '7を狙え！' : `レバー（${fmt(bet)}枚）`
  const leverOn = phase === 'push' || phase === 'intro' || (phase === 'idle' && medals >= bet)
  const leverColor = phase === 'push' ? CASINO.red : phase === 'intro' ? '#ffffff' : theme.color

  return (
    <div style={panel(theme.color + '88')}>
      <SlotDefs />
      {/* ===== 上：状態 ===== */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'8px' }}>
        <div style={{ fontFamily: DISPLAY_FONT, fontWeight:'bold', letterSpacing:'2px', fontSize:'15px',
          color: theme.color, textShadow:`0 0 8px ${theme.color}` , animation: sv.mode !== 'normal' ? 'csPulse 1.2s ease-in-out infinite' : undefined }}>
          {theme.name}
        </div>
        <div style={{ display:'flex', gap:'12px', fontSize:'12px', color:CASINO.body, flexWrap:'wrap', alignItems:'baseline' }}>
          {sv.mode === 'cz' && <span>残り <b style={{ color: CASINO.cyan, fontSize:'16px' }}>{sv.cz}</b>G</span>}
          {sv.mode === 'at' && (
            <>
              <span>残り <b style={{ color: CASINO.pink, fontSize:'18px' }}><CountUp value={sv.at} ms={500} /></b>G</span>
              {sv.toku > 0 && <span style={{ color:'#ffd700' }}>特化 残り{sv.toku}G</span>}
              <span>純増 <b style={{ color: sv.atNet >= 0 ? CASINO.green : CASINO.red }}><CountUp value={sv.atNet} ms={500} /></b>枚</span>
            </>
          )}
        </div>
      </div>

      {/* ===== リール ===== */}
      <div style={{ position:'relative', margin:'0 auto', width:'fit-content', padding:'10px 10px 8px', borderRadius:'10px',
        background:'linear-gradient(180deg,#2a1a4a,#120a28)', border:`2px solid ${theme.color}`,
        boxShadow:`0 0 18px ${theme.color}55, inset 0 0 20px #000` }}>
        <div style={{ display:'flex', gap:'6px' }}>
          {[0, 1, 2].map(i => {
            const p = pos.current[i]
            const base = Math.floor(p)
            const items = []
            for (let k = base - 1; k <= base + 3; k++) {
              const row = k - base - (p - base)   // 画面上の段（0上〜2下・小数）
              const idx = mod(k)
              const r = Math.round(k - p)
              const glow = !spin.current[i] && !anim.current[i] && r >= 0 && r <= 2 && lit.has(`${i}:${r}`)
              items.push(
                <div key={k} style={{ position:'absolute', left:(REEL_W - SYM) / 2, top: row * CELL + (CELL - SYM * 52 / 60) / 2 }}>
                  <SlotSymbol sym={REELS[i][idx]} size={SYM} glow={glow ? '#fff6a0' : undefined} />
                </div>,
              )
            }
            const moving = spin.current[i] || anim.current[i]
            return (
              <div key={i} style={{ position:'relative', width:REEL_W, height:CELL * 3, overflow:'hidden', borderRadius:'6px',
                background:'linear-gradient(180deg,#bfbfc8 0%,#ffffff 22%,#ffffff 78%,#bfbfc8 100%)',
                boxShadow: navNo(i) && nextNav === i && phase === 'spin' ? `0 0 0 3px ${CASINO.pink}, 0 0 14px ${CASINO.pink}` : 'inset 0 0 8px #0006' }}>
                <div style={{ position:'absolute', inset:0, filter: moving && spin.current[i] && !slow.current ? 'blur(1.2px)' : undefined }}>{items}</div>
                {/* 中段の線 */}
                <div style={{ position:'absolute', left:0, right:0, top:CELL, height:CELL, borderTop:'1px solid #0002', borderBottom:'1px solid #0002', pointerEvents:'none' }} />
                {navNo(i) > 0 && phase === 'spin' && !stopped[i] && (
                  <div style={{ position:'absolute', top:4, left:4, width:22, height:22, borderRadius:'50%', background:CASINO.pink, color:'#fff',
                    fontWeight:900, fontSize:'13px', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 8px #ff4fa3',
                    animation: nextNav === i ? 'csBlink 0.5s linear infinite' : undefined }}>{navNo(i)}</div>
                )}
              </div>
            )
          })}
        </div>
        {/* 揃ったライン */}
        {lines.length > 0 && (
          <svg width="100%" height="100%" viewBox={`0 0 ${REEL_W * 3 + 12} ${CELL * 3}`} preserveAspectRatio="none"
            style={{ position:'absolute', left:10, top:10, width: REEL_W * 3 + 12, height: CELL * 3, pointerEvents:'none' }}>
            {lines.map((l, k) => (
              <polyline key={k} points={l.line.map((row, reel) => `${reel * (REEL_W + 6) + REEL_W / 2},${row * CELL + CELL / 2}`).join(' ')}
                fill="none" stroke="#ff2a6a" strokeWidth="4" strokeLinecap="round" opacity="0.75" style={{ filter:'drop-shadow(0 0 4px #ff2a6a)', animation:'csBlink 0.6s linear infinite' }} />
            ))}
          </svg>
        )}
        {/* 予告 */}
        {nt && (
          <div style={{ position:'absolute', left:0, right:0, top:'38%', textAlign:'center', pointerEvents:'none' }}>
            <span style={{ display:'inline-block', padding:'4px 12px', borderRadius:'6px', fontWeight:'bold', fontSize: 14 + notice * 3, letterSpacing:'2px',
              fontFamily: DISPLAY_FONT, background:'#000c',
              border:`2px solid ${ntColor}`,
              boxShadow:`0 0 ${6 + notice * 4}px ${ntColor}`,
              animation: nt.color === 'rainbow' ? 'csPulse 0.5s ease-in-out infinite, csHue 1.2s linear infinite' : 'csPulse 0.5s ease-in-out infinite' }}>
              <span style={{ color: ntColor, textShadow:`0 0 6px ${ntColor}` }}>
                {phase === 'spin' && res.current?.intro ? '7を狙え!!' : nt.text}
              </span>
            </span>
          </div>
        )}
        {/* 暗転（フリーズ・PUSHの結果待ち） */}
        {dark && <div style={{ position:'absolute', inset:0, background:'#000', borderRadius:'10px', opacity:0.92, transition:'opacity 0.3s' }} />}
        {/* 小役の名前・払い出し */}
        <div style={{ height:'22px', marginTop:'6px', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'12px' }}>
          <span style={label ? (label.color === 'rainbow'
            ? { display:'inline-block', color: RAINBOW_BASE, fontFamily: JP_BOLD, fontWeight:'bold', textShadow:`0 0 6px ${RAINBOW_BASE}`, animation:'csHue 1.2s linear infinite' }
            : { color: label.color, fontFamily: JP_BOLD, fontWeight:'bold', textShadow:`0 0 6px ${label.color}` }) : undefined}>{label?.text || ''}</span>
          <span style={{ color: win > 0 ? CASINO.gold : CASINO.dim, fontWeight:'bold' }}>{win > 0 ? `+${fmt(win)}枚` : ''}</span>
        </div>
      </div>

      {/* ===== 止める・レバー ===== */}
      <div style={{ display:'flex', gap:'6px', justifyContent:'center', marginTop:'8px' }}>
        {[0, 1, 2].map(i => {
          const on = phase === 'spin' && !stopped[i]
          const isNext = nextNav === i
          return (
            <button key={i} onClick={() => stopReel(i)} disabled={!on}
              style={{ width: REEL_W, padding:'10px 0', borderRadius:'50px', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'13px',
                cursor: on ? 'pointer' : 'default', touchAction:'manipulation',
                color: on ? '#fff' : '#555', border:`2px solid ${on ? (isNext ? CASINO.pink : '#ff4466') : '#333'}`,
                background: on ? (isNext ? 'radial-gradient(circle,#ff7ac0,#c2185b)' : 'radial-gradient(circle,#ff6680,#a8002a)') : '#1a1a1a',
                boxShadow: on ? `0 0 10px ${isNext ? CASINO.pink : '#ff4466'}88` : 'none' }}>
              {navNo(i) ? `${'①②③'[navNo(i) - 1]} ` : ''}{['左', '中', '右'][i]}
            </button>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:'6px', justifyContent:'center', marginTop:'8px', flexWrap:'wrap' }}>
        <button onClick={lever} disabled={!leverOn}
          style={{ ...bigBtn(leverColor, leverOn), minWidth:'200px', animation: phase === 'push' || phase === 'intro' ? 'csPulse 0.6s ease-in-out infinite' : undefined }}>
          {leverLabel}
        </button>
        <button onClick={stopAll} disabled={phase !== 'spin'} style={{ ...pill(CASINO.label, false), opacity: phase === 'spin' ? 1 : 0.4 }}>まとめて止める</button>
      </div>

      {/* ===== レート ===== */}
      <div style={{ display:'flex', gap:'6px', alignItems:'center', justifyContent:'center', marginTop:'10px', flexWrap:'wrap', fontSize:'11px', color:CASINO.label }}>
        {sv.mode === 'normal' ? (
          <>
            <span>レート</span>
            {SLOT_RATES.map(r => (
              <button key={r} onClick={() => phase === 'idle' && setRateSel(r)} disabled={phase !== 'idle'} style={pill(CASINO.gold, rateSel === r)}>
                ×{r}（{SLOT_BET * r}枚）
              </button>
            ))}
          </>
        ) : (
          <span>レート ×{sv.rate}（{sv.mode === 'cz' ? 'CZ' : 'AT'}の間は固定・1G {fmt(bet)}枚）</span>
        )}
      </div>
      {msg && <div style={{ color:'#ff6666', fontSize:'12px', textAlign:'center', marginTop:'6px' }}>⚠ {msg}</div>}

      {/* ===== 出来事 ===== */}
      {log.length > 0 && (
        <div style={{ marginTop:'10px', fontSize:'11px', lineHeight:1.7 }}>
          {log.map(l => <div key={l.key} style={{ color: l.color }}>・{l.text}</div>)}
        </div>
      )}

      {/* ===== 遊び方 ===== */}
      <div style={{ marginTop:'10px' }}>
        <button onClick={() => setHelp(v => !v)} style={pill(CASINO.label, false)}>{help ? '▲ 遊び方を閉じる' : '▼ 遊び方'}</button>
        {help && (
          <div style={{ marginTop:'8px', fontSize:'11px', color:CASINO.body, lineHeight:1.8 }}>
            <div>1ゲーム 3枚 × レート。払い出し（×1のとき）：</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:'2px 10px', margin:'4px 0 6px' }}>
              {SLOT_ROLES.filter(r => r.key !== 'miss').map(r => (
                <div key={r.key}>{r.name}：{r.key === 'obell' ? `${r.pay}枚（押し順を外すと${SLOT_MISS_PAY}枚）` : r.key === 'replay' ? `${r.pay}枚（もう1回）` : `${r.pay}枚`}</div>
              ))}
            </div>
            <div>・レア役（チェリー・スイカ・チャンス目）で <b style={{ color:CASINO.cyan }}>CZ（{SLOT_CZ_GAMES}G）</b> か <b style={{ color:CASINO.pink }}>AT</b> に入る</div>
            <div>・<b style={{ color:CASINO.pink }}>AT（{SLOT_AT_GAMES}G〜）</b>はナビ（①②③）どおりに止めると押し順ベルが全部9枚。レア役で上乗せ、強チェリー・チャンス目で<b style={{ color:'#ffd700' }}>上乗せ特化ゾーン（{SLOT_TOKU_GAMES}G・毎G上乗せ）</b></div>
            <div>・<b>中段チェリー</b>はフリーズ＝AT確定（{SLOT_PREMIUM_GAMES}G）</div>
            <div>・予告は 青→緑→赤→金→<span style={{ display:'inline-block', color: RAINBOW_BASE, fontWeight:'bold', animation:'csHue 1.2s linear infinite' }}>虹（AT確定）</span></div>
            <div style={{ color:CASINO.dim }}>キーボード：スペース＝レバー　← ↓ →＝止める</div>
          </div>
        )}
      </div>
    </div>
  )
}
