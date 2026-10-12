// v2cap 賭博場 — 見た目の共通（色・枠・ボタン）。今のⅡの v2ui.js に合わせ、賭博場だけ金と紫を足す
export const CASINO = {
  gold: '#ffcc00',
  goldDeep: '#b8860b',
  pink: '#ff4fa3',
  cyan: '#33e0ff',
  green: '#44ff88',
  red: '#ff4466',
  purple: '#a77bff',
  dim: '#62789a',
  label: '#7fa6d0',
  body: '#88ccff',
  bright: '#cfe2ff',
  panel: '#0a0620',
  panelEdge: '#3a2a6a',
}
export const panel = (edge = CASINO.panelEdge) => ({
  border: `1px solid ${edge}`, background: 'linear-gradient(180deg,#0e0828 0%,#060314 100%)',
  borderRadius: '6px', padding: '10px', fontFamily: 'monospace',
})
// 押すボタン（大きい）
export const bigBtn = (color, on = true) => ({
  padding: '12px 14px', fontSize: '14px', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '1px',
  color: on ? '#0a0620' : '#555', cursor: on ? 'pointer' : 'not-allowed',
  background: on ? `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)` : '#222',
  border: `1px solid ${on ? color : '#333'}`, borderRadius: '6px',
  boxShadow: on ? `0 0 12px ${color}88, inset 0 1px 0 #ffffff66` : 'none',
  touchAction: 'manipulation', userSelect: 'none',
})
// 小さい切り替えボタン
export const pill = (color, active) => ({
  padding: '5px 9px', fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer',
  color: active ? '#0a0620' : color, background: active ? color : '#0a0620',
  border: `1px solid ${color}`, borderRadius: '12px', fontWeight: active ? 'bold' : 'normal',
  touchAction: 'manipulation',
})
export const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString()
export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.floor(Number(n) || 0)).toLocaleString()}`
