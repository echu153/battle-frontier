import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from './V2LogLine.jsx'
import V2capAtbMacros from './V2capAtbMacros.jsx'
import V2capAtbStage from './V2capAtbStage.jsx'
import { box, miniBtn, TEXT } from './v2ui.js'
import { buildBattleLog } from '../core/battleLog.js'
import { mpCostOf } from '../core/battle.js'
import {
  createAtb, advance, reserve, unreserveAt, clearQueue, startMacro, stopMacro, toggleGuard,
  canUse, cdLeft, cdFor, cdRatio, guardReady, guardCdLeft, guardCdRatio, chosenOf,
  GUARD_CUT, GUARD_CD, CAST_SEC, MAX_SEC, QUEUE_MAX, TURN_SEC,
} from '../core/atb.js'
import { MACRO_MARK, macrosOf, validateMacros, macroEntriesOf } from '../lib/atbMacro.js'
import { loadPref } from '../core/prefs.js'
import { fxEventsOf, scheduleFx, POP_SEC } from '../lib/atbFx.js'
import { motionOf } from '../lib/motionArt.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { enemyArtSrc } from '../lib/enemyArt.js'
import { BOSS_DEFS, bossArtOf, newBossMotionMemo, bossMotionKeyOf } from '../lib/bossArt.js'
import { AREA_LIST, SPOTS, SUB_NAMES, toFighter as enemyFighter, enemyPowerOf } from '../lib/areas.js'
import { toFighter as playerFighter, slotsOf } from '../lib/loadout.js'
import { usableSkillNames, lineageOf, CLASS_BY_ID } from '../lib/jobs.js'
import { ascEffectsOf } from '../lib/ascension.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の試し撃ち［開発］
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「ATBのエンジンと試し撃ち画面（開発専用・報酬なし）を作って。細かい数字は試しながら決める」
//   ・レイドボス・IDダンジョンに載せる前の、手触りと数字を見るための場所。**報酬なし・サーバーへ何も送らない**
//   ・相手はエリアの敵（ボス・ふつう・朝昼晩・レア）。HPの倍率で長い戦い（レイドのボスの代わり）も見られる
//   ・自分は持っている技を全部使える（ATBの決まり）。技を押すと割り込みの列の後ろに入り、ゲージが満タンになると先頭から出る
//   ・自分が左・モンスターが右（2026-10-26 ユーザー指示・舞台は V2capAtbStage.jsx・動きは lib/atbFx.js）
//   ・マクロ①〜③（2026-10-26 ユーザー指示）：準備の画面で登録・保存（サーバーに職業ごと）、戦闘中に押すとその順に出る。
//     いま画面に出ている形（保存前でも）で戦う＝試しながら組み替えられる
//   ・ダンジョンのボス（lib/bossArt.js・2026-10-28 黒龍ヴァルゼノク）：ドット絵（待機・技ごとの攻撃）を見るための相手。
//     ★強さと技は仮＝いま選んでいる場所のボスのもの（ノーマルの中身は絵のあとで作る）。
//     流す絵も仮：通常攻撃＝黒爪／構えてから撃つ大技＝終焉の黒焔／ほかの技＝焦熱の吐息と黒翼烈風を交互（bossMotionKeyOf）。
//     戦闘中は「動きを見る」のボタンで、どの技の絵も流せる
// 中身（進み方）は src/v2cap/core/atb.js。つまみ（秒・倍率）もそちらの冒頭。マクロの決まりは src/v2cap/lib/atbMacro.js
// ============================================================

const HP_MULTS = [1, 10, 50]
const sel = { background:'#000818', color: TEXT.body, border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }
const chip = (color, bg = '#000818') => ({ fontSize:'10px', padding:'1px 5px', border:`1px solid ${color}`, color, background: bg })
// クールダウンの残り（ratio＝1で使った直後）。ボタン全体をグレーにし、時間がたつと下から青い色が満ちていく（満ちきったら使える）
//   【確定】2026-10-26 ユーザー指示「スキルがクールタイムの時、グレーアウトして時間の経過ごとに下から色が戻っていく仕様にして。マクロも一緒」
//   ＝技のボタン・防御のボタン・動いているマクロの手・割り込みの手。置く側は position:relative と overflow:hidden にする
//   ⚠前は上からかぶせる膜だけで、膜の色がボタンの地（濃い紺）とほぼ同じだったため、縮んでも見た目が変わらなかった
//   （ユーザー「下から戻らずCD解消されるまでグレーアウトのまま」）＝グレーの膜（全体）＋下から満ちる色、の2枚にした
const CdShade = ({ ratio }) => (ratio > 0 ? (
  <>
    <span aria-hidden style={{ position:'absolute', inset:0, pointerEvents:'none',
      background:'rgba(70, 76, 88, 0.55)', backdropFilter:'grayscale(1)', WebkitBackdropFilter:'grayscale(1)' }} />
    <span aria-hidden style={{ position:'absolute', left:0, right:0, bottom:0, height:`${((1 - ratio) * 100).toFixed(1)}%`, pointerEvents:'none',
      background:'rgba(60, 150, 255, 0.38)', borderTop:'1px solid rgba(140, 210, 255, 0.9)' }} />
  </>
) : null)

export default function V2capAtb({ prof, inventory, onProfile }) {
  const [macros, setMacros] = useState(() => macrosOf(prof))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [macroMsg, setMacroMsg] = useState(null)
  const [area, setArea] = useState(1)
  const [sub, setSub] = useState(1)
  const [foeName, setFoeName] = useState('')
  const [hpMult, setHpMult] = useState(1)
  const [phase, setPhase] = useState('setup')   // setup | fight
  const [paused, setPaused] = useState(false)
  const [, setFrame] = useState(0)
  const [logs, setLogs] = useState([])
  const st = useRef(null)
  const seen = useRef(0)
  const last = useRef(0)
  const logBox = useRef(null)
  const fxRef = useRef([])        // 画面の動き（lib/atbFx.js の fxEventsOf に、起きた時刻 t0（秒）を足したもの）

  const spot = SPOTS.find(s => s.area === area && s.sub === sub) || SPOTS[0]
  const foes = useMemo(() => [
    // ダンジョンのボス（絵があるものだけ）。強さと技は仮＝この場所のボスのもの
    ...Object.entries(BOSS_DEFS).filter(([key]) => bossArtOf(key)).map(([key, d]) => ({ ...spot.roster.boss, name: d.name, role:'ダンジョン', bossArt: key })),
    { ...spot.roster.boss, role:'ボス' },
    ...spot.roster.enemies.map(e => ({ ...e, role:'ふつう' })),
    ...spot.roster.timed.map(e => ({ ...e, role:'朝昼晩' })),
    ...spot.roster.rares.map(e => ({ ...e, role:'レア' })),
  ], [spot])
  const foe = foes.find(e => e.name === foeName) || foes[0]

  // 自分：いまの装備・ステのまま、持っている技（下位職のぶんも）を全部持たせる＝ATBの決まり
  const myFighter = useMemo(() => {
    const cls = prof?.class
    const lineage = lineageOf(cls)
    const names = usableSkillNames(cls, prof?.learned || [], lineage)
    return { ...playerFighter(prof, inventory), slots: slotsOf(names.map(name => ({ name, uses: 1 })), cls, lineage, ascEffectsOf(prof).ups) }
  }, [prof, inventory])

  // 絵：自分はクラスの待機GIF（ホームのアイコンと同じ・男女はキャラの性別）／相手は図鑑と同じ絵（ドット絵が届いたら差し替える）
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const playerSrc = homeIconOf(prof?.class, myGender, CLASS_BY_ID[prof?.class]?.req?.cls)
  // 攻撃の絵（あるクラスだけ・lib/motionArt.js）。無ければ踏み込み
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', CLASS_BY_ID[prof?.class]?.req?.cls), [prof?.class, myGender])
  // 攻撃の絵は先に読んでおく（はじめて殴った瞬間に絵が間に合わないと、1回目だけ消えて見える）
  useEffect(() => { if (playerMotion) { const im = new Image(); im.src = playerMotion.src } }, [playerMotion])
  // ダンジョンのボスの絵（待機・技ごと）。技の絵も先に読んでおく
  const bossKey = foe?.bossArt || null
  const bossArt = useMemo(() => (bossKey ? bossArtOf(bossKey) : null), [bossKey])
  useEffect(() => {
    if (!bossArt) return
    for (const src of [bossArt.idle.src, ...Object.values(bossArt.motions).map(m => m.src)]) { const im = new Image(); im.src = src }
  }, [bossArt])
  const bossMemo = useRef(newBossMotionMemo())

  // ===== 時間を進める =====
  // ★実時間の差分を advance に渡す（中では決まった刻みで進む＝同じ入力なら同じ結果）。
  //   setInterval なのは、裏のタブで requestAnimationFrame が止まると戦闘が固まって見えるため
  useEffect(() => {
    if (phase !== 'fight' || paused) return
    last.current = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const s = st.current
      if (s && !s.over) {
        advance(s, (now - last.current) / 1000)
        if (s.log.length > seen.current) {
          const fresh = s.log.slice(seen.current)
          seen.current = s.log.length
          const lines = buildBattleLog({ log: fresh }, s.a.name, s.b.name).filter(l => l.type !== 'hp')
          if (lines.length) setLogs(v => [...v, ...lines].slice(-80))
          const t0 = now / 1000
          let evs = fxEventsOf(fresh, s.a.name, s.b.name)
          // ボスは技ごとに絵が違う：構えた技を覚えておき、動いた（act）ごとに流す絵を付ける
          if (bossArt) {
            for (const l of fresh) if (l.type === 'cast' && l.side === s.b.name) bossMemo.current.casts.add(l.skill)
            evs = evs.map(e => (e.kind === 'act' && e.side === 'b' ? { ...e, motion: bossArt.motions[bossMotionKeyOf(bossArt.key, e, bossMemo.current)] || null } : e))
          }
          fxRef.current = [...fxRef.current.filter(f => t0 - f.t0 < POP_SEC + 0.5),
            ...scheduleFx(evs, t0, { a: playerMotion ? playerMotion.hitMs / 1000 : 0, b: (e) => (e.motion ? e.motion.hitMs / 1000 : 0) })]
        }
      }
      last.current = now
      setFrame(f => f + 1)
    }, 33)
    return () => clearInterval(id)
  }, [phase, paused, playerMotion, bossArt])
  // ログは新しい行が下に来る＝いちばん下まで送る
  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight }, [logs])

  const start = () => {
    // ダンジョンのボスは名前が場所の顔ぶれに無いので、強さ（戦闘力）はこの場所のボスのものを渡す（渡さないと1になる）
    const base = { ...enemyFighter(foe, 8, foe.bossArt ? enemyPowerOf(spot.roster.boss) : undefined), boss: foe.role === 'ボス' || !!foe.bossArt }
    const enemy = hpMult === 1 ? base : { ...base, stats: { ...base.stats, hp: base.stats.hp * hpMult } }
    st.current = createAtb(myFighter, enemy, { maxSec: MAX_SEC })
    seen.current = 0
    fxRef.current = []
    bossMemo.current = newBossMotionMemo()
    setLogs([{ text:`${foe.name}が現れた！`, color:'#88ccff' }])
    setPaused(false)
    setPhase('fight')
  }

  // ===== マクロ =====
  const usable = useMemo(() => myFighter.slots.map(s => s.skill.name), [myFighter])
  const editMacros = (next) => { setMacros(next); setDirty(true); setMacroMsg(null) }
  const saveMacros = async () => {
    const err = validateMacros(macros, usable)
    if (err) { setMacroMsg({ ok: false, text: err }); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('v2cap_set_atb_macros', { p_macros: macros })
    setSaving(false)
    if (error || !data?.ok) {
      // サーバーに保存の関数がまだ無い（SQL §19 を流す前）ときは、英語のまま出さずに案内する
      const missing = /could not find the function/i.test(error?.message || '')
      setMacroMsg({ ok: false, text: missing ? 'サーバーにまだ保存の仕組みがありません（SQLを流すと保存できます）' : (error?.message || data?.error || '保存できませんでした') })
      return
    }
    setDirty(false)
    setMacroMsg({ ok: true, text: `${prof?.class}のマクロを保存しました` })
    onProfile?.()
  }
  // ①〜③を押す：いま画面に出ている形で、そのマクロの頭から動かす（もう一度押しても頭から）
  //   【確定】2026-10-26 ユーザー指示「マクロは選択したらループするようにして」＝いつも最後まで出たら頭に戻る
  const runMacro = (i) => {
    const s = st.current
    if (!s) return
    startMacro(s, i + 1, macroEntriesOf(macros[i], s.a.slots), true)
  }

  // ===== 準備 =====
  if (phase !== 'fight' || !st.current) {
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.7, marginBottom:'10px' }}>
          レイドボス・IDダンジョンで使うATB戦闘の試し撃ちです。<b style={{ color: TEXT.bright }}>報酬なし・戦闘の結果はサーバーへ送りません</b>（送るのはマクロの保存だけ）。<br />
          ゲージはふだん5秒で満タン。AGIが相手を上回るほど速くなります（相手の4倍で2倍速まで）。技は全部使えて、使うとクールダウンに入ります（MPは回復しません）。
        </div>
        <V2capAtbMacros macros={macros} onChange={editMacros} usable={usable} dirty={dirty} saving={saving} msg={macroMsg} onSave={saveMacros} />
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
          <select value={area} onChange={e => { setArea(Number(e.target.value)); setFoeName('') }} style={sel}>
            {AREA_LIST.map((a, i) => <option key={a.name} value={i + 1}>{i + 1}. {a.name}</option>)}
          </select>
          <select value={sub} onChange={e => { setSub(Number(e.target.value)); setFoeName('') }} style={sel}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{SUB_NAMES[n - 1]} {SPOTS.find(s => s.area === area && s.sub === n)?.name}</option>)}
          </select>
          <select value={foe?.name || ''} onChange={e => setFoeName(e.target.value)} style={sel}>
            {foes.map(e => <option key={`${e.role}${e.name}`} value={e.name}>［{e.role}］{e.name}</option>)}
          </select>
        </div>
        {bossArt && (() => {
          const ms = BOSS_DEFS[bossArt.key].motions.map(m => m.file)
          return (
            <div style={{ display:'flex', gap:'10px', alignItems:'center', border:'1px solid #5a1a1a', background:'#140608', padding:'8px', marginBottom:'8px' }}>
              {bossArt.illust && <img src={bossArt.illust} alt="" draggable={false} style={{ width:'96px', height:'96px', objectFit:'contain', flexShrink:0 }} />}
              <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, minWidth:0 }}>
                <b style={{ color:'#ff8866' }}>{bossArt.name}</b>（ダンジョンのボス・絵の確かめ用）<br />
                強さと技は仮で、いま選んでいる場所のボスと同じです。流す絵は、通常攻撃＝{ms[0]}・構えてから撃つ大技＝{ms.at(-1)}・ほかの技＝{ms.slice(1, -1).join('と')}を交互。戦闘中の「動きを見る」でどれでも流せます
              </div>
            </div>
          )
        })()}
        <div style={{ display:'flex', gap:'4px', alignItems:'center', marginBottom:'10px', flexWrap:'wrap' }}>
          <span style={{ color: TEXT.label, fontSize:'11px' }}>相手のHP</span>
          {HP_MULTS.map(m => (
            <button key={m} onClick={() => setHpMult(m)}
              style={{ ...miniBtn(hpMult === m ? '#44ddff' : TEXT.label), padding:'5px 9px', fontSize:'11px', background: hpMult === m ? '#002850' : '#000818' }}>
              ×{m}
            </button>
          ))}
          <span style={{ color: TEXT.sub, fontSize:'10px' }}>（大きくするとレイドのボスのような長い戦いになります）</span>
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginBottom:'10px' }}>
          自分は今の装備・ステータスのまま、覚えている技を{myFighter.slots.length}個すべて持って戦います。制限時間{MAX_SEC}秒。
        </div>
        <button onClick={start} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px' }}>⏱ ATBで戦う</button>
      </div>
    )
  }

  // ===== 戦闘 =====
  const s = st.current
  const me = s.a
  const en = s.b
  const now = s.t
  const ch = chosenOf(me, now)
  const dealt = en.base.hp - Math.max(0, en.hp)
  const dealtPct = (dealt / en.base.hp) * 100
  const dps = dealt / Math.max(0.1, now)
  const waitName = ch.waiting === 'guard' ? '防御' : me.slots[ch.waiting]?.skill?.name
  const nextLabel = ch.guard ? '🛡 防御' : ch.skill ? ch.skill.name : ch.waiting != null ? `通常攻撃（${waitName}を待っている）` : '通常攻撃'
  const gReady = guardReady(me, now)
  const run = me.macro   // 動いているマクロ（core/atb.js の startMacro）
  const entryText = (e) => (e.guard ? '🛡 防御' : e.idx === null ? '通常攻撃' : me.slots[e.idx]?.skill?.name)
  const entryCd = (e) => (e.guard ? guardCdRatio(me, now) : e.idx !== null && e.idx !== undefined ? cdRatio(me, e.idx, now) : 0)

  return (
    <div style={{ ...box, padding:'12px' }}>
      {/* 自分（左）とモンスター（右） */}
      <V2capAtbStage st={s} fx={fxRef.current} now={performance.now() / 1000} playerSrc={playerSrc} playerMotion={playerMotion}
        foeSrc={bossArt ? bossArt.idle.src : enemyArtSrc(en.name)} foeBig={!!bossArt} />
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: TEXT.label, margin:'6px 0', gap:'8px', flexWrap:'wrap' }}>
        <span>次：{nextLabel}</span>
        <span>削り {dealtPct.toFixed(1)}%・{Math.round(dps).toLocaleString()}ダメージ/秒</span>
        <span>{now.toFixed(1)}秒 / {s.maxSec}秒</span>
      </div>
      {/* ボスの技の絵を流してみる（戦闘には関係しない） */}
      {bossArt && (
        <div style={{ display:'flex', gap:'4px', alignItems:'center', flexWrap:'wrap', marginBottom:'8px' }}>
          <span style={{ color: TEXT.label, fontSize:'10px' }}>動きを見る［開発］</span>
          {Object.entries(bossArt.motions).map(([k, m]) => (
            <button key={k} disabled={paused}
              onClick={() => { fxRef.current = [...fxRef.current, { kind:'act', side:'b', motion: m, t0: performance.now() / 1000 }] }}
              style={{ ...miniBtn('#ff8866'), padding:'4px 8px', fontSize:'11px' }}>{m.label}</button>
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
                <CdShade ratio={entryCd(e)} />
              </span>
            ))}
            <span style={{ color: TEXT.label, fontSize:'10px' }}>（最後まで出たら頭に戻る）</span>
          </div>
        ) : (
          <div style={{ color: TEXT.empty, fontSize:'10px' }}>
            {macros.some(m => m.steps.length) ? '①〜③を押すと、そのマクロの頭から出ます' : 'マクロは「相手を選び直す」の画面で登録できます'}
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
                  <CdShade ratio={entryCd(q)} />
                </button>
              )
            })}
            <button onClick={() => clearQueue(s)} style={{ ...miniBtn('#ff8888'), padding:'4px 8px' }}>空にする</button>
          </div>
        )}
      </div>

      {/* コマンド */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'8px' }}>
        {me.slots.map((sl, i) => {
          const left = cdLeft(me, i, now)
          // クールダウン中はふだんの色のままグレーをかける（下から色が戻る）。MP不足・封印などで使えないときは暗い色
          const lit = canUse(me, i, now) || left > 0
          const mp = mpCostOf(me, sl.skill)
          return (
            <button key={i} onClick={() => reserve(s, i)} disabled={s.over}
              style={{ ...miniBtn(lit ? '#44aaff' : '#2a4a66'), padding:'6px 8px', fontSize:'11px', textAlign:'left',
                color: lit ? '#88ccff' : TEXT.empty, position:'relative', overflow:'hidden', minWidth:'92px' }}>
              <div>{sl.skill.name}</div>
              <div style={{ fontSize:'9px', color: TEXT.label, marginTop:'2px' }}>
                {left > 0 ? `あと${left.toFixed(1)}秒` : `CD${cdFor(me, sl.skill)}秒`}・MP{mp}
              </div>
              <CdShade ratio={cdRatio(me, i, now)} />
            </button>
          )
        })}
        <button onClick={() => reserve(s, null)} disabled={s.over}
          style={{ ...miniBtn('#88ccff'), padding:'6px 8px', fontSize:'11px' }}>通常攻撃</button>
        <button onClick={() => toggleGuard(s)} disabled={s.over}
          style={{ ...miniBtn(me.guardNext ? '#ffee44' : '#66ccff'), padding:'6px 8px', fontSize:'11px',
            background: me.guardNext ? '#003060' : '#000818', textAlign:'left', position:'relative', overflow:'hidden' }}>
          <div>🛡 防御{me.guardNext ? '（次に出る）' : ''}</div>
          <div style={{ fontSize:'9px', color: TEXT.label, marginTop:'2px' }}>
            {gReady ? `被ダメージ-${GUARD_CUT}%・CD${GUARD_CD}秒` : `あと${guardCdLeft(me, now).toFixed(1)}秒`}
          </div>
          <CdShade ratio={guardCdRatio(me, now)} />
        </button>
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
        {!s.over && (
          <button onClick={() => setPaused(p => !p)} style={{ ...miniBtn('#ffcc44'), flex:1, padding:'8px' }}>
            {paused ? '▶ 再開' : '⏸ 一時停止［開発］'}
          </button>
        )}
        <button onClick={start} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>↻ もう一度</button>
        <button onClick={() => { setPhase('setup'); st.current = null }} style={{ ...miniBtn('#88aaff'), flex:1, padding:'8px' }}>← 相手を選び直す</button>
      </div>
      <div style={{ color: TEXT.empty, fontSize:'9px', marginTop:'6px' }}>
        1ターン＝{TURN_SEC}秒（ターンで数える効果はこの長さで切れます）・ボスの大技は{CAST_SEC}秒の構えのあとに出ます
      </div>
    </div>
  )
}
