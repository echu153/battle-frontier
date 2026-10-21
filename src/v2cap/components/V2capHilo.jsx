// ============================================================
// v2cap 賭博場 — ハイ&ロー（連勝はしご）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー選択「連勝はしごに作り直す」＋「2回目からは確率どおり」。表は src/v2cap/lib/casino.js
//   ・賭けて1枚目 → 上か下か（同じ数字は負け）→ 当たったら、引いたカードを基準に続けるか受け取るか
//   ・ボタンに 当たる確率・倍率・当たったときの持ち分 を出す（前作は倍率の決まり方が見えなかった）
//   ・めくる前に少し間を置く（持ち分が大きいほど長く・心臓の音）。連勝が続くほど音が高くなり、背景が熱くなる
// ============================================================
import { useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { HILO_BETS, HILO_MIN_BET, HILO_MAX_BET, HILO_MAX_STREAK, HILO_CAP_MULT, hiloMult100Of, hiloChanceOf, hiloNextPotOf, hiloPayoutOf, winTierOf } from '../lib/casino.js'
import { sfx, fx, celebrate, vibrate } from './casinoFx.js'
import { CASINO, panel, bigBtn, pill, fmt, DISPLAY_FONT } from './casinoStyle.js'
import { CountUp, PlayingCard } from './casinoParts.jsx'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export default function V2capHilo({ init, medals, onMoney }) {
  const [betSel, setBetSel] = useStored('capHiloBet', 50)
  const [g, setG] = useState(() => (init?.active
    ? { active: true, bet: init.bet, pot: Number(init.pot), card: init.card, streak: init.streak, cards: init.cards || [init.card] }
    : { active: false, bet: 0, pot: 0, card: null, streak: 0, cards: [] }))
  const [next, setNext] = useState(null)       // めくっている次のカード {card, faceDown, result}
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [last, setLast] = useState(null)       // 終わった勝負の結果 {type:'take'|'lose'|'auto', payout}
  const [shakeCard, setShakeCard] = useState(false)

  const start = async () => {
    if (busy) return
    const bet = Math.max(HILO_MIN_BET, Math.min(HILO_MAX_BET, Math.floor(betSel) || HILO_MIN_BET))
    if (medals < bet) { setMsg('メダルが足りません（両替所で替えられます）'); return }
    setBusy(true); setMsg(''); setLast(null); setNext(null)
    const { data, error } = await supabase.rpc('v2cap_hilo_start', { p_bet: bet })
    if (error || !data?.ok) { setBusy(false); setMsg(error?.message || data?.error || '始められませんでした'); return }
    onMoney(data)
    sfx.deal()
    setG({ active: true, bet: data.bet, pot: Number(data.pot), card: data.card, streak: 0, cards: [data.card] })
    setBusy(false)
  }

  const guess = async (high) => {
    if (busy || !g.active) return
    const m100 = hiloMult100Of(g.card, high, g.streak)
    if (!m100) return
    setBusy(true); setMsg('')
    const p = supabase.rpc('v2cap_hilo_guess', { p_high: high })
    // 裏のカードを出して、少し待ってからめくる（持ち分が大きいほど長く）
    setNext({ card: null, faceDown: true })
    sfx.deal()
    const big = g.pot / 100 >= g.bet * 5 || g.streak >= 3
    const wait = 350 + Math.min(900, g.streak * 120) + (big ? 300 : 0)
    if (big) { sfx.heartbeat(); setTimeout(() => sfx.heartbeat(), 650) }
    const [{ data, error }] = await Promise.all([p, sleep(wait)])
    if (error || !data?.ok) { setBusy(false); setNext(null); setMsg(error?.message || data?.error || 'うまくいきませんでした'); return }
    setNext({ card: data.card, faceDown: true })
    await sleep(30)
    setNext({ card: data.card, faceDown: false, result: data.win ? 'win' : 'lose' })
    sfx.flip()
    await sleep(380)
    onMoney(data)
    if (!data.win) {
      sfx.lose(); vibrate(120); setShakeCard(true); setTimeout(() => setShakeCard(false), 450)
      fx('flash', { color: '#ff0033', ms: 300 })
      setLast({ type: 'lose', payout: 0, lost: hiloPayoutOf(g.pot) })
      setG(x => ({ ...x, active: false, cards: [...x.cards, data.card] }))
      await sleep(700)
      setNext(null); setBusy(false)
      return
    }
    // 当たり：音は連勝ごとに高く
    sfx.coin(data.streak * 2)
    if (data.streak >= 3) fx('coins', { n: 6 + data.streak * 3, from: 'bottom' })
    if (data.streak >= 5) { fx('flash', { color: CASINO.gold, ms: 250 }); vibrate(40) }
    await sleep(350)
    setG(x => ({ ...x, pot: Number(data.pot), card: data.card, streak: data.streak, cards: [...x.cards, data.card], active: !data.done }))
    setNext(null)
    if (data.done) {
      const tier = winTierOf(data.payout, g.bet) || winTierOf(1, 1)
      celebrate(tier, data.payout, { title: data.streak >= HILO_MAX_STREAK ? `${HILO_MAX_STREAK}連勝！` : `${HILO_CAP_MULT}倍に到達！`, sub: '自動で受け取りました' })
      setLast({ type: 'auto', payout: data.payout })
    }
    setBusy(false)
  }

  const take = async () => {
    if (busy || !g.active || g.streak < 1) return
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2cap_hilo_take')
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '受け取れませんでした'); return }
    onMoney(data)
    const tier = winTierOf(data.payout, g.bet)
    if (tier?.key === 'win') { sfx.win(1); fx('coins', { n: 16 + g.streak * 4, from: 'bottom' }); fx('popup', { text: `+${fmt(data.payout)}枚`, color: CASINO.green, size: 34 }) }
    else celebrate(tier, data.payout, { title: `${g.streak}連勝`, sub: `${fmt(g.bet)}枚 → ${fmt(data.payout)}枚` })
    setLast({ type: 'take', payout: data.payout })
    setG(x => ({ ...x, active: false }))
  }

  // ===== 見た目 =====
  const heat = Math.min(1, g.streak / 8)
  const bg = `radial-gradient(ellipse at 50% 30%, rgba(255,${Math.round(120 - heat * 90)},40,${0.08 + heat * 0.35}) 0%, transparent 70%), linear-gradient(180deg,#0b2a1a,#04140c)`
  const option = (high) => {
    const m100 = g.active ? hiloMult100Of(g.card, high, g.streak) : 0
    const chance = g.active ? hiloChanceOf(g.card, high) : 0
    const after = m100 ? hiloPayoutOf(Math.min(hiloNextPotOf(g.pot, m100), g.bet * HILO_CAP_MULT * 100)) : 0
    const on = g.active && !busy && m100 > 0
    const color = high ? '#ff7043' : '#29b6f6'
    return (
      <button onClick={() => guess(high)} disabled={!on}
        style={{ ...bigBtn(color, on), flex:'1 1 140px', padding:'10px 8px', lineHeight:1.35 }}>
        <div style={{ fontSize:'16px' }}>{high ? '▲ HIGH' : '▼ LOW'}</div>
        {m100 ? (
          <div style={{ fontSize:'11px', fontWeight:'normal' }}>
            ×{(m100 / 100).toFixed(2)}・{Math.round(chance * 100)}%<br />→ {fmt(after)}枚
          </div>
        ) : <div style={{ fontSize:'11px', fontWeight:'normal' }}>{g.active ? '選べません' : '—'}</div>}
      </button>
    )
  }

  return (
    <div style={{ ...panel('#1f7a4a'), background: bg, transition:'background 0.6s' }}>
      {/* ===== 連勝のはしご ===== */}
      <div style={{ display:'flex', gap:'3px', justifyContent:'center', marginBottom:'10px', flexWrap:'wrap' }}>
        {Array.from({ length: HILO_MAX_STREAK }, (_, k) => {
          const on = g.streak > k
          const c = k >= 7 ? '#ff4fa3' : k >= 4 ? CASINO.gold : CASINO.green
          return <div key={k} style={{ width:24, height:10, borderRadius:3, background: on ? c : '#1c2a22', boxShadow: on ? `0 0 8px ${c}` : 'none', transition:'all 0.3s' }} />
        })}
      </div>
      {g.streak >= 5 && g.active && (
        <div style={{ textAlign:'center', color:'#ff7043', fontWeight:'bold', letterSpacing:'3px', fontFamily: DISPLAY_FONT,
          textShadow:'0 0 10px #ff3d00', animation:'csPulse 0.7s ease-in-out infinite', marginBottom:'6px' }}>🔥 {g.streak}連勝 FEVER 🔥</div>
      )}

      {/* ===== カード ===== */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'14px', minHeight:'130px' }}>
        <div style={{ animation: shakeCard ? 'csShake 0.09s linear 4' : undefined, '--p':'5px' }}>
          {g.card != null
            ? <PlayingCard card={g.card} w={84} glow={g.active ? CASINO.gold : undefined} />
            : <div style={{ width:84, height:118, border:'2px dashed #2e5a40', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:'#2e5a40', fontSize:'11px' }}>カード</div>}
        </div>
        <div style={{ color:CASINO.label, fontSize:'18px' }}>→</div>
        {next
          ? <PlayingCard card={next.card} faceDown={next.faceDown} w={84} glow={next.result === 'win' ? CASINO.green : next.result === 'lose' ? '#ff2244' : undefined} />
          : <div style={{ width:84, height:118, border:'2px dashed #2e5a40', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:'#2e5a40', fontSize:'22px' }}>?</div>}
      </div>

      {/* ===== 持ち分 ===== */}
      <div style={{ textAlign:'center', margin:'10px 0 8px', minHeight:'40px' }}>
        {g.active ? (
          <>
            <div style={{ fontSize:'11px', color:CASINO.label }}>持ち分（{fmt(g.bet)}枚から・{g.streak}連勝）</div>
            <div style={{ fontSize:'26px', fontWeight:'bold', color:CASINO.gold, textShadow:'0 0 10px #ffcc0066', fontFamily: DISPLAY_FONT }}>
              <CountUp value={hiloPayoutOf(g.pot)} ms={500} />枚
            </div>
          </>
        ) : last ? (
          <div style={{ fontSize:'16px', fontWeight:'bold', color: last.type === 'lose' ? '#ff6680' : CASINO.green, paddingTop:'8px' }}>
            {last.type === 'lose' ? `ハズレ…（${fmt(last.lost)}枚 没収）` : `+${fmt(last.payout)}枚 受け取りました`}
          </div>
        ) : (
          <div style={{ fontSize:'11px', color:CASINO.label, paddingTop:'10px' }}>賭けてカードを引く。次のカードが上（HIGH）か下（LOW）かを当てる</div>
        )}
      </div>

      {/* ===== 操作 ===== */}
      {g.active ? (
        <>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            {option(true)}
            {option(false)}
          </div>
          <button onClick={take} disabled={busy || g.streak < 1}
            style={{ ...bigBtn(CASINO.gold, !busy && g.streak >= 1), width:'100%', marginTop:'8px' }}>
            {g.streak < 1 ? '1回当てると受け取れます' : `💰 ${fmt(hiloPayoutOf(g.pot))}枚を受け取る`}
          </button>
        </>
      ) : (
        <>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', justifyContent:'center', marginBottom:'8px' }}>
            {HILO_BETS.map(b => <button key={b} onClick={() => setBetSel(b)} style={pill(CASINO.gold, betSel === b)}>{fmt(b)}枚</button>)}
          </div>
          <button onClick={start} disabled={busy || medals < betSel} style={{ ...bigBtn(CASINO.green, !busy && medals >= betSel), width:'100%' }}>
            🃏 {fmt(betSel)}枚 賭けてカードを引く
          </button>
        </>
      )}
      {msg && <div style={{ color:'#ff6666', fontSize:'12px', textAlign:'center', marginTop:'6px' }}>⚠ {msg}</div>}

      {/* ===== この勝負で出たカード ===== */}
      {g.cards.length > 1 && (
        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', justifyContent:'center', marginTop:'10px' }}>
          {g.cards.map((c, k) => <PlayingCard key={k} card={c} w={30} dim={k < g.cards.length - 1} />)}
        </div>
      )}
      <div style={{ marginTop:'10px', fontSize:'10px', color:CASINO.dim, lineHeight:1.7 }}>
        強さ 2＜3＜…＜K＜A（マークは関係なし）。<b>同じ数字は負け</b>。倍率は1回目が確率の97%、2回目からは確率どおり。
        {HILO_MAX_STREAK}連勝か、賭けたメダルの{HILO_CAP_MULT}倍で自動で受け取り。
      </div>
    </div>
  )
}
