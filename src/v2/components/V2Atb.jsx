import { useEffect, useRef, useState } from 'react'
import V2LogLine from './V2LogLine.jsx'
import { AREAS, toFighter as enemyFighter } from '../lib/enemies.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { buildBattleLog } from '../lib/battleLog.js'
import {
  createAtb, step, needOf, needNow, chosenOf, canUse, buffChips, ailChips,
  GAUGE_BASE, MAX_SEC,
} from '../lib/atb.js'
import { STAT_DEFS } from '../lib/stats.js'
import { miniBtn } from './v2ui.js'

// ============================================================
// バトルフロンティアⅡ（リメイク版）— ATB戦闘のプロトタイプ画面（開発限定）
// ------------------------------------------------------------
// 仕様の正は docs/v2-atb-design.md。中身（進行）は lib/atb.js。
// ★ここは**手触りを見るための試し撃ち場**。報酬もサーバーへの反映も無い。
//   ユニークボスに載せるときに、この画面をベースに作る。
// ============================================================

const BAR = (pct, color, h = 10) => (
  <div style={{ height:`${h}px`, background:'#000818', border:'1px solid #13405f', position:'relative' }}>
    <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background:color, transition:'width 80ms linear' }} />
  </div>
)

// バフ1つぶんの表示（「VIT+50% 42s」）
const buffText = (table) => Object.entries(table)
  .map(([k, v]) => `${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${Math.round(v)}%`).join('・')

const Chips = ({ side, now }) => {
  const buffs = buffChips(side, now)
  const ails = ailChips(side, now)
  if (!buffs.length && !ails.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'4px' }}>
      {buffs.map((c, i) => {
        const down = Object.values(c.table).every(v => v < 0)
        return (
          <span key={`b${i}`} style={{ fontSize:'10px', padding:'1px 5px', border:`1px solid ${down ? '#ff6699' : '#44aaff'}`,
            color: down ? '#ff88bb' : '#66bbff', background:'#000818' }}>
            {buffText(c.table)} {c.sec}s
          </span>
        )
      })}
      {ails.map(c => (
        <span key={c.key} style={{ fontSize:'10px', padding:'1px 5px', border:'1px solid #cc66ff', color:'#cc99ff', background:'#000818' }}>
          {c.label}{c.stacks ? `×${c.stacks}` : ''} {c.sec}s
        </span>
      ))}
    </div>
  )
}

export default function V2Atb({ prof, inventory, runes, fishDex }) {
  const [areaId, setAreaId] = useState(1)
  const [foeName, setFoeName] = useState('')
  const [phase, setPhase] = useState('setup')   // setup | fight
  const [, setFrame] = useState(0)
  const [logs, setLogs] = useState([])
  const st = useRef(null)          // 戦闘の状態（lib/atb.js）
  const seen = useRef(0)           // ログをどこまで画面へ流したか
  const raf = useRef(0)
  const last = useRef(0)

  const area = AREAS.find(a => a.id === areaId) || AREAS[0]
  const foes = [...area.enemies, ...(area.timed || []), area.boss]
  const foe = foes.find(e => e.name === foeName) || foes[0]

  // ===== 時間を進める =====
  // ★経過は**実時間の差分**で測る（setInterval の刻みを信用しない）。裏タブへ回すと
  //   ブラウザが間引くので進みが遅くなるが、1回ぶんの dt は lib 側（MAX_DT）で頭打ち＝
  //   戻ってきた瞬間に一気に進むことはない。
  //   requestAnimationFrame ではなく setInterval なのは、裏タブで**完全に止まって**しまうと
  //   戦闘が固まったように見えるため（間引かれながらでも進むほうが状態として素直）
  useEffect(() => {
    if (phase !== 'fight') return
    last.current = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = (now - last.current) / 1000
      last.current = now
      const s = st.current
      if (s && !s.over) {
        step(s, dt)
        if (s.log.length > seen.current) {
          const fresh = s.log.slice(seen.current)
          seen.current = s.log.length
          const lines = buildBattleLog({ log: fresh }, s.a.name, s.b.name).filter(l => l.type !== 'hp')
          if (lines.length) setLogs(v => [...v, ...lines].slice(-60))
        }
      }
      setFrame(f => f + 1)
    }
    raf.current = setInterval(tick, 33)   // 約30fps
    return () => clearInterval(raf.current)
  }, [phase])

  const start = () => {
    const me = playerFighter(prof, inventory, runes, fishDex)
    st.current = createAtb(me, enemyFighter(foe, 8), { maxSec: MAX_SEC })
    seen.current = 0
    setLogs([{ text:`${foe.name}が現れた！`, color:'#88ccff' }])
    setPhase('fight')
  }

  // ===== 準備画面 =====
  if (phase !== 'fight' || !st.current) {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
        <div style={{ color:'#44ddff', fontSize:'13px', marginBottom:'8px' }}>⏱ ATB戦闘［開発中のお試し］</div>
        <div style={{ color:'#7fa6d0', fontSize:'11px', lineHeight:'1.7', marginBottom:'10px' }}>
          時間で溜まるゲージでコマンドを選ぶ戦闘の試し撃ち場。<br />
          <b style={{ color:'#88ccff' }}>報酬もEXPも入らない・サーバーへ何も送らない。</b>手触りを見るためだけの画面。
        </div>
        <div style={{ display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap' }}>
          <select value={areaId} onChange={e => { setAreaId(Number(e.target.value)); setFoeName('') }}
            style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }}>
            {AREAS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={foe?.name || ''} onChange={e => setFoeName(e.target.value)}
            style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }}>
            {foes.map(e => <option key={e.name} value={e.name}>{e.name}（戦闘力{e.power}）</option>)}
          </select>
        </div>
        <button onClick={start} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px' }}>
          ⏱ ATBで戦う
        </button>
      </div>
    )
  }

  // ===== 戦闘画面 =====
  const s = st.current
  const me = s.a
  const en = s.b
  const myNeed = needNow(me)
  const enNeed = needNow(en)
  const chosen = chosenOf(me)
  const defLabel = me.def.idx === null ? '通常攻撃' : (me.slots[me.def.idx]?.skill?.name || '通常攻撃')

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
      {/* 相手 */}
      <div style={{ marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:'#ff8888' }}>
          <span>{en.name}</span>
          <span>{Math.max(0, en.hp).toLocaleString()} / {en.base.hp.toLocaleString()}</span>
        </div>
        {BAR((Math.max(0, en.hp) / en.base.hp) * 100, '#cc3344', 12)}
        <div style={{ marginTop:'3px' }}>{BAR((en.gauge / enNeed) * 100, '#ff9944', 6)}</div>
        <Chips side={en} now={s.t} />
      </div>

      {/* ログ */}
      <div style={{ height:'150px', overflowY:'auto', marginBottom:'10px', display:'flex', flexDirection:'column-reverse' }}>
        <div>{logs.map((l, i) => <V2LogLine key={i} l={l} />)}</div>
      </div>

      {/* 自分 */}
      <div style={{ marginBottom:'8px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:'#88ccff' }}>
          <span>{me.name}</span>
          <span>HP {Math.max(0, me.hp).toLocaleString()} / {me.base.hp.toLocaleString()}　MP {Math.max(0, me.mp).toLocaleString()}</span>
        </div>
        {BAR((Math.max(0, me.hp) / me.base.hp) * 100, '#44cc66', 12)}
        <div style={{ marginTop:'3px' }}>{BAR((me.gauge / myNeed) * 100, me.gauge >= myNeed ? '#ffee44' : '#44aaff', 8)}</div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#7fa6d0', marginTop:'2px' }}>
          <span>ATB {Math.floor(me.gauge)} / {myNeed}{me.pending !== undefined ? `　予約：${chosen.skill?.name || '通常攻撃'}` : ''}</span>
          <span>{s.t.toFixed(1)}秒 / {s.maxSec}秒</span>
        </div>
        <Chips side={me} now={s.t} />
      </div>

      {/* コマンド */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
        {me.slots.map((sl, i) => {
          const ok = canUse(me, i)
          const need = needOf(sl.skill)
          const reserved = me.pending?.idx === i
          return (
            <button key={i} disabled={!ok || me.auto} onClick={() => { me.pending = { idx: i } }}
              style={{ ...miniBtn(reserved ? '#ffee44' : ok ? '#44aaff' : '#2a4a66'), fontSize:'11px', padding:'6px 8px',
                background: reserved ? '#003060' : '#000818', color: ok ? (reserved ? '#ffee44' : '#88ccff') : '#3a5a76',
                cursor: ok && !me.auto ? 'pointer' : 'not-allowed' }}>
              {sl.skill.name}<span style={{ color:'#7fa6d0' }}> {need}／残{sl.uses}</span>
            </button>
          )
        })}
        <button disabled={me.auto} onClick={() => { me.pending = { idx: null } }}
          style={{ ...miniBtn(me.pending?.idx === null ? '#ffee44' : '#88ccff'), fontSize:'11px', padding:'6px 8px',
            background: me.pending?.idx === null ? '#003060' : '#000818' }}>
          通常攻撃<span style={{ color:'#7fa6d0' }}> {GAUGE_BASE}</span>
        </button>
      </div>

      {/* デフォルト行動とオート */}
      <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap', marginBottom:'8px' }}>
        <span style={{ fontSize:'10px', color:'#7fa6d0' }}>予約が無いときに出る行動</span>
        <select value={me.def.idx === null ? '' : me.def.idx}
          onChange={e => { me.def = { idx: e.target.value === '' ? null : Number(e.target.value) } }}
          style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'11px', padding:'4px' }}>
          <option value="">通常攻撃</option>
          {me.slots.map((sl, i) => <option key={i} value={i}>{sl.skill.name}</option>)}
        </select>
        <button onClick={() => { me.auto = !me.auto }}
          style={{ ...miniBtn(me.auto ? '#44ff88' : '#7fa6d0'), fontSize:'11px', padding:'5px 10px',
            background: me.auto ? '#003018' : '#000818' }}>
          オート {me.auto ? 'ON' : 'OFF'}
        </button>
        <span style={{ fontSize:'10px', color:'#5a7a96' }}>いまのデフォルト：{defLabel}</span>
      </div>

      {/* 決着 */}
      {s.over && (
        <div style={{ marginBottom:'8px', fontSize:'13px',
          color: s.winner === 'a' ? '#ffcc00' : s.winner === 'b' ? '#ff4444' : '#7fa6d0' }}>
          {s.winner === 'a' ? `⚔ ${en.name}を倒した！（${s.t.toFixed(1)}秒）`
            : s.winner === 'b' ? `敗北…（${s.t.toFixed(1)}秒）`
            : `時間切れ（${s.maxSec}秒）`}
        </div>
      )}
      <div style={{ display:'flex', gap:'6px' }}>
        <button onClick={start} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>↻ もう一度</button>
        <button onClick={() => { setPhase('setup'); st.current = null }} style={{ ...miniBtn('#88aaff'), flex:1, padding:'8px' }}>← 相手を選び直す</button>
      </div>
    </div>
  )
}
