import V2LogLine from './V2LogLine.jsx'
import V2capIcon from './V2capIcon.jsx'
import { richSegments, RICH } from '../../lib/battleLogRich'

// ============================================================
// 「レベルキャップあり」版 — 戦闘ログの1行（1かたまり）
//   【確定】2026-10-12 ユーザー指示（あるけみすとの戦闘画面のスクショを見せて）
//     「自分が動くときは自分のアイコンが、敵が動くときは敵のアイコンが表示されるようにして、
//      HPの横にもあるけみすと参考に載せるようにしてほしい」
//   ・kind:'turn' … 「◯ターン」の見出し＋両方のアイコンとHPの表（味方は左・敵は右）。決着の表は倒れた側のアイコンを暗くする
//   ・kind:'act'  … 動いた側のアイコンを左に置き、その行動の行を右にまとめる（appear＝「◯◯が現れた！」は少し大きく、
//     **枠なしでモンスターの絵だけ**＝2026-10-12 ユーザー指示「モンスター出現するとき、枠いらない、モンスターのイラストだけでいい」。
//     絵の無いモンスターはアイコンを出さない＝文だけ。ターンの表と行動の行のアイコンは枠のまま）
//   並びを作るのは src/v2cap/lib/battleView.js。アイコンの絵は art（{ me:{ src, name }, foe:{ src, name } }）で受け取る
//     敵の絵：src/v2cap/lib/enemyArt.js（public/enemy-art）／自分の絵：src/v2cap/lib/classArt.js の battleIconOf
//     （SD（デフォルメ）の絵 → 無ければ神殿の顔のアップ）。絵が無いときは名前の1文字目を入れた枠
//   ★2026-10-09 ユーザー指示「名前が下に来てるから上にもってきてほしい」：名前とHPは表の上の段に置く（アイコンの右）
//   ★2026-10-10 ユーザー指示「倒した時のテロップ、わかりやすいように他よりも大きくして」：big の行は大きく太く
//   ほかの行（報酬・LVアップなど）は今のⅡの V2LogLine に任せる。⚠今のⅡ・旧版のログは変えていない
// ============================================================
const SIDE_COLOR = { me: '#33dd66', foe: '#ff6655' }

// アイコン。絵が読めないときも名前の1文字目の枠にする（key に src を付けて、絵が変わったら読み直す）。
// 枠そのものは図鑑と同じ部品（V2capIcon.jsx）
const Icon = ({ side, ...rest }) => <V2capIcon ring={SIDE_COLOR[side] || '#7fa6d0'} {...rest} />

// 表の片側：アイコン＋（名前・HP・HPバー）
function Cell({ who, art, st }) {
  const color = SIDE_COLOR[who]
  const pct = Math.max(0, Math.min(100, (st.hp / Math.max(1, st.max)) * 100))
  const name = art?.name || ''
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: '6px', alignItems: 'center', padding: '5px 6px' }}>
      <Icon key={art?.src || 'none'} src={art?.src} name={name} side={who} size={36} down={st.hp <= 0} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '10px', color: '#b8d0e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: '10px', color, fontWeight: 'bold', whiteSpace: 'nowrap', margin: '1px 0 2px' }}>
          HP {Math.max(0, st.hp).toLocaleString()} / {st.max.toLocaleString()}
        </div>
        <div style={{ background: '#0b1626', height: '6px', border: '1px solid #2a456a' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,#0a3,${color})` }} />
        </div>
      </div>
    </div>
  )
}

function TurnTable({ l, art }) {
  return (
    <div style={{ margin: '4px 0', border: '1px solid #24405e', borderRadius: '3px', overflow: 'hidden', background: '#13243a' }}>
      <div style={{ background: l.final ? '#3a2a14' : '#24405e', color: l.final ? '#ffcc66' : '#cfe2f5', fontSize: '10px',
        textAlign: 'center', padding: '2px 0', letterSpacing: '2px', fontWeight: 'bold' }}>
        {l.final ? '決着' : `${l.turn}ターン`}
      </div>
      {/* 味方は左・敵は右（今のⅡと同じ向き） */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <Cell who="me" art={art?.me} st={l.me} />
        <div style={{ width: '1px', background: '#24405e', flexShrink: 0 }} />
        <Cell who="foe" art={art?.foe} st={l.foe} />
      </div>
    </div>
  )
}

// まとまりの中の1行（枠線なし）。parts（1行の中で色を分ける）か、スキル名・数字に色を付けた文
const Line = ({ l, size }) => (
  <div style={{ color: l.color || '#7fa6d0', fontSize: size, lineHeight: 1.7, textAlign: 'left', wordBreak: 'break-word' }}>
    {l.parts
      ? l.parts.map((p, i) => <span key={i} style={p.color ? { color: p.color } : undefined}>{p.text}</span>)
      : richSegments(l.text || '').map((s, i) => (s.kind ? <span key={i} style={RICH[s.kind]}>{s.text}</span> : <span key={i}>{s.text}</span>))}
  </div>
)

function ActGroup({ l, art }) {
  const a = art?.[l.who]
  const big = !!l.appear
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid #001428' }}>
      <Icon key={a?.src || 'none'} src={a?.src} name={a?.name} side={l.who} size={big ? 52 : 44} bare={big} />
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
        {l.lines.map((x, i) => <Line key={i} l={x} size={big ? '13px' : '12px'} />)}
      </div>
    </div>
  )
}

export default function V2capLogLine({ l, art }) {
  if (l?.kind === 'turn') return <TurnTable l={l} art={art} />
  if (l?.kind === 'act') return <ActGroup l={l} art={art} />
  if (l?.big) {
    return (
      <div style={{ color: l.color, fontSize: '16px', fontWeight: 'bold', lineHeight: 1.8, letterSpacing: '1px',
        borderBottom: '1px solid #001428', padding: '4px 0', textAlign: 'left', textShadow: `0 0 8px ${l.color}66` }}>
        {l.text}
      </div>
    )
  }
  return <V2LogLine l={l} />
}
