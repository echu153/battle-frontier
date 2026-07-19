import { useState } from 'react'
import { createPortal } from 'react-dom'

// タッチ端末判定（マウスの無いスマホ/タブレットのみtrue）
const isTouch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches

// ============================================================
// アイテム説明ヒント（スキルの書などの効果表示用）
//  - PC: カーソルを合わせるとブラウザのツールチップ(title)で表示。クリック動作は素通し
//  - スマホ: ワンタップで詳細ポップアップを表示。
//    onAction 指定時はポップアップ内のボタンから元の動作（使う等）を実行する
// ============================================================
export default function ItemHint({ name, desc, children, style, onAction, actionLabel = '使う' }) {
  const [show, setShow] = useState(false)

  if (!desc) return <span style={style}>{children}</span>

  // スマホ: タップを横取りしてポップアップを開く（内側ボタンのonClickは発火させない）
  const capture = isTouch ? (e) => { e.preventDefault(); e.stopPropagation(); setShow(true) } : undefined

  return (
    <span title={`${name}\n${desc}`} style={style} onClickCapture={capture}>
      {children}
      {show && createPortal(
        <div onClick={() => setShow(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'pointer' }}>
          <div onClick={(e) => { e.stopPropagation() }}
            style={{ background: '#0a1424', border: '1px solid #335588', borderRadius: 6, padding: '14px 16px', maxWidth: 320, width: '100%', fontFamily: 'monospace', textAlign: 'left', cursor: 'default' }}>
            <div style={{ color: '#cce6ff', fontSize: 13, marginBottom: 6 }}>{name}</div>
            <div style={{ color: '#88aacc', fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{desc}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {onAction && (
                <button onClick={() => { setShow(false); onAction() }}
                  style={{ flex: 1, background: '#102040', border: '1px solid #4488cc', color: '#aaddff', padding: '7px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{actionLabel}</button>
              )}
              <button onClick={() => setShow(false)}
                style={{ flex: 1, background: '#0a1424', border: '1px solid #335588', color: '#88aacc', padding: '7px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>閉じる</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  )
}
