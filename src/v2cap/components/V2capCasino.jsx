// ============================================================
// v2cap 賭博場（2026-10-13）— スロット・ハイ&ロー・ルーレット・両替所
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「V2capに無印の時みたいに賭博場を設置したい、新たにルーレットも追加したい。
//   交換所はあと設置するからまずは土台を」。決めたことは src/v2cap/lib/casino.js の頭に書いた
// ★抽選と払い出しはサーバー（SQL §11）。どのRPCも残高（medals）と当日の収支（day_net）を返すので、
//   遊ぶたびにプロフィールを読み直さない（前作は1回ごとに4〜5回読み込んでいて重かった）
// 【確定】2026-10-27 カクテルウェイトレスのアレア（ユーザー指示「賭博場の画面に、看板娘や親方と同じ形で受付嬢のイラストを入れたい」
//   →「受付っていうか、カジノでそこらへん歩いてる店員」・lib/alea.js）：
//   右にアレアを立たせる（幅が足りないときは上の細い帯）。タップ・大当たり・負けたとき（毎回は言わない）・両替でセリフと表情が変わる（ユーザー選択）。
//   大当たりの演出（BIG WIN など）の上にもアレアを出す。好感度は看板娘と同じ形（画面には出さない・サーバーの v2cap_alea_talk）。
//   その日はじめて賭博場に入るときは、全身の「いらっしゃい」をホームの上で先に出す（下の casinoWelcomeDue・閉じたら賭博場の画面へ）
// 【2026-10-27 直した】ユーザー指示「スクロールしないとルーレットとかできなくなったから画像の部分調整したい・好感度は確認したからいらない・
//   メダルももっとスリムにして・音ありなし右上に（題の行の右端）」：好感度の開発用ボタンを外し、メダルの欄を1行に、
//   音の切り替えは題の行の右端（CasinoSoundToggle を V2capHome が置く）へ移した
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { GOLD_PER_MEDAL, maxExchangeOf } from '../lib/casino.js'
import {
  pickLine, enterKindOf, tapKindOf, nextStreak, isNight, welcomeDueLocal, dayOf, makeDailyAsker,
  stageOf, varsOf, stageEventOf, fillLine, loseDue, welcomeLineOf,
} from '../lib/alea.js'
import { setSoundOn, sfx, fx } from './casinoFx.js'
import { CASINO, panel, pill, bigBtn, fmt, signed } from './casinoStyle.js'
import { CountUp } from './casinoParts.jsx'
import CasinoFxLayer from './CasinoFxLayer.jsx'
import V2capAlea, { AleaSays, V2capAleaWelcome, ALEA_CSS } from './V2capAlea.jsx'
import V2capSlot from './V2capSlot.jsx'
import V2capHilo from './V2capHilo.jsx'
import V2capRoulette from './V2capRoulette.jsx'

const TABS = [
  { key:'slot',     label:'🎰 スロット' },
  { key:'hilo',     label:'🃏 ハイ&ロー' },
  { key:'roulette', label:'🎡 ルーレット' },
  { key:'exchange', label:'💱 両替所' },
]
const EXCHANGE_PRESETS = [1, 10, 100, 1000]

// SQL がまだ流されていないときの見え方
const sqlMissing = (msg) => /v2cap_casino_state|v2cap_slot|v2cap_hilo|v2cap_roulette|Could not find the function/i.test(msg || '')

// その日はじめて話しかけた（好感度+1）をサーバーに聞く窓口（同じ日は1回だけ聞いて答えを使い回す＝lib/clerk.js の makeDailyAsker）
const talkAsker = makeDailyAsker(() => supabase.rpc('v2cap_alea_talk'))

// ===== その日の「いらっしゃい」（看板娘の burgerWelcomeDue と同じ形）=====
// メニューで押したその場で決めて、ホームの上に出す（V2capHome）。閉じたら賭博場の画面へ。
// 決めるのは手元のプロフィールの日付（casino_welcome_day＝前に出した日）＝サーバーの返事を待たない。
// 出したら今日の印をサーバーに付け、ページを開き直すまで手元でも覚える（同じ日に2回出さない）
let welcomeShownDay = null
export const casinoWelcomeDue = (prof, at = new Date()) =>
  welcomeShownDay !== dayOf(at) && welcomeDueLocal(prof?.casino_welcome_day, at)
export const markCasinoWelcome = () => {
  welcomeShownDay = dayOf()
  // ★supabase の呼び出しは then を付けないと送られない（返事は待たない）
  supabase.rpc('v2cap_casino_welcome').then(() => {})
}
const devBtn = { ...pill('#ff88cc', false), padding:'3px 8px', fontSize:'10px' }

// 効果音の切り替え（端末で覚える）。題の行の右端に置く（V2capHome・2026-10-27 ユーザー指示「音ありなし右上に設置するようにして」）。
// 賭博場の画面と一緒に出るので、出たときに覚えている設定を効果音に入れる
export function CasinoSoundToggle() {
  const [sound, setSound] = useStored('capCasinoSound', true)
  useEffect(() => { setSoundOn(sound) }, [sound])
  return (
    <button onClick={() => setSound(v => !v)} style={pill(sound ? CASINO.cyan : CASINO.dim, false)} aria-label="効果音">
      {sound ? '🔊 音あり' : '🔇 音なし'}
    </button>
  )
}

// dev … 開発用（管理者だけ）。「いらっしゃい」を何回でも見られるボタン（右に立たせる広い画面だけ）。
//   好感度を仮に置くボタンは外した（2026-10-27 ユーザー「好感度は確認したからいらない」）
export default function V2capCasino({ prof, onProfile, dev = false }) {
  const [tab, setTab] = useStored('capCasinoTab', 'slot')
  const [state, setState] = useState(null)       // v2cap_casino_state の返事（開いたときだけ）
  const [money, setMoney] = useState({ medals: Number(prof?.medals) || 0, gold: Number(prof?.gold) || 0, day_net: 0 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exAmount, setExAmount] = useState(10)
  const [exMsg, setExMsg] = useState('')
  const [welcome, setWelcome] = useState(null)   // 開発用に出している「いらっしゃい」のセリフ（null＝出していない）

  // ===== アレア（lib/alea.js）=====
  // 好感度（画面には出さない）：aff＝サーバーの好感度（話しかけた日の数）・seen＝見せた段階の場面
  const [aff, setAff] = useState(() => Number(prof?.alea_affinity) || 0)
  const [seen, setSeen] = useState(() => Number(prof?.alea_stage_seen) || 0)
  const stage = stageOf(aff)
  // say がいまの段階と呼び方を見られるように控える（say は作り直さない）
  const ctx = useRef({ stage, vars: varsOf(prof) })
  ctx.current = { stage, vars: varsOf(prof) }
  // いまの表情とセリフ（tick は話すたびに増やす＝同じ表情でも跳ねる）。開いたときは、前に開いた日（casino_welcome_day）であいさつを選ぶ
  const [alea, setAlea] = useState(() => {
    const st = stageOf(prof?.alea_affinity)
    const kind = enterKindOf(new Date(), { stage: st, lastVisit: prof?.casino_welcome_day })
    return { ...pickLine(kind, { vars: varsOf(prof), stage: st }), tick: 0 }
  })
  const lastText = useRef(alea.text)
  // 場面 kind のセリフを選んで吹き出しに出し、選んだもの { face, text } を返す（当たりの演出の上にも同じものを出す）
  const say = useCallback((kind) => {
    const { stage: st, vars } = ctx.current
    const line = pickLine(kind, { last: lastText.current, vars, stage: st })
    lastText.current = line.text
    setAlea(c => ({ ...line, tick: c.tick + 1 }))
    return line
  }, [])
  const sayEvent = (ev) => {
    const text = fillLine(ev.text, ctx.current.vars)
    lastText.current = text
    setAlea(c => ({ face: ev.face, text, tick: c.tick + 1 }))
  }
  const streak = useRef(null)
  const talked = useRef(false)
  const tapAlea = () => {
    streak.current = nextStreak(streak.current, Date.now())
    say(tapKindOf(streak.current.n, isNight()))   // 待たせないように、まずすぐ答える
    // その日はじめて話しかけたら、サーバーが好感度を+1（1日1回）。段階が上がっていれば、返事が来たところで
    // その段階の場面のセリフに切り替える（1回だけ）
    if (talked.current) return
    talked.current = true
    talkAsker.get().then(({ data, error: e }) => {
      if (e || !data?.ok) return
      const nextAff = Number(data.affinity) || 0
      setAff(nextAff)
      ctx.current = { ...ctx.current, stage: stageOf(nextAff) }
      const ev = stageEventOf(stageOf(nextAff), Math.max(Number(seen) || 0, Number(data.seen) || 0))
      if (!ev) return
      sayEvent(ev)
      setSeen(ev.stage)
      talkAsker.set({ data: { ...data, seen: ev.stage } })   // 同じ日に賭博場を開き直しても、もう出さない
      // ★supabase の呼び出しは then を付けないと送られない（結果は待たない＝失敗しても次の日にもう一度出るだけ）
      supabase.rpc('v2cap_alea_seen', { p_stage: ev.stage }).then(() => {})
    })
  }
  // ゲームの結果（lib/alea.js の winTalkOf・atTalkOf・負けたとき）。負けたときは LOSE_GAP_MS に1回まで。
  // 返すのは当たりの演出の上に出すアレア（言わないときは null）
  const lastLose = useRef(0)
  const onTalk = useCallback((kind) => {
    if (!kind) return null
    if (kind === 'lose') {
      if (!loseDue(lastLose.current)) return null
      lastLose.current = Date.now()
    }
    const line = say(kind)
    return <AleaSays face={line.face} line={line.text} />
  }, [say])

  // どのRPCの返事からでも残高を受け取る
  const onMoney = useCallback((d) => {
    if (!d) return
    setMoney(m => ({
      medals: d.medals != null ? Number(d.medals) : m.medals,
      gold: d.gold != null ? Number(d.gold) : m.gold,
      day_net: d.day_net != null ? Number(d.day_net) : m.day_net,
    }))
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase.rpc('v2cap_casino_state')
      if (!alive) return
      if (err || !data?.ok) {
        const msg = err?.message || data?.error || '読み込めませんでした'
        setError(sqlMissing(msg) ? '賭博場のSQL（supabase_v2cap_core.sql の §11）がまだ流されていません' : msg)
        return
      }
      setState(data)
      onMoney(data)
      // 途中の勝負があれば、そのゲームを開く
      if (data.hilo?.active) setTab('hilo')
      else if (data.slot?.mode && data.slot.mode !== 'normal') setTab('slot')
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, [])

  const exchange = async (n) => {
    if (busy || !(n > 0)) return
    setBusy(true); setExMsg('')
    const { data, error: err } = await supabase.rpc('v2cap_casino_exchange', { p_medals: n })
    setBusy(false)
    if (err || !data?.ok) { setExMsg(`⚠ ${err?.message || data?.error || '両替できませんでした'}`); return }
    onMoney(data)
    sfx.coin(0); setTimeout(() => sfx.coin(4), 90)
    fx('coins', { n: Math.min(40, 6 + Math.round(Math.log10(n + 1) * 8)), from: 'bottom' })
    setExMsg(`💰 ${fmt(data.spent)} Gold → 🪙 ${fmt(data.got)}枚`)
    say('exchange')
    await onProfile?.(null)
  }

  const maxEx = maxExchangeOf(money.gold)
  // 両替する枚数を選ぶ。お財布を超える枚数を選んだら、アレアがジト目（ボタンは押すたび・打ちこみは超えた瞬間だけ）
  const pickAmount = (n, typed = false) => {
    if (n > maxEx && (!typed || exAmount <= maxEx)) say('short')
    setExAmount(n)
  }
  const netColor = money.day_net > 0 ? CASINO.green : money.day_net < 0 ? CASINO.red : CASINO.label
  return (
    <CasinoFxLayer>
      <style>{ALEA_CSS}</style>
      {welcome && <V2capAleaWelcome line={welcome} onClose={() => setWelcome(null)} />}
      <div className="al-cols">
        {/* アレア（広い画面は右・幅が足りないときは上の細い帯） */}
        <div className="al-side">
          <V2capAlea face={alea.face} line={alea.text} tick={alea.tick} onTap={tapAlea} />
          {dev && (
            <div className="al-dev" style={{ textAlign:'center', marginTop:'8px', fontFamily:'monospace' }}>
              <button type="button" onClick={() => setWelcome(welcomeLineOf({ alea_affinity: aff }))} style={devBtn}>🧪 いらっしゃいを見る［開発］</button>
            </div>
          )}
        </div>

        <div className="al-main">
          {/* ===== 上：残高・当日の収支（1行・2026-10-27 ユーザー指示「メダルももっとスリムにして」。音の切り替えは題の行の右端） ===== */}
          <div style={{ ...panel(), padding:'5px 10px', display:'flex', alignItems:'baseline', gap:'2px 14px', flexWrap:'wrap', marginBottom:'6px' }}>
            <span style={{ color:CASINO.label, fontSize:'11px' }}>
              メダル <span style={{ color:CASINO.gold, fontSize:'16px', fontWeight:'bold', textShadow:'0 0 6px #ffcc0055' }}>🪙 <CountUp value={money.medals} ms={700} /></span>
            </span>
            <span style={{ fontSize:'11px', color:CASINO.label }}>
              今日の収支 <span style={{ color: netColor, fontWeight:'bold' }}>{signed(money.day_net)}</span>
            </span>
            <span style={{ fontSize:'11px', color:CASINO.label }}>Gold <span style={{ color:'#ffcc00' }}>{fmt(money.gold)}</span></span>
          </div>

          {/* ===== タブ ===== */}
          {/* スマホでも1段に収まるように、すき間を少し詰める（2026-10-27・ゲームが下へ押されないように） */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'6px' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ ...pill(t.key === 'exchange' ? CASINO.gold : CASINO.pink, tab === t.key), padding:'5px 7px', whiteSpace:'nowrap' }}>{t.label}</button>
            ))}
          </div>

          {error && <div style={{ color:'#ff6666', fontSize:'12px', marginBottom:'8px' }}>⚠ {error}</div>}

          {!error && !state && <div style={{ color:CASINO.label, fontSize:'12px', padding:'20px', textAlign:'center' }}>読み込み中...</div>}

          {/* ★3つとも開いたままにして、見えていないものは隠す（タブを行き来しても、ATの残りや勝負の途中が開いたときの古い状態に戻らない） */}
          {state && (
            <>
              <div style={{ display: tab === 'slot' ? 'block' : 'none' }}><V2capSlot init={state.slot} medals={money.medals} onMoney={onMoney} onTalk={onTalk} active={tab === 'slot'} /></div>
              <div style={{ display: tab === 'hilo' ? 'block' : 'none' }}><V2capHilo init={state.hilo} medals={money.medals} onMoney={onMoney} onTalk={onTalk} /></div>
              <div style={{ display: tab === 'roulette' ? 'block' : 'none' }}><V2capRoulette init={state.roulette} medals={money.medals} onMoney={onMoney} onTalk={onTalk} /></div>
            </>
          )}
          {state && tab === 'exchange' && (
            <div style={panel(CASINO.goldDeep)}>
              <div style={{ color:CASINO.gold, fontSize:'13px', fontWeight:'bold', marginBottom:'4px' }}>💱 両替所</div>
              <div style={{ color:CASINO.label, fontSize:'11px', marginBottom:'10px' }}>
                {GOLD_PER_MEDAL} Gold で メダル1枚。メダルを Gold に戻すことはできません。
              </div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'10px' }}>
                {EXCHANGE_PRESETS.map(n => (
                  <button key={n} onClick={() => pickAmount(n)} style={pill(CASINO.gold, exAmount === n)}>{fmt(n)}枚</button>
                ))}
                <button onClick={() => setExAmount(maxEx)} disabled={maxEx < 1} style={pill(CASINO.gold, exAmount === maxEx && maxEx > 0)}>全部（{fmt(maxEx)}枚）</button>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'10px', fontSize:'12px', color:CASINO.body }}>
                <input type="number" min={1} max={Math.max(1, maxEx)} value={exAmount}
                  onChange={e => pickAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)), true)}
                  style={{ width:'110px', background:'#000', color:CASINO.gold, border:`1px solid ${CASINO.goldDeep}`, padding:'6px', fontFamily:'monospace', fontSize:'13px' }} />
                <span>枚 ＝ <span style={{ color:'#ffcc00' }}>{fmt(exAmount * GOLD_PER_MEDAL)} Gold</span></span>
              </div>
              <button onClick={() => exchange(exAmount)} disabled={busy || exAmount < 1 || exAmount > maxEx}
                style={bigBtn(CASINO.gold, !busy && exAmount >= 1 && exAmount <= maxEx)}>
                🪙 {fmt(exAmount)}枚に両替する
              </button>
              {exAmount > maxEx && <div style={{ color:CASINO.red, fontSize:'11px', marginTop:'6px' }}>Goldが足りません</div>}
              {exMsg && <div style={{ color: exMsg.startsWith('⚠') ? '#ff6666' : CASINO.green, fontSize:'12px', marginTop:'8px' }}>{exMsg}</div>}
              <div style={{ color:CASINO.dim, fontSize:'10px', marginTop:'12px' }}>※ 景品の交換所はあとで作ります</div>
            </div>
          )}
        </div>
      </div>
    </CasinoFxLayer>
  )
}
