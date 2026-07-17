import RaidPushSettings from './RaidPushSettings'

// レイド通知のモーダル（街の☰メニューから開く）。
//  中身は RaidPushSettings が唯一の実装。ここは枠（モーダル）だけを持つ。
//  ※ここにUIを再実装しないこと。以前はレイド画面と別々に同じUIを持っていて、
//    夜/昼の切替を片方にしか足せず「昼のことが書かれていない」状態になった。
export default function RaidNotify({ open, onClose }) {
  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(360px, 100%)', background: '#000a1c', border: '1px solid #44ddaa', borderRadius: '8px', fontFamily: 'monospace', color: '#cfe', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: '#44ddaa', fontSize: '14px' }}>🔔 レイド通知</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#668899', fontSize: '16px', cursor: 'pointer' }}>✕</button>
        </div>
        <RaidPushSettings />
      </div>
    </div>
  )
}
