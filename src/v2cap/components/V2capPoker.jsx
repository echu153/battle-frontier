// ============================================================
// v2cap 賭博場 — ポーカー（カリビアンスタッド・アレアがディーラー・2026-10-28）
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー指示「じゃあポーカーも作っておいて、対ディーラー用の」＋選んだこと
//   （カリビアンスタッド・アンティ10〜1000枚・これまでの払い出し3万枚で解禁）。決まりは src/v2cap/lib/casino.js、抽選と払い出しはサーバー（SQL §22）
//   ・5枚ずつ1枚ずつ配る。ディーラーは1枚目だけ表（ほかの4枚はサーバーも返さない）。勝負したら4枚を1枚ずつめくる
//   ・「勝負する」のボタンに、いまの役と勝ったときの上乗せの配当を出す
//   ・大きな役で勝ったら BIG WIN など（払い出し÷アンティ・casino.js の winTierOf）。決まりの説明は ❓ HELP
//   ・名札はアレアが名乗るまで「ディーラー」（lib/alea.js の dealerNameOf）
// ============================================================
import { useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { POKER_ANTES, POKER_MIN_ANTE, POKER_MAX_ANTE, POKER_RAISE_MULT, POKER_HANDS, pkHandOf, pkQualifies, winTierOf } from '../lib/casino.js'
import { pokerTalkOf, winTalkOf } from '../lib/alea.js'
import { sfx, fx, vibrate, celebrate } from './casinoFx.js'
import { CASINO, panel, bigBtn, pill, fmt, DISPLAY_FONT } from './casinoStyle.js'
import { PlayingCard } from './casinoParts.jsx'
import V2Modal from './V2Modal.jsx'
import { miniBtn } from './v2ui.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CARD_W = 56
const CARD_H = Math.round(CARD_W * 1.4)
const DEAL_MS = 120
const FLIP_MS = 300
const HELP_HEAD = { color: CASINO.gold, fontSize:'12px', marginBottom:'2px' }
// 配ったカードは右上（カードの山）からすべりこむ。★5枚並ぶので動きは小さめ・卓の枠（overflow:hidden）の外へは出さない
//   （スマホで5枚目が動きの途中に画面の右へはみ出し、ページが横に広がった）
const PK_CSS = '@keyframes pkIn { from { transform: translate(20px,-28px) rotate(6deg); opacity: 0 } to { transform: none; opacity: 1 } }'

// うまくいかなかったときの文（SQL §22 をまだ流していなければ、そう出す）
const errorTextOf = (error, data, fallback) => {
  const m = error?.message || data?.error || fallback
  return /v2cap_poker_|Could not find the function/i.test(m) ? 'ポーカーのSQL（supabase_v2cap_core.sql の §22）がまだ流されていません' : m
}
// 見えている5枚の役の名前（伏せたカードがあれば出さない）
const handNameOf = (cards) => (cards.length === 5 && cards.every(x => !x.down && x.c != null) ? pkHandOf(cards.map(x => x.c)).name : '')

// onTalk … アレアに結果を伝える（V2capCasino・lib/alea.js の pokerTalkOf／winTalkOf）。dealerName … 卓の名札
export default function V2capPoker({ init, medals, onMoney, onTalk, dealerName = 'ディーラー' }) {
  const [anteSel, setAnteSel] = useStored('capPokerAnte', 50)
  // 勝負の途中で開き直したときは、サーバーの手から戻す（ディーラーは1枚目だけ）
  const [round, setRound] = useState(() => (init?.active ? { active: true, ante: Number(init.ante) } : { active: false, ante: 0 }))
  const [player, setPlayer] = useState(() => (init?.active ? (init.player || []).map(c => ({ c, down: false })) : []))
  const [dealer, setDealer] = useState(() => (init?.active
    ? [{ c: init.dealer?.[0], down: false }, ...Array.from({ length: 4 }, () => ({ c: null, down: true }))]
    : []))
  const [end, setEnd] = useState(null)   // 終わった勝負 { result, payout, ante, stake, hand }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [help, setHelp] = useState(false)

  // 1枚置く（裏で置いてからめくる。keepDown＝ディーラーの2〜5枚目は伏せたまま）
  const place = async (set, c, keepDown = false) => {
    sfx.deal()
    set(xs => [...xs, { c, down: true }])
    await sleep(50)
    if (!keepDown) set(xs => xs.map((x, k) => (k === xs.length - 1 ? { ...x, down: false } : x)))
    await sleep(DEAL_MS)
  }
  // ディーラーの2〜5枚目をめくる（slow＝勝負したときは1枚ずつ間を置く）
  const reveal = async (cards, slow) => {
    for (let k = 1; k < 5; k++) {
      setDealer(xs => xs.map((x, i) => (i === k ? { c: cards[k], down: true } : x)))
      await sleep(40)
      setDealer(xs => xs.map((x, i) => (i === k ? { ...x, down: false } : x)))
      sfx.flip()
      await sleep(slow ? FLIP_MS : 60)
    }
  }

  const deal = async () => {
    if (busy || round.active) return
    const ante = Math.max(POKER_MIN_ANTE, Math.min(POKER_MAX_ANTE, Math.floor(anteSel) || POKER_MIN_ANTE))
    if (medals < ante * (1 + POKER_RAISE_MULT)) { setMsg(`メダルが足りません（勝負に出るとアンティの${POKER_RAISE_MULT}倍を足すので、${fmt(ante * (1 + POKER_RAISE_MULT))}枚要ります）`); return }
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2cap_poker_start', { p_ante: ante })
    if (error || !data?.ok) { setBusy(false); setMsg(errorTextOf(error, data, '配れませんでした')); return }
    setEnd(null); setPlayer([]); setDealer([])
    // こちら・ディーラーの順に1枚ずつ（ディーラーは1枚目だけ表）
    for (let k = 0; k < 5; k++) {
      await place(setPlayer, data.player[k])
      await place(setDealer, k === 0 ? data.dealer[0] : null, k > 0)
    }
    setRound({ active: true, ante: Number(data.ante) })
    onMoney(data)
    setBusy(false)
  }

  const act = async (action) => {
    if (busy || !round.active) return
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2cap_poker_action', { p_action: action })
    if (error || !data?.ok) { setBusy(false); setMsg(errorTextOf(error, data, 'うまくいきませんでした')); return }
    if (action === 'raise') { sfx.chip(); await sleep(250) }
    await reveal(data.dealer, action === 'raise')
    onMoney(data)
    const ante = Number(data.ante)
    const stake = ante * (action === 'raise' ? 1 + POKER_RAISE_MULT : 1)
    const payout = Number(data.payout) || 0
    const hand = pkHandOf(data.player)
    setEnd({ result: data.result, payout, ante, stake, hand })
    setRound(r => ({ ...r, active: false }))
    const tier = data.result === 'win' ? winTierOf(payout, ante) : null
    if (tier && tier.key !== 'win') {
      // スリーカード以上の勝ち（払い出しがアンティの10倍以上）は BIG WIN など
      celebrate(tier, payout, { title: hand.name, sub: `上乗せ ${hand.pay}倍`, say: onTalk?.(winTalkOf(tier.key)) })
    } else {
      if (payout > stake) {
        sfx.win(1)
        fx('coins', { n: 16, from: 'bottom' })
        fx('popup', { text: `+${fmt(payout)}枚`, color: CASINO.green, size: 34 })
      } else if (payout > 0) {
        sfx.small()
        fx('popup', { text: 'PUSH', color: CASINO.cyan, size: 30 })
      } else if (data.result === 'lose') {
        sfx.lose(); vibrate(80)
        fx('flash', { color: '#ff0033', ms: 260 })
      }
      onTalk?.(pokerTalkOf(data.result))
    }
    setBusy(false)
  }

  // ===== 見た目 =====
  const hand = (cards, glow) => (
    <div style={{ display:'flex', justifyContent:'center', gap:'4px', minHeight: CARD_H }}>
      {cards.length ? cards.map((x, k) => (
        <div key={k} style={{ animation:'pkIn 0.22s ease-out' }}>
          <PlayingCard card={x.c} faceDown={x.down} w={CARD_W} glow={glow} />
        </div>
      )) : Array.from({ length: 5 }, (_, k) => <div key={k} style={{ width: CARD_W, height: CARD_H, border:'2px dashed #2e5a40', borderRadius: 6 }} />)}
    </div>
  )
  const label = (name, cards, color, note) => {
    const h = handNameOf(cards)
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'baseline', gap:'8px', fontSize:'11px', color: CASINO.label, margin:'3px 0' }}>
        <span>{name}</span>
        {h && <span style={{ fontSize:'15px', fontWeight:'bold', fontFamily: DISPLAY_FONT, color }}>{h}</span>}
        {note && <span style={{ fontSize:'10px', color: CASINO.dim }}>{note}</span>}
      </div>
    )
  }
  const dealerOpen = dealer.length === 5 && dealer.every(x => !x.down && x.c != null)
  const dealerNote = dealerOpen && end && end.result !== 'fold' ? (pkQualifies(dealer.map(x => x.c)) ? '' : '（AとKがそろわない）') : ''
  const win = end && end.payout > end.stake
  const lose = end && end.payout < end.stake
  const endText = end && ({
    noqual: `${dealerName}の手が勝負にならない +${fmt(end.payout)}枚`,
    win: `勝ち！ ${end.hand.name}（上乗せ ${end.hand.pay}倍） +${fmt(end.payout)}枚`,
    push: `引き分け（${fmt(end.stake)}枚 戻りました）`,
    lose: `負け…（${fmt(end.stake)}枚 没収）`,
    fold: `降りた（${fmt(end.ante)}枚 没収）`,
  })[end.result]
  const now = player.length === 5 ? pkHandOf(player.map(x => x.c)) : null
  const canRaise = round.active && !busy && medals >= round.ante * POKER_RAISE_MULT
  const needToDeal = anteSel * (1 + POKER_RAISE_MULT)

  const helpModal = help && (
    <V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>
      <div style={HELP_HEAD}>遊び方（カリビアンスタッド）</div>
      <div>アンティを賭けると、5枚ずつ配られる（{dealerName}は1枚だけ表）。降りる（アンティは没収）か、アンティの{POKER_RAISE_MULT}倍を上乗せして勝負する。配るときにアンティの{1 + POKER_RAISE_MULT}倍のメダルが要る。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>勝負したら</div>
      <div>{dealerName}の手が<b>AとKがそろった役なし</b>より弱いときは勝負にならない：アンティは2倍・上乗せは戻る。
        勝負になったら役で比べる：勝ち＝アンティは2倍・上乗せは役の配当／引き分け＝戻る／負け＝両方没収。</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>上乗せの配当（勝ったとき・賭けたぶんに足す）</div>
      <div>{[...POKER_HANDS].reverse().map(h => `${h.name} ${h.pay}倍`).join('・')}</div>
      <div style={{ ...HELP_HEAD, marginTop:'10px' }}>役の強さ・カード</div>
      <div>上の配当の順に強い。同じ役なら数字の大きいほう（Aがいちばん上・A2345 のストレートは5が上）。マークは関係なし。52枚のトランプを毎回まぜて配る（同じカードは出ない）。アンティは{POKER_MIN_ANTE}〜{fmt(POKER_MAX_ANTE)}枚。</div>
    </V2Modal>
  )

  return (
    <div style={{ ...panel('#1f4a7a'), background:'radial-gradient(ellipse at 50% 40%, #14385c 0%, #0b1a2a 70%), #040c14', overflow:'hidden' }}>
      <style>{PK_CSS}</style>
      {helpModal}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
        <span style={{ color: CASINO.gold, fontSize:'12px', fontWeight:'bold' }}>♦ ポーカー</span>
        <span style={{ color: CASINO.dim, fontSize:'10px' }}>AとKで勝負・ロイヤル{POKER_HANDS[POKER_HANDS.length - 1].pay}倍</span>
        <span style={{ marginLeft:'auto' }}><button type="button" onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button></span>
      </div>

      {/* ===== ディーラー（アレア） ===== */}
      {label(dealerName, dealer, CASINO.bright, dealerNote)}
      {hand(dealer, end && lose ? CASINO.pink : undefined)}

      {/* ===== 真ん中：結果・賭け ===== */}
      <div style={{ textAlign:'center', minHeight:'30px', margin:'6px 0', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {end ? (
          <div style={{ fontSize:'14px', fontWeight:'bold', color: win ? CASINO.green : lose ? '#ff6680' : CASINO.cyan }}>{endText}</div>
        ) : round.active ? (
          <div style={{ fontSize:'12px', color: CASINO.gold }}>アンティ {fmt(round.ante)}枚</div>
        ) : (
          <div style={{ fontSize:'11px', color: CASINO.label }}>5枚の役の強さで、{dealerName}と勝負</div>
        )}
      </div>

      {/* ===== こちら ===== */}
      {hand(player, end && win ? CASINO.gold : undefined)}
      {label('あなた', player, CASINO.gold)}

      {/* ===== 操作 ===== */}
      {round.active ? (
        <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
          <button onClick={() => act('fold')} disabled={busy} style={{ ...bigBtn(CASINO.pink, !busy), flex:'1 1 0', padding:'6px 4px', lineHeight:1.3 }}>
            降りる<div style={{ fontSize:'10px', fontWeight:'normal' }}>アンティ {fmt(round.ante)}枚は没収</div>
          </button>
          <button onClick={() => act('raise')} disabled={!canRaise} style={{ ...bigBtn(CASINO.gold, canRaise), flex:'1.4 1 0', padding:'6px 4px', lineHeight:1.3 }}>
            勝負する（+{fmt(round.ante * POKER_RAISE_MULT)}枚）
            {now && <div style={{ fontSize:'10px', fontWeight:'normal' }}>{now.name}：勝てば上乗せ {now.pay}倍</div>}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', justifyContent:'center', margin:'8px 0' }}>
            {POKER_ANTES.map(a => <button key={a} onClick={() => setAnteSel(a)} style={pill(CASINO.gold, anteSel === a)}>{fmt(a)}枚</button>)}
          </div>
          <button onClick={deal} disabled={busy || medals < needToDeal} style={{ ...bigBtn(CASINO.green, !busy && medals >= needToDeal), width:'100%', padding:'8px 14px', lineHeight:1.3 }}>
            🃏 アンティ {fmt(anteSel)}枚 賭けて配る
            <div style={{ fontSize:'10px', fontWeight:'normal' }}>勝負に出ると +{fmt(anteSel * POKER_RAISE_MULT)}枚</div>
          </button>
        </>
      )}
      {msg && <div style={{ color:'#ff6666', fontSize:'12px', textAlign:'center', marginTop:'6px' }}>⚠ {msg}</div>}
    </div>
  )
}
