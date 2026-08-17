import { BattleLogLine } from '../../pages/Game'

// バトルフロンティアⅡ（リメイク版）— 戦闘ログの1行
// ------------------------------------------------------------
// 基本は旧版の BattleLogLine をそのまま使う（スキル名・ダメージ・回復に色が付く）。
// **1行の中で色を分けたい行だけ**ここで描く。
//   例：「🎁 E級「銅のピアス」を入手！」→ **ランクと装備名だけ**にランクの色を付け、
//       それ以外（🎁・かぎかっこ・を入手！）は地の色のままにする（2026-08-17 ユーザー指示）。
//
// 使い方：ログに `parts: [{ text, color }, ...]` を入れると、そのとおりに並べて描く。
//   color を省いた要素は行の色（l.color）になる。parts が無い行は BattleLogLine へそのまま渡す。
// ⚠**枠の見た目は BattleLogLine と同じにそろえてある**（fontSize/lineHeight/枠線）。
//   向こうを触るときはここも合わせること。
export default function V2LogLine({ l }) {
  if (!l?.parts) return <BattleLogLine l={l} />
  return (
    <div style={{ color: l.color || '#7fa6d0', fontSize:'12px', lineHeight:'2',
      borderBottom:'1px solid #001428', padding:'2px 0', textAlign:'left' }}>
      {l.parts.map((p, i) => (
        <span key={i} style={p.color ? { color: p.color } : undefined}>{p.text}</span>
      ))}
    </div>
  )
}
