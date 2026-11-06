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
import { callScarecrowVerify, isStaleBuild, CORRECTED_TEXT } from '../lib/dungeonVerifyCall.js'
import { gainedExpOf, levelUpLines } from '../lib/settleLines.js'
import {
  SCARECROW_NAME, SCARECROW_SEC, SCARECROW_STEPS, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX,
  isScarecrowOpen, scarecrowExpOf, scarecrowDamageOf, scarecrowPctOf, startScarecrowAtb,
} from '../lib/scarecrow.js'
import { scarecrowArtOf, scarecrowFaceOf } from '../lib/scarecrowArt.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 修練場（冒険・デイリーで挑めるもの。1つ目は案山子）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「V２の冒険のコンテンツにデイリーで挑めるものを追加する、挑戦とは別」
//   「まずはエリア①クリアで開放する経験値のもらえる案山子を追加したい」→ 選んだ（どれも推奨・決まりの正は lib/scarecrow.js）：
//   ・メニューの名前は「修練場」。あとでデイリーで挑めるものをここへ足す
//   ・案山子：挑戦と同じ ATB で60秒（自分で技を選ぶ・マクロも使える）・反撃しない・状態異常にならない（11-06）・1日1回・エリア①のクリアで開く
//   ・EXP は与えたダメージで増える（目安どおりで出撃30回ぶん・50〜150%）
// 流れ：入口の「修練する」→ すぐ戦闘（遭遇の絵は無い）→ 60秒で「修練終了」のテロップ → 結果の画面（与えたダメージ・EXP・LVアップ）→ 修練場へ戻る
//   ★戦闘はサーバーが決めた種と写しで作り、終わったら押した記録を預ける（v2cap_scarecrow_end）。サーバーが同じ戦闘を回し直して EXP を入れる（挑戦と同じ形）。
//     途中で画面を離れたら、そこまでの記録を預ける。確かめられないまま戻ったら、入口で確かめ直す
//   ★始めたらその日の1回を使う（やめても戻らない）
// 結果の画面の行は「見出し 値」の1行（見出しだけの行を作らない・値は見出しのすぐ右で右揃え＝挑戦の結果と同じ）
// ============================================================

const DEV = '#ff88cc'
const COLOR = '#9ad06a'   // 修練場の色（メニューと同じ）
const NO_SQL = 'サーバーにまだこの仕組みがありません（SQL を流すと使えます）'
const VERIFY_LATER = '結果を確かめられませんでした（修練場に戻ると確かめ直します）'
const LATE_MS = 10 * 60 * 1000   // 始めてから記録を受け付ける長さ（SQL の c_late_min）。これを過ぎた「修練中」は、通常攻撃だけの60秒として確かめる
const errText = (error, data) => (/could not find the function/i.test(error?.message || '') ? NO_SQL : (error?.message || data?.error || 'うまくいきませんでした'))

const LABEL_W = '96px'
const VALUE_W = '72px'
const Row = ({ label, value, color = TEXT.bright }) => (
  <div style={{ display:'flex', alignItems:'baseline', padding:'5px 0', borderTop:'1px solid #001428', fontSize:'12px' }}>
    <span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>{label}</span>
    <span style={{ color, fontWeight:'bold', minWidth: VALUE_W, flexShrink: 0, textAlign:'right', whiteSpace:'nowrap' }}>{value}</span>
  </div>
)
const Face = ({ size = 'clamp(48px, 14vw, 60px)' }) => (
  <div style={{ width: size, height: size, flexShrink: 0, overflow:'hidden', background:`${COLOR}22`, border:'1px solid #002244', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <img src={scarecrowFaceOf()} alt="" draggable={false} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
  </div>
)

// 結果の画面（60秒のあと・やめたとき・入口で受け取ったとき）。st＝戦闘（入口で確かめ直したときは無い）・r＝確かめた返事（まだなら null）
function TrainingResult({ cls, st, r, onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const sec = st ? st.t : null
  return (
    <div style={{ ...box, padding:'14px', borderColor:'#3a6a2a' }}>
      <div style={{ textAlign:'center', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'20px', letterSpacing:'0.24em', paddingLeft:'0.24em', color:'#d8ffc8', textShadow:'0 0 10px rgba(95,208,122,0.55), 0 2px 0 #000', marginBottom:'10px' }}>修練結果</div>
      <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', marginBottom:'8px' }}>
        <Face size="88px" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', color: COLOR, marginBottom:'4px' }}>{SCARECROW_NAME}</div>
          {!r && <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px 0' }}>結果を確かめています…</div>}
          {r && !r.ok && <div style={{ color:'#ff8888', fontSize:'12px', padding:'8px 0' }}>{r.text || r.error}</div>}
          {r?.ok && (
            <>
              {sec !== null && <Row label="修練時間" value={`${sec.toFixed(1)}秒`} />}
              <Row label="与えたダメージ" value={Number(r.damage).toLocaleString()} />
              <Row label="目安との比" value={`${r.pct}%`} color={r.pct >= 100 ? '#ffd27a' : TEXT.bright} />
              {r.corrected && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>{CORRECTED_TEXT}</div>}
              {r.late && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>結果が届かなかったので、通常攻撃だけの{SCARECROW_SEC}秒として入れました</div>}
            </>
          )}
        </div>
      </div>
      {r?.practice && <div style={{ color: DEV, fontSize:'11px', marginTop:'8px' }}>［開発］試しなので EXP は入りません（サーバーにも送っていません）</div>}
      {r?.ok && !r.practice && (
        <div style={{ border:'1px solid #3a6a2a', background:'#000818', padding:'10px', marginTop:'8px' }}>
          <div style={{ color:'#ffcc00', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', lineHeight: 1.6 }}>EXP +{gainedExpOf(r).toLocaleString()}</div>
          {levelUpLines(cls, r.level).map((l, i) => <div key={i} style={{ color: l.color, fontSize:'12px', marginTop:'4px' }}>{l.text}</div>)}
        </div>
      )}
      <button onClick={onBack} disabled={!r} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px', marginTop:'12px' }}>← 修練場へ戻る</button>
    </div>
  )
}

export default function V2capTraining({ prof, inventory, onProfile, dev = false }) {
  const [state, setState] = useState(null)      // v2cap_scarecrow_state の返事
  const [msg, setMsg] = useState(null)          // { ok, text }
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)     // 画面が古い（読み直すまで修練しない）
  const [fight, setFight] = useState(null)      // { id, st, runKey, result, ended, practice（開発の試し＝サーバーに送らない） }
  const [claimed, setClaimed] = useState(null)  // 入口で確かめ直した結果
  const pending = useRef(null)                  // 送っていない修練（画面を離れたら送る）
  const settling = useRef(false)
  const onProfileRef = useRef(onProfile)
  onProfileRef.current = onProfile

  const open = isScarecrowOpen(prof?.cleared_spots)
  const macros = useMemo(() => macrosOf(prof), [prof])
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const baseCls = CLASS_BY_ID[prof?.class]?.req?.cls
  const playerSrc = useMemo(() => homeIconOf(prof?.class, myGender, baseCls), [prof?.class, myGender, baseCls])
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', baseCls), [prof?.class, myGender, baseCls])
  const art = scarecrowArtOf()

  // 確かめてもらう（1回だけ・何度呼んでも入るのは1回）。id＝きょうの修練・player＝自分
  const verify = useCallback(async (id, player) => {
    const r = await callScarecrowVerify({ id, player })
    if (!r?.ok) return { ok: false, text: VERIFY_LATER }
    onProfileRef.current?.()   // EXP が入った
    return r
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('v2cap_scarecrow_state')
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
        const { data: e } = await supabase.rpc('v2cap_scarecrow_end', { p_id: t.id, p_inputs: [], p_end_step: SCARECROW_STEPS, p_claim: null })
        if (!e?.ok) return
      }
      const r = await verify(t.id, data.me)
      if (r.ok) { setClaimed(r); setState(s => (s ? { ...s, today: r.today || s.today } : s)) }
    } finally {
      settling.current = false
    }
  }, [verify])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (msg?.text) window.scrollTo(0, 0) }, [msg?.text])

  const call = async (fn, args = {}) => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return null }
    return data
  }

  // ===== 修練する =====
  const start = async () => {
    setBusy(true)
    // 画面が古いままだと、サーバーの回し直しとずれる（1日1回を使う前に見る）
    if (await isStaleBuild()) { setBusy(false); setStale(true); return }
    const data = await call('v2cap_scarecrow_start')
    if (!data) { load(); return }
    // ★サーバーが決めた種と、サーバーが写し取った自分で戦う（回し直しも同じものから作る）
    const st = startScarecrowAtb(data)
    pending.current = { id: data.id, st }
    setFight(f => ({ id: data.id, st, runKey: (f?.runKey || 0) + 1, result: null, ended: false }))
    window.scrollTo(0, 0)
  }
  // 押した記録を預けて、結果を確かめてもらう（1回だけ）。60秒の終わり・やめる・画面を離れる、のどれか
  const report = useCallback(async () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    settling.current = true
    try {
      const { data, error } = await supabase.rpc('v2cap_scarecrow_end', { p_id: p.id, p_inputs: p.st.inputs, p_end_step: p.st.steps, p_claim: scarecrowDamageOf(p.st) })
      if (error || !data?.ok) return { ok: false, text: errText(error, data) }
      return await verify(p.id, data.player)
    } finally {
      settling.current = false
    }
  }, [verify])
  const onOver = async () => {
    if (fight?.practice) { setFight(f => (f ? { ...f, result: practiceResultOf(f.st) } : f)); return }
    const r = await report()
    if (r) setFight(f => (f ? { ...f, result: r } : f))
  }
  const onEnded = () => setFight(f => (f ? { ...f, ended: true } : f))
  // やめる：ここまでのダメージで入れて、すぐ結果の画面へ
  const giveUp = async () => {
    if (fight?.practice) { setFight(f => (f ? { ...f, ended: true, result: practiceResultOf(f.st) } : f)); return }
    setFight(f => (f ? { ...f, ended: true } : f))
    const r = await report()
    if (r) setFight(f => (f ? { ...f, result: r } : f))
  }
  // 戦っている途中で画面を離れたら、そこまでの記録を送る
  useEffect(() => () => { report() }, [report])
  const back = () => { setFight(null); setClaimed(null); load(); window.scrollTo(0, 0) }
  // 開発用：試しになぐる（サーバーに送らない・EXP は入らない・1日1回を使わない）。いまのキャラと持ち物で戦う＝SQL を流す前でも見た目と動きを確かめられる
  const practiceResultOf = (st) => { const d = scarecrowDamageOf(st); return { ok: true, practice: true, damage: d, pct: scarecrowPctOf(d, prof?.class, prof?.lv), exp: 0 } }
  const practice = () => {
    const st = startScarecrowAtb({ seed: Math.floor(Math.random() * 4294967296), snap: { prof, inv: inventory || [], at: Date.now() } })
    setFight(f => ({ id: null, st, runKey: (f?.runKey || 0) + 1, result: null, ended: false, practice: true }))
    window.scrollTo(0, 0)
  }
  const resetToday = async () => { if (await call('v2cap_dev_scarecrow_reset')) { setMsg({ ok: true, text: 'きょうの修練を戻しました' }); load() } }

  // ===== 結果 =====
  if (claimed) return <TrainingResult cls={prof?.class} st={null} r={claimed} onBack={back} />
  if (fight && (fight.ended || (fight.st.over && fight.result && !fight.result.ok))) {
    return <TrainingResult cls={prof?.class} st={fight.st} r={fight.result} onBack={back} />
  }

  // ===== 戦闘 =====
  if (fight) {
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: COLOR, fontSize:'12px', marginBottom:'6px' }}>{SCARECROW_NAME}（{SCARECROW_SEC}秒・反撃しない）</div>
        <V2capAtbFight st={fight.st} runKey={fight.runKey} macros={macros} playerSrc={playerSrc} playerMotion={playerMotion}
          bossArt={art} onOver={onOver} onEnded={onEnded}
          footer={fight.st.over ? null
            : <button onClick={giveUp} style={{ ...miniBtn('#ff8888'), flex:1, padding:'8px' }}>修練をやめる（ここまでのダメージで入れる）</button>} />
      </div>
    )
  }

  // ===== 入口 =====
  const today = state?.today
  const lv = prof?.lv || 1
  const block = !state ? null
    : !open ? 'エリア①をクリアすると修練できます'
    : today?.status === 'done' ? 'きょうはもう修練しました'
    : today ? '修練の結果を確かめています'
    : null
  return (
    <div>
      {msg && <div style={{ fontSize:'11px', marginBottom:'8px', color: msg.ok ? '#88ffaa' : '#ff8888' }}>{msg.text}</div>}
      {!state && !msg && <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'8px' }}>読み込み中...</div>}
      {stale && <V2capReloadNote />}
      <div style={{ ...box, padding:'10px', marginBottom:'10px', borderColor:'#3a6a2a' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <Face />
          <span style={{ flex:1, minWidth:0 }}>
            <b style={{ color: COLOR, fontSize:'13px' }}>{SCARECROW_NAME}</b>
            <span style={{ color: TEXT.label, fontSize:'10px' }}>　1日1回・{SCARECROW_SEC}秒・反撃しない・状態異常にならない</span><br />
            <span style={{ color: block ? TEXT.label : '#88ffaa', fontSize:'10px' }}>{state && (block || '修練できます')}</span>
          </span>
        </div>
        <div style={{ marginTop:'8px' }}>
          <Row label="入るEXP" value={`${scarecrowExpOf(lv, SCARECROW_PCT_MIN).toLocaleString()}〜${scarecrowExpOf(lv, SCARECROW_PCT_MAX).toLocaleString()}`} color="#ffcc00" />
          {today?.status === 'done' && today.result && (
            <Row label="きょうの結果" value={`EXP +${gainedExpOf(today.result).toLocaleString()}`} color="#ffcc00" />
          )}
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', margin:'6px 0 8px' }}>与えたダメージが多いほど、入るEXPが増えます</div>
        <button onClick={start} disabled={busy || !state || !!block}
          style={{ ...miniBtn(COLOR), width:'100%', padding:'10px', fontSize:'13px' }}>⚔ 修練する</button>
      </div>
      {dev && (
        <div style={{ display:'flex', gap:'6px' }}>
          <button onClick={practice} disabled={busy || !prof} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>🧪 試しになぐる（EXPなし）［開発］</button>
          <button onClick={resetToday} disabled={busy} style={{ ...miniBtn(DEV), flex:1, padding:'8px' }}>🧪 きょうの修練を戻す［開発］</button>
        </div>
      )}
    </div>
  )
}
