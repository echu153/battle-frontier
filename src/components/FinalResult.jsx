// 最終結果の全画面表示(自動では消えない。「盤面を確認」で閉じ、「待機画面に戻る」で待機へ)
// rows: [{ key, rank, name, sub }] rank=1が優勝(0なら順位表示なし=引き分け)
const RANK_COLORS = ['#ffdd44', '#cccccc', '#cc8844', '#889']

export function rankColorOf(rank) {
  return RANK_COLORS[rank - 1] || '#889'
}

export function FinalResult({ subtitle, rows = [], footNote, betNote, onClose, onReturn }) {
  const champ = rows.find((r) => r.rank === 1)
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 80,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      fontFamily: 'monospace',
    }}>
      <div style={{
        background: '#0d1a30', border: '2px solid #ffcc44', borderRadius: 8, padding: 16,
        width: '100%', maxWidth: 420, maxHeight: '88vh', overflowY: 'auto',
      }}>
        <div style={{ color: '#ffcc44', fontSize: 17, textAlign: 'center', marginBottom: 4 }}>🏆 最終結果</div>
        {subtitle && <div style={{ color: '#88ccff', fontSize: 11, textAlign: 'center', marginBottom: 12, wordBreak: 'break-word' }}>{subtitle}</div>}
        {champ && (
          <div style={{ textAlign: 'center', color: '#ffdd66', fontSize: 15, marginBottom: 12, wordBreak: 'break-word', lineHeight: 1.5 }}>
            👑 優勝<br />{champ.name}
          </div>
        )}
        {rows.map((r) => (
          <div key={r.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            border: `1px solid ${r.rank === 1 ? '#8a6a22' : '#223355'}`,
            background: r.rank === 1 ? 'rgba(255,204,68,0.08)' : 'transparent',
            padding: '6px 10px', marginBottom: 6,
          }}>
            <span style={{ color: rankColorOf(r.rank), fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.rank > 0 ? `${r.rank}位 ` : ''}{r.name}
            </span>
            <span style={{ color: '#88ccff', fontSize: 12, flexShrink: 0 }}>{r.sub}</span>
          </div>
        ))}
        {footNote && <div style={{ color: '#668', fontSize: 10, marginTop: 4, lineHeight: 1.6, wordBreak: 'break-word' }}>{footNote}</div>}
        {betNote && <div style={{ color: '#ffaa00', fontSize: 10, marginTop: 6, lineHeight: 1.6 }}>{betNote}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #88ccff', color: '#88ccff', padding: '10px 18px', fontSize: 13, cursor: 'pointer', fontFamily: 'monospace' }}>盤面を確認</button>
          <button onClick={onReturn} style={{ background: 'rgba(255,204,68,0.12)', border: '1px solid #ffcc44', color: '#ffcc44', padding: '10px 18px', fontSize: 13, cursor: 'pointer', fontFamily: 'monospace' }}>待機画面に戻る</button>
        </div>
      </div>
    </div>
  )
}
