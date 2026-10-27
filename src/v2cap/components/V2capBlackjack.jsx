// ============================================================
// v2cap 賭博場 — ブラックジャック（アレアがディーラー・2026-10-28）
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー指示「アレアとBJとかポーカーで勝負できるようにもしたい」→「解禁の仕組みとアレアのブラックジャックから作って」
//   ＋選んだこと（還元率 約97.6%＝ブラックジャックの配当6:5・スプリットなし・ソフト17でも引く／賭け10〜1000枚／これまでの払い出し1万枚で解禁）。
//   決まりは src/v2cap/lib/casino.js、抽選と払い出しはサーバー（SQL §21）
//   ・配るとき・アレアが引くときは1枚ずつ間を置く。伏せたカードは勝負がつくまでサーバーも返さない（終わったらめくる）
//   ・名札はアレアが名乗るまで「ディーラー」（lib/alea.js の dealerNameOf）
//   ・決まりの説明は ❓ HELP（ルーレット・スロットと同じ）
// ============================================================
import { useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { BJ_BETS, BJ_MIN_BET, BJ_MAX_BET, BJ_PAY_NUM, BJ_PAY_DEN, BJ_DEALER_STAND, bjValueOf, bjOutcomeOf } from '../lib/casino.js'
import { bjTalkOf } from '../lib/alea.js'
import { sfx, fx, vibrate } from './casinoFx.js'
import { CASINO, panel, bigBtn, pill, fmt, DISPLAY_FONT } from './casinoStyle.js'
import { PlayingCard } from './casinoParts.jsx'
import V2Modal from './V2Modal.jsx'
import { miniBtn } from './v2ui.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CARD_W = 64
const CARD_H = Math.round(CARD_W * 1.4)
const DEAL_MS = 240
const HELP_HEAD = { color: CASINO.gold, fontSize:'12px', marginBottom:'2px' }
// 配ったカードは右上（カードの山）からすべりこむ（卓の枠＝overflow:hidden の外へは出さない・2026-10-28 ポーカーで5枚目が画面の右へはみ出したので合わせた）
const BJ_CSS = '@keyframes bjIn { from { transform: translate(48px,-36px) rotate(10deg); opacity: 0 } to { transform: none; opacity: 1 } }'

// うまくいかなかったときの文（SQL §21 をまだ流していなければ、そう出す）
const errorTextOf = (error, data, fallback) => {
  const m = error?.message || data?.error || fallback
  return /v2cap_bj_|Could not find the function/i.test(m) ? 'ブラックジャックのSQL（supabase_v2cap_core.sql の §21）がまだ流されていません' : m
}

// 見えているカードの合計（Aを11と数えられるときは「7/17」）
const valueTextOf = (cards) => {
  const shown = cards.filter(x => !x.down && x.c != null).map(x => x.c)
  if (!shown.length) return ''
  const v = bjValueOf(shown)
  return v.soft && v.total < 21 ? `${v.total - 10}/${v.total}` : String(v.total)
}

// onTalk … アレアに結果を伝える（V2capCasino・lib/alea.js の bjTalkOf）。dealerName … 卓の名札
export default function V2capBlackjack({ init, medals, onMoney, onTalk, dealerName = 'ディーラー' }) {
  const [betSel, setBetSel] = useStored('capBjBet', 50)
  // 勝負の途中で開き直したときは、サーバーの手から戻す（アレアの2枚目は伏せたまま）
  const [round, setRound] = useState(() => (init?.active
    ? { active: true, bet: Number(init.bet), doubled: !!init.doubled }
    : { active: false, bet: 0, doubled: false }))
  const [player, setPlayer] = useState(() => (init?.active ? (init.player || []).map(c => ({ c, down: false })) : []))
  const [dealer, setDealer] = useState(() => (init?.active ? [{ c: init.dealer?.[0], down: false }, { c: null, down: true }] : []))
  const [end, setEnd] = useState(null)       // 終わった勝負 { outcome, payout, stake }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [help, setHelp] = useState(false)

  // 1枚置く（裏で置いてからめくる。keepDown＝アレアの2枚目は伏せたまま）
  const place = async (set, c, keepDown = false) => {
    sfx.deal()
    set(xs => [...xs, { c, down: true }])
    await sleep(60)
    if (!keepDown) {
      set(xs => xs.map((x, k) => (k === xs.length - 1 ? { ...x, down: false } : x)))
      sfx.flip()
    }
    await sleep(DEAL_MS)
  }

  // 決着：伏せたカードをめくって、アレアが引いたカードを1枚ずつ置いてから、結果を出す
  const finish = async (data) => {
    const full = data.dealer || []
    if (full.length >= 2) {
      setDealer(xs => xs.map((x, k) => (k === 1 ? { c: full[1], down: true } : x)))
      await sleep(60)
      setDealer(xs => xs.map((x, k) => (k === 1 ? { ...x, down: false } : x)))
      sfx.flip()
      await sleep(DEAL_MS + 200)
    }
    for (let k = 2; k < full.length; k++) await place(setDealer, full[k])
    onMoney(data)
    const outcome = bjOutcomeOf(data.player, full, data.result)
    const stake = Number(data.bet) * (data.doubled ? 2 : 1)
    const payout = Number(data.payout) || 0
    setEnd({ outcome, payout, stake })
    setRound(r => ({ ...r, active: false, doubled: !!data.doubled }))
    if (outcome === 'natural') {
      sfx.win(2); vibrate(60)
      fx('flash', { color: CASINO.gold, ms: 300 })
      fx('coins', { n: 34, from: 'bottom' })
      fx('popup', { text: 'BLACKJACK!', sub: `+${fmt(payout)}枚`, color: CASINO.gold, size: 40 })
    } else if (payout > stake) {
      sfx.win(1)
      fx('coins', { n: data.doubled ? 28 : 16, from: 'bottom' })
      fx('popup', { text: `+${fmt(payout)}枚`, color: CASINO.green, size: 34 })
    } else if (payout === stake) {
      sfx.small()
      fx('popup', { text: 'PUSH', color: CASINO.cyan, size: 30 })
    } else {
      sfx.lose(); vibrate(80)
      fx('flash', { color: '#ff0033', ms: 260 })
    }
    onTalk?.(bjTalkOf(outcome))
  }

  const deal = async () => {
    if (busy || round.active) return
    const bet = Math.max(BJ_MIN_BET, Math.min(BJ_MAX_BET, Math.floor(betSel) || BJ_MIN_BET))
    if (medals < bet) { setMsg('メダルが足りません（両替所で替えられます）'); return }
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2cap_bj_start', { p_bet: bet })
    if (error || !data?.ok) { setBusy(false); setMsg(errorTextOf(error, data, '始められませんでした')); return }
    setEnd(null); setPlayer([]); setDealer([])
    setRound({ active: !data.done, bet: Number(data.bet), doubled: false })
    // こちら・アレアの表・こちら・アレアの伏せたカードの順（伏せたカードは決着したときだけ返ってくる）
    await place(setPlayer, data.player[0])
    await place(setDealer, data.dealer[0])
    await place(setPlayer, data.player[1])
    await place(setDealer, data.dealer[1] ?? null, true)
    if (data.done) await finish(data)
    else onMoney(data)
    setBusy(false)
  }

  const act = async (action) => {
    if (busy || !round.active) return
    setBusy(true); setMsg('')
    if (action === 'double') onTalk?.('bjDouble')
    const { data, error } = await supabase.rpc('v2cap_bj_action', { p_action: action })
    if (error || !data?.ok) { setBusy(false); setMsg(errorTextOf(error, data, 'うまくいきませんでした')); return }
    if (action === 'double') setRound(r => ({ ...r, doubled: true }))
    if (action !== 'stand') await place(setPlayer, data.player[data.player.length - 1])
    if (data.done) { await sleep(150); await finish(data) } else onMoney(data)
    setBusy(false)
  }

  // ===== 見た目 =====
  const hand = (cards, glow) => (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight: CARD_H }}>
      {cards.length ? cards.map((x, k) => (
        <div key={k} style={{ marginLeft: k ? (cards.length >= 4 ? -Math.round(CARD_W * 0.42) : 6) : 0, animation:'bjIn 0.25s ease-out' }}>
          <PlayingCard card={x.c} faceDown={x.down} w={CARD_W} glow={glow} />
        </div>
      )) : <div style={{ width: CARD_W, height: CARD_H, border:'2px dashed #2e5a40', borderRadius: 7 }} />}
    </div>
  )
  const label = (name, cards, color) => {
    const v = valueTextOf(cards)
    const bust = cards.length && bjValueOf(cards.filter(x => !x.down && x.c != null).map(x => x.c)).total > 21
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'baseline', gap:'8px', fontSize:'11px', color: CASINO.label, margin:'3px 0' }}>
        <span>{name}</span>
        {v && <span style={{ fontSize:'18px', fontWeight:'bold', fontFamily: DISPLAY_FONT, color: bust ? CASINO.red : color }}>{v}</span>}
      </div>
    )
  }
  const win = end && end.payout > end.stake
  const lose = end && end.payout < end.stake
  const endText = end && ({
    natural: `ブラックジャック！ +${fmt(end.payout)}枚`,
    win: `勝ち！ +${fmt(end.payout)}枚`,
    dealerBust: `${dealerName}が21を超えた！ +${fmt(end.payout)}枚`,
    push: `引き分け（${fmt(end.stake)}枚 戻りました）`,
    lose: `負け…（${fmt(end.stake)}枚 没収）`,
    bust: `21を超えた…（${fmt(end.stake)}枚 没収）`,
    dealerNatural: `${dealerName}のブラックジャック…（${fmt(end.stake)}枚 没収）`,
  })[end.outcome]
  const canDouble = round.active && !busy && player.length === 2 && !round.doubled && medals >= round.bet
  const stake = round.bet * (round.doubled ? 2 : 1)

  const helpModal = help && (
    <V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>
      <div style={HELP_HEAD}>遊び方</div>
      <div>カードの合計を21に近づけて、{dealerName}より大きければ勝ち。21を超えたら負け（{dealerName}は引かない）。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>カードの数え方</div>
      <div>2〜10はその数・J/Q/Kは10・Aは1か11（21を超えないほう）。「7/17」はAを1と11で数えた2通り。カードは52枚から毎回1枚（引いたカードは山に戻す）。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>払い出し（賭けたぶんこみ）</div>
      <div>勝ち 2倍・ブラックジャック（最初の2枚で21）{(1 + BJ_PAY_NUM / BJ_PAY_DEN).toFixed(1)}倍（{BJ_PAY_NUM}:{BJ_PAY_DEN}）・引き分けは賭けたぶんが戻る。賭けは{BJ_MIN_BET}〜{fmt(BJ_MAX_BET)}枚。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>動き</div>
      <div>ヒット＝もう1枚・スタンド＝やめる・ダブル＝最初の2枚のときだけ、賭けをもう1回ぶん足して1枚だけ引く。21になったら自動でスタンド。スプリット・保険・降参はありません。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>{dealerName}</div>
      <div>{BJ_DEALER_STAND}以上になるまで引く。Aを11と数えた{BJ_DEALER_STAND}（ソフト{BJ_DEALER_STAND}）でも引く。表のカードがAか10点のときは伏せたカードを確かめて、ブラックジャックならすぐ勝負がつく（こちらもブラックジャックなら引き分け）。</div>
    </V2Modal>
  )

  return (
    <div style={{ ...panel('#1f7a4a'), background:'radial-gradient(ellipse at 50% 40%, #145c38 0%, #0b2a1a 70%), #04140c', overflow:'hidden' }}>
      <style>{BJ_CSS}</style>
      {helpModal}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
        <span style={{ color: CASINO.gold, fontSize:'12px', fontWeight:'bold' }}>♠ ブラックジャック</span>
        <span style={{ color: CASINO.dim, fontSize:'10px' }}>{BJ_PAY_NUM}:{BJ_PAY_DEN}・ソフト{BJ_DEALER_STAND}で引く</span>
        <span style={{ marginLeft:'auto' }}><button type="button" onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button></span>
      </div>

      {/* ===== ディーラー（アレア） ===== */}
      {label(dealerName, dealer, CASINO.bright)}
      {hand(dealer, end && lose ? CASINO.pink : undefined)}

      {/* ===== 真ん中：結果・賭け ===== */}
      <div style={{ textAlign:'center', minHeight:'30px', margin:'6px 0', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {end ? (
          <div style={{ fontSize:'15px', fontWeight:'bold', color: win ? (end.outcome === 'natural' ? CASINO.gold : CASINO.green) : lose ? '#ff6680' : CASINO.cyan }}>{endText}</div>
        ) : round.active ? (
          <div style={{ fontSize:'12px', color: CASINO.gold }}>賭け {fmt(stake)}枚{round.doubled ? '（ダブル）' : ''}</div>
        ) : (
          <div style={{ fontSize:'11px', color: CASINO.label }}>カードの合計を21に近づけて、{dealerName}より大きければ勝ち</div>
        )}
      </div>

      {/* ===== こちら ===== */}
      {hand(player, end && win ? CASINO.gold : undefined)}
      {label('あなた', player, CASINO.gold)}

      {/* ===== 操作 ===== */}
      {round.active ? (
        <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
          <button onClick={() => act('hit')} disabled={busy} style={{ ...bigBtn(CASINO.cyan, !busy), flex:'1 1 0', padding:'12px 4px' }}>ヒット</button>
          <button onClick={() => act('stand')} disabled={busy} style={{ ...bigBtn(CASINO.pink, !busy), flex:'1 1 0', padding:'12px 4px' }}>スタンド</button>
          <button onClick={() => act('double')} disabled={!canDouble} style={{ ...bigBtn(CASINO.gold, canDouble), flex:'1 1 0', padding:'6px 4px', lineHeight:1.3 }}>
            ダブル<div style={{ fontSize:'10px', fontWeight:'normal' }}>+{fmt(round.bet)}枚</div>
          </button>
        </div>
      ) : (
        <>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', justifyContent:'center', margin:'8px 0' }}>
            {BJ_BETS.map(b => <button key={b} onClick={() => setBetSel(b)} style={pill(CASINO.gold, betSel === b)}>{fmt(b)}枚</button>)}
          </div>
          <button onClick={deal} disabled={busy || medals < betSel} style={{ ...bigBtn(CASINO.green, !busy && medals >= betSel), width:'100%' }}>
            🃏 {fmt(betSel)}枚 賭けて配る
          </button>
        </>
      )}
      {msg && <div style={{ color:'#ff6666', fontSize:'12px', textAlign:'center', marginTop:'6px' }}>⚠ {msg}</div>}
    </div>
  )
}
