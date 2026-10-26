import { TEXT } from './v2ui.js'
import { buffChips, ailChips, stateChips, needNow, CAST_SEC } from '../core/atb.js'
import { STAT_DEFS } from '../core/stats.js'
import { lungeOf, shakeOf, HIT_SEC, POP_SEC, GLOW_SEC } from '../lib/atbFx.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の舞台（自分が左・モンスターが右）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「普通のバトルと同じでプレイヤーが左、モンスターが右に出るようにして、
//   プレイヤー側はクラスのドット絵が出るようにしたい」「モンスター側のドット絵も用意する」
//   自分の絵＝クラスの待機GIF（ホームと同じ）を**そのままの向き**で出す（反転すると逆を向く＝ユーザー「プレイヤー向き逆」で反転をやめた）
//   ・モンスターの絵はドット絵が届くまで、図鑑と同じ絵（enemyArt.js）。無ければ名前の1文字目
//   ・動き（lib/atbFx.js）：殴った側が前へ踏み込む／補助技・回復・防御は光る／受けた側は揺れて赤く光り、数字が浮かぶ
//     攻撃モーションのGIF（ユーザーが作る）が届いたら、踏み込みの代わりにその絵を1回流す
// ============================================================

const Bar = ({ pct, color, h = 10 }) => (
  <div style={{ height:`${h}px`, background:'#000818', border:'1px solid #13405f' }}>
    <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background: color }} />
  </div>
)
const chip = (color, bg = '#000818') => ({ fontSize:'10px', padding:'1px 5px', border:`1px solid ${color}`, color, background: bg })
const buffText = (table) => Object.entries(table)
  .map(([k, v]) => `${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${Math.round(v)}%`).join('・')

// かかっているもの（時間で切れるバフ・デバフ／状態異常／職の状態）
const Chips = ({ st, side, right }) => {
  const buffs = buffChips(side, st.t)
  const ails = ailChips(st, side)
  const states = stateChips(side)
  if (!buffs.length && !ails.length && !states.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'4px', justifyContent: right ? 'flex-end' : 'flex-start' }}>
      {buffs.map((c, i) => (
        <span key={`b${i}`} style={chip(c.debuff ? '#ff88bb' : '#66bbff')}>{buffText(c.table)} {c.sec}秒</span>
      ))}
      {ails.map(c => (
        <span key={c.key} style={chip('#cc99ff')}>{c.label}{c.stacks ? `×${c.stacks}` : ''}{c.sec ? ` ${c.sec}秒` : ''}</span>
      ))}
      {states.map(c => <span key={c.key} style={chip('#ffdd88', '#181000')}>{c.label}</span>)}
    </div>
  )
}

const POP_COLOR = { hit: '#ffffff', miss: '#9fb3c8', heal: '#44ff88', tick: '#cc99ff' }
const popText = (f) => (f.kind === 'miss' ? 'MISS' : f.kind === 'heal' ? `+${f.amount.toLocaleString()}` : f.amount.toLocaleString())

// 1人ぶん。right＝右（モンスター）。fx は [{ kind, side, amount, crit, t0 }]・now は fx の t0 と同じ時計（秒）
function Fighter({ st, side, me, right, src, fx, now, name }) {
  const mine = fx.filter(f => f.side === side)
  const lastOf = (kind) => mine.reduce((t, f) => (f.kind === kind && f.t0 > t ? f.t0 : t), -1e9)
  const dir = right ? -1 : 1   // 前＝相手の方
  const dx = lungeOf(now - lastOf('act')) * dir + shakeOf(now - lastOf('hit'))
  const hitAgo = now - lastOf('hit')
  const glowAgo = now - lastOf('use')
  const filters = []
  if (hitAgo >= 0 && hitAgo < HIT_SEC) filters.push('drop-shadow(0 0 6px #ff3344) brightness(1.25)')
  if (glowAgo >= 0 && glowAgo < GLOW_SEC) filters.push('drop-shadow(0 0 10px #ffee88) brightness(1.3)')
  if (me.ail.paralyze) filters.push('grayscale(0.6)')
  const down = me.hp <= 0
  const pops = mine.filter(f => f.kind !== 'act' && f.kind !== 'use' && now - f.t0 < POP_SEC)
  const need = needNow(me, st.t)
  const align = right ? 'flex-end' : 'flex-start'
  const hpColor = right ? '#cc3344' : '#44cc66'

  return (
    <div style={{ flex:'1 1 0', minWidth:0, display:'flex', flexDirection:'column', alignItems:'stretch' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', fontSize:'12px', color: right ? '#ff8888' : '#88ccff',
        flexDirection: right ? 'row-reverse' : 'row' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
      </div>
      {/* 絵 */}
      <div style={{ position:'relative', height:'clamp(110px, 30vw, 170px)', display:'flex', justifyContent:'center', alignItems:'flex-end', margin:'4px 0' }}>
        <div style={{ height:'100%', display:'flex', alignItems:'flex-end', transform:`translateX(${dx.toFixed(1)}px)`,
          opacity: down ? 0.25 : 1, transition:'opacity 0.4s' }}>
          {src ? (
            <img src={src} alt="" draggable={false}
              style={{ height:'100%', width:'auto', maxWidth:'100%', objectFit:'contain', filter: filters.join(' ') || 'none',
                userSelect:'none' }} />
          ) : (
            <div style={{ width:'clamp(80px, 22vw, 120px)', height:'clamp(80px, 22vw, 120px)', border:`2px solid ${hpColor}`, borderRadius:'8px',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:'40px', color: hpColor, filter: filters.join(' ') || 'none' }}>
              {(name || '？').slice(0, 1)}
            </div>
          )}
        </div>
        {/* 浮かぶ数字 */}
        {pops.map((f, i) => {
          const a = (now - f.t0) / POP_SEC
          return (
            <span key={`${f.t0}-${i}`} style={{ position:'absolute', left:'50%', top:`${30 - a * 26 - (i % 3) * 14}%`,
              transform:'translateX(-50%)', pointerEvents:'none', whiteSpace:'nowrap', fontWeight:'bold',
              fontSize: f.crit ? '22px' : '17px', color: f.crit ? '#ffcc00' : POP_COLOR[f.kind], opacity: Math.max(0, 1 - a * a),
              textShadow:'1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>
              {popText(f)}{f.crit ? '!' : ''}
            </span>
          )
        })}
      </div>
      {/* HP・ゲージ */}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: TEXT.label, gap:'4px', flexWrap:'wrap' }}>
        <span>HP {Math.max(0, me.hp).toLocaleString()} / {me.base.hp.toLocaleString()}</span>
        {!right && <span>MP {Math.max(0, me.mp).toLocaleString()} / {me.base.mp.toLocaleString()}</span>}
      </div>
      <Bar pct={(Math.max(0, me.hp) / me.base.hp) * 100} color={hpColor} h={10} />
      <div style={{ marginTop:'3px' }}>
        {me.cast
          ? <Bar pct={((st.t - me.cast.start) / CAST_SEC) * 100} color="#ff5522" h={8} />
          : <Bar pct={(Math.min(me.gauge, need) / need) * 100} color={me.ail.paralyze ? '#888888' : right ? '#ff9944' : '#44aaff'} h={6} />}
      </div>
      {me.cast && (
        <div style={{ color:'#ff9944', fontSize:'11px', marginTop:'2px', textAlign: right ? 'right' : 'left' }}>
          ⚠ 「{me.cast.name}」の構え　あと{Math.max(0, me.cast.until - st.t).toFixed(1)}秒
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', alignItems: align }}>
        <Chips st={st} side={me} right={right} />
      </div>
    </div>
  )
}

export default function V2capAtbStage({ st, fx, now, playerSrc, foeSrc }) {
  return (
    <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', padding:'8px',
      background:'linear-gradient(180deg, #000a26 0%, #001338 70%, #00204a 100%)', border:'1px solid #0a2a55' }}>
      <Fighter st={st} side="a" me={st.a} src={playerSrc} fx={fx} now={now} name={st.a.name} />
      <Fighter st={st} side="b" me={st.b} right src={foeSrc} fx={fx} now={now} name={st.b.name} />
    </div>
  )
}
