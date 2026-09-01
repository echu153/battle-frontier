import { useEffect, useMemo, useRef, useState } from 'react'
import V2LogLine from './V2LogLine.jsx'
import { AREAS, AREAS_SORTED, areaFullName, toFighter as enemyFighter } from '../lib/enemies.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { dummyFoes } from '../lib/atbDummy.js'
import { buildBattleLog } from '../lib/battleLog.js'
import {
  createAtb, step, needOf, needNow, procBonusOf, chosenOf, canUse, buffChips, ailChips, guardLeft, stateChips,
  GAUGE_BASE, MAX_SEC, GUARD_NEED, GUARD_CUT, GUARD_SEC,
} from '../lib/atb.js'
import { STAT_DEFS } from '../lib/stats.js'
import V2Help from './V2Help.jsx'
import { miniBtn } from './v2ui.js'

// ============================================================
// バトルフロンティアⅡ（リメイク版）— ATB戦闘のプロトタイプ画面（開発限定）
// ------------------------------------------------------------
// 仕様の正は docs/v2-atb-design.md。中身（進行）は lib/atb.js。
// ★ここは**手触りを見るための試し撃ち場**。報酬もサーバーへの反映も無い。
//   ユニークボスに載せるときに、この画面をベースに作る。
// ============================================================

// 仮想敵と戦うときの1挑戦の長さ（秒）。ユニークボスの「1挑戦＝10ターン前後」に相当させる
const DUMMY_SEC = 90

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
  const guard = guardLeft(side, now)
  const states = stateChips(side)
  if (!buffs.length && !ails.length && !guard && !states.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'4px' }}>
      {guard > 0 && (
        <span style={{ fontSize:'10px', padding:'1px 5px', border:'1px solid #66ccff', color:'#aaddff', background:'#001830' }}>
          🛡 防御 被ダメージ-{GUARD_CUT}% {guard}s
        </span>
      )}
      {buffs.map((c, i) => {
        const down = Object.values(c.table).every(v => v < 0)
        return (
          <span key={`b${i}`} style={{ fontSize:'10px', padding:'1px 5px', border:`1px solid ${down ? '#ff6699' : '#44aaff'}`,
            color: down ? '#ff88bb' : '#66bbff', background:'#000818' }}>
            {buffText(c.table)} {c.sec}s
          </span>
        )
      })}
      {states.map(c => (
        <span key={c.key} style={{ fontSize:'10px', padding:'1px 5px', border:'1px solid #ffcc44',
          color:'#ffdd88', background:'#181000' }}>
          {c.label}
        </span>
      ))}
      {ails.map(c => (
        <span key={c.key} style={{ fontSize:'10px', padding:'1px 5px', border:'1px solid #cc66ff', color:'#cc99ff', background:'#000818' }}>
          {c.label}{c.stacks ? `×${c.stacks}` : ''} {c.sec}s
        </span>
      ))}
    </div>
  )
}

export default function V2Atb({ prof, inventory, runes, fishDex, dex, pet }) {
  const [mode, setMode] = useState('dummy')     // dummy=仮想敵（強い）／area=エリアの敵
  const [areaId, setAreaId] = useState(1)
  const [foeName, setFoeName] = useState('')
  const [dummyKey, setDummyKey] = useState('even')
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
  // 仮想敵は**自分のステータスから**組み立てる（戦闘力とAGIに比例）
  const myFighter = useMemo(() => playerFighter(prof, inventory, runes, fishDex, dex, pet), [prof, inventory, runes, fishDex, dex, pet])
  const dummies = useMemo(() => dummyFoes(myFighter), [myFighter])
  const dummy = dummies.find(d => d.key === dummyKey) || dummies[0]

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
    // ★仮想ボスのHPは**1時間ぶん**（ユニークボスの式）なので1回では削り切れない。
    //   ユニークボスと同じ「1挑戦で何%削れたか」を見る形にして、90秒で区切る
    const [enemy, name, sec] = mode === 'dummy'
      ? [dummy.make(), dummy.name, DUMMY_SEC]
      : [enemyFighter(foe, 8), foe.name, MAX_SEC]
    st.current = createAtb(myFighter, enemy, { maxSec: sec })
    seen.current = 0
    setLogs([{ text:`${name}が現れた！`, color:'#88ccff' }])
    setPhase('fight')
  }

  // ===== 準備画面 =====
  if (phase !== 'fight' || !st.current) {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
          <span style={{ color:'#44ddff', fontSize:'13px' }}>⏱ ATB戦闘［開発中のお試し］</span>
          <V2Help id="atb" />
        </div>
        <div style={{ color:'#7fa6d0', fontSize:'11px', lineHeight:'1.7', marginBottom:'10px' }}>
          時間で溜まるゲージでコマンドを選ぶ戦闘の試し撃ち場。<br />
          <b style={{ color:'#88ccff' }}>報酬もEXPも入らない・サーバーへ何も送らない。</b>手触りを見るためだけの画面。
        </div>
        {/* 相手の種類 */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
          {[{ key:'dummy', label:'🎯 仮想敵（強い）' }, { key:'area', label:'🌲 エリアの敵' }].map(t => (
            <button key={t.key} onClick={() => setMode(t.key)}
              style={{ ...miniBtn(mode === t.key ? '#44ddff' : '#7fa6d0'), fontSize:'11px', padding:'6px 10px',
                background: mode === t.key ? '#002850' : '#000818' }}>
              {t.label}
            </button>
          ))}
        </div>

        {mode === 'dummy' ? (
          <div style={{ marginBottom:'10px' }}>
            <div style={{ color:'#5a7a96', fontSize:'10px', marginBottom:'6px' }}>
              自分の戦闘力とAGIから組み立てる（HPは同じ戦闘力のキャラの3倍）。この相手はゲームには出てこない
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              {dummies.map(d => (
                <button key={d.key} onClick={() => setDummyKey(d.key)}
                  style={{ ...miniBtn(dummyKey === d.key ? '#44ddff' : '#7fa6d0'), textAlign:'left', padding:'7px 9px',
                    background: dummyKey === d.key ? '#002850' : '#000818', fontSize:'11px' }}>
                  <div style={{ color: dummyKey === d.key ? '#88ddff' : '#88ccff' }}>
                    {d.name}<span style={{ color:'#5a7a96' }}>　戦闘力{d.power.toLocaleString()}／HP{d.hp.toLocaleString()}</span>
                  </div>
                  <div style={{ color:'#5a7a96', fontSize:'10px', marginTop:'2px' }}>{d.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap' }}>
            <select value={areaId} onChange={e => { setAreaId(Number(e.target.value)); setFoeName('') }}
              style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }}>
              {AREAS_SORTED.map(a => <option key={a.id} value={a.id}>{areaFullName(a)}</option>)}
            </select>
            <select value={foe?.name || ''} onChange={e => setFoeName(e.target.value)}
              style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }}>
              {foes.map(e => <option key={e.name} value={e.name}>{e.name}（戦闘力{e.power}）</option>)}
            </select>
          </div>
        )}
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
  const defLabel = me.def.guard ? '防御'
    : me.def.idx === null ? '通常攻撃' : (me.slots[me.def.idx]?.skill?.name || '通常攻撃')
  const dealt = en.base.hp - Math.max(0, en.hp)
  const dealtPct = (dealt / en.base.hp) * 100
  const dps = dealt / Math.max(0.1, s.t)

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
        {/* 仮想敵は「削った割合」と「1秒あたりの与ダメージ」を出す＝ボスHPの式を測るため */}
        {mode === 'dummy' && (
          <div style={{ fontSize:'10px', color:'#7fa6d0', marginTop:'3px' }}>
            削り {dealtPct.toFixed(1)}%　／　{Math.round(dps).toLocaleString()}ダメージ/秒
          </div>
        )}
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
          <span>ATB {Math.floor(me.gauge)} / {myNeed}{me.pending !== undefined ? `　予約：${chosen.guard ? '防御' : chosen.skill?.name || '通常攻撃'}` : ''}</span>
          <span>{s.t.toFixed(1)}秒 / {s.maxSec}秒</span>
        </div>
        <Chips side={me} now={s.t} />
      </div>

      {/* コマンド */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
        {me.slots.map((sl, i) => {
          const ok = canUse(me, i)
          // ★発動率+%（パッシブ・エンチャント・武器の進化）は必要ゲージを軽くする。
          //   画面の数字も engine と同じ関数を通す（表示だけズレるのを防ぐ）
          const need = needOf(sl.skill, procBonusOf(me))
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
        {/* 防御は全職共通の基本コマンド（スキル枠を使わない） */}
        <button disabled={me.auto} onClick={() => { me.pending = { guard: true } }}
          style={{ ...miniBtn(me.pending?.guard ? '#ffee44' : '#66ccff'), fontSize:'11px', padding:'6px 8px',
            background: me.pending?.guard ? '#003060' : '#000818' }}>
          🛡 防御<span style={{ color:'#7fa6d0' }}> {GUARD_NEED}／{GUARD_SEC}秒 -{GUARD_CUT}%</span>
        </button>
      </div>

      {/* デフォルト行動とオート */}
      <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap', marginBottom:'8px' }}>
        <span style={{ fontSize:'10px', color:'#7fa6d0' }}>予約が無いときに出る行動</span>
        <select value={me.def.guard ? 'guard' : me.def.idx === null ? '' : me.def.idx}
          onChange={e => {
            const v = e.target.value
            me.def = v === 'guard' ? { guard: true } : { idx: v === '' ? null : Number(v) }
          }}
          style={{ background:'#000818', color:'#88ccff', border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'11px', padding:'4px' }}>
          <option value="">通常攻撃</option>
          <option value="guard">🛡 防御</option>
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
            : s.winner === 'b' ? `敗北…（${s.t.toFixed(1)}秒・${dealtPct.toFixed(1)}%削った）`
            : `⏱ ${s.maxSec}秒で${dealtPct.toFixed(1)}%削った（${Math.round(dps).toLocaleString()}ダメージ/秒）`}
        </div>
      )}
      <div style={{ display:'flex', gap:'6px' }}>
        <button onClick={start} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>↻ もう一度</button>
        <button onClick={() => { setPhase('setup'); st.current = null }} style={{ ...miniBtn('#88aaff'), flex:1, padding:'8px' }}>← 相手を選び直す</button>
      </div>
    </div>
  )
}
