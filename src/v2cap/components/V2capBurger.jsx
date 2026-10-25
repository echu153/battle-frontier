import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import V2capClerk, { V2capClerkWelcome, ClerkSays, CLERK_CSS } from './V2capClerk.jsx'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { STAT_DEFS } from '../core/stats.js'
import { AIL_LABEL } from '../core/ailments.js'
import { loadPref, savePref } from '../core/prefs.js'
import {
  MEAL_COLOR, MEAL_MINUTES, BURGERS, BURGER_BY_STAT, TOPPING_GROUPS, TOPPING_BY_AIL, BURGER_GOLD, TOPPING_GOLD,
  TOPPING_RESIST_PCT, toppingsOf, mealCostOf, activeMealOf, leftText, burgerEffectText, toppingText,
} from '../lib/burger.js'
import {
  pickLine, enterKindOf, tapKindOf, nextStreak, isNight, welcomeDueLocal, dayOf, makeDailyAsker,
  stageOf, stageLabelOf, callNameOf, stageEventOf, fillLine,
} from '../lib/clerk.js'

// ============================================================
// 「レベルキャップあり」版 — ハンバーガー屋「ニャーガーキング」（2026-10-25）
//   ・バーガーを1つ選ぶ（STR・DEX・AGI・INT・VIT・LUK のどれか+10%）→ トッピングを頼むか選ぶ（メジャー／マイナー・各500G）→ 注文
//   ・トッピングは頼んだ組の中から1つがサーバーでランダムに決まる（何が乗るかは出てくるまで分からない）
//   ・効くのは60分。食べ直すと前の食事は消える（効いている間に注文するときは確かめる）
//   ★決まりの正は src/v2cap/lib/burger.js。買う・抽選・Goldはサーバー（v2cap_burger_buy）
// 【確定】2026-10-25 看板娘（ユーザー指示・lib/clerk.js）：前の看板（店の名前・猫の王様のひとこと）はユーザー指示「この部分はいらないかも」で外し、
//   右に看板娘を大きく立たせた（スマホは上）。タップ・注文・Gold不足・食べ直しの確かめでセリフと表情が変わる。
//   その日はじめて店を開いたときは、全身の「いらっしゃいませー！」を画面いっぱいに出す（サーバーの v2cap_burger_welcome が日付を覚える）
// ============================================================
const card = (on) => ({
  textAlign:'left', background: on ? '#2a1606' : '#000818', border:`1px solid ${on ? MEAL_COLOR : '#002244'}`,
  color: TEXT.body, padding:'8px', cursor:'pointer', fontFamily:'monospace', minWidth:0,
})
const gold = (n) => `${Number(n || 0).toLocaleString()}G`
const HELP_HEAD = { color: MEAL_COLOR, fontSize:'12px', marginBottom:'2px' }
// 「残り42分」→「42分」（セリフの {left}）
const leftShort = (ms) => leftText(ms).replace(/^残り/, '')
// SQLを流す前（サーバーの関数が無いとき）に、その日の「いらっしゃいませー」を出したかを端末に覚える名前
const WELCOME_PREF = 'capBurgerWelcome'
// その日の「いらっしゃいませー」・その日はじめて話しかけた（好感度+1）をサーバーに聞く窓口
// （同じ日は1回だけ聞いて答えを使い回す＝lib/clerk.js の makeDailyAsker）
const welcomeAsker = makeDailyAsker(() => supabase.rpc('v2cap_burger_welcome'))
const talkAsker = makeDailyAsker(() => supabase.rpc('v2cap_clerk_talk'))
// 開発用の「あいさつ」ボタンで順に見せるひとこと（顔なじみからの3つ）
const DEV_GREETS = ['enterDaily', 'enterLong', 'enterAgain']

// 組の中身（トマト＝出血 など）
function GroupList({ group }) {
  return (
    <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7 }}>
      {toppingsOf(group).map(t => (
        <span key={t.ail} style={{ whiteSpace:'nowrap', marginRight:'8px' }}>
          <span style={{ color: TEXT.bright }}>{t.name}</span>＝{AIL_LABEL[t.ail]}
        </span>
      ))}
    </div>
  )
}

// dev … 開発用（管理者だけ）。「いらっしゃいませー」を何回でも見られるボタンを出す（2026-10-25 ユーザー指示「開発用で、演出は何回もみれるようにして」）
export default function V2capBurger({ prof, onProfile, dev = false }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t) }, [])
  const [pick, setPick] = useState(BURGERS[0].stat)
  const [tops, setTops] = useState({ major: false, minor: false })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [served, setServed] = useState(null)
  const [error, setError] = useState('')
  const [welcome, setWelcome] = useState(false)
  const [help, setHelp] = useState(false)

  const meal = activeMealOf(prof, now)
  const cost = mealCostOf(tops)
  const have = Number(prof?.gold || 0)
  const short = have < cost

  // ===== 好感度（画面には出さない・lib/clerk.js の冒頭）=====
  // aff＝サーバーの好感度（話しかけた日の数）・seen＝見せた段階の場面・devAff＝開発用に仮に置いた好感度（null＝本物）
  const [aff, setAff] = useState(() => Number(prof?.clerk_affinity) || 0)
  const [seen, setSeen] = useState(() => Number(prof?.clerk_stage_seen) || 0)
  const [devAff, setDevAff] = useState(null)
  const stage = stageOf(devAff ?? aff)
  const baseVars = { name: callNameOf(prof), username: prof?.username || '' }
  // say がいまの段階と呼び方を見られるように控える（say は作り直さない）
  const ctx = useRef({ stage, vars: baseVars })
  ctx.current = { stage, vars: baseVars }

  // ===== 看板娘：いまの表情とセリフ（tick は話すたびに増やす＝同じ表情でも跳ねる）=====
  const [clerk, setClerk] = useState(() => {
    const m = activeMealOf(prof)
    const st = stageOf(prof?.clerk_affinity)
    const kind = enterKindOf(m, new Date(), { stage: st, lastVisit: prof?.burger_welcome_day })
    const vars = { ...baseVars, ...(m ? { burger: m.burger.name, left: leftShort(m.leftMs) } : {}) }
    return { ...pickLine(kind, { vars, stage: st }), tick: 0 }
  })
  const say = useCallback((kind, vars) => {
    const { stage: st, vars: base } = ctx.current
    setClerk(c => ({ ...pickLine(kind, { last: c.text, vars: { ...base, ...vars }, stage: st }), tick: c.tick + 1 }))
  }, [])
  const sayEvent = (ev) => setClerk(c => ({ face: ev.face, text: fillLine(ev.text, ctx.current.vars), tick: c.tick + 1 }))
  const streak = useRef(null)
  const talked = useRef(false)
  const tapClerk = () => {
    streak.current = nextStreak(streak.current, Date.now())
    say(tapKindOf(streak.current.n, isNight()))   // 待たせないように、まずすぐ答える
    // その日はじめて話しかけたら、サーバーが好感度を+1（1日1回）。段階が上がっていれば、返事が来たところで
    // その段階の場面のセリフに切り替える（1回だけ）。開発用に好感度を仮に置いているあいだは、サーバーには聞かない（本物を増やさない）
    if (talked.current || devAff !== null) return
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
      talkAsker.set({ data: { ...data, seen: ev.stage } })   // 同じ日に店を開き直しても、もう出さない
      // ★supabase の呼び出しは then を付けないと送られない（結果は待たない＝失敗しても次の日にもう一度出るだけ）
      supabase.rpc('v2cap_clerk_seen', { p_stage: ev.stage }).then(() => {})
    })
  }
  // 開発用：好感度を仮に置く・その段階の場面とあいさつを見る
  const devGreet = useRef(0)
  const devStageEvent = () => {
    const ev = stageEventOf(stage, 0)
    if (ev && ev.stage === stage) sayEvent(ev)
    else setClerk(c => ({ face: 'normal', text: `（${stageLabelOf(stage)}の場面はまだありません）`, tick: c.tick + 1 }))
  }
  const devGreeting = () => {
    const kind = stage >= 1 ? DEV_GREETS[devGreet.current++ % DEV_GREETS.length] : 'enter'
    say(kind, meal ? { burger: meal.burger.name, left: leftShort(meal.leftMs) } : {})
  }

  // その日はじめて店を開いたら「いらっしゃいませー！」。日付はサーバーが覚える（SQLを流す前は端末に覚える）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: e } = await welcomeAsker.get()
      if (!alive) return
      if (!e && data?.ok) { if (data.first) { welcomeAsker.set({ data: { ok: true, first: false } }); setWelcome(true) } return }
      if (welcomeDueLocal(loadPref(WELCOME_PREF, ''))) { savePref(WELCOME_PREF, dayOf()); setWelcome(true) }
    })()
    return () => { alive = false }
  }, [])

  const order = async () => {
    setBusy(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('v2cap_burger_buy', { p_burger: pick, p_major: tops.major, p_minor: tops.minor })
      if (e || !data?.ok) { setError(e?.message || data?.error || '注文できませんでした'); say('error'); return }
      setServed(data)
      setNow(Date.now())
      const names = [data.meal_major, data.meal_minor].filter(Boolean).map(a => TOPPING_BY_AIL[a]?.name).filter(Boolean)
      say(names.length ? 'servedTopping' : 'served', { burger: BURGER_BY_STAT[data.meal_burger]?.name || '', toppings: names.join('と') })
      await onProfile?.(null)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  // 食べ直しの確かめ。開く前の表情とセリフを控えて、「やめる」で戻す（確かめのセリフが残らないように・2026-10-25）
  const beforeConfirm = useRef(null)
  const tryOrder = () => {
    if (meal) { beforeConfirm.current = clerk; setConfirm(true); say('confirm') } else order()
  }
  const cancelConfirm = () => {
    setConfirm(false)
    const b = beforeConfirm.current
    if (b) setClerk(c => ({ face: b.face, text: b.text, tick: c.tick + 1 }))
  }
  // トッピングを足して合計が持っているGoldを超えたら、しょんぼり（超えた瞬間だけ）
  const toggleTop = (key) => {
    const next = { ...tops, [key]: !tops[key] }
    setTops(next)
    if (mealCostOf(next) > have && cost <= have) say('short')
  }

  return (
    <div>
      <style>{CLERK_CSS}</style>
      {welcome && <V2capClerkWelcome line={pickLine('welcome').text} onClose={() => setWelcome(false)} />}
      {/* 決まりの説明（2026-10-25 ユーザー指示「ここら辺はHELPに載せて」＝前はトッピングと注文の下に出していた文） */}
      {help && (
        <V2Modal title="❓ HELP" color={MEAL_COLOR} keepScroll onClose={() => setHelp(false)}>
          <div style={HELP_HEAD}>トッピング</div>
          <div>頼んだ組の中から1つが乗ります（何が乗るかはお楽しみ）。乗ったものの状態異常にかかる確率−{TOPPING_RESIST_PCT}%</div>
          <div style={{ ...HELP_HEAD, marginTop:'10px' }}>食事の効き目</div>
          <div>・効くのは{MEAL_MINUTES}分（ログインしていない間も減ります）。出撃・ボス・覇天塔への挑戦で効きます</div>
          <div>・食べ直すと前の食事は消えます</div>
        </V2Modal>
      )}
      {confirm && meal && (
        <V2Modal title="🍔 食べ直しますか？" color={MEAL_COLOR} busy={busy} confirmLabel={`${gold(cost)}で注文する`}
          onConfirm={order} onClose={cancelConfirm}>
          <ClerkSays face={clerk.face} line={clerk.text} />
          {/* 2026-10-25 ユーザー指示の文（前は「いま効いている「〇〇」（残り◯分）は消えて、新しく食べたものが60分効きます。」） */}
          <div>適用中の「{meal.burger.name}」の効果は消えて、新しく食べたものが適用されます。</div>
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>（適用中の「{meal.burger.name}」は{leftText(meal.leftMs)}適用）</div>
        </V2Modal>
      )}
      {served && (
        <V2Modal title="🍔 お待たせしました！" color={MEAL_COLOR} onClose={() => setServed(null)}>
          <ClerkSays face={clerk.face} line={clerk.text} />
          <div style={{ color: MEAL_COLOR, fontSize:'14px', marginBottom:'4px' }}>{BURGER_BY_STAT[served.meal_burger]?.name}</div>
          <div>{burgerEffectText(served.meal_burger)}</div>
          {[served.meal_major, served.meal_minor].filter(Boolean).map(a => (
            <div key={a}>＋ <span style={{ color: TEXT.bright }}>{TOPPING_BY_AIL[a]?.name}</span>：{AIL_LABEL[a]}にかかる確率−{TOPPING_RESIST_PCT}%</div>
          ))}
          {/* 2026-10-25 ユーザー指示「60分効きます（2,000G）⇒効果時間：〇分にして」 */}
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>効果時間：{MEAL_MINUTES}分</div>
        </V2Modal>
      )}

      <div className="nk-cols">
        {/* 看板娘（広い画面は右・狭い画面は上） */}
        <div className="nk-side">
          <V2capClerk face={clerk.face} line={clerk.text} tick={clerk.tick} onTap={tapClerk} />
          {dev && (
            <div style={{ textAlign:'center', marginTop:'8px' }}>
              <button type="button" onClick={() => setWelcome(true)} style={miniBtn('#ff88cc')}>🧪 いらっしゃいませーを見る［開発］</button>
              {/* 好感度（ふつうは画面に出さない）。仮に置いた値はサーバーに書かない＝セリフを確かめる用 */}
              <div style={{ color:'#ff88cc', fontSize:'10px', marginTop:'6px' }}>
                ［開発］好感度 {devAff ?? aff}（{stageLabelOf(stage)}）{devAff !== null && <span style={{ color: TEXT.sub }}> 仮・本物は{aff}</span>}
              </div>
              <div style={{ display:'flex', gap:'4px', justifyContent:'center', flexWrap:'wrap', marginTop:'4px' }}>
                {[-10, -1, 1, 10].map(d => (
                  <button key={d} type="button" onClick={() => setDevAff(Math.max(0, (devAff ?? aff) + d))} style={miniBtn('#ff88cc')}>{d > 0 ? `+${d}` : d}</button>
                ))}
                <button type="button" onClick={devStageEvent} style={miniBtn('#ff88cc')}>段階の場面</button>
                <button type="button" onClick={devGreeting} style={miniBtn('#ff88cc')}>あいさつ</button>
                {devAff !== null && <button type="button" onClick={() => setDevAff(null)} style={miniBtn('#ff88cc')}>本物に戻す</button>}
              </div>
            </div>
          )}
        </div>

        <div className="nk-menu">
          {/* いま食べているもの */}
          <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
              <span style={{ color: TEXT.label, fontSize:'11px' }}>適用中のバーガー</span>
              <button type="button" onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>
            </div>
            {meal ? (
              <div style={{ fontSize:'12px', lineHeight:1.8 }}>
                {/* 狭い画面でも名前の途中で折り返さない（名前と効き目・残り時間の切れ目でだけ折れる） */}
                <span style={{ display:'inline-block' }}><span style={{ color: MEAL_COLOR }}>{meal.burger.name}</span>：{burgerEffectText(meal.stat)}</span>
                <span style={{ color: TEXT.label, marginLeft:'8px', display:'inline-block' }}>{leftText(meal.leftMs)}</span>
                {[meal.major, meal.minor].filter(Boolean).map(a => <div key={a} style={{ fontSize:'11px' }}>＋ {toppingText(a)}</div>)}
              </div>
            ) : <div style={{ color: TEXT.empty, fontSize:'12px' }}>なし</div>}
          </div>

          {/* ① バーガー */}
          <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
            <div style={{ color: MEAL_COLOR, fontSize:'12px', marginBottom:'6px' }}>① バーガーを選ぶ<span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{gold(BURGER_GOLD)}</span></div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:'6px' }}>
              {BURGERS.map(b => {
                const on = pick === b.stat
                const d = STAT_DEFS[b.stat]
                return (
                  <button key={b.stat} type="button" onClick={() => setPick(b.stat)} style={card(on)}>
                    <div style={{ color: on ? MEAL_COLOR : TEXT.bright, fontSize:'12px', marginBottom:'3px' }}>{b.name}</div>
                    {/* 上がるステだけ（説明の「物理の威力」などは出さない・2026-10-25 ユーザー指示「白文字いらない」） */}
                    <div style={{ fontSize:'11px', color: d.color }}>{burgerEffectText(b.stat)}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ② トッピング */}
          <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
            {/* 決まりの説明は HELP へ（2026-10-25 ユーザー指示「ここら辺はHELPに載せて」） */}
            <div style={{ color: MEAL_COLOR, fontSize:'12px', marginBottom:'6px' }}>② トッピング<span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>各{gold(TOPPING_GOLD)} ※任意</span></div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:'6px' }}>
              {TOPPING_GROUPS.map(g => {
                const on = tops[g.key]
                return (
                  <button key={g.key} type="button" onClick={() => toggleTop(g.key)} style={card(on)}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', marginBottom:'3px' }}>
                      <span style={{ color: on ? MEAL_COLOR : TEXT.bright, fontSize:'12px' }}>{on ? '☑' : '☐'} {g.label}</span>
                      <span style={{ color:'#ffcc00', fontSize:'11px' }}>+{gold(TOPPING_GOLD)}</span>
                    </div>
                    <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'2px' }}>{g.note}</div>
                    <GroupList group={g.key} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* 注文 */}
          <div style={{ ...box, padding:'10px 12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:'4px 12px', marginBottom:'8px', fontSize:'12px' }}>
              <span>合計 <span style={{ color:'#ffcc00', fontSize:'15px' }}>{gold(cost)}</span></span>
              <span style={{ color: TEXT.label, fontSize:'11px' }}>持っているGold <span style={{ color: short ? '#ff8844' : '#ffcc00' }}>{gold(have)}</span></span>
            </div>
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
            <button onClick={tryOrder} disabled={busy || short} style={{ ...btn(MEAL_COLOR), width:'100%', padding:'10px', opacity: busy || short ? 0.5 : 1 }}>
              {busy ? '焼いています…' : short ? 'Goldが足りません' : `${BURGER_BY_STAT[pick].name}を注文する`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
