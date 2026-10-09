import V2LogLine from '../../v2/components/V2LogLine.jsx'

// ============================================================
// 「レベルキャップあり」版 — 戦闘ログの1行
//   HPの枠（type:'hp'）だけこの版の形で描き、ほかの行は今のⅡの V2LogLine に任せる。
//   ★2026-10-09 ユーザー指示「名前が下に来てるから上にもってきてほしい」：
//     共通の枠（旧版の BattleLogLine）は状態異常の印の場所を名前の上に空けて取るので、名前とHPが枠の下に寄っていた。
//     この版では **ターンの見出しのすぐ下に 名前とHP → HPバー**、状態異常の印は**あるときだけ**バーの下に出す。
//   ⚠旧版・今のⅡのログ（BattleLogLine）は変えていない
// ============================================================
const Status = ({ list, align }) => (!list || !list.length) ? null : (
  <div style={{ display:'flex', flexWrap:'wrap', gap:'3px', justifyContent: align, marginTop:'3px' }}>
    {list.map((s, i) => (
      <span key={i} style={{ fontSize:'9px', color: s.color, background:'#0e1c30', border:'1px solid #244', borderRadius:'3px', padding:'0 3px', whiteSpace:'nowrap' }}>{s.label}</span>
    ))}
  </div>
)

const Side = ({ name, cur, max, color, status, align }) => {
  const pct = Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100))
  return (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#b8d0e8', gap:'4px', marginBottom:'2px' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
        <span style={{ color, flexShrink:0, fontWeight:'bold' }}>{Math.max(0, cur).toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div style={{ background:'#13243a', height:'6px', border:'1px solid #2a456a' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#0a3,${color})` }} />
      </div>
      <Status list={status} align={align} />
    </div>
  )
}

export default function V2capLogLine({ l }) {
  if (l?.type !== 'hp') return <V2LogLine l={l} />
  return (
    <div style={{ borderBottom:'1px solid #24405e', padding:'6px', background:'#16263c', borderRadius:'3px', margin:'2px 0' }}>
      <div style={{ fontSize:'9px', color:'#7fa8d0', marginBottom:'3px', textAlign:'center' }}>━ {l.turn}ターン ━</div>
      {/* 味方は左・敵は右（今のⅡと同じ向き）。名前とHPを上に置く */}
      <div style={{ display:'flex', gap:'8px', alignItems:'flex-start' }}>
        <Side name={l.playerName} cur={l.playerHp} max={l.playerMax} color="#33dd66" status={l.playerStatus} align="flex-start" />
        <span style={{ color:'#ffcc66', fontSize:'10px', fontWeight:'bold', letterSpacing:'1px', flexShrink:0, paddingTop:'1px' }}>VS</span>
        <Side name={l.enemyName} cur={l.enemyHp} max={l.enemyMax} color="#ff6655" status={l.enemyStatus} align="flex-end" />
      </div>
    </div>
  )
}
