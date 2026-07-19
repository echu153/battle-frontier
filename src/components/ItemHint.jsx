import { useRef, useState } from 'react'

// ============================================================
// アイテム説明ヒント（スキルの書などの効果表示用）
//  - PC: カーソルを合わせるとブラウザのツールチップ(title)で表示
//  - スマホ: 長押しでポップアップ表示（長押し後は元のタップ動作を発火させない）
// ============================================================
export default function ItemHint({ name, desc, children, style }) {
  const [show, setShow] = useState(false)
  const timer = useRef(null)
  const longPressed = useRef(false)

  if (!desc) return <span style={style}>{children}</span>

  const start = () => {
    longPressed.current = false
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { longPressed.current = true; setShow(true) }, 450)
  }
  const end = (e) => {
    clearTimeout(timer.current)
    if (longPressed.current) { e.preventDefault(); e.stopPropagation() }
  }
  const cancel = () => { clearTimeout(timer.current) }

  return (
    <span title={`${name}\n${desc}`} style={style}
      onTouchStart={start} onTouchEnd={end} onTouchMove={cancel} onTouchCancel={cancel}
      onContextMenu={(e) => { if (longPressed.current) e.preventDefault() }}>
      {children}
      {show && (
        <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); longPressed.current = false; setShow(false) }}
          onTouchEnd={(e) => { e.stopPropagation() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'pointer' }}>
          <div style={{ background: '#0a1424', border: '1px solid #335588', borderRadius: 6, padding: '14px 16px', maxWidth: 320, width: '100%', fontFamily: 'monospace', textAlign: 'left' }}>
            <div style={{ color: '#cce6ff', fontSize: 13, marginBottom: 6 }}>{name}</div>
            <div style={{ color: '#88aacc', fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{desc}</div>
            <div style={{ color: '#445566', fontSize: 9, marginTop: 8, textAlign: 'center' }}>タップで閉じる</div>
          </div>
        </div>
      )}
    </span>
  )
}
