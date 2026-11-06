import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capAtbFight from './V2capAtbFight.jsx'
import V2capReloadNote from './V2capReloadNote.jsx'
import { box, miniBtn, TEXT } from './v2ui.js'
import { JP_BOLD } from './casinoStyle.js'
import { loadPref } from '../core/prefs.js'
import { macrosOf } from '../lib/atbMacro.js'
import { motionOf } from '../lib/motionArt.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { CLASS_BY_ID } from '../lib/jobs.js'
import { callScarecrowVerify, callDayQuestVerify, isStaleBuild, CORRECTED_TEXT } from '../lib/dungeonVerifyCall.js'
import { gainedExpOf, levelUpLines } from '../lib/settleLines.js'
import {
  SCARECROW_NAME, SCARECROW_SEC, SCARECROW_STEPS, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX,
  isScarecrowOpen, scarecrowExpOf, scarecrowDamageOf, scarecrowPctOf, startScarecrowAtb,
} from '../lib/scarecrow.js'
import {
  DAY_QUEST_TITLE, DAY_QUESTS, DAY_QUEST_BY_DOW, DOW_LABEL, COFFER_KEY, cofferGoldOf, dowsOfQuest, isDayQuestOpen, playDowOf, startDayQuestAtb,
} from '../lib/dayQuest.js'
import { scarecrowArtOf, scarecrowFaceOf } from '../lib/scarecrowArt.js'
import { cofferArtOf, cofferFaceOf } from '../lib/cofferArt.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 日替わりクエスト（冒険・旧「修練場」。毎日の案山子＋曜日で変わるクエスト）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「V２の冒険のコンテンツにデイリーで挑めるものを追加する、挑戦とは別」→ 1つ目は案山子（決まりの正は lib/scarecrow.js）：
//   ・案山子：挑戦と同じ ATB で60秒（自分で技を選ぶ・マクロも使える）・反撃しない・状態異常にならない（11-06）・1日1回・エリア①のクリアで開く
//   ・EXP は与えたダメージで増える（目安どおりで出撃30回ぶん・50〜150%）
// 【確定】2026-11-06 ユーザー「修練場の枠、他にもコンテンツ入れるから名前変えたい」「案山子以外は曜日で変わるコンテンツにする予定」
//   「このコンテンツはAM5時にリセット」→ 選んだ名前「日替わりクエスト」（決まりの正は lib/dayQuestRules.js）：
//   ・曜日のクエスト：土日は宝箱の魔物（戦い方は案山子と同じ・入るのは Gold＝LV×500×割合）。月〜金はあとで決める
// 流れ（どちらも同じ）：入口の「修練する」「挑む」→ すぐ戦闘（遭遇の絵は無い）→ 60秒で終わりのテロップ → 結果の画面 → 日替わりクエストへ戻る
//   ★戦闘はサーバーが決めた種と写しで作り、終わったら押した記録を預ける（*_end）。サーバーが同じ戦闘を回し直して報酬を入れる（挑戦と同じ形）。
//     途中で画面を離れたら、そこまでの記録を預ける。確かめられないまま戻ったら、入口で確かめ直す
//   ★始めたらその日の1回を使う（やめても戻らない）
// 結果の画面の行は「見出し 値」の1行（見出しだけの行を作らない・値は見出しのすぐ右で右揃え＝挑戦の結果と同じ）
// ============================================================

const DEV = '#ff88cc'
const COLOR = '#9ad06a'   // 日替わりクエストの色（メニューと同じ）
const NO_SQL = 'サーバーにまだこの仕組みがありません（SQL を流すと使えます）'
const VERIFY_LATER = '結果を確かめられませんでした（日替わりクエストに戻ると確かめ直します）'
const LATE_MS = 10 * 60 * 1000   // 始めてから記録を受け付ける長さ（SQL の c_late_min）。これを過ぎた「挑戦中」は、通常攻撃だけの60秒として確かめる
const errText = (error, data) => (/could not find the function/i.test(error?.message || '') ? NO_SQL : (error?.message || data?.error || 'うまくいきませんでした'))

// ===== クエストごとの違い（呼ぶ関数・絵・言葉・報酬）=====
//   【確定】2026-11-07 ユーザー「戦った時間⇒これ挑戦の言い方と合わせて」「きょうはもう修練しました→挑戦済みにして」
//     「与えたダメージが多いほど、獲得できるEXPが増加します↑今な感じになおして、類似の内容はすべて」「金貨⇒Goldに統一」
//     「（AM 5：00更新）は日替わりクエスト全部だからHELPか右上の方に書いて」（→ 題の行の右はし・pages/V2capHome.jsx）
//     ＝時間の行は挑戦の倒せなかったときと同じ「戦闘時間」・どちらの枠も「挑戦できます」「挑戦済み」「⚔ 挑戦する」・入る量は「獲得できる◯◯」
const SCARECROW_RPC = { state: 'v2cap_scarecrow_state', start: 'v2cap_scarecrow_start', end: 'v2cap_scarecrow_end', reset: 'v2cap_dev_scarecrow_reset' }
const DAY_RPC = { state: 'v2cap_dayquest_state', start: 'v2cap_dayquest_start', end: 'v2cap_dayquest_end', reset: 'v2cap_dev_dayquest_reset' }
const SCARECROW_Q = {
  key: 'scarecrow', name: SCARECROW_NAME, color: COLOR, border: '#3a6a2a', title: '#d8ffc8', glow: '95,208,122',
  startAtb: startScarecrowAtb, art: scarecrowArtOf, face: scarecrowFaceOf, reward: 'exp',
  w: { go: '⚔ 挑戦する', can: '挑戦できます', done: '挑戦済み', checking: '結果を確かめています', locked: 'エリア①をクリアすると挑戦できます',
    result: '修練結果', time: '戦闘時間', quit: 'やめる（ここまでのダメージで獲得）', more: '与えたダメージが多いほど、獲得できるEXPが増加します',
    practice: '🧪 試しになぐる（EXPなし）［開発］', reset: '🧪 きょうの修練を戻す［開発］', resetDone: 'きょうの修練を戻しました' },
}
// 曜日のクエスト（key ごとの絵と色。月〜金のクエストを足すときはここにも足す）
const DAY_LOOK = {
  [COFFER_KEY]: { color: '#ffcc55', border: '#6a5420', title: '#fff0c0', glow: '255,190,60', art: cofferArtOf, face: cofferFaceOf,
    more: '与えたダメージが多いほど、獲得できるGoldが増加します' },
}
const DAY_Q = Object.fromEntries(Object.entries(DAY_LOOK).filter(([k]) => DAY_QUESTS[k]).map(([k, look]) => [k, {
  key: k, name: DAY_QUESTS[k].name, reward: DAY_QUESTS[k].reward, ...look, startAtb: startDayQuestAtb,
  w: { go: '⚔ 挑戦する', can: '挑戦できます', done: '挑戦済み', checking: '結果を確かめています', locked: 'エリア①をクリアすると挑戦できます',
    result: 'クエスト結果', time: '戦闘時間', quit: 'やめる（ここまでのダメージで獲得）', more: look.more,
    practice: '🧪 試しになぐる（Goldなし）［開発］', reset: '🧪 きょうのクエストを戻す［開発］', resetDone: 'きょうのクエストを戻しました' },
}]))
const dayQOf = (quest) => DAY_Q[quest] || null
// 入る量の幅（入口）と、入った量（結果）
const rangeOf = (q, lv) => (q.reward === 'gold'
  ? `${cofferGoldOf(lv, SCARECROW_PCT_MIN).toLocaleString()}〜${cofferGoldOf(lv, SCARECROW_PCT_MAX).toLocaleString()}`
  : `${scarecrowExpOf(lv, SCARECROW_PCT_MIN).toLocaleString()}〜${scarecrowExpOf(lv, SCARECROW_PCT_MAX).toLocaleString()}`)
const gotOf = (q, r) => (q.reward === 'gold' ? `Gold +${Number(r?.gold || 0).toLocaleString()}` : `EXP +${gainedExpOf(r).toLocaleString()}`)

const LABEL_W = '108px'   // 「獲得できるGold」が入る幅（96px では値にくっついた）
const VALUE_W = '100px'   // 値の欄（右揃え）。Gold の幅（LV80 で 20,000〜60,000）が入る＝同じ枠の値の右はしがそろう
const Row = ({ label, value, color = TEXT.bright }) => (
  <div style={{ display:'flex', alignItems:'baseline', padding:'5px 0', borderTop:'1px solid #001428', fontSize:'12px' }}>
    <span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>{label}</span>
    <span style={{ color, fontWeight:'bold', minWidth: VALUE_W, flexShrink: 0, textAlign:'right', whiteSpace:'nowrap' }}>{value}</span>
  </div>
)
const Face = ({ q, size = 'clamp(48px, 14vw, 60px)' }) => (
  <div style={{ width: size, height: size, flexShrink: 0, overflow:'hidden', background:`${q.color}22`, border:'1px solid #002244', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <img src={q.face()} alt="" draggable={false} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
  </div>
)

// 結果の画面（60秒のあと・やめたとき・入口で受け取ったとき）。st＝戦闘（入口で確かめ直したときは無い）・r＝確かめた返事（まだなら null）
function QuestResult({ q, cls, st, r, onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const sec = st ? st.t : null
  return (
    <div style={{ ...box, padding:'14px', borderColor: q.border }}>
      <div style={{ textAlign:'center', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'20px', letterSpacing:'0.24em', paddingLeft:'0.24em', color: q.title, textShadow:`0 0 10px rgba(${q.glow},0.55), 0 2px 0 #000`, marginBottom:'10px' }}>{q.w.result}</div>
      <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', marginBottom:'8px' }}>
        <Face q={q} size="88px" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', color: q.color, marginBottom:'4px' }}>{q.name}</div>
          {!r && <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px 0' }}>結果を確かめています…</div>}
          {r && !r.ok && <div style={{ color:'#ff8888', fontSize:'12px', padding:'8px 0' }}>{r.text || r.error}</div>}
          {r?.ok && (
            <>
              {sec !== null && <Row label={q.w.time} value={`${sec.toFixed(1)}秒`} />}
              <Row label="与えたダメージ" value={Number(r.damage).toLocaleString()} />
              {r.corrected && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>{CORRECTED_TEXT}</div>}
              {r.late && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>結果が届かなかったので、通常攻撃だけの{SCARECROW_SEC}秒として計算しました</div>}
            </>
          )}
        </div>
      </div>
      {r?.practice && <div style={{ color: DEV, fontSize:'11px', marginTop:'8px' }}>［開発］試しなので {q.reward === 'gold' ? 'Gold' : 'EXP'} は入りません（サーバーにも送っていません）</div>}
      {r?.ok && !r.practice && (
        <div style={{ border:`1px solid ${q.border}`, background:'#000818', padding:'10px', marginTop:'8px' }}>
          <div style={{ color:'#ffcc00', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', lineHeight: 1.6 }}>{gotOf(q, r)}</div>
          {q.reward === 'exp' && levelUpLines(cls, r.level).map((l, i) => <div key={i} style={{ color: l.color, fontSize:'12px', marginTop:'4px' }}>{l.text}</div>)}
        </div>
      )}
      <button onClick={onBack} disabled={!r} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px', marginTop:'12px' }}>← {DAY_QUEST_TITLE}へ戻る</button>
    </div>
  )
}

// 1つの枠の流れ（入口の様子・始める・記録を預ける・確かめる・開発の試し）。rpc・verifyFn はモジュールの定数（毎回作ると読み直しが止まらない）
function useIdleQuest(rpc, verifyFn, onProfile) {
  const [state, setState] = useState(null)      // *_state の返事
  const [msg, setMsg] = useState(null)          // { ok, text }
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)     // 画面が古い（読み直すまで始めない）
  const [fight, setFight] = useState(null)      // { q, id, st, runKey, result, ended, practice（開発の試し＝サーバーに送らない） }
  const [claimed, setClaimed] = useState(null)  // 入口で確かめ直した結果 { quest, r }
  const pending = useRef(null)                  // 送っていない1回（画面を離れたら送る）
  const settling = useRef(false)
  const onProfileRef = useRef(onProfile)
  onProfileRef.current = onProfile

  // 確かめてもらう（1回だけ・何度呼んでも入るのは1回）。id＝きょうの1回・player＝自分
  const verify = useCallback(async (id, player) => {
    const r = await verifyFn({ id, player })
    if (!r?.ok) return { ok: false, text: VERIFY_LATER }
    onProfileRef.current?.()   // EXP や Gold が入った
    return r
  }, [verifyFn])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc(rpc.state)
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return }
    setState(data)
    // 記録を預けたまま確かめられていない1回（通信が切れた・閉じた）・結果が届かないまま時間が過ぎた1回を確かめ直す
    const t = data.today
    if (!t || t.status === 'done' || settling.current || pending.current) return
    const late = t.status === 'open' && Date.now() - new Date(t.started_at).getTime() > LATE_MS
    if (t.status !== 'pending' && !late) return
    settling.current = true
    try {
      if (late) {
        const { data: e } = await supabase.rpc(rpc.end, { p_id: t.id, p_inputs: [], p_end_step: SCARECROW_STEPS, p_claim: null })
        if (!e?.ok) return
      }
      const r = await verify(t.id, data.me)
      if (r.ok) { setClaimed({ quest: t.quest || null, r }); setState(s => (s ? { ...s, today: r.today || s.today } : s)) }
    } finally {
      settling.current = false
    }
  }, [rpc, verify])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (msg?.text) window.scrollTo(0, 0) }, [msg?.text])

  const call = async (fn, args = {}) => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return null }
    return data
  }

  // ===== 始める =====（pickQ＝返事の quest から見た目を選ぶ・args＝始める関数に渡すもの）
  const start = async (pickQ, args = {}) => {
    setBusy(true)
    // 画面が古いままだと、サーバーの回し直しとずれる（1日1回を使う前に見る）
    if (await isStaleBuild()) { setBusy(false); setStale(true); return }
    const data = await call(rpc.start, args)
    if (!data) { load(); return }
    // ★サーバーが決めた種と、サーバーが写し取った自分で戦う（回し直しも同じものから作る）。曜日のクエストはサーバーが決めた quest で
    const q = pickQ(data.quest)
    const st = q.startAtb(data)
    pending.current = { id: data.id, st }
    setFight(f => ({ q, id: data.id, st, runKey: (f?.runKey || 0) + 1, result: null, ended: false }))
    window.scrollTo(0, 0)
  }
  // 押した記録を預けて、結果を確かめてもらう（1回だけ）。60秒の終わり・やめる・画面を離れる、のどれか
  const report = useCallback(async () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    settling.current = true
    try {
      const { data, error } = await supabase.rpc(rpc.end, { p_id: p.id, p_inputs: p.st.inputs, p_end_step: p.st.steps, p_claim: scarecrowDamageOf(p.st) })
      if (error || !data?.ok) return { ok: false, text: errText(error, data) }
      return await verify(p.id, data.player)
    } finally {
      settling.current = false
    }
  }, [rpc, verify])
  // 戦っている途中で画面を離れたら、そこまでの記録を送る
  useEffect(() => () => { report() }, [report])

  // 開発用：試しになぐる（サーバーに送らない・報酬は入らない・1日1回を使わない）。いまのキャラと持ち物で戦う＝SQL を流す前でも見た目と動きを確かめられる
  const practiceResultOf = (st, prof) => { const d = scarecrowDamageOf(st); return { ok: true, practice: true, damage: d, pct: scarecrowPctOf(d, prof?.class, prof?.lv), exp: 0, gold: 0 } }
  const onOver = async (prof) => {
    if (fight?.practice) { setFight(f => (f ? { ...f, result: practiceResultOf(f.st, prof) } : f)); return }
    const r = await report()
    if (r) setFight(f => (f ? { ...f, result: r } : f))
  }
  const onEnded = () => setFight(f => (f ? { ...f, ended: true } : f))
  // やめる：ここまでのダメージで入れて、すぐ結果の画面へ
  const giveUp = async (prof) => {
    if (fight?.practice) { setFight(f => (f ? { ...f, ended: true, result: practiceResultOf(f.st, prof) } : f)); return }
    setFight(f => (f ? { ...f, ended: true } : f))
    const r = await report()
    if (r) setFight(f => (f ? { ...f, result: r } : f))
  }
  const practice = (q, prof, inventory) => {
    const st = q.startAtb({ quest: q.key, seed: Math.floor(Math.random() * 4294967296), snap: { prof, inv: inventory || [], at: Date.now() } })
    setFight(f => ({ q, id: null, st, runKey: (f?.runKey || 0) + 1, result: null, ended: false, practice: true }))
    window.scrollTo(0, 0)
  }
  const back = () => { setFight(null); setClaimed(null); load(); window.scrollTo(0, 0) }
  const resetToday = async (doneText) => { if (await call(rpc.reset)) { setMsg({ ok: true, text: doneText }); load() } }

  return { state, msg, busy, stale, fight, claimed, start, onOver, onEnded, giveUp, practice, back, resetToday }
}

// 入口の1枚（顔・説明・入る量・きょうの結果・ボタン）
function QuestCard({ q, flow, open, lv, sub, dev, onStart, onPractice }) {
  const today = flow.state?.today
  const block = !flow.state ? null
    : !open ? q.w.locked
    : today?.status === 'done' ? q.w.done
    : today ? q.w.checking
    : null
  return (
    <div style={{ ...box, padding:'10px', marginBottom:'10px', borderColor: q.border }}>
      {flow.msg && <div style={{ fontSize:'11px', marginBottom:'8px', color: flow.msg.ok ? '#88ffaa' : '#ff8888' }}>{flow.msg.text}</div>}
      {!flow.state && !flow.msg && <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'8px' }}>読み込み中…</div>}
      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
        <Face q={q} />
        <span style={{ flex:1, minWidth:0 }}>
          <b style={{ color: q.color, fontSize:'13px' }}>{q.name}</b>
          <span style={{ color: TEXT.label, fontSize:'10px' }}>　{sub}</span><br />
          <span style={{ color: block ? TEXT.label : '#88ffaa', fontSize:'10px' }}>{flow.state && (block || q.w.can)}</span>
        </span>
      </div>
      <div style={{ marginTop:'8px' }}>
        <Row label={q.reward === 'gold' ? '獲得できるGold' : '獲得できるEXP'} value={rangeOf(q, lv)} color="#ffcc00" />
        {today?.status === 'done' && today.result && <Row label="きょうの結果" value={gotOf(q, today.result)} color="#ffcc00" />}
      </div>
      <div style={{ color: TEXT.sub, fontSize:'10px', margin:'6px 0 8px' }}>{q.w.more}</div>
      <button onClick={onStart} disabled={flow.busy || !flow.state || !!block}
        style={{ ...miniBtn(q.color), width:'100%', padding:'10px', fontSize:'13px' }}>{q.w.go}</button>
      {dev && (
        <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
          <button onClick={onPractice} disabled={flow.busy} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>{q.w.practice}</button>
          <button onClick={() => flow.resetToday(q.w.resetDone)} disabled={flow.busy} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>{q.w.reset}</button>
        </div>
      )}
    </div>
  )
}

export default function V2capTraining({ prof, inventory, onProfile, dev = false }) {
  const crow = useIdleQuest(SCARECROW_RPC, callScarecrowVerify, onProfile)
  const day = useIdleQuest(DAY_RPC, callDayQuestVerify, onProfile)

  const macros = useMemo(() => macrosOf(prof), [prof])
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const baseCls = CLASS_BY_ID[prof?.class]?.req?.cls
  const playerSrc = useMemo(() => homeIconOf(prof?.class, myGender, baseCls), [prof?.class, myGender, baseCls])
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', baseCls), [prof?.class, myGender, baseCls])
  const lv = prof?.lv || 1

  // ===== 結果・戦闘（どちらかの枠の途中なら、それだけ出す）=====
  for (const [flow, qOf] of [[crow, () => SCARECROW_Q], [day, (k) => dayQOf(k) || dayQOf(COFFER_KEY)]]) {
    if (flow.claimed) return <QuestResult q={qOf(flow.claimed.quest)} cls={prof?.class} st={null} r={flow.claimed.r} onBack={flow.back} />
    const f = flow.fight
    if (!f) continue
    if (f.ended || (f.st.over && f.result && !f.result.ok)) return <QuestResult q={f.q} cls={prof?.class} st={f.st} r={f.result} onBack={flow.back} />
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: f.q.color, fontSize:'12px', marginBottom:'6px' }}>{f.q.name}（{SCARECROW_SEC}秒・反撃しない）</div>
        <V2capAtbFight st={f.st} runKey={f.runKey} macros={macros} playerSrc={playerSrc} playerMotion={playerMotion}
          bossArt={f.q.art()} onOver={() => flow.onOver(prof)} onEnded={flow.onEnded}
          footer={f.st.over ? null
            : <button onClick={() => flow.giveUp(prof)} style={{ ...miniBtn('#ff8888'), flex:1, padding:'8px' }}>{f.q.w.quit}</button>} />
      </div>
    )
  }

  // ===== 入口 =====
  // 曜日はサーバーの答え（朝5時で切り替わる）。届くまでは手元の時計で
  const dow = Number.isInteger(day.state?.dow) ? day.state.dow : playDowOf()
  const dayQ = dayQOf(day.state?.today?.quest || (day.state ? day.state.quest : DAY_QUEST_BY_DOW[dow]))
  const weekly = Object.keys(DAY_Q)
  return (
    <div>
      {(crow.stale || day.stale) && <V2capReloadNote />}
      <QuestCard q={SCARECROW_Q} flow={crow} open={isScarecrowOpen(prof?.cleared_spots)} lv={lv} dev={dev}
        sub={`1日1回・${SCARECROW_SEC}秒・反撃しない・状態異常にならない`}
        onStart={() => crow.start(() => SCARECROW_Q)} onPractice={() => crow.practice(SCARECROW_Q, prof, inventory)} />

      {dayQ ? (
        <QuestCard q={dayQ} flow={day} open={isDayQuestOpen(prof?.cleared_spots)} lv={lv} dev={dev}
          sub={`${dowsOfQuest(dayQ.key)}・1日1回・${SCARECROW_SEC}秒・反撃しない・状態異常にならない`}
          onStart={() => day.start((k) => dayQOf(k) || dayQ)} onPractice={() => day.practice(dayQ, prof, inventory)} />
      ) : (
        // その曜日にクエストが無い日：曜日ごとの一覧（どの曜日に何があるか）
        <div style={{ ...box, padding:'10px', marginBottom:'10px' }}>
          {day.msg && <div style={{ fontSize:'11px', marginBottom:'8px', color: day.msg.ok ? '#88ffaa' : '#ff8888' }}>{day.msg.text}</div>}
          <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'4px' }}>きょう（{DOW_LABEL[dow]}曜日）の曜日のクエストはありません</div>
          {weekly.map(k => <Row key={k} label={`${dowsOfQuest(k)}曜日`} value={DAY_Q[k].name} color={DAY_Q[k].color} />)}
          {/* 開発：その曜日でないクエストを試す（平日に土日のクエストを確かめる）。「本当に挑む」はサーバーで挑む＝その日の1回を使う */}
          {dev && weekly.map(k => (
            <div key={k} style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginTop:'8px' }}>
              <button onClick={() => day.practice(DAY_Q[k], prof, inventory)} disabled={day.busy} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>🧪 {DAY_Q[k].name}を試しになぐる［開発］</button>
              <button onClick={() => day.start(() => DAY_Q[k], { p_quest: k })} disabled={day.busy || !day.state} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>🧪 {DAY_Q[k].name}に本当に挑む［開発］</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
