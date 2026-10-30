import { useEffect, useMemo, useRef, useState } from 'react'
import V2LogLine from './V2LogLine.jsx'
import V2capAtbStage from './V2capAtbStage.jsx'
import { miniBtn, TEXT } from './v2ui.js'
import { buildBattleLog } from '../core/battleLog.js'
import { mpCostOf } from '../core/battle.js'
import {
  advance, reserve, unreserveAt, clearQueue, startMacro, stopMacro, toggleGuard,
  canUse, cdLeft, cdFor, cdRatio, guardReady, guardCdLeft, guardCdRatio, chosenOf,
  GUARD_CUT, GUARD_CD, QUEUE_MAX, TURN_SEC,
} from '../core/atb.js'
import { MACRO_MARK, macroEntriesOf } from '../lib/atbMacro.js'
import { fxEventsOf, scheduleFx, POP_SEC } from '../lib/atbFx.js'
import { enemyArtSrc } from '../lib/enemyArt.js'
import { newBossMotionMemo, bossMotionKeyOf } from '../lib/bossArt.js'
import { artLoadedCount, preloadArt } from '../lib/artPreload.js'
import { DRAW_MS, atbLevelOf, newAtbPacer } from '../lib/atbPacer.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の画面（舞台・マクロ・技のボタン・ログ・時間を進める）
// ------------------------------------------------------------
// 2026-10-29 試し撃ち（V2capAtb.jsx）から切り出した＝IDダンジョン（V2capDungeon.jsx）でも同じ画面で戦う。
//   st … core/atb.js の createAtb の状態（親が作る）・runKey … 新しい戦闘を始めたら変える（ログ・動きを空にする）
//   macros … マクロ①〜③（atbMacro.js の形）・bossArt … ボスの絵（bossArt.js／bossIllust.js・無ければ図鑑の絵）
//   dev … 一時停止・「動きを見る」のボタン（試し撃ちだけ）・onOver … 決着がついたら1回呼ぶ（st を渡す）・footer … 下のボタン
//   ボスの技の名前が技の絵の名前と同じなら、その絵を流す（ダンジョンのボス・bossMotionKeyOf）。違えば仮の流し方
//   削った量は、この挑戦を始めたときのHP（st.b.startHp＝持ち越し）から数える
// ============================================================

const chip = (color, bg = '#000818') => ({ fontSize:'10px', padding:'1px 5px', border:`1px solid ${color}`, color, background: bg })
// クールダウンの残り（ratio＝1で使った直後）。ボタン全体をグレーにし、時間がたつと下から青い色が満ちていく（満ちきったら使える）
//   【確定】2026-10-26 ユーザー指示「スキルがクールタイムの時、グレーアウトして時間の経過ごとに下から色が戻っていく仕様にして。マクロも一緒」
//   ＝技のボタン・防御のボタン・動いているマクロの手・割り込みの手。置く側は position:relative と overflow:hidden にする
//   ⚠前は上からかぶせる膜だけで、膜の色がボタンの地（濃い紺）とほぼ同じだったため、縮んでも見た目が変わらなかった
//   （ユーザー「下から戻らずCD解消されるまでグレーアウトのまま」）＝グレーの膜（全体）＋下から満ちる色、の2枚にした
//   軽い表示（lite）：backdrop-filter はボタンごとに毎コマ合成し直すのでスマホでとても重い＝濃い膜だけ
const CdShade = ({ ratio, lite = false }) => (ratio > 0 ? (
  <>
    <span aria-hidden style={{ position:'absolute', inset:0, pointerEvents:'none',
      ...(lite ? { background:'rgba(70, 76, 88, 0.72)' } : { background:'rgba(70, 76, 88, 0.55)', backdropFilter:'grayscale(1)', WebkitBackdropFilter:'grayscale(1)' }) }} />
    <span aria-hidden style={{ position:'absolute', left:0, right:0, bottom:0, height:`${((1 - ratio) * 100).toFixed(1)}%`, pointerEvents:'none',
      background:'rgba(60, 150, 255, 0.38)', borderTop:'1px solid rgba(140, 210, 255, 0.9)' }} />
  </>
) : null)

// 技のボタンの格子：スマホの幅で3列・PCの幅で5列になる（1列の最小＝幅の30%・ただし180pxまで）
const SKILL_GRID = 'repeat(auto-fill, minmax(min(30%, 180px), 1fr))'
// 文字はクールダウンの膜より手前・1行に収める
const SKILL_TEXT = { position:'relative', zIndex: 1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }
// 技の名前の大きさ：ふだん11px。長い名前は、スマホの1列（画面の幅−余白を3つに分けた幅）に収まるまで小さく
const skillNameSize = (name) => `min(11px, calc(((100vw - 60px) / 3 - 8px) / ${Math.max(1, name.length)}))`

// 舞台だけを毎回更新する（技のボタンやログまで毎回作り直すと、スマホで間に合わない）。tickRef.current() で更新
const PANEL_MS = 66   // ボタンや数字は1秒15回
const LiveStage = ({ tickRef, st, fxRef, ...rest }) => {
  const [, setN] = useState(0)
  useEffect(() => {
    tickRef.current = () => setN(n => n + 1)
    return () => { tickRef.current = null }
  }, [tickRef])
  return <V2capAtbStage st={st} fx={fxRef.current} now={performance.now() / 1000} {...rest} />
}

export default function V2capAtbFight({ st: s, runKey, macros, playerSrc, playerMotion, bossArt = null, verPicker = null, dev = false, onOver, footer }) {
  const [paused, setPaused] = useState(false)
  const [, setFrame] = useState(0)
  const [logs, setLogs] = useState([])
  const seen = useRef(0)
  const last = useRef(0)
  const logBox = useRef(null)
  const fxRef = useRef([])        // 画面の動き（lib/atbFx.js の fxEventsOf に、起きた時刻 t0（秒）を足したもの）
  const bossMemo = useRef(newBossMotionMemo())
  const drawRate = useRef({ from: 0, n: 0, rate: 0, low: [], slow: false })   // 試し撃ちに出す実際の更新の回数（本物のスマホで読める）・low＝この10秒の回数
  const stageTick = useRef(null)
  const lastPanel = useRef(0)
  const [lite, setLite] = useState(() => atbLevelOf() >= 1)   // 軽い表示（lib/atbPacer.js）
  const overSent = useRef(false)
  const onOverRef = useRef(onOver)
  onOverRef.current = onOver

  // ボス戦は絵がそろうまで始めない（lib/artPreload.js・初めて開いたとき、絵が届く前に戦闘が始まっていた）
  const artSrcs = useMemo(() => (bossArt ? [...new Set([...bossArt.srcs, playerSrc, playerMotion?.src].filter(Boolean))] : []), [bossArt, playerSrc, playerMotion])
  const [artN, setArtN] = useState(0)
  const [artReady, setArtReady] = useState(() => artLoadedCount(artSrcs) === artSrcs.length)
  useEffect(() => {
    if (artLoadedCount(artSrcs) === artSrcs.length) { setArtReady(true); return }
    setArtReady(false)
    setArtN(artLoadedCount(artSrcs))
    let off = false
    preloadArt(artSrcs, { onProgress: (n) => { if (!off) setArtN(n) } }).then(() => { if (!off) setArtReady(true) })
    return () => { off = true }
  }, [artSrcs])

  // 新しい戦闘：ログと動きを空にする
  useEffect(() => {
    seen.current = 0
    fxRef.current = []
    bossMemo.current = newBossMotionMemo()
    overSent.current = false
    setLogs([{ text:`${s.b.name}が現れた！`, color:'#88ccff' }])
    setPaused(false)
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 時間を進める =====
  // ★実時間の差分を advance に渡す（中では決まった刻みで進む＝同じ入力なら同じ結果）。
  //   画面の更新は requestAnimationFrame で1秒60回まで（lib/atbPacer.js・間に合わない端末は30回）。
  //   裏のタブでは requestAnimationFrame が止まるので、そのあいだはタイマーで進める（戦闘が固まって見えない）
  useEffect(() => {
    if (paused || !artReady) return
    last.current = performance.now()
    const tick = (now) => {
      if (s && !s.over) {
        advance(s, (now - last.current) / 1000)
        if (s.log.length > seen.current) {
          const fresh = s.log.slice(seen.current)
          seen.current = s.log.length
          const lines = buildBattleLog({ log: fresh }, s.a.name, s.b.name).filter(l => l.type !== 'hp')
          if (lines.length) setLogs(v => [...v, ...lines].slice(-80))
          const t0 = now / 1000
          let evs = fxEventsOf(fresh, s.a.name, s.b.name)
          // ボスは技ごとに絵が違う：構えた技を覚えておき、動いた（act）ごとに流す絵を付ける（landed＝当たったか。外れたら当たるエフェクトを出さない）
          //   ダメージの数字と揺れは、エフェクトが自分に届いたとき（impactMs）
          if (bossArt) {
            for (const l of fresh) if (l.type === 'cast' && l.side === s.b.name) bossMemo.current.casts.add(l.skill)
            //   構えたあとの技に castSkipMs があれば、技の途中から流す（構えの5秒でためたので、もう一度ためない・終焉の黒焔）
            evs = evs.map((e, i) => {
              if (e.kind !== 'act' || e.side !== 'b') return e
              const motion = bossArt.motions[bossMotionKeyOf(bossArt.key, e, bossMemo.current)] || null
              return { ...e, motion, landed: evs[i + 1]?.kind !== 'miss', castSkip: motion?.castSkipMs && bossMemo.current.casts.has(e.skill) ? motion.castSkipMs : 0 }
            })
          }
          //   技の印は流し終わるまで残す（終焉の黒焔は2.5秒より長い）
          fxRef.current = [...fxRef.current.filter(f => t0 - f.t0 < Math.max(POP_SEC + 1.5, f.motion?.totalMs ? f.motion.totalMs / 1000 + 0.3 : 0)),
            ...scheduleFx(evs, t0, { a: playerMotion ? playerMotion.hitMs / 1000 : 0, b: (e) => (e.motion ? e.motion.impactMs / 1000 : 0) })]
        }
      }
      if (s?.over && !overSent.current) { overSent.current = true; onOverRef.current?.(s) }
      last.current = now
      stageTick.current?.()
      if (s?.over || now - lastPanel.current >= PANEL_MS) { lastPanel.current = now; setFrame(f => f + 1) }
    }
    const pacer = newAtbPacer()
    let lastTick = last.current, raf = 0
    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      if (!pacer.due(t)) return
      lastTick = performance.now()
      tick(lastTick)
      const r = drawRate.current
      r.n += 1
      if (!r.from) { r.from = t; r.n = 0 }   // 始まった瞬間は数えない
      if (t - r.from >= 1000) {
        const gap = t - r.from > 1500   // 止まっていた（裏のタブなど）ぶんは「最低」に入れない
        r.rate = Math.round((r.n * 1000) / (t - r.from)); r.from = t; r.n = 0; r.slow = pacer.ms !== DRAW_MS
        if (!gap) r.low = [...r.low, r.rate].slice(-10)
      }
      if (pacer.level >= 1) setLite(true)   // 同じ値なら React は何もしない
    }
    raf = requestAnimationFrame(loop)
    const id = setInterval(() => {
      const now = performance.now()
      if (now - lastTick < 100) return   // 動いているあいだは何もしない
      lastTick = now
      tick(now)
    }, 33)
    return () => { cancelAnimationFrame(raf); clearInterval(id) }
  }, [runKey, paused, playerMotion, bossArt, artReady]) // eslint-disable-line react-hooks/exhaustive-deps
  // ログは新しい行が下に来る＝いちばん下まで送る
  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight }, [logs])

  // ①〜③を押す：いま画面に出ている形で、そのマクロの頭から動かす（もう一度押しても頭から）
  //   【確定】2026-10-26 ユーザー指示「マクロは選択したらループするようにして」＝いつも最後まで出たら頭に戻る
  const runMacro = (i) => startMacro(s, i + 1, macroEntriesOf(macros[i], s.a.slots), true)

  const me = s.a
  const en = s.b
  const now = s.t
  const ch = chosenOf(me, now)
  const dealt = Math.max(0, (en.startHp ?? en.base.hp) - Math.max(0, en.hp))
  const dealtPct = (dealt / en.base.hp) * 100
  const dps = dealt / Math.max(0.1, now)
  const waitName = ch.waiting === 'guard' ? '防御' : me.slots[ch.waiting]?.skill?.name
  const nextLabel = ch.guard ? '🛡 防御' : ch.skill ? ch.skill.name : ch.waiting != null ? `通常攻撃（${waitName}を待っている）` : '通常攻撃'
  const gReady = guardReady(me, now)
  const run = me.macro   // 動いているマクロ（core/atb.js の startMacro）
  const entryText = (e) => (e.guard ? '🛡 防御' : e.idx === null ? '通常攻撃' : me.slots[e.idx]?.skill?.name)
  const entryCd = (e) => (e.guard ? guardCdRatio(me, now) : e.idx !== null && e.idx !== undefined ? cdRatio(me, e.idx, now) : 0)

  if (!artReady) return (
    <div style={{ padding:'64px 12px', textAlign:'center', background:'#000a26', border:'1px solid #0a2a55', color: TEXT.label, fontSize:'12px' }}>
      <div>読みこみ中…</div>
      <div style={{ width:'min(240px, 70%)', height:'4px', margin:'10px auto 0', background:'#0a2a55', borderRadius:'2px', overflow:'hidden' }}>
        <div style={{ width:`${(artN / artSrcs.length) * 100}%`, height:'100%', background:'#44ddff', transition:'width 0.15s' }} />
      </div>
    </div>
  )

  return (
    <div>
      {/* 自分（左）とモンスター（右） */}
      <LiveStage tickRef={stageTick} st={s} fxRef={fxRef} playerSrc={playerSrc} playerMotion={playerMotion}
        foeSrc={bossArt ? bossArt.idle?.src || null : enemyArtSrc(en.name)} foeBig={!!bossArt} foeArt={bossArt} lite={lite} />
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: TEXT.label, margin:'6px 0', gap:'8px', flexWrap:'wrap' }}>
        <span>次：{nextLabel}</span>
        <span>削り {dealtPct.toFixed(1)}%・{Math.round(dps).toLocaleString()}ダメージ/秒</span>
        <span>{now.toFixed(1)}秒 / {s.maxSec}秒</span>
        {dev && <span>更新 {drawRate.current.rate}回/秒（最低{drawRate.current.low.length ? Math.min(...drawRate.current.low) : '-'}）{lite ? '・軽い表示' : ''}{drawRate.current.slow ? '・30回に落とした' : ''} [開発]</span>}
      </div>
      {/* ボスの技の絵を流してみる（戦闘には関係しない） */}
      {dev && bossArt && (
        <div style={{ display:'flex', gap:'4px', alignItems:'center', flexWrap:'wrap', marginBottom:'8px' }}>
          {verPicker}
          <span style={{ color: TEXT.label, fontSize:'10px' }}>動きを見る［開発］</span>
          {/* 1つめは通常攻撃＝技の名前の帯は出さない（戦闘と同じ）・ほかは技の名前を付ける */}
          {Object.entries(bossArt.motions).map(([k, m], i) => (
            <button key={k} disabled={paused}
              onClick={() => { fxRef.current = [...fxRef.current, { kind:'act', side:'b', motion: m, landed: true, skill: i > 0 ? m.label : null, t0: performance.now() / 1000 }] }}
              style={{ ...miniBtn('#ff8866'), padding:'4px 8px', fontSize:'11px' }}>{m.label}</button>
          ))}
          {/* HPの節目のバフ（2026-10-30 ユーザー「バフ行動のボタンも用意しといて、確認し辛い」）：名前の帯・ポーズの絵・オーラだけ流す（バフは付かない） */}
          {(s.b.pattern?.buffs || []).map(b => (
            <button key={`buff-${b.name}`} disabled={paused}
              onClick={() => { fxRef.current = [...fxRef.current, { kind:'rage', side:'b', skill: b.name, t0: performance.now() / 1000 }] }}
              style={{ ...miniBtn('#ffb060'), padding:'4px 8px', fontSize:'11px' }}>🔥 {b.name}</button>
          ))}
        </div>
      )}

      {/* マクロ①〜③ */}
      <div style={{ border:'1px solid #13405f', padding:'6px', marginBottom:'8px' }}>
        <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap', marginBottom:'4px' }}>
          <span style={{ color: TEXT.label, fontSize:'11px' }}>マクロ</span>
          {macros.map((m, i) => {
            const on = run?.no === i + 1
            return (
              <button key={i} onClick={() => runMacro(i)} disabled={s.over || !m.steps.length}
                style={{ ...miniBtn(on ? '#ffee44' : m.steps.length ? '#44ddff' : '#2a4a66'), padding:'6px 12px', fontSize:'13px',
                  background: on ? '#003060' : '#000818' }}>
                {MACRO_MARK[i]}
              </button>
            )
          })}
          <button onClick={() => stopMacro(s)} disabled={s.over || !run} style={{ ...miniBtn('#ff8888'), padding:'6px 10px', fontSize:'11px' }}>⏹ 止める</button>
        </div>
        {run ? (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
            {run.steps.map((e, k) => (
              <span key={k} style={{ ...chip(k === run.pos ? '#ffee44' : '#88ccff', k === run.pos ? '#003060' : '#000818'),
                position:'relative', overflow:'hidden' }}>
                {k + 1}. {entryText(e)}
                <CdShade lite={lite} ratio={entryCd(e)} />
              </span>
            ))}
            <span style={{ color: TEXT.label, fontSize:'10px' }}>（最後まで出たら頭に戻る）</span>
          </div>
        ) : (
          <div style={{ color: TEXT.empty, fontSize:'10px' }}>
            {macros.some(m => m.steps.length) ? '①〜③を押すと、そのマクロの頭から出ます' : 'マクロは「ATB戦闘の試し撃ち」の準備の画面で登録できます'}
          </div>
        )}
        {/* 割り込み（手で押した技）。マクロより先に、1回ずつ出る */}
        {me.queue.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginTop:'6px' }}>
            <span style={{ color: TEXT.label, fontSize:'10px' }}>割り込み（{me.queue.length}/{QUEUE_MAX}）</span>
            {me.queue.map((q, i) => {
              const wait = i === 0 && q.idx !== null && !canUse(me, q.idx, now)
              return (
                <button key={i} onClick={() => unreserveAt(s, i)} title="押すと外す"
                  style={{ ...miniBtn(i === 0 ? '#ffee44' : '#88ccff'), padding:'4px 7px', fontSize:'11px', position:'relative', overflow:'hidden' }}>
                  {i + 1}. {entryText(q)}{wait ? `（あと${cdLeft(me, q.idx, now).toFixed(1)}秒）` : ''} ✕
                  <CdShade lite={lite} ratio={entryCd(q)} />
                </button>
              )
            })}
            <button onClick={() => clearQueue(s)} style={{ ...miniBtn('#ff8888'), padding:'4px 8px' }}>空にする</button>
          </div>
        )}
      </div>

      {/* コマンド：防御と通常攻撃は上の段に大きく・技は同じ大きさの格子（スマホ3列・PC5列）
          【確定】2026-10-31 ユーザー「今スキルこんな感じで乱雑しててすごい押しづらいし見づらい」→選択「同じ大きさの格子」：
          前は名前の長さで幅がばらばらだった。場所がいつも同じ＝指が覚える。クールダウン中は残りの秒を大きく。マクロ中心で技をたたむ案は検討中 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px', marginBottom:'4px' }}>
        <button onClick={() => toggleGuard(s)} disabled={s.over}
          style={{ ...miniBtn(me.guardNext ? '#ffee44' : '#66ccff'), padding:'8px 4px', fontSize:'13px', minHeight:'48px', minWidth:0,
            background: me.guardNext ? '#003060' : '#000818', textAlign:'center', position:'relative', overflow:'hidden' }}>
          <div style={SKILL_TEXT}>🛡 防御{me.guardNext ? '（次に出る）' : ''}</div>
          <div style={{ ...SKILL_TEXT, fontSize: gReady ? '9px' : '12px', fontWeight: gReady ? 'normal' : 'bold', color: gReady ? TEXT.label : '#ffffff', marginTop:'2px' }}>
            {gReady ? `被ダメージ-${GUARD_CUT}%・CD${GUARD_CD}秒` : `あと${guardCdLeft(me, now).toFixed(1)}秒`}
          </div>
          <CdShade lite={lite} ratio={guardCdRatio(me, now)} />
        </button>
        <button onClick={() => reserve(s, null)} disabled={s.over}
          style={{ ...miniBtn('#88ccff'), padding:'8px 4px', fontSize:'13px', minHeight:'48px', minWidth:0, textAlign:'center' }}>通常攻撃</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns: SKILL_GRID, gap:'4px', marginBottom:'8px' }}>
        {me.slots.map((sl, i) => {
          const left = cdLeft(me, i, now)
          // クールダウン中はふだんの色のままグレーをかける（下から色が戻る）。MP不足・封印などで使えないときは暗い色
          const lit = canUse(me, i, now) || left > 0
          const mp = mpCostOf(me, sl.skill)
          return (
            <button key={i} onClick={() => reserve(s, i)} disabled={s.over}
              style={{ ...miniBtn(lit ? '#44aaff' : '#2a4a66'), padding:'5px 3px', minHeight:'46px', minWidth:0, textAlign:'center',
                color: lit ? '#88ccff' : TEXT.empty, position:'relative', overflow:'hidden' }}>
              <div style={{ ...SKILL_TEXT, fontSize: skillNameSize(sl.skill.name) }}>{sl.skill.name}</div>
              <div style={{ ...SKILL_TEXT, fontSize: left > 0 ? '12px' : '9px', fontWeight: left > 0 ? 'bold' : 'normal', color: left > 0 ? '#ffffff' : TEXT.label, marginTop:'2px' }}>
                {left > 0 ? `あと${left.toFixed(1)}秒` : `CD${cdFor(me, sl.skill)}秒・MP${mp}`}
              </div>
              <CdShade lite={lite} ratio={cdRatio(me, i, now)} />
            </button>
          )
        })}
      </div>

      {/* ログ（2026-10-26 ユーザー指示「ログスキルの下に持ってきて」＝技のボタンの下） */}
      <div ref={logBox} style={{ height:'130px', overflowY:'auto', marginBottom:'10px', borderTop:'1px solid #001428', borderBottom:'1px solid #001428' }}>
        {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
      </div>

      {/* 決着 */}
      {s.over && (
        <div style={{ marginBottom:'8px', fontSize:'13px', color: s.winner === 'a' ? '#ffcc00' : s.winner === 'b' ? '#ff4444' : TEXT.label }}>
          {s.winner === 'a' ? `⚔ ${en.name}を倒した！（${now.toFixed(1)}秒）`
            : s.winner === 'b' ? `敗北…（${now.toFixed(1)}秒・${dealtPct.toFixed(1)}%削った）`
            : `⏱ 時間切れ（${s.maxSec}秒で${dealtPct.toFixed(1)}%削った・${Math.round(dps).toLocaleString()}ダメージ/秒）`}
        </div>
      )}
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
        {dev && !s.over && (
          <button onClick={() => setPaused(p => !p)} style={{ ...miniBtn('#ffcc44'), flex:1, padding:'8px' }}>
            {paused ? '▶ 再開' : '⏸ 一時停止［開発］'}
          </button>
        )}
        {footer}
      </div>
      <div style={{ color: TEXT.empty, fontSize:'9px', marginTop:'6px' }}>
        1ターン＝{TURN_SEC}秒（ターンで数える効果はこの長さで切れます）・ボスの大技はゲージが赤いあいだ構えてから出ます
      </div>
    </div>
  )
}
